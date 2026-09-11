// The pure game controller for The Void — framework-agnostic game logic (capstone).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: `step` is a PURE reducer — it never mutates its
//    input, prints nothing, and imports no Kaplay/DOM/canvas. It returns a NEW state,
//    an ordered GameEvent[], and the next `Awaiting`. The M10 UI renders the events
//    and sends GameInputs.
//  - Deterministic seeded RNG: all randomness threads a single `Rng` derived from
//    `state.rngState` via `createRng`; the updated accumulator is written back to the
//    new state. No Math.random / Date.now.
//  - Serializable plain-data state: `GameState` (and every `Phase`) is flat plain
//    data — the RNG is a `number`, the player/enemy are plain records — so the whole
//    state round-trips through JSON and a save is just `JSON.stringify(state)`.
//
// Ported from `GameLogic` (startGame -> checkAct -> gameLoop -> encounters -> battle
// -> progression -> finalBattle -> ending). Confirmed faithful/cleaned choices:
//  - The sacrifice-deal encounter replaces the gold shop. PLAN.md #2: it is no longer a menu
//    option — bargains FIND the player as a descent encounter (§22.23), like a found rest.
//  - Level-up raises maxHp but does not heal; the final boss gets no auto-advantage.
//  - The ending shows only on a win; death goes to game-over.
//  - Name/class confirm loops and per-round continue gates are dropped (events carry
//    the narration; confirmation UX belongs to the render layer).

import { createRng, type Rng } from './rng.ts';
import { type Stats } from './character.ts';
import { createKarma, recordKarmaWeighted, type KarmaAction, type KarmaState } from './karma.ts';
import { getFamily } from './enemyFamily.ts';
import { createPlayer, rollStartStats, type Player, type PlayerClass } from './player.ts';
import {
  applyDamageToBattlePlayer,
  resolveRound,
  openBattle,
  type BattleState,
  type BattleAction,
  type RoundRules,
} from './battle.ts';
import { dampenHeal, floorModifiers, floorOf, ILLUSION_DC } from './floors.ts';
import { rollCorruptions } from './corruption.ts';
import { createBattle } from './battle.ts';
import { generateBoss, bossPostRound, computeVerdict, type BossId } from './boss.ts';
import {
  buildRandomBattle,
  buildChestLoot,
  computeRestHeal,
  selectEncounter,
} from './encounter.ts';
import { restBrief } from './restBrief.ts';
import {
  buildDeal,
  applyDeal,
  canAfford,
  describeCost,
  describeReward,
  needsRoom,
  type SacrificeDeal,
} from './deal.ts';
import { canCarry } from './inventory.ts';
import { summarizeLoot } from './loot.ts';
import {
  applyLevelUpHp,
  hasPendingLevelUp,
  hollowGateOpen,
  shouldAdvance,
} from './progression.ts';
import { generateDraft, applyDraftOption, describeDraftOption, type DraftOption } from './draft.ts';
import {
  getActIntro,
  getActOutro,
  getGraceEnding,
  getDamnationEnding,
  getIntro,
} from './story.ts';
import { playerArmorClass } from './defense.ts';
import { pickUp } from './equipment.ts';
import { type ItemInstance } from './item.ts';
import { type CombatEvent } from './combatEvent.ts';
import { type GameEvent } from './gameEvent.ts';
import { type RunUnlocks } from './unlockStore.ts';

// ------- State ---------------------------------------------------------------

/** Every phase of the game as a plain-data discriminated union. */
export type Phase =
  | { kind: 'title' }
  | { kind: 'name-entry' }
  | { kind: 'class-select'; name: string }
  | { kind: 'stats-roll'; name: string; classId: PlayerClass; stats: Stats }
  | { kind: 'main-menu' }
  | { kind: 'battle'; battle: BattleState; started: boolean; final: boolean }
  | { kind: 'battle-victory'; final: boolean }
  // PLAN.md #2 (§22.26): a FOUND rest spot, already taken — there is no decision to make.
  | { kind: 'rest' }
  | { kind: 'deal'; deal: SacrificeDeal }
  // PLAN.md #2, Appendix A.3: the deal was ACCEPTED with a full backpack and an item reward, so
  // the pack is open for a discard. Nothing has been paid. Discarding completes the deal in ONE
  // step; backing out (`deal-decision`, accept false) is exactly refusing it.
  | { kind: 'deal-discard'; deal: SacrificeDeal }
  | { kind: 'chest'; loot: ItemInstance[] }
  | { kind: 'act-outro'; newAct: number }
  // M9: a level-up presents a seeded draft of 3; the picked option is applied on draft-pick.
  | { kind: 'level-up-draft'; offers: DraftOption[] }
  | { kind: 'level-up-result' }
  | { kind: 'act-intro'; newAct: number }
  // M12: the act-4 verdict reckoning (no combat) — grace ends the run, cast-down falls to act 5.
  | { kind: 'verdict'; outcome: 'grace' | 'cast-down' }
  | { kind: 'ending'; endingType: 'grace' | 'damnation' }
  | { kind: 'game-over' };

/** The full, serializable game state. */
export interface GameState {
  /** The save format — `SAVE_VERSION` (PLAN.md #2 bumped 8 -> 9: potions and the banked rest
   *  counter left the player, and the rest phase lost its decision; see `save.ts` `upgrade8to9`). */
  version: 9;
  /** mulberry32 accumulator — the serializable RNG state; JSON round-trips it. */
  rngState: number;
  player: Player | null;
  /** Current Act, 1..5. */
  act: number;
  /** Current floor index, 0..4 (place = act - 1). */
  place: number;
  /**
   * M12, OPTIONAL routing flag: `'advance-act'` is set on a floor-boss victory (acts 1–3) so
   * that once any earned level-ups drain, the run advances an act (`resolvePostVictory`).
   * ABSENT for all normal play ⇒ a normal victory routes to the main menu (unchanged). Plain
   * data; JSON drops it when absent, so off-equivalence + save round-trip hold.
   */
  pending?: 'advance-act';
  /**
   * Four-axis Karma / Nature vector for this run. Recorded only in M1 (see
   * `karma.ts`); no engine outcome depends on it yet. Spread through every `step`
   * transition, so it persists unchanged until a later milestone writes to it.
   */
  karma: KarmaState;
  /**
   * M13, OPTIONAL run-start SNAPSHOT of the meta-progression unlock sets (frozen for the
   * whole run so a fixed unlock-set is fully reproducible from the seed). Only the two sets
   * the encounter generator needs (families/affixes) are carried. ABSENT for a full/default
   * run (`createGame(seed)` with no snapshot) — and when absent, `continueJourney` passes
   * `undefined` down, so the encounter/affix draws are byte-identical to a pre-M13 run
   * (off-equivalence). Plain data; JSON drops it when absent, so the save shape is unchanged
   * and `version` legitimately stays 8 (an old save without it resumes as all-unlocked).
   */
  unlocks?: RunUnlocks;
  phase: Phase;
}

/** What input `step` expects next, given the current phase. */
export type Awaiting =
  | 'title'
  | 'enter-name'
  | 'choose-class'
  | 'accept-or-reroll-stats'
  | 'main-menu'
  | 'continue'
  | 'battle-action'
  | 'draft-pick'
  | 'deal-decision'
  // PLAN.md #2, A.3: choose what to leave behind for a bargain's reward (or back out = refuse).
  | 'deal-discard'
  // PLAN.md #2: the found rest spot — the rest has already happened; only `continue` remains.
  // Its own value (not `continue`) so the renderer can give the one calm screen its scenery.
  | 'rest'
  | 'game-over';

/** The input the player (via the UI) supplies to `step`. */
export type GameInput =
  | { kind: 'continue' }
  | { kind: 'name'; name: string }
  | { kind: 'class'; classId: PlayerClass }
  | { kind: 'stats-decision'; accept: boolean }
  // PLAN.md #2 / G52: the hub cannot summon a bargain any more; bargains find you (§22.23).
  | { kind: 'menu'; choice: 'continue' | 'quit' }
  | { kind: 'battle-action'; action: BattleAction }
  | { kind: 'draft-pick'; index: number }
  | { kind: 'deal-decision'; accept: boolean }
  // PLAN.md #2: leave backpack item `index` behind. At the hub it is a plain discard; in the
  // `deal-discard` phase it is the room a bargain's reward needs (A.3). Either way it is an
  // ENGINE input, so a run still replays from `seed + inputs` (CLAUDE.md principle 1).
  | { kind: 'discard'; index: number };

/**
 * Rule overrides for a `step` — a MEASUREMENT seam, never set by the game (PLAN.md #2).
 *
 * The balance report measures how sensitive the win rate is to floor 2's `ILLUSION_DC`
 * (§22.27: the author chooses the Wisdom-gap remedy from evidence). Editing the frozen constant
 * to take that measurement would be exactly the move the ruling forbids, and a module-level
 * setter would be global mutable state in a pure core. So the DC can be INJECTED per call, as
 * plain data: the sim threads it through every `step` of a run, and the shipped renderer never
 * passes anything. Absent ⇒ the shipped constant. Pure and deterministic either way.
 */
export interface StepOptions {
  illusionDc?: number;
}

/** What `step` returns: the next state, the ordered events, and the next Awaiting. */
export interface StepResult {
  state: GameState;
  events: GameEvent[];
  awaiting: Awaiting;
}

/**
 * Build a fresh game at the title screen, seeded by `seed`. The optional `unlocks` snapshot
 * (M13) freezes the meta-progression family/affix sets into the state for the whole run; when
 * omitted the `unlocks` key is left OFF (exactOptionalPropertyTypes) so the state — and every
 * downstream draw — is byte-identical to a pre-M13 run.
 */
export function createGame(seed: number, unlocks?: RunUnlocks): GameState {
  const state: GameState = {
    version: 9,
    rngState: seed >>> 0,
    player: null,
    act: 1,
    place: 0,
    karma: createKarma(),
    phase: { kind: 'title' },
  };
  if (unlocks) state.unlocks = unlocks;
  return state;
}

/** Map a phase to the input it awaits. Total over the Phase union. */
export function awaitingFor(phase: Phase): Awaiting {
  switch (phase.kind) {
    case 'title':
      return 'title';
    case 'name-entry':
      return 'enter-name';
    case 'class-select':
      return 'choose-class';
    case 'stats-roll':
      return 'accept-or-reroll-stats';
    case 'main-menu':
      return 'main-menu';
    case 'battle':
      return phase.started ? 'battle-action' : 'continue';
    case 'battle-victory':
      return 'continue';
    case 'rest':
      return 'rest';
    case 'deal':
      return 'deal-decision';
    case 'deal-discard':
      return 'deal-discard';
    case 'chest':
      return 'continue';
    case 'act-outro':
      return 'continue';
    case 'level-up-draft':
      return 'draft-pick';
    case 'level-up-result':
      return 'continue';
    case 'act-intro':
      return 'continue';
    case 'verdict':
      return 'continue';
    case 'ending':
      return 'continue';
    case 'game-over':
      return 'game-over';
  }
}

// ------- Helpers -------------------------------------------------------------

/** Replace every `{playerName}` token with the given name. */
function substituteName(text: string, name: string): string {
  return text.split('{playerName}').join(name);
}

// ------- The reducer ---------------------------------------------------------

/**
 * Advance the game one step — PURE. Threads a single seeded `Rng` through every
 * random decision this step and writes the resulting RNG accumulator into the new
 * state. If `input` does not match what the current phase awaits, the state is
 * returned unchanged with no events (the reducer is total). Never mutates `state`.
 */
export function step(state: GameState, input: GameInput, options: StepOptions = {}): StepResult {
  const { rng, getState } = createRng(state.rngState);
  const noop: StepResult = { state, events: [], awaiting: awaitingFor(state.phase) };

  // Build a StepResult from a new phase and optional state patch, sealing in the
  // advanced RNG accumulator.
  const finish = (
    phase: Phase,
    events: GameEvent[],
    patch: Partial<Pick<GameState, 'player' | 'act' | 'place' | 'karma' | 'pending'>> = {},
  ): StepResult => {
    const next: GameState = {
      ...state,
      ...patch,
      rngState: getState(),
      phase,
    };
    return { state: next, events, awaiting: awaitingFor(phase) };
  };

  const phase = state.phase;

  switch (phase.kind) {
    case 'title':
      if (input.kind !== 'continue') return noop;
      return finish({ kind: 'name-entry' }, []);

    case 'name-entry':
      if (input.kind !== 'name') return noop;
      return finish({ kind: 'class-select', name: input.name }, []);

    case 'class-select': {
      if (input.kind !== 'class') return noop;
      const stats = rollStartStats(rng);
      return finish(
        { kind: 'stats-roll', name: phase.name, classId: input.classId, stats },
        [{ kind: 'stats-rolled', stats }],
      );
    }

    case 'stats-roll': {
      if (input.kind !== 'stats-decision') return noop;
      if (!input.accept) {
        const stats = rollStartStats(rng);
        return finish({ ...phase, stats }, [{ kind: 'stats-rolled', stats }]);
      }
      const player = createPlayer({
        name: phase.name,
        classId: phase.classId,
        stats: phase.stats,
      });
      const intro = getIntro();
      const events: GameEvent[] = [
        {
          // M4: report the player's REAL armored AC (from gear/dexCap/strReq/shield) so
          // the HUD shows that defense matters, not the stored unarmored 10 + CONmod base.
          kind: 'player-created',
          name: player.name,
          classId: player.classId,
          maxHp: player.maxHp,
          armorClass: playerArmorClass(player),
        },
        {
          kind: 'intro',
          header: intro.header,
          lines: intro.lines.map((l) => substituteName(l, player.name)),
        },
      ];
      return finish({ kind: 'main-menu' }, events, { player });
    }

    case 'main-menu': {
      // PLAN.md #2: leaving an item behind is a hub action, and an engine one.
      if (input.kind === 'discard') return discardAtHub(state, input.index, finish, noop);
      if (input.kind !== 'menu') return noop;
      const player = requirePlayer(state);
      if (input.choice === 'quit') {
        return finish({ kind: 'game-over' }, [{ kind: 'game-over', xp: player.xp }]);
      }
      // PLAN.md #2: the menu has exactly two choices now. Anything else — the removed bargain
      // choice from a stale renderer, a typo through the engine API — is REFUSED rather than read
      // as `continue`
      // (the reducer is total: an input it does not expect returns the state unchanged). It used
      // to fall through to the encounter draw, which would have let a removed action still move
      // the run.
      if (input.choice !== 'continue') return noop;
      // 'continue' — Java continueJourney: checkAct first, else an encounter.
      return continueJourney(state, player, rng, finish);
    }

    case 'battle': {
      if (!phase.started) {
        if (input.kind !== 'continue') return noop;
        // M6: fire startOfBattle relic triggers as the battle becomes active. Off-equivalent
        // (same battle, no events) for a player with no startOfBattle relics equipped.
        // PLAN.md #2: and the FLOOR's startOfBattle triggers (floor 3's charge bleed) — keyed on
        // `state.place`, never the act counter.
        const opened = openBattle(phase.battle, floorOf(state));
        return finish({ ...phase, battle: opened.battle, started: true }, opened.events);
      }
      if (input.kind !== 'battle-action') return noop;
      return resolveBattleRound(state, phase, input.action, rng, finish, roundRules(state, options));
    }

    case 'battle-victory': {
      if (input.kind !== 'continue') return noop;
      const player = requirePlayer(state);
      if (phase.final) {
        // M12: the Hollow Self fell — the run reaches the DAMNATION ending (act 5).
        const ending = getDamnationEnding();
        return finish({ kind: 'ending', endingType: 'damnation' }, [
          {
            kind: 'ending',
            endingType: 'damnation',
            header: ending.header,
            body: substituteName(ending.body, player.name),
          },
        ]);
      }
      // M9: battle victory is the sole XP source, so the sole level-up hook. If the new XP
      // crossed one or more level thresholds, route into the draft (drains one at a time);
      // otherwise resolve the post-victory route (M12: a boss win advances the act; a normal
      // win returns to the hub).
      if (hasPendingLevelUp(player)) {
        return enterLevelUp(player, rng, finish);
      }
      return resolvePostVictory(state, finish);
    }

    case 'rest': {
      // The rest was taken when the spot was found (`takeRest`); continuing returns to the hub.
      if (input.kind !== 'continue') return noop;
      return finish({ kind: 'main-menu' }, []);
    }

    case 'deal': {
      if (input.kind !== 'deal-decision') return noop;
      return resolveDealDecision(state, phase.deal, input.accept, finish);
    }

    case 'deal-discard': {
      // A.3.2: backing out DECLINES the bargain through the very function refusing uses, so the
      // two cannot drift apart — no cheaper path, and no dearer one.
      if (input.kind === 'deal-decision' && !input.accept) return declineDeal(finish);
      if (input.kind !== 'discard') return noop;
      return discardForDeal(state, phase.deal, input.index, finish, noop);
    }

    case 'chest': {
      if (input.kind !== 'continue') return noop;
      // The loot was already picked up when the chest was found; continue to the hub.
      return finish({ kind: 'main-menu' }, []);
    }

    case 'act-outro': {
      // M9: act flow is decoupled from level-up. The outro event was already emitted when
      // this phase was entered (continueJourney); continuing goes straight to the act intro.
      if (input.kind !== 'continue') return noop;
      const intro = getActIntro(phase.newAct) ?? { header: '', body: '' };
      const events: GameEvent[] = [
        { kind: 'act-intro', act: phase.newAct, header: intro.header, body: intro.body },
      ];
      // PLAN.md #2, floor 5 (§22.24): ARRIVING on a floor that warps the kit — keyed on the
      // floor being entered (`place` is already the new floor here), never the act counter —
      // rolls one corrupted form per owned skill, in pool order (N `pick` draws, and nothing
      // else), and says so. Once per run: a map that already exists is never re-rolled.
      const player = state.player;
      if (player && floorModifiers(floorOf(state)).corruptsSkills && !player.corruptedSkills) {
        const corruptedSkills = rollCorruptions(player.skillPool, rng);
        events.push({ kind: 'skills-warped', count: Object.keys(corruptedSkills).length });
        return finish({ kind: 'act-intro', newAct: phase.newAct }, events, {
          player: { ...player, corruptedSkills },
        });
      }
      return finish({ kind: 'act-intro', newAct: phase.newAct }, events);
    }

    case 'level-up-draft': {
      if (input.kind !== 'draft-pick') return noop;
      const index = input.index;
      // G45: `step` documents itself as TOTAL ("the reducer is total", above), and this guard
      // checked only the two bounds. A type-legal non-integer slipped through — `offers[1.5]`
      // is `undefined`, the `!` assertion hid it, and `applyDraftOption` then dereferenced
      // `option.kind`. Reproduced: 0 / -1 / 3 / Infinity / 1e21 were all clean, while 1.5,
      // 0.5, 2.5 and NaN threw a TypeError. (NaN also defeats the bounds test on its own,
      // since every comparison with NaN is false.) The sibling consumable path was already
      // safe against the identical inputs. No shipped caller produces this — the renderer
      // builds indices from a loop — so it is a contract violation through the engine API.
      if (!Number.isInteger(index) || index < 0 || index >= phase.offers.length) return noop;
      const player = requirePlayer(state);
      const picked = applyDraftOption(player, phase.offers[index]!);
      return finish(
        { kind: 'level-up-result' },
        [{ kind: 'draft-picked', option: picked.describe }],
        { player: picked.player },
      );
    }

    case 'level-up-result': {
      // Drain the next queued level-up if XP still owes one; else return to the hub. Act
      // advancement is handled independently at the menu, never through this chain.
      if (input.kind !== 'continue') return noop;
      const player = requirePlayer(state);
      if (hasPendingLevelUp(player)) {
        return enterLevelUp(player, rng, finish);
      }
      return resolvePostVictory(state, finish);
    }

    case 'act-intro': {
      // G43: EVERY act intro now returns to the hub, act 5 included. Act 5 used to hard-wire
      // the Hollow to floor ENTRY here — and `main-menu` is the only phase that calls
      // `continueJourney`, which is the only caller of `buildRandomBattle`, `buildChestLoot`
      // and (then) the lore pick. So the True Void had no random battles, no chests, no rests, no
      // sacrifice-deals and no lore at all: an exhaustive walk of ~17.7 M probed transitions
      // from 418 act-5 entries produced ZERO act-5 hub states. Five of 24 families, five of
      // the 13 bespoke name tables and the `reach-act-5` feat were dead as a result. The
      // Hollow now waits behind a floor gate in `continueJourney`, exactly as the acts 1–3
      // bosses wait behind `shouldAdvance`.
      if (input.kind !== 'continue') return noop;
      return finish({ kind: 'main-menu' }, []);
    }

    case 'verdict': {
      // M12: the act-4 reckoning is resolved (no combat). GRACE ends the run as a terminal
      // ascension (act stays 4; act 5 is never constructed). CAST-DOWN advances to act 5 → the
      // Hollow → the damnation ending.
      if (input.kind !== 'continue') return noop;
      const player = requirePlayer(state);
      if (phase.outcome === 'grace') {
        const ending = getGraceEnding();
        return finish({ kind: 'ending', endingType: 'grace' }, [
          {
            kind: 'ending',
            endingType: 'grace',
            header: ending.header,
            body: substituteName(ending.body, player.name),
          },
        ]);
      }
      return advanceAct(state, finish);
    }

    case 'ending': {
      if (input.kind !== 'continue') return noop;
      // Terminal: emit nothing so the run's final event stays the `ending` event.
      return finish({ kind: 'game-over' }, []);
    }

    case 'game-over':
      return noop; // terminal — every further step is a no-op
  }
}

// ------- Transition helpers (each returns a StepResult) ----------------------

type Finish = (
  phase: Phase,
  events: GameEvent[],
  patch?: Partial<Pick<GameState, 'player' | 'act' | 'place' | 'karma' | 'pending'>>,
) => StepResult;

/**
 * The rules a battle round on the current floor is resolved under — the floor's heal percentage
 * and the illusion DC (injected by the balance sim, else the shipped constant). PURE.
 */
function roundRules(state: GameState, options: StepOptions): RoundRules {
  return {
    healPct: floorModifiers(floorOf(state)).healPct,
    illusionDc: options.illusionDc ?? ILLUSION_DC,
  };
}

/**
 * Record a karma action AS EARNED ON THE CURRENT FLOOR — the ONE funnel every engine karma write
 * goes through (PLAN.md #2). Floor 4 counts double (GAME-DESIGN.md §8, §22.24): the floor's
 * `karmaMultiplier` weights the deltas. No new state — the verdict (`computeVerdict`) reads the
 * same four numbers it always did; only what floor 4 adds to them is heavier.
 */
function recordOnFloor(state: GameState, karma: KarmaState, action: KarmaAction): KarmaState {
  return recordKarmaWeighted(karma, action, floorModifiers(floorOf(state)).karmaMultiplier);
}

function requirePlayer(state: GameState): Player {
  if (!state.player) throw new Error('step: player is required in this phase but is null');
  return state.player;
}

/**
 * Advance one act — the existing outro/intro machinery (M9), now driven by the boss gate
 * (M12) rather than the raw XP threshold. Increments `act`/`place`, emits the CONCLUDED act's
 * outro on entry to `act-outro`, and clears the `pending` advance flag. Reached from a
 * floor-boss victory (via `resolvePostVictory`) and from a cast-down verdict.
 */
function advanceAct(state: GameState, finish: Finish): StepResult {
  const newAct = state.act + 1;
  const concluded = state.act;
  const outro = getActOutro(concluded) ?? { header: '', body: '' };
  const result = finish(
    { kind: 'act-outro', newAct },
    [{ kind: 'act-outro', act: concluded, header: outro.header, body: outro.body }],
    { act: newAct, place: newAct - 1 },
  );
  // Clear the consumed routing flag so a LATER normal victory never re-advances the act.
  // (Removed as a key, not set to undefined — honors exactOptionalPropertyTypes + save shape.)
  const next: GameState = { ...result.state };
  delete next.pending;
  return { ...result, state: next };
}

/**
 * Route after a victory's level-ups drain (M12). A floor-boss win set `pending = 'advance-act'`,
 * so the run advances an act; otherwise a normal victory returns to the hub (unchanged).
 */
function resolvePostVictory(state: GameState, finish: Finish): StepResult {
  if (state.pending === 'advance-act') {
    return advanceAct(state, finish);
  }
  return finish({ kind: 'main-menu' }, []);
}

/**
 * What a spare records when the ⚖ family declares no `onSpare` list of its own — the uniform
 * mercy action, exactly as before §22.22 made the seam plural.
 */
const DEFAULT_SPARE_ACTIONS: readonly KarmaAction[] = ['spareWeighted'];

/** What a kill records when the ⚖ family declares no `onKill` list — the uniform cruelty. */
const DEFAULT_KILL_ACTIONS: readonly KarmaAction[] = ['killWeighted'];

/** The floor boss id for acts 1–3 (act 4 is the verdict gate; act 5 is the Hollow). */
const BOSS_BY_ACT: Record<number, BossId> = { 1: 'kingpin', 2: 'reflection', 3: 'sin' };

/**
 * `continueJourney` (M12): when the XP gate opens (`shouldAdvance`), the FLOOR BOSS — not an
 * auto-advance — ends the floor. Acts 1–3 enter the boss battle for the CURRENT act (the act is
 * not incremented until the boss falls, via `resolvePostVictory`). Act 4 enters the VERDICT
 * gate (no combat). Act 5 never satisfies `shouldAdvance` (there is no act 6), so G43 gives it
 * its OWN gate, `hollowGateOpen`, checked here — the Hollow is now the end of floor 5 rather
 * than its entrance. When no gate is open, run a normal encounter.
 */
function continueJourney(
  state: GameState,
  player: Player,
  rng: Rng,
  finish: Finish,
): StepResult {
  if (shouldAdvance(state.act, player.xp)) {
    if (state.act === 4) {
      // The act-4 reckoning: a pure verdict, no brawl. Emits only the outcome (no karma).
      const outcome = computeVerdict(state.karma);
      return finish({ kind: 'verdict', outcome }, [{ kind: 'verdict', outcome }]);
    }
    // Acts 1–3: the floor boss for the CURRENT act. The act stays put until the boss falls.
    const bossId = BOSS_BY_ACT[state.act]!;
    const { enemy, boss } = generateBoss({
      bossId,
      act: state.act,
      player,
      karma: state.karma,
      rng,
    });
    // G4: `createBattle` derives `canFlee: false` from the boss (see the act-5 site above).
    const battle: BattleState = createBattle(player, enemy, state.act, { boss });
    return finish({ kind: 'battle', battle, started: false, final: false }, [
      { kind: 'boss-encounter', bossId, enemyName: enemy.fullName },
    ]);
  }
  // G43: floor 5's own gate. `shouldAdvance` is unconditionally false at act 5 (there is no
  // act 6 to advance to), so the True Void gets its boss the same way every other floor does —
  // from the HUB, once the floor has been played — rather than at floor entry. Below the gate
  // act 5 falls through to the ordinary encounter/rest/chest flow, which is what gives floor 5
  // an encounter layer for the first time. Emits the SAME `final-battle-begins` event, moved:
  // no new event kind is introduced.
  if (state.act === 5 && hollowGateOpen(player.xp)) {
    const { enemy, boss } = generateBoss({
      bossId: 'hollow',
      act: 5,
      player,
      karma: state.karma,
      rng,
    });
    const battle: BattleState = createBattle(player, enemy, 5, { boss });
    return finish({ kind: 'battle', battle, started: false, final: true }, [
      { kind: 'final-battle-begins', enemyName: enemy.fullName },
    ]);
  }
  // PLAN.md #2: the floor's own weights (floors.json), keyed on `place` — battle, chest, a
  // found rest, or a bargain that finds the player (§22.23, §22.25).
  const encounter = selectEncounter(rng, floorOf(state));
  if (encounter === 'battle') {
    // M13 gradual reveal: restrict the family/affix draws to the run's frozen unlock snapshot.
    // Absent snapshot ⇒ both sets are `undefined` ⇒ byte-identical to a pre-M13 draw.
    const families = state.unlocks ? new Set(state.unlocks.families) : undefined;
    const affixes = state.unlocks ? new Set(state.unlocks.affixes) : undefined;
    // PLAN.md #2: the floor rides along for the illusion roll (floor 2), keyed on `place`.
    const battle = buildRandomBattle(player, state.act, rng, families, affixes, floorOf(state));
    return finish({ kind: 'battle', battle, started: false, final: false }, [
      { kind: 'encounter-start', enemyName: battle.enemy.fullName },
    ]);
  }
  if (encounter === 'chest') {
    // A chest/cache: roll its guaranteed loot, pick every item up into the backpack, then
    // show the reveal. `continue` from the chest phase returns to the hub.
    const loot = buildChestLoot(rng, state.act);
    // PLAN.md #2: a FULL backpack (§22.17) leaves what it cannot hold — the reveal still shows
    // what the chest held, and `loot-left-behind` says what stayed in it.
    let inventory = player.inventory;
    const leftBehind: GameEvent[] = [];
    for (const item of loot) {
      if (canCarry(inventory)) {
        inventory = pickUp(inventory, item);
      } else {
        const left = summarizeLoot(item);
        leftBehind.push({ kind: 'loot-left-behind', name: left.name, rarity: left.rarity });
      }
    }
    const nextPlayer: Player = { ...player, inventory };
    return finish(
      { kind: 'chest', loot },
      [
        { kind: 'chest-found' },
        { kind: 'chest-loot', loot: loot.map(summarizeLoot) },
        ...leftBehind,
      ],
      { player: nextPlayer },
    );
  }
  if (encounter === 'bargain') {
    return openDeal(state, rng, finish);
  }
  return takeRest(state, player, rng, finish);
}

/**
 * The sacrifice-deal encounter — an altar/stranger offers a reward for a cost paid from the
 * player. PLAN.md #2: reached ONLY as a descent encounter (`continueJourney`'s `bargain` draw);
 * the hub can no longer summon one, which closes G52 at the root (§22.23). `buildDeal` reads the
 * karma vector and the floor (floor 4 tempts everyone) and rolls any reward item, so the offer is
 * fully determined here; the take/leave decision is resolved by `resolveDealDecision`.
 */
function openDeal(state: GameState, rng: Rng, finish: Finish): StepResult {
  // PLAN.md #2: the FLOOR picks the pool on floor 4 (tempting for everyone), keyed on `place`.
  const deal = buildDeal(state.karma, floorOf(state), rng);
  return finish({ kind: 'deal', deal }, [
    {
      kind: 'deal-offer',
      pool: deal.pool,
      cost: describeCost(deal.cost),
      reward: describeReward(deal.reward),
    },
  ]);
}

function resolveBattleRound(
  state: GameState,
  phase: Extract<Phase, { kind: 'battle' }>,
  action: BattleAction,
  rng: Rng,
  finish: Finish,
  rules: RoundRules,
): StepResult {
  const round = resolveRound(phase.battle, action, rng, rules);
  const events: GameEvent[] = [...round.events];
  let battle = round.state;
  let status = round.status;
  // M12: layer the boss mechanic AFTER `resolveRound` — so the non-boss encounter flow stays
  // byte-identical (a normal battle has no `boss`, so this whole block is skipped).
  //
  // G36: it also requires `round.resolved`. `resolveRound` returns `'ongoing'` for six NO-OP
  // REJECTIONS as well as for a real round, and this gate used to read the status alone — so a
  // press the engine had just refused still advanced the boss. Measured: nine rejected "Run"
  // presses against the act-1 Kingpin cost 11 HP to summoned minions, and three rejected casts
  // burned the Reflection's once-per-battle adaptation.
  //
  // G29: the Kingpin's minion damage comes back as a NUMBER and is applied here, through the
  // one guarded damage path in `battle.ts` (shield -> onTakeDamage relics -> revive gate), so
  // the most common death in the game finally consults the defenses the player paid for.
  if (status === 'ongoing' && battle.boss && round.resolved) {
    const post = bossPostRound(battle, action);
    battle = post.battle;
    events.push(...post.events);
    if (post.playerDamage > 0) {
      // The helper appends its own combat events (shield-absorbed, relic-triggered, revive)
      // into a CombatEvent list, which is then spread into the GameEvent stream in order.
      const guardEvents: CombatEvent[] = [];
      const hit = applyDamageToBattlePlayer(battle, post.playerDamage, guardEvents);
      battle = hit.state;
      events.push(...guardEvents);
      if (hit.died) {
        events.push({ kind: 'defeat' });
        status = 'player-died';
      }
    }
  }
  const enemy = battle.enemy;
  switch (status) {
    case 'ongoing':
      return finish({ ...phase, battle }, events);
    case 'fled':
      return finish({ kind: 'main-menu' }, events, { player: battle.player });
    case 'dispelled':
      // PLAN.md #2, floor 2: the passive Wisdom roll saw through an illusion. The fight ends
      // with NO reward (plan Appendix A.1 — "a pure cost": the illusion's attacks were real, the
      // player's were not, and seeing through pays nothing but the clarity nudge). The player's
      // battle state carries to the hub, as on any exit. `seeThroughIllusion` goes through the
      // floor funnel like every karma write (x1 on floor 2).
      return finish({ kind: 'main-menu' }, events, {
        player: battle.player,
        karma: recordOnFloor(state, state.karma, 'seeThroughIllusion'),
      });
    case 'spared':
      // Mercy: end the encounter with no rewards. Record the spare on the karma vector. The
      // actions are data-sourced from the family (the karma seam), defaulting to the uniform
      // mercy action.
      //
      // §22.22: `onSpare` is a LIST, and EVERY entry is applied, in order, in THIS ONE step —
      // The Judged's spare is mercy AND reverence, not one instead of the other. Folded inline
      // rather than behind a helper so this, the only site that reads the seam, is also the
      // site the behavioural test watches.
      return finish({ kind: 'main-menu' }, events, {
        player: battle.player,
        // PLAN.md #2: each entry is weighted by the floor (floor 4 counts double).
        karma: (getFamily(enemy.familyId)?.onSpare ?? DEFAULT_SPARE_ACTIONS).reduce(
          (k, action) => recordOnFloor(state, k, action),
          state.karma,
        ),
      });
    case 'player-won': {
      // A moral (⚖) kill records cruelty; a plain enemy (and every boss) records nothing.
      // Karma is an INPUT only here (the first EFFECT is the act-4 verdict gate).
      //
      // PLAN.md #2 / §22.22: `onKill` is a LIST, folded in order in THIS one step, exactly as
      // `onSpare` is — killing The Judged records cruelty AND desecration (`killSacred`).
      const karma = enemy.karmaWeighted
        ? (getFamily(enemy.familyId)?.onKill ?? DEFAULT_KILL_ACTIONS).reduce(
            (k, action) => recordOnFloor(state, k, action),
            state.karma,
          )
        : state.karma;
      // M12: a floor-boss win (acts 1–3, non-final, boss present) schedules an act advance once
      // any earned level-ups drain (`resolvePostVictory`). The Hollow (final) routes to the
      // damnation ending via `battle-victory`. A normal victory is unchanged (no `pending`).
      const patch: Partial<Pick<GameState, 'player' | 'karma' | 'pending'>> = {
        player: battle.player,
        karma,
      };
      if (!phase.final && battle.boss) patch.pending = 'advance-act';
      return finish({ kind: 'battle-victory', final: phase.final }, events, patch);
    }
    case 'player-died':
      events.push({ kind: 'game-over', xp: battle.player.xp });
      return finish({ kind: 'game-over' }, events, { player: battle.player });
  }
}

/**
 * A FOUND rest spot, taken at once — PURE apart from the single `computeRestHeal` draw.
 *
 * PLAN.md #2 / GAME-DESIGN.md §22.26 ("the rest is the only moment in the game where things are
 * truly calm"): rest is a PLACE the descent gives you, not a counted resource spent from the
 * hub. The banked rest counter, the per-victory extra-rest draw and the rest decision are all gone. Arriving
 * IS resting — "a rest that makes you choose is not calm" (plan Appendix A.2, accepted) — and it
 * happens even at full health, because it still refills the skill charges and clears conditions.
 * Scarcity comes from how often a spot is found (`floors.json`'s `rest` weight).
 *
 * The mechanics are §18.1's, unchanged in substance:
 *  - **G27.** Every active condition is cleared — `fracture` still needs a rest to go.
 *  - **G31.** Skill charges are refilled.
 *  - The HP heal is the one `computeRestHeal` draw, dampened on floor 3 (`healPct`), capped at
 *    `maxHp`. Conditions go BEFORE the heal, so the cap is never a max depressed by a condition
 *    the rest is removing.
 *
 * Emits `rest-found` (the floor, the brief's place line and id — the narrator's scene block is
 * built from the brief) and then `rest-taken`, in its existing shape. The phase is `rest`, so
 * the renderer shows the calm screen and `continue` returns to the hub.
 */
function takeRest(state: GameState, player: Player, rng: Rng, finish: Finish): StepResult {
  const floor = floorOf(state);
  const brief = restBrief(floor);
  const hpRestored = dampenHeal(computeRestHeal(player.xp, rng), floorModifiers(floor).healPct);
  const hp = Math.min(player.hp + hpRestored, player.maxHp);
  const rested: Player = {
    ...player,
    hp,
    activeConditions: [],
    skillCharges: player.maxSkillCharges,
  };
  return finish(
    { kind: 'rest' },
    [
      {
        kind: 'rest-found',
        floor,
        place: brief.place,
        briefId: brief.id,
        woundsClosed: player.hp < player.maxHp,
        conditionsEased: player.activeConditions.length > 0,
      },
      { kind: 'rest-taken', hpRestored, hp, maxHp: rested.maxHp },
    ],
    { player: rested },
  );
}

/**
 * Resolve the player's take/leave on a sacrifice deal — returns to the hub either way. On
 * decline, nothing changes (`deal-declined`). On accept, `applyDeal` pays the cost and grants
 * the reward: an affordable deal patches BOTH player and karma (`deal-taken`); an unaffordable
 * one (e.g. an HP cost >= current HP, or a relic cost with no relic) changes nothing
 * (`deal-unaffordable`). A karma-shifting cost flows through the real `recordKarma`.
 */
function resolveDealDecision(
  state: GameState,
  deal: SacrificeDeal,
  accept: boolean,
  finish: Finish,
): StepResult {
  const player = requirePlayer(state);
  if (!accept) return declineDeal(finish);
  if (!canAfford(player, deal.cost)) {
    return finish({ kind: 'main-menu' }, [
      { kind: 'deal-unaffordable', cost: describeCost(deal.cost) },
    ]);
  }
  // PLAN.md #2, Appendix A.3: an item reward with a FULL pack opens the pack for a discard.
  // NOTHING is paid here — not HP, not the ledger, not an item. The deal completes (or is
  // refused) in the NEXT step, from the `deal-discard` phase. Affordability is checked first,
  // so a bargain the player could never pay never asks them to throw anything away.
  if (needsRoom(player, deal)) {
    return finish({ kind: 'deal-discard', deal }, [
      { kind: 'deal-needs-room', reward: describeReward(deal.reward) },
    ]);
  }
  const result = applyDeal(
    player,
    state.karma,
    deal,
    floorModifiers(floorOf(state)).karmaMultiplier,
  );
  return finish(
    { kind: 'main-menu' },
    [{ kind: 'deal-taken', cost: describeCost(deal.cost), reward: describeReward(deal.reward) }],
    { player: result.player, karma: result.karma },
  );
}

/**
 * Refuse a bargain — the ONE definition, shared by the `deal` phase's "Refuse" and the
 * `deal-discard` phase's back-out (plan Appendix A.3.2).
 *
 * WHAT REFUSING DOES, stated explicitly as the ruling asks: NOTHING but return to the hub. No
 * karma action is recorded for a refusal (`KARMA_DELTAS` has none, by design — only what you DO
 * is read into your nature), no HP, stat, charge or item changes hands, and no random draw is
 * taken. Backing out of the discard runs this same function from the same unpaid state, so it
 * produces the identical next state — a test holds the two deep-equal, rng included.
 */
function declineDeal(finish: Finish): StepResult {
  return finish({ kind: 'main-menu' }, [{ kind: 'deal-declined' }]);
}

/** Is `index` a real backpack slot? Rejects non-integers, NaN and out-of-range (the G45 lesson). */
function validBackpackIndex(player: Player, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < player.inventory.backpack.length;
}

/** The player with backpack item `index` removed — PURE. */
function withoutItem(player: Player, index: number): Player {
  const backpack = player.inventory.backpack.filter((_, i) => i !== index);
  return { ...player, inventory: { slots: { ...player.inventory.slots }, backpack } };
}

/**
 * Leave backpack item `index` behind at the hub — PURE, RNG-free (PLAN.md #2). An ENGINE input,
 * not a render-layer mutation, so the run still replays from `seed + inputs`. A bad index is a
 * rejected no-op.
 */
function discardAtHub(
  state: GameState,
  index: number,
  finish: Finish,
  noop: StepResult,
): StepResult {
  const player = requirePlayer(state);
  if (!validBackpackIndex(player, index)) return noop;
  const dropped = summarizeLoot(player.inventory.backpack[index]!);
  return finish(
    { kind: 'main-menu' },
    [{ kind: 'item-discarded', name: dropped.name, rarity: dropped.rarity }],
    { player: withoutItem(player, index) },
  );
}

/**
 * Complete a full-pack bargain by leaving item `index` behind — ATOMIC (plan Appendix A.3.1/3).
 *
 * Discard, pay, place and record happen in THIS ONE step, computed on a copy and committed only
 * when every part succeeded. If anything fails between them — the cost no longer affordable, the
 * reward still without room — the step returns the ORIGINAL player and ledger with a
 * `deal-unaffordable`: the discard is not applied either, so there is no state in which the
 * item is gone and the bargain not taken, and none in which the price is paid and the reward
 * not placed. (With the shipped costs neither failure is reachable: only an item-freeing cost
 * could depend on the pack, and such a cost never needs room. The branch keeps the step total.)
 */
function discardForDeal(
  state: GameState,
  deal: SacrificeDeal,
  index: number,
  finish: Finish,
  noop: StepResult,
): StepResult {
  const player = requirePlayer(state);
  if (!validBackpackIndex(player, index)) return noop;
  const dropped = summarizeLoot(player.inventory.backpack[index]!);
  const result = applyDeal(
    withoutItem(player, index),
    state.karma,
    deal,
    floorModifiers(floorOf(state)).karmaMultiplier,
  );
  if (result.outcome !== 'taken') {
    return finish({ kind: 'main-menu' }, [
      { kind: 'deal-unaffordable', cost: describeCost(deal.cost) },
    ]);
  }
  return finish(
    { kind: 'main-menu' },
    [
      { kind: 'item-discarded', name: dropped.name, rarity: dropped.rarity },
      { kind: 'deal-taken', cost: describeCost(deal.cost), reward: describeReward(deal.reward) },
    ],
    { player: result.player, karma: result.karma },
  );
}

/**
 * Enter ONE level-up (M9): auto max-HP growth (one hit-die draw) then a seeded draft of 3
 * (its draws). Sets the `level-up-draft` phase with the offers, patches the leveled player,
 * and emits the `level-up` + `draft-offer` events. Called from `battle-victory` and, to
 * drain a queued level, from `level-up-result`.
 */
function enterLevelUp(player: Player, rng: Rng, finish: Finish): StepResult {
  const { player: leveled, hpRoll } = applyLevelUpHp(player, rng);
  const offers = generateDraft(leveled, rng);
  return finish(
    { kind: 'level-up-draft', offers },
    [
      { kind: 'level-up', newLevel: leveled.level, hpRoll, newMaxHp: leveled.maxHp },
      { kind: 'draft-offer', options: offers.map(describeDraftOption) },
    ],
    { player: leveled },
  );
}
