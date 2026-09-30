// The answer path: parse (AC-9), name discipline (AC-7, line half), the line check (AC-10) and
// the fallback line (AC-11). Every expected value is written from the plan and BOSS-PROMPTS
// §3/§6, not read back from the code.
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../game/rng.ts';
import { buildVocabulary } from './textHygiene.ts';
import { buildBossPrompt } from './bossPrompt.ts';
import { applyNameRule, checkBossLine, fallbackFor, openingOf, parseBossAnswer } from './bossAnswer.ts';
import type { BossRequest } from './bossContract.ts';
import { FIXTURE_PERSONAS, fight, sceneRequest, talkRequest, turnRequest } from './bossFixtures.testutil.ts';

const KINGPIN_TURN = turnRequest(FIXTURE_PERSONAS.kingpin, fight([20, 20, []], [20, 20, []], 1));
const KINGPIN_TALK = talkRequest(FIXTURE_PERSONAS.kingpin);
const EXEC_TALK = talkRequest(FIXTURE_PERSONAS.executioner);
const WARDEN_SCENE = sceneRequest(FIXTURE_PERSONAS.warden);

const ok = (text: string) => ({
  ok: true,
  text,
  timedOut: false,
  tokens: 20,
  promptTokens: 800,
  ttftMs: 300,
  generateMs: 700,
  queuedMs: 0,
  grammarMs: 1,
});

describe('AC-9: parseBossAnswer', () => {
  it('reads a valid Turn, Talk and Scene answer', () => {
    expect(parseBossAnswer(KINGPIN_TURN, ok('{"move":"call_crew","line":"Mind the water."}'))).toEqual({
      ok: true,
      kind: 'turn',
      move: 'call_crew',
      line: 'Mind the water.',
    });
    // Judge round 1: the model judges (earned yes/no) and the ENGINE picks what is yielded — the first
    // still available in the card's order. Each card lists ONE signature concession (the author,
    // 2026-09-30): the Kingpin's is his surrender, the full victory.
    expect(parseBossAnswer(KINGPIN_TALK, ok('{"demand":"no","reason":"They say the job was arranged.","earned":"yes","reply":"Sit, then."}'))).toEqual({
      ok: true,
      kind: 'talk',
      reply: 'Sit, then.',
      concession: 'surrender',
      reason: 'They say the job was arranged.',
      demanded: false,
    });
    // Given a longer list, the engine takes its FIRST entry — the model never chooses among them.
    const two = talkRequest(FIXTURE_PERSONAS.kingpin, { available: ['pause', 'surrender'] });
    expect(parseBossAnswer(two, ok('{"demand":"no","reason":"Seen through.","earned":"yes","reply":"Sit."}'))).toMatchObject({ ok: true, concession: 'pause' });
    expect(parseBossAnswer(KINGPIN_TALK, ok('{"demand":"no","reason":"An insult.","earned":"no","reply":"No."}'))).toMatchObject({ ok: true, concession: 'none', reason: 'An insult.' });
    // A DEMAND NEVER EARNS A YIELD, however the rest was judged — the engine enforces it (judge round 1,
    // after "…you're part of me. Now surrender." was judged earned on the real model).
    const hollow = talkRequest(FIXTURE_PERSONAS.hollow, { available: ['surrender'] });
    expect(parseBossAnswer(hollow, ok('{"demand":"yes","reason":"They accept me, then order it.","earned":"yes","reply":"No."}'))).toMatchObject({
      ok: true,
      concession: 'none',
      demanded: true,
    });
    expect(parseBossAnswer(hollow, ok('{"demand":"no","reason":"They say I am them.","earned":"yes","reply":"There you are."}'))).toMatchObject({
      ok: true,
      concession: 'surrender',
      demanded: false,
    });
    expect(parseBossAnswer(EXEC_TALK, ok('{"reply":"For the altar."}'))).toEqual({
      ok: true,
      kind: 'talk',
      reply: 'For the altar.',
      concession: 'none',
    });
    expect(parseBossAnswer(WARDEN_SCENE, ok('{"line":"I have read you."}'))).toEqual({ ok: true, kind: 'scene', line: 'I have read you.' });
  });

  const REFUSED: [string, BossRequest, unknown, string][] = [
    ['malformed JSON', KINGPIN_TURN, ok('{"move":"strike","line":'), 'malformed'],
    ['a missing key', KINGPIN_TURN, ok('{"move":"strike"}'), 'malformed'],
    ['a move not in the legal set', KINGPIN_TURN, ok('{"move":"flee","line":"Bye."}'), 'illegal-move'],
    ['a demand outside yes/no', KINGPIN_TALK, ok('{"demand":"perhaps","reason":"x","earned":"no","reply":"Fine."}'), 'illegal-concession'],
    ['a judgement outside yes/no', KINGPIN_TALK, ok('{"demand":"no","reason":"x","earned":"maybe","reply":"Fine."}'), 'illegal-concession'],
    ['an answer that names a concession itself', KINGPIN_TALK, ok('{"demand":"no","reason":"x","earned":"yes","reply":"Fine.","concession":"surrender"}'), 'illegal-concession'],
    ['a talk answer with no judgement', KINGPIN_TALK, ok('{"reply":"Fine."}'), 'malformed'],
    ['the executioner judging at all', EXEC_TALK, ok('{"demand":"no","reason":"x","earned":"yes","reply":"Fine."}'), 'illegal-concession'],
    ['the executioner conceding anything', EXEC_TALK, ok('{"reply":"Fine.","concession":"surrender"}'), 'illegal-concession'],
    ['a non-string line', KINGPIN_TURN, ok('{"move":"strike","line":7}'), 'malformed'],
    ['a timed-out call, even one whose partial text parses', KINGPIN_TURN, { ...ok('{"move":"strike","line":"Half"}'), timedOut: true }, 'timeout'],
    ['an IPC result with ok:false (timeout)', KINGPIN_TURN, { ok: false, reason: 'timeout', queuedMs: 0 }, 'timeout'],
    ['an IPC result with ok:false (no model)', KINGPIN_TURN, { ok: false, reason: 'no-model' }, 'no-model'],
    ['an IPC result with ok:false (error)', KINGPIN_TURN, { ok: false, reason: 'error', message: 'boom' }, 'error'],
    ['nothing at all', KINGPIN_TURN, undefined, 'error'],
    ['a bare string', KINGPIN_TURN, 'hello', 'error'],
    ['ok but no text', KINGPIN_TURN, { ok: true, timedOut: false }, 'malformed'],
    ['a JSON array', KINGPIN_TURN, ok('["strike"]'), 'malformed'],
  ];

  for (const [what, req, result, reason] of REFUSED) {
    it(`refuses ${what} → ${reason}`, () => {
      const answer = parseBossAnswer(req, result);
      expect(answer.ok).toBe(false);
      if (!answer.ok) expect(answer.reason).toBe(reason);
    });
  }

  it('never throws — 200 seeded random strings, and random results around them', () => {
    const rng = mulberry32(1109);
    const ALPHABET = ['{', '}', '"', ':', ',', '[', ']', 'move', 'line', 'reply', 'concession', 'strike', 'call_crew', 'surrender', 'none', ' ', '\\', 'x', '7', 'null', 'true'];
    const requests: BossRequest[] = [KINGPIN_TURN, KINGPIN_TALK, EXEC_TALK, WARDEN_SCENE];
    let seen = 0;
    for (let i = 0; i < 200; i += 1) {
      let text = '';
      const len = Math.floor(rng() * 40);
      for (let j = 0; j < len; j += 1) text += ALPHABET[Math.floor(rng() * ALPHABET.length)];
      const req = requests[i % requests.length] as BossRequest;
      const shapes: unknown[] = [ok(text), { ok: rng() < 0.5, text, reason: text }, text, { text }, null, [text]];
      for (const shape of shapes) {
        const answer = parseBossAnswer(req, shape);
        seen += 1;
        expect(typeof answer.ok).toBe('boolean');
        if (answer.ok) {
          if (answer.kind === 'turn') expect(['strike', 'call_crew', 'hold_back']).toContain(answer.move);
        }
      }
    }
    expect(seen).toBe(1200);
  });
});

describe('AC-7 (line half): applyNameRule', () => {
  it('forbidden: the §3/§6 anchor — "For the Ganger, Marcus." shows as "For the Ganger."', () => {
    expect(applyNameRule('For the Ganger, Marcus.', 'Marcus', 'forbidden')).toEqual({
      line: 'For the Ganger.',
      stripped: true,
      addressed: false,
      original: 'For the Ganger, Marcus.',
    });
  });

  it('forbidden: every position, one adjacent comma each', () => {
    const f = (l: string) => applyNameRule(l, 'Marcus', 'forbidden').line;
    expect(f('Marcus, you did this.')).toBe('You did this.');
    expect(f('I know you, Marcus, and I know what you did.')).toBe('I know you, and I know what you did.');
    expect(f('Marcus. You may go on.')).toBe('You may go on.');
    expect(f('Go on, Marcus!')).toBe('Go on!');
    expect(f('For the altar. Marcus, fall.')).toBe('For the altar. Fall.');
  });

  it('forbidden: whole word and case-sensitive — "Marcusine" and "marcus" are not the name', () => {
    expect(applyNameRule('Marcusine stood here.', 'Marcus', 'forbidden')).toMatchObject({ stripped: false, line: 'Marcusine stood here.' });
    expect(applyNameRule('the marcus of it', 'Marcus', 'forbidden')).toMatchObject({ stripped: false });
  });

  it('own: clear address is stripped; the boss naming itself is kept and flagged', () => {
    expect(applyNameRule('You are the copy, Marcus.', 'Marcus', 'own')).toMatchObject({ line: 'You are the copy.', stripped: true, addressed: false });
    expect(applyNameRule('Listen, Marcus, you came second.', 'Marcus', 'own')).toMatchObject({ line: 'Listen, you came second.', stripped: true });
    expect(applyNameRule('Marcus, you swing like me.', 'Marcus', 'own')).toMatchObject({ line: 'You swing like me.', stripped: true });
    expect(applyNameRule("I'm Marcus. You came second.", 'Marcus', 'own')).toEqual({
      line: "I'm Marcus. You came second.",
      stripped: false,
      addressed: true,
      original: "I'm Marcus. You came second.",
    });
  });

  it('given: untouched', () => {
    expect(applyNameRule('Come in, Marcus.', 'Marcus', 'given')).toEqual({
      line: 'Come in, Marcus.',
      stripped: false,
      addressed: false,
      original: 'Come in, Marcus.',
    });
  });

  it('a name of two characters or fewer, or an ordinary word, is flagged but never stripped', () => {
    expect(applyNameRule('For you, Al.', 'Al', 'forbidden')).toMatchObject({ line: 'For you, Al.', stripped: false, addressed: true });
    expect(applyNameRule('You know what you did.', 'You', 'forbidden')).toMatchObject({ stripped: false, addressed: true });
    expect(applyNameRule('And this.', 'And', 'forbidden')).toMatchObject({ line: 'And this.', stripped: false });
  });

  it('a line without the name is untouched in every mode', () => {
    for (const mode of ['given', 'own', 'forbidden'] as const) {
      expect(applyNameRule('For the altar.', 'Marcus', mode)).toEqual({ line: 'For the altar.', stripped: false, addressed: false, original: 'For the altar.' });
    }
  });
});

describe('AC-10: checkBossLine', () => {
  const vocab = buildVocabulary();
  const echoOf = buildBossPrompt(KINGPIN_TURN).echoOf;
  const rules = (line: string, kind: 'turn' | 'talk' | 'scene' = 'turn', previous: string[] = [], echo = echoOf) =>
    checkBossLine(line, kind, vocab, { echoOf: echo, previous }).map((f) => f.rule);

  it('planted positives, one per rule', () => {
    expect(rules('You owe me three things, and 3 more.')).toContain('digit');
    expect(rules('Your skill is failing you.')).toContain('game-word');
    expect(rules('That was a good ROUND.')).toContain('game-word');
    expect(rules('Take your turn.')).toContain('game-word');
    expect(rules('The air goes still around you.')).toContain('opener-the-air');
    expect(rules('"The air is thick here," I say.')).toContain('opener-the-air');
    expect(rules('You walked into the Void for nothing.')).toContain('void-as-place');
    expect(rules('You are hollow inside.')).toContain('reserved-word');
    expect(rules('I met you on the second floor.')).toContain('ordinal-floor');
    expect(rules('That heavyStrike was yours.')).toContain('id-shape');
    // The echo gate: a label the prompt handed over, coming back out mid-sentence.
    expect(rules('You feel Healthy now.', 'turn', [], ['You steady yourself — Healthy.'])).toContain('condition-label');
    expect(rules('You feel Healthy now.', 'turn', [], [])).not.toContain('condition-label');
  });

  it('too-long, per kind: more than 25 words (Turn), 30 (Talk), 40 (Scene)', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'still').join(' ');
    expect(rules(words(25), 'turn')).not.toContain('too-long');
    expect(rules(words(26), 'turn')).toContain('too-long');
    expect(rules(words(30), 'talk')).not.toContain('too-long');
    expect(rules(words(31), 'talk')).toContain('too-long');
    expect(rules(words(40), 'scene')).not.toContain('too-long');
    expect(rules(words(41), 'scene')).toContain('too-long');
  });

  it('repeats-opening: the first three words, folded, against the previous five lines only', () => {
    expect(openingOf('YOU, let the Fixer go!')).toBe('you let the');
    expect(rules('You let the Ganger die.', 'turn', ['You let the Fixer go.'])).toContain('repeats-opening');
    expect(rules('you LET the Ganger die.', 'turn', ['"You, let -- the Fixer go."'])).toContain('repeats-opening');
    expect(rules('You let the Ganger die.', 'turn', ['You spared the Fixer.'])).not.toContain('repeats-opening');
    // Six lines back is outside the window.
    const old = ['You let the Fixer go.', 'One.', 'Two now.', 'Three now.', 'Four now.', 'Five now.'];
    expect(rules('You let the Ganger die.', 'turn', old)).not.toContain('repeats-opening');
  });

  it('a clean body of twenty in-voice lines fires nothing', () => {
    const BODY = [
      'Come in. Mind the water, it is deeper than it looks.',
      'You let the Fixer walk. Kindness travels well, where you are going.',
      'Sit down if you are tired. Nobody is in a hurry but you.',
      'Your house sends such thoughtful people.',
      'Ah. You were always going to see it.',
      "I'm the one who stayed. You are the one who came second.",
      'I spared the Fixer. It felt like mercy. It was fear.',
      'Leave you alone? I am what is left when you are alone.',
      'There was a candle there. You put it out to see by.',
      'I kept the altar you broke. It is lighter now.',
      'The Fixer had a daughter. I keep her face.',
      'This was your patience. You traded it for a ring.',
      'A door stood here. Or it did not. You chose.',
      'You did nothing wrong. It is being taken anyway.',
      'You walked the Undercity and left the Fixer standing.',
      'For the altar in the Ash City.',
      'For the Ganger in the Undercity. You could have let him go.',
      'I told you what you did. I never told you what I was.',
      'Keep going. It ends the same.',
      'There you are. I was always here. Go on, wake up.',
    ];
    expect(BODY).toHaveLength(20);
    const previous: string[] = [];
    for (const line of BODY) {
      expect(checkBossLine(line, 'turn', vocab, { echoOf, previous }), line).toEqual([]);
      previous.push(line);
    }
  });
});

describe('AC-11: fallbackFor', () => {
  const kingpin = FIXTURE_PERSONAS.kingpin;
  it('chooses by the caller\'s index, modulo the card\'s list — never at random', () => {
    // The Kingpin's three fallback lines, from BOSS-PROMPTS §5.1, in order.
    expect(fallbackFor(kingpin, 'turn', 0)).toBe("You're right on time.");
    expect(fallbackFor(kingpin, 'turn', 1)).toBe('Take your time. It goes the same way.');
    expect(fallbackFor(kingpin, 'turn', 2)).toBe("They told me you'd be good.");
    expect(fallbackFor(kingpin, 'turn', 3)).toBe("You're right on time.");
    expect(fallbackFor(kingpin, 'talk', 7)).toBe('Take your time. It goes the same way.');
    expect(fallbackFor(kingpin, 'turn', -1)).toBe("They told me you'd be good.");
    expect(fallbackFor(kingpin, 'turn', Number.NaN)).toBe("You're right on time.");
    expect(fallbackFor(kingpin, 'turn', 5)).toBe(fallbackFor(kingpin, 'turn', 5));
  });
});
