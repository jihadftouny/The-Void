// THE DEVELOPER STATE PANEL — the DOM surface over `devState.ts`'s pure core.
//
// ⚠ NEVER IN THE PACKAGED BUILD, AND NOT BY A RUNTIME CHECK. `src/desktop/game.ts` reaches
// this module through a dynamic `import()` inside an `import.meta.env.DEV` guard. `vite build`
// replaces that expression with the literal `false`, Rollup eliminates the dead branch, and
// the dynamic import goes with it — so this file is never in the module graph of a shipped
// build: no chunk, no string, and nothing in the sourcemap either. `exclusion.test.ts` proves
// that by running the REAL bundler twice in a subprocess (an in-process build under Vitest
// would inherit `NODE_ENV=test` and quietly not be a production build at all).
//
// The cost was named to the author and accepted (plan Appendix A.2): he cannot jump states
// inside a packaged build, so packaged-build verification stays full-run. There is no switch,
// no env var and no separate dev artifact. Do not add one.
//
// WHY THIS IS A SIBLING OF THE LOG OVERLAY AND NOT A TAB INSIDE IT. `debug-overlay.ts` is
// imported unconditionally by `game.ts` and therefore SHIPS. Putting the cheat panel inside it
// would drag the panel into the packaged bundle, which is the one thing this unit must not do.
// It is a sibling instead: F3 rather than ` / F2, the left half rather than the right (so both
// can be open), and the SAME typing rule — `isTypingTarget` is imported, never re-implemented,
// so there is one answer to "is the user typing?" for both dev surfaces.
//
// KARMA IS VISIBLE HERE. This is a developer surface; see `devState.ts`'s header for why that
// is correct and for the one path rule that keeps it out of a widened hidden-karma guard.
//
// LOGGING (principle 7 — part of the work, not a follow-up). Jumps are timed, every refusal
// logs BEFORE it recovers, numbers live in `data` and never in a message, and the first jump
// of a session emits a loud warn: a jumped session's log would otherwise be indistinguishable
// from a real run's, and any unlock earned after that line came from a state nobody played to.

import { log } from '../log/logger.ts';
import { levelForDuration, startTimer } from '../log/timing.ts';
import { isTypingTarget, type OverlayKey, type OverlayKeyEvent } from '../desktop/debug-overlay.ts';
import {
  DEV_PRESETS,
  affixOptions,
  applyEdits,
  applyJump,
  buildJump,
  catalogOptions,
  createOnce,
  devStatus,
  editsFrom,
  encodeBundle,
  encounterTarget,
  familyOptions,
  grantIntoState,
  parseBundle,
  parseField,
  presetSpec,
  withUnlocks,
  type GrantSpec,
  type JumpBundle,
  type JumpSpec,
  type MenuOption,
} from './devState.ts';
import { resetUnlockStore, type RemovableStore } from './unlockReset.ts';
import type { EquipSlot } from '../game/item.ts';
import type { StatKey } from '../game/character.ts';
import type { Rarity } from '../game/weapon.ts';

/** The panel root's element id — and the MARKER `exclusion.test.ts` sweeps the bundle for. */
export const PANEL_ID = 'void-debug-state-panel';

/**
 * How slow a jump has to be before it is worth a `warn`. Module-local on purpose: the shared
 * `SLOW_MS` table is the SHIPPED boundaries' budget and this is a developer tool, so adding a
 * row to it would put a dev-only threshold in a file that ships.
 */
export const SLOW_JUMP_MS = 250;

// ------- The pure reactions (tested with plain-object stand-ins) ---------------

/** The one thing `panelAllowed` reads. Structural, so it is testable without a DOM. */
export interface PanelEnv {
  protocol: string;
}

/**
 * Belt and braces, and NOTHING MORE. The real exclusion is that this module is not in a
 * packaged bundle at all; this only matters in the world where guard 1 has been broken.
 * `file:` is a packaged build by construction (`electron/main.mjs` loads `dist/desktop.html`
 * from disk), exactly as `src/log/level.ts` reasons about the same signal.
 */
export function panelAllowed(env: PanelEnv): boolean {
  return env.protocol !== 'file:';
}

/** Should this keystroke toggle the panel? F3, and only when the user is not typing. */
export function togglesPanel(event: OverlayKey): boolean {
  if (event.key !== 'F3') return false;
  return !isTypingTarget(event.target);
}

/**
 * The whole `keydown` REACTION — pure apart from the callback it is handed.
 *
 * The decision AND the action live here together, for the reason `handleOverlayKey` records:
 * a source scan can see which markers appear and in what order, and is structurally blind to
 * the POLARITY of the `if` they hang on. With the action in here, inverting the guard is a
 * behavioural failure instead of a spelling a regex may not match.
 */
export function handlePanelKey(event: OverlayKeyEvent, toggle: () => void): void {
  if (!togglesPanel(event)) return;
  event.preventDefault();
  toggle();
}

/**
 * Mount the panel, or decline to — pure apart from the `mount` callback.
 *
 * Both directions are behaviour: an inverted guard would mount the cheat panel in exactly the
 * build it must never appear in, and refuse to mount it in the one the author works in.
 */
export function bootPanel(env: PanelEnv, mount: () => void): boolean {
  if (!panelAllowed(env)) return false;
  mount();
  return true;
}

// ------- What the panel needs from the renderer --------------------------------

export interface PanelDeps {
  /** The live bundle, read FRESH on every action (never captured once at mount). */
  getBundle(): JumpBundle;
  /**
   * Adopt a bundle through the renderer's `adoptRun(saved)` seam — the same function the
   * boot resume path calls. Returns false when the renderer is mid-turn.
   */
  adopt(bundle: JumpBundle): boolean;
  /** `location.protocol`, injected so `panelAllowed` is decided on data, not on a global. */
  env: PanelEnv;
  /** The persistent unlock store's storage, for the reset button. */
  unlockStorage: RemovableStore | null;
}

// ------- Small DOM builders ----------------------------------------------------
//
// Every one of these sets `textContent` or `value`. NOTHING in this file assigns `innerHTML`:
// the state-JSON box accepts pasted text from a bug report, and an item/enemy name can carry
// anything the generators produce. `panel.test.ts` scans this file for that.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ROW_CSS = 'display:flex;gap:6px;align-items:center;margin:2px 0;';
const INPUT_CSS = 'background:#111;border:1px solid #333;color:#fed;padding:2px 4px;width:5em;';
const WIDE_CSS = 'background:#111;border:1px solid #333;color:#fed;padding:2px 4px;flex:1;';
const BTN_CSS =
  'background:#222;border:1px solid #444;color:#fed;padding:3px 7px;cursor:pointer;font:inherit;';

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', BTN_CSS, label);
  node.addEventListener('click', onClick);
  return node;
}

function numberField(label: string, value: number): { row: HTMLDivElement; input: HTMLInputElement } {
  const row = el('div', ROW_CSS);
  row.appendChild(el('label', 'width:9em;', label));
  const input = el('input', INPUT_CSS);
  input.type = 'number';
  input.value = String(value);
  row.appendChild(input);
  return { row, input };
}

function selectField(label: string, options: readonly MenuOption[]): {
  row: HTMLDivElement;
  select: HTMLSelectElement;
} {
  const row = el('div', ROW_CSS);
  row.appendChild(el('label', 'width:9em;', label));
  const select = el('select', WIDE_CSS);
  for (const option of options) {
    const node = el('option', '', option.label);
    node.value = option.id;
    select.appendChild(node);
  }
  row.appendChild(select);
  return { row, select };
}

function section(title: string): HTMLDivElement {
  const wrap = el('div', 'border-top:1px solid #333;margin-top:8px;padding-top:6px;');
  wrap.appendChild(el('h4', 'margin:0 0 4px;font-size:12px;color:#9cf;', title));
  return wrap;
}

/**
 * A field's value as a number, or `undefined` when it is blank. A WIRE ONLY: the decision —
 * and specifically the blank-is-not-zero rule — lives in the pure `parseField`, where a test
 * can hand it `''` directly. An `HTMLInputElement` cannot be handed to one.
 */
function readNumber(input: HTMLInputElement): number | undefined {
  return parseField(input.value);
}

// ------- The mount --------------------------------------------------------------

/**
 * Build the panel and wire it to the renderer. Called ONLY from `game.ts`'s
 * `import.meta.env.DEV` branch, through `bootPanel`.
 */
export function mountDebugPanel(deps: PanelDeps): boolean {
  return bootPanel(deps.env, () => buildPanel(deps));
}

function buildPanel(deps: PanelDeps): void {
  const panel = el('div', '');
  panel.id = PANEL_ID;
  panel.style.cssText =
    'position:fixed;left:0;top:0;width:46%;height:100%;z-index:9998;display:none;overflow:auto;' +
    'background:rgba(9,6,6,0.97);color:#fed;border-right:1px solid #333;padding:8px;' +
    'font:12px/1.5 ui-monospace,monospace;box-sizing:border-box;';

  panel.appendChild(el('h3', 'margin:0 0 2px;font-size:13px;color:#f96;', 'DEV STATE PANEL'));
  panel.appendChild(
    el(
      'div',
      'color:#a87;margin-bottom:6px;',
      'Never in a packaged build. A jumped run is not a real run.',
    ),
  );

  const status = el('div', 'color:#9cf;white-space:pre-wrap;margin-bottom:4px;');
  const notice = el('div', 'color:#f96;white-space:pre-wrap;margin-bottom:4px;');
  panel.appendChild(status);
  panel.appendChild(notice);

  /** Say something to the developer, as TEXT. Never markup — a reason can quote a paste. */
  const say = (text: string): void => {
    notice.textContent = text;
  };

  const refreshStatus = (): void => {
    const s = devStatus(deps.getBundle().state);
    status.textContent =
      `act ${s.act} / place ${s.place} · xp ${s.xp} · level ${s.level} · hp ${s.hp}/${s.maxHp}\n` +
      `phase ${s.phase}\n` +
      `karma  mercy ${s.karma.mercyCruelty}  restraint ${s.karma.restraintGreed}  ` +
      `reverence ${s.karma.reverenceDesecration}  clarity ${s.karma.clarityDelusion}`;
  };

  // Emitted once per session, the first time a jump lands. A jumped session's log is
  // otherwise indistinguishable from a real run's — and any class or relic unlocked after
  // this line was earned in a state nobody played to. The latch is `createOnce`, which is
  // tested: inverted here it would simply never fire, silently, and exactly when it matters.
  const firstJump = createOnce();

  /**
   * Say what happened to a jump. Every DECISION lives in the pure `applyJump`; this is the
   * reporting half — the log line and the on-screen notice — and nothing else.
   * A refusal logs BEFORE it recovers, and the live state is left exactly as it was.
   */
  const applyBundle = (bundle: JumpBundle, presetId: string): void => {
    const timer = startTimer();
    const outcome = applyJump(bundle, deps.adopt);
    if (outcome.kind === 'refused') {
      log.warn('dev', 'jump REFUSED', { preset: presetId, reasons: outcome.reasons });
      say(`refused: ${outcome.reasons.join(', ')}`);
      return;
    }
    if (outcome.kind === 'busy') {
      log.warn('dev', 'jump REFUSED', { preset: presetId, reasons: ['renderer-busy'] });
      say('refused: the renderer is mid-turn, try again');
      return;
    }
    if (firstJump()) {
      log.warn('dev', 'THIS SESSION IS NO LONGER A REAL RUN', {
        seed: bundle.meta.runSeed,
        preset: presetId,
      });
    }
    const ms = timer.stop();
    const s = devStatus(bundle.state);
    log.log(levelForDuration(ms, SLOW_JUMP_MS, 'info'), 'dev', 'jump applied', {
      preset: presetId,
      act: s.act,
      place: s.place,
      xp: s.xp,
      level: s.level,
      phase: s.phase,
      hp: s.hp,
      maxHp: s.maxHp,
      seed: bundle.meta.runSeed,
      ms,
    });
    say(`jumped: ${presetId}`);
    refreshStatus();
  };

  // ---- Seed + presets ----------------------------------------------------------
  const presets = section('Jump presets');
  const seed = numberField('seed', 1);
  presets.appendChild(seed.row);
  const presetRow = el('div', 'display:flex;flex-wrap:wrap;gap:4px;');
  for (const row of DEV_PRESETS) {
    presetRow.appendChild(
      button(row.label, () => {
        // `presetSpec` carries the LIVE unlock snapshot over rather than fabricating one.
        applyBundle(
          buildJump(presetSpec(row, readNumber(seed.input), deps.getBundle().state)),
          row.id,
        );
      }),
    );
  }
  presets.appendChild(presetRow);
  panel.appendChild(presets);

  // ---- A forced encounter ------------------------------------------------------
  const forced = section('Forced encounter');
  const family = selectField('family', familyOptions());
  const affix = selectField('affix', affixOptions());
  const forcedAct = numberField('act', 4);
  const forcedXp = numberField('xp', 240);
  forced.append(family.row, affix.row, forcedAct.row, forcedXp.row);
  forced.appendChild(
    button('Force this encounter', () => {
      const current = deps.getBundle().state;
      const spec: JumpSpec = {
        act: readNumber(forcedAct.input) ?? 1,
        xp: readNumber(forcedXp.input) ?? 0,
        seed: readNumber(seed.input) ?? 1,
        karma: current.karma,
        // `encounterTarget` owns the "(no affix)" case: an empty id must leave the key OFF.
        target: encounterTarget(family.select.value, affix.select.value),
      };
      applyBundle(buildJump(withUnlocks(spec, current)), `encounter:${family.select.value}`);
    }),
  );
  panel.appendChild(forced);

  // ---- Live player edits -------------------------------------------------------
  const playerSection = section('Player (edits the LIVE state)');
  const live = deps.getBundle().state.player;
  const hp = numberField('hp', live?.hp ?? 1);
  const maxHp = numberField('maxHp', live?.maxHp ?? 1);
  const pots = numberField('pots', live?.pots ?? 0);
  const rests = numberField('restsLeft', live?.restsLeft ?? 0);
  const charges = numberField('skillCharges', live?.skillCharges ?? 0);
  const momentum = numberField('momentum', live?.momentum ?? 0);
  const corruption = numberField('corruption', live?.corruption ?? 0);
  playerSection.append(hp.row, maxHp.row, pots.row, rests.row, charges.row, momentum.row, corruption.row);
  playerSection.appendChild(
    button('Apply edits', () => {
      // `editsFrom` owns the blank-field rule: a blank box means "leave this alone", and
      // must not become an `undefined`-valued key.
      const edits = editsFrom({
        hp: readNumber(hp.input),
        maxHp: readNumber(maxHp.input),
        pots: readNumber(pots.input),
        restsLeft: readNumber(rests.input),
        skillCharges: readNumber(charges.input),
        momentum: readNumber(momentum.input),
        corruption: readNumber(corruption.input),
      });
      const current = deps.getBundle();
      applyBundle({ ...current, state: applyEdits(current.state, edits) }, 'edits');
    }),
  );
  panel.appendChild(playerSection);

  // ---- Karma -------------------------------------------------------------------
  const karmaSection = section('Karma (developer surface only)');
  const mercy = numberField('mercy/cruelty', 0);
  const restraint = numberField('restraint/greed', 0);
  const reverence = numberField('reverence/desec.', 0);
  const clarity = numberField('clarity/delusion', 0);
  karmaSection.append(mercy.row, restraint.row, reverence.row, clarity.row);
  karmaSection.appendChild(
    button('Jump with this vector', () => {
      const current = deps.getBundle().state;
      const spec: JumpSpec = {
        act: current.act,
        xp: current.player?.xp ?? 0,
        seed: readNumber(seed.input) ?? 1,
        karma: {
          mercyCruelty: readNumber(mercy.input) ?? 0,
          restraintGreed: readNumber(restraint.input) ?? 0,
          reverenceDesecration: readNumber(reverence.input) ?? 0,
          clarityDelusion: readNumber(clarity.input) ?? 0,
        },
      };
      applyBundle(buildJump(withUnlocks(spec, current)), 'karma');
    }),
  );
  panel.appendChild(karmaSection);

  // ---- Items -------------------------------------------------------------------
  const items = section('Items');
  const catalog = selectField('catalog id', catalogOptions());
  const slot = selectField('rolled slot', SLOT_OPTIONS);
  const rarity = selectField('rolled rarity', RARITY_OPTIONS);
  const stat = selectField('rolled stat', STAT_OPTIONS);
  items.append(catalog.row, slot.row, rarity.row, stat.row);

  /** Grant into the LIVE state. `grantIntoState` owns the draw and the no-character case. */
  const grant = (spec: GrantSpec, label: string): void => {
    const current = deps.getBundle();
    const result = grantIntoState(current.state, spec);
    if (!result.ok) {
      log.warn('dev', 'grant REFUSED', { reasons: ['no-character'] });
      say('refused: there is no character yet');
      return;
    }
    applyBundle({ ...current, state: result.state }, label);
  };

  const grantRow = el('div', 'display:flex;flex-wrap:wrap;gap:4px;');
  grantRow.append(
    button('Grant catalog item', () => grant({ catalogId: catalog.select.value }, 'grant:catalog')),
    button('Grant + equip', () =>
      grant({ catalogId: catalog.select.value, equip: true }, 'grant:catalog+equip'),
    ),
    button('Roll an item', () =>
      grant(
        {
          generated: {
            slot: slot.select.value as EquipSlot,
            rarity: rarity.select.value as Rarity,
            stat: stat.select.value as StatKey,
          },
        },
        'grant:rolled',
      ),
    ),
    button('Roll + equip', () =>
      grant(
        {
          generated: {
            slot: slot.select.value as EquipSlot,
            rarity: rarity.select.value as Rarity,
            stat: stat.select.value as StatKey,
          },
          equip: true,
        },
        'grant:rolled+equip',
      ),
    ),
  );
  items.appendChild(grantRow);
  panel.appendChild(items);

  // ---- The state JSON envelope --------------------------------------------------
  const json = section('State JSON (copy out, paste back)');
  const box = el('textarea', 'width:100%;height:9em;background:#111;border:1px solid #333;color:#fed;');
  json.appendChild(box);
  const jsonRow = el('div', 'display:flex;gap:4px;');
  jsonRow.append(
    button('Copy current', () => {
      box.value = encodeBundle(deps.getBundle());
      say('copied the live envelope into the box');
    }),
    button('Adopt pasted', () => {
      const parsed = parseBundle(box.value);
      if (!parsed.ok) {
        log.warn('dev', 'paste REFUSED', { reason: parsed.reason });
        say(`refused: ${parsed.reason}`);
        return;
      }
      applyBundle(parsed.bundle, 'pasted');
    }),
  );
  json.appendChild(jsonRow);
  panel.appendChild(json);

  // ---- The undo for the one destructive thing here -------------------------------
  const meta = section('Meta-progression');
  meta.appendChild(
    el(
      'div',
      'color:#a87;',
      'A jumped run writes to the real unlock store. This puts it back to first-run state.',
    ),
  );
  meta.appendChild(
    button('Reset unlock store', () => {
      const storage = deps.unlockStorage;
      if (!storage) {
        say('refused: no storage available');
        return;
      }
      const result = resetUnlockStore(storage);
      if (!result.ok) {
        log.error('dev', 'unlock store reset FAILED', {
          cleared: result.cleared.length,
          message: result.message ?? '',
        });
        say('reset FAILED — see the log');
        return;
      }
      log.warn('dev', 'unlock store RESET from the dev panel', { cleared: result.cleared.length });
      say('unlock store reset — restart the game to see a first-run class select');
    }),
  );
  panel.appendChild(meta);

  document.body.appendChild(panel);
  refreshStatus();

  const toggle = (): void => {
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) refreshStatus();
    log.info('dev', opening ? 'panel opened' : 'panel closed', {});
  };

  // The listener is a WIRE and nothing else: every decision and every action lives in
  // `handlePanelKey`, which is behaviourally tested. Anything done inline here would be
  // invisible to those tests — the lesson `debug-overlay.ts` records at its own listener.
  window.addEventListener('keydown', (ev) => handlePanelKey(ev, toggle));
}

// ------- Menu data the DOM needs ------------------------------------------------

const SLOT_OPTIONS: readonly MenuOption[] = [
  { id: 'mainHand', label: 'mainHand' },
  { id: 'offHand', label: 'offHand' },
  { id: 'armor', label: 'armor' },
  { id: 'helmet', label: 'helmet' },
  { id: 'amulet', label: 'amulet' },
  { id: 'legs', label: 'legs' },
  { id: 'boots', label: 'boots' },
  { id: 'ring', label: 'ring' },
  { id: 'ammo', label: 'ammo' },
];

const RARITY_OPTIONS: readonly MenuOption[] = [
  { id: 'Common', label: 'Common' },
  { id: 'Rare', label: 'Rare' },
  { id: 'Legendary', label: 'Legendary' },
];

const STAT_OPTIONS: readonly MenuOption[] = [
  { id: 'STR', label: 'STR' },
  { id: 'DEX', label: 'DEX' },
  { id: 'CON', label: 'CON' },
  { id: 'INT', label: 'INT' },
  { id: 'WIS', label: 'WIS' },
  { id: 'CHA', label: 'CHA' },
];
