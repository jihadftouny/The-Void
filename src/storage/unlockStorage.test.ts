// Tests for the browser localStorage adapter for the unlock store (M13).
//
// Runs under Vitest's `node` environment — there is no real `window`/`localStorage`. Two
// paths: (1) the no-op / default-store behavior when no storage exists, and (2) a real
// round-trip against an injected fake `window.localStorage` set on `globalThis`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { UNLOCK_KEY, loadUnlockStore, saveUnlockStore } from './unlockStorage.ts';
import {
  createUnlockStore,
  encodeUnlockStore,
  applyRunSummary,
  emptyRunSummary,
} from '../game/unlockStore.ts';

/** A minimal Map-backed stand-in for the browser Storage API. */
function makeFakeLocalStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const g = globalThis as { window?: unknown };

afterEach(() => {
  delete g.window;
});

describe('the pure store core stays DOM-free (load-bearing principle 1)', () => {
  it('src/game/unlockStore.ts references no localStorage / window / document', () => {
    const src = readFileSync(fileURLToPath(new URL('../game/unlockStore.ts', import.meta.url)), 'utf8');
    // Strip line comments so prose never trips the scan; then assert the DOM surface is absent.
    const code = src.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\blocalStorage\b/);
    expect(code).not.toMatch(/\bwindow\b/);
    expect(code).not.toMatch(/\bdocument\b/);
  });
});

describe('under Node (no window)', () => {
  it('loadUnlockStore returns a fresh default store', () => {
    expect(g.window).toBeUndefined();
    expect(loadUnlockStore()).toEqual(createUnlockStore());
  });

  it('saveUnlockStore is a silent no-op (does not throw)', () => {
    expect(() => saveUnlockStore(createUnlockStore())).not.toThrow();
    // Still a default store — nothing persisted.
    expect(loadUnlockStore()).toEqual(createUnlockStore());
  });
});

describe('with an injected fake window.localStorage', () => {
  it('save -> load round-trips a grown store under the unlock key', () => {
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };

    // A store grown by a real run summary (Neuromancer + first-boss-kill unlocked).
    const grown = applyRunSummary(
      createUnlockStore(),
      { ...emptyRunSummary(), bossKills: ['kingpin'] },
      1,
    ).store;

    saveUnlockStore(grown);
    // The adapter writes under the dedicated unlock key (separate from the run save).
    expect(fake.map.get(UNLOCK_KEY)).toBe(encodeUnlockStore(grown));
    expect(loadUnlockStore()).toEqual(grown);
  });

  it('a corrupt payload degrades to a fresh default store (never throws)', () => {
    const fake = makeFakeLocalStorage();
    fake.map.set(UNLOCK_KEY, 'not-json{');
    g.window = { localStorage: fake };
    expect(loadUnlockStore()).toEqual(createUnlockStore());
  });

  it('falls back to a default store when the probe write throws', () => {
    // A localStorage whose setItem always throws (blocked/quota-0) is treated as unavailable.
    g.window = {
      localStorage: {
        getItem: () => encodeUnlockStore(createUnlockStore()),
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
        removeItem: () => {},
      },
    };
    expect(() => saveUnlockStore(createUnlockStore())).not.toThrow();
    expect(loadUnlockStore()).toEqual(createUnlockStore());
  });
});
