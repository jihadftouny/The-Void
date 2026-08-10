// Battle state + round step for The Void — pure, framework-agnostic game logic (M5).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: `resolveRound` clones the player/enemy, applies all
//    deltas to the clones, and returns a NEW BattleState plus an ordered event list
//    and a terminal status. The input state is never mutated; nothing is printed.
//  - Deterministic seeded RNG: every draw (enemy skill pick, condition saves, player
//    d20 + damage, flee roll, victory extra-rest + loot) threads the injected `Rng` in a
//    documented order, so a round is exactly reproducible and testable.
//  - Serializable plain-data state: BattleState is flat plain data (player, enemy,
//    act, canFlee) that round-trips through JSON.
//
// Ported from `GameLogic.battle`. The M7 encounter controller loops resolveRound;
// M8 sets `act`/`canFlee` and reads the victory/defeat events. Recorded DEVIATIONS:
//  - Flee uses the LITERAL Java formula `rng()*10 + 1 <= 3.5` (~25% escape), though
//    the Java comment and this task say "~35%". [NEEDS-HUMAN: 25% vs 35%?] The test
//    straddles 3.5 so it is independent of the exact constant.
//  - A failed/blocked flee does NOT tick the fleeing character's conditions (Java
//    does); run consumes only the flee roll + the enemy counter-attack draws.

import { type Player } from './player.ts';
import { type Enemy } from './enemy.ts';
import { type Rng } from './rng.ts';
import { type CombatEvent } from './combatEvent.ts';
import { hasControlCondition, tickConditions, type ConditionType } from './condition.ts';
import { resolveEnemyAttack, resolvePlayerAttack } from './combat.ts';
import { SKILLS, type SkillDef, type SkillId } from './skill.ts';
import { castSkill, grantMomentum, usesMomentum } from './classKit.ts';
import { effectiveMaxHp } from './statEffects.ts';
import { playerArmorClass, enemyAdvDisVs } from './defense.ts';
import { weaponForSlot, UNARMED, pickUp } from './equipment.ts';
import { rollLootDrop, summarizeLoot } from './loot.ts';
import { computeEquipModifiers } from './equipEffects.ts';
import { fireTrigger, reviveActionFor } from './relicEffects.ts';
import { applyConsumable, type ConsumableSource } from './consumable.ts';

/** The full, serializable state of a battle in progress. */
export interface BattleState {
  player: Player;
  enemy: Enemy;
  /** Act 1..5 — combat only reads it (M8 drives progression). */
  act: number;
  /** False in the final act: escape is impossible. */
  canFlee: boolean;
  /**
   * M6, OPTIONAL/transient: the first enemy hit each battle has already landed (Scrap
   * Plating consumed its one free zero-hit). Absent ⇒ not yet consumed. Only a
   * firstHitReduction relic ever sets it, so it stays absent for a normal run.
   */
  firstEnemyHitDone?: boolean;
  /**
   * M6, OPTIONAL/transient: the once-per-battle revive (Halo Fragment) has fired. Absent ⇒
   * still available. Only set when a revive gate triggers, so absent for a normal run.
   */
  reviveUsed?: boolean;
}

/**
 * The player's battle actions: the three string actions plus a structured `cast` (spend
 * a charge to cast a skill from the player's skillPool). The string members keep every
 * existing `'fight'|'potion'|'run'` caller valid; adding a union member breaks no
 * exhaustive switch.
 */
export type BattleAction =
  | 'fight'
  | 'potion'
  | 'run'
  | { kind: 'cast'; skillId: SkillId }
  | { kind: 'useConsumable'; source: ConsumableSource };

/** The state of the battle after a round resolves. */
export type RoundStatus = 'ongoing' | 'player-won' | 'player-died' | 'fled';

/** What `resolveRound` returns: the next state, the events, and a terminal status. */
export interface RoundResult {
  state: BattleState;
  events: CombatEvent[];
  status: RoundStatus;
}

/** Build a fresh battle. `canFlee` is false only in the final act (act 5). */
export function createBattle(player: Player, enemy: Enemy, act: number): BattleState {
  return { player, enemy, act, canFlee: act !== 5 };
}

/**
 * Fire the `startOfBattle` triggers on the player's equipped relics — PURE, RNG-FREE.
 * Returns the (possibly) updated battle plus the emitted events. When nothing is equipped
 * that fires at battle start the ORIGINAL battle object is returned with an empty event
 * list (off-equivalence — a normal battle opens byte-identically). Call once, when a battle
 * becomes active (game.ts flips `started` to true).
 */
export function openBattle(battle: BattleState): { battle: BattleState; events: CombatEvent[] } {
  const fired = fireTrigger('startOfBattle', battle.player, battle.enemy, {});
  if (fired.events.length === 0) return { battle, events: [] };
  return { battle: { ...battle, player: fired.player, enemy: fired.enemy }, events: fired.events };
}

/**
 * The literal Java flee check: `rng()*10 + 1 <= 3.5` (one draw). Escapes when the
 * draw is <= 0.25 (~25%). See the module DEVIATIONS note re: 25% vs 35%.
 */
export function rollFlee(rng: Rng): boolean {
  return rng() * 10 + 1 <= 3.5;
}

/**
 * Resolve one battle round for the chosen action — PURE. Returns a new BattleState,
 * the ordered events, and a terminal status. The input `state` is never mutated.
 *
 * Round draw order (documented for the exact-list test) for Fight/Cast, via the shared
 * `resolvePlayerTurn`: enemy-condition-tick draws (NONE when the enemy is conditionless)
 * -> enemy to-hit d20 (1 draw, or 2 at adv/dis; M4) -> enemy skill-pick draw (ONLY on a
 * hit/crit with charges) -> player-condition-tick draws -> player d20 + damage draws
 * (Fight) or no draw (Cast) -> on victory: extra-rest draw then loot roll.
 */
export function resolveRound(state: BattleState, action: BattleAction, rng: Rng): RoundResult {
  if (typeof action === 'object') {
    if (action.kind === 'cast') return resolveCast(state, action.skillId, rng);
    return resolveUseConsumable(state, action.source, rng);
  }
  switch (action) {
    case 'fight':
      return resolvePlayerTurn(state, { kind: 'fight' }, rng);
    case 'potion':
      return resolvePotion(state);
    case 'run':
      return resolveRun(state, rng);
    /* istanbul ignore next */
    default:
      return { state, events: [], status: 'ongoing' };
  }
}

/** What the player does on their step of a symmetric round: attack, or cast a skill. */
type PlayerTurnAction = { kind: 'fight' } | { kind: 'cast'; skill: SkillDef };

/**
 * The shared symmetric round for Fight and Cast — PURE. Draw order (steps 1-6):
 *  1. Tick ENEMY conditions (player-inflicted DoT/control finally tick). Apply the hp
 *     delta; if the enemy dies to its own DoT before acting, it is still a victory.
 *     Zero rng draws when the enemy is conditionless, so a conditionless round's draws
 *     are exactly the pre-M2 order.
 *  2. Enemy attacks unless a control condition (freeze/etc.) skipped it. It rolls a to-hit
 *     d20 (M4) vs the player's AC — on a miss it deals 0 and draws no skill-pick.
 *  3. Tick the PLAYER's conditions.
 *  4. Player acts unless skipped: Fight rolls d20 + damage; Cast spends a charge and
 *     applies the skill's condition to the enemy (no rng draw). A control-skipped player
 *     never reaches the cast branch, so casting under control spends NO charge.
 *  5. Apply the exchanged damage (clamp hp at 0).
 *  6. Resolve player-died / player-won / ongoing.
 */
function resolvePlayerTurn(
  state: BattleState,
  action: PlayerTurnAction,
  rng: Rng,
): RoundResult {
  const events: CombatEvent[] = [];
  let player: Player = state.player;
  let enemy: Enemy = state.enemy;

  // M6: read the player's aggregated equip modifiers ONCE. Every field below is
  // identity-valued (0 / false / mult 1 / null / []) for effect-free gear, so all the M6
  // branches are no-ops for a normal run (off-equivalence). RNG-FREE — no draw is added.
  const mods = computeEquipModifiers(player.inventory);
  let firstHitDone = state.firstEnemyHitDone ?? false;
  let reviveUsed = state.reviveUsed ?? false;

  // 1. Tick the enemy's conditions. Grave of Embers / Ashen Crown double the enemy's
  //    negative DoT (dotTickMult) — identity 1 for a normal run.
  const etc = tickConditions(enemy, player, rng);
  const enemyTickDelta = etc.hpDelta < 0 ? etc.hpDelta * mods.dotTickMult : etc.hpDelta;
  enemy = { ...enemy, activeConditions: etc.conditions, hp: enemy.hp + enemyTickDelta };
  events.push(...etc.events);
  const skipEnemyAttack = etc.skipTurn;
  if (enemy.hp <= 0) {
    return killAndVictory(state, player, { ...enemy, hp: 0 }, events, rng);
  }

  // 2. Enemy attacks unless skipped. M4: it now rolls to hit vs the player's real AC
  //    (from armor/shield/augments) at the adv/dis the player's class imposes (a Scavver
  //    forces disadvantage). Both are computed from the CURRENT player (before its own
  //    condition tick in step 3). On a miss enemyDamage stays 0, so the momentum hook
  //    below sees no taken damage.
  let enemyDamage = 0;
  if (!skipEnemyAttack) {
    const defenderAc = playerArmorClass(player);
    const enemyAdvDis = enemyAdvDisVs(player);
    const ea = resolveEnemyAttack(enemy, player, defenderAc, enemyAdvDis, rng);
    enemy = ea.enemy;
    player = ea.target;
    enemyDamage = ea.damage;
    events.push(...ea.events);
    // Scrap Plating: the first enemy hit each battle is reduced to 0 (once per battle).
    if (mods.firstHitReduction && !firstHitDone && enemyDamage > 0) {
      enemyDamage = 0;
      firstHitDone = true;
    }
  }

  // 3. Tick the player's conditions (damage/heal/skip/fracture), then apply hp delta.
  const ptc = tickConditions(player, enemy, rng);
  player = { ...player, activeConditions: ptc.conditions, hp: player.hp + ptc.hpDelta };
  if (ptc.advDisOverride !== 0) {
    player = { ...player, advantageDisadvantage: ptc.advDisOverride };
  }
  events.push(...ptc.events);

  // Empty Vessel: restore charge(s) at the player's turn (capped at max). No-op at 0.
  if (mods.chargePerTurn > 0) {
    player = {
      ...player,
      skillCharges: Math.min(player.skillCharges + mods.chargePerTurn, player.maxSkillCharges),
    };
  }

  // 4. Player acts unless a condition made it skip.
  let playerDamage = 0;
  let didHit = false;
  let didCrit = false;
  let didCast = false;
  if (ptc.skipTurn) {
    events.push({ kind: 'player-unable-to-act', conditionType: skipCause(ptc.events) });
  } else if (action.kind === 'fight') {
    // M5: resolve the weapon from the paperdoll mainHand (empty -> UNARMED so an unarmed
    // player never throws) and the flat equip-damage bonus, both injected into combat.ts.
    // Both are off-equivalent for legacy gear (real weapon, 0 bonus), so the draw order and
    // damage are unchanged for a normal run.
    const weapon = weaponForSlot(player.inventory) ?? UNARMED;
    const pa = resolvePlayerAttack(player, enemy, weapon, mods.flatDamage, rng);
    playerDamage = pa.damage;
    didHit = pa.outcome === 'hit' || pa.outcome === 'crit';
    didCrit = pa.outcome === 'crit';
    events.push(...pa.events);
  } else {
    // Cast: spend one charge and resolve the skill through `castSkill` — the base
    // useSkill damage/condition PLUS the class signature twist, all deterministic (NO rng
    // draw, so the documented draw order is unchanged). Forward the twist events; the base
    // `enemy-skill-used` event is dropped in favor of the player-facing `skill-cast`.
    const cast = castSkill(player, enemy, action.skill);
    player = cast.caster;
    enemy = cast.target;
    playerDamage = cast.damage;
    didCast = true;
    // Overclock Chip / Hollow Heart: refund the charge-cost discount castSkill just spent
    // (capped so the effective spend never goes below 0, and never above max).
    if (mods.chargeDiscount > 0) {
      const refund = Math.min(mods.chargeDiscount, action.skill.chargeCost);
      player = {
        ...player,
        skillCharges: Math.min(player.skillCharges + refund, player.maxSkillCharges),
      };
    }
    events.push({ kind: 'skill-cast', subject: 'player', skillId: action.skill.id, name: action.skill.name });
    for (const e of cast.events) {
      if (
        e.kind === 'condition-applied' ||
        e.kind === 'resource-changed' ||
        e.kind === 'self-sacrifice' ||
        e.kind === 'lifesteal' ||
        e.kind === 'detonate'
      ) {
        events.push(e);
      }
    }
  }

  // 4b. Player-damage passive modifiers (RNG-free). Adrenal Shunt adds a flat bonus below
  //     the HP threshold; Void Pact multiplies the total. Both no-op for a normal run.
  if (playerDamage > 0) {
    if (
      mods.lowHpDamageBonus &&
      player.hp < (mods.lowHpDamageBonus.thresholdPct / 100) * effectiveMaxHp(player)
    ) {
      playerDamage += mods.lowHpDamageBonus.amount;
    }
    if (mods.damageDealtMult > 0) {
      playerDamage = Math.floor(playerDamage * (1 + mods.damageDealtMult / 100));
    }
  }

  // 5. Apply the exchanged damage. Grace-Forged Aegis shield absorbs enemy damage before HP.
  let absorbed = 0;
  let shield = player.shield ?? 0;
  if (shield > 0 && enemyDamage > 0) {
    absorbed = Math.min(shield, enemyDamage);
    shield -= absorbed;
    enemyDamage -= absorbed;
    player = { ...player, shield };
    events.push({ kind: 'shield-absorbed', amount: absorbed });
  }
  player = { ...player, hp: Math.max(player.hp - enemyDamage, 0) };
  enemy = { ...enemy, hp: Math.max(enemy.hp - playerDamage, 0) };

  // Momentum-on-damage hooks (Enforcer only): dealing damage grants +1 and taking enemy
  // damage grants +1, capped. SILENT (no event) and pure arithmetic (no rng draw), so a
  // conditionless round stays byte-identical for non-momentum classes and adds no draw.
  if (usesMomentum(player)) {
    let gain = 0;
    if (playerDamage > 0) gain += 1;
    if (enemyDamage > 0) gain += 1;
    if (gain > 0) player = grantMomentum(player, gain);
  }

  // 5b. Fire triggered relic effects (RNG-free). Order: onTakeDamage (enemy struck first,
  //     in step 2) then the player's action triggers. `damageTaken` is the HP damage after
  //     shield. Empty for effect-free gear (off-equivalence).
  if (enemyDamage > 0) {
    const t = fireTrigger('onTakeDamage', player, enemy, { damageTaken: enemyDamage });
    player = t.player; enemy = t.enemy; events.push(...t.events);
  }
  if (didHit) {
    const t = fireTrigger('onHit', player, enemy, {});
    player = t.player; enemy = t.enemy; events.push(...t.events);
  }
  if (didCrit) {
    const t = fireTrigger('onCrit', player, enemy, {});
    player = t.player; enemy = t.enemy; events.push(...t.events);
  }
  if (didCast) {
    const t = fireTrigger('onCast', player, enemy, {});
    player = t.player; enemy = t.enemy; events.push(...t.events);
  }

  // 6. Resolve the outcome (player death checked first, faithful to pre-M2) — with the
  //    Halo Fragment revive gate intercepting lethal damage once per battle.
  if (player.hp <= 0) {
    const rev = reviveActionFor(player);
    if (rev && !reviveUsed) {
      const healedTo = Math.max(
        Math.floor((effectiveMaxHp(player) * (rev.params.pctMaxHp ?? 25)) / 100),
        1,
      );
      player = { ...player, hp: healedTo };
      reviveUsed = true;
      events.push({ kind: 'revive', healedTo });
    } else {
      events.push({ kind: 'defeat' });
      return { state: withFlags(state, player, enemy, firstHitDone, reviveUsed), events, status: 'player-died' };
    }
  }
  if (enemy.hp <= 0) {
    return killAndVictory(state, player, enemy, events, rng);
  }
  return { state: withFlags(state, player, enemy, firstHitDone, reviveUsed), events, status: 'ongoing' };
}

/**
 * Build the next BattleState, threading the two transient M6 flags. They are set only when
 * TRUE (never written as `false`/`undefined`), so a relic-less round produces a state
 * byte-identical to the pre-M6 `{ ...state, player, enemy }` (off-equivalence).
 */
function withFlags(
  state: BattleState,
  player: Player,
  enemy: Enemy,
  firstHitDone: boolean,
  reviveUsed: boolean,
): BattleState {
  const next: BattleState = { ...state, player, enemy };
  if (firstHitDone) next.firstEnemyHitDone = true;
  if (reviveUsed) next.reviveUsed = true;
  return next;
}

/**
 * Fire the `onKill` triggers (Devourer's Maw's permanent stat steal, etc.) on the player who
 * just felled the enemy, then hand off to `applyVictory` — PURE. RNG-free trigger step, so
 * the victory draw order (extra-rest then loot) is unchanged. Off-equivalent for a normal
 * run (no onKill trigger fires, so the player is unchanged before rewards).
 */
function killAndVictory(
  state: BattleState,
  player: Player,
  enemy: Enemy,
  events: CombatEvent[],
  rng: Rng,
): RoundResult {
  const k = fireTrigger('onKill', player, enemy, {});
  events.push(...k.events);
  return applyVictory(state, k.player, k.enemy, events, rng);
}

/**
 * The player casts a skill from their pool — pre-guard then the shared round. If the
 * skill is unknown, not in `player.skillPool`, or the player lacks the charge, this is a
 * no-op: state unchanged, a single `cast-unavailable` event, `ongoing`, and NO rng draw
 * (mirrors an unavailable potion). Otherwise it runs `resolvePlayerTurn` as a cast.
 */
function resolveCast(state: BattleState, skillId: SkillId, rng: Rng): RoundResult {
  const player = state.player;
  const skill = SKILLS[skillId];
  // Overclock Chip / Hollow Heart cut the effective charge cost (never below 0). 0 for a
  // normal run, so availability is unchanged (off-equivalence).
  const discount = computeEquipModifiers(player.inventory).chargeDiscount;
  const effectiveCost = Math.max((skill?.chargeCost ?? 0) - discount, 0);
  if (!skill || !player.skillPool.includes(skillId) || player.skillCharges < effectiveCost) {
    return { state, events: [{ kind: 'cast-unavailable' }], status: 'ongoing' };
  }
  return resolvePlayerTurn(state, { kind: 'cast', skill }, rng);
}

/**
 * The shared victory block — PURE. Grants xp = enemy.xp, rolls the extra-rest chance
 * (`rng()*100+1 <= 25`) THEN a found-loot drop (`rollLootDrop(state.act, rng)`) IN THAT ORDER,
 * and emits the `victory` event. Extracted so an enemy killed by its own DoT tick (before it
 * acts) awards exactly the same rewards as a kill by the player's action. M7: the old gold
 * draw is replaced by the loot roll — a non-null drop is picked up into the backpack and
 * summarized on `victory.loot`; a failed drop gate leaves the backpack untouched and
 * `victory.loot` empty (the loot roll still consumes its single gate draw).
 */
function applyVictory(
  state: BattleState,
  player: Player,
  enemy: Enemy,
  events: CombatEvent[],
  rng: Rng,
): RoundResult {
  const xpGained = enemy.xp;
  const extraRest = rng() * 100 + 1 <= 25;
  const drop = rollLootDrop(state.act, rng);
  const inventory = drop ? pickUp(player.inventory, drop) : player.inventory;
  const loot = drop ? [summarizeLoot(drop)] : [];
  const newPlayer: Player = {
    ...player,
    xp: player.xp + xpGained,
    restsLeft: player.restsLeft + (extraRest ? 1 : 0),
    inventory,
  };
  events.push({ kind: 'victory', xpGained, extraRest, loot });
  return { state: { ...state, player: newPlayer, enemy }, events, status: 'player-won' };
}

function resolvePotion(state: BattleState): RoundResult {
  const player = state.player;
  if (hasControlCondition(player)) {
    return { state, events: [{ kind: 'potion-blocked' }], status: 'ongoing' };
  }
  // Void Pact's `cannotHeal` blocks the potion heal site. 0/false for a normal run, so the
  // potion path is byte-identical (off-equivalence).
  if (computeEquipModifiers(player.inventory).cannotHeal) {
    return { state, events: [{ kind: 'potion-unavailable' }], status: 'ongoing' };
  }
  // Heal cap is the EFFECTIVE max HP (Hardy raises it, Frail lowers it). Off-equivalent:
  // equals the stored maxHp when no CON augment is active.
  const cap = effectiveMaxHp(player);
  if (player.pots > 0 && player.hp < cap) {
    const healed: Player = { ...player, hp: cap, pots: player.pots - 1 };
    return {
      state: { ...state, player: healed },
      events: [{ kind: 'potion-drunk', healedTo: cap }],
      status: 'ongoing',
    };
  }
  return { state, events: [{ kind: 'potion-unavailable' }], status: 'ongoing' };
}

/**
 * Use a backpack consumable as the player's action — PURE. Delegates the RNG-free effect
 * application to `consumable.applyConsumable`, then resolves the round: an unavailable item is
 * a no-op (state unchanged, `consumable-unavailable`); a `flee` consumable ends the round as
 * `fled`; a throwable that drops the enemy to 0 is a victory (rewards rolled via
 * `killAndVictory`); a self-lethal outcome (none ship today) is a defeat; otherwise `ongoing`.
 * NO enemy counter-attack — using an item costs the turn exactly like the potion action.
 */
function resolveUseConsumable(
  state: BattleState,
  source: ConsumableSource,
  rng: Rng,
): RoundResult {
  const res = applyConsumable(state.player, state.enemy, source);
  if (!res.consumed) {
    return { state, events: res.events, status: 'ongoing' };
  }
  const player = res.player;
  const enemy = res.enemy;
  const events = res.events;
  if (res.fled) {
    return { state: { ...state, player, enemy }, events, status: 'fled' };
  }
  if (player.hp <= 0) {
    events.push({ kind: 'defeat' });
    return { state: { ...state, player, enemy }, events, status: 'player-died' };
  }
  if (enemy.hp <= 0) {
    return killAndVictory(state, player, enemy, events, rng);
  }
  return { state: { ...state, player, enemy }, events, status: 'ongoing' };
}

function resolveRun(state: BattleState, rng: Rng): RoundResult {
  if (!state.canFlee) {
    return { state, events: [{ kind: 'escape-impossible' }], status: 'ongoing' };
  }
  // A controlled (stunned/etc.) player cannot even attempt to flee: forced counter.
  if (hasControlCondition(state.player)) {
    return enemyCounterAttack(state, rng);
  }
  if (rollFlee(rng)) {
    return { state: { ...state }, events: [{ kind: 'fled' }], status: 'fled' };
  }
  return enemyCounterAttack(state, rng);
}

/** Shared "your escape failed, take a counter-attack" path (also the controlled case). */
function enemyCounterAttack(state: BattleState, rng: Rng): RoundResult {
  const defenderAc = playerArmorClass(state.player);
  const enemyAdvDis = enemyAdvDisVs(state.player);
  const ea = resolveEnemyAttack(state.enemy, state.player, defenderAc, enemyAdvDis, rng);
  const enemy: Enemy = ea.enemy;
  const player: Player = { ...ea.target, hp: Math.max(ea.target.hp - ea.damage, 0) };
  const events: CombatEvent[] = [...ea.events, { kind: 'escape-failed', damage: ea.damage }];
  if (player.hp <= 0) {
    events.push({ kind: 'defeat' });
    return { state: { ...state, player, enemy }, events, status: 'player-died' };
  }
  return { state: { ...state, player, enemy }, events, status: 'ongoing' };
}

/** Name the condition that made the player skip, from the emitted skip events. */
function skipCause(events: CombatEvent[]): ConditionType {
  for (const e of events) {
    if (e.kind === 'condition-skip') return e.conditionType;
  }
  return 'stun';
}
