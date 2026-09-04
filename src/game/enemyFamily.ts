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
// KARMA SEAM: each ⚖ family carries an optional `onSpare` LIST of KarmaActions and an
// optional `onKill` KarmaAction. The seam was built so the axes could be differentiated by
// EDITING THIS DATA rather than the game.ts logic that reads it, and #10a is the first use:
// The Judged now spares as `["spareWeighted", "honorDead"]`.
//
// WHY `onSpare` IS A LIST (§22.22, author's ruling 2026-09-04, against the recommendation).
// §9 words it as "The Judged ⚖⚖ — spare = reverence, kill = desecration", which reads as a
// SUBSTITUTION, and a single-action seam could only express it that way. The author's call is
// that it is ADDITIVE: sparing is an act of mercy whoever receives it, and that this particular
// enemy ALSO makes it reverence is an addition. A player who spares everything, with one enemy
// type silently not counting toward mercy, could never know or guess. Every OTHER ⚖ family
// therefore carries the one-element list `["spareWeighted"]` — same behaviour as before.
//
// The list is applied IN ORDER inside a single `step` (game.ts's `spared` branch folds it with
// `recordKarma`). A reader that applied only the first entry would look perfect and do half the
// job; `karmaActions.test.ts` asserts that one Judged spare moves BOTH axes in one step.
//
// NOT DONE, deliberately (§22.22, A.2): §9's other half — killing The Judged records
// DESECRATION — stays unbuilt. The shipped data records cruelty, and there is no desecration
// action that is not named for shrines, so it needs a FIFTH `KarmaAction`: a design addition,
// not a wiring. It belongs with #2's floor-4 work. `onKill` therefore stays a single action.

import enemyFamiliesData from '../data/enemyFamilies.json';
import { type Stats } from './character.ts';
import { type KarmaAction } from './karma.ts';

/** A family's light, placeholder combat theme (all magnitudes are M15 placeholders). */
export interface FamilyTheme {
  /**
   * The family's themed enemy-skill pool (skill ids in `SKILLS`). Typed `string[]` to match
   * the enemy `skillPool` and avoid JSON↔`SkillId` friction; a guard test enforces that every
   * id resolves in `SKILLS`. When absent, `generateEnemy` falls back to `['pyroBall']` (the
   * legacy/boss default). Magnitudes/theming are M15 placeholders.
   */
  skills?: string[];
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
  /**
   * The karma actions a SPARE records for this ⚖ family, applied IN ORDER within one `step`
   * (§22.22). Default when absent: the uniform mercy action alone, `['spareWeighted']`.
   */
  onSpare?: readonly KarmaAction[];
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
