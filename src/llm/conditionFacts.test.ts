// The condition facts the model is told — proved against events the REAL ENGINE emitted.
//
// WHY THIS FILE EXISTS (FINDINGS.md C11). `describeEvent` and `formatEvent` were both
// "covered" before this unit, and both shipped the same two defects for thirteen audit
// rounds and 1029 green tests. The reason is that every existing test fed them HAND-BUILT
// event objects: the fixture was written to match the code, so the pair agreed with each
// other and neither agreed with the game. A projector can only be checked against the thing
// it projects, so every anchor below starts from a real `step` / `tickConditions` call and
// reads the event the engine actually produced.
//
// Every expected string is derived from the DESIGN, never from a run: the skill tables in
// `skill.ts` say which condition a cast applies, `CONDITION_DATA` says what that condition is
// called, and English says how the sentence reads for each of the two subjects. Nothing here
// was obtained by printing the implementation's output.
//
// ⚠ THIS TEST IMPORTS ACROSS LAYERS, ON PURPOSE, and it does not weaken the purity rule.
// `src/llm` is a pure core and no SHIPPING file in it may import `src/render` or
// `src/desktop` — `src/log/purity.test.ts` and `src/game/offEquivalence.test.ts` hold that
// line over shipping code. A TEST is not shipping code, and C7 has two surfaces that must
// agree: the narrator's fact and the combat log's line come from two different files, so a
// test that only checked one would be checking half the defect. `fallbackNarration` is here
// for the same reason — it is the string the PLAYER reads when the model fails, so a wrong
// fact is wrong on screen and not only in a prompt. `src/game/karmaActions.test.ts` already
// reaches into `format.ts` and `view-model.ts` the same way; this follows that convention.

import { describe, it, expect } from 'vitest';
import { describeEvent, eventsToFacts, buildNarrationPrompt } from './narrate.ts';
import { fallbackNarration } from '../desktop/view-model.ts';
import { formatEvent } from '../render/format.ts';
import { step } from '../game/game.ts';
import type { GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import type { CombatSubject } from '../game/combatEvent.ts';
import { createPlayer } from '../game/player.ts';
import type { Player, PlayerClass } from '../game/player.ts';
import type { Character, Stats } from '../game/character.ts';
import { createKarma } from '../game/karma.ts';
import { createRng, mulberry32 } from '../game/rng.ts';
import { buildRandomBattle } from '../game/encounter.ts';
import type { BattleAction } from '../game/battle.ts';
import { pickUp } from '../game/equipment.ts';
import {
  BENEFICIAL_CONDITIONS,
  CONDITION_DATA,
  makeCondition,
  tickConditions,
  type ActiveCondition,
  type BeneficialCondition,
  type ConditionType,
} from '../game/condition.ts';
import type { SkillId } from '../game/skill.ts';

const ALL_CONDITIONS = Object.keys(CONDITION_DATA) as ConditionType[];
const SUBJECTS: readonly CombatSubject[] = ['player', 'enemy'];

/** Flat, legal stats — every class rolls something in [3,18]; 12 is mid-range and boring. */
const STATS: Stats = { STR: 12, DEX: 12, CON: 12, INT: 12, WIS: 12, CHA: 12 };

// ---------------------------------------------------------------------------
// Real engine drivers
// ---------------------------------------------------------------------------

/** A hub state wrapping a player — the shape `createGame` produces, with `player` swapped in. */
function hub(player: Player): GameState {
  return {
    version: 9,
    rngState: 0,
    player,
    act: 1,
    place: 0,
    karma: createKarma(),
    phase: { kind: 'main-menu' },
  };
}

/**
 * A fresh player of `classId`, with charges banked and any extra skills granted. `skillPool`
 * additions are states the real draft reaches (`classKit.CLASSES[c].kit` beyond `coreSkills`),
 * so a cast of one is a cast the game can really make.
 */
function freshPlayer(classId: PlayerClass, extraSkills: SkillId[] = []): Player {
  const p = createPlayer({ name: 'Anchor', classId, stats: STATS });
  return { ...p, skillCharges: 3, skillPool: [...p.skillPool, ...extraSkills] };
}

/** Dispatch one real battle action through the engine `step` from a started battle. */
function throughStep(
  player: Player,
  action: BattleAction,
): { events: GameEvent[]; state: GameState } {
  const { rng } = createRng(4242);
  const battle = { ...buildRandomBattle(player, 1, rng), player };
  const state: GameState = {
    ...hub(player),
    phase: { kind: 'battle', battle, started: true, final: false },
  };
  const result = step(state, { kind: 'battle-action', action });
  return { events: result.events, state: result.state };
}

/** Every `describeEvent` fact of a real step, so an anchor is looked up, never indexed. */
function factsOf(events: readonly GameEvent[]): string[] {
  return eventsToFacts(events);
}

/**
 * A minimal creature satisfying the fields `tickConditions` reads (the `format.test.ts`
 * idiom). A `classId` makes `subjectOf()` report 'player'; omitting it reports 'enemy'.
 */
type Ticker = Character & { activeConditions: ActiveCondition[]; classId?: string };
function creature(side: CombatSubject, conditions: ActiveCondition[]): Ticker {
  const base: Ticker = {
    name: side === 'player' ? 'Hero' : 'Beast',
    stats: STATS,
    mods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
    hp: 40,
    maxHp: 40,
    xp: 1,
    armorClass: 10,
    skillCharges: 0,
    maxSkillCharges: 0,
    hitDie: { quantity: 1, sides: 8 },
    activeConditions: conditions,
  };
  if (side === 'player') base.classId = 'Enforcer';
  return base;
}

/** Tick one condition on `side` through onset → effect, collecting every real event. */
function tickThrough(type: ConditionType, side: CombatSubject, ticks = 2): GameEvent[] {
  const target = creature(side, [makeCondition(type)]);
  const opponent = creature(side === 'player' ? 'enemy' : 'player', []);
  const rng = mulberry32(20260921);
  const out: GameEvent[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const r = tickConditions(target, opponent, rng);
    out.push(...r.events);
    target.activeConditions = r.conditions;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The anchors — a real cast, a real tick, a real skipped turn, a real drink
// ---------------------------------------------------------------------------

describe('C10(b) — a buff is never an affliction, on events the engine really emitted', () => {
  it("the Enforcer's Brace reads as steadying, not as being afflicted with 'healthy'", () => {
    // skill.ts: `brace.selfConditions = ['healthy']`; CONDITION_DATA.healthy.displayName =
    // 'Healthy'. The shipped line was "You are afflicted with healthy." — the class's own
    // defensive skill, handed to the model as a misfortune, in raw-id spelling.
    const { events } = throughStep(freshPlayer('Enforcer'), { kind: 'cast', skillId: 'brace' });
    const applied = events.filter((e) => e.kind === 'condition-applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ subject: 'player', conditionType: 'healthy' });

    expect(factsOf(events)).toContain('You steady yourself — Healthy.');
    expect(factsOf(events).join(' ')).not.toMatch(/afflicted/);
    expect(factsOf(events).join(' ')).not.toMatch(/\bhealthy\b/);
  });

  it("the Scavver's Slip reads as quickening, and names Agile — not the id `quick`", () => {
    // `quick` is one of the two ids whose display name genuinely differs (Agile), so it is
    // the sharpest test that the NAME is read rather than the id printed.
    const { events } = throughStep(freshPlayer('Scavver', ['slip']), {
      kind: 'cast',
      skillId: 'slip',
    });
    expect(
      events.some((e) => e.kind === 'condition-applied' && e.conditionType === 'quick'),
    ).toBe(true);

    const facts = factsOf(events);
    expect(facts).toContain('You quicken — Agile.');
    expect(facts.join(' ')).not.toMatch(/\bquick\b/);
  });

  it("the Penitent's Consecrate reads as wounds knitting", () => {
    const { events } = throughStep(freshPlayer('Penitent', ['consecrate']), {
      kind: 'cast',
      skillId: 'consecrate',
    });
    expect(
      events.some((e) => e.kind === 'condition-applied' && e.conditionType === 'regeneration'),
    ).toBe(true);
    expect(factsOf(events)).toContain('Your wounds begin to knit — Regeneration.');
  });

  it("a drunk Focus Serum names Brainy, never the id `smart`", () => {
    // consumables.json `focus-serum` → `applyConditionSelf smart`; displayName 'Brainy'.
    const base = createPlayer({ name: 'Anchor', classId: 'Neuromancer', stats: STATS });
    const inventory = pickUp(base.inventory, { defId: 'focus-serum' });
    const index = inventory.backpack.length - 1;
    const player: Player = { ...base, skillCharges: 3, inventory };
    const { events } = throughStep(player, { kind: 'useConsumable', source: { index } });

    expect(
      events.some((e) => e.kind === 'condition-applied' && e.conditionType === 'smart'),
    ).toBe(true);
    const facts = factsOf(events);
    expect(facts).toContain('Your thoughts sharpen — Brainy.');
    expect(facts.join(' ')).not.toMatch(/\bsmart\b/);
  });
});

describe('C10(c) / C7 — afflictions on real events name the condition, never the id', () => {
  it("the Scavver's Backstab marks the enemy as Exposed (and bleeding)", () => {
    // classKit.ts step 6 `appliesExposure` emits `condition-applied` on the ENEMY with
    // `exposed`; `useSkill` emits one for backstab's `conditions: ['bleed']` first.
    const { events } = throughStep(freshPlayer('Scavver'), {
      kind: 'cast',
      skillId: 'backstab',
    });
    const applied = events.filter((e) => e.kind === 'condition-applied');
    expect(applied.map((e) => e.kind === 'condition-applied' && e.conditionType)).toEqual([
      'bleed',
      'exposed',
    ]);

    const facts = factsOf(events);
    expect(facts).toContain('The enemy is afflicted with Bleed.');
    expect(facts).toContain('The enemy is afflicted with Exposed.');
    expect(facts.join(' ')).not.toMatch(/\bbleed\b|\bexposed\b/);
  });

  it('a bleeding player and a bleeding enemy each suffer in their own grammar', () => {
    // A fresh bleed has no `intensity`, and condition.ts reads absent ⇒ 1, so the effect
    // tick (the SECOND tick — the first is onset and deals nothing) is exactly 1.
    const mine = tickThrough('bleed', 'player');
    const theirs = tickThrough('bleed', 'enemy');
    for (const stream of [mine, theirs]) {
      const dmg = stream.filter((e) => e.kind === 'condition-damage');
      expect(dmg).toHaveLength(1);
      expect(dmg[0]).toMatchObject({ conditionType: 'bleed', amount: 1 });
    }

    expect(factsOf(mine)).toContain('You suffer 1 harm from Bleed.');
    expect(factsOf(theirs)).toContain('The enemy suffers 1 harm from Bleed.');
    // C10(a): the literal optional-plural marker is gone from both.
    expect([...factsOf(mine), ...factsOf(theirs)].join(' ')).not.toContain('(s)');
  });

  it('a stunned player cannot act, and the fact names Stun', () => {
    // battle.ts: `ptc.skipTurn` from the stun onset tick pushes `player-unable-to-act`
    // with `skipCause(ptc.events)` — the real path, not a hand-made event.
    const base = freshPlayer('Enforcer');
    const player: Player = { ...base, activeConditions: [makeCondition('stun')] };
    const { events } = throughStep(player, 'fight');

    const unable = events.filter((e) => e.kind === 'player-unable-to-act');
    expect(unable).toHaveLength(1);
    expect(unable[0]).toMatchObject({ conditionType: 'stun' });
    expect(factsOf(events)).toContain('You cannot act — Stun holds you.');
    expect(factsOf(events).join(' ')).not.toMatch(/\bstun\b/);
  });
});

describe('the fallback the player actually reads carries the same sentences', () => {
  // When the model fails, `fallbackNarration` prints the facts verbatim. Whatever is wrong
  // in a fact is wrong ON SCREEN, not just in the prompt — so every anchor is re-checked
  // through the real prompt builder and the real fallback.
  it("Brace's fact survives buildNarrationPrompt and fallbackNarration intact", () => {
    const { events, state } = throughStep(freshPlayer('Enforcer'), {
      kind: 'cast',
      skillId: 'brace',
    });
    const prompt = buildNarrationPrompt(events, state);
    expect(prompt).not.toBeNull();
    expect(prompt!.user).toContain('You steady yourself — Healthy.');
    expect(fallbackNarration(prompt)).toContain('You steady yourself — Healthy.');
    expect(fallbackNarration(prompt)).not.toMatch(/afflicted|\bhealthy\b/);
  });

  it("the stun fact survives both, and carries no '(s)' or raw id", () => {
    const base = freshPlayer('Enforcer');
    const { events, state } = throughStep(
      { ...base, activeConditions: [makeCondition('stun')] },
      'fight',
    );
    const prompt = buildNarrationPrompt(events, state);
    expect(prompt).not.toBeNull();
    expect(fallbackNarration(prompt)).toContain('You cannot act — Stun holds you.');
  });
});

// ---------------------------------------------------------------------------
// The full sweep — 25 conditions, both subjects, both projectors
// ---------------------------------------------------------------------------

/**
 * The expected buff sentence, hand-written from the design (the plan's phrase table) and the
 * display names transcribed from `CONDITION_DATA`. Deliberately a SECOND copy: the test must
 * say what the sentence should be, not ask the implementation.
 */
const BUFF_SENTENCE: Record<BeneficialCondition, Record<CombatSubject, string>> = {
  healthy: { player: 'You steady yourself — Healthy.', enemy: 'The enemy steadies — Healthy.' },
  quick: { player: 'You quicken — Agile.', enemy: 'The enemy quickens — Agile.' },
  strong: { player: 'You harden — Strong.', enemy: 'The enemy hardens — Strong.' },
  smart: {
    player: 'Your thoughts sharpen — Brainy.',
    enemy: "The enemy's thoughts sharpen — Brainy.",
  },
  wise: { player: 'Your sight clears — Wise.', enemy: "The enemy's sight clears — Wise." },
  charming: { player: 'You brighten — Charming.', enemy: 'The enemy brightens — Charming.' },
  regeneration: {
    player: 'Your wounds begin to knit — Regeneration.',
    enemy: "The enemy's wounds begin to knit — Regeneration.",
  },
};

const BUFFS = new Set<ConditionType>(BENEFICIAL_CONDITIONS);

/** Every `describeEvent` case that carries a condition, for all 25 × both subjects. */
function conditionEvents(type: ConditionType, subject: CombatSubject): GameEvent[] {
  const events: GameEvent[] = [
    { kind: 'condition-applied', subject, conditionType: type },
    { kind: 'condition-damage', subject, conditionType: type, amount: 3 },
  ];
  if (subject === 'player') events.push({ kind: 'player-unable-to-act', conditionType: type });
  return events;
}

describe('AC-3/AC-4 sweep — every condition, every subject, every condition-carrying fact', () => {
  it('no fact prints a raw condition id, and every fact names the display name', () => {
    for (const type of ALL_CONDITIONS) {
      const name = CONDITION_DATA[type].displayName;
      const idWord = new RegExp(`\\b${type}\\b`); // case-SENSITIVE: 'Bleed' is fine, 'bleed' is not
      for (const subject of SUBJECTS) {
        for (const e of conditionEvents(type, subject)) {
          const fact = describeEvent(e);
          expect(fact, `${e.kind}/${type}/${subject} produced no fact`).not.toBe('');
          expect(fact, `${e.kind}/${type}/${subject} lost the display name`).toContain(name);
          expect(fact, `${e.kind}/${type}/${subject} leaked the raw id`).not.toMatch(idWord);
        }
      }
    }
  });

  it('`quick` renders Agile and `smart` renders Brainy — the two ids that differ', () => {
    // If the projector were printing `e.conditionType`, 23 of the 25 would still look right.
    // These two are the pair that cannot pass by accident.
    for (const subject of SUBJECTS) {
      const applied = describeEvent({ kind: 'condition-applied', subject, conditionType: 'quick' });
      expect(applied).toContain('Agile');
      const dmg = describeEvent({
        kind: 'condition-damage',
        subject,
        conditionType: 'smart',
        amount: 1,
      });
      expect(dmg).toContain('Brainy');
    }
  });

  it('the seven buffs get their own sentence and are never "afflicted"', () => {
    for (const type of BENEFICIAL_CONDITIONS) {
      for (const subject of SUBJECTS) {
        const fact = describeEvent({ kind: 'condition-applied', subject, conditionType: type });
        expect(fact).toBe(BUFF_SENTENCE[type][subject]);
        expect(fact, `${type}/${subject} is still described as an affliction`).not.toMatch(
          /afflicted/,
        );
      }
    }
  });

  it('the other eighteen ARE afflictions, and borrow no buff phrase', () => {
    const buffPhrases = Object.values(BUFF_SENTENCE).flatMap((s) => [
      s.player.split(' — ')[0]!,
      s.enemy.split(' — ')[0]!,
    ]);
    const afflictions = ALL_CONDITIONS.filter((t) => !BUFFS.has(t));
    expect(afflictions).toHaveLength(18);

    for (const type of afflictions) {
      const name = CONDITION_DATA[type].displayName;
      expect(describeEvent({ kind: 'condition-applied', subject: 'player', conditionType: type })).toBe(
        `You are afflicted with ${name}.`,
      );
      expect(describeEvent({ kind: 'condition-applied', subject: 'enemy', conditionType: type })).toBe(
        `The enemy is afflicted with ${name}.`,
      );
      for (const subject of SUBJECTS) {
        const fact = describeEvent({ kind: 'condition-applied', subject, conditionType: type });
        for (const phrase of buffPhrases) {
          expect(fact, `${type} borrowed the buff phrase "${phrase}"`).not.toContain(phrase);
        }
      }
    }
  });

  it('condition-damage and player-unable-to-act read as English for both subjects', () => {
    for (const type of ALL_CONDITIONS) {
      const name = CONDITION_DATA[type].displayName;
      expect(
        describeEvent({ kind: 'condition-damage', subject: 'player', conditionType: type, amount: 2 }),
      ).toBe(`You suffer 2 harm from ${name}.`);
      expect(
        describeEvent({ kind: 'condition-damage', subject: 'enemy', conditionType: type, amount: 2 }),
      ).toBe(`The enemy suffers 2 harm from ${name}.`);
      expect(describeEvent({ kind: 'player-unable-to-act', conditionType: type })).toBe(
        `You cannot act — ${name} holds you.`,
      );
    }
  });

  it('no condition fact anywhere carries the "(s)" optional-plural marker', () => {
    for (const type of ALL_CONDITIONS) {
      for (const subject of SUBJECTS) {
        for (const e of conditionEvents(type, subject)) {
          expect(describeEvent(e)).not.toContain('(s)');
        }
      }
    }
  });
});

describe('the combat LOG (format.ts) holds the same line — C7 has two surfaces', () => {
  /** Every condition-carrying `formatEvent` case, for all 25 × both subjects. */
  function logEvents(type: ConditionType, subject: CombatSubject): GameEvent[] {
    const events: GameEvent[] = [
      { kind: 'condition-applied', subject, conditionType: type },
      { kind: 'condition-onset', subject, conditionType: type },
      { kind: 'condition-skip', subject, conditionType: type },
      { kind: 'condition-expired', subject, conditionType: type },
      { kind: 'condition-damage', subject, conditionType: type, amount: 3 },
      { kind: 'condition-heal', subject, conditionType: type, amount: 3 },
    ];
    if (subject === 'player') events.push({ kind: 'player-unable-to-act', conditionType: type });
    return events;
  }

  it('no log line prints a raw condition id, and every one names the display name', () => {
    for (const type of ALL_CONDITIONS) {
      const name = CONDITION_DATA[type].displayName;
      const idWord = new RegExp(`\\b${type}\\b`);
      for (const subject of SUBJECTS) {
        for (const e of logEvents(type, subject)) {
          const line = formatEvent(e);
          expect(line, `${e.kind}/${type}/${subject} lost the display name`).toContain(name);
          expect(line, `${e.kind}/${type}/${subject} leaked the raw id`).not.toMatch(idWord);
        }
      }
    }
  });

  it('a real tick stream logs and narrates without a raw id, for every condition', () => {
    // The strongest form: the events come from `tickConditions` itself, both subjects, all 25.
    for (const type of ALL_CONDITIONS) {
      const idWord = new RegExp(`\\b${type}\\b`);
      for (const subject of SUBJECTS) {
        const stream = tickThrough(type, subject, 4);
        expect(stream.length, `${type}/${subject} produced no tick events`).toBeGreaterThan(0);
        for (const e of stream) {
          expect(formatEvent(e), `log leaked ${type}`).not.toMatch(idWord);
          expect(describeEvent(e), `fact leaked ${type}`).not.toMatch(idWord);
          expect(describeEvent(e)).not.toContain('(s)');
        }
      }
    }
  });
});
