// Player creation for The Void — pure, framework-agnostic game logic (M3).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic seeded RNG: the only randomness (stat rolls) flows through the
//    injected `Rng`; `createPlayer` itself is a pure assembler that rolls nothing.
//  - Data-driven content: starting gear is referenced by id into the M2 weapon/
//    armor tables; only the two class profiles (hit die + gear ids) and the fixed
//    game-start scalars — which are *rules*, not content — live here.
//  - Serializable plain-data state: `Player` is a flat record of primitives and
//    plain arrays; equipment lives in the paperdoll `inventory.slots` as `{ defId }`
//    instances (resolved via the equipment.ts bridge), so state round-trips through JSON.
//
// Ported from the canonical Java (`Player.java`, `GameLogic.startGame`). The
// stat accept/re-roll loop, class-confirm loop, and name-entry prompt are UI
// (built later) — this module only rolls a stat set and assembles the record.

import {
  createCharacter,
  STAT_KEYS,
  type Character,
  type Stats,
} from './character.ts';
import { roll4d6DropLowest, type Rng } from './rng.ts';
import { ELEMENTS } from './element.ts';
import { type ActiveCondition } from './condition.ts';
import { CLASSES, type PlayerClass } from './classKit.ts';
import { type Inventory } from './inventory.ts';
import { inventoryWithGear } from './equipment.ts';

/** The five playable classes (defined with the class roster in `classKit.ts`). */
export type { PlayerClass } from './classKit.ts';

/**
 * A player — a `Character` plus player-only fields — as plain serializable data.
 *
 * EQUIPMENT (M5): the Tibia-style paperdoll `inventory.slots` is the SINGLE SOURCE OF TRUTH
 * for what is equipped. The legacy `equipped*Id` fields were removed here; combat resolves
 * the weapon from `slots.mainHand` (empty ⇒ UNARMED), defense the armor from `slots.armor`
 * and the shield from `slots.offHand`, all via the `equipment.ts` bridge. Old saves migrate
 * their legacy ids into `slots` (save.ts `upgrade2to3`).
 */
export interface Player extends Character {
  classId: PlayerClass;
  restsLeft: number;
  pots: number;
  proficiency: number;
  advantageDisadvantage: number;
  /** Tibia-style paperdoll + backpack — the authoritative equipped-gear store (M5). */
  inventory: Inventory;
  /** One resistance value per element, length ELEMENTS.length (7). */
  resistances: number[];
  /** Active status conditions (M6). */
  activeConditions: ActiveCondition[];
  /** Learned skill ids — a new player starts with its class's signature kit (M3). */
  skillPool: string[];
  /**
   * Enforcer momentum resource (M3). OPTIONAL and additive: absent ⇒ read as 0, so a
   * pre-M3 v2 save without this field loads unchanged. Built by dealing/taking damage in
   * a round (battle hooks), spent by `spendMomentum` skills. Harmless 0 for other classes.
   */
  momentum?: number;
  /**
   * Hollow corruption resource (M3). OPTIONAL and additive (same save story as momentum).
   * Raised by `maxHpCost` sacrifices; read by `corruptionScale` skills. Harmless for others.
   */
  corruption?: number;
  /**
   * Transient combat shield (M6). OPTIONAL and additive: absent ⇒ read as 0. Absorbs enemy
   * damage before HP (Grace-Forged Aegis grants it at battle start via `gainShield`); it is
   * plain data so it round-trips through a mid-battle save, and 0/absent for a normal run.
   */
  shield?: number;
}

/** Fixed game-start scalars (Java `GameLogic.startGame` / `Player` init). */
const STARTING_RESTS = 1;
const STARTING_POTS = 2;
const PROFICIENCY = 2;
const MAX_SKILL_CHARGES = 5;

/**
 * Roll a fresh stat set: `roll4d6DropLowest` once per stat, in canonical
 * STAT_KEYS order (STR, DEX, CON, INT, WIS, CHA). Each value is in [3, 18].
 * The accept/re-roll loop is UI and not performed here.
 */
export function rollStartStats(rng: Rng): Stats {
  const stats = {} as Stats;
  for (const key of STAT_KEYS) {
    stats[key] = roll4d6DropLowest(rng);
  }
  return stats;
}

/**
 * Assemble a fresh `Player` from a name, class, and a rolled stat set. Pure: it
 * rolls nothing. Looks up the `CLASSES` definition, derives the Character base (mods,
 * maxHp = hitDie.sides + CONmod, hp = maxHp, armorClass = 10 + CONmod, charges), then
 * adds the player fields, seeds the class starting gear into the paperdoll, and grants the class's
 * signature kit as the `skillPool`. Resources start at 0. NOTE (orchestrator resolution):
 * stats are rolled UNIFORMLY (4d6-drop-lowest) elsewhere; `CLASSES[].primaryStats` is
 * flavor only, so `createPlayer` applies no class stat-weighting.
 */
export function createPlayer(args: {
  name: string;
  classId: PlayerClass;
  stats: Stats;
}): Player {
  const def = CLASSES[args.classId];
  const base = createCharacter({
    name: args.name,
    stats: args.stats,
    hitDie: def.hitDie,
    maxSkillCharges: MAX_SKILL_CHARGES,
    xp: 0,
  });
  return {
    ...base,
    classId: args.classId,
    restsLeft: STARTING_RESTS,
    pots: STARTING_POTS,
    proficiency: PROFICIENCY,
    advantageDisadvantage: 0,
    // Seed the class starting gear into the paperdoll slots (M5): weapon -> mainHand,
    // armor -> armor. No starting shield (unchanged). These slots are now the live combat
    // path, so a fresh character's damage/AC are unchanged from M4 (same starting gear).
    inventory: inventoryWithGear({ mainHand: def.weaponId, armor: def.armorId }),
    resistances: ELEMENTS.map(() => 0),
    activeConditions: [],
    skillPool: [...def.kit],
    momentum: 0,
    corruption: 0,
  };
}
