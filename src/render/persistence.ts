// Save/load POLICY for The Void — PURE, Kaplay/DOM-free so it runs and is tested
// headlessly under Node. This module answers three yes/no questions the driver asks
// after every step; it performs NO I/O itself (the driver owns the SaveStorage).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: imports only TYPES/pure functions from src/game
//    (`Phase` type, `decodeSave`). No Kaplay, DOM, `window`, or `localStorage`.
//  - Deterministic seeded RNG: no `Math.random` / `Date.now`.
//
// Checkpoint policy (why this exact set):
//  | phase kind                                  | action    |
//  |---------------------------------------------|-----------|
//  | title/name-entry/class-select/stats-roll    | none      | creation incomplete
//  | main-menu                                   | AUTOSAVE  | the hub — every resolved encounter routes here
//  | battle                                      | none      | mid-round churn must not persist
//  | battle-victory/rest/shop                    | none      | mid-decision; the next main-menu saves the outcome
//  | act-outro/level-up/level-up-result          | none      | mid-transition; committed at act-intro
//  | act-intro                                   | AUTOSAVE  | act transition committed (act 5 = pre-boss checkpoint)
//  | ending/game-over                            | CLEAR     | run finished — Continue must not resume it

import type { Phase } from '../game/game.ts';
import { decodeSave } from '../game/save.ts';

/** Phase kinds at which the driver autosaves the current run. */
export const AUTOSAVE_PHASES: ReadonlySet<Phase['kind']> = new Set<Phase['kind']>([
  'main-menu',
  'act-intro',
]);

/** Phase kinds at which the driver clears the stored save (the run is over). */
export const CLEAR_PHASES: ReadonlySet<Phase['kind']> = new Set<Phase['kind']>([
  'ending',
  'game-over',
]);

/** True iff the run should be autosaved now that it has reached `phase`. */
export function shouldAutosaveFor(phase: Phase): boolean {
  return AUTOSAVE_PHASES.has(phase.kind);
}

/** True iff the stored save should be cleared now that the run reached `phase`. */
export function shouldClearSaveFor(phase: Phase): boolean {
  return CLEAR_PHASES.has(phase.kind);
}

/**
 * True iff `stored` decodes to a valid, current-version save — i.e. the title screen
 * should offer "Continue". `decodeSave` returns `null` for null/corrupt/wrong-shape/
 * future-version/pre-version-1 payloads, so a single non-null check suffices.
 */
export function continueAvailable(stored: string | null): boolean {
  return stored != null && decodeSave(stored) !== null;
}
