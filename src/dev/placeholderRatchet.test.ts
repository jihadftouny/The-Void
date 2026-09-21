// THE PLACEHOLDER RATCHET — the inventory of unwritten text can only ever shrink.
//
// WHAT THIS IS FOR. A large part of this game's prose is deliberately unwritten: ten empty
// act bodies, four PLACEHOLDER content headers, twenty-four joke gear names, six duplicated
// insanity lines. Those are the AUTHOR'S to write (PLAN.md #13, scheduled), and this file
// does not touch them. What it does is FREEZE them — an exact, named inventory — so that:
//
//   - nobody adds a NEW placeholder without the count going red and naming the file;
//   - when the author writes one, the count goes red the other way and says "lower it",
//     which is how the punch-list gets shorter on purpose rather than by accident;
//   - and no engine-written string can quietly ship a "(s)", a "TODO" or a raw enum id
//     into the player's face, which is the whole family of defects FINDINGS.md C4/C7/C9/C10
//     was opened for.
//
// It is the machine-readable version of "these are known, and this is all of them."
//
// WHAT IT SAYS WHEN IT FIRES — both messages below were produced by really mutating the
// tree while this file was written, then reverting.
//
// Writing one of the ten act bodies (the direction we WANT):
//
//   src/data/story.json — empty prose leaves: measured 9, frozen 10.
//     No longer present: .actIntros.1.body
//     One of the known placeholders is gone. If it has been written, LOWER the frozen
//     inventory by deleting that entry — that is the ratchet turning, and it is good.
//
// Adding a new one (the direction it exists to stop):
//
//   src/data/story.json — empty prose leaves: measured 11, frozen 10.
//     New: .spare.body
//     Something UNWRITTEN was added. If it is deliberate, put it in the frozen
//     inventory in this file WITH A REASON; otherwise write the text instead.
//
// TWO HALVES:
//   STATIC  — a filesystem walk of src/data/*.json (every string leaf) and every shipping
//             .ts under src/ (every string LITERAL, comments and regex literals stripped),
//             following the `src/log/sourceBytes.test.ts` convention.
//   DYNAMIC — real seeded runs through the shipped `heuristicPolicy`, checking every string
//             that reaches a player or the model against the SHARED text-hygiene rules
//             (`src/llm/textHygiene.ts`) — raw engine ids, and the three prose rules
//             WORLD.md turns on. The renderer runs the very same detector over what the
//             local model says, so there is one rule set and no second copy to drift.
//
// The detectors are tested BEFORE they are trusted (each has a planted positive that must
// trip it and a must-not-fire control), because a scanner that matches nothing passes
// whether or not it works.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGame, step, awaitingFor } from '../game/game.ts';
import type { GameState, StepResult } from '../game/game.ts';
import { ALL_CLASSES, heuristicPolicy } from '../game/sim.ts';
import type { PlayerClass } from '../game/player.ts';
import { describeEvent, eventsToFacts, buildNarrationPrompt } from '../llm/narrate.ts';
import { formatEvent } from '../render/format.ts';
import {
  castOptions,
  chestReveal,
  characterSheet,
  consumableOptions,
  dealDiscardView,
  dealView,
  describeInventory,
  displayPlayer,
  draftCards,
  fallbackNarration,
  runSummaryView,
} from '../desktop/view-model.ts';
import { INSANITY_STRINGS } from '../game/condition.ts';
import {
  applyRunSummary,
  createUnlockStore,
  emptyRunSummary,
  foldRunEvents,
} from '../game/unlockStore.ts';
// PART 2's rules and vocabulary. ONE definition, shared with the renderer and with the
// narration-corpus sweep — see the note at the top of PART 2.
import {
  ALL_TEXT_RULES,
  ENGINE_TEXT_RULES,
  ROLLED_NAME_ALLOWANCE,
  buildVocabulary,
  detectTextFaults,
  type TextRuleId,
} from '../llm/textHygiene.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ===========================================================================
// PART 0 — the detectors
// ===========================================================================

/**
 * The five static rules. Each is a predicate over ONE string — a JSON leaf or a `.ts`
 * literal. Written as plain functions (not one shared regex) so each can be planted against
 * on its own, and so the reason for each lives beside it.
 */
const RULES = {
  /** An unwritten prose field: present in the schema, empty of words. */
  empty: (s: string): boolean => s.trim() === '',
  /** The header the author's data files carry while their content is not final. */
  placeholder: (s: string): boolean => s.includes('PLACEHOLDER'),
  /** A note-to-self. In a STRING (not a comment) it is text the player can be shown. */
  todo: (s: string): boolean => /\b(TODO|TBD|FIXME)\b/.test(s),
  /** The legacy Java gear names — twenty-four of them, all #13's to rename. */
  joke: (s: string): boolean => /\b(Jooj|Jaaj|Jiij)\b/.test(s),
  /** The optional-plural marker: the engine knows the number, so it must pick a form. */
  parenS: (s: string): boolean => s.includes('(s)'),
} as const;
type RuleName = keyof typeof RULES;

const STATE = {
  code: 0,
  lineComment: 1,
  blockComment: 2,
  single: 3,
  double: 4,
  template: 5,
  regex: 6,
} as const;

/** Characters after which a `/` begins a REGEX literal rather than a division. */
const REGEX_MAY_FOLLOW = new Set('(,=:[!&|?{};+-*%~^<>'.split(''));
const REGEX_MAY_FOLLOW_KEYWORD = /\b(return|typeof|case|in|of|delete|void|new|do|else)$/;

/**
 * Every STRING LITERAL body in a TypeScript source — single, double and template — with
 * comments and regex literals excluded.
 *
 * WHY NOT JUST GREP THE FILE. Two of the five rules would be pure noise otherwise. A `//
 * TODO` comment is a developer note and must not fire; the word `TODO` inside `'…'` is text
 * that can reach a player and must. A regex like `/\(s\)/` — a guard AGAINST the marker — is
 * not an instance of it. Getting that distinction right is what makes the counts trustworthy
 * enough to freeze, so the extractor has its own planted tests below.
 *
 * A template's `${…}` interpolations are code, not prose, so they are replaced by a marker
 * rather than scanned.
 */
export function stringLiteralsOf(source: string): string[] {
  const out: string[] = [];
  let state: number = STATE.code;
  let buf = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    const next = i + 1 < n ? source[i + 1]! : '';
    if (state === STATE.code) {
      if (c === '/' && next === '/') {
        state = STATE.lineComment;
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        state = STATE.blockComment;
        i += 2;
        continue;
      }
      if (c === '/') {
        const before = source.slice(0, i).replace(/\s+$/, '');
        const prev = before.slice(-1);
        if (before === '' || REGEX_MAY_FOLLOW.has(prev) || REGEX_MAY_FOLLOW_KEYWORD.test(before)) {
          state = STATE.regex;
        }
        i += 1;
        continue;
      }
      if (c === "'") { state = STATE.single; buf = ''; i += 1; continue; }
      if (c === '"') { state = STATE.double; buf = ''; i += 1; continue; }
      if (c === '`') { state = STATE.template; buf = ''; i += 1; continue; }
      i += 1;
      continue;
    }
    if (state === STATE.lineComment) {
      if (c === '\n') state = STATE.code;
      i += 1;
      continue;
    }
    if (state === STATE.blockComment) {
      if (c === '*' && next === '/') { state = STATE.code; i += 2; continue; }
      i += 1;
      continue;
    }
    if (state === STATE.regex) {
      if (c === '\\') { i += 2; continue; }
      if (c === '[') {
        i += 1;
        while (i < n && source[i] !== ']') i += source[i] === '\\' ? 2 : 1;
        i += 1;
        continue;
      }
      if (c === '/' || c === '\n') { state = STATE.code; i += 1; continue; }
      i += 1;
      continue;
    }
    // Inside a string literal.
    if (c === '\\') { buf += source.slice(i, i + 2); i += 2; continue; }
    const closer = state === STATE.single ? "'" : state === STATE.double ? '"' : '`';
    if (c === closer) { out.push(buf); state = STATE.code; i += 1; continue; }
    if (state === STATE.template && c === '$' && next === '{') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') depth -= 1;
        i += 1;
      }
      buf += '${}';
      continue;
    }
    if (state !== STATE.template && c === '\n') { state = STATE.code; i += 1; continue; }
    buf += c;
    i += 1;
  }
  return out;
}

/** Every string LEAF of a parsed JSON document, with its dotted path. */
function jsonLeaves(node: unknown, at = ''): { path: string; value: string }[] {
  if (typeof node === 'string') return [{ path: at, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => jsonLeaves(v, `${at}.${i}`));
  if (node !== null && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      jsonLeaves(v, `${at}.${k}`),
    );
  }
  return [];
}

describe('the detectors fire, and only where they should (before anything trusts them)', () => {
  it('each rule trips on a planted instance', () => {
    expect(RULES.empty('')).toBe(true);
    expect(RULES.empty('   \n ')).toBe(true);
    expect(RULES.placeholder('PLACEHOLDER LORE — NOT THE AUTHOR’S WORDS.')).toBe(true);
    expect(RULES.todo('TBD')).toBe(true);
    expect(RULES.todo('rename this — FIXME before ship')).toBe(true);
    expect(RULES.joke('Jaaj Sword 1')).toBe(true);
    expect(RULES.joke('Jiij Rapier 1')).toBe(true);
    expect(RULES.parenS('You suffer(s) 1 bleed damage.')).toBe(true);
    expect(RULES.parenS('N affliction(s)')).toBe(true);
  });

  it('and does NOT trip on the near-miss it would be wrong to flag', () => {
    expect(RULES.empty('.')).toBe(false);
    expect(RULES.placeholder('a place holder')).toBe(false);
    // A whole word only: "TODOS" and "autobd" are not notes to self.
    expect(RULES.todo('TODOS')).toBe(false);
    expect(RULES.todo('The god of the Undercity')).toBe(false);
    expect(RULES.joke('Jaajesh')).toBe(false);
    expect(RULES.parenS('(so it goes)')).toBe(false);
    expect(RULES.parenS('afflictions')).toBe(false);
  });

  it('the literal extractor reads strings and ignores comments', () => {
    const src = [
      '// TODO: a developer note, not player text',
      '/* PLACEHOLDER in a block comment — also not player text */',
      "const a = 'TBD';",
      'const b = "a (s) marker";',
      'const c = `Jaaj Sword ${n}`;',
    ].join('\n');
    const lits = stringLiteralsOf(src);
    expect(lits).toEqual(['TBD', 'a (s) marker', 'Jaaj Sword ${}']);
    // The comments really were in the source — the extractor dropped them, not the fixture.
    expect(src).toContain('TODO');
    expect(src).toContain('PLACEHOLDER');
    expect(lits.some(RULES.todo)).toBe(true); //  'TBD' fired
    expect(lits.filter(RULES.todo)).toEqual(['TBD']); //  the comment did not
    expect(lits.some(RULES.placeholder)).toBe(false);
  });

  it('a regex literal is not a string — a guard AGAINST a marker is not an instance of it', () => {
    const src = ['const re = /\\(s\\)/;', "const msg = 'ships a (s)';"].join('\n');
    const lits = stringLiteralsOf(src);
    expect(lits).toEqual(['ships a (s)']);
    expect(lits.filter(RULES.parenS)).toHaveLength(1);
  });

  it('an apostrophe inside a double-quoted string does not swallow the file', () => {
    // The `narrate.ts` buff table is full of these ("The enemy's sight clears").
    const lits = stringLiteralsOf(`const s = "The enemy's sight clears"; const t = 'ok';`);
    expect(lits).toEqual(["The enemy's sight clears", 'ok']);
  });
});

// ===========================================================================
// PART 1 — the STATIC inventory: what is deliberately unwritten today
// ===========================================================================

/**
 * THE FROZEN INVENTORY, measured 2026-09-21 against `main` at cec2cc5 plus this unit.
 *
 * Every entry is a FILE → the exact leaf paths (or literal texts) that trip the rule, with a
 * reason. A file absent from a rule's map must score ZERO for it.
 *
 * To change one: if the author has written the text, delete the entry (the count drops). If
 * something genuinely new and deliberate is added, add it WITH A REASON. Nothing else.
 */
const FROZEN_DATA: Record<RuleName, Record<string, string[]>> = {
  // Prose fields that exist in the schema with nothing in them yet.
  empty: {
    // The ten act transitions. `describeEvent` joins header+body with `filter(Boolean)`, so
    // the prose appears with NO code change the moment #13 writes it.
    'src/data/story.json': [
      '.actIntros.1.body', '.actIntros.2.body', '.actIntros.3.body',
      '.actIntros.4.body', '.actIntros.5.body',
      '.actOutros.1.body', '.actOutros.2.body', '.actOutros.3.body',
      '.actOutros.4.body', '.actOutros.5.body',
    ],
    // NOT placeholders — STRUCTURAL. An empty middle segment is how the name table says
    // "this family has no middle word on this floor", so the generator emits a two-part
    // name. These six are correct as they stand and are frozen so they are not "fixed".
    'src/data/enemyNames.json': [
      '.1.Humanoid.middle.0.0',
      '.2.Humanoid.middle.0.0',
      '.2.Magical.middle.0.0',
      '.4.Beast.middle.0.0',
      '.4.Ancestral.first.0.0',
      '.4.Ancestral.middle.0.0',
    ],
  },
  // The four content files whose own `status` header says their content is not final.
  // These are DEVELOPER headers — no player and no prompt ever reads `.status`.
  placeholder: {
    'src/data/contentWarning.json': ['.status'],
    'src/data/corruptions.json': ['.status'],
    'src/data/floors.json': ['.status'],
    'src/data/restBriefs.json': ['.status'],
  },
  // Zero, and it stays zero: a note-to-self in DATA is text with a path to a screen.
  todo: {},
  // The legacy Java gear names, twelve per file. #13's to rename; frozen so the count
  // cannot creep upward while it waits.
  joke: {
    'src/data/armor.json': [
      '.act1.0.name', '.act1.1.name', '.act1.2.name',
      '.act2.0.name', '.act2.1.name', '.act2.2.name',
      '.act3.0.name', '.act3.1.name', '.act3.2.name',
      '.act4.0.name', '.act4.1.name', '.act4.2.name',
    ],
    'src/data/weapons.json': [
      '.act1.0.name', '.act1.1.name', '.act1.2.name',
      '.act2.0.name', '.act2.1.name', '.act2.2.name',
      '.act3.0.name', '.act3.1.name', '.act3.2.name',
      '.act4.0.name', '.act4.1.name', '.act4.2.name',
    ],
  },
  // Zero everywhere in data, and nothing may be added.
  parenS: {},
};

/**
 * The same, for string LITERALS in shipping `.ts`. Keyed by file → the exact literal texts.
 */
const FROZEN_TS: Record<RuleName, Record<string, string[]>> = {
  // An empty '' literal is ordinary code (a separator, a default), not unwritten prose, so
  // this rule is not applied to TypeScript at all — see the test below.
  empty: {},
  placeholder: {},
  todo: {},
  // The class starting kit points at the legacy gear ids, so the joke names are spelled
  // here too. They are IDS as well as names (`resolveGearDef` looks them up by name), so
  // #13 renames data and this table together.
  joke: {
    'src/game/classKit.ts': [
      'Jaaj Sword 1', 'Jooj Armor 1', 'Jooj Gun 1', 'Jaaj Armor 1', 'Jiij Rapier 1',
      'Jooj Armor 1', 'Jaaj Sword 1', 'Jaaj Armor 1', 'Jooj Gun 1', 'Jooj Armor 1',
    ],
  },
  // ZERO, and that is the ratchet having TURNED. `components.ts` used to build a condition
  // chip's tooltip as "<Name> — N turn(s) left" — a live instance of the defect FINDINGS.md
  // C10(a) closed in `narrate.ts` and `format.ts`, frozen at 1 by the unit that found it
  // because `src/render/components.ts` was outside its territory. `text-hygiene` fixed it:
  // the tooltip is now decided by the pure `chipTitle`, which picks the plural. The entry is
  // deleted rather than lowered to an empty list, because the FILE has nothing to declare.
  // Never raise it.
  parenS: {},
};

/** Files the static scan does not police, and why. */
const SKIPPED_DIRS = new Set(['node_modules', 'fixtures']);
function isTestFile(name: string): boolean {
  return name.endsWith('.test.ts') || name.endsWith('.testutil.ts');
}

/** Every shipping `.ts` under `src/`, as repo-relative posix paths. */
function shippingSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/`);
      else if (entry.name.endsWith('.ts') && !isTestFile(entry.name)) out.push(rel);
    }
  };
  walk('src', 'src/');
  return out.sort();
}

/** Every `src/data/*.json`, as repo-relative posix paths. */
function dataFiles(): string[] {
  return readdirSync(path.join(ROOT, 'src', 'data'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => `src/data/${f}`)
    .sort();
}

/** Compare a measured file→hits map against the frozen one, with a message that explains. */
function expectFrozen(
  label: string,
  measured: Record<string, string[]>,
  frozen: Record<string, string[]>,
): void {
  const files = [...new Set([...Object.keys(measured), ...Object.keys(frozen)])].sort();
  const problems: string[] = [];
  for (const file of files) {
    const got = (measured[file] ?? []).slice().sort();
    const want = (frozen[file] ?? []).slice().sort();
    if (got.length === want.length && got.every((v, i) => v === want[i])) continue;
    const added = got.filter((v) => !want.includes(v));
    const gone = want.filter((v) => !got.includes(v));
    const lines = [`${file} — ${label}: measured ${got.length}, frozen ${want.length}.`];
    if (added.length > 0) {
      lines.push(
        `  New: ${added.join(', ')}`,
        '  Something UNWRITTEN was added. If it is deliberate, put it in the frozen',
        '  inventory in this file WITH A REASON; otherwise write the text instead.',
      );
    }
    if (gone.length > 0) {
      lines.push(
        `  No longer present: ${gone.join(', ')}`,
        '  One of the known placeholders is gone. If it has been written, LOWER the frozen',
        '  inventory by deleting that entry — that is the ratchet turning, and it is good.',
      );
    }
    problems.push(lines.join('\n'));
  }
  expect(problems.join('\n\n')).toBe('');
}

describe('STATIC — the deliberate placeholders in src/data/*.json are exactly these', () => {
  /** file → rule → the leaf paths that trip it. Measured once. */
  const measured: Record<RuleName, Record<string, string[]>> = {
    empty: {}, placeholder: {}, todo: {}, joke: {}, parenS: {},
  };
  let leafCount = 0;
  for (const rel of dataFiles()) {
    const doc: unknown = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const { path: at, value } of jsonLeaves(doc)) {
      leafCount += 1;
      for (const name of Object.keys(RULES) as RuleName[]) {
        if (!RULES[name](value)) continue;
        (measured[name][rel] ??= []).push(at);
      }
    }
  }

  it('reads every data file and a real quantity of prose (non-vacuity)', () => {
    // If the walk silently found nothing, every rule below would pass by scanning air.
    expect(dataFiles().length).toBeGreaterThanOrEqual(15);
    expect(leafCount).toBeGreaterThan(500);
  });

  it('unwritten prose bodies: ten act bodies, six structural name gaps, nothing else', () => {
    expectFrozen('empty prose leaves', measured.empty, FROZEN_DATA.empty);
  });

  it('PLACEHOLDER headers: four content files, on `.status` only', () => {
    expectFrozen('PLACEHOLDER leaves', measured.placeholder, FROZEN_DATA.placeholder);
    // …and never anywhere a player or a prompt can reach: `.status` is a developer note.
    for (const paths of Object.values(measured.placeholder)) {
      for (const at of paths) expect(at).toBe('.status');
    }
  });

  it('no TODO / TBD / FIXME reaches a data file', () => {
    expectFrozen('TODO/TBD/FIXME leaves', measured.todo, FROZEN_DATA.todo);
  });

  it('the legacy joke gear names: twelve weapons, twelve armors', () => {
    expectFrozen('Jooj/Jaaj/Jiij leaves', measured.joke, FROZEN_DATA.joke);
  });

  it('no "(s)" optional-plural marker is in any data file', () => {
    expectFrozen('"(s)" leaves', measured.parenS, FROZEN_DATA.parenS);
  });
});

describe('STATIC — the string literals in shipping TypeScript are exactly these', () => {
  const measured: Record<RuleName, Record<string, string[]>> = {
    empty: {}, placeholder: {}, todo: {}, joke: {}, parenS: {},
  };
  let literalCount = 0;
  const files = shippingSources();
  for (const rel of files) {
    const lits = stringLiteralsOf(readFileSync(path.join(ROOT, rel), 'utf8'));
    literalCount += lits.length;
    for (const lit of lits) {
      for (const name of Object.keys(RULES) as RuleName[]) {
        // `empty` is not a TypeScript rule: `''` is ordinary code, not unwritten prose.
        if (name === 'empty') continue;
        if (!RULES[name](lit)) continue;
        (measured[name][rel] ??= []).push(lit);
      }
    }
  }

  it('walks the whole shipping source tree and finds real literals (non-vacuity)', () => {
    expect(files.length).toBeGreaterThanOrEqual(50);
    expect(literalCount).toBeGreaterThan(2000);
    // The walk really does exclude its own kind: no test file is in the set.
    expect(files.filter(isTestFile)).toEqual([]);
    expect(files).toContain('src/llm/narrate.ts');
    expect(files).toContain('src/render/format.ts');
  });

  it('no shipping literal carries a PLACEHOLDER header', () => {
    expectFrozen('PLACEHOLDER literals', measured.placeholder, FROZEN_TS.placeholder);
  });

  it('no shipping literal carries a TODO / TBD / FIXME (comments are fine — those are notes)', () => {
    expectFrozen('TODO/TBD/FIXME literals', measured.todo, FROZEN_TS.todo);
  });

  it('the joke gear names appear in exactly one shipping file, ten times', () => {
    expectFrozen('Jooj/Jaaj/Jiij literals', measured.joke, FROZEN_TS.joke);
  });

  it('the "(s)" marker is in NO shipping literal, anywhere', () => {
    expectFrozen('"(s)" literals', measured.parenS, FROZEN_TS.parenS);
    // The three the narrator, the log and the view model shipped are GONE and may not come
    // back — and so, since `text-hygiene` (G71b), is the condition chip's tooltip.
    expect(measured.parenS['src/llm/narrate.ts']).toBeUndefined();
    expect(measured.parenS['src/render/format.ts']).toBeUndefined();
    expect(measured.parenS['src/desktop/view-model.ts']).toBeUndefined();
    expect(
      measured.parenS['src/render/components.ts'],
      'the condition chip ships "turn(s)" again — G71(b) verbatim',
    ).toBeUndefined();
  });
});

describe('STATIC — the duplicated insanity lines are frozen as written', () => {
  it('fourteen lines, one of them repeated six times, and no other repeat', () => {
    // `Condition.java` shipped "~Don't fall~" six times out of fourteen, so it is what the
    // player hears most. Whether that is the intent is the AUTHOR's call (#13); this pins
    // it so the table cannot drift without someone noticing.
    expect(INSANITY_STRINGS).toHaveLength(14);
    const counts = new Map<string, number>();
    for (const line of INSANITY_STRINGS) counts.set(line, (counts.get(line) ?? 0) + 1);
    const repeated = Object.fromEntries([...counts].filter(([, n]) => n > 1));
    expect(repeated).toEqual({ "~Don't fall~": 6 });
    // …which leaves eight distinct lines besides it.
    expect(counts.size).toBe(9);
  });
});

// ===========================================================================
// PART 2 — the DYNAMIC sweep: no raw engine id reaches a player, on any run
// ===========================================================================
//
// THE RULES LIVE IN `src/llm/textHygiene.ts` NOW, not here.
//
// `text-hygiene` needed the same judgement applied to what the local MODEL says at run time,
// and the obvious shortcut — a second copy of these rules in the renderer — is the failure
// this project has already been bitten by: a duplicated guard that drifts. So the rules, and
// every word list they read, moved into a pure module that BOTH consumers import. This file
// selects `ENGINE_TEXT_RULES` (everything but `condition-label`, which the engine's own buff
// line "You steady yourself — Healthy." is deliberately shaped like); the renderer selects
// `MODEL_TEXT_RULES`; `src/dev/narrationCorpus.test.ts` re-runs the model list over what the
// real model actually produced.
//
// WHAT THIS FILE STILL OWNS: the SURFACES (which projectors a real run is swept through), the
// non-vacuity counters, and the ALLOWANCES — the named, reasoned exceptions, each of which
// must be EXERCISED or the loop below says to delete it.

const VOCAB = buildVocabulary();

/** A named, reasoned exception to one rule, matched against the WHOLE offending string. */
interface Allowance {
  rule: TextRuleId;
  where: RegExp;
  reason: string;
}

/**
 * THE ONE ALLOWANCE TABLE. Every exception the dynamic sweep grants lives here and nowhere
 * else, so the complete list of "things we know we print and have decided to live with" is
 * four rows of text rather than four scattered `if`s.
 *
 * Each row is counted. The loop under `the allowances are all EXERCISED` fails any row that
 * matched nothing, with a message saying to delete it — because an allowance nothing hits is
 * an allowance nobody can tell is wrong, and it keeps quietly widening the guard forever.
 */
const ALLOWANCES: readonly Allowance[] = [
  // Imported, not re-typed: the shared module owns the shape of the rolled-item name, so the
  // renderer's sweep and this one cannot disagree about what a legitimate `mainHand` is.
  ROLLED_NAME_ALLOWANCE,
  {
    rule: 'condition-id',
    where: /\bthe crew is now \d+ strong\b/,
    reason:
      'boss-summon counts the crew ("the crew is now 2 strong"); correct English that happens ' +
      'to contain the condition id `strong`. The precise check that a condition FACT never ' +
      'prints an id lives in src/llm/conditionFacts.test.ts, over all 25 x both subjects.',
  },
  // ⚠ A LIVE DEFECT, FROZEN RATHER THAN FIXED. It is AUTHORED PROSE, which is PLAN.md #13 /
  // FINDINGS.md C1's territory and not this unit's — this unit's job was to make it
  // DETECTABLE, and this row is the proof that it worked: no guard could see these two
  // sentences before the prose rules existed. DELETE the row when #13 rewrites them.
  {
    rule: 'void-as-place',
    where: /\bYou (escape into|sacrifice \d+ of your max HP to) the Void\b/,
    reason:
      'format.ts, the combat log: "You escape into the Void." and "You sacrifice N of your max ' +
      'HP to the Void." WORLD.md §6 — the Void is not a place you can enter or give things to. ' +
      'AUTHORED PROSE: PLAN.md #13 / FINDINGS.md C1. Reported in the text-hygiene handoff.',
  },
  // ⚠ NOT LISTED, AND DELIBERATELY SO: `narrate.ts`'s empty-cache fact, "You pry it open, but
  // it is hollow." — a third reserved-word instance, and the one narrate.ts's own comment
  // already records as C1. A row for it was written and then DELETED, because the exercised
  // loop below failed it: in twenty real runs an opened cache is never empty, so that sentence
  // is unreachable from this sweep and the row would have been dead weight from birth. That is
  // the loop doing exactly its job. Catching that line needs a STATIC prose scan over the
  // shipping literals, which `text-hygiene` deliberately left to a later unit — the detector
  // it would call already exists.
];

interface Sighting {
  surface: string;
  text: string;
  /** What the rule matched, so a failure names the offending WORD as well as the sentence. */
  match: string;
}

interface Sweep {
  runs: number;
  steps: number;
  surfaces: number;
  /** Every fault, bucketed by the rule that produced it. */
  hits: Record<TextRuleId, Sighting[]>;
  /** How often each row of `ALLOWANCES` actually matched, in the table's own order. */
  allowanceSightings: number[];
  conditionApplied: number;
  conditionDamage: number;
  unableToAct: number;
  triggeredEffectsShown: number;
  itemNamesSeen: number;
  // ---- the five projectors `text-hygiene` added to the sweep ----
  dealViews: number;
  /** Deals whose reward is an UN-ROLLED catalog item — the surface G71(a) lived on. */
  catalogRewardDeals: number;
  dealDiscardViews: number;
  draftCards: number;
  consumableOptions: number;
  runSummaries: number;
}

/** An empty bucket per rule, so a rule that never fires is an empty array, not `undefined`. */
function emptyHits(): Record<TextRuleId, Sighting[]> {
  const out = {} as Record<TextRuleId, Sighting[]>;
  for (const rule of ALL_TEXT_RULES) out[rule] = [];
  return out;
}

/**
 * Play real seeded runs and scan EVERY string that reaches a player or the model.
 *
 * Five classes × four seeds through the shipped `heuristicPolicy` — the same driver
 * `narrationCoverage.test.ts` uses. Deliberately NOT swept: `prompt.user`, which embeds
 * authored rest-brief lore that may legitimately contain any English word. The FACTS are
 * the engine's own sentences, and those are exactly what the failure path prints.
 */
function runSweep(): Sweep {
  const s: Sweep = {
    runs: 0, steps: 0, surfaces: 0,
    hits: emptyHits(),
    allowanceSightings: ALLOWANCES.map(() => 0),
    conditionApplied: 0, conditionDamage: 0, unableToAct: 0,
    triggeredEffectsShown: 0, itemNamesSeen: 0,
    dealViews: 0, catalogRewardDeals: 0, dealDiscardViews: 0,
    draftCards: 0, consumableOptions: 0, runSummaries: 0,
  };

  const scan = (surface: string, text: string): void => {
    if (!text) return;
    s.surfaces += 1;
    const { faults, allowed } = detectTextFaults(text, VOCAB, { rules: ENGINE_TEXT_RULES });
    for (const fault of faults) {
      const row = ALLOWANCES.findIndex((a) => a.rule === fault.rule && a.where.test(text));
      if (row >= 0) {
        s.allowanceSightings[row] = (s.allowanceSightings[row] ?? 0) + 1;
        continue;
      }
      s.hits[fault.rule].push({ surface, text, match: fault.match });
    }
    // The detector resolves the rolled-item-name allowance itself (it needs the match's
    // POSITION, which only it has), and reports what it absolved. Count it on the same table.
    for (const a of allowed) {
      const row = ALLOWANCES.findIndex((x) => x.rule === a.rule && x.reason === a.allowance);
      if (row >= 0) s.allowanceSightings[row] = (s.allowanceSightings[row] ?? 0) + 1;
    }
  };

  for (const classId of ALL_CLASSES as readonly PlayerClass[]) {
    for (const seed of [1, 2, 3, 4]) {
      const policy = heuristicPolicy(classId);
      const initial: GameState = createGame(seed);
      let res: StepResult = { state: initial, events: [], awaiting: awaitingFor(initial.phase) };
      s.runs += 1;
      let guard = 0;
      // The run-summary subscriber, folded exactly the way `game.ts`'s `dispatch` folds it,
      // so the summary the end-of-run screen is projected from is the REAL one.
      let summary = emptyRunSummary();
      while (res.awaiting !== 'game-over' && guard < 50_000) {
        res = step(res.state, policy(res));
        guard += 1;
        s.steps += 1;
        summary = foldRunEvents(summary, res.events, res.state);

        for (const e of res.events) {
          if (e.kind === 'condition-applied') s.conditionApplied += 1;
          else if (e.kind === 'condition-damage') s.conditionDamage += 1;
          else if (e.kind === 'player-unable-to-act') s.unableToAct += 1;
          scan(`describeEvent/${e.kind}`, describeEvent(e));
          scan(`formatEvent/${e.kind}`, formatEvent(e));
          if (e.kind === 'chest-loot') {
            for (const row of e.loot) scan('chest-loot.name', row.name);
          }
        }
        // The real chest screen: `game.ts` calls `chestReveal(state.phase.loot)` — the live
        // INSTANCES, not the event's already-summarized copies.
        if (res.state.phase.kind === 'chest') {
          for (const row of chestReveal(res.state.phase.loot)) scan('chestReveal', row.name);
        }
        for (const fact of eventsToFacts(res.events)) scan('fact', fact);
        scan('fallbackNarration', fallbackNarration(buildNarrationPrompt(res.events, res.state)));

        const player = displayPlayer(res.state);
        if (player && Array.isArray(player.skillPool) && player.inventory) {
          const inv = describeInventory(player);
          const rows = [
            ...inv.slots.flatMap((row) => (row.item ? [row.item] : [])),
            ...inv.backpack.map((row) => row.item),
          ];
          for (const item of rows) {
            s.itemNamesSeen += 1;
            scan('displayItem.name', item.name);
            for (const phrase of item.effects) {
              if (/^[A-Z][^:]+: /.test(phrase)) s.triggeredEffectsShown += 1;
              scan('displayItem.effect', phrase);
            }
          }
          for (const option of castOptions(player)) scan('castOptions.name', option.name);
          for (const skill of characterSheet(player).skills) scan('sheet.skill', skill.name);
          // THE BATTLE "Use item" LIST. `consumableOptions` reads the catalog def's NAME, so
          // it is on exactly the resolution path G71(a) broke for the altar.
          for (const option of consumableOptions(res.state.player!)) {
            s.consumableOptions += 1;
            scan('consumableOptions.name', option.name);
          }
        }

        // THE ALTAR. `dealView` is where G71(a) printed `mirror-shard` at the player.
        const phase = res.state.phase;
        if (phase.kind === 'deal' || phase.kind === 'deal-discard') {
          const view = dealView(phase.deal);
          s.dealViews += 1;
          if (phase.deal.reward.kind === 'item' && !phase.deal.reward.instance.rolled) {
            s.catalogRewardDeals += 1;
          }
          scan('dealView.cost', view.cost);
          scan('dealView.reward', view.reward);
          // THE FULL-PACK SCREEN, projected on EVERY deal phase and not only on the real
          // `deal-discard` ones. It is a pure function of player + deal, so this is exactly
          // what the screen WOULD show if the pack were full — and a full pack is rare enough
          // in twenty heuristic runs that waiting for one would leave the surface unswept.
          if (res.state.player) {
            const leaving = phase.kind === 'deal-discard' ? (phase.leaving ?? []) : [];
            const dd = dealDiscardView(res.state.player, phase.deal, leaving);
            s.dealDiscardViews += 1;
            scan('dealDiscardView.prompt', dd.prompt);
            scan('dealDiscardView.cost', dd.cost);
            scan('dealDiscardView.choose', dd.choose);
            scan('dealDiscardView.refuse', dd.refuse);
            for (const row of dd.leave) scan('dealDiscardView.leave', row.label);
          }
        }
        // THE LEVEL-UP DRAFT. Its labels come from the engine's `describeDraftOption`, which
        // reads skill and perk tables full of camelCase ids.
        if (phase.kind === 'level-up-draft') {
          for (const card of draftCards(phase.offers)) {
            s.draftCards += 1;
            scan('draftCards.label', card.label);
          }
        }
      }

      // THE END-OF-RUN SCREEN, from the REAL fold and the REAL unlock application against a
      // fresh store — not a hand-built summary, because the whole point is the rows a real
      // run produces (a boss name, a newly-unlocked relic name, the class and level).
      const newly = applyRunSummary(createUnlockStore(), summary, seed).newlyUnlocked;
      const view = runSummaryView(summary, res.state.player, newly, seed);
      s.runSummaries += 1;
      scan('runSummaryView.headline', view.headline);
      for (const row of view.rows) {
        scan('runSummaryView.label', row.label);
        scan('runSummaryView.value', row.value);
      }
    }
  }
  return s;
}

/** One report line per offending sighting — the failure names seed-independent evidence. */
function report(hits: readonly Sighting[]): string {
  return hits
    .slice(0, 12)
    .map((h) => `  ${h.surface} [${h.match}]: "${h.text}"`)
    .join('\n');
}

describe('DYNAMIC — nothing a real run shows the player is an engine id', () => {
  const sweep = runSweep();

  it('the sweep really happened, and really saw the things it is checking', () => {
    // Non-vacuity. Every assertion below is a "no hits" claim, which is exactly the shape
    // that passes for free when the harness silently did nothing.
    expect(sweep.runs).toBe(20); //             5 classes × 4 seeds
    expect(sweep.steps).toBeGreaterThan(1000);
    expect(sweep.surfaces).toBeGreaterThan(10_000);
    expect(sweep.conditionApplied, 'no condition ever landed').toBeGreaterThan(0);
    expect(sweep.conditionDamage, 'no condition ever ticked for damage').toBeGreaterThan(0);
    expect(sweep.unableToAct, 'nobody was ever stunned out of a turn').toBeGreaterThan(0);
    expect(sweep.itemNamesSeen, 'no inventory was ever displayed').toBeGreaterThan(100);
    expect(
      sweep.triggeredEffectsShown,
      'no triggered effect was ever displayed — the C9 surface went unexercised',
    ).toBeGreaterThan(0);
  });

  it('...and every one of the five projectors added by text-hygiene was reached', () => {
    // A surface nobody reaches is a surface this sweep does not guard, however many rules
    // run over it. Each of these was counted while the sweep ran.
    expect(sweep.dealViews, 'no bargain was ever projected — dealView is unswept').toBeGreaterThan(0);
    expect(
      sweep.catalogRewardDeals,
      'no bargain with an UN-ROLLED catalog reward was projected — the exact surface G71(a) ' +
        'lived on is unswept, so "no catalog id is shown" proves nothing about it',
    ).toBeGreaterThan(0);
    expect(sweep.dealDiscardViews, 'the full-pack bargain screen is unswept').toBeGreaterThan(0);
    expect(sweep.draftCards, 'no level-up draft was ever offered — draftCards is unswept').toBeGreaterThan(0);
    expect(sweep.consumableOptions, 'no Use-item list was ever built').toBeGreaterThan(0);
    // One summary per run, and every run ends: 20.
    expect(sweep.runSummaries, 'a run ended without its summary being projected').toBe(20);
  });

  it('no trigger, action kind or passive type is ever shown (C9)', () => {
    expect(report(sweep.hits['effect-id']), `${sweep.hits['effect-id'].length} sightings`).toBe('');
  });

  it('no condition id is ever shown (C7 / C10)', () => {
    expect(report(sweep.hits['condition-id']), `${sweep.hits['condition-id'].length} sightings`).toBe('');
  });

  it('no catalog defId is ever shown — and there is no allowance left for one (G71a)', () => {
    expect(report(sweep.hits['catalog-id']), `${sweep.hits['catalog-id'].length} sightings`).toBe('');
    // The allowance for `mirror-shard` is GONE, not merely unused: `deal.ts` resolves the
    // catalog name now, so nothing needs absolving.
    expect(ALLOWANCES.some((a) => a.rule === 'catalog-id')).toBe(false);
  });

  it('no camelCase or snake_case token is shown outside a rolled item name', () => {
    expect(report(sweep.hits['id-shape']), `${sweep.hits['id-shape'].length} sightings`).toBe('');
  });

  it('no "(s)" optional-plural marker reaches any run surface', () => {
    expect(report(sweep.hits['paren-s']), `${sweep.hits['paren-s'].length} sightings`).toBe('');
  });

  it('no floor is named by its ordinal', () => {
    // WORLD.md: a floor has a NAME ("the Ash City"), and the player is never told a number.
    expect(report(sweep.hits['ordinal-floor']), `${sweep.hits['ordinal-floor'].length} sightings`).toBe('');
  });

  it('the Void is never a place you enter or leave', () => {
    // WORLD.md §6: "The Void is not a place — it is a condition, and the condition is the
    // Hollow." The two engine lines that break this are in the ALLOWANCES table above, with
    // their reason and their routing; anything else fails here.
    expect(report(sweep.hits['void-as-place']), `${sweep.hits['void-as-place'].length} sightings`).toBe('');
  });

  it('no reserved word is used casually', () => {
    // WORLD.md §0 reserves `hollow` and `made whole`. A capitalised Hollow is a NAME (the
    // class, the boss, the floor-5 family) and passes.
    expect(report(sweep.hits['reserved-word']), `${sweep.hits['reserved-word'].length} sightings`).toBe('');
  });

  // ---- the allowance table, one `it` per row ----------------------------------
  //
  // A loop, so adding a row to the table adds its own test automatically and a row can never
  // be added without being proved live. An allowance nothing hits is an allowance nobody can
  // tell is wrong — and the day the engine stops printing the phrase, THIS is what says so.
  describe('the allowances are all EXERCISED, so none is dead weight', () => {
    it('the table is not empty, and every row names a real rule', () => {
      expect(ALLOWANCES.length).toBeGreaterThan(0);
      for (const a of ALLOWANCES) {
        expect(ALL_TEXT_RULES, `${a.reason}: unknown rule ${a.rule}`).toContain(a.rule);
        expect(a.reason.length, 'an allowance with no reason is an unexplained hole').toBeGreaterThan(20);
      }
      expect(sweep.allowanceSightings).toHaveLength(ALLOWANCES.length);
    });

    ALLOWANCES.forEach((allowance, i) => {
      it(`[${allowance.rule}] ${allowance.where.source} is exercised`, () => {
        expect(
          sweep.allowanceSightings[i],
          `this allowance matched NOTHING in twenty real runs. Either the engine no longer ` +
            `prints it — in which case DELETE the row, that is the ratchet turning — or the ` +
            `sweep stopped reaching the surface it lived on. Reason on file: ${allowance.reason}`,
        ).toBeGreaterThan(0);
      });
    });
  });
});
