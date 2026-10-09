// THE STRUCTURED CALL — one grammar-constrained generation on the local model
// (PLAN.md #11 part B; `docs/BOSS-PROMPTS.md` §1–§2).
//
// ---------------------------------------------------------------------------------------
// WHAT IT GUARANTEES. The model can only write the JSON shape the pure layer built
// (`src/llm/bossSchema.ts`): node-llama-cpp compiles the schema into a grammar, and a token
// the grammar forbids can never be sampled. The legal move ids ARE the schema's enum, so an
// illegal move is not rejected afterwards — it is impossible to write.
//
// WHY ITS OWN MODULE. `llm.mjs` imports node-llama-cpp at module scope and cannot be loaded by
// a test. Everything here runs over INJECTED `llama`, `context`, `model` and
// `LlamaChatSession`, so the whole call — options passed, grammar cache, disposal on every
// exit, timings — is tested against fakes. The real-model evaluation script
// (`scripts/boss-eval.ts`) imports this same function, so what it measures is the shipped path.
//
// WHAT IT NEVER DOES: throw. Every exit returns a result object — `{ ok:true, ... }`, a timeout,
// or `{ ok:false, reason:'error', message }` after logging — so the IPC handler has one branch.
//
// A TIMED-OUT CALL IS A FALLBACK EVEN WITH TEXT. `stopOnAbortSignal: true` makes an aborted
// generation return its partial text instead of throwing; `timedOut` wins over that text, so a
// half-line is never shown (plan §5.3 decision 4).
//
// RECORDED DEVIATION (`instrument.mjs` header): `performance.now()` is the default clock here —
// allowed in `electron/`, the main-process edge, and injected so a test asserts exact numbers.
// ---------------------------------------------------------------------------------------
import { performance } from 'node:perf_hooks';

/** A compiled grammar per distinct schema, at most this many kept. */
export const GRAMMAR_CACHE_MAX = 32;

/**
 * node-llama-cpp's light default, stated explicitly (plan §5.3 decision 6). Grammar tokens
 * (`{`, `"move"`) are few, so the mild penalty cannot push the model off the grammar; the eval's
 * legal-move rate (which must be 100%) is the check.
 */
export const REPEAT_PENALTY = Object.freeze({ lastTokens: 64, penalty: 1.1 });

/**
 * A bounded, least-recently-used cache of compiled grammars, keyed by `JSON.stringify(schema)`.
 * The PROMISE is cached, so two calls for the same schema never compile twice; a compile that
 * fails is evicted so the next call can try again.
 */
export function createGrammarCache({ max = GRAMMAR_CACHE_MAX } = {}) {
  const entries = new Map();
  let compiles = 0;
  return {
    /** `{ grammar: Promise<LlamaGrammar>, cached }` for this schema. */
    get(llama, schema) {
      const key = JSON.stringify(schema);
      const hit = entries.get(key);
      if (hit) {
        entries.delete(key);
        entries.set(key, hit);
        return { grammar: hit, cached: true };
      }
      compiles += 1;
      const pending = Promise.resolve().then(() => llama.createGrammarForJsonSchema(schema));
      entries.set(key, pending);
      pending.catch(() => {
        if (entries.get(key) === pending) entries.delete(key);
      });
      while (entries.size > max) entries.delete(entries.keys().next().value);
      return { grammar: pending, cached: false };
    },
    size: () => entries.size,
    compileCount: () => compiles,
  };
}

/** Dispose one thing; a failing dispose is logged, never allowed to replace the result. */
function disposeQuietly(thing, what, log, data) {
  if (!thing) return;
  try {
    thing.dispose();
  } catch (err) {
    log('warn', 'boss', 'structured: dispose failed', { ...data, what, message: String(err?.message ?? err) });
  }
}

/**
 * Run one grammar-constrained call.
 *
 * @param deps   `{ llama, context, model, LlamaChatSession, now?, log? }` — all injected.
 * @param req    a `BossIpcRequest`: `{ requestId, kind, persona, system, prompt, schema, settings }`.
 * @param opts   `{ signal, cache }` — the queue's abort signal, and the grammar cache to use.
 * @returns `{ ok, text, timedOut, tokens, promptTokens, ttftMs, generateMs, grammarMs }`, or
 *          `{ ok:false, reason:'timeout'|'error', ... }`. Never throws.
 */
export async function runStructured(deps, req, { signal, cache } = {}) {
  const { llama, context, model, LlamaChatSession, now = () => performance.now(), log = () => {} } = deps ?? {};
  const settings = req?.settings ?? {};
  const where = { requestId: req?.requestId ?? null, kind: req?.kind ?? null, persona: req?.persona ?? null };
  const grammars = cache ?? createGrammarCache();
  let sequence = null;
  let session = null;
  const t0 = now();
  let grammarMs = 0;
  let g0 = null;

  const timedOutResult = (extra = {}) => ({
    ok: false,
    reason: 'timeout',
    timedOut: true,
    grammarMs,
    generateMs: g0 === null ? 0 : now() - g0,
    ...extra,
  });

  try {
    const grammar = await grammars.get(llama, req.schema).grammar;
    grammarMs = now() - t0;
    if (signal?.aborted) return timedOutResult();

    sequence = context.getSequence();
    session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: req.system });

    let firstAt = null;
    const options = {
      grammar,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      topP: settings.topP,
      repeatPenalty: { ...REPEAT_PENALTY },
      signal,
      stopOnAbortSignal: true,
      onTextChunk() {
        if (firstAt === null) firstAt = now();
      },
    };
    if (settings.seed !== undefined) options.seed = settings.seed;

    g0 = now();
    const text = await session.prompt(req.prompt, options);
    const generateMs = now() - g0;
    const ttftMs = firstAt === null ? generateMs : firstAt - g0;
    const tokens = model.tokenize(text).length;
    // The prompt as the model really saw it — chat template included — is what is left in the
    // sequence once the answer's own tokens are taken away. Falls back to the raw text's count.
    const inContext = Array.isArray(sequence.contextTokens) ? sequence.contextTokens.length : null;
    const promptTokens =
      inContext !== null ? Math.max(0, inContext - tokens) : model.tokenize(`${req.system}\n${req.prompt}`).length;

    if (signal?.aborted) return timedOutResult({ text, tokens, promptTokens, ttftMs, generateMs });
    return { ok: true, text, timedOut: false, tokens, promptTokens, ttftMs, generateMs, grammarMs };
  } catch (err) {
    // An abort that lands before any text exists throws even with `stopOnAbortSignal` — that is
    // still the deadline, not a failure.
    if (signal?.aborted) return timedOutResult({ message: String(err?.message ?? err) });
    const message = String(err?.message ?? err);
    log('error', 'boss', 'structured: FAILED', {
      ...where,
      grammarMs,
      elapsedMs: now() - t0,
      message,
      stack: String(err?.stack ?? ''),
    });
    return { ok: false, reason: 'error', message };
  } finally {
    disposeQuietly(session, 'session', log, where);
    disposeQuietly(sequence, 'sequence', log, where);
  }
}
