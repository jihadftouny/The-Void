// Game event vocabulary for The Void — pure, framework-agnostic game logic (M7/M8).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: the `step` reducer returns an ordered list of these
//    plain-data events instead of printing. The M10 UI reads them and renders; the
//    logic core renders nothing. No Kaplay/DOM/console here.
//  - Serializable plain-data state: every event is a flat record of primitives and
//    plain records — no class instances, no functions — so events round-trip through
//    JSON. `combatEvent.ts` is NOT modified; its `CombatEvent` is unioned in as-is.
//
// The structured `kind` + typed fields are the source of truth for tests; the
// optional `text` on the narrative events is a UI convenience only.

import type { CombatEvent } from './combatEvent.ts';
import type { Stats, StatKey } from './character.ts';
import type { PlayerClass } from './player.ts';

/** The narrative (non-combat) half of the game event stream. */
export type NarrativeEvent =
  | { kind: 'title'; text?: string }
  | { kind: 'intro'; header: string; lines: readonly string[]; text?: string }
  | { kind: 'stats-rolled'; stats: Stats; text?: string }
  | {
      kind: 'player-created';
      name: string;
      classId: PlayerClass;
      maxHp: number;
      armorClass: number;
      text?: string;
    }
  | { kind: 'encounter-start'; enemyName: string; text?: string }
  | { kind: 'rest-lore'; title: string; loreText: string; text?: string }
  | { kind: 'rest-taken'; hpRestored: number; hp: number; maxHp: number; text?: string }
  | { kind: 'rest-full'; text?: string }
  | { kind: 'rest-declined'; text?: string }
  | { kind: 'no-rests'; text?: string }
  | {
      kind: 'shop-offer';
      itemKind: 'armor' | 'weapon';
      itemId: string;
      itemName: string;
      price: number;
      currentId: string;
      currentName: string;
      text?: string;
    }
  | { kind: 'shop-purchased'; itemId: string; price: number; gold: number; text?: string }
  | { kind: 'shop-insufficient'; text?: string }
  | { kind: 'shop-declined'; text?: string }
  | { kind: 'character-info'; text?: string }
  | { kind: 'act-outro'; act: number; header: string; body: string; text?: string }
  | {
      kind: 'level-up';
      picks: readonly [StatKey, StatKey];
      newStats: Stats;
      hpRoll: number;
      newMaxHp: number;
      conModChanged: boolean;
      proficiency: number;
      text?: string;
    }
  | { kind: 'act-intro'; act: number; header: string; body: string; text?: string }
  | { kind: 'final-battle-begins'; enemyName: string; text?: string }
  | { kind: 'ending'; header: string; body: string; text?: string }
  | { kind: 'game-over'; xp: number; text?: string };

/** The full game event stream: combat events plus narrative events. */
export type GameEvent = CombatEvent | NarrativeEvent;

/** Every game event `kind` string (handy for exhaustiveness / test assertions). */
export type GameEventKind = GameEvent['kind'];
