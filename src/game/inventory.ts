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
// SCOPE: this defines the CONTAINER shape and its empty default only. The equip / unequip
// moves and mechanical resolver live in equipment.ts (M5); the paperdoll `slots` are now the
// SINGLE SOURCE OF TRUTH for equipped gear (the legacy `equipped*Id` fields were removed).
// Backpack capacity / weight and two-handed vs shield rules remain deferred (M6/M7/M15).

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
