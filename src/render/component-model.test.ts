import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { actionButton, appendLogLine } from './components.ts';
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

// =========================================================================================
// `appendLogLine`'s two stated contracts — added in FIX ROUND 1.
//
// The doc comment on `appendLogLine` justifies itself twice, and NEITHER claim was checked:
//
//   1. "a native `<details>/<summary>`, not a div with a click handler … the browser gives
//      keyboard operation, focus order, and the correct screen-reader announcement for free".
//      Swapping `createElement('details')` for `'div'` left all 1290 tests green — the
//      expander silently becomes an inert div, and NEEDS-HUMAN item 1 asks a person to check
//      by hand that `Tab` reaches it. That is the wrong place for a check that can be
//      anchored headlessly.
//   2. "The text is set as `textContent` throughout … neither is ever markup." An enemy's
//      generated full name flows through here. Swapping in `innerHTML` was also green.
//
// Same source-scan pattern as `actionButton` above, for the same reason: `components.ts` is
// DOM assembly that this repo deliberately does not unit-test, so the contract is asserted
// on the shipping source.
// =========================================================================================

describe('appendLogLine keeps the native expander, and sets text as text', () => {
  const source = readFileSync(fileURLToPath(new URL('./components.ts', import.meta.url)), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = code.indexOf('export function appendLogLine(');
  const body = code.slice(start, code.indexOf('\n}', start));

  it('has an appendLogLine to guard (the anchor exists)', () => {
    expect(start, 'appendLogLine is gone — this guard has gone stale').toBeGreaterThan(-1);
    expect(body).toMatch(/line\.detail/);
  });

  it('builds a real <details>/<summary>, not a div pretending to be one', () => {
    // Both elements are required: a `<details>` with no `<summary>` has no clickable label,
    // and a `<summary>` outside a `<details>` does nothing at all. Quote style is free.
    expect(
      body,
      'the expander is no longer a native <details> — keyboard operation, focus order and ' +
        'the screen-reader expanded/collapsed announcement are all silently lost',
    ).toMatch(/createElement\s*\(\s*['"`]details['"`]\s*\)/);
    expect(body).toMatch(/createElement\s*\(\s*['"`]summary['"`]\s*\)/);
  });

  it('writes no HTML anywhere — every string here can contain a name', () => {
    // The same four spellings `rendererSource.test.ts` guards `renderSheet` against; that
    // regex covers `renderSheet` only, and `appendLogLine` shipped in the same unit.
    const HTML_WRITE =
      /\.\s*(?:inner|outer)HTML\s*=|insertAdjacentHTML\s*\(|createContextualFragment\s*\(/;
    expect(body, 'appendLogLine is writing HTML — a log line carries the enemy full name').not.toMatch(
      HTML_WRITE,
    );
    // ...and it does set text, or the "must not" above would pass by rendering nothing.
    expect(body).toMatch(/\.\s*textContent\s*=/);
  });
});

// =========================================================================================
// BEHAVIOURAL tests for the two view builders — FIX ROUND 2.
//
// WHY THE SOURCE SCANS ABOVE ARE NOT ENOUGH. They assert which markers appear and in what
// order. That is structurally blind to the POLARITY of the `if` those markers hang on, and
// both builders turn on exactly one `if`:
//
//   · `actionButton`  — `if (model.disabled)`. Flip it and EVERY ENABLED BUTTON IN THE GAME
//     gets `disabled = true` and no handler, while every disabled one gets a live handler.
//     AC-46's whole contract is inverted, and the ordering assertion above cannot see it.
//   · `appendLogLine` — `if (line.detail === undefined)`. Flip it and plain beats grow empty
//     expanders while every attack LOSES its dice — G18's second half, silently dead again.
//     (That second site is not in the report; it is the same root cause, found by looking for
//     it here.)
//
// The repo's rule is that only pure logic is unit-tested, because Vitest runs
// `environment: 'node'` and there is no DOM. But both builders are pure functions OF the
// document they are handed — so the document is stood in for, exactly as `persist.test.ts`
// and `unlockStorage.test.ts` already stand in for `localStorage`. No jsdom, no new
// dependency, ~30 lines. That is a far more durable guard than a cleverer regex, and it is
// the form `CLAUDE.md`'s long-term principle asks for.
// =========================================================================================

interface FakeElement {
  tagName: string;
  className: string;
  textContent: string;
  disabled: boolean;
  classes: string[];
  classList: { add(name: string): void };
  listeners: { type: string; handler: () => void }[];
  children: FakeElement[];
  addEventListener(type: string, handler: () => void, opts?: unknown): void;
  appendChild(child: FakeElement): FakeElement;
  append(...kids: FakeElement[]): void;
}

function fakeElement(tagName: string): FakeElement {
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    disabled: false,
    classes: [],
    listeners: [],
    children: [],
    classList: { add: (name: string) => void el.classes.push(name) },
    addEventListener: (type, handler) => void el.listeners.push({ type, handler }),
    appendChild: (child) => {
      el.children.push(child);
      return child;
    },
    append: (...kids) => void el.children.push(...kids),
  };
  return el;
}

const g = globalThis as { document?: unknown };
function withFakeDocument<T>(body: () => T): T {
  const had = 'document' in g;
  const previous = g.document;
  g.document = { createElement: (tag: string) => fakeElement(tag) };
  try {
    return body();
  } finally {
    if (had) g.document = previous;
    else delete g.document;
  }
}

/** Build a button through the real `actionButton` and read what came out. */
function builtButton(model: Parameters<typeof actionButton>[0], onClick: () => void): FakeElement {
  return withFakeDocument(() => actionButton(model, onClick) as unknown as FakeElement);
}

describe('actionButton — a disabled button is INERT, not merely grey', () => {
  it('an enabled button carries exactly one live click handler', () => {
    let clicks = 0;
    const el = builtButton(buttonModel('Fight'), () => {
      clicks += 1;
    });
    expect(el.tagName).toBe('BUTTON');
    expect(el.disabled).toBe(false);
    expect(el.classes).not.toContain('is-disabled');
    expect(el.listeners.map((l) => l.type)).toEqual(['click']);
    // The handler is the one we passed, not some other function.
    el.listeners[0]!.handler();
    expect(clicks).toBe(1);
  });

  it('a disabled button carries NO handler at all — a stray press cannot dispatch', () => {
    let clicks = 0;
    const el = builtButton(buttonModel('Potion', { disabled: true, hint: '(0)' }), () => {
      clicks += 1;
    });
    expect(el.disabled).toBe(true);
    expect(el.classes).toContain('is-disabled');
    expect(el.listeners, 'a disabled button was given a click handler').toEqual([]);
    expect(clicks).toBe(0);
  });

  it('the hint is appended to the label, and omitted when there is none', () => {
    expect(builtButton(buttonModel('Cast', { hint: '(2⚡)' }), () => {}).textContent).toBe('Cast (2⚡)');
    expect(builtButton(buttonModel('Rest'), () => {}).textContent).toBe('Rest');
  });
});

describe('appendLogLine — the expander appears exactly when there are dice', () => {
  function appended(line: { text: string; detail?: string }): FakeElement {
    return withFakeDocument(() => {
      const parent = fakeElement('div');
      appendLogLine(parent as unknown as HTMLElement, line);
      expect(parent.children).toHaveLength(1);
      return parent.children[0]!;
    });
  }

  it('a beat with NO dice is a plain line — no empty expander to tab through', () => {
    const el = appended({ text: 'You escape into the Void.' });
    expect(el.textContent).toBe('You escape into the Void.');
    expect(el.children, 'a plain beat grew an expander it has nothing to put in').toEqual([]);
  });

  it('a beat WITH dice becomes a native details/summary carrying both strings', () => {
    const el = appended({ text: 'You strike — hit for 4 damage.', detail: 'd20+2 = 17 vs AC 13 → hit, 1d8 = 4' });
    // The line itself holds no text; the summary does. (If the polarity inverted, the text
    // would be here and the detail would be gone entirely.)
    expect(el.textContent).toBe('');
    expect(el.children).toHaveLength(1);
    const details = el.children[0]!;
    expect(details.tagName).toBe('DETAILS');
    expect(details.children.map((c) => c.tagName)).toEqual(['SUMMARY', 'DIV']);
    expect(details.children[0]!.textContent).toBe('You strike — hit for 4 damage.');
    expect(details.children[1]!.textContent).toBe('d20+2 = 17 vs AC 13 → hit, 1d8 = 4');
  });

  it('the dice are never lost — every detail string reaches the DOM', () => {
    // The sharpest form of the polarity check: a beat that HAS dice must render them
    // somewhere. An inverted branch drops `line.detail` on the floor without erroring.
    const el = appended({ text: 'beat', detail: 'nat 20 → critical, 1d8 + 1d8 = 9' });
    const rendered = JSON.stringify(el);
    expect(rendered, 'the roll detail never reached the page').toContain('nat 20 → critical');
  });
});
