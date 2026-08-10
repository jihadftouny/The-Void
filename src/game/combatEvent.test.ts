import { describe, expect, it } from 'vitest';
import { subjectOf, type CombatEvent } from './combatEvent.ts';

// These events are hand-authored plain data; the test proves they carry no class
// instances / functions and survive JSON round-tripping (LOAD-BEARING: serializable
// plain-data state).

describe('CombatEvent JSON round-trip', () => {
  const samples: CombatEvent[] = [
    { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
    { kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember' },
    { kind: 'cast-unavailable' },
    { kind: 'attack', subject: 'player', outcome: 'crit', damage: 7 },
    { kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2 },
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
