// THE MONEY LEDGER. (AC-36, and AC-16's manifest half.)
//
// Every figure below is multiplied out by hand from ART-BIBLE §1b's per-image price and §4b's
// asset counts, and cross-checked against the dollar totals the bible itself prints. None of them
// was read off a run.
//
//   batched,    $0.067/image  ->  67 milli-dollars
//   interactive $0.134/image  -> 134 milli-dollars
//
//   9 x 67   =    603  ->  "0.603"   (probe-sized group)
//   150 x 67 =  10050  -> "10.050"   (§4b: 50 buildable assets x 3 takes, "150 images ≈ $10.05")
//   156 x 67 =  10452  -> "10.452"   (§4b: all 52 once the engine catches up, "≈ $10.45")
//   9 x 134  =   1206  ->  "1.206"   (§7 probe 03: "9/9 generated, ~$1.21")
//
// WHY INTEGERS. There is a negative control below that ACCUMULATES the same totals in
// floating-point dollars and requires them to come out wrong. It is about accumulation, not about
// one multiplication: `150 * 0.067` happens to round back to exactly 10.05, which is the trap —
// checking a single product and concluding floats are safe here. Adding 0.067 up 150 times gives
// 10.050000000000018, and adding it 11 times gives 0.7369999999999999. Accumulating a running
// total is precisely what the manifest does. If that control ever goes green, floats have stopped
// being dangerous and this file's premise is gone.

import { describe, it, expect } from 'vitest';
import {
  costMilliUsd,
  createManifest,
  finishManifest,
  formatDollars,
  formatUsd,
  MANIFEST_VERSION,
  PRICE_MILLI_USD,
  recordCandidate,
  recordHandle,
  recordRoundFinished,
  recordSubmission,
  serializeManifest,
  type CandidateRecord,
  type Manifest,
} from './manifest.ts';

const FAKE_KEY = 'AIzaFAKEfakeFAKEnotARealKey000000000000';

const PARAMS = {
  aspectRatio: '1:1',
  imageSize: '1K',
  temperature: 1,
  takes: 3,
  gate: 'corners',
  keyMode: 'luminance',
} as const;

function seed(id: string) {
  return { id, name: id, class: 'enemy-sprite', prompt: `prompt for ${id}`, params: { ...PARAMS }, reference: null };
}

function manifestOf(ids: string[], mode: 'batch' | 'interactive' = 'batch'): Manifest {
  return createManifest({
    runId: '20260921-090000-batch-3',
    mode,
    model: 'gemini-3-pro-image',
    takes: 3,
    retakeRounds: 1,
    createdAt: 1_700_000_000_000,
    assets: ids.map(seed),
  });
}

function candidate(over: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    round: 1,
    take: 1,
    file: 'a/a-r1-t1.jpg',
    mimeType: 'image/jpeg',
    width: 1024,
    height: 1024,
    gate: { kind: 'corners', passed: true, failedCorners: [], corners: [] },
    keyedFile: 'a/a-r1-t1-keyed.png',
    error: null,
    decodeMs: 4,
    gateMs: 1,
    keyMs: 2,
    ...over,
  };
}

// =========================================================================================
// Prices and formatting
// =========================================================================================

describe('prices and formatting (AC-10’s arithmetic, AC-36’s `usd`)', () => {
  it('holds §1b’s two prices in milli-dollars', () => {
    expect(PRICE_MILLI_USD.batch).toBe(67);
    expect(PRICE_MILLI_USD.interactive).toBe(134);
    // §1b: batch is exactly half of standard.
    expect(PRICE_MILLI_USD.batch * 2).toBe(PRICE_MILLI_USD.interactive);
  });

  const ANCHORS: readonly [number, 'batch' | 'interactive', number, string, string][] = [
    [9, 'batch', 603, '0.603', 'a 3-asset probe group, batched'],
    [150, 'batch', 10050, '10.050', '§4b: 50 buildable assets x 3 takes ≈ $10.05'],
    [156, 'batch', 10452, '10.452', '§4b: all 52 once the engine catches up ≈ $10.45'],
    [9, 'interactive', 1206, '1.206', '§7 probe 03: 9/9 generated, ~$1.21'],
    [3, 'batch', 201, '0.201', 'one asset, 3 takes'],
    [0, 'batch', 0, '0.000', 'nothing selected'],
  ];

  for (const [images, mode, milli, usd, why] of ANCHORS) {
    it(`${images} images ${mode} = ${milli} milli = $${usd} — ${why}`, () => {
      expect(costMilliUsd(images, mode)).toBe(milli);
      expect(formatUsd(milli)).toBe(usd);
      expect(formatDollars(milli)).toBe(`$${usd}`);
    });
  }

  it('NEGATIVE CONTROL: the same running total in floating-point dollars drifts off', () => {
    // 0.067 has no exact binary representation (the nearest double is 0.067000000000000003997),
    // so ACCUMULATING it must lose precision. Accumulation is exactly what `runningMilliUsd`
    // does — a cumulative total across assets, and across rounds — which is why it is integer.
    //
    // Note what this control does NOT say. A single multiply, `150 * 0.067`, happens to round
    // back to 10.05 and compares equal. That is the trap: trying one product and concluding
    // floats are fine here. The error only shows once the values are added up.
    let dollars = 0;
    for (let i = 0; i < 150; i += 1) dollars += 0.067;
    expect(dollars).not.toBe(10.05);

    let eleven = 0;
    for (let i = 0; i < 11; i += 1) eleven += 0.067;
    expect(eleven).not.toBe(0.737);

    // The integer path, over the same accumulation, is exact.
    let milli = 0;
    for (let i = 0; i < 150; i += 1) milli += PRICE_MILLI_USD.batch;
    expect(milli).toBe(10050);
    expect(formatUsd(milli)).toBe('10.050');
  });

  it('refuses fractional milli-dollars and fractional image counts', () => {
    expect(() => formatUsd(66.5)).toThrow(/whole milli-dollars/);
    expect(() => costMilliUsd(2.5, 'batch')).toThrow(/non-negative integer/);
    expect(() => costMilliUsd(-1, 'batch')).toThrow(/non-negative integer/);
  });

  it('always prints three decimal places, padded', () => {
    expect(formatUsd(7)).toBe('0.007');
    expect(formatUsd(70)).toBe('0.070');
    expect(formatUsd(1000)).toBe('1.000');
    expect(formatUsd(1_000_067)).toBe('1000.067');
  });
});

// =========================================================================================
// AC-36 — the manifest's shape and its running cost
// =========================================================================================

describe('the manifest (AC-36)', () => {
  it('starts at version 1, state running, zero cost', () => {
    const m = manifestOf(['a']);
    expect(m.version).toBe(MANIFEST_VERSION);
    expect(m.version).toBe(1);
    expect(m.state).toBe('running');
    expect(m.milliUsd).toBe(0);
    expect(m.usd).toBe('0.000');
    expect(m.pricePerImageMilliUsd).toBe(67);
    expect(m.model).toBe('gemini-3-pro-image');
  });

  it('carries the prompt, the params and the reference per asset', () => {
    const m = createManifest({
      runId: 'r',
      mode: 'batch',
      model: 'gemini-3-pro-image',
      takes: 3,
      retakeRounds: 1,
      createdAt: 0,
      assets: [
        {
          ...seed('a'),
          reference: { path: 'art-candidates/anchor.png', sha256: 'abc123', bytes: 8 },
        },
      ],
    });
    const asset = m.assets[0]!;
    expect(asset.prompt).toBe('prompt for a');
    expect(asset.params).toEqual(PARAMS);
    expect(asset.reference).toEqual({ path: 'art-candidates/anchor.png', sha256: 'abc123', bytes: 8 });
    expect(asset.candidates).toEqual([]);
    expect(asset.passing).toEqual([]);
  });

  it('runs the cost up cumulatively, in asset order: 201 -> 469 -> 737', () => {
    // A gets 3 images, B gets 3 + 1 retake = 4, C gets 3 + 1 retake = 4. Eleven images total.
    //   A: 3 x 67 = 201,  running 201
    //   B: 4 x 67 = 268,  running 201 + 268 = 469
    //   C: 4 x 67 = 268,  running 469 + 268 = 737
    //   total 11 x 67 = 737 -> "0.737"
    const m = manifestOf(['a', 'b', 'c']);
    const round1 = [
      ...Array.from({ length: 3 }, () => ({ assetId: 'a' })),
      ...Array.from({ length: 3 }, () => ({ assetId: 'b' })),
      ...Array.from({ length: 3 }, () => ({ assetId: 'c' })),
    ];
    recordSubmission(m, 1, round1, 'batches/one', 1000);
    recordSubmission(m, 2, [{ assetId: 'b' }, { assetId: 'c' }], 'batches/two', 2000);

    expect(m.assets.map((a) => a.imagesSubmitted)).toEqual([3, 4, 4]);
    expect(m.assets.map((a) => a.costMilliUsd)).toEqual([201, 268, 268]);
    expect(m.assets.map((a) => a.runningMilliUsd)).toEqual([201, 469, 737]);
    expect(m.imagesSubmitted).toBe(11);
    expect(m.milliUsd).toBe(737);
    expect(m.usd).toBe('0.737');
    expect(formatDollars(m.milliUsd)).toBe('$0.737');
  });

  it('books cost at SUBMISSION, so a request that returns nothing is still billed', () => {
    const m = manifestOf(['a']);
    recordSubmission(m, 1, [{ assetId: 'a' }, { assetId: 'a' }, { assetId: 'a' }], null, 0);
    recordCandidate(m, 'a', candidate({ take: 1 }));
    recordCandidate(m, 'a', candidate({ take: 2, file: null, gate: null, keyedFile: null, error: 'RESOURCE_EXHAUSTED' }));

    expect(m.imagesSubmitted).toBe(3);
    expect(m.imagesReturned).toBe(1); // one ok, one errored, one never came back
    expect(m.milliUsd).toBe(201); // still billed for all three
  });

  it('lists the deliverable file for each passing candidate — the keyed PNG where there is one', () => {
    const m = manifestOf(['a']);
    recordSubmission(m, 1, [{ assetId: 'a' }, { assetId: 'a' }, { assetId: 'a' }], null, 0);
    recordCandidate(m, 'a', candidate({ take: 1, file: 'a/t1.jpg', keyedFile: 'a/t1-keyed.png' }));
    recordCandidate(
      m,
      'a',
      candidate({
        take: 2,
        file: 'a/t2.jpg',
        keyedFile: null,
        gate: { kind: 'corners', passed: false, failedCorners: ['top-left'], corners: [] },
      }),
    );
    // A backdrop-style candidate: passes, and is never keyed.
    recordCandidate(m, 'a', candidate({ take: 3, file: 'a/t3.jpg', keyedFile: null }));

    expect(m.assets[0]!.passing).toEqual(['a/t1-keyed.png', 'a/t3.jpg']);
    expect(m.assets[0]!.candidates.length).toBe(3);
  });

  it('never counts a failed or errored candidate as passing', () => {
    const m = manifestOf(['a']);
    recordSubmission(m, 1, [{ assetId: 'a' }, { assetId: 'a' }], null, 0);
    recordCandidate(
      m,
      'a',
      candidate({ take: 1, gate: { kind: 'corners', passed: false, failedCorners: ['top-right'], corners: [] } }),
    );
    recordCandidate(m, 'a', candidate({ take: 2, file: null, gate: null, keyedFile: null, error: 'boom' }));
    expect(m.assets[0]!.passing).toEqual([]);
  });

  it('records each round with its handle and its duration', () => {
    const m = manifestOf(['a']);
    recordSubmission(m, 1, [{ assetId: 'a' }], null, 1_000);
    recordHandle(m, 1, 'batches/abc');
    recordRoundFinished(m, 1, 9_500);

    expect(m.rounds).toEqual([
      { round: 1, requested: 1, handle: 'batches/abc', startedAt: 1_000, finishedAt: 9_500, durationMs: 8_500 },
    ]);
  });

  it('refuses to record against an asset or a round it does not know', () => {
    const m = manifestOf(['a']);
    expect(() => recordSubmission(m, 1, [{ assetId: 'zzz' }], null, 0)).toThrow(/no asset "zzz"/);
    expect(() => recordHandle(m, 7, 'batches/x')).toThrow(/no round 7/);
    expect(() => recordCandidate(m, 'zzz', candidate())).toThrow(/no asset "zzz"/);
  });

  it('finishes as complete, and serialises as indented JSON that round-trips', () => {
    const m = manifestOf(['a']);
    recordSubmission(m, 1, [{ assetId: 'a' }], null, 0);
    recordCandidate(m, 'a', candidate());
    finishManifest(m, 'complete');

    const text = serializeManifest(m);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(m);
    expect(JSON.parse(text).state).toBe('complete');
  });

  it('is interactive-priced when the run is interactive', () => {
    const m = manifestOf(['a'], 'interactive');
    recordSubmission(m, 1, [{ assetId: 'a' }, { assetId: 'a' }, { assetId: 'a' }], null, 0);
    expect(m.pricePerImageMilliUsd).toBe(134);
    expect(m.milliUsd).toBe(402); // 3 x 134, by hand
    expect(m.usd).toBe('0.402');
  });
});

// =========================================================================================
// AC-16 — the key is not in the manifest
// =========================================================================================

describe('the manifest carries no key (AC-16)', () => {
  it('a full manifest, serialised, contains no key-shaped value', () => {
    const m = manifestOf(['a']);
    recordSubmission(m, 1, [{ assetId: 'a' }], 'batches/abc', 0);
    recordCandidate(m, 'a', candidate({ error: 'HTTP 400: API key not valid — [redacted]' }));
    finishManifest(m, 'complete');

    const text = serializeManifest(m);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).toContain('[redacted]');
    // No field name that would tempt a future caller to put one in.
    expect(text).not.toMatch(/"(apiKey|key|secret|token|authorization)"\s*:/i);
  });

  it('the reference is reduced to a path and a hash, never the image payload', () => {
    const m = createManifest({
      runId: 'r',
      mode: 'batch',
      model: 'm',
      takes: 3,
      retakeRounds: 1,
      createdAt: 0,
      assets: [{ ...seed('a'), reference: { path: 'anchor.png', sha256: 'deadbeef', bytes: 8 } }],
    });
    const text = serializeManifest(m);
    expect(JSON.parse(text).assets[0].reference).toEqual({
      path: 'anchor.png',
      sha256: 'deadbeef',
      bytes: 8,
    });
    expect(text).not.toContain('inlineData');
    expect(text).not.toContain('data:');
  });

  it('NEGATIVE CONTROL: an UNREDACTED error really would show up, so the check can detect one', () => {
    // The manifest does not scrub — redaction happens at the transport boundary, where the Secret
    // lives (see gemini.ts). This proves the assertion above is capable of failing, rather than
    // passing because nothing could ever contain a key.
    const m = manifestOf(['a']);
    recordSubmission(m, 1, [{ assetId: 'a' }], null, 0);
    recordCandidate(m, 'a', candidate({ error: `HTTP 400 for ?key=${FAKE_KEY}` }));
    expect(serializeManifest(m)).toContain(FAKE_KEY);
  });
});
