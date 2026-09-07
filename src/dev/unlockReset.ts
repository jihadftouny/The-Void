// THE UNDO FOR A DESTRUCTIVE-BY-DESIGN FEATURE — ships in the same unit as the jump.
//
// ⚠ NEVER IN THE PACKAGED BUILD. See `devState.ts`'s header: the whole of `src/dev` is
// eliminated at build time, and `exclusion.test.ts` proves it with the real bundler.
//
// WHY THIS EXISTS (author's ruling, 2026-09-07, plan Appendix A.1). A jumped run calls
// `applyRunOutcome()` exactly as a played one does: it grants feats, unlocks classes and
// relics, and PERSISTS them. That is deliberate — the "Newly unlocked" rows are part of the
// ending screens this unit exists to let the author check, and testing them against a faked
// `lastNewlyUnlocked` would be a stand-in for the very thing under test.
//
// The cost is that a few minutes of jumping can hand the author a meta-progression he never
// earned, permanently. So the undo lands with it, or neither lands.
//
// WHAT A RESET HAS TO DO, and why removing ONE key is not enough. `unlockStorage.ts` keeps a
// BACKUP key holding the last known-good store, and `loadUnlockStore`'s ladder falls through
// to it when the primary is missing-or-unreadable... but ONLY when at least one of the two
// keys still holds something. So:
//   · clear the primary alone   -> the backup decodes -> the ladder returns the OLD store,
//                                  `source: 'backup'`, and shows the player a recovery
//                                  notice. The reset silently did nothing.
//   · overwrite the primary     -> the store reads fresh, but a stale backup survives one
//     with a fresh store           corrupt byte away from resurrecting itself.
//   · clear BOTH                -> the ladder's "nothing stored under either key" rung: a
//                                  fresh store, `source: 'fresh'`, and NO notice. First run.
// Only the third is a reset, which is why the test asserts the SOURCE as well as the store.
//
// The keys are IMPORTED, never re-typed: a reset that clears the wrong key is a reset that
// does nothing, and it would look identical in a diff.

import { UNLOCK_BACKUP_KEY, UNLOCK_KEY } from '../storage/unlockStorage.ts';

/** The only part of the Storage API a reset needs. Injected, so this is testable in Node. */
export interface RemovableStore {
  removeItem(key: string): void;
}

/** What a reset did, so the panel can log it and say so on screen. */
export interface ResetResult {
  ok: boolean;
  /** The keys the reset cleared — both of them, or none when storage refused. */
  cleared: string[];
  /** Present only on failure: what went wrong. */
  message?: string;
}

/** Both keys the unlock store lives under, in the order a reset clears them. */
export const UNLOCK_RESET_KEYS: readonly string[] = [UNLOCK_KEY, UNLOCK_BACKUP_KEY];

/**
 * Return the persistent unlock store to its FIRST-RUN state — PURE apart from the injected
 * storage. Never throws: a blocked or full `localStorage` reports `ok: false` rather than
 * taking the panel down, and a partial clear is reported as exactly the keys it managed.
 */
export function resetUnlockStore(storage: RemovableStore): ResetResult {
  const cleared: string[] = [];
  for (const key of UNLOCK_RESET_KEYS) {
    try {
      storage.removeItem(key);
      cleared.push(key);
    } catch (err) {
      return {
        ok: false,
        cleared,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { ok: true, cleared };
}
