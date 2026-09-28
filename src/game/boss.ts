// Boss mechanics + the karma verdict gate for The Void — pure, framework-agnostic (M12).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. `generateBoss`,
//    `bossPostRound`, `computeVerdict`, and `pickIndulgedAxis` are pure — they return
//    new plain-data values and print nothing.
//  - Deterministic seeded RNG: only `generateBoss` DRAWS, and it does so solely through
//    the injected `Rng` (via `generateEnemy`). `bossPostRound` and `computeVerdict` are
//    RNG-FREE deterministic counters/arithmetic. No Math.random / Date.now.
//  - Data-driven content: PLAN.md #11 moved the boss CARDS — names, mechanic, strike die, move
//    kinds, concessions, the executioner's kit and the HP scales — and the five Sin identities
//    into `src/data/bosses.json`. DEVIATION kept from the M12 note: `BossId`, `BossMoveKind`,
//    `Concession` and `SinIdentity` stay TypeScript unions so the step inputs are tight; the
//    JSON is read through `BOSSES` / `SIN_IDENTITIES` and checked against the unions in a test
//    (`boss.test.ts`). The balance magnitudes (crew cap, minion damage, adapt threshold, Sin HP
//    per point, the gate) stay the labelled constants below.
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
import { randInt, type Rng } from './rng.ts';
import { SKILLS, resolveSkill, type SkillDef, type SkillId } from './skill.ts';
import { type BattleState, type BattleAction } from './battle.ts';
import { type CombatEvent } from './combatEvent.ts';
import { FINAL_BOSS_XP } from './progression.ts';
import bossData from '../data/bosses.json';

// ------- Ids + data ----------------------------------------------------------

/**
 * The five COMBAT bosses: one per act 1/2/3/5, plus the act-4 EXECUTIONER — the Warden turned,
 * fought only on the cast-down path (PLAN.md #11, GAME-DESIGN.md §22.31). On the grace path the
 * Warden stays a pure verdict (`computeVerdict`) and a conversation, never a fight.
 */
export type BossId = 'kingpin' | 'reflection' | 'sin' | 'hollow' | 'executioner';

/** The unique mechanic kind each boss expresses (for readability + future narration). */
export type BossMechanic =
  | 'summon-adds'
  | 'mirror-adapt'
  | 'karma-scaled'
  | 'mirror-conditions'
  | 'deeds-as-blows';

/**
 * A kind of move a boss may take on its turn (§22.31). `cast` expands to one legal entry per
 * affordable skill (`cast:<SkillId>`); the rest are single moves.
 */
export type BossMoveKind = 'strike' | 'cast' | 'call_crew' | 'hold_back' | 'grieve';

/** What Talk can earn from a boss, once per fight (§20, §22.7). */
export type Concession = 'pause' | 'weakness' | 'drop_mechanic' | 'surrender';

/** Every concession kind, in a fixed order (validation and tests). */
export const CONCESSIONS: readonly Concession[] = ['pause', 'weakness', 'drop_mechanic', 'surrender'];

/** Every move kind, in a fixed order (validation and tests). */
export const BOSS_MOVE_KINDS: readonly BossMoveKind[] = ['strike', 'cast', 'call_crew', 'hold_back', 'grieve'];

/**
 * A boss's plain strike (the author's 2026-09-28 ruling): one die rising with depth, rolled a
 * second time on a critical hit, plus the boss's STR mod ONCE where `addStr` holds — the
 * executioner and the Hollow Self only.
 */
export interface BossStrike {
  die: number;
  addStr: boolean;
}

/** A boss card — the engine half. Persona text is unit B's, never here. */
export interface BossDef {
  name: string;
  mechanic: BossMechanic;
  strike: BossStrike;
  /** The move kinds, in the order the legal list is built. */
  moves: readonly BossMoveKind[];
  /** The concessions Talk may earn (empty ⇒ none — the executioner). */
  concessions: readonly Concession[];
  /** A fixed skill kit replacing the base enemy's pool (the executioner). */
  kit?: readonly string[];
  /** HP scale over the base enemy roll (the executioner, the Hollow Self). */
  hpScale?: number;
}

/**
 * The boss table, read from `bosses.json`. `sin`'s name is a generic base overwritten by its
 * identity at generation (`SIN_IDENTITIES`).
 */
export const BOSSES: Record<BossId, BossDef> = bossData.bosses as Record<BossId, BossDef>;

/** One boss's card — the seam units B and C read. */
export function bossCard(id: BossId): BossDef {
  return BOSSES[id];
}

/** The four karma axes, as the keys of `KarmaState`. */
export type KarmaAxis = keyof KarmaState;

/**
 * The five Sin identities (§22.31): one per indulged axis, plus THE GRIEF for a run that
 * indulged nothing — it mourns what was done TO you, not by you.
 */
export type SinIdentity = 'grief' | 'desecration' | 'cruelty' | 'avarice' | 'delusion';

/** A Sin identity's card: its display name and the axis it embodies (null for The Grief). */
export interface SinIdentityDef {
  name: string;
  axis: KarmaAxis | null;
}

/** The five identities, read from `bosses.json`. */
export const SIN_IDENTITIES: Record<SinIdentity, SinIdentityDef> =
  bossData.sinIdentities as Record<SinIdentity, SinIdentityDef>;

/** Plain-words move descriptions (`{skill}` is replaced by the skill's name). */
export const MOVE_DESCRIPTIONS: Record<BossMoveKind, string> = bossData.moveDescriptions;

// ------- M15 BALANCE PLACEHOLDER constants (single-sourced) -------------------

// M15 BALANCE: the Act-1 Kingpin was the single biggest Act-1 killer (≈31% of Act-1 deaths in
// the sim) — a fresh, un-levelled character with NO attack advantage faces summoned minions
// stacking flat damage every round. Softened across all three levers (slower summons, less
// per-minion damage, a smaller crew) so the first boss is a threat, not a run-ender, and Act-1
// deaths drop into line with the other floors. See docs/BALANCE-REPORT.md.
// PLAN.md #11: the summon CADENCE (`KINGPIN_SUMMON_EVERY_ROUNDS`, every 3 rounds) is retired —
// the Kingpin calls his crew as a chosen move (`call_crew`), so the rhythm is his, not a timer's.
/** Kingpin: extra damage the player takes per active minion, each round. M15: 2 → 1. */
export const KINGPIN_MINION_DAMAGE = 1;
/** Kingpin: the minion crew never grows past this many. M15: 3 → 2. */
export const KINGPIN_MAX_MINIONS = 2;

/** Reflection: repeats of the SAME action before the boss reads + disadvantages it. */
export const REFLECTION_ADAPT_THRESHOLD = 3;

/** Sin: bonus max HP per point of magnitude on the indulged axis. M15: 5 → 3. */
export const SIN_HP_PER_POINT = 3;

/** The identity each karma axis manifests as. */
const IDENTITY_BY_AXIS: Record<KarmaAxis, SinIdentity> = {
  reverenceDesecration: 'desecration',
  mercyCruelty: 'cruelty',
  restraintGreed: 'avarice',
  clarityDelusion: 'delusion',
};

/**
 * Sin identity by the indulged (most-negative) karma axis — the four axis-bound identities,
 * derived from `SIN_IDENTITIES` and kept exported for its existing readers. The Grief has no
 * axis, so it is not in this table; `pickSinIdentity` reaches it.
 */
export const SIN_BY_AXIS: Record<KarmaAxis, { bossId: 'sin'; name: string }> = {
  reverenceDesecration: { bossId: 'sin', name: SIN_IDENTITIES[IDENTITY_BY_AXIS.reverenceDesecration].name },
  mercyCruelty: { bossId: 'sin', name: SIN_IDENTITIES[IDENTITY_BY_AXIS.mercyCruelty].name },
  restraintGreed: { bossId: 'sin', name: SIN_IDENTITIES[IDENTITY_BY_AXIS.restraintGreed].name },
  clarityDelusion: { bossId: 'sin', name: SIN_IDENTITIES[IDENTITY_BY_AXIS.clarityDelusion].name },
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

/**
 * Hollow: scale the mirror boss's HP by this factor over the base enemy roll. M15: 1.5 → 1.2.
 * The Act-5 Hollow is the ONLY win the baseline (kill-everything → cast-down) policy can reach,
 * so it is the win-rate gate. With the gentler enemy HP scaling it sat far too high; 1.2 keeps
 * it a real terminal fight while letting runs that survive the descent actually close it out.
 * PLAN.md #11: the number now lives on the card (`bosses.json` `hollow.hpScale`).
 */
export const HOLLOW_HP_SCALE: number = BOSSES.hollow.hpScale ?? 1;

/** Executioner: HP scale over the base enemy roll (the author's ruling, ×3 — `bosses.json`). */
export const EXECUTIONER_HP_SCALE: number = BOSSES.executioner.hpScale ?? 1;

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
  // ---- PLAN.md #11 — every field optional and written only when set ----
  /** Sin: which of the five identities this is. */
  sinIdentity?: SinIdentity;
  /** Sin: the bonus HP the indulgence bought (0 for The Grief); `drop_mechanic` sheds it. */
  sinBonusHp?: number;
  /** Hollow Self: its copy of your warped kit (`player.corruptedSkills`); its casts resolve through it. */
  warpedSkills?: Record<string, string>;
  /** The one concession Talk earned this fight (§22.7: one per fight). */
  conceded?: Concession;
  /** `pause` granted: the boss's next turn is skipped (its conditions still tick). */
  pausedTurn?: true;
  /** `weakness` granted: the player attacks at advantage for the rest of the fight. */
  weaknessRevealed?: true;
  /** Kingpin `drop_mechanic`: he stops calling the crew (the standing crew stays). */
  crewDisbanded?: true;
  /** Reflection `drop_mechanic`: it stops adapting. */
  adaptDisabled?: true;
  /** Executioner: how many of its blows have been named for a deed so far. */
  deedCursor?: number;
}

// ------- Axis selection ------------------------------------------------------

/**
 * The axis the player most INDULGED — the most-negative axis (deepest shadow). PURE.
 * Ties resolve by `SIN_AXIS_PRIORITY` (strict `<` keeps the earlier/higher-priority axis).
 * When every axis is >= 0 (nothing indulged) returns `null` — PLAN.md #11 retired the old
 * default axis, which sent The Desecration to grieve desecrations that never happened; a run
 * that indulged nothing meets The Grief (`pickSinIdentity`).
 */
export function pickIndulgedAxis(karma: KarmaState): KarmaAxis | null {
  let best: KarmaAxis | null = null;
  let bestVal = 0;
  for (const axis of SIN_AXIS_PRIORITY) {
    const v = karma[axis];
    if (v < bestVal) {
      bestVal = v;
      best = axis;
    }
  }
  return best;
}

/** The Sin identity a run meets: its most-indulged axis's, or The Grief when none. PURE. */
export function pickSinIdentity(karma: KarmaState): SinIdentity {
  const axis = pickIndulgedAxis(karma);
  return axis === null ? 'grief' : IDENTITY_BY_AXIS[axis];
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
 *    bonus = `magnitude × SIN_HP_PER_POINT` added to maxHp AND hp). Nothing indulged ⇒ The
 *    Grief, bonus 0. PLAN.md #11: `sinIdentity` / `sinBonusHp` are recorded on the boss.
 *  - hollow: a COPY of the player's `skillPool` + `stats` (mods recomputed), HP scaled by
 *    `HOLLOW_HP_SCALE`. Scaled off `FINAL_BOSS_XP` as the base-enemy playerXp. PLAN.md #11: a
 *    copy of the player's warped kit (`corruptedSkills`) rides on `boss.warpedSkills`.
 *  - executioner (PLAN.md #11): the Warden turned. Its card's kit replaces the skill pool, HP
 *    ×`EXECUTIONER_HP_SCALE`, named for the card; scaled off the player's xp like a floor boss.
 *    No extra draw: the base enemy roll is the only one.
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
    case 'executioner':
      enemy = {
        ...enemy,
        type: def.name,
        name: def.name,
        fullName: def.name,
        skillPool: [...(def.kit ?? enemy.skillPool)],
        maxHp: Math.floor(enemy.maxHp * EXECUTIONER_HP_SCALE),
        hp: Math.floor(enemy.hp * EXECUTIONER_HP_SCALE),
      };
      boss.deedCursor = 0;
      break;
    case 'reflection':
      enemy = { ...enemy, skillPool: [...player.skillPool] };
      boss.adapted = false;
      boss.actionTally = {};
      break;
    case 'sin': {
      const identity = pickSinIdentity(karma);
      const sinDef = SIN_IDENTITIES[identity];
      const magnitude = sinDef.axis === null ? 0 : Math.max(0, -karma[sinDef.axis]);
      const bonus = magnitude * SIN_HP_PER_POINT;
      boss.sinIdentity = identity;
      boss.sinBonusHp = bonus;
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
      if (player.corruptedSkills) boss.warpedSkills = { ...player.corruptedSkills };
      break;
  }

  return { enemy, boss };
}

// ------- Per-round hook ------------------------------------------------------

/**
 * A stable key for tallying a repeated action (fight / cast:<id> / consumable:<src>). Exported
 * (PLAN.md #11) because a boss round now completes on the boss's step, after the player's action
 * is gone: the key rides on the pause (`bossChoice.playerActionKey`) until then.
 */
export function battleActionKey(action: BattleAction): string {
  if (typeof action === 'string') return action;
  if (action.kind === 'cast') return `cast:${action.skillId}`;
  return `consumable:${JSON.stringify(action.source)}`;
}

/**
 * What `bossPostRound` returns: the patched battle, extra events, and any damage the boss's
 * adds want dealt to the player.
 *
 * G29: this used to carry a `status: 'ongoing' | 'player-died'`, because the Kingpin branch
 * wrote `player.hp` DIRECTLY and decided the death itself — bypassing every guard `battle.ts`
 * owns (shield absorb, the `onTakeDamage` relics, the once-per-battle revive). Since
 * `BALANCE-REPORT.md` names the act-1 Kingpin as the single biggest act-1 killer, that made it
 * THE DEATH THAT HAPPENS MOST, with a 20-point shield absorbing nothing and the Halo Fragment
 * never firing. The damage is now RETURNED AS A NUMBER and applied by `game.ts` through the one
 * guarded path, which also keeps this module RNG-free and free of the equipment/relic imports.
 */
export interface BossRoundResult {
  battle: BattleState;
  events: CombatEvent[];
  /** Extra damage the boss's adds deal to the player this round. 0 for every boss with none. */
  playerDamage: number;
}

/**
 * Apply a boss's per-round mechanic AFTER `resolveRound` — PURE, RNG-FREE. Called by game.ts
 * only when a boss round resolved `ongoing`. Off-equivalent by construction: a battle with no
 * `boss` never reaches here (game.ts guards on `battle.boss`).
 *
 *  - kingpin: `round++`; the whole crew's `minions × KINGPIN_MINION_DAMAGE` is announced
 *    (`boss-minion-damage`) and RETURNED as `playerDamage` for game.ts to apply (G29).
 *    PLAN.md #11: the fixed three-round summon timer is GONE — the crew grows only when the
 *    Kingpin chooses `call_crew` on his turn (§22.31: "the model sets the rhythm").
 *  - reflection: tally the action (its `battleActionKey`); the first time any tally reaches
 *    `REFLECTION_ADAPT_THRESHOLD` (and not yet adapted) the boss adapts — the player rolls at
 *    DISADVANTAGE for the rest of THIS battle (`battle.playerAdvantage = -1`, G12) and a
 *    `boss-adapt` fires. A granted `drop_mechanic` (`adaptDisabled`) stops it adapting.
 *  - sin / hollow / executioner: no per-round mechanic; only `round++` for save-visibility.
 */
export function bossPostRound(battle: BattleState, actionKey: string): BossRoundResult {
  const boss = battle.boss;
  if (!boss) return { battle, events: [], playerDamage: 0 };

  const events: CombatEvent[] = [];
  const nextBoss: BossState = { ...boss, round: boss.round + 1 };

  switch (boss.bossId) {
    case 'kingpin': {
      const minions = nextBoss.minions ?? 0;
      // G29: announce the damage and hand it back as a NUMBER. `game.ts` puts it through
      // `applyDamageToBattlePlayer`, which owns shield, relics and the revive gate — and owns
      // the one death decision. This module never writes `player.hp` again.
      let playerDamage = 0;
      if (minions > 0) {
        playerDamage = minions * KINGPIN_MINION_DAMAGE;
        events.push({ kind: 'boss-minion-damage', amount: playerDamage });
      }
      return { battle: { ...battle, boss: nextBoss }, events, playerDamage };
    }
    case 'reflection': {
      const tally = { ...(nextBoss.actionTally ?? {}) };
      const key = actionKey;
      tally[key] = (tally[key] ?? 0) + 1;
      nextBoss.actionTally = tally;
      const next: BattleState = { ...battle, boss: nextBoss };
      if (!nextBoss.adapted && !nextBoss.adaptDisabled && tally[key]! >= REFLECTION_ADAPT_THRESHOLD) {
        nextBoss.adapted = true;
        // G12: the adaptation is a STANDING, BATTLE-SCOPED penalty, so it is written to
        // `battle.playerAdvantage` instead of onto the player. Written onto the player it
        // survived the fight — `game.ts` persists `battle.player` to the hub — so a single
        // Reflection adapt disadvantaged the player for the REST OF THE RUN. Same meaning,
        // now cleared by the next `createBattle`.
        next.playerAdvantage = -1;
        events.push({ kind: 'boss-adapt' });
      }
      return { battle: next, events, playerDamage: 0 };
    }
    case 'sin':
    case 'hollow':
    case 'executioner':
      // Mechanic is entirely at generation; only advance the save-visible round counter.
      return { battle: { ...battle, boss: nextBoss }, events, playerDamage: 0 };
  }
}

// ------- PLAN.md #11: the boss's turn as a CHOICE ------------------------------

/**
 * A boss move id — what the `boss-choice` input names and the model's grammar is built from
 * (§5.2). One per kind, except `cast`, which names its skill: `cast:<SkillId>`.
 */
export type BossMoveId = 'strike' | 'call_crew' | 'hold_back' | 'grieve' | `cast:${string}`;

/** One legal move, with the plain-words line the prompt lists (unit B) and the button reads (unit C). */
export interface BossMoveOption {
  id: BossMoveId;
  kind: BossMoveKind;
  /** The skill a `cast` move casts. */
  skillId?: SkillId;
  description: string;
}

/**
 * The skill a boss actually casts for `skillId` — its WARPED form when the boss carries a copy
 * of the player's warped kit (the Hollow Self, floor 5), else the plain def. `undefined` for an
 * id the skill table does not know. PURE.
 */
export function bossCastDef(boss: BossState, skillId: string): SkillDef | undefined {
  const base = SKILLS[skillId as SkillId];
  if (!base) return undefined;
  return boss.warpedSkills ? resolveSkill({ corruptedSkills: boss.warpedSkills }, skillId as SkillId) : base;
}

/** The fields of a battle the legal set reads (a `BattleState` satisfies it). */
export type BossMoveContext = Pick<BattleState, 'boss' | 'enemy' | 'player'>;

/**
 * The legal moves for the boss riding on `battle`, in the card's order — PURE, RNG-free. `[]`
 * for a battle with no boss. The rules (§5.2):
 *  - `strike` — always.
 *  - `cast:<id>` — one per skill in the enemy's pool whose cost (of the def it would really
 *    cast — the Hollow Self's warped one) its charges cover.
 *  - `call_crew` — only under the crew cap, and not once `drop_mechanic` disbanded the calling.
 *  - `hold_back` — only with a crew to do the work (a crewless "let them work" is a null move).
 *  - `grieve` — only while the player holds a charge to lose.
 * The ENGINE computes this list; a model choice outside it falls back (§17.3.3).
 */
export function legalBossMoves(battle: BossMoveContext): BossMoveOption[] {
  const boss = battle.boss;
  if (!boss) return [];
  const out: BossMoveOption[] = [];
  const add = (id: BossMoveId, kind: BossMoveKind, skillId?: SkillId): void => {
    const option: BossMoveOption = { id, kind, description: '' };
    if (skillId !== undefined) option.skillId = skillId;
    option.description = describeBossMove(option, boss);
    out.push(option);
  };
  const minions = boss.minions ?? 0;
  for (const kind of BOSSES[boss.bossId].moves) {
    switch (kind) {
      case 'strike':
        add('strike', 'strike');
        break;
      case 'cast':
        for (const id of battle.enemy.skillPool) {
          const def = bossCastDef(boss, id);
          if (def && def.chargeCost <= battle.enemy.skillCharges) add(`cast:${id}`, 'cast', id as SkillId);
        }
        break;
      case 'call_crew':
        if (minions < KINGPIN_MAX_MINIONS && !boss.crewDisbanded) add('call_crew', 'call_crew');
        break;
      case 'hold_back':
        if (minions >= 1) add('hold_back', 'hold_back');
        break;
      case 'grieve':
        if (battle.player.skillCharges >= 1) add('grieve', 'grieve');
        break;
    }
  }
  return out;
}

/**
 * The plain-words line for a move (`bosses.json` `moveDescriptions`, `{skill}` filled with the
 * skill's name as the boss would cast it). PURE.
 */
export function describeBossMove(option: Pick<BossMoveOption, 'kind' | 'skillId'>, boss?: BossState): string {
  const template = MOVE_DESCRIPTIONS[option.kind];
  if (option.kind !== 'cast' || option.skillId === undefined) return template;
  const def = boss ? bossCastDef(boss, option.skillId) : SKILLS[option.skillId];
  return template.split('{skill}').join(def?.name ?? option.skillId);
}

/**
 * THE FALLBACK (the author's ruling, Q1a): a seeded UNIFORM pick over the legal ids — ONE
 * `randInt` draw. Used when the model is off, times out, answers nothing, or answers something
 * the engine did not list (§17.3.3), and as the simulator's baseline. PURE given `rng`.
 */
export function pickFallbackMove(legal: readonly BossMoveId[], rng: Rng): BossMoveId {
  return legal[randInt(rng, legal.length)] ?? 'strike';
}

// ------- PLAN.md #11: concessions — what Talk can earn, once per fight --------------

/**
 * The concessions Talk may still earn against the boss on `battle` — its card's list, or `[]` once
 * one was granted (§22.7: one concession per fight), or for a battle with no boss. The Talk
 * grammar (unit B) is built from this. PURE.
 */
export function availableConcessions(battle: Pick<BattleState, 'boss'>): Concession[] {
  const boss = battle.boss;
  if (!boss || boss.conceded !== undefined) return [];
  return [...BOSSES[boss.bossId].concessions];
}

/** What `grantConcession` returns. */
export interface ConcessionResult {
  battle: BattleState;
  events: CombatEvent[];
  /**
   * True when the grant COMPLETED a round: a `pause` granted while the boss's turn was waiting
   * for its move lets that turn pass instead of being played, so the round is over now.
   */
  roundComplete: boolean;
}

/**
 * Grant a PAUSE, WEAKNESS or DROP_MECHANIC concession — PURE, RNG-free (a `surrender` ends the
 * fight or the run, so `game.ts` routes it). The caller has checked `availableConcessions`. Every
 * grant records `boss.conceded` (one per fight). The mechanics (the author's Q3, accepted):
 *  - pause: the boss's next turn passes — no gauge, no action (its conditions still tick). If its
 *    turn is already waiting for its move, THAT turn passes now: the pause clears, a
 *    `boss-move { move: 'pause' }` says so, and the round completes.
 *  - weakness: the player attacks at advantage for the rest of the fight.
 *  - drop_mechanic: Kingpin — he stops CALLING the crew (the standing crew stays); Reflection — it
 *    stops adapting, and an adaptation already made lifts; Sin — it sheds the bonus HP the
 *    indulgence bought (`hp` never below 1). An open pause has its legal list recomputed.
 */
export function grantConcession(battle: BattleState, c: Exclude<Concession, 'surrender'>): ConcessionResult {
  const boss: BossState = { ...battle.boss!, conceded: c };
  let next: BattleState = { ...battle, boss };
  const events: CombatEvent[] = [];
  let roundComplete = false;
  switch (c) {
    case 'pause':
      if (next.bossChoice) {
        const { bossChoice: _open, ...rest } = next;
        next = rest;
        events.push({ kind: 'boss-move', bossId: boss.bossId, move: 'pause' });
        roundComplete = true;
      } else {
        boss.pausedTurn = true;
      }
      break;
    case 'weakness':
      boss.weaknessRevealed = true;
      break;
    case 'drop_mechanic':
      if (boss.bossId === 'kingpin') boss.crewDisbanded = true;
      if (boss.bossId === 'reflection') {
        boss.adaptDisabled = true;
        if (boss.adapted && next.playerAdvantage === -1) {
          const { playerAdvantage: _lifted, ...rest } = next;
          next = rest;
        }
      }
      if (boss.bossId === 'sin') {
        const maxHp = Math.max(1, next.enemy.maxHp - (boss.sinBonusHp ?? 0));
        next = { ...next, enemy: { ...next.enemy, maxHp, hp: Math.max(1, Math.min(next.enemy.hp, maxHp)) } };
        boss.sinBonusHp = 0;
      }
      if (next.bossChoice) {
        next = { ...next, bossChoice: { ...next.bossChoice, legal: legalBossMoves(next).map((o) => o.id) } };
      }
      break;
  }
  return { battle: next, events, roundComplete };
}
