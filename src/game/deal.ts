// The sacrifice-deal encounter for The Void — pure, framework-agnostic game logic (M7).
//
// Replaces the gold shop (shop.ts, deleted). An altar / shrouded stranger offers a REWARD in
// exchange for a COST paid FROM THE PLAYER — HP, max-HP, a stat point, a skill charge, a relic,
// or a karma-shifting ACT (desecrate a shrine / loot greedily). Take-or-leave.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay/DOM/canvas; nothing printed. `applyDeal` returns a
//    new Player + Karma and never mutates its inputs.
//  - Deterministic seeded RNG: `buildDeal` threads the injected `Rng` in a FIXED, documented
//    order; `applyDeal` is RNG-FREE (the reward item was rolled at build time). No Math.random.
//  - Data-driven content: the deal templates live in `../data/deals.json`, grouped by pool.
//    Adding deals edits DATA, not this logic.
//  - Serializable plain-data state: every cost/reward/deal is a flat plain-data record.
//
// KARMA (M7 scope): a karma-shifting COST calls the REAL `recordKarma` — a genuine karma INPUT
// (desecrateShrine / lootGreedily). `selectPool` READS the karma vector to flavor the offer.
// No karma EFFECT on world/tone/gate/ending is added here (deferred to M10/M14). Every magnitude
// / threshold is an M15 balance placeholder.
//
// DOCUMENTED DRAW ORDER (load-bearing for tests), buildDeal:
//   (1) template pick from the selected pool's list (`pick`, one draw).
//   (2) IF the template reward is a rolled item -> generateItem's two draws (magnitude, proc);
//       a fixed-relic / heal / stat / charge reward draws NOTHING further.

import { type StatKey, computeStatMods } from './character.ts';
import { type Player } from './player.ts';
import { type EquipSlot, type ItemInstance, getAllRelics } from './item.ts';
import { type Rarity } from './weapon.ts';
import { generateItem } from './rarityGen.ts';
import { pick, type Rng } from './rng.ts';
import { type KarmaState, recordKarma } from './karma.ts';
import { pickUp } from './equipment.ts';
import dealsData from '../data/deals.json';

/** Which offer pool the altar draws from, chosen by karma (see `selectPool`). */
export type Pool = 'standard' | 'tempting' | 'grace';

/** What the deal takes FROM the player. */
export type DealCost =
  | { kind: 'hp'; amount: number }
  | { kind: 'maxHp'; amount: number }
  | { kind: 'statPoint'; stat: StatKey }
  | { kind: 'skillCharge'; amount: number }
  | { kind: 'relic' }
  | { kind: 'desecrate' }
  | { kind: 'greed' };

/** What the deal GIVES the player (the reward item is rolled at build time). */
export type DealReward =
  | { kind: 'item'; instance: ItemInstance }
  | { kind: 'heal'; amount: number }
  | { kind: 'statPoint'; stat: StatKey }
  | { kind: 'skillCharge'; amount: number };

/** A concrete offer: a pool tag, a cost, and a (fully-rolled) reward. Plain data. */
export interface SacrificeDeal {
  pool: Pool;
  cost: DealCost;
  reward: DealReward;
}

// ------- Data template shapes (deals.json) -----------------------------------

/** A reward as authored in data — an item to ROLL, a fixed relic, or a flat effect. */
type DealRewardSpec =
  | { kind: 'itemRoll'; slot: EquipSlot; rarity: Rarity }
  | { kind: 'item'; defId: string }
  | { kind: 'heal'; amount: number }
  | { kind: 'statPoint'; stat: StatKey }
  | { kind: 'skillCharge'; amount: number };

interface DealTemplate {
  cost: DealCost;
  reward: DealRewardSpec;
}

const TEMPLATES = dealsData as unknown as Record<Pool, readonly DealTemplate[]>;

// ------- Karma-read thresholds (M15 placeholders) ----------------------------

const REVERENCE_TH = 3;
const GREED_TH = 3;
const DESECRATION_TH = 3;

/** The karma actions a karma-shifting cost records (data-driven via KARMA_DELTAS). */
const KARMA_COST_ACTION = {
  desecrate: 'desecrateShrine',
  greed: 'lootGreedily',
} as const;

/**
 * Choose the offer pool from the karma vector — PURE, DETERMINISTIC, NO rng draw. A reverent
 * run (`reverenceDesecration >= REVERENCE_TH`) is offered `grace`; a greedy/profane run
 * (`restraintGreed <= -GREED_TH` OR `reverenceDesecration <= -DESECRATION_TH`) is tempted with
 * `tempting`; everyone else gets `standard`. This is the karma READ (thresholds are M15
 * placeholders); it adds no karma EFFECT.
 */
export function selectPool(karma: KarmaState): Pool {
  if (karma.reverenceDesecration >= REVERENCE_TH) return 'grace';
  if (karma.restraintGreed <= -GREED_TH || karma.reverenceDesecration <= -DESECRATION_TH) {
    return 'tempting';
  }
  return 'standard';
}

/** Realize a data reward spec into a runtime `DealReward`, rolling an item when needed. */
function realizeReward(spec: DealRewardSpec, rng: Rng): DealReward {
  switch (spec.kind) {
    case 'itemRoll':
      // generateItem's two draws (magnitude, proc) — the ONLY further draws buildDeal takes.
      return { kind: 'item', instance: generateItem(rng, { slot: spec.slot, rarity: spec.rarity }) };
    case 'item':
      return { kind: 'item', instance: { defId: spec.defId } };
    case 'heal':
      return { kind: 'heal', amount: spec.amount };
    case 'statPoint':
      return { kind: 'statPoint', stat: spec.stat };
    case 'skillCharge':
      return { kind: 'skillCharge', amount: spec.amount };
  }
}

/**
 * Build a sacrifice deal — PURE, seeded. Reads `karma` (via `selectPool`) to pick the pool,
 * then draws in the documented order. `act` is currently unused by the placeholder tables but
 * kept for the M8/M10 per-Act deal expansion. Never mutates karma.
 */
export function buildDeal(karma: KarmaState, _act: number, rng: Rng): SacrificeDeal {
  const pool = selectPool(karma);
  const templates = TEMPLATES[pool];
  if (!templates || templates.length === 0) throw new Error(`buildDeal: empty pool ${pool}`);
  const template = pick(rng, templates);
  const reward = realizeReward(template.reward, rng);
  return { pool, cost: template.cost, reward };
}

// ------- Affordability + application -----------------------------------------

const RELIC_IDS: ReadonlySet<string> = new Set(getAllRelics().map((r) => r.id));

/** The backpack index of the first relic instance, or -1 if the player holds none. */
function firstRelicIndex(player: Player): number {
  return player.inventory.backpack.findIndex((i) => RELIC_IDS.has(i.defId));
}

/**
 * The floor every stat is held at. A stat cost is otherwise unbounded — nothing stops a run of
 * `statPoint` deals walking an attribute to 0 and below, which would invert its modifier and,
 * for CON, its derived numbers. 1 mirrors the D&D floor and the `Math.max(..., 1)` that
 * `classKit.ts` already applies to max HP. M15 balance placeholder.
 */
const MIN_STAT = 1;

/**
 * Can the player pay `cost`? — PURE. An HP cost must leave the player alive (`amount < hp`); a
 * MAX-HP cost must leave a living body behind (`amount < maxHp`); a relic cost needs a relic in
 * the backpack; every other cost is always affordable.
 *
 * G20: the `maxHp` case used to fall through to `return true`, and `applyDeal` subtracted with
 * NO floor — unlike every other max-HP sink in the engine. Verified: `deals.json`'s `tempting`
 * pool carries a `maxHp: 6` cost, so a player at `maxHp: 5, hp: 5` could afford it and came out
 * at `maxHp: -1, hp: -1`. They then walked to the hub at -1 HP and died on round 1 without
 * acting, with potions refused (`hp < cap` but the heal caps at a negative max) and a revive
 * healing to 1.
 */
export function canAfford(player: Player, cost: DealCost): boolean {
  switch (cost.kind) {
    case 'hp':
      return cost.amount < player.hp;
    case 'maxHp':
      return cost.amount < player.maxHp;
    case 'relic':
      return firstRelicIndex(player) >= 0;
    default:
      return true;
  }
}

/**
 * Recompute the derived stat mods after a stat change (maxHp/AC deliberately NOT re-derived).
 * G20: the stat is floored at `MIN_STAT`, so the unbounded `statPoint` cost cannot walk an
 * attribute to zero or below.
 */
function withStat(player: Player, stat: StatKey, delta: number): Player {
  const stats = { ...player.stats, [stat]: Math.max(player.stats[stat] + delta, MIN_STAT) };
  return { ...player, stats, mods: computeStatMods(stats) };
}

/**
 * Apply a deal the player accepted — PURE, RNG-FREE. Pays the cost, then grants the reward;
 * returns the new player + karma and an outcome. When the cost is unaffordable NOTHING changes
 * (`outcome: 'unaffordable'`).
 *
 * POLICY (matches level-up): a stat cost/reward recomputes `mods` only — maxHp/AC are NOT
 * retroactively re-derived (M15 placeholder, documented). A karma-shifting cost (desecrate /
 * greed) records the real karma action and pays no HP/stat; every other cost returns karma
 * unchanged. A max-HP cost clamps hp down to the new max; a heal caps at (the possibly-reduced)
 * maxHp; a skill-charge reward caps at maxSkillCharges.
 */
export function applyDeal(
  player: Player,
  karma: KarmaState,
  deal: SacrificeDeal,
): { player: Player; karma: KarmaState; outcome: 'taken' | 'unaffordable' } {
  if (!canAfford(player, deal.cost)) {
    return { player, karma, outcome: 'unaffordable' };
  }

  let next = player;
  let nextKarma = karma;

  // --- pay the cost ---
  switch (deal.cost.kind) {
    case 'hp':
      next = { ...next, hp: next.hp - deal.cost.amount };
      break;
    case 'maxHp': {
      // G20: floored at 1, matching `classKit.ts`'s `maxHpCost` sink, with `hp` clamped to the
      // new max and likewise floored — a deal must never leave a body that cannot act.
      const maxHp = Math.max(next.maxHp - deal.cost.amount, 1);
      next = { ...next, maxHp, hp: Math.max(Math.min(next.hp, maxHp), 1) };
      break;
    }
    case 'statPoint':
      next = withStat(next, deal.cost.stat, -1);
      break;
    case 'skillCharge':
      next = { ...next, skillCharges: Math.max(next.skillCharges - deal.cost.amount, 0) };
      break;
    case 'relic': {
      const idx = firstRelicIndex(next);
      const backpack = next.inventory.backpack.filter((_, i) => i !== idx);
      next = { ...next, inventory: { slots: { ...next.inventory.slots }, backpack } };
      break;
    }
    case 'desecrate':
      nextKarma = recordKarma(nextKarma, KARMA_COST_ACTION.desecrate);
      break;
    case 'greed':
      nextKarma = recordKarma(nextKarma, KARMA_COST_ACTION.greed);
      break;
  }

  // --- grant the reward ---
  switch (deal.reward.kind) {
    case 'item':
      next = { ...next, inventory: pickUp(next.inventory, deal.reward.instance) };
      break;
    case 'heal':
      next = { ...next, hp: Math.min(next.hp + deal.reward.amount, next.maxHp) };
      break;
    case 'statPoint':
      next = withStat(next, deal.reward.stat, 1);
      break;
    case 'skillCharge':
      next = {
        ...next,
        skillCharges: Math.min(next.skillCharges + deal.reward.amount, next.maxSkillCharges),
      };
      break;
  }

  return { player: next, karma: nextKarma, outcome: 'taken' };
}

/** A serializable one-line summary of a deal's cost, for the `deal-offer` event. */
export function describeCost(cost: DealCost): string {
  switch (cost.kind) {
    case 'hp':
      return `${cost.amount} HP`;
    case 'maxHp':
      return `${cost.amount} max HP`;
    case 'statPoint':
      return `1 ${cost.stat}`;
    case 'skillCharge':
      return `${cost.amount} skill charge${cost.amount === 1 ? '' : 's'}`;
    case 'relic':
      return `a relic`;
    case 'desecrate':
      return `your reverence (desecrate a shrine)`;
    case 'greed':
      return `your restraint (loot greedily)`;
  }
}

/** A serializable one-line summary of a deal's reward, for the `deal-offer` event. */
export function describeReward(reward: DealReward): string {
  switch (reward.kind) {
    case 'item':
      return reward.instance.rolled?.name ?? reward.instance.defId;
    case 'heal':
      return `${reward.amount} HP restored`;
    case 'statPoint':
      return `+1 ${reward.stat}`;
    case 'skillCharge':
      return `${reward.amount} skill charge${reward.amount === 1 ? '' : 's'}`;
  }
}
