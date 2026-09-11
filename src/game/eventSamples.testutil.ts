// ONE sample of EVERY game event kind — shared by the guards that must cover them all.
//
// Moved out of `src/llm/narrationCoverage.test.ts` (FIX ROUND 1, F4) so the hidden-karma guard
// can sweep every kind's rendered surfaces from the SAME type-exhaustive table the narration-
// coverage proof uses: a new event kind stops this file compiling, and both guards cover it the
// moment it does.
// A test utility — it ships nowhere.

import type { GameEvent, GameEventKind } from './gameEvent.ts';
import type { Stats } from './character.ts';

/** The stats the `stats-rolled` sample carries (and narrationCoverage's probe player). */
export const SAMPLE_STATS: Stats = { STR: 12, DEX: 11, CON: 13, INT: 10, WIS: 9, CHA: 8 };

/**
 * One real sample per event kind, built by hand. The mapped type forces every value to BE
 * the member it is keyed by, so this cannot drift from the union: add a kind and this map
 * stops compiling.
 *
 * The enemy names and the `player-created` class here deliberately avoid WORLD.md §0's
 * reserved words, so the reserved-word guard (narrationCoverage) tests the LITERALS it wrote
 * rather than the fixture data.
 *
 * ⚠ Do not "improve" this by using the Hollow class or a floor-3 enemy such as "Hollow
 * Grief". Those are SANCTIONED uses of the load-bearing word — §0 names the Hollow class
 * and the Hollow Self itself — but they are interpolated data, and feeding them in here
 * would make the guard go red over something entirely correct.
 */
export const ONE_OF_EVERY_EVENT: { [K in GameEventKind]: Extract<GameEvent, { kind: K }> } = {
  // ---- combat (37) ----
  'enemy-skill-used': { kind: 'enemy-skill-used', skillId: 'heavyStrike', name: 'Heavy Strike' },
  'skill-cast': {
    kind: 'skill-cast',
    subject: 'player',
    skillId: 'heavyStrike',
    name: 'Heavy Strike',
    damage: 10,
    damageSources: [{ kind: 'skill', amount: 10 }],
  },
  'cast-unavailable': { kind: 'cast-unavailable' },
  attack: {
    kind: 'attack',
    subject: 'player',
    outcome: 'hit',
    damage: 3,
    roll: { natural: 15, faces: [15], advDis: 0, modifier: 2, total: 17, targetAc: 13 },
    damageSources: [{ kind: 'weapon-dice', amount: 3, label: '1d8' }],
  },
  advantage: { kind: 'advantage', subject: 'player' },
  disadvantage: { kind: 'disadvantage', subject: 'enemy' },
  'player-unable-to-act': { kind: 'player-unable-to-act', conditionType: 'stun' },
  'condition-onset': { kind: 'condition-onset', subject: 'enemy', conditionType: 'burn' },
  'condition-damage': {
    kind: 'condition-damage',
    subject: 'enemy',
    conditionType: 'burn',
    amount: 2,
  },
  'condition-heal': {
    kind: 'condition-heal',
    subject: 'player',
    conditionType: 'regeneration',
    amount: 2,
  },
  'condition-skip': { kind: 'condition-skip', subject: 'player', conditionType: 'sleep' },
  'condition-applied': { kind: 'condition-applied', subject: 'enemy', conditionType: 'freeze' },
  'condition-expired': { kind: 'condition-expired', subject: 'enemy', conditionType: 'freeze' },
  'resource-changed': {
    kind: 'resource-changed',
    subject: 'player',
    resource: 'momentum',
    value: 3,
  },
  'self-sacrifice': { kind: 'self-sacrifice', amount: 4, ofMaxHp: true },
  lifesteal: { kind: 'lifesteal', amount: 5 },
  detonate: { kind: 'detonate', consumed: 2, bonusDamage: 6 },
  fled: { kind: 'fled' },
  'escape-failed': { kind: 'escape-failed', damage: 4 },
  'escape-impossible': { kind: 'escape-impossible' },
  spared: { kind: 'spared', enemyName: 'Scrap Warden' },
  'spare-unavailable': { kind: 'spare-unavailable' },
  victory: { kind: 'victory', xpGained: 5, loot: [] },
  defeat: { kind: 'defeat' },
  'relic-triggered': { kind: 'relic-triggered', trigger: 'onHit', action: 'dealDamage' },
  'consumable-used': { kind: 'consumable-used', itemId: 'clarity-draught' },
  'consumable-unavailable': { kind: 'consumable-unavailable' },
  'shield-gained': { kind: 'shield-gained', amount: 6 },
  'shield-absorbed': { kind: 'shield-absorbed', amount: 4 },
  revive: { kind: 'revive', healedTo: 7 },
  'stat-stolen': { kind: 'stat-stolen', stat: 'STR', amount: 1 },
  'boss-summon': { kind: 'boss-summon', minions: 2 },
  'boss-minion-damage': { kind: 'boss-minion-damage', amount: 4 },
  'boss-adapt': { kind: 'boss-adapt' },
  // PLAN.md #2 (combat)
  'floor-drain': { kind: 'floor-drain', resource: 'skillCharge', amount: 1 },
  'illusion-struck': { kind: 'illusion-struck' },
  'illusion-dispelled': { kind: 'illusion-dispelled', natural: 13, modifier: 1, total: 14, dc: 13 },
  'loot-left-behind': { kind: 'loot-left-behind', name: 'Rare ring', rarity: 'Rare' },
  // ---- narrative (26) ----
  title: { kind: 'title' },
  intro: { kind: 'intro', header: 'STORY', lines: ['The capital of Absolution, 2100 . . .'] },
  'stats-rolled': { kind: 'stats-rolled', stats: SAMPLE_STATS },
  'player-created': {
    kind: 'player-created',
    name: 'Zzyzx-Qwph',
    classId: 'Enforcer',
    maxHp: 12,
    armorClass: 11,
  },
  'encounter-start': { kind: 'encounter-start', enemyName: 'Feral Cryo Rat' },
  'rest-taken': { kind: 'rest-taken', hpRestored: 5, hp: 15, maxHp: 20 },
  'deal-offer': {
    kind: 'deal-offer',
    pool: 'standard',
    cost: '8 HP',
    reward: '12 HP restored',
  },
  'deal-taken': { kind: 'deal-taken', cost: '8 HP', reward: '12 HP restored' },
  'deal-unaffordable': { kind: 'deal-unaffordable', cost: 'a relic' },
  'deal-declined': { kind: 'deal-declined' },
  'chest-found': { kind: 'chest-found' },
  'chest-loot': {
    kind: 'chest-loot',
    loot: [{ defId: 'gen:Common:ring', name: 'Common ring', rarity: 'Common' }],
  },
  'act-outro': { kind: 'act-outro', act: 1, header: 'ACT I', body: '' },
  'level-up': { kind: 'level-up', newLevel: 2, hpRoll: 4, newMaxHp: 16 },
  'draft-offer': { kind: 'draft-offer', options: ['Learn Heavy Strike', '+1 STR', '+1 CON'] },
  'draft-picked': { kind: 'draft-picked', option: '+1 STR' },
  'act-intro': { kind: 'act-intro', act: 2, header: 'ACT II', body: '' },
  'final-battle-begins': { kind: 'final-battle-begins', enemyName: 'The Reflection' },
  'boss-encounter': {
    kind: 'boss-encounter',
    bossId: 'kingpin',
    enemyName: 'Undercity Kingpin',
  },
  verdict: { kind: 'verdict', outcome: 'grace' },
  ending: {
    kind: 'ending',
    endingType: 'grace',
    header: 'ASCENSION',
    body: 'You are judged worthy and rise from the Void, made whole.',
  },
  'game-over': { kind: 'game-over', xp: 42 },
  // PLAN.md #2 (narrative)
  'rest-found': { kind: 'rest-found', floor: 1, place: 'a dry stairwell', briefId: 'floor-1', woundsClosed: true, conditionsEased: false },
  'skills-warped': { kind: 'skills-warped', count: 3 },
  'deal-needs-room': { kind: 'deal-needs-room', reward: 'Rare armor' },
  'item-discarded': { kind: 'item-discarded', name: 'Common ring', rarity: 'Common' },
};
