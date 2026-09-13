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
//      `innerWidth`/`innerHeight` actually report the new size, and the loop FAILS LOUDLY on
//      a timeout rather than measuring a stale layout. It does NOT wait on an animation
//      frame: measured here, a frame in a window that is never shown costs about
//      three quarters of a second, because nothing is asking the compositor for one. Layout
//      is computed on demand when geometry is read, so a forced `getBoundingClientRect()` is
//      both exact and instant — no measurement below depends on anything being painted.
//   5. (`floor-looks`, 2026-09-12) THE ONE THING THAT DOES DEPEND ON FRAMES is the re-theme
//      dissolve: a CSS transition does not start until a frame is produced, so the fade pass
//      runs in an OFFSCREEN window rendering at 60 Hz — the cadence of a player's window —
//      while everything else keeps the never-shown windows above. See `fadePass`.
// ---------------------------------------------------------------------------------------

import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name) {
  const at = process.argv.indexOf(name);
  if (at < 0 || at + 1 >= process.argv.length) throw new Error(`layout probe: missing ${name}`);
  return process.argv[at + 1];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = arg('--dist');
const OUT = arg('--out');

/**
 * The window sizes measured, as CONTENT sizes.
 *
 *   960x640   the enforced minimum, and the size the whole design is budgeted against
 *   1100x820  the size the game opens at
 *   1280x720  a common laptop working area
 *   1920x1080 a full-screen desktop
 *   1920x1200 a 16:10 desktop — the ONLY size here at which the scenery's WIDTH cap governs
 *             instead of its height cap, and it is here for exactly that reason. The height
 *             cap is 22vh and the committed ratio is 16:9, so the width the height cap
 *             implies is 0.22 * H * 16/9; that only reaches the 440 px width cap at
 *             H >= 1125. At 1080 the height cap still governs (237.6 tall, 422.4 wide), so
 *             a suite that stopped at 1080 could never prove the second cap does anything.
 *   800x600   below the enforced minimum: unreachable in the shipped build, and the only
 *             place the stacked fallback can be exercised, so it is tested here or nowhere
 */
const SIZES = [
  [960, 640],
  [1100, 820],
  [1280, 720],
  [1920, 1080],
  [1920, 1200],
  [800, 600],
];

/** Both ends of the text-size setting. `small` never grows anything, so it cannot starve. */
const SCALES = ['normal', 'large'];

app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
const USER_DATA = path.join(DIST, 'userData');
fs.mkdirSync(USER_DATA, { recursive: true });
app.setPath('userData', USER_DATA);

// ⚠ THE PROBE MUST OUTLIVE ITS OWN WINDOWS. Electron quits the app by default once the last
// window closes, and each phase below destroys its window before the next one opens. The
// close is synchronous but the default quit is not, so the first `await` after a phase let
// the app exit — silently, with status 0 and no result file. Measured: phases A and B ran to
// completion and the process was gone before phase C could start. An empty handler is the
// documented way to opt out.
app.on('window-all-closed', () => {});

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
 *
 * ⚠ THE TOLERANCE IS TWO PIXELS, AND IT IS NOT SLOP. A content size is expressed in
 * device-independent pixels, and on a display with a fractional scale factor the requested
 * size need not land on a whole number of physical ones — asking for 1086 CSS pixels on a
 * 1.25x display produced 1088 here. Two pixels cannot be confused with a size that has not
 * changed yet (the sizes measured are hundreds of pixels apart), and the size the page
 * ACTUALLY reports is carried through to the result so the assertions judge the real one.
 */
const SIZE_TOLERANCE = 2;

async function resize(win, width, height) {
  win.setContentSize(width, height);
  const settled = await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       let tries = 0;
       const tick = () => {
         tries += 1;
         if (Math.abs(window.innerWidth - ${width}) <= ${SIZE_TOLERANCE} &&
             Math.abs(window.innerHeight - ${height}) <= ${SIZE_TOLERANCE}) {
           // A forced layout read rather than two animation frames. In a window that is
           // never shown an animation frame costs ~0.75s (no compositor is asking for
           // frames), and nothing here needs a PAINT: the page has already reported the new
           // viewport, and reading geometry flushes layout synchronously.
           // (No backticks in here -- this whole block is inside a template literal.)
           setTimeout(() => {
             document.body.getBoundingClientRect();
             resolve({ ok: true, width: window.innerWidth, height: window.innerHeight });
           }, 0);
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

  // THE BUNDLED FACE, FETCHED BEFORE ANYTHING IS MEASURED — and it has to be asked for
  // explicitly. A web font is only fetched when some text actually needs it, and the probe
  // page starts completely empty, so `document.fonts.ready` resolves immediately having
  // loaded nothing. Measuring then would produce the SYSTEM monospace's metrics: every
  // character width, every wrap point and therefore every height in the result would belong
  // to a typeface the game does not ship. `45 characters of measure` is a JetBrains Mono
  // fact or it is not a fact at all.
  const fonts = await win.webContents.executeJavaScript(
    `Promise.all([
       document.fonts.load('400 15px "JetBrains Mono"'),
       document.fonts.load('500 15px "JetBrains Mono"'),
       document.fonts.load('700 15px "JetBrains Mono"'),
       document.fonts.load('italic 400 15px "JetBrains Mono"'),
     ]).then(() => document.fonts.ready).then((set) => set.size)`,
  );
  if (fonts < 1) fail('no bundled face loaded — every measurement would be the fallback font’s');
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

  const paint = await paintPass(win, scenarios);
  win.destroy();
  const fade = await fadePass();
  return { groups: out, paint, fade };
}

/**
 * THE PAINT PASS (`floor-looks`) — every scenario on every floor, and floor 2 again under high
 * contrast, at the size the game opens at and the default text size. Colour does not depend on
 * the window size, so one size is enough; the floors are what vary. Each run carries the in-page
 * paint audit (`paint`), which reads every glyph against the surface the real cascade put under it.
 */
const PAINT_FLOORS = [
  { place: 0, contrast: 'normal' },
  { place: 1, contrast: 'normal' },
  { place: 2, contrast: 'normal' },
  { place: 3, contrast: 'normal' },
  { place: 4, contrast: 'normal' },
  { place: 1, contrast: 'high' },
];

async function paintPass(win, scenarios) {
  await resize(win, 1100, 820);
  const reports = [];
  for (const scenario of scenarios) {
    for (const { place, contrast } of PAINT_FLOORS) {
      reports.push(
        await win.webContents.executeJavaScript(
          `window.__voidLayoutProbe.run(${JSON.stringify({ scenario, scale: 'normal', place, contrast, audit: true })})`,
        ),
      );
    }
  }
  return reports;
}

/**
 * THE FADE PASS (`floor-looks`) — floor 1 to floor 2, the white-out, sampled while it happens.
 *
 * The page applies floor 2 through the real appliers and reads the body's ground AT ONCE (t = 0),
 * then again half-way through the dissolve and once it should be over. Judged in player terms by
 * the test: dark at first, in between at the midpoint, white at the end — under normal motion AND
 * under reduced motion (a dissolve moves nothing; it is what removes the one-frame white-out),
 * and black at every sample under high contrast.
 *
 * THE CLOCK LIVES HERE, not in the driver: `exclusion.test.ts` keeps `src/dev` free of clocks, and
 * a fade cannot be measured without one. Each sample carries the time it was really taken, so a
 * starved timer is visible in the result rather than silently moving the goalposts — and the state
 * of the dissolve itself (`phase`: whether the transition on `--void-bg` exists, has started, and
 * how far in it is), so a late start is visible too.
 *
 * ⚠ IT RUNS IN AN OFFSCREEN WINDOW, and a measurement is why. A CSS transition does not START
 * until the first frame after it is created, and a window that is never shown produces a frame
 * about every 0.75 s (see the header). Measured in the phase-A window: the dissolve sat `pending`,
 * start time null, for the first 611 ms, so the "midpoint" sample read floor 1's black while the
 * interpolation itself was fine (it was caught at rgb(48, 52, 51) and rgb(174, 176, 179) on other
 * samples). A player's window is shown and produces a frame every ~17 ms. Electron's OFFSCREEN
 * rendering produces frames at a real 60 Hz without the window ever appearing on screen, so the
 * dissolve is sampled on the cadence a player's window gives it — and nothing pops up on the
 * machine running the tests.
 */
const FADE_RUNS = [
  { motion: 'full', contrast: 'normal' },
  { motion: 'reduce', contrast: 'normal' },
  { motion: 'full', contrast: 'high' },
];

async function fadePass() {
  const win = watch(
    new BrowserWindow({
      show: false,
      useContentSize: true,
      width: 1100,
      height: 820,
      webPreferences: { offscreen: true, contextIsolation: true, sandbox: false, backgroundThrottling: false },
    }),
  );
  win.webContents.setFrameRate(60);
  await win.loadFile(path.join(DIST, 'probe.html'));
  const ready = await win.webContents.executeJavaScript('typeof window.__voidLayoutProbe === "object"');
  if (!ready) fail('the probe driver did not install itself on the fade page');
  // A real screen under the dissolve — the hub, with its prose, log, menu and scenery frame — so
  // every frame of the fade restyles what a player's descent really restyles.
  await win.webContents.executeJavaScript(`window.__voidLayoutProbe.run(${JSON.stringify({ scenario: 'hub', scale: 'normal' })})`);

  // A DEADLINE ON EACH FADE, kept by the MAIN process. One fade is ~1.35 s of page timers; a page
  // that stopped running them (a window the OS stopped scheduling) would otherwise hold the whole
  // probe open until the test's 180 s ceiling — or indefinitely when run by hand. Main-process
  // timers are not the page's, so this fires even when the page's never do.
  const FADE_DEADLINE_MS = 15_000;
  const withDeadline = (promise, options) =>
    Promise.race([
      promise,
      new Promise((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`the ${JSON.stringify(options)} fade did not finish within ${FADE_DEADLINE_MS} ms`)),
          FADE_DEADLINE_MS,
        ),
      ),
    ]);

  const runs = [];
  for (const options of FADE_RUNS) {
    runs.push(
      await withDeadline(win.webContents.executeJavaScript(
        `new Promise((resolve) => {
           const probe = window.__voidLayoutProbe;
           const options = ${JSON.stringify(options)};
           const from = probe.fadeFrom(options);
           const start = performance.now();
           const origin = document.timeline.currentTime;
           // The dissolve of the ground itself, as Chromium runs it. Diagnostic: the test judges
           // the COLOUR; this says why, if the colour is wrong.
           const phase = () => {
             const fade = document.getAnimations().find((a) => a.transitionProperty === '--void-bg');
             if (!fade) return { exists: false, pending: false, startLag: null, progress: null };
             return {
               exists: true,
               pending: fade.pending,
               startLag: fade.startTime === null ? null : fade.startTime - origin,
               progress: fade.currentTime,
             };
           };
           const samples = [{ at: 0, background: probe.fadeTo(options), phase: phase() }];
           const take = () => samples.push({ at: performance.now() - start, background: probe.bodyBackground(), phase: phase() });
           setTimeout(() => {
             take();
             setTimeout(() => {
               take();
               probe.fadeEnd();
               resolve({ options, fadeMs: probe.fadeMs, from, samples });
             }, Math.max(0, probe.fadeMs + 150 - (performance.now() - start)));
           }, probe.fadeMs / 2);
         })`,
      ), options).catch((err) => fail(String(err && err.message ? err.message : err))),
    );
  }
  win.destroy();
  return runs;
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

/**
 * PHASE C -- THE REAL RENDERER, BOOTED AND WALKED.
 *
 * Phase A measures pages the PROBE assembles. This one measures the page the GAME assembles:
 * `dist/desktop.html` with a stub IPC bridge, the real `src/desktop/game.ts` running, and a
 * click walk from the content warning to the abandon confirmation. It is the other end of
 * every coupling phase A can only mirror -- the hub menu's wrapper, the reserved region's
 * mounting and clearing, the settings path that moves the prose floor -- and it is also where
 * the renderer's OWN log output is collected, so its instrumentation can be asserted rather
 * than assumed.
 *
 * At the DEFAULT window size, deliberately: this is the size a player actually opens.
 */
async function phaseC() {
  const logs = [];
  const collect = (_event, entry) => logs.push(entry);
  ipcMain.on('probe:log', collect);

  const win = watch(
    new BrowserWindow({
      show: false,
      useContentSize: true,
      width: 1100,
      height: 820,
      webPreferences: {
        preload: path.join(HERE, 'layout-probe-preload.cjs'),
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
      },
    }),
  );
  await win.loadFile(path.join(DIST, 'desktop.html'));
  await resize(win, 1100, 820);

  const walk = fs.readFileSync(path.join(HERE, 'layout-probe-walk.js'), 'utf8');
  let result;
  try {
    result = await win.webContents.executeJavaScript(walk, true);
  } catch (err) {
    fail(`the real-boot walk failed: ${String(err && err.message ? err.message : err)}`);
  }
  ipcMain.removeListener('probe:log', collect);
  win.destroy();
  return { ...result, logs };
}

app.whenReady().then(async () => {
  try {
    const a = await phaseA();
    const result = {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      phaseA: a.groups,
      paint: a.paint,
      fade: a.fade,
      minWindow: phaseB(),
      phaseC: await phaseC(),
    };
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    app.exit(0);
  } catch (err) {
    process.stderr.write(String(err && err.stack ? err.stack : err));
    process.stderr.write('\n');
    app.exit(1);
  }
});
