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
//             that reaches a player or the model for a raw engine id.
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
  describeInventory,
  displayPlayer,
  fallbackNarration,
} from '../desktop/view-model.ts';
import { CONDITION_DATA, INSANITY_STRINGS } from '../game/condition.ts';
import {
  getAllItems,
  getAllRelics,
  getAllUniques,
  getAllConsumables,
} from '../game/item.ts';

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
  // ⚠ ONE ENTRY, AND IT IS NOT DELIBERATE. `components.ts` builds a condition chip's
  // tooltip as "<Name> — N turn(s) left". It is a live instance of exactly the defect
  // FINDINGS.md C10(a) closed in `narrate.ts` and `format.ts`, and the fix is the same one
  // line those two got. It is frozen at 1 rather than fixed ONLY because this unit's
  // declared territory did not include `src/render/components.ts`; it is reported in the
  // unit's handoff for routing. LOWER THIS TO ZERO when it is fixed. Never raise it.
  parenS: {
    'src/render/components.ts': ['${} — ${} turn(s) left'],
  },
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

  it('the "(s)" marker survives in exactly one place, and it is a defect, not a decision', () => {
    expectFrozen('"(s)" literals', measured.parenS, FROZEN_TS.parenS);
    // The two the narrator and the log shipped are GONE and may not come back.
    expect(measured.parenS['src/llm/narrate.ts']).toBeUndefined();
    expect(measured.parenS['src/render/format.ts']).toBeUndefined();
    expect(measured.parenS['src/desktop/view-model.ts']).toBeUndefined();
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

const CONDITION_IDS = Object.keys(CONDITION_DATA);

/**
 * Every member of the three effect unions, by hand from `src/game/item.ts` (they are types;
 * there is no runtime array to iterate, and a hand list is what keeps this independent of
 * the tables it checks).
 */
const EFFECT_IDS: readonly string[] = [
  'startOfBattle', 'onHit', 'onCrit', 'onCast', 'onKill', 'onTakeDamage',
  'dealDamage', 'healSelf', 'applyConditionSelf', 'applyConditionEnemy', 'gainShield',
  'gainStat', 'restoreCharge', 'revive', 'cure', 'flee', 'reroll', 'drainCharge',
  'bonusStat', 'bonusArmorClass', 'bonusDamage', 'bonusResist', 'skillChargeDiscount',
  'firstHitReduction', 'lowHpDamageBonus', 'dotTickMultiplier', 'chargePerTurn',
  'damageDealtMultiplier', 'cannotHeal', 'healMultiplier',
];

/** Every catalog defId that ships — the ids `summarizeLoot` and friends must never print. */
const CATALOG_IDS: readonly string[] = [
  ...getAllItems(), ...getAllRelics(), ...getAllUniques(), ...getAllConsumables(),
].map((d) => d.id);

/** A camelCase token: a shape English never produces, and every engine id wears it. */
const CAMEL_TOKEN = /\b[a-z]+[A-Z][A-Za-z]*\b/g;

/**
 * FROZEN ALLOWANCES for the dynamic sweep. Each is a KNOWN hit with a reason; anything else
 * fails. Like the static inventory, these only ever come off the list.
 */
const ALLOWED_CAMEL = new Set(['mainHand', 'offHand']);

/**
 * `rarityGen.ts` names a rolled drop `${rarity} ${slot}`, so the SLOT ID is the item's
 * player-facing name: "Legendary mainHand". That is the register's naming defect (PLAN.md
 * #13) and it is allowed here ONLY in that exact shape — a camelCase token loose in a
 * sentence is not covered by it.
 */
const ROLLED_NAME = /\b(Common|Rare|Legendary) (mainHand|offHand)\b/;

/**
 * A condition ID is also, for almost all twenty-five, an ordinary English word, so a
 * whole-word scan over free prose has false positives. Exactly one exists today and it is
 * correct English: `boss-summon` counts the crew ("the crew is now 2 strong"). The precise
 * check that a condition FACT never prints an id lives in `src/llm/conditionFacts.test.ts`,
 * which sweeps all 25 × both subjects × every condition-carrying event kind.
 */
const ALLOWED_CONDITION_PHRASE: readonly { id: string; where: RegExp }[] = [
  { id: 'strong', where: /\bthe crew is now \d+ strong\b/ },
];

/**
 * ⚠ A KNOWN LIVE DEFECT, frozen rather than fixed. `deal.ts` `describeReward` renders an
 * item reward as `instance.rolled?.name ?? instance.defId`. A relic offered by the grace
 * pool has no `rolled` overlay, so the raw catalog id prints — on the altar screen, in the
 * combat log, in the narrator's facts, and in the model-failure fallback. It is the same
 * defect `summarizeLoot` already fixed for loot (its own comment records that), and the fix
 * is the same one line: fall back through `getCatalogItemById(defId)?.name`.
 *
 * Frozen at exactly this id ONLY because `src/game/deal.ts` is outside this unit's declared
 * territory; reported in the handoff. DELETE this entry when it is fixed.
 */
const ALLOWED_CATALOG_IDS = new Set(['mirror-shard']);

interface Sighting {
  surface: string;
  text: string;
}

interface Sweep {
  runs: number;
  steps: number;
  surfaces: number;
  conditionHits: Sighting[];
  effectHits: Sighting[];
  catalogHits: (Sighting & { id: string })[];
  camelHits: (Sighting & { token: string })[];
  parenSHits: Sighting[];
  /** How often the frozen `mainHand`/`offHand` rolled-name allowance actually matched. */
  allowedCamelSightings: number;
  conditionApplied: number;
  conditionDamage: number;
  unableToAct: number;
  triggeredEffectsShown: number;
  itemNamesSeen: number;
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
    conditionHits: [], effectHits: [], catalogHits: [], camelHits: [], parenSHits: [],
    allowedCamelSightings: 0,
    conditionApplied: 0, conditionDamage: 0, unableToAct: 0,
    triggeredEffectsShown: 0, itemNamesSeen: 0,
  };

  const scan = (surface: string, text: string): void => {
    if (!text) return;
    s.surfaces += 1;
    for (const id of CONDITION_IDS) {
      if (!new RegExp(`\\b${id}\\b`).test(text)) continue;
      if (ALLOWED_CONDITION_PHRASE.some((a) => a.id === id && a.where.test(text))) continue;
      s.conditionHits.push({ surface, text });
    }
    for (const id of EFFECT_IDS) {
      if (new RegExp(`\\b${id}\\b`).test(text)) s.effectHits.push({ surface, text });
    }
    for (const id of CATALOG_IDS) {
      if (!text.includes(id)) continue;
      if (ALLOWED_CATALOG_IDS.has(id)) continue;
      s.catalogHits.push({ surface, text, id });
    }
    for (const token of text.match(CAMEL_TOKEN) ?? []) {
      if (ALLOWED_CAMEL.has(token) && ROLLED_NAME.test(text)) {
        s.allowedCamelSightings += 1;
        continue;
      }
      s.camelHits.push({ surface, text, token });
    }
    if (text.includes('(s)')) s.parenSHits.push({ surface, text });
  };

  for (const classId of ALL_CLASSES as readonly PlayerClass[]) {
    for (const seed of [1, 2, 3, 4]) {
      const policy = heuristicPolicy(classId);
      const initial: GameState = createGame(seed);
      let res: StepResult = { state: initial, events: [], awaiting: awaitingFor(initial.phase) };
      s.runs += 1;
      let guard = 0;
      while (res.awaiting !== 'game-over' && guard < 50_000) {
        res = step(res.state, policy(res));
        guard += 1;
        s.steps += 1;

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
        }
      }
    }
  }
  return s;
}

/** One report line per offending sighting — the failure names seed-independent evidence. */
function report(hits: readonly Sighting[]): string {
  return hits
    .slice(0, 12)
    .map((h) => `  ${h.surface}: "${h.text}"`)
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

  it('no trigger, action kind or passive type is ever shown (C9)', () => {
    expect(report(sweep.effectHits), `${sweep.effectHits.length} sighting(s)`).toBe('');
  });

  it('no condition id is ever shown (C7 / C10)', () => {
    expect(report(sweep.conditionHits), `${sweep.conditionHits.length} sighting(s)`).toBe('');
  });

  it('no catalog defId is ever shown, beyond the one frozen above', () => {
    const lines = sweep.catalogHits.slice(0, 12).map((h) => `  ${h.surface} [${h.id}]: "${h.text}"`);
    expect(lines.join('\n')).toBe('');
  });

  it('no camelCase token is shown outside a rolled item name', () => {
    const lines = sweep.camelHits.slice(0, 12).map((h) => `  ${h.surface} [${h.token}]: "${h.text}"`);
    expect(lines.join('\n')).toBe('');
  });

  it('no "(s)" optional-plural marker reaches any run surface', () => {
    expect(report(sweep.parenSHits), `${sweep.parenSHits.length} sighting(s)`).toBe('');
  });

  it('the camelCase allowance is EXERCISED, so it is not dead weight', () => {
    // An allowance nothing hits is an allowance nobody can tell is wrong. `Legendary
    // mainHand` really does reach the inventory, the victory line and the chest screen — so
    // the day `rarityGen`'s naming is fixed, `allowedCamelSightings` drops to zero and this
    // test says so, which is the signal to delete the allowance.
    expect(
      sweep.allowedCamelSightings,
      'the rolled-name allowance matched nothing — either rarityGen no longer names drops ' +
        'after their slot (delete ALLOWED_CAMEL and ROLLED_NAME) or the sweep stopped ' +
        'reaching the inventory',
    ).toBeGreaterThan(0);
    expect([...ALLOWED_CAMEL].sort()).toEqual(['mainHand', 'offHand']);
  });
});
