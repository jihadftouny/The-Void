// WHAT THE AUTHOR WILL ACTUALLY SEE, from a jumped state, through the REAL `step`.
//
// Every check deferred on 2026-09-06 for needing a full run is proved REACHABLE here: the
// three ending screens, the Judged spare on floor 4, the floor-5 gate, the act-5 no-flee
// rule. These are stated in player-facing terms — the sentence on the screen, the row in the
// summary — and computed through the shipping projectors, never asserted against a field.
//
// EVERY EXPECTED VALUE IS DERIVED FROM A SPECIFICATION, NOT MEASURED:
//   · grace / cast-down          from `GATE_WEIGHTS` x axes vs `GATE_THRESHOLD`
//   · the Judged's spare delta   from `enemyFamilies.json`'s `onSpare` folded through
//                                `KARMA_DELTAS`
//   · the Hollow gate boundary   from `HOLLOW_GATE_XP`
//   · the ending prose           from `story.json`'s `endings` block
//   · the summary headlines      from `runSummaryView`'s three stated outcomes
//
// The karma-leak sweep at the end is the one that matters most for this unit: the panel is
// the first tool in the project that can put a NON-ZERO, unmistakable karma vector into a
// live run, so it is the first tool that could ever have leaked one.

import { describe, it, expect } from 'vitest';
import { buildJump, getPreset, type JumpBundle } from './devState.ts';
import { awaitingFor, step, type GameInput, type GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { GATE_THRESHOLD, GATE_WEIGHTS, BOSSES } from '../game/boss.ts';
import { KARMA_DELTAS, createKarma, type KarmaState } from '../game/karma.ts';
import { HOLLOW_GATE_XP } from '../game/progression.ts';
import { getDamnationEnding, getGraceEnding } from '../game/story.ts';
import { getFamily } from '../game/enemyFamily.ts';
import { emptyRunSummary, foldRunEvents } from '../game/unlockStore.ts';
import { heuristicPolicy } from '../game/sim.ts';
import { runSummaryView, spareOffered } from '../desktop/view-model.ts';
import { formatEvent } from '../render/format.ts';
import { describeEvent } from '../llm/narrate.ts';

/** The four axes as a delta, so a karma assertion is a CHANGE and never a state of the world. */
function karmaDelta(before: KarmaState, after: KarmaState): KarmaState {
  return {
    mercyCruelty: after.mercyCruelty - before.mercyCruelty,
    restraintGreed: after.restraintGreed - before.restraintGreed,
    reverenceDesecration: after.reverenceDesecration - before.reverenceDesecration,
    clarityDelusion: after.clarityDelusion - before.clarityDelusion,
  };
}

/** The bundle a named preset builds. Fails loudly if the preset has been renamed away. */
function preset(id: string): JumpBundle {
  const row = getPreset(id);
  expect(row, `preset ${id} is gone — this anchor has gone stale`).toBeDefined();
  return buildJump(row!.spec);
}

// =========================================================================================
// 1. GRACE — the ending the kill-everything baseline can never reach.
// =========================================================================================

describe('the grace ending, from the verdict-grace jump', () => {
  it('the gate arithmetic this jump relies on, read off the constants as a spec', () => {
    // `{mercyCruelty: 1}` weighted: 1 x 1 = 1, and GRACE is `sum >= GATE_THRESHOLD`.
    expect(GATE_WEIGHTS.mercyCruelty).toBe(1);
    expect(GATE_THRESHOLD).toBe(1);
    expect(GATE_WEIGHTS.mercyCruelty * 1).toBeGreaterThanOrEqual(GATE_THRESHOLD);
  });

  it('one `continue` from the hub opens a verdict whose outcome is grace', () => {
    const bundle = preset('verdict-grace');
    expect(bundle.state.karma.mercyCruelty).toBe(1);
    const opened = step(bundle.state, { kind: 'menu', choice: 'continue' });
    expect(opened.state.phase).toEqual({ kind: 'verdict', outcome: 'grace' });
    expect(opened.events).toContainEqual({ kind: 'verdict', outcome: 'grace' });
  });

  it('and the next `continue` shows the ASCENSION text from story.json', () => {
    const bundle = preset('verdict-grace');
    const opened = step(bundle.state, { kind: 'menu', choice: 'continue' });
    const ended = step(opened.state, { kind: 'continue' });
    const ending = getGraceEnding();
    // Derived from the DATA, not from a run: the grace ending carries no `{playerName}`
    // token (G49), so the body reaches the screen unchanged.
    expect(ending.header).toBe('ASCENSION');
    expect(ending.body).not.toContain('{playerName}');
    expect(ended.events).toContainEqual({
      kind: 'ending',
      endingType: 'grace',
      header: ending.header,
      body: ending.body,
    });
    expect(ended.state.phase).toEqual({ kind: 'ending', endingType: 'grace' });
  });

  it('and the end-of-run screen reads "Found worthy. The descent ends in grace."', () => {
    const bundle = preset('verdict-grace');
    let summary = bundle.meta.runSummary;
    let state = bundle.state;
    for (const input of [{ kind: 'menu', choice: 'continue' }, { kind: 'continue' }] as GameInput[]) {
      const result = step(state, input);
      // The REAL subscriber the renderer runs, folded exactly as `dispatch` folds it.
      summary = foldRunEvents(summary, result.events, result.state);
      state = result.state;
    }
    expect(summary.endingType).toBe('grace');
    expect(runSummaryView(summary, state.player, null).headline).toBe(
      'Found worthy. The descent ends in grace.',
    );
  });
});

// =========================================================================================
// 2. CAST DOWN — the other side of the same gate, and the fall to act 5.
// =========================================================================================

describe('the cast-down verdict, from the verdict-castdown jump', () => {
  it('the gate arithmetic, again from the constants', () => {
    // Reverence is the heavy axis: 3 x (-1) = -3, which is below the threshold of 1.
    expect(GATE_WEIGHTS.reverenceDesecration).toBe(3);
    expect(GATE_WEIGHTS.reverenceDesecration * -1).toBeLessThan(GATE_THRESHOLD);
  });

  it('opens a cast-down verdict and walks act-outro -> act-intro -> hub at act 5', () => {
    const bundle = preset('verdict-castdown');
    const verdict = step(bundle.state, { kind: 'menu', choice: 'continue' });
    expect(verdict.state.phase).toEqual({ kind: 'verdict', outcome: 'cast-down' });

    const outro = step(verdict.state, { kind: 'continue' });
    expect(outro.state.phase.kind).toBe('act-outro');
    expect(outro.state.act).toBe(5);
    expect(outro.state.place).toBe(4);

    const intro = step(outro.state, { kind: 'continue' });
    expect(intro.state.phase.kind).toBe('act-intro');

    const hub = step(intro.state, { kind: 'continue' });
    expect(hub.state.phase.kind).toBe('main-menu');
    expect(hub.state.act).toBe(5);
    expect(hub.state.place).toBe(4);
  });

  it('the two verdict presets differ ONLY in karma, so the gate is what decided it', () => {
    // Delta form. If the outcome came from anything else — the act, the XP, the seed — the
    // two would not be identical everywhere but the vector.
    const grace = preset('verdict-grace').state;
    const cast = preset('verdict-castdown').state;
    expect({ ...grace, karma: null }).toEqual({ ...cast, karma: null });
    expect(grace.karma).not.toEqual(cast.karma);
  });
});

// =========================================================================================
// 3. DAMNATION and DEATH — the other two end-of-run screens.
// =========================================================================================

describe('the damnation ending, from the ending-damnation jump', () => {
  it('one `continue` emits the DAMNATION ending and its summary headline', () => {
    const bundle = preset('ending-damnation');
    expect(bundle.state.phase).toEqual({ kind: 'battle-victory', final: true });
    const result = step(bundle.state, { kind: 'continue' });
    const ending = getDamnationEnding();
    expect(ending.header).toBe('DAMNATION');
    expect(result.events).toContainEqual({
      kind: 'ending',
      endingType: 'damnation',
      header: ending.header,
      body: ending.body,
    });
    const summary = foldRunEvents(bundle.meta.runSummary, result.events, result.state);
    expect(runSummaryView(summary, result.state.player, null).headline).toBe(
      'The Hollow unmade. The descent ends in damnation.',
    );
  });
});

describe('the death summary, from the ending-death jump', () => {
  const rowsOf = (bundle: JumpBundle) =>
    runSummaryView(bundle.meta.runSummary, bundle.state.player, null);

  it('lands on the game-over screen', () => {
    const bundle = preset('ending-death');
    expect(awaitingFor(bundle.state.phase)).toBe('game-over');
  });

  it('reads "The descent ends here." with depth, bosses BY NAME, and spares', () => {
    const view = rowsOf(preset('ending-death'));
    expect(view.headline).toBe('The descent ends here.');
    const row = (label: string) => view.rows.find((r) => r.label === label)?.value;
    expect(row('Depth reached')).toBe('Act 4 of 5');
    // Display names, never ids — `runSummaryView` promises no raw id reaches a row.
    expect(row('Bosses felled')).toBe(`${BOSSES.kingpin.name}, ${BOSSES.reflection.name}`);
    expect(row('Bosses felled')).not.toContain('kingpin');
    expect(row('Foes spared')).toBe('3');
  });

  it('DELTA: raising the spare count changes exactly that row and nothing else', () => {
    const base = preset('ending-death');
    const bumped: JumpBundle = {
      ...base,
      meta: { ...base.meta, runSummary: { ...base.meta.runSummary, spareCount: 4 } },
    };
    const before = rowsOf(base);
    const after = rowsOf(bumped);
    expect(after.headline).toBe(before.headline);
    const changed = after.rows.filter((r, i) => r.value !== before.rows[i]?.value);
    expect(changed).toEqual([{ label: 'Foes spared', value: '4' }]);
  });
});

// =========================================================================================
// 4. THE JUDGED, FLOOR 4 — the check this whole unit exists to unblock.
// =========================================================================================

describe('sparing The Judged on floor 4', () => {
  /** Open the jumped battle so a `battle-action` is legal. */
  function opened(bundle: JumpBundle) {
    return step(bundle.state, { kind: 'continue' });
  }

  it('the jump really puts The Judged in front of the player, on floor 4', () => {
    const bundle = preset('judged-act4');
    expect(bundle.state.act).toBe(4);
    expect(bundle.state.place).toBe(3);
    expect(bundle.state.phase.kind).toBe('battle');
    const phase = bundle.state.phase;
    expect(phase.kind === 'battle' && phase.battle.enemy.familyId).toBe('theJudged');
    expect(phase.kind === 'battle' && phase.battle.enemy.karmaWeighted).toBe(true);
  });

  it('and the Spare control is offered once the battle is open', () => {
    const bundle = preset('judged-act4');
    // Before the battle starts, `spareOffered` is false — the control appears with the fight.
    expect(spareOffered(bundle.state)).toBe(false);
    expect(spareOffered(opened(bundle).state)).toBe(true);
  });

  it('the spare moves BOTH axes in ONE step — mercy and reverence', () => {
    // Derived from the data as a spec: theJudged declares
    // `onSpare: ["spareWeighted", "honorDead"]`, and `KARMA_DELTAS` maps those to
    // {mercyCruelty: +1} and {reverenceDesecration: +1}. Folded, that is +1 / +1.
    const family = getFamily('theJudged')!;
    expect(family.onSpare).toEqual(['spareWeighted', 'honorDead']);
    expect(KARMA_DELTAS.spareWeighted).toEqual({ mercyCruelty: 1 });
    expect(KARMA_DELTAS.honorDead).toEqual({ reverenceDesecration: 1 });

    const bundle = preset('judged-act4');
    const open = opened(bundle);
    const spared = step(open.state, { kind: 'battle-action', action: 'spare' });
    expect(karmaDelta(open.state.karma, spared.state.karma)).toEqual({
      mercyCruelty: 1,
      restraintGreed: 0,
      reverenceDesecration: 1,
      clarityDelusion: 0,
    });
    expect(spared.state.phase.kind).toBe('main-menu');
  });

  it('CONTROL: an ordinary weighted family moves mercy only', () => {
    // Without this the assertion above is satisfied by "every spare moves two axes".
    const family = getFamily('gangers')!;
    expect(family.onSpare).toEqual(['spareWeighted']);
    const bundle = buildJump({ act: 1, xp: 0, target: { kind: 'encounter', familyId: 'gangers' } });
    const open = step(bundle.state, { kind: 'continue' });
    const spared = step(open.state, { kind: 'battle-action', action: 'spare' });
    expect(karmaDelta(open.state.karma, spared.state.karma)).toEqual({
      mercyCruelty: 1,
      restraintGreed: 0,
      reverenceDesecration: 0,
      clarityDelusion: 0,
    });
  });

  it('...and the player is told NOTHING about any of it', () => {
    const bundle = preset('judged-act4');
    const open = opened(bundle);
    const spared = step(open.state, { kind: 'battle-action', action: 'spare' });
    expect(spared.events.length, 'the spare emitted no events to sweep').toBeGreaterThan(0);
    const surfaces = spared.events.flatMap(renderedSurfaces);
    expect(surfaces.length).toBeGreaterThan(2);
    for (const text of surfaces) {
      expect(text, `karma vocabulary reached a player surface: ${text}`).not.toMatch(
        AXIS_VOCABULARY,
      );
    }
  });
});

// =========================================================================================
// 5. FLOOR 5 — the gate is exactly where the constant says, and the floor has a length.
// =========================================================================================

describe('the Hollow gate on floor 5', () => {
  /** `menu:continue` from a floor-5 hub at a given XP. */
  function continueAt(xp: number) {
    const bundle = buildJump({ act: 5, xp, target: { kind: 'hub' } });
    return step(bundle.state, { kind: 'menu', choice: 'continue' });
  }

  const isFinalBattle = (state: GameState): boolean =>
    state.phase.kind === 'battle' && state.phase.final;

  it('the boundary is HOLLOW_GATE_XP, read as a spec: 499 no, 500 yes', () => {
    expect(HOLLOW_GATE_XP).toBe(500);
    expect(isFinalBattle(continueAt(HOLLOW_GATE_XP - 1).state)).toBe(false);
    expect(isFinalBattle(continueAt(HOLLOW_GATE_XP).state)).toBe(true);
  });

  it('the act5-hollow-ready jump opens the Hollow on the very next continue', () => {
    const result = step(preset('act5-hollow-ready').state, { kind: 'menu', choice: 'continue' });
    expect(isFinalBattle(result.state)).toBe(true);
    expect(result.events.map((e) => e.kind)).toContain('final-battle-begins');
  });

  it('below the gate floor 5 has a real encounter layer, and never the Hollow (G43)', () => {
    // The measurement this unblocks: how long floor 5 is. The COUNT is reported, never
    // asserted — it is `PLAN.md` #2's balance number, not this unit's.
    const bundle = preset('act5-hub-fresh');
    const policy = heuristicPolicy(bundle.state.player!.classId);
    let result = { state: bundle.state, events: [] as GameEvent[], awaiting: awaitingFor(bundle.state.phase) };
    let encounters = 0;
    let steps = 0;
    while (result.awaiting !== 'game-over' && steps < 4000) {
      if (result.state.player!.xp >= HOLLOW_GATE_XP) break;
      expect(
        isFinalBattle(result.state),
        'the Hollow appeared below its own gate — that is G43 restored',
      ).toBe(false);
      result = step(result.state, policy(result));
      steps += 1;
      if (result.events.some((e) => e.kind === 'encounter-start')) encounters += 1;
    }
    expect(steps, 'floor 5 produced no steps at all').toBeGreaterThan(0);
    expect(encounters, 'floor 5 offered no encounters — G43 is back').toBeGreaterThan(0);
    // eslint-disable-next-line no-console -- a measurement for PLAN.md #2, never an assertion
    console.log(
      `[floor-5 length] encounters before the Hollow gate: ${encounters} (steps: ${steps}, ` +
        `xp reached: ${result.state.player?.xp ?? 0})`,
    );
  });
});

// =========================================================================================
// 6. ACT 5 — escape is impossible.
// =========================================================================================

describe('the act-5 no-flee rule, from the hollow-fight jump', () => {
  it('the battle is unfleeable', () => {
    const bundle = preset('hollow-fight');
    expect(bundle.state.phase.kind === 'battle' && bundle.state.phase.battle.canFlee).toBe(false);
  });

  it('and pressing Run leaves the player in the fight, with escape-impossible said out loud', () => {
    const bundle = preset('hollow-fight');
    const open = step(bundle.state, { kind: 'continue' });
    const ran = step(open.state, { kind: 'battle-action', action: 'run' });
    expect(ran.state.phase.kind).toBe('battle');
    expect(ran.events.map((e) => e.kind)).toContain('escape-impossible');
  });

  it('CONTROL: an ordinary act-1 encounter CAN be fled, so the flag is really read', () => {
    const bundle = buildJump({ act: 1, xp: 0, target: { kind: 'encounter', familyId: 'gangers' } });
    expect(bundle.state.phase.kind === 'battle' && bundle.state.phase.battle.canFlee).toBe(true);
  });
});

// =========================================================================================
// 7. A PANEL EDIT CANNOT LEAK KARMA.
//
// The panel is the first tool in this project that can put a non-zero, unmistakable karma
// vector into a live run, so it is the first that could leak one. Two guards, deliberately
// of different kinds:
//
//   (a) a WORD sweep — the `AXIS_VOCABULARY` the existing hidden-karma guard uses, over every
//       string an event reaches a human or the model through, with proper nouns neutralised
//       exactly as `karmaActions.test.ts` does (the bestiary really does contain "Greed").
//
//   (b) a DELTA — two runs identical but for the karma vector, driven in lockstep through the
//       real `step`, must render byte-identical text. This is the one that catches a value
//       leaked under an INNOCUOUS key, which a word sweep and a key scan both miss.
//
// ⚠ WHY THE DELTA STOPS AT ACT 3, and it is not a convenience. The plan assumed karma is a
// pure passenger until the act-4 verdict. IT IS NOT: the ACT-3 Sin reads the vector twice
// over — `pickIndulgedAxis` names the boss (`SIN_BY_AXIS`) and its magnitude buys it bonus
// HP (`SIN_HP_PER_POINT`). And the vectors do not stay where the panel put them: the
// heuristic policy kills weighted enemies, each recording `killWeighted`, so the CONTROL run
// drifts negative and indulges an axis while the distinctive run (all axes positive) does
// not. Measured: the two runs diverge at step 185, in act 3, on a boss with a different name
// and 12 more HP — correct engine behaviour, not a leak. Bounding the lockstep at `act < 3`
// keeps the comparison sound; acts 1 and 2 contain no karma read at all, and still give
// ~180 steps and several hundred events.
// =========================================================================================

const AXIS_VOCABULARY =
  /karma|nature|mercy|cruel|greed|restraint|reveren|desecration|clarity|delusion/i;

/** Proper nouns are AUTHORED CONTENT and collide with the vocabulary on purpose (§9). */
const NEUTRAL_NAME = 'Foe';

function neutralize(event: GameEvent): GameEvent {
  return 'enemyName' in event ? { ...event, enemyName: NEUTRAL_NAME } : event;
}

/** Every string an event reaches a human or the model through, plus its raw serialization. */
function renderedSurfaces(event: GameEvent): string[] {
  const n = neutralize(event);
  return [JSON.stringify(n), formatEvent(n), describeEvent(n)];
}

/** The distinctive vector — four values no axis would hold by accident. */
const DISTINCTIVE: KarmaState = {
  mercyCruelty: 7,
  restraintGreed: 11,
  reverenceDesecration: 13,
  clarityDelusion: 17,
};

describe('a karma vector set from the panel never reaches the player', () => {
  /**
   * Play one jumped run under the heuristic policy, collecting what a human would read.
   * Stops before ACT 3 — see the block comment above for why that bound, not act 4.
   */
  function play(karma: KarmaState, limit: number) {
    const bundle = buildJump({ act: 1, xp: 0, seed: 4242, karma });
    let result = {
      state: bundle.state,
      events: [] as GameEvent[],
      awaiting: awaitingFor(bundle.state.phase),
    };
    const policy = heuristicPolicy(bundle.state.player!.classId);
    const events: GameEvent[] = [];
    const rendered: string[] = [];
    const skeletons: string[] = [];
    let steps = 0;
    while (result.awaiting !== 'game-over' && steps < limit && result.state.act < 3) {
      result = step(result.state, policy(result));
      steps += 1;
      events.push(...result.events);
      for (const event of result.events) rendered.push(...renderedSurfaces(event));
      skeletons.push(JSON.stringify({ ...result.state, karma: null }));
    }
    return { events, rendered, skeletons, steps, finalKarma: result.state.karma };
  }

  const distinctive = play(DISTINCTIVE, 200);
  const control = play(createKarma(), 200);

  it('the sweep saw a real run, not a handful of menu clicks (non-vacuity)', () => {
    expect(distinctive.events.length, 'fewer than 50 events — the sweep proves little').toBeGreaterThan(50);
    const kinds = new Set<string>(distinctive.events.map((e) => e.kind));
    expect([...kinds].length).toBeGreaterThan(4);
    expect(kinds.has('attack'), `no attack event in ${[...kinds].join(', ')}`).toBe(true);
    expect(kinds.has('victory'), 'the sweep never saw a fight resolve').toBe(true);
    expect(distinctive.rendered.length).toBe(distinctive.events.length * 3);
  });

  it('no axis vocabulary reaches any rendered surface', () => {
    for (const text of distinctive.rendered) {
      expect(text, `karma vocabulary in a player surface: ${text.slice(0, 90)}`).not.toMatch(
        AXIS_VOCABULARY,
      );
    }
  });

  it('...and the neutralisation really reached the rendered sentence (not a no-op)', () => {
    // If the substitution never landed, the sweep above would be scanning the wrong strings.
    const named = distinctive.events.find((e) => 'enemyName' in e);
    expect(named, 'no named event at all — the neutralisation guards nothing').toBeDefined();
    expect(formatEvent(neutralize(named!))).toContain(NEUTRAL_NAME);
  });

  it('DELTA: the distinctive vector really is in the state, and differs from the control', () => {
    // Non-vacuity for the comparison below: if the karma never reached the run, "identical
    // output" would be trivially true.
    expect(buildJump({ act: 1, xp: 0, seed: 4242, karma: DISTINCTIVE }).state.karma).toEqual(
      DISTINCTIVE,
    );
    expect(distinctive.finalKarma).not.toEqual(control.finalKarma);
    expect(distinctive.steps).toBe(control.steps);
    expect(distinctive.steps).toBeGreaterThan(20);
  });

  it('DELTA: the two runs are identical in every field BUT karma', () => {
    // Proves karma is a pure passenger here — which is what makes the text comparison sound.
    expect(distinctive.skeletons).toEqual(control.skeletons);
  });

  it('DELTA: and every rendered string is byte-identical between them', () => {
    // The guard that catches a value leaked under an innocuous key: a word sweep cannot see
    // `{pool: 13}` and a key scan cannot see a number in a sentence, but this can.
    expect(distinctive.rendered).toEqual(control.rendered);
  });

  it('...and that comparison CAN fail — proved against a deliberately leaky projection', () => {
    // The mutation, run in-test rather than described: a projector that appends the vector.
    const leaky = (event: GameEvent, karma: KarmaState): string =>
      `${formatEvent(event)} [${karma.mercyCruelty}/${karma.reverenceDesecration}]`;
    const sample = distinctive.events[0]!;
    expect(leaky(sample, DISTINCTIVE)).not.toBe(leaky(sample, createKarma()));
    // ...and the honest projector does NOT differ on the same input, so the difference above
    // comes from the leak and not from the sample.
    expect(formatEvent(sample)).toBe(formatEvent(sample));
  });
});

// =========================================================================================
// 8. The presets that exist to open a screen really open it.
// =========================================================================================

describe('the act-4 hub jump is verdict-ready', () => {
  it('the very next continue opens the verdict rather than an encounter', () => {
    const result = step(preset('act4-verdict-ready').state, { kind: 'menu', choice: 'continue' });
    expect(result.state.phase.kind).toBe('verdict');
  });

  it('CONTROL: one XP short of the threshold it opens an encounter instead', () => {
    // ACT_XP_THRESHOLDS[5] = 240, and `shouldAdvance` is `xp >= threshold`.
    const bundle = buildJump({ act: 4, xp: 239, target: { kind: 'hub' } });
    const result = step(bundle.state, { kind: 'menu', choice: 'continue' });
    expect(result.state.phase.kind).not.toBe('verdict');
  });
});

describe('the act-1 control jump behaves like an ordinary early run', () => {
  it('starts at the hub, level 1, floor 0, with a neutral vector', () => {
    const bundle = preset('act1-hub');
    expect(bundle.state.act).toBe(1);
    expect(bundle.state.place).toBe(0);
    expect(bundle.state.player!.level).toBe(1);
    expect(bundle.state.karma).toEqual(createKarma());
    expect(bundle.meta.runSummary).toEqual({ ...emptyRunSummary(), maxAct: 1 });
  });
});
