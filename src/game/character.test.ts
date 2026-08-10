import { describe, expect, it } from 'vitest';
import {
  Stat,
  STAT_KEYS,
  computeStatMod,
  computeStatMods,
  deriveArmorClass,
  deriveMaxHp,
  createCharacter,
  type Stats,
} from './character.ts';

// Every expected value below is derived BY HAND from the canonical formulas, never
// measured from the implementation:
//   mod    = floor((stat - 10) / 2)   (standard D&D, uncapped)
//   maxHp  = hitDie.sides + conMod
//   AC     = 10 + conMod

describe('computeStatMod', () => {
  // [stat, expected mod] — floor((stat - 10) / 2), worked by hand.
  const cases: ReadonlyArray<readonly [number, number]> = [
    [1, -5], //  floor(-9/2)  = floor(-4.5) = -5
    [5, -3], //  floor(-5/2)  = floor(-2.5) = -3
    [8, -1], //  floor(-2/2)  = -1
    [10, 0], //  floor(0/2)   = 0
    [12, 1], //  floor(2/2)   = 1
    [15, 2], //  floor(5/2)   = floor(2.5) = 2
    [20, 5], //  floor(10/2)  = 5
    [25, 7], //  floor(15/2)  = floor(7.5) = 7
    [28, 9], //  floor(18/2)  = 9
    [29, 9], //  floor(19/2)  = floor(9.5) = 9
    [30, 10], // floor(20/2)  = 10
    [31, 10], // floor(21/2)  = floor(10.5) = 10 (agrees with old clamp)
    [40, 15], // floor(30/2)  = 15 (old clamped to 10; new keeps climbing)
  ];

  for (const [stat, mod] of cases) {
    it(`stat ${stat} -> mod ${mod}`, () => {
      expect(computeStatMod(stat)).toBe(mod);
    });
  }
});

describe('computeStatMods', () => {
  it('maps each key to its own hand-derived mod (no index drift)', () => {
    const stats: Stats = { STR: 15, DEX: 20, CON: 10, INT: 8, WIS: 30, CHA: 1 };
    // STR 15 -> 2, DEX 20 -> 5, CON 10 -> 0, INT 8 -> -1, WIS 30 -> 10, CHA 1 -> -5
    expect(computeStatMods(stats)).toEqual({
      STR: 2,
      DEX: 5,
      CON: 0,
      INT: -1,
      WIS: 10,
      CHA: -5,
    });
  });
});

describe('deriveArmorClass / deriveMaxHp', () => {
  // [hitDieSides, conStat, conMod, maxHp, AC] — the plan's AC/maxHp table.
  const rows: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [10, 10, 0, 10, 10], // 1d10 Enforcer,    CON 10 -> mod 0
    [10, 20, 5, 15, 15], // 1d10 Enforcer,    CON 20 -> mod 5
    [6, 20, 5, 11, 15], //  1d6  Neuromancer, CON 20 -> mod 5
    [10, 1, -5, 5, 5], //   1d10 Enforcer,    CON 1  -> mod -5
  ];

  for (const [sides, conStat, conMod, maxHp, ac] of rows) {
    it(`d${sides} + CON ${conStat} (mod ${conMod}) -> maxHp ${maxHp}, AC ${ac}`, () => {
      expect(computeStatMod(conStat)).toBe(conMod); // guard the mod feeding both
      expect(deriveMaxHp(sides, conMod)).toBe(maxHp);
      expect(deriveArmorClass(conMod)).toBe(ac);
    });
  }
});

describe('STAT_KEYS', () => {
  it('lists the six stats in canonical Java order', () => {
    expect(STAT_KEYS).toEqual([
      Stat.STR,
      Stat.DEX,
      Stat.CON,
      Stat.INT,
      Stat.WIS,
      Stat.CHA,
    ]);
  });
});

describe('createCharacter', () => {
  it('assembles a fresh Enforcer-shaped character (all stats 10, 1d10, 5 charges)', () => {
    const c = createCharacter({
      name: 'Test',
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      hitDie: { quantity: 1, sides: 10 },
      maxSkillCharges: 5,
    });
    // CON 10 -> mod 0; maxHp = 10 + 0 = 10; hp = maxHp; AC = 10 + 0 = 10.
    expect(c.mods.CON).toBe(0);
    expect(c.maxHp).toBe(10);
    expect(c.hp).toBe(10);
    expect(c.armorClass).toBe(10);
    expect(c.skillCharges).toBe(5);
    expect(c.maxSkillCharges).toBe(5);
    expect(c.xp).toBe(0);
  });

  it('wires hp=maxHp and AC from CON for a high-CON build (1d6, CON 20)', () => {
    const c = createCharacter({
      name: 'Neuro',
      stats: { STR: 10, DEX: 10, CON: 20, INT: 10, WIS: 10, CHA: 10 },
      hitDie: { quantity: 1, sides: 6 },
      maxSkillCharges: 2,
    });
    // CON 20 -> mod 5; maxHp = 6 + 5 = 11; AC = 10 + 5 = 15.
    expect(c.mods.CON).toBe(5);
    expect(c.maxHp).toBe(11);
    expect(c.hp).toBe(11);
    expect(c.armorClass).toBe(15);
    expect(c.skillCharges).toBe(2);
  });

  it('honors an explicit starting xp', () => {
    const c = createCharacter({
      name: 'Veteran',
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      hitDie: { quantity: 1, sides: 10 },
      maxSkillCharges: 5,
      xp: 42,
    });
    expect(c.xp).toBe(42);
  });
});

describe('serializability', () => {
  it('round-trips a Character unchanged through JSON (plain data, no classes)', () => {
    const c = createCharacter({
      name: 'RoundTrip',
      stats: { STR: 15, DEX: 20, CON: 12, INT: 8, WIS: 14, CHA: 10 },
      hitDie: { quantity: 1, sides: 10 },
      maxSkillCharges: 5,
    });
    const clone = JSON.parse(JSON.stringify(c));
    expect(clone).toEqual(c);
  });
});
