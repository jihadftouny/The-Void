// Electron main process — creates the window and bridges the renderer to the
// main-process narrator (node-llama-cpp). ESM entry (Electron 28+).
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createNarrator } from './llm.mjs';
import { createNarratorGate } from './narrator-gate.mjs';
import { THRESHOLDS } from './instrument.mjs';
import { resolveModelDir, filesToMigrate } from './model-path.mjs';
import {
  fileLog,
  configureLogDir,
  logFilePath,
  resolveMainLogLevel,
  passesLevel,
  LOG_CAP_BYTES,
} from './log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL; // set by scripts/desktop-dev.mjs
const SMOKE = process.env.VOID_SMOKE === '1'; // headless verify path
const BOOT_MS = Date.now();

let win = null;

// The main process's own level. `debug` under the dev launcher, `info` in a packaged
// build, overridable with VOID_LOG_LEVEL. Resolved at module scope because the very first
// thing that can fail (an uncaughtException before `ready`) must already be filtered.
const LOG_LEVEL = resolveMainLogLevel({ env: process.env, dev: !!DEV_URL });

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Main-process logging → the shared log file. NEVER interpolate a measurement into
// `message`: numbers go in `data`, so `grep '"ms":'` over a log always works.
function mlog(level, category, message, data) {
  if (!passesLevel(level, LOG_LEVEL)) return;
  fileLog({ time: Date.now(), level, category, message, ...(data !== undefined ? { data } : {}) });
}
process.on('uncaughtException', (err) =>
  mlog('error', 'electron', 'uncaughtException', {
    message: String(err?.message ?? err),
    stack: err?.stack,
    uptimeMs: Date.now() - BOOT_MS,
  }),
);
process.on('unhandledRejection', (reason) =>
  mlog('error', 'electron', 'unhandledRejection', {
    reason: String(reason),
    uptimeMs: Date.now() - BOOT_MS,
  }),
);

// Resolve (and prepare) the single per-user models directory. Must run after
// `app` is ready so `app.getPath('userData')` is valid. Best-effort migration
// of any legacy CWD-relative `./models/*.gguf` into the canonical dir keeps
// existing dev machines (and old worktrees) from re-downloading — a same-drive
// rename is instant and preserves the basename so `resolveModelFile` finds it.
// The whole migration is wrapped so a failure NEVER crashes startup: on any
// error we log and fall through to a normal download into the canonical dir.
function resolveModelsDir() {
  const modelsDir = resolveModelDir({ env: process.env, userDataDir: app.getPath('userData') });
  fs.mkdirSync(modelsDir, { recursive: true });

  try {
    const legacyDir = path.join(process.cwd(), 'models');
    if (legacyDir !== modelsDir && fs.existsSync(legacyDir)) {
      const legacyList = fs.readdirSync(legacyDir);
      const canonicalList = fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir) : [];
      for (const f of filesToMigrate(legacyList, canonicalList)) {
        fs.renameSync(path.join(legacyDir, f), path.join(modelsDir, f));
        mlog('info', 'llm', 'model migrated', { file: f, from: legacyDir, to: modelsDir });
      }
    }
  } catch (err) {
    mlog('warn', 'llm', 'model migration skipped', { message: String(err?.message ?? err) });
  }

  mlog('info', 'llm', 'models dir', { modelsDir });
  return modelsDir;
}

// G37 — the narrator is memoised as a PROMISE, not as a resolved value.
//
// This used to be `if (!narrator) { narrator = await createNarrator(...) }`, which assigns
// only AFTER the await, so the guard was blind to an in-flight load: `createWindow` fires
// it un-awaited at boot, the renderer's first `llm:generate` fires it again a few clicks
// later, both see `null`, and a SECOND complete load starts — a second 2.5 GB
// resolve/download, a second set of GPU probes at 30 s each, a second `loadModel`. The
// renderer holds `busy = true` across the whole dispatch, so every input is dead until it
// returns. That is the freeze this unit exists for.
//
// The gate lives in its own module because `main.mjs` imports `electron` at module scope
// and can never be imported by a test; `narrator-gate.test.mjs` proves the fix under
// GENUINE CONCURRENCY (two callers racing before the first resolves construct exactly
// once), which is the only shape that can tell the fix from the defect.
const narratorGate = createNarratorGate({
  create: (onStatus) => createNarrator({ onStatus, modelsDir: resolveModelsDir(), log: mlog }),
  log: mlog,
});

function ensureNarrator(trigger, onStatus) {
  return narratorGate.ensure(trigger, onStatus);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    // THE MINIMUM WINDOW SIZE — 960x640 (docs/UI-DESIGN.md §14, number chosen 2026-09-07).
    // §14 decided that a minimum must exist and no number was ever picked, so "the layout's
    // design target" was a target nothing enforced and nothing was designed against. This is
    // that number, and the layout is built to it: below this the HUD column, the narration,
    // the combat log and the choice column stop being able to coexist. Enforcing it in the
    // window means the unusable sizes simply cannot be reached by dragging.
    minWidth: 960,
    minHeight: 640,
    // ⭐ AND 960x640 IS THE SIZE THE PAGE GETS — which, until 2026-09-09, it was not.
    //
    // Without this flag every size above is the OUTER WINDOW: the frame and the default menu
    // bar come out of the page's share before the stylesheet sees a pixel. Measured on this
    // machine, in this Electron: the identical window without `useContentSize` hands the page
    // 947x577. So the documented promise — "960x640 is the size every layout must survive" —
    // was false by 13x63 px, and every layout budget computed against it was computed against
    // a number the renderer never received. With the flag, `getContentSize()` reports exactly
    // [960, 640] and still does after the window is squeezed as small as it will go.
    //
    // The opening 1100x820 becomes a CONTENT size too, so the window is a little larger than
    // it was. ⚠ Noted for docs/PLAN.md #14 / N5, which owns the initial size and remembered
    // bounds: on a 1366x768 laptop the default window already exceeded the work area, and
    // this makes it exceed it by more. Clamping to the work area is N5's decided-and-unbuilt
    // item, deliberately not smuggled in here.
    //
    // `src/dev/layoutProbe.test.ts` proves all three halves of this in a real Electron: that
    // the option holds the content box at the minimum, that WITHOUT it the page gets less,
    // and that this file really passes it inside the same literal that carries the minimum.
    useContentSize: true,
    backgroundColor: '#0a0a0c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The window load is timed because it is the FIRST thing that can hang, and because a
  // slow one is G41's symptom exactly: `loadURL` against a LOCAL dev server should be
  // instant, so seconds mean the URL is wrong or the server on that port is not ours.
  const windowT0 = Date.now();
  const mode = DEV_URL ? 'dev' : 'file';
  const url = DEV_URL
    ? new URL('desktop.html', DEV_URL).href
    : path.join(__dirname, '..', 'dist', 'desktop.html');
  if (DEV_URL) await win.loadURL(url);
  else await win.loadFile(url);
  const windowMs = Date.now() - windowT0;
  mlog(windowMs >= THRESHOLDS.windowLoad ? 'warn' : 'info', 'electron', 'window loaded', {
    ms: windowMs,
    mode,
    url,
  });

  // Load the model after the window exists; stream progress to the renderer.
  ensureNarrator('boot', (s) => {
    send('llm:status', s);
    mlog('info', 'llm', 'status', s);
  }).then(
    (n) => {
      send('llm:status', {
        phase: 'ready',
        gpu: n.gpu,
        device: n.device,
        unified: n.unified,
        vram: n.vram,
        deviceIndex: n.deviceIndex,
      });
      // Record the final device choice so any machine's selection is in the log.
      mlog('info', 'llm', 'gpu:selected', {
        backend: n.gpu,
        device: n.device,
        unified: n.unified,
        vram: n.vram,
      });
    },
    (err) => send('llm:status', { phase: 'error', message: String(err?.message ?? err) }),
  );
}

// Renderer asks to generate; we stream tokens back per-request and return stats.
ipcMain.handle('llm:generate', async (event, { requestId, prompt, system }) => {
  const t0 = Date.now();
  // Read BEFORE the await: `false` here means this request is about to WAIT for a model
  // load it did not start, and `waitedMs` below is that wait in milliseconds. That number
  // IS the freeze, and nothing recorded it before.
  const wasReady = narratorGate.isReady();
  try {
    const n = await ensureNarrator('generate', (s) => send('llm:status', s));
    if (!wasReady) {
      mlog('warn', 'llm', 'generate: waiting for narrator', { requestId, waitedMs: Date.now() - t0 });
    }
    const result = await n.generate({
      requestId,
      prompt,
      system,
      onToken: (chunk) => event.sender.send('llm:token', { requestId, chunk }),
    });
    return result;
  } catch (err) {
    // The renderer only ever receives a serialized message across IPC, so without this
    // the main-side cause — and the stack — is lost entirely.
    mlog('error', 'llm', 'generate: FAILED (main)', {
      requestId,
      ms: Date.now() - t0,
      message: String(err?.message ?? err),
      stack: String(err?.stack ?? ''),
    });
    throw err;
  }
});

// Renderer forwards its log entries here so everything lands in one file.
ipcMain.on('log:entry', (_e, entry) => fileLog(entry));

app.whenReady().then(async () => {
  // FIRST, before anything else can want to log. G6: the log directory MUST come from
  // `app.getPath('userData')` — a path derived from `__dirname` lands inside the asar in a
  // packaged build, where `mkdirSync` throws and every log call becomes a silent no-op.
  // This is also why it sits above the SMOKE branch: a smoke run that fails is exactly a
  // run whose log we need.
  const logDir = path.join(app.getPath('userData'), 'logs');
  const logFile = configureLogDir(logDir, { session: { version: app.getVersion() } });
  mlog('info', 'electron', 'log configured', {
    dir: logDir,
    file: logFile,
    capBytes: LOG_CAP_BYTES,
    level: LOG_LEVEL,
  });
  console.log(`[void] logging to ${logFilePath()}`);

  if (SMOKE) {
    // Verify node-llama-cpp loads and runs INSIDE Electron's runtime (the ABI
    // risk) with no window, then quit — automatable without a human watching.
    try {
      const n = await ensureNarrator('boot', (s) => console.log('[status]', JSON.stringify(s)));
      const r = await n.generate({
        prompt: 'In two sentences, describe stepping onto the First Floor of the Void.',
        onToken: (c) => process.stdout.write(c),
      });
      console.log(
        `\n[SMOKE OK] gpu=${n.gpu} ${r.tokens} tok @ ${r.tokensPerSecond.toFixed(1)} tok/s, ttft ${r.ttftMs.toFixed(0)}ms`,
      );
      app.exit(0);
    } catch (err) {
      console.error('[SMOKE FAIL]', err);
      app.exit(1);
    }
    return;
  }

  await createWindow();
  mlog('info', 'electron', 'app booted', {
    bootMs: Date.now() - BOOT_MS,
    dev: !!DEV_URL,
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    cwd: process.cwd(),
    level: LOG_LEVEL,
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
