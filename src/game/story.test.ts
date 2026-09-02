import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getStory,
  getIntro,
  getActIntro,
  getActOutro,
  getEnding,
  getGraceEnding,
  getDamnationEnding,
} from './story.ts';

// Hand-derived from Java `Story.java`. Intro opens "The capital of Absolution,
// 2100 . . ."; act headers are ACT I..V; the legacy ending header is "END.".
//
// CHANGED for G47 (2026-09-01): the Java original inlined the player's name into the
// intro and both endings. GAME-DESIGN.md §22.1 / WORLD.md §8 [LOCKED] rule that the
// narrator NEVER speaks the player's name, and these three bodies flow into the model's
// prompt via `describeEvent`. The `{playerName}` token is therefore GONE from every LIVE
// story string, and the assertions below now check its ABSENCE. The name survives on the
// label surfaces §22.2 preserves (HUD, character sheet, save slot).

describe('the {playerName} token is gone from every LIVE story string (G47)', () => {
  // The regression guard for the whole rule, in one place: whatever else changes in
  // story.json, no string the engine substitutes into a narration event may carry the
  // token again. `getEnding()` is deliberately excluded — see the `ending` block below.
  it('no live story text carries the token', () => {
    const live = [
      ...getIntro().lines,
      getGraceEnding().body,
      getGraceEnding().header,
      getDamnationEnding().body,
      getDamnationEnding().header,
      ...[1, 2, 3, 4, 5].flatMap((a) => [
        getActIntro(a)!.header,
        getActIntro(a)!.body,
        getActOutro(a)!.header,
        getActOutro(a)!.body,
      ]),
    ];
    for (const s of live) expect(s).not.toContain('{playerName}');
  });
});

// =========================================================================================
// G49 — the doc comments claimed a token that is in exactly one place.
//
// `story.ts`'s header and four of its accessors all said the `{playerName}` token was "kept
// literal" and substituted later, as though it ran through the content. It appears ONCE, in
// the legacy `ending.body`. The consequence is that `game.ts`'s `substituteName` is a no-op
// on all three of its live call sites — correct, because G47 rules the name is never spoken,
// but a silent no-op sitting beside a comment claiming otherwise is the failure mode.
//
// The INVARIANT is asserted here rather than the edit, so a future content change that puts
// the token back somewhere fails loudly instead of quietly re-truthing a stale comment.
// =========================================================================================

describe('G49 — exactly one accessor carries the name token', () => {
  it('getEnding does, and it is the only one', () => {
    // The positive half. `story.test.ts` already asserts the ABSENCE across the live strings;
    // without this, deleting the token from story.json entirely would leave that guard green
    // and this file silently no longer describing anything.
    expect(getEnding().body).toContain('{playerName}');
    for (const section of [getGraceEnding(), getDamnationEnding()]) {
      expect(section.body).not.toContain('{playerName}');
      expect(section.header).not.toContain('{playerName}');
    }
    expect(getIntro().lines.join(' ')).not.toContain('{playerName}');
    expect(getStory().intro.header).not.toContain('{playerName}');
  });

  it('and no OTHER accessor even mentions it in its doc comment', () => {
    // The companion source check. A comment is not covered by any behavioural test, and a
    // stale comment about where a token lives is exactly what G49 is.
    const src = readFileSync(fileURLToPath(new URL('./story.ts', import.meta.url)), 'utf8');
    const docs = [...src.matchAll(/\/\*\*[\s\S]*?\*\/\s*export function (\w+)/g)];
    // The regex must actually be finding the accessors, or the loop below is vacuous.
    expect(docs.map((m) => m[1])).toEqual([
      'getStory',
      'getIntro',
      'getActIntro',
      'getActOutro',
      'getEnding',
      'getGraceEnding',
      'getDamnationEnding',
    ]);
    const mentioning = docs.filter((m) => m[0].includes('{playerName}')).map((m) => m[1]);
    expect(mentioning, 'a doc comment names the token above the wrong accessor').toEqual([
      'getEnding',
    ]);
  });
});

describe('intro', () => {
  it('contains the opening capital-of-Absolution line', () => {
    const joined = getIntro().lines.join('\n');
    expect(joined).toContain('The capital of Absolution, 2100');
  });

  // CHANGED for G47 (was: "carries the {playerName} substitution token"). The intro lines
  // go straight into the `intro` event and from there into the model's prompt, so the
  // narrator would read the player's name aloud — the exact break §22.1 ruled against.
  // The name is dropped along with the comma that set off the appositive, so the sentence
  // still reads "…has ordered you to delve into the Rift…".
  it('does NOT carry the {playerName} token, and still reads as one sentence', () => {
    const joined = getIntro().lines.join('\n');
    expect(joined).not.toContain('{playerName}');
    expect(getIntro().lines.join(' ')).toContain('has ordered you to delve into the Rift');
  });

  it('has header STORY', () => {
    expect(getIntro().header).toBe('STORY');
  });
});

describe('act intros / outros', () => {
  const EXPECTED_HEADERS: Record<number, string> = {
    1: 'ACT I',
    2: 'ACT II',
    3: 'ACT III',
    4: 'ACT IV',
    5: 'ACT V',
  };

  it('cover Acts 1..5 with the correct headers (intros)', () => {
    for (const act of [1, 2, 3, 4, 5]) {
      expect(getActIntro(act)!.header).toBe(EXPECTED_HEADERS[act]);
    }
  });

  it('cover Acts 1..5 with the correct headers (outros)', () => {
    for (const act of [1, 2, 3, 4, 5]) {
      expect(getActOutro(act)!.header).toBe(EXPECTED_HEADERS[act]);
    }
  });

  it('have empty bodies (Java printed only a header) and no Act 0/6', () => {
    for (const act of [1, 2, 3, 4, 5]) {
      expect(getActIntro(act)!.body).toBe('');
      expect(getActOutro(act)!.body).toBe('');
    }
    expect(getActIntro(0)).toBeUndefined();
    expect(getActOutro(6)).toBeUndefined();
  });
});

describe('ending', () => {
  // DEAD ANCHOR — the ONE legitimate {playerName} in the repo. This legacy "END." body has
  // no live call site: only `getEnding()` reads it and only this test calls that (the two
  // shipped endings are grace/damnation below). It is kept verbatim as the Java-parity
  // record, so G47's rule does not reach it. Anywhere the Void actually SPEAKS, the token
  // is forbidden — see the G47 block at the top of this file. Do not read this exception
  // as a sanctioned use; if this anchor ever gains a call site, it must lose the token.
  it('has header END. and carries the {playerName} token', () => {
    expect(getEnding().header).toBe('END.');
    expect(getEnding().body).toContain('{playerName}');
  });
});

describe('M12 two endings (grace / damnation)', () => {
  // CHANGED for G47 (was: "grace and damnation each carry the {playerName} token"). Both
  // bodies reach the model as facts via the `ending` event, and they are the LAST words of
  // a completed run — the one moment §22.1's voice rule matters most. Recast in second
  // person by a subject swap only (Appendix A.1): every word was already shipped or is
  // WORLD.md §9's own [LOCKED] phrasing. C12 stays open for #13 to replace them outright.
  it('speak in second person and never name the player', () => {
    expect(getGraceEnding().body).not.toContain('{playerName}');
    expect(getDamnationEnding().body).not.toContain('{playerName}');
    expect(getGraceEnding().body.startsWith('You ')).toBe(true);
    expect(getDamnationEnding().body.startsWith('You ')).toBe(true);
  });

  it('are DISTINCT from each other (distinct header + body)', () => {
    expect(getGraceEnding().header).not.toBe(getDamnationEnding().header);
    expect(getGraceEnding().body).not.toBe(getDamnationEnding().body);
  });
});

describe('serializability', () => {
  it('the whole story round-trips through JSON unchanged', () => {
    const story = getStory();
    expect(JSON.parse(JSON.stringify(story))).toEqual(story);
  });
});
