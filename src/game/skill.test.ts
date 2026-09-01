import { describe, expect, it } from 'vitest';
import {
  SKILLS,
  computeSkillDamage,
  useSkill,
  resolveSkill,
  applySkillUpgrade,
  type SkillUpgrade,
  type SkillId,
} from './skill.ts';
import { type Character } from './character.ts';
import { makeCondition, type ActiveCondition, type ConditionType } from './condition.ts';
import { RESIST_PER_WIS_MOD } from './statEffects.ts';
import { AFFIXES } from './enemyAffix.ts';

/** The shipped `blessed` affix row — its `resistBonus` is the data premise for G17 below. */
const BLESSED = AFFIXES.find((a) => a.id === 'blessed')!;

// Expected damage values are hand-derived from the resistance formula
//   damage = max(0, base - round(base * clamp(res, 0, 100) / 100))
// with Pyro at element index 2 and Cryo at index 1 (elements.json order).
//
// ⚠ CHANGED by G17. The formula used to be the faithful Java port
// `base - floor(res / 100) * base` — and `floor(res / 100)` is ZERO for every resistance
// below 100, while NOTHING in the game produced 100 (the `blessed` affix gave 2, family
// themes 2, `RESIST_PER_WIS_MOD` 10). So the entire resistance subsystem was inert: seven
// elements, five family themes, the `blessed` affix, the `bonusResist` item effect and two
// conditions, all dead. The case below that asserted "50% resistance is still 2" was
// ASSERTING THE BUG, in so many words, and is corrected rather than deleted.

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
    // 2 - round(2 * 100/100) = 2 - 2 = 0.
    expect(computeSkillDamage(SKILLS.pyroBall, { resistances: [0, 0, 100, 0, 0, 0, 0] })).toBe(0);
  });
  it('Pyro Ball at 50% pyro resistance is 1 — resistance finally MITIGATES', () => {
    // WAS: "still 2 (floor(50/100)=0)" — the test asserted the defect verbatim.
    // NOW, hand-derived: 2 - round(2 * 50/100) = 2 - round(1) = 1.
    expect(computeSkillDamage(SKILLS.pyroBall, { resistances: [0, 0, 50, 0, 0, 0, 0] })).toBe(1);
  });
  it('resistance below 100 is no longer silently ignored, and negatives clamp to 0', () => {
    // The whole point of G17: partial resistance does something. Each value hand-derived.
    const at = (res: number) =>
      computeSkillDamage(SKILLS.pyroBall, { resistances: [0, 0, res, 0, 0, 0, 0] });
    expect(at(0)).toBe(2); // 2 - round(0)   = 2
    expect(at(24)).toBe(2); // 2 - round(0.48) = 2 - 0 = 2
    expect(at(25)).toBe(1); // 2 - round(0.5)  = 2 - 1 = 1  (Math.round is half-up)
    expect(at(50)).toBe(1); // 2 - round(1)    = 1
    expect(at(99)).toBe(0); // 2 - round(1.98) = 2 - 2 = 0
    // Vulnerability is NOT a feature yet: a negative resistance is clamped, not amplified.
    expect(at(-50)).toBe(2);
    // …and an out-of-range resistance cannot drive damage below 0.
    expect(at(500)).toBe(0);
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

// ------- M9 skill upgrades (resolveSkill / applySkillUpgrade) -----------------
// Expected values hand-derived from the heavyStrike row (baseDamage 3, chargeCost 2,
// conditions ['fracture']) and the SkillUpgrade merge rules.

describe('resolveSkill — merges an owned upgrade, else returns the base def', () => {
  it('no upgrade returns the EXACT base def (referential + deep equal, off-equivalence)', () => {
    const resolved = resolveSkill({ skillUpgrades: {} }, 'heavyStrike');
    expect(resolved).toBe(SKILLS.heavyStrike); // same reference
    expect(resolved).toEqual(SKILLS.heavyStrike);
    // A player with no skillUpgrades field at all also gets the base.
    expect(resolveSkill({}, 'heavyStrike')).toBe(SKILLS.heavyStrike);
  });

  it('damageBonus +2 raises baseDamage 3 -> 5 (cost/conditions unchanged)', () => {
    const resolved = resolveSkill(
      { skillUpgrades: { heavyStrike: { damageBonus: 2 } } },
      'heavyStrike',
    );
    expect(resolved.baseDamage).toBe(5);
    expect(resolved.chargeCost).toBe(2);
    expect(resolved.conditions).toEqual(['fracture']);
    // Purity: the base table is untouched.
    expect(SKILLS.heavyStrike.baseDamage).toBe(3);
  });

  it('chargeDelta -1 lowers chargeCost 2 -> 1, and clamps at 0', () => {
    expect(resolveSkill({ skillUpgrades: { heavyStrike: { chargeDelta: -1 } } }, 'heavyStrike').chargeCost).toBe(1);
    // -3 would give -1 -> clamped to 0.
    expect(resolveSkill({ skillUpgrades: { heavyStrike: { chargeDelta: -3 } } }, 'heavyStrike').chargeCost).toBe(0);
  });

  it('addConditions are unioned onto the inflicted conditions', () => {
    const resolved = resolveSkill(
      { skillUpgrades: { heavyStrike: { addConditions: ['burn'] } } },
      'heavyStrike',
    );
    expect(resolved.conditions).toEqual(['fracture', 'burn']);
  });
});

describe('applySkillUpgrade — accumulates onto any existing entry', () => {
  it('first upgrade folds onto an empty record', () => {
    const out = applySkillUpgrade({}, 'heavyStrike', { damageBonus: 2 });
    expect(out.heavyStrike).toEqual({ damageBonus: 2, chargeDelta: 0, addConditions: [] });
  });

  it('a second damage upgrade stacks to +4 (numeric fields add)', () => {
    let up: Record<string, SkillUpgrade> = applySkillUpgrade({}, 'heavyStrike', { damageBonus: 2 });
    up = applySkillUpgrade(up, 'heavyStrike', { damageBonus: 2 });
    expect(up.heavyStrike?.damageBonus).toBe(4);
    // Two +2 upgrades on heavyStrike (base 3) resolve to baseDamage 7.
    expect(resolveSkill({ skillUpgrades: up }, 'heavyStrike').baseDamage).toBe(7);
    // Purity: the intermediate record is not mutated (still +2).
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

describe('enemy family skills (this milestone) — data-driven, twist-free', () => {
  // Each expectation is derived independently from the plan's skill table (element /
  // conditions / chargeCost / baseDamage), NOT read back from the SKILLS record.
  const CASES: {
    id: SkillId;
    element: string;
    conditions: ConditionType[];
    chargeCost: number;
    baseDamage: number;
  }[] = [
    // M15: Floor-1/2 family baseDamage shaved by 1 on the ≥2 values (gangShiv, warpMind, staticArc).
    { id: 'gangShiv', element: 'Physical', conditions: ['bleed'], chargeCost: 1, baseDamage: 1 },
    { id: 'poisonBite', element: 'Poison', conditions: ['poison'], chargeCost: 1, baseDamage: 1 },
    { id: 'taserShot', element: 'Electro', conditions: ['electrify'], chargeCost: 1, baseDamage: 1 },
    { id: 'warpMind', element: 'Psychic', conditions: ['insanity'], chargeCost: 1, baseDamage: 1 },
    { id: 'staticArc', element: 'Electro', conditions: ['electrify'], chargeCost: 1, baseDamage: 1 },
    { id: 'wrathSmash', element: 'Physical', conditions: ['fracture'], chargeCost: 2, baseDamage: 4 },
    { id: 'numbingCold', element: 'Cryo', conditions: ['sleep'], chargeCost: 1, baseDamage: 1 },
    { id: 'wrathfulLash', element: 'Pyro', conditions: ['burn'], chargeCost: 1, baseDamage: 2 },
    { id: 'radiantRebuke', element: 'Force', conditions: [], chargeCost: 1, baseDamage: 3 },
    { id: 'smiteWicked', element: 'Force', conditions: [], chargeCost: 2, baseDamage: 4 },
    { id: 'hellfire', element: 'Pyro', conditions: ['burn'], chargeCost: 1, baseDamage: 3 },
    { id: 'maddeningGaze', element: 'Psychic', conditions: ['insanity'], chargeCost: 1, baseDamage: 3 },
    { id: 'negate', element: 'Psychic', conditions: ['dumb'], chargeCost: 1, baseDamage: 2 },
    { id: 'desolateStrike', element: 'Physical', conditions: ['bleed'], chargeCost: 1, baseDamage: 2 },
  ];

  for (const c of CASES) {
    it(`${c.id} carries its themed element/conditions/cost/damage`, () => {
      const def = SKILLS[c.id];
      expect(def.element).toBe(c.element);
      expect(def.conditions).toEqual(c.conditions);
      expect(def.chargeCost).toBe(c.chargeCost);
      expect(def.baseDamage).toBe(c.baseDamage);
      // Twist-free: none of the M3 class-kit knobs are set on an enemy skill.
      expect(def.hpCost).toBeUndefined();
      expect(def.maxHpCost).toBeUndefined();
      expect(def.spendMomentum).toBeUndefined();
      expect(def.detonate).toBeUndefined();
      expect(def.appliesExposure).toBeUndefined();
      expect(def.selfConditions).toBeUndefined();
    });
  }
});

// ------- G17 — the resistance subsystem is live, end to end -----------------------------------

describe('G17 — resistances actually mitigate through the real damage path', () => {
  it('a Blessed (resistant) enemy takes strictly less than an identical plain one', () => {
    // The `blessed` affix was mechanically inert: a "Blessed Ganger" was an ordinary Ganger.
    // Pyro Ball is base 2 Pyro; the affix now grants +25 to every slot, so hand-derived:
    //   plain:   2 - round(2 * 0/100)  = 2
    //   blessed: 2 - round(2 * 25/100) = 2 - round(0.5) = 1   (Math.round is half-up)
    const plain = target({ resistances: [0, 0, 0, 0, 0, 0, 0] });
    const blessed = target({ resistances: plain.resistances.map((r) => r + BLESSED.resistBonus!) });
    expect(BLESSED.resistBonus).toBe(25); // the data premise, restated

    const onPlain = useSkill(caster(), plain, SKILLS.pyroBall).damage;
    const onBlessed = useSkill(caster(), blessed, SKILLS.pyroBall).damage;
    expect(onPlain).toBe(2);
    expect(onBlessed).toBe(1);
    expect(onBlessed).toBeLessThan(onPlain);
  });

  it('a Lucid (WIS-augmented) target takes strictly less — effectiveResistances has a caller', () => {
    // The second half of G17: `effectiveResistances` — which layers the Lucid/Clouded WIS
    // shift and equipped `bonusResist` — had ZERO production callers; both damage paths read
    // the raw stored array. Hand-derived:
    //   `wise` gives +2 WIS, so WIS 10 -> 12 and its mod 0 -> +1, a delta of 1.
    //   RESIST_PER_WIS_MOD = 10, so every resistance shifts by +10.
    //   Martyr is base 5 Force: 5 - round(5 * 10/100) = 5 - round(0.5) = 5 - 1 = 4.
    expect(RESIST_PER_WIS_MOD).toBe(10);
    expect(SKILLS.martyr.baseDamage).toBe(5);
    const plain = target();
    const lucid = target({ activeConditions: [makeCondition('wise')] });
    expect(useSkill(caster(), plain, SKILLS.martyr).damage).toBe(5);
    expect(useSkill(caster(), lucid, SKILLS.martyr).damage).toBe(4);
  });

  it('a Clouded (WIS-deprived) target takes strictly MORE than an un-augmented one', () => {
    // The mirror direction, so the test cannot pass by ignoring the sign: `fool` gives -2 WIS
    // (mod +1 -> 0 for a WIS-12 target), a -10 resistance shift. Starting from 10 resistance:
    //   un-augmented: 5 - round(5 * 10/100) = 4
    //   clouded:      5 - round(5 *  0/100) = 5
    const res = [10, 10, 10, 10, 10, 10, 10];
    const wis12 = { STR: 18, DEX: 12, CON: 12, INT: 10, WIS: 12, CHA: 10 };
    const plain = target({ stats: wis12, resistances: [...res] });
    const clouded = target({
      stats: wis12,
      resistances: [...res],
      activeConditions: [makeCondition('fool')],
    });
    expect(useSkill(caster(), plain, SKILLS.martyr).damage).toBe(4);
    expect(useSkill(caster(), clouded, SKILLS.martyr).damage).toBe(5);
  });
});
