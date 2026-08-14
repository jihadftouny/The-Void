import { describe, expect, it } from 'vitest';
import { AFFIXES, ELITE_CHANCE, rollAffix, applyAffix, type EnemyAffix } from './enemyAffix.ts';
import { generateEnemy } from './enemy.ts';
import { STAT_KEYS } from './character.ts';
import { mulberry32, type Rng } from './rng.ts';

function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

/** A base (un-affixed) enemy pinned to stats 13 / maxHp 14 (playerXp 0, M15-tuned base HP). */
function baseEnemy() {
  return generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(5));
}

const affixById = (id: string): EnemyAffix => AFFIXES.find((a) => a.id === id)!;

describe('the affix catalog', () => {
  it('has the 5 authored affixes in order', () => {
    expect(AFFIXES.map((a) => a.id)).toEqual([
      'ravenous',
      'ancient',
      'warped',
      'blessed',
      'cursed',
    ]);
  });

  it('ELITE_CHANCE is the M15 placeholder 0.15', () => {
    expect(ELITE_CHANCE).toBe(0.15);
  });
});

describe('rollAffix — fixed 2 draws, gated by ELITE_CHANCE', () => {
  it('gate open + index 1 selects Ancient (2 draws consumed)', () => {
    // draw1 = 0.1 < 0.15 -> gate open; draw2 = 0.25 -> randInt(_,5)=floor(1.25)=1 -> AFFIXES[1].
    let draws = 0;
    const rng: Rng = () => {
      const seq = [0.1, 0.25];
      return seq[draws++] ?? 0;
    };
    const affix = rollAffix(rng);
    expect(affix?.id).toBe('ancient');
    expect(draws).toBe(2);
  });

  it('gate closed returns null but still consumes exactly 2 draws', () => {
    let draws = 0;
    const rng: Rng = () => {
      const seq = [0.9, 0.25]; // 0.9 >= 0.15 -> closed
      return seq[draws++] ?? 0;
    };
    expect(rollAffix(rng)).toBeNull();
    expect(draws).toBe(2);
  });

  it('the gate boundary: exactly ELITE_CHANCE is CLOSED (strict <)', () => {
    expect(rollAffix(scriptedRng([0.15, 0.0]))).toBeNull(); // 0.15 < 0.15 is false
    expect(rollAffix(scriptedRng([0.149, 0.0]))).not.toBeNull();
  });
});

describe('rollAffix — M13 restricted (unlocked) affix set', () => {
  it('restricting to 2 affixes keeps the fixed 2 draws and indexes the FILTERED pool', () => {
    // Pool filtered to authoring-order [ravenous, ancient] (indices 0,1 of AFFIXES). Gate open
    // (0.1 < 0.15); index draw 0.6 -> randInt(_,2) = floor(1.2) = 1 -> filtered[1] = 'ancient'.
    let draws = 0;
    const rng: Rng = () => {
      const seq = [0.1, 0.6];
      return seq[draws++] ?? 0;
    };
    const only = new Set(['ravenous', 'ancient']);
    const affix = rollAffix(rng, only);
    expect(affix?.id).toBe('ancient');
    expect(draws).toBe(2); // draw count unchanged by the restriction
  });

  it('a single-affix set always yields that affix when the gate opens (index draw irrelevant)', () => {
    const only = new Set(['blessed']);
    // index draw 0.99 -> randInt(_,1) = 0 -> the sole entry, regardless.
    expect(rollAffix(scriptedRng([0.05, 0.99]), only)?.id).toBe('blessed');
  });

  it('every restricted roll over many seeds stays within the unlocked set (or null)', () => {
    const allowed = new Set(['warped', 'cursed']);
    for (let seed = 0; seed < 300; seed++) {
      const affix = rollAffix(mulberry32(seed), allowed);
      if (affix) expect(allowed.has(affix.id)).toBe(true);
    }
  });

  it('the FULL set is byte-identical to the unrestricted roll (off-equivalence)', () => {
    const full = new Set(AFFIXES.map((a) => a.id));
    for (let seed = 0; seed < 300; seed++) {
      const bare = rollAffix(mulberry32(seed));
      const withFull = rollAffix(mulberry32(seed), full);
      expect(withFull).toEqual(bare);
    }
  });
});

describe('applyAffix — pure, hand-derived stat deltas', () => {
  it('Ancient adds +2 to every stat and +8 maxHp/hp, recomputes mods, prefixes the name', () => {
    const base = baseEnemy();
    // Independent oracle from the authored table: Ancient statMods all +2, maxHpBonus +8.
    // base stats are all 13 -> 15; mod(15)=floor(5/2)=2. base maxHp/hp 14 (M15) -> 22.
    const elite = applyAffix(base, affixById('ancient'));
    for (const key of STAT_KEYS) {
      expect(elite.stats[key]).toBe(base.stats[key] + 2);
      expect(elite.stats[key]).toBe(15);
      expect(elite.mods[key]).toBe(2);
    }
    expect(elite.maxHp).toBe(base.maxHp + 8);
    expect(elite.maxHp).toBe(22);
    expect(elite.hp).toBe(base.hp + 8);
    expect(elite.fullName).toBe(`Ancient ${base.fullName}`);
    expect(elite.fullName.startsWith('Ancient ')).toBe(true);
    expect(elite.affixId).toBe('ancient');
    // Ancient carries no resistBonus, so resistances are untouched.
    expect(elite.resistances).toEqual(base.resistances);
    // Purity: the input is not mutated.
    expect(base.affixId).toBeUndefined();
    expect(base.stats.STR).toBe(13);
  });

  it('Blessed adds +2 to every resistance slot and leaves stats/hp alone', () => {
    const base = baseEnemy();
    const elite = applyAffix(base, affixById('blessed'));
    expect(elite.resistances).toEqual(base.resistances.map((r) => r + 2));
    for (const key of STAT_KEYS) expect(elite.stats[key]).toBe(base.stats[key]);
    expect(elite.maxHp).toBe(base.maxHp);
    expect(elite.affixId).toBe('blessed');
    expect(elite.fullName.startsWith('Blessed ')).toBe(true);
  });

  it('Ravenous adds +2 STR only', () => {
    const base = baseEnemy();
    const elite = applyAffix(base, affixById('ravenous'));
    expect(elite.stats.STR).toBe(base.stats.STR + 2);
    for (const key of STAT_KEYS) {
      if (key !== 'STR') expect(elite.stats[key]).toBe(base.stats[key]);
    }
  });

  it('an affixed enemy round-trips through JSON', () => {
    const elite = applyAffix(baseEnemy(), affixById('cursed'));
    expect(JSON.parse(JSON.stringify(elite))).toEqual(elite);
  });
});
