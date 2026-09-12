// THE BEAT MODEL — a round's events, grouped into the beats the battle screen replays
// (PLAN.md #6; UI-DESIGN.md §6 "beat-by-beat, auto-advancing").
//
// LOAD-BEARING PRINCIPLES honoured here:
//  - Pure logic / render split: a function over the engine's event list, returning plain data.
//    No DOM, no timer, no logger. Unit-tested under `node`.
//  - Engine-authoritative: every line is `formatEvent` of an engine event, every float is a
//    number the engine put on an event, and the bars are only ever written with engine values
//    (by the sequencer, at the beat this model names). The renderer decides WHEN in the second
//    a thing is shown — never WHAT.
//  - Animation timing never reaches game state: the schedule here is render-layer arithmetic
//    over a count, and nothing in `src/game` ever sees it.
//
// ⚠ ORDER-AGNOSTIC BY CONSTRUCTION. The beats replay the events IN THE ORDER THE ENGINE EMITTED
// THEM and this module never reorders, sorts or re-sides anything. As of 2026-09-12 the engine
// emits the enemy's turn before the player's in a Fight/Cast round (`resolvePlayerTurn`, steps
// 1-4) — that is the engine's CURRENT behaviour, not the design. The design (GAME-DESIGN §14.8,
// confirmed by the author 2026-09-12) is that you strike first, with initiative and Dexterity
// deciding speed, and the §16.1 tempo gauge able to give a side an extra action or cost it a
// turn; the engine change is tracked as FINDINGS G62. Whatever the engine emits, this file does
// not change: `beat-model.test.ts` feeds it rounds in either order, and with any number of
// actions per side, and asserts each replays faithfully.

import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { CombatSubject } from '../game/combatEvent.ts';
import { formatEvent } from './format.ts';
import { hookForEvent, type AudioHookName } from './audio-hooks.ts';

/**
 * What an event is to the replay:
 *  - `anchor` — it IS a beat: a blow, a tick, a cast, an outcome. It closes the beat that has
 *    been gathering and gives it its line.
 *  - `attach` — it rides with the next anchor (an advantage before the strike it helped, the
 *    skill an enemy used before the attack that carried it, a condition taking hold).
 *  - `pane`   — the narration owns it and the arena never shows it. Exactly the kinds the
 *    combat log routes to the pane (`LOG_ROUTING`), which `beat-model.test.ts` cross-checks.
 *
 * EXHAUSTIVE: a new event kind fails the build here until someone decides which it is.
 */
export type BeatRole = 'anchor' | 'attach' | 'pane';

export const BEAT_ROLE: Readonly<Record<GameEventKind, BeatRole>> = {
  // ---- anchors: each one is a beat ----
  attack: 'anchor',
  'skill-cast': 'anchor',
  'condition-damage': 'anchor',
  'condition-heal': 'anchor',
  'condition-skip': 'anchor',
  'player-unable-to-act': 'anchor',
  lifesteal: 'anchor',
  'self-sacrifice': 'anchor',
  'escape-failed': 'anchor',
  'escape-impossible': 'anchor',
  fled: 'anchor',
  spared: 'anchor',
  victory: 'anchor',
  defeat: 'anchor',
  revive: 'anchor',
  'shield-gained': 'anchor',
  'shield-absorbed': 'anchor',
  'stat-stolen': 'anchor',
  'boss-minion-damage': 'anchor',
  'floor-drain': 'anchor',
  'illusion-struck': 'anchor',
  'illusion-dispelled': 'anchor',
  'consumable-used': 'anchor',
  'cast-unavailable': 'anchor',
  'spare-unavailable': 'anchor',
  'consumable-unavailable': 'anchor',
  // ---- attached to the next anchor ----
  'enemy-skill-used': 'attach',
  advantage: 'attach',
  disadvantage: 'attach',
  'condition-onset': 'attach',
  'condition-applied': 'attach',
  'condition-expired': 'attach',
  'resource-changed': 'attach',
  'relic-triggered': 'attach',
  detonate: 'attach',
  'boss-summon': 'attach',
  'boss-adapt': 'attach',
  // ---- the narration's, never the arena's ----
  'loot-left-behind': 'pane',
  title: 'pane',
  intro: 'pane',
  'stats-rolled': 'pane',
  'player-created': 'pane',
  'encounter-start': 'pane',
  'rest-taken': 'pane',
  'deal-offer': 'pane',
  'deal-taken': 'pane',
  'deal-unaffordable': 'pane',
  'deal-declined': 'pane',
  'chest-found': 'pane',
  'chest-loot': 'pane',
  'act-outro': 'pane',
  'level-up': 'pane',
  'draft-offer': 'pane',
  'draft-picked': 'pane',
  'act-intro': 'pane',
  'final-battle-begins': 'pane',
  'boss-encounter': 'pane',
  verdict: 'pane',
  ending: 'pane',
  'game-over': 'pane',
  'rest-found': 'pane',
  'skills-warped': 'pane',
  'deal-needs-room': 'pane',
  'item-discarded': 'pane',
};

/** Which of the frame's three bars a beat may have changed. */
export type BarKey = 'player' | 'enemy' | 'charges';

/** A number floated over a combatant — verbatim from the event, never summed. */
export interface BeatFloat {
  side: CombatSubject;
  text: string;
  /** How it reads: damage, healing, or a word (MISS, FUMBLE, REVIVED). */
  tone: 'harm' | 'heal' | 'plain';
}

/** One beat of a round. Plain data, so the sequencer can be handed it frozen. */
export interface Beat {
  /** Position in the round, from 0. */
  index: number;
  /** Every event the beat carries, in engine order (its attached events, then its anchor). */
  events: readonly GameEvent[];
  /** The event that made it a beat, or `null` for a trailing beat of attached events only. */
  anchor: GameEvent | null;
  /** The ticker line: `formatEvent` of the anchor (or of the last event, when there is none). */
  line: string;
  /** The bars this beat may have moved — when the sequencer writes each engine value. */
  touches: readonly BarKey[];
  hook: AudioHookName | null;
  float: BeatFloat | null;
  /** Whose side took the blow, for the flash (enemy) or the shake (player). */
  struck: CombatSubject | null;
}

/** The other side of a combatant. */
function other(side: CombatSubject): CombatSubject {
  return side === 'player' ? 'enemy' : 'player';
}

/**
 * The bars an event can move. Only events that CHANGE a value touch a bar — a skipped turn
 * or an advantage moves nothing, so naming them would only delay the bar's write.
 *
 * `victory` touches the enemy because a victory is the engine's statement that the enemy's HP
 * reached zero (`damageEnemy` clamps at 0). `spared` and the illusion events touch it too, and
 * write the value the engine left — which for an illusion is its UNCHANGED hp: the bar is
 * written at that beat and does not move, which is exactly what the player should see.
 */
export function touchesOf(event: GameEvent): BarKey[] {
  switch (event.kind) {
    case 'attack':
      return [other(event.subject)];
    case 'skill-cast':
      return ['enemy', 'charges'];
    case 'condition-damage':
    case 'condition-heal':
      return [event.subject];
    case 'lifesteal':
    case 'self-sacrifice':
    case 'escape-failed':
    case 'revive':
    case 'shield-gained':
    case 'shield-absorbed':
    case 'boss-minion-damage':
    case 'defeat':
      return ['player'];
    case 'consumable-used':
      // An item can heal you, restore charges, or hurt the foe; which it did is the engine's.
      return ['player', 'enemy', 'charges'];
    case 'floor-drain':
      return ['charges'];
    case 'victory':
    case 'spared':
    case 'illusion-struck':
    case 'illusion-dispelled':
      return ['enemy'];
    default:
      return [];
  }
}

/**
 * Whose side a beat's anchor STRUCK — the flash goes on the enemy, the shake on the player.
 *
 * CONTACT, NOT HARM (decided in #6's fix round). An attack whose outcome is a hit or a crit
 * connected, so it shows — even when it dealt 0: the ticker says "hit", and a blow that
 * connected but showed nothing would contradict the line under it. Only its NUMBER is withheld
 * (`floatFor` never floats a zero). A skill that dealt 0 is a different thing — a skill that
 * does not strike at all (a guard, a curse) — so it shows no strike, as before.
 */
function struckBy(event: GameEvent): CombatSubject | null {
  switch (event.kind) {
    case 'attack':
      return event.outcome === 'hit' || event.outcome === 'crit' ? other(event.subject) : null;
    case 'skill-cast':
      return event.damage > 0 ? 'enemy' : null;
    case 'condition-damage':
      return event.subject;
    case 'boss-minion-damage':
    case 'escape-failed':
      return 'player';
    default:
      return null;
  }
}

/**
 * A harm or heal number to float, or `null` when there is nothing to show.
 *
 * ⚠ A ZERO IS NEVER FLOATED. The engine truthfully reports a blow that connected for nothing (a
 * 1 on the d6 with a −1 Strength adjustment, clamped to 0) and a failed escape a shield absorbed
 * entirely (the 0 HP actually lost). A "−0" in the damage colour reads as harm that did not
 * happen. The ticker keeps the engine's line either way — it is the truthful record — and the
 * strike still SHOWS where the blow connected (`struckBy` is about contact, not harm).
 */
function amountFloat(side: CombatSubject, amount: number, sign: '−' | '+', tone: 'harm' | 'heal', prefix = ''): BeatFloat | null {
  return amount > 0 ? { side, text: `${prefix}${sign}${amount}`, tone } : null;
}

/**
 * The number floated over a combatant for an anchor, or `null`. VERBATIM engine numbers — the
 * same ones the combat log already prints — never a sum the renderer computed, and never a zero.
 */
export function floatFor(event: GameEvent): BeatFloat | null {
  switch (event.kind) {
    case 'attack': {
      const side = other(event.subject);
      switch (event.outcome) {
        case 'hit':
          return amountFloat(side, event.damage, '−', 'harm');
        case 'crit':
          return amountFloat(side, event.damage, '−', 'harm', 'CRIT ');
        case 'miss':
          return { side, text: 'MISS', tone: 'plain' };
        case 'fumble':
          return { side, text: 'FUMBLE', tone: 'plain' };
      }
      return null;
    }
    case 'skill-cast':
      return amountFloat('enemy', event.damage, '−', 'harm');
    case 'condition-damage':
      return amountFloat(event.subject, event.amount, '−', 'harm');
    case 'condition-heal':
      return amountFloat(event.subject, event.amount, '+', 'heal');
    case 'lifesteal':
      return amountFloat('player', event.amount, '+', 'heal');
    case 'boss-minion-damage':
      return amountFloat('player', event.amount, '−', 'harm');
    case 'escape-failed':
      return amountFloat('player', event.damage, '−', 'harm');
    case 'revive':
      return { side: 'player', text: 'REVIVED', tone: 'heal' };
    default:
      return null;
  }
}

/** Assemble one beat from the events it carries. */
function beatOf(index: number, events: readonly GameEvent[], anchor: GameEvent | null): Beat {
  const lead = anchor ?? (events[events.length - 1] as GameEvent);
  const touches = new Set<BarKey>();
  for (const event of events) for (const key of touchesOf(event)) touches.add(key);
  return {
    index,
    events,
    anchor,
    line: formatEvent(lead),
    touches: [...touches],
    hook: hookForEvent(lead),
    float: anchor ? floatFor(anchor) : null,
    struck: anchor ? struckBy(anchor) : null,
  };
}

/**
 * Group a step's events into beats — PURE, and NEVER REORDERING.
 *
 * Walk the events in order: `pane` kinds are skipped (the narration owns them); `attach` kinds
 * gather into the pending beat; an `anchor` closes the pending beat with itself as its anchor.
 * Anything still gathering at the end becomes a final beat with no anchor, whose line is its
 * last event's. The concatenated `events` of the beats is exactly the input with the pane
 * kinds removed, in the same order — the property the test pins.
 */
export function groupBeats(events: readonly GameEvent[]): Beat[] {
  const beats: Beat[] = [];
  let pending: GameEvent[] = [];
  for (const event of events) {
    const role = BEAT_ROLE[event.kind];
    if (role === 'pane') continue;
    pending.push(event);
    if (role === 'anchor') {
      beats.push(beatOf(beats.length, pending, event));
      pending = [];
    }
  }
  if (pending.length > 0) beats.push(beatOf(beats.length, pending, null));
  return beats;
}

/**
 * The beat at which each bar is written: the LAST beat that touched it, else the last beat.
 * A bar is written exactly once per round, with the engine's final value — so the latest
 * beat that could have moved it is the one moment that value is true.
 */
export function barUpdateAt(beats: readonly Beat[]): Record<BarKey, number> {
  const at: Record<BarKey, number> = {
    player: beats.length - 1,
    enemy: beats.length - 1,
    charges: beats.length - 1,
  };
  for (const key of ['player', 'enemy', 'charges'] as const) {
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      if ((beats[i] as Beat).touches.includes(key)) {
        at[key] = i;
        break;
      }
    }
  }
  return at;
}

// ---------------------------------------------------------------------------------------
// THE TIMING. Four numbers, and the only knobs the author needs to change the feel of a round
// (HUMAN-CHECKS: "does a round read as an exchange?"). Reduced motion does NOT change them —
// UI-DESIGN §13: "beat timing unchanged — the exchange must still read as an exchange".
// ---------------------------------------------------------------------------------------

/** The spacing between beats when there are few of them. */
export const BEAT_MS = 240;
/** How long the last beat stays up before the controls come back. */
export const BEAT_HOLD_MS = 240;
/** The longest a round's replay runs, while its spacing can still shrink to fit. */
export const MAX_ROUND_MS = 1600;
/** The shortest spacing a beat is ever given — below this the lines cannot be read. */
export const MIN_SPACING_MS = 120;

/** When each beat starts, and when the replay is done. Whole milliseconds. */
export interface BeatSchedule {
  at: number[];
  spacing: number;
  done: number;
}

/**
 * The schedule for `count` beats — PURE arithmetic.
 *
 * The spacing is `BEAT_MS` until the round would outrun `MAX_ROUND_MS`; then it shrinks so the
 * last beat's hold still ends by the cap — `(MAX_ROUND_MS − BEAT_HOLD_MS) / (count − 1)`,
 * floored to a whole millisecond — but never below `MIN_SPACING_MS`. Past that (a thirteenth
 * beat) readability wins over the cap and the round runs a little long.
 *
 * DEVIATION, recorded: the plan's worked example "10 beats → spacing 160, done 1600" cannot
 * hold under its own formula (160 × 9 + 240 = 1680). The cap is honoured instead: ten beats
 * are spaced 151ms and done at 1599.
 */
export function beatSchedule(count: number): BeatSchedule {
  if (count <= 0) return { at: [], spacing: 0, done: 0 };
  const fit = count > 1 ? Math.floor((MAX_ROUND_MS - BEAT_HOLD_MS) / (count - 1)) : BEAT_MS;
  const spacing = Math.max(MIN_SPACING_MS, Math.min(BEAT_MS, fit));
  const at = Array.from({ length: count }, (_unused, i) => i * spacing);
  return { at, spacing, done: (at[count - 1] as number) + BEAT_HOLD_MS };
}
