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
// Two-handed vs shield rules remain deferred. PLAN.md #2 gives the backpack its CAPACITY (below).

import { EQUIP_SLOTS, type EquipSlot, type ItemInstance } from './item.ts';

/**
 * A Tibia-style paperdoll: one `ItemInstance | null` per equip slot, plus a flat
 * backpack of loose item instances.
 */
export interface Inventory {
  slots: Record<EquipSlot, ItemInstance | null>;
  backpack: ItemInstance[];
}

/**
 * The backpack holds a fixed number of items — a slot count, no weight (GAME-DESIGN.md §22.17,
 * FINDINGS B4: N = 12, the #2 re-run's starting value). Since §22.6 folded potions into
 * consumables, this number is ALSO the healing budget: every heal carried is a slot not holding
 * gear. Equipped items do not count; only the loose backpack does.
 */
export const BACKPACK_CAPACITY = 12;

/** Can the backpack take `count` more items? PURE. */
export function canCarry(inventory: Inventory, count = 1): boolean {
  return inventory.backpack.length + count <= BACKPACK_CAPACITY;
}

/** A fresh, empty inventory: every equip slot `null`, backpack empty. */
export function createInventory(): Inventory {
  const slots = {} as Record<EquipSlot, ItemInstance | null>;
  for (const slot of EQUIP_SLOTS) {
    slots[slot] = null;
  }
  return { slots, backpack: [] };
}
