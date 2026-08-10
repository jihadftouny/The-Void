// Inventory / paperdoll state for The Void — pure, framework-agnostic (M1).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic: `createInventory` is a pure constant constructor — no RNG, no
//    Math.random / Date.now.
//  - Serializable plain-data state: `Inventory` is a flat record of `slots` (a plain
//    object of ItemInstance|null) plus a `backpack` array, so it round-trips through
//    JSON unchanged.
//
// SCOPE (M1): this defines the CONTAINER shape and its empty default only. Equip /
// unequip moves, backpack capacity / weight, and two-handed vs shield rules land in
// M5. In M1 the Player carries this ALONGSIDE the legacy equippedWeaponId /
// equippedArmorId (additive) — the legacy ids remain the live combat path.

import { EQUIP_SLOTS, type EquipSlot, type ItemInstance } from './item.ts';

/**
 * A Tibia-style paperdoll: one `ItemInstance | null` per equip slot, plus a flat
 * backpack of loose item instances.
 */
export interface Inventory {
  slots: Record<EquipSlot, ItemInstance | null>;
  backpack: ItemInstance[];
}

/** A fresh, empty inventory: every equip slot `null`, backpack empty. */
export function createInventory(): Inventory {
  const slots = {} as Record<EquipSlot, ItemInstance | null>;
  for (const slot of EQUIP_SLOTS) {
    slots[slot] = null;
  }
  return { slots, backpack: [] };
}
