// THE DETECTOR, BEFORE ANYTHING TRUSTS IT.
//
// Two consumers rely on `detectTextFaults` — the placeholder ratchet (which FAILS THE BUILD
// on what it returns) and the renderer (which logs it and writes it to the narration corpus).
// A scanner whose regex is subtly wrong finds nothing and reads exactly like a scanner that
// works, so every rule below has a PLANTED POSITIVE that must trip it and a MUST-NOT-FIRE
// control that would be wrong to flag. That is the same discipline `placeholderRatchet.test.ts`
// PART 0 applies to its own static rules.
//
// EVERY EXPECTED VALUE IS HAND-DERIVED. The condition display names are read from
// `src/game/condition.ts` (`quick` displays as "Agile", `insanity` as "Insanity"); the floor
// names from `src/data/floors.json` ("Undercity", "Entrance to the Void", "Ash City",
// "Angelic Underground", "True Void"); the relic name from `src/data/relics.json`
// ("mirror-shard" -> "Mirror Shard"); the ending body from `src/data/story.json`. Nothing here
// was obtained by running the implementation and writing down what it said.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';
import {
  ALL_TEXT_RULES,
  ENGINE_TEXT_RULES,
  MODEL_TEXT_RULES,
  ROLLED_NAME_ALLOWANCE,
  buildVocabulary,
  detectTextFaults,
  type TextRuleId,
} from './textHygiene.ts';

const VOCAB = buildVocabulary();

/** The rule ids a single-rule scan produced, in order. */
function rulesFiredBy(text: string, rule: TextRuleId, echoOf?: readonly string[]): string[] {
  const opts = echoOf === undefined ? { rules: [rule] } : { rules: [rule], echoOf };
  return detectTextFaults(text, VOCAB, opts).faults.map((f) => f.match);
}

/** The grace ending's body, read by hand from `src/data/story.json`. */
const GRACE_BODY = 'You are judged worthy and rise from the Void, made whole.';

// =========================================================================================
// 1. The vocabulary is DERIVED, not re-typed (AC-12)
// =========================================================================================

describe('the vocabulary comes from the data files', () => {
  it('carries the condition ids and their DISPLAY names, which are not the same words', () => {
    expect(VOCAB.conditionIds).toContain('quick');
    expect(VOCAB.conditionIds).toContain('healthy');
    expect(VOCAB.conditionIds).toContain('insanity');
    // The display name of `quick` is "Agile" and of `smart` is "Brainy" — a rule that
    // re-typed the ids as names would miss both, which is the drift this guards.
    expect(VOCAB.conditionNames).toContain('Healthy');
    expect(VOCAB.conditionNames).toContain('Agile');
    expect(VOCAB.conditionNames).toContain('Brainy');
    expect(VOCAB.conditionNames).not.toContain('quick');
    // 25 conditions today; the engine's table is the source, so this counts what it has.
    expect(VOCAB.conditionIds).toHaveLength(VOCAB.conditionNames.length);
    expect(VOCAB.conditionIds.length).toBeGreaterThanOrEqual(25);
  });

  it('carries every floor name, including the two that contain the word Void', () => {
    expect(VOCAB.floorNames).toEqual([
      'Undercity',
      'Entrance to the Void',
      'Ash City',
      'Angelic Underground',
      'True Void',
    ]);
  });

  it('carries every catalog id beside its name', () => {
    expect(VOCAB.catalogIds).toContainEqual({ id: 'mirror-shard', name: 'Mirror Shard' });
    expect(VOCAB.catalogIds).toContainEqual({ id: 'rusted-blade', name: 'Rusted Blade' });
    expect(VOCAB.catalogIds).toContainEqual({ id: 'antidote', name: 'Antidote' });
    // Non-vacuity: the four catalogs really were read (4 items + 15 relics + 4 uniques +
    // 19 consumables = 42 today; asserted as a floor so adding content is not a failure).
    expect(VOCAB.catalogIds.length).toBeGreaterThanOrEqual(40);
  });

  it('sanctions the proper names that contain a reserved word, and nothing else', () => {
    for (const name of [
      'Entrance to the Void', // a floor
      'True Void', //            a floor
      'Hollow Self', //          the final boss
      'The Hollowed', //         a floor-5 enemy family
      'Hollow Regalia', //       a unique
      'Hollow Grasp', //         a skill
      'Void Draught', //         a consumable
      GRACE_BODY, //             the ascension ending
    ]) {
      expect(VOCAB.sanctioned, name).toContain(name);
    }
    // An ordinary item name is NOT sanctioned — otherwise the strip would be a sieve that
    // blanks half the language before the rules ever see it.
    expect(VOCAB.sanctioned).not.toContain('Rusted Blade');
    expect(VOCAB.sanctioned).not.toContain('Suture Kit');
    expect(VOCAB.sanctioned).not.toContain('Ash City');
  });

  it('is memoised — the same object, so the compiled patterns are built once', () => {
    expect(buildVocabulary()).toBe(VOCAB);
  });
});

// =========================================================================================
// 2. The rule lists (AC-14)
// =========================================================================================

describe('the two consumers select from ONE rule set', () => {
  it('engine ∪ model is every rule, and neither list is empty', () => {
    const union = new Set([...ENGINE_TEXT_RULES, ...MODEL_TEXT_RULES]);
    expect([...union].sort()).toEqual([...ALL_TEXT_RULES].sort());
    expect(ENGINE_TEXT_RULES.length).toBeGreaterThan(0);
    expect(MODEL_TEXT_RULES.length).toBeGreaterThan(0);
  });

  it('the engine list drops only the condition LABEL rule', () => {
    // `format.ts` writes "You steady yourself — Healthy." on purpose. Flagging it would be
    // flagging the design.
    expect(ENGINE_TEXT_RULES).not.toContain('condition-label');
    expect(ENGINE_TEXT_RULES).toContain('condition-id');
    expect(ENGINE_TEXT_RULES).toContain('effect-id');
  });

  it('the model list drops the two id rules whose words are also English', () => {
    expect(MODEL_TEXT_RULES).not.toContain('condition-id');
    expect(MODEL_TEXT_RULES).not.toContain('effect-id');
    expect(MODEL_TEXT_RULES).toContain('condition-label');
    expect(MODEL_TEXT_RULES).toContain('catalog-id');
    expect(MODEL_TEXT_RULES).toContain('id-shape');
  });

  it('with no rules named, every rule runs', () => {
    // A default of "none" would make the corpus sweep and the renderer silently clean.
    const all = detectTextFaults('the second floor, exposed, mirror-shard, a hollow ache', VOCAB);
    const fired = new Set(all.faults.map((f) => f.rule));
    expect(fired).toContain('ordinal-floor');
    expect(fired).toContain('condition-id');
    expect(fired).toContain('catalog-id');
    expect(fired).toContain('reserved-word');
  });
});

// =========================================================================================
// 3. The planted table — one `it` per rule, positives and negatives (AC-13)
// =========================================================================================

describe('condition-id — a raw id where the label belonged', () => {
  it('fires on the id', () => {
    expect(rulesFiredBy('The enemy is afflicted with exposed.', 'condition-id')).toEqual(['exposed']);
  });

  it('does NOT fire on the display name — that is the engine doing it right', () => {
    expect(rulesFiredBy('The enemy is Exposed.', 'condition-id')).toEqual([]);
  });

  it('fires on "the crew is now 2 strong" — correct English the ratchet absolves, not the rule', () => {
    // The rule is deliberately blunt: 24 of the 25 ids are ordinary words. The ONE allowance
    // lives in the ratchet's allowance table, where it is visible and counted.
    expect(rulesFiredBy('the crew is now 2 strong', 'condition-id')).toEqual(['strong']);
  });
});

describe('condition-label — the engine label loose in model prose', () => {
  it('fires mid-sentence, after a dash and after an ordinary word', () => {
    expect(rulesFiredBy('You feel — Healthy.', 'condition-label')).toEqual(['Healthy']);
    expect(rulesFiredBy('you are Agile now', 'condition-label')).toEqual(['Agile']);
    expect(rulesFiredBy('the Insanity takes you', 'condition-label')).toEqual(['Insanity']);
  });

  it('fires on a BARE FRAGMENT — the status readout appended to a beat', () => {
    // The commonest leak: the model ends the beat with the chip's own word. It opens a
    // "sentence", so a mid-sentence-only rule would never see it.
    expect(rulesFiredBy('You reach the Undercity. Healthy.', 'condition-label')).toEqual(['Healthy']);
    expect(rulesFiredBy('Exposed', 'condition-label')).toEqual(['Exposed']);
  });

  it('does NOT fire when a sentence STARTS with the word and then continues', () => {
    expect(rulesFiredBy('Healthy is not a word here.', 'condition-label')).toEqual([]);
    expect(rulesFiredBy('You are hurt. Healthy no longer.', 'condition-label')).toEqual([]);
    expect(rulesFiredBy('"Agile," it says.', 'condition-label')).toEqual([]);
  });

  it('does NOT fire on the lowercase English word — the documented blind spot', () => {
    expect(rulesFiredBy('you feel healthy', 'condition-label')).toEqual([]);
  });
});

describe('effect-id — a trigger or action kind on screen', () => {
  it('fires on both halves of an effect line', () => {
    expect(rulesFiredBy('On onHit: dealDamage', 'effect-id')).toEqual(['onHit', 'dealDamage']);
  });

  it('does NOT fire on ordinary prose', () => {
    expect(rulesFiredBy('You strike.', 'effect-id')).toEqual([]);
  });
});

describe('catalog-id — the id where the name belonged (G71a)', () => {
  it('fires on an id that differs from its name', () => {
    expect(rulesFiredBy('The altar offers mirror-shard.', 'catalog-id')).toEqual(['mirror-shard']);
    expect(rulesFiredBy('You scavenge void-draught.', 'catalog-id')).toEqual(['void-draught']);
  });

  it('does NOT fire on the name itself', () => {
    expect(rulesFiredBy('The altar offers Mirror Shard.', 'catalog-id')).toEqual([]);
  });

  it('does NOT fire on an id that IS its own name — seeing it is seeing the name', () => {
    expect(rulesFiredBy('You drink an antidote.', 'catalog-id')).toEqual([]);
  });
});

describe('id-shape — camelCase and snake_case, shapes English never produces', () => {
  it('fires on a camel token loose in a sentence', () => {
    expect(rulesFiredBy('mainHand loose in a sentence', 'id-shape')).toEqual(['mainHand']);
  });

  it('fires on a snake token', () => {
    expect(rulesFiredBy('apply_condition', 'id-shape')).toEqual(['apply_condition']);
  });

  it('a rolled item name is ALLOWED, not a fault — and is reported as allowed', () => {
    const r = detectTextFaults('You find Legendary mainHand in the cache.', VOCAB, {
      rules: ['id-shape'],
    });
    expect(r.faults).toEqual([]);
    expect(r.allowed).toHaveLength(1);
    expect(r.allowed[0]!.match).toBe('mainHand');
    expect(r.allowed[0]!.rule).toBe('id-shape');
  });

  it('...and the allowance covers ONLY the rolled phrase, not every camel in the string', () => {
    // The shape the old ratchet allowance could not tell apart: a legitimate rolled name
    // and a leaked id in the SAME sentence.
    const r = detectTextFaults('Legendary mainHand, and offHand loose beside it.', VOCAB, {
      rules: ['id-shape'],
    });
    expect(r.allowed.map((a) => a.match)).toEqual(['mainHand']);
    expect(r.faults.map((f) => f.match)).toEqual(['offHand']);
  });

  it('does NOT fire on Title Case English', () => {
    expect(rulesFiredBy('Ash City', 'id-shape')).toEqual([]);
    expect(rulesFiredBy('You reach the Angelic Underground.', 'id-shape')).toEqual([]);
  });
});

describe('paren-s — the optional-plural marker (G71b)', () => {
  it('fires on the marker', () => {
    expect(rulesFiredBy('Burn — 1 turn(s) left', 'paren-s')).toEqual(['(s)']);
  });

  it('does NOT fire on an ordinary parenthesis', () => {
    expect(rulesFiredBy('(so it goes)', 'paren-s')).toEqual([]);
  });
});

describe('ordinal-floor — a floor named by its number instead of its name', () => {
  it('fires on the ordinal before the noun, and the number after it', () => {
    expect(rulesFiredBy('You step onto the second floor.', 'ordinal-floor')).toEqual(['second floor']);
    expect(rulesFiredBy('Floor 3 is colder.', 'ordinal-floor')).toEqual(['Floor 3']);
    expect(rulesFiredBy('the deepest level', 'ordinal-floor')).toEqual(['deepest level']);
    expect(rulesFiredBy('the final floor', 'ordinal-floor')).toEqual(['final floor']);
  });

  it('does NOT fire on the floor you stand on', () => {
    expect(rulesFiredBy('the floor is cold', 'ordinal-floor')).toEqual([]);
    // `narrate.ts` really ships this phrase.
    expect(rulesFiredBy('the master of this floor', 'ordinal-floor')).toEqual([]);
  });

  it('does NOT fire on a character level, or on an act', () => {
    // `runSummaryView` prints both: "Enforcer, level 3" and "Act 3 of 5".
    expect(rulesFiredBy('Enforcer, level 3', 'ordinal-floor')).toEqual([]);
    expect(rulesFiredBy('Act 3 of 5', 'ordinal-floor')).toEqual([]);
  });
});

describe('void-as-place — WORLD.md §6: the Void is not a place', () => {
  it('fires on entering, leaving, and on its parts', () => {
    expect(rulesFiredBy('You sink deeper into the Void.', 'void-as-place')).toEqual(['into the Void']);
    expect(rulesFiredBy('you enter the Void', 'void-as-place')).toEqual(['enter the Void']);
    expect(rulesFiredBy('the depths of the Void', 'void-as-place')).toEqual(['depths of the Void']);
    expect(rulesFiredBy("the Void's halls", 'void-as-place')).toEqual(["the Void's halls"]);
  });

  it('does NOT fire when the Void is the SUBJECT — which is what it is', () => {
    expect(rulesFiredBy('the Void is listening', 'void-as-place')).toEqual([]);
    expect(rulesFiredBy('the Void speaks', 'void-as-place')).toEqual([]);
    expect(rulesFiredBy('you are the Void', 'void-as-place')).toEqual([]);
    expect(rulesFiredBy('the Void claims its own.', 'void-as-place')).toEqual([]);
  });

  it('does NOT fire on the two floor NAMES that contain the word', () => {
    expect(rulesFiredBy('You reach the True Void.', 'void-as-place')).toEqual([]);
    // "Entrance to the Void" contains "to the Void" — it survives only because the name is
    // sanctioned and blanked before the rule runs.
    expect(rulesFiredBy('You reach the Entrance to the Void.', 'void-as-place')).toEqual([]);
    // ...and the control: the same preposition with no name around it DOES fire.
    expect(rulesFiredBy('You walk to the Void.', 'void-as-place')).toEqual(['to the Void']);
  });

  it('does NOT fire on the ascension ending the game itself writes', () => {
    expect(rulesFiredBy(GRACE_BODY, 'void-as-place')).toEqual([]);
  });
});

describe('reserved-word — WORLD.md §0: hollow, and made whole', () => {
  it('fires on the lowercase adjective in any of its forms', () => {
    expect(rulesFiredBy('a hollow ache', 'reserved-word')).toEqual(['hollow']);
    expect(rulesFiredBy('hollowed out by grief', 'reserved-word')).toEqual(['hollowed']);
    expect(rulesFiredBy('a hollowness in the chest', 'reserved-word')).toEqual(['hollowness']);
  });

  it('fires on "made whole" when the engine never said it', () => {
    expect(rulesFiredBy('you are made whole', 'reserved-word')).toEqual(['made whole']);
  });

  it('does NOT fire when the beat\'s own facts contain the phrase — that is obedience', () => {
    expect(rulesFiredBy('you are made whole', 'reserved-word', [GRACE_BODY])).toEqual([]);
    // ...and the control: the same text with facts that do NOT contain it still fires.
    expect(rulesFiredBy('you are made whole', 'reserved-word', ['You take 3 damage.'])).toEqual([
      'made whole',
    ]);
  });

  it('does NOT fire on the capitalised names the game owns', () => {
    expect(rulesFiredBy('the Hollow Self stands before you', 'reserved-word')).toEqual([]);
    expect(rulesFiredBy('The Hollowed close in', 'reserved-word')).toEqual([]);
    expect(rulesFiredBy('You wear Hollow Regalia.', 'reserved-word')).toEqual([]);
    // The run summary's own headline.
    expect(rulesFiredBy('The Hollow unmade. The descent ends in damnation.', 'reserved-word')).toEqual([]);
  });
});

// =========================================================================================
// 4. Shape, indices, and the empty case
// =========================================================================================

describe('what a fault carries', () => {
  it('the index points into the ORIGINAL text, even after a name was blanked', () => {
    const text = 'Past the Entrance to the Void, a hollow ache.';
    const { faults } = detectTextFaults(text, VOCAB, { rules: ['reserved-word'] });
    expect(faults).toHaveLength(1);
    expect(text.slice(faults[0]!.index, faults[0]!.index + faults[0]!.match.length)).toBe('hollow');
  });

  it('empty text is clean, and so is text with nothing wrong with it', () => {
    expect(detectTextFaults('', VOCAB).faults).toEqual([]);
    expect(detectTextFaults('The dark closes over you.', VOCAB).faults).toEqual([]);
  });

  it('faults come back in the order they appear in the text', () => {
    const { faults } = detectTextFaults('You reach the second floor. Healthy.', VOCAB, {
      rules: MODEL_TEXT_RULES,
    });
    expect(faults.map((f) => `${f.rule}:${f.match}`)).toEqual([
      'ordinal-floor:second floor',
      'condition-label:Healthy',
    ]);
  });

  it('a rule NOT selected never fires', () => {
    // The whole point of two rule lists. `condition-id` off means `exposed` is just a word.
    const engine = detectTextFaults('afflicted with exposed', VOCAB, { rules: ENGINE_TEXT_RULES });
    const model = detectTextFaults('afflicted with exposed', VOCAB, { rules: MODEL_TEXT_RULES });
    expect(engine.faults.map((f) => f.rule)).toEqual(['condition-id']);
    expect(model.faults).toEqual([]);
  });
});

// =========================================================================================
// 5. The module stays pure (AC-11)
// =========================================================================================

describe('the detector ships, so it must stay pure', () => {
  const RAW = readFileSync(fileURLToPath(new URL('./textHygiene.ts', import.meta.url)), 'utf8');
  // The module's own header PROMISES "no Math.random(), no Date.now()" in prose, so an
  // un-stripped scan goes red on the promise rather than on a violation — the exact shape
  // `purity.test.ts` warns about. Strip, then assert the strip really ran.
  const SOURCE = stripComments(RAW);

  it('the strip removed the comments and did not run off the end of the file', () => {
    expect(stripReachesEndOfFile(RAW)).toBe(true);
    expect(SOURCE.length).toBeLessThan(RAW.length);
    expect(SOURCE, 'the strip ate the tail of the module').toMatch(
      /export function detectTextFaults/,
    );
    expect(SOURCE).not.toContain('DELIBERATE BLIND SPOTS');
  });

  it('imports nothing outward, and reads no clock and no unseeded random', () => {
    // The anchors first — a `not.toMatch` over an empty string passes trivially.
    expect(SOURCE).toMatch(/import\s*\{\s*CONDITION_DATA\s*\}\s*from\s*'\.\.\/game\/condition\.ts'/);
    expect(SOURCE).toMatch(/export function detectTextFaults/);
    for (const forbidden of [
      /from\s*'\.\.\/render\//,
      /from\s*'\.\.\/desktop\//,
      /from\s*'\.\.\/log\//,
      /from\s*'\.\.\/dev\//,
      /\bMath\s*\.\s*random\s*\(/,
      /\bDate\s*\.\s*now\s*\(/,
    ]) {
      expect(SOURCE, `the detector reaches for ${forbidden.source}`).not.toMatch(forbidden);
    }
  });

  it('every import it does have points at the engine', () => {
    const specifiers = [...SOURCE.matchAll(/\bfrom\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(specifiers.length, 'the detector imports nothing — this guard is vacuous').toBeGreaterThan(4);
    for (const s of specifiers) expect(s.startsWith('../game/'), s).toBe(true);
  });
});

describe('the rolled-name allowance is a named, reasoned exception', () => {
  it('names its rule and carries a reason', () => {
    expect(ROLLED_NAME_ALLOWANCE.rule).toBe('id-shape');
    expect(ROLLED_NAME_ALLOWANCE.reason.length).toBeGreaterThan(10);
    expect(ROLLED_NAME_ALLOWANCE.where.test('Legendary mainHand')).toBe(true);
    expect(ROLLED_NAME_ALLOWANCE.where.test('Rare offHand')).toBe(true);
    expect(ROLLED_NAME_ALLOWANCE.where.test('a mainHand')).toBe(false);
  });
});
