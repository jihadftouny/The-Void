// The combat log's pure half (G18).
//
// Every expected STRING below is written out by hand from the format spec and the dice
// arithmetic, and every `attack` fixture is produced by the REAL engine from a scripted d20 —
// so these assertions test the whole path (dice -> event -> line), not a hand-built event that
// happens to match what the formatter does.
//
// `SAMPLE` is a MAPPED TYPE over `GameEventKind`, deliberately built here a SECOND time rather
// than imported from `format.test.ts` or `narrationCoverage.test.ts`. Three independent
// witnesses to the same union is the point (PRINCIPLES.md §A3): if one of them silently drifts
// out of step with the engine, the other two do not drift with it.

import { describe, it, expect } from 'vitest';
import { LOG_ROUTING, logLines, startsNewBattle, BATTLE_OPENER_KINDS } from './log-model.ts';
import type { LogLine } from './log-model.ts';
import { resolvePlayerAttack, type Attacker } from '../game/combat.ts';
import { getWeaponByName } from '../game/weapon.ts';
import type { CombatEvent } from '../game/combatEvent.ts';
import type { Rng } from '../game/rng.ts';
import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { Stats } from '../game/character.ts';

const STATS: Stats = { STR: 11, DEX: 9, CON: 12, INT: 10, WIS: 13, CHA: 8 };

const SAMPLE: { [K in GameEventKind]: Extract<GameEvent, { kind: K }> } = {
  // ---- combat (37) ----
  'enemy-skill-used': { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
  'skill-cast': {
    kind: 'skill-cast', subject: 'player', skillId: 'heavyStrike', name: 'Heavy Strike',
    damage: 7, damageSources: [{ kind: 'skill', amount: 7 }],
  },
  'cast-unavailable': { kind: 'cast-unavailable' },
  attack: {
    kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0,
    roll: { natural: 5, faces: [5], advDis: 0, modifier: 1, total: 6, targetAc: 13 },
    damageSources: [],
  },
  advantage: { kind: 'advantage', subject: 'enemy' },
  disadvantage: { kind: 'disadvantage', subject: 'player' },
  'player-unable-to-act': { kind: 'player-unable-to-act', conditionType: 'insanity' },
  'condition-onset': { kind: 'condition-onset', subject: 'player', conditionType: 'poison' },
  'condition-damage': { kind: 'condition-damage', subject: 'player', conditionType: 'poison', amount: 1 },
  'condition-heal': { kind: 'condition-heal', subject: 'enemy', conditionType: 'regeneration', amount: 1 },
  'condition-skip': { kind: 'condition-skip', subject: 'enemy', conditionType: 'stun' },
  'condition-applied': { kind: 'condition-applied', subject: 'player', conditionType: 'quick' },
  'condition-expired': { kind: 'condition-expired', subject: 'player', conditionType: 'quick' },
  'resource-changed': { kind: 'resource-changed', subject: 'player', resource: 'corruption', value: 2 },
  'self-sacrifice': { kind: 'self-sacrifice', amount: 2, ofMaxHp: false },
  lifesteal: { kind: 'lifesteal', amount: 3 },
  detonate: { kind: 'detonate', consumed: 1, bonusDamage: 4 },
  fled: { kind: 'fled' },
  'escape-failed': { kind: 'escape-failed', damage: 2 },
  'escape-impossible': { kind: 'escape-impossible' },
  spared: { kind: 'spared', enemyName: 'The Grieving' },
  'spare-unavailable': { kind: 'spare-unavailable' },
  victory: { kind: 'victory', xpGained: 9, loot: [] },
  defeat: { kind: 'defeat' },
  'relic-triggered': { kind: 'relic-triggered', trigger: 'onKill', action: 'gainStat' },
  'consumable-used': { kind: 'consumable-used', itemId: 'suture-kit' },
  'consumable-unavailable': { kind: 'consumable-unavailable' },
  'shield-gained': { kind: 'shield-gained', amount: 4 },
  'shield-absorbed': { kind: 'shield-absorbed', amount: 2 },
  revive: { kind: 'revive', healedTo: 6 },
  'stat-stolen': { kind: 'stat-stolen', stat: 'CON', amount: 1 },
  'boss-summon': { kind: 'boss-summon', minions: 1 },
  'boss-minion-damage': { kind: 'boss-minion-damage', amount: 2 },
  'boss-adapt': { kind: 'boss-adapt' },
  // PLAN.md #2 (combat)
  'floor-drain': { kind: 'floor-drain', resource: 'skillCharge', amount: 1 },
  'illusion-struck': { kind: 'illusion-struck' },
  'illusion-dispelled': { kind: 'illusion-dispelled', natural: 12, modifier: 1, total: 13, dc: 13 },
  'loot-left-behind': { kind: 'loot-left-behind', name: 'Common helmet', rarity: 'Common' },
  // ---- narrative (26) ----
  title: { kind: 'title' },
  intro: { kind: 'intro', header: 'HEAD', lines: ['one', 'two'] },
  'stats-rolled': { kind: 'stats-rolled', stats: STATS },
  'player-created': { kind: 'player-created', name: 'Probe', classId: 'Scavver', maxHp: 9, armorClass: 12 },
  'encounter-start': { kind: 'encounter-start', enemyName: 'Rust Choir' },
  'rest-taken': { kind: 'rest-taken', hpRestored: 3, hp: 12, maxHp: 20 },
  'deal-offer': { kind: 'deal-offer', pool: 'tempting', cost: '3 HP', reward: '5 HP restored' },
  'deal-taken': { kind: 'deal-taken', cost: '3 HP', reward: '5 HP restored' },
  'deal-unaffordable': { kind: 'deal-unaffordable', cost: '3 HP' },
  'deal-declined': { kind: 'deal-declined' },
  'chest-found': { kind: 'chest-found' },
  'chest-loot': { kind: 'chest-loot', loot: [{ defId: 'void-draught', name: 'Void Draught', rarity: 'Common' }] },
  'act-outro': { kind: 'act-outro', act: 2, header: 'ACT II ENDS', body: '' },
  'level-up': { kind: 'level-up', newLevel: 4, hpRoll: 6, newMaxHp: 26 },
  'draft-offer': { kind: 'draft-offer', options: ['+1 CON', 'Learn Brace'] },
  'draft-picked': { kind: 'draft-picked', option: '+1 CON' },
  'act-intro': { kind: 'act-intro', act: 3, header: 'ACT III', body: '' },
  'final-battle-begins': { kind: 'final-battle-begins', enemyName: 'Hollow Self' },
  'boss-encounter': { kind: 'boss-encounter', bossId: 'reflection', enemyName: 'The Reflection' },
  verdict: { kind: 'verdict', outcome: 'cast-down' },
  ending: { kind: 'ending', endingType: 'damnation', header: 'DAMNATION', body: '' },
  'game-over': { kind: 'game-over', xp: 120 },
  // PLAN.md #2 (narrative)
  'rest-found': { kind: 'rest-found', floor: 3, place: 'a cold hearth', briefId: 'floor-3' },
  'skills-warped': { kind: 'skills-warped', count: 2 },
  'deal-needs-room': { kind: 'deal-needs-room', reward: 'Legendary mainHand' },
  'item-discarded': { kind: 'item-discarded', name: 'Suture Kit', rarity: 'Common' },
};

const ALL_KINDS = Object.keys(SAMPLE) as GameEventKind[];

// ---------------------------------------------------------------------------
// The routing map — exhaustive by construction, and correct by inspection.
// ---------------------------------------------------------------------------

describe('LOG_ROUTING is total over GameEventKind', () => {
  it('has exactly 64 entries (38 combat + 26 narrative)', () => {
    // Counted by hand from the two union declarations, the same independent count
    // `narrationCoverage.test.ts` and `format.test.ts` each make separately. The
    // `Record<GameEventKind, LogRoute>` type already guarantees the KEYS are the union; this
    // anchors its SIZE, so a 64th kind cannot arrive unnoticed even if someone adds a key.
    // PLAN.md #2: +4 combat, +4 narrative.
    // ...and -4 narrative: the rest-decision kinds left with the decision (PLAN.md #2).
    // ...and -3 combat: the potion kinds left with the potion (§22.6).
    expect(Object.keys(LOG_ROUTING)).toHaveLength(37 + 4 - 3 + 26 + 4 - 4);
    expect(new Set(Object.keys(LOG_ROUTING))).toEqual(new Set(ALL_KINDS));
  });

  it('routes every value to one of the two destinations', () => {
    for (const kind of ALL_KINDS) {
      expect(['log', 'pane'], `${kind}`).toContain(LOG_ROUTING[kind]);
    }
  });

  it('every LOG-routed kind yields exactly one NON-EMPTY line', () => {
    let logged = 0;
    for (const kind of ALL_KINDS) {
      if (LOG_ROUTING[kind] !== 'log') continue;
      logged += 1;
      const lines = logLines([SAMPLE[kind]]);
      expect(lines, `${kind} must produce a line`).toHaveLength(1);
      expect(lines[0]!.text.length, `${kind} produced an empty line`).toBeGreaterThan(0);
    }
    // non-vacuity: 37 + PLAN.md #2's three in-fight kinds (floor-drain, illusion-struck,
    // illusion-dispelled). `loot-left-behind` is a combat kind routed to the PANE.
    expect(logged).toBe(37 + 3 - 3);
  });

  it('every PANE-routed kind yields NO line at all', () => {
    let paned = 0;
    for (const kind of ALL_KINDS) {
      if (LOG_ROUTING[kind] !== 'pane') continue;
      paned += 1;
      expect(logLines([SAMPLE[kind]]), `${kind} must not reach the log`).toEqual([]);
    }
    // 26 narrative + PLAN.md #2's four narrative kinds + `loot-left-behind`.
    expect(paned).toBe(26 + 4 + 1 - 4);
  });

  it('a rejected input IS logged, though the narrator stays silent about it', () => {
    // The one place the log's classification deliberately differs from `src/llm/narrate.ts`'s.
    // The player pressed a button and nothing happened; the log is the only thing that can
    // say why.
    for (const kind of [
      'cast-unavailable', 'spare-unavailable', 'consumable-unavailable',
    ] as const) {
      expect(LOG_ROUTING[kind], `${kind}`).toBe('log');
    }
  });

  it('is PURE — it does not mutate the events it reads', () => {
    const before = JSON.parse(JSON.stringify(SAMPLE)) as typeof SAMPLE;
    logLines(ALL_KINDS.map((k) => SAMPLE[k]));
    expect(SAMPLE).toEqual(before);
  });

  it('preserves order across a whole step', () => {
    const events: GameEvent[] = [
      SAMPLE['encounter-start'], // pane — dropped
      SAMPLE.advantage,
      SAMPLE['skill-cast'],
      SAMPLE.victory,
    ];
    expect(logLines(events).map((l) => l.text)).toEqual([
      'The enemy gains the advantage.',
      'You cast Heavy Strike.',
      'Victory! +9 XP.',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The dice. Every event below comes out of the REAL `resolvePlayerAttack`.
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
// max(STR 2, DEX 0) = 2. `proficiency: 0` so the hand-written totals below are the whole story.
const RAPIER = getWeaponByName('Jiij Rapier 1')!;
const HERO: Attacker = {
  name: 'Hero',
  stats: { STR: 14, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  mods: { STR: 2, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
  hp: 20, maxHp: 20, xp: 0, armorClass: 12,
  skillCharges: 0, maxSkillCharges: 0,
  hitDie: { quantity: 1, sides: 10 },
  advantageDisadvantage: 0,
  activeConditions: [],
  proficiency: 0,
};
const AC13 = {
  name: 'Beast',
  stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  mods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
  hp: 30, maxHp: 30, xp: 1, armorClass: 13,
  skillCharges: 0, maxSkillCharges: 0,
  hitDie: { quantity: 1, sides: 8 },
  activeConditions: [],
};

/** The line the LOG builds for one real attack rolled from `draws`. */
function loggedAttack(draws: number[]): LogLine {
  const r = resolvePlayerAttack(HERO, AC13, RAPIER, 0, scriptedRng(draws));
  const event = r.events[r.events.length - 1]!;
  if (event.kind !== 'attack') throw new Error('expected an attack event');
  const lines = logLines([event as CombatEvent]);
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

describe('the player can see the dice again', () => {
  it('a hit carries the damage in the line and the whole roll in the detail', () => {
    // natural 15, +2 = 17 against AC 13 -> hit; the d8 lands on 4.
    const line = loggedAttack([face(15, 20), face(4, 8)]);
    expect(line.text).toContain('hit');
    expect(line.text).toContain('4');
    expect(line.detail).toBe('d20+2 = 17 vs AC 13 → hit, 1d8 = 4');
  });

  it('a critical says so, and shows both damage dice', () => {
    // natural 20 crits regardless of AC; two d8 rolls of 4 and 5 make 9.
    const line = loggedAttack([face(20, 20), face(4, 8), face(5, 8)]);
    expect(line.text).toContain('CRITICAL');
    expect(line.text).toContain('9');
    expect(line.detail).toBe('nat 20 → critical, 1d8 + 1d8 = 9');
  });

  it('a miss still explains itself — the roll it lost by, and no damage clause', () => {
    // natural 10, +2 = 12, one short of AC 13.
    const line = loggedAttack([face(10, 20)]);
    expect(line.text.toLowerCase()).toContain('miss');
    expect(line.detail).toBe('d20+2 = 12 vs AC 13 → miss');
  });

  it('only an ATTACK carries dice — nothing else invents a detail', () => {
    for (const kind of ALL_KINDS) {
      if (kind === 'attack' || LOG_ROUTING[kind] !== 'log') continue;
      expect(logLines([SAMPLE[kind]])[0]!.detail, `${kind}`).toBeUndefined();
    }
    // ...and the attack sample DOES carry one, or the sweep above proves nothing.
    expect(logLines([SAMPLE.attack])[0]!.detail).toBe('d20+1 = 6 vs AC 13 → miss');
  });
});

// ---------------------------------------------------------------------------
// The battle boundary — the log persists for a whole fight, then starts over.
// ---------------------------------------------------------------------------

describe('startsNewBattle', () => {
  it('is exactly the three events that can open a fight', () => {
    expect(new Set(BATTLE_OPENER_KINDS)).toEqual(
      new Set(['encounter-start', 'boss-encounter', 'final-battle-begins']),
    );
    expect(BATTLE_OPENER_KINDS).toHaveLength(3);
  });

  it('is true for each of them and false for every other kind', () => {
    for (const kind of ALL_KINDS) {
      const expected = BATTLE_OPENER_KINDS.includes(kind);
      expect(startsNewBattle([SAMPLE[kind]]), `${kind}`).toBe(expected);
    }
  });

  it('is false for an empty step, and true when an opener is anywhere in the list', () => {
    expect(startsNewBattle([])).toBe(false);
    expect(startsNewBattle([SAMPLE['act-intro'], SAMPLE['boss-encounter']])).toBe(true);
  });
});
