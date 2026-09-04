// The PURE decisions behind `scripts/desktop-dev.mjs` — FINDINGS.md G41.
//
// ---------------------------------------------------------------------------------------
// THE DEFECT. `npm run desktop` spawned Vite through `npx` with `shell: true`, so on
// Windows the direct child is `cmd.exe` → `npx.cmd` → `node vite`. `ChildProcess.kill()`
// is a `TerminateProcess` against THAT ONE HANDLE, and there is no job object, so the
// grandchild is orphaned and keeps port 5173. On the next launch the new Vite exits code 1
// (`--strictPort`, port in use) — but `waitForServer()` POLLS THE URL and succeeds against
// the orphan, so Electron starts and the game runs against the PREVIOUS SESSION'S DEV
// SERVER. Quit the game once and every later `npm run desktop` serves the code from your
// first session: edits appear not to take effect, and the terminal error looks unrelated.
//
// THE REGISTER'S RECORDED FIX IS CORRECT BUT NOT SUFFICIENT — a departure, recorded.
// It says: "drop the shell wrapper — spawn `process.execPath` against
// `node_modules/vite/bin/vite.js` so `kill()` hits Vite itself". That fixes the CLEAN-QUIT
// path and nothing else. It leaves `waitForServer()` in place, so an orphan from before
// the fix (or from any other tool) is still silently joined; it leaves `vite.on('exit')`
// unwatched, so our own Vite exiting code 1 is invisible; and a hard kill of the launcher
// still orphans Vite, because `kill()` only helps when the launcher is alive to call it.
//
// SO THE DESIGN REMOVES THE CLASS INSTEAD OF IMPROVING THE KILL:
//  1. Vite runs IN THE LAUNCHER PROCESS via its Node API. There is then no child to
//     orphan — the listening socket belongs to the launcher, so the OS releases the port
//     when the launcher dies FOR ANY REASON: clean quit, crash, Ctrl+C, or `taskkill /F`.
//  2. The URL comes from the server object we created (`server.resolvedUrls`), so the
//     polling loop — the thing that could accept somebody else's server — is DELETED
//     OUTRIGHT. There is no longer any code path that can attach to a server we did not
//     start.
//  3. A squatter is DETECTED and handled, never joined: prove it is a Vite dev server,
//     find the single PID holding the port, and kill only then; otherwise abort loudly,
//     naming the PID and a copy-pasteable command.
//
// PROOF-GATED RECLAIM (plan ruling A.5). Killing a process we did not start is the one
// nearly-irreversible act here, so it is gated on proof: the `/@vite/client` probe must
// answer as JavaScript AND exactly one PID must hold the port. Killing a PROVEN stale Vite
// is what stops the engineer ever typing a kill command again, which was the explicit ask.
//
// ⚠ VITE BINDS `::1`, NOT `127.0.0.1` — measured on this machine
// (`httpServer.address()` → `{address:'::1', family:'IPv6'}`). So the PID parser MUST
// handle the `[::1]:5173` row shape; an IPv4-only parser finds nothing and the launcher
// aborts on every single conflict, which is a new bug wearing the fix's clothes.
import { execFile } from 'node:child_process';

export const PORT = 5173;

/** The Vite-owned URL that proves a Vite dev server, rather than merely "something". */
export const IDENTITY_PATH = '/@vite/client';

/**
 * The PIDs LISTENING on `port`, from either `netstat -ano` (Windows) or `lsof -t`
 * (everything else). Pure. De-duplicated and sorted.
 */
export function parseListeningPids(text, port) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);

  // `lsof -t` output is a bare newline-separated PID list — it has already filtered by
  // port, so there is nothing to match.
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l !== '');
  if (nonEmpty.length > 0 && nonEmpty.every((l) => /^\d+$/.test(l))) {
    return [...new Set(nonEmpty.map(Number))].sort((a, b) => a - b);
  }

  const pids = new Set();
  for (const line of lines) {
    // Only a LISTENING socket owns the port; an ESTABLISHED row is a client connection to
    // it and killing that PID would be killing a browser tab.
    if (!/\bLISTENING\b/i.test(line)) continue;
    const m = line.trim().match(/^\S+\s+(\S+)\s+\S+\s+\S+\s+(\d+)\s*$/);
    if (!m) continue;
    // The port is the last `:`-separated field of the local address, which is what makes
    // `[::1]:5173` and `0.0.0.0:5173` the same case and `127.0.0.1:15173` a different one.
    const portMatch = m[1].match(/:(\d+)$/);
    if (!portMatch) continue;
    if (Number(portMatch[1]) !== port) continue;
    pids.add(Number(m[2]));
  }
  return [...pids].sort((a, b) => a - b);
}

/**
 * Is the thing answering on this port really a Vite dev server? Pure.
 * `/@vite/client` is served by Vite and by essentially nothing else; measured here, a live
 * Vite answers `200` with `content-type: text/javascript`.
 */
export function looksLikeViteDevServer(probe) {
  if (!probe || probe.ok !== true) return false;
  if (probe.status !== 200) return false;
  const type = String(probe.contentType ?? '').toLowerCase();
  return type.includes('javascript') || type.includes('ecmascript');
}

/**
 * What to do about the port. Pure, and the whole safety argument lives here:
 *   `proceed` — it is free.
 *   `reclaim` — occupied, PROVEN to be Vite, and exactly one PID holds it.
 *   `abort`   — anything else: an unknown squatter, an ambiguous set of PIDs, or a PID
 *               lookup that failed. We never kill on a guess and never attach.
 */
export function reclaimDecision({ occupied, isVite, pids } = {}) {
  if (!occupied) return 'proceed';
  const list = Array.isArray(pids) ? pids : [];
  if (isVite === true && list.length === 1) return 'reclaim';
  return 'abort';
}

/** True when an error from `server.listen()` means "that port is taken". Pure. */
export function isPortInUse(err, port) {
  if (!err) return false;
  if (err.code === 'EADDRINUSE') return true;
  const message = String(err.message ?? err);
  // Vite's own strictPort rejection carries NO `.code` — measured — so the message is the
  // primary signal and `EADDRINUSE` the secondary one.
  return message.includes(`Port ${port} is already in use`) || /EADDRINUSE/.test(message);
}

/** The loud refusal: the port, the PIDs, and a command the engineer can paste. Pure. */
export function describePortConflict({ port, pids = [], platform = process.platform } = {}) {
  const list = pids.length > 0 ? pids.join(', ') : 'unknown';
  const command =
    pids.length > 0
      ? platform === 'win32'
        ? pids.map((p) => `taskkill /F /PID ${p}`).join(' ; ')
        : `kill -9 ${pids.join(' ')}`
      : platform === 'win32'
        ? `netstat -ano | findstr :${port}`
        : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
  return (
    `[void] REFUSING TO START. Port ${port} is held by PID ${list}, and it is not a Vite dev ` +
    `server we can prove. Attaching to it would run the game against somebody else's code ` +
    `(FINDINGS.md G41), so this launcher will not do it.\n` +
    `[void] Free the port and try again:\n    ${command}`
  );
}

/** Run a command and resolve its stdout, or `null` if it fails. The impure edge. */
export function runCommand(file, args) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
    } catch {
      resolve(null);
    }
  });
}

/** The PIDs listening on `port`, asking the OS. Returns `[]` when the lookup fails. */
export async function listListeningPids(port, platform = process.platform) {
  const out =
    platform === 'win32'
      ? await runCommand('netstat', ['-ano'])
      : await runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (out === null) return [];
  return parseListeningPids(out, port);
}

/**
 * Ask whatever is on the port whether it is a Vite dev server. Returns the shape
 * `looksLikeViteDevServer` decides on; a network error is `{ok:false}`.
 *
 * ⚠ THIS IS AN IDENTITY PROBE, NOT A READINESS POLL. It runs ONLY after our own
 * `listen()` has been refused, and its answer can only ever lead to `reclaim` or `abort` —
 * never to "use that server". That distinction is the whole of G41.
 */
export async function probeVite(port, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}${IDENTITY_PATH}`, { signal: controller.signal });
    return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') };
  } catch {
    return { ok: false, status: 0, contentType: null };
  } finally {
    clearTimeout(timer);
  }
}
