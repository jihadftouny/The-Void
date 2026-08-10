import { describe, expect, it } from 'vitest';
import {
  rollD20WithAdvantage,
  weaponModifier,
  resolveAttackOutcome,
  resolvePlayerAttack,
  resolveEnemyAttack,
  type Attacker,
  type SkillUser,
  type SkillTarget,
} from './combat.ts';
import { getWeaponByName } from './weapon.ts';
import { makeCondition } from './condition.ts';
import { effectiveMods } from './statEffects.ts';
import { type Rng } from './rng.ts';

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`scriptedRng exhausted: only ${values.length} draw(s) scripted`);
    }
    return values[i++]!;
  };
}
const face = (f: number, sides: number): number => (f - 0.5) / sides;

const SWORD = getWeaponByName('Jaaj Sword 1')!; // Melee 1d6
const GUN = getWeaponByName('Jooj Gun 1')!; // Ranged 1d4
const RAPIER = getWeaponByName('Jiij Rapier 1')!; // Finesse 1d8

// Player with STR mod 4, DEX mod 1 (derived by hand: STR 18 -> floor((18-10)/2)=4;
// DEX 12 -> floor((12-10)/2)=1). Melee uses STR(4), Ranged uses DEX(1), Finesse max(4,1)=4.
function player(overrides: Partial<Attacker> = {}): Attacker {
  return {
    name: 'Hero',
    stats: { STR: 18, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
    mods: { STR: 4, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 },
    hp: 20,
    maxHp: 20,
    xp: 0,
    armorClass: 12,
    skillCharges: 5,
    maxSkillCharges: 5,
    hitDie: { quantity: 1, sides: 10 },
    equippedWeaponId: 'Jaaj Sword 1',
    advantageDisadvantage: 0,
    activeConditions: [],
    ...overrides,
  };
}

function skillTarget(overrides: Partial<SkillTarget> = {}): SkillTarget {
  const base = {
    name: 'Hero',
    // classId makes subjectOf() report 'player'
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
    activeConditions: [],
    resistances: [0, 0, 0, 0, 0, 0, 0],
  };
  return { ...base, ...overrides } as SkillTarget;
}

function enemy(overrides: Partial<SkillUser> = {}): SkillUser {
  return {
    name: 'Beast',
    stats: { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 },
    mods: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 },
    hp: 30,
    maxHp: 30,
    xp: 2,
    armorClass: 10,
    skillCharges: 2,
    maxSkillCharges: 2,
    hitDie: { quantity: 1, sides: 8 },
    skillPool: ['pyroBall'],
    activeConditions: [],
    resistances: [0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

describe('weaponModifier per weapon property', () => {
  it('Melee uses STR mod, Ranged uses DEX mod, Finesse uses max(STR,DEX)', () => {
    const p = player(); // STR mod 4, DEX mod 1
    expect(weaponModifier(p, SWORD)).toBe(4);
    expect(weaponModifier(p, GUN)).toBe(1);
    expect(weaponModifier(p, RAPIER)).toBe(4); // max(4,1)
  });

  it('Finesse picks DEX when DEX mod > STR mod (proves it is max, not always-STR)', () => {
    const p = player({ mods: { STR: 1, DEX: 4, CON: 1, INT: 0, WIS: 0, CHA: 0 } });
    expect(weaponModifier(p, SWORD)).toBe(1);
    expect(weaponModifier(p, GUN)).toBe(4);
    expect(weaponModifier(p, RAPIER)).toBe(4); // max(1,4)=DEX
  });
});

describe('rollD20WithAdvantage', () => {
  it('no adv/dis: one draw, natural is that face', () => {
    expect(rollD20WithAdvantage(0, scriptedRng([face(10, 20)]))).toEqual({ natural: 10, advDis: 0 });
  });
  it('advantage takes the MAX of two faces (7,15) -> 15', () => {
    expect(rollD20WithAdvantage(1, scriptedRng([face(7, 20), face(15, 20)]))).toEqual({ natural: 15, advDis: 1 });
  });
  it('disadvantage takes the MIN of two faces (7,15) -> 7', () => {
    expect(rollD20WithAdvantage(-1, scriptedRng([face(7, 20), face(15, 20)]))).toEqual({ natural: 7, advDis: -1 });
  });
});

describe('resolveAttackOutcome', () => {
  it('natural 20 is a crit even when the total is below AC', () => {
    expect(resolveAttackOutcome(20, 24, 100)).toBe('crit');
  });
  it('natural 1 is a fumble', () => {
    expect(resolveAttackOutcome(1, 5, 3)).toBe('fumble');
  });
  it('total below AC is a miss; total at/above AC is a hit', () => {
    expect(resolveAttackOutcome(10, 14, 25)).toBe('miss');
    expect(resolveAttackOutcome(10, 14, 10)).toBe('hit');
    expect(resolveAttackOutcome(10, 10, 10)).toBe('hit');
  });
  it('clamps a negative total to 1 before the AC check', () => {
    expect(resolveAttackOutcome(5, -3, 1)).toBe('hit'); // clamped to 1 >= AC 1
    expect(resolveAttackOutcome(5, -3, 2)).toBe('miss'); // clamped to 1 < AC 2
  });
});

describe('resolvePlayerAttack — outcomes and damage', () => {
  it('hit: natural 15 + STR mod 4 = 19 >= AC 10, damage = one d6 (face 4) = 4', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), scriptedRng([face(15, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit');
    expect(r.damage).toBe(4);
    expect(r.events).toEqual([{ kind: 'attack', subject: 'player', outcome: 'hit', damage: 4 }]);
  });

  it('crit: natural 20, damage = TWO d6 (faces 3,4) = 7', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), scriptedRng([face(20, 20), face(3, 6), face(4, 6)]));
    expect(r.outcome).toBe('crit');
    expect(r.damage).toBe(7);
  });

  it('crit ignores AC (nat 20 hits at AC 100)', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 100 }), scriptedRng([face(20, 20), face(3, 6), face(4, 6)]));
    expect(r.outcome).toBe('crit');
    expect(r.damage).toBe(7);
  });

  it('fumble: natural 1 -> damage 0 and NO damage draw', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), scriptedRng([face(1, 20)]));
    expect(r.outcome).toBe('fumble');
    expect(r.damage).toBe(0);
  });

  it('miss: total 14 < AC 25 -> damage 0 and NO damage draw', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 25 }), scriptedRng([face(10, 20)]));
    expect(r.outcome).toBe('miss');
    expect(r.damage).toBe(0);
  });

  it('advantage emits an advantage event and uses the max face', () => {
    const r = resolvePlayerAttack(
      player({ advantageDisadvantage: 1 }),
      enemy({ armorClass: 10 }),
      scriptedRng([face(7, 20), face(15, 20), face(4, 6)]),
    );
    expect(r.outcome).toBe('hit'); // natural 15 + 4 = 19
    expect(r.damage).toBe(4);
    expect(r.events[0]).toEqual({ kind: 'advantage', subject: 'player' });
  });
});

describe('resolvePlayerAttack — Strong/Weak STR cascade (to-hit + melee damage)', () => {
  // Melee attacker, base STR 14 -> mod +2 (floor((14-10)/2)). Jaaj Sword 1 = Melee 1d6.
  //   strong: STR 16 -> mod +3 (+1 delta) ; weak: STR 12 -> mod +1 (-1 delta).
  // Damage delta is added ONCE to the die roll (like an ability mod). Every number is
  // hand-derived from the D&D formula, and the scripted face makes the natural roll
  // explicit so total = natural + hand-computed mod, never the function vs itself.
  const str14 = { STR: 14, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 };

  it('strong: mod +3 -> nat 10 hits AC 13, damage = 1d6(4) + 1 = 5', () => {
    const p = player({ stats: str14, mods: { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 }, activeConditions: [makeCondition('strong')] });
    expect(effectiveMods(p).STR).toBe(3);
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), scriptedRng([face(10, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit'); // 10 + 3 = 13 >= 13
    expect(r.damage).toBe(5); // 4 + 1
  });

  it('without the augment the SAME nat 10 misses AC 13 (proves +1 to-hit mattered)', () => {
    const p = player({ stats: str14, mods: { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 } });
    expect(effectiveMods(p).STR).toBe(2);
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), scriptedRng([face(10, 20)]));
    expect(r.outcome).toBe('miss'); // 10 + 2 = 12 < 13, no damage draw
    expect(r.damage).toBe(0);
  });

  it('weak: mod +1 -> nat 10 hits AC 5, damage = 1d6(4) - 1 = 3', () => {
    const p = player({ stats: str14, mods: { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 }, activeConditions: [makeCondition('weak')] });
    expect(effectiveMods(p).STR).toBe(1);
    const r = resolvePlayerAttack(p, enemy({ armorClass: 5 }), scriptedRng([face(10, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit'); // 10 + 1 = 11 >= 5
    expect(r.damage).toBe(3); // 4 - 1
  });
});

describe('resolvePlayerAttack — Quick DEX cascade (ranged to-hit only, no ranged damage)', () => {
  // Ranged attacker (Jooj Gun 1 = Ranged 1d4), base DEX 14 -> mod +2. quick: DEX 16 ->
  // mod +3 (+1 delta). Ranged to-hit uses DEX; Quick must NOT add ranged damage.
  const dex14 = { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 10 };

  it('quick raises ranged to-hit by +1 but leaves 1d4 damage unmodified', () => {
    const p = player({ stats: dex14, mods: { STR: 0, DEX: 2, CON: 1, INT: 0, WIS: 0, CHA: 0 }, equippedWeaponId: 'Jooj Gun 1', activeConditions: [makeCondition('quick')] });
    expect(effectiveMods(p).DEX).toBe(3);
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), scriptedRng([face(10, 20), face(3, 4)]));
    expect(r.outcome).toBe('hit'); // 10 + 3 = 13 >= 13
    expect(r.damage).toBe(3); // 1d4 face 3, NO STR delta on a ranged weapon
  });

  it('without quick the same nat 10 misses AC 13 (10 + 2 = 12 < 13)', () => {
    const p = player({ stats: dex14, mods: { STR: 0, DEX: 2, CON: 1, INT: 0, WIS: 0, CHA: 0 }, equippedWeaponId: 'Jooj Gun 1' });
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), scriptedRng([face(10, 20)]));
    expect(r.outcome).toBe('miss');
  });
});

describe('resolvePlayerAttack — off-equivalence (no augment / non-augment condition)', () => {
  it('a non-augment condition (bleed) leaves to-hit and damage identical to conditionless', () => {
    // bleed touches no stat, so mod stays 4 and enemy AC stays 10 -> same as the base
    // "nat 15 + 4 = 19 hit, 1d6(4)=4" anchor above.
    const p = player({ activeConditions: [makeCondition('bleed')] });
    const r = resolvePlayerAttack(p, enemy({ armorClass: 10 }), scriptedRng([face(15, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit');
    expect(r.damage).toBe(4);
  });
});

describe('resolveEnemyAttack — faithful, always hits', () => {
  it('with charges + skill: deals the skill damage (Pyro Ball = 2) and spends one charge', () => {
    const e = enemy({ skillCharges: 2 });
    const r = resolveEnemyAttack(e, skillTarget(), scriptedRng([0.5]));
    expect(r.damage).toBe(2);
    expect(r.enemy.skillCharges).toBe(1);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      { kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2 },
    ]);
  });

  it('with 0 charges: deals exactly 1 and draws nothing', () => {
    const r = resolveEnemyAttack(enemy({ skillCharges: 0 }), skillTarget(), scriptedRng([]));
    expect(r.damage).toBe(1);
    expect(r.enemy.skillCharges).toBe(0);
    expect(r.events).toEqual([{ kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 1 }]);
  });

  it('a Freeze! enemy applies freeze to the returned target', () => {
    const e = enemy({ skillPool: ['freeze'], skillCharges: 1 });
    const r = resolveEnemyAttack(e, skillTarget(), scriptedRng([0.5]));
    expect(r.damage).toBe(1);
    expect(r.target.activeConditions).toEqual([makeCondition('freeze')]);
  });
});
