// THE BOSS EVALUATION — its pure core (PLAN.md #11 part B; `docs/BOSS-PROMPTS.md` §7).
//
// Three modules sit on this one: `boss-eval-run.ts` (the run — every loop, the queue, the gate),
// `boss-eval-cli.ts` (the command — arguments, inputs, the model's location, the exit status) and
// `boss-eval.ts` (the process entry, which hands them the REAL model — author-run only, never an
// agent, never a test). Everything that can be decided without the model lives here, so it is
// tested against a scripted fake: which calls to make, how to read each answer, how a Hollow Self
// conversation proceeds and when it stops, the §7.1 gate arithmetic, the report, and the exit status.
//
// Every scoring step uses the SHIPPED pure layer (`src/llm/boss*.ts`) — the same builders, the
// same parser, the same name rule and line check the game uses — so what the script measures is
// what the player would see.
//
// No clock, no randomness, no I/O here. The driver times, generates and writes.

import type { BossCallKind, BossPersona, BossPersonaId, BossRequest, ConcessionId } from '../src/llm/bossContract.ts';
import { BOSS_PERSONA_IDS } from '../src/llm/bossContract.ts';
import { applyNameRule, checkBossLine, fallbackFor, parseBossAnswer } from '../src/llm/bossAnswer.ts';
import { buildBossPrompt, MAX_EXCHANGES } from '../src/llm/bossPrompt.ts';
import type { TextVocabulary } from '../src/llm/textHygiene.ts';

// ===========================================================================
// The test set
// ===========================================================================

/** The five kinds of message every boss is tested with (§7 item 5). */
export const MESSAGE_GROUPS = ['genuine-on-target', 'genuine-off-target', 'rude', 'manipulative', 'empty'] as const;
export type MessageGroup = (typeof MESSAGE_GROUPS)[number];

/**
 * What `messages.json` says since the author reviewed it (2026-09-29, NEEDS-HUMAN step 1). It was
 * "DRAFT — author review before it becomes the gate" until then. The lines the review asked for were
 * drafted by the pipeline, so the status says they are shown to the author before the full gate run.
 */
export const REVIEWED_STATUS =
  'REVIEWED by the author 2026-09-29 — the rewritten/added lines were drafted by the pipeline and are shown to the author before the full gate run';

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
    pools?: {
      manipulative: readonly string[];
      empty: readonly string[];
      /** The manipulation kinds the author asked for (2026-09-29), each a subset of `manipulative`. */
      manipulativeKinds?: Readonly<Record<string, readonly string[]>>;
    };
    manipulativeConversations: readonly GateConversation[];
    genuineConversations: readonly GateConversation[];
    offTargetSingles: readonly string[];
    /**
     * Off-target remorse, then a message that connects it to the Hollow Self (the author, 2026-09-29):
     * exactly two messages each. Judged: accepted by the connecting message.
     */
    connectionConversations: readonly GateConversation[];
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
  connectionConversations: 20,
  connectionLength: 2,
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
  const checkConversations = (
    list: readonly GateConversation[] | undefined,
    name: string,
    min: number,
    exact: boolean,
    count: number = SET_MINIMUMS.gateConversations,
  ) => {
    if (!Array.isArray(list) || list.length < count) {
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
  checkConversations(
    gate.connectionConversations,
    'connectionConversations',
    SET_MINIMUMS.connectionLength,
    true,
    SET_MINIMUMS.connectionConversations,
  );
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
  gateConnections: number;
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
  const gateConnections = want('hollow-gate')
    ? cap(g.connectionConversations.length) * SET_MINIMUMS.connectionLength * runs
    : 0;
  const total = turn + talk + scene + gateManipulative + gateGenuine + gateOffTarget + gateConnections;
  return {
    turn,
    talk,
    scene,
    gateManipulative,
    gateGenuine,
    gateOffTarget,
    gateConnections,
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
    `  Hollow gate: manipulative/empty conversation messages  ${plan.gateManipulative} (before retries)`,
    `  Hollow gate: genuine conversation messages             ${plan.gateGenuine} (before retries)`,
    `  Hollow gate: off-target single messages                ${plan.gateOffTarget}`,
    `  Hollow gate: remorse-then-connecting messages          ${plan.gateConnections} (before retries)`,
    `  TOTAL                 ${plan.total} calls ≈ ${plan.minutes} min at ~${ESTIMATED_SECONDS_PER_CALL} s per call`,
    '',
    'No model was loaded. Add --run to run it (author only — it loads the model on the GPU).',
  ].join('\n');
}

// ===========================================================================
// Reading one call
// ===========================================================================

/**
 * What the driver hands back for one call — the IPC result, as the shipped path returns it.
 *
 * `ranMs` is the queue's own measurement of how long the call held the model, and it is the only
 * duration a TIMED-OUT call has: the queue resolves a timeout with `{ ok:false, reason:'timeout',
 * queuedMs, ranMs }` and no generation timings at all. A report that read only `generateMs` could
 * therefore never show a call past the deadline (fix round 1, F1).
 */
export interface RawResult {
  ok: boolean;
  reason?: string;
  text?: string;
  timedOut?: boolean;
  ttftMs?: number;
  generateMs?: number;
  queuedMs?: number;
  ranMs?: number;
  grammarMs?: number;
  tokens?: number;
  promptTokens?: number;
}

/** The sets of calls whose failure share is judged (see `FAILURE_CEILING_PCT`). */
export const CALL_GROUPS = ['turn', 'talk', 'scene', 'gate-manipulative', 'gate-genuine', 'gate-off-target', 'gate-connections'] as const;
export type CallGroup = (typeof CALL_GROUPS)[number];

/** The three Hollow Self gate sets, as call-record groups. */
export type GateGroup = 'gate-manipulative' | 'gate-genuine' | 'gate-off-target' | 'gate-connections';

/** The gate sets, as the tally names them. */
export type GateSet = 'manipulative' | 'genuine' | 'offTarget' | 'connections';

export interface CallRecord {
  persona: BossPersonaId;
  kind: BossCallKind;
  group: MessageGroup | 'turn' | GateGroup | 'verdict';
  run: number;
  /** Whether a usable answer came back (parsed and within the schema). */
  answered: boolean;
  /** Why not, when it did not: a `BossAnswer` failure reason. */
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
  /** Time to the first token. `null` when no token ever came (a timeout before any text). */
  ttftMs: number | null;
  /** How long the call held the model — for a timeout, how long until it was cut off. */
  totalMs: number | null;
  promptTokens: number | null;
}

/**
 * How a call failed, for the counts. `timeout`, `error` and `malformed` (an answer cut off or
 * out of shape) are FAILED CALLS — nothing usable came back — and they decide whether a group's
 * result can be trusted. `illegal` (a move or concession the grammar should have made
 * impossible) is a real answer that broke a rule, and it fails the legal-move target instead.
 */
export type FailureClass = 'timeout' | 'error' | 'malformed' | 'illegal';

export function failureClass(failure: string | null): FailureClass | null {
  if (failure === null) return null;
  if (failure === 'timeout') return 'timeout';
  if (failure === 'malformed') return 'malformed';
  if (failure === 'illegal-move' || failure === 'illegal-concession') return 'illegal';
  return 'error'; // 'error', 'no-model', anything unexpected
}

/** True when nothing usable came back: a timeout, an error, or a cut-off/malformed answer. */
export function isFailedCall(r: Pick<CallRecord, 'failure'>): boolean {
  const c = failureClass(r.failure);
  return c === 'timeout' || c === 'error' || c === 'malformed';
}

/** Which judged set a call belongs to. */
export function callGroupOf(r: Pick<CallRecord, 'kind' | 'group'>): CallGroup {
  if (r.group === 'gate-manipulative' || r.group === 'gate-genuine' || r.group === 'gate-off-target' || r.group === 'gate-connections') {
    return r.group;
  }
  if (r.kind === 'turn') return 'turn';
  if (r.kind === 'scene') return 'scene';
  return 'talk';
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
  const generated = typeof raw.generateMs === 'number' ? raw.generateMs + (raw.grammarMs ?? 0) : null;
  const base = {
    persona: req.persona.id,
    kind: req.kind,
    group: meta.group,
    run: meta.run,
    ttftMs: typeof raw.ttftMs === 'number' ? raw.ttftMs : null,
    // The queue's `ranMs` when it measured one (every real call, and the ONLY timing a timeout
    // has); the call's own timings otherwise.
    totalMs: typeof raw.ranMs === 'number' ? raw.ranMs : generated,
    promptTokens: typeof raw.promptTokens === 'number' ? raw.promptTokens : null,
  };
  if (!answer.ok) {
    return {
      ...base,
      answered: false,
      failure: answer.reason,
      // A Turn that came back unusable (an illegal move, or JSON cut off) counts AGAINST the
      // legal-move rate; one that never came back (timeout, no model, error) is latency, not
      // legality, and is not counted either way — it is counted as a FAILED CALL instead.
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
  /** The index of the message whose call FAILED on every attempt (timeout, error, cut off), or null. */
  failedAt: number | null;
  turns: TalkTurn[];
  /** Re-asks made after a failed call, and how many of those messages then got an answer. */
  retries: number;
  recovered: number;
}

/** A failed gate message is asked this many more times before its conversation is dropped. */
export const GATE_RETRIES = 2;

/** How one conversation counts toward the gate: where it surrendered, never, or not at all. */
export type ConversationOutcome = number | null | 'failed';

/** A finished conversation, as the gate counts it. */
export function outcomeOf(result: ConversationResult): ConversationOutcome {
  return result.failedAt !== null ? 'failed' : result.surrenderedAt;
}

/**
 * Run one conversation message by message. `ask` is given the judged WINDOW — at most the last
 * six exchanges, oldest first (§7.1) — and the new message. The conversation STOPS at the first
 * surrender (after it there is no one left to talk to).
 *
 * A FAILED call (timeout, error, cut-off answer) is not a refusal. The message is asked again —
 * the same message, the same window — up to `retries` more times (the orchestrator's methodology
 * amendment, 2026-09-28: without it, the long conversations that hold out are the ones a timeout
 * removes, which skews every Hollow Self target). Only when every attempt fails does the
 * conversation stop, marked failed, and the gate leaves it out of its counts and reports it.
 */
export async function runConversation(
  messages: readonly string[],
  ask: (
    window: readonly { them: string; you: string }[],
    typed: string,
  ) => Promise<{ reply: string; concession: ConcessionId | 'none' | null; failed?: boolean }>,
  retries: number = GATE_RETRIES,
): Promise<ConversationResult> {
  const exchanges: { them: string; you: string }[] = [];
  const turns: TalkTurn[] = [];
  let retried = 0;
  let recovered = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const typed = messages[i] as string;
    const window = exchanges.slice(-MAX_EXCHANGES);
    let out = await ask(window, typed);
    for (let attempt = 0; out.failed === true && attempt < retries; attempt += 1) {
      retried += 1;
      out = await ask(window, typed);
      if (out.failed !== true) recovered += 1;
    }
    turns.push({ typed, reply: out.reply, concession: out.concession });
    if (out.failed === true) return { surrenderedAt: null, failedAt: i, turns, retries: retried, recovered };
    if (out.concession === 'surrender') return { surrenderedAt: i, failedAt: null, turns, retries: retried, recovered };
    exchanges.push({ them: typed, you: out.reply });
  }
  return { surrenderedAt: null, failedAt: null, turns, retries: retried, recovered };
}

// ===========================================================================
// The targets
// ===========================================================================

/**
 * `INCONCLUSIVE` — too many of the calls behind a target failed to trust its verdict either way.
 * The ruling (orchestrator, fix round 1): more than `FAILURE_CEILING_PCT` of a group's calls
 * failing makes that group's targets INCONCLUSIVE and the exit status non-zero.
 */
export type Verdict = 'PASS' | 'FAIL' | 'NOT RUN' | 'INCONCLUSIVE';

/** More than this share of a group's calls failing makes the group's result INCONCLUSIVE. */
export const FAILURE_CEILING_PCT = 5;

export interface GroupFailures {
  group: CallGroup;
  calls: number;
  failed: number;
  timeout: number;
  error: number;
  malformed: number;
  /** More than `FAILURE_CEILING_PCT` failed. */
  inconclusive: boolean;
}

/** Failed-call counts per group. PURE. Integer arithmetic, so 5% exactly is not inconclusive. */
export function groupFailures(records: readonly CallRecord[]): GroupFailures[] {
  return CALL_GROUPS.flatMap((group) => {
    const mine = records.filter((r) => callGroupOf(r) === group);
    if (mine.length === 0) return [];
    const count = (c: FailureClass) => mine.filter((r) => failureClass(r.failure) === c).length;
    const failed = mine.filter(isFailedCall).length;
    return [
      {
        group,
        calls: mine.length,
        failed,
        timeout: count('timeout'),
        error: count('error'),
        malformed: count('malformed'),
        inconclusive: failed * 100 > FAILURE_CEILING_PCT * mine.length,
      },
    ];
  });
}

export interface TargetResult {
  target: string;
  /** The call group whose failures decide whether this target can be trusted. */
  group: CallGroup;
  measured: string;
  mark: string;
  count: number;
  of: number;
  /** Units (conversations, messages) left out because a call in them failed on every attempt. */
  excluded: number;
  /** Re-asks made after a failed call in this target's set, and how many then got an answer. */
  retries: number;
  recovered: number;
  /** Failed calls in this target's group, and all its calls. */
  failedCalls: number;
  calls: number;
  verdict: Verdict;
  /** The verdict on the calls that DID answer, before an INCONCLUSIVE group demoted it. */
  asMeasured: Verdict;
}

/** `count / of` against a percentage mark, in integer arithmetic (no float edge at exactly 15%). */
function target(
  name: string,
  group: CallGroup,
  count: number,
  of: number,
  markPct: number,
  direction: 'at-most' | 'at-least',
  excluded = 0,
): TargetResult {
  const pct = of === 0 ? '—' : `${((count / of) * 100).toFixed(1)}%`;
  const mark = `${direction === 'at-most' ? '≤' : '≥'} ${markPct}%`;
  const common = { target: name, group, mark, count, of, excluded, failedCalls: 0, calls: 0, retries: 0, recovered: 0 };
  // Too many UNITS left out — the orchestrator's methodology amendment (2026-09-28). One failed
  // call removes a whole conversation, so the per-call 5% rule cannot protect a conversation
  // target; the same ceiling is applied to the conversations themselves. Nothing judged at all,
  // with something left out, is ALWAYS inconclusive — never "not run", never a pass.
  const tooManyLeftOut = excluded * 100 > FAILURE_CEILING_PCT * (of + excluded) || (of === 0 && excluded > 0);
  if (of === 0) {
    return excluded > 0
      ? { ...common, measured: 'none judged', verdict: 'INCONCLUSIVE', asMeasured: 'NOT RUN' }
      : { ...common, measured: 'not run', verdict: 'NOT RUN', asMeasured: 'NOT RUN' };
  }
  const pass = direction === 'at-most' ? count * 100 <= markPct * of : count * 100 >= markPct * of;
  const asMeasured: Verdict = pass ? 'PASS' : 'FAIL';
  return { ...common, measured: `${count} of ${of} = ${pct}`, verdict: tooManyLeftOut ? 'INCONCLUSIVE' : asMeasured, asMeasured };
}

export interface GateInput {
  /** One entry per manipulative/empty conversation run: where it surrendered, never, or 'failed'. */
  manipulative: readonly ConversationOutcome[];
  /** One entry per genuine conversation run. */
  genuine: readonly ConversationOutcome[];
  /** One entry per off-target single message run: accepted, refused, or 'failed'. */
  offTarget: readonly (boolean | 'failed')[];
  /** One entry per remorse-then-connecting conversation run. Absent = none ran. */
  connections?: readonly ConversationOutcome[];
  /** Re-asks per set, summed from each `ConversationResult` (`addRetries`). */
  retries?: Partial<Record<GateSet, { retries: number; recovered: number }>>;
}

/** Add one conversation's re-asks to a running per-set tally. */
export function addRetries(
  tally: { retries: number; recovered: number },
  result: Pick<ConversationResult, 'retries' | 'recovered'>,
): void {
  tally.retries += result.retries;
  tally.recovered += result.recovered;
}

/** The gate being built up by a run: outcomes per set, and the re-asks per set. */
export interface GateTally {
  manipulative: ConversationOutcome[];
  genuine: ConversationOutcome[];
  offTarget: (boolean | 'failed')[];
  connections: ConversationOutcome[];
  retries: Record<GateSet, { retries: number; recovered: number }>;
}

export function emptyGate(): GateTally {
  const tally = () => ({ retries: 0, recovered: 0 });
  return {
    manipulative: [],
    genuine: [],
    offTarget: [],
    connections: [],
    retries: { manipulative: tally(), genuine: tally(), offTarget: tally(), connections: tally() },
  };
}

/** Which gate set a call group feeds. */
const SET_OF: Readonly<Record<GateGroup, GateSet>> = {
  'gate-manipulative': 'manipulative',
  'gate-genuine': 'genuine',
  'gate-off-target': 'offTarget',
  'gate-connections': 'connections',
};

/**
 * Record one finished conversation into the gate: its re-asks, and its outcome. An off-target
 * single message counts as accepted only when it surrendered on that one message.
 */
export function recordGateResult(gate: GateTally, group: GateGroup, result: ConversationResult): void {
  const set = SET_OF[group];
  addRetries(gate.retries[set], result);
  const outcome = outcomeOf(result);
  if (set === 'offTarget') gate.offTarget.push(outcome === 'failed' ? 'failed' : outcome === 0);
  else gate[set].push(outcome);
}

/**
 * One Hollow Self gate conversation, exactly as the driver runs it — shared so the tests drive the
 * SAME wiring the real run uses. `call` generates one answer (the real model in the driver, a
 * script in a test); every attempt, retries included, is scored and recorded. An answer that came
 * back but broke a rule (an illegal concession) is what the game would show — a fallback with no
 * concession (§6); a call that never came back is `failed`, which `runConversation` retries.
 */
export function gateConversation(opts: {
  messages: readonly string[];
  group: GateGroup;
  run: number;
  persona: BossPersona;
  request: (window: readonly { them: string; you: string }[], typed: string) => BossRequest;
  call: (req: BossRequest) => Promise<RawResult>;
  vocab: TextVocabulary;
  records: CallRecord[];
}): Promise<ConversationResult> {
  let asked = 0;
  return runConversation(opts.messages, async (window, typed) => {
    asked += 1;
    const req = opts.request(window, typed);
    const rec = scoreCall(req, await opts.call(req), { group: opts.group, run: opts.run, previous: [] }, opts.vocab);
    opts.records.push(rec);
    if (rec.answered) return { reply: rec.shown, concession: rec.concession };
    return { reply: fallbackFor(opts.persona, 'talk', asked), concession: null, failed: isFailedCall(rec) };
  });
}

/**
 * The Hollow Self's agreed targets (§7.1): the four of 2026-09-27, and the connection target the author added
 * on 2026-09-29 (≥ 70% of remorse-then-connecting conversations accepted by the connecting message). PURE.
 *
 * A conversation (or single message) whose call FAILED on every attempt is not a refusal: it is
 * left out of the target's numerator AND denominator, and counted in `excluded`. Otherwise every
 * timeout would look like the judge holding firm. And because the conversations a timeout removes
 * are the long, holding-out ones, more than 5% of them left out makes the target INCONCLUSIVE.
 */
export function hollowGate(input: GateInput): TargetResult[] {
  const judged = <T>(xs: readonly T[]) => xs.filter((x) => x !== 'failed') as Exclude<T, 'failed'>[];
  const manipulative = judged(input.manipulative);
  const genuine = judged(input.genuine);
  const offTarget = judged(input.offTarget);
  const connections = judged(input.connections ?? []);
  const excluded = <T>(xs: readonly T[]) => xs.filter((x) => x === 'failed').length;

  const surrendered = manipulative.filter((s) => s !== null).length;
  const firstAccepted = genuine.filter((s) => s === 0).length;
  const byThird = genuine.filter((s) => s !== null && s <= 2).length;
  const offAccepted = offTarget.filter((x) => x === true).length;
  // A connection conversation has two messages, the connecting one last: a surrender on either counts
  // as "accepted by the connecting message" (the remorse counts toward the conversation, §7.1).
  const connected = connections.filter((s) => s !== null).length;
  const retried = (set: GateSet) => ({
    retries: input.retries?.[set]?.retries ?? 0,
    recovered: input.retries?.[set]?.recovered ?? 0,
  });
  return [
    { ...target('Manipulation ceiling (conversations ending in surrender)', 'gate-manipulative', surrendered, manipulative.length, 15, 'at-most', excluded(input.manipulative)), ...retried('manipulative') },
    { ...target('Genuine acceptance — first message', 'gate-genuine', firstAccepted, genuine.length, 60, 'at-least', excluded(input.genuine)), ...retried('genuine') },
    { ...target('Genuine acceptance — by the third message', 'gate-genuine', byThird, genuine.length, 90, 'at-least', excluded(input.genuine)), ...retried('genuine') },
    { ...target('Sincere but off-target — accepted alone', 'gate-off-target', offAccepted, offTarget.length, 20, 'at-most', excluded(input.offTarget)), ...retried('offTarget') },
    { ...target('Remorse, then connecting — accepted by the connecting message', 'gate-connections', connected, connections.length, 70, 'at-least', excluded(input.connections ?? [])), ...retried('connections') },
  ];
}

/** What a target reads when its group's calls ran but none of them reached it. */
export const UNREACHED = 'nothing judged, though its calls ran';

/**
 * Attach each target's group failures, and demote its verdict when the group is untrustworthy —
 * or when the group ran and the target still has nothing in it.
 */
function withFailures(targets: readonly TargetResult[], groups: readonly GroupFailures[]): TargetResult[] {
  return targets.map((t) => {
    const g = groups.find((x) => x.group === t.group);
    if (!g) return t; // its group never ran: NOT RUN stays NOT RUN (a `--group` run's other targets)
    // A target its group's calls never reached is a WIRING fault, not a model fault — and it must
    // never read as "not run" beside thousands of calls that ran (fix round 3, F8: the gate handed
    // to the summary as `emptyGate()` printed NOT RUN and exited 0 after 2,400 gate calls).
    const unreached = t.verdict === 'NOT RUN' && g.calls > 0;
    return {
      ...t,
      failedCalls: g.failed,
      calls: g.calls,
      ...(unreached ? { measured: UNREACHED } : {}),
      // A group with calls but too many failures is INCONCLUSIVE — even when nothing in it was
      // judged at all (every gate call timed out), which must never read as "not run".
      verdict: g.inconclusive || unreached ? 'INCONCLUSIVE' : t.verdict,
    };
  });
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

/** Calls, and how many of each failure class, for a set of records. */
export interface CallCounts {
  calls: number;
  answered: number;
  timeout: number;
  error: number;
  malformed: number;
  illegal: number;
}

function countsOf(records: readonly CallRecord[]): CallCounts {
  const n = (c: FailureClass) => records.filter((r) => failureClass(r.failure) === c).length;
  return {
    calls: records.length,
    answered: records.filter((r) => r.answered).length,
    timeout: n('timeout'),
    error: n('error'),
    malformed: n('malformed'),
    illegal: n('illegal'),
  };
}

export interface PersonaRow extends CallCounts {
  persona: BossPersonaId;
  legalRate: number | null;
  ttftP50: number | null;
  ttftP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
  faultRate: number | null;
  nameViolations: number;
  repetition: number | null;
}

export interface KindLatency extends CallCounts {
  kind: BossCallKind;
  ttftMean: number | null;
  ttftP95: number | null;
  /** Every call that held the model, TIMED-OUT CALLS INCLUDED (at the time they were cut off). */
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
  groups: GroupFailures[];
  targets: TargetResult[];
  vram: { before: unknown; after: unknown } | null;
}

const timings = (records: readonly CallRecord[], key: 'ttftMs' | 'totalMs'): number[] =>
  records.flatMap((r) => (r[key] === null ? [] : [r[key] as number]));

/** Everything the report says, from the call records and the gate. PURE. */
export function summarize(records: readonly CallRecord[], gate: GateInput, vram: EvalSummary['vram'] = null): EvalSummary {
  const personas: PersonaRow[] = [];
  for (const persona of BOSS_PERSONA_IDS) {
    const mine = records.filter((r) => r.persona === persona);
    if (mine.length === 0) continue;
    const turns = mine.filter((r) => r.kind === 'turn' && r.legal !== null);
    const answered = mine.filter((r) => r.answered);
    const ttft = timings(mine, 'ttftMs');
    const total = timings(mine, 'totalMs');
    personas.push({
      persona,
      ...countsOf(mine),
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
    const ttft = timings(mine, 'ttftMs');
    const total = timings(mine, 'totalMs');
    const tokens = mine.flatMap((r) => (r.promptTokens === null ? [] : [r.promptTokens]));
    return [
      {
        kind,
        ...countsOf(mine),
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
  // a boss with nothing to yield never yields; then the Hollow Self's four targets. Every target
  // carries its group's failed calls, and goes INCONCLUSIVE when there are too many.
  const turnsAll = records.filter((r) => r.kind === 'turn' && r.legal !== null);
  const cannotConcede = records.filter((r) => callGroupOf(r) === 'talk' && r.answered && r.persona === 'executioner');
  const groups = groupFailures(records);
  const targets = withFailures(
    [
      target('Legal move rate (must be 100%)', 'turn', turnsAll.filter((r) => r.legal === true).length, turnsAll.length, 100, 'at-least'),
      target(
        'The executioner never concedes',
        'talk',
        cannotConcede.filter((r) => r.concession !== 'none' && r.concession !== null).length,
        cannotConcede.length,
        0,
        'at-most',
      ),
      ...hollowGate(gate),
    ],
    groups,
  );

  return { personas, kinds, concessions, groups, targets, vram };
}

const fmtPct = (x: number | null): string => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const fmtMs = (x: number | null): string => (x === null ? '—' : `${Math.round(x)} ms`);
const fmtN = (x: number | null): string => (x === null ? '—' : String(Math.round(x)));
const fmtFailures = (c: CallCounts): string =>
  `${String(c.timeout).padStart(7)}  ${String(c.error).padStart(5)}  ${String(c.malformed).padStart(9)}  ${String(c.illegal).padStart(7)}`;

/** The exit statuses, documented where the script's user will look (`renderReport`'s legend). */
export const EXIT = { pass: 0, fail: 1, badInput: 2, inconclusive: 3, crashed: 4 } as const;

/** The overall result: INCONCLUSIVE wins over FAIL — a run that cannot be trusted is re-run first. */
export function overallResult(s: EvalSummary): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  if (s.groups.some((g) => g.inconclusive) || s.targets.some((t) => t.verdict === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return s.targets.some((t) => t.verdict === 'FAIL') ? 'FAIL' : 'PASS';
}

/** The report the script prints and writes. Every number, and a verdict per target. PURE. */
export function renderReport(s: EvalSummary): string {
  const out: string[] = ['BOSS EVALUATION REPORT', ''];
  out.push('Per boss   (total = how long the call held the model; a timed-out call counts at the moment it was cut off)');
  out.push('  boss               calls  answered  timeout  error  malformed  illegal  legal   ttft p50/p95        total p50/p95       faults  name  repeats');
  for (const r of s.personas) {
    out.push(
      `  ${r.persona.padEnd(18)} ${String(r.calls).padStart(5)}  ${String(r.answered).padStart(8)}  ${fmtFailures(r)}  ${fmtPct(r.legalRate).padStart(6)}  ` +
        `${`${fmtMs(r.ttftP50)} / ${fmtMs(r.ttftP95)}`.padEnd(18)}  ${`${fmtMs(r.totalP50)} / ${fmtMs(r.totalP95)}`.padEnd(18)}  ` +
        `${fmtPct(r.faultRate).padStart(6)}  ${String(r.nameViolations).padStart(4)}  ${fmtPct(r.repetition).padStart(7)}`,
    );
  }
  out.push('', 'Per call kind');
  out.push('  kind   calls  answered  timeout  error  malformed  illegal  ttft mean/p95        total mean/p95       prompt tokens min/median/max');
  for (const k of s.kinds) {
    out.push(
      `  ${k.kind.padEnd(6)} ${String(k.calls).padStart(5)}  ${String(k.answered).padStart(8)}  ${fmtFailures(k)}  ` +
        `${`${fmtMs(k.ttftMean)} / ${fmtMs(k.ttftP95)}`.padEnd(19)}  ` +
        `${`${fmtMs(k.totalMean)} / ${fmtMs(k.totalP95)}`.padEnd(19)}  ${fmtN(k.promptTokensMin)} / ${fmtN(k.promptTokensMedian)} / ${fmtN(k.promptTokensMax)}`,
    );
  }
  out.push('', `Failed calls by group   (timeout, error or malformed; more than ${FAILURE_CEILING_PCT}% makes the group INCONCLUSIVE)`);
  for (const g of s.groups) {
    out.push(
      `  ${g.group.padEnd(18)} ${g.failed} of ${g.calls} failed (timeout ${g.timeout}, error ${g.error}, malformed ${g.malformed})` +
        (g.inconclusive ? '  INCONCLUSIVE' : ''),
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
  out.push(
    '',
    `Targets   (a failed gate message is asked up to ${GATE_RETRIES} more times; a conversation that still fails is left out of its target, ` +
      `never counted as a refusal, and more than ${FAILURE_CEILING_PCT}% left out makes the target INCONCLUSIVE)`,
  );
  for (const t of s.targets) {
    out.push(
      `  [${t.verdict}] ${t.target}: ${t.measured} (mark ${t.mark}) — failed calls ${t.failedCalls} of ${t.calls}` +
        (t.retries > 0 ? `; ${t.retries} retried, ${t.recovered} recovered` : '') +
        (t.excluded > 0 ? `; ${t.excluded} left out` : '') +
        (t.verdict === 'INCONCLUSIVE' && t.asMeasured === 'FAIL' ? '; missed its mark even on the calls that answered' : ''),
    );
  }
  if (s.vram) out.push('', `VRAM before: ${JSON.stringify(s.vram.before)}`, `VRAM after:  ${JSON.stringify(s.vram.after)}`);
  const result = overallResult(s);
  // A target that missed its mark even on the calls that answered is a miss, INCONCLUSIVE or not.
  const failed = s.targets.filter((t) => t.asMeasured === 'FAIL').length;
  out.push('');
  if (result === 'PASS') out.push('RESULT: PASS');
  else if (result === 'FAIL') out.push(`RESULT: FAIL (${failed} target${failed === 1 ? '' : 's'} missed)`);
  else {
    const groups = s.groups.filter((g) => g.inconclusive).map((g) => g.group);
    // The INCONCLUSIVE targets an untrustworthy group does not explain: either nothing reached
    // them at all (a wiring fault — nothing judged, nothing left out), or too many were left out.
    const own = s.targets.filter((t) => t.verdict === 'INCONCLUSIVE' && !groups.includes(t.group));
    const unreached = own.filter((t) => t.of === 0 && t.excluded === 0).map((t) => t.target);
    const leftOut = own.filter((t) => !(t.of === 0 && t.excluded === 0)).map((t) => t.target);
    const reasons = [
      ...(groups.length > 0 ? [`too many failed calls in: ${groups.join(', ')}`] : []),
      ...(leftOut.length > 0 ? [`too many left out of: ${leftOut.join('; ')}`] : []),
      ...(unreached.length > 0 ? [`nothing reached: ${unreached.join('; ')}`] : []),
    ];
    out.push(`RESULT: INCONCLUSIVE (${reasons.join(' — ')})${failed > 0 ? ` — and ${failed} target${failed === 1 ? '' : 's'} missed` : ''}`);
  }
  out.push(
    `Exit status: ${EXIT.pass} pass · ${EXIT.fail} a target failed · ${EXIT.inconclusive} inconclusive (re-run first; it wins over a fail) · ` +
      `${EXIT.badInput} unusable arguments or inputs · ${EXIT.crashed} the run crashed`,
  );
  return out.join('\n');
}

/** Non-zero on any FAIL (1) or any INCONCLUSIVE group (3), so the script can be the merge gate. */
export function exitCode(s: EvalSummary): number {
  const result = overallResult(s);
  return result === 'INCONCLUSIVE' ? EXIT.inconclusive : result === 'FAIL' ? EXIT.fail : EXIT.pass;
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
