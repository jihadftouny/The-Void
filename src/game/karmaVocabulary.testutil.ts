// THE ONE hidden-karma word list — shared by every guard that polices it (FIX ROUND 1, F4).
//
// GAME-DESIGN.md §7: karma is hidden — "no meter, no number, ever". The line, made checkable:
// the game may name what you DID; it may never name the AXIS it moved. The verb `desecrate`
// names an act and is legal on a bargain's price tag; the noun `desecration` names the axis.
//
// WHY THIS FILE EXISTS. There were four copies of this list, and they drifted: #2 turned the
// copy in `karmaActions.test.ts` into STEMS (the old `mercy` / `restraint` / `delusion` let
// "merciful", "restrained", "deluded" and "karmic" straight through), but the sweep over every
// event of a real run (`src/dev/observable.test.ts`) kept the old words. So "merciful" planted in
// the victory log line and "merciless" in the victory fact line the model receives fired no karma
// guard at all. One list, imported by all of them, is the only form that cannot drift again.
//
// A test utility: it ships nowhere (`*.testutil.ts` is outside every shipping scan).

/**
 * The axis vocabulary, one STEM per word family so every inflection is caught: karma/karmic,
 * nature, mercy/merciful/merciless, cruel/cruelty, greed/greedy, restraint/restrained,
 * reverence/reverent, desecration, clarity, delusion/delusional/deluded. `desecrate` (the act)
 * is deliberately NOT matched — `karmaVocabulary.test.ts` pins both halves.
 */
export const AXIS_STEMS: readonly string[] = [
  'karm',
  'nature',
  'merc(?:y|i)',
  'cruel',
  'greed',
  'restrain',
  'reveren',
  'desecration',
  'clarity',
  'delu(?:sion|d)',
];

/** The stems as one case-insensitive pattern — what every karma guard matches against. */
export const AXIS_VOCABULARY = new RegExp(AXIS_STEMS.join('|'), 'i');

/**
 * The stricter list for prose that names no act either — the rest scene and the tone words the
 * narrator is handed, where even the verb would be the ledger speaking. DERIVED from the list
 * above, so the two can never disagree about the axis words.
 */
export const SCENE_VOCABULARY = new RegExp(`${AXIS_VOCABULARY.source}|desecrat`, 'i');
