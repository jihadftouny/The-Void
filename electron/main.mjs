// Electron main process — creates the window and bridges the renderer to the
// main-process narrator (node-llama-cpp). ESM entry (Electron 28+).
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createNarrator } from './llm.mjs';
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

async function ensureNarrator(onStatus) {
  if (!narrator) {
    const modelsDir = resolveModelsDir();
    narrator = await createNarrator({ onStatus, modelsDir });
  }
  return narrator;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    backgroundColor: '#0a0a0c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV_URL) await win.loadURL(new URL('desktop.html', DEV_URL).href);
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'desktop.html'));

  // Load the model after the window exists; stream progress to the renderer.
  ensureNarrator((s) => {
    send('llm:status', s);
    mlog('info', 'llm', `status:${s.phase}`, s);
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
  const n = await ensureNarrator((s) => send('llm:status', s));
  mlog('debug', 'llm', 'generate:request', { requestId, promptChars: (prompt ?? '').length });
  const result = await n.generate({
    prompt,
    system,
    onToken: (chunk) => event.sender.send('llm:token', { requestId, chunk }),
  });
  mlog('info', 'llm', 'generate:done', {
    requestId,
    tokens: result.tokens,
    tokPerSec: Math.round(result.tokensPerSecond),
  });
  return result;
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
      const n = await ensureNarrator((s) => console.log('[status]', JSON.stringify(s)));
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
