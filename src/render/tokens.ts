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

/** The floor-independent palette. Every value is an sRGB hex string. */
export const PALETTE = {
  /** The page ground — near-black with a faint blue cast. */
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

/** One floor of the descent, and the accent colour that marks it. */
export interface FloorTheme {
  /** 0..4 — the engine's `state.place` (act - 1). */
  place: number;
  name: string;
  accent: string;
}

/**
 * The five floors, in descent order. The accent is the ONLY colour that changes as the
 * player descends, so it carries the whole sense of place. Each value is gated by the
 * contrast test in tokens.test.ts (>= 4.5:1 against PALETTE.bg) — taste proposes, the
 * measured ratio disposes.
 */
export const FLOOR_THEMES: readonly FloorTheme[] = [
  { place: 0, name: 'Undercity', accent: '#8fb0c0' }, // cold sodium blue-grey
  { place: 1, name: 'Entrance to the Void', accent: '#9b8ad6' }, // threshold violet
  { place: 2, name: 'Ash City', accent: '#c86a2a' }, // ash-orange
  { place: 3, name: 'Angelic Underground', accent: '#e6e2d3' }, // bone-white
  { place: 4, name: 'True Void', accent: '#ef6076' }, // arterial
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

/** The single font stack. Monospace everywhere, narrative text included. */
export const FONT_MONO = 'ui-monospace, "Cascadia Code", "Consolas", monospace';

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
    '--void-bg': PALETTE.bg,
    '--void-panel': PALETTE.panel,
    '--void-panel-raised': PALETTE.panelRaised,
    '--void-rule': PALETTE.rule,
    '--void-rule-strong': PALETTE.ruleStrong,
    '--void-ink': PALETTE.ink,
    '--void-ink-dim': PALETTE.inkDim,
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
