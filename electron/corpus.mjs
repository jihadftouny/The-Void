// THE NARRATION CORPUS — what the local model actually said, one JSON object per line.
//
// WHY IT EXISTS. Every rule in `src/llm/textHygiene.ts` can be planted against and unit-tested,
// but no test can produce what a 4B model says on real hardware at real speed. The renderer
// already detects text faults per beat and logs them; this file KEEPS the beat itself, so
// `src/dev/narrationCorpus.test.ts` can re-run today's rules over yesterday's narration —
// which is what turns "the model said something odd once" into a reproducible red test.
//
// ---------------------------------------------------------------------------------------
// ⚠ THIS FILE WRITES THE AUTHOR'S OWN PLAY TO DISK, AND THIS REPOSITORY IS PUBLIC.
//
// Three things keep that safe, and all three are asserted in `corpus.test.mjs`:
//   1. `logs/` and `logs/corpus/` are gitignored, and the corpus test fails if either line
//      leaves `.gitignore`;
//   2. the file is CAPPED and rotates — `CORPUS_CAP_BYTES` with EXACTLY TWO files, so the
//      total can never exceed `2 × cap` plus one over-long line, however long the game is
//      left running. An uncapped append-only file is a disk-filling defect;
//   3. nothing here is ever read by the game. The corpus is a developer artifact.
//
// ---------------------------------------------------------------------------------------
// WHY IT IS NOT A SECOND INSTANCE OF `log.mjs`. That module's state is module-global (one
// directory, one stream, one banner) and its line format is the HUMAN session log's, with a
// 2 000-character cap on `data` — which would truncate exactly the thing we want to keep. So
// this is its own module, with its own file and its own JSONL format.
//
// WHAT IT DOES NOT DUPLICATE: `shouldRotate` is IMPORTED from `log.mjs`. A second copy of the
// rotation predicate is the "duplicated guard that drifts" failure this project already
// catalogues; one of the two would eventually be fixed and the other would not.
//
// WHY THE DIRECTORY IS INJECTED — the same reason `log.mjs` and `model-path.mjs` inject
// theirs (FINDINGS.md G6): `electron-builder` packs `electron/**` INTO the asar archive, so
// any path built from `__dirname` lands in a read-only archive in a packaged build, every
// write throws, and the whole feature becomes a silent no-op that still looks configured.
// NO PATH IS DERIVED FROM `__dirname` ANYWHERE IN THIS FILE, and `corpus.test.mjs` asserts it.
//
// WHERE IT LANDS, and why the two cases differ:
//   dev       -> `<cwd>/logs/corpus/` — the sweep is an `npm test` IN THE REPO, so the corpus
//                must be where the tests are. (`npm run desktop` spawns Electron with the
//                launcher's own cwd, which is the checkout root.)
//   packaged  -> `<userData>/corpus/` — a packaged build has no repo and no writable install
//                directory.
//   either    -> `VOID_CORPUS_DIR` overrides both, so the author can point the game at one
//                place and the test at another (or at a second checkout's corpus).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldRotate } from './log.mjs';

/**
 * Hard ceiling per file; two files exist at most, so the total is ~16 MiB.
 *
 * Sized for the worst case, not the typical one. MEASURED at a mean of 849 bytes per record —
 * roughly DOUBLE the 420 bytes it was before each record started carrying its own five-beat
 * recap (which it must, so the sweep can judge a sentence with the same echo gate the runtime
 * used; see `src/llm/textHygiene.ts`). So 8 MiB is on the order of 10 000 beats per file —
 * about a hundred complete runs — and two files is more history than any regression sweep
 * needs. ⚠ The retained history HALVED when the recap was added; if a record ever grows
 * again, re-measure this number rather than trusting the sentence above it.
 */
export const CORPUS_CAP_BYTES = 8 * 1024 * 1024;

/** The record shape this module accepts. Bumping it is a migration (see the sweep test). */
export const CORPUS_VERSION = 1;

// ---- module state: all of it reset by `configureCorpusDir` --------------------------
let corpusDir = path.join(os.tmpdir(), 'the-void-corpus');
let capBytes = CORPUS_CAP_BYTES;
let mlog = null;
/** Bytes in the current file. `null` = not yet measured; the first write reads the file. */
let bytesWritten = null;
/** Every append is serialized through this chain, so a rotation cannot race a write. */
let chain = Promise.resolve();

/** Report a failure through the injected logger, if there is one. Never throws. */
function say(level, message, data) {
  try {
    mlog?.(level, 'corpus', message, data);
  } catch {
    /* an instrument that crashes the app is worse than no instrument */
  }
}

/**
 * Where the corpus lives — PURE, no filesystem, no `__dirname`.
 *
 * `VOID_CORPUS_DIR` wins outright so one machine can point the game and the sweep at the
 * same folder across checkouts.
 */
export function resolveCorpusDir({ env = {}, dev = false, cwd, userDataDir } = {}) {
  const override = env.VOID_CORPUS_DIR;
  if (typeof override === 'string' && override.trim() !== '') return override;
  if (dev) return path.join(cwd ?? '.', 'logs', 'corpus');
  return path.join(userDataDir ?? os.tmpdir(), 'corpus');
}

/** The absolute path of the current corpus file. */
export function corpusFilePath() {
  return path.join(corpusDir, 'narration.jsonl');
}

/** The previous file — the second and last of the two the cap allows. */
export function rotatedCorpusPath() {
  return corpusFilePath() + '.1';
}

/**
 * Point the corpus at `dir` (created lazily, on the first accepted record). Returns the file
 * path. `opts.capBytes` exists so the rotation policy can be exercised at a tiny cap instead
 * of by writing sixteen megabytes; `opts.log` is the `mlog(level, category, message, data)`
 * the main process already has.
 */
export function configureCorpusDir(dir, opts = {}) {
  corpusDir = dir;
  capBytes = Number.isFinite(opts.capBytes) && opts.capBytes > 0 ? opts.capBytes : CORPUS_CAP_BYTES;
  mlog = typeof opts.log === 'function' ? opts.log : null;
  bytesWritten = null;
  return corpusFilePath();
}

/**
 * One corpus line, exactly — PURE. No clock, no filesystem, so it can be asserted character
 * for character, and NEVER throws whatever it is handed.
 *
 * Returns `null` for anything that is not a versioned record with text in it. The renderer
 * sends over IPC, so this is the only place that can tell a real beat from a stray message,
 * and a rejected record must not be written: a corpus with junk in it fails the sweep for
 * reasons that have nothing to do with the model.
 */
export function corpusLine(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  if (record.v !== CORPUS_VERSION) return null;
  if (typeof record.text !== 'string' || record.text === '') return null;
  let json;
  try {
    json = JSON.stringify(record);
  } catch {
    return null; // circular, a BigInt, anything else JSON refuses
  }
  if (typeof json !== 'string') return null;
  // A newline inside the payload would split one record into two unparseable halves.
  // `JSON.stringify` escapes them, so this is an assertion rather than a repair.
  if (json.includes('\n')) return null;
  return json + '\n';
}

/** The size of the current file on disk, or 0 if it is not there yet. */
function sizeOnDisk() {
  try {
    return fs.statSync(corpusFilePath()).size;
  } catch {
    return 0;
  }
}

/** Rename the current file aside, replacing any previous one. Best-effort, and it logs. */
function rotate() {
  try {
    fs.rmSync(rotatedCorpusPath(), { force: true });
    if (fs.existsSync(corpusFilePath())) fs.renameSync(corpusFilePath(), rotatedCorpusPath());
    say('info', 'corpus rotated', { to: rotatedCorpusPath(), capBytes });
  } catch (err) {
    // Log BEFORE recovering: if the rename fails we keep appending, which overshoots the cap
    // rather than losing the corpus — and this line is the only evidence it happened.
    say('error', 'corpus rotate FAILED', { message: String(err?.message ?? err) });
  }
}

/** The one place bytes reach the file. Serialized by the chain in `appendCorpus`. */
async function writeLine(line) {
  const bytes = Buffer.byteLength(line);
  try {
    fs.mkdirSync(corpusDir, { recursive: true });
  } catch (err) {
    say('error', 'corpus dir FAILED', { dir: corpusDir, message: String(err?.message ?? err) });
    return;
  }
  if (bytesWritten === null) bytesWritten = sizeOnDisk();
  if (shouldRotate(bytesWritten, bytes, capBytes)) {
    rotate();
    bytesWritten = 0;
  }
  try {
    await fs.promises.appendFile(corpusFilePath(), line, 'utf8');
    bytesWritten += bytes;
  } catch (err) {
    say('error', 'corpus write FAILED', {
      file: corpusFilePath(),
      message: String(err?.message ?? err),
    });
  }
}

/**
 * Record one narration beat. Returns whether the record was ACCEPTED (not whether it has
 * landed on disk — the write is async, and nothing on the hot path waits for it).
 *
 * A rejected record logs before it is dropped: a corpus that silently ignores what the
 * renderer sends is indistinguishable from a renderer that never sends anything.
 */
export function appendCorpus(record) {
  const line = corpusLine(record);
  if (line === null) {
    say('warn', 'corpus record REJECTED', {
      reason: 'not a v1 record with text',
      type: typeof record,
      v: record && typeof record === 'object' ? record.v : undefined,
    });
    return false;
  }
  chain = chain.then(() => writeLine(line)).catch(() => undefined);
  return true;
}

/**
 * Resolve once every accepted record has been written. Exists for tests and for an orderly
 * shutdown; nothing on the hot path awaits it.
 */
export async function flushCorpus() {
  await chain;
}
