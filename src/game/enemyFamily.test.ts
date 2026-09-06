import { describe, expect, it } from 'vitest';
import {
  FAMILIES,
  getFamily,
  familiesForAct,
  availableFamiliesForAct,
} from './enemyFamily.ts';
import { type KarmaAction } from './karma.ts';

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

// CHANGED by #10a — the one pre-existing assertion this unit rewrites, and why it was wrong.
//
// It used to read: `it('every ⚖ family defaults onSpare=spareWeighted, onKill=killWeighted')`,
// asserting `f.onSpare === 'spareWeighted'` for EVERY ⚖ family. That was the M8 placeholder
// state ("uniformly set to the mercy↔cruelty pair now"), not the design. GAME-DESIGN §9 says
// "The Judged ⚖⚖ (non-hostile souls; spare = reverence, kill = desecration)", and §22.22 (the
// author's ruling, 2026-09-04) reads that as ADDITIVE: a spare there is mercy AND reverence.
// So `onSpare` is a LIST now, and The Judged's is two long. The old assertion could only be
// satisfied by never wiring reverence, or by wiring it INSTEAD of mercy — the substitution the
// author explicitly rejected. It is replaced, not deleted: the uniformity it protected still
// holds for the other eight families, and is still asserted, family by family.
describe('the karma seam — mercy↔cruelty everywhere, plus reverence on The Judged (§22.22)', () => {
  // Hand-listed from §9 + §22.22, NOT read back from the loader, so the data is checked
  // against an independent statement of intent (like PER_FLOOR / KARMA_WEIGHTED above).
  const EXPECTED_ON_SPARE: Record<string, readonly KarmaAction[]> = {
    gangers: ['spareWeighted'],
    fixers: ['spareWeighted'],
    grief: ['spareWeighted'],
    rage: ['spareWeighted'],
    dread: ['spareWeighted'],
    numbness: ['spareWeighted'],
    sevenSins: ['spareWeighted'],
    theJudged: ['spareWeighted', 'honorDead'],
    echoesOfYou: ['spareWeighted'],
  };

  it('every ⚖ family spares as mercy, and The Judged ALSO honours the dead', () => {
    let checked = 0;
    for (const f of FAMILIES) {
      if (!f.karmaWeighted) continue;
      checked += 1;
      expect(f.onSpare, f.id).toEqual(EXPECTED_ON_SPARE[f.id]);
    }
    // Non-vacuity: all nine ⚖ families were actually visited (an oracle keyed by id would
    // otherwise pass by comparing `undefined` to `undefined` if the roster shrank).
    expect(checked).toBe(9);
    expect(Object.keys(EXPECTED_ON_SPARE)).toHaveLength(9);
  });

  it('mercy is still the FIRST action of every spare — reverence was added, not substituted', () => {
    // The polarity guard for the author's ruling. Wiring The Judged as `['honorDead']` alone
    // (§9 read literally) satisfies "reverence moves" but breaks this.
    for (const f of FAMILIES) {
      if (!f.karmaWeighted) continue;
      expect(f.onSpare?.[0], f.id).toBe('spareWeighted');
    }
  });

  it('every ⚖ family still kills as cruelty — §9\'s desecration half is NOT wired here', () => {
    // §22.22 / A.2: killing The Judged should record desecration, but there is no desecration
    // action that is not named for shrines, so it needs a fifth KarmaAction — a design
    // addition, not a wiring. Pinned so the gap is a decision on record, not an oversight.
    for (const f of FAMILIES) {
      if (!f.karmaWeighted) continue;
      expect(f.onKill, f.id).toBe('killWeighted');
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
