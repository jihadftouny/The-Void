// THE MONEY GUARD. (AC-6, AC-7, AC-8, AC-9, AC-11, and AC-3's import scan.)
//
// This file exists to make one sentence true and checkable: THIS TOOL CANNOT SPEND MONEY WITHOUT
// BEING TOLD TO, TWICE — once with `--confirm-spend` and once by naming what to generate.
//
// It is asserted two ways, because either alone is weak.
//
//  1. BY DEPENDENCIES THAT EXPLODE. Every non-spending run of `main` is given a `loadSecret` and a
//     `createTransport` that record the call and then throw. "It did not spend" therefore stops
//     being an absence of evidence and becomes a positive assertion: on a dry run, the object that
//     could call the network is never constructed, and the API key is never read. The check is
//     `touched` being empty — not the exit code — because `main` catches errors from the spending
//     branch, so a swallowed throw would otherwise look like an ordinary failure.
//
//  2. BY READING THE SOURCE. Dependency injection proves things about the paths a test walks.
//     A scan proves things about paths no test walks — that no module in this directory can reach
//     the network on its own at all, that no test imports the one file that would execute a real
//     run, and that nothing under `src/` (the game) imports this tooling into the shipped bundle.
//
// EVERY SCANNER BELOW IS ITSELF TESTED FIRST, against strings that are known violations and
// strings that are known-clean look-alikes. A scan with a subtly wrong pattern finds nothing on a
// clean tree and reads exactly like a scan that works.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Logger } from '../../src/log/logger.ts';
import { stripComments } from '../../src/log/sourceScan.testutil.ts';
import { main, type Args, type MainDeps } from './cli.ts';
import { createSecret, type Secret } from './secret.ts';
import { runGeneration, type RunFs } from './run.ts';
import type { GenerateHooks, ImageRequest, ImageResult, Provider } from './gemini.ts';
import { validateCatalogue } from './catalogue.ts';
import { encode as encodeJpeg } from 'jpeg-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CATALOGUE_TEXT = readFileSync(path.join(HERE, 'catalogue.json'), 'utf8');

/** The shipped catalogue with prompts authored, so a selection can actually be planned. */
const AUTHORED_TEXT = (() => {
  const raw = JSON.parse(CATALOGUE_TEXT) as { assets: { id: string; prompt: string | null }[] };
  for (const asset of raw.assets) asset.prompt = `a ${asset.id}`;
  return JSON.stringify(raw);
})();

const FAKE_KEY = 'AIzaFAKEfakeFAKEnotARealKey000000000000';

/** A flat-black 32x32 JPEG — passes the corner gate, so a run can complete. */
function blackJpeg(): Uint8Array {
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let o = 3; o < rgba.length; o += 4) rgba[o] = 255;
  return new Uint8Array(encodeJpeg({ data: Buffer.from(rgba), width: 32, height: 32 }, 100).data);
}

// =========================================================================================
// Harness
// =========================================================================================

interface Recorder {
  touched: string[];
  out: string[];
  err: string[];
}

function depsThatExplode(recorder: Recorder, over: Partial<MainDeps> = {}): MainDeps {
  const explode = (name: string) => {
    recorder.touched.push(name);
    throw new Error(`BOOM: ${name} was reached on a path that must not spend`);
  };

  return {
    readText: async () => AUTHORED_TEXT,
    // Reading a local reference image is not spending; it is allowed on a dry run.
    readFile: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    writeText: async () => {},
    loadSecret: async () => explode('loadSecret'),
    createTransport: () => explode('createTransport'),
    runGeneration: async () => explode('runGeneration'),
    resumeRun: async () => explode('resumeRun'),
    makeFs: () => explode('makeFs'),
    now: () => 1_700_000_000_000,
    log: new Logger(),
    logLines: [],
    stdout: (line) => recorder.out.push(line),
    stderr: (line) => recorder.err.push(line),
    ...over,
  };
}

function recorder(): Recorder {
  return { touched: [], out: [], err: [] };
}

// =========================================================================================
// AC-6 — without --confirm-spend, everything is a dry run, and nothing is constructed
// =========================================================================================

describe('no --confirm-spend means no key and no network client (AC-6)', () => {
  // Deliberately exhaustive rather than representative: the claim is about EVERY flag
  // combination, and the cheapest way to mean that is to enumerate them.
  const SELECTIONS: string[][] = [
    [],
    ['--asset', 'altar'],
    ['--asset', 'altar', '--asset', 'shrine'],
    ['--assets', 'altar,shrine,class-hollow'],
    ['--stage', '1'],
    ['--stage', '4'],
  ];
  const MODES: string[][] = [[], ['--mode', 'batch'], ['--mode', 'interactive']];
  const SHAPES: string[][] = [
    [],
    ['--takes', '1'],
    ['--takes', '3'],
    ['--retake-rounds', '0'],
    ['--retake-rounds', '2'],
    ['--reference', 'anchor.png'],
    ['--out', 'tmp-out'],
    ['--poll-seconds', '1'],
    ['--max-wait-hours', '1'],
    ['--verbose'],
    ['--dry-run'],
    ['--preview', 'preview.json'],
  ];

  const combinations: string[][] = [];
  for (const selection of SELECTIONS) {
    for (const mode of MODES) {
      for (const shape of SHAPES) combinations.push([...selection, ...mode, ...shape]);
    }
  }

  it(`covers ${String(combinations.length)} flag combinations, none of which may spend`, async () => {
    expect(combinations.length).toBe(6 * 3 * 12);

    const failures: string[] = [];
    for (const argv of combinations) {
      const rec = recorder();
      const code = await main(argv, depsThatExplode(rec));
      const printed = rec.out.join('\n');

      if (rec.touched.length > 0) {
        failures.push(`${argv.join(' ')} -> touched ${rec.touched.join(', ')}`);
      }
      if (code !== 0) failures.push(`${argv.join(' ')} -> exit ${code}`);
      if (!printed.includes('DRY RUN')) failures.push(`${argv.join(' ')} -> no DRY RUN banner`);
      if (!printed.includes('Nothing was sent and nothing was spent.')) {
        failures.push(`${argv.join(' ')} -> did not say nothing was sent`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('NEGATIVE CONTROL: the exploding deps really do explode when something calls them', async () => {
    // If `loadSecret` could be called without `touched` recording it, the sweep above would pass
    // for the wrong reason.
    const rec = recorder();
    const deps = depsThatExplode(rec);
    await expect(deps.loadSecret()).rejects.toThrow(/BOOM: loadSecret/);
    expect(() => deps.createTransport(createSecret(FAKE_KEY), {} as Args, new Logger())).toThrow(
      /BOOM: createTransport/,
    );
    expect(rec.touched).toEqual(['loadSecret', 'createTransport']);
  });

  it('an unparseable flag is refused before the catalogue is even read', async () => {
    const rec = recorder();
    const code = await main(['--confirm-spend', '--stage', '1', '--oops'], depsThatExplode(rec));
    expect(code).toBe(2);
    expect(rec.touched).toEqual([]);
    expect(rec.err.join('\n')).toContain('Nothing was sent and nothing was spent.');
  });

  it('a broken catalogue is refused without constructing anything', async () => {
    const rec = recorder();
    const code = await main(
      ['--confirm-spend', '--stage', '1'],
      depsThatExplode(rec, { readText: async () => '{ not json' }),
    );
    expect(code).toBe(1);
    expect(rec.touched).toEqual([]);
  });
});

// =========================================================================================
// AC-7 / AC-8 — the two ways --confirm-spend still does nothing
// =========================================================================================

describe('--confirm-spend alone is not enough (AC-7, AC-8)', () => {
  it('with NO selection it is refused, exit 2, transport never constructed (AC-7)', async () => {
    const rec = recorder();
    const code = await main(['--confirm-spend'], depsThatExplode(rec));
    expect(code).toBe(2);
    expect(rec.touched).toEqual([]);
    expect(rec.err.join('\n')).toContain('nothing was selected');
    expect(rec.err.join('\n')).toContain('Nothing was sent and nothing was spent.');
  });

  it('every no-selection shape is refused, not just the bare flag (AC-7)', async () => {
    for (const argv of [
      ['--confirm-spend'],
      ['--confirm-spend', '--mode', 'interactive'],
      ['--confirm-spend', '--takes', '3', '--retake-rounds', '2'],
      ['--confirm-spend', '--reference', 'anchor.png'],
      ['--confirm-spend', '--verbose', '--out', 'tmp'],
    ]) {
      const rec = recorder();
      expect(await main(argv, depsThatExplode(rec)), argv.join(' ')).toBe(2);
      expect(rec.touched, argv.join(' ')).toEqual([]);
    }
  });

  it('--confirm-spend --dry-run is a dry run; the dry run wins (AC-8)', async () => {
    for (const argv of [
      ['--confirm-spend', '--dry-run', '--stage', '1'],
      ['--dry-run', '--confirm-spend', '--asset', 'altar'],
      ['--confirm-spend', '--asset', 'altar', '--dry-run', '--mode', 'interactive'],
    ]) {
      const rec = recorder();
      expect(await main(argv, depsThatExplode(rec)), argv.join(' ')).toBe(0);
      expect(rec.touched, argv.join(' ')).toEqual([]);
      expect(rec.out.join('\n')).toContain('DRY RUN');
    }
  });

  it('--preview NEVER spends, even beside --confirm-spend and a selection (D1)', async () => {
    // THE OBSERVED DEFECT, verbatim: this command used to read .env, build the transport, submit
    // three images and never write the preview file — while --help promised it would "write the
    // exact request bodies to a file and exit".
    const rec = recorder();
    const written: { path: string; text: string }[] = [];
    const code = await main(
      ['--confirm-spend', '--asset', 'altar', '--retake-rounds', '0', '--preview', 'p.json'],
      depsThatExplode(rec, {
        writeText: async (p, text) => {
          written.push({ path: p, text });
        },
      }),
    );

    expect(rec.touched).toEqual([]); // no key read, no transport built
    expect(code).toBe(0);
    expect(rec.out.join('\n')).toContain('DRY RUN');
    // …and it actually did the thing it promised.
    expect(written.map((w) => w.path)).toEqual(['p.json']);
    expect(written[0]?.text).toContain('NOTHING WAS SENT');
    expect(written[0]?.text).toContain('altar');
    expect(rec.out.join('\n')).toContain('Wrote the exact request bodies to p.json');
  });

  it('--preview forces a dry run across every spending shape (D1)', async () => {
    // The rule is decided in `decideRun`, so it must hold for combinations `main` never
    // otherwise reaches — including --resume, which has its own branch.
    for (const argv of [
      ['--confirm-spend', '--asset', 'altar', '--preview', 'p.json'],
      ['--confirm-spend', '--stage', '1', '--preview', 'p.json'],
      ['--confirm-spend', '--assets', 'altar,shrine', '--mode', 'interactive', '--preview', 'p.json'],
      ['--confirm-spend', '--preview', 'p.json'], // no selection: still a dry run, not a refusal
      ['--confirm-spend', '--resume', 'run-1', '--preview', 'p.json'],
      ['--resume', 'run-1', '--preview', 'p.json'],
    ]) {
      const rec = recorder();
      const code = await main(argv, depsThatExplode(rec));
      expect(rec.touched, argv.join(' ')).toEqual([]);
      expect(code, argv.join(' ')).toBe(0);
      expect(rec.out.join('\n'), argv.join(' ')).toContain('DRY RUN');
    }
  });

  it('--resume without --confirm-spend is refused and reaches nothing', async () => {
    const rec = recorder();
    const code = await main(['--resume', '20260921-090000-batch-3'], depsThatExplode(rec));
    expect(code).toBe(2);
    expect(rec.touched).toEqual([]);
    expect(rec.err.join('\n')).toContain('Collecting a batch still calls the API');
  });

  it('--help and --list never construct anything, even beside --confirm-spend', async () => {
    for (const argv of [
      ['--help', '--confirm-spend', '--stage', '1'],
      ['--list', '--confirm-spend', '--stage', '1'],
    ]) {
      const rec = recorder();
      expect(await main(argv, depsThatExplode(rec)), argv.join(' ')).toBe(0);
      expect(rec.touched, argv.join(' ')).toEqual([]);
    }
  });
});

// =========================================================================================
// AC-9 — what happens when it IS allowed
// =========================================================================================

describe('with both the flag and a selection, it runs exactly once (AC-9)', () => {
  function memFs(): RunFs {
    const files = new Map<string, Uint8Array | string>();
    return {
      mkdir: async () => {},
      writeFile: async (p, d) => {
        files.set(p, d);
      },
      readFile: async (p) => {
        const v = files.get(p);
        if (v === undefined) throw new Error(`ENOENT ${p}`);
        return typeof v === 'string' ? new Uint8Array(Buffer.from(v, 'utf8')) : v;
      },
      exists: async (p) => files.has(p),
    };
  }

  it('constructs the transport EXACTLY ONCE and submits assets x takes in one batch', async () => {
    const batches: string[][] = [];
    let transportsBuilt = 0;
    let secretsLoaded = 0;

    const provider: Provider = {
      mode: 'batch',
      async generate(requests: ImageRequest[], hooks?: GenerateHooks): Promise<ImageResult[]> {
        batches.push(requests.map((r) => r.id));
        await hooks?.onSubmitted?.('batches/spy');
        return requests.map((r) => ({
          id: r.id,
          ok: true as const,
          mimeType: 'image/jpeg',
          bytes: blackJpeg(),
        }));
      },
      async resume() {
        throw new Error('not used');
      },
    };

    const rec = recorder();
    const code = await main(
      ['--confirm-spend', '--assets', 'altar,shrine', '--retake-rounds', '0'],
      depsThatExplode(rec, {
        loadSecret: async (): Promise<Secret> => {
          secretsLoaded += 1;
          return createSecret(FAKE_KEY);
        },
        createTransport: () => {
          transportsBuilt += 1;
          return provider;
        },
        runGeneration,
        makeFs: memFs,
      }),
    );

    expect(code).toBe(0);
    expect(secretsLoaded).toBe(1);
    expect(transportsBuilt).toBe(1);
    // 2 assets x 3 takes = 6 requests, in ONE batch call (§1b: batch within a group).
    expect(batches.length).toBe(1);
    expect(batches[0]).toEqual([
      'altar-r1-t1',
      'altar-r1-t2',
      'altar-r1-t3',
      'shrine-r1-t1',
      'shrine-r1-t2',
      'shrine-r1-t3',
    ]);
    expect(rec.out.join('\n')).toContain('Images submitted: 6');
    expect(rec.out.join('\n')).toContain('Cost: $0.402'); // 6 x 67 = 402, by hand
  });

  it('the summary names the manifest so the author knows where to look', async () => {
    const rec = recorder();
    const provider: Provider = {
      mode: 'batch',
      async generate(requests: ImageRequest[]): Promise<ImageResult[]> {
        return requests.map((r) => ({ id: r.id, ok: true as const, mimeType: 'image/jpeg', bytes: blackJpeg() }));
      },
      async resume() {
        throw new Error('not used');
      },
    };
    await main(
      ['--confirm-spend', '--asset', 'altar', '--takes', '1', '--retake-rounds', '0', '--out', 'tmp'],
      depsThatExplode(rec, {
        loadSecret: async () => createSecret(FAKE_KEY),
        createTransport: () => provider,
        runGeneration,
        makeFs: memFs,
      }),
    );
    expect(rec.out.join('\n')).toMatch(/Manifest: tmp\/\d{8}-\d{6}-batch-1\/manifest\.json/);
  });
});

// =========================================================================================
// AC-11 / AC-3 — the source scans
// =========================================================================================

const ART_FILES = readdirSync(HERE)
  .filter((f) => f.endsWith('.ts'))
  .sort();

/**
 * THE MODULES THAT SHIP — every `.ts` here that is not a test.
 *
 * The network and secret scans are aimed HERE, not at the test files, and that distinction is
 * load-bearing rather than convenient. A test file's job includes holding violating text: the
 * scanner proofs below contain the string `globalThis.fetch(url)` precisely so the matcher can be
 * shown to find it, and `secret.test.ts` contains `?key=<fake>` precisely to prove redaction
 * removes it. Scanning those as production code makes the guard fire on its own evidence — which
 * is exactly what the first version of this file did.
 *
 * The tests are still covered, by what they IMPORT rather than by what text they contain — see
 * "no test can reach the network" below. A free-text scan of a test file cannot work: removing
 * string literals needs a lexer that understands regular-expression literals (a `/'/` swallows
 * everything to the next quote), which is the documented hole in `sourceScan.testutil.ts`'s own
 * header, and this file is full of regex literals. Imports are checkable without that, and they
 * are the only way a test could obtain a network client in the first place — `gemini.ts` takes
 * `fetch` as a parameter and has no global fallback, which the module scan proves.
 */
const ART_MODULES = ART_FILES.filter((f) => !f.endsWith('.test.ts'));
const ART_TESTS = ART_FILES.filter((f) => f.endsWith('.test.ts'));

function artSource(file: string): string {
  return stripComments(readFileSync(path.join(HERE, file), 'utf8'));
}

/** Every module specifier a file imports, in any spelling. */
const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g;

function importsOf(file: string): string[] {
  return [...artSource(file).matchAll(SPECIFIER_RE)].map((m) => m[2] as string);
}

/** A reference to the GLOBAL fetch, in any spelling that actually reaches the network. */
const GLOBAL_FETCH = /\bglobalThis\s*\.\s*fetch\b|(?<![.\w$])fetch\s*\(/;
/** A read of the process environment. */
const PROCESS_ENV = /\bprocess\s*\.\s*env\b/;
/** A raw HTTP client that would bypass the injected `fetch` entirely. */
const RAW_HTTP = /(['"`])(node:)?(https?|undici)\1/;
/** The key smuggled into a URL. */
const KEY_IN_URL = /[?&]key\s*=/;

describe('the source scanners, before they are trusted (AC-11)', () => {
  /**
   * A single quote, assembled at runtime.
   *
   * The fixtures below must LOOK like imports to the matchers at runtime while not BEING imports
   * in this file's own text — otherwise the import scan finds this file's evidence and reports it
   * as a violation, which is exactly what happened when they were written as plain literals.
   * Interpolating the quote keeps the `from '…'` shape from ever appearing contiguously here.
   */
  const Q = String.fromCharCode(39);

  const FETCH_VIOLATIONS = [
    'const r = await fetch(url);',
    'const r = globalThis.fetch(url);',
    'const r = await globalThis . fetch (url);',
    'return fetch(buildUrl(model, op), init);',
  ];
  const FETCH_CLEAN = [
    'const r = await deps.fetch(url, init);',
    'const fetchLike: FetchLike = async (url, init) => ({ ok: true });',
    'interface Deps { fetch: FetchLike }',
    'const { fetch: doFetch } = deps;',
    'this.fetch(url);',
  ];

  it('the global-fetch matcher finds every violation', () => {
    expect(FETCH_VIOLATIONS.filter((s) => GLOBAL_FETCH.test(s))).toEqual(FETCH_VIOLATIONS);
  });
  it('…and none of the clean look-alikes', () => {
    expect(FETCH_CLEAN.filter((s) => GLOBAL_FETCH.test(s))).toEqual([]);
  });

  it('the process.env matcher works both ways', () => {
    expect(PROCESS_ENV.test('const k = process.env.GOOGLE_API_KEY;')).toBe(true);
    expect(PROCESS_ENV.test('const k = process . env ["X"];')).toBe(true);
    expect(PROCESS_ENV.test('function loadSecretFrom(text, env) { return env.X; }')).toBe(false);
    expect(PROCESS_ENV.test('process.argv.slice(2)')).toBe(false);
  });

  it('the raw-HTTP matcher works both ways', () => {
    for (const module of ['node:https', 'http', 'undici', 'node:http', 'https']) {
      expect(RAW_HTTP.test(`import x from ${Q}${module}${Q};`), module).toBe(true);
    }
    // The API's own base URL is a URL, not an import of the `https` module.
    expect(
      RAW_HTTP.test(`const API_BASE = ${Q}https://generativelanguage.googleapis.com/v1beta${Q};`),
    ).toBe(false);
  });

  it('the key-in-URL matcher works both ways', () => {
    expect(KEY_IN_URL.test('const u = `${base}?key=${secret}`;')).toBe(true);
    expect(KEY_IN_URL.test('const u = base + "&key=" + value;')).toBe(true);
    expect(KEY_IN_URL.test("metadata: { key: request.id }")).toBe(false);
    expect(KEY_IN_URL.test("headers['x-goog-api-key'] = value;")).toBe(false);
  });

  it('the import-specifier matcher finds every import spelling', () => {
    const source = [
      `import { a } from ${Q}./a.ts${Q};`,
      `import ${Q}node:https${Q};`,
      `const m = await import(${Q}undici${Q});`,
      `const n = require(${Q}node:http${Q});`,
      `import type { T } from ${Q}./t.ts${Q};`,
    ].join('\n');
    expect([...source.matchAll(SPECIFIER_RE)].map((m) => m[2])).toEqual([
      './a.ts',
      'node:https',
      'undici',
      'node:http',
      './t.ts',
    ]);
  });

  it('the comment stripper reaches the end of every file it will be run on', () => {
    for (const file of ART_FILES) {
      const raw = readFileSync(path.join(HERE, file), 'utf8');
      expect(stripComments(`${raw}\nSENTINEL_${file}`), file).toContain(`SENTINEL_${file}`);
    }
  });
});

describe('only generate.ts can reach the outside world (AC-11)', () => {
  it('finds the art modules at all', () => {
    // A scan over an empty file list passes vacuously.
    expect(ART_MODULES).toContain('generate.ts');
    expect(ART_MODULES).toContain('gemini.ts');
    expect(ART_MODULES).toContain('cli.ts');
    expect(ART_MODULES.length).toBeGreaterThanOrEqual(7);
    expect(ART_TESTS.length).toBeGreaterThanOrEqual(7);
  });

  it('no module but generate.ts references the global fetch', () => {
    const offenders = ART_MODULES.filter(
      (f) => f !== 'generate.ts' && GLOBAL_FETCH.test(artSource(f)),
    );
    expect(offenders).toEqual([]);
    // …and generate.ts really does, so the scan is looking at the right thing.
    expect(GLOBAL_FETCH.test(artSource('generate.ts'))).toBe(true);
  });

  it('no module but generate.ts reads process.env', () => {
    const offenders = ART_MODULES.filter(
      (f) => f !== 'generate.ts' && PROCESS_ENV.test(artSource(f)),
    );
    expect(offenders).toEqual([]);
    expect(PROCESS_ENV.test(artSource('generate.ts'))).toBe(true);
  });

  it('no module imports a raw HTTP client', () => {
    expect(ART_MODULES.filter((f) => RAW_HTTP.test(artSource(f)))).toEqual([]);
  });

  it('no module builds a URL with the key in a query string', () => {
    expect(ART_MODULES.filter((f) => KEY_IN_URL.test(artSource(f)))).toEqual([]);
  });

  it('no test can reach the network: none of them imports an HTTP client', () => {
    // The only ways a test could obtain one are an import or the global `fetch`. Imports are
    // checked here; the global is unreachable because `gemini.ts` takes `fetch` as a parameter
    // with no fallback, which the module scans above establish.
    const offenders: string[] = [];
    for (const file of ART_TESTS) {
      for (const specifier of importsOf(file)) {
        if (/^(node:)?(https?|undici)$/.test(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no test imports ./generate — importing it would EXECUTE a run', () => {
    // `generate.ts` calls `main(...)` at module scope. An `import` of it from a test file would
    // run the tool for real, against the real filesystem and the real key.
    const offenders: string[] = [];
    for (const file of ART_TESTS) {
      for (const specifier of importsOf(file)) {
        if (/(^|\/)generate(\.ts)?$/.test(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);

    // The matcher is not vacuous: it finds the shape it is looking for.
    expect(/(^|\/)generate(\.ts)?$/.test('./generate.ts')).toBe(true);
    expect(/(^|\/)generate(\.ts)?$/.test('./generate')).toBe(true);
    expect(/(^|\/)generate(\.ts)?$/.test('./catalogue.ts')).toBe(false);
  });

  it('every art test imports at least one art module — none is scanning nothing', () => {
    for (const file of ART_TESTS) {
      const local = importsOf(file).filter((s) => s.startsWith('./'));
      expect(local.length, `${file} imports no local module`).toBeGreaterThan(0);
    }
  });

  it('generate.ts is the only module that calls process.exit', () => {
    const EXIT = /\bprocess\s*\.\s*exit\s*\(/;
    expect(ART_MODULES.filter((f) => f !== 'generate.ts' && EXIT.test(artSource(f)))).toEqual([]);
    expect(EXIT.test(artSource('generate.ts'))).toBe(true);
  });
});

describe('the game never imports the art tooling (AC-3)', () => {
  const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g;

  function walk(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) found.push(...walk(full));
      else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry)) found.push(full);
    }
    return found;
  }

  const SRC_FILES = walk(path.join(REPO, 'src'));

  it('finds the game source at all', () => {
    expect(SRC_FILES.length).toBeGreaterThan(50);
  });

  it('no file under src/ imports anything from scripts/', () => {
    // The tool pulls in pngjs and jpeg-js and knows an API key exists. None of that may ever be
    // reachable from the shipped bundle — ART-BIBLE §9: "it never ships in the game bundle".
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      const clean = stripComments(readFileSync(file, 'utf8'));
      for (const match of clean.matchAll(SPECIFIER)) {
        const specifier = match[2] as string;
        if (/(^|\/)scripts\//.test(specifier)) {
          offenders.push(`${path.relative(REPO, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the import-specifier matcher works both ways', () => {
    const hits = (source: string): string[] =>
      [...stripComments(source).matchAll(SPECIFIER)]
        .map((m) => m[2] as string)
        .filter((s) => /(^|\/)scripts\//.test(s));

    expect(hits("import { cornerGate } from '../../scripts/art/image.ts';")).toEqual([
      '../../scripts/art/image.ts',
    ]);
    expect(hits("const m = await import('./scripts/art/catalogue.ts');")).toEqual([
      './scripts/art/catalogue.ts',
    ]);
    expect(hits("import x from '../game/rng.ts';")).toEqual([]);
    // A COMMENT mentioning the path must not trip it — that shape has caused a false red here
    // before (see sourceScan.testutil.ts's header).
    expect(hits("// see '../../scripts/art/image.ts' for the gate\nimport y from './a.ts';")).toEqual([]);
  });
});

describe('the catalogue ships with no prompt, so even a confirmed run generates nothing', () => {
  it('--confirm-spend on the SHIPPED catalogue is refused for want of a prompt', async () => {
    // The last line of defence, and the reason this unit can honestly claim $0: even if every
    // flag were right, the shipped catalogue has nothing to send. Authoring prompts is #4/#5.
    const rec = recorder();
    const code = await main(
      ['--confirm-spend', '--stage', '1'],
      depsThatExplode(rec, { readText: async () => CATALOGUE_TEXT }),
    );
    expect(code).toBe(2);
    expect(rec.touched).toEqual([]);
    expect(rec.err.join('\n')).toContain('no authored prompt');
  });

  it('every prompt in the shipped catalogue really is null', () => {
    const catalogue = validateCatalogue(JSON.parse(CATALOGUE_TEXT));
    expect(catalogue.assets.every((a) => a.prompt === null)).toBe(true);
  });
});
