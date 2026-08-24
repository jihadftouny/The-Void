// OFF-EQUIVALENCE LOCK — "nothing changed" for a fixed seed.
//
// READ THIS BEFORE EDITING A NUMBER BELOW.
//
// Every other test in this repo derives its expected value INDEPENDENTLY (hand arithmetic
// from the dice math, the spec, or the design doc). This file is the ONE deliberate,
// explicitly-labelled exception: its constants were MEASURED from the engine as it stood
// immediately before the M-UI2 `ui-foundation` combat-event widening, and committed in that
// state, so that the widening could be proved behaviour-preserving.
//
// That means this file is NOT a correctness oracle. It cannot tell you the engine is RIGHT.
// It tells you only that the engine still does exactly what it did at commit time. Its whole
// job is to fail loudly if a refactor that claims to change nothing quietly changes a dice
// draw, a draw ORDER, or a branch.
//
// Consequently: if a change to `src/game` makes this file fail, the default conclusion is that
// the change was NOT off-equivalent — go fix the change. Updating these numbers is legitimate
// ONLY for a deliberate, documented balance/rules change, and the commit that does so must say
// which rule changed and why the new numbers are correct.
//
// Coverage: 3 seeds x 2 classes played end to end under the deterministic `heuristicPolicy`
// (outcome, act, level, floors, step count, cause), the FINAL RNG ACCUMULATOR of a full run
// (the sharpest possible probe of draw count and draw order — one extra or missing `rng()`
// call anywhere in the run moves it), and a whole `simulateBatch` aggregate.

import { describe, it, expect } from 'vitest';
import { createGame, step, awaitingFor } from './game.ts';
import type { GameState, GameInput } from './game.ts';
import type { GameEvent } from './gameEvent.ts';
import { simulateRun, simulateBatch, heuristicPolicy } from './sim.ts';
import type { RunResult } from './sim.ts';
import type { PlayerClass } from './player.ts';

/**
 * Play a seeded run to its terminal state and return the FINAL RNG accumulator. Mirrors
 * `runToTerminal` but keeps the `GameState`, which is what carries `rngState`. Because
 * mulberry32's accumulator advances once per draw, this single number is a fingerprint of
 * "how many draws happened, in what order" across the entire run.
 */
function finalRngState(seed: number, classId: PlayerClass): number {
  const policy = heuristicPolicy(classId);
  let state: GameState = createGame(seed);
  let awaiting = awaitingFor(state.phase);
  let events: GameEvent[] = [];
  let steps = 0;
  while (awaiting !== 'game-over' && steps < 200_000) {
    const input: GameInput = policy({ state, events, awaiting });
    const res = step(state, input);
    state = res.state;
    events = res.events;
    awaiting = res.awaiting;
    steps += 1;
  }
  return state.rngState;
}

/** The frozen run records. MEASURED, not derived — see the file header. */
const GOLDEN_RUNS: readonly (RunResult & { rngState: number })[] = [
  { seed: 1, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 545, cause: 'unmade the Hollow (damnation)', rngState: 603946562 },
  { seed: 2, classId: 'Enforcer', outcome: 'death', diedAtAct: 4, finalAct: 4, finalLevel: 14, floorsCleared: 3, steps: 544, cause: 'Death', rngState: 2563394770 },
  { seed: 3, classId: 'Enforcer', outcome: 'death', diedAtAct: 1, finalAct: 1, finalLevel: 3, floorsCleared: 0, steps: 120, cause: 'Undercity Kingpin', rngState: 1282154740 },
  { seed: 1, classId: 'Hollow', outcome: 'death', diedAtAct: 3, finalAct: 3, finalLevel: 9, floorsCleared: 2, steps: 370, cause: 'Blind Fury', rngState: 1943380902 },
  { seed: 2, classId: 'Hollow', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 455, cause: 'unmade the Hollow (damnation)', rngState: 3985253704 },
  { seed: 3, classId: 'Hollow', outcome: 'death', diedAtAct: 1, finalAct: 1, finalLevel: 3, floorsCleared: 0, steps: 136, cause: 'Undercity Kingpin', rngState: 3234026647 },
];

describe('off-equivalence lock — a fixed-seed run is byte-identical across refactors', () => {
  it('replays 3 seeds x 2 classes to the exact same terminal record', () => {
    for (const golden of GOLDEN_RUNS) {
      const runOnly: RunResult = {
        seed: golden.seed, classId: golden.classId, outcome: golden.outcome,
        diedAtAct: golden.diedAtAct, finalAct: golden.finalAct, finalLevel: golden.finalLevel,
        floorsCleared: golden.floorsCleared, steps: golden.steps, cause: golden.cause,
      };
      expect(simulateRun(golden.seed, { classId: golden.classId })).toEqual(runOnly);
    }
  });

  it('ends every locked run on the exact same RNG accumulator (draw count AND order)', () => {
    for (const golden of GOLDEN_RUNS) {
      expect(finalRngState(golden.seed, golden.classId)).toBe(golden.rngState);
    }
  });

  it('folds a fixed-seed batch into the exact same aggregate report', () => {
    const report = simulateBatch({ seeds: [1, 2, 3], classes: ['Enforcer', 'Hollow'] });
    expect(report).toEqual({
      runs: 6,
      classes: ['Enforcer', 'Hollow'],
      wins: 2,
      grace: 0,
      damnation: 2,
      deaths: 4,
      winRate: 2 / 6,
      avgLevel: 61 / 6,
      avgFloorsCleared: 13 / 6,
      deathByAct: { 1: 2, 2: 0, 3: 1, 4: 1, 5: 0 },
      perClass: {
        Enforcer: {
          runs: 3, wins: 1, grace: 0, damnation: 1, deaths: 2,
          winRate: 1 / 3, avgLevel: 33 / 3, avgFloorsCleared: 7 / 3,
          deathByAct: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 0 },
        },
        Hollow: {
          runs: 3, wins: 1, grace: 0, damnation: 1, deaths: 2,
          winRate: 1 / 3, avgLevel: 28 / 3, avgFloorsCleared: 6 / 3,
          deathByAct: { 1: 1, 2: 0, 3: 1, 4: 0, 5: 0 },
        },
      },
    });
  });
});
