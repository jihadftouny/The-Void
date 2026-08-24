import { describe, it, expect, beforeEach } from 'vitest';
import { saveRun, loadRun, clearRun } from './persist.ts';
import { createGame } from '../game/game.ts';
import { createStoryMemory, rememberBeat } from '../llm/narrate.ts';

// persist.ts uses the global `localStorage` at call time; install an in-memory
// stand-in so the save/load logic is testable headlessly (node env, no DOM).
function installMemoryLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

describe('persist (desktop save/load)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installMemoryLocalStorage();
  });

  it('round-trips a run (engine state + memory)', () => {
    const state = createGame(12345);
    let memory = createStoryMemory();
    memory = rememberBeat(memory, [{ kind: 'victory', xpGained: 5, extraRest: false, loot: [] }]);
    saveRun(state, memory);
    const loaded = loadRun();
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual(state);
    expect(loaded!.memory.enemiesDefeated).toBe(1);
  });

  it('returns null when there is no save', () => {
    expect(loadRun()).toBeNull();
  });

  it('returns null for corrupt or invalid saves', () => {
    store.set('thevoid:run', '{ not json');
    expect(loadRun()).toBeNull();
    store.set('thevoid:run', JSON.stringify({ state: { bogus: true }, memory: { beats: [] } }));
    expect(loadRun()).toBeNull();
  });

  it('clearRun removes the save', () => {
    saveRun(createGame(1), createStoryMemory());
    expect(loadRun()).not.toBeNull();
    clearRun();
    expect(loadRun()).toBeNull();
  });
});
