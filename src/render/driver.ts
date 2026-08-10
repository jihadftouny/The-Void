// The game driver: the single object that drives the pure controller from the render
// layer. It HOLDS a GameState, and the ONLY way state ever changes is by assigning
// `step(state, input).state` back — the driver (and the scenes) implement no game
// rule and never edit a state field directly.
//
// Data flow (one loop): a scene renders `driver.state` + `driver.log` -> the player
// taps a button -> `driver.dispatch(input)` -> `step` returns {state, events,
// awaiting} -> the driver stores the new state, appends the formatted events to the
// log, and navigates to `sceneFor(state.phase.kind)` -> the next scene renders.

import type { Engine } from './engine.ts';
import type { GameState, GameInput } from '../game/game.ts';
import { step, createGame } from '../game/game.ts';
import { type SaveStorage, saveGame, loadGame } from '../game/save.ts';
import { createLocalStorageSaveStorage } from '../storage/localStorage.ts';
import { sceneFor } from './routing.ts';
import { formatEvent } from './format.ts';
import { shouldAutosaveFor, shouldClearSaveFor, continueAvailable } from './persistence.ts';

export class GameDriver {
  readonly k: Engine;
  state: GameState;
  /** Formatted, player-facing lines of everything that has happened, oldest first. */
  readonly log: string[] = [];
  private readonly storage: SaveStorage;

  constructor(
    k: Engine,
    initial: GameState,
    // The default is lazily evaluated, so headless tests that pass an in-memory
    // SaveStorage never construct the localStorage adapter (nor touch `window`).
    storage: SaveStorage = createLocalStorageSaveStorage(),
  ) {
    this.k = k;
    this.state = initial;
    this.storage = storage;
  }

  /** Send one input through the pure reducer, persist, then render the resulting phase. */
  dispatch(input: GameInput): void {
    const result = step(this.state, input);
    this.state = result.state;
    for (const event of result.events) {
      this.log.push(formatEvent(event));
    }
    this.persist();
    this.k.go(sceneFor(this.state.phase.kind));
  }

  /** Navigate to the scene for the current phase (called once at startup). */
  boot(): void {
    this.k.go(sceneFor(this.state.phase.kind));
  }

  /**
   * Apply the save/load policy to the CURRENT state: clear the stored save when the
   * run has ended (ending/game-over), else autosave at a checkpoint (main-menu/
   * act-intro). All other phases leave storage untouched — no mid-battle churn.
   */
  private persist(): void {
    if (shouldClearSaveFor(this.state.phase)) {
      this.storage.clear();
    } else if (shouldAutosaveFor(this.state.phase)) {
      saveGame(this.state, this.storage);
    }
  }

  /** True iff a valid, resumable save exists — the title scene shows Continue only then. */
  savedGameAvailable(): boolean {
    return continueAvailable(this.storage.load());
  }

  /**
   * Resume the stored run, if any. Guards against a save that vanished or corrupted
   * between the Continue button rendering and the tap: a null decode is a no-op.
   */
  resume(): void {
    const s = loadGame(this.storage);
    if (s) this.load(s);
  }

  /**
   * Reset the driver onto a fresh run at the title screen. `Date.now()` is used HERE,
   * in the render layer, to seed the new run — allowed (the RNG ban applies only to
   * src/game). The save was already cleared when game-over/ending was reached.
   */
  restart(): void {
    this.load(createGame(Date.now() >>> 0));
  }

  /**
   * Assign `state`, clear the scrollback, and navigate to its phase's scene. Used by
   * resume() and restart(); does NOT itself persist (the next dispatch does). The log
   * is deliberately not rehydrated — GameState carries no scrollback (see plan note 3).
   */
  private load(state: GameState): void {
    this.state = state;
    this.log.length = 0;
    this.k.go(sceneFor(this.state.phase.kind));
  }
}
