// Battle state + round step for The Void — pure, framework-agnostic game logic (M5).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: `resolveRound` clones the player/enemy, applies all
//    deltas to the clones, and returns a NEW BattleState plus an ordered event list
//    and a terminal status. The input state is never mutated; nothing is printed.
//  - Deterministic seeded RNG: every draw (enemy skill pick, condition saves, player
//    d20 + damage, flee roll, victory rest/gold) threads the injected `Rng` in a
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
import { randInt, type Rng } from './rng.ts';
import { type CombatEvent } from './combatEvent.ts';
import { hasControlCondition, tickConditions, type ConditionType } from './condition.ts';
import { resolveEnemyAttack, resolvePlayerAttack } from './combat.ts';

/** The full, serializable state of a battle in progress. */
export interface BattleState {
  player: Player;
  enemy: Enemy;
  /** Act 1..5 — combat only reads it (M8 drives progression). */
  act: number;
  /** False in the final act: escape is impossible. */
  canFlee: boolean;
}

/** The three player battle actions. */
export type BattleAction = 'fight' | 'potion' | 'run';

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
 * Fight draw order (documented for the exact-list test): enemy skill-pick draw ->
 * condition-tick saving-throw/flavor draws -> player d20 draw(s) -> player damage
 * draw(s) -> on victory: extra-rest draw then gold draw.
 */
export function resolveRound(state: BattleState, action: BattleAction, rng: Rng): RoundResult {
  switch (action) {
    case 'fight':
      return resolveFight(state, rng);
    case 'potion':
      return resolvePotion(state);
    case 'run':
      return resolveRun(state, rng);
    /* istanbul ignore next */
    default:
      return { state, events: [], status: 'ongoing' };
  }
}

function resolveFight(state: BattleState, rng: Rng): RoundResult {
  const events: CombatEvent[] = [];

  // 1. Enemy attacks (may cast a skill: spends a charge, may apply a condition).
  const ea = resolveEnemyAttack(state.enemy, state.player, rng);
  let enemy: Enemy = ea.enemy;
  let player: Player = ea.target;
  const enemyDamage = ea.damage;
  events.push(...ea.events);

  // 2. Tick the player's conditions (damage/heal/skip/fracture), then apply hp delta.
  const tc = tickConditions(player, enemy, rng);
  player = { ...player, activeConditions: tc.conditions, hp: player.hp + tc.hpDelta };
  if (tc.advDisOverride !== 0) {
    player = { ...player, advantageDisadvantage: tc.advDisOverride };
  }
  events.push(...tc.events);

  // 3. Player acts unless a condition made it skip.
  let playerDamage = 0;
  if (tc.skipTurn) {
    events.push({ kind: 'player-unable-to-act', conditionType: skipCause(tc.events) });
  } else {
    const pa = resolvePlayerAttack(player, enemy, rng);
    playerDamage = pa.damage;
    events.push(...pa.events);
  }

  // 4. Apply the exchanged damage (clamp hp at 0).
  player = { ...player, hp: Math.max(player.hp - enemyDamage, 0) };
  enemy = { ...enemy, hp: Math.max(enemy.hp - playerDamage, 0) };

  // 5. Resolve the outcome.
  let status: RoundStatus = 'ongoing';
  if (player.hp <= 0) {
    status = 'player-died';
    events.push({ kind: 'defeat' });
  } else if (enemy.hp <= 0) {
    status = 'player-won';
    const xpGained = enemy.xp;
    const extraRest = rng() * 100 + 1 <= 25;
    const goldGained = randInt(rng, enemy.xp);
    player = {
      ...player,
      xp: player.xp + xpGained,
      gold: player.gold + goldGained,
      restsLeft: player.restsLeft + (extraRest ? 1 : 0),
    };
    events.push({ kind: 'victory', xpGained, goldGained, extraRest });
  }

  return { state: { ...state, player, enemy }, events, status };
}

function resolvePotion(state: BattleState): RoundResult {
  const player = state.player;
  if (hasControlCondition(player)) {
    return { state, events: [{ kind: 'potion-blocked' }], status: 'ongoing' };
  }
  if (player.pots > 0 && player.hp < player.maxHp) {
    const healed: Player = { ...player, hp: player.maxHp, pots: player.pots - 1 };
    return {
      state: { ...state, player: healed },
      events: [{ kind: 'potion-drunk', healedTo: player.maxHp }],
      status: 'ongoing',
    };
  }
  return { state, events: [{ kind: 'potion-unavailable' }], status: 'ongoing' };
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
  const ea = resolveEnemyAttack(state.enemy, state.player, rng);
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
