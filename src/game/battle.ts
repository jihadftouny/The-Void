// Battle state + round step for The Void — pure, framework-agnostic game logic (M5).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: `resolveRound` clones the player/enemy, applies all
//    deltas to the clones, and returns a NEW BattleState plus an ordered event list
//    and a terminal status. The input state is never mutated; nothing is printed.
//  - Deterministic seeded RNG: every draw (enemy skill pick, condition saves, player
//    d20 + damage, flee roll, victory loot) threads the injected `Rng` in a
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
import { damageEnemy, type Enemy } from './enemy.ts';
import { getFamily } from './enemyFamily.ts';
import { rollDie, type Rng } from './rng.ts';
import { type CombatEvent, type DamageSource, withDamageSource } from './combatEvent.ts';
import { hasControlCondition, tickConditions, type ConditionType } from './condition.ts';
import { combineAdvDis, resolveEnemyAttack, resolvePlayerAttack } from './combat.ts';
import { resolveSkill, type SkillDef, type SkillId } from './skill.ts';
import { castSkill, clampMomentum, grantMomentum, usesMomentum } from './classKit.ts';
import { perkModifiers } from './perks.ts';
import { effectiveMaxHp, effectiveMods } from './statEffects.ts';
import { playerArmorClass, enemyAdvDisVs } from './defense.ts';
import { weaponForSlot, UNARMED, pickUp } from './equipment.ts';
import { rollLootDrop, summarizeLoot } from './loot.ts';
import { computeEquipModifiers, effectiveChargeCost, type EquipModifiers } from './equipEffects.ts';
import { fireFloorTriggers, fireTrigger, reviveActionFor } from './relicEffects.ts';
import { applyConsumable, type ConsumableSource } from './consumable.ts';
import { ILLUSION_DC, type FloorId } from './floors.ts';

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
  /**
   * M12, OPTIONAL: the boss mechanic riding on this battle. ABSENT for every normal
   * (non-boss) battle ⇒ byte-identical off-equivalence: `resolveRound` never reads it and it
   * survives the `{ ...state, ... }` spreads untouched. The boss extras (`bossPostRound`) are
   * layered by game.ts AFTER `resolveRound`, so combat stays fully off-equivalent. `BossState`
   * is imported as a TYPE only (erased at build), so no runtime import cycle with `boss.ts`.
   */
  boss?: import('./boss.ts').BossState;
  /**
   * G12, OPTIONAL: the player's STANDING advantage/disadvantage for THIS battle — the ambush
   * bonus a random encounter opens with (+1), or a boss's adaptation (-1). Battle-scoped by
   * construction: it lives on the battle, not the player, so it cannot leak into the next one.
   *
   * ABSENT means 0 (no standing modifier), so a battle with none is byte-identical in JSON to
   * a pre-G12 battle and needs no `SAVE_VERSION` bump. Per-round it is COMBINED with whatever
   * the player's condition tick produced (`combineAdvDis`), which is what makes advantage a
   * per-round computation instead of the write-only latch it used to be.
   */
  playerAdvantage?: -1 | 0 | 1;
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
  | 'spare'
  | { kind: 'cast'; skillId: SkillId }
  | { kind: 'useConsumable'; source: ConsumableSource };

/**
 * The per-floor rules a round is resolved under (PLAN.md #2). Passed IN by `game.ts`, which
 * derives them from `state.place` — the battle itself stores no floor, so a mid-battle save's
 * shape is unchanged and the rules can never disagree with where the run actually is.
 *
 * `DEFAULT_ROUND_RULES` is the identity (no floor mechanic), and every caller that passes
 * nothing — every pre-#2 test, every direct `resolveRound` caller — gets exactly today's round.
 */
export interface RoundRules {
  /** Percent of every dampenable heal the player receives (floor 3: 50). Identity 100. */
  healPct: number;
  /** The Difficulty Class of the passive Wisdom roll against an illusion (`floors.ts`). */
  illusionDc: number;
}

/** No floor mechanic: full heals, the shipped illusion DC. */
export const DEFAULT_ROUND_RULES: RoundRules = { healPct: 100, illusionDc: ILLUSION_DC };

/**
 * The state of the battle after a round resolves. `dispelled` (PLAN.md #2): the passive Wisdom
 * roll saw through an illusory enemy and the fight simply ends — no XP, no loot; `game.ts`
 * records `seeThroughIllusion` and returns to the hub.
 */
export type RoundStatus = 'ongoing' | 'player-won' | 'player-died' | 'fled' | 'spared' | 'dispelled';

/** What `resolveRound` returns: the next state, the events, and a terminal status. */
export interface RoundResult {
  state: BattleState;
  events: CombatEvent[];
  status: RoundStatus;
  /**
   * G36: did a ROUND actually happen?
   *
   * `resolveRound` returns `status: 'ongoing'` for six NO-OP REJECTIONS as well as for a real
   * round — `escape-impossible`, `potion-unavailable`, `potion-blocked`, `cast-unavailable`,
   * `consumable-unavailable`, `spare-unavailable`. None of them resolves anything: no dice,
   * no tick, no state change. `game.ts` gated the boss's per-round mechanic on the status
   * alone, so it fired for those too. Measured: the Run button is rendered in every battle
   * and bosses set `canFlee: false`, so NINE REJECTED "Run" PRESSES AGAINST THE ACT-1 KINGPIN
   * COST 11 HP to minions the press had no business summoning; against the Reflection, three
   * REJECTED casts burned its once-per-battle adaptation, permanently disadvantaging the
   * player for pressing a button the engine had just told them did nothing.
   *
   * Required (not optional) so no future return site can silently omit it. A rejected press
   * costs NOTHING. Note the one deliberate exception: a flee consumable used against a boss
   * IS resolved — the item was spent and the turn with it (G39).
   */
  resolved: boolean;
}

/**
 * Momentum carried across a battle boundary, as a fraction of what was banked (Enforcer).
 *
 * ⚠ M15/#2 BALANCE PLACEHOLDER — this rate is a number nobody has measured. The AUTHOR ruled
 * (2026-09-01, `FINDINGS.md` G34 / `GAME-DESIGN.md` §22.19) that momentum CARRIES BETWEEN
 * BATTLES WITH DECAY rather than resetting: `floor(momentum * MOMENTUM_CARRY)`. Halving is the
 * stated starting value only — it keeps a good streak worth something while draining most of
 * it, which is the feel target. "Reward a streak, mostly drain" is a feel target, not a
 * measured one; `PLAN.md` #2's balance re-run owns tuning it. Deterministic: no rng, no clock.
 */
export const MOMENTUM_CARRY = 0.5;

/** Options for `createBattle`: the boss riding on the battle, and its opening advantage. */
export interface CreateBattleOptions {
  /** M12 boss mechanic. Its presence is ALSO what makes the battle unfleeable (G4). */
  boss?: import('./boss.ts').BossState;
  /** Standing advantage the battle opens with (a random encounter's ambush is +1). */
  openingAdvantage?: -1 | 0 | 1;
}

/**
 * Strip the TRANSIENT combat state a battle must not inherit from the last one — PURE,
 * RNG-FREE. Exported so the reset is testable on its own and has exactly one definition.
 *
 * `game.ts` writes `battle.player` back to `state.player` on every outcome, so anything a
 * battle leaves on the player rides into the next fight. Three fields were leaking:
 *   - `shield`  (G25) — documented as a "transient combat shield", but only ever written as
 *     `+= amt` at battle open and `-= absorbed` on a hit. Measured with Grace-Forged Aegis
 *     over five battles: shield at start 5, 10, 15, 20, 25 — climbing all run and surviving
 *     the save file, until the player was immune to chip damage.
 *   - `advantageDisadvantage` (G12) — see below.
 *   - `momentum` (G34) — now DECAYED rather than zeroed; see `MOMENTUM_CARRY`.
 *
 * ⚠ `activeConditions` is DELIBERATELY NOT CLEARED HERE, against `PLAN.md` #0 item 24's
 * "close all four leaks in `createBattle`". Clearing it would break G27: `fracture` carries
 * `maxTurns: 100` with the comment "needs a rest", and G27's fix is to cure conditions AT THE
 * REST NODE. If a battle boundary cured them, fracture would expire on its own and the reason
 * G27 exists would be gone. Three leaks are closed here; the fourth is closed at the rest.
 * (G34's own row is correct — only the #0 prose summary overreaches.)
 */
export function resetTransientCombatState(player: Player): Player {
  const next: Player = { ...player, advantageDisadvantage: 0 };
  // Only touch the optional fields that are actually present, so a player who has never held
  // a shield keeps the exact JSON shape it had before (off-equivalence for a normal run).
  if (next.shield !== undefined) next.shield = 0;
  if (next.momentum !== undefined) {
    next.momentum = clampMomentum(Math.floor(next.momentum * MOMENTUM_CARRY));
  }
  return next;
}

/**
 * Build a fresh battle — the SINGLE FUNNEL every battle passes through, and therefore the one
 * place the per-battle rules are enforced rather than left to call-site convention.
 *
 *  - **G4.** `canFlee` is false in the final act OR whenever a boss rides on the battle. Both
 *    boss call sites used to stamp `canFlee: false` by hand after the fact, which is a
 *    convention a future call site can silently forget; now it is structural.
 *  - **G12/G25/G34.** The player's transient combat state is reset here
 *    (`resetTransientCombatState`), so nothing a battle banks can leak into the next one.
 *  - **G12.** A standing advantage is battle-scoped state (`playerAdvantage`), not a latch
 *    written onto the player. `encounter.ts` used to stamp `advantageDisadvantage: 1` on the
 *    player for its ambush bonus and `game.ts` persisted it to the hub — so EVERY floor boss
 *    and the final Hollow was fought at advantage, and a fracture stuck it at -1 in the other
 *    direction. Boss difficulty swung ±5 to-hit on leftover state.
 *
 * `playerAdvantage` is written only when non-zero, so a battle with no standing modifier is
 * byte-identical in JSON to a pre-G12 one.
 */
export function createBattle(
  player: Player,
  enemy: Enemy,
  act: number,
  opts?: CreateBattleOptions,
): BattleState {
  const state: BattleState = {
    player: resetTransientCombatState(player),
    enemy,
    act,
    canFlee: act !== 5 && !opts?.boss,
  };
  if (opts?.boss) state.boss = opts.boss;
  const opening = opts?.openingAdvantage ?? 0;
  if (opening !== 0) state.playerAdvantage = opening;
  return state;
}

/**
 * Fire the `startOfBattle` triggers on the player's equipped relics — PURE, RNG-FREE.
 * Returns the (possibly) updated battle plus the emitted events. When nothing is equipped
 * that fires at battle start the ORIGINAL battle object is returned with an empty event
 * list (off-equivalence — a normal battle opens byte-identically). Call once, when a battle
 * becomes active (game.ts flips `started` to true).
 */
export function openBattle(
  battle: BattleState,
  floor?: FloorId,
): { battle: BattleState; events: CombatEvent[] } {
  const fired = fireTrigger('startOfBattle', battle.player, battle.enemy, {});
  // PLAN.md #2: then the FLOOR's `startOfBattle` triggers (floor 3's charge bleed), through the
  // same loop and the same `applyEffectAction` a relic uses. Relics first, so a relic that
  // restores a charge at battle open is not cancelled by a drain that ran before it existed.
  // `floor` omitted ⇒ today's behaviour byte-for-byte (every pre-#2 caller).
  const floored =
    floor === undefined
      ? { player: fired.player, enemy: fired.enemy, events: [] as CombatEvent[] }
      : fireFloorTriggers('startOfBattle', floor, fired.player, fired.enemy, {});
  const events = [...fired.events, ...floored.events];
  // Nothing fired ⇒ the ORIGINAL battle object (off-equivalence). A drain with no charge to
  // take emits nothing and changes nothing, so it lands here too.
  if (events.length === 0) return { battle, events: [] };
  return { battle: { ...battle, player: floored.player, enemy: floored.enemy }, events };
}

// ------- THE ONE GUARDED PLAYER-DAMAGE PATH (G24, G29) ------------------------
//
// Damage to the player used to be applied at FOUR different places, and only ONE of them ran
// the guards `resolvePlayerTurn` owns. The register measured all three failures:
//   - `enemyCounterAttack` (the failed-escape counter) subtracted HP raw and checked death
//     raw, skipping shield absorb, the Scrap Plating first-hit reduction, the `onTakeDamage`
//     relic triggers AND the once-per-battle revive. So the Halo Fragment did NOT save you at
//     a failed escape, while the same relic works correctly against an ordinary round.
//   - `boss.ts`'s Kingpin minions wrote `player.hp` directly and decided `player-died`
//     themselves. `BALANCE-REPORT.md` names the act-1 Kingpin as the single biggest act-1
//     killer, so THIS IS THE DEATH THAT HAPPENS MOST — with shield absorbing nothing, no
//     revive, and Mirror Shard reflecting nothing.
//   - `resolveUseConsumable` missed the revive gate.
// Every step below is RNG-FREE, so folding the four sites into one changes no draw.

/** What `applyDamageToPlayer` needs beyond the damage number itself. */
interface PlayerDamageContext {
  /** The player's aggregated equip modifiers (read once by the caller). */
  mods: EquipModifiers;
  /** Has Scrap Plating's one free zero-damage hit already been consumed this battle? */
  firstHitDone: boolean;
  /** Has the once-per-battle revive already fired this battle? */
  reviveUsed: boolean;
  /** The live event list; the helper appends to it (and may fold into an earlier entry). */
  events: CombatEvent[];
  /**
   * Where in `events` the attack that REPORTED this damage sits, so a first-hit reduction can
   * be folded back into it as a negative term instead of leaving the log announcing damage the
   * player never took. Omitted when the damage came from no attack event (boss minions).
   */
  attackEventIndex?: number;
}

/** What `applyDamageToPlayer` returns. */
interface PlayerDamageResult {
  player: Player;
  enemy: Enemy;
  firstHitDone: boolean;
  reviveUsed: boolean;
  /** HP damage ACTUALLY taken, after the first-hit reduction and after shield absorption. */
  applied: number;
  /** True when the player is at 0 HP and the revive gate did not (or could not) save them. */
  died: boolean;
}

/**
 * Apply `damage` to the player through every defensive guard, in order — PURE and RNG-FREE.
 *
 *   1. first-hit reduction (Scrap Plating), folded back into the reporting attack event as a
 *      NEGATIVE term so the log shows the 0 HP actually lost;
 *   2. shield absorb, emitting `shield-absorbed`;
 *   3. the HP subtraction, clamped at 0;
 *   4. the `onTakeDamage` relic triggers (they read the post-shield HP damage);
 *   5. the once-per-battle revive gate, emitting `revive`.
 *
 * This is the ONLY place any of those five steps happens.
 */
function applyDamageToPlayer(
  player: Player,
  enemy: Enemy,
  damage: number,
  ctx: PlayerDamageContext,
): PlayerDamageResult {
  let p = player;
  let e = enemy;
  let amount = damage;
  let firstHitDone = ctx.firstHitDone;
  let reviveUsed = ctx.reviveUsed;

  // 1. Scrap Plating: the first enemy hit each battle is reduced to 0 (once per battle).
  if (ctx.mods.firstHitReduction && !firstHitDone && amount > 0) {
    if (ctx.attackEventIndex !== undefined) {
      foldDamageSource(ctx.events, ctx.attackEventIndex, {
        kind: 'first-hit-reduction',
        amount: -amount,
      });
    }
    amount = 0;
    firstHitDone = true;
  }

  // 2. Grace-Forged Aegis: the shield eats damage before HP, in its own event.
  const shield = p.shield ?? 0;
  if (shield > 0 && amount > 0) {
    const absorbed = Math.min(shield, amount);
    amount -= absorbed;
    p = { ...p, shield: shield - absorbed };
    ctx.events.push({ kind: 'shield-absorbed', amount: absorbed });
  }

  // 3. HP.
  p = { ...p, hp: Math.max(p.hp - amount, 0) };

  // 4. onTakeDamage relics (Mirror Shard's reflect, etc.). `damageTaken` is the HP damage
  //    after shield. Empty for effect-free gear (off-equivalence).
  if (amount > 0) {
    const t = fireTrigger('onTakeDamage', p, e, { damageTaken: amount });
    p = t.player;
    e = t.enemy;
    ctx.events.push(...t.events);
  }

  // 5. The Halo Fragment revive gate, intercepting lethal damage once per battle.
  let died = false;
  if (p.hp <= 0) {
    const rev = reviveActionFor(p);
    if (rev && !reviveUsed) {
      const healedTo = Math.max(Math.floor((effectiveMaxHp(p) * (rev.params.pctMaxHp ?? 25)) / 100), 1);
      p = { ...p, hp: healedTo };
      reviveUsed = true;
      ctx.events.push({ kind: 'revive', healedTo });
    } else {
      died = true;
    }
  }

  return { player: p, enemy: e, firstHitDone, reviveUsed, applied: amount, died };
}

/**
 * Apply damage that did not come from the round's own exchange — currently the Kingpin's
 * minions (G29) — through the same guarded path, and thread the per-battle flags back onto
 * the battle. PURE, RNG-FREE. Exported so `game.ts` can layer the boss mechanic without
 * `boss.ts` needing to import the equipment/relic stack or decide a death itself.
 */
export function applyDamageToBattlePlayer(
  state: BattleState,
  damage: number,
  events: CombatEvent[],
): { state: BattleState; died: boolean } {
  const res = applyDamageToPlayer(state.player, state.enemy, damage, {
    mods: computeEquipModifiers(state.player.inventory),
    firstHitDone: state.firstEnemyHitDone ?? false,
    reviveUsed: state.reviveUsed ?? false,
    events,
  });
  return {
    state: withFlags(state, res.player, res.enemy, res.firstHitDone, res.reviveUsed),
    died: res.died,
  };
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
 * (Fight) or no draw (Cast) -> on victory: the loot roll. (PLAN.md #2 deleted the victory's
 * extra-rest draw with the banked rest counter, so every draw after a victory moved up by one — a
 * deliberate, ledgered re-baseline in `offEquivalence.test.ts`.)
 */
export function resolveRound(
  state: BattleState,
  action: BattleAction,
  rng: Rng,
  rules: RoundRules = DEFAULT_ROUND_RULES,
): RoundResult {
  if (typeof action === 'object') {
    if (action.kind === 'cast') return resolveCast(state, action.skillId, rng, rules);
    return resolveUseConsumable(state, action.source, rng, rules);
  }
  switch (action) {
    case 'fight':
      return resolvePlayerTurn(state, { kind: 'fight' }, rng, rules);
    case 'potion':
      return resolvePotion(state);
    case 'run':
      return resolveRun(state, rng);
    case 'spare':
      return resolveSpare(state);
    /* istanbul ignore next */
    default:
      return { state, events: [], status: 'ongoing', resolved: false };
  }
}

/**
 * Whether the player may spare/release the current enemy — PURE, RNG-free. Only a
 * living karma-weighted (⚖) enemy can be spared. The render layer calls this to gate
 * the Spare button; `resolveSpare` re-checks so a spurious 'spare' action is a safe no-op.
 */
export function spareAvailable(battle: BattleState): boolean {
  return battle.enemy.karmaWeighted && battle.enemy.hp > 0;
}

/**
 * Resolve a spare/release — PURE, ZERO rng draws, no counter-attack. Against a non-⚖
 * enemy the action is unavailable: a no-op that leaves the battle ongoing (mirrors an
 * unavailable potion), so no karma can be recorded off a non-⚖ enemy. Against a ⚖ enemy
 * it ends the encounter as `spared` (mercy) — the enemy is NOT killed (hp unchanged, no
 * XP/loot); the karma write happens one level up in game.ts, which owns the karma vector.
 */
function resolveSpare(state: BattleState): RoundResult {
  if (!state.enemy.karmaWeighted) {
    return { state, events: [{ kind: 'spare-unavailable' }], status: 'ongoing', resolved: false };
  }
  return {
    state,
    events: [{ kind: 'spared', enemyName: state.enemy.fullName }],
    status: 'spared',
    resolved: true,
  };
}

/** What the player does on their step of a symmetric round: attack, or cast a skill. */
type PlayerTurnAction = { kind: 'fight' } | { kind: 'cast'; skill: SkillDef };

/**
 * The shared symmetric round for Fight and Cast — PURE. Draw order (steps 0-6):
 *  0. PLAN.md #2, floor 2 — ONLY against an `illusory` enemy: ONE d20 draw, the passive Wisdom
 *     roll `d20 + effective WIS mod` (Lucid / Clouded shift it through `effectiveMods`) against
 *     `rules.illusionDc`. At or above the DC the illusion is seen through: `illusion-dispelled`
 *     (carrying the roll), status `dispelled`, and NOTHING else happens this round — no
 *     further draw, no attack either way. Below it, the round runs as below, except that no
 *     damage reaches the enemy (`damageEnemy`) and the enemy's attack is real. A real enemy
 *     takes NO draw here, so every non-illusory round keeps its exact pre-#2 draw order.
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
  rules: RoundRules,
): RoundResult {
  const events: CombatEvent[] = [];
  let player: Player = state.player;
  let enemy: Enemy = state.enemy;

  // 0. PLAN.md #2: the passive Wisdom roll against an illusion (see the doc comment above).
  if (enemy.illusory) {
    const natural = rollDie(rng, 20);
    const modifier = effectiveMods(player).WIS;
    const total = natural + modifier;
    if (total >= rules.illusionDc) {
      return {
        state,
        events: [{ kind: 'illusion-dispelled', natural, modifier, total, dc: rules.illusionDc }],
        status: 'dispelled',
        resolved: true,
      };
    }
    // A FAILED roll emits nothing: saying so would name the illusion before it is seen through.
  }

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
  // G22(a), enemy half: a HEALING tick (regeneration) is capped at the enemy's effective max
  // HP. The player side had the same hole and the same one-line fix; closing only one would
  // leave the mirror bug live. Negative deltas are untouched (the 0 floor is applied below /
  // at step 5), and the cap is read from the POST-tick conditions so an augment that expired
  // this very tick no longer inflates it.
  const tickedEnemy: Enemy = { ...enemy, activeConditions: etc.conditions };
  const rawEnemyHp = enemy.hp + enemyTickDelta;
  enemy = {
    ...tickedEnemy,
    // PLAN.md #2: an illusion LOSES nothing to a damage-over-time tick either (the tick's own
    // `condition-damage` line still reads as damage — the fracture is what the player sees),
    // or a bleed cast on it would kill it and pay out XP and loot for a thing that is not there.
    hp:
      enemyTickDelta > 0
        ? Math.min(rawEnemyHp, effectiveMaxHp(tickedEnemy))
        : enemy.illusory
          ? enemy.hp
          : rawEnemyHp,
  };
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
  /** Where the enemy's attack event landed, so step 5 can fold a reduction into it. */
  let enemyAttackIndex: number | undefined;
  if (!skipEnemyAttack) {
    const defenderAc = playerArmorClass(player);
    // G30: the enemy's roll now combines the adv/dis its TARGET imposes (Scavver evasion)
    // with the override its OWN condition tick just produced. Step 3 always read
    // `advDisOverride` for the player and step 2 never read it for the enemy, so the enemy
    // half of `fracture` — inflicted by `heavyStrike`, the Enforcer's core skill — had no
    // consumer at all: a fractured enemy and a clean one rolled byte-identically. The
    // existing `disadvantage {subject:'enemy'}` event now fires for it, so the log shows it
    // too, with NO new event kind.
    const enemyAdvDis = combineAdvDis(enemyAdvDisVs(player), etc.advDisOverride);
    const ea = resolveEnemyAttack(enemy, player, defenderAc, enemyAdvDis, rng);
    enemy = ea.enemy;
    player = ea.target;
    enemyDamage = ea.damage;
    events.push(...ea.events);
    // `resolveEnemyAttack` always pushes its `attack` event LAST, so after this spread the
    // attack sits at the end of `events`. Asserted by a test in combat.test.ts. The index is
    // captured here and used at step 5, where the shared damage helper folds any first-hit
    // reduction back into it.
    enemyAttackIndex = events.length - 1;
  }

  // 3. Tick the player's conditions (damage/heal/skip/fracture), then apply hp delta.
  const ptc = tickConditions(player, enemy, rng);
  // G22(a): a HEALING tick (regeneration, Penitent consecrate) is capped at the player's
  // effective max HP. Before this, `hp + ptc.hpDelta` was written raw, so a regeneration tick
  // could leave `hp > maxHp` — reproduced in the register. Same shape as the enemy clamp in
  // step 1; the cap reads the POST-tick conditions.
  const tickedPlayer: Player = { ...player, activeConditions: ptc.conditions };
  const rawPlayerHp = player.hp + ptc.hpDelta;
  player = {
    ...tickedPlayer,
    hp: ptc.hpDelta > 0 ? Math.min(rawPlayerHp, effectiveMaxHp(tickedPlayer)) : rawPlayerHp,
  };
  // G12: the condition's adv/dis is NO LONGER written onto the player. That write was the
  // whole defect — it fired only when non-zero, so nothing ever restored it to 0, and
  // `game.ts` persisted it to the hub player. It is now combined per-round, below, with the
  // battle's own standing modifier and thrown away at the end of the round.
  events.push(...ptc.events);
  // The player's advantage for THIS round: the battle's standing modifier (an encounter's
  // ambush, a boss's adaptation) combined with whatever this tick's conditions imposed.
  // Advantage and disadvantage cancel — see `combineAdvDis`.
  const playerAdvDis = combineAdvDis(state.playerAdvantage ?? 0, ptc.advDisOverride);

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
  // Where the player's damaging event landed in `events`, so step 4b's post-hoc modifiers
  // can be folded back into it. -1 when the player dealt no damaging action this round.
  let playerDamageEventIndex = -1;
  if (ptc.skipTurn) {
    events.push({ kind: 'player-unable-to-act', conditionType: skipCause(ptc.events) });
  } else if (action.kind === 'fight') {
    // M5: resolve the weapon from the paperdoll mainHand (empty -> UNARMED so an unarmed
    // player never throws) and the flat equip-damage bonus, both injected into combat.ts.
    // Both are off-equivalent for legacy gear (real weapon, 0 bonus), so the draw order and
    // damage are unchanged for a normal run.
    const weapon = weaponForSlot(player.inventory) ?? UNARMED;
    // M9: the player's wired damage perks (sharpEdge) ride the SAME flat-damage seam as the
    // equip bonus. Off-equivalent (0) for a player with no such perk. M-UI2 passes the two
    // SEPARATELY (they used to be summed here) purely so the emitted breakdown can name
    // gear and perks apart; they are added at the same point, so the total is unchanged.
    const pa = resolvePlayerAttack(
      player,
      enemy,
      weapon,
      mods.flatDamage,
      rng,
      perkModifiers(player.perks).flatDamage,
      // G12: the round's adv/dis is INJECTED, mirroring how the enemy's is already computed
      // here and injected. `Attacker.advantageDisadvantage` survives as the standing default
      // for callers that pass nothing, so no save field is removed and no test call site
      // changes shape.
      playerAdvDis,
    );
    playerDamage = pa.damage;
    didHit = pa.outcome === 'hit' || pa.outcome === 'crit';
    didCrit = pa.outcome === 'crit';
    events.push(...pa.events);
    // `resolvePlayerAttack` pushes its `attack` event last.
    playerDamageEventIndex = events.length - 1;
  } else {
    // Cast: spend one charge and resolve the skill through `castSkill` — the base
    // useSkill damage/condition PLUS the class signature twist, all deterministic (NO rng
    // draw, so the documented draw order is unchanged). Forward the twist events; the base
    // `enemy-skill-used` event is dropped in favor of the player-facing `skill-cast`.
    // PLAN.md #2: the floor's heal percentage reaches `selfHeal` and `lifestealFraction`.
    const cast = castSkill(player, enemy, action.skill, {
      healPct: rules.healPct,
      ...(enemy.illusory ? { illusoryTarget: true } : {}),
    });
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
    // The cast's damage rides the event as a single 'skill' term (the skill resolver owns
    // how it was computed). A pure-condition cast deals 0 and carries no terms — which
    // still satisfies "the terms sum to the damage".
    events.push({
      kind: 'skill-cast',
      subject: 'player',
      skillId: action.skill.id,
      name: action.skill.name,
      damage: playerDamage,
      damageSources: playerDamage !== 0 ? [{ kind: 'skill', amount: playerDamage }] : [],
    });
    playerDamageEventIndex = events.length - 1;
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
  //
  //     Each one is ALSO folded back into the event that already reported the damage. Before
  //     M-UI2 they were applied only to the local `playerDamage`, so the emitted event kept
  //     announcing the pre-modifier number while the enemy lost the post-modifier one.
  if (playerDamage > 0) {
    if (
      mods.lowHpDamageBonus &&
      player.hp < (mods.lowHpDamageBonus.thresholdPct / 100) * effectiveMaxHp(player)
    ) {
      playerDamage += mods.lowHpDamageBonus.amount;
      foldDamageSource(events, playerDamageEventIndex, {
        kind: 'low-hp-bonus',
        amount: mods.lowHpDamageBonus.amount,
      });
    }
    if (mods.damageDealtMult > 0) {
      const before = playerDamage;
      playerDamage = Math.floor(before * (1 + mods.damageDealtMult / 100));
      // Record the DELTA the multiplier actually produced (after flooring), not the
      // percentage — the terms have to sum to the damage, and a percentage does not.
      const delta = playerDamage - before;
      if (delta !== 0) {
        foldDamageSource(events, playerDamageEventIndex, { kind: 'damage-mult', amount: delta });
      }
    }
  }

  // 4c. PLAN.md #2: the blow passes through an illusion. The event that reported it keeps its
  //     rolled damage (its terms still sum to it; folding an "illusion" term into the dice
  //     detail would NAME the illusion in the log before it is seen through), and
  //     `illusion-struck` is placed right after it to say nothing was there. `playerDamage` is
  //     then 0, so step 5 lands nothing and the momentum hook below banks nothing for it.
  if (enemy.illusory && playerDamage > 0) {
    events.splice(playerDamageEventIndex + 1, 0, { kind: 'illusion-struck' });
    playerDamage = 0;
  }

  // 5. Apply the exchanged damage. The player's blow lands first (nothing between reads
  //    either hp, and this keeps the enemy's HP settled before any onTakeDamage reflect),
  //    then the enemy's damage goes through the ONE guarded path (G24/G29): first-hit
  //    reduction -> shield -> hp -> onTakeDamage -> revive gate.
  enemy = damageEnemy(enemy, playerDamage);
  const taken = applyDamageToPlayer(player, enemy, enemyDamage, {
    mods,
    firstHitDone,
    reviveUsed,
    events,
    ...(enemyAttackIndex !== undefined ? { attackEventIndex: enemyAttackIndex } : {}),
  });
  player = taken.player;
  enemy = taken.enemy;
  firstHitDone = taken.firstHitDone;
  reviveUsed = taken.reviveUsed;
  // The HP the player ACTUALLY lost (post-reduction, post-shield) — what the momentum hook
  // has always read, and what the death check below tests.
  enemyDamage = taken.applied;

  // Momentum-on-damage hooks (Enforcer only): dealing damage grants +1 and taking enemy
  // damage grants +1, capped. SILENT (no event) and pure arithmetic (no rng draw), so a
  // conditionless round stays byte-identical for non-momentum classes and adds no draw.
  if (usesMomentum(player)) {
    let gain = 0;
    if (playerDamage > 0) gain += 1;
    if (enemyDamage > 0) gain += 1;
    if (gain > 0) player = grantMomentum(player, gain);
  }

  // 5b. Fire the player's ACTION triggers (RNG-free). `onTakeDamage` already fired inside the
  //     damage helper above, alongside the shield and the revive gate it belongs with.
  //     PLAN.md #2: a relic's `healSelf` (Penitent's Rosary, Stitched Heart) is dampened on
  //     floor 3 like every other heal — `healPct` rides the trigger context.
  const triggerCtx = { healPct: rules.healPct };
  if (didHit) {
    const t = fireTrigger('onHit', player, enemy, triggerCtx);
    player = t.player; enemy = t.enemy; events.push(...t.events);
  }
  if (didCrit) {
    const t = fireTrigger('onCrit', player, enemy, triggerCtx);
    player = t.player; enemy = t.enemy; events.push(...t.events);
  }
  if (didCast) {
    const t = fireTrigger('onCast', player, enemy, triggerCtx);
    player = t.player; enemy = t.enemy; events.push(...t.events);
  }

  // 6. Resolve the outcome (player death checked first, faithful to pre-M2). The revive gate
  //    already ran inside the damage helper, so reaching 0 HP here is final.
  if (player.hp <= 0) {
    events.push({ kind: 'defeat' });
    return {
      state: withFlags(state, player, enemy, firstHitDone, reviveUsed),
      events,
      status: 'player-died',
      resolved: true,
    };
  }
  if (enemy.hp <= 0) {
    return killAndVictory(state, player, enemy, events, rng);
  }
  return {
    state: withFlags(state, player, enemy, firstHitDone, reviveUsed),
    events,
    status: 'ongoing',
    resolved: true,
  };
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
 * the victory draw order (the loot roll) is unchanged. Off-equivalent for a normal
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
function resolveCast(state: BattleState, skillId: SkillId, rng: Rng, rules: RoundRules): RoundResult {
  const player = state.player;
  // M9: resolve the player's OWN skill def (base merged with any owned upgrade). No upgrade
  // ⇒ the base SKILLS def is returned unchanged (off-equivalence); the enemy path still reads
  // SKILLS directly (upgrades are player-only).
  const skill = resolveSkill(player, skillId);
  // Overclock Chip / Hollow Heart cut the effective charge cost (never below 0). 0 for a
  // normal run, so availability is unchanged (off-equivalence).
  //
  // G33: this used to inline the arithmetic, which made it the ONLY place the rule lived —
  // so the Cast picker and the character sheet showed the undiscounted cost and the relic
  // did nothing through the real UI. The shared helper is byte-equivalent to what was here.
  const effectiveCost = effectiveChargeCost(player.inventory, skill?.chargeCost ?? 0);
  if (!skill || !player.skillPool.includes(skillId) || player.skillCharges < effectiveCost) {
    return { state, events: [{ kind: 'cast-unavailable' }], status: 'ongoing', resolved: false };
  }
  return resolvePlayerTurn(state, { kind: 'cast', skill }, rng, rules);
}

/**
 * The shared victory block — PURE. Grants xp = enemy.xp, rolls a found-loot drop
 * (`rollLootDrop(state.act, rng, familyTag)`), and emits the `victory` event. (PLAN.md #2: the
 * extra-rest chance that used to be drawn first is gone — rest spots are FOUND on the descent,
 * §22.26, so there is no rest counter for a victory to feed.) Extracted so an enemy killed by its own DoT tick (before it
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
  // M8+: bias the drop slot by the enemy's broad family tag. A legacy/boss enemy whose
  // familyId is a bare type string resolves to no family ⇒ tag undefined ⇒ the roll is
  // byte-identical to the pre-family behaviour (off-equivalence for family-less enemies).
  const drop = rollLootDrop(state.act, rng, getFamily(enemy.familyId)?.tag);
  const inventory = drop ? pickUp(player.inventory, drop) : player.inventory;
  const loot = drop ? [summarizeLoot(drop)] : [];
  const newPlayer: Player = {
    ...player,
    xp: player.xp + xpGained,
    inventory,
  };
  events.push({ kind: 'victory', xpGained, loot });
  return { state: { ...state, player: newPlayer, enemy }, events, status: 'player-won', resolved: true };
}

function resolvePotion(state: BattleState): RoundResult {
  const player = state.player;
  if (hasControlCondition(player)) {
    return { state, events: [{ kind: 'potion-blocked' }], status: 'ongoing', resolved: false };
  }
  // Void Pact's `cannotHeal` blocks the potion heal site. 0/false for a normal run, so the
  // potion path is byte-identical (off-equivalence).
  if (computeEquipModifiers(player.inventory).cannotHeal) {
    return { state, events: [{ kind: 'potion-unavailable' }], status: 'ongoing', resolved: false };
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
      resolved: true,
    };
  }
  return { state, events: [{ kind: 'potion-unavailable' }], status: 'ongoing', resolved: false };
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
  rules: RoundRules,
): RoundResult {
  // PLAN.md #2: a healing consumable is dampened on floor 3 (`healPct` reaches `healSelf`).
  const res = applyConsumable(state.player, state.enemy, source, { healPct: rules.healPct });
  if (!res.consumed) {
    return { state, events: res.events, status: 'ongoing', resolved: false };
  }
  let player = res.player;
  const enemy = res.enemy;
  const events = res.events;
  // PLAN.md #2: a thrown item passed through an illusion — say so, as a blow does.
  if (res.voided) events.push({ kind: 'illusion-struck' });
  if (res.fled) {
    // G39: a flee consumable used to return `fled` WITHOUT consulting `canFlee`, which every
    // boss battle sets to false. Measured: a Smoke Vial in the act-5 Hollow fight returned
    // `status: 'fled'` and dropped the player back at the act-5 hub — where the Hollow was
    // constructed only at floor entry, so the run had NO path to any ending at all: death or
    // Quit only. The item is still CONSUMED and the turn still spent (it was used; that is
    // `resolved: true`), but the escape simply fails.
    if (state.canFlee) {
      return { state: { ...state, player, enemy }, events, status: 'fled', resolved: true };
    }
    events.push({ kind: 'escape-impossible' });
  }
  // G24's fourth site: run the once-per-battle revive gate here too. It is the one guard of
  // the shared path that a consumable outcome can reach — shield/first-hit/onTakeDamage all
  // key off damage taken from an ATTACK, and no self-damaging consumable ships today, so
  // this branch is guarded by construction rather than reachable in play.
  let reviveUsed = state.reviveUsed ?? false;
  if (player.hp <= 0) {
    const gated = applyDamageToPlayer(player, enemy, 0, {
      mods: computeEquipModifiers(player.inventory),
      firstHitDone: state.firstEnemyHitDone ?? false,
      reviveUsed,
      events,
    });
    player = gated.player;
    reviveUsed = gated.reviveUsed;
    if (gated.died) {
      events.push({ kind: 'defeat' });
      return {
        state: withFlags(state, player, enemy, state.firstEnemyHitDone ?? false, reviveUsed),
        events,
        status: 'player-died',
        resolved: true,
      };
    }
  }
  if (enemy.hp <= 0) {
    return killAndVictory(state, player, enemy, events, rng);
  }
  return {
    state: withFlags(state, player, enemy, state.firstEnemyHitDone ?? false, reviveUsed),
    events,
    status: 'ongoing',
    resolved: true,
  };
}

function resolveRun(state: BattleState, rng: Rng): RoundResult {
  if (!state.canFlee) {
    // G36: a REJECTED press. Nothing was resolved — no dice, no tick, no state change — so
    // `game.ts` must not layer the boss's per-round mechanic on top of it.
    return { state, events: [{ kind: 'escape-impossible' }], status: 'ongoing', resolved: false };
  }
  // A controlled (stunned/etc.) player cannot even attempt to flee: forced counter.
  if (hasControlCondition(state.player)) {
    return enemyCounterAttack(state, rng);
  }
  if (rollFlee(rng)) {
    return { state: { ...state }, events: [{ kind: 'fled' }], status: 'fled', resolved: true };
  }
  return enemyCounterAttack(state, rng);
}

/**
 * Shared "your escape failed, take a counter-attack" path (also the controlled case).
 *
 * G24: this used to subtract HP raw and check death raw, skipping every guard
 * `resolvePlayerTurn` applies. It now goes through the SAME `applyDamageToPlayer` helper, so
 * a shield absorbs here, Scrap Plating's free hit applies here, `onTakeDamage` relics fire
 * here, and — the one that matters most — the Halo Fragment revives you here. The register
 * measured all four failing at exactly the death players most often walk into.
 */
function enemyCounterAttack(state: BattleState, rng: Rng): RoundResult {
  const defenderAc = playerArmorClass(state.player);
  const enemyAdvDis = enemyAdvDisVs(state.player);
  const ea = resolveEnemyAttack(state.enemy, state.player, defenderAc, enemyAdvDis, rng);
  const events: CombatEvent[] = [...ea.events];
  // `resolveEnemyAttack` always pushes its `attack` event last.
  const attackEventIndex = events.length - 1;
  const taken = applyDamageToPlayer(ea.target, ea.enemy, ea.damage, {
    mods: computeEquipModifiers(ea.target.inventory),
    firstHitDone: state.firstEnemyHitDone ?? false,
    reviveUsed: state.reviveUsed ?? false,
    events,
    attackEventIndex,
  });
  // `escape-failed` reports the HP the player ACTUALLY lost, so it reconciles with the
  // `shield-absorbed` / first-hit-reduction entries beside it. Identical to the rolled damage
  // for a player with no such gear (off-equivalence).
  events.push({ kind: 'escape-failed', damage: taken.applied });
  const next = withFlags(state, taken.player, taken.enemy, taken.firstHitDone, taken.reviveUsed);
  if (taken.died) {
    events.push({ kind: 'defeat' });
    return { state: next, events, status: 'player-died', resolved: true };
  }
  return { state: next, events, status: 'ongoing', resolved: true };
}

/**
 * Fold a post-hoc damage modifier back into the event that already reported the damage —
 * PURE, no rng.
 *
 * `index` is the position of the attack / skill-cast event in `events`, captured the moment
 * it was pushed. It has to be captured rather than searched for: the cast branch pushes
 * further events (conditions applied, resources changed) after the `skill-cast`, so "the
 * last event" is not reliable by the time step 4b runs.
 *
 * A no-op if the index does not point at a damaging event, so a future reordering degrades
 * to "the breakdown is missing a term" rather than to a corrupted event.
 */
function foldDamageSource(events: CombatEvent[], index: number, source: DamageSource): void {
  const event = events[index];
  if (!event) return;
  if (event.kind === 'attack' || event.kind === 'skill-cast') {
    events[index] = withDamageSource(event, source);
  }
}

/** Name the condition that made the player skip, from the emitted skip events. */
function skipCause(events: CombatEvent[]): ConditionType {
  for (const e of events) {
    if (e.kind === 'condition-skip') return e.conditionType;
  }
  return 'stun';
}
