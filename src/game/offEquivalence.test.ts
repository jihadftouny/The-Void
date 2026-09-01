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
//  step 4 | G12 | the encounter's +1 ambush bonus is battle-scoped, so it no longer leaks onto
//         |     | the player and into EVERY later fight; a condition's adv/dis is combined
//         |     | per-round instead of latched. This changes the DRAW COUNT directly: a roll
//         |     | at ±1 draws two d20s, at 0 one.
//         | G25 | shield is zeroed at the battle boundary (it used to accumulate 5,10,15,…).
//         | G34 | momentum decays across the boundary instead of carrying at the cap.
//         | G4  | `canFlee` is derived from the boss, so a boss fight can never be fled.
//         |     | EXPECTED: player notably WEAKER — the biggest single item is that every
//         |     | floor boss and the final Hollow used to be fought at a +1 to hit nobody
//         |     | granted. OBSERVED, and it is the mirror of step 3: wins 5/6 -> 1/6, avg
//         |     | level 85/6 -> 71/6, floors cleared 21/6 -> 17/6, and deaths bunch at acts
//         |     | 3-4 (the boss floors) rather than early. `balance.test.ts`'s win-rate and
//         |     | act-1-share guards still pass unweakened.
//  step 5 | G24 | the failed-escape counter-attack, the boss-minion tick and the consumable
//         | G29 | path all run the SAME guarded damage helper as the ordinary round.
//         | G36 | a rejected press no longer advances the boss's per-round mechanic.
//         | G39 | a flee consumable cannot escape a battle that forbids fleeing.
//         |     | EXPECTED: NO MOVEMENT AT ALL in these six runs. Every step of the extracted
//         |     | helper is RNG-free, the heuristic policy owns no relics or shield (so the
//         |     | guards are all identity), and `sim.test.ts` already proves the policy never
//         |     | issues a rejected action. OBSERVED: every golden row unchanged, byte for
//         |     | byte — which is the strongest evidence available that the four-site
//         |     | extraction is faithful rather than merely green.
//  step 6 | G32 | `proficiency` (2 at creation) enters the to-hit total: the player is about
//         |     | ten percentage points more accurate. PLAYER STRONGER.
//         | G17 | resistances mitigate for real (`max(0, base - round(base*res/100))`) against
//         |     | EFFECTIVE resistances, and the family/affix magnitudes were rescaled 2 -> 25
//         |     | so they can matter at all. Cuts BOTH ways, but there are far more resistant
//         |     | ENEMIES than resistant players, so on balance: enemy stronger.
//         | G22b| the enemy skill pick draws over the AFFORDABLE subset (a changed draw VALUE
//         |     | for mixed-cost pools) and draws NOTHING when nothing is affordable.
//         | G22c| an enemy that cast nothing regains 1 charge, so themed skills land all
//         |     | battle instead of only on the first two hits. ENEMY MUCH STRONGER.
//         |     | EXPECTED: the enemy side dominates — G22c alone converts most later enemy
//         |     | hits from a flat 1 into a themed skill. OBSERVED: wins 1/6 -> 2/6 (the
//         |     | Enforcer's accuracy gain shows), but avg level 71/6 -> 49/6 and floors
//         |     | cleared 17/6 -> 11/6, with deaths moving hard back to act 1 (0 -> 3): two
//         |     | seeds now die inside ~20 steps to an act-1 elite. `balance.test.ts`'s
//         |     | win-rate (> 0.12) and act-1-share (< 0.55) guards still pass over their
//         |     | 500-run sample, but this is the swing #2's re-run most needs to look at.
//  step 7 | G43 | floor 5 gets an ENCOUNTER LAYER. The Hollow moves from floor ENTRY to a
//         |     | floor GATE (`HOLLOW_GATE_XP = 600`), so act 5 now plays like acts 1-4:
//         |     | random battles, chests, rests, deals and lore, all of which were previously
//         |     | unreachable (0 act-5 hub states over ~17.7 M probed transitions).
//         |     | EXPECTED: runs get LONGER at act 5 and some that used to walk straight into
//         |     | the Hollow now die on the floor before it. OBSERVED exactly that: the two
//         |     | Enforcer wins become act-5 DEATHS at level 20 and 18 with all four earlier
//         |     | floors cleared, so this sample drops to 0 wins. The real guard —
//         |     | `balance.test.ts`'s 500-run heuristic win rate — still passes at 0.126,
//         |     | though that is uncomfortably close to its 0.12 floor and 47 of its 437
//         |     | deaths are now on act 5 (previously 0, because act 5 was boss-only).
//         |     | ⚠ FLAGGED FOR #2: 600 is a derived placeholder, and floor 5 is now the
//         |     | deadliest stretch of the descent.
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
  { seed: 1, classId: 'Enforcer', outcome: 'death', diedAtAct: 5, finalAct: 5, finalLevel: 20, floorsCleared: 4, steps: 507, cause: 'The Unraveled Unbeing', rngState: 3601606521 },
  { seed: 2, classId: 'Enforcer', outcome: 'death', diedAtAct: 5, finalAct: 5, finalLevel: 18, floorsCleared: 4, steps: 523, cause: 'Mirrored Reflection', rngState: 3556148722 },
  { seed: 3, classId: 'Enforcer', outcome: 'death', diedAtAct: 1, finalAct: 1, finalLevel: 1, floorsCleared: 0, steps: 21, cause: 'Armored Psycho', rngState: 560318176 },
  { seed: 1, classId: 'Hollow', outcome: 'death', diedAtAct: 4, finalAct: 4, finalLevel: 12, floorsCleared: 3, steps: 380, cause: 'The Knight', rngState: 2887346257 },
  { seed: 2, classId: 'Hollow', outcome: 'death', diedAtAct: 1, finalAct: 1, finalLevel: 3, floorsCleared: 0, steps: 92, cause: 'Undercity Kingpin', rngState: 2809167167 },
  { seed: 3, classId: 'Hollow', outcome: 'death', diedAtAct: 1, finalAct: 1, finalLevel: 1, floorsCleared: 0, steps: 17, cause: 'Armored Psycho', rngState: 1320036240 },
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
      wins: 0,
      grace: 0,
      damnation: 0,
      deaths: 6,
      winRate: 0 / 6,
      avgLevel: 55 / 6,
      avgFloorsCleared: 11 / 6,
      deathByAct: { 1: 3, 2: 0, 3: 0, 4: 1, 5: 2 },
      perClass: {
        Enforcer: {
          runs: 3, wins: 0, grace: 0, damnation: 0, deaths: 3,
          winRate: 0 / 3, avgLevel: 39 / 3, avgFloorsCleared: 8 / 3,
          deathByAct: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 2 },
        },
        Hollow: {
          runs: 3, wins: 0, grace: 0, damnation: 0, deaths: 3,
          winRate: 0 / 3, avgLevel: 16 / 3, avgFloorsCleared: 3 / 3,
          deathByAct: { 1: 2, 2: 0, 3: 0, 4: 1, 5: 0 },
        },
      },
    });
  });
});
