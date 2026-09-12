// TEST-ONLY: the harness for booting the REAL renderer under jsdom (G51, PLAN.md #6).
//
// Nothing that ships imports this; it is named `.testutil.ts` so Vitest does not collect it,
// and it lives under `src/` so `tsc --noEmit` checks it. One copy, shared by
// `src/desktop/boot.test.ts` and `src/dev/battleScreen.test.ts` — two copies of a harness
// drift, and a drifted harness boots a page the game never shows.
//
// THE ISOLATION IDIOM. Module state (the booted flag, the element slots, the logger's sinks)
// lives as long as the module instance, so each case takes a FRESH instance with
// `vi.resetModules()` + a dynamic `import()`, and imports the logger the same way AFTER the
// reset, so it holds the very `log` that instance writes to.
//
// ⚠ ONE RESET PER CASE. Measured, not guessed: a second `vi.resetModules()` + dynamic import
// inside one case, after an earlier case has booted a renderer, left the following dynamic
// `import('./game.ts')` pending forever — a module-loader deadlock in the test runner. Import
// anything else a case needs (the persistence path, the engine) STATICALLY.

import { vi, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LogEntry } from '../log/logger.ts';

/** The shipped page. The repo root is the cwd under jsdom (`skeleton.test.ts`'s note). */
export const DESKTOP_HTML = readFileSync(path.join(process.cwd(), 'desktop.html'), 'utf8');

/** The shipped page's body, parsed and installed. Scripts inserted this way never run. */
export function installPage(): void {
  const parsed = new DOMParser().parseFromString(DESKTOP_HTML, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  for (const name of Object.keys(document.body.dataset)) delete document.body.dataset[name];
}

export interface Bridge {
  onStatus: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

/**
 * The stand-in for the Electron IPC bridge — the same shape the layout probe's preload uses.
 * `generate` REJECTS: there is no model in a test (CLAUDE.md), and rejecting drives the
 * renderer down its own documented fallback, so the prose on screen is prose the game makes.
 */
export function installBridge(): Bridge {
  const bridge: Bridge = {
    onStatus: vi.fn(() => () => undefined),
    generate: vi.fn(() => Promise.reject(new Error('renderer harness: no narrator'))),
    log: vi.fn(),
  };
  (window as unknown as { void: Bridge }).void = bridge;
  return bridge;
}

export function removeBridge(): void {
  delete (window as unknown as { void?: Bridge }).void;
}

/** jsdom ships no font-loading API; the renderer's diagnostic reads `document.fonts.ready`. */
export function installFonts(): void {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve({ size: 4 }) },
  });
}

/** A fresh renderer module and the logger instance it writes to, with every entry captured. */
export async function freshRenderer(): Promise<{
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

export const screen = (): string | undefined => document.body.dataset['screen'];

export const choiceButtons = (): HTMLButtonElement[] => [
  ...document.getElementById('choices')!.querySelectorAll('button'),
];

export const labels = (): string[] => choiceButtons().map((b) => (b.textContent ?? '').trim());

/** Click the one control in the choice column whose label starts with `text`. */
export function click(text: string): void {
  const found = choiceButtons().filter((b) => (b.textContent ?? '').trim().startsWith(text));
  expect(found, `one control starting '${text}' on '${screen()}': ${labels().join(' | ')}`).toHaveLength(1);
  found[0]!.click();
}

/** Wait for an async dispatch (step + the rejected narration) to land on `key`. */
export async function reach(key: string): Promise<void> {
  await vi.waitFor(() => expect(screen(), `waiting for '${key}'`).toBe(key), {
    timeout: 4000,
    interval: 5,
  });
}
