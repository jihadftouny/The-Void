import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import {
  PALETTE,
  FLOOR_THEMES,
  FLOOR_SCOPED_VARS,
  HIGH_CONTRAST,
  RETHEME_FADE_MS,
  SPACE,
  TYPE,
  TRACK,
  RULE,
  FONT_MONO,
  floorTheme,
  themeVars,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  blendHex,
  compositeGround,
  primaryFontFamily,
} from './tokens.ts';
import { DEFAULT_SETTINGS, settingsVars } from './settings-model.ts';

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
  // ⚠ RE-SCOPED 2026-09-12 (`floor-looks`). This gate used to hold EVERY floor's accent to 4.5:1
  // against `PALETTE.bg`, the near-black BOOT ground, which stood in for "a near-black ground"
  // while all five floors were dark. Floor 2 is now LIGHT and its accent is a deep red that
  // measures 2.11:1 on that black — correctly, because it is never painted there: the boot
  // ground is only visible before the first `retheme()`, which always paints floor 1, and the
  // body covers it on every floor after. Holding the light floor to a ground it never stands on
  // would be a gate measuring a screen nobody sees. So the boot-ground gate now covers the DARK
  // floors, the light floor's own ground and composite are gated below (8.73 / 5.18), and the
  // one accent floor 2 DOES paint on black — its high-contrast `accentOnBlack` — is held here.
  it('every DARK floor accent is legible on the boot ground (>= 4.5:1)', () => {
    const dark = FLOOR_THEMES.filter((f) => f.ground === 'dark');
    expect(dark.map((f) => f.place), 'the light floor is not the one exempted').toEqual([0, 2, 3, 4]);
    for (const floor of dark) {
      const ratio = contrastRatio(floor.accent, PALETTE.bg);
      expect(
        ratio,
        `place ${floor.place} / ART-BIBLE floor ${floor.place + 1} (${floor.name}): ` +
          `accent ${floor.accent} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('...and the light floor’s accent-on-black is legible there too, since black is where it is painted', () => {
    for (const floor of FLOOR_THEMES.filter((f) => f.ground === 'light')) {
      expect(floor.accentOnBlack, `${floor.name} has no accent for high contrast's black`).toBeDefined();
      expect(contrastRatio(floor.accentOnBlack!, PALETTE.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(floor.accentOnBlack!, HIGH_CONTRAST.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary ink is comfortably legible on the background (>= 7:1)', () => {
    expect(contrastRatio(PALETTE.ink, PALETTE.bg)).toBeGreaterThanOrEqual(7);
  });

  it('dimmed ink stays legible on a panel (>= 4.5:1)', () => {
    expect(contrastRatio(PALETTE.inkDim, PALETTE.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('the Entrance scarlet survives as floor 2’s high-contrast accent, at the hand-computed ratios', () => {
    // FLOOR_THEMES[1] — place 1, which is ART-BIBLE floor 2, the Entrance to the Void.
    // The scarlet #ff3b2f was this floor's accent until 2026-09-12; on the new white ground it
    // would be ~3.1:1, so it moved to `accentOnBlack`, the red high contrast paints on black.
    // Red carries only 0.2126 of the luminance weight, so a saturated red is always tight:
    //   R 255 -> 1.0            G 59 -> 0.043733        B 47 -> 0.028428
    //   L = 0.2126*1.0 + 0.7152*0.043733 + 0.0722*0.028428 = 0.245930
    //   on the boot ground: (0.245930 + 0.05) / (0.002190 + 0.05) = 0.295930 / 0.052190 = 5.6702
    //   on pure black:      (0.245930 + 0.05) / (0 + 0.05)        = 0.295930 / 0.05     = 5.9186
    // Pinned so a future tweak that erodes the margin shows up in the diff.
    expect(FLOOR_THEMES[1]!.accentOnBlack).toBe('#ff3b2f');
    expect(contrastRatio(FLOOR_THEMES[1]!.accentOnBlack!, PALETTE.bg)).toBeCloseTo(5.670, 2);
    expect(contrastRatio(FLOOR_THEMES[1]!.accentOnBlack!, '#000000')).toBeCloseTo(5.919, 2);
  });

  it('the Undercity green and the Ash City grey land where the hand computation says', () => {
    // Undercity #9dc043: L = 0.2126*0.337163 + 0.7152*0.527117 + 0.0722*0.056127
    //   = 0.452779 -> 0.502779 / 0.052190 = 9.6336
    expect(contrastRatio(FLOOR_THEMES[0]!.accent, PALETTE.bg)).toBeCloseTo(9.634, 2);
    // Ash City #b8b8b8 (REVISED 2026-09-12 from the cold #aeb8c0 — greyscale now). All three
    // channels are 184 = 0xb8: 184/255 = 0.721569, above the knee, so
    //   ((0.721569 + 0.055) / 1.055)^2.4 = 0.736084^2.4 = e^(2.4 * -0.306412) = 0.479320,
    // and with equal channels L is that same number (the weights sum to 1).
    //   (0.479320 + 0.05) / 0.052190 = 0.529320 / 0.052190 = 10.1422
    expect(contrastRatio(FLOOR_THEMES[2]!.accent, PALETTE.bg)).toBeCloseTo(10.142, 2);
  });
});

// The floors the ART-BIBLE describes as pale are the ones most at risk of collapsing into
// one another. These tests encode the separation as a RULE, so a later palette tweak cannot
// quietly undo it — which is exactly what a per-floor accent exists to prevent.
// NUMBERING, because these two schemes are off by one and the confusion is easy:
// `place` is the ENGINE's 0-based index (state.place, and the array index here);
// docs/ART-BIBLE.md numbers the floors 1-5. place 2 IS ART-BIBLE floor 3, the Ash City.
// Below, floors are named rather than numbered wherever a name will do.
describe('the pale floors stay distinguishable (docs/ART-BIBLE.md §4)', () => {
  const ASH = FLOOR_THEMES[2]!.accent; // place 2 = floor 3: neutral grey, drained
  const BONE = FLOOR_THEMES[3]!.accent; // place 3 = floor 4: warm bone, sacred, lit

  // ⚠ REVISED 2026-09-12 (`floor-looks`). These used to read "Ash City is COLD: its blue
  // channel exceeds its red (#aeb8c0, blue leads by 18)". The revision asks for floor 3 in
  // greyscale only — the author's "purely white gray and black" — so the Ash City is now
  // strictly NEUTRAL, and the cold-against-warm separation becomes neutral-against-warm: still
  // two OPPOSITE treatments, not two distances from one.
  it('Ash City is NEUTRAL: all three channels are equal — no hue at all', () => {
    // #b8b8b8 -> r 184, g 184, b 184.
    const { r, g, b } = hexToRgb(ASH);
    expect(r).toBe(184);
    expect(g).toBe(r);
    expect(b).toBe(r);
  });

  it('the Angelic Underground is WARM: its red channel exceeds its blue', () => {
    // #e6e2d3 -> r 230, b 211. Red leads by 19.
    const { r, g, b } = hexToRgb(BONE);
    expect(r).toBeGreaterThan(b);
    expect(r - b).toBe(19);
    expect(g).toBeLessThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('neutral and warm are OPPOSITE treatments, not merely different distances from one', () => {
    // The sign of (r - b) is the temperature: 0 is no hue at all, +1 is warm.
    const ash = hexToRgb(ASH);
    const bone = hexToRgb(BONE);
    expect(Math.sign(ash.r - ash.b)).toBe(0);
    expect(Math.sign(bone.r - bone.b)).toBe(1);
  });

  it('and they are separated by LIGHTNESS too, so greyscale alone still tells them apart', () => {
    // ~10.14:1 against ~15.50:1 on the boot ground — a ratio of ratios of 15.5045 / 10.1421 =
    // 1.529, more than the 1.4 this rule demands.
    const ashRatio = contrastRatio(ASH, PALETTE.bg);
    const boneRatio = contrastRatio(BONE, PALETTE.bg);
    expect(boneRatio).toBeGreaterThan(ashRatio * 1.4);
    expect(boneRatio / ashRatio).toBeCloseTo(1.529, 2);
  });

  it("the Entrance's blood red cannot be mistaken for the True Void's arterial red", () => {
    // FLOOR_THEMES[1] (place 1 = ART-BIBLE floor 2, Entrance) against FLOOR_THEMES[4]
    // (place 4 = ART-BIBLE floor 5, True Void). REVISED 2026-09-12: the Entrance's accent is no
    // longer the bright scarlet but a deep blood red, so they separate on new axes —
    // #8e0c0a (fresh blood, on white) against #ef6076 (old blood, burning in the dark).
    const blood = hexToRgb(FLOOR_THEMES[1]!.accent);
    const arterial = hexToRgb(FLOOR_THEMES[4]!.accent);
    // The arterial red is far pinker: blue 118 against 10.
    expect(arterial.b - blood.b).toBe(108);
    // And far lighter: L 0.2802 against 0.0604 (the blood red's channels 142/12/10 linearise to
    // 0.270498 / 0.003677 / 0.003035, so L = 0.057508 + 0.002630 + 0.000219 = 0.060357) — more
    // than four times the light, so they differ even with the hue taken away.
    expect(relativeLuminance(FLOOR_THEMES[1]!.accent)).toBeCloseTo(0.0604, 4);
    expect(relativeLuminance(FLOOR_THEMES[4]!.accent) / relativeLuminance(FLOOR_THEMES[1]!.accent)).toBeGreaterThan(4);
    // ...and they never share a ground: one sits on the only light floor, the other on the darkest.
    expect(FLOOR_THEMES[1]!.ground).toBe('light');
    expect(FLOOR_THEMES[4]!.ground).toBe('dark');
  });

  it("floor 2's harm is a CRIMSON, never the accent's red — the HP and charges bars cannot match", () => {
    // On floor 2 the player's HP bar fills with `--void-harm` and the charges bar with
    // `--void-accent`, side by side in the stat box. #9b1b52 (r 155, b 82) against #8e0c0a
    // (r 142, b 10): the harm leans toward magenta by 72 points of blue; the accent is a pure red.
    const harm = hexToRgb(FLOOR_THEMES[1]!.harm);
    const accent = hexToRgb(FLOOR_THEMES[1]!.accent);
    expect(harm.b - accent.b).toBe(72);
    // ...while the accent's green and blue sit together (12 and 10): a red, leaning neither
    // toward orange nor toward the harm's magenta.
    expect([accent.g, accent.b]).toEqual([12, 10]);
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

// (REMOVED 2026-09-12, `floor-looks`: "the floor-2 white alternative is pre-verified, so the
// swap is safe" — two tests pinning `ENTRANCE_ALTERNATIVE_WHITE`, a white ACCENT on a dark floor
// 2 kept as "the reversible half" of the 2026-08-25 decision. The white is floor 2's GROUND now,
// so the alternative has no meaning and the constant is deleted with its tests.)

describe('floorTheme is total and clamped', () => {
  it('maps each in-range place to its named floor', () => {
    expect(floorTheme(0).name).toBe('Undercity');
    expect(floorTheme(1).name).toBe('Entrance to the Void');
    expect(floorTheme(2).name).toBe('Ash City');
    expect(floorTheme(3).name).toBe('Angelic Underground');
    expect(floorTheme(4).name).toBe('True Void');
  });

  it('returns the hand-listed accent for each floor', () => {
    // docs/ART-BIBLE.md §4: toxic green, blood red on white, neutral ash grey, warm bone,
    // arterial. (REVISED 2026-09-12: floor 2 #ff3b2f -> #8e0c0a, floor 3 #aeb8c0 -> #b8b8b8.)
    expect(FLOOR_THEMES.map((f) => f.accent)).toEqual([
      '#9dc043', '#8e0c0a', '#b8b8b8', '#e6e2d3', '#ef6076',
    ]);
  });

  it('clamps below 0 to the first floor and above 4 to the last', () => {
    expect(floorTheme(-1).place).toBe(0);
    expect(floorTheme(-999).place).toBe(0);
    expect(floorTheme(5).place).toBe(4);
    expect(floorTheme(99).place).toBe(4);
  });

  it('degrades a non-finite place to place 0 (the Undercity) instead of throwing', () => {
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

  // ⚠ SUPERSEDED 2026-09-07 by `visual-identity`. This test used to read:
  //
  //     const differing = Object.keys(a).filter((k) => a[k] !== b[k]);
  //     expect(differing).toEqual(['--void-accent']);
  //
  // and it was correct for the design it was written against — one near-black ground, one
  // accent per floor. The author's direction ("each floor has a distinct font color, and
  // background color with a certain level of texture") replaces that design with five
  // environments, so the old assertion now states the opposite of the requirement.
  //
  // It is REPLACED, not deleted, and deliberately made stronger rather than looser: it
  // enumerates exactly which names are allowed to move, so a token that quietly BECOMES
  // floor-dependent fails here, and so does a floor-scoped token that quietly stops
  // changing. `expect(differing.length).toBeGreaterThan(1)` would have been the lazy edit
  // and would have caught neither.
  it('never changes a token OUTSIDE the floor-scoped list', () => {
    // The half that protects the rest of the interface. Every ORDERED pair, not just 0 and 4:
    // a token that happened to hold the same value at the two ends of the descent would look
    // floor-independent to a single comparison and drift in the middle.
    const allowed = new Set(FLOOR_SCOPED_VARS);
    for (let i = 0; i < FLOOR_THEMES.length; i += 1) {
      for (let j = 0; j < FLOOR_THEMES.length; j += 1) {
        if (i === j) continue;
        const a = themeVars(i);
        const b = themeVars(j);
        const leaked = Object.keys(a)
          .filter((k) => a[k] !== b[k] && !allowed.has(k))
          .sort();
        expect(
          leaked,
          `floors ${i} and ${j}: ${leaked.join(', ')} became floor-dependent without being ` +
            'declared floor-scoped — the spacing, type and role colours must not move underfoot',
        ).toEqual([]);
      }
    }
  });

  it('and every name on the floor-scoped list really does move on some pair', () => {
    // The half that stops the list becoming a rubber stamp. A name listed as floor-scoped
    // that holds the same value on all five floors is a token that silently stopped marking
    // the descent — which is precisely the regression the superseded test used to catch.
    const keys = new Set(Object.keys(themeVars(0)));
    for (const name of FLOOR_SCOPED_VARS) {
      expect(keys.has(name), `${name} is listed as floor-scoped but themeVars never emits it`).toBe(
        true,
      );
      const values = new Set(FLOOR_THEMES.map((_, place) => themeVars(place)[name]));
      expect(
        values.size,
        `${name} holds one value on all five floors — it is not floor-scoped at all`,
      ).toBeGreaterThan(1);
    }
  });

  it('and the ground, the ink and the accent are DIFFERENT on all five floors', () => {
    // Stronger than "moves on some pair" for the three that carry the whole identity: the
    // author's direction is a distinct font colour and background colour PER FLOOR, so five
    // distinct values is the requirement, not four plus a repeat.
    for (const name of ['--void-bg', '--void-ink', '--void-accent']) {
      const values = FLOOR_THEMES.map((_, place) => themeVars(place)[name]);
      expect(new Set(values).size, `${name}: ${values.join(', ')}`).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------------------
// `floor-looks` (2026-09-12) — FLOORS 1, 4 AND 5 ARE NOT RESTYLED, proven against a snapshot.
//
// The six furniture/role tokens became floor-scoped so floor 2 could carry its own. That
// refactor touches every floor's `themeVars`, so the three floors the unit must NOT change are
// held to what they emitted on `main` at 6ebfa42 — TRANSCRIBED BY HAND from the plan's table,
// never generated from the code under test (a snapshot regenerated from the new code would
// agree with it by construction and prove nothing). A unit that deliberately re-paints one of
// these floors updates its row here and says why.
// ---------------------------------------------------------------------------------------

describe('floors 1, 4 and 5 emit exactly what they emitted before this unit', () => {
  /** The floor-scoped values of `themeVars` on `main` at 6ebfa42, transcribed. */
  const FURNITURE = {
    '--void-rule': '#23232e',
    '--void-rule-strong': '#3a3a4a',
    '--void-ink-faint': '#55555f',
    '--void-harm': '#e0574f',
    '--void-heal': '#78b98a',
    '--void-foe': '#c98a3a',
  };
  const ON_MAIN: Record<number, { vars: Record<string, string>; kind: string }> = {
    0: {
      kind: 'fog',
      vars: {
        '--void-accent': '#9dc043', '--void-bg': '#060a09', '--void-panel': '#0b100e',
        '--void-panel-raised': '#111815', '--void-ink': '#e6ece7', '--void-ink-dim': '#89968e',
        '--void-texture-ink': '#4f8f6a', '--void-texture-opacity': '0.1', ...FURNITURE,
      },
    },
    3: {
      kind: 'glow',
      vars: {
        '--void-accent': '#e6e2d3', '--void-bg': '#0d0b07', '--void-panel': '#14110b',
        '--void-panel-raised': '#1c1810', '--void-ink': '#f0ead8', '--void-ink-dim': '#9b9483',
        '--void-texture-ink': '#e6d9b0', '--void-texture-opacity': '0.1', ...FURNITURE,
      },
    },
    4: {
      kind: 'absence',
      vars: {
        '--void-accent': '#ef6076', '--void-bg': '#030304', '--void-panel': '#08080a',
        '--void-panel-raised': '#0e0e11', '--void-ink': '#ded7d9', '--void-ink-dim': '#8b8489',
        '--void-texture-ink': '#000000', '--void-texture-opacity': '0.55', ...FURNITURE,
      },
    },
  };
  /** The dimensionless keys — unchanged constants, asserted by reference to their scales. */
  const DIMENSIONLESS: Record<string, string> = {
    '--void-space-1': SPACE.s1, '--void-space-2': SPACE.s2, '--void-space-3': SPACE.s3,
    '--void-space-4': SPACE.s4, '--void-space-5': SPACE.s5, '--void-space-6': SPACE.s6,
    '--void-space-7': SPACE.s7,
    '--void-type-xs': TYPE.xs, '--void-type-sm': TYPE.sm, '--void-type-md': TYPE.md,
    '--void-type-base': TYPE.base, '--void-type-lg': TYPE.lg, '--void-type-xl': TYPE.xl,
    '--void-type-xxl': TYPE.xxl,
    '--void-track-tight': TRACK.tight, '--void-track-wide': TRACK.wide, '--void-track-widest': TRACK.widest,
    '--void-rule-hair': RULE.hair, '--void-rule-heavy': RULE.heavy, '--void-radius': RULE.radius,
    '--void-font-mono': FONT_MONO,
  };

  for (const [place, snapshot] of Object.entries(ON_MAIN)) {
    it(`place ${place} (${floorTheme(Number(place)).name}): every value it had, it still has`, () => {
      const now = themeVars(Number(place));
      const before = { ...snapshot.vars, ...DIMENSIONLESS };
      expect(Object.keys(before)).toHaveLength(35); // 14 floor-scoped + 21 dimensionless, on main
      for (const [name, value] of Object.entries(before)) {
        expect(now[name], `${name} moved on a floor this unit must not touch`).toBe(value);
      }
      // ...and the ONLY key it gained is the dissolve's duration.
      expect(Object.keys(now).filter((k) => !(k in before))).toEqual(['--void-fade-retheme']);
      expect(floorTheme(Number(place)).texture.kind).toBe(snapshot.kind);
    });
  }
});

describe('the six furniture and role tokens are floor-scoped now (AC-4)', () => {
  const SIX = ['--void-rule', '--void-rule-strong', '--void-ink-faint', '--void-harm', '--void-heal', '--void-foe'];

  it('all six are on the floor-scoped list', () => {
    for (const name of SIX) expect(FLOOR_SCOPED_VARS, name).toContain(name);
  });

  it('on floors 1, 4 and 5 they are still the PALETTE values, verbatim', () => {
    const palette: Record<string, string> = {
      '--void-rule': PALETTE.rule, '--void-rule-strong': PALETTE.ruleStrong, '--void-ink-faint': PALETTE.inkFaint,
      '--void-harm': PALETTE.harm, '--void-heal': PALETTE.heal, '--void-foe': PALETTE.foe,
    };
    for (const place of [0, 3, 4]) {
      for (const name of SIX) expect(themeVars(place)[name], `${name} on place ${place}`).toBe(palette[name]);
    }
  });

  it('on floor 2 they are the light floor’s own, as the plan lists them', () => {
    const vars = themeVars(1);
    expect(vars['--void-rule']).toBe('#c9ccd6');
    expect(vars['--void-rule-strong']).toBe('#a5a9b7');
    expect(vars['--void-ink-faint']).toBe('#9a9eab');
    expect(vars['--void-harm']).toBe('#9b1b52');
    expect(vars['--void-heal']).toBe('#1f5c33');
    expect(vars['--void-foe']).toBe('#6b4a0c');
  });

  it('the dissolve duration is one number, emitted for CSS in ms', () => {
    // 1200 ms: the plan's reasoning is in tokens.ts, beside the constant. The layout probe
    // samples the real fade against this same number.
    expect(RETHEME_FADE_MS).toBe(1200);
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      expect(themeVars(place)['--void-fade-retheme']).toBe('1200ms');
    }
  });
});

// ---------------------------------------------------------------------------------------
// `floor-looks` (2026-09-12) — THE GROUND, DECLARED AND MEASURED (AC-2), and FLOOR 3's GREYSCALE
// (AC-6). A declared `ground` that disagreed with the luminance would invert the strike flash on
// the wrong floor; a "greyscale" floor with one tinted token would be greyscale in name only.
// ---------------------------------------------------------------------------------------

describe('floor 2 is the one LIGHT floor, by declaration AND by the maths (AC-2)', () => {
  it('exactly one ground has more than half of white’s luminance, and it is place 1', () => {
    const light = FLOOR_THEMES.filter((f) => relativeLuminance(f.bg) > 0.5);
    expect(light.map((f) => f.place)).toEqual([1]);
    // #f4f5f9: 244 / 245 / 249 linearise to 0.904661 / 0.913099 / 0.947307, so
    // L = 0.2126*0.904661 + 0.7152*0.913099 + 0.0722*0.947307 = 0.913775.
    expect(relativeLuminance(FLOOR_THEMES[1]!.bg)).toBeCloseTo(0.9138, 4);
  });

  it('every floor DECLARES the ground its luminance says it has', () => {
    for (const floor of FLOOR_THEMES) {
      const measured = relativeLuminance(floor.bg) > 0.5 ? 'light' : 'dark';
      expect(floor.ground, `${floor.name} declares a ${floor.ground} ground on ${floor.bg}`).toBe(measured);
    }
  });

  it('the light floor’s ground and ink are the hand-listed white and near-black', () => {
    expect(themeVars(1)['--void-bg']).toBe('#f4f5f9');
    expect(themeVars(1)['--void-ink']).toBe('#15171d');
    expect(themeVars(1)['--void-accent']).toBe('#8e0c0a');
  });
});

describe('floor 3 is greyscale — no hue anywhere in its environment (AC-6)', () => {
  it('every environment colour has r = g = b', () => {
    const f = FLOOR_THEMES[2]!;
    const environment: Record<string, string> = {
      bg: f.bg, panel: f.panel, panelRaised: f.panelRaised, ink: f.ink, inkDim: f.inkDim,
      inkFaint: f.inkFaint, rule: f.rule, ruleStrong: f.ruleStrong, accent: f.accent,
      'texture.ink': f.texture.ink,
    };
    expect(Object.keys(environment)).toHaveLength(10);
    for (const [name, hex] of Object.entries(environment)) {
      const { r, g, b } = hexToRgb(hex);
      expect([g, b], `floor 3's ${name} ${hex} carries a hue`).toEqual([r, r]);
    }
  });

  it('...and the three ROLES are the one declared exemption: harm must read as harm on every floor', () => {
    const f = FLOOR_THEMES[2]!;
    expect([f.harm, f.heal, f.foe]).toEqual([PALETTE.harm, PALETTE.heal, PALETTE.foe]);
    // Non-vacuity for the greyscale check above: the roles really do carry hue, so a check that
    // had swept them in would have failed — the exemption is load-bearing, not decorative.
    const harm = hexToRgb(f.harm);
    expect(harm.r === harm.g && harm.g === harm.b).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE FIVE ENVIRONMENTS (author direction, 2026-09-07). Five ink/ground pairings is five
// chances to ship something unreadable, and legibility is the one thing that cannot be
// traded for atmosphere. Everything below derives its threshold from WCAG — 4.5:1 for
// ordinary text and UI, 7:1 for comfortable body reading — and its measurement from the
// SHIPPED token values. Nothing here is a number read off the implementation and pasted
// back in; that would be a gate that passes by construction.
//
// The pre-existing accent gate above measures against `PALETTE.bg`, which is now the BOOT
// ground — the frame CSS paints before any script runs. It still guards that frame, so it
// stays. What follows is the operative gate: each floor against its own environment.
// ---------------------------------------------------------------------------

/** WCAG 2.x AA for text and UI components. */
const AA = 4.5;
/** WCAG 2.x AAA for body text — the standard the original palette already held itself to. */
const AAA = 7;

describe('blendHex composites by hand-checkable arithmetic', () => {
  it('is the identity at the two ends', () => {
    expect(blendHex('#ffffff', '#000000', 0)).toBe('#000000');
    expect(blendHex('#ffffff', '#000000', 1)).toBe('#ffffff');
  });

  it('half of white over black is #808080 — 0.5*255 = 127.5, which rounds to 128 = 0x80', () => {
    expect(blendHex('#ffffff', '#000000', 0.5)).toBe('#808080');
  });

  it('blends each channel independently', () => {
    // r: 0.25*255 + 0.75*0   = 63.75 -> 64  = 0x40
    // g: 0.25*0   + 0.75*0   = 0            = 0x00
    // b: 0.25*0   + 0.75*255 = 191.25 -> 191 = 0xbf
    expect(blendHex('#ff0000', '#0000ff', 0.25)).toBe('#4000bf');
  });

  it('clamps a nonsense alpha instead of throwing, so the gate can still judge colours', () => {
    expect(blendHex('#ffffff', '#000000', 2)).toBe('#ffffff');
    expect(blendHex('#ffffff', '#000000', -1)).toBe('#000000');
    expect(blendHex('#ffffff', '#000000', Number.NaN)).toBe('#000000');
  });
});

describe('the atmosphere is ON — the control, before anything is measured against it', () => {
  // A "texture off" assertion is worthless if the texture was never on. This block is that
  // control, and it is deliberately first: everything below it is only meaningful because
  // these pass.
  it('every floor really carries a texture, at a non-zero peak alpha', () => {
    expect(FLOOR_THEMES.length).toBe(5);
    for (const floor of FLOOR_THEMES) {
      expect(floor.texture.opacity, `${floor.name} has no atmosphere`).toBeGreaterThan(0);
      expect(floor.texture.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('and the texture visibly CHANGES the surface text is read against', () => {
    for (const floor of FLOOR_THEMES) {
      expect(
        compositeGround(floor),
        `${floor.name}: the composite equals the bare ground, so the texture paints nothing`,
      ).not.toBe(floor.bg);
    }
  });

  it('each texture pushes its ground the way its KIND says: fog, ash and glow lighten; flecks and absence darken', () => {
    // The direction is the meaning, not a detail. Fog, ash and the sacred glow lie on top of a
    // dark ground and make it paler — which is precisely why the gate has to run against the
    // composite. The True Void's is a vignette in pure black — absence, not destruction — so it
    // darkens its ground. REVISED 2026-09-12: floor 2's red flecks lie on a WHITE ground, so
    // they darken it too — and on the light floor darkening is what COSTS contrast, because
    // its ink is the dark one. (This used to read "four textures add light".)
    //
    // Transcribed from the design rather than derived from the data, so a kind that quietly
    // changed direction fails here.
    const DIRECTION: Record<string, 'lighten' | 'darken'> = {
      fog: 'lighten',
      ash: 'lighten',
      glow: 'lighten',
      flecks: 'darken',
      absence: 'darken',
    };
    for (const floor of FLOOR_THEMES) {
      const bare = relativeLuminance(floor.bg);
      const composited = relativeLuminance(compositeGround(floor));
      const want = DIRECTION[floor.texture.kind];
      expect(want, `${floor.name}'s texture kind '${floor.texture.kind}' has no declared direction`).toBeDefined();
      if (want === 'darken') {
        expect(composited, `${floor.name} should be darkened by its texture`).toBeLessThan(bare);
      } else {
        expect(composited, `${floor.name} should be lightened by its texture`).toBeGreaterThan(bare);
      }
    }
    // ...and both directions are really exercised, so neither branch above is vacuous.
    const kinds = FLOOR_THEMES.map((f) => DIRECTION[f.texture.kind]);
    expect(kinds.filter((d) => d === 'darken')).toHaveLength(2);
    expect(kinds.filter((d) => d === 'lighten')).toHaveLength(3);
  });
});

describe('every floor is legible in its own environment', () => {
  /** The worse of "text on the bare ground" and "text on the ground plus its atmosphere". */
  const worstAgainstGround = (colour: string, floor: (typeof FLOOR_THEMES)[number]): number =>
    Math.min(contrastRatio(colour, floor.bg), contrastRatio(colour, compositeGround(floor)));

  it('body ink clears AAA on the ground AND on the textured composite', () => {
    for (const floor of FLOOR_THEMES) {
      const ratio = worstAgainstGround(floor.ink, floor);
      expect(
        ratio,
        `place ${floor.place} (${floor.name}): ink ${floor.ink} on ${floor.bg} / ` +
          `${compositeGround(floor)} is ${ratio.toFixed(2)}:1, under the ${AAA}:1 body gate`,
      ).toBeGreaterThanOrEqual(AAA);
    }
  });

  it('body ink clears AAA on both panel surfaces too', () => {
    // Most of the game's text sits on a panel, not on the bare ground — rows, buttons, the
    // HUD sidebar. A gate that only checked the ground would be checking the emptiest part
    // of the screen.
    for (const floor of FLOOR_THEMES) {
      for (const surface of [floor.panel, floor.panelRaised]) {
        expect(
          contrastRatio(floor.ink, surface),
          `${floor.name}: ink on ${surface}`,
        ).toBeGreaterThanOrEqual(AAA);
      }
    }
  });

  it('dimmed ink clears AA on every surface it is used on', () => {
    for (const floor of FLOOR_THEMES) {
      for (const surface of [floor.bg, floor.panel, floor.panelRaised]) {
        expect(
          contrastRatio(floor.inkDim, surface),
          `${floor.name}: dim ink ${floor.inkDim} on ${surface}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('the accent clears AA on the ground AND on the composite — the focus ring rides on it', () => {
    // S4c: focus visibility must not regress. The ring is `--void-accent`, drawn over
    // whatever the floor is painting, so the textured composite is the surface that matters.
    for (const floor of FLOOR_THEMES) {
      const ratio = worstAgainstGround(floor.accent, floor);
      expect(
        ratio,
        `place ${floor.place} (${floor.name}): accent ${floor.accent} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it('and harm still reads as harm on all five floors — on the ground and on BOTH panels', () => {
    // A damage number nobody can read on floor 3 is a rules bug wearing a palette's clothes.
    //
    // ⚠ REVISED 2026-09-12 (`floor-looks`), twice over:
    //   - The roles are the FLOOR's own now (`floor.harm`, ...): floor 2 is white, and PALETTE's
    //     harm is 3.41:1 on it. The dark floors still carry PALETTE's, so for them nothing moved.
    //   - The RAISED panel is gated too. This gate used to stop at the ground and the flat
    //     panel, and the destructive hub row — "Abandon the descent", harm on a button, and a
    //     button is `--void-panel-raised` — measured 4.39:1 on floor 3 on `main`, under AA, with
    //     every test green. The layout probe's paint audit found it in the real page; this is
    //     the token-level half, so the next palette tweak cannot reopen it before the probe runs.
    for (const floor of FLOOR_THEMES) {
      for (const [role, colour] of [['harm', floor.harm], ['heal', floor.heal], ['foe', floor.foe]] as const) {
        for (const surface of [floor.bg, floor.panel, floor.panelRaised]) {
          const ratio = contrastRatio(colour, surface);
          expect(ratio, `${floor.name}: ${role} ${colour} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
        }
      }
    }
  });

  it('floor 2’s TIGHTEST gate is its accent on the fleck composite, at the hand-derived 5.18:1', () => {
    // The worst case on the light floor, pinned to two decimals so a later alpha or ink tweak
    // shows in the diff rather than sliding silently toward 4.5.
    //   composite = 0.3 * (192, 24, 26) + 0.7 * (244, 245, 249)      [#c0181a over #f4f5f9]
    //             = (228.4, 178.7, 182.1) -> (228, 179, 182) = #e4b3b6
    //   L(#e4b3b6) = 0.2126*0.775822 + 0.7152*0.450786 + 0.0722*0.467784 = 0.521116
    //   L(#8e0c0a) = 0.2126*0.270498 + 0.7152*0.003677 + 0.0722*0.003035 = 0.060357
    //     (blue 10/255 = 0.039216 sits just under the 0.03928 knee: 0.039216 / 12.92)
    //   (0.521116 + 0.05) / (0.060357 + 0.05) = 0.571116 / 0.110357 = 5.1752
    // (The plan's text wrote the composite's first operand as (142, 12, 10), the ACCENT's
    // channels; the result it reached, #e4b3b6, is the fleck ink's — this derivation is that.)
    const f = FLOOR_THEMES[1]!;
    expect(compositeGround(f)).toBe('#e4b3b6');
    expect(contrastRatio(f.accent, compositeGround(f))).toBeCloseTo(5.175, 2);
    // On the bare white it is far roomier: (0.913775 + 0.05) / 0.110357 = 8.7333.
    expect(contrastRatio(f.accent, f.bg)).toBeCloseTo(8.733, 2);
    // ...and the body ink on the composite, the other thing the fleck alpha is capped by:
    // #15171d on #e4b3b6 = 9.74:1, clear of AAA.
    expect(contrastRatio(f.ink, compositeGround(f))).toBeCloseTo(9.744, 2);
  });

  it('floor 3’s haze composite and its accent land where the hand computation says', () => {
    //   composite = 0.2 * 189 + 0.8 * 20 = 37.8 + 16 = 53.8 -> 54 per channel = #363636
    //   L(#363636): 54/255 = 0.211765 -> ((0.211765 + 0.055)/1.055)^2.4 = 0.036889
    //   accent #b8b8b8, L = 0.479320 (above): 0.529320 / 0.086889 = 6.0919
    //   ink #dcdcdc, L = 0.715694:            0.765694 / 0.086889 = 8.8123
    const f = FLOOR_THEMES[2]!;
    expect(compositeGround(f)).toBe('#363636');
    expect(contrastRatio(f.accent, compositeGround(f))).toBeCloseTo(6.092, 2);
    expect(contrastRatio(f.ink, compositeGround(f))).toBeCloseTo(8.812, 2);
  });
});

describe('the five environments are genuinely distinguishable', () => {
  it('no two floors share a ground, an ink, or a texture', () => {
    expect(new Set(FLOOR_THEMES.map((f) => f.bg)).size).toBe(5);
    expect(new Set(FLOOR_THEMES.map((f) => f.ink)).size).toBe(5);
    expect(new Set(FLOOR_THEMES.map((f) => f.texture.kind)).size).toBe(5);
  });

  it('and no two grounds are merely nominally different', () => {
    // Five near-blacks can all be distinct hex strings and still look identical. The rule,
    // borrowed from the pale-floors argument above: any two grounds must differ by at least
    // 1.25x in LINEAR light, or sit on opposite sides of neutral in temperature. A WCAG
    // contrast ratio is the wrong metric here — every pair of near-blacks scores ~1.0 on it,
    // so it would call this test green whatever the values were.
    const temperature = (hex: string): number => {
      const { r, b } = hexToRgb(hex);
      return Math.sign(r - b);
    };
    for (let i = 0; i < FLOOR_THEMES.length; i += 1) {
      for (let j = i + 1; j < FLOOR_THEMES.length; j += 1) {
        const a = FLOOR_THEMES[i]!;
        const b = FLOOR_THEMES[j]!;
        const la = relativeLuminance(a.bg);
        const lb = relativeLuminance(b.bg);
        const lightness = Math.max(la, lb) / Math.min(la, lb);
        const separated = lightness >= 1.25 || temperature(a.bg) !== temperature(b.bg);
        expect(
          separated,
          `${a.name} (${a.bg}) and ${b.name} (${b.bg}) are ${lightness.toFixed(3)}x apart in ` +
            'light and the same temperature — the descent stops being visible here',
        ).toBe(true);
      }
    }
  });

  it('the Angelic Underground is the only WARM ground — the one floor that is not a lie', () => {
    // WORLD.md §6 [LOCKED]: floor 4 reveals where every other stage distorts, and the angels
    // are real. Warm against four cold grounds is that fact, in the palette.
    const warm = FLOOR_THEMES.filter((f) => {
      const { r, b } = hexToRgb(f.bg);
      return r > b;
    });
    expect(warm.map((f) => f.name)).toEqual(['Angelic Underground']);
  });

  it('the True Void is the darkest ground by a wide margin — absence, not destruction', () => {
    const byLight = [...FLOOR_THEMES].sort(
      (a, b) => relativeLuminance(a.bg) - relativeLuminance(b.bg),
    );
    expect(byLight[0]!.name).toBe('True Void');
    // Not merely darkest: less than half the light of the next floor down the list, so the
    // last descent reads as something being taken away rather than a shade adjustment.
    expect(
      relativeLuminance(byLight[1]!.bg) / relativeLuminance(byLight[0]!.bg),
    ).toBeGreaterThan(2);
  });

  // REVISED 2026-09-12 (`floor-looks`): this read "the Ash City is the palest ground". The
  // Entrance is now white, so it is palest by a mile; the ash claim is about the DARK floors.
  it('the Entrance is the palest ground of all — the white-out', () => {
    const byLight = [...FLOOR_THEMES].sort((a, b) => relativeLuminance(b.bg) - relativeLuminance(a.bg));
    expect(byLight[0]!.name).toBe('Entrance to the Void');
  });

  it('and the Ash City is the palest DARK ground — the ash is over everything', () => {
    const dark = FLOOR_THEMES.filter((f) => f.ground === 'dark');
    const byLight = [...dark].sort((a, b) => relativeLuminance(b.bg) - relativeLuminance(a.bg));
    expect(byLight[0]!.name).toBe('Ash City');
    // In linear light: #141414 is 0.006995; the Undercity #060a09 0.002755, the Angelic
    // Underground #0d0b07 0.003403, the True Void #030304 0.000932 — so the ash ground carries
    // 2.54x, 2.06x and 7.50x their light.
    const ash = relativeLuminance(FLOOR_THEMES[2]!.bg);
    expect(ash / relativeLuminance(FLOOR_THEMES[0]!.bg)).toBeCloseTo(2.54, 2);
    expect(ash / relativeLuminance(FLOOR_THEMES[3]!.bg)).toBeCloseTo(2.06, 2);
    expect(ash / relativeLuminance(FLOOR_THEMES[4]!.bg)).toBeCloseTo(7.50, 1);
  });

  it('the Entrance’s white is COOL, so the Angelic Underground stays the only warm ground', () => {
    // #f4f5f9: blue 249 leads red 244 by 5.
    const { r, b } = hexToRgb(FLOOR_THEMES[1]!.bg);
    expect(b - r).toBe(5);
  });
});

describe('high contrast defeats every floor, on all five', () => {
  // The five environments are bold on purpose. That is only a safe thing to ship if the
  // player can switch them off, so this is a real accessibility feature and it is gated as
  // one. `settings-model.test.ts` proves `settingsVars` actually EMITS these values and
  // zeroes the texture; this proves the values are worth emitting.
  it('white on black beats every floor’s own body ratio', () => {
    const hc = contrastRatio(HIGH_CONTRAST.ink, HIGH_CONTRAST.bg);
    for (const floor of FLOOR_THEMES) {
      const normal = Math.min(
        contrastRatio(floor.ink, floor.bg),
        contrastRatio(floor.ink, compositeGround(floor)),
      );
      expect(hc, `${floor.name}: high contrast is not an improvement`).toBeGreaterThan(normal);
    }
    // ...and it is the theoretical maximum, so no floor could ever beat it by accident.
    expect(hc).toBeCloseTo(21, 2);
  });

  it('and raises the dimmed ink, the faint ink and the rules as well', () => {
    for (const floor of FLOOR_THEMES) {
      expect(
        contrastRatio(HIGH_CONTRAST.inkDim, HIGH_CONTRAST.panel),
        `${floor.name}: dimmed ink`,
      ).toBeGreaterThan(contrastRatio(floor.inkDim, floor.panel));
    }
    // The faint ink is documented as "deliberately below AA — decorative only" in normal
    // mode. In high contrast it must stop being decorative and clear AA.
    expect(contrastRatio(PALETTE.inkFaint, PALETTE.panel)).toBeLessThan(AA);
    expect(contrastRatio(HIGH_CONTRAST.inkFaint, HIGH_CONTRAST.panel)).toBeGreaterThanOrEqual(AA);
    // Panel borders are what tell a panel from the page. At 1px they need to be seen.
    expect(contrastRatio(HIGH_CONTRAST.rule, HIGH_CONTRAST.bg)).toBeGreaterThan(
      contrastRatio(PALETTE.rule, PALETTE.bg),
    );
    expect(contrastRatio(HIGH_CONTRAST.ruleStrong, HIGH_CONTRAST.bg)).toBeGreaterThan(
      contrastRatio(HIGH_CONTRAST.rule, HIGH_CONTRAST.bg),
    );
  });

  it('and every floor’s accent gets MORE legible, not less', () => {
    // The accent survives high contrast (the floor name carries the state, per UI-DESIGN
    // §11; the colour is reinforcement). It must not be the one thing that got worse.
    //
    // ⚠ RE-POINTED 2026-09-12 (`floor-looks`) at the accent high contrast REALLY PAINTS — what
    // `settingsVars` emits — rather than at `floor.accent`. On the light floor those differ:
    // its deep red is 2.11:1 on black, so high contrast resolves it to `accentOnBlack`
    // (#ff3b2f, 5.92:1), which is MORE legible than the red's normal-mode worst case of 5.18.
    // Measuring `floor.accent` on black here would judge a colour the screen never shows.
    for (const floor of FLOOR_THEMES) {
      const before = Math.min(
        contrastRatio(floor.accent, floor.bg),
        contrastRatio(floor.accent, compositeGround(floor)),
      );
      const painted = settingsVars({ ...DEFAULT_SETTINGS, contrast: 'high' }, floor.place)['--void-accent']!;
      const after = contrastRatio(painted, HIGH_CONTRAST.bg);
      expect(after, `${floor.name}: accent ${painted} under high contrast`).toBeGreaterThan(before);
      expect(after).toBeGreaterThanOrEqual(AA);
    }
    // ...and on the light floor it really is the swapped red, or the loop above proved nothing new.
    expect(settingsVars({ ...DEFAULT_SETTINGS, contrast: 'high' }, 1)['--void-accent']).toBe('#ff3b2f');
  });

  it('and its three roles are legible on its black — floor 2’s own dark roles would not be', () => {
    // HIGH_CONTRAST carries the dark-floor roles, hand-derived on black (L / 0.05 + 1):
    //   harm #e0574f: L = 0.2126*0.745404 + 0.7152*0.095307 + 0.0722*0.078187 = 0.232282 -> 5.6456
    //   heal #78b98a: L = 0.2126*0.187821 + 0.7152*0.485150 + 0.0722*0.254152 = 0.405260 -> 9.1052
    //   foe  #c98a3a: L = 0.2126*0.584078 + 0.7152*0.254152 + 0.0722*0.042311 = 0.309000 -> 7.1800
    expect(contrastRatio(HIGH_CONTRAST.harm, HIGH_CONTRAST.bg)).toBeCloseTo(5.646, 2);
    expect(contrastRatio(HIGH_CONTRAST.heal, HIGH_CONTRAST.bg)).toBeCloseTo(9.105, 2);
    expect(contrastRatio(HIGH_CONTRAST.foe, HIGH_CONTRAST.bg)).toBeCloseTo(7.180, 2);
    // THE CONTROL: floor 2's own roles would have failed there, so the swap is load-bearing.
    const f = FLOOR_THEMES[1]!;
    for (const role of [f.harm, f.heal, f.foe]) {
      expect(contrastRatio(role, HIGH_CONTRAST.bg), `${role} on black`).toBeLessThan(AA);
    }
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

  it('and nothing in the game is set below 11px', () => {
    // The floor, asserted at the SINGLE SOURCE rather than screen by screen: `styleDiscipline
    // .test.ts` separately forbids any `font-size` in any stylesheet from carrying a px
    // literal, so every size the game paints comes from this scale. The two together are what
    // make "no text below a minimum size" a fact instead of a habit.
    const smallest = Math.min(
      ...[TYPE.xs, TYPE.sm, TYPE.md, TYPE.base, TYPE.lg, TYPE.xl, TYPE.xxl].map(px),
    );
    expect(smallest).toBeGreaterThanOrEqual(11);
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

/**
 * A stylesheet as the BROWSER sees it: comments removed. Both scans below must judge the
 * rules that actually ship, not the prose around them — otherwise a comment mentioning
 * `--void-accent:` would fail the build, and a typo inside a commented-out line would too.
 */
function shippingCss(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Matches a custom-property DECLARATION, and never a `var()` read.
 *
 * `(?:^|[{;])` is a declaration BOUNDARY — the only three places a CSS declaration can
 * legally begin: opening a block, after the previous declaration's semicolon, or at the
 * start of a line. Anchoring on `^` ALONE (the first version of this guard) was too strict:
 * it only saw declarations that begin a line, so the single-line rule
 * `.x { --void-accent: #fff; }` — which is this codebase's own house style — slipped past.
 *
 * It cannot fire on a read: in `color: var(--void-ink)` the character before the name is
 * `(`, and `\s*` matches only whitespace, so no start position can reach it. The trailing
 * `\s*:` is a second, independent guard — a line-leading name inside a wrapped
 * `var(\n  --void-x\n)` still fails, because the next non-space character is `)`, not `:`.
 */
const DECLARATION = /(?:^|[{;])\s*(--void-[a-zA-Z0-9-]+)\s*:/gm;

/** Matches a `var(--void-*)` READ, anywhere — deliberately unanchored. */
const REFERENCE = /var\(\s*(--void-[a-zA-Z0-9-]+)/g;

/**
 * THE ONE CLASS OF `--void-*` PROPERTY THAT IS NOT A TOKEN, named exhaustively.
 *
 * Added by `layout-breathing-room` (2026-09-09). `game.css` drives its two stage layouts by
 * redeclaring six properties per mode -- that is the entire mechanism: one set of rules reads
 * them, and a mode is a change of six values rather than a second copy of the layout.
 *
 * They cannot live in `tokens.ts`, and the reason is not convenience. `themeVars` is a flat,
 * global table written onto `<html>`; these are per-MODE values that differ between
 * `[data-layout='side']` and `[data-layout='wide']` on the same page at the same moment. A
 * token that has two values at once is not a token.
 *
 * ⚠ WHY THIS IS AN ALLOW-LIST OF EXACT NAMES AND NOT A PATTERN. `--void-layout-*` as a prefix
 * rule would wave through `--void-layout-typo` and every future misspelling with it, which is
 * how an exception quietly becomes a hole. Every name here is checked BOTH ways by the test
 * below: each must really be declared in `game.css`, and none may collide with a real token.
 */
const LAYOUT_PROPERTIES = new Set([
  '--void-choices-w',
  '--void-layout-cols',
  '--void-layout-rows',
  '--void-column-max',
  '--void-prose-floor',
  '--void-log-cap',
  '--void-log-floor',
]);

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
      for (const match of shippingCss(file).matchAll(REFERENCE)) {
        references += 1;
        const name = match[1]!;
        if (LAYOUT_PROPERTIES.has(name)) continue; // declared in game.css, not a token
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
      for (const match of shippingCss(file).matchAll(DECLARATION)) {
        if (LAYOUT_PROPERTIES.has(match[1]!)) continue; // a stage-layout value, not a token
        declarations.push(`${basename(file)} -> ${match[1]!}`);
      }
    }
    expect(declarations, `token(s) redefined in CSS: ${declarations.join(', ')}`).toEqual([]);
  });

  // =======================================================================================
  // THE EXCEPTION IS BOUNDED AT BOTH ENDS. Two exemptions were just carved into the guards
  // above, so the exempt set itself is now under guard: every name in it must really be a
  // declared stage-layout value, and none of them may be a token. Without these, the
  // allow-list could rot into a licence to redeclare anything.
  // =======================================================================================

  it('every exempted property is really DECLARED, in game.css and nowhere else', () => {
    const declaredIn = new Map<string, Set<string>>();
    for (const file of files) {
      for (const match of shippingCss(file).matchAll(DECLARATION)) {
        const name = match[1]!;
        if (!declaredIn.has(name)) declaredIn.set(name, new Set());
        declaredIn.get(name)!.add(basename(file));
      }
    }
    for (const name of LAYOUT_PROPERTIES) {
      expect(
        declaredIn.has(name),
        `${name} is exempted from the token guards and declared by no stylesheet — the ` +
          'exemption list has rotted, and it is now a licence to redeclare a real token',
      ).toBe(true);
      expect([...declaredIn.get(name)!], `${name} is declared outside game.css`).toEqual([
        'game.css',
      ]);
    }
  });

  it('and none of them collides with a token the theme writes', () => {
    // If one ever did, the CSS declaration would silently beat `theme.ts` on that name —
    // exactly the drift the guard above exists to prevent, smuggled in through the exemption.
    for (const name of LAYOUT_PROPERTIES) {
      expect(
        defined.has(name),
        `${name} is BOTH a theme token and an exempted layout value — the CSS declaration ` +
          'would silently override what theme.ts writes',
      ).toBe(false);
    }
    expect(LAYOUT_PROPERTIES.size).toBe(7);
  });

  it('...and a misspelling of one is NOT exempt (the exemption is by exact name)', () => {
    // The shape a prefix rule would have waved through. `--void-prose-flor` reads as nothing,
    // so the prose floor silently disappears; it must still be caught as an unknown property.
    for (const typo of ['--void-prose-flor', '--void-layout-col', '--void-choices-width']) {
      expect(LAYOUT_PROPERTIES.has(typo), `${typo} is treated as a known layout value`).toBe(
        false,
      );
      expect(defined.has(typo), `${typo} resolves as a token`).toBe(false);
    }
  });

  // The regexes above are the load-bearing part of this guard, and the first version of the
  // declaration one was wrong in a way the shipping stylesheets could not reveal (they
  // contain no declarations at all, so it passed while catching nothing). These cases pin
  // the behaviour directly, in every form the codebase actually writes CSS.
  it('catches a declaration in EVERY form, including the single-line house style', () => {
    const caught = (css: string): string[] =>
      [...css.matchAll(DECLARATION)].map((m) => m[1]!);

    // The house style throughout components.css and game.css — the form that was missed.
    expect(caught('.void-rogue { --void-accent: #ffffff; }')).toEqual(['--void-accent']);
    // Minified / no whitespace at all.
    expect(caught('.rogue{--void-accent:#fff}')).toEqual(['--void-accent']);
    // Second and later declarations in a single-line rule, after a semicolon.
    expect(caught('.rogue { color: red; --void-ink: #fff; }')).toEqual(['--void-ink']);
    // The multi-line form (all the first version of this guard could see).
    expect(caught('.rogue {\n  --void-bg: #000;\n}')).toEqual(['--void-bg']);
    // Several at once, mixed forms.
    expect(caught('.a{--void-x:1px;--void-y:2px}')).toEqual(['--void-x', '--void-y']);
  });

  it('never mistakes a var() READ for a declaration', () => {
    const caught = (css: string): string[] =>
      [...css.matchAll(DECLARATION)].map((m) => m[1]!);

    expect(caught('.a { color: var(--void-ink); }')).toEqual([]);
    expect(caught('.a{color:var(--void-ink)}')).toEqual([]);
    expect(caught('.a {\n  color: var(--void-ink);\n}')).toEqual([]);
    // A fallback, and a nested read — both still reads.
    expect(caught('.a { color: var(--void-ink, #fff); }')).toEqual([]);
    expect(caught('.a { color: var(--void-a, var(--void-b)); }')).toEqual([]);
    // A read wrapped so the NAME begins its own line — the trailing `:` is what saves this.
    expect(caught('.a {\n  color: var(\n    --void-ink\n  );\n}')).toEqual([]);
  });

  it('judges the shipping rules, not the prose around them', () => {
    // A commented-out declaration is not a declaration; a token named in an explanatory
    // comment is not a redefinition. Neither may fail the build.
    const commented = '/* --void-accent: #fff; is written by theme.ts */\n.a { color: red; }';
    expect([...commented.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(DECLARATION)]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE TYPEFACE COUPLING (PLAN.md #16) AND ITS LICENCE. The family name is a bare string
// written in two files that nothing links: `FONT_MONO` in tokens.ts, and
// `@font-face { font-family: ... }` in fonts.css. Misspell either and the browser falls back
// to the system monospace SILENTLY — no type error, no runtime error, and the game simply
// looks different on every machine, which is the entire problem bundling a face solves.
//
// These sit at the END of the file because they read the stylesheets through `SRC_ROOT` /
// `shippingCss`, declared above. A `describe` body runs at COLLECTION time, so placing them
// higher would hit the temporal dead zone and fail the file with a ReferenceError.
// ---------------------------------------------------------------------------

describe('the bundled face is wired to the font stack', () => {
  const FONTS_CSS = readFileSync(join(SRC_ROOT, 'render', 'fonts.css'), 'utf8');
  const declared = [...shippingCss(join(SRC_ROOT, 'render', 'fonts.css')).matchAll(
    /@font-face\s*\{[^}]*?font-family:\s*(['"])([^'"]+)\1/g,
  )].map((m) => m[2] as string);

  it('parses a family out of every @font-face (or the comparison below reads nothing)', () => {
    // Four faces: regular, medium, bold, and a regular italic.
    expect(declared.length, 'no @font-face family parsed out of fonts.css').toBe(4);
    expect(FONTS_CSS).toContain('woff2');
  });

  it('the first family in FONT_MONO EQUALS the family fonts.css declares', () => {
    const primary = primaryFontFamily(FONT_MONO);
    for (const family of declared) {
      expect(
        family,
        `fonts.css declares "${family}" but the font stack asks for "${primary}" — every ` +
          'glyph in the game would render in the system monospace instead',
      ).toBe(primary);
    }
    expect(primary).toBe('JetBrains Mono');
  });

  it('and the parser really finds the first family, in each spelling a stack can take', () => {
    // Non-vacuity for `primaryFontFamily`: a parser that returned the empty string for
    // everything would make the equality above pass whenever the CSS was also empty.
    expect(primaryFontFamily('"JetBrains Mono", monospace')).toBe('JetBrains Mono');
    expect(primaryFontFamily("'JetBrains Mono',monospace")).toBe('JetBrains Mono');
    expect(primaryFontFamily('  ui-monospace , monospace ')).toBe('ui-monospace');
    expect(primaryFontFamily('monospace')).toBe('monospace');
  });

  it('every face loads a woff2 by a RELATIVE url — an absolute one breaks under file://', () => {
    // The packaged build loads `dist/desktop.html` off disk. `url(/assets/…)` resolves to the
    // filesystem ROOT there and 404s on every machine, so the game ships with no typeface and
    // no error. `distFont.test.ts` proves the same thing about the EMITTED css; this proves it
    // about the source, where the mistake is actually made.
    const urls = [...shippingCss(join(SRC_ROOT, 'render', 'fonts.css')).matchAll(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    )].map((m) => m[2] as string);
    expect(urls.length, 'no url() found in fonts.css').toBe(4);
    for (const url of urls) {
      expect(url.startsWith('/'), `${url} is an absolute path`).toBe(false);
      expect(url.endsWith('.woff2'), `${url} is not a woff2`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// THE LICENCE (PLAN.md #14 calls licensing a release blocker, and `ART-BIBLE.md` §11's
// "verified free to bundle" cited a table row rather than a licence file until this unit).
// ---------------------------------------------------------------------------

describe('the bundled font ships with its licence', () => {
  const REPO_ROOT = join(SRC_ROOT, '..');
  const FONT_DIR = join(SRC_ROOT, 'assets', 'fonts', 'jetbrains-mono');

  it('the OFL text is in the tree, beside the fonts it covers', () => {
    const ofl = readFileSync(join(FONT_DIR, 'OFL.txt'), 'utf8');
    expect(
      ofl,
      'src/assets/fonts/jetbrains-mono/OFL.txt no longer contains the licence text — a ' +
        'licence CLAIM with no licence file is an assertion, not a fact',
    ).toContain('SIL OPEN FONT LICENSE Version 1.1');
    // The two clauses that make bundling legal at all: redistribution with software, and
    // the requirement that this notice travel with it.
    expect(ofl).toContain('Copyright');
    expect(ofl.length).toBeGreaterThan(2000);
  });

  it('and the four faces it covers are really there', () => {
    const faces = readdirSync(FONT_DIR).filter((n) => n.endsWith('.woff2'));
    expect(faces.length, 'the vendored woff2 files are gone').toBe(4);
    for (const face of faces) {
      expect(face.startsWith('jetbrains-mono-'), face).toBe(true);
    }
  });

  it('THIRD-PARTY-NOTICES.md names the font, its licence and where the text lives', () => {
    const notices = readFileSync(join(REPO_ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(notices).toContain('JetBrains Mono');
    expect(notices).toContain('SIL Open Font License');
    expect(
      notices,
      'the notices file does not point at the licence text it is summarising',
    ).toContain('src/assets/fonts/jetbrains-mono/OFL.txt');
  });
});
