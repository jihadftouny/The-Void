// Integration tests for the driver's save/load wiring. These drive the REAL pure
// controller (src/game) through a fake Engine and an in-memory SaveStorage, then
// assert the persistence side effects the driver is responsible for.
//
// Expectations are derived independently of the persistence code:
//  - Anchor C compares storage against `encodeSave(driver.state)` computed directly
//    from the controller, so "saved == current state" is checked by construction.
//  - Anchor A asserts the resumed run is byte-for-byte the run that was never closed
//    (deep-equal states, same enemy) plus a concrete rngState integer captured from
//    the control run BEFORE any persistence code touches it — an invariant that
//    fails under any mirrored / off-by-one save bug.

import { describe, it, expect } from 'vitest';
import type { Engine } from './engine.ts';
import { GameDriver } from './driver.ts';
import { createGame, type GameState, type GameInput } from '../game/game.ts';
import { createMemoryStorage, encodeSave } from '../game/save.ts';
import { sceneFor } from './routing.ts';

// A fake Kaplay engine: the driver only ever calls `k.go(sceneId)`.
function fakeEngine(): { k: Engine; last: () => string | null } {
  let lastScene: string | null = null;
  const k = { go: (id: string) => { lastScene = id; } } as unknown as Engine;
  return { k, last: () => lastScene };
}

// Seed 2 is chosen (by exploration) so the first `continue` from the opening menu is a
// battle whose first fight round stays ongoing under the M7 6-slot encounter table —
// nothing about the assertions depends on that beyond exercising the battle branch
// deterministically.
const SEED = 2;

const CREATION: GameInput[] = [
  { kind: 'continue' },
  { kind: 'name', name: 'Rune' },
  { kind: 'class', classId: 'Enforcer' },
  { kind: 'stats-decision', accept: true },
];

/** Drive a driver from the title through creation to the first main-menu. */
function driveToMenu(d: GameDriver): void {
  for (const input of CREATION) d.dispatch(input);
  expect(d.state.phase.kind).toBe('main-menu');
}

function enemyName(s: GameState): string {
  const phase = s.phase;
  if (phase.kind !== 'battle') throw new Error('not a battle phase');
  return phase.battle.enemy.fullName;
}

describe('GameDriver save/load wiring', () => {
  it('autosaves the completed-creation state at the first main-menu (Anchor C)', () => {
    const storage = createMemoryStorage();
    const { k } = fakeEngine();
    const d = new GameDriver(k, createGame(SEED), storage);
    driveToMenu(d);
    // The on-disk save is exactly the current between-actions state.
    expect(storage.load()).toBe(encodeSave(d.state));
  });

  it('does NOT persist mid-battle, and a fight round leaves the save untouched (Anchor C)', () => {
    const storage = createMemoryStorage();
    const { k } = fakeEngine();
    const d = new GameDriver(k, createGame(SEED), storage);
    driveToMenu(d);
    const savedAtMenu = storage.load();

    d.dispatch({ kind: 'menu', choice: 'continue' });
    expect(d.state.phase.kind).toBe('battle');
    // A save still exists (the menu), but it is NOT the mid-battle state.
    expect(storage.load()).not.toBeNull();
    expect(storage.load()).toBe(savedAtMenu);
    expect(storage.load()).not.toBe(encodeSave(d.state));

    // Start the fight and resolve one round; storage must not change during battle.
    d.dispatch({ kind: 'continue' }); // battle.started = true
    d.dispatch({ kind: 'battle-action', action: 'fight' });
    expect(d.state.phase.kind).toBe('battle'); // still fighting (seed-controlled)
    expect(storage.load()).toBe(savedAtMenu);
  });

  it('resume() over the same storage is indistinguishable from never closing (Anchor A)', () => {
    const storage = createMemoryStorage();
    const control = new GameDriver(fakeEngine().k, createGame(SEED), storage);
    driveToMenu(control);

    // The autosaved menu that the very next `continue` turns into a battle. Capture the
    // menu's rngState from the control run directly (not via the persistence code).
    const preCloseRngState = control.state.rngState;
    control.dispatch({ kind: 'menu', choice: 'continue' });
    expect(control.state.phase.kind).toBe('battle');
    const controlBattle = structuredClone(control.state);

    // storage still holds the pre-battle menu (battle does not autosave), so a fresh
    // driver can resume it. Seed differs to prove resume overwrites the fresh state.
    const freshEngine = fakeEngine();
    const fresh = new GameDriver(freshEngine.k, createGame(9999), storage);
    fresh.resume();
    // resume() navigated to the resumed phase's scene.
    expect(freshEngine.last()).toBe(sceneFor(fresh.state.phase.kind));
    expect(fresh.state.phase.kind).toBe('main-menu');
    // Concrete carrier: the resumed RNG accumulator equals the control's pre-close value.
    expect(fresh.state.rngState).toBe(preCloseRngState);

    // The same input from the resumed state yields the identical next foe.
    fresh.dispatch({ kind: 'menu', choice: 'continue' });
    expect(fresh.state).toEqual(controlBattle);
    expect(fresh.state.phase.kind).toBe('battle');
    expect(enemyName(fresh.state)).toBe(enemyName(controlBattle));
  });

  it('clears the save on game-over so Continue is no longer offered', () => {
    const storage = createMemoryStorage();
    const { k } = fakeEngine();
    const d = new GameDriver(k, createGame(SEED), storage);

    // Fresh store: nothing to continue.
    expect(d.savedGameAvailable()).toBe(false);

    driveToMenu(d);
    // Creation complete and saved: Continue available.
    expect(d.savedGameAvailable()).toBe(true);

    // Quit from the menu ends the run at game-over, which clears the save.
    d.dispatch({ kind: 'menu', choice: 'quit' });
    expect(d.state.phase.kind).toBe('game-over');
    expect(storage.load()).toBeNull();
    expect(d.savedGameAvailable()).toBe(false);
  });

  it('restart() begins a fresh title run and clears the scrollback', () => {
    const storage = createMemoryStorage();
    const { k, last } = fakeEngine();
    const d = new GameDriver(k, createGame(SEED), storage);
    driveToMenu(d);
    expect(d.log.length).toBeGreaterThan(0);
    const savedBefore = storage.load(); // the autosaved menu

    d.restart();
    expect(d.state.phase.kind).toBe('title');
    expect(d.log.length).toBe(0);
    expect(last()).toBe('title');
    // restart() itself does not touch storage (title is neither a checkpoint nor a
    // clear phase), so the previously autosaved run survives unchanged.
    expect(storage.load()).toBe(savedBefore);
  });
});
