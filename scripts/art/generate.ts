// THE ENTRY POINT — and the ONLY impure file in `scripts/art/`.
//
// Everything that touches the outside world is here and nowhere else: `globalThis.fetch`,
// `process.env`, reading `.env`, the real filesystem, `process.exit`, the console. Every other
// module in this directory is a pure function of its arguments, which is what lets the test suite
// drive the whole tool — the gates, the money, the batch lifecycle, the re-queue logic — without a
// socket, a file or a key.
//
// NO TEST IMPORTS THIS FILE, and `noSpend.test.ts` asserts that. Importing it would execute the
// `main(...)` call at the bottom, which is precisely the thing that must never happen by accident.
//
// Run it with:  npm run art -- --help
//
// The key is read by `loadSecret` below, and `loadSecret` is only ever CALLED from the branches of
// `main` that the decision permits to spend. On a dry run it is passed in and never invoked, so a
// dry run does not read `.env` at all — that is asserted with a `loadSecret` that throws.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { consoleSink, Logger, formatEntry } from '../../src/log/logger.ts';
import { main, type Args, type MainDeps } from './cli.ts';
import { createBatchProvider, createInteractiveProvider, type FetchLike, type Provider } from './gemini.ts';
import { loadSecretFrom, type Secret } from './secret.ts';
import { findResumePoint, resumeRun, runGeneration, type RunFs } from './run.ts';

const argv = process.argv.slice(2);

const log = new Logger();
const logLines: string[] = [];
log.addSink((entry) => logLines.push(JSON.stringify(entry)));
// The human summary goes to stdout regardless; the structured log only mirrors to the console
// when it is asked for. `run.log.jsonl` always gets everything.
if (argv.includes('--verbose')) log.addSink(consoleSink);

/** The real filesystem, behind the same tiny facade the tests fake. */
const realFs: RunFs = {
  mkdir: async (p) => {
    await mkdir(p, { recursive: true });
  },
  writeFile: async (p, data) => {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  },
  readFile: async (p) => new Uint8Array(await readFile(p)),
  exists: async (p) => existsSync(p),
};

/**
 * The key, from the environment or from gitignored `.env`.
 *
 * This function is the ONLY reader of either. It is passed to `main` as a dependency and invoked
 * only on a spending path — so on a dry run the file is never opened, which matters on a machine
 * where `.env` does not exist at all (it does not, in a fresh clone or in CI).
 */
async function loadSecret(): Promise<Secret> {
  const dotEnvPath = path.resolve(process.cwd(), '.env');
  const text = existsSync(dotEnvPath) ? await readFile(dotEnvPath, 'utf8') : undefined;
  return loadSecretFrom(text, process.env);
}

function createTransport(secret: Secret, args: Args, logger: Logger): Provider {
  // The one reference to the global `fetch` in this directory.
  const doFetch: FetchLike = (url, init) =>
    globalThis.fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

  const deps = {
    fetch: doFetch,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: logger,
    secret,
  };
  const options = {
    model: 'gemini-3-pro-image',
    pollIntervalMs: args.pollSeconds * 1000,
    maxWaitMs: args.maxWaitHours * 60 * 60 * 1000,
    displayName: `the-void-art-${new Date().toISOString().slice(0, 10)}`,
  };

  return args.mode === 'batch'
    ? createBatchProvider(deps, options)
    : createInteractiveProvider(deps, options);
}

const deps: MainDeps = {
  readText: (p) => readFile(p, 'utf8'),
  readFile: async (p) => new Uint8Array(await readFile(p)),
  writeText: async (p, text) => {
    await mkdir(path.dirname(path.resolve(p)), { recursive: true });
    await writeFile(p, text, 'utf8');
  },
  loadSecret,
  createTransport,
  runGeneration,
  resumeRun,
  resumePreflight: (runId, outDir) => findResumePoint(runId, outDir, realFs),
  makeFs: () => realFs,
  now: () => Date.now(),
  log,
  logLines,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

main(argv, deps)
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    // Log before exiting: a crash that leaves no record is the failure CLAUDE.md principle 7 was
    // added for. `formatEntry` keeps this line the same shape as everything in run.log.jsonl.
    process.stderr.write(
      `${formatEntry({
        time: Date.now(),
        level: 'error',
        category: 'art.error',
        message: 'the art tool crashed',
        data: { error: (err as Error).message },
      })}\n`,
    );
    process.exit(1);
  });
