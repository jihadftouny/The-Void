// THE BATTLE SCREEN'S DOM HALF — the framed stage, built and played (PLAN.md #6).
//
// THIN BY DESIGN. Every decision has been made before a function here runs: `battle-model.ts`
// decided what the stage, the stat box and the menu say; `beat-model.ts` decided what each
// beat shows and when each bar is written; `audio-hooks.ts` decided what each beat sounds
// like. This file assembles elements from those models and walks a schedule. It has:
//   - NO engine import and NO `GameState`: the sequencer is handed plain view data (a
//     `RoundPlan`) and can neither read nor change game state. Animation timing is
//     render-layer state and never leaks into the game (UI-DESIGN §6).
//   - NO logger: it returns what it did; `game.ts`, the boundary, decides what to log.
//   - NO markup from strings: every word goes in as `textContent`, every control through the
//     shared `appendButton`. An enemy name of `<img onerror=…>` stays text.
//   - NO clock: the sequencer's only notion of time is the `wait` it is handed — `setTimeout`
//     in the game, fake timers in `battle.test.ts`.
//
// ⚠ ORDER-AGNOSTIC. `playRound` plays the beats in the order it is given and never re-sorts
// them; which side acts first is the engine's business (Appendix A.1).

import { appendButton, bar, chip } from '../render/components.ts';
import { barCells, type ConditionChipModel, type ResourceBarModel } from '../render/component-model.ts';
import type { BarKey, Beat, BeatFloat } from '../render/beat-model.ts';
import type { AudioHookName, AudioSink } from '../render/audio-hooks.ts';
import { buildArtSlotById } from './screens.ts';
import {
  BATTLE_LABELS,
  battleRowButton,
  type BattleMenuRow,
  type RoundPlan,
  type StageView,
  type TempoGaugeModel,
  type VitalsView,
} from './battle-model.ts';

/** One element with a class and, optionally, its text — set as TEXT, never markup. */
function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * A condition row. ALWAYS appended, even when empty — `.chips:empty` collapses it, the idiom
 * `#log`, `#notice` and the HUD's rows already use. A branch that does not exist cannot be
 * inverted to hide the chips (the G28(a) lesson).
 */
function chipsRow(models: readonly ConditionChipModel[]): HTMLElement {
  const row = element('div', 'chips');
  for (const model of models) row.appendChild(chip(model));
  return row;
}

/** A bar inside its own host, so the sequencer can replace the bar without moving the frame. */
function barHost(key: BarKey, model: ResourceBarModel): HTMLElement {
  const host = element('div', 'frame-bar');
  host.dataset['bar'] = key;
  host.appendChild(bar(model));
  return host;
}

/** Cells on EACH side of the tempo gauge's centre line. */
export const TEMPO_CELLS = 10;

/** One half of the gauge: `filled` cells lit, nearest the centre line first. */
function tempoHalf(side: 'slow' | 'quick', fraction: number): HTMLElement {
  const half = element('span', `tempo-half tempo-${side}`);
  const filled = barCells(fraction, TEMPO_CELLS);
  for (let i = 0; i < TEMPO_CELLS; i += 1) {
    // The slow half fills leftward from the centre, so its lit cells are its LAST ones; the
    // quick half fills rightward, so its first. DOM order stays left-to-right either way.
    const lit = side === 'slow' ? i >= TEMPO_CELLS - filled : i < filled;
    half.appendChild(element('span', lit ? 'tempo-cell is-filled' : 'tempo-cell'));
  }
  return half;
}

/**
 * The reserved tempo gauge (#1.6, GAME-DESIGN §16.1): two halves meeting at a centre line —
 * filling rightward toward the extra action, leftward toward the lost turn — and the engine's
 * number. Built ONLY when a view carries a tempo, which none does until the engine has the
 * field, so today the frame renders no gauge, no "0.0" and no label. Counted with the shared
 * `barCells` rule: only a true zero reads empty, only a true full reads full.
 */
function tempoRow(gauge: TempoGaugeModel): HTMLElement {
  const row = element('div', 'tempo-row');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `${gauge.label} ${gauge.text}`);
  row.appendChild(element('span', 'tempo-label', gauge.label));
  const track = element('span', 'tempo-gauge');
  track.appendChild(tempoHalf('slow', gauge.slow));
  track.appendChild(element('span', 'tempo-centre'));
  track.appendChild(tempoHalf('quick', gauge.quick));
  row.appendChild(track);
  row.appendChild(element('span', 'tempo-text', gauge.text));
  return row;
}

/** Replace the bar in a host with a freshly built one. A bar is never mutated in place. */
export function setBar(host: HTMLElement, model: ResourceBarModel): void {
  host.replaceChildren(bar(model));
}

/** What the ticker shows when the arena is (re)built. */
export interface TickerState {
  /** The most recent combat line of this fight, or '' before the first. */
  line: string;
}

/**
 * THE ARENA: the enemy's framed region, its name, its HP bar, its chips, and the ticker.
 *
 * The region is `buildArtSlotById('enemy')` — the committed 3:4 shape from `artSlots.json`,
 * empty today and deliberately so — inside `.arena-figure`, which is both the flash target and
 * the anchor a future sprite (#7) mounts into. The ticker is ONE line (`aria-live="polite"`)
 * and the `Record` toggle that opens the full combat log beneath the prose.
 *
 * The toggle is built CLOSED, always. Whether the log is open is set by `setLogOpen` alone —
 * the one writer of the column's flag AND the toggle's state, so the two can never disagree
 * (a log shown open under a toggle saying closed, after the next fight rebuilt the arena).
 */
export function buildArena(view: StageView, ticker: TickerState): HTMLElement {
  const inner = element('div', 'arena-inner');
  const figure = element('div', 'arena-figure');
  figure.appendChild(buildArtSlotById('enemy'));
  inner.appendChild(figure);
  inner.appendChild(element('p', 'arena-name', view.name));
  inner.appendChild(barHost('enemy', view.hp));
  inner.appendChild(chipsRow(view.chips));
  if (view.tempo !== undefined) inner.appendChild(tempoRow(view.tempo));

  const band = element('div', 'ticker');
  const line = element('p', 'ticker-line', ticker.line);
  line.setAttribute('aria-live', 'polite');
  band.appendChild(line);
  const toggle = element('button', 'ticker-toggle') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', 'log');
  band.appendChild(toggle);
  inner.appendChild(band);
  paintToggle(toggle, false);
  return inner;
}

/** The toggle's label and state. The caret is part of the TEXT, never a CSS `content` string. */
function paintToggle(toggle: HTMLElement, open: boolean): void {
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = `${open ? '▾' : '▸'} ${BATTLE_LABELS.record}`;
}

/**
 * Open or close the full log: `#column[data-log]` is what the stage's stylesheet reads, and
 * the toggle says which it is — to the eye (the caret) and to a screen reader (`aria-expanded`).
 */
export function setLogOpen(column: HTMLElement, toggle: HTMLElement, open: boolean): void {
  column.dataset['log'] = open ? 'open' : 'closed';
  paintToggle(toggle, open);
}

/**
 * THE STAT BOX: name, class and level, HP, charges, the class resource when there is one, and
 * the chips. Nothing else — no XP, no Act, no karma (`battle-model.ts` carries none of them).
 */
export function buildVitals(view: VitalsView): HTMLElement {
  const inner = element('div', 'vitals-inner');
  inner.appendChild(element('p', 'vitals-name', view.name));
  inner.appendChild(element('p', 'vitals-class', view.classLine));
  inner.appendChild(barHost('player', view.hp));
  inner.appendChild(barHost('charges', view.charges));
  if (view.resource) {
    const word = view.resource.kind === 'momentum' ? 'Momentum' : 'Corruption';
    inner.appendChild(element('p', 'vitals-resource', `${word} ${view.resource.value}`));
  }
  inner.appendChild(chipsRow(view.chips));
  if (view.tempo !== undefined) inner.appendChild(tempoRow(view.tempo));
  return inner;
}

/**
 * THE MENU: one shared button per row, in the model's order. `onRow` is handed the ROW — which
 * input a row dispatches is `game.ts`'s decision, where the literal actions live.
 */
export function buildBattleMenu(rows: readonly BattleMenuRow[], onRow: (row: BattleMenuRow) => void): HTMLElement {
  const menu = element('div', 'battle-menu');
  for (const row of rows) appendButton(menu, battleRowButton(row), () => onRow(row));
  return menu;
}

// ---------------------------------------------------------------------------------------
// THE SEQUENCER
// ---------------------------------------------------------------------------------------

/** The live elements a round plays on. All plain DOM; none of them is game state. */
export interface ArenaEls {
  /** The ticker's one line. */
  ticker: HTMLElement;
  /** The enemy's figure: the flash target and the enemy's float host. */
  enemy: HTMLElement;
  /** The stat box: the shake target and the player's float host. */
  player: HTMLElement;
  /** The host of each bar, as `barHost` built them. */
  bars: Record<BarKey, HTMLElement>;
}

/** What the sequencer needs from outside: a way to wait, a place to send sounds, and motion. */
export interface PlayDeps {
  /** Resolve after `ms`. `setTimeout` in the game; fake timers in a test. The only clock. */
  wait(ms: number): Promise<void>;
  audio: AudioSink;
  /**
   * `shouldAnimate(settings, osReduced)`. When false the TIMING IS UNCHANGED (UI-DESIGN §13:
   * "the exchange must still read as an exchange"); only the motion changes — no shake, and
   * the flash becomes a soft tint.
   */
  animate: boolean;
  /** Called once per beat, after it is shown — the boundary's hook for logging. */
  onBeat?(beat: Beat): void;
}

/** What a round did, for the boundary to log. */
export interface PlayResult {
  beats: number;
  hooks: AudioHookName[];
}

const BAR_KEYS: readonly BarKey[] = ['player', 'enemy', 'charges'];

/** The classes a strike adds, by motion: a flash and a shake, or a tint and no movement. */
function strikeClass(side: 'player' | 'enemy', animate: boolean): string {
  if (!animate) return 'is-tinted';
  return side === 'enemy' ? 'is-struck' : 'is-shaking';
}

/** Undo everything the previous beat put on the frame. */
function clearEffects(els: ArenaEls): void {
  for (const host of [els.enemy, els.player]) {
    host.classList.remove('is-struck', 'is-shaking', 'is-tinted');
    for (const float of host.querySelectorAll('.arena-float')) float.remove();
  }
}

/** A number floated over a side. Decorative: the ticker line already says it in words. */
function showFloat(els: ArenaEls, float: BeatFloat): void {
  const host = float.side === 'enemy' ? els.enemy : els.player;
  const el = element('span', `arena-float arena-float-${float.tone}`, float.text);
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);
}

/**
 * Replay one step's beats on the frame, in order, on the plan's schedule.
 *
 * Per beat: the ticker takes its line; every bar whose update beat this is is written with the
 * engine's AFTER value (so each bar is written exactly once per round, at the last beat that
 * could have moved it — never before); the struck side flashes or shakes (or is tinted, under
 * reduced motion); the float appears; the hook is sent. Between beats it waits the spacing;
 * after the last it holds, then clears its effects and resolves.
 *
 * It never receives `GameState`, and it writes nothing but these elements.
 */
export async function playRound(plan: RoundPlan, els: ArenaEls, deps: PlayDeps): Promise<PlayResult> {
  const hooks: AudioHookName[] = [];
  const { at, done } = plan.schedule;
  for (const beat of plan.beats) {
    if (beat.index > 0) await deps.wait((at[beat.index] as number) - (at[beat.index - 1] as number));
    clearEffects(els);
    els.ticker.textContent = beat.line;
    for (const key of BAR_KEYS) {
      if (plan.updateAt[key] === beat.index) setBar(els.bars[key], plan.bars[key].after);
    }
    if (beat.struck) (beat.struck === 'enemy' ? els.enemy : els.player).classList.add(strikeClass(beat.struck, deps.animate));
    if (beat.float) showFloat(els, beat.float);
    if (beat.hook) {
      const detail = beat.struck ? { side: beat.struck, index: beat.index } : { index: beat.index };
      deps.audio.play(beat.hook, detail);
      hooks.push(beat.hook);
    }
    deps.onBeat?.(beat);
  }
  if (plan.beats.length > 0) await deps.wait(done - (at[plan.beats.length - 1] as number));
  clearEffects(els);
  return { beats: plan.beats.length, hooks };
}

/** The live elements of a frame built by `buildArena` + `buildVitals`, or `null` if absent. */
export function arenaEls(arena: HTMLElement, vitals: HTMLElement): ArenaEls | null {
  const ticker = arena.querySelector<HTMLElement>('.ticker-line');
  const enemy = arena.querySelector<HTMLElement>('.arena-figure');
  const player = vitals.querySelector<HTMLElement>('.vitals-inner');
  const enemyBar = arena.querySelector<HTMLElement>('.frame-bar[data-bar="enemy"]');
  const playerBar = vitals.querySelector<HTMLElement>('.frame-bar[data-bar="player"]');
  const chargesBar = vitals.querySelector<HTMLElement>('.frame-bar[data-bar="charges"]');
  if (!ticker || !enemy || !player || !enemyBar || !playerBar || !chargesBar) return null;
  return { ticker, enemy, player, bars: { enemy: enemyBar, player: playerBar, charges: chargesBar } };
}
