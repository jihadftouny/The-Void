// The §16.1 TEMPO GAUGE — pure integer arithmetic, framework-agnostic game logic (PLAN.md #1.6).
//
// LOAD-BEARING PRINCIPLES honoured here:
//  - Pure logic / render split: no Kaplay, DOM or canvas; no logger. Two functions of plain data.
//  - Deterministic seeded RNG: the gauge draws NOTHING — §16.1's own selling point. A round's
//    tempo is a function of the combatants' stats and conditions alone.
//  - Serializable plain-data state: the gauge is one small integer per combatant, stored on the
//    battle (`BattleState.tempo`), never on the player, so it cannot leak into the next fight.
//  - Data-driven content: an enemy family's own speed is DATA (`enemyFamilies.json`,
//    `theme.speedTenths`) handed in by the caller; nothing here names a family.
//
// GAME-DESIGN.md §16.1: one number per combatant, moved each round by a rate set by Dexterity
// (and Quick/Slow). At +1.0 the combatant takes an EXTRA ACTION and the threshold is spent (the
// remainder carries); at −1.0 it LOSES its turn and the threshold is spent.
//
// RECORDED DEVIATIONS (PRINCIPLES §A12; also in FINDINGS.md's G62 row):
//  1. TENTHS, NOT DECIMALS. A gauge that ADDS 0.1 ten times in binary floating point reaches
//     `0.9999999999999999`, so a `>= 1.0` threshold would MISS the tenth round of a DEX-12 character. Every value here is an
//     integer count of tenths (+4 = +0.4); every comparison is exact and every saved value small.
//     The renderer divides by ten at its edge.
//  2. THE QUICK/SLOW AUGMENT'S OWN ±2 DEX IS EXCLUDED FROM THE RATE. §16.1's table reads
//     `18 + Quick → +0.7`: +0.4 from DEX 18 and +0.3 from Quick. The `quick` condition also adds
//     +2 DEX (= +1 mod) through `statEffects.ts`; counted, the row would read +0.8. The rate
//     therefore reads the DEX of the stored stat plus gear (`baseStatMod`) and adds the flat ±3.
//     The augment's +2 keeps its evasion effect on AC, unchanged.
//  3. AN ENEMY-ONLY RATE CAP, ±0.3 (`TEMPO_RATE_CAP_TENTHS`) — the AUTHOR'S RULINGS, 2026-09-26.
//     `enemy.ts` inflates enemy stats with the player's XP (an inherited Java formula, FINDINGS
//     G77), so from floor 3 on an enemy's DEX reaches 27–108 and §16.1's literal rate (+0.8 to
//     +4.9) gives it an extra action nearly every round. The build first shipped ±0.7 (the
//     largest magnitude in §16.1's own table) on both sides; measured, that held the winnability
//     anchor at 0.182 against its 0.20 floor. The author chose ±0.3 (second round), on the
//     COMBINED enemy rate, family speed included — and then (third round, G78) ruled that it
//     applies to ENEMIES ONLY: the player gets §16.1's full rate, uncapped (DEX 18 + Quick →
//     +0.7). `battle.ts` passes the cap for the enemy's rate and `Infinity` for the player's.
//  4. AN ENEMY FAMILY'S OWN SPEED (author, 2026-09-26): an enemy's rate is its DEX-driven rate
//     exactly like the player's, PLUS its family's `speedTenths` from the data. The player has
//     no family, so passes 0.
//
// Two smaller choices where §16.1 is silent, recorded rather than asked:
//  - A CONTROLLED combatant's gauge still drifts, but spends no threshold (`canAct` false).
//  - At most ONE threshold crossing per round. It bites in two ways. (a) A rate of 10 or more
//    — the uncapped measurement seam, or a player with DEX 30+ — would otherwise act three times
//    a round. (b) A CONTROLLED side's gauge keeps drifting without spending (above), so it can
//    bank past the threshold at any rate: a DEX-18 player (+4) stunned for four rounds holds
//    4, 8, 12, 16; freed, it reaches 20, takes ONE extra action, and carries 10 into the next
//    round — which crosses again (10 + 4 = 14 → 4). The banked surplus is paid out one extra
//    action per round, never several at once.

import { baseStatMod, type Conditioned } from './statEffects.ts';

/** §16.1: ±1.0 — the gauge value at which an extra action is granted or a turn is lost. */
export const TEMPO_THRESHOLD_TENTHS = 10;
/** §16.1: DEXmod × 0.1 — "a starting proposal, not a tuned number". */
export const TEMPO_TENTHS_PER_DEX_MOD = 1;
/** §16.1: +0.3 while Quick. */
export const TEMPO_QUICK_TENTHS = 3;
/** §16.1: −0.3 while Slow. */
export const TEMPO_SLOW_TENTHS = -3;
/** DEVIATION 3 above (author's rulings): an ENEMY's |rate| never exceeds 0.3 on the shipped path. Measurement may lift it. */
export const TEMPO_RATE_CAP_TENTHS = 3;

/**
 * One combatant's rate this round, in tenths — PURE, RNG-FREE.
 *
 *   rate = DEX mod (stored DEX + gear, NOT the Quick/Slow augment's ±2) × 1
 *        + 3 while Quick, − 3 while Slow
 *        + `speedTenths` (an enemy family's data-driven speed; 0 for the player)
 *   clamped to ±`capTenths`.
 */
export function tempoRate(char: Conditioned, capTenths: number, speedTenths = 0): number {
  let rate = baseStatMod(char, 'DEX') * TEMPO_TENTHS_PER_DEX_MOD + speedTenths;
  if (char.activeConditions.some((c) => c.type === 'quick')) rate += TEMPO_QUICK_TENTHS;
  if (char.activeConditions.some((c) => c.type === 'slow')) rate += TEMPO_SLOW_TENTHS;
  return Math.max(-capTenths, Math.min(capTenths, rate));
}

/** One round's movement of one combatant's gauge. */
export interface TempoStep {
  /** The gauge after the move (and after any threshold was spent), in tenths. */
  tenths: number;
  /** How many actions the combatant takes this round: 0 (lost or controlled), 1, or 2. */
  actions: 0 | 1 | 2;
  /** Which threshold was crossed and spent this round, if any. */
  crossed: 'extra' | 'lost' | null;
}

/**
 * Move one gauge by one round — PURE, RNG-FREE.
 *
 * `canAct` false (a control condition holds the combatant) ⇒ the gauge still drifts by `rate`
 * but NO threshold is spent and `actions` is 0; the crossing waits for a round it can act in.
 * Otherwise at most one threshold is crossed: ≥ +1.0 → an extra action, the threshold spent;
 * ≤ −1.0 → the turn is lost, the threshold spent.
 */
export function advanceTempo(tenths: number, rate: number, canAct: boolean): TempoStep {
  const next = tenths + rate;
  if (!canAct) return { tenths: next, actions: 0, crossed: null };
  if (next >= TEMPO_THRESHOLD_TENTHS) {
    return { tenths: next - TEMPO_THRESHOLD_TENTHS, actions: 2, crossed: 'extra' };
  }
  if (next <= -TEMPO_THRESHOLD_TENTHS) {
    return { tenths: next + TEMPO_THRESHOLD_TENTHS, actions: 0, crossed: 'lost' };
  }
  return { tenths: next, actions: 1, crossed: null };
}
