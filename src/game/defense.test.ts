import { describe, expect, it } from 'vitest';
import { getShieldById, getAllShields } from './shield.ts';
import {
  playerArmorClass,
  shieldAcBonus,
  enemyAdvDisVs,
  STR_REQ_AC_PENALTY,
  type Defender,
} from './defense.ts';
import { computeStatMods, type Stats } from './character.ts';
import { makeCondition } from './condition.ts';
import { createInventory, type Inventory } from './inventory.ts';
import { inventoryWithGear } from './equipment.ts';

// A Defender fixture. Gear now lives in the paperdoll `inventory` (armor -> slots.armor,
// shield -> slots.offHand). Only `stats`, `activeConditions`, and that inventory drive
// playerArmorClass. Every AC below is hand-derived from the D&D mod formula
// floor((stat-10)/2) + armor.json + the AC MODEL (baseArmor REPLACES the base 10), never
// read off the implementation.
type Gear = { armorId?: string; shieldId?: string };

function invFor(gear: Gear): Inventory {
  const spec: Record<string, string> = {};
  // `armorId` defaults to the Common starter; pass '' / a bogus id for the unarmored path.
  const armorId = gear.armorId ?? 'Jooj Armor 1';
  if (armorId !== undefined) spec.armor = armorId;
  if (gear.shieldId !== undefined) spec.offHand = gear.shieldId;
  return inventoryWithGear(spec);
}

function defender(
  stats: Stats,
  gear: Gear = {},
  overrides: Partial<Defender> = {},
): Defender {
  return {
    name: 'Hero',
    stats,
    mods: computeStatMods(stats),
    hp: 20,
    maxHp: 20,
    xp: 0,
    armorClass: 10,
    skillCharges: 5,
    maxSkillCharges: 5,
    hitDie: { quantity: 1, sides: 10 },
    activeConditions: [],
    inventory: invFor(gear),
    ...overrides,
  };
}

// Reused stat sets. CON 12 -> +1, DEX 12 -> +1 (the default starting-character mods).
const S = (over: Partial<Stats> = {}): Stats => ({
  STR: 12,
  DEX: 12,
  CON: 12,
  INT: 10,
  WIS: 10,
  CHA: 10,
  ...over,
});

// Shield loader — the seed table (M4). acBonus values are hand-read from shields.json
// (Buckler 1, Kite Shield 2); the loader is a plain lookup, so these assert the data +
// the id-scan contract, not any computed output.
describe('shield loader', () => {
  it('resolves a known shield id to its row', () => {
    const buckler = getShieldById('Buckler');
    expect(buckler).toBeDefined();
    expect(buckler?.acBonus).toBe(1);
    expect(buckler?.rarity).toBe('Common');

    const kite = getShieldById('Kite Shield');
    expect(kite?.acBonus).toBe(2);
    expect(kite?.rarity).toBe('Rare');
  });

  it('returns undefined for an unknown id', () => {
    expect(getShieldById('Tower Shield')).toBeUndefined();
    expect(getShieldById('')).toBeUndefined();
  });

  it('exposes the seed table in declaration order', () => {
    expect(getAllShields().map((s) => s.id)).toEqual(['Buckler', 'Kite Shield']);
  });
});

describe('playerArmorClass — armored (replace model)', () => {
  it('default starter: Jooj Armor 1 (baseArmor 11, dexCap 2), CON 12/+1, DEX 12/+1 -> AC 13', () => {
    // 11 + 1 + min(1, 2) = 13.
    expect(playerArmorClass(defender(S()))).toBe(13);
  });

  it('dexCap clamps a high DEX: DEX 18/+4 in dexCap-2 armor adds only +2 (AC 14, not 16)', () => {
    // 11 + 1 + min(4, 2) = 14. Without the cap it would be 11 + 1 + 4 = 16, so the
    // clamp is worth exactly 2 AC here.
    expect(playerArmorClass(defender(S({ DEX: 18 })))).toBe(14);
  });

  it('DEX below the cap adds the whole DEX mod: DEX 14/+2 in dexCap-2 armor -> +2 -> AC 14', () => {
    // 11 + 1 + min(2, 2) = 14 (exactly at the cap; proves it is a min, not a flat +cap).
    expect(playerArmorClass(defender(S({ DEX: 14 })))).toBe(14);
  });

  it('unmet strReq costs STR_REQ_AC_PENALTY (2): STR 10 in Jaaj Armor 1 (strReq 14) -> AC 12', () => {
    // Jaaj Armor 1: baseArmor 12, dexCap 2, strReq 14. STR 10 < 14 -> penalty.
    // 12 + 1 + min(1, 2) - 2 = 12.
    expect(STR_REQ_AC_PENALTY).toBe(2);
    expect(playerArmorClass(defender(S({ STR: 10 }), { armorId: 'Jaaj Armor 1' }))).toBe(12);
  });

  it('meeting strReq removes the penalty: STR 14 in Jaaj Armor 1 -> AC 14', () => {
    // 12 + 1 + min(1, 2) = 14, no penalty (14 >= 14).
    expect(playerArmorClass(defender(S({ STR: 14 }), { armorId: 'Jaaj Armor 1' }))).toBe(14);
  });
});

describe('playerArmorClass — unarmored fallback', () => {
  it('an unknown / empty armor id falls back to 10 + CONmod: CON 12/+1 -> AC 11', () => {
    expect(playerArmorClass(defender(S(), { armorId: 'None' }))).toBe(11);
    expect(playerArmorClass(defender(S(), { armorId: '' }))).toBe(11);
  });

  it('unarmored scales with CON: CON 16/+3 -> AC 13', () => {
    expect(playerArmorClass(defender(S({ CON: 16 }), { armorId: 'None' }))).toBe(13);
  });
});

describe('playerArmorClass — shield bonus (off-hand slot)', () => {
  it('a Buckler (acBonus 1) raises the default AC from 13 to 14', () => {
    expect(playerArmorClass(defender(S(), { shieldId: 'Buckler' }))).toBe(14);
  });

  it('a Kite Shield (acBonus 2) raises the default AC from 13 to 15', () => {
    expect(playerArmorClass(defender(S(), { shieldId: 'Kite Shield' }))).toBe(15);
  });

  it('an unknown shield id adds nothing (AC stays 13)', () => {
    expect(playerArmorClass(defender(S(), { shieldId: 'Tower Shield' }))).toBe(13);
  });

  it('shieldAcBonus is 0 with no shield and the exact acBonus with one', () => {
    expect(shieldAcBonus(createInventory())).toBe(0);
    expect(shieldAcBonus(inventoryWithGear({ offHand: 'Buckler' }))).toBe(1);
    expect(shieldAcBonus(inventoryWithGear({ offHand: 'Kite Shield' }))).toBe(2);
  });
});

describe('playerArmorClass — equipped-effect flatAc (M5 pipeline seam)', () => {
  it('void-plate (bonusArmorClass 2) raises AC by exactly 2 over an empty armor slot', () => {
    // void-plate lives ONLY in items.json (no armor.json row), so it is NOT a legacy armor:
    // armorForSlot -> undefined -> unarmored base 10 + CONmod (11), and its effect adds +2.
    const bare = defender(S(), { armorId: '' }); // unarmored 11
    const plated = { ...bare, inventory: inventoryWithGear({ armor: 'void-plate' }) };
    expect(playerArmorClass(bare)).toBe(11);
    expect(playerArmorClass(plated)).toBe(13); // 11 + flatAc 2
  });
});

describe('playerArmorClass — augment/deprivation cascade', () => {
  it('Hardy (healthy: CON +2 -> +1 mod) raises the default AC by 1 (13 -> 14)', () => {
    // effective CON 14 -> +2: 11 + 2 + min(1, 2) = 14.
    const p = defender(S(), {}, { activeConditions: [makeCondition('healthy')] });
    expect(playerArmorClass(p)).toBe(14);
  });

  it('Frail (sick: CON -2 -> -1 mod) lowers the default AC by 1 (13 -> 12)', () => {
    // effective CON 10 -> +0: 11 + 0 + min(1, 2) = 12.
    const p = defender(S(), {}, { activeConditions: [makeCondition('sick')] });
    expect(playerArmorClass(p)).toBe(12);
  });

  it('Quick (DEX +2) raises AC through the dexCap term (13 -> 14)', () => {
    // effective DEX 14 -> +2: 11 + 1 + min(2, 2) = 14.
    const p = defender(S(), {}, { activeConditions: [makeCondition('quick')] });
    expect(playerArmorClass(p)).toBe(14);
  });

  it('Slow (DEX -2) lowers AC through the dexCap term (13 -> 12)', () => {
    // effective DEX 10 -> +0: 11 + 1 + min(0, 2) = 12.
    const p = defender(S(), {}, { activeConditions: [makeCondition('slow')] });
    expect(playerArmorClass(p)).toBe(12);
  });

  it('the dexCap still bites under Quick: DEX 18/+4 capped at 2, Quick pushes to +5 but AC stays 14', () => {
    // effective DEX 20 -> +5, still min(5, 2) = 2: 11 + 1 + 2 = 14 (same as without Quick).
    const p = defender(S({ DEX: 18 }), {}, { activeConditions: [makeCondition('quick')] });
    expect(playerArmorClass(p)).toBe(14);
  });

  it('unmet strReq flips to met under Strong: STR 12 in Jaaj Armor 1 gains +2 when Strong', () => {
    // STR 12 < 14 -> penalty: 12 + 1 + 1 - 2 = 12. Strong -> effective STR 14 >= 14 -> no
    // penalty: 12 + 1 + 1 = 14.
    const weak = defender(S({ STR: 12 }), { armorId: 'Jaaj Armor 1' });
    expect(playerArmorClass(weak)).toBe(12);
    const strong = defender(
      S({ STR: 12 }),
      { armorId: 'Jaaj Armor 1' },
      { activeConditions: [makeCondition('strong')] },
    );
    expect(playerArmorClass(strong)).toBe(14);
  });
});

describe('enemyAdvDisVs — Scavver dodge wrapper', () => {
  it('a Scavver forces the enemy to disadvantage (-1); every other class is 0', () => {
    expect(enemyAdvDisVs({ classId: 'Scavver' })).toBe(-1);
    expect(enemyAdvDisVs({ classId: 'Enforcer' })).toBe(0);
    expect(enemyAdvDisVs({ classId: 'Neuromancer' })).toBe(0);
    expect(enemyAdvDisVs({ classId: 'Penitent' })).toBe(0);
    expect(enemyAdvDisVs({ classId: 'Hollow' })).toBe(0);
  });
});
