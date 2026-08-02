import { describe, it, expect } from 'vitest';
import {
  buildNarrationPrompt,
  describeEvent,
  createStoryMemory,
  rememberBeat,
} from './narrate.ts';
import type { GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';

const baseState: GameState = {
  version: 1,
  rngState: 1,
  player: null,
  act: 1,
  place: 0,
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
  it('prefixes the recent story-so-far when memory is supplied', () => {
    let m = createStoryMemory();
    m = rememberBeat(m, ['A Feral Rat emerges to bar your way.']);
    const p = buildNarrationPrompt(
      [{ kind: 'attack', subject: 'player', outcome: 'hit', damage: 3 }],
      baseState,
      m,
    );
    expect(p!.user).toContain('story so far');
    expect(p!.user).toContain('Feral Rat');
  });
});

describe('story memory', () => {
  it('appends beats and caps at the most recent five', () => {
    let m = createStoryMemory();
    for (let i = 1; i <= 7; i++) m = rememberBeat(m, [`beat ${i}`]);
    expect(m.beats).toHaveLength(5);
    expect(m.beats[0]).toBe('beat 3');
    expect(m.beats[4]).toBe('beat 7');
  });
  it('ignores empty beats and never mutates the input', () => {
    const m0 = createStoryMemory();
    const m1 = rememberBeat(m0, []);
    expect(m1).toBe(m0);
    const m2 = rememberBeat(m0, ['x']);
    expect(m0.beats).toHaveLength(0); // original untouched
    expect(m2.beats).toEqual(['x']);
  });
});
