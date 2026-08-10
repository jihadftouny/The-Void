// Enemy generation for The Void — pure, framework-agnostic game logic (M4).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic seeded RNG: every draw (xp, stats, HP, name) flows through the
//    injected `Rng`; no Math.random / Date.now. Generation is reproducible from
//    the rng's seed, and `randInt` always consumes one draw so the call count is
//    stable regardless of `playerXp`.
//  - Data-driven content: the procedural name comes from the M2 enemy-name tables
//    via `generateEnemyName`; only the derivation formulas live here.
//  - Serializable plain-data state: `Enemy` is a flat record of primitives and
//    plain arrays, so it round-trips through JSON unchanged.
//
// Ported from the canonical Java (`Enemy.java`, `Calculator.dmgCalculator`,
// `Character.setMods`). Recorded deviations from Java (see plan):
//  - Stat roll uses the literal Java form
//      13 + floor(xp/4) + randInt(rng, floor(playerXp/4) + 1)
//    (the +xp/4+3 sits OUTSIDE the random term). At playerXp=0 this pins every
//    stat to exactly 13.
//  - maxHp uses the intended `dmgCalculator` formula
//      30 + floor(playerXp/3) + randInt(rng, playerXp)
//    rather than Java's vAlpha 1-HP placeholder (super(type,1,xp)). hp = maxHp.
//    [NEEDS-HUMAN: confirm/tune this scaling — it drives whole-game difficulty.]
//  - Stat mods ARE computed (Java leaves an enemy's StatsMods at 0), for a
//    coherent Character and usable M5 combat.
//  - `hitDie` is a vestigial {1,8}: enemy HP comes from the formula and enemy
//    attacks come from skills (M6), so an enemy never rolls a hit die.

import {
  computeStatMods,
  STAT_KEYS,
  type Character,
  type Stats,
} from './character.ts';
import { randInt, type Rng } from './rng.ts';
import { generateEnemyName, generateFamilyName } from './enemyName.ts';
import { getElement, ELEMENTS } from './element.ts';
import { type ActiveCondition } from './condition.ts';
import { type EnemyFamily } from './enemyFamily.ts';

/** An enemy — a `Character` plus enemy-only fields — as plain serializable data. */
export interface Enemy extends Character {
  /** The enemy's kind (e.g. "Beast"), also its base `name`. */
  type: string;
  /** The procedurally generated display name (or `type` as a fallback). */
  fullName: string;
  /** One resistance value per element, length ELEMENTS.length (7). */
  resistances: number[];
  /** Learned skill ids (M6). Every enemy starts with the test Pyro Ball skill. */
  skillPool: string[];
  /** Active status conditions (M6). */
  activeConditions: ActiveCondition[];
  /**
   * M8: the family this enemy belongs to. For a family-generated enemy this is the
   * family id; for the legacy/boss path (no family) it is the `type`, matching pre-M8.
   */
  familyId: string;
  /** M8: true when killing/sparing this enemy moves the karma vector (⚖ families only). */
  karmaWeighted: boolean;
  /** M8: the applied elite affix id, or absent when the enemy carries no affix. */
  affixId?: string;
}

const ENEMY_ARMOR_CLASS = 10;
const ENEMY_MAX_SKILL_CHARGES = 2;

/**
 * Generate a deterministic enemy scaled by the player's xp. The rng draw order is
 * fixed (xp, then six stats in STAT_KEYS order, then maxHp, then the name) so a given
 * seed always reproduces the same enemy — identical whether or not a `family` is given.
 *
 * With `family` (M8): `familyId`/`karmaWeighted`/`skillPool`/resistances/name/stat-bias
 * come from the family's data theme. Without `family` (legacy + final-boss path): the
 * enemy is byte-compatible with pre-M8 — `familyId = type`, `karmaWeighted = false`, a
 * flat all-zero resistance array, the seeded Pyro Ball skill, and the tag-table name. The
 * family stat-bias and resistances are M15 BALANCE placeholders sourced from the loader.
 */
export function generateEnemy(
  args: { act: number; type?: string; family?: EnemyFamily; playerXp: number },
  rng: Rng,
): Enemy {
  const { act, family, playerXp } = args;
  // The base `type`/name: a family enemy is named for its family; the legacy path keeps
  // the caller-supplied type. `type` and `family` are mutually-exclusive inputs.
  const type = family ? family.id : (args.type ?? 'Beast');
  const statBias = family?.theme.statBias;

  // 1. Enemy xp: 1 + randInt in [0, floor(playerXp/4) + 1].
  const xp = 1 + randInt(rng, Math.floor(playerXp / 4) + 2);

  // 2. Six stats, in canonical order: 13 + floor(xp/4) + randInt(rng, floor(playerXp/4)+1),
  //    plus the family's flat per-stat bias (0 for the legacy path — one draw per stat
  //    either way, so the draw order/count is identical).
  const statFloor = 13 + Math.floor(xp / 4);
  const statSpread = Math.floor(playerXp / 4) + 1;
  const stats = {} as Stats;
  for (const key of STAT_KEYS) {
    stats[key] = statFloor + randInt(rng, statSpread) + (statBias?.[key] ?? 0);
  }

  // 3. Max HP (intended dmgCalculator formula), hp = maxHp.
  const maxHp = 30 + Math.floor(playerXp / 3) + randInt(rng, playerXp);
  const hp = maxHp;

  // 4. Procedural name (draws first/middle/last through the same rng). The family path
  //    resolves through the family-aware table chain; the legacy path is unchanged.
  const fullName = family
    ? generateFamilyName(family, act, rng)
    : generateEnemyName(act, type, rng);

  // Resistances: the legacy path is a flat 7-slot all-zero array; a family with a resist
  // theme seeds exactly one slot (by element index) — no rng draw either way.
  const resistances = ELEMENTS.map(() => 0);
  if (family?.theme.resistElement && family.theme.resistAmount) {
    const idx = getElement(family.theme.resistElement);
    if (idx !== undefined) resistances[idx] = family.theme.resistAmount;
  }

  return {
    name: type,
    type,
    fullName,
    familyId: family ? family.id : type,
    karmaWeighted: family ? family.karmaWeighted : false,
    stats,
    mods: computeStatMods(stats),
    hp,
    maxHp,
    xp,
    armorClass: ENEMY_ARMOR_CLASS,
    skillCharges: ENEMY_MAX_SKILL_CHARGES,
    maxSkillCharges: ENEMY_MAX_SKILL_CHARGES,
    hitDie: { quantity: 1, sides: 8 }, // vestigial: enemies never roll a hit die
    resistances,
    // Java `Enemy` seeds every enemy with SkillEnemy.testFireSkill so it can act; a family
    // may override via `theme.skill` (only 'pyroBall' exists today).
    skillPool: [family?.theme.skill ?? 'pyroBall'],
    activeConditions: [],
  };
}
