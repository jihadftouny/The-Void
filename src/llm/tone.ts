// The narrator's TONE channel — pure, framework-agnostic (PLAN.md #2; reused by #10 and #11).
//
// THE PROBLEM IT SOLVES. Karma is hidden by design (GAME-DESIGN.md §7: "no meter, no number,
// ever"), yet §22.26 asks that a rest REFLECT who the character is becoming: "a merciful
// character and a desecrator rest differently — different tone, different detail — with no
// number ever shown". The narrator is a language model; anything put in its prompt can come
// back out verbatim. So what reaches it must be something that is SAFE TO SAY ALOUD.
//
// THE RULE (the G53 rule, generalized): name the MANNER, never the AXIS. Each karma axis maps,
// by the SIGN of its value, to one word describing how a person carries themself — "gentle",
// "hungry", "hushed" — never to the axis nouns ("mercy", "greed", "reverence") and never to a
// number. A merciful ledger is given "gentle"; the model may colour a scene with gentleness,
// and even if it repeats the word, it has said something true of the scene and nothing about a
// hidden score. The vocabulary is CLOSED (this table), so a guard can hold every word to it.
//
// Placeholders: the WORDS are provisional (#13's to author). The RULE is load-bearing and tested
// (`tone.test.ts`, and the universal hidden-karma guard in `karmaActions.test.ts`).
//
// REUSE: `karmaTone` takes the ledger and nothing else, so the boss agents (#11, §22.29) and
// karma in ordinary narration (#10) get the same channel with a one-call change — nothing here
// is rest-specific.

import type { KarmaState } from '../game/karma.ts';

/** The karma axes, in the fixed order the tone words are reported. */
export const TONE_AXES = [
  'mercyCruelty',
  'restraintGreed',
  'reverenceDesecration',
  'clarityDelusion',
] as const satisfies readonly (keyof KarmaState)[];

/**
 * The closed vocabulary — one pair of MANNER words per axis: [virtue pole, shadow pole].
 * Every word here must be safe to say to the player: no axis noun, no number, no verdict.
 */
export const TONE_WORDS: Readonly<Record<(typeof TONE_AXES)[number], readonly [string, string]>> = {
  mercyCruelty: ['gentle', 'cold'],
  restraintGreed: ['spare', 'hungry'],
  reverenceDesecration: ['hushed', 'profane'],
  clarityDelusion: ['clear-eyed', 'unsure'],
};

/** Every tone word, flattened — what the guards check. */
export const ALL_TONE_WORDS: readonly string[] = TONE_AXES.flatMap((axis) => TONE_WORDS[axis]);

/**
 * The manner words a ledger earns — PURE. For each axis in `TONE_AXES` order: a positive value
 * gives the virtue word, a negative value the shadow word, zero gives nothing. So a neutral
 * ledger has NO tone at all (nothing is invented), and the same ledger always gives the same
 * words. The magnitude is deliberately discarded: a word, never a degree.
 */
export function karmaTone(karma: KarmaState): string[] {
  const words: string[] = [];
  for (const axis of TONE_AXES) {
    const v = karma[axis];
    if (v > 0) words.push(TONE_WORDS[axis][0]);
    else if (v < 0) words.push(TONE_WORDS[axis][1]);
  }
  return words;
}
