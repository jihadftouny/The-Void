import { describe, expect, it } from 'vitest';
import {
  FAMILIES,
  getFamily,
  familiesForAct,
  availableFamiliesForAct,
} from './enemyFamily.ts';

// The oracle sets below are hand-listed from the plan's Design (§ "The 24 families")
// and GAME-DESIGN §9 — NOT read back from the loader — so the roster is checked against
// an independent statement of intent.

const PER_FLOOR: Record<number, readonly string[]> = {
  1: ['gangers', 'securityDrones', 'mutantStrays', 'cyberEnforcers', 'fixers'],
  2: ['reflections', 'mirrorSelves', 'distortions', 'staticWraiths'],
  3: ['grief', 'rage', 'dread', 'numbness', 'sevenSins', 'ashWraiths'],
  4: ['choir', 'guardians', 'theJudged', 'seraphWardens'],
  5: ['demons', 'voidHorrors', 'theUnmade', 'echoesOfYou', 'theHollowed'],
};

const KARMA_WEIGHTED = new Set([
  'gangers',
  'fixers',
  'grief',
  'rage',
  'dread',
  'numbness',
  'sevenSins',
  'theJudged',
  'echoesOfYou',
]);

const SIX_TAGS = new Set(['Beast', 'Humanoid', 'Mech', 'Magical', 'Nightmare', 'Ancestral']);

describe('the family roster', () => {
  it('has exactly 24 families', () => {
    expect(FAMILIES).toHaveLength(24);
  });

  it('assigns families per floor exactly F1=5, F2=4, F3=6, F4=4, F5=5', () => {
    for (const act of [1, 2, 3, 4, 5]) {
      const ids = familiesForAct(act).map((f) => f.id);
      expect(ids).toEqual(PER_FLOOR[act]);
    }
  });

  it('has the per-floor counts {1:5,2:4,3:6,4:4,5:5}', () => {
    expect(familiesForAct(1)).toHaveLength(5);
    expect(familiesForAct(2)).toHaveLength(4);
    expect(familiesForAct(3)).toHaveLength(6);
    expect(familiesForAct(4)).toHaveLength(4);
    expect(familiesForAct(5)).toHaveLength(5);
  });

  it('flags exactly the 9 karma-weighted families and no others', () => {
    const flagged = new Set(FAMILIES.filter((f) => f.karmaWeighted).map((f) => f.id));
    expect(flagged).toEqual(KARMA_WEIGHTED);
    // And the complement carries no flag.
    for (const f of FAMILIES) {
      expect(f.karmaWeighted).toBe(KARMA_WEIGHTED.has(f.id));
    }
  });

  it('every family tag is one of the six broad kinds', () => {
    for (const f of FAMILIES) {
      expect(SIX_TAGS.has(f.tag)).toBe(true);
    }
  });

  it('every family carries a behaviorNote (M10 deferral captured as data)', () => {
    for (const f of FAMILIES) {
      expect(typeof f.theme.behaviorNote).toBe('string');
      expect(f.theme.behaviorNote.length).toBeGreaterThan(0);
    }
  });

  it('every family id is unique', () => {
    expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length);
  });
});

describe('the karma seam (uniform mercy↔cruelty now)', () => {
  it('every ⚖ family defaults onSpare=spareWeighted, onKill=killWeighted', () => {
    for (const f of FAMILIES) {
      if (!f.karmaWeighted) continue;
      expect(f.onSpare).toBe('spareWeighted');
      expect(f.onKill).toBe('killWeighted');
    }
  });
});

describe('getFamily', () => {
  it('returns the named family and undefined for an unknown id', () => {
    expect(getFamily('sevenSins')?.name).toBe('Sin');
    expect(getFamily('gangers')?.karmaWeighted).toBe(true);
    expect(getFamily('nope')).toBeUndefined();
    expect(getFamily('Beast')).toBeUndefined(); // legacy type, not a family id
  });
});

describe('availableFamiliesForAct (M13 unlock seam)', () => {
  it('defaults to every family of the act when omitted', () => {
    for (const act of [1, 2, 3, 4, 5]) {
      expect(availableFamiliesForAct(act).map((f) => f.id)).toEqual(PER_FLOOR[act]);
    }
  });

  it('restricts to the intersection with the act when an unlocked set is given', () => {
    const unlocked = new Set(['securityDrones', 'mutantStrays', 'echoesOfYou']);
    // Only the two act-1 members intersect for act 1 (echoesOfYou is a floor-5 family).
    expect(availableFamiliesForAct(1, unlocked).map((f) => f.id)).toEqual([
      'securityDrones',
      'mutantStrays',
    ]);
  });

  it('falls back to all of the act when the unlocked set intersects nothing', () => {
    const unlocked = new Set(['demons']); // a floor-5 family, absent from act 1
    expect(availableFamiliesForAct(1, unlocked).map((f) => f.id)).toEqual(PER_FLOOR[1]);
  });
});
