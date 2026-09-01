import { describe, expect, it } from 'vitest';
import {
  combineAdvDis,
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
import { UNARMED } from './equipment.ts';
import { makeCondition } from './condition.ts';
import { effectiveMods } from './statEffects.ts';
import { type Rng } from './rng.ts';
import { sumDamageSources, type CombatEvent } from './combatEvent.ts';

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
    expect(rollD20WithAdvantage(0, scriptedRng([face(10, 20)]))).toEqual({ natural: 10, faces: [10], advDis: 0 });
  });
  it('advantage takes the MAX of two faces (7,15) -> 15', () => {
    expect(rollD20WithAdvantage(1, scriptedRng([face(7, 20), face(15, 20)]))).toEqual({ natural: 15, faces: [7, 15], advDis: 1 });
  });
  it('disadvantage takes the MIN of two faces (7,15) -> 7', () => {
    expect(rollD20WithAdvantage(-1, scriptedRng([face(7, 20), face(15, 20)]))).toEqual({ natural: 7, faces: [7, 15], advDis: -1 });
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
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), SWORD, 0, scriptedRng([face(15, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit');
    expect(r.damage).toBe(4);
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'player', outcome: 'hit', damage: 4,
      // natural 15, +4 STR = 19, against the enemy's AC 10.
      roll: { natural: 15, faces: [15], advDis: 0, modifier: 4, total: 19, targetAc: 10 },
      damageSources: [{ kind: 'weapon-dice', amount: 4, label: '1d6' }],
    }]);
  });

  it('crit: natural 20, damage = TWO d6 (faces 3,4) = 7', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), SWORD, 0, scriptedRng([face(20, 20), face(3, 6), face(4, 6)]));
    expect(r.outcome).toBe('crit');
    expect(r.damage).toBe(7);
  });

  it('crit ignores AC (nat 20 hits at AC 100)', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 100 }), SWORD, 0, scriptedRng([face(20, 20), face(3, 6), face(4, 6)]));
    expect(r.outcome).toBe('crit');
    expect(r.damage).toBe(7);
  });

  it('fumble: natural 1 -> damage 0 and NO damage draw', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), SWORD, 0, scriptedRng([face(1, 20)]));
    expect(r.outcome).toBe('fumble');
    expect(r.damage).toBe(0);
  });

  it('miss: total 14 < AC 25 -> damage 0 and NO damage draw', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 25 }), SWORD, 0, scriptedRng([face(10, 20)]));
    expect(r.outcome).toBe('miss');
    expect(r.damage).toBe(0);
  });

  it('advantage emits an advantage event and uses the max face', () => {
    const r = resolvePlayerAttack(
      player({ advantageDisadvantage: 1 }),
      enemy({ armorClass: 10 }),
      SWORD,
      0,
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
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), SWORD, 0, scriptedRng([face(10, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit'); // 10 + 3 = 13 >= 13
    expect(r.damage).toBe(5); // 4 + 1
  });

  it('without the augment the SAME nat 10 misses AC 13 (proves +1 to-hit mattered)', () => {
    const p = player({ stats: str14, mods: { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 } });
    expect(effectiveMods(p).STR).toBe(2);
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), SWORD, 0, scriptedRng([face(10, 20)]));
    expect(r.outcome).toBe('miss'); // 10 + 2 = 12 < 13, no damage draw
    expect(r.damage).toBe(0);
  });

  it('weak: mod +1 -> nat 10 hits AC 5, damage = 1d6(4) - 1 = 3', () => {
    const p = player({ stats: str14, mods: { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 }, activeConditions: [makeCondition('weak')] });
    expect(effectiveMods(p).STR).toBe(1);
    const r = resolvePlayerAttack(p, enemy({ armorClass: 5 }), SWORD, 0, scriptedRng([face(10, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit'); // 10 + 1 = 11 >= 5
    expect(r.damage).toBe(3); // 4 - 1
  });
});

describe('resolvePlayerAttack — Quick DEX cascade (ranged to-hit only, no ranged damage)', () => {
  // Ranged attacker (Jooj Gun 1 = Ranged 1d4), base DEX 14 -> mod +2. quick: DEX 16 ->
  // mod +3 (+1 delta). Ranged to-hit uses DEX; Quick must NOT add ranged damage.
  const dex14 = { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 10, CHA: 10 };

  it('quick raises ranged to-hit by +1 but leaves 1d4 damage unmodified', () => {
    const p = player({ stats: dex14, mods: { STR: 0, DEX: 2, CON: 1, INT: 0, WIS: 0, CHA: 0 }, activeConditions: [makeCondition('quick')] });
    expect(effectiveMods(p).DEX).toBe(3);
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), GUN, 0, scriptedRng([face(10, 20), face(3, 4)]));
    expect(r.outcome).toBe('hit'); // 10 + 3 = 13 >= 13
    expect(r.damage).toBe(3); // 1d4 face 3, NO STR delta on a ranged weapon
  });

  it('without quick the same nat 10 misses AC 13 (10 + 2 = 12 < 13)', () => {
    const p = player({ stats: dex14, mods: { STR: 0, DEX: 2, CON: 1, INT: 0, WIS: 0, CHA: 0 } });
    const r = resolvePlayerAttack(p, enemy({ armorClass: 13 }), GUN, 0, scriptedRng([face(10, 20)]));
    expect(r.outcome).toBe('miss');
  });
});

describe('resolvePlayerAttack — off-equivalence (no augment / non-augment condition)', () => {
  it('a non-augment condition (bleed) leaves to-hit and damage identical to conditionless', () => {
    // bleed touches no stat, so mod stays 4 and enemy AC stays 10 -> same as the base
    // "nat 15 + 4 = 19 hit, 1d6(4)=4" anchor above.
    const p = player({ activeConditions: [makeCondition('bleed')] });
    const r = resolvePlayerAttack(p, enemy({ armorClass: 10 }), SWORD, 0, scriptedRng([face(15, 20), face(4, 6)]));
    expect(r.outcome).toBe('hit');
    expect(r.damage).toBe(4);
  });
});

describe('resolvePlayerAttack — M5 injected weapon + equip damage bonus', () => {
  // UNARMED (1d1 Melee): a 1d1 die always rolls exactly 1 (face(1,1) -> natural 1). Damage
  // is the die only in this engine (the STR mod feeds TO-HIT, not damage); with no augment
  // and no equip bonus a hit deals exactly UNARMED.damage = 1. Player STR mod 4 makes the
  // nat 15 -> 19 hit at AC 10, but adds nothing to damage.
  it('unarmed: an empty-hand hit deals exactly UNARMED (1d1 = 1)', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), UNARMED, 0, scriptedRng([face(15, 20), face(1, 1)]));
    expect(r.outcome).toBe('hit');
    expect(r.damage).toBe(1);
  });

  // equipDamageBonus adds to a hit ONCE (like an ability mod). Same SWORD nat-15 hit, die
  // face 4: bonus 0 -> 4, bonus 3 -> 7 (exactly +3, not +3 per die).
  it('a flat equip damage bonus adds exactly N to a hit', () => {
    const noBonus = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), SWORD, 0, scriptedRng([face(15, 20), face(4, 6)]));
    expect(noBonus.damage).toBe(4);
    const withBonus = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), SWORD, 3, scriptedRng([face(15, 20), face(4, 6)]));
    expect(withBonus.damage).toBe(7);
  });

  // On a crit the bonus is added ONCE (not per die): two d6 (3,4) + bonus 3 = 10, not 13.
  it('a flat equip damage bonus adds once to a crit (not per die)', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), SWORD, 3, scriptedRng([face(20, 20), face(3, 6), face(4, 6)]));
    expect(r.outcome).toBe('crit');
    expect(r.damage).toBe(10); // 3 + 4 + 3
  });

  // Weapon swap changes what you hit for: a Legendary 1d8 Finesse rapier can deal 8 damage
  // (die face 8), a value the 1d6 sword can never produce ([1..6]). Finesse to-hit uses
  // max(STR 4, DEX 1) = 4, so nat 15 -> 19 hits AC 10.
  it('a legendary 1d8 rapier can hit for 8 — outside the 1d6 sword range', () => {
    const r = resolvePlayerAttack(player(), enemy({ armorClass: 10 }), RAPIER, 0, scriptedRng([face(15, 20), face(8, 8)]));
    expect(r.outcome).toBe('hit');
    expect(r.damage).toBe(8);
  });
});

describe('resolveEnemyAttack — enemy rolls to hit (M4)', () => {
  // Enemy STR 13 -> effectiveMods(enemy).STR = floor((13-10)/2) = +1 to hit. The default
  // player AC used below is 13 (a starting Enforcer in Jooj Armor 1, CON 12/+1 DEX 12/+1:
  // 11 + 1 + min(1,2) = 13). So the enemy HITS at natural >= 12 (12+1 = 13 >= 13) and
  // MISSES at natural <= 11 (11+1 = 12 < 13). Every natural is fixed by a scripted face;
  // face(f,20) yields exactly natural f, so total = f + 1 is hand-computed, never measured.
  const AC = 13;

  it('hit: natural 12 -> 13 >= AC 13, casts Pyro Ball (skill-pick draw) for 2, spends a charge', () => {
    const e = enemy({ skillCharges: 2 });
    const r = resolveEnemyAttack(e, skillTarget(), AC, 0, scriptedRng([face(12, 20), 0.5]));
    expect(r.damage).toBe(2);
    expect(r.enemy.skillCharges).toBe(1);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        roll: { natural: 12, faces: [12], advDis: 0, modifier: 1, total: 13, targetAc: AC },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
    ]);
  });

  it('miss: natural 11 -> 12 < AC 13, deals 0, spends NO charge, draws NO skill-pick', () => {
    const e = enemy({ skillCharges: 2 });
    // Only ONE draw is scripted: if a skill-pick were drawn on a miss, scriptedRng throws.
    const r = resolveEnemyAttack(e, skillTarget(), AC, 0, scriptedRng([face(11, 20)]));
    expect(r.damage).toBe(0);
    expect(r.enemy.skillCharges).toBe(2); // unchanged
    expect(r.target.activeConditions).toEqual([]); // no condition applied
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0,
      roll: { natural: 11, faces: [11], advDis: 0, modifier: 1, total: 12, targetAc: AC },
      damageSources: [],
    }]);
  });

  it('crit: natural 20 ignores AC and DOUBLES the dealt Pyro Ball damage (2 -> 4)', () => {
    const e = enemy({ skillCharges: 2 });
    const r = resolveEnemyAttack(e, skillTarget(), AC, 0, scriptedRng([face(20, 20), 0.5]));
    expect(r.damage).toBe(4); // 2 * 2
    expect(r.enemy.skillCharges).toBe(1);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'crit', damage: 4,
        roll: { natural: 20, faces: [20], advDis: 0, modifier: 1, total: 21, targetAc: AC },
        // The crit doubles the skill's 2 by ADDING an equal term, so 2 + 2 = 4.
        damageSources: [
          { kind: 'skill', amount: 2 },
          { kind: 'crit-multiplier', amount: 2 },
        ],
      },
    ]);
  });

  it('fumble: natural 1 -> deals 0, no charge, no skill-pick draw', () => {
    const e = enemy({ skillCharges: 2 });
    const r = resolveEnemyAttack(e, skillTarget(), AC, 0, scriptedRng([face(1, 20)]));
    expect(r.damage).toBe(0);
    expect(r.enemy.skillCharges).toBe(2);
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'enemy', outcome: 'fumble', damage: 0,
      // A fumble still records what it was rolled against.
      roll: { natural: 1, faces: [1], advDis: 0, modifier: 1, total: 2, targetAc: AC },
      damageSources: [],
    }]);
  });

  it('with 0 charges on a hit: deals the plain 1 (natural 15 -> 16 >= AC 13)', () => {
    const r = resolveEnemyAttack(enemy({ skillCharges: 0 }), skillTarget(), AC, 0, scriptedRng([face(15, 20)]));
    expect(r.damage).toBe(1);
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 1,
      roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: AC },
      damageSources: [{ kind: 'base', amount: 1 }],
    }]);
  });

  it('with 0 charges on a crit: doubles the plain 1 to 2', () => {
    const r = resolveEnemyAttack(enemy({ skillCharges: 0 }), skillTarget(), AC, 0, scriptedRng([face(20, 20)]));
    expect(r.damage).toBe(2); // 1 * 2
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'enemy', outcome: 'crit', damage: 2,
      roll: { natural: 20, faces: [20], advDis: 0, modifier: 1, total: 21, targetAc: AC },
      damageSources: [
        { kind: 'base', amount: 1 },
        { kind: 'crit-multiplier', amount: 1 },
      ],
    }]);
  });

  it('Scavver dodge: enemyAdvDis -1 rolls {12, 5}, uses the lower 5 -> 6 < AC 13 -> miss + disadvantage event', () => {
    const e = enemy({ skillCharges: 2 });
    // disadvantage draws two d20s (12, 5) and takes the min 5; 5 + 1 = 6 < 13 -> miss.
    // A non-Scavver (advDis 0) taking the 12 would total 13 -> hit; the dodge converts it.
    const r = resolveEnemyAttack(e, skillTarget(), AC, -1, scriptedRng([face(12, 20), face(5, 20)]));
    expect(r.damage).toBe(0);
    expect(r.enemy.skillCharges).toBe(2); // no charge on a miss
    expect(r.events).toEqual([
      { kind: 'disadvantage', subject: 'enemy' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0,
        // BOTH faces are reported, so the log can show the dodge that forced the low one.
        roll: { natural: 5, faces: [12, 5], advDis: -1, modifier: 1, total: 6, targetAc: AC },
        damageSources: [],
      },
    ]);
  });

  it('the SAME {12,5} at advDis 0 (non-Scavver) would take 12 -> 13 >= AC 13 -> hit (proves the dodge mattered)', () => {
    const e = enemy({ skillCharges: 2 });
    const r = resolveEnemyAttack(e, skillTarget(), AC, 0, scriptedRng([face(12, 20), 0.5]));
    expect(r.damage).toBe(2); // hit, Pyro Ball
    expect(r.events[0]).toEqual({ kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' });
  });

  it('a Freeze! enemy applies freeze on a HIT but not on a MISS', () => {
    const onHit = resolveEnemyAttack(
      enemy({ skillPool: ['freeze'], skillCharges: 1 }),
      skillTarget(),
      AC,
      0,
      scriptedRng([face(15, 20), 0.5]),
    );
    expect(onHit.damage).toBe(1);
    expect(onHit.target.activeConditions).toEqual([makeCondition('freeze')]);

    const onMiss = resolveEnemyAttack(
      enemy({ skillPool: ['freeze'], skillCharges: 1 }),
      skillTarget(),
      AC,
      0,
      scriptedRng([face(11, 20)]),
    );
    expect(onMiss.damage).toBe(0);
    expect(onMiss.target.activeConditions).toEqual([]); // no freeze on a miss
    expect(onMiss.enemy.skillCharges).toBe(1); // charge unspent
  });
});

// ---------------------------------------------------------------------------
// M-UI2: every attack event carries the dice that decided it, and a damage
// breakdown whose terms SUM to the damage reported. All expectations below are
// derived from the D&D arithmetic, never read back from a run.
// ---------------------------------------------------------------------------

// A player with STR mod +2 and DEX mod 0. The weapon table ships no MELEE 1d8, so the 1d8
// Finesse rapier stands in: Finesse takes max(STR, DEX) = max(2, 0) = 2, giving exactly the
// +2 to-hit the case calls for, and Finesse takes the same damage path as Melee.
function d8Wielder(overrides: Partial<Attacker> = {}): Attacker {
  return player({
    stats: { STR: 14, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    mods: { STR: 2, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
    ...overrides,
  });
}
const AC13 = enemy({ armorClass: 13 });

/** The invariant that makes a breakdown worth showing at all. */
function expectSourcesSumToDamage(events: readonly CombatEvent[]): void {
  for (const e of events) {
    if (e.kind !== 'attack' && e.kind !== 'skill-cast') continue;
    expect(sumDamageSources(e.damageSources)).toBe(e.damage);
  }
}

describe('attack events carry the roll that decided them', () => {
  it('a hit records the natural, the modifier, the total and the AC it beat', () => {
    // natural 15, +2 (Finesse -> max(STR 2, DEX 0)) = 17, against AC 13 -> hit.
    // Damage: one d8 landing on 4.
    const r = resolvePlayerAttack(
      d8Wielder(), AC13, RAPIER, 0, scriptedRng([face(15, 20), face(4, 8)]),
    );
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'player', outcome: 'hit', damage: 4,
      roll: { natural: 15, faces: [15], advDis: 0, modifier: 2, total: 17, targetAc: 13 },
      damageSources: [{ kind: 'weapon-dice', amount: 4, label: '1d8' }],
    }]);
    expectSourcesSumToDamage(r.events);
  });

  it('under advantage it reports BOTH faces, not just the winner', () => {
    // Two d20s (7, 15); advantage takes the max, 15. 15 + 2 = 17 >= AC 13 -> hit.
    const r = resolvePlayerAttack(
      d8Wielder({ advantageDisadvantage: 1 }), AC13, RAPIER, 0,
      scriptedRng([face(7, 20), face(15, 20), face(4, 8)]),
    );
    expect(r.events).toEqual([
      { kind: 'advantage', subject: 'player' },
      {
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 4,
        roll: { natural: 15, faces: [7, 15], advDis: 1, modifier: 2, total: 17, targetAc: 13 },
        damageSources: [{ kind: 'weapon-dice', amount: 4, label: '1d8' }],
      },
    ]);
  });

  it('under disadvantage it reports both faces and keeps the LOWER as natural', () => {
    // The same two faces (7, 15); disadvantage takes the min, 7. 7 + 2 = 9 < AC 13 -> miss,
    // so no damage die is rolled at all (only two draws are scripted).
    const r = resolvePlayerAttack(
      d8Wielder({ advantageDisadvantage: -1 }), AC13, RAPIER, 0,
      scriptedRng([face(7, 20), face(15, 20)]),
    );
    expect(r.events[1]).toEqual({
      kind: 'attack', subject: 'player', outcome: 'miss', damage: 0,
      roll: { natural: 7, faces: [7, 15], advDis: -1, modifier: 2, total: 9, targetAc: 13 },
      damageSources: [],
    });
  });

  it('a fumble records the AC it was measured against and carries no damage terms', () => {
    // natural 1 is a fumble regardless of the total; 1 + 2 = 3 is still reported.
    const r = resolvePlayerAttack(d8Wielder(), AC13, RAPIER, 0, scriptedRng([face(1, 20)]));
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'player', outcome: 'fumble', damage: 0,
      roll: { natural: 1, faces: [1], advDis: 0, modifier: 2, total: 3, targetAc: 13 },
      damageSources: [],
    }]);
  });

  it('a crit breaks the two dice rolls into separate terms', () => {
    // natural 20 -> crit. Two d8 rolls, 4 and 5, so 9 damage from two named terms.
    const r = resolvePlayerAttack(
      d8Wielder(), AC13, RAPIER, 0, scriptedRng([face(20, 20), face(4, 8), face(5, 8)]),
    );
    expect(r.damage).toBe(9);
    expect(r.events).toEqual([{
      kind: 'attack', subject: 'player', outcome: 'crit', damage: 9,
      roll: { natural: 20, faces: [20], advDis: 0, modifier: 2, total: 22, targetAc: 13 },
      damageSources: [
        { kind: 'weapon-dice', amount: 4, label: '1d8' },
        { kind: 'crit-dice', amount: 5, label: '1d8' },
      ],
    }]);
    expectSourcesSumToDamage(r.events);
  });

  it('names gear and perk flat damage as separate terms', () => {
    // d8 face 4, +3 from gear, +1 from a perk = 8.
    const r = resolvePlayerAttack(
      d8Wielder(), AC13, RAPIER, 3, scriptedRng([face(15, 20), face(4, 8)]), 1,
    );
    expect(r.damage).toBe(8);
    expect(r.events[0]).toMatchObject({
      damageSources: [
        { kind: 'weapon-dice', amount: 4, label: '1d8' },
        { kind: 'equipment', amount: 3 },
        { kind: 'perk', amount: 1 },
      ],
    });
    expectSourcesSumToDamage(r.events);
  });

  it('keeps the terms summing to the damage even when the total is clamped at 0', () => {
    // d8 face 4 with a -10 penalty is -6 raw, which the engine floors at 0. The breakdown
    // records the floor as its own corrective term, so the invariant survives the clamp.
    const r = resolvePlayerAttack(
      d8Wielder(), AC13, RAPIER, -10, scriptedRng([face(15, 20), face(4, 8)]),
    );
    expect(r.damage).toBe(0);
    expect(r.events[0]).toMatchObject({
      damageSources: [
        { kind: 'weapon-dice', amount: 4, label: '1d8' },
        { kind: 'equipment', amount: -10 },
        { kind: 'clamp', amount: 6 },
      ],
    });
    expectSourcesSumToDamage(r.events);
  });

  it('always pushes the attack event LAST — the ordering battle.ts depends on', () => {
    // battle.ts folds post-hoc modifiers into the attack event by the index it lands at,
    // captured as `events.length - 1` right after the spread. If a resolver ever pushed
    // something after the attack, that fold would silently target the wrong event.
    const withAdv = resolvePlayerAttack(
      d8Wielder({ advantageDisadvantage: 1 }), AC13, RAPIER, 0,
      scriptedRng([face(7, 20), face(15, 20), face(4, 8)]),
    );
    expect(withAdv.events[withAdv.events.length - 1]!.kind).toBe('attack');

    // The enemy path is the one that really matters: it pushes enemy-skill-used events too.
    const ea = resolveEnemyAttack(
      enemy({ skillCharges: 2 }), skillTarget(), 13, 0, scriptedRng([face(12, 20), 0.5]),
    );
    expect(ea.events.length).toBeGreaterThan(1);
    expect(ea.events[ea.events.length - 1]!.kind).toBe('attack');
  });

  it('round-trips a widened attack event through JSON unchanged (still plain data)', () => {
    const r = resolvePlayerAttack(
      d8Wielder(), AC13, RAPIER, 0, scriptedRng([face(20, 20), face(4, 8), face(5, 8)]),
    );
    const event = r.events[0]!;
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });
});

describe('combineAdvDis — the 5e cancellation rule, stated as a table', () => {
  // The RULE, decided rather than inherited: advantage and disadvantage CANCEL, and two of
  // the same are still just one. Every cell is written out so a change of rule fails here
  // loudly instead of silently shifting hit rates:
  //   - "the condition always wins"  would make (1, -1) read -1.
  //   - "advantage always wins"      would make (-1, 1) read  1.
  //   - a naive unclamped sum        would make (-1, -1) read -2, which is not a legal advDis.
  it('cancels opposites, keeps like sources at one step, and never leaves -1|0|1', () => {
    expect(combineAdvDis(0, 0)).toBe(0);
    expect(combineAdvDis(1, 0)).toBe(1);
    expect(combineAdvDis(0, 1)).toBe(1);
    expect(combineAdvDis(-1, 0)).toBe(-1);
    expect(combineAdvDis(0, -1)).toBe(-1);
    expect(combineAdvDis(1, -1)).toBe(0); // cancellation
    expect(combineAdvDis(-1, 1)).toBe(0); // cancellation, the other way round
    expect(combineAdvDis(1, 1)).toBe(1); // two advantages are still one
    expect(combineAdvDis(-1, -1)).toBe(-1); // two disadvantages are still one
  });

  it('normalizes any stored integer, so a legacy out-of-range value cannot widen the roll', () => {
    // `Player.advantageDisadvantage` is a plain `number` on state, so a hand-edited or
    // legacy save can carry 5 or -3; the roller only accepts -1|0|1.
    expect(combineAdvDis(5, 0)).toBe(1);
    expect(combineAdvDis(-3, 0)).toBe(-1);
    expect(combineAdvDis(5, -3)).toBe(0);
  });
});
