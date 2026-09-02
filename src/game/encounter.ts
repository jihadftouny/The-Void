// Random encounters for The Void — pure, framework-agnostic game logic (M7).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports; nothing printed.
//    `buildRandomBattle` returns a fresh BattleState and never mutates its input.
//  - Deterministic seeded RNG: every decision (encounter type, enemy-type pick,
//    lore pick, rest heal) threads the injected `Rng`; no Math.random / Date.now.
//  - Data-driven content: lore is read by Act from the M2 lore loader; the enemy
//    pool is the M8 per-floor family roster (src/data/enemyFamilies.json) with
//    seeded elite affixes — adding content never edits this encounter code.
//
// Ported from `GameLogic.randomEncounter` / `randomBattle` / `takeRest` and
// `Lore.java`. Faithful draw order preserved for reproducibility.

import { pick, randInt, type Rng } from './rng.ts';
import { generateEnemy } from './enemy.ts';
import { availableFamiliesForAct } from './enemyFamily.ts';
import { rollAffix, applyAffix } from './enemyAffix.ts';
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
 * (guaranteed items, no drop gate). The chest still uses ONE richer rarity/slot table for
 * every act (per-Act chest tables are an M8/M10 data expansion); `act` is threaded through
 * only so the chest's authored-unique pool is floor-gated exactly as the victory drop's is
 * (G14). Draw order is documented in loot.ts.
 */
export function buildChestLoot(rng: Rng, act: number): ItemInstance[] {
  return rollChestLoot(rng, act);
}

/**
 * Build a random battle for the given Act — PURE. Opens the battle at advantage (Java
 * `randomBattle` sets `advantageDisadvantage = 1`; G12 makes it battle-scoped rather than a
 * write onto the player), then, in this fixed DRAW ORDER (for reproducibility):
 *   1. `pick` a family from `availableFamiliesForAct(act, available)` — 1 draw. The
 *      optional `available` id set is the M13 gradual-unlock seam (omitted = all of
 *      the act's families).
 *   2. `generateEnemy({ act, family, playerXp })` — its own internal draws.
 *   3. `rollAffix(rng, availableAffixes)` — a fixed 2 draws — then `applyAffix` (pure)
 *      when non-null, producing a seeded elite variant. `availableAffixes` is the M13
 *      gradual-unlock seam (omitted = all affixes).
 * Finally assembles the BattleState (`canFlee` false only in Act 5). A plain non-⚖
 * family with no affix behaves exactly like a pre-M8 enemy; only WHICH family/affix a
 * seed selects has changed. Omitting BOTH unlock sets (or passing full sets) is
 * byte-identical to today (off-equivalence) — the sets never add or reorder a draw.
 */
export function buildRandomBattle(
  player: Player,
  act: number,
  rng: Rng,
  available?: ReadonlySet<string>,
  availableAffixes?: ReadonlySet<string>,
): BattleState {
  const family = pick(rng, availableFamiliesForAct(act, available));
  let enemy = generateEnemy({ act, family, playerXp: player.xp }, rng);
  const affix = rollAffix(rng, availableAffixes);
  if (affix) enemy = applyAffix(enemy, affix);
  // G12: the ambush bonus is BATTLE-scoped, passed as an opening advantage, instead of being
  // stamped onto the player as `advantageDisadvantage: 1`. That stamp was persisted to the hub
  // player by `game.ts`, so every later fight — including every floor boss and the final
  // Hollow — inherited a +1 to hit it was never meant to have.
  return createBattle(player, enemy, act, { openingAdvantage: 1 });
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
