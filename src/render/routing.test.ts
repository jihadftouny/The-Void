// Unit tests for phase -> scene routing. The full set of phase kinds is enumerated
// by hand (from the Phase union in src/game/game.ts) so the totality check is
// independent of the implementation.

import { describe, it, expect } from 'vitest';
import { sceneFor, SCENE_IDS, type SceneId } from './routing.ts';
import type { Phase } from '../game/game.ts';

// All 16 Phase kinds, listed by hand.
const ALL_PHASE_KINDS: Phase['kind'][] = [
  'title',
  'name-entry',
  'class-select',
  'stats-roll',
  'main-menu',
  'battle',
  'battle-victory',
  'rest',
  'shop',
  'chest',
  'act-outro',
  'level-up',
  'level-up-result',
  'act-intro',
  'ending',
  'game-over',
];

describe('routing totality', () => {
  it('covers all 16 phase kinds', () => {
    expect(ALL_PHASE_KINDS).toHaveLength(16);
  });

  it('maps every phase kind to a registered scene', () => {
    for (const kind of ALL_PHASE_KINDS) {
      expect(SCENE_IDS.has(sceneFor(kind))).toBe(true);
    }
  });
});

describe('specific routes', () => {
  it('routes the narrative "continue" phases to the shared narrative scene', () => {
    const narrativePhases: Phase['kind'][] = [
      'battle-victory',
      'chest',
      'act-outro',
      'level-up-result',
      'act-intro',
    ];
    for (const kind of narrativePhases) {
      expect(sceneFor(kind)).toBe('narrative');
    }
  });

  it('routes own-screen phases to their own scene', () => {
    const own: Array<[Phase['kind'], SceneId]> = [
      ['title', 'title'],
      ['name-entry', 'name-entry'],
      ['class-select', 'class-select'],
      ['stats-roll', 'stats-roll'],
      ['main-menu', 'main-menu'],
      ['battle', 'battle'],
      ['rest', 'rest'],
      ['shop', 'shop'],
      ['level-up', 'level-up'],
      ['ending', 'ending'],
      ['game-over', 'game-over'],
    ];
    for (const [kind, expected] of own) {
      expect(sceneFor(kind)).toBe(expected);
    }
  });
});
