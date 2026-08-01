// Weapon content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic accessors: fetch-by-Act only; no RNG, no Math.random/Date.now.
//    Rarity-weighted shop selection and dice rolling live in later milestones.
//  - Data-driven content: the weapon table is plain JSON in ../data/weapons.json;
//    this module only types and exposes it.
//
// Ported from the canonical Java `Weapon.java` (property spelling "Melee").

import weaponsData from '../data/weapons.json';

/** A dice specification, e.g. 1d8 = { quantity: 1, sides: 8 }. */
export interface Dice {
  quantity: number;
  sides: number;
}

/** Item rarity tier (Java `Item.itemRarity`). */
export type Rarity = 'Common' | 'Rare' | 'Legendary';

/** Weapon handling property (Java `Weapon.weaponProperty`). */
export type WeaponProperty = 'Melee' | 'Ranged' | 'Finesse';

/** A weapon as plain serializable data (Java `Weapon`). */
export interface Weapon {
  name: string;
  cost: number;
  rarity: Rarity;
  damage: Dice;
  property: WeaponProperty;
}

// The JSON is keyed act1..act4; treat it as a record of weapon arrays.
const WEAPONS = weaponsData as Readonly<Record<string, readonly Weapon[]>>;

/**
 * Weapons offered in a given Act (1..4), in canonical Java order
 * (Common gun, Rare sword, Legendary rapier). Returns undefined for an
 * out-of-range Act rather than silently coercing.
 */
export function getWeaponsForAct(act: number): readonly Weapon[] | undefined {
  return WEAPONS[`act${act}`];
}

/** Every weapon across all Acts, flattened in Act order. */
export function getAllWeapons(): readonly Weapon[] {
  return [
    ...(WEAPONS['act1'] ?? []),
    ...(WEAPONS['act2'] ?? []),
    ...(WEAPONS['act3'] ?? []),
    ...(WEAPONS['act4'] ?? []),
  ];
}

/**
 * Resolve a weapon by its `name` id (linear scan across all Acts), or undefined
 * if no weapon has that name. Used to resolve a player's `equippedWeaponId`,
 * since equipment is stored on state as an id, not an embedded object.
 */
export function getWeaponByName(name: string): Weapon | undefined {
  return getAllWeapons().find((w) => w.name === name);
}
