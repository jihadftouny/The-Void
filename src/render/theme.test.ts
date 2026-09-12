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
import { arenaEls, buildArena, buildBattleMenu, buildVitals, playRound, setLogOpen } from '../desktop/battle.ts';
import { tempoGauge, type BattleMenuRow, type RoundPlan } from '../desktop/battle-model.ts';
import { barUpdateAt, beatSchedule, groupBeats } from './beat-model.ts';
import { conditionChips, resourceBarModel } from './component-model.ts';
import { makeCondition } from '../game/condition.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { ONE_OF_EVERY_EVENT } from '../game/eventSamples.testutil.ts';
import { FLOOR_THEMES, floorTheme, themeVars } from './tokens.ts';
import {
  DEFAULT_SETTINGS,
  motionEnabled,
  screenLayout,
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
 * The hooks `src/desktop/game.ts` writes rather than either applier, so they are excluded
 * from the applier checks — and then checked on their own terms at the bottom of this file
 * rather than simply waved through.
 *
 * `data-screen` comes from the pure `screenKey`; `data-layout` (added 2026-09-09 by
 * `layout-breathing-room`) from the pure `screenLayout`. Both are written by the ONE
 * `showScreen` funnel, together, which is itself pinned in `layoutSource.test.ts`.
 *
 * `data-log` (PLAN.md #6) is the battle frame's "the player opened the full log" flag, written
 * on the reading column by `battle.ts`'s `setLogOpen` — checked against the stylesheet at the
 * bottom of this file by CALLING that writer, both ends of the coupling named.
 */
const OWNED_ELSEWHERE = new Set(['data-screen', 'data-layout', 'data-log']);

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
    // `floor-looks` (2026-09-12): and the light floor's one inverted effect, the strike flash.
    expect(names, 'no stylesheet selects on the ground').toContain('data-ground');
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
// `data-ground` (`floor-looks`, 2026-09-12) — the ground as PAINTED. Floor 2 is the one light
// floor; high contrast paints it black like every other. The expected values are written by
// hand from the design (floor 2 light, the rest dark), not read from `floorTheme`.
// =========================================================================================

describe('data-ground says which ground is really painted', () => {
  /** The one light floor, by the plan: place 1, ART-BIBLE floor 2, the Entrance to the Void. */
  const LIGHT = 1;

  it('the theme writes light on floor 2 and dark on the other four', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      applyTheme(root, place);
      expect(root.getAttribute('data-ground'), `place ${place}`).toBe(place === LIGHT ? 'light' : 'dark');
    }
  });

  it('floor 2 in normal contrast stays LIGHT through the settings write', () => {
    applyTheme(root, LIGHT);
    applySettings(root, settings({ contrast: 'normal' }), LIGHT);
    expect(root.getAttribute('data-ground')).toBe('light');
  });

  it('floor 2 under HIGH CONTRAST is painted DARK — the white does not survive the setting', () => {
    applyTheme(root, LIGHT);
    applySettings(root, settings({ contrast: 'high' }), LIGHT);
    expect(root.getAttribute('data-ground'), 'high contrast left floor 2 declared light').toBe('dark');
    expect(root.style.getPropertyValue('--void-bg'), 'high contrast left the white ground').toBe('#000000');
  });

  it('and turning high contrast back off writes LIGHT again — reversible, like the tokens', () => {
    applyTheme(root, LIGHT);
    applySettings(root, settings({ contrast: 'high' }), LIGHT);
    applySettings(root, settings({ contrast: 'normal' }), LIGHT);
    expect(root.getAttribute('data-ground')).toBe('light');
    expect(root.style.getPropertyValue('--void-bg')).toBe(floorTheme(LIGHT).bg);
  });

  it('high contrast paints EVERY floor dark, in every motion and text setting', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      for (const motion of ['system', 'reduce', 'full'] as MotionSetting[]) {
        applyTheme(root, place);
        applySettings(root, settings({ contrast: 'high', motion }), place);
        expect(root.getAttribute('data-ground'), `place ${place}/${motion}`).toBe('dark');
      }
    }
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
    'deal-discard', // PLAN.md #2, Appendix A.3: the full-pack bargain
    'rest', // PLAN.md #2: the found rest spot (was 'rest-decision', whose decision is gone)
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
    //
    // ⚠ UPDATED 2026-09-09: the write goes through the `showScreen` funnel, which sets
    // `data-screen` and `data-layout` in one statement. Nothing is loosened — `screenKey` is
    // still pinned as the source of the value.
    const game = readFileSync(join(SRC_ROOT, 'desktop/game.ts'), 'utf8');
    expect(game).toMatch(/showScreen\s*\(\s*screenKey\s*\(/);
  });
});

// =========================================================================================
// `data-layout` — the SECOND hook neither applier owns, and the newest half-coupling risk.
//
// It selects the entire stage geometry. A stylesheet keyed to `[data-layout='wideish']`, or a
// `screenLayout` that returned a third value nothing styles, would leave a screen in whatever
// geometry the previous one had: a document rendered into a 260px action column, or a hub
// whose prose keeps a document screen's cap. Neither throws, and both look almost right.
// =========================================================================================

describe('every data-layout rule is keyed to a mode screenLayout can produce', () => {
  /**
   * The three modes, written out by hand from the design rather than imported. Importing the
   * union from `settings-model.ts` would ask the module under test to agree with itself,
   * which is the exact blindness the top of this file exists to remove. `stage` is PLAN.md
   * #6's framed battle (UI-DESIGN §1).
   */
  const MODES = new Set(['side', 'wide', 'stage']);

  it('no stylesheet is keyed to a stage layout that can never appear', () => {
    const unreachable = attributeSelectors()
      .filter((s) => s.name === 'data-layout')
      .filter((s) => !MODES.has(s.value))
      .map((s) => `${s.sheet} -> [data-layout='${s.value}']`);
    expect(unreachable, 'a stage-layout rule is keyed to a mode the renderer never writes')
      .toEqual([]);
  });

  it('and there is a real rule keyed to it (non-vacuity)', () => {
    // The `side` mode is the DEFAULT — it is the base rule and carries no attribute selector
    // — so exactly one of the two modes is expected to appear as a selector, and it is
    // `wide`. Asserting that specifically, because "at least one" would be satisfied by a
    // stylesheet that had lost the document layout entirely.
    const keyed = attributeSelectors().filter((s) => s.name === 'data-layout');
    expect(keyed.length, 'nothing selects on the stage layout at all').toBeGreaterThan(0);
    expect(keyed.map((s) => s.value), 'the document layout has no rules').toContain('wide');
    // PLAN.md #6: and the battle frame has its own, or a fight would be drawn as the hub.
    expect(keyed.map((s) => s.value), 'the framed stage has no rules').toContain('stage');
  });

  it('the renderer writes it, through the pure helper, for every mode', () => {
    const game = readFileSync(join(SRC_ROOT, 'desktop/game.ts'), 'utf8');
    expect(game, 'nothing writes the stage layout — it would never change').toMatch(
      /dataset\['layout'\]\s*=\s*screenLayout\s*\(/,
    );
    // ...and the mode the stylesheet is keyed to is one the pure function really returns.
    // Derived from the CSS side, so a `screenLayout` renamed to produce `'document'` fails
    // here rather than silently leaving every document screen in the action geometry.
    for (const key of ['main-menu', 'inventory', 'battle-action']) {
      expect([...MODES].includes(screenLayout(key)), key).toBe(true);
    }
    expect(screenLayout('inventory'), 'a document screen is not in the document layout').toBe(
      'wide',
    );
    expect(screenLayout('main-menu'), 'the hub is not in the action layout').toBe('side');
    expect(screenLayout('battle-action'), 'a live fight is not the framed stage').toBe('stage');
  });
});

// =========================================================================================
// `data-log` — the battle frame's opened-log flag (PLAN.md #6). The stylesheet hides the log
// behind the ticker unless `#column[data-log='open']`; `battle.ts`'s `setLogOpen` writes it.
// Both ends, by calling the real writer: a writer that wrote `'opened'` would leave the log
// closed forever with the toggle claiming otherwise.
// =========================================================================================

describe('the opened-log flag the stage selects on is the one the toggle writes', () => {
  it('the stylesheet keys the log on `data-log=open`, and on nothing else', () => {
    const keyed = attributeSelectors().filter((s) => s.name === 'data-log');
    expect(keyed.length, 'nothing selects on the opened-log flag — the log could never open').toBeGreaterThan(0);
    for (const s of keyed) expect(s.value, `${s.sheet} keys the log on '${s.value}'`).toBe('open');
  });

  it('and `setLogOpen` writes exactly those values, open and closed', () => {
    const column = document.createElement('div');
    const toggle = document.createElement('button');
    setLogOpen(column, toggle, true);
    expect(attributesOn(column)).toEqual(['data-log=open']);
    setLogOpen(column, toggle, false);
    expect(attributesOn(column)).toEqual(['data-log=closed']);
  });
});

// =========================================================================================
// THE BATTLE FRAME'S CLASSES — both ends of every class coupling (#6's fix round, F2;
// catalogue entry 9). `battle.ts` writes class names as bare strings — the struck side's
// `is-struck` / `is-shaking` / `is-tinted`, a tempo cell's `is-filled`, a float's tone — and
// only a stylesheet gives any of them a look. Neither the compiler nor any test saw the join:
// deleting the reduced-motion tint rule left the suite green while the script went on adding
// the class, so a struck side under reduced motion showed nothing at all.
//
// DERIVED FROM BOTH ENDS SEPARATELY, never one from the other. The CLASSES are what the real
// builders and the real sequencer put on the page — recorded while they run, over a frame and
// a round built to exercise every state (both motion modes, a float of every tone, a tempo
// gauge with lit cells, a greyed row). The SELECTORS are read out of the shipped stylesheets.
// =========================================================================================

/** Every class a shipped stylesheet's SELECTORS name — read from the selectors, not the bodies. */
function selectedClasses(sheets: readonly { css: string }[] = SHEETS): Set<string> {
  const out = new Set<string>();
  for (const sheet of sheets) {
    // An `@import 'x.css';` statement is not a selector; left in, its `.css` would read as a class.
    const css = sheet.css.replace(/@(?:import|charset)[^;]*;/g, '');
    for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const c of (rule[1] as string).matchAll(/\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)/g)) out.add(c[1] as string);
    }
  }
  return out;
}

/** The classes of a selector's SUBJECT — its last compound, after the last combinator. */
function subjectClasses(selector: string): string[] {
  const last = selector.trim().split(/\s*[>+~]\s*|\s+/).at(-1) ?? '';
  return [...last.matchAll(/\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)/g)].map((m) => m[1] as string);
}

/** Every comma-split selector of a set of stylesheets. */
function selectorsOf(sheets: readonly { css: string }[]): string[] {
  const out: string[] = [];
  for (const sheet of sheets) {
    const css = sheet.css.replace(/@(?:import|charset)[^;]*;/g, '');
    for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const part of (rule[1] as string).split(',')) if (part.trim()) out.push(part.trim());
    }
  }
  return out;
}

/** What the frame carried: every class, and every element's whole class list, at any moment. */
interface Carried {
  classes: Set<string>;
  /** Each element's class list as it stood at some moment — a set of classes per entry. */
  lists: string[][];
}

/**
 * Build the frame and play a round on it through the REAL `battle.ts`, recording every class any
 * element carried at any moment: every node added (and its subtree), every class attribute's
 * value before each change (`attributeOldValue`), and the final page. A class the sequencer adds
 * for one beat and removes at the next is caught by the second change's old value.
 */
async function classesTheFrameCarries(animate: boolean): Promise<Carried> {
  const seen = new Set<string>();
  const lists: string[][] = [];
  const note = (value: string | null): void => {
    const list = (value ?? '').split(/\s+/).filter(Boolean);
    if (list.length > 0) lists.push(list);
    for (const c of list) seen.add(c);
  };
  const sweep = (el: Element): void => {
    note(el.getAttribute('class'));
    for (const child of el.querySelectorAll('[class]')) note(child.getAttribute('class'));
  };
  const take = (records: MutationRecord[]): void => {
    for (const r of records) {
      if (r.type === 'attributes') note(r.oldValue);
      for (const n of r.addedNodes) if (n instanceof Element) sweep(n);
    }
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const observer = new MutationObserver(take);
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  // Every state the frame can show: conditions on both sides, a tempo gauge lit both ways, a
  // class resource, and every kind of menu row — greyed ones included.
  const chips = conditionChips([makeCondition('burn')]);
  const arena = document.createElement('div');
  const vitals = document.createElement('div');
  host.append(arena, vitals);
  arena.appendChild(buildArena({ name: 'Rust Chorister', hp: resourceBarModel('HP', 20, 30, 'foe'), chips, isBoss: true, tempo: tempoGauge(0.6) }, { line: '' }));
  vitals.appendChild(
    buildVitals({
      name: 'Probe',
      classLine: 'Enforcer · level 3',
      hp: resourceBarModel('HP', 12, 15, 'hp'),
      charges: resourceBarModel('Charges', 3, 5, 'accent'),
      resource: { kind: 'momentum', value: 2 },
      chips,
      tempo: tempoGauge(-0.4),
    }),
  );
  const rows: BattleMenuRow[] = [
    { kind: 'fight' },
    { kind: 'cast' },
    { kind: 'spare' },
    { kind: 'item' },
    { kind: 'run', enabled: false, reason: 'There is nowhere to go' },
    { kind: 'back' },
    { kind: 'cast-skill', option: { skillId: 'heavyStrike', name: 'Heavy Strike', chargeCost: 2, affordable: true } },
    { kind: 'cast-skill', option: { skillId: 'brace', name: 'Brace', chargeCost: 9, affordable: false } },
    { kind: 'use-item', option: { index: 0, name: 'Tonic', rarity: 'Common' } },
  ];
  host.appendChild(buildBattleMenu(rows, () => undefined));

  // A round with a blow on each side and a float of every tone: harm, heal, plain.
  const attack = ONE_OF_EVERY_EVENT.attack;
  const events: GameEvent[] = [
    { ...attack, subject: 'enemy', outcome: 'hit', damage: 3 },
    { ...attack, subject: 'player', outcome: 'miss', damage: 0 },
    { kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2 },
    { ...attack, subject: 'player', outcome: 'crit', damage: 9 },
  ];
  const beats = groupBeats(events);
  const plan: RoundPlan = {
    beats,
    schedule: beatSchedule(beats.length),
    updateAt: barUpdateAt(beats),
    lead: 0,
    bars: {
      player: { before: resourceBarModel('HP', 12, 15, 'hp'), after: resourceBarModel('HP', 11, 15, 'hp') },
      enemy: { before: resourceBarModel('HP', 20, 30, 'foe'), after: resourceBarModel('HP', 11, 30, 'foe') },
      charges: { before: resourceBarModel('Charges', 3, 5, 'accent'), after: resourceBarModel('Charges', 3, 5, 'accent') },
    },
  };
  const els = arenaEls(arena, vitals);
  expect(els, 'the frame the builders made is missing an element the sequencer needs').not.toBeNull();
  await playRound(plan, els!, { wait: () => Promise.resolve(), audio: { play: () => undefined }, animate });
  take(observer.takeRecords());
  sweep(host);
  observer.disconnect();
  host.remove();
  return { classes: seen, lists };
}

/** True when some element, at some moment, carried every one of `classes` at once. */
const carriedTogether = (carried: Carried, classes: readonly string[]): boolean =>
  carried.lists.some((list) => classes.every((c) => list.includes(c)));

describe('every class the battle frame carries is one a stylesheet selects on — and back', () => {
  it('BACKWARD: every class the builders and the sequencer write has a rule that selects it', async () => {
    const selected = selectedClasses();
    for (const animate of [true, false]) {
      const { classes } = await classesTheFrameCarries(animate);
      const unstyled = [...classes].filter((c) => !selected.has(c));
      expect(
        unstyled,
        `motion ${animate ? 'full' : 'reduced'}: the frame carries a class no stylesheet selects on — ` +
          'it looks wired, and a state it marks would show nothing',
      ).toEqual([]);
    }
  });

  it('...over the state classes that matter, really produced ON the elements they mark (non-vacuity)', async () => {
    // Not a list the check reads: proof that the fixture drove every state through the real
    // code, so "nothing unstyled" is not "nothing recorded". Checked as COMBINATIONS on one
    // element, because a class can be shared — `is-filled` also marks the HP bar's cells.
    const full = await classesTheFrameCarries(true);
    const reduced = await classesTheFrameCarries(false);
    for (const pair of [
      ['arena-figure', 'is-struck'],
      ['vitals-inner', 'is-shaking'],
      ['tempo-cell', 'is-filled'],
      ['arena-float', 'arena-float-harm'],
      ['arena-float', 'arena-float-heal'],
      ['arena-float', 'arena-float-plain'],
      ['void-button', 'is-disabled'],
    ]) {
      expect(carriedTogether(full, pair), `the full-motion round never produced ${pair.join('.')}`).toBe(true);
    }
    expect(carriedTogether(reduced, ['arena-figure', 'is-tinted']), 'the reduced-motion round never tinted the enemy').toBe(true);
    expect(carriedTogether(reduced, ['vitals-inner', 'is-tinted']), 'the reduced-motion round never tinted the stat box').toBe(true);
    expect(reduced.classes, 'the reduced-motion round flashed').not.toContain('is-struck');
  });

  it('FORWARD: every rule in battle.css reaches an element the frame really carries', async () => {
    // The other end of the same join: a rule keyed to a class — or a COMBINATION of classes —
    // that no element ever carries never matches. Judged on each selector's subject (its last
    // compound), so `.tempo-quick .tempo-cell.is-filled` needs a tempo cell that was really lit,
    // not merely some element somewhere carrying `is-filled`. Ids, attributes and pseudo-classes
    // in the subject are states this fixture does not all reach, and are not judged here.
    const battleCss = SHEETS.filter((s) => s.name === 'battle.css');
    expect(battleCss, 'battle.css is not among the scanned stylesheets').toHaveLength(1);
    const full = await classesTheFrameCarries(true);
    const reduced = await classesTheFrameCarries(false);
    const everything = new Set([...full.classes, ...reduced.classes]);
    const orphans = [...selectedClasses(battleCss)].filter((c) => !everything.has(c));
    expect(orphans, 'battle.css styles a class the battle frame never carries').toEqual([]);
    const judged = selectorsOf(battleCss).filter((s) => subjectClasses(s).length > 0);
    const unreached = judged.filter((s) => !carriedTogether(full, subjectClasses(s)) && !carriedTogether(reduced, subjectClasses(s)));
    expect(unreached, 'a battle.css rule reaches no element the frame ever carries').toEqual([]);
    expect(judged.length, 'battle.css has almost no class-keyed rules — this swept nothing').toBeGreaterThan(25);
  });

  it('the selector readers read selectors only, and every way a class is written in one', () => {
    const css =
      "@import './x.css';\n.a.is-b, .c .d { color: red; }\n[data-motion='reduce'] .e { animation: none; }\n" +
      ":root:not([data-motion='full']) .f:hover { opacity: 0.5; }\n@media (max-width: 899px) { .g { top: 1.5em; } }\n" +
      '.h > .i.is-j { color: red; }';
    expect([...selectedClasses([{ css }])].sort()).toEqual(['a', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'is-b', 'is-j']);
    expect(selectorsOf([{ css }]).map(subjectClasses)).toEqual([['a', 'is-b'], ['d'], ['e'], ['f'], ['g'], ['i', 'is-j']]);
    const carried: Carried = { classes: new Set(['i', 'is-j', 'k']), lists: [['i'], ['k', 'is-j']] };
    expect(carriedTogether(carried, ['i', 'is-j']), 'two elements stood in for one').toBe(false);
    expect(carriedTogether(carried, ['is-j', 'k'])).toBe(true);
  });
});
