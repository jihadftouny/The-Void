// M6 step 2 — passive stat/resist deltas from equipped gear cascade into effective
// stats/mods/AC/maxHp/resistances. Every expected number is hand-derived from the D&D
// mod formula computeStatMod(stat) = floor((stat-10)/2) and the AC model in defense.ts,
// never read back from code.

import { describe, expect, it } from 'vitest';
import { createPlayer, type Player } from './player.ts';
import {
  effectiveStats,
  effectiveMods,
  effectiveMaxHp,
  effectiveResistances,
} from './statEffects.ts';
import { playerArmorClass } from './defense.ts';
import { equip, pickUp } from './equipment.ts';
import { type ItemInstance } from './item.ts';

/** A CON-12 Enforcer: mod(12) = +1, so stored maxHp = 10 (hit die) + 1 = 11. */
function con12Enforcer(): Player {
  return createPlayer({
    name: 'Ari',
    classId: 'Enforcer',
    stats: { STR: 14, DEX: 10, CON: 12, INT: 10, WIS: 10, CHA: 10 },
  });
}

/**
 * Equip a rolled instance into the ring slot, returning a NEW player.
 *
 * G11b: this helper used to WRITE STRAIGHT INTO `inventory.slots.ring`, bypassing `equip()`
 * entirely — so this whole cascade suite proved rolled gear works ONCE equipped and never that
 * it CAN be, which is exactly the defect G11 turned out to be. It now goes through the real
 * `pickUp` -> `equip()` path (no slot argument, as the UI calls it) and asserts the equip
 * succeeded, so a `canEquip` regression fails this file too.
 */
function withRing(base: Player, ring: ItemInstance): Player {
  const { inventory, ok } = equip(pickUp(base.inventory, ring), base.inventory.backpack.length);
  expect(ok).toBe(true);
  expect(inventory.slots.ring).toBe(ring);
  return { ...base, inventory };
}

const CON_PLUS_2: ItemInstance = {
  defId: 'gen:con-ring',
  rolled: {
    name: 'Ring of the Ox',
    rarity: 'Rare',
    slot: 'ring',
    kind: 'trinket',
    effects: [{ type: 'bonusStat', params: { con: 2 } }],
  },
};

describe('bonusStat cascade (anchor — CON 12 -> 14 crosses a mod boundary)', () => {
  it('raises effective CON to 14 and its mod to +2', () => {
    const p = withRing(con12Enforcer(), CON_PLUS_2);
    expect(effectiveStats(p).CON).toBe(14);
    // computeStatMod(14) = floor(4/2) = +2.
    expect(effectiveMods(p).CON).toBe(2);
  });

  it('raises effective max HP by exactly 1 (mod +1 -> +2)', () => {
    const base = con12Enforcer();
    const geared = withRing(base, CON_PLUS_2);
    // Off-equivalence sanity: the un-ringed player's effective maxHp equals its stored maxHp.
    expect(effectiveMaxHp(base)).toBe(base.maxHp);
    // computeStatMod(14) - computeStatMod(12) = 2 - 1 = 1.
    expect(effectiveMaxHp(geared)).toBe(base.maxHp + 1);
  });

  it('raises armor class by exactly 1 (the CON-mod term)', () => {
    const base = con12Enforcer();
    const geared = withRing(base, CON_PLUS_2);
    expect(playerArmorClass(geared)).toBe(playerArmorClass(base) + 1);
  });
});

describe('bonusResist shift (Pyro +30)', () => {
  const RESIST_RING: ItemInstance = {
    defId: 'gen:pyro-ring',
    rolled: {
      name: 'Ring of Cinders',
      rarity: 'Rare',
      slot: 'ring',
      kind: 'trinket',
      // element 2 = Pyro (Physical0 Cryo1 Pyro2 Electro3 Poison4 Psychic5 Force6).
      effects: [{ type: 'bonusResist', params: { element: 2, amount: 30 } }],
    },
  };

  it('adds 30 to the Pyro resistance slot and leaves the others at 0', () => {
    const base = con12Enforcer(); // WIS 10 -> mod 0 -> no WIS resist shift
    const geared = withRing(base, RESIST_RING);
    const res = effectiveResistances(geared);
    expect(res[2]).toBe(30); // Pyro: 0 base + 0 wis-shift + 30 equip
    expect(res[0]).toBe(0);
    expect(res[1]).toBe(0);
  });
});

describe('off-equivalence — effect-free (legacy) gear changes nothing', () => {
  it('effective stats equal the stored stats for a legacy-geared player', () => {
    const base = con12Enforcer(); // Enforcer starts with legacy Jaaj Sword 1 / Jooj Armor 1 (effects [])
    expect(effectiveStats(base)).toEqual(base.stats);
    expect(effectiveResistances(base)).toEqual(base.resistances);
  });
});
