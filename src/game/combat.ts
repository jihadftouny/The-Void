// Attack resolution for The Void — pure, framework-agnostic game logic (M5).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: every function returns a result + events and mutates
//    nothing (a new enemy is returned when a charge is spent). No Kaplay/DOM/console.
//  - Deterministic seeded RNG: every d20 / damage / skill-pick draw threads the
//    injected `Rng`; no Math.random / Date.now.
//  - Data-driven content: weapon damage dice and properties come from the M2 weapon
//    table; enemy skills come from the M6 SKILLS table.
//
// Ported from `Player.atkRoll`/`Player.attack` and `Enemy.attack`. Recorded DEVIATIONS:
//  - AttackOutcome union replaces Java's 8000 (crit) / 8001 (fumble) / 0 (miss)
//    sentinels.
//  - Advantage/disadvantage rolls exactly TWO d20s and takes max/min. Java wastes a
//    first d20 then rolls two more (three draws); we roll two (same visible outcome).
//  - On a miss/fumble the weapon damage die is NOT rolled (0 draws). Java rolls it and
//    then discards the result; skipping the wasted draw has no visible effect.
//  - The enemy ALWAYS hits (no to-hit roll): a faithful port of `Enemy.attack`, whose
//    `atkRoll()` return value is dead code. [NEEDS-HUMAN: folding the enemy d20 miss
//    check in would meaningfully lower difficulty — kept faithful for now.]
//  - Weapon property is the correctly-spelled 'Melee' (Java's atkRoll typo 'Meelee'
//    never matched, so Java melee weapons silently added no modifier — a bug we drop).

import type { Character } from './character.ts';
import { getWeaponByName, type Weapon } from './weapon.ts';
import { rollDice, rollDie, randInt, type Rng } from './rng.ts';
import { SKILLS, useSkill, type SkillId } from './skill.ts';
import type { ActiveCondition } from './condition.ts';
import type { AttackOutcome, CombatEvent } from './combatEvent.ts';

export type { AttackOutcome } from './combatEvent.ts';

/** An attacker that carries an equipped weapon id and an adv/dis flag (the Player). */
export interface Attacker extends Character {
  equippedWeaponId: string;
  advantageDisadvantage: number;
}

/** An enemy able to cast from a skill pool (the Enemy). */
export interface SkillUser extends Character {
  skillPool: string[];
  activeConditions: ActiveCondition[];
  resistances: number[];
}

/** A defender that can receive skill-inflicted conditions (the Player). */
export interface SkillTarget extends Character {
  activeConditions: ActiveCondition[];
  resistances: number[];
}

/** The natural d20 face rolled, plus which adv/dis mode produced it. */
export interface D20Roll {
  natural: number;
  advDis: -1 | 0 | 1;
}

/**
 * Roll a d20, honoring advantage (+1) / disadvantage (-1). With no adv/dis it draws
 * once. With adv/dis it draws exactly twice and takes the max (advantage) or min
 * (disadvantage) face. The returned `natural` drives both the crit/fumble check and
 * the modified total, so a mirrored (max/min swapped) impl is detectable.
 */
export function rollD20WithAdvantage(advDis: -1 | 0 | 1, rng: Rng): D20Roll {
  if (advDis === 0) {
    return { natural: rollDie(rng, 20), advDis };
  }
  const a = rollDie(rng, 20);
  const b = rollDie(rng, 20);
  const natural = advDis === 1 ? Math.max(a, b) : Math.min(a, b);
  return { natural, advDis };
}

/**
 * The attack modifier a weapon grants its wielder:
 *  - Melee   -> STR mod
 *  - Ranged  -> DEX mod
 *  - Finesse -> max(STR mod, DEX mod)
 */
export function weaponModifier(attacker: Character, weapon: Weapon): number {
  switch (weapon.property) {
    case 'Melee':
      return attacker.mods.STR;
    case 'Ranged':
      return attacker.mods.DEX;
    case 'Finesse':
      return Math.max(attacker.mods.STR, attacker.mods.DEX);
    /* istanbul ignore next */
    default:
      return 0;
  }
}

/**
 * Classify an attack from its natural d20 and modified total against the defender's
 * armor class:
 *  - natural 20 -> 'crit' (ignores AC entirely);
 *  - natural 1  -> 'fumble';
 *  - otherwise clamp the total to at least 1, then 'miss' if below AC, else 'hit'.
 */
export function resolveAttackOutcome(
  natural: number,
  total: number,
  defenderAc: number,
): AttackOutcome {
  if (natural === 20) return 'crit';
  if (natural === 1) return 'fumble';
  const clamped = Math.max(total, 1);
  return clamped < defenderAc ? 'miss' : 'hit';
}

/** The result of one player attack (pure — no hp change). */
export interface PlayerAttackResult {
  outcome: AttackOutcome;
  damage: number;
  events: CombatEvent[];
}

/**
 * Resolve a player's Fight attack against an enemy — PURE. Rolls the d20 (honoring
 * the player's advantageDisadvantage), computes the outcome from the equipped
 * weapon's modifier vs the enemy AC, then rolls weapon damage: once for a hit, twice
 * for a crit, none for a miss or fumble. Emits an advantage/disadvantage event when
 * applicable and an `attack` event. Applies no hp.
 */
export function resolvePlayerAttack(
  player: Attacker,
  enemy: Character,
  rng: Rng,
): PlayerAttackResult {
  const weapon = getWeaponByName(player.equippedWeaponId);
  if (!weapon) {
    throw new Error(`resolvePlayerAttack: unknown weapon id "${player.equippedWeaponId}"`);
  }
  const advDis = normalizeAdvDis(player.advantageDisadvantage);
  const { natural } = rollD20WithAdvantage(advDis, rng);
  const total = natural + weaponModifier(player, weapon);
  const outcome = resolveAttackOutcome(natural, total, enemy.armorClass);

  const events: CombatEvent[] = [];
  if (advDis === 1) events.push({ kind: 'advantage', subject: 'player' });
  else if (advDis === -1) events.push({ kind: 'disadvantage', subject: 'player' });

  let damage = 0;
  if (outcome === 'hit') {
    damage = rollDice(rng, weapon.damage.quantity, weapon.damage.sides);
  } else if (outcome === 'crit') {
    damage =
      rollDice(rng, weapon.damage.quantity, weapon.damage.sides) +
      rollDice(rng, weapon.damage.quantity, weapon.damage.sides);
  }
  events.push({ kind: 'attack', subject: 'player', outcome, damage });

  return { outcome, damage, events };
}

/** The result of one enemy attack (pure — new enemy/target, no hp change). */
export interface EnemyAttackResult<E extends SkillUser, T extends SkillTarget> {
  enemy: E;
  /** The target with any skill-inflicted conditions appended. */
  target: T;
  damage: number;
  events: CombatEvent[];
}

/**
 * Resolve an enemy's attack against the player — PURE, a faithful port of
 * `Enemy.attack`. If the enemy has charges AND a non-empty skill pool it picks a
 * skill (one rng draw), casts it via `useSkill` (spending one charge and applying any
 * conditions to the target), and deals the skill's damage; otherwise it deals exactly
 * 1. The enemy never rolls to hit and never misses. Damage is clamped to >= 0.
 *
 * DEVIATION from the plan's stated `{ enemy, damage, events }`: this also returns the
 * updated `target`, because `useSkill` may append a condition (e.g. Freeze!) to the
 * player, which must not be lost. For the default pyroBall enemy no condition is
 * applied, so the target is returned unchanged.
 */
export function resolveEnemyAttack<E extends SkillUser, T extends SkillTarget>(
  enemy: E,
  player: T,
  rng: Rng,
): EnemyAttackResult<E, T> {
  if (enemy.skillCharges > 0 && enemy.skillPool.length > 0) {
    const index = randInt(rng, enemy.skillPool.length);
    const skillId = enemy.skillPool[index] as SkillId;
    const skill = SKILLS[skillId];
    if (skill) {
      const used = useSkill(enemy, player, skill);
      const damage = Math.max(used.damage, 0);
      const events: CombatEvent[] = [
        ...used.events,
        { kind: 'attack', subject: 'enemy', outcome: 'hit', damage },
      ];
      return { enemy: used.caster, target: used.target, damage, events };
    }
  }
  const damage = 1;
  return {
    enemy,
    target: player,
    damage,
    events: [{ kind: 'attack', subject: 'enemy', outcome: 'hit', damage }],
  };
}

/** Coerce any stored adv/dis integer to the -1|0|1 the roller expects. */
function normalizeAdvDis(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}
