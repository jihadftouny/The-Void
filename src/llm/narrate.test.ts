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
  version: 8,
  rngState: 1,
  player: null,
  act: 1,
  place: 0,
  karma: createKarma(),
  phase: { kind: 'title' },
};

describe('describeEvent', () => {
  it('describes a critical player attack in player-facing terms', () => {
    const e: GameEvent = {
      kind: 'attack', subject: 'player', outcome: 'crit', damage: 7,
      roll: { natural: 20, faces: [20], advDis: 0, modifier: 2, total: 22, targetAc: 13 },
      damageSources: [
        { kind: 'weapon-dice', amount: 3, label: '1d8' },
        { kind: 'crit-dice', amount: 2, label: '1d8' },
        { kind: 'ability-mod', amount: 2 },
      ],
    };
    expect(describeEvent(e)).toContain('devastating');
  });
  // `cast-unavailable` is a REJECTED INPUT — the player asked for a cast they could not
  // make, so nothing happened and there is nothing to narrate. Since G13 it is a explicit
  // `case` in the deliberate-silence block rather than an accident of the old `default`,
  // so this test now documents a decision instead of an omission.
  it('returns empty string for events that need no narration', () => {
    expect(describeEvent({ kind: 'cast-unavailable' } as GameEvent)).toBe('');
  });

  // G47 — the narrator never speaks the player's name (GAME-DESIGN.md §22.1, WORLD.md §8).
  // The class IS narratable (it is what the player chose to be); the name is a label.
  it('names the class but never the player at character creation', () => {
    const e: GameEvent = {
      kind: 'player-created',
      name: 'Zzyzx-Qwph',
      classId: 'Neuromancer',
      maxHp: 12,
      armorClass: 11,
    };
    const s = describeEvent(e);
    expect(s).toContain('Neuromancer');
    expect(s).not.toContain('Zzyzx-Qwph');
  });

  // G21 — an act transition must survive an EMPTY body. All ten bodies in story.json are
  // still `""` (#13 authors them), and returning `e.body` alone made every floor change a
  // blank screen. The header alone must be enough to keep the prompt non-null.
  it('keeps the act header when the body is still empty, and joins both when it is not', () => {
    expect(describeEvent({ kind: 'act-intro', act: 2, header: 'ACT II', body: '' })).toBe('ACT II');
    expect(describeEvent({ kind: 'act-outro', act: 2, header: 'ACT II', body: '' })).toBe('ACT II');
    // Forward compatibility: once #13 authors a body it appears with no code change.
    expect(
      describeEvent({ kind: 'act-intro', act: 3, header: 'ACT III', body: 'The mirrors begin.' }),
    ).toBe('ACT III — The mirrors begin.');
    expect(
      describeEvent({
        kind: 'ending',
        endingType: 'grace',
        header: 'ASCENSION',
        body: 'You are judged worthy and rise from the Void, made whole.',
      }),
    ).toBe('ASCENSION — You are judged worthy and rise from the Void, made whole.');
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
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 5, extraRest: false, loot: [] }]);
    const p = buildNarrationPrompt(
      [{
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 3,
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 2, total: 17, targetAc: 13 },
        damageSources: [{ kind: 'weapon-dice', amount: 3, label: '1d8' }],
      }],
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
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 5, extraRest: false, loot: [] }]);
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 3, extraRest: false, loot: [] }]);
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
