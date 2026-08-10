// Player defense — Armor Class from gear — for The Void. Pure game logic (M4).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. Every function is a
//    pure computation over a Player's stored gear + active conditions.
//  - Deterministic seeded RNG: these are RNG-free (they compute, never roll); no
//    Math.random / Date.now.
//  - Data-driven content: armor numbers come from armor.json (via getArmorByName) and
//    shield numbers from shields.json (via getShieldById); no AC constants are hard-coded
//    except the unarmored base 10 and the provisional strReq penalty.
//
// THE AC MODEL (orchestrator resolution — the "replace" model):
//   armored:   AC = armor.baseArmor + CONmod + min(DEXmod, armor.dexCap)   [ - strReq penalty ]
//   unarmored: AC = 10 + CONmod
// The armor's `baseArmor` (11/12 in armor.json — these are D&D "Armor Class" numbers that
// already embed the base 10; the Java field was `armorAC`) REPLACES the unarmored base 10,
// it is NOT added on top of a second 10. CONmod is kept as the engine's CON-based-AC house
// rule (unarmored `10 + CONmod`; armored `baseArmor + CONmod` is its armored analog).
// Off-equivalence: with no equipped armor and no augment, AC == the stored `10 + CONmod`.
//
// The augment/deprivation cascade flows in through `effectiveMods` / `effectiveStats`
// (statEffects.ts): Hardy/Frail move CON (so AC), Quick/Slow move DEX (so the dexCap term),
// Strong/Weak move STR (so the strReq check). DEX cascades ONLY via `min(em.DEX, dexCap)` —
// NOT via a separate evasion term — so it is never double-counted. `effectiveArmorClass`
// (statEffects.ts) is deliberately left untouched: it stays the ENEMY's AC that a player
// attack tests against; the player's own defense now routes through here instead.
//
// EVERY balance number here (STR_REQ_AC_PENALTY, and the armor/shield magnitudes it reads)
// is an M15 placeholder.

import type { Conditioned } from './statEffects.ts';
import { effectiveMods, effectiveStats } from './statEffects.ts';
import { armorForSlot, shieldForSlot } from './equipment.ts';
import { computeEquipModifiers } from './equipEffects.ts';
import { type Inventory } from './inventory.ts';
import { scavverEvasionTwist, type PlayerClass } from './classKit.ts';

/**
 * Flat AC penalty for wearing armor whose `strReq` your (effective) STR does not meet.
 * Provisional M15 balance placeholder — "wearing armor you can't handle makes you easier
 * to hit". Only armor with a positive `strReq` can ever apply it; shields carry none in M4.
 */
export const STR_REQ_AC_PENALTY = 2;

/**
 * The gear + condition fields `playerArmorClass` reads off a Player. M5: gear now comes from
 * the paperdoll `inventory` (armor from `slots.armor`, shield from `slots.offHand`), the
 * single source of truth — no legacy `equipped*Id` reads remain.
 */
export type Defender = Conditioned & { inventory: Inventory };

/**
 * The flat AC bonus from the player's off-hand shield (`inventory.slots.offHand`): 0 when
 * the slot is empty or holds a non-shield id, else the shield's `acBonus`.
 */
export function shieldAcBonus(inventory: Inventory): number {
  const shield = shieldForSlot(inventory);
  return shield ? shield.acBonus : 0;
}

/**
 * The player's Armor Class from its equipped gear — PURE. See the AC MODEL note above.
 *   armored:   baseArmor + CONmod + min(DEXmod, dexCap)  (− STR_REQ_AC_PENALTY if
 *              armor.strReq > 0 and effective STR < strReq)  + shield acBonus + equip flatAc
 *   unarmored: 10 + CONmod                                    + shield acBonus + equip flatAc
 * CON/DEX/STR are the EFFECTIVE (augment-cascaded) values. Armor/shield resolve from the
 * paperdoll slots. The equipped-item `flatAc` (equipEffects.ts) is 0 for legacy gear, so a
 * normal run is byte-identical to M4 (off-equivalence).
 */
export function playerArmorClass(player: Defender): number {
  const em = effectiveMods(player);
  const armor = armorForSlot(player.inventory);

  let ac: number;
  if (!armor) {
    // Unarmored fallback (empty / non-armor mainHand id): the CON-based base.
    ac = 10 + em.CON;
  } else {
    ac = armor.baseArmor + em.CON + Math.min(em.DEX, armor.dexCap);
    if (armor.strReq > 0 && effectiveStats(player).STR < armor.strReq) {
      ac -= STR_REQ_AC_PENALTY;
    }
  }
  ac += shieldAcBonus(player.inventory);
  ac += computeEquipModifiers(player.inventory).flatAc;
  return ac;
}

/**
 * The advantage/disadvantage the ENEMY suffers when attacking this player: −1 (attack at
 * disadvantage) for a Scavver, 0 otherwise. Thin wrapper over `scavverEvasionTwist` so
 * `battle.ts` has one call site; the Scavver rule itself lives in classKit.ts. (M4 only
 * produces −1|0; the enemy roller still accepts +1 for a future advantage source.)
 */
export function enemyAdvDisVs(player: { classId: PlayerClass }): -1 | 0 {
  return scavverEvasionTwist(player);
}
