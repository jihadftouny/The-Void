import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import {
  PALETTE,
  FLOOR_THEMES,
  ENTRANCE_ALTERNATIVE_WHITE,
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

  it('the tightest accent is floor 1 at the hand-computed ~5.67:1', () => {
    // Entrance scarlet #ff3b2f. Red carries only 0.2126 of the luminance weight, so a
    // saturated red is always the tightest colour in a palette like this:
    //   R 255 -> 1.0            G 59 -> 0.043733        B 47 -> 0.028428
    //   L = 0.2126*1.0 + 0.7152*0.043733 + 0.0722*0.028428 = 0.245930
    //   (0.245930 + 0.05) / (0.002190 + 0.05) = 0.295930 / 0.052190 = 5.6702
    // Pinned so a future palette tweak that erodes the margin shows up in the diff rather
    // than silently sliding toward the 4.5 floor.
    expect(contrastRatio(FLOOR_THEMES[1]!.accent, PALETTE.bg)).toBeCloseTo(5.670, 2);
  });

  it('the toxic green and the cold grey land where the hand computation says', () => {
    // Undercity #9dc043: L = 0.2126*0.337163 + 0.7152*0.527117 + 0.0722*0.056127
    //   = 0.452779 -> 0.502779 / 0.052190 = 9.6336
    expect(contrastRatio(FLOOR_THEMES[0]!.accent, PALETTE.bg)).toBeCloseTo(9.634, 2);
    // Ash City #aeb8c0: L = 0.2126*0.423268 + 0.7152*0.479321 + 0.0722*0.527117
    //   = 0.470855 -> 0.520855 / 0.052190 = 9.9799
    expect(contrastRatio(FLOOR_THEMES[2]!.accent, PALETTE.bg)).toBeCloseTo(9.980, 2);
  });
});

// The floors the ART-BIBLE describes as pale are the ones most at risk of collapsing into
// one another. These tests encode the separation as a RULE, so a later palette tweak cannot
// quietly undo it — which is exactly what a per-floor accent exists to prevent.
describe('the pale floors stay distinguishable (docs/ART-BIBLE.md §4)', () => {
  const ASH = FLOOR_THEMES[2]!.accent; // cold neutral grey — dead, drained
  const BONE = FLOOR_THEMES[3]!.accent; // warm bone — sacred, lit

  it('Ash City is COLD: its blue channel exceeds its red', () => {
    // #aeb8c0 -> r 174, b 192. Blue leads by 18.
    const { r, g, b } = hexToRgb(ASH);
    expect(b).toBeGreaterThan(r);
    expect(b - r).toBe(18);
    // ...and it is genuinely neutral, not a blue: green sits between the two.
    expect(g).toBeGreaterThan(r);
    expect(g).toBeLessThan(b);
  });

  it('the Angelic Underground is WARM: its red channel exceeds its blue', () => {
    // #e6e2d3 -> r 230, b 211. Red leads by 19 — the near-mirror of Ash City's 18.
    const { r, g, b } = hexToRgb(BONE);
    expect(r).toBeGreaterThan(b);
    expect(r - b).toBe(19);
    expect(g).toBeLessThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('cold and warm sit on OPPOSITE sides of neutral, not merely at different distances', () => {
    // The sign of (r - b) is the temperature. Ash is negative, bone positive.
    const ash = hexToRgb(ASH);
    const bone = hexToRgb(BONE);
    expect(Math.sign(ash.r - ash.b)).toBe(-1);
    expect(Math.sign(bone.r - bone.b)).toBe(1);
  });

  it('and they are separated by LIGHTNESS too, so greyscale alone still tells them apart', () => {
    // ~9.98:1 against ~15.50:1 — bone is more than half again as bright a step off the bg.
    const ashRatio = contrastRatio(ASH, PALETTE.bg);
    const boneRatio = contrastRatio(BONE, PALETTE.bg);
    expect(boneRatio).toBeGreaterThan(ashRatio * 1.4);
  });

  it("floor 1's scarlet cannot be mistaken for floor 4's arterial red", () => {
    // #ff3b2f (fresh blood on white) vs #ef6076 (old blood in the dark).
    const scarlet = hexToRgb(FLOOR_THEMES[1]!.accent);
    const arterial = hexToRgb(FLOOR_THEMES[4]!.accent);
    // The arterial red is far pinker: blue 118 against 47.
    expect(arterial.b - scarlet.b).toBe(71);
    // And the scarlet is far more saturated: chroma 255-47=208 against 239-96=143.
    const chroma = (c: { r: number; g: number; b: number }): number =>
      Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(chroma(scarlet)).toBe(208);
    expect(chroma(arterial)).toBe(143);
    expect(chroma(scarlet)).toBeGreaterThan(chroma(arterial));
  });

  it('the toxic green is not the healing green — a chip can never be misread', () => {
    // Undercity #9dc043 (acid, blue 67) vs PALETTE.heal #78b98a (sage, blue 138).
    const toxic = hexToRgb(FLOOR_THEMES[0]!.accent);
    const heal = hexToRgb(PALETTE.heal);
    expect(heal.b - toxic.b).toBe(71);
    // The toxic green leans yellow (red well above blue); the sage does not.
    expect(toxic.r - toxic.b).toBe(90);
    expect(heal.r - heal.b).toBe(-18);
  });
});

describe('the floor-2 white alternative is pre-verified, so the swap is safe', () => {
  it('clears the contrast gate and is brighter AND cooler than both pale floors', () => {
    const white = ENTRANCE_ALTERNATIVE_WHITE;
    const ratio = contrastRatio(white, PALETTE.bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    // Brighter than bone (~15.50) and therefore than the cold grey (~9.98) as well.
    expect(ratio).toBeGreaterThan(contrastRatio(FLOOR_THEMES[3]!.accent, PALETTE.bg));
    // Cooler than both: blue leads red, where bone's red leads blue.
    const { r, b } = hexToRgb(white);
    expect(b).toBeGreaterThan(r);
  });

  it('is documented as close to body ink — the reason it is NOT the default', () => {
    // ~18.2:1 against ink's ~16.5:1. Under a 1.3x ratio of ratios they read as the same
    // brightness of white, which is the whole objection recorded in tokens.ts.
    const white = contrastRatio(ENTRANCE_ALTERNATIVE_WHITE, PALETTE.bg);
    const ink = contrastRatio(PALETTE.ink, PALETTE.bg);
    expect(white / ink).toBeLessThan(1.3);
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
    // docs/ART-BIBLE.md §4: toxic green, red fleck, cold ash grey, warm bone, arterial.
    expect(FLOOR_THEMES.map((f) => f.accent)).toEqual([
      '#9dc043', '#ff3b2f', '#aeb8c0', '#e6e2d3', '#ef6076',
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

// ---------------------------------------------------------------------------
// The token layer's one real seam: CSS names a custom property as a STRING, and nothing
// checks that the string exists. A typo (`--void-ink-dimm`) resolves to nothing, and the
// element renders with no colour at all — invisible text on a near-black ground, with no
// type error, no runtime error and no failing test. The only thing that would catch it is
// a human looking at the right screen on the right floor.
//
// This closes that seam headlessly. It walks the REAL stylesheets that ship, so the three
// UI units branching off this one get the same guard for free when they add their own.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');

/** Every stylesheet under src/, found rather than listed, so a new one cannot be missed. */
function stylesheetsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...stylesheetsUnder(full));
    else if (entry.name.endsWith('.css')) found.push(full);
  }
  return found;
}

describe('every --void-* custom property the CSS reads is one the theme writes', () => {
  const files = stylesheetsUnder(SRC_ROOT);
  const defined = new Set(Object.keys(themeVars(0)));

  it('finds the shipping stylesheets (so this test can never be vacuous)', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves every var() reference against themeVars', () => {
    const missing: string[] = [];
    let references = 0;
    for (const file of files) {
      const css = readFileSync(file, 'utf8');
      for (const match of css.matchAll(/var\(\s*(--void-[a-zA-Z0-9-]+)/g)) {
        references += 1;
        const name = match[1]!;
        if (!defined.has(name)) missing.push(`${basename(file)} -> ${name}`);
      }
    }
    // A stylesheet that referenced nothing would make the check meaningless.
    expect(references).toBeGreaterThan(50);
    expect(missing, `undefined custom propert(ies): ${missing.join(', ')}`).toEqual([]);
  });

  it('never DECLARES a --void-* value in CSS — tokens.ts is the only source', () => {
    // A `--void-accent: #fff` in a stylesheet would be a second definition of a token, and
    // would silently win over the one theme.ts writes. That is the drift this layer exists
    // to prevent, so it is a failure, not a style preference.
    const declarations: string[] = [];
    for (const file of files) {
      const css = readFileSync(file, 'utf8');
      for (const match of css.matchAll(/^[^\S\r\n]*(--void-[a-zA-Z0-9-]+)[^\S\r\n]*:/gm)) {
        declarations.push(`${basename(file)} -> ${match[1]!}`);
      }
    }
    expect(declarations, `token(s) redefined in CSS: ${declarations.join(', ')}`).toEqual([]);
  });
});
