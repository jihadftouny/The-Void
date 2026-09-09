// THE LAYOUT PROBE'S ELECTRON HALF — it opens real windows and drives the real page.
//
// Run by `src/dev/layoutProbe.test.ts`, never by hand in CI and never by the game:
//
//   electron scripts/layout-probe.mjs --dist <builtDir> --out <builtDir>/result.json
//
// It writes ONE json file and exits. Everything it knows about the layout is a number it
// read out of a live Chromium; every judgement about whether that number is acceptable
// lives in the Vitest file, derived by hand from the type scale.
//
// ---------------------------------------------------------------------------------------
// THE FOUR THINGS IN HERE THAT ARE LOAD-BEARING, each measured rather than assumed:
//
//   1. `useContentSize: true` on every window. The probe must measure the size the PAGE
//      gets, not the size the window frame gets. Measured on this machine: a window built
//      with `width: 960, height: 640` and no `useContentSize` hands the page 947x577 —
//      the Windows frame and the default menu bar eat 14 px across and 63 px down. That is
//      the second defect this unit fixes, and a probe that measured the window box would
//      have been blind to it.
//   2. `backgroundThrottling: false`. The windows are never shown, and a hidden window
//      otherwise throttles `requestAnimationFrame` to a crawl — the resize waits below
//      would time out.
//   3. `disable-gpu`. There is no guarantee of a GPU on a build machine, and software
//      rasterisation produces identical LAYOUT (layout is not a paint).
//   4. A resize is not complete when `setContentSize` returns. The page is polled until
//      `innerWidth`/`innerHeight` actually report the new size, then given two animation
//      frames, and the loop FAILS LOUDLY on a timeout rather than measuring a stale layout.
// ---------------------------------------------------------------------------------------

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

function arg(name) {
  const at = process.argv.indexOf(name);
  if (at < 0 || at + 1 >= process.argv.length) throw new Error(`layout probe: missing ${name}`);
  return process.argv[at + 1];
}

const DIST = arg('--dist');
const OUT = arg('--out');

/**
 * The window sizes measured, as CONTENT sizes.
 *
 *   960x640   the enforced minimum, and the size the whole design is budgeted against
 *   1100x820  the size the game opens at
 *   1280x720  a common laptop working area
 *   1920x1080 a full-screen desktop, where the WIDTH caps have to start biting
 *   800x600   below the enforced minimum: unreachable in the shipped build, and the only
 *             place the stacked fallback can be exercised, so it is tested here or nowhere
 */
const SIZES = [
  [960, 640],
  [1100, 820],
  [1280, 720],
  [1920, 1080],
  [800, 600],
];

/** Both ends of the text-size setting. `small` never grows anything, so it cannot starve. */
const SCALES = ['normal', 'large'];

app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
const USER_DATA = path.join(DIST, 'userData');
fs.mkdirSync(USER_DATA, { recursive: true });
app.setPath('userData', USER_DATA);

/** Console output from the page, so a driver that threw says why instead of vanishing. */
const consoleLines = [];

function watch(win) {
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    consoleLines.push(`[${level}] ${source}:${line} ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    consoleLines.push(`render process gone: ${JSON.stringify(details)}`);
  });
  return win;
}

function fail(message) {
  const tail = consoleLines.length > 0 ? `\npage console:\n${consoleLines.join('\n')}` : '';
  throw new Error(`${message}${tail}`);
}

/**
 * Resize, then WAIT FOR THE PAGE TO AGREE. `setContentSize` is asynchronous from the
 * renderer's point of view, so measuring straight afterwards measures the previous layout.
 */
async function resize(win, width, height) {
  win.setContentSize(width, height);
  const settled = await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       let tries = 0;
       const tick = () => {
         tries += 1;
         if (window.innerWidth === ${width} && window.innerHeight === ${height}) {
           requestAnimationFrame(() => requestAnimationFrame(() =>
             resolve({ ok: true, width: window.innerWidth, height: window.innerHeight })));
           return;
         }
         if (tries > 300) {
           resolve({ ok: false, width: window.innerWidth, height: window.innerHeight });
           return;
         }
         setTimeout(tick, 10);
       };
       tick();
     })`,
  );
  if (!settled.ok) {
    fail(
      `the page never reached ${width}x${height} (it reports ` +
        `${settled.width}x${settled.height}) — the probe would have measured a stale layout`,
    );
  }
  return settled;
}

/**
 * PHASE A — every scenario, at every size, at both text sizes, in the real built page.
 */
async function phaseA() {
  const win = watch(
    new BrowserWindow({
      show: false,
      useContentSize: true,
      width: SIZES[0][0],
      height: SIZES[0][1],
      webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
    }),
  );
  await win.loadFile(path.join(DIST, 'probe.html'));

  const ready = await win.webContents.executeJavaScript(
    'typeof window.__voidLayoutProbe === "object" && Array.isArray(window.__voidLayoutProbe.scenarios)',
  );
  if (!ready) fail('the probe driver did not install itself on the page');
  const scenarios = await win.webContents.executeJavaScript('window.__voidLayoutProbe.scenarios');

  const out = [];
  for (const [width, height] of SIZES) {
    const actual = await resize(win, width, height);
    const reports = [];
    for (const scenario of scenarios) {
      for (const scale of SCALES) {
        reports.push(
          await win.webContents.executeJavaScript(
            `window.__voidLayoutProbe.run(${JSON.stringify({ scenario, scale })})`,
          ),
        );
      }
    }
    out.push({
      requested: { width, height },
      actual: { width: actual.width, height: actual.height },
      reports,
    });
  }
  win.destroy();
  return out;
}

/**
 * PHASE B — the enforced minimum really is the size the PAGE gets.
 *
 * Built with the exact option set `electron/main.mjs` carries, then squeezed with
 * `setSize(100, 100)`: the content box must still report 960x640 afterwards. Without
 * `useContentSize` the constraints apply to the window box instead and the page ends up
 * smaller than the documented minimum — which is what shipped until this unit.
 */
function phaseB() {
  const options = { width: 960, height: 640, minWidth: 960, minHeight: 640, useContentSize: true };
  const win = new BrowserWindow({ ...options, show: false });
  const before = { content: win.getContentSize(), window: win.getSize() };
  win.setSize(100, 100);
  const after = { content: win.getContentSize(), window: win.getSize() };
  win.destroy();

  // The CONTROL, in the same process and the same window manager: the identical window
  // WITHOUT `useContentSize` — so "the content box holds at 960x640" is a fact about the
  // option and not about this machine's window frame being zero.
  const bare = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 960,
    minHeight: 640,
    show: false,
  });
  bare.setSize(100, 100);
  const control = { content: bare.getContentSize(), window: bare.getSize() };
  bare.destroy();

  return { options, before, after, control };
}

app.whenReady().then(async () => {
  try {
    const result = {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      phaseA: await phaseA(),
      minWindow: phaseB(),
    };
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    app.exit(0);
  } catch (err) {
    process.stderr.write(String(err && err.stack ? err.stack : err));
    process.stderr.write('\n');
    app.exit(1);
  }
});
