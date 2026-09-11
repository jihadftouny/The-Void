import { describe, expect, it } from 'vitest';
import { type GameEvent, type GameEventKind } from './gameEvent.ts';

// These tests are primarily compile-time: they assert the union admits the
// narrative events with the documented fields and that a CombatEvent is a
// GameEvent. Values are hand-written from the type shape, not measured.

describe('GameEvent union', () => {
  it('admits narrative events with their typed fields', () => {
    const events: GameEvent[] = [
      { kind: 'title' },
      { kind: 'intro', header: 'STORY', lines: ['a', 'b'] },
      {
        kind: 'stats-rolled',
        stats: { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 },
      },
      { kind: 'player-created', name: 'X', classId: 'Enforcer', maxHp: 11, armorClass: 11 },
      { kind: 'encounter-start', enemyName: 'Beast' },
      { kind: 'level-up', newLevel: 2, hpRoll: 7, newMaxHp: 18 },
      { kind: 'draft-offer', options: ['Learn Intimidate', '+1 STR', '+1 damage'] },
      { kind: 'draft-picked', option: '+1 STR' },
      { kind: 'ending', endingType: 'damnation', header: 'END.', body: 'X' },
      { kind: 'game-over', xp: 42 },
    ];
    expect(events).toHaveLength(10);
    expect(events[0]?.kind).toBe('title');
  });

  it('unions in CombatEvent as-is', () => {
    const victory: GameEvent = {
      kind: 'victory',
      xpGained: 3,
      loot: [],
    };
    expect(victory.kind).toBe('victory');
  });

  it('GameEventKind covers a representative narrative kind', () => {
    const k: GameEventKind = 'deal-offer';
    expect(k).toBe('deal-offer');
  });
});
