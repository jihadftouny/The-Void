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
// #0a `combat-core` RULE LEDGER — WHY EVERY NUMBER IN THIS FILE MOVED.
//
// Twenty-three engine defects were fixed on the `agentic/combat-core` branch, seventeen of which
// legitimately change measured behaviour. Each row below is a DELIBERATE rules change from
// `docs/PLAN.md` #0 / `docs/FINDINGS.md` §4, recorded with the direction it was expected to push
// the runs — WRITTEN DOWN BEFORE MEASURING, so that a surprise is visible as a surprise. The
// per-step detail follows; this is the one-line summary of the whole unit:
//
//   RULE CHANGED                                        FIX   STEP  DIRECTION ON THESE RUNS
//   a re-applied DoT/control no longer resets to onset  G23    2    both sides stronger
//   fracture on the ENEMY feeds its to-hit roll         G30    2    enemy stronger (+1 draw)
//   a healing tick is capped at effective max HP        G22a   2    both sides slightly weaker
//   a rest cures conditions                             G27    3    PLAYER MUCH STRONGER
//   a rest refills skill charges                        G31    3    PLAYER MUCH STRONGER
//   the ambush +1 is battle-scoped, not latched         G12    4    PLAYER MUCH WEAKER
//   shield is cleared at the battle boundary            G25    4    player weaker
//   momentum decays across the boundary                 G34    4    player weaker
//   `canFlee` is derived from the boss                  G4     4    neutral here
//   one guarded damage path, four sites                 G24/29 5    NO MOVEMENT (RNG-free)
//   a rejected press resolves nothing                   G36    5    NO MOVEMENT (unreachable)
//   a flee consumable respects `canFlee`                G39    5    NO MOVEMENT (unreachable)
//   proficiency enters the to-hit total                 G32    6    player stronger (+2 to hit)
//   resistances actually mitigate                       G17    6    enemy stronger on balance
//   the enemy cannot cast what it cannot afford         G22b   6    enemy slightly weaker
//   an enemy that did not cast regains a charge         G22c   6    ENEMY MUCH STRONGER
//   floor 5 becomes a real floor behind an XP gate      G43    7    RUNS LONGER, act-5 deaths
//   `cheaper` cannot reach a 0-cost skill               G35    8    player weaker
//   a deal cannot drive maxHp/hp/a stat below 1         G20    8    neutral here
//   a non-integer draft index is a no-op                G45    8    neutral (unreachable)
//   the dead deal-quality twist is deleted              G16    8    neutral
//   clarity-draught is usable                           G28d   8    neutral here
//
// NET on this 6-seed sample: 2 wins -> 0, avg level 61/6 -> 49/6, floors cleared 13/6 -> 11/6,
// deaths redistributed out of act 1 and into acts 4-5. The REAL winnability guard is
// `balance.test.ts`'s 500-run heuristic sample, which still passes at 0.132 — see step 8 for the
// one place a constant had to move to keep it passing without touching the guard.
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
//         |     | floor GATE (`HOLLOW_GATE_XP`, set to 600 at this step and lowered to its
//         |     | SHIPPED value of 500 at step 8 — see there), so act 5 plays like acts 1-4:
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
//  step 8 | G35 | `cheaper` resolves against the PLAYER, so a skill can no longer be driven to
//         |     | 0 charge cost and cast free forever (274 of 300 seeds reached that).
//         | G20 | a deal cannot drive maxHp / hp / a stat below 1.
//         | G45 | a non-integer `draft-pick` index is a no-op instead of a TypeError.
//         | G16 | the dead deal-quality twist is deleted.  | G28d | clarity-draught is usable.
//         |     | EXPECTED: the player gets WEAKER — G35 removes an exploit the heuristic
//         |     | policy was reaching (it prefers `upgrade` offers), and the other four are
//         |     | guards on unreachable-or-rare paths. OBSERVED: both act-5 Enforcer deaths
//         |     | now happen a level earlier (20 -> 16 and 18 -> 16); the three act-1/act-4
//         |     | rows are BYTE-IDENTICAL, another useful control (those runs never level far
//         |     | enough to be offered a second `cheaper`).
//         | ⚠   | The 500-run `balance.test.ts` win rate fell to EXACTLY 0.120, which does not
//         |     | clear its `> 0.12` floor. Per this unit's own rule the CONSTANT was lowered,
//         |     | not the guard: `HOLLOW_GATE_XP` 600 -> 500, one step down the same derived
//         |     | curve (k = 6 kills, 240·e^(0.75) ~ 508). That measures 0.132.
// ---------------------------------------------------------------------------------------------
// #0c `persistence-and-reach` — ONE row, and it is a pure STREAM DISPLACEMENT.
//
//   RULE CHANGED                                        FIX   STEP  DIRECTION ON THESE RUNS
//   authored consumables/uniques join the drop tables   G14    3    NONE (noise, not difficulty)
//   act 5 uses the authored act-5 drop table            G14    3    NONE (inert in the sim)
//
// PREDICTION, WRITTEN BEFORE MEASURING. G14 inserts exactly ONE extra rng draw — the catalog
// gate — into every successful loot drop, on both the victory and the chest path, and both
// branches then take the same two draws, so a drop costs six either way. It changes no rule
// this sample can feel:
//   - the shipped sim policies NEVER use a consumable (`chooseBattleAction` returns only
//     fight / cast / potion / run / spare — FINDINGS.md G48), so a consumable in the backpack
//     is inert;
//   - the `step` controller has no equip action either (the balance report's own
//     "equipment un-modelled" caveat), so a dropped UNIQUE is equally inert;
//   - nothing in the combat path reads backpack contents at all.
// The act-5 clamp fix likewise only changes which rarity/slot weights an act-5 drop uses, and
// an act-5 drop is inert for the same three reasons. So the ONLY effect is that every draw
// after a run's first successful drop is shifted by one, and the run diverges chaotically
// from there. EXPECTED: all six rngStates move; outcomes scatter with NO systematic
// direction; the 500-run guard moves by noise.
//
// OBSERVED, and it matches: wins unchanged at 0/6. avg level 49/6 -> 54/6 and floors cleared
// 11/6 -> 13/6 (i.e. this small sample got slightly EASIER), while `balance.test.ts`'s
// 500-run heuristic sample went the OTHER WAY, 0.132 -> 0.126. A 6-seed sample and a 500-run
// sample disagreeing in SIGN is exactly what noise looks like, and is the evidence that this
// is displacement rather than a difficulty change. Deaths move out of act 5 (2 -> 0) and act
// 1 (3 -> 1) into acts 3-4 (1 -> 5); act-1 death SHARE on the 500-run sample improves
// 0.207 -> 0.163.
//
// ⚠ FLAGGED FOR #2, and it is the most important number this unit produces. `balance.test.ts`
// still passes UNMODIFIED, but its margin HALVED: 66 wins of 500 -> 63, against a floor of 60
// (`winRate > 0.12`). §22.21 records the pre-existing margin as six wins in 500 and pins
// `HOLLOW_GATE_XP = 500` to exactly this threshold. Three wins is not a margin anybody should
// rely on, and per this unit's hard gate NOTHING was retuned to widen it — that is #2's call,
// with measurements. Per-class wins over the same 500 runs: Enforcer 9 -> 13, Neuromancer
// 2 -> 1, Scavver 45 -> 42, Penitent 3 -> 1, Hollow 7 -> 6. Neuromancer and Penitent are now
// at ONE win in a hundred, so the "no class stuck at ~0%" assertion is one unlucky seed from
// failing for a reason that has nothing to do with the class.
// ---------------------------------------------------------------------------------------------
// #2 `floor-mechanics` RULE LEDGER — one row per commit that moves these numbers, each with its
// direction WRITTEN DOWN BEFORE MEASURING (the #0a discipline). `balance.test.ts`'s 500-run
// heuristic win rate is quoted alongside, because six runs are a fingerprint, not a sample.
//
//   RULE / POLICY CHANGED                                  STEP  DIRECTION ON THESE RUNS
//   the sim gears up at the hub + heals with found items    S1   PLAYER MUCH STRONGER
//   floor 3: heals x50%, one charge drained per battle      S2   player weaker from floor 3
//   floor 4: karma earned there counts double               S2   NONE on these runs
//   floor 2: a third of fights are illusions (A.1)          S3   predicted WEAKER — was WRONG
//
//  S1 | NOT AN ENGINE RULE — a SIM POLICY, landed FIRST (a recorded reordering of the plan's
//     | step 12) so that every later rules change is measured against a player who uses what
//     | it finds. The heuristic now (a) equips found gear at every hub visit through the same
//     | pure `equip` the UI's Equip button calls, outside `step` (`sim.ts` `gearUpAtHub`: an
//     | empty slot takes anything, an occupied one only a strictly higher rarity), and (b) heals
//     | with a found `healSelf` consumable at <= 35% HP once potions run out. The ENGINE IS
//     | UNTOUCHED: `finalRngState` below applies the same gear-up, so the lock still measures
//     | "these inputs, this engine".
//     | EXPECTED (plan §7, written before any run): PLAYER MUCH STRONGER — the old 32.9%
//     | headline described a character that never equipped anything, and every empty paperdoll
//     | slot now fills. OBSERVED: wins 0/6 -> 3/6 (three damnation endings), avg level 54/6 ->
//     | 104/6, floors cleared 13/6 -> 20/6; the 500-run guard 0.126 -> 0.580 (Scavver 0.84,
//     | Enforcer 0.67, Neuromancer/Hollow 0.48, Penitent 0.43). That is far ABOVE the one-in-three
//     | target, which is the point: #2's re-run now tunes a real game DOWN toward it instead of a
//     | gearless one up.
//  S2 | THE FLOOR HOOK (`floors.ts` + `floors.json`), with its two numeric floors live. Floor 3:
//     | every dampenable heal (rest, consumable, relic healSelf, mend, lifesteal) is floored at
//     | 50%, and one skill charge is drained at every battle open — RNG-free both, so only the
//     | DECISIONS they change can move a draw. Floor 4: karma is recorded x2.
//     | EXPECTED (written before measuring): runs that die before floor 3 are BYTE-IDENTICAL;
//     | runs that reach floor 3 get weaker (fewer casts, smaller rests). Floor 4's weight moves
//     | nothing here: the heuristic never spares or takes deals, so its ledger only ever falls,
//     | the verdict is cast-down either way, and the Sin's axis is read on floor 3, before it.
//     | OBSERVED: Enforcer seed 3 is BYTE-IDENTICAL (rngState 4155263102) — it dies in its
//     | first floor-3 fight before any drained charge changes a decision, a useful control. The
//     | other five move; Hollow seed 2 turns a damnation into an act-4 death; wins 3/6 -> 2/6.
//     | The 500-run guard 0.580 -> 0.556, in the predicted direction.
//  S3 | FLOOR 2's ILLUSIONS (plan Appendix A.1, CONFIRMED: real damage from the illusion, none
//     | from you, seeing through ends the fight with no XP and no loot). One extra draw builds
//     | every floor-2 random battle (the illusion roll, last); one d20 per round against an
//     | illusion (the passive Wisdom roll); `seeThroughIllusion` finally fires.
//     | EXPECTED (written before measuring): PLAYER WEAKER — a third of floor 2 becomes rounds
//     | of real damage for no reward.
//     | OBSERVED, and the prediction was WRONG: all six runs now WIN (six damnations, 2/6 ->
//     | 6/6), and the 500-run guard RISES 0.556 -> 0.602, with 4 heuristic runs reaching GRACE.
//     | Diagnosed rather than accepted (PRINCIPLES §A4), over 300 heuristic runs, floor 2 only:
//     | an illusion lasts 2.28 rounds and costs 0.63 HP (612 of 617 seen through, 3 fled, 2
//     | died inside one), while a REAL floor-2 fight lasts 3.80 rounds and costs 1.69 HP. The
//     | roll rate matches the DC derivation (P = 0.40 at WIS 10 -> 2.5 rolls). So at these
//     | numbers an illusion is CHEAPER than the fight it replaces; its cost is TEMPO (no XP, so
//     | floor 2 takes more encounters — more chests, rests and gear), and each dispel adds a
//     | point of clarity, which the generous verdict (§22.16) can tip into grace even for a run
//     | that kills everything. Nothing was softened or retuned (A.1 forbids it); this is the
//     | author's evidence, and `docs/BALANCE-REPORT.md` carries the per-class and per-Wisdom
//     | tables it feeds.
// ---------------------------------------------------------------------------------------------
//
// Coverage: 3 seeds x 2 classes played end to end under the deterministic `heuristicPolicy`
// (outcome, act, level, floors, step count, cause), the FINAL RNG ACCUMULATOR of a full run
// (the sharpest possible probe of draw count and draw order — one extra or missing `rng()`
// call anywhere in the run moves it), and a whole `simulateBatch` aggregate.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, step, awaitingFor } from './game.ts';
import type { GameState, GameInput } from './game.ts';
import type { GameEvent } from './gameEvent.ts';
import { simulateRun, simulateBatch, heuristicPolicy, gearUpAtHub } from './sim.ts';
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
    // #2 S1: the sim's hub gear-up, exactly as `runToTerminal` applies it.
    if (awaiting === 'main-menu') state = gearUpAtHub(state);
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
// #0c: ALL SIX rows moved, and every one of them was expected to — the catalog gate shifts
// every draw after a run's first successful loot drop, and each of these runs takes a drop
// early. NO row is byte-identical this time, and that absence is itself consistent with the
// prediction: unlike #0a's steps 5 and 8, there is no run here short enough to end before its
// first victory. The nearest thing to a control is the 500-run sample moving the OTHER WAY.
const GOLDEN_RUNS: readonly (RunResult & { rngState: number })[] = [
  { seed: 1, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 22, floorsCleared: 4, steps: 447, cause: 'unmade the Hollow (damnation)', rngState: 2650064866 },
  { seed: 2, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 23, floorsCleared: 4, steps: 336, cause: 'unmade the Hollow (damnation)', rngState: 3398875834 },
  { seed: 3, classId: 'Enforcer', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 22, floorsCleared: 4, steps: 392, cause: 'unmade the Hollow (damnation)', rngState: 3583123126 },
  { seed: 1, classId: 'Hollow', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 24, floorsCleared: 4, steps: 498, cause: 'unmade the Hollow (damnation)', rngState: 3289476836 },
  { seed: 2, classId: 'Hollow', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 23, floorsCleared: 4, steps: 469, cause: 'unmade the Hollow (damnation)', rngState: 2984923452 },
  { seed: 3, classId: 'Hollow', outcome: 'damnation', diedAtAct: null, finalAct: 5, finalLevel: 24, floorsCleared: 4, steps: 466, cause: 'unmade the Hollow (damnation)', rngState: 130298488 },
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
      wins: 6,
      grace: 0,
      damnation: 6,
      deaths: 0,
      winRate: 6 / 6,
      // Summed from the GOLDEN_RUNS rows above: levels 22+23+22+24+23+24 = 138, floors
      // 4 x 6 = 24. Written as the fraction so the two stay visibly tied together.
      avgLevel: 138 / 6,
      avgFloorsCleared: 24 / 6,
      deathByAct: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      perClass: {
        Enforcer: {
          runs: 3, wins: 3, grace: 0, damnation: 3, deaths: 0,
          winRate: 3 / 3, avgLevel: 67 / 3, avgFloorsCleared: 12 / 3,
          deathByAct: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        },
        Hollow: {
          runs: 3, wins: 3, grace: 0, damnation: 3, deaths: 0,
          winRate: 3 / 3, avgLevel: 71 / 3, avgFloorsCleared: 12 / 3,
          deathByAct: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        },
      },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The DETERMINISM guard this whole file rests on. Every golden number above is meaningless if a
// run can consult the wall clock or an unseeded generator, so the rule is asserted directly on
// the shipping source rather than trusted to review: `CLAUDE.md` load-bearing principle 2, "never
// call Math.random() or Date.now() inside src/game".
// ---------------------------------------------------------------------------------------------

describe('the logic core contains no unseeded randomness and no clock', () => {
  it('no shipping file under src/game CALLS Math.random or Date.now', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const lines = readFileSync(join(dir, name), 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Skip comment lines — several modules DOCUMENT the prohibition by naming it.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (/\bMath\s*\.\s*random\s*\(/.test(line) || /\bDate\s*\.\s*now\s*\(/.test(line)) {
          offenders.push(`${name}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('scans a non-trivial number of files (so an empty sweep cannot pass vacuously)', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const shipping = readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
    expect(shipping.length).toBeGreaterThan(30);
  });
});
