// The shared presentational components — the THIN DOM half (M-UI2 `ui-foundation`).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: every decision has already been made by the time a
//    function here runs. These builders read fields off a model from
//    `component-model.ts` and assemble elements. They contain NO game rule, no engine
//    import beyond types, and no arithmetic of their own — the one computation, the bar's
//    segment count, is delegated to the tested `barCells`.
//  - Single source of truth for style: not one colour, size or spacing value appears
//    here. Everything is a class name resolved by `components.css` against the `--void-*`
//    custom properties.
//
// DEVIATION (recorded, per the plan §3.2): the DOM half of these components carries no
// unit tests. Vitest runs `environment: 'node'` and this repo's standing rule is that only
// pure logic is unit-tested; adding jsdom would mean a new dependency and an edit to the
// shared vite.config.ts to cover ~5 lines of createElement per component. All the logic
// lives in the models, which ARE tested; what is left untested here is element assembly,
// covered by typecheck, build, and the manual desktop smoke.

import type {
  BarModel,
  ButtonModel,
  ConditionChipModel,
  ResourceBarModel,
  RowModel,
} from './component-model.ts';
import { barCells } from './component-model.ts';
import type { LogLine } from './log-model.ts';

/** Default segment count for a bar — the number of cells a player can count at a glance. */
export const BAR_CELLS = 20;

/**
 * A flat panel: the standard surface everything sits on. `title` renders as a tracked,
 * upper-case caption above a rule. Returns the panel; append content to it.
 */
export function panel(options: { title?: string; className?: string } = {}): HTMLElement {
  const el = document.createElement('section');
  el.className = options.className ? `void-panel ${options.className}` : 'void-panel';
  if (options.title !== undefined) {
    const heading = document.createElement('h4');
    heading.className = 'void-panel-title';
    heading.textContent = options.title;
    el.appendChild(heading);
  }
  return el;
}

/**
 * A segmented value bar. The fill is drawn as `cells` discrete segments rather than a
 * percentage width, because discrete segments are countable — the player can read "3 left"
 * off the screen instead of estimating a length.
 */
export function bar(model: BarModel | ResourceBarModel, cells: number = BAR_CELLS): HTMLElement {
  const tone = 'tone' in model ? model.tone : 'hp';
  const el = document.createElement('div');
  el.className = `void-bar void-bar-${tone}`;

  if ('label' in model) {
    const label = document.createElement('span');
    label.className = 'void-bar-label';
    label.textContent = model.label;
    el.appendChild(label);
  }

  const track = document.createElement('span');
  track.className = 'void-bar-track';
  const filled = barCells(model.fraction, cells);
  for (let i = 0; i < cells; i += 1) {
    const cell = document.createElement('span');
    cell.className = i < filled ? 'void-bar-cell is-filled' : 'void-bar-cell';
    track.appendChild(cell);
  }
  el.appendChild(track);

  const text = document.createElement('span');
  text.className = 'void-bar-text';
  text.textContent = model.text;
  el.appendChild(text);

  // Screen readers get the numbers, not 20 empty spans.
  el.setAttribute('role', 'img');
  el.setAttribute(
    'aria-label',
    'label' in model ? `${model.label} ${model.text}` : model.text,
  );
  return el;
}

/** A condition chip, toned by how the condition reads to the player. */
export function chip(model: ConditionChipModel): HTMLElement {
  const el = document.createElement('span');
  el.className = `void-chip void-chip-${model.tone}`;
  el.textContent = model.label;
  el.title = `${model.name} — ${model.remainingTurns} turn(s) left`;
  return el;
}

/** A label/value row. An empty row renders dimmed and italic via the model's flag. */
export function labelledRow(model: RowModel): HTMLElement {
  const row = document.createElement('div');
  row.className = 'void-row';

  const label = document.createElement('span');
  label.className = 'void-row-label';
  label.textContent = model.label;

  const value = document.createElement('span');
  value.className = model.empty ? 'void-row-value is-empty' : 'void-row-value';
  value.textContent = model.value;

  row.appendChild(label);
  row.appendChild(value);
  return row;
}

/**
 * A menu/action button. A DISABLED button gets no click handler at all — it is inert as
 * well as greyed, so a stray click cannot dispatch. An enabled one fires `{ once: true }`,
 * so a double-click cannot dispatch the same action twice before the re-render clears it.
 */
export function actionButton(model: ButtonModel, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = 'void-button';
  el.textContent = model.hint === undefined ? model.label : `${model.label} ${model.hint}`;
  if (model.disabled) {
    el.disabled = true;
    el.classList.add('is-disabled');
  } else {
    el.addEventListener('click', onClick, { once: true });
  }
  return el;
}

// --- Append helpers -------------------------------------------------------------
// Sugar so callers never hand-roll `parent.appendChild(builder(...))`, which is where a
// bespoke, drifting copy of a component tends to start.

/** Build a row from its model, append it to `parent`, and return it. */
export function appendRow(parent: HTMLElement, model: RowModel): HTMLElement {
  const row = labelledRow(model);
  parent.appendChild(row);
  return row;
}

/** Build a button from its model, append it to `parent`, and return it. */
export function appendButton(
  parent: HTMLElement,
  model: ButtonModel,
  onClick: () => void,
): HTMLButtonElement {
  const el = actionButton(model, onClick);
  parent.appendChild(el);
  return el;
}

/**
 * One line of the combat log (G18): the plain story of a beat, and — when the beat was decided
 * by a roll — the dice behind it, hidden behind an expander.
 *
 * The expander is a native `<details>/<summary>`, not a div with a click handler. That is a
 * deliberate choice for `UI-DESIGN.md` §15 / S4c: the browser gives keyboard operation, focus
 * order, and the correct screen-reader announcement ("expanded"/"collapsed") for free, and
 * none of the three can drift out of sync with the visual state the way a hand-rolled toggle
 * does. A line with no dice is a plain div — no empty expander to tab through.
 *
 * The text is set as `textContent` throughout. `formatEvent` output can contain a player's
 * name and an enemy's full name, and neither is ever markup.
 */
export function appendLogLine(parent: HTMLElement, line: LogLine): HTMLElement {
  const el = document.createElement('div');
  el.className = 'void-log-line';
  if (line.detail === undefined) {
    el.textContent = line.text;
  } else {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = line.text;
    const detail = document.createElement('div');
    detail.className = 'void-log-detail';
    detail.textContent = line.detail;
    details.append(summary, detail);
    el.appendChild(details);
  }
  parent.appendChild(el);
  return el;
}

/**
 * An inline expander: a toggle button that reveals or hides a sub-list of options built by
 * `build`. Used for the battle Cast / Use-item pickers, which need to offer a variable
 * number of choices without leaving the screen.
 */
export function picker(
  parent: HTMLElement,
  label: string,
  build: (list: HTMLElement) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'void-picker';

  const toggle = document.createElement('button');
  toggle.className = 'void-button';
  toggle.textContent = label;
  toggle.setAttribute('aria-expanded', 'false');

  const list = document.createElement('div');
  list.className = 'void-picker-list';
  list.hidden = true;

  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
  });

  wrap.appendChild(toggle);
  wrap.appendChild(list);
  build(list);
  parent.appendChild(wrap);
  return wrap;
}
