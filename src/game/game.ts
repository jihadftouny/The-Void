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
//  - Menu option 2 bundles shop THEN character-info (the only path to the shop).
//  - Level-up raises maxHp but does not heal; the final boss gets no auto-advantage.
//  - The ending shows only on a win; death goes to game-over.
//  - Name/class confirm loops and per-round continue gates are dropped (events carry
//    the narration; confirmation UX belongs to the render layer).

import { createRng, type Rng } from './rng.ts';
import { type StatKey, type Stats } from './character.ts';
import { createKarma, type KarmaState } from './karma.ts';
import { createPlayer, rollStartStats, type Player, type PlayerClass } from './player.ts';
import { resolveRound, openBattle, type BattleState, type BattleAction } from './battle.ts';
import { createBattle } from './battle.ts';
import { generateEnemy } from './enemy.ts';
import {
  buildRandomBattle,
  buildChestLoot,
  computeRestHeal,
  selectEncounter,
  selectLore,
} from './encounter.ts';
import { buildShopOffer, applyShopPurchase, type ShopOffer } from './shop.ts';
import { summarizeLoot } from './loot.ts';
import {
  FINAL_BOSS_NAME,
  FINAL_BOSS_XP,
  levelUpPlayer,
  shouldAdvance,
} from './progression.ts';
import { getActIntro, getActOutro, getEnding, getIntro } from './story.ts';
import { playerArmorClass } from './defense.ts';
import { equippedDefId, pickUp } from './equipment.ts';
import { type EquipSlot, type ItemInstance } from './item.ts';
import { type GameEvent } from './gameEvent.ts';

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
  | { kind: 'shop'; offer: ShopOffer }
  | { kind: 'chest'; loot: ItemInstance[] }
  | { kind: 'act-outro'; newAct: number }
  | { kind: 'level-up'; newAct: number }
  | { kind: 'level-up-result'; newAct: number }
  | { kind: 'act-intro'; newAct: number }
  | { kind: 'ending' }
  | { kind: 'game-over' };

/** The full, serializable game state. */
export interface GameState {
  version: 5;
  /** mulberry32 accumulator — the serializable RNG state; JSON round-trips it. */
  rngState: number;
  player: Player | null;
  /** Current Act, 1..5. */
  act: number;
  /** Current floor index, 0..4 (place = act - 1). */
  place: number;
  /**
   * Four-axis Karma / Nature vector for this run. Recorded only in M1 (see
   * `karma.ts`); no engine outcome depends on it yet. Spread through every `step`
   * transition, so it persists unchanged until a later milestone writes to it.
   */
  karma: KarmaState;
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
  | 'level-up-picks'
  | 'shop-decision'
  | 'rest-decision'
  | 'game-over';

/** The input the player (via the UI) supplies to `step`. */
export type GameInput =
  | { kind: 'continue' }
  | { kind: 'name'; name: string }
  | { kind: 'class'; classId: PlayerClass }
  | { kind: 'stats-decision'; accept: boolean }
  | { kind: 'menu'; choice: 'continue' | 'character-info' | 'quit' }
  | { kind: 'battle-action'; action: BattleAction }
  | { kind: 'level-up-picks'; picks: [StatKey, StatKey] }
  | { kind: 'shop-decision'; accept: boolean }
  | { kind: 'rest-decision'; accept: boolean };

/** What `step` returns: the next state, the ordered events, and the next Awaiting. */
export interface StepResult {
  state: GameState;
  events: GameEvent[];
  awaiting: Awaiting;
}

/** Build a fresh game at the title screen, seeded by `seed`. */
export function createGame(seed: number): GameState {
  return {
    version: 5,
    rngState: seed >>> 0,
    player: null,
    act: 1,
    place: 0,
    karma: createKarma(),
    phase: { kind: 'title' },
  };
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
    case 'shop':
      return 'shop-decision';
    case 'chest':
      return 'continue';
    case 'act-outro':
      return 'continue';
    case 'level-up':
      return 'level-up-picks';
    case 'level-up-result':
      return 'continue';
    case 'act-intro':
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
    patch: Partial<Pick<GameState, 'player' | 'act' | 'place'>> = {},
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
      if (input.choice === 'character-info') {
        return openShop(state, player, rng, finish);
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
      return resolveBattleRound(phase, input.action, rng, finish);
    }

    case 'battle-victory': {
      if (input.kind !== 'continue') return noop;
      if (phase.final) {
        const player = requirePlayer(state);
        const ending = getEnding();
        return finish({ kind: 'ending' }, [
          {
            kind: 'ending',
            header: ending.header,
            body: substituteName(ending.body, player.name),
          },
        ]);
      }
      return finish({ kind: 'main-menu' }, []);
    }

    case 'rest': {
      if (!phase.restOffered) {
        if (input.kind !== 'continue') return noop;
        return finish({ kind: 'main-menu' }, []);
      }
      if (input.kind !== 'rest-decision') return noop;
      return resolveRestDecision(state, input.accept, rng, finish);
    }

    case 'shop': {
      if (input.kind !== 'shop-decision') return noop;
      return resolveShopDecision(state, phase.offer, input.accept, finish);
    }

    case 'chest': {
      if (input.kind !== 'continue') return noop;
      // The loot was already picked up when the chest was found; continue to the hub.
      return finish({ kind: 'main-menu' }, []);
    }

    case 'act-outro': {
      if (input.kind !== 'continue') return noop;
      const concluded = phase.newAct - 1;
      const outro = getActOutro(concluded) ?? { header: '', body: '' };
      return finish({ kind: 'level-up', newAct: phase.newAct }, [
        { kind: 'act-outro', act: concluded, header: outro.header, body: outro.body },
      ]);
    }

    case 'level-up': {
      if (input.kind !== 'level-up-picks') return noop;
      return resolveLevelUp(state, phase.newAct, input.picks, rng, finish);
    }

    case 'level-up-result': {
      if (input.kind !== 'continue') return noop;
      const intro = getActIntro(phase.newAct) ?? { header: '', body: '' };
      return finish({ kind: 'act-intro', newAct: phase.newAct }, [
        { kind: 'act-intro', act: phase.newAct, header: intro.header, body: intro.body },
      ]);
    }

    case 'act-intro': {
      if (input.kind !== 'continue') return noop;
      if (phase.newAct === 5) {
        const player = requirePlayer(state);
        const boss = generateEnemy(
          { act: 5, type: FINAL_BOSS_NAME, playerXp: FINAL_BOSS_XP },
          rng,
        );
        const battle = createBattle(player, boss, 5);
        return finish(
          { kind: 'battle', battle, started: false, final: true },
          [{ kind: 'final-battle-begins', enemyName: boss.fullName }],
        );
      }
      return finish({ kind: 'main-menu' }, []);
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
  patch?: Partial<Pick<GameState, 'player' | 'act' | 'place'>>,
) => StepResult;

function requirePlayer(state: GameState): Player {
  if (!state.player) throw new Error('step: player is required in this phase but is null');
  return state.player;
}

/** Java `continueJourney`: advance an act if earned, otherwise run an encounter. */
function continueJourney(
  state: GameState,
  player: Player,
  rng: Rng,
  finish: Finish,
): StepResult {
  if (shouldAdvance(state.act, player.xp)) {
    const newAct = state.act + 1;
    return finish({ kind: 'act-outro', newAct }, [], {
      act: newAct,
      place: newAct - 1,
    });
  }
  const encounter = selectEncounter(rng);
  if (encounter === 'battle') {
    const battle = buildRandomBattle(player, state.act, rng);
    return finish({ kind: 'battle', battle, started: false, final: false }, [
      { kind: 'encounter-start', enemyName: battle.enemy.fullName },
    ]);
  }
  if (encounter === 'chest') {
    // A chest/cache: roll its guaranteed loot, pick every item up into the backpack, then
    // show the reveal. `continue` from the chest phase returns to the hub.
    const loot = buildChestLoot(rng);
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

/** Java option 2: the mysterious stranger's shop offer. */
function openShop(state: GameState, player: Player, rng: Rng, finish: Finish): StepResult {
  const offer = buildShopOffer(state.act, rng);
  const slot: EquipSlot = offer.itemKind === 'armor' ? 'armor' : 'mainHand';
  // M5: the currently-equipped item comes from the paperdoll slot (empty -> '—').
  const currentId = equippedDefId(player.inventory, slot) ?? '—';
  return finish({ kind: 'shop', offer }, [
    {
      kind: 'shop-offer',
      itemKind: offer.itemKind,
      itemId: offer.itemId,
      itemName: offer.itemName,
      price: offer.price,
      currentId,
      currentName: currentId,
    },
  ]);
}

function resolveBattleRound(
  phase: Extract<Phase, { kind: 'battle' }>,
  action: BattleAction,
  rng: Rng,
  finish: Finish,
): StepResult {
  const round = resolveRound(phase.battle, action, rng);
  const events: GameEvent[] = [...round.events];
  switch (round.status) {
    case 'ongoing':
      return finish({ ...phase, battle: round.state }, events);
    case 'fled':
      return finish({ kind: 'main-menu' }, events, { player: round.state.player });
    case 'player-won':
      return finish({ kind: 'battle-victory', final: phase.final }, events, {
        player: round.state.player,
      });
    case 'player-died':
      events.push({ kind: 'game-over', xp: round.state.player.xp });
      return finish({ kind: 'game-over' }, events, { player: round.state.player });
  }
}

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
  if (player.hp >= player.maxHp) {
    // Full HP: no roll, no rest consumed (faithful to Java).
    return finish({ kind: 'main-menu' }, [{ kind: 'rest-full' }]);
  }
  const hpRestored = computeRestHeal(player.xp, rng);
  const hp = Math.min(player.hp + hpRestored, player.maxHp);
  const healed: Player = { ...player, hp, restsLeft: player.restsLeft - 1 };
  return finish({ kind: 'main-menu' }, [{ kind: 'rest-taken', hpRestored, hp, maxHp: healed.maxHp }], {
    player: healed,
  });
}

function resolveShopDecision(
  state: GameState,
  offer: ShopOffer,
  accept: boolean,
  finish: Finish,
): StepResult {
  const player = requirePlayer(state);
  const events: GameEvent[] = [];
  let nextPlayer = player;
  if (!accept) {
    events.push({ kind: 'shop-declined' });
  } else {
    const result = applyShopPurchase(player, offer);
    nextPlayer = result.player;
    events.push({
      kind: 'shop-purchased',
      itemId: offer.itemId,
      price: offer.price,
    });
  }
  // Java bundles character-info after the shop.
  events.push({ kind: 'character-info' });
  return finish({ kind: 'main-menu' }, events, { player: nextPlayer });
}

function resolveLevelUp(
  state: GameState,
  newAct: number,
  picks: [StatKey, StatKey],
  rng: Rng,
  finish: Finish,
): StepResult {
  const player = requirePlayer(state);
  const oldConMod = player.mods.CON;
  const leveled = levelUpPlayer(player, picks, newAct, rng);
  const conModChanged = oldConMod !== leveled.mods.CON;
  // The floored dice+conMod roll = total maxHp delta minus the CON-changed bonus.
  const delta = leveled.maxHp - player.maxHp;
  const hpRoll = delta - (conModChanged ? newAct - 1 : 0);
  return finish({ kind: 'level-up-result', newAct }, [
    {
      kind: 'level-up',
      picks,
      newStats: leveled.stats,
      hpRoll,
      newMaxHp: leveled.maxHp,
      conModChanged,
      proficiency: leveled.proficiency,
    },
  ], { player: leveled });
}
