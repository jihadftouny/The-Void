// The per-floor rest brief — pure, framework-agnostic game logic (PLAN.md #2).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: a data loader, no Kaplay/DOM/canvas; nothing printed.
//  - Deterministic: NO random decision. The whole brief goes into the narrator's scene block;
//    the model varies the words, the engine never picks among them (so a rest takes no draw).
//  - Data-driven content: WHAT a rest spot is and what it tells you lives in
//    `../data/restBriefs.json`. Every line in it is a MARKED PLACEHOLDER — the words are the
//    author's to write in PLAN.md #13 (GAME-DESIGN.md §22.26: "the narrator describes; the author
//    decides what is true"). Replacing them is a data edit; nothing here changes.
//
// WHY A BRIEF AND NOT A LORE LIST. The old `lore.json` ("this is a lore") was read at rest by a
// seeded pick and printed verbatim. §22.26 makes rest THE game's main lore channel and makes it
// narrated: a rest spot tells you the place and a little of the floor's world, in the calm
// register, and the model writes each vignette live so it never repeats exactly.

import restBriefsData from '../data/restBriefs.json';
import { type FloorId } from './floors.ts';

/** One floor's rest brief. */
export interface RestBrief {
  /** A stable id the `rest-found` event carries (`floor-<n>`), so a log can say which brief. */
  id: string;
  /** Where the rest spot is — one short line. */
  place: string;
  /** Two to four lines of the floor's world, in the calm register. */
  lore: readonly string[];
}

interface RestBriefsFile {
  status: string;
  floors: Record<string, { place: string; lore: string[] }>;
}

const FILE = restBriefsData as unknown as RestBriefsFile;

/** The rest brief for a floor. Throws only if `restBriefs.json` lost a floor (a test pins all five). */
export function restBrief(floor: FloorId): RestBrief {
  const entry = FILE.floors[String(floor)];
  if (!entry) throw new Error(`restBriefs.json has no floor ${floor}`);
  return { id: `floor-${floor}`, place: entry.place, lore: entry.lore };
}

/** The file's own placeholder notice, for the guard test that keeps it marked. */
export const REST_BRIEF_STATUS: string = FILE.status;
