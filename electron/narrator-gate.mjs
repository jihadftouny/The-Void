// THE NARRATOR GATE — FINDINGS.md G37, and the most likely cause of the freeze that
// created this unit.
//
// ---------------------------------------------------------------------------------------
// THE DEFECT, exactly. `main.mjs` used to read:
//
//     let narrator = null;
//     async function ensureNarrator(onStatus) {
//       if (!narrator) {
//         const modelsDir = resolveModelsDir();
//         narrator = await createNarrator({ onStatus, modelsDir });   // <-- assigns AFTER
//       }
//       return narrator;
//     }
//
// `narrator` is assigned only AFTER the await, so the guard is blind to an IN-FLIGHT load.
// `createWindow` fires this un-awaited at boot; the renderer's first `llm:generate` fires
// it again a few clicks later — well inside the load window — and both see `null`. The
// second caller therefore starts a SECOND COMPLETE LOAD: a second `resolveModelFile`
// (on first run, a second 2.5 GB download racing into the same directory), a second
// `selectGpuDevice` (which spawns `1 + n` child probes at a 30 s timeout EACH), a second
// `getLlama`, a second 2.5 GB `loadModel` (VRAM OOM on a min-spec GPU) and a second
// `createContext`. The loser's status callback ends up bound to a different model
// instance. Meanwhile the renderer holds `busy = true` around the whole dispatch, so
// EVERY INPUT IS DEAD until it returns.
//
// That is: a hang of tens of seconds, on the first narrated beat, which recovers on its
// own and never recurs (because the value IS set afterwards), and which is INDEPENDENT OF
// GPU SPEED — which is why the known CPU-slowness explanation did not apply to the
// reported incident. It matches every observable.
//
// THE FIX: memoise the PROMISE, not the resolved value, and null it on rejection so a
// failed load can be retried. The assignment happens SYNCHRONOUSLY, before any await, so
// there is no window in which a second caller can see "nothing in flight".
//
// WHY IT LIVES IN ITS OWN MODULE. `main.mjs` imports `electron` at module scope and can
// never be imported by a test, so a fix living there could only be checked by reading it.
// The gate is pure logic over an injected factory, so the defect can be asserted the only
// way that proves anything: TWO CALLERS RACING, with the factory counting constructions.
// A sequential test would pass against the broken code too.
// ---------------------------------------------------------------------------------------

/**
 * @param create  `(onStatus) => Promise<narrator>` — MUST be called synchronously.
 * @param log     `(level, category, message, data) => void`
 * @param now     the clock, injected so a test asserts exact integers.
 */
export function createNarratorGate({ create, log = () => {}, now = () => Date.now() } = {}) {
  let inFlight = null;
  let ready = null;
  let calls = 0;
  let constructions = 0;

  return {
    /** How many callers have asked. Every caller is logged; only the first constructs. */
    callCount: () => calls,
    /** How many times the factory was actually invoked. This is the G37 number. */
    constructionCount: () => constructions,
    /** True once a narrator has resolved — read BEFORE awaiting, to time the wait. */
    isReady: () => ready !== null,
    /** The resolved narrator, or `null`. Never triggers a load. */
    peek: () => ready,

    /**
     * Get the narrator, starting the load at most once. `trigger` is only ever `'boot'` or
     * `'generate'`, and it is what tells a log file WHICH caller paid for the load.
     */
    ensure(trigger, onStatus) {
      calls += 1;
      const call = calls;
      if (inFlight) {
        // The G37 path, now a no-op that SAYS SO. Before the fix this branch did not
        // exist and this caller started a whole second model load.
        log('debug', 'llm', 'narrator load: already in flight', { call, trigger });
        return inFlight;
      }
      const t0 = now();
      log('info', 'llm', 'narrator load: start', { call, trigger });
      constructions += 1;
      // ASSIGNED SYNCHRONOUSLY. This line, and the absence of an `await` before it, IS
      // the fix. Everything below only observes.
      const promise = create(onStatus);
      inFlight = promise;
      promise.then(
        (n) => {
          ready = n;
          log('info', 'llm', 'narrator load: done', {
            call,
            ms: now() - t0,
            gpu: n?.gpu ?? null,
            device: n?.device ?? null,
            unified: n?.unified ?? null,
            vramTotal: n?.vram?.total ?? null,
            deviceIndex: n?.deviceIndex ?? null,
          });
        },
        (err) => {
          // Null it so a failed load can be RETRIED. Without this, one transient failure
          // (a download interrupted, a GPU probe timing out) would wedge the narrator for
          // the whole session with no way back.
          if (inFlight === promise) inFlight = null;
          log('error', 'llm', 'narrator load: FAILED', {
            call,
            ms: now() - t0,
            message: String(err?.message ?? err),
            stack: String(err?.stack ?? ''),
          });
        },
      );
      return promise;
    },
  };
}
