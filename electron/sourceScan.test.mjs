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
import { stripComments, callsTo, argsOf } from './sourceScan.testutil.mjs';

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
