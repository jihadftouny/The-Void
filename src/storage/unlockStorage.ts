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
//
// G3 — WHY THERE IS A BACKUP KEY AND A RETURN SHAPE.
//
// `loadUnlockStore` used to be `decodeUnlockStore(raw) ?? createUnlockStore()` and return a
// bare `UnlockStore`. This is the ONLY copy of everything a player has ever earned — every
// class unlocked, every relic, every feat, across every run they have played — and one
// unparseable byte silently replaced all of it with a brand-new store. The player was then
// shown the Enforcer-only class select with no explanation, and the next `saveUnlockStore`
// overwrote the damaged data with the empty one, making the loss permanent.
//
// Two changes, and they are separable on purpose:
//  1. A BACKUP KEY holding the last KNOWN-GOOD store. `saveUnlockStore` rotates it: it copies
//     the CURRENT primary across only if that primary still decodes, so a corrupt primary can
//     never overwrite a good backup. The backup is therefore one generation behind — a
//     recovery costs at most the last completed run, instead of everything.
//  2. The load RETURNS WHAT HAPPENED (`UnlockLoadResult`), so the renderer can say so. The
//     old signature made silent loss the only possible behaviour, and that silence IS G3.
//
// OUT OF SCOPE, deliberately: moving these to a real file on disk. G3's row also mentions
// that, but it is N3 / `UI-DESIGN.md` §14's named save slots, tied to PLAN.md #8, which
// SHIP-SCOPE.md cuts to v1.3. Only the backup/restore/report half is v1.

import {
  createUnlockStore,
  encodeUnlockStore,
  decodeUnlockStore,
  type UnlockStore,
} from '../game/unlockStore.ts';

/** The single storage key for the unlock store. Its version lives inside the payload. */
export const UNLOCK_KEY = 'thevoid:unlocks';

/** The last KNOWN-GOOD store, rotated in by `saveUnlockStore`. */
export const UNLOCK_BACKUP_KEY = 'thevoid:unlocks:backup';

/** Where the store that was handed back actually came from. */
export type UnlockSource = 'primary' | 'backup' | 'fresh';

/** What `loadUnlockStore` found, not just what it returns. */
export interface UnlockLoadResult {
  store: UnlockStore;
  source: UnlockSource;
  /**
   * A plain-English account of what was lost or recovered, for the player. ABSENT on both
   * normal paths (a good primary; a first run with nothing stored yet), so its mere presence
   * means "show this to someone".
   */
  lost?: string;
}

/** Shown when the primary was unreadable but the backup was not. */
const RECOVERED_MESSAGE =
  'Your record of unlocked classes and relics was damaged, and has been restored from a ' +
  'backup. Anything earned in your most recent completed run may be missing.';

/** Shown when neither copy could be read. The honest version of what used to happen silently. */
const LOST_MESSAGE =
  'Your record of unlocked classes and relics could not be read, and has been reset. ' +
  'Unlocked classes and relics are gone; their feats can be earned again on a future descent.';

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

/** Read one key and decode it. `null` for absent, unreadable, or structurally invalid. */
function readStore(ls: Storage, key: string): UnlockStore | null {
  let raw: string | null = null;
  try {
    raw = ls.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  return decodeUnlockStore(raw);
}

/** True when the key holds something — even something unreadable. Distinguishes "damaged". */
function hasSomething(ls: Storage, key: string): boolean {
  try {
    return ls.getItem(key) != null;
  } catch {
    return false;
  }
}

/**
 * Load the persistent unlock store, reporting where it came from. Never throws.
 *
 * The ladder:
 *   1. no usable `localStorage` (headless Node)     -> fresh, `source: 'fresh'`, NO message.
 *      Not a loss — it is the normal state under Vitest, and crying wolf here would train
 *      the reader to ignore the one case that matters.
 *   2. the primary decodes                          -> `source: 'primary'`, NO message.
 *   3. the primary is absent AND so is the backup   -> fresh, `source: 'fresh'`, NO message.
 *      A first run. Nothing was lost, because nothing was ever there.
 *   4. the backup decodes                           -> `source: 'backup'`, RECOVERED message.
 *   5. neither decodes                              -> fresh, `source: 'fresh'`, LOST message.
 */
export function loadUnlockStore(): UnlockLoadResult {
  const ls = probeLocalStorage();
  if (!ls) return { store: createUnlockStore(), source: 'fresh' };

  const primary = readStore(ls, UNLOCK_KEY);
  if (primary) return { store: primary, source: 'primary' };

  // Nothing stored under either key: a first run, not a loss.
  if (!hasSomething(ls, UNLOCK_KEY) && !hasSomething(ls, UNLOCK_BACKUP_KEY)) {
    return { store: createUnlockStore(), source: 'fresh' };
  }

  const backup = readStore(ls, UNLOCK_BACKUP_KEY);
  if (backup) return { store: backup, source: 'backup', lost: RECOVERED_MESSAGE };
  return { store: createUnlockStore(), source: 'fresh', lost: LOST_MESSAGE };
}

/**
 * Persist the unlock store, rotating the previous KNOWN-GOOD copy into the backup key first.
 * Best-effort: a full/blocked quota or an absent `localStorage` (headless Node) is a silent
 * no-op rather than an exception.
 *
 * THE ROTATION RULE, in three cases — and the middle one is the whole point:
 *   1. the current primary DECODES        -> rotate it in. The backup becomes the state
 *                                            before this save: one generation behind.
 *   2. it does not, but the BACKUP does   -> LEAVE THE BACKUP ALONE. It is the last known
 *                                            good copy of everything the player has earned,
 *                                            and this save cannot improve on it.
 *   3. neither decodes                    -> seed the backup with what is being written now,
 *                                            so a backup exists from the first save onward.
 *
 * Case 2 is not a refinement; without it the mechanism does not work. A player whose primary
 * is damaged between sessions boots into a FRESH store, plays, and saves — and an unguarded
 * rotation (or a "seed whenever the primary is unreadable" rule, which is what this function
 * did first) would copy that empty store over the good backup and make the loss permanent on
 * the very next write. That is the exact failure G3 describes, moved one save later. It was
 * found by the test named after it, not by reading this code.
 */
export function saveUnlockStore(store: UnlockStore): void {
  const ls = probeLocalStorage();
  if (!ls) return;
  const encoded = encodeUnlockStore(store);
  try {
    const priorPrimary = readStore(ls, UNLOCK_KEY);
    if (priorPrimary) {
      ls.setItem(UNLOCK_BACKUP_KEY, encodeUnlockStore(priorPrimary));
    } else if (!readStore(ls, UNLOCK_BACKUP_KEY)) {
      ls.setItem(UNLOCK_BACKUP_KEY, encoded);
    }
  } catch {
    // The backup is an extra safety net, not the store itself. Losing the rotation must not
    // stop the real write below.
  }
  try {
    ls.setItem(UNLOCK_KEY, encoded);
  } catch {
    // Persisting is best-effort; a full/blocked quota is non-fatal.
  }
}
