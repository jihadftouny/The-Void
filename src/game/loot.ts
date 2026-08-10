// Found-loot sourcing for The Void — pure, framework-agnostic game logic (M7).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay/DOM/canvas. `rollLootDrop` / `rollChestLoot`
//    are pure functions of an injected `Rng` + the per-Act data table; they return plain
//    `ItemInstance` data and mutate nothing.
//  - Deterministic seeded RNG: every draw threads the injected `Rng` (src/game/rng.ts) in a
//    FIXED, documented order, so the same seed + Act always rolls the identical drop. The
//    item itself is built by M6's seeded `rarityGen.generateItem`. No Math.random / Date.now.
//  - Data-driven content: the per-Act power curve (drop chance, rarity weights, slot weights)
//    and the chest table live in `../data/dropTables.json`. Adding/rebalancing loot edits
//    DATA, not this logic (overrides the convenient "inline the tables" shortcut — recorded
//    because the roadmap M8/M10 expands drop tables by data).
//  - Serializable plain-data state: the returned `ItemInstance`s equip/save like any other.
//
// WHERE loot lands is the caller's job (battle.ts victory drops into the backpack; game.ts
// chest phase does the same). Every magnitude/chance here is an M15 balance placeholder.
//
// DOCUMENTED DRAW ORDER (load-bearing for the determinism tests):
//   rollLootDrop:  (1) drop gate  = rng() < dropChance   [fail -> null, one draw]
//                  (2) rarity      = weightedPick(rarityWeights)
//                  (3) slot        = weightedPick(slotWeights)
//                  (4,5) generateItem's two draws (magnitude, proc)
//   rollChestLoot: for each of chestItemCount items, in order:
//                  (1) rarity, (2) slot, (3,4) generateItem's two draws  (NO drop gate)

import { weightedPick, type Rng } from './rng.ts';
import { type Rarity } from './weapon.ts';
import { type EquipSlot } from './item.ts';
import { generateItem } from './rarityGen.ts';
import { type ItemInstance } from './item.ts';
import dropTablesData from '../data/dropTables.json';

/** A per-Act loot table (M15 placeholders). */
export interface DropTable {
  /** Chance [0,1] that a victory yields any drop at all. */
  dropChance: number;
  /** Rarity selection weights (higher tiers rise by Act). */
  rarityWeights: Partial<Record<Rarity, number>>;
  /** Which equip slots can drop, and how often. */
  slotWeights: Partial<Record<EquipSlot, number>>;
}

/** The chest table: guaranteed items (no drop gate), richer rarity mix. */
export interface ChestTable {
  chestItemCount: number;
  rarityWeights: Partial<Record<Rarity, number>>;
  slotWeights: Partial<Record<EquipSlot, number>>;
}

interface DropTablesFile {
  perAct: Record<string, DropTable>;
  chest: ChestTable;
}

const TABLES = dropTablesData as unknown as DropTablesFile;

/**
 * Canonical rarity order — fixes the `weightedPick` entry order so the cumulative walk is
 * deterministic (Common first). Any weight absent from a table is skipped (never selected).
 */
const RARITY_ORDER: readonly Rarity[] = ['Common', 'Rare', 'Legendary'];

/** Canonical slot order — fixes the slot `weightedPick` entry order deterministically. */
const SLOT_ORDER: readonly EquipSlot[] = [
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
 * The drop table for `act` — PURE, RNG-free. Acts > 4 reuse Act 4's table (mirroring the
 * shop/encounter "clamp to 4" content policy); Act < 1 clamps to Act 1.
 */
export function getDropTable(act: number): DropTable {
  const key = String(Math.min(Math.max(act, 1), 4));
  const table = TABLES.perAct[key];
  if (!table) throw new Error(`getDropTable: no drop table for act ${act}`);
  return table;
}

/** The chest table — PURE, RNG-free. */
export function getChestTable(): ChestTable {
  return TABLES.chest;
}

/** Build the ordered rarity weight entries for `weightedPick` (skips zero/absent weights). */
function rarityEntries(weights: Partial<Record<Rarity, number>>): (readonly [Rarity, number])[] {
  return RARITY_ORDER.filter((r) => (weights[r] ?? 0) > 0).map(
    (r) => [r, weights[r] as number] as const,
  );
}

/** Build the ordered slot weight entries for `weightedPick` (skips zero/absent weights). */
function slotEntries(
  weights: Partial<Record<EquipSlot, number>>,
): (readonly [EquipSlot, number])[] {
  return SLOT_ORDER.filter((s) => (weights[s] ?? 0) > 0).map(
    (s) => [s, weights[s] as number] as const,
  );
}

/**
 * Roll one loot drop for a victory in the given Act — PURE, seeded. Draw order is the module
 * header's `rollLootDrop` order. On a failed drop gate returns `null` (exactly one draw
 * consumed), so a caller's RNG stream advances by a single step whether or not loot drops.
 * The dropped item's stat (for a ring/amulet) defaults to STR — no extra draw is spent (see
 * DEVIATION note in loot.test.ts: the design's separate stat-pick draw is omitted so the loot
 * stream stays at the documented five draws).
 */
export function rollLootDrop(act: number, rng: Rng): ItemInstance | null {
  const table = getDropTable(act);
  // (1) drop gate.
  if (!(rng() < table.dropChance)) return null;
  // (2) rarity, (3) slot.
  const rarity = weightedPick(rng, rarityEntries(table.rarityWeights));
  if (!rarity) throw new Error(`rollLootDrop: empty rarity table for act ${act}`);
  const slot = weightedPick(rng, slotEntries(table.slotWeights));
  if (!slot) throw new Error(`rollLootDrop: empty slot table for act ${act}`);
  // (4,5) the item itself (magnitude then proc gate) — via M6's seeded generator.
  return generateItem(rng, { slot, rarity });
}

/**
 * Roll the contents of a chest/cache — PURE, seeded. Yields exactly `chestItemCount`
 * guaranteed items (no drop gate). Each item draws rarity, slot, then `generateItem`'s two
 * draws, in that order, for a total of `4 * chestItemCount` draws. Returned in roll order.
 */
export function rollChestLoot(rng: Rng): ItemInstance[] {
  const table = getChestTable();
  const items: ItemInstance[] = [];
  for (let i = 0; i < table.chestItemCount; i++) {
    const rarity = weightedPick(rng, rarityEntries(table.rarityWeights));
    if (!rarity) throw new Error('rollChestLoot: empty chest rarity table');
    const slot = weightedPick(rng, slotEntries(table.slotWeights));
    if (!slot) throw new Error('rollChestLoot: empty chest slot table');
    items.push(generateItem(rng, { slot, rarity }));
  }
  return items;
}

/** A one-line, serializable summary of a dropped item (for the `victory`/`chest-loot` events). */
export interface LootSummary {
  defId: string;
  name: string;
  rarity: Rarity;
}

/** Summarize a rolled item for an event stream. Reads the `rolled` overlay the generator fills. */
export function summarizeLoot(instance: ItemInstance): LootSummary {
  const rolled = instance.rolled;
  return {
    defId: instance.defId,
    name: rolled?.name ?? instance.defId,
    rarity: rolled?.rarity ?? 'Common',
  };
}
