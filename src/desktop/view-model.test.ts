import { describe, it, expect } from 'vitest';
import { displayPlayer } from './view-model.ts';
import { createGame } from '../game/game.ts';
import type { GameState } from '../game/game.ts';
import { createPlayer } from '../game/player.ts';
import { buildRandomBattle } from '../game/encounter.ts';
import { createRng } from '../game/rng.ts';
import { STAT_KEYS } from '../game/character.ts';
import type { Stats } from '../game/character.ts';

// A whole, undamaged Enforcer with fixed stats. Every stat is 10 → each modifier
// floor((10-10)/2) = 0, so for the Enforcer's d10 hit die maxHp = 10 + 0 = 10 and
// starting hp = maxHp. Deriving the snapshot this way makes "hp === maxHp" a real,
// undamaged character — so the mid-battle value 3 below is a concrete contrast, not
// a number copied from the implementation.
const fixedStats = STAT_KEYS.reduce((acc, k) => {
  acc[k] = 10;
  return acc;
}, {} as Stats);
const snapshot = createPlayer({ name: 'Test', classId: 'Enforcer', stats: fixedStats });

describe('displayPlayer (desktop view-model)', () => {
  it('is a whole, undamaged snapshot to begin with', () => {
    // Independent sanity anchor: full hp, and full hp is NOT 3.
    expect(snapshot.hp).toBe(snapshot.maxHp);
    expect(snapshot.maxHp).toBe(10);
    expect(snapshot.hp).not.toBe(3);
  });

  it('returns the LIVE battle combatant (damaged hp), not the pre-battle snapshot', () => {
    const { rng } = createRng(42);
    const battle = buildRandomBattle(snapshot, 1, rng);
    // Simulate mid-battle damage: the live combatant's hp drops to a fixed value
    // that differs from the undamaged snapshot's hp.
    const damaged = { ...battle, player: { ...battle.player, hp: 3 } };
    const state: GameState = {
      version: 1,
      rngState: 0,
      player: snapshot,
      act: 1,
      place: 0,
      phase: { kind: 'battle', battle: damaged, started: true, final: false },
    };
    const shown = displayPlayer(state);
    expect(shown!.hp).toBe(3);
    // Because 3 differs from the snapshot's full hp, an implementation that wrongly
    // returned state.player would fail here.
    expect(shown!.hp).not.toBe(snapshot.hp);
  });

  it('returns the snapshot object outside battle', () => {
    const state: GameState = {
      version: 1,
      rngState: 0,
      player: snapshot,
      act: 1,
      place: 0,
      phase: { kind: 'main-menu' },
    };
    expect(displayPlayer(state)).toBe(state.player);
  });

  it('returns null before a player exists (title)', () => {
    const state = createGame(123);
    expect(state.player).toBeNull();
    expect(displayPlayer(state)).toBeNull();
  });
});
