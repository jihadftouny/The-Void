// THE NARRATION CORPUS WRITER — the cap, the rotation, the purity of the line format, and
// G6's rule that no path is ever derived from `__dirname`.
//
// Every pure expectation below is written out by hand from the spec in `corpus.mjs`'s header.
// THE CAPACITY BOUND IS DERIVED FROM THE POLICY, NOT MEASURED FROM A RUN (PRINCIPLES.md
// §A8/§A3): two files at `capBytes` each, plus at most one over-long line's overshoot, because
// `shouldRotate` deliberately refuses to rotate an empty file. A bound copied back out of the
// implementation would agree with an implementation that is wrong.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORPUS_CAP_BYTES,
  CORPUS_VERSION,
  appendCorpus,
  configureCorpusDir,
  corpusFilePath,
  corpusLine,
  flushCorpus,
  resolveCorpusDir,
  rotatedCorpusPath,
} from './corpus.mjs';
import { stripComments, stripReachesEndOfFile } from '../src/log/sourceScan.testutil.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIPPING_SOURCE = fs.readFileSync(path.join(HERE, 'corpus.mjs'), 'utf8');
// The header QUOTES the defect it avoids ("any path built from `__dirname`"), so a raw scan
// would go red for the prose explaining why the defect is not there.
const SOURCE = stripComments(SHIPPING_SOURCE);

const tmpDirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'void-corpus-test-'));
  tmpDirs.push(dir);
  return dir;
}

/** The observable state of a path — enough to prove that nothing touched it. */
function snapshotPath(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return { exists: false };
  }
  if (!stat.isDirectory()) {
    return { exists: true, kind: 'file', size: stat.size, mtimeMs: stat.mtimeMs };
  }
  const entries = fs
    .readdirSync(target)
    .sort()
    .map((name) => {
      const s = fs.statSync(path.join(target, name));
      return { name, size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() };
    });
  return { exists: true, kind: 'dir', entries };
}

/** A well-formed record. `text` is what makes it a beat; everything else is context. */
function beat(overrides = {}) {
  return {
    v: CORPUS_VERSION,
    seed: 4242,
    act: 1,
    floor: 1,
    floorName: 'Undercity',
    beat: 0,
    facts: ['You take 3 damage.'],
    text: 'The dark closes over you.',
    faults: [],
    ...overrides,
  };
}

afterEach(async () => {
  await flushCorpus();
  // Put the module back on a temp directory so a later file cannot inherit this one's.
  configureCorpusDir(path.join(os.tmpdir(), 'the-void-corpus'));
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================================
// 1. Where it lives — PURE, and never from `__dirname`
// =========================================================================================

describe('resolveCorpusDir', () => {
  it('VOID_CORPUS_DIR wins outright, in dev and packaged alike', () => {
    const env = { VOID_CORPUS_DIR: '/somewhere/else' };
    expect(resolveCorpusDir({ env, dev: true, cwd: '/repo', userDataDir: '/user' })).toBe('/somewhere/else');
    expect(resolveCorpusDir({ env, dev: false, cwd: '/repo', userDataDir: '/user' })).toBe('/somewhere/else');
  });

  it('an EMPTY override is not an override', () => {
    // A blank environment variable is what an unset one looks like in a shell script, and
    // treating it as a path would write the corpus into the process's root.
    for (const bad of ['', '   ', undefined, null, 42]) {
      expect(
        resolveCorpusDir({ env: { VOID_CORPUS_DIR: bad }, dev: true, cwd: '/repo' }),
        String(bad),
      ).toBe(path.join('/repo', 'logs', 'corpus'));
    }
  });

  it('dev writes into the CHECKOUT, because that is where the sweep runs', () => {
    expect(resolveCorpusDir({ env: {}, dev: true, cwd: '/repo', userDataDir: '/user' })).toBe(
      path.join('/repo', 'logs', 'corpus'),
    );
  });

  it('packaged writes into user-data, because a packaged build has no repo', () => {
    expect(resolveCorpusDir({ env: {}, dev: false, cwd: '/repo', userDataDir: '/user' })).toBe(
      path.join('/user', 'corpus'),
    );
  });

  it('the two cases really are different — or the dev/packaged split does nothing', () => {
    const dev = resolveCorpusDir({ env: {}, dev: true, cwd: '/repo', userDataDir: '/user' });
    const packaged = resolveCorpusDir({ env: {}, dev: false, cwd: '/repo', userDataDir: '/user' });
    expect(dev).not.toBe(packaged);
  });
});

describe('the shipping source derives no path from __dirname at all (G6)', () => {
  it('the strip left the file intact (or every scan below reads a hole)', () => {
    expect(SOURCE).toMatch(/export function resolveCorpusDir/);
    expect(SOURCE).toMatch(/export function corpusLine/);
    expect(SOURCE, 'the strip ate the tail of corpus.mjs').toMatch(
      /export async function flushCorpus/,
    );
    expect(stripReachesEndOfFile(SHIPPING_SOURCE)).toBe(true);
    expect(SOURCE.length).toBeLessThan(SHIPPING_SOURCE.length);
    expect(SOURCE).not.toContain('packs `electron/**`');
  });

  it('no __dirname, no module-URL resolution — the same pin log.mjs carries', () => {
    // THE DEFECT, verbatim, in the shape it would come back in:
    //   `const CORPUS_DIR = path.join(__dirname, '..', 'logs', 'corpus')`
    // `electron-builder` packs `electron/**` into the asar, so that path is read-only in a
    // packaged build and every write becomes a silent no-op.
    expect(SOURCE, 'corpus.mjs derives a path from __dirname — that is G6').not.toMatch(/__dirname/);
    expect(SOURCE, 'corpus.mjs resolves its own module URL').not.toMatch(/fileURLToPath/);
    // ...and the anchor: it really does still build paths, so the guard is not vacuous.
    expect(SOURCE).toMatch(/path\.join\s*\(/);
  });

  it('the rotation predicate is IMPORTED, not re-implemented', () => {
    // A second copy of `shouldRotate` is the duplicated-guard-that-drifts failure: one of
    // the two would be fixed one day and the other would not.
    expect(SOURCE).toMatch(/import\s*\{\s*shouldRotate\s*\}\s*from\s*'\.\/log\.mjs'/);
    expect(SOURCE, 'corpus.mjs defines its own shouldRotate').not.toMatch(
      /function\s+shouldRotate/,
    );
  });
});

// =========================================================================================
// 2. `corpusLine` — PURE, total, and the only gate on what reaches the file
// =========================================================================================

describe('corpusLine', () => {
  it('serializes a v1 record and terminates it with exactly one newline', () => {
    const record = beat();
    const line = corpusLine(record);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).toBe(JSON.stringify(record));
    expect(JSON.parse(line).text).toBe('The dark closes over you.');
  });

  it('refuses anything that is not an object', () => {
    for (const bad of [null, undefined, 42, 'a string', true, [], [beat()]]) {
      expect(corpusLine(bad), JSON.stringify(bad) ?? String(bad)).toBeNull();
    }
  });

  it('refuses a record of the wrong version — a v2 beat is a migration, not a line', () => {
    expect(corpusLine(beat({ v: 2 }))).toBeNull();
    expect(corpusLine(beat({ v: '1' }))).toBeNull();
    expect(corpusLine({ ...beat(), v: undefined })).toBeNull();
  });

  it('refuses a record with no text — the text IS the corpus', () => {
    expect(corpusLine(beat({ text: '' }))).toBeNull();
    expect(corpusLine(beat({ text: 42 }))).toBeNull();
    expect(corpusLine({ ...beat(), text: undefined })).toBeNull();
  });

  it('NEVER throws, whatever it is handed', () => {
    const circular = beat();
    circular.self = circular;
    expect(() => corpusLine(circular)).not.toThrow();
    expect(corpusLine(circular)).toBeNull();
    const big = beat();
    big.n = 10n;
    expect(() => corpusLine(big)).not.toThrow();
    expect(corpusLine(big)).toBeNull();
  });

  it('a newline inside the text cannot split one record into two lines', () => {
    // JSONL's one invariant. `JSON.stringify` escapes it; this asserts the consequence.
    const line = corpusLine(beat({ text: 'first line\nsecond line' }));
    expect(line.split('\n').filter((s) => s !== '')).toHaveLength(1);
    expect(JSON.parse(line).text).toBe('first line\nsecond line');
  });
});

// =========================================================================================
// 3. Writing, and the capacity invariant
// =========================================================================================

describe('appendCorpus', () => {
  it('writes accepted records as one JSON object per line, in order', async () => {
    const dir = tempDir();
    configureCorpusDir(dir);
    expect(appendCorpus(beat({ beat: 0, text: 'one' }))).toBe(true);
    expect(appendCorpus(beat({ beat: 1, text: 'two' }))).toBe(true);
    await flushCorpus();

    const lines = fs.readFileSync(path.join(dir, 'narration.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => JSON.parse(l).text)).toEqual(['one', 'two']);
    expect(corpusFilePath()).toBe(path.join(dir, 'narration.jsonl'));
    expect(rotatedCorpusPath()).toBe(path.join(dir, 'narration.jsonl.1'));
  });

  it('refuses a malformed record, reports the refusal, and writes nothing', async () => {
    const dir = tempDir();
    const said = [];
    configureCorpusDir(dir, { log: (level, category, message, data) => said.push({ level, category, message, data }) });
    expect(appendCorpus({ nonsense: true })).toBe(false);
    await flushCorpus();

    expect(fs.existsSync(path.join(dir, 'narration.jsonl'))).toBe(false);
    // A failure path that logs BEFORE it recovers (principle 7).
    expect(said).toHaveLength(1);
    expect(said[0].level).toBe('warn');
    expect(said[0].category).toBe('corpus');
    expect(said[0].message).toContain('REJECTED');
  });

  it('a configured corpus TOUCHES NOTHING under electron/../logs', async () => {
    // The G6 claim, asserted as an EFFECT rather than as a state of the world: snapshot the
    // repo's own `logs/` before and after, and require them to be identical. A machine that
    // has played the game in dev legitimately has a corpus there already; what this module
    // must promise is that a run configured elsewhere does not write there.
    const dir = tempDir();
    const repoLogs = path.join(HERE, '..', 'logs');
    const before = snapshotPath(repoLogs);

    configureCorpusDir(dir);
    appendCorpus(beat());
    await flushCorpus();

    expect(snapshotPath(repoLogs), 'the corpus wrote inside the repo — that is G6').toEqual(before);
    expect(fs.readFileSync(path.join(dir, 'narration.jsonl'), 'utf8')).toContain('The dark closes over you.');
  });

  it('CAPACITY: past the cap it rotates, and only ever two files exist', async () => {
    // THE BOUND, DERIVED FROM THE POLICY IN `corpus.mjs`'s HEADER, not from a measurement:
    //   * exactly two files: `narration.jsonl` and `narration.jsonl.1`;
    //   * `shouldRotate` refuses to rotate an EMPTY file, so one over-long line may overshoot;
    //   * therefore total <= 2 * cap + one line.
    const dir = tempDir();
    const cap = 2000;
    configureCorpusDir(dir, { capBytes: cap });

    const one = corpusLine(beat());
    const lineBytes = Buffer.byteLength(one);
    // Enough records to fill the cap several times over, so a rotation that never happened
    // would be obvious rather than borderline.
    const howMany = Math.ceil((cap * 5) / lineBytes);
    for (let i = 0; i < howMany; i += 1) appendCorpus(beat({ beat: i }));
    await flushCorpus();

    const files = fs.readdirSync(dir).sort();
    expect(files, 'the corpus grew a third file — the two-file policy is gone').toEqual([
      'narration.jsonl',
      'narration.jsonl.1',
    ]);
    const total = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    expect(total, `${howMany} records of ${lineBytes} bytes exceeded 2 x ${cap} + one line`).toBeLessThanOrEqual(
      2 * cap + lineBytes,
    );
    // NON-VACUITY: far more was written than the ceiling, so the ceiling really was enforced
    // rather than never reached.
    expect(howMany * lineBytes).toBeGreaterThan(2 * cap + lineBytes);
    // ...and the current file holds the LATEST beats, not the oldest.
    const current = fs.readFileSync(path.join(dir, 'narration.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(JSON.parse(current[current.length - 1]).beat).toBe(howMany - 1);
  });

  it('rotating REPLACES the previous rotated file rather than accumulating', async () => {
    const dir = tempDir();
    const cap = 400;
    configureCorpusDir(dir, { capBytes: cap });
    const lineBytes = Buffer.byteLength(corpusLine(beat()));
    for (let i = 0; i < Math.ceil((cap * 12) / lineBytes); i += 1) appendCorpus(beat({ beat: i }));
    await flushCorpus();
    // Twelve caps' worth is at least ten rotations; still two files.
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });

  it('the default cap is the shipped one, and it is the two-file ceiling', () => {
    expect(CORPUS_CAP_BYTES).toBe(8 * 1024 * 1024);
    // A cap of zero or a negative would mean "rotate on every line" — a directory churn bug.
    expect(CORPUS_CAP_BYTES).toBeGreaterThan(0);
  });
});
