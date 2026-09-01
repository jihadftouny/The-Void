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
//  - M4: the enemy now ROLLS TO HIT vs the player's Armor Class (symmetric with the
//    player path — same rollD20WithAdvantage / resolveAttackOutcome helpers), so enemies
//    can miss. This folds in Java's dead `atkRoll()` return value; difficulty drops, which
//    is the point of "defense matters". The defender AC and the enemy's adv/dis are
//    computed by the caller (battle.ts) and injected, keeping combat.ts free of
//    armor/shield/Player imports (clean layering).
//  - Weapon property is the correctly-spelled 'Melee' (Java's atkRoll typo 'Meelee'
//    never matched, so Java melee weapons silently added no modifier — a bug we drop).

import type { Character } from './character.ts';
import { type Weapon } from './weapon.ts';
import { rollDice, rollDie, randInt, type Rng } from './rng.ts';
import { SKILLS, useSkill, type SkillId } from './skill.ts';
import type { ActiveCondition } from './condition.ts';
import { effectiveMods, effectiveArmorClass, statModDelta } from './statEffects.ts';
import type {
  AttackOutcome,
  AttackRollDetail,
  CombatEvent,
  DamageSource,
} from './combatEvent.ts';
import { sumDamageSources } from './combatEvent.ts';

export type { AttackOutcome } from './combatEvent.ts';

/**
 * An attacker that carries an adv/dis flag (the Player). M5: the resolved `Weapon` and the
 * flat equip-damage bonus are now INJECTED by the caller (battle.ts) from the paperdoll —
 * this interface no longer carries an equipped weapon id, keeping combat.ts free of the
 * equipment/inventory imports (clean layering, symmetric with the injected defenderAc).
 */
export interface Attacker extends Character {
  advantageDisadvantage: number;
  /** Active status conditions — read for the augment/deprivation stat cascade (M2). */
  activeConditions: ActiveCondition[];
  /**
   * G32: the attacker's proficiency bonus, added to every to-hit total.
   *
   * REQUIRED, not optional, on purpose. `Player.proficiency` has existed since M3, is set at
   * creation (2), and is validated by the save guard — and was read by NO combat path at all:
   * `resolvePlayerAttack` built its to-hit from `weaponModifier` alone. Measured: 200 rounds at
   * `proficiency: 2` versus `99`, same seeds, gave 0/200 different outcomes. So the player rolled
   * at a flat -2 against the intended model — about ten percentage points of hit rate — for the
   * whole game, AND M15 tuned enemy HP and damage against that unintended baseline. Making the
   * field required means no future call site can silently drop it again, which is exactly how it
   * went missing.
   */
  proficiency: number;
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
  /**
   * EVERY face rolled, in draw order: `[n]` at advDis 0, `[a, b]` at ±1. Reported so the
   * combat log can show the player both dice under advantage instead of only the winner.
   * Purely additive — the same draws, in the same order, produce it.
   */
  faces: readonly number[];
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
    const natural = rollDie(rng, 20);
    return { natural, faces: [natural], advDis };
  }
  const a = rollDie(rng, 20);
  const b = rollDie(rng, 20);
  const natural = advDis === 1 ? Math.max(a, b) : Math.min(a, b);
  return { natural, faces: [a, b], advDis };
}

/**
 * Total the terms and clamp the result at 0, appending the corrective 'clamp' term when the
 * raw arithmetic went negative (a big Weak deprivation can outweigh a small damage die).
 * Keeps the sum-equals-damage invariant true on every path, including the clamped one.
 */
function totalWithClamp(sources: DamageSource[]): number {
  const raw = sumDamageSources(sources);
  if (raw >= 0) return raw;
  sources.push({ kind: 'clamp', amount: -raw });
  return 0;
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
 * the player's advantageDisadvantage), computes the outcome from the given `weapon`'s
 * modifier vs the enemy AC, then rolls weapon damage: once for a hit, twice for a crit,
 * none for a miss or fumble. Emits an advantage/disadvantage event when applicable and an
 * `attack` event. Applies no hp.
 *
 * M5: `weapon` (resolved from the paperdoll `mainHand`, or UNARMED when empty) and
 * `equipDamageBonus` (the flat `flatDamage` from equipped-item effects) are INJECTED by
 * battle.ts. `equipDamageBonus` adds to a hit's total ONCE and to a crit's total ONCE (like
 * an ability mod, NOT per die); it is 0 for legacy gear, so a normal run is off-equivalent.
 * The rng DRAW ORDER is unchanged (equipDamageBonus is pure arithmetic, no draw).
 *
 * M-UI2: `perkDamageBonus` is the wired-perk flat damage, split out of the single combined
 * number battle.ts used to pass so the emitted breakdown can tell gear from perks. It
 * defaults to 0 and is added at exactly the same point, so the arithmetic — and therefore
 * every damage number and every draw — is identical.
 */
export function resolvePlayerAttack(
  player: Attacker,
  enemy: Character & { activeConditions: ActiveCondition[] },
  weapon: Weapon,
  equipDamageBonus: number,
  rng: Rng,
  perkDamageBonus = 0,
  advDisOverride?: -1 | 0 | 1,
): PlayerAttackResult {
  // G12: `advDisOverride` is the round's COMBINED advantage, computed by battle.ts from the
  // battle's standing modifier plus this tick's conditions — exactly mirroring how the
  // enemy's `enemyAdvDis` is already computed by the caller and injected. When it is omitted
  // the stored `player.advantageDisadvantage` is used, so every existing call site (and the
  // save field) keeps working unchanged.
  const advDis = advDisOverride ?? normalizeAdvDis(player.advantageDisadvantage);
  const { natural, faces } = rollD20WithAdvantage(advDis, rng);
  // To-hit uses the EFFECTIVE mods (Strong/Weak on STR, Quick/Slow on DEX cascade in);
  // the defender AC is the enemy's EFFECTIVE AC (Hardy/Frail + Quick/Slow). Both are
  // off-equivalent: with no augment active they equal the stored mods / stored AC.
  const em = effectiveMods(player);
  // G32: proficiency is FOLDED INTO `modifier` rather than added as a separate field, because
  // `AttackRollDetail` documents `total === natural + modifier` and the combat log prints
  // exactly that equation. A separate field would make the log print a wrong sum.
  const modifier = weaponModifier({ ...player, mods: em }, weapon) + player.proficiency;
  const total = natural + modifier;
  const targetAc = effectiveArmorClass(enemy);
  const outcome = resolveAttackOutcome(natural, total, targetAc);
  // Every number the log needs, captured where it was decided — nothing is re-derived
  // downstream, and nothing new is rolled to produce it.
  const roll: AttackRollDetail = { natural, faces, advDis, modifier, total, targetAc };

  const events: CombatEvent[] = [];
  if (advDis === 1) events.push({ kind: 'advantage', subject: 'player' });
  else if (advDis === -1) events.push({ kind: 'disadvantage', subject: 'player' });

  // Strong/Weak add the STR-mod delta to weapon damage — melee only (Melee/Finesse).
  // Quick does NOT add ranged damage. 0 when no STR augment is active. Added once
  // (like an ability mod), not per die on a crit.
  const meleeDamageDelta =
    weapon.property === 'Melee' || weapon.property === 'Finesse'
      ? statModDelta(player, 'STR')
      : 0;

  const notation = `${weapon.damage.quantity}d${weapon.damage.sides}`;
  const damageSources: DamageSource[] = [];
  if (outcome === 'hit' || outcome === 'crit') {
    damageSources.push({
      kind: 'weapon-dice',
      amount: rollDice(rng, weapon.damage.quantity, weapon.damage.sides),
      label: notation,
    });
    if (outcome === 'crit') {
      // A crit rolls the weapon dice a SECOND time (it does not double a total), so it is
      // its own term with its own notation.
      damageSources.push({
        kind: 'crit-dice',
        amount: rollDice(rng, weapon.damage.quantity, weapon.damage.sides),
        label: notation,
      });
    }
    // Zero-valued terms are omitted: a breakdown listing "+0 from gear" is noise, and the
    // sum invariant is unaffected by leaving them out.
    if (meleeDamageDelta !== 0) {
      damageSources.push({ kind: 'ability-mod', amount: meleeDamageDelta });
    }
    if (equipDamageBonus !== 0) {
      damageSources.push({ kind: 'equipment', amount: equipDamageBonus });
    }
    if (perkDamageBonus !== 0) {
      damageSources.push({ kind: 'perk', amount: perkDamageBonus });
    }
  }
  // A miss or fumble rolls no damage die at all (0 draws) and so has no terms.
  const damage = totalWithClamp(damageSources);
  events.push({ kind: 'attack', subject: 'player', outcome, damage, roll, damageSources });

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
 * Resolve an enemy's attack against the player — PURE (M4: the enemy rolls to hit).
 *
 * `defenderAc` (the player's Armor Class) and `enemyAdvDis` (−1|0|1, the adv/dis the enemy
 * suffers — e.g. −1 vs a Scavver) are computed by the caller (battle.ts) from the full
 * Player, so this stays free of armor/shield/Player imports.
 *
 * Draw order (documented for the exact-list tests):
 *  1. `rollD20WithAdvantage(enemyAdvDis, rng)` — 1 draw at advDis 0, 2 at ±1.
 *  2. `total = natural + effectiveMods(enemy).STR` (provisional single enemy to-hit bonus;
 *     M8 adds per-family bonuses). `outcome = resolveAttackOutcome(natural, total, defenderAc)`.
 *  3. HIT / CRIT: if the enemy has charges AND a non-empty skill pool it picks a skill
 *     (one `randInt` draw), casts it via `useSkill` (spending a charge, applying any
 *     conditions), and deals the skill damage; else it deals the plain 1. A CRIT doubles
 *     the dealt damage. Clamped to >= 0.
 *  4. MISS / FUMBLE: 0 damage, enemy + target returned unchanged (no charge spent, no
 *     condition applied), and NO skill-pick draw.
 *
 * Events (ordered): an `advantage`/`disadvantage` {subject:'enemy'} event FIRST when
 * enemyAdvDis is ±1; then on a hit/crit-with-skill the `enemy-skill-used` (+ any
 * `condition-applied`) events; then the `attack` {subject:'enemy'} event carrying the
 * outcome + dealt damage. On a miss/fumble only the adv/dis event (if any) + the attack
 * event (damage 0) — no `enemy-skill-used`.
 *
 * DEVIATION from the plan's stated `{ enemy, damage, events }`: this also returns the
 * updated `target`, because `useSkill` may append a condition (e.g. Freeze!) to the
 * player, which must not be lost. On a miss (and for the default pyroBall enemy) no
 * condition is applied, so the target is returned unchanged.
 */
export function resolveEnemyAttack<E extends SkillUser, T extends SkillTarget>(
  enemy: E,
  player: T,
  defenderAc: number,
  enemyAdvDis: -1 | 0 | 1,
  rng: Rng,
): EnemyAttackResult<E, T> {
  const { natural, faces } = rollD20WithAdvantage(enemyAdvDis, rng);
  const modifier = effectiveMods(enemy).STR;
  const total = natural + modifier;
  const outcome = resolveAttackOutcome(natural, total, defenderAc);
  const roll: AttackRollDetail = {
    natural,
    faces,
    advDis: enemyAdvDis,
    modifier,
    total,
    targetAc: defenderAc,
  };

  const events: CombatEvent[] = [];
  if (enemyAdvDis === 1) events.push({ kind: 'advantage', subject: 'enemy' });
  else if (enemyAdvDis === -1) events.push({ kind: 'disadvantage', subject: 'enemy' });

  // Miss / fumble: no charge, no condition, no skill-pick draw. The roll detail is still
  // recorded — a miss is exactly the case where the player wants to see the dice.
  if (outcome === 'miss' || outcome === 'fumble') {
    events.push({
      kind: 'attack', subject: 'enemy', outcome, damage: 0, roll, damageSources: [],
    });
    return { enemy: restoreEnemyCharge(enemy), target: player, damage: 0, events };
  }

  // Hit / crit: cast a skill if able, else deal the plain 1. Crit doubles the dealt damage.
  const critMultiplier = outcome === 'crit' ? 2 : 1;
  // G22(b): pick from the AFFORDABLE subset. The gate used to be `skillCharges > 0` while
  // `useSkill` subtracts the full `chargeCost`, so an enemy with 1 charge could cast a cost-2
  // skill and end the round at -1 (reproduced for wrathSmash, riotSlam, overload,
  // immovableSlam, smiteWicked). DOCUMENTED DRAW CHANGE: the `randInt` now indexes the
  // affordable list, and when nothing is affordable it draws NOTHING at all — where the old
  // code drew, picked an unaffordable skill, and went negative. For a pool whose skills are
  // all affordable (the common case) the draw and the index are byte-identical.
  const affordable = enemy.skillPool.filter((id) => {
    const def = SKILLS[id as SkillId];
    return def !== undefined && def.chargeCost <= enemy.skillCharges;
  });
  if (affordable.length > 0) {
    const index = randInt(rng, affordable.length);
    const skillId = affordable[index] as SkillId;
    const skill = SKILLS[skillId];
    if (skill) {
      const used = useSkill(enemy, player, skill);
      // The skill's own damage enters as ONE term; a crit doubles it, which is recorded as
      // a second term of equal size rather than by silently scaling the first.
      const damageSources: DamageSource[] = [{ kind: 'skill', amount: used.damage }];
      if (critMultiplier === 2) {
        damageSources.push({ kind: 'crit-multiplier', amount: used.damage });
      }
      const damage = totalWithClamp(damageSources);
      events.push(...used.events, {
        kind: 'attack', subject: 'enemy', outcome, damage, roll, damageSources,
      });
      return { enemy: used.caster, target: used.target, damage, events };
    }
  }
  const damageSources: DamageSource[] = [{ kind: 'base', amount: 1 }];
  if (critMultiplier === 2) damageSources.push({ kind: 'crit-multiplier', amount: 1 });
  const damage = totalWithClamp(damageSources);
  events.push({ kind: 'attack', subject: 'enemy', outcome, damage, roll, damageSources });
  return { enemy: restoreEnemyCharge(enemy), target: player, damage, events };
}

/**
 * Skill charges an enemy regains on a turn in which it cast NOTHING.
 *
 * ⚠ M15/#2 BALANCE PLACEHOLDER. G22(c) states the defect — enemies start on 2 charges with no
 * restore path at all, so a family's themed skill pool only ever mattered for its first two
 * landed hits and every later hit was the flat `{kind:'base', amount:1}` — but specifies NO
 * fix, so this rule is proposed here rather than quoted. It is deliberately the minimal one:
 * no new state, no new rng draw, and self-limiting (a cost-1 themed skill lands about every
 * other turn, a cost-2 about every third). Belongs beside `ENEMY_MAX_SKILL_CHARGES`
 * (`enemy.ts`), which is a private const there; kept here so this unit stays inside its
 * declared file list. Tuning it is `PLAN.md` #2's.
 */
export const ENEMY_CHARGE_RESTORE_PER_TURN = 1;

/**
 * Give back one charge to an enemy that did not cast this turn, capped at its maximum — PURE,
 * RNG-FREE, and a no-op at full charges (so it never rewrites an untouched enemy).
 */
function restoreEnemyCharge<E extends SkillUser>(enemy: E): E {
  if (enemy.skillCharges >= enemy.maxSkillCharges) return enemy;
  return {
    ...enemy,
    skillCharges: Math.min(enemy.skillCharges + ENEMY_CHARGE_RESTORE_PER_TURN, enemy.maxSkillCharges),
  };
}

/** Coerce any stored adv/dis integer to the -1|0|1 the roller expects. */
function normalizeAdvDis(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

/**
 * Combine two independent advantage/disadvantage sources into the single −1|0|1 the roller
 * takes — PURE, RNG-free.
 *
 * RULE: they CANCEL (D&D 5e). One source of advantage and one of disadvantage means you roll
 * straight; two sources of advantage are still just advantage. This is the least surprising
 * rule for an explicitly D&D-style engine, and it is the reason the sum is clamped rather
 * than added. Recorded as a DECISION, not an accident: the alternative ("the condition always
 * wins") would make a fracture override the random-encounter ambush bonus.
 *
 * Used for both halves of the round: the player's standing battle advantage combined with a
 * condition's per-round override, and the enemy's class-imposed disadvantage (Scavver evasion)
 * combined with a fracture ticking on the ENEMY — the consumer G30 says the enemy half of
 * fracture never had.
 */
export function combineAdvDis(a: number, b: number): -1 | 0 | 1 {
  return normalizeAdvDis(normalizeAdvDis(a) + normalizeAdvDis(b));
}
