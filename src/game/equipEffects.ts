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

import { EQUIP_SLOTS, type EffectAction, type TriggerType } from './item.ts';
import { STAT_KEYS, type StatKey } from './character.ts';
import { ELEMENTS } from './element.ts';
import { type Inventory } from './inventory.ts';
import { resolveInstanceDef } from './equipment.ts';

/** A collected triggered effect: which combat moment fires it, and the action it takes. */
export interface TriggeredEffect {
  trigger: TriggerType;
  action: EffectAction;
}

/**
 * The aggregated modifier bundle from all equipped items' effects (plain data). M5 shipped
 * the first four fields (statDeltas/flatAc/flatDamage/resistDeltas, the latter two seams);
 * M6 activates statDeltas/resistDeltas and adds the passive FLAGS + the collected TRIGGERED
 * list. Every added field is IDENTITY-valued for effect-free (legacy) gear — 0 / false /
 * mult 1 / null / [] — so `computeEquipModifiers` over legacy gear yields a bundle whose
 * every read site is a no-op (off-equivalence).
 */
export interface EquipModifiers {
  /** Per-stat score deltas (bonusStat) — cascaded into effective stats (statEffects.ts). */
  statDeltas: Record<StatKey, number>;
  /** Flat Armor Class bonus (bonusArmorClass) — folded into playerArmorClass. */
  flatAc: number;
  /** Flat damage added once per hit (bonusDamage) — folded into resolvePlayerAttack. */
  flatDamage: number;
  /** Per-element resistance deltas (bonusResist) — folded into effectiveResistances. */
  resistDeltas: number[];
  /** Skill-charge cost reduction (Overclock Chip / Hollow Heart) — read in the cast path. */
  chargeDiscount: number;
  /** Charges restored at the start of the player's turn (Empty Vessel). */
  chargePerTurn: number;
  /** Percent bonus to the player's outgoing damage (Void Pact +50 => 50). */
  damageDealtMult: number;
  /** The first enemy hit each battle is reduced to 0 (Scrap Plating). */
  firstHitReduction: boolean;
  /** Below `thresholdPct`% of effective max HP, add `amount` to the player's damage (Adrenal Shunt). */
  lowHpDamageBonus: { amount: number; thresholdPct: number } | null;
  /** Multiplier applied to the enemy's negative DoT tick (Grave of Embers / Ashen Crown). Identity 1. */
  dotTickMult: number;
  /** Every heal site is blocked (Void Pact). */
  cannotHeal: boolean;
  /** The equipped items' triggered effects, in slot order (relicEffects.fireTrigger reads these). */
  triggered: TriggeredEffect[];
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

/** A fresh identity bundle: every field is the no-op value (off-equivalence baseline). */
function zeroBundle(): EquipModifiers {
  const statDeltas = {} as Record<StatKey, number>;
  for (const key of STAT_KEYS) statDeltas[key] = 0;
  return {
    statDeltas,
    flatAc: 0,
    flatDamage: 0,
    resistDeltas: ELEMENTS.map(() => 0),
    chargeDiscount: 0,
    chargePerTurn: 0,
    damageDealtMult: 0,
    firstHitReduction: false,
    lowHpDamageBonus: null,
    dotTickMult: 1,
    cannotHeal: false,
    triggered: [],
  };
}

/**
 * Fold every equipped item's plain-data effects into an `EquipModifiers` bundle — PURE.
 * Iterates `EQUIP_SLOTS`, resolves each filled instance's def via `resolveInstanceDef` (so
 * rarity-rolled instances contribute exactly like catalog gear), and folds each effect:
 *   - PASSIVE variants accumulate into the matching bundle field (deltas add, flags set,
 *     dotTickMult multiplies);
 *   - the TRIGGERED variant is pushed onto `bundle.triggered` for the combat pipeline.
 * `heal` and any unknown passive type are ignored (usables are not equipped). An empty /
 * effect-free inventory yields the identity bundle (off-equivalence).
 */
export function computeEquipModifiers(inventory: Inventory): EquipModifiers {
  const bundle = zeroBundle();
  for (const slot of EQUIP_SLOTS) {
    const item = inventory.slots[slot];
    if (!item) continue;
    const def = resolveInstanceDef(item);
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.type === 'triggered') {
        bundle.triggered.push({ trigger: effect.trigger, action: effect.action });
        continue;
      }
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
        case 'bonusResist': {
          const el = effect.params.element;
          const amt = effect.params.amount ?? 0;
          if (el !== undefined && el >= 0 && el < bundle.resistDeltas.length) {
            bundle.resistDeltas[el] = (bundle.resistDeltas[el] ?? 0) + amt;
          }
          break;
        }
        case 'skillChargeDiscount':
          bundle.chargeDiscount += effect.params.amount ?? 0;
          break;
        case 'chargePerTurn':
          bundle.chargePerTurn += effect.params.amount ?? 0;
          break;
        case 'damageDealtMultiplier':
          bundle.damageDealtMult += effect.params.pct ?? 0;
          break;
        case 'firstHitReduction':
          bundle.firstHitReduction = true;
          break;
        case 'lowHpDamageBonus':
          bundle.lowHpDamageBonus = {
            amount: effect.params.amount ?? 0,
            thresholdPct: effect.params.thresholdPct ?? 50,
          };
          break;
        case 'dotTickMultiplier':
          bundle.dotTickMult *= effect.params.mult ?? 1;
          break;
        case 'cannotHeal':
          bundle.cannotHeal = true;
          break;
        default:
          // heal / any unknown passive type: not an equip modifier — ignored.
          break;
      }
    }
  }
  return bundle;
}
