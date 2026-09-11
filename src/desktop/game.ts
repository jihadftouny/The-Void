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
import type { ActiveCondition } from '../game/condition.ts';
import { buildNarrationPrompt, createStoryMemory, rememberBeat } from '../llm/narrate.ts';
import { loadRun, saveRun, clearRun, type RunMeta, type SavedRun } from './persist.ts';
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
  isRunOver,
  runSummaryView,
  hubMenu,
  fallbackNarration,
  dealDiscardView,
} from './view-model.ts';
import type { ItemView, HubItemAction, HubMode, HubScreen } from './view-model.ts';
import { log, consoleSink, createRingBuffer } from '../log/logger.ts';
import { resolveLogLevel } from '../log/level.ts';
import { SLOW_MS, levelForDuration, startTimer } from '../log/timing.ts';
import { createDebugOverlay } from './debug-overlay.ts';
// The shared render foundation (M-UI2 `ui-foundation`).
import { applyTheme, applySettings } from '../render/theme.ts';
import { floorTagText, screenKey, screenLayout, type Settings } from '../render/settings-model.ts';
import { loadSettings, saveSettings } from '../storage/settingsStorage.ts';
import { buttonModel, rowModel, conditionChips } from '../render/component-model.ts';
import { appendButton, appendRow, appendLogLine, chip, picker } from '../render/components.ts';
import { logLines, startsNewBattle } from '../render/log-model.ts';
// The two new screens and the three reserved art regions. They live in their own module
// because THIS file cannot be imported (Electron IPC at module scope — G51), so everything
// lifted out of it becomes testable for real instead of by reading source text.
import {
  CONTENT_WARNING,
  buildArtSlotById,
  buildContentWarning,
  buildSettingsScreen,
} from './screens.ts';
import { layoutWarnings, readLayout } from './layout.ts';

// `totalMs` is the main process's own measurement of the generation (`llm.mjs` computed
// it already and used to throw it away). Optional because an older main process would not
// send it; subtracting it from the renderer's round trip isolates the IPC/queue cost from
// the model, which is the difference between "the model is slow" and "the bridge is".
interface GenStats {
  text: string;
  tokens: number;
  tokensPerSecond: number;
  ttftMs: number;
  totalMs?: number;
}
interface VoidApi {
  onStatus(cb: (s: { phase: string; gpu?: unknown; device?: string | null; message?: string }) => void): () => void;
  generate(o: { prompt: string; system?: string; onToken?: (c: string) => void }): Promise<GenStats>;
  log?(entry: unknown): void;
}
declare global { interface Window { void: VoidApi } }

// Started before anything else runs, so the boot line can say how long the renderer's own
// prologue took. Measured through `logger.now()` — the single clock seam.
const bootTimer = startTimer();

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const titleEl = $('title');
const floorEl = $('floor');
const statusEl = $('status');
const noticeEl = $('notice');
const narrationEl = $('narration');
const logEl = $('log');
const choicesEl = $('choices');
const sheetEl = $('sheet');
// The floor's own reserved region, in the READING column rather than in the choices. Its own
// element because the choices are cleared wholesale on every render and the scenery is not
// part of them: it belongs beside the prose it establishes.
const sceneryEl = $('scenery');

/**
 * The developer's explicit opt-in: `localStorage['thevoid:loglevel'] = 'debug'`. Wrapped
 * because `localStorage` can throw outright (blocked origin, storage policy) and a boot
 * that dies here dies before the logger exists to say why. An invalid value is ignored by
 * `resolveLogLevel`, so a typo can never silently downgrade a packaged build.
 */
function readLogLevelOverride(): unknown {
  try {
    return localStorage.getItem('thevoid:loglevel');
  } catch {
    return null;
  }
}

// ---- Logging: console + in-memory ring (for the debug overlay) + forward to
// the Electron main process (which writes the log file). Overlay: ` or F2.
const ring = createRingBuffer(1000);
// THE SHIPPED-VS-DEVELOPER LEVEL POLICY, decided in one pure, tested function. `file:` is
// a packaged build (`main.mjs` loads `dist/desktop.html` from disk) and logs at `info`;
// `http:` is the dev server and logs at `debug`. The consequence that matters: the
// `ui`/`choice` payload carries the player's TYPED NAME, and `info` never emits it, so a
// packaged build never writes a player's name to disk. `src/log/level.test.ts` asserts
// that consequence rather than trusting this comment.
log.setLevel(
  resolveLogLevel({
    protocol: location.protocol,
    override: readLogLevelOverride(),
  }),
);
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
log.info('game', 'renderer booted', {
  level: log.level(),
  protocol: location.protocol,
  ms: bootTimer.stop(),
});
window.addEventListener('error', (ev) =>
  log.error('error', 'window error', { message: ev.message, source: ev.filename, line: ev.lineno }),
);

// THE SIZE OF THE WINDOW THE PLAYER ACTUALLY HAS. Every layout promise this game makes is
// conditional on it, and until now no log line recorded it — so a report of "the narration is
// gone" arrived with no way to tell whether the window was 1920 wide or dragged to the
// minimum. The display scale factor is here for the same reason: it is what makes one
// machine's pixels a different size from another's.
log.info('render', 'viewport', {
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: window.devicePixelRatio,
});
// Resizing fires continuously while a window is dragged, so this is DEBOUNCED to the settled
// size — an undebounced listener would write a hundred lines per drag and bury everything
// else in the file. At `debug`: it is a developer's question, not a shipped one.
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    log.debug('render', 'viewport resized', {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    });
  }, 250);
});

// THE PACKAGED-BUILD DIAGNOSTIC FOR THE BUNDLED TYPEFACE (principle 7, and PLAN.md #16's
// whole risk). The failure this exists for is silent by nature: if the four woff2 faces do
// not reach `dist/`, or their urls resolve wrongly under `file://`, the browser falls back
// to the system monospace with no error anywhere — the game simply looks different on every
// machine. A COUNT is the only observable. `fonts: 0` in a real run means bundling failed,
// and the duration says whether `font-display: block` held the first paint.
//
// The try/catch is not ceremony: `document.fonts` is a property access at MODULE SCOPE, and
// this file's module scope is the boot path. An environment without the font API would throw
// here and take the whole game down before anything rendered — for a diagnostic. Catching it
// keeps a missing API a logged warning instead of a black window, which is the same shape
// `readLogLevelOverride` above already uses for `localStorage`.
const fontTimer = startTimer();
try {
  void document.fonts.ready
    .then((set) => {
      log.info('render', 'fonts ready', { ms: fontTimer.stop(), fonts: set.size });
    })
    .catch((err: unknown) =>
      log.error('render', 'fonts never became ready', {
        ms: fontTimer.stop(),
        message: err instanceof Error ? err.message : String(err),
      }),
    );
} catch (err) {
  log.error('render', 'the font loading API is unavailable', {
    message: err instanceof Error ? err.message : String(err),
  });
}
window.addEventListener('unhandledrejection', (ev) =>
  log.error('error', 'unhandled rejection', { reason: String(ev.reason) }),
);

// M13 meta-progression: the persistent cross-run unlock store, loaded once at boot. Read at
// class-select (gating) and run start (snapshot); grown at run end (applyRunSummary + persist).
//
// G3: the load now REPORTS what it found. This is the only copy of everything the player has
// ever earned, and one unparseable byte used to replace all of it with an empty store —
// silently, with the class select simply back to Enforcer-only and no explanation. When the
// store was recovered from its backup, or could not be recovered at all, say so where the
// player will actually see it. `textContent`, never markup.
const unlockLoad = loadUnlockStore();
let unlockStore = unlockLoad.store;
if (unlockLoad.lost !== undefined) {
  noticeEl.textContent = unlockLoad.lost;
  log.warn('unlocks', 'unlock store did not load cleanly', { source: unlockLoad.source });
} else {
  log.info('unlocks', 'unlock store loaded', { source: unlockLoad.source });
}
// THE PLAYER'S PREFERENCES — render-layer only, and deliberately NOT part of the save
// envelope: a run played at large text is the same run, so putting text size in the run save
// would make two players' saves incompatible over a preference. Loaded once, here, so the
// very first `retheme()` below already paints at the size and contrast the player chose.
let settings: Settings = loadSettings();
log.info('settings', 'preferences loaded', {
  textScale: settings.textScale,
  motion: settings.motion,
  contrast: settings.contrast,
});

let runSeed = Date.now() >>> 0;
let state: GameState = createGame(runSeed, snapshotUnlocks(unlockStore));
let memory = createStoryMemory(); // rolling "story so far" fed to the narrator
// The pure run-summary subscriber: folded from each step's events, applied to the store at the
// terminal phase. Reset per run. `runApplied` guards against a double-apply (ending -> game-over).
let runSummary: RunSummary = emptyRunSummary();
let runApplied = false;
// The ids most recently unlocked. Read by the end-of-run summary screen (G2), which is what
// finally consumes this — it was written and never read, annotated `void`, since M13.
let lastNewlyUnlocked: NewlyUnlocked | null = null;

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
  // The phase is in `s` — interpolating it into the message would make the boot timeline
  // ungreppable, since every line would have a different message.
  log.info('llm', 'model status', s);
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
 * Re-paint the whole UI for the floor the player is currently on.
 *
 * The FLOOR IS THE VISUAL SYSTEM (author direction, 2026-09-07): each of the five owns its
 * ground, its panels, its body ink and its texture, not merely an accent. All of it is a
 * RUNTIME switch keyed on `state.place` (0..4), so descending re-paints every surface at
 * once with no reload and no per-floor CSS class. Called at boot and after every engine step,
 * because a step is the only thing that can change the floor. `applyTheme` clamps `place`, so
 * this can never throw mid-render.
 *
 * ⚠ THE CALL ORDER IS LOAD-BEARING, and reversing it is the whole defect: `applySettings`
 * deliberately overwrites nine of the names `applyTheme` just wrote. Theme LAST would clobber
 * the player's text size and high-contrast ink on every single engine step — the setting
 * would appear to work once and silently revert on the next click.
 *
 * The floor TAG is written here too, and unconditionally. S4a's rule is that the accent may
 * never be the only carrier of any state, so the floor's NAME is always on screen — title
 * screen included, where it truthfully names where the descent begins. There is no branch to
 * invert, which is the chips-helper lesson applied.
 */
function retheme(): void {
  applyTheme(document.documentElement, state.place);
  applySettings(document.documentElement, settings, state.place);
  floorEl.textContent = floorTagText(state.place);
}

/**
 * The HUD: who you are, how you are doing, and — G28(a) — WHAT IS CURRENTLY HAPPENING TO YOU.
 *
 * G28(b): this was built by interpolating strings into `sheetEl.innerHTML`, and two of those
 * strings are attacker-controlled-ish content: the player's own typed name (`<b>${p.name}</b>`)
 * and the enemy's generated full name. A name of `<img onerror=...>` was live markup in the
 * page. It is all `textContent` now, and a source guard in `rendererSource.test.ts` keeps it
 * that way — the fix is one commit, the guard is what makes it stay fixed.
 *
 * G28(a): condition chips. `conditionChips` / `chip` have existed, tested, since M-UI2, and
 * nothing imported them — so the player could be poisoned, fractured and about to lose their
 * turn to Insanity, and the only tell was the HP number moving. They now render for the
 * player always, and for the enemy during a battle, ordered control -> harm -> boon so the
 * thing that stops you acting reads first.
 */
function renderSheet(): void {
  // The live battle combatant during a battle (HP ticks down each round), else
  // the snapshot — the top-level state.player is stale mid-battle. See view-model.
  const p = displayPlayer(state);
  sheetEl.replaceChildren();
  if (!p) return;

  /** One HUD line. `textContent` — never markup, whatever the string contains. */
  const line = (text: string, className?: string): void => {
    const el = document.createElement('div');
    if (className) el.className = className;
    el.textContent = text;
    sheetEl.appendChild(el);
  };
  /**
   * A combatant's condition row. Always appended, even when empty — `#sheet .chips:empty` in
   * game.css collapses it, exactly as `#log:empty` and `#notice:empty` already do.
   *
   * The early return this replaces (`if (models.length === 0) return;`) was a POLARITY HOLE
   * of the same family as the three the test report named, found by sweeping for the shape
   * rather than waiting to be told: inverting it renders the row only when there is nothing
   * to put in it, so condition chips never appear again — G28(a), silently restored — and
   * every source scan that merely asserts `chips(...)` is called stays green.
   *
   * Deleting the branch is a better answer than guarding it. A branch that cannot be written
   * cannot be inverted, and CSS was already doing this job for two other elements.
   */
  const chips = (active: readonly ActiveCondition[]): void => {
    const row = document.createElement('div');
    row.className = 'chips';
    for (const model of conditionChips(active)) row.appendChild(chip(model));
    sheetEl.appendChild(row);
  };

  line(p.name, 'who');
  line(p.classId);
  line(`HP ${p.hp}/${p.maxHp}`);
  line(`XP ${p.xp}`);
  line(`Act ${state.act}`);
  chips(p.activeConditions);
  // THE CHARACTER PORTRAIT'S RESERVED REGION (plan Appendix A.7). Empty today, and no art is
  // shipped, generated or bought by this unit — what is being committed to is the SHAPE.
  // It sits BELOW the vitals on purpose: `artSlots.json`'s own reasoning is that a portrait
  // must not cost HP, XP and the condition chips their place at the top of a 220px column.
  sheetEl.appendChild(buildArtSlotById('character'));

  if (state.phase.kind === 'battle') {
    sheetEl.appendChild(document.createElement('hr'));
    const e = state.phase.battle.enemy;
    line(e.fullName, 'foe');
    line(`HP ${e.hp}/${e.maxHp}`);
    chips(e.activeConditions);
    // The ENEMY region, reserved in the battle chrome rather than inside `renderChoices`'s
    // `battle-action` branch — that branch belongs to PLAN.md #6 and this unit does not
    // touch it. It appears exactly when a battle is on screen, beside the foe's own vitals.
    sheetEl.appendChild(buildArtSlotById('enemy'));
  }
}

/**
 * Append this step's mechanical beats to the combat log, resetting it when a new fight
 * begins — G18. Everything about WHICH beats and WHAT they read is decided by the pure
 * `logLines` / `startsNewBattle`; this only appends elements and keeps the view at the bottom.
 */
function renderLog(events: readonly GameEvent[]): void {
  if (startsNewBattle(events)) logEl.replaceChildren();
  for (const line of logLines(events)) appendLogLine(logEl, line);
  logEl.scrollTop = logEl.scrollHeight;
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
  // input (`cast-unavailable`, `spare-unavailable`, …): nothing happened, so the narration
  // should not change. It would be a lie for anything that did happen, which is why the
  // deliberate-silence list in src/llm/narrate.ts is curated rather than "everything the
  // register did not name", and why `shield-gained`, `shield-absorbed` and `revive` are
  // narrated even though G13 never named them. If you
  // add a silent case there, you are choosing to leave the previous beat on screen here.
  if (!prompt) return;
  // Show ONLY the current moment: replace the narration area each turn rather
  // than accumulating a growing scroll of past beats (bug 2).
  narrationEl.innerHTML = '';
  log.debug('llm', 'narrate: request', { promptChars: prompt.user.length, beats: memory.beats.length });
  const block = document.createElement('p');
  block.className = 'beat';
  narrationEl.appendChild(block);
  narrationEl.scrollTop = narrationEl.scrollHeight;
  // The RENDERER's own view of the generation, started before the IPC call and stopped on
  // both exits. `roundTripMs - generateMs` is the IPC/queue cost: the difference between
  // "the model is slow" and "the bridge is", which no single number can tell apart.
  const genTimer = startTimer();
  try {
    const stats = await window.void.generate({
      prompt: prompt.user,
      system: prompt.system,
      onToken: (c) => {
        block.textContent += c;
        narrationEl.scrollTop = narrationEl.scrollHeight;
      },
    });
    const roundTripMs = genTimer.stop();
    const generateMs = Math.round(stats.totalMs ?? 0);
    log.log(levelForDuration(roundTripMs, SLOW_MS.narrate, 'info'), 'llm', 'narrate: done', {
      roundTripMs,
      generateMs,
      ipcOverheadMs: Math.round(roundTripMs) - generateMs,
      ttftMs: Math.round(stats.ttftMs),
      tokens: stats.tokens,
      tokPerSec: Math.round(stats.tokensPerSecond),
    });
  } catch (err) {
    // Resilience: if the model fails, fall back to the plain facts so the game
    // remains fully playable (engine is authoritative regardless).
    //
    // G26 — WHICH plain facts. This used to read `prompt.user.split('\n\n')[0]`, and on any
    // step with story memory that first block is the CONTINUITY RECAP: the run summary and
    // the last five beats. So a model failure on the turn you landed a critical hit printed
    // "Across this descent you have felled 1 foe / Recent moments…" and never a word about
    // the crit. `fallbackNarration` reads the facts `buildNarrationPrompt` already computed
    // for THIS beat, so the fallback describes what just happened.
    log.error('llm', 'narrate: FAILED', {
      roundTripMs: genTimer.stop(),
      message: err instanceof Error ? err.message : String(err),
    });
    block.textContent = fallbackNarration(prompt);
    block.classList.add('fallback');
  }
}

// The primary choice button: the shared `actionButton` component bound to the #choices
// container. This is a partial application of the shared component, NOT a second
// implementation of one — every button in the game is built by `src/render/components.ts`.
function choice(label: string, onClick: () => void): void {
  appendButton(choicesEl, buttonModel(label), onClick);
}

// Render-layer UI mode (NOT game state): the plain game flow, the inventory/equipment
// screen, the full character sheet, the settings screen, or the abandon confirmation. The
// engine is still sitting at its own phase behind every one of them; all five are reset to
// 'game' whenever a real engine action is dispatched.
type Screen = 'game' | HubScreen | 'confirm-abandon';
let screen: Screen = 'game';

/**
 * Which render-layer screen each hub mode corresponds to. A TABLE rather than a ternary,
 * deliberately: a two-way conditional here is one character away from making "cancel" open
 * the confirmation and "abandon" close it, and a table's error is visible on the line itself.
 */
const HUB_MODE_SCREEN: Record<HubMode, Screen> = {
  menu: 'game',
  'confirm-abandon': 'confirm-abandon',
};

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
    // PLAN.md #2: leave an item behind — an ENGINE input (`discard`), so the run still replays
    // from seed + inputs. Stepped here rather than through `dispatch` because a discard is not
    // a narrated beat: the inventory screen stays up, the run autosaves, and the move is logged
    // at the boundary. A refused discard (a stale index) returns the same state and saves nothing.
    appendButton(row, buttonModel('Discard'), () => {
      const r = step(state, { kind: 'discard', index: b.index });
      if (r.state !== state) {
        state = r.state;
        runSummary = foldRunEvents(runSummary, r.events, r.state);
        saveRun(state, memory, runMeta());
        log.info('inventory', 'item discarded', { index: b.index, defId: b.item.defId });
      }
      rerender();
    });
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

/**
 * THE HUB — a command list built from the pure `hubMenu` model (G5, GAME-DESIGN.md §19.4).
 *
 * Every decision is the model's: which rows, in what order, which one is destructive, which
 * one carries the rule above it, and — the point of the whole exercise — whether a row can
 * dispatch a quit at all. In `'menu'` mode NONE can. That is why the string `'quit'` does not
 * appear anywhere in this file, which is a far stronger guarantee than "the renderer asks
 * first": there is no second place a one-click abandon could be reintroduced.
 *
 * The prompt paragraph is appended UNCONDITIONALLY and collapses when empty
 * (`.hub-prompt:empty` in game.css), the idiom `#log`, `#notice` and `.chips` already use.
 * A branch that does not exist cannot be inverted.
 */
function renderHub(): void {
  const view = hubMenu(screen === 'confirm-abandon' ? 'confirm-abandon' : 'menu');

  // The floor's own reserved region. Empty today; it carries this floor's colour and texture
  // so it reads as part of the place rather than as a missing asset. It goes in the READING
  // column, above the prose, as an establishing shot — not into the choices, where it used to
  // sit and where it took a third of the screen away from the narration.
  sceneryEl.appendChild(buildArtSlotById('scenery'));

  const prompt = document.createElement('p');
  prompt.className = 'hub-prompt';
  prompt.textContent = view.prompt ?? '';
  choicesEl.appendChild(prompt);

  const list = document.createElement('div');
  list.className = 'hub-menu';
  choicesEl.appendChild(list);
  for (const item of view.items) {
    const button = appendButton(list, buttonModel(item.label), () => runHubAction(item.action));
    // `classList.toggle(name, force)` rather than an `if`: two more branches on a screen
    // whose whole point is that it has as few as possible.
    button.classList.toggle('is-destructive', item.destructive === true);
    button.classList.toggle('is-separated', item.separated === true);
  }
}

/**
 * Perform one hub row's action. Three shapes, and the split is what makes the guarantee
 * above checkable: only `dispatch` reaches the engine.
 *
 * ⚠ BOTH CONDITIONS HERE ARE PINNED BY THE TYPE SYSTEM, not by a source regex, and that is
 * the stronger pin: `HubItemAction` is a discriminated union, so negating either one makes
 * the narrowed member's field unreachable and `tsc --noEmit` fails the build. There is no
 * silent inversion available.
 */
function runHubAction(action: HubItemAction): void {
  if (action.kind === 'dispatch') {
    void dispatch(action.input);
    return;
  }
  screen = action.kind === 'screen' ? action.screen : HUB_MODE_SCREEN[action.mode];
  rerender();
}

/**
 * THE SETTINGS SCREEN (FINDINGS.md B1; `UI-DESIGN.md` §12 with this unit's recorded scope
 * deviation — only the group that controls something that exists).
 *
 * Reachable from the title screen AND from the hub, which is why the route sits above the
 * `awaiting` switch in `renderChoices` rather than inside its `main-menu` case.
 *
 * A change is applied IMMEDIATELY and persisted immediately: there is no Apply button and no
 * way to leave with an unsaved preference, because the only honest test of a contrast setting
 * is looking at the screen it changed.
 */
function renderSettingsScreen(): void {
  choicesEl.appendChild(
    buildSettingsScreen(settings, (next) => {
      settings = next;
      saveSettings(next);
      retheme();
      log.info('settings', 'preferences changed', {
        textScale: next.textScale,
        motion: next.motion,
        contrast: next.contrast,
      });
    }),
  );
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
  // ⭐ THE PLAYER-PERCEIVED FREEZE, IN MILLISECONDS. `busy` is held for the whole of this
  // function, so every input is dead until it returns; this timer is exactly how long the
  // game was unresponsive, and it is reported in the `finally` so it survives a throw.
  const turnTimer = startTimer();
  try {
    choicesEl.innerHTML = '';
    sceneryEl.replaceChildren();
    // At `debug` only — this payload carries the player's typed name on the name step, and
    // a packaged build runs at `info`. See `src/log/level.ts`.
    log.debug('ui', 'choice', { input });
    const stepTimer = startTimer();
    const r = step(state, input);
    const stepMs = stepTimer.stop();
    state = r.state;
    retheme(); // the step may have descended a floor — re-tint before anything re-renders
    // M13: fold this step into the run summary (pure subscriber — the engine flow is untouched).
    runSummary = foldRunEvents(runSummary, r.events, r.state);
    // ONE COMPACT LINE PER PLAYER ACTION, at `info` — this is the timeline a shipped log
    // needs, and the only thing that can say "which action was the slow one".
    log.log(levelForDuration(stepMs, SLOW_MS.step, 'info'), 'engine', 'step', {
      input: input.kind,
      awaiting: r.awaiting,
      ms: stepMs,
      events: r.events.length,
    });
    // The `debug` detail, including the run summary — which is the observability hook for
    // G50: a neutered `foldRunEvents` leaves this object identical on every step of a whole
    // run, visible at a glance. (The TEST that pins the fold lives in
    // `instrumentationSource.test.ts`; a log line is never a substitute for one.)
    log.debug('engine', 'step detail', {
      events: r.events.map((e) => e.kind),
      // Two NUMBERS, not the string "5/20". A payload that bakes numbers into a string is
      // the same defect as a message that does: nothing downstream can compare them.
      hp: state.player?.hp ?? null,
      maxHp: state.player?.maxHp ?? null,
      act: state.act,
      summary: {
        maxAct: runSummary.maxAct,
        bossKills: runSummary.bossKills.length,
        spares: runSummary.spareCount,
      },
    });
    renderSheet();
    renderLog(r.events); // G18: the dice and the damage, before the prose that cannot say them
    showThinking();
    await narrate(r.events);
    memory = rememberBeat(memory, r.events); // remember AFTER narrating
    // G2: ONE predicate decides both halves of "the run is over". The apply used to key off
    // `phase.kind === 'ending'` while the clear keyed off `awaiting === 'game-over'`, and the
    // disagreement between those two IS G2: a victory settles at the `ending` phase, so it
    // took the autosave branch and left a RESUMABLE save behind. Relaunching after an
    // ascension then offered "A descent lies unfinished" — pointing at a run already won.
    // `isRunOver` is exhaustive over `Phase['kind']`, so an eighteenth phase fails the build
    // rather than silently defaulting to "still going".
    //
    // This runs BEFORE `renderChoices` on purpose: the end-of-run screen reports what the run
    // unlocked, and `applyRunOutcome` is what computes it.
    if (isRunOver(r.state.phase)) {
      applyRunOutcome();
      clearRun();
      log.info('save', 'run cleared (the run is over)', { phase: r.state.phase.kind });
    } else {
      saveRun(state, memory, runMeta());
      log.debug('save', 'run autosaved');
    }
    renderChoices(r.awaiting);
  } finally {
    busy = false;
    const turnMs = turnTimer.stop();
    log.log(levelForDuration(turnMs, SLOW_MS.turn, 'info'), 'ui', 'turn', {
      input: input.kind,
      ms: turnMs,
    });
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
  // A fresh run starts on the plain game view, whatever screen the last one ended on. Set
  // rather than assumed: `renderChoices` routes the settings screen ahead of the phase
  // switch, so a stale `'settings'` here would put the settings screen where the title
  // belongs the moment the warning is acknowledged.
  screen = 'game';
  narrationEl.innerHTML = '';
  logEl.replaceChildren();
  retheme();
  renderSheet();
  // THE CONTENT WARNING, BEFORE THE TITLE (FINDINGS.md S1; docs/CONTENT-WARNING.md owns the
  // policy: every fresh run, never on resume, always dismissible). It is deliberately
  // BRANCHLESS — every fresh run reaches this line, and `renderResume()` never calls
  // `start()`, so the "not on resume" half is structural rather than a condition somebody
  // could invert. Acknowledging it is what renders the title.
  choicesEl.replaceChildren();
  sceneryEl.replaceChildren();
  titleEl.style.display = 'none';
  showScreen('content-warning');
  choicesEl.appendChild(buildContentWarning(CONTENT_WARNING, () => renderChoices('title')));
}

/**
 * THE ONE PLACE THE SCREEN IS ANNOUNCED TO THE STYLESHEET. Two attributes, written together
 * and never apart.
 *
 * `screens.css` is keyed on `[data-screen='…']` and `game.css` on `[data-layout='…']`, so
 * every per-screen treatment is CSS rather than a structural rewrite of `renderChoices`.
 * Both values are decided by PURE, tested functions; this writes them and nothing else.
 *
 * It is BRANCHLESS on purpose. Three call sites used to write `data-screen` by hand, and a
 * fourth that forgot the layout attribute would leave the stage in the previous screen's
 * geometry — a document rendered into a 260px column, or a hub with no room for its prose.
 * There is no condition here to get wrong.
 */
function showScreen(key: string): void {
  document.body.dataset['screen'] = key;
  document.body.dataset['layout'] = screenLayout(key);
}

/**
 * Record what the layout ACTUALLY came out as, after the screen has been built.
 *
 * Principle 7, and the specific failure it exists for: the narration collapsing was reported
 * as "the narration is gone", with no numbers, from a build whose whole test suite was green.
 * Every number that would have identified it in seconds was in the page and recorded nowhere.
 * `readLayout` is the boundary read; `layoutWarnings` is pure and unit-tested, so the defect
 * signature is an assertion in `layout.test.ts` rather than a hope in a comment here.
 */
function reportLayout(): void {
  const report = readLayout({ narrationEl, logEl, choicesEl, sceneryEl });
  log.debug('render', 'layout', report);
  // The message is a CONSTANT and the problem travels in `data`: two occurrences of the same
  // fault must be greppable as the same fault.
  for (const warning of layoutWarnings(report)) {
    log.warn('render', 'layout is wrong', { warning, ...report });
  }
}

function renderChoices(awaiting: Awaiting): void {
  choicesEl.innerHTML = '';
  // The scenery is NOT part of the choices, so clearing them does not clear it — and it must
  // be cleared, or every re-render of the hub would stack another 16:9 frame on the column.
  sceneryEl.replaceChildren();
  showScreen(screenKey(awaiting, screen));
  titleEl.style.display = awaiting === 'title' ? 'block' : 'none';

  // The settings route sits ABOVE the switch because B1 routes it from the title screen as
  // well as the hub, and `awaiting` is a different value at those two places.
  if (screen === 'settings') {
    renderSettingsScreen();
    return;
  }

  switch (awaiting) {
    case 'title':
      choice('Descend into the Void', () => void dispatch({ kind: 'continue' }));
      choice('Settings', () => {
        screen = 'settings';
        rerender();
      });
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
      renderHub();
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
      // PLAN.md #2 / §22.6: no Potion button — healing in battle is a found consumable, in the
      // Use-item picker above like every other item.
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
        // G28(b)'s family, closed at its last site: this used to interpolate the deal's own
        // strings into `innerHTML`. Nothing generates those strings from player input TODAY,
        // which is exactly the argument that keeps such a site alive until the day something
        // does. Built as elements with `textContent` now, and a source guard pins that every
        // `innerHTML` assignment in this file assigns the empty string and nothing else.
        const cost = document.createElement('div');
        cost.className = 'deal-cost';
        cost.textContent = `Cost: ${dv.cost}`;
        const reward = document.createElement('div');
        reward.className = 'deal-reward';
        reward.textContent = `Reward: ${dv.reward}`;
        block.append(cost, reward);
        choicesEl.appendChild(block);
      }
      choice('Pay the price', () => void dispatch({ kind: 'deal-decision', accept: true }));
      choice('Refuse', () => void dispatch({ kind: 'deal-decision', accept: false }));
      break;
    }
    case 'deal-discard': {
      // PLAN.md #2, Appendix A.3: the bargain was accepted with a FULL pack. Nothing is paid
      // yet. One row per item to leave behind (the engine completes the bargain in that one
      // step), and one way out, which is exactly refusing it. Text only, never markup.
      const p = state.player;
      if (state.phase.kind === 'deal-discard' && p) {
        const view = dealDiscardView(p, state.phase.deal);
        const block = document.createElement('div');
        block.className = 'deal-block';
        const ask = document.createElement('div');
        ask.className = 'deal-reward';
        ask.textContent = view.prompt;
        const cost = document.createElement('div');
        cost.className = 'deal-cost';
        cost.textContent = `Cost: ${view.cost}`;
        block.append(ask, cost);
        choicesEl.appendChild(block);
        for (const row of view.leave) {
          choice(row.label, () => void dispatch({ kind: 'discard', index: row.index }));
        }
        choice(view.refuse, () => void dispatch({ kind: 'deal-decision', accept: false }));
      }
      break;
    }
    case 'rest':
      // PLAN.md #2 (§22.26): a FOUND rest spot — the rest has already happened, so there is no
      // choice to make, only the calm. The floor's scenery region gets its real job here (the
      // establishing image of the one quiet place), exactly as the hub mounts it.
      sceneryEl.appendChild(buildArtSlotById('scenery'));
      choice('Continue', () => void dispatch({ kind: 'continue' }));
      break;
    case 'game-over': {
      // G2 / GAME-DESIGN.md §22.15: a finished run gets a WRITTEN RECORD. This is the
      // FACTUAL half — outcome, depth, bosses by name, spares, unlocks by name. The Void's
      // own narrated account of your descent is G10, which belongs to PLAN.md #6.
      const view = runSummaryView(runSummary, state.player, lastNewlyUnlocked, runSeed);
      const wrap = document.createElement('div');
      wrap.className = 'vm-screen run-summary';
      const head = document.createElement('h3');
      head.textContent = view.headline; // TEXT, never markup — the rows go through appendRow
      wrap.appendChild(head);
      for (const row of view.rows) appendRow(wrap, rowModel(row.label, row.value));
      choicesEl.appendChild(wrap);
      choice('Descend again', () => start());
      break;
    }
  }
  // AFTER the switch: the screen now holds everything it is going to hold, so this is the
  // only point at which the measurement means anything.
  reportLayout();
}

function renderResume(): void {
  titleEl.style.display = 'block';
  // Its own screen, and NOT the content warning: S1's policy is "every fresh run", and a
  // resumed run is not one. The warning is only reachable through `start()`.
  showScreen('resume');
  narrationEl.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'beat';
  p.textContent = 'A descent lies unfinished. Return to it, or begin anew.';
  narrationEl.appendChild(p);
  choicesEl.innerHTML = '';
  choice('Continue your descent', () => renderChoices(awaitingFor(state.phase)));
  choice('Begin a new descent', () => start());
}

/**
 * ADOPT A WHOLE FOREIGN RUN — the single seam, shared by the two callers that need it.
 *
 * This block used to live inline in the boot resume path below. It is a function now because
 * the developer state panel adopts a state the same way, and "the same way" has to be
 * STRUCTURAL rather than a claim in a comment: two call sites that drift apart are a bug
 * waiting to be found in the field instead of in a test.
 *
 * Note what it deliberately does NOT do: it never advances anything. Replacing the whole
 * state is exactly what resuming a save has always done — from here on every change still
 * goes through `step`.
 */
function adoptRun(saved: SavedRun): void {
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
    log.warn('save', 'legacy save envelope: this run starts its feat tally from scratch', { v: 1 });
  }
  // The adopted run has not reached its own ending yet, whatever the PREVIOUS one did. Left
  // stale, a run adopted after a finished one would never apply its outcome.
  runApplied = false;
  lastNewlyUnlocked = null;
  retheme(); // an adopted run may be deep in the descent — adopt ITS floor, not floor 0
  renderSheet();
}

/**
 * The developer panel's adoption path: the SAME `adoptRun`, plus the two things a jump needs
 * that a boot does not — a re-entry guard, and a screen cleared of the previous run's beats.
 *
 * `busy` is held for the whole of `dispatch`, so adopting mid-turn would let an in-flight
 * step render its stale `awaiting` over the jumped state. Refusing is the only safe answer;
 * the panel says so rather than pretending the jump landed.
 */
function adoptFromPanel(saved: SavedRun): boolean {
  if (busy) return false;
  adoptRun(saved);
  narrationEl.innerHTML = '';
  logEl.replaceChildren();
  screen = 'game';
  renderChoices(awaitingFor(state.phase));
  return true;
}

retheme(); // paint the floor-0 palette before the first frame
const saved = loadRun();
if (saved) {
  log.info('save', 'resumable run found', { act: saved.state.act, phase: saved.state.phase.kind });
  adoptRun(saved);
  renderResume();
} else {
  start();
}

// THE DEVELOPER STATE PANEL — present in dev, ABSENT FROM THE PACKAGED BUILD BY CONSTRUCTION.
//
// `vite build` replaces `import.meta.env.DEV` with the literal `false`, Rollup eliminates the
// dead branch, and the dynamic import goes with it — so nothing under the dev directory is in
// a shipped build's module graph: no chunk, no string, nothing in the sourcemap. There is no
// runtime flag and no env var, by the author's explicit decision; the cost (states cannot be
// jumped inside a packaged build) was named and accepted. `src/dev/exclusion.test.ts` proves
// the exclusion by running the real bundler twice in a subprocess.
if (import.meta.env.DEV) {
  void import('../dev/panel.ts')
    .then((m) =>
      m.mountDebugPanel({
        getBundle: () => ({ state, memory, meta: runMeta() }),
        adopt: adoptFromPanel,
        env: { protocol: location.protocol },
        unlockStorage: localStorage,
      }),
    )
    // A failure here is a dev-tooling failure and must never take the game down — but it must
    // not vanish either. Without this the panel simply never appears and the only trace is an
    // unhandled rejection nobody is watching for (principle 7: log before you recover).
    .catch((err: unknown) =>
      log.error('dev', 'panel failed to load', {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
}
