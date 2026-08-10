import { describe, expect, it } from 'vitest';
import {
  ACT_XP_THRESHOLDS,
  FINAL_BOSS_NAME,
  FINAL_BOSS_XP,
  shouldAdvance,
  levelUpPlayer,
  cumulativeXpForLevel,
  levelForXp,
  hasPendingLevelUp,
  applyLevelUpHp,
} from './progression.ts';
import { createPlayer } from './player.ts';
import { type Stats } from './character.ts';
import { type Rng } from './rng.ts';

// A deterministic rng yielding a fixed sequence of floats (then 0), so the HP-roll
// draw is forced and every expected value is hand-derived, never measured.
function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

// A stat set with every score = 13 (mod = floor((13-10)/2) = 1).
function stats(overrides: Partial<Stats> = {}): Stats {
  return { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13, ...overrides };
}

describe('ACT_XP_THRESHOLDS', () => {
  it('matches the spec thresholds literally', () => {
    expect(ACT_XP_THRESHOLDS).toEqual({ 2: 10, 3: 30, 4: 90, 5: 240 });
  });
});

describe('constants', () => {
  it('names the final boss and its scaling xp', () => {
    expect(FINAL_BOSS_NAME).toBe('Jorginho Matagal');
    expect(FINAL_BOSS_XP).toBe(300);
  });
});

describe('shouldAdvance', () => {
  // Gates written literally from the spec, not read from the module under test.
  const gates: ReadonlyArray<[number, number]> = [
    [1, 10],
    [2, 30],
    [3, 90],
    [4, 240],
  ];

  it('does not advance just below each gate but does at the gate', () => {
    for (const [act, gate] of gates) {
      expect(shouldAdvance(act, gate - 1)).toBe(false);
      expect(shouldAdvance(act, gate)).toBe(true);
    }
  });

  it('never advances from Act 5, even far past any gate', () => {
    expect(shouldAdvance(5, 1000)).toBe(false);
  });

  it('reports only the single next step (still true well past a gate)', () => {
    // xp 1000 in Act 1 clears every gate, but shouldAdvance only ever answers
    // "may I take one step from here"; the caller advances a single act per check.
    expect(shouldAdvance(1, 1000)).toBe(true);
    expect(shouldAdvance(2, 1000)).toBe(true);
  });
});

// ------- M9 XP curve (all values hand-derived from cumulativeXpForLevel(L) = L*(L-1)) ----

describe('cumulativeXpForLevel', () => {
  it('is L*(L-1): 1->0, 2->2, 3->6, 4->12, 5->20, 6->30, 10->90, 16->240', () => {
    const table: ReadonlyArray<[number, number]> = [
      [1, 0], [2, 2], [3, 6], [4, 12], [5, 20], [6, 30], [10, 90], [16, 240],
    ];
    for (const [L, xp] of table) expect(cumulativeXpForLevel(L)).toBe(xp);
  });
});

describe('levelForXp', () => {
  // Highest L>=1 with cumulativeXpForLevel(L) <= xp. Each expectation hand-derived from
  // the thresholds {L2:2, L3:6, L4:12, L5:20, L6:30, L10:90, L16:240}. (The plan's example
  // table listed 1->2 and 5->3, which are inconsistent with L*(L-1) under the highest-L
  // rule and with the design note "xp 10 -> level 3"; corrected here to the formula.)
  it('maps xp to the highest afforded level', () => {
    const table: ReadonlyArray<[number, number]> = [
      [0, 1], [1, 1], [2, 2], [5, 2], [6, 3], [10, 3], [11, 3], [12, 4], [20, 5], [30, 6],
      [90, 10], [240, 16],
    ];
    for (const [xp, L] of table) expect(levelForXp(xp)).toBe(L);
  });

  it('is consistent with cumulativeXpForLevel at every boundary', () => {
    for (let L = 1; L <= 20; L++) {
      const need = cumulativeXpForLevel(L);
      expect(levelForXp(need)).toBe(L);       // exactly enough -> that level
      if (L > 1) expect(levelForXp(need - 1)).toBe(L - 1); // one short -> previous level
    }
  });
});

describe('hasPendingLevelUp', () => {
  it('is true exactly when xp >= the NEXT level threshold', () => {
    // Level 1 player: next threshold cumulative(2) = 2.
    const p1 = { ...createPlayer({ name: 'A', classId: 'Enforcer', stats: stats() }), xp: 1, level: 1 };
    expect(hasPendingLevelUp(p1)).toBe(false); // 1 < 2
    expect(hasPendingLevelUp({ ...p1, xp: 2 })).toBe(true); // 2 >= 2
    // Level 2 player: next threshold cumulative(3) = 6.
    const p2 = { ...p1, level: 2, xp: 5 };
    expect(hasPendingLevelUp(p2)).toBe(false); // 5 < 6
    expect(hasPendingLevelUp({ ...p2, xp: 6 })).toBe(true); // 6 >= 6
  });
});

describe('applyLevelUpHp', () => {
  it('Enforcer d10, CON +1, die face 6 -> +7 maxHp; level+1; hp unchanged', () => {
    // Enforcer hitDie 1d10; stats() gives CON 13 -> mod +1. maxHp = 10 + 1 = 11.
    const player = createPlayer({ name: 'A', classId: 'Enforcer', stats: stats() });
    expect(player.maxHp).toBe(11);
    // rng 0.55 -> face 1 + floor(0.55*10) = 6. hpRoll = 6 + 1 = 7. maxHp 11 -> 18.
    const out = applyLevelUpHp(player, scriptedRng([0.55]));
    expect(out.hpRoll).toBe(7);
    expect(out.player.maxHp).toBe(18);
    expect(out.player.level).toBe(2);
    expect(out.player.hp).toBe(11); // NOT healed
    // Proficiency and hit-die quantity are NOT auto-grown (M9).
    expect(out.player.proficiency).toBe(2);
    expect(out.player.hitDie).toEqual({ quantity: 1, sides: 10 });
    // Purity: input untouched.
    expect(player.maxHp).toBe(11);
    expect(player.level).toBe(1);
  });

  it('floors the roll at 1 when die face + CON mod is non-positive', () => {
    // CON 3 -> mod -4. Enforcer maxHp = 10 + (-4) = 6. rng 0 -> face 1. roll = 1 + (-4) = -3
    // -> floored to 1. maxHp 6 -> 7.
    const player = createPlayer({ name: 'C', classId: 'Enforcer', stats: stats({ CON: 3 }) });
    expect(player.maxHp).toBe(6);
    const out = applyLevelUpHp(player, scriptedRng([0]));
    expect(out.hpRoll).toBe(1);
    expect(out.player.maxHp).toBe(7);
    expect(out.player.level).toBe(2);
  });
});

describe('levelUpPlayer', () => {
  it('CON-unchanged: adds max(1, dieFace + newConMod), leaves hp, bumps proficiency & hitDie', () => {
    // Enforcer: hitDie {1, d10}, initial maxHp = sides(10) + CONmod(1) = 11, hp = 11.
    const player = createPlayer({ name: 'A', classId: 'Enforcer', stats: stats() });
    expect(player.maxHp).toBe(11);
    expect(player.hp).toBe(11);

    // One d10 roll: face = 1 + floor(0.55 * 10) = 6. picks [STR, DEX] leave CON=13.
    // newConMod = 1 (unchanged), roll = 6 + 1 = 7, maxHp = 11 + 7 = 18, no CON bonus.
    const out = levelUpPlayer(player, ['STR', 'DEX'], 2, scriptedRng([0.55]));

    expect(out.stats.STR).toBe(14);
    expect(out.stats.DEX).toBe(14);
    expect(out.stats.CON).toBe(13);
    expect(out.mods.STR).toBe(2); // floor((14-10)/2) = 2
    expect(out.mods.DEX).toBe(2);
    expect(out.mods.CON).toBe(1); // unchanged
    expect(out.maxHp).toBe(18);
    expect(out.hp).toBe(11); // NOT healed
    expect(out.proficiency).toBe(3); // 2 -> 3
    expect(out.hitDie).toEqual({ quantity: 2, sides: 10 });
    // Purity: input untouched.
    expect(player.maxHp).toBe(11);
    expect(player.proficiency).toBe(2);
  });

  it('CON-changed: adds the extra (newAct - 1) HP bonus', () => {
    // picks [CON, CON] -> CON 13 -> 15 -> mod floor((15-10)/2) = 2.
    // face 6 (0.55), roll = 6 + newConMod(2) = 8, maxHp = 11 + 8 + (newAct-1=1) = 20.
    const player = createPlayer({ name: 'B', classId: 'Enforcer', stats: stats() });
    const out = levelUpPlayer(player, ['CON', 'CON'], 2, scriptedRng([0.55]));

    expect(out.stats.CON).toBe(15);
    expect(out.mods.CON).toBe(2);
    expect(out.maxHp).toBe(20);
    expect(out.hp).toBe(11);
  });

  it('floors the HP roll at 1 when dieFace + CON mod is non-positive', () => {
    // CON 3 -> mod floor((3-10)/2) = -4. Enforcer maxHp = 10 + (-4) = 6.
    // picks [STR, DEX] leave CON unchanged. die face = 1 (rng 0). roll = 1 + (-4) = -3
    // -> floored to 1. maxHp = 6 + 1 = 7, no CON bonus.
    const player = createPlayer({
      name: 'C',
      classId: 'Enforcer',
      stats: stats({ CON: 3 }),
    });
    expect(player.maxHp).toBe(6);
    const out = levelUpPlayer(player, ['STR', 'DEX'], 2, scriptedRng([0]));
    expect(out.maxHp).toBe(7);
  });

  it('into Act 3 rolls 2 dice (quantity carried from the prior act)', () => {
    // Simulate having reached Act 2 already: hitDie.quantity = 2. Into Act 3 the roll
    // is 2 d10. faces: 1 + floor(0.05*10)=1, 1 + floor(0.95*10)=10 -> sum 11.
    // picks [STR,DEX], CON unchanged (mod 1). roll = 11 + 1 = 12. maxHp += 12.
    const base = createPlayer({ name: 'D', classId: 'Enforcer', stats: stats() });
    const act2Player = { ...base, hitDie: { quantity: 2, sides: 10 } };
    const out = levelUpPlayer(act2Player, ['STR', 'DEX'], 3, scriptedRng([0.05, 0.95]));
    expect(out.maxHp).toBe(base.maxHp + 12);
    expect(out.hitDie).toEqual({ quantity: 3, sides: 10 });
  });
});
