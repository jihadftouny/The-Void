// Floor 5's warped kit — pure, framework-agnostic game logic (PLAN.md #2).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM or canvas imports; nothing printed.
//  - Deterministic seeded RNG: `rollCorruptions` takes the state's `Rng` and draws exactly ONE
//    `pick` per skill, in pool order — nothing else. No Math.random / Date.now.
//  - Data-driven content: WHAT a corruption does is `../data/corruptions.json`; `skill.ts`'s
//    `resolveSkill` applies a template generically, so a new corruption is a data edit.
//  - Serializable plain-data state: the run stores only `Player.corruptedSkills`, a record of
//    skill id -> template id (two strings). The templates themselves are never copied in.
//
// THE RULING (GAME-DESIGN.md §22.24): floor 5's corruption is SEEDED PER RUN — "each skill gets
// one corrupted form on arrival; learnable within the run, different the next". Rejected by the
// author: fixed-forever corruption (a second moveset after a few runs) and random-every-use
// (hardest to play well on the least-seen floor). This is the hybrid rule's bespoke half
// (GAME-DESIGN.md §8): not a number a relic effect could carry, so it is code, switched on by
// the floor's `corruptsSkills` flag in `floors.json`.

import corruptionsData from '../data/corruptions.json';
import { pick, type Rng } from './rng.ts';
import { type ConditionType } from './condition.ts';

/** One corrupted form, as authored. Every field but `id`/`suffix` is optional and additive. */
export interface CorruptionTemplate {
  id: string;
  /** Appended to the skill's name, so the player can see the warp: "Heavy Strike (warped)". */
  suffix: string;
  /** Added to the charge cost (clamped at 0). */
  chargeDelta?: number;
  /** Added to the base damage (clamped at 0). */
  damageBonus?: number;
  /** Replaces the damage element. */
  element?: string;
  /** Added to the caster's HP cost (the Penitent's price, now anyone's). */
  hpCost?: number;
  /** Unioned onto the conditions the skill inflicts. */
  addConditions?: ConditionType[];
}

interface CorruptionsFile {
  status: string;
  templates: CorruptionTemplate[];
}

/** Every corruption template, in authoring order — the order `rollCorruptions` picks over. */
export const CORRUPTION_TEMPLATES: readonly CorruptionTemplate[] = (
  corruptionsData as unknown as CorruptionsFile
).templates;

const BY_ID: ReadonlyMap<string, CorruptionTemplate> = new Map(
  CORRUPTION_TEMPLATES.map((t) => [t.id, t]),
);

/** The template with this id, or undefined (a stale id in a save degrades to "not corrupted"). */
export function corruptionTemplate(id: string): CorruptionTemplate | undefined {
  return BY_ID.get(id);
}

/**
 * Roll one corrupted form for every skill in `skillPool` — PURE, seeded. EXACTLY one `pick`
 * draw per skill, in pool order, so a pool of N skills takes N draws. Returns the plain-data
 * map `Player.corruptedSkills` stores. An empty pool draws nothing and returns `{}`.
 */
export function rollCorruptions(skillPool: readonly string[], rng: Rng): Record<string, string> {
  const map: Record<string, string> = {};
  for (const skillId of skillPool) map[skillId] = pick(rng, CORRUPTION_TEMPLATES).id;
  return map;
}
