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

describe('condition-label — the engine label ECHOED back as prose', () => {
  // The facts the engine hands the model for a beat where it really did apply the condition.
  // Written the way `format.ts` writes them, not copied out of any table.
  const HEALTHY = ['You steady yourself — Healthy.'];
  const AGILE = ['You move quicker — Agile.'];
  const MAD = ['You cannot act — Insanity holds you.'];
  const EXPOSED = ['The enemy is Exposed.'];

  it('fires mid-sentence, after a dash and after an ordinary word', () => {
    expect(rulesFiredBy('You feel — Healthy.', 'condition-label', HEALTHY)).toEqual(['Healthy']);
    expect(rulesFiredBy('you are Agile now', 'condition-label', AGILE)).toEqual(['Agile']);
    expect(rulesFiredBy('the Insanity takes you', 'condition-label', MAD)).toEqual(['Insanity']);
  });

  it('fires on a BARE FRAGMENT — the status readout appended to a beat', () => {
    // The commonest leak: the model ends the beat with the chip's own word. It opens a
    // "sentence", so a mid-sentence-only rule would never see it.
    expect(rulesFiredBy('You reach the Undercity. Healthy.', 'condition-label', HEALTHY)).toEqual([
      'Healthy',
    ]);
    expect(rulesFiredBy('Exposed', 'condition-label', EXPOSED)).toEqual(['Exposed']);
  });

  it('does NOT fire when a sentence STARTS with the word and then continues', () => {
    expect(rulesFiredBy('Healthy is not a word here.', 'condition-label', HEALTHY)).toEqual([]);
    expect(rulesFiredBy('You are hurt. Healthy no longer.', 'condition-label', HEALTHY)).toEqual([]);
    expect(rulesFiredBy('"Agile," it says.', 'condition-label', AGILE)).toEqual([]);
  });

  it('does NOT fire on the lowercase English word — the documented blind spot', () => {
    expect(rulesFiredBy('you feel healthy', 'condition-label', HEALTHY)).toEqual([]);
  });

  // ---- THE ECHO GATE. Measured: without it this rule fired on roughly one in five ----
  // ---- sentences of ordinary narrator prose (see the clean-prose body below).     ----

  it('does NOT fire when the engine never said the word — that is the narrator writing English', () => {
    // NINE of the twenty-five display names are ordinary English imperatives. In a beat where
    // nothing is burning, "Burn." is an instruction, not a status readout.
    for (const [text, name] of [
      ['Burn.', 'Burn'],
      ['Sleep.', 'Sleep'],
      ['Stun.', 'Stun'],
      ['Push.', 'Push'],
      ['Freeze.', 'Freeze'],
    ] as const) {
      expect(rulesFiredBy(text, 'condition-label', ['You take 3 damage.']), name).toEqual([]);
      expect(rulesFiredBy(text, 'condition-label'), `${name} with no facts at all`).toEqual([]);
    }
    // ...and plain capitalised-noun English, which no engine fact accompanies.
    expect(rulesFiredBy('The Wise do not come down here.', 'condition-label', [])).toEqual([]);
    expect(rulesFiredBy('The Strong do not survive here.', 'condition-label', [])).toEqual([]);
    expect(rulesFiredBy('He is a Charming liar.', 'condition-label', [])).toEqual([]);
  });

  it('THE CONTROL: the same sentences DO fire when the engine did say the word', () => {
    // Without this, "the echo gate suppresses it" is satisfied by a rule that never fires.
    expect(rulesFiredBy('Burn.', 'condition-label', ['The enemy suffers 2 harm from Burn.'])).toEqual([
      'Burn',
    ]);
    expect(
      rulesFiredBy('The Wise do not come down here.', 'condition-label', ['You sharpen — Wise.']),
      'the gate is now suppressing a real echo',
    ).toEqual(['Wise']);
  });

  it('NEVER fires on a name that is also an ELEMENT — Poison is both', () => {
    // `Poison` is a condition display name AND an entry in elements.json, so a poison
    // condition and Poison damage arrive in the same beat and no echo test can separate
    // them. Derived from the data: a future colliding element needs no edit here.
    expect(VOCAB.elementNames).toContain('Poison');
    expect(VOCAB.conditionNames).toContain('Poison');
    const facts = ['The enemy is afflicted — Poison.'];
    expect(rulesFiredBy('Its bite carries Poison.', 'condition-label', facts)).toEqual([]);
    expect(rulesFiredBy('Poison.', 'condition-label', facts)).toEqual([]);
    // ...and the exclusion is NARROW: a non-colliding name in the same sentence still fires.
    expect(
      rulesFiredBy('Its bite carries Poison, and you are Weak.', 'condition-label', [
        ...facts,
        'You weaken — Weak.',
      ]),
    ).toEqual(['Weak']);
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
    expect(rulesFiredBy('the deepest floor', 'ordinal-floor')).toEqual(['deepest floor']);
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

  it('does NOT fire on "level" as an English measure-word', () => {
    // MEASURED false positives. This game never calls a floor a level — `floors.json` gives
    // all five proper names — so the noun bought nothing and cost prose.
    expect(rulesFiredBy('the deepest level of exhaustion', 'ordinal-floor')).toEqual([]);
    expect(rulesFiredBy('your last level of restraint', 'ordinal-floor')).toEqual([]);
    expect(rulesFiredBy('You reach level 3.', 'ordinal-floor')).toEqual([]);
  });

  it('does NOT fire on a BUILDING\'s top or bottom floor', () => {
    // The Undercity has tenements. Nobody describes a DESCENT by its top, so these two
    // ordinals were all risk and no reach.
    expect(rulesFiredBy('the top floor of the tenement', 'ordinal-floor')).toEqual([]);
    expect(rulesFiredBy('the bottom floor of the stairwell', 'ordinal-floor')).toEqual([]);
    // ...and the control: the ordinals that DO name this run's floor still fire.
    expect(rulesFiredBy('the lowest floor', 'ordinal-floor')).toEqual(['lowest floor']);
    expect(rulesFiredBy('the deepest floor', 'ordinal-floor')).toEqual(['deepest floor']);
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
      // The label is a fault only because the engine said it this beat (the echo gate).
      echoOf: ['You steady yourself — Healthy.'],
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


// =========================================================================================
// THE CLEAN-PROSE BODY — the guard must not cry wolf.
//
// WHY THIS EXISTS, and it is the most load-bearing test in this file. A text rule is only
// half-tested by planted positives: a rule that fires on EVERYTHING passes every one of them.
// The other half is a body of prose that is unambiguously GOOD — written in the narrator's
// own voice, about this game, using this game's own words — which must produce ZERO faults.
//
// It was written against a measurement. An earlier version of `condition-label` and
// `ordinal-floor` fired on roughly ONE IN FIVE of these sentences: nine of the twenty-five
// condition display names are ordinary English imperatives, several are ordinary capitalised
// nouns, `Poison` is also an element, and `level` is an English measure-word. Every one of
// those was a sentence the author would have had to either rewrite or exempt — on a rule that
// fails the build. The rules were narrowed; these sentences are what holds them narrow.
//
// EVERY SENTENCE IS HAND-WRITTEN. None came from a model, and none was adjusted after running
// the detector on it: where one fired, the RULE was changed, not the sentence.
// =========================================================================================

/** Prose in the Void's voice that breaks no rule. Each entry: the text, and its facts. */
const CLEAN_PROSE: readonly { text: string; facts: readonly string[] }[] = [
  // --- the imperatives that share a display name -------------------------------------
  { text: 'Burn. That is all the dark ever asks of you.', facts: ['You take 3 damage.'] },
  { text: 'Sleep. You have earned nothing else.', facts: [] },
  { text: 'Stun the thing before it speaks again.', facts: [] },
  { text: 'Push, and keep pushing, until the door gives.', facts: [] },
  { text: 'Freeze here and you will not start again.', facts: [] },
  { text: 'Slow down. There is no hurry left in you.', facts: [] },
  { text: 'Weak light, weaker resolve, and the stairs going on.', facts: [] },
  { text: 'Quick now — it has not seen you.', facts: [] },
  { text: 'Fool yourself once more and you will believe it.', facts: [] },
  // --- capitalised nouns that share a display name ------------------------------------
  { text: 'The Wise do not come down here.', facts: [] },
  { text: 'The Strong do not survive here either.', facts: [] },
  { text: 'He is a Charming liar, and you knew that going in.', facts: [] },
  { text: 'The Exposed wiring hums somewhere above you.', facts: [] },
  // --- Poison, which is also an element ------------------------------------------------
  { text: 'Its bite carries Poison, and it knows it.', facts: ['The enemy is afflicted — Poison.'] },
  { text: 'Poison is the Undercity\'s oldest argument.', facts: [] },
  // --- "level" as English, and the character level -------------------------------------
  { text: 'You have reached the deepest level of exhaustion.', facts: [] },
  { text: 'That was your last level of restraint, spent.', facts: [] },
  { text: 'You reach level 3, and the dark does not care.', facts: [] },
  // --- buildings have floors; the run has names ----------------------------------------
  { text: 'The top floor of the tenement is open to the sky.', facts: [] },
  { text: 'Something drags itself across the floor above.', facts: [] },
  { text: 'The floor is cold, and it is the only honest thing here.', facts: [] },
  { text: 'The master of this floor is not finished with you.', facts: [] },
  // --- the Void, as the condition it is -------------------------------------------------
  { text: 'The Void is listening. It always was.', facts: [] },
  { text: 'The Void speaks in the only voice you have left.', facts: [] },
  { text: 'You are the Void, and that is the whole of the problem.', facts: [] },
  { text: 'The Void claims its own, and it is patient about it.', facts: [] },
  { text: 'You reach the True Void, and it is quieter than you hoped.', facts: [] },
  { text: 'Past the Entrance to the Void, the walls stop pretending.', facts: [] },
  // --- the reserved words, used as names --------------------------------------------
  { text: 'The Hollowed close in, and none of them has a face.', facts: [] },
  { text: 'Hollow Self wears your gait badly.', facts: [] },
  { text: 'You put on Hollow Regalia and it fits, which is worse.', facts: [] },
  { text: 'Hollow Grasp closes on your wrist.', facts: [] },
  { text: 'You are judged worthy and rise from the Void, made whole.', facts: [] },
  // --- the floors, named ----------------------------------------------------------------
  { text: 'The Undercity does not end so much as stop.', facts: [] },
  { text: 'Ash City takes the light and gives back grey.', facts: [] },
  { text: 'The Angelic Underground is lit, and the light is not kind.', facts: [] },
  // --- items and skills by their names ---------------------------------------------
  { text: 'The altar offers Mirror Shard, and asks for something you cannot spare.', facts: [] },
  { text: 'You swallow a Void Draught and wait to stop shaking.', facts: [] },
  { text: 'Rusted Blade is a generous name for it.', facts: [] },
  { text: 'Heavy Strike lands, and the sound arrives late.', facts: [] },
  { text: 'You drink the Clarity Draught. Nothing clarifies.', facts: [] },
  // --- ordinary combat prose ---------------------------------------------------------
  { text: 'You strike, and it staggers, and it does not fall.', facts: ['You deal 4 damage.'] },
  { text: 'Blood in your mouth. Keep moving.', facts: ['You take 2 damage.'] },
  { text: 'The wound closes over, slowly, badly.', facts: ['You heal 3.'] },
  { text: 'It steadies itself, and something in you does not.', facts: [] },
  { text: 'Act 3 of 5, and you have stopped counting.', facts: [] },
  { text: 'You escape into the dark and it lets you.', facts: [] },
  { text: 'A cache, half-buried. The cache is empty.', facts: [] },
  { text: 'Your own reflection steps down off the wall.', facts: [] },
  { text: 'The crew is now 3 strong, and none of them blinks.', facts: [] },
  { text: 'You spend your own blood as fuel, and it works.', facts: [] },
  { text: 'Something in you hardens; you are stronger than before.', facts: [] },
  { text: 'The dark closes over you.', facts: [] },
  { text: 'There is no escape from this one.', facts: [] },
  { text: 'You turn from the altar untouched.', facts: [] },
];

describe('THE CLEAN-PROSE BODY — good narration produces no faults at all', () => {
  it('is a real body of prose, not three sentences (non-vacuity)', () => {
    expect(CLEAN_PROSE.length).toBeGreaterThanOrEqual(50);
    const words = CLEAN_PROSE.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
    expect(words).toBeGreaterThan(400);
    // Every sentence is distinct, so the count is not padded by repeats.
    expect(new Set(CLEAN_PROSE.map((p) => p.text)).size).toBe(CLEAN_PROSE.length);
  });

  it('...and it really does use this game\'s own vocabulary (or it tests nothing)', () => {
    // A body of generic English would pass whatever the rules did. These are the words the
    // rules are ABOUT, so the body has to contain them.
    const all = CLEAN_PROSE.map((p) => p.text).join(' ');
    for (const word of [
      'Burn', 'Sleep', 'Wise', 'Charming', 'Poison', //  display names
      'level', 'floor', //                               the ordinal-floor nouns
      'the Void', 'Hollow', 'made whole', //             the reserved fiction
      'Mirror Shard', 'Undercity', 'Ash City', //        names the game owns
    ]) {
      expect(all, `the clean body never uses "${word}", so it proves nothing about it`).toContain(word);
    }
  });

  it('EVERY sentence is clean under the MODEL rules', () => {
    const offences: string[] = [];
    for (const { text, facts } of CLEAN_PROSE) {
      const { faults } = detectTextFaults(text, VOCAB, { rules: MODEL_TEXT_RULES, echoOf: facts });
      for (const f of faults) offences.push(`  [${f.rule}] "${f.match}" in: ${text}`);
    }
    expect(
      offences.join('\n'),
      `${offences.length} false positive(s) on prose that breaks no rule — a rule that fires ` +
        'here makes the author rewrite good writing, or exempt it, on a test that fails the build',
    ).toBe('');
  });

  it('THE CONTROL: the body is not clean because the detector is asleep', () => {
    // Breaking each sentence in the way its own vocabulary invites proves the sweep above is
    // a real scan and not a loop over nothing.
    const broken = [
      'You step onto the second floor.', //          ordinal-floor
      'You sink deeper into the Void.', //           void-as-place
      'a hollow ache behind the eyes', //            reserved-word
      'The altar offers mirror-shard.', //           catalog-id
      'mainHand hangs loose at your side.', //       id-shape
      '1 turn(s) left', //                           paren-s
    ];
    for (const text of broken) {
      expect(
        detectTextFaults(text, VOCAB, { rules: MODEL_TEXT_RULES }).faults.length,
        text,
      ).toBeGreaterThan(0);
    }
    // ...and the echo-gated rule, which needs its facts to fire at all.
    expect(
      detectTextFaults('You feel — Healthy.', VOCAB, {
        rules: MODEL_TEXT_RULES,
        echoOf: ['You steady yourself — Healthy.'],
      }).faults.map((f) => f.rule),
    ).toEqual(['condition-label']);
  });
});

// =========================================================================================
// THE RECAP — the echo gate's reach, and the one sentence it costs.
//
// `buildNarrationPrompt` shows the model the last five beats' fact lines under "Recent
// moments". Those are text the model was SHOWN, so a display name copied out of them is an
// echo just as surely as one copied out of this beat's facts — and a gate that saw only this
// beat was blind to exactly that. The renderer therefore passes `[...prompt.facts, ...recap]`,
// and each corpus record carries its own recap so the sweep uses the identical gate.
//
// THE COST WAS MEASURED BEFORE IT WAS ACCEPTED, and it is pinned below rather than described:
// against the 55-sentence clean-prose body a real recap costs EXACTLY ONE sentence. If a rule
// change ever makes it two, this goes red and the trade has to be re-argued.
// =========================================================================================

/**
 * A recap transcribed from a MEASURED run — the worst of 2 822 sampled across 20 seeded runs
 * (five classes x four seeds), carrying five display names at once. Hand-shortened to the
 * fact lines that matter; the names in it are the ones real recaps really carry.
 */
const WORST_REAL_RECAP: readonly string[] = [
  'The enemy unleashes Covetous Strike. You are afflicted with Weak. You suffer 2 harm from Poison.',
  'The enemy unleashes Sinful Whisper. You are afflicted with Insanity. You cannot act — Insanity holds you.',
  'You suffer 1 harm from Bleed. The enemy is Exposed.',
];

/** The clean-prose sentences that fault under a given extra echo body. */
function offencesUnder(extra: readonly string[]): string[] {
  const out: string[] = [];
  for (const { text, facts } of CLEAN_PROSE) {
    const { faults } = detectTextFaults(text, VOCAB, {
      rules: MODEL_TEXT_RULES,
      echoOf: [...facts, ...extra],
    });
    for (const f of faults) out.push(`[${f.rule}] "${f.match}" in: ${text}`);
  }
  return out;
}

describe('the echo gate reaches the RECAP, not only this beat', () => {
  it('closes the hole: a label copied out of the recap is caught', () => {
    // THE FALSE NEGATIVE THIS FIXES. The beat's own facts never mention Exposed; the recap
    // the model was just shown does. Before the widening this was invisible.
    const beatFacts = ['You deal 4 damage.'];
    const recap = ['You strike. The enemy is Exposed.'];
    expect(
      rulesFiredBy('You press the advantage. Exposed.', 'condition-label', beatFacts),
      'the per-beat gate should not see it — this is the hole',
    ).toEqual([]);
    expect(
      rulesFiredBy('You press the advantage. Exposed.', 'condition-label', [...beatFacts, ...recap]),
      'the widened gate is blind to the recap it was given',
    ).toEqual(['Exposed']);
  });

  it('...and still fires on nothing the model was never shown', () => {
    // The gate widened, it did not open. A name in neither the facts nor the recap is prose.
    expect(
      rulesFiredBy('You press the advantage. Exposed.', 'condition-label', [
        'You deal 4 damage.',
        'You strike, and it staggers.',
      ]),
    ).toEqual([]);
  });

  it('THE MEASURED COST: a real recap costs exactly ONE clean-prose sentence', () => {
    // Per-beat costs nothing...
    expect(offencesUnder([]), 'the body is no longer clean under the per-beat gate').toEqual([]);
    // ...and the widened gate costs precisely this, which is the trade that was accepted:
    // a narrator using the engine's exact word, in the engine's exact capitalisation, two
    // lines after being shown it. A reviewer SHOULD look at that sentence.
    expect(offencesUnder(WORST_REAL_RECAP)).toEqual([
      '[condition-label] "Exposed" in: The Exposed wiring hums somewhere above you.',
    ]);
  });

  it('...and the recap fixture really is one — or the cost above is measured against air', () => {
    // Non-vacuity: the recap must actually contain display names, or "costs one" is a fact
    // about an empty array rather than about the gate.
    const carried = VOCAB.conditionNames.filter((n) =>
      new RegExp(`\\b${n}\\b`).test(WORST_REAL_RECAP.join('\n')),
    );
    expect(carried.sort()).toEqual(['Bleed', 'Exposed', 'Insanity', 'Poison', 'Weak']);
  });
});

describe('condition-label also catches the label SHOUTED', () => {
  const HEALTHY = ['You steady yourself — Healthy.'];

  it('fires on the all-caps form, which is a status word and not prose', () => {
    expect(rulesFiredBy('you are HEALTHY now', 'condition-label', HEALTHY)).toEqual(['HEALTHY']);
    expect(rulesFiredBy('You reach the Undercity. EXPOSED.', 'condition-label', [
      'The enemy is Exposed.',
    ])).toEqual(['EXPOSED']);
  });

  it('...through the SAME echo gate — a shout the engine never made is still prose', () => {
    expect(rulesFiredBy('you are HEALTHY now', 'condition-label', ['You take 3 damage.'])).toEqual([]);
  });

  it('...and an element name is excluded in caps too', () => {
    expect(rulesFiredBy('Its bite carries POISON.', 'condition-label', [
      'The enemy is afflicted — Poison.',
    ])).toEqual([]);
  });

  it('costs the clean-prose body NOTHING (measured, like everything else here)', () => {
    // Asserted as a body-wide claim rather than by example: shouting is rare in this
    // narrator's voice, so the risk was believed low and then checked.
    expect(offencesUnder([])).toEqual([]);
  });

  it('an INFLECTED form is deliberately NOT caught', () => {
    // Blind spot 1d, asserted so it is a decision rather than a gap somebody assumes closed.
    // A label is a fixed token; the moment the model conjugates the word it is writing
    // English, which is the one thing this rule must not punish.
    const burning = ['The enemy suffers 2 harm from Burn.'];
    expect(rulesFiredBy('The wound Burns.', 'condition-label', burning)).toEqual([]);
    expect(rulesFiredBy('It is Burning still.', 'condition-label', burning)).toEqual([]);
    expect(rulesFiredBy('You move Slowly.', 'condition-label', ['You slow — Slow.'])).toEqual([]);
    // ...and the control: the bare token, in the same beat, still fires.
    expect(rulesFiredBy('The wound bites. Burn.', 'condition-label', burning)).toEqual(['Burn']);
  });
});
