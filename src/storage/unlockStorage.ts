// Browser `localStorage` adapter for the persistent UNLOCK STORE (M13).
//
// This lives OUTSIDE `src/game` on purpose: the logic core must never import the DOM /
// `window` / `localStorage` (load-bearing principle 1 — pure logic/render split). Only the
// TYPE and the pure encode/decode/create helpers are imported from the game core; there is no
// DOM coupling back into `src/game`.
//
// The unlock store is the PERSISTENT, cross-run artifact — SEPARATE from the run save, under
// its OWN key (`thevoid:unlocks`). Mirrors `localStorage.ts`: a write+remove probe decides
// whether a usable `localStorage` exists; under Node (headless tests, SSR) it degrades to a
// no-op — `load` returns a fresh default store, `save` does nothing — so callers need no
// environment checks. Every access is individually try/caught, so a full/blocked quota is
// non-fatal.

import {
  createUnlockStore,
  encodeUnlockStore,
  decodeUnlockStore,
  type UnlockStore,
} from '../game/unlockStore.ts';

/** The single storage key for the unlock store. Its version lives inside the payload. */
export const UNLOCK_KEY = 'thevoid:unlocks';

/**
 * Probe for a usable `localStorage` (mirrors `localStorage.ts`). Returns the object only if a
 * write+remove round-trip of a throwaway key succeeds; otherwise `null` (unavailable, private
 * mode with quota 0, blocked by policy, or not in a browser). Never throws.
 */
function probeLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const w = (globalThis as { window?: { localStorage?: Storage } }).window;
    const ls = w?.localStorage;
    if (!ls) return null;
    const probeKey = '__thevoid_unlocks_probe__';
    ls.setItem(probeKey, '1');
    ls.removeItem(probeKey);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Load the persistent unlock store. Returns the decoded store, or a fresh
 * `createUnlockStore()` on a miss, a corrupt/incompatible payload, or when no usable
 * `localStorage` exists (headless Node). Never throws.
 */
export function loadUnlockStore(): UnlockStore {
  const ls = probeLocalStorage();
  if (!ls) return createUnlockStore();
  let raw: string | null = null;
  try {
    raw = ls.getItem(UNLOCK_KEY);
  } catch {
    return createUnlockStore();
  }
  if (raw == null) return createUnlockStore();
  return decodeUnlockStore(raw) ?? createUnlockStore();
}

/**
 * Persist the unlock store. Best-effort: a full/blocked quota or an absent `localStorage`
 * (headless Node) is a silent no-op rather than an exception.
 */
export function saveUnlockStore(store: UnlockStore): void {
  const ls = probeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(UNLOCK_KEY, encodeUnlockStore(store));
  } catch {
    // Persisting is best-effort; a full/blocked quota is non-fatal.
  }
}
