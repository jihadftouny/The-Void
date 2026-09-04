// The sacrifice-deal encounter for The Void — pure, framework-agnostic game logic (M7).
//
// Replaces the gold shop (shop.ts, deleted). An altar / shrouded stranger offers a REWARD in
// exchange for a COST paid FROM THE PLAYER — HP, max-HP, a stat point, a skill charge, a relic,
// an OFFERING from the backpack, or a karma-shifting ACT (desecrate a shrine / loot greedily /
// heed a whisper). Take-or-leave.
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
// KARMA: a karma-shifting COST calls the REAL `recordKarma` — a genuine karma INPUT
// (desecrateShrine / lootGreedily / leaveOffering / embraceWhisper). `selectPool` READS the
// karma vector to flavor the offer. Every magnitude / threshold is a balance placeholder.
//
// #10a (2026-09-04) added the `offering` and `whisper` costs, which is what finally gives the
// four-axis vector inputs on more than one axis pair. Before them `reverenceDesecration` had a
// single wired input (`desecrateShrine`, -2), so the axis was ONE-DIRECTIONAL, the `grace` pool
// (`selectPool` needs reverence >= 3) could never open — taking `mirror-shard` with it — and
// `clarityDelusion` was permanently 0, so "The Delusion" could never be the act-3 Sin.
//
// KARMA STAYS HIDDEN (GAME-DESIGN §7 "no meter, no number, ever"). The line, made checkable:
// `describeCost`/`describeReward` may name what you DID; they may NEVER name the axis it moved.
// G53: `desecrate`/`greed` used to read "your reverence (…)" / "your restraint (…)" — axis poles
// stated to the player (via `dealView` -> the deal screen) AND to the model (via the `deal-offer`
// fact line in `narrate.ts`). Both are reworded below to name the ACT. `karmaActions.test.ts`
// asserts the rule UNIVERSALLY, with no grandfathered exceptions — an exception list is how a
// leak comes back.
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

/**
 * What the deal takes FROM the player.
 *
 * `offering` is a MATERIAL cost that also shifts karma: it gives up the first item in the
 * backpack. It costs a real, finite, non-regenerating resource on purpose — `seek-deal` is a
 * free, unlimited hub action, so a karma GAIN with no material price would be farmable to any
 * ledger the player liked. `whisper`, like `desecrate` and `greed`, costs karma alone.
 */
export type DealCost =
  | { kind: 'hp'; amount: number }
  | { kind: 'maxHp'; amount: number }
  | { kind: 'statPoint'; stat: StatKey }
  | { kind: 'skillCharge'; amount: number }
  | { kind: 'relic' }
  | { kind: 'offering' }
  | { kind: 'desecrate' }
  | { kind: 'greed' }
  | { kind: 'whisper' };

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

/**
 * The authored offer table, grouped by pool. APPEND-ONLY by convention: `buildDeal` picks with
 * `pick` (`items[floor(x*len)]`), so inserting a template renumbers every scripted-rng test.
 *
 * ⚠ #2 BALANCE PLACEHOLDERS — every number in `deals.json` is one, and the two templates #10a
 * appended are no exception. They set HOW CHEAPLY A RUN CAN BUY BACK REVERENCE, which matters
 * more than the other magnitudes now that §22.16 makes grace generous (`GATE_THRESHOLD` 1 over
 * integer deltas ⇒ ANY net-positive ledger earns it). #2 owns the real values:
 *
 *  - `offering` → `heal 6`. Costs the first backpack item; grants at most 6 HP, capped at maxHp.
 *    NOT farmable: each acceptance destroys one finite backpack item and the altar hands back no
 *    item, so the item count strictly falls and `canAfford` refuses on an empty backpack.
 *  - `whisper` → `heal 4`. Costs no material thing (only a point of delusion) and IS repeatable,
 *    exactly like the shipped `desecrate`/`greed` templates. Deliberately a HEAL and nothing
 *    else: `standard[0]` (cost 8 HP → heal 12, a net +4) already makes HP unbounded at the altar
 *    (**FINDINGS G52**), so a heal reward adds NO capability the altar does not already have. An
 *    `item` / `statPoint` / `skillCharge` reward would have made those unbounded from the hub for
 *    the first time — a NEW fountain — so none of them is used here.
 */
const TEMPLATES = dealsData as unknown as Record<Pool, readonly DealTemplate[]>;

// ------- Karma-read thresholds (M15 placeholders) ----------------------------

const REVERENCE_TH = 3;
const GREED_TH = 3;
const DESECRATION_TH = 3;

/** The karma actions a karma-shifting cost records (data-driven via KARMA_DELTAS). */
const KARMA_COST_ACTION = {
  desecrate: 'desecrateShrine',
  greed: 'lootGreedily',
  offering: 'leaveOffering',
  whisper: 'embraceWhisper',
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
 * the backpack; an OFFERING needs any item in the backpack; the purely-karmic costs are always
 * affordable.
 *
 * #10a: the `default: return true` arm is GONE. The switch is now exhaustive over `DealCost`, so
 * a future cost kind is a COMPILE ERROR here rather than a silently-free one. That arm is what
 * G20 fell through, and an `offering` falling through it would have handed out free reverence
 * forever (an empty backpack, `applyDeal`'s `slice(1)` a no-op, the karma still recorded).
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
    case 'offering':
      return player.inventory.backpack.length > 0;
    case 'statPoint':
    case 'skillCharge':
    case 'desecrate':
    case 'greed':
    case 'whisper':
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
 * retroactively re-derived (M15 placeholder, documented). A purely-karmic cost (desecrate /
 * greed / whisper) records the real karma action and pays no HP/stat; an `offering` records its
 * karma action AND gives up the first backpack item; every other cost returns karma unchanged.
 * A max-HP cost clamps hp down to the new max; a heal caps at (the possibly-reduced) maxHp; a
 * skill-charge reward caps at maxSkillCharges.
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
    case 'offering': {
      // The offering is the FIRST backpack item, removed — the material half of the cost —
      // and the karma is recorded in the SAME arm. Both halves or neither: a version that
      // recorded the karma without taking the item would be free reverence.
      const backpack = next.inventory.backpack.slice(1);
      next = { ...next, inventory: { slots: { ...next.inventory.slots }, backpack } };
      nextKarma = recordKarma(nextKarma, KARMA_COST_ACTION.offering);
      break;
    }
    case 'desecrate':
      nextKarma = recordKarma(nextKarma, KARMA_COST_ACTION.desecrate);
      break;
    case 'greed':
      nextKarma = recordKarma(nextKarma, KARMA_COST_ACTION.greed);
      break;
    case 'whisper':
      nextKarma = recordKarma(nextKarma, KARMA_COST_ACTION.whisper);
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

/**
 * A serializable one-line summary of a deal's cost, for the `deal-offer` event.
 *
 * G53 (fixed by #10a): the four karma-shifting costs name THE ACT, never the axis. The old
 * `desecrate`/`greed` strings — "your reverence (desecrate a shrine)", "your restraint (loot
 * greedily)" — stated an axis pole as a quantity the player possesses, and this string reaches
 * both the player (`dealView` -> the deal screen) and the model (the `deal-offer` fact line).
 * The verb `desecrate` is fine; it names what you do. The noun `desecration` is not; it names
 * the axis. Same class of engine-side voice break as G47.
 *
 * DEVIATION, recorded (plan §"Load-bearing principles"): the house style for these two was
 * `your <axis> (<act>)`. The hidden-karma rule (§7, CLAUDE.md constraint 5) outranks internal
 * consistency, so the two OLD strings were changed to match the new ones rather than the
 * reverse — otherwise the leak guard would have to be written around the exact defect it exists
 * to catch. Blast radius checked before the change: no test asserted either string.
 */
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
    case 'offering':
      return `an offering from your pack`;
    case 'desecrate':
      return `a shrine, broken open`;
    case 'greed':
      return `a cache, stripped bare`;
    case 'whisper':
      return `a whisper, heeded`;
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
