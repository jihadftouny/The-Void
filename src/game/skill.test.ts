import { describe, expect, it } from 'vitest';
import { SKILLS, computeSkillDamage, useSkill } from './skill.ts';
import { type Character } from './character.ts';
import { makeCondition, type ActiveCondition } from './condition.ts';

// Expected damage values are hand-derived from the Java resistance formula
//   damage = base - floor(res/100) * base
// with Pyro at element index 2 and Cryo at index 1 (elements.json order).

function caster(
  overrides: Partial<Character & { activeConditions: ActiveCondition[] }> = {},
): Character & { activeConditions: ActiveCondition[] } {
  return {
    name: 'Enemy',
    stats: { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 },
    mods: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 },
    hp: 30,
    maxHp: 30,
    xp: 2,
    armorClass: 10,
    skillCharges: 2,
    maxSkillCharges: 2,
    hitDie: { quantity: 1, sides: 8 },
    activeConditions: [],
    ...overrides,
  };
}

function target(overrides: Partial<Character & { activeConditions: ActiveCondition[]; resistances: number[]; classId: string }> = {}) {
  return {
    name: 'Hero',
    classId: 'Enforcer',
    stats: { STR: 18, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
    mods: { STR: 4, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 },
    hp: 20,
    maxHp: 20,
    xp: 0,
    armorClass: 12,
    skillCharges: 5,
    maxSkillCharges: 5,
    hitDie: { quantity: 1, sides: 10 },
    activeConditions: [] as ActiveCondition[],
    resistances: [0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

describe('computeSkillDamage — resistance formula', () => {
  it('Pyro Ball base 2 at 0 resistance is 2', () => {
    expect(computeSkillDamage(SKILLS.pyroBall, { resistances: [0, 0, 0, 0, 0, 0, 0] })).toBe(2);
  });
  it('Pyro Ball at 100% pyro resistance is 0', () => {
    expect(computeSkillDamage(SKILLS.pyroBall, { resistances: [0, 0, 100, 0, 0, 0, 0] })).toBe(2 - 1 * 2);
  });
  it('Pyro Ball at 50% pyro resistance is still 2 (floor(50/100)=0)', () => {
    expect(computeSkillDamage(SKILLS.pyroBall, { resistances: [0, 0, 50, 0, 0, 0, 0] })).toBe(2);
  });
  it('Freeze! base 1 at 0 resistance is 1', () => {
    expect(computeSkillDamage(SKILLS.freeze, { resistances: [0, 0, 0, 0, 0, 0, 0] })).toBe(1);
  });
});

describe('useSkill — Freeze! (charge spend, damage, condition applied)', () => {
  it('spends one charge, deals 1, and appends freeze to the target', () => {
    const c = caster({ skillCharges: 2 });
    const t = target();
    const r = useSkill(c, t, SKILLS.freeze);

    expect(r.caster.skillCharges).toBe(1);
    expect(r.damage).toBe(1);
    expect(r.target.activeConditions).toEqual([{ type: 'freeze', remainingTurns: 2, maxTurns: 2 }]);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'freeze', name: 'Freeze!' },
      { kind: 'condition-applied', subject: 'player', conditionType: 'freeze' },
    ]);
  });

  it('does not add freeze twice when the target already has it (dedup)', () => {
    const t = target({ activeConditions: [makeCondition('freeze')] });
    const r = useSkill(caster(), t, SKILLS.freeze);
    expect(r.target.activeConditions).toHaveLength(1);
    // No condition-applied event when nothing new was added.
    expect(r.events).toEqual([{ kind: 'enemy-skill-used', skillId: 'freeze', name: 'Freeze!' }]);
  });
});

describe('useSkill — Pyro Ball applies no condition', () => {
  it('deals 2 and leaves the target conditions empty', () => {
    const r = useSkill(caster(), target(), SKILLS.pyroBall);
    expect(r.damage).toBe(2);
    expect(r.target.activeConditions).toEqual([]);
    expect(r.events).toEqual([{ kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' }]);
  });
});

describe('useSkill — INT cascade skill power (Sharp/Dull)', () => {
  // base INT 14 -> mod 2. smart (+2 INT -> 16 -> mod 3) = +1 delta; dumb (-2 -> 12 ->
  // mod 1) = -1 delta. Ember base 2 at 0 resistance: Sharp -> 2+1 = 3, Dull -> 2-1 = 1,
  // no augment -> 2. Hand-derived from floor((stat-10)/2).
  const int14 = { STR: 13, DEX: 13, CON: 13, INT: 14, WIS: 13, CHA: 13 };
  it('Sharp (+1 INT mod) adds 1 to skill damage', () => {
    const c = caster({ stats: int14, activeConditions: [makeCondition('smart')] });
    expect(useSkill(c, target(), SKILLS.ember).damage).toBe(3);
  });
  it('Dull (-1 INT mod) subtracts 1 from skill damage', () => {
    const c = caster({ stats: int14, activeConditions: [makeCondition('dumb')] });
    expect(useSkill(c, target(), SKILLS.ember).damage).toBe(1);
  });
  it('no INT augment leaves the base damage unchanged (enemy path)', () => {
    const c = caster({ stats: int14 });
    expect(useSkill(c, target(), SKILLS.ember).damage).toBe(2);
  });
});

describe('useSkill — starter pool casts (damage + condition)', () => {
  it('strike deals base 2 (Physical) and applies bleed', () => {
    const r = useSkill(caster(), target(), SKILLS.strike);
    expect(r.damage).toBe(2);
    expect(r.target.activeConditions).toEqual([makeCondition('bleed')]);
    expect(r.events).toContainEqual({ kind: 'condition-applied', subject: 'player', conditionType: 'bleed' });
  });
  it('venom deals base 1 (Poison) and applies poison; a second cast stacks intensity 2', () => {
    const once = useSkill(caster(), target(), SKILLS.venom);
    expect(once.damage).toBe(1);
    expect(once.target.activeConditions).toEqual([makeCondition('poison')]);
    // Second cast onto the already-poisoned target -> stacked (intensity 2), event still fires.
    const twice = useSkill(caster(), once.target, SKILLS.venom);
    expect(twice.target.activeConditions).toEqual([
      { type: 'poison', remainingTurns: 2, maxTurns: 2, intensity: 2 },
    ]);
    expect(twice.events).toContainEqual({ kind: 'condition-applied', subject: 'player', conditionType: 'poison' });
  });
  it('enfeeble applies the deprivation weak to the enemy target', () => {
    const r = useSkill(caster(), target(), SKILLS.enfeeble);
    expect(r.damage).toBe(1);
    expect(r.target.activeConditions).toEqual([makeCondition('weak')]);
  });
});

describe('M3 kit skill data (rows are content, not logic)', () => {
  // Spot-check a few kit rows against the plan's per-class table (element/cost/base/
  // conditions), hand-transcribed from the design — not read off the impl.
  it('carries the tabled base fields for representative kit skills', () => {
    expect(SKILLS.heavyStrike.element).toBe('Physical');
    expect(SKILLS.heavyStrike.chargeCost).toBe(2);
    expect(SKILLS.heavyStrike.baseDamage).toBe(3);
    expect(SKILLS.heavyStrike.conditions).toEqual(['fracture']);

    expect(SKILLS.synapse.element).toBe('Electro');
    expect(SKILLS.synapse.conditions).toEqual([]);

    expect(SKILLS.corrupt.element).toBe('Poison');
    expect(SKILLS.corrupt.conditions).toEqual(['poison', 'insanity']);

    expect(SKILLS.smite.element).toBe('Force');
    expect(SKILLS.smite.baseDamage).toBe(3);
  });

  it('exposes the optional twist knobs as data on the right skills', () => {
    expect(SKILLS.heavyStrike.spendMomentum).toBe(true);
    expect(SKILLS.heavyStrike.momentumDamagePer).toBe(1);
    expect(SKILLS.synapse.detonate).toEqual({ damagePer: 2, group: 'mental' });
    expect(SKILLS.venomCoat.exposureScale).toBe(1);
    expect(SKILLS.backstab.appliesExposure).toBe(1);
    expect(SKILLS.smite.hpCost).toBe(2);
    expect(SKILLS.smite.scaleStat).toBe('WIS');
    expect(SKILLS.sacrifice.maxHpCost).toBe(3);
    expect(SKILLS.unmake.corruptionScale).toBe(1);
    expect(SKILLS.siphon.lifestealFraction).toBe(0.5);
    // A twist-free generic skill has NO twist knobs (so castSkill == useSkill for it).
    expect(SKILLS.strike.spendMomentum).toBeUndefined();
    expect(SKILLS.strike.detonate).toBeUndefined();
    expect(SKILLS.strike.hpCost).toBeUndefined();
  });
});

describe('useSkill — purity', () => {
  it('does not mutate the input caster or target', () => {
    const c = caster({ skillCharges: 2 });
    const t = target();
    const cSnap = JSON.parse(JSON.stringify(c));
    const tSnap = JSON.parse(JSON.stringify(t));
    useSkill(c, t, SKILLS.freeze);
    expect(c).toEqual(cSnap);
    expect(t).toEqual(tSnap);
  });
});
