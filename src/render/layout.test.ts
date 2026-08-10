// Unit tests for the pure responsive-layout math. Every expected value is derived
// by hand from the geometry (virtual resolution 540x1080), never read back from the
// implementation.

import { describe, it, expect } from 'vitest';
import {
  scale,
  virtualToCss,
  cssToVirtual,
  contentRect,
  stackButtons,
  hpFraction,
  VIRTUAL_WIDTH,
  VIRTUAL_HEIGHT,
  BUTTON_HEIGHT,
  MIN_TOUCH_PX,
  MIN_VIEWPORT,
  type Rect,
} from './layout.ts';

describe('scale (letterbox = smaller axis ratio)', () => {
  it('matches the hand-derived value at MIN_VIEWPORT 320x568', () => {
    // min(320/540, 568/1080) = min(0.592592..., 0.525925...) = 0.525925...
    expect(scale({ w: 320, h: 568 })).toBeCloseTo(0.525925, 3);
  });

  it('picks the SMALLER of the two axis ratios', () => {
    // 1080/540 = 2 (width ratio); 1080/1080 = 1 (height ratio) -> min is 1.
    expect(scale({ w: 1080, h: 1080 })).toBe(1);
    // A tall, narrow viewport is width-limited: 270/540 = 0.5 < 2160/1080 = 2.
    expect(scale({ w: 270, h: 2160 })).toBe(0.5);
  });

  it('is exactly 1 at the native virtual resolution', () => {
    expect(scale({ w: VIRTUAL_WIDTH, h: VIRTUAL_HEIGHT })).toBe(1);
  });
});

describe('touch-target guarantee at MIN_VIEWPORT', () => {
  it('a BUTTON_HEIGHT-tall virtual button renders >= 44 CSS px', () => {
    // 96 * (568/1080) = 54528/1080 = 50.4889 CSS px.
    const px = virtualToCss(BUTTON_HEIGHT, MIN_VIEWPORT);
    expect(px).toBeCloseTo(50.4889, 3);
    expect(px).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  });

  it('BUTTON_HEIGHT clears the 44px minimum in virtual units', () => {
    // 44 / 0.525925... = 83.66 virtual units; BUTTON_HEIGHT (96) exceeds it.
    expect(BUTTON_HEIGHT).toBeGreaterThanOrEqual(MIN_TOUCH_PX / scale(MIN_VIEWPORT));
  });
});

describe('virtualToCss / cssToVirtual round-trip', () => {
  it('are inverses for a viewport', () => {
    const vp = { w: 320, h: 568 };
    expect(cssToVirtual(virtualToCss(200, vp), vp)).toBeCloseTo(200, 6);
  });
});

describe('contentRect (canvas minus safe-area insets, virtual units)', () => {
  it('subtracts insets from the 540x1080 canvas', () => {
    // h = 1080 - 44 - 34 = 1002; w = 540 - 0 - 0 = 540.
    expect(contentRect({ top: 44, bottom: 34, left: 0, right: 0 })).toEqual({
      x: 0,
      y: 44,
      w: 540,
      h: 1002,
    });
  });

  it('subtracts left/right insets from width and offsets x', () => {
    expect(contentRect({ top: 10, bottom: 10, left: 12, right: 18 })).toEqual({
      x: 12,
      y: 10,
      w: 510, // 540 - 12 - 18
      h: 1060, // 1080 - 10 - 10
    });
  });
});

describe('stackButtons', () => {
  const bounds: Rect = { x: 20, y: 100, w: 500, h: 800 };
  const rects = stackButtons(bounds, 3, 96, 16);

  it('returns exactly `count` rects', () => {
    expect(rects).toHaveLength(3);
  });

  it('places them top-to-bottom, each itemHeight tall, gap apart', () => {
    // y0 = 100; y1 = 100 + (96+16) = 212; y2 = 100 + 2*112 = 324.
    expect(rects[0]).toEqual({ x: 20, y: 100, w: 500, h: 96 });
    expect(rects[1]).toEqual({ x: 20, y: 212, w: 500, h: 96 });
    expect(rects[2]).toEqual({ x: 20, y: 324, w: 500, h: 96 });
  });

  it('keeps every rect inside bounds', () => {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(bounds.x);
      expect(r.y).toBeGreaterThanOrEqual(bounds.y);
      expect(r.x + r.w).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(r.y + r.h).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });

  it('never overlaps any pair (vertical spans are disjoint)', () => {
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!;
        const b = rects[j]!;
        const disjoint = a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });
});

describe('hpFraction (clamped [0,1])', () => {
  it('computes the fraction', () => {
    expect(hpFraction(5, 20)).toBe(0.25);
  });
  it('is 0 at zero HP', () => {
    expect(hpFraction(0, 20)).toBe(0);
  });
  it('clamps above max to 1', () => {
    expect(hpFraction(30, 20)).toBe(1);
  });
  it('clamps negative to 0', () => {
    expect(hpFraction(-5, 20)).toBe(0);
  });
  it('is 0 when maxHp is non-positive (no divide-by-zero)', () => {
    expect(hpFraction(5, 0)).toBe(0);
  });
});
