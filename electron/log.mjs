// Electron-main file logger — writes ALL logs (main-process events AND the
// renderer entries forwarded over IPC) to a single file on disk, so a run can be
// debugged after the fact or the log shared. Appends; marks each launch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'void.log');

let stream = null;

function ensureStream() {
  if (stream) return stream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    stream.write(`\n=== session ${new Date().toISOString()} ===\n`);
  } catch {
    stream = null; // logging must never crash the app
  }
  return stream;
}

/** Append one log entry (shape: {time?, level?, category?, message?, data?}). */
export function fileLog(entry) {
  const s = ensureStream();
  if (!s) return;
  const time = typeof entry?.time === 'number' ? entry.time : Date.now();
  const t = new Date(time).toISOString();
  const level = String(entry?.level ?? 'info').toUpperCase();
  let line = `${t} ${level} [${entry?.category ?? '?'}] ${entry?.message ?? ''}`;
  if (entry?.data !== undefined) {
    try {
      line += ' ' + JSON.stringify(entry.data);
    } catch {
      line += ' [unserializable data]';
    }
  }
  try {
    s.write(line + '\n');
  } catch {
    /* ignore write failures */
  }
}
