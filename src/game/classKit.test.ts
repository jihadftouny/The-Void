import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  MENTAL_CONDITIONS,
  MOMENTUM_CAP,
  castSkill,
  clampMomentum,
  grantMomentum,
  scavverEvasionTwist,
  usesMomentum,
} from './classKit.ts';
import { SKILLS } from './skill.ts';
import { useSkill } from './skill.ts';
import { type Character } from './character.ts';
import { makeCondition, type ActiveCondition, type ConditionType } from './condition.ts';

// Every expected number below is hand-derived from the provisional constants in the plan
// and classKit.ts + the input state — NEVER read off the implementation. All magnitudes
// are M15 balance placeholders; the anchor is the RULE (base + twist arithmetic), so if a
// constant is retuned the derivation is re-done here. Element indices (elements.json):
// Physical 0, Cryo 1, Pyro 2, Electro 3, Poison 4, Psychic 5, Force 6 — all at 0 resistance
// so `computeSkillDamage` returns the base, and the caster carries no INT augment so
// `useSkill`'s INT delta is 0.

/** A player-like caster: has `classId` (so subjectOf -> 'player') + resource fields. */
function makeCaster(
  overrides: Partial<
    Character & { activeConditions: ActiveCondition[]; classId: string; momentum?: number; corruption?: number }
  > = {},
) {
  return {
    name: 'Hero',
    classId: 'Enforcer',
    // WIS 16 -> mod +3 (drives Smite's scaleStat); the rest are neutral.
    stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 16, CHA: 10 },
    mods: { STR: 2, DEX: 1, CON: 2, INT: 0, WIS: 3, CHA: 0 },
    hp: 20,
    maxHp: 20,
    xp: 0,
    armorClass: 12,
    skillCharges: 5,
    maxSkillCharges: 5,
    hitDie: { quantity: 1, sides: 10 },
    activeConditions: [] as ActiveCondition[],
    momentum: 0,
    corruption: 0,
    ...overrides,
  };
}

/** An enemy-like target: NO `classId` (so subjectOf -> 'enemy'), 0 resistances. */
function makeTarget(
  overrides: Partial<Character & { activeConditions: ActiveCondition[]; resistances: number[] }> = {},
) {
  return {
    name: 'Beast',
    stats: { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 },
    mods: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 },
    hp: 30,
    maxHp: 30,
    xp: 2,
    armorClass: 10,
    skillCharges: 0,
    maxSkillCharges: 0,
    hitDie: { quantity: 1, sides: 8 },
    activeConditions: [] as ActiveCondition[],
    resistances: [0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

function condition(type: ConditionType, intensity?: number): ActiveCondition {
  const c = makeCondition(type);
  return intensity === undefined ? c : { ...c, intensity };
}

describe('CLASSES roster', () => {
  it('has all five classes with a four-skill kit each and the expected resources', () => {
    expect(Object.keys(CLASSES).sort()).toEqual(
      ['Enforcer', 'Hollow', 'Neuromancer', 'Penitent', 'Scavver'].sort(),
    );
    for (const def of Object.values(CLASSES)) {
      expect(def.kit).toHaveLength(4);
      // Every kit id resolves to a real SKILLS row.
      for (const id of def.kit) expect(SKILLS[id]).toBeDefined();
    }
    expect(CLASSES.Enforcer.resource).toBe('momentum');
    expect(CLASSES.Hollow.resource).toBe('corruption');
    expect(usesMomentum({ classId: 'Enforcer' })).toBe(true);
    expect(usesMomentum({ classId: 'Neuromancer' })).toBe(false);
  });
});

describe('Enforcer / Momentum', () => {
  it('Heavy Strike at momentum 4 deals 3 + 1x4 = 7 and empties momentum to 0', () => {
    const caster = makeCaster({ momentum: 4, skillCharges: 5 });
    const r = castSkill(caster, makeTarget(), SKILLS.heavyStrike);
    expect(r.damage).toBe(7); // base 3 + momentumDamagePer 1 * momentum 4
    expect(r.caster.momentum).toBe(0);
    expect(r.caster.skillCharges).toBe(3); // heavyStrike costs 2
    // It still applies its condition (fracture) via the base useSkill layer.
    expect(r.target.activeConditions.some((c) => c.type === 'fracture')).toBe(true);
    expect(r.events).toContainEqual({ kind: 'resource-changed', subject: 'player', resource: 'momentum', value: 0 });
  });

  it('Brace grants +2 momentum (0 damage) and self-buffs; the cap clamps at 5', () => {
    const r = castSkill(makeCaster({ momentum: 0 }), makeTarget(), SKILLS.brace);
    expect(r.damage).toBe(0);
    expect(r.caster.momentum).toBe(2);
    expect(r.caster.activeConditions.some((c) => c.type === 'healthy')).toBe(true);
    expect(r.events).toContainEqual({ kind: 'resource-changed', subject: 'player', resource: 'momentum', value: 2 });

    // At momentum 4, +2 would be 6 -> clamped to the cap 5.
    const capped = castSkill(makeCaster({ momentum: 4 }), makeTarget(), SKILLS.brace);
    expect(capped.caster.momentum).toBe(MOMENTUM_CAP);
    expect(MOMENTUM_CAP).toBe(5);
  });

  it('Execute adds its bloodied bonus only when the target is at/below 50% max HP', () => {
    // target hp 5 / maxHp 10 -> 5 <= 5 -> execute base 2 + bonus 4 = 6, applies bleed.
    const bloodied = castSkill(makeCaster(), makeTarget({ hp: 5, maxHp: 10 }), SKILLS.execute);
    expect(bloodied.damage).toBe(6);
    expect(bloodied.target.activeConditions.some((c) => c.type === 'bleed')).toBe(true);
    // target hp 6 / maxHp 10 -> 6 > 5 -> no bonus -> base 2.
    const healthy = castSkill(makeCaster(), makeTarget({ hp: 6, maxHp: 10 }), SKILLS.execute);
    expect(healthy.damage).toBe(2);
  });
});

describe('Neuromancer / Detonate', () => {
  it('Synapse consumes 3 mental conditions for 1 + 2x3 = 7 and leaves non-mental intact', () => {
    const target = makeTarget({
      activeConditions: [
        condition('insanity'),
        condition('sleep'),
        condition('dumb'),
        condition('bleed'), // non-mental — must survive
      ],
    });
    const r = castSkill(makeCaster({ classId: 'Neuromancer' }), target, SKILLS.synapse);
    expect(r.damage).toBe(7); // base 1 + damagePer 2 * 3 mental
    const remaining = r.target.activeConditions.map((c) => c.type).sort();
    expect(remaining).toEqual(['bleed']);
    expect(r.events).toContainEqual({ kind: 'detonate', consumed: 3, bonusDamage: 6 });
  });

  it('the mental set is exactly the nine psyche conditions', () => {
    expect([...MENTAL_CONDITIONS].sort()).toEqual(
      ['dumb', 'fool', 'freeze', 'insanity', 'repulsive', 'sick', 'sleep', 'slow', 'weak'].sort(),
    );
  });
});

describe('Scavver / Exposure', () => {
  it('Venom Coat at exposed intensity 3 deals 1 + 1x3 = 4, applies poison, and does not consume the mark', () => {
    const target = makeTarget({ activeConditions: [condition('exposed', 3)] });
    const r = castSkill(makeCaster({ classId: 'Scavver' }), target, SKILLS.venomCoat);
    expect(r.damage).toBe(4); // base 1 + exposureScale 1 * intensity 3
    expect(r.target.activeConditions.some((c) => c.type === 'poison')).toBe(true);
    const mark = r.target.activeConditions.find((c) => c.type === 'exposed');
    expect(mark?.intensity).toBe(3); // still 3 — exposureScale reads, never consumes
  });

  it('Backstab stacks exposed intensity by 1 per cast (DoT-style)', () => {
    const first = castSkill(makeCaster({ classId: 'Scavver' }), makeTarget(), SKILLS.backstab);
    const mark1 = first.target.activeConditions.find((c) => c.type === 'exposed');
    expect(mark1).toBeDefined();
    expect(mark1?.intensity ?? 1).toBe(1); // fresh mark reads as intensity 1

    const second = castSkill(makeCaster({ classId: 'Scavver' }), first.target, SKILLS.backstab);
    const mark2 = second.target.activeConditions.find((c) => c.type === 'exposed');
    expect(mark2?.intensity).toBe(2); // stacked to 2
  });

  it('Scavenge nets +1 charge (spends 1, restores 2), clamped to the max', () => {
    const r = castSkill(makeCaster({ classId: 'Scavver', skillCharges: 3, maxSkillCharges: 5 }), makeTarget(), SKILLS.scavenge);
    expect(r.caster.skillCharges).toBe(4); // 3 - 1 (cost) + 2 (restore)
    const capped = castSkill(makeCaster({ classId: 'Scavver', skillCharges: 5, maxSkillCharges: 5 }), makeTarget(), SKILLS.scavenge);
    expect(capped.caster.skillCharges).toBe(5); // 5 - 1 + 2 = 6 -> clamp to 5
  });
});

describe('Penitent / Martyr (HP-as-fuel)', () => {
  it('Smite (WIS 16 -> +3) deals 3 + 3 = 6 and costs the caster 2 HP', () => {
    const r = castSkill(makeCaster({ classId: 'Penitent', hp: 20, maxHp: 20 }), makeTarget(), SKILLS.smite);
    expect(r.damage).toBe(6); // base 3 + scaleStat WIS mod +3
    expect(r.caster.hp).toBe(18); // 20 - hpCost 2
    expect(r.events).toContainEqual({ kind: 'self-sacrifice', amount: 2, ofMaxHp: false });
  });

  it('hpCost never drops the caster below 1 HP (provisional clamp)', () => {
    // Martyr hpCost 5 with the caster at 3 HP -> clamps to 1 (paid 2, not 5).
    const r = castSkill(makeCaster({ classId: 'Penitent', hp: 3, maxHp: 20 }), makeTarget(), SKILLS.martyr);
    expect(r.caster.hp).toBe(1);
    expect(r.events).toContainEqual({ kind: 'self-sacrifice', amount: 2, ofMaxHp: false });
  });

  it('Mend heals the caster +4 (clamped to effective max HP) and deals 0', () => {
    const r = castSkill(makeCaster({ classId: 'Penitent', hp: 10, maxHp: 20 }), makeTarget(), SKILLS.mend);
    expect(r.damage).toBe(0);
    expect(r.caster.hp).toBe(14); // 10 + 4
    const near = castSkill(makeCaster({ classId: 'Penitent', hp: 19, maxHp: 20 }), makeTarget(), SKILLS.mend);
    expect(near.caster.hp).toBe(20); // 19 + 4 -> clamp to 20
  });
});

describe('Hollow / Corruption', () => {
  it('Sacrifice lowers maxHp by 3 and raises corruption to 3', () => {
    const r = castSkill(makeCaster({ classId: 'Hollow', hp: 20, maxHp: 20, corruption: 0 }), makeTarget(), SKILLS.sacrifice);
    expect(r.caster.maxHp).toBe(17); // 20 - maxHpCost 3
    expect(r.caster.hp).toBe(17); // hp clamped down to the new max
    expect(r.caster.corruption).toBe(3); // +1 per max-HP point sacrificed
    expect(r.events).toContainEqual({ kind: 'self-sacrifice', amount: 3, ofMaxHp: true });
    expect(r.events).toContainEqual({ kind: 'resource-changed', subject: 'player', resource: 'corruption', value: 3 });
  });

  it('Unmake at corruption 3 deals 3 + 1x3 = 6 and lifesteals floor(6 x 0.5) = 3', () => {
    const r = castSkill(makeCaster({ classId: 'Hollow', hp: 10, maxHp: 30, corruption: 3 }), makeTarget(), SKILLS.unmake);
    expect(r.damage).toBe(6); // base 3 + corruptionScale 1 * corruption 3
    expect(r.caster.hp).toBe(13); // 10 + floor(6 * 0.5) = 10 + 3
    expect(r.events).toContainEqual({ kind: 'lifesteal', amount: 3 });
  });

  it('Siphon deals 3 and lifesteals floor(3 x 0.5) = 1', () => {
    const r = castSkill(makeCaster({ classId: 'Hollow', hp: 10, maxHp: 30 }), makeTarget(), SKILLS.siphon);
    expect(r.damage).toBe(3);
    expect(r.caster.hp).toBe(11); // 10 + floor(1.5) = 11
    expect(r.events).toContainEqual({ kind: 'lifesteal', amount: 1 });
  });
});

describe('off-equivalence — a twist-free skill through castSkill equals useSkill', () => {
  it('strike (no twist knobs) yields the identical caster/target/damage/events', () => {
    const caster = makeCaster({ momentum: 2, corruption: 1 });
    const target = makeTarget();
    const viaCast = castSkill(caster, target, SKILLS.strike);
    const viaUse = useSkill(caster, target, SKILLS.strike);
    expect(viaCast).toEqual(viaUse);
    // And the resource fields are untouched by a twist-free cast.
    expect(viaCast.caster.momentum).toBe(2);
    expect(viaCast.caster.corruption).toBe(1);
  });

  it('purity — castSkill mutates neither input', () => {
    const caster = makeCaster({ momentum: 4 });
    const target = makeTarget({ activeConditions: [condition('insanity'), condition('sleep')] });
    const cSnap = JSON.parse(JSON.stringify(caster));
    const tSnap = JSON.parse(JSON.stringify(target));
    castSkill(caster, target, SKILLS.heavyStrike);
    castSkill(caster, target, SKILLS.synapse);
    expect(caster).toEqual(cSnap);
    expect(target).toEqual(tSnap);
  });
});

describe('helpers', () => {
  it('clampMomentum bounds to [0, cap]', () => {
    expect(clampMomentum(-3)).toBe(0);
    expect(clampMomentum(3)).toBe(3);
    expect(clampMomentum(99)).toBe(MOMENTUM_CAP);
  });

  it('grantMomentum treats an absent field as 0 and clamps', () => {
    expect(grantMomentum({} as { momentum?: number }, 1).momentum).toBe(1);
    expect(grantMomentum({ momentum: 5 }, 2).momentum).toBe(5);
  });

  it('scavverEvasionTwist gives a Scavver -1 (enemy attacks at disadvantage), others 0', () => {
    expect(scavverEvasionTwist({ classId: 'Scavver' })).toBe(-1);
    expect(scavverEvasionTwist({ classId: 'Enforcer' })).toBe(0);
    expect(scavverEvasionTwist({ classId: 'Hollow' })).toBe(0);
  });
});
