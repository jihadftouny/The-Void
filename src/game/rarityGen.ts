// Rarity-scaling item generator for The Void — pure, framework-agnostic game logic (M6).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay/DOM/canvas. `generateItem` is a pure function of
//    an injected `Rng` + a request; it returns a plain-data `ItemInstance` and mutates nothing.
//  - Deterministic seeded RNG: THIS is the only new M6 randomness. It draws ONLY through the
//    injected `Rng` (src/game/rng.ts), in a FIXED, documented order, so the same seed + request
//    always rolls the identical item. No Math.random / Date.now.
//  - Data-driven content: the power curve lives in `RARITY_TABLE` (one row per tier); the
//    slot -> primary-effect mapping is a small coded table. Rebalancing edits data, not logic.
//  - Serializable plain-data state: the result is an `ItemInstance` whose `rolled` overlay is a
//    flat record — it equips and saves exactly like a catalog item.
//
// WHERE LOOT COMES FROM is M7's job; this unit only builds the generator + the catalogs. Every
// magnitude here is an M15 balance placeholder.
//
// DOCUMENTED DRAW ORDER (load-bearing for the determinism test):
//   draw 1 -> primary magnitude = tier.statBase + randInt(rng, tier.statSpread)
//   draw 2 -> proc gate         = rng() < tier.procChance
// Exactly two draws per item, always in this order, regardless of tier.

import { randInt, type Rng } from './rng.ts';
import { type Rarity } from './weapon.ts';
import { type StatKey } from './character.ts';
import {
  type EquipSlot,
  type ItemEffect,
  type ItemInstance,
  type ItemKind,
} from './item.ts';

/** One tier's power curve. All magnitudes are M15 placeholders. */
export interface RarityTier {
  /** Floor of the primary magnitude. */
  statBase: number;
  /** Random spread added on top: `randInt(rng, statSpread)` ∈ [0, statSpread-1]. */
  statSpread: number;
  /** Probability [0,1] that the item also gains a triggered proc. */
  procChance: number;
  /** The onHit proc's damage when it rolls. */
  procAmount: number;
}

/**
 * The tier power curve. Ranges are chosen so each tier's MINIMUM magnitude strictly exceeds
 * the previous tier's MAXIMUM (Common 1–2, Rare 3–5, Legendary 6–9), so a higher tier always
 * out-rolls a lower one for the same conceptual roll. Proc chance climbs with tier: Common
 * never procs, Legendary always does.
 */
export const RARITY_TABLE: Record<Rarity, RarityTier> = {
  Common: { statBase: 1, statSpread: 2, procChance: 0, procAmount: 0 },
  Rare: { statBase: 3, statSpread: 3, procChance: 0.5, procAmount: 2 },
  Legendary: { statBase: 6, statSpread: 4, procChance: 1, procAmount: 3 },
};

/** A request for a rolled item: which slot + tier, and (for stat slots) which stat to boost. */
export interface GenerateRequest {
  slot: EquipSlot;
  rarity: Rarity;
  /** The stat a ring/amulet boosts (bonusStat). Defaults to STR. Ignored for other slots. */
  stat?: StatKey;
}

/** The item kind a slot produces. */
function kindForSlot(slot: EquipSlot): ItemKind {
  switch (slot) {
    case 'mainHand':
    case 'offHand':
    case 'ammo':
      return 'weapon';
    case 'ring':
    case 'amulet':
      return 'trinket';
    default:
      return 'armor';
  }
}

/** The primary passive effect a slot's magnitude fills. */
function primaryEffect(req: GenerateRequest, magnitude: number): ItemEffect {
  const kind = kindForSlot(req.slot);
  if (kind === 'weapon') {
    return { type: 'bonusDamage', params: { amount: magnitude } };
  }
  if (kind === 'trinket') {
    const stat = (req.stat ?? 'STR').toLowerCase();
    return { type: 'bonusStat', params: { [stat]: magnitude } };
  }
  return { type: 'bonusArmorClass', params: { amount: magnitude } };
}

/**
 * Roll a rarity-scaled item — PURE, seeded. Draws exactly twice from `rng` in the documented
 * order (magnitude, then proc gate). Higher tiers roll a strictly larger primary magnitude
 * and are more likely to gain a triggered onHit proc (guaranteed at Legendary). The result is
 * an `ItemInstance` whose `rolled` overlay fully describes the item, so it equips/saves like
 * any catalog item.
 */
export function generateItem(rng: Rng, req: GenerateRequest): ItemInstance {
  const tier = RARITY_TABLE[req.rarity];
  // Draw 1: primary magnitude.
  const magnitude = tier.statBase + randInt(rng, tier.statSpread);
  // Draw 2: proc gate.
  const hasProc = rng() < tier.procChance;

  const effects: ItemEffect[] = [primaryEffect(req, magnitude)];
  if (hasProc) {
    effects.push({
      type: 'triggered',
      trigger: 'onHit',
      action: { kind: 'dealDamage', params: { amount: tier.procAmount } },
    });
  }

  return {
    defId: `gen:${req.rarity}:${req.slot}`,
    rolled: {
      name: `${req.rarity} ${req.slot}`,
      rarity: req.rarity,
      slot: req.slot,
      kind: kindForSlot(req.slot),
      effects,
    },
  };
}
