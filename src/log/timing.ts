// Duration measurement for the renderer and the storage adapters — the "time everything
// that can be slow" half of load-bearing principle 7.
//
// PURE + BOUNDARY-ONLY. This module lives in `src/log` (infrastructure) exactly like
// `logger.ts`, and for the same reason: `src/game` and `src/llm` must never import it.
// A clock inside the pure cores would make a run non-reproducible from `seed + inputs`
// (principle 2) and their tests non-hermetic. `purity.test.ts` asserts that, per file,
// rather than trusting this comment.
//
// ONE CLOCK SEAM. Every duration here is measured through `logger.now()` — the same
// function `logger.setClock()` replaces — so a test scripts one clock and asserts EXACT
// integers. No `Date.now()`, no `performance.now()`, no tolerance windows, no
// `vi.useFakeTimers`.
import { now, type LogLevel } from './logger.ts';

/**
 * How slow is slow, per boundary, in milliseconds. Frozen: a threshold is DATA
 * (principle 3), so tuning one is a value edit and never a logic edit.
 *
 * Every number is derived, not guessed:
 *  - `step` 50 ms — `sim.ts` executes ~170 000 engine steps in seconds (FINDINGS.md G13),
 *    i.e. ~0.05 ms/step. 50 ms is ~1000x the measured mean, so a warn means something is
 *    genuinely wrong rather than "this machine is a bit slow".
 *  - `turn` 25 000 ms — the design cadence is 89 tok/s (N1-SPIKE.md) x `maxTokens` 400
 *    => ~4.5 s for a healthy narrated turn; the known no-GPU pathology is 7.6 tok/s
 *    => ~53 s. 25 s sits above every healthy turn and below the known-bad one.
 *  - `narrate` 20 000 ms — the same derivation, minus the render work `turn` also covers.
 *  - `save` 100 ms / `load` 250 ms — a run save is tens of kilobytes of `JSON.stringify`;
 *    both are two orders of magnitude above that, so only a real stall trips them.
 *  - `round` 2 500 ms (PLAN.md #6) — the battle's beat replay is SCHEDULED, not computed:
 *    `beat-model.ts` caps a round at `MAX_ROUND_MS` 1 600 ms (up to twelve beats; a thirteenth
 *    runs to 1 680 at the readable floor). 2 500 is well above every designed replay and far
 *    below the narration, so a warn means the timers themselves are being starved — a busy
 *    main thread, the very freeze principle 7 was added for.
 */
export const SLOW_MS: Readonly<Record<'step' | 'turn' | 'narrate' | 'save' | 'load' | 'round', number>> =
  Object.freeze({
    step: 50,
    turn: 25_000,
    narrate: 20_000,
    save: 100,
    load: 250,
    round: 2_500,
  });

/**
 * The level a completed operation should be logged at, given how long it took.
 *
 * `okLevel` is what a HEALTHY operation gets (`debug` for the chatty per-step lines,
 * `info` for the once-per-action timeline a shipped build must keep). Anything at or
 * over `threshold` escalates to `warn`, which is how a build running at `info` still
 * captures every pathology without writing debug spam.
 *
 * A NON-FINITE duration is `warn`, not `okLevel`: a duration we could not measure is
 * suspicious, and the failure mode of the opposite choice is that broken timing looks
 * healthy forever.
 */
export function levelForDuration(ms: number, threshold: number, okLevel: LogLevel = 'debug'): LogLevel {
  if (!Number.isFinite(ms)) return 'warn';
  return ms >= threshold ? 'warn' : okLevel;
}

/**
 * A duration rounded for the log: two decimal places, so a 0.4 ms step reads `0.4`
 * rather than `0`, and a 4523.7181 ms generation reads `4523.72` rather than as noise.
 *
 * A NON-FINITE duration becomes `-1` — a value no real duration can take — so
 * "unmeasurable" is visible in the file instead of silently becoming `0` (which would
 * read as "instant", the exact opposite of what happened). It is also JSON-safe;
 * `JSON.stringify(NaN)` is `null`, which loses the distinction entirely.
 */
export function roundMs(ms: number): number {
  if (!Number.isFinite(ms)) return -1;
  return Math.round(ms * 100) / 100;
}

/** A running measurement. `stop()` is safe to call more than once and always re-reads. */
export interface Timer {
  stop(): number;
}

/**
 * Start measuring, against the injected clock ONLY. `stop()` returns the elapsed
 * milliseconds through `roundMs`.
 */
export function startTimer(): Timer {
  const t0 = now();
  return {
    stop: () => roundMs(now() - t0),
  };
}
