// Visual theme for The Void's UI shell — the text-forward terminal palette, type
// ramp, and spacing. Constants only (no behavior), so not unit-tested. Kaplay colors
// are RGB triples; DOM/CSS colors are hex strings (used by the textInput overlay).

/** RGB color triple, as Kaplay's `k.color(r,g,b)` expects. */
export type Rgb = readonly [number, number, number];

/** The Void's terminal palette. */
export const COLORS = {
  bg: [10, 10, 12] as Rgb, // #0a0a0c near-black
  panel: [20, 20, 26] as Rgb, // slightly lifted panel fill
  text: [226, 226, 232] as Rgb, // off-white body text
  dim: [120, 120, 132] as Rgb, // secondary / hint text
  accent: [122, 162, 247] as Rgb, // cool blue accent (headers, highlights)
  danger: [231, 111, 111] as Rgb, // enemy HP / defeat
  good: [122, 199, 138] as Rgb, // player HP / victory
  buttonFill: [24, 24, 32] as Rgb,
  buttonFillPressed: [40, 40, 54] as Rgb,
  buttonFillDisabled: [16, 16, 20] as Rgb,
  buttonBorder: [70, 70, 88] as Rgb,
  divider: [48, 48, 60] as Rgb,
} as const;

/** Hex equivalents for the DOM `<input>` overlay (kept in sync with COLORS). */
export const CSS_COLORS = {
  bg: '#0a0a0c',
  text: '#e2e2e8',
  accent: '#7aa2f7',
  border: '#46465a',
} as const;

/** The monospace font used everywhere — reinforces the terminal look. */
export const FONT = 'monospace';

/** Text size ramp, in virtual units. */
export const TEXT = {
  title: 64,
  header: 30,
  body: 22,
  small: 18,
  button: 24,
} as const;

/** Spacing scale, in virtual units. */
export const SPACING = {
  xs: 8,
  sm: 12,
  md: 20,
  lg: 32,
  edge: 24, // default inner margin from the content rect edge
} as const;
