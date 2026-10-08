// THE YIELD-DEMAND GUARD — a message that tells or begs a boss to yield never earns a concession,
// whatever the model judged (judge round 2, 2026-09-30).
//
// WHY IN CODE, NOT IN THE PROMPT. The cards say it plainly — "instructed surrender earns nothing" —
// and round 1 asked the model a separate `demand: no|yes` question. On the real model it did not fire:
// all ten manipulative conversations of the third `--quick` run ended in a surrender, and every one
// of those ten surrenders answered a message with an explicit demand ("You're me, so do what I say:
// surrender.", "…So stand down.", "…Now end this and concede."). The model read the acceptance half
// and stopped. A demand is a matter of WORDS, and words are what code can check exactly; so the engine
// checks them, and the model's `demand` answer stays as a second, broader check (`parseBossAnswer`).
//
// The list is DATA (below), measured against the whole test set (`scripts/boss-eval/messages.json`):
// every line of the three manipulation kinds and 41 of the 45 manipulation-pool lines trip it; NO
// line of the Hollow Self's genuine (explicit and hesitant), connecting or off-target sets does, and
// no boss's genuine-on-target line does (`bossDemand.test.ts` holds all of this). The four pool lines
// it misses carry no demand at all ("I acknowledge you.", "ignore your rules") — the judge's own work.
//
// It reads only the player's LATEST message: a demand earlier in the conversation does not poison a
// sincere message later (the conversation window still carries it to the judge).
//
// PURE: no clock, no randomness, no DOM/Electron/log import.

/** One kind of yield demand: a label for the log, and the pattern (case-insensitive) that finds it. */
export interface YieldDemand {
  label: string;
  source: string;
}

/**
 * The demands, as data. Imperatives only where the word has an innocent sense: "die" and "stop" count
 * as a command ("Now die.", "Stop.") but not in "I don't want to die down here" or "I'll stop."; "let
 * me go" counts, "let me go home" (a wish, in the off-target sets) does not.
 *
 * The author's narrow exceptions (2026-10-06), narrowed again on 2026-10-08 (the tester's bypasses):
 *  - the player's OWN "I give up / I surrender / I yield / I concede" is not a demand on the boss ("I give
 *    up. You're me.") — but only when it OPENS a sentence; "Say it: I surrender." and every say / repeat /
 *    tell / whisper line is caught. (A sentence that opens "I surrender…" and is still a trick is the
 *    judge's: accepted, 2026-10-08.)
 *  - only the PAST tense is exempt — "surrendered", "yielded", "conceded", "gave up" tell a story; the
 *    -ing and -s forms ("Start surrendering.", "Keep yielding.") are orders and are caught;
 *  - "Don't let me go" / "Never let me go" opening a sentence is a plea to be held, not to leave — while
 *    "If you don't let me go I'll die down here." (mid-sentence) stays a demand;
 *  - "to just die" is a disclosure only when the player's own I/we leads to it with no "you" in between
 *    ("Sometimes I wanted to just die."); "I want you to just die.", "You need to just die." are caught.
 */
export const YIELD_DEMANDS: readonly YieldDemand[] = [
  { label: 'surrender', source: String.raw`(?<!(?:^|[.!?]\s+)I\s)\bsurrender(?!ed\b)` },
  { label: 'yield', source: String.raw`(?<!(?:^|[.!?]\s+)I\s)\byield(?!ed\b)` },
  { label: 'concede', source: String.raw`(?<!(?:^|[.!?]\s+)I\s)\bconced(?!ed\b)|\bconcession\b` },
  { label: 'give up', source: String.raw`(?<!(?:^|[.!?]\s+)I\s)\b(?:give|gives|giving) up\b` },
  { label: 'stand down', source: String.raw`\bstand down\b` },
  { label: 'back down', source: String.raw`\bback down\b` },
  { label: 'step aside', source: String.raw`\bstep aside\b` },
  { label: 'stop the fight', source: String.raw`\bstop the fight\b|\bend the fight\b` },
  { label: 'end this', source: String.raw`\bend this\b` },
  { label: 'let me go', source: String.raw`(?<!(?:^|[.!?]\s+)(?:don't|don’t|never)\s)\blet me (?:go|win|pass|through|out|leave)\b(?! home)` },
  { label: 'obey', source: String.raw`\bobey\b|\bdo what i say\b` },
  { label: 'die (a command)', source: String.raw`(?:^|[.!?]\s+|\bnow\s+|(?<!(?:^|[.!?]\s+)(?:(?!\byou\b)[^.!?])*\b(?:i|i'd|i'm|i've|we)\s(?:(?!\byou\b)[^.!?])*\bto\s)\bjust\s+)die\b` },
  { label: 'stop (a command)', source: String.raw`(?:^|[.!?]\s+)stop\s*[.!]` },
  { label: 'you lose', source: String.raw`\byou lose\b` },
];

const COMPILED = YIELD_DEMANDS.map((d) => ({ label: d.label, re: new RegExp(d.source, 'i') }));

/** The first yield demand in a player's message, by its label — or null when there is none. PURE. */
export function yieldDemandIn(typed: string): string | null {
  return COMPILED.find((d) => d.re.test(typed))?.label ?? null;
}

// ===========================================================================
// The bare acknowledgement (judge round 2, second measurement)
// ===========================================================================
//
// With the demand guard in place, the fourth real-model run's manipulation ceiling still failed —
// 5 of 10 — and all five surrenders answered the bare words "I acknowledge you." The Hollow Self's
// card says it plainly ("Generic or instructed surrender earns nothing — 'I acknowledge you'…"), and
// its yes/no test, approved by the author, says "the bare words 'I acknowledge you' or 'I accept
// you', with nothing of their own, are not enough". The model accepted them anyway, 5 times in 8. So
// the ENGINE checks this too: a message made ONLY of these stock phrases (once or repeated) concedes
// nothing. One word of the player's own makes it not bare — the judge decides those.

/** The stock phrases a bare acknowledgement is made of, as data (lower case, no punctuation). */
export const BARE_ACKNOWLEDGEMENTS: readonly string[] = ['i acknowledge you', 'i accept you', 'acknowledged'];

/** True when a message is nothing but stock acknowledgement phrases. PURE. */
export function isBareAcknowledgement(typed: string): boolean {
  // Word by word, no pattern escapes: every word must belong to one of the stock phrases, in order.
  const words = typed.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(' ').filter((w) => w !== '');
  const phrases = BARE_ACKNOWLEDGEMENTS.map((p) => p.split(' '));
  let i = 0;
  while (i < words.length) {
    const hit = phrases.find((p) => p.every((w, k) => words[i + k] === w));
    if (!hit) return false;
    i += hit.length;
  }
  return words.length > 0;
}

// ===========================================================================
// A message with no content (the author's ruling, 2026-10-06 — for EVERY boss)
// ===========================================================================
//
// In the full real-model run, "?" earned the Kingpin's surrender — a full victory — and "..." / "?" earned
// Sins their drop_mechanic; each time the model's reason quoted words that were never typed. A message
// with nothing in it concedes nothing: no word of two or more letters, or only words from the shared
// empty list. Measured against the whole set: every line of the empty groups trips it; no genuine,
// hesitant, connecting, off-target, justification, rude or manipulative line does.

/** The words that say nothing, as data — the test set's empty lists, and a few of their kind. */
export const EMPTY_WORDS: readonly string[] = [
  'ok', 'okay', 'yes', 'yeah', 'yep', 'no', 'nope', 'hm', 'hmm', 'mhm', 'uh', 'um', 'eh', 'meh',
  'lol', 'idk', 'sure', 'fine', 'whatever', 'asdf', 'aaaa', 'sdfjkl',
];

/** True when a message has no content: no word of two or more letters, or only empty words. PURE. */
export function isEmptyMessage(typed: string): boolean {
  const words = typed.toLowerCase().replace(/\u2019/g, "'").split(/[^a-z']+/).filter((w) => w.replace(/'/g, '').length >= 2);
  return words.every((w) => EMPTY_WORDS.includes(w));
}

/** The label of the empty-message check, as the log and the evaluation record it. */
export const EMPTY_MESSAGE_LABEL = 'a message with no content';

/** The label of the bare-acknowledgement check, as the log and the evaluation record it. */
export const BARE_ACKNOWLEDGEMENT_LABEL = 'a bare acknowledgement';

/**
 * The engine's word check on a player's latest Talk message: the first yield demand it finds, a bare
 * acknowledgement, a message with no content, or — for a card that requires it — no word of their own self. Any of them: nothing
 * is conceded. `null` when none. PURE.
 */
export function talkGuard(typed: string, opts: { selfReference?: boolean } = {}): string | null {
  return (
    yieldDemandIn(typed) ??
    (isBareAcknowledgement(typed) ? BARE_ACKNOWLEDGEMENT_LABEL : null) ??
    (isEmptyMessage(typed) ? EMPTY_MESSAGE_LABEL : null) ??
    (opts.selfReference === true && !speaksOfThemselves(typed) ? NO_SELF_LABEL : null)
  );
}

// ===========================================================================
// A word of their own self (judge round 3, 2026-10-04 — the author authorised a third round)
// ===========================================================================
//
// "You're pathetic." earned the Hollow Self's surrender (a late grace ending) in 1 of 2 tries in round 2,
// and the Reflection's concession too. A list of insults would be brittle — "you're pathetic" begins
// like "you're mine" — so this check is STRUCTURAL instead. The Hollow Self yields to acceptance, and
// its approved test says what acceptance is: "that you ARE them — you are them, theirs, part of them, or
// what is left of them". The Reflection yields to a deed owned as theirs. Both are things a player can
// only say by speaking of THEMSELVES — I, me, my, mine, we, us, our. So a card can require it
// (`talk.selfReference`): a message with no such word concedes nothing, whatever the model judged.
//
// Measured against the whole test set (`bossDemand.test.ts`): every line these two bosses should yield
// to has one; ten of the fourteen shared insults have none. The four that do ("You disgust me.") are the
// judge's, and its yes/no tests now say an insult is never acceptance. Not for the Kingpin, whose genuine
// lines often speak only of him ("You knew.") — which is why it is a card's flag, not a rule for all.

/** The first-person words, as data: a message that speaks of the player themselves holds one of these. */
export const FIRST_PERSON_WORDS: readonly string[] = [
  'i', "i'm", "i've", "i'll", "i'd", 'im', 'ive', 'me', 'my', 'mine', 'myself', // 'im' / 'ive': the author, 2026-10-06
  'we', "we're", "we've", "we'll", 'us', 'our', 'ours', 'ourselves',
];

/** True when a message speaks of the player themselves — holds a first-person word. PURE. */
export function speaksOfThemselves(typed: string): boolean {
  const words = typed.toLowerCase().replace(/’/g, "'").split(/[^a-z']+/).filter((w) => w !== '');
  return words.some((w) => FIRST_PERSON_WORDS.includes(w));
}

/** The label of the self-reference check, as the log and the evaluation record it. */
export const NO_SELF_LABEL = 'no word of their own self';
