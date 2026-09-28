// The structured call core (AC-14), against fakes for node-llama-cpp. NEVER the real model:
// `llama`, `context`, `model` and `LlamaChatSession` are all hand-built here, and the clock is
// scripted so every duration is an exact number.
import { describe, it, expect, vi } from 'vitest';
import { GRAMMAR_CACHE_MAX, REPEAT_PENALTY, createGrammarCache, runStructured } from './structured.mjs';

/** A scripted fake of the four node-llama-cpp objects runStructured touches. */
function fakes({ prompt, contextTokens = 900 } = {}) {
  let t = 1000;
  const clock = {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
  const disposed = [];
  const sessions = [];
  const llama = {
    createGrammarForJsonSchema: vi.fn(async (schema) => ({ compiledFrom: schema })),
  };
  const context = {
    getSequence: vi.fn(() => ({
      contextTokens: Array.from({ length: contextTokens }, (_, i) => i),
      dispose: () => disposed.push('sequence'),
    })),
  };
  const model = { tokenize: (text) => text.split(' ').filter(Boolean) };
  class LlamaChatSession {
    constructor(options) {
      this.options = options;
      this.promptCalls = [];
      sessions.push(this);
    }
    async prompt(text, options) {
      this.promptCalls.push({ text, options });
      return prompt ? prompt(options, clock) : '{"move":"strike","line":"Come here."}';
    }
    dispose() {
      disposed.push('session');
    }
  }
  const log = vi.fn();
  return { deps: { llama, context, model, LlamaChatSession, now: clock.now, log }, clock, disposed, sessions, llama, log };
}

const REQ = {
  requestId: 4,
  kind: 'turn',
  persona: 'kingpin',
  system: 'You are the Kingpin.',
  prompt: 'WHO YOU ARE FACING: an Enforcer.',
  schema: { type: 'object', properties: { move: { enum: ['strike', 'hold_back'] } } },
  settings: { temperature: 0.8, maxTokens: 80, deadlineMs: 3000, topP: 0.9 },
};

describe('runStructured passes the call exactly as the settings say', () => {
  it('grammar, temperature, maxTokens, topP, repeatPenalty, signal, stopOnAbortSignal — and no seed when none is set', async () => {
    const f = fakes();
    const signal = new AbortController().signal;
    await runStructured(f.deps, REQ, { signal });
    const [session] = f.sessions;
    expect(session.options.systemPrompt).toBe('You are the Kingpin.');
    expect(session.options.contextSequence).toBeDefined();
    const { text, options } = session.promptCalls[0];
    expect(text).toBe('WHO YOU ARE FACING: an Enforcer.');
    expect(options.grammar).toEqual({ compiledFrom: REQ.schema });
    expect(options.temperature).toBe(0.8);
    expect(options.maxTokens).toBe(80);
    expect(options.topP).toBe(0.9);
    expect(options.repeatPenalty).toEqual({ lastTokens: 64, penalty: 1.1 });
    expect(REPEAT_PENALTY).toEqual({ lastTokens: 64, penalty: 1.1 });
    expect(options.signal).toBe(signal);
    expect(options.stopOnAbortSignal).toBe(true);
    expect('seed' in options).toBe(false);
  });

  it('passes the seed when the settings pin one (the Hollow Self\'s judge)', async () => {
    const f = fakes();
    await runStructured(f.deps, { ...REQ, settings: { ...REQ.settings, temperature: 0.2, seed: 1 } }, {});
    const { options } = f.sessions[0].promptCalls[0];
    expect(options.seed).toBe(1);
    expect(options.temperature).toBe(0.2);
  });
});

describe('runStructured returns every timing, measured', () => {
  it('grammarMs, ttftMs, generateMs, tokens and promptTokens', async () => {
    const f = fakes({
      contextTokens: 812,
      prompt: (options, clock) => {
        clock.advance(300); // prefill: the first chunk arrives 300 ms in
        options.onTextChunk('{"move"');
        clock.advance(450);
        return '{"move": "strike", "line": "Mind the water."}';
      },
    });
    // The grammar compile takes 25 ms on the scripted clock.
    f.llama.createGrammarForJsonSchema.mockImplementation(async (schema) => {
      f.clock.advance(25);
      return { compiledFrom: schema };
    });
    const r = await runStructured(f.deps, REQ, {});
    // The answer text has 6 space-separated pieces under the fake tokenizer
    // ({"move": · "strike", · "line": · "Mind · the · water."}); 812 − 6 = 806.
    expect(r).toEqual({
      ok: true,
      text: '{"move": "strike", "line": "Mind the water."}',
      timedOut: false,
      tokens: 6,
      promptTokens: 806,
      ttftMs: 300,
      generateMs: 750,
      grammarMs: 25,
    });
  });
});

describe('runStructured disposes the session AND the sequence on every exit', () => {
  it('on success', async () => {
    const f = fakes();
    await runStructured(f.deps, REQ, {});
    expect(f.disposed.sort()).toEqual(['sequence', 'session']);
  });

  it('on failure — and returns an error result after logging, never throwing', async () => {
    const f = fakes({
      prompt: () => {
        throw new Error('context overflow');
      },
    });
    const r = await runStructured(f.deps, REQ, {});
    expect(r).toEqual({ ok: false, reason: 'error', message: 'context overflow' });
    expect(f.disposed.sort()).toEqual(['sequence', 'session']);
    expect(f.log).toHaveBeenCalledTimes(1);
    const [level, category, message, data] = f.log.mock.calls[0];
    expect([level, category, message]).toEqual(['error', 'boss', 'structured: FAILED']);
    expect(data).toMatchObject({ requestId: 4, kind: 'turn', persona: 'kingpin', message: 'context overflow' });
  });

  it('on timeout — partial text is returned, but the call is a timeout (a half-line is never shown)', async () => {
    const controller = new AbortController();
    const f = fakes({
      prompt: (options, clock) => {
        options.onTextChunk('{"move":"strike","line":"Mind');
        clock.advance(3000);
        controller.abort();
        return '{"move":"strike","line":"Mind';
      },
    });
    const r = await runStructured(f.deps, REQ, { signal: controller.signal });
    expect(r).toMatchObject({ ok: false, reason: 'timeout', timedOut: true, generateMs: 3000 });
    expect(f.disposed.sort()).toEqual(['sequence', 'session']);
    expect(f.log).not.toHaveBeenCalled();
  });

  it('on an abort that throws before any text — still a timeout, not an error', async () => {
    const controller = new AbortController();
    const f = fakes({
      prompt: () => {
        controller.abort();
        throw new Error('aborted');
      },
    });
    const r = await runStructured(f.deps, REQ, { signal: controller.signal });
    expect(r).toMatchObject({ ok: false, reason: 'timeout', timedOut: true });
    expect(f.disposed.sort()).toEqual(['sequence', 'session']);
  });

  it('a signal already aborted before the sequence is taken never takes it', async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fakes();
    const r = await runStructured(f.deps, REQ, { signal: controller.signal });
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
    expect(f.deps.context.getSequence).not.toHaveBeenCalled();
  });

  it('a dispose that throws is logged and does not replace the result', async () => {
    const f = fakes();
    f.deps.context.getSequence = () => ({
      contextTokens: [],
      dispose: () => {
        throw new Error('already disposed');
      },
    });
    const r = await runStructured(f.deps, REQ, {});
    expect(r.ok).toBe(true);
    expect(f.log.mock.calls.map((c) => c[2])).toEqual(['structured: dispose failed']);
  });
});

describe('the grammar cache', () => {
  it('compiles once per distinct schema, keyed by JSON.stringify', async () => {
    const f = fakes();
    const cache = createGrammarCache();
    await runStructured(f.deps, REQ, { cache });
    await runStructured(f.deps, REQ, { cache });
    await runStructured(f.deps, { ...REQ, schema: JSON.parse(JSON.stringify(REQ.schema)) }, { cache });
    expect(f.llama.createGrammarForJsonSchema).toHaveBeenCalledTimes(1);
    await runStructured(f.deps, { ...REQ, schema: { type: 'object', properties: { line: { type: 'string', maxLength: 320 } } } }, { cache });
    expect(f.llama.createGrammarForJsonSchema).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(2);
  });

  it('is bounded at 32 entries, dropping the least recently used', async () => {
    expect(GRAMMAR_CACHE_MAX).toBe(32);
    const llama = { createGrammarForJsonSchema: vi.fn(async (s) => s) };
    const cache = createGrammarCache();
    const schema = (i) => ({ enum: [`m${i}`] });
    for (let i = 0; i < 33; i += 1) await cache.get(llama, schema(i)).grammar;
    expect(cache.size()).toBe(32);
    expect(llama.createGrammarForJsonSchema).toHaveBeenCalledTimes(33);
    // The first schema was evicted: asking again compiles again. The last is still cached.
    expect(cache.get(llama, schema(32)).cached).toBe(true);
    const again = cache.get(llama, schema(0));
    expect(again.cached).toBe(false);
    await again.grammar;
    expect(llama.createGrammarForJsonSchema).toHaveBeenCalledTimes(34);
    expect(cache.size()).toBe(32);
  });

  it('a compile that fails is evicted, so the next call can try again — and the call reports an error', async () => {
    const f = fakes();
    f.llama.createGrammarForJsonSchema.mockRejectedValueOnce(new Error('bad schema'));
    const cache = createGrammarCache();
    const r = await runStructured(f.deps, REQ, { cache });
    expect(r).toEqual({ ok: false, reason: 'error', message: 'bad schema' });
    expect(f.deps.context.getSequence).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(cache.size()).toBe(0);
    const again = await runStructured(f.deps, REQ, { cache });
    expect(again.ok).toBe(true);
  });
});
