// Random encounters for The Void — pure, framework-agnostic game logic (M7).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports; nothing printed.
//    `buildRandomBattle` returns a fresh BattleState and never mutates its input.
//  - Deterministic seeded RNG: every decision (encounter type, enemy-type pick,
//    lore pick, rest heal) threads the injected `Rng`; no Math.random / Date.now.
//  - Data-driven content: lore is read by Act from the M2 lore loader; the enemy
//    pool is a data table (all-Beast for now, matching Java's 5x"Beast").
//
// Ported from `GameLogic.randomEncounter` / `randomBattle` / `takeRest` and
// `Lore.java`. Faithful draw order preserved for reproducibility.

import { pick, randInt, type Rng } from './rng.ts';
import { generateEnemy } from './enemy.ts';
import { createBattle, type BattleState } from './battle.ts';
import { getLore, type LoreEntry } from './lore.ts';
import { type Player } from './player.ts';
import { rollChestLoot } from './loot.ts';
import { type ItemInstance } from './item.ts';

/** The kinds of encounter the descent can present. */
export type EncounterType = 'battle' | 'rest' | 'chest';

/**
 * The weighted 6-slot encounter table (M7): 3 Battle : 2 Rest : 1 Chest — the chest/cache is
 * a 1/6 slot layered onto the Java 3:2 Battle:Rest split. The chest weight is an M15 balance
 * placeholder (part of the ~50/50 found-loot vs sacrifice-deal split).
 */
export const ENCOUNTER_TABLE: readonly EncounterType[] = [
  'battle',
  'battle',
  'battle',
  'rest',
  'rest',
  'chest',
];

/**
 * Per-Act enemy type pool. All Beast for now, faithfully mirroring Java's
 * `enemies = {"Beast","Beast","Beast","Beast","Beast"}` (a single type). Later
 * content expansion happens here, in data, without touching combat code.
 */
export const ENEMY_POOL_BY_ACT: Readonly<Record<number, readonly string[]>> = {
  1: ['Beast'],
  2: ['Beast'],
  3: ['Beast'],
  4: ['Beast'],
  5: ['Beast'],
};

/**
 * Pick the next encounter type via one rng draw: `randInt(rng, 6)` indexes the 6-slot table
 * `[B,B,B,R,R,C]`, so draws in [0,0.5) yield 'battle', [0.5,0.8333) yield 'rest', and
 * [0.8333,1) yield 'chest' — a 3:2:1 split.
 */
export function selectEncounter(rng: Rng): EncounterType {
  const index = randInt(rng, ENCOUNTER_TABLE.length);
  return ENCOUNTER_TABLE[index] ?? 'battle';
}

/**
 * Build the loot a chest/cache yields — PURE, seeded. Delegates to `loot.rollChestLoot`
 * (guaranteed items, no drop gate). Chests are act-agnostic for now (a single richer table);
 * per-Act chest tables are an M8/M10 data expansion. Draw order is documented in loot.ts.
 */
export function buildChestLoot(rng: Rng): ItemInstance[] {
  return rollChestLoot(rng);
}

/**
 * Build a random battle for the given Act — PURE. Grants the player advantage
 * (Java `randomBattle` sets `advantageDisadvantage = 1`), draws once to pick the
 * enemy type from the Act pool, generates a per-Act enemy scaled by player xp,
 * then assembles the BattleState (`canFlee` false only in Act 5). Draw order
 * (type-pick, then enemy generation) mirrors Java for reproducibility.
 */
export function buildRandomBattle(player: Player, act: number, rng: Rng): BattleState {
  const readiedPlayer: Player = { ...player, advantageDisadvantage: 1 };
  const pool = ENEMY_POOL_BY_ACT[act] ?? ['Beast'];
  const type = pick(rng, pool);
  const enemy = generateEnemy({ act, type, playerXp: player.xp }, rng);
  return createBattle(readiedPlayer, enemy, act);
}

/**
 * Pick a lore entry for a rest in the given Act — PURE. Draws `randInt(rng, n)`
 * where `n = min(selectableCount, entries.length)`. Faithful to Java `Lore`: Act 1
 * uses `nextInt(3)` (all three entries reachable) while Acts 2-4 use `nextInt(2)`
 * (their third entry is never selectable). Returns undefined for an Act with no lore.
 */
export function selectLore(act: number, rng: Rng): LoreEntry | undefined {
  const lore = getLore(act);
  if (!lore || lore.entries.length === 0) return undefined;
  const count = Math.min(lore.selectableCount, lore.entries.length);
  const index = randInt(rng, count);
  return lore.entries[index];
}

/**
 * The HP a rest restores — PURE, one draw. Java `takeRest`:
 *   hpRestored = floor(random * (floor(xp/4) + 1)) + 10 = randInt(rng, floor(xp/4)+1) + 10,
 * i.e. an integer in `[10, 10 + floor(xp/4)]`. The caller caps it at maxHp.
 */
export function computeRestHeal(xp: number, rng: Rng): number {
  return randInt(rng, Math.floor(xp / 4) + 1) + 10;
}
