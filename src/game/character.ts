// Character foundation for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports in this module.
//  - Deterministic seeded RNG: the fresh-character derivations below are fully
//    deterministic (no dice roll — startGame does not roll), so no Math.random /
//    Date.now appears here. Level-up HP rolling (a die roll) lands in M8.
//  - Serializable plain-data state: `Character` is a flat interface of primitives
//    and plain nested records — no classes, no methods — so it round-trips
//    unchanged through JSON.parse(JSON.stringify(c)).
//
// Ported from the canonical Java (`Character.setMods`, `GameLogic.startGame`,
// `Dice.java`). Java modeled stats as an `int[6]` with bare indices; we deviate to
// a named `Stats` record keyed by `Stat` so callers never touch numeric indices and
// the serialized state is self-describing.

/** The six attribute keys, in the canonical Java order (Stats[0..5]). */
export const Stat = {
  STR: 'STR',
  DEX: 'DEX',
  CON: 'CON',
  INT: 'INT',
  WIS: 'WIS',
  CHA: 'CHA',
} as const;

export type StatKey = (typeof Stat)[keyof typeof Stat];

/** Attribute scores, one per stat key. */
export type Stats = Record<StatKey, number>;

/** Derived attribute modifiers, one per stat key. */
export type StatMods = Record<StatKey, number>;

/** A dice specification, e.g. Enforcer 1d10 = { quantity: 1, sides: 10 }. */
export interface HitDie {
  quantity: number;
  sides: number;
}

/**
 * A character — player or enemy — as plain serializable data. Every field is a
 * primitive or a plain record, so JSON round-trips it unchanged.
 */
export interface Character {
  name: string;
  stats: Stats;
  mods: StatMods;
  hp: number;
  maxHp: number;
  xp: number;
  armorClass: number;
  skillCharges: number;
  maxSkillCharges: number;
  hitDie: HitDie;
}

/** Stat keys in canonical Java order — iterate this to preserve index semantics. */
export const STAT_KEYS: readonly StatKey[] = [
  Stat.STR,
  Stat.DEX,
  Stat.CON,
  Stat.INT,
  Stat.WIS,
  Stat.CHA,
];

/**
 * Single-stat modifier (Java `Character.setMods`):
 *   mod = (stat > 30) ? 10 : 10 - ceil(|stat - 30| / 2).
 * Scores above 30 model Faults/Conditions and cap the modifier at 10.
 */
export function computeStatMod(stat: number): number {
  if (stat > 30) return 10;
  const diff = Math.abs(stat - 30);
  return 10 - Math.ceil(diff / 2);
}

/** Map `computeStatMod` over all six stats, preserving keys. */
export function computeStatMods(stats: Stats): StatMods {
  return {
    STR: computeStatMod(stats.STR),
    DEX: computeStatMod(stats.DEX),
    CON: computeStatMod(stats.CON),
    INT: computeStatMod(stats.INT),
    WIS: computeStatMod(stats.WIS),
    CHA: computeStatMod(stats.CHA),
  };
}

/** Fresh-character armor class (Java `GameLogic.startGame`): 10 + conMod. */
export function deriveArmorClass(conMod: number): number {
  return 10 + conMod;
}

/** Fresh-character max HP (Java `GameLogic.startGame`): hitDie.sides + conMod. */
export function deriveMaxHp(hitDieSides: number, conMod: number): number {
  return hitDieSides + conMod;
}

/**
 * Mechanical, policy-free assembler for a fresh character. It computes mods from
 * the given stats, derives maxHp/AC via the fresh-character formulas, sets hp to
 * maxHp and skillCharges to maxSkillCharges. It rolls nothing and bakes in no
 * class/name policy — callers (M3 player, M4 enemy) supply stats, hitDie, and
 * charges.
 */
export function createCharacter(args: {
  name: string;
  stats: Stats;
  hitDie: HitDie;
  maxSkillCharges: number;
  xp?: number;
}): Character {
  const mods = computeStatMods(args.stats);
  const maxHp = deriveMaxHp(args.hitDie.sides, mods.CON);
  const armorClass = deriveArmorClass(mods.CON);
  return {
    name: args.name,
    stats: args.stats,
    mods,
    hp: maxHp,
    maxHp,
    xp: args.xp ?? 0,
    armorClass,
    skillCharges: args.maxSkillCharges,
    maxSkillCharges: args.maxSkillCharges,
    hitDie: args.hitDie,
  };
}
