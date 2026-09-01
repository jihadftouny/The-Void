import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hpFraction,
  barModel,
  barCells,
  resourceBarModel,
  conditionChip,
  conditionChips,
  CONDITION_TONE,
  rowModel,
  buttonModel,
} from './component-model.ts';
import {
  CONDITION_DATA,
  CONTROL_CONDITIONS,
  type ActiveCondition,
  type ConditionType,
} from '../game/condition.ts';

/** Build an ActiveCondition the way the engine stores one. */
function cond(
  type: ConditionType,
  remainingTurns: number,
  intensity?: number,
): ActiveCondition {
  const base: ActiveCondition = {
    type,
    remainingTurns,
    maxTurns: CONDITION_DATA[type].maxTurns,
  };
  return intensity === undefined ? base : { ...base, intensity };
}

// hpFraction's five cases, carried over unchanged from the deleted layout.test.ts —
// the subject moved modules, the expectations did not.
describe('hpFraction (clamped [0,1])', () => {
  it('computes the fraction', () => {
    expect(hpFraction(5, 20)).toBe(0.25);
  });
  it('is 0 at zero HP', () => {
    expect(hpFraction(0, 20)).toBe(0);
  });
  it('clamps above max to 1', () => {
    expect(hpFraction(30, 20)).toBe(1);
  });
  it('clamps negative to 0', () => {
    expect(hpFraction(-5, 20)).toBe(0);
  });
  it('is 0 when maxHp is non-positive (no divide-by-zero)', () => {
    expect(hpFraction(5, 0)).toBe(0);
  });
});

describe('barModel — what the player reads off a bar', () => {
  it('reports a wounded combatant as "34/60" at 34/60 = 0.56666...', () => {
    const m = barModel(34, 60);
    expect(m.text).toBe('34/60');
    expect(m.fraction).toBeCloseTo(34 / 60, 9);
    expect(m.value).toBe(34);
    expect(m.max).toBe(60);
  });

  it('reports a downed combatant as "0/60" with an empty bar', () => {
    const m = barModel(0, 60);
    expect(m.text).toBe('0/60');
    expect(m.fraction).toBe(0);
  });

  it('reports a full combatant as a completely full bar', () => {
    expect(barModel(60, 60).fraction).toBe(1);
  });

  it('clamps an over-full value to a full bar without lying about the number', () => {
    const m = barModel(75, 60);
    expect(m.fraction).toBe(1);
    // The readout still reports what the engine said — the bar clamps, the text does not.
    expect(m.text).toBe('75/60');
  });

  it('clamps a negative value to an empty bar', () => {
    expect(barModel(-4, 60).fraction).toBe(0);
  });

  it('survives a non-positive max with no divide-by-zero', () => {
    expect(barModel(5, 0).fraction).toBe(0);
    expect(barModel(5, -10).fraction).toBe(0);
    expect(Number.isNaN(barModel(5, 0).fraction)).toBe(false);
  });
});

describe('barCells — the segments the player actually counts', () => {
  it('fills 5 of 9 at just over half', () => {
    // 0.5667 * 9 = 5.1003 -> 5 whole segments.
    expect(barCells(0.5667, 9)).toBe(5);
  });

  it('a LIVING combatant never shows an empty bar', () => {
    // 1 HP of 60 across 9 cells is 0.15 of a segment; flooring alone would read 0,
    // i.e. visually dead while still alive.
    expect(barCells(1 / 60, 9)).toBeGreaterThanOrEqual(1);
    expect(barCells(1 / 60, 9)).toBe(1);
  });

  it('a WOUNDED combatant never shows a full bar', () => {
    // 59 HP of 60 is 8.85 of 9 segments; rounding alone would read 9, i.e. untouched.
    expect(barCells(59 / 60, 9)).toBeLessThanOrEqual(8);
    expect(barCells(59 / 60, 9)).toBe(8);
  });

  it('only a true zero reads empty', () => {
    expect(barCells(0, 9)).toBe(0);
  });

  it('only a true full reads full', () => {
    expect(barCells(1, 9)).toBe(9);
  });

  it('is monotonic — more HP never shows fewer segments', () => {
    let previous = barCells(0, 9);
    for (let hp = 1; hp <= 60; hp += 1) {
      const cells = barCells(hp / 60, 9);
      expect(cells).toBeGreaterThanOrEqual(previous);
      expect(cells).toBeLessThanOrEqual(9);
      previous = cells;
    }
    expect(previous).toBe(9);
  });

  it('degrades safely on nonsense input', () => {
    expect(barCells(Number.NaN, 9)).toBe(0);
    expect(barCells(0.5, 0)).toBe(0);
    expect(barCells(0.5, -3)).toBe(0);
    expect(barCells(-2, 9)).toBe(0);
    expect(barCells(4, 9)).toBe(9);
  });
});

describe('resourceBarModel', () => {
  it('carries the caption and tone alongside the bar numbers', () => {
    const m = resourceBarModel('CHARGES', 2, 3, 'accent');
    expect(m.label).toBe('CHARGES');
    expect(m.tone).toBe('accent');
    expect(m.text).toBe('2/3');
    expect(m.fraction).toBeCloseTo(2 / 3, 9);
  });
});

describe('conditionChips — what a status row says', () => {
  it('labels a stacked Burn and a Stun with the engine display names and counts', () => {
    const chips = conditionChips([cond('burn', 2, 2), cond('stun', 1)]);
    const byType = Object.fromEntries(chips.map((c) => [c.type, c]));
    expect(byType['burn']!.label).toBe('Burn ×2');
    expect(byType['burn']!.count).toBe(2);
    expect(byType['stun']!.label).toBe('Stun ×1');
    expect(byType['stun']!.count).toBe(1);
  });

  it('tones Stun as control and Burn as harm', () => {
    const chips = conditionChips([cond('burn', 2, 2), cond('stun', 1)]);
    expect(chips.find((c) => c.type === 'stun')!.tone).toBe('control');
    expect(chips.find((c) => c.type === 'burn')!.tone).toBe('harm');
  });

  it('orders control before harm before boon', () => {
    const chips = conditionChips([
      cond('regeneration', 2), // boon
      cond('burn', 2, 2), // harm
      cond('stun', 1), // control
    ]);
    expect(chips.map((c) => c.type)).toEqual(['stun', 'burn', 'regeneration']);
  });

  it('breaks ties in the engine order the conditions were stored in (stable)', () => {
    const chips = conditionChips([cond('poison', 2), cond('bleed', 2), cond('burn', 2)]);
    // All three are harm, so nothing may reshuffle them.
    expect(chips.map((c) => c.type)).toEqual(['poison', 'bleed', 'burn']);
  });

  it('reads a non-stacking condition as x1 even if an intensity is present', () => {
    // Stun is 'refresh': it never stacks, so a stray intensity must not become "Stun x3".
    expect(conditionChip(cond('stun', 1, 3)).label).toBe('Stun ×1');
  });

  it('reads a DoT with no recorded intensity as x1', () => {
    // Pre-M2 saves carry no `intensity`; it means one stack, not zero.
    expect(conditionChip(cond('poison', 2)).count).toBe(1);
  });

  it('carries the remaining turns through untouched', () => {
    expect(conditionChip(cond('fracture', 97)).remainingTurns).toBe(97);
  });

  it('renders an empty condition row as no chips', () => {
    expect(conditionChips([])).toEqual([]);
  });
});

describe('CONDITION_TONE is exhaustive and agrees with the engine', () => {
  it('assigns a tone to every condition the engine defines', () => {
    for (const type of Object.keys(CONDITION_DATA) as ConditionType[]) {
      expect(CONDITION_TONE[type], `no tone for '${type}'`).toBeDefined();
    }
  });

  it("marks exactly the engine's turn-skipping conditions as 'control'", () => {
    // Derived from the engine's own CONTROL_CONDITIONS set, not from this module's table:
    // if the engine ever reclassifies a condition, this fails rather than drifting.
    for (const type of Object.keys(CONDITION_DATA) as ConditionType[]) {
      expect(CONDITION_TONE[type] === 'control', `tone mismatch for '${type}'`).toBe(
        CONTROL_CONDITIONS.has(type),
      );
    }
  });

  it('names every chip from CONDITION_DATA, so a rename cannot drift', () => {
    for (const type of Object.keys(CONDITION_DATA) as ConditionType[]) {
      expect(conditionChip(cond(type, 1)).name).toBe(CONDITION_DATA[type].displayName);
    }
  });
});

describe('rowModel', () => {
  it('carries a present value through', () => {
    expect(rowModel('Head', 'Rusted Circlet · Common')).toEqual({
      label: 'Head',
      value: 'Rusted Circlet · Common',
      empty: false,
    });
  });

  it('renders an unfilled slot as the shared "(empty)" state', () => {
    for (const nothing of [null, undefined, '']) {
      expect(rowModel('Head', nothing)).toEqual({
        label: 'Head',
        value: '(empty)',
        empty: true,
      });
    }
  });
});

describe('buttonModel', () => {
  it('is enabled by default', () => {
    expect(buttonModel('Fight')).toEqual({ label: 'Fight', disabled: false });
  });

  it('records an unaffordable action as disabled', () => {
    expect(buttonModel('Overclock', { disabled: true, hint: '3⚡' })).toEqual({
      label: 'Overclock',
      disabled: true,
      hint: '3⚡',
    });
  });

  it('omits the hint key entirely when there is no hint', () => {
    expect('hint' in buttonModel('Rest')).toBe(false);
  });
});

// =========================================================================================
// The VIEW half of `buttonModel.disabled` — added by `#0c persistence-and-reach`.
//
// `disabled: true` is only worth having if the view makes the button INERT, not merely grey.
// The Potion button is why this matters now: it used to be unconditional, and pressing it at
// 0 potions dispatched a whole engine step that resolved nothing. `potionControl` decides the
// flag (tested in `view-model.test.ts`), but the flag means nothing unless `actionButton`
// honours it — and `components.ts` is DOM code the repo deliberately does not unit-test
// (recorded deviation in its own header: Vitest runs `environment: 'node'`).
//
// So the contract is asserted on the SOURCE. This closes the one gap between "the model says
// disabled" and "a stray click cannot dispatch".
// =========================================================================================

describe('actionButton makes a disabled button inert, not just grey', () => {
  const source = readFileSync(fileURLToPath(new URL('./components.ts', import.meta.url)), 'utf8');
  // Comments stripped: the prose in that file describes the behaviour in words that would
  // otherwise satisfy these patterns on their own.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = code.indexOf('export function actionButton(');
  const body = code.slice(start, code.indexOf('\n}', start));

  it('has an actionButton to guard (the anchor exists)', () => {
    expect(start, 'actionButton is gone — this guard has gone stale').toBeGreaterThan(-1);
    expect(body).toMatch(/model\.disabled/);
  });

  it('attaches the click listener ONLY on the enabled branch', () => {
    // There must be exactly one `addEventListener`, and it must sit after the `else` — i.e.
    // inside the branch taken when the model is NOT disabled. A handler attached before the
    // check, or in both branches, means a disabled button still dispatches.
    const listeners = body.match(/addEventListener\s*\(/g) ?? [];
    expect(listeners, 'actionButton no longer attaches exactly one click listener').toHaveLength(1);
    const elseAt = body.search(/\}\s*else\s*\{/);
    const listenAt = body.search(/addEventListener\s*\(/);
    expect(elseAt, 'the disabled/enabled branch is gone').toBeGreaterThan(-1);
    expect(
      listenAt,
      'the click handler is attached outside the enabled branch — a disabled button would ' +
        'still dispatch, and the Potion button at 0 potions is exactly that bug',
    ).toBeGreaterThan(elseAt);
  });

  it('and still marks it disabled to the browser as well as to the eye', () => {
    // `el.disabled = true` is what stops keyboard activation and removes it from the tab
    // order; the class is only paint. Both are required.
    expect(body).toMatch(/\.\s*disabled\s*=\s*true/);
    expect(body).toMatch(/is-disabled/);
  });
});
