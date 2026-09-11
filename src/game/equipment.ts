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
  getCatalogItemById,
  EQUIP_SLOTS,
  type EquipSlot,
  type ItemEffect,
  type ItemInstance,
  type ItemKind,
} from './item.ts';
import { canCarry, createInventory, type Inventory } from './inventory.ts';
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
  const unified = getCatalogItemById(defId);
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

/**
 * Resolve the mechanical def for a concrete `ItemInstance` — PURE. A rarity-generated
 * instance carries its full description in `rolled`, so it becomes a `GearDef` directly
 * (its effects contribute to the equip pipeline exactly like a catalog item's). A plain
 * instance falls back to `resolveGearDef(defId)`. This is the single seam the effect
 * pipeline reads so rolled loot and catalog gear are treated uniformly.
 */
export function resolveInstanceDef(instance: ItemInstance): GearDef | undefined {
  if (instance.rolled) {
    return {
      defId: instance.defId,
      kind: instance.rolled.kind,
      slot: instance.rolled.slot,
      rarity: instance.rolled.rarity,
      effects: instance.rolled.effects,
    };
  }
  return resolveGearDef(instance.defId);
}

/**
 * The equip slot a defId belongs in, or `null` for a usable / unknown def. DEF-LEVEL: it has
 * no instance to read, so a rarity-generated `gen:<rarity>:<slot>` id is unknown to it and
 * resolves to `null`. Instance-aware inference lives in `equip` (see G11 below).
 */
export function slotForDef(defId: string): EquipSlot | null {
  const def = resolveGearDef(defId);
  return def ? def.slot : null;
}

/**
 * Whether `instance` may equip into `slot`: the resolved def must exist, carry a non-null
 * slot (usables never equip), and that slot must equal the target. Slot-type validation.
 *
 * G11 (FINDINGS §4, the worst defect in the project): this used to resolve by `defId` alone
 * via `resolveGearDef`, which knows only the catalogs. Every rarity-generated drop carries the
 * synthetic id `gen:<rarity>:<slot>` (rarityGen.ts), which no catalog holds, so the lookup
 * returned `undefined` and EVERY item the player found was rejected — measured at 0 of >100
 * drops over 300 seeds. `resolveInstanceDef` reads the instance's own `rolled` overlay first
 * (and falls back to `resolveGearDef` for a plain `{defId}` instance), so catalog gear and
 * rolled loot are now validated through one seam — the same seam `equipEffects.ts` and
 * `view-model.ts` already read.
 */
export function canEquip(instance: ItemInstance, slot: EquipSlot): boolean {
  const def = resolveInstanceDef(instance);
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

  // G11: infer the slot from the INSTANCE (its `rolled` overlay when it has one), falling
  // back to the def-level lookup for a plain `{defId}` catalog instance. The real UI path
  // (`view-model.ts`'s Equip button) calls `equip(inventory, index)` with NO slot, so this
  // inference — not just `canEquip` — has to understand a rolled item or found gear still
  // cannot be equipped.
  const targetSlot = slot ?? resolveInstanceDef(item)?.slot ?? slotForDef(item.defId);
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
  // PLAN.md #2: the unequipped item goes to the backpack, so a full one refuses the move.
  if (!canCarry(inventory)) return { inventory, ok: false };
  const slots = { ...inventory.slots, [slot]: null };
  const backpack = [...inventory.backpack, item];
  return { inventory: { slots, backpack }, ok: true };
}

/**
 * Append a loose item instance to the backpack — PURE (returns a new Inventory).
 *
 * PLAN.md #2: a FULL backpack (`BACKPACK_CAPACITY`) refuses the item and the INPUT inventory is
 * returned unchanged (reference-equal, so a caller can tell). Every engine call site checks
 * `canCarry` first and says what happened: a victory drop or a chest item is left behind with a
 * `loot-left-behind` event; a bargain's reward opens the pack for a discard instead (plan
 * Appendix A.3) — it is never silently lost.
 */
export function pickUp(inventory: Inventory, instance: ItemInstance): Inventory {
  if (!canCarry(inventory)) return inventory;
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
//
// ⚠ KNOWN GAP, deliberately shipped (author's call, 2026-09-01 — see HUMAN-CHECKS.md).
// These three resolve by LEGACY NAME ONLY. With G11 fixed, a rarity-generated `gen:*` item
// finally EQUIPS — but `getWeaponByName('gen:Common:mainHand')` is undefined, so an equipped
// generated weapon swings the UNARMED 1d1 die and an equipped generated armor falls back to
// the unarmored `10 + CON` base; only the rolled item's flat `bonusDamage`/`bonusArmorClass`
// survives (via equipEffects). Arithmetic: the Enforcer's starting 1d6 sword averages 3.5,
// while a Common generated mainHand is `1d1 + (1..2)` = 2–3, so a COMMON WEAPON DROP IS A
// DOWNGRADE (~40% of act-1 drops by `dropTables.json` weight); Rare (3–5) is a wash and
// Legendary (6–9) an upgrade. The honest fix is the deferred M6/M7 schema unification, which
// is `PLAN.md` #1's scope by right (it owns the item schema and the 9→7 slot migration).
// Do NOT paper over it with a balance fudge here.

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
