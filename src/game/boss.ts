// Boss mechanics + the karma verdict gate for The Void — pure, framework-agnostic (M12).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. `generateBoss`,
//    `bossPostRound`, `computeVerdict`, and `pickIndulgedAxis` are pure — they return
//    new plain-data values and print nothing.
//  - Deterministic seeded RNG: only `generateBoss` DRAWS, and it does so solely through
//    the injected `Rng` (via `generateEnemy`). `bossPostRound` and `computeVerdict` are
//    RNG-FREE deterministic counters/arithmetic. No Math.random / Date.now.
//  - Data-driven content: boss identities/params live in the `BOSSES` / `SIN_BY_AXIS`
//    tables and the labelled constants below, not in branching logic. DEVIATION from
//    principle 3 (JSON) — these are inline typed consts, not JSON, so the `BossId` /
//    `SkillId` / `KarmaAxis` typing stays tight (mirrors the `CLASSES`/`SKILLS` precedent
//    in classKit.ts/skill.ts). Justified by compile-time type safety.
//  - Serializable plain-data state: `BossState` is a flat record of primitives + a flat
//    string→number record, so it round-trips through JSON with the battle it rides on.
//
// SCOPE (M12): MECHANICS ONLY. Every magnitude here (summon cadence, minion damage,
// adapt threshold, Sin HP scaling, Hollow scaling, gate weights/threshold) is an M15
// BALANCE PLACEHOLDER, single-sourced in this module so retuning is a one-line change.
// Boss dialogue/voice, floor/ending prose, and in-UI presentation are all deferred.

import { generateEnemy, type Enemy } from './enemy.ts';
import { computeStatMods } from './character.ts';
import { type Player } from './player.ts';
import { type KarmaState } from './karma.ts';
import { type Rng } from './rng.ts';
import { type BattleState, type BattleAction } from './battle.ts';
import { type CombatEvent } from './combatEvent.ts';
import { FINAL_BOSS_XP } from './progression.ts';

// ------- Ids + data ----------------------------------------------------------

/**
 * The four COMBAT bosses (one per act 1/2/3/5). The act-4 Warden is a pure VERDICT gate,
 * not a fight, so it carries no `BossId` — see `computeVerdict`.
 */
export type BossId = 'kingpin' | 'reflection' | 'sin' | 'hollow';

/** The unique mechanic kind each boss expresses (for readability + future narration). */
export type BossMechanic = 'summon-adds' | 'mirror-adapt' | 'karma-scaled' | 'mirror-conditions';

/** A boss row: a placeholder display name + its mechanic kind. */
export interface BossDef {
  name: string;
  mechanic: BossMechanic;
}

/**
 * The boss table. Placeholder names (real names/voice are M11/author). `sin`'s name is a
 * generic base overwritten per-axis at generation via `SIN_BY_AXIS`.
 */
export const BOSSES: Record<BossId, BossDef> = {
  kingpin: { name: 'Undercity Kingpin', mechanic: 'summon-adds' },
  reflection: { name: 'The Reflection', mechanic: 'mirror-adapt' },
  sin: { name: 'The Indulged', mechanic: 'karma-scaled' },
  hollow: { name: 'Hollow Self', mechanic: 'mirror-conditions' },
};

/** The four karma axes, as the keys of `KarmaState`. */
export type KarmaAxis = keyof KarmaState;

// ------- M15 BALANCE PLACEHOLDER constants (single-sourced) -------------------

// M15 BALANCE: the Act-1 Kingpin was the single biggest Act-1 killer (≈31% of Act-1 deaths in
// the sim) — a fresh, un-levelled character with NO attack advantage faces summoned minions
// stacking flat damage every round. Softened across all three levers (slower summons, less
// per-minion damage, a smaller crew) so the first boss is a threat, not a run-ender, and Act-1
// deaths drop into line with the other floors. See docs/BALANCE-REPORT.md.
/** Kingpin: summon a new minion every N rounds. M15: 2 → 3. */
export const KINGPIN_SUMMON_EVERY_ROUNDS = 3;
/** Kingpin: extra damage the player takes per active minion, each round. M15: 2 → 1. */
export const KINGPIN_MINION_DAMAGE = 1;
/** Kingpin: the minion crew never grows past this many. M15: 3 → 2. */
export const KINGPIN_MAX_MINIONS = 2;

/** Reflection: repeats of the SAME action before the boss reads + disadvantages it. */
export const REFLECTION_ADAPT_THRESHOLD = 3;

/** Sin: bonus max HP per point of magnitude on the indulged axis. M15: 5 → 3. */
export const SIN_HP_PER_POINT = 3;

/**
 * Sin identity by the indulged (most-negative) karma axis. All `bossId:'sin'`; the `name`
 * is the placeholder demon/feeling the axis manifests as.
 */
export const SIN_BY_AXIS: Record<KarmaAxis, { bossId: 'sin'; name: string }> = {
  reverenceDesecration: { bossId: 'sin', name: 'The Desecration' },
  mercyCruelty: { bossId: 'sin', name: 'The Cruelty' },
  restraintGreed: { bossId: 'sin', name: 'The Avarice' },
  clarityDelusion: { bossId: 'sin', name: 'The Delusion' },
};

/**
 * Tie-break priority when two axes are equally-indulged (equally most-negative): reverence,
 * mercy, greed, clarity — matching the gate weighting (reverence heaviest).
 */
export const SIN_AXIS_PRIORITY: readonly KarmaAxis[] = [
  'reverenceDesecration',
  'mercyCruelty',
  'restraintGreed',
  'clarityDelusion',
];

/** Sin default axis when the player indulged nothing (every axis >= 0). */
export const SIN_DEFAULT_AXIS: KarmaAxis = 'reverenceDesecration';

/**
 * Hollow: scale the mirror boss's HP by this factor over the base enemy roll. M15: 1.5 → 1.2.
 * The Act-5 Hollow is the ONLY win the baseline (kill-everything → cast-down) policy can reach,
 * so it is the win-rate gate. With the gentler enemy HP scaling it sat far too high; 1.2 keeps
 * it a real terminal fight while letting runs that survive the descent actually close it out.
 */
export const HOLLOW_HP_SCALE = 1.2;

// ------- The verdict gate (the first real karma EFFECT) ----------------------

/**
 * The gate weights: reverence↔desecration is heaviest (×3), the other three axes ×1.
 * M15 PLACEHOLDER — single-sourced so retuning is one edit.
 */
export const GATE_WEIGHTS: Record<KarmaAxis, number> = {
  reverenceDesecration: 3,
  mercyCruelty: 1,
  restraintGreed: 1,
  clarityDelusion: 1,
};

/** GRACE iff the weighted sum is >= this threshold, else CAST-DOWN. M15 PLACEHOLDER. */
export const GATE_THRESHOLD = 1;

/**
 * The act-4 reckoning — PURE, RNG-FREE. Computes the weighted sum of the four karma axes
 * (positive = virtue, per `karma.ts`) and routes: `sum >= GATE_THRESHOLD` earns GRACE
 * (ascension), else CAST-DOWN (the fall to act 5 + the Hollow). Emits NO karma value —
 * only the outcome — so karma stays hidden.
 */
export function computeVerdict(karma: KarmaState): 'grace' | 'cast-down' {
  let sum = 0;
  for (const axis of SIN_AXIS_PRIORITY) {
    sum += GATE_WEIGHTS[axis] * karma[axis];
  }
  return sum >= GATE_THRESHOLD ? 'grace' : 'cast-down';
}

// ------- Boss state ----------------------------------------------------------

/**
 * The serializable boss data that rides on a `BattleState.boss`. Every field is a
 * primitive or a flat string→number record, so it JSON round-trips. Optional fields are
 * present only for the boss kind that uses them (kingpin: `minions`; reflection:
 * `actionTally`/`adapted`).
 */
export interface BossState {
  bossId: BossId;
  /** Rounds elapsed against this boss (drives the kingpin cadence; save-visible). */
  round: number;
  /** Kingpin: current minion crew size (0..KINGPIN_MAX_MINIONS). */
  minions?: number;
  /** Reflection: whether the disadvantage adaptation has fired. */
  adapted?: boolean;
  /** Reflection: per-action repeat tally (keyed by a stable action key). */
  actionTally?: Record<string, number>;
}

// ------- Axis selection ------------------------------------------------------

/**
 * The axis the player most INDULGED — the most-negative axis (deepest shadow). PURE.
 * Ties resolve by `SIN_AXIS_PRIORITY` (strict `<` keeps the earlier/higher-priority axis).
 * When every axis is >= 0 (nothing indulged) returns `SIN_DEFAULT_AXIS`.
 */
export function pickIndulgedAxis(karma: KarmaState): KarmaAxis {
  let best: KarmaAxis | null = null;
  let bestVal = 0;
  for (const axis of SIN_AXIS_PRIORITY) {
    const v = karma[axis];
    if (v < bestVal) {
      bestVal = v;
      best = axis;
    }
  }
  return best ?? SIN_DEFAULT_AXIS;
}

// ------- Generation ----------------------------------------------------------

/**
 * Build a combat boss — PURE, threading the injected `Rng`. It first rolls a base enemy via
 * the existing `generateEnemy` (reusing all scaling + name/HP draws for determinism), THEN
 * patches per mechanic. `karmaWeighted` is forced false (bosses offer no moral fork — spare
 * stays unavailable). Same `{ bossId, act, player, karma, seed }` ⇒ identical result.
 *
 *  - kingpin: an empty minion crew; the adds live in `bossPostRound`.
 *  - reflection: the enemy fights with a COPY of the player's `skillPool`; no free advantage
 *    (the base enemy carries none); tally/adapt state initialized.
 *  - sin: identity + bonus HP chosen by the indulged axis (`magnitude = max(0, -karma[axis])`,
 *    bonus = `magnitude × SIN_HP_PER_POINT` added to maxHp AND hp).
 *  - hollow: a COPY of the player's `skillPool` + `stats` (mods recomputed), HP scaled by
 *    `HOLLOW_HP_SCALE`. Scaled off `FINAL_BOSS_XP` as the base-enemy playerXp.
 */
export function generateBoss(args: {
  bossId: BossId;
  act: number;
  player: Player;
  karma: KarmaState;
  rng: Rng;
}): { enemy: Enemy; boss: BossState } {
  const { bossId, act, player, karma, rng } = args;
  const def = BOSSES[bossId];
  // Hollow scales off the fixed FINAL_BOSS_XP (the retired final-boss scaling base);
  // the other bosses scale off the player's current xp.
  const playerXp = bossId === 'hollow' ? FINAL_BOSS_XP : player.xp;
  const base = generateEnemy({ act, type: def.name, playerXp }, rng);

  let enemy: Enemy = { ...base, karmaWeighted: false };
  const boss: BossState = { bossId, round: 0 };

  switch (bossId) {
    case 'kingpin':
      boss.minions = 0;
      break;
    case 'reflection':
      enemy = { ...enemy, skillPool: [...player.skillPool] };
      boss.adapted = false;
      boss.actionTally = {};
      break;
    case 'sin': {
      const axis = pickIndulgedAxis(karma);
      const sinDef = SIN_BY_AXIS[axis];
      const magnitude = Math.max(0, -karma[axis]);
      const bonus = magnitude * SIN_HP_PER_POINT;
      enemy = {
        ...enemy,
        type: sinDef.name,
        name: sinDef.name,
        fullName: sinDef.name,
        maxHp: enemy.maxHp + bonus,
        hp: enemy.hp + bonus,
      };
      break;
    }
    case 'hollow':
      enemy = {
        ...enemy,
        skillPool: [...player.skillPool],
        stats: { ...player.stats },
        mods: computeStatMods(player.stats),
        maxHp: Math.floor(enemy.maxHp * HOLLOW_HP_SCALE),
        hp: Math.floor(enemy.hp * HOLLOW_HP_SCALE),
      };
      break;
  }

  return { enemy, boss };
}

// ------- Per-round hook ------------------------------------------------------

/** A stable key for tallying a repeated action (fight / cast:<id> / consumable:<src>). */
function actionKey(action: BattleAction): string {
  if (typeof action === 'string') return action;
  if (action.kind === 'cast') return `cast:${action.skillId}`;
  return `consumable:${JSON.stringify(action.source)}`;
}

/** What `bossPostRound` returns: the patched battle, extra events, and a possibly-lethal status. */
export interface BossRoundResult {
  battle: BattleState;
  events: CombatEvent[];
  status: 'ongoing' | 'player-died';
}

/**
 * Apply a boss's per-round mechanic AFTER `resolveRound` — PURE, RNG-FREE. Called by game.ts
 * only when a boss round resolved `ongoing`. Off-equivalent by construction: a battle with no
 * `boss` never reaches here (game.ts guards on `battle.boss`).
 *
 *  - kingpin: `round++`; on the fixed cadence (and under the cap) summon one minion
 *    (`boss-summon`); then the whole crew deals `minions × KINGPIN_MINION_DAMAGE` extra damage
 *    (`boss-minion-damage`), clamped at 0 hp. Player to 0 ⇒ `player-died` (+ `defeat`).
 *  - reflection: tally the action; the first time any tally reaches `REFLECTION_ADAPT_THRESHOLD`
 *    (and not yet adapted) the boss adapts — the player rolls at DISADVANTAGE for the rest of
 *    THIS battle (`battle.playerAdvantage = -1`, G12) and a `boss-adapt` fires.
 *  - sin / hollow: no per-round mechanic (theirs is entirely at generation); only `round++`
 *    for save-visibility, no events.
 */
export function bossPostRound(battle: BattleState, action: BattleAction): BossRoundResult {
  const boss = battle.boss;
  if (!boss) return { battle, events: [], status: 'ongoing' };

  const events: CombatEvent[] = [];
  const nextBoss: BossState = { ...boss, round: boss.round + 1 };

  switch (boss.bossId) {
    case 'kingpin': {
      let minions = nextBoss.minions ?? 0;
      if (nextBoss.round % KINGPIN_SUMMON_EVERY_ROUNDS === 0 && minions < KINGPIN_MAX_MINIONS) {
        minions += 1;
        events.push({ kind: 'boss-summon', minions });
      }
      nextBoss.minions = minions;
      let player = battle.player;
      let status: 'ongoing' | 'player-died' = 'ongoing';
      if (minions > 0) {
        const amount = minions * KINGPIN_MINION_DAMAGE;
        const hp = Math.max(player.hp - amount, 0);
        player = { ...player, hp };
        events.push({ kind: 'boss-minion-damage', amount });
        if (hp <= 0) {
          events.push({ kind: 'defeat' });
          status = 'player-died';
        }
      }
      return { battle: { ...battle, boss: nextBoss, player }, events, status };
    }
    case 'reflection': {
      const tally = { ...(nextBoss.actionTally ?? {}) };
      const key = actionKey(action);
      tally[key] = (tally[key] ?? 0) + 1;
      nextBoss.actionTally = tally;
      const next: BattleState = { ...battle, boss: nextBoss };
      if (!nextBoss.adapted && tally[key]! >= REFLECTION_ADAPT_THRESHOLD) {
        nextBoss.adapted = true;
        // G12: the adaptation is a STANDING, BATTLE-SCOPED penalty, so it is written to
        // `battle.playerAdvantage` instead of onto the player. Written onto the player it
        // survived the fight — `game.ts` persists `battle.player` to the hub — so a single
        // Reflection adapt disadvantaged the player for the REST OF THE RUN. Same meaning,
        // now cleared by the next `createBattle`.
        next.playerAdvantage = -1;
        events.push({ kind: 'boss-adapt' });
      }
      return { battle: next, events, status: 'ongoing' };
    }
    case 'sin':
    case 'hollow':
      // Mechanic is entirely at generation; only advance the save-visible round counter.
      return { battle: { ...battle, boss: nextBoss }, events, status: 'ongoing' };
  }
}
