import { describe, it, expect } from 'vitest';
import {
  buildNarrationPrompt,
  describeEvent,
  createStoryMemory,
  placeName,
  rememberBeat,
  runSummary,
  UNPLACED,
} from './narrate.ts';
import type { GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { createKarma } from '../game/karma.ts';

const baseState: GameState = {
  version: 10,
  rngState: 1,
  player: null,
  act: 1,
  place: 0,
  karma: createKarma(),
  deeds: [],
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
    expect(p!.user).toContain('the Undercity');
    expect(p!.user.toLowerCase()).toContain('second-person');
    expect(p!.system).toContain('Void');
  });
  it('prefixes recent moments and a run summary when memory is supplied', () => {
    let m = createStoryMemory();
    m = rememberBeat(m, [{ kind: 'encounter-start', enemyName: 'Feral Rat' }]);
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 5, loot: [] }]);
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
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 5, loot: [] }]);
    m = rememberBeat(m, [{ kind: 'victory', xpGained: 3, loot: [] }]);
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

// ---------------------------------------------------------------------------
// C4 — the narrator is told which floor it is on, by the floor's real name.
//
// The five names are transcribed BY HAND from `docs/WORLD.md` §6's stage table (the
// [LOCKED] fiction), not read from `floors.json` — so if someone renames a floor in the
// data this fails and asks whether the fiction moved too. `src/render/floorNames.test.ts`
// closes the other end of the same join (the render layer's copy of the names).
// ---------------------------------------------------------------------------

describe('the prompt header names the floor (C4)', () => {
  /** WORLD.md §6: "1 — The Undercity" … "5 — The True Void", minus the leading article. */
  const NAMES = ['Undercity', 'Entrance to the Void', 'Ash City', 'Angelic Underground', 'True Void'];

  /** One narratable event, so `buildNarrationPrompt` never returns null. */
  const EVENTS: GameEvent[] = [{ kind: 'encounter-start', enemyName: 'Feral Cryo Rat' }];

  function headerFor(place: number): string {
    const p = buildNarrationPrompt(EVENTS, { ...baseState, act: place + 1, place });
    expect(p, `place ${place} produced no prompt`).not.toBeNull();
    return p!.user;
  }

  it('reads "Act N, the <floor>." for each of the five floors', () => {
    for (let i = 0; i < NAMES.length; i += 1) {
      expect(headerFor(i)).toContain(`Act ${i + 1}, the ${NAMES[i]}.`);
    }
  });

  it('never names the Void itself as the place you are standing in (WORLD.md §6)', () => {
    // "The Void is not a place" is LOCKED fiction, and this header is the one sentence in
    // the whole prompt whose job is to say where you are.
    for (let i = 0; i < NAMES.length; i += 1) {
      expect(placeName(i)).not.toBe('the Void');
    }
    expect(UNPLACED).not.toBe('the Void');
  });

  it('a malformed place says "somewhere further down" rather than guessing a floor', () => {
    // `floorOf` clamps for the ENGINE (a bad save still resolves to rules that exist).
    // The narrator must not clamp: naming floor 1 would be a confident lie about where
    // the player is.
    for (const bad of [-1, 5, 1.5, NaN, Infinity, -0.5, 99]) {
      expect(placeName(bad), `place ${bad}`).toBe('somewhere further down');
    }
    expect(headerFor(-1)).toContain('somewhere further down');
  });

  it('every real floor gets a DISTINCT name — no two floors read alike', () => {
    const phrases = NAMES.map((_, i) => placeName(i));
    expect(new Set(phrases).size).toBe(5);
    expect(phrases).not.toContain(UNPLACED);
  });

  it('the header carries no legacy ordinal phrasing', () => {
    // The shipped line was the Java level ordinal ("the First Floor"), built by hand in
    // this file and drifting from both the data and the fiction.
    for (let i = 0; i < 5; i += 1) {
      expect(headerFor(i)).not.toMatch(/the (First|Second|Third|Fourth|Fifth) Floor/);
    }
  });
});
