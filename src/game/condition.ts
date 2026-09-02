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
//    and the explicit `onsetDone` phase flag are stored on the instance so onset and
//    expiry are self-contained and round-trip through JSON.
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
//  - M2: `poison` and the twelve augment/deprivation conditions are now ACTIVE. Poison
//    is a curable DoT (modelled on bleed, no saving throw); each augment/deprivation is
//    a pure per-turn countdown whose gameplay teeth are the ± stat cascade read via the
//    accessors in `statEffects.ts` (NOT a per-tick hp/skip effect here). The Java "need
//    to add poison here" gap and the inert-carry-over fallthrough are both closed.

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
  // M3 — Scavver's mark. A DoT-stacking marker with NO per-turn effect: its intensity
  // is the payoff read by Scavver's exposure skills. Not a control condition, not an
  // augment/deprivation, not in the "mental" detonate set.
  | 'exposed'
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

/**
 * How repeated application of a condition combines:
 *  - 'dot'     — damage-over-time (poison, bleed, burn): a second application STACKS
 *    in intensity (each tick deals `intensity`) and refreshes the duration.
 *  - 'refresh' — everything else (control, augment/deprivation, …): a second
 *    application only REFRESHES the duration; there is never a second copy nor a
 *    doubled effect.
 */
export type StackingCategory = 'dot' | 'refresh';

/** Static per-condition data (max duration + display name + stacking rule). */
export interface ConditionData {
  maxTurns: number;
  displayName: string;
  stacking: StackingCategory;
}

/**
 * Max turns + display names ported verbatim from `Condition.java`'s static instances.
 * Most conditions last 2; fracture 100 (needs a rest), insanity 5, push 1.
 */
export const CONDITION_DATA: Record<ConditionType, ConditionData> = {
  bleed: { maxTurns: 2, displayName: 'Bleed', stacking: 'dot' },
  stun: { maxTurns: 2, displayName: 'Stun', stacking: 'refresh' },
  fracture: { maxTurns: 100, displayName: 'Fracture', stacking: 'refresh' },
  regeneration: { maxTurns: 2, displayName: 'Regeneration', stacking: 'refresh' },
  burn: { maxTurns: 2, displayName: 'Burn', stacking: 'dot' },
  freeze: { maxTurns: 2, displayName: 'Freeze', stacking: 'refresh' },
  electrify: { maxTurns: 2, displayName: 'Electrify', stacking: 'refresh' },
  poison: { maxTurns: 2, displayName: 'Poison', stacking: 'dot' },
  sleep: { maxTurns: 2, displayName: 'Sleep', stacking: 'refresh' },
  insanity: { maxTurns: 5, displayName: 'Insanity', stacking: 'refresh' },
  push: { maxTurns: 1, displayName: 'Push', stacking: 'refresh' },
  aired: { maxTurns: 2, displayName: 'Aired', stacking: 'refresh' },
  // 'dot' so repeated Backstabs accumulate intensity (the mark deepens); M15 balance.
  exposed: { maxTurns: 2, displayName: 'Exposed', stacking: 'dot' },
  strong: { maxTurns: 2, displayName: 'Strong', stacking: 'refresh' },
  quick: { maxTurns: 2, displayName: 'Agile', stacking: 'refresh' },
  healthy: { maxTurns: 2, displayName: 'Healthy', stacking: 'refresh' },
  smart: { maxTurns: 2, displayName: 'Brainy', stacking: 'refresh' },
  wise: { maxTurns: 2, displayName: 'Wise', stacking: 'refresh' },
  charming: { maxTurns: 2, displayName: 'Charming', stacking: 'refresh' },
  weak: { maxTurns: 2, displayName: 'Weak', stacking: 'refresh' },
  slow: { maxTurns: 2, displayName: 'Slow', stacking: 'refresh' },
  sick: { maxTurns: 2, displayName: 'Sick', stacking: 'refresh' },
  dumb: { maxTurns: 2, displayName: 'Dumb', stacking: 'refresh' },
  fool: { maxTurns: 2, displayName: 'Fool', stacking: 'refresh' },
  repulsive: { maxTurns: 2, displayName: 'Repulsive', stacking: 'refresh' },
};

/**
 * A live status condition on a character, as plain serializable data. `maxTurns` is
 * copied onto the instance so the per-turn/expiry phases are self-contained and
 * JSON-round-trippable.
 */
export interface ActiveCondition {
  type: ConditionType;
  remainingTurns: number;
  maxTurns: number;
  /**
   * DoT stack depth (poison/bleed/burn). OPTIONAL and additive: absent ⇒ treated as
   * intensity 1, so a legacy `ActiveCondition` saved before M2 (three fields, no
   * `intensity`) ticks/stacks exactly as intensity 1 — no save-version bump needed.
   * It only materializes when a DoT is applied a second time (see `applyCondition`).
   */
  intensity?: number;
  /**
   * G23: THE EXPLICIT PHASE FLAG. `true` once this instance has taken its onset tick.
   *
   * The phase used to be INFERRED from `remainingTurns === maxTurns` — but `applyCondition`'s
   * refresh/stack branches write exactly that value, so every re-application silently rewound a
   * live condition to its no-effect onset turn. Measured: spamming `ember` for 20 rounds dealt
   * a total of ZERO burn damage, while casting it once dealt 1 — the dominant action was
   * strictly worse than acting once, on both sides of every fight.
   *
   * OPTIONAL and additive, exactly like `intensity`: absent ⇒ read as
   * `remainingTurns < maxTurns`, which is precisely the old inference, so a condition saved
   * before this flag existed ticks byte-identically and no `SAVE_VERSION` bump is needed.
   */
  onsetDone?: boolean;
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

/** The outcome of `applyCondition` — mirrors the three "mix per condition" cases. */
export type ApplyResult = 'added' | 'stacked' | 'refreshed';

/**
 * Apply a condition with the "mix per condition" stacking rule (game-design §5). Pure
 * on its inputs except it MUTATES `list` in place (like `addCondition`) and returns
 * which case fired so callers decide whether to emit a `condition-applied` event:
 *  - absent            ⇒ push a fresh instance ⇒ 'added'.
 *  - present + 'dot'    ⇒ intensity = (existing ?? 1) + 1, duration refreshed ⇒ 'stacked'.
 *  - present + 'refresh'⇒ duration refreshed only (no intensity, no copy) ⇒ 'refreshed'.
 */
export function applyCondition(list: ActiveCondition[], type: ConditionType): ApplyResult {
  const existing = list.find((c) => c.type === type);
  if (!existing) {
    list.push(makeCondition(type));
    return 'added';
  }
  if (CONDITION_DATA[type].stacking === 'dot') {
    existing.intensity = (existing.intensity ?? 1) + 1;
    existing.remainingTurns = existing.maxTurns;
    return 'stacked';
  }
  existing.remainingTurns = existing.maxTurns;
  return 'refreshed';
}

/**
 * Return a NEW condition list with every instance of `type` removed — the pure CURE
 * hook (an antidote item that fires it lands in M6). Does not mutate the input.
 */
export function cureCondition(
  list: readonly ActiveCondition[],
  type: ConditionType,
): ActiveCondition[] {
  return list.filter((c) => c.type !== type);
}

/** True if the character has any turn-preventing (control) condition active. */
export function hasControlCondition(character: { activeConditions: ActiveCondition[] }): boolean {
  return character.activeConditions.some((c) => CONTROL_CONDITIONS.has(c.type));
}

/**
 * Canonical tick order (ported from Java's if-chain sequence, made deterministic):
 * the eleven original entries first, then poison (a DoT), then the twelve
 * augment/deprivation countdowns. Every ConditionType now appears here, so nothing is
 * carried untouched — the M2 activation. Order is load-bearing for reproducibility.
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
  'poison',
  'exposed',
  'strong',
  'quick',
  'healthy',
  'smart',
  'wise',
  'charming',
  'weak',
  'slow',
  'sick',
  'dumb',
  'fool',
  'repulsive',
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
 *   onset  (`!onsetDone`)                : first-turn flavor, no damage yet;
 *   effect (onsetDone, remaining > 0)    : the per-turn effect (damage/heal/skip/save);
 *   expiry (onsetDone, remaining <= 0)   : remove the condition (aired deals fall damage).
 * G23: the phase is the EXPLICIT `onsetDone` flag (defaulting to the legacy
 * `remainingTurns < maxTurns` inference), NOT `remainingTurns === maxTurns` — a duration
 * refresh writes exactly that value, so the old inference let every re-application rewind a
 * live condition into its no-effect onset turn and deal nothing, forever.
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

    // G23: the phase is read from the EXPLICIT flag, falling back to the old
    // `remainingTurns < maxTurns` inference for a legacy instance that predates it (so a
    // saved mid-condition instance keeps ticking exactly as it did). A re-application only
    // resets `remainingTurns`; it can no longer rewind the phase, because the flag survives.
    const onsetDone = cond.onsetDone ?? cond.remainingTurns < cond.maxTurns;
    const isOnset = !onsetDone;
    const isActive = onsetDone && cond.remainingTurns > 0;
    // Otherwise (past onset, remainingTurns <= 0) the condition expires.
    // Stamp the flag as the onset tick happens, on the per-tick CLONE — so it rides the
    // survivor forward and a later refresh reads a condition that has already onset.
    if (isOnset) cond.onsetDone = true;

    switch (type) {
      case 'burn': {
        if (isOnset) {
          // G46: no `text`. The line that used to ride here was "You caught on fire!" —
          // second person, stamped on the event WHATEVER the subject, so the enemy's own
          // burn onset told the player THEY were alight. `format.ts` now renders the pair
          // ("You succumb to Burn." / "The enemy succumbs to Burn.") from `subject`.
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          const amount = cond.intensity ?? 1;
          hpDelta -= amount;
          events.push({ kind: 'condition-damage', subject, conditionType: type, amount });
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
          // G46: no `text` — see the burn case. This one read "Your skin is ruptured!" and
          // was the most-measured instance of the defect (676 enemy-subject bleed onsets
          // over 250 runs, every one of them describing the FOE's wound as the player's).
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          const amount = cond.intensity ?? 1;
          hpDelta -= amount;
          events.push({ kind: 'condition-damage', subject, conditionType: type, amount });
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
          // G46, the fourth site — and the only one where the flavour is KEPT, because
          // `INSANITY_STRINGS` is authored content (fourteen hallucination lines), not a
          // one-line restatement of the template. It is first/second person throughout, so
          // it can only ever describe the PLAYER; on an enemy-subject tick it narrated the
          // foe's lost turn in the player's own voice.
          //
          // ⚠ THE DRAW IS TAKEN UNCONDITIONALLY. Only the ATTACHMENT is subject-gated.
          // Moving `pick` inside the `if` would make an enemy insanity tick consume one
          // FEWER rng draw than a player one, shifting every downstream roll in the run —
          // and with it the balance sample this unit is gated on (§22.21). The rng stream
          // must not learn who the condition is on.
          const line = pick(rng, INSANITY_STRINGS);
          const skip: Extract<CombatEvent, { kind: 'condition-skip' }> = {
            kind: 'condition-skip',
            subject,
            conditionType: type,
          };
          if (subject === 'player') skip.text = line;
          events.push(skip);
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
        } else if (isActive) {
          // G23 COMPANION FIX. `push` was the one condition whose effect fired ONLY on the
          // onset branch, because with the old inference a maxTurns-1 condition could never
          // be anything else. With the explicit flag a RE-PUSHED character reaches this
          // branch, and without it the second push would EXPIRE the condition instead of
          // pushing — i.e. re-applying the control would cancel it. Give it the same
          // skip-decrement-survive shape its five control siblings already have. A push that
          // is never refreshed never reaches here (rem hits 0 on onset), so its behaviour is
          // unchanged.
          skipTurn = true;
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
      case 'poison': {
        // Poison — a curable DoT modelled on bleed (no saving throw). Effect ticks deal
        // its `intensity` (default 1). [HOOK: game-design §5 notes poison should partly
        // ignore mitigation; no mitigation system exists yet, so it is a plain DoT now.]
        if (isOnset) {
          // G46: no `text` — see the burn case. This one read "Venom courses through you."
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          const amount = cond.intensity ?? 1;
          hpDelta -= amount;
          events.push({ kind: 'condition-damage', subject, conditionType: type, amount });
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'exposed': {
        // Scavver's mark — a pure per-turn COUNTDOWN with NO hp/skip effect. Its teeth
        // are the `intensity` read by Scavver's exposure skills (classKit.castSkill),
        // not anything that happens on tick. It counts down and expires like a DoT
        // duration but deals no damage. Stacking accumulates intensity (applyCondition).
        if (isOnset) {
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      case 'strong':
      case 'quick':
      case 'healthy':
      case 'smart':
      case 'wise':
      case 'charming':
      case 'weak':
      case 'slow':
      case 'sick':
      case 'dumb':
      case 'fool':
      case 'repulsive': {
        // Augment / deprivation — a pure per-turn COUNTDOWN. Their gameplay teeth are
        // the ± stat cascade read via `statEffects.ts` accessors during combat (to-hit,
        // damage, AC, max-HP, skill power); they inflict no per-turn hp/skip here. The
        // deferred twists (Quick/Slow initiative reorder, Lucid/Clouded illusion-sight,
        // Emboldened/Cowed deal-quality) are commented no-op hooks in statEffects.ts.
        if (isOnset) {
          events.push({ kind: 'condition-onset', subject, conditionType: type });
          cond.remainingTurns--;
          survivors.push(cond);
        } else if (isActive) {
          cond.remainingTurns--;
          survivors.push(cond);
        } else {
          events.push({ kind: 'condition-expired', subject, conditionType: type });
        }
        break;
      }
      /* c8 ignore next 2 */
      default:
        break;
    }
  }

  return { conditions: survivors, hpDelta, skipTurn, advDisOverride, events };
}
