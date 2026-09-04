// Timing for the Electron main process — the "anything that can be slow gets timed"
// half of principle 7, on the side of the app that owns the model.
//
// ---------------------------------------------------------------------------------------
// WHY THIS EXISTS AT ALL. `electron/llm.mjs` had ZERO log calls. Every genuinely slow
// thing in this product happens inside it: resolving (and on first run DOWNLOADING) a
// 2.5 GB model, probing GPUs in child processes at a 30 s timeout each, initialising
// llama, loading the model, creating the context, and generating. When the engineer hit a
// tens-of-seconds freeze on the first enemy encounter, on a GPU machine, there was
// literally no evidence of any kind — because a freeze IS the end line never arriving,
// and nothing here logged a start.
//
// SO THE FIRST RULE IS: LOG THE START OF ANYTHING THAT CAN HANG. `begin()` emits
// `<name>: start` before the work, so an operation that never returns still leaves a
// trace. The second rule is the HEARTBEAT: while an operation is outstanding it emits a
// `warn` every `HEARTBEAT_MS` carrying how long it has been running and whatever the
// caller last noted (for a generation, the chunk count — which distinguishes "slow but
// alive" from "genuinely wedged"). A completed operation logs itself; an operation that
// never completes is precisely the case with no evidence, and the heartbeat is the only
// thing that produces any.
//
// ---------------------------------------------------------------------------------------
// RECORDED DEVIATION (PRINCIPLES.md §A12): a SECOND clock, and why it is not a second
// seam. `src/` has exactly one clock seam (`logger.setClock` / `logger.now()`). The
// Electron main process CANNOT import it: it runs raw ESM under Electron with no
// TypeScript step, and `tsconfig.json`'s `include` is `["src"]`. So `now` is injected
// here and defaults to `performance.now()`. This is not a new pattern — the repo already
// has two logger implementations for the same reason (`src/log/logger.ts` and
// `electron/log.mjs`), and `gpu.mjs`/`model-path.mjs` already establish "pure decision +
// injected edge" on this side. The two sides share a CONTRACT (the category / message /
// data-key names), not a module. Rejected: importing the TS logger into `electron/`
// (impossible without a build step for the main process — a far larger change than this
// unit), and a shared JSON key manifest (indirection for forty lines of duplication).
//
// ---------------------------------------------------------------------------------------
// AND A NUMBER LIVES IN `data`, NEVER IN `message`. Every message this module emits is
// built by CONCATENATION from a constant operation name — never a template literal — so a
// source scan for `${` in a message argument is a valid guard everywhere, and
// `grep '"ms":'` over a log file always works.
import { performance } from 'node:perf_hooks';

/** First evidence of a hang within ten seconds; bounded at roughly ten minutes. */
export const HEARTBEAT_MS = 10_000;
export const HEARTBEAT_MAX = 60;

/**
 * How slow is slow, per main-process boundary, in milliseconds. Every number derived:
 *  - `modelResolve` 30 000 — anything longer is a DOWNLOAD, the thing we most want flagged.
 *  - `gpuProbe` 20 000 — `makeSpawnProbe` uses a 30 s per-probe timeout over `1 + n`
 *    probes, so over 20 s means at least one probe is hanging.
 *  - `llamaInit` 30 000 — binding the Vulkan/CUDA backend is seconds when it works.
 *  - `modelLoad` 60 000 — a 2.5 GB Q4_K_M load from warm cache is seconds; a minute means
 *    disk or VRAM trouble.
 *  - `contextCreate` 30 000 — allocates the KV cache; a minute means VRAM pressure.
 *  - `generate` 20 000 — 89 tok/s x 400 tokens is ~4.5 s healthy, 7.6 tok/s is ~53 s.
 *  - `windowLoad` 5 000 — `loadURL` against a LOCAL dev server; over 5 s means the URL is
 *    wrong or the server is not ours, which is G41's symptom exactly.
 */
export const THRESHOLDS = Object.freeze({
  modelResolve: 30_000,
  gpuProbe: 20_000,
  llamaInit: 30_000,
  modelLoad: 60_000,
  contextCreate: 30_000,
  generate: 20_000,
  windowLoad: 5_000,
  narratorLoad: 120_000,
});

/** Two decimals, and `-1` for an unmeasurable duration. Mirrors `src/log/timing.ts`. */
export function roundMs(ms) {
  if (!Number.isFinite(ms)) return -1;
  return Math.round(ms * 100) / 100;
}

/**
 * The level a completed operation is logged at. `okLevel` when healthy, `warn` at or over
 * the threshold — so a build running at `info` still captures every pathology without
 * writing debug spam. An UNMEASURABLE duration is `warn`: broken timing must not look
 * healthy.
 */
export function levelForMs(ms, threshold, okLevel = 'info') {
  if (!Number.isFinite(ms)) return 'warn';
  return ms >= threshold ? 'warn' : okLevel;
}

/**
 * @param log   `(level, category, message, data) => void` — the sink. Injected, so this
 *              module imports nothing from `electron`.
 * @param now   the clock. Injected, so a test scripts it and asserts EXACT integers.
 * @param setTimer/clearTimer  the heartbeat timer. Injected, so a test drives it by hand
 *              rather than waiting ten seconds.
 */
export function createInstrument({
  log = () => {},
  now = () => performance.now(),
  setTimer = setInterval,
  clearTimer = clearInterval,
  thresholds = THRESHOLDS,
  heartbeatMs = HEARTBEAT_MS,
  heartbeatMax = HEARTBEAT_MAX,
} = {}) {
  /**
   * Begin an operation. Emits `<name>: start` at `debug` and arms the heartbeat.
   * Returns `{ note, done, fail }` — and NEVER swallows anything: `fail` logs, and the
   * caller re-throws (`run` below does it for you, with the original error object).
   */
  function begin(category, name, data = {}, threshold = Infinity) {
    const t0 = now();
    let noted = {};
    let beats = 0;
    let stopped = false;

    log('debug', category, name + ': start', { ...data });

    const timer = setTimer(() => {
      // A stopped operation is silent, whatever the timer does. `clearTimer` is the
      // normal exit, but a tick already queued when the operation settled, or a timer
      // seam that ignores its clear, must not resurrect the heartbeat.
      if (stopped) return;
      beats += 1;
      if (beats > heartbeatMax) {
        log('warn', category, name + ': heartbeat suppressed', { ...data, ...noted, beats: beats - 1 });
        stop();
        return;
      }
      log('warn', category, name + ': STILL RUNNING', {
        ...data,
        ...noted,
        elapsedMs: roundMs(now() - t0),
        beat: beats,
      });
    }, heartbeatMs);
    // A live heartbeat must never hold the process open.
    if (timer && typeof timer.unref === 'function') timer.unref();

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimer(timer);
    }

    return {
      /** Record something the heartbeat and the end line should both carry. */
      note(extra) {
        noted = { ...noted, ...extra };
      },
      done(extra = {}) {
        stop();
        const ms = roundMs(now() - t0);
        log(levelForMs(ms, threshold), category, name + ': done', { ...data, ...noted, ...extra, ms });
        return ms;
      },
      fail(err, extra = {}) {
        stop();
        const ms = roundMs(now() - t0);
        log('error', category, name + ': FAILED', {
          ...data,
          ...noted,
          ...extra,
          ms,
          message: String(err?.message ?? err),
          stack: String(err?.stack ?? ''),
        });
        return ms;
      },
    };
  }

  /**
   * Wrap an async operation. Times it, heartbeats it, and on failure logs once and
   * RE-THROWS THE ORIGINAL ERROR — the instrument observes, it never intervenes
   * (PRINCIPLES.md §A18: measure without contaminating).
   */
  async function run(category, name, data, fn, threshold = Infinity) {
    const op = begin(category, name, data, threshold);
    try {
      const value = await fn(op);
      op.done();
      return value;
    } catch (err) {
      op.fail(err);
      throw err;
    }
  }

  return { begin, run, thresholds };
}
