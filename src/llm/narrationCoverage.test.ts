// Narration COVERAGE — the completeness proof for `describeEvent` (FINDINGS.md G13), plus
// the run-scale invariants for G13 / G21 / G42 / G47.
//
// WHY THIS FILE EXISTS. `describeEvent` used to end in `default: return ''`, so a kind with
// no case was SILENT rather than a type error, and 34 of the 63 kinds had no case — including
// `skill-cast`, the player's own class action. The register enumerated eleven of them, twice,
// and was wrong both times. An enumeration that can go stale is not a fix, so completeness is
// PROVED here rather than asserted:
//
//   1. `describeEvent`'s `default:` branch is a `const _never: never = e` check, so a 64th
//      kind fails the BUILD (verified by hand: adding a throwaway kind to `gameEvent.ts`
//      produces `error TS2322: Type '{ kind: "..." }' is not assignable to type 'never'`).
//   2. `SAMPLE` below is a MAPPED TYPE over `GameEventKind`, so a missing key or a value that
//      is not really that union member is a COMPILE error, not a failing assertion.
//   3. `EXPECTED` is a `Record<GameEventKind, …>`, so the fact/silent decision must be made
//      for every kind too.
//
// A 64th kind therefore breaks three separate gates. That is the difference between a
// complete enumeration and one that merely claims to be.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - No real inference, ever. `src/llm` contains no model call — generation lives behind the
//    Electron IPC in `electron/llm.mjs`. The entire testable surface is the PROMPT, and
//    `buildNarrationPrompt(...).user` is byte-for-byte what the model is handed, so "the fact
//    reaches the model" is asserted on the prompt. No model, fake or real, is constructed.
//  - Deterministic seeded RNG. The run-scale sections drive the REAL `step` from a fixed set
//    of seeds through the shipped `heuristicPolicy` / `mercifulPolicy`. No randomness is
//    introduced here; no `Math.random`, no `Date.now`.
//  - Non-circular assertions. Every expected value is derived from the plan, from
//    GAME-DESIGN.md §22.1-22.2 / WORLD.md §8, or from the event's OWN input data — never
//    measured from the output and pasted back.

import { describe, it, expect } from 'vitest';
import { describeEvent, eventsToFacts } from './narrate.ts';
import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { Stats } from '../game/character.ts';

// ---------------------------------------------------------------------------------------
// The two compile-time-exhaustive maps
// ---------------------------------------------------------------------------------------

const STATS: Stats = { STR: 12, DEX: 11, CON: 13, INT: 10, WIS: 9, CHA: 8 };

/**
 * One real sample per event kind, built by hand. The mapped type forces every value to BE
 * the member it is keyed by, so this cannot drift from the union: add a kind and this map
 * stops compiling.
 *
 * Enemy names here deliberately avoid WORLD.md §0's reserved words, so the reserved-word
 * guard below tests the LITERALS this unit wrote rather than the fixture data.
 */
const SAMPLE: { [K in GameEventKind]: Extract<GameEvent, { kind: K }> } = {
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
  'potion-drunk': { kind: 'potion-drunk', healedTo: 20 },
  'potion-unavailable': { kind: 'potion-unavailable' },
  'potion-blocked': { kind: 'potion-blocked' },
  fled: { kind: 'fled' },
  'escape-failed': { kind: 'escape-failed', damage: 4 },
  'escape-impossible': { kind: 'escape-impossible' },
  spared: { kind: 'spared', enemyName: 'Scrap Warden' },
  'spare-unavailable': { kind: 'spare-unavailable' },
  victory: { kind: 'victory', xpGained: 5, extraRest: true, loot: [] },
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
  // ---- narrative (26) ----
  title: { kind: 'title' },
  intro: { kind: 'intro', header: 'STORY', lines: ['The capital of Absolution, 2100 . . .'] },
  'stats-rolled': { kind: 'stats-rolled', stats: STATS },
  'player-created': {
    kind: 'player-created',
    name: 'Zzyzx-Qwph',
    classId: 'Enforcer',
    maxHp: 12,
    armorClass: 11,
  },
  'encounter-start': { kind: 'encounter-start', enemyName: 'Feral Cryo Rat' },
  'rest-lore': { kind: 'rest-lore', title: 'A fragment', loreText: 'The lights were never on.' },
  'rest-taken': { kind: 'rest-taken', hpRestored: 5, hp: 15, maxHp: 20 },
  'rest-full': { kind: 'rest-full' },
  'rest-declined': { kind: 'rest-declined' },
  'no-rests': { kind: 'no-rests' },
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
};

/**
 * The classification, written out from the plan's §4.2 / §4.3 tables — INDEPENDENT of what
 * `describeEvent` actually does. `'fact'` means the kind must produce a non-empty clause;
 * `'silent'` means it must produce exactly `''` on purpose, for the reason recorded beside
 * its case in narrate.ts.
 */
const EXPECTED: Record<GameEventKind, 'fact' | 'silent'> = {
  // --- facts that shipped before G13 (29) ---
  intro: 'fact',
  'player-created': 'fact',
  'encounter-start': 'fact',
  'enemy-skill-used': 'fact',
  attack: 'fact',
  'condition-applied': 'fact',
  'condition-damage': 'fact',
  'player-unable-to-act': 'fact',
  'potion-drunk': 'fact',
  fled: 'fact',
  'escape-failed': 'fact',
  'escape-impossible': 'fact',
  victory: 'fact',
  defeat: 'fact',
  'rest-lore': 'fact',
  'rest-taken': 'fact',
  'rest-full': 'fact',
  'deal-offer': 'fact',
  'deal-taken': 'fact',
  'deal-declined': 'fact',
  'deal-unaffordable': 'fact',
  'chest-found': 'fact',
  'chest-loot': 'fact',
  'level-up': 'fact',
  'act-outro': 'fact',
  'act-intro': 'fact',
  'final-battle-begins': 'fact',
  ending: 'fact',
  'game-over': 'fact',
  // --- the 17 facts G13 adds ---
  'skill-cast': 'fact',
  detonate: 'fact',
  lifesteal: 'fact',
  'self-sacrifice': 'fact',
  'shield-gained': 'fact',
  'shield-absorbed': 'fact',
  revive: 'fact',
  spared: 'fact',
  'boss-summon': 'fact',
  'boss-minion-damage': 'fact',
  'boss-adapt': 'fact',
  'boss-encounter': 'fact',
  verdict: 'fact',
  'draft-offer': 'fact',
  'draft-picked': 'fact',
  'rest-declined': 'fact',
  'no-rests': 'fact',
  // --- the 17 deliberate silences ---
  'cast-unavailable': 'silent',
  'potion-unavailable': 'silent',
  'potion-blocked': 'silent',
  'spare-unavailable': 'silent',
  'consumable-unavailable': 'silent',
  'condition-onset': 'silent',
  'condition-heal': 'silent',
  'condition-skip': 'silent',
  'condition-expired': 'silent',
  advantage: 'silent',
  disadvantage: 'silent',
  'resource-changed': 'silent',
  'relic-triggered': 'silent',
  'consumable-used': 'silent',
  'stat-stolen': 'silent',
  title: 'silent',
  'stats-rolled': 'silent',
};

const ALL_KINDS = Object.keys(SAMPLE) as GameEventKind[];

/** The kinds that must produce NOTHING. Derived from the hand-written spec, not the code. */
export const DELIBERATELY_SILENT: ReadonlySet<GameEventKind> = new Set(
  ALL_KINDS.filter((k) => EXPECTED[k] === 'silent'),
);

/** The 17 kinds G13 gave a fact line to — the ones this unit actually wrote. */
const NEW_FACT_KINDS: readonly GameEventKind[] = [
  'skill-cast',
  'detonate',
  'lifesteal',
  'self-sacrifice',
  'shield-gained',
  'shield-absorbed',
  'revive',
  'spared',
  'boss-summon',
  'boss-minion-damage',
  'boss-adapt',
  'boss-encounter',
  'verdict',
  'draft-offer',
  'draft-picked',
  'rest-declined',
  'no-rests',
];

// ---------------------------------------------------------------------------------------
// U1-U2 — completeness and totality
// ---------------------------------------------------------------------------------------

describe('describeEvent covers every event kind (G13)', () => {
  it('the union really has 63 kinds', () => {
    // 37 CombatEvent members + 26 NarrativeEvent members, counted by hand from the two
    // union declarations in combatEvent.ts and gameEvent.ts. The mapped type guarantees
    // SAMPLE's keys ARE the union, so this anchors the size of the thing being covered.
    // (Note the count `src/render/format.test.ts` hard-codes is 52 — its own hand-list
    // omits the 11 M3/M6 combat kinds. That is a gap in that file, not in the union.)
    expect(ALL_KINDS).toHaveLength(37 + 26);
  });

  it('the classification is 46 facts and 17 deliberate silences', () => {
    // From the plan: 29 kinds already had a fact, G13 adds 17 more, and the other 17 are
    // silenced on purpose. 29 + 17 + 17 = 63.
    const facts = ALL_KINDS.filter((k) => EXPECTED[k] === 'fact');
    expect(facts).toHaveLength(29 + 17);
    expect(DELIBERATELY_SILENT.size).toBe(17);
    expect(NEW_FACT_KINDS).toHaveLength(17);
    for (const k of NEW_FACT_KINDS) expect(EXPECTED[k]).toBe('fact');
  });

  it('every kind produces a fact, or silence, exactly as classified', () => {
    for (const kind of ALL_KINDS) {
      const out = describeEvent(SAMPLE[kind]);
      if (EXPECTED[kind] === 'fact') {
        expect(out, `${kind} must produce a fact line`).not.toBe('');
      } else {
        expect(out, `${kind} must be deliberately silent`).toBe('');
      }
    }
  });

  it('is total and pure: a string for every kind, no throw, no mutation', () => {
    for (const kind of ALL_KINDS) {
      const before = JSON.parse(JSON.stringify(SAMPLE[kind])) as unknown;
      expect(() => describeEvent(SAMPLE[kind])).not.toThrow();
      expect(typeof describeEvent(SAMPLE[kind])).toBe('string');
      expect(SAMPLE[kind]).toEqual(before);
    }
  });
});

// ---------------------------------------------------------------------------------------
// U3-U6 — what the new fact lines must say
// ---------------------------------------------------------------------------------------

describe('attribution: the player and the enemy are never confused (G13)', () => {
  // The register's own case: Enforcer, seed 1, step 139 — the player casts Heavy Strike for
  // 10 and the enemy uses an identically-named skill in the same round. Before the fix the
  // facts read "The enemy unleashes Heavy Strike. The enemy connect for 3 harm." and the
  // model credited the player's biggest hit to the foe (1,395 steps did this).
  //
  // The expectation is derived from WORLD.md §8 [LOCKED] — second person for the player,
  // and there is no second voice — NOT from what the implementation happens to emit.
  const collision: GameEvent[] = [
    { kind: 'enemy-skill-used', skillId: 'heavyStrike', name: 'Heavy Strike' },
    {
      kind: 'skill-cast',
      subject: 'player',
      skillId: 'heavyStrike',
      name: 'Heavy Strike',
      damage: 10,
      damageSources: [{ kind: 'skill', amount: 10 }],
    },
  ];

  it('yields two distinct lines, exactly one of them second person', () => {
    const facts = eventsToFacts(collision);
    expect(facts).toHaveLength(2);
    expect(new Set(facts).size).toBe(2);
    const second = facts.filter((f) => /^You\b/.test(f));
    const third = facts.filter((f) => f.startsWith('The enemy'));
    expect(second).toHaveLength(1);
    expect(third).toHaveLength(1);
    expect(second[0]).toContain('Heavy Strike');
    expect(third[0]).toContain('Heavy Strike');
  });
});

describe('the eleven beats FINDINGS.md G13 names each reach the model (G13)', () => {
  // Each expectation is a substring of the event's OWN input data (a name, an amount) or a
  // grammatical person the doctrine fixes — never a phrase copied out of the output.
  const cases: readonly { kind: GameEventKind; mustContain: readonly string[] }[] = [
    { kind: 'skill-cast', mustContain: ['You', 'Heavy Strike', '10'] },
    { kind: 'boss-encounter', mustContain: ['Undercity Kingpin'] },
    { kind: 'verdict', mustContain: ['reckoning'] },
    { kind: 'spared', mustContain: ['You', 'Scrap Warden'] },
    { kind: 'draft-picked', mustContain: ['You', '+1 STR'] },
    { kind: 'draft-offer', mustContain: ['three'] },
    { kind: 'boss-minion-damage', mustContain: ['you', '4'] },
    { kind: 'lifesteal', mustContain: ['You', '5'] },
    { kind: 'self-sacrifice', mustContain: ['You', '4'] },
    { kind: 'boss-summon', mustContain: ['2'] },
    { kind: 'boss-adapt', mustContain: ['your'] },
  ];

  it('names all eleven', () => {
    expect(cases).toHaveLength(11);
  });

  for (const { kind, mustContain } of cases) {
    it(`${kind} produces a fact carrying its own data`, () => {
      const out = describeEvent(SAMPLE[kind]);
      expect(out.length).toBeGreaterThan(0);
      for (const needle of mustContain) expect(out).toContain(needle);
    });
  }
});

describe('the verdict leaks no karma (G13)', () => {
  // gameEvent.ts's own contract comment: the verdict event carries ONLY the outcome,
  // "NEVER a karma axis value/number (karma stays hidden)". The fact must not invent one.
  for (const outcome of ['grace', 'cast-down'] as const) {
    it(`${outcome} is second person, non-empty, and contains no digit`, () => {
      const out = describeEvent({ kind: 'verdict', outcome });
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toMatch(/\d/);
      expect(out.toLowerCase()).toMatch(/\byou(r)?\b/);
    });
  }

  it('the two outcomes are distinguishable', () => {
    expect(describeEvent({ kind: 'verdict', outcome: 'grace' })).not.toBe(
      describeEvent({ kind: 'verdict', outcome: 'cast-down' }),
    );
  });
});

describe("the reserved words are not spent on engine facts (WORLD.md §0)", () => {
  // §0 [LOCKED]: "never use 'hollow' casually anywhere in the game's text. It is the game's
  // load-bearing word. Reserve it." — and the grace ending "does not say made well, it says
  // MADE WHOLE... the win condition of the entire game stated in one word".
  const RESERVED = [/\bhollow\b/i, /made whole/i];

  // Two kinds are exempt, and the exemption is pinned so it cannot quietly grow:
  //  - `ending`   — "made whole" IS §0/§9's sanctioned thesis; it belongs there and nowhere
  //                 else, and the grace anchor is the one place the game may say it.
  //  - `chest-loot` — its empty-cache branch ships "but it is hollow", spending the
  //                 load-bearing word on an empty box. That is a PRE-EXISTING violation,
  //                 logged as FINDINGS.md C1 and owned by PLAN.md #13. This unit left the
  //                 line exactly as it shipped rather than silently rewriting authored text.
  //                 DELETE this entry when C1 lands.
  const EXEMPT: ReadonlySet<GameEventKind> = new Set<GameEventKind>(['ending', 'chest-loot']);

  it('exempts exactly two kinds, both for a written reason', () => {
    expect(EXEMPT.size).toBe(2);
  });

  it('no non-exempt fact line spends a reserved word', () => {
    for (const kind of ALL_KINDS) {
      if (EXEMPT.has(kind)) continue;
      const out = describeEvent(SAMPLE[kind]);
      for (const re of RESERVED) {
        expect(out, `${kind} must not spend a reserved word`).not.toMatch(re);
      }
    }
  });

  it('reaches BOTH branches of the kinds that vary their output', () => {
    // The guard above runs one fixture per kind; these are the branches a single fixture
    // cannot reach, checked explicitly so the coverage claim is honest.
    for (const re of RESERVED) {
      expect(describeEvent({ kind: 'verdict', outcome: 'cast-down' })).not.toMatch(re);
      expect(describeEvent({ kind: 'self-sacrifice', amount: 3, ofMaxHp: false })).not.toMatch(re);
      expect(
        describeEvent({
          kind: 'skill-cast',
          subject: 'player',
          skillId: 'ember',
          name: 'Ember',
          damage: 0,
          damageSources: [],
        }),
      ).not.toMatch(re);
      expect(
        describeEvent({ kind: 'act-intro', act: 3, header: 'ACT III', body: 'A body #13 wrote.' }),
      ).not.toMatch(re);
    }
  });
});

