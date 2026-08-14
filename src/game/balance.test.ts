// M15 balance ANCHOR tests — observable guards on the tuned constants (pure, headless).
//
// These are the two committed anchors the M15 tuning must not silently regress:
//   1. Act-1 "hits-to-kill" — a fresh Act-1 enemy dies in ~3-4 Fight actions (author's feel spec).
//   2. Winnability regression guard — the baseline sim is winnable and deaths are NOT bunched at
//      Act 1 (the two goals of this pass), asserted over a small, fast seed sample.
//
// Every expected band is DERIVED from the design spec + weapon/HP arithmetic, NOT read back from
// the implementation: each would go RED against the pre-M15 build (30-HP enemies, 0% win, 98%
// Act-1 deaths), so the tests disagree with the broken world, not merely with themselves.

import { describe, expect, it } from 'vitest';
import { createPlayer, type PlayerClass } from './player.ts';
import { generateEnemy, ENEMY_BASE_HP } from './enemy.ts';
import { resolvePlayerAttack } from './combat.ts';
import { weaponForSlot, UNARMED } from './equipment.ts';
import { mulberry32 } from './rng.ts';
import { STAT_KEYS, type Stats } from './character.ts';
import { simulateBatch, heuristicPolicy, ALL_CLASSES } from './sim.ts';

// ------- Anchor 1: Act-1 hits-to-kill --------------------------------------------------------

/**
 * A neutral pinned stat set (all 12 -> mod +1) so the anchor measures the WEAPON/enemy-HP
 * relationship, not stat-roll variance. This is the "pinned fresh player" the plan calls for.
 */
function pinnedStats(): Stats {
  const s = {} as Stats;
  for (const key of STAT_KEYS) s[key] = 12;
  return s;
}

/**
 * Mean number of Fight actions to reduce ONE fresh Act-1 enemy (playerXp 0) to 0 HP, for `classId`,
 * over the fixed `seeds`. The player fights with its REAL starting weapon at the random-battle
 * advantage (`advantageDisadvantage = 1`, as encounter.ts sets). The enemy is regenerated from a
 * FIXED rng each seed, so its HP is constant (10 at xp 0) and all variance comes from the player's
 * attack rolls — exactly the quantity the author's "~3-4 hits" describes.
 */
function meanHitsToKill(classId: PlayerClass, seeds: number[]): number {
  const player = { ...createPlayer({ name: 'Anchor', classId, stats: pinnedStats() }), advantageDisadvantage: 1 };
  const weapon = weaponForSlot(player.inventory) ?? UNARMED;
  let total = 0;
  for (const seed of seeds) {
    const attackRng = mulberry32(seed);
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(999));
    // Independent oracle: at playerXp 0 both HP scaling terms are 0, so maxHp == ENEMY_BASE_HP.
    expect(enemy.maxHp).toBe(ENEMY_BASE_HP);
    let hp = enemy.maxHp;
    let actions = 0;
    while (hp > 0 && actions < 50) {
      const r = resolvePlayerAttack(player, { ...enemy, hp }, weapon, 0, attackRng);
      hp -= r.damage;
      actions++;
    }
    total += actions;
  }
  return total / seeds.length;
}

describe('M15 anchor — a fresh Act-1 enemy takes ~3-4 Fight actions to kill', () => {
  const seeds = Array.from({ length: 80 }, (_, i) => i + 1);

  // Independent derivation of the bands (enemy = ENEMY_BASE_HP = 10 at xp 0; player at advantage
  // ~0.9 land rate; melee/finesse weapons add NO stat mod to DAMAGE — only the die — see combat.ts):
  //  - d6 sword / d8 rapier: avg 3.5-4.5 dmg/hit -> 10 / (3.5..4.5) ≈ 2.2-2.9 landed hits, ÷0.9
  //    ≈ 2.5-3.2, plus discrete/miss variance -> lands in the author's [3, 4].
  //  - d4 gun: avg 2.5 dmg/hit -> 10 / 2.5 = 4 landed hits ÷0.9 ≈ 4.4 -> ~1 action slower than the
  //    author's spec because the starting GUN is a weak 1d4 (a documented starting-weapon quirk;
  //    see the return note / BALANCE-REPORT). So the ranged classes hold the looser [3, 5].
  // Both bands FAIL the pre-M15 30-HP enemy (which needed ~9-13 actions, far above 5).

  const MELEE_FINESSE: PlayerClass[] = ['Enforcer', 'Scavver', 'Penitent'];
  const RANGED: PlayerClass[] = ['Neuromancer', 'Hollow'];

  for (const c of MELEE_FINESSE) {
    it(`${c} (melee/finesse) kills a fresh Act-1 enemy in the author's [3, 4] Fight actions`, () => {
      const mean = meanHitsToKill(c, seeds);
      expect(mean).toBeGreaterThanOrEqual(3);
      expect(mean).toBeLessThanOrEqual(4);
    });
  }

  for (const c of RANGED) {
    it(`${c} (1d4 gun) kills a fresh Act-1 enemy in [3, 5] Fight actions (weak starting weapon)`, () => {
      const mean = meanHitsToKill(c, seeds);
      expect(mean).toBeGreaterThanOrEqual(3);
      expect(mean).toBeLessThanOrEqual(5);
    });
  }

  it('no class is outside the overall author band [3, 5] (catches a gross HP/weapon mis-tune)', () => {
    for (const c of ALL_CLASSES) {
      const mean = meanHitsToKill(c, seeds);
      expect(mean).toBeGreaterThanOrEqual(3);
      expect(mean).toBeLessThanOrEqual(5);
    }
  });
});

// ------- Anchor 2: winnability regression guard ----------------------------------------------

describe('M15 anchor — the baseline sim is winnable and deaths are not bunched at Act 1', () => {
  it('overall win-rate > 0.12 AND Act-1 death share < 0.55 (heuristic policy, seeds 1..100 × 5)', () => {
    const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
    const report = simulateBatch({
      seeds,
      classes: [...ALL_CLASSES],
      policy: (c: PlayerClass) => heuristicPolicy(c),
    });

    // Directional thresholds derived from the target (win band 25-35%, deaths spread): a weaker,
    // stable guard that both FAIL against the pre-M15 build (0% win, 98% Act-1 deaths).
    expect(report.winRate).toBeGreaterThan(0.12);

    const act1Share = report.deaths > 0 ? (report.deathByAct[1] ?? 0) / report.deaths : 1;
    expect(act1Share).toBeLessThan(0.55);

    // No class stuck at ~0%: every class wins at least once over the sample.
    for (const c of ALL_CLASSES) {
      expect(report.perClass[c].wins).toBeGreaterThan(0);
    }
  });
});
