import { describe, expect, it } from 'vitest';
import {
  selectEncounter,
  buildRandomBattle,
  buildChestLoot,
  selectLore,
  computeRestHeal,
} from './encounter.ts';
import { createPlayer } from './player.ts';
import { type Stats } from './character.ts';
import { mulberry32, type Rng } from './rng.ts';

function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

function stats(): Stats {
  return { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 };
}

describe('selectEncounter', () => {
  it('splits the 6-slot [B,B,B,R,R,C] table by draw band', () => {
    // randInt(rng,6) = floor(x*6): idx 0..2 -> battle ([0,0.5)), 3..4 -> rest ([0.5,0.8333)),
    // 5 -> chest ([0.8333,1)).
    expect(selectEncounter(scriptedRng([0.0]))).toBe('battle'); // floor(0.0)=0
    expect(selectEncounter(scriptedRng([0.49]))).toBe('battle'); // floor(2.94)=2
    expect(selectEncounter(scriptedRng([0.5]))).toBe('rest'); // floor(3.0)=3
    expect(selectEncounter(scriptedRng([0.83]))).toBe('rest'); // floor(4.98)=4
    expect(selectEncounter(scriptedRng([0.84]))).toBe('chest'); // floor(5.04)=5
    expect(selectEncounter(scriptedRng([0.99]))).toBe('chest'); // floor(5.94)=5
  });

  it('is weighted battle:rest:chest = 3:2:1 over many seeds (within tolerance)', () => {
    const N = 6000;
    let battles = 0;
    let chests = 0;
    for (let seed = 0; seed < N; seed++) {
      const e = selectEncounter(mulberry32(seed));
      if (e === 'battle') battles++;
      else if (e === 'chest') chests++;
    }
    // Expected battle 3/6 = 0.5, chest 1/6 ~ 0.1667. Allow +/- 0.03 for sampling noise.
    expect(battles / N).toBeGreaterThan(0.47);
    expect(battles / N).toBeLessThan(0.53);
    expect(chests / N).toBeGreaterThan(0.14);
    expect(chests / N).toBeLessThan(0.19);
  });
});

describe('buildChestLoot', () => {
  it('yields the guaranteed chest items and is deterministic for a fixed seed', () => {
    // chestItemCount is 1 (dropTables.json), so a chest always yields exactly one item;
    // determinism is proved by two independent rolls from the same seed matching.
    const a = buildChestLoot(mulberry32(31));
    const b = buildChestLoot(mulberry32(31));
    expect(a).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a[0]!.rolled).toBeDefined();
  });
});

describe('selectLore', () => {
  // Sweep the whole [0,1) draw space finely.
  const sweep = Array.from({ length: 100 }, (_, i) => i / 100);

  it('Acts 2-4 can never return the third (index 2) entry', () => {
    for (const act of [2, 3, 4]) {
      for (const x of sweep) {
        const entry = selectLore(act, scriptedRng([x]));
        const idx = entry?.title.trim().slice(-1); // titles end in the entry index
        expect(idx === '0' || idx === '1').toBe(true);
      }
    }
  });

  it('Act 1 CAN return the third entry at a high draw', () => {
    // randInt(rng,3) with x=0.9 -> floor(2.7)=2 -> entries[2] ("...1 2").
    const entry = selectLore(1, scriptedRng([0.9]));
    expect(entry?.title).toBe('This is a Title 1 2');
  });

  it('Act 1 low draws return the first entry', () => {
    expect(selectLore(1, scriptedRng([0]))?.title).toBe('This is a Title 1 0');
  });

  it('returns undefined for an Act with no lore', () => {
    expect(selectLore(5, scriptedRng([0]))).toBeUndefined();
  });
});

describe('computeRestHeal', () => {
  it('xp=40 gives 10 at draw 0 and 20 at draw ~1 (range [10, 10+floor(xp/4)])', () => {
    // randInt(rng, floor(40/4)+1=11) + 10: x=0 -> 0+10=10; x=0.999 -> 10+10=20.
    expect(computeRestHeal(40, scriptedRng([0]))).toBe(10);
    expect(computeRestHeal(40, scriptedRng([0.999]))).toBe(20);
  });

  it('stays within [10, 10+floor(xp/4)] over many seeds', () => {
    const xp = 40;
    const hi = 10 + Math.floor(xp / 4); // 20
    for (let seed = 0; seed < 500; seed++) {
      const h = computeRestHeal(xp, mulberry32(seed));
      expect(h).toBeGreaterThanOrEqual(10);
      expect(h).toBeLessThanOrEqual(hi);
    }
  });

  it('xp=0 always heals exactly 10 (single slot)', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(computeRestHeal(0, mulberry32(seed))).toBe(10);
    }
  });
});

describe('buildRandomBattle', () => {
  // The per-floor family-id sets are the independent oracle, hand-listed from the plan's
  // Design (§ "The 24 families") — NOT read back from the loader.
  const ROSTER: Record<number, readonly string[]> = {
    1: ['gangers', 'securityDrones', 'mutantStrays', 'cyberEnforcers', 'fixers'],
    2: ['reflections', 'mirrorSelves', 'distortions', 'staticWraiths'],
    3: ['grief', 'rage', 'dread', 'numbness', 'sevenSins', 'ashWraiths'],
    4: ['choir', 'guardians', 'theJudged', 'seraphWardens'],
    5: ['demons', 'voidHorrors', 'theUnmade', 'echoesOfYou', 'theHollowed'],
  };

  it('grants advantage and produces a valid BattleState', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const battle = buildRandomBattle(player, 1, mulberry32(123));
    expect(battle.player.advantageDisadvantage).toBe(1);
    expect(battle.enemy.hp).toBeGreaterThan(0);
    expect(battle.enemy.hp).toBe(battle.enemy.maxHp);
    expect(battle.act).toBe(1);
    expect(battle.canFlee).toBe(true); // not Act 5
    // Purity: the source player is not mutated.
    expect(player.advantageDisadvantage).toBe(0);
  });

  it('every act draws a family from that act roster over many seeds', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    for (const act of [1, 2, 3, 4, 5]) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 200; seed++) {
        const battle = buildRandomBattle(player, act, mulberry32(seed));
        expect(ROSTER[act]).toContain(battle.enemy.familyId);
        seen.add(battle.enemy.familyId);
      }
      // Over 200 seeds the whole roster is reachable (guards against a stuck pick).
      expect(seen).toEqual(new Set(ROSTER[act]));
    }
  });

  it('is deterministic: the same seed yields a deep-equal enemy (family + affix)', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const a = buildRandomBattle(player, 3, mulberry32(777));
    const b = buildRandomBattle(player, 3, mulberry32(777));
    expect(a.enemy).toEqual(b.enemy);
  });

  it('a restricted unlock set draws only that family (M13 seam)', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const only = new Set(['mutantStrays']);
    for (let seed = 0; seed < 100; seed++) {
      const battle = buildRandomBattle(player, 1, mulberry32(seed), only);
      expect(battle.enemy.familyId).toBe('mutantStrays');
    }
  });

  it('some seeds spawn an elite (affix present) and the affix prefixes the name', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    let elites = 0;
    for (let seed = 0; seed < 400; seed++) {
      const battle = buildRandomBattle(player, 1, mulberry32(seed));
      if (battle.enemy.affixId !== undefined) {
        elites++;
        // The affix prefix (capitalized word) leads the name.
        expect(/^[A-Z][a-z]+ /.test(battle.enemy.fullName)).toBe(true);
      }
    }
    // ELITE_CHANCE is 0.15, so over 400 seeds elites are present but a minority.
    expect(elites).toBeGreaterThan(0);
    expect(elites).toBeLessThan(400);
  });

  it('Act 5 battles cannot be fled', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const battle = buildRandomBattle(player, 5, mulberry32(1));
    expect(battle.canFlee).toBe(false);
  });
});
