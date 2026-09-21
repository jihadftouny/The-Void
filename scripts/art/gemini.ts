// THE TRANSPORT — the only module that knows the shape of Google's API.
//
// `fetch` IS INJECTED. Nothing here reaches the network on its own: a caller that does not hand
// this module a fetch implementation cannot make it send anything, and every test hands it a fake.
// That is the mechanism behind the unit's central promise — no code path reaches the network
// without `--confirm-spend` — expressed as a dependency rather than as a flag check somewhere.
//
// THE API KEY GOES IN A HEADER AND NOWHERE ELSE (ART-BIBLE §1: "header X-goog-api-key … Never
// inline a key, commit one, or log one"). There is no `?key=` query parameter anywhere in this
// file, and there is a test that fails if one appears. A URL is logged by every proxy, every
// browser history, every error reporter and every crash dump between here and Google; a header is
// not. The `Secret` this module holds cannot be printed even by accident (see secret.ts), and
// every error body is passed through `redact` before it becomes an exception message — because an
// API that rejects your key very often echoes your request back at you.
//
// A NOTE ON THE WORD "key" IN THIS FILE. The batch API's per-request `metadata` map uses `key` as
// its correlation-id field in Google's own documented example, and responses echo it back. That
// `key` is a request id like `enemy-gangers-r1-t2`, NOT the API key, and the two must not be
// confused. Internally the field is called `id` for exactly that reason; `key` appears only where
// the wire format demands it.
//
// FIELD NAMES ARE FROM THE v1beta REST REFERENCE AS OF 2026-09 AND ARE NOT VERIFIED AGAINST A LIVE
// CALL, because verifying them costs money and this unit spends none. The failure mode if one is
// wrong is an HTTP 400 — a rejected request, not a wrong charge. `--preview` exists so the author
// can diff the exact bodies against the live documentation before ever passing `--confirm-spend`.

import type { GenerateContentRequest } from './catalogue.ts';
import type { Secret } from './secret.ts';
import type { Logger } from '../../src/log/logger.ts';
import type { RunMode } from './manifest.ts';

export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * The ceiling on an inlined batch body. Google's documented limit for inlined batch requests is
 * 20 MiB; past it the request must go through the Files API instead.
 *
 * This is checked BEFORE any call is made, so an oversized batch costs nothing and fails
 * instantly rather than after a round trip. The Files API path is deliberately not built (it is
 * the one extension `docs/PLAN.md` #5 may need); a guard that refuses with an explanation is the
 * honest placeholder for a path that does not exist.
 */
export const INLINE_BATCH_MAX_BYTES = 20 * 1024 * 1024;

/** Batch job states, from the v1beta reference. */
const STATE_SUCCEEDED = 'BATCH_STATE_SUCCEEDED';
const TERMINAL_FAILURES = ['BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED'];

// =========================================================================================
// The seam
// =========================================================================================

/** The slice of the `fetch` contract this module uses. Kept minimal so a fake is three lines. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface ImageRequest {
  /** Correlation id, unique within a round: `<assetId>-r<round>-t<take>`. */
  id: string;
  assetId: string;
  take: number;
  body: GenerateContentRequest;
}

export type ImageResult =
  | { id: string; ok: true; mimeType: string; bytes: Uint8Array }
  | { id: string; ok: false; error: string };

export interface GenerateHooks {
  /** Called with the batch handle the instant it is known, BEFORE any polling. */
  onSubmitted?: (handle: string) => Promise<void>;
}

export interface Provider {
  mode: RunMode;
  generate(requests: ImageRequest[], hooks?: GenerateHooks): Promise<ImageResult[]>;
  /** Batch only: collect an already-submitted job. Interactive throws — there is nothing to poll. */
  resume(handle: string): Promise<ImageResult[]>;
}

export interface TransportDeps {
  fetch: FetchLike;
  sleep(ms: number): Promise<void>;
  now(): number;
  log: Logger;
  secret: Secret;
}

export interface TransportOptions {
  model: string;
  pollIntervalMs: number;
  maxWaitMs: number;
  displayName: string;
}

// =========================================================================================
// Errors
// =========================================================================================

export class GeminiHttpError extends Error {
  readonly status: number;

  constructor(status: number, redactedBody: string) {
    const billing =
      status === 429
        ? ' — ART-BIBLE §1: image generation is NOT on the free tier at all (limit: 0); billing' +
          ' must be enabled on the project or every request returns 429'
        : '';
    super(`Gemini HTTP ${status}${billing}: ${redactedBody}`);
    this.name = 'GeminiHttpError';
    this.status = status;
  }
}

// =========================================================================================
// URLs — no query string, ever
// =========================================================================================

/** `…/v1beta/models/<model>:<operation>`. Deliberately has no query component. */
export function buildUrl(model: string, operation: string): string {
  return `${API_BASE}/models/${model}:${operation}`;
}

/** `…/v1beta/batches/<id>` — the poll URL for a handle the submit call returned. */
export function buildPollUrl(handle: string): string {
  return `${API_BASE}/${handle}`;
}

// =========================================================================================
// HTTP
// =========================================================================================

async function call(
  deps: TransportDeps,
  url: string,
  method: 'GET' | 'POST',
  body: string | null,
): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // The ONE place the key is used. Not the URL, not the body.
  deps.secret.applyTo(headers);

  const init: FetchInit = body === null ? { method, headers } : { method, headers, body };
  const response = await deps.fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    // Redact BEFORE the text becomes an exception message. A rejected request is very often
    // echoed back by the server, key included.
    throw new GeminiHttpError(response.status, deps.secret.redact(text).slice(0, 2000));
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `Gemini returned a ${response.status} that is not JSON: ${deps.secret.redact(text).slice(0, 200)}`,
    );
  }
}

// =========================================================================================
// Response parsing
// =========================================================================================

function get(value: unknown, ...path: string[]): unknown {
  let cursor: unknown = value;
  for (const step of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[step];
  }
  return cursor;
}

/** Pull the first inline image out of one `generateContent` response. */
function imageFromResponse(response: unknown): { mimeType: string; bytes: Uint8Array } | null {
  const parts = get(response, 'candidates', '0', 'content', 'parts');
  if (!Array.isArray(parts)) return null;
  for (const part of parts as unknown[]) {
    const inline = get(part, 'inlineData') ?? get(part, 'inline_data');
    const data = get(inline, 'data');
    if (typeof data === 'string') {
      const mimeType = get(inline, 'mimeType') ?? get(inline, 'mime_type');
      return {
        mimeType: typeof mimeType === 'string' ? mimeType : 'image/jpeg',
        bytes: new Uint8Array(Buffer.from(data, 'base64')),
      };
    }
  }
  return null;
}

/** A human-usable message from an API error object. */
function errorText(error: unknown): string {
  const message = get(error, 'message');
  const status = get(error, 'status');
  if (typeof message === 'string') {
    return typeof status === 'string' ? `${status}: ${message}` : message;
  }
  return JSON.stringify(error);
}

/**
 * Turn one batch operation's inlined responses into results, matched back to the requests.
 *
 * Matched on `metadata.key` — the correlation id we sent — with the ARRAY INDEX as a fallback.
 * The fallback matters: if the API ever stops echoing metadata, index matching still produces the
 * right answer for a response list that is in request order, whereas an id-only match would
 * silently drop every image in a batch that was already paid for.
 */
export function parseInlinedResponses(
  operation: unknown,
  requests: readonly ImageRequest[],
  redact: (text: string) => string,
): ImageResult[] {
  const inlined =
    get(operation, 'response', 'inlinedResponses', 'inlinedResponses') ??
    get(operation, 'response', 'inlinedResponses') ??
    get(operation, 'response', 'inlined_responses', 'inlined_responses');

  if (!Array.isArray(inlined)) {
    throw new Error('Batch operation succeeded but carried no inlinedResponses');
  }

  const results: ImageResult[] = [];
  for (const [index, entry] of (inlined as unknown[]).entries()) {
    const metadataKey = get(entry, 'metadata', 'key');
    const id =
      typeof metadataKey === 'string' ? metadataKey : (requests[index]?.id ?? `index-${index}`);

    const error = get(entry, 'error');
    if (error !== undefined && error !== null) {
      results.push({ id, ok: false, error: redact(errorText(error)) });
      continue;
    }

    const image = imageFromResponse(get(entry, 'response'));
    if (image === null) {
      results.push({ id, ok: false, error: 'response carried no inline image data' });
      continue;
    }
    results.push({ id, ok: true, mimeType: image.mimeType, bytes: image.bytes });
  }
  return results;
}

// =========================================================================================
// Batch
// =========================================================================================

/** The inlined-batch request body, per the v1beta reference. */
export function buildBatchBody(
  requests: readonly ImageRequest[],
  displayName: string,
): { batch: unknown } {
  return {
    batch: {
      displayName,
      inputConfig: {
        requests: {
          requests: requests.map((request) => ({
            request: request.body,
            // `key` is the API's own metadata field name, echoed back on the response. It is a
            // correlation id, NOT the API key.
            metadata: { key: request.id },
          })),
        },
      },
    },
  };
}

/** Refuse an oversized inlined batch before a single byte is sent. */
export function assertBatchFits(serialisedBytes: number, requestCount: number): void {
  if (serialisedBytes <= INLINE_BATCH_MAX_BYTES) return;
  const mib = (serialisedBytes / (1024 * 1024)).toFixed(1);
  throw new Error(
    `Batch body is ${mib} MiB across ${requestCount} requests, over the ${INLINE_BATCH_MAX_BYTES / (1024 * 1024)} MiB inline limit. ` +
      `Nothing was sent. Either split the run (--stage, or fewer --asset ids) or use a smaller ` +
      `reference image — the reference is base64 in every single request, so it is almost always ` +
      `what pushed it over.`,
  );
}

export function createBatchProvider(deps: TransportDeps, options: TransportOptions): Provider {
  async function poll(handle: string, requests: readonly ImageRequest[]): Promise<ImageResult[]> {
    const startedAt = deps.now();
    for (;;) {
      const operation = await call(deps, buildPollUrl(handle), 'GET', null);
      const state = get(operation, 'metadata', 'state');
      const done = get(operation, 'done');
      const elapsedMs = deps.now() - startedAt;

      deps.log.info('art.poll', 'batch poll', {
        handle,
        state: typeof state === 'string' ? state : null,
        done: done === true,
        elapsedMs,
      });

      if (typeof state === 'string' && TERMINAL_FAILURES.includes(state)) {
        deps.log.error('art.error', 'batch ended without results', { handle, state, elapsedMs });
        throw new Error(`Batch ${handle} ended in ${state} — no images were returned`);
      }

      if (done === true || state === STATE_SUCCEEDED) {
        return parseInlinedResponses(operation, requests, (t) => deps.secret.redact(t));
      }

      if (elapsedMs + options.pollIntervalMs > options.maxWaitMs) {
        deps.log.error('art.error', 'batch poll deadline reached', {
          handle,
          elapsedMs,
          maxWaitMs: options.maxWaitMs,
        });
        // The handle is IN the message on purpose. The job is still running and already paid for;
        // this message is the only way back to it.
        throw new Error(
          `Batch ${handle} did not finish within ${Math.round(options.maxWaitMs / 60000)} minutes. ` +
            `It is still running and already billed — collect it with: npm run art -- --resume <runId>`,
        );
      }

      await deps.sleep(options.pollIntervalMs);
    }
  }

  return {
    mode: 'batch',

    async generate(requests: ImageRequest[], hooks?: GenerateHooks): Promise<ImageResult[]> {
      if (requests.length === 0) return [];

      const body = JSON.stringify(buildBatchBody(requests, options.displayName));
      assertBatchFits(Buffer.byteLength(body, 'utf8'), requests.length);

      const submittedAt = deps.now();
      const operation = await call(deps, buildUrl(options.model, 'batchGenerateContent'), 'POST', body);
      const handle = get(operation, 'name');
      if (typeof handle !== 'string' || handle === '') {
        throw new Error('batchGenerateContent returned no operation name to poll');
      }

      deps.log.info('art.submit', 'batch submitted', {
        handle,
        requests: requests.length,
        bodyBytes: Buffer.byteLength(body, 'utf8'),
        durationMs: deps.now() - submittedAt,
      });

      // Before polling, always: if the process dies now, this handle is the only way back to a
      // job that has already been billed.
      if (hooks?.onSubmitted !== undefined) await hooks.onSubmitted(handle);

      return poll(handle, requests);
    },

    async resume(handle: string): Promise<ImageResult[]> {
      deps.log.info('art.poll', 'resuming an existing batch', { handle });
      return poll(handle, []);
    },
  };
}

// =========================================================================================
// Interactive
// =========================================================================================

/**
 * §1b LOCKED: "Use interactive for probes, batch for groups." Interactive is double the price and
 * answers in seconds, which is the right trade when you are looking at three images to decide a
 * direction and the wrong one for a group of fifty.
 */
export function createInteractiveProvider(
  deps: TransportDeps,
  options: TransportOptions,
): Provider {
  return {
    mode: 'interactive',

    async generate(requests: ImageRequest[]): Promise<ImageResult[]> {
      if (requests.length === 0) return [];
      const url = buildUrl(options.model, 'generateContent');

      // Concurrent WITHIN the call. §1: "3 per asset, generated concurrently within an asset,
      // sequential across assets" — the sequencing across assets is the run loop's job, and it
      // achieves it by calling this once per asset.
      return Promise.all(
        requests.map(async (request): Promise<ImageResult> => {
          const startedAt = deps.now();
          try {
            const response = await call(deps, url, 'POST', JSON.stringify(request.body));
            const image = imageFromResponse(response);
            deps.log.info('art.result', 'interactive image returned', {
              id: request.id,
              assetId: request.assetId,
              take: request.take,
              ok: image !== null,
              durationMs: deps.now() - startedAt,
            });
            if (image === null) {
              return { id: request.id, ok: false, error: 'response carried no inline image data' };
            }
            return { id: request.id, ok: true, mimeType: image.mimeType, bytes: image.bytes };
          } catch (err) {
            // Log BEFORE recovering. A per-request failure that is swallowed into a result object
            // leaves no evidence it ever happened (CLAUDE.md principle 7).
            const message = deps.secret.redact((err as Error).message);
            deps.log.error('art.error', 'interactive request failed', {
              id: request.id,
              assetId: request.assetId,
              take: request.take,
              durationMs: deps.now() - startedAt,
              error: message,
            });
            return { id: request.id, ok: false, error: message };
          }
        }),
      );
    },

    async resume(): Promise<ImageResult[]> {
      throw new Error('Interactive runs cannot be resumed — nothing is left running to collect');
    },
  };
}
