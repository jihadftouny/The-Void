// Dev launcher: start the Vite dev server, wait for it, then launch Electron
// pointed at it (so the shell gets HMR). Kills Vite when Electron exits.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const PORT = 5173;
const URL = `http://localhost:${PORT}/`;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const vite = spawn(npx, ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(URL + 'desktop.html');
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Vite dev server did not start in time');
}

await waitForServer();

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: URL },
});

const cleanup = () => {
  vite.kill();
  electron.kill();
};
electron.on('exit', () => {
  vite.kill();
  process.exit(0);
});
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
