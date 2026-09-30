// THE BOSS CONTRACT — the plain-data shapes every boss call is built from and answered in
// (PLAN.md #11 part B, `docs/BOSS-PROMPTS.md`). Pure types plus one validator.
//
// WHO USES THIS FILE:
//  - `bossWords.ts`, `bossSchema.ts`, `bossPrompt.ts`, `bossAnswer.ts` (this unit) build prompts
//    from these shapes and parse answers into them.
//  - The renderer (unit C) fills a request from the engine's state and sends the built request
//    over IPC; the Electron main process (this unit) only compiles and generates.
//  - The engine (unit A) does NOT import this module — `src/llm` already imports `src/game`, so
//    the reverse would be a cycle in the layering. The engine defines its own deed/move types and
//    unit C asserts they are ASSIGNABLE to the ones below (a one-line type test).
//
// LOAD-BEARING PRINCIPLES honoured here:
//  - Pure: no DOM, no Electron, no `../render`, `../desktop` or `../log` import, no clock and no
//    unseeded randomness. Types from `src/game` are imported as TYPES only (erased at build).
//  - Serializable: every shape is plain data that round-trips through JSON — a persona is a data
//    object loaded from a JSON file (unit C), which is why `validatePersona` exists.
//  - Engine-authoritative: the model chooses among ids the ENGINE listed (moves, concessions);
//    nothing here carries a number the model may write back.

import type { ConditionType } from '../game/condition.ts';
import type { KarmaState } from '../game/karma.ts';
import type { KarmaAxis } from '../game/boss.ts';
import { TONE_AXES } from './tone.ts';

// ===========================================================================
// Ids
// ===========================================================================

/** The ten boss voices of BOSS-PROMPTS §5. */
export const BOSS_PERSONA_IDS = [
  'kingpin',
  'reflection',
  'sin-desecration',
  'sin-cruelty',
  'sin-avarice',
  'sin-delusion',
  'sin-grief',
  'warden',
  'executioner',
  'hollow',
] as const;
export type BossPersonaId = (typeof BOSS_PERSONA_IDS)[number];

/** The three call kinds of BOSS-PROMPTS §2. */
export const BOSS_CALL_KINDS = ['turn', 'talk', 'scene'] as const;
export type BossCallKind = (typeof BOSS_CALL_KINDS)[number];

/** What a boss may yield in a Talk call (GAME-DESIGN §22.31). */
export const CONCESSION_IDS = ['pause', 'weakness', 'drop_mechanic', 'surrender'] as const;
export type ConcessionId = (typeof CONCESSION_IDS)[number];

/**
 * How a card treats the player's name (BOSS-PROMPTS §3 `{NAME_RULE}`):
 *  - `given`     — the boss may call them by it (Kingpin, the Sins);
 *  - `own`       — the name is the BOSS's; it says it only of itself (Reflection, Hollow Self);
 *  - `forbidden` — the boss is never told it (the Warden until the verdict, the executioner).
 */
export const NAME_MODES = ['given', 'own', 'forbidden'] as const;
export type NameMode = (typeof NAME_MODES)[number];

/** The kinds of deed the engine records (§22.31 D3) and the prompt renders as sentences. */
export const DEED_KINDS = [
  'spared',
  'killed',
  'bargain',
  'illusion-seen',
  'boss-felled',
  'boss-yielded',
] as const;
export type DeedKind = (typeof DEED_KINDS)[number];

/** The four karma-shifting altar costs a bargain deed can record. */
export const BARGAIN_POOLS = ['offering', 'desecration', 'greed', 'whisper'] as const;
export type BargainPool = (typeof BARGAIN_POOLS)[number];

/** A floor, as the engine numbers it. Rendered as a place NAME, never as this number. */
export type FloorNumber = 1 | 2 | 3 | 4 | 5;

// ===========================================================================
// The persona — DATA (unit C writes the real ones; the test fixtures transcribe the drafts)
// ===========================================================================

export interface BossPersona {
  id: BossPersonaId;
  /** Display name, e.g. "The Kingpin". Never sent to the model by the builders. */
  name: string;
  /** Who it is and how it speaks (§5). Must not contain `{name}`. */
  card: string;
  /** The `{NAME_RULE}` line; `text` may contain `{name}` unless `mode` is `forbidden`. */
  nameRule: { mode: NameMode; text: string };
  /** Example lines in its voice. May contain `{name}`; in `forbidden` mode those are dropped. */
  examples: readonly string[];
  /**
   * What moves it in Talk (`moves`), the strict judge instruction when there is one (`judge`),
   * and the Talk call's own sampling (`temperature`, `seed`) — the Hollow Self's judge runs cold
   * and pinned so re-pasting a message cannot re-roll the verdict (§7.1).
   */
  talk: { moves: string; judge?: string; temperature?: number; seed?: number };
  /** Lines used when the model is off, slow or wrong (§6). Must not need `{name}`. */
  fallbackLines: readonly string[];
  /** Which deeds it is told about (§4 filter table). */
  deeds: {
    scope: 'all' | 'floor' | 'none';
    floor?: FloorNumber;
    axes?: readonly KarmaAxis[];
    max: number;
  };
  /** Whether it is given the manner words of the karma ledger (Warden, Hollow Self). */
  karmaBlock: boolean;
  /** What this boss can EVER yield. The executioner: none, and its Talk schema has no field. */
  concessions: readonly ConcessionId[];
}

// ===========================================================================
// The engine's facts, as the prompt needs them
// ===========================================================================

/**
 * One thing the player did, as the engine recorded it (§22.31 D3). Field names are chosen so the
 * engine's own deed record is assignable to this with no adapter.
 */
export interface BossDeed {
  kind: DeedKind;
  /** Rendered as a place NAME ("the Undercity"), never as a number. */
  floor: FloorNumber;
  /** The karma axis the deed moved, for the Sin filters; null when it moved none. */
  axis: KarmaAxis | null;
  /** Enemy or boss display name (spared, killed, boss-felled, boss-yielded). */
  name?: string;
  /** Which altar cost (bargain). */
  pool?: BargainPool;
  /** Plain words, e.g. "your patience" / "a ring". A digit anywhere gets the deed DROPPED. */
  paid?: string;
  got?: string;
}

/** One legal move: the id the grammar enumerates, and a plain description for the model. */
export interface BossMove {
  id: string;
  text: string;
}

export interface FighterView {
  hp: number;
  maxHp: number;
  conditions: readonly ConditionType[];
}

/** The fight, as the boss sees it: itself, the player, and how long it has gone on. */
export interface BossFightView {
  boss: FighterView;
  player: FighterView;
  exchange: number;
}

interface BossRequestBase {
  persona: BossPersona;
  playerName: string;
  /** The player's class, as displayed ("Enforcer"). */
  playerClass: string;
  /** The whole deed record, oldest first. The builder filters and caps it per persona. */
  deeds: readonly BossDeed[];
  karma?: KarmaState;
  /** The boss's own previous lines, oldest first. */
  lastLines: readonly string[];
}

export interface BossTurnRequest extends BossRequestBase {
  kind: 'turn';
  fight: BossFightView;
  /** What the player did this round, in plain words ("cast Heavy Strike and hit you hard"). */
  playerJust: string;
  lastTyped?: string;
  moves: readonly BossMove[];
  /** The executioner's deed for this blow (§5.5). */
  blowFor?: BossDeed;
}

export interface BossTalkRequest extends BossRequestBase {
  kind: 'talk';
  /** Absent for the Warden, who does not fight. */
  fight?: BossFightView;
  /** The conversation so far, oldest first: what they said, and what the boss answered. */
  exchanges: readonly { them: string; you: string }[];
  typed: string;
  /**
   * What the boss may still yield this fight, IN THE CARD'S ORDER. `[]` means the call carries no
   * judgement at all. The model never picks among these: it only decides whether the player EARNED a
   * yield, and the engine then takes the first one still available (judge round 1, 2026-09-29).
   */
  available: readonly ConcessionId[];
}

export interface BossSceneRequest extends BossRequestBase {
  kind: 'scene';
  typed?: string;
  /** The Warden's verdict call — the ONE call that is given the name (§5.4). */
  verdict?: { outcome: 'grace'; name: string };
}

export type BossRequest = BossTurnRequest | BossTalkRequest | BossSceneRequest;

// ===========================================================================
// What crosses IPC, and what comes back
// ===========================================================================

export interface BossCallSettings {
  temperature: number;
  maxTokens: number;
  /** Measured from the moment the call starts GENERATING, not from when it was queued. */
  deadlineMs: number;
  seed?: number;
  topP: number;
}

/** What crosses IPC — the pure layer built it; the main process only compiles and generates. */
export interface BossIpcRequest {
  requestId: number;
  kind: BossCallKind;
  persona: BossPersonaId;
  system: string;
  prompt: string;
  schema: unknown;
  settings: BossCallSettings;
}

export type BossIpcResult =
  | {
      ok: true;
      text: string;
      timedOut: false;
      tokens: number;
      promptTokens: number;
      ttftMs: number;
      generateMs: number;
      queuedMs: number;
      grammarMs: number;
    }
  | {
      ok: false;
      reason: 'timeout' | 'no-model' | 'error';
      text?: string;
      message?: string;
      queuedMs?: number;
      generateMs?: number;
    };

export type BossAnswer =
  | { ok: true; kind: 'turn'; move: string; line: string }
  | {
      ok: true;
      kind: 'talk';
      reply: string;
      /** `available[0]` when the model judged it earned AND not demanded; `'none'` otherwise, or with nothing to yield. */
      concession: ConcessionId | 'none';
      /** The model's one-line reason for its judgement — for the log and the evaluation, never shown. */
      reason?: string;
      /** Whether the model read their message as telling or begging the boss to yield (which never earns it). */
      demanded?: boolean;
    }
  | { ok: true; kind: 'scene'; line: string }
  | {
      ok: false;
      reason: 'timeout' | 'no-model' | 'error' | 'malformed' | 'illegal-move' | 'illegal-concession';
      detail?: string;
    };

// ===========================================================================
// validatePersona — a JSON-loaded persona is checked, never trusted
// ===========================================================================

/** The placeholder a card fills with the player's name. */
export const NAME_TOKEN = '{name}';

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isString = (x: unknown): x is string => typeof x === 'string';

const isStringList = (x: unknown): x is readonly string[] =>
  Array.isArray(x) && x.every(isString);

const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (list as readonly string[]).includes(x);

const optionalNumber = (x: unknown): boolean =>
  x === undefined || (typeof x === 'number' && Number.isFinite(x));

/**
 * Why a persona is not usable, or `null` when it is. PURE. The reasons are for a test failure or
 * a boot log line — they name the field, so a broken data file points at itself.
 */
export function personaProblem(x: unknown): string | null {
  if (!isObject(x)) return 'not an object';
  if (!oneOf(BOSS_PERSONA_IDS, x.id)) return 'id is not a known boss';
  if (!isString(x.name) || x.name.trim() === '') return 'name is missing';
  if (!isString(x.card) || x.card.trim() === '') return 'card is missing';
  if (x.card.includes(NAME_TOKEN)) return 'card must not need the name';

  const rule = x.nameRule;
  if (!isObject(rule)) return 'nameRule is missing';
  if (!oneOf(NAME_MODES, rule.mode)) return 'nameRule.mode is not given/own/forbidden';
  if (!isString(rule.text) || rule.text.trim() === '') return 'nameRule.text is missing';
  // A boss that may not use the name is never GIVEN it — so its rule cannot ask for it.
  if (rule.mode === 'forbidden' && rule.text.includes(NAME_TOKEN)) {
    return 'a forbidden-name rule must not contain the name';
  }

  if (!isStringList(x.examples) || x.examples.length === 0) return 'examples must be a non-empty list of lines';

  const talk = x.talk;
  if (!isObject(talk)) return 'talk is missing';
  if (!isString(talk.moves) || talk.moves.trim() === '') return 'talk.moves is missing';
  if (talk.moves.includes(NAME_TOKEN)) return 'talk.moves must not need the name';
  if (talk.judge !== undefined && (!isString(talk.judge) || talk.judge.includes(NAME_TOKEN))) {
    return 'talk.judge must be text that does not need the name';
  }
  if (!optionalNumber(talk.temperature)) return 'talk.temperature must be a number';
  if (!optionalNumber(talk.seed)) return 'talk.seed must be a number';

  if (!isStringList(x.fallbackLines) || x.fallbackLines.length === 0) {
    return 'fallbackLines must be a non-empty list of lines';
  }
  if (x.fallbackLines.some((l) => l.includes(NAME_TOKEN))) return 'a fallback line must not need the name';

  const deeds = x.deeds;
  if (!isObject(deeds)) return 'deeds is missing';
  if (!oneOf(['all', 'floor', 'none'] as const, deeds.scope)) return 'deeds.scope is not all/floor/none';
  if (deeds.scope === 'floor' && !(Number.isInteger(deeds.floor) && (deeds.floor as number) >= 1 && (deeds.floor as number) <= 5)) {
    return 'deeds.floor must be a floor when scope is floor';
  }
  if (deeds.axes !== undefined && !(Array.isArray(deeds.axes) && deeds.axes.every((a) => oneOf(TONE_AXES, a)))) {
    return 'deeds.axes must list karma axes';
  }
  if (!(Number.isInteger(deeds.max) && (deeds.max as number) >= 0)) return 'deeds.max must be a whole number';

  if (typeof x.karmaBlock !== 'boolean') return 'karmaBlock must be true or false';
  if (!Array.isArray(x.concessions) || !x.concessions.every((c) => oneOf(CONCESSION_IDS, c))) {
    return 'concessions must list known concession ids';
  }
  // Judge round 1 (2026-09-29): a boss that can yield is judged by its one-line yes/no test. Without it the
  // first real-model run had the Kingpin and every Sin yielding to 100% of messages — so it is required.
  if (x.concessions.length > 0 && (!isString(talk.judge) || talk.judge.trim() === '')) {
    return 'talk.judge (the yes/no test) is required for a boss that can yield';
  }
  return null;
}

/** True when a JSON-loaded object is a usable persona. PURE. */
export function validatePersona(x: unknown): x is BossPersona {
  return personaProblem(x) === null;
}
