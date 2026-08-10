import { describe, expect, it } from 'vitest';
import {
  AUGMENT_DEPRIVATION,
  RESIST_PER_WIS_MOD,
  conditionStatDelta,
  effectiveStats,
  effectiveMods,
  statModDelta,
  effectiveArmorClass,
  effectiveMaxHp,
  effectiveResistances,
  initiativeOrderTwist,
  illusionSightTwist,
  dealQualityTwist,
  type Conditioned,
} from './statEffects.ts';
import { makeCondition, type ActiveCondition, type ConditionType } from './condition.ts';
import { computeStatMod, type Character, type Stats } from './character.ts';

// Every expected number is hand-derived from:
//   computeStatMod(s) = floor((s - 10) / 2)  (standard D&D)
//   augment/deprivation = ±2 stat  =>  exactly ±1 mod
//   effectiveArmorClass = AC + CON-mod-delta + DEX-mod-delta
//   effectiveMaxHp      = maxHp + CON-mod-delta
//   effectiveResistances = each resist + RESIST_PER_WIS_MOD * WIS-mod-delta
// Base stats are all 14 (mod +2) unless a case says otherwise.

function char(
  overrides: Partial<Character & { activeConditions: ActiveCondition[]; resistances: number[] }> = {},
): Conditioned & { resistances: number[] } {
  const stats: Stats = { STR: 14, DEX: 14, CON: 14, INT: 14, WIS: 14, CHA: 14 };
  const base = {
    name: 'Subject',
    stats,
    mods: {
      STR: computeStatMod(stats.STR),
      DEX: computeStatMod(stats.DEX),
      CON: computeStatMod(stats.CON),
      INT: computeStatMod(stats.INT),
      WIS: computeStatMod(stats.WIS),
      CHA: computeStatMod(stats.CHA),
    },
    hp: 20,
    maxHp: 20,
    xp: 0,
    armorClass: 12,
    skillCharges: 5,
    maxSkillCharges: 5,
    hitDie: { quantity: 1, sides: 10 },
    activeConditions: [] as ActiveCondition[],
    resistances: [0, 0, 0, 0, 0, 0, 0],
  };
  return { ...base, ...overrides };
}

const withCond = (type: ConditionType) => char({ activeConditions: [makeCondition(type)] });

describe('AUGMENT_DEPRIVATION table', () => {
  it('has exactly the twelve augment/deprivation entries with ±2 deltas', () => {
    expect(Object.keys(AUGMENT_DEPRIVATION).sort()).toEqual(
      [
        'charming', 'dumb', 'fool', 'healthy', 'quick', 'repulsive',
        'sick', 'slow', 'smart', 'strong', 'weak', 'wise',
      ].sort(),
    );
    expect(AUGMENT_DEPRIVATION.strong).toEqual({ stat: 'STR', delta: 2 });
    expect(AUGMENT_DEPRIVATION.weak).toEqual({ stat: 'STR', delta: -2 });
    expect(AUGMENT_DEPRIVATION.quick).toEqual({ stat: 'DEX', delta: 2 });
    expect(AUGMENT_DEPRIVATION.slow).toEqual({ stat: 'DEX', delta: -2 });
    expect(AUGMENT_DEPRIVATION.healthy).toEqual({ stat: 'CON', delta: 2 });
    expect(AUGMENT_DEPRIVATION.sick).toEqual({ stat: 'CON', delta: -2 });
    expect(AUGMENT_DEPRIVATION.smart).toEqual({ stat: 'INT', delta: 2 });
    expect(AUGMENT_DEPRIVATION.dumb).toEqual({ stat: 'INT', delta: -2 });
    expect(AUGMENT_DEPRIVATION.wise).toEqual({ stat: 'WIS', delta: 2 });
    expect(AUGMENT_DEPRIVATION.fool).toEqual({ stat: 'WIS', delta: -2 });
    expect(AUGMENT_DEPRIVATION.charming).toEqual({ stat: 'CHA', delta: 2 });
    expect(AUGMENT_DEPRIVATION.repulsive).toEqual({ stat: 'CHA', delta: -2 });
  });
});

describe('conditionStatDelta', () => {
  it('sums only the deltas for the requested stat', () => {
    const conds = [makeCondition('strong'), makeCondition('slow')];
    expect(conditionStatDelta(conds, 'STR')).toBe(2); // strong
    expect(conditionStatDelta(conds, 'DEX')).toBe(-2); // slow
    expect(conditionStatDelta(conds, 'CON')).toBe(0); // untouched
  });
  it('is 0 for a non-augment condition (poison contributes no stat delta)', () => {
    expect(conditionStatDelta([makeCondition('poison')], 'STR')).toBe(0);
  });
});

describe('effectiveStats / effectiveMods — STR cascade (Strong/Weak)', () => {
  it('strong: STR 14 -> 16, mod 2 -> 3; other stats unchanged', () => {
    const c = withCond('strong');
    expect(effectiveStats(c).STR).toBe(16);
    expect(effectiveMods(c).STR).toBe(3); // floor((16-10)/2)
    expect(effectiveMods(c).DEX).toBe(2); // untouched
  });
  it('weak: STR 14 -> 12, mod 2 -> 1', () => {
    const c = withCond('weak');
    expect(effectiveStats(c).STR).toBe(12);
    expect(effectiveMods(c).STR).toBe(1); // floor((12-10)/2)
  });
});

describe('statModDelta — ±2 stat is exactly ±1 mod, parity-independent', () => {
  it('strong +1, weak -1, no condition 0 (base 14, even)', () => {
    expect(statModDelta(withCond('strong'), 'STR')).toBe(1);
    expect(statModDelta(withCond('weak'), 'STR')).toBe(-1);
    expect(statModDelta(char(), 'STR')).toBe(0);
  });
  it('holds at an ODD base stat 15 (mod 2 -> 17 mod 3 -> +1; -> 13 mod 1 -> -1)', () => {
    const odd = { STR: 15, DEX: 15, CON: 15, INT: 15, WIS: 15, CHA: 15 };
    const strong = char({ stats: odd, activeConditions: [makeCondition('strong')] });
    const weak = char({ stats: odd, activeConditions: [makeCondition('weak')] });
    expect(computeStatMod(15)).toBe(2); // floor(5/2)
    expect(statModDelta(strong, 'STR')).toBe(1); // 17 -> mod 3
    expect(statModDelta(weak, 'STR')).toBe(-1); // 13 -> mod 1
  });
});

describe('effectiveArmorClass — Hardy/Frail (CON) + Quick/Slow (DEX) evasion', () => {
  it('healthy +1, sick -1, quick +1, stacked healthy+quick +2, none unchanged', () => {
    expect(effectiveArmorClass(withCond('healthy'))).toBe(13); // 12 + 1
    expect(effectiveArmorClass(withCond('sick'))).toBe(11); // 12 - 1
    expect(effectiveArmorClass(withCond('quick'))).toBe(13); // 12 + 1
    expect(
      effectiveArmorClass(char({ activeConditions: [makeCondition('healthy'), makeCondition('quick')] })),
    ).toBe(14); // 12 + 1 + 1
    expect(effectiveArmorClass(char())).toBe(12);
  });
});

describe('effectiveMaxHp — Hardy/Frail (CON) cap', () => {
  it('healthy +1, sick -1, none unchanged', () => {
    expect(effectiveMaxHp(withCond('healthy'))).toBe(21); // 20 + 1
    expect(effectiveMaxHp(withCond('sick'))).toBe(19); // 20 - 1
    expect(effectiveMaxHp(char())).toBe(20);
  });
});

describe('effectiveResistances — Lucid/Clouded (WIS) ± portion', () => {
  it('wise +10 to every element, fool -10, none unchanged', () => {
    expect(RESIST_PER_WIS_MOD).toBe(10);
    expect(effectiveResistances(withCond('wise'))).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(effectiveResistances(withCond('fool'))).toEqual([-10, -10, -10, -10, -10, -10, -10]);
    expect(effectiveResistances(char())).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('off-equivalence — no augment/deprivation returns the stored base', () => {
  it('every accessor is identity when no condition is active', () => {
    const c = char();
    expect(effectiveStats(c)).toEqual(c.stats);
    expect(effectiveMods(c)).toEqual(c.mods);
    expect(effectiveArmorClass(c)).toBe(c.armorClass);
    expect(effectiveMaxHp(c)).toBe(c.maxHp);
    expect(effectiveResistances(c)).toEqual(c.resistances);
  });
  it('a non-augment condition (bleed) also leaves stats untouched', () => {
    const c = withCond('bleed');
    expect(effectiveStats(c)).toEqual(c.stats);
    expect(effectiveMods(c)).toEqual(c.mods);
  });
});

describe('purity', () => {
  it('accessors do not mutate the input character', () => {
    const c = withCond('strong');
    const snap = JSON.parse(JSON.stringify(c));
    effectiveStats(c);
    effectiveMods(c);
    effectiveArmorClass(c);
    effectiveMaxHp(c);
    effectiveResistances(c);
    expect(c).toEqual(snap);
  });
});

describe('deferred-twist no-op hooks are wired and currently inert', () => {
  it('initiative/illusion/deal-quality all return 0 even with their augment active', () => {
    expect(initiativeOrderTwist(withCond('quick'))).toBe(0);
    expect(initiativeOrderTwist(withCond('slow'))).toBe(0);
    expect(illusionSightTwist(withCond('wise'))).toBe(0);
    expect(illusionSightTwist(withCond('fool'))).toBe(0);
    expect(dealQualityTwist(withCond('charming'))).toBe(0);
    expect(dealQualityTwist(withCond('repulsive'))).toBe(0);
  });
});
