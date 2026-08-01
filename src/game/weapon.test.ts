import { describe, expect, it } from 'vitest';
import {
  getWeaponsForAct,
  getAllWeapons,
  type Rarity,
  type WeaponProperty,
  type Weapon,
} from './weapon.ts';

// Expected values are hand-derived from the canonical Java `Weapon.java`:
//  Act N: {"Jooj Gun N",5,Common,d4,Ranged}, {"Jaaj Sword N",5,Rare,d6,Melee},
//         {"Jiij Rapier N",5,Legendary,d8,Finesse}. d4={1,4} d6={1,6} d8={1,8}.

const RARITIES: readonly Rarity[] = ['Common', 'Rare', 'Legendary'];
const PROPERTIES: readonly WeaponProperty[] = ['Melee', 'Ranged', 'Finesse'];
const VALID_SIDES = new Set([2, 4, 6, 8, 10, 12, 20]);

describe('getWeaponsForAct', () => {
  it('Act 1 is exactly the three Java weapons, in order', () => {
    expect(getWeaponsForAct(1)).toEqual([
      { name: 'Jooj Gun 1', cost: 5, rarity: 'Common', damage: { quantity: 1, sides: 4 }, property: 'Ranged' },
      { name: 'Jaaj Sword 1', cost: 5, rarity: 'Rare', damage: { quantity: 1, sides: 6 }, property: 'Melee' },
      { name: 'Jiij Rapier 1', cost: 5, rarity: 'Legendary', damage: { quantity: 1, sides: 8 }, property: 'Finesse' },
    ]);
  });

  it('each of Acts 1-4 has exactly 3 weapons', () => {
    for (const act of [1, 2, 3, 4]) {
      expect(getWeaponsForAct(act)).toHaveLength(3);
    }
  });

  it('Acts 2-4 match Act 1 except the trailing name digit', () => {
    const act1 = getWeaponsForAct(1)!;
    for (const act of [2, 3, 4]) {
      const weapons = getWeaponsForAct(act)!;
      weapons.forEach((w, i) => {
        const base = act1[i]!;
        expect(w).toEqual({ ...base, name: base.name.replace(/1$/, String(act)) });
      });
    }
  });

  it('uses the Java spelling "Melee" (never the reference typo "Meelee")', () => {
    const names = getAllWeapons().map((w) => w.property);
    expect(names).toContain('Melee');
    expect(names).not.toContain('Meelee');
  });

  it('returns undefined for out-of-range Acts', () => {
    expect(getWeaponsForAct(0)).toBeUndefined();
    expect(getWeaponsForAct(5)).toBeUndefined();
  });
});

describe('weapon field domains (all Acts)', () => {
  const all = getAllWeapons();

  it('every rarity is in the allowed set', () => {
    for (const w of all) expect(RARITIES).toContain(w.rarity);
  });

  it('every property is in the allowed set', () => {
    for (const w of all) expect(PROPERTIES).toContain(w.property);
  });

  it('every damage is {quantity>=1, sides in the die set}', () => {
    for (const w of all) {
      expect(Number.isInteger(w.damage.quantity)).toBe(true);
      expect(w.damage.quantity).toBeGreaterThanOrEqual(1);
      expect(VALID_SIDES.has(w.damage.sides)).toBe(true);
    }
  });
});

describe('weapon damage range (dice math, not rolled)', () => {
  // min of a roll is `quantity` (all ones); max is `quantity*sides` (all max).
  const range = (w: Weapon) => ({
    min: w.damage.quantity,
    max: w.damage.quantity * w.damage.sides,
  });

  it('Act-1 Legendary rapier (1d8) is min 1, max 8', () => {
    const rapier = getWeaponsForAct(1)!.find((w) => w.name === 'Jiij Rapier 1')!;
    expect(range(rapier)).toEqual({ min: 1, max: 8 });
  });

  it('Act-1 Common gun (1d4) is min 1, max 4', () => {
    const gun = getWeaponsForAct(1)!.find((w) => w.name === 'Jooj Gun 1')!;
    expect(range(gun)).toEqual({ min: 1, max: 4 });
  });
});

describe('serializability', () => {
  it('getWeaponsForAct(1) round-trips through JSON unchanged', () => {
    const weapons = getWeaponsForAct(1)!;
    expect(JSON.parse(JSON.stringify(weapons))).toEqual(weapons);
  });
});
