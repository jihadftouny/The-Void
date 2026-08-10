import { describe, expect, it } from 'vitest';
import {
  CONDITION_DATA,
  CONTROL_CONDITIONS,
  addCondition,
  applyCondition,
  cureCondition,
  hasControlCondition,
  makeCondition,
  tickConditions,
  type ActiveCondition,
  type ConditionType,
} from './condition.ts';
import { type Character } from './character.ts';
import { type Rng } from './rng.ts';

// A deterministic RNG scripted from a fixed list of floats. Each call returns the
// next value; drawing past the end throws (so a test that expects "no draws" proves
// it by exhausting nothing). Convert a die face f on a d-sided die to (f-0.5)/sides.
function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`scriptedRng exhausted: only ${values.length} draw(s) scripted`);
    }
    return values[i++]!;
  };
}
const face = (f: number, sides: number): number => (f - 0.5) / sides;

// A minimal creature satisfying the fields tickConditions reads. `classId` makes
// subjectOf() report 'player'; omit it (opponent) to report 'enemy'.
function creature(
  overrides: Partial<Character & { activeConditions: ActiveCondition[]; classId: string }> = {},
): Character & { activeConditions: ActiveCondition[]; classId: string } {
  return {
    name: 'Tester',
    classId: 'Enforcer',
    stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    mods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
    hp: 20,
    maxHp: 20,
    xp: 1,
    armorClass: 10,
    skillCharges: 0,
    maxSkillCharges: 0,
    hitDie: { quantity: 1, sides: 8 },
    activeConditions: [],
    ...overrides,
  };
}

describe('CONDITION_DATA durations (ported from Condition.java)', () => {
  it('has the ported max-turns for the load-bearing cases', () => {
    expect(CONDITION_DATA.bleed.maxTurns).toBe(2);
    expect(CONDITION_DATA.fracture.maxTurns).toBe(100);
    expect(CONDITION_DATA.insanity.maxTurns).toBe(5);
    expect(CONDITION_DATA.push.maxTurns).toBe(1);
    expect(CONDITION_DATA.stun.maxTurns).toBe(2);
  });

  it('makeCondition sets remainingTurns = maxTurns from the table', () => {
    expect(makeCondition('fracture')).toEqual({ type: 'fracture', remainingTurns: 100, maxTurns: 100 });
    expect(makeCondition('bleed')).toEqual({ type: 'bleed', remainingTurns: 2, maxTurns: 2 });
  });
});

describe('addCondition dedup', () => {
  it('adds a new type and refuses a duplicate', () => {
    const list: ActiveCondition[] = [];
    expect(addCondition(list, 'bleed')).toBe(true);
    expect(list).toHaveLength(1);
    expect(addCondition(list, 'bleed')).toBe(false);
    expect(list).toHaveLength(1);
    expect(addCondition(list, 'stun')).toBe(true);
    expect(list).toHaveLength(2);
  });
});

describe('hasControlCondition', () => {
  it('is true for a control condition, false for a DoT', () => {
    expect(CONTROL_CONDITIONS.has('stun')).toBe(true);
    expect(hasControlCondition(creature({ activeConditions: [makeCondition('stun')] }))).toBe(true);
    expect(hasControlCondition(creature({ activeConditions: [makeCondition('bleed')] }))).toBe(false);
    expect(hasControlCondition(creature())).toBe(false);
  });
});

describe('tickConditions — Bleed damage + expiry timing (maxTurns 2)', () => {
  // Hand-derived from the three-phase chain: onset (turn 1, no damage), effect
  // (turn 2, -1 hp), expiry (turn 3, removed). Bleed rolls NO saving throw, so an
  // empty scripted RNG proves it consumes zero draws.
  it('deals -1 total over 3 ticks and expires on the 3rd, with no rng draws', () => {
    let conditions: ActiveCondition[] = [makeCondition('bleed')];
    let cumulative = 0;
    const opponent = creature();

    // Turn 1 — onset, no damage.
    let r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    cumulative += r.hpDelta;
    conditions = r.conditions;
    expect(r.hpDelta).toBe(0);
    expect(r.events.map((e) => e.kind)).toEqual(['condition-onset']);
    expect(conditions).toHaveLength(1);

    // Turn 2 — bleeds for 1.
    r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    cumulative += r.hpDelta;
    conditions = r.conditions;
    expect(r.hpDelta).toBe(-1);
    expect(r.events).toEqual([{ kind: 'condition-damage', subject: 'player', conditionType: 'bleed', amount: 1 }]);

    // Turn 3 — expires, removed.
    r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    cumulative += r.hpDelta;
    conditions = r.conditions;
    expect(r.events).toEqual([{ kind: 'condition-expired', subject: 'player', conditionType: 'bleed' }]);
    expect(conditions).toEqual([]);

    expect(cumulative).toBe(-1);
  });
});

describe('tickConditions — Stun sets the skip flag without damage', () => {
  it('onset skips the turn and keeps the condition, no rng draws', () => {
    const r = tickConditions(
      creature({ activeConditions: [makeCondition('stun')] }),
      creature(),
      scriptedRng([]),
    );
    expect(r.skipTurn).toBe(true);
    expect(r.hpDelta).toBe(0);
    expect(r.conditions).toEqual([{ type: 'stun', remainingTurns: 1, maxTurns: 2 }]);
    expect(r.events.map((e) => e.kind)).toContain('condition-skip');
  });
});

describe('tickConditions — Regeneration heals (+2 onset)', () => {
  it('onset heals for 2, no rng draws', () => {
    const r = tickConditions(
      creature({ activeConditions: [makeCondition('regeneration')] }),
      creature(),
      scriptedRng([]),
    );
    expect(r.hpDelta).toBe(2);
    expect(r.events).toContainEqual({ kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2 });
  });
});

describe('tickConditions — Freeze saving throw (STR mod vs opponent INT)', () => {
  // On the effect turn the target rolls d20 + STR mod (0 here) vs opponent INT (5).
  // Face 5 -> natural 5 -> save 5 >= 5 -> break free early (removed). This exercises
  // exactly one save draw.
  it('breaks free on save >= opponent INT and consumes one draw', () => {
    const target = creature({ activeConditions: [{ type: 'freeze', remainingTurns: 1, maxTurns: 2 }] });
    const opponent = creature({ stats: { STR: 10, DEX: 10, CON: 10, INT: 5, WIS: 10, CHA: 10 } });
    const r = tickConditions(target, opponent, scriptedRng([face(5, 20)]));
    expect(r.skipTurn).toBe(true);
    expect(r.conditions).toEqual([]);
    expect(r.events.map((e) => e.kind)).toContain('condition-expired');
  });
});

describe('tickConditions — Fracture forces disadvantage', () => {
  it('sets advDisOverride to -1 while active', () => {
    const r = tickConditions(
      creature({ activeConditions: [makeCondition('fracture')] }),
      creature(),
      scriptedRng([]),
    );
    expect(r.advDisOverride).toBe(-1);
  });
});

describe('tickConditions — purity + serializability', () => {
  it('does not mutate the input conditions and returns serializable data', () => {
    const input: ActiveCondition[] = [makeCondition('bleed')];
    const snapshot = JSON.parse(JSON.stringify(input));
    const r = tickConditions(creature({ activeConditions: input }), creature(), scriptedRng([]));
    expect(input).toEqual(snapshot); // input untouched
    expect(JSON.parse(JSON.stringify(r.conditions))).toEqual(r.conditions);
  });
});

describe('tickConditions — Poison DoT + cure (three-phase, hand-derived like bleed)', () => {
  // maxTurns 2, default intensity 1. onset (turn 1: 0 dmg), effect (turn 2: -1),
  // expiry (turn 3: removed). Poison rolls NO saving throw, so an empty scripted RNG
  // proves zero draws — derived from the chain, not from bleed's numbers.
  it('deals 0 then -1 then expires, no rng draws', () => {
    let conditions: ActiveCondition[] = [makeCondition('poison')];
    const opponent = creature();

    let r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    conditions = r.conditions;
    expect(r.hpDelta).toBe(0);
    expect(r.events.map((e) => e.kind)).toEqual(['condition-onset']);
    expect(conditions).toHaveLength(1);

    r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    conditions = r.conditions;
    expect(r.hpDelta).toBe(-1);
    expect(r.events).toEqual([{ kind: 'condition-damage', subject: 'player', conditionType: 'poison', amount: 1 }]);

    r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    conditions = r.conditions;
    expect(r.events).toEqual([{ kind: 'condition-expired', subject: 'player', conditionType: 'poison' }]);
    expect(conditions).toEqual([]);
  });

  it('cureCondition removes poison (the CURE hook) and leaves other conditions', () => {
    const list = [makeCondition('poison'), makeCondition('bleed')];
    const cured = cureCondition(list, 'poison');
    expect(cured).toEqual([makeCondition('bleed')]);
    expect(list).toHaveLength(2); // input untouched (pure)
  });
});

describe('applyCondition — mix-per-condition stacking', () => {
  it('DoT stacks intensity and refreshes duration; a tick then deals the intensity', () => {
    const list: ActiveCondition[] = [];
    expect(applyCondition(list, 'poison')).toBe('added');
    expect(list).toEqual([{ type: 'poison', remainingTurns: 2, maxTurns: 2 }]); // intensity implied 1

    // Apply again BEFORE any tick: one instance, intensity 2, duration refreshed.
    expect(applyCondition(list, 'poison')).toBe('stacked');
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ type: 'poison', remainingTurns: 2, maxTurns: 2, intensity: 2 });

    // A third application -> intensity 3.
    expect(applyCondition(list, 'poison')).toBe('stacked');
    expect(list[0]!.intensity).toBe(3);
  });

  it('an intensity-2 poison deals exactly -2 on its effect tick (hand-derived)', () => {
    const cond: ActiveCondition = { type: 'poison', remainingTurns: 1, maxTurns: 2, intensity: 2 };
    const r = tickConditions(creature({ activeConditions: [cond] }), creature(), scriptedRng([]));
    expect(r.hpDelta).toBe(-2);
    expect(r.events).toEqual([{ kind: 'condition-damage', subject: 'player', conditionType: 'poison', amount: 2 }]);
  });

  it('an intensity-3 bleed deals exactly -3 on its effect tick', () => {
    const cond: ActiveCondition = { type: 'bleed', remainingTurns: 1, maxTurns: 2, intensity: 3 };
    const r = tickConditions(creature({ activeConditions: [cond] }), creature(), scriptedRng([]));
    expect(r.hpDelta).toBe(-3);
  });

  it('an augment REFRESHES duration, never stacks: single copy, no intensity, no doubling', () => {
    const list: ActiveCondition[] = [];
    expect(applyCondition(list, 'strong')).toBe('added');
    list[0]!.remainingTurns = 1; // simulate a turn passing
    expect(applyCondition(list, 'strong')).toBe('refreshed');
    expect(list).toHaveLength(1);
    expect(list[0]!.remainingTurns).toBe(2); // reset to maxTurns
    expect('intensity' in list[0]!).toBe(false); // no intensity field ever
  });
});

describe('tickConditions — every ConditionType counts down and expires (none dormant)', () => {
  // Regression guard for the pre-M2 bug where poison + augment/deprivation were carried
  // forever untouched. Opponent INT 30 makes burn/freeze/electrify saves always fail, so
  // those expire purely by countdown (not an early break). DoTs must deal net damage.
  const DOT_TYPES = new Set<ConditionType>(['poison', 'bleed', 'burn']);
  const steady: Rng = () => 0.5; // never throws; d20 -> 11, save always < 30

  it('every type survives-and-decrements on its onset tick, then expires by full duration', () => {
    const opponent = creature({ stats: { STR: 10, DEX: 10, CON: 10, INT: 30, WIS: 10, CHA: 10 } });
    for (const type of Object.keys(CONDITION_DATA) as ConditionType[]) {
      const maxTurns = CONDITION_DATA[type].maxTurns;
      let conditions: ActiveCondition[] = [makeCondition(type)];

      // First (onset) tick: it must be HANDLED — still present, remainingTurns
      // decremented by one. This bites both regressions: an unhandled type would be
      // dropped (length 0), and the old "carry untouched" fallthrough would leave
      // remainingTurns === maxTurns.
      let r = tickConditions(creature({ activeConditions: conditions }), opponent, steady);
      let cumulative = r.hpDelta;
      conditions = r.conditions;
      expect(conditions, `${type} should survive onset`).toHaveLength(1);
      expect(conditions[0]!.remainingTurns, `${type} should count down on onset`).toBe(maxTurns - 1);

      // Remaining ticks: it must eventually clear (never carried forever).
      for (let i = 0; i < maxTurns; i++) {
        r = tickConditions(creature({ activeConditions: conditions }), opponent, steady);
        cumulative += r.hpDelta;
        conditions = r.conditions;
      }
      expect(conditions, `${type} should have expired`).toEqual([]);
      if (DOT_TYPES.has(type)) {
        expect(cumulative, `${type} DoT should deal net damage`).toBeLessThan(0);
      }
    }
  });
});

describe('ActiveCondition JSON round-trip', () => {
  it('every condition type builds a plain-data instance that round-trips', () => {
    const types = Object.keys(CONDITION_DATA) as ConditionType[];
    for (const t of types) {
      const c = makeCondition(t);
      expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    }
  });
});
