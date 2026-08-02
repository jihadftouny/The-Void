import { describe, expect, it } from 'vitest';
import {
  selectEncounter,
  buildRandomBattle,
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
  it('splits the 5-slot [B,B,B,R,R] table at draw 0.6', () => {
    // randInt(rng,5) = floor(x*5): indices 0..2 -> battle, 3..4 -> rest.
    expect(selectEncounter(scriptedRng([0.0]))).toBe('battle'); // idx 0
    expect(selectEncounter(scriptedRng([0.19]))).toBe('battle'); // floor(0.95)=0
    expect(selectEncounter(scriptedRng([0.59]))).toBe('battle'); // floor(2.95)=2
    expect(selectEncounter(scriptedRng([0.6]))).toBe('rest'); // floor(3.0)=3
    expect(selectEncounter(scriptedRng([0.99]))).toBe('rest'); // floor(4.95)=4
  });

  it('is weighted battle:rest = 3:2 over many seeds (within tolerance)', () => {
    const N = 5000;
    let battles = 0;
    for (let seed = 0; seed < N; seed++) {
      if (selectEncounter(mulberry32(seed)) === 'battle') battles++;
    }
    // Expected 3/5 = 0.6. Allow +/- 0.03 for sampling noise.
    expect(battles / N).toBeGreaterThan(0.57);
    expect(battles / N).toBeLessThan(0.63);
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
  it('grants advantage and produces a valid Beast BattleState', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const battle = buildRandomBattle(player, 1, mulberry32(123));
    expect(battle.player.advantageDisadvantage).toBe(1);
    expect(battle.enemy.type).toBe('Beast');
    expect(battle.enemy.hp).toBeGreaterThan(0);
    expect(battle.enemy.hp).toBe(battle.enemy.maxHp);
    expect(battle.act).toBe(1);
    expect(battle.canFlee).toBe(true); // not Act 5
    // Purity: the source player is not mutated.
    expect(player.advantageDisadvantage).toBe(0);
  });

  it('Act 5 battles cannot be fled', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const battle = buildRandomBattle(player, 5, mulberry32(1));
    expect(battle.canFlee).toBe(false);
  });
});
