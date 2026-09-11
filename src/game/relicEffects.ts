// Triggered-effect pipeline for The Void — pure, framework-agnostic game logic (M6).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay/DOM/canvas. `applyEffectAction` / `fireTrigger`
//    return NEW player/enemy + an event list and mutate nothing.
//  - Deterministic seeded RNG: TRIGGERED ACTIONS ARE RNG-FREE BY DESIGN — flat / percent /
//    count arithmetic only, NO dice. This keeps a geared run's combat draw order identical
//    to an ungeared one (off-equivalence) and every proc hand-derivable. (The ONLY new M6
//    randomness is the rarity generator, which owns its own seeded Rng.)
//  - Data-driven content: the finite `EffectActionKind` set is coded here; which action a
//    relic/consumable fires — and at which `TriggerType` — is pure data (relics.json /
//    consumables.json). Adding an item never edits this pipeline.
//  - Serializable plain-data state: every field touched is a primitive; no class instances.
//
// OFF-EQUIVALENCE: `fireTrigger` reads the equipped `triggered` list from
// `computeEquipModifiers`; for effect-free gear that list is empty, so the loop is a no-op —
// no state change, no event, no draw. The `revive` action is a NO-OP here (returned
// unchanged): the Halo Fragment revive GATE lives in battle.ts because it intercepts the
// death check and needs the per-battle `reviveUsed` flag on BattleState.

import { type Player } from './player.ts';
import { damageEnemy, type Enemy } from './enemy.ts';
import { computeEquipModifiers } from './equipEffects.ts';
import { applyCondition, cureCondition } from './condition.ts';
import { computeStatMods } from './character.ts';
import { effectiveMaxHp, effectiveResistances } from './statEffects.ts';
import { mitigate } from './skill.ts';
import { type CombatEvent } from './combatEvent.ts';
import { type EffectAction, type TriggerType } from './item.ts';
import { type TriggeredEffect } from './equipEffects.ts';
import { dampenHeal, floorModifiers, type FloorId } from './floors.ts';

/** Extra facts an action reads that are not on the player/enemy (e.g. damage just taken). */
export interface TriggerContext {
  /** HP damage the player just took this round — drives `pctOfDamageTaken` reflect. */
  damageTaken?: number;
  /**
   * PLAN.md #2: the percent of a `healSelf` the owner actually receives — the floor's
   * `healPct` (floor 3's slow weight: 50). Absent ⇒ 100, so every existing caller (and every
   * floor without the mechanic) heals byte-identically.
   */
  healPct?: number;
}

/** The outcome of applying one action: new entities, sub-events, and utility flags. */
export interface ActionOutcome {
  self: Player;
  other: Enemy;
  events: CombatEvent[];
  /** A `flee` action fired (consumables): the caller ends the battle as `fled`. */
  fled: boolean;
  /** A `reroll` action fired (consumables): the caller emits the reroll and no-ops the target. */
  reroll: boolean;
  /**
   * PLAN.md #2: a `dealDamage` that WOULD have hurt passed through an illusory enemy. The caller
   * decides whether to say so (a thrown consumable does, with `illusion-struck`; a relic proc
   * riding a blow that already reported it does not). Always false against a real enemy.
   */
  voided: boolean;
}

/**
 * Apply one data-described `EffectAction` — PURE, RNG-FREE. `self` is the item owner (the
 * player), `other` the enemy. Every branch is flat/percent/count arithmetic. `revive` is a
 * deliberate no-op (its gate is in battle.ts). Shared by relic triggers and consumables.
 */
export function applyEffectAction(
  action: EffectAction,
  self: Player,
  other: Enemy,
  ctx: TriggerContext,
): ActionOutcome {
  let p = self;
  let e = other;
  const events: CombatEvent[] = [];
  let fled = false;
  let reroll = false;
  let voided = false;

  switch (action.kind) {
    case 'dealDamage': {
      let amt = action.params.amount ?? 0;
      if (action.params.pctOfDamageTaken) {
        amt += Math.floor(((ctx.damageTaken ?? 0) * action.params.pctOfDamageTaken) / 100);
      }
      if (action.params.perEnemyCondition) {
        amt += action.params.perEnemyCondition * e.activeConditions.length;
      }
      if (action.element !== undefined) {
        // G17: the SAME `mitigate` the skill path uses, against the target's EFFECTIVE
        // resistances. This line used to duplicate the old `base - floor(res/100) * base`
        // formula inline — which was zero mitigation for every resistance below 100, and
        // nothing in the game reaches 100. Two copies of a broken formula are now one copy
        // of the real one.
        amt = mitigate(amt, effectiveResistances(e)[action.element] ?? 0);
      }
      amt = Math.max(amt, 0);
      // PLAN.md #2: through the one enemy-damage helper, so an illusion takes nothing.
      if (amt > 0 && e.illusory) voided = true;
      e = damageEnemy(e, amt);
      break;
    }
    case 'healSelf': {
      // Void Pact's `cannotHeal` blocks EVERY heal site, including this one.
      if (!computeEquipModifiers(p.inventory).cannotHeal) {
        const cap = effectiveMaxHp(p);
        let heal = action.params.amount ?? 0;
        if (action.params.pctMaxHp) heal += Math.floor((cap * action.params.pctMaxHp) / 100);
        // PLAN.md #2: floor 3 dampens every heal that passes through here — a consumable and a
        // relic alike. Applied to the TOTAL, after the pctMaxHp term, so a Void Draught on
        // floor 3 restores half of what it restores elsewhere. Identity when `healPct` is absent.
        heal = dampenHeal(heal, ctx.healPct ?? 100);
        if (heal > 0) p = { ...p, hp: Math.min(p.hp + heal, cap) };
      }
      break;
    }
    case 'applyConditionSelf': {
      if (action.condition) {
        const conds = p.activeConditions.map((c) => ({ ...c }));
        const r = applyCondition(conds, action.condition);
        p = { ...p, activeConditions: conds };
        if (r === 'added' || r === 'stacked') {
          events.push({ kind: 'condition-applied', subject: 'player', conditionType: action.condition });
        }
      }
      break;
    }
    case 'applyConditionEnemy': {
      if (action.condition) {
        const conds = e.activeConditions.map((c) => ({ ...c }));
        const r = applyCondition(conds, action.condition);
        e = { ...e, activeConditions: conds };
        if (r === 'added' || r === 'stacked') {
          events.push({ kind: 'condition-applied', subject: 'enemy', conditionType: action.condition });
        }
      }
      break;
    }
    case 'gainShield': {
      const amt = action.params.amount ?? 0;
      if (amt > 0) {
        p = { ...p, shield: (p.shield ?? 0) + amt };
        events.push({ kind: 'shield-gained', amount: amt });
      }
      break;
    }
    case 'gainStat': {
      if (action.stat) {
        const amt = action.params.amount ?? 0;
        const stats = { ...p.stats, [action.stat]: p.stats[action.stat] + amt };
        // Recompute the derived mod table so the stolen stat cascades (Devourer's Maw).
        p = { ...p, stats, mods: computeStatMods(stats) };
        events.push({ kind: 'stat-stolen', stat: action.stat, amount: amt });
      }
      break;
    }
    case 'restoreCharge': {
      const amt = action.params.amount ?? 0;
      p = { ...p, skillCharges: Math.min(p.skillCharges + amt, p.maxSkillCharges) };
      break;
    }
    case 'drainCharge': {
      // PLAN.md #2, floor 3: take charges, never below 0. Emits nothing itself — the CALLER
      // names the loss (`fireFloorTriggers` emits `floor-drain` with the amount actually taken),
      // because the same primitive on a relic would be a relic's loss, not the floor's.
      const amt = Math.max(action.params.amount ?? 0, 0);
      p = { ...p, skillCharges: Math.max(p.skillCharges - amt, 0) };
      break;
    }
    case 'cure': {
      if (action.condition) {
        p = { ...p, activeConditions: cureCondition(p.activeConditions, action.condition) };
      }
      break;
    }
    case 'flee':
      fled = true;
      break;
    case 'reroll':
      reroll = true;
      break;
    case 'revive':
      // Handled by the battle.ts death gate (needs the per-battle reviveUsed flag).
      break;
    /* c8 ignore next 2 */
    default:
      break;
  }

  return { self: p, other: e, events, fled, reroll, voided };
}

/**
 * Fire every equipped triggered effect matching `trigger` — PURE, RNG-FREE. Filters the
 * player's `computeEquipModifiers().triggered` list, applies each action in slot order, and
 * emits a `relic-triggered` marker plus the action's sub-events. `revive` actions are
 * skipped (their gate is in battle.ts). Off-equivalent: no match ⇒ inputs returned unchanged.
 */
export function fireTrigger(
  trigger: TriggerType,
  player: Player,
  enemy: Enemy,
  ctx: TriggerContext,
): { player: Player; enemy: Enemy; events: CombatEvent[] } {
  return fireEffects(
    computeEquipModifiers(player.inventory).triggered,
    trigger,
    player,
    enemy,
    ctx,
    (t) => [{ kind: 'relic-triggered', trigger, action: t.action.kind }],
  );
}

/**
 * Fire the FLOOR's triggered effects matching `trigger` — PURE, RNG-FREE (PLAN.md #2).
 *
 * THE SAME LOOP `fireTrigger` runs over a relic's effects (`fireEffects`, below), and the same
 * `applyEffectAction` — that sharing IS the hybrid rule's "simple modifiers reuse the relic
 * pipeline" (GAME-DESIGN.md §8), and `relicEffects.test.ts` holds it to it by firing an equipped
 * relic and a floor through one code path. Only the MARKER differs: a relic announces itself
 * with `relic-triggered` (an enum id the renderer prints), while a floor's charge bleed is
 * reported as `floor-drain` carrying the charges ACTUALLY taken — and nothing at all when there
 * were none to take, so a floor-3 battle opened on an empty well is byte-identical to floor 1's.
 *
 * Off-equivalent: a floor with no triggered effects (1, 2, 4, 5) returns its inputs unchanged.
 */
export function fireFloorTriggers(
  trigger: TriggerType,
  floor: FloorId,
  player: Player,
  enemy: Enemy,
  ctx: TriggerContext,
): { player: Player; enemy: Enemy; events: CombatEvent[] } {
  return fireEffects(floorModifiers(floor).triggered, trigger, player, enemy, ctx, (t, before, after) => {
    if (t.action.kind !== 'drainCharge') return [];
    const amount = before.skillCharges - after.skillCharges;
    return amount > 0 ? [{ kind: 'floor-drain', resource: 'skillCharge', amount }] : [];
  });
}

/**
 * The one trigger loop, shared by equipped relics and floors. Filters `triggered` to
 * `trigger`, skips `revive` (its gate is in battle.ts), applies each action in order through
 * `applyEffectAction`, and emits the caller's marker events BEFORE the action's own sub-events.
 * An empty match returns the ORIGINAL objects (reference-equal), which is what lets
 * `openBattle` hand back the untouched battle.
 */
function fireEffects(
  triggered: readonly TriggeredEffect[],
  trigger: TriggerType,
  player: Player,
  enemy: Enemy,
  ctx: TriggerContext,
  marker: (t: TriggeredEffect, before: Player, after: Player) => CombatEvent[],
): { player: Player; enemy: Enemy; events: CombatEvent[] } {
  let p = player;
  let e = enemy;
  const events: CombatEvent[] = [];
  for (const t of triggered) {
    if (t.trigger !== trigger) continue;
    if (t.action.kind === 'revive') continue;
    const r = applyEffectAction(t.action, p, e, ctx);
    events.push(...marker(t, p, r.self), ...r.events);
    p = r.self;
    e = r.other;
  }
  return { player: p, enemy: e, events };
}

/**
 * The player's equipped `revive` action, or `undefined` if none — the Halo Fragment gate
 * (battle.ts) reads its `pctMaxHp`. Pure, RNG-free.
 */
export function reviveActionFor(player: Player): EffectAction | undefined {
  return computeEquipModifiers(player.inventory).triggered.find(
    (t) => t.action.kind === 'revive',
  )?.action;
}
