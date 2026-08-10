// Equipment bridge + equip operations for The Void — pure, framework-agnostic (M5).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. Every equip op is a
//    pure function returning a NEW Inventory; the input is never mutated.
//  - Deterministic seeded RNG: nothing here rolls — equip/resolve/accessors are RNG-free;
//    no Math.random / Date.now. Combat threads its own Rng elsewhere.
//  - Data-driven content: the only RULE added is the UNARMED fallback weapon (an M15
//    balance placeholder). Gear numbers stay in weapons/armor/shields JSON.
//  - Serializable plain-data state: an equipped item is an `ItemInstance` ({ defId }); the
//    Inventory stays a flat slots-record + backpack array that round-trips through JSON.
//
// THE GEAR-RESOLVER BRIDGE (orchestrator resolution — option b, contained, deferred):
//   The paperdoll `slots` are the single source of truth for WHAT is equipped. This module
//   is the single seam that maps an equipped `ItemInstance` to the mechanical stats combat
//   and defense need. `resolveGearDef` dispatches by id:
//     unified items.json (getItemById) FIRST — for effect-only / future unified gear;
//     then legacy weapon-by-name -> mainHand, armor-by-name -> armor, shield-by-id -> offHand.
//   Synthesized legacy defs carry `effects: []` (legacy gear has no data effects — that is
//   WHY the equip-effect pipeline is inert for a normal run).
//
//   TRADE-OFF (the documented cost of NOT extending the schema now): an item that lives ONLY
//   in items.json (rusted-blade, void-plate) has no legacy mechanical stats, so in mainHand
//   `weaponForSlot` returns undefined (battle falls back to UNARMED) and it contributes to
//   combat only via its `effects`. Genuine unified weapons/armor won't carry native dice/AC
//   until the M6/M7 schema extension folds weapons/armor/shields into the enriched `ItemDef`
//   and this resolver is swapped to read stats off it — with no gameplay-code change. FUTURE
//   WORK: M6/M7 full unification.

import {
  getItemById,
  EQUIP_SLOTS,
  type EquipSlot,
  type ItemEffect,
  type ItemInstance,
  type ItemKind,
} from './item.ts';
import { createInventory, type Inventory } from './inventory.ts';
import { getWeaponByName, type Rarity, type Weapon } from './weapon.ts';
import { getArmorByName, type Armor } from './armor.ts';
import { getShieldById, type Shield } from './shield.ts';

/**
 * A resolved gear definition — the common shape the resolver returns for both unified
 * items.json entries and synthesized legacy weapon/armor/shield defs. `slot` is the equip
 * slot the def belongs in (`null` for usables, which are never equippable); `effects` is
 * the plain-data effect list the equip-effect pipeline reads (always `[]` for legacy gear).
 */
export interface GearDef {
  defId: string;
  kind: ItemKind;
  slot: EquipSlot | null;
  rarity: Rarity;
  effects: ItemEffect[];
}

/**
 * The UNARMED fallback weapon (a RULE, not content): 1d1 Melee, so an empty mainHand never
 * throws and an unarmed hit deals a fixed floor of 1 + melee STR mod. M15 balance placeholder.
 */
export const UNARMED: Weapon = {
  name: 'Unarmed',
  cost: 0,
  rarity: 'Common',
  damage: { quantity: 1, sides: 1 },
  property: 'Melee',
};

/**
 * Resolve a defId to a `GearDef`, or `undefined` if no table knows it. Checks the unified
 * items.json table FIRST (so effect-only / future unified items win), then the legacy
 * weapon/armor/shield tables. Legacy defs are synthesized with `effects: []`.
 */
export function resolveGearDef(defId: string): GearDef | undefined {
  const unified = getItemById(defId);
  if (unified) {
    return {
      defId: unified.id,
      kind: unified.kind,
      slot: unified.slot,
      rarity: unified.rarity,
      effects: unified.effects,
    };
  }
  const weapon = getWeaponByName(defId);
  if (weapon) {
    return { defId, kind: 'weapon', slot: 'mainHand', rarity: weapon.rarity, effects: [] };
  }
  const armor = getArmorByName(defId);
  if (armor) {
    return { defId, kind: 'armor', slot: 'armor', rarity: armor.rarity, effects: [] };
  }
  const shield = getShieldById(defId);
  if (shield) {
    return { defId, kind: 'armor', slot: 'offHand', rarity: shield.rarity, effects: [] };
  }
  return undefined;
}

/** The equip slot a defId belongs in, or `null` for a usable / unknown def. */
export function slotForDef(defId: string): EquipSlot | null {
  const def = resolveGearDef(defId);
  return def ? def.slot : null;
}

/**
 * Whether `instance` may equip into `slot`: the resolved def must exist, carry a non-null
 * slot (usables never equip), and that slot must equal the target. Slot-type validation.
 */
export function canEquip(instance: ItemInstance, slot: EquipSlot): boolean {
  const def = resolveGearDef(instance.defId);
  if (!def || def.slot === null) return false;
  return def.slot === slot;
}

/**
 * Equip the backpack item at `backpackIndex` into `slot` (inferred from the def when
 * omitted) — PURE. On success returns a NEW Inventory with the item in the slot, the item
 * removed from the backpack, and any DISPLACED slot item returned to the backpack (swap).
 * On a bad index, a usable/unknown def, or a slot-type mismatch, returns the input Inventory
 * unchanged with `ok: false`.
 */
export function equip(
  inventory: Inventory,
  backpackIndex: number,
  slot?: EquipSlot,
): { inventory: Inventory; ok: boolean } {
  const item = inventory.backpack[backpackIndex];
  if (!item) return { inventory, ok: false };

  const targetSlot = slot ?? slotForDef(item.defId);
  if (targetSlot === null) return { inventory, ok: false };
  if (!canEquip(item, targetSlot)) return { inventory, ok: false };

  const backpack = inventory.backpack.filter((_, i) => i !== backpackIndex);
  const displaced = inventory.slots[targetSlot];
  if (displaced) backpack.push(displaced);
  const slots = { ...inventory.slots, [targetSlot]: item };
  return { inventory: { slots, backpack }, ok: true };
}

/**
 * Unequip the item in `slot` to the backpack — PURE. Returns a NEW Inventory with the slot
 * cleared and the item appended to the backpack; `ok: false` (input unchanged) if the slot
 * is already empty.
 */
export function unequip(
  inventory: Inventory,
  slot: EquipSlot,
): { inventory: Inventory; ok: boolean } {
  const item = inventory.slots[slot];
  if (!item) return { inventory, ok: false };
  const slots = { ...inventory.slots, [slot]: null };
  const backpack = [...inventory.backpack, item];
  return { inventory: { slots, backpack }, ok: true };
}

/** Append a loose item instance to the backpack — PURE (returns a new Inventory). */
export function pickUp(inventory: Inventory, instance: ItemInstance): Inventory {
  return { slots: { ...inventory.slots }, backpack: [...inventory.backpack, instance] };
}

/** The defId equipped in `slot`, or `undefined` when the slot is empty (shop display hook). */
export function equippedDefId(inventory: Inventory, slot: EquipSlot): string | undefined {
  const item = inventory.slots[slot];
  return item ? item.defId : undefined;
}

/**
 * Build an Inventory whose given slots hold the named gear (empty backpack) — PURE. Used at
 * character creation to seed the class starting gear into the paperdoll.
 */
export function inventoryWithGear(gear: Partial<Record<EquipSlot, string>>): Inventory {
  const base = createInventory();
  const slots = { ...base.slots };
  for (const slot of EQUIP_SLOTS) {
    const defId = gear[slot];
    if (defId !== undefined) slots[slot] = { defId };
  }
  return { slots, backpack: [] };
}

// ------- Mechanical accessors (the seam combat/defense read) ------------------

/** The Weapon in the mainHand slot, or `undefined` if empty / not a legacy weapon id. */
export function weaponForSlot(inventory: Inventory): Weapon | undefined {
  const item = inventory.slots.mainHand;
  return item ? getWeaponByName(item.defId) : undefined;
}

/** The Armor in the armor slot, or `undefined` if empty / not a legacy armor id. */
export function armorForSlot(inventory: Inventory): Armor | undefined {
  const item = inventory.slots.armor;
  return item ? getArmorByName(item.defId) : undefined;
}

/** The Shield in the offHand slot, or `undefined` if empty / not a legacy shield id. */
export function shieldForSlot(inventory: Inventory): Shield | undefined {
  const item = inventory.slots.offHand;
  return item ? getShieldById(item.defId) : undefined;
}
