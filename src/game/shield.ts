// Shield / off-hand content loader for The Void — pure, framework-agnostic game logic (M4).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic accessors: fetch-by-id only; no RNG, no Math.random/Date.now.
//  - Data-driven content: the shield table is plain JSON in ../data/shields.json.
//
// A shield is a new off-hand slot introduced in M4 to make defense choices richer: it
// adds a flat `acBonus` to the player's Armor Class. This is a MINIMAL seed table (M6
// expands it with rarity scaling / richer content). Mirrors `armor.ts`.

import shieldData from '../data/shields.json';
import type { Rarity } from './weapon.ts';

// Re-export Rarity so shield consumers can import it from a single module.
export type { Rarity };

/** A shield as plain serializable data. `acBonus` is added flat to the wearer's AC. */
export interface Shield {
  id: string;
  name: string;
  /** Flat Armor Class bonus this shield grants (M15 balance placeholder). */
  acBonus: number;
  rarity: Rarity;
  cost: number;
}

const SHIELDS = shieldData as readonly Shield[];

/** Every shield in the seed table, in declaration order. */
export function getAllShields(): readonly Shield[] {
  return SHIELDS;
}

/**
 * Resolve a shield by its `id`, or undefined if no shield has that id. Used to
 * resolve a player's optional `equippedShieldId`, since equipment is stored on
 * state as an id, not an embedded object.
 */
export function getShieldById(id: string): Shield | undefined {
  return SHIELDS.find((s) => s.id === id);
}
