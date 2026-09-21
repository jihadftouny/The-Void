// THE RUN LOOP. (AC-23 … AC-27, AC-37, AC-38.)
//
// Everything impure is a fake: the provider serves images drawn in this file, the filesystem is a
// Map, the clock advances one millisecond per read. No socket, no disk, no waiting.
//
// The images are JPEGs, because that is the only thing the model can return (ART-BIBLE §5.3). They
// are drawn so that the JPEG block grid never lands on a sampled pixel: a 16x16 white patch is
// exactly two 8x8 DCT blocks wide, and the backdrop's horizon sits on row 32, so the ringing that
// JPEG produces at a hard edge is never inside a corner patch or a sampled backdrop row. A fixture
// that failed because of compression artefacts would be a fixture defect being read as a gate
// result.

import { describe, it, expect } from 'vitest';
import { encode as encodeJpeg } from 'jpeg-js';
import { Logger, createRingBuffer, formatEntry, type LogEntry } from '../../src/log/logger.ts';
import { validateCatalogue, type AssetEntry, type Catalogue } from './catalogue.ts';
import { decodeImage, type Raster } from './image.ts';
import type { GenerateHooks, ImageRequest, ImageResult, Provider } from './gemini.ts';
import {
  findResumePoint,
  formatRunId,
  resumeRun,
  runGeneration,
  type RunDeps,
  type RunFs,
  type RunPlan,
} from './run.ts';
import { serializeManifest, type Manifest } from './manifest.ts';

// =========================================================================================
// Fixtures
// =========================================================================================

type Rgb = [number, number, number];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function solid(width: number, height: number, colour: Rgb): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let o = 0; o < rgba.length; o += 4) {
    rgba[o] = colour[0];
    rgba[o + 1] = colour[1];
    rgba[o + 2] = colour[2];
    rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}

function paint(r: Raster, x0: number, y0: number, w: number, h: number, c: Rgb): Raster {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const o = (y * r.width + x) * 4;
      r.rgba[o] = c[0];
      r.rgba[o + 1] = c[1];
      r.rgba[o + 2] = c[2];
      r.rgba[o + 3] = 255;
    }
  }
  return r;
}

function jpeg(r: Raster): Uint8Array {
  return new Uint8Array(encodeJpeg({ data: Buffer.from(r.rgba), width: r.width, height: r.height }, 100).data);
}

/** A usable sprite: flat black ground, a bright subject well clear of every corner patch. */
const SPRITE_OK = (): Uint8Array => jpeg(paint(solid(64, 64, BLACK), 24, 24, 16, 16, [200, 60, 20]));

/** §5.1's failure: the model returned it on white. Both TOP corners are white 16x16 blocks. */
const SPRITE_WHITE_TOP = (): Uint8Array => {
  const r = solid(64, 64, BLACK);
  paint(r, 0, 0, 16, 16, WHITE);
  paint(r, 48, 0, 16, 16, WHITE);
  return jpeg(r);
};

/** A backdrop: white sky down to row 31, black from row 32. The band examined starts at row 36. */
const BACKDROP_OK = (): Uint8Array => jpeg(paint(solid(96, 54, BLACK), 0, 0, 96, 32, WHITE));

/** A backdrop with no deep-shadow foreground at all — the whole frame is white. */
const BACKDROP_BAD = (): Uint8Array => jpeg(solid(96, 54, WHITE));

// =========================================================================================
// A catalogue for the test
// =========================================================================================

const SPRITE_APPEND = 'Full body, centered, isolated on a pure flat black background.';

function testCatalogue(assets: { id: string; class: string }[]): Catalogue {
  return validateCatalogue({
    version: 1,
    note: 'test',
    model: 'gemini-3-pro-image',
    imageSize: '1K',
    temperature: 1,
    responseModalities: ['IMAGE'],
    styleString: 'STYLE.',
    referenceInstruction: 'Match the reference.',
    backgroundSentence: 'Isolated on a pure flat black background.',
    classes: {
      'enemy-sprite': {
        aspectRatio: '1:1',
        gate: 'corners',
        keyMode: 'luminance',
        append: SPRITE_APPEND,
      },
      backdrop: {
        aspectRatio: '16:9',
        gate: 'bottomThird',
        keyMode: 'none',
        append: 'Environment only, deep-shadow bottom third.',
      },
    },
    gates: {
      corners: { patch: 8, maxLevel: 20, maxChroma: 10 },
      bottomThird: { stride: 8, maxLevel: 40, minDarkFraction: 0.8 },
    },
    keying: { lo: 16, hi: 48 },
    assets: assets.map((a) => ({
      id: a.id,
      class: a.class,
      name: a.id,
      stage: 3,
      prompt: `a ${a.id}`,
      reference: null,
    })),
  });
}

// =========================================================================================
// Fakes
// =========================================================================================

function memFs(): { fs: RunFs; files: Map<string, Uint8Array | string>; dirs: Set<string> } {
  const files = new Map<string, Uint8Array | string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    fs: {
      mkdir: async (p) => {
        dirs.add(p);
      },
      writeFile: async (p, d) => {
        files.set(p, d);
      },
      readFile: async (p) => {
        const v = files.get(p);
        if (v === undefined) throw new Error(`ENOENT: ${p}`);
        return typeof v === 'string' ? new Uint8Array(Buffer.from(v, 'utf8')) : v;
      },
      exists: async (p) => files.has(p),
    },
  };
}

interface FakeProvider extends Provider {
  /** Every `generate` call, as the list of request ids it carried. */
  batches: string[][];
  /** Observed whenever a hook fires, so ordering can be asserted. */
  observed: unknown[];
}

/**
 * A provider that serves `images[id]`, falling back to a good sprite.
 *
 * `onGenerate` lets a test look at the world at the moment a call happens — which is how "the
 * handle was on disk before polling started" is observed.
 */
function fakeProvider(
  images: Record<string, Uint8Array | 'error'>,
  mode: 'batch' | 'interactive' = 'batch',
  onSubmittedObserver?: (observed: unknown[]) => void | Promise<void>,
): FakeProvider {
  const batches: string[][] = [];
  const observed: unknown[] = [];

  const provider: FakeProvider = {
    mode,
    batches,
    observed,
    async generate(requests: ImageRequest[], hooks?: GenerateHooks): Promise<ImageResult[]> {
      batches.push(requests.map((r) => r.id));
      if (hooks?.onSubmitted !== undefined) {
        await hooks.onSubmitted('batches/fake-handle');
        // The run has now written the manifest. This is the instant polling would begin.
        if (onSubmittedObserver !== undefined) await onSubmittedObserver(observed);
      }
      return requests.map((request): ImageResult => {
        const served = images[request.id] ?? SPRITE_OK();
        if (served === 'error') {
          return { id: request.id, ok: false, error: 'UNAVAILABLE: model overloaded' };
        }
        return { id: request.id, ok: true, mimeType: 'image/jpeg', bytes: served };
      });
    },
    async resume(): Promise<ImageResult[]> {
      throw new Error('resume not scripted in this test');
    },
  };
  return provider;
}

interface Harness {
  deps: RunDeps;
  files: Map<string, Uint8Array | string>;
  entries: () => LogEntry[];
}

function harness(provider: Provider): Harness {
  const { fs, files } = memFs();
  const ring = createRingBuffer(500);
  const log = new Logger();
  const logLines: string[] = [];
  log.addSink(ring.sink);
  log.addSink((e) => logLines.push(JSON.stringify(e)));

  let t = 1_700_000_000_000;
  return {
    files,
    entries: ring.get,
    deps: {
      provider,
      fs,
      now: () => {
        t += 1;
        return t;
      },
      log,
      logLines,
    },
  };
}

function plan(catalogue: Catalogue, over: Partial<RunPlan> = {}): RunPlan {
  return {
    runId: 'testrun',
    catalogue,
    assets: catalogue.assets as AssetEntry[],
    mode: 'batch',
    takes: 3,
    retakeRounds: 1,
    outDir: 'art-candidates',
    spendAllowed: true,
    ...over,
  };
}

const manifestOf = (h: Harness): Manifest =>
  JSON.parse(String(h.files.get('art-candidates/testrun/manifest.json'))) as Manifest;

// =========================================================================================
// Run ids
// =========================================================================================

describe('run ids', () => {
  it('are a sortable UTC stamp plus the mode and the asset count', () => {
    // 2026-09-21T14:30:05Z. Written out by hand from the epoch value below.
    const at = Date.UTC(2026, 8, 21, 14, 30, 5);
    expect(formatRunId(at, 'batch', 3)).toBe('20260921-143005-batch-3');
    expect(formatRunId(at, 'interactive', 52)).toBe('20260921-143005-interactive-52');
  });
});

// =========================================================================================
// AC-23 — re-queue within the asset, bounded
// =========================================================================================

describe('re-queue is within the asset and bounded (AC-23)', () => {
  const catalogue = testCatalogue([
    { id: 'a', class: 'enemy-sprite' },
    { id: 'b', class: 'enemy-sprite' },
  ]);

  it('round 2 submits exactly one request, for the asset that failed', async () => {
    const provider = fakeProvider({ 'b-r1-t2': SPRITE_WHITE_TOP() });
    const h = harness(provider);
    const outcome = await runGeneration(plan(catalogue), h.deps);

    // Round 1: 2 assets x 3 takes = 6 requests, in one batch call.
    expect(provider.batches[0]).toEqual([
      'a-r1-t1',
      'a-r1-t2',
      'a-r1-t3',
      'b-r1-t1',
      'b-r1-t2',
      'b-r1-t3',
    ]);
    // Round 2: exactly one, for B. NOT for A, which had no failures.
    expect(provider.batches[1]).toEqual(['b-r2-t1']);
    expect(provider.batches.length).toBe(2);

    const manifest = outcome.manifest;
    const failed = manifest.assets
      .find((x) => x.id === 'b')!
      .candidates.find((c) => c.round === 1 && c.take === 2);
    expect(failed?.gate?.passed).toBe(false);
    expect(failed?.gate?.kind === 'corners' && failed.gate.failedCorners).toEqual([
      'top-left',
      'top-right',
    ]);

    // Both assets end with three passing takes; B needed four images to get them.
    expect(manifest.assets.map((x) => x.passing.length)).toEqual([3, 3]);
    expect(manifest.assets.map((x) => x.imagesSubmitted)).toEqual([3, 4]);
    expect(manifest.imagesSubmitted).toBe(7);
    expect(manifest.milliUsd).toBe(7 * 67); // 469, by hand
  });

  it('with --retake-rounds 0 nothing is resubmitted and B is reported at 2/3', async () => {
    const provider = fakeProvider({ 'b-r1-t2': SPRITE_WHITE_TOP() });
    const h = harness(provider);
    const outcome = await runGeneration(plan(catalogue, { retakeRounds: 0 }), h.deps);

    expect(provider.batches.length).toBe(1);
    expect(outcome.manifest.imagesSubmitted).toBe(6);
    expect(outcome.summary.join('\n')).toContain('b: 2/3 passed');
    expect(outcome.summary.join('\n')).toContain('top-left, top-right');
  });

  it('two assets short by DIFFERENT amounts each get exactly their own shortfall', async () => {
    // The asymmetry is the point. If both assets were short by the same amount, or if one had
    // already filled its quota, a retake charged to the wrong asset would be invisible — the
    // totals would still come out right. Here A is short by 1 and B by 2, so any cross-asset
    // mix-up changes the round-2 request list.
    //
    //   round 1: a-t1 ok, a-t2 ok, a-t3 FAIL   -> A has 2 of 3, owes 1
    //            b-t1 ok, b-t2 FAIL, b-t3 FAIL -> B has 1 of 3, owes 2
    //   round 2: exactly a-r2-t1, b-r2-t1, b-r2-t2
    const white = SPRITE_WHITE_TOP();
    const provider = fakeProvider({
      'a-r1-t3': white,
      'b-r1-t2': white,
      'b-r1-t3': white,
    });
    const h = harness(provider);
    const outcome = await runGeneration(plan(catalogue), h.deps);

    expect(provider.batches[1]).toEqual(['a-r2-t1', 'b-r2-t1', 'b-r2-t2']);
    expect(outcome.manifest.assets.map((x) => x.imagesSubmitted)).toEqual([4, 5]);
    expect(outcome.manifest.assets.map((x) => x.passing.length)).toEqual([3, 3]);
    expect(outcome.manifest.imagesSubmitted).toBe(9);
  });

  it('an asset that already has its takes is never re-queued for another asset’s failure', async () => {
    // A passes all three in round 1 and must appear NOWHERE in round 2, however badly B did.
    const white = SPRITE_WHITE_TOP();
    const provider = fakeProvider({ 'b-r1-t1': white, 'b-r1-t2': white, 'b-r1-t3': white });
    const h = harness(provider);
    await runGeneration(plan(catalogue), h.deps);

    expect(provider.batches[1]?.every((id) => id.startsWith('b-'))).toBe(true);
    expect(provider.batches[1]).toEqual(['b-r2-t1', 'b-r2-t2', 'b-r2-t3']);
  });

  it('a retake that fails again is not retried past the round ceiling', async () => {
    // Every take of B fails, in both rounds. The tool must stop at the ceiling rather than
    // regenerating until it passes — §5's unbounded-loop failure, which costs real money.
    const always = SPRITE_WHITE_TOP();
    const provider = fakeProvider({
      'b-r1-t1': always,
      'b-r1-t2': always,
      'b-r1-t3': always,
      'b-r2-t1': always,
      'b-r2-t2': always,
      'b-r2-t3': always,
    });
    const h = harness(provider);
    const outcome = await runGeneration(plan(catalogue), h.deps);

    expect(provider.batches.length).toBe(2);
    expect(provider.batches[1]).toEqual(['b-r2-t1', 'b-r2-t2', 'b-r2-t3']);
    expect(outcome.manifest.assets.find((x) => x.id === 'b')?.passing).toEqual([]);
    expect(outcome.summary.join('\n')).toContain('Short of 3 passing takes: b');
    // 3 + 3 for A and B in round 1, plus 3 retakes for B = 9.
    expect(outcome.manifest.imagesSubmitted).toBe(9);
  });

  it('an API error for one take is re-queued too, not silently dropped', async () => {
    const provider = fakeProvider({ 'a-r1-t3': 'error' });
    const h = harness(provider);
    const outcome = await runGeneration(plan(catalogue), h.deps);

    expect(provider.batches[1]).toEqual(['a-r2-t1']);
    const errored = outcome.manifest.assets
      .find((x) => x.id === 'a')!
      .candidates.find((c) => c.error !== null);
    expect(errored?.error).toContain('model overloaded');
    expect(outcome.manifest.assets.find((x) => x.id === 'a')?.passing.length).toBe(3);
  });
});

// =========================================================================================
// AC-24 — keying is per class
// =========================================================================================

describe('keying follows the asset class (AC-24)', () => {
  it('a sprite that passes is keyed, and the keyed PNG’s corners are fully transparent', async () => {
    const catalogue = testCatalogue([{ id: 'a', class: 'enemy-sprite' }]);
    const h = harness(fakeProvider({}));
    const outcome = await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);

    const candidate = outcome.manifest.assets[0]!.candidates[0]!;
    expect(candidate.file).toBe('art-candidates/testrun/a/a-r1-t1.jpg');
    expect(candidate.keyedFile).toBe('art-candidates/testrun/a/a-r1-t1-keyed.png');
    expect(outcome.manifest.assets[0]!.passing).toEqual([
      'art-candidates/testrun/a/a-r1-t1-keyed.png',
    ]);

    const keyed = decodeImage(h.files.get(candidate.keyedFile!) as Uint8Array);
    const alphaAt = (x: number, y: number): number =>
      keyed.rgba[(y * keyed.width + x) * 4 + 3] ?? -1;
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(63, 0)).toBe(0);
    expect(alphaAt(0, 63)).toBe(0);
    expect(alphaAt(63, 63)).toBe(0);
    // …and the subject is still there.
    expect(alphaAt(32, 32)).toBe(255);
  });

  it('a backdrop is never keyed, and passes on a white sky', async () => {
    const catalogue = testCatalogue([{ id: 'sky', class: 'backdrop' }]);
    const h = harness(fakeProvider({ 'sky-r1-t1': BACKDROP_OK() }));
    const outcome = await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);

    const candidate = outcome.manifest.assets[0]!.candidates[0]!;
    expect(candidate.gate?.passed).toBe(true);
    expect(candidate.gate?.kind).toBe('bottomThird');
    expect(candidate.keyedFile).toBeNull();
    expect(outcome.manifest.assets[0]!.passing).toEqual([
      'art-candidates/testrun/sky/sky-r1-t1.jpg',
    ]);
    expect([...h.files.keys()].some((k) => k.includes('keyed'))).toBe(false);
  });

  it('a backdrop with no dark foreground is rejected on its own gate', async () => {
    const catalogue = testCatalogue([{ id: 'sky', class: 'backdrop' }]);
    const h = harness(fakeProvider({ 'sky-r1-t1': BACKDROP_BAD() }));
    const outcome = await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);

    const candidate = outcome.manifest.assets[0]!.candidates[0]!;
    expect(candidate.gate?.passed).toBe(false);
    expect(candidate.gate?.kind).toBe('bottomThird');
  });
});

// =========================================================================================
// AC-25 / AC-26 — batch and interactive semantics
// =========================================================================================

describe('batch and interactive semantics (AC-25, AC-26)', () => {
  const catalogue = testCatalogue([
    { id: 'a', class: 'enemy-sprite' },
    { id: 'b', class: 'enemy-sprite' },
  ]);

  it('batch: one call per round, carrying every pending request', async () => {
    const provider = fakeProvider({});
    const h = harness(provider);
    await runGeneration(plan(catalogue, { retakeRounds: 0 }), h.deps);
    expect(provider.batches.length).toBe(1);
    expect(provider.batches[0]?.length).toBe(6);
  });

  it('the batch handle is in the manifest ON DISK before polling begins (AC-26)', async () => {
    // A batch runs for up to 24 hours. If the process dies after submitting and before the handle
    // is persisted, a job that has ALREADY BEEN BILLED is unreachable — there is no way to ask
    // Google "what did I just submit?". So the observer below runs at the exact instant the
    // provider would start polling, and reads the manifest as it exists on disk at that moment.
    let files: Map<string, Uint8Array | string> | null = null;
    let atPollTime: Manifest | null = null;

    const provider = fakeProvider({}, 'batch', () => {
      atPollTime = JSON.parse(
        String(files?.get('art-candidates/testrun/manifest.json')),
      ) as Manifest;
    });
    const h = harness(provider);
    files = h.files;

    await runGeneration(plan(catalogue, { retakeRounds: 0 }), h.deps);

    expect(atPollTime).not.toBeNull();
    const seen = atPollTime as unknown as Manifest;
    expect(seen.rounds[0]?.handle).toBe('batches/fake-handle');
    // …and it really was BEFORE any result was processed: nothing had come back yet.
    expect(seen.imagesReturned).toBe(0);
    expect(seen.assets.every((a) => a.candidates.length === 0)).toBe(true);
    // The cost of the submitted round is already recorded, because it is already owed.
    expect(seen.imagesSubmitted).toBe(6);
    expect(seen.milliUsd).toBe(402); // 6 x 67, by hand
  });

  it('interactive: one call per asset, in catalogue order, strictly sequential', async () => {
    // §1: "sequential ACROSS assets". Proved with a response held open: asset B's call must not
    // exist until asset A's has resolved.
    const calls: string[][] = [];
    const gates: (() => void)[] = [];
    const provider: Provider = {
      mode: 'interactive',
      async generate(requests: ImageRequest[]): Promise<ImageResult[]> {
        calls.push(requests.map((r) => r.id));
        await new Promise<void>((resolve) => gates.push(resolve));
        return requests.map((r) => ({
          id: r.id,
          ok: true as const,
          mimeType: 'image/jpeg',
          bytes: SPRITE_OK(),
        }));
      },
      async resume() {
        throw new Error('no');
      },
    };

    const h = harness(provider);
    const running = runGeneration(
      plan(catalogue, { mode: 'interactive', retakeRounds: 0 }),
      h.deps,
    );

    // Let the loop reach the first call.
    for (let i = 0; i < 20 && calls.length === 0; i += 1) await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['a-r1-t1', 'a-r1-t2', 'a-r1-t3']); // three takes in ONE call

    // B has not been asked for yet, because A has not resolved.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(calls.length).toBe(1);

    gates[0]?.();
    for (let i = 0; i < 80 && calls.length === 1; i += 1) await Promise.resolve();
    expect(calls[1]).toEqual(['b-r1-t1', 'b-r1-t2', 'b-r1-t3']);

    gates[1]?.();
    const outcome = await running;
    expect(outcome.manifest.assets.map((x) => x.passing.length)).toEqual([3, 3]);
    expect(outcome.manifest.pricePerImageMilliUsd).toBe(134); // interactive is full price
  });
});

// =========================================================================================
// AC-27 — resume
// =========================================================================================

describe('resume (AC-27)', () => {
  const catalogue = testCatalogue([{ id: 'a', class: 'enemy-sprite' }]);

  /** A manifest on disk describing a submitted, uncollected round. */
  function unfinishedManifest(): Manifest {
    return {
      version: 1,
      runId: 'testrun',
      mode: 'batch',
      model: 'gemini-3-pro-image',
      state: 'running',
      createdAt: 1,
      takes: 3,
      retakeRounds: 1,
      pricePerImageMilliUsd: 67,
      imagesSubmitted: 3,
      imagesReturned: 0,
      milliUsd: 201,
      usd: '0.201',
      assets: [
        {
          id: 'a',
          name: 'a',
          class: 'enemy-sprite',
          prompt: 'a a',
          params: { aspectRatio: '1:1', imageSize: '1K', temperature: 1, takes: 3, gate: 'corners', keyMode: 'luminance' },
          reference: null,
          candidates: [],
          passing: [],
          costMilliUsd: 201,
          runningMilliUsd: 201,
          imagesSubmitted: 3,
        },
      ],
      rounds: [
        { round: 1, requested: 3, handle: 'batches/left-running', startedAt: 1, finishedAt: null, durationMs: null },
      ],
    };
  }

  function resumeHarness(results: ImageResult[]): { h: Harness; provider: FakeProvider } {
    const provider = fakeProvider({});
    provider.resume = async (handle: string) => {
      provider.observed.push(handle);
      return results;
    };
    const h = harness(provider);
    h.files.set('art-candidates/testrun/manifest.json', serializeManifest(unfinishedManifest()));
    return { h, provider };
  }

  /** `resumeRun` now requires a ResumePoint, which only `findResumePoint` can produce. */
  async function resume(h: Harness, spendAllowed: boolean, over: Partial<{ runId: string }> = {}) {
    const runId = over.runId ?? 'testrun';
    const resumePoint = await findResumePoint(runId, 'art-candidates', h.deps.fs);
    return resumeRun({ runId, outDir: 'art-candidates', catalogue, spendAllowed, resumePoint }, h.deps);
  }

  it('polls the existing handle and submits nothing new', async () => {
    const { h, provider } = resumeHarness([
      { id: 'a-r1-t1', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_OK() },
      { id: 'a-r1-t2', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_OK() },
      { id: 'a-r1-t3', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_OK() },
    ]);

    const outcome = await resume(h, false);

    expect(provider.observed).toEqual(['batches/left-running']);
    expect(provider.batches).toEqual([]); // nothing submitted
    expect(outcome.manifest.assets[0]?.passing.length).toBe(3);
    expect(outcome.stoppedShort).toBe(false);
  });

  it('a needed retake WITHOUT --confirm-spend stops with a message and submits nothing', async () => {
    const { h, provider } = resumeHarness([
      { id: 'a-r1-t1', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_OK() },
      { id: 'a-r1-t2', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_WHITE_TOP() },
      { id: 'a-r1-t3', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_OK() },
    ]);

    const outcome = await resume(h, false);

    expect(provider.batches).toEqual([]); // THE POINT: nothing was submitted
    expect(outcome.stoppedShort).toBe(true);
    expect(outcome.manifest.state).toBe('stopped');
    expect(outcome.summary.join('\n')).toContain('--confirm-spend');
    expect(h.entries().some((e) => e.category === 'art.queue' && e.level === 'warn')).toBe(true);
  });

  it('the same retake WITH --confirm-spend does submit it', async () => {
    const { h, provider } = resumeHarness([
      { id: 'a-r1-t1', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_OK() },
      { id: 'a-r1-t2', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_WHITE_TOP() },
      { id: 'a-r1-t3', ok: true, mimeType: 'image/jpeg', bytes: SPRITE_OK() },
    ]);

    const outcome = await resume(h, true);

    expect(provider.batches).toEqual([['a-r2-t1']]);
    expect(outcome.stoppedShort).toBe(false);
    expect(outcome.manifest.assets[0]?.passing.length).toBe(3);
  });

  it('refuses a run id with no manifest, and one with nothing left running (D3)', async () => {
    // Both refusals now live in `findResumePoint`, which reads the manifest and nothing else —
    // no key, no transport. That is what lets `main` call it before `loadSecret`.
    const h = harness(fakeProvider({}));
    await expect(findResumePoint('nope', 'art-candidates', h.deps.fs)).rejects.toThrow(
      /nothing to resume/,
    );

    const finished = unfinishedManifest();
    finished.rounds[0]!.finishedAt = 5;
    h.files.set('art-candidates/testrun/manifest.json', serializeManifest(finished));
    await expect(findResumePoint('testrun', 'art-candidates', h.deps.fs)).rejects.toThrow(
      /no unfinished batch/,
    );
  });
});

// =========================================================================================
// AC-37 / AC-38 — logging at the boundary
// =========================================================================================

describe('logging (AC-37, AC-38)', () => {
  const catalogue = testCatalogue([{ id: 'a', class: 'enemy-sprite' }]);

  it('every duration is a NUMBER in data, never interpolated into a message', async () => {
    const h = harness(fakeProvider({}));
    await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);
    const entries = h.entries();

    const gatePass = entries.find((e) => e.category === 'art.gate' && e.level === 'info');
    const data = gatePass?.data as { decodeMs: number; gateMs: number };
    // The clock advances exactly 1ms per read, and these are adjacent reads.
    expect(data.decodeMs).toBe(1);
    expect(data.gateMs).toBe(1);

    const keyed = entries.find((e) => e.category === 'art.key')?.data as { keyMs: number };
    expect(keyed.keyMs).toBe(1);

    for (const category of ['art.submit', 'art.result', 'art.cost']) {
      expect(entries.some((e) => e.category === category)).toBe(true);
    }
    const roundReturned = entries.find((e) => e.category === 'art.result')?.data as {
      durationMs: number;
    };
    expect(typeof roundReturned.durationMs).toBe('number');

    // Principle 7: "Never interpolate a number into a string and lose it."
    expect(gatePass?.message).not.toMatch(/\d+ ?ms/);
  });

  it('a gate rejection logs art.gate (warn, naming the corners) BEFORE art.queue', async () => {
    const h = harness(fakeProvider({ 'a-r1-t1': SPRITE_WHITE_TOP() }));
    await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);

    const order = h.entries().filter((e) => e.category === 'art.gate' || e.category === 'art.queue');
    expect(order[0]?.category).toBe('art.gate');
    expect(order[0]?.level).toBe('warn');
    expect(order[0]?.message).toContain('top-left is not near-black');
    expect((order[0]?.data as { failedCorners: string[] }).failedCorners).toEqual([
      'top-left',
      'top-right',
    ]);
    expect(order[1]?.category).toBe('art.queue');
  });

  it('an API error logs art.error BEFORE the candidate is recorded and re-queued', async () => {
    const h = harness(fakeProvider({ 'a-r1-t1': 'error' }));
    await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);

    const order = h.entries().filter((e) => e.category === 'art.error' || e.category === 'art.queue');
    expect(order[0]?.category).toBe('art.error');
    expect(order[0]?.level).toBe('error');
    expect(order[1]?.category).toBe('art.queue');
  });

  it('writes run.log.jsonl beside the manifest, one JSON object per line', async () => {
    const h = harness(fakeProvider({}));
    await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);

    const jsonl = String(h.files.get('art-candidates/testrun/run.log.jsonl')).trim();
    const lines = jsonl.split('\n');
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      const parsed = JSON.parse(line) as LogEntry;
      expect(typeof parsed.category).toBe('string');
      expect(parsed.category.startsWith('art.')).toBe(true);
      expect(typeof formatEntry(parsed)).toBe('string');
    }
  });

  it('the manifest is written after every candidate, not only at the end', async () => {
    // A crash mid-run must leave a usable record of what was already paid for.
    const seen: { returned: number; handle: string | null }[] = [];
    const provider = fakeProvider({});
    const h = harness(provider);
    const originalWrite = h.deps.fs.writeFile.bind(h.deps.fs);
    h.deps.fs.writeFile = async (p, d) => {
      if (p.endsWith('manifest.json')) {
        const m = JSON.parse(String(d)) as Manifest;
        seen.push({ returned: m.imagesReturned, handle: m.rounds[0]?.handle ?? null });
      }
      await originalWrite(p, d);
    };

    await runGeneration(plan(catalogue, { takes: 3, retakeRounds: 0 }), h.deps);

    // Six writes, and each one is for a reason:
    //   1. the round was submitted — the money is owed from here on, handle not known yet
    //   2. the handle came back — written BEFORE polling (AC-26), still no results
    //   3-5. one per candidate, so a crash keeps whatever has been gated so far
    //   6. the final flush, marking the run complete
    expect(seen).toEqual([
      { returned: 0, handle: null },
      { returned: 0, handle: 'batches/fake-handle' },
      { returned: 1, handle: 'batches/fake-handle' },
      { returned: 2, handle: 'batches/fake-handle' },
      { returned: 3, handle: 'batches/fake-handle' },
      { returned: 3, handle: 'batches/fake-handle' },
    ]);
  });
});

// =========================================================================================
// The manifest the run leaves behind
// =========================================================================================

describe('the run’s output layout', () => {
  it('lands under art-candidates/<runId>/ with per-asset directories', async () => {
    const catalogue = testCatalogue([{ id: 'a', class: 'enemy-sprite' }]);
    const h = harness(fakeProvider({}));
    await runGeneration(plan(catalogue, { takes: 2, retakeRounds: 0 }), h.deps);

    expect([...h.files.keys()].sort()).toEqual([
      'art-candidates/testrun/a/a-r1-t1-keyed.png',
      'art-candidates/testrun/a/a-r1-t1.jpg',
      'art-candidates/testrun/a/a-r1-t2-keyed.png',
      'art-candidates/testrun/a/a-r1-t2.jpg',
      'art-candidates/testrun/manifest.json',
      'art-candidates/testrun/run.log.jsonl',
    ]);
    expect(manifestOf(h).state).toBe('complete');
  });

  it('records the assembled prompt and the class parameters for every asset', async () => {
    const catalogue = testCatalogue([{ id: 'a', class: 'enemy-sprite' }]);
    const h = harness(fakeProvider({}));
    await runGeneration(plan(catalogue, { takes: 1, retakeRounds: 0 }), h.deps);

    const asset = manifestOf(h).assets[0]!;
    expect(asset.prompt).toBe(
      'Isolated on a pure flat black background. a a Full body, centered, isolated on a pure flat black background. STYLE.',
    );
    expect(asset.params).toEqual({
      aspectRatio: '1:1',
      imageSize: '1K',
      temperature: 1,
      takes: 1,
      gate: 'corners',
      keyMode: 'luminance',
    });
  });
});
