// THE CHEAT PANEL IS NOT IN THE PACKAGED BUILD — proved by running the REAL bundler.
//
// The author's decision (plan Appendix A.2) is absolute: never in a packaged build, no
// exceptions, no switch, no env var, no separately-signed dev artifact. The cost was named to
// him — he cannot jump states inside a packaged build, so packaged-build verification stays
// full-run — and accepted. A cheat panel reachable from what a player runs is one boolean away
// from shipping, and this project has been bitten by that polarity family five times.
//
// ---------------------------------------------------------------------------------------
// WHY A SUBPROCESS, AND WHY THE ENVIRONMENT IS SCRUBBED. THIS IS THE WHOLE GUARD.
//
// Vitest sets `NODE_ENV=test`. Vite decides `isProduction` from `process.env.NODE_ENV`
// BEFORE it looks at `--mode`, so an IN-PROCESS `build({ mode: 'production' })` under Vitest
// leaves `import.meta.env.DEV === true` and bundles the panel — while the test reports a
// clean production build. MEASURED on this tree, not reasoned about: with `NODE_ENV=test`
// the build emits 75 modules and a separate panel chunk; with `NODE_ENV` unset it emits 73
// and no panel at all. That measurement is not a footnote — it is asserted below as its own
// test, so the environment scrubbing can never be quietly removed.
//
// The same fact bites the DEV CONTROL from the other side: `vite build --mode development`
// ALONE is byte-identical to the production build (same chunk hash, no panel), because the
// mode flag does not move `NODE_ENV`. The control therefore sets `NODE_ENV=development`
// explicitly. A control that did not actually enable the panel would make the production
// assertion below meaningless — it would be measuring a bundler that simply never included
// the module in the first place.
//
// THREE THINGS THIS PROOF MUST HAVE, and each is a separate test:
//   1. the DEV CONTROL — the marker PRESENT, so absence in production means something;
//   2. SOURCEMAPS IN THE SWEEP — a cheat panel recoverable from a shipped `.map` is shipped,
//      and `vite.config.ts` sets `sourcemap: true`, so the maps carry `sourcesContent`;
//   3. NON-VACUITY — the sweep can find a string that IS in the bundle, or it proves nothing.
// ---------------------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';
import { PANEL_ID } from './panel.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/** A string that really is in every shipped bundle — the title screen's only button. */
const SHIPPED_STRING = 'Descend into the Void';

/** One emitted artifact: its path relative to the build's outDir, and its full text. */
interface Emitted {
  file: string;
  text: string;
}

/** Every file a build emitted, read as text — chunks, HTML, CSS **and** sourcemaps. */
function readEmitted(outDir: string): Emitted[] {
  const out: Emitted[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else out.push({ file: `${prefix}${entry.name}`, text: readFileSync(full, 'utf8') });
    }
  };
  walk(outDir, '');
  return out;
}

/**
 * Run the REAL bundler in a subprocess, with an environment we control completely.
 *
 * `nodeEnv: null` DELETES `NODE_ENV` from the child, which is exactly what `npm run build`
 * hands it — so this is the same invocation the shipped artifact comes from, not an
 * approximation of it.
 */
function build(outSubdir: string, mode: string, nodeEnv: string | null): Emitted[] {
  const outDir = path.join(ROOT, 'dist', outSubdir);
  rmSync(outDir, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (nodeEnv === null) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  execFileSync(
    process.execPath,
    [VITE_BIN, 'build', '--mode', mode, '--outDir', path.join('dist', outSubdir)],
    { cwd: ROOT, env, stdio: 'pipe' },
  );
  return readEmitted(outDir);
}

const OUT_PROD = '__devguard-prod';
const OUT_DEV = '__devguard-dev';
const OUT_TEST_ENV = '__devguard-testenv';

let prod: Emitted[] = [];
let dev: Emitted[] = [];
let underTestEnv: Emitted[] = [];

// Three real builds. Measured at roughly 4 s, 0.5 s and 0.5 s on this tree; the explicit
// timeout is because Vitest's default is 5 s and would flake the first one.
beforeAll(() => {
  prod = build(OUT_PROD, 'production', null);
  dev = build(OUT_DEV, 'development', 'development');
  underTestEnv = build(OUT_TEST_ENV, 'production', 'test');
}, 300_000);

afterAll(() => {
  for (const dir of [OUT_PROD, OUT_DEV, OUT_TEST_ENV]) {
    rmSync(path.join(ROOT, 'dist', dir), { recursive: true, force: true });
  }
});

/** Every emitted file containing `needle`, by name — so a failure says WHERE it leaked. */
function filesContaining(emitted: readonly Emitted[], needle: string): string[] {
  return emitted.filter((e) => e.text.includes(needle)).map((e) => e.file);
}

describe('the bundler proof', () => {
  it('all three builds actually produced artifacts (or every sweep below is empty)', () => {
    for (const [what, emitted] of [
      ['production', prod],
      ['development', dev],
      ['under NODE_ENV=test', underTestEnv],
    ] as const) {
      expect(emitted.length, `the ${what} build emitted nothing`).toBeGreaterThan(2);
      expect(
        emitted.filter((e) => e.file.endsWith('.js')).length,
        `the ${what} build emitted no JavaScript`,
      ).toBeGreaterThan(0);
      for (const file of emitted) {
        expect(file.text.length, `${what}: ${file.file} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('NON-VACUITY: the sweep finds a string that IS in the production bundle', () => {
    // Without this, "the marker is in no file" is satisfied by a scan that cannot see
    // anything at all.
    const hits = filesContaining(prod, SHIPPED_STRING);
    expect(hits, `'${SHIPPED_STRING}' is in no emitted file — the sweep reads nothing`).not.toEqual(
      [],
    );
    expect(hits.some((f) => f.endsWith('.js')), 'the shipped string is in no JS chunk').toBe(true);
  });

  it('NON-VACUITY: sourcemaps are emitted, and they carry original sources', () => {
    // The sourcemap half of the sweep proves nothing unless the maps exist AND contain the
    // pre-bundling source. `vite.config.ts` sets `sourcemap: true`; this is that, asserted.
    const maps = prod.filter((e) => e.file.endsWith('.map'));
    expect(maps.length, 'no sourcemaps emitted — the .map sweep guards nothing').toBeGreaterThan(0);
    const map = JSON.parse(maps[0]!.text) as { sources: string[]; sourcesContent?: string[] };
    expect(Array.isArray(map.sourcesContent), 'the map carries no sourcesContent').toBe(true);
    expect(map.sources.some((s) => s.includes('desktop/game.ts'))).toBe(true);
  });

  it('NON-VACUITY: the .map half of the sweep finds what the .js half CANNOT', () => {
    // The requirement is "sourcemaps in the absent-sweep", and this is why it is not
    // ceremonial. `function adoptRun` is a real, shipped declaration; the minifier renames it
    // out of the chunk entirely, and it survives VERBATIM in the map's `sourcesContent`.
    // MEASURED on this tree: the identifier `adoptRun` does not occur in the emitted `.js` at
    // all, and occurs in the `.map`. So a cheat panel dropped from the chunk but left in the
    // map would be invisible to a chunks-only sweep and fully readable to a player.
    const hits = filesContaining(prod, 'function adoptRun');
    expect(hits, 'the map exposes no original source — the .map sweep adds nothing').not.toEqual([]);
    expect(hits.every((f) => f.endsWith('.map')), `found in ${hits.join(', ')}`).toBe(true);
    expect(
      filesContaining(prod, 'adoptRun').some((f) => f.endsWith('.js')),
      'the identifier survived minification, so this example no longer proves the point — ' +
        'pick another that the minifier really does rename away',
    ).toBe(false);
  });

  it('THE CONTROL: a development build DOES contain the panel marker in a JS chunk', () => {
    const hits = filesContaining(dev, PANEL_ID);
    expect(
      hits,
      'the DEV build does not contain the panel either — the production assertion below ' +
        'would then be measuring a bundler that never included it, or a deleted panel',
    ).not.toEqual([]);
    expect(hits.some((f) => f.endsWith('.js')), `marker only in ${hits.join(', ')}`).toBe(true);
  });

  it('THE ASSERTION: the production build contains the marker in NO file — .map included', () => {
    expect(
      filesContaining(prod, PANEL_ID),
      'the developer state panel is in the packaged build',
    ).toEqual([]);
  });

  it('...and no other trace of the dev directory reaches a production chunk', () => {
    // A second marker, from the other end of the module: the loud session warning. If the
    // panel were bundled under a renamed id, the id sweep alone would miss it.
    for (const needle of ['THIS SESSION IS NO LONGER A REAL RUN', 'DEV STATE PANEL', 'buildJump']) {
      expect(filesContaining(prod, needle), `'${needle}' reached the production build`).toEqual([]);
    }
  });

  it('the production build is SMALLER than the dev one, so something was really dropped', () => {
    // A size delta is independent of every string sweep above: if the panel had been
    // included and merely renamed, the two bundles would be the same size.
    const size = (emitted: readonly Emitted[]) =>
      emitted.filter((e) => e.file.endsWith('.js')).reduce((n, e) => n + e.text.length, 0);
    expect(size(prod)).toBeLessThan(size(dev));
  });

  it('THE TRAP: under Vitest’s own NODE_ENV=test, a "production" build SHIPS the panel', () => {
    // The reason this whole file spawns subprocesses, asserted rather than described. This
    // is the shape the guard would fail in silently: an in-process build, or a subprocess
    // that inherited the parent environment, is NOT a production build — and it looks
    // exactly like one in the log.
    expect(process.env.NODE_ENV, 'Vitest no longer sets NODE_ENV=test').toBe('test');
    const hits = filesContaining(underTestEnv, PANEL_ID);
    expect(
      hits,
      'a build inheriting NODE_ENV=test no longer includes the panel — if that is a real ' +
        'change in Vite, this test is now proving nothing and must be re-derived',
    ).not.toEqual([]);
    // ...which is precisely what the scrubbed environment prevents.
    expect(filesContaining(prod, PANEL_ID)).toEqual([]);
  });
});

// =========================================================================================
// The DIRECTION scan. Polarity-blind by nature, and labelled as such: it catches the SHAPE
// ("someone made it a static import", "someone imported the panel from `debug-overlay.ts`"),
// while the bundler proof above catches the EFFECT. It is a supplement, never the guard.
// =========================================================================================

/** Every module specifier reached by an import in any spelling (the `purity.test.ts` idiom). */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g;

/** True when a specifier resolves into the dev directory, however many `../` hops it takes. */
function importsDev(specifier: string): boolean {
  return /(?:^|\/)dev\/[A-Za-z0-9_.-]+$/.test(specifier);
}

/** The dev imports in one file's source, as `line:specifier` strings. */
function devImports(source: string): string[] {
  const clean = stripComments(source);
  const hits: string[] = [];
  for (const m of clean.matchAll(SPECIFIER)) {
    const specifier = m[2] as string;
    if (!importsDev(specifier)) continue;
    hits.push(`${clean.slice(0, m.index).split('\n').length}:${specifier}`);
  }
  return hits;
}

/** Every `.ts` file under `src`, as repo-relative posix paths. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/`);
      else if (entry.name.endsWith('.ts')) out.push(rel);
    }
  };
  walk('src', 'src/');
  return out;
}

describe('the import-direction scan', () => {
  it('the detector fires on every spelling of a dev import (or it guards nothing)', () => {
    // The tree currently holds exactly ONE dev import outside the directory, so without
    // these the sweep below would pass whether or not the detector works.
    const VIOLATIONS = [
      `import { mountDebugPanel } from '../dev/panel.ts';`,
      `import type { JumpSpec } from '../../dev/devState.ts';`,
      `const m = await import('./dev/panel.ts');`,
      `import '../dev/panel';`,
      `const p = require('../../dev/devState');`,
      'import {buildJump} from `../dev/devState.ts`;',
    ];
    for (const source of VIOLATIONS) {
      expect(devImports(source), source).toHaveLength(1);
    }
  });

  it('and does NOT fire on things that merely look like one', () => {
    const CLEAN = [
      `// never import ../dev/panel.ts from a shipping module`,
      `import { createGame } from '../game/game.ts';`,
      `import { logLines } from '../render/log-model.ts';`,
      `import table from './data/development.json';`,
      `const dev = true;`,
    ];
    for (const source of CLEAN) {
      expect(devImports(source), source).toEqual([]);
    }
  });

  it('no file outside the dev directory imports it, except the renderer', () => {
    const files = sourceFiles();
    expect(files.length, 'no source files found — this scan reads nothing').toBeGreaterThan(60);
    expect(files, 'the renderer is outside the scan').toContain('src/desktop/game.ts');
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel.startsWith('src/dev/')) continue;
      if (rel === 'src/desktop/game.ts') continue;
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      for (const hit of devImports(source)) offenders.push(`${rel}:${hit}`);
    }
    expect(
      offenders,
      'a module outside the dev directory imports it — that module ships, and it would ' +
        'drag the whole panel into the packaged bundle with it',
    ).toEqual([]);
  });

  it('the renderer imports it EXACTLY ONCE, dynamically, and never statically', () => {
    const raw = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
    const source = stripComments(raw);
    expect(stripReachesEndOfFile(raw), 'the strip ran off the end of game.ts').toBe(true);
    expect(devImports(raw), 'the renderer no longer reaches the panel at all').toHaveLength(1);
    // A STATIC import would put the panel in the module graph unconditionally, which is the
    // whole defect. Matched in every spelling a static import can take.
    expect(source, 'the panel is imported statically — it would ship').not.toMatch(
      /\bfrom\s*['"`][^'"`]*\/dev\/[^'"`]*['"`]/,
    );
    expect(source, 'a bare side-effect import of the panel').not.toMatch(
      /\bimport\s+['"`][^'"`]*\/dev\/[^'"`]*['"`]/,
    );
    // ...and the one import that remains is a dynamic call.
    expect(source).toMatch(/\bimport\s*\(\s*['"`][^'"`]*\/dev\/panel\.ts['"`]\s*\)/);
  });
});

// =========================================================================================
// The two BRANCHES this unit added to `src/desktop/game.ts`, and the seam it extracted.
// `game.ts` cannot be imported (it calls the Electron IPC at module scope — G51), so wiring
// is asserted by reading it, exactly as `rendererSource.test.ts` and
// `instrumentationSource.test.ts` already do.
// =========================================================================================

describe('the renderer wiring', () => {
  const raw = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
  const source = stripComments(raw);

  it('the strip left the file intact (or every scan below reads a hole)', () => {
    expect(stripReachesEndOfFile(raw)).toBe(true);
    expect(source).toMatch(/function adoptRun\(/);
    expect(source).toMatch(/function adoptFromPanel\(/);
    expect(source, 'the strip ate the tail of game.ts').toMatch(/mountDebugPanel/);
  });

  it('the DEV guard is POSITIVE — negated, it ships the panel and hides it in dev', () => {
    // The mutation is a single character, and it inverts the one guarantee this unit sells.
    expect(source, 'the dev-only guard is gone').toMatch(
      /if\s*\(\s*import\.meta\.env\.DEV\s*\)/,
    );
    expect(source, 'the DEV guard is negated — the panel would ship').not.toMatch(
      /if\s*\(\s*!\s*import\.meta\.env\.DEV\s*\)/,
    );
    // `if (true)` / a deleted guard: the import must sit inside a condition that mentions
    // `import.meta.env.DEV`, not merely somewhere in the file.
    const guard = source.search(/if\s*\(\s*import\.meta\.env\.DEV\s*\)/);
    const dynamic = source.search(/\bimport\s*\(\s*['"`][^'"`]*\/dev\/panel\.ts['"`]/);
    expect(guard, 'no DEV guard at all').toBeGreaterThan(-1);
    expect(dynamic, 'no dynamic import of the panel').toBeGreaterThan(-1);
    expect(guard, 'the panel import is not inside the DEV guard').toBeLessThan(dynamic);
    expect(dynamic - guard, 'the import is far from its guard — is it still inside it?').toBeLessThan(
      400,
    );
  });

  it('the panel adoption refuses while the renderer is BUSY, positively', () => {
    // Inverted, this adopts only mid-turn: the in-flight `dispatch` then renders its stale
    // `awaiting` over the jumped state, and every jump made from an idle panel is refused.
    const start = source.indexOf('function adoptFromPanel(');
    expect(start, 'adoptFromPanel is gone — this guard has gone stale').toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}', start));
    expect(body, 'the busy guard is gone — a jump can land mid-turn').toMatch(
      /if\s*\(\s*busy\s*\)\s*return\s+false\s*;/,
    );
    expect(body, 'the busy guard is negated — it adopts ONLY mid-turn').not.toMatch(
      /if\s*\(\s*!\s*busy\s*\)/,
    );
  });

  it('BOTH callers go through the one adoptRun seam', () => {
    // Appendix A.2's requirement, asserted rather than promised: if the panel had its own
    // copy of the adoption block, the two would drift and the divergence would surface in
    // the field rather than in a test.
    const calls = [...source.matchAll(/\badoptRun\s*\(/g)];
    // One declaration plus two call sites.
    expect(calls.length, 'adoptRun is not called from two places').toBe(3);
    const panelBody = source.slice(
      source.indexOf('function adoptFromPanel('),
      source.indexOf('\n}', source.indexOf('function adoptFromPanel(')),
    );
    expect(panelBody, 'the panel path does not use the shared seam').toMatch(/adoptRun\s*\(\s*saved\s*\)/);
    const bootStart = source.indexOf('const saved = loadRun()');
    expect(bootStart, 'the boot block is gone').toBeGreaterThan(-1);
    expect(source.slice(bootStart), 'the resume path does not use the shared seam').toMatch(
      /adoptRun\s*\(\s*saved\s*\)/,
    );
  });

  it('the seam still satisfies every pre-existing guard on this file', () => {
    // Restating the three that the extraction could most easily have broken, so a failure
    // here names the cause instead of appearing as a puzzling failure in another file.
    expect(source, 'the adoptRun parameter is no longer named `saved`').toMatch(
      /function adoptRun\(\s*saved\s*:/,
    );
    expect(source).toMatch(/state\s*=\s*saved\.state/);
    expect(source).toMatch(/if\s*\(\s*saved\.meta\s*\)/);
    expect(
      (raw.match(/runSeed = Date\.now\(\) >>> 0/g) ?? []).length,
      'the run-seed lines moved — purity.test.ts pins them at exactly two',
    ).toBe(2);
  });
});

// =========================================================================================
// DETERMINISM, as source. `devState.test.ts` proves behaviourally that two builds of the
// same spec are identical; this proves there is no clock or unseeded source anywhere in the
// directory that a future edit could reach for.
// =========================================================================================

describe('nothing in the dev directory reads a clock or an unseeded random', () => {
  const FORBIDDEN = /\bMath\s*\.\s*random\s*\(|\bDate\s*\.\s*now\s*\(|\bperformance\s*\.\s*now\s*\(/;

  /** Every shipping `.ts` file in the dev directory (tests excluded). */
  function devFiles(): { name: string; source: string }[] {
    const dir = path.join(ROOT, 'src/dev');
    return readdirSync(dir)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
      .map((n) => ({ name: `src/dev/${n}`, source: readFileSync(path.join(dir, n), 'utf8') }));
  }

  it('the detector fires on each spelling, and not on innocent text', () => {
    for (const source of [
      'const x = Math.random();',
      'const x = Math . random ();',
      'const t = Date.now();',
      'const t = performance.now();',
    ]) {
      expect(FORBIDDEN.test(source), source).toBe(true);
    }
    for (const source of [
      'const rng = createRng(seed);',
      'const random = pick(rng, table);',
      'const now = state.rngState;',
      'const nowhere = 1;',
    ]) {
      expect(FORBIDDEN.test(source), source).toBe(false);
    }
  });

  it('finds none, in any of them', () => {
    const files = devFiles();
    expect(files.length, 'no dev files scanned — this guard reads nothing').toBeGreaterThan(2);
    expect(files.map((f) => f.name)).toContain('src/dev/devState.ts');
    expect(files.map((f) => f.name)).toContain('src/dev/panel.ts');
    const offenders: string[] = [];
    for (const file of files) {
      const clean = stripComments(file.source);
      expect(
        stripComments(`${file.source}\nVOID_STRIP_SENTINEL`),
        `${file.name}: the strip ran off the end`,
      ).toContain('VOID_STRIP_SENTINEL');
      if (FORBIDDEN.test(clean)) offenders.push(file.name);
    }
    expect(
      offenders,
      'a jump would not be reproducible — a bug report from a jumped state could not be replayed',
    ).toEqual([]);
  });

  it('and a grant takes its randomness from the state being edited', () => {
    // The positive half: not merely "no forbidden source", but the seeded one really used —
    // the run's OWN accumulator, so a rolled item advances the run's stream rather than
    // forking a private one. (`devState.test.ts` asserts the consequence behaviourally.)
    const core = readFileSync(path.join(ROOT, 'src/dev/devState.ts'), 'utf8');
    expect(core, 'a grant no longer draws from the run’s own RNG stream').toMatch(
      /createRng\s*\(\s*state\.rngState\s*\)/,
    );
    // ...and the panel does not roll its own seed behind the core's back.
    const panel = readFileSync(path.join(ROOT, 'src/dev/panel.ts'), 'utf8');
    expect(panel, 'the panel creates an RNG of its own').not.toMatch(/createRng\s*\(/);
  });
});

// =========================================================================================
// The dev directory is excludable BY PATH — the note that keeps a future widening of the
// hidden-karma guard from having to rediscover it.
// =========================================================================================

describe('the karma exemption is a path rule, not a word-list exception', () => {
  it('every dev source lives under one directory, so one skip rule covers them all', () => {
    const files = sourceFiles().filter((f) => f.includes('/dev/'));
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) {
      expect(file.startsWith('src/dev/'), `${file} is outside the one excludable directory`).toBe(
        true,
      );
    }
  });

  it('and no dev module routes karma through a player-facing projector', () => {
    // The panel reads `state.karma` directly and writes it with `textContent`. Routing it
    // through `formatEvent` / `describeEvent` / `dealView` / `describeCost` is what would
    // trip — correctly — the existing hidden-karma sweep.
    const panel = stripComments(readFileSync(path.join(ROOT, 'src/dev/panel.ts'), 'utf8'));
    for (const projector of ['formatEvent', 'describeEvent', 'dealView', 'describeCost']) {
      expect(panel, `the panel routes output through ${projector}`).not.toContain(projector);
    }
  });
});

describe('the guard files themselves exist where the runner will collect them', () => {
  it('every dev test file matches the runner’s src glob', () => {
    // A test file no `include` glob matches is collected by nothing and "passes" by never
    // running. `instrumentationSource.test.ts` owns the repo-wide version of this; here it
    // is pinned for this unit's own files, which are the newest and least-watched.
    const tests = sourceFiles().filter((f) => f.startsWith('src/dev/') && f.endsWith('.test.ts'));
    expect(tests.length, 'no dev test files found at all').toBeGreaterThanOrEqual(4);
    for (const file of tests) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });
});

// =========================================================================================
// ADDED BY `visual-identity` (2026-09-08) — ADDITIVE ONLY; nothing above is changed.
//
// THE RULE, AND THE MEASUREMENT BEHIND IT. A dev-only branch inside a SHIPPING module does
// not really leave the packaged build. `vite.config.ts` sets `sourcemap: true`, so every
// emitted `.map` carries `sourcesContent` — the original, pre-bundling text of every module
// in the graph. Rollup does eliminate an `import.meta.env.DEV` branch from the executed
// chunk, and its SOURCE stays fully readable in `dist/assets/*.js.map`.
//
// Measured, not reasoned about: `visual-identity` built a developer caption for the reserved
// art regions exactly that way — behind `import.meta.env.DEV`, inside `src/desktop/screens.ts`
// — and the real bundler put both its class name and its inline styling in the production
// sourcemap. By the standard stated at the top of THIS file ("a cheat panel recoverable from
// a shipped `.map` is shipped") the caption was shipped. It was removed rather than kept with
// a narrowed sweep, and this guard is what stops the next one being written.
//
// THE ONE EXEMPTION is `src/desktop/game.ts`, whose DEV branch contains a DYNAMIC IMPORT and
// nothing else. That is the whole point of the panel's mechanism: the imported module never
// enters the production module graph, so neither its code nor its source text is anywhere in
// the build — which is precisely what the bundler proof at the top of this file measures.
// The direction scan above already pins that this file is the only importer.
// =========================================================================================

describe('no shipping module hides code behind a DEV branch', () => {
  /** Every `import.meta.env` reference in a source, ignoring comments. */
  function devBranches(source: string): number {
    return (stripComments(source).match(/import\s*\.\s*meta\s*\.\s*env/g) ?? []).length;
  }

  it('the detector fires on the shapes a DEV branch is written in, and not on prose', () => {
    for (const source of [
      'if (import.meta.env.DEV) { mount(); }',
      'const dev = import.meta.env.DEV;',
      'if (import.meta.env.MODE === "development") { mount(); }',
      'export const D = import . meta . env . DEV;',
    ]) {
      expect(devBranches(source), source).toBe(1);
    }
    for (const source of [
      '// never put import.meta.env.DEV in a shipping module',
      '/* import.meta.env.DEV */ const x = 1;',
      'const dev = location.protocol === "http:";',
      'import { panel } from "./panel.ts";',
    ]) {
      expect(devBranches(source), source).toBe(0);
    }
  });

  it('only the renderer carries one, and its body is the dynamic import', () => {
    const files = sourceFiles().filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.testutil.ts'));
    expect(files.length, 'no shipping sources scanned — this guard reads nothing').toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel.startsWith('src/dev/')) continue;
      if (rel === 'src/desktop/game.ts') continue;
      const count = devBranches(readFileSync(path.join(ROOT, rel), 'utf8'));
      if (count > 0) offenders.push(`${rel} (${count})`);
    }
    expect(
      offenders,
      'a shipping module hides code behind a DEV branch. Rollup drops the code and the ' +
        'sourcemap keeps the TEXT, so it is readable in the packaged build. Put it under ' +
        'src/dev/ and reach it with a dynamic import from game.ts, as the F3 panel does',
    ).toEqual([]);
  });

  it('...and the renderer really does carry one (or the exemption guards nothing)', () => {
    const renderer = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
    expect(devBranches(renderer), 'the renderer has no DEV branch — the panel gate is gone')
      .toBeGreaterThan(0);
    expect(
      devBranches(renderer),
      'the renderer has grown a SECOND DEV branch. The exemption is for the panel gate ' +
        'alone, and a second one is code whose source ships in the map',
    ).toBe(1);
  });
});
