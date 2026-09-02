// NO SOURCE FILE MAY CONTAIN A CONTROL CHARACTER — a repo-wide byte scan.
//
// ---------------------------------------------------------------------------------------
// WHY THIS EXISTS. Three regexes in `scripts/dev-server.test.mjs` were written as
// `/\bfetch\s*\(/` and committed as `/<0x08>fetch\s*\(/` — the `\b` had become a literal
// BACKSPACE byte. Those three patterns could never match anything, so three of the six
// "the launcher makes no outbound request" guards were inert, and a readiness poll written
// with `http.get` or `net.connect` reintroduced FINDINGS.md G41's silent attach with the
// whole suite green.
//
// THE ROOT CAUSE IS A TOOLING TRAP, NOT A TYPO, WHICH IS WHY IT IS WORTH A PERMANENT
// GUARD. The patterns were inserted by a Python script. In a Python string literal `\b` is
// a VALID escape — it means backspace — so Python emitted no warning at all, while it DID
// warn about `\.` and `\s` on the neighbouring lines. The one that silently corrupted the
// file is precisely the one that looked fine. Any future edit made through a script, a
// heredoc, a shell one-liner or a copy-paste through a terminal can do this again, and the
// result is invisible in every diff and every editor.
//
// A control character can never be legitimate in this codebase's source: tabs and newlines
// are whitespace we allow, and everything else is either a mangled escape or a paste
// accident. So the rule is absolute and needs no exceptions list.
// ---------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Directories that are ours to police. Everything else is generated or vendored. */
const ROOTS = ['src', 'scripts', 'electron'];

/** Extensions that are source we author. */
const SOURCE_EXT = /\.(ts|mjs|js|cjs|json|html|css)$/;

/**
 * Control characters that must never appear. Tab (0x09), line feed (0x0A) and carriage
 * return (0x0D) are legitimate whitespace and are excluded; everything else in C0, plus
 * DEL (0x7F), is either a mangled escape or a paste accident.
 */
// Written as \uXXXX ESCAPES, never as literal bytes: a guard that contained the
// character it forbids would fail its own scan, and "fix it by deleting the guard" is
// how this class of check dies.
const CONTROL = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]');

/** A readable name for a control character, so a failure says WHICH one. */
function describeChar(code: number): string {
  const names: Record<number, string> = {
    0x00: 'NUL (\\0)',
    0x07: 'BEL (\\a)',
    0x08: 'BACKSPACE (\\b) — almost certainly a mangled regex word-boundary',
    0x0b: 'VERTICAL TAB (\\v)',
    0x0c: 'FORM FEED (\\f)',
    0x1b: 'ESC — an ANSI escape sequence pasted from a terminal',
    0x7f: 'DEL',
  };
  return names[code] ?? `0x${code.toString(16).padStart(2, '0')}`;
}

/** Every source file under the policed roots, as repo-relative posix paths. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/`);
      else if (SOURCE_EXT.test(entry.name)) out.push(rel);
    }
  };
  for (const root of ROOTS) walk(root, `${root}/`);
  // The build/test/packaging configuration is source too, and is where a mangled glob
  // would hide with the worst consequences: `electron-builder.json` decides what goes into
  // the shipped archive, and a control byte in one of its globs breaks `desktop:pack`
  // silently. `main`'s commit d8eb952 ("delete the $comment key that made desktop:pack fail
  // every time") is a real instance of that file breaking packaging, which is why it is
  // named here rather than left to the directory walk that does not reach it.
  for (const extra of [
    'vite.config.ts',
    'tsconfig.json',
    'package.json',
    'electron-builder.json',
  ]) {
    out.push(extra);
  }
  return out;
}

describe('no source file contains a control character', () => {
  it('scans a real, non-trivial set of files (or it proves nothing)', () => {
    const files = sourceFiles();
    expect(files.length, 'no source files found — this scan is reading nothing').toBeGreaterThan(90);
    expect(files).toContain('scripts/dev-server.test.mjs'); // where the defect was
    expect(files).toContain('src/desktop/game.ts');
    expect(files).toContain('electron/main.mjs');
    expect(files).toContain('vite.config.ts');
    expect(files, 'the packaging config is outside the scan again').toContain('electron-builder.json');
    for (const f of files) {
      expect(readFileSync(path.join(ROOT, f), 'utf8').length, `${f} read as empty`).toBeGreaterThan(0);
    }
  });

  it('finds none, anywhere', () => {
    const offenders: string[] = [];
    for (const rel of sourceFiles()) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      for (const [i, line] of source.split('\n').entries()) {
        const m = CONTROL.exec(line);
        if (!m) continue;
        const code = (m[0] as string).charCodeAt(0);
        offenders.push(`${rel}:${i + 1}: ${describeChar(code)}`);
      }
    }
    expect(
      offenders,
      'a control character reached a source file. A mangled escape is invisible in a diff ' +
        'and in every editor, and it turns a regex guard into a decoration — see G41.',
    ).toEqual([]);
  });

  it('the detector fires on the exact byte that caused this (non-vacuity)', () => {
    // Built from char codes, never typed, so this test cannot itself contain the byte it
    // is testing for — which would make the scan above red forever.
    const backspace = String.fromCharCode(8);
    expect(CONTROL.test(`/${backspace}fetch\\s*\\(/`)).toBe(true);
    expect(CONTROL.test(`x${String.fromCharCode(0x1b)}[31m`)).toBe(true);
    expect(CONTROL.test(String.fromCharCode(0x0c))).toBe(true);
    expect(CONTROL.test(String.fromCharCode(0x00))).toBe(true);
    expect(CONTROL.test(String.fromCharCode(0x7f))).toBe(true);
  });

  it('and does NOT fire on legitimate whitespace or ordinary text', () => {
    // Tabs, newlines and carriage returns are excluded on purpose: this repo has CRLF
    // files, and a guard that flagged them would be turned off within a day.
    expect(CONTROL.test('\t')).toBe(false);
    expect(CONTROL.test('\n')).toBe(false);
    expect(CONTROL.test('\r')).toBe(false);
    expect(CONTROL.test("const P = /\\bfetch\\s*\\(/;")).toBe(false);
    expect(CONTROL.test('a normal line with — an em dash and ⚠ a symbol')).toBe(false);
  });
});
