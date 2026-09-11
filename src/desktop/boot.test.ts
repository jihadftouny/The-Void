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
import { emptyRunSummary } from '../game/unlockStore.ts';
import type { LogEntry } from '../log/logger.ts';

// The repo root. `import.meta.url` is not a file url under jsdom (the `skeleton.test.ts` note).
const ROOT = process.cwd();
const HTML = readFileSync(path.join(ROOT, 'desktop.html'), 'utf8');

/** The shipped page's body, parsed and installed. Scripts inserted this way never run. */
function installPage(): void {
  const parsed = new DOMParser().parseFromString(HTML, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  for (const name of Object.keys(document.body.dataset)) delete document.body.dataset[name];
}

interface Bridge {
  onStatus: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

/**
 * The stand-in for the Electron IPC bridge — the same shape the layout probe's preload uses.
 * `generate` REJECTS: there is no model in a test (CLAUDE.md), and rejecting drives the
 * renderer down its own documented fallback, so the prose on screen is prose the game makes.
 */
function installBridge(): Bridge {
  const bridge: Bridge = {
    onStatus: vi.fn(() => () => undefined),
    generate: vi.fn(() => Promise.reject(new Error('boot test: no narrator'))),
    log: vi.fn(),
  };
  (window as unknown as { void: Bridge }).void = bridge;
  return bridge;
}

function removeBridge(): void {
  delete (window as unknown as { void?: Bridge }).void;
}

/** jsdom ships no font-loading API; the renderer's diagnostic reads `document.fonts.ready`. */
function installFonts(): void {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve({ size: 4 }) },
  });
}

/** A fresh renderer module and the logger instance it writes to, with every entry captured. */
async function freshRenderer(): Promise<{
  game: typeof import('./game.ts');
  log: typeof import('../log/logger.ts')['log'];
  entries: LogEntry[];
}> {
  vi.resetModules();
  const logger = await import('../log/logger.ts');
  const entries: LogEntry[] = [];
  logger.log.addSink((e) => entries.push(e));
  const game = await import('./game.ts');
  return { game, log: logger.log, entries };
}

const screen = (): string | undefined => document.body.dataset['screen'];
const choiceButtons = (): HTMLButtonElement[] => [
  ...document.getElementById('choices')!.querySelectorAll('button'),
];
const labels = (): string[] => choiceButtons().map((b) => (b.textContent ?? '').trim());

/** Click the one control in the choice column whose label starts with `text`. */
function click(text: string): void {
  const found = choiceButtons().filter((b) => (b.textContent ?? '').trim().startsWith(text));
  expect(found, `one control starting '${text}' on '${screen()}': ${labels().join(' | ')}`).toHaveLength(
    1,
  );
  found[0]!.click();
}

/** Wait for an async dispatch (step + the rejected narration) to land on `key`. */
async function reach(key: string): Promise<void> {
  await vi.waitFor(() => expect(screen(), `waiting for '${key}'`).toBe(key), {
    timeout: 3000,
    interval: 5,
  });
}

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
    if (awaitingFor(s.phase) !== 'main-menu') continue;
    s = step(s, { kind: 'menu', choice: 'continue' }).state;
    if (s.phase.kind !== 'battle') continue;
    return step(s, { kind: 'continue' }).state; // open the fight
  }
  throw new Error('no seed under 400 opens a battle on the first descent');
}

describe('a saved run resumes into a live battle (AC-7, second half)', () => {
  it('the save is the real envelope, and Continue lands on battle-action', async () => {
    const fight = liveBattle();
    expect(fight.phase.kind).toBe('battle');
    expect(awaitingFor(fight.phase), 'the fixture battle is not open').toBe('battle-action');

    // Written by the REAL persistence path of a fresh module instance — the same envelope a
    // player's quit leaves behind.
    vi.resetModules();
    const persist = await import('./persist.ts');
    persist.saveRun(fight, createStoryMemory(), { runSummary: emptyRunSummary(), runSeed: 77 });

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
