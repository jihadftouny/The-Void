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
import { step } from '../game/game.ts';
import { sceneFor } from './routing.ts';
import { formatEvent } from './format.ts';

export class GameDriver {
  readonly k: Engine;
  state: GameState;
  /** Formatted, player-facing lines of everything that has happened, oldest first. */
  readonly log: string[] = [];

  constructor(k: Engine, initial: GameState) {
    this.k = k;
    this.state = initial;
  }

  /** Send one input through the pure reducer, then render the resulting phase. */
  dispatch(input: GameInput): void {
    const result = step(this.state, input);
    this.state = result.state;
    for (const event of result.events) {
      this.log.push(formatEvent(event));
    }
    this.k.go(sceneFor(this.state.phase.kind));
  }

  /** Navigate to the scene for the current phase (called once at startup). */
  boot(): void {
    this.k.go(sceneFor(this.state.phase.kind));
  }

  // SEAM (M9 save/load): the save/load unit will add a `load(state: GameState)` method
  // here that assigns `this.state`, rehydrates `this.log`, and calls
  // `this.k.go(sceneFor(this.state.phase.kind))` to resume a persisted run. GameState
  // is already the serializable shape a save round-trips, so no adaptation is needed.
}
