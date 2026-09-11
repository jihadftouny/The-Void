// The per-floor rest brief (PLAN.md #2, GAME-DESIGN.md §22.26): its SHAPE is the contract,
// and its words are marked placeholders until the author writes them in #13.

import { describe, it, expect } from 'vitest';
import { restBrief, REST_BRIEF_STATUS } from './restBrief.ts';
import { FLOOR_IDS } from './floors.ts';

/** WORLD.md §0's reserved words, and the hidden-karma axis vocabulary (GAME-DESIGN §7). */
const RESERVED = /\bhollow|made whole/i;
const AXIS = /karma|nature|mercy|cruel|greed|restraint|reveren|desecrat|clarity|delusion/i;

describe('restBriefs.json — one calm brief per floor', () => {
  it('every floor 1..5 has a place line and two to four lore lines', () => {
    for (const floor of FLOOR_IDS) {
      const b = restBrief(floor);
      expect(b.id).toBe(`floor-${floor}`);
      expect(b.place.trim().length, `floor ${floor} place`).toBeGreaterThan(0);
      expect(b.lore.length, `floor ${floor} lore lines`).toBeGreaterThanOrEqual(2);
      expect(b.lore.length, `floor ${floor} lore lines`).toBeLessThanOrEqual(4);
      for (const line of b.lore) expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('is MARKED as placeholder lore, so nobody ships it as the author’s words', () => {
    expect(REST_BRIEF_STATUS).toMatch(/PLACEHOLDER/);
    expect(REST_BRIEF_STATUS).toMatch(/#13/);
  });

  it('spends no reserved word and names no karma axis (it reaches the model verbatim)', () => {
    for (const floor of FLOOR_IDS) {
      const b = restBrief(floor);
      for (const text of [b.place, ...b.lore]) {
        expect(text, `floor ${floor}: ${text}`).not.toMatch(RESERVED);
        expect(text, `floor ${floor}: ${text}`).not.toMatch(AXIS);
      }
    }
  });
});
