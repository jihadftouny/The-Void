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
  | { kind: 'potion-drunk'; healedTo: number; text?: string }
  | { kind: 'potion-unavailable'; text?: string }
  | { kind: 'potion-blocked'; text?: string }
  | { kind: 'fled'; text?: string }
  | { kind: 'escape-failed'; damage: number; text?: string }
  | { kind: 'escape-impossible'; text?: string }
  | {
      kind: 'victory';
      xpGained: number;
      goldGained: number;
      extraRest: boolean;
      text?: string;
    }
  | { kind: 'defeat'; text?: string };

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
