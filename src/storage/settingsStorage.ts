// Browser `localStorage` adapter for the PLAYER'S PREFERENCES (PLAN.md #8 / FINDINGS.md B1).
//
// This lives outside `src/render` for the same reason `unlockStorage.ts` lives outside
// `src/game`: the pure model must not import the DOM, and the applier must not import
// storage. `settings-model.ts` decides what a setting MEANS; this decides where it is kept.
// Only the TYPE and the pure parse/serialize helpers cross the boundary.
//
// PATTERN, copied deliberately from `unlockStorage.ts` rather than reinvented: a
// write-then-remove probe decides whether a usable `localStorage` exists, so under Node
// (headless tests, and every Vitest run) this degrades to a no-op — `load` returns the
// defaults, `save` does nothing — and no caller needs an environment check. Every access is
// individually try/caught, so a full or policy-blocked quota is non-fatal.
//
// WHERE IT DELIBERATELY DIFFERS FROM THE UNLOCK STORE, and why: there is NO backup key.
// The unlock store is the only copy of everything a player has ever earned across every run,
// so losing it is catastrophic and worth a whole rotation mechanism. Preferences are three
// enum values a player can re-pick in five seconds. Adding a backup here would be ceremony —
// and worse, it would suggest the two stores carry comparable stakes.
//
// AND WHY IT LOGS (principle 7). This file RECOVERS: a corrupt payload silently becomes the
// defaults, which is the correct behaviour and also exactly the shape that destroys evidence.
// A player reporting "my text size keeps resetting" needs a line in the log saying the stored
// payload could not be read. Every failure path here speaks before it recovers.

import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  type Settings,
} from '../render/settings-model.ts';
import { log } from '../log/logger.ts';

/** The message of a thrown value, whatever it is. Never throws. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The single storage key. Its version lives inside the payload, as `Settings.v`. */
export const SETTINGS_KEY = 'thevoid:settings';

/**
 * Probe for a usable `localStorage` (mirrors `unlockStorage.ts`). Returns the object only if
 * a write+remove round trip of a throwaway key succeeds; otherwise `null`. Never throws.
 */
function probeLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const w = (globalThis as { window?: { localStorage?: Storage } }).window;
    const ls = w?.localStorage;
    if (!ls) return null;
    const probeKey = '__thevoid_settings_probe__';
    ls.setItem(probeKey, '1');
    ls.removeItem(probeKey);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Load the player's preferences. TOTAL — never throws, always returns a usable `Settings`.
 *
 * The ladder, and what each rung says in the log:
 *   1. no usable `localStorage`  -> defaults, SILENT. This is the normal state under Node,
 *      and crying wolf here would train the reader to ignore rung 3.
 *   2. nothing stored yet        -> defaults, SILENT. A first run is not a failure.
 *   3. stored but unreadable     -> defaults, and it SAYS SO. This is the only rung that
 *      represents something actually going wrong, so it is the only one that logs.
 */
export function loadSettings(): Settings {
  const ls = probeLocalStorage();
  if (!ls) return DEFAULT_SETTINGS;
  let raw: string | null = null;
  try {
    raw = ls.getItem(SETTINGS_KEY);
  } catch (err) {
    log.warn('settings', 'could not read stored preferences', { message: messageOf(err) });
    return DEFAULT_SETTINGS;
  }
  if (raw == null) return DEFAULT_SETTINGS;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (err) {
    // LOG BEFORE RECOVERING. Without this the player's settings silently revert and the only
    // symptom is a preference that "keeps resetting" with nothing to point at.
    log.warn('settings', 'stored preferences were unreadable and have been reset', {
      message: messageOf(err),
      bytes: raw.length,
    });
    return DEFAULT_SETTINGS;
  }
  const parsed = parseSettings(decoded);
  return parsed;
}

/**
 * Persist the player's preferences. Best-effort: an absent or blocked `localStorage` is a
 * silent no-op, and a failed write is logged rather than thrown — a settings write must never
 * be able to take down a run in progress.
 */
export function saveSettings(settings: Settings): void {
  const ls = probeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(SETTINGS_KEY, serializeSettings(settings));
  } catch (err) {
    log.warn('settings', 'could not persist preferences', { message: messageOf(err) });
  }
}
