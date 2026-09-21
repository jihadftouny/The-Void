// THE COMMAND LINE — and the reason this tool cannot spend money by accident.
//
// THE RULE: a dry run is what happens unless you ask for something else, TWICE. Generating
// requires BOTH `--confirm-spend` AND an explicit asset selection. Neither alone does anything.
//
// HOW IT IS ENFORCED, AND WHY IT IS NOT AN `if`. `decideRun` is a pure function from flags to a
// decision, and `main` constructs the network transport and loads the API key ONLY inside the
// branches that decision permits. So the guarantee is not "there is a check before the call" —
// which the next refactor can step around — it is "on a dry run, the object that could call the
// network is never built, and the key is never read". The tests supply a `createTransport` and a
// `loadSecret` that THROW IF CALLED, which turns "it didn't spend" from an absence of evidence
// into a positive assertion.
//
// PRINCIPLES §A1: "Treat irreversible or outward-facing steps — publishing, sending, spending — as
// separate actions that need explicit sign-off. Approval for one never carries to the next." Every
// invocation must say `--confirm-spend` again. There is no remembered consent, no config file that
// turns it on, and no environment variable.
//
// A DELIBERATE DEVIATION FROM THE PLAN, RECORDED PER §A12. The plan had `--resume` collect an
// already-submitted batch WITHOUT `--confirm-spend`, on the reasoning that collecting spends
// nothing. That is true about money and false about the network: collecting calls the API. The
// governing instruction for this unit is the stronger one — no code path reaches the network
// without the flag — so `--resume` requires it too, and says why when it is missing. The weaker
// behaviour it replaces (a resume that collects but refuses to submit a retake round) still exists
// and is still tested, one layer down in `resumeRun`'s `spendAllowed`, which is where it does its
// real work.

import type { Logger } from '../../src/log/logger.ts';
import {
  parseCatalogue,
  selectAssets,
  type AssetEntry,
  type Catalogue,
  type GenerateContentRequest,
  buildRequest,
  describeReference,
  assemblePrompt,
} from './catalogue.ts';
import { costMilliUsd, formatDollars, PRICE_MILLI_USD, type RunMode } from './manifest.ts';
import type { Provider } from './gemini.ts';
import type { Secret } from './secret.ts';
import {
  formatRunId,
  type ResumeOptions,
  type RunDeps,
  type RunFs,
  type RunOutcome,
  type RunPlan,
} from './run.ts';

export const DEFAULT_CATALOGUE = 'scripts/art/catalogue.json';
export const DEFAULT_OUT = 'art-candidates';

/** §1 LOCKED: "Variations: 3 per asset". 1 and 2 are allowed for a cheaper probe; 4 is not. */
export const MAX_TAKES = 3;
/** The retake ceiling is what makes the maximum spend knowable before the run starts. */
export const MAX_RETAKE_ROUNDS = 2;

export interface Args {
  cataloguePath: string;
  ids: string[];
  stage: number | null;
  mode: RunMode;
  takes: number;
  retakeRounds: number;
  reference: string | null;
  out: string;
  pollSeconds: number;
  maxWaitHours: number;
  preview: string | null;
  verbose: boolean;
  dryRun: boolean;
  confirmSpend: boolean;
  resume: string | null;
  list: boolean;
  help: boolean;
}

export const USAGE = `npm run art -- [options]

  Generates the art in docs/ART-BIBLE.md. DOES NOTHING BY DEFAULT: without --confirm-spend
  it prints what it WOULD send and what that would cost, and exits.

  Selecting what to generate (required before anything can be sent):
    --asset <id>            one asset; repeatable
    --assets a,b,c          several, comma separated
    --stage <1-4>           a whole generation stage (ART-BIBLE §4)
    --list                  print every id in the catalogue and exit

  Spending:
    --confirm-spend         actually send. Required, every time, alongside a selection.
    --dry-run               force a dry run even with --confirm-spend (a dry run always wins)

  How:
    --mode batch|interactive   batch is half price (default); interactive is for probes
    --takes <1-3>              variations per asset (default 3; §1 locks 3 for real batches)
    --retake-rounds <0-2>      rounds of regeneration for gate failures (default 1)
    --reference <path>         condition every selected asset on this image (§7)
    --catalogue <path>         default ${DEFAULT_CATALOGUE}
    --out <dir>                default ${DEFAULT_OUT}
    --poll-seconds <n>         batch poll interval (default 30)
    --max-wait-hours <n>       batch deadline (default 25)
    --preview <file>           write the exact request bodies to a file and exit
    --resume <runId>           collect a batch that was already submitted (needs --confirm-spend)
    --verbose                  mirror the run log to the console
`;

function readNumber(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(value)) {
    throw new Error(`${flag} needs a number, got ${raw === undefined ? '(nothing)' : `"${raw}"`}`);
  }
  return value;
}

function readString(raw: string | undefined, flag: string): string {
  if (raw === undefined || raw === '') throw new Error(`${flag} needs a value`);
  return raw;
}

/** Pure. Throws on anything it does not recognise rather than ignoring it. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    cataloguePath: DEFAULT_CATALOGUE,
    ids: [],
    stage: null,
    mode: 'batch',
    takes: 3,
    retakeRounds: 1,
    reference: null,
    out: DEFAULT_OUT,
    pollSeconds: 30,
    maxWaitHours: 25,
    preview: null,
    verbose: false,
    dryRun: false,
    confirmSpend: false,
    resume: null,
    list: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] as string;
    const next = argv[i + 1];
    switch (flag) {
      case '--catalogue':
        args.cataloguePath = readString(next, flag);
        i += 1;
        break;
      case '--asset':
        args.ids.push(readString(next, flag));
        i += 1;
        break;
      case '--assets':
        for (const id of readString(next, flag).split(',')) {
          if (id.trim() !== '') args.ids.push(id.trim());
        }
        i += 1;
        break;
      case '--stage':
        args.stage = readNumber(next, flag);
        i += 1;
        break;
      case '--mode': {
        const mode = readString(next, flag);
        if (mode !== 'batch' && mode !== 'interactive') {
          throw new Error(`--mode must be batch or interactive, got "${mode}"`);
        }
        args.mode = mode;
        i += 1;
        break;
      }
      case '--takes':
        args.takes = readNumber(next, flag);
        i += 1;
        break;
      case '--retake-rounds':
        args.retakeRounds = readNumber(next, flag);
        i += 1;
        break;
      case '--reference':
        args.reference = readString(next, flag);
        i += 1;
        break;
      case '--out':
        args.out = readString(next, flag);
        i += 1;
        break;
      case '--poll-seconds':
        args.pollSeconds = readNumber(next, flag);
        i += 1;
        break;
      case '--max-wait-hours':
        args.maxWaitHours = readNumber(next, flag);
        i += 1;
        break;
      case '--preview':
        args.preview = readString(next, flag);
        i += 1;
        break;
      case '--resume':
        args.resume = readString(next, flag);
        i += 1;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--confirm-spend':
        args.confirmSpend = true;
        break;
      case '--list':
        args.list = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option "${flag}". Run with --help.`);
    }
  }

  // §1 LOCKS three takes per asset. Fewer is allowed (a cheaper probe); more is not, and an
  // unbounded retake ceiling would make the maximum spend unknowable, which is the one property
  // the dry-run report exists to provide.
  if (!Number.isInteger(args.takes) || args.takes < 1 || args.takes > MAX_TAKES) {
    throw new Error(
      `--takes must be a whole number from 1 to ${MAX_TAKES} (ART-BIBLE §1 locks 3 variations per asset), got ${args.takes}`,
    );
  }
  if (
    !Number.isInteger(args.retakeRounds) ||
    args.retakeRounds < 0 ||
    args.retakeRounds > MAX_RETAKE_ROUNDS
  ) {
    throw new Error(
      `--retake-rounds must be a whole number from 0 to ${MAX_RETAKE_ROUNDS}, so the maximum spend stays knowable, got ${args.retakeRounds}`,
    );
  }
  if (args.stage !== null && (!Number.isInteger(args.stage) || args.stage < 1 || args.stage > 4)) {
    throw new Error(`--stage must be 1, 2, 3 or 4 (ART-BIBLE §4 "Generation order"), got ${args.stage}`);
  }

  return args;
}

// =========================================================================================
// The decision
// =========================================================================================

export type RunKind = 'help' | 'list' | 'dry-run' | 'refuse' | 'generate' | 'resume';

export interface Decision {
  kind: RunKind;
  spendAllowed: boolean;
  /** Why, when the kind is `refuse`. */
  reason: string;
}

export function hasSelection(args: Args): boolean {
  return args.ids.length > 0 || args.stage !== null;
}

/**
 * Flags in, decision out. Pure, total, and the single place the spending rule lives.
 *
 * The order of these branches IS the rule:
 *   1. `--help` / `--list` never touch anything.
 *   2. `--resume` needs `--confirm-spend`, because collecting still calls the API.
 *   3. A DRY RUN WINS over `--confirm-spend`. Someone who typed both wants to look first.
 *   4. No `--confirm-spend` is a dry run, whatever else was typed.
 *   5. `--confirm-spend` with no selection is REFUSED — never "everything". A flag that means
 *      "yes" must never also decide WHAT it is saying yes to.
 */
export function decideRun(args: Args): Decision {
  if (args.help) return { kind: 'help', spendAllowed: false, reason: '' };
  if (args.list) return { kind: 'list', spendAllowed: false, reason: '' };

  if (args.resume !== null) {
    if (!args.confirmSpend) {
      return {
        kind: 'refuse',
        spendAllowed: false,
        reason:
          `--resume ${args.resume} needs --confirm-spend as well. Collecting a batch still calls ` +
          `the API, and it may need to submit a retake round. Nothing was sent and nothing was spent.`,
      };
    }
    return { kind: 'resume', spendAllowed: true, reason: '' };
  }

  if (args.dryRun) return { kind: 'dry-run', spendAllowed: false, reason: '' };
  if (!args.confirmSpend) return { kind: 'dry-run', spendAllowed: false, reason: '' };

  if (!hasSelection(args)) {
    return {
      kind: 'refuse',
      spendAllowed: false,
      reason:
        '--confirm-spend was given but nothing was selected. Name what to generate with --asset, ' +
        '--assets or --stage. This tool will never interpret "yes" as "all 50 assets". ' +
        'Nothing was sent and nothing was spent.',
    };
  }

  return { kind: 'generate', spendAllowed: true, reason: '' };
}

// =========================================================================================
// Planning and the dry-run report
// =========================================================================================

export interface PlannedRun {
  assets: AssetEntry[];
  mode: RunMode;
  takes: number;
  retakeRounds: number;
  /** Images in round 1 — `assets x takes`. */
  roundOneImages: number;
  roundOneMilliUsd: number;
  /** The worst case: round 1 plus every retake round regenerating everything. */
  maximumMilliUsd: number;
}

export function planRun(catalogue: Catalogue, args: Args): PlannedRun {
  const selected = selectAssets(catalogue, { ids: args.ids, stage: args.stage });
  const assets =
    args.reference === null
      ? selected
      : selected.map((asset) => ({ ...asset, reference: args.reference }));

  const roundOneImages = assets.length * args.takes;
  const roundOneMilliUsd = costMilliUsd(roundOneImages, args.mode);

  return {
    assets,
    mode: args.mode,
    takes: args.takes,
    retakeRounds: args.retakeRounds,
    roundOneImages,
    roundOneMilliUsd,
    // §A8, "size for the worst case": the ceiling assumes every image in every retake round is
    // needed. It is the number the author is actually agreeing to, not the likely one.
    maximumMilliUsd: roundOneMilliUsd * (1 + args.retakeRounds),
  };
}

export function formatDryRun(catalogue: Catalogue, planned: PlannedRun): string[] {
  const price = PRICE_MILLI_USD[planned.mode];
  const names = planned.assets.map((a) => a.id).join(', ');
  const lines = [
    'DRY RUN — Nothing was sent and nothing was spent.',
    `Mode: ${planned.mode} (${formatDollars(price)} per image, ${catalogue.model}, ${catalogue.imageSize})`,
    `Assets (${planned.assets.length}): ${names === '' ? '(none selected)' : names}`,
    `Round 1: ${planned.roundOneImages} images = ${formatDollars(planned.roundOneMilliUsd)}`,
    `Retake ceiling: ${planned.retakeRounds} round(s) x up to ${planned.roundOneImages} images = ${formatDollars(planned.roundOneMilliUsd * planned.retakeRounds)}`,
    `Maximum this run can spend: ${formatDollars(planned.maximumMilliUsd)}`,
  ];
  lines.push(
    planned.assets.length === 0
      ? 'Nothing is selected. Choose assets with --asset, --assets or --stage.'
      : 'To generate, re-run with --confirm-spend (and keep the asset list).',
  );
  return lines;
}

/**
 * The exact request bodies, with any reference reduced to its path, hash and size.
 *
 * ART-BIBLE's field names were taken from the REST reference and have never been checked against a
 * live call, because checking costs money. This is how they get checked for free: write the
 * bodies, read them beside the documentation, and only then type `--confirm-spend`.
 */
export function buildPreview(
  catalogue: Catalogue,
  planned: PlannedRun,
  references: Map<string, { path: string; sha256: string; bytes: number }>,
): string {
  const entries = planned.assets.map((asset) => {
    const body: GenerateContentRequest = buildRequest(catalogue, asset, null);
    return {
      assetId: asset.id,
      takes: planned.takes,
      prompt: assemblePrompt(catalogue, asset),
      reference: asset.reference === null ? null : (references.get(asset.id) ?? { path: asset.reference }),
      body,
    };
  });
  return `${JSON.stringify(
    { note: 'Request bodies only. NOTHING WAS SENT. No key appears here.', model: catalogue.model, entries },
    null,
    2,
  )}\n`;
}

// =========================================================================================
// main
// =========================================================================================

export interface MainDeps {
  readText(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  /** Reads `.env`. Called ONLY on a path the decision permits to spend. */
  loadSecret(): Promise<Secret>;
  /** Builds the network client. Called ONLY on a path the decision permits to spend. */
  createTransport(secret: Secret, args: Args, log: Logger): Provider;
  runGeneration(plan: RunPlan, deps: RunDeps): Promise<RunOutcome>;
  resumeRun(options: ResumeOptions, deps: RunDeps): Promise<RunOutcome>;
  makeFs(): RunFs;
  now(): number;
  log: Logger;
  logLines: string[];
  stdout(line: string): void;
  stderr(line: string): void;
}

const EXIT_OK = 0;
const EXIT_REFUSED = 2;
const EXIT_ERROR = 1;

export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    deps.stderr((err as Error).message);
    deps.stderr('Nothing was sent and nothing was spent.');
    return EXIT_REFUSED;
  }

  const decision = decideRun(args);

  if (decision.kind === 'help') {
    deps.stdout(USAGE);
    return EXIT_OK;
  }

  let catalogue: Catalogue;
  try {
    catalogue = parseCatalogue(await deps.readText(args.cataloguePath));
  } catch (err) {
    deps.stderr((err as Error).message);
    deps.stderr('Nothing was sent and nothing was spent.');
    return EXIT_ERROR;
  }

  if (decision.kind === 'list') {
    for (const asset of catalogue.assets) {
      const state = asset.deferred !== undefined ? ' [deferred]' : asset.prompt === null ? ' [no prompt yet]' : '';
      deps.stdout(`${asset.id}\t${asset.class}\tstage ${asset.stage}\t${asset.name}${state}`);
    }
    return EXIT_OK;
  }

  if (decision.kind === 'refuse') {
    deps.stderr(decision.reason);
    return EXIT_REFUSED;
  }

  // ---------------------------------------------------------------------------------------
  // From here the decision is `dry-run`, `generate` or `resume`. The key and the transport are
  // still untouched, and on the dry-run branch below they stay that way — that branch returns
  // without ever mentioning `deps.loadSecret` or `deps.createTransport`.
  // ---------------------------------------------------------------------------------------

  if (decision.kind === 'dry-run') {
    let planned: PlannedRun;
    try {
      planned = planRun(catalogue, args);
    } catch (err) {
      deps.stderr((err as Error).message);
      deps.stderr('Nothing was sent and nothing was spent.');
      return EXIT_REFUSED;
    }

    if (!hasSelection(args)) deps.stdout(USAGE);
    for (const line of formatDryRun(catalogue, planned)) deps.stdout(line);

    if (args.preview !== null) {
      const references = new Map<string, { path: string; sha256: string; bytes: number }>();
      for (const asset of planned.assets) {
        if (asset.reference === null) continue;
        const described = describeReference(asset.reference, await deps.readFile(asset.reference));
        references.set(asset.id, {
          path: described.path,
          sha256: described.sha256,
          bytes: described.bytes,
        });
      }
      await deps.writeText(args.preview, buildPreview(catalogue, planned, references));
      deps.stdout(`Wrote the exact request bodies to ${args.preview}. Still nothing sent.`);
    }
    return EXIT_OK;
  }

  // THE PLAN IS BUILT BEFORE THE KEY IS READ. An unknown id, a deferred asset or a missing prompt
  // must fail without ever opening `.env` — there is no reason to touch a secret to discover that
  // the run was never going to happen. (Found by the no-spend test, which caught `loadSecret`
  // being reached on a run that the shipped prompt-less catalogue was always going to refuse.)
  let planned: PlannedRun | null = null;
  if (decision.kind === 'generate') {
    try {
      planned = planRun(catalogue, args);
    } catch (err) {
      deps.stderr((err as Error).message);
      deps.stderr('Nothing was sent and nothing was spent.');
      return EXIT_REFUSED;
    }
  }

  // The spending branches. THIS is the first line of the program that reads the key.
  try {
    const secret = await deps.loadSecret();
    const provider = deps.createTransport(secret, args, deps.log);
    const runDeps: RunDeps = {
      provider,
      fs: deps.makeFs(),
      now: deps.now,
      log: deps.log,
      logLines: deps.logLines,
    };

    const outcome =
      decision.kind === 'resume'
        ? await deps.resumeRun(
            {
              runId: args.resume as string,
              outDir: args.out,
              catalogue,
              assets: catalogue.assets,
              spendAllowed: decision.spendAllowed,
            },
            runDeps,
          )
        : await deps.runGeneration(
            {
              runId: formatRunId(deps.now(), args.mode, (planned as PlannedRun).assets.length),
              catalogue,
              assets: (planned as PlannedRun).assets,
              mode: args.mode,
              takes: args.takes,
              retakeRounds: args.retakeRounds,
              outDir: args.out,
              spendAllowed: decision.spendAllowed,
            },
            runDeps,
          );

    for (const line of outcome.summary) deps.stdout(line);
    deps.stdout(`Manifest: ${args.out}/${outcome.runId}/manifest.json`);
    return outcome.stoppedShort ? EXIT_REFUSED : EXIT_OK;
  } catch (err) {
    deps.stderr((err as Error).message);
    return EXIT_ERROR;
  }
}
