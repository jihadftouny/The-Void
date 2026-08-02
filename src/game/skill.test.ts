import { describe, expect, it } from 'vitest';
import { SKILLS, computeSkillDamage, useSkill } from './skill.ts';
import { type Character } from './character.ts';
import { makeCondition, type ActiveCondition } from './condition.ts';

// Expected damage values are hand-derived from the Java resistance formula
//   damage = base - floor(res/100) * base
// with Pyro at element index 2 and Cryo at index 1 (elements.json order).

function caster(overrides: Partial<Character> = {}): Character {
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
