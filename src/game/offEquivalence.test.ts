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
//  step 3 | G27 | a rest CURES every condition (fracture was otherwise permanent for the run).
//         | G31 | a rest REFILLS skill charges (they were never restored at all). Also a
//         |     | documented draw-order change: a full-HP player who is fractured or short of
//         |     | charges now TAKES the rest, and so consumes the `computeRestHeal` draw it
//         |     | used to skip.
//         |     | EXPECTED: player much stronger — the heuristic policy casts, and its class
//         |     | skills used to be one-shot per run. OBSERVED, and it is a BIG swing that #2's
//         |     | balance re-run must know about: wins 2/6 -> 5/6, avg level 64/6 -> 85/6,
//         |     | floors cleared 15/6 -> 21/6, and the single remaining death moves to act 2.
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
  { seed: 1, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 430, cause: 'unmade the Hollow (damnation)', rngState: 3567970524 },
  { seed: 2, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 514, cause: 'unmade the Hollow (damnation)', rngState: 3394630331 },
  { seed: 3, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 462, cause: 'unmade the Hollow (damnation)', rngState: 3872523911 },
  { seed: 1, classId: 'Hollow', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 17, floorsCleared: 4, steps: 473, cause: 'unmade the Hollow (damnation)', rngState: 1649734614 },
  { seed: 2, classId: 'Hollow', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 16, floorsCleared: 4, steps: 643, cause: 'unmade the Hollow (damnation)', rngState: 3100984043 },
  { seed: 3, classId: 'Hollow', outcome: 'death', diedAtAct: 2, finalAct: 2, finalLevel: 4, floorsCleared: 1, steps: 128, cause: 'Warped Eldritch Beholder', rngState: 1722166819 },
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
      wins: 5,
      grace: 0,
      damnation: 5,
      deaths: 1,
      winRate: 5 / 6,
      avgLevel: 85 / 6,
      avgFloorsCleared: 21 / 6,
      deathByAct: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 },
      perClass: {
        Enforcer: {
          runs: 3, wins: 3, grace: 0, damnation: 3, deaths: 0,
          winRate: 3 / 3, avgLevel: 48 / 3, avgFloorsCleared: 12 / 3,
          deathByAct: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        },
        Hollow: {
          runs: 3, wins: 2, grace: 0, damnation: 2, deaths: 1,
          winRate: 2 / 3, avgLevel: 37 / 3, avgFloorsCleared: 9 / 3,
          deathByAct: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 },
        },
      },
    });
  });
});
