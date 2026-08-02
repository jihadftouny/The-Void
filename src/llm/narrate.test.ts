import { describe, it, expect } from 'vitest';
import { buildNarrationPrompt, describeEvent } from './narrate.ts';
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
});
