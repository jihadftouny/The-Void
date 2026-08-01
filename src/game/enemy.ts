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
import { generateEnemyName } from './enemyName.ts';
import { ELEMENTS } from './element.ts';

/** An enemy — a `Character` plus enemy-only fields — as plain serializable data. */
export interface Enemy extends Character {
  /** The enemy's kind (e.g. "Beast"), also its base `name`. */
  type: string;
  /** The procedurally generated display name (or `type` as a fallback). */
  fullName: string;
  /** One resistance value per element, length ELEMENTS.length (7). */
  resistances: number[];
  /** Learned skill ids — [] until M6. */
  skillPool: string[];
  /** Active status conditions — [] until M6. */
  activeConditions: unknown[];
}

const ENEMY_ARMOR_CLASS = 10;
const ENEMY_MAX_SKILL_CHARGES = 2;

/**
 * Generate a deterministic enemy for an Act/type scaled by the player's xp. The
 * rng draw order is fixed (xp, then six stats in STAT_KEYS order, then maxHp,
 * then the name) so a given seed always reproduces the same enemy.
 */
export function generateEnemy(
  args: { act: number; type: string; playerXp: number },
  rng: Rng,
): Enemy {
  const { act, type, playerXp } = args;

  // 1. Enemy xp: 1 + randInt in [0, floor(playerXp/4) + 1].
  const xp = 1 + randInt(rng, Math.floor(playerXp / 4) + 2);

  // 2. Six stats, in canonical order: 13 + floor(xp/4) + randInt(rng, floor(playerXp/4)+1).
  const statFloor = 13 + Math.floor(xp / 4);
  const statSpread = Math.floor(playerXp / 4) + 1;
  const stats = {} as Stats;
  for (const key of STAT_KEYS) {
    stats[key] = statFloor + randInt(rng, statSpread);
  }

  // 3. Max HP (intended dmgCalculator formula), hp = maxHp.
  const maxHp = 30 + Math.floor(playerXp / 3) + randInt(rng, playerXp);
  const hp = maxHp;

  // 4. Procedural name (draws first/middle/last through the same rng).
  const fullName = generateEnemyName(act, type, rng);

  return {
    name: type,
    type,
    fullName,
    stats,
    mods: computeStatMods(stats),
    hp,
    maxHp,
    xp,
    armorClass: ENEMY_ARMOR_CLASS,
    skillCharges: ENEMY_MAX_SKILL_CHARGES,
    maxSkillCharges: ENEMY_MAX_SKILL_CHARGES,
    hitDie: { quantity: 1, sides: 8 }, // vestigial: enemies never roll a hit die
    resistances: ELEMENTS.map(() => 0),
    skillPool: [],
    activeConditions: [],
  };
}
