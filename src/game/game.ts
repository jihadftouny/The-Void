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
//  - Menu option 2 (`seek-deal`) opens the sacrifice-deal encounter (replaces the gold shop).
//  - Level-up raises maxHp but does not heal; the final boss gets no auto-advantage.
//  - The ending shows only on a win; death goes to game-over.
//  - Name/class confirm loops and per-round continue gates are dropped (events carry
//    the narration; confirmation UX belongs to the render layer).

import { createRng, type Rng } from './rng.ts';
import { type Stats } from './character.ts';
import { createKarma, recordKarma, type KarmaState } from './karma.ts';
import { getFamily } from './enemyFamily.ts';
import { createPlayer, rollStartStats, type Player, type PlayerClass } from './player.ts';
import {
  applyDamageToBattlePlayer,
  resolveRound,
  openBattle,
  type BattleState,
  type BattleAction,
} from './battle.ts';
import { createBattle } from './battle.ts';
import { generateBoss, bossPostRound, computeVerdict, type BossId } from './boss.ts';
import {
  buildRandomBattle,
  buildChestLoot,
  computeRestHeal,
  selectEncounter,
  selectLore,
} from './encounter.ts';
import {
  buildDeal,
  applyDeal,
  canAfford,
  describeCost,
  describeReward,
  type SacrificeDeal,
} from './deal.ts';
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
  | { kind: 'rest'; restOffered: boolean }
  | { kind: 'deal'; deal: SacrificeDeal }
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
  version: 8;
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
  | 'rest-decision'
  | 'game-over';

/** The input the player (via the UI) supplies to `step`. */
export type GameInput =
  | { kind: 'continue' }
  | { kind: 'name'; name: string }
  | { kind: 'class'; classId: PlayerClass }
  | { kind: 'stats-decision'; accept: boolean }
  | { kind: 'menu'; choice: 'continue' | 'seek-deal' | 'quit' }
  | { kind: 'battle-action'; action: BattleAction }
  | { kind: 'draft-pick'; index: number }
  | { kind: 'deal-decision'; accept: boolean }
  | { kind: 'rest-decision'; accept: boolean };

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
    version: 8,
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
      return phase.restOffered ? 'rest-decision' : 'continue';
    case 'deal':
      return 'deal-decision';
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
export function step(state: GameState, input: GameInput): StepResult {
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
      if (input.kind !== 'menu') return noop;
      const player = requirePlayer(state);
      if (input.choice === 'quit') {
        return finish({ kind: 'game-over' }, [{ kind: 'game-over', xp: player.xp }]);
      }
      if (input.choice === 'seek-deal') {
        return openDeal(state, rng, finish);
      }
      // 'continue' — Java continueJourney: checkAct first, else an encounter.
      return continueJourney(state, player, rng, finish);
    }

    case 'battle': {
      if (!phase.started) {
        if (input.kind !== 'continue') return noop;
        // M6: fire startOfBattle relic triggers as the battle becomes active. Off-equivalent
        // (same battle, no events) for a player with no startOfBattle relics equipped.
        const opened = openBattle(phase.battle);
        return finish({ ...phase, battle: opened.battle, started: true }, opened.events);
      }
      if (input.kind !== 'battle-action') return noop;
      return resolveBattleRound(state, phase, input.action, rng, finish);
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
      if (!phase.restOffered) {
        if (input.kind !== 'continue') return noop;
        return finish({ kind: 'main-menu' }, []);
      }
      if (input.kind !== 'rest-decision') return noop;
      return resolveRestDecision(state, input.accept, rng, finish);
    }

    case 'deal': {
      if (input.kind !== 'deal-decision') return noop;
      return resolveDealDecision(state, phase.deal, input.accept, finish);
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
      return finish({ kind: 'act-intro', newAct: phase.newAct }, [
        { kind: 'act-intro', act: phase.newAct, header: intro.header, body: intro.body },
      ]);
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
      // and `selectLore`. So the True Void had no random battles, no chests, no rests, no
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
  const encounter = selectEncounter(rng);
  if (encounter === 'battle') {
    // M13 gradual reveal: restrict the family/affix draws to the run's frozen unlock snapshot.
    // Absent snapshot ⇒ both sets are `undefined` ⇒ byte-identical to a pre-M13 draw.
    const families = state.unlocks ? new Set(state.unlocks.families) : undefined;
    const affixes = state.unlocks ? new Set(state.unlocks.affixes) : undefined;
    const battle = buildRandomBattle(player, state.act, rng, families, affixes);
    return finish({ kind: 'battle', battle, started: false, final: false }, [
      { kind: 'encounter-start', enemyName: battle.enemy.fullName },
    ]);
  }
  if (encounter === 'chest') {
    // A chest/cache: roll its guaranteed loot, pick every item up into the backpack, then
    // show the reveal. `continue` from the chest phase returns to the hub.
    const loot = buildChestLoot(rng, state.act);
    let inventory = player.inventory;
    for (const item of loot) inventory = pickUp(inventory, item);
    const nextPlayer: Player = { ...player, inventory };
    return finish(
      { kind: 'chest', loot },
      [
        { kind: 'chest-found' },
        { kind: 'chest-loot', loot: loot.map(summarizeLoot) },
      ],
      { player: nextPlayer },
    );
  }
  // Rest: show lore, then offer a rest if any remain.
  const lore = selectLore(state.act, rng);
  const events: GameEvent[] = [];
  if (lore) {
    events.push({ kind: 'rest-lore', title: lore.title, loreText: lore.text });
  }
  if (player.restsLeft >= 1) {
    return finish({ kind: 'rest', restOffered: true }, events);
  }
  events.push({ kind: 'no-rests' });
  return finish({ kind: 'rest', restOffered: false }, events);
}

/**
 * The sacrifice-deal encounter (menu option 2, `seek-deal`) — an altar/stranger offers a
 * reward for a cost paid from the player. `buildDeal` reads the karma vector (for the pool)
 * and rolls any reward item, so the offer is fully determined here; the take/leave decision
 * is resolved by `resolveDealDecision`.
 */
function openDeal(state: GameState, rng: Rng, finish: Finish): StepResult {
  const deal = buildDeal(state.karma, state.act, rng);
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
): StepResult {
  const round = resolveRound(phase.battle, action, rng);
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
    case 'spared':
      // Mercy: end the encounter with no rewards. Record the spare on the karma vector
      // (INPUT only — no world/tone effect yet). The action is data-sourced from the
      // family (the M10 seam), defaulting to the uniform mercy action.
      return finish({ kind: 'main-menu' }, events, {
        player: battle.player,
        karma: recordKarma(state.karma, getFamily(enemy.familyId)?.onSpare ?? 'spareWeighted'),
      });
    case 'player-won': {
      // A moral (⚖) kill records cruelty; a plain enemy (and every boss) records nothing.
      // Karma is an INPUT only here (the first EFFECT is the act-4 verdict gate).
      const karma = enemy.karmaWeighted
        ? recordKarma(state.karma, getFamily(enemy.familyId)?.onKill ?? 'killWeighted')
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
 * Resolve a rest — PURE apart from the single `computeRestHeal` draw.
 *
 * G27 + G31: a rest now CURES every active condition and REFILLS skill charges, alongside the
 * HP heal it always did.
 *
 *  - **G27.** `fracture` carries `maxTurns: 100` with the comment *"needs a rest"* — but
 *    `resolveRestDecision` never touched `activeConditions`, and `game.ts` writes the battle
 *    player back to the hub, so a floor-1 Ganger's `gangStomp` put the player on attack
 *    disadvantage for the ENTIRE RUN with no in-game remedy (measured: still active after 99
 *    rounds; the only data-side cure, `warding-charm`, is battle-only and unobtainable).
 *  - **G31.** Charges were never restored either, contradicting `GAME-DESIGN.md` §18.1
 *    (*"A rest restores HP **and** skill charges"*): a 493-step run taking six rests ended on
 *    ZERO charges, so the whole class-skill system was one-shot per run.
 *
 * DEVIATION FROM THE REGISTER, deliberate. G31's literal wording says to restore charges
 * *"including the `rest-full` early-return branch"* — but that branch consumes NO rest, so a
 * full-HP player could refill charges at every rest node for free, forever. Worse, G27 makes
 * resting at full HP genuinely valuable (it is now the only fracture cure), so the branch's
 * premise is gone. Implemented instead: `rest-full` fires only when there is NOTHING to gain
 * — full HP **and** full charges **and** no conditions. Otherwise the rest is taken and paid
 * for. That satisfies both G27 and G31 and closes the exploit.
 *
 * Conditions are cleared BEFORE the heal, so the cap is the true `maxHp` rather than a max
 * depressed by a `sick`/Frail condition the rest is about to remove. ALL conditions go,
 * buffs included: they are 2-turn combat effects and a rest is a reset. The `rest-taken`
 * event keeps its existing shape — no new event kind.
 *
 * DOCUMENTED DRAW-ORDER CHANGE: a full-HP player who is fractured or short of charges now
 * takes the rest, and therefore now consumes the `computeRestHeal` draw it used to skip.
 */
function resolveRestDecision(
  state: GameState,
  accept: boolean,
  rng: Rng,
  finish: Finish,
): StepResult {
  const player = requirePlayer(state);
  if (!accept) {
    return finish({ kind: 'main-menu' }, [{ kind: 'rest-declined' }]);
  }
  const nothingToGain =
    player.hp >= player.maxHp &&
    player.skillCharges >= player.maxSkillCharges &&
    player.activeConditions.length === 0;
  if (nothingToGain) {
    // Nothing a rest could do: no roll, no rest consumed (faithful to Java's full-HP case).
    return finish({ kind: 'main-menu' }, [{ kind: 'rest-full' }]);
  }
  const hpRestored = computeRestHeal(player.xp, rng);
  const hp = Math.min(player.hp + hpRestored, player.maxHp);
  const healed: Player = {
    ...player,
    hp,
    activeConditions: [],
    skillCharges: player.maxSkillCharges,
    restsLeft: player.restsLeft - 1,
  };
  return finish({ kind: 'main-menu' }, [{ kind: 'rest-taken', hpRestored, hp, maxHp: healed.maxHp }], {
    player: healed,
  });
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
  if (!accept) {
    return finish({ kind: 'main-menu' }, [{ kind: 'deal-declined' }]);
  }
  if (!canAfford(player, deal.cost)) {
    return finish({ kind: 'main-menu' }, [
      { kind: 'deal-unaffordable', cost: describeCost(deal.cost) },
    ]);
  }
  const result = applyDeal(player, state.karma, deal);
  return finish(
    { kind: 'main-menu' },
    [{ kind: 'deal-taken', cost: describeCost(deal.cost), reward: describeReward(deal.reward) }],
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
