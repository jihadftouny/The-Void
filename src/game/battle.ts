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
//    act, canFlee, and the two optional tempo fields) that round-trips through JSON.
//
// Ported from `GameLogic.battle`. The M7 encounter controller loops resolveRound;
// M8 sets `act`/`canFlee` and reads the victory/defeat events. Recorded DEVIATIONS:
//  - Flee uses the LITERAL Java formula `rng()*10 + 1 <= 3.5` (~25% escape), though
//    the Java comment and this task say "~35%". [NEEDS-HUMAN: 25% vs 35%?] The test
//    straddles 3.5 so it is independent of the exact constant.
//  - PLAN.md #1.6 (G62): THE ROUND IS SEQUENTIAL — you act, then it acts (§14.8, §22.30), with
//    the §16.1 tempo gauge (`tempo.ts`) granting an extra action or costing a turn. Run and Item
//    are ordinary turns now: the player's conditions tick first (as the Java did for a flee),
//    and the enemy's turn follows a failed escape or a used item. The old "counter-attack" path
//    is gone; its guards (G24) ride along because the enemy's turn uses the one damage path.

import { type Player } from './player.ts';
import { damageEnemy, type Enemy } from './enemy.ts';
import { getFamily } from './enemyFamily.ts';
import { rollDie, type Rng } from './rng.ts';
import { type CombatEvent, type CombatSubject, type DamageSource, withDamageSource } from './combatEvent.ts';
import { tickConditions, type ConditionType } from './condition.ts';
import { combineAdvDis, resolveEnemyAttack, resolvePlayerAttack, type ForcedEnemyMove } from './combat.ts';
import { resolveSkill, type SkillDef, type SkillId } from './skill.ts';
import { castSkill, clampMomentum, grantMomentum, usesMomentum } from './classKit.ts';
import { perkModifiers } from './perks.ts';
import { effectiveMaxHp, effectiveMods } from './statEffects.ts';
import { playerArmorClass, enemyAdvDisVs } from './defense.ts';
import { weaponForSlot, UNARMED, pickUp } from './equipment.ts';
import { canCarry } from './inventory.ts';
import { rollLootDrop, summarizeLoot } from './loot.ts';
import { computeEquipModifiers, effectiveChargeCost, type EquipModifiers } from './equipEffects.ts';
import { fireFloorTriggers, fireTrigger, reviveActionFor } from './relicEffects.ts';
import { applyConsumable, type ConsumableSource } from './consumable.ts';
import { ILLUSION_DC, type FloorId } from './floors.ts';
import { PLAYER_TEMPO_RATE_CAP_TENTHS, TEMPO_RATE_CAP_TENTHS, advanceTempo, tempoRate, type TempoStep } from './tempo.ts';
import {
  BOSSES,
  battleActionKey,
  bossCastDef,
  legalBossMoves,
  pickFallbackMove,
  type BossMoveId,
  type BossState,
} from './boss.ts';

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
   * (non-boss) battle ⇒ byte-identical off-equivalence: it survives the `{ ...state, ... }`
   * spreads untouched. The per-round extras (`bossPostRound`) are layered by game.ts AFTER the
   * round. PLAN.md #11: `resolveRound` now READS it for one thing — a boss's turn pauses for its
   * choice (`bossChoice`) instead of drawing a random skill — and every non-boss path is
   * unchanged, draw for draw.
   */
  boss?: BossState;
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
  /**
   * PLAN.md #1.6, OPTIONAL: the §16.1 tempo gauges, in integer TENTHS (+4 = +0.4; see
   * `tempo.ts` for why tenths). Battle-scoped by construction — it lives on the battle, so it
   * resets every fight (author, 2026-09-26) and cannot leak to the hub. ABSENT ⇒ both 0, and it
   * is written only while either gauge is non-zero, so a battle whose gauges never move (every
   * DEX-10 fight) keeps its pre-#1.6 JSON shape and a pre-unit save decodes unchanged.
   */
  tempo?: { player: number; enemy: number };
  /**
   * PLAN.md #1.6, OPTIONAL: the player's gauge crossed +1.0 and the round is PAUSED after their
   * first action, waiting for the second (a freely chosen battle action — author, 2026-09-26).
   * The enemy has not acted yet. Present only while paused.
   */
  extraAction?: true;
  /**
   * The paused round's own advantage/disadvantage (the standing modifier combined with the
   * player's tick — e.g. a fracture's −1), so the SECOND action rolls exactly as the first did.
   * Present only while paused, and only when non-zero.
   */
  extraActionAdvDis?: -1 | 1;
  /**
   * PLAN.md #11, OPTIONAL: a BOSS round PAUSED for the boss's choice. The player's half has
   * resolved; the boss's tick and gauge have run; its actions wait for a `boss-choice` input
   * (the model's move, or `null` for the seeded fallback). Present only while paused, and only on
   * a boss battle, so a normal battle's JSON — and every pre-#11 save — is unchanged.
   */
  bossChoice?: BossChoicePause;
}

/** The saved pause a boss round waits in (PLAN.md #11). Plain data. */
export interface BossChoicePause {
  /** The legal move ids, in the card's order — what the model may choose (§5.2). */
  legal: BossMoveId[];
  /** Actions the boss still has this turn: 2 on a doubled turn, then 1. */
  remaining: 1 | 2;
  /** The player's action this round, as `bossPostRound` tallies it (the Reflection). */
  playerActionKey: string;
  /** The adv/dis the boss's OWN tick produced this turn (fracture), for each of its to-hit rolls. */
  advDis: -1 | 0 | 1;
}

/**
 * The player's battle actions: the string actions plus a structured `cast` (spend a charge
 * to cast a skill from the player's skillPool) and `useConsumable`. PLAN.md #2 / §22.6: the
 * `potion` action is GONE — healing in battle is a found consumable, used like any other.
 */
export type BattleAction =
  | 'fight'
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
  /**
   * PLAN.md #1.6: the |rate| clamp of the ENEMY's tempo gauge, in tenths (the player's rate is
   * capped separately — `playerTempoRateCapTenths`). Shipped: `TEMPO_RATE_CAP_TENTHS`. MEASUREMENT ONLY may pass
   * `Infinity` (§16.1's literal rate).
   */
  tempoRateCapTenths: number;
  /**
   * The |rate| clamp of the PLAYER's tempo gauge, in tenths (author, 2026-09-27: ±0.4). Shipped:
   * `PLAYER_TEMPO_RATE_CAP_TENTHS`. MEASUREMENT ONLY may pass `Infinity` (§16.1's literal rate).
   */
  playerTempoRateCapTenths: number;
  /** Whether the ENEMY's gauge moves at all. Shipped: true. MEASUREMENT ONLY. */
  enemyTempo: boolean;
  /** Whether an enemy family's data-driven speed is added to its rate. Shipped: true. MEASUREMENT ONLY. */
  familySpeed: boolean;
}

/** No floor mechanic: full heals, the shipped illusion DC, the shipped tempo gauge. */
export const DEFAULT_ROUND_RULES: RoundRules = {
  healPct: 100,
  illusionDc: ILLUSION_DC,
  tempoRateCapTenths: TEMPO_RATE_CAP_TENTHS,
  playerTempoRateCapTenths: PLAYER_TEMPO_RATE_CAP_TENTHS,
  enemyTempo: true,
  familySpeed: true,
};

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
   * `resolveRound` returns `status: 'ongoing'` for its NO-OP REJECTIONS as well as for a real
   * round — `escape-impossible`, `cast-unavailable`, `consumable-unavailable`,
   * `spare-unavailable` (and, until PLAN.md #2 removed the action, two potion refusals). None of them resolves anything: no dice,
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
  /**
   * PLAN.md #1.6: did a whole ROUND complete — both sides' turns (or the fight ended)? False for
   * every rejection AND for the extra-action pause (the player has acted once and the round
   * waits for their second input; the enemy has not acted). `game.ts` layers the boss's
   * once-per-round mechanic only on a completed round, so a doubled round fires it once.
   * Required, like `resolved`, so no return site can omit it.
   */
  roundComplete: boolean;
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
 * Resolve one battle step for the chosen action — PURE. Returns a new BattleState, the ordered
 * events, a terminal status, and whether a ROUND completed. The input `state` is never mutated.
 *
 * PLAN.md #1.6 / GAME-DESIGN §14.8, §16.1, §22.30 — THE ROUND IS SEQUENTIAL. You act, then it
 * acts: the player's turn resolves fully (condition tick, tempo gauge, action, damage applied)
 * and only then the enemy's. A killing blow ends the round before the enemy can strike back; an
 * enemy blow that kills the player ends it there too.
 *
 * Dispatch:
 *  1. REJECTIONS first, unchanged (G36): Run where `canFlee` is false (`escape-impossible`), an
 *     uncastable skill (`cast-unavailable`), an empty backpack slot (`consumable-unavailable`),
 *     a non-⚖ Spare (`spare-unavailable`). State unchanged, one event, NO draw, no gauge
 *     movement, `resolved: false`, `roundComplete: false`. A rejected press during the
 *     extra-action pause leaves the pause (`extraAction`) set.
 *  2. SPARE: the fight ends as `spared` (no draw).
 *  3. Everything else is a TURN (`playRound`): Fight, Cast, Run and Item alike cost the player's
 *     action and are answered by the enemy's turn. Run's failed escape is no longer a special
 *     counter-attack; it is simply the enemy's ordinary turn.
 *
 * DRAW ORDER (documented for the exact-list tests):
 *   [illusion d20 — illusory enemy only] → player condition-tick draws → the player action's
 *   draws (Fight: d20 ×1–2 + damage die(s); Run: the flee draw; Cast/Item: none) → enemy
 *   condition-tick draws → per enemy action: d20 ×1–2, then the skill-pick (only on a hit with
 *   an affordable skill) → on victory: the loot roll. The tempo gauge draws NOTHING.
 */
export function resolveRound(
  state: BattleState,
  action: BattleAction,
  rng: Rng,
  rules: RoundRules = DEFAULT_ROUND_RULES,
): RoundResult {
  if (typeof action === 'object') {
    if (action.kind === 'cast') {
      // M9: the player's OWN skill def (base merged with any owned upgrade). G33: the shared
      // discount helper is the one place the effective charge cost is decided.
      const skill = resolveSkill(state.player, action.skillId);
      const effectiveCost = effectiveChargeCost(state.player.inventory, skill?.chargeCost ?? 0);
      if (!skill || !state.player.skillPool.includes(action.skillId) || state.player.skillCharges < effectiveCost) {
        return rejected(state, { kind: 'cast-unavailable' });
      }
      return playRound(state, { kind: 'cast', skill }, rng, rules, battleActionKey(action));
    }
    // An item is available iff its backpack slot holds a usable def — a property of the pack
    // alone, so it is decided here, before the tick, with no side effect (`applyConsumable` is
    // pure; its result is discarded and the item is applied for real at the action).
    const probe = applyConsumable(state.player, state.enemy, action.source, { healPct: rules.healPct });
    if (!probe.consumed) return rejected(state, { kind: 'consumable-unavailable' });
    return playRound(state, { kind: 'item', source: action.source }, rng, rules, battleActionKey(action));
  }
  switch (action) {
    case 'fight':
      return playRound(state, { kind: 'fight' }, rng, rules, 'fight');
    case 'run':
      // G36: a REJECTED press. Nothing was resolved — no dice, no tick, no state change.
      if (!state.canFlee) return rejected(state, { kind: 'escape-impossible' });
      return playRound(state, { kind: 'run' }, rng, rules, 'run');
    case 'spare':
      return resolveSpare(state);
    /* istanbul ignore next */
    default:
      return { state, events: [], status: 'ongoing', resolved: false, roundComplete: false };
  }
}

/** A no-op rejection: the input state, its one event, nothing resolved (G36). */
function rejected(state: BattleState, event: CombatEvent): RoundResult {
  return { state, events: [event], status: 'ongoing', resolved: false, roundComplete: false };
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
 * unavailable consumable), so no karma can be recorded off a non-⚖ enemy. Against a ⚖ enemy
 * it ends the encounter as `spared` (mercy) — the enemy is NOT killed (hp unchanged, no
 * XP/loot); the karma write happens one level up in game.ts, which owns the karma vector.
 */
function resolveSpare(state: BattleState): RoundResult {
  if (!state.enemy.karmaWeighted) {
    return rejected(state, { kind: 'spare-unavailable' });
  }
  return {
    state,
    events: [{ kind: 'spared', enemyName: state.enemy.fullName }],
    status: 'spared',
    resolved: true,
    roundComplete: true,
  };
}

/** What the player does with an action: attack, cast, try to run, or use an item. */
type PlayerAction =
  | { kind: 'fight' }
  | { kind: 'cast'; skill: SkillDef }
  | { kind: 'run' }
  | { kind: 'item'; source: ConsumableSource };

/**
 * The live, MUTABLE working copy of one round — local to a single `resolveRound` call and never
 * stored (the state that leaves is rebuilt as plain data by `settle`). Exported as a TYPE only so
 * `resolveEnemyTurn`'s signature can name it.
 */
export interface RoundContext {
  player: Player;
  enemy: Enemy;
  /** The live event list; everything appends here, in order. */
  events: CombatEvent[];
  /** The player's aggregated equip modifiers, read once per step. */
  mods: EquipModifiers;
  firstHitDone: boolean;
  reviveUsed: boolean;
  /** Both gauges, in tenths. */
  tempo: { player: number; enemy: number };
  /** The HP each side last showed in an `hp-changed` (or held at the start of the step). */
  shownHp: { player: number; enemy: number };
  /** PLAN.md #11: a working COPY of the battle's boss, when there is one (written back by `settle`). */
  boss?: BossState;
}

/** How a turn ended: the fight goes on, or one side is down. */
type TurnOutcome = 'ongoing' | 'enemy-died' | 'player-died';

/**
 * Emit `hp-changed` for a side whose HP moved since it was last shown — the engine's per-blow
 * truth the stage writes its bars with (G63-2). `maxHp` is the STORED max, which is what the
 * stage's bars are drawn against.
 */
function syncHp(ctx: RoundContext, side: CombatSubject): void {
  const who = side === 'player' ? ctx.player : ctx.enemy;
  if (who.hp === ctx.shownHp[side]) return;
  ctx.shownHp[side] = who.hp;
  ctx.events.push({ kind: 'hp-changed', subject: side, hp: who.hp, maxHp: who.maxHp });
}

/** Move one side's gauge, emitting `tempo-changed` iff the value moved. */
function moveGauge(ctx: RoundContext, side: CombatSubject, rate: number, canAct: boolean): TempoStep {
  const moved = advanceTempo(ctx.tempo[side], rate, canAct);
  if (moved.tenths !== ctx.tempo[side]) {
    ctx.tempo[side] = moved.tenths;
    ctx.events.push({ kind: 'tempo-changed', subject: side, tenths: moved.tenths });
  }
  if (moved.crossed === 'lost') ctx.events.push({ kind: 'tempo-lost-turn', subject: side });
  return moved;
}

/**
 * Run the once-per-battle revive gate on a player at 0 HP from something other than an attack
 * (a DoT tick, a self-sacrifice, an item) — the same guarded path, with 0 further damage (G24).
 * Returns true when the player is down for good.
 */
function playerDownAfterGate(ctx: RoundContext): boolean {
  if (ctx.player.hp > 0) return false;
  const gated = applyDamageToPlayer(ctx.player, ctx.enemy, 0, {
    mods: ctx.mods,
    firstHitDone: ctx.firstHitDone,
    reviveUsed: ctx.reviveUsed,
    events: ctx.events,
  });
  ctx.player = gated.player;
  ctx.enemy = gated.enemy;
  ctx.reviveUsed = gated.reviveUsed;
  syncHp(ctx, 'player');
  return gated.died;
}

/**
 * The next BattleState from the working copy: the flags (only when true), the gauges (only
 * when either is non-zero, so a round that moved nothing leaves the JSON shape unchanged), and
 * the extra-action pause (only while paused).
 */
function settle(
  state: BattleState,
  ctx: RoundContext,
  paused: { advDis: -1 | 0 | 1 } | null,
  bossPause?: BossChoicePause,
): BattleState {
  const { tempo: _tempo, extraAction: _extra, extraActionAdvDis: _adv, bossChoice: _choice, ...rest } = state;
  const next = withFlags(rest, ctx.player, ctx.enemy, ctx.firstHitDone, ctx.reviveUsed);
  if (ctx.boss) next.boss = ctx.boss;
  if (ctx.tempo.player !== 0 || ctx.tempo.enemy !== 0) next.tempo = { ...ctx.tempo };
  if (paused) {
    next.extraAction = true;
    if (paused.advDis !== 0) next.extraActionAdvDis = paused.advDis;
  }
  if (bossPause) next.bossChoice = bossPause;
  return next;
}

/** The working copy of one step, rebuilt from the saved battle. */
function newContext(state: BattleState): RoundContext {
  const ctx: RoundContext = {
    player: state.player,
    enemy: state.enemy,
    events: [],
    mods: computeEquipModifiers(state.player.inventory),
    firstHitDone: state.firstEnemyHitDone ?? false,
    reviveUsed: state.reviveUsed ?? false,
    tempo: { player: state.tempo?.player ?? 0, enemy: state.tempo?.enemy ?? 0 },
    shownHp: { player: state.player.hp, enemy: state.enemy.hp },
  };
  if (state.boss) ctx.boss = { ...state.boss };
  return ctx;
}

/** A finished step: the settled state, the events, a status, and a completed round. */
function done(state: BattleState, ctx: RoundContext, status: RoundStatus): RoundResult {
  return { state: settle(state, ctx, null), events: ctx.events, status, resolved: true, roundComplete: true };
}

/** The player went down: `defeat`, and the round is over. */
function defeat(state: BattleState, ctx: RoundContext): RoundResult {
  ctx.events.push({ kind: 'defeat' });
  return done(state, ctx, 'player-died');
}

/** The enemy went down: the `onKill` triggers, then the victory block (the loot roll). */
function victory(state: BattleState, ctx: RoundContext, rng: Rng): RoundResult {
  return killAndVictory(settle(state, ctx, null), ctx.player, { ...ctx.enemy, hp: Math.max(ctx.enemy.hp, 0) }, ctx.events, rng);
}

/**
 * One round (or the second half of a paused one) — PURE. See `resolveRound` for the draw order.
 *
 * A NEW round (`state.extraAction` absent):
 *  0. Floor 2, ONLY against an `illusory` enemy: the passive Wisdom roll, one d20 +
 *     `effectiveMods(player).WIS` vs `rules.illusionDc`. At or above it the fight simply ends
 *     (`illusion-dispelled`, status `dispelled`) and nothing else happens; below it, nothing is
 *     said (naming the illusion early would give it away) and the round runs.
 *  1. PLAYER TICK — the player's conditions (DoT, heal, skip, fracture's −1). A healing tick is
 *     capped at effective max HP (G22a). A lethal tick passes the revive gate; if it holds, the
 *     round is a `defeat` and the enemy never acts. Empty Vessel restores its charge.
 *  2. PLAYER GAUGE — `tempoRate` → `advanceTempo`. A control condition (`player-unable-to-act`)
 *     or a crossed −1.0 (`tempo-lost-turn`) means no action; a crossed +1.0 means two.
 *  3. PLAYER ACTION — `playerAction`. The enemy down → victory; the player down → defeat;
 *     a successful escape → fled. All END the round there.
 *  3b. A crossed +1.0 with the fight still on: `tempo-extra-action`, and the round PAUSES for a
 *     second, freely chosen input — status `ongoing`, `resolved: true`, `roundComplete: false`,
 *     `state.extraAction: true`. The enemy has not acted.
 * The SECOND action of a paused round (`state.extraAction` set):
 *  3'. PLAYER ACTION exactly as step 3 — no tick, no gauge, no illusion roll — at the round's
 *     own advantage (`extraActionAdvDis`), and the pause clears.
 * Then, if the fight is still on:
 *  4. THE ENEMY'S TURN — `resolveEnemyTurn`.
 *  5. `ongoing`, `roundComplete: true`.
 */
function playRound(
  state: BattleState,
  action: PlayerAction,
  rng: Rng,
  rules: RoundRules,
  actionKey: string,
): RoundResult {
  const second = state.extraAction === true;
  const ctx = newContext(state);

  let actions: 0 | 1 | 2 = 1;
  let advDis: -1 | 0 | 1;
  if (!second) {
    // 0. The passive Wisdom roll against an illusion.
    if (ctx.enemy.illusory) {
      const natural = rollDie(rng, 20);
      const modifier = effectiveMods(ctx.player).WIS;
      const total = natural + modifier;
      if (total >= rules.illusionDc) {
        return {
          state,
          events: [{ kind: 'illusion-dispelled', natural, modifier, total, dc: rules.illusionDc }],
          status: 'dispelled',
          resolved: true,
          roundComplete: true,
        };
      }
    }

    // 1. The player's tick. G12: the condition's adv/dis is NOT written onto the player; it is
    //    combined, for this round only, with the battle's standing modifier.
    const ptc = tickConditions(ctx.player, ctx.enemy, rng);
    const ticked: Player = { ...ctx.player, activeConditions: ptc.conditions };
    const rawHp = ctx.player.hp + ptc.hpDelta;
    ctx.player = { ...ticked, hp: ptc.hpDelta > 0 ? Math.min(rawHp, effectiveMaxHp(ticked)) : Math.max(rawHp, 0) };
    ctx.events.push(...ptc.events);
    syncHp(ctx, 'player');
    if (playerDownAfterGate(ctx)) return defeat(state, ctx);
    advDis = combineAdvDis(state.playerAdvantage ?? 0, ptc.advDisOverride);
    // Empty Vessel: restore charge(s) at the player's turn (capped at max). No-op at 0.
    if (ctx.mods.chargePerTurn > 0) {
      ctx.player = {
        ...ctx.player,
        skillCharges: Math.min(ctx.player.skillCharges + ctx.mods.chargePerTurn, ctx.player.maxSkillCharges),
      };
    }

    // 2. The player's gauge. A controlled player's gauge drifts but spends nothing (tempo.ts).
    // The PLAYER's rate is capped at ±0.4 (author, 2026-09-27); the enemy's at ±0.3.
    const moved = moveGauge(ctx, 'player', tempoRate(ctx.player, rules.playerTempoRateCapTenths), !ptc.skipTurn);
    actions = moved.actions;
    if (ptc.skipTurn) {
      ctx.events.push({ kind: 'player-unable-to-act', conditionType: skipCause(ptc.events) });
    }
  } else {
    advDis = state.extraActionAdvDis ?? 0;
  }

  // 3. The player's action (the first of two, the only one, or the paused round's second).
  if (actions >= 1) {
    const outcome = playerAction(ctx, action, advDis, rng, rules, state.canFlee);
    if (outcome === 'fled') return done(state, ctx, 'fled');
    if (outcome === 'player-died') return defeat(state, ctx);
    if (outcome === 'enemy-died') return victory(state, ctx, rng);
    // 3b. The extra action: the round pauses for the player's second input.
    if (actions === 2 && !second) {
      ctx.events.push({ kind: 'tempo-extra-action', subject: 'player' });
      return {
        state: settle(state, ctx, { advDis }),
        events: ctx.events,
        status: 'ongoing',
        resolved: true,
        roundComplete: false,
      };
    }
  }

  // 4. The enemy's turn. PLAN.md #11: a BOSS's turn stops after its tick and gauge and waits for
  //    its choice (`bossTurn`); every other enemy acts exactly as before.
  if (ctx.boss) return bossTurn(state, ctx, rng, rules, actionKey);
  const enemyOutcome = resolveEnemyTurn(ctx, rng, rules);
  if (enemyOutcome === 'player-died') return defeat(state, ctx);
  if (enemyOutcome === 'enemy-died') return victory(state, ctx, rng);
  return done(state, ctx, 'ongoing');
}

/**
 * A BOSS's turn up to its choice (PLAN.md #11, §17.3.2 — the boss's choice is an input like the
 * player's). Its conditions tick first, as every enemy's do. Then:
 *  - a granted `pause` (`boss.pausedTurn`): the turn passes — no gauge, no action — with a
 *    `boss-move { move: 'pause' }`, the flag clears, and the round completes;
 *  - no action granted (a control condition, a lost turn): the round completes;
 *  - otherwise the round PAUSES: `bossChoice` holds the legal ids, the actions left, the player's
 *    action key and the boss's own tick adv/dis. Status `ongoing`, `resolved: true`,
 *    `roundComplete: false`; `resolveBossChoice` resumes it.
 */
function bossTurn(state: BattleState, ctx: RoundContext, rng: Rng, rules: RoundRules, actionKey: string): RoundResult {
  const boss = ctx.boss!;
  const paused = boss.pausedTurn === true;
  const begun = beginEnemyTurn(ctx, rng, rules, paused);
  if (begun === 'enemy-died') return victory(state, ctx, rng);
  if (paused) {
    delete boss.pausedTurn;
    ctx.events.push({ kind: 'boss-move', bossId: boss.bossId, move: 'pause' });
    return done(state, ctx, 'ongoing');
  }
  if (begun.actions === 0) return done(state, ctx, 'ongoing');
  const pause: BossChoicePause = {
    legal: legalBossMoves({ boss, enemy: ctx.enemy, player: ctx.player }).map((o) => o.id),
    remaining: begun.actions,
    playerActionKey: actionKey,
    advDis: begun.advDisOverride,
  };
  return { state: settle(state, ctx, null, pause), events: ctx.events, status: 'ongoing', resolved: true, roundComplete: false };
}

/**
 * Resume a boss round paused for its choice — PURE (PLAN.md #11). `move` is the boss's move:
 * a legal id is applied exactly; `null` or an id the pause did not list takes the seeded
 * FALLBACK (`pickFallbackMove`, one draw) — never a no-op, because a fallback is what §17.3.3
 * rules and a no-op would stall the fight on a renderer or model bug.
 *
 * One action is resolved. If the boss had two (its gauge doubled the turn) and the fight is on,
 * `tempo-extra-action { subject: 'enemy' }` is emitted and the round pauses again with
 * `remaining: 1` and a RECOMPUTED legal list (a spent charge or a new crew member changes it).
 * Otherwise the pause clears and the round completes (`roundComplete: true`), or the fight ends.
 *
 * Called on a battle with no open pause, it resolves nothing (`resolved: false`, no events).
 */
export function resolveBossChoice(
  state: BattleState,
  move: BossMoveId | null,
  rng: Rng,
  rules: RoundRules = DEFAULT_ROUND_RULES,
): RoundResult {
  const pause = state.bossChoice;
  if (!pause || !state.boss) return { state, events: [], status: 'ongoing', resolved: false, roundComplete: false };
  const ctx = newContext(state);
  const chosen: BossMoveId = move !== null && pause.legal.includes(move) ? move : pickFallbackMove(pause.legal, rng);
  const outcome = bossAction(ctx, chosen, pause.advDis, rng, rules);
  if (outcome === 'player-died') return defeat(state, ctx);
  if (outcome === 'enemy-died') return victory(state, ctx, rng);
  if (pause.remaining === 2) {
    ctx.events.push({ kind: 'tempo-extra-action', subject: 'enemy' });
    const next: BossChoicePause = {
      ...pause,
      legal: legalBossMoves({ boss: ctx.boss!, enemy: ctx.enemy, player: ctx.player }).map((o) => o.id),
      remaining: 1,
    };
    return { state: settle(state, ctx, null, next), events: ctx.events, status: 'ongoing', resolved: true, roundComplete: false };
  }
  return done(state, ctx, 'ongoing');
}

/**
 * ONE boss action, applied to the working copy (PLAN.md #11). Every action first announces itself
 * (`boss-move`), then:
 *  - `strike` / `cast:<id>` — one `enemyAttack`, the to-hit roll first, then the chosen blow (the
 *    card's die) or the chosen skill (the Hollow Self's WARPED form) on a hit;
 *  - `call_crew` — one more of the Kingpin's crew (`boss-summon`); no blow this action;
 *  - `hold_back` — nothing: the crew does the work at the round's end;
 *  - `grieve` — no blow; the player loses one skill charge (`boss-grieve`).
 */
function bossAction(
  ctx: RoundContext,
  move: BossMoveId,
  advDisOverride: -1 | 0 | 1,
  rng: Rng,
  _rules: RoundRules,
): TurnOutcome {
  const boss = ctx.boss!;
  ctx.events.push({ kind: 'boss-move', bossId: boss.bossId, move });
  if (move === 'strike') {
    const { die, addStr } = BOSSES[boss.bossId].strike;
    return enemyAttack(ctx, advDisOverride, rng, { kind: 'strike', die, addStr });
  }
  if (move.startsWith('cast:')) {
    const def = bossCastDef(boss, move.slice('cast:'.length));
    // A listed cast always resolves (the legal list is built from these same defs); an id that
    // somehow names no skill still spends the action as a plain strike rather than stalling.
    if (!def) return enemyAttack(ctx, advDisOverride, rng, { kind: 'strike', ...BOSSES[boss.bossId].strike });
    return enemyAttack(ctx, advDisOverride, rng, { kind: 'cast', skill: def });
  }
  if (move === 'call_crew') {
    boss.minions = (boss.minions ?? 0) + 1;
    ctx.events.push({ kind: 'boss-summon', minions: boss.minions });
    return 'ongoing';
  }
  if (move === 'grieve') {
    const amount = Math.min(1, ctx.player.skillCharges);
    ctx.player = { ...ctx.player, skillCharges: ctx.player.skillCharges - amount };
    ctx.events.push({ kind: 'boss-grieve', amount });
    return 'ongoing';
  }
  // hold_back
  return 'ongoing';
}

/**
 * ONE player action, applied to the working copy — Fight, Cast, Run or Item. Returns how it
 * left the fight. PURE apart from appending to `ctx` (a local working copy).
 *
 * Fight/Cast: the blow (or cast), the post-hoc passives folded back into the event that
 * reported the damage (Adrenal Shunt, Void Pact — M-UI2), an illusion voiding it (floor 2), the
 * damage applied, the Enforcer's momentum for dealing it, then the `onHit`/`onCrit`/`onCast`
 * relic triggers. Run: one flee draw. Item: the consumable, with its own flee and revive rules.
 */
function playerAction(
  ctx: RoundContext,
  action: PlayerAction,
  advDis: -1 | 0 | 1,
  rng: Rng,
  rules: RoundRules,
  canFlee: boolean,
): TurnOutcome | 'fled' {
  if (action.kind === 'run') {
    if (rollFlee(rng)) {
      ctx.events.push({ kind: 'fled' });
      return 'fled';
    }
    // The escape costs the turn; the enemy's ordinary turn follows and reports its own blow.
    ctx.events.push({ kind: 'escape-failed' });
    return 'ongoing';
  }

  if (action.kind === 'item') {
    // PLAN.md #2: a healing consumable is dampened on floor 3 (`healPct` reaches `healSelf`).
    const res = applyConsumable(ctx.player, ctx.enemy, action.source, { healPct: rules.healPct });
    ctx.player = res.player;
    ctx.enemy = res.enemy;
    ctx.events.push(...res.events);
    // PLAN.md #2: a thrown item passed through an illusion — say so, as a blow does.
    if (res.voided) ctx.events.push({ kind: 'illusion-struck' });
    syncHp(ctx, 'player');
    syncHp(ctx, 'enemy');
    if (res.fled) {
      // G39: the item is spent and the turn with it, but a battle that forbids fleeing (every
      // boss, the final act) keeps you: `escape-impossible`, and the enemy's turn follows.
      if (canFlee) return 'fled';
      ctx.events.push({ kind: 'escape-impossible' });
    }
    // G24's fourth site: the once-per-battle revive gate, for a self-lethal item.
    if (playerDownAfterGate(ctx)) return 'player-died';
    return ctx.enemy.hp <= 0 ? 'enemy-died' : 'ongoing';
  }

  let damage = 0;
  let didHit = false;
  let didCrit = false;
  let didCast = false;
  // Where the damaging event landed, so the post-hoc passives can be folded back into it.
  let reportIndex = -1;
  if (action.kind === 'fight') {
    // M5: the weapon from the paperdoll mainHand (empty → UNARMED). M9: wired damage perks ride
    // the flat-damage seam, passed SEPARATELY so the breakdown can name gear and perks apart.
    const weapon = weaponForSlot(ctx.player.inventory) ?? UNARMED;
    const pa = resolvePlayerAttack(
      ctx.player,
      ctx.enemy,
      weapon,
      ctx.mods.flatDamage,
      rng,
      perkModifiers(ctx.player.perks).flatDamage,
      // G12: the round's adv/dis is INJECTED.
      advDis,
    );
    damage = pa.damage;
    didHit = pa.outcome === 'hit' || pa.outcome === 'crit';
    didCrit = pa.outcome === 'crit';
    ctx.events.push(...pa.events);
    reportIndex = ctx.events.length - 1; // `resolvePlayerAttack` pushes its `attack` last.
  } else {
    // Cast: spend the charge and resolve the skill through `castSkill` — the base damage /
    // condition PLUS the class twist, all deterministic (NO draw). The base `enemy-skill-used`
    // event is dropped in favour of the player-facing `skill-cast`. PLAN.md #2: the floor's
    // heal percentage reaches `selfHeal` and `lifestealFraction`.
    const cast = castSkill(ctx.player, ctx.enemy, action.skill, {
      healPct: rules.healPct,
      ...(ctx.enemy.illusory ? { illusoryTarget: true } : {}),
    });
    ctx.player = cast.caster;
    ctx.enemy = cast.target;
    damage = cast.damage;
    didCast = true;
    // Overclock Chip / Hollow Heart: refund the charge-cost discount castSkill just spent.
    if (ctx.mods.chargeDiscount > 0) {
      const refund = Math.min(ctx.mods.chargeDiscount, action.skill.chargeCost);
      ctx.player = {
        ...ctx.player,
        skillCharges: Math.min(ctx.player.skillCharges + refund, ctx.player.maxSkillCharges),
      };
    }
    ctx.events.push({
      kind: 'skill-cast',
      subject: 'player',
      skillId: action.skill.id,
      name: action.skill.name,
      damage,
      damageSources: damage !== 0 ? [{ kind: 'skill', amount: damage }] : [],
    });
    reportIndex = ctx.events.length - 1;
    for (const e of cast.events) {
      if (
        e.kind === 'condition-applied' ||
        e.kind === 'resource-changed' ||
        e.kind === 'self-sacrifice' ||
        e.kind === 'lifesteal' ||
        e.kind === 'detonate'
      ) {
        ctx.events.push(e);
      }
    }
  }

  // Post-hoc passives (RNG-free), each FOLDED BACK into the event that reported the damage so
  // the log never announces a number the enemy did not lose (M-UI2).
  if (damage > 0) {
    const low = ctx.mods.lowHpDamageBonus;
    if (low && ctx.player.hp < (low.thresholdPct / 100) * effectiveMaxHp(ctx.player)) {
      damage += low.amount;
      foldDamageSource(ctx.events, reportIndex, { kind: 'low-hp-bonus', amount: low.amount });
    }
    if (ctx.mods.damageDealtMult > 0) {
      const before = damage;
      damage = Math.floor(before * (1 + ctx.mods.damageDealtMult / 100));
      const delta = damage - before;
      if (delta !== 0) foldDamageSource(ctx.events, reportIndex, { kind: 'damage-mult', amount: delta });
    }
  }

  // PLAN.md #2: the blow passes through an illusion. The reporting event keeps its rolled
  // damage (folding an "illusion" term in would name it early); `illusion-struck` follows it.
  if (ctx.enemy.illusory && damage > 0) {
    ctx.events.splice(reportIndex + 1, 0, { kind: 'illusion-struck' });
    damage = 0;
  }

  ctx.enemy = damageEnemy(ctx.enemy, damage);
  syncHp(ctx, 'enemy');
  syncHp(ctx, 'player'); // a cast's self-sacrifice or lifesteal

  // Momentum (Enforcer only): +1 for DEALING damage. The +1 for TAKING it is granted in the
  // enemy's turn, where the damage lands. Silent, no draw.
  if (usesMomentum(ctx.player) && damage > 0) ctx.player = grantMomentum(ctx.player, 1);

  // The player's ACTION triggers (RNG-free). PLAN.md #2: a relic's `healSelf` is dampened on
  // floor 3 like every other heal — `healPct` rides the trigger context.
  const triggerCtx = { healPct: rules.healPct };
  const fire = (trigger: 'onHit' | 'onCrit' | 'onCast'): void => {
    const t = fireTrigger(trigger, ctx.player, ctx.enemy, triggerCtx);
    ctx.player = t.player;
    ctx.enemy = t.enemy;
    ctx.events.push(...t.events);
  };
  if (didHit) fire('onHit');
  if (didCrit) fire('onCrit');
  if (didCast) fire('onCast');
  syncHp(ctx, 'enemy');
  syncHp(ctx, 'player');

  // The player is checked first (a self-sacrifice that killed you), faithful to pre-M2.
  if (playerDownAfterGate(ctx)) return 'player-died';
  return ctx.enemy.hp <= 0 ? 'enemy-died' : 'ongoing';
}

/**
 * THE ENEMY'S TURN — its condition tick, its tempo gauge, then N actions — PURE apart from
 * appending to `ctx` (a local working copy). Returns how it left the fight.
 *
 *  a. TICK. The enemy's conditions (the player's DoT and control finally bite). Grave of Embers
 *     / Ashen Crown double a negative DoT (`dotTickMult`); a healing tick is capped at effective
 *     max HP (G22a); an illusion loses nothing to a DoT (PLAN.md #2). Dead to its own tick ⇒
 *     `enemy-died` before it acts.
 *  b. GAUGE. `tempoRate` of its Dexterity plus its FAMILY'S SPEED (data, `enemyFamilies.json`),
 *     capped; `rules.enemyTempo` false (measurement only) holds it still. A control condition
 *     means no action (the gauge drifts, spends nothing); a crossed −1.0 is `tempo-lost-turn`.
 *  c. ACTIONS, one or two. Before the second: `tempo-extra-action`. EACH action is ONE call to
 *     `resolveEnemyAttack` (to-hit, then a random affordable skill) and ONE pass through the
 *     guarded damage path (first-hit reduction → shield → HP → `onTakeDamage` → revive). The
 *     player down ⇒ `player-died` and no further action; the enemy down to a reflect ⇒
 *     `enemy-died`.
 *
 * ⚑ THE SEAM FOR #11 (boss agents choose their own actions). A boss agent's choice replaces
 * the `randInt` skill pick inside `resolveEnemyAttack` with a chosen `SkillId` (or a plain
 * strike), rolling to-hit first as now; the choice enters `step` as an input alongside the
 * player's (GAME-DESIGN.md §17.3 point 2) and this function receives one choice per action its
 * gauge granted — `actions` is already computed here. Nothing else in the loop moves.
 */
export function resolveEnemyTurn(ctx: RoundContext, rng: Rng, rules: RoundRules): TurnOutcome {
  const begun = beginEnemyTurn(ctx, rng, rules);
  if (begun === 'enemy-died') return 'enemy-died';

  // c. The actions.
  for (let i = 0; i < begun.actions; i += 1) {
    if (i === 1) ctx.events.push({ kind: 'tempo-extra-action', subject: 'enemy' });
    const outcome = enemyAttack(ctx, begun.advDisOverride, rng);
    if (outcome !== 'ongoing') return outcome;
  }
  return 'ongoing';
}

/** What the first half of the enemy's turn leaves: its actions, and its own tick's adv/dis. */
export interface EnemyTurnStart {
  actions: 0 | 1 | 2;
  /** The adv/dis the enemy's OWN tick produced (fracture) — combined per action with its target's. */
  advDisOverride: -1 | 0 | 1;
}

/**
 * The first half of the enemy's turn — steps a and b of `resolveEnemyTurn`, unchanged: the tick
 * and the gauge. Split out (PLAN.md #11) so a BOSS turn can stop here and ask for its choice.
 * `skipGauge` (a granted `pause` concession) ticks the conditions but moves no gauge and grants
 * no action. PURE apart from appending to `ctx`.
 */
export function beginEnemyTurn(
  ctx: RoundContext,
  rng: Rng,
  rules: RoundRules,
  skipGauge = false,
): EnemyTurnStart | 'enemy-died' {
  // a. The tick.
  const etc = tickConditions(ctx.enemy, ctx.player, rng);
  const delta = etc.hpDelta < 0 ? etc.hpDelta * ctx.mods.dotTickMult : etc.hpDelta;
  const ticked: Enemy = { ...ctx.enemy, activeConditions: etc.conditions };
  const rawHp = ctx.enemy.hp + delta;
  ctx.enemy = {
    ...ticked,
    hp: delta > 0 ? Math.min(rawHp, effectiveMaxHp(ticked)) : ctx.enemy.illusory ? ctx.enemy.hp : Math.max(rawHp, 0),
  };
  ctx.events.push(...etc.events);
  syncHp(ctx, 'enemy');
  if (ctx.enemy.hp <= 0) return 'enemy-died';
  if (skipGauge) return { actions: 0, advDisOverride: etc.advDisOverride };

  // b. The gauge.
  const family = rules.familySpeed ? (getFamily(ctx.enemy.familyId)?.theme.speedTenths ?? 0) : 0;
  const rate = rules.enemyTempo ? tempoRate(ctx.enemy, rules.tempoRateCapTenths, family) : 0;
  const { actions } = moveGauge(ctx, 'enemy', rate, !etc.skipTurn);
  return { actions, advDisOverride: etc.advDisOverride };
}

/**
 * ONE enemy attack — to-hit, then what lands on a hit — and its ONE pass through the guarded
 * damage path (first-hit reduction → shield → HP → `onTakeDamage` → revive). `forced` is a
 * boss's chosen move (PLAN.md #11); omitted, the random affordable skill pick of today.
 */
function enemyAttack(
  ctx: RoundContext,
  advDisOverride: -1 | 0 | 1,
  rng: Rng,
  forced?: ForcedEnemyMove,
): TurnOutcome {
  // M4: to-hit vs the player's real AC. G30: the adv/dis its TARGET imposes (Scavver evasion)
  // combined with the override its OWN tick produced (fracture).
  const enemyAdvDis = combineAdvDis(enemyAdvDisVs(ctx.player), advDisOverride);
  const ea = resolveEnemyAttack(ctx.enemy, ctx.player, playerArmorClass(ctx.player), enemyAdvDis, rng, forced);
  ctx.enemy = ea.enemy;
  ctx.player = ea.target;
  ctx.events.push(...ea.events);
  // `resolveEnemyAttack` always pushes its `attack` event LAST (asserted in combat.test.ts).
  const taken = applyDamageToPlayer(ctx.player, ctx.enemy, ea.damage, {
    mods: ctx.mods,
    firstHitDone: ctx.firstHitDone,
    reviveUsed: ctx.reviveUsed,
    events: ctx.events,
    attackEventIndex: ctx.events.length - 1,
  });
  ctx.player = taken.player;
  ctx.enemy = taken.enemy;
  ctx.firstHitDone = taken.firstHitDone;
  ctx.reviveUsed = taken.reviveUsed;
  syncHp(ctx, 'player');
  syncHp(ctx, 'enemy'); // an `onTakeDamage` reflect
  // Momentum (Enforcer only): +1 for TAKING damage (post-reduction, post-shield).
  if (usesMomentum(ctx.player) && taken.applied > 0) ctx.player = grantMomentum(ctx.player, 1);
  if (taken.died) return 'player-died';
  if (ctx.enemy.hp <= 0) return 'enemy-died';
  return 'ongoing';
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
  // PLAN.md #2: a FULL backpack (§22.17) leaves the drop where it fell — the victory reports
  // only what was taken, and `loot-left-behind` says what was not. The drop was still ROLLED
  // (its draws are unchanged), so a full pack moves no later draw.
  const carried = drop !== null && canCarry(player.inventory);
  const inventory = carried ? pickUp(player.inventory, drop) : player.inventory;
  const loot = carried ? [summarizeLoot(drop)] : [];
  const newPlayer: Player = {
    ...player,
    xp: player.xp + xpGained,
    inventory,
  };
  events.push({ kind: 'victory', xpGained, loot });
  if (drop !== null && !carried) {
    const left = summarizeLoot(drop);
    events.push({ kind: 'loot-left-behind', name: left.name, rarity: left.rarity });
  }
  return {
    state: { ...state, player: newPlayer, enemy },
    events,
    status: 'player-won',
    resolved: true,
    roundComplete: true,
  };
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
