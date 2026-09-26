// The §16.1 tempo gauge as pure arithmetic (PLAN.md #1.6, AC-8/9/10/13/14 at unit level).
//
// Every expected value is derived BY HAND in the comment beside it, from:
//   computeStatMod(s) = floor((s − 10) / 2)
//   rate (tenths)     = DEX mod + 3 (Quick) − 3 (Slow) + family speed, clamped to ±cap
//   the gauge         = previous + rate; ≥ +10 → extra action, −10; ≤ −10 → lost turn, +10
// and from GAME-DESIGN.md §16.1's own table rows. Nothing below is read off the module.

import { describe, expect, it } from 'vitest';
import {
  TEMPO_QUICK_TENTHS,
  TEMPO_RATE_CAP_TENTHS,
  TEMPO_SLOW_TENTHS,
  TEMPO_THRESHOLD_TENTHS,
  advanceTempo,
  tempoRate,
} from './tempo.ts';
import { baseStatMod, effectiveMods, type Conditioned } from './statEffects.ts';
import { makeCondition, type ConditionType } from './condition.ts';
import { computeStatMod, type Stats } from './character.ts';
import { createPlayer } from './player.ts';
import { inventoryWithGear } from './equipment.ts';

/** A plain combatant with the given DEX and conditions — no gear, every other stat 10. */
function fighter(dex: number, conditions: ConditionType[] = []): Conditioned {
  const stats: Stats = { STR: 10, DEX: dex, CON: 10, INT: 10, WIS: 10, CHA: 10 };
  return {
    name: 'Subject',
    stats,
    mods: { STR: 0, DEX: computeStatMod(dex), CON: 0, INT: 0, WIS: 0, CHA: 0 },
    hp: 10,
    maxHp: 10,
    xp: 0,
    armorClass: 10,
    skillCharges: 0,
    maxSkillCharges: 0,
    hitDie: { quantity: 1, sides: 8 },
    activeConditions: conditions.map(makeCondition),
  };
}

/** Run `rounds` rounds from 0 at a fixed rate, every round free to act. */
function run(rate: number, rounds: number): { gauge: number[]; extra: number[]; lost: number[] } {
  let t = 0;
  const gauge: number[] = [];
  const extra: number[] = [];
  const lost: number[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const s = advanceTempo(t, rate, true);
    t = s.tenths;
    gauge.push(t);
    if (s.crossed === 'extra') extra.push(round);
    if (s.crossed === 'lost') lost.push(round);
  }
  return { gauge, extra, lost };
}

describe('the constants are §16.1’s numbers, in tenths', () => {
  it('±1.0 threshold, ±0.3 Quick/Slow, a ±0.7 cap', () => {
    expect(TEMPO_THRESHOLD_TENTHS).toBe(10);
    expect(TEMPO_QUICK_TENTHS).toBe(3);
    expect(TEMPO_SLOW_TENTHS).toBe(-3);
    expect(TEMPO_RATE_CAP_TENTHS).toBe(7);
  });
});

describe('tempoRate — §16.1’s table, row by row', () => {
  const CAP = TEMPO_RATE_CAP_TENTHS;
  it('DEX 10 → 0; DEX 12 → +0.1; DEX 18 → +0.4; DEX 6 → −0.2', () => {
    expect(tempoRate(fighter(10), CAP)).toBe(0); // floor(0/2) = 0
    expect(tempoRate(fighter(12), CAP)).toBe(1); // floor(2/2) = 1
    expect(tempoRate(fighter(18), CAP)).toBe(4); // floor(8/2) = 4
    expect(tempoRate(fighter(6), CAP)).toBe(-2); // floor(−4/2) = −2
  });

  it('18 + Quick → +0.7 to the digit: the augment’s own +2 DEX is NOT counted a second time', () => {
    const quick = fighter(18, ['quick']);
    expect(tempoRate(quick, CAP)).toBe(7); // 4 + 3
    // Proof the +2 DEX is live elsewhere (it still reaches AC and to-hit): the effective mod is 5.
    expect(effectiveMods(quick).DEX).toBe(5); // floor((20 − 10)/2)
    expect(baseStatMod(quick, 'DEX')).toBe(4); // the stored 18 only
  });

  it('10 + Slow → −0.3; Quick and Slow together cancel', () => {
    expect(tempoRate(fighter(10, ['slow']), CAP)).toBe(-3);
    expect(tempoRate(fighter(14, ['quick', 'slow']), CAP)).toBe(2); // 2 + 3 − 3
  });

  it('a family speed adds on top of Dexterity, then the cap applies to the SUM', () => {
    expect(tempoRate(fighter(14), CAP, 2)).toBe(4); // 2 + 2
    expect(tempoRate(fighter(14), CAP, -2)).toBe(0); // 2 − 2
    expect(tempoRate(fighter(18, ['quick']), CAP, 2)).toBe(7); // 4 + 3 + 2 = 9 → capped at 7
    expect(tempoRate(fighter(6, ['slow']), CAP, -2)).toBe(-7); // −2 − 3 − 2 = −7 (exactly the cap)
    expect(tempoRate(fighter(4, ['slow']), CAP, -2)).toBe(-7); // −3 − 3 − 2 = −8 → −7
  });

  it('the cap bites inflated stats; Infinity lifts it (the measurement seam)', () => {
    expect(tempoRate(fighter(40), CAP)).toBe(7); // mod 15 → capped
    expect(tempoRate(fighter(40), Infinity)).toBe(15);
    expect(tempoRate(fighter(1), CAP)).toBe(-5); // floor(−9/2) = −5: under the cap, untouched
  });

  it('reads gear through baseStatMod (a stored-stat + equipment mod)', () => {
    // hollow-ring is +1 CON (items.json). CON 13 → mod 1; +1 → 14 → mod 2.
    const p = createPlayer({ name: 'P', classId: 'Enforcer', stats: { STR: 10, DEX: 10, CON: 13, INT: 10, WIS: 10, CHA: 10 } });
    const ringed = { ...p, inventory: inventoryWithGear({ ring: 'hollow-ring' }) };
    expect(baseStatMod(ringed, 'CON')).toBe(2);
    expect(baseStatMod(p, 'CON')).toBe(1);
  });
});

describe('advanceTempo — ten real rounds per §16.1 row', () => {
  it('DEX 10: never moves, never crosses', () => {
    const r = run(0, 10);
    expect(r.gauge).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.extra).toEqual([]);
    expect(r.lost).toEqual([]);
  });

  it('DEX 18 (+4): 4, 8, 12→2, 6, 10→0, 4, 8, 12→2, 6, 10→0 — extras on rounds 3, 5, 8, 10', () => {
    const r = run(4, 10);
    expect(r.gauge).toEqual([4, 8, 2, 6, 0, 4, 8, 2, 6, 0]);
    expect(r.extra).toEqual([3, 5, 8, 10]);
    expect(r.lost).toEqual([]);
  });

  it('DEX 6 (−2): −2, −4, −6, −8, −10→0 … — turns lost on rounds 5 and 10', () => {
    const r = run(-2, 10);
    expect(r.gauge).toEqual([-2, -4, -6, -8, 0, -2, -4, -6, -8, 0]);
    expect(r.lost).toEqual([5, 10]);
    expect(r.extra).toEqual([]);
  });

  it('18 + Quick (+7): extras on 2, 3, 5, 6, 8, 9, 10 — "almost every other round"', () => {
    // 7, 14→4, 11→1, 8, 15→5, 12→2, 9, 16→6, 13→3, 10→0. Seventy tenths over ten rounds is
    // exactly seven crossings. (The plan's AC-10 listed six, dropping round 10 — where the gauge
    // lands on +1.0 exactly, which §16.1's "at +1.0" counts. Recorded as a plan correction.)
    const r = run(7, 10);
    expect(r.gauge).toEqual([7, 4, 1, 8, 5, 2, 9, 6, 3, 0]);
    expect(r.extra).toEqual([2, 3, 5, 6, 8, 9, 10]);
  });

  it('10 + Slow (−3): turns lost on rounds 4, 7, 10 — "one every ~3 rounds"', () => {
    // −3, −6, −9, −12→−2, −5, −8, −11→−1, −4, −7, −10→0
    const r = run(-3, 10);
    expect(r.gauge).toEqual([-3, -6, -9, -2, -5, -8, -1, -4, -7, 0]);
    expect(r.lost).toEqual([4, 7, 10]);
  });

  it('TENTHS ARE EXACT: +0.1 a round crosses on round 10 exactly (a float gauge would miss)', () => {
    // The trap the integers avoid: a gauge that ADDS 0.1 each round sums to 0.9999999999999999
    // after ten rounds, so a `>= 1.0` check never fires.
    let floatGauge = 0;
    for (let i = 0; i < 10; i += 1) floatGauge += 0.1;
    expect(floatGauge >= 1.0).toBe(false);
    const r = run(1, 10);
    expect(r.extra).toEqual([10]);
    expect(r.gauge[9]).toBe(0);
  });

  it('the remainder carries: 9 + 4 = 13 → extra, 3 left', () => {
    expect(advanceTempo(9, 4, true)).toEqual({ tenths: 3, actions: 2, crossed: 'extra' });
    expect(advanceTempo(-8, -3, true)).toEqual({ tenths: -1, actions: 0, crossed: 'lost' });
    expect(advanceTempo(2, 3, true)).toEqual({ tenths: 5, actions: 1, crossed: null });
  });
});

describe('advanceTempo — the two recorded choices', () => {
  it('a CONTROLLED combatant drifts but spends no threshold, and crosses the round it is free', () => {
    // DEX 18 held on round 3: 8 + 4 = 12, no extra, 0 actions. Round 4 free: 12 + 4 = 16 → extra, 6.
    const held = advanceTempo(8, 4, false);
    expect(held).toEqual({ tenths: 12, actions: 0, crossed: null });
    expect(advanceTempo(held.tenths, 4, true)).toEqual({ tenths: 6, actions: 2, crossed: 'extra' });
    // ...and the same on the slow side: held at −12, then lost when free.
    expect(advanceTempo(-8, -4, false)).toEqual({ tenths: -12, actions: 0, crossed: null });
  });

  it('at most one crossing per round, even when the cap is lifted', () => {
    // rate 25 (the spec-literal measurement): 25 → ONE extra, 15 carried — not two or three.
    expect(advanceTempo(0, 25, true)).toEqual({ tenths: 15, actions: 2, crossed: 'extra' });
    expect(advanceTempo(0, -25, true)).toEqual({ tenths: -15, actions: 0, crossed: 'lost' });
  });

  it('the cap on round 1: DEX 40 capped (+7) crosses on round 2; uncapped (+15) on round 1', () => {
    const capped = run(tempoRate(fighter(40), TEMPO_RATE_CAP_TENTHS), 2);
    expect(capped.gauge).toEqual([7, 4]);
    expect(capped.extra).toEqual([2]);
    const literal = run(tempoRate(fighter(40), Infinity), 1);
    expect(literal.extra).toEqual([1]);
    expect(literal.gauge).toEqual([5]);
  });
});
