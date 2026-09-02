// FINDINGS.md G41 — the launcher's pure decisions, plus source guards on the launcher
// itself (which cannot be imported: it starts a Vite server and spawns Electron at module
// scope).
//
// Every `netstat` sample below is HAND-WRITTEN, including the `[::1]:5173` row, because
// that is what Vite actually binds on this machine — measured, `httpServer.address()` →
// `{address:'::1', family:'IPv6'}`. A parser that only understands `127.0.0.1:5173` finds
// nothing, aborts on every conflict, and is a new bug wearing the fix's clothes.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PORT,
  IDENTITY_PATH,
  parseListeningPids,
  looksLikeViteDevServer,
  reclaimDecision,
  isPortInUse,
  describePortConflict,
} from './dev-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_LAUNCHER = fs.readFileSync(path.join(HERE, 'desktop-dev.mjs'), 'utf8');
/** Single-pass comment strip — a `/*` inside a line comment must not eat the imports. */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        const done = source[i] === c;
        i += 1;
        if (done) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
const LAUNCHER = stripComments(RAW_LAUNCHER);

// =========================================================================================
// parseListeningPids
// =========================================================================================

// A hand-written `netstat -ano` capture. Rows, and why each is here:
//   1. the header                            -> must be ignored
//   2. IPv4 wildcard on 5173, pid 4242       -> a real holder
//   3. IPv6 loopback  on 5173, pid 4242      -> THE SAME PROCESS, both families: dedupe
//   4. 127.0.0.1:15173                       -> a decoy that CONTAINS "5173"
//   5. 127.0.0.1:51730                       -> a decoy that STARTS WITH "5173"
//   6. an ESTABLISHED client of 5173, pid 99 -> not a holder; killing it kills a browser
//   7. another port entirely                 -> noise
const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       4242',
  '  TCP    [::1]:5173             [::]:0                 LISTENING       4242',
  '  TCP    127.0.0.1:15173        0.0.0.0:0              LISTENING       7001',
  '  TCP    127.0.0.1:51730        0.0.0.0:0              LISTENING       7002',
  '  TCP    127.0.0.1:5173         127.0.0.1:60123        ESTABLISHED     99',
  '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       8080',
  '',
].join('\r\n');

describe('parseListeningPids (netstat)', () => {
  it('finds the one PID holding the port, across both address families', () => {
    expect(parseListeningPids(NETSTAT, 5173)).toEqual([4242]);
  });

  it('handles the IPv6 row ALONE — which is what Vite actually binds', () => {
    const ipv6Only = ['  TCP    [::1]:5173             [::]:0                 LISTENING       4242'].join('\n');
    expect(parseListeningPids(ipv6Only, 5173)).toEqual([4242]);
  });

  it('and the IPv6 wildcard form', () => {
    expect(parseListeningPids('  TCP    [::]:5173   [::]:0   LISTENING   17', 5173)).toEqual([17]);
  });

  it('rejects the decoy ports rather than matching a substring', () => {
    expect(parseListeningPids(NETSTAT, 15173)).toEqual([7001]);
    expect(parseListeningPids(NETSTAT, 51730)).toEqual([7002]);
    expect(parseListeningPids(NETSTAT, 3000)).toEqual([8080]);
    expect(parseListeningPids(NETSTAT, 5174)).toEqual([]);
  });

  it('ignores a non-LISTENING row — a client of the port does not hold it', () => {
    // Killing pid 99 would be killing whatever browser tab is connected to the server.
    expect(parseListeningPids(NETSTAT, 5173)).not.toContain(99);
  });

  it('returns EVERY holder when there is more than one (which forces an abort)', () => {
    const two = [
      '  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING       111',
      '  TCP    [::1]:5173      [::]:0       LISTENING       222',
    ].join('\n');
    expect(parseListeningPids(two, 5173)).toEqual([111, 222]);
  });

  it('reads an lsof -t PID list too', () => {
    expect(parseListeningPids('4242\n', 5173)).toEqual([4242]);
    expect(parseListeningPids('111\n222\n', 5173)).toEqual([111, 222]);
    expect(parseListeningPids('4242\n4242\n', 5173)).toEqual([4242]);
  });

  it('is empty for empty, blank or non-string input rather than throwing', () => {
    expect(parseListeningPids('', 5173)).toEqual([]);
    expect(parseListeningPids('   \n\n', 5173)).toEqual([]);
    expect(parseListeningPids(null, 5173)).toEqual([]);
    expect(parseListeningPids(undefined, 5173)).toEqual([]);
  });

  it('is empty for output that mentions the port but lists no LISTENING socket', () => {
    expect(parseListeningPids('  TCP  127.0.0.1:5173  127.0.0.1:1  TIME_WAIT  5', 5173)).toEqual([]);
  });
});

// =========================================================================================
// looksLikeViteDevServer — the PROOF that gates the kill
// =========================================================================================

describe('looksLikeViteDevServer', () => {
  it('is true only for a 200 that answers as JavaScript', () => {
    // Measured: a live Vite answers /@vite/client with 200 text/javascript.
    expect(looksLikeViteDevServer({ ok: true, status: 200, contentType: 'text/javascript' })).toBe(true);
    expect(
      looksLikeViteDevServer({ ok: true, status: 200, contentType: 'application/javascript; charset=utf-8' }),
    ).toBe(true);
  });

  it('is false for every other answer — we never kill on a guess', () => {
    const cases = [
      ['a 404 (something else is serving)', { ok: false, status: 404, contentType: 'text/html' }],
      ['a 500', { ok: false, status: 500, contentType: 'text/html' }],
      ['HTML on 200 (a web app, not Vite)', { ok: true, status: 200, contentType: 'text/html' }],
      ['JSON on 200 (an API)', { ok: true, status: 200, contentType: 'application/json' }],
      ['no content type at all', { ok: true, status: 200, contentType: null }],
      ['a 200 that is somehow not ok', { ok: false, status: 200, contentType: 'text/javascript' }],
      ['a network error', { ok: false, status: 0, contentType: null }],
      ['nothing', null],
      ['undefined', undefined],
    ];
    for (const [name, probe] of cases) {
      expect(looksLikeViteDevServer(probe), name).toBe(false);
    }
  });

  it('probes a path only Vite serves', () => {
    expect(IDENTITY_PATH).toBe('/@vite/client');
  });
});

// =========================================================================================
// reclaimDecision — the full table. Killing is gated on PROOF and on a single owner.
// =========================================================================================

describe('reclaimDecision', () => {
  const TABLE = [
    // occupied, isVite, pids            -> expected                     why
    [false, false, [], 'proceed', 'the port is free'],
    [false, true, [4242], 'proceed', 'free wins over everything else'],
    [true, true, [4242], 'reclaim', 'proven Vite, exactly one owner'],
    [true, true, [], 'abort', 'proven Vite but the PID lookup failed — nothing to kill'],
    [true, true, [111, 222], 'abort', 'proven Vite but two owners — which one?'],
    [true, false, [4242], 'abort', 'an UNKNOWN squatter: never kill it, never join it'],
    [true, false, [], 'abort', 'unknown and unlocatable'],
    [true, false, [111, 222], 'abort', 'unknown and ambiguous'],
  ];

  for (const [occupied, isVite, pids, expected, why] of TABLE) {
    it(`${expected}: ${why}`, () => {
      expect(reclaimDecision({ occupied, isVite, pids })).toBe(expected);
    });
  }

  it('never reclaims without proof — the polarity that matters most', () => {
    // If `isVite` were ignored, the launcher would kill any process on 5173, including a
    // colleague's unrelated server or a system service.
    expect(reclaimDecision({ occupied: true, isVite: false, pids: [4242] })).toBe('abort');
    expect(reclaimDecision({ occupied: true, isVite: undefined, pids: [4242] })).toBe('abort');
    expect(reclaimDecision({ occupied: true, isVite: 'yes', pids: [4242] })).toBe('abort');
    expect(reclaimDecision({ occupied: true, isVite: 1, pids: [4242] })).toBe('abort');
  });

  it('and NEVER returns anything that means "attach" — the G41 defect has no verdict', () => {
    const verdicts = new Set();
    for (const occupied of [true, false]) {
      for (const isVite of [true, false]) {
        for (const pids of [[], [1], [1, 2]]) {
          verdicts.add(reclaimDecision({ occupied, isVite, pids }));
        }
      }
    }
    expect([...verdicts].sort()).toEqual(['abort', 'proceed', 'reclaim']);
  });

  it('degrades to abort on garbage rather than to reclaim', () => {
    expect(reclaimDecision({ occupied: true, isVite: true, pids: null })).toBe('abort');
    expect(reclaimDecision({ occupied: true })).toBe('abort');
    expect(reclaimDecision()).toBe('proceed'); // nothing said "occupied"
  });
});

// =========================================================================================
// isPortInUse — Vite's strictPort rejection carries NO `.code`, measured.
// =========================================================================================

describe('isPortInUse', () => {
  it('recognises Vite\'s own message, which has no error code', () => {
    expect(isPortInUse(new Error('Port 5173 is already in use'), 5173)).toBe(true);
  });

  it('recognises a raw EADDRINUSE', () => {
    const err = new Error('listen EADDRINUSE: address already in use :::5173');
    err.code = 'EADDRINUSE';
    expect(isPortInUse(err, 5173)).toBe(true);
    expect(isPortInUse(new Error('listen EADDRINUSE'), 5173)).toBe(true);
  });

  it('does NOT swallow an unrelated failure — that must propagate, not become a reclaim', () => {
    expect(isPortInUse(new Error('Cannot find module vite'), 5173)).toBe(false);
    expect(isPortInUse(new Error('Port 9999 is already in use'), 5173)).toBe(false);
    expect(isPortInUse(null, 5173)).toBe(false);
    expect(isPortInUse(undefined, 5173)).toBe(false);
  });
});

// =========================================================================================
// describePortConflict — the loud refusal
// =========================================================================================

describe('describePortConflict', () => {
  it('names the port, the PIDs and a Windows kill command', () => {
    const text = describePortConflict({ port: 5173, pids: [4242], platform: 'win32' });
    expect(text).toContain('5173');
    expect(text).toContain('4242');
    expect(text).toContain('taskkill /F /PID 4242');
    expect(text).toContain('G41');
  });

  it('and a POSIX one elsewhere', () => {
    const text = describePortConflict({ port: 5173, pids: [111, 222], platform: 'darwin' });
    expect(text).toContain('kill -9 111 222');
    expect(text).not.toContain('taskkill');
  });

  it('still tells the engineer how to LOOK when no PID was found', () => {
    expect(describePortConflict({ port: 5173, pids: [], platform: 'win32' })).toContain(
      'netstat -ano | findstr :5173',
    );
    expect(describePortConflict({ port: 5173, pids: [], platform: 'linux' })).toContain('lsof -nP');
  });

  it('says it is REFUSING, so the message cannot be read as a warning to ignore', () => {
    expect(describePortConflict({ port: 5173, pids: [1] })).toMatch(/REFUSING/);
  });
});

// =========================================================================================
// SOURCE GUARDS on the launcher itself. It starts a Vite server and spawns Electron at
// module scope, so it can never be imported by a test.
// =========================================================================================

describe('the launcher cannot orphan Vite or silently join somebody else (G41)', () => {
  it('the stripped source is intact (the anchor for everything below)', () => {
    expect(LAUNCHER).toMatch(/import\s*\{\s*createServer\s*\}\s*from\s*'vite'/);
    expect(LAUNCHER).toMatch(/import\s+electronPath\s+from\s+'electron'/);
    expect(LAUNCHER).toMatch(/spawn\s*\(\s*electronPath/);
    expect(LAUNCHER.length).toBeLessThan(RAW_LAUNCHER.length);
  });

  it('runs Vite IN PROCESS — there is no child that can be orphaned', () => {
    expect(LAUNCHER, 'the launcher no longer starts Vite through its Node API').toMatch(
      /await\s+createServer\s*\(/,
    );
    // Look at the FIRST ARGUMENT of every spawn — the program being run. Matching "vite"
    // anywhere in the call is a false positive, because the one legitimate spawn passes
    // `VITE_DEV_SERVER_URL` in its env.
    const spawnTargets = [...LAUNCHER.matchAll(/\bspawn\s*\(/g)].map((m) => {
      const from = m.index + m[0].length;
      const comma = LAUNCHER.indexOf(',', from);
      return LAUNCHER.slice(from, comma === -1 ? from + 40 : comma).trim();
    });
    expect(spawnTargets.length, 'nothing is spawned at all — this guard has gone stale').toBe(1);
    expect(spawnTargets[0], 'the one spawn is no longer Electron').toBe('electronPath');
    for (const target of spawnTargets) {
      expect(target, 'Vite is being spawned as a child process again — that is G41').not.toMatch(
        /vite/i,
      );
    }
    expect(LAUNCHER, 'the npx wrapper is back — the real Vite becomes a GRANDCHILD on Windows').not.toMatch(
      /\bnpx\b/,
    );
    expect(LAUNCHER, 'shell: true is back — kill() cannot reach through cmd.exe').not.toMatch(
      /shell\s*:\s*true/,
    );
  });

  it('takes the URL from the server IT created, and never polls the port for one', () => {
    expect(LAUNCHER, 'the URL is no longer read off the server object').toMatch(/resolvedUrls/);
    // THE DEFECT ITSELF: `waitForServer()` asked "does anything answer 5173?" and accepted
    // whatever did. There must be no fetch of the dev URL in this file at all — the
    // identity probe lives in `dev-server.mjs` and can only lead to reclaim or abort.
    expect(LAUNCHER, 'the launcher fetches the dev URL again — it can attach to an orphan').not.toMatch(
      /\bfetch\s*\(/,
    );
    expect(LAUNCHER, 'the readiness poll is back').not.toMatch(/waitForServer/);
    expect(LAUNCHER, 'the launcher polls desktop.html to decide readiness').not.toMatch(
      /desktop\.html/,
    );
  });

  it('binds strictly, so a taken port is an ERROR rather than a silent drift to 5174', () => {
    expect(LAUNCHER, 'strictPort is gone — Vite would quietly move to another port').toMatch(
      /strictPort\s*:\s*true/,
    );
  });

  it('kills only after `reclaimDecision` says so, never on the raw probe', () => {
    const decisionAt = LAUNCHER.search(/reclaimDecision\s*\(/);
    const abortAt = LAUNCHER.search(/decision\s*===\s*'abort'/);
    const killAt = LAUNCHER.search(/process\.kill\s*\(/);
    expect(decisionAt, 'the launcher no longer asks for a decision').toBeGreaterThan(-1);
    expect(abortAt, 'the abort branch is gone').toBeGreaterThan(-1);
    expect(killAt, 'the launcher never reclaims — the engineer is back to typing kill commands').toBeGreaterThan(-1);
    expect(decisionAt).toBeLessThan(abortAt);
    expect(abortAt, 'it kills BEFORE deciding whether it may').toBeLessThan(killAt);
    // The polarity: `=== 'reclaim'` inverted would abort on the one case it may reclaim
    // and kill on every case it may not.
    expect(LAUNCHER, 'the abort branch is negated — it would kill an unknown squatter').not.toMatch(
      /decision\s*!==\s*'abort'/,
    );
  });

  it('exits non-zero when it refuses, so nothing downstream proceeds', () => {
    expect(LAUNCHER).toMatch(/describePortConflict\s*\(/);
    expect(LAUNCHER).toMatch(/process\.exit\s*\(\s*1\s*\)/);
  });

  it('prints the project root it is serving — two worktrees in sequence is a named failure', () => {
    expect(LAUNCHER, 'the launcher no longer says which checkout it is serving').toMatch(
      /serving \$\{ROOT\}|serving \$\{process\.cwd\(\)\}/,
    );
  });

  it('tears down in both directions', () => {
    expect(LAUNCHER).toMatch(/electron\.on\s*\(\s*'exit'/);
    expect(LAUNCHER).toMatch(/server\.close\s*\(/);
    for (const signal of ['SIGINT', 'SIGTERM', 'uncaughtException']) {
      expect(LAUNCHER, `the launcher ignores ${signal} — the port would stay held`).toContain(signal);
    }
  });

  it('and the port it uses is the one everything else agrees on', () => {
    expect(PORT).toBe(5173);
    expect(LAUNCHER, 'the launcher hard-codes a port instead of sharing the constant').toMatch(
      /\bPORT\b/,
    );
  });
});
