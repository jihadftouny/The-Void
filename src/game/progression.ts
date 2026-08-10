// Act progression + level-up for The Void — pure, framework-agnostic game logic (M8).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports; nothing is
//    printed. `levelUpPlayer` returns a NEW Player and never mutates its input.
//  - Deterministic seeded RNG: the only randomness (the level-up HP roll) threads
//    the injected `Rng`; no Math.random / Date.now.
//  - Serializable plain-data state: operates on and returns the flat `Player` record.
//
// Ported from `GameLogic.checkAct` (the act gates) and the level-up path Java split
// across `Player.levelUp` + `Character.setMods` (the `isLevelUp` branch). Recorded
// faithful choices (see plan open questions, all confirmed):
//  - Level-up raises maxHp but does NOT heal (hp is left unchanged).
//  - armorClass is NOT recomputed on level-up (Java's setMods never touches it).

import {
  computeStatMods,
  type StatKey,
} from './character.ts';
import { rollDice, rollDie, type Rng } from './rng.ts';
import { type Player } from './player.ts';

/**
 * XP required to enter each Act, keyed by the Act being entered (Java
 * `GameLogic.checkAct`): Act 2 at 10, Act 3 at 30, Act 4 at 90, Act 5 at 240.
 */
export const ACT_XP_THRESHOLDS: Readonly<Record<number, number>> = {
  2: 10,
  3: 30,
  4: 90,
  5: 240,
};

/** The five floor names, index = place (0..4), from Java `GameLogic.places`. */
export const PLACES: readonly string[] = [
  'First Floor',
  'Second Floor',
  'Third Floor',
  'Fourth Floor',
  'Fifth Floor',
];

/** The final boss's name and the player-xp used to scale it (Java `finalBattle`). */
export const FINAL_BOSS_NAME = 'Jorginho Matagal';
export const FINAL_BOSS_XP = 300;

/**
 * Whether the player, currently in `act` with `xp`, has earned entry to the NEXT
 * Act: true iff `act < 5` and `xp >= ACT_XP_THRESHOLDS[act + 1]`. Only ever reports
 * a single step; the caller advances one act per check (Java's if/else-if chain).
 */
export function shouldAdvance(act: number, xp: number): boolean {
  if (act >= 5) return false;
  const threshold = ACT_XP_THRESHOLDS[act + 1];
  return threshold !== undefined && xp >= threshold;
}

// ------- M9 frequent XP leveling (decoupled from act-entry) -------------------
//
// The XP curve below is a deliberate M15 PLACEHOLDER. It is single-sourced here so
// swapping the formula touches only this module + its test. Leveling is independent of
// `ACT_XP_THRESHOLDS` / `shouldAdvance` (which still gate the 5-floor / final-boss flow).

/**
 * Cumulative XP required to REACH `level` — `level * (level - 1)` (M15 placeholder).
 * Level 1 needs 0. Chosen so early levels arrive fast and pacing slows: cumulative
 * thresholds are L2=2, L3=6, L4=12, L5=20, L6=30, L10=90, L16=240 — several level-ups
 * per floor early on.
 */
export function cumulativeXpForLevel(level: number): number {
  return level * (level - 1);
}

/**
 * The highest level `L >= 1` whose cumulative XP requirement is `<= xp` — PURE. Derived
 * directly from `cumulativeXpForLevel`. Examples (hand-derived from `L*(L-1)`): 0→1, 2→2,
 * 6→3, 12→4, 20→5, 30→6, 90→10, 240→16.
 */
export function levelForXp(xp: number): number {
  let level = 1;
  while (cumulativeXpForLevel(level + 1) <= xp) level++;
  return level;
}

/**
 * True iff the player has banked enough XP to be at least one level below where their XP
 * would place them — i.e. a level-up is owed. Compares against the NEXT level's threshold
 * so queued multi-level catch-ups drain one at a time (`level` increments per drained
 * level-up until this returns false).
 */
export function hasPendingLevelUp(player: Player): boolean {
  return player.xp >= cumulativeXpForLevel(player.level + 1);
}

/**
 * Apply ONE level-up's automatic max-HP growth — PURE. Rolls a single hit die and adds the
 * CON modifier: `hpRoll = max(rollDie(hitDie.sides) + mods.CON, 1)` (floored at 1). Returns
 * the player with `level` incremented and `maxHp` raised by `hpRoll`; `hp` is UNCHANGED (no
 * heal — restored via rest/potion). The hit die stays `{quantity:1, sides}` (no per-act
 * quantity bump), proficiency is NOT auto-grown, and stats grow ONLY via the draft. All
 * balance is an M15 placeholder. Threads the injected `Rng` (one draw); no Math.random.
 */
export function applyLevelUpHp(player: Player, rng: Rng): { player: Player; hpRoll: number } {
  const hpRoll = Math.max(rollDie(rng, player.hitDie.sides) + player.mods.CON, 1);
  return {
    player: { ...player, level: player.level + 1, maxHp: player.maxHp + hpRoll },
    hpRoll,
  };
}

/**
 * Apply a level-up as the player enters `newAct` (2..5) — PURE. Steps, ported from
 * Java `Player.levelUp` + `Character.setMods`:
 *  1. Spend two attribute points: `+1` per pick (the same stat twice ⇒ `+2`).
 *  2. Recompute all stat modifiers from the new stats.
 *  3. Roll the act-scaled HP gain: `rollDice(hitDie.quantity, hitDie.sides)` (which
 *     is `newAct-1` dice, since quantity tracks the prior act) plus the NEW CON mod,
 *     floored at 1, added to `maxHp`.
 *  4. If the CON modifier changed, add a further `newAct - 1` to `maxHp`.
 *  5. Bump the hit-die quantity to `min(newAct, 5)` and proficiency by 1.
 * `hp` and `armorClass` are left unchanged (faithful to Java).
 */
export function levelUpPlayer(
  player: Player,
  picks: readonly [StatKey, StatKey],
  newAct: number,
  rng: Rng,
): Player {
  const newStats = { ...player.stats };
  for (const pick of picks) {
    newStats[pick] = newStats[pick] + 1;
  }

  const oldConMod = player.mods.CON;
  const newMods = computeStatMods(newStats);
  const newConMod = newMods.CON;

  let roll = rollDice(rng, player.hitDie.quantity, player.hitDie.sides) + newConMod;
  if (roll < 1) roll = 1;

  let maxHp = player.maxHp + roll;
  if (oldConMod !== newConMod) {
    maxHp += newAct - 1;
  }

  return {
    ...player,
    stats: newStats,
    mods: newMods,
    maxHp,
    proficiency: player.proficiency + 1,
    hitDie: { quantity: Math.min(newAct, 5), sides: player.hitDie.sides },
  };
}
