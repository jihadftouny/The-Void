// Enemy-family roster loader for The Void — pure, framework-agnostic game logic (M8).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: the 24-family roster is plain JSON in
//    ../data/enemyFamilies.json. Adding or retheming a family is a data edit — no
//    combat/encounter code changes. Casts the JSON like the existing
//    enemyName.ts / deal.ts loaders.
//  - Deterministic seeded RNG: this module makes NO random decision; it only reads
//    the roster. The seeded family pick lives in encounter.ts.
//  - Serializable plain-data state: every family field is a primitive / plain record.
//
// BALANCE (M15): every `theme` magnitude (statBias, resistAmount) and the per-floor
// family stat themes are placeholders to be tuned in M15. The family list, tags,
// per-floor assignment, and the ⚖ (karma-weighted) flags are the load-bearing content.
//
// KARMA SEAM (M10): each ⚖ family carries an optional `onSpare`/`onKill` KarmaAction
// pair, uniformly set to the mercy↔cruelty pair now (spareWeighted / killWeighted). M10
// differentiates the axes (§7: The Judged spare=reverence/kill=desecration; Sins/Feelings
// heavier cruelty) by EDITING THIS DATA, not the game.ts logic that reads it.

import enemyFamiliesData from '../data/enemyFamilies.json';
import { type Stats } from './character.ts';
import { type KarmaAction } from './karma.ts';

/** A family's light, placeholder combat theme (all magnitudes are M15 placeholders). */
export interface FamilyTheme {
  /** Enemy skill id; defaults to 'pyroBall' (the only enemy skill today). */
  skill?: string;
  /** Element name whose resistance slot is seeded (see element.ts order). */
  resistElement?: string;
  /** The resistance value written into that slot. */
  resistAmount?: number;
  /** Flat per-stat bias folded into the enemy's stat roll (does not add a draw). */
  statBias?: Partial<Stats>;
  /** Prose note on the deferred/provisional real behavior (M10 floor hooks). */
  behaviorNote: string;
}

/** One enemy family: display name, broad tag, floor/act, ⚖ flag, karma seam, theme. */
export interface EnemyFamily {
  id: string;
  name: string;
  /** One of the six broad kinds: Beast / Humanoid / Mech / Magical / Nightmare / Ancestral. */
  tag: string;
  /** The floor (1..5) this family belongs to; act === floor. */
  floor: number;
  /** True when killing/sparing this family moves the karma vector (⚖). */
  karmaWeighted: boolean;
  /** Karma action a SPARE records for this ⚖ family (default mercy: 'spareWeighted'). */
  onSpare?: KarmaAction;
  /** Karma action a KILL records for this ⚖ family (default cruelty: 'killWeighted'). */
  onKill?: KarmaAction;
  theme: FamilyTheme;
}

/** The full 24-family roster, in authoring order. */
export const FAMILIES = enemyFamiliesData as unknown as readonly EnemyFamily[];

const BY_ID: ReadonlyMap<string, EnemyFamily> = new Map(FAMILIES.map((f) => [f.id, f]));

/** The family with the given id, or undefined if unknown (e.g. the final boss / legacy type). */
export function getFamily(id: string): EnemyFamily | undefined {
  return BY_ID.get(id);
}

/** Every family assigned to the given act/floor (act === floor), in authoring order. */
export function familiesForAct(act: number): readonly EnemyFamily[] {
  return FAMILIES.filter((f) => f.floor === act);
}

/**
 * The families an encounter in this act may draw from — the M13 gradual-unlock seam.
 * With `unlocked` omitted (default), every family of the act is available. With an
 * `unlocked` id set, only the intersection with the act's families is drawable; if that
 * intersection is empty (an over-restrictive set), it falls back to all of the act's
 * families so an encounter can never be bricked. PURE — no rng, no mutation.
 */
export function availableFamiliesForAct(
  act: number,
  unlocked?: ReadonlySet<string>,
): readonly EnemyFamily[] {
  const all = familiesForAct(act);
  if (!unlocked) return all;
  const filtered = all.filter((f) => unlocked.has(f.id));
  return filtered.length > 0 ? filtered : all;
}
