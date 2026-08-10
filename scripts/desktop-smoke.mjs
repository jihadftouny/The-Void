// Headless-ish smoke test: run Electron in SMOKE mode (no window) so it loads
// the model via node-llama-cpp inside Electron's runtime, streams one
// generation, prints tokens/sec, and quits. Verifies the native-module + ABI
// path without a human watching a window. Exits with Electron's code.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VOID_SMOKE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 1));
