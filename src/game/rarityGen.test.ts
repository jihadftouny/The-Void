// M6 step 4 — rarity generator. Expected rolls are derived INDEPENDENTLY from the documented
// draw order (draw 1 = base + floor(x1 * spread); draw 2 = x2 < procChance) applied to a
// fresh mulberry32 stream — NOT by reading generateItem's output back. `generateItem` is then
// run on an equal-seed stream and compared, so a pass proves it follows the documented formula.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng.ts';
import { generateItem, RARITY_TABLE } from './rarityGen.ts';
import { resolveInstanceDef } from './equipment.ts';

/** A passive ItemEffect narrowed for reading its numeric params in tests. */
type PassiveEffect = { type: string; params: Record<string, number> };

const SEED = 424242;

/** Re-derive the two draws of a fresh mulberry32(seed) stream (the documented order). */
function draws(seed: number): { x1: number; x2: number } {
  const rng = mulberry32(seed);
  return { x1: rng(), x2: rng() };
}

describe('generateItem — seeded determinism vs the documented formula', () => {
  it('a Common mainHand rolls the hand-derived flatDamage and NO proc', () => {
    const { x1 } = draws(SEED);
    // RARITY_TABLE.Common: base 1, spread 2, procChance 0.
    const expectedMag = 1 + Math.floor(x1 * 2);
    const item = generateItem(mulberry32(SEED), { slot: 'mainHand', rarity: 'Common' });
    expect(item.rolled!.kind).toBe('weapon');
    expect(item.rolled!.effects).toEqual([{ type: 'bonusDamage', params: { amount: expectedMag } }]);
  });

  it('is fully deterministic: equal seed + request -> deep-equal item', () => {
    const a = generateItem(mulberry32(SEED), { slot: 'mainHand', rarity: 'Rare' });
    const b = generateItem(mulberry32(SEED), { slot: 'mainHand', rarity: 'Rare' });
    expect(a).toEqual(b);
  });
});

describe('generateItem — tier scaling + proc-by-tier', () => {
  it('Legendary out-rolls Common on the same seed AND gains a triggered proc Common lacks', () => {
    const { x1 } = draws(SEED);
    const commonMag = 1 + Math.floor(x1 * 2); // Common base 1 spread 2
    const legMag = 6 + Math.floor(x1 * 4); // Legendary base 6 spread 4

    const common = generateItem(mulberry32(SEED), { slot: 'mainHand', rarity: 'Common' });
    const legendary = generateItem(mulberry32(SEED), { slot: 'mainHand', rarity: 'Legendary' });

    // Strictly larger primary magnitude.
    expect(legMag).toBeGreaterThan(commonMag);
    expect((legendary.rolled!.effects[0] as PassiveEffect).params.amount).toBe(legMag);

    // Legendary always procs (procChance 1); Common never does (procChance 0).
    expect(legendary.rolled!.effects.some((e) => e.type === 'triggered')).toBe(true);
    expect(common.rolled!.effects.some((e) => e.type === 'triggered')).toBe(false);
  });

  it('primary magnitude is monotone across tiers for one seed (Legendary > Rare > Common)', () => {
    const { x1 } = draws(SEED);
    const common = RARITY_TABLE.Common.statBase + Math.floor(x1 * RARITY_TABLE.Common.statSpread);
    const rare = RARITY_TABLE.Rare.statBase + Math.floor(x1 * RARITY_TABLE.Rare.statSpread);
    const leg = RARITY_TABLE.Legendary.statBase + Math.floor(x1 * RARITY_TABLE.Legendary.statSpread);
    // Ranges are disjoint (Common 1-2, Rare 3-5, Legendary 6-9), so ordering holds for any x1.
    expect(leg).toBeGreaterThan(rare);
    expect(rare).toBeGreaterThan(common);
  });
});

describe('generateItem — slot -> primary effect mapping', () => {
  it('a ring rolls bonusStat on the requested stat', () => {
    const item = generateItem(mulberry32(SEED), { slot: 'ring', rarity: 'Rare', stat: 'DEX' });
    expect(item.rolled!.kind).toBe('trinket');
    const eff = item.rolled!.effects[0] as PassiveEffect;
    expect(eff.type).toBe('bonusStat');
    expect(Object.keys(eff.params)).toEqual(['dex']);
  });

  it('an armor slot rolls bonusArmorClass, and the rolled item resolves for equipping', () => {
    const item = generateItem(mulberry32(SEED), { slot: 'armor', rarity: 'Common' });
    expect(item.rolled!.effects[0]!.type).toBe('bonusArmorClass');
    // The rolled overlay resolves to a GearDef so the equip pipeline can read it.
    const def = resolveInstanceDef(item);
    expect(def!.slot).toBe('armor');
    expect(def!.effects).toEqual(item.rolled!.effects);
  });
});
