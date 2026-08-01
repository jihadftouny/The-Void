// Story content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: story text is plain JSON in ../data/story.json.
//  - No RNG, no Math.random/Date.now.
//
// Ported from the canonical Java `Story.java`. The `{playerName}` token is kept
// literal; substitution is M8's job. Act intro/outro bodies are empty strings
// because the Java prints only a header plus blank lines (M8 fills the prose).

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
  ending: StorySection;
}

const STORY = storyData as Story;

/** The whole story object. */
export function getStory(): Story {
  return STORY;
}

/** The opening intro (header + lines, with the `{playerName}` token literal). */
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

/** The ending (header + body, with the `{playerName}` token literal). */
export function getEnding(): StorySection {
  return STORY.ending;
}
