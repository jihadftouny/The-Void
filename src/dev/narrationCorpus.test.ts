// THE CORPUS SWEEP — replay what the local model actually said, against today's rules.
//
// WHY THIS EXISTS. Every rule in `src/llm/textHygiene.ts` can be planted against and unit
// tested, and `placeholderRatchet.test.ts` runs them over twenty seeded runs of ENGINE text.
// Neither can produce a single sentence a 4B model writes on real hardware. So the renderer
// records each narration to a capped, gitignored corpus (`electron/corpus.mjs`), and this
// file re-runs the MODEL rule list over every record in it. A beat that was clean under last
// month's rules and is a fault under this month's goes red here, with the seed and beat
// number that produced it.
//
// ---------------------------------------------------------------------------------------
// THE TRAP THIS FILE IS BUILT AROUND: "skipped" MUST NEVER LOOK LIKE "passed".
//
// A fresh clone has no corpus. CI has no corpus. A worktree has no corpus. So the disk sweep
// SKIPS — visibly, with the path it looked at in its own name — rather than failing, and the
// question becomes "is the sweep itself any good?", which nobody can answer from a skipped
// test. The answer is PART 1 below: the parser and the reporter are exercised against an
// IN-MEMORY fixture on every single run, including a record authored by hand to be faulty.
// If the sweep were broken, PART 1 would be red on a machine that has never played the game.
// ---------------------------------------------------------------------------------------
//
// HOW TO PRODUCE A CORPUS: play with `npm run desktop`. Each narrated beat appends one line
// to `logs/corpus/narration.jsonl` (gitignored — this repository is public and the corpus is
// the author's own play). `VOID_CORPUS_DIR` points this test at any other folder, including
// another checkout's.
//
// ---------------------------------------------------------------------------------------
// ⚠ IT WENT RED AND THE SENTENCE IS FINE. WHAT NOW? — read this before deleting anything.
//
// The rules are narrow but they are not perfect, and this test runs over PROSE A MODEL WROTE.
// Sooner or later it will flag a sentence that is actually good. When it does there are three
// answers, and only one of them is right:
//
//   ✗ DELETE THE CORPUS. Never. The corpus IS the evidence — it is the only record of what
//     the narrator really does, on real hardware, and it cannot be regenerated. Deleting it to
//     get a green suite destroys the thing the suite exists to protect.
//   ✗ REWRITE THE RULE to let that one sentence through. Only if the rule is genuinely wrong
//     for a whole CLASS of prose — and then it belongs in `src/llm/textHygiene.ts` with a
//     planted case and an entry in that file's clean-prose body, not here.
//   ✓ ADD A ROW TO `ALLOWANCES` BELOW, with a reason. That makes accepting the sentence a
//     RECORDED, REVIEWABLE DECISION rather than a silent one, and the exercised-loop keeps it
//     honest: a row that stops matching fails and tells you to delete it.
//
// This is the same mechanism, and the same discipline, as `placeholderRatchet.test.ts`'s
// allowance table. It is here because without it the first good sentence that trips a rule
// makes `npm test` permanently red on the author's own machine, with deleting the evidence as
// the only way out — which is a trap, not a guard.
// ---------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_TEXT_RULES,
  MODEL_TEXT_RULES,
  buildVocabulary,
  detectTextFaults,
  type TextRuleId,
  type TextVocabulary,
} from '../llm/textHygiene.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VOCAB = buildVocabulary();
/** This file, read as text — for the one guard that must check its own wiring. */
const SOURCE = readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** The record shape `electron/corpus.mjs` writes. Only `v` and `text` are load-bearing. */
interface CorpusRecord {
  v: number;
  text: string;
  seed?: number;
  beat?: number;
  floor?: number;
  floorName?: string;
  facts?: readonly string[];
  /**
   * The "Recent moments" block the model was shown with this beat. ADDITIVE within v1: a
   * record written before it existed simply has none, and the gate is then narrower for that
   * record — which under-reports rather than over-reports, the safe direction for a
   * back-compatible field.
   */
  recap?: readonly string[];
}

/** The version this sweep understands. A record from the future is a migration, not a line. */
const SUPPORTED_VERSION = 1;

/** The most offending lines a failure prints. Beyond this the list stops being readable. */
const MAX_REPORTED = 20;

/** A named, reasoned exception to one rule, matched against the WHOLE narration. */
export interface CorpusAllowance {
  rule: TextRuleId;
  /** Matched against the record's `text`. Keep it TIGHT — a broad pattern is a hole. */
  where: RegExp;
  /** Why this sentence is accepted. An allowance with no reason is an unexplained hole. */
  reason: string;
}

/**
 * THE ONE ALLOWANCE TABLE for the corpus sweep — see the header for when to add to it.
 *
 * EMPTY TODAY, and that is the honest state: no corpus has been swept yet, so nothing has been
 * accepted. The mechanism is NOT untested for being empty — `the allowance mechanism works`
 * below drives it against a fixture, because a loop over an empty table proves nothing about
 * the table.
 *
 * Every row is counted; inside the disk sweep a loop fails any row that matched NOTHING and
 * says to delete it. An allowance nobody hits is an allowance nobody can tell is wrong.
 */
export const ALLOWANCES: readonly CorpusAllowance[] = [];

// =========================================================================================
// The parser and the reporter — the two pure halves PART 1 exercises
// =========================================================================================

interface ParseResult {
  /** Every line that parsed as JSON, in file order, with its 1-based line number. */
  records: { line: number; value: unknown }[];
  /** Line numbers (1-based) that are NOT valid JSON and are not a torn tail. */
  malformed: number[];
  /**
   * How many torn tails were tolerated. A corpus is appended to while the game runs, so the
   * LAST line of a file whose process was killed mid-write can be a partial object. That is
   * expected and harmless; a broken line anywhere ELSE means something corrupted the file.
   */
  torn: number;
}

/** Read a JSONL corpus — PURE, no filesystem, so it can be exercised against a fixture. */
export function parseCorpus(text: string): ParseResult {
  const lines = text.split('\n');
  const records: { line: number; value: unknown }[] = [];
  const malformed: number[] = [];
  let torn = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] as string;
    if (raw.trim() === '') continue;
    try {
      records.push({ line: i + 1, value: JSON.parse(raw) as unknown });
    } catch {
      // The tail is only "torn" when it is genuinely the end of the file with no newline
      // after it — a complete file ends in '\n', so its last element is the empty string
      // and never reaches here.
      if (i === lines.length - 1) torn += 1;
      else malformed.push(i + 1);
    }
  }
  return { records, malformed, torn };
}

/** One thing wrong with the corpus, in the terms a person would use to chase it. */
type Problem =
  | {
      kind: 'fault';
      line: number;
      seed: number | undefined;
      beat: number | undefined;
      floor: number | undefined;
      floorName: string | undefined;
      text: string;
      rule: string;
      match: string;
    }
  | { kind: 'version'; line: number; v: unknown }
  | { kind: 'shape'; line: number; why: string };

/**
 * Re-run the MODEL rules over every record — PURE over the parsed records and a vocabulary.
 *
 * `echoOf` is the beat's OWN engine facts, exactly as the renderer passed them at the time,
 * so a model that obediently repeated a reserved word the engine handed it is not reported
 * a second time by a sweep that has forgotten the context.
 */
/** What one sweep found, and which allowances absorbed something along the way. */
export interface SweepResult {
  problems: Problem[];
  /** How often each row of the supplied table matched, in the table's own order. */
  allowed: number[];
}

export function sweepRecords(
  records: readonly { line: number; value: unknown }[],
  vocab: TextVocabulary,
  allowances: readonly CorpusAllowance[],
): SweepResult {
  const problems: Problem[] = [];
  const allowed = allowances.map(() => 0);
  for (const { line, value } of records) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      problems.push({ kind: 'shape', line, why: 'not a JSON object' });
      continue;
    }
    const record = value as Partial<CorpusRecord>;
    if (record.v !== SUPPORTED_VERSION) {
      problems.push({ kind: 'version', line, v: record.v });
      continue;
    }
    if (typeof record.text !== 'string') {
      problems.push({ kind: 'shape', line, why: 'no text' });
      continue;
    }
    // THE SAME GATE THE RENDERER USED: this beat's facts AND the recap it was shown. A
    // narrower gate here would make the sweep disagree with the runtime about the same
    // sentence, which is the one thing two consumers of one rule set may not do.
    const echoOf = [
      ...(Array.isArray(record.facts) ? record.facts : []),
      ...(Array.isArray(record.recap) ? record.recap : []),
    ];
    const { faults } = detectTextFaults(record.text, vocab, {
      rules: MODEL_TEXT_RULES,
      echoOf,
    });
    for (const fault of faults) {
      // An accepted sentence is counted, not reported. The row's reason is on file above.
      const row = allowances.findIndex(
        (a) => a.rule === fault.rule && a.where.test(record.text as string),
      );
      if (row >= 0) {
        allowed[row] = (allowed[row] ?? 0) + 1;
        continue;
      }
      problems.push({
        kind: 'fault',
        line,
        seed: record.seed,
        beat: record.beat,
        floor: record.floor,
        floorName: record.floorName,
        text: record.text,
        rule: fault.rule,
        match: fault.match,
      });
    }
  }
  return { problems, allowed };
}

/** The failure message: one line per problem, capped, each naming where to look. */
export function describeProblems(problems: readonly Problem[]): string {
  if (problems.length === 0) return '';
  const head = problems.slice(0, MAX_REPORTED).map((p) => {
    if (p.kind === 'version') {
      return `  line ${p.line}: corpus record version ${String(p.v)} — MIGRATE THIS TEST (it reads v${SUPPORTED_VERSION})`;
    }
    if (p.kind === 'shape') return `  line ${p.line}: ${p.why}`;
    return (
      `  line ${p.line} · seed ${String(p.seed)} · beat ${String(p.beat)} · ` +
      `floor ${String(p.floor)} (${String(p.floorName)}) · [${p.rule}] "${p.match}"\n` +
      `      ${p.text}`
    );
  });
  const more = problems.length > MAX_REPORTED ? [`  ...and ${problems.length - MAX_REPORTED} more`] : [];
  return [...head, ...more].join('\n');
}

// =========================================================================================
// PART 1 — the sweep is PROVED TO FIRE, on every run, with no corpus on disk
// =========================================================================================

/** A hand-authored record. `text` is the only thing the sweep judges. */
function record(over: Partial<CorpusRecord> & { text: string }): CorpusRecord {
  return {
    v: 1,
    seed: 1,
    beat: 0,
    floor: 1,
    floorName: 'Undercity',
    facts: [],
    ...over,
  };
}

/** A fixture corpus: three records, exactly one of them faulty, written out by hand. */
const FIXTURE = [
  record({ text: 'The dark closes over you.', beat: 0 }),
  // TWO faults, derived by hand from the rules in `src/llm/textHygiene.ts`:
  //   `second floor`       — ordinal-floor. A floor has a NAME; floor 1 is the Undercity.
  //   `floor of the Void`  — void-as-place. WORLD.md §6: the Void has no floors, because it
  //                          is not a place. (A bare "of the Void" would NOT fire on its own;
  //                          it is the part-of-a-building noun in front of it that does.)
  record({ text: 'You step onto the second floor of the Void.', beat: 1, seed: 4242 }),
  record({ text: 'Something moves in the dark.', beat: 2 }),
];

const FIXTURE_TEXT = FIXTURE.map((r) => JSON.stringify(r)).join('\n') + '\n';

describe('the sweep FIRES — proved against a fixture, so a skipped disk sweep means nothing', () => {
  it('parses every complete line and reports nothing malformed', () => {
    const parsed = parseCorpus(FIXTURE_TEXT);
    expect(parsed.records).toHaveLength(3);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.torn).toBe(0);
    expect(parsed.records.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it('blank lines are not records, and do not count as damage', () => {
    const parsed = parseCorpus('\n' + FIXTURE_TEXT + '\n\n');
    expect(parsed.records).toHaveLength(3);
    expect(parsed.malformed).toEqual([]);
  });

  it('a TORN LAST LINE is tolerated — the game was killed mid-append', () => {
    const parsed = parseCorpus(FIXTURE_TEXT + '{"v":1,"text":"half a rec');
    expect(parsed.records, 'the complete records before the tear were lost').toHaveLength(3);
    expect(parsed.torn).toBe(1);
    expect(parsed.malformed).toEqual([]);
  });

  it('...but a broken line ANYWHERE ELSE is damage, and is named by line number', () => {
    const parsed = parseCorpus('{"v":1,"text":"ok"}\nnot json at all\n{"v":1,"text":"fine"}\n');
    expect(parsed.malformed, 'a corrupted line in the middle was silently skipped').toEqual([2]);
    expect(parsed.torn).toBe(0);
    expect(parsed.records).toHaveLength(2);
  });

  it('THE FAULTY RECORD IS FOUND, and only it', () => {
    const problems = sweepRecords(parseCorpus(FIXTURE_TEXT).records, VOCAB, []).problems;
    expect(problems.map((p) => (p.kind === 'fault' ? `${p.rule}:${p.match}` : p.kind))).toEqual([
      'ordinal-floor:second floor',
      'void-as-place:floor of the Void',
    ]);
    // ...and both point at the record that carries them, not at the clean ones.
    for (const p of problems) {
      expect(p.kind).toBe('fault');
      if (p.kind !== 'fault') continue;
      expect(p.line).toBe(2);
      expect(p.seed).toBe(4242);
      expect(p.beat).toBe(1);
    }
  });

  it('THE CONTROL: a corpus of only clean beats produces nothing', () => {
    // Without this, "the faulty record is found" is satisfied by a sweep that flags every
    // record it reads.
    const clean = [FIXTURE[0]!, FIXTURE[2]!].map((r) => JSON.stringify(r)).join('\n') + '\n';
    expect(sweepRecords(parseCorpus(clean).records, VOCAB, []).problems).toEqual([]);
  });

  it('a beat that ECHOES an engine fact is not reported for the echo', () => {
    // The ascension ending hands the model "made whole". Repeating it is obedience.
    const body = 'You are judged worthy and rise from the Void, made whole.';
    const echoing = JSON.stringify(record({ text: 'You are made whole.', facts: [body] })) + '\n';
    const inventing = JSON.stringify(record({ text: 'You are made whole.', facts: [] })) + '\n';
    expect(sweepRecords(parseCorpus(echoing).records, VOCAB, []).problems).toEqual([]);
    expect(sweepRecords(parseCorpus(inventing).records, VOCAB, []).problems).toHaveLength(1);
  });

  it('THE ALLOWANCE MECHANISM WORKS — a row absorbs a fault, and is counted', () => {
    // The real table is EMPTY, so a loop over it would prove nothing. This drives it
    // directly, which is the only way an empty guard can be known to work.
    const table: CorpusAllowance[] = [
      {
        rule: 'ordinal-floor',
        where: /You step onto the second floor of the Void\./,
        reason: 'a fixture sentence, accepted so the mechanism can be exercised at all',
      },
    ];
    const swept = sweepRecords(parseCorpus(FIXTURE_TEXT).records, VOCAB, table);
    // The ordinal-floor fault is gone and counted; the void-as-place fault, which the row
    // does NOT name, survives. An allowance covers ONE rule, not a whole sentence.
    expect(swept.problems.map((p) => (p.kind === 'fault' ? p.rule : p.kind))).toEqual([
      'void-as-place',
    ]);
    expect(swept.allowed).toEqual([1]);
  });

  it('...and a row that matches nothing absorbs nothing and counts zero', () => {
    const table: CorpusAllowance[] = [
      { rule: 'ordinal-floor', where: /never in this corpus/, reason: 'a row that is dead weight' },
    ];
    const swept = sweepRecords(parseCorpus(FIXTURE_TEXT).records, VOCAB, table);
    expect(swept.problems).toHaveLength(2);
    expect(swept.allowed, 'a dead row must be visibly dead, so the loop can fail it').toEqual([0]);
  });

  it('...and a row for the WRONG RULE absorbs nothing either', () => {
    // The tightening that matters: `where` alone would let one row quietly cover every rule
    // a sentence happens to trip.
    const table: CorpusAllowance[] = [
      {
        rule: 'reserved-word',
        where: /You step onto the second floor of the Void\./,
        reason: 'right sentence, wrong rule — must not absorb anything',
      },
    ];
    const swept = sweepRecords(parseCorpus(FIXTURE_TEXT).records, VOCAB, table);
    expect(swept.problems).toHaveLength(2);
    expect(swept.allowed).toEqual([0]);
  });

  it('a record\'s OWN RECAP feeds the echo gate, the way the renderer fed it', () => {
    // The sweep must judge a sentence exactly as the runtime did. The beat's facts never
    // mention Exposed; the recap the model was shown does.
    const text = 'You press the advantage. Exposed.';
    const withRecap =
      JSON.stringify(record({ text, facts: ['You deal 4 damage.'], recap: ['You strike. The enemy is Exposed.'] })) + '\n';
    const problems = sweepRecords(parseCorpus(withRecap).records, VOCAB, []).problems;
    expect(problems.map((p) => (p.kind === 'fault' ? `${p.rule}:${p.match}` : p.kind))).toEqual([
      'condition-label:Exposed',
    ]);
  });

  it('...and a record written BEFORE the recap field simply has a narrower gate', () => {
    // Additive within v1: an older record under-reports rather than over-reports, which is
    // the safe direction — it can never invent a fault that the runtime did not see.
    const text = 'You press the advantage. Exposed.';
    const older = JSON.stringify(record({ text, facts: ['You deal 4 damage.'] })) + '\n';
    expect(sweepRecords(parseCorpus(older).records, VOCAB, []).problems).toEqual([]);
  });

  it('a record from a FUTURE version says to migrate this test, rather than passing', () => {
    const future = JSON.stringify({ ...record({ text: 'anything at all' }), v: 2 }) + '\n';
    const problems = sweepRecords(parseCorpus(future).records, VOCAB, []).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe('version');
    expect(describeProblems(problems)).toContain('MIGRATE THIS TEST');
  });

  it('a line that is valid JSON but not a record is reported by shape', () => {
    const problems = sweepRecords(parseCorpus('[1,2,3]\n"a string"\n{"v":1}\n').records, VOCAB, []).problems;
    expect(problems.map((p) => p.kind)).toEqual(['shape', 'shape', 'shape']);
  });

  it('the report names the seed, the beat, the floor, the rule and the sentence', () => {
    const message = describeProblems(sweepRecords(parseCorpus(FIXTURE_TEXT).records, VOCAB, []).problems);
    for (const needle of [
      'seed 4242',
      'beat 1',
      'floor 1',
      'Undercity',
      '[ordinal-floor]',
      'second floor',
      'You step onto the second floor of the Void.',
    ]) {
      expect(message, `the failure message does not name ${needle}`).toContain(needle);
    }
  });

  it('the report is CAPPED, so one bad night does not print a thousand lines', () => {
    const many = Array.from({ length: MAX_REPORTED + 10 }, (_, i) =>
      JSON.stringify(record({ text: 'You step onto the second floor.', beat: i })),
    ).join('\n');
    const problems = sweepRecords(parseCorpus(many).records, VOCAB, []).problems;
    expect(problems).toHaveLength(MAX_REPORTED + 10);
    const message = describeProblems(problems);
    expect(message).toContain('...and 10 more');
    // Each fault prints two lines (the locator and the sentence), plus the "more" line.
    expect(message.split('\n')).toHaveLength(MAX_REPORTED * 2 + 1);
  });

  it('nothing at all is not a failure', () => {
    expect(parseCorpus('').records).toEqual([]);
    expect(describeProblems([])).toBe('');
  });
});

// =========================================================================================
// The corpus can never be committed. THIS REPOSITORY IS PUBLIC.
// =========================================================================================

describe('the allowance table is disciplined, however many rows it has', () => {
  it('every row names a real rule and carries a reason', () => {
    for (const a of ALLOWANCES) {
      expect(ALL_TEXT_RULES, `unknown rule ${a.rule}: ${a.reason}`).toContain(a.rule);
      expect(
        a.reason.length,
        `an allowance with no reason is an unexplained hole: ${a.where.source}`,
      ).toBeGreaterThan(20);
      // A row that matches everything is not an allowance, it is a disabled rule.
      expect(a.where.source.length, `${a.reason}: the pattern is too broad`).toBeGreaterThan(8);
    }
  });

  it('the sweep really consults it (the disk sweep below passes the real table)', () => {
    // Anchored, so that emptying the table is not the same as unplugging the mechanism.
    expect(Array.isArray(ALLOWANCES)).toBe(true);
    expect(SOURCE, 'the disk sweep no longer passes the allowance table').toMatch(
      /sweepRecords\(p\.records, VOCAB, ALLOWANCES\)/,
    );
  });
});

describe('the corpus can never be committed', () => {
  const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const lines = gitignore.split('\n').map((l) => l.trim());

  it('.gitignore excludes logs/ AND names logs/corpus/ explicitly', () => {
    // The first line is what actually does the work today; the second states the intent
    // where somebody restructuring `logs/` will see it. Both, because a corpus of the
    // author's own play committed to a public repository cannot be un-published.
    expect(lines, '.gitignore no longer excludes logs/ — the corpus would be committable').toContain('logs/');
    expect(lines, '.gitignore no longer names logs/corpus/').toContain('logs/corpus/');
  });

  it('...and the file really was read (or the two assertions above are vacuous)', () => {
    expect(gitignore.length).toBeGreaterThan(100);
    expect(lines).toContain('node_modules/');
  });
});

// =========================================================================================
// PART 2 — the disk sweep. SKIPPED, visibly, when there is nothing to sweep.
// =========================================================================================

const CORPUS_DIR = process.env['VOID_CORPUS_DIR'] ?? path.join(ROOT, 'logs', 'corpus');
const FILES = ['narration.jsonl', 'narration.jsonl.1']
  .map((f) => path.join(CORPUS_DIR, f))
  .filter((f) => existsSync(f));

describe.skipIf(FILES.length === 0)(
  `CORPUS — what the real model said, re-swept with the current rules (looked in ${CORPUS_DIR}; ` +
    'SKIPPED when empty — play with `npm run desktop` to produce one, or set VOID_CORPUS_DIR ' +
    "to another checkout's logs/corpus)",
  () => {
    const parsed = FILES.map((file) => ({ file, ...parseCorpus(readFileSync(file, 'utf8')) }));

    it('every file parsed, with no damage beyond a torn final line', () => {
      for (const p of parsed) {
        expect(
          p.malformed,
          `${p.file}: malformed line(s) — something other than the game wrote to the corpus`,
        ).toEqual([]);
      }
    });

    it('the sweep read real records (or it proves nothing about this machine)', () => {
      const total = parsed.reduce((n, p) => n + p.records.length, 0);
      expect(total, `${CORPUS_DIR} exists but holds no records`).toBeGreaterThan(0);
    });

    const swept = parsed.map((p) => sweepRecords(p.records, VOCAB, ALLOWANCES));

    it('nothing the model said breaks a text rule', () => {
      const problems = swept.flatMap((r) => r.problems);
      expect(
        describeProblems(problems),
        `${problems.length} problems in ${CORPUS_DIR}. THESE SENTENCES ARE REAL — read the ` +
          'block at the top of this file before you do anything to the corpus. If one of them ' +
          'is good writing, add a row to ALLOWANCES with a reason; never delete the corpus.',
      ).toBe('');
    });

    // One `it` per allowance row, generated — so a row can never be added without being
    // proved live, and the day the model stops writing the accepted sentence, this says so.
    describe('the allowances are all EXERCISED, so none is dead weight', () => {
      it('the table was applied to every file', () => {
        expect(swept).toHaveLength(parsed.length);
        for (const r of swept) expect(r.allowed).toHaveLength(ALLOWANCES.length);
      });

      ALLOWANCES.forEach((allowance, i) => {
        it(`[${allowance.rule}] ${allowance.where.source} is exercised`, () => {
          const hits = swept.reduce((n, r) => n + (r.allowed[i] ?? 0), 0);
          expect(
            hits,
            'this allowance matched NOTHING in the corpus on this machine. Either the model no ' +
              'longer writes the sentence it accepts — in which case DELETE the row, that is the ' +
              'ratchet turning — or the corpus was replaced. Reason on file: ' +
              allowance.reason,
          ).toBeGreaterThan(0);
        });
      });
    });
  },
);
