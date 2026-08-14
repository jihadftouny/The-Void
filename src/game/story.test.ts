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
// 2100 . . ." and inlines the player name (our {playerName} token). Act headers
// are ACT I..V; the ending header is "END." and prints the player name.

describe('intro', () => {
  it('contains the opening capital-of-Absolution line', () => {
    const joined = getIntro().lines.join('\n');
    expect(joined).toContain('The capital of Absolution, 2100');
  });

  it('carries the {playerName} substitution token', () => {
    const joined = getIntro().lines.join('\n');
    expect(joined).toContain('{playerName}');
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
  it('has header END. and carries the {playerName} token', () => {
    expect(getEnding().header).toBe('END.');
    expect(getEnding().body).toContain('{playerName}');
  });
});

describe('M12 two endings (grace / damnation)', () => {
  it('grace and damnation each carry the {playerName} token', () => {
    expect(getGraceEnding().body).toContain('{playerName}');
    expect(getDamnationEnding().body).toContain('{playerName}');
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
