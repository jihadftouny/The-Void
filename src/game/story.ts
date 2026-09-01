// Story content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: story text is plain JSON in ../data/story.json.
//  - No RNG, no Math.random/Date.now.
//
// Ported from the canonical Java `Story.java`. Act intro/outro bodies are empty strings
// because the Java prints only a header plus blank lines (PLAN.md #13 fills the prose).
//
// G49 — WHERE `{playerName}` ACTUALLY IS. This header, and four of the accessors below,
// used to say the `{playerName}` token is kept literal and substituted later, as though it
// appeared throughout the content. It appears in EXACTLY ONE PLACE: `story.json`'s legacy
// `ending.body`, read only by `getEnding()` — which the type declaration itself calls "kept
// for back-compat; no longer on the live path". Every accessor the game actually reads
// (`getIntro`, `getGraceEnding`, `getDamnationEnding`) returns text with no token in it at
// all. The comments were describing a design that the content never adopted.
//
// The consequence, and it is why this is worth a comment rather than a deletion:
// `game.ts`'s `substituteName` is a NO-OP on all three of its live call sites, because none
// of the strings it is handed carries the token. That is not a bug — G47 / WORLD.md §8
// [LOCKED] rules that the narrator never speaks the player's name, so the token being absent
// from the live endings is CORRECT and `story.test.ts` guards it. But a silent no-op sitting
// next to a comment claiming otherwise is precisely G49's failure mode, so it is recorded
// here rather than left to be rediscovered. `story.test.ts` asserts the invariant (only
// `getEnding` carries the token) rather than trusting these words.

import storyData from '../data/story.json';

/** A titled block of story text (Java: header + printed body). */
export interface StorySection {
  header: string;
  body: string;
}

/** The full story content as plain serializable data. */
export interface Story {
  intro: { header: string; lines: readonly string[] };
  actIntros: Record<number, StorySection>;
  actOutros: Record<number, StorySection>;
  /** The legacy single ending (kept for back-compat; no longer on the live path). */
  ending: StorySection;
  /** M12: the two verdict-routed endings (placeholder prose; real text is M14). */
  endings: { grace: StorySection; damnation: StorySection };
}

const STORY = storyData as Story;

/** The whole story object. */
export function getStory(): Story {
  return STORY;
}

/** The opening intro (header + lines). Carries no name token — see the G49 note above. */
export function getIntro(): { header: string; lines: readonly string[] } {
  return STORY.intro;
}

/** The intro shown entering a given Act (1..5), or undefined if none. */
export function getActIntro(act: number): StorySection | undefined {
  return STORY.actIntros[act];
}

/** The outro shown leaving a given Act (1..5), or undefined if none. */
export function getActOutro(act: number): StorySection | undefined {
  return STORY.actOutros[act];
}

/**
 * The legacy ending (header + body). The ONLY story text carrying a literal `{playerName}`
 * token, and the only accessor whose comment may mention one. Not on the live path — the
 * game reads `getGraceEnding` / `getDamnationEnding`.
 */
export function getEnding(): StorySection {
  return STORY.ending;
}

/** The GRACE ending (act-4 ascension). Carries no name token — see the G49 note above. */
export function getGraceEnding(): StorySection {
  return STORY.endings.grace;
}

/** The DAMNATION ending (act-5 Hollow fall). Carries no name token — see the G49 note above. */
export function getDamnationEnding(): StorySection {
  return STORY.endings.damnation;
}
