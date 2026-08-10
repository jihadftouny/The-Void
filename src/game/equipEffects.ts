// Equipped-effect pipeline for The Void — pure, framework-agnostic game logic (M5).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. `computeEquipModifiers`
//    is a pure fold over the paperdoll; it mutates nothing.
//  - Deterministic seeded RNG: RNG-free (it aggregates data, never rolls); no
//    Math.random / Date.now.
//  - Data-driven content: the effect TYPES parsed here are exactly the four already present
//    in items.json (`bonusArmorClass`, `bonusDamage`, `bonusStat`, `heal`); adding effect
//    CONTENT is M6 and needs no change to this switch.
//  - Serializable plain-data state: `EquipModifiers` is a flat plain-data bundle.
//
// OFF-EQUIVALENCE (proved by test): legacy starting gear resolves to `effects: []`
// (equipment.ts), so for a normal run `computeEquipModifiers` returns the ZERO bundle and
// every wired seam is a no-op. The pipeline is nonetheless genuinely wired (the effect tests
// exercise it with items.json gear), not dead code.
//
// WIRING SURFACE = TWO SEAMS applied now: `flatAc` folds into `playerArmorClass`
// (defense.ts) and `flatDamage` folds into `resolvePlayerAttack` (via battle.ts). The
// `statDeltas` / `resistDeltas` fields are AGGREGATED into the bundle now but left with a
// documented M6 APPLICATION SEAM — the stat/resist cascade is content-driven and belongs
// with M6's relic set (mirrors the deferred-twist no-op pattern in statEffects.ts). This
// keeps M5's behavior change minimal while handing M6 a filled bundle to extend.

import { EQUIP_SLOTS } from './item.ts';
import { STAT_KEYS, type StatKey } from './character.ts';
import { type Inventory } from './inventory.ts';
import { resolveGearDef } from './equipment.ts';

/** The aggregated modifier bundle from all equipped items' effects (plain data). */
export interface EquipModifiers {
  /** Per-stat score deltas (bonusStat). Aggregated now; M6 applies the cascade. */
  statDeltas: Record<StatKey, number>;
  /** Flat Armor Class bonus (bonusArmorClass) — folded into playerArmorClass. */
  flatAc: number;
  /** Flat damage added once per hit (bonusDamage) — folded into resolvePlayerAttack. */
  flatDamage: number;
  /** Per-element resistance deltas. Aggregated for M6; no effect type populates it yet. */
  resistDeltas: number[];
}

/** Map an `bonusStat` param key (lowercase) to its canonical StatKey. */
const STAT_BY_PARAM_KEY: Readonly<Record<string, StatKey>> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

/** A fresh zero bundle: every stat delta 0, no flat AC/damage, no resist deltas. */
function zeroBundle(): EquipModifiers {
  const statDeltas = {} as Record<StatKey, number>;
  for (const key of STAT_KEYS) statDeltas[key] = 0;
  return { statDeltas, flatAc: 0, flatDamage: 0, resistDeltas: [] };
}

/**
 * Fold every equipped item's plain-data effects into an `EquipModifiers` bundle — PURE.
 * Iterates `EQUIP_SLOTS`, resolves each filled instance's `GearDef.effects`, and switches
 * over `effect.type`:
 *   bonusArmorClass -> flatAc, bonusDamage -> flatDamage, bonusStat -> statDeltas[STAT],
 *   heal / unknown -> ignored (usables are not equipped).
 * An empty / effect-free inventory yields the ZERO bundle (off-equivalence).
 */
export function computeEquipModifiers(inventory: Inventory): EquipModifiers {
  const bundle = zeroBundle();
  for (const slot of EQUIP_SLOTS) {
    const item = inventory.slots[slot];
    if (!item) continue;
    const def = resolveGearDef(item.defId);
    if (!def) continue;
    for (const effect of def.effects) {
      switch (effect.type) {
        case 'bonusArmorClass':
          bundle.flatAc += effect.params.amount ?? 0;
          break;
        case 'bonusDamage':
          bundle.flatDamage += effect.params.amount ?? 0;
          break;
        case 'bonusStat':
          for (const [paramKey, value] of Object.entries(effect.params)) {
            const stat = STAT_BY_PARAM_KEY[paramKey];
            if (stat) bundle.statDeltas[stat] += value;
          }
          break;
        default:
          // heal / any unknown type: not an equip modifier — ignored.
          break;
      }
    }
  }
  return bundle;
}
