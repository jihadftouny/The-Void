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
 *  - `rule`, `ruleStrong`, `inkFaint`, `harm`, `heal`, `foe` are the DARK-FLOOR DEFAULTS.
 *
 *    ⚠ REVISED 2026-09-12 (`floor-looks`). These six used to be genuinely floor-independent,
 *    emitted verbatim on every floor. Then floor 2 became a LIGHT floor, and on its white they
 *    are wrong in both directions at once: the hairlines become stark black lines (`rule`
 *    13:1 on the new panel, where every dark floor's is 1.1-1.7) and `inkFaint` stops being
 *    faint (6.2:1), while the three role colours FAIL AA (`harm` 3.4, `heal` 2.1, `foe` 2.7).
 *    So they are floor-scoped now (`FloorTheme` below): the dark floors spread
 *    `DARK_FURNITURE`, which is these values verbatim — so floors 1, 4 and 5 emit exactly what
 *    they always did — and floor 2 carries its own. Harm still reads as harm on every floor;
 *    it is simply a different red where the ground is white.
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
 *
 * REVISED 2026-09-12 (`floor-looks`): `static` (floor 2's scanline grid) became `flecks` (red
 * flecks on the white), and `ash` changed its paint from a crosshatch to a haze with falling
 * specks. The author, having played it: floors 2 and 3 were "only lines in the background, no
 * gradient colors or anything".
 */
export type TextureKind = 'fog' | 'flecks' | 'ash' | 'glow' | 'absence';

/**
 * Whether a floor's ground is LIGHT or DARK — declared, and asserted against the maths
 * (`relativeLuminance(bg) > 0.5` for exactly the light one) in `tokens.test.ts`. CSS selects on
 * it (`[data-ground='light']`) for the one effect that has to invert on white: the strike flash
 * darkens instead of brightening, because brightening a white frame is invisible.
 */
export type Ground = 'light' | 'dark';

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
  /** Light or dark — the ground as DECLARED; `tokens.test.ts` holds it to the luminance. */
  ground: Ground;
  /**
   * The furniture and the three roles — floor-scoped since 2026-09-12 (see `PALETTE`). The dark
   * floors spread `DARK_FURNITURE` (the `PALETTE` values, verbatim); a light floor needs its own.
   */
  rule: string;
  ruleStrong: string;
  /** Tertiary text (disabled, placeholder). Deliberately below AA on every floor — decorative. */
  inkFaint: string;
  harm: string;
  heal: string;
  foe: string;
  /**
   * The accent HIGH CONTRAST paints instead, on a floor whose own accent is illegible on black.
   * Only a light floor needs one, and it needs one by arithmetic rather than taste: AA on the
   * white ground needs L <= 0.183, AA on black needs L >= 0.175, and the fleck composite
   * tightens the first to L <= 0.164 — so no single colour clears both. `settingsVars` swaps it
   * in under high contrast. Absent means "the floor's own accent already reads on black".
   */
  accentOnBlack?: string;
  /** The atmosphere. */
  texture: FloorTexture;
}

/**
 * The furniture and role colours every DARK floor wears — exactly the `PALETTE` values, so a
 * dark floor that spreads this emits byte-for-byte what it emitted before these became
 * floor-scoped (`tokens.test.ts` holds a hand-transcribed snapshot of floors 1, 4 and 5).
 */
const DARK_FURNITURE = {
  rule: PALETTE.rule,
  ruleStrong: PALETTE.ruleStrong,
  inkFaint: PALETTE.inkFaint,
  harm: PALETTE.harm,
  heal: PALETTE.heal,
  foe: PALETTE.foe,
} as const;

/**
 * The five floors, in descent order. The accent is the ONLY colour that changes as the
 * player descends, so it carries the whole sense of place. Each value is gated by the
 * contrast tests in tokens.test.ts — against the floor's own ground, its textured composite
 * and its panels — taste proposes, the measured ratio disposes.
 *
 * AUTHORITY: `docs/ART-BIBLE.md` §4 "The floor colour ramp" [LOCKED 2026-08-25], which
 * records the author's own words and OVERRULES the earlier "ash-orange" in
 * `docs/UI-DESIGN.md` §5 that the first version of this table was derived from — and its
 * block "REVISED 2026-09-12", which rewrites floors 2 and 3 after the author played them.
 *
 * NUMBERING — the two schemes are off by one, so every mention below is explicit: "floor N"
 * always means the 1-BASED numbering the design docs use, while `place` is the engine's
 * 0-BASED index (`state.place`, and the array index here). ART-BIBLE floor N is `place` N-1;
 * the Ash City is floor 3 and `place` 2.
 *
 * THE PROBLEM THIS TABLE HAD TO SOLVE. Taken literally, three consecutive floors are pale:
 * floor 2 is "blinding white with red flecks", floor 3 is "purely white, grey and black",
 * floor 4 is "bone white". Three near-identical accents would defeat the entire point of a
 * per-floor accent, which is to mark the descent. They are separated on axes that are
 * thematically load-bearing rather than merely convenient:
 *
 *   - GROUND separates floor 2 from everything (REVISED 2026-09-12): it is the only LIGHT
 *     floor in the game. The white is no longer something the chrome has to imitate; it IS
 *     the ground, and its accent is the red that stands out in it.
 *   - TREATMENT separates floors 3 and 4. Floor 3 is NEUTRAL grey — no hue anywhere, dead,
 *     drained, emptied. Floor 4 is a WARM bone — sacred, lit, alive. No hue against warmth IS
 *     the difference between emptiness and grace (ART-BIBLE §4). REVISED 2026-09-12: floor 3
 *     used to be a COLD grey, 18 points bluer than red, as the near-mirror of floor 4's 19
 *     points warmer; the revision quotes the author — "purely white gray and black" — and asks
 *     for greyscale only, so the separation is now neutral-against-warm, which is still two
 *     opposite treatments rather than two distances from one.
 *   - LIGHTNESS separates floors 3 and 4 again, as a second guard: floor 3's accent sits at
 *     ~10:1 against the boot ground and floor 4's at ~15.5:1, so they differ even in greyscale.
 *
 * FLOOR 2 — why the accent is the RED, and not the white. Unchanged in principle since
 * 2026-08-25: the white is the ENVIRONMENT; the red is the thing that stands out in it — and
 * standing out is precisely a UI accent's job. What changed is WHICH red. The first accent was a
 * bright scarlet (#ff3b2f) on a near-black ground, with the white hidden in 7% scanlines; on the
 * white ground that scarlet measures 3.1:1 and fails. The accent is now a deep blood red that
 * clears 8.7:1 on the white, and the scarlet survives as the floor's `accentOnBlack` — the red
 * high contrast paints on black. (`ENTRANCE_ALTERNATIVE_WHITE`, the "reversible half" of the old
 * decision — a white ACCENT on a dark floor — is deleted: the white is the ground now.)
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
    ground: 'dark',
    ...DARK_FURNITURE,
    texture: { kind: 'fog', ink: '#4f8f6a', opacity: 0.1 },
  },
  // FLOOR 2 — ENTRANCE TO THE VOID. "fracture": mirrors, doubles, static, signal.
  //
  // ⚠ REVISED 2026-09-12 (`floor-looks`) — THE WHITE-OUT. The only LIGHT floor in the game.
  // Walking in from the dark Undercity, the world goes white: that is the fracture made
  // visible, and it is what the author asked for ("blinding white with red flecks") and then,
  // having played the dark version, asked for again. `tokens.css` dissolves the change over
  // `RETHEME_FADE_MS` rather than snapping it, because a one-frame jump from near-black to
  // white is exactly the harm "blinding" names, for light-sensitive players.
  //
  // THE HISTORY, kept because it is the reason for every number below. The 2026-09-07 version
  // kept this floor DARK: a scarlet accent (#ff3b2f) on a near-white ground measured 4.32:1,
  // under the gate, so the palette moved and the white was hidden in a 7% scanline wash that
  // did not read as white at all. The revision keeps the gate and moves the ACCENT instead:
  //   - GROUND #f4f5f9, a cool white (blue leads red by 5), L = 0.914. Panels are DARKER than
  //     the ground here, not lighter: on a light floor, nearer reads as denser.
  //   - ACCENT #8e0c0a, a deep blood red: 8.73:1 on the ground, and 5.18:1 on the fleck
  //     composite — the tightest gate on the floor, and the reason the flecks stop at 0.3.
  //   - ROLES of its own, because PALETTE's fail on white: harm #9b1b52 is a dark CRIMSON, hue-
  //     separated from the accent's pure red so the HP bar and the charges bar are never two
  //     identical reds; heal #1f5c33 and foe #6b4a0c are the sage and amber, darkened.
  //   - FURNITURE of its own: hairlines at 1.36 / 1.98 on the panel, as the dark floors' are
  //     1.1-1.7, where PALETTE's rule would draw a 13:1 black line round every panel.
  //   - FLECKS in #c0181a at 0.3: the densest peak the composite gate allows (at 0.35 the
  //     accent drops to ~4.7 on it, at 0.5 the body ink drops under AAA). So the flecks read
  //     as small pale-red marks, not vivid red — a feel question the author is asked to judge.
  //   - HIGH CONTRAST: the scarlet returns as `accentOnBlack`, 5.92:1 on black.
  {
    place: 1,
    name: 'Entrance to the Void',
    accent: '#8e0c0a',
    accentOnBlack: '#ff3b2f',
    bg: '#f4f5f9',
    panel: '#eaecf2',
    panelRaised: '#dfe2ea',
    ink: '#15171d',
    inkDim: '#4c5160',
    ground: 'light',
    rule: '#c9ccd6',
    ruleStrong: '#a5a9b7',
    inkFaint: '#9a9eab',
    harm: '#9b1b52',
    heal: '#1f5c33',
    foe: '#6b4a0c',
    texture: { kind: 'flecks', ink: '#c0181a', opacity: 0.3 },
  },
  // FLOOR 3 — THE ASH CITY. "grief", not fear (WORLD.md §6). "purely white gray and black,
  // the fire has settled already and it's just ash." The palest DARK ground of the five — the
  // ash is over everything, so everything is a shade paler — and, REVISED 2026-09-12, strictly
  // NEUTRAL: every environment colour has r = g = b. (It used to be a cold grey, blue-leaning;
  // the revision asks for greyscale only.) The ink is the dimmest of the dark floors' inks for
  // the same reason: nothing here is sharp any more. Nothing glows; there is no ember left. The
  // three ROLES keep their hue — harm has to read as harm on every floor — and are the one
  // declared exemption from the greyscale rule.
  //
  // The texture is a soft grey haze with fine ash specks falling slowly through it, three times
  // the old crosshatch's alpha (the author: "only lines in the background").
  //
  // ⚠ THE PANELS ARE DARKER THAN FIRST PLANNED, and a measurement is why. The destructive hub
  // row ("Abandon the descent") is harm on the RAISED panel, a pairing no token gate measured
  // until this unit. The layout probe's new paint audit found it at 4.39:1 on the old floor 3
  // (#1d2025) — under AA, on `main`. The planned #232323 would have made it 4.23. The raised
  // panel is therefore #1d1d1d (4.53:1), and the panel steps down to #181818 so the three
  // surfaces still read as a ramp (panel 1.31x the ground, raised 1.35x the panel).
  {
    place: 2,
    name: 'Ash City',
    accent: '#b8b8b8',
    bg: '#141414',
    panel: '#181818',
    panelRaised: '#1d1d1d',
    ink: '#dcdcdc',
    inkDim: '#909090',
    ground: 'dark',
    rule: '#242424',
    ruleStrong: '#3c3c3c',
    inkFaint: '#585858',
    harm: PALETTE.harm,
    heal: PALETTE.heal,
    foe: PALETTE.foe,
    texture: { kind: 'ash', ink: '#bdbdbd', opacity: 0.2 },
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
    ground: 'dark',
    ...DARK_FURNITURE,
    texture: { kind: 'glow', ink: '#e6d9b0', opacity: 0.1 },
  },
  // FLOOR 5 — THE TRUE VOID. "absence, not destruction" — "there was less of you than you
  // thought". The darkest ground by a wide margin (a third of floor 1's light), and one of the
  // two textures that SUBTRACT: a vignette in pure black that eats the edges of the screen, so
  // the interface is visibly smaller than it was. That is negative space and things missing,
  // which is what ART-BIBLE rule 3 demands, and it is the opposite of gore or ruin.
  // Accent: black cannot be an accent against a near-black interface, so the accent is the
  // thing burning in the dark. Pink and light next to floor 2's deep blood red — old blood in
  // the dark, against fresh blood on white.
  {
    place: 4,
    name: 'True Void',
    accent: '#ef6076',
    bg: '#030304',
    panel: '#08080a',
    panelRaised: '#0e0e11',
    ink: '#ded7d9',
    inkDim: '#8b8489',
    ground: 'dark',
    ...DARK_FURNITURE,
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
 * REVISED 2026-09-12 (`floor-looks`). Floor 2 is now LIGHT, and high contrast must still
 * defeat it: the promise of the setting is black and white on EVERY floor, so floor 2's white
 * ground is replaced by this black like every other. That forced two additions. The three
 * ROLES are here (the dark-floor `PALETTE` values, 5.65 / 9.11 / 7.18 on black), because floor
 * 2's own roles are dark reds and greens that would vanish on black. And the ACCENT is resolved
 * too — to the floor's `accentOnBlack` where it has one — because floor 2's deep red is 2.1:1
 * on black (`settingsVars` does that; the accent is still the floor's own).
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
  harm: PALETTE.harm,
  heal: PALETTE.heal,
  foe: PALETTE.foe,
} as const;

/**
 * How long a re-theme takes to DISSOLVE from one floor's palette into the next, in ms.
 *
 * Why there is a dissolve at all: floor 2 is white and every other floor is near-black, so an
 * instant re-theme would raise the screen's luminance ~300-fold in a single frame — the harm
 * the word "blinding" names, and the one a light-sensitive player cannot look away from in
 * time. `tokens.css` registers every colour token in `FADED_VARS` with `@property` and
 * transitions them on `:root` for this long; `themeVars` emits it as `--void-fade-retheme`, so
 * the stylesheet and the renderer's log line read ONE number.
 *
 * Why 1200: the pupillary light reflex starts ~200-250 ms after a step in brightness and has
 * constricted substantially by about a second, so a ramp this long keeps the rise inside what
 * the eye can track; under ~700 ms it outruns the reflex, over ~2 s the interface feels
 * sluggish. A descent already waits on the narrator, so the dissolve costs the player nothing.
 *
 * ⚠ REDUCED MOTION KEEPS IT. A dissolve moves nothing — no translate, no scale — and it is the
 * opposite of a flash: it is what REMOVES the one-frame white-out. Making it instant for the
 * players who asked for less motion would hand the most light-sensitive of them the harshest
 * transition in the game. `styleDiscipline.test.ts` asserts no reduced-motion rule stops it.
 */
export const RETHEME_FADE_MS = 1200;

/**
 * The colour tokens the re-theme dissolves — every one `tokens.css` registers with `@property`
 * and names in the `:root` transition, coupled both ways by `styleDiscipline.test.ts`.
 *
 * ⚠ THE TEXTURE'S INK AND OPACITY ARE DELIBERATELY NOT HERE. `data-texture` swaps the gradient
 * PATTERN, and a pattern cannot interpolate, so the atmosphere changes at once (at no more than
 * 0.3 alpha) while the ground dissolves beneath it. Fading the new pattern from the OLD floor's
 * colour would paint floor 2's flecks in floor 1's green for half a second — worse than a snap.
 */
export const FADED_VARS: readonly string[] = [
  '--void-bg',
  '--void-panel',
  '--void-panel-raised',
  '--void-ink',
  '--void-ink-dim',
  '--void-ink-faint',
  '--void-rule',
  '--void-rule-strong',
  '--void-accent',
  '--void-harm',
  '--void-heal',
  '--void-foe',
];

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
    // FLOOR-SCOPED since 2026-09-12 — the furniture and the roles. Every dark floor carries the
    // PALETTE values here (`DARK_FURNITURE`); the light floor carries its own, because a rule
    // tuned for near-black is a black line on white and a role tuned for it fails AA there.
    '--void-rule': floor.rule,
    '--void-rule-strong': floor.ruleStrong,
    '--void-ink-faint': floor.inkFaint,
    '--void-harm': floor.harm,
    '--void-heal': floor.heal,
    '--void-foe': floor.foe,
    '--void-accent': floor.accent,
    // FLOOR-INDEPENDENT — how long a change of floor takes to dissolve (`RETHEME_FADE_MS`).
    '--void-fade-retheme': `${RETHEME_FADE_MS}ms`,
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
 * measures, alongside the bare ground. Which way the texture pushes the ground decides who
 * pays: on a DARK floor a lightening texture (fog, ash, the sacred glow) costs the light ink
 * contrast; on the LIGHT floor the red flecks DARKEN the white and cost the dark ink and the
 * accent contrast — which is why floor 2's composite is its tightest gate; and the True Void's
 * black vignette darkens a dark ground and so gains its ink some. Taking the worse of the bare
 * ground and the composite is the only honest reading.
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
  // `floor-looks` (2026-09-12): the six the light floor could not share with the dark ones.
  '--void-rule',
  '--void-rule-strong',
  '--void-ink-faint',
  '--void-harm',
  '--void-heal',
  '--void-foe',
];
