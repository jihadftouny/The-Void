// THE LAYOUT PROBE'S IN-PAGE DRIVER — the half that runs inside a real browser engine.
//
// ---------------------------------------------------------------------------------------
// WHY THIS EXISTS, and what it is a reaction to.
//
// The `visual-identity` unit merged with 2149 tests green, a clean typecheck, a clean build
// and a PASS verdict — and the game it shipped had NO NARRATION. The prose pane measured
// ZERO PIXELS at the 960x640 minimum window and 4.5 px at the default one, while an empty
// placeholder frame held a third of the screen. Not one test could see it, and the reason is
// structural rather than an oversight: **every guard in this area is a source scan or a jsdom
// assertion, and NEITHER COMPUTES LAYOUT.** jsdom has no layout engine at all — every
// `getBoundingClientRect()` it returns is zeros — so a jsdom test cannot tell a readable
// column from a collapsed one. A source scan can prove a rule EXISTS in a stylesheet; it can
// never prove what that rule does once the cascade, the flex algorithm, the viewport height
// and the real typeface's metrics have had their say.
//
// So this file, and `layoutProbe.test.ts` beside it, do the one thing that can: they build
// the WORST-CASE content into THE REAL PAGE, styled by THE REAL BUILT STYLESHEET, in THE REAL
// CHROMIUM the game ships inside, at the real window sizes, and read the resulting geometry
// back as numbers. The expected numbers are derived by hand in the test file from the type
// scale and the stated line heights — never read off a run.
//
// ---------------------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT DO. It is not the renderer. It imports the REAL builders
// (`buildArtSlotById`, `appendButton`, `appendLogLine`, `picker`, `buildContentWarning`,
// `buildSettingsScreen`), the REAL models (`hubMenu`, `buttonModel`, `rowModel`), and the
// REAL theme application, so the content it measures is the content the game produces. Two
// structures it MIRRORS rather than imports, because `src/desktop/game.ts` calls the Electron
// IPC at module scope and can never be imported (FINDINGS.md G51):
//
//   1. the battle control list (`case 'battle-action'` in `renderChoices`), and
//   2. the `.hub-menu` / `.hub-prompt` wrapper `renderHub` builds around `hubMenu`'s rows.
//
// A mirror can drift. THE OTHER END OF THAT COUPLING IS PHASE C of the probe, which boots the
// REAL renderer in Electron and walks it by clicking — so the numbers this file produces for
// the hub are checked against the ones the actual game produces for the actual hub. Neither
// half is trusted alone.
//
// PLAN.md #2 added four more mirrors, of the screens it added or changed: the inventory's
// per-row Discard, the found rest spot (scenery + Continue), the bargain (cost/reward block +
// two controls) and the full-pack bargain of Appendix A.3 (its block, a closed "Choose what to
// leave" list, the refusal). Their labels come from the REAL view-model (`dealView`,
// `dealDiscardView`), and the other end of THOSE couplings is `floorWiringSource.test.ts`,
// which pins the renderer's arms to the same shape (one picker holding the leave rows, one
// refusal, one Continue).
//
// DETERMINISM: no clock, no randomness, no network. `src/dev/exclusion.test.ts` scans this
// directory for all three and this file must keep passing it.

import { applyTheme, applySettings } from '../render/theme.ts';
import {
  DEFAULT_SETTINGS,
  screenLayout,
  type TextScale,
} from '../render/settings-model.ts';
import { appendButton, appendLogLine, appendRow, picker } from '../render/components.ts';
import { buttonModel, rowModel } from '../render/component-model.ts';
import { dealDiscardView, dealView, hubMenu } from '../desktop/view-model.ts';
import { createPlayer, type Player } from '../game/player.ts';
import type { SacrificeDeal } from '../game/deal.ts';
import type { ItemInstance } from '../game/item.ts';
import { BACKPACK_CAPACITY } from '../game/inventory.ts';
import {
  CONTENT_WARNING,
  buildArtSlotById,
  buildContentWarning,
  buildSettingsScreen,
} from '../desktop/screens.ts';

// ---------------------------------------------------------------------------------------
// The shapes handed back to the Electron main process as JSON. Every field is a NUMBER, a
// string or a boolean — nothing that needs a serializer, so what the test asserts against is
// exactly what the page measured.
// ---------------------------------------------------------------------------------------

export interface ProbeBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface ProbePane extends ProbeBox {
  /** Total scrollable content height. Greater than `clientHeight` means it really scrolls. */
  scrollHeight: number;
  clientHeight: number;
}

export interface ProbeReport {
  scenario: string;
  scale: TextScale;
  screen: string;
  layout: string;
  viewport: { width: number; height: number };
  narration: ProbePane & { beats: number; lineHeight: number; fontSize: number };
  log: ProbePane & { lines: number };
  column: ProbePane;
  choices: ProbePane & { controls: number };
  /** The scenery figure, when one is mounted. `count` is how many are in the whole stage. */
  scenery: { count: number; box: ProbeBox | null; ratio: number | null };
  /** Every control inside `#choices`, in DOM order. */
  buttons: ProbeBox[];
  page: { scrollHeight: number; clientHeight: number };
  /**
   * For each focusable element in the page, in DOM order, the id of the region it lives in.
   * Reading order and tab order are the same thing when this reads `column` then `choices`.
   */
  focusOrder: string[];
  /** Whether the bundled face really loaded — the measure numbers are only its if it did. */
  fontLoaded: boolean;
}

// ---------------------------------------------------------------------------------------
// THE WORST-CASE CONTENT. Fixed text, so two runs measure the same page.
// ---------------------------------------------------------------------------------------

/**
 * A beat far longer than the eight-line floor — roughly 1,500 characters, which is 21 lines
 * at the widest measure the column ever reaches (72ch) and over 30 at the narrowest (45ch).
 *
 * It is deliberately much longer than the "12-line beat" the defect was reproduced with: the
 * floor is a MINIMUM, and the interesting question is whether prose that exceeds it scrolls
 * inside its own pane or shoves the log and the choices off the screen. Overshooting the
 * worst case is the safe direction (PRINCIPLES §A8).
 */
const BEAT =
  'The stair gives out beneath the ash and you go down with it, one hand raking the wall for ' +
  'a hold that is not there. Somewhere below, water is moving. Not falling — moving, the way ' +
  'a thing moves when it has somewhere to be. The Hollow does not announce itself. It simply ' +
  'takes the edges off the room until you cannot say where the floor stopped and the dark ' +
  'began, and then it waits for you to name the difference out loud so it can take that too. ' +
  'You remember a door. You remember standing at it. You do not remember which side you were ' +
  'on, and the not-remembering has a shape to it, a weight, like a word held under the ' +
  'tongue too long. The Memorians keep a file on you. It is thicker than you would like. ' +
  'They have written down every corridor you have walked twice, every name you have called ' +
  'into a room that answered in your own voice, and the exact hour you stopped counting the ' +
  'floors. There is a lamp ahead that is not a lamp. It does not flicker so much as consider ' +
  'you, and when you step toward it the distance between you does not change at all.';

/** Sixty combat-log lines, every third one carrying dice behind an expander. */
const LOG_LINES: readonly { text: string; detail?: string }[] = Array.from(
  { length: 60 },
  (_unused, i) => {
    const text = `Round ${i + 1} — the Rust Chorister strikes and you take ${(i % 7) + 1} damage.`;
    return i % 3 === 0 ? { text, detail: `attack ${(i % 20) + 1} vs AC 14 · damage 1d8+2` } : { text };
  },
);

/** The five class rows, with the longest label the game actually ships. */
const CLASS_LABELS: readonly string[] = [
  'Enforcer — flesh and steel',
  'Neuromancer — mind and static',
  'Scavver — knives and tempo',
  'Penitent — devotion in blood',
  'Hollow — the Void within',
];

/** Three draft cards at 90 characters each — the length a real offer can reach. */
const DRAFT_LABELS: readonly string[] = [
  'Second Wind — once per fight, when you would fall you instead stand with half your breath',
  'Ashwalker — the Ash City costs you nothing to cross, and its wardens forget you were there',
  'Kindled Blade — every strike you land while below half health burns for one extra damage',
];

/**
 * A rolled item with a long name — the worst case a leave row or a reward line can carry.
 * Built in the `rarityGen` shape by hand, so no RNG is touched (this file must stay free of it).
 */
function longItem(i: number): ItemInstance {
  return {
    defId: `gen:Legendary:mainHand:${i}`,
    rolled: {
      name: `Ashbound Cleaver of the Seventh Ward ${i + 1}`,
      rarity: 'Legendary',
      slot: 'mainHand',
      kind: 'weapon',
      effects: [],
    },
  };
}

/** A bargain whose reward is the long item and whose price names an act (`greed`). */
const DEAL: SacrificeDeal = { pool: 'tempting', cost: { kind: 'greed' }, reward: { kind: 'item', instance: longItem(99) } };

/** A character with a FULL pack (§22.17) of long-named items — the A.3 screen's worst case. */
function fullPackPlayer(size: number = BACKPACK_CAPACITY): Player {
  const base = createPlayer({ name: 'Probe', classId: 'Enforcer', stats: { STR: 12, DEX: 12, CON: 12, INT: 12, WIS: 12, CHA: 12 } });
  const backpack = Array.from({ length: size }, (_unused, i) => longItem(i));
  return { ...base, inventory: { ...base.inventory, backpack } };
}

/**
 * THE MARKING STATE (fix round 2, F3's screen): a pack OVER the cap — fifteen, as a v8 save can
 * hold — with two items already marked to leave. The prompt grows ("Leave 2 more things behind …
 * Leaving: <two long names>.") and the list holds thirteen rows: the worst case the screen meets.
 */
const MARKED = { size: 15, leaving: [0, 5] } as const;

/** Six castable skills, for the battle screen with the Cast list open. */
const CAST_LABELS: readonly string[] = [
  'Rend',
  'Static Bloom',
  'Quicken',
  'Penitence',
  'Hollow Step',
  'Sundering Word',
];

// ---------------------------------------------------------------------------------------
// Element lookup. Throws on a missing id, exactly as the renderer's own `$` does — a probe
// that silently measured `null` would report a clean layout for a page that has no column.
// ---------------------------------------------------------------------------------------

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`layout probe: missing #${id}`);
  return found;
}

function box(target: Element): ProbeBox {
  const r = target.getBoundingClientRect();
  return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
}

function pane(target: HTMLElement): ProbePane {
  return { ...box(target), scrollHeight: target.scrollHeight, clientHeight: target.clientHeight };
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------------------
// Content builders. Each writes into the same real ids the renderer writes into.
// ---------------------------------------------------------------------------------------

function writeBeat(): void {
  const block = document.createElement('p');
  block.className = 'beat';
  block.textContent = BEAT;
  el('narration').appendChild(block);
}

function writeShortBeat(): void {
  const block = document.createElement('p');
  block.className = 'beat';
  block.textContent = 'A descent lies unfinished. Return to it, or begin anew.';
  el('narration').appendChild(block);
}

function writeLog(): void {
  const target = el('log');
  for (const line of LOG_LINES) appendLogLine(target, line);
}

function mountScenery(): void {
  sceneryHost().appendChild(buildArtSlotById('scenery'));
}

/**
 * WHERE THE FLOOR'S RESERVED REGION IS MOUNTED — the one line that mirrors `renderHub`.
 *
 * It is a named function rather than an inline lookup because it is also the ONE line that
 * has to move if the scenery is ever relocated (see the reversal note in `desktop.html`).
 */
function sceneryHost(): HTMLElement {
  return el('scenery');
}

/** The `.hub-menu` wrapper `renderHub` builds around the pure `hubMenu` rows. MIRRORED. */
function buildHub(mode: 'menu' | 'confirm-abandon'): void {
  const choices = el('choices');
  const view = hubMenu(mode);

  const prompt = document.createElement('p');
  prompt.className = 'hub-prompt';
  prompt.textContent = view.prompt ?? '';
  choices.appendChild(prompt);

  const list = document.createElement('div');
  list.className = 'hub-menu';
  choices.appendChild(list);
  for (const item of view.items) {
    const button = appendButton(list, buttonModel(item.label), () => undefined);
    button.classList.toggle('is-destructive', item.destructive === true);
    button.classList.toggle('is-separated', item.separated === true);
  }
}

/** The battle control list from `renderChoices`'s `battle-action` case. MIRRORED. */
function buildBattle(openPicker: boolean): void {
  const choices = el('choices');
  appendButton(choices, buttonModel('Fight'), () => undefined);
  const wrap = picker(choices, 'Cast', (list) => {
    for (const [i, name] of CAST_LABELS.entries()) {
      appendButton(list, buttonModel(name, { hint: `(${(i % 3) + 1}⚡)` }), () => undefined);
    }
  });
  appendButton(choices, buttonModel('Spare'), () => undefined);
  picker(choices, 'Use item', (list) => {
    appendButton(list, buttonModel('Ash Draught', { hint: '(common)' }), () => undefined);
  });
  // PLAN.md #2 / §22.6: no Potion button — the real battle case lost it when potions folded
  // into consumables (they are in the Use-item picker above).
  appendButton(choices, buttonModel('Run'), () => undefined);
  // Opening it through the real element the real `picker` built, rather than by hand: the
  // measured height is then the height a player's click produces.
  const toggle = wrap.querySelector('button');
  if (openPicker && toggle) toggle.click();
}

/** A nineteen-row inventory — a full paperdoll plus a loaded backpack. */
function buildInventory(): void {
  const choices = el('choices');
  const wrap = document.createElement('div');
  wrap.className = 'vm-screen';
  const gear = document.createElement('h3');
  gear.textContent = 'Equipped';
  wrap.appendChild(gear);
  for (const slot of ['weapon', 'armor', 'trinket', 'relic']) {
    appendRow(wrap, rowModel(slot, 'Ashbound Cleaver · uncommon'));
  }
  const pack = document.createElement('h3');
  pack.textContent = 'Backpack';
  wrap.appendChild(pack);
  for (let i = 0; i < 15; i += 1) {
    const row = appendRow(wrap, rowModel(`#${i}`, 'Grave Salt · common'));
    // PLAN.md #2: every backpack row carries a Discard (MIRRORED from renderInventoryScreen).
    appendButton(row, buttonModel('Discard'), () => undefined);
  }
  choices.appendChild(wrap);
  appendButton(choices, buttonModel('Back'), () => undefined);
}

/** The found rest spot — `case 'rest'` in `renderChoices`: the scenery, one Continue. MIRRORED. */
function buildRest(): void {
  mountScenery();
  appendButton(el('choices'), buttonModel('Continue'), () => undefined);
}

/** `case 'deal-decision'`: the cost/reward block and the two answers. MIRRORED. */
function buildDealDecision(): void {
  const choices = el('choices');
  const dv = dealView(DEAL);
  const block = document.createElement('div');
  block.className = 'deal-block';
  const cost = document.createElement('div');
  cost.className = 'deal-cost';
  cost.textContent = `Cost: ${dv.cost}`;
  const reward = document.createElement('div');
  reward.className = 'deal-reward';
  reward.textContent = `Reward: ${dv.reward}`;
  block.append(cost, reward);
  choices.appendChild(block);
  appendButton(choices, buttonModel('Pay the price'), () => undefined);
  appendButton(choices, buttonModel('Refuse'), () => undefined);
}

/** `case 'deal-discard'` (Appendix A.3): the block, the closed leave list, the refusal. MIRRORED. */
function buildDealDiscard(openList: boolean, marked = false): void {
  const choices = el('choices');
  const view = marked
    ? dealDiscardView(fullPackPlayer(MARKED.size), DEAL, MARKED.leaving)
    : dealDiscardView(fullPackPlayer(), DEAL);
  const block = document.createElement('div');
  block.className = 'deal-block';
  const ask = document.createElement('div');
  ask.className = 'deal-reward';
  ask.textContent = view.prompt;
  const cost = document.createElement('div');
  cost.className = 'deal-cost';
  cost.textContent = `Cost: ${view.cost}`;
  block.append(ask, cost);
  choices.appendChild(block);
  const wrap = picker(choices, view.choose, (list) => {
    for (const row of view.leave) appendButton(list, buttonModel(row.label), () => undefined);
  });
  appendButton(choices, buttonModel(view.refuse), () => undefined);
  // Opened through the real toggle the real `picker` built, as the battle case does.
  const toggle = wrap.querySelector('button');
  if (openList && toggle) toggle.click();
}

/** The end-of-run record: the same panel shape, with the run's own headline. */
function buildGameOver(): void {
  const choices = el('choices');
  const wrap = document.createElement('div');
  wrap.className = 'vm-screen run-summary';
  const head = document.createElement('h3');
  head.textContent = 'The descent ends on the Ash City';
  wrap.appendChild(head);
  for (const [label, value] of [
    ['Outcome', 'damnation'],
    ['Depth', 'Act 3'],
    ['Bosses felled', 'The Choir of Rust'],
    ['Spared', '2'],
    ['Unlocked', 'Neuromancer'],
    ['Seed', '4242'],
  ] as const) {
    appendRow(wrap, rowModel(label, value));
  }
  choices.appendChild(wrap);
  appendButton(choices, buttonModel('Descend again'), () => undefined);
}

// ---------------------------------------------------------------------------------------
// The scenarios. Each one names the `data-screen` key the renderer would write, whether the
// narration carries prose, and what goes into the three panes.
// ---------------------------------------------------------------------------------------

interface Scenario {
  /** The `data-screen` value the real renderer writes for this state. */
  screen: string;
  build: () => void;
}

const SCENARIOS: Readonly<Record<string, Scenario>> = {
  hub: {
    screen: 'main-menu',
    build: () => {
      mountScenery();
      writeBeat();
      writeLog();
      buildHub('menu');
    },
  },
  'confirm-abandon': {
    screen: 'confirm-abandon',
    build: () => {
      mountScenery();
      writeBeat();
      writeLog();
      buildHub('confirm-abandon');
    },
  },
  battle: {
    screen: 'battle-action',
    build: () => {
      writeBeat();
      writeLog();
      buildBattle(false);
    },
  },
  'battle-open': {
    screen: 'battle-action',
    build: () => {
      writeBeat();
      writeLog();
      buildBattle(true);
    },
  },
  'choose-class': {
    screen: 'choose-class',
    build: () => {
      writeBeat();
      for (const label of CLASS_LABELS) {
        appendButton(el('choices'), buttonModel(label), () => undefined);
      }
    },
  },
  'draft-pick': {
    screen: 'draft-pick',
    build: () => {
      writeBeat();
      const note = document.createElement('div');
      note.className = 'stats-line';
      note.textContent = 'Choose one — the descent reshapes you.';
      el('choices').appendChild(note);
      for (const label of DRAFT_LABELS) {
        appendButton(el('choices'), buttonModel(label), () => undefined).classList.add('draft-card');
      }
    },
  },
  // PLAN.md #2: the found rest spot — the scenery frame's other job (§22.26).
  rest: {
    screen: 'rest',
    build: () => {
      writeBeat();
      writeLog();
      buildRest();
    },
  },
  'deal-decision': {
    screen: 'deal-decision',
    build: () => {
      writeBeat();
      writeLog();
      buildDealDecision();
    },
  },
  // Appendix A.3: the full-pack bargain, as it opens, and with its leave list opened.
  'deal-discard': {
    screen: 'deal-discard',
    build: () => {
      writeBeat();
      writeLog();
      buildDealDiscard(false);
    },
  },
  'deal-discard-open': {
    screen: 'deal-discard',
    build: () => {
      writeBeat();
      writeLog();
      buildDealDiscard(true);
    },
  },
  // Fix round 2: the MARKING state F3 added — fifteen items, two marked, closed and open.
  'deal-discard-marked': {
    screen: 'deal-discard',
    build: () => {
      writeBeat();
      writeLog();
      buildDealDiscard(false, true);
    },
  },
  'deal-discard-marked-open': {
    screen: 'deal-discard',
    build: () => {
      writeBeat();
      writeLog();
      buildDealDiscard(true, true);
    },
  },
  inventory: {
    screen: 'inventory',
    build: () => {
      writeBeat();
      writeLog();
      buildInventory();
    },
  },
  settings: {
    screen: 'settings',
    build: () => {
      writeBeat();
      el('choices').appendChild(buildSettingsScreen(DEFAULT_SETTINGS, () => undefined));
      appendButton(el('choices'), buttonModel('Back'), () => undefined);
    },
  },
  'content-warning': {
    screen: 'content-warning',
    build: () => {
      el('choices').appendChild(buildContentWarning(CONTENT_WARNING, () => undefined));
    },
  },
  title: {
    screen: 'title',
    build: () => {
      appendButton(el('choices'), buttonModel('Descend into the Void'), () => undefined);
      appendButton(el('choices'), buttonModel('Settings'), () => undefined);
    },
  },
  resume: {
    screen: 'resume',
    build: () => {
      writeShortBeat();
      appendButton(el('choices'), buttonModel('Continue your descent'), () => undefined);
      appendButton(el('choices'), buttonModel('Begin a new descent'), () => undefined);
    },
  },
  'game-over': {
    screen: 'game-over',
    build: () => {
      writeBeat();
      writeLog();
      buildGameOver();
    },
  },
};

/** Every scenario name, so the Electron half does not have to repeat the list. */
export const SCENARIO_NAMES: readonly string[] = Object.keys(SCENARIOS);

// ---------------------------------------------------------------------------------------
// The run itself.
// ---------------------------------------------------------------------------------------

function reset(): void {
  for (const id of ['narration', 'log', 'choices']) el(id).replaceChildren();
  sceneryHost().replaceChildren();
  el('notice').replaceChildren();
}

function focusRegion(target: Element): string {
  const owner = target.closest('#column, #choices, #sheet, #stage');
  return owner ? owner.id : 'elsewhere';
}

function measure(name: string, scale: TextScale, screen: string): ProbeReport {
  const narration = el('narration');
  const logEl = el('log');
  const choices = el('choices');
  const column = el('column');
  const computed = getComputedStyle(narration);
  const slots = document.querySelectorAll('.void-art-slot[data-art-slot="scenery"]');
  const first = slots[0] ?? null;
  const slotBox = first ? box(first) : null;
  const controls = [...choices.querySelectorAll('button')];

  return {
    scenario: name,
    scale,
    screen,
    layout: document.body.dataset['layout'] ?? '',
    viewport: { width: window.innerWidth, height: window.innerHeight },
    narration: {
      ...pane(narration),
      beats: narration.querySelectorAll('.beat').length,
      lineHeight: px(computed.lineHeight),
      fontSize: px(computed.fontSize),
    },
    log: { ...pane(logEl), lines: logEl.querySelectorAll('.void-log-line').length },
    column: pane(column),
    choices: { ...pane(choices), controls: controls.length },
    scenery: {
      count: slots.length,
      box: slotBox,
      ratio: slotBox && slotBox.height > 0 ? slotBox.width / slotBox.height : null,
    },
    buttons: controls.map(box),
    page: {
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    },
    focusOrder: [...document.querySelectorAll('button, summary, input, [tabindex]')].map(focusRegion),
    fontLoaded: document.fonts.check('15px "JetBrains Mono"'),
  };
}

/**
 * Render one scenario at one text size and measure it.
 *
 * The theme and the settings are applied through the REAL `applyTheme` / `applySettings`, in
 * the real order, because without the `--void-*` custom properties they write NOTHING on the
 * page has a size — every token read resolves to nothing and the whole measurement would be
 * of an unstyled document.
 */
export function run(options: { scenario: string; scale: TextScale }): ProbeReport {
  const scenario = SCENARIOS[options.scenario];
  if (!scenario) throw new Error(`layout probe: no scenario '${options.scenario}'`);

  applyTheme(document.documentElement, 0);
  applySettings(document.documentElement, { ...DEFAULT_SETTINGS, textScale: options.scale }, 0);

  reset();
  document.body.dataset['screen'] = scenario.screen;
  document.body.dataset['layout'] = screenLayout(scenario.screen);
  el('title').style.display = scenario.screen === 'title' ? 'block' : 'none';
  scenario.build();

  return measure(options.scenario, options.scale, scenario.screen);
}

declare global {
  interface Window {
    __voidLayoutProbe: { run: typeof run; scenarios: readonly string[] };
  }
}

window.__voidLayoutProbe = { run, scenarios: SCENARIO_NAMES };
