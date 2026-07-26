import { describe, expect, it } from 'vitest';
import { mulberry32, rollDie, rollDice, pick } from './rng.ts';

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
