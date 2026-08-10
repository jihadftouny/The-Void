// Long-term persistence for the desktop AI game: the whole run — engine state
// AND narrative memory — round-trips through localStorage, so relaunching offers
// a real "Continue". Render-layer only (localStorage is a browser API); the
// engine stays pure. A file-on-disk save is a packaging-era concern (N10).
import { decodeSave } from '../game/save.ts';
import type { GameState } from '../game/game.ts';
import type { StoryMemory } from '../llm/narrate.ts';

const KEY = 'thevoid:run';

export interface SavedRun {
  state: GameState;
  memory: StoryMemory;
}

export function saveRun(state: GameState, memory: StoryMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, state, memory }));
  } catch {
    /* storage unavailable — the run still plays, it just won't persist */
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function loadRun(): SavedRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as { state?: unknown; memory?: unknown };
    // Reuse the engine's validating decoder for the game state (rejects corrupt/old saves).
    const state = decodeSave(JSON.stringify(env.state ?? null));
    if (!state) return null;
    const m = env.memory as Partial<StoryMemory> | undefined;
    if (!m || !Array.isArray(m.beats)) return null;
    const memory: StoryMemory = {
      beats: m.beats.map(String),
      enemiesDefeated: Number(m.enemiesDefeated) || 0,
      timesFled: Number(m.timesFled) || 0,
      notable: Array.isArray(m.notable) ? m.notable.map(String) : [],
    };
    return { state, memory };
  } catch {
    return null;
  }
}
