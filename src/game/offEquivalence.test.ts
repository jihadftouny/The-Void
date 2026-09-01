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
// ---------------------------------------------------------------------------------------------
// #0a `combat-core` RULE LEDGER — why these numbers moved (see the final table in step 9's commit).
// Each row is a DELIBERATE rules change from `docs/PLAN.md` #0 / `docs/FINDINGS.md` §4, with the
// direction it was expected to push the runs, WRITTEN DOWN BEFORE MEASURING so a surprise shows.
//
//  step 2 | G23 | a re-applied DoT/control no longer rewinds to its onset turn, so bleed/burn/
//         |     | poison finally deal damage on BOTH sides, and a refreshed freeze/stun finally
//         |     | rolls its saving throw (a NEW rng draw in exactly that case, so the draw count
//         |     | of any run containing a refreshed control condition moves).
//         | G30 | fracture on the ENEMY now feeds the enemy's to-hit roll, so a fractured enemy
//         |     | rolls TWO d20s instead of one (again, a real draw-count change).
//         | G22a| a healing tick is capped at effective max HP (RNG-free; no draw change).
//         |     | EXPECTED: enemy stronger (its DoT bites) and player stronger (theirs does too),
//         |     | runs longer/deeper on average. OBSERVED: floors cleared 13/6 -> 15/6 and
//         |     | avg level 61/6 -> 64/6, win rate unchanged at 2/6. Seed 3 / Hollow is
//         |     | BYTE-IDENTICAL (rngState 3234026647 both before and after) because that run
//         |     | dies to the Kingpin before any condition is ever re-applied — a useful
//         |     | control: the change is not a blanket perturbation of the stream.
// ---------------------------------------------------------------------------------------------
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
  { seed: 1, classId: 'Enforcer', outcome: 'death', diedAtAct: 4, finalAct: 4, finalLevel: 13, floorsCleared: 3, steps: 546, cause: 'Cursed The Repentant Supplicant', rngState: 2115806390 },
  { seed: 2, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 566, cause: 'unmade the Hollow (damnation)', rngState: 3244019037 },
  { seed: 3, classId: 'Enforcer', outcome: 'death', diedAtAct: 3, finalAct: 3, finalLevel: 7, floorsCleared: 2, steps: 263, cause: 'Lust', rngState: 973355852 },
  { seed: 1, classId: 'Hollow', outcome: 'death', diedAtAct: 3, finalAct: 3, finalLevel: 9, floorsCleared: 2, steps: 339, cause: 'Greed', rngState: 879109453 },
  { seed: 2, classId: 'Hollow', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 414, cause: 'unmade the Hollow (damnation)', rngState: 3176747043 },
  // Control row: unchanged from the pre-#0a baseline, byte for byte. This run dies to the
  // Kingpin before any condition is ever re-applied, so no rule in step 2 can touch it.
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
      avgLevel: 64 / 6,
      avgFloorsCleared: 15 / 6,
      deathByAct: { 1: 1, 2: 0, 3: 2, 4: 1, 5: 0 },
      perClass: {
        Enforcer: {
          runs: 3, wins: 1, grace: 0, damnation: 1, deaths: 2,
          winRate: 1 / 3, avgLevel: 36 / 3, avgFloorsCleared: 9 / 3,
          deathByAct: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 0 },
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
