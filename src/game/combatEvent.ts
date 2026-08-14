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

/** An ordered, structured record of one thing that happened during combat. */
export type CombatEvent =
  | { kind: 'enemy-skill-used'; skillId: SkillId; name: string; text?: string }
  | { kind: 'skill-cast'; subject: 'player'; skillId: SkillId; name: string; text?: string }
  | { kind: 'cast-unavailable'; text?: string }
  | {
      kind: 'attack';
      subject: CombatSubject;
      outcome: AttackOutcome;
      damage: number;
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
      extraRest: boolean;
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
  | { kind: 'boss-adapt'; text?: string };

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
