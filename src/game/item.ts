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
//
// M6: `ItemEffect` becomes a discriminated union covering passive deltas/flags AND a
// `triggered` variant (a combat trigger + a data-described `EffectAction`). The three
// M6 seed catalogs (relics, uniques, consumables) are plain JSON here; `ItemInstance`
// gains an optional `rolled` payload for rarity-generated gear. Every field is optional
// and additive, so pre-M6 saves and every existing items.json entry validate unchanged.

import itemsData from '../data/items.json';
import relicsData from '../data/relics.json';
import uniquesData from '../data/uniques.json';
import consumablesData from '../data/consumables.json';
import { type Rarity } from './weapon.ts';
import { type ConditionType } from './condition.ts';
import { type StatKey } from './character.ts';

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

/** The six combat moments a `triggered` item effect can fire at (M6). */
export type TriggerType =
  | 'startOfBattle'
  | 'onHit'
  | 'onCrit'
  | 'onCast'
  | 'onKill'
  | 'onTakeDamage';

/** The finite, coded set of data-described actions a triggered effect can take (M6). */
export type EffectActionKind =
  | 'dealDamage'
  | 'healSelf'
  | 'applyConditionSelf'
  | 'applyConditionEnemy'
  | 'gainShield'
  | 'gainStat'
  | 'restoreCharge'
  | 'revive'
  | 'cure'
  | 'flee'
  | 'reroll';

/**
 * A data-described action, applied RNG-free by the effect pipeline (relicEffects.ts /
 * consumable.ts). `params` carries the numeric knobs the `kind` reads (e.g. `amount`,
 * `pctMaxHp`, `pctOfDamageTaken`, `perEnemyCondition`); the optional `condition` / `stat`
 * / `element` name the target of a condition-, stat-, or element-typed action.
 */
export interface EffectAction {
  kind: EffectActionKind;
  params: Record<string, number>;
  condition?: ConditionType;
  stat?: StatKey;
  element?: number;
}

/** The passive effect-type discriminants (fold into `EquipModifiers`). */
export type PassiveEffectType =
  | 'bonusStat'
  | 'bonusArmorClass'
  | 'bonusDamage'
  | 'heal'
  | 'bonusResist'
  | 'skillChargeDiscount'
  | 'firstHitReduction'
  | 'lowHpDamageBonus'
  | 'dotTickMultiplier'
  | 'chargePerTurn'
  | 'damageDealtMultiplier'
  | 'cannotHeal';

/**
 * A plain-data effect descriptor (M6 discriminated union). Passive variants carry a
 * numeric `params` bag folded into `EquipModifiers` (equipEffects.ts); the `triggered`
 * variant names a combat `trigger` and the `action` fired at it (relicEffects.ts).
 * Serializable: every member is a flat record of primitives, so it round-trips through
 * JSON. The four pre-M6 items.json types (`bonusStat`/`bonusArmorClass`/`bonusDamage`/
 * `heal`) are a subset of the passive variant, so existing content validates unchanged.
 */
export type ItemEffect =
  | { type: PassiveEffectType; params: Record<string, number> }
  | { type: 'triggered'; trigger: TriggerType; action: EffectAction };

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
  /**
   * For `usable` consumables (M6): the ordered `EffectAction`s applied when the item is
   * used as a battle action (consumable.ts). Absent for equippable gear, which acts
   * through `effects` instead.
   */
  use?: EffectAction[];
  /** Floor motif tag (M6, data-only): weights M8/M10 drops. Optional, ignored by combat. */
  floor?: number;
}

/**
 * A concrete item held in inventory. Thin in M1 (just a reference to a base def); M6
 * enriches it with OPTIONAL `rolled` affix data (rarity generator output) WITHOUT
 * changing the container type, so no second save migration is forced. A pre-M6
 * instance (bare `{ defId }`) resolves through the static catalogs unchanged.
 */
export interface ItemInstance {
  defId: string;
  /** Rarity-generated overlay: when present it fully describes the item (rarityGen.ts). */
  rolled?: {
    name: string;
    rarity: Rarity;
    slot: EquipSlot | null;
    kind: ItemKind;
    effects: ItemEffect[];
  };
}

const ITEMS = itemsData as readonly ItemDef[];
// The M6 catalogs carry `triggered` effects / `use` arrays the plain JSON inference can't
// name; cast through `unknown` (the shapes are authored to `ItemDef`, exercised by tests).
const RELICS = relicsData as unknown as readonly ItemDef[];
const UNIQUES = uniquesData as unknown as readonly ItemDef[];
const CONSUMABLES = consumablesData as unknown as readonly ItemDef[];

/** Every item definition in the base table, in file order. */
export function getAllItems(): readonly ItemDef[] {
  return ITEMS;
}

/** Every seed relic definition (M6), in file order. */
export function getAllRelics(): readonly ItemDef[] {
  return RELICS;
}

/** Every seed named-unique definition (M6), in file order. */
export function getAllUniques(): readonly ItemDef[] {
  return UNIQUES;
}

/** Every seed consumable definition (M6), in file order. */
export function getAllConsumables(): readonly ItemDef[] {
  return CONSUMABLES;
}

/** Resolve an item definition by its `id`, or `undefined` if none matches. */
export function getItemById(id: string): ItemDef | undefined {
  return ITEMS.find((item) => item.id === id);
}

/**
 * Resolve an item definition by id across EVERY M6 catalog — base items, relics,
 * uniques, then consumables (in that precedence) — or `undefined` if none matches.
 * This is the id-resolution seam the equipment bridge and consumable action read so a
 * relic/unique/consumable id resolves the same way a base item id does.
 */
export function getCatalogItemById(id: string): ItemDef | undefined {
  return (
    getItemById(id) ??
    RELICS.find((item) => item.id === id) ??
    UNIQUES.find((item) => item.id === id) ??
    CONSUMABLES.find((item) => item.id === id)
  );
}
