import { describe, expect, it } from 'vitest';
import {
  subjectOf,
  sumDamageSources,
  withDamageSource,
  type CombatEvent,
} from './combatEvent.ts';
import { createGame, step, awaitingFor } from './game.ts';
import type { GameEvent } from './gameEvent.ts';
import { heuristicPolicy } from './sim.ts';
import type { PlayerClass } from './player.ts';

// These events are hand-authored plain data; the test proves they carry no class
// instances / functions and survive JSON round-tripping (LOAD-BEARING: serializable
// plain-data state).

describe('CombatEvent JSON round-trip', () => {
  const samples: CombatEvent[] = [
    { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
    { kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember', damage: 4,
      damageSources: [{ kind: 'skill', amount: 4 }] },
    { kind: 'cast-unavailable' },
    { kind: 'attack', subject: 'player', outcome: 'crit', damage: 7,
      roll: { natural: 20, faces: [20], advDis: 0, modifier: 2, total: 22, targetAc: 13 },
      damageSources: [
        { kind: 'weapon-dice', amount: 3, label: '1d8' },
        { kind: 'crit-dice', amount: 2, label: '1d8' },
        { kind: 'ability-mod', amount: 2 },
      ] },
    { kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
      roll: { natural: 14, faces: [14], advDis: 0, modifier: 1, total: 15, targetAc: 13 },
      damageSources: [{ kind: 'skill', amount: 2 }] },
    { kind: 'advantage', subject: 'player' },
    { kind: 'disadvantage', subject: 'player' },
    { kind: 'player-unable-to-act', conditionType: 'stun' },
    { kind: 'condition-onset', subject: 'player', conditionType: 'bleed' },
    { kind: 'condition-damage', subject: 'player', conditionType: 'bleed', amount: 1 },
    { kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2 },
    { kind: 'condition-skip', subject: 'player', conditionType: 'freeze' },
    { kind: 'condition-applied', subject: 'player', conditionType: 'freeze' },
    { kind: 'condition-expired', subject: 'player', conditionType: 'bleed' },
    { kind: 'potion-drunk', healedTo: 30 },
    { kind: 'potion-unavailable' },
    { kind: 'potion-blocked' },
    { kind: 'fled' },
    { kind: 'escape-failed', damage: 2 },
    { kind: 'escape-impossible' },
    { kind: 'victory', xpGained: 3, extraRest: true, loot: [] },
    { kind: 'defeat' },
  ];

  it('every representative event survives JSON.parse(JSON.stringify(x)) unchanged', () => {
    for (const ev of samples) {
      expect(JSON.parse(JSON.stringify(ev))).toEqual(ev);
    }
  });

  it('an event list round-trips as a whole', () => {
    expect(JSON.parse(JSON.stringify(samples))).toEqual(samples);
  });
});

describe('subjectOf', () => {
  it('classifies a player (has classId) as "player" and an enemy as "enemy"', () => {
    expect(subjectOf({ classId: 'Enforcer' })).toBe('player');
    expect(subjectOf({ type: 'Beast', fullName: 'Feral Rat' })).toBe('enemy');
  });
});

// ---------------------------------------------------------------------------
// M-UI2 — the damage-breakdown invariant, enforced over WHOLE RUNS.
//
// The unit tests in combat.test.ts / relicEffects.test.ts pin specific breakdowns by hand.
// This one is the backstop: it plays real runs end to end and requires that EVERY damaging
// event ever emitted has terms summing to the damage it reports. A future code path that
// adjusts damage without recording why cannot slip past it.
// ---------------------------------------------------------------------------

describe('sumDamageSources / withDamageSource', () => {
  it('totals the signed terms', () => {
    expect(sumDamageSources([])).toBe(0);
    expect(sumDamageSources([{ kind: 'weapon-dice', amount: 4 }])).toBe(4);
    // 4 + 2 - 6 = 0.
    expect(
      sumDamageSources([
        { kind: 'weapon-dice', amount: 4 },
        { kind: 'low-hp-bonus', amount: 2 },
        { kind: 'first-hit-reduction', amount: -6 },
      ]),
    ).toBe(0);
  });

  it('appends a term and RE-DERIVES damage from the terms, rather than trusting the old value', () => {
    const before: CombatEvent = {
      kind: 'attack', subject: 'player', outcome: 'hit', damage: 6,
      roll: { natural: 15, faces: [15], advDis: 0, modifier: 2, total: 17, targetAc: 13 },
      damageSources: [{ kind: 'weapon-dice', amount: 6, label: '1d6' }],
    };
    const after = withDamageSource(before, { kind: 'damage-mult', amount: 3 });
    expect(after.damage).toBe(9); // 6 + 3, computed from the terms
    expect(after.damageSources).toEqual([
      { kind: 'weapon-dice', amount: 6, label: '1d6' },
      { kind: 'damage-mult', amount: 3 },
    ]);
    // Pure: the input event is untouched.
    expect(before.damage).toBe(6);
    expect(before.damageSources).toHaveLength(1);
  });

  it('a negative term can drive the reported damage to 0', () => {
    const before: CombatEvent = {
      kind: 'attack', subject: 'enemy', outcome: 'crit', damage: 2,
      roll: { natural: 20, faces: [20], advDis: 0, modifier: 0, total: 20, targetAc: 11 },
      damageSources: [
        { kind: 'base', amount: 1 },
        { kind: 'crit-multiplier', amount: 1 },
      ],
    };
    expect(withDamageSource(before, { kind: 'first-hit-reduction', amount: -2 }).damage).toBe(0);
  });
});

describe('every damaging event of a full run explains its own number', () => {
  it('sum(damageSources) === damage for every attack and skill-cast across real runs', () => {
    let checked = 0;
    for (const classId of ['Enforcer', 'Neuromancer', 'Hollow'] as PlayerClass[]) {
      for (const seed of [1, 2]) {
        let state = createGame(seed);
        let events: GameEvent[] = [];
        let awaiting = awaitingFor(state.phase);
        const policy = heuristicPolicy(classId);
        let steps = 0;
        while (awaiting !== 'game-over' && steps < 200_000) {
          const res = step(state, policy({ state, events, awaiting }));
          state = res.state;
          events = res.events;
          awaiting = res.awaiting;
          steps += 1;
          for (const e of events) {
            if (e.kind !== 'attack' && e.kind !== 'skill-cast') continue;
            expect(
              sumDamageSources(e.damageSources),
              `${e.kind} reported ${e.damage} but its terms sum differently: ` +
                JSON.stringify(e.damageSources),
            ).toBe(e.damage);
            checked += 1;
          }
        }
      }
    }
    // Guard against the test silently checking nothing (e.g. if runs stopped producing
    // combat). Six full runs reach hundreds of attacks.
    expect(checked).toBeGreaterThan(200);
  });

  it('every attack of a full run also carries a coherent roll', () => {
    let checked = 0;
    let state = createGame(7);
    let events: GameEvent[] = [];
    let awaiting = awaitingFor(state.phase);
    const policy = heuristicPolicy('Enforcer');
    let steps = 0;
    while (awaiting !== 'game-over' && steps < 200_000) {
      const res = step(state, policy({ state, events, awaiting }));
      state = res.state;
      events = res.events;
      awaiting = res.awaiting;
      steps += 1;
      for (const e of events) {
        if (e.kind !== 'attack') continue;
        const { natural, faces, advDis, modifier, total } = e.roll;
        // The d20 landed on a real face, the reported total is the stated arithmetic, and
        // the number of faces matches the adv/dis mode that produced them.
        expect(natural).toBeGreaterThanOrEqual(1);
        expect(natural).toBeLessThanOrEqual(20);
        expect(total).toBe(natural + modifier);
        expect(faces).toHaveLength(advDis === 0 ? 1 : 2);
        expect(faces).toContain(natural);
        // Under adv/dis the decisive face really is the max (or min) of the two.
        if (advDis === 1) expect(natural).toBe(Math.max(...faces));
        if (advDis === -1) expect(natural).toBe(Math.min(...faces));
        // A crit is a natural 20 and a fumble a natural 1 — never anything else.
        if (e.outcome === 'crit') expect(natural).toBe(20);
        if (e.outcome === 'fumble') expect(natural).toBe(1);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
