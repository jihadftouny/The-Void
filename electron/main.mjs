// Electron main process — creates the window and bridges the renderer to the
// main-process narrator (node-llama-cpp). ESM entry (Electron 28+).
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createNarrator } from './llm.mjs';
import { fileLog, LOG_FILE } from './log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL; // set by scripts/desktop-dev.mjs
const SMOKE = process.env.VOID_SMOKE === '1'; // headless verify path

let win = null;
let narrator = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Main-process logging → console + the shared log file.
function mlog(level, category, message, data) {
  fileLog({ time: Date.now(), level, category, message, ...(data !== undefined ? { data } : {}) });
}
process.on('uncaughtException', (err) =>
  mlog('error', 'electron', 'uncaughtException', { message: String(err?.message ?? err), stack: err?.stack }),
);
process.on('unhandledRejection', (reason) =>
  mlog('error', 'electron', 'unhandledRejection', { reason: String(reason) }),
);

async function ensureNarrator(onStatus) {
  if (!narrator) narrator = await createNarrator({ onStatus });
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
    (n) => send('llm:status', { phase: 'ready', gpu: n.gpu }),
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
  mlog('info', 'electron', 'app booted');
  console.log(`[void] logging to ${LOG_FILE}`);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
