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

/** The result of trying to buy an offer. */
export type ShopOutcome = 'bought' | 'insufficient';

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
 * Apply a purchase — PURE. If the player has enough gold, swap the matching
 * equipped id and subtract exactly the price (`outcome: 'bought'`); otherwise the
 * player is returned unchanged (`outcome: 'insufficient'`). A decline is handled by
 * the caller (this is never called for a decline).
 */
export function applyShopPurchase(
  player: Player,
  offer: ShopOffer,
): { player: Player; outcome: ShopOutcome } {
  if (player.gold < offer.price) {
    return { player, outcome: 'insufficient' };
  }
  const gold = player.gold - offer.price;
  const equipped =
    offer.itemKind === 'armor'
      ? { equippedArmorId: offer.itemId }
      : { equippedWeaponId: offer.itemId };
  return { player: { ...player, gold, ...equipped }, outcome: 'bought' };
}
