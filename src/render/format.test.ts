// Unit tests for player-facing text formatting. Every expected substring is derived
// from the design (numbers/words chosen by hand), never measured from the output.

import { describe, it, expect } from 'vitest';
import { formatEvent, formatRollDetail, hpText } from './format.ts';
import { resolvePlayerAttack, type Attacker } from '../game/combat.ts';
import { getWeaponByName } from '../game/weapon.ts';
import type { CombatEvent } from '../game/combatEvent.ts';
import { mulberry32, type Rng } from '../game/rng.ts';
import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { Stats, Character } from '../game/character.ts';
import type { TriggerType } from '../game/item.ts';
import {
  CONDITION_DATA,
  INSANITY_STRINGS,
  makeCondition,
  tickConditions,
  type ActiveCondition,
  type ConditionType,
} from '../game/condition.ts';

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

// ---------------------------------------------------------------------------
// Totality over the whole GameEvent union.
//
// WHY THIS IS A MAPPED TYPE NOW. This block used to carry a hand-written `ALL_KINDS`
// array and assert `toHaveLength(52)`. Both were WRONG: the union has 63 members and the
// list omitted eleven (`resource-changed`, `self-sacrifice`, `lifesteal`, `detonate`,
// `relic-triggered`, `consumable-used`, `consumable-unavailable`, `shield-gained`,
// `shield-absorbed`, `revive`, `stat-stolen`) — every M3 class-twist and M6 item event.
// The two errors CANCELLED: the samples array was short by exactly the same eleven, so
// `new Set(samples) === new Set(ALL_KINDS)` held and the hard-coded 52 agreed with it.
// A hand-count that can be wrong in two places at once proves nothing.
//
// `SAMPLES` below is a MAPPED TYPE over `GameEventKind`, so a missing key is a COMPILE
// error and each value must really BE the member it is keyed by. `ALL_KINDS` is then
// derived from its keys, so the two can no longer disagree. The only number still written
// by hand is the union SIZE, and it is stated as its two independently-countable
// addends (37 combat + 26 narrative) rather than one opaque total.
// ---------------------------------------------------------------------------

const SAMPLES: { [K in GameEventKind]: Extract<GameEvent, { kind: K }> } = {
  // ---- combat (37) ----
  'enemy-skill-used': { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
  // A pure-condition cast: 0 damage, and therefore no damage terms at all.
  'skill-cast': {
    kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember', damage: 0,
    damageSources: [],
  },
  'cast-unavailable': { kind: 'cast-unavailable' },
  attack: {
    kind: 'attack', subject: 'player', outcome: 'hit', damage: 3,
    roll: { natural: 15, faces: [15], advDis: 0, modifier: 2, total: 17, targetAc: 13 },
    damageSources: [{ kind: 'weapon-dice', amount: 3, label: '1d8' }],
  },
  advantage: { kind: 'advantage', subject: 'player' },
  disadvantage: { kind: 'disadvantage', subject: 'enemy' },
  'player-unable-to-act': { kind: 'player-unable-to-act', conditionType: 'stun' },
  'condition-onset': { kind: 'condition-onset', subject: 'enemy', conditionType: 'burn' },
  'condition-damage': { kind: 'condition-damage', subject: 'enemy', conditionType: 'burn', amount: 2 },
  'condition-heal': { kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2 },
  'condition-skip': { kind: 'condition-skip', subject: 'player', conditionType: 'sleep' },
  'condition-applied': { kind: 'condition-applied', subject: 'enemy', conditionType: 'freeze' },
  'condition-expired': { kind: 'condition-expired', subject: 'enemy', conditionType: 'freeze' },
  // The eleven the old hand-list omitted.
  'resource-changed': { kind: 'resource-changed', subject: 'player', resource: 'momentum', value: 3 },
  'self-sacrifice': { kind: 'self-sacrifice', amount: 4, ofMaxHp: true },
  lifesteal: { kind: 'lifesteal', amount: 5 },
  detonate: { kind: 'detonate', consumed: 2, bonusDamage: 6 },
  'potion-drunk': { kind: 'potion-drunk', healedTo: 20 },
  'potion-unavailable': { kind: 'potion-unavailable' },
  'potion-blocked': { kind: 'potion-blocked' },
  fled: { kind: 'fled' },
  'escape-failed': { kind: 'escape-failed', damage: 4 },
  'escape-impossible': { kind: 'escape-impossible' },
  spared: { kind: 'spared', enemyName: 'Grief' },
  'spare-unavailable': { kind: 'spare-unavailable' },
  victory: { kind: 'victory', xpGained: 5, extraRest: true, loot: [] },
  defeat: { kind: 'defeat' },
  'relic-triggered': { kind: 'relic-triggered', trigger: 'onHit', action: 'dealDamage' },
  'consumable-used': { kind: 'consumable-used', itemId: 'void-draught' },
  'consumable-unavailable': { kind: 'consumable-unavailable' },
  'shield-gained': { kind: 'shield-gained', amount: 5 },
  'shield-absorbed': { kind: 'shield-absorbed', amount: 3 },
  revive: { kind: 'revive', healedTo: 8 },
  'stat-stolen': { kind: 'stat-stolen', stat: 'STR', amount: 1 },
  'boss-summon': { kind: 'boss-summon', minions: 2 },
  'boss-minion-damage': { kind: 'boss-minion-damage', amount: 4 },
  'boss-adapt': { kind: 'boss-adapt' },
  // ---- narrative (26) ----
  title: { kind: 'title' },
  intro: { kind: 'intro', header: 'H', lines: ['a', 'b'] },
  'stats-rolled': { kind: 'stats-rolled', stats: STATS },
  'player-created': { kind: 'player-created', name: 'X', classId: 'Enforcer', maxHp: 12, armorClass: 11 },
  'encounter-start': { kind: 'encounter-start', enemyName: 'Beast' },
  'rest-lore': { kind: 'rest-lore', title: 'T', loreText: 'L' },
  'rest-taken': { kind: 'rest-taken', hpRestored: 5, hp: 15, maxHp: 20 },
  'rest-full': { kind: 'rest-full' },
  'rest-declined': { kind: 'rest-declined' },
  'no-rests': { kind: 'no-rests' },
  'deal-offer': { kind: 'deal-offer', pool: 'standard', cost: '8 HP', reward: '12 HP restored' },
  'deal-taken': { kind: 'deal-taken', cost: '8 HP', reward: '12 HP restored' },
  'deal-unaffordable': { kind: 'deal-unaffordable', cost: 'a relic' },
  'deal-declined': { kind: 'deal-declined' },
  'chest-found': { kind: 'chest-found' },
  'chest-loot': {
    kind: 'chest-loot',
    loot: [{ defId: 'gen:Common:ring', name: 'Common ring', rarity: 'Common' }],
  },
  'act-outro': { kind: 'act-outro', act: 1, header: 'H', body: 'B' },
  'level-up': { kind: 'level-up', newLevel: 2, hpRoll: 4, newMaxHp: 16 },
  'draft-offer': { kind: 'draft-offer', options: ['Learn Intimidate', '+1 STR'] },
  'draft-picked': { kind: 'draft-picked', option: '+1 STR' },
  'act-intro': { kind: 'act-intro', act: 2, header: 'H', body: 'B' },
  'final-battle-begins': { kind: 'final-battle-begins', enemyName: 'Boss' },
  'boss-encounter': { kind: 'boss-encounter', bossId: 'kingpin', enemyName: 'Undercity Kingpin' },
  verdict: { kind: 'verdict', outcome: 'grace' },
  ending: { kind: 'ending', endingType: 'grace', header: 'H', body: 'B' },
  'game-over': { kind: 'game-over', xp: 42 },
};

/** Derived from the mapped type's keys, so it cannot fall behind the union. */
export const ALL_KINDS = Object.keys(SAMPLES) as GameEventKind[];

describe('formatEvent — totality over every event kind', () => {
  it('the sample map really covers the union (37 combat + 26 narrative)', () => {
    // Counted from the two union declarations in combatEvent.ts and gameEvent.ts. The
    // mapped type already guarantees the KEYS are the union; this anchors its SIZE, so a
    // kind quietly deleted from the union would not shrink the guarantee unnoticed.
    // (`src/llm/narrationCoverage.test.ts` counts the same 37 + 26 independently.)
    expect(ALL_KINDS).toHaveLength(37 + 26);
    for (const kind of ALL_KINDS) expect(SAMPLES[kind].kind).toBe(kind);
  });

  it('yields a non-empty string for every kind', () => {
    for (const kind of ALL_KINDS) {
      const s = formatEvent(SAMPLES[kind]);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('never prints an internal enum id the union carries', () => {
    // `relic-triggered` used to read "A relic answers (onHit)." and `consumable-used`
    // "You use void-draught." — raw internal ids in player prose (the C9 family). Both
    // were invisible before this unit: nothing rendered the log, and no consumable could
    // be found. Asserted on the shipped SAMPLES rather than a bespoke fixture.
    expect(formatEvent(SAMPLES['relic-triggered'])).not.toContain('onHit');
    expect(formatEvent(SAMPLES['consumable-used'])).not.toContain('void-draught');
    expect(formatEvent(SAMPLES['consumable-used'])).toContain('Void Draught');
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND 1 — `relic-triggered` for ALL SIX triggers.
//
// The sample above covers `onHit` only, so reverting the line to
// `` `A relic answers (${e.trigger}).` `` passed all 1290 tests. The plan's "no raw id
// reaches the player" sweep checks the relic / consumable / unique / condition / feat / boss
// id sets — and `TriggerType` ids are in none of them. The `Record<TriggerType, string>` in
// `format.ts` makes a SEVENTH trigger a build error; it does not make the table's USE
// mandatory. That is the gap.
//
// `EXPECTED_TRIGGER_LINE` is itself a `Record<TriggerType, string>`, so this test is
// exhaustive by construction too — and its values are the full sentences, written out by
// hand from the design intent rather than imported from `TRIGGER_MOMENT`. Importing the
// table would compare the implementation against itself and prove nothing.
// ---------------------------------------------------------------------------

const EXPECTED_TRIGGER_LINE: Record<TriggerType, string> = {
  startOfBattle: 'A relic answers as the battle opens.',
  onHit: 'A relic answers as your blow lands.',
  onCrit: 'A relic answers as your blow lands true.',
  onCast: 'A relic answers as you cast.',
  onKill: 'A relic answers as the enemy falls.',
  onTakeDamage: 'A relic answers as you are struck.',
};

describe('relic-triggered renders a phrase, never the trigger id', () => {
  const TRIGGERS = Object.keys(EXPECTED_TRIGGER_LINE) as TriggerType[];

  it('the six triggers are all covered (a seventh would not compile)', () => {
    expect(TRIGGERS).toHaveLength(6);
  });

  it('every trigger renders its authored sentence exactly', () => {
    for (const trigger of TRIGGERS) {
      expect(
        formatEvent({ kind: 'relic-triggered', trigger, action: 'dealDamage' }),
        `${trigger} does not render its authored phrase`,
      ).toBe(EXPECTED_TRIGGER_LINE[trigger]);
    }
  });

  it('and none of them leaks the raw enum id', () => {
    for (const trigger of TRIGGERS) {
      const line = formatEvent({ kind: 'relic-triggered', trigger, action: 'dealDamage' });
      // Two independent checks, because neither alone is sufficient: `startOfBattle` has no
      // standalone "on" so the camelCase pattern misses it, and a future phrase could
      // legitimately contain a word that happens to be an id substring.
      expect(line, `${trigger} leaked its own id`).not.toContain(trigger);
      expect(line, `${trigger} leaked a camelCase enum id`).not.toMatch(/\bon[A-Z]/);
    }
  });
});

// ---------------------------------------------------------------------------
// C7 / G46 — display names, verb agreement, and the enemy's own voice.
//
// Every expected string below is written from `CONDITION_DATA`'s display names and
// English grammar, not read off the implementation.
// ---------------------------------------------------------------------------

/** Every condition type, from the engine's own exhaustive `Record<ConditionType, …>`. */
const ALL_CONDITIONS = Object.keys(CONDITION_DATA) as ConditionType[];

describe('formatEvent — condition DISPLAY NAMES, never the raw id (C7)', () => {
  it('the condition union really has 25 members', () => {
    // 12 Java-ported + `exposed` + 6 augments + 6 deprivations, counted from the
    // `ConditionType` declaration in condition.ts. Anchors the sweep below.
    expect(ALL_CONDITIONS).toHaveLength(12 + 1 + 6 + 6);
  });

  it('player-unable-to-act names the condition, capitalised', () => {
    expect(formatEvent({ kind: 'player-unable-to-act', conditionType: 'insanity' })).toBe(
      'You cannot act — Insanity.',
    );
  });

  it('the two ids whose display name DIFFERS are rendered by name, not by id', () => {
    // `quick` -> "Agile" and `smart` -> "Brainy" are the only two of the 25 where the
    // display name is not the capitalised id, so they are the sole anchors that can tell
    // "reads CONDITION_DATA" apart from "capitalises the id".
    const agile = formatEvent({ kind: 'condition-applied', subject: 'player', conditionType: 'quick' });
    expect(agile).toContain('Agile');
    expect(agile).not.toContain('quick');
    const brainy = formatEvent({ kind: 'condition-applied', subject: 'enemy', conditionType: 'smart' });
    expect(brainy).toContain('Brainy');
    expect(brainy).not.toContain('smart');
  });

  it('over all 25 conditions x both subjects, the name appears and the differing id never does', () => {
    for (const type of ALL_CONDITIONS) {
      const name = CONDITION_DATA[type].displayName;
      for (const subject of ['player', 'enemy'] as const) {
        const lines = [
          formatEvent({ kind: 'condition-onset', subject, conditionType: type }),
          formatEvent({ kind: 'condition-damage', subject, conditionType: type, amount: 2 }),
          formatEvent({ kind: 'condition-heal', subject, conditionType: type, amount: 2 }),
          formatEvent({ kind: 'condition-skip', subject, conditionType: type }),
          formatEvent({ kind: 'condition-applied', subject, conditionType: type }),
          formatEvent({ kind: 'condition-expired', subject, conditionType: type }),
        ];
        for (const line of lines) {
          expect(line, `${type}/${subject}: display name missing`).toContain(name);
          // Only meaningful where the id and the name differ — elsewhere the id IS a
          // case-variant of the name, so "does not contain the id" would be untestable.
          if (name.toLowerCase() !== type) {
            expect(line, `${type}/${subject}: raw id leaked`).not.toContain(type);
          }
        }
      }
      expect(formatEvent({ kind: 'player-unable-to-act', conditionType: type })).toContain(name);
    }
  });
});

describe('formatEvent — the enemy is third-person singular, never second person (G46)', () => {
  // Each pair is (player form, enemy form), written from English agreement rules.
  it('every subject-carrying line agrees with its subject', () => {
    const pairs: [GameEvent, string, GameEvent, string][] = [
      [{ kind: 'condition-onset', subject: 'player', conditionType: 'burn' }, 'You succumb to Burn.',
       { kind: 'condition-onset', subject: 'enemy', conditionType: 'burn' }, 'The enemy succumbs to Burn.'],
      [{ kind: 'condition-damage', subject: 'player', conditionType: 'burn', amount: 2 }, 'You take 2 damage from Burn.',
       { kind: 'condition-damage', subject: 'enemy', conditionType: 'burn', amount: 2 }, 'The enemy takes 2 damage from Burn.'],
      [{ kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2 }, 'You recover 2 from Regeneration.',
       { kind: 'condition-heal', subject: 'enemy', conditionType: 'regeneration', amount: 2 }, 'The enemy recovers 2 from Regeneration.'],
      [{ kind: 'condition-skip', subject: 'player', conditionType: 'sleep' }, 'You lose the turn to Sleep.',
       { kind: 'condition-skip', subject: 'enemy', conditionType: 'sleep' }, 'The enemy loses the turn to Sleep.'],
      [{ kind: 'advantage', subject: 'player' }, 'You gain the advantage.',
       { kind: 'advantage', subject: 'enemy' }, 'The enemy gains the advantage.'],
      [{ kind: 'disadvantage', subject: 'player' }, 'You are at a disadvantage.',
       { kind: 'disadvantage', subject: 'enemy' }, 'The enemy is at a disadvantage.'],
    ];
    for (const [playerEvent, playerText, enemyEvent, enemyText] of pairs) {
      expect(formatEvent(playerEvent)).toBe(playerText);
      expect(formatEvent(enemyEvent)).toBe(enemyText);
    }
  });
});

// A minimal creature satisfying the fields `tickConditions` reads. A `classId` makes
// `subjectOf()` report 'player'; omitting it reports 'enemy'.
type Ticker = Character & { activeConditions: ActiveCondition[]; classId?: string };
function creature(side: 'player' | 'enemy', conditions: ActiveCondition[]): Ticker {
  const base: Ticker = {
    name: side === 'player' ? 'Hero' : 'Beast',
    stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    mods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
    hp: 40, maxHp: 40, xp: 1, armorClass: 10,
    skillCharges: 0, maxSkillCharges: 0,
    hitDie: { quantity: 1, sides: 8 },
    activeConditions: conditions,
  };
  if (side === 'player') base.classId = 'Enforcer';
  return base;
}

/** Tick ONE condition on `side` through onset -> active -> expiry, collecting every event. */
function tickThrough(type: ConditionType, side: 'player' | 'enemy'): CombatEvent[] {
  const target = creature(side, [makeCondition(type)]);
  const opponent = creature(side === 'player' ? 'enemy' : 'player', []);
  // A real seeded stream, so the save rolls and the insanity `pick` all have draws.
  const rng = mulberry32(20260901);
  const out: CombatEvent[] = [];
  // `fracture` runs 100 turns; every other condition resolves well inside 8 ticks, and a
  // longer sweep only adds more chances for a stray `text` to appear.
  for (let i = 0; i < 8; i += 1) {
    const r = tickConditions(target, opponent, rng);
    out.push(...r.events);
    target.activeConditions = r.conditions;
  }
  return out;
}

describe('tickConditions stamps no second-person text on an ENEMY event (G46)', () => {
  it('no enemy-subject tick event carries a `text` field at all', () => {
    // Baseline the register measured over 250 runs: 676 enemy-subject bleed onsets and 172
    // poison onsets reading "Your skin is ruptured!" / "Venom courses through you."
    for (const type of ALL_CONDITIONS) {
      for (const ev of tickThrough(type, 'enemy')) {
        expect(ev.text, `${type} (${ev.kind}) still carries engine text on the enemy`).toBeUndefined();
      }
    }
  });

  it('and nothing the formatter renders for them says "you"', () => {
    for (const type of ALL_CONDITIONS) {
      for (const ev of tickThrough(type, 'enemy')) {
        expect(formatEvent(ev), `${type} (${ev.kind})`).not.toMatch(/\byou(r)?\b/i);
      }
    }
  });

  it("the PLAYER's insanity hallucination survives — it is authored content, not a duplicate", () => {
    const playerLines = tickThrough('insanity', 'player')
      .filter((e) => e.kind === 'condition-skip')
      .map((e) => e.text)
      .filter((t): t is string => t !== undefined);
    expect(playerLines.length).toBeGreaterThan(0);
    for (const line of playerLines) expect(INSANITY_STRINGS).toContain(line);
    // The enemy gets the same event with no line (asserted generally above; named here
    // because insanity is the ONE site where the flavour is kept rather than deleted).
    const enemySkips = tickThrough('insanity', 'enemy').filter((e) => e.kind === 'condition-skip');
    expect(enemySkips.length).toBeGreaterThan(0);
    for (const e of enemySkips) expect(e.text).toBeUndefined();
  });

  it('gating the hallucination did NOT change how many rng draws a tick consumes', () => {
    // The load-bearing half. `pick(rng, INSANITY_STRINGS)` still runs for BOTH subjects —
    // only the attachment is gated. If it had moved inside the `if`, an enemy insanity tick
    // would draw one fewer number than a player one and every downstream roll in the run
    // would shift (and with it the balance sample this unit is gated on). Proved by
    // counting draws off the same scripted stream for each subject.
    const counted = (side: 'player' | 'enemy'): number => {
      let draws = 0;
      const rng: Rng = () => {
        draws += 1;
        return 0.5;
      };
      const target = creature(side, [makeCondition('insanity')]);
      const opponent = creature(side === 'player' ? 'enemy' : 'player', []);
      for (let i = 0; i < 8; i += 1) {
        const r = tickConditions(target, opponent, rng);
        target.activeConditions = r.conditions;
      }
      return draws;
    };
    expect(counted('enemy')).toBe(counted('player'));
    // ...and it is not zero, or the equality above would hold vacuously.
    expect(counted('player')).toBeGreaterThan(0);
  });
});

describe('potion-unavailable states the outcome, not one of its three causes', () => {
  it('no longer claims the potions ran out', () => {
    // `battle.ts` emits this event for THREE different causes: no potions left, already at
    // full HP, and the Void Pact relic's `cannotHeal`. "No potions left to drink." was
    // false for two of them.
    const s = formatEvent({ kind: 'potion-unavailable' });
    expect(s).toBe('Nothing comes of reaching for a potion.');
    expect(s.toLowerCase()).not.toContain('no potions left');
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
    // G32 (#0a): `Attacker` gained a REQUIRED `proficiency`, folded into the to-hit
    // `modifier`. Pinned to 0 here so every hand-written expected STRING in this file
    // ("d20 15 +2 = 17 vs AC 13") stays exactly as authored — this file tests the FORMATTER,
    // not the to-hit maths. Only this one line is touched; `format.ts` itself is #0c's.
    proficiency: 0,
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
