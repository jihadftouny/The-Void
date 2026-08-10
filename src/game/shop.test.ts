import { describe, expect, it } from 'vitest';
import {
  RARITY_WEIGHT,
  shopPrice,
  buildShopOffer,
  applyShopPurchase,
  type ShopOffer,
} from './shop.ts';
import { createPlayer } from './player.ts';
import { getWeaponByName } from './weapon.ts';
import { getArmorByName } from './armor.ts';
import { type Stats } from './character.ts';
import { mulberry32, type Rng } from './rng.ts';

function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

function player() {
  const stats: Stats = { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 };
  return createPlayer({ name: 'S', classId: 'Enforcer', stats });
}

function rarityOf(offer: ShopOffer): string | undefined {
  const item =
    offer.itemKind === 'armor'
      ? getArmorByName(offer.itemId)
      : getWeaponByName(offer.itemId);
  return item?.rarity;
}

describe('RARITY_WEIGHT', () => {
  it('is Common 5 / Rare 3 / Legendary 1', () => {
    expect(RARITY_WEIGHT).toEqual({ Common: 5, Rare: 3, Legendary: 1 });
  });
});

describe('shopPrice', () => {
  it('Act 1 spans [5,15]; Act 2 spans [10,30]', () => {
    // 5*act + randInt(rng, 10*act+1).
    expect(shopPrice(1, scriptedRng([0]))).toBe(5); // 5 + 0
    expect(shopPrice(1, scriptedRng([0.999]))).toBe(15); // 5 + floor(0.999*11)=5+10
    expect(shopPrice(2, scriptedRng([0]))).toBe(10); // 10 + 0
    expect(shopPrice(2, scriptedRng([0.999]))).toBe(30); // 10 + floor(0.999*21)=10+20
  });

  it('stays within [5*act, 15*act] over many seeds', () => {
    for (const act of [1, 2, 3, 4, 5]) {
      for (let seed = 0; seed < 300; seed++) {
        const p = shopPrice(act, mulberry32(seed));
        expect(p).toBeGreaterThanOrEqual(5 * act);
        expect(p).toBeLessThanOrEqual(15 * act);
      }
    }
  });
});

describe('buildShopOffer', () => {
  it('draws type, then item, then price (armor branch)', () => {
    // type=randInt(_,2): 0 -> armor. item: weightedPick over [C5,R3,L1], r=1+floor(0*9)=1
    // -> Common (Jooj Armor 1). price: shopPrice(1, 0) = 5.
    const offer = buildShopOffer(1, scriptedRng([0, 0, 0]));
    expect(offer).toEqual({
      itemKind: 'armor',
      itemId: 'Jooj Armor 1',
      itemName: 'Jooj Armor 1',
      price: 5,
    });
  });

  it('draws type, then item, then price (weapon branch)', () => {
    // type draw 0.9 -> floor(1.8)=1 -> weapon. item draw 0 -> Common (Jooj Gun 1).
    // price draw 0.999 at act 1 -> 15.
    const offer = buildShopOffer(1, scriptedRng([0.9, 0, 0.999]));
    expect(offer).toEqual({
      itemKind: 'weapon',
      itemId: 'Jooj Gun 1',
      itemName: 'Jooj Gun 1',
      price: 15,
    });
  });

  it('rarity picks are weighted ~5:3:1 and every rarity is reachable', () => {
    const N = 9000;
    let common = 0;
    let rare = 0;
    let legendary = 0;
    for (let seed = 0; seed < N; seed++) {
      const r = rarityOf(buildShopOffer(1, mulberry32(seed)));
      if (r === 'Common') common++;
      else if (r === 'Rare') rare++;
      else if (r === 'Legendary') legendary++;
    }
    const total = common + rare + legendary;
    expect(total).toBe(N); // every offer resolved to a known rarity
    // Weights 5:3:1 over sum 9 -> 0.556 / 0.333 / 0.111. Tolerance +/- ~0.04.
    expect(common / total).toBeGreaterThan(0.51);
    expect(common / total).toBeLessThan(0.6);
    expect(rare / total).toBeGreaterThan(0.29);
    expect(rare / total).toBeLessThan(0.38);
    expect(legendary / total).toBeGreaterThan(0.07);
    expect(legendary / total).toBeLessThan(0.15);
  });
});

describe('applyShopPurchase (M7: gold removed — the trade always succeeds)', () => {
  it('equips the item into mainHand and keeps the old weapon in the backpack', () => {
    const p = player(); // Enforcer weapon "Jaaj Sword 1" in mainHand
    const offer: ShopOffer = {
      itemKind: 'weapon',
      itemId: 'Jooj Gun 1',
      itemName: 'Jooj Gun 1',
      price: 12,
    };
    const { player: after, outcome } = applyShopPurchase(p, offer);
    expect(outcome).toBe('bought');
    expect(after.inventory.slots.mainHand).toEqual({ defId: 'Jooj Gun 1' });
    // The displaced starting weapon moves to the backpack (no longer discarded).
    expect(after.inventory.backpack).toEqual([{ defId: 'Jaaj Sword 1' }]);
    // Armor slot untouched.
    expect(after.inventory.slots.armor).toEqual(p.inventory.slots.armor);
    // No gold field exists on the player anymore.
    expect('gold' in after).toBe(false);
    // Purity: source unchanged.
    expect(p.inventory.slots.mainHand).toEqual({ defId: 'Jaaj Sword 1' });
    expect(p.inventory.backpack).toEqual([]);
  });

  it('equips armor into the armor slot for an armor offer', () => {
    const p = player();
    const offer: ShopOffer = {
      itemKind: 'armor',
      itemId: 'Jiij Armor 1',
      itemName: 'Jiij Armor 1',
      price: 100,
    };
    const { player: after, outcome } = applyShopPurchase(p, offer);
    expect(outcome).toBe('bought');
    expect(after.inventory.slots.armor).toEqual({ defId: 'Jiij Armor 1' });
    expect(after.inventory.backpack).toEqual([{ defId: 'Jooj Armor 1' }]); // old armor displaced
  });
});
