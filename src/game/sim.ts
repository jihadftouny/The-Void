// Balance simulation harness for The Void — pure, framework-agnostic game logic (M15 part 1).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: this module lives under `src/game`, imports ONLY pure game
//    modules (createGame/step + read-only selectors), and runs headlessly in Node/Vitest. No
//    Kaplay/DOM/canvas import, no `fs`, no console. It NEVER mutates a `GameState` and never
//    reaches into private internals — it only READS the state exposed by `StepResult` and
//    dispatches valid `GameInput`s through the real `step` controller.
//  - Deterministic seeded RNG: the harness introduces NO randomness of its own. All run
//    variance flows from the seed through `createGame`/`step`; the policy is a PURE function of
//    the current `StepResult`. No `Math.random`, no `Date.now`. (A future policy wanting
//    randomness must seed via `createRng(state.rngState)` — the shipped policies use none.)
//  - Serializable plain-data state: `RunResult` / `ClassStats` / `AggregateReport` are flat
//    plain data; the harness only reads/serializes plain `GameState`.
//
// SCOPE: this unit is PURE-ADDITIVE. It measures winnability of the CURRENT build; it tunes no
// balance constant and edits no existing source file. The run fights with STARTING GEAR the
// whole way — the `step` controller's `GameInput` union has no equip action, so found loot lands
// in the backpack unused. The measured win-rate is therefore a LOWER BOUND (real players equip
// found loot). Promoting equip to a step input is a later follow-up, out of scope here.

import {
  createGame,
  step,
  awaitingFor,
  type GameState,
  type GameInput,
  type StepResult,
} from './game.ts';
import { type PlayerClass } from './player.ts';
import { spareAvailable, type BattleState, type BattleAction } from './battle.ts';
import { hasControlCondition } from './condition.ts';
import { resolveSkill, type SkillId } from './skill.ts';
import { type DraftOption } from './draft.ts';
import { effectiveMaxHp } from './statEffects.ts';
import { type RunUnlocks } from './unlockStore.ts';

// ------- Public types --------------------------------------------------------

/** A pure decision function of the CURRENT `StepResult` (phase + awaiting). Deterministic. */
export type SimPolicy = (res: StepResult) => GameInput;

/** How a run ended, in player terms. */
export type RunOutcome = 'grace' | 'damnation' | 'death';

/** The flat, plain-data record of one finished run. */
export interface RunResult {
  seed: number;
  classId: PlayerClass;
  outcome: RunOutcome;
  /** The act the player died in (`finalAct`) when `outcome==='death'`, else `null`. */
  diedAtAct: number | null;
  /** The act the run ended in (1..5). */
  finalAct: number;
  /** The player's level at the terminal state. */
  finalLevel: number;
  /** Count of `act-outro` events seen — each marks a concluded floor. */
  floorsCleared: number;
  /** Number of `step` calls the run took to reach a terminal state. */
  steps: number;
  /** A short player-facing cause string (the felling enemy, or the ending reached). */
  cause: string;
}

/** Per-class aggregate figures. */
export interface ClassStats {
  runs: number;
  wins: number;
  grace: number;
  damnation: number;
  deaths: number;
  winRate: number;
  avgLevel: number;
  avgFloorsCleared: number;
  /** Deaths keyed by the act they occurred in (1..5). */
  deathByAct: Record<number, number>;
}

/** The whole-batch aggregate. */
export interface AggregateReport {
  runs: number;
  classes: PlayerClass[];
  wins: number;
  grace: number;
  damnation: number;
  deaths: number;
  winRate: number;
  avgLevel: number;
  avgFloorsCleared: number;
  deathByAct: Record<number, number>;
  perClass: Record<PlayerClass, ClassStats>;
}

/** The five playable classes, in a fixed canonical order (for the report roster). */
export const ALL_CLASSES: readonly PlayerClass[] = [
  'Enforcer',
  'Neuromancer',
  'Scavver',
  'Penitent',
  'Hollow',
];

// ------- The policies --------------------------------------------------------

/**
 * Pick the highest-priority draft offer, first match wins (deterministic): a `stat` on CON,
 * then any `perk`, then any `upgrade`, then any `skill`, else index 0. Survivability first.
 */
function chooseDraft(offers: readonly DraftOption[]): number {
  let i = offers.findIndex((o) => o.kind === 'stat' && o.stat === 'CON');
  if (i >= 0) return i;
  i = offers.findIndex((o) => o.kind === 'perk');
  if (i >= 0) return i;
  i = offers.findIndex((o) => o.kind === 'upgrade');
  if (i >= 0) return i;
  i = offers.findIndex((o) => o.kind === 'skill');
  if (i >= 0) return i;
  return 0;
}

/**
 * Choose a battle action — reasonable, engine-authoritative play. Reads only the pure,
 * exported selectors (`effectiveMaxHp`, `resolveSkill`, `spareAvailable`); never internals.
 *
 * NOTE on the charge-cost estimate: the effective cost equals `def.chargeCost` minus any equip
 * charge-discount. The sim fights with starting gear (no relics), so that discount is 0 and the
 * estimate is exact. Using `def.chargeCost` directly is also CONSERVATIVE-SAFE — it is never
 * below the true cost, so an action deemed affordable is always truly affordable and `step`
 * never rejects a dispatched cast (which would stall the round).
 */
function chooseBattleAction(battle: BattleState, merciful: boolean): BattleAction {
  const pl = battle.player;
  const cap = effectiveMaxHp(pl);

  // Merciful variant: release a living karma-weighted (⚖) non-boss foe to exercise the grace
  // path. The base policy never spares (a spare forfeits the kill XP the act gates require).
  if (merciful && !battle.boss && spareAvailable(battle)) return 'spare';

  // Under a control condition (stun/freeze/sleep) the player cannot act: a potion is BLOCKED and
  // a cast is skipped WITHOUT advancing the round — only fight/cast run the shared round that
  // ticks the condition down. So `fight` (never `potion`/`run`, which stall) to let the round
  // resolve and the control wear off; the player's swing is skipped but the condition ticks.
  if (hasControlCondition(pl)) return 'fight';

  // 1. Heal with a potion when badly hurt and one remains.
  if (pl.pots > 0 && pl.hp <= 0.35 * cap) return 'potion';

  // 2. Consider the best AFFORDABLE skill from the pool (deterministic; ties broken by pool
  //    order via the strict `>` comparisons below).
  let bestHeal: { id: SkillId; heal: number } | null = null;
  let bestDamage: { id: SkillId; dmg: number } | null = null;
  for (const rawId of pl.skillPool) {
    const id = rawId as SkillId;
    const def = resolveSkill(pl, id);
    if (!def) continue;
    const effectiveCost = Math.max(def.chargeCost, 0);
    if (pl.skillCharges < effectiveCost) continue;
    const heal = def.selfHeal ?? 0;
    if (heal > 0) {
      if (!bestHeal || heal > bestHeal.heal) bestHeal = { id, heal };
    } else if (!bestDamage || def.baseDamage > bestDamage.dmg) {
      bestDamage = { id, dmg: def.baseDamage };
    }
  }
  // A heal skill when at/below half HP and no potion was spent this turn.
  if (bestHeal && pl.hp <= 0.5 * cap) return { kind: 'cast', skillId: bestHeal.id };
  // A damage skill worth a charge over a plain swing.
  if (bestDamage && bestDamage.dmg >= 2 && pl.skillCharges > 0) {
    return { kind: 'cast', skillId: bestDamage.id };
  }

  // 3. Flee a near-certain death when heals are exhausted and escape is possible.
  if (pl.hp <= 0.2 * cap && pl.pots === 0 && battle.canFlee) return 'run';

  // 4. Otherwise swing.
  return 'fight';
}

/**
 * The shared decision core, total over `Awaiting` — so it ALWAYS returns a legal input for the
 * phase it is asked about. `merciful` toggles the spare behaviour in `battle-action`.
 */
function decide(res: StepResult, classId: PlayerClass, merciful: boolean): GameInput {
  const phase = res.state.phase;
  switch (res.awaiting) {
    case 'title':
      return { kind: 'continue' };
    case 'enter-name':
      return { kind: 'name', name: 'Sim' };
    case 'choose-class':
      return { kind: 'class', classId };
    case 'accept-or-reroll-stats':
      return { kind: 'stats-decision', accept: true };
    case 'main-menu':
      // The shipped policies never seek a deal — this is the no-sacrifice, found-loot-only
      // baseline (the §11 load-bearing question).
      return { kind: 'menu', choice: 'continue' };
    case 'continue':
      return { kind: 'continue' };
    case 'battle-action':
      // `battle-action` is awaited only from a started battle phase.
      return phase.kind === 'battle'
        ? { kind: 'battle-action', action: chooseBattleAction(phase.battle, merciful) }
        : { kind: 'continue' };
    case 'draft-pick':
      return phase.kind === 'level-up-draft'
        ? { kind: 'draft-pick', index: chooseDraft(phase.offers) }
        : { kind: 'continue' };
    case 'deal-decision': {
      if (phase.kind !== 'deal') return { kind: 'continue' };
      const { cost, reward } = phase.deal;
      // Take a clearly-beneficial deal; never pay the body (hp / maxHp).
      const accept =
        cost.kind !== 'hp' &&
        cost.kind !== 'maxHp' &&
        (reward.kind === 'item' ||
          reward.kind === 'heal' ||
          reward.kind === 'statPoint' ||
          reward.kind === 'skillCharge');
      return { kind: 'deal-decision', accept };
    }
    case 'rest-decision':
      return { kind: 'rest-decision', accept: true };
    case 'game-over':
      // Unreachable dispatch (the loop exits on this awaiting); return a valid input anyway.
      return { kind: 'continue' };
  }
}

/** The default "reasonable, no-sacrifice, no-spare" policy for a given class. */
export function heuristicPolicy(classId: PlayerClass): SimPolicy {
  return (res) => decide(res, classId, false);
}

/**
 * A mercy policy: identical to `heuristicPolicy`, except it SPARES a living ⚖ non-boss enemy.
 * Used to exercise and report the grace path (which the kill-everything baseline never reaches).
 */
export function mercifulPolicy(classId: PlayerClass): SimPolicy {
  return (res) => decide(res, classId, true);
}

// ------- The run loop --------------------------------------------------------

/**
 * Play a `GameState` to a terminal (`game-over`) state under `policy` — PURE. Repeatedly
 * `step`s with the policy's chosen input, classifying the outcome from the emitted events and
 * the final state. The `guard` bounds pathological non-termination; a healthy policy never
 * approaches it. Exposed so tests can start from a hand-built near-terminal `GameState`.
 */
export function runToTerminal(
  initial: GameState,
  policy: SimPolicy,
  guard = 200_000,
): RunResult {
  let res: StepResult = {
    state: initial,
    events: [],
    awaiting: awaitingFor(initial.phase),
  };
  let steps = 0;
  let endingType: 'grace' | 'damnation' | null = null;
  let floorsCleared = 0;
  let lastEnemy = '';

  while (res.awaiting !== 'game-over' && steps < guard) {
    const input = policy(res);
    res = step(res.state, input);
    steps++;
    for (const e of res.events) {
      if (e.kind === 'act-outro') floorsCleared++;
      else if (e.kind === 'ending') endingType = e.endingType;
      else if (
        e.kind === 'encounter-start' ||
        e.kind === 'boss-encounter' ||
        e.kind === 'final-battle-begins'
      ) {
        lastEnemy = e.enemyName;
      }
    }
  }

  const outcome: RunOutcome = endingType ?? 'death';
  const finalAct = res.state.act;
  const finalLevel = res.state.player?.level ?? 1;
  const classId = res.state.player?.classId ?? 'Enforcer';
  const cause =
    outcome === 'grace'
      ? 'ascended (grace)'
      : outcome === 'damnation'
        ? 'unmade the Hollow (damnation)'
        : lastEnemy || 'the Void';

  return {
    seed: initial.rngState,
    classId,
    outcome,
    diedAtAct: outcome === 'death' ? finalAct : null,
    finalAct,
    finalLevel,
    floorsCleared,
    steps,
    cause,
  };
}

/**
 * Build `createGame(seed[, unlocks])` and play it to a terminal state — PURE. Uses
 * `opts.policy` when given, else `heuristicPolicy(opts.classId)`. The returned `seed`/`classId`
 * are the authoritative injected values.
 */
export function simulateRun(
  seed: number,
  opts: { classId: PlayerClass; policy?: SimPolicy; unlocks?: RunUnlocks },
): RunResult {
  const initial = opts.unlocks ? createGame(seed, opts.unlocks) : createGame(seed);
  const policy = opts.policy ?? heuristicPolicy(opts.classId);
  const result = runToTerminal(initial, policy);
  return { ...result, seed, classId: opts.classId };
}

// ------- Aggregation ---------------------------------------------------------

/** A fresh 1..5 death histogram, every act at 0. */
function emptyDeathByAct(): Record<number, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/**
 * Run `classes × seeds` (in that fixed order) and fold the results into an `AggregateReport` —
 * PURE and deterministic for a fixed `{seeds, classes}`. `winRate = (grace + damnation) / runs`;
 * `deathByAct` is keyed 1..5. Uses `opts.policy(classId)` per class when given, else
 * `heuristicPolicy(classId)`.
 */
export function simulateBatch(opts: {
  seeds: number[];
  classes: PlayerClass[];
  policy?: (c: PlayerClass) => SimPolicy;
  unlocks?: RunUnlocks;
}): AggregateReport {
  const perClass = {} as Record<PlayerClass, ClassStats>;
  const overallDeathByAct = emptyDeathByAct();
  let runs = 0;
  let wins = 0;
  let grace = 0;
  let damnation = 0;
  let deaths = 0;
  let levelSum = 0;
  let floorsSum = 0;

  for (const classId of opts.classes) {
    const policy = opts.policy ? opts.policy(classId) : heuristicPolicy(classId);
    const stat: ClassStats = {
      runs: 0,
      wins: 0,
      grace: 0,
      damnation: 0,
      deaths: 0,
      winRate: 0,
      avgLevel: 0,
      avgFloorsCleared: 0,
      deathByAct: emptyDeathByAct(),
    };
    let classLevelSum = 0;
    let classFloorsSum = 0;

    for (const seed of opts.seeds) {
      const runOpts: { classId: PlayerClass; policy: SimPolicy; unlocks?: RunUnlocks } = {
        classId,
        policy,
      };
      if (opts.unlocks) runOpts.unlocks = opts.unlocks;
      const r = simulateRun(seed, runOpts);

      stat.runs++;
      classLevelSum += r.finalLevel;
      classFloorsSum += r.floorsCleared;
      if (r.outcome === 'grace') {
        stat.grace++;
        stat.wins++;
      } else if (r.outcome === 'damnation') {
        stat.damnation++;
        stat.wins++;
      } else {
        stat.deaths++;
        const act = r.diedAtAct ?? r.finalAct;
        stat.deathByAct[act] = (stat.deathByAct[act] ?? 0) + 1;
        overallDeathByAct[act] = (overallDeathByAct[act] ?? 0) + 1;
      }
    }

    stat.winRate = stat.runs > 0 ? stat.wins / stat.runs : 0;
    stat.avgLevel = stat.runs > 0 ? classLevelSum / stat.runs : 0;
    stat.avgFloorsCleared = stat.runs > 0 ? classFloorsSum / stat.runs : 0;
    perClass[classId] = stat;

    runs += stat.runs;
    wins += stat.wins;
    grace += stat.grace;
    damnation += stat.damnation;
    deaths += stat.deaths;
    levelSum += classLevelSum;
    floorsSum += classFloorsSum;
  }

  return {
    runs,
    classes: [...opts.classes],
    wins,
    grace,
    damnation,
    deaths,
    winRate: runs > 0 ? wins / runs : 0,
    avgLevel: runs > 0 ? levelSum / runs : 0,
    avgFloorsCleared: runs > 0 ? floorsSum / runs : 0,
    deathByAct: overallDeathByAct,
    perClass,
  };
}
