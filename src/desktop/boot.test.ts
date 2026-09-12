// @vitest-environment jsdom
//
// THE RENDERER, IMPORTED AND BOOTED FOR REAL — G51's promise, kept (PLAN.md #6, AC-6/7/8).
//
// For its whole life until #6, `src/desktop/game.ts` ran its start-up at module scope — the
// element lookups, the logger, the Electron IPC subscription, the stored unlocks, the first
// paint — so importing it anywhere but inside Electron threw on `window.void` before a line of
// test code ran. Every guard on its wiring therefore READ it as text. #6 moved all of that
// behind `export function boot()`, with `src/desktop/main.ts` as the page's only caller, and
// this file is the first to import the real renderer and drive it by clicking.
//
// WHAT THIS PROVES THAT A SOURCE SCAN CANNOT: that the import is genuinely inert (nothing
// touched, not merely nothing matched by a regex); that a boot really reaches each screen of a
// new run in order; that a saved run really resumes into a live battle; and that a second boot
// is refused rather than doubling every sink and listener.
//
// THE ISOLATION IDIOM, and its cost. Module state (the booted flag, the element slots, the
// logger's sinks) lives for as long as the module instance does, so each case takes a FRESH
// instance with `vi.resetModules()` + a dynamic `import()`. The logger is imported the same
// way, AFTER the reset, so the test holds the very `log` object that instance of the renderer
// writes to. That is the whole price of `boot()` being once-only rather than re-entrant.
//
// jsdom has no layout engine, so nothing here judges geometry — `src/dev/layoutProbe.test.ts`
// does that in real Chromium. The wall clock is pinned (`vi.setSystemTime`) so the run seed —
// the renderer seeds a fresh run from `Date.now()`, by design — is the same on every run of
// this file; every other timer is real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGame, step, awaitingFor, type GameState } from '../game/game.ts';
import { createStoryMemory } from '../llm/narrate.ts';
import { emptyRunSummary, foldRunEvents } from '../game/unlockStore.ts';
import { BEAT_HOLD_MS, BEAT_MS, MAX_ROUND_MS, MIN_SPACING_MS, groupBeats } from '../render/beat-model.ts';
import type { LogEntry } from '../log/logger.ts';
// The save is written through the real `saveRun`, imported STATICALLY — the harness's
// one-reset-per-case rule (a second reset + dynamic import deadlocked the module loader).
import { saveRun } from './persist.ts';
// The shared harness for booting the real renderer (one copy; `battleScreen.test.ts` uses it too).
import {
  DESKTOP_HTML as HTML,
  choiceButtons,
  click,
  freshRenderer,
  installBridge,
  installFonts,
  installPage,
  labels,
  reach,
  removeBridge,
  screen,
} from './rendererHarness.testutil.ts';

// The repo root. `import.meta.url` is not a file url under jsdom (the `skeleton.test.ts` note).
const ROOT = process.cwd();

beforeEach(() => {
  installPage();
  installFonts();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(4242);
  // The renderer's console sink would print every boot line into the test output.
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeBridge();
});

// =========================================================================================
// AC-6 — the import is inert.
// =========================================================================================

describe('importing the renderer does nothing until boot() is called (AC-6)', () => {
  it('no bridge, no throw, and nothing touched: no sink, no level, no lookup, no storage, no listener', async () => {
    removeBridge();
    vi.resetModules();
    const logger = await import('../log/logger.ts');
    const addSink = vi.spyOn(logger.log, 'addSink');
    const setLevel = vi.spyOn(logger.log, 'setLevel');
    const lookup = vi.spyOn(document, 'getElementById');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const listen = vi.spyOn(window, 'addEventListener');

    // With no `window.void`, a module-scope `window.void.onStatus(...)` would throw right here.
    const game = await import('./game.ts');
    expect(typeof game.boot, 'the renderer exports no boot()').toBe('function');

    expect(addSink, 'importing added a log sink').not.toHaveBeenCalled();
    expect(setLevel, 'importing set the log level').not.toHaveBeenCalled();
    expect(lookup, 'importing looked up a page element').not.toHaveBeenCalled();
    expect(read, 'importing read localStorage').not.toHaveBeenCalled();
    expect(listen, 'importing registered a window listener').not.toHaveBeenCalled();
    expect(screen(), 'importing rendered a screen').toBeUndefined();
    expect(document.getElementById('choices')!.children.length).toBe(0);
  });

  it('THE CONTROL: boot() does every one of those things (or the spies could see nothing)', async () => {
    const bridge = installBridge();
    vi.resetModules();
    const logger = await import('../log/logger.ts');
    const addSink = vi.spyOn(logger.log, 'addSink');
    const setLevel = vi.spyOn(logger.log, 'setLevel');
    const lookup = vi.spyOn(document, 'getElementById');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const listen = vi.spyOn(window, 'addEventListener');
    const game = await import('./game.ts');

    game.boot();

    // Hand-counted from the start-up it moved: console + ring + IPC forwarder = 3 sinks;
    // the nine element slots are all looked up; error + resize + unhandledrejection = 3.
    expect(addSink).toHaveBeenCalledTimes(3);
    expect(setLevel).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(read).toHaveBeenCalled();
    expect(listen.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['error', 'resize', 'unhandledrejection']),
    );
    expect(bridge.onStatus, 'boot() never subscribed to the model status').toHaveBeenCalledTimes(1);
    expect(screen()).toBe('content-warning');
  });
});

// =========================================================================================
// AC-8 — once only.
// =========================================================================================

describe('a second boot() is refused, loudly (AC-8)', () => {
  it('throws, logs at error first, and registers nothing twice', async () => {
    const bridge = installBridge();
    const { game, log, entries } = await freshRenderer();
    game.boot();
    const addSink = vi.spyOn(log, 'addSink');
    const listen = vi.spyOn(window, 'addEventListener');

    expect(() => game.boot()).toThrow('renderer already booted');

    const refusal = entries.find((e) => e.message === 'renderer already booted');
    expect(refusal, 'the refusal was not logged before the throw').toBeDefined();
    expect(refusal!.level).toBe('error');
    expect(addSink, 'the second boot added a sink before refusing').not.toHaveBeenCalled();
    expect(listen, 'the second boot registered a listener before refusing').not.toHaveBeenCalled();
    expect(bridge.onStatus, 'the second boot subscribed to the model again').toHaveBeenCalledTimes(1);
    // ...and the first boot's screen is untouched by the refused one.
    expect(screen()).toBe('content-warning');
  });
});

// =========================================================================================
// AC-7 — the real renderer, walked by clicking.
// =========================================================================================

describe('the real renderer walks a new run from the warning to the hub (AC-7)', () => {
  it('content warning -> title -> name -> class -> stats -> hub, one real click at a time', async () => {
    installBridge();
    const { game } = await freshRenderer();
    game.boot();

    // A fresh profile has no saved run, so the boot path is `start()`: the content warning,
    // whose ONE control is what advances it (S1).
    expect(screen()).toBe('content-warning');
    expect(choiceButtons()).toHaveLength(1);
    choiceButtons()[0]!.click();
    expect(screen(), 'acknowledging the warning did not render the title').toBe('title');

    click('Descend into the Void');
    await reach('enter-name');
    const input = document.getElementById('choices')!.querySelector('input');
    expect(input, 'the name step has no input').not.toBeNull();
    input!.value = 'Probe';

    click('Enter the Void');
    await reach('choose-class');
    // A fresh unlock store offers the Enforcer alone.
    expect(labels()).toEqual(['Enforcer — flesh and steel']);

    click('Enforcer');
    await reach('accept-or-reroll-stats');

    click('Accept these');
    await reach('main-menu');
    // The hub is built from the pure model: five rows (PLAN.md #2 removed the bargain row).
    expect(labels()).toContain('Continue the descent');
    expect(document.querySelectorAll('#choices .hub-menu .void-button')).toHaveLength(5);
    // The typed name really reached the HUD, as text.
    expect(document.getElementById('sheet')!.textContent).toContain('Probe');
  });

  it('every click went through the engine, and the narration fell back on the record', async () => {
    const bridge = installBridge();
    const { game, entries } = await freshRenderer();
    game.boot();
    choiceButtons()[0]!.click(); // the warning is render-layer only: no engine step
    click('Descend into the Void');
    await reach('enter-name');
    document.getElementById('choices')!.querySelector('input')!.value = 'Probe';
    click('Enter the Void');
    await reach('choose-class');
    click('Enforcer');
    await reach('accept-or-reroll-stats');
    click('Accept these');
    await reach('main-menu');

    // Four dispatches were clicked (continue, name, class, stats), so four engine steps — each
    // one a `step` timeline line carrying only the input's KIND (never the typed name).
    const steps = entries.filter((e) => e.category === 'engine' && e.message === 'step');
    expect(steps.map((e) => (e.data as { input: string }).input)).toEqual([
      'continue',
      'name',
      'class',
      'stats-decision',
    ]);
    // The hub arrival carries a beat, the stub narrator rejects it, and the renderer logs the
    // failure BEFORE the fallback prose appears.
    expect(bridge.generate, 'the narrator was never asked').toHaveBeenCalled();
    expect(
      entries.some((e) => e.message === 'narrate: FAILED' && e.level === 'error'),
      'the rejected narration did not log before falling back',
    ).toBe(true);
    expect(document.querySelectorAll('#narration .beat.fallback').length).toBe(1);
  });
});

/**
 * A run in a LIVE battle, built by the real engine — not by hand, and not by the dev presets
 * (the import-direction scan forbids a file outside `src/dev/` from importing them; the
 * preset-driven battle walks live in `src/dev/battleScreen.test.ts`). A fixed seed walks the
 * same new-run inputs the renderer dispatches, then presses on from the hub until the descent
 * produces an encounter, and opens it.
 */
function liveBattle(): GameState {
  for (let seed = 1; seed < 400; seed += 1) {
    const fight = liveBattleFrom(seed);
    if (fight) return fight;
  }
  throw new Error('no seed under 400 opens a battle on the first descent');
}

/** The run seeded `seed`, walked to the hub and opened into its first fight — or null. */
function liveBattleFrom(seed: number): GameState | null {
  let s = createGame(seed);
  for (const input of [
    { kind: 'continue' },
    { kind: 'name', name: 'Probe' },
    { kind: 'class', classId: 'Enforcer' },
    { kind: 'stats-decision', accept: true },
  ] as const) {
    s = step(s, input).state;
  }
  // Some start-ups pass through a `continue` screen (the act intro) before the hub.
  for (let i = 0; i < 4 && awaitingFor(s.phase) === 'continue'; i += 1) {
    s = step(s, { kind: 'continue' }).state;
  }
  if (awaitingFor(s.phase) !== 'main-menu') return null;
  s = step(s, { kind: 'menu', choice: 'continue' }).state;
  if (s.phase.kind !== 'battle') return null;
  return step(s, { kind: 'continue' }).state; // open the fight
}

describe('a saved run resumes into a live battle (AC-7, second half)', () => {
  it('the save is the real envelope, and Continue lands on battle-action', async () => {
    const fight = liveBattle();
    expect(fight.phase.kind).toBe('battle');
    expect(awaitingFor(fight.phase), 'the fixture battle is not open').toBe('battle-action');

    // Written by the REAL persistence path — the same envelope a player's quit leaves behind.
    saveRun(fight, createStoryMemory(), { runSummary: emptyRunSummary(), runSeed: 77 });

    installBridge();
    const { game, entries } = await freshRenderer();
    game.boot();

    expect(screen(), 'a saved run did not offer the resume screen').toBe('resume');
    expect(
      entries.some((e) => e.message === 'resumable run found'),
      'the resume was not logged',
    ).toBe(true);
    click('Continue your descent');
    expect(screen()).toBe('battle-action');
    expect(labels(), 'the battle offers no Fight').toContain('Fight');
    expect(labels(), 'the battle offers no Run').toContain('Run');
  });

  it('PLAN.md #6: the resumed fight is the framed stage, and its sub-menus open and close', async () => {
    const fight = liveBattle();
    saveRun(fight, createStoryMemory(), { runSummary: emptyRunSummary(), runSeed: 77 });
    installBridge();
    const { game, entries } = await freshRenderer();
    game.boot();
    click('Continue your descent');

    // The stage: the enemy's region in the arena and nowhere else, the stat box filled.
    expect(document.body.dataset['layout']).toBe('stage');
    expect(document.querySelectorAll('.void-art-slot[data-art-slot="enemy"]')).toHaveLength(1);
    expect(document.querySelectorAll('#arena .void-art-slot[data-art-slot="enemy"]')).toHaveLength(1);
    expect(document.querySelectorAll('#sheet .void-art-slot[data-art-slot="enemy"]')).toHaveLength(0);
    const enemyName = fight.phase.kind === 'battle' ? fight.phase.battle.enemy.fullName : '';
    expect(document.querySelector('#arena .arena-name')!.textContent).toBe(enemyName);
    expect(document.querySelector('#vitals .vitals-name')!.textContent).toBe('Probe');
    expect(document.querySelectorAll('#arena .ticker-toggle')).toHaveLength(1);

    // Cast REPLACES the commands; Back restores them — render-layer, no engine step.
    const steps = (): number => entries.filter((e) => e.category === 'engine' && e.message === 'step').length;
    const before = steps();
    click('Cast');
    expect(labels()[0]).toBe('Back');
    expect(labels(), 'the commands are still on screen under the Cast list').not.toContain('Fight');
    // An Enforcer's two core skills (classKit `coreSkills`), each with its cost.
    expect(labels().slice(1)).toEqual(['Heavy Strike (2⚡)', 'Brace (1⚡)']);
    click('Back');
    expect(labels()).toContain('Fight');
    expect(steps(), 'opening a sub-menu stepped the engine').toBe(before);
    expect(entries.filter((e) => e.category === 'battle' && e.message === 'menu').map((e) => (e.data as { mode: string }).mode)).toEqual(['cast', 'commands']);

    // The Record toggle opens the full log beneath the prose, and says so.
    const toggle = document.querySelector<HTMLButtonElement>('#arena .ticker-toggle')!;
    toggle.click();
    expect(document.getElementById('column')!.dataset['log']).toBe('open');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // ...and it survives a re-render of the frame (a sub-menu opening rebuilds the arena).
    click('Cast');
    expect(document.querySelector('#arena .ticker-toggle')!.getAttribute('aria-expanded')).toBe('true');
    click('Back');
  });
});

// =========================================================================================
// PLAN.md #6 — A REAL ROUND, PLAYED ON THE STAGE WHILE THE VOID SPEAKS (AC-21, AC-22, AC-31).
// Every expectation about the round comes from STEPPING THE SAME SAVED STATE through the real
// engine here, independently of the renderer — the renderer must end on exactly those values.
// =========================================================================================

/** The replay's length for `n` beats, re-derived from the four constants (not the schedule). */
function scheduledMs(n: number): number {
  if (n <= 0) return 0;
  const spacing = n === 1 ? BEAT_MS : Math.max(MIN_SPACING_MS, Math.min(BEAT_MS, Math.floor((MAX_ROUND_MS - BEAT_HOLD_MS) / (n - 1))));
  return (n - 1) * spacing + BEAT_HOLD_MS;
}

/** A live battle whose FIRST Fight lands a blow on someone — so a strike is there to see. */
function fightWithAHit(): GameState {
  for (let seed = 1; seed < 400; seed += 1) {
    const fight = liveBattleFrom(seed);
    if (!fight) continue;
    const r = step(fight, { kind: 'battle-action', action: 'fight' });
    const hit = r.events.some((e) => e.kind === 'attack' && (e.outcome === 'hit' || e.outcome === 'crit'));
    if (hit && r.state.phase.kind === 'battle') return fight;
  }
  throw new Error('no seed opens a fight whose first round lands a blow and leaves it going');
}

/** A MediaQueryList stand-in for `prefers-reduced-motion`, and the listeners it was given. */
function stubReducedMotion(matches: boolean): ((ev: { matches: boolean }) => void)[] {
  const listeners: ((ev: { matches: boolean }) => void)[] = [];
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => ({
    matches,
    addEventListener: (_type: string, cb: (ev: { matches: boolean }) => void) => listeners.push(cb),
  }));
  return listeners;
}

describe('a real round plays on the stage while the Void speaks (PLAN.md #6)', () => {
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  async function resume(fight: GameState): Promise<{ entries: LogEntry[] }> {
    saveRun(fight, createStoryMemory(), { runSummary: emptyRunSummary(), runSeed: 77 });
    installBridge();
    const { game, entries } = await freshRenderer();
    game.boot();
    click('Continue your descent');
    expect(screen()).toBe('battle-action');
    return { entries };
  }

  const roundLine = (entries: LogEntry[]): { beats: number; ms: number; motion: string; hooks: string[] } | undefined =>
    entries.find((e) => e.category === 'battle' && e.message === 'round played')?.data as
      | { beats: number; ms: number; motion: string; hooks: string[] }
      | undefined;

  it('Fight: one engine step; the beats replay; the frame ends on the ENGINE’s values', async () => {
    const fight = fightWithAHit();
    const expected = step(fight, { kind: 'battle-action', action: 'fight' });
    const beats = groupBeats(expected.events);
    const { entries } = await resume(fight);
    // Every value the enemy's bar shows, from the moment the replay mounts its frame to the end.
    const enemyBarTexts: string[] = [];
    new MutationObserver(() => {
      const text = document.querySelector('#arena .frame-bar[data-bar="enemy"] .void-bar-text')?.textContent;
      if (text && text !== enemyBarTexts.at(-1)) enemyBarTexts.push(text);
    }).observe(document.getElementById('arena')!, { childList: true, subtree: true });

    click('Fight');
    await vi.waitFor(() => expect(roundLine(entries), 'no round was played').toBeDefined(), { timeout: 4000, interval: 10 });
    await reach('battle-action');

    const played = roundLine(entries)!;
    expect(played.beats, 'the replay did not play the step’s beats').toBe(beats.length);
    expect(played.ms, 'the round did not take its scheduled time').toBeGreaterThanOrEqual(scheduledMs(beats.length) - 5);
    expect(played.ms).toBeLessThan(3000);
    expect(played.motion).toBe('full');
    // Every hook, in beat order — logged by the boundary sink as it is sent.
    const expectedHooks = beats.map((b) => b.hook).filter((h): h is NonNullable<typeof h> => h !== null);
    expect(played.hooks).toEqual(expectedHooks);
    const hookLines = entries.filter((e) => e.category === 'audio' && e.message === 'hook');
    expect(hookLines.map((e) => (e.data as { name: string }).name)).toEqual(expectedHooks);
    expect(hookLines.every((e) => e.level === 'debug'), 'a hook line is louder than debug').toBe(true);
    expect(entries.filter((e) => e.category === 'battle' && e.message === 'beat')).toHaveLength(beats.length);
    expect(entries.filter((e) => e.category === 'engine' && e.message === 'step'), 'the round stepped the engine more than once').toHaveLength(1);

    // THE FRAME ENDS ON THE ENGINE'S NUMBERS — the renderer decided when, never what.
    if (expected.state.phase.kind !== 'battle') throw new Error('the fixture fight ended');
    if (fight.phase.kind !== 'battle') throw new Error('the fixture is not a fight');
    const { enemy, player } = expected.state.phase.battle;
    // ...and it STARTED on the engine's numbers from before the step: the replay's frame shows
    // the pre-round HP until the beat that moved it, then the engine's new value — and nothing
    // in between (every bar is written once, by the engine, never stepped through by the UI).
    const was = fight.phase.battle.enemy;
    expect(enemyBarTexts[0], 'the replay did not start from the pre-round numbers').toBe(`${was.hp}/${was.maxHp}`);
    expect(enemyBarTexts.at(-1)).toBe(`${enemy.hp}/${enemy.maxHp}`);
    expect(enemyBarTexts.length, 'the enemy bar passed through a value the engine never held').toBeLessThanOrEqual(2);
    const bar = (key: string): string => document.querySelector(`.frame-bar[data-bar="${key}"] .void-bar-text`)!.textContent ?? '';
    expect(bar('enemy')).toBe(`${enemy.hp}/${enemy.maxHp}`);
    expect(bar('player')).toBe(`${player.hp}/${player.maxHp}`);
    expect(bar('charges')).toBe(`${player.skillCharges}/${player.maxSkillCharges}`);
    // The ticker rests on the round's last beat, which is the log's last line.
    expect(document.querySelector('#arena .ticker-line')!.textContent).toBe(beats.at(-1)!.line);
    expect(document.querySelectorAll('.void-art-slot[data-art-slot="enemy"]'), 'the replay left a second frame').toHaveLength(1);

    // G50, the behavioural half: the save the step left carries THIS step folded into the run.
    const envelope = JSON.parse(localStorage.getItem('thevoid:run')!) as { runSummary: unknown };
    expect(envelope.runSummary).toEqual(foldRunEvents(emptyRunSummary(), expected.events, expected.state));
  });

  it('REDUCED MOTION (the player’s setting): the same beats and timing; the strike is a tint, nothing moves', async () => {
    const fight = fightWithAHit();
    const beats = groupBeats(step(fight, { kind: 'battle-action', action: 'fight' }).events);
    localStorage.setItem('thevoid:settings', JSON.stringify({ v: 1, textScale: 'normal', motion: 'reduce', contrast: 'normal' }));
    const { entries } = await resume(fight);
    const seen = new Set<string>();
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('#arena *, #vitals *')) for (const c of node.classList) seen.add(c);
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });

    click('Fight');
    await vi.waitFor(() => expect(roundLine(entries)).toBeDefined(), { timeout: 4000, interval: 10 });
    const played = roundLine(entries)!;
    expect(played.motion).toBe('reduced');
    expect(played.beats).toBe(beats.length);
    expect(played.ms, 'reduced motion shortened the round — §13 says timing is unchanged').toBeGreaterThanOrEqual(scheduledMs(beats.length) - 5);
    expect(seen.has('is-struck'), 'a flash played under reduced motion').toBe(false);
    expect(seen.has('is-shaking'), 'the stat box shook under reduced motion').toBe(false);
    expect(seen.has('is-tinted'), 'the blow left no mark at all — the strike must still read').toBe(true);
    const resolved = entries.find((e) => e.message === 'motion resolved')!.data;
    expect(resolved).toEqual({ setting: 'reduce', osReduced: false, animate: false, reason: 'boot' });
  });

  it('changing Motion in Settings re-decides whether the battle animates, at once', async () => {
    installBridge();
    const { game, entries } = await freshRenderer();
    game.boot();
    choiceButtons()[0]!.click(); // the content warning
    click('Settings');
    const reduced = choiceButtons().find((b) => (b.textContent ?? '').trim() === 'Reduced');
    expect(reduced, 'the settings screen offers no Reduced motion').toBeDefined();
    reduced!.click();
    const motion = entries.filter((e) => e.message === 'motion resolved').map((e) => e.data);
    expect(motion.at(-1)).toEqual({ setting: 'reduce', osReduced: false, animate: false, reason: 'settings' });
  });

  it('the OS signal is honoured by default, and re-read when it changes mid-game', async () => {
    const listeners = stubReducedMotion(true);
    const fight = fightWithAHit();
    const { entries } = await resume(fight);
    const motion = (): unknown[] => entries.filter((e) => e.message === 'motion resolved').map((e) => e.data);
    expect(motion()).toEqual([{ setting: 'system', osReduced: true, animate: false, reason: 'boot' }]);
    expect(listeners, 'nothing listens for the OS setting changing').toHaveLength(1);
    listeners[0]!({ matches: false });
    expect(motion().at(-1)).toEqual({ setting: 'system', osReduced: false, animate: true, reason: 'os' });
  });
});

describe('the entry script is the one place the page starts', () => {
  it('main.ts is exactly `import { boot } from ./game.ts; boot();` and the page loads it', () => {
    const main = readFileSync(path.join(ROOT, 'src/desktop/main.ts'), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(main).toBe("import { boot } from './game.ts'; boot();");
    expect(HTML).toMatch(/<script type="module" src="\/src\/desktop\/main\.ts"><\/script>/);
    expect(HTML, 'the page still loads the renderer module directly').not.toMatch(
      /src="\/src\/desktop\/game\.ts"/,
    );
  });
});
