// The SESSION LOG — G6's fix, plus the cap and the rotation the plan specifies.
//
// Every pure expectation below is written out by hand from the spec in `log.mjs`'s
// header. The capacity bound in the rotation block is DERIVED FROM THE POLICY, not
// measured from a run: the whole point of a capacity invariant (PRINCIPLES.md §A8/§A3) is
// that it must disagree with an implementation that is wrong.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOG_CAP_BYTES,
  DATA_MAX_CHARS,
  configureLogDir,
  logFilePath,
  rotatedFilePath,
  resolveMainLogLevel,
  passesLevel,
  formatLogLine,
  sessionBanner,
  truncateData,
  shouldRotate,
  fileLog,
  flushLog,
  closeLog,
} from './log.mjs';
import { stripComments, stripReachesEndOfFile } from '../src/log/sourceScan.testutil.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIPPING_SOURCE = fs.readFileSync(path.join(HERE, 'log.mjs'), 'utf8');
/**
 * Comments stripped — this file's header QUOTES the defect it removed, so a raw scan
 * would go red for the prose explaining why the defect is gone.
 *
 * Uses the single-pass scanner from `sourceScan.testutil.mjs`, NOT a pair of regexes: the
 * header contains the line comment "packs `electron/**` into the asar", whose `/*` makes a
 * naive block-comment pass delete every import in the file. Proved in
 * `sourceScan.test.mjs`, and anchored below.
 */
const SOURCE = stripComments(SHIPPING_SOURCE);

const tmpDirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'void-log-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await closeLog();
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

// =========================================================================================
// G6 — the path is not baked in at module scope.
// =========================================================================================

describe('G6: the log directory is injected, never derived from __dirname', () => {
  it('the stripped source still contains the region being scanned (the anchor)', () => {
    // WITHOUT THIS the guard below is worthless, and that is not a hypothetical: a naive
    // regex stripper deleted this file's whole import section (the `/*` inside the header's
    // "electron/**"), and reintroducing G6 verbatim stayed GREEN. Assert the region first.
    //
    // ⚠ AND THE ANCHORS MUST REACH THE END OF THE FILE. The scanner does not track regular
    // expression literals, so a regex containing `/*` opens a hole to the next `*​/`.
    // Anchoring only the top left the last ~12% of this file unprotected: a
    // `const HOLE = /a\/*b/;` inserted after `fileLog`, followed by G6 verbatim, was GREEN.
    // The last two entries are this module's final exports, so any hole spans an anchor.
    expect(SOURCE, 'the comment strip ate the imports — every guard below is scanning a hole').toMatch(
      /import\s+fs\s+from\s+'node:fs'/,
    );
    expect(SOURCE).toMatch(/import\s+path\s+from\s+'node:path'/);
    expect(SOURCE).toMatch(/export\s+function\s+configureLogDir/);
    expect(SOURCE).toMatch(/export\s+function\s+fileLog/);
    expect(SOURCE, 'the strip ate the tail of log.mjs — a hole below the old last anchor').toMatch(
      /export\s+async\s+function\s+flushLog/,
    );
    expect(SOURCE, 'the strip ate the final export of log.mjs').toMatch(
      /export\s+async\s+function\s+closeLog/,
    );
    // ...and the strip really did remove the comments (or "not.toMatch" would be trivial).
    expect(
      stripReachesEndOfFile(SHIPPING_SOURCE),
      'the strip ran off the END of the file — a regex literal containing `/*` with no later `*/` swallows everything after it, and every anchor ABOVE it still passes',
    ).toBe(true);
    expect(SOURCE.length).toBeLessThan(SHIPPING_SOURCE.length);
    expect(SOURCE).not.toContain('electron-builder packs');
  });

  it('the shipping source derives no path from __dirname at all', () => {
    // THE DEFECT, verbatim: `const LOG_DIR = path.join(__dirname, '..', 'logs')`.
    // `electron-builder` packs `electron/**` into the asar, so that path lands inside a
    // read-only archive, `mkdirSync` throws, and every log call in a shipped build becomes
    // a silent no-op while main still prints "logging to <path>".
    expect(SOURCE, 'log.mjs derives a path from __dirname again — that is G6').not.toMatch(
      /__dirname/,
    );
    expect(SOURCE, 'log.mjs resolves its own module URL again').not.toMatch(/fileURLToPath/);
    // And the anchor: it really does still build a path (so the guard is not vacuous).
    expect(SOURCE).toMatch(/path\.join\s*\(/);
  });

  it('exports configureLogDir + logFilePath (LOG_FILE, the module-scope constant, is gone)', () => {
    expect(typeof configureLogDir).toBe('function');
    expect(typeof logFilePath).toBe('function');
    expect(SOURCE, 'the module-scope LOG_FILE constant is back').not.toMatch(
      /export\s+const\s+LOG_FILE\b/,
    );
  });

  it('the default (pre-ready) directory is a temp dir, never inside the app bundle', () => {
    // Whatever happens before `app.whenReady()` must still land somewhere WRITABLE.
    const before = logFilePath();
    expect(before.startsWith(os.tmpdir())).toBe(true);
    expect(before).not.toContain('app.asar');
  });

  it('configureLogDir puts the file exactly where it was told, and nothing in the repo', () => {
    const dir = tempDir();
    const returned = configureLogDir(dir);
    expect(returned).toBe(path.join(dir, 'void.log'));
    expect(logFilePath()).toBe(path.join(dir, 'void.log'));
    expect(rotatedFilePath()).toBe(path.join(dir, 'void.log.1'));
  });

  it('a configured log writes to that directory and creates nothing under electron/../logs', async () => {
    const dir = tempDir();
    const repoLogs = path.join(HERE, '..', 'logs');
    configureLogDir(dir);
    fileLog({ time: 0, level: 'info', category: 'electron', message: 'hello' });
    await flushLog();
    const written = fs.readFileSync(path.join(dir, 'void.log'), 'utf8');
    expect(written).toContain('hello');
    expect(fs.existsSync(path.join(repoLogs, 'void.log'))).toBe(false);
  });

  it('does not create its directory until something is actually written', () => {
    // Lazy on purpose: the pre-ready temp directory should normally never exist.
    const dir = path.join(tempDir(), 'not-yet');
    configureLogDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
    fileLog({ time: 0, level: 'info', category: 'x', message: 'now' });
    expect(fs.existsSync(dir)).toBe(true);
  });
});

// =========================================================================================
// The pure formatters.
// =========================================================================================

describe('formatLogLine (pure — asserted character for character)', () => {
  it('renders an entry WITHOUT data', () => {
    expect(formatLogLine({ time: 0, level: 'info', category: 'electron', message: 'app booted' })).toBe(
      '1970-01-01T00:00:00.000Z INFO [electron] app booted',
    );
  });

  it('renders an entry WITH data, upper-casing the level', () => {
    expect(
      formatLogLine({ time: 86_400_000, level: 'warn', category: 'llm', message: 'generate: done', data: { ms: 250 } }),
    ).toBe('1970-01-02T00:00:00.000Z WARN [llm] generate: done {"ms":250}');
  });

  it('a NON-FINITE time renders as the epoch, and never throws', () => {
    // The old code substituted `Date.now()`, which made this impure AND made a broken
    // timestamp indistinguishable from a real one.
    expect(formatLogLine({ time: NaN, level: 'error', category: 'x', message: 'm' })).toBe(
      '1970-01-01T00:00:00.000Z ERROR [x] m',
    );
    expect(() => formatLogLine({ time: Infinity, level: 'error', category: 'x', message: 'm' })).not.toThrow();
  });

  it('missing fields fall back rather than printing "undefined"', () => {
    expect(formatLogLine({})).toBe('1970-01-01T00:00:00.000Z INFO [?] ');
    expect(formatLogLine(null)).toBe('1970-01-01T00:00:00.000Z INFO [?] ');
  });

  it('CIRCULAR data becomes a marker, never a throw', () => {
    const data = { a: 1 };
    data.self = data;
    expect(formatLogLine({ time: 0, level: 'info', category: 'x', message: 'm', data })).toBe(
      '1970-01-01T00:00:00.000Z INFO [x] m [unserializable data]',
    );
  });

  it('is PURE: the same entry renders identically twice, with no clock read', () => {
    const entry = { time: 12345, level: 'debug', category: 'save', message: 'run saved', data: { ms: 1 } };
    expect(formatLogLine(entry)).toBe(formatLogLine(entry));
    expect(formatLogLine(entry)).toBe('1970-01-01T00:00:12.345Z DEBUG [save] run saved {"ms":1}');
  });
});

describe('truncateData', () => {
  it('leaves a small value untouched and round-trips it', () => {
    const r = truncateData({ ms: 250, gpu: 'vulkan' }, DATA_MAX_CHARS);
    expect(r.truncated).toBe(false);
    expect(JSON.parse(r.json)).toEqual({ ms: 250, gpu: 'vulkan' });
  });

  it('caps a 50 000-character string well under DATA_MAX_CHARS + 32', () => {
    const r = truncateData('x'.repeat(50_000), DATA_MAX_CHARS);
    expect(r.truncated).toBe(true);
    expect(r.json.length).toBeLessThanOrEqual(DATA_MAX_CHARS + 32);
    expect(r.json.length).toBeGreaterThan(DATA_MAX_CHARS); // it did not truncate to nothing
  });

  it('the boundary: exactly maxChars is kept, one more is cut', () => {
    // JSON.stringify('a'.repeat(n)) is n + 2 characters (the two quotes).
    const keep = truncateData('a'.repeat(8), 10);
    expect(keep.truncated).toBe(false);
    expect(keep.json).toBe('"aaaaaaaa"');
    const cut = truncateData('a'.repeat(9), 10);
    expect(cut.truncated).toBe(true);
  });

  it('unserializable values become a marker rather than throwing', () => {
    const circular = {};
    circular.self = circular;
    expect(truncateData(circular, 100)).toEqual({ json: '[unserializable data]', truncated: false });
    expect(truncateData(() => 1, 100).json).toBe('[unserializable data]');
    expect(truncateData(undefined, 100).json).toBe('[unserializable data]');
  });
});

describe('shouldRotate (pure — hand-derived boundaries)', () => {
  const CAP = 1000;

  it('does not rotate while the file plus the incoming line fits', () => {
    expect(shouldRotate(CAP - 1, 1, CAP)).toBe(false); // 999 + 1 === 1000, exactly the cap
    expect(shouldRotate(1, 1, CAP)).toBe(false);
  });

  it('rotates as soon as the file plus the incoming line would exceed it', () => {
    expect(shouldRotate(CAP - 1, 2, CAP)).toBe(true); // 999 + 2 === 1001
    expect(shouldRotate(CAP, 1, CAP)).toBe(true);
    expect(shouldRotate(CAP + 1, 1, CAP)).toBe(true);
  });

  it('NEVER rotates an empty file — even for a line longer than the whole cap', () => {
    // The guard that stops an over-long line rotating forever and never being written.
    // Inverting it turns the log into an infinite rename loop that stores nothing.
    expect(shouldRotate(0, 999_999, CAP)).toBe(false);
    expect(shouldRotate(0, 1, CAP)).toBe(false);
  });
});

describe('sessionBanner (pure)', () => {
  it('names the four things that keep two sessions of two worktrees apart', () => {
    expect(
      sessionBanner({ time: 0, pid: 4321, version: '0.0.0', platform: 'win32-x64', cwd: 'C:/void' }),
    ).toBe('=== session 1970-01-01T00:00:00.000Z pid=4321 version=0.0.0 platform=win32-x64 cwd=C:/void ===');
  });

  it('degrades to markers rather than printing "undefined"', () => {
    expect(sessionBanner()).toBe('=== session 1970-01-01T00:00:00.000Z pid=? version=? platform=? cwd=? ===');
  });
});

describe('resolveMainLogLevel', () => {
  it('a dev run is debug, a packaged run is info', () => {
    expect(resolveMainLogLevel({ env: {}, dev: true })).toBe('debug');
    expect(resolveMainLogLevel({ env: {}, dev: false })).toBe('info');
    expect(resolveMainLogLevel()).toBe('info');
  });

  it('a VALID VOID_LOG_LEVEL wins over both', () => {
    expect(resolveMainLogLevel({ env: { VOID_LOG_LEVEL: 'warn' }, dev: true })).toBe('warn');
    expect(resolveMainLogLevel({ env: { VOID_LOG_LEVEL: 'debug' }, dev: false })).toBe('debug');
    expect(resolveMainLogLevel({ env: { VOID_LOG_LEVEL: 'error' }, dev: false })).toBe('error');
  });

  it('an invalid one is IGNORED — it never silently changes the policy', () => {
    for (const bad of ['DEBUG', 'verbose', '', ' info', 'true', undefined, 7]) {
      expect(resolveMainLogLevel({ env: { VOID_LOG_LEVEL: bad }, dev: false })).toBe('info');
      expect(resolveMainLogLevel({ env: { VOID_LOG_LEVEL: bad }, dev: true })).toBe('debug');
    }
  });
});

describe('passesLevel', () => {
  it('keeps everything at or above the minimum and drops the rest', () => {
    expect(passesLevel('debug', 'info')).toBe(false);
    expect(passesLevel('info', 'info')).toBe(true);
    expect(passesLevel('warn', 'info')).toBe(true);
    expect(passesLevel('error', 'info')).toBe(true);
    expect(passesLevel('debug', 'debug')).toBe(true);
    expect(passesLevel('warn', 'error')).toBe(false);
  });

  it('an unknown level is never silently dropped', () => {
    expect(passesLevel('trace', 'error')).toBe(true);
    expect(passesLevel('info', 'nonsense')).toBe(true);
  });
});

// =========================================================================================
// The file itself: banner, cap, rotation.
// =========================================================================================

describe('the session banner', () => {
  it('is written exactly once per launch, as the first line', async () => {
    const dir = tempDir();
    configureLogDir(dir, { session: { pid: 99, cwd: 'C:/wt/observability', version: '1.2.3', platform: 'win32-x64' } });
    fileLog({ time: 0, level: 'info', category: 'x', message: 'one' });
    fileLog({ time: 0, level: 'info', category: 'x', message: 'two' });
    await flushLog();
    const lines = fs.readFileSync(path.join(dir, 'void.log'), 'utf8').trim().split('\n');
    const banners = lines.filter((l) => l.startsWith('=== session '));
    expect(banners).toHaveLength(1);
    expect(lines[0]).toBe(banners[0]);
    expect(banners[0]).toContain('pid=99');
    expect(banners[0]).toContain('cwd=C:/wt/observability');
    expect(banners[0]).toContain('version=1.2.3');
    expect(banners[0]).toContain('platform=win32-x64');
  });

  it('the REAL banner — with nothing injected — names this process and this checkout', async () => {
    // ⚠ The test above injects all four fields, so it proves the FORMAT and nothing about
    // the values a real launch writes. `defaultSession()` was asserted nowhere: gutting it
    // to `{}` left every real banner reading `pid=? cwd=?` — which defeats AC-32's entire
    // purpose, because `cwd` is the only thing keeping two worktrees sharing one user-data
    // log apart. This drives the production default path.
    const dir = tempDir();
    configureLogDir(dir);
    fileLog({ time: 0, level: 'info', category: 'x', message: 'go' });
    await flushLog();
    const banner = fs.readFileSync(path.join(dir, 'void.log'), 'utf8').split('\n')[0];
    expect(banner.startsWith('=== session ')).toBe(true);
    expect(banner, 'the banner does not name this process').toContain(`pid=${process.pid}`);
    expect(banner, 'the banner does not name this checkout — two worktrees become one log').toContain(
      `cwd=${process.cwd()}`,
    );
    expect(banner, 'the banner does not name the platform').toContain(
      `platform=${process.platform}-${process.arch}`,
    );
    expect(banner, 'the banner has no version field at all').toMatch(/version=\S+/);
    // ...and none of them degraded to the unknown marker.
    expect(banner, 'a banner field degraded to "?" on the real default path').not.toContain('=?');
  });

  it('an injected session OVERRIDES the defaults, field by field', async () => {
    // The other half: `main.mjs` supplies only `version`, so the other three must survive.
    const dir = tempDir();
    configureLogDir(dir, { session: { version: '9.9.9' } });
    fileLog({ time: 0, level: 'info', category: 'x', message: 'go' });
    await flushLog();
    const banner = fs.readFileSync(path.join(dir, 'void.log'), 'utf8').split('\n')[0];
    expect(banner).toContain('version=9.9.9');
    expect(banner).toContain(`pid=${process.pid}`);
    expect(banner).toContain(`cwd=${process.cwd()}`);
  });

  it('a SECOND launch appends its own banner rather than replacing the first', async () => {
    const dir = tempDir();
    configureLogDir(dir, { session: { pid: 1 } });
    fileLog({ time: 0, level: 'info', category: 'x', message: 'first launch' });
    await flushLog();
    await closeLog();
    configureLogDir(dir, { session: { pid: 2 } });
    fileLog({ time: 0, level: 'info', category: 'x', message: 'second launch' });
    await flushLog();
    const text = fs.readFileSync(path.join(dir, 'void.log'), 'utf8');
    expect(text).toContain('pid=1');
    expect(text).toContain('pid=2');
    expect(text).toContain('first launch');
    expect(text).toContain('second launch');
  });
});

describe('capacity — the cap really bounds the disk, and exactly two files survive', () => {
  // ------------------------------------------------------------------------------------
  // THE BOUND, DERIVED FROM THE POLICY BEFORE READING ANY OUTPUT:
  //   - the policy keeps AT MOST TWO files, `void.log` and `void.log.1`;
  //   - a file is rotated when `bytesInFile + incoming > cap`, so a file can exceed the
  //     cap by AT MOST ONE LINE, and never by more;
  //   - each file's session banner is counted inside its own byte total.
  // => combined <= 2 * cap + 2 * (longest line) < 2 * cap + 4 KiB for the ~200-byte lines
  //    this test writes.
  // The 20x-cap volume is chosen so at least eighteen rotations must have happened: a
  // policy that rotated once and then appended forever fails this, and so does one that
  // kept every rotated file.
  // ------------------------------------------------------------------------------------
  const CAP = 64 * 1024;

  it('writing twenty times the cap leaves two files under two caps plus 4 KiB', async () => {
    const dir = tempDir();
    configureLogDir(dir, { capBytes: CAP, session: { pid: 7 } });
    const payload = 'y'.repeat(100);
    // One formatted line here is ~150 bytes; 20 * CAP / 150 ≈ 8740 lines.
    const lines = Math.ceil((20 * CAP) / 150);
    for (let i = 0; i < lines; i++) {
      fileLog({ time: 0, level: 'info', category: 'bulk', message: 'filler line', data: { payload } });
    }
    await flushLog();

    const present = fs.readdirSync(dir).sort();
    expect(present, `unexpected files in the log dir: ${present.join(', ')}`).toEqual([
      'void.log',
      'void.log.1',
    ]);
    const total = present.reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
    expect(total).toBeLessThan(2 * CAP + 4096);
    // ...and it did not simply write nothing: both files carry real content.
    for (const f of present) {
      expect(fs.statSync(path.join(dir, f)).size).toBeGreaterThan(1000);
    }
  });

  it('the ROTATED file is the older one — the newest lines are in void.log', async () => {
    const dir = tempDir();
    configureLogDir(dir, { capBytes: 4096, session: { pid: 7 } });
    for (let i = 0; i < 200; i++) {
      fileLog({ time: 0, level: 'info', category: 'seq', message: 'earlier', data: { i, pad: 'z'.repeat(60) } });
    }
    await flushLog();
    fileLog({ time: 0, level: 'info', category: 'seq', message: 'THE LAST ONE' });
    await flushLog();
    expect(fs.readFileSync(path.join(dir, 'void.log'), 'utf8')).toContain('THE LAST ONE');
    expect(fs.readFileSync(path.join(dir, 'void.log.1'), 'utf8')).not.toContain('THE LAST ONE');
  });

  it('a fresh launch over an already-full file rotates it before appending', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'void.log'), 'o'.repeat(5000));
    configureLogDir(dir, { capBytes: 4096, session: { pid: 7 } });
    fileLog({ time: 0, level: 'info', category: 'x', message: 'new session' });
    await flushLog();
    expect(fs.readFileSync(path.join(dir, 'void.log.1'), 'utf8')).toBe('o'.repeat(5000));
    expect(fs.readFileSync(path.join(dir, 'void.log'), 'utf8')).toContain('new session');
  });

  it('the shipped cap is 4 MiB, so the whole log can never exceed ~8 MiB', () => {
    expect(LOG_CAP_BYTES).toBe(4 * 1024 * 1024);
    expect(DATA_MAX_CHARS).toBe(2000);
  });
});

describe('the file sink never blocks', () => {
  it('uses a write stream and no synchronous write on the hot path', () => {
    // Asserted over the SHIPPING file only, so the guard cannot be satisfied by this test.
    expect(SOURCE).toMatch(/fs\.createWriteStream\s*\(/);
    expect(SOURCE, 'a synchronous write reached the hot path').not.toMatch(
      /appendFileSync|writeFileSync/,
    );
  });

  it('a broken directory never throws out of fileLog', () => {
    // A path that cannot be created (a file where a directory must be).
    const parent = tempDir();
    const blocker = path.join(parent, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    configureLogDir(path.join(blocker, 'logs'));
    expect(() => fileLog({ time: 0, level: 'error', category: 'x', message: 'm' })).not.toThrow();
  });
});
