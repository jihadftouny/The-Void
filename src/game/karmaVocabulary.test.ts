// The shared hidden-karma word list catches what it must and spares what it must (F4).
//
// Every guard that polices karma vocabulary imports `karmaVocabulary.testutil.ts`. These pin the
// list itself — each inflection a leak would really take — and prove the four guards all read
// THIS list rather than a private copy that could drift.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AXIS_STEMS, AXIS_VOCABULARY, SCENE_VOCABULARY } from './karmaVocabulary.testutil.ts';

describe('AXIS_VOCABULARY — stems, so every inflection is caught', () => {
  it('catches the axis nouns and every adjective a narrator or a formatter would reach for', () => {
    for (const w of [
      'karma', 'karmic', 'nature', 'mercy', 'merciful', 'Merciless', 'cruel', 'cruelty',
      'greed', 'greedy', 'restraint', 'restrained', 'reverence', 'reverent', 'desecration',
      'clarity', 'delusion', 'delusional', 'deluded',
    ]) {
      expect(w, w).toMatch(AXIS_VOCABULARY);
    }
  });

  it('spares the act verb and the manner words (the G53 line), and near-misses', () => {
    for (const w of ['desecrate', 'gentle', 'hungry', 'hushed', 'clear-eyed', 'unsure', 'profane', 'mercenary', 'cold', 'spare']) {
      expect(w, w).not.toMatch(AXIS_VOCABULARY);
    }
  });

  it('is built from exactly the ten stems, case-insensitively', () => {
    expect(AXIS_STEMS).toHaveLength(10);
    expect(AXIS_VOCABULARY.flags).toContain('i');
    expect(AXIS_VOCABULARY.source).toBe(AXIS_STEMS.join('|'));
  });

  it('the scene list is the axis list PLUS the act verb, and nothing else', () => {
    expect(SCENE_VOCABULARY.source.startsWith(AXIS_VOCABULARY.source)).toBe(true);
    expect('desecrate').toMatch(SCENE_VOCABULARY);
    expect('merciful').toMatch(SCENE_VOCABULARY);
    expect('gentle').not.toMatch(SCENE_VOCABULARY);
  });
});

describe('every karma guard reads THIS list — no private copy left to drift', () => {
  const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const GUARDS = ['./karmaActions.test.ts', '../dev/observable.test.ts', '../llm/tone.test.ts', './restBrief.test.ts'];

  it('each one imports it', () => {
    for (const rel of GUARDS) {
      expect(read(rel), rel).toMatch(/from '[./]+(?:game\/)?karmaVocabulary\.testutil\.ts'/);
    }
  });

  it('and none of them defines its own word list any more', () => {
    // The shape a private copy takes: a regex literal holding the axis stems.
    const privateCopy = /=\s*\/[^/\n]*(?:mercy|merc\(|reveren)[^/\n]*\/i/;
    for (const rel of GUARDS) {
      expect(read(rel), `${rel} carries its own vocabulary regex again`).not.toMatch(privateCopy);
    }
  });
});
