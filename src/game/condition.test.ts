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
    // CHANGED by G23: the surviving instance now carries the explicit `onsetDone` phase flag.
    // Its BEHAVIOUR is unchanged (same skip, same 0 hpDelta, same remainingTurns, same
    // events) — only the record gained the additive field that stops a later refresh from
    // rewinding the phase. The old shape is still accepted on load (see the legacy-save guard).
    expect(r.conditions).toEqual([
      { type: 'stun', remainingTurns: 1, maxTurns: 2, onsetDone: true },
    ]);
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

describe('exposed (M3 Scavver mark) — pure countdown, no hp/skip, DoT stacking', () => {
  // Hand-derived from CONDITION_DATA.exposed (maxTurns 2, stacking 'dot'): onset (turn 1,
  // no effect), active (turn 2, no effect), expiry (turn 3, removed). It rolls no save, so
  // an empty scripted RNG proves it consumes zero draws.
  it('ticks down over 3 turns with no hp delta and no skip, then expires', () => {
    const opponent = creature();
    let conditions: ActiveCondition[] = [makeCondition('exposed')];
    expect(conditions[0]).toEqual({ type: 'exposed', remainingTurns: 2, maxTurns: 2 });

    // Turn 1 — onset, no damage/skip, survives at remaining 1.
    let r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    expect(r.hpDelta).toBe(0);
    expect(r.skipTurn).toBe(false);
    expect(r.events.map((e) => e.kind)).toEqual(['condition-onset']);
    // CHANGED by G23 (shape only — the countdown, the absent hp delta and the events are all
    // unchanged): the survivor carries the explicit `onsetDone` phase flag from its onset tick.
    expect(r.conditions).toEqual([
      { type: 'exposed', remainingTurns: 1, maxTurns: 2, onsetDone: true },
    ]);
    conditions = r.conditions;

    // Turn 2 — active, still no effect, survives at remaining 0.
    r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    expect(r.hpDelta).toBe(0);
    expect(r.skipTurn).toBe(false);
    expect(r.events).toEqual([]);
    expect(r.conditions).toEqual([
      { type: 'exposed', remainingTurns: 0, maxTurns: 2, onsetDone: true },
    ]);
    conditions = r.conditions;

    // Turn 3 — expiry, removed.
    r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    expect(r.events).toEqual([{ kind: 'condition-expired', subject: 'player', conditionType: 'exposed' }]);
    expect(r.conditions).toEqual([]);
  });

  it('a second application stacks intensity to 2 and refreshes the duration', () => {
    const list: ActiveCondition[] = [];
    expect(applyCondition(list, 'exposed')).toBe('added');
    expect(list).toEqual([{ type: 'exposed', remainingTurns: 2, maxTurns: 2 }]); // fresh = intensity 1

    // Advance the duration, then re-apply: intensity -> 2 and duration refreshes to max.
    list[0]!.remainingTurns = 1;
    expect(applyCondition(list, 'exposed')).toBe('stacked');
    expect(list).toEqual([{ type: 'exposed', remainingTurns: 2, maxTurns: 2, intensity: 2 }]);
  });

  it('is not a control condition (never blocks a turn)', () => {
    expect(CONTROL_CONDITIONS.has('exposed')).toBe(false);
    expect(hasControlCondition(creature({ activeConditions: [makeCondition('exposed')] }))).toBe(false);
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

// ------- G23 — a re-applied condition must not rewind to its onset turn --------------------

describe('G23 — re-applying a damage-over-time condition actually damages', () => {
  /**
   * The register's own reproduction, as a pure condition-layer loop in the order a real round
   * uses: TICK first, then the cast that re-applies. Expected total derived by hand, never
   * measured:
   *   round 1 — nothing is active yet, so the tick deals 0; the cast ADDS bleed (intensity 1).
   *   round 2 — the ONSET tick deals 0 (first-turn flavour); the cast STACKS to intensity 2.
   *   round n >= 3 — the tick is an ACTIVE tick dealing the intensity banked last round, which
   *                  is n - 1; the cast then stacks to intensity n.
   *   total = sum(n = 3..20) of (n - 1) = sum(k = 2..19) of k = (19*20/2) - 1 = 190 - 1 = 189.
   * Against the pre-fix build this loop deals 0 (each cast reset the live condition to onset)
   * while a SINGLE cast dealt 1 — the dominant action was strictly worse than acting once.
   */
  it('20 rounds of re-applied bleed deal exactly 189 damage', () => {
    let conditions: ActiveCondition[] = [];
    let total = 0;
    for (let round = 1; round <= 20; round++) {
      const r = tickConditions(
        creature({ activeConditions: conditions }),
        creature(),
        scriptedRng([]), // bleed rolls no save: an empty script proves zero draws
      );
      total += r.hpDelta;
      conditions = r.conditions;
      applyCondition(conditions, 'bleed'); // the re-application under test
    }
    expect(total).toBe(-189);
    // And the stack really did deepen once per round after the first: 20 applications.
    expect(conditions).toHaveLength(1);
    expect(conditions[0]!.intensity).toBe(20);
  });

  it('a SINGLE application of bleed deals exactly 1 over its whole life', () => {
    let conditions: ActiveCondition[] = [];
    applyCondition(conditions, 'bleed');
    let total = 0;
    for (let tick = 0; tick < 5; tick++) {
      const r = tickConditions(
        creature({ activeConditions: conditions }),
        creature(),
        scriptedRng([]),
      );
      total += r.hpDelta;
      conditions = r.conditions;
    }
    // onset 0, active -1, expiry 0, then gone.
    expect(total).toBe(-1);
    expect(conditions).toEqual([]);
  });

  it('a refreshed FREEZE reaches the active branch, so its saving throw is finally rolled', () => {
    // Control half of G23. Fresh freeze -> onset tick (skip, NO draw). Re-apply (refresh sets
    // remainingTurns back to maxTurns). The next tick must be the ACTIVE branch: it rolls
    // d20 + STR mod (0) against the opponent's INT (5); face 5 -> 5 >= 5 -> break free.
    // Pre-fix that second tick read as onset again and rolled nothing, so a refreshed freeze
    // could never be escaped and the scripted draw would go unconsumed.
    const opponent = creature({ stats: { STR: 10, DEX: 10, CON: 10, INT: 5, WIS: 10, CHA: 10 } });
    let conditions: ActiveCondition[] = [makeCondition('freeze')];

    let r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([]));
    expect(r.skipTurn).toBe(true);
    conditions = r.conditions;
    expect(applyCondition(conditions, 'freeze')).toBe('refreshed');
    expect(conditions[0]!.remainingTurns).toBe(2); // duration refreshed to max

    r = tickConditions(creature({ activeConditions: conditions }), opponent, scriptedRng([face(5, 20)]));
    expect(r.skipTurn).toBe(true);
    expect(r.events.map((e) => e.kind)).toContain('condition-expired');
    expect(r.conditions).toEqual([]);
  });

  it('a re-applied PUSH pushes again instead of expiring (the companion fix)', () => {
    // `push` (maxTurns 1) was the one condition whose effect fired only on the onset branch.
    // With an explicit phase flag, a refreshed push reaches the active branch — and without
    // its own active case it would EXPIRE there, i.e. re-applying a control would cancel it.
    let conditions: ActiveCondition[] = [makeCondition('push')];
    let r = tickConditions(creature({ activeConditions: conditions }), creature(), scriptedRng([]));
    expect(r.skipTurn).toBe(true);
    conditions = r.conditions;
    expect(conditions[0]!.remainingTurns).toBe(0);

    expect(applyCondition(conditions, 'push')).toBe('refreshed');
    r = tickConditions(creature({ activeConditions: conditions }), creature(), scriptedRng([]));
    expect(r.skipTurn).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(['condition-skip']);
    expect(r.conditions).toHaveLength(1);
  });

  it('LEGACY GUARD — an instance saved with no `onsetDone` ticks exactly as it did before', () => {
    // Two hand-built records in the pre-flag shape. The fallback is the OLD inference
    // (`remainingTurns < maxTurns` means onset already happened), so both must behave as the
    // shipped engine behaved: mid-life -> the active tick damages; full duration -> onset, 0.
    const midLife: ActiveCondition = { type: 'bleed', remainingTurns: 1, maxTurns: 2 };
    const mid = tickConditions(
      creature({ activeConditions: [midLife] }),
      creature(),
      scriptedRng([]),
    );
    expect(mid.hpDelta).toBe(-1);
    expect(mid.events).toEqual([
      { kind: 'condition-damage', subject: 'player', conditionType: 'bleed', amount: 1 },
    ]);

    const fresh: ActiveCondition = { type: 'bleed', remainingTurns: 2, maxTurns: 2 };
    const first = tickConditions(
      creature({ activeConditions: [fresh] }),
      creature(),
      scriptedRng([]),
    );
    expect(first.hpDelta).toBe(0);
    expect(first.events.map((e) => e.kind)).toEqual(['condition-onset']);

    // Expiry is still reached at the same tick count for a legacy record.
    const spent: ActiveCondition = { type: 'bleed', remainingTurns: 0, maxTurns: 2 };
    const gone = tickConditions(
      creature({ activeConditions: [spent] }),
      creature(),
      scriptedRng([]),
    );
    expect(gone.conditions).toEqual([]);
    expect(gone.events.map((e) => e.kind)).toEqual(['condition-expired']);
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
