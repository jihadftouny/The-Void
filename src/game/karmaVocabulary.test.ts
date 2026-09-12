// The shared hidden-karma word list catches what it must and spares what it must (F4).
//
// Every guard that polices karma vocabulary imports `karmaVocabulary.testutil.ts`. These pin the
// list itself — each inflection a leak would really take — and prove the five guards all read
// THIS list rather than a private copy that could drift.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../log/sourceScan.testutil.ts';
import { AXIS_STEMS, AXIS_VOCABULARY, SCENE_VOCABULARY } from './karmaVocabulary.testutil.ts';

describe('AXIS_VOCABULARY — stems, so every inflection is caught', () => {
  it('catches the axis nouns and every adjective a narrator or a formatter would reach for', () => {
    for (const w of [
      'karma', 'karmic', 'nature', 'mercy', 'merciful', 'Merciless', 'cruel', 'cruelty',
      'greed', 'greedy', 'restraint', 'restrained', 'reverence', 'reverent', 'desecration',
      'clarity', 'delusion', 'delusional', 'deluded',
    ]) {
      expect(w, w).toMatch(AXIS_VOCABULARY);
    }
  });

  it('spares the act verb and the manner words (the G53 line), and near-misses', () => {
    for (const w of ['desecrate', 'gentle', 'hungry', 'hushed', 'clear-eyed', 'unsure', 'profane', 'mercenary', 'cold', 'spare']) {
      expect(w, w).not.toMatch(AXIS_VOCABULARY);
    }
  });

  it('is built from exactly the ten stems, case-insensitively', () => {
    expect(AXIS_STEMS).toHaveLength(10);
    expect(AXIS_VOCABULARY.flags).toContain('i');
    expect(AXIS_VOCABULARY.source).toBe(AXIS_STEMS.join('|'));
  });

  it('the scene list is the axis list PLUS the act verb, and nothing else', () => {
    expect(SCENE_VOCABULARY.source.startsWith(AXIS_VOCABULARY.source)).toBe(true);
    expect('desecrate').toMatch(SCENE_VOCABULARY);
    expect('merciful').toMatch(SCENE_VOCABULARY);
    expect('gentle').not.toMatch(SCENE_VOCABULARY);
  });
});

// =========================================================================================
// NO PRIVATE COPY, ANYWHERE (fix round 2). The guard used to read a fixed list of four files and
// know one shape (`= /…mercy…/i`). It missed a `new RegExp('…')` built from a string, a word
// array, an inline literal inside `expect()` — and every test file it was not told about. It now
// reads EVERY test file in the repo, and knows each shape.
//
// WHAT COUNTS AS A COPY: one construct naming THREE OR MORE of the ten axis word families. One
// word is a word (a test may well say "greed" — it is a bargain price's id); three is a list.
// The camelCase axis KEYS (`mercyCruelty`, …) are not the vocabulary and are not counted — a
// guard that checks JSON keys lists them legitimately.
// =========================================================================================

/** The roots of the ten word families — a copy of the list must spell at least three. */
const ROOTS = ['karm', 'natur', 'merc', 'cruel', 'greed', 'restrain', 'reveren', 'desecra', 'clarit', 'delu'];
const COPY_AT = 3;

/** The families a piece of text names, with camelCase axis keys removed first. */
function families(text: string): string[] {
  const words = text.replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g, ' ').toLowerCase();
  return ROOTS.filter((r) => words.includes(r));
}

/** Every private copy of the vocabulary in one source file, described — [] when clean. */
function privateCopies(source: string): string[] {
  const code = stripComments(source);
  const hits: string[] = [];
  const flag = (shape: string, text: string): void => {
    const f = families(text);
    if (f.length >= COPY_AT) hits.push(`${shape}: ${f.join(', ')}`);
  };
  // 1. A regular-expression LITERAL anywhere — assigned, or inline inside `expect(…)`.
  for (const m of code.matchAll(/(?<![\w)\]])\/(?![*/\s])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/[dgimsuy]*/g)) {
    flag('a regex literal', m[1] as string);
  }
  // 2. `new RegExp(…)` built from a string or a template — its whole argument list.
  for (const m of code.matchAll(/\bnew\s+RegExp\s*\(([^)]*)\)/g)) flag('a new RegExp(...)', m[1] as string);
  // 3. A string holding an ALTERNATION — the source of a pattern about to be built.
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*\|(?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    flag('a pattern string', m[2] as string);
  }
  // 4. A WORD ARRAY: an array literal of plain string words.
  for (const m of code.matchAll(/\[([^[\]]*)\]/g)) {
    const words = [...(m[1] as string).matchAll(/(['"`])([A-Za-z][a-z -]*)\1/g)].map((w) => w[2] as string);
    if (words.length >= COPY_AT) flag('a word array', words.join(' '));
  }
  return hits;
}

/** Every test file in the repo (src/, scripts/, electron/), repo-relative, posix separators. */
function everyTestFile(): string[] {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (/\.test\.(?:ts|mjs)$/.test(entry.name)) {
        out.push(`${prefix}${entry.name}`);
      }
    }
  };
  for (const top of ['src', 'scripts', 'electron']) walk(path.join(root, top), `${top}/`);
  return out;
}

describe('every karma guard reads THIS list — no private copy left to drift', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
  // PLAN.md #6 added the fifth: the battle screen's sweep of the stage (AC-30).
  const GUARDS = [
    'src/game/karmaActions.test.ts',
    'src/dev/observable.test.ts',
    'src/llm/tone.test.ts',
    'src/game/restBrief.test.ts',
    'src/dev/battleScreen.test.ts',
  ];
  // The ONE file allowed to spell the families out: this one, which pins the list's inflections
  // and holds this detector's own root list.
  const HOME = 'src/game/karmaVocabulary.test.ts';

  it('each of the five known guards imports it', () => {
    for (const rel of GUARDS) {
      expect(read(rel), rel).toMatch(/from '[./]+(?:game\/)?karmaVocabulary\.testutil\.ts'/);
    }
  });

  it('no test file anywhere carries a private copy, in any shape', () => {
    const files = everyTestFile();
    // Non-vacuity: the whole suite, not a handful — and the five guards among it.
    expect(files.length).toBeGreaterThan(90);
    for (const rel of GUARDS) expect(files).toContain(rel);
    const found = files.filter((rel) => rel !== HOME).flatMap((rel) => privateCopies(read(rel)).map((h) => `${rel} — ${h}`));
    expect(found).toEqual([]);
  });

  it('the detector catches each shape a copy really takes', () => {
    const shapes: readonly [string, string][] = [
      ['an assigned regex literal', "const AXIS = /karma|nature|mercy|cruel|greed|restraint/i;"],
      ['an inline literal inside expect()', "expect(text).not.toMatch(/merciful|greedy|deluded/i);"],
      ['a new RegExp from a string', "const re = new RegExp('karma|mercy|greed|clarity', 'i');"],
      ['a new RegExp from a template', 'const re = new RegExp(`karm|merc(?:y|i)|${extra}|cruel`, "i");'],
      ['a pattern string built later', "const words = 'mercy|cruelty|greed|desecration';"],
      ['a word array', "const WORDS = ['mercy', 'greed', 'reverence', 'clarity'];"],
      ['a word array joined into a pattern', "new RegExp(['karma', 'nature', 'mercy'].join('|'), 'i');"],
    ];
    for (const [what, code] of shapes) {
      expect(privateCopies(code), what).not.toEqual([]);
    }
  });

  it('...and leaves alone what is not a copy', () => {
    for (const clean of [
      "expect(describeCost({ kind: 'greed' })).toBe('x');", // one family: a price's id
      "for (const kind of ['offering', 'desecrate', 'greed', 'whisper'] as const) {}", // two families
      "const AXIS_KEYS = /mercyCruelty|restraintGreed|reverenceDesecration|clarityDelusion/;", // the axis KEYS
      "// a comment naming mercy, greed and clarity is prose, not a list",
      "import { AXIS_VOCABULARY } from './karmaVocabulary.testutil.ts';",
      "const r = a / b / c;", // division is not a regex
    ]) {
      expect(privateCopies(clean), clean).toEqual([]);
    }
  });
});
