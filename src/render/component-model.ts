// Pure models for the shared UI components — PURE, Kaplay-free, DOM-free (M-UI2).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split, taken one step further than "no DOM": everything about a
//    component that is worth TESTING lives here as a pure function over plain data, and
//    `components.ts` only turns the resulting model into elements. So the segment count a
//    player reads off an HP bar, the label on a condition chip, and the disabled state of
//    a menu action are all verified headlessly under `node`.
//  - It imports only TYPES and DATA TABLES from `src/game` (never the reverse), so the
//    engine stays ignorant of the renderer.
//  - It applies NO game rule. It never computes damage, never decides legality — it
//    formats and classifies values the engine already decided.

import type { ActiveCondition, ConditionType } from '../game/condition.ts';
import { CONDITION_DATA } from '../game/condition.ts';

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

/**
 * The fraction (0..1) of a bar that should read as filled, clamped. Formats an
 * already-computed value/max pair for the renderer — it applies NO game rule. A
 * non-positive `max` yields 0 (empty) rather than dividing by zero.
 *
 * Moved verbatim (with its tests) from the deleted `layout.ts`, where it was the one
 * display helper among that module's Kaplay letterbox geometry.
 */
export function hpFraction(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  const f = hp / maxHp;
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}

/** Everything a bar needs to draw itself, and nothing more. */
export interface BarModel {
  /** The raw value, as the engine reported it. */
  value: number;
  /** The raw max, as the engine reported it. */
  max: number;
  /** The player-facing readout, e.g. "34/60". */
  text: string;
  /** The filled proportion, clamped to [0,1]. */
  fraction: number;
}

/**
 * Model a value/max bar. `text` reports the engine's numbers verbatim (it must never
 * disagree with the sheet); only `fraction` is clamped, because a bar cannot draw itself
 * past its own ends.
 */
export function barModel(value: number, max: number): BarModel {
  return { value, max, text: `${value}/${max}`, fraction: hpFraction(value, max) };
}

/**
 * How many of `cells` segments to fill for a bar at `fraction` — the number the player
 * actually counts. Two edge rules, both deliberate and both player-facing:
 *
 *  - A LIVING combatant never shows an empty bar. Plain flooring would render 1 HP out of
 *    60 across 9 cells as floor(0.15) = 0 segments, i.e. visually dead. It shows 1.
 *  - A WOUNDED combatant never shows a full bar. Plain rounding would render 59 HP out of
 *    60 as round(8.85) = 9 of 9 segments, i.e. visually untouched. It shows 8.
 *
 * So only a true 0 reads empty, and only a true full reads full.
 */
export function barCells(fraction: number, cells: number): number {
  if (!Number.isFinite(fraction) || !Number.isFinite(cells) || cells <= 0) return 0;
  const total = Math.floor(cells);
  if (total <= 0) return 0;
  const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  if (f <= 0) return 0;
  if (f >= 1) return total;
  const filled = Math.floor(f * total);
  return Math.min(Math.max(filled, 1), total - 1);
}

/** A bar that also carries a caption and a colour role (HP, charges, momentum, …). */
export interface ResourceBarModel extends BarModel {
  label: string;
  tone: BarTone;
}

/** Which palette role a bar draws itself in. */
export type BarTone = 'hp' | 'foe' | 'accent';

/** Model a labelled resource bar. Pure formatting over an already-decided value. */
export function resourceBarModel(
  label: string,
  value: number,
  max: number,
  tone: BarTone,
): ResourceBarModel {
  return { ...barModel(value, max), label, tone };
}

// ---------------------------------------------------------------------------
// Condition chips
// ---------------------------------------------------------------------------

/**
 * How a condition READS to the player. This is a display classification, not a game rule,
 * which is why it lives in the render layer and `src/game/condition.ts` is untouched:
 *  - 'control' — you (or the enemy) lose the turn. The most urgent thing on screen.
 *  - 'harm'    — it is hurting whoever carries it.
 *  - 'boon'    — it is helping whoever carries it.
 *
 * EXHAUSTIVE by construction: `Record<ConditionType, ConditionTone>` means adding a 26th
 * condition to the engine FAILS THE BUILD here rather than silently rendering it untoned.
 * (The same guard `format.ts` gets from its default-less switch.)
 */
export type ConditionTone = 'control' | 'harm' | 'boon';

export const CONDITION_TONE: Record<ConditionType, ConditionTone> = {
  // Control — the turn is lost. Mirrors the engine's CONTROL_CONDITIONS set.
  stun: 'control',
  sleep: 'control',
  freeze: 'control',
  aired: 'control',
  push: 'control',
  insanity: 'control',
  // Harm — damage over time, broken bones, and the six stat deprivations.
  bleed: 'harm',
  burn: 'harm',
  poison: 'harm',
  electrify: 'harm',
  fracture: 'harm',
  exposed: 'harm',
  weak: 'harm',
  slow: 'harm',
  sick: 'harm',
  dumb: 'harm',
  fool: 'harm',
  repulsive: 'harm',
  // Boon — regeneration and the six stat augmentations.
  regeneration: 'boon',
  strong: 'boon',
  quick: 'boon',
  healthy: 'boon',
  smart: 'boon',
  wise: 'boon',
  charming: 'boon',
};

/** Sort rank: the thing that stops you acting reads first, then what hurts, then what helps. */
const TONE_RANK: Record<ConditionTone, number> = { control: 0, harm: 1, boon: 2 };

/** One condition, as a chip. */
export interface ConditionChipModel {
  type: ConditionType;
  /** The engine's display name, e.g. "Burn" — never re-spelled here, so a rename can't drift. */
  name: string;
  /** Stack depth for a DoT; 1 for everything else (non-DoT conditions only ever refresh). */
  count: number;
  /** What the chip reads, e.g. "Burn ×2". */
  label: string;
  tone: ConditionTone;
  /** Turns left, for a countdown affordance. */
  remainingTurns: number;
}

/**
 * Model one active condition as a chip. The display name comes from the engine's
 * `CONDITION_DATA`, so renaming a condition in the engine renames it in the UI with no
 * edit here.
 */
export function conditionChip(active: ActiveCondition): ConditionChipModel {
  const data = CONDITION_DATA[active.type];
  // Only DoTs stack; a 'refresh' condition never has a meaningful intensity, so it always
  // reads x1 even if a stray intensity were ever written onto it.
  const count = data.stacking === 'dot' ? Math.max(active.intensity ?? 1, 1) : 1;
  return {
    type: active.type,
    name: data.displayName,
    count,
    label: `${data.displayName} ×${count}`,
    tone: CONDITION_TONE[active.type],
    remainingTurns: active.remainingTurns,
  };
}

/**
 * Model a combatant's whole condition row, ordered control -> harm -> boon. Within a tone
 * the engine's own storage order is preserved (a STABLE sort), so the row never reshuffles
 * for reasons the player cannot see.
 */
export function conditionChips(
  active: readonly ActiveCondition[],
): ConditionChipModel[] {
  return active
    .map((a, i) => ({ chip: conditionChip(a), i }))
    .sort((x, y) => {
      const d = TONE_RANK[x.chip.tone] - TONE_RANK[y.chip.tone];
      return d !== 0 ? d : x.i - y.i;
    })
    .map((entry) => entry.chip);
}

// ---------------------------------------------------------------------------
// Rows and buttons
// ---------------------------------------------------------------------------

/** A label/value row — the building block of the inventory and character-sheet screens. */
export interface RowModel {
  label: string;
  value: string;
  /** True when there is nothing to show; the view renders it dimmed and italic. */
  empty: boolean;
}

/**
 * Model a labelled row. A null/undefined/blank value is the EMPTY state and reads
 * "(empty)" — one definition of "nothing here", rather than each caller inventing its own.
 */
export function rowModel(label: string, value: string | null | undefined): RowModel {
  if (value === null || value === undefined || value === '') {
    return { label, value: '(empty)', empty: true };
  }
  return { label, value, empty: false };
}

/** A menu/action button. */
export interface ButtonModel {
  label: string;
  /** A disabled button is greyed AND inert — the view attaches no handler at all. */
  disabled: boolean;
  /** Optional trailing detail, e.g. a charge cost. */
  hint?: string;
}

/**
 * Model an action button. `disabled` is decided by the caller from engine state (e.g. an
 * unaffordable skill); this only records it, so the view has exactly one thing to check.
 */
export function buttonModel(
  label: string,
  opts: { disabled?: boolean; hint?: string } = {},
): ButtonModel {
  const model: ButtonModel = { label, disabled: opts.disabled === true };
  if (opts.hint !== undefined) model.hint = opts.hint;
  return model;
}
