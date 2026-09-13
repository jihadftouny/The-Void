// PLAYER PREFERENCES — the pure core (PLAN.md #8 / FINDINGS.md B1, S4b, S4c).
//
// LOAD-BEARING PRINCIPLES honoured here:
//  - Pure logic / render split: this module imports NOTHING but `tokens.ts`. No DOM, no
//    storage, no logger (`purity.test.ts` forbids `src/render` reaching `src/log` at all).
//    Every decision a setting makes is a pure function, so all of it is unit-tested under
//    Vitest's `node` environment.
//  - Single source of truth: not one colour or size is invented here. High contrast swaps in
//    `HIGH_CONTRAST` from `tokens.ts`; the text scale is a table whose middle column is
//    byte-identical to `TYPE`, asserted rather than assumed.
//  - Serializable plain data: `Settings` is a versioned plain object, so it round-trips
//    through JSON into `localStorage` and back.
//
// ⚠ SETTINGS ARE NOT GAME STATE, and deliberately do not enter the save envelope. They carry
// no gameplay consequence — a run played at large text is the same run — so putting them in
// the run save would make two players' saves incompatible over a preference. They live under
// their own storage key, like the unlock store does.
//
// ⚠ SCOPE — A DELIBERATE DEVIATION FROM `UI-DESIGN.md` §12, recorded per CLAUDE.md.
// §12's table lists five groups: audio, accessibility, text, narration, display. This ships
// ONLY accessibility — text size, reduced motion, high contrast. The other four control
// systems that DO NOT EXIST YET (audio is #15, narration speed and on/off are #6/#12,
// display is #14). The reason is the scar this project keeps re-cutting itself on: **a
// control that never enabled the thing it controlled for.** A volume slider wired to nothing
// is that defect, shipped on purpose, and it is worse than a smaller screen that works. The
// screen is row-model-driven, so each future group is a data addition, not a rewrite.
// (Author's answer, 2026-09-07: "the reduced subset is right. Confirmed.")

import { HIGH_CONTRAST, TYPE, floorTheme } from './tokens.ts';

/** How large the interface's type is. */
export type TextScale = 'small' | 'normal' | 'large';

/** Whether the interface animates. `system` follows the OS's own `prefers-reduced-motion`. */
export type MotionSetting = 'system' | 'reduce' | 'full';

/** Whether the five floor environments are painted, or replaced by pure black on white. */
export type ContrastSetting = 'normal' | 'high';

/** The whole of a player's preferences. Plain data; `v` is the migration hook. */
export interface Settings {
  v: 1;
  textScale: TextScale;
  motion: MotionSetting;
  contrast: ContrastSetting;
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  textScale: 'normal',
  motion: 'system',
  contrast: 'normal',
};

/** The current payload version. A stored payload of any other version is discarded. */
export const SETTINGS_VERSION = 1;

const TEXT_SCALES: readonly TextScale[] = ['small', 'normal', 'large'];
const MOTION_SETTINGS: readonly MotionSetting[] = ['system', 'reduce', 'full'];
const CONTRAST_SETTINGS: readonly ContrastSetting[] = ['normal', 'high'];

/** The seven steps of the type scale, smallest first — the order every column below uses. */
export const TYPE_STEPS = ['xs', 'sm', 'md', 'base', 'lg', 'xl', 'xxl'] as const;
export type TypeStep = (typeof TYPE_STEPS)[number];

/**
 * THE TEXT SCALE, AS A HAND-WRITTEN TABLE rather than a multiplier.
 *
 * A multiplier is the obvious implementation and it is wrong twice over. It produces
 * fractional pixel sizes that render differently on every DPI, and — the real problem — it
 * scales the FLOOR as well as the ceiling, so "small" would put condition chips at 9px. The
 * rule is that no text in the game is ever set below 11px, on any setting, and a table is
 * the only way to say that and mean it.
 *
 * THE CONSEQUENCE, STATED PLAINLY: because 11px is already the smallest step at `normal`,
 * the `small` column cannot shrink the bottom of the scale at all. It compresses the TOP —
 * headings, the wordmark, the run summary — and leaves the small print where it is. So
 * `small` and `normal` share their first value by construction, and that is the floor doing
 * its job, not an oversight.
 *
 * Every number below is written by hand and asserted for monotonicity and for the 11px floor
 * in `settings-model.test.ts`; the `normal` column is asserted BYTE-IDENTICAL to `TYPE`, so
 * a change to the base scale that forgets this table fails the build.
 */
export const TEXT_SCALE_TABLE: Readonly<Record<TextScale, Readonly<Record<TypeStep, string>>>> = {
  small: { xs: '11px', sm: '12px', md: '13px', base: '14px', lg: '16px', xl: '20px', xxl: '28px' },
  normal: { xs: '11px', sm: '12px', md: '13px', base: '15px', lg: '18px', xl: '24px', xxl: '34px' },
  large: { xs: '13px', sm: '14px', md: '16px', base: '18px', lg: '22px', xl: '29px', xxl: '41px' },
};

/** The absolute floor. No setting, on any screen, may put text below this. */
export const MIN_TEXT_PX = 11;

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Parse whatever came out of storage. TOTAL — never throws, never returns a partial object.
 *
 * Each field falls back INDEPENDENTLY, so one corrupt field costs one preference rather than
 * all of them. The version is the one all-or-nothing gate: a payload written by a future
 * version of the game may mean something different by the same field names, so it is
 * discarded whole rather than half-believed.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const o = raw as Record<string, unknown>;
  if (o['v'] !== SETTINGS_VERSION) return DEFAULT_SETTINGS;
  return {
    v: 1,
    textScale: isOneOf(TEXT_SCALES, o['textScale']) ? o['textScale'] : DEFAULT_SETTINGS.textScale,
    motion: isOneOf(MOTION_SETTINGS, o['motion']) ? o['motion'] : DEFAULT_SETTINGS.motion,
    contrast: isOneOf(CONTRAST_SETTINGS, o['contrast'])
      ? o['contrast']
      : DEFAULT_SETTINGS.contrast,
  };
}

/** The stored form. Explicit rather than a spread, so a future field cannot leak by accident. */
export function serializeSettings(s: Settings): string {
  return JSON.stringify({ v: s.v, textScale: s.textScale, motion: s.motion, contrast: s.contrast });
}

/**
 * The `--void-*` overrides a settings state imposes ON TOP OF a floor's theme.
 *
 * ⚠ WHY IT TAKES THE FLOOR. This function is TOTAL over the names it governs: in `normal`
 * mode it re-emits the FLOOR's own values rather than emitting nothing. That is what makes
 * `applySettings` idempotent and reversible — turning high contrast back off restores the
 * floor, on the same element, with no property removal and no second write path. A version
 * that only emitted overrides would leave `--void-ink: #ffffff` stuck on the root forever
 * after one visit to the settings screen.
 *
 * ⚠ EVERY KEY IT RETURNS IS A KEY `themeVars` ALSO RETURNS. That is asserted, not assumed:
 * it is what keeps the whole settings layer inside `tokens.test.ts`'s CSS-resolution walk by
 * construction, rather than needing its own parallel guard that could drift.
 *
 * ⚠ REVISED 2026-09-12 (`floor-looks`): IT NOW RESOLVES THE ACCENT AND THE THREE ROLES TOO.
 * Floor 2 became a light floor, and high contrast must still paint it black. On black, floor
 * 2's own roles (dark crimson, dark green, dark amber) and its deep-red accent (2.1:1) would
 * all but vanish, so under high contrast the roles become `HIGH_CONTRAST`'s and the accent
 * becomes the floor's `accentOnBlack`. The accent still SURVIVES high contrast — it is still
 * the floor's own, per floor — it is only that a light floor's accent has no legal value on
 * black. In normal mode all four are the floor's own, so the setting stays total and
 * reversible exactly as before.
 */
export function settingsVars(s: Settings, place: number): Record<string, string> {
  const floor = floorTheme(place);
  const scale = TEXT_SCALE_TABLE[s.textScale];
  const high = s.contrast === 'high';
  return {
    '--void-type-xs': scale.xs,
    '--void-type-sm': scale.sm,
    '--void-type-md': scale.md,
    '--void-type-base': scale.base,
    '--void-type-lg': scale.lg,
    '--void-type-xl': scale.xl,
    '--void-type-xxl': scale.xxl,
    '--void-bg': high ? HIGH_CONTRAST.bg : floor.bg,
    '--void-panel': high ? HIGH_CONTRAST.panel : floor.panel,
    '--void-panel-raised': high ? HIGH_CONTRAST.panelRaised : floor.panelRaised,
    '--void-ink': high ? HIGH_CONTRAST.ink : floor.ink,
    '--void-ink-dim': high ? HIGH_CONTRAST.inkDim : floor.inkDim,
    '--void-ink-faint': high ? HIGH_CONTRAST.inkFaint : floor.inkFaint,
    '--void-rule': high ? HIGH_CONTRAST.rule : floor.rule,
    '--void-rule-strong': high ? HIGH_CONTRAST.ruleStrong : floor.ruleStrong,
    '--void-harm': high ? HIGH_CONTRAST.harm : floor.harm,
    '--void-heal': high ? HIGH_CONTRAST.heal : floor.heal,
    '--void-foe': high ? HIGH_CONTRAST.foe : floor.foe,
    '--void-accent': high ? (floor.accentOnBlack ?? floor.accent) : floor.accent,
    // THE ATMOSPHERE IS TURNED OFF, not dimmed. Zero, so the composite the contrast gate
    // measures IS the ground — which is why high contrast can be proved to beat every floor.
    '--void-texture-opacity': high ? '0' : String(floor.texture.opacity),
  };
}

/**
 * Does the interface animate? `system` defers to the OS signal; the other two override it in
 * both directions, because a player whose OS setting is wrong for them needs a way to say so.
 *
 * The CSS mirrors this exactly — a `prefers-reduced-motion` media query that exempts
 * `[data-motion='full']`, plus a `[data-motion='reduce']` rule — and `styleDiscipline.test.ts`
 * asserts both blocks exist. This function is what the SCRIPT side (the canvas layer, #7, and
 * the battle sequencing, #6) will read, so the two stay one decision.
 */
export function motionEnabled(setting: MotionSetting, osReduced: boolean): boolean {
  if (setting === 'reduce') return false;
  if (setting === 'full') return true;
  return !osReduced;
}

/**
 * The `data-screen` value the whole restyle layer is keyed off. PURE, so the mapping is
 * tested rather than inferred from a screenshot.
 *
 * The render-layer `screen` mode wins when it is not the plain game view, because those
 * modes (inventory, character sheet, settings, the abandon confirmation) are reached WITHOUT
 * an engine transition — `awaiting` is still `main-menu` behind all four of them, so keying
 * on `awaiting` alone would style them all as the hub.
 */
export function screenKey(awaiting: string, screen: string): string {
  return screen === 'game' ? awaiting : screen;
}

/**
 * Which of the two stage layouts a screen is drawn in. PURE, beside `screenKey`, for the
 * same reason: the mapping is a decision, and a decision belongs in a tested function
 * rather than in a condition inside the one file no test can import.
 *
 *  - `side`  — the reading column and the choice column stand SIDE BY SIDE. The prose keeps
 *              a guaranteed floor of eight lines because the buttons no longer compete with
 *              it for vertical space. This is the default, and it is what fixed the defect
 *              this unit exists for: the choices used to live INSIDE the reading column, and
 *              a six-row hub menu starved the narration to zero pixels at the minimum window.
 *  - `wide`  — the reading column is capped and the choice area takes the rest, because on
 *              these seven screens `#choices` is not a row of buttons at all: it is a whole
 *              DOCUMENT (the inventory, the character sheet, the settings screen, the content
 *              warning, the end-of-run record) or a wordmark with two stacked buttons (title,
 *              resume). A 260px column would be the wrong shape for every one of them.
 *  - `stage` — the BATTLE (PLAN.md #6, UI-DESIGN.md §1): the JRPG frame. The enemy on a framed
 *              stage in the centre with the prose beneath it, the player's stat box
 *              bottom-left, the action menu bottom-right; the HUD column gives way to the stat
 *              box. The prose floor is four lines here, not eight — the recorded deviation.
 */
export type LayoutMode = 'side' | 'wide' | 'stage';

/**
 * The screens drawn as the framed stage. One today: a live fight. #11 adds no new screen key
 * (its talk input lives inside this one), so this set grows only if a second kind of fight does.
 */
export const STAGE_SCREENS: ReadonlySet<string> = new Set(['battle-action']);

/**
 * The seven screens that render a document rather than a short list of actions.
 *
 * A SET rather than a chain of `||`, and exported so the test can assert the mapping over an
 * exhaustive table of every screen key the game can produce — adding a new `Awaiting` member
 * fails to compile that table until somebody classifies it.
 */
export const WIDE_SCREENS: ReadonlySet<string> = new Set([
  'title',
  'resume',
  'content-warning',
  'inventory',
  'sheet',
  'settings',
  'game-over',
]);

/**
 * The layout mode for a screen key (the value `screenKey` produces).
 *
 * Unknown keys are `side`, deliberately: `side` is the mode that guarantees the prose its
 * floor, so a screen nobody remembered to classify still gets a readable narration rather
 * than a capped one.
 */
export function screenLayout(key: string): LayoutMode {
  if (STAGE_SCREENS.has(key)) return 'stage';
  return WIDE_SCREENS.has(key) ? 'wide' : 'side';
}

/**
 * The persistent floor tag — `UI-DESIGN.md` §11 and `FINDINGS.md` S4a, which is the rule that
 * the accent may never be the only carrier of any state. THE NAME CARRIES THE MEANING; the
 * colour is reinforcement. A colourblind player and a screen reader both get the floor here.
 *
 * 1-BASED, because every design document numbers the floors 1..5 while the engine's `place`
 * is 0..4, and the tag is player-facing. `floorTheme` clamps, so no `place` can produce a
 * tag that lies about the range.
 */
export function floorTagText(place: number): string {
  const floor = floorTheme(place);
  return `Floor ${floor.place + 1} — ${floor.name}`;
}

/** The type scale as it ships today, for the `normal` column's identity assertion. */
export const BASE_TYPE = TYPE;

// ---------------------------------------------------------------------------------------
// THE SETTINGS SCREEN, AS A MODEL. The screen is built by iterating this; adding the audio
// group when #15 exists is an entry here plus a field on `Settings`, not a rewrite of a
// builder. Keeping the labels and the help text in the pure layer also means the WORDS are
// unit-testable, which matters because they are the only explanation a player ever gets.
// ---------------------------------------------------------------------------------------

/** The settings this screen can change. Narrowed from `keyof Settings` so `v` is unreachable. */
export type SettingsField = 'textScale' | 'motion' | 'contrast';

export interface SettingsOption {
  value: string;
  label: string;
}

export interface SettingsRow {
  field: SettingsField;
  label: string;
  /** One sentence saying what the control does, in plain language. */
  help: string;
  options: readonly SettingsOption[];
}

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  {
    field: 'textScale',
    label: 'Text size',
    help: 'How large every word in the game is set. Nothing goes below 11 pixels on any setting.',
    options: [
      { value: 'small', label: 'Small' },
      { value: 'normal', label: 'Normal' },
      { value: 'large', label: 'Large' },
    ],
  },
  {
    field: 'motion',
    label: 'Motion',
    help: 'Whether the interface animates. Follow this device unless you choose otherwise.',
    options: [
      { value: 'system', label: 'Follow this device' },
      { value: 'reduce', label: 'Reduced' },
      { value: 'full', label: 'Full' },
    ],
  },
  {
    field: 'contrast',
    label: 'Contrast',
    help: 'High contrast replaces each floor’s colours and texture with plain black and white.',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'high', label: 'High' },
    ],
  },
];
