// The words a boss is told — pinned to `docs/BOSS-PROMPTS.md` §4, whose wording wins.
// Every expected string below is copied from the document or derived by hand from its table;
// none was read back from the code.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONDITION_DATA, type ConditionType } from '../game/condition.ts';
import { createKarma } from '../game/karma.ts';
import { AXIS_VOCABULARY } from '../game/karmaVocabulary.testutil.ts';
import { ALL_TONE_WORDS } from './tone.ts';
import {
  CONDITION_WORDS,
  HP_BUCKETS,
  deedHasDigit,
  deedSentence,
  exchangeSentence,
  fighterWords,
  hpBucket,
  karmaWords,
  withIndefinite,
} from './bossWords.ts';
import type { BossDeed } from './bossContract.ts';
import { DIGIT_DEED, FIXTURE_DEEDS, FIXTURE_KARMA } from './bossFixtures.testutil.ts';

const DOC = readFileSync(fileURLToPath(new URL('../../docs/BOSS-PROMPTS.md', import.meta.url)), 'utf8');

describe('HP in five words (BOSS-PROMPTS §4)', () => {
  it('the table is the document\'s five words, in the document\'s order', () => {
    // The doc line reads: *untouched · barely touched · hurt · badly hurt · near the end*
    const words = HP_BUCKETS.map((b) => b.word);
    expect(words).toEqual(['untouched', 'barely touched', 'hurt', 'badly hurt', 'near the end']);
    expect(DOC, 'the document no longer lists these five words — re-read §4').toContain(words.join(' · '));
  });

  it('the anchors, derived by hand from the ratio table (1 · ≥0.75 · ≥0.5 · ≥0.25 · below)', () => {
    expect(hpBucket(20, 20)).toBe('untouched'); // 1.0
    expect(hpBucket(15, 20)).toBe('barely touched'); // 0.75
    expect(hpBucket(10, 20)).toBe('hurt'); // 0.5
    expect(hpBucket(6, 20)).toBe('badly hurt'); // 0.30
    expect(hpBucket(5, 20)).toBe('badly hurt'); // 0.25, on the edge
    expect(hpBucket(4, 20)).toBe('near the end'); // 0.20
    expect(hpBucket(1, 20)).toBe('near the end'); // 0.05
    expect(hpBucket(0, 20)).toBe('near the end');
  });

  it('a broken max never becomes a number or a crash', () => {
    expect(hpBucket(5, 0)).toBe('near the end');
    expect(hpBucket(Number.NaN, 20)).toBe('near the end');
    expect(hpBucket(25, 20)).toBe('untouched');
  });
});

describe('conditions as what they do, never as labels', () => {
  it('the §4 example: hp 6/20, bleeding, slowed', () => {
    expect(fighterWords({ hp: 6, maxHp: 20, conditions: ['bleed', 'slow'] })).toBe(
      'badly hurt, bleeding, moving slowly',
    );
    expect(DOC).toContain('badly hurt, bleeding, moving slowly');
  });

  it('is exhaustive over the engine\'s conditions', () => {
    expect(Object.keys(CONDITION_WORDS).sort()).toEqual(Object.keys(CONDITION_DATA).sort());
  });

  it('no phrase carries a condition id or display label as a whole word, and none carries a digit', () => {
    const ids = Object.keys(CONDITION_DATA);
    const labels = Object.values(CONDITION_DATA).map((d) => d.displayName.toLowerCase());
    for (const [type, words] of Object.entries(CONDITION_WORDS)) {
      for (const bad of [...ids, ...labels]) {
        expect(new RegExp(`\\b${bad}\\b`, 'i').test(words), `${type} → "${words}" carries "${bad}"`).toBe(false);
      }
      expect(/\d/.test(words)).toBe(false);
    }
  });

  it('the detector above really fires on the id it guards against', () => {
    // Non-vacuity: `slow` (an id) is caught, `slowly` (English) is not.
    expect(/\bslow\b/i.test('moving slow')).toBe(true);
    expect(/\bslow\b/i.test('moving slowly')).toBe(false);
  });

  it('a condition listed twice is said once', () => {
    const doubled: ConditionType[] = ['bleed', 'bleed'];
    expect(fighterWords({ hp: 20, maxHp: 20, conditions: doubled })).toBe('untouched, bleeding');
  });
});

describe('the exchange count, as a word', () => {
  it('the §4 example', () => {
    expect(exchangeSentence(4)).toBe('This is the fourth exchange.');
    expect(DOC).toContain('This is the fourth exchange.');
  });

  it('one through twenty are ordinal words; past twenty it is late; nothing is a digit', () => {
    expect(exchangeSentence(1)).toBe('This is the first exchange.');
    expect(exchangeSentence(12)).toBe('This is the twelfth exchange.');
    expect(exchangeSentence(20)).toBe('This is the twentieth exchange.');
    expect(exchangeSentence(21)).toBe('This is a late exchange.');
    expect(exchangeSentence(0)).toBe('This is the first exchange.');
    for (let n = -2; n <= 60; n += 1) expect(/\d/.test(exchangeSentence(n)), String(n)).toBe(false);
  });
});

describe('deeds as sentences (§4 memory block)', () => {
  // The six sentences of §4, copied from the document, and the structured deed each comes from.
  const SIX: [BossDeed, string][] = [
    [{ kind: 'spared', floor: 1, axis: 'mercyCruelty', name: 'Fixer' }, 'In the Undercity you spared the Fixer.'],
    [{ kind: 'killed', floor: 1, axis: 'mercyCruelty', name: 'Ganger' }, 'In the Undercity you killed a Ganger you could have spared.'],
    [
      { kind: 'bargain', floor: 2, axis: 'restraintGreed', pool: 'greed', paid: 'your patience', got: 'a ring' },
      'At an altar in the Entrance to the Void you gave up your patience for a ring.',
    ],
    [{ kind: 'bargain', floor: 3, axis: 'reverenceDesecration', pool: 'desecration' }, 'In the Ash City you broke an altar to take what was on it.'],
    [{ kind: 'illusion-seen', floor: 2, axis: 'clarityDelusion' }, 'In the Entrance to the Void you saw through a lie the place told you.'],
    [{ kind: 'boss-felled', floor: 1, axis: null, name: 'Kingpin' }, 'In the Undercity you beat the Kingpin.'],
  ];

  for (const [deed, sentence] of SIX) {
    it(sentence, () => {
      expect(DOC, 'the expected string is no longer in §4 — the anchor moved').toContain(`- ${sentence}`);
      expect(deedSentence(deed)).toBe(sentence);
    });
  }

  it('every floor is a place NAME, and the Void is never entered', () => {
    const places = ['the Undercity', 'the Entrance to the Void', 'the Ash City', 'the Angelic Underground', 'the True Void'];
    places.forEach((place, i) => {
      const s = deedSentence({ kind: 'illusion-seen', floor: (i + 1) as 1, axis: null });
      expect(s).toBe(`In ${place} you saw through a lie the place told you.`);
    });
  });

  it('the remaining shapes read as English', () => {
    expect(deedSentence({ kind: 'boss-yielded', floor: 2, axis: null, name: 'The Reflection' })).toBe(
      'In the Entrance to the Void you talked the Reflection into yielding.',
    );
    expect(deedSentence({ kind: 'bargain', floor: 3, axis: 'clarityDelusion', pool: 'whisper' })).toBe(
      'At an altar in the Ash City you listened to the whisper and took what it offered.',
    );
    expect(deedSentence({ kind: 'bargain', floor: 4, axis: null, pool: 'offering', paid: 'a worn blade', got: 'a sharper one' })).toBe(
      'At an altar in the Angelic Underground you left a worn blade as an offering and took a sharper one.',
    );
    expect(deedSentence({ kind: 'killed', floor: 4, axis: null, name: 'Enforcer' })).toBe(
      'In the Angelic Underground you killed an Enforcer you could have spared.',
    );
    expect(deedSentence({ kind: 'bargain', floor: 1, axis: null, pool: 'greed' })).toBe(
      'At an altar in the Undercity you struck a bargain.',
    );
    expect(withIndefinite('Ganger')).toBe('a Ganger');
    expect(withIndefinite('Echo')).toBe('an Echo');
  });

  it('no fixture deed renders a digit; a deed carrying one is detected', () => {
    for (const deed of FIXTURE_DEEDS) {
      expect(/\d/.test(deedSentence(deed)), deedSentence(deed)).toBe(false);
      expect(deedHasDigit(deed)).toBe(false);
    }
    expect(deedHasDigit(DIGIT_DEED)).toBe(true);
    expect(deedHasDigit({ kind: 'bargain', floor: 1, axis: null, pool: 'greed', paid: '6 blood', got: 'a ring' })).toBe(true);
  });
});

describe('karma as manner words — the author\'s answer (2026-09-28)', () => {
  it('reuses karmaTone\'s words verbatim, one per non-zero axis', () => {
    // FIXTURE_KARMA: −2, −1, +3, +1 → shadow, shadow, virtue, virtue.
    expect(karmaWords(FIXTURE_KARMA)).toEqual(['cold', 'hungry', 'hushed', 'clear-eyed']);
    expect(karmaWords(createKarma())).toEqual([]);
  });

  it('never an axis word, never a number', () => {
    for (const w of ALL_TONE_WORDS) {
      expect(AXIS_VOCABULARY.test(w), w).toBe(false);
      expect(/\d/.test(w)).toBe(false);
    }
    // The guard is live: an axis word would be caught.
    expect(AXIS_VOCABULARY.test('merciful')).toBe(true);
  });

  it('the document gives the same manner words, and no longer offers the axis words', () => {
    const start = DOC.indexOf('**Karma, where a boss needs it');
    const block = DOC.slice(start, DOC.indexOf('### The fight now'));
    expect(start, 'the karma paragraph of §4 is gone — this guard is stale').toBeGreaterThan(-1);
    expect(block).toContain('`gentle / cold`, `spare / hungry`, `hushed / profane`, `clear-eyed / unsure`');
    // `karma` itself is the paragraph's subject; every other axis stem is a regression.
    expect(AXIS_VOCABULARY.test(block.replace(/karma/gi, '')), block).toBe(false);
  });
});
