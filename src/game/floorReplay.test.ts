// The descent replays, and saves anywhere in it (PLAN.md #2, AC-5 and AC-6).
//
// AC-5: a run is reproducible from `seed + inputs` (CLAUDE.md principle 1) across every floor
// mechanic this unit added — an illusion, a bargain, a found rest, floor 5's warped kit. The
// run is played once by the policy, then REPLAYED from its recorded inputs alone (no policy),
// and the two must agree byte for byte. The sim's hub gear-up is the one move outside `step`
// (sim.ts's recorded deviation), so the replay applies the same pure rule at the same hubs.
//
// AC-6: a save taken in the middle of each new situation — an illusory battle, a rest, a
// floor-5 run with a corruption map, and (Appendix A.3) the bargain's discard step — decodes to
// the live state, and the NEXT step from the decoded copy equals the next step from the live one.
//
// Every expectation is an identity between two independent paths; nothing is a measured number.

import { describe, it, expect } from 'vitest';
import { createGame, step, awaitingFor, type GameInput, type GameState, type StepResult } from './game.ts';
import { heuristicPolicy, gearUpAtHub, ALL_CLASSES } from './sim.ts';
import { encodeSave, decodeSave } from './save.ts';
import { floorOf } from './floors.ts';
import type { GameEvent } from './gameEvent.ts';
import type { PlayerClass } from './player.ts';

const GUARD = 50_000;

interface Played {
  inputs: GameInput[];
  /** The events of every step, in order — one array per step. */
  events: GameEvent[][];
  /** Every state the policy was asked about (the state BEFORE each input). */
  states: GameState[];
  final: GameState;
}

/** Play `seed` under the heuristic, recording every input, event list and pre-step state. */
function play(seed: number, classId: PlayerClass): Played {
  const policy = heuristicPolicy(classId);
  let res: StepResult = { state: createGame(seed), events: [], awaiting: 'title' };
  res = { ...res, awaiting: awaitingFor(res.state.phase) };
  const out: Played = { inputs: [], events: [], states: [], final: res.state };
  for (let n = 0; res.awaiting !== 'game-over' && n < GUARD; n++) {
    if (res.awaiting === 'main-menu') res = { ...res, state: gearUpAtHub(res.state) };
    const input = policy(res);
    out.states.push(res.state);
    out.inputs.push(input);
    res = step(res.state, input);
    out.events.push(res.events);
  }
  out.final = res.state;
  return out;
}

/** Replay recorded inputs from the seed alone — no policy consulted. */
function replay(seed: number, inputs: readonly GameInput[]): { events: GameEvent[][]; final: GameState } {
  let state = createGame(seed);
  const events: GameEvent[][] = [];
  for (const input of inputs) {
    if (awaitingFor(state.phase) === 'main-menu') state = gearUpAtHub(state);
    const r = step(state, input);
    events.push(r.events);
    state = r.state;
  }
  return { events, final: state };
}

function kindsOf(p: Played): Set<string> {
  return new Set(p.events.flat().map((e) => e.kind));
}

/** The first run (seeds 1.., every class) whose events include every kind in `want`. */
function findRun(want: readonly string[]): { seed: number; classId: PlayerClass; played: Played } {
  for (let seed = 1; seed <= 60; seed++) {
    for (const classId of ALL_CLASSES) {
      const played = play(seed, classId);
      const kinds = kindsOf(played);
      if (want.every((k) => kinds.has(k))) return { seed, classId, played };
    }
  }
  throw new Error(`no run in seeds 1..60 met all of ${want.join(', ')}`);
}

/** The descent's full set: an illusion met (struck or seen through), a bargain, a rest, floor 5. */
const FULL_DESCENT = ['illusion-dispelled', 'deal-taken', 'rest-found', 'skills-warped'] as const;

describe('AC-5 — a run replays byte-identically from seed + inputs, across all five floors', () => {
  const full = findRun(FULL_DESCENT);

  it('the chosen run really meets an illusion, takes a bargain, finds a rest and reaches floor 5', () => {
    const kinds = kindsOf(full.played);
    for (const k of FULL_DESCENT) expect(kinds.has(k), k).toBe(true);
    expect(floorOf(full.played.final)).toBe(5);
  });

  it('two independent policy plays agree, and the input-only replay agrees with both', () => {
    const again = play(full.seed, full.classId);
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(full.played.events));
    expect(JSON.stringify(again.final)).toBe(JSON.stringify(full.played.final));
    const r = replay(full.seed, full.played.inputs);
    expect(JSON.stringify(r.events)).toBe(JSON.stringify(full.played.events));
    expect(JSON.stringify(r.final)).toBe(JSON.stringify(full.played.final));
  });

  it('and so does a spread of seeds whose runs end on every floor 1..5', () => {
    const endFloors = new Set<number>();
    for (const classId of ['Enforcer', 'Hollow', 'Neuromancer'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const p = play(seed, classId);
        const r = replay(seed, p.inputs);
        expect(JSON.stringify(r.events), `${classId}/${seed}`).toBe(JSON.stringify(p.events));
        expect(JSON.stringify(r.final), `${classId}/${seed}`).toBe(JSON.stringify(p.final));
        endFloors.add(floorOf(p.final));
      }
    }
    // Non-vacuity: the spread really spans the descent (a death or an ending on each floor).
    expect([...endFloors].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('AC-6 — a save taken mid-situation round-trips, and the next step agrees', () => {
  const full = findRun(FULL_DESCENT);
  const { states, inputs } = full.played;

  /** The index of the first recorded pre-step state matching `pred`. */
  function firstIndex(pred: (s: GameState) => boolean): number {
    const i = states.findIndex(pred);
    if (i < 0) throw new Error('the run never reached that situation');
    return i;
  }

  function roundTrips(i: number): void {
    const live = states[i]!;
    const decoded = decodeSave(encodeSave(live));
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(live);
    // The next step — with the input the run really took there — is identical from either copy.
    const input = inputs[i]!;
    const fromLive = step(live, input);
    const fromSave = step(decoded!, input);
    expect(JSON.stringify(fromSave)).toBe(JSON.stringify(fromLive));
  }

  it('mid-battle against an ILLUSORY enemy', () => {
    const i = firstIndex(
      (s) => s.phase.kind === 'battle' && s.phase.started && s.phase.battle.enemy.illusory === true,
    );
    roundTrips(i);
    // The flag itself survived the trip (an illusion saved as a real enemy would be a new bug).
    const decoded = decodeSave(encodeSave(states[i]!))!;
    expect(decoded.phase.kind === 'battle' && decoded.phase.battle.enemy.illusory).toBe(true);
  });

  it('mid-rest (the calm screen, before continue)', () => {
    roundTrips(firstIndex((s) => s.phase.kind === 'rest'));
  });

  it('on floor 5 with a corruption map', () => {
    const i = firstIndex(
      (s) => floorOf(s) === 5 && Object.keys(s.player?.corruptedSkills ?? {}).length > 0 && s.phase.kind === 'main-menu',
    );
    roundTrips(i);
    expect(decodeSave(encodeSave(states[i]!))!.player!.corruptedSkills).toEqual(states[i]!.player!.corruptedSkills);
  });

  it('in the A.3 discard step a bargain opened on a full pack', () => {
    // The sim reaches this phase only to back out (its hub keeps a slot free whenever there is
    // gear to shed), so the round-trip is taken on a run that does reach it.
    const withRoom = findRun(['deal-needs-room']);
    const j = withRoom.played.states.findIndex((s) => s.phase.kind === 'deal-discard');
    expect(j).toBeGreaterThanOrEqual(0);
    const live = withRoom.played.states[j]!;
    const decoded = decodeSave(encodeSave(live));
    expect(decoded).toEqual(live);
    const input = withRoom.played.inputs[j]!;
    expect(JSON.stringify(step(decoded!, input))).toBe(JSON.stringify(step(live, input)));
  });
});
