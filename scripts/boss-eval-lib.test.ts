// The boss evaluation's pure core (AC-17), the entry's safety (AC-29, which replaced AC-18's scans)
// and the drafted test set (AC-19).
// NEVER the real model: every "model answer" below is a scripted string. Expected numbers are
// derived by hand in the comments beside them.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVocabulary } from '../src/llm/textHygiene.ts';
import { argsOf, callsTo, stripComments } from '../src/log/sourceScan.testutil.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { BOSS_PERSONA_IDS } from '../src/llm/bossContract.ts';
import { createSequenceQueue } from '../electron/llm-queue.mjs';
import {
  FIXTURE_NAME,
  FIXTURE_PERSONAS,
  FIXTURE_PERSONA_LIST,
  fight,
  sceneRequest,
  talkRequest,
  turnRequest,
} from '../src/llm/bossFixtures.testutil.ts';
import {
  DRAFT_STATUS,
  MESSAGE_GROUPS,
  electronUserDataDir,
  EXIT,
  emptyGate,
  exitCode,
  gateConversation,
  recordGateResult,
  hollowGate,
  outcomeOf,
  messageSetProblems,
  messagesFor,
  parseArgs,
  percentile,
  pickModelFile,
  planCalls,
  renderReport,
  runConversation,
  scoreCall,
  summarize,
  type CallRecord,
  type GateGroup,
  type MessageSet,
  type RawResult,
} from './boss-eval-lib.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SET = JSON.parse(readFileSync(path.join(HERE, 'boss-eval', 'messages.json'), 'utf8')) as MessageSet;
const vocab = buildVocabulary();

const answer = (text: string, extra: Partial<RawResult> = {}): RawResult => ({
  ok: true,
  text,
  timedOut: false,
  ttftMs: 300,
  generateMs: 900,
  grammarMs: 10,
  promptTokens: 850,
  tokens: 30,
  ...extra,
});

/** n outcomes: `hits` of them at `at`, the rest never. */
const outcomes = (hits: number, of: number, at: number | null): (number | null)[] =>
  Array.from({ length: of }, (_, i) => (i < hits ? at : null));

describe('the §7.1 gate arithmetic', () => {
  it('manipulation ceiling: 6 of 40 surrendering is 15.0% → PASS; 7 of 40 is 17.5% → FAIL', () => {
    const pass = hollowGate({ manipulative: outcomes(6, 40, 12), genuine: [], offTarget: [] })[0];
    expect(pass).toMatchObject({ verdict: 'PASS', count: 6, of: 40, measured: '6 of 40 = 15.0%', mark: '≤ 15%' });
    const fail = hollowGate({ manipulative: outcomes(7, 40, 12), genuine: [], offTarget: [] })[0];
    expect(fail).toMatchObject({ verdict: 'FAIL', measured: '7 of 40 = 17.5%' });
    // At the scale of three runs (120 conversations) the edge is one conversation wide:
    // 18/120 = 15.0% passes, 19/120 = 15.8% fails — no rounding slack survives this.
    expect(hollowGate({ manipulative: outcomes(18, 120, 4), genuine: [], offTarget: [] })[0]?.verdict).toBe('PASS');
    expect(hollowGate({ manipulative: outcomes(19, 120, 4), genuine: [], offTarget: [] })[0]?.verdict).toBe('FAIL');
  });

  it('genuine acceptance: first message ≥ 60% (24/40 passes, 23/40 fails); by the third ≥ 90% (36/40, 35/40)', () => {
    const first = (n: number) => hollowGate({ manipulative: [], genuine: [...outcomes(n, n, 0), ...outcomes(0, 40 - n, null)], offTarget: [] })[1];
    expect(first(24)?.verdict).toBe('PASS');
    expect(first(23)?.verdict).toBe('FAIL');
    // A LATER acceptance is not a first-message acceptance: 23 at message one and 17 at message
    // two is 23/40 = 57.5% on the first message → FAIL (while the by-third target passes, 40/40).
    const mixed = hollowGate({ manipulative: [], genuine: [...outcomes(23, 23, 0), ...outcomes(17, 17, 1)], offTarget: [] });
    expect(mixed[1]).toMatchObject({ verdict: 'FAIL', count: 23, of: 40, measured: '23 of 40 = 57.5%' });
    expect(mixed[2]).toMatchObject({ verdict: 'PASS', count: 40 });
    // By the third: a surrender at index 0, 1 or 2 counts; index 3 does not.
    const third = (atTwo: number, atThree: number) =>
      hollowGate({ manipulative: [], genuine: [...outcomes(atTwo, atTwo, 2), ...outcomes(atThree, atThree, 3), ...outcomes(0, 40 - atTwo - atThree, null)], offTarget: [] })[2];
    expect(third(36, 4)?.verdict).toBe('PASS');
    expect(third(35, 5)?.verdict).toBe('FAIL');
  });

  it('sincere but off-target: accepted alone ≤ 20% (8/40 passes, 9/40 fails)', () => {
    const off = (n: number) => hollowGate({ manipulative: [], genuine: [], offTarget: Array.from({ length: 40 }, (_, i) => i < n) })[3];
    expect(off(8)?.verdict).toBe('PASS');
    expect(off(9)?.verdict).toBe('FAIL');
  });

  it('a target with no data is NOT RUN, and NOT RUN does not fail the exit status', () => {
    const t = hollowGate({ manipulative: [], genuine: [], offTarget: [] });
    expect(t.map((x) => x.verdict)).toEqual(['NOT RUN', 'NOT RUN', 'NOT RUN', 'NOT RUN']);
    expect(exitCode(summarize([], { manipulative: [], genuine: [], offTarget: [] }))).toBe(0);
    // Fix round 3 (F8b): NOT RUN survives only where its group made NO calls. With nothing at all,
    // all six targets are NOT RUN and the exit is 0.
    const none = summarize([], emptyGate());
    expect(none.targets.map((x) => x.verdict)).toEqual(Array.from({ length: 6 }, () => 'NOT RUN'));
    expect(exitCode(none)).toBe(EXIT.pass);
    // The `--group turn` workflow: ten Turn records, nothing else. The Talk and gate targets' groups
    // made no calls, so they stay NOT RUN — and the run passes on its one judged target.
    const kingpinTurn = turnRequest(FIXTURE_PERSONAS.kingpin, fight([20, 20, []], [20, 20, []], 1));
    const turns = Array.from({ length: 10 }, () =>
      scoreCall(kingpinTurn, answer('{"move":"strike","line":"Sit."}'), { group: 'turn', run: 1, previous: [] }, vocab),
    );
    const turnOnly = summarize(turns, emptyGate());
    expect(turnOnly.targets.map((x) => x.verdict)).toEqual(['PASS', 'NOT RUN', 'NOT RUN', 'NOT RUN', 'NOT RUN', 'NOT RUN']);
    expect(renderReport(turnOnly)).toContain('RESULT: PASS');
    expect(exitCode(turnOnly)).toBe(EXIT.pass);
  });
});

describe('a Hollow Self conversation', () => {
  const MESSAGES = Array.from({ length: 10 }, (_, i) => `message ${String.fromCharCode(97 + i)}`);

  it('STOPS at its first surrender', async () => {
    let asked = 0;
    const result = await runConversation(MESSAGES, async () => {
      asked += 1;
      return { reply: 'No.', concession: asked === 3 ? 'surrender' : 'none' };
    });
    expect(result.surrenderedAt).toBe(2);
    expect(asked).toBe(3);
    expect(result.turns).toHaveLength(3);
  });

  it('judges the last six exchanges only, oldest first', async () => {
    const windows: string[][] = [];
    await runConversation(MESSAGES, async (window, typed) => {
      windows.push(window.map((x) => x.them));
      return { reply: `re: ${typed}`, concession: 'none' };
    });
    expect(windows[0]).toEqual([]);
    expect(windows[3]).toEqual(MESSAGES.slice(0, 3));
    // The tenth message (index 9) sees exchanges 4..9 → messages at indices 3..8.
    expect(windows[9]).toEqual(MESSAGES.slice(3, 9));
    expect(Math.max(...windows.map((w) => w.length))).toBe(6);
  });

  it('an answer with no concession is a refusal, and the conversation goes on', async () => {
    const result = await runConversation(MESSAGES.slice(0, 3), async () => ({ reply: "I'm you.", concession: null }));
    expect(result).toMatchObject({ surrenderedAt: null, failedAt: null });
    expect(result.turns).toHaveLength(3);
    expect(outcomeOf(result)).toBeNull();
  });

  it('a FAILED call is asked again — same message, same window — and a retry that answers keeps the conversation', async () => {
    const asks: { typed: string; window: string[] }[] = [];
    const result = await runConversation(MESSAGES, async (window, typed) => {
      asks.push({ typed, window: window.map((x) => x.them) });
      // The fourth call fails; its first retry answers.
      return asks.length === 4 ? { reply: "I'm you.", concession: null, failed: true } : { reply: 'No.', concession: 'none' as const };
    });
    expect(result).toMatchObject({ surrenderedAt: null, failedAt: null, retries: 1, recovered: 1 });
    expect(outcomeOf(result)).toBeNull();
    // 10 messages, 11 calls; calls 4 and 5 are the same message with the same window.
    expect(asks).toHaveLength(11);
    expect(asks[4]).toEqual(asks[3]);
    expect(asks[3]).toEqual({ typed: 'message d', window: ['message a', 'message b', 'message c'] });
    expect(result.turns).toHaveLength(10);
  });

  it('a message that fails on all three attempts stops the conversation, marked failed', async () => {
    let asked = 0;
    const result = await runConversation(MESSAGES, async (_window, typed) => {
      asked += 1;
      return typed === 'message d' ? { reply: "I'm you.", concession: null, failed: true } : { reply: 'No.', concession: 'none' as const };
    });
    // Three messages answered, then message d asked 1 + 2 times.
    expect(result).toMatchObject({ surrenderedAt: null, failedAt: 3, retries: 2, recovered: 0 });
    expect(asked).toBe(6);
    expect(outcomeOf(result)).toBe('failed');
  });
});

describe('reading one call the way the game does', () => {
  const kingpinTurn = turnRequest(FIXTURE_PERSONAS.kingpin, fight([20, 20, []], [20, 20, []], 1));
  const meta = { group: 'turn' as const, run: 1, previous: [] as string[] };

  it('a legal Turn', () => {
    const r = scoreCall(kingpinTurn, answer('{"move":"call_crew","line":"Mind the water."}'), meta, vocab);
    expect(r).toMatchObject({ answered: true, legal: true, line: 'Mind the water.', shown: 'Mind the water.', textFaults: [], nameViolation: false });
    // total = generate 900 + grammar 10.
    expect(r.totalMs).toBe(910);
    expect(r.ttftMs).toBe(300);
  });

  it('an illegal or cut-off Turn counts against the legal-move rate; a timeout is not counted', () => {
    expect(scoreCall(kingpinTurn, answer('{"move":"flee","line":"x"}'), meta, vocab).legal).toBe(false);
    expect(scoreCall(kingpinTurn, answer('{"move":"strike","li'), meta, vocab).legal).toBe(false);
    expect(scoreCall(kingpinTurn, { ok: false, reason: 'timeout' }, meta, vocab)).toMatchObject({ legal: null, answered: false, failure: 'timeout' });
  });

  it('a forbidden name is a violation, shown stripped; the Warden\'s verdict saying it is not', () => {
    const exec = turnRequest(FIXTURE_PERSONAS.executioner, fight([20, 20, []], [20, 20, []], 1));
    const r = scoreCall(exec, answer(`{"move":"strike","line":"For the Ganger, ${FIXTURE_NAME}."}`), meta, vocab);
    expect(r).toMatchObject({ nameViolation: true, shown: 'For the Ganger.' });
    const verdict = sceneRequest(FIXTURE_PERSONAS.warden, { verdict: { outcome: 'grace', name: FIXTURE_NAME } });
    const v = scoreCall(verdict, answer(`{"line":"${FIXTURE_NAME}. You may go on."}`), { group: 'verdict', run: 1, previous: [] }, vocab);
    expect(v).toMatchObject({ nameViolation: false, shown: `${FIXTURE_NAME}. You may go on.` });
  });

  it('text faults and a repeated opening are recorded', () => {
    const r = scoreCall(kingpinTurn, answer('{"move":"strike","line":"The air is 3 degrees colder."}'), { ...meta, previous: ['The air is thick.'] }, vocab);
    expect(r.textFaults).toEqual(expect.arrayContaining(['digit', 'opener-the-air']));
    expect(r.repeatsOpening).toBe(true);
  });

  it('a Talk answer carries its concession', () => {
    const talk = talkRequest(FIXTURE_PERSONAS.kingpin);
    expect(scoreCall(talk, answer('{"reply":"Sit.","concession":"pause"}'), { group: 'genuine-on-target', run: 1, previous: [] }, vocab).concession).toBe('pause');
  });
});

describe('the summary and the report', () => {
  const rec = (over: Partial<CallRecord>): CallRecord => ({
    persona: 'kingpin',
    kind: 'turn',
    group: 'turn',
    run: 1,
    answered: true,
    failure: null,
    legal: true,
    line: 'x',
    shown: 'x',
    concession: null,
    textFaults: [],
    nameViolation: false,
    repeatsOpening: false,
    ttftMs: 100,
    totalMs: 500,
    promptTokens: 800,
    ...over,
  });

  const RECORDS: CallRecord[] = [
    rec({ ttftMs: 100, totalMs: 500, promptTokens: 700 }),
    rec({ ttftMs: 200, totalMs: 700, promptTokens: 900, textFaults: ['digit'] }),
    rec({ ttftMs: 300, totalMs: 900, promptTokens: 800, repeatsOpening: true }),
    rec({ ttftMs: 400, totalMs: 1100, promptTokens: 1000, nameViolation: true }),
    rec({ kind: 'talk', group: 'manipulative', legal: null, concession: 'none', ttftMs: 250, totalMs: 1000 }),
    rec({ kind: 'talk', group: 'manipulative', legal: null, concession: 'surrender', ttftMs: 350, totalMs: 1200 }),
    rec({ persona: 'executioner', kind: 'talk', group: 'rude', legal: null, concession: 'none' }),
  ];

  it('per boss, per kind and per group — hand-computed', () => {
    const s = summarize(RECORDS, { manipulative: outcomes(6, 40, 3), genuine: outcomes(40, 40, 0), offTarget: [false, false] });
    const k = s.personas.find((p) => p.persona === 'kingpin');
    // Four Turns, all legal. Six answered calls: one with a fault (1/6), one repeat (1/6).
    expect(k).toMatchObject({ calls: 6, legalRate: 1, nameViolations: 1 });
    expect(k?.faultRate).toBeCloseTo(1 / 6, 10);
    expect(k?.repetition).toBeCloseTo(1 / 6, 10);
    const turn = s.kinds.find((x) => x.kind === 'turn');
    // Turn ttft 100,200,300,400,100(executioner is talk) → the four Turns: mean 250, p95 (nearest rank 4 of 4) 400.
    expect(turn).toMatchObject({ calls: 4, ttftMean: 250, ttftP95: 400, totalMean: 800, totalP95: 1100 });
    expect(turn).toMatchObject({ promptTokensMin: 700, promptTokensMedian: 800, promptTokensMax: 1000 });
    // Kingpin manipulative: one of two conceded.
    expect(s.concessions.find((c) => c.persona === 'kingpin' && c.group === 'manipulative')).toMatchObject({ calls: 2, rate: 0.5 });
    expect(s.targets.map((t) => [t.target.slice(0, 18), t.verdict])).toEqual([
      ['Legal move rate (m', 'PASS'],
      ['The executioner ne', 'PASS'],
      ['Manipulation ceili', 'PASS'],
      ['Genuine acceptance', 'PASS'],
      ['Genuine acceptance', 'PASS'],
      ['Sincere but off-ta', 'PASS'],
    ]);
    expect(exitCode(s)).toBe(0);
  });

  it('the report carries every number and a PASS/FAIL per target; any FAIL makes the exit non-zero', () => {
    const s = summarize([...RECORDS, rec({ legal: false, answered: false, failure: 'illegal-move' })], {
      manipulative: outcomes(7, 40, 3),
      genuine: [],
      offTarget: [],
    }, { before: { used: 1 }, after: { used: 2 } });
    const report = renderReport(s);
    expect(report).toContain('[FAIL] Legal move rate (must be 100%): 4 of 5 = 80.0% (mark ≥ 100%)');
    expect(report).toContain('[FAIL] Manipulation ceiling (conversations ending in surrender): 7 of 40 = 17.5% (mark ≤ 15%)');
    expect(report).toContain('[NOT RUN] Genuine acceptance — first message');
    expect(report).toContain('[PASS] The executioner never concedes: 0 of 1 = 0.0%');
    expect(report).toContain('250 ms / 400 ms');
    expect(report).toContain('50.0% (2)');
    expect(report).toContain('VRAM before: {"used":1}');
    expect(report).toContain('RESULT: FAIL (2 targets missed)');
    expect(exitCode(s)).toBe(1);
  });

  it('percentile is nearest-rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentile([], 95)).toBeNull();
  });
});

describe('the call plan (printed without --run)', () => {
  it('full: 270 Turn + 450 Talk + 51 Scene + the gate 2,400 + 360 + 120 = 3,651 calls ≈ 73 min', () => {
    // Turn 9 × 30; Talk 9 × 5 groups × 10; Scene 5 × 10 + 1 verdict; gate 40 × 20 × 3,
    // 40 × 3 messages × 3, 40 × 3. At 1.2 s a call: 3,651 × 1.2 / 60 = 73.0 min.
    const plan = planCalls(SET, { group: 'all', runs: 3, quick: false });
    expect(plan).toEqual({ turn: 270, talk: 450, scene: 51, gateManipulative: 2400, gateGenuine: 360, gateOffTarget: 120, total: 3651, minutes: 73 });
  });

  it('quick: one run, ten conversations a gate group; and a group filter runs only that group', () => {
    // Turn 9 × 10; Talk 9 × 5 × 2; Scene 5 × 2 + 1; gate 10 × 20, 10 × 3, 10 → 431 × 1.2 / 60 = 8.6.
    expect(planCalls(SET, { group: 'all', runs: 3, quick: true })).toMatchObject({ total: 431, minutes: 9 });
    expect(planCalls(SET, { group: 'turn', runs: 3, quick: false })).toMatchObject({ turn: 270, talk: 0, gateManipulative: 0, total: 270 });
  });
});

describe('arguments and the model location', () => {
  it('defaults: no --run, so nothing loads', () => {
    expect(parseArgs([])).toEqual({
      ok: true,
      options: { run: false, personas: 'fixture', messages: null, runs: 3, group: 'all', quick: false, out: 'logs/boss-eval' },
    });
  });
  it('reads every flag, and refuses a typo', () => {
    const r = parseArgs(['--run', '--quick', '--group', 'hollow-gate', '--runs', '2', '--personas', 'p.json', '--messages', 'm.json', '--out', 'o']);
    expect(r).toEqual({ ok: true, options: { run: true, quick: true, group: 'hollow-gate', runs: 2, personas: 'p.json', messages: 'm.json', out: 'o' } });
    expect(parseArgs(['--rn']).ok).toBe(false);
    expect(parseArgs(['--runs', '0']).ok).toBe(false);
    expect(parseArgs(['--group', 'everything']).ok).toBe(false);
  });
  it('finds Electron\'s per-user directory for the-void on each platform', () => {
    expect(electronUserDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, home: 'C:\\Users\\a' })).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\the-void',
    );
    expect(electronUserDataDir({ platform: 'darwin', env: {}, home: '/Users/a' })).toBe('/Users/a/Library/Application Support/the-void');
    expect(electronUserDataDir({ platform: 'linux', env: {}, home: '/home/a' })).toBe('/home/a/.config/the-void');
    expect(electronUserDataDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x' }, home: '/home/a' })).toBe('/x/the-void');
  });
  it('picks the 4B model file and nothing else', () => {
    expect(pickModelFile(['notes.txt', 'hf_unsloth_Qwen3-4B-Instruct-2507-Q4_K_M.gguf'])).toBe('hf_unsloth_Qwen3-4B-Instruct-2507-Q4_K_M.gguf');
    expect(pickModelFile(['other.gguf'])).toBeNull();
  });
});

// =========================================================================================
// AC-29 — the process entry stays safe (fix round 3: AC-18 re-pinned to the smallest set).
//
// Everything the old AC-18 scans guessed at by reading the driver's text is now BEHAVIOUR:
// `boss-eval-run.test.ts` runs the real loops end to end, `boss-eval-cli.test.ts` drives the
// command (nothing loads without --run, the model's directory, the exit status, a crash). Those
// scans are DELETED, not kept alongside — a scan a refactor must be edited around is how three fix
// rounds reopened the same hole. What is left here is only what no test can run: the ~40-line
// entry that touches the real model, and a grep that the two tested modules stay pure of it.
// Each detector is also proved red on planted breakage shaped the way the code would really break.
// =========================================================================================

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...testFiles(full));
    else if (/\.test\.(ts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** The `{ … }` block whose opening brace is at `open` (comments already stripped; quote-aware). */
function blockAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const LLAMA_IMPORT = /\bimport\s*\(\s*['"]node-llama-cpp['"]\s*\)/g;

/** Why the entry is unsafe to invoke, or []. Every pin of AC-29 on `scripts/boss-eval.ts`. */
function entryProblems(raw: string): string[] {
  const s = stripComments(raw);
  const problems: string[] = [];
  if (/^\s*import\b[^;]*['"]node-llama-cpp['"]/m.test(s) || /\brequire\(\s*['"]node-llama-cpp['"]/.test(s)) {
    problems.push('node-llama-cpp is imported statically — the native binding would load on every invocation');
  }
  const head = /\basync\s+loadBackend\s*\([^)]*\)\s*\{/.exec(s);
  const body = head ? blockAt(s, head.index + head[0].length - 1) : '';
  if (!head) problems.push('loadBackend is not a method of the deps object');
  const imports = s.match(LLAMA_IMPORT) ?? [];
  if (imports.length !== 1) problems.push(`node-llama-cpp is imported ${imports.length} times, not once`);
  if (!/\bawait\s+import\s*\(\s*['"]node-llama-cpp['"]\s*\)/.test(body)) problems.push('the node-llama-cpp import is not awaited inside loadBackend');
  if ((s.match(/\.loadModel\(/g) ?? []).length !== 1 || !/\.loadModel\(/.test(body)) problems.push('loadModel is not called exactly once, inside loadBackend');
  // The status: exactly one assignment, and it IS the awaited result of main — nothing around it.
  if ((s.match(/\bprocess\.exitCode\b/g) ?? []).length !== 1) problems.push('process.exitCode is touched more than once');
  if (/\bprocess\.exit\s*\(/.test(s)) problems.push('the entry ends the process itself');
  const at = s.search(/\bprocess\.exitCode\s*=/);
  const stmt = at < 0 ? '' : s.slice(at);
  const lead = /^process\.exitCode\s*=\s*await\s+(?=main\s*\(\s*process\.argv\.slice\(\s*2\s*\)\s*,)/.exec(stmt);
  const mainCall = lead ? (callsTo(stmt.slice(lead[0].length), 'main')[0] ?? '') : '';
  const after = lead ? stmt.slice(lead[0].length + mainCall.length) : '';
  if (!lead || mainCall === '' || !/^\s*(?:;|$)/.test(after)) problems.push('process.exitCode is not exactly `await main(process.argv.slice(2), …)`');
  // The shipped generation path, and the shipped context size.
  const runs = callsTo(s, 'runStructured');
  if (runs.length !== 1 || !body.includes(runs[0] as string)) problems.push('runStructured is not called exactly once, inside loadBackend');
  else if (argsOf(runs[0] as string)[2]?.replace(/\s+/g, ' ') !== '{ signal, cache }') problems.push('runStructured is not given { signal, cache }');
  if (!/\.createContext\(\s*\{\s*contextSize:\s*4096\s*\}\s*\)/.test(body) || (s.match(/\.createContext\(/g) ?? []).length !== 1) {
    problems.push('the context is not createContext({ contextSize: 4096 }) inside loadBackend');
  }
  return problems;
}

/** Why a module may not stand next to the model, or []. */
function modelPathProblems(raw: string): string[] {
  const s = stripComments(raw);
  return [
    ...(/['"`]\.?\/?models['"`/\\]/.test(s) ? ['it names ./models'] : []),
    ...(/resolveModelFile|createModelDownloader/.test(s) ? ['it could download a model'] : []),
  ];
}

/** Why a tested module (run, cli) is not pure of the process and the native model, or []. */
function testedModuleProblems(raw: string): string[] {
  const s = stripComments(raw);
  return [
    ...(/\bprocess\s*\./.test(s) ? ['it reads or sets process state'] : []),
    ...(/(?:from\s*|import\s*\(\s*|require\(\s*)['"](?:node:)?fs(?:\/promises)?['"]/.test(s) ? ['it imports the file system'] : []),
    ...(/node-llama-cpp/.test(s) ? ['it names node-llama-cpp'] : []),
  ];
}

describe('AC-29: the evaluation entry is safe to invoke, and the tested modules stay pure', () => {
  const read = (name: string) => readFileSync(path.join(HERE, name), 'utf8');
  const ENTRY = read('boss-eval.ts');
  const RUN = read('boss-eval-run.ts');
  const CLI = read('boss-eval-cli.ts');

  it('no test imports boss-eval.ts (only the tested modules)', () => {
    const IMPORTS_DRIVER = /(?:from\s*|import\s*\(\s*)['"][^'"]*boss-eval(?:\.ts)?['"]/;
    // This file is left out: its detector cases below are string literals of exactly that import.
    const self = fileURLToPath(import.meta.url);
    const files = ['src', 'scripts', 'electron'].flatMap((d) => testFiles(path.join(ROOT, d))).filter((f) => path.resolve(f) !== path.resolve(self));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((f) => IMPORTS_DRIVER.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
    // The detector: the import that WOULD run the process is caught; the tested modules' are not.
    expect(IMPORTS_DRIVER.test("import x from './boss-eval.ts';")).toBe(true);
    expect(IMPORTS_DRIVER.test("await import('../scripts/boss-eval')")).toBe(true);
    expect(IMPORTS_DRIVER.test("import { x } from './boss-eval-lib.ts';")).toBe(false);
    expect(IMPORTS_DRIVER.test("import { main } from './boss-eval-cli.ts';")).toBe(false);
    expect(IMPORTS_DRIVER.test("import { runEvaluation } from './boss-eval-run.ts';")).toBe(false);
  });

  it('the entry: node-llama-cpp only inside loadBackend, the status only from main, the shipped path and context', () => {
    expect(entryProblems(ENTRY)).toEqual([]);
    const code = stripComments(ENTRY).split('\n').filter((l) => l.trim() !== '');
    expect(code.length, 'the entry has grown back into a driver').toBeLessThanOrEqual(60);
  });

  it('the entry detector goes red on each way the entry would really break', () => {
    const mutate = (from: string | RegExp, to: string): string[] => {
      const out = ENTRY.replace(from, to);
      expect(out, `the planted change did not apply: ${String(from)}`).not.toBe(ENTRY);
      return entryProblems(out);
    };
    // A static import, beside the file's other imports.
    expect(mutate("import { main } from './boss-eval-cli.ts';", "import { main } from './boss-eval-cli.ts';\nimport { getLlama } from 'node-llama-cpp';")).not.toEqual([]);
    // The import hoisted out of loadBackend to module scope.
    expect(mutate('process.exitCode = await main(', "const nlc = await import('node-llama-cpp');\nprocess.exitCode = await main(")).not.toEqual([]);
    // The status squashed (the round-2 mutation's shape), overwritten, or the process ended early.
    expect(mutate(/process\.exitCode = await main\(([\s\S]*)\}\);\s*$/, 'process.exitCode = (await main($1})) === 1 ? 1 : 0;\n')).not.toEqual([]);
    expect(mutate(/\}\);\s*$/, '});\nprocess.exitCode = 0;\n')).not.toEqual([]);
    expect(mutate('process.exitCode = await main(', "if (process.argv.includes('--dry')) process.exit(0);\nprocess.exitCode = await main(")).not.toEqual([]);
    // The deadline's signal dropped from generation; the context shrunk; the model loaded at the top.
    expect(mutate('{ signal, cache })', '{ cache })')).not.toEqual([]);
    expect(mutate('contextSize: 4096', 'contextSize: 2048')).not.toEqual([]);
    expect(mutate('const llama = await getLlama();', 'const llama = await getLlama();\n    await llama.loadModel({ modelPath });')).not.toEqual([]);
  });

  it('none of the three modules names ./models or could download a model', () => {
    for (const [name, src] of [['boss-eval.ts', ENTRY], ['boss-eval-run.ts', RUN], ['boss-eval-cli.ts', CLI]] as const) {
      expect(modelPathProblems(src), name).toEqual([]);
    }
    expect(modelPathProblems(`${CLI}\nconst dir = path.resolve('./models');`)).not.toEqual([]);
    expect(modelPathProblems(`${CLI}\nconst dir = path.join(home, 'models');`)).not.toEqual([]);
    expect(modelPathProblems(`${ENTRY}\nimport { resolveModelFile } from 'node-llama-cpp';`)).not.toEqual([]);
  });

  it('the run and the command touch no process state, no file system, no native model', () => {
    expect(testedModuleProblems(RUN)).toEqual([]);
    expect(testedModuleProblems(CLI)).toEqual([]);
    expect(testedModuleProblems(`${CLI}\nconst dir = process.env.VOID_MODELS_DIR;`)).not.toEqual([]);
    expect(testedModuleProblems(`import { readFileSync } from 'node:fs';\n${RUN}`)).not.toEqual([]);
    expect(testedModuleProblems(`${RUN}\nconst m = await import('node-llama-cpp');`)).not.toEqual([]);
  });
});

// =========================================================================================
// AC-19 — the drafted test set
// =========================================================================================

describe('AC-19: the drafted test set (scripts/boss-eval/messages.json)', () => {
  it('is marked a DRAFT for the author', () => {
    expect(SET.status).toBe(DRAFT_STATUS);
  });

  it('meets every count and shape', () => {
    expect(messageSetProblems(SET)).toEqual([]);
    for (const persona of BOSS_PERSONA_IDS) {
      for (const group of MESSAGE_GROUPS) expect(messagesFor(SET, persona, group).length, `${persona}/${group}`).toBeGreaterThanOrEqual(10);
    }
    const gate = SET.hollowGate;
    expect(gate.manipulativeConversations.length).toBeGreaterThanOrEqual(40);
    for (const c of gate.manipulativeConversations) expect(c.messages, c.id).toHaveLength(20);
    expect(gate.genuineConversations.length).toBeGreaterThanOrEqual(40);
    for (const c of gate.genuineConversations) expect(c.messages.length, c.id).toBeGreaterThanOrEqual(3);
    expect(gate.offTargetSingles.length).toBeGreaterThanOrEqual(40);
  });

  it('the validator is live: a short group, a short conversation and a blank message are each reported', () => {
    const broken = JSON.parse(JSON.stringify(SET)) as { personas: Record<string, Record<string, string[]>>; hollowGate: { manipulativeConversations: { messages: string[] }[]; offTargetSingles: string[] } };
    (broken.personas.kingpin as Record<string, string[]>)['genuine-on-target'] = ['only one'];
    broken.hollowGate.manipulativeConversations[0]?.messages.pop();
    broken.hollowGate.offTargetSingles[0] = '  ';
    const problems = messageSetProblems(broken);
    expect(problems.some((p) => p.startsWith('kingpin/genuine-on-target'))).toBe(true);
    expect(problems.some((p) => p.includes('manipulativeConversations/'))).toBe(true);
    expect(problems.some((p) => p.includes('offTargetSingles'))).toBe(true);
  });

  // The fixture deeds and the losses a genuine acknowledgement may name (§7.1: "naming
  // something real (a deed, a loss, what it is to them)").
  const REAL = /Fixer|Ganger|altar|ring|patience|Kingpin|Reflection|Choir Warden|Ash Walker|Echo|whisper|offering|blade|lie|Undercity|Ash City|stairs|lost|losing|took|name/i;

  it('every genuine gate conversation names a fixture deed or a loss', () => {
    for (const c of SET.hollowGate.genuineConversations) expect(REAL.test(c.messages.join(' ')), c.id).toBe(true);
    expect(REAL.test('I accept you. You are me. Okay.')).toBe(false);
  });

  it('no message copies a sentence of any card verbatim', () => {
    const sentences = FIXTURE_PERSONA_LIST.flatMap((p) =>
      [p.card, ...p.examples, p.talk.moves, p.talk.judge ?? '', ...p.fallbackLines]
        .join(' ')
        .split(/(?<=[.!?…])\s+|\n/)
        .map((s) => s.replace(/^["“]|["”]$/g, '').trim().toLowerCase())
        .filter((s) => s.length >= 20),
    );
    expect(sentences.length).toBeGreaterThan(40);
    const all = [
      ...BOSS_PERSONA_IDS.flatMap((id) => MESSAGE_GROUPS.flatMap((g) => messagesFor(SET, id, g))),
      ...SET.hollowGate.manipulativeConversations.flatMap((c) => c.messages),
      ...SET.hollowGate.genuineConversations.flatMap((c) => c.messages),
      ...SET.hollowGate.offTargetSingles,
    ].map((m) => m.toLowerCase());
    for (const s of sentences) {
      const copy = all.find((m) => m.includes(s));
      expect(copy, `a message copies the card: "${s}"`).toBeUndefined();
    }
    // The detector: a planted copy of a card sentence is found.
    const planted = [...all, 'you are never surprised.'];
    expect(sentences.some((s) => planted.some((m) => m.includes(s)))).toBe(true);
  });
});

// =========================================================================================
// FIX ROUND 1, F1 — failed calls are visible, and they cannot pass a target.
//
// The first version of the report read only answered calls: with 8 of 10 Turns timed out it
// printed a 300 ms first token, a 905 ms total, "[PASS] Legal move rate: 2 of 2" and
// "RESULT: PASS", and the word "timeout" appeared nowhere; with every gate call timed out it
// passed the manipulation ceiling at 0 of 40. These tests hold the PRINTED REPORT to the truth.
// =========================================================================================

/** The report row whose first cell is `label`, split into its cells (cells are 2+ spaces apart). */
function row(report: string, label: string): string[] {
  const line = report.split('\n').find((l) => l.startsWith(`  ${label} `));
  expect(line, `no row for ${label}`).toBeDefined();
  return (line as string).trim().split(/\s{2,}/);
}

describe('F1: timed-out and failed calls are counted, timed and never mistaken for a pass', () => {
  const kingpinTurn = turnRequest(FIXTURE_PERSONAS.kingpin, fight([20, 20, []], [20, 20, []], 1));
  const hollowTalk = talkRequest(FIXTURE_PERSONAS.hollow, { available: ['surrender'] });
  const noGate = { manipulative: [], genuine: [], offTarget: [] };

  /** The timeout the REAL queue produces for a call cut off at its 3 s deadline. */
  async function realQueueTimeout(): Promise<RawResult> {
    let t = 0;
    const timers: (() => void)[] = [];
    const setTimer = ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout;
    const queue = createSequenceQueue({ now: () => t, setTimer, clearTimer: () => {} });
    const pending = queue.run(() => new Promise(() => {}), { deadlineMs: 3000 });
    await new Promise((r) => setImmediate(r));
    t += 3000;
    for (const fire of timers) fire();
    return (await pending) as RawResult;
  }

  it("the tester's case — 8 of 10 Turns time out: counted, timed at 3 s, INCONCLUSIVE, never PASS", async () => {
    const timeout = await realQueueTimeout();
    expect(timeout).toMatchObject({ ok: false, reason: 'timeout', ranMs: 3000 });
    const meta = { group: 'turn' as const, run: 1, previous: [] as string[] };
    const records = [
      ...Array.from({ length: 2 }, () => scoreCall(kingpinTurn, answer('{"move":"strike","line":"Sit."}'), meta, vocab)),
      ...Array.from({ length: 8 }, () => scoreCall(kingpinTurn, timeout, meta, vocab)),
    ];
    const s = summarize(records, noGate);
    const report = renderReport(s);
    // Totals: 910, 910 and eight at 3000 (the moment they were cut off). Mean (1820 + 24000) / 10
    // = 2582; p95 is the 10th of 10 = 3000. The first token exists only for the two answered calls.
    // Kind row: kind · calls · answered · timeout · error · malformed · illegal · ttft · total.
    expect(row(report, 'turn').slice(0, 9)).toEqual(['turn', '10', '2', '8', '0', '0', '0', '300 ms / 300 ms', '2582 ms / 3000 ms']);
    // Boss row: boss · calls · answered · timeout · error · malformed · illegal · legal · ttft · total.
    expect(row(report, 'kingpin').slice(0, 10)).toEqual(['kingpin', '10', '2', '8', '0', '0', '0', '100.0%', '300 ms / 300 ms', '3000 ms / 3000 ms']);
    expect(report).toContain('turn               8 of 10 failed (timeout 8, error 0, malformed 0)  INCONCLUSIVE');
    expect(report).toContain('[INCONCLUSIVE] Legal move rate (must be 100%): 2 of 2 = 100.0% (mark ≥ 100%) — failed calls 8 of 10');
    expect(report).not.toContain('[PASS]');
    expect(report).not.toContain('RESULT: PASS');
    expect(report).toContain('RESULT: INCONCLUSIVE (too many failed calls in: turn)');
    expect(exitCode(s)).toBe(EXIT.inconclusive);
    expect(EXIT.inconclusive).not.toBe(EXIT.fail);
  });

  it('a cut-off Talk or Scene answer is counted as malformed, where it used to be invisible', () => {
    const scene = sceneRequest(FIXTURE_PERSONAS.warden);
    const records = [
      scoreCall(scene, answer('{"line":"I have read yo'), { group: 'rude', run: 1, previous: [] }, vocab),
      scoreCall(hollowTalk, answer('{"reply":"I was alw'), { group: 'rude', run: 1, previous: [] }, vocab),
    ];
    const report = renderReport(summarize(records, noGate));
    expect(row(report, 'scene').slice(0, 7)).toEqual(['scene', '1', '0', '0', '0', '1', '0']);
    expect(row(report, 'talk').slice(0, 7)).toEqual(['talk', '1', '0', '0', '0', '1', '0']);
    expect(report).toContain('scene              1 of 1 failed (timeout 0, error 0, malformed 1)  INCONCLUSIVE');
  });

  it('a failed gate conversation is left out of numerator AND denominator, and reported', () => {
    // 6 surrendered, 30 refused throughout, 4 had a failed call. Counted as refusals (the old
    // bug) that is 6/40 = 15.0%, a PASS; left out, it is 6/36 = 16.7% — a miss as measured, but
    // 4 of 40 left out is 10% > 5%, so the verdict is INCONCLUSIVE (the amended rule).
    const manipulative: (number | null | 'failed')[] = [...outcomes(6, 6, 9), ...outcomes(0, 30, null), 'failed', 'failed', 'failed', 'failed'];
    const [ceiling] = hollowGate({ manipulative, genuine: [], offTarget: [] });
    expect(ceiling).toMatchObject({ verdict: 'INCONCLUSIVE', asMeasured: 'FAIL', count: 6, of: 36, excluded: 4, measured: '6 of 36 = 16.7%' });
    // The off-target singles, the same way: 8 accepted of 40 judged + 2 failed → 20.0% PASS
    // (2 of 42 left out is 4.8%, under the line, so it is judged).
    const [, , , off] = hollowGate({
      manipulative: [],
      genuine: [],
      offTarget: [...Array.from({ length: 40 }, (_, i) => i < 8), 'failed', 'failed'],
    });
    expect(off).toMatchObject({ verdict: 'PASS', count: 8, of: 40, excluded: 2 });
  });

  it('the failed gate calls are printed beside each of the four targets', () => {
    const call = (group: 'gate-manipulative' | 'gate-genuine' | 'gate-off-target', raw: RawResult) =>
      scoreCall(hollowTalk, raw, { group, run: 1, previous: [] }, vocab);
    const refuse = answer('{"reply":"I am still here.","concession":"none"}');
    const records = [
      // 100 manipulative calls, 5 of them timed out: exactly 5% — trusted, and printed.
      ...Array.from({ length: 95 }, () => call('gate-manipulative', refuse)),
      ...Array.from({ length: 5 }, () => call('gate-manipulative', { ok: false, reason: 'timeout', timedOut: true, ranMs: 3000 })),
      // 20 genuine calls, 2 errors: 10% — INCONCLUSIVE.
      ...Array.from({ length: 18 }, () => call('gate-genuine', refuse)),
      ...Array.from({ length: 2 }, () => call('gate-genuine', { ok: false, reason: 'error' })),
      ...Array.from({ length: 10 }, () => call('gate-off-target', refuse)),
    ];
    const s = summarize(records, { manipulative: [...outcomes(0, 35, null), 'failed'], genuine: outcomes(8, 8, 0), offTarget: [false] });
    const report = renderReport(s);
    expect(report).toContain('[PASS] Manipulation ceiling (conversations ending in surrender): 0 of 35 = 0.0% (mark ≤ 15%) — failed calls 5 of 100; 1 left out');
    expect(report).toContain('[INCONCLUSIVE] Genuine acceptance — first message: 8 of 8 = 100.0% (mark ≥ 60%) — failed calls 2 of 20');
    expect(report).toContain('[INCONCLUSIVE] Genuine acceptance — by the third message: 8 of 8 = 100.0% (mark ≥ 90%) — failed calls 2 of 20');
    expect(report).toContain('[PASS] Sincere but off-target — accepted alone: 0 of 1 = 0.0% (mark ≤ 20%) — failed calls 0 of 10');
    expect(report).toContain('gate-manipulative  5 of 100 failed (timeout 5, error 0, malformed 0)\n');
    expect(report).toContain('gate-genuine       2 of 20 failed (timeout 0, error 2, malformed 0)  INCONCLUSIVE');
    expect(exitCode(s)).toBe(EXIT.inconclusive);
  });

  it('every gate call timing out is INCONCLUSIVE — never a pass at 0 of 40, never "not run"', () => {
    const timeout: RawResult = { ok: false, reason: 'timeout', timedOut: true, ranMs: 3000 };
    const records = Array.from({ length: 40 }, () =>
      scoreCall(hollowTalk, timeout, { group: 'gate-manipulative', run: 1, previous: [] }, vocab),
    );
    const s = summarize(records, { manipulative: Array.from({ length: 40 }, () => 'failed' as const), genuine: [], offTarget: [] });
    const report = renderReport(s);
    expect(report).toContain(
      '[INCONCLUSIVE] Manipulation ceiling (conversations ending in surrender): none judged (mark ≤ 15%) — failed calls 40 of 40; 40 left out',
    );
    expect(report).not.toContain('[PASS]');
    expect(exitCode(s)).toBe(EXIT.inconclusive);
  });

  it('the 5% line: 5 of 100 is trusted, 6 of 100 is not; INCONCLUSIVE wins over FAIL in the exit status', () => {
    const turns = (failedCount: number, illegalCount: number) => [
      ...Array.from({ length: 100 - failedCount - illegalCount }, () =>
        scoreCall(kingpinTurn, answer('{"move":"strike","line":"Sit."}'), { group: 'turn', run: 1, previous: [] }, vocab),
      ),
      ...Array.from({ length: failedCount }, () =>
        scoreCall(kingpinTurn, { ok: false, reason: 'error' }, { group: 'turn', run: 1, previous: [] }, vocab),
      ),
      ...Array.from({ length: illegalCount }, () =>
        scoreCall(kingpinTurn, answer('{"move":"flee","line":"Bye."}'), { group: 'turn', run: 1, previous: [] }, vocab),
      ),
    ];
    expect(exitCode(summarize(turns(5, 0), noGate))).toBe(EXIT.pass);
    expect(exitCode(summarize(turns(6, 0), noGate))).toBe(EXIT.inconclusive);
    // An illegal move is a real answer that broke the rule: a FAIL, not a failed call.
    const failOnly = summarize(turns(0, 1), noGate);
    expect(failOnly.groups[0]).toMatchObject({ failed: 0, inconclusive: false });
    expect(exitCode(failOnly)).toBe(EXIT.fail);
    // Both at once: the run must be re-run before its FAIL can be acted on.
    const both = summarize(turns(6, 1), noGate);
    expect(exitCode(both)).toBe(EXIT.inconclusive);
    expect(renderReport(both)).toContain('RESULT: INCONCLUSIVE (too many failed calls in: turn) — and 1 target missed');
    expect(renderReport(both)).toContain('; missed its mark even on the calls that answered');
    expect(renderReport(both)).toContain(
      'Exit status: 0 pass · 1 a target failed · 3 inconclusive (re-run first; it wins over a fail) · 2 unusable arguments or inputs',
    );
  });
});

// =========================================================================================
// FIX ROUND 2, F5 — the orchestrator's methodology amendment (2026-09-28), driven through the
// SAME chain the real run uses: gateConversation (→ runConversation, with its retries → scoreCall)
// → recordGateResult → summarize → renderReport → exitCode.
//
// The hole it closes: the 5% rule counted CALLS, but one failed call removes a whole CONVERSATION,
// and the conversations a timeout removes are the long, holding-out ones — so a run could pass the
// manipulation ceiling with nothing judged (S2), and ordinary timeout rates skewed the targets
// both ways (S3 a false FAIL, S4 a false PASS).
// =========================================================================================

describe('F5: a Hollow Self target cannot be decided by the conversations a timeout removed', () => {
  const hollow = FIXTURE_PERSONAS.hollow;
  const TIMEOUT: RawResult = { ok: false, reason: 'timeout', timedOut: true, queuedMs: 0, ranMs: 3000 };
  const REFUSE = answer('{"reply":"I am still here.","concession":"none"}');
  const YIELD = answer('{"reply":"There you are. Go on.","concession":"surrender"}');

  /** How one scripted conversation answers: by message index and by attempt (0 = first ask). */
  type Respond = (message: number, attempt: number) => RawResult;
  interface Script {
    messages: number;
    respond: Respond;
  }

  /** Run scripted conversations for each gate set through the driver's own wiring. */
  async function runGate(sets: Partial<Record<GateGroup, readonly Script[]>>) {
    const records: CallRecord[] = [];
    const gate = emptyGate();
    for (const [group, scripts] of Object.entries(sets) as [GateGroup, readonly Script[]][]) {
      for (const script of scripts) {
        const attempts = new Map<number, number>();
        const result = await gateConversation({
          messages: Array.from({ length: script.messages }, (_, i) => `message ${i}`),
          group,
          run: 1,
          persona: hollow,
          request: (window, typed) => talkRequest(hollow, { exchanges: window, typed, available: ['surrender'] }),
          call: async (req) => {
            const i = Number((req as { typed: string }).typed.split(' ')[1]);
            const attempt = attempts.get(i) ?? 0;
            attempts.set(i, attempt + 1);
            return script.respond(i, attempt);
          },
          vocab,
          records,
        });
        recordGateResult(gate, group, result);
      }
    }
    const summary = summarize(records, gate);
    return { summary, report: renderReport(summary), code: exitCode(summary), gate, records };
  }

  const holdOut = (n: number): Script => ({ messages: n, respond: () => REFUSE });
  /** Holds out, except that message `bad` fails on every attempt. */
  const failsAt = (n: number, bad: number): Script => ({ messages: n, respond: (i) => (i === bad ? TIMEOUT : REFUSE) });

  it('S2 — every conversation fails on its 20th message, even after the retries: INCONCLUSIVE, exit 3', async () => {
    const { report, code, summary } = await runGate({ 'gate-manipulative': Array.from({ length: 120 }, () => failsAt(20, 19)) });
    // Each conversation: 19 answered + the 20th asked three times (2 retries, none recovered).
    expect(summary.targets[2]).toMatchObject({ verdict: 'INCONCLUSIVE', of: 0, excluded: 120, retries: 240, recovered: 0 });
    expect(report).toContain(
      '[INCONCLUSIVE] Manipulation ceiling (conversations ending in surrender): none judged (mark ≤ 15%) — failed calls 360 of 2640; 240 retried, 0 recovered; 120 left out',
    );
    expect(report).not.toContain('[PASS]');
    expect(report).toContain('RESULT: INCONCLUSIVE');
    expect(code).toBe(EXIT.inconclusive);
  });

  it('nothing judged but something left out is INCONCLUSIVE even when the per-call share is low', async () => {
    // One 100-message conversation failing (three times) on its last message: 3 of 102 calls
    // failed (2.9%), so the group is trusted — and still nothing was judged. Never "not run".
    const { report, code, summary } = await runGate({ 'gate-manipulative': [failsAt(100, 99)] });
    expect(summary.groups.find((g) => g.group === 'gate-manipulative')).toMatchObject({ calls: 102, failed: 3, inconclusive: false });
    expect(report).toContain('[INCONCLUSIVE] Manipulation ceiling (conversations ending in surrender): none judged');
    expect(report).not.toContain('[NOT RUN] Manipulation ceiling');
    expect(code).toBe(EXIT.inconclusive);
    // The same rule, straight on the gate arithmetic.
    expect(hollowGate({ manipulative: ['failed'], genuine: [], offTarget: [] })[0]).toMatchObject({ verdict: 'INCONCLUSIVE', of: 0, excluded: 1 });
  });

  it('6 of 40 conversations left out (15%) is INCONCLUSIVE, though only 18 of 812 calls failed', async () => {
    // 6 × (19 + 3) + 34 × 20 = 132 + 680 = 812 calls; 18 failed = 2.2%, under the per-call line,
    // so the verdict comes from the NEW target-level rule alone: 6 × 100 > 5 × 40.
    const { report, code, summary } = await runGate({
      'gate-manipulative': [...Array.from({ length: 6 }, () => failsAt(20, 19)), ...Array.from({ length: 34 }, () => holdOut(20))],
    });
    expect(summary.groups.find((g) => g.group === 'gate-manipulative')).toMatchObject({ calls: 812, failed: 18, inconclusive: false });
    expect(report).toContain(
      '[INCONCLUSIVE] Manipulation ceiling (conversations ending in surrender): 0 of 34 = 0.0% (mark ≤ 15%) — failed calls 18 of 812; 12 retried, 0 recovered; 6 left out',
    );
    expect(report).toContain('RESULT: INCONCLUSIVE (too many left out of: Manipulation ceiling (conversations ending in surrender))');
    expect(code).toBe(EXIT.inconclusive);
  });

  it('2 of 40 left out (exactly 5%) is still judged', async () => {
    // 2 × 22 + 38 × 20 = 44 + 760 = 804 calls, 6 failed; 2 × 100 = 5 × 40, not more.
    const { report, code } = await runGate({
      'gate-manipulative': [...Array.from({ length: 2 }, () => failsAt(20, 19)), ...Array.from({ length: 38 }, () => holdOut(20))],
    });
    expect(report).toContain(
      '[PASS] Manipulation ceiling (conversations ending in surrender): 0 of 38 = 0.0% (mark ≤ 15%) — failed calls 6 of 804; 4 retried, 0 recovered; 2 left out',
    );
    expect(code).toBe(EXIT.pass);
  });

  it('a retry that succeeds keeps the conversation — and its real verdict', async () => {
    // Every conversation's 20th message times out ONCE, then the judge answers: the 10 that
    // surrender there count (10 of 40 = 25% → FAIL), which dropping them would have hidden.
    const flaky = (yields: boolean): Script => ({
      messages: 20,
      respond: (i, attempt) => (i === 19 ? (attempt === 0 ? TIMEOUT : yields ? YIELD : REFUSE) : REFUSE),
    });
    const { report, summary, code } = await runGate({
      'gate-manipulative': [...Array.from({ length: 10 }, () => flaky(true)), ...Array.from({ length: 30 }, () => flaky(false))],
    });
    expect(summary.targets[2]).toMatchObject({ verdict: 'FAIL', count: 10, of: 40, excluded: 0, retries: 40, recovered: 40 });
    expect(report).toContain('— failed calls 40 of 840; 40 retried, 40 recovered');
    expect(report).not.toContain('left out;');
    // 40 failed of 840 calls is 4.8% — under the line, so this is a real FAIL, exit 1.
    expect(code).toBe(EXIT.fail);
  });

  /** Seeded, independent timeouts at a given rate (the shipped RNG, so the run is reproducible). */
  const flakyAt = (rate: number, seed: number) => {
    const rng = mulberry32(seed);
    return (answerWith: RawResult): RawResult => (rng() < rate ? TIMEOUT : answerWith);
  };

  it('S3 — 4.5% timeouts no longer turn a true PASS into a FAIL', async () => {
    // The judge truly surrenders in 14 of 120 conversations (11.7%, a PASS of the ≤ 15% ceiling),
    // at message 10; the other 106 hold out all 20. Before the retries, the long holding-out
    // conversations were the ones removed, and the report printed 12 of 50 = 24.0%, FAIL.
    const flaky = flakyAt(0.045, 1109);
    const conversations: Script[] = Array.from({ length: 120 }, (_, k) => ({
      messages: 20,
      respond: (i) => flaky(k < 14 && i === 10 ? YIELD : REFUSE),
    }));
    const { summary } = await runGate({ 'gate-manipulative': conversations });
    const ceiling = summary.targets[2];
    expect(ceiling?.verdict).not.toBe('FAIL');
    expect(ceiling).toMatchObject({ verdict: 'PASS', count: 14, of: 120, excluded: 0 });
    expect(ceiling?.recovered).toBeGreaterThan(0);
  });

  it('S4 — 4.5% timeouts no longer turn a true FAIL into a PASS', async () => {
    // Genuine acceptance at the first message is truly 55% (66 of 120, a FAIL of ≥ 60%); the other
    // 54 never accept across their three messages. Before, the long refusing conversations were
    // removed and the report printed 62 of 103 = 60.2%, PASS.
    const flaky = flakyAt(0.045, 2718);
    const conversations: Script[] = Array.from({ length: 120 }, (_, k) => ({
      messages: 3,
      respond: (i) => flaky(k < 66 && i === 0 ? YIELD : REFUSE),
    }));
    const { summary } = await runGate({ 'gate-genuine': conversations });
    const first = summary.targets[3];
    expect(first?.verdict).not.toBe('PASS');
    expect(first).toMatchObject({ verdict: 'FAIL', count: 66, of: 120, excluded: 0 });
  });

  // ---- Fix round 3, F7: the off-target branch of recordGateResult, on all three of its outcomes ----

  it('F7 — an off-target single is accepted, refused, or LEFT OUT; a failed one is never a refusal', async () => {
    // 117 refuse, 1 yields on its one message, 2 fail on all three attempts.
    // Calls: 117 + 1 + 2 × 3 = 124; failed 6 → 6 × 100 = 600 ≤ 5 × 124 = 620, trusted.
    // Left out 2 → 2 × 100 = 200 ≤ 5 × 120 = 600, judged. Accepted 1 of 118 = 0.847…% → 0.8%.
    // Retried: 2 per failed single = 4, none recovered.
    const { report, code, gate } = await runGate({
      'gate-off-target': [
        ...Array.from({ length: 117 }, () => holdOut(1)),
        { messages: 1, respond: () => YIELD },
        failsAt(1, 0),
        failsAt(1, 0),
      ],
    });
    expect(report).toContain(
      '[PASS] Sincere but off-target — accepted alone: 1 of 118 = 0.8% (mark ≤ 20%) — failed calls 6 of 124; 4 retried, 0 recovered; 2 left out',
    );
    expect(code).toBe(EXIT.pass);
    expect(gate.offTarget).toEqual([...Array.from({ length: 117 }, () => false), true, 'failed', 'failed']);
  });

  it('F7 — 3 of 40 off-target singles failing (7.5%) is INCONCLUSIVE, never a pass on the other 37', async () => {
    // 37 refuse; 3 fail on every attempt. Left out 3 × 100 = 300 > 5 × 40 = 200 (the target rule);
    // on these sets the per-call rule fires too (9 of 46 calls failed), so both say INCONCLUSIVE.
    const { report, code, summary } = await runGate({
      'gate-off-target': [...Array.from({ length: 37 }, () => holdOut(1)), failsAt(1, 0), failsAt(1, 0), failsAt(1, 0)],
    });
    expect(summary.targets[5]).toMatchObject({ verdict: 'INCONCLUSIVE', of: 37, excluded: 3, asMeasured: 'PASS' });
    expect(report).toContain('[INCONCLUSIVE] Sincere but off-target — accepted alone: 0 of 37 = 0.0%');
    expect(code).toBe(EXIT.inconclusive);
  });

  // ---- Fix round 3, F8b: a target its group's calls never reached is INCONCLUSIVE, never NOT RUN ----

  it('F8b — gate calls ran, but the summary was handed an empty gate: INCONCLUSIVE, "nothing reached", exit 3', () => {
    // The D23 shape: 120 manipulative calls that ran and refused, and `summarize(records, emptyGate())`.
    const hollowTalk = talkRequest(hollow, { available: ['surrender'] });
    const records = Array.from({ length: 120 }, () =>
      scoreCall(hollowTalk, REFUSE, { group: 'gate-manipulative', run: 1, previous: [] }, vocab),
    );
    const summary = summarize(records, emptyGate());
    expect(summary.targets[2]).toMatchObject({
      verdict: 'INCONCLUSIVE',
      asMeasured: 'NOT RUN',
      of: 0,
      excluded: 0,
      calls: 120,
      measured: 'nothing judged, though its calls ran',
    });
    const report = renderReport(summary);
    expect(report).toContain(
      '[INCONCLUSIVE] Manipulation ceiling (conversations ending in surrender): nothing judged, though its calls ran (mark ≤ 15%) — failed calls 0 of 120',
    );
    expect(report).toContain('RESULT: INCONCLUSIVE (nothing reached: Manipulation ceiling (conversations ending in surrender))');
    expect(report).not.toContain('RESULT: PASS');
    expect(exitCode(summary)).toBe(EXIT.inconclusive);
  });

  it('F8b — Talk calls ran with no executioner among them: its target is INCONCLUSIVE, "nothing reached"', () => {
    const kingpinTalk = talkRequest(FIXTURE_PERSONAS.kingpin);
    const records = Array.from({ length: 10 }, () =>
      scoreCall(kingpinTalk, answer('{"reply":"Sit.","concession":"none"}'), { group: 'rude', run: 1, previous: [] }, vocab),
    );
    const summary = summarize(records, emptyGate());
    expect(summary.targets[1]).toMatchObject({ target: 'The executioner never concedes', verdict: 'INCONCLUSIVE', of: 0, calls: 10 });
    const report = renderReport(summary);
    expect(report).toContain('RESULT: INCONCLUSIVE (nothing reached: The executioner never concedes)');
    expect(exitCode(summary)).toBe(EXIT.inconclusive);
  });
});
