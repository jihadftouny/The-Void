import { describe, expect, it } from 'vitest';
import {
  getEnemyNameTable,
  enemyTypesForAct,
  selectNameFragment,
  generateEnemyName,
  generateFamilyName,
} from './enemyName.ts';
import { getFamily, type EnemyFamily } from './enemyFamily.ts';
import { mulberry32, type Rng } from './rng.ts';

function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

// All expected values are hand-transcribed from Java `EnemyName.setName`,
// independently of the reference JSON.

describe('enemyTypesForAct', () => {
  it('matches the Java Act -> type map', () => {
    expect(enemyTypesForAct(1)).toEqual(['Beast', 'Humanoid', 'Mech', 'Magical']);
    expect(enemyTypesForAct(2)).toEqual(['Beast', 'Humanoid', 'Magical']);
    expect(enemyTypesForAct(3)).toEqual(['Nightmare']);
    expect(enemyTypesForAct(4)).toEqual(['Beast', 'Humanoid', 'Ancestral']);
  });

  it('is empty for unknown Acts', () => {
    expect(enemyTypesForAct(0)).toEqual([]);
    expect(enemyTypesForAct(5)).toEqual([]);
  });
});

describe('getEnemyNameTable fidelity', () => {
  it('Act 1 Beast matches Java exactly (all three slots)', () => {
    expect(getEnemyNameTable(1, 'Beast')).toEqual({
      first: [
        ['Feral', 20],
        ['Aerobicized', 20],
        ['Plated', 20],
        ['Bestial', 10],
        ['Unbreakable', 10],
        ['Cunning', 10],
        ['Giant', 5],
        ['Monstrous', 3],
        ['Mutated', 2],
      ],
      middle: [
        ['Cryo', 20],
        ['Fiery', 20],
        ['Electrified', 20],
        ['Venomous', 20],
        ['Psychogenic', 20],
      ],
      last: [
        ['Rat', 20],
        ['Snake', 20],
        ['Lizard', 20],
        ['Spider', 20],
        ['Raven', 20],
      ],
    });
  });

  it('Act 4 Ancestral matches Java exactly', () => {
    expect(getEnemyNameTable(4, 'Ancestral')).toEqual({
      first: [['', 1]],
      middle: [['', 1]],
      last: [
        ['The Knight', 1],
        ['The Counselor', 1],
        ['Gaea', 1],
        ['Sif', 1],
        ['Death', 1],
      ],
    });
  });

  it('Act 3 Nightmare has three empty slots', () => {
    expect(getEnemyNameTable(3, 'Nightmare')).toEqual({
      first: [],
      middle: [],
      last: [],
    });
  });

  it('returns undefined for a type not present in the Act', () => {
    expect(getEnemyNameTable(1, 'Nightmare')).toBeUndefined();
    expect(getEnemyNameTable(2, 'Mech')).toBeUndefined();
    expect(getEnemyNameTable(9, 'Beast')).toBeUndefined();
  });
});

describe('weight invariant', () => {
  it('every weight across every table is a positive integer', () => {
    for (const act of [1, 2, 3, 4]) {
      for (const type of enemyTypesForAct(act)) {
        const table = getEnemyNameTable(act, type)!;
        for (const slot of [table.first, table.middle, table.last]) {
          for (const [, weight] of slot) {
            expect(Number.isInteger(weight)).toBe(true);
            expect(weight).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('Act 1 Magical first slot sums to 90, not 100 (per-table by design)', () => {
    // Guards against a wrong "everything sums to 100" assumption.
    const magical = getEnemyNameTable(1, 'Magical')!;
    const sum = magical.first.reduce((acc, [, w]) => acc + w, 0);
    expect(sum).toBe(90);
  });
});

describe('selectNameFragment', () => {
  it('returns "" for an empty slot and consumes no rng draw', () => {
    // Two same-seed streams: advancing one via an empty-slot pick must NOT move
    // it, so its next value equals a fresh stream's first value.
    const a = mulberry32(4);
    const b = mulberry32(4);
    expect(selectNameFragment([], a)).toBe('');
    expect(a()).toBe(b());
  });

  it('picks by cumulative threshold from a non-empty slot', () => {
    // total = 20+20+20 = 60; r = 1 + floor(x*60).
    const pairs = [['Feral', 20], ['Plated', 20], ['Giant', 20]] as const;
    // x=0.5 -> floor(30)=30 -> r=31 -> Feral(20)<31, Plated(40)>=31 -> 'Plated'
    expect(selectNameFragment(pairs, scriptedRng([0.5]))).toBe('Plated');
  });
});

describe('generateEnemyName', () => {
  it('scripted rng yields the exact hand-assembled Act-1 Beast name', () => {
    // Act-1 Beast slot totals are each 100. r = 1 + floor(x*100).
    //  first  x=0.5 -> r=51 -> cum 20,40,60 -> 'Plated'   (3rd)
    //  middle x=0.7 -> r=71 -> cum 20,40,60,80 -> 'Venomous' (4th)
    //  last   x=0.9 -> r=91 -> cum ...,100 -> 'Raven'      (5th)
    const name = generateEnemyName(1, 'Beast', scriptedRng([0.5, 0.7, 0.9]));
    expect(name).toBe('Plated Venomous Raven');
  });

  it('drops an empty-string middle fragment without a double space', () => {
    // Act-1 Humanoid: first & last non-empty; middle = [["",1]] -> "".
    //  first x=0 -> 'Pumped'; middle -> ''; last x=0 -> 'Thug'.
    const name = generateEnemyName(1, 'Humanoid', scriptedRng([0, 0, 0]));
    expect(name).toBe('Pumped Thug');
    expect(name).not.toContain('  ');
  });

  it('falls back to the type string when the table is missing', () => {
    expect(generateEnemyName(9, 'Beast', scriptedRng([0]))).toBe('Beast');
  });

  it('Act-3 Nightmare (all-empty tables) falls back to "Nightmare"', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(generateEnemyName(3, 'Nightmare', mulberry32(seed))).toBe('Nightmare');
    }
  });

  it('over many seeds every Act-1 Beast fragment is a valid table word, no double spaces', () => {
    const table = getEnemyNameTable(1, 'Beast')!;
    const firstWords = table.first.map(([w]) => w);
    const middleWords = table.middle.map(([w]) => w);
    const lastWords = table.last.map(([w]) => w);
    for (let seed = 0; seed < 200; seed++) {
      const name = generateEnemyName(1, 'Beast', mulberry32(seed));
      expect(name).not.toContain('  ');
      // All three Act-1 Beast slots are non-empty single-token words, so the
      // full name is exactly three space-separated tokens.
      const tokens = name.split(' ');
      expect(tokens).toHaveLength(3);
      expect(firstWords).toContain(tokens[0]);
      expect(middleWords).toContain(tokens[1]);
      expect(lastWords).toContain(tokens[2]);
    }
  });

  it('is deterministic under the same seed', () => {
    expect(generateEnemyName(1, 'Beast', mulberry32(321))).toBe(
      generateEnemyName(1, 'Beast', mulberry32(321)),
    );
  });
});

describe('generateFamilyName', () => {
  // The seven authored sin names are the INDEPENDENT oracle (from the plan / GAME-DESIGN §7).
  const SINS = ['Pride', 'Envy', 'Wrath', 'Sloth', 'Greed', 'Gluttony', 'Lust'];

  it('sevenSins always yields one authored sin, and all 7 are reachable over a seed sweep', () => {
    const family = getFamily('sevenSins')!;
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const name = generateFamilyName(family, 3, mulberry32(seed));
      expect(SINS).toContain(name); // never a name outside the set
      seen.add(name);
    }
    expect(seen).toEqual(new Set(SINS)); // every one of the 7 was drawn
  });

  it('a tag-reuse family (mutantStrays) reuses the act-1 Beast table for a 3-token name', () => {
    // mutantStrays has no bespoke byFamily entry, so it falls back to the Beast tag table
    // (all three slots non-empty) -> a three-token Beast-style name.
    const family = getFamily('mutantStrays')!;
    const table = getEnemyNameTable(1, 'Beast')!;
    const firstWords = table.first.map(([w]) => w);
    const middleWords = table.middle.map(([w]) => w);
    const lastWords = table.last.map(([w]) => w);
    for (let seed = 0; seed < 100; seed++) {
      const name = generateFamilyName(family, 1, mulberry32(seed));
      const tokens = name.split(' ');
      expect(tokens).toHaveLength(3);
      expect(firstWords).toContain(tokens[0]);
      expect(middleWords).toContain(tokens[1]);
      expect(lastWords).toContain(tokens[2]);
    }
  });

  it('falls back to the family name when neither a bespoke nor a tag table exists', () => {
    const orphan: EnemyFamily = {
      id: 'orphan',
      name: 'Nameless Thing',
      tag: 'NoSuchTag',
      floor: 1,
      karmaWeighted: false,
      theme: { behaviorNote: '' },
    };
    expect(generateFamilyName(orphan, 1, mulberry32(7))).toBe('Nameless Thing');
  });

  it('is deterministic under the same seed', () => {
    const family = getFamily('demons')!;
    expect(generateFamilyName(family, 5, mulberry32(99))).toBe(
      generateFamilyName(family, 5, mulberry32(99)),
    );
  });
});
