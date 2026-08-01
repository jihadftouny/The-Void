// Deterministic, seedable RNG for The Void.
//
// LOAD-BEARING PRINCIPLE: every gameplay random decision (dice, loot, encounters)
// flows through a seeded RNG so a run is reproducible from its seed and tests can
// assert exact outcomes. Never call Math.random() or Date.now() inside src/game.
//
// This module is framework-agnostic: no Kaplay, DOM, or canvas imports allowed here.

/** A pure function returning the next float in [0, 1). */
export type Rng = () => number;

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 * Same seed always yields the same stream, which is what makes runs reproducible.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A serializable RNG seam. `createRng(state)` returns an `rng` running the exact
 * same mulberry32 step as `mulberry32(state)`, plus `getState()` returning the
 * current 32-bit accumulator as an unsigned integer. That accumulator IS the
 * serializable RNG state: `createRng(getState())` continues the identical stream,
 * so a GameState holding `rngState: number` round-trips through JSON and resumes
 * byte-identically.
 *
 * DEVIATION: the 4-line core is duplicated from `mulberry32` rather than
 * refactored, to keep `mulberry32` and its existing callers byte-stable.
 */
export function createRng(state: number): { rng: Rng; getState: () => number } {
  let a = state >>> 0;
  const rng: Rng = function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { rng, getState: () => a >>> 0 };
}

/** Roll a single die with `sides` faces, returning an integer in [1, sides]. */
export function rollDie(rng: Rng, sides: number): number {
  if (sides < 1 || !Number.isInteger(sides)) {
    throw new Error(`rollDie: sides must be a positive integer, got ${sides}`);
  }
  return 1 + Math.floor(rng() * sides);
}

/** Roll `count` dice of `sides` faces and sum them (e.g. rollDice(rng, 3, 6) = 3d6). */
export function rollDice(rng: Rng, count: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += rollDie(rng, sides);
  return total;
}

/** Pick a uniformly random element from a non-empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: cannot pick from an empty array');
  const item = items[Math.floor(rng() * items.length)];
  // noUncheckedIndexedAccess: index is always in range given the guard above.
  return item as T;
}

/**
 * Java `(int)(Math.random() * n)` — a uniform integer in [0, n-1] for n >= 1.
 * ALWAYS consumes exactly one rng draw, even when n <= 0 (returns 0 then), so a
 * caller's rng-call count is stable regardless of the argument. This keeps
 * enemy/loot generation reproducible when a bound happens to be zero.
 */
export function randInt(rng: Rng, n: number): number {
  const x = rng();
  return n > 0 ? Math.floor(x * n) : 0;
}

/**
 * Roll 4d6 and drop the lowest die, summing the top three (D&D-style stat roll).
 * Range [3, 18]: all-1s -> 4 - 1 = 3; all-6s -> 24 - 6 = 18. Always an integer.
 * Consumes exactly four rng draws (one per die).
 */
export function roll4d6DropLowest(rng: Rng): number {
  const dice = [
    rollDie(rng, 6),
    rollDie(rng, 6),
    rollDie(rng, 6),
    rollDie(rng, 6),
  ];
  const total = dice.reduce((sum, d) => sum + d, 0);
  return total - Math.min(...dice);
}

/**
 * Weighted selection: expand each entry by its weight and pick uniformly, done
 * deterministically via one rng draw. Returns undefined for an empty list.
 * Otherwise: total = sum of weights; r = 1 + randInt(rng, total); return the
 * first entry whose running cumulative weight is >= r. Zero-weight entries can
 * never be selected. Same distribution as Java's expand-by-weight `EnemyName`
 * selection, correct for tables whose weights do not sum to 100.
 */
export function weightedPick<T>(
  rng: Rng,
  entries: readonly (readonly [T, number])[],
): T | undefined {
  if (entries.length === 0) return undefined;
  let total = 0;
  for (const [, weight] of entries) total += weight;
  const r = 1 + randInt(rng, total);
  let cumulative = 0;
  for (const [value, weight] of entries) {
    cumulative += weight;
    if (cumulative >= r) return value;
  }
  // Unreachable when total > 0 and r <= total; degenerate all-zero-weight list
  // falls through to the last entry.
  return entries[entries.length - 1]?.[0];
}
