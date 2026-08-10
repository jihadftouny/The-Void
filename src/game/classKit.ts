// Class kits + signature-twist interpreter for The Void — pure game logic (M3).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay/DOM/canvas imports. `castSkill` returns a new
//    caster/target + damage + events and mutates nothing.
//  - Deterministic seeded RNG: `castSkill` takes NO rng (mirrors `useSkill`). Every twist
//    is pure arithmetic on the input state — it adds NO rng draw to the cast path, so the
//    documented battle draw order is unchanged and off-equivalence holds. No
//    Math.random/Date.now.
//  - Data-driven content: the five classes are rows in `CLASSES`; each signature twist is
//    a set of OPTIONAL knobs on `SkillDef` (skill.ts) read by one generic interpreter
//    below. Adding or rebalancing a kit never edits the combat branch.
//  - Serializable plain-data state: the only new Player state is optional primitives
//    (`momentum?`, `corruption?`); Scavver's mark is an ordinary `exposed` condition on
//    the enemy. Everything round-trips through JSON.
//
// EVERY NUMBER in `CLASSES` and every twist magnitude is an M15 balance placeholder.
// Penitent (d8) and Hollow (d8) hit dice are provisional picks within the design ranges
// (d8–d10 / d6–d8); their final values are an M15 call.

import type { Character, HitDie, StatKey } from './character.ts';
import { effectiveMaxHp, effectiveMods } from './statEffects.ts';
import {
  applyCondition,
  type ActiveCondition,
  type ConditionType,
} from './condition.ts';
import { subjectOf, type CombatEvent } from './combatEvent.ts';
import { useSkill, type SkillDef, type SkillId, type UseSkillResult } from './skill.ts';

/** The five playable classes (this string is the player's `classId`). */
export type PlayerClass = 'Enforcer' | 'Neuromancer' | 'Scavver' | 'Penitent' | 'Hollow';

/** Which per-class resource a class banks (or 'none' for condition-based twists). */
export type ClassResource = 'momentum' | 'corruption' | 'none';

/**
 * A class definition as plain, data-driven content. `primaryStats` is FLAVOR metadata
 * only — stats are rolled uniformly at creation (GAME-DESIGN §4); classes do not bias or
 * assign them. `weaponId`/`armorId` are provisional Act-1 gear reused until M6 adds
 * class-flavored equipment. `kit` is the four signature-skill ids granted at creation
 * (the full kit now; M9's lean-start draft trims this to 1–2 core skills + a draft pool).
 */
export interface ClassDef {
  id: PlayerClass;
  hitDie: HitDie;
  /** Flavor only — NOT applied to stat rolls. */
  primaryStats: StatKey[];
  weaponId: string;
  armorId: string;
  kit: SkillId[];
  resource: ClassResource;
  /** Human-readable twist label (UI/flavor). */
  twist: string;
}

/**
 * The five classes. Enforcer/Neuromancer keep their pre-M3 hit die + gear so existing
 * creation is unchanged; the three new classes reuse Act-1 gear ids (M6 replaces).
 */
export const CLASSES: Record<PlayerClass, ClassDef> = {
  Enforcer: {
    id: 'Enforcer',
    hitDie: { quantity: 1, sides: 10 },
    primaryStats: ['STR', 'CON'],
    weaponId: 'Jaaj Sword 1', // Act-1 Rare Melee
    armorId: 'Jooj Armor 1', // Act-1 Common
    kit: ['heavyStrike', 'brace', 'intimidate', 'execute'],
    resource: 'momentum',
    twist: 'Momentum',
  },
  Neuromancer: {
    id: 'Neuromancer',
    hitDie: { quantity: 1, sides: 6 },
    primaryStats: ['INT', 'WIS'],
    weaponId: 'Jooj Gun 1', // Act-1 Common Ranged
    armorId: 'Jaaj Armor 1', // Act-1 Rare
    kit: ['mindSpike', 'unravel', 'lull', 'synapse'],
    resource: 'none',
    twist: 'Detonate',
  },
  Scavver: {
    id: 'Scavver',
    hitDie: { quantity: 1, sides: 8 },
    primaryStats: ['DEX'],
    weaponId: 'Jiij Rapier 1', // Act-1 Legendary Finesse (provisional)
    armorId: 'Jooj Armor 1', // Act-1 Common (provisional)
    kit: ['backstab', 'venomCoat', 'slip', 'scavenge'],
    resource: 'none',
    twist: 'Tempo / Exposure',
  },
  Penitent: {
    id: 'Penitent',
    hitDie: { quantity: 1, sides: 8 }, // M15 placeholder within design range d8–d10
    primaryStats: ['WIS', 'CHA'],
    weaponId: 'Jaaj Sword 1', // provisional
    armorId: 'Jaaj Armor 1', // provisional
    kit: ['smite', 'mend', 'consecrate', 'martyr'],
    resource: 'none',
    twist: 'Devotion / Martyr',
  },
  Hollow: {
    id: 'Hollow',
    hitDie: { quantity: 1, sides: 8 }, // M15 placeholder within design range d6–d8
    primaryStats: ['CON', 'CHA'],
    weaponId: 'Jooj Gun 1', // provisional
    armorId: 'Jooj Armor 1', // provisional
    kit: ['siphon', 'corrupt', 'sacrifice', 'unmake'],
    resource: 'corruption',
    twist: 'Corruption',
  },
};

/**
 * The "mental" condition set consumed by Neuromancer's Detonate. These are the psyche-
 * afflicting conditions (control + mind-warping deprivations). NOT including bleed/burn/
 * poison/fracture (bodily) or the positive augments. M15 balance which set counts.
 */
export const MENTAL_CONDITIONS: ReadonlySet<ConditionType> = new Set<ConditionType>([
  'insanity',
  'sleep',
  'freeze',
  'dumb',
  'fool',
  'weak',
  'slow',
  'sick',
  'repulsive',
]);

/** Momentum cap (Enforcer). M15 balance placeholder. */
export const MOMENTUM_CAP = 5;

/** Clamp a momentum value into [0, MOMENTUM_CAP]. */
export function clampMomentum(value: number): number {
  return Math.max(0, Math.min(value, MOMENTUM_CAP));
}

/** True if the class banks momentum (only then do the battle on-damage hooks fire). */
export function usesMomentum(character: { classId: PlayerClass }): boolean {
  return CLASSES[character.classId].resource === 'momentum';
}

/**
 * Grant `amount` momentum to a character, clamped — treating an absent field as 0 (so a
 * pre-M3 save with no `momentum` reads as 0). Returns a NEW character; mutates nothing.
 */
export function grantMomentum<C extends { momentum?: number }>(character: C, amount: number): C {
  return { ...character, momentum: clampMomentum((character.momentum ?? 0) + amount) };
}

/** A caster carrying the optional per-class resource fields (the Player). */
type ResourceCaster = Character & {
  activeConditions: ActiveCondition[];
  momentum?: number;
  corruption?: number;
};

/**
 * Cast a skill from `caster` at `target`, layering the skill's declared signature-twist
 * effects on top of the generic `useSkill` result — PURE, takes no rng. When the skill
 * declares NO twist knobs the result is exactly `useSkill`'s (so the enemy path and the
 * generic skills stay byte-identical). Twist effects are applied deterministically in the
 * documented order; damage is clamped to >= 0. Returns the new caster/target, the final
 * damage (the round applies it to hp), and the base events plus any twist events.
 */
export function castSkill<
  C extends ResourceCaster,
  T extends Character & { activeConditions: ActiveCondition[]; resistances: number[] },
>(caster: C, target: T, skill: SkillDef): UseSkillResult<C, T> {
  const base = useSkill(caster, target, skill);
  let newCaster: C = base.caster;
  let newTarget: T = base.target;
  let damage = base.damage;
  const events: CombatEvent[] = [...base.events];
  const casterSubject = subjectOf(newCaster); // 'player' for every class cast

  // 1. scaleStat — add the caster's mod for the named stat (Penitent WIS).
  if (skill.scaleStat) {
    damage += effectiveMods(newCaster)[skill.scaleStat];
  }

  // 2. bonusVsBloodied — extra damage when the target is already low (Enforcer execute).
  if (skill.bonusVsBloodied) {
    const { thresholdPct, bonus } = skill.bonusVsBloodied;
    if (newTarget.hp <= (thresholdPct / 100) * newTarget.maxHp) {
      damage += bonus;
    }
  }

  // 3. Momentum (Enforcer): spend banked momentum for burst, or bank more.
  {
    let momentum = newCaster.momentum ?? 0;
    let changed = false;
    if (skill.spendMomentum) {
      damage += momentum * (skill.momentumDamagePer ?? 0);
      if (momentum !== 0) changed = true;
      momentum = 0;
    }
    if (skill.gainMomentum) {
      momentum = clampMomentum(momentum + skill.gainMomentum);
      changed = true;
    }
    if (changed) {
      newCaster = { ...newCaster, momentum };
      events.push({ kind: 'resource-changed', subject: 'player', resource: 'momentum', value: momentum });
    }
  }

  // 4. Detonate (Neuromancer): remove every target condition in the group, add per-count.
  if (skill.detonate) {
    const present = newTarget.activeConditions.filter((c) => MENTAL_CONDITIONS.has(c.type));
    const consumed = present.length;
    if (consumed > 0) {
      const bonusDamage = consumed * skill.detonate.damagePer;
      damage += bonusDamage;
      newTarget = {
        ...newTarget,
        activeConditions: newTarget.activeConditions.filter((c) => !MENTAL_CONDITIONS.has(c.type)),
      };
      events.push({ kind: 'detonate', consumed, bonusDamage });
    }
  }

  // 5. exposureScale (Scavver): read the target's current Exposed intensity as bonus.
  if (skill.exposureScale) {
    const mark = newTarget.activeConditions.find((c) => c.type === 'exposed');
    const intensity = mark ? mark.intensity ?? 1 : 0;
    damage += skill.exposureScale * intensity;
  }

  // 6. appliesExposure (Scavver): stack the Exposed mark on the target.
  if (skill.appliesExposure) {
    const conds = newTarget.activeConditions.map((c) => ({ ...c }));
    for (let i = 0; i < skill.appliesExposure; i++) {
      const result = applyCondition(conds, 'exposed');
      if (result === 'added' || result === 'stacked') {
        events.push({ kind: 'condition-applied', subject: subjectOf(newTarget), conditionType: 'exposed' });
      }
    }
    newTarget = { ...newTarget, activeConditions: conds };
  }

  // 7. corruptionScale (Hollow): read the caster's current corruption as bonus damage.
  if (skill.corruptionScale) {
    damage += skill.corruptionScale * (newCaster.corruption ?? 0);
  }

  // Final damage floor (a low scaleStat mod could push it negative).
  damage = Math.max(damage, 0);

  // 8. hpCost (Penitent): spend caster HP; never drops the caster below 1.
  if (skill.hpCost) {
    const newHp = Math.max(newCaster.hp - skill.hpCost, 1);
    const paid = newCaster.hp - newHp;
    newCaster = { ...newCaster, hp: newHp };
    events.push({ kind: 'self-sacrifice', amount: paid, ofMaxHp: false });
  }

  // 9. maxHpCost (Hollow): sacrifice max HP into corruption (1:1); never below 1 maxHp.
  if (skill.maxHpCost) {
    const newMaxHp = Math.max(newCaster.maxHp - skill.maxHpCost, 1);
    const paidMax = newCaster.maxHp - newMaxHp;
    const newHp = Math.min(newCaster.hp, newMaxHp);
    const corruption = (newCaster.corruption ?? 0) + paidMax;
    newCaster = { ...newCaster, maxHp: newMaxHp, hp: newHp, corruption };
    events.push({ kind: 'self-sacrifice', amount: paidMax, ofMaxHp: true });
    events.push({ kind: 'resource-changed', subject: 'player', resource: 'corruption', value: corruption });
  }

  // 10. selfHeal (Penitent mend): flat heal, clamped to effective max HP.
  if (skill.selfHeal) {
    const cap = effectiveMaxHp(newCaster);
    newCaster = { ...newCaster, hp: Math.min(newCaster.hp + skill.selfHeal, cap) };
  }

  // 11. lifestealFraction (Hollow siphon/unmake): heal floor(damage × fraction), clamped.
  if (skill.lifestealFraction) {
    const heal = Math.floor(damage * skill.lifestealFraction);
    if (heal > 0) {
      const cap = effectiveMaxHp(newCaster);
      newCaster = { ...newCaster, hp: Math.min(newCaster.hp + heal, cap) };
      events.push({ kind: 'lifesteal', amount: heal });
    }
  }

  // 12. selfConditions (brace/consecrate/slip): apply self-buffs to the caster.
  if (skill.selfConditions && skill.selfConditions.length > 0) {
    const conds = newCaster.activeConditions.map((c) => ({ ...c }));
    for (const type of skill.selfConditions) {
      const result = applyCondition(conds, type);
      if (result === 'added' || result === 'stacked') {
        events.push({ kind: 'condition-applied', subject: casterSubject, conditionType: type });
      }
    }
    newCaster = { ...newCaster, activeConditions: conds };
  }

  // 13. restoreCharges (Scavver scavenge): refund charges, clamped to the caster max.
  if (skill.restoreCharges) {
    newCaster = {
      ...newCaster,
      skillCharges: Math.min(newCaster.skillCharges + skill.restoreCharges, newCaster.maxSkillCharges),
    };
  }

  return { caster: newCaster, target: newTarget, damage, events };
}

// ------- Deferred-twist no-op hook (M4 seam) ---------------------------------
// Scavver's twist has two halves: EXPOSURE (the crit/DoT-payoff, implemented above via
// `exposureScale`/`appliesExposure`) and EVASION (dodging enemy attacks). Evasion depends
// on enemies rolling to hit, which does not exist until M4. This is the single, obvious
// site M4 fills in — wired now as an explicit NO-OP so the feature is never silently
// missing. Do NOT build the dodge here.

/**
 * Scavver EVASION half (M4). Should let a Scavver dodge some enemy attacks (and let
 * `slip`'s `quick` become a real evasion bonus). No enemy to-hit system exists yet, so
 * this returns 0 (no dodge) regardless of input.
 */
export function scavverEvasionTwist(_character: { classId: PlayerClass }): 0 {
  return 0; // no-op until M4 wires enemy to-hit
}
