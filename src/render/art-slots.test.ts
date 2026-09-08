// THE THREE RESERVED ART REGIONS — the pure half (plan Appendix A.7).
//
// WHAT IS ACTUALLY BEING PROTECTED HERE, and it is not the code. **The aspect ratio is the
// commitment.** Whatever shape these regions are is the shape every future piece of art must
// be drawn to; change it after the art exists and the art gets redrawn. So the ratios below
// are written out as literal integers taken from the DECISION (`src/data/artSlots.json`'s
// stated reasons and `docs/ART-BIBLE.md` §3), not read back out of the data — a test that
// asked the data to agree with itself would let all three silently drift.
//
// The DOM half — no layout shift when a source appears, no placeholder text on screen — is
// in `src/desktop/screens.test.ts`, where there is a document to render into.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ART_SLOTS, artSlot, aspectRatio, hasSource, type ArtSlotId } from './art-slots.ts';

/**
 * The committed geometry, transcribed from the decision rather than from the module.
 *
 *  - SCENERY 16:9 — not a preference. `docs/ART-BIBLE.md` §3 already LOCKS the five floor
 *    backdrops at 16:9, so any other shape here would invalidate an art brief that predates
 *    this unit.
 *  - ENEMY 3:4 — upright, because the subject is a standing figure, and the shallowest
 *    upright ratio that still leaves the log and the choices their width at 960x640.
 *  - CHARACTER 1:1 — forced by the layout: the portrait lives in the fixed 220px HUD column,
 *    where an upright 3:4 bust would be 293px tall and push HP, XP and the chips off screen.
 */
const COMMITTED: Record<ArtSlotId, [number, number]> = {
  scenery: [16, 9],
  enemy: [3, 4],
  character: [1, 1],
};

describe('the three slots exist, and are the three the design named', () => {
  it('there are exactly three, with the three ids', () => {
    expect(ART_SLOTS.map((s) => s.id)).toEqual(['scenery', 'enemy', 'character']);
  });

  it('each holds the ratio that was committed to', () => {
    for (const id of Object.keys(COMMITTED) as ArtSlotId[]) {
      const slot = artSlot(id);
      expect([slot.ratioW, slot.ratioH], `${id}'s aspect ratio moved`).toEqual(COMMITTED[id]);
    }
  });

  it('scenery is WIDE and both portraits are not — the shapes suit their subjects', () => {
    // The relationship, independent of the exact integers above: a landscape backdrop must be
    // wider than tall, and a portrait must never be.
    expect(artSlot('scenery').ratioW / artSlot('scenery').ratioH).toBeGreaterThan(1);
    expect(artSlot('enemy').ratioW / artSlot('enemy').ratioH).toBeLessThan(1);
    expect(artSlot('character').ratioW / artSlot('character').ratioH).toBeLessThanOrEqual(1);
  });

  it('every slot records WHY its shape is what it is', () => {
    // The durable half of this unit is the reasoning, not the numbers: whoever reopens the
    // decision has to be able to read what it was made against.
    for (const slot of ART_SLOTS) {
      expect(slot.why.length, `${slot.id} has no recorded reason`).toBeGreaterThan(60);
      expect(slot.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('NO ART SHIPS — an absent source is the normal state, not an error', () => {
  it('all three sources are absent today', () => {
    for (const slot of ART_SLOTS) {
      expect(slot.source, `${slot.id} has acquired art — none was to be generated or bought`).toBe(
        null,
      );
      expect(hasSource(slot)).toBe(false);
    }
  });

  it('and `hasSource` really can say yes — or "no art" is a statement about a broken check', () => {
    expect(hasSource({ ...artSlot('scenery'), source: 'assets/undercity.webp' })).toBe(true);
    // An empty string is not art. It would render an `<img src="">`, which re-requests the
    // page itself in every browser.
    expect(hasSource({ ...artSlot('scenery'), source: '' })).toBe(false);
  });

  it('the data file itself carries no image path, in any field', () => {
    // The instruction is "generate nothing, buy nothing, download nothing", and the file is
    // where a URL would appear first.
    const raw = readFileSync(
      fileURLToPath(new URL('../data/artSlots.json', import.meta.url)),
      'utf8',
    );
    for (const needle of ['http://', 'https://', '.png', '.jpg', '.jpeg', '.webp', '.svg']) {
      expect(raw, `the slot data references an image (${needle})`).not.toContain(needle);
    }
  });
});

describe('the geometry is a RATIO, so the region scales instead of being right once', () => {
  it('aspectRatio emits the CSS form, with no pixel unit anywhere', () => {
    expect(aspectRatio(artSlot('scenery'))).toBe('16 / 9');
    expect(aspectRatio(artSlot('enemy'))).toBe('3 / 4');
    expect(aspectRatio(artSlot('character'))).toBe('1 / 1');
    for (const slot of ART_SLOTS) {
      expect(aspectRatio(slot), `${slot.id} reserves a fixed size`).not.toMatch(/px|em|rem|%/);
    }
  });

  it('and every ratio is a positive integer pair — zero would collapse the reservation', () => {
    // A height of 0 produces a region of zero height, which silently reintroduces the exact
    // layout shift the whole mechanism exists to prevent.
    for (const slot of ART_SLOTS) {
      expect(Number.isInteger(slot.ratioW)).toBe(true);
      expect(Number.isInteger(slot.ratioH)).toBe(true);
      expect(slot.ratioW).toBeGreaterThan(0);
      expect(slot.ratioH).toBeGreaterThan(0);
    }
  });
});

describe('lookup is total over the three ids and loud on anything else', () => {
  it('finds each declared slot', () => {
    for (const id of ['scenery', 'enemy', 'character'] as ArtSlotId[]) {
      expect(artSlot(id).id).toBe(id);
    }
  });

  it('and throws on an id nobody declared, rather than returning undefined', () => {
    // Every call site is a literal in this repository, so an unknown id is a typo a build
    // should catch — not a region that silently fails to render.
    expect(() => artSlot('portrait' as ArtSlotId)).toThrow(/art slot/);
  });
});
