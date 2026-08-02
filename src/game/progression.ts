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
import { rollDice, type Rng } from './rng.ts';
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
