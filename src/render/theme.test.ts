// @vitest-environment jsdom
//
// THE APPLIER — the only DOM-touching part of the token layer, and until this file existed it
// was tested by NOTHING.
//
// ---------------------------------------------------------------------------------------
// WHY THIS FILE HAD TO BE WRITTEN, stated plainly because the gap was invisible.
//
// `theme.ts` writes three attributes. Renaming all three — `data-texture` -> `data-texturee`,
// `data-motion` -> `data-motionn`, `data-contrast` -> `data-contrastt` — left the FULL suite
// at 2126 passed, 0 failed, with a clean typecheck and a clean build. What that mutation
// actually does is kill the entire visual system of this unit: no floor paints any
// atmosphere, high contrast stops removing the texture, the player's reduced-motion override
// does nothing, and `:root:not([data-motion='full'])` becomes permanently true.
//
// The reason nothing saw it is instructive. The coupling `FLOOR_THEMES[n].texture.kind` ->
// `[data-texture='fog']` was guarded on the CSS SIDE ONLY: `styleDiscipline.test.ts` proves a
// rule exists for every texture kind, and a rule that exists is worth nothing if no element
// ever carries the attribute that selects it. Half a coupling is not a coupling.
//
// ---------------------------------------------------------------------------------------
// HOW THE EXPECTATIONS ARE DERIVED, which is the part that makes this test mean something.
//
// EVERY attribute name and value asserted below is READ OUT OF THE SHIPPED STYLESHEETS, never
// out of `theme.ts`. Deriving them from the module under test would reproduce exactly the
// blindness this file exists to remove — the renamed module would agree with itself and the
// test would go green again. So the stylesheets are the specification: they say which hooks
// they select on, and the appliers are checked against that.
//
// The check runs in BOTH directions, and each catches a different defect:
//   FORWARD  (CSS -> code): every `[data-x='v']` a stylesheet selects on can really be
//            produced by one of the two appliers. Catches a rule keyed to a hook nobody
//            writes, and every rename of a written hook.
//   BACKWARD (code -> CSS): every attribute NAME the appliers write is one some stylesheet
//            selects on. Catches a dead hook — `data-text` was one, written on every settings
//            change and read by nothing, and it is removed rather than left looking wired.
//
// It is deliberately NAMES backward and NAME=VALUE forward: `data-motion='system'` is written
// and has no rule of its own, because the `system` case is resolved by the
// `prefers-reduced-motion` media query rather than by a selector. That is correct, and a
// value-level backward check would call it a defect.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySettings, applyTheme, shouldAnimate } from './theme.ts';
import { FLOOR_THEMES, floorTheme, themeVars } from './tokens.ts';
import {
  DEFAULT_SETTINGS,
  motionEnabled,
  settingsVars,
  type ContrastSetting,
  type MotionSetting,
  type Settings,
  type TextScale,
} from './settings-model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');

function stylesheetsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...stylesheetsUnder(full));
    else if (entry.name.endsWith('.css')) found.push(full);
  }
  return found;
}

const SHEETS = stylesheetsUnder(SRC_ROOT).map((file) => ({
  name: basename(file),
  css: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

/** Every `[data-x='v']` attribute selector any shipped stylesheet uses, as `x=v`. */
function attributeSelectors(): { name: string; value: string; sheet: string }[] {
  const out: { name: string; value: string; sheet: string }[] = [];
  for (const sheet of SHEETS) {
    for (const m of sheet.css.matchAll(/\[\s*(data-[a-z-]+)\s*=\s*'([^']*)'\s*\]/g)) {
      out.push({ name: m[1] as string, value: m[2] as string, sheet: sheet.name });
    }
  }
  return out;
}

/**
 * `data-screen` is written by `src/desktop/game.ts` from the pure `screenKey`, not by either
 * applier, so it is excluded from the applier checks — and then checked on its own terms at
 * the bottom of this file rather than simply waved through.
 */
const OWNED_ELSEWHERE = new Set(['data-screen']);

/** The `data-*` attributes actually on an element, as `name=value`. */
function attributesOn(el: HTMLElement): string[] {
  return [...el.attributes]
    .filter((a) => a.name.startsWith('data-'))
    .map((a) => `${a.name}=${a.value}`);
}

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

/** Everything either applier can ever write, over every floor and every settings combination. */
function everythingWritten(): Set<string> {
  const written = new Set<string>();
  for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
    const el = document.createElement('div');
    applyTheme(el, place);
    for (const a of attributesOn(el)) written.add(a);
    for (const motion of ['system', 'reduce', 'full'] as MotionSetting[]) {
      for (const contrast of ['normal', 'high'] as ContrastSetting[]) {
        for (const textScale of ['small', 'normal', 'large'] as TextScale[]) {
          const e = document.createElement('div');
          applySettings(e, settings({ motion, contrast, textScale }), place);
          for (const a of attributesOn(e)) written.add(a);
        }
      }
    }
  }
  return written;
}

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
});

// =========================================================================================
// THE COUPLING, both ways.
// =========================================================================================

describe('every CSS hook is an attribute the appliers really write', () => {
  it('the stylesheets select on attributes at all (or every check here is vacuous)', () => {
    const selectors = attributeSelectors();
    expect(selectors.length, 'no [data-x=...] selector anywhere — nothing to couple to')
      .toBeGreaterThan(6);
    const names = new Set(selectors.map((s) => s.name));
    // The three this unit's whole visual system hangs on, named so a stylesheet that quietly
    // stopped selecting on one could not empty the check below.
    expect(names, 'no stylesheet selects on a texture').toContain('data-texture');
    expect(names, 'no stylesheet selects on the motion setting').toContain('data-motion');
    expect(names, 'no stylesheet selects on the contrast setting').toContain('data-contrast');
  });

  it('FORWARD: every `[data-x=v]` a stylesheet uses can be produced by an applier', () => {
    // The rename this file exists for fails HERE: the stylesheet asks for `data-texture=fog`
    // and the applier writes `data-texturee=fog`, so the pairing is absent from `written`.
    const written = everythingWritten();
    const orphans = attributeSelectors()
      .filter((s) => !OWNED_ELSEWHERE.has(s.name))
      .filter((s) => !written.has(`${s.name}=${s.value}`))
      .map((s) => `${s.sheet} -> [${s.name}='${s.value}']`);
    expect(
      orphans,
      'a stylesheet is keyed to a hook nothing writes. Either the rule never matches, or ' +
        'the attribute was renamed in theme.ts and the whole floor system is dead',
    ).toEqual([]);
    // Non-vacuity: the appliers really do write things, so "no orphans" is not "no data".
    expect(written.size).toBeGreaterThan(5);
  });

  it('BACKWARD: every attribute the appliers write is read by some stylesheet', () => {
    // A hook nothing reads looks wired. `data-text` was exactly that — written on every
    // settings change, selected on by no rule, because the text size is carried entirely by
    // the `--void-type-*` custom properties. It is removed, and this keeps the next one out.
    const read = new Set(attributeSelectors().map((s) => s.name));
    const dead = [...everythingWritten()]
      .map((pair) => pair.split('=')[0] as string)
      .filter((name) => !read.has(name));
    expect(
      [...new Set(dead)],
      'the theme writes an attribute no stylesheet selects on. It looks like a working hook, ' +
        'so the next rule gets wired to it and nobody can tell why nothing happens',
    ).toEqual([]);
  });
});

// =========================================================================================
// applyTheme — the floor.
// =========================================================================================

describe('applyTheme paints the floor onto the element', () => {
  it('writes the texture kind as an attribute, on every floor', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      applyTheme(root, place);
      expect(
        root.getAttribute('data-texture'),
        `floor ${place} writes no data-texture — its atmosphere would never be painted`,
      ).toBe(floorTheme(place).texture.kind);
    }
  });

  it('and the five values it writes are five DIFFERENT ones', () => {
    const kinds = new Set<string>();
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      applyTheme(root, place);
      kinds.add(root.getAttribute('data-texture') ?? '');
    }
    expect(kinds.size, 'two floors paint the same atmosphere').toBe(5);
    expect(kinds.has(''), 'a floor wrote no texture at all').toBe(false);
  });

  it('writes every token the theme defines, with the theme’s own value', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      applyTheme(root, place);
      for (const [name, value] of Object.entries(themeVars(place))) {
        expect(root.style.getPropertyValue(name), `${name} on floor ${place}`).toBe(value);
      }
    }
  });

  it('is a RUNTIME switch — re-applying replaces the previous floor entirely', () => {
    applyTheme(root, 0);
    const undercityInk = root.style.getPropertyValue('--void-ink');
    applyTheme(root, 4);
    expect(root.getAttribute('data-texture')).toBe('absence');
    expect(root.style.getPropertyValue('--void-ink')).not.toBe(undercityInk);
    expect(root.style.getPropertyValue('--void-ink')).toBe(floorTheme(4).ink);
  });

  it('and it is clamped, so a garbage floor degrades instead of throwing mid-render', () => {
    for (const place of [-1, 99, Number.NaN]) {
      expect(() => applyTheme(root, place)).not.toThrow();
      expect(root.getAttribute('data-texture')).toBe(floorTheme(place).texture.kind);
    }
  });

  it('touches only the element it was given', () => {
    const other = document.createElement('div');
    applyTheme(root, 2);
    expect(attributesOn(other)).toEqual([]);
    expect(other.style.getPropertyValue('--void-ink')).toBe('');
  });
});

// =========================================================================================
// applySettings — the player's preferences over the top.
// =========================================================================================

describe('applySettings writes the player’s preferences as CSS can see them', () => {
  it('writes the RAW motion setting, all three of them', () => {
    for (const motion of ['system', 'reduce', 'full'] as MotionSetting[]) {
      applySettings(root, settings({ motion }), 0);
      expect(
        root.getAttribute('data-motion'),
        `${motion} is not readable by CSS — the reduced-motion rules never match`,
      ).toBe(motion);
    }
  });

  it('the RAW setting and not the resolved boolean, because CSS resolves `system`', () => {
    // `system` must reach the stylesheet as `system`, so the `prefers-reduced-motion` media
    // query decides it. Resolving it here would freeze the OS signal at boot: a player who
    // changes it while the game is running would see no effect until a restart.
    applySettings(root, settings({ motion: 'system' }), 0);
    expect(root.getAttribute('data-motion')).toBe('system');
    expect(root.getAttribute('data-motion')).not.toBe('true');
    expect(root.getAttribute('data-motion')).not.toBe('false');
  });

  it('writes the contrast setting, both values', () => {
    for (const contrast of ['normal', 'high'] as ContrastSetting[]) {
      applySettings(root, settings({ contrast }), 3);
      expect(root.getAttribute('data-contrast'), contrast).toBe(contrast);
    }
  });

  it('writes every override token, with the value the pure model computed', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      for (const contrast of ['normal', 'high'] as ContrastSetting[]) {
        const s = settings({ contrast, textScale: 'large' });
        applySettings(root, s, place);
        for (const [name, value] of Object.entries(settingsVars(s, place))) {
          expect(root.style.getPropertyValue(name), `${name} @${place}/${contrast}`).toBe(value);
        }
      }
    }
  });

  it('is IDEMPOTENT and REVERSIBLE — high contrast off restores the floor', () => {
    // The behaviour `settingsVars` re-emitting the floor's own values in normal mode buys.
    // A version that emitted only overrides would leave `--void-ink: #ffffff` stuck on the
    // element forever after one visit to the settings screen.
    applyTheme(root, 1);
    applySettings(root, settings(), 1);
    const floorInk = root.style.getPropertyValue('--void-ink');
    expect(floorInk).toBe(floorTheme(1).ink);

    applySettings(root, settings({ contrast: 'high' }), 1);
    expect(root.style.getPropertyValue('--void-ink')).not.toBe(floorInk);
    expect(root.style.getPropertyValue('--void-texture-opacity')).toBe('0');

    applySettings(root, settings({ contrast: 'normal' }), 1);
    expect(root.style.getPropertyValue('--void-ink'), 'turning it off did not restore the floor')
      .toBe(floorInk);
    expect(root.style.getPropertyValue('--void-texture-opacity')).toBe(
      String(floorTheme(1).texture.opacity),
    );
  });
});

// =========================================================================================
// THE ORDER, behaviourally. `screensSource.test.ts` pins it as source text in `retheme()`;
// this is what that pin is actually protecting.
// =========================================================================================

describe('the call order decides whether a preference survives a step', () => {
  it('theme FIRST then settings: the player’s choice wins', () => {
    applyTheme(root, 2);
    applySettings(root, settings({ contrast: 'high', textScale: 'large' }), 2);
    expect(root.style.getPropertyValue('--void-ink')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--void-type-base')).toBe('18px');
  });

  it('reversed, the theme CLOBBERS it — which is the defect the source pin exists for', () => {
    // Both write the same element and `applySettings` deliberately overwrites nine of the
    // names `applyTheme` writes. Reversed, every engine step silently reverts the setting, so
    // it appears to work exactly once. Asserted here as behaviour so the reason the ordering
    // guard exists is written down as a fact rather than as a warning in a comment.
    applySettings(root, settings({ contrast: 'high', textScale: 'large' }), 2);
    applyTheme(root, 2);
    expect(root.style.getPropertyValue('--void-ink')).toBe(floorTheme(2).ink);
    expect(root.style.getPropertyValue('--void-type-base')).not.toBe('18px');
  });
});

describe('shouldAnimate is the same decision the pure model makes', () => {
  it('agrees with motionEnabled on every combination', () => {
    for (const motion of ['system', 'reduce', 'full'] as MotionSetting[]) {
      for (const osReduced of [true, false]) {
        expect(shouldAnimate(settings({ motion }), osReduced), `${motion}/${osReduced}`).toBe(
          motionEnabled(motion, osReduced),
        );
      }
    }
  });

  it('and the two really disagree across the table (or the check above is trivial)', () => {
    const results = (['system', 'reduce', 'full'] as MotionSetting[]).flatMap((m) =>
      [true, false].map((os) => shouldAnimate(settings({ motion: m }), os)),
    );
    expect(new Set(results).size, 'shouldAnimate returns the same answer to everything').toBe(2);
  });
});

// =========================================================================================
// `data-screen` — the one CSS hook neither applier owns. Excluded from the checks above, so
// it is checked here rather than waved through.
// =========================================================================================

describe('every data-screen rule is keyed to a value screenKey can produce', () => {
  /**
   * The legal values, written by hand from their two sources: `Awaiting` in
   * `src/game/game.ts`, and the render-layer screens plus the two `game.ts` writes directly.
   * Transcribed rather than imported — `Awaiting` is a type with no runtime list, and a
   * hand-written set is the independent expectation.
   */
  const LEGAL = new Set([
    'title',
    'enter-name',
    'choose-class',
    'accept-or-reroll-stats',
    'main-menu',
    'continue',
    'battle-action',
    'draft-pick',
    'deal-decision',
    'rest-decision',
    'game-over',
    'inventory',
    'sheet',
    'settings',
    'confirm-abandon',
    'content-warning',
    'resume',
  ]);

  it('no stylesheet is keyed to a screen that can never appear', () => {
    // A typo here is silent in the worst way: `[data-screen='titel']` is valid CSS that
    // matches nothing, so the screen simply never gets its treatment and nobody is told.
    const unreachable = attributeSelectors()
      .filter((s) => s.name === 'data-screen')
      .filter((s) => !LEGAL.has(s.value))
      .map((s) => `${s.sheet} -> [data-screen='${s.value}']`);
    expect(unreachable, 'a per-screen rule is keyed to a screen the game never shows').toEqual(
      [],
    );
  });

  it('and there are real data-screen rules to check (non-vacuity)', () => {
    expect(
      attributeSelectors().filter((s) => s.name === 'data-screen').length,
      'no per-screen rule at all — the whole restyle layer is unkeyed',
    ).toBeGreaterThan(8);
  });

  it('the renderer writes it, and writes it through the pure helper', () => {
    // The other end of this one lives in `screensSource.test.ts`; named here so a reader of
    // this file knows the coupling is closed rather than half-closed, which is the mistake
    // that made this whole test file necessary.
    const game = readFileSync(join(SRC_ROOT, 'desktop/game.ts'), 'utf8');
    expect(game).toMatch(/dataset\['screen'\]\s*=\s*screenKey\s*\(/);
  });
});
