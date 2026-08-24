// The ONLY DOM-touching part of the token layer (M-UI2 `ui-foundation`).
//
// Everything about WHAT the theme is lives in `tokens.ts` as pure, headlessly-testable
// data. This module does one thing: write that data onto an element as CSS custom
// properties. Keeping the DOM write in ~5 lines is what lets the whole palette,
// including the per-floor accent switch, be unit-tested under `node`.

import { themeVars } from './tokens.ts';

/**
 * Apply the theme for an engine `place` (0..4) to `root` — normally `document.documentElement`,
 * so every `var(--void-*)` in every stylesheet resolves from one place.
 *
 * Call it at boot AND after each engine step: the accent is a RUNTIME switch, so descending a
 * floor re-tints the whole UI with no reload and no per-floor CSS class. `place` is clamped by
 * `floorTheme`, so a garbage value degrades to floor 0 rather than throwing mid-render.
 */
export function applyTheme(root: HTMLElement, place: number): void {
  const vars = themeVars(place);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}
