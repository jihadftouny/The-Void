// Armor content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic accessors: fetch-by-Act only; no RNG, no Math.random/Date.now.
//  - Data-driven content: the armor table is plain JSON in ../data/armor.json.
//
// Ported from the canonical Java `Armor.java`. Java field names armorAC/armorACM/
// armorStr are renamed to self-describing baseArmor/dexCap/strReq.

import armorData from '../data/armor.json';
import type { Rarity } from './weapon.ts';

// Re-export Rarity so armor consumers can import it from a single module.
export type { Rarity };

/** An armor as plain serializable data (Java `Armor`). */
export interface Armor {
  name: string;
  cost: number;
  rarity: Rarity;
  /** Base armor class (Java `armorAC`). */
  baseArmor: number;
  /** Max Dexterity modifier this armor allows (Java `armorACM`). */
  dexCap: number;
  /** Strength score required to wear without penalty (Java `armorStr`). */
  strReq: number;
}

const ARMOR = armorData as Readonly<Record<string, readonly Armor[]>>;

/**
 * Armors offered in a given Act (1..4), in canonical Java order
 * (Common, Rare, Legendary). Returns undefined for an out-of-range Act.
 */
export function getArmorForAct(act: number): readonly Armor[] | undefined {
  return ARMOR[`act${act}`];
}

/** Every armor across all Acts, flattened in Act order. */
export function getAllArmor(): readonly Armor[] {
  return [
    ...(ARMOR['act1'] ?? []),
    ...(ARMOR['act2'] ?? []),
    ...(ARMOR['act3'] ?? []),
    ...(ARMOR['act4'] ?? []),
  ];
}
