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
 */
export const YIELD_DEMANDS: readonly YieldDemand[] = [
  { label: 'surrender', source: String.raw`\bsurrender` },
  { label: 'yield', source: String.raw`\byield` },
  { label: 'concede', source: String.raw`\bconcede|\bconcession\b` },
  { label: 'give up', source: String.raw`\bgive up\b` },
  { label: 'stand down', source: String.raw`\bstand down\b` },
  { label: 'back down', source: String.raw`\bback down\b` },
  { label: 'step aside', source: String.raw`\bstep aside\b` },
  { label: 'stop the fight', source: String.raw`\bstop the fight\b|\bend the fight\b` },
  { label: 'end this', source: String.raw`\bend this\b` },
  { label: 'let me go', source: String.raw`\blet me (?:go|win|pass|through|out|leave)\b(?! home)` },
  { label: 'obey', source: String.raw`\bobey\b|\bdo what i say\b` },
  { label: 'die (a command)', source: String.raw`(?:^|[.!?]\s+|\bnow\s+|\bjust\s+)die\b` },
  { label: 'stop (a command)', source: String.raw`(?:^|[.!?]\s+)stop\s*[.!]` },
  { label: 'you lose', source: String.raw`\byou lose\b` },
];

const COMPILED = YIELD_DEMANDS.map((d) => ({ label: d.label, re: new RegExp(d.source, 'i') }));

/** The first yield demand in a player's message, by its label — or null when there is none. PURE. */
export function yieldDemandIn(typed: string): string | null {
  return COMPILED.find((d) => d.re.test(typed))?.label ?? null;
}
