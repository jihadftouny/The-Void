// Effective-stat accessors for The Void — pure, framework-agnostic game logic (M2).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. Every accessor is
//    a pure function of a character's stored base + its active conditions.
//  - Deterministic seeded RNG: these accessors are RNG-free (they compute, never
//    roll); no Math.random / Date.now.
//  - Data-driven content: the twelve augment/deprivation ± stat deltas live in the
//    AUGMENT_DEPRIVATION table, not hard-coded in combat; adding/rebalancing one
//    edits data, not logic.
//  - Serializable plain-data state: effective stats/mods/AC/maxHp/resistances are
//    COMPUTED ON DEMAND from the stored base + `activeConditions`, never stored. The
//    augment effect is therefore reversible (drop the condition → the number returns
//    to base) and JSON stays minimal.
//
// THE CORE MECHANISM (M2 "activate the augment/deprivation set"):
//  Each augment/deprivation is a ± stat delta layered on top of the character's stored
//  base `stats`; the D&D formula `computeStatMod` is re-run on the adjusted stat so the
//  change CASCADES into every derived quantity (to-hit, damage, AC, max-HP, skill
//  power). Magnitude is ±2 stat = exactly ±1 mod (parity-independent, clean to derive);
//  duration is the existing CONDITION_DATA maxTurns (2). Both are balance knobs (M15).
//
//  OFF-EQUIVALENCE: when NO augment/deprivation is active, `conditionStatDelta` is 0 for
//  every stat, so every accessor returns exactly the value already stored — combat is
//  byte-identical to pre-M2. The effect is strictly opt-in.

import {
  computeStatMod,
  type Character,
  type StatKey,
  type Stats,
  type StatMods,
  STAT_KEYS,
} from './character.ts';
import type { ActiveCondition, ConditionType } from './condition.ts';

/** A character carrying live conditions (Player or Enemy) — what the accessors read. */
export type Conditioned = Character & { activeConditions: ActiveCondition[] };

/**
 * The twelve augment/deprivation conditions and the ± stat delta each applies. Six
 * augment / six deprivation pairs, ±2 stat apiece (= ±1 mod). Aliases in the design:
 *   healthy = Hardy, sick = Frail · smart = Sharp, dumb = Dull ·
 *   wise = Lucid, fool = Clouded · charming = Emboldened, repulsive = Cowed ·
 *   quick = Agile, slow = Slow.
 * Conditions NOT in this table (poison, bleed, burn, control, …) contribute no stat
 * delta — they are absent, so `conditionStatDelta` skips them.
 */
export const AUGMENT_DEPRIVATION: Partial<
  Record<ConditionType, { stat: StatKey; delta: number }>
> = {
  strong: { stat: 'STR', delta: +2 },
  weak: { stat: 'STR', delta: -2 },
  quick: { stat: 'DEX', delta: +2 },
  slow: { stat: 'DEX', delta: -2 },
  healthy: { stat: 'CON', delta: +2 },
  sick: { stat: 'CON', delta: -2 },
  smart: { stat: 'INT', delta: +2 },
  dumb: { stat: 'INT', delta: -2 },
  wise: { stat: 'WIS', delta: +2 },
  fool: { stat: 'WIS', delta: -2 },
  charming: { stat: 'CHA', delta: +2 },
  repulsive: { stat: 'CHA', delta: -2 },
};

/** Resistance points shifted per ±1 WIS mod (Lucid/Clouded). Balance knob (M15). */
export const RESIST_PER_WIS_MOD = 10;

/**
 * Sum of active augment/deprivation deltas targeting `stat`. Zero when the character
 * carries no augment/deprivation for that stat (off-equivalence). Multiple conditions
 * on the same stat would sum, but the apply/refresh rules keep at most one of each
 * type, so in practice a stat is touched by at most its augment and its deprivation.
 */
export function conditionStatDelta(
  conditions: readonly ActiveCondition[],
  stat: StatKey,
): number {
  let delta = 0;
  for (const c of conditions) {
    const entry = AUGMENT_DEPRIVATION[c.type];
    if (entry && entry.stat === stat) delta += entry.delta;
  }
  return delta;
}

/** The character's stored stats with active augment/deprivation deltas layered in. */
export function effectiveStats(char: Conditioned): Stats {
  const out = {} as Stats;
  for (const key of STAT_KEYS) {
    out[key] = char.stats[key] + conditionStatDelta(char.activeConditions, key);
  }
  return out;
}

/** The mods derived from the effective (augment-adjusted) stats. */
export function effectiveMods(char: Conditioned): StatMods {
  const stats = effectiveStats(char);
  const out = {} as StatMods;
  for (const key of STAT_KEYS) {
    out[key] = computeStatMod(stats[key]);
  }
  return out;
}

/**
 * The change in one stat's mod caused purely by active augment/deprivation:
 *   computeStatMod(baseStat + delta) − computeStatMod(baseStat).
 * Exactly 0 when no augment/deprivation touches that stat, so callers that add it are
 * off-equivalent. ±2 stat yields ±1 here regardless of the base stat's parity.
 */
export function statModDelta(char: Conditioned, stat: StatKey): number {
  const base = char.stats[stat];
  const delta = conditionStatDelta(char.activeConditions, stat);
  return computeStatMod(base + delta) - computeStatMod(base);
}

/**
 * Effective armor class: stored AC + the CON-mod delta (Hardy/Frail) + the DEX-mod
 * delta (Quick/Slow evasion). Off-equivalent (returns stored AC) when no augment is
 * active. Used NOW as the enemy AC a player attack tests against; the player-side use
 * (rolling against the player's own AC) is latent until M4 wires enemy to-hit.
 */
export function effectiveArmorClass(char: Conditioned): number {
  return char.armorClass + statModDelta(char, 'CON') + statModDelta(char, 'DEX');
}

/** Effective max HP: stored maxHp + the CON-mod delta (Hardy raises, Frail lowers). */
export function effectiveMaxHp(char: Conditioned): number {
  return char.maxHp + statModDelta(char, 'CON');
}

/**
 * Effective resistances: each stored resistance shifted by RESIST_PER_WIS_MOD × the
 * WIS-mod delta (Lucid raises, Clouded lowers). Off-equivalent when no WIS augment is
 * active. NOTE: under the current coarse mitigation formula `base − floor(res/100)·base`
 * a ±10 shift is largely inert (it does not cross a 100% boundary), so WIS's real teeth
 * arrive when mitigation is refined (M4/M5); the ±portion is nonetheless implemented.
 */
export function effectiveResistances(
  char: Conditioned & { resistances: number[] },
): number[] {
  const shift = RESIST_PER_WIS_MOD * statModDelta(char, 'WIS');
  return char.resistances.map((r) => r + shift);
}

// ------- Deferred-twist no-op hooks -------------------------------------------
// Each augment/deprivation has, beyond its ± stat portion (implemented above), a
// gameplay "twist" that belongs to a LATER milestone. These seams are wired now as
// explicit NO-OPS (they return neutral values regardless of conditions) so the later
// milestone has a single, obvious site to fill in — never a silently-missing feature.
// Do NOT invent those systems here.

/**
 * Quick/Slow TRUE-INITIATIVE reorder (M4 [OPEN] model). Quick should let the player act
 * before the enemy, Slow after. Until the round grows a real initiative step this is a
 * no-op: the ± DEX portion (to-hit / AC) is already live via the accessors above.
 */
export function initiativeOrderTwist(_char: Conditioned): 0 {
  return 0; // no-op until M4
}

/**
 * Lucid/Clouded ILLUSION-SIGHT (floor-2, M10). Lucid should reveal illusory enemies /
 * false choices, Clouded should hide truth. No illusion system exists yet, so this is a
 * no-op: the ± WIS portion (resistances) is already live via `effectiveResistances`.
 */
export function illusionSightTwist(_char: Conditioned): 0 {
  return 0; // no-op until M10
}

/**
 * Emboldened/Cowed DEAL-QUALITY (sacrifice economy, M7). Emboldened should improve
 * shop/deal terms, Cowed worsen them. No deal economy exists yet, so this is a no-op:
 * the ± CHA portion (mods) is already live via `effectiveMods`.
 */
export function dealQualityTwist(_char: Conditioned): 0 {
  return 0; // no-op until M7
}
