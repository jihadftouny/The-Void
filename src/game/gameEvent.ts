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
import type { Stats } from './character.ts';
import type { PlayerClass } from './player.ts';
import type { Rarity } from './weapon.ts';
import type { Pool } from './deal.ts';
import type { BossId } from './boss.ts';

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
  // ---- M7 sacrifice-deal encounter (replaces the gold shop) ----
  | { kind: 'deal-offer'; pool: Pool; cost: string; reward: string; text?: string }
  | { kind: 'deal-taken'; cost: string; reward: string; text?: string }
  | { kind: 'deal-unaffordable'; cost: string; text?: string }
  | { kind: 'deal-declined'; text?: string }
  // ---- M7 chest/cache encounter ----
  | { kind: 'chest-found'; text?: string }
  | {
      kind: 'chest-loot';
      loot: readonly { defId: string; name: string; rarity: Rarity }[];
      text?: string;
    }
  | { kind: 'act-outro'; act: number; header: string; body: string; text?: string }
  // ---- M9 frequent level-up draft ----
  | { kind: 'level-up'; newLevel: number; hpRoll: number; newMaxHp: number; text?: string }
  | { kind: 'draft-offer'; options: readonly string[]; text?: string }
  | { kind: 'draft-picked'; option: string; text?: string }
  | { kind: 'act-intro'; act: number; header: string; body: string; text?: string }
  | { kind: 'final-battle-begins'; enemyName: string; text?: string }
  // ---- M12 boss encounter + the verdict gate + the two endings ----
  /** A floor boss appears (acts 1/2/3/5). Carries only the boss id + its display name. */
  | { kind: 'boss-encounter'; bossId: BossId; enemyName: string; text?: string }
  /**
   * The act-4 reckoning result. Carries ONLY the outcome (grace/cast-down) + optional
   * placeholder prose — NEVER a karma axis value/number (karma stays hidden).
   */
  | { kind: 'verdict'; outcome: 'grace' | 'cast-down'; text?: string }
  | { kind: 'ending'; endingType: 'grace' | 'damnation'; header: string; body: string; text?: string }
  | { kind: 'game-over'; xp: number; text?: string }
  // ---- PLAN.md #2: rest as a found place, the warped kit, and the full-pack bargain ----
  /**
   * A rest spot, found on the descent and taken at once (GAME-DESIGN.md §22.26). `place` is the
   * floor's placeholder place line from `restBriefs.json`; `briefId` names the brief the
   * narrator's scene block is built from. Always followed by `rest-taken` in the same step.
   */
  | { kind: 'rest-found'; floor: number; place: string; briefId: string; text?: string }
  /** Floor 5: every owned skill took on a corrupted form (`count` of them) on arrival. */
  | { kind: 'skills-warped'; count: number; text?: string }
  /**
   * A bargain was accepted with a FULL backpack and an item reward (plan Appendix A.3): the pack
   * opens so the player can leave something behind. Nothing has been paid yet.
   */
  | { kind: 'deal-needs-room'; reward: string; text?: string }
  /** An item was left behind to make room for a bargain's reward (A.3). */
  | { kind: 'item-discarded'; name: string; rarity: Rarity; text?: string };

/** The full game event stream: combat events plus narrative events. */
export type GameEvent = CombatEvent | NarrativeEvent;

/** Every game event `kind` string (handy for exhaustiveness / test assertions). */
export type GameEventKind = GameEvent['kind'];
