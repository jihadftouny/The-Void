// Dev launcher — FINDINGS.md G41.
//
// The old script spawned Vite through `npx` with `shell: true`, waited for ANY server to
// answer port 5173, and pointed Electron at it. On Windows that made the real Vite a
// GRANDCHILD, so `kill()` never reached it and the port stayed held; and the readiness
// poll happily accepted the orphan, so every play-test after a quit silently served the
// PREVIOUS session's code.
//
// This version removes the failure class rather than improving the kill:
//   * Vite runs IN THIS PROCESS (its Node API), so there is no child to orphan and the OS
//     releases the port whenever this process dies — clean quit, crash, Ctrl+C, or
//     `taskkill /F`.
//   * The URL comes from the server object we created. There is NO readiness poll and no
//     `fetch` of the dev URL anywhere in this file, so no code path can attach to a server
//     we did not start.
//   * An occupied port is proven and reclaimed, or refused loudly with the PID and a
//     copy-pasteable command. Never joined.
//
// The pure decisions live in `scripts/dev-server.mjs` and are unit-tested — the same
// pure/impure split `electron/gpu.mjs` already uses.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';
import {
  PORT,
  looksLikeViteDevServer,
  reclaimDecision,
  describePortConflict,
  isPortInUse,
  listListeningPids,
  probeVite,
} from './dev-server.mjs';

const ROOT = process.cwd();

/** Start Vite inside this process, bound to PORT, failing rather than drifting. */
async function listen() {
  const server = await createServer({ server: { port: PORT, strictPort: true } });
  await server.listen();
  return server;
}

/** Wait for the port to be released after a kill; resolves false if it never is. */
async function waitForPortFree(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if ((await listListeningPids(PORT)).length === 0) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function start() {
  try {
    return await listen();
  } catch (err) {
    if (!isPortInUse(err, PORT)) throw err;

    // The port is taken. Find out by WHAT, and by how many.
    const probe = await probeVite(PORT);
    const isVite = looksLikeViteDevServer(probe);
    const pids = await listListeningPids(PORT);
    const decision = reclaimDecision({ occupied: true, isVite, pids });

    if (decision === 'abort') {
      console.error(describePortConflict({ port: PORT, pids }));
      process.exit(1);
    }

    const [pid] = pids;
    console.warn(
      `[void] port ${PORT} is held by a stale Vite dev server (pid ${pid}) — reclaiming it. ` +
        'This is G41: without it, the game would run against the previous session\'s code.',
    );
    try {
      process.kill(pid);
    } catch (killErr) {
      console.error(`[void] could not stop pid ${pid}: ${String(killErr?.message ?? killErr)}`);
      console.error(describePortConflict({ port: PORT, pids }));
      process.exit(1);
    }
    if (!(await waitForPortFree())) {
      console.error(describePortConflict({ port: PORT, pids }));
      process.exit(1);
    }
    return listen();
  }
}

const server = await start();

// The URL is taken from the server WE created — never discovered by asking the port.
const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${PORT}/`;
console.log(`[void] serving ${ROOT}`);
console.log(`[void] dev server ${url}`);

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    electron.kill();
  } catch {
    /* already gone */
  }
  try {
    await server.close();
  } catch {
    /* closing a dead server is fine */
  }
  process.exit(code);
}

electron.on('exit', (code) => void shutdown(code ?? 0));
electron.on('error', (err) => {
  console.error('[void] Electron failed to start:', err);
  void shutdown(1);
});
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('uncaughtException', (err) => {
  console.error('[void] launcher crashed:', err);
  void shutdown(1);
});
