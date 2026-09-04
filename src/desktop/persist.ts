// Long-term persistence for the desktop AI game: the whole run — engine state,
// narrative memory AND the run's meta-progression so far — round-trips through
// localStorage, so relaunching offers a real "Continue". Render-layer only
// (localStorage is a browser API); the engine stays pure. A file-on-disk save is
// a packaging-era concern (N10 / #8).
//
// WHY THE ENVELOPE GREW A VERSION 2 (G19 -> G1). The envelope used to carry
// `{ v: 1, state, memory }` and nothing else. But the renderer accumulates two
// things ALONGSIDE `GameState` that no engine save has ever held: `runSummary`
// (the pure `foldRunEvents` subscriber that decides which feats fire at the end
// of the run) and `runSeed` (the run identity `applyRunSummary` records). Neither
// is in `GameState`, so neither survived a save — and on resume the renderer
// started from `emptyRunSummary()`. The consequence, reproduced by the register:
// seed 4242 unlocks the Neuromancer when played straight through, and unlocks
// NOTHING when resumed from its own act-2 state. Quitting mid-descent silently
// forfeited every feat the run had earned.
//
// ⚠ THIS IS NOT A `SAVE_VERSION` BUMP, and must not become one. `SAVE_VERSION`
// versions `GameState` (`save.ts`: "the save format version IS
// `GameState.version`"), and `GameState`'s shape is untouched here. The envelope
// has its OWN `v`, entirely separate, exactly as the unlock store has its own
// `UNLOCK_STORE_VERSION`.
//
// The v1 path is kept and TOLERANT: a v1 envelope still opens, still returns its
// state and memory, and reports `meta: null` — meaning "this save predates G19's
// fix and cannot tell us what the run has earned". The caller then starts from an
// empty summary and says so in the log, which is exactly today's behaviour, but
// NAMED and REPORTED ONCE instead of silent forever.
import { decodeSave } from '../game/save.ts';
import type { GameState } from '../game/game.ts';
import type { StoryMemory } from '../llm/narrate.ts';
import type { RunSummary } from '../game/unlockStore.ts';
import { BOSSES, type BossId } from '../game/boss.ts';
import { log } from '../log/logger.ts';
import { SLOW_MS, levelForDuration, startTimer } from '../log/timing.ts';

const KEY = 'thevoid:run';

/**
 * WHY THIS FILE LOGS (principle 7). Every rejection below used to be a bare `return null`
 * and every write failure a bare `catch {}`. That is a player losing a run in complete
 * silence: the game simply offers "begin a new descent" and nothing anywhere records that
 * a save existed and was refused, or why. Six indistinguishable silent exits are six
 * unreproducible bug reports.
 *
 * THE MEASUREMENT NEVER CHANGES THE MEASUREMENT (PRINCIPLES.md §A18). Not one return
 * value, branch or order changes here; the log lines are added beside the existing
 * decisions. `persist.test.ts`'s pre-existing assertions are the control for that and are
 * untouched.
 *
 * NUMBERS LIVE IN `data`, NEVER IN `message`. Every message below is a constant string
 * with no digit and no interpolation, so `grep '"ms":'` over a log file always works.
 */

/** The message of a thrown value, whatever it is. Never throws, never returns undefined. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Why a stored envelope was refused. One constant per branch — never a shared "invalid". */
export type SaveRejection =
  | 'absent'
  | 'not-json'
  | 'unknown-version'
  | 'state-decode-failed'
  | 'memory-invalid'
  | 'meta-invalid'
  | 'unreadable';

function rejected(reason: SaveRejection, data: Record<string, unknown> = {}): void {
  log.warn('save', 'save rejected', { reason, ...data });
}

/** The current envelope version. Independent of the engine's `SAVE_VERSION`. */
export const ENVELOPE_VERSION = 2;

/**
 * The renderer-side run bookkeeping that lives OUTSIDE `GameState`: what the run has earned
 * so far, and the seed it was started from. Plain data; round-trips through JSON.
 */
export interface RunMeta {
  runSummary: RunSummary;
  /** The seed `createGame` was called with — NOT `state.rngState`, which advances as you play. */
  runSeed: number;
}

export interface SavedRun {
  state: GameState;
  memory: StoryMemory;
  /** `null` for a legacy v1 envelope: the save cannot say what the run has earned. */
  meta: RunMeta | null;
}

/**
 * Persist a run. `meta` is REQUIRED on purpose: an optional third argument is exactly how the
 * meta-progression got lost in the first place — every one of `game.ts`'s five `saveRun` call
 * sites would have compiled while forgetting it, and that omission IS G19. Making it
 * mandatory turns the defect into a type error.
 */
export function saveRun(state: GameState, memory: StoryMemory, meta: RunMeta): void {
  const timer = startTimer();
  let bytes = 0;
  try {
    const payload = JSON.stringify({
      v: ENVELOPE_VERSION,
      state,
      memory,
      runSummary: meta.runSummary,
      runSeed: meta.runSeed,
    });
    bytes = payload.length;
    localStorage.setItem(KEY, payload);
    const ms = timer.stop();
    log.log(levelForDuration(ms, SLOW_MS.save), 'save', 'run saved', { ms, bytes });
  } catch (err) {
    // Still no throw — the run must keep playing when storage is unavailable. But it no
    // longer happens in silence, which is the difference between "autosave is broken" and
    // "the game randomly forgets my descent".
    log.error('save', 'save FAILED', { message: messageOf(err), bytes });
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    log.warn('save', 'clear FAILED', { message: messageOf(err) });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A finite number, or `undefined`. Rejects NaN/Infinity/strings, which JSON can carry. */
function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const BOSS_IDS = new Set(Object.keys(BOSSES));

/**
 * Validate a stored `runSummary` — returns `null` rather than throwing or trusting.
 *
 * This is stricter than "it parsed", deliberately. `bossKills` feeds `FEATS`, so a garbage
 * string in that array would be recorded as a boss kill and could unlock a class the player
 * never earned; every id is checked against `BOSSES`. The optional fields are only carried
 * through when they are genuinely present and valid, so `exactOptionalPropertyTypes` holds
 * and an absent field never becomes `undefined`-valued.
 */
function decodeRunSummary(raw: unknown): RunSummary | null {
  if (!isPlainObject(raw)) return null;
  if (!Array.isArray(raw.bossKills)) return null;
  if (!raw.bossKills.every((id) => typeof id === 'string' && BOSS_IDS.has(id))) return null;
  const spareCount = finite(raw.spareCount);
  const maxAct = finite(raw.maxAct);
  if (spareCount === undefined || maxAct === undefined) return null;
  if (typeof raw.wonBattleUnhurt !== 'boolean') return null;
  if (typeof raw.tookDamageThisBattle !== 'boolean') return null;

  const summary: RunSummary = {
    bossKills: raw.bossKills as BossId[],
    spareCount,
    maxAct,
    wonBattleUnhurt: raw.wonBattleUnhurt,
    tookDamageThisBattle: raw.tookDamageThisBattle,
  };
  if (raw.endingType === 'grace' || raw.endingType === 'damnation') {
    summary.endingType = raw.endingType;
  }
  if (typeof raw.pendingBoss === 'string' && BOSS_IDS.has(raw.pendingBoss)) {
    summary.pendingBoss = raw.pendingBoss as BossId;
  }
  const lastPlayerHp = finite(raw.lastPlayerHp);
  if (lastPlayerHp !== undefined) summary.lastPlayerHp = lastPlayerHp;
  return summary;
}

/**
 * Read the saved run, or `null` when there is none / it cannot be trusted. Never throws.
 *
 *   v === 2   -> { state, memory, meta }, meta validated field by field; a corrupt meta
 *                degrades to `meta: null` rather than discarding an otherwise good run.
 *   v === 1   -> { state, memory, meta: null }   the save predates G19's fix
 *   or absent
 *   anything  -> null                            start a new run (unchanged)
 *   else
 *
 * A FUTURE `v` is rejected, like every other decoder here: a build that cannot read the
 * envelope must not half-read it.
 */
export function loadRun(): SavedRun | null {
  const timer = startTimer();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      rejected('absent');
      return null;
    }
    const bytes = raw.length;
    let env: Record<string, unknown>;
    try {
      env = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      rejected('not-json', { bytes, message: messageOf(err) });
      return null;
    }
    if (!isPlainObject(env)) {
      rejected('not-json', { bytes });
      return null;
    }
    const version = env.v === undefined ? 1 : env.v;
    if (version !== 1 && version !== ENVELOPE_VERSION) {
      rejected('unknown-version', { bytes, v: version });
      return null;
    }
    // Reuse the engine's validating decoder for the game state (rejects corrupt/old saves).
    const state = decodeSave(JSON.stringify(env.state ?? null));
    if (!state) {
      rejected('state-decode-failed', { bytes });
      return null;
    }
    const m = env.memory as Partial<StoryMemory> | undefined;
    if (!m || !Array.isArray(m.beats)) {
      rejected('memory-invalid', { bytes });
      return null;
    }
    const memory: StoryMemory = {
      beats: m.beats.map(String),
      enemiesDefeated: Number(m.enemiesDefeated) || 0,
      timesFled: Number(m.timesFled) || 0,
      notable: Array.isArray(m.notable) ? m.notable.map(String) : [],
    };

    let meta: RunMeta | null = null;
    if (version === ENVELOPE_VERSION) {
      const runSummary = decodeRunSummary(env.runSummary);
      const runSeed = finite(env.runSeed);
      if (runSummary && runSeed !== undefined) meta = { runSummary, runSeed };
      // A v2 envelope whose meta did not survive validation degrades to `meta: null` — the
      // run still opens, but everything it had EARNED is gone (G19's consequence, arriving
      // by a different door). That is not a silent detail.
      if (!meta) rejected('meta-invalid', { bytes });
    } else {
      log.warn('save', 'legacy envelope', { v: 1, bytes });
    }
    const ms = timer.stop();
    log.log(levelForDuration(ms, SLOW_MS.load, 'info'), 'save', 'run loaded', {
      ms,
      bytes,
      envelope: version,
      metaPresent: meta !== null,
    });
    return { state, memory, meta };
  } catch (err) {
    // The seventh branch, and a real one: `localStorage.getItem` itself can throw (quota
    // policy, a blocked origin). It is NOT folded into `not-json`, because conflating
    // "the browser refused to talk to us" with "the stored bytes are garbage" is exactly
    // the kind of shared reason string that makes a log unable to answer the question.
    rejected('unreadable', { message: messageOf(err) });
    return null;
  }
}
