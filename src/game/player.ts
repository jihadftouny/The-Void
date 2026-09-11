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
import { type SkillUpgrade } from './skill.ts';
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
  pots: number;
  proficiency: number;
  advantageDisadvantage: number;
  /** Tibia-style paperdoll + backpack — the authoritative equipped-gear store (M5). */
  inventory: Inventory;
  /** One resistance value per element, length ELEMENTS.length (7). */
  resistances: number[];
  /** Active status conditions (M6). */
  activeConditions: ActiveCondition[];
  /**
   * Learned skill ids. M9 lean start: a new player begins with only its class's 1–2
   * `coreSkills` (not the full kit); the rest of the kit is drafted at level-up.
   */
  skillPool: string[];
  /**
   * Player level (M9). Starts at 1 and increments once per drained level-up. Plain data;
   * drives the XP curve (`progression.ts`) and the frequency of level-up drafts.
   */
  level: number;
  /**
   * Owned universal-perk ids (M9 draft). REPEATABLE — an id may appear more than once and
   * stacks (e.g. two `sharpEdge` = +2 damage). Wired perks are folded into the combat
   * modifier seams via `perks.ts` `perkModifiers`. Plain data; empty for a fresh/off run.
   */
  perks: string[];
  /**
   * Per-skill accumulated upgrades (M9 draft), keyed by skill id. Merged into the cast
   * skill by `resolveSkill`; absent key ⇒ the base skill (off-equivalence). Plain data.
   */
  skillUpgrades: Record<string, SkillUpgrade>;
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
  /**
   * PLAN.md #2, floor 5: skill id -> corruption template id (`corruptions.json`), rolled ONCE per
   * owned skill on arrival at the True Void from the run's own RNG, and read by `resolveSkill`.
   * OPTIONAL and additive: absent before floor 5 (JSON drops it), so no save before floor 5
   * changes shape. Skills drafted AFTER arrival are not in it (the ruling says "on arrival").
   */
  corruptedSkills?: Record<string, string>;
}

/** Fixed game-start scalars (Java `GameLogic.startGame` / `Player` init). PLAN.md #2 deleted
 *  the starting rest count with the banked counter: rests are found on the descent (§22.26). */
/**
 * M15 BALANCE: starting healing potions, 2 → 6. Each potion is a full heal (battle.ts), so
 * this is the cleanest early-survivability lever. The sim is a no-equipment LOWER BOUND — a
 * fresh character has only its ≈7–14 base HP and no found/equipped gear, so it needs a deeper
 * heal reserve to survive the un-levelled front of the descent; 6 potions lifts the baseline
 * win-rate into range and pulls Act-1 deaths below 40% of the total. [NEEDS-HUMAN M15: 6 is
 * generous for REAL play (equipment + found potions make the true run easier than the sim) —
 * confirm the "tough-but-fair" feel in a play-test; trim toward 3–4 if real play is too soft.]
 */
const STARTING_POTS = 6;
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
 * `coreSkills` as the `skillPool` (M9 lean start — the rest of the kit is drafted at level-up).
 * `level` starts at 1; `perks`/`skillUpgrades` start empty. Resources start at 0. NOTE (orchestrator resolution):
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
    pots: STARTING_POTS,
    proficiency: PROFICIENCY,
    advantageDisadvantage: 0,
    // Seed the class starting gear into the paperdoll slots (M5): weapon -> mainHand,
    // armor -> armor. No starting shield (unchanged). These slots are now the live combat
    // path, so a fresh character's damage/AC are unchanged from M4 (same starting gear).
    inventory: inventoryWithGear({ mainHand: def.weaponId, armor: def.armorId }),
    resistances: ELEMENTS.map(() => 0),
    activeConditions: [],
    // M9 lean start: only the class's core skills; the rest of `def.kit` is drafted later.
    skillPool: [...def.coreSkills],
    level: 1,
    perks: [],
    skillUpgrades: {},
    momentum: 0,
    corruption: 0,
  };
}
