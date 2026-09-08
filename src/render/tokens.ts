// Design tokens for The Void's UI — PURE, Kaplay-free, DOM-free (M-UI2 `ui-foundation`).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: this module imports NOTHING — not Kaplay, not the DOM,
//    not even `src/game`. It is plain data plus pure functions, so it runs and is
//    unit-tested headlessly under Vitest's `node` environment.
//  - Single source of truth: every colour, size and spacing value in the game is
//    defined HERE, exactly once. CSS never hard-codes a colour; it reads the
//    `--void-*` custom properties that `theme.ts` writes from this table at boot.
//    (One documented exception: `html { background }` in tokens.css repeats
//    PALETTE.bg as a literal so there is no white flash before the applier runs.)
//
// WHY A TS MODULE RATHER THAN CSS-ONLY: the Kaplay canvas layer takes colours as
// NUMBERS. If CSS owned the palette, the canvas would have to read values back with
// `getComputedStyle` — a DOM read, unavailable headlessly, and impossible to unit-test.
// Exporting `hexToRgb` lets the canvas and the DOM agree by construction.
//
// ART DIRECTION (docs/UI-DESIGN.md §5) — "elevated terminal": near-black ground,
// monospace throughout, heavy rules, wide letter-spacing, flat panels, zero ornament,
// zero border-radius. The palette is deliberately desaturated EXCEPT the per-floor
// accent, which is the one colour that marks the descent.

/**
 * The floor-independent palette. Every value is an sRGB hex string.
 *
 * ⚠ AMENDED BY `visual-identity` (2026-09-07). `bg`, `panel`, `panelRaised`, `ink` and
 * `inkDim` are NO LONGER what the running game paints — the FLOOR owns those now
 * (`FLOOR_THEMES` below, and the author's direction recorded there). What survives here:
 *
 *  - `bg` is the BOOT ground: the one colour CSS can paint before any script runs. It is
 *    duplicated as a literal in `tokens.css` for exactly that frame, and it is the mean
 *    near-black of the five floors, so the hand-off to a floor ground is imperceptible.
 *  - `ink`, `inkDim`, `panel`, `panelRaised` remain the ANCHOR values the pre-existing
 *    contrast tests measure against, and the reference the five floor inks were derived
 *    from. They are still the honest description of "the interface's default".
 *  - `rule`, `ruleStrong`, `inkFaint`, `harm`, `heal`, `foe` are genuinely floor-independent
 *    and are still emitted verbatim by `themeVars`. Harm must read as harm on every floor.
 */
export const PALETTE = {
  /** The BOOT ground — near-black with a faint blue cast. Replaced per floor at runtime. */
  bg: '#07070a',
  /** A flat panel sitting on the ground. */
  panel: '#0c0c11',
  /** A panel that needs to read as nearer the viewer (selected, focused). */
  panelRaised: '#12121a',
  /** Hairline divider. */
  rule: '#23232e',
  /** Emphasis divider / panel border. */
  ruleStrong: '#3a3a4a',
  /** Primary text. */
  ink: '#e8e8ee',
  /** Secondary text (labels, units, counts). */
  inkDim: '#8a8a98',
  /** Tertiary text (disabled, placeholder). Deliberately below AA — decorative only. */
  inkFaint: '#55555f',
  /** Damage / danger / HP loss. */
  harm: '#e0574f',
  /** Healing / gain / safety. */
  heal: '#78b98a',
  /** The enemy side. */
  foe: '#c98a3a',
} as const;

/**
 * How a floor's atmosphere is PAINTED. The kind drives the geometry (CSS picks the gradient
 * or repeating pattern from it); `ink` and `opacity` drive the colour, and are the two
 * numbers the contrast gate composites over the ground.
 *
 * `opacity` is the PEAK alpha the layer ever reaches, so `compositeGround` below is the
 * worst case a body glyph is ever read against, not an average.
 */
export type TextureKind = 'fog' | 'static' | 'ash' | 'glow' | 'absence';

export interface FloorTexture {
  kind: TextureKind;
  /** The colour laid over the ground. An sRGB hex string. */
  ink: string;
  /** Peak alpha, 0..1. Zero would mean "no atmosphere", which no floor is allowed to be. */
  opacity: number;
}

/**
 * One floor of the descent — a whole ENVIRONMENT, not just an accent.
 *
 * ⚠ THE SHAPE CHANGED 2026-09-07 (`visual-identity`), on the author's direction, and the
 * change is deliberate rather than incremental:
 *
 *   > "each floor has a distinct font color, and background color with a certain level of
 *   >  texture, we can use the atmospheric css option in conjunction"
 *
 * Before, one near-black ground carried five accents. Now each floor owns its ground, its
 * panels, its body ink, its secondary ink and its texture. **The descent is visible.**
 *
 * WHAT THIS COSTS AND HOW IT IS PAID. Five ink/ground pairings are five chances to ship
 * something unreadable, so every pairing is machine-gated in `tokens.test.ts` against the
 * WCAG constants — 7:1 for body ink, 4.5:1 for the accent and the dimmed ink — and gated
 * against the TEXTURED COMPOSITE as well as the bare ground, because the atmosphere sits
 * behind body text and a check that ignored it would be measuring a screen nobody sees.
 * Where taste and the gate disagreed, the palette moved: see the Entrance note below.
 */
export interface FloorTheme {
  /** 0..4 — the engine's `state.place` (act - 1). */
  place: number;
  name: string;
  accent: string;
  /** The page ground for this floor. */
  bg: string;
  /** A flat panel on this floor's ground. */
  panel: string;
  /** A panel that must read as nearer the viewer. */
  panelRaised: string;
  /** Body text on this floor. */
  ink: string;
  /** Secondary text (labels, units, counts) on this floor. */
  inkDim: string;
  /** The atmosphere. */
  texture: FloorTexture;
}

/**
 * The five floors, in descent order. The accent is the ONLY colour that changes as the
 * player descends, so it carries the whole sense of place. Each value is gated by the
 * contrast test in tokens.test.ts (>= 4.5:1 against PALETTE.bg) — taste proposes, the
 * measured ratio disposes.
 *
 * AUTHORITY: `docs/ART-BIBLE.md` §4 "The floor colour ramp" [LOCKED 2026-08-25], which
 * records the author's own words and OVERRULES the earlier "ash-orange" in
 * `docs/UI-DESIGN.md` §5 that the first version of this table was derived from.
 *
 * NUMBERING — the two schemes are off by one, so every mention below is explicit: "floor N"
 * always means the 1-BASED numbering the design docs use, while `place` is the engine's
 * 0-BASED index (`state.place`, and the array index here). ART-BIBLE floor N is `place` N-1;
 * the Ash City is floor 3 and `place` 2.
 *
 * THE PROBLEM THIS TABLE HAD TO SOLVE. Taken literally, three consecutive floors are pale:
 * floor 2 is "blinding white with red flecks", floor 3 is "purely white, grey and black",
 * floor 4 is "bone white". Three near-identical accents would defeat the entire point of a
 * per-floor accent, which is to mark the descent. They are separated on two axes that are
 * both thematically load-bearing rather than merely convenient:
 *
 *   - TEMPERATURE separates floors 3 and 4. Floor 3 is a COLD neutral grey — dead, drained,
 *     emptied. Floor 4 is a WARM bone — sacred, lit, alive. Cold against warm IS the
 *     difference between emptiness and grace (ART-BIBLE §4), so the palette is carrying the
 *     meaning, not just avoiding a collision. The two are near-mirror images about neutral:
 *     floor 3 is 18 points bluer than red, floor 4 is 19 points redder than blue.
 *   - LIGHTNESS separates them again, as a second guard: floor 3 sits at ~10:1 against the
 *     ground and floor 4 at ~15.5:1, so they differ even rendered in greyscale.
 *
 * FLOOR 2 — why the accent is the RED FLECK, not the blinding white. This was the hard one,
 * and the choice is deliberately easy to reverse (see ENTRANCE_ALTERNATIVE_WHITE below).
 * The white is the ENVIRONMENT; the red flecks are the thing that stands out in it — and
 * standing out is precisely a UI accent's job. Three reasons the fleck wins:
 *   1. `--void-ink` is already #e8e8ee, a near-white at 16.5:1. An accent of near-white
 *      would be almost exactly the colour of ordinary body text, so on floor 2 the UI would
 *      have no accent at all — the opposite of "the palette marks the descent".
 *   2. It leaves ONE pale stretch (floors 3-4, split by temperature) instead of three
 *      consecutive floors with no hue in the chrome.
 *   3. The descent then reads as a real progression — toxic, blood, ash, bone, artery —
 *      rather than green, white, white, white, red.
 * It must not be confused with floor 5's arterial red, so it is a brighter, far more
 * saturated, much less pink scarlet: fresh blood on white, against old blood in the dark.
 * The blinding white itself is not lost — it belongs to floor 2's BACKDROP art, which the
 * `canvas-layer` unit owns; this table only colours the interface chrome.
 */
export const FLOOR_THEMES: readonly FloorTheme[] = [
  // FLOOR 1 — THE UNDERCITY. "before": the last real place, and the interface says so by
  // being nearly the interface you already knew. The ground is the darkest green-black in
  // the set (green is the largest channel), because ART-BIBLE §4 is explicit that "the green
  // is what is in the water and the air, not what is on the signs" — so the toxicity is in
  // the GROUND and the FOG, never in signage. Ink is a faintly green-cool white.
  // Accent: "undercity is green and toxic" — an acid yellow-green, deliberately not the soft
  // sage of PALETTE.heal, so a status chip can never be misread.
  {
    place: 0,
    name: 'Undercity',
    accent: '#9dc043',
    bg: '#060a09',
    panel: '#0b100e',
    panelRaised: '#111815',
    ink: '#e6ece7',
    inkDim: '#89968e',
    texture: { kind: 'fog', ink: '#4f8f6a', opacity: 0.1 },
  },
  // FLOOR 2 — ENTRANCE TO THE VOID. "fracture": mirrors, doubles, static, signal.
  //
  // ⚠ THE ONE PLACE THE INTENDED PALETTE HAD TO MOVE TO PASS THE GATE, recorded because the
  // author asked for exactly this to be reported. The author's direction is "blinding white
  // with red flecks", so the first draft made this the LIGHTEST ground of the five. It fails:
  // the Entrance scarlet is the tightest colour in the whole palette (red carries only 0.2126
  // of the luminance weight), and lifting the ground under it pushed the accent to 4.32:1 —
  // under the 4.5 gate, with the focus ring riding on that accent. Lowering the gate was not
  // an option, so the palette moved.
  //
  // WHERE THE WHITE WENT INSTEAD, and why this is not a retreat: it went into the two
  // channels that can carry it without standing behind a red glyph. The INK is the brightest,
  // coldest white of the five floors, and the TEXTURE is a white static wash. The ground
  // stays the coldest of the five (blue leads red by 12) and second-lightest. The blinding
  // white itself was never the interface's to own — ART-BIBLE §3 gives it to floor 2's
  // BACKDROP ART, which `canvas-layer` (#7) owns; this table colours the chrome.
  {
    place: 1,
    name: 'Entrance to the Void',
    accent: '#ff3b2f',
    bg: '#0a0d16',
    panel: '#10141f',
    panelRaised: '#171c29',
    ink: '#f2f4fb',
    inkDim: '#98a0b4',
    texture: { kind: 'static', ink: '#e9edff', opacity: 0.07 },
  },
  // FLOOR 3 — THE ASH CITY. "grief", not fear (WORLD.md §6). "purely white gray and black,
  // the fire has settled already and it's just ash." The LIGHTEST ground of the five and a
  // cold neutral grey — the ash is over everything, so everything is a shade paler and a
  // shade colder. The ink is the DIMMEST of the five light inks for the same reason: nothing
  // here is sharp any more. Nothing glows; there is no ember left, so no warmth anywhere.
  {
    place: 2,
    name: 'Ash City',
    accent: '#aeb8c0',
    bg: '#101215',
    panel: '#16181c',
    panelRaised: '#1d2025',
    ink: '#d8dade',
    inkDim: '#8d9298',
    texture: { kind: 'ash', ink: '#b9bec6', opacity: 0.07 },
  },
  // FLOOR 4 — THE ANGELIC UNDERGROUND. "judgement", and the one stage that REVEALS rather
  // than distorts — the angels are real (WORLD.md §6, LOCKED). It is therefore the ONLY warm
  // ground in the game (red leads blue), the only luminous texture, and the only floor whose
  // atmosphere adds light rather than taking it away: "lit from within, not from any sky".
  // Warm bone ink and warm bone accent. If this floor ever reads as ironic, the art is wrong.
  {
    place: 3,
    name: 'Angelic Underground',
    accent: '#e6e2d3',
    bg: '#0d0b07',
    panel: '#14110b',
    panelRaised: '#1c1810',
    ink: '#f0ead8',
    inkDim: '#9b9483',
    texture: { kind: 'glow', ink: '#e6d9b0', opacity: 0.1 },
  },
  // FLOOR 5 — THE TRUE VOID. "absence, not destruction" — "there was less of you than you
  // thought". The darkest ground by a wide margin (a third of floor 1's light), and the only
  // texture that SUBTRACTS: a vignette in pure black that eats the edges of the screen, so
  // the interface is visibly smaller than it was. That is negative space and things missing,
  // which is what ART-BIBLE rule 3 demands, and it is the opposite of gore or ruin.
  // Accent: black cannot be an accent against a near-black interface, so the accent is the
  // thing burning in the dark. Deep and pink next to floor 2's fresh scarlet.
  {
    place: 4,
    name: 'True Void',
    accent: '#ef6076',
    bg: '#030304',
    panel: '#08080a',
    panelRaised: '#0e0e11',
    ink: '#ded7d9',
    inkDim: '#8b8489',
    texture: { kind: 'absence', ink: '#000000', opacity: 0.55 },
  },
];

/**
 * THE ACCESSIBILITY OVERRIDE — what "high contrast" actually swaps in, for every floor.
 *
 * The five environments above are bold on purpose, and bold is only safe if there is a way
 * to turn it off. High contrast collapses all five onto one pure pairing, black and white,
 * and `settingsVars` also forces the texture opacity to zero — so the atmosphere is not
 * dimmed, it is GONE. The per-floor accent survives, because the accent is reinforcement
 * rather than information (`UI-DESIGN.md` §11) and the floor NAME carries the state; a
 * player who needs this setting still gets the floor tag in words.
 *
 * `tokens.test.ts` proves the pairing beats every floor's normal ratio on all five floors,
 * and that the texture really was ON before it was turned off.
 */
export const HIGH_CONTRAST = {
  bg: '#000000',
  panel: '#000000',
  panelRaised: '#101010',
  ink: '#ffffff',
  inkDim: '#dcdcdc',
  inkFaint: '#b0b0b0',
  rule: '#6e6e78',
  ruleStrong: '#a6a6b0',
} as const;

/**
 * The reversible half of the floor-2 decision, kept here so flipping it is a one-line edit
 * rather than a redesign: a blinding, cool white taken from floor 2's ground instead of its
 * flecks. It clears the contrast gate (~18:1) and is both brighter and cooler than floors 3
 * and 4, so the pale trio would still separate — a test pins all of that, so the swap is
 * pre-verified rather than a leap.
 *
 * KNOWN COST, and the reason it is not the default: at 18:1 it sits very close to
 * `PALETTE.ink` (16.5:1), so floor 2's chrome — title, focus ring, hover, chips — would read
 * as plain white text rather than as an accent.
 *
 * To adopt it, put this value on the Entrance to the Void entry above — `place` 1, which is
 * ART-BIBLE floor 2 — and update the two expected hexes in tokens.test.ts.
 */
export const ENTRANCE_ALTERNATIVE_WHITE = '#eef4ff';

/** Spacing scale, 4px base. Strictly increasing. */
export const SPACE = {
  s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '24px', s6: '32px', s7: '48px',
} as const;

/** Type scale. Strictly increasing. */
export const TYPE = {
  xs: '11px', sm: '12px', md: '13px', base: '15px', lg: '18px', xl: '24px', xxl: '34px',
} as const;

/** Letter-spacing scale — wide tracking is the core of the terminal look. */
export const TRACK = { tight: '0', wide: '0.08em', widest: '0.32em' } as const;

/** Rule weights and the (deliberately zero) corner radius — flat, unornamented. */
export const RULE = { hair: '1px', heavy: '2px', radius: '0' } as const;

/**
 * The single font stack. Monospace everywhere, narrative text included.
 *
 * THE FIRST FAMILY IS THE BUNDLED ONE (`PLAN.md` #16, `ART-BIBLE.md` §11). The four woff2
 * faces live in `src/assets/fonts/jetbrains-mono/` and are declared in
 * `src/render/fonts.css`; everything after it is the per-glyph fallback for codepoints
 * outside the vendored Latin subset, and the last-resort stack if the faces fail to load.
 *
 * ⚠ THE FAMILY NAME IS A STRING WRITTEN TWICE — here and in `fonts.css`'s `@font-face`.
 * Neither the compiler nor the runtime can see that coupling: misspell one and the browser
 * silently falls back to the system mono, on every machine, with no error anywhere. A test
 * in `tokens.test.ts` asserts the two strings are EQUAL, which is the only thing that can.
 */
export const FONT_MONO = '"JetBrains Mono", ui-monospace, "Cascadia Code", "Consolas", monospace';

/**
 * The first family named in a CSS font stack, unquoted. Pure string handling, exported so
 * the TS-to-CSS coupling test can compare it against `fonts.css` rather than re-implementing
 * the parse in the test (where a bug in the parse would make the guard pass vacuously).
 */
export function primaryFontFamily(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * The floor theme for an engine `place` — TOTAL and CLAMPED, so no caller can crash the
 * UI with an out-of-range or garbage floor index. A non-finite input (NaN/Infinity) and
 * anything below 0 resolve to floor 0; anything above 4 resolves to floor 4.
 */
export function floorTheme(place: number): FloorTheme {
  if (!Number.isFinite(place)) return FLOOR_THEMES[0] as FloorTheme;
  const i = Math.min(Math.max(Math.floor(place), 0), FLOOR_THEMES.length - 1);
  return FLOOR_THEMES[i] as FloorTheme;
}

/**
 * Every `--void-*` CSS custom property for a given floor, as plain data. `theme.ts` is the
 * only thing that writes these onto an element; everything else just reads `var(--void-*)`.
 * Returning plain data (rather than touching the DOM) is what makes the whole token layer
 * headlessly testable.
 */
export function themeVars(place: number): Record<string, string> {
  const floor = floorTheme(place);
  return {
    // FLOOR-SCOPED — the environment. Changing floor changes every one of these.
    '--void-bg': floor.bg,
    '--void-panel': floor.panel,
    '--void-panel-raised': floor.panelRaised,
    '--void-ink': floor.ink,
    '--void-ink-dim': floor.inkDim,
    '--void-texture-ink': floor.texture.ink,
    '--void-texture-opacity': String(floor.texture.opacity),
    // FLOOR-INDEPENDENT — harm must read as harm on every floor, and a rule is furniture.
    '--void-rule': PALETTE.rule,
    '--void-rule-strong': PALETTE.ruleStrong,
    '--void-ink-faint': PALETTE.inkFaint,
    '--void-harm': PALETTE.harm,
    '--void-heal': PALETTE.heal,
    '--void-foe': PALETTE.foe,
    '--void-accent': floor.accent,
    '--void-space-1': SPACE.s1,
    '--void-space-2': SPACE.s2,
    '--void-space-3': SPACE.s3,
    '--void-space-4': SPACE.s4,
    '--void-space-5': SPACE.s5,
    '--void-space-6': SPACE.s6,
    '--void-space-7': SPACE.s7,
    '--void-type-xs': TYPE.xs,
    '--void-type-sm': TYPE.sm,
    '--void-type-md': TYPE.md,
    '--void-type-base': TYPE.base,
    '--void-type-lg': TYPE.lg,
    '--void-type-xl': TYPE.xl,
    '--void-type-xxl': TYPE.xxl,
    '--void-track-tight': TRACK.tight,
    '--void-track-wide': TRACK.wide,
    '--void-track-widest': TRACK.widest,
    '--void-rule-hair': RULE.hair,
    '--void-rule-heavy': RULE.heavy,
    '--void-radius': RULE.radius,
    '--void-font-mono': FONT_MONO,
  };
}

/** An sRGB colour as three 0..255 channels. */
export interface Rgb { r: number; g: number; b: number }

/**
 * Parse `#rgb` or `#rrggbb` into 0..255 channels. Throws on anything else — a malformed
 * token is a build-time authoring bug, and failing loudly beats rendering an invisible
 * element. The Kaplay layer uses this to get numeric colours without reading the DOM.
 */
export function hexToRgb(hex: string): Rgb {
  const s = hex.trim().replace(/^#/, '');
  const full =
    s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * WCAG 2.x relative luminance of an sRGB colour (0 = black, 1 = white). Each channel is
 * linearised (the 0.03928 knee, then the 2.4 gamma curve) and weighted by the eye's
 * sensitivity: green dominates at 0.7152, red 0.2126, blue only 0.0722.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG contrast ratio between two colours: `(Llighter + 0.05) / (Ldarker + 0.05)`.
 * Ranges from 1 (identical colours) to 21 (white on black). Order-independent.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `over` composited onto `under` at `alpha` (0..1), as a hex string — plain source-over
 * alpha blending, per channel, rounded to the nearest 8-bit value.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A CONVENIENCE. The five-floor atmosphere is a coloured
 * layer sitting BEHIND body text. Gate the ink against the bare ground and you have measured
 * a screen the player never sees; the number is real and it is about the wrong thing —
 * exactly the family of mistake this project keeps writing down. `compositeGround` below
 * gives the gate the surface text is actually read against.
 *
 * `alpha` is clamped rather than validated: an out-of-range value is an authoring slip, and
 * clamping keeps the contrast gate computable (and therefore able to FAIL) rather than
 * throwing inside a test that is meant to be judging colours.
 */
export function blendHex(over: string, under: string, alpha: number): string {
  const a = Math.min(Math.max(Number.isFinite(alpha) ? alpha : 0, 0), 1);
  const o = hexToRgb(over);
  const u = hexToRgb(under);
  const channel = (x: number, y: number): string =>
    Math.round(a * x + (1 - a) * y)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(o.r, u.r)}${channel(o.g, u.g)}${channel(o.b, u.b)}`;
}

/**
 * The surface a glyph on this floor is ACTUALLY read against: the floor's ground with its
 * atmosphere composited over it at the texture's peak alpha. This is what the contrast gate
 * measures, alongside the bare ground — a texture that lightens the ground (four of the five
 * do) costs contrast, and a texture that darkens it (the True Void's vignette) gains some.
 * Taking the worse of the two is the only honest reading.
 */
export function compositeGround(floor: FloorTheme): string {
  return blendHex(floor.texture.ink, floor.bg, floor.texture.opacity);
}

/**
 * The `--void-*` names whose value depends on the floor. Exported so the "what changes
 * between floors" test enumerates a LIST rather than asserting a count — a count would pass
 * if a new floor-dependent token appeared and an old one silently stopped changing.
 */
export const FLOOR_SCOPED_VARS: readonly string[] = [
  '--void-accent',
  '--void-bg',
  '--void-panel',
  '--void-panel-raised',
  '--void-ink',
  '--void-ink-dim',
  '--void-texture-ink',
  '--void-texture-opacity',
];
