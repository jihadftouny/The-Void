// Combat event vocabulary for The Void — pure, framework-agnostic game logic (M5/M6).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: combat RESOLVERS return an ordered list of these
//    plain-data events instead of printing. No Kaplay/DOM/console. The M10 UI reads
//    the events and renders them; the logic core renders nothing.
//  - Serializable plain-data state: every event is a flat record of primitives —
//    no class instances, no functions — so it round-trips through JSON unchanged.
//
// This replaces the Java's interleaved `System.out.println` battle narration and the
// 8000/8001 sentinel return codes with a typed, structured, testable event stream.
// The structured `kind` + numeric/id fields are the source of truth for tests; the
// optional `text` is a UI convenience and is only ever asserted as "present".

import type { ConditionType } from './condition.ts';
import type { SkillId } from './skill.ts';
import type { StatKey } from './character.ts';
import type { TriggerType, EffectActionKind } from './item.ts';
import type { Rarity } from './weapon.ts';

/** Who an event is about. */
export type CombatSubject = 'player' | 'enemy';

/**
 * The result of a d20 attack roll — replaces Java's 8000 (crit) / 8001 (fumble)
 * / 0 (miss) magic sentinels with a named union.
 */
export type AttackOutcome = 'hit' | 'crit' | 'miss' | 'fumble';

/**
 * The d20 that decided an attack — everything the combat log needs to show the real dice,
 * so the renderer never re-derives a number the engine already computed (M-UI2 §3).
 */
export interface AttackRollDetail {
  /** The face that DECIDED the outcome (the max under advantage, the min under disadvantage). */
  natural: number;
  /** Every face rolled: `[n]` normally, `[a, b]` under advantage/disadvantage. */
  faces: readonly number[];
  advDis: -1 | 0 | 1;
  /** The to-hit modifier added to `natural`. */
  modifier: number;
  /** `natural + modifier`. */
  total: number;
  /** The defender's EFFECTIVE armor class this roll was measured against. */
  targetAc: number;
}

/**
 * One signed term of an attack's damage, in the order the engine applied it.
 *
 *  - 'weapon-dice'         the damage die roll
 *  - 'crit-dice'           the SECOND die roll a critical hit adds
 *  - 'ability-mod'         the STR-mod delta a melee/finesse augment contributes
 *  - 'equipment'           flat damage from equipped gear AND wired perks (the engine
 *                          merges the two before combat sees them; see `perk` below)
 *  - 'perk'                flat damage from a wired perk, when supplied separately
 *  - 'skill'               damage the skill/cast resolver produced, as one term
 *  - 'base'                the enemy's plain unarmed strike (1) when it casts no skill
 *  - 'crit-multiplier'     the extra a critical adds by DOUBLING an already-computed total
 *  - 'low-hp-bonus'        Adrenal Shunt's below-threshold flat bonus
 *  - 'damage-mult'         the extra (or loss) from a percentage multiplier, e.g. Void Pact
 *  - 'first-hit-reduction' Scrap Plating voiding the first enemy hit — a NEGATIVE term
 *  - 'clamp'               the floor-at-zero correction, so the terms still sum to the
 *                          reported damage when the raw arithmetic went negative
 *
 * INVARIANT: the terms SUM to the event's `damage`. That is what makes the breakdown
 * trustworthy — the number the log explains is the number the player actually loses.
 */
export type DamageSourceKind =
  | 'weapon-dice'
  | 'crit-dice'
  | 'ability-mod'
  | 'equipment'
  | 'perk'
  | 'skill'
  | 'base'
  | 'crit-multiplier'
  | 'low-hp-bonus'
  | 'damage-mult'
  | 'first-hit-reduction'
  | 'clamp';

export interface DamageSource {
  kind: DamageSourceKind;
  /** Signed. The terms sum to the event's `damage`. */
  amount: number;
  /** Dice notation, e.g. '1d8' — DATA for the renderer to format, never prose. */
  label?: string;
}

/** An ordered, structured record of one thing that happened during combat. */
export type CombatEvent =
  | { kind: 'enemy-skill-used'; skillId: SkillId; name: string; text?: string }
  | {
      kind: 'skill-cast';
      subject: 'player';
      skillId: SkillId;
      name: string;
      /** Damage the cast dealt. Equals the sum of `damageSources`. */
      damage: number;
      damageSources: readonly DamageSource[];
      text?: string;
    }
  | { kind: 'cast-unavailable'; text?: string }
  | {
      kind: 'attack';
      subject: CombatSubject;
      outcome: AttackOutcome;
      /** The damage ACTUALLY dealt, after every modifier. Equals the sum of `damageSources`. */
      damage: number;
      roll: AttackRollDetail;
      damageSources: readonly DamageSource[];
      text?: string;
    }
  | { kind: 'advantage'; subject: CombatSubject; text?: string }
  | { kind: 'disadvantage'; subject: CombatSubject; text?: string }
  | { kind: 'player-unable-to-act'; conditionType: ConditionType; text?: string }
  | { kind: 'condition-onset'; subject: CombatSubject; conditionType: ConditionType; text?: string }
  | {
      kind: 'condition-damage';
      subject: CombatSubject;
      conditionType: ConditionType;
      amount: number;
      text?: string;
    }
  | {
      kind: 'condition-heal';
      subject: CombatSubject;
      conditionType: ConditionType;
      amount: number;
      text?: string;
    }
  | { kind: 'condition-skip'; subject: CombatSubject; conditionType: ConditionType; text?: string }
  | { kind: 'condition-applied'; subject: CombatSubject; conditionType: ConditionType; text?: string }
  | { kind: 'condition-expired'; subject: CombatSubject; conditionType: ConditionType; text?: string }
  // ---- M3 class-twist events (additive; only class casts emit them) ----
  | {
      kind: 'resource-changed';
      subject: 'player';
      resource: 'momentum' | 'corruption';
      value: number;
      text?: string;
    }
  | { kind: 'self-sacrifice'; amount: number; ofMaxHp: boolean; text?: string }
  | { kind: 'lifesteal'; amount: number; text?: string }
  | { kind: 'detonate'; consumed: number; bonusDamage: number; text?: string }
  | { kind: 'potion-drunk'; healedTo: number; text?: string }
  | { kind: 'potion-unavailable'; text?: string }
  | { kind: 'potion-blocked'; text?: string }
  | { kind: 'fled'; text?: string }
  | { kind: 'escape-failed'; damage: number; text?: string }
  | { kind: 'escape-impossible'; text?: string }
  // ---- M8 spare / release (karma-weighted enemies only) ----
  | { kind: 'spared'; enemyName: string; text?: string }
  | { kind: 'spare-unavailable'; text?: string }
  | {
      kind: 'victory';
      xpGained: number;
      /** Found loot this kill dropped into the backpack (M7). Empty when the drop gate failed. */
      loot: readonly { defId: string; name: string; rarity: Rarity }[];
      text?: string;
    }
  | { kind: 'defeat'; text?: string }
  // ---- M6 items-content events (additive; only relics/consumables emit them) ----
  | { kind: 'relic-triggered'; trigger: TriggerType; action: EffectActionKind; text?: string }
  | { kind: 'consumable-used'; itemId: string; text?: string }
  | { kind: 'consumable-unavailable'; text?: string }
  | { kind: 'shield-gained'; amount: number; text?: string }
  | { kind: 'shield-absorbed'; amount: number; text?: string }
  | { kind: 'revive'; healedTo: number; text?: string }
  | { kind: 'stat-stolen'; stat: StatKey; amount: number; text?: string }
  // ---- M12 boss combat mechanics (only a boss battle emits these) ----
  /** Kingpin: a reinforcement joined the crew; `minions` is the new crew size. */
  | { kind: 'boss-summon'; minions: number; text?: string }
  /** Kingpin: the crew dealt `amount` extra damage to the player this round. */
  | { kind: 'boss-minion-damage'; amount: number; text?: string }
  /** Reflection: the boss read an over-used tactic; the player's next attack is disadvantaged. */
  | { kind: 'boss-adapt'; text?: string }
  // ---- PLAN.md #2 floor mechanics (only the floor that carries the mechanic emits these) ----
  /**
   * Floor 3's slow weight took `amount` of the player's skill charges as the battle opened.
   * Emitted only when something was actually taken (0 charges in hand ⇒ no event). The
   * `resource` is named so a later floor effect can drain something else with no new kind.
   */
  | { kind: 'floor-drain'; resource: 'skillCharge'; amount: number; text?: string }
  /**
   * Floor 2: the player's action would have hurt the enemy, and it passed through — the enemy
   * is an illusion. Pushed right after the `attack` / `skill-cast` / `consumable-used` it
   * voids. Deliberately carries nothing: the illusion is not NAMED until it is seen through.
   */
  | { kind: 'illusion-struck'; text?: string }
  /**
   * Floor 2: the passive Wisdom roll saw through the illusion and the fight ends — no XP, no
   * loot. Carries the roll (`natural + modifier = total` vs `dc`) because this is the ONE
   * moment the mechanic may show its dice; a FAILED roll emits nothing, since saying so would
   * name the illusion before the player has seen through it.
   */
  | { kind: 'illusion-dispelled'; natural: number; modifier: number; total: number; dc: number; text?: string }
  /**
   * The backpack is full (`BACKPACK_CAPACITY`), so found loot — a victory drop or a chest item —
   * stays where it fell. A combat event because the victory block emits it; the chest path
   * emits it from `game.ts` too.
   */
  | { kind: 'loot-left-behind'; name: string; rarity: Rarity; text?: string };

/** Every event `kind` string (handy for exhaustiveness / test assertions). */
export type CombatEventKind = CombatEvent['kind'];

/**
 * Classify a character as the 'player' or the 'enemy' side for event `subject`
 * fields. A Player carries a `classId`; an Enemy does not — that is the plain-data
 * discriminator (no class instances exist in serializable state). Kept here so the
 * combat/condition/skill resolvers share one definition.
 */
export function subjectOf(character: object): CombatSubject {
  return 'classId' in character ? 'player' : 'enemy';
}

/** Every event that reports damage broken down by source. */
export type DamagingEvent = Extract<CombatEvent, { damageSources: readonly DamageSource[] }>;

/** Total a list of damage terms. The result is what the event's `damage` must equal. */
export function sumDamageSources(sources: readonly DamageSource[]): number {
  return sources.reduce((total, s) => total + s.amount, 0);
}

/**
 * Append a damage term to an attack / skill-cast event, returning a NEW event whose
 * `damage` is the sum of its sources — PURE, no rng, no mutation.
 *
 * WHY THIS EXISTS. Damage is decided in two places: `combat.ts` rolls it and emits the
 * event, and then `battle.ts` applies post-hoc modifiers (Adrenal Shunt's low-HP bonus,
 * Void Pact's multiplier, Scrap Plating voiding the first enemy hit). Before M-UI2 those
 * modifiers changed the damage AFTER the event had been emitted, so the event reported a
 * number that was NOT what the player actually lost — a real correctness bug, not merely a
 * display gap. Folding each modifier back in through this helper keeps the event honest by
 * construction: `damage` is never set independently of the terms that explain it.
 */
export function withDamageSource<E extends DamagingEvent>(event: E, source: DamageSource): E {
  const damageSources = [...event.damageSources, source];
  return { ...event, damageSources, damage: sumDamageSources(damageSources) };
}
