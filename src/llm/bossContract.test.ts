// The boss contract: a JSON-loaded persona is validated, never trusted — and the boss files
// stay inside the pure-core sweeps without any guard being edited (AC-2).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripComments } from '../log/sourceScan.testutil.ts';
import { BOSS_PERSONA_IDS, personaProblem, validatePersona } from './bossContract.ts';
import { FIXTURE_PERSONAS, FIXTURE_PERSONA_LIST } from './bossFixtures.testutil.ts';

describe('validatePersona', () => {
  it('accepts all ten fixture personas, and each survives a JSON round trip', () => {
    expect(FIXTURE_PERSONA_LIST.map((p) => p.id).sort()).toEqual([...BOSS_PERSONA_IDS].sort());
    for (const p of FIXTURE_PERSONA_LIST) {
      expect(personaProblem(p), p.id).toBeNull();
      expect(validatePersona(JSON.parse(JSON.stringify(p))), p.id).toBe(true);
    }
  });

  const kingpin = () => JSON.parse(JSON.stringify(FIXTURE_PERSONAS.kingpin)) as Record<string, unknown>;

  const BROKEN: [string, (p: Record<string, unknown>) => void][] = [
    ['a missing card', (p) => delete p.card],
    ['a missing fallback list', (p) => delete p.fallbackLines],
    ['an empty fallback list', (p) => (p.fallbackLines = [])],
    ['an unknown name mode', (p) => (p.nameRule = { mode: 'secret', text: 'x' })],
    ['a forbidden rule that carries the name', (p) => (p.nameRule = { mode: 'forbidden', text: 'Never say {name}.' })],
    ['a card that needs the name', (p) => (p.card = 'You know {name}.')],
    ['a fallback line that needs the name', (p) => (p.fallbackLines = ['Hello, {name}.'])],
    ['an unknown concession', (p) => (p.concessions = ['pause', 'mercy'])],
    ['an unknown id', (p) => (p.id = 'dragon')],
    ['a floor scope with no floor', (p) => (p.deeds = { scope: 'floor', max: 3 })],
    ['a bad axis', (p) => (p.deeds = { scope: 'all', axes: ['luck'], max: 3 })],
    ['a non-boolean karma flag', (p) => (p.karmaBlock = 'yes')],
    ['a non-numeric temperature', (p) => (p.talk = { moves: 'x', temperature: 'hot' })],
  ];

  for (const [what, breakIt] of BROKEN) {
    it(`rejects ${what}`, () => {
      const p = kingpin();
      breakIt(p);
      expect(validatePersona(p)).toBe(false);
      expect(personaProblem(p)).toMatch(/\w/);
    });
  }

  it('rejects things that are not personas at all', () => {
    for (const x of [null, undefined, 3, 'kingpin', [], {}]) expect(validatePersona(x)).toBe(false);
  });
});

// =========================================================================================
// AC-2 — the boss files are FLAT in src/llm with a `boss` prefix, so the existing sweeps
// (`src/log/purity.test.ts`: src/llm, not recursive, `.test.ts` excluded;
// `src/game/offEquivalence.test.ts`: src/llm, recursive, `.test.ts` and `.testutil.ts`
// excluded) pick them up with no guard edited. This asserts they ARE in those sets, and applies
// the same bans here so a failure names the boss file directly.
// =========================================================================================

const LLM_DIR = fileURLToPath(new URL('./', import.meta.url));
const SHIPPING_BOSS_FILES = ['bossContract.ts', 'bossWords.ts'];

/** The purity sweep's own selection rule (src/log/purity.test.ts `shippingFiles`). */
const puritySet = () => readdirSync(LLM_DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
/** The randomness sweep's rule (src/game/offEquivalence.test.ts `shippingSources`). */
const randomnessSet = () =>
  readdirSync(LLM_DIR).filter((n) => n.endsWith('.ts') && !/\.test\.ts$|\.testutil\.ts$/.test(n));

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const BANNED_SPECIFIER = /(?:^|\/)(?:render|desktop|log)\/|^electron$|^node:|^node-llama-cpp$/;
const IMPURE = [
  /\bMath\s*\.\s*random\s*\(/,
  /\bDate\s*\.\s*now\s*\(/,
  /\bnew\s+Date\s*\(/,
  /\bperformance\s*\.\s*now\s*\(/,
];

function offences(source: string): string[] {
  const code = stripComments(source);
  const out = [...code.matchAll(IMPORT)]
    .map((m) => m[1] ?? '')
    .filter((spec) => BANNED_SPECIFIER.test(spec))
    .map((spec) => `import ${spec}`);
  for (const re of IMPURE) if (re.test(code)) out.push(re.source);
  return out;
}

describe('AC-2: every shipping boss file sits inside the existing purity sweeps', () => {
  for (const name of SHIPPING_BOSS_FILES) {
    it(`${name} is in both sweeps' file sets, and is pure`, () => {
      expect(puritySet(), `${name} is outside the logging-import sweep`).toContain(name);
      expect(randomnessSet(), `${name} is outside the clock/randomness sweep`).toContain(name);
      expect(offences(readFileSync(path.join(LLM_DIR, name), 'utf8'))).toEqual([]);
    });
  }

  it('the fixtures are a test utility — outside the shipping randomness set', () => {
    expect(randomnessSet()).not.toContain('bossFixtures.testutil.ts');
  });

  it('the detector fires on each banned shape (or the checks above prove nothing)', () => {
    for (const bad of [
      "import { log } from '../log/logger.ts';",
      "import { h } from '../render/format.ts';",
      "import { x } from '../desktop/game.ts';",
      "import { ipcRenderer } from 'electron';",
      "import fs from 'node:fs';",
      "import { getLlama } from 'node-llama-cpp';",
      "const m = await import('../log/logger.ts');",
      'const t = performance.now();',
      'const r = Math.random();',
      'const d = Date.now();',
    ]) {
      expect(offences(bad), bad).not.toEqual([]);
    }
    expect(offences("import { placeName } from './narrate.ts';\n// Math.random() is banned here")).toEqual([]);
  });
});
