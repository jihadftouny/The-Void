// Tests for the browser localStorage adapter (M9).
//
// Runs under Vitest's `node` environment (see vitest.config.ts) — there is no real
// `window`/`localStorage`. So we test two paths: (1) the no-op behavior when no
// storage exists, and (2) a real round-trip against an injected fake `window.
// localStorage`, which we set on `globalThis` and remove afterward.

import { describe, it, expect, afterEach } from 'vitest';
import {
  SAVE_KEY,
  createLocalStorageSaveStorage,
} from './localStorage.ts';

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
  // Always clear any injected window so tests stay isolated and Node-safe.
  delete g.window;
});

describe('under Node (no window)', () => {
  it('constructs without throwing and load() returns null', () => {
    expect(g.window).toBeUndefined();
    const st = createLocalStorageSaveStorage();
    expect(st.load()).toBeNull();
  });

  it('save() and clear() are silent no-ops (do not throw)', () => {
    const st = createLocalStorageSaveStorage();
    expect(() => st.save('payload')).not.toThrow();
    expect(() => st.clear()).not.toThrow();
    // Still nothing to load — the no-op store never persisted.
    expect(st.load()).toBeNull();
  });
});

describe('with an injected fake window.localStorage', () => {
  it('save -> load -> clear behaves like real storage', () => {
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };

    const st = createLocalStorageSaveStorage();

    // Nothing stored yet.
    expect(st.load()).toBeNull();

    st.save('the-payload');
    // The adapter writes under SAVE_KEY specifically.
    expect(fake.map.get(SAVE_KEY)).toBe('the-payload');
    expect(st.load()).toBe('the-payload');

    st.clear();
    expect(fake.map.has(SAVE_KEY)).toBe(false);
    expect(st.load()).toBeNull();
  });

  it('falls back to a no-op store when the probe write throws', () => {
    // A localStorage whose setItem always throws (e.g. blocked/quota-0) must be
    // treated as unavailable — the probe fails, so we get the no-op store.
    g.window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
        removeItem: () => {},
      },
    };

    const st = createLocalStorageSaveStorage();
    expect(() => st.save('x')).not.toThrow();
    expect(st.load()).toBeNull();
  });
});
