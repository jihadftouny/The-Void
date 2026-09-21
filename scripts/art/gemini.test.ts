// THE TRANSPORT, AGAINST A FAKE NETWORK. (AC-14, AC-28, AC-29, and the transport half of AC-25.)
//
// NO TEST HERE OPENS A SOCKET. `fetch` is a parameter, and every test passes a function that
// returns canned text. There is no fallback to a real `fetch` anywhere in `gemini.ts` — a caller
// that supplies none cannot make it send anything — so "this test did not accidentally hit the
// network" is true by construction rather than by configuration.
//
// The canned payloads are written from the v1beta REST reference's documented shapes. They are
// FIXTURES, not recordings: nothing in this repository has ever made a real call.

import { describe, it, expect } from 'vitest';
import {
  assertBatchFits,
  buildBatchBody,
  buildPollUrl,
  buildUrl,
  createBatchProvider,
  createInteractiveProvider,
  GeminiHttpError,
  INLINE_BATCH_MAX_BYTES,
  parseInlinedResponses,
  type FetchInit,
  type FetchLike,
  type ImageRequest,
  type TransportDeps,
  type TransportOptions,
} from './gemini.ts';
import { createSecret, KEY_HEADER } from './secret.ts';
import { Logger, createRingBuffer, type LogEntry } from '../../src/log/logger.ts';

const FAKE_KEY = 'AIzaFAKEfakeFAKEnotARealKey000000000000';

/** The 8-byte PNG signature, base64 `iVBORw0KGgo=` — worked out by hand in catalogue.test.ts. */
const PNG_SIGNATURE_B64 = 'iVBORw0KGgo=';
const PNG_SIGNATURE_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const OPTIONS: TransportOptions = {
  model: 'gemini-3-pro-image',
  pollIntervalMs: 500,
  maxWaitMs: 1000,
  displayName: 'the-void-art',
};

interface Call {
  url: string;
  init: FetchInit;
}

interface Harness {
  deps: TransportDeps;
  calls: Call[];
  entries: () => LogEntry[];
  clock: () => number;
}

/**
 * A transport wired to canned responses.
 *
 * `script` is consulted per call with the call index, so a batch test can return a submit
 * envelope first and then a sequence of poll states.
 */
function harness(script: (n: number) => { status?: number; body: unknown }): Harness {
  const calls: Call[] = [];
  let t = 0;
  const ring = createRingBuffer(200);
  const log = new Logger();
  log.addSink(ring.sink);

  const fetchLike: FetchLike = async (url, init) => {
    const n = calls.length;
    calls.push({ url, init });
    const { status = 200, body } = script(n);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };

  return {
    calls,
    entries: ring.get,
    clock: () => t,
    deps: {
      fetch: fetchLike,
      sleep: async (ms: number) => {
        t += ms;
      },
      now: () => t,
      log,
      secret: createSecret(FAKE_KEY),
    },
  };
}

function request(id: string, assetId = 'enemy-gangers', take = 1): ImageRequest {
  return {
    id,
    assetId,
    take,
    body: {
      contents: [{ role: 'user', parts: [{ text: 'a prompt' }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        temperature: 1,
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
      },
    },
  };
}

const imageResponse = (b64 = PNG_SIGNATURE_B64) => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }] } }],
});

/** A batch operation in a given state, optionally carrying results. */
function operation(state: string, inlinedResponses?: unknown[]): unknown {
  return {
    name: 'batches/abc123',
    metadata: { state },
    ...(inlinedResponses === undefined
      ? { done: false }
      : { done: true, response: { inlinedResponses: { inlinedResponses } } }),
  };
}

// =========================================================================================
// URLs
// =========================================================================================

describe('URLs carry no credentials (AC-14)', () => {
  it('are the documented v1beta paths, with no query string at all', () => {
    expect(buildUrl('gemini-3-pro-image', 'batchGenerateContent')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:batchGenerateContent',
    );
    expect(buildUrl('gemini-3-pro-image', 'generateContent')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
    );
    expect(buildPollUrl('batches/abc123')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/batches/abc123',
    );
    for (const url of [
      buildUrl('m', 'generateContent'),
      buildUrl('m', 'batchGenerateContent'),
      buildPollUrl('batches/x'),
    ]) {
      expect(url).not.toContain('?');
      expect(url).not.toContain('key=');
    }
  });
});

// =========================================================================================
// AC-14 — the key is in the header and nowhere else
// =========================================================================================

describe('the key reaches the wire only as x-goog-api-key (AC-14)', () => {
  it('batch: every call carries it in the header, and no URL or body contains it', async () => {
    const h = harness((n) =>
      n === 0
        ? { body: { name: 'batches/abc123' } }
        : { body: operation('BATCH_STATE_SUCCEEDED', [
            { metadata: { key: 'a-r1-t1' }, response: imageResponse() },
          ]) },
    );
    await createBatchProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]);

    expect(h.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of h.calls) {
      // NEGATIVE CONTROL, inline: the key IS somewhere in this call, so the assertions below are
      // demonstrably capable of finding it.
      expect(call.init.headers[KEY_HEADER]).toBe(FAKE_KEY);
      expect(call.url).not.toContain(FAKE_KEY);
      expect(call.init.body ?? '').not.toContain(FAKE_KEY);
      expect(JSON.stringify(call.init.headers)).toContain(FAKE_KEY); // header only
      expect(call.url + (call.init.body ?? '')).not.toContain(FAKE_KEY);
    }
  });

  it('interactive: same', async () => {
    const h = harness(() => ({ body: imageResponse() }));
    await createInteractiveProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]);
    for (const call of h.calls) {
      expect(call.init.headers[KEY_HEADER]).toBe(FAKE_KEY);
      expect(call.url).not.toContain(FAKE_KEY);
      expect(call.init.body ?? '').not.toContain(FAKE_KEY);
    }
  });

  it('an HTTP error that echoes the key back is redacted before it becomes a message', async () => {
    // Real APIs echo the offending request. This is the exact shape that would otherwise put a
    // live key into a stack trace, a terminal scrollback and a pasted bug report.
    const h = harness(() => ({
      status: 400,
      body: { error: { code: 400, message: `API key not valid: ${FAKE_KEY}`, status: 'INVALID_ARGUMENT' } },
    }));

    let message = '';
    try {
      await createBatchProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('Gemini HTTP 400');
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(FAKE_KEY);
  });

  it('no log entry from a failing interactive request contains the key', async () => {
    const h = harness(() => ({ status: 500, body: `server error, key was ${FAKE_KEY}` }));
    await createInteractiveProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]);

    const serialised = JSON.stringify(h.entries());
    expect(serialised).not.toContain(FAKE_KEY);
    expect(serialised).toContain('[redacted]');
  });
});

// =========================================================================================
// AC-28 — batch submit, poll, parse
// =========================================================================================

describe('the batch lifecycle (AC-28)', () => {
  it('submits once, polls through PENDING and RUNNING, and parses SUCCEEDED', async () => {
    const states = ['BATCH_STATE_PENDING', 'BATCH_STATE_RUNNING'];
    const h = harness((n) => {
      if (n === 0) return { body: { name: 'batches/abc123' } };
      const state = states[n - 1];
      if (state !== undefined) return { body: operation(state) };
      return {
        body: operation('BATCH_STATE_SUCCEEDED', [
          { metadata: { key: 'a-r1-t1' }, response: imageResponse() },
          {
            metadata: { key: 'a-r1-t2' },
            error: { code: 500, message: 'model overloaded', status: 'UNAVAILABLE' },
          },
        ]),
      };
    });

    const seen: { handle: string; callsAtThatMoment: number }[] = [];
    const results = await createBatchProvider(h.deps, OPTIONS).generate(
      [request('a-r1-t1'), request('a-r1-t2', 'enemy-gangers', 2)],
      {
        onSubmitted: async (handle) => {
          seen.push({ handle, callsAtThatMoment: h.calls.length });
        },
      },
    );

    // One submit + three polls (PENDING, RUNNING, SUCCEEDED).
    expect(h.calls.length).toBe(4);
    expect(h.calls[0]?.init.method).toBe('POST');
    expect(h.calls[0]?.url).toContain(':batchGenerateContent');
    expect(h.calls[1]?.init.method).toBe('GET');
    expect(h.calls[1]?.url).toBe(buildPollUrl('batches/abc123'));

    // AC-26's transport half: the handle is known, and handed over, BEFORE any poll happens.
    expect(seen).toEqual([{ handle: 'batches/abc123', callsAtThatMoment: 1 }]);

    expect(results).toEqual([
      { id: 'a-r1-t1', ok: true, mimeType: 'image/jpeg', bytes: new Uint8Array(PNG_SIGNATURE_BYTES) },
      { id: 'a-r1-t2', ok: false, error: 'UNAVAILABLE: model overloaded' },
    ]);
  });

  it('logs every poll with its state and elapsed milliseconds (AC-37)', async () => {
    const h = harness((n) =>
      n === 0
        ? { body: { name: 'batches/abc123' } }
        : n === 1
          ? { body: operation('BATCH_STATE_PENDING') }
          : { body: operation('BATCH_STATE_SUCCEEDED', []) },
    );
    await createBatchProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]);

    const polls = h.entries().filter((e) => e.category === 'art.poll');
    expect(polls.length).toBe(2);
    // elapsed advances by exactly one poll interval, because `sleep` is the only clock motion.
    expect(polls.map((e) => (e.data as { elapsedMs: number }).elapsedMs)).toEqual([0, 500]);
    expect((polls[0]?.data as { state: string }).state).toBe('BATCH_STATE_PENDING');

    const submits = h.entries().filter((e) => e.category === 'art.submit');
    expect(submits.length).toBe(1);
    expect(typeof (submits[0]?.data as { durationMs: number }).durationMs).toBe('number');
    expect((submits[0]?.data as { requests: number }).requests).toBe(1);
  });

  for (const state of ['BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED']) {
    it(`throws on ${state}, and logs before it throws`, async () => {
      const h = harness((n) =>
        n === 0 ? { body: { name: 'batches/abc123' } } : { body: operation(state) },
      );
      await expect(
        createBatchProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]),
      ).rejects.toThrow(new RegExp(`batches/abc123 ended in ${state}`));

      expect(h.entries().some((e) => e.category === 'art.error' && e.level === 'error')).toBe(true);
    });
  }

  it('gives up at the deadline with the HANDLE in the message, so the run can be resumed', async () => {
    // maxWaitMs 1000, pollIntervalMs 500, and the clock only moves when `sleep` is called:
    //   poll 1 at elapsed 0    -> 0 + 500 = 500 is not > 1000 -> sleep
    //   poll 2 at elapsed 500  -> 500 + 500 = 1000 is not > 1000 -> sleep
    //   poll 3 at elapsed 1000 -> 1000 + 500 = 1500 > 1000 -> give up
    //
    // The fake is BOUNDED at four calls on purpose. A job that never finishes is the only way to
    // test a deadline, so without the bound a missing deadline is an infinite loop: the guard
    // still "fails", but by spinning until V8 runs out of memory and killing the worker, which
    // reports as a crash rather than as a red test. Refusing the fifth call turns that into an
    // immediate, legible failure that names the cause.
    const ALLOWED_CALLS = 4; // 1 submit + 3 polls
    const h = harness((n) => {
      if (n >= ALLOWED_CALLS) {
        throw new Error(
          `the transport polled ${n + 1} times; the deadline (maxWaitMs) should have stopped it at ${ALLOWED_CALLS}`,
        );
      }
      return n === 0
        ? { body: { name: 'batches/abc123' } }
        : { body: operation('BATCH_STATE_RUNNING') };
    });

    let message = '';
    try {
      await createBatchProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(h.calls.length).toBe(4); // submit + 3 polls
    expect(message).toContain('batches/abc123');
    expect(message).toContain('--resume');
    expect(message).toContain('already billed');
  });

  it('a 429 says billing, because image generation is not on the free tier at all (§1)', async () => {
    const h = harness(() => ({ status: 429, body: { error: { message: 'Quota exceeded' } } }));
    await expect(
      createBatchProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]),
    ).rejects.toThrow(/billing must be enabled/);
  });

  it('refuses a submit that returns no operation name to poll', async () => {
    const h = harness(() => ({ body: { note: 'accepted' } }));
    await expect(
      createBatchProvider(h.deps, OPTIONS).generate([request('a-r1-t1')]),
    ).rejects.toThrow(/no operation name to poll/);
  });

  it('sends nothing at all for an empty request list', async () => {
    const h = harness(() => ({ body: {} }));
    expect(await createBatchProvider(h.deps, OPTIONS).generate([])).toEqual([]);
    expect(h.calls.length).toBe(0);
  });

  it('resume polls an existing handle without submitting anything', async () => {
    const h = harness(() => ({
      body: operation('BATCH_STATE_SUCCEEDED', [
        { metadata: { key: 'a-r1-t1' }, response: imageResponse() },
      ]),
    }));
    const results = await createBatchProvider(h.deps, OPTIONS).resume('batches/old');

    expect(h.calls.length).toBe(1);
    expect(h.calls[0]?.init.method).toBe('GET');
    expect(h.calls[0]?.url).toBe(buildPollUrl('batches/old'));
    expect(results[0]).toMatchObject({ id: 'a-r1-t1', ok: true });
  });
});

describe('parsing inlined responses (AC-28)', () => {
  const reqs = [request('a-r1-t1'), request('a-r1-t2', 'x', 2)];
  const identity = (t: string): string => t;

  it('matches results to requests by metadata.key, whatever order they arrive in', () => {
    const op = operation('BATCH_STATE_SUCCEEDED', [
      { metadata: { key: 'a-r1-t2' }, response: imageResponse() },
      { metadata: { key: 'a-r1-t1' }, response: imageResponse() },
    ]);
    expect(parseInlinedResponses(op, reqs, identity).map((r) => r.id)).toEqual([
      'a-r1-t2',
      'a-r1-t1',
    ]);
  });

  it('falls back to the array index when metadata is missing', () => {
    // Without the fallback an API that stopped echoing metadata would silently drop every image
    // in a batch that had already been paid for.
    const op = operation('BATCH_STATE_SUCCEEDED', [
      { response: imageResponse() },
      { response: imageResponse() },
    ]);
    expect(parseInlinedResponses(op, reqs, identity).map((r) => r.id)).toEqual([
      'a-r1-t1',
      'a-r1-t2',
    ]);
  });

  it('decodes the base64 image payload to bytes', () => {
    const op = operation('BATCH_STATE_SUCCEEDED', [
      { metadata: { key: 'a-r1-t1' }, response: imageResponse() },
    ]);
    const result = parseInlinedResponses(op, reqs, identity)[0];
    expect(result?.ok).toBe(true);
    expect(result?.ok === true && Array.from(result.bytes)).toEqual(PNG_SIGNATURE_BYTES);
  });

  it('reports a response that carried no image as an error, not as a success', () => {
    const op = operation('BATCH_STATE_SUCCEEDED', [
      { metadata: { key: 'a-r1-t1' }, response: { candidates: [{ content: { parts: [{ text: 'sorry' }] } }] } },
    ]);
    expect(parseInlinedResponses(op, reqs, identity)[0]).toEqual({
      id: 'a-r1-t1',
      ok: false,
      error: 'response carried no inline image data',
    });
  });

  it('redacts error text through the supplied redactor', () => {
    const op = operation('BATCH_STATE_SUCCEEDED', [
      { metadata: { key: 'a-r1-t1' }, error: { message: `bad key ${FAKE_KEY}`, status: 'PERMISSION_DENIED' } },
    ]);
    const redact = (t: string): string => t.split(FAKE_KEY).join('[redacted]');
    const result = parseInlinedResponses(op, reqs, redact)[0];
    expect(result?.ok === false && result.error).toBe('PERMISSION_DENIED: bad key [redacted]');
  });

  it('throws when a succeeded operation carries no inlinedResponses at all', () => {
    expect(() => parseInlinedResponses({ done: true, response: {} }, reqs, identity)).toThrow(
      /carried no inlinedResponses/,
    );
  });
});

// =========================================================================================
// AC-29 — the body-size guard
// =========================================================================================

describe('the inline batch size guard (AC-29)', () => {
  it('is 20 MiB', () => {
    expect(INLINE_BATCH_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(INLINE_BATCH_MAX_BYTES).toBe(20_971_520); // 20 x 1024 x 1024, by hand
  });

  it('accepts exactly the limit and refuses one byte more', () => {
    expect(() => assertBatchFits(INLINE_BATCH_MAX_BYTES, 9)).not.toThrow();
    expect(() => assertBatchFits(INLINE_BATCH_MAX_BYTES + 1, 9)).toThrow(/over the 20 MiB/);
  });

  it('names the size, the request count, and both remedies', () => {
    let message = '';
    try {
      assertBatchFits(22 * 1024 * 1024, 30);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('22.0 MiB');
    expect(message).toContain('30 requests');
    expect(message).toContain('Nothing was sent');
    expect(message).toContain('--stage');
    expect(message).toContain('reference');
  });

  it('refuses BEFORE any network call is made', async () => {
    const h = harness(() => ({ body: { name: 'batches/abc123' } }));
    const oversized = request('a-r1-t1');
    // One 21 MiB inline reference: over the limit on its own, which is the realistic cause —
    // the reference is base64 in EVERY request in the batch.
    oversized.body.contents[0]!.parts.push({
      inlineData: { mimeType: 'image/png', data: 'A'.repeat(21 * 1024 * 1024) },
    });

    await expect(createBatchProvider(h.deps, OPTIONS).generate([oversized])).rejects.toThrow(
      /over the 20 MiB inline limit/,
    );
    expect(h.calls.length).toBe(0);
  });
});

describe('the batch request body', () => {
  it('nests requests the way the v1beta reference documents, with a correlation id', () => {
    const body = buildBatchBody([request('a-r1-t1')], 'the-void-art') as {
      batch: {
        displayName: string;
        inputConfig: { requests: { requests: { request: unknown; metadata: { key: string } }[] } };
      };
    };
    expect(body.batch.displayName).toBe('the-void-art');
    const inner = body.batch.inputConfig.requests.requests;
    expect(inner.length).toBe(1);
    expect(inner[0]?.metadata).toEqual({ key: 'a-r1-t1' });
    expect(inner[0]?.request).toEqual(request('a-r1-t1').body);
  });
});

// =========================================================================================
// Interactive (AC-25's transport half)
// =========================================================================================

describe('the interactive provider (AC-25)', () => {
  it('POSTs :generateContent once per request', async () => {
    const h = harness(() => ({ body: imageResponse() }));
    const results = await createInteractiveProvider(h.deps, OPTIONS).generate([
      request('a-r1-t1'),
      request('a-r1-t2', 'enemy-gangers', 2),
      request('a-r1-t3', 'enemy-gangers', 3),
    ]);

    expect(h.calls.length).toBe(3);
    for (const call of h.calls) {
      expect(call.url).toBe(buildUrl('gemini-3-pro-image', 'generateContent'));
      expect(call.init.method).toBe('POST');
    }
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('issues the three takes CONCURRENTLY, not one after another (§1)', async () => {
    // §1: "3 per asset, generated concurrently within an asset". Every request must be in flight
    // before any of them resolves, which is only observable with a response that is held open.
    const calls: Call[] = [];
    const release: (() => void)[] = [];
    const fetchLike: FetchLike = (url, init) => {
      calls.push({ url, init });
      return new Promise((resolve) => {
        release.push(() =>
          resolve({ ok: true, status: 200, text: async () => JSON.stringify(imageResponse()) }),
        );
      });
    };

    const h = harness(() => ({ body: {} }));
    const provider = createInteractiveProvider({ ...h.deps, fetch: fetchLike }, OPTIONS);
    const pending = provider.generate([
      request('t1'),
      request('t2', 'a', 2),
      request('t3', 'a', 3),
    ]);

    await Promise.resolve();
    expect(calls.length).toBe(3); // all three in flight, none resolved
    for (const fn of release) fn();
    expect((await pending).length).toBe(3);
  });

  it('turns a per-request failure into a result instead of losing the whole call', async () => {
    const h = harness((n) => (n === 1 ? { status: 503, body: 'overloaded' } : { body: imageResponse() }));
    const results = await createInteractiveProvider(h.deps, OPTIONS).generate([
      request('t1'),
      request('t2', 'a', 2),
      request('t3', 'a', 3),
    ]);

    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]?.ok === false && results[1].error).toContain('Gemini HTTP 503');
    // …and it LOGGED before it recovered (CLAUDE.md principle 7).
    expect(h.entries().some((e) => e.category === 'art.error')).toBe(true);
  });

  it('cannot be resumed — there is nothing left running to collect', async () => {
    const h = harness(() => ({ body: {} }));
    await expect(createInteractiveProvider(h.deps, OPTIONS).resume('batches/x')).rejects.toThrow(
      /cannot be resumed/,
    );
  });

  it('sends nothing for an empty request list', async () => {
    const h = harness(() => ({ body: {} }));
    expect(await createInteractiveProvider(h.deps, OPTIONS).generate([])).toEqual([]);
    expect(h.calls.length).toBe(0);
  });
});

describe('GeminiHttpError', () => {
  it('carries the status and mentions billing only for 429', () => {
    expect(new GeminiHttpError(400, 'bad').status).toBe(400);
    expect(new GeminiHttpError(400, 'bad').message).not.toContain('billing');
    expect(new GeminiHttpError(429, 'quota').message).toContain('billing');
  });
});
