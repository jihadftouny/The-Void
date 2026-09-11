// The rest scene and the tone channel (PLAN.md #2, AC-24 — what a FAKE model can prove).
//
// What CANNOT be proved here, and is recorded in HUMAN-CHECKS.md as the manual item: whether
// the real 4B model, given a tone line, reflects it without STATING it. Everything the engine
// controls — what the model is given, and what it is never given — is asserted below.

import { describe, it, expect } from 'vitest';
import { ALL_TONE_WORDS, TONE_AXES, TONE_WORDS, karmaTone } from './tone.ts';
import {
  buildNarrationPrompt,
  conditionBrief,
  createStoryMemory,
  hpBand,
  rememberBeat,
  REST_SCENE_INSTRUCTION,
} from './narrate.ts';
import { createGame, step, type GameState } from '../game/game.ts';
import { createPlayer, type Player } from '../game/player.ts';
import { createKarma, type KarmaState } from '../game/karma.ts';
import { restBrief } from '../game/restBrief.ts';
import { selectEncounter } from '../game/encounter.ts';
import { createRng } from '../game/rng.ts';
import { makeCondition } from '../game/condition.ts';
import type { GameEvent } from '../game/gameEvent.ts';

/** GAME-DESIGN §7's hidden axes, and the words that would name them (the G53 vocabulary). */
const AXIS_VOCABULARY = /karm|nature|merc(?:y|i)|cruel|greed|restrain|reveren|desecrat|clarity|delu(?:sion|d)/i;
/** WORLD.md §0's reserved words. */
const RESERVED = /\bhollow|made whole/i;

const MERCIFUL: KarmaState = { ...createKarma(), mercyCruelty: 4 };
const CRUEL: KarmaState = { ...createKarma(), mercyCruelty: -4 };

function hero(overrides: Partial<Player> = {}): Player {
  return {
    ...createPlayer({ name: 'Zzyzx-Qwph', classId: 'Penitent', stats: { STR: 12, DEX: 12, CON: 12, INT: 12, WIS: 12, CHA: 12 } }),
    ...overrides,
  };
}

/** A REAL rest step, through `step`: the hub's next encounter is a found rest on `place`. */
function restStep(karma: KarmaState, player: Player = hero({ xp: 0, hp: 3 }), place = 0) {
  let seed = 0;
  while (selectEncounter(createRng(seed).rng, (place + 1) as 1) !== 'rest') seed += 1;
  const state: GameState = { ...createGame(seed), player, act: place + 1, place, karma, phase: { kind: 'main-menu' } };
  return step(state, { kind: 'menu', choice: 'continue' });
}

describe('TONE_WORDS — a closed vocabulary of MANNER words', () => {
  it('one [virtue, shadow] pair per karma axis, eight distinct words', () => {
    expect(Object.keys(TONE_WORDS).sort()).toEqual([...TONE_AXES].sort());
    expect(new Set(ALL_TONE_WORDS).size).toBe(8);
  });

  it('no word names an axis, a reserved word, or a number', () => {
    for (const w of ALL_TONE_WORDS) {
      expect(w, w).not.toMatch(AXIS_VOCABULARY);
      expect(w, w).not.toMatch(RESERVED);
      expect(w, w).not.toMatch(/\d/);
    }
  });
});

describe('karmaTone — the sign of each axis, never its size', () => {
  it('a merciful ledger is gentle, a cruel one cold, a neutral one has NO tone at all', () => {
    expect(karmaTone(MERCIFUL)).toEqual(['gentle']);
    expect(karmaTone(CRUEL)).toEqual(['cold']);
    expect(karmaTone(createKarma())).toEqual([]);
  });

  it('reports every non-zero axis in the fixed axis order', () => {
    const k: KarmaState = { mercyCruelty: -1, restraintGreed: 2, reverenceDesecration: -3, clarityDelusion: 1 };
    expect(karmaTone(k)).toEqual(['cold', 'spare', 'profane', 'clear-eyed']);
  });

  it('discards magnitude: +1 and +50 read the same', () => {
    expect(karmaTone({ ...createKarma(), mercyCruelty: 1 })).toEqual(karmaTone({ ...createKarma(), mercyCruelty: 50 }));
  });
});

describe('hpBand and the condition brief — words, never digits', () => {
  it('bands at 100% / >= 70% / >= 35% / below', () => {
    expect(hpBand(20, 20)).toBe('unhurt');
    expect(hpBand(14, 20)).toBe('scratched'); // 0.70
    expect(hpBand(13, 20)).toBe('wounded'); // 0.65
    expect(hpBand(7, 20)).toBe('wounded'); // 0.35
    expect(hpBand(6, 20)).toBe('near death'); // 0.30
  });

  it('the brief carries no digit, whatever the numbers underneath', () => {
    for (const hp of [1, 7, 13, 17, 40]) {
      const brief = conditionBrief(hero({ hp, maxHp: 40 }), { woundsClosed: hp < 40, conditionsEased: hp % 2 === 0 });
      expect(brief, brief).not.toMatch(/\d/);
    }
  });

  it('names what was eased from the step’s own facts, and what is carried by name', () => {
    const brief = conditionBrief(hero({ hp: 40, maxHp: 40 }), { woundsClosed: false, conditionsEased: true });
    expect(brief).toContain('There was nothing to close.');
    expect(brief).toContain('What afflicted you has eased.');
    // The Penitent's sword (its placeholder index dropped — no digit reaches the model) plus
    // §22.6's kit, by catalog name.
    expect(brief).toContain('You carry Jaaj Sword, Void Draught, Suture Kit.');
  });
});

describe('the rest scene reaches the model — through the REAL step (AC-24)', () => {
  it('carries the floor’s brief verbatim, the condition, the tone, and the instruction', () => {
    const r = restStep(MERCIFUL);
    expect(r.events.map((e) => e.kind)).toEqual(['rest-found', 'rest-taken']);
    const prompt = buildNarrationPrompt(r.events, r.state)!;
    const brief = restBrief(1);
    expect(prompt.user).toContain(`Where you are: ${brief.place}.`);
    for (const line of brief.lore) expect(prompt.user).toContain(line);
    expect(prompt.user).toContain('How you are: You are');
    expect(prompt.user).toContain('Your wounds close.'); // she arrived at 3 HP
    expect(prompt.user).toContain('Tone: gentle.');
    expect(prompt.user).toContain(REST_SCENE_INSTRUCTION);
  });

  it('a cruel ledger gets a DIFFERENT tone line; a neutral one gets none; the same ledger, the same prompt', () => {
    const merciful = buildNarrationPrompt(restStep(MERCIFUL).events, restStep(MERCIFUL).state)!.user;
    const cruel = buildNarrationPrompt(restStep(CRUEL).events, restStep(CRUEL).state)!.user;
    const neutral = buildNarrationPrompt(restStep(createKarma()).events, restStep(createKarma()).state)!.user;
    expect(cruel).toContain('Tone: cold.');
    expect(cruel).not.toBe(merciful);
    expect(neutral).not.toContain('Tone:');
    expect(buildNarrationPrompt(restStep(MERCIFUL).events, restStep(MERCIFUL).state)!.user).toBe(merciful);
  });

  it('the scene names no axis and no reserved word — for every ledger shape', () => {
    for (const k of [MERCIFUL, CRUEL, createKarma(), { mercyCruelty: -2, restraintGreed: -2, reverenceDesecration: 3, clarityDelusion: -1 }]) {
      const r = restStep(k);
      const user = buildNarrationPrompt(r.events, r.state)!.user;
      const scene = user.slice(user.indexOf('Where you are:'));
      expect(scene, JSON.stringify(k)).not.toMatch(AXIS_VOCABULARY);
      expect(scene, JSON.stringify(k)).not.toMatch(RESERVED);
      expect(scene).not.toMatch(/Zzyzx-Qwph/); // G47: never the player's name
    }
  });

  it('the tone NEVER enters the facts, the story memory, or the fallback', () => {
    const r = restStep(MERCIFUL);
    const prompt = buildNarrationPrompt(r.events, r.state)!;
    for (const f of prompt.facts) {
      expect(f).not.toContain('gentle');
      expect(f).not.toContain('Tone');
    }
    const memory = rememberBeat(createStoryMemory(), r.events);
    expect(JSON.stringify(memory)).not.toContain('gentle');
    expect(JSON.stringify(memory)).not.toContain('Where you are');
  });

  it('the scene describes the floor the rest was FOUND on (floor 3 here), keyed on the event', () => {
    const r = restStep(MERCIFUL, hero({ xp: 0, hp: 3 }), 2);
    const user = buildNarrationPrompt(r.events, r.state)!.user;
    expect(user).toContain(`Where you are: ${restBrief(3).place}.`);
  });
});

describe('every OTHER beat is byte-for-byte what it was (AC-24 off-equivalence)', () => {
  it('a fixed non-rest event list builds exactly the pre-#2 prompt, written out by hand', () => {
    const events: GameEvent[] = [{ kind: 'encounter-start', enemyName: 'Feral Cryo Rat' }];
    const state: GameState = { ...createGame(1), player: hero(), karma: MERCIFUL, phase: { kind: 'main-menu' } };
    const prompt = buildNarrationPrompt(events, state)!;
    expect(prompt.user).toBe(
      'Act 1, the First Floor. What just happened:\n- A Feral Cryo Rat emerges to bar your way.' +
        '\n\nNarrate this new moment in 2-4 vivid second-person sentences. ' +
        'Stay consistent with what came before; do not repeat earlier narration.',
    );
    // ...and the merciful ledger on the state reached nothing.
    expect(prompt.user).not.toContain('gentle');
  });

  it('a rest-taken WITHOUT rest-found (a v8 save replayed) adds no scene', () => {
    const events: GameEvent[] = [{ kind: 'rest-taken', hpRestored: 10, hp: 20, maxHp: 20 }];
    const state: GameState = { ...createGame(1), player: hero(), karma: MERCIFUL, phase: { kind: 'rest' } };
    expect(buildNarrationPrompt(events, state)!.user).not.toContain('Where you are');
  });
});

describe('the step’s own facts about arrival are true', () => {
  it('rest-found says whether wounds and conditions were there, from the character ON ARRIVAL', () => {
    const whole = restStep(createKarma(), hero({ xp: 0 }));
    expect(whole.events[0]).toMatchObject({ kind: 'rest-found', woundsClosed: false, conditionsEased: false });
    const hurt = restStep(createKarma(), hero({ xp: 0, hp: 2, activeConditions: [makeCondition('bleed')] }));
    expect(hurt.events[0]).toMatchObject({ kind: 'rest-found', woundsClosed: true, conditionsEased: true });
  });
});
