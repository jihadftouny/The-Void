// THE BOSS PROMPT'S WORDS — the tables that turn the engine's numbers into plain words a boss
// can be told (`docs/BOSS-PROMPTS.md` §4). PURE: data tables plus renderers.
//
// THE RULE THIS FILE EXISTS FOR: no number reaches the model. HP becomes one of five words,
// a condition becomes what it DOES (never its label), a floor becomes its NAME, the exchange
// count becomes an ordinal word, and karma becomes MANNER words. A deed whose sentence would
// still carry a digit is dropped by the prompt builder rather than sent.
//
// WHY FIVE HP WORDS AND NOT `narrate.ts`'s FOUR. `hpBand` names four bands for the rest scene;
// BOSS-PROMPTS §4 fixes five for the fight ("untouched · barely touched · hurt · badly hurt ·
// near the end") and that document wins on prompt wording. A second table is the cost; a test
// pins this one to the document's words.
//
// KARMA WORDS — the author's answer to the plan's open question (2026-09-28): the Warden and the
// Hollow Self get `karmaTone`'s MANNER words (`tone.ts`), not the axis names. §7/§13: karma is
// felt, never named — a model that echoes "you are cold" has said nothing about a hidden score.
//
// LOAD-BEARING PRINCIPLES: pure (no DOM, Electron, `../render`, `../desktop`, `../log`), no clock
// and no randomness, data-driven (every word lives in a table here or in `floors.json`).

import type { ConditionType } from '../game/condition.ts';
import type { KarmaState } from '../game/karma.ts';
import { placeName } from './narrate.ts';
import { karmaTone } from './tone.ts';
import type { BossDeed, FighterView } from './bossContract.ts';

// ===========================================================================
// HP — five words, by the ratio of hp to max hp
// ===========================================================================

/**
 * The five HP words, highest band first: a fighter at `ratio >= min` reads `word`. The last row's
 * `min` is minus infinity, so every ratio (including a broken one) lands somewhere.
 */
export const HP_BUCKETS: readonly { min: number; word: string }[] = [
  { min: 1, word: 'untouched' },
  { min: 0.75, word: 'barely touched' },
  { min: 0.5, word: 'hurt' },
  { min: 0.25, word: 'badly hurt' },
  { min: Number.NEGATIVE_INFINITY, word: 'near the end' },
];

/** The HP word for a fighter. A zero or broken max reads as the lowest band, never as a number. */
export function hpBucket(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 && Number.isFinite(hp) ? hp / maxHp : 0;
  const row = HP_BUCKETS.find((b) => ratio >= b.min);
  return row ? row.word : 'near the end';
}

// ===========================================================================
// Conditions — what each one DOES, never its label
// ===========================================================================

/**
 * One phrase per condition, describing what it does to whoever has it. EXHAUSTIVE over the
 * engine's union: a new condition fails the build here until it is given words.
 *
 * Every phrase avoids the condition ids as whole words (`slow`, `weak`, `sick`, `burn`, `sleep`
 * … are ids, and a prompt that carries one reads to the model as the label), and avoids the
 * display labels. "moving slowly" and "weakened" are English; "slow" and "weak" are ids.
 */
export const CONDITION_WORDS: Readonly<Record<ConditionType, string>> = {
  bleed: 'bleeding',
  stun: 'too dazed to act',
  fracture: 'nursing a broken bone',
  regeneration: 'mending as the fight goes on',
  burn: 'burning',
  freeze: 'frozen stiff',
  electrify: 'crackling with current',
  poison: 'poisoned',
  sleep: 'drifting asleep',
  insanity: 'hearing things that are not there',
  push: 'knocked off balance',
  aired: 'short of breath',
  exposed: 'left open',
  strong: 'hardened',
  quick: 'quickened',
  healthy: 'steadied',
  smart: 'sharp-minded',
  wise: 'seeing clearly',
  charming: 'hard to look away from',
  weak: 'weakened',
  slow: 'moving slowly',
  sick: 'sickened',
  dumb: 'dull-witted',
  fool: 'easily misled',
  repulsive: 'hard to look at',
};

/**
 * A fighter in words: its HP word, then what each condition does, in the order given, with
 * duplicates removed. `badly hurt, bleeding, moving slowly`.
 */
export function fighterWords(view: FighterView): string {
  const words = [hpBucket(view.hp, view.maxHp), ...view.conditions.map((c) => CONDITION_WORDS[c])];
  return [...new Set(words)].join(', ');
}

// ===========================================================================
// The exchange count — an ordinal WORD, never a digit
// ===========================================================================

/** Ordinal words for exchanges one to twenty. Past twenty, "a late exchange". */
export const EXCHANGE_ORDINALS: readonly string[] = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth',
  'eighteenth', 'nineteenth', 'twentieth',
];

/**
 * `This is the fourth exchange.` — one sentence. Anything below one reads as the first; anything
 * past the table reads as `This is a late exchange.` A digit is never produced.
 */
export function exchangeSentence(n: number): string {
  const index = Number.isFinite(n) ? Math.max(1, Math.floor(n)) - 1 : 0;
  const word = EXCHANGE_ORDINALS[index];
  return word === undefined ? 'This is a late exchange.' : `This is the ${word} exchange.`;
}

// ===========================================================================
// Deeds — one sentence each, with the place's NAME
// ===========================================================================

/** "a Ganger" / "an Enforcer" — the article English chooses from the first letter. */
export function withIndefinite(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

/** "the Fixer"; a name that already carries its article keeps it, lowercased mid-sentence. */
function withDefinite(name: string): string {
  return /^the\s/i.test(name) ? `the ${name.slice(4)}` : `the ${name}`;
}

/** Where a deed happened, as a place name: "the Undercity" … "the True Void". */
function placeOf(deed: BossDeed): string {
  return placeName(deed.floor - 1);
}

/**
 * The sentence a deed becomes in the MEMORY block (BOSS-PROMPTS §4). PURE. The six shapes §4
 * shows are reproduced exactly; the rest follow the same pattern. A deed missing the words it
 * needs gets the plainest true sentence rather than a hole.
 *
 * ⚠ This function does NOT drop a deed that carries a digit — the prompt builder does, so the
 * drop can be reported. `deedHasDigit` is the test.
 */
export function deedSentence(deed: BossDeed): string {
  const place = placeOf(deed);
  const name = deed.name?.trim() ?? '';
  switch (deed.kind) {
    case 'spared':
      return name ? `In ${place} you spared ${withDefinite(name)}.` : `In ${place} you spared someone.`;
    case 'killed':
      return name
        ? `In ${place} you killed ${withIndefinite(name)} you could have spared.`
        : `In ${place} you killed someone you could have spared.`;
    case 'bargain':
      return bargainSentence(deed, place);
    case 'illusion-seen':
      return `In ${place} you saw through a lie the place told you.`;
    case 'boss-felled':
      return name ? `In ${place} you beat ${withDefinite(name)}.` : `In ${place} you beat what ruled there.`;
    case 'boss-yielded':
      return name
        ? `In ${place} you talked ${withDefinite(name)} into yielding.`
        : `In ${place} you talked what ruled there into yielding.`;
    default: {
      // Exhaustive over `DeedKind`: a new kind fails the build here until it has a sentence.
      const _never: never = deed.kind;
      void _never;
      return `In ${place} something happened.`;
    }
  }
}

function bargainSentence(deed: BossDeed, place: string): string {
  const paid = deed.paid?.trim() ?? '';
  const got = deed.got?.trim() ?? '';
  switch (deed.pool) {
    case 'desecration':
      return `In ${place} you broke an altar to take what was on it.`;
    case 'whisper':
      return `At an altar in ${place} you listened to the whisper and took what it offered.`;
    case 'offering':
      return paid && got
        ? `At an altar in ${place} you left ${paid} as an offering and took ${got}.`
        : `At an altar in ${place} you left an offering.`;
    case 'greed':
    default:
      return paid && got
        ? `At an altar in ${place} you gave up ${paid} for ${got}.`
        : `At an altar in ${place} you struck a bargain.`;
  }
}

/** True when a deed's sentence would carry a digit — such a deed is never sent. */
export function deedHasDigit(deed: BossDeed): boolean {
  return /\d/.test(deedSentence(deed));
}

// ===========================================================================
// Karma — manner words, never axis names, never numbers
// ===========================================================================

/**
 * The words for `WHAT THEY ARE` (Warden, Hollow Self): `karmaTone`'s manner words, verbatim —
 * `gentle / cold`, `spare / hungry`, `hushed / profane`, `clear-eyed / unsure`; a zero axis gives
 * no word. The author's decision (2026-09-28), so the boss reads a MANNER, never a score.
 */
export function karmaWords(karma: KarmaState): string[] {
  return karmaTone(karma);
}
