import { describe, expect, it } from 'vitest';
import { FAMILIES, getFamily } from './enemyFamily.ts';
import { generateEnemy } from './enemy.ts';
import { SKILLS } from './skill.ts';
import { mulberry32 } from './rng.ts';

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
