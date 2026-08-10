// Elite-affix layer for The Void — pure, framework-agnostic game logic (M8).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: the 5 affixes are plain JSON in ../data/enemyAffixes.json.
//    Adding an affix is a data edit; `applyAffix` reads only the data fields.
//  - Deterministic seeded RNG: `rollAffix` threads the injected `Rng` and consumes a
//    FIXED 2 draws (a gate draw, then an affix-index draw) whether or not an affix
//    lands — a stable call count, matching the enemy/loot draw-count discipline.
//  - Serializable plain-data state: an affix is a plain record; `applyAffix` returns a
//    new plain `Enemy` (adds `affixId`), never a class instance.
//
// BALANCE (M15): ELITE_CHANCE and every affix magnitude (statMods, maxHpBonus,
// resistBonus) are placeholders to be tuned in M15.

import enemyAffixesData from '../data/enemyAffixes.json';
import { computeStatMods, type Stats } from './character.ts';
import { randInt, type Rng } from './rng.ts';
import { type Enemy } from './enemy.ts';

/** A stat-modifying elite affix — plain data. */
export interface EnemyAffix {
  id: string;
  /** Prefixed onto the enemy's `fullName` (e.g. "Ancient Feral Rat"). */
  namePrefix: string;
  /** Flat per-stat additions. */
  statMods?: Partial<Stats>;
  /** Flat addition to maxHp (and current hp). */
  maxHpBonus?: number;
  /** Flat addition to EVERY element resistance slot. */
  resistBonus?: number;
  /** Prose note on any deferred/provisional real behavior (M10). */
  behaviorNote: string;
}

/**
 * The chance an encounter enemy is an elite (carries an affix) — an M15 BALANCE
 * placeholder. Single-sourced here so tuning is one edit.
 */
export const ELITE_CHANCE = 0.15;

/** The 5 affixes, in authoring order (the index space `rollAffix` selects from). */
export const AFFIXES = enemyAffixesData as unknown as readonly EnemyAffix[];

/**
 * Roll for an elite affix — PURE, exactly 2 rng draws. Draw 1 is the elite gate
 * (`< ELITE_CHANCE`); draw 2 selects an affix index (`randInt(rng, AFFIXES.length)`).
 * BOTH draws are always consumed so the call count is stable regardless of the outcome;
 * the selected affix is returned only when the gate passes, else `null`.
 */
export function rollAffix(rng: Rng): EnemyAffix | null {
  const gate = rng();
  const index = randInt(rng, AFFIXES.length);
  if (gate < ELITE_CHANCE) return AFFIXES[index] ?? null;
  return null;
}

/**
 * Apply an affix to an enemy — PURE, RNG-free. Returns a NEW enemy: the affix's
 * `statMods` add onto `stats` (then `mods` is recomputed), `maxHpBonus` adds to both
 * `maxHp` and `hp`, `resistBonus` adds to every resistance slot, `namePrefix` prefixes
 * `fullName`, and `affixId` is stamped. The input enemy is never mutated.
 */
export function applyAffix(enemy: Enemy, affix: EnemyAffix): Enemy {
  const stats: Stats = { ...enemy.stats };
  if (affix.statMods) {
    for (const key of Object.keys(affix.statMods) as (keyof Stats)[]) {
      stats[key] = stats[key] + (affix.statMods[key] ?? 0);
    }
  }
  const hpBonus = affix.maxHpBonus ?? 0;
  const resistBonus = affix.resistBonus ?? 0;
  return {
    ...enemy,
    stats,
    mods: computeStatMods(stats),
    maxHp: enemy.maxHp + hpBonus,
    hp: enemy.hp + hpBonus,
    resistances: enemy.resistances.map((r) => r + resistBonus),
    fullName: `${affix.namePrefix} ${enemy.fullName}`,
    affixId: affix.id,
  };
}
