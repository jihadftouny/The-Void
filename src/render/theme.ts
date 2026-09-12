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
  // to paint, and a custom property cannot select a rule. This attribute is that hook.
  //
  // ⚠ THE COUPLING HAS TWO ENDS AND BOTH ARE GUARDED, which they were not at first.
  // `styleDiscipline.test.ts` proves the STYLESHEET has a `[data-texture='fog']` rule for
  // every kind in `FLOOR_THEMES`. That is only half: nothing there looks at this line, so
  // renaming the attribute to `data-texturee` left the whole visual system dead — no floor
  // painting any atmosphere — with the full suite, the typecheck and the build all green.
  // `theme.test.ts` closes the other end by calling this function and reading the attribute
  // NAMES back off a real element, checked against names derived from the stylesheets rather
  // than from this module.
  root.dataset['texture'] = themeTextureKind(place);
  // Light or dark (`floor-looks`, 2026-09-12): floor 2 is the one light floor, and the strike
  // flash has to DARKEN there, because brightening a white frame is invisible. Same two-ended
  // coupling as `data-texture`, guarded the same way in `theme.test.ts`. `applySettings` writes
  // it again straight after, with the ground as PAINTED (high contrast paints every floor dark).
  root.dataset['ground'] = floorTheme(place).ground;
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
 * and this one deliberately overwrites the colour names the theme just wrote (and, since
 * 2026-09-12, `data-ground`). Reversed, the
 * theme clobbers the player's text size and high-contrast ink on every single engine step —
 * the setting would appear to work exactly once and then silently revert on the next click,
 * which is close to the worst shape an accessibility bug can take. `screensSource.test.ts`
 * pins the order in `retheme()`.
 *
 * It is TOTAL and idempotent: `settingsVars` re-emits the floor's own values in normal mode
 * rather than emitting nothing, so turning high contrast back off restores the environment
 * with one write and no property removal.
 *
 * `data-motion` and `data-contrast` are the CSS hooks. `data-motion` carries the RAW setting,
 * not the resolved boolean, because the `system` case has to be resolved by the
 * `prefers-reduced-motion` media query rather than by script — CSS is the only layer that can
 * see the OS signal change while the game is running.
 *
 * ⚠ THERE IS NO `data-text` HOOK, and there was. It was written here on every settings change
 * and NO STYLESHEET EVER SELECTED ON IT — the text size is carried entirely by the
 * `--void-type-*` custom properties above, which is the whole reason the scale is a token
 * layer. An attribute nothing reads is the same species as a control that controls nothing:
 * it looks like a working hook, so the next person wires their rule to it and cannot tell
 * why nothing happens. `theme.test.ts` asserts that every attribute name written here is one
 * some shipped stylesheet really selects on.
 */
export function applySettings(root: HTMLElement, settings: Settings, place: number): void {
  const vars = settingsVars(settings, place);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.dataset['motion'] = settings.motion;
  root.dataset['contrast'] = settings.contrast;
  // The ground as PAINTED, not as declared: high contrast paints floor 2 black like every other
  // floor, so its flash must be the dark ground's. Total and reversible like the tokens —
  // turning high contrast off writes `light` back on floor 2.
  root.dataset['ground'] = settings.contrast === 'high' ? 'dark' : floorTheme(place).ground;
}

/**
 * Whether the interface should animate, given the player's setting and the OS. Re-exported
 * from the pure model so the render layer has ONE import for "should this move?" — #6's
 * battle sequencing and #7's canvas both need it, and two copies of the rule would drift.
 */
export function shouldAnimate(settings: Settings, osReduced: boolean): boolean {
  return motionEnabled(settings.motion, osReduced);
}
