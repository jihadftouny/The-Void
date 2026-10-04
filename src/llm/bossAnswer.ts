// THE BOSS ANSWER PATH — what the renderer does with what came back over IPC
// (`docs/BOSS-PROMPTS.md` §3, §6). PURE: parse, name discipline, line check, fallback line.
//
//   parseBossAnswer  the IPC result → a typed answer, or a reason it cannot be used. Never
//                    throws, and never trusts the channel: the answer is re-validated against
//                    the SAME schema the grammar was built from, so an illegal move or an
//                    un-offered concession is refused here even if it somehow got through.
//   applyNameRule    a line → the line to SHOW, with the player's name removed where the card
//                    forbids it (§6: "line shown with the name removed"), plus what happened, so
//                    the caller can log it.
//   checkBossLine    a line → its text faults: the narrator's own rules (`textHygiene.ts`) plus
//                    the boss rules of §3. A faulty line is still shown (§6); the faults are for
//                    the log and the narration record.
//   fallbackFor      the line used when the model is off, slow or wrong — chosen by an index the
//                    CALLER passes (the round), never at random.
//
// PURE: no clock, no randomness, no DOM/Electron/log import. The caller logs what these return.

import type {
  BossAnswer,
  BossCallKind,
  BossPersona,
  BossRequest,
  ConcessionId,
  NameMode,
} from './bossContract.ts';
import { talkGuard } from './bossDemand.ts';
import { schemaFor } from './bossPrompt.ts';
import { validateAgainst } from './bossSchema.ts';
import {
  detectTextFaults,
  MODEL_TEXT_RULES,
  type TextRuleId,
  type TextVocabulary,
} from './textHygiene.ts';

// ===========================================================================
// parseBossAnswer
// ===========================================================================

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

type Failure = Extract<BossAnswer, { ok: false }>;

const fail = (reason: Failure['reason'], detail?: string): Failure =>
  detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };

/**
 * Read an IPC result into a boss answer. PURE and TOTAL: any input — a malformed result, a
 * rejected call, text that is not JSON — gives `{ ok: false, reason }`, never an exception.
 *
 * A timed-out call is a fallback even when its partial text would parse (plan §5.3 decision 4):
 * a half-line is never shown.
 */
export function parseBossAnswer(req: BossRequest, result: unknown): BossAnswer {
  try {
    if (!isRecord(result)) return fail('error', 'no result');
    if (result.ok !== true) {
      const reason = result.reason === 'timeout' || result.reason === 'no-model' ? result.reason : 'error';
      return fail(reason, typeof result.message === 'string' ? result.message : undefined);
    }
    if (result.timedOut === true) return fail('timeout');
    if (typeof result.text !== 'string') return fail('malformed', 'no text');

    let value: unknown;
    try {
      value = JSON.parse(result.text);
    } catch {
      return fail('malformed', 'not JSON');
    }

    const check = validateAgainst(schemaFor(req), value);
    if (!check.ok) {
      if (check.key === 'move' && check.problem === 'not one of the listed ids') return fail('illegal-move');
      // A judgement outside yes/no, a judgement from a boss that has nothing to yield (the executioner),
      // or any answer that tries to NAME a concession itself: the answer broke the concession rule.
      if (req.kind === 'talk' && isRecord(value)) {
        const judged = 'earned' in schemaFor(req).properties;
        if ('concession' in value) return fail('illegal-concession');
        if ('earned' in value && (!judged || (value.earned !== 'no' && value.earned !== 'yes'))) return fail('illegal-concession');
      }
      return fail('malformed', `${check.key ?? 'answer'}: ${check.problem}`);
    }

    const answer = value as Record<string, string>;
    if (req.kind === 'turn') return { ok: true, kind: 'turn', move: answer.move ?? '', line: (answer.line ?? '').trim() };
    if (req.kind === 'talk') {
      // The model only judged; the ENGINE picks what is yielded — the first still available, in the
      // card's order. Nothing available means there was no judgement to read.
      // A demand or a bare acknowledgement never earns a yield, however it was judged (the cards: "instructed
      // surrender earns nothing") — the ENGINE's word check on their latest message decides that (judge
      // round 2: the model's own reading missed every demand it was shown).
      const guard = talkGuard(req.typed, { selfReference: req.persona.talk.selfReference === true });
      const yielded: ConcessionId | undefined = answer.earned === 'yes' && guard === null ? req.available[0] : undefined;
      const reason = typeof answer.reason === 'string' ? answer.reason.trim() : undefined;
      return {
        ok: true,
        kind: 'talk',
        reply: (answer.reply ?? '').trim(),
        concession: yielded ?? 'none',
        ...(reason !== undefined ? { reason } : {}),
        ...(guard !== null ? { demandGuard: guard } : {}),
      };
    }
    return { ok: true, kind: 'scene', line: (answer.line ?? '').trim() };
  } catch {
    return fail('error', 'unreadable result');
  }
}

// ===========================================================================
// applyNameRule
// ===========================================================================

/** Names that are also ordinary words are never stripped — only flagged. */
export const NAME_STOP_WORDS: ReadonlySet<string> = new Set(['you', 'the', 'it', 'and', 'me', 'i', 'a']);

export interface NameRuleResult {
  /** The line to show. */
  line: string;
  /** True when the name was removed from the line. */
  stripped: boolean;
  /**
   * True when the name is still in the shown line in a way the card may not allow — a use that
   * is not a clear address in `own` mode, or a name too short/common to strip safely. For the
   * log, so a reviewer can read it; the line is shown as is.
   */
  addressed: boolean;
  /** The line as the model wrote it. */
  original: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The name as a whole word, case-sensitive, with an optional possessive. */
function namePattern(name: string): string {
  return `(?<![\\p{L}\\p{N}_])${escapeRe(name)}(?![\\p{L}\\p{N}_])(?:['’]s)?`;
}

/** Collapse the gaps a removal leaves, and restore a capital where a sentence now starts. */
function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/,([.!?])/g, '$1')
    .replace(/^[\s,.;:!?]+/, '')
    .trim()
    .replace(/(^|[.!?]["”’]?\s+)(\p{Ll})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/**
 * Enforce a card's name rule on one line. PURE.
 *
 *  - `given`: untouched.
 *  - `forbidden`: every use of the name (whole word, case-sensitive) is removed, with one
 *    adjacent vocative comma — `For the Ganger, Marcus.` → `For the Ganger.`
 *  - `own`: the clear shapes of ADDRESSING them (`, Name.` · `, Name,` · `Name, you`) are
 *    removed; any other use is kept (it may be the boss naming itself, which the card allows)
 *    and flagged `addressed`.
 *
 * A name of two characters or fewer, or one that is an ordinary word (`NAME_STOP_WORDS`), is
 * never stripped — removing "I" or "you" from a line would wreck it — only flagged.
 */
export function applyNameRule(line: string, name: string, mode: NameMode): NameRuleResult {
  const original = line;
  const unchanged = (addressed: boolean): NameRuleResult => ({ line, stripped: false, addressed, original });
  const trimmed = name.trim();
  if (mode === 'given' || trimmed === '') return unchanged(false);

  const N = namePattern(trimmed);
  if (!new RegExp(N, 'u').test(line)) return unchanged(false);
  if (trimmed.length <= 2 || NAME_STOP_WORDS.has(trimmed.toLowerCase())) return unchanged(true);

  let out = line;
  if (mode === 'forbidden') {
    out = out
      .replace(new RegExp(`\\s*,\\s*${N}`, 'gu'), '')
      .replace(new RegExp(`${N}\\s*,\\s*`, 'gu'), '')
      .replace(new RegExp(N, 'gu'), '');
  } else {
    out = out
      .replace(new RegExp(`\\s*,\\s*${N}(?=\\s*[.!?,]|\\s*$)`, 'gu'), '')
      .replace(new RegExp(`${N}\\s*,\\s*(?=[Yy]ou\\b)`, 'gu'), '');
  }
  const stripped = out !== line;
  const shown = stripped ? tidy(out) : line;
  return {
    line: shown,
    stripped,
    addressed: new RegExp(N, 'u').test(shown),
    original,
  };
}

// ===========================================================================
// checkBossLine
// ===========================================================================

/** A boss line's word ceiling per call kind (BOSS-PROMPTS §2). */
export const BOSS_WORD_CAPS: Readonly<Record<BossCallKind, number>> = { turn: 25, talk: 30, scene: 40 };

/** The §3 game words, whole words, any case. */
export const GAME_WORDS = /\b(?:HP|damage|round|turn|skill|charge|XP|level)\b/gi;

export type BossLineRule =
  | TextRuleId
  | 'digit'
  | 'game-word'
  | 'opener-the-air'
  | 'too-long'
  | 'repeats-opening';

export interface BossLineFault {
  rule: BossLineRule;
  match: string;
  index: number;
}

/** How many of its previous lines a new line's opening is compared with. */
export const REPEAT_WINDOW = 5;

/** The first three words, lower-cased with punctuation removed — what "the same opening" means. */
export function openingOf(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 3)
    .join(' ');
}

const wordCount = (line: string): number => line.split(/\s+/).filter((w) => w !== '').length;

/**
 * Every fault in one boss line. PURE. `echoOf` is the prompt's own USER lines (from
 * `buildBossPrompt`), so the narrator's echo gate reads a word the engine handed over as
 * obedience; `previous` is the boss's own earlier lines this fight, oldest first.
 */
export function checkBossLine(
  line: string,
  kind: BossCallKind,
  vocab: TextVocabulary,
  opts: { echoOf?: readonly string[]; previous?: readonly string[] } = {},
): BossLineFault[] {
  const faults: BossLineFault[] = detectTextFaults(line, vocab, {
    rules: MODEL_TEXT_RULES,
    ...(opts.echoOf !== undefined ? { echoOf: opts.echoOf } : {}),
  }).faults.map((f) => ({ rule: f.rule, match: f.match, index: f.index }));

  for (const m of line.matchAll(/\d+/g)) faults.push({ rule: 'digit', match: m[0], index: m.index });
  for (const m of line.matchAll(GAME_WORDS)) faults.push({ rule: 'game-word', match: m[0], index: m.index });

  const opener = /^[\s"'“‘(…—-]*the air\b/i.exec(line);
  if (opener) faults.push({ rule: 'opener-the-air', match: opener[0].trim(), index: 0 });

  const words = wordCount(line);
  if (words > BOSS_WORD_CAPS[kind]) faults.push({ rule: 'too-long', match: String(words), index: 0 });

  const opening = openingOf(line);
  if (opening !== '') {
    const earlier = (opts.previous ?? []).slice(-REPEAT_WINDOW);
    const hit = earlier.find((p) => openingOf(p) === opening);
    if (hit !== undefined) faults.push({ rule: 'repeats-opening', match: opening, index: 0 });
  }

  return faults.sort((a, b) => a.index - b.index);
}

// ===========================================================================
// fallbackFor
// ===========================================================================

/**
 * The line to show when the model is off, slow or wrong (§6). Chosen by `index` — the caller
 * passes the round number — modulo the card's list, so the same fight always shows the same
 * lines and nothing here is random. `_kind` is accepted so call sites stay stable if a card
 * later gains lines per kind; every kind draws from the one list today (§5 gives one list per
 * boss).
 */
export function fallbackFor(persona: BossPersona, _kind: BossCallKind, index: number): string {
  const lines = persona.fallbackLines;
  if (lines.length === 0) return '';
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  return lines[((i % lines.length) + lines.length) % lines.length] ?? '';
}
