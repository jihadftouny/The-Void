// Unit tests for player-facing text formatting. Every expected substring is derived
// from the design (numbers/words chosen by hand), never measured from the output.

import { describe, it, expect } from 'vitest';
import { formatEvent, formatRollDetail, hpText } from './format.ts';
import { resolvePlayerAttack, type Attacker } from '../game/combat.ts';
import { getWeaponByName } from '../game/weapon.ts';
import type { CombatEvent } from '../game/combatEvent.ts';
import type { Rng } from '../game/rng.ts';
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
    const s = formatEvent({
      kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0,
      roll: { natural: 5, faces: [5], advDis: 0, modifier: 1, total: 6, targetAc: 13 },
      damageSources: [],
    });
    expect(s.toLowerCase()).toContain('miss');
    expect(s.toLowerCase()).toContain('enemy');
  });

  it('a player crit carries a critical marker and the damage', () => {
    const s = formatEvent({
      kind: 'attack', subject: 'player', outcome: 'crit', damage: 9,
      roll: { natural: 20, faces: [20], advDis: 0, modifier: 1, total: 21, targetAc: 13 },
      damageSources: [
        { kind: 'weapon-dice', amount: 4, label: '1d8' },
        { kind: 'crit-dice', amount: 4, label: '1d8' },
        { kind: 'ability-mod', amount: 1 },
      ],
    });
    expect(s.toLowerCase()).toContain('crit');
    expect(s).toContain('9');
  });

  it('rest-taken carries the restored amount and the hp fraction', () => {
    const s = formatEvent({ kind: 'rest-taken', hpRestored: 5, hp: 15, maxHp: 20 });
    expect(s).toContain('5');
    expect(s).toContain('15/20');
  });

  it('level-up carries the new level and max HP', () => {
    const s = formatEvent({ kind: 'level-up', newLevel: 3, hpRoll: 4, newMaxHp: 16 });
    expect(s).toContain('3'); // new level
    expect(s).toContain('16'); // new max HP
  });

  it('draft-offer lists the offered option labels', () => {
    const s = formatEvent({ kind: 'draft-offer', options: ['Learn Intimidate', '+1 STR'] });
    expect(s).toContain('Learn Intimidate');
    expect(s).toContain('+1 STR');
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
    // A pure-condition cast: 0 damage, and therefore no damage terms at all.
    { kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember', damage: 0,
      damageSources: [] },
    { kind: 'cast-unavailable' },
    { kind: 'attack', subject: 'player', outcome: 'hit', damage: 3,
      roll: { natural: 15, faces: [15], advDis: 0, modifier: 2, total: 17, targetAc: 13 },
      damageSources: [{ kind: 'weapon-dice', amount: 3, label: '1d8' }] },
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
    { kind: 'boss-summon', minions: 2 },
    { kind: 'boss-minion-damage', amount: 4 },
    { kind: 'boss-adapt' },
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
    { kind: 'level-up', newLevel: 2, hpRoll: 4, newMaxHp: 16 },
    { kind: 'draft-offer', options: ['Learn Intimidate', '+1 STR'] },
    { kind: 'draft-picked', option: '+1 STR' },
    { kind: 'act-intro', act: 2, header: 'H', body: 'B' },
    { kind: 'final-battle-begins', enemyName: 'Boss' },
    { kind: 'boss-encounter', bossId: 'kingpin', enemyName: 'Undercity Kingpin' },
    { kind: 'verdict', outcome: 'grace' },
    { kind: 'ending', endingType: 'grace', header: 'H', body: 'B' },
    { kind: 'game-over', xp: 42 },
  ];

  // Every kind, listed by hand (26 combat + 26 narrative = 52).
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
    'boss-summon',
    'boss-minion-damage',
    'boss-adapt',
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
    'draft-offer',
    'draft-picked',
    'act-intro',
    'final-battle-begins',
    'boss-encounter',
    'verdict',
    'ending',
    'game-over',
  ];

  it('has one sample for every kind (no kind missed)', () => {
    const sampled = new Set(samples.map((s) => s.kind));
    expect(sampled).toEqual(new Set(ALL_KINDS));
    expect(ALL_KINDS).toHaveLength(52);
  });

  it('yields a non-empty string for every kind', () => {
    for (const e of samples) {
      const s = formatEvent(e);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// formatRollDetail — the expandable dice line (docs/UI-DESIGN.md §3).
//
// Every event below is produced by the REAL engine from a scripted d20/damage sequence, so
// these assertions test the whole path (dice -> event -> line), not a hand-built fixture
// that happens to match. The expected STRINGS are written out by hand from the format spec.
// ---------------------------------------------------------------------------

/** The rng float that makes rollDie(rng, sides) land exactly on `face`. */
const face = (f: number, sides: number): number => (f - 0.5) / sides;

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('scriptedRng exhausted');
    return values[i++]!;
  };
}

// STR 14 -> +2; DEX 10 -> +0. The 1d8 rapier is Finesse, so its to-hit modifier is
// max(STR 2, DEX 0) = 2.
const RAPIER = getWeaponByName('Jiij Rapier 1')!;
function attacker(advantageDisadvantage = 0): Attacker {
  return {
    name: 'Hero',
    stats: { STR: 14, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    mods: { STR: 2, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
    hp: 20, maxHp: 20, xp: 0, armorClass: 12,
    skillCharges: 0, maxSkillCharges: 0,
    hitDie: { quantity: 1, sides: 10 },
    advantageDisadvantage,
    activeConditions: [],
  };
}
const AC13 = {
  name: 'Beast',
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  mods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
  hp: 30, maxHp: 30, xp: 1, armorClass: 13,
  skillCharges: 0, maxSkillCharges: 0,
  hitDie: { quantity: 1, sides: 8 },
  activeConditions: [],
};

/** Run one player attack and hand back the `attack` event the engine emitted. */
function attackEvent(advDis: number, draws: number[]): Extract<CombatEvent, { kind: 'attack' }> {
  const r = resolvePlayerAttack(attacker(advDis), AC13, RAPIER, 0, scriptedRng(draws));
  const e = r.events[r.events.length - 1]!;
  if (e.kind !== 'attack') throw new Error('expected an attack event');
  return e;
}

describe('formatRollDetail', () => {
  it('a hit shows the die, the modifier, the total, the AC and the damage', () => {
    // natural 15, +2 = 17 against AC 13 -> hit; the d8 lands on 4.
    const e = attackEvent(0, [face(15, 20), face(4, 8)]);
    expect(formatRollDetail(e)).toBe('d20+2 = 17 vs AC 13 → hit, 1d8 = 4');
  });

  it('a miss shows the roll it lost by, and no damage clause', () => {
    // natural 10, +2 = 12, one short of AC 13.
    const e = attackEvent(0, [face(10, 20)]);
    expect(formatRollDetail(e)).toBe('d20+2 = 12 vs AC 13 → miss');
  });

  it('advantage shows BOTH faces and which one was taken', () => {
    // Faces 7 and 15; advantage keeps 15, so 15 + 2 = 17 >= AC 13 -> hit; d8 lands on 4.
    const e = attackEvent(1, [face(7, 20), face(15, 20), face(4, 8)]);
    expect(formatRollDetail(e)).toBe('d20 adv (7,15)+2 = 17 vs AC 13 → hit, 1d8 = 4');
  });

  it('disadvantage shows both faces and keeps the lower', () => {
    // The same two faces; disadvantage keeps 7, so 7 + 2 = 9 < AC 13 -> miss.
    const e = attackEvent(-1, [face(7, 20), face(15, 20)]);
    expect(formatRollDetail(e)).toBe('d20 dis (7,15)+2 = 9 vs AC 13 → miss');
  });

  it('a crit names both dice and drops the AC clause it never consulted', () => {
    // natural 20 crits regardless of AC; two d8 rolls of 4 and 5 make 9.
    const e = attackEvent(0, [face(20, 20), face(4, 8), face(5, 8)]);
    expect(formatRollDetail(e)).toBe('nat 20 → critical, 1d8 + 1d8 = 9');
  });

  it('a fumble reads as the natural 1 that caused it', () => {
    const e = attackEvent(0, [face(1, 20)]);
    expect(formatRollDetail(e)).toBe('nat 1 → fumble');
  });

  it('omits a zero modifier rather than printing "+0"', () => {
    // STR 10 / DEX 10 -> both mods 0, so the Finesse modifier is max(0, 0) = 0.
    // (The engine derives the to-hit mod from `stats`, so the stats are what must change.)
    const flat: Attacker = {
      ...attacker(),
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      mods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
    };
    const r = resolvePlayerAttack(flat, AC13, RAPIER, 0, scriptedRng([face(15, 20), face(4, 8)]));
    const e = r.events[r.events.length - 1]!;
    if (e.kind !== 'attack') throw new Error('expected an attack event');
    expect(formatRollDetail(e)).toBe('d20 = 15 vs AC 13 → hit, 1d8 = 4');
  });

  it('names a term that has no dice notation', () => {
    // A +3 gear bonus has no notation, so it reads by name: 1d8 + gear = 7.
    const r = resolvePlayerAttack(attacker(), AC13, RAPIER, 3, scriptedRng([face(15, 20), face(4, 8)]));
    const e = r.events[r.events.length - 1]!;
    if (e.kind !== 'attack') throw new Error('expected an attack event');
    expect(formatRollDetail(e)).toBe('d20+2 = 17 vs AC 13 → hit, 1d8 + gear = 7');
  });

  it('the damage it prints is the damage the event reports', () => {
    for (const draws of [
      [face(15, 20), face(4, 8)],
      [face(20, 20), face(4, 8), face(5, 8)],
      [face(10, 20)],
    ]) {
      const e = attackEvent(0, draws);
      const line = formatRollDetail(e);
      if (e.damage > 0) expect(line.endsWith(`= ${e.damage}`)).toBe(true);
    }
  });
});
