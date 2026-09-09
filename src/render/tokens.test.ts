import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import {
  PALETTE,
  FLOOR_THEMES,
  FLOOR_SCOPED_VARS,
  HIGH_CONTRAST,
  ENTRANCE_ALTERNATIVE_WHITE,
  SPACE,
  TYPE,
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
        `place ${floor.place} / ART-BIBLE floor ${floor.place + 1} (${floor.name}): ` +
          `accent ${floor.accent} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary ink is comfortably legible on the background (>= 7:1)', () => {
    expect(contrastRatio(PALETTE.ink, PALETTE.bg)).toBeGreaterThanOrEqual(7);
  });

  it('dimmed ink stays legible on a panel (>= 4.5:1)', () => {
    expect(contrastRatio(PALETTE.inkDim, PALETTE.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('the tightest accent is the Entrance scarlet at the hand-computed ~5.67:1', () => {
    // FLOOR_THEMES[1] — place 1, which is ART-BIBLE floor 2, the Entrance to the Void.
    // Entrance scarlet #ff3b2f. Red carries only 0.2126 of the luminance weight, so a
    // saturated red is always the tightest colour in a palette like this:
    //   R 255 -> 1.0            G 59 -> 0.043733        B 47 -> 0.028428
    //   L = 0.2126*1.0 + 0.7152*0.043733 + 0.0722*0.028428 = 0.245930
    //   (0.245930 + 0.05) / (0.002190 + 0.05) = 0.295930 / 0.052190 = 5.6702
    // Pinned so a future palette tweak that erodes the margin shows up in the diff rather
    // than silently sliding toward the 4.5 floor.
    expect(contrastRatio(FLOOR_THEMES[1]!.accent, PALETTE.bg)).toBeCloseTo(5.670, 2);
  });

  it('the Undercity green and the Ash City grey land where the hand computation says', () => {
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
// NUMBERING, because these two schemes are off by one and the confusion is easy:
// `place` is the ENGINE's 0-based index (state.place, and the array index here);
// docs/ART-BIBLE.md numbers the floors 1-5. place 2 IS ART-BIBLE floor 3, the Ash City.
// Below, floors are named rather than numbered wherever a name will do.
describe('the pale floors stay distinguishable (docs/ART-BIBLE.md §4)', () => {
  const ASH = FLOOR_THEMES[2]!.accent; // place 2 = floor 3: cold neutral grey, drained
  const BONE = FLOOR_THEMES[3]!.accent; // place 3 = floor 4: warm bone, sacred, lit

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

  it("the Entrance scarlet cannot be mistaken for the True Void arterial red", () => {
    // FLOOR_THEMES[1] (place 1 = ART-BIBLE floor 2, Entrance) against FLOOR_THEMES[4]
    // (place 4 = ART-BIBLE floor 5, True Void).
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

  it('four textures ADD light (so they cost contrast) and the True Void SUBTRACTS it', () => {
    // The direction is the meaning, not a detail: fog, static, ash and the sacred glow all
    // lie on top of the ground and make it paler, which is precisely why the gate has to run
    // against the composite. The True Void's is a vignette in pure black — absence, not
    // destruction — so it is the one floor where the atmosphere makes text easier to read.
    for (const floor of FLOOR_THEMES) {
      const bare = relativeLuminance(floor.bg);
      const composited = relativeLuminance(compositeGround(floor));
      if (floor.texture.kind === 'absence') {
        expect(composited, `${floor.name} should be darkened by its texture`).toBeLessThan(bare);
      } else {
        expect(composited, `${floor.name} should be lightened by its texture`).toBeGreaterThan(bare);
      }
    }
    // ...and exactly one floor is the subtracting one, so the branch above cannot be vacuous.
    expect(FLOOR_THEMES.filter((f) => f.texture.kind === 'absence')).toHaveLength(1);
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

  it('and harm still reads as harm on all five floors', () => {
    // `--void-harm` and `--void-heal` are deliberately floor-INDEPENDENT, which means they
    // were never re-checked against four new grounds. A damage number nobody can read on
    // floor 3 is a rules bug wearing a palette's clothes.
    for (const floor of FLOOR_THEMES) {
      for (const role of [PALETTE.harm, PALETTE.heal, PALETTE.foe]) {
        expect(
          Math.min(contrastRatio(role, floor.bg), contrastRatio(role, floor.panel)),
          `${floor.name}: ${role}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
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

  it('the Ash City is the palest ground — the ash is over everything', () => {
    const byLight = [...FLOOR_THEMES].sort(
      (a, b) => relativeLuminance(b.bg) - relativeLuminance(a.bg),
    );
    expect(byLight[0]!.name).toBe('Ash City');
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
    for (const floor of FLOOR_THEMES) {
      const before = Math.min(
        contrastRatio(floor.accent, floor.bg),
        contrastRatio(floor.accent, compositeGround(floor)),
      );
      const after = contrastRatio(floor.accent, HIGH_CONTRAST.bg);
      expect(after, `${floor.name}: accent`).toBeGreaterThan(before);
      expect(after).toBeGreaterThanOrEqual(AA);
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
