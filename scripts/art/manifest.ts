// THE MANIFEST — what was sent, what came back, what passed, and what it cost.
//
// One JSON file per run. It is the record the author reviews, the input the later wiring unit
// reads (`passing` tells it which files to copy into the game), and the evidence that says what a
// batch was conditioned on. `docs/ART-BIBLE.md` §0 states the whole document's purpose — "a run
// six months from now produces art indistinguishable from today's" — and a run that leaves no
// record of its own parameters cannot support that.
//
// MONEY IS COUNTED IN WHOLE MILLI-DOLLARS, AS INTEGERS. $0.067 is not representable in binary
// floating point — the nearest double is 0.067000000000000003997 — so a total ACCUMULATED from it
// drifts: adding 0.067 a hundred and fifty times gives 10.050000000000018, not 10.05, and adding
// it eleven times gives 0.7369999999999999, not 0.737. Accumulation is exactly what this module
// does, across assets and across rounds.
//
// Note the trap that makes this worth stating: a single `150 * 0.067` happens to round back to
// 10.05 and compares equal, so trying one product "proves" floats are fine here. They are not.
// Integers make `150 x 67 = 10050 -> "10.050"` exact by construction, and the dry run quotes a
// figure the author can check against §1b by hand.
//
// COST IS BOOKED AT SUBMISSION, NOT AT DELIVERY. You are billed for an image you asked for, so a
// run that submits 12 images and gets 11 back reports 12. Reporting the delivered count would make
// the manifest quietly understate the bill, which is the one direction a money record must never
// err in.
//
// This module is PURE: no clock (timestamps are passed in), no filesystem, no network.

import type { GateResult } from './image.ts';

export const MANIFEST_VERSION = 1;

export type RunMode = 'batch' | 'interactive';

/**
 * ART-BIBLE §1 and §1b, in milli-dollars per image.
 *
 * Batch is half price and is the default for a group; interactive is for probes, where waiting up
 * to 24 hours for an answer is the wrong trade. §1b LOCKED: "Use interactive for probes, batch for
 * groups."
 */
export const PRICE_MILLI_USD: Record<RunMode, number> = {
  batch: 67, // $0.067
  interactive: 134, // $0.134
};

/** What `images` images cost in `mode`, in milli-dollars. Integer arithmetic only. */
export function costMilliUsd(images: number, mode: RunMode): number {
  if (!Number.isInteger(images) || images < 0) {
    throw new Error(`image count must be a non-negative integer, got ${images}`);
  }
  return images * PRICE_MILLI_USD[mode];
}

/** Milli-dollars as a plain decimal string with exactly three places: `10050` -> `"10.050"`. */
export function formatUsd(milliUsd: number): string {
  if (!Number.isInteger(milliUsd)) {
    throw new Error(`cost must be whole milli-dollars, got ${milliUsd}`);
  }
  const sign = milliUsd < 0 ? '-' : '';
  const abs = Math.abs(milliUsd);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

/** The same figure with a dollar sign, for anything a person reads. */
export function formatDollars(milliUsd: number): string {
  return `$${formatUsd(milliUsd)}`;
}

// =========================================================================================
// Shape
// =========================================================================================

export interface ManifestReference {
  path: string;
  sha256: string;
  bytes: number;
  // Deliberately NOT the base64 payload: it would bloat the manifest by megabytes and the sha256
  // already identifies the reference exactly.
}

export interface CandidateRecord {
  round: number;
  take: number;
  /** The raw image as written to disk, or `null` when the request errored. */
  file: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  gate: GateResult | null;
  /** The keyed PNG, or `null` for a class that is not keyed (backdrops) or a failed candidate. */
  keyedFile: string | null;
  /** The API's error for this request, already redacted. `null` when it succeeded. */
  error: string | null;
  decodeMs: number | null;
  gateMs: number | null;
  keyMs: number | null;
}

export interface AssetParams {
  aspectRatio: string;
  imageSize: string;
  temperature: number;
  takes: number;
  gate: string;
  /** `luminance` or `none`. Named `keyMode` so a `grep -i key` over a manifest stays meaningful. */
  keyMode: string;
}

export interface AssetRecord {
  id: string;
  name: string;
  class: string;
  prompt: string;
  params: AssetParams;
  reference: ManifestReference | null;
  candidates: CandidateRecord[];
  /**
   * The file a later unit should copy into the game for each passing candidate — the keyed PNG
   * where there is one, the raw image otherwise. `docs/PLAN.md`'s wiring unit reads this list.
   */
  passing: string[];
  /** Images SUBMITTED for this asset x the per-image price. */
  costMilliUsd: number;
  /** Cumulative cost through this asset, in catalogue order. */
  runningMilliUsd: number;
  imagesSubmitted: number;
}

export interface RoundRecord {
  round: number;
  requested: number;
  /** The batch handle (`batches/…`), written BEFORE polling starts so a crash is resumable. */
  handle: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
}

export interface Manifest {
  version: number;
  runId: string;
  mode: RunMode;
  model: string;
  state: 'running' | 'complete' | 'stopped';
  createdAt: number;
  takes: number;
  retakeRounds: number;
  pricePerImageMilliUsd: number;
  imagesSubmitted: number;
  imagesReturned: number;
  milliUsd: number;
  usd: string;
  assets: AssetRecord[];
  rounds: RoundRecord[];
}

// =========================================================================================
// Building one
// =========================================================================================

export interface ManifestAssetSeed {
  id: string;
  name: string;
  class: string;
  prompt: string;
  params: AssetParams;
  reference: ManifestReference | null;
}

export interface CreateManifestOptions {
  runId: string;
  mode: RunMode;
  model: string;
  takes: number;
  retakeRounds: number;
  createdAt: number;
  assets: ManifestAssetSeed[];
}

export function createManifest(options: CreateManifestOptions): Manifest {
  return {
    version: MANIFEST_VERSION,
    runId: options.runId,
    mode: options.mode,
    model: options.model,
    state: 'running',
    createdAt: options.createdAt,
    takes: options.takes,
    retakeRounds: options.retakeRounds,
    pricePerImageMilliUsd: PRICE_MILLI_USD[options.mode],
    imagesSubmitted: 0,
    imagesReturned: 0,
    milliUsd: 0,
    usd: formatUsd(0),
    assets: options.assets.map((seed) => ({
      id: seed.id,
      name: seed.name,
      class: seed.class,
      prompt: seed.prompt,
      params: seed.params,
      reference: seed.reference,
      candidates: [],
      passing: [],
      costMilliUsd: 0,
      runningMilliUsd: 0,
      imagesSubmitted: 0,
    })),
    rounds: [],
  };
}

function assetOf(manifest: Manifest, assetId: string): AssetRecord {
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (asset === undefined) throw new Error(`manifest has no asset "${assetId}"`);
  return asset;
}

/** Recompute every derived money figure. Cumulative running cost follows catalogue order. */
function recomputeTotals(manifest: Manifest): void {
  const price = manifest.pricePerImageMilliUsd;
  let running = 0;
  let submitted = 0;
  let returned = 0;
  for (const asset of manifest.assets) {
    asset.costMilliUsd = asset.imagesSubmitted * price;
    running += asset.costMilliUsd;
    asset.runningMilliUsd = running;
    submitted += asset.imagesSubmitted;
    returned += asset.candidates.filter((c) => c.error === null).length;
  }
  manifest.imagesSubmitted = submitted;
  manifest.imagesReturned = returned;
  manifest.milliUsd = running;
  manifest.usd = formatUsd(running);
}

/**
 * Record that a round was submitted: the per-asset image counts, the round's timing, and — for a
 * batch — the handle.
 *
 * The handle is written here, before any polling, deliberately. A batch job can run for up to 24
 * hours; if the tool dies in that window without the handle on disk, the submitted job is
 * unreachable and the money is simply gone. `--resume` needs this line to have happened first.
 */
export function recordSubmission(
  manifest: Manifest,
  round: number,
  requests: readonly { assetId: string }[],
  handle: string | null,
  at: number,
): void {
  for (const request of requests) assetOf(manifest, request.assetId).imagesSubmitted += 1;

  const existing = manifest.rounds.find((r) => r.round === round);
  if (existing === undefined) {
    manifest.rounds.push({
      round,
      requested: requests.length,
      handle,
      startedAt: at,
      finishedAt: null,
      durationMs: null,
    });
  } else {
    existing.requested += requests.length;
    if (handle !== null) existing.handle = handle;
  }
  recomputeTotals(manifest);
}

/** Attach a batch handle to a round that is already recorded (the `onSubmitted` hook). */
export function recordHandle(manifest: Manifest, round: number, handle: string): void {
  const record = manifest.rounds.find((r) => r.round === round);
  if (record === undefined) throw new Error(`manifest has no round ${round}`);
  record.handle = handle;
}

export function recordRoundFinished(manifest: Manifest, round: number, at: number): void {
  const record = manifest.rounds.find((r) => r.round === round);
  if (record === undefined) throw new Error(`manifest has no round ${round}`);
  record.finishedAt = at;
  record.durationMs = at - record.startedAt;
}

/** Record one candidate and refresh the asset's `passing` list. */
export function recordCandidate(
  manifest: Manifest,
  assetId: string,
  candidate: CandidateRecord,
): void {
  const asset = assetOf(manifest, assetId);
  asset.candidates.push(candidate);
  asset.passing = asset.candidates
    .filter((c) => c.error === null && c.gate !== null && c.gate.passed)
    .map((c) => c.keyedFile ?? c.file)
    .filter((file): file is string => file !== null);
  recomputeTotals(manifest);
}

export function finishManifest(manifest: Manifest, state: 'complete' | 'stopped'): void {
  manifest.state = state;
  recomputeTotals(manifest);
}

/**
 * The manifest as it is written to disk.
 *
 * Nothing here can carry the API key: the key is never a field of anything this module builds, the
 * reference is reduced to a path plus a hash, and every error string reaching `recordCandidate`
 * has already been through `Secret.redact` at the transport boundary.
 */
export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
