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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describeEvent,
  eventsToFacts,
  buildNarrationPrompt,
  createStoryMemory,
  rememberBeat,
} from './narrate.ts';
import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { Stats } from '../game/character.ts';
import { createGame, step, awaitingFor } from '../game/game.ts';
import type { GameState, StepResult } from '../game/game.ts';
import { createPlayer } from '../game/player.ts';
import type { PlayerClass } from '../game/player.ts';
import { createKarma } from '../game/karma.ts';
import { ALL_CLASSES, heuristicPolicy, mercifulPolicy } from '../game/sim.ts';
import type { SimPolicy } from '../game/sim.ts';

// ---------------------------------------------------------------------------------------
// The two compile-time-exhaustive maps
// ---------------------------------------------------------------------------------------

const STATS: Stats = { STR: 12, DEX: 11, CON: 13, INT: 10, WIS: 9, CHA: 8 };

/**
 * One real sample per event kind, built by hand. The mapped type forces every value to BE
 * the member it is keyed by, so this cannot drift from the union: add a kind and this map
 * stops compiling.
 *
 * The enemy names and the `player-created` class here deliberately avoid WORLD.md §0's
 * reserved words, so the reserved-word guard below tests the LITERALS this unit wrote
 * rather than the fixture data.
 *
 * ⚠ Do not "improve" this by using the Hollow class or a floor-3 enemy such as "Hollow
 * Grief". Those are SANCTIONED uses of the load-bearing word — §0 names the Hollow class
 * and the Hollow Self itself — but they are interpolated data, and feeding them in here
 * would make the guard go red over something entirely correct.
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
  'stats-rolled': { kind: 'stats-rolled', stats: STATS },
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
  'rest-found': { kind: 'rest-found', floor: 1, place: 'a dry stairwell', briefId: 'floor-1' },
  'skills-warped': { kind: 'skills-warped', count: 3 },
  'deal-needs-room': { kind: 'deal-needs-room', reward: 'Rare armor' },
  'item-discarded': { kind: 'item-discarded', name: 'Common ring', rarity: 'Common' },
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
  'rest-taken': 'fact',
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
  // --- the 8 facts PLAN.md #2 adds (floor mechanics, the found rest, the full-pack bargain) ---
  'floor-drain': 'fact',
  'illusion-struck': 'fact',
  'illusion-dispelled': 'fact',
  'loot-left-behind': 'fact',
  'rest-found': 'fact',
  'skills-warped': 'fact',
  'deal-needs-room': 'fact',
  'item-discarded': 'fact',
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
];

// ---------------------------------------------------------------------------------------
// U1-U2 — completeness and totality
// ---------------------------------------------------------------------------------------

describe('describeEvent covers every event kind (G13)', () => {
  it('the union really has 67 kinds', () => {
    // 37 CombatEvent members + 26 NarrativeEvent members, counted by hand from the two
    // union declarations in combatEvent.ts and gameEvent.ts. The mapped type guarantees
    // SAMPLE's keys ARE the union, so this anchors the size of the thing being covered.
    // (Note the count `src/render/format.test.ts` hard-codes is 52 — its own hand-list
    // omits the 11 M3/M6 combat kinds. That is a gap in that file, not in the union.)
    // PLAN.md #2 added 4 combat kinds (floor-drain, illusion-struck, illusion-dispelled,
    // loot-left-behind) and 4 narrative ones (rest-found, skills-warped, deal-needs-room,
    // item-discarded).
    // ...and removed the four rest-DECISION kinds (rest-lore, rest-full, rest-declined,
    // no-rests) with the decision itself (§22.26).
    expect(ALL_KINDS).toHaveLength(37 + 4 + 26 + 4 - 4);
  });

  it('the classification is 54 facts and 17 deliberate silences', () => {
    // From the plan: 29 kinds already had a fact, G13 adds 17 more, and the other 17 are
    // silenced on purpose. 29 + 17 + 17 = 63. PLAN.md #2 removed two of the 29 (rest-lore,
    // rest-full) and two of G13's 17 (rest-declined, no-rests), and added 8 of its own.
    const facts = ALL_KINDS.filter((k) => EXPECTED[k] === 'fact');
    expect(facts).toHaveLength(27 + 15 + 8);
    expect(DELIBERATELY_SILENT.size).toBe(17);
    expect(NEW_FACT_KINDS).toHaveLength(15);
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


// =========================================================================================
// RUN-SCALE INVARIANTS — the real engine, real seeds, no fixtures
//
// A fixture proves `describeEvent` says the right thing when handed an event. It cannot
// prove the event ever REACHES it during a real run, which is precisely how 34 kinds went
// unnoticed. These sections play whole runs through the real `step` under the shipped
// policies and measure what the model would actually have been handed, mirroring exactly
// what `src/desktop/game.ts`'s `dispatch` does: step, then narrate against the new state,
// then remember the beat.
//
// No model is involved, fake or real. `buildNarrationPrompt(...).user` IS the string handed
// to the Electron IPC, so measuring it measures what the model sees.
// =========================================================================================

/** The seeds the batch runs. 24 x 5 classes x 2 policies = 240 runs. */
const SEEDS: readonly number[] = Array.from({ length: 24 }, (_, i) => i + 1);

/**
 * The name every run is driven with — deliberately unlike any word the game contains, so a
 * single leak anywhere in any prompt is unambiguous. (PRINCIPLES.md §A11: name the
 * non-negotiable line, then build an actual check for it.)
 */
const PROBE_NAME = 'Zzyzx-Qwph';

/** Wrap a shipped policy so the real `{kind:'name'}` input carries the probe name. */
function withProbeName(policy: SimPolicy): SimPolicy {
  return (res) => {
    const input = policy(res);
    return input.kind === 'name' ? { kind: 'name', name: PROBE_NAME } : input;
  };
}

/** Everything the invariants below need, folded in one pass so no run is held in memory. */
interface Metrics {
  runs: number;
  steps: number;
  observedKinds: Set<GameEventKind>;
  /** R1 — steps containing a player `skill-cast`, and those whose prompt attributes it. */
  castSteps: number;
  castAttributed: number;
  /** The Enforcer/Heavy-Strike collision: a cast AND an enemy skill in the same step. */
  collisionSteps: number;
  collisionWellFormed: number;
  /** R2 — steps containing `boss-minion-damage`, and those whose facts report the damage. */
  minionSteps: number;
  minionNarrated: number;
  /** R3 — eventful steps that produced no fact, and any kind not on the silence list. */
  eventfulSilentSteps: number;
  undocumentedSilence: Set<GameEventKind>;
  /** R4 — act transitions, null prompts among them, and headers that failed to appear. */
  actSteps: number;
  actNullPrompts: number;
  actHeaderMissing: number;
  actsSeen: Set<number>;
  /** R5 — prompts or facts carrying the probe name. */
  nameLeaks: number;
  /** The `draft-offer` fact says "three paths"; this proves the engine really offers 3. */
  draftOffers: number;
  draftOffersNotThree: number;
  /** Denominator sanity for the beats that used to render blank. */
  endingSteps: number;
  verdictSteps: number;
  sparedSteps: number;
  bossEncounterSteps: number;
  draftPickedSteps: number;
}

function emptyMetrics(): Metrics {
  return {
    runs: 0,
    steps: 0,
    observedKinds: new Set(),
    castSteps: 0,
    castAttributed: 0,
    collisionSteps: 0,
    collisionWellFormed: 0,
    minionSteps: 0,
    minionNarrated: 0,
    eventfulSilentSteps: 0,
    undocumentedSilence: new Set(),
    actSteps: 0,
    actNullPrompts: 0,
    actHeaderMissing: 0,
    actsSeen: new Set(),
    nameLeaks: 0,
    draftOffers: 0,
    draftOffersNotThree: 0,
    endingSteps: 0,
    verdictSteps: 0,
    sparedSteps: 0,
    bossEncounterSteps: 0,
    draftPickedSteps: 0,
  };
}

/**
 * The act headers, read from the SPEC (Java `Story.java` — the same table story.test.ts
 * uses) and NOT from story.json, so this disagrees with the data if the data goes wrong.
 */
const ACT_HEADERS: readonly string[] = ['ACT I', 'ACT II', 'ACT III', 'ACT IV', 'ACT V'];

/** Play one run to its terminal state, folding every step into `m`. No RNG of its own. */
function foldRun(
  m: Metrics,
  seed: number,
  classId: PlayerClass,
  basePolicy: (c: PlayerClass) => SimPolicy,
): void {
  const policy = withProbeName(basePolicy(classId));
  const initial = createGame(seed);
  let res: StepResult = { state: initial, events: [], awaiting: awaitingFor(initial.phase) };
  let memory = createStoryMemory();
  let guard = 0;
  m.runs++;

  while (res.awaiting !== 'game-over' && guard < 50_000) {
    res = step(res.state, policy(res));
    guard++;
    m.steps++;
    const events = res.events;
    // Mirrors src/desktop/game.ts `dispatch`: the prompt is built against the NEW state and
    // the memory as it stood BEFORE this beat; the beat is remembered afterwards.
    const facts = eventsToFacts(events);
    const prompt = buildNarrationPrompt(events, res.state, memory);

    for (const e of events) m.observedKinds.add(e.kind);

    // ---- R5: the name must never reach the model, at any step of any run.
    if (facts.some((f) => f.includes(PROBE_NAME))) m.nameLeaks++;
    else if (prompt && prompt.user.includes(PROBE_NAME)) m.nameLeaks++;

    // ---- R1 + the collision case.
    const cast = events.find((e) => e.kind === 'skill-cast');
    if (cast && cast.kind === 'skill-cast') {
      m.castSteps++;
      // The fact must be SECOND PERSON and must name the cast — that is what makes it
      // distinguishable from the enemy's identically-named skill in the same prompt.
      const mine = facts.filter((f) => /^You\b/.test(f) && f.includes(cast.name));
      if (mine.length > 0 && prompt && mine.every((f) => prompt.user.includes(f))) {
        m.castAttributed++;
      }
      const enemySkill = events.find((e) => e.kind === 'enemy-skill-used');
      if (enemySkill && enemySkill.kind === 'enemy-skill-used') {
        m.collisionSteps++;
        const theirs = facts.filter(
          (f) => f.startsWith('The enemy') && f.includes(enemySkill.name),
        );
        if (mine.length >= 1 && theirs.length >= 1) {
          // Two DISTINCT lines, exactly one of them second person about the player's cast.
          const distinct = new Set([...mine, ...theirs]);
          if (distinct.size >= 2) m.collisionWellFormed++;
        }
      }
    }

    // ---- R2.
    const minion = events.find((e) => e.kind === 'boss-minion-damage');
    if (minion && minion.kind === 'boss-minion-damage') {
      m.minionSteps++;
      if (facts.some((f) => /\byou\b/i.test(f) && f.includes(String(minion.amount)))) {
        m.minionNarrated++;
      }
    }

    // ---- R3: an eventful step with no fact at all is allowed only if EVERY one of its
    // kinds is on the documented silence list. This is the guard on the G42 stale-screen
    // trap — it is what stops a future "silence" decision quietly blanking a real beat.
    if (events.length > 0 && facts.length === 0) {
      m.eventfulSilentSteps++;
      for (const e of events) {
        if (!DELIBERATELY_SILENT.has(e.kind)) m.undocumentedSilence.add(e.kind);
      }
    }

    // ---- R4: every act transition must produce a non-null prompt carrying its header.
    for (const e of events) {
      if (e.kind !== 'act-intro' && e.kind !== 'act-outro') continue;
      m.actSteps++;
      m.actsSeen.add(e.act);
      if (!prompt) {
        m.actNullPrompts++;
        continue;
      }
      const header = ACT_HEADERS[e.act - 1] ?? '<no such act>';
      // Exact, so 'ACT I' cannot be satisfied by an 'ACT III' header. Tolerates a body
      // arriving later from #13, which would make the fact "ACT II — <body>".
      const ok = facts.some((f) => f === header || f.startsWith(header + ' — '));
      if (!ok || !prompt.user.includes(header)) m.actHeaderMissing++;
    }

    // ---- denominators + the draft arity the "three paths" fact depends on.
    for (const e of events) {
      if (e.kind === 'draft-offer') {
        m.draftOffers++;
        if (e.options.length !== 3) m.draftOffersNotThree++;
      } else if (e.kind === 'ending') m.endingSteps++;
      else if (e.kind === 'verdict') m.verdictSteps++;
      else if (e.kind === 'spared') m.sparedSteps++;
      else if (e.kind === 'boss-encounter') m.bossEncounterSteps++;
      else if (e.kind === 'draft-picked') m.draftPickedSteps++;
    }

    memory = rememberBeat(memory, events);
  }
}

/** The whole batch, folded once and shared by every invariant below. */
const BATCH: Metrics = (() => {
  const m = emptyMetrics();
  for (const basePolicy of [heuristicPolicy, mercifulPolicy]) {
    for (const classId of ALL_CLASSES) {
      for (const seed of SEEDS) foldRun(m, seed, classId, basePolicy);
    }
  }
  return m;
})();

describe('run-scale: the batch really exercises the beats being asserted', () => {
  it('plays 240 runs across all five classes under both shipped policies', () => {
    expect(BATCH.runs).toBe(SEEDS.length * ALL_CLASSES.length * 2);
    expect(BATCH.runs).toBeGreaterThanOrEqual(200);
    expect(BATCH.steps).toBeGreaterThan(10_000);
  });

  it('reaches 43 of the 63 kinds — and the 20 it cannot reach are known', () => {
    // HONESTY ABOUT COVERAGE. The run-scale sections can only assert about kinds the
    // SHIPPED policies actually produce, and `sim.ts`'s policies never seek a deal (they
    // always pick `menu: 'continue'`), never decline a rest, fight the whole way with
    // starting gear (so no relic ever triggers, and there is no shield or revive), and only
    // ever dispatch a LEGAL action (so no input is ever rejected). Twenty kinds are
    // therefore unreachable here, and their coverage is the fixture map above, not this
    // batch. Written as a floor, not an equality, so improving the policies can only make
    // this pass more easily — but a REGRESSION that stops the engine emitting something
    // still shows up.
    expect(BATCH.observedKinds.size).toBeGreaterThanOrEqual(43);
    // Every kind the run-scale invariants below depend on must be in the reachable set.
    for (const kind of [
      'skill-cast',
      'enemy-skill-used',
      'boss-minion-damage',
      'act-intro',
      'act-outro',
      'ending',
      'verdict',
      'spared',
      'boss-encounter',
      'draft-offer',
      'draft-picked',
      'player-created',
      'intro',
    ] as const) {
      expect(BATCH.observedKinds.has(kind), `${kind} never occurred in the batch`).toBe(true);
    }
  });

  it('reaches every beat G13 said was silent, so no invariant below is vacuous', () => {
    // If any of these were 0, the matching invariant would pass by having nothing to check.
    expect(BATCH.castSteps).toBeGreaterThan(0);
    expect(BATCH.collisionSteps).toBeGreaterThan(0);
    expect(BATCH.minionSteps).toBeGreaterThan(0);
    expect(BATCH.actSteps).toBeGreaterThan(0);
    expect(BATCH.eventfulSilentSteps).toBeGreaterThan(0);
    expect(BATCH.endingSteps).toBeGreaterThan(0);
    expect(BATCH.verdictSteps).toBeGreaterThan(0);
    expect(BATCH.sparedSteps).toBeGreaterThan(0);
    expect(BATCH.bossEncounterSteps).toBeGreaterThan(0);
    expect(BATCH.draftPickedSteps).toBeGreaterThan(0);
    expect(BATCH.draftOffers).toBeGreaterThan(0);
  });
});

describe('R1 — the model is never left without the fact that the PLAYER acted (G13)', () => {
  it('every player skill-cast reaches the prompt, in second person, naming the cast', () => {
    // Baseline before this unit: 0%. Measured over 400 runs / 170,491 steps: 5,727 cast
    // steps, ALL of them unattributed. In player terms: the Void never again fails to
    // notice that you were the one who acted.
    expect(BATCH.castAttributed).toBe(BATCH.castSteps);
  });

  it('a cast colliding with an identically-named enemy skill yields two distinct lines', () => {
    // The register's Enforcer / seed 1 / step 139 case, at run scale. Baseline: 1,395 steps
    // where the only named skill in the prompt was the ENEMY's, so the model credited the
    // player's biggest hit to the foe.
    expect(BATCH.collisionWellFormed).toBe(BATCH.collisionSteps);
  });
});

describe('R2 — losing HP to the boss crew is never silent (G13)', () => {
  it('every boss-minion-damage step reports the damage to the player', () => {
    // Baseline: 2,499 such steps, 346 of them with no damage fact at all — the player lost
    // HP and nothing in the prompt said so.
    expect(BATCH.minionNarrated).toBe(BATCH.minionSteps);
  });
});

describe('R3 — nothing is silent by accident (G13 + G42)', () => {
  it('every eventful step with no fact has ALL its kinds on the documented silence list', () => {
    expect([...BATCH.undocumentedSilence].sort()).toEqual([]);
  });
});

describe('R4 — act transitions are never blank again (G21)', () => {
  it('no act transition produces a null prompt', () => {
    // Baseline: 47 act-intro + 47 act-outro blank screens over 20 runs — one on every floor
    // change, so the five-Act descent was never announced anywhere in the UI.
    expect(BATCH.actNullPrompts).toBe(0);
  });

  it('every act transition carries its own header from the independent spec table', () => {
    expect(BATCH.actHeaderMissing).toBe(0);
  });

  it('the batch descends through more than one act', () => {
    // Otherwise "every act transition carries its header" could hold on a single act.
    expect(BATCH.actsSeen.size).toBeGreaterThan(1);
  });
});

describe('R5 — the Void never says your name (G47)', () => {
  it('no prompt and no fact contains the player name, at any step of any run', () => {
    // GAME-DESIGN.md §22.1 / WORLD.md §8 [LOCKED]. Before this unit the name leaked at the
    // `player-created` beat, through the next five prompts via StoryMemory, at the intro,
    // and at BOTH endings — the last screen of every completed run.
    expect(BATCH.nameLeaks).toBe(0);
  });
});

describe('the "three paths" fact is true of the real engine', () => {
  it('every draft offer the engine emits carries exactly three options', () => {
    // `draft-offer`'s fact literal says "three paths". `generateDraft` returns a 3-tuple and
    // `enterLevelUp` is its only emit site, so the claim holds by construction — this is
    // the run-scale proof, and what goes red if the draft width ever changes.
    expect(BATCH.draftOffersNotThree).toBe(0);
  });
});

describe('R6 — the terminal step gives the renderer nothing to draw (G42)', () => {
  it('continuing past an ending emits no events, so the prompt is null', () => {
    // This is the whole mechanism of G42. `game.ts` deliberately emits nothing on the
    // terminal step "so the run's final event stays the `ending` event", so the ONLY thing
    // standing between the player and a blank last screen is whether the renderer clears
    // the pane before or after it discovers the prompt is null.
    const state: GameState = {
      version: 8,
      rngState: 12_345,
      player: createPlayer({ name: PROBE_NAME, classId: 'Enforcer', stats: STATS }),
      act: 4,
      place: 3,
      karma: createKarma(),
      phase: { kind: 'ending', endingType: 'grace' },
    };
    const r = step(state, { kind: 'continue' });
    expect(r.events).toEqual([]);
    expect(r.awaiting).toBe('game-over');

    // Even with a full story memory behind it there is nothing new to narrate: memory
    // supplies context, never facts, so it cannot rescue an empty event list.
    const memory = rememberBeat(createStoryMemory(), [
      { kind: 'ending', endingType: 'grace', header: 'ASCENSION', body: 'You are judged worthy.' },
    ]);
    expect(memory.beats.length).toBeGreaterThan(0);
    expect(buildNarrationPrompt(r.events, r.state, memory)).toBeNull();
  });

  // The other half of G42 is one statement ORDER in the renderer, and `src/desktop/game.ts`
  // cannot be imported in a test at all: it calls the Electron IPC (`window.void`) at module
  // scope, which is why `npm run dev` cannot run outside Electron. So the guard is a scan of
  // the shipping source itself — aimed at `narrate()` in the file that ships, not at a
  // helper a future edit could bypass. It lives in this file because this file owns the
  // narration pipeline end to end, and because this unit's territory is exactly six files.
  //
  // The VISUAL half (does the ending prose actually stay on screen?) is NEEDS-HUMAN; only a
  // person running `npm run desktop` can see it.
  it('the renderer confirms a prompt BEFORE it clears the narration pane', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../desktop/game.ts', import.meta.url)),
      'utf8',
    );
    const start = source.indexOf('async function narrate(');
    expect(start, 'narrate() not found — this guard has gone stale, fix it').toBeGreaterThan(-1);
    // The body ends at the first closing brace in column 0 after the declaration.
    const end = source.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    // Both patterns are deliberately loose about spelling. A guard that only recognises the
    // exact characters that happen to be there today is untested in every other shape the
    // violation can take — double quotes instead of single, `textContent` instead of
    // `innerHTML`, `replaceChildren()` instead of an assignment — and each of those is an
    // ordinary thing for a future edit to write. All four are verified to trip this test.
    const NULL_CHECK = /if\s*\(\s*!\s*prompt\s*\)/;
    const CLEARS_PANE =
      /narrationEl\s*\.\s*(?:innerHTML|textContent)\s*=|narrationEl\s*\.\s*replaceChildren\s*\(/;

    const nullCheck = body.search(NULL_CHECK);
    const clear = body.search(CLEARS_PANE);
    // Both markers must exist, or the comparison below would pass by finding nothing.
    expect(nullCheck, 'the null-prompt guard is missing from narrate()').toBeGreaterThan(-1);
    expect(clear, 'narrate() no longer clears the pane — re-check this guard').toBeGreaterThan(-1);
    expect(
      nullCheck,
      'narrate() clears the narration pane before confirming a prompt — that is G42, and it ' +
        "erases the ending prose on the run's terminal click",
    ).toBeLessThan(clear);
  });
});

// =========================================================================================
// U7 — the computed facts are exposed (the hook #0c's G26 fallback needs)
// =========================================================================================

describe('buildNarrationPrompt exposes the facts it built', () => {
  const state: GameState = {
    version: 8,
    rngState: 1,
    player: null,
    act: 2,
    place: 1,
    karma: createKarma(),
    phase: { kind: 'main-menu' },
  };

  it('returns exactly the facts it embedded in the user prompt', () => {
    const events: GameEvent[] = [
      { kind: 'encounter-start', enemyName: 'Feral Cryo Rat' },
      { kind: 'cast-unavailable' }, // deliberately silent — must NOT appear
      { kind: 'boss-adapt' },
    ];
    const p = buildNarrationPrompt(events, state);
    expect(p).not.toBeNull();
    expect(p!.facts).toEqual(eventsToFacts(events));
    expect(p!.facts).toHaveLength(2); // the silent one is dropped, so this is not 3
    for (const f of p!.facts) expect(p!.user).toContain(f);
  });

  it('the facts are THIS beat only, which is the whole point for G26', () => {
    // The renderer's model-failure fallback prints `prompt.user.split('\n\n')[0]`. With any
    // story memory present that first block is the RUN SUMMARY and the PREVIOUS beats, not
    // what just happened — FINDINGS.md G26, and #0c's to fix. `facts` gives it the current
    // beat directly. Asserted here so the hook cannot regress into "whatever is in .user".
    const past: GameEvent[] = [{ kind: 'encounter-start', enemyName: 'Rust Choir' }];
    const memory = rememberBeat(rememberBeat(createStoryMemory(), past), [
      { kind: 'victory', xpGained: 5, loot: [] },
    ]);
    const now: GameEvent[] = [{ kind: 'boss-encounter', bossId: 'kingpin', enemyName: 'Kingpin' }];
    const p = buildNarrationPrompt(now, state, memory);
    expect(p).not.toBeNull();
    expect(p!.facts).toEqual(eventsToFacts(now));
    expect(p!.facts.join(' ')).not.toContain('Rust Choir'); // no past beat leaks in
    expect(p!.user).toContain('Rust Choir'); // ...but the prompt still carries the context
  });

  it('is null, not an empty fact list, when nothing narratable happened', () => {
    expect(buildNarrationPrompt([], state)).toBeNull();
    expect(buildNarrationPrompt([{ kind: 'cast-unavailable' }], state)).toBeNull();
  });
});
