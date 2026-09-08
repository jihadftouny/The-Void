// THE PLAYER'S PREFERENCES, as pure decisions (PLAN.md #8 / FINDINGS.md B1, S4b, S4c).
//
// WHY EVERY NUMBER BELOW IS WRITTEN OUT BY HAND. The text scale is a table, not a
// multiplier, precisely so that the floor (11px) is a stated rule rather than an emergent
// property of an arithmetic nobody checks. A test that read the sizes back out of
// `TEXT_SCALE_TABLE` and asserted they are increasing would be asking the table to agree
// with itself. So the expected columns are transcribed here independently, and the table is
// asserted against THEM.
//
// HIGH CONTRAST IS TESTED AS A REAL FEATURE, not a flag. `A.1` makes the five floors bold,
// and bold is only safe because there is a way to turn it off; so the assertions here are
// "the atmosphere is really gone" and "the ink really clears AAA", measured with the same
// WCAG function `tokens.test.ts` anchors against hand-derived values before trusting it.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MIN_TEXT_PX,
  SETTINGS_ROWS,
  SETTINGS_VERSION,
  TEXT_SCALE_TABLE,
  TYPE_STEPS,
  floorTagText,
  motionEnabled,
  parseSettings,
  screenKey,
  serializeSettings,
  settingsVars,
  type ContrastSetting,
  type MotionSetting,
  type Settings,
  type TextScale,
} from './settings-model.ts';
import {
  FLOOR_THEMES,
  HIGH_CONTRAST,
  PALETTE,
  TYPE,
  contrastRatio,
  floorTheme,
  themeVars,
} from './tokens.ts';

/** The WCAG thresholds, as constants rather than magic numbers at each call site. */
const AAA_BODY = 7;
const AA_TEXT = 4.5;

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

// =========================================================================================
// The text scale. THE TABLE, TRANSCRIBED BY HAND — this is the independent expectation.
// =========================================================================================

/**
 * What each column is supposed to be, written here from the design and NOT read from the
 * implementation. If `TEXT_SCALE_TABLE` and this disagree, one of them is wrong and the
 * failure says which step.
 */
const EXPECTED_PX: Record<TextScale, number[]> = {
  //         xs  sm  md  base lg  xl  xxl
  small: [11, 12, 13, 14, 16, 20, 28],
  normal: [11, 12, 13, 15, 18, 24, 34],
  large: [13, 14, 16, 18, 22, 29, 41],
};

/** `'15px'` -> 15. Throws on anything that is not a plain integer px value. */
function px(value: string): number {
  const m = /^(\d+)px$/.exec(value);
  if (!m) throw new Error(`not an integer px size: ${value}`);
  return Number(m[1]);
}

describe('the text scale is a table, and the table is the one that was designed', () => {
  it('has all seven steps in all three columns', () => {
    expect(TYPE_STEPS).toHaveLength(7);
    for (const scale of ['small', 'normal', 'large'] as const) {
      expect(Object.keys(TEXT_SCALE_TABLE[scale]).sort()).toEqual([...TYPE_STEPS].sort());
    }
  });

  it('matches the hand-written columns exactly, step by step', () => {
    for (const scale of ['small', 'normal', 'large'] as const) {
      const actual = TYPE_STEPS.map((step) => px(TEXT_SCALE_TABLE[scale][step]));
      expect(actual, `the ${scale} column drifted from the designed one`).toEqual(
        EXPECTED_PX[scale],
      );
    }
  });

  it('every column increases STRICTLY — no two steps of the scale collide', () => {
    for (const scale of ['small', 'normal', 'large'] as const) {
      const sizes = TYPE_STEPS.map((step) => px(TEXT_SCALE_TABLE[scale][step]));
      for (let i = 1; i < sizes.length; i += 1) {
        expect(
          sizes[i]!,
          `${scale}: ${TYPE_STEPS[i]} (${sizes[i]}) does not exceed ${TYPE_STEPS[i - 1]} (${sizes[i - 1]})`,
        ).toBeGreaterThan(sizes[i - 1]!);
      }
    }
  });

  it('and NOTHING in the game is set below 11px, on any setting', () => {
    // The rule the table exists to make sayable. A multiplier-based `small` would put the
    // 11px condition chips at 9px, which is the whole reason this is not a multiplier.
    expect(MIN_TEXT_PX).toBe(11);
    for (const scale of ['small', 'normal', 'large'] as const) {
      for (const step of TYPE_STEPS) {
        expect(px(TEXT_SCALE_TABLE[scale][step]), `${scale}.${step}`).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it('the `normal` column is byte-identical to the base scale in tokens.ts', () => {
    // Two tables holding the same seven sizes is a drift waiting to happen: change TYPE and
    // forget this and `normal` silently stops being the default scale.
    for (const step of TYPE_STEPS) {
      expect(TEXT_SCALE_TABLE.normal[step], `normal.${step}`).toBe(TYPE[step]);
    }
  });

  it('`large` really is larger at EVERY step, and `small` never larger', () => {
    for (const step of TYPE_STEPS) {
      const small = px(TEXT_SCALE_TABLE.small[step]);
      const normal = px(TEXT_SCALE_TABLE.normal[step]);
      const large = px(TEXT_SCALE_TABLE.large[step]);
      expect(large, `large.${step} is not larger than normal`).toBeGreaterThan(normal);
      expect(small, `small.${step} is larger than normal`).toBeLessThanOrEqual(normal);
    }
    // `small` cannot shrink the bottom of the scale — 11px is already the floor — so it
    // compresses the TOP. Asserted rather than left as a surprise: the two share their first
    // value BY CONSTRUCTION, and they differ where it matters.
    expect(px(TEXT_SCALE_TABLE.small.xs)).toBe(px(TEXT_SCALE_TABLE.normal.xs));
    expect(px(TEXT_SCALE_TABLE.small.xxl)).toBeLessThan(px(TEXT_SCALE_TABLE.normal.xxl));
  });
});

// =========================================================================================
// Parsing. TOTAL, per-field, version-gated.
// =========================================================================================

describe('parseSettings never throws and never returns half a settings object', () => {
  it('the defaults are the ones the design names', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      v: 1,
      textScale: 'normal',
      motion: 'system',
      contrast: 'normal',
    });
  });

  it('garbage of every shape yields the defaults', () => {
    for (const raw of [
      null,
      undefined,
      0,
      42,
      '',
      'not json at all',
      true,
      [],
      ['textScale', 'large'],
      {},
      { textScale: 'large' }, // no version: discarded whole
      new Date(),
    ]) {
      expect(parseSettings(raw), JSON.stringify(raw) ?? 'undefined').toEqual(DEFAULT_SETTINGS);
    }
  });

  it('a payload of ANOTHER version is discarded whole, not half-believed', () => {
    // A future version may mean something different by the same field names, so a partial
    // read is worse than none. This is the one all-or-nothing gate.
    for (const v of [0, 2, 99, '1', null, undefined]) {
      expect(parseSettings({ v, textScale: 'large', motion: 'reduce', contrast: 'high' })).toEqual(
        DEFAULT_SETTINGS,
      );
    }
    expect(SETTINGS_VERSION).toBe(1);
  });

  it('each field falls back INDEPENDENTLY — one corrupt value costs one preference', () => {
    expect(
      parseSettings({ v: 1, textScale: 'enormous', motion: 'reduce', contrast: 'high' }),
    ).toEqual({ v: 1, textScale: 'normal', motion: 'reduce', contrast: 'high' });
    expect(parseSettings({ v: 1, textScale: 'large', motion: 7, contrast: 'high' })).toEqual({
      v: 1,
      textScale: 'large',
      motion: 'system',
      contrast: 'high',
    });
    expect(parseSettings({ v: 1, textScale: 'large', motion: 'full', contrast: {} })).toEqual({
      v: 1,
      textScale: 'large',
      motion: 'full',
      contrast: 'normal',
    });
  });

  it('accepts every legal value of every field', () => {
    for (const textScale of ['small', 'normal', 'large'] as TextScale[]) {
      expect(parseSettings({ v: 1, textScale }).textScale).toBe(textScale);
    }
    for (const motion of ['system', 'reduce', 'full'] as MotionSetting[]) {
      expect(parseSettings({ v: 1, motion }).motion).toBe(motion);
    }
    for (const contrast of ['normal', 'high'] as ContrastSetting[]) {
      expect(parseSettings({ v: 1, contrast }).contrast).toBe(contrast);
    }
  });

  it('serialize -> JSON.parse -> parse is the identity, for every combination', () => {
    for (const textScale of ['small', 'normal', 'large'] as TextScale[]) {
      for (const motion of ['system', 'reduce', 'full'] as MotionSetting[]) {
        for (const contrast of ['normal', 'high'] as ContrastSetting[]) {
          const original = settings({ textScale, motion, contrast });
          const restored = parseSettings(JSON.parse(serializeSettings(original)));
          expect(restored).toEqual(original);
        }
      }
    }
  });

  it('and the stored form carries nothing but the four declared fields', () => {
    // An explicit object rather than a spread, so a future field cannot leak into storage
    // before anybody has decided it should.
    const stored = JSON.parse(
      serializeSettings({ ...settings({ textScale: 'large' }), extra: 'x' } as unknown as Settings),
    ) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['contrast', 'motion', 'textScale', 'v']);
  });
});

// =========================================================================================
// settingsVars — the override layer. Its key set is what keeps the settings inside the
// existing CSS-resolution walk in tokens.test.ts by construction.
// =========================================================================================

describe('settingsVars only ever writes names the theme already defines', () => {
  const themeKeys = new Set(Object.keys(themeVars(0)));

  it('every key it emits is a key themeVars emits, on every floor and every setting', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      for (const contrast of ['normal', 'high'] as ContrastSetting[]) {
        for (const textScale of ['small', 'normal', 'large'] as TextScale[]) {
          for (const name of Object.keys(settingsVars(settings({ contrast, textScale }), place))) {
            expect(themeKeys.has(name), `${name} is not a token themeVars writes`).toBe(true);
          }
        }
      }
    }
  });

  it('and it emits enough of them to be doing anything (non-vacuity)', () => {
    expect(Object.keys(settingsVars(DEFAULT_SETTINGS, 0)).length).toBeGreaterThanOrEqual(10);
  });

  it('every value is a plain string, writable straight to style.setProperty', () => {
    for (const [name, value] of Object.entries(settingsVars(settings({ contrast: 'high' }), 3))) {
      expect(typeof value, name).toBe('string');
      expect(value.length, name).toBeGreaterThan(0);
    }
  });

  it('in NORMAL mode it re-emits the floor’s own values — so the setting is reversible', () => {
    // The behaviour that makes `applySettings` idempotent: turning high contrast off restores
    // the environment with one write and no property removal. A version that emitted nothing
    // in normal mode would leave `--void-ink: #ffffff` stuck on the root forever.
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      const floor = floorTheme(place);
      const vars = settingsVars(settings({ contrast: 'normal' }), place);
      expect(vars['--void-bg']).toBe(floor.bg);
      expect(vars['--void-panel']).toBe(floor.panel);
      expect(vars['--void-panel-raised']).toBe(floor.panelRaised);
      expect(vars['--void-ink']).toBe(floor.ink);
      expect(vars['--void-ink-dim']).toBe(floor.inkDim);
      expect(vars['--void-texture-opacity']).toBe(String(floor.texture.opacity));
      expect(vars['--void-ink-faint']).toBe(PALETTE.inkFaint);
      expect(vars['--void-rule']).toBe(PALETTE.rule);
      expect(vars['--void-rule-strong']).toBe(PALETTE.ruleStrong);
    }
  });

  it('and the text sizes it writes are the column the player picked', () => {
    for (const scale of ['small', 'normal', 'large'] as TextScale[]) {
      const vars = settingsVars(settings({ textScale: scale }), 2);
      expect(vars['--void-type-xs']).toBe(TEXT_SCALE_TABLE[scale].xs);
      expect(vars['--void-type-base']).toBe(TEXT_SCALE_TABLE[scale].base);
      expect(vars['--void-type-xxl']).toBe(TEXT_SCALE_TABLE[scale].xxl);
    }
    // ...and the three columns really do differ where the player would notice, or the
    // assertion above would pass with one column copied three times.
    expect(settingsVars(settings({ textScale: 'small' }), 0)['--void-type-xxl']).not.toBe(
      settingsVars(settings({ textScale: 'large' }), 0)['--void-type-xxl'],
    );
  });
});

describe('high contrast is a real accessibility feature, not a flag', () => {
  it('THE CONTROL: the atmosphere is genuinely ON before it is turned off', () => {
    // "A control that never enabled the thing it controlled for" is this project's own scar.
    // Without this, "texture opacity is 0 in high contrast" is satisfied by a texture that
    // was never painted on any floor.
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      const on = settingsVars(settings({ contrast: 'normal' }), place)['--void-texture-opacity'];
      expect(Number(on), `floor ${place} has no atmosphere to turn off`).toBeGreaterThan(0);
    }
  });

  it('...and then it is GONE, not dimmed, on all five floors', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      expect(settingsVars(settings({ contrast: 'high' }), place)['--void-texture-opacity']).toBe(
        '0',
      );
    }
  });

  it('the same pure black-and-white pairing replaces every floor', () => {
    const grounds = new Set<string>();
    const inks = new Set<string>();
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      const vars = settingsVars(settings({ contrast: 'high' }), place);
      grounds.add(vars['--void-bg']!);
      inks.add(vars['--void-ink']!);
    }
    expect(grounds.size, 'high contrast still differs by floor').toBe(1);
    expect(inks.size).toBe(1);
    expect([...grounds][0]).toBe(HIGH_CONTRAST.bg);
    expect([...inks][0]).toBe(HIGH_CONTRAST.ink);
  });

  it('its ink clears AAA on its own panel AND on the ordinary one', () => {
    // Measured with the WCAG function `tokens.test.ts` anchors against hand-derived values
    // (white-on-black = 21:1, a colour on itself = 1:1) BEFORE any palette is gated with it.
    expect(contrastRatio(HIGH_CONTRAST.ink, HIGH_CONTRAST.panel)).toBeGreaterThanOrEqual(AAA_BODY);
    expect(contrastRatio(HIGH_CONTRAST.ink, PALETTE.panel)).toBeGreaterThanOrEqual(AAA_BODY);
    // The dimmed and faint inks are still TEXT, so they clear AA at minimum.
    expect(contrastRatio(HIGH_CONTRAST.inkDim, HIGH_CONTRAST.bg)).toBeGreaterThanOrEqual(AAA_BODY);
    expect(contrastRatio(HIGH_CONTRAST.inkFaint, HIGH_CONTRAST.bg)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('and it beats the floor it replaced, on every floor — or it is not "high" contrast', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      const floor = floorTheme(place);
      const normal = contrastRatio(floor.ink, floor.bg);
      const high = contrastRatio(HIGH_CONTRAST.ink, HIGH_CONTRAST.bg);
      expect(high, `high contrast is no better than floor ${place}`).toBeGreaterThan(normal);
    }
  });

  it('the accent is left alone — it reinforces, it never carries state (S4a)', () => {
    for (let place = 0; place < FLOOR_THEMES.length; place += 1) {
      expect(settingsVars(settings({ contrast: 'high' }), place)['--void-accent']).toBeUndefined();
    }
  });
});

// =========================================================================================
// Motion. The one place where the OS and the player can disagree.
// =========================================================================================

describe('motionEnabled resolves the OS signal and the player’s override', () => {
  it('the whole truth table, both OS states', () => {
    // Written out rather than looped: six cases, and each is a sentence about behaviour.
    expect(motionEnabled('system', false), 'system, OS wants motion').toBe(true);
    expect(motionEnabled('system', true), 'system, OS wants less motion').toBe(false);
    expect(motionEnabled('reduce', false), 'player overrides an OS that wants motion').toBe(false);
    expect(motionEnabled('reduce', true), 'player agrees with the OS').toBe(false);
    expect(motionEnabled('full', false), 'player agrees with the OS').toBe(true);
    expect(motionEnabled('full', true), 'player overrides an OS that wants less').toBe(true);
  });

  it('and BOTH overrides really override — neither is a no-op', () => {
    // The two rows that matter: a player whose OS setting is wrong for them needs a way to
    // say so in each direction. If either override merely followed the OS, one of these fails.
    expect(motionEnabled('reduce', false)).not.toBe(motionEnabled('system', false));
    expect(motionEnabled('full', true)).not.toBe(motionEnabled('system', true));
  });
});

// =========================================================================================
// The two small string decisions the whole restyle hangs on.
// =========================================================================================

describe('screenKey picks the CSS hook', () => {
  it('falls through to the engine phase while the plain game view is showing', () => {
    for (const awaiting of ['title', 'main-menu', 'battle-action', 'game-over']) {
      expect(screenKey(awaiting, 'game')).toBe(awaiting);
    }
  });

  it('and the render-layer mode WINS, because the engine is still at main-menu behind it', () => {
    // Inventory, the character sheet, settings and the abandon confirmation are all reached
    // without an engine transition. Keying on `awaiting` alone would style all four as the hub.
    for (const screen of ['inventory', 'sheet', 'settings', 'confirm-abandon']) {
      expect(screenKey('main-menu', screen)).toBe(screen);
    }
  });

  it('and the four hub screens are therefore distinguishable from one another', () => {
    const keys = ['inventory', 'sheet', 'settings', 'confirm-abandon'].map((s) =>
      screenKey('main-menu', s),
    );
    expect(new Set(keys).size).toBe(4);
    expect(keys).not.toContain('main-menu');
  });
});

describe('the floor tag names the floor in WORDS (S4a / UI-DESIGN.md §11)', () => {
  /**
   * The five names, transcribed from `docs/ART-BIBLE.md` §4 and `docs/WORLD.md` §6 — the
   * documents, not the token table. If someone renames a floor in `tokens.ts`, this fails and
   * asks whether the DOCS moved too.
   */
  const NAMES = ['Undercity', 'Entrance to the Void', 'Ash City', 'Angelic Underground', 'True Void'];

  it('reads "Floor N — Name", 1-based, for each of the five', () => {
    for (let i = 0; i < NAMES.length; i += 1) {
      expect(floorTagText(i)).toBe(`Floor ${i + 1} — ${NAMES[i]}`);
    }
  });

  it('is 1-BASED, because every design document numbers the floors 1..5', () => {
    expect(floorTagText(0)).toContain('Floor 1');
    expect(floorTagText(4)).toContain('Floor 5');
    expect(floorTagText(0)).not.toContain('Floor 0');
  });

  it('and a garbage place still produces a truthful tag rather than throwing', () => {
    // The tag renders on every screen including the title, so it must be total.
    expect(floorTagText(-3)).toBe(`Floor 1 — ${NAMES[0]}`);
    expect(floorTagText(99)).toBe(`Floor 5 — ${NAMES[4]}`);
    expect(floorTagText(Number.NaN)).toBe(`Floor 1 — ${NAMES[0]}`);
    expect(floorTagText(2.9)).toBe(`Floor 3 — ${NAMES[2]}`);
  });

  it('carries no colour word and no accent — the NAME is the channel', () => {
    // S4a's rule: the accent may never be the only carrier of any state, and the corollary
    // is that the tag must work with the colour removed entirely.
    for (let i = 0; i < NAMES.length; i += 1) {
      expect(floorTagText(i)).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});

// =========================================================================================
// The settings screen's ROW MODEL — the words are the only explanation a player ever gets,
// so they are unit-testable rather than buried in a builder.
// =========================================================================================

describe('the settings rows describe controls that actually control something', () => {
  it('ships exactly the three accessibility controls, and no dead ones', () => {
    // The recorded deviation from UI-DESIGN.md §12, asserted so it cannot drift silently:
    // audio (#15), narration (#6/#12) and display (#14) groups arrive with those units.
    expect(SETTINGS_ROWS.map((r) => r.field)).toEqual(['textScale', 'motion', 'contrast']);
  });

  it('every row offers every legal value of its field, in a stable order', () => {
    const expected: Record<string, string[]> = {
      textScale: ['small', 'normal', 'large'],
      motion: ['system', 'reduce', 'full'],
      contrast: ['normal', 'high'],
    };
    for (const row of SETTINGS_ROWS) {
      expect(row.options.map((o) => o.value), row.field).toEqual(expected[row.field]);
    }
  });

  it('and every option is one `parseSettings` accepts — a control cannot offer a bad value', () => {
    for (const row of SETTINGS_ROWS) {
      for (const option of row.options) {
        const parsed = parseSettings({ ...DEFAULT_SETTINGS, [row.field]: option.value });
        expect(parsed[row.field], `${row.field}=${option.value} was rejected by the parser`).toBe(
          option.value,
        );
      }
    }
  });

  it('every label and every option label is real, human text', () => {
    for (const row of SETTINGS_ROWS) {
      expect(row.label.trim().length).toBeGreaterThan(2);
      expect(row.help.trim().length, `${row.field} has no explanation`).toBeGreaterThan(20);
      // Plain language, per CLAUDE.md: no identifier leaks into the screen. Matched as
      // camelCase rather than as `row.field`, because "contrast" and "motion" are ordinary
      // English words a help sentence is entitled to use, while `textScale` never is.
      const CAMEL = /[a-z][A-Z]/;
      expect(CAMEL.test(row.help), `${row.field}'s help text names an identifier`).toBe(false);
      expect(CAMEL.test('textScale'), 'the identifier detector matches nothing').toBe(true);
      for (const option of row.options) {
        expect(option.label.trim().length, `${row.field}/${option.value}`).toBeGreaterThan(0);
        expect(option.label, 'an option shows its raw value to the player').not.toBe(option.value);
      }
    }
  });
});
