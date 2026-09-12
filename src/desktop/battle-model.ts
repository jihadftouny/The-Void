// THE BATTLE SCREEN'S PURE HALF — what the framed stage shows, as plain data (PLAN.md #6).
//
// LOAD-BEARING PRINCIPLES honoured here:
//  - Pure logic / render split: views over `GameState`, built from the helpers that already
//    decide these things (`displayPlayer`, `castOptions`, `consumableOptions`, `spareOffered`,
//    `characterSheet`, `resourceBarModel`, `conditionChips`). No DOM, no logger, no clock.
//    Unit-tested under `node`; `battle.ts` turns these into elements and does nothing else.
//  - Engine-authoritative: every number here is a field the engine wrote. The round plan's
//    bars are the engine's values BEFORE and AFTER the step — the renderer decides when in the
//    second a bar is written, never what it says.
//  - Serializable render state: `BattleMenuMode` is a render-layer choice (which sub-menu is
//    open) and never enters `GameState` or the save.
//
// ⚠ HIDDEN THINGS STAY HIDDEN, by construction rather than by care. Nothing below reads
// `enemy.illusory` (floor 2's illusions are not revealed by the UI — the engine's own
// `illusion-struck` line is the only tell), the karma vector, `karmaWeighted` beyond the
// engine's own `spareAvailable` gate, `familyId`, or a boss's axis. `battle-model.test.ts`
// proves the illusion half by comparing every view with the same state's un-flagged twin.

import type { GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import {
  buttonModel,
  conditionChips,
  resourceBarModel,
  type ButtonModel,
  type ConditionChipModel,
  type ResourceBarModel,
} from '../render/component-model.ts';
import {
  barUpdateAt,
  beatSchedule,
  groupBeats,
  type BarKey,
  type Beat,
  type BeatSchedule,
} from '../render/beat-model.ts';
import {
  castOptions,
  characterSheet,
  consumableOptions,
  displayPlayer,
  spareOffered,
  type CastOption,
  type ConsumableOption,
} from './view-model.ts';

/**
 * THE TEMPO GAUGE (GAME-DESIGN.md §16.1), as the stage will draw it — RESERVED for `PLAN.md`
 * #1.6, which builds the engine half.
 *
 * §16.1: one number per combatant, drifting each round by a rate set by DEX (and Quick/Slow);
 * at +1.0 the combatant takes an EXTRA ACTION and at −1.0 LOSES its turn, the threshold then
 * spent. So it is a TWO-SIDED gauge from a centre line — filling toward the extra action,
 * emptying toward the lost turn — not a bar from zero, and it is shown on both combatants
 * beside their HP ("tempo is tactical; karma is thematic": this one is meant to be read).
 *
 * The engine has no tempo field yet (`statEffects` returns 0 for it), so no view carries one
 * and NOTHING RENDERS — no gauge, no "0.0", no label. #1.6 adds the field and one line per
 * view: `view.tempo = tempoGauge(combatant.tempo)`. The frame already has the room (the
 * layout probe's `battle-tempo` measures both gauges in place).
 */
export interface TempoGaugeModel {
  /** The engine's tempo, verbatim. */
  value: number;
  /** One decimal, signed: `+0.4`, `−0.3`, `0.0`. */
  text: string;
  /** How far toward +1.0 — the extra action — as 0..1. */
  quick: number;
  /** How far toward −1.0 — the lost turn — as 0..1. */
  slow: number;
  label: string;
}

/** Model the gauge for an engine tempo — PURE formatting of an engine value; no rule applied. */
export function tempoGauge(value: number): TempoGaugeModel {
  const rounded = Math.round(value * 10) / 10;
  const magnitude = Math.abs(rounded).toFixed(1);
  const text = rounded > 0 ? `+${magnitude}` : rounded < 0 ? `−${magnitude}` : '0.0';
  return {
    value,
    text,
    quick: Math.min(1, Math.max(0, value)),
    slow: Math.min(1, Math.max(0, -value)),
    label: 'Tempo',
  };
}

/** The enemy, as the arena shows it. */
export interface StageView {
  /** `enemy.fullName`, verbatim — set as TEXT by the builder, never markup. */
  name: string;
  hp: ResourceBarModel;
  chips: ConditionChipModel[];
  /** RESERVED for #1.6's tempo gauge (see `TempoGaugeModel`). Never set today. */
  tempo?: TempoGaugeModel;
  /** A boss rides on the battle. Drives no text; #11's talk seam reads it. */
  isBoss: boolean;
}

/** The player, as the stat box shows it. No XP, no Act, no karma: the frame has no room for
 *  what is not a fighting number, and karma is never shown anywhere. */
export interface VitalsView {
  name: string;
  /** `${classId} · level ${level}`. */
  classLine: string;
  hp: ResourceBarModel;
  charges: ResourceBarModel;
  /** The class's build resource — present only for a class that banks one. */
  resource?: { kind: 'momentum' | 'corruption'; value: number };
  chips: ConditionChipModel[];
  /** RESERVED for #1.6's tempo gauge, as on `StageView`. Never set today. */
  tempo?: TempoGaugeModel;
}

/** Which list the menu column shows. Render-layer state, never saved. #11 adds `'talk'`. */
export type BattleMenuMode = 'commands' | 'cast' | 'item';

/** One row of the menu. #11 adds `{ kind: 'talk' }` — the column already has the room. */
export type BattleMenuRow =
  | { kind: 'fight' }
  | { kind: 'cast' }
  | { kind: 'spare' }
  | { kind: 'item' }
  | { kind: 'run'; enabled: boolean; reason?: string }
  | { kind: 'back' }
  | { kind: 'cast-skill'; option: CastOption }
  | { kind: 'use-item'; option: ConsumableOption };

/** Every fixed word on the battle screen, in one place for #13's pass. */
export const BATTLE_LABELS = {
  fight: 'Fight',
  cast: 'Cast',
  spare: 'Spare',
  item: 'Use item',
  run: 'Run',
  back: 'Back',
  record: 'Record',
} as const;

/**
 * Why Run is greyed against a boss (and anywhere else the engine forbids fleeing — the final
 * act). GAME-DESIGN §14.9's own phrase, literal: "the UI must explain WHY the option is
 * unavailable, not merely hide the button" (G4).
 */
export const RUN_BLOCKED_REASON = 'There is nowhere to go';

/** The enemy on the stage, or `null` when no battle is on. Any battle — started or not. */
export function stageView(state: GameState): StageView | null {
  if (state.phase.kind !== 'battle') return null;
  const { battle } = state.phase;
  const enemy = battle.enemy;
  return {
    name: enemy.fullName,
    hp: resourceBarModel('HP', enemy.hp, enemy.maxHp, 'foe'),
    chips: conditionChips(enemy.activeConditions),
    isBoss: battle.boss !== undefined,
  };
}

/** The player's stat box, or `null` before a player exists. Reads the LIVE combatant. */
export function vitalsView(state: GameState): VitalsView | null {
  const p = displayPlayer(state);
  if (!p) return null;
  const view: VitalsView = {
    name: p.name,
    classLine: `${p.classId} · level ${p.level}`,
    hp: resourceBarModel('HP', p.hp, p.maxHp, 'hp'),
    charges: resourceBarModel('Charges', p.skillCharges, p.maxSkillCharges, 'accent'),
    chips: conditionChips(p.activeConditions),
  };
  // The ONE rule for which class banks a resource lives in `characterSheet`; reused, not copied.
  const resource = characterSheet(p).resource;
  if (resource) view.resource = resource;
  return view;
}

/**
 * The menu's rows for a mode — PURE, and every inclusion is an existing helper's decision:
 *   Cast        iff the player has a castable skill (`castOptions`);
 *   Spare       iff the engine's own gate allows it (`spareOffered`);
 *   Use item    iff the pack holds a usable (`consumableOptions`);
 *   Run         ALWAYS, enabled iff `battle.canFlee` — greyed with its reason otherwise;
 *   a sub-menu  is Back, then one row per option.
 * Anything but a started battle has no menu.
 */
export function battleMenuRows(state: GameState, mode: BattleMenuMode): BattleMenuRow[] {
  if (state.phase.kind !== 'battle' || !state.phase.started) return [];
  const p = displayPlayer(state);
  if (!p) return [];
  if (mode === 'cast') {
    return [{ kind: 'back' }, ...castOptions(p).map((option) => ({ kind: 'cast-skill' as const, option }))];
  }
  if (mode === 'item') {
    return [{ kind: 'back' }, ...consumableOptions(p).map((option) => ({ kind: 'use-item' as const, option }))];
  }
  const rows: BattleMenuRow[] = [{ kind: 'fight' }];
  if (castOptions(p).length > 0) rows.push({ kind: 'cast' });
  if (spareOffered(state)) rows.push({ kind: 'spare' });
  if (consumableOptions(p).length > 0) rows.push({ kind: 'item' });
  rows.push(
    state.phase.battle.canFlee
      ? { kind: 'run', enabled: true }
      : { kind: 'run', enabled: false, reason: RUN_BLOCKED_REASON },
  );
  return rows;
}

/**
 * The button a row draws. PURE. A skill that cannot be paid for is greyed AND inert (the
 * shared `actionButton` attaches no handler to a disabled model); its hint is the effective
 * charge cost `castOptions` already computed — the same number the character sheet shows.
 */
export function battleRowButton(row: BattleMenuRow): ButtonModel {
  switch (row.kind) {
    case 'fight':
      return buttonModel(BATTLE_LABELS.fight);
    case 'cast':
      return buttonModel(BATTLE_LABELS.cast);
    case 'spare':
      return buttonModel(BATTLE_LABELS.spare);
    case 'item':
      return buttonModel(BATTLE_LABELS.item);
    case 'back':
      return buttonModel(BATTLE_LABELS.back);
    case 'run':
      return row.enabled
        ? buttonModel(BATTLE_LABELS.run)
        : buttonModel(BATTLE_LABELS.run, { disabled: true, hint: `(${row.reason ?? RUN_BLOCKED_REASON})` });
    case 'cast-skill':
      return buttonModel(row.option.name, {
        disabled: !row.option.affordable,
        hint: `(${row.option.chargeCost}⚡)`,
      });
    case 'use-item':
      return buttonModel(row.option.name, { hint: `(${row.option.rarity})` });
  }
}

// ---------------------------------------------------------------------------------------
// THE ROUND PLAN — everything the sequencer needs to replay one step, as plain data.
// ---------------------------------------------------------------------------------------

/** A bar's engine value before the step and after it. */
export interface BarPair {
  before: ResourceBarModel;
  after: ResourceBarModel;
}

/** One step's replay: its beats, when each plays, and the bars with when each is written. */
export interface RoundPlan {
  beats: readonly Beat[];
  schedule: BeatSchedule;
  bars: Record<BarKey, BarPair>;
  updateAt: Record<BarKey, number>;
}

/**
 * The bars before and after a step, from the ENGINE's two states — PURE.
 *
 * The player's and the charges' after-values are the live combatant's, wherever the step
 * left it (`displayPlayer`: the battle's player mid-fight, the run's player after it). The
 * enemy's after-value is the battle's while a battle is still on. When the step ENDED the
 * fight the engine keeps no enemy, so:
 *   - a `victory` is the engine's statement that the enemy's HP reached zero — the bar drains
 *     to 0 (`damageEnemy` and the tick path both clamp at 0);
 *   - any other ending (fled, spared, seen through, or the player's own death) leaves the bar
 *     at its last engine value. For a death that value can predate this round's last blow; the
 *     bar shows a true number from the engine, never one the renderer derived.
 */
export function roundBars(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
): Record<BarKey, BarPair> | null {
  const stageBefore = stageView(before);
  const vitalsBefore = vitalsView(before);
  const vitalsAfter = vitalsView(after);
  if (!stageBefore || !vitalsBefore || !vitalsAfter) return null;
  const stageAfter = stageView(after);
  const enemyAfter = stageAfter
    ? stageAfter.hp
    : events.some((e) => e.kind === 'victory')
      ? resourceBarModel('HP', 0, stageBefore.hp.max, 'foe')
      : stageBefore.hp;
  return {
    player: { before: vitalsBefore.hp, after: vitalsAfter.hp },
    enemy: { before: stageBefore.hp, after: enemyAfter },
    charges: { before: vitalsBefore.charges, after: vitalsAfter.charges },
  };
}

/**
 * The replay for one step, or `null` when there is nothing to replay — PURE. A step is a
 * battle step when it STARTED in a battle (an opening, which can drain floor 3's charges, or a
 * round, which can end the fight); any other step is narrated the ordinary way.
 */
export function roundPlan(before: GameState, after: GameState, events: readonly GameEvent[]): RoundPlan | null {
  if (before.phase.kind !== 'battle') return null;
  const beats = groupBeats(events);
  if (beats.length === 0) return null;
  const bars = roundBars(before, after, events);
  if (!bars) return null;
  return { beats, schedule: beatSchedule(beats.length), bars, updateAt: barUpdateAt(beats) };
}
