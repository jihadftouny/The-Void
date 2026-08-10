// The mysterious-stranger shop for The Void — pure, framework-agnostic logic (M7).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports; nothing printed.
//    `applyShopPurchase` returns a new Player and never mutates its input.
//  - Deterministic seeded RNG: item-type, item, and price all thread the injected
//    `Rng`; no Math.random / Date.now.
//  - Data-driven content: offered items come from the M2 weapon/armor tables by Act;
//    only the rarity weights and price formula (rules) live here.
//
// Ported from `GameLogic.shop` / `pickItemShop`. Rarity weights Common 5 / Rare 3 /
// Legendary 1 are Java's expand-by-weight list; we select via `weightedPick` (same
// distribution, one draw). Price simplifies Java's arithmetic to `5*act + rand[0,10*act]`.

import { randInt, weightedPick, type Rng } from './rng.ts';
import { getWeaponsForAct } from './weapon.ts';
import { getArmorForAct } from './armor.ts';
import type { Rarity } from './weapon.ts';
import { type Player } from './player.ts';
import { equip, pickUp } from './equipment.ts';
import { type EquipSlot } from './item.ts';

/** Shop rarity weights (Java `pickItemShop`): commoner items appear more often. */
export const RARITY_WEIGHT: Readonly<Record<Rarity, number>> = {
  Common: 5,
  Rare: 3,
  Legendary: 1,
};

/** An offer the stranger makes: one item (weapon or armor) at a price. */
export interface ShopOffer {
  itemKind: 'armor' | 'weapon';
  itemId: string;
  itemName: string;
  price: number;
}

/**
 * The result of trying to take an offer. M7 (gold removal): with gold gone the trade
 * always succeeds — the stranger hands the item over. This whole module is INTERIM
 * scaffolding kept only so Stages 1-3 stay green; Stage 4 deletes it and replaces the
 * shop with the sacrifice-deal encounter (`deal.ts`).
 */
export type ShopOutcome = 'bought';

/**
 * The price of a shop offer in the given Act — PURE, one draw. Java:
 *   price = floor(random * (10*act + 1)) + 5*act = 5*act + randInt(rng, 10*act + 1),
 * an integer in `[5*act, 15*act]`.
 */
export function shopPrice(act: number, rng: Rng): number {
  return 5 * act + randInt(rng, 10 * act + 1);
}

/**
 * Build a shop offer for the given Act — PURE. Draw order (faithful to Java):
 *  1. item type: `randInt(rng, 2)` — 0 armor, 1 weapon;
 *  2. item: rarity-weighted pick from the Act's table (Acts >4 reuse Act 4's table);
 *  3. price: `shopPrice(act, rng)`.
 */
export function buildShopOffer(act: number, rng: Rng): ShopOffer {
  const itemType = randInt(rng, 2);
  const sourceAct = Math.min(act, 4);

  if (itemType === 0) {
    const armors = getArmorForAct(sourceAct) ?? [];
    const picked = weightedPick(
      rng,
      armors.map((a) => [a, RARITY_WEIGHT[a.rarity]] as const),
    );
    if (!picked) throw new Error(`buildShopOffer: no armor for act ${sourceAct}`);
    const price = shopPrice(act, rng);
    return { itemKind: 'armor', itemId: picked.name, itemName: picked.name, price };
  }

  const weapons = getWeaponsForAct(sourceAct) ?? [];
  const picked = weightedPick(
    rng,
    weapons.map((w) => [w, RARITY_WEIGHT[w.rarity]] as const),
  );
  if (!picked) throw new Error(`buildShopOffer: no weapon for act ${sourceAct}`);
  const price = shopPrice(act, rng);
  return { itemKind: 'weapon', itemId: picked.name, itemName: picked.name, price };
}

/**
 * Apply a purchase — PURE. M7 (gold removal): the trade always succeeds. Equip the offered
 * item into its paperdoll slot (`armor -> armor`, `weapon -> mainHand`); the item it
 * DISPLACES from the slot moves to the backpack (via the equipment bridge) instead of being
 * discarded. `outcome` is always `'bought'`. A decline is handled by the caller. Interim
 * scaffolding — Stage 4 replaces the shop with the sacrifice-deal encounter.
 */
export function applyShopPurchase(
  player: Player,
  offer: ShopOffer,
): { player: Player; outcome: ShopOutcome } {
  const slot: EquipSlot = offer.itemKind === 'armor' ? 'armor' : 'mainHand';
  const withItem = pickUp(player.inventory, { defId: offer.itemId });
  const { inventory } = equip(withItem, withItem.backpack.length - 1, slot);
  return { player: { ...player, inventory }, outcome: 'bought' };
}
