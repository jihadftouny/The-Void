// THE PAINT AUDIT'S MATHS, anchored by hand before the probe trusts it (`floor-looks`).
//
// The layout probe's paint audit judges every glyph in the real page by a ratio computed from
// colours Chromium hands back as strings. A parser that misread `rgba(…, 0)` as opaque, or a
// flatten that stacked the layers in the wrong order, would make every ratio the audit reports a
// number about a page nobody sees — and it would still pass. So every expectation below is
// arithmetic done here, in comments, never a value read off the implementation.

import { describe, it, expect } from 'vitest';
import { flatten, over, parseCssColor, textContrast, toHex } from './probeColour.ts';

describe('parseCssColor reads every form Chromium serialises a computed colour in', () => {
  it('the comma forms, with and without alpha', () => {
    expect(parseCssColor('rgb(244, 245, 249)')).toEqual({ r: 244, g: 245, b: 249, a: 1 });
    expect(parseCssColor('rgba(10, 20, 30, 0.45)')).toEqual({ r: 10, g: 20, b: 30, a: 0.45 });
    // The computed value of a TRANSPARENT background — the case a naive parser reads as black.
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('the space-separated form, alpha as a number or a percentage', () => {
    expect(parseCssColor('rgb(10 20 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssColor('rgb(10 20 30 / 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    // 50% -> 50 / 100 = 0.5
    expect(parseCssColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('the keyword, and any case', () => {
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor('  RGB(1, 2, 3) ')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it('and REFUSES what it cannot read, rather than guessing a colour the page never produced', () => {
    for (const value of ['red', '', '#ffffff', 'color(srgb 1 0 0)', 'rgb(1, 2)', 'hsl(0 0% 0%)', 'none']) {
      expect(parseCssColor(value), value).toBeNull();
    }
  });
});

describe('compositing, by hand-checkable arithmetic', () => {
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const BLACK = { r: 0, g: 0, b: 0, a: 1 };

  it('half white over black is 127.5 per channel, and opaque', () => {
    // 0.5 * 255 + (1 - 0.5) * 0 = 127.5
    expect(over({ ...WHITE, a: 0.5 }, BLACK)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  it('flattens a quarter red onto blue exactly as tokens.ts blendHex does', () => {
    // r: 0.25*255 + 0.75*0 = 63.75 -> 64 = 0x40; b: 0.25*0 + 0.75*255 = 191.25 -> 191 = 0xbf.
    expect(toHex(flatten([{ r: 255, g: 0, b: 0, a: 0.25 }, { r: 0, g: 0, b: 255, a: 1 }]))).toBe('#4000bf');
  });

  it('stops at the first OPAQUE layer — whatever is below it is covered', () => {
    expect(flatten([BLACK, WHITE])).toEqual(BLACK);
    // A transparent layer on top contributes nothing: the floor-2 white shows through untouched.
    expect(toHex(flatten([{ r: 0, g: 0, b: 0, a: 0 }, { r: 244, g: 245, b: 249, a: 1 }]))).toBe('#f4f5f9');
  });

  it('stacks translucent layers NEAREST FIRST — the order is the meaning', () => {
    // Bottom black; blue at 0.5 -> (0, 0, 127.5); red at 0.5 on top -> r 127.5, b 63.75
    // -> #800040. Stacked the other way round it would be #400080, so the order is pinned.
    const stack = [{ r: 255, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 255, a: 0.5 }, BLACK];
    expect(toHex(flatten(stack))).toBe('#800040');
  });

  it('an all-translucent stack lands on opaque black, never on nothing', () => {
    // 0.5 * 255 = 127.5 -> 128 = 0x80
    expect(toHex(flatten([{ ...WHITE, a: 0.5 }]))).toBe('#808080');
  });
});

describe('textContrast judges the glyph the eye receives', () => {
  it('white on black is the 21:1 maximum, either way round', () => {
    expect(textContrast({ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(21, 6);
    expect(textContrast({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(21, 6);
  });

  it('a HALF-transparent white glyph on black is mid-grey text, at the mid-grey ratio', () => {
    // The glyph composites to #808080, L = 0.21586 (tokens.test.ts derives it), so the ratio is
    // 0.26586 / 0.05 = 5.3172 — NOT the 21:1 an unblended white would claim.
    expect(textContrast({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(5.3172, 3);
  });
});
