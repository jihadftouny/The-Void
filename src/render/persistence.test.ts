// Unit tests for the pure save/load policy. Phase kinds are enumerated by hand from
// the Phase union in src/game/game.ts; the autosave/clear expectations and the
// continueAvailable booleans are derived independently from the save spec, never by
// round-tripping a value through the code under test.

import { describe, it, expect } from 'vitest';
import {
  shouldAutosaveFor,
  shouldClearSaveFor,
  continueAvailable,
  AUTOSAVE_PHASES,
  CLEAR_PHASES,
} from './persistence.ts';
import type { Phase } from '../game/game.ts';
import { createGame } from '../game/game.ts';
import { encodeSave } from '../game/save.ts';

// A minimal-but-typed Phase per kind. Only `.kind` is read by the policy, so the
// payloads are just enough to satisfy the type; casts stand in for the two phases
// with heavy payloads (battle/shop).
const ALL_PHASES: Phase[] = [
  { kind: 'title' },
  { kind: 'name-entry' },
  { kind: 'class-select', name: 'X' },
  { kind: 'stats-roll', name: 'X', classId: 'Enforcer', stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } },
  { kind: 'main-menu' },
  { kind: 'battle', battle: {} as never, started: false, final: false },
  { kind: 'battle-victory', final: false },
  { kind: 'rest', restOffered: true },
  { kind: 'deal', deal: {} as never },
  { kind: 'chest', loot: [] },
  { kind: 'act-outro', newAct: 2 },
  { kind: 'level-up', newAct: 2 },
  { kind: 'level-up-result', newAct: 2 },
  { kind: 'act-intro', newAct: 2 },
  { kind: 'ending' },
  { kind: 'game-over' },
];

// Hand-derived truth tables: exactly which kinds autosave / clear.
const EXPECT_AUTOSAVE = new Set<Phase['kind']>(['main-menu', 'act-intro']);
const EXPECT_CLEAR = new Set<Phase['kind']>(['ending', 'game-over']);

describe('persistence policy tables', () => {
  it('enumerates all 16 phase kinds', () => {
    expect(ALL_PHASES).toHaveLength(16);
  });

  it('autosaves only at main-menu and act-intro', () => {
    for (const phase of ALL_PHASES) {
      expect(shouldAutosaveFor(phase)).toBe(EXPECT_AUTOSAVE.has(phase.kind));
    }
  });

  it('clears only at ending and game-over', () => {
    for (const phase of ALL_PHASES) {
      expect(shouldClearSaveFor(phase)).toBe(EXPECT_CLEAR.has(phase.kind));
    }
  });

  it('never both autosaves and clears the same phase', () => {
    for (const phase of ALL_PHASES) {
      expect(shouldAutosaveFor(phase) && shouldClearSaveFor(phase)).toBe(false);
    }
  });

  it('battle explicitly does not autosave (no mid-round churn)', () => {
    expect(shouldAutosaveFor({ kind: 'battle', battle: {} as never, started: true, final: false })).toBe(false);
  });

  it('exposes the policy sets that back the predicates', () => {
    expect([...AUTOSAVE_PHASES].sort()).toEqual(['act-intro', 'main-menu']);
    expect([...CLEAR_PHASES].sort()).toEqual(['ending', 'game-over']);
  });
});

describe('continueAvailable (Anchor B)', () => {
  it('is false for a missing save', () => {
    expect(continueAvailable(null)).toBe(false);
  });

  it('is false for non-JSON', () => {
    expect(continueAvailable('{ not json')).toBe(false);
  });

  it('is false for valid JSON of the wrong shape', () => {
    // Parses, but lacks rngState/act/place/phase — fails the save shape guard.
    expect(continueAvailable('{"version":1}')).toBe(false);
  });

  it('is false for a future-version save', () => {
    const future = JSON.parse(encodeSave(createGame(7))) as Record<string, unknown>;
    future.version = 99;
    expect(continueAvailable(JSON.stringify(future))).toBe(false);
  });

  it('is false for a pre-version-1 (unmigratable) save', () => {
    const old = JSON.parse(encodeSave(createGame(7))) as Record<string, unknown>;
    old.version = 0;
    expect(continueAvailable(JSON.stringify(old))).toBe(false);
  });

  it('is true for a real current-version save', () => {
    // createGame(1) is a valid version-1 state at the title phase.
    expect(continueAvailable(encodeSave(createGame(1)))).toBe(true);
  });
});
