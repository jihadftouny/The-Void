// Electron-main file logger — the SESSION LOG. Writes everything (main-process events
// AND the renderer entries forwarded over IPC) to one file on disk, so a run can be
// debugged after the fact and a player's bug report can be a file rather than a memory.
//
// ---------------------------------------------------------------------------------------
// WHY THE DIRECTORY IS INJECTED — FINDINGS.md G6, and it is worse than "misplaced".
//
// This module used to build its directory from `__dirname` at MODULE SCOPE:
//
//     const LOG_DIR = path.join(__dirname, '..', 'logs');
//
// `electron-builder` packs `electron/**` INTO THE ASAR ARCHIVE. So in a packaged build
// that path is `…/resources/app.asar/logs`, `mkdirSync` throws inside a read-only
// archive, the `catch` sets `stream = null`, and EVERY `fileLog` call becomes a silent
// no-op — while `main.mjs` still prints "logging to <path>" so it looks fine. The shipped
// game therefore had no crash diagnostics at all, and it survived nine review rounds
// precisely because in DEV `__dirname` is the real repo folder and everything works.
//
// The fix is the one `model-path.mjs` already establishes: no path is derived at module
// scope. `configureLogDir(dir)` is called from `app.whenReady()` with
// `app.getPath('userData')`, which is writable in every build. Until then the default is
// a temp directory — and because `ensureStream()` is LAZY that directory is normally
// never created. It exists only so an `uncaughtException` fired in the milliseconds
// before `ready` still lands somewhere writable rather than nowhere.
//
// ---------------------------------------------------------------------------------------
// WHY IT IS CAPPED AND ROTATES. The old file appended forever. A log with no ceiling is a
// disk-filling bug waiting for the one player who leaves the game open for a week.
// `LOG_CAP_BYTES` (4 MiB) and EXACTLY TWO files give a hard ~8 MiB ceiling. Two, and not
// per-session files with a reaper, because the engineer's ask is "send us what happened":
// `void.log` covers *it just happened* and `void.log.1` covers *it happened last time*,
// which is exactly the two cases. More files is more filesystem code for the same
// information.
//
// WHY IT IS NOT SYNCHRONOUS. `fs.createWriteStream` is buffered and async. Nothing on the
// hot path may be `appendFileSync`/`writeFileSync` — a log call happens once per token
// stream and once per engine step, and a synchronous write would make the instrument the
// thing that needs instrumenting.
//
// WHY EVERY LAUNCH WRITES A BANNER. All worktrees share one user-data log now, so `cwd`
// is what keeps two sessions of two checkouts apart; `pid`, the app version and the
// platform are what make a mailed-in file self-describing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Hard ceiling per file. Two files exist at most, so the total is ~8 MiB. */
export const LOG_CAP_BYTES = 4 * 1024 * 1024;

/**
 * The longest a single `data` payload may serialize to. Fits a full stack trace and is
 * nowhere near a serialized `GameState`, so an accidental `log('debug','engine','state',
 * state)` can never write megabytes per step.
 */
export const DATA_MAX_CHARS = 2000;

/** The four level names, for validating an override. */
const LEVELS = ['debug', 'info', 'warn', 'error'];

// ---- module state: all of it reset by `configureLogDir` ----------------------------
let logDir = path.join(os.tmpdir(), 'the-void-logs');
let capBytes = LOG_CAP_BYTES;
let session = defaultSession();
let stream = null;
let bytesWritten = 0;
let rotating = false;
let queued = [];

function defaultSession() {
  return {
    pid: process.pid,
    cwd: process.cwd(),
    version: process.env.npm_package_version ?? 'unknown',
    platform: `${process.platform}-${process.arch}`,
  };
}

/** The absolute path of the current log file. Replaces the old `LOG_FILE` constant. */
export function logFilePath() {
  return path.join(logDir, 'void.log');
}

/** The previous session's file — the second and last of the two the cap allows. */
export function rotatedFilePath() {
  return logFilePath() + '.1';
}

/**
 * Point the log at `dir` (create it lazily on the first write). Closes any open stream
 * and resets the byte counter, so calling it twice cannot leave a stale handle behind.
 *
 * `opts.capBytes` and `opts.session` exist so the rotation policy can be exercised in a
 * test at a small cap with a fixed banner, rather than by writing four megabytes.
 */
export function configureLogDir(dir, opts = {}) {
  const old = stream;
  stream = null;
  rotating = false;
  queued = [];
  bytesWritten = 0;
  if (old) {
    try {
      old.end();
    } catch {
      /* a dying stream must never take the app with it */
    }
  }
  logDir = dir;
  capBytes = Number.isFinite(opts.capBytes) && opts.capBytes > 0 ? opts.capBytes : LOG_CAP_BYTES;
  session = { ...defaultSession(), ...(opts.session ?? {}) };
  return logFilePath();
}

/**
 * The main process's log level. A VALID `VOID_LOG_LEVEL` wins; otherwise a dev run
 * (a Vite dev server URL is set) is `debug` and a packaged run is `info`. Mirrors the
 * renderer's `src/log/level.ts` — the two sides share a CONTRACT, not a module, because
 * the main process runs raw ESM with no TypeScript step.
 */
export function resolveMainLogLevel({ env = {}, dev = false } = {}) {
  const override = env.VOID_LOG_LEVEL;
  if (typeof override === 'string' && LEVELS.includes(override)) return override;
  return dev ? 'debug' : 'info';
}

/** True when `level` is at or above `minLevel`. Both must be one of the four names. */
export function passesLevel(level, minLevel) {
  const a = LEVELS.indexOf(level);
  const b = LEVELS.indexOf(minLevel);
  if (a < 0) return true; // an unknown level is never silently dropped
  if (b < 0) return true;
  return a >= b;
}

/**
 * Serialize a payload, capped. Returns `{json, truncated}`; never throws, whatever the
 * value is (a circular object, a BigInt, a function).
 */
export function truncateData(value, maxChars = DATA_MAX_CHARS) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return { json: '[unserializable data]', truncated: false };
  }
  if (json === undefined) return { json: '[unserializable data]', truncated: false };
  if (json.length <= maxChars) return { json, truncated: false };
  return { json: json.slice(0, maxChars) + '…[truncated]', truncated: true };
}

/**
 * One log line, exactly — PURE. No clock, no filesystem, so it can be asserted
 * character for character.
 *
 * A NON-FINITE `time` renders as the epoch rather than being replaced with `Date.now()`.
 * The old code substituted the wall clock, which made this function impure AND made a
 * broken timestamp indistinguishable from a real one. The epoch is obviously wrong on
 * sight, which is what a bad timestamp should look like.
 */
export function formatLogLine(entry) {
  const time = Number.isFinite(entry?.time) ? entry.time : 0;
  const t = new Date(time).toISOString();
  const level = String(entry?.level ?? 'info').toUpperCase();
  const base = `${t} ${level} [${entry?.category ?? '?'}] ${entry?.message ?? ''}`;
  if (entry?.data === undefined) return base;
  return `${base} ${truncateData(entry.data, DATA_MAX_CHARS).json}`;
}

/** The one line that identifies a launch. PURE — the caller supplies the time. */
export function sessionBanner(info = {}) {
  const time = Number.isFinite(info.time) ? info.time : 0;
  return (
    `=== session ${new Date(time).toISOString()}` +
    ` pid=${info.pid ?? '?'}` +
    ` version=${info.version ?? '?'}` +
    ` platform=${info.platform ?? '?'}` +
    ` cwd=${info.cwd ?? '?'} ===`
  );
}

/**
 * Should the file be rotated before `incomingBytes` are appended? PURE.
 *
 * The `bytesInFile > 0` guard is load-bearing, not defensive: without it a single line
 * longer than the cap would rotate an empty file forever and never be written at all.
 * One over-long line is allowed to overshoot the cap; that is the bound `log.test.mjs`
 * derives its ceiling from.
 */
export function shouldRotate(bytesInFile, incomingBytes, capBytesArg) {
  if (!(bytesInFile > 0)) return false;
  return bytesInFile + incomingBytes > capBytesArg;
}

/** Rename `void.log` to `void.log.1`, replacing any previous one. Best-effort. */
function renameCurrent() {
  try {
    fs.rmSync(rotatedFilePath(), { force: true });
    if (fs.existsSync(logFilePath())) fs.renameSync(logFilePath(), rotatedFilePath());
  } catch {
    /* if the rename fails we keep appending rather than losing the log entirely */
  }
}

/**
 * Open the stream if it is not open, rotating first if the file on disk is already at or
 * over the cap (the previous session's file), and write this launch's banner.
 */
function ensureStream() {
  if (stream) return stream;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    let size = 0;
    try {
      size = fs.statSync(logFilePath()).size;
    } catch {
      size = 0;
    }
    if (size >= capBytes) {
      renameCurrent();
      size = 0;
    }
    stream = fs.createWriteStream(logFilePath(), { flags: 'a' });
    bytesWritten = size;
    const banner = sessionBanner({ ...session, time: Date.now() }) + '\n';
    stream.write(banner);
    bytesWritten += Buffer.byteLength(banner);
  } catch {
    stream = null; // logging must never crash the app
  }
  return stream;
}

/**
 * Close the current stream, rename it aside, and reopen — asynchronously, because the
 * file descriptor must actually be closed before the rename (on Windows a rename with an
 * open handle fails outright). Lines that arrive mid-rotation are queued, not dropped.
 */
function beginRotate() {
  rotating = true;
  const old = stream;
  stream = null;
  const finish = () => {
    renameCurrent();
    bytesWritten = 0;
    rotating = false;
    const pending = queued;
    queued = [];
    for (const line of pending) writeLine(line);
  };
  if (!old) {
    finish();
    return;
  }
  old.on('close', finish);
  old.on('error', finish);
  try {
    old.end();
  } catch {
    finish();
  }
}

/** The one place bytes reach the file. Rotates first when the cap would be crossed. */
function writeLine(line) {
  if (rotating) {
    // Bounded so a pathological burst during a rotation cannot grow without limit.
    if (queued.length < 5000) queued.push(line);
    return;
  }
  const size = Buffer.byteLength(line);
  if (!ensureStream()) return;
  if (shouldRotate(bytesWritten, size, capBytes)) {
    queued.push(line);
    beginRotate();
    return;
  }
  try {
    stream.write(line);
    bytesWritten += size;
  } catch {
    /* ignore write failures */
  }
}

/** Append one log entry (shape: {time?, level?, category?, message?, data?}). */
export function fileLog(entry) {
  writeLine(formatLogLine(entry) + '\n');
}

/**
 * Resolve once no rotation is in flight and the stream has accepted everything queued.
 * Exists for tests and for an orderly shutdown; nothing on the hot path awaits it.
 */
export async function flushLog() {
  for (let i = 0; i < 2000 && rotating; i++) {
    await new Promise((r) => setTimeout(r, 2));
  }
  const s = stream;
  if (!s) return;
  await new Promise((resolve) => {
    try {
      s.write('', () => resolve());
    } catch {
      resolve();
    }
  });
}

/** Flush, then close. Safe to call when nothing is open. */
export async function closeLog() {
  await flushLog();
  const s = stream;
  stream = null;
  if (!s) return;
  await new Promise((resolve) => {
    s.on('close', resolve);
    s.on('error', resolve);
    try {
      s.end();
    } catch {
      resolve();
    }
  });
}
