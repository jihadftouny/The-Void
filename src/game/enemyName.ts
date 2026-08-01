// Enemy-name content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: the name tables are plain JSON in ../data/enemyNames.json.
//  - No RNG here: this module only exposes the raw [word, weight] tables. The
//    weighted selection (Java `selectName`/`isName`) lands in M4 on top of this.
//
// Ported from the canonical Java `EnemyName.setName` per-Act, per-type tables.

import enemyNamesData from '../data/enemyNames.json';

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
