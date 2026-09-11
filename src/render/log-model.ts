// The COMBAT LOG's pure half — PURE, Kaplay-free, DOM-free (G18).
//
// WHY THIS EXISTS. The player currently sees NO NUMBERS AT ALL. `formatEvent` and
// `formatRollDetail` are both complete, both tested, and both were dead code: nothing in
// `src/desktop/game.ts` ever called either one, and the narrator is forbidden by
// `VOID_PERSONA` from mentioning "mechanics, dice, or numbers". So a battle happened, HP
// changed, and the only account of it was prose that is contractually barred from saying how
// much. No damage number, no die, no hit, no miss, no crit, ever.
//
// `docs/UI-DESIGN.md` §3 [DECIDED] describes what should be there: "plain by default,
// expandable to full dice… the log persists for the whole battle and scrolls." That is two
// jobs — decide WHAT to show, and build the elements — and only the first is worth testing.
// This module is the first; `components.ts`'s `appendLogLine` is the second.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no DOM, no Kaplay. It reads engine TYPES and calls the two
//    pure formatters. Unit-tested headlessly under `node`.
//  - It FORMATS, it never decides a rule. Every number it shows was computed by the engine
//    and carried on the event.

import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import { formatEvent, formatRollDetail } from './format.ts';

/** Where a beat is reported: the mechanical log, or the Void's narration pane. */
export type LogRoute = 'log' | 'pane';

/** One line of the combat log. */
export interface LogLine {
  /** The plain one-line story of the beat. Never empty. */
  text: string;
  /** The dice behind it, when the beat was decided by a roll. Rendered as an expander. */
  detail?: string;
}

/**
 * WHICH BEATS THE LOG OWNS, and which belong to the narration pane.
 *
 * THE RULE: **the log is the BATTLE log.** Everything that happens inside a fight is a
 * mechanical fact with a number behind it, and that is what the player was never shown.
 * Everything outside a fight — the descent's own story, the altar, the cache, the endings —
 * belongs to the Void's prose and to the HUD, which already report it.
 *
 * That rule lands on the `CombatEvent` / `NarrativeEvent` split, and it is fair to ask why
 * the map exists if the answer is "the union it came from". Three reasons: there is no
 * runtime way to ask which half a kind came from; the map is the REVIEWABLE record of the
 * decision, so `rest-taken` being in the pane is a choice somebody made rather than an
 * accident of file layout; and it is `Record<GameEventKind, LogRoute>`, so a 64th kind FAILS
 * THE BUILD here and must be classified deliberately instead of silently vanishing.
 *
 * A REJECTED INPUT IS LOGGED, deliberately (`cast-unavailable`, `potion-unavailable`,
 * `potion-blocked`, `spare-unavailable`, `consumable-unavailable`). `src/llm/narrate.ts`
 * SILENCES all five for the narrator, and rightly — nothing happened, so the prose should not
 * change. But the player pressed a button and got nothing, and the log is the only place left
 * that can tell them why. The two classifications differ here on purpose.
 */
export const LOG_ROUTING: Record<GameEventKind, LogRoute> = {
  // ---- the battle log: every combat event (37) ----
  'enemy-skill-used': 'log',
  'skill-cast': 'log',
  'cast-unavailable': 'log',
  attack: 'log',
  advantage: 'log',
  disadvantage: 'log',
  'player-unable-to-act': 'log',
  'condition-onset': 'log',
  'condition-damage': 'log',
  'condition-heal': 'log',
  'condition-skip': 'log',
  'condition-applied': 'log',
  'condition-expired': 'log',
  'resource-changed': 'log',
  'self-sacrifice': 'log',
  lifesteal: 'log',
  detonate: 'log',
  'potion-drunk': 'log',
  'potion-unavailable': 'log',
  'potion-blocked': 'log',
  fled: 'log',
  'escape-failed': 'log',
  'escape-impossible': 'log',
  spared: 'log',
  'spare-unavailable': 'log',
  victory: 'log',
  defeat: 'log',
  'relic-triggered': 'log',
  'consumable-used': 'log',
  'consumable-unavailable': 'log',
  'shield-gained': 'log',
  'shield-absorbed': 'log',
  revive: 'log',
  'stat-stolen': 'log',
  'boss-summon': 'log',
  'boss-minion-damage': 'log',
  'boss-adapt': 'log',
  // PLAN.md #2 — inside a fight, so the battle log's (the log is the BATTLE log, rule above).
  // `illusion-dispelled` ends the fight the way `victory` and `spared` do, and like them it is
  // logged: it carries the one roll of the illusion mechanic the player is allowed to see.
  'floor-drain': 'log',
  'illusion-struck': 'log',
  'illusion-dispelled': 'log',
  // A victory drop OR a chest item the full pack could not take. Pane, not log: the chest path
  // happens outside any fight, and the victory line already reports what WAS taken.
  'loot-left-behind': 'pane',
  // ---- the narration pane: every narrative event (26) ----
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
  // PLAN.md #2 — outside any fight: the found rest, the warped kit, the full-pack bargain.
  'rest-found': 'pane',
  'skills-warped': 'pane',
  'deal-needs-room': 'pane',
  'item-discarded': 'pane',
};

/**
 * The log lines a step's events produce, in order — PURE. Pane-routed beats yield nothing.
 *
 * An `attack` also carries its DICE as `detail`: the d20, the modifier, the AC it was
 * measured against, and the damage broken into the terms that produced it. That is the whole
 * `AttackRollDetail` pipeline the engine has been filling in and nothing has ever read.
 * `formatRollDetail` re-derives none of it — every number is read off the event.
 */
export function logLines(events: readonly GameEvent[]): LogLine[] {
  const out: LogLine[] = [];
  for (const event of events) {
    if (LOG_ROUTING[event.kind] !== 'log') continue;
    const line: LogLine = { text: formatEvent(event) };
    if (event.kind === 'attack') line.detail = formatRollDetail(event);
    out.push(line);
  }
  return out;
}

/**
 * The three events that OPEN a battle — the boundary the log resets on, so each fight gets a
 * clean record instead of an ever-growing scroll (UI-DESIGN.md §3: "the log persists for the
 * whole battle"). Cross-checked against `game.ts`'s emit sites: a random encounter emits
 * `encounter-start`, a floor boss emits `boss-encounter`, and the act-5 Hollow emits
 * `final-battle-begins`. There is no fourth way into a fight.
 */
const BATTLE_OPENERS = new Set<GameEventKind>([
  'encounter-start',
  'boss-encounter',
  'final-battle-begins',
]);

/** True when this step's events begin a new battle, so the log should start over. */
export function startsNewBattle(events: readonly GameEvent[]): boolean {
  return events.some((event) => BATTLE_OPENERS.has(event.kind));
}

/** Exposed so a test can assert the opener set is exactly those three and nothing else. */
export const BATTLE_OPENER_KINDS: readonly GameEventKind[] = [...BATTLE_OPENERS];
