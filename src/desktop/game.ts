// The Void — LLM-narrated game renderer (N-series vertical slice).
//
// Reuses everything: the pure engine (`step`) drives all rules, state, and the
// legal choices; the local model narrates each beat (via the N1 IPC bridge).
// This is the DOM game UI; the Kaplay layer (index.html) is a separate artifact.
import { createGame, step, awaitingFor } from '../game/game.ts';
import type { GameState, GameInput, Awaiting } from '../game/game.ts';
import { STAT_KEYS } from '../game/character.ts';
import { describeDraftOption } from '../game/draft.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { buildNarrationPrompt, createStoryMemory, rememberBeat } from '../llm/narrate.ts';
import { loadRun, saveRun, clearRun } from './persist.ts';
import {
  displayPlayer,
  castOptions,
  consumableOptions,
  spareOffered,
  describeInventory,
  equipFromBackpack,
  unequipSlot,
} from './view-model.ts';
import type { ItemView } from './view-model.ts';
import { log, consoleSink, createRingBuffer } from '../log/logger.ts';
import { createDebugOverlay } from './debug-overlay.ts';

interface GenStats { text: string; tokens: number; tokensPerSecond: number; ttftMs: number }
interface VoidApi {
  onStatus(cb: (s: { phase: string; gpu?: unknown; device?: string | null; message?: string }) => void): () => void;
  generate(o: { prompt: string; system?: string; onToken?: (c: string) => void }): Promise<GenStats>;
  log?(entry: unknown): void;
}
declare global { interface Window { void: VoidApi } }

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const titleEl = $('title');
const statusEl = $('status');
const narrationEl = $('narration');
const choicesEl = $('choices');
const sheetEl = $('sheet');

// ---- Logging: console + in-memory ring (for the debug overlay) + forward to
// the Electron main process (which writes the log file). Overlay: ` or F2.
const ring = createRingBuffer(1000);
log.addSink(consoleSink);
log.addSink(ring.sink);
log.addSink((e) => {
  try {
    window.void.log?.(e);
  } catch {
    /* main not ready */
  }
});
createDebugOverlay(ring.get);
log.info('game', 'renderer booted');
window.addEventListener('error', (ev) =>
  log.error('error', 'window error', { message: ev.message, source: ev.filename, line: ev.lineno }),
);
window.addEventListener('unhandledrejection', (ev) =>
  log.error('error', 'unhandled rejection', { reason: String(ev.reason) }),
);

let state: GameState = createGame(Date.now() >>> 0);
let memory = createStoryMemory(); // rolling "story so far" fed to the narrator

window.void.onStatus((s) => {
  log.info('llm', `model ${s.phase}`, s);
  if (s.phase === 'ready') {
    statusEl.textContent = `the Void is listening — ${s.gpu ? `GPU (${s.device ? String(s.device) : String(s.gpu)})` : 'CPU'}`;
  } else if (s.phase === 'loading') statusEl.textContent = 'the Void stirs (loading model)…';
  else if (s.phase === 'resolving') statusEl.textContent = 'locating the model…';
  else if (s.phase === 'error') {
    statusEl.textContent = `error: ${s.message ?? 'unknown'}`;
    statusEl.classList.add('error');
  }
});

function renderSheet(): void {
  // The live battle combatant during a battle (HP ticks down each round), else
  // the snapshot — the top-level state.player is stale mid-battle. See view-model.
  const p = displayPlayer(state);
  if (!p) {
    sheetEl.innerHTML = '';
    return;
  }
  const lines = [
    `<b>${p.name}</b>`,
    `${p.classId}`,
    `HP ${p.hp}/${p.maxHp}`,
    `XP ${p.xp}`,
    `Act ${state.act}`,
    `Pots ${p.pots} · Rests ${p.restsLeft}`,
  ];
  if (state.phase.kind === 'battle') {
    const e = state.phase.battle.enemy;
    lines.push('<hr/>', `<span class="foe">${e.fullName}</span>`, `HP ${e.hp}/${e.maxHp}`);
  }
  sheetEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
}

async function narrate(events: readonly GameEvent[]): Promise<void> {
  // Show ONLY the current moment: replace the narration area each turn rather
  // than accumulating a growing scroll of past beats (bug 2).
  narrationEl.innerHTML = '';
  const prompt = buildNarrationPrompt(events, state, memory);
  if (!prompt) return; // pure-input phase: nothing narratable — leave the area blank.
  log.debug('llm', 'narrate:request', { promptChars: prompt.user.length });
  const block = document.createElement('p');
  block.className = 'beat';
  narrationEl.appendChild(block);
  narrationEl.scrollTop = narrationEl.scrollHeight;
  try {
    const stats = await window.void.generate({
      prompt: prompt.user,
      system: prompt.system,
      onToken: (c) => {
        block.textContent += c;
        narrationEl.scrollTop = narrationEl.scrollHeight;
      },
    });
    log.debug('llm', 'narrate:done', {
      tokens: stats.tokens,
      tokPerSec: Math.round(stats.tokensPerSecond),
      ttftMs: Math.round(stats.ttftMs),
    });
  } catch (err) {
    // Resilience: if the model fails, fall back to the plain facts so the game
    // remains fully playable (engine is authoritative regardless).
    log.error('llm', 'narrate:failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    block.textContent = prompt.user.split('\n\n')[0] ?? '(the Void is silent)';
    block.classList.add('fallback');
  }
}

function button(label: string, onClick: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick, { once: true });
  choicesEl.appendChild(b);
}

// Append one option button to an arbitrary container (used by the inline pickers and the
// inventory/sheet screens). A disabled option (e.g. an unaffordable skill) is visibly
// greyed and inert. `once` so a click can't double-fire before the re-render clears it.
function optionButton(
  parent: HTMLElement,
  label: string,
  onClick: () => void,
  disabled = false,
): void {
  const b = document.createElement('button');
  b.textContent = label;
  if (disabled) {
    b.disabled = true;
    b.classList.add('disabled');
  } else {
    b.addEventListener('click', onClick, { once: true });
  }
  parent.appendChild(b);
}

// An inline expander: a toggle button in #choices that reveals/hides a sub-list of option
// buttons built by `build`. Keeps the battle Cast / Use-item pickers on the existing
// containers — no desktop.html change needed.
function pickerButton(label: string, build: (list: HTMLElement) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  const toggle = document.createElement('button');
  toggle.textContent = label;
  const list = document.createElement('div');
  list.className = 'picker-list';
  list.style.display = 'none';
  toggle.addEventListener('click', () => {
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
  });
  wrap.appendChild(toggle);
  wrap.appendChild(list);
  build(list);
  choicesEl.appendChild(wrap);
}

// Render-layer UI mode for the hub screens (NOT game state): the plain game flow, the
// inventory/equipment screen, or the full character sheet. Only reachable from the hub;
// reset to 'game' whenever a real engine action is dispatched.
let screen: 'game' | 'inventory' | 'sheet' = 'game';

// Re-render the current phase's choices + HUD WITHOUT dispatching to the engine — used by
// the hub screen buttons (Inventory / Character sheet / Back) and the equip/unequip actions.
function rerender(): void {
  renderSheet();
  renderChoices(awaitingFor(state.phase));
}

// A labelled row (label + value/name), the shared building block for the inventory and
// character-sheet screens. Returns the row so callers can append action buttons.
function vmRow(parent: HTMLElement, label: string, value: string, empty = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'vm-row';
  const lab = document.createElement('span');
  lab.className = 'vm-label';
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = empty ? 'vm-empty' : 'vm-name';
  val.textContent = value;
  row.appendChild(lab);
  row.appendChild(val);
  parent.appendChild(row);
  return row;
}

// One "Name — Rarity" fragment plus an effects line, appended to a row's value cell.
function itemLabel(item: ItemView): string {
  return `${item.name} · ${item.rarity}`;
}

// The hub inventory / equipment screen: paperdoll slots (each equipped item with Unequip)
// and the backpack (each item with Equip). Equip/unequip go through the PURE view-model
// action-mapping helpers, then autosave + re-render. Reads state.player (hub-authoritative).
function renderInventoryScreen(): void {
  const p = state.player;
  if (!p) {
    screen = 'game';
    rerender();
    return;
  }
  const view = describeInventory(p);
  const wrap = document.createElement('div');
  wrap.className = 'vm-screen';

  const gearHead = document.createElement('h3');
  gearHead.textContent = 'Equipped';
  wrap.appendChild(gearHead);
  for (const s of view.slots) {
    const row = vmRow(wrap, s.slot, s.item ? itemLabel(s.item) : '(empty)', !s.item);
    if (s.item) {
      optionButton(row, 'Unequip', () => {
        const r = unequipSlot(state, s.slot);
        if (r.ok) {
          state = r.state;
          saveRun(state, memory);
        }
        rerender();
      });
    }
  }

  const packHead = document.createElement('h3');
  packHead.textContent = 'Backpack';
  wrap.appendChild(packHead);
  if (view.backpack.length === 0) {
    vmRow(wrap, '', '(empty)', true);
  }
  for (const b of view.backpack) {
    const row = vmRow(wrap, `#${b.index}`, itemLabel(b.item));
    if (b.item.effects.length > 0) {
      const fx = document.createElement('span');
      fx.className = 'vm-effects';
      fx.textContent = b.item.effects.join('; ');
      row.appendChild(fx);
    }
    // Equip only slottable gear (usables have slot: null — no equip target).
    if (b.item.slot) {
      optionButton(row, 'Equip', () => {
        const r = equipFromBackpack(state, b.index);
        if (r.ok) {
          state = r.state;
          saveRun(state, memory);
        }
        rerender();
      });
    }
  }

  choicesEl.appendChild(wrap);
  button('Back', () => {
    screen = 'game';
    rerender();
  });
}

// Show a transient indicator while the narrator generates, in place of the
// (already-cleared) choice buttons. renderChoices() clears this when done.
function showThinking(): void {
  choicesEl.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'thinking';
  div.textContent = 'the Void speaks…';
  choicesEl.appendChild(div);
}

// Re-entry guard: a step + narration is in flight. Buttons use { once: true } and
// choices are cleared on entry, but fast clicks, the name-field Enter key, and the
// level-up multi-pick can still fire mid-generation — this is the real lock (bug 4).
let busy = false;

async function dispatch(input: GameInput): Promise<void> {
  if (busy) return;
  busy = true;
  screen = 'game'; // a real engine transition always returns to the plain game view
  try {
    choicesEl.innerHTML = '';
    log.debug('ui', 'choice', input);
    const r = step(state, input);
    state = r.state;
    log.debug('engine', `step -> ${r.awaiting}`, {
      input,
      awaiting: r.awaiting,
      events: r.events.map((e) => e.kind),
      hp: state.player ? `${state.player.hp}/${state.player.maxHp}` : null,
      act: state.act,
    });
    renderSheet();
    showThinking();
    await narrate(r.events);
    memory = rememberBeat(memory, r.events); // remember AFTER narrating
    renderChoices(r.awaiting);
    if (r.awaiting === 'game-over') {
      clearRun();
      log.info('save', 'run cleared (game over)');
    } else {
      saveRun(state, memory);
      log.debug('save', 'run autosaved');
    }
  } finally {
    busy = false;
  }
}

function start(): void {
  clearRun();
  log.info('game', 'new run started');
  state = createGame(Date.now() >>> 0);
  memory = createStoryMemory();
  narrationEl.innerHTML = '';
  renderSheet();
  renderChoices('title');
}

function renderChoices(awaiting: Awaiting): void {
  choicesEl.innerHTML = '';
  titleEl.style.display = awaiting === 'title' ? 'block' : 'none';

  switch (awaiting) {
    case 'title':
      button('Descend into the Void', () => void dispatch({ kind: 'continue' }));
      break;
    case 'enter-name': {
      const input = document.createElement('input');
      input.placeholder = 'your name';
      input.maxLength = 20;
      const submit = () => {
        const name = input.value.trim() || 'Nameless';
        void dispatch({ kind: 'name', name });
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      choicesEl.appendChild(input);
      button('Enter the Void', submit);
      input.focus();
      break;
    }
    case 'choose-class':
      // All five selectable (M3); unlock gating is M13. Dispatch-only — the engine rules.
      button('Enforcer — flesh and steel', () => void dispatch({ kind: 'class', classId: 'Enforcer' }));
      button('Neuromancer — mind and static', () => void dispatch({ kind: 'class', classId: 'Neuromancer' }));
      button('Scavver — knives and tempo', () => void dispatch({ kind: 'class', classId: 'Scavver' }));
      button('Penitent — devotion in blood', () => void dispatch({ kind: 'class', classId: 'Penitent' }));
      button('Hollow — the Void within', () => void dispatch({ kind: 'class', classId: 'Hollow' }));
      break;
    case 'accept-or-reroll-stats': {
      if (state.phase.kind === 'stats-roll') {
        const s = state.phase.stats;
        const line = document.createElement('div');
        line.className = 'stats-line';
        line.textContent = STAT_KEYS.map((k) => `${k} ${s[k]}`).join('   ');
        choicesEl.appendChild(line);
      }
      button('Accept these', () => void dispatch({ kind: 'stats-decision', accept: true }));
      button('Reroll', () => void dispatch({ kind: 'stats-decision', accept: false }));
      break;
    }
    case 'main-menu':
      if (screen === 'inventory') {
        renderInventoryScreen();
        break;
      }
      button('Continue the descent', () => void dispatch({ kind: 'menu', choice: 'continue' }));
      button('Seek a bargain', () => void dispatch({ kind: 'menu', choice: 'seek-deal' }));
      button('Abandon the descent', () => void dispatch({ kind: 'menu', choice: 'quit' }));
      button('Inventory', () => {
        screen = 'inventory';
        rerender();
      });
      break;
    case 'battle-action': {
      const p = displayPlayer(state);
      button('Fight', () => void dispatch({ kind: 'battle-action', action: 'fight' }));
      // Cast: an inline picker of the player's skills with charge costs; unaffordable
      // skills render disabled. The engine re-checks the charge on dispatch.
      const casts = p ? castOptions(p) : [];
      if (casts.length > 0) {
        pickerButton('Cast', (list) => {
          for (const c of casts) {
            optionButton(
              list,
              `${c.name} (${c.chargeCost}⚡)`,
              () => void dispatch({ kind: 'battle-action', action: { kind: 'cast', skillId: c.skillId } }),
              !c.affordable,
            );
          }
        });
      }
      // Spare: only against a living karma-weighted enemy (the engine's own gate).
      if (spareOffered(state)) {
        button('Spare', () => void dispatch({ kind: 'battle-action', action: 'spare' }));
      }
      // Use item: an inline picker of usable consumables in the backpack (by index).
      const items = p ? consumableOptions(p) : [];
      if (items.length > 0) {
        pickerButton('Use item', (list) => {
          for (const it of items) {
            optionButton(list, `${it.name} (${it.rarity})`, () =>
              void dispatch({ kind: 'battle-action', action: { kind: 'useConsumable', source: { index: it.index } } }),
            );
          }
        });
      }
      button('Potion', () => void dispatch({ kind: 'battle-action', action: 'potion' }));
      button('Run', () => void dispatch({ kind: 'battle-action', action: 'run' }));
      break;
    }
    case 'continue':
      button('Continue', () => void dispatch({ kind: 'continue' }));
      break;
    case 'draft-pick': {
      // M9: a minimal functional draft picker — one button per offered option (index-dispatch).
      const note = document.createElement('div');
      note.className = 'stats-line';
      note.textContent = 'Choose one — the descent reshapes you.';
      choicesEl.appendChild(note);
      if (state.phase.kind === 'level-up-draft') {
        state.phase.offers.forEach((offer, i) => {
          button(describeDraftOption(offer), () => void dispatch({ kind: 'draft-pick', index: i }));
        });
      }
      break;
    }
    case 'deal-decision':
      button('Pay the price', () => void dispatch({ kind: 'deal-decision', accept: true }));
      button('Refuse', () => void dispatch({ kind: 'deal-decision', accept: false }));
      break;
    case 'rest-decision':
      button('Rest here', () => void dispatch({ kind: 'rest-decision', accept: true }));
      button('Press on', () => void dispatch({ kind: 'rest-decision', accept: false }));
      break;
    case 'game-over':
      button('Descend again', () => start());
      break;
  }
}

function renderResume(): void {
  titleEl.style.display = 'block';
  narrationEl.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'beat';
  p.textContent = 'A descent lies unfinished. Return to it, or begin anew.';
  narrationEl.appendChild(p);
  choicesEl.innerHTML = '';
  button('Continue your descent', () => renderChoices(awaitingFor(state.phase)));
  button('Begin a new descent', () => start());
}

const saved = loadRun();
if (saved) {
  log.info('save', 'resumable run found', { act: saved.state.act, phase: saved.state.phase.kind });
  state = saved.state;
  memory = saved.memory;
  renderSheet();
  renderResume();
} else {
  start();
}
