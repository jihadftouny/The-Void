import { describe, expect, it } from 'vitest';
import { computeEquipModifiers } from './equipEffects.ts';
import { createInventory } from './inventory.ts';
import { inventoryWithGear } from './equipment.ts';

// Every expected number is hand-derived directly from items.json, NOT read from code:
//   void-plate   -> effects [{ bonusArmorClass, amount 2 }]  (armor slot)
//   rusted-blade -> effects [{ bonusDamage, amount 1 }]      (mainHand slot)
//   hollow-ring  -> effects [{ bonusStat, con 1 }]           (ring slot)
//   clarity-draught -> heal (usable, never equipped)
// Legacy gear (Jaaj Sword 1 / Jooj Armor 1 / Buckler) resolves to effects [] -> zero bundle.

const ZERO_STATS = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };

describe('computeEquipModifiers — off-equivalence (the pipeline is inert for a normal run)', () => {
  it('an empty inventory yields the zero bundle', () => {
    expect(computeEquipModifiers(createInventory())).toEqual({
      statDeltas: ZERO_STATS,
      flatAc: 0,
      flatDamage: 0,
      resistDeltas: [],
    });
  });

  it('legacy starting gear (effects []) also yields the zero bundle', () => {
    const inv = inventoryWithGear({
      mainHand: 'Jaaj Sword 1',
      armor: 'Jooj Armor 1',
      offHand: 'Buckler',
    });
    expect(computeEquipModifiers(inv)).toEqual({
      statDeltas: ZERO_STATS,
      flatAc: 0,
      flatDamage: 0,
      resistDeltas: [],
    });
  });
});

describe('computeEquipModifiers — items.json effects move the right field', () => {
  it('void-plate contributes flatAc 2 and nothing else', () => {
    const mods = computeEquipModifiers(inventoryWithGear({ armor: 'void-plate' }));
    expect(mods.flatAc).toBe(2);
    expect(mods.flatDamage).toBe(0);
    expect(mods.statDeltas).toEqual(ZERO_STATS);
  });

  it('rusted-blade contributes flatDamage 1 and nothing else', () => {
    const mods = computeEquipModifiers(inventoryWithGear({ mainHand: 'rusted-blade' }));
    expect(mods.flatDamage).toBe(1);
    expect(mods.flatAc).toBe(0);
    expect(mods.statDeltas).toEqual(ZERO_STATS);
  });

  it('hollow-ring contributes statDeltas.CON 1 and nothing else', () => {
    const mods = computeEquipModifiers(inventoryWithGear({ ring: 'hollow-ring' }));
    expect(mods.statDeltas.CON).toBe(1);
    expect(mods.statDeltas).toEqual({ ...ZERO_STATS, CON: 1 });
    expect(mods.flatAc).toBe(0);
    expect(mods.flatDamage).toBe(0);
  });

  it('effects across multiple slots sum into one bundle', () => {
    const mods = computeEquipModifiers(
      inventoryWithGear({ mainHand: 'rusted-blade', armor: 'void-plate', ring: 'hollow-ring' }),
    );
    expect(mods).toEqual({
      statDeltas: { ...ZERO_STATS, CON: 1 },
      flatAc: 2,
      flatDamage: 1,
      resistDeltas: [],
    });
  });
});
