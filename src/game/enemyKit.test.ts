import { describe, expect, it } from 'vitest';
import { FAMILIES, getFamily } from './enemyFamily.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { SKILLS } from './skill.ts';
import { mulberry32, type Rng } from './rng.ts';
import { resolveEnemyAttack, type SkillTarget } from './combat.ts';
import { type ConditionType } from './condition.ts';
import { SAVE_VERSION } from './save.ts';

// The expected pools are transcribed independently from the plan's §B pool map — NOT read
// back from enemyFamilies.json. If the data drifts from the design, these bite.
const EXPECTED_POOLS: Record<string, string[]> = {
  gangers: ['gangShiv', 'gangStomp'],
  securityDrones: ['taserShot', 'suppressiveFire'],
  mutantStrays: ['poisonBite', 'rabidClaw'],
  cyberEnforcers: ['riotSlam', 'shieldBash'],
  fixers: ['desperateSwing'],
  reflections: ['mirrorShard', 'blurStrike'],
  mirrorSelves: ['copiedStrike', 'copiedHex'],
  distortions: ['warpMind', 'disorient'],
  staticWraiths: ['staticArc', 'overload'],
  grief: ['drainingSob', 'heavyHeart'],
  rage: ['furiousBlow', 'wrathSmash'],
  dread: ['creepingFear', 'paralyzingDread'],
  numbness: ['deadeningTouch', 'numbingCold'],
  sevenSins: ['sinfulWhisper', 'covetousStrike', 'wrathfulLash'],
  ashWraiths: ['ashClaw'],
  choir: ['dissonantHymn', 'radiantRebuke'],
  guardians: ['wardingStrike', 'immovableSlam'],
  theJudged: ['sorrowfulGaze'],
  seraphWardens: ['smiteWicked', 'blindingLight'],
  demons: ['hellfire', 'corruptClaw'],
  voidHorrors: ['maddeningGaze', 'voidWhisper'],
  theUnmade: ['unmakeStrike', 'negate'],
  echoesOfYou: ['echoedStrike', 'echoedHex'],
  theHollowed: ['hollowGrasp', 'desolateStrike'],
};

describe('every family declares a themed skill pool', () => {
  it('the roster still has exactly 24 families', () => {
    expect(FAMILIES.length).toBe(24);
  });

  for (const family of FAMILIES) {
    it(`${family.id} declares >= 1 skill`, () => {
      expect(Array.isArray(family.theme.skills)).toBe(true);
      expect(family.theme.skills!.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('generateEnemy assigns the family declared pool', () => {
  for (const family of FAMILIES) {
    it(`${family.id} enemy skillPool === declared skills === expected map`, () => {
      const expected = EXPECTED_POOLS[family.id];
      expect(expected, `no expected pool for ${family.id}`).toBeDefined();
      // Data matches the design map...
      expect(family.theme.skills).toEqual(expected);
      // ...and the generated enemy carries exactly that pool (no rng dependence on the pool).
      const enemy = generateEnemy({ act: family.floor, family, playerXp: 0 }, mulberry32(7));
      expect(enemy.skillPool).toEqual(expected);
    });
  }
});

describe('guard: every family skill id resolves in SKILLS', () => {
  for (const family of FAMILIES) {
    it(`${family.id} skill ids all exist in SKILLS`, () => {
      for (const id of family.theme.skills ?? []) {
        expect(Object.prototype.hasOwnProperty.call(SKILLS, id), `unknown skill id "${id}"`).toBe(
          true,
        );
      }
    });
  }
});

describe('distinctness: enemies are no longer all-pyroBall', () => {
  it('there is more than one distinct pool across the 24 families', () => {
    const pools = FAMILIES.map((f) => JSON.stringify(f.theme.skills));
    expect(new Set(pools).size).toBeGreaterThan(1);
  });

  it('no family carries the placeholder pyroBall (every theme is non-Pyro-placeholder)', () => {
    for (const family of FAMILIES) {
      expect(family.theme.skills, `${family.id} should not carry pyroBall`).not.toContain(
        'pyroBall',
      );
    }
  });

  it('the legacy / boss path (no family) still defaults to the safe [pyroBall]', () => {
    const legacy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(7));
    expect(legacy.skillPool).toEqual(['pyroBall']);
    expect(getFamily('Beast')).toBeUndefined();
  });
});

// ---- Behavioral anchors: families are mechanically DISTINCT through resolveEnemyAttack. ----
//
// Every expected number below is hand-derived from the SKILLS table + computeSkillDamage
// (`base - floor(res/100)*base`) + the condition rules — never read back from the code.
//
// A scriptedRng forces the enemy's two draws inside resolveEnemyAttack:
//   draw 1 = rollD20WithAdvantage(0) = rollDie(rng,20) = 1 + floor(rng()*20).
//   draw 2 = randInt(rng, skillPool.length) = floor(rng()*length)  [skill pick].
// useSkill itself takes NO rng. face(15,20) = 14.5/20 = 0.725 -> natural 15, a plain HIT
// (not 20 crit, not 1 fumble) vs the defenderAc 10 below regardless of the enemy's small
// STR-mod (total = 15 + STR mod >= 10). critMultiplier = 1. The forced HIT means the enemy
// casts skillPool[index], applies its condition, and deals computeSkillDamage.
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

/** A minimal player-shaped target with per-element resistances (default all-zero). */
function target(resistances = [0, 0, 0, 0, 0, 0, 0]): SkillTarget {
  return {
    name: 'Hero',
    classId: 'Enforcer', // makes subjectOf() report 'player'
    stats: { STR: 12, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
    mods: { STR: 1, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: 0 },
    hp: 20,
    maxHp: 20,
    xp: 0,
    armorClass: 12,
    skillCharges: 5,
    maxSkillCharges: 5,
    hitDie: { quantity: 1, sides: 10 },
    activeConditions: [],
    resistances,
  } as SkillTarget;
}

/** Build a real family enemy (its declared pool) from a fixed seed. */
function familyEnemy(id: string): Enemy {
  const family = getFamily(id)!;
  return generateEnemy({ act: family.floor, family, playerXp: 0 }, mulberry32(9));
}

/** Run one forced enemy hit that picks skillPool[skillIndex]; return the observable outcome. */
function forcedHit(enemy: Enemy, tgt: SkillTarget, skillIndex: number) {
  // draw1 = face(15,20) -> natural 15 HIT ; draw2 = pick index.
  const rng = scriptedRng([face(15, 20), (skillIndex + 0.25) / enemy.skillPool.length]);
  const res = resolveEnemyAttack(enemy, tgt, 10, 0, rng);
  const used = res.events.find((e) => e.kind === 'enemy-skill-used') as
    | { kind: 'enemy-skill-used'; skillId: string; name: string }
    | undefined;
  const applied = res.target.activeConditions.map((c) => c.type as ConditionType);
  return { skillId: used?.skillId, damage: res.damage, applied };
}

describe('anchor 1 — poison family (mutantStrays) inflicts poison, not burn', () => {
  it('poisonBite: Poison base 1 vs 0 resist -> 1 dmg, applies poison', () => {
    const enemy = familyEnemy('mutantStrays'); // pool ['poisonBite','rabidClaw']
    expect(enemy.skillPool[0]).toBe('poisonBite');
    const out = forcedHit(enemy, target(), 0);
    expect(out.skillId).toBe('poisonBite');
    expect(out.damage).toBe(1); // computeSkillDamage: 1 - floor(0/100)*1 = 1
    expect(out.applied).toContain('poison');
    expect(out.applied).not.toContain('burn'); // a pyroBall enemy would apply NO condition
  });
});

describe('anchor 2 — psychic family (distortions) inflicts insanity', () => {
  it('warpMind: Psychic base 1 vs 0 resist -> 1 dmg, applies insanity', () => {
    // M15: warpMind baseDamage shaved 2 -> 1 (Floor-2 family).
    const enemy = familyEnemy('distortions'); // pool ['warpMind','disorient']
    expect(enemy.skillPool[0]).toBe('warpMind');
    const out = forcedHit(enemy, target(), 0);
    expect(out.skillId).toBe('warpMind');
    expect(out.damage).toBe(1);
    expect(out.applied).toContain('insanity');
    expect(out.applied).not.toContain('poison');
  });
});

describe('anchor 3 — physical family (gangers) inflicts bleed', () => {
  it('gangShiv: Physical base 1 vs 0 resist -> 1 dmg, applies bleed', () => {
    // M15: gangShiv baseDamage shaved 2 -> 1 (Floor-1 family).
    const enemy = familyEnemy('gangers'); // pool ['gangShiv','gangStomp']
    expect(enemy.skillPool[0]).toBe('gangShiv');
    const out = forcedHit(enemy, target(), 0);
    expect(out.skillId).toBe('gangShiv');
    expect(out.damage).toBe(1);
    expect(out.applied).toContain('bleed');
    expect(out.applied).not.toContain('insanity');
  });
});

describe('anchor 4 — resistance bites: damage flows through computeSkillDamage', () => {
  it('poisonBite vs a 100 Poison-resist player -> 0 dmg (1 - floor(100/100)*1), poison still applied', () => {
    const enemy = familyEnemy('mutantStrays');
    // Poison index 4 (Physical0 Cryo1 Pyro2 Electro3 Poison4 Psychic5 Force6).
    const out = forcedHit(enemy, target([0, 0, 0, 0, 100, 0, 0]), 0);
    expect(out.skillId).toBe('poisonBite');
    expect(out.damage).toBe(0);
    expect(out.applied).toContain('poison'); // condition is independent of resisted damage
  });
});

describe('anchor 6 — determinism: identical scripted runs match on {skillId,damage,condition}', () => {
  it('two identical forced hits deep-equal', () => {
    const a = forcedHit(familyEnemy('mutantStrays'), target(), 0);
    const b = forcedHit(familyEnemy('mutantStrays'), target(), 0);
    expect(a).toEqual(b);
    expect(a).toEqual({ skillId: 'poisonBite', damage: 1, applied: ['poison'] });
  });
});

describe('save shape — themed pool stays plain string[] (needed no SAVE_VERSION bump of its own)', () => {
  it('SAVE_VERSION is 8 (bumped later by M12 bosses, not by the themed pool)', () => {
    expect(SAVE_VERSION).toBe(8);
  });

  it('a themed-pool enemy JSON round-trips unchanged and skillPool is string[]', () => {
    const enemy = familyEnemy('gangers'); // pool ['gangShiv','gangStomp']
    const round = JSON.parse(JSON.stringify(enemy)) as Enemy;
    expect(round).toEqual(enemy);
    expect(Array.isArray(round.skillPool)).toBe(true);
    expect(round.skillPool.every((s) => typeof s === 'string')).toBe(true);
    expect(round.skillPool).toEqual(['gangShiv', 'gangStomp']);
  });

  it('a legacy pre-existing enemy (skillPool [pyroBall]) still round-trips unchanged', () => {
    const legacy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(3));
    const round = JSON.parse(JSON.stringify(legacy)) as Enemy;
    expect(round).toEqual(legacy);
    expect(round.skillPool).toEqual(['pyroBall']);
  });
});
