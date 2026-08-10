// Status-condition system for The Void — pure, framework-agnostic game logic (M6).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: `tickConditions` returns new condition state + an
//    hpDelta + skip/adv flags + an event list. It mutates nothing and prints nothing;
//    Java's chain mutated GameLogic.player.hp and Enemy.staticStats directly and
//    printed as it went — none of that survives the port.
//  - Deterministic seeded RNG: saving throws and insanity's flavor pick thread the
//    injected `Rng`; no Math.random / Date.now.
//  - Data-driven content: durations/display names live in CONDITION_DATA (ported from
//    Condition.java), so adding a condition never edits the tick chain's structure.
//  - Serializable plain-data state: `ActiveCondition` is a flat record; the max-turns
//    are stored on the instance so onset (`remaining === maxTurns`) and expiry are
//    self-contained and round-trip through JSON.
//
// Ported from `Condition.java` (`tickConditions`). Recorded DEVIATIONS from Java:
//  - The chain runs in a FIXED canonical order (below) rather than ArrayList
//    insertion order, so a run is reproducible from its seed.
//  - `tickConditions` is TARGET-GENERIC (works for player OR enemy). Java hard-wired
//    the chain to the player and left the enemy chain as a TODO; generalizing it lets
//    player-inflicted conditions on the enemy actually tick.
//  - Java rolls a wasted d20 "saving throw" for stun/sleep/insanity/regeneration whose
//    result it never consults. We omit rolls that are never consulted, so those
//    handlers consume no rng draw (no player-visible difference). Only burn/freeze/
//    electrify — where the save IS consulted — roll a d20. Java also *accumulates* the
//    save across the loop (a bug); we roll a fresh save per condition.
//  - `poison` and the augment/deprivation set are DEFINED but INERT (no tick handler),
//    exactly as in Java (the "need to add poison here" gap).

import type { Character } from './character.ts';
import { rollDie, pick, type Rng } from './rng.ts';
import type { CombatEvent, CombatSubject } from './combatEvent.ts';
import { subjectOf } from './combatEvent.ts';

/** Every status condition (ported verbatim from `Condition.java`). */
export type ConditionType =
  | 'bleed'
  | 'stun'
  | 'fracture'
  | 'regeneration'
  | 'burn'
  | 'freeze'
  | 'electrify'
  | 'poison'
  | 'sleep'
  | 'insanity'
  | 'push'
  | 'aired'
  // Stat augmentation (post-release in Java) — defined but inert.
  | 'strong'
  | 'quick'
  | 'healthy'
  | 'smart'
  | 'wise'
  | 'charming'
  // Stat deprivation — defined but inert.
  | 'weak'
  | 'slow'
  | 'sick'
  | 'dumb'
  | 'fool'
  | 'repulsive';

/** Static per-condition data (max duration + display name), ported from Java. */
export interface ConditionData {
  maxTurns: number;
  displayName: string;
}

/**
 * Max turns + display names ported verbatim from `Condition.java`'s static instances.
 * Most conditions last 2; fracture 100 (needs a rest), insanity 5, push 1.
 */
export const CONDITION_DATA: Record<ConditionType, ConditionData> = {
  bleed: { maxTurns: 2, displayName: 'Bleed' },
  stun: { maxTurns: 2, displayName: 'Stun' },
  fracture: { maxTurns: 100, displayName: 'Fracture' },
  regeneration: { maxTurns: 2, displayName: 'Regeneration' },
  burn: { maxTurns: 2, displayName: 'Burn' },
  freeze: { maxTurns: 2, displayName: 'Freeze' },
  electrify: { maxTurns: 2, displayName: 'Electrify' },
  poison: { maxTurns: 2, displayName: 'Poison' },
  sleep: { maxTurns: 2, displayName: 'Sleep' },
  insanity: { maxTurns: 5, displayName: 'Insanity' },
  push: { maxTurns: 1, displayName: 'Push' },
  aired: { maxTurns: 2, displayName: 'Aired' },
  strong: { maxTurns: 2, displayName: 'Strong' },
  quick: { maxTurns: 2, displayName: 'Agile' },
  healthy: { maxTurns: 2, displayName: 'Healthy' },
  smart: { maxTurns: 2, displayName: 'Brainy' },
  wise: { maxTurns: 2, displayName: 'Wise' },
  charming: { maxTurns: 2, displayName: 'Charming' },
  weak: { maxTurns: 2, displayName: 'Weak' },
  slow: { maxTurns: 2, displayName: 'Slow' },
  sick: { maxTurns: 2, displayName: 'Sick' },
  dumb: { maxTurns: 2, displayName: 'Dumb' },
  fool: { maxTurns: 2, displayName: 'Fool' },
  repulsive: { maxTurns: 2, displayName: 'Repulsive' },
};

/**
 * A live status condition on a character, as plain serializable data. `maxTurns` is
 * copied onto the instance so the onset check (`remainingTurns === maxTurns`) and the
 * per-turn/expiry phases are self-contained and JSON-round-trippable.
 */
export interface ActiveCondition {
  type: ConditionType;
  remainingTurns: number;
  maxTurns: number;
}

/** Control conditions — those that make a character skip its turn. */
export const CONTROL_CONDITIONS: ReadonlySet<ConditionType> = new Set<ConditionType>([
  'stun',
  'sleep',
  'freeze',
  'aired',
  'push',
  'insanity',
]);

/** Insanity flavor lines, ported from `Condition.insanityStrings`. */
export const INSANITY_STRINGS: readonly string[] = [
  '~Useless. You are useless.~',
  "~Don't fall~",
  "~Don't fall~",
  "~Don't fall~",
  "~Tiny tiny you're tiny.~",
  '~One, six, seven, three, eight, two. They mean nothing, not to you~',
  "~You can't stop laughing histerically.~",
  '~Underwater fish~',
  '~Angels underwater after the darkness~',
  '~They see you, all of them. They see you.~',
  '~You tried so hard, useless.~',
  "~Don't fall~",
  "~Don't fall~",
  "~Don't fall~",
];

/** Make a fresh `ActiveCondition` at full duration for the given type. */
export function makeCondition(type: ConditionType): ActiveCondition {
  const { maxTurns } = CONDITION_DATA[type];
  return { type, remainingTurns: maxTurns, maxTurns };
}

/**
 * Add a condition to a list if not already present (dedup by type), mirroring Java's
 * "only add if not contains". Mutates and returns whether it was added, so callers
 * can decide whether to emit a `condition-applied` event.
 */
export function addCondition(list: ActiveCondition[], type: ConditionType): boolean {
  if (list.some((c) => c.type === type)) return false;
  list.push(makeCondition(type));
  return true;
}

/** True if the character has any turn-preventing (control) condition active. */
export function hasControlCondition(character: { activeConditions: ActiveCondition[] }): boolean {
  return character.activeConditions.some((c) => CONTROL_CONDITIONS.has(c.type));
}

/**
 * Canonical tick order (ported from Java's if-chain sequence, made deterministic):
 * burn, freeze, electrify, bleed, stun, fracture, regeneration, sleep, insanity,
 * push, aired. Conditions not listed here (poison + augment/deprivation) are inert.
 */
const CHAIN_ORDER: readonly ConditionType[] = [
  'burn',
  'freeze',
  'electrify',
  'bleed',
  'stun',
  'fracture',
  'regeneration',
  'sleep',
  'insanity',
  'push',
  'aired',
];

/** The outcome of ticking one character's conditions for a turn. */
export interface TickResult {
  /** The surviving conditions (expired ones removed, remaining decremented). */
  conditions: ActiveCondition[];
  /** Net hp change this tick (negative = damage, positive = heal). */
  hpDelta: number;
  /** True if a control condition made the character skip its action this turn. */
  skipTurn: boolean;
  /** -1 = fracture forces disadvantage; 0 = no override; +1 unused by ticks. */
  advDisOverride: -1 | 0 | 1;
  /** Ordered structured events describing what each condition did. */
  events: CombatEvent[];
}

/**
 * Tick a character's active conditions for one turn — PURE. Processes each active
 * condition in the fixed CHAIN_ORDER, faithfully reproducing Java's three phases:
 *   onset  (remainingTurns === maxTurns): first-turn flavor, no damage yet;
 *   effect (remainingTurns > 0)        : the per-turn effect (damage/heal/skip/save);
 *   expiry (remainingTurns <= 0)       : remove the condition (aired deals fall damage).
 * Damage/heal accumulate into `hpDelta` (the caller applies it to hp); control
 * conditions set `skipTurn`; fracture sets `advDisOverride = -1`. Saving throws for
 * burn/freeze/electrify roll `d20 + target STR mod` vs `opponent.stats.INT`.
 */
export function tickConditions(
  target: Character & { activeConditions: ActiveCondition[] },
  opponent: Character,
  rng: Rng,
): TickResult {
  const subject: CombatSubject = subjectOf(target);
  const events: CombatEvent[] = [];
  let hpDelta = 0;
  let skipTurn = false;
  let advDisOverride: -1 | 0 | 1 = 0;

  // Work on a shallow clone of each condition so the input list is never mutated.
  const active = target.activeConditions.map((c) => ({ ...c }));
  const survivors: ActiveCondition[] = [];
  const oppInt = opponent.stats.INT;

  for (const type of CHAIN_ORDER) {
    const cond = active.find((c) => c.type === type);
    if (!cond) continue;

    const isOnset = cond.remainingTurns === cond.maxTurns;
    const isActive = !isOnset && cond.remainingTurns > 0;
    // Otherwise (remainingTurns <= 0 and not the onset turn) the condition expires.

    switch (type) {
      case 'burn': {
        if (isOnset) {
          events.push({ kind: 'condition-onset', subject, conditionType: type, text: 'You caught on fire!' });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          hpDelta -= 1;
          events.push({ kind: 'condition-damage', subject, conditionType: type, amount: 1 });
          cond.remainingTurns--;
          const save = rollDie(rng, 20) + target.mods.STR;
          if (save >= oppInt) {
            events.push({ kind: 'condition-expired', subject, conditionType: type });
          } else {
            survivors.push(cond);
          }
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'freeze': {
        if (isOnset) {
          skipTurn = true;
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          skipTurn = true;
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          const save = rollDie(rng, 20) + target.mods.STR;
          if (save >= oppInt) {
            events.push({ kind: 'condition-expired', subject, conditionType: type });
          } else {
            survivors.push(cond);
          }
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'electrify': {
        if (isOnset) {
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          cond.remainingTurns--;
          const save = rollDie(rng, 20) + target.mods.STR;
          if (save < oppInt) {
            hpDelta -= 1;
            skipTurn = true;
            events.push({ kind: 'condition-damage', subject, conditionType: type, amount: 1 });
            events.push({ kind: 'condition-skip', subject, conditionType: type });
          }
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'bleed': {
        if (isOnset) {
          events.push({ kind: 'condition-onset', subject, conditionType: type, text: 'Your skin is ruptured!' });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          hpDelta -= 1;
          events.push({ kind: 'condition-damage', subject, conditionType: type, amount: 1 });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'stun': {
        if (isOnset) {
          skipTurn = true;
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          skipTurn = true;
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'fracture': {
        if (isOnset) {
          advDisOverride = -1;
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          advDisOverride = -1;
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'regeneration': {
        if (isOnset) {
          hpDelta += 2;
          events.push({ kind: 'condition-heal', subject, conditionType: type, amount: 2 });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          hpDelta += 1;
          events.push({ kind: 'condition-heal', subject, conditionType: type, amount: 1 });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'sleep': {
        if (isOnset) {
          skipTurn = true;
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          skipTurn = true;
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'insanity': {
        if (isOnset) {
          skipTurn = true;
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          const line = pick(rng, INSANITY_STRINGS);
          events.push({ kind: 'condition-skip', subject, conditionType: type, text: line });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'push': {
        // Java: push (maxTurns 1) skips on onset, then resolves/removes next tick.
        if (isOnset) {
          skipTurn = true;
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'aired': {
        if (isOnset) {
          skipTurn = true;
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          skipTurn = true;
          events.push({ kind: 'condition-skip', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          // "Drop" fall damage equal to maxTurns on expiry.
          hpDelta -= cond.maxTurns;
          events.push({ kind: 'condition-damage', subject, conditionType: type, amount: cond.maxTurns });
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      /* c8 ignore next 2 */
      default:
        break;
    }
  }

  // Inert conditions (poison + augment/deprivation) are carried over untouched.
  for (const cond of active) {
    if (!CHAIN_ORDER.includes(cond.type)) survivors.push(cond);
  }

  return { conditions: survivors, hpDelta, skipTurn, advDisOverride, events };
}
