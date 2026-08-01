import { describe, expect, it } from 'vitest';
import {
  mulberry32,
  rollDie,
  rollDice,
  pick,
  randInt,
  roll4d6DropLowest,
  weightedPick,
  type Rng,
} from './rng.ts';

// A deterministic rng that yields a fixed sequence of floats (then 0), so tests
// can force exact draws and hand-derive expected results without measuring code.
function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

describe('mulberry32', () => {
  it('is deterministic: the same seed yields the same stream', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const streamA = Array.from({ length: 5 }, () => a());
    const streamB = Array.from({ length: 5 }, () => b());
    expect(streamA).toEqual(streamB);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rollDie', () => {
  it('stays within [1, sides] over many rolls', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rollDie(r, 20);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('rejects non-positive or non-integer sides', () => {
    const r = mulberry32(1);
    expect(() => rollDie(r, 0)).toThrow();
    expect(() => rollDie(r, 2.5)).toThrow();
  });
});

describe('rollDice', () => {
  it('sums count*[1,sides]: 3d6 is within [3, 18]', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = rollDice(r, 3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(18);
    }
  });
});

describe('pick', () => {
  it('always returns an element of the source array', () => {
    const r = mulberry32(5);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(r, items));
    }
  });

  it('throws on an empty array', () => {
    const r = mulberry32(5);
    expect(() => pick(r, [])).toThrow();
  });
});

describe('randInt', () => {
  it('returns floor(x*n): scripted x=0.5, n=10 -> 5; x=0.99, n=4 -> 3', () => {
    // floor(0.5*10)=5 ; floor(0.99*4)=floor(3.96)=3
    expect(randInt(scriptedRng([0.5]), 10)).toBe(5);
    expect(randInt(scriptedRng([0.99]), 4)).toBe(3);
  });

  it('stays within [0, n-1] for n>=1 over many draws', () => {
    const r = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(r, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('for n=1 the only reachable value is 0 (x<1 => floor(x)=0)', () => {
    const r = mulberry32(77);
    for (let i = 0; i < 200; i++) expect(randInt(r, 1)).toBe(0);
  });

  it('returns 0 for n<=0', () => {
    expect(randInt(scriptedRng([0.999]), 0)).toBe(0);
    expect(randInt(scriptedRng([0.999]), -5)).toBe(0);
  });

  it('always consumes exactly one draw, even when n<=0', () => {
    // Two fresh streams of the same seed: advance `a` via randInt(_,0) and `b`
    // via a raw draw; if randInt consumed one draw, their next values match.
    const a = mulberry32(9);
    const b = mulberry32(9);
    randInt(a, 0);
    b();
    expect(a()).toBe(b());
  });
});

describe('roll4d6DropLowest', () => {
  it('scripted dice [1,6,3,4] -> drop 1 -> 6+3+4 = 13', () => {
    // rollDie = 1 + floor(x*6): x=0 ->1, x=0.9 ->6, x=0.4 ->3, x=0.5 ->4.
    expect(roll4d6DropLowest(scriptedRng([0, 0.9, 0.4, 0.5]))).toBe(13);
  });

  it('is within [3, 18] and integer over many seeds', () => {
    for (let seed = 0; seed < 500; seed++) {
      const v = roll4d6DropLowest(mulberry32(seed));
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(18);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('all-1s gives 3 and all-6s gives 18 (boundary dice)', () => {
    expect(roll4d6DropLowest(scriptedRng([0, 0, 0, 0]))).toBe(3);
    expect(roll4d6DropLowest(scriptedRng([0.99, 0.99, 0.99, 0.99]))).toBe(18);
  });

  it('consumes exactly four draws', () => {
    const a = mulberry32(3);
    const b = mulberry32(3);
    roll4d6DropLowest(a);
    for (let i = 0; i < 4; i++) b();
    expect(a()).toBe(b());
  });
});

describe('weightedPick', () => {
  it('returns undefined for an empty list', () => {
    expect(weightedPick(mulberry32(1), [])).toBeUndefined();
  });

  it('scripted draw selects by cumulative threshold', () => {
    // total = 20+20+20 = 60. r = 1 + floor(x*60).
    const entries = [['a', 20], ['b', 20], ['c', 20]] as const;
    // x=0    -> r=1  -> cumulative a=20 >= 1  -> 'a'
    expect(weightedPick(scriptedRng([0]), entries)).toBe('a');
    // x=0.5  -> floor(30)=30 -> r=31 -> a=20<31, b=40>=31 -> 'b'
    expect(weightedPick(scriptedRng([0.5]), entries)).toBe('b');
    // x=0.99 -> floor(59.4)=59 -> r=60 -> c=60>=60 -> 'c'
    expect(weightedPick(scriptedRng([0.99]), entries)).toBe('c');
  });

  it('never selects a zero-weight entry', () => {
    const entries = [['a', 1], ['b', 0]] as const;
    // total=1, r = 1 + randInt(_,1) = 1 always -> 'a' every time.
    for (let seed = 0; seed < 200; seed++) {
      expect(weightedPick(mulberry32(seed), entries)).toBe('a');
    }
  });

  it('always returns an entry present in the list', () => {
    const entries = [['x', 3], ['y', 5], ['z', 2]] as const;
    const values = entries.map(([v]) => v);
    for (let seed = 0; seed < 200; seed++) {
      expect(values).toContain(weightedPick(mulberry32(seed), entries));
    }
  });

  it('is deterministic under the same seed', () => {
    const entries = [['x', 3], ['y', 5], ['z', 2]] as const;
    expect(weightedPick(mulberry32(42), entries)).toBe(
      weightedPick(mulberry32(42), entries),
    );
  });

  it('consumes exactly one draw', () => {
    const entries = [['x', 3], ['y', 5], ['z', 2]] as const;
    const a = mulberry32(11);
    const b = mulberry32(11);
    weightedPick(a, entries);
    b();
    expect(a()).toBe(b());
  });
});
