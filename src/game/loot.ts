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
// BALANCE (provisional, M15 — NEEDS-HUMAN): the intent is a rough ~50/50 split between FOUND
// loot (victory drops at dropChance 0.5 + the 1/6 chest encounter) and SACRIFICE deals (the
// player-initiated `seek-deal` altar). Act-1 dropChance is pinned at 0.5 and rarity/legendary
// weight rises by Act. These numbers are not play-tested; removing gold + adding found loot
// shifts progression pacing (recorded, not tuned here).
//
// AUTHORED CATALOG ITEMS ON THE DROP PATH (G14). Before this, `rollLootDrop` and
// `rollChestLoot` could ONLY ever hand back rarity-GENERATED gear, so 23 of the 38 authored
// items — every consumable and every named unique — were unobtainable in a finished run.
// That is why the game had no healing: `consumableOptions` scans the backpack for an entry
// whose catalog def has a `use` script, and no backpack entry ever had a catalog `defId`.
// A weighted `catalog` branch (per-act and on the chest table) now puts them there.
//
// ⚠ RELICS ARE NOT ON THIS PATH, DELIBERATELY. `GAME-DESIGN.md` §14.1 [DECIDED 2026-08-26]:
// "Acquisition: SACRIFICE-DEALS ONLY — relics are never dropped, never in a chest, never a
// boss reward", restated by §14.8's source table and §18.2. `FINDINGS.md` G14's instruction
// to add relics here contradicts three [DECIDED] rulings and is not followed; a test asserts
// no relic id can ever appear on a loot path. Widening relic acquisition is PLAN.md #9's,
// and needs a front-load relic set nobody has chosen yet.
//
// DOCUMENTED DRAW ORDER (load-bearing for the determinism tests):
//   rollLootDrop:  (1) drop gate  = rng() < dropChance   [fail -> null, one draw]
//                  (2) rarity      = weightedPick(rarityWeights)
//                  (3) slot        = weightedPick(slotWeights)
//                  (4) catalog gate = rng() < catalog.chance   [only when the table declares
//                      a `catalog` block AND a pool has an entry at this act — both static
//                      per act, so the draw COUNT is still a fixed function of (table, act)]
//                    4a. catalog: (5) pool  = weightedPick(poolWeights over NON-EMPTY pools)
//                                 (6) index = randInt(pool.length)      -> { defId }
//                    4b. gear:    (5,6) generateItem's two draws        -> { defId: 'gen:*', rolled }
//   rollChestLoot: for each of chestItemCount items, the SAME (2)..(6) tail  (NO drop gate)
//
// WHY THE CATALOG GATE SITS AT (4) AND NOT (2). Draws 1-3 stay byte-identical to the
// pre-G14 stream, so every existing scripted-RNG expectation keeps its first three values
// and only its tail moves. Both branches then take exactly TWO more draws, so a drop costs
// six draws either way and the stream position after a drop never depends on WHICH branch
// fired. A table with no `catalog` key takes ZERO extra draws — the short-circuit is before
// the gate, and that off-equivalence is proved by test rather than asserted.
//
// Rarity and slot ARE drawn on the catalog branch and then discarded. That is the price of
// keeping (1)-(3) where they were; the alternative (gate first) would have moved every
// existing expectation and bought nothing.
//
// FAMILY-AWARE LOOT (this milestone): rollLootDrop takes an optional `tag` (the enemy's
// broad family tag: Mech / Humanoid / Beast / Magical / Ancestral / Nightmare). When the
// tag is present in `byTag`, each act slot weight is MULTIPLIED by the tag's per-slot
// multiplier (default x1 for any slot the tag omits). This BIASES only WITHIN the act's
// own slot set — a multiplier can never introduce a slot the act table lacks (the tag map
// is applied on top of the act's `slotWeights`, so an act-absent slot stays absent) nor
// remove one (its weight only scales). So the M7 per-act power curve is preserved and only
// the slot FLAVOUR shifts. The draw ORDER and COUNT are unchanged (still gate -> rarity ->
// slot -> two item draws); only the slot entry weights are reshaped, so a tag-free call
// (`tag` undefined, or a tag absent from `byTag`) is BYTE-IDENTICAL to the pre-family code.
// All multipliers are M15 balance placeholders.

import { randInt, weightedPick, type Rng } from './rng.ts';
import { type Rarity } from './weapon.ts';
import { type EquipSlot } from './item.ts';
import { generateItem } from './rarityGen.ts';
import {
  getAllConsumables,
  getAllUniques,
  getCatalogItemById,
  type ItemDef,
  type ItemInstance,
} from './item.ts';
import dropTablesData from '../data/dropTables.json';

/**
 * Which authored catalog a `catalog` drop comes from. The pools are DERIVED from the
 * shipped item data (below), never enumerated a second time here — adding a consumable to
 * `consumables.json` puts it in the drop pool with no edit to this file (principle #3).
 *
 * There is deliberately no `relic` pool: §14.1 makes relics deal-only. See the header.
 */
export type CatalogPool = 'heal' | 'utility' | 'unique';

/** The catalog branch's data: how often it fires, and the mix across the pools. */
export interface CatalogDrops {
  /** Chance [0,1] that a drop is an authored CATALOG item rather than generated gear. */
  chance: number;
  /** Pool selection weights. A pool with no entry at this act is dropped before any draw. */
  poolWeights: Partial<Record<CatalogPool, number>>;
}

/** A per-Act loot table (M15 placeholders). */
export interface DropTable {
  /** Chance [0,1] that a victory yields any drop at all. */
  dropChance: number;
  /** Rarity selection weights (higher tiers rise by Act). */
  rarityWeights: Partial<Record<Rarity, number>>;
  /** Which equip slots can drop, and how often. */
  slotWeights: Partial<Record<EquipSlot, number>>;
  /** G14: the authored-catalog branch. Absent ⇒ generated gear only, and zero extra draws. */
  catalog?: CatalogDrops;
}

/** The chest table: guaranteed items (no drop gate), richer rarity mix. */
export interface ChestTable {
  chestItemCount: number;
  rarityWeights: Partial<Record<Rarity, number>>;
  slotWeights: Partial<Record<EquipSlot, number>>;
  /** §18.2: a chest carries consumables and gear, with a rare unique as the jackpot. */
  catalog?: CatalogDrops;
}

/** Per-tag slot multipliers (default x1 for an omitted slot). M15 balance placeholders. */
export type TagSlotBias = Partial<Record<EquipSlot, number>>;

interface DropTablesFile {
  perAct: Record<string, DropTable>;
  chest: ChestTable;
  /** Family-tag slot re-weighting (multiplies the act slot weights within the act's set). */
  byTag: Record<string, TagSlotBias>;
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
 * The drop table for `act` — PURE, RNG-free. Acts > 5 reuse Act 5's table; Act < 1 clamps
 * to Act 1.
 *
 * FOUND WHILE READING (in no register row): this clamped to **4**, so `dropTables.json`'s
 * authored `perAct."5"` curve — the richest one, Legendary weight 5 — was DEAD DATA and
 * floor 5 quietly fought on act 4's table. That was harmless while floor 5 had no
 * encounters at all; #0a's G43 fix made floor 5 playable, so the authored curve is now
 * silently unused. One character. Flagged to PLAN.md #2 as a balance delta.
 */
export function getDropTable(act: number): DropTable {
  const key = String(Math.min(Math.max(act, 1), 5));
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

/**
 * Build the ordered slot weight entries for `weightedPick` (skips zero/absent weights).
 * With a `bias` map each act weight is multiplied by the tag's per-slot multiplier (default
 * x1). The filter is on the ACT weight, so the bias only re-weights slots the act already
 * allows — it never adds nor removes a slot. With `bias` undefined every slot is x1, so the
 * entries are byte-identical to the tag-free call (off-equivalence).
 */
function slotEntries(
  weights: Partial<Record<EquipSlot, number>>,
  bias?: TagSlotBias,
): (readonly [EquipSlot, number])[] {
  return SLOT_ORDER.filter((s) => (weights[s] ?? 0) > 0).map(
    (s) => [s, (weights[s] as number) * (bias?.[s] ?? 1)] as const,
  );
}

// ---------------------------------------------------------------------------------------
// The authored-catalog branch (G14)
// ---------------------------------------------------------------------------------------

/** Canonical pool order — fixes the `weightedPick` entry order deterministically. */
const CATALOG_POOL_ORDER: readonly CatalogPool[] = ['heal', 'utility', 'unique'];

/**
 * True when a def's `use` script contains a direct self-heal. This is the ONE definition of
 * "a healing item" on the drop path; `regen-salve` (which applies the `regeneration`
 * condition rather than healing outright) is deliberately NOT in it, so the `heal` pool
 * weight means what it says.
 */
function healsSelf(def: ItemDef): boolean {
  return (def.use ?? []).some((action) => action.kind === 'healSelf');
}

/**
 * The ids in one catalog pool at `act` — PURE, RNG-free, DERIVED from the shipped catalogs
 * in file order (already deterministic). Adding a consumable to `consumables.json` puts it
 * in the pool with no edit here (principle #3).
 *
 * `unique` is act-GATED by each unique's authored `floor` (§14.8: "a rare drop from
 * anything"), which also means the pool is EMPTY at act 1 — the four uniques are floors
 * 2..5 — and that is the right feel as well as the right rule: no orange drops on floor 1.
 */
function poolIds(pool: CatalogPool, act: number): string[] {
  switch (pool) {
    case 'heal':
      return getAllConsumables().filter(healsSelf).map((d) => d.id);
    case 'utility':
      return getAllConsumables().filter((d) => !healsSelf(d)).map((d) => d.id);
    case 'unique':
      return getAllUniques().filter((d) => (d.floor ?? 1) <= act).map((d) => d.id);
  }
}

/**
 * The weighted, NON-EMPTY catalog pool entries for `weightedPick` at `act` — PURE, RNG-FREE.
 * An empty pool is dropped from the entry list BEFORE any draw is taken, so emptiness never
 * costs an RNG value and never leaves `weightedPick` able to return a pool with nothing in
 * it. Returns `[]` for a table with no `catalog` block, which is what makes the whole branch
 * cost zero draws when it is off.
 */
function catalogEntries(
  catalog: CatalogDrops | undefined,
  act: number,
): (readonly [string[], number])[] {
  if (!catalog) return [];
  const entries: (readonly [string[], number])[] = [];
  for (const pool of CATALOG_POOL_ORDER) {
    const weight = catalog.poolWeights[pool] ?? 0;
    if (weight <= 0) continue;
    const ids = poolIds(pool, act);
    if (ids.length === 0) continue;
    entries.push([ids, weight] as const);
  }
  return entries;
}

/**
 * Draw one authored catalog item from pre-filtered, non-empty `entries` — exactly TWO draws
 * (pool, then index), matching `generateItem`'s two so the two branches leave the RNG stream
 * in the same place. Returns a BARE `{ defId }` instance — the same plain shape starting
 * gear already uses, with no `rolled` overlay, so it saves and equips like anything else.
 */
function drawCatalogItem(entries: (readonly [string[], number])[], rng: Rng): ItemInstance {
  // Both fallbacks are unreachable: `catalogEntries` yields only non-empty pools and the
  // caller only enters here with `entries.length > 0`. They exist for noUncheckedIndexedAccess.
  const ids = weightedPick(rng, entries) ?? entries[0]![0];
  const defId = ids[randInt(rng, ids.length)] ?? ids[0]!;
  return { defId };
}

/**
 * The shared per-item tail: (2) rarity, (3) slot, (4) the catalog gate, then either the
 * catalog's two draws or `generateItem`'s two. The victory drop and the chest BOTH go
 * through this, so the two paths cannot drift apart on draw order.
 */
function rollOneItem(
  table: {
    rarityWeights: Partial<Record<Rarity, number>>;
    slotWeights: Partial<Record<EquipSlot, number>>;
    catalog?: CatalogDrops;
  },
  act: number,
  rng: Rng,
  bias: TagSlotBias | undefined,
  where: string,
): ItemInstance {
  const rarity = weightedPick(rng, rarityEntries(table.rarityWeights));
  if (!rarity) throw new Error(`${where}: empty rarity table`);
  const slot = weightedPick(rng, slotEntries(table.slotWeights, bias));
  if (!slot) throw new Error(`${where}: empty slot table`);
  // (4) The catalog gate. `catalogEntries` is RNG-free and short-circuits the `&&`, so a
  // table with no `catalog` block — or one whose pools are all empty at this act — takes
  // ZERO extra draws and is byte-identical to the pre-G14 roll.
  const entries = catalogEntries(table.catalog, act);
  if (entries.length > 0 && rng() < (table.catalog as CatalogDrops).chance) {
    return drawCatalogItem(entries, rng);
  }
  return generateItem(rng, { slot, rarity });
}

/**
 * Roll one drop from an EXPLICIT table — PURE, seeded. Exported so the off-equivalence claim
 * ("a table with no `catalog` block consumes the identical draws it always did") can be
 * PROVED against a catalog-free table rather than merely asserted about the shipped one.
 * `rollLootDrop` is this applied to `getDropTable(act)`.
 */
export function rollDropFromTable(
  table: DropTable,
  act: number,
  rng: Rng,
  bias?: TagSlotBias,
): ItemInstance | null {
  // (1) drop gate.
  if (!(rng() < table.dropChance)) return null;
  return rollOneItem(table, act, rng, bias, `rollLootDrop(act ${act})`);
}

/**
 * Roll one loot drop for a victory in the given Act — PURE, seeded. Draw order is the module
 * header's `rollLootDrop` order. On a failed drop gate returns `null` (exactly one draw
 * consumed), so a caller's RNG stream advances by a single step whether or not loot drops.
 * A GEAR drop's stat (for a ring/amulet) defaults to STR — no extra draw is spent (see
 * DEVIATION note in loot.test.ts: the design's separate stat-pick draw is omitted so the
 * loot stream stays at the documented draw count).
 *
 * `tag` (optional) is the felling enemy's broad family tag. When present in `byTag` it biases
 * the slot draw within the act's own slot set (see the module header's FAMILY-AWARE LOOT note);
 * absent/unknown ⇒ byte-identical to the tag-free roll, so family-less (legacy/boss) enemies
 * and the chest path are unchanged.
 */
export function rollLootDrop(act: number, rng: Rng, tag?: string): ItemInstance | null {
  const bias = tag ? TABLES.byTag[tag] : undefined;
  return rollDropFromTable(getDropTable(act), act, rng, bias);
}

/**
 * Roll the contents of a chest/cache — PURE, seeded. Yields exactly `chestItemCount`
 * guaranteed items (no drop gate), each through the shared `rollOneItem` tail. Returned in
 * roll order.
 *
 * `act` is new (G14): the chest's `unique` pool is act-gated by each unique's `floor`, exactly
 * as the victory path is, so a floor-5 unique cannot fall out of a floor-1 cache.
 */
export function rollChestLoot(rng: Rng, act: number): ItemInstance[] {
  const table = getChestTable();
  const items: ItemInstance[] = [];
  for (let i = 0; i < table.chestItemCount; i++) {
    items.push(rollOneItem(table, act, rng, undefined, 'rollChestLoot'));
  }
  return items;
}

/** A one-line, serializable summary of a dropped item (for the `victory`/`chest-loot` events). */
export interface LootSummary {
  defId: string;
  name: string;
  rarity: Rarity;
}

/**
 * Summarize a dropped item for an event stream — PURE. Generated gear reads its `rolled`
 * overlay; an authored CATALOG drop has no overlay, so it resolves through the catalogs.
 *
 * PRECONDITION OF G14, not an extra: this was `rolled?.name ?? instance.defId`, so the first
 * catalog drop would have made the victory line read "You scavenge void-draught." — a raw id
 * in the most-read sentence in the game. Only an id that resolves in NO catalog falls back to
 * itself, which nothing on the drop path can produce.
 */
export function summarizeLoot(instance: ItemInstance): LootSummary {
  const rolled = instance.rolled;
  if (rolled) return { defId: instance.defId, name: rolled.name, rarity: rolled.rarity };
  const def = getCatalogItemById(instance.defId);
  return {
    defId: instance.defId,
    name: def?.name ?? instance.defId,
    rarity: def?.rarity ?? 'Common',
  };
}
