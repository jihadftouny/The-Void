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
