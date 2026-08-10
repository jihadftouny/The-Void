// Skill system for The Void — pure, framework-agnostic game logic (M6).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: `useSkill` returns a new caster, a new target, the
//    damage, and events. It mutates nothing and prints nothing. Java's SkillEnemy
//    mutated `Player.activeConditions` and a `static Character target` global as a
//    side effect — both are gone here (target is a parameter).
//  - Data-driven content: skills live in the SKILLS table (ported from
//    `SkillEnemy.java`); adding a skill never edits combat code.
//  - Serializable plain-data state: skills are referenced by `SkillId` string on
//    state; conditions are appended as plain `ActiveCondition` records.
//
// Ported from `Skill.java` / `SkillEnemy.java`. Recorded DEVIATIONS from Java:
//  - `useSkill` takes NO rng: skill damage/application is deterministic in Java
//    (no random term). The caller (resolveEnemyAttack) owns the skill-pick draw.
//  - `Skill.target` static global is dropped; the target is an explicit parameter.

import type { Character, StatKey } from './character.ts';
import { getElement } from './element.ts';
import { applyCondition, type ActiveCondition, type ConditionType } from './condition.ts';
import { statModDelta } from './statEffects.ts';
import { subjectOf, type CombatEvent } from './combatEvent.ts';

/**
 * Every skill id.
 *  - `pyroBall`/`freeze` are the ported enemy test skills.
 *  - `strike`/`ember`/`venom`/`frost`/`enfeeble` are the M2 generic pool: no longer
 *    auto-granted to a player, but retained as valid castable defs for the enemy path
 *    and the off-equivalence test (a twist-free skill through `castSkill`).
 *  - The twenty class-kit ids (M3) are the five signature kits (four skills each). Their
 *    optional twist knobs below are interpreted by `castSkill` in `classKit.ts`.
 */
export type SkillId =
  | 'pyroBall'
  | 'freeze'
  | 'strike'
  | 'ember'
  | 'venom'
  | 'frost'
  | 'enfeeble'
  // Enforcer kit (Momentum)
  | 'heavyStrike'
  | 'brace'
  | 'intimidate'
  | 'execute'
  // Neuromancer kit (Detonate)
  | 'mindSpike'
  | 'unravel'
  | 'lull'
  | 'synapse'
  // Scavver kit (Exposure)
  | 'backstab'
  | 'venomCoat'
  | 'slip'
  | 'scavenge'
  // Penitent kit (Devotion / Martyr — HP-as-fuel)
  | 'smite'
  | 'mend'
  | 'consecrate'
  | 'martyr'
  // Hollow kit (Corruption)
  | 'siphon'
  | 'corrupt'
  | 'sacrifice'
  | 'unmake';

/**
 * A skill definition as plain, data-driven content. The base fields (id..conditions)
 * drive `useSkill`; the OPTIONAL twist fields below drive `castSkill` (M3). Every twist
 * field absent ⇒ `castSkill` returns exactly `useSkill`'s result, so the enemy path and
 * the generic skills stay byte-identical. All twist magnitudes are M15 balance
 * placeholders (see `classKit.ts`).
 */
export interface SkillDef {
  id: SkillId;
  name: string;
  /** Element name (indexes the target's resistance array via `getElement`). */
  element: string;
  /** Skill charges consumed per use. */
  chargeCost: number;
  /** Base damage before the target's resistance is applied. */
  baseDamage: number;
  /** Conditions this skill inflicts on its target. */
  conditions: ConditionType[];

  // ---- Optional twist knobs (M3, interpreted by classKit.castSkill) ----
  /** Penitent: spend this much caster HP on cast (clamped so caster never drops below 1). */
  hpCost?: number;
  /** Hollow: sacrifice this much caster maxHp; each point raises `corruption` by 1. */
  maxHpCost?: number;
  /** Penitent: heal the caster by this flat amount (clamped to effective max HP). */
  selfHeal?: number;
  /** Hollow: heal the caster by floor(damage × fraction) (clamped to effective max HP). */
  lifestealFraction?: number;
  /** Enforcer: consume all caster momentum, adding `momentumDamagePer × momentum` damage. */
  spendMomentum?: boolean;
  /** Enforcer: damage added per point of consumed momentum (pairs with `spendMomentum`). */
  momentumDamagePer?: number;
  /** Enforcer: grant this much momentum on cast (clamped to the cap). */
  gainMomentum?: number;
  /** Enforcer: bonus damage when the target is at/below `thresholdPct`% of its max HP. */
  bonusVsBloodied?: { thresholdPct: number; bonus: number };
  /** Neuromancer: remove every target condition in `group`, adding `damagePer × count`. */
  detonate?: { damagePer: number; group: 'mental' };
  /** Scavver: raise the target's `exposed` intensity by this many stacks on cast. */
  appliesExposure?: number;
  /** Scavver: damage added per point of the target's current `exposed` intensity. */
  exposureScale?: number;
  /** Hollow: damage added per point of the caster's current `corruption`. */
  corruptionScale?: number;
  /** Apply these conditions to the CASTER (self-buffs: brace/consecrate/slip). */
  selfConditions?: ConditionType[];
  /** Scavver: restore this many skill charges to the caster (clamped to the max). */
  restoreCharges?: number;
  /** Penitent: add the caster's mod for this stat to the skill's damage. */
  scaleStat?: StatKey;
}

/**
 * The skill table, ported from `SkillEnemy.java`:
 *  - Pyro Ball (Element.fire = Pyro): base 2, no condition.
 *  - Freeze!   (Element.ice  = Cryo): base 1, applies `freeze`.
 */
export const SKILLS: Record<SkillId, SkillDef> = {
  pyroBall: { id: 'pyroBall', name: 'Pyro Ball', element: 'Pyro', chargeCost: 1, baseDamage: 2, conditions: [] },
  freeze: { id: 'freeze', name: 'Freeze!', element: 'Cryo', chargeCost: 1, baseDamage: 1, conditions: ['freeze'] },
  // ---- M2 generic starter pool (class-agnostic; each enemy-targeted, one condition). ----
  strike: { id: 'strike', name: 'Strike', element: 'Physical', chargeCost: 1, baseDamage: 2, conditions: ['bleed'] },
  ember: { id: 'ember', name: 'Ember', element: 'Pyro', chargeCost: 1, baseDamage: 2, conditions: ['burn'] },
  venom: { id: 'venom', name: 'Venom', element: 'Poison', chargeCost: 1, baseDamage: 1, conditions: ['poison'] },
  frost: { id: 'frost', name: 'Frost', element: 'Cryo', chargeCost: 1, baseDamage: 1, conditions: ['freeze'] },
  enfeeble: { id: 'enfeeble', name: 'Enfeeble', element: 'Psychic', chargeCost: 1, baseDamage: 1, conditions: ['weak'] },

  // ---- M3 class kits (all magnitudes/costs are M15 balance placeholders). ----
  // Enforcer (Momentum): spend banked momentum for burst; build it back with brace.
  heavyStrike: { id: 'heavyStrike', name: 'Heavy Strike', element: 'Physical', chargeCost: 2, baseDamage: 3, conditions: ['fracture'], spendMomentum: true, momentumDamagePer: 1 },
  brace: { id: 'brace', name: 'Brace', element: 'Force', chargeCost: 1, baseDamage: 0, conditions: [], selfConditions: ['healthy'], gainMomentum: 2 },
  intimidate: { id: 'intimidate', name: 'Intimidate', element: 'Psychic', chargeCost: 1, baseDamage: 1, conditions: ['stun'] },
  execute: { id: 'execute', name: 'Execute', element: 'Physical', chargeCost: 2, baseDamage: 2, conditions: ['bleed'], bonusVsBloodied: { thresholdPct: 50, bonus: 4 } },

  // Neuromancer (Detonate): stack mental conditions, then blow them up with synapse.
  mindSpike: { id: 'mindSpike', name: 'Mind Spike', element: 'Psychic', chargeCost: 1, baseDamage: 2, conditions: ['insanity'] },
  unravel: { id: 'unravel', name: 'Unravel', element: 'Psychic', chargeCost: 1, baseDamage: 1, conditions: ['fool'] },
  lull: { id: 'lull', name: 'Lull', element: 'Cryo', chargeCost: 1, baseDamage: 1, conditions: ['sleep'] },
  synapse: { id: 'synapse', name: 'Synapse', element: 'Electro', chargeCost: 2, baseDamage: 1, conditions: [], detonate: { damagePer: 2, group: 'mental' } },

  // Scavver (Exposure): mark a foe Exposed, then punish the mark. (Evasion half → M4.)
  backstab: { id: 'backstab', name: 'Backstab', element: 'Physical', chargeCost: 1, baseDamage: 2, conditions: ['bleed'], appliesExposure: 1 },
  venomCoat: { id: 'venomCoat', name: 'Venom Coat', element: 'Poison', chargeCost: 1, baseDamage: 1, conditions: ['poison'], exposureScale: 1 },
  slip: { id: 'slip', name: 'Slip', element: 'Physical', chargeCost: 1, baseDamage: 0, conditions: [], selfConditions: ['quick'] },
  scavenge: { id: 'scavenge', name: 'Scavenge', element: 'Physical', chargeCost: 1, baseDamage: 0, conditions: [], restoreCharges: 2 },

  // Penitent (Devotion / Martyr): pay HP for holy burst; mend/consecrate to sustain.
  smite: { id: 'smite', name: 'Smite', element: 'Force', chargeCost: 1, baseDamage: 3, conditions: [], hpCost: 2, scaleStat: 'WIS' },
  mend: { id: 'mend', name: 'Mend', element: 'Force', chargeCost: 1, baseDamage: 0, conditions: [], selfHeal: 4 },
  consecrate: { id: 'consecrate', name: 'Consecrate', element: 'Force', chargeCost: 1, baseDamage: 1, conditions: [], selfConditions: ['regeneration'] },
  martyr: { id: 'martyr', name: 'Martyr', element: 'Force', chargeCost: 2, baseDamage: 5, conditions: [], hpCost: 5 },

  // Hollow (Corruption): sacrifice max HP into corruption, then scale unmake by it.
  siphon: { id: 'siphon', name: 'Siphon', element: 'Psychic', chargeCost: 1, baseDamage: 3, conditions: [], lifestealFraction: 0.5 },
  corrupt: { id: 'corrupt', name: 'Corrupt', element: 'Poison', chargeCost: 1, baseDamage: 1, conditions: ['poison', 'insanity'] },
  sacrifice: { id: 'sacrifice', name: 'Sacrifice', element: 'Psychic', chargeCost: 1, baseDamage: 0, conditions: [], maxHpCost: 3 },
  unmake: { id: 'unmake', name: 'Unmake', element: 'Psychic', chargeCost: 2, baseDamage: 3, conditions: [], corruptionScale: 1, lifestealFraction: 0.5 },
};

/**
 * Skill damage after resistance, ported faithfully from Java's
 *   damage = base - (Resistances[elementIndex] / 100) * base
 * as `base - floor(res / 100) * base`. At 0 resistance this is the base; each full
 * 100% of resistance subtracts one whole `base` (so 100% -> 0). Never below 0.
 */
export function computeSkillDamage(
  skill: SkillDef,
  target: { resistances: number[] },
): number {
  const index = getElement(skill.element);
  const res = index === undefined ? 0 : target.resistances[index] ?? 0;
  const damage = skill.baseDamage - Math.floor(res / 100) * skill.baseDamage;
  return Math.max(damage, 0);
}

/** The result of casting a skill — new caster/target plus damage and events. */
export interface UseSkillResult<C extends Character, T extends Character> {
  caster: C;
  target: T;
  damage: number;
  events: CombatEvent[];
}

/**
 * Cast a skill from `caster` at `target` — PURE. Spends exactly one caster charge,
 * computes the resistance-adjusted damage PLUS the caster's INT-mod delta (Sharp/Dull
 * skill power — 0 when the caster carries no INT augment, so the enemy path is
 * unchanged), and applies the skill's condition(s) to a COPY of the target's
 * activeConditions via the mix-per-condition rule. Damage is NOT applied to hp — the
 * round applies hp. Emits `enemy-skill-used` and one `condition-applied` per condition
 * that was newly added OR stacked (never on a bare duration refresh — preserves the
 * freeze-dedup "no event" behaviour). Reusable by the enemy turn and the player cast.
 */
export function useSkill<
  C extends Character & { activeConditions: ActiveCondition[] },
  T extends Character & { activeConditions: ActiveCondition[]; resistances: number[] },
>(caster: C, target: T, skill: SkillDef): UseSkillResult<C, T> {
  const damage = Math.max(computeSkillDamage(skill, target) + statModDelta(caster, 'INT'), 0);
  const newCaster: C = { ...caster, skillCharges: caster.skillCharges - skill.chargeCost };

  const conditions = target.activeConditions.map((c) => ({ ...c }));
  const targetSubject = subjectOf(target);
  const events: CombatEvent[] = [
    { kind: 'enemy-skill-used', skillId: skill.id, name: skill.name },
  ];
  for (const type of skill.conditions) {
    const result = applyCondition(conditions, type);
    if (result === 'added' || result === 'stacked') {
      events.push({ kind: 'condition-applied', subject: targetSubject, conditionType: type });
    }
  }
  const newTarget: T = { ...target, activeConditions: conditions };

  return { caster: newCaster, target: newTarget, damage, events };
}
