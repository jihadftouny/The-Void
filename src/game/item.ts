// Item schema + content loader for The Void — pure, framework-agnostic (M1).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic accessors: fetch-by-id / list only; no RNG, no Math.random /
//    Date.now. Rarity-weighted generation and rolled affixes land in M6.
//  - Data-driven content: the item table is plain JSON in ../data/items.json; this
//    module only types and exposes it.
//  - Serializable plain-data state: `ItemDef` and `ItemInstance` are flat records,
//    so they round-trip through JSON unchanged.
//
// SCOPE (M1): this defines the DATA SHAPE only. The `effects` field is inert data —
// nothing interprets it this milestone. Equip/unequip and effect application land in
// M4/M5/M6.

import itemsData from '../data/items.json';
import { type Rarity } from './weapon.ts';

/** The kind of an item. Drives which slot (if any) it equips into. */
export type ItemKind = 'weapon' | 'armor' | 'trinket' | 'usable';

/**
 * The nine paperdoll equip slots (Tibia-style). The task's "two hands" are modeled
 * as separate `mainHand` + `offHand` slots.
 */
export type EquipSlot =
  | 'helmet'
  | 'amulet'
  | 'mainHand'
  | 'offHand'
  | 'armor'
  | 'legs'
  | 'boots'
  | 'ring'
  | 'ammo';

/** Every equip slot, canonical order — iterate this to build the paperdoll. */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'amulet',
  'mainHand',
  'offHand',
  'armor',
  'legs',
  'boots',
  'ring',
  'ammo',
];

/**
 * A plain-data effect descriptor. Inert in M1 — no code interprets `type`/`params`
 * yet; it is the serializable slot later milestones read to apply stat/combat effects.
 */
export interface ItemEffect {
  type: string;
  params: Record<string, number>;
}

/**
 * A static item definition (the base table entry). Equipment carries a `slot`;
 * usables and non-equipped items carry `slot: null`.
 */
export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  slot: EquipSlot | null;
  rarity: Rarity;
  effects: ItemEffect[];
}

/**
 * A concrete item held in inventory. Thin in M1 (just a reference to a base def);
 * M6 enriches it with rolled affix data WITHOUT changing the container types, so no
 * second save migration is forced.
 */
export interface ItemInstance {
  defId: string;
}

const ITEMS = itemsData as readonly ItemDef[];

/** Every item definition in the base table, in file order. */
export function getAllItems(): readonly ItemDef[] {
  return ITEMS;
}

/** Resolve an item definition by its `id`, or `undefined` if none matches. */
export function getItemById(id: string): ItemDef | undefined {
  return ITEMS.find((item) => item.id === id);
}
