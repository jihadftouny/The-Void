// Tests for the pure save/load core (M9).
//
// Expectations are derived by hand from the plan, the GameState shape in game.ts,
// and the RNG contract in rng.ts — never by printing implementation output and
// pasting it back. The anchors compare two INDEPENDENT runs (an un-saved run vs a
// save/restore run), so a pass proves the restore is faithful, not that code
// equals itself.

import { describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  encodeSave,
  decodeSave,
  createMemoryStorage,
  saveGame,
  loadGame,
} from './save.ts';
import {
  createGame,
  step,
  type GameState,
  type GameInput,
  type StepResult,
} from './game.ts';
import { createRng } from './rng.ts';
import { type GameEvent } from './gameEvent.ts';

const SEED = 12345;

/** Drive a fresh game to the main-menu with a created player (a mid-run state). */
function midRunState(seed: number): GameState {
  let state = createGame(seed);
  state = step(state, { kind: 'continue' }).state; // title -> name-entry
  state = step(state, { kind: 'name', name: 'Ari' }).state; // -> class-select
  state = step(state, { kind: 'class', classId: 'Enforcer' }).state; // -> stats-roll
  state = step(state, { kind: 'stats-decision', accept: true }).state; // -> main-menu
  return state;
}

/** Fold a fixed input list through `step`, collecting every event in order. */
function runInputs(
  state: GameState,
  inputs: readonly GameInput[],
): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (const input of inputs) {
    const r: StepResult = step(s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe('SAVE_VERSION', () => {
  it('mirrors the current GameState.version', () => {
    // Derived from game.ts: createGame stamps version 2 (M1 bumped 1 -> 2).
    expect(SAVE_VERSION).toBe(2);
    expect(createGame(SEED).version).toBe(SAVE_VERSION);
  });
});

const ZERO_KARMA = {
  mercyCruelty: 0,
  restraintGreed: 0,
  reverenceDesecration: 0,
  clarityDelusion: 0,
};

describe('migration v1 -> v2', () => {
  it('injects default karma + empty inventory into an old-shape mid-run save', () => {
    // The modern (v2) state carries karma (all zero) and a player with an empty
    // inventory. Build a v1 save by STRIPPING those M1 fields and stamping version 1.
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    delete old.karma;
    delete (old.player as Record<string, unknown>).inventory;
    old.version = 1;
    // Sanity: the source really is missing the M1 fields (else the test is vacuous).
    expect('karma' in old).toBe(false);
    expect('inventory' in (old.player as Record<string, unknown>)).toBe(false);

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    // The injected defaults, asserted explicitly.
    expect(migrated!.karma).toEqual(ZERO_KARMA);
    expect(migrated!.version).toBe(2);
    expect(migrated!.player!.inventory.backpack).toEqual([]);
    expect(Object.values(migrated!.player!.inventory.slots).every((s) => s === null)).toBe(
      true,
    );
    expect(Object.keys(migrated!.player!.inventory.slots)).toHaveLength(9);
    // And the migrated state deep-equals the modern new-shape state it was built from.
    expect(migrated).toEqual(modern);
  });

  it('migrates a v1 title save with a null player (no inventory to inject)', () => {
    const modern = createGame(SEED); // player is null at the title
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    delete old.karma;
    old.version = 1;

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.karma).toEqual(ZERO_KARMA);
    expect(migrated!.player).toBeNull();
    expect(migrated!.version).toBe(2);
    expect(migrated).toEqual(modern);
  });

  it('rejects a future version 3 save without throwing', () => {
    const s = { ...createGame(SEED), version: 3 };
    expect(() => decodeSave(JSON.stringify(s))).not.toThrow();
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });
});

describe('round-trip', () => {
  it('deep-equals for a fresh createGame state', () => {
    const s = createGame(SEED);
    const decoded = decodeSave(encodeSave(s));
    expect(decoded).toEqual(s);
  });

  it('produces a string JSON.parse accepts', () => {
    const s = createGame(SEED);
    const encoded = encodeSave(s);
    expect(typeof encoded).toBe('string');
    expect(() => JSON.parse(encoded)).not.toThrow();
  });

  it('deep-equals for a mid-run state (player created, main-menu)', () => {
    const m = midRunState(SEED);
    // Sanity: this state is genuinely mid-run.
    expect(m.player).not.toBeNull();
    expect(m.phase.kind).toBe('main-menu');
    const decoded = decodeSave(encodeSave(m));
    expect(decoded).toEqual(m);
  });
});

describe('decodeSave rejection (returns null, never throws)', () => {
  const cases: Array<[string, string]> = [
    ['malformed JSON', '{'],
    ['JSON null', 'null'],
    ['JSON number', '42'],
    ['JSON array', '[]'],
    ['JSON string', '"hello"'],
  ];
  for (const [label, json] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => decodeSave(json)).not.toThrow();
      expect(decodeSave(json)).toBeNull();
    });
  }

  it('rejects a missing version field', () => {
    const s = createGame(SEED) as unknown as Record<string, unknown>;
    delete s.version;
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a future version', () => {
    const s = { ...createGame(SEED), version: SAVE_VERSION + 1 };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects an older version with nothing to migrate', () => {
    // fromVersion 0 < SAVE_VERSION -> migrate can't upgrade -> null.
    const s = { ...createGame(SEED), version: 0 };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-number version', () => {
    const s = { ...createGame(SEED), version: 'x' };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-number rngState', () => {
    const s = { ...createGame(SEED), rngState: 'nope' };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-finite rngState', () => {
    // JSON has no Infinity/NaN, so simulate the parsed shape via a string body.
    const s = createGame(SEED) as unknown as Record<string, unknown>;
    const body = JSON.stringify(s).replace('"rngState":12345', '"rngState":null');
    expect(decodeSave(body)).toBeNull();
  });

  it('rejects a missing act field', () => {
    const s = createGame(SEED) as unknown as Record<string, unknown>;
    delete s.act;
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a string act field', () => {
    const s = { ...createGame(SEED), act: 'one' };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects an unknown phase kind', () => {
    const s = { ...createGame(SEED), phase: { kind: 'bogus' } };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-object phase', () => {
    const s = { ...createGame(SEED), phase: 42 };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a player that is neither null nor a valid Player', () => {
    // A mid-run state whose player lost a required field.
    const m = midRunState(SEED);
    const broken = JSON.parse(encodeSave(m)) as Record<string, unknown>;
    delete (broken.player as Record<string, unknown>).classId;
    expect(decodeSave(JSON.stringify(broken))).toBeNull();
  });

  it('rejects a player with a wrong-typed field', () => {
    const m = midRunState(SEED);
    const broken = JSON.parse(encodeSave(m)) as Record<string, unknown>;
    (broken.player as Record<string, unknown>).hp = 'full';
    expect(decodeSave(JSON.stringify(broken))).toBeNull();
  });

  it('rejects a player with an unknown classId', () => {
    const m = midRunState(SEED);
    const broken = JSON.parse(encodeSave(m)) as Record<string, unknown>;
    (broken.player as Record<string, unknown>).classId = 'Wizard';
    expect(decodeSave(JSON.stringify(broken))).toBeNull();
  });
});

describe('memory storage save/load/clear', () => {
  it('save then load restores a deep-equal state', () => {
    const st = createMemoryStorage();
    const m = midRunState(SEED);
    saveGame(m, st);
    expect(loadGame(st)).toEqual(m);
  });

  it('load on empty storage returns null', () => {
    const st = createMemoryStorage();
    expect(loadGame(st)).toBeNull();
  });

  it('clear makes a subsequent load return null', () => {
    const st = createMemoryStorage();
    saveGame(midRunState(SEED), st);
    st.clear();
    expect(loadGame(st)).toBeNull();
  });
});

describe('anchor 1: deterministic resume of the event stream', () => {
  it('a save/restore run matches the un-saved run over identical inputs', () => {
    const original = midRunState(SEED);

    // A fixed, hand-chosen input sequence. Mismatched inputs are no-ops in `step`
    // (total reducer), so the sequence advances both runs identically.
    const inputs: GameInput[] = [
      { kind: 'menu', choice: 'continue' },
      { kind: 'continue' },
      { kind: 'battle-action', action: 'fight' },
      { kind: 'continue' },
      { kind: 'battle-action', action: 'fight' },
      { kind: 'continue' },
      { kind: 'menu', choice: 'continue' },
      { kind: 'continue' },
    ];

    // Reference: run directly on the original (never saved).
    const reference = runInputs(original, inputs);

    // Guard against a vacuous anchor: the sequence must actually drive the game
    // (emit events and change state), else deep-equality would prove nothing.
    expect(reference.events.length).toBeGreaterThan(0);
    expect(reference.state).not.toEqual(original);

    // Restore: encode the ORIGINAL, decode it, run the SAME inputs.
    const restored = decodeSave(encodeSave(original));
    expect(restored).not.toBeNull();
    const resumed = runInputs(restored as GameState, inputs);

    expect(resumed.events).toEqual(reference.events);
    expect(resumed.state).toEqual(reference.state);
  });
});

describe('anchor 2: RNG accumulator identity', () => {
  it('restored rngState is the identical number and the resumed stream matches', () => {
    const m = midRunState(SEED);
    const restored = decodeSave(encodeSave(m)) as GameState;

    expect(typeof restored.rngState).toBe('number');
    expect(restored.rngState).toBe(m.rngState);

    // The first float drawn from the resumed accumulator is bit-identical to the
    // first drawn from the original's accumulator (rng.ts: createRng(state)
    // continues the same stream). Ground truth = the original's draw.
    const originalDraw = createRng(m.rngState).rng();
    const resumedDraw = createRng(restored.rngState).rng();
    expect(resumedDraw).toBe(originalDraw);
  });
});
