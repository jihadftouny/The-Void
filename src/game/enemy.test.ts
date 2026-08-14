import { describe, expect, it } from 'vitest';
import { generateEnemy } from './enemy.ts';
import { STAT_KEYS } from './character.ts';
import { getFamily } from './enemyFamily.ts';
import { getElement } from './element.ts';
import { mulberry32 } from './rng.ts';

// All expected values are hand-derived from the literal Java formulas (see enemy.ts):
//   xp     = 1 + randInt(rng, floor(playerXp/4) + 2)
//   stat   = 13 + floor(xp/4) + randInt(rng, floor(playerXp/4) + 1)
//   maxHp  = 10 + floor(playerXp/8) + randInt(rng, floor(playerXp/4)) ; hp = maxHp   [M15 tuned]
//   mod(s) = floor((s - 10) / 2)  => mod(13) = floor(3/2) = 1
//   armorClass = 10 (fixed)
// randInt(rng, n) is in [0, n-1] for n>=1, and is exactly 0 for n<=0.

describe('generateEnemy at playerXp = 0 (fully pinned, seed-independent)', () => {
  // floor(0/4)=0 so: xp = 1 + randInt(_,2) in {1,2}; statSpread = 1 so
  // randInt(_,1)=0 => every stat = 13 + floor(xp/4). floor(1/4)=floor(2/4)=0,
  // so every stat = 13 exactly. maxHp = 10 + floor(0/8)=0 + randInt(_, floor(0/4)=0)=0 => 10.
  for (const seed of [0, 1, 2, 7, 42, 1000, 123456]) {
    it(`seed ${seed}: all stats 13, mods 1, maxHp 10, AC 10, xp in {1,2}`, () => {
      const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(seed));
      for (const key of STAT_KEYS) {
        expect(enemy.stats[key]).toBe(13);
        expect(enemy.mods[key]).toBe(1);
      }
      expect(enemy.maxHp).toBe(10);
      expect(enemy.hp).toBe(10);
      expect(enemy.armorClass).toBe(10);
      expect([1, 2]).toContain(enemy.xp);
    });
  }
});

describe('generateEnemy determinism', () => {
  it('two fresh rngs of the same seed produce a deep-equal enemy', () => {
    const a = generateEnemy({ act: 1, type: 'Beast', playerXp: 55 }, mulberry32(2024));
    const b = generateEnemy({ act: 1, type: 'Beast', playerXp: 55 }, mulberry32(2024));
    expect(a).toEqual(b);
  });
});

describe('generateEnemy stat range at playerXp = 40', () => {
  // floor(40/4) = 10, so each stat is in [13 + floor(xp/4), 13 + floor(xp/4) + 10].
  it('every stat lies within the derived bounds over many seeds', () => {
    for (let seed = 0; seed < 300; seed++) {
      const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 40 }, mulberry32(seed));
      const floorXp = Math.floor(enemy.xp / 4);
      const lo = 13 + floorXp;
      const hi = 13 + floorXp + 10;
      for (const key of STAT_KEYS) {
        expect(enemy.stats[key]).toBeGreaterThanOrEqual(lo);
        expect(enemy.stats[key]).toBeLessThanOrEqual(hi);
      }
    }
  });
});

describe('generateEnemy HP scaling with playerXp', () => {
  it('every maxHp at playerXp=100 (min 22) exceeds every maxHp at playerXp=0 (max 10)', () => {
    let maxAtZero = -Infinity;
    let minAtHundred = Infinity;
    for (let seed = 0; seed < 300; seed++) {
      const low = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(seed));
      const high = generateEnemy({ act: 1, type: 'Beast', playerXp: 100 }, mulberry32(seed));
      maxAtZero = Math.max(maxAtZero, low.maxHp);
      minAtHundred = Math.min(minAtHundred, high.maxHp);
      expect(high.maxHp).toBeGreaterThan(0);
      expect(high.hp).toBe(high.maxHp);
      expect(low.hp).toBe(low.maxHp);
    }
    // Hand-derived floors (M15 tuned formula 10 + floor(xp/8) + randInt(_, floor(xp/4))):
    //   min at 100 = 10 + floor(100/8)=12 + randInt(_,25)_min=0 = 22; max at 0 = 10 (both terms 0).
    expect(minAtHundred).toBeGreaterThanOrEqual(22);
    expect(maxAtZero).toBeLessThanOrEqual(10);
    expect(minAtHundred).toBeGreaterThan(maxAtZero);
  });
});

describe('generateEnemy naming and shape', () => {
  it('produces a non-empty fullName for a real Act/type', () => {
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 10 }, mulberry32(5));
    expect(typeof enemy.fullName).toBe('string');
    expect(enemy.fullName.length).toBeGreaterThan(0);
    expect(enemy.name).toBe('Beast');
  });

  it('Act-3 Nightmare falls back to the type string as fullName', () => {
    const enemy = generateEnemy({ act: 3, type: 'Nightmare', playerXp: 20 }, mulberry32(9));
    expect(enemy.fullName).toBe('Nightmare');
  });

  it('has a 7-slot all-zero resistance array, the seeded skill, and no conditions', () => {
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 12 }, mulberry32(3));
    expect(enemy.resistances).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // Every enemy starts with the test Pyro Ball skill (Java Enemy constructor).
    expect(enemy.skillPool).toEqual(['pyroBall']);
    expect(enemy.activeConditions).toEqual([]);
    expect(enemy.maxSkillCharges).toBe(2);
    expect(enemy.skillCharges).toBe(2);
  });
});

describe('generateEnemy serializability', () => {
  it('round-trips through JSON unchanged', () => {
    const enemy = generateEnemy({ act: 4, type: 'Humanoid', playerXp: 77 }, mulberry32(88));
    expect(JSON.parse(JSON.stringify(enemy))).toEqual(enemy);
  });
});

describe('generateEnemy legacy path carries the additive M8 fields', () => {
  it('familyId mirrors the type and karmaWeighted is false with no affix', () => {
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(5));
    expect(enemy.familyId).toBe('Beast');
    expect(enemy.karmaWeighted).toBe(false);
    expect(enemy.affixId).toBeUndefined();
  });
});

describe('generateEnemy family path', () => {
  it('folds the family stat-bias, tags familyId/karmaWeighted, and seeds the resist slot', () => {
    // mutantStrays: tag Beast, NOT ⚖, statBias {DEX:+1}, resist Poison 2. At playerXp=0
    // every base stat pins to 13 (statSpread 1 -> randInt=0), so DEX = 13 + 1 = 14 and the
    // other five stay 13. Poison is element index 4 -> resistances[4] = 2.
    const family = getFamily('mutantStrays')!;
    const enemy = generateEnemy({ act: 1, family, playerXp: 0 }, mulberry32(11));
    expect(enemy.familyId).toBe('mutantStrays');
    expect(enemy.karmaWeighted).toBe(false);
    expect(enemy.stats.DEX).toBe(14);
    for (const key of STAT_KEYS) {
      if (key !== 'DEX') expect(enemy.stats[key]).toBe(13);
    }
    const poison = getElement('Poison')!;
    expect(enemy.resistances[poison]).toBe(2);
    // Only that one slot is non-zero.
    expect(enemy.resistances.reduce((a, b) => a + b, 0)).toBe(2);
    // The enemy fights with mutantStrays' declared themed pool (enemyFamilies.json),
    // NOT the legacy placeholder Pyro Ball.
    expect(enemy.skillPool).toEqual(['poisonBite', 'rabidClaw']);
  });

  it('a ⚖ family sets karmaWeighted true and biases its themed stat', () => {
    // gangers: ⚖, statBias {STR:+1}. At playerXp=0 -> STR = 14, karmaWeighted true.
    const family = getFamily('gangers')!;
    const enemy = generateEnemy({ act: 1, family, playerXp: 0 }, mulberry32(3));
    expect(enemy.familyId).toBe('gangers');
    expect(enemy.karmaWeighted).toBe(true);
    expect(enemy.stats.STR).toBe(14);
    expect(enemy.fullName.length).toBeGreaterThan(0);
    // gangers fight with their declared themed pool, not Pyro Ball.
    expect(enemy.skillPool).toEqual(['gangShiv', 'gangStomp']);
  });

  it('is deterministic and JSON-serializable', () => {
    const family = getFamily('demons')!;
    const a = generateEnemy({ act: 5, family, playerXp: 40 }, mulberry32(2024));
    const b = generateEnemy({ act: 5, family, playerXp: 40 }, mulberry32(2024));
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    // demons resist Pyro (index 2) by 2.
    expect(a.resistances[getElement('Pyro')!]).toBe(2);
  });
});
