// Random encounters for The Void — pure, framework-agnostic game logic (M7).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports; nothing printed.
//    `buildRandomBattle` returns a fresh BattleState and never mutates its input.
//  - Deterministic seeded RNG: every decision (encounter type, enemy-type pick, the floor-2
//    illusion roll, rest heal) threads the injected `Rng`; no Math.random / Date.now.
//  - Data-driven content: the per-floor encounter weights are `src/data/floors.json`
//    (PLAN.md #2); the enemy pool is the M8 per-floor family roster
//    (src/data/enemyFamilies.json) with seeded elite affixes — adding content never edits
//    this encounter code. (The old `lore.json` pick is gone: a rest now narrates the floor's
//    rest brief, `restBrief.ts`.)
//
// Ported from `GameLogic.randomEncounter` / `randomBattle` / `takeRest` and
// `Lore.java`. Faithful draw order preserved for reproducibility.

import { pick, randInt, weightedPick, type Rng } from './rng.ts';
import { generateEnemy } from './enemy.ts';
import { availableFamiliesForAct } from './enemyFamily.ts';
import { rollAffix, applyAffix } from './enemyAffix.ts';
import { createBattle, type BattleState } from './battle.ts';
import { type Player } from './player.ts';
import { rollChestLoot } from './loot.ts';
import { type ItemInstance } from './item.ts';
import {
  floorDef,
  floorModifiers,
  FLOOR_ENCOUNTERS,
  type FloorEncounter,
  type FloorId,
} from './floors.ts';

/**
 * The kinds of encounter the descent can present. PLAN.md #2: `bargain` joins them — bargains
 * FIND the player as descent events (GAME-DESIGN §22.23, §22.25: several per floor), and the
 * on-demand bargain hub action is gone.
 */
export type EncounterType = FloorEncounter;

/**
 * Pick the next encounter for the floor via ONE rng draw — `weightedPick` over that floor's
 * `floors.json` weights, walked in the fixed `FLOOR_ENCOUNTERS` order (battle, chest, rest,
 * bargain). One draw, exactly as the old fixed 6-slot table took, so the draw COUNT of an
 * encounter step is unchanged; which type a value lands on now follows the floor's weights.
 * Keyed on the floor the caller passes (`floorOf(state)`), never on the act.
 */
export function selectEncounter(rng: Rng, floor: FloorId): EncounterType {
  const weights = floorDef(floor).encounters;
  return (
    weightedPick(
      rng,
      FLOOR_ENCOUNTERS.map((kind) => [kind, weights[kind]] as const),
    ) ?? 'battle'
  );
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
  floor?: FloorId,
): BattleState {
  const family = pick(rng, availableFamiliesForAct(act, available));
  let enemy = generateEnemy({ act, family, playerXp: player.xp }, rng);
  const affix = rollAffix(rng, availableAffixes);
  if (affix) enemy = applyAffix(enemy, affix);
  // PLAN.md #2, floor 2 (§22.24: "about one fight in three"): ONE draw, LAST, and only on a floor
  // whose data carries an `illusionChance` — `randInt(rng, denominator) < numerator`. Last, so
  // every other floor keeps its exact pre-#2 draw order; `floor` omitted (every pre-#2 caller)
  // draws nothing. Keyed on the floor the caller passes (`floorOf(state)`), never on `act`.
  const chance = floor === undefined ? null : floorModifiers(floor).illusionChance;
  if (chance && randInt(rng, chance.denominator) < chance.numerator) {
    enemy = { ...enemy, illusory: true };
  }
  // G12: the ambush bonus is BATTLE-scoped, passed as an opening advantage, instead of being
  // stamped onto the player as `advantageDisadvantage: 1`. That stamp was persisted to the hub
  // player by `game.ts`, so every later fight — including every floor boss and the final
  // Hollow — inherited a +1 to hit it was never meant to have.
  return createBattle(player, enemy, act, { openingAdvantage: 1 });
}

/**
 * The HP a rest restores — PURE, one draw. Java `takeRest`:
 *   hpRestored = floor(random * (floor(xp/4) + 1)) + 10 = randInt(rng, floor(xp/4)+1) + 10,
 * i.e. an integer in `[10, 10 + floor(xp/4)]`. The caller caps it at maxHp.
 */
export function computeRestHeal(xp: number, rng: Rng): number {
  return randInt(rng, Math.floor(xp / 4) + 1) + 10;
}
