// The balance report's CLAIMS about its own numbers (FINDINGS.md G28(c) + D9).
//
// Every expected value below is computed BY HAND from the fixture beside it, in the comment.
// The fixtures are deliberately tiny and hand-built, never a real `simulateBatch` output —
// running the sim and then asserting what it produced would prove only that the code agrees
// with itself, which is exactly the failure mode `docs/BALANCE-REPORT.md` had.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  act1Share,
  peakDeath,
  actsWithShare,
  actsAtOrAbove,
  bandVerdict,
  bandPhrase,
  extremeClasses,
  classesWithNoWin,
  STANDING_CAVEATS,
  TARGET_BAND,
} from './balance-claims.ts';

// 20 deaths: 10 in act 1, 5 in act 2, 5 in act 3, none later.
// Shares: 0.50, 0.25, 0.25, 0, 0.
const BUNCHED = { deaths: 20, deathByAct: { 1: 10, 2: 5, 3: 5, 4: 0, 5: 0 } };

describe('the death histogram claims', () => {
  it('act1Share is act 1 over the total', () => {
    expect(act1Share(BUNCHED)).toBe(10 / 20); // 0.5
  });

  it('peakDeath names the modal act and its share', () => {
    expect(peakDeath(BUNCHED)).toEqual({ act: 1, share: 0.5 });
  });

  it('actsWithShare counts the acts at or above the threshold', () => {
    // 0.50, 0.25 and 0.25 clear 0.1; the two zeroes do not.
    expect(actsWithShare(BUNCHED, 0.1)).toBe(3);
    // At 0.3 only act 1 clears it.
    expect(actsWithShare(BUNCHED, 0.3)).toBe(1);
    // At exactly 0.25 acts 1, 2 and 3 all clear it — the boundary is INCLUSIVE.
    expect(actsWithShare(BUNCHED, 0.25)).toBe(3);
  });

  it('actsAtOrAbove NAMES them, so the report never hard-codes a range', () => {
    expect(actsAtOrAbove(BUNCHED, 0.1)).toEqual([1, 2, 3]);
    expect(actsAtOrAbove(BUNCHED, 0.3)).toEqual([1]);
    expect(actsAtOrAbove(BUNCHED, 0.9)).toEqual([]);
  });

  it('a spread histogram reads differently — the fixture is not doing the work', () => {
    // 20 deaths spread 4 per act. Every share is 0.2, so all five clear 0.1 and the modal
    // act is the FIRST one, by the documented tie rule.
    const spread = { deaths: 20, deathByAct: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 } };
    expect(act1Share(spread)).toBe(0.2);
    expect(actsWithShare(spread, 0.1)).toBe(5);
    expect(peakDeath(spread)).toEqual({ act: 1, share: 0.2 });
  });

  it('a sample with NO deaths never divides by zero', () => {
    const none = { deaths: 0, deathByAct: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    expect(act1Share(none)).toBe(0);
    expect(actsWithShare(none, 0.1)).toBe(0);
    expect(actsAtOrAbove(none, 0.1)).toEqual([]);
    expect(peakDeath(none)).toEqual({ act: 1, share: 0 });
  });
});

describe('the difficulty-band verdict', () => {
  it('judges a rate against the 25–35% target', () => {
    expect(TARGET_BAND).toEqual({ min: 0.25, max: 0.35 });
    expect(bandVerdict(0.4)).toBe('above');
    expect(bandVerdict(0.3)).toBe('in');
    expect(bandVerdict(0.1)).toBe('below');
  });

  it('treats both boundaries as inside the band', () => {
    // "the 25–35% band" reads as inclusive; stating it explicitly stops the two ends being
    // decided by whichever comparison someone typed.
    expect(bandVerdict(0.25)).toBe('in');
    expect(bandVerdict(0.35)).toBe('in');
    expect(bandVerdict(0.2499)).toBe('below');
    expect(bandVerdict(0.3501)).toBe('above');
  });

  it('renders each verdict as a distinct headline word', () => {
    const words = (['below', 'in', 'above'] as const).map(bandPhrase);
    expect(words).toEqual(['BELOW THE BAND', 'MET', 'ABOVE THE BAND']);
    expect(new Set(words).size).toBe(3); // no two verdicts read the same
  });

  it('the CURRENT build would not be reported as MET', () => {
    // The point of the whole exercise. `balance.test.ts` measures ~0.126 today, which is
    // half the band's floor — and the report hard-coded "MET" beside it.
    expect(bandVerdict(0.126)).toBe('below');
    expect(bandPhrase(bandVerdict(0.126))).not.toBe('MET');
  });
});

describe('the per-class claims', () => {
  // Win-rates: Scavver highest at 0.5, Neuromancer lowest at 0.1.
  const REPORT = {
    classes: ['Enforcer', 'Neuromancer', 'Scavver', 'Penitent', 'Hollow'],
    perClass: {
      Enforcer: { winRate: 0.3, wins: 30 },
      Neuromancer: { winRate: 0.1, wins: 10 },
      Scavver: { winRate: 0.5, wins: 50 },
      Penitent: { winRate: 0.2, wins: 20 },
      Hollow: { winRate: 0.15, wins: 15 },
    },
  };

  it('names the strongest and the weakest', () => {
    expect(extremeClasses(REPORT)).toEqual({ strongest: 'Scavver', weakest: 'Neuromancer' });
  });

  it('follows the DATA, not a remembered answer', () => {
    // The report used to assert Scavver strongest and Neuromancer weakest as fixed prose.
    // Invert the fixture and the claim must invert with it.
    const flipped = {
      ...REPORT,
      perClass: { ...REPORT.perClass, Scavver: { winRate: 0.05, wins: 5 }, Neuromancer: { winRate: 0.9, wins: 90 } },
    };
    expect(extremeClasses(flipped)).toEqual({ strongest: 'Neuromancer', weakest: 'Scavver' });
  });

  it('breaks a tie by roster order, so the report is reproducible', () => {
    const tied = {
      classes: ['Enforcer', 'Hollow'],
      perClass: { Enforcer: { winRate: 0.2, wins: 2 }, Hollow: { winRate: 0.2, wins: 2 } },
    };
    expect(extremeClasses(tied)).toEqual({ strongest: 'Enforcer', weakest: 'Enforcer' });
  });

  it('reports an empty roster as no claim at all, rather than a wrong one', () => {
    expect(extremeClasses({ classes: [], perClass: {} })).toBeNull();
  });

  it('names the classes stuck at zero wins', () => {
    expect(classesWithNoWin(REPORT)).toEqual([]);
    const stuck = {
      ...REPORT,
      perClass: { ...REPORT.perClass, Penitent: { winRate: 0, wins: 0 }, Hollow: { winRate: 0, wins: 0 } },
    };
    // In roster order, so the sentence is deterministic.
    expect(classesWithNoWin(stuck)).toEqual(['Penitent', 'Hollow']);
  });
});

// =========================================================================================
// D9 — the caveats are emitted by the GENERATOR, so regeneration cannot delete them.
// =========================================================================================

const GENERATOR = readFileSync(
  fileURLToPath(new URL('./balance-report.ts', import.meta.url)),
  'utf8',
);
/** With comments stripped: the guards below hunt for phrases the PROSE legitimately names. */
const GENERATOR_CODE = GENERATOR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('D9 — the report cannot silently lose its caveats', () => {
  it('the PROVENANCE BLOCK itself maps over them', () => {
    // Not merely "the file mentions STANDING_CAVEATS somewhere" — the import line alone
    // would satisfy that, and deleting the one line that prints them would go unnoticed.
    // The function that builds the block has to be the thing that reads them.
    expect(STANDING_CAVEATS.length).toBeGreaterThan(0);
    const start = GENERATOR_CODE.indexOf('function provenance(');
    expect(start, 'the generator has no provenance block — that IS D9').toBeGreaterThan(-1);
    const end = GENERATOR_CODE.indexOf('\n}', start);
    const body = GENERATOR_CODE.slice(start, end);
    expect(body, 'the provenance block no longer prints the standing caveats').toMatch(
      /STANDING_CAVEATS/,
    );
    // ...and the block is actually EMITTED into the document, not merely defined. The
    // lookbehind is what makes this real: without it the function's own declaration
    // (`function provenance(): string`) satisfies the pattern, and deleting the one call
    // site that prints it passes — which is exactly D9 happening again, one level up.
    expect(
      GENERATOR_CODE,
      'the provenance block is defined but never emitted into the report',
    ).toMatch(/(?<!function\s)\bprovenance\s*\(\s*\)/);
  });

  it('every caveat is non-empty, has an id, and says something a reader can act on', () => {
    const ids = STANDING_CAVEATS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    for (const c of STANDING_CAVEATS) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(40);
    }
  });

  it('one of them tells the reader NOT to hand-edit the output — that IS D9', () => {
    // The banner that was lost was hand-added to the generated file. The replacement has to
    // say where a lasting caveat actually goes, or the same thing happens again. Asserted on
    // the ONE caveat that carries the instruction, so retitling or deleting it is caught —
    // scanning the joined text would let any other caveat happen to satisfy it.
    const d9 = STANDING_CAVEATS.find((c) => c.id === 'D9');
    expect(d9, "the D9 caveat is gone — nothing tells the reader where caveats live").toBeDefined();
    expect(d9!.text).toMatch(/balance-claims\.ts/);
    expect(d9!.text.toLowerCase()).toMatch(/hand-edit|do not edit/);
  });
});

describe('G28(c) — no verdict is written by hand in the generator', () => {
  it('hard-codes none of the claims it used to assert', () => {
    // Each pattern is the SHAPE of a claim, not one remembered sentence, and each is matched
    // case-insensitively so a re-worded version is caught too.
    const HARD_CODED = [
      /Acts?\s*1[–-]4\s*each\s*hold/i, // "Acts 1–4 each hold ≥ 10% of deaths"
      /and\s+MET\b/i, //                   "Difficulty TARGET — SET (M15) and MET"
      /Result\s*—\s*MET/i, //              "**Result — MET.**"
      /Scavver[^`]{0,40}strongest/i, //    "Scavver … makes it the strongest class"
      /lowest\s+baseline\s+win-rate\s+is\s+\w+\b(?!\$)/i, // "…is Neuromancer" as a literal
      /\(in band\)/i,
    ];
    for (const pattern of HARD_CODED) {
      expect(GENERATOR_CODE, `a hard-coded claim matching ${pattern} is back`).not.toMatch(
        pattern,
      );
    }
  });

  it('and DOES call the computed helpers instead', () => {
    // Without this, the test above would pass on a generator that simply stopped making
    // claims at all — or on an empty file.
    for (const fn of ['bandVerdict', 'bandPhrase', 'extremeClasses', 'classesWithNoWin', 'actsAtOrAbove']) {
      expect(GENERATOR_CODE, `${fn} is no longer used`).toMatch(new RegExp(`\\b${fn}\\s*\\(`));
    }
  });
});
