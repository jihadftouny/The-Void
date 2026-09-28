// THE SEQUENCE QUEUE — one model call at a time on the context's single sequence
// (PLAN.md #11 part B; plan §5.3 decisions 1 and 2).
//
// ---------------------------------------------------------------------------------------
// THE FAILURE IT PREVENTS. The model context has ONE sequence. Every call takes it with
// `context.getSequence()` and gives it back with `sequence.dispose()`. A boss call arriving
// while a narration is still generating would ask for a second sequence the pool does not
// have, and node-llama-cpp throws "No sequences left" — the collision the old narrator already
// hit once. A second sequence would cost KV memory on a min-spec GPU nobody has measured; this
// FIFO removes the failure with no VRAM change at all.
//
// THE DEADLINE STARTS WHEN THE CALL STARTS RUNNING, not when it was queued. A narration in
// flight when a boss fight opens can hold the sequence for ~5 s; timed from the call, the first
// boss turn of every fight would fall back to the scripted policy whenever the player acted
// quickly after the reveal — and that first line is the one that sells the voice. Timed from
// dequeue, the player waits once, and `queuedMs` says so in the log.
//
// A DEADLINE RESOLVES THE CALLER BUT KEEPS THE SLOT. On expiry the caller gets
// `{ ok:false, reason:'timeout' }` immediately and `abort()` is called; the NEXT call still waits
// until the aborted one has actually finished, because until then it still holds the sequence
// and starting another would be the collision above.
//
// Pure logic over injected `now` and timers (the `narrator-gate.mjs` pattern), so a test drives
// it with a fake clock and asserts exact numbers.
// ---------------------------------------------------------------------------------------
import { performance } from 'node:perf_hooks';

/** A plain object gets the queue's timings merged in; anything else is returned as is. */
function withTimings(value, queuedMs, ranMs) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return { ...value, queuedMs, ranMs };
}

/**
 * @param now        the clock, injected so a test asserts exact integers.
 * @param setTimer   `(fn, ms) => handle` for the deadline — injected so a test fires it by hand.
 * @param clearTimer `(handle) => void`
 */
export function createSequenceQueue({
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let tail = Promise.resolve();
  let waiting = 0;
  let running = false;

  /**
   * Run `task({ signal, queuedMs })` after every earlier task has settled.
   *
   * Resolves with the task's value (a plain object gains `queuedMs` and `ranMs`), or — when
   * `deadlineMs` passes first — with `{ ok:false, reason:'timeout', timedOut:true, queuedMs,
   * ranMs }` after calling `abort()` and aborting `signal`. It never throws for a timeout. A task
   * that throws rejects ITS caller only; the queue moves on to the next task regardless.
   */
  function run(task, { deadlineMs = Infinity, abort } = {}) {
    const enqueuedAt = now();
    waiting += 1;
    const previous = tail;
    let release;
    tail = new Promise((r) => {
      release = r;
    });

    return new Promise((resolve, reject) => {
      previous.then(async () => {
        waiting -= 1;
        running = true;
        const startedAt = now();
        const queuedMs = startedAt - enqueuedAt;
        const controller = new AbortController();
        let settled = false;
        let timer = null;

        if (Number.isFinite(deadlineMs)) {
          timer = setTimer(() => {
            if (settled) return;
            settled = true;
            controller.abort();
            try {
              abort?.();
            } catch {
              // An abort that throws must not turn a timeout into a crash.
            }
            resolve({ ok: false, reason: 'timeout', timedOut: true, queuedMs, ranMs: now() - startedAt });
          }, deadlineMs);
        }

        try {
          const value = await task({ signal: controller.signal, queuedMs });
          if (!settled) {
            settled = true;
            resolve(withTimings(value, queuedMs, now() - startedAt));
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            reject(err);
          }
        } finally {
          if (timer !== null) clearTimer(timer);
          running = false;
          release();
        }
      });
    });
  }

  return {
    run,
    /** How many callers are waiting behind the one running (the running one is not counted). */
    depth: () => waiting,
    /** Whether a task holds the sequence right now. */
    busy: () => running,
  };
}
