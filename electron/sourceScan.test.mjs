// The source-scan helpers, proved before any guard is allowed to trust them.
//
// A source guard is only as good as the text it is handed. This file exists because the
// obvious two-regex comment stripper is BROKEN on this repo's own comments, and a broken
// stripper turns every "must not appear" assertion downstream into a scan of a hole — the
// exact "guard that cannot fail" the last three fix rounds were spent on.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripComments,
  callsTo,
  argsOf,
  stripReachesEndOfFile,
} from '../src/log/sourceScan.testutil.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('stripComments', () => {
  it('removes a line comment', () => {
    expect(stripComments('const a = 1; // gone\nconst b = 2;')).toBe('const a = 1; \nconst b = 2;');
  });

  it('removes a block comment, including a JSDoc', () => {
    expect(stripComments('/** doc */\nconst a = 1;')).toBe('\nconst a = 1;');
    expect(stripComments('a/* mid */b')).toBe('ab');
  });

  it('THE BUG THIS FILE EXISTS FOR: a glob inside a LINE comment is not a block opener', () => {
    // `electron/**` and `./models/*.gguf` both appear in this repo's line comments today.
    // The naive `/\/\*[\s\S]*?\*\//` pass sees the `/*` in `electron/**`, deletes
    // everything up to the next `*/` — the end of the first JSDoc — and takes the import
    // section with it.
    const src = [
      '// electron-builder packs electron/** into the asar',
      "import fs from 'node:fs';",
      '/** the first doc block */',
      'const __dirname = 1;',
    ].join('\n');
    const stripped = stripComments(src);
    expect(stripped).toContain("import fs from 'node:fs';");
    expect(stripped).toContain('const __dirname = 1;');
    expect(stripped).not.toContain('electron-builder');
    expect(stripped).not.toContain('the first doc block');
  });

  it('and the same for a `*.gguf`-style glob', () => {
    const src = ["// migrates ./models/*.gguf", '/** doc */', "const keep = 'yes';"].join('\n');
    expect(stripComments(src)).toContain("const keep = 'yes';");
  });

  it('leaves comment-like text INSIDE a string literal alone', () => {
    expect(stripComments(`const u = 'https://example.com/a';`)).toBe(`const u = 'https://example.com/a';`);
    expect(stripComments('const s = "/* not a comment */";')).toBe('const s = "/* not a comment */";');
    expect(stripComments('const t = `a // b`;')).toBe('const t = `a // b`;');
  });

  it('handles an escaped quote inside a string', () => {
    expect(stripComments(`const s = 'it\\'s // fine'; // gone`)).toBe(`const s = 'it\\'s // fine'; `);
  });

  it('an unterminated block comment eats the rest, and does not loop forever', () => {
    expect(stripComments('const a = 1;\n/* never closed')).toBe('const a = 1;\n');
  });

  // ------------------------------------------------------------------------------------
  // Against the REAL files the guards scan: the strip must leave the code intact.
  // ------------------------------------------------------------------------------------
  for (const file of ['log.mjs', 'main.mjs', 'llm.mjs']) {
    it(`keeps every import line of ${file} (the file the guards actually read)`, () => {
      const raw = fs.readFileSync(path.join(HERE, file), 'utf8');
      const stripped = stripComments(raw);
      const imports = raw.split('\n').filter((l) => /^import\s/.test(l));
      expect(imports.length, `${file} has no imports — this check is vacuous`).toBeGreaterThan(2);
      for (const line of imports) {
        expect(stripped, `${file}: the stripper ate "${line.trim()}"`).toContain(line.trim());
      }
      // And it really did remove something, so it is not simply the identity function.
      expect(stripped.length).toBeLessThan(raw.length);
    });
  }
});

// =========================================================================================
// THE REGEX-LITERAL HOLE — round 2 of the same defect, and the reason this scanner has a
// lexer rather than a state machine.
//
// The single-pass scanner that replaced the two regexes tracked strings and both comment
// forms, but not regular-expression literals. `const HOLE = /a\/*b/;` is a regex whose body
// contains an escaped slash followed by a star: the scanner walked past the opening `/`,
// met `\` `/` `*`, and read `/*` as a block-comment opener. Everything to the next `*​/` was
// swallowed, and a G6 restoration hidden in that gap stayed GREEN with every anchor above
// it passing.
//
// "Assert your anchors survive" only catches a hole that SPANS an anchor. Two shapes escape
// it, and both were demonstrated by mutation:
//   - a hole APPENDED after the last export (swallows to EOF, no anchor below it);
//   - a hole between two ADJACENT anchors (spans none).
// Only recognising the regex literal closes both, which is what the scanner now does.
// =========================================================================================

describe('regular-expression literals are consumed whole', () => {
  it('a regex containing an escaped slash and a star opens NO comment', () => {
    // THE EXACT MUTATION. `\/*` inside the regex body must not be read as `/*`.
    const source = "const HOLE = /a\\/*b/;\nconst __dirname = process.cwd();\n";
    const stripped = stripComments(source);
    expect(stripped, 'the regex still swallows the code after it').toContain('__dirname');
    expect(stripped).toContain('process.cwd()');
    expect(stripReachesEndOfFile(source)).toBe(true);
  });

  it('...and the same hole appended AFTER the last export', () => {
    const source = "export function last() {}\nconst H = /x\\/*y/;\nconst __dirname = 1;\n";
    expect(stripComments(source)).toContain('__dirname');
  });

  it('...and the same hole placed BETWEEN two anchors (the shape anchors cannot catch)', () => {
    const source = [
      'export const first = 1;',
      'const H = /a\\/*b/;',
      'const SECRET = 2;',
      '/** doc */',
      'export const last = 3;',
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped, 'the region between the anchors is still swallowed').toContain('SECRET');
    expect(stripped).toContain('export const first');
    expect(stripped).toContain('export const last');
    expect(stripped).not.toContain('doc');
  });

  it('a regex with a `//` in a character class is not read as a line comment', () => {
    const source = 'const P = /[/]a/;\nconst keep = 1;';
    expect(stripComments(source)).toContain('const keep = 1;');
  });

  it('and a real one from this repo survives verbatim', () => {
    const source = "if (!/\\bLISTENING\\b/i.test(line)) continue;\nconst keep = 1;";
    expect(stripComments(source)).toBe(source);
  });

  // ---- the other half: DIVISION must not be mistaken for a regex -----------------------
  it('division after an identifier, a number, `)` or `]` is left alone', () => {
    // Mis-reading a division as a regex would consume to the next `/` and swallow code —
    // the same failure from the other direction. Every one of these is real in this repo.
    for (const source of [
      'const r = (tokens / Math.max(1, total - firstMs)) * 1000;\nconst keep = 1;',
      'const lines = Math.ceil((20 * CAP) / 150);\nconst keep = 1;',
      'const half = arr[0] / 2;\nconst keep = 1;',
      'const x = 10 / 2 / 5;\nconst keep = 1;',
      'const m = obj.a / obj.b;\nconst keep = 1;',
    ]) {
      expect(stripComments(source), source).toBe(source);
    }
  });

  it('but a regex after `=`, `(`, `,` or `return` IS recognised', () => {
    for (const source of [
      'const P = /a\\/*b/;\nconst keep = 1;',
      'if (test(/a\\/*b/)) f();\nconst keep = 1;',
      'const arr = [1, /a\\/*b/];\nconst keep = 1;',
      'function f() { return /a\\/*b/.test(s); }\nconst keep = 1;',
    ]) {
      expect(stripComments(source), source).toContain('const keep = 1;');
    }
  });

  // =======================================================================================
  // THE SWEEP THAT DOES NOT CARE WHY THE LEXER LOST ITS PLACE.
  //
  // The regex heuristic is not perfect and never will be: telling a regex from a division
  // is context-dependent, and three contexts still read a real regex as a division
  // (`function f() {}` then a regex on the next line; a regex as the body of an `if` or a
  // `for` with no braces). In those, a `/*` inside the regex body opens a hole and swallows
  // code. Chasing more keyword contexts keeps the class open-ended forever.
  //
  // This is the guard that closes it instead, because it does not care WHY: every
  // non-comment line of every scanned file must survive the strip verbatim. Whatever the
  // lexer mis-reads, the lines it swallows go missing and this fires.
  //
  // ⚠ ITS FILE LIST IS THE POINT. It used to name five Electron files, so the hole was live
  // in `src/desktop/game.ts` — a demonstrated mutation hid `const __t0 = performance.now()`
  // (a second clock seam, which A.6.2 forbids) behind a regex hole and `npx vitest run
  // src/log` stayed green. The list is now DERIVED, so a file that any guard starts
  // scanning is covered without anyone remembering to add it.
  // =======================================================================================

  /** Every shipping source file that any source guard on this branch strips. */
  function everyScannedFile() {
    const files = [];
    // Named explicitly: scanned by a guard, but not part of a directory sweep.
    for (const rel of [
      'electron/log.mjs',
      'electron/main.mjs',
      'electron/llm.mjs',
      'electron/instrument.mjs',
      'electron/narrator-gate.mjs',
      'scripts/desktop-dev.mjs',
      'scripts/dev-server.mjs',
      'vite.config.ts',
    ]) {
      files.push(rel);
    }
    // Derived: every shipping `.ts` under the directories the purity scan, the clock-seam
    // scan and the renderer guards walk.
    for (const dir of ['game', 'llm', 'render', 'desktop', 'storage', 'log']) {
      const abs = path.join(HERE, '..', 'src', dir);
      for (const name of fs.readdirSync(abs)) {
        if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
        files.push(`src/${dir}/${name}`);
      }
    }
    return files;
  }

  it('EVERY scanned file is byte-identical apart from its comments', () => {
    const files = everyScannedFile();
    expect(files.length, 'the scanned-file list collapsed').toBeGreaterThan(60);
    // The three that a narrower list previously missed, named so a silent shrink fails.
    for (const required of ['src/desktop/game.ts', 'scripts/desktop-dev.mjs', 'vite.config.ts']) {
      expect(files, `${required} is no longer swept`).toContain(required);
    }

    let totalChecked = 0;
    for (const file of files) {
      const raw = fs.readFileSync(path.join(HERE, '..', file), 'utf8');
      const stripped = stripComments(raw);
      expect(stripReachesEndOfFile(raw), `${file}: the strip ran off the end`).toBe(true);
      let checked = 0;
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
        // A line with a TRAILING comment is legitimately shortened by the strip, so it
        // cannot be compared whole. Skipped rather than half-compared — the floors below
        // keep this from quietly becoming a scan of nothing.
        if (t.includes('//')) continue;
        expect(stripped, `${file}: the scanner ate "${t}"`).toContain(t);
        checked += 1;
      }
      expect(checked, `${file}: no code lines checked`).toBeGreaterThan(3);
      totalChecked += checked;
    }
    expect(totalChecked, 'the sweep checked almost nothing').toBeGreaterThan(2000);
  });
});

describe('stripReachesEndOfFile', () => {
  // Kept as the cheap, independent check that the lexer did not lose its place for ANY
  // reason — not only the regex case it was originally written for.
  it('is true for a well-formed file', () => {
    expect(stripReachesEndOfFile("const a = 1; // note\n/** doc */\nexport const b = 2;\n")).toBe(true);
    expect(stripReachesEndOfFile('')).toBe(true);
  });

  it('is FALSE for an unterminated block comment', () => {
    expect(stripReachesEndOfFile('const a = 1;\n/* never closed')).toBe(false);
    expect(stripReachesEndOfFile('export const a = 1;\n/** doc that never closes\n * more')).toBe(false);
  });

  it('every file the guards scan currently reaches its end', () => {
    for (const file of ['log.mjs', 'main.mjs', 'llm.mjs', 'instrument.mjs', 'narrator-gate.mjs']) {
      const raw = fs.readFileSync(path.join(HERE, file), 'utf8');
      expect(stripReachesEndOfFile(raw), `${file} ends inside a comment hole`).toBe(true);
    }
  });
});

describe('callsTo', () => {
  it('captures a whole call, balancing nested parentheses', () => {
    expect(callsTo('mlog("info", "x", "m", { a: f(1, g(2)) });', 'mlog')).toEqual([
      'mlog("info", "x", "m", { a: f(1, g(2)) })',
    ]);
  });

  it('finds every call, not just the first', () => {
    expect(callsTo('a(1); a(2); a(3);', 'a')).toEqual(['a(1)', 'a(2)', 'a(3)']);
  });

  it('does not match a longer identifier that merely ends with the name', () => {
    expect(callsTo('remlog(1); mlog(2);', 'mlog')).toEqual(['mlog(2)']);
  });

  it('returns nothing when the name is absent (so a caller must assert non-emptiness)', () => {
    expect(callsTo('const x = 1;', 'mlog')).toEqual([]);
  });

  it('skips a DECLARATION — parameter names are not arguments', () => {
    const src = 'function mlog(level, category, message, data) {}\nmlog("info", "x", "m");';
    expect(callsTo(src, 'mlog')).toEqual(['mlog("info", "x", "m")']);
    expect(callsTo('async function go(a, b) {}\ngo(1, 2);', 'go')).toEqual(['go(1, 2)']);
  });

  it('is not fooled by a PARENTHESIS INSIDE A STRING — the real case in main.mjs', () => {
    // `mlog('error','llm','generate: FAILED (main)', {...})` is in the shipping source. A
    // depth counter that counted that `)` would end the call early and hand every
    // downstream assertion a truncated string.
    const src = `mlog('error', 'llm', 'generate: FAILED (main)', { requestId, ms });`;
    expect(callsTo(src, 'mlog')).toEqual([
      `mlog('error', 'llm', 'generate: FAILED (main)', { requestId, ms })`,
    ]);
  });

  it('and not by an unbalanced parenthesis in a string', () => {
    expect(callsTo(`f('oops :-(', 1);`, 'f')).toEqual([`f('oops :-(', 1)`]);
  });
});

describe('argsOf', () => {
  it('splits top-level arguments only', () => {
    expect(argsOf(`mlog('info', 'llm', 'x', { a: 1, b: [2, 3] })`)).toEqual([
      `'info'`,
      `'llm'`,
      `'x'`,
      '{ a: 1, b: [2, 3] }',
    ]);
  });

  it('does not split on a comma inside a string', () => {
    expect(argsOf(`f('a, b', 2)`)).toEqual([`'a, b'`, '2']);
  });

  it('handles a no-argument call and an arrow argument', () => {
    expect(argsOf('f()')).toEqual([]);
    expect(argsOf('f(a, (x, y) => x + y)')).toEqual(['a', '(x, y) => x + y']);
  });
});
