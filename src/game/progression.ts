// Act progression + XP leveling for The Void — pure, framework-agnostic game logic (M8/M9).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports; nothing is
//    printed. `applyLevelUpHp` returns a NEW Player and never mutates its input.
//  - Deterministic seeded RNG: the only randomness (the level-up HP roll) threads
//    the injected `Rng`; no Math.random / Date.now.
//  - Serializable plain-data state: operates on and returns the flat `Player` record.
//
// The act gates are ported from `GameLogic.checkAct`. M9 REPLACED the old act-gated
// `levelUpPlayer` (Java `Player.levelUp` + `Character.setMods`) with frequent, XP-driven
// leveling (`levelForXp` / `applyLevelUpHp`) decoupled from act entry; the draft (draft.ts)
// now owns stat/skill/perk growth. Faithful choice kept: a level-up raises maxHp but does
// NOT heal (hp unchanged), and armorClass is not recomputed.

import { rollDie, type Rng } from './rng.ts';
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
 * XP at which floor 5's own boss gate opens — the point at which the True Void stops offering
 * encounters and offers the Hollow (G43).
 *
 * WHY A SEPARATE CONSTANT rather than an `ACT_XP_THRESHOLDS[6]` entry: that table is keyed by
 * *the act being ENTERED*, and there is no act 6. Overloading `shouldAdvance` to mean "the
 * floor-5 boss is ready" would make it lie about what it computes. (Recorded deviation: G43's
 * fix text says "add a floor-5 XP threshold like acts 1–3"; the table it points at cannot
 * express one.)
 *
 * ⚠ M15/#2 BALANCE PLACEHOLDER — this number decides how long floor 5 is, and no author has
 * set it. DERIVATION, so it is not arbitrary: enemy xp is `1 + randInt(0, floor(playerXp/4)+2)`,
 * mean ~ playerXp/8, so dX/dkill ~ X/8 and, from the act-5 entry threshold of 240,
 * X(k) = 240·e^(k/8) for k kills of floor 5:
 *     k = 4 -> 396      k = 5 -> 448      k = 6 -> 508      k = 7.5 -> 610
 *
 * The first choice was 600 (k ~ 7.5, to match floors 3 and 4 — #0a put them at "~8–11 kills";
 * PLAN.md #2 MEASURED them, see below). It is
 * LOWERED to 500 (k = 6) for a measured reason, not a taste: at 600 the heuristic-policy win
 * rate over `balance.test.ts`'s 500-run sample lands on EXACTLY 0.120, which does not clear
 * that file's `> 0.12` floor. The unit's own rule for this case is to lower the CONSTANT and
 * show the re-derivation rather than weaken the guard, so this moves one step down the same
 * curve — k = 6 kills, 240·e^(0.75) ~ 508 -> 500 — which measures 0.132. `PLAN.md` #2's
 * re-run owns the final value. (The #0a note that "floor 5 is now the deadliest stretch" was
 * true of that unit's gearless sim; it is not true of the #2 re-run — floor 4 is.)
 *
 * PLAN.md #2 TUNING (T3, 500 -> 600 — back to the first derived value), for TWO reasons:
 *  1. The only reason 500 existed is gone. It was chosen to clear `balance.test.ts`'s 0.12
 *     floor by a coincidence of the gearless sim; the sim now equips gear and uses consumables
 *     and wins well clear of that floor (AC-29).
 *  2. At 600 (k ~ 7.5 kills) floor 5 is as long as floors 3 and 4 — the length first derived
 *     for it. MEASURED (fix round 2, over the runs that cleared each floor in the report's
 *     2,500-run baseline): floor 3 takes 7.9 kills and floor 4 7.0 — not the "~8–11" #0a
 *     estimated, which this note repeated until then. Floor 5 at 600 measures 8.8.
 * What floor 5 cost when T3 was applied (after T1 and T2, on the report's 2,500-run baseline):
 * 106 deaths in 871 arrivals, about 1 in 8 — close to floor 2 (220 in 1,924, about 1 in 8.7)
 * and well below floors 3 (1 in 5.7) and 4 (1 in 2.8). Measured effect: 0.321 -> 0.306, and
 * floor-5 deaths 106 -> 142 (about 1 in 6.1). `docs/BALANCE-REPORT.md`'s ledger carries the row.
 *
 * ⚠ CORRECTED (FIX ROUND 1, F7). This note first gave the reason as "the re-run measured floor
 * 5 as the SOFTEST floor — about one arrival in fourteen died there". That was wrong twice:
 * the 1-in-14.9 figure (71 of 1,061) is from BEFORE T1 and T2, and even then floor 2 was softer
 * (124 of 1,927, 1 in 15.5). The measured effects were right; the stated reason was not.
 */
export const HOLLOW_GATE_XP = 600;

/** Whether floor 5's boss gate has opened for a player at `xp` — PURE. */
export function hollowGateOpen(xp: number): boolean {
  return xp >= HOLLOW_GATE_XP;
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
 * heal — restored by a found rest or a healing consumable). The hit die stays `{quantity:1, sides}` (no per-act
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

