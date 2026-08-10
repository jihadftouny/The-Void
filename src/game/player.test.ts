import { describe, expect, it } from 'vitest';
import { createPlayer, rollStartStats } from './player.ts';
import { STAT_KEYS, type Stats } from './character.ts';
import { mulberry32 } from './rng.ts';
import { getWeaponByName } from './weapon.ts';
import { getArmorByName } from './armor.ts';

// All expected values are hand-derived from the class spec / formulas:
//   computeStatMod(s) = floor((s - 10) / 2)   (standard D&D, uncapped)
//     mod(14) = floor(4/2)  = 2
//     mod(30) = floor(20/2) = 10
//   maxHp = hitDie.sides + CONmod ; hp = maxHp ; armorClass = 10 + CONmod
//   Enforcer hitDie = 1d10, Neuromancer hitDie = 1d6
// Starting scalars (Java Player / GameLogic.startGame): gold 1500, restsLeft 1,
//   pots 2, proficiency 2, advantageDisadvantage 0, xp 0, skillCharges = 5.

/** A full stat set with a chosen CON; other stats fixed and distinct. */
function statsWithCon(con: number): Stats {
  return { STR: 11, DEX: 12, CON: con, INT: 13, WIS: 15, CHA: 16 };
}

describe('rollStartStats', () => {
  it('returns all six stats, each in [3, 18]', () => {
    const stats = rollStartStats(mulberry32(1));
    expect(Object.keys(stats).sort()).toEqual([...STAT_KEYS].sort());
    for (const key of STAT_KEYS) {
      expect(stats[key]).toBeGreaterThanOrEqual(3);
      expect(stats[key]).toBeLessThanOrEqual(18);
      expect(Number.isInteger(stats[key])).toBe(true);
    }
  });

  it('is deterministic under the same seed', () => {
    expect(rollStartStats(mulberry32(99))).toEqual(rollStartStats(mulberry32(99)));
  });
});

describe('createPlayer — Enforcer', () => {
  const player = createPlayer({
    name: 'Vale',
    classId: 'Enforcer',
    stats: statsWithCon(14),
  });

  it('equips the Rare Melee weapon "Jaaj Sword 1" and Common armor "Jooj Armor 1"', () => {
    expect(player.equippedWeaponId).toBe('Jaaj Sword 1');
    expect(player.equippedArmorId).toBe('Jooj Armor 1');
    const weapon = getWeaponByName(player.equippedWeaponId)!;
    expect(weapon.rarity).toBe('Rare');
    expect(weapon.property).toBe('Melee');
    expect(getArmorByName(player.equippedArmorId)!.rarity).toBe('Common');
  });

  it('derives maxHp = 12, hp = 12, armorClass = 12 for CON 14 (1d10, CONmod 2)', () => {
    expect(player.maxHp).toBe(12);
    expect(player.hp).toBe(12);
    expect(player.armorClass).toBe(12);
    expect(player.hitDie).toEqual({ quantity: 1, sides: 10 });
  });

  it('at CON 30 (CONmod 10) has maxHp 20 and armorClass 20', () => {
    const strong = createPlayer({
      name: 'Vale',
      classId: 'Enforcer',
      stats: statsWithCon(30),
    });
    expect(strong.maxHp).toBe(20);
    expect(strong.armorClass).toBe(20);
  });

  it('has the fixed game-start scalar defaults', () => {
    expect(player.gold).toBe(1500);
    expect(player.restsLeft).toBe(1);
    expect(player.pots).toBe(2);
    expect(player.proficiency).toBe(2);
    expect(player.advantageDisadvantage).toBe(0);
    expect(player.xp).toBe(0);
    expect(player.skillCharges).toBe(5);
    expect(player.maxSkillCharges).toBe(5);
    expect(player.activeConditions).toEqual([]);
    // M3 per-class signature kit (Enforcer's four skills), not the old generic pool.
    expect(player.skillPool).toEqual(['heavyStrike', 'brace', 'intimidate', 'execute']);
    // Resources start at 0 (Enforcer banks momentum; corruption harmless-0).
    expect(player.momentum).toBe(0);
    expect(player.corruption).toBe(0);
  });

  it('has a 7-slot all-zero resistance array', () => {
    expect(player.resistances).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('starts with an empty paperdoll: nine null slots and an empty backpack', () => {
    // The nine equip slots from item.ts, independently listed.
    const expectedSlots = [
      'helmet',
      'amulet',
      'mainHand',
      'offHand',
      'armor',
      'legs',
      'boots',
      'ring',
      'ammo',
    ];
    expect(Object.keys(player.inventory.slots).sort()).toEqual([...expectedSlots].sort());
    for (const slot of expectedSlots) {
      expect(player.inventory.slots[slot as keyof typeof player.inventory.slots]).toBeNull();
    }
    expect(player.inventory.backpack).toEqual([]);
  });
});

describe('createPlayer — Neuromancer', () => {
  const player = createPlayer({
    name: 'Echo',
    classId: 'Neuromancer',
    stats: statsWithCon(14),
  });

  it('equips the Common Ranged weapon "Jooj Gun 1" and Rare armor "Jaaj Armor 1"', () => {
    expect(player.equippedWeaponId).toBe('Jooj Gun 1');
    expect(player.equippedArmorId).toBe('Jaaj Armor 1');
    const weapon = getWeaponByName(player.equippedWeaponId)!;
    expect(weapon.rarity).toBe('Common');
    expect(weapon.property).toBe('Ranged');
    expect(getArmorByName(player.equippedArmorId)!.rarity).toBe('Rare');
  });

  it('derives maxHp = 8, armorClass = 12 for CON 14 (1d6, CONmod 2)', () => {
    expect(player.maxHp).toBe(8);
    expect(player.hp).toBe(8);
    expect(player.armorClass).toBe(12);
    expect(player.hitDie).toEqual({ quantity: 1, sides: 6 });
  });
});

// M3 — all five classes selectable & created. Every expected value is hand-derived from
// the class spec in classKit.ts + the fresh-character formulas (CON 14 -> CONmod 2 ->
// maxHp = hitDie.sides + 2, AC 12). Hit dice: Enforcer d10, Neuromancer d6, Scavver d8,
// Penitent d8 (M15 placeholder), Hollow d8 (M15 placeholder). Kits and provisional gear
// are read from the plan's per-class table, NOT from code output.
describe('createPlayer — all five classes (creation table)', () => {
  const con14 = statsWithCon(14); // CONmod 2 for every row
  const table: Array<{
    classId: 'Enforcer' | 'Neuromancer' | 'Scavver' | 'Penitent' | 'Hollow';
    sides: number;
    maxHp: number;
    weaponId: string;
    armorId: string;
    kit: string[];
  }> = [
    { classId: 'Enforcer', sides: 10, maxHp: 12, weaponId: 'Jaaj Sword 1', armorId: 'Jooj Armor 1', kit: ['heavyStrike', 'brace', 'intimidate', 'execute'] },
    { classId: 'Neuromancer', sides: 6, maxHp: 8, weaponId: 'Jooj Gun 1', armorId: 'Jaaj Armor 1', kit: ['mindSpike', 'unravel', 'lull', 'synapse'] },
    { classId: 'Scavver', sides: 8, maxHp: 10, weaponId: 'Jiij Rapier 1', armorId: 'Jooj Armor 1', kit: ['backstab', 'venomCoat', 'slip', 'scavenge'] },
    { classId: 'Penitent', sides: 8, maxHp: 10, weaponId: 'Jaaj Sword 1', armorId: 'Jaaj Armor 1', kit: ['smite', 'mend', 'consecrate', 'martyr'] },
    { classId: 'Hollow', sides: 8, maxHp: 10, weaponId: 'Jooj Gun 1', armorId: 'Jooj Armor 1', kit: ['siphon', 'corrupt', 'sacrifice', 'unmake'] },
  ];

  for (const row of table) {
    it(`${row.classId}: hitDie d${row.sides}, maxHp/hp ${row.maxHp}, AC 12, kit skillPool, gear resolves, resources 0`, () => {
      const player = createPlayer({ name: 'Nyx', classId: row.classId, stats: con14 });
      expect(player.hitDie).toEqual({ quantity: 1, sides: row.sides });
      expect(player.maxHp).toBe(row.maxHp);
      expect(player.hp).toBe(row.maxHp);
      expect(player.armorClass).toBe(12);
      // skillPool is exactly this class's four-skill kit (deep-equal, order-sensitive).
      expect(player.skillPool).toEqual(row.kit);
      // Provisional starting gear resolves in the M2 tables.
      expect(player.equippedWeaponId).toBe(row.weaponId);
      expect(player.equippedArmorId).toBe(row.armorId);
      expect(getWeaponByName(row.weaponId)).toBeDefined();
      expect(getArmorByName(row.armorId)).toBeDefined();
      // Resource state present and zeroed.
      expect(player.momentum).toBe(0);
      expect(player.corruption).toBe(0);
    });
  }
});

describe('serializability', () => {
  it('a created player of every class round-trips through JSON unchanged', () => {
    for (const classId of ['Enforcer', 'Neuromancer', 'Scavver', 'Penitent', 'Hollow'] as const) {
      const player = createPlayer({
        name: 'Nyx',
        classId,
        stats: statsWithCon(12),
      });
      expect(JSON.parse(JSON.stringify(player))).toEqual(player);
    }
  });
});
