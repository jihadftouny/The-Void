import { describe, it, expect } from 'vitest';
import {
  buildNarrationPrompt,
  describeEvent,
  createStoryMemory,
  rememberBeat,
  runSummary,
} from './narrate.ts';
import type { GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { createKarma } from '../game/karma.ts';

const baseState: GameState = {
  version: 4,
  rngState: 1,
  player: null,
  act: 1,
  place: 0,
  karma: createKarma(),
  phase: { kind: 'title' },
};

describe('describeEvent', () => {
  it('describes a critical player attack in player-facing terms', () => {
    const e: GameEvent = { kind: 'attack', subject: 'player', outcome: 'crit', damage: 7 };
    expect(describeEvent(e)).toContain('devastating');
  });
  it('returns empty string for events that need no narration', () => {
    expect(describeEvent({ kind: 'character-info' } as GameEvent)).toBe('');
  });
});

describe('buildNarrationPrompt', () => {
  it('returns null when nothing narratable happened', () => {
    expect(buildNarrationPrompt([], baseState)).toBeNull();
  });
  it('includes the facts and the current floor, and asks for second-person prose', () => {
    const events: GameEvent[] = [{ kind: 'encounter-start', enemyName: 'Feral Cryo Rat' }];
    const p = buildNarrationPrompt(events, baseState);
    expect(p).not.toBeNull();
    expect(p!.user).toContain('Feral Cryo Rat');
    expect(p!.user).toContain('First Floor');
    expect(p!.user.toLowerCase()).toContain('second-person');
    expect(p!.system).toContain('Void');
  });
  it('prefixes recent moments and a run summary when memory is supplied', () => {
    let m = createStoryMemory();
    m = rememberBeat(m, [{ kind: 'encounter-start', enemyName: 'Feral Rat' }]);
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 5, goldGained: 2, extraRest: false }]);
    const p = buildNarrationPrompt(
      [{ kind: 'attack', subject: 'player', outcome: 'hit', damage: 3 }],
      baseState,
      m,
    );
    expect(p!.user).toContain('Recent moments');
    expect(p!.user).toContain('Feral Rat');
    expect(p!.user).toContain('felled 1 foe');
  });
});

describe('story memory', () => {
  it('appends recent beats and caps at five', () => {
    let m = createStoryMemory();
    for (let i = 1; i <= 7; i++)
      m = rememberBeat(m, [{ kind: 'encounter-start', enemyName: `Rat${i}` }]);
    expect(m.beats).toHaveLength(5);
    expect(m.beats[0]).toContain('Rat3');
    expect(m.beats[4]).toContain('Rat7');
  });
  it('accumulates run facts across beats', () => {
    let m = createStoryMemory();
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 5, goldGained: 2, extraRest: false }]);
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 3, goldGained: 1, extraRest: false }]);
    m = rememberBeat(m, [{ kind: 'fled' }]);
    expect(m.enemiesDefeated).toBe(2);
    expect(m.timesFled).toBe(1);
    expect(runSummary(m)).toContain('felled 2 foes');
    expect(runSummary(m)).toContain('fled 1 time');
  });
  it('returns the same memory object for an empty event list', () => {
    const m0 = createStoryMemory();
    expect(rememberBeat(m0, [])).toBe(m0);
  });
});
