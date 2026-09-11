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
// SCOPE: it measures winnability of the CURRENT build and tunes no balance constant.
//
// EQUIPMENT IS MODELLED (PLAN.md #2, FINDINGS.md G48/G11). The run used to fight with STARTING
// GEAR the whole way — `step` has no equip input, so found loot landed in the backpack unused and
// the old 32.9% headline described a character who never equipped anything. The sim now gears up
// at every hub visit through `gearUpAtHub`, which calls the SAME pure `equip` the UI's Equip
// button calls, OUTSIDE `step`, exactly as the UI does. ⚠ RECORDED DEVIATION from "every state
// change goes through `step`" (CLAUDE.md principle 1), inherited from `view-model.ts`'s
// `equipFromBackpack` and retired with it when #1.1 makes equip a step input. It stays
// deterministic: the gear-up is a pure function of the state, so a sim run still replays from
// `seed + inputs + the same gear-up rule`.
//
// It also HEALS WITH FOUND CONSUMABLES (a `healSelf` item from the backpack at ≤ 35% HP) — since
// PLAN.md #2 folded potions into consumables (§22.6), the only in-battle heal there is.
//
// And it MANAGES A FULL BACKPACK (§22.17, twelve slots) the way a careful player would, through
// `step`'s `discard` input: at the hub, and when a bargain's reward needs room (Appendix A.3), it
// leaves the LOWEST-RARITY loose gear behind and keeps every usable; with nothing but usables
// it backs out of the bargain instead of throwing a heal away.

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
import { equip, resolveInstanceDef } from './equipment.ts';
import { getCatalogItemById, type ItemInstance } from './item.ts';
import { canCarry } from './inventory.ts';
import { type Rarity } from './weapon.ts';
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

/**
 * A hub-time move the sim makes OUTSIDE `step` — the recorded deviation above. PURE: a function
 * of the state alone, so a run is still exactly reproducible.
 */
export type HubPrep = (state: GameState) => GameState;

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
 * Which backpack item a careful player leaves behind to make room — PURE: the LOWEST-RARITY
 * piece of loose GEAR (anything with a slot), first one on ties; usables are never chosen. -1
 * when the pack holds no gear at all.
 */
export function discardChoice(backpack: readonly ItemInstance[]): number {
  let best = -1;
  let bestRank = Infinity;
  backpack.forEach((item, i) => {
    const def = resolveInstanceDef(item);
    if (!def || def.slot === null) return;
    const rank = RARITY_RANK[def.rarity];
    if (rank < bestRank) {
      best = i;
      bestRank = rank;
    }
  });
  return best;
}

/** Rarity as a rank, so "better" is a comparison: Common < Rare < Legendary. */
const RARITY_RANK: Record<Rarity, number> = { Common: 0, Rare: 1, Legendary: 2 };

/**
 * Gear up at the hub — PURE, deterministic, and OUTSIDE `step` (see the header's deviation).
 *
 * THE RULE, the plan's (AC-26): walk the backpack in index order; a piece of gear goes on if its
 * slot is EMPTY, or if it OUTRANKS what is equipped there by rarity (strictly — an equal-rarity
 * item never displaces, so the walk cannot loop). A displaced item returns to the backpack, as
 * the UI's swap does. Repeats until a full pass equips nothing.
 *
 * ⚠ KNOWN, NOT FIXED HERE (GAME-DESIGN.md §22.20, `equipment.ts`'s known-gap block): a generated
 * weapon swings the unarmed die plus its flat bonus, so a COMMON generated mainHand is a
 * downgrade from a starting weapon. "Strictly outranks" means a Common drop never displaces
 * starting gear (whose rarity is Common or better), which is the only protection the rarity rule
 * can give; #1 owns the real fix.
 */
export function gearUpAtHub(state: GameState): GameState {
  if (state.phase.kind !== 'main-menu' || !state.player) return state;
  let inventory = state.player.inventory;
  let changed = true;
  let guard = 0;
  while (changed && guard < 64) {
    changed = false;
    guard += 1;
    for (let i = 0; i < inventory.backpack.length; i += 1) {
      const item = inventory.backpack[i]!;
      const def = resolveInstanceDef(item);
      if (!def || def.slot === null) continue;
      const current = inventory.slots[def.slot];
      const currentDef = current ? resolveInstanceDef(current) : undefined;
      const better =
        !current || (currentDef !== undefined && RARITY_RANK[def.rarity] > RARITY_RANK[currentDef.rarity]);
      if (!better) continue;
      const r = equip(inventory, i);
      if (!r.ok) continue;
      inventory = r.inventory;
      changed = true;
      break; // indices shifted — restart the walk
    }
  }
  if (inventory === state.player.inventory) return state;
  return { ...state, player: { ...state.player, inventory } };
}

/** The backpack index of the first item whose `use` heals, or -1 — the sim's only in-battle heal (§22.6). */
function healingConsumableIndex(backpack: readonly { defId: string }[]): number {
  return backpack.findIndex((item) =>
    (getCatalogItemById(item.defId)?.use ?? []).some((a) => a.kind === 'healSelf'),
  );
}

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

  // Under a control condition (stun/freeze/sleep) the player cannot act: `fight` runs the shared
  // round that ticks the condition down (the swing is skipped but the round resolves), where a
  // `run` would stall. So fight, and let the control wear off.
  if (hasControlCondition(pl)) return 'fight';

  // 1. Heal when badly hurt, with a found healing consumable (§22.6: there are no potions).
  const heal = healingConsumableIndex(pl.inventory.backpack);
  if (pl.hp <= 0.35 * cap && heal >= 0) return { kind: 'useConsumable', source: { index: heal } };

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
  // A heal skill when at/below half HP (no consumable was used this turn).
  if (bestHeal && pl.hp <= 0.5 * cap) return { kind: 'cast', skillId: bestHeal.id };
  // A damage skill worth a charge over a plain swing.
  if (bestDamage && bestDamage.dmg >= 2 && pl.skillCharges > 0) {
    return { kind: 'cast', skillId: bestDamage.id };
  }

  // 3. Flee a near-certain death when no heal is left and escape is possible.
  if (pl.hp <= 0.2 * cap && heal < 0 && battle.canFlee) return 'run';

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
    case 'main-menu': {
      // PLAN.md #2: there is no "seek a bargain" any more — bargains FIND the run as descent
      // encounters, and the policy answers them at `deal-decision` below. A FULL pack first sheds
      // its worst gear (through `step`), so the next drop is not left on the floor.
      const inventory = res.state.player?.inventory;
      if (inventory && !canCarry(inventory)) {
        const drop = discardChoice(inventory.backpack);
        if (drop >= 0) return { kind: 'discard', index: drop };
      }
      return { kind: 'menu', choice: 'continue' };
    }
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
      // PLAN.md #2 (AC-26): accept any bargain that does not pay with the body (hp / maxHp).
      // Every reward is worth having now that none of them heals (§22.25).
      const { cost } = phase.deal;
      return { kind: 'deal-decision', accept: cost.kind !== 'hp' && cost.kind !== 'maxHp' };
    }
    case 'deal-discard': {
      // Appendix A.3: the bargain needs room. Leave the worst gear; with none, back out (which is
      // exactly refusing the bargain) rather than throw a heal away.
      const drop = res.state.player ? discardChoice(res.state.player.inventory.backpack) : -1;
      return drop >= 0 ? { kind: 'discard', index: drop } : { kind: 'deal-decision', accept: false };
    }
    case 'rest':
      // A found rest was taken the moment it was found (§22.26); only `continue` remains.
      return { kind: 'continue' };
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
  prep: HubPrep = gearUpAtHub,
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
    // The hub-time gear-up (outside `step`, see the header). Only ever at the hub.
    if (res.awaiting === 'main-menu') res = { ...res, state: prep(res.state) };
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
