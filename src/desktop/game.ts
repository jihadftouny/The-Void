// The Void — LLM-narrated game renderer (N-series vertical slice).
//
// Reuses everything: the pure engine (`step`) drives all rules, state, and the
// legal choices; the local model narrates each beat (via the N1 IPC bridge).
// This is THE game UI. (Until M-UI2 there was a second, standalone Kaplay front-end at
// index.html + src/scenes/; it was deleted — see docs/UI-DESIGN.md §8 — and `src/render/`
// is now the shared render foundation this file builds on: tokens, theme, components,
// event formatting.)
import { createGame, step, awaitingFor } from '../game/game.ts';
import type { GameState, GameInput, Awaiting } from '../game/game.ts';
import type { PlayerClass } from '../game/player.ts';
import { STAT_KEYS } from '../game/character.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { buildNarrationPrompt, createStoryMemory, rememberBeat } from '../llm/narrate.ts';
import { loadRun, saveRun, clearRun, type RunMeta } from './persist.ts';
import {
  snapshotUnlocks,
  classUnlocked,
  foldRunEvents,
  emptyRunSummary,
  applyRunSummary,
  type RunSummary,
  type NewlyUnlocked,
} from '../game/unlockStore.ts';
import { loadUnlockStore, saveUnlockStore } from '../storage/unlockStorage.ts';
import {
  displayPlayer,
  castOptions,
  consumableOptions,
  spareOffered,
  describeInventory,
  equipFromBackpack,
  unequipSlot,
  characterSheet,
  dealView,
  draftCards,
  chestReveal,
} from './view-model.ts';
import type { ItemView } from './view-model.ts';
import { log, consoleSink, createRingBuffer } from '../log/logger.ts';
import { createDebugOverlay } from './debug-overlay.ts';
// The shared render foundation (M-UI2 `ui-foundation`).
import { applyTheme } from '../render/theme.ts';
import { buttonModel, rowModel } from '../render/component-model.ts';
import { appendButton, appendRow, picker } from '../render/components.ts';

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

// M13 meta-progression: the persistent cross-run unlock store, loaded once at boot. Read at
// class-select (gating) and run start (snapshot); grown at run end (applyRunSummary + persist).
let unlockStore = loadUnlockStore();
let runSeed = Date.now() >>> 0;
let state: GameState = createGame(runSeed, snapshotUnlocks(unlockStore));
let memory = createStoryMemory(); // rolling "story so far" fed to the narrator
// The pure run-summary subscriber: folded from each step's events, applied to the store at the
// terminal phase. Reset per run. `runApplied` guards against a double-apply (ending -> game-over).
let runSummary: RunSummary = emptyRunSummary();
let runApplied = false;
// The ids most recently unlocked (for the deferred in-UI notification — NEEDS-HUMAN).
let lastNewlyUnlocked: NewlyUnlocked | null = null;
void lastNewlyUnlocked; // consumed by the deferred unlock-notification UI (out of scope here)

/** The class-select buttons, gated by the unlock store (Enforcer always shown). */
const CLASS_BUTTONS: readonly { classId: PlayerClass; label: string }[] = [
  { classId: 'Enforcer', label: 'Enforcer — flesh and steel' },
  { classId: 'Neuromancer', label: 'Neuromancer — mind and static' },
  { classId: 'Scavver', label: 'Scavver — knives and tempo' },
  { classId: 'Penitent', label: 'Penitent — devotion in blood' },
  { classId: 'Hollow', label: 'Hollow — the Void within' },
];

/**
 * The renderer-side run bookkeeping that must be SAVED alongside the engine state — G19.
 * `runSummary` decides which feats fire at the end of the run and `runSeed` is the run
 * identity `applyRunSummary` records; neither lives in `GameState`, so neither survived a
 * save. Resuming therefore restarted the feat tally from zero and quietly forfeited
 * everything the run had earned (reproduced: seed 4242 unlocks the Neuromancer played
 * straight through, and unlocks nothing when resumed from its own act-2 state).
 */
function runMeta(): RunMeta {
  return { runSummary, runSeed };
}

/**
 * At a terminal phase (an ending, or game-over), fold the run's summary into the persistent
 * unlock store ONCE and persist it. Idempotent per run via `runApplied`. The newly-unlocked ids
 * are stashed for a deferred in-UI notification (NEEDS-HUMAN).
 */
function applyRunOutcome(): void {
  if (runApplied) return;
  runApplied = true;
  const applied = applyRunSummary(unlockStore, runSummary, runSeed);
  unlockStore = applied.store;
  saveUnlockStore(unlockStore);
  lastNewlyUnlocked = applied.newlyUnlocked;
  log.info('unlocks', 'run outcome applied', { newlyUnlocked: applied.newlyUnlocked });
}

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

/**
 * Re-tint the whole UI for the floor the player is currently on. The accent is a RUNTIME
 * switch (`state.place`, 0..4), so descending re-colours every panel, chip, bar and focus
 * ring at once with no reload and no per-floor CSS class. Called at boot and after every
 * engine step, because a step is the only thing that can change the floor. `applyTheme`
 * clamps `place`, so this can never throw mid-render.
 */
function retheme(): void {
  applyTheme(document.documentElement, state.place);
}

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
  const prompt = buildNarrationPrompt(events, state, memory);
  // G42 — CHECK BEFORE CLEARING. This used to clear the pane first and discover the null
  // prompt second, so a step with nothing to narrate wiped whatever was on screen. The
  // worst case is the last thing a completed run shows you: `game.ts`'s terminal step
  // deliberately emits NO events "so the run's final event stays the `ending` event", so
  // the player read the ASCENSION or DAMNATION text, pressed Continue, and landed on an
  // empty pane with a lone "Descend again".
  //
  // ⚠ THE COST, and why it is the right trade. Leaving the pane alone turns a step with no
  // fact from BLANK into STALE — the previous beat stays up. That is CORRECT for a rejected
  // input (`cast-unavailable`, `potion-blocked`, …): nothing happened, so the narration
  // should not change. It would be a lie for anything that did happen, which is why the
  // deliberate-silence list in src/llm/narrate.ts is curated rather than "everything the
  // register did not name", and why `rest-declined`, `no-rests`, `shield-gained`,
  // `shield-absorbed` and `revive` are narrated even though G13 never named them. If you
  // add a silent case there, you are choosing to leave the previous beat on screen here.
  if (!prompt) return;
  // Show ONLY the current moment: replace the narration area each turn rather
  // than accumulating a growing scroll of past beats (bug 2).
  narrationEl.innerHTML = '';
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

// The primary choice button: the shared `actionButton` component bound to the #choices
// container. This is a partial application of the shared component, NOT a second
// implementation of one — every button in the game is built by `src/render/components.ts`.
function choice(label: string, onClick: () => void): void {
  appendButton(choicesEl, buttonModel(label), onClick);
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

// A labelled row is now the shared `labelledRow` component; call sites build a `rowModel`
// (or, where a screen wants its own wording for "nothing here", a literal RowModel) and
// hand it to `appendRow`, which returns the row so actions can be appended to it.

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
    const row = appendRow(wrap, rowModel(s.slot, s.item ? itemLabel(s.item) : null));
    if (s.item) {
      appendButton(row, buttonModel('Unequip'), () => {
        const r = unequipSlot(state, s.slot);
        if (r.ok) {
          state = r.state;
          saveRun(state, memory, runMeta());
        }
        rerender();
      });
    }
  }

  const packHead = document.createElement('h3');
  packHead.textContent = 'Backpack';
  wrap.appendChild(packHead);
  if (view.backpack.length === 0) {
    appendRow(wrap, rowModel('', null));
  }
  for (const b of view.backpack) {
    const row = appendRow(wrap, rowModel(`#${b.index}`, itemLabel(b.item)));
    if (b.item.effects.length > 0) {
      const fx = document.createElement('span');
      fx.className = 'vm-effects';
      fx.textContent = b.item.effects.join('; ');
      row.appendChild(fx);
    }
    // Equip only slottable gear (usables have slot: null — no equip target).
    if (b.item.slot) {
      appendButton(row, buttonModel('Equip'), () => {
        const r = equipFromBackpack(state, b.index);
        if (r.ok) {
          state = r.state;
          saveRun(state, memory, runMeta());
        }
        rerender();
      });
    }
  }

  choicesEl.appendChild(wrap);
  choice('Back', () => {
    screen = 'game';
    rerender();
  });
}

// The hub full character sheet: level, six stats (+mods), HP, AC, skill charges, skills,
// equipped gear, and the class build-resource. NEVER karma/Nature (the view-model omits it).
function renderSheetScreen(): void {
  const p = state.player;
  if (!p) {
    screen = 'game';
    rerender();
    return;
  }
  const sheet = characterSheet(p);
  const wrap = document.createElement('div');
  wrap.className = 'vm-screen';

  appendRow(wrap, rowModel('Name', sheet.name));
  appendRow(wrap, rowModel('Class', `${sheet.classId} · level ${sheet.level}`));
  appendRow(wrap, rowModel('HP', `${sheet.hp} / ${sheet.maxHp}`));
  appendRow(wrap, rowModel('Armor class', String(sheet.armorClass)));
  appendRow(wrap, rowModel('XP', String(sheet.xp)));
  appendRow(wrap, rowModel('Charges', `${sheet.skillCharges} / ${sheet.maxSkillCharges}`));
  if (sheet.resource) {
    appendRow(wrap, rowModel(sheet.resource.kind, String(sheet.resource.value)));
  }

  const statHead = document.createElement('h3');
  statHead.textContent = 'Stats';
  wrap.appendChild(statHead);
  for (const s of sheet.stats) {
    appendRow(wrap, rowModel(s.key, `${s.score} (${s.mod >= 0 ? '+' : ''}${s.mod})`));
  }

  const skillHead = document.createElement('h3');
  skillHead.textContent = 'Skills';
  wrap.appendChild(skillHead);
  // A skill-less character reads '(none)', not the generic '(empty)' — a deliberate
  // per-screen wording, so this builds the RowModel literally rather than via rowModel().
  if (sheet.skills.length === 0) {
    appendRow(wrap, { label: '', value: '(none)', empty: true });
  }
  for (const sk of sheet.skills) {
    appendRow(wrap, rowModel(sk.name, `${sk.chargeCost}⚡`));
  }

  const gearHead = document.createElement('h3');
  gearHead.textContent = 'Equipped';
  wrap.appendChild(gearHead);
  for (const g of sheet.equipped) {
    appendRow(wrap, rowModel(g.slot, g.name));
  }

  choicesEl.appendChild(wrap);
  choice('Back', () => {
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
    retheme(); // the step may have descended a floor — re-tint before anything re-renders
    // M13: fold this step into the run summary (pure subscriber — the engine flow is untouched).
    runSummary = foldRunEvents(runSummary, r.events, r.state);
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
    // M13: at a terminal phase (an ending, or game-over) grow + persist the unlock store once.
    if (r.state.phase.kind === 'ending' || r.awaiting === 'game-over') {
      applyRunOutcome();
    }
    if (r.awaiting === 'game-over') {
      clearRun();
      log.info('save', 'run cleared (game over)');
    } else {
      saveRun(state, memory, runMeta());
      log.debug('save', 'run autosaved');
    }
  } finally {
    busy = false;
  }
}

function start(): void {
  clearRun();
  log.info('game', 'new run started');
  // Freeze the current unlock snapshot into the new run (gradual reveal), and reset the pure
  // run-summary subscriber. The store itself is only re-read here and at run end.
  runSeed = Date.now() >>> 0;
  state = createGame(runSeed, snapshotUnlocks(unlockStore));
  memory = createStoryMemory();
  runSummary = emptyRunSummary();
  runApplied = false;
  lastNewlyUnlocked = null;
  narrationEl.innerHTML = '';
  retheme();
  renderSheet();
  renderChoices('title');
}

function renderChoices(awaiting: Awaiting): void {
  choicesEl.innerHTML = '';
  titleEl.style.display = awaiting === 'title' ? 'block' : 'none';

  switch (awaiting) {
    case 'title':
      choice('Descend into the Void', () => void dispatch({ kind: 'continue' }));
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
      choice('Enter the Void', submit);
      input.focus();
      break;
    }
    case 'choose-class':
      // M13: Enforcer is always selectable; the other four appear only once their feat has
      // unlocked them in the persistent store. (The locked-class visual treatment is NEEDS-HUMAN.)
      for (const c of CLASS_BUTTONS) {
        if (classUnlocked(unlockStore, c.classId)) {
          choice(c.label, () => void dispatch({ kind: 'class', classId: c.classId }));
        }
      }
      break;
    case 'accept-or-reroll-stats': {
      if (state.phase.kind === 'stats-roll') {
        const s = state.phase.stats;
        const line = document.createElement('div');
        line.className = 'stats-line';
        line.textContent = STAT_KEYS.map((k) => `${k} ${s[k]}`).join('   ');
        choicesEl.appendChild(line);
      }
      choice('Accept these', () => void dispatch({ kind: 'stats-decision', accept: true }));
      choice('Reroll', () => void dispatch({ kind: 'stats-decision', accept: false }));
      break;
    }
    case 'main-menu':
      if (screen === 'inventory') {
        renderInventoryScreen();
        break;
      }
      if (screen === 'sheet') {
        renderSheetScreen();
        break;
      }
      choice('Continue the descent', () => void dispatch({ kind: 'menu', choice: 'continue' }));
      choice('Seek a bargain', () => void dispatch({ kind: 'menu', choice: 'seek-deal' }));
      choice('Abandon the descent', () => void dispatch({ kind: 'menu', choice: 'quit' }));
      choice('Inventory', () => {
        screen = 'inventory';
        rerender();
      });
      choice('Character sheet', () => {
        screen = 'sheet';
        rerender();
      });
      break;
    case 'battle-action': {
      const p = displayPlayer(state);
      choice('Fight', () => void dispatch({ kind: 'battle-action', action: 'fight' }));
      // Cast: an inline picker of the player's skills with charge costs; unaffordable
      // skills render disabled. The engine re-checks the charge on dispatch.
      const casts = p ? castOptions(p) : [];
      if (casts.length > 0) {
        picker(choicesEl, 'Cast', (list) => {
          for (const c of casts) {
            appendButton(
              list,
              buttonModel(c.name, { disabled: !c.affordable, hint: `(${c.chargeCost}⚡)` }),
              () => void dispatch({ kind: 'battle-action', action: { kind: 'cast', skillId: c.skillId } }),
            );
          }
        });
      }
      // Spare: only against a living karma-weighted enemy (the engine's own gate).
      if (spareOffered(state)) {
        choice('Spare', () => void dispatch({ kind: 'battle-action', action: 'spare' }));
      }
      // Use item: an inline picker of usable consumables in the backpack (by index).
      const items = p ? consumableOptions(p) : [];
      if (items.length > 0) {
        picker(choicesEl, 'Use item', (list) => {
          for (const it of items) {
            appendButton(list, buttonModel(it.name, { hint: `(${it.rarity})` }), () =>
              void dispatch({ kind: 'battle-action', action: { kind: 'useConsumable', source: { index: it.index } } }),
            );
          }
        });
      }
      choice('Potion', () => void dispatch({ kind: 'battle-action', action: 'potion' }));
      choice('Run', () => void dispatch({ kind: 'battle-action', action: 'run' }));
      break;
    }
    case 'continue':
      // A chest/cache continue: reveal the dropped loot (name + rarity) before Continue.
      if (state.phase.kind === 'chest') {
        const loot = chestReveal(state.phase.loot);
        const head = document.createElement('div');
        head.className = 'stats-line';
        head.textContent = loot.length > 0 ? 'You found:' : 'The cache is empty.';
        choicesEl.appendChild(head);
        // The shared labelled row, with the rarity as the (dim, tracked) label and the
        // item name as the value. Replaces a hand-built innerHTML row — which also means
        // an item name is now set as TEXT, never interpolated into markup.
        for (const row of loot) {
          appendRow(choicesEl, rowModel(row.rarity, row.name));
        }
      }
      choice('Continue', () => void dispatch({ kind: 'continue' }));
      break;
    case 'draft-pick': {
      // M9: a functional draft picker — one readable card per offered option (index-dispatch).
      const note = document.createElement('div');
      note.className = 'stats-line';
      note.textContent = 'Choose one — the descent reshapes you.';
      choicesEl.appendChild(note);
      if (state.phase.kind === 'level-up-draft') {
        for (const card of draftCards(state.phase.offers)) {
          const b = appendButton(choicesEl, buttonModel(card.label), () =>
            void dispatch({ kind: 'draft-pick', index: card.index }),
          );
          b.classList.add('draft-card');
        }
      }
      break;
    }
    case 'deal-decision': {
      // A clear cost -> reward block; NEVER the karma-derived pool (view-model omits it).
      if (state.phase.kind === 'deal') {
        const dv = dealView(state.phase.deal);
        const block = document.createElement('div');
        block.className = 'deal-block';
        block.innerHTML =
          `<div class="deal-cost">Cost: ${dv.cost}</div>` +
          `<div class="deal-reward">Reward: ${dv.reward}</div>`;
        choicesEl.appendChild(block);
      }
      choice('Pay the price', () => void dispatch({ kind: 'deal-decision', accept: true }));
      choice('Refuse', () => void dispatch({ kind: 'deal-decision', accept: false }));
      break;
    }
    case 'rest-decision':
      choice('Rest here', () => void dispatch({ kind: 'rest-decision', accept: true }));
      choice('Press on', () => void dispatch({ kind: 'rest-decision', accept: false }));
      break;
    case 'game-over':
      choice('Descend again', () => start());
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
  choice('Continue your descent', () => renderChoices(awaitingFor(state.phase)));
  choice('Begin a new descent', () => start());
}

retheme(); // paint the floor-0 palette before the first frame
const saved = loadRun();
if (saved) {
  log.info('save', 'resumable run found', { act: saved.state.act, phase: saved.state.phase.kind });
  state = saved.state;
  memory = saved.memory;
  // G19 -> G1: restore what the run has EARNED, not just where it is. Without this the
  // resumed run restarts its feat tally at zero and every boss felled, foe spared and floor
  // reached before the quit is forfeited at the end of the run.
  if (saved.meta) {
    runSummary = saved.meta.runSummary;
    runSeed = saved.meta.runSeed;
    log.info('save', 'run meta-progression restored', {
      maxAct: runSummary.maxAct,
      bossKills: runSummary.bossKills,
      spares: runSummary.spareCount,
    });
  } else {
    // A v1 envelope, written before the envelope carried any of this. There is no installed
    // base (`desktop:pack` had never succeeded until 2026-08-31 — G44), so in practice this
    // is the author's own local save. Say so ONCE rather than losing it in silence, which is
    // what the whole G19 defect was.
    log.warn('save', 'legacy save (envelope v1): this run starts its feat tally from scratch');
  }
  retheme(); // a resumed run may be deep in the descent — adopt ITS floor, not floor 0
  renderSheet();
  renderResume();
} else {
  start();
}
