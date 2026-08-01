// Responsive layout + geometry math for The Void's UI shell — PURE, Kaplay-free.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: this module imports NO Kaplay / DOM / canvas, so it
//    runs and is unit-tested headlessly under Vitest's `node` environment. The scenes
//    and UI kit consume these numbers; nothing here draws anything.
//  - Mobile-first (#5): a single, fixed PORTRAIT virtual resolution is letterboxed to
//    fit any viewport (the smaller axis ratio wins), and the touch-target math below
//    guarantees a `BUTTON_HEIGHT`-tall virtual button never shrinks below the
//    platform 44px minimum on the smallest supported phone.
//
// Virtual resolution is 540x1080 (9:18) — orchestrator-resolved (open-question #2)
// portrait, replacing engine.ts's original landscape 960x600.

/** The fixed virtual canvas width, in virtual units. */
export const VIRTUAL_WIDTH = 540;
/** The fixed virtual canvas height, in virtual units (9:18 portrait). */
export const VIRTUAL_HEIGHT = 1080;
/** Standard button height, in virtual units (see the touch-target guarantee). */
export const BUTTON_HEIGHT = 96;
/** Standard gap between stacked elements, in virtual units. */
export const GAP = 20;
/** Platform minimum comfortable touch target, in CSS pixels. */
export const MIN_TOUCH_PX = 44;
/** The smallest viewport (CSS px) the shell is designed to remain usable at. */
export const MIN_VIEWPORT: Viewport = { w: 320, h: 568 };

/** A rendering viewport in CSS pixels (the real on-device drawing surface). */
export interface Viewport {
  w: number;
  h: number;
}

/** An axis-aligned rectangle in virtual units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Safe-area insets, in virtual units (top/bottom/left/right). */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The letterbox scale factor mapping virtual units -> CSS pixels for a viewport:
 * the SMALLER of the two axis ratios, so the whole virtual canvas fits (the
 * unused axis becomes letterbox bars). Pure.
 */
export function scale(viewport: Viewport): number {
  return Math.min(viewport.w / VIRTUAL_WIDTH, viewport.h / VIRTUAL_HEIGHT);
}

/** Convert a length in virtual units to CSS pixels for the given viewport. */
export function virtualToCss(units: number, viewport: Viewport): number {
  return units * scale(viewport);
}

/** Convert a length in CSS pixels to virtual units for the given viewport. */
export function cssToVirtual(px: number, viewport: Viewport): number {
  return px / scale(viewport);
}

/**
 * The drawable content rectangle: the full virtual canvas minus the safe-area
 * insets (given in virtual units). Feeds `stackButtons` / scene layout so nothing
 * renders under a notch or the home indicator.
 */
export function contentRect(insets: Insets): Rect {
  return {
    x: insets.left,
    y: insets.top,
    w: VIRTUAL_WIDTH - insets.left - insets.right,
    h: VIRTUAL_HEIGHT - insets.top - insets.bottom,
  };
}

/**
 * Stack `count` full-width rectangles top-to-bottom inside `bounds`, each
 * `itemHeight` tall and `gap` apart. Returns them in top-to-bottom order; adjacent
 * rects never overlap (their vertical spans are separated by exactly `gap`). Pure.
 */
export function stackButtons(
  bounds: Rect,
  count: number,
  itemHeight: number,
  gap: number,
): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i < count; i += 1) {
    rects.push({
      x: bounds.x,
      y: bounds.y + i * (itemHeight + gap),
      w: bounds.w,
      h: itemHeight,
    });
  }
  return rects;
}

/**
 * The fraction (0..1) of an HP bar that should read as filled, clamped. Formats an
 * already-computed hp/maxHp pair for the renderer — it applies NO game rule. A
 * non-positive `maxHp` yields 0 (empty) rather than dividing by zero.
 */
export function hpFraction(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  const f = hp / maxHp;
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}
