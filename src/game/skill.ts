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

import type { Character } from './character.ts';
import { getElement } from './element.ts';
import { applyCondition, type ActiveCondition, type ConditionType } from './condition.ts';
import { statModDelta } from './statEffects.ts';
import { subjectOf, type CombatEvent } from './combatEvent.ts';

/**
 * Every skill id. `pyroBall`/`freeze` are the ported enemy test skills; the five
 * `strike`/`ember`/`venom`/`frost`/`enfeeble` are the M2 generic STARTER pool the
 * player begins with (M3 replaces these with per-class signature kits).
 */
export type SkillId =
  | 'pyroBall'
  | 'freeze'
  | 'strike'
  | 'ember'
  | 'venom'
  | 'frost'
  | 'enfeeble';

/** A skill definition as plain, data-driven content. */
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
