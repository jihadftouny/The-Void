// THE BOSS EVALUATION — its pure core (PLAN.md #11 part B; `docs/BOSS-PROMPTS.md` §7).
//
// `scripts/boss-eval.ts` drives the REAL model (author-run only — never an agent, never a test).
// Everything that can be decided without the model lives here, so it is tested against a
// scripted fake: which calls to make, how to read each answer, how a Hollow Self conversation
// proceeds and when it stops, the §7.1 gate arithmetic, the report, and the exit status.
//
// Every scoring step uses the SHIPPED pure layer (`src/llm/boss*.ts`) — the same builders, the
// same parser, the same name rule and line check the game uses — so what the script measures is
// what the player would see.
//
// No clock, no randomness, no I/O here. The driver times, generates and writes.

import type { BossCallKind, BossPersona, BossPersonaId, BossRequest, ConcessionId } from '../src/llm/bossContract.ts';
import { BOSS_PERSONA_IDS } from '../src/llm/bossContract.ts';
import { applyNameRule, checkBossLine, parseBossAnswer } from '../src/llm/bossAnswer.ts';
import { buildBossPrompt, MAX_EXCHANGES } from '../src/llm/bossPrompt.ts';
import type { TextVocabulary } from '../src/llm/textHygiene.ts';

// ===========================================================================
// The test set
// ===========================================================================

/** The five kinds of message every boss is tested with (§7 item 5). */
export const MESSAGE_GROUPS = ['genuine-on-target', 'genuine-off-target', 'rude', 'manipulative', 'empty'] as const;
export type MessageGroup = (typeof MESSAGE_GROUPS)[number];

/** What `messages.json` must say until the author has reviewed it. */
export const DRAFT_STATUS = 'DRAFT — author review before it becomes the gate';

export interface GateConversation {
  id: string;
  /** What the conversation is: manipulative, empty, or a mix of both (manipulation set only). */
  mix?: string;
  messages: readonly string[];
}

export interface MessageSet {
  status: string;
  /** How the set was drafted, for the author reviewing it. */
  notes?: string;
  groups: readonly MessageGroup[];
  /** Messages every boss is tested with, per group (rude, manipulative, empty). */
  shared: Partial<Record<MessageGroup, readonly string[]>>;
  /** Messages for one boss, per group — its own genuine ones, and any group additions. */
  personas: Partial<Record<BossPersonaId, Partial<Record<MessageGroup, readonly string[]>>>>;
  hollowGate: {
    /** The pools the manipulative/empty conversations were drawn from (kept for the review). */
    pools?: { manipulative: readonly string[]; empty: readonly string[] };
    manipulativeConversations: readonly GateConversation[];
    genuineConversations: readonly GateConversation[];
    offTargetSingles: readonly string[];
  };
}

/** Every message a boss is tested with in one group: the shared ones, then its own. */
export function messagesFor(set: MessageSet, persona: BossPersonaId, group: MessageGroup): string[] {
  return [...(set.shared[group] ?? []), ...(set.personas[persona]?.[group] ?? [])];
}

/** How big the test set must be (plan AC-19). */
export const SET_MINIMUMS = {
  perPersonaGroup: 10,
  gateConversations: 40,
  manipulativeLength: 20,
  genuineLength: 3,
  offTargetSingles: 40,
} as const;

/** Why a loaded test set is unusable — every problem, so a broken file points at itself. */
export function messageSetProblems(x: unknown): string[] {
  const problems: string[] = [];
  if (typeof x !== 'object' || x === null) return ['not an object'];
  const set = x as MessageSet;
  const isText = (s: unknown): boolean => typeof s === 'string' && s.trim() !== '';
  if (typeof set.status !== 'string') problems.push('status is missing');
  if (!Array.isArray(set.groups) || MESSAGE_GROUPS.some((g) => !set.groups.includes(g))) problems.push('groups must list all five');
  for (const persona of BOSS_PERSONA_IDS) {
    for (const group of MESSAGE_GROUPS) {
      const list = messagesFor(set, persona, group);
      if (list.length < SET_MINIMUMS.perPersonaGroup) problems.push(`${persona}/${group}: ${list.length} messages`);
      if (list.some((m) => !isText(m))) problems.push(`${persona}/${group}: a blank message`);
    }
  }
  const gate = set.hollowGate;
  if (!gate) return [...problems, 'hollowGate is missing'];
  const checkConversations = (list: readonly GateConversation[] | undefined, name: string, min: number, exact: boolean) => {
    if (!Array.isArray(list) || list.length < SET_MINIMUMS.gateConversations) {
      problems.push(`${name}: ${Array.isArray(list) ? list.length : 0} conversations`);
      return;
    }
    const ids = new Set<string>();
    for (const c of list) {
      if (!isText(c.id) || ids.has(c.id)) problems.push(`${name}: a missing or repeated id`);
      ids.add(c.id);
      const n = Array.isArray(c.messages) ? c.messages.length : 0;
      if (exact ? n !== min : n < min) problems.push(`${name}/${c.id}: ${n} messages`);
      if (!Array.isArray(c.messages) || c.messages.some((m: unknown) => !isText(m))) problems.push(`${name}/${c.id}: a blank message`);
    }
  };
  checkConversations(gate.manipulativeConversations, 'manipulativeConversations', SET_MINIMUMS.manipulativeLength, true);
  checkConversations(gate.genuineConversations, 'genuineConversations', SET_MINIMUMS.genuineLength, false);
  if (!Array.isArray(gate.offTargetSingles) || gate.offTargetSingles.length < SET_MINIMUMS.offTargetSingles) {
    problems.push(`offTargetSingles: ${Array.isArray(gate.offTargetSingles) ? gate.offTargetSingles.length : 0}`);
  } else if (gate.offTargetSingles.some((m) => !isText(m))) {
    problems.push('offTargetSingles: a blank message');
  }
  return problems;
}

// ===========================================================================
// The call plan
// ===========================================================================

export type EvalGroup = 'all' | 'turn' | 'talk' | 'hollow-gate';

export interface EvalOptions {
  group: EvalGroup;
  runs: number;
  quick: boolean;
}

/** Turn calls per fighting boss; Talk messages per boss per group (full / quick). */
export const PLAN_SIZES = {
  full: { turnsPerPersona: 30, talkPerGroup: 10, gateConversations: Infinity },
  quick: { turnsPerPersona: 10, talkPerGroup: 2, gateConversations: 10 },
} as const;

/** The seconds one call is estimated to take (plan §4: ~0.9–1.2 s on a mid-range GPU). */
export const ESTIMATED_SECONDS_PER_CALL = 1.2;

export interface CallPlan {
  turn: number;
  talk: number;
  scene: number;
  gateManipulative: number;
  gateGenuine: number;
  gateOffTarget: number;
  total: number;
  /** Estimated wall-clock, minutes (upper bound: conversations stop early at a surrender). */
  minutes: number;
}

/** The bosses that fight (Turn calls): everyone but the Warden's grace scene. */
export const FIGHTING_PERSONAS: readonly BossPersonaId[] = BOSS_PERSONA_IDS.filter((id) => id !== 'warden');

/** How many calls a run makes, and roughly how long it takes. PURE. */
export function planCalls(set: MessageSet, opts: EvalOptions): CallPlan {
  const size = opts.quick ? PLAN_SIZES.quick : PLAN_SIZES.full;
  const runs = opts.quick ? 1 : Math.max(1, Math.floor(opts.runs));
  const want = (g: EvalGroup) => opts.group === 'all' || opts.group === g;
  const turn = want('turn') ? FIGHTING_PERSONAS.length * size.turnsPerPersona : 0;
  const talkPersonas = FIGHTING_PERSONAS.length;
  const talk = want('talk') ? talkPersonas * MESSAGE_GROUPS.length * size.talkPerGroup : 0;
  // The Warden speaks in Scenes: its messages, plus one verdict call.
  const scene = want('talk') ? MESSAGE_GROUPS.length * size.talkPerGroup + 1 : 0;
  const g = set.hollowGate;
  const cap = (n: number) => Math.min(n, size.gateConversations);
  const gateManipulative = want('hollow-gate')
    ? cap(g.manipulativeConversations.length) * SET_MINIMUMS.manipulativeLength * runs
    : 0;
  const genuineMessages = g.genuineConversations
    .slice(0, cap(g.genuineConversations.length))
    .reduce((n, c) => n + c.messages.length, 0);
  const gateGenuine = want('hollow-gate') ? genuineMessages * runs : 0;
  const gateOffTarget = want('hollow-gate') ? cap(g.offTargetSingles.length) * runs : 0;
  const total = turn + talk + scene + gateManipulative + gateGenuine + gateOffTarget;
  return {
    turn,
    talk,
    scene,
    gateManipulative,
    gateGenuine,
    gateOffTarget,
    total,
    minutes: Math.round((total * ESTIMATED_SECONDS_PER_CALL) / 60),
  };
}

/** The plan, as the script prints it when run without `--run`. */
export function renderPlan(plan: CallPlan, opts: EvalOptions): string {
  return [
    `Boss evaluation — plan (group: ${opts.group}${opts.quick ? ', quick' : `, runs: ${opts.runs}`})`,
    `  Turn calls            ${plan.turn}`,
    `  Talk calls            ${plan.talk}`,
    `  Scene calls (Warden)  ${plan.scene}`,
    `  Hollow gate: manipulative/empty conversation messages  ${plan.gateManipulative} (at most)`,
    `  Hollow gate: genuine conversation messages             ${plan.gateGenuine} (at most)`,
    `  Hollow gate: off-target single messages                ${plan.gateOffTarget}`,
    `  TOTAL                 ${plan.total} calls ≈ ${plan.minutes} min at ~${ESTIMATED_SECONDS_PER_CALL} s per call`,
    '',
    'No model was loaded. Add --run to run it (author only — it loads the model on the GPU).',
  ].join('\n');
}

// ===========================================================================
// Reading one call
// ===========================================================================

/** What the driver hands back for one call — the IPC result, as the shipped path returns it. */
export interface RawResult {
  ok: boolean;
  reason?: string;
  text?: string;
  timedOut?: boolean;
  ttftMs?: number;
  generateMs?: number;
  queuedMs?: number;
  grammarMs?: number;
  tokens?: number;
  promptTokens?: number;
}

export interface CallRecord {
  persona: BossPersonaId;
  kind: BossCallKind;
  group: MessageGroup | 'turn' | 'gate' | 'verdict';
  run: number;
  /** Whether a usable answer came back (parsed and within the schema). */
  answered: boolean;
  /** Why not, when it did not. */
  failure: string | null;
  /** Turn only: whether the move is one of the legal ids. `null` for other kinds. */
  legal: boolean | null;
  /** The line as the model wrote it, and as it would be shown. */
  line: string;
  shown: string;
  concession: ConcessionId | 'none' | null;
  textFaults: string[];
  /** The name used where the card forbids it (stripped before showing). */
  nameViolation: boolean;
  repeatsOpening: boolean;
  ttftMs: number | null;
  totalMs: number | null;
  promptTokens: number | null;
}

/**
 * Read one call's result the way the game will: parse, apply the name rule, check the line.
 * PURE given the vocabulary. `previous` is the boss's own earlier lines in this sequence.
 */
export function scoreCall(
  req: BossRequest,
  raw: RawResult,
  meta: { group: CallRecord['group']; run: number; previous: readonly string[] },
  vocab: TextVocabulary,
): CallRecord {
  const answer = parseBossAnswer(req, raw);
  const base = {
    persona: req.persona.id,
    kind: req.kind,
    group: meta.group,
    run: meta.run,
    ttftMs: typeof raw.ttftMs === 'number' ? raw.ttftMs : null,
    totalMs: typeof raw.generateMs === 'number' ? raw.generateMs + (raw.grammarMs ?? 0) : null,
    promptTokens: typeof raw.promptTokens === 'number' ? raw.promptTokens : null,
  };
  if (!answer.ok) {
    return {
      ...base,
      answered: false,
      failure: answer.reason,
      // A Turn that came back unusable (an illegal move, or JSON cut off) counts AGAINST the
      // legal-move rate; one that never came back (timeout, no model, error) is latency, not
      // legality, and is not counted either way.
      legal: req.kind === 'turn' && (answer.reason === 'illegal-move' || answer.reason === 'malformed') ? false : null,
      line: '',
      shown: '',
      concession: null,
      textFaults: [],
      nameViolation: false,
      repeatsOpening: false,
    };
  }
  const line = answer.kind === 'talk' ? answer.reply : answer.line;
  // The Warden's verdict call is the one call told the name, and asked to say it.
  const mode = meta.group === 'verdict' ? 'given' : req.persona.nameRule.mode;
  const named = applyNameRule(line, req.playerName, mode);
  const faults = checkBossLine(named.line, req.kind, vocab, {
    echoOf: buildBossPrompt(req).echoOf,
    previous: meta.previous,
  });
  return {
    ...base,
    answered: true,
    failure: null,
    legal: answer.kind === 'turn' ? req.kind === 'turn' && req.moves.some((m) => m.id === answer.move) : null,
    line,
    shown: named.line,
    concession: answer.kind === 'talk' ? answer.concession : null,
    textFaults: faults.filter((f) => f.rule !== 'repeats-opening').map((f) => f.rule),
    nameViolation: named.stripped,
    repeatsOpening: faults.some((f) => f.rule === 'repeats-opening'),
  };
}

// ===========================================================================
// A Hollow Self conversation (§7.1)
// ===========================================================================

export interface TalkTurn {
  typed: string;
  reply: string;
  concession: ConcessionId | 'none' | null;
}

export interface ConversationResult {
  /** The index of the message the boss surrendered on, or null if it never did. */
  surrenderedAt: number | null;
  turns: TalkTurn[];
}

/**
 * Run one conversation message by message. `ask` is given the judged WINDOW — at most the last
 * six exchanges, oldest first (§7.1) — and the new message. The conversation STOPS at the first
 * surrender: after it there is no one left to talk to. A failed call (null concession) is a
 * fallback reply with no concession (§6), and the conversation goes on.
 */
export async function runConversation(
  messages: readonly string[],
  ask: (window: readonly { them: string; you: string }[], typed: string) => Promise<{ reply: string; concession: ConcessionId | 'none' | null }>,
): Promise<ConversationResult> {
  const exchanges: { them: string; you: string }[] = [];
  const turns: TalkTurn[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const typed = messages[i] as string;
    const out = await ask(exchanges.slice(-MAX_EXCHANGES), typed);
    turns.push({ typed, reply: out.reply, concession: out.concession });
    if (out.concession === 'surrender') return { surrenderedAt: i, turns };
    exchanges.push({ them: typed, you: out.reply });
  }
  return { surrenderedAt: null, turns };
}

// ===========================================================================
// The §7.1 gate
// ===========================================================================

export type Verdict = 'PASS' | 'FAIL' | 'NOT RUN';

export interface TargetResult {
  target: string;
  measured: string;
  mark: string;
  count: number;
  of: number;
  verdict: Verdict;
}

/** `count / of` against a percentage mark, in integer arithmetic (no float edge at exactly 15%). */
function target(name: string, count: number, of: number, markPct: number, direction: 'at-most' | 'at-least'): TargetResult {
  const pct = of === 0 ? '—' : `${((count / of) * 100).toFixed(1)}%`;
  const mark = `${direction === 'at-most' ? '≤' : '≥'} ${markPct}%`;
  if (of === 0) return { target: name, measured: 'not run', mark, count, of, verdict: 'NOT RUN' };
  const pass = direction === 'at-most' ? count * 100 <= markPct * of : count * 100 >= markPct * of;
  return { target: name, measured: `${count} of ${of} = ${pct}`, mark, count, of, verdict: pass ? 'PASS' : 'FAIL' };
}

export interface GateInput {
  /** One entry per manipulative/empty conversation run: where it surrendered, or null. */
  manipulative: readonly (number | null)[];
  /** One entry per genuine conversation run. */
  genuine: readonly (number | null)[];
  /** One entry per off-target single message run: whether it was accepted. */
  offTarget: readonly boolean[];
}

/** The Hollow Self's four agreed targets (§7.1, author 2026-09-27). PURE. */
export function hollowGate(input: GateInput): TargetResult[] {
  const surrendered = input.manipulative.filter((s) => s !== null).length;
  const firstAccepted = input.genuine.filter((s) => s === 0).length;
  const byThird = input.genuine.filter((s) => s !== null && s <= 2).length;
  const offAccepted = input.offTarget.filter(Boolean).length;
  return [
    target('Manipulation ceiling (conversations ending in surrender)', surrendered, input.manipulative.length, 15, 'at-most'),
    target('Genuine acceptance — first message', firstAccepted, input.genuine.length, 60, 'at-least'),
    target('Genuine acceptance — by the third message', byThird, input.genuine.length, 90, 'at-least'),
    target('Sincere but off-target — accepted alone', offAccepted, input.offTarget.length, 20, 'at-most'),
  ];
}

// ===========================================================================
// The summary and the report
// ===========================================================================

const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Nearest-rank percentile. `null` for no data. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

const share = (count: number, of: number): number | null => (of === 0 ? null : count / of);

export interface PersonaRow {
  persona: BossPersonaId;
  calls: number;
  legalRate: number | null;
  ttftP50: number | null;
  ttftP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
  faultRate: number | null;
  nameViolations: number;
  repetition: number | null;
}

export interface KindLatency {
  kind: BossCallKind;
  calls: number;
  ttftMean: number | null;
  ttftP95: number | null;
  totalMean: number | null;
  totalP95: number | null;
  promptTokensMin: number | null;
  promptTokensMedian: number | null;
  promptTokensMax: number | null;
}

export interface EvalSummary {
  personas: PersonaRow[];
  kinds: KindLatency[];
  /** Concession rate per (boss, group): conceded / talk calls answered in that group. */
  concessions: { persona: BossPersonaId; group: MessageGroup; rate: number | null; calls: number }[];
  targets: TargetResult[];
  vram: { before: unknown; after: unknown } | null;
}

/** Everything the report says, from the call records and the gate. PURE. */
export function summarize(records: readonly CallRecord[], gate: GateInput, vram: EvalSummary['vram'] = null): EvalSummary {
  const personas: PersonaRow[] = [];
  for (const persona of BOSS_PERSONA_IDS) {
    const mine = records.filter((r) => r.persona === persona);
    if (mine.length === 0) continue;
    const turns = mine.filter((r) => r.kind === 'turn' && r.legal !== null);
    const answered = mine.filter((r) => r.answered);
    const ttft = mine.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs]));
    const total = mine.flatMap((r) => (r.totalMs === null ? [] : [r.totalMs]));
    personas.push({
      persona,
      calls: mine.length,
      legalRate: share(turns.filter((r) => r.legal === true).length, turns.length),
      ttftP50: percentile(ttft, 50),
      ttftP95: percentile(ttft, 95),
      totalP50: percentile(total, 50),
      totalP95: percentile(total, 95),
      faultRate: share(answered.filter((r) => r.textFaults.length > 0).length, answered.length),
      nameViolations: mine.filter((r) => r.nameViolation).length,
      repetition: share(answered.filter((r) => r.repeatsOpening).length, answered.length),
    });
  }

  const kinds: KindLatency[] = (['turn', 'talk', 'scene'] as const).flatMap((kind) => {
    const mine = records.filter((r) => r.kind === kind);
    if (mine.length === 0) return [];
    const ttft = mine.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs]));
    const total = mine.flatMap((r) => (r.totalMs === null ? [] : [r.totalMs]));
    const tokens = mine.flatMap((r) => (r.promptTokens === null ? [] : [r.promptTokens]));
    return [
      {
        kind,
        calls: mine.length,
        ttftMean: mean(ttft),
        ttftP95: percentile(ttft, 95),
        totalMean: mean(total),
        totalP95: percentile(total, 95),
        promptTokensMin: tokens.length ? Math.min(...tokens) : null,
        promptTokensMedian: percentile(tokens, 50),
        promptTokensMax: tokens.length ? Math.max(...tokens) : null,
      },
    ];
  });

  const concessions: EvalSummary['concessions'] = [];
  for (const persona of BOSS_PERSONA_IDS) {
    for (const group of MESSAGE_GROUPS) {
      const mine = records.filter((r) => r.persona === persona && r.group === group && r.kind === 'talk' && r.answered);
      if (mine.length === 0) continue;
      concessions.push({ persona, group, calls: mine.length, rate: share(mine.filter((r) => r.concession !== 'none' && r.concession !== null).length, mine.length) });
    }
  }

  // The gate: the grammar makes an illegal move impossible, and the script proves it (§7 item 1);
  // a boss with nothing to yield never yields; then the Hollow Self's four targets.
  const turnsAll = records.filter((r) => r.kind === 'turn' && r.legal !== null);
  const cannotConcede = records.filter((r) => r.kind === 'talk' && r.answered && r.persona === 'executioner');
  const targets: TargetResult[] = [
    target('Legal move rate (must be 100%)', turnsAll.filter((r) => r.legal === true).length, turnsAll.length, 100, 'at-least'),
    target(
      'The executioner never concedes',
      cannotConcede.filter((r) => r.concession !== 'none' && r.concession !== null).length,
      cannotConcede.length,
      0,
      'at-most',
    ),
    ...hollowGate(gate),
  ];

  return { personas, kinds, concessions, targets, vram };
}

const fmtPct = (x: number | null): string => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const fmtMs = (x: number | null): string => (x === null ? '—' : `${Math.round(x)} ms`);
const fmtN = (x: number | null): string => (x === null ? '—' : String(Math.round(x)));

/** The report the script prints and writes. Every number, and a PASS/FAIL per target. PURE. */
export function renderReport(s: EvalSummary): string {
  const out: string[] = ['BOSS EVALUATION REPORT', ''];
  out.push('Per boss');
  out.push('  boss               calls  legal   ttft p50/p95        total p50/p95       faults  name  repeats');
  for (const r of s.personas) {
    out.push(
      `  ${r.persona.padEnd(18)} ${String(r.calls).padStart(5)}  ${fmtPct(r.legalRate).padStart(6)}  ` +
        `${`${fmtMs(r.ttftP50)} / ${fmtMs(r.ttftP95)}`.padEnd(18)}  ${`${fmtMs(r.totalP50)} / ${fmtMs(r.totalP95)}`.padEnd(18)}  ` +
        `${fmtPct(r.faultRate).padStart(6)}  ${String(r.nameViolations).padStart(4)}  ${fmtPct(r.repetition).padStart(7)}`,
    );
  }
  out.push('', 'Per call kind');
  out.push('  kind   calls  ttft mean/p95        total mean/p95       prompt tokens min/median/max');
  for (const k of s.kinds) {
    out.push(
      `  ${k.kind.padEnd(6)} ${String(k.calls).padStart(5)}  ${`${fmtMs(k.ttftMean)} / ${fmtMs(k.ttftP95)}`.padEnd(19)}  ` +
        `${`${fmtMs(k.totalMean)} / ${fmtMs(k.totalP95)}`.padEnd(19)}  ${fmtN(k.promptTokensMin)} / ${fmtN(k.promptTokensMedian)} / ${fmtN(k.promptTokensMax)}`,
    );
  }
  out.push('', 'Concession rate by message group');
  out.push(`  boss               ${MESSAGE_GROUPS.map((g) => g.padStart(19)).join('')}`);
  for (const persona of BOSS_PERSONA_IDS) {
    const row = MESSAGE_GROUPS.map((g) => {
      const c = s.concessions.find((x) => x.persona === persona && x.group === g);
      return (c ? `${fmtPct(c.rate)} (${c.calls})` : '—').padStart(19);
    });
    if (row.every((cell) => cell.trim() === '—')) continue;
    out.push(`  ${persona.padEnd(18)} ${row.join('')}`);
  }
  out.push('', 'Targets');
  for (const t of s.targets) out.push(`  [${t.verdict}] ${t.target}: ${t.measured} (mark ${t.mark})`);
  if (s.vram) out.push('', `VRAM before: ${JSON.stringify(s.vram.before)}`, `VRAM after:  ${JSON.stringify(s.vram.after)}`);
  const failed = s.targets.filter((t) => t.verdict === 'FAIL').length;
  out.push('', failed === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed} target${failed === 1 ? '' : 's'} missed)`);
  return out.join('\n');
}

/** Non-zero on any FAIL, so the script can be the merge gate. A target NOT RUN does not fail. */
export function exitCode(s: EvalSummary): number {
  return s.targets.some((t) => t.verdict === 'FAIL') ? 1 : 0;
}

// ===========================================================================
// Arguments, and where the model lives
// ===========================================================================

export interface CliOptions extends EvalOptions {
  run: boolean;
  personas: string;
  messages: string | null;
  out: string;
}

/** Parse the script's arguments. Unknown flags are errors, so a typo cannot start a 75-minute run. */
export function parseArgs(argv: readonly string[]): { ok: true; options: CliOptions } | { ok: false; error: string } {
  const options: CliOptions = { run: false, personas: 'fixture', messages: null, runs: 3, group: 'all', quick: false, out: 'logs/boss-eval' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const value = (): string | null => {
      const v = argv[i + 1];
      i += 1;
      return v === undefined || v.startsWith('--') ? null : v;
    };
    if (arg === '--run') options.run = true;
    else if (arg === '--quick') options.quick = true;
    else if (arg === '--personas') {
      const v = value();
      if (v === null) return { ok: false, error: '--personas needs a path or "fixture"' };
      options.personas = v;
    } else if (arg === '--messages') {
      const v = value();
      if (v === null) return { ok: false, error: '--messages needs a path' };
      options.messages = v;
    } else if (arg === '--runs') {
      const v = Number(value());
      if (!Number.isInteger(v) || v < 1) return { ok: false, error: '--runs needs a whole number of at least 1' };
      options.runs = v;
    } else if (arg === '--group') {
      const v = value();
      if (v !== 'all' && v !== 'turn' && v !== 'talk' && v !== 'hollow-gate') {
        return { ok: false, error: '--group must be all, turn, talk or hollow-gate' };
      }
      options.group = v;
    } else if (arg === '--out') {
      const v = value();
      if (v === null) return { ok: false, error: '--out needs a directory' };
      options.out = v;
    } else return { ok: false, error: `unknown argument: ${arg}` };
  }
  return { ok: true, options };
}

/**
 * Electron's per-user data directory for this app, computed the way Electron does — so the
 * script finds the model the game downloaded (`electron/model-path.mjs` then applies the
 * `VOID_MODELS_DIR` override). Never `./models`. PURE: everything is passed in.
 */
export function electronUserDataDir({
  platform,
  env,
  home,
  appName = 'the-void',
}: {
  platform: string;
  env: Record<string, string | undefined>;
  home: string;
  appName?: string;
}): string {
  const join = (...parts: string[]) => parts.join(platform === 'win32' ? '\\' : '/');
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), appName);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', appName);
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), appName);
}

/** The model file in a directory listing: the 4B GGUF the game uses, or null. */
export function pickModelFile(files: readonly string[]): string | null {
  return files.find((f) => /qwen3-4b.*\.gguf$/i.test(f)) ?? null;
}

/** A persona list loaded from JSON: every entry must validate, every id at most once. */
export function personaListProblems(list: unknown, validate: (x: unknown) => boolean): string[] {
  if (!Array.isArray(list)) return ['the personas file must hold a list'];
  const problems: string[] = [];
  const seen = new Set<unknown>();
  list.forEach((p, i) => {
    if (!validate(p)) problems.push(`entry ${i} is not a valid persona`);
    const id = (p as { id?: unknown })?.id;
    if (seen.has(id)) problems.push(`entry ${i} repeats ${String(id)}`);
    seen.add(id);
  });
  return problems;
}

/** A persona by id from a loaded list. */
export function personaById(list: readonly BossPersona[], id: BossPersonaId): BossPersona | undefined {
  return list.find((p) => p.id === id);
}
