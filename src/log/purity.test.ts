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

/**
 * Comments stripped — a comment mentioning `log/logger` is prose, not an import.
 *
 * A single left-to-right scan, NOT the obvious pair of regexes. `.replace(/\/\*[\s\S]*?\*\//g,
 * '').replace(/\/\/.*$/gm, '')` treats the `/*` inside a LINE comment that mentions a glob
 * (`src/render/**`, `./models/*.gguf` — this repo writes both) as a block-comment opener
 * and deletes everything up to the next `*​/`, which is the end of some JSDoc far below.
 * The file's whole import section then vanishes and this scan reports a clean tree because
 * it read a HOLE. That is not hypothetical: it is how this unit's first G6 guard stayed
 * green against G6 reintroduced verbatim. Of every guard in this unit, THIS one is the
 * worst place for that to happen, because it is the guard on determinism itself.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        const done = source[i] === c;
        i += 1;
        if (done) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

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
