// Element content loader for The Void — pure, framework-agnostic game logic.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Data-driven content: the element list is plain JSON in ../data/elements.json.
//  - No RNG, no Math.random/Date.now.
//
// DEVIATION (recorded): Java `Element.java` declares elements as separate static
// objects. We store them as an ORDERED array because the element's position is the
// index into the character's 7-slot resistance array (combat, M5-M6). This order is
// load-bearing and must stay frozen:
//   Physical(0) Cryo(1) Pyro(2) Electro(3) Poison(4) Psychic(5) Force(6).

import elementsData from '../data/elements.json';

/** An element name (one of the seven). */
export type Element = string;

/** The seven elements in canonical resistance-array order. */
export const ELEMENTS: readonly Element[] = elementsData as readonly Element[];

/**
 * The resistance-array index of an element name, or undefined if unknown.
 * Callers index resistance/weakness arrays by this position.
 */
export function getElement(name: string): number | undefined {
  const index = ELEMENTS.indexOf(name);
  return index === -1 ? undefined : index;
}

/** The number of elements (= the resistance-array length). */
export function elementCount(): number {
  return ELEMENTS.length;
}
