// THE AUDIO HOOKS — every point in a battle where a sound will play, with no sound yet
// (PLAN.md #6; ART-BIBLE.md §10, BLOCKING; UI-DESIGN.md §13's "the hook costs nothing now and
// is a rewrite of the sequencing layer afterwards").
//
// LOAD-BEARING PRINCIPLES honoured here:
//  - Pure logic / render split: a table and one function over the engine's own event types.
//    No DOM, no audio API, no logger. Unit-tested under `node`.
//  - Data-driven: the catalogue of sounds #15 has to source IS the `AUDIO_HOOKS` list, and
//    which beat plays which is a TABLE — adding a sound is a data edit, never a sequencer edit.
//
// HOW #15 USES IT. The sequencer in `src/desktop/battle.ts` calls `AudioSink.play(name, …)` on
// every beat that has a hook. Today the sink `game.ts` constructs only LOGS the call (so every
// hook point is observable in a real run's log file); #15 replaces that one sink with one that
// plays a sound, and nothing in the sequencing changes.

import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { AttackOutcome, CombatSubject } from '../game/combatEvent.ts';

/**
 * Every sound the battle will ever ask for. `item` and `refused` are additions to the plan's
 * thirteen, and both are required by its own rule that EVERY combat anchor maps to a named
 * hook: a consumable being used is not a skill, and a press the engine refuses (no charge, no
 * escape, nothing to use) is not silence — it is the one sound that tells the player why
 * nothing happened.
 */
export const AUDIO_HOOKS = [
  'open',
  'hit',
  'crit',
  'miss',
  'skill',
  'item',
  'tick',
  'ward',
  'fall',
  'victory',
  'flee',
  'spare',
  'dispel',
  'boss',
  'refused',
] as const;
export type AudioHookName = (typeof AUDIO_HOOKS)[number];

/**
 * The hook each event kind plays. EXHAUSTIVE: `Record<GameEventKind, …>`, so a new event kind
 * in the engine fails the build here until someone decides what it sounds like.
 *
 * `attack` is listed as `hit` for the record's sake; its real hook depends on the outcome and
 * is read from `ATTACK_HOOK` below. Narrative events are `null` — the pane, not the arena,
 * owns them — except the three that OPEN a fight, which carry the `open` sting.
 */
export const HOOK_BY_KIND: Readonly<Record<GameEventKind, AudioHookName | null>> = {
  // ---- a blow, a cast, an item ----
  attack: 'hit',
  'skill-cast': 'skill',
  'enemy-skill-used': 'skill',
  lifesteal: 'skill',
  'self-sacrifice': 'skill',
  detonate: null, // folded into the cast's own beat
  'stat-stolen': 'skill',
  'consumable-used': 'item',
  // ---- conditions ----
  'condition-onset': 'tick',
  'condition-damage': 'tick',
  'condition-heal': 'tick',
  'condition-skip': 'tick',
  'player-unable-to-act': 'tick',
  'condition-applied': null, // part of the cast that applied it
  'condition-expired': null,
  'resource-changed': null,
  advantage: null,
  disadvantage: null,
  'relic-triggered': null, // the relic's effect carries its own event
  // ---- defences ----
  'shield-gained': 'ward',
  'shield-absorbed': 'ward',
  revive: 'ward',
  // ---- the ways a fight ends ----
  victory: 'victory',
  defeat: 'fall',
  fled: 'flee',
  'escape-failed': 'flee',
  spared: 'spare',
  'illusion-dispelled': 'dispel',
  // A blow through an illusion sounds like what it is to the player: a blow that met nothing.
  'illusion-struck': 'miss',
  // ---- presses the engine refused ----
  'escape-impossible': 'refused',
  'cast-unavailable': 'refused',
  'spare-unavailable': 'refused',
  'consumable-unavailable': 'refused',
  // ---- bosses and floors ----
  'boss-summon': 'boss',
  'boss-minion-damage': 'boss',
  'boss-adapt': 'boss',
  'floor-drain': 'tick',
  'loot-left-behind': null,
  // ---- the narrative stream: only the openings of a fight make a sound here ----
  'encounter-start': 'open',
  'boss-encounter': 'open',
  'final-battle-begins': 'open',
  title: null,
  intro: null,
  'stats-rolled': null,
  'player-created': null,
  'rest-taken': null,
  'deal-offer': null,
  'deal-taken': null,
  'deal-unaffordable': null,
  'deal-declined': null,
  'chest-found': null,
  'chest-loot': null,
  'act-outro': null,
  'level-up': null,
  'draft-offer': null,
  'draft-picked': null,
  'act-intro': null,
  verdict: null,
  ending: null,
  'game-over': null,
  'rest-found': null,
  'skills-warped': null,
  'deal-needs-room': null,
  'item-discarded': null,
};

/** An attack's sound by outcome — exhaustive over `AttackOutcome`. A fumble is a miss to the ear. */
export const ATTACK_HOOK: Readonly<Record<AttackOutcome, AudioHookName>> = {
  hit: 'hit',
  crit: 'crit',
  miss: 'miss',
  fumble: 'miss',
};

/** The hook an event plays, or `null` when it plays none. PURE. */
export function hookForEvent(event: GameEvent): AudioHookName | null {
  if (event.kind === 'attack') return ATTACK_HOOK[event.outcome];
  return HOOK_BY_KIND[event.kind];
}

/** What a sound is told about the beat that asked for it. Plain data. */
export interface AudioDetail {
  /** Whose side the beat struck, when it struck one. */
  side?: CombatSubject;
  /** The beat's position in the round, from 0. */
  index: number;
}

/**
 * Where the sequencer sends each hook. THE SEAM #15 FILLS: `game.ts` constructs the one sink
 * the game uses; a test passes a recording one. The sequencer never knows which it has.
 */
export interface AudioSink {
  play(name: AudioHookName, detail: AudioDetail): void;
}

/** A sink that plays nothing and records nothing. */
export const SILENT_AUDIO: AudioSink = { play: () => undefined };
