import { describe, expect, it } from 'vitest';
import {
  getArmorForAct,
  getAllArmor,
  getArmorByName,
  type Rarity,
} from './armor.ts';

// Expected values are hand-derived from the canonical Java `Armor.java`:
//  Act N: {"Jooj Armor N",5,Common,11,2,0}, {"Jaaj Armor N",5,Rare,12,2,14},
//         {"Jiij Armor N",5,Legendary,12,2,14}. (armorAC, armorACM, armorStr)

const RARITIES: readonly Rarity[] = ['Common', 'Rare', 'Legendary'];

describe('getArmorForAct', () => {
  it('Act 1 is exactly the three Java armors, in order', () => {
    expect(getArmorForAct(1)).toEqual([
      { name: 'Jooj Armor 1', cost: 5, rarity: 'Common', baseArmor: 11, dexCap: 2, strReq: 0 },
      { name: 'Jaaj Armor 1', cost: 5, rarity: 'Rare', baseArmor: 12, dexCap: 2, strReq: 14 },
      { name: 'Jiij Armor 1', cost: 5, rarity: 'Legendary', baseArmor: 12, dexCap: 2, strReq: 14 },
    ]);
  });

  it('each of Acts 1-4 has exactly 3 armors', () => {
    for (const act of [1, 2, 3, 4]) {
      expect(getArmorForAct(act)).toHaveLength(3);
    }
  });

  it('Acts 2-4 match Act 1 except the trailing name digit', () => {
    const act1 = getArmorForAct(1)!;
    for (const act of [2, 3, 4]) {
      const armors = getArmorForAct(act)!;
      armors.forEach((a, i) => {
        const base = act1[i]!;
        expect(a).toEqual({ ...base, name: base.name.replace(/1$/, String(act)) });
      });
    }
  });

  it('returns undefined for out-of-range Acts', () => {
    expect(getArmorForAct(0)).toBeUndefined();
    expect(getArmorForAct(5)).toBeUndefined();
  });
});

describe('armor field domains (all Acts)', () => {
  const all = getAllArmor();

  it('every rarity is in the allowed set', () => {
    for (const a of all) expect(RARITIES).toContain(a.rarity);
  });

  it('baseArmor, dexCap, strReq are integers >= 0', () => {
    for (const a of all) {
      for (const n of [a.baseArmor, a.dexCap, a.strReq]) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('serializability', () => {
  it('getArmorForAct(1) round-trips through JSON unchanged', () => {
    const armors = getArmorForAct(1)!;
    expect(JSON.parse(JSON.stringify(armors))).toEqual(armors);
  });
});

describe('getArmorByName', () => {
  it('resolves the Enforcer starting armor "Jooj Armor 1" (Common)', () => {
    const a = getArmorByName('Jooj Armor 1');
    expect(a).toBeDefined();
    expect(a!.rarity).toBe('Common');
  });

  it('resolves the Neuromancer starting armor "Jaaj Armor 1" (Rare)', () => {
    const a = getArmorByName('Jaaj Armor 1');
    expect(a).toBeDefined();
    expect(a!.rarity).toBe('Rare');
  });

  it('returns undefined for an unknown name', () => {
    expect(getArmorByName('No Such Armor')).toBeUndefined();
  });
});
