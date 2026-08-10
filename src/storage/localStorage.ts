// Browser `localStorage` adapter for the `SaveStorage` seam (M9).
//
// This lives OUTSIDE `src/game` on purpose: the logic core must never import the
// DOM / `window` / `localStorage` (load-bearing principle 1 — pure logic/render
// split). Only a TYPE is imported from the game core; there is no runtime coupling
// back into `src/game`.
//
// The adapter is SAFE to import and construct under Node (headless tests, SSR):
// when `window`/`localStorage` is absent or unusable, it returns a no-op store
// (`load()` -> null, `save`/`clear` -> nothing). Every real access is wrapped in
// try/catch so a full or blocked quota is non-fatal — failing to persist never
// throws into the game.

import { type SaveStorage } from '../game/save.ts';

/** The single storage key. The save format version lives inside the payload. */
export const SAVE_KEY = 'thevoid:save';

/** A `SaveStorage` that does nothing — used when no usable `localStorage` exists. */
function noopStorage(): SaveStorage {
  return {
    load: () => null,
    save: () => {},
    clear: () => {},
  };
}

/**
 * Probe for a usable `localStorage`. Returns the object only if a write+remove
 * round-trip of a throwaway key succeeds; otherwise `null` (unavailable, private
 * mode with quota 0, blocked by policy, or not in a browser). Never throws.
 */
function probeLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const w = (globalThis as { window?: { localStorage?: Storage } }).window;
    const ls = w?.localStorage;
    if (!ls) return null;
    const probeKey = '__thevoid_probe__';
    ls.setItem(probeKey, '1');
    ls.removeItem(probeKey);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Build the `SaveStorage` backed by the browser's `localStorage`. If no usable
 * `localStorage` is available (e.g. running under Node), returns a no-op store so
 * callers need no environment checks. All accesses are individually guarded, so a
 * mid-session quota failure degrades to a silent no-op rather than an exception.
 */
export function createLocalStorageSaveStorage(): SaveStorage {
  const ls = probeLocalStorage();
  if (!ls) return noopStorage();

  return {
    load: () => {
      try {
        return ls.getItem(SAVE_KEY);
      } catch {
        return null;
      }
    },
    save: (s: string) => {
      try {
        ls.setItem(SAVE_KEY, s);
      } catch {
        // Persisting is best-effort; a full/blocked quota is non-fatal.
      }
    },
    clear: () => {
      try {
        ls.removeItem(SAVE_KEY);
      } catch {
        // Non-fatal.
      }
    },
  };
}
