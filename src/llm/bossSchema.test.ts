// The answer schemas: the enum IS the engine's legal set, so an illegal move cannot be written
// (BOSS-PROMPTS §1), and the executioner's Talk has no concession field at all (§5.5).
import { describe, it, expect } from 'vitest';
import { sceneSchema, talkSchema, turnSchema, validateAgainst } from './bossSchema.ts';

describe('turnSchema', () => {
  it('the move enum is exactly the legal ids, in the engine\'s order', () => {
    const s = turnSchema(['strike', 'call_crew', 'hold_back']);
    expect(s.properties.move).toEqual({ enum: ['strike', 'call_crew', 'hold_back'] });
    expect(turnSchema(['hold_back', 'strike']).properties.move).toEqual({ enum: ['hold_back', 'strike'] });
    expect(s.properties.line).toEqual({ type: 'string', maxLength: 220 });
    expect(Object.keys(s.properties)).toEqual(['move', 'line']);
    expect(s.required).toEqual(['move', 'line']);
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
  });

  it('an illegal move is refused — {"move":"flee"} against [strike]', () => {
    const s = turnSchema(['strike']);
    expect(validateAgainst(s, { move: 'flee', line: 'x' })).toMatchObject({ ok: false, key: 'move' });
    expect(validateAgainst(s, { move: 'strike', line: 'Come here.' })).toEqual({ ok: true });
  });

  it('the schema is plain data (it crosses IPC)', () => {
    const s = turnSchema(['strike', 'cast:heavyStrike']);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('talkSchema', () => {
  it('the concession enum is none plus what is still available', () => {
    const s = talkSchema(['pause', 'surrender']);
    expect(s.properties.concession).toEqual({ enum: ['none', 'pause', 'surrender'] });
    expect(s.properties.reply).toEqual({ type: 'string', maxLength: 240 });
    expect(s.required).toEqual(['reply', 'concession']);
  });

  it('with nothing available (the executioner; a boss that already yielded) there is NO concession key', () => {
    const s = talkSchema([]);
    expect(Object.keys(s.properties)).toEqual(['reply']);
    expect('concession' in s.properties).toBe(false);
    expect(s.required).toEqual(['reply']);
    // ...so an answer that carries one anyway is refused, even "none".
    expect(validateAgainst(s, { reply: 'For the altar.', concession: 'surrender' })).toMatchObject({ ok: false, key: 'concession' });
    expect(validateAgainst(s, { reply: 'For the altar.', concession: 'none' })).toMatchObject({ ok: false });
    expect(validateAgainst(s, { reply: 'For the altar.' })).toEqual({ ok: true });
  });

  it('a concession not offered is refused', () => {
    expect(validateAgainst(talkSchema(['pause']), { reply: 'No.', concession: 'surrender' })).toMatchObject({ ok: false });
  });
});

describe('sceneSchema', () => {
  it('is { line }, longer', () => {
    expect(sceneSchema().properties).toEqual({ line: { type: 'string', maxLength: 320 } });
  });
});

describe('validateAgainst refuses every malformed shape without throwing', () => {
  const s = turnSchema(['strike']);
  const CASES: [string, unknown][] = [
    ['null', null],
    ['an array', ['strike']],
    ['a string', 'strike'],
    ['a missing line', { move: 'strike' }],
    ['a missing move', { line: 'x' }],
    ['a number line', { move: 'strike', line: 5 }],
    ['an extra key', { move: 'strike', line: 'x', mood: 'calm' }],
    ['a line past its ceiling', { move: 'strike', line: 'a'.repeat(221) }],
    ['a non-string move', { move: 1, line: 'x' }],
  ];
  for (const [what, value] of CASES) {
    it(what, () => {
      expect(validateAgainst(s, value).ok).toBe(false);
    });
  }
  it('a line exactly at its ceiling is fine', () => {
    expect(validateAgainst(s, { move: 'strike', line: 'a'.repeat(220) })).toEqual({ ok: true });
  });
});
