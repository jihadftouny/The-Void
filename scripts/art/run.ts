// THE RUN — rounds, the gate, re-queue within the asset, keying, and the manifest.
//
// This is where ART-BIBLE §5's "enforced by the generation script, not by hope" actually happens:
// every returned image is decoded, gated against its class's rule, and either keyed and kept or
// rejected and re-queued. Nothing about it is interactive; the author reads the manifest and the
// summary afterwards.
//
// RE-QUEUE IS WITHIN THE ASSET, AND IT IS BOUNDED. §5.1 records white backgrounds at 1 in 3, so
// retakes are the normal case, not the exception. Two rules keep that from becoming an open tap:
// a retake is always for the SAME asset that failed (never a different one, which would silently
// change what the batch contains), and the number of retake rounds is fixed before the run starts,
// so the maximum spend is knowable in advance and is printed in the dry run. An unbounded
// regenerate-until-it-passes loop is the exact failure §5 warns about for backdrops, and it would
// be just as expensive for sprites.
//
// EVERYTHING IMPURE IS INJECTED — the provider, the filesystem, the clock, sleep, the logger — so
// the whole loop runs in memory in a test with a fake provider that serves prepared images. No
// test here writes a file, waits, or reaches a network.
//
// LOGGING IS AT THIS BOUNDARY, NOT INSIDE THE GATES (CLAUDE.md principle 7). `image.ts` and
// `catalogue.ts` stay pure; every duration, every rejection and every error is recorded here,
// before it is recovered from.

import type { Logger } from '../../src/log/logger.ts';
import {
  buildRequest,
  classOf,
  assemblePrompt,
  describeReference,
  type AssetEntry,
  type Catalogue,
  type ReferencePayload,
} from './catalogue.ts';
import { decodeImage, describeGate, encodePng, gateFor, luminanceKey } from './image.ts';
import type { ImageRequest, ImageResult, Provider } from './gemini.ts';
import {
  createManifest,
  finishManifest,
  formatDollars,
  recordCandidate,
  recordHandle,
  recordRoundFinished,
  recordSubmission,
  serializeManifest,
  type CandidateRecord,
  type Manifest,
  type RunMode,
} from './manifest.ts';

// =========================================================================================
// Seams
// =========================================================================================

export interface RunFs {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export interface RunDeps {
  provider: Provider;
  fs: RunFs;
  now(): number;
  log: Logger;
  /** Lines destined for `run.log.jsonl`, filled by a sink the caller attached. */
  logLines: string[];
}

export interface RunPlan {
  runId: string;
  catalogue: Catalogue;
  assets: AssetEntry[];
  mode: RunMode;
  takes: number;
  retakeRounds: number;
  outDir: string;
  /** False under `--resume` without `--confirm-spend`: collect what exists, submit nothing new. */
  spendAllowed: boolean;
}

export interface RunOutcome {
  runId: string;
  manifest: Manifest;
  summary: string[];
  /** True when a retake round was needed but not permitted to be submitted. */
  stoppedShort: boolean;
}

/** Forward slashes everywhere, so a manifest reads the same on every platform. */
function join(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}

/**
 * `20260921-143005-batch-3`. UTC, deliberately: it sorts correctly, it never repeats across a
 * daylight-saving change, and it matches the ISO timestamps in `run.log.jsonl`.
 */
export function formatRunId(at: number, mode: RunMode, assetCount: number): string {
  const iso = new Date(at).toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
  return `${stamp}-${mode}-${assetCount}`;
}

// =========================================================================================
// Internal bookkeeping
// =========================================================================================

interface AssetState {
  asset: AssetEntry;
  reference: ReferencePayload | null;
  passed: number;
  /** Takes still owed this round. */
  owed: number;
}

/** `enemy-gangers-r1-t2` — unique within a run, and readable in a manifest. */
function requestId(assetId: string, round: number, take: number): string {
  return `${assetId}-r${round}-t${take}`;
}

function extensionFor(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

// =========================================================================================
// The run
// =========================================================================================

export async function runGeneration(plan: RunPlan, deps: RunDeps): Promise<RunOutcome> {
  const runDir = join(plan.outDir, plan.runId);
  const manifestPath = join(runDir, 'manifest.json');
  const logPath = join(runDir, 'run.log.jsonl');

  await deps.fs.mkdir(runDir);

  // Load every reference once, up front. A reference that is missing or not an image must stop
  // the run BEFORE anything is submitted — discovering it after a batch is away means paying for
  // a batch that was conditioned on nothing.
  const states: AssetState[] = [];
  for (const asset of plan.assets) {
    let reference: ReferencePayload | null = null;
    if (asset.reference !== null) {
      const bytes = await deps.fs.readFile(asset.reference);
      reference = describeReference(asset.reference, bytes);
      deps.log.info('art.plan', 'reference loaded', {
        assetId: asset.id,
        path: reference.path,
        sha256: reference.sha256,
        bytes: reference.bytes,
      });
    }
    states.push({ asset, reference, passed: 0, owed: plan.takes });
  }

  const manifest = createManifest({
    runId: plan.runId,
    mode: plan.mode,
    model: plan.catalogue.model,
    takes: plan.takes,
    retakeRounds: plan.retakeRounds,
    createdAt: deps.now(),
    assets: states.map((state) => {
      const def = classOf(plan.catalogue, state.asset);
      return {
        id: state.asset.id,
        name: state.asset.name,
        class: state.asset.class,
        prompt: assemblePrompt(plan.catalogue, state.asset),
        params: {
          aspectRatio: def.aspectRatio,
          imageSize: plan.catalogue.imageSize,
          temperature: plan.catalogue.temperature,
          takes: plan.takes,
          gate: def.gate,
          keyMode: def.keyMode,
        },
        reference:
          state.reference === null
            ? null
            : {
                path: state.reference.path,
                sha256: state.reference.sha256,
                bytes: state.reference.bytes,
              },
      };
    }),
  });

  async function flush(): Promise<void> {
    await deps.fs.writeFile(manifestPath, serializeManifest(manifest));
    await deps.fs.writeFile(logPath, `${deps.logLines.join('\n')}\n`);
  }

  deps.log.info('art.plan', 'run planned', {
    runId: plan.runId,
    mode: plan.mode,
    assets: plan.assets.length,
    takes: plan.takes,
    retakeRounds: plan.retakeRounds,
    maxImages: plan.assets.length * plan.takes * (1 + plan.retakeRounds),
  });

  const outcome = await executeRounds(plan, deps, manifest, states, runDir, flush, 1);

  finishManifest(manifest, outcome.stoppedShort ? 'stopped' : 'complete');
  await flush();

  return { runId: plan.runId, manifest, summary: summarise(manifest, states, outcome.stoppedShort), stoppedShort: outcome.stoppedShort };
}

async function executeRounds(
  plan: RunPlan,
  deps: RunDeps,
  manifest: Manifest,
  states: AssetState[],
  runDir: string,
  flush: () => Promise<void>,
  firstRound: number,
): Promise<{ stoppedShort: boolean }> {
  const lastRound = plan.retakeRounds + 1;

  for (let round = firstRound; round <= lastRound; round += 1) {
    const pending = states.filter((s) => s.owed > 0);
    if (pending.length === 0) break;

    if (!plan.spendAllowed) {
      // AC-27: a resume that would need to submit more images stops instead. Spending approval
      // does not carry from one invocation to the next (PRINCIPLES §A1).
      deps.log.warn('art.queue', 'a retake round is needed but spending was not confirmed', {
        round,
        assets: pending.length,
        images: pending.reduce((n, s) => n + s.owed, 0),
      });
      return { stoppedShort: true };
    }

    const roundStartedAt = deps.now();
    const requests: ImageRequest[] = [];
    for (const state of pending) {
      for (let take = 1; take <= state.owed; take += 1) {
        // The take number is the index WITHIN the round; the round is already in the id and the
        // filename, so `r2-t1` is unambiguous and a reviewer can see at a glance that it was a
        // retake rather than an original.
        requests.push({
          id: requestId(state.asset.id, round, take),
          assetId: state.asset.id,
          take,
          body: buildRequest(plan.catalogue, state.asset, state.reference),
        });
      }
    }

    recordSubmission(manifest, round, requests, null, roundStartedAt);
    await flush();

    deps.log.info('art.submit', 'round submitting', {
      round,
      assets: pending.length,
      images: requests.length,
      mode: plan.mode,
      costMilliUsd: requests.length * manifest.pricePerImageMilliUsd,
    });

    const results =
      plan.mode === 'batch'
        ? await submitBatch(deps, manifest, requests, round, flush)
        : await submitInteractive(deps, pending, requests, round);

    recordRoundFinished(manifest, round, deps.now());
    deps.log.info('art.result', 'round returned', {
      round,
      results: results.length,
      durationMs: deps.now() - roundStartedAt,
    });

    for (const request of requests) {
      const state = states.find((s) => s.asset.id === request.assetId);
      if (state === undefined) continue;
      const result = results.find((r) => r.id === request.id);
      const kept = await processResult(plan, deps, manifest, state, request, round, runDir, result);
      if (!kept) {
        const roundsLeft = lastRound - round;
        deps.log.info('art.queue', 're-queued within the asset', {
          assetId: state.asset.id,
          round,
          take: request.take,
          willRetry: roundsLeft > 0,
          roundsLeft,
        });
      }
      await flush();
    }

    // WHAT EACH ASSET STILL OWES IS DERIVED FROM ITS OWN PASSING COUNT, AND FROM NOTHING ELSE.
    //
    // This is the whole of the "re-queue within the asset" rule, and it is one line on purpose.
    // An earlier version counted this round's failures into a per-asset tally AND then clamped the
    // tally to `takes - passed`. Both computed the same number, so the clamp silently corrected
    // any mistake in the tally — including a failure being charged to the wrong asset, which is
    // precisely the bug the rule exists to prevent. A guard cannot catch a defect that a second
    // mechanism repairs before anyone can observe it, and a mutation test proved exactly that:
    // re-queueing EVERY asset on any failure left the suite green.
    //
    // One source of truth. An asset asks for what it is short of; it cannot ask on behalf of
    // another, because it has no access to another's count.
    for (const state of states) {
      state.owed = Math.max(0, plan.takes - state.passed);
    }

    deps.log.info('art.cost', 'running cost after round', {
      round,
      imagesSubmitted: manifest.imagesSubmitted,
      milliUsd: manifest.milliUsd,
    });
  }

  return { stoppedShort: false };
}

async function submitBatch(
  deps: RunDeps,
  manifest: Manifest,
  requests: ImageRequest[],
  round: number,
  flush: () => Promise<void>,
): Promise<ImageResult[]> {
  return deps.provider.generate(requests, {
    onSubmitted: async (handle) => {
      // Written BEFORE polling. A batch can run for 24 hours; if this process dies without the
      // handle on disk, a job that has already been billed is unreachable.
      recordHandle(manifest, round, handle);
      await flush();
      deps.log.info('art.submit', 'batch handle recorded', { round, handle });
    },
  });
}

async function submitInteractive(
  deps: RunDeps,
  pending: AssetState[],
  requests: ImageRequest[],
  round: number,
): Promise<ImageResult[]> {
  // §1: "3 per asset, generated CONCURRENTLY within an asset, SEQUENTIAL across assets." The
  // concurrency is the provider's; the sequencing is this `await` inside the loop, and it is the
  // whole reason this is not a `Promise.all` over assets. It keeps the request rate sane.
  const all: ImageResult[] = [];
  for (const state of pending) {
    const mine = requests.filter((r) => r.assetId === state.asset.id);
    const startedAt = deps.now();
    const results = await deps.provider.generate(mine);
    all.push(...results);
    deps.log.info('art.result', 'asset returned', {
      assetId: state.asset.id,
      round,
      images: mine.length,
      durationMs: deps.now() - startedAt,
    });
  }
  return all;
}

/** Process one result. Returns true when the take is kept (gate passed), false to re-queue. */
async function processResult(
  plan: RunPlan,
  deps: RunDeps,
  manifest: Manifest,
  state: AssetState,
  request: ImageRequest,
  round: number,
  runDir: string,
  result: ImageResult | undefined,
): Promise<boolean> {
  const base: CandidateRecord = {
    round,
    take: request.take,
    file: null,
    mimeType: null,
    width: null,
    height: null,
    gate: null,
    keyedFile: null,
    error: null,
    decodeMs: null,
    gateMs: null,
    keyMs: null,
  };

  if (result === undefined || !result.ok) {
    const error = result === undefined ? 'no result returned for this request' : result.error;
    // Log BEFORE recording and re-queueing. A fallback that silently papers over an error
    // destroys the only evidence it happened (CLAUDE.md principle 7).
    deps.log.error('art.error', 'request failed', {
      assetId: state.asset.id,
      round,
      take: request.take,
      error,
    });
    recordCandidate(manifest, state.asset.id, { ...base, error });
    return false;
  }

  const def = classOf(plan.catalogue, state.asset);
  const assetDir = join(runDir, state.asset.id);
  await deps.fs.mkdir(assetDir);

  const rawName = `${state.asset.id}-r${round}-t${request.take}.${extensionFor(result.mimeType)}`;
  const rawPath = join(assetDir, rawName);
  await deps.fs.writeFile(rawPath, result.bytes);

  const decodeStartedAt = deps.now();
  let raster;
  try {
    raster = decodeImage(result.bytes);
  } catch (err) {
    const error = `could not decode the returned image: ${(err as Error).message}`;
    deps.log.error('art.error', 'undecodable image', {
      assetId: state.asset.id,
      round,
      take: request.take,
      file: rawPath,
      bytes: result.bytes.length,
      error,
    });
    recordCandidate(manifest, state.asset.id, { ...base, file: rawPath, mimeType: result.mimeType, error });
    return false;
  }
  const decodeMs = deps.now() - decodeStartedAt;

  const gateStartedAt = deps.now();
  const gate = gateFor(def, plan.catalogue.gates)(raster);
  const gateMs = deps.now() - gateStartedAt;

  if (!gate.passed) {
    // The warn names the corners, and it comes BEFORE the `art.queue` entry (AC-38).
    deps.log.warn('art.gate', describeGate(gate), {
      assetId: state.asset.id,
      round,
      take: request.take,
      file: rawPath,
      ...(gate.kind === 'corners'
        ? { failedCorners: gate.failedCorners }
        : { darkFraction: gate.darkFraction }),
      gateMs,
    });
    recordCandidate(manifest, state.asset.id, {
      ...base,
      file: rawPath,
      mimeType: result.mimeType,
      width: raster.width,
      height: raster.height,
      gate,
      decodeMs,
      gateMs,
    });
    return false;
  }

  let keyedFile: string | null = null;
  let keyMs: number | null = null;
  if (def.keyMode === 'luminance') {
    // §5.3: the model cannot emit alpha, so the black is keyed out here and the keyed PNG is the
    // committed asset. Backdrops are never keyed — they ARE the background.
    const keyStartedAt = deps.now();
    const keyed = luminanceKey(raster, plan.catalogue.keying);
    keyedFile = join(assetDir, `${state.asset.id}-r${round}-t${request.take}-keyed.png`);
    await deps.fs.writeFile(keyedFile, encodePng(keyed));
    keyMs = deps.now() - keyStartedAt;
    deps.log.info('art.key', 'keyed to alpha', {
      assetId: state.asset.id,
      round,
      take: request.take,
      file: keyedFile,
      keyMs,
    });
  }

  deps.log.info('art.gate', describeGate(gate), {
    assetId: state.asset.id,
    round,
    take: request.take,
    file: rawPath,
    passed: true,
    decodeMs,
    gateMs,
  });

  recordCandidate(manifest, state.asset.id, {
    ...base,
    file: rawPath,
    mimeType: result.mimeType,
    width: raster.width,
    height: raster.height,
    gate,
    keyedFile,
    decodeMs,
    gateMs,
    keyMs,
  });
  state.passed += 1;
  return true;
}

// =========================================================================================
// Resume
// =========================================================================================

/**
 * Everything a resume needs from disk, read BEFORE the API key is.
 *
 * Separated from `resumeRun` so `main` can establish that the run exists, and that it has
 * something left to collect, without opening `.env`. There is no reason to touch a secret to
 * discover that a run id was mistyped. (Same defect, same fix, as the generate path.)
 */
export interface ResumePoint {
  manifest: Manifest;
  runDir: string;
  manifestPath: string;
  round: number;
  handle: string;
}

export async function findResumePoint(
  runId: string,
  outDir: string,
  fs: RunFs,
): Promise<ResumePoint> {
  const runDir = join(outDir, runId);
  const manifestPath = join(runDir, 'manifest.json');

  if (!(await fs.exists(manifestPath))) {
    throw new Error(`No manifest at ${manifestPath} — nothing to resume`);
  }

  const manifest = JSON.parse(Buffer.from(await fs.readFile(manifestPath)).toString('utf8')) as Manifest;

  const open = [...manifest.rounds].reverse().find((r) => r.handle !== null && r.finishedAt === null);
  if (open === undefined || open.handle === null) {
    throw new Error(
      `Run ${runId} has no unfinished batch to collect. Nothing was submitted and nothing was spent.`,
    );
  }

  return { manifest, runDir, manifestPath, round: open.round, handle: open.handle };
}

export interface ResumeOptions {
  runId: string;
  outDir: string;
  catalogue: Catalogue;
  spendAllowed: boolean;
  /**
   * Produced by `findResumePoint`. REQUIRED, so the manifest has necessarily been read — and the
   * run proven to exist — before this function, and therefore before the key, is reached.
   */
  resumePoint: ResumePoint;
}

/**
 * Collect a batch that was already submitted.
 *
 * The case this exists for: a batch runs up to 24 hours, the tool was closed, and the images are
 * paid for whether or not anyone collects them. The handle in the manifest is the route back.
 *
 * A RESUME CANNOT WIDEN ITS OWN ASSET SET. The assets are the ones named in the manifest — the
 * run's own record of what it submitted — and this function takes no asset list from its caller,
 * so there is no argument through which a wider set could arrive. It previously took one, and
 * `main` passed `catalogue.assets`, the WHOLE catalogue: a resume could then build a retake round
 * for 50 assets that were never part of the run. Nothing was spent only because `recordSubmission`
 * throws on an unknown asset before the provider is called, and on the full catalogue the round
 * that exception blocked was 153 images, about $10.25 — very nearly the entire art budget, stopped
 * by an error that happened to fire first. That is not a safeguard.
 *
 * The catalogue is still needed, for the RAW prompts and the class rules: the manifest stores the
 * ASSEMBLED prompt, and re-assembling that would wrap the style string and the framing append
 * around themselves a second time. So the catalogue supplies the content and the manifest supplies
 * the set, which is the right way round — the manifest is the record of what was paid for.
 */
export async function resumeRun(options: ResumeOptions, deps: RunDeps): Promise<RunOutcome> {
  const { manifest, runDir, manifestPath, round: openRound, handle } = options.resumePoint;

  deps.log.info('art.poll', 'resuming', { runId: options.runId, round: openRound, handle });

  const recorded = manifest.assets.map((a) => a.id);
  const byId = new Map(options.catalogue.assets.map((a) => [a.id, a]));
  const missing = recorded.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Run ${options.runId} covered assets that are not in this catalogue: ${missing.join(', ')}. ` +
        `Point --catalogue at the one the run used. Nothing was submitted and nothing was spent.`,
    );
  }

  // The SET comes from the manifest, in the manifest's order. Never from the catalogue, and never
  // from an argument.
  const assets: AssetEntry[] = recorded.map((id) => byId.get(id) as AssetEntry);

  const states: AssetState[] = manifest.assets.map((record, index) => ({
    asset: assets[index] as AssetEntry,
    reference: null,
    passed: record.passing.length,
    owed: 0,
  }));

  const results = await deps.provider.resume(handle);

  const plan: RunPlan = {
    runId: options.runId,
    catalogue: options.catalogue,
    assets,
    mode: manifest.mode,
    takes: manifest.takes,
    retakeRounds: manifest.retakeRounds,
    outDir: options.outDir,
    spendAllowed: options.spendAllowed,
  };

  async function flush(): Promise<void> {
    await deps.fs.writeFile(manifestPath, serializeManifest(manifest));
  }

  for (const result of results) {
    const state = states.find((s) => result.id.startsWith(`${s.asset.id}-r`));
    if (state === undefined) continue;
    const take = Number(/-t(\d+)$/.exec(result.id)?.[1] ?? '1');
    const request: ImageRequest = {
      id: result.id,
      assetId: state.asset.id,
      take,
      body: buildRequest(options.catalogue, state.asset, null),
    };
    const kept = await processResult(plan, deps, manifest, state, request, openRound, runDir, result);
    if (!kept) state.owed += 1;
    await flush();
  }

  recordRoundFinished(manifest, openRound, deps.now());

  const rest = await executeRounds(plan, deps, manifest, states, runDir, flush, openRound + 1);
  finishManifest(manifest, rest.stoppedShort ? 'stopped' : 'complete');
  await flush();

  return {
    runId: options.runId,
    manifest,
    summary: summarise(manifest, states, rest.stoppedShort),
    stoppedShort: rest.stoppedShort,
  };
}

// =========================================================================================
// The summary the author reads
// =========================================================================================

function summarise(manifest: Manifest, states: AssetState[], stoppedShort: boolean): string[] {
  const lines: string[] = [];
  lines.push(`Run ${manifest.runId} — ${manifest.mode}, ${manifest.model}`);
  for (const asset of manifest.assets) {
    const failures = asset.candidates.filter((c) => c.error !== null || (c.gate !== null && !c.gate.passed));
    const detail =
      failures.length === 0
        ? ''
        : `, re-queued ${failures.length} (${failures
            .map((c) => {
              const why =
                c.error !== null
                  ? c.error
                  : c.gate !== null && c.gate.kind === 'corners'
                    ? c.gate.failedCorners.join(', ')
                    : 'bottom third too bright';
              return `round ${c.round} take ${c.take}: ${why}`;
            })
            .join('; ')})`;
    lines.push(`  ${asset.id}: ${asset.passing.length}/${manifest.takes} passed${detail}`);
  }
  lines.push(
    `Images submitted: ${manifest.imagesSubmitted}, returned: ${manifest.imagesReturned}. Cost: ${formatDollars(manifest.milliUsd)}`,
  );
  if (stoppedShort) {
    lines.push(
      'STOPPED: more images are needed but spending was not confirmed. Re-run with --confirm-spend to continue.',
    );
  }
  const shortfall = states.filter((s) => s.passed < manifest.takes);
  if (shortfall.length > 0 && !stoppedShort) {
    lines.push(
      `Short of ${manifest.takes} passing takes: ${shortfall.map((s) => s.asset.id).join(', ')} — raise --retake-rounds or fix the prompt.`,
    );
  }
  return lines;
}
