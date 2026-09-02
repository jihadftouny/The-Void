// THE PURE CORES STAY PURE — load-bearing principle 7, clause 3, asserted rather than
// intended.
//
// `src/game` is the deterministic rules engine and `src/llm` is the pure prompt/runtime
// layer. Both must be reproducible from `seed + inputs` and testable headlessly, and both
// have exactly one way to lose that: importing something that reads a clock. `logger.ts`'s
// own header says "logged at the boundary (the renderer), never from inside", and this
// unit adds a clock seam (`logger.now()`) plus a timer (`timing.ts`) that make the
// temptation concrete for the first time. A comment is not a guard.
//
// `src/render` is included for a second reason (AC-13 / principle 7's last clause, "the
// player never sees it"): `log-model.ts` and `format.ts` are what PROJECT engine events
// into the text the player reads. If the render layer could import the logger, a log line
// could reach the combat log.
//
// ---------------------------------------------------------------------------------------
// WHY THE DETECTOR IS ITSELF TESTED. A scan whose regex is subtly wrong passes VACUOUSLY
// over a clean tree — it finds nothing because it can find nothing, and reads exactly like
// a scan that works. So the same matcher used on the real files is first run over strings
// that are KNOWN violations and strings that are KNOWN clean, including a comment that
// names `log/logger` (the shape that made an earlier guard in this repo go red for the
// prose explaining why a defect was gone).
// ---------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripComments } from './sourceScan.testutil.ts';

/**
 * Every module specifier reached by an import in any spelling: `import x from '…'`,
 * a bare side-effect `import '…'`, `import type … from '…'`, a dynamic `import('…')`,
 * and a CommonJS `require('…')`. All three quote styles.
 */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g;

/**
 * True when a specifier resolves into `src/log/` — the logging infrastructure — however
 * many `../` hops it takes, with or without a `.ts`/`.js` extension.
 *
 * Deliberately matched on the `log/` PATH SEGMENT, so `../render/log-model.ts` and
 * `./data/lore.json` are not swept up while `../log/timing.ts` and `../../log/logger` are.
 */
function importsLogging(specifier: string): boolean {
  return /(?:^|\/)log\/[A-Za-z0-9_.-]+$/.test(specifier);
}

/** The logging imports in one file's source, as `line:specifier` strings. */
function loggingImports(source: string): string[] {
  const clean = stripComments(source);
  const hits: string[] = [];
  for (const m of clean.matchAll(SPECIFIER)) {
    const specifier = m[2] as string;
    if (!importsLogging(specifier)) continue;
    const line = clean.slice(0, m.index).split('\n').length;
    hits.push(`${line}:${specifier}`);
  }
  return hits;
}

// =========================================================================================
// 1. The detector, before it is trusted with anything.
// =========================================================================================

describe('the logger-import detector', () => {
  const VIOLATIONS: readonly [string, string][] = [
    ['a named static import', `import { log } from '../log/logger.ts';`],
    ['a bare side-effect import', `import '../../log/logger';`],
    ['a type-only import', `import type { LogEntry } from "../log/logger.js";`],
    ['a dynamic import', `const m = await import('../log/logger.ts');`],
    ['a backtick specifier for the timing module', 'import {SLOW_MS} from `../log/timing.ts`;'],
    ['a CommonJS require', `const { log } = require('../../log/logger');`],
  ];

  for (const [name, source] of VIOLATIONS) {
    it(`flags ${name}`, () => {
      expect(loggingImports(source)).toHaveLength(1);
    });
  }

  const CLEAN: readonly [string, string][] = [
    ['a COMMENT naming the module', `// never import ../log/logger.ts from here — see principle 7`],
    ['a block comment naming it', `/* logged at the boundary; see src/log/logger.ts */`],
    ['the render log MODEL, which is not the logger', `import { logLines } from '../render/log-model.ts';`],
    ['a local variable called log', `const log = (s: string) => s.trim();`],
    ['an ordinary engine import', `import { createGame } from './game.ts';`],
    ['a JSON data import whose name contains log', `import table from './data/dialog.json';`],
  ];

  for (const [name, source] of CLEAN) {
    it(`does NOT flag ${name}`, () => {
      expect(loggingImports(source)).toEqual([]);
    });
  }

  it('a glob inside a LINE comment does not swallow the imports that follow it', () => {
    // The stripper failure that makes this whole file a scan of a hole. Note the guard
    // must ALSO still find a real violation in the same text, or "returns []" would be
    // indistinguishable from "read nothing".
    const source = [
      '// this module deliberately imports nothing from src/log/** — principle 7',
      '/** and the first JSDoc block, whose close is what a naive stripper runs to */',
      `import { log } from '../log/logger.ts';`,
    ].join('\n');
    expect(stripComments(source)).toContain(`import { log } from '../log/logger.ts';`);
    expect(loggingImports(source)).toHaveLength(1);
  });

  it('finds BOTH when a file has two of them (it does not stop at the first)', () => {
    const source = `import { log } from '../log/logger.ts';\nimport { startTimer } from '../log/timing.ts';`;
    expect(loggingImports(source)).toHaveLength(2);
  });

  it('reports the specifier it found, so a failure names the offending import', () => {
    expect(loggingImports(`import { now } from '../log/logger.ts';`)[0]).toContain('../log/logger.ts');
  });
});

// =========================================================================================
// 2. The real scan.
// =========================================================================================

/** Every SHIPPING `.ts` file in a `src/` subdirectory (tests excluded). */
function shippingFiles(dirName: string): { name: string; source: string }[] {
  const dir = fileURLToPath(new URL(`../${dirName}/`, import.meta.url));
  return readdirSync(dir)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
    .map((n) => ({ name: `${dirName}/${n}`, source: readFileSync(path.join(dir, n), 'utf8') }));
}

function offendersIn(dirName: string): string[] {
  return shippingFiles(dirName).flatMap((f) => loggingImports(f.source).map((h) => `${f.name}:${h}`));
}

describe('no shipping file in a pure core imports the logging layer', () => {
  it('src/game imports nothing from src/log', () => {
    expect(offendersIn('game')).toEqual([]);
  });

  it('src/llm imports nothing from src/log', () => {
    expect(offendersIn('llm')).toEqual([]);
  });

  it('src/render imports nothing from src/log (so no log line can reach the combat log)', () => {
    expect(offendersIn('render')).toEqual([]);
  });

  it('scans a non-trivial number of files, so an empty sweep cannot pass vacuously', () => {
    // Mirrors `offEquivalence.test.ts:321`. The counts are the CURRENT floor, named so a
    // directory that silently stops being scanned (a renamed folder, a changed extension)
    // fails here rather than reporting a clean tree it never read.
    const game = shippingFiles('game');
    const llm = shippingFiles('llm');
    const render = shippingFiles('render');
    expect(game.length).toBeGreaterThan(30);
    expect(llm.length).toBeGreaterThanOrEqual(1);
    expect(render.length).toBeGreaterThanOrEqual(4);
    // Name the specific files the guard MUST have read: a count alone would still pass if
    // the one interesting file were skipped. `narrate.ts` is the whole of `src/llm`'s
    // shipping surface, and `log-model.ts` is the projector that feeds the combat log.
    expect(game.map((f) => f.name)).toContain('game/game.ts');
    expect(llm.map((f) => f.name)).toContain('llm/narrate.ts');
    expect(render.map((f) => f.name)).toContain('render/log-model.ts');
  });

  it('and the files it reads are real source, not empty strings', () => {
    let checked = 0;
    for (const dir of ['game', 'llm', 'render']) {
      for (const f of shippingFiles(dir)) {
        expect(f.source.length, `${f.name} read as empty — the scan is reading nothing`).toBeGreaterThan(50);
        checked += 1;
      }
    }
    expect(checked, 'the loop above ran over nothing').toBeGreaterThan(40);
  });

  it('and the text it actually SCANS still contains every import line', () => {
    // The assertion the count-and-name guards above cannot make, because they read the RAW
    // source: `offendersIn` scans the STRIPPED source, so it is the stripped source that
    // has to still contain the imports. A stripper that ate half of `game.ts` would leave
    // every check above green while reporting a clean tree it never read.
    let importLines = 0;
    for (const dir of ['game', 'llm', 'render']) {
      for (const f of shippingFiles(dir)) {
        const stripped = stripComments(f.source);
        for (const line of f.source.split('\n')) {
          if (!/^import\s/.test(line)) continue;
          importLines += 1;
          expect(stripped, `${f.name}: the strip ate "${line.trim()}"`).toContain(line.trim());
        }
      }
    }
    expect(importLines, 'no import lines seen at all — this guard scanned nothing').toBeGreaterThan(60);
  });
});

// =========================================================================================
// ONE CLOCK SEAM (Appendix A.6.2), asserted rather than intended.
//
// Every duration the renderer and the storage adapters record must flow through
// `logger.now()` — the single function `setClock` replaces — or a test cannot script it and
// has to fall back to a wall clock with a tolerance window, which is the classic flake.
//
// Nothing enforced that. A future `const t0 = performance.now()` inside `game.ts` or
// `persist.ts` would create a second, unscriptable seam and no assertion would fire. This
// is the guard; the exceptions are named, and each one is a decision on the record rather
// than an accident.
// =========================================================================================

describe('the renderer and the storage adapters measure through the seam, never a wall clock', () => {
  /** Every shipping `.ts` file under the instrumented (non-core) directories. */
  function instrumentedFiles(): { name: string; source: string }[] {
    return ['desktop', 'storage', 'log'].flatMap((d) => shippingFiles(d));
  }

  it('the text these guards SCAN is faithful — no line was swallowed by a comment hole', () => {
    // ⚠ A GUARD MUST VALIDATE ITS OWN INPUT. The two scans below read the STRIPPED source,
    // so a comment hole that swallows a line makes them pass by not seeing it. Demonstrated:
    // a regex literal containing `/*` placed in `game.ts` hid `const __t0 =
    // performance.now()` — a second clock seam, the very thing the next test forbids — and
    // `npx vitest run src/log` was GREEN. `sourceScan.test.mjs` sweeps every scanned file
    // repo-wide, but relying on a different test file to validate this one's input is how a
    // guard ends up trusting something it never checked.
    let checked = 0;
    for (const f of instrumentedFiles()) {
      const stripped = stripComments(f.source);
      expect(
        stripComments(`${f.source}\nVOID_STRIP_SENTINEL`),
        `${f.name}: the strip ran off the end of the file`,
      ).toContain('VOID_STRIP_SENTINEL');
      for (const line of f.source.split('\n')) {
        const t = line.trim();
        if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
        if (t.includes('//')) continue; // a trailing comment legitimately shortens the line
        expect(stripped, `${f.name}: the scanner ate "${t}" — the scans below see a hole`).toContain(t);
        checked += 1;
      }
    }
    expect(checked, 'no code lines checked — this validation is vacuous').toBeGreaterThan(300);
  });

  it('no shipping file outside logger.ts reads `performance`', () => {
    // `logger.ts#defaultClock` is THE seam's implementation and the only sanctioned reader.
    const offenders: string[] = [];
    for (const f of instrumentedFiles()) {
      if (f.name === 'log/logger.ts') continue;
      const clean = stripComments(f.source);
      if (/\bperformance\s*\.\s*(now|timeOrigin)\b/.test(clean)) offenders.push(f.name);
    }
    expect(
      offenders,
      'a second clock seam appeared — durations measured there cannot be scripted, and ' +
        'their tests would have to read a wall clock',
    ).toEqual([]);
  });

  it('`Date.now()` appears only in the seam itself and where it SEEDS a run', () => {
    // The two `runSeed = Date.now() >>> 0` lines in `game.ts` are pre-existing and are not
    // measurements: a run's identity has to come from somewhere outside the run. Anything
    // else is a duration measured off the seam.
    const offenders: string[] = [];
    for (const f of instrumentedFiles()) {
      if (f.name === 'log/logger.ts') continue;
      const clean = stripComments(f.source);
      for (const [i, line] of clean.split('\n').entries()) {
        if (!/\bDate\s*\.\s*now\s*\(/.test(line)) continue;
        if (/\brunSeed\s*=\s*Date\.now\(\)\s*>>>\s*0/.test(line)) continue; // the seed
        offenders.push(`${f.name}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      'a duration is being measured off a wall clock instead of `logger.now()` — script ' +
        'the seam instead, or the test that covers it will need a tolerance window',
    ).toEqual([]);
  });

  it('...and the sanctioned exceptions really are still there (non-vacuity)', () => {
    // If the seed lines vanished, or `logger.ts` stopped implementing the clock, the two
    // guards above would pass by having nothing to exempt.
    const game = instrumentedFiles().find((f) => f.name === 'desktop/game.ts');
    expect(game, 'game.ts is no longer scanned').toBeDefined();
    expect(
      (game!.source.match(/runSeed = Date\.now\(\) >>> 0/g) ?? []).length,
      'the run-seed lines are gone — the exemption above now exempts nothing',
    ).toBe(2);
    const logger = instrumentedFiles().find((f) => f.name === 'log/logger.ts');
    expect(logger!.source, 'logger.ts no longer implements the clock').toMatch(
      /performance\s*\.\s*timeOrigin/,
    );
    expect(instrumentedFiles().length, 'nothing was scanned at all').toBeGreaterThan(6);
  });

  it('and the timing module itself takes its clock from the seam', () => {
    const timing = instrumentedFiles().find((f) => f.name === 'log/timing.ts');
    expect(timing, 'timing.ts is gone').toBeDefined();
    expect(timing!.source, 'startTimer no longer measures through logger.now()').toMatch(
      /import\s*\{[^}]*\bnow\b[^}]*\}\s*from\s*'\.\/logger\.ts'/,
    );
  });
});
