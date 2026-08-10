// Enemy-name content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: the name tables are plain JSON in ../data/enemyNames.json.
//  - Deterministic seeded RNG: the M4 runtime selection below draws only through
//    the injected `Rng` (via `weightedPick`); no Math.random / Date.now.
//
// Ported from the canonical Java `EnemyName.setName` per-Act, per-type tables and
// `Calculator.setFullName`. See the plan's recorded deviations: selection is a
// weighted pick over [1, sum(weights)] (correct for tables that do not sum to
// 100), and the buggy per-candidate 95% slot-omit is dropped.

import enemyNamesData from '../data/enemyNames.json';
import { weightedPick, type Rng } from './rng.ts';

/** A weighted name fragment: [word, weight]. */
export type WeightPair = readonly [string, number];

/** The three positional slots of an enemy name. */
export interface EnemyNameTable {
  first: WeightPair[];
  middle: WeightPair[];
  last: WeightPair[];
}

// JSON is keyed by act number (as a string) -> type -> table. The JSON tuples
// widen to (string|number)[][], so cast through `unknown` to the WeightPair shape.
const TABLES = enemyNamesData as unknown as Readonly<
  Record<string, Readonly<Record<string, EnemyNameTable>>>
>;

/**
 * The name table for a given Act (1..4) and enemy type, or undefined if the
 * Act/type pair does not exist.
 */
export function getEnemyNameTable(
  act: number,
  type: string,
): EnemyNameTable | undefined {
  return TABLES[String(act)]?.[type];
}

/**
 * The enemy types available in a given Act, in Java declaration order
 * (Act1: Beast/Humanoid/Mech/Magical; Act2: Beast/Humanoid/Magical;
 * Act3: Nightmare; Act4: Beast/Humanoid/Ancestral). Empty for unknown Acts.
 */
export function enemyTypesForAct(act: number): string[] {
  const actTable = TABLES[String(act)];
  return actTable ? Object.keys(actTable) : [];
}

/**
 * Pick one word from a slot's weighted pairs via `weightedPick`. Returns "" for
 * an empty slot and draws no rng in that case (so an enemy's rng-call count only
 * grows for slots that actually have entries). A non-empty slot always yields a
 * word (which may itself be the empty string "" if the table carries one).
 */
export function selectNameFragment(
  pairs: readonly WeightPair[],
  rng: Rng,
): string {
  if (pairs.length === 0) return '';
  return weightedPick(rng, pairs) ?? '';
}

/**
 * Build a full enemy name for an Act/type: picks first, then middle, then last
 * fragments (in that fixed order, so the rng draw order is stable), and joins the
 * non-empty ones with single spaces. If the Act/type has no table, or every slot
 * resolves empty (e.g. Act-3 Nightmare's all-empty tables), falls back to `type`.
 */
export function generateEnemyName(
  act: number,
  type: string,
  rng: Rng,
): string {
  const table = getEnemyNameTable(act, type);
  if (!table) return type;
  const fragments = [
    selectNameFragment(table.first, rng),
    selectNameFragment(table.middle, rng),
    selectNameFragment(table.last, rng),
  ].filter((word) => word.length > 0);
  const fullName = fragments.join(' ');
  return fullName.length > 0 ? fullName : type;
}
