// Unit tests for player-facing text formatting. Every expected substring is derived
// from the design (numbers/words chosen by hand), never measured from the output.

import { describe, it, expect } from 'vitest';
import { formatEvent, hpText } from './format.ts';
import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { Stats } from '../game/character.ts';

const STATS: Stats = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };

describe('hpText', () => {
  it('renders "hp/maxHp"', () => {
    expect(hpText(8, 20)).toBe('8/20');
  });
});

describe('formatEvent — anchored player-facing strings', () => {
  it('victory carries the XP number (M7: no gold)', () => {
    const s = formatEvent({ kind: 'victory', xpGained: 12, extraRest: false, loot: [] });
    expect(s).toContain('12');
    expect(s.toLowerCase()).not.toContain('gold');
  });

  it('an enemy miss names the enemy side and says "miss"', () => {
    const s = formatEvent({ kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0 });
    expect(s.toLowerCase()).toContain('miss');
    expect(s.toLowerCase()).toContain('enemy');
  });

  it('a player crit carries a critical marker and the damage', () => {
    const s = formatEvent({ kind: 'attack', subject: 'player', outcome: 'crit', damage: 9 });
    expect(s.toLowerCase()).toContain('crit');
    expect(s).toContain('9');
  });

  it('rest-taken carries the restored amount and the hp fraction', () => {
    const s = formatEvent({ kind: 'rest-taken', hpRestored: 5, hp: 15, maxHp: 20 });
    expect(s).toContain('5');
    expect(s).toContain('15/20');
  });

  it('level-up mentions both picked stats', () => {
    const s = formatEvent({
      kind: 'level-up',
      picks: ['STR', 'CON'],
      newStats: STATS,
      hpRoll: 4,
      newMaxHp: 16,
      conModChanged: false,
      proficiency: 2,
    });
    expect(s).toContain('STR');
    expect(s).toContain('CON');
  });

  it('prefers a logic-populated `text` over the template', () => {
    const s = formatEvent({ kind: 'defeat', text: 'A custom defeat line.' });
    expect(s).toBe('A custom defeat line.');
  });
});

describe('formatEvent — totality over every event kind', () => {
  // One sample per GameEvent kind, built by hand.
  const samples: GameEvent[] = [
    // combat
    { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
    { kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember' },
    { kind: 'cast-unavailable' },
    { kind: 'attack', subject: 'player', outcome: 'hit', damage: 3 },
    { kind: 'advantage', subject: 'player' },
    { kind: 'disadvantage', subject: 'enemy' },
    { kind: 'player-unable-to-act', conditionType: 'stun' },
    { kind: 'condition-onset', subject: 'enemy', conditionType: 'burn' },
    { kind: 'condition-damage', subject: 'enemy', conditionType: 'burn', amount: 2 },
    { kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2 },
    { kind: 'condition-skip', subject: 'player', conditionType: 'sleep' },
    { kind: 'condition-applied', subject: 'enemy', conditionType: 'freeze' },
    { kind: 'condition-expired', subject: 'enemy', conditionType: 'freeze' },
    { kind: 'potion-drunk', healedTo: 20 },
    { kind: 'potion-unavailable' },
    { kind: 'potion-blocked' },
    { kind: 'fled' },
    { kind: 'escape-failed', damage: 4 },
    { kind: 'escape-impossible' },
    { kind: 'spared', enemyName: 'Grief' },
    { kind: 'spare-unavailable' },
    { kind: 'victory', xpGained: 5, extraRest: true, loot: [] },
    { kind: 'defeat' },
    // narrative
    { kind: 'title' },
    { kind: 'intro', header: 'H', lines: ['a', 'b'] },
    { kind: 'stats-rolled', stats: STATS },
    { kind: 'player-created', name: 'X', classId: 'Enforcer', maxHp: 12, armorClass: 11 },
    { kind: 'encounter-start', enemyName: 'Beast' },
    { kind: 'rest-lore', title: 'T', loreText: 'L' },
    { kind: 'rest-taken', hpRestored: 5, hp: 15, maxHp: 20 },
    { kind: 'rest-full' },
    { kind: 'rest-declined' },
    { kind: 'no-rests' },
    { kind: 'deal-offer', pool: 'standard', cost: '8 HP', reward: '12 HP restored' },
    { kind: 'deal-taken', cost: '8 HP', reward: '12 HP restored' },
    { kind: 'deal-unaffordable', cost: 'a relic' },
    { kind: 'deal-declined' },
    { kind: 'chest-found' },
    { kind: 'chest-loot', loot: [{ defId: 'gen:Common:ring', name: 'Common ring', rarity: 'Common' }] },
    { kind: 'act-outro', act: 1, header: 'H', body: 'B' },
    {
      kind: 'level-up',
      picks: ['STR', 'CON'],
      newStats: STATS,
      hpRoll: 4,
      newMaxHp: 16,
      conModChanged: false,
      proficiency: 2,
    },
    { kind: 'act-intro', act: 2, header: 'H', body: 'B' },
    { kind: 'final-battle-begins', enemyName: 'Boss' },
    { kind: 'ending', header: 'H', body: 'B' },
    { kind: 'game-over', xp: 42 },
  ];

  // Every kind, listed by hand (23 combat + 22 narrative = 45).
  const ALL_KINDS: GameEventKind[] = [
    'enemy-skill-used',
    'skill-cast',
    'cast-unavailable',
    'attack',
    'advantage',
    'disadvantage',
    'player-unable-to-act',
    'condition-onset',
    'condition-damage',
    'condition-heal',
    'condition-skip',
    'condition-applied',
    'condition-expired',
    'potion-drunk',
    'potion-unavailable',
    'potion-blocked',
    'fled',
    'escape-failed',
    'escape-impossible',
    'spared',
    'spare-unavailable',
    'victory',
    'defeat',
    'title',
    'intro',
    'stats-rolled',
    'player-created',
    'encounter-start',
    'rest-lore',
    'rest-taken',
    'rest-full',
    'rest-declined',
    'no-rests',
    'deal-offer',
    'deal-taken',
    'deal-unaffordable',
    'deal-declined',
    'chest-found',
    'chest-loot',
    'act-outro',
    'level-up',
    'act-intro',
    'final-battle-begins',
    'ending',
    'game-over',
  ];

  it('has one sample for every kind (no kind missed)', () => {
    const sampled = new Set(samples.map((s) => s.kind));
    expect(sampled).toEqual(new Set(ALL_KINDS));
    expect(ALL_KINDS).toHaveLength(45);
  });

  it('yields a non-empty string for every kind', () => {
    for (const e of samples) {
      const s = formatEvent(e);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
