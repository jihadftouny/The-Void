// The ONLY DOM-touching part of the token layer (M-UI2 `ui-foundation`).
//
// Everything about WHAT the theme is lives in `tokens.ts` as pure, headlessly-testable
// data. This module does one thing: write that data onto an element as CSS custom
// properties. Keeping the DOM write in ~5 lines is what lets the whole palette,
// including the per-floor accent switch, be unit-tested under `node`.

import { floorTheme, themeVars } from './tokens.ts';
import { motionEnabled, settingsVars, type Settings } from './settings-model.ts';

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
  // The texture KIND is structural — a fog is not a vignette — so CSS has to know which one
  // to paint, and a custom property cannot select a rule. This attribute is that hook, and
  // `styleDiscipline.test.ts` asserts every kind in `FLOOR_THEMES` has a matching
  // `[data-texture='…']` rule in the stylesheet: a TS-to-CSS string coupling of exactly the
  // kind that nothing else in the toolchain can see.
  root.dataset['texture'] = themeTextureKind(place);
}

/** The texture kind for a floor, as the string CSS selects on. Clamped by `floorTheme`. */
function themeTextureKind(place: number): string {
  return floorTheme(place).texture.kind;
}

/**
 * Apply the PLAYER'S PREFERENCES over the floor's theme — text size, reduced motion, high
 * contrast (`UI-DESIGN.md` §12, `FINDINGS.md` B1/S4b/S4c).
 *
 * ⚠ CALL ORDER IS LOAD-BEARING: `applyTheme` FIRST, then this. Both write the same element,
 * and this one deliberately overwrites nine of the names the theme just wrote. Reversed, the
 * theme clobbers the player's text size and high-contrast ink on every single engine step —
 * the setting would appear to work exactly once and then silently revert on the next click,
 * which is close to the worst shape an accessibility bug can take. `screensSource.test.ts`
 * pins the order in `retheme()`.
 *
 * It is TOTAL and idempotent: `settingsVars` re-emits the floor's own values in normal mode
 * rather than emitting nothing, so turning high contrast back off restores the environment
 * with one write and no property removal.
 *
 * `data-motion`, `data-contrast` and `data-text` are the CSS hooks. `data-motion` carries the
 * RAW setting, not the resolved boolean, because the `system` case has to be resolved by the
 * `prefers-reduced-motion` media query rather than by script — CSS is the only layer that can
 * see the OS signal change while the game is running.
 */
export function applySettings(root: HTMLElement, settings: Settings, place: number): void {
  const vars = settingsVars(settings, place);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.dataset['motion'] = settings.motion;
  root.dataset['contrast'] = settings.contrast;
  root.dataset['text'] = settings.textScale;
}

/**
 * Whether the interface should animate, given the player's setting and the OS. Re-exported
 * from the pure model so the render layer has ONE import for "should this move?" — #6's
 * battle sequencing and #7's canvas both need it, and two copies of the rule would drift.
 */
export function shouldAnimate(settings: Settings, osReduced: boolean): boolean {
  return motionEnabled(settings.motion, osReduced);
}
