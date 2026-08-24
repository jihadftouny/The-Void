// Phase -> scene routing for The Void's UI shell — PURE, Kaplay-free.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: imports only the `Phase` TYPE from src/game (erased
//    at build), no Kaplay / DOM. Unit-tested headlessly under `node`.
//
// The driver calls `sceneFor(state.phase.kind)` after every `step` to decide which
// scene to show. The switch is exhaustive with no `default`, so if src/game ever
// grows a new Phase kind, TypeScript flags this file at compile time — no phase can
// silently route to a missing screen.

import type { Phase } from '../game/game.ts';

/** Every screen the driver can navigate to. */
export type SceneId =
  | 'title'
  | 'name-entry'
  | 'class-select'
  | 'stats-roll'
  | 'main-menu'
  | 'battle'
  | 'rest'
  | 'deal'
  | 'level-up'
  | 'narrative'
  | 'ending'
  | 'game-over';

/**
 * The set of registered scene ids. `sceneFor` is total over `Phase['kind']` and
 * every value it returns is a member of this set (verified in routing.test.ts), so
 * the driver can never navigate to an unregistered scene.
 */
export const SCENE_IDS: ReadonlySet<SceneId> = new Set<SceneId>([
  'title',
  'name-entry',
  'class-select',
  'stats-roll',
  'main-menu',
  'battle',
  'rest',
  'deal',
  'level-up',
  'narrative',
  'ending',
  'game-over',
]);

/**
 * Map a phase kind to the scene that renders it. Total over the `Phase` union
 * (exhaustive switch, no `default`). The narrative "continue" phases (including the
 * chest reveal) share the generic `narrative` scene; the rest each have their own screen.
 */
export function sceneFor(kind: Phase['kind']): SceneId {
  switch (kind) {
    case 'title':
      return 'title';
    case 'name-entry':
      return 'name-entry';
    case 'class-select':
      return 'class-select';
    case 'stats-roll':
      return 'stats-roll';
    case 'main-menu':
      return 'main-menu';
    case 'battle':
      return 'battle';
    case 'battle-victory':
      return 'narrative';
    case 'rest':
      return 'rest';
    case 'deal':
      return 'deal';
    case 'chest':
      // The chest reveal is a continue-phase; the generic narrative scene shows its events.
      return 'narrative';
    case 'act-outro':
      return 'narrative';
    case 'level-up-draft':
      // The draft picker reuses the dedicated `level-up` scene id.
      return 'level-up';
    case 'level-up-result':
      return 'narrative';
    case 'act-intro':
      return 'narrative';
    case 'verdict':
      // The act-4 reckoning is a continue-phase; the generic narrative scene shows its event.
      return 'narrative';
    case 'ending':
      return 'ending';
    case 'game-over':
      return 'game-over';
  }
}
