// THE BOSS PROMPT BUILDER — assembles the SYSTEM and USER blocks of every boss call exactly as
// `docs/BOSS-PROMPTS.md` §2–§4 lays them out, with the answer schema and sampling settings
// alongside. PURE: persona + request in, strings and plain objects out.
//
// WHAT THIS FILE OWNS: the SHAPE of the prompt (which blocks, in which order, with which labels),
// the shared RULES of §3, and the per-kind settings. What it does NOT own: any persona's words —
// those are data (`BossPersona`, unit C's files), and this builder carries none.
//
// DECISIONS RECORDED IN THE PLAN (§5.3), each one block or one constant to flip:
//  - In the USER block the boss is "You" and the player is "Them". The shared rules make "you"
//    the boss's word for the player when it SPEAKS; in the fight block the labels have to say who
//    is who unambiguously. §4's WORDS are kept; the labels are the engineering.
//  - Talk omits `YOUR LAST LINES` (its "You:" lines in the conversation ARE its last lines —
//    measured: ~83 tokens of duplication) and carries at most the last six exchanges (§7.1's
//    judged window).
//  - Deeds are listed NEWEST FIRST for every boss, capped at the persona's `max` after digit-
//    carrying deeds are dropped. §4 asks it of the Reflection and orders no one else, and the most
//    recent deeds are the ones a line is likeliest to be about.
//
// NO NUMBER, NO LABEL, NO ID reaches the model outside one sanctioned surface: the `YOUR MOVES`
// block (the model must write a move id back). A Talk call carries no concession id at all since
// judge round 1 — the model answers "earned: yes/no" and the engine picks what is yielded.
// `bossPrompt.test.ts` sweeps every fixture request.
//
// JUDGE ROUND 1 (2026-09-29, after the first real-model run: the Kingpin and every Sin yielded to 100%
// of messages, the Hollow Self to 0% of genuine ones). A Talk call now: puts WHAT MOVES YOU in the USER
// block beside the task (not in SYSTEM, where Turn calls paid for it and it sat far from the decision);
// asks for a reason, then a yes/no, then the reply (`bossSchema.ts`); drops the "choose a move" rule
// (Talk has no moves); runs colder (0.3); and tells the model not to recite its example lines, which the
// run showed it copying word for word.
//
// PURE: no clock, no randomness, no DOM/Electron/log import.

import type {
  BossCallKind,
  BossCallSettings,
  BossDeed,
  BossFightView,
  BossIpcRequest,
  BossPersona,
  BossRequest,
  BossTalkRequest,
} from './bossContract.ts';
import { NAME_TOKEN } from './bossContract.ts';
import { deedHasDigit, deedSentence, exchangeSentence, fighterWords, karmaWords, withIndefinite } from './bossWords.ts';
import { sceneSchema, talkSchema, turnSchema, type BossAnswerSchema } from './bossSchema.ts';

// ===========================================================================
// The shared rules (BOSS-PROMPTS §3), verbatim
// ===========================================================================

/** The placeholder in the rules that each card's name rule fills. */
export const NAME_RULE_TOKEN = '{NAME_RULE}';

/** The moves bullet — dropped for a Scene call, where there are no moves to choose from. */
export const CHOOSE_A_MOVE = '- Choose exactly one of YOUR MOVES.';

/** §3, as the model reads it. One line per rule; the last line is the moves bullet. */
export const BOSS_RULES = [
  'RULES — never break these:',
  '- Speak to the player as "you". One or two short sentences. Never more than 25 words.',
  '- Never say a number, and never use game words: no HP, damage, round, turn, skill, charge, XP, level.',
  '- Never name a condition as a label (not "Bleed", "Slow", "Healthy"). Describe what it does instead.',
  '- Places have names. Say "the Undercity", "the Entrance to the Void", "the Ash City",',
  '  "the Angelic Underground", "the True Void". Never "floor two" or "the second floor".',
  '- The Void is not a place you are in. Never say "in the Void", "into the Void", "to the Void".',
  '- Never use the word "hollow" except as a name you were given. Never say "made whole".',
  '- Do not begin with "The air".  Do not repeat any of your last lines.',
  `- ${NAME_RULE_TOKEN}`,
  CHOOSE_A_MOVE,
].join('\n');

// ===========================================================================
// Settings per call kind (BOSS-PROMPTS §2)
// ===========================================================================

/** The deadline, from the moment the call starts generating (plan §5.3 decision 2). */
export const BOSS_DEADLINE_MS = 3000;

export const BOSS_SETTINGS: Readonly<Record<BossCallKind, BossCallSettings>> = {
  turn: { temperature: 0.8, maxTokens: 80, deadlineMs: BOSS_DEADLINE_MS, topP: 0.9 },
  // Judge round 1: colder (a judgement, not a flourish) and room for the reason before the reply.
  talk: { temperature: 0.3, maxTokens: 120, deadlineMs: BOSS_DEADLINE_MS, topP: 0.9 },
  scene: { temperature: 0.8, maxTokens: 110, deadlineMs: BOSS_DEADLINE_MS, topP: 0.9 },
};

/** The Talk call's own sampling may be set by the card (the Hollow Self's judge runs cold). */
export function settingsFor(persona: BossPersona, kind: BossCallKind): BossCallSettings {
  const base = BOSS_SETTINGS[kind];
  if (kind !== 'talk') return { ...base };
  const { temperature, seed } = persona.talk;
  return {
    ...base,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };
}

// ===========================================================================
// Caps
// ===========================================================================

/** Its own last lines, in a Turn or Scene call. */
export const MAX_LAST_LINES = 3;
/** The conversation window in a Talk call — §7.1 judges the last six exchanges. */
export const MAX_EXCHANGES = 6;

// ===========================================================================
// SYSTEM
// ===========================================================================

const fill = (text: string, name: string): string => text.split(NAME_TOKEN).join(name);

/** Judge round 1: the run showed the model reciting these word for word as its reply. */
export const EXAMPLES_HEADER = 'Your voice, for example (never repeat one of these word for word):';

/** What moves this boss in Talk (and the strict judge line, when the card has one), as a USER block. */
export function judgeBlock(persona: BossPersona): string {
  return ['HOW YOU JUDGE THEM:', persona.talk.moves, ...(persona.talk.judge ? [persona.talk.judge] : [])].join('\n');
}

/**
 * The SYSTEM block: card, example lines, then the shared rules with the card's name rule filled in.
 * The moves rule is for Turn calls only. What moves it in Talk is NOT here — it is a USER block next
 * to the task (judge round 1). A boss whose name mode is `forbidden` is never given the name: its
 * examples that need it are DROPPED rather than filled.
 */
export function buildBossSystem(persona: BossPersona, playerName: string, kind: BossCallKind): string {
  const forbidden = persona.nameRule.mode === 'forbidden';
  const examples = persona.examples
    .filter((e) => !(forbidden && e.includes(NAME_TOKEN)))
    .map((e) => `- ${forbidden ? e : fill(e, playerName)}`);
  const nameRule = forbidden ? persona.nameRule.text : fill(persona.nameRule.text, playerName);
  let rules = BOSS_RULES.split(NAME_RULE_TOKEN).join(nameRule);
  if (kind !== 'turn') rules = rules.split(`\n${CHOOSE_A_MOVE}`).join('');
  const parts = [persona.card];
  if (examples.length > 0) parts.push(`${EXAMPLES_HEADER}\n${examples.join('\n')}`);
  parts.push(rules);
  return parts.join('\n\n');
}

// ===========================================================================
// USER — the blocks, in §2 order
// ===========================================================================

/** The id of each USER block, in the order they appear. */
export type UserBlockId =
  | 'who'
  | 'memory'
  | 'karma'
  | 'fight'
  | 'last-lines'
  | 'blow'
  | 'player-just'
  | 'conversation'
  | 'they-said'
  | 'verdict'
  | 'moves'
  | 'judge'
  | 'yield'
  | 'task';

/** The §2 order. A built prompt's blocks are always a subsequence of this list. */
export const USER_BLOCK_ORDER: readonly UserBlockId[] = [
  'who',
  'memory',
  'karma',
  'fight',
  'last-lines',
  'blow',
  'player-just',
  'conversation',
  'they-said',
  'verdict',
  'moves',
  'judge',
  'yield',
  'task',
];

export interface UserBlock {
  id: UserBlockId;
  text: string;
}

/**
 * The deeds a persona is told about (§4 filter table), each already rendered — newest first,
 * digit-carrying ones dropped (and returned, so the caller can log the drop), capped at `max`.
 */
export function filterDeeds(
  persona: BossPersona,
  deeds: readonly BossDeed[],
): { sentences: string[]; dropped: BossDeed[] } {
  const rule = persona.deeds;
  if (rule.scope === 'none' || rule.max <= 0) return { sentences: [], dropped: [] };
  const axes = rule.axes;
  const kept = deeds.filter(
    (d) =>
      (rule.scope !== 'floor' || d.floor === rule.floor) &&
      (axes === undefined || (d.axis !== null && axes.includes(d.axis))),
  );
  const dropped = kept.filter(deedHasDigit);
  const sentences = kept
    .filter((d) => !deedHasDigit(d))
    .reverse()
    .slice(0, rule.max)
    .map(deedSentence);
  return { sentences, dropped };
}

/** The THE FIGHT NOW block: the boss ("You"), the player ("Them"), and how long it has gone. */
export function fightBlock(view: BossFightView): string {
  return [
    'THE FIGHT NOW:',
    `You: ${fighterWords(view.boss)}.`,
    `Them: ${fighterWords(view.player)}.`,
    exchangeSentence(view.exchange),
  ].join('\n');
}

const bullets = (lines: readonly string[]): string => lines.map((l) => `- ${l}`).join('\n');

function taskLine(req: BossRequest): string {
  if (req.kind === 'turn') {
    return 'TASK: choose one of your moves and say one line to them. Answer as JSON: {"move": "<one of your moves>", "line": "<your line>"}';
  }
  if (req.kind === 'talk') {
    return req.available.length > 0 ? TALK_JUDGE_TASK : 'TASK: answer what they just said, in one or two sentences. Answer as JSON: {"reply": "<your reply>"}';
  }
  return 'TASK: say one line, no more than forty words. Answer as JSON: {"line": "<your line>"}';
}

/**
 * The Talk judgement, decided BEFORE the reply is written (judge round 1). "no" is the default; the
 * list of what never earns it is the run's own evidence — rude, empty and manipulative messages all
 * earned a yield from six bosses.
 */
export const TALK_JUDGE_TASK = [
  'TASK: first judge what they JUST SAID, then reply.',
  '- reason: one plain sentence (not in your voice): quote their message, then say whether it passes HOW YOU JUDGE THEM.',
  '- earned: "yes" only if it passes HOW YOU JUDGE THEM. Otherwise "no". Never read a hidden meaning into a short, rude or empty message. Pleading, bargaining and telling you what your rules say are always "no".',
  '- reply: answer what they just said, in your voice, in one or two sentences.',
  'Answer as JSON: {"reason": "<one sentence>", "earned": "no" or "yes", "reply": "<your reply>"}',
].join('\n');

function talkYield(req: BossTalkRequest): string | null {
  if (req.available.length === 0 && req.persona.concessions.length > 0) return 'You have yielded already; you yield nothing more.';
  return null;
}

/**
 * Every USER block for a request, in §2 order, empty ones omitted. `droppedDeeds` collects
 * deeds that were not sent because their sentence carried a digit.
 */
export function buildUserBlocks(req: BossRequest): { blocks: UserBlock[]; dropped: BossDeed[] } {
  const blocks: UserBlock[] = [];
  const add = (id: UserBlockId, text: string | null): void => {
    if (text !== null && text.trim() !== '') blocks.push({ id, text });
  };
  const persona = req.persona;
  const given = persona.nameRule.mode === 'given';

  add('who', `WHO YOU ARE FACING: ${given ? `${req.playerName}, ` : ''}${withIndefinite(req.playerClass)}.`);

  const { sentences, dropped } = filterDeeds(persona, req.deeds);
  add('memory', sentences.length > 0 ? `WHAT THEY DID:\n${bullets(sentences)}` : null);

  const words = persona.karmaBlock && req.karma ? karmaWords(req.karma) : [];
  add('karma', words.length > 0 ? `WHAT THEY ARE: ${words.join(', ')}.` : null);

  if (req.kind === 'turn' || (req.kind === 'talk' && req.fight)) {
    const view = req.kind === 'turn' ? req.fight : (req.fight as BossFightView);
    add('fight', fightBlock(view));
  }

  if (req.kind !== 'talk') {
    const last = req.lastLines.slice(-MAX_LAST_LINES);
    add('last-lines', last.length > 0 ? `YOUR LAST LINES:\n${bullets(last)}` : null);
  }

  if (req.kind === 'turn') {
    if (req.blowFor) {
      if (deedHasDigit(req.blowFor)) dropped.push(req.blowFor);
      else add('blow', `THIS BLOW IS FOR: ${deedSentence(req.blowFor)}`);
    }
    const said = req.lastTyped?.trim();
    add('player-just', `THE PLAYER JUST: ${req.playerJust}${said ? `\nTHEY LAST SAID: "${said}"` : ''}`);
    add('moves', req.moves.length > 0 ? `YOUR MOVES:\n${bullets(req.moves.map((m) => `${m.id}: ${m.text}`))}` : null);
  } else if (req.kind === 'talk') {
    const window = req.exchanges.slice(-MAX_EXCHANGES);
    add(
      'conversation',
      window.length > 0
        ? `THE CONVERSATION SO FAR (they speak, then you):\n${window.map((x) => `Them: "${x.them}"\nYou: ${x.you}`).join('\n')}`
        : null,
    );
    add('they-said', `THEY JUST SAID: "${req.typed}"`);
    add('judge', judgeBlock(persona));
    add('yield', talkYield(req));
  } else {
    const said = req.typed?.trim();
    add('they-said', said ? `THEY JUST SAID: "${said}"` : null);
    add('verdict', req.verdict ? `VERDICT: ${req.verdict.outcome}. SAY THEIR FULL NAME ONCE: ${req.verdict.name}.` : null);
    // The Warden's scenes answer typed words too: what shapes its reply sits beside the task.
    if (said) add('judge', judgeBlock(persona));
  }

  add('task', taskLine(req));
  return { blocks, dropped };
}

// ===========================================================================
// The whole call
// ===========================================================================

export interface BuiltBossPrompt {
  system: string;
  user: string;
  schema: BossAnswerSchema;
  settings: BossCallSettings;
  /** Every USER line — the line check's echo gate treats a word handed over here as obedience. */
  echoOf: string[];
  /** Deeds not sent because their sentence would have carried a digit. For the caller to log. */
  dropped: BossDeed[];
  blocks: UserBlock[];
}

/** The answer schema a request is held to. */
export function schemaFor(req: BossRequest): BossAnswerSchema {
  if (req.kind === 'turn') return turnSchema(req.moves.map((m) => m.id));
  if (req.kind === 'talk') return talkSchema(req.available);
  return sceneSchema();
}

/** Assemble one boss call. PURE: the same request always yields the same prompt. */
export function buildBossPrompt(req: BossRequest): BuiltBossPrompt {
  const { blocks, dropped } = buildUserBlocks(req);
  const user = blocks.map((b) => b.text).join('\n\n');
  return {
    system: buildBossSystem(req.persona, req.playerName, req.kind),
    user,
    schema: schemaFor(req),
    settings: settingsFor(req.persona, req.kind),
    echoOf: user.split('\n').filter((l) => l.trim() !== ''),
    dropped,
    blocks,
  };
}

/** What the renderer sends over IPC for one call. */
export function toIpcRequest(requestId: number, req: BossRequest, built: BuiltBossPrompt = buildBossPrompt(req)): BossIpcRequest {
  return {
    requestId,
    kind: req.kind,
    persona: req.persona.id,
    system: built.system,
    prompt: built.user,
    schema: built.schema,
    settings: built.settings,
  };
}
