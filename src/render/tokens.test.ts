import { describe, it, expect } from 'vitest';
import {
  PALETTE,
  FLOOR_THEMES,
  SPACE,
  TYPE,
  floorTheme,
  themeVars,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
} from './tokens.ts';

// Ordering of this file matters, and is deliberate:
//   1. Anchor the contrast MATH against values derived by hand from the WCAG formula.
//   2. Only then use that math to GATE the real palette.
// Gating with an unverified ratio function would prove nothing — it could return 99 for
// everything and every accent would "pass".

describe('hexToRgb parses sRGB hex by hand-checkable arithmetic', () => {
  it('reads full 6-digit hex', () => {
    // 0x8f = 8*16 + 15 = 143; 0xb0 = 11*16 = 176; 0xc0 = 12*16 = 192.
    expect(hexToRgb('#8fb0c0')).toEqual({ r: 143, g: 176, b: 192 });
  });

  it('expands 3-digit shorthand by doubling each digit', () => {
    // #abc -> aa/bb/cc -> 0xaa = 170, 0xbb = 187, 0xcc = 204.
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('is case-insensitive and tolerates a missing #', () => {
    expect(hexToRgb('E8E8EE')).toEqual({ r: 232, g: 232, b: 238 });
  });

  it('throws on a malformed colour rather than rendering something invisible', () => {
    expect(() => hexToRgb('#12345')).toThrow();
    expect(() => hexToRgb('rebeccapurple')).toThrow();
  });
});

describe('WCAG luminance and contrast — anchored to hand-derived values', () => {
  it('black has luminance 0 and white has luminance 1', () => {
    // Black: every channel is 0, which is below the 0.03928 knee, so L = 0/12.92 = 0.
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    // White: every channel linearises to ((1 + 0.055)/1.055)^2.4 = 1^2.4 = 1,
    // and the three weights sum to 0.2126 + 0.7152 + 0.0722 = 1.
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('mid-grey #808080 linearises to the hand-computed 0.2159', () => {
    // 128/255 = 0.501961; above the knee, so ((0.501961 + 0.055)/1.055)^2.4
    // = (0.527925)^2.4 = e^(2.4 * ln 0.527925) = e^(-1.533096) = 0.21586.
    // All three channels are equal and the weights sum to 1, so L is that same number.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.21586, 4);
  });

  it('white on black is exactly 21:1 — the theoretical maximum', () => {
    // (1 + 0.05) / (0 + 0.05) = 1.05 / 0.05 = 21.
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21.0, 2);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21.0, 2);
  });

  it('a colour against itself is exactly 1:1 — the theoretical minimum', () => {
    for (const hex of ['#000000', '#ffffff', '#808080', PALETTE.bg, PALETTE.ink]) {
      expect(contrastRatio(hex, hex)).toBeCloseTo(1.0, 10);
    }
  });

  it('mid-grey splits the range as the formula demands', () => {
    // L(#808080) = 0.21586, so vs white: 1.05/0.26586 = 3.9494;
    // vs black: 0.26586/0.05 = 5.3172. Their PRODUCT must be 21 exactly, because
    // (1.05/x) * (x/0.05) = 1.05/0.05 — an identity the implementation cannot fake
    // without getting both individual numbers right.
    const vsWhite = contrastRatio('#808080', '#ffffff');
    const vsBlack = contrastRatio('#808080', '#000000');
    expect(vsWhite).toBeCloseTo(3.9494, 3);
    expect(vsBlack).toBeCloseTo(5.3172, 3);
    expect(vsWhite * vsBlack).toBeCloseTo(21.0, 6);
  });
});

describe('the shipped palette clears its contrast budget', () => {
  it('every floor accent is legible on the background (>= 4.5:1)', () => {
    for (const floor of FLOOR_THEMES) {
      const ratio = contrastRatio(floor.accent, PALETTE.bg);
      expect(
        ratio,
        `floor ${floor.place} (${floor.name}) accent ${floor.accent} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary ink is comfortably legible on the background (>= 7:1)', () => {
    expect(contrastRatio(PALETTE.ink, PALETTE.bg)).toBeGreaterThanOrEqual(7);
  });

  it('dimmed ink stays legible on a panel (>= 4.5:1)', () => {
    expect(contrastRatio(PALETTE.inkDim, PALETTE.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('the tightest accent is floor 2 at the hand-computed ~5.32:1', () => {
    // Ash City #c86a2a: L = 0.2126*0.577604 + 0.7152*0.144155 + 0.0722*0.023138
    // = 0.227613; bg L = 0.002190; (0.277613)/(0.052190) = 5.3193.
    // Pinned so that a future palette tweak which erodes the margin is visible in the
    // diff rather than silently sliding toward the 4.5 floor.
    expect(contrastRatio(FLOOR_THEMES[2]!.accent, PALETTE.bg)).toBeCloseTo(5.319, 2);
  });
});

describe('floorTheme is total and clamped', () => {
  it('maps each in-range place to its named floor', () => {
    expect(floorTheme(0).name).toBe('Undercity');
    expect(floorTheme(1).name).toBe('Entrance to the Void');
    expect(floorTheme(2).name).toBe('Ash City');
    expect(floorTheme(3).name).toBe('Angelic Underground');
    expect(floorTheme(4).name).toBe('True Void');
  });

  it('returns the hand-listed accent for each floor', () => {
    expect(FLOOR_THEMES.map((f) => f.accent)).toEqual([
      '#8fb0c0', '#9b8ad6', '#c86a2a', '#e6e2d3', '#ef6076',
    ]);
  });

  it('clamps below 0 to the first floor and above 4 to the last', () => {
    expect(floorTheme(-1).place).toBe(0);
    expect(floorTheme(-999).place).toBe(0);
    expect(floorTheme(5).place).toBe(4);
    expect(floorTheme(99).place).toBe(4);
  });

  it('degrades a non-finite place to floor 0 instead of throwing', () => {
    expect(floorTheme(Number.NaN).place).toBe(0);
    expect(floorTheme(Number.POSITIVE_INFINITY).place).toBe(0);
    expect(floorTheme(Number.NEGATIVE_INFINITY).place).toBe(0);
  });

  it('keeps `place` consistent with the array index', () => {
    FLOOR_THEMES.forEach((f, i) => expect(f.place).toBe(i));
  });
});

describe('themeVars', () => {
  it('names every key as a --void-* custom property', () => {
    const keys = Object.keys(themeVars(0));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^--void-[a-z0-9-]+$/);
  });

  it('returns plain string values only (writable straight to style.setProperty)', () => {
    for (const v of Object.values(themeVars(3))) expect(typeof v).toBe('string');
  });

  it('exposes the same key set on every floor, so no var can go undefined mid-descent', () => {
    const base = Object.keys(themeVars(0)).sort();
    for (let place = 1; place <= 4; place += 1) {
      expect(Object.keys(themeVars(place)).sort()).toEqual(base);
    }
  });

  it('gives all five floors a DISTINCT accent — the palette marks the descent', () => {
    const accents = [0, 1, 2, 3, 4].map((p) => themeVars(p)['--void-accent']);
    expect(new Set(accents).size).toBe(5);
  });

  it('changes ONLY the accent between floors — everything else is floor-independent', () => {
    const a = themeVars(0);
    const b = themeVars(4);
    const differing = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(differing).toEqual(['--void-accent']);
  });
});

describe('the scales are ordered', () => {
  const px = (v: string): number => Number.parseFloat(v);

  it('spacing increases strictly from a 4px base', () => {
    const values = [SPACE.s1, SPACE.s2, SPACE.s3, SPACE.s4, SPACE.s5, SPACE.s6, SPACE.s7].map(px);
    expect(values[0]).toBe(4);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });

  it('the type scale increases strictly', () => {
    const values = [TYPE.xs, TYPE.sm, TYPE.md, TYPE.base, TYPE.lg, TYPE.xl, TYPE.xxl].map(px);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });
});
