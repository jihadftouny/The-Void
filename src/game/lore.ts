// Lore content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: lore text is plain JSON in ../data/lore.json.
//  - No RNG here: the rest-encounter picker (M7) reads selectableCount.
//
// Ported from the canonical Java `Lore.java`. Java Act 1 rolls nextInt(3) (all 3
// entries reachable) but Acts 2-4 roll nextInt(c-1)=nextInt(2), so their 3rd entry
// is never selectable. We store all 3 entries per Act and record `selectableCount`
// (3 for Act 1, 2 for Acts 2-4) so M7's picker preserves that behaviour faithfully.

import loreData from '../data/lore.json';

/** A single lore entry (Java `loreTitle` + `loreText`). */
export interface LoreEntry {
  title: string;
  text: string;
}

/** All lore for one Act plus how many of its entries the picker may reach. */
export interface ActLore {
  selectableCount: number;
  entries: readonly LoreEntry[];
}

const LORE = loreData as Readonly<Record<string, ActLore>>;

/** Lore for a given Act (1..4), or undefined if the Act has no lore. */
export function getLore(act: number): ActLore | undefined {
  return LORE[String(act)];
}
