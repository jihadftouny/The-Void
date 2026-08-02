// Pure view selectors for the desktop renderer.
//
// Read-only projections of engine state for display. No DOM, no Kaplay, no
// mutation — honors the logic/render split so the display logic is testable
// headlessly in Node. Imports only engine TYPES (`import type`).
import type { GameState } from '../game/game.ts';
import type { Player } from '../game/player.ts';

/**
 * The player to DISPLAY on the sheet: during a battle the live combatant
 * (`state.phase.battle.player`, whose HP ticks down each round), otherwise the
 * top-level snapshot (`state.player`, synced back only at battle end). Returns
 * `null` before a player exists (title/name-entry).
 */
export function displayPlayer(state: GameState): Player | null {
  if (state.phase.kind === 'battle') return state.phase.battle.player;
  return state.player;
}
