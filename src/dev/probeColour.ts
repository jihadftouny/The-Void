// THE LAYOUT PROBE'S COLOUR MATHS — the one piece of arithmetic the in-page paint audit adds
// (`floor-looks`, 2026-09-12).
//
// WHY IT EXISTS. Floor 2 became the game's only LIGHT floor, and a light ground is where every
// token that was quietly tuned for near-black shows up: a rule that was a hairline becomes a
// stark black line, a role colour that was AA on black fails on white. `tokens.test.ts` gates
// the tokens as pairs of hexes. What it cannot see is which token the REAL CASCADE actually puts
// under which glyph — a panel that is translucent, a rule keyed to the wrong surface, a colour a
// component took from somewhere else. The probe's paint audit reads that out of the built page in
// real Chromium, where `getComputedStyle` hands colours back as `rgb()` / `rgba()` strings; this
// module turns those strings into the numbers the audit judges.
//
// PURE and DOM-free, so it is unit-tested headlessly (`probeColour.test.ts`) against values
// derived by hand. The WCAG ratio itself is NOT re-implemented here: it is `tokens.ts`'s
// `contrastRatio`, which `tokens.test.ts` anchors to hand-derived values before anything is
// gated with it. The parser and the compositing are the only new maths.
//
// DETERMINISM: no clock, no randomness (`exclusion.test.ts` scans this directory).

import { contrastRatio } from '../render/tokens.ts';

/** An sRGB colour as 0..255 channels (unrounded — a composite lands between integers) and alpha. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse a COMPUTED CSS colour — the forms Chromium serialises: `rgb(r, g, b)`,
 * `rgba(r, g, b, a)`, the space-separated `rgb(r g b / a)` (alpha as a number or a percentage),
 * and the keyword `transparent`. Anything else is `null`: a colour the audit cannot read is
 * reported as unreadable, never guessed at — a guess would be a number the page never produced.
 */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(text);
  if (!m) return null;
  const channel = (s: string | undefined): number => Math.min(Math.max(Number(s), 0), 255);
  let a = m[4] === undefined ? 1 : Number(m[4]);
  if (m[5] === '%') a /= 100;
  return { r: channel(m[1]), g: channel(m[2]), b: channel(m[3]), a: Math.min(Math.max(a, 0), 1) };
}

/**
 * `top` painted onto `under` — plain source-over, per channel, unrounded. Opaque whenever
 * `under` is, which is the only case the audit composites onto.
 */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number): number => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}

/**
 * A stack of backgrounds, NEAREST FIRST (the element's own, then its parent's, ...), flattened
 * onto the first OPAQUE one — which is what a glyph is really drawn on. Everything below that
 * layer is covered and ignored. A stack with no opaque layer at all is flattened onto opaque
 * black; the probe page never produces one (`html` carries the opaque boot ground), and black is
 * the canvas this game has always assumed.
 */
export function flatten(stack: readonly Rgba[]): Rgba {
  const cut = stack.findIndex((c) => c.a >= 1);
  // The layers that are actually seen, and the opaque surface they are painted onto.
  const seen = cut < 0 ? stack : stack.slice(0, cut);
  let surface: Rgba = cut < 0 ? { r: 0, g: 0, b: 0, a: 1 } : (stack[cut] as Rgba);
  for (let i = seen.length - 1; i >= 0; i -= 1) surface = over(seen[i] as Rgba, surface);
  return surface;
}

/** An opaque colour as `#rrggbb`, each channel rounded to the nearest 8-bit value. */
export function toHex(c: Rgba): string {
  const h = (v: number): string => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * The WCAG ratio between a text colour and the opaque surface under it. A translucent text
 * colour is first composited onto that surface: the blend is what reaches the eye, and a ratio
 * computed from the unblended colour would describe a glyph nobody sees.
 */
export function textContrast(text: Rgba, surface: Rgba): number {
  return contrastRatio(toHex(over(text, surface)), toHex(surface));
}
