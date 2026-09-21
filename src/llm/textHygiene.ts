// TEXT HYGIENE — one rule set for "is this sentence fit for a player to read?", shared by
// the ratchet at TEST time and by the renderer at RUN time.
//
// WHY ONE MODULE, AND WHY HERE.
//
// `src/dev/placeholderRatchet.test.ts` already swept engine-written prose for raw enum ids.
// This unit needed the SAME judgement applied to what the local model says at run time, and
// the obvious shortcut — a second copy of the rules in the renderer — is guard-failure #11 in
// this project's catalogue: a duplicated guard that drifts. So the rules moved HERE, the
// ratchet imports them, and the renderer imports them. There is exactly one definition of
// every rule and exactly one derivation of every word list.
//
// `src/llm` and not `src/dev` because this SHIPS (the renderer imports it, and `src/dev` is
// excluded from the packaged bundle). Not `src/render` because it is not a projector and the
// purity guard has its own rules there. `src/llm` is already the pure layer that reads
// `src/game` data the way `narrate.ts` does, and this is about what the MODEL says.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no DOM, no Kaplay, no `../render`, no `../desktop`, no
//    `../log`. Every export is a pure function of its arguments and of the data modules.
//  - Deterministic: no `Math.random()`, no `Date.now()`. The same text always yields the
//    same faults, so a fault found in a log can be reproduced in a test.
//  - Data-driven content: EVERY word list below is DERIVED — condition ids and display names
//    from `CONDITION_DATA`, floor names from `floors.json`, catalog ids and names from the
//    four catalogs, sanctioned phrases from skill/boss/family/class/ending data. Renaming a
//    condition or adding a relic updates the vocabulary with no edit here. ONE hand list
//    survives (`effectIds`) and its comment says why.
//  - Logging happens at the BOUNDARY. Nothing here logs; `src/desktop/game.ts` logs what
//    this returns.
//
// ---------------------------------------------------------------------------------------
// DELIBERATE BLIND SPOTS — written down so they are decisions, not oversights.
//
//  1. A LOWERCASE echo of a condition's display name is ordinary English and is NOT caught.
//     "you feel healthy" is a sentence; "you feel Healthy" is the engine's label leaking into
//     prose. Only the capitalised form fires, and only mid-sentence or as a bare fragment —
//     a capitalised label that OPENS a sentence which then continues is ordinary English.
//     The cost, accepted: a one-word imperative ("Sleep.") reads as a fragment and fires.
//  2. A capitalised casual `Hollow` is NOT caught. `Hollow` is a class id, a boss name and a
//     family name, so capitalisation is the only signal available, and the reserved word
//     `WORLD.md` §0 protects is the lowercase adjective.
//  3. `Act N` is NOT an ordinal-floor fault. The prompt header itself says `Act 3, the Ash
//     City` and the run summary prints `Act 3 of 5`; the design speaks of acts openly. Only
//     floor/storey/level ordinals and `floor N` are faults.
// ---------------------------------------------------------------------------------------

import { CONDITION_DATA } from '../game/condition.ts';
import { FLOOR_IDS, floorDef } from '../game/floors.ts';
import {
  getAllItems,
  getAllRelics,
  getAllUniques,
  getAllConsumables,
} from '../game/item.ts';
import { SKILLS } from '../game/skill.ts';
import { BOSSES } from '../game/boss.ts';
import { FAMILIES } from '../game/enemyFamily.ts';
import { CLASSES } from '../game/classKit.ts';
import { getGraceEnding, getDamnationEnding } from '../game/story.ts';

// ===========================================================================
// The rules, as identifiers
// ===========================================================================

/**
 * Every rule this module can apply. A rule id is a STABLE name: it appears in the renderer's
 * `narrate: done` log line, in the corpus records on disk and in the ratchet's failure
 * messages, so renaming one is a migration, not a rename.
 */
export type TextRuleId =
  /** A raw condition id as a whole word — `exposed` where `Exposed` was meant. */
  | 'condition-id'
  /** A condition's DISPLAY name, capitalised, mid-sentence — the engine's label in prose. */
  | 'condition-label'
  /** A trigger / action / passive id — `onHit`, `dealDamage`, `healMultiplier`. */
  | 'effect-id'
  /** A catalog item's id where its NAME was meant — `mirror-shard` for `Mirror Shard`. */
  | 'catalog-id'
  /** A camelCase or snake_case token: a shape English never produces. */
  | 'id-shape'
  /** The optional-plural marker `(s)`: the writer knows the number, so it must pick a form. */
  | 'paren-s'
  /** A floor named by its ORDINAL — `the second floor`, `Floor 3`, `the deepest level`. */
  | 'ordinal-floor'
  /** The Void treated as a PLACE you can enter or leave (`WORLD.md` §6). */
  | 'void-as-place'
  /** A reserved word used casually (`WORLD.md` §0): lowercase `hollow*`, and `made whole`. */
  | 'reserved-word';

/** Every rule id, in a fixed order. */
export const ALL_TEXT_RULES: readonly TextRuleId[] = [
  'condition-id',
  'condition-label',
  'effect-id',
  'catalog-id',
  'id-shape',
  'paren-s',
  'ordinal-floor',
  'void-as-place',
  'reserved-word',
];

/**
 * The rules that apply to ENGINE-written text.
 *
 * `condition-label` is excluded on purpose: the engine's own designed buff line reads
 * "You steady yourself — Healthy." That capitalised mid-sentence label is the DESIGN
 * (`format.ts` writes it deliberately), so on engine surfaces the rule would flag the design
 * rather than a defect.
 */
export const ENGINE_TEXT_RULES: readonly TextRuleId[] = ALL_TEXT_RULES.filter(
  (r) => r !== 'condition-label',
);

/**
 * The rules that apply to MODEL-written text.
 *
 * `condition-id` and `effect-id` are excluded: the model is handed the engine's FACTS, which
 * never carry an id (`conditionFacts.test.ts` sweeps that exhaustively), and almost every
 * condition id is also an ordinary English word — `weak`, `slow`, `sick`, `quick`, `strong`.
 * Running them over free prose is pure false positives. `catalog-id` and `id-shape` stay,
 * because those shapes are NOT English and can only have come from a leaked fact.
 */
export const MODEL_TEXT_RULES: readonly TextRuleId[] = ALL_TEXT_RULES.filter(
  (r) => r !== 'condition-id' && r !== 'effect-id',
);

// ===========================================================================
// The results
// ===========================================================================

/** One offending stretch of text: which rule, what matched, and where. */
export interface TextFault {
  rule: TextRuleId;
  /** The exact matched text, so a failure message can quote it. */
  match: string;
  /** The index of the match in the ORIGINAL text (the sanctioned strip preserves indices). */
  index: number;
}

/** A match that a named allowance absolves. Counted, never failed on. */
export interface TextAllowance {
  rule: TextRuleId;
  match: string;
  /** Why it is allowed — the same reason string the allowance carries. */
  allowance: string;
}

/** Everything the rules need to know about this game's own words. All of it derived. */
export interface TextVocabulary {
  /** The 25 condition ids, e.g. `exposed`. */
  conditionIds: readonly string[];
  /** Their display names, e.g. `Exposed`, `Agile` (whose id is `quick`). */
  conditionNames: readonly string[];
  /** The three effect unions, by hand — see the comment on `EFFECT_IDS`. */
  effectIds: readonly string[];
  /** Every catalog entry, id and name together, so the rule can skip the ones that match. */
  catalogIds: readonly { id: string; name: string }[];
  /** The five floor names, in floor order. */
  floorNames: readonly string[];
  /**
   * Phrases that legitimately contain a reserved word or the word Void — proper names the
   * game owns. Stripped from the text before the prose rules run, so `Entrance to the Void`
   * is not read as somebody entering a place.
   */
  sanctioned: readonly string[];
}

// ===========================================================================
// The vocabulary — derived, never re-typed
// ===========================================================================

/**
 * Every member of the three effect unions, BY HAND from `src/game/item.ts`.
 *
 * THE ONE HAND LIST, and it is not laziness: the unions are TYPES, erased at runtime, so
 * there is no array to iterate. A hand list is also what keeps this independent of the
 * tables it checks. It used to be written twice (here and in the ratchet); it is now written
 * once and both consumers read it.
 */
const EFFECT_IDS: readonly string[] = [
  'startOfBattle', 'onHit', 'onCrit', 'onCast', 'onKill', 'onTakeDamage',
  'dealDamage', 'healSelf', 'applyConditionSelf', 'applyConditionEnemy', 'gainShield',
  'gainStat', 'restoreCharge', 'revive', 'cure', 'flee', 'reroll', 'drainCharge',
  'bonusStat', 'bonusArmorClass', 'bonusDamage', 'bonusResist', 'skillChargeDiscount',
  'firstHitReduction', 'lowHpDamageBonus', 'dotTickMultiplier', 'chargePerTurn',
  'damageDealtMultiplier', 'cannotHeal', 'healMultiplier',
];

/**
 * Which phrases count as SANCTIONED. A name the game owns may contain a reserved word or the
 * word Void; a sentence the model wrote may not. The filter keeps the strip cheap and keeps
 * an ordinary item name (`Rusted Blade`) from masking anything by accident.
 */
const SANCTIONED_SHAPE = /hollow|made whole|void/i;

let cached: TextVocabulary | null = null;

/**
 * The game's own words, folded to plain arrays — PURE, and memoised because the ratchet asks
 * for it once and then scans tens of thousands of strings with it.
 */
export function buildVocabulary(): TextVocabulary {
  if (cached) return cached;

  const conditionIds = Object.keys(CONDITION_DATA);
  const conditionNames = Object.values(CONDITION_DATA).map((d) => d.displayName);
  const catalog = [
    ...getAllItems(), ...getAllRelics(), ...getAllUniques(), ...getAllConsumables(),
  ].map((d) => ({ id: d.id, name: d.name }));
  const floorNames = FLOOR_IDS.map((f) => floorDef(f).name);

  // Every proper name the game owns, then filtered to the ones that could be misread.
  const names: string[] = [
    ...floorNames,
    ...catalog.map((c) => c.name),
    ...Object.values(SKILLS).map((s) => s.name),
    ...Object.values(BOSSES).map((b) => b.name),
    ...FAMILIES.map((f) => f.name),
    ...Object.keys(CLASSES),
    getGraceEnding().body,
    getDamnationEnding().body,
  ];
  const sanctioned = [...new Set(names.filter((n) => n !== '' && SANCTIONED_SHAPE.test(n)))];

  cached = {
    conditionIds,
    conditionNames,
    effectIds: EFFECT_IDS,
    catalogIds: catalog,
    floorNames,
    sanctioned,
  };
  return cached;
}

// ===========================================================================
// The patterns — one `const` each, with the reason beside it
// ===========================================================================

/** A camelCase token: a shape English never produces, and every engine id wears it. */
const CAMEL_TOKEN = /\b[a-z]+[A-Z][A-Za-z]*\b/g;

/** A snake_case token: the other id shape, the one JSON keys and prompt fields wear. */
const SNAKE_TOKEN = /\b[a-z]+_[a-z_]+\b/g;

/**
 * A floor named by its position rather than by its name. Two shapes, because English has
 * two: the ordinal before the noun, and the number after it.
 */
const ORDINAL_BEFORE =
  /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|next|last|final|lower|lowest|upper|deeper|deepest|bottom|top)\s+(floor|storey|level)s?\b/gi;
const NUMBER_AFTER = /\b(floor|storey)\s+(one|two|three|four|five|[1-9])\b/gi;

/**
 * The Void as a PLACE — `WORLD.md` §6: "The Void is not a place — it is a condition." A
 * preposition of motion or location in front of it, a part-of-a-building noun possessed by
 * it, or its own possessive over one. Case-SENSITIVE on `Void`: the lowercase word is not
 * this game's noun.
 */
const VOID_ENTERED =
  /\b(in|into|inside|within|through|across|beneath|below|under|from|to|toward|towards|out of|enters|entered|entering|enter|leaves|leave|leaving|left)\s+the\s+Void\b/g;
const VOID_HAS_PARTS = /\b(floors?|levels?|depths?|halls?|walls?|corridors?)\s+of\s+the\s+Void\b/g;
const VOID_POSSESSES = /\bthe\s+Void['’]s\s+(floors?|halls?|depths?|walls?|corridors?)\b/g;

/**
 * The reserved word, LOWERCASE ONLY (`WORLD.md` §0). A capitalised `Hollow` / `Hollowed` is
 * a name this game owns — the class, the boss, the floor-5 family — and passes.
 */
const HOLLOW_CASUAL = /\bhollow(?:ed|ing|s|ness)?\b/g;

/** The other reserved phrase. Case-insensitive: it is a phrase, not a name. */
const MADE_WHOLE = /\bmade whole\b/gi;

/** The optional-plural marker. */
const PAREN_S = '(s)';

/**
 * `rarityGen.ts` names a rolled drop `${rarity} ${slot}`, so the SLOT ID is the item's
 * player-facing name: "Legendary mainHand". That is the register's naming defect (`PLAN.md`
 * #13) and it is allowed ONLY inside that exact phrase — a camelCase token loose in a
 * sentence elsewhere in the same string is NOT covered by it.
 */
export const ROLLED_NAME_ALLOWANCE: {
  rule: TextRuleId;
  where: RegExp;
  reason: string;
} = {
  rule: 'id-shape',
  where: /\b(Common|Rare|Legendary) (mainHand|offHand)\b/,
  reason: 'rarityGen names a rolled drop after its slot id — PLAN.md #13',
};

// ===========================================================================
// Compiled patterns, per vocabulary
// ===========================================================================

interface Compiled {
  conditionId: RegExp;
  conditionName: RegExp;
  effectId: RegExp;
  catalogId: RegExp | null;
  sanctioned: readonly string[];
}

/** Escape a literal for use inside a regular expression. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One alternation per id list, LONGEST FIRST so an id that is a prefix of another cannot
 * shadow it. Returns null for an empty list — an empty alternation `\b()\b` matches
 * everywhere, which would make the rule fire on every string in the game.
 */
function alternation(words: readonly string[]): RegExp | null {
  const sorted = [...new Set(words)].filter((w) => w !== '').sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return null;
  return new RegExp(`\\b(?:${sorted.map(escapeRe).join('|')})\\b`, 'g');
}

const compiledFor = new WeakMap<TextVocabulary, Compiled>();

function compile(vocab: TextVocabulary): Compiled {
  const hit = compiledFor.get(vocab);
  if (hit) return hit;
  const built: Compiled = {
    conditionId: alternation(vocab.conditionIds) ?? /(?!)/g,
    conditionName: alternation(vocab.conditionNames) ?? /(?!)/g,
    effectId: alternation(vocab.effectIds) ?? /(?!)/g,
    // Only an id that DIFFERS from its own name can be a mistake: `antidote` IS the
    // Antidote's name, so seeing it is seeing the name.
    catalogId: alternation(
      vocab.catalogIds.filter((c) => c.id.toLowerCase() !== c.name.toLowerCase()).map((c) => c.id),
    ),
    // Longest first, so `Hollow Self` is consumed before the bare `Hollow`.
    sanctioned: [...vocab.sanctioned].sort((a, b) => b.length - a.length),
  };
  compiledFor.set(vocab, built);
  return built;
}

// ===========================================================================
// The detector
// ===========================================================================

/** How to run the rules over one piece of text. */
export interface DetectOptions {
  /** Which rules to apply. Default: all of them. */
  rules?: readonly TextRuleId[];
  /**
   * Strings the text may legitimately echo — the beat's own engine facts. Only
   * `reserved-word` consults it: if the engine handed the model "made whole", the model
   * repeating it is obedience, not a violation.
   */
  echoOf?: readonly string[];
}

/** What `detectTextFaults` reports. */
export interface DetectResult {
  faults: TextFault[];
  allowed: TextAllowance[];
}

/** The blanking character. One BMP code unit, so replacing preserves every later index. */
const BLANK = '▮';

/**
 * Replace every sanctioned phrase with a run of blanks of the SAME LENGTH, so the prose
 * rules cannot see a proper name and every reported index still points into the original.
 * Exact and case-sensitive: a name is a name only when it is spelled as one.
 */
function strip(text: string, phrases: readonly string[]): string {
  let out = text;
  for (const phrase of phrases) {
    if (phrase.length === 0) continue;
    let at = out.indexOf(phrase);
    while (at >= 0) {
      out = out.slice(0, at) + BLANK.repeat(phrase.length) + out.slice(at + phrase.length);
      at = out.indexOf(phrase, at + phrase.length);
    }
  }
  return out;
}

/** Every `[start, end)` a rolled item name occupies in the ORIGINAL text. */
function rolledNameRanges(text: string): [number, number][] {
  const re = new RegExp(ROLLED_NAME_ALLOWANCE.where.source, 'g');
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** Collect every match of a global regex as a fault. */
function push(out: TextFault[], rule: TextRuleId, source: string, re: RegExp): void {
  const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of source.matchAll(scan)) out.push({ rule, match: m[0], index: m.index });
}

/**
 * Read one piece of text against the rules — PURE.
 *
 * ORDER, and it is load-bearing:
 *   1. empty text is clean (nothing to read, so nothing to judge);
 *   2. the sanctioned phrases are blanked out, LENGTH-PRESERVING, so indices stay true;
 *   3. each selected rule runs over the blanked text;
 *   4. an `id-shape` match that sits inside a rolled item name is moved to `allowed`.
 */
export function detectTextFaults(
  text: string,
  vocab: TextVocabulary,
  opts: DetectOptions = {},
): DetectResult {
  const faults: TextFault[] = [];
  const allowed: TextAllowance[] = [];
  if (typeof text !== 'string' || text.length === 0) return { faults, allowed };

  const rules = new Set(opts.rules ?? ALL_TEXT_RULES);
  const c = compile(vocab);
  const stripped = strip(text, c.sanctioned);

  if (rules.has('condition-id')) push(faults, 'condition-id', stripped, c.conditionId);

  if (rules.has('condition-label')) {
    const scan = new RegExp(c.conditionName.source, 'g');
    for (const m of stripped.matchAll(scan)) {
      // TWO SHAPES ARE FAULTS, and one shape is not.
      //
      //   MID-SENTENCE — "you are Agile now", "You feel — Healthy." A capitalised engine
      //   label inside a sentence is the chip's text leaking into prose.
      //
      //   A BARE FRAGMENT — "You reach the Undercity. Healthy." The label stands as its own
      //   one-word sentence, which is exactly the shape of a status readout appended to a
      //   beat. It starts a sentence, so a "mid-sentence only" rule would miss the commonest
      //   leak there is.
      //
      //   ORDINARY CAPITALISATION — "Healthy is not a word here.", '"Agile," it says.' The
      //   label opens a sentence AND the sentence continues. That is English, not a leak.
      const before = stripped.slice(0, m.index).replace(/\s+$/, '');
      const opensSentence = before === '' || '.!?"“‘”’\''.includes(before.slice(-1));
      const after = stripped.slice(m.index + m[0].length);
      const standsAlone = after.trim() === '' || /^\s*[.!?]/.test(after);
      if (opensSentence && !standsAlone) continue;
      faults.push({ rule: 'condition-label', match: m[0], index: m.index });
    }
  }

  if (rules.has('effect-id')) push(faults, 'effect-id', stripped, c.effectId);
  if (rules.has('catalog-id') && c.catalogId) push(faults, 'catalog-id', stripped, c.catalogId);

  if (rules.has('id-shape')) {
    const ranges = rolledNameRanges(text);
    const shapes: TextFault[] = [];
    push(shapes, 'id-shape', stripped, CAMEL_TOKEN);
    push(shapes, 'id-shape', stripped, SNAKE_TOKEN);
    for (const f of shapes) {
      const inside = ranges.some(([a, b]) => f.index >= a && f.index + f.match.length <= b);
      if (inside) allowed.push({ rule: 'id-shape', match: f.match, allowance: ROLLED_NAME_ALLOWANCE.reason });
      else faults.push(f);
    }
  }

  if (rules.has('paren-s')) {
    let at = stripped.indexOf(PAREN_S);
    while (at >= 0) {
      faults.push({ rule: 'paren-s', match: PAREN_S, index: at });
      at = stripped.indexOf(PAREN_S, at + PAREN_S.length);
    }
  }

  if (rules.has('ordinal-floor')) {
    push(faults, 'ordinal-floor', stripped, ORDINAL_BEFORE);
    push(faults, 'ordinal-floor', stripped, NUMBER_AFTER);
  }

  if (rules.has('void-as-place')) {
    push(faults, 'void-as-place', stripped, VOID_ENTERED);
    push(faults, 'void-as-place', stripped, VOID_HAS_PARTS);
    push(faults, 'void-as-place', stripped, VOID_POSSESSES);
  }

  if (rules.has('reserved-word')) {
    push(faults, 'reserved-word', stripped, HOLLOW_CASUAL);
    // The engine may hand the model "made whole" (the grace ending body IS that sentence).
    // Repeating what it was given is obedience; inventing it is the violation.
    const echoed = (opts.echoOf ?? []).some((f) => /made whole/i.test(f));
    if (!echoed) push(faults, 'reserved-word', stripped, MADE_WHOLE);
  }

  faults.sort((a, b) => a.index - b.index);
  return { faults, allowed };
}
