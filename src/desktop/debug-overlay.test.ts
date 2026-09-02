// G40 — the debug overlay eats a backtick typed into the name field.
//
// The overlay bound `keydown` on `window` and called `preventDefault()` for ANY backtick,
// anywhere. The character-name field is an `<input>` on that same window, so a player whose
// name contains a backtick simply could not type it: the key was swallowed and the debug
// overlay opened over the game instead. The overlay's own filter box has the same problem.
//
// The DECISION is now a pure predicate, so it is tested here headlessly with plain object
// stand-ins — no DOM, no jsdom dependency (the repo's standing rule that only pure logic is
// unit-tested). Building the overlay's elements is still untested and still NEEDS-HUMAN.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isTypingTarget, togglesOverlay, handleOverlayKey } from './debug-overlay.ts';

/** A stand-in for an element, carrying only what the predicate reads. */
const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });

const BODY = el('BODY');

describe('isTypingTarget', () => {
  it('is true for the three things you type into', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true); // type-ahead selection is typing
  });

  it('is true for anything made contentEditable', () => {
    expect(isTypingTarget(el('DIV', true))).toBe(true);
  });

  it('is case-insensitive about the tag name', () => {
    // `tagName` is upper-case in HTML documents and lower-case in XML/XHTML ones, and a
    // stand-in in some future test could be either. Normalising costs nothing.
    expect(isTypingTarget(el('input'))).toBe(true);
    expect(isTypingTarget(el('TeXtArEa'))).toBe(true);
  });

  it('is false for ordinary elements and for junk', () => {
    expect(isTypingTarget(BODY)).toBe(false);
    expect(isTypingTarget(el('DIV'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    // Never throws on a target that is not an element at all.
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget('INPUT')).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

describe('togglesOverlay', () => {
  it('opens on ` or F2 from the page body', () => {
    expect(togglesOverlay({ key: '`', target: BODY })).toBe(true);
    expect(togglesOverlay({ key: 'F2', target: BODY })).toBe(true);
  });

  it('does NOT open when the key is going into a field — this is G40', () => {
    // The exact reported symptom: a backtick typed into the character-name input.
    expect(togglesOverlay({ key: '`', target: el('INPUT') })).toBe(false);
    expect(togglesOverlay({ key: 'F2', target: el('INPUT') })).toBe(false);
    expect(togglesOverlay({ key: '`', target: el('TEXTAREA') })).toBe(false);
    expect(togglesOverlay({ key: '`', target: el('DIV', true) })).toBe(false);
  });

  it('ignores every other key, wherever it is aimed', () => {
    for (const key of ['a', 'Enter', 'Escape', '~', 'F1', 'F3', 'Dead', "'"]) {
      expect(togglesOverlay({ key, target: BODY }), key).toBe(false);
    }
  });
});

// =========================================================================================
// THE REACTION, not just the decision — FIX ROUND 2.
//
// Round 1 made the listener's shape a source scan: it asserted that `togglesOverlay` appears,
// that `ev.key ===` does not, and that `preventDefault` comes AFTER the guard. All three
// survive a single-character mutation — flipping `if (!togglesOverlay(ev))` to
// `if (togglesOverlay(ev))` — because every marker is still present and still in order. A
// source scan can see WHICH markers appear and in WHAT ORDER; it is structurally blind to the
// POLARITY of the `if` they hang on.
//
// What that mutation actually does: a backtick on the body returns early, so the overlay
// never opens; and every character typed into the character-name `<input>` reaches
// `preventDefault()` and `toggle()`. The name field becomes untypable and the debug panel
// flickers open on every keystroke — strictly worse than the G40 this began as.
//
// So the ACTION moved into `handleOverlayKey`, which is pure apart from the two callbacks it
// is handed, and is tested here with the same plain-object stand-ins the rest of this file
// uses. Polarity is now a behavioural fact, not a spelling a regex may or may not match.
// =========================================================================================

/** A stand-in keydown that records whether `preventDefault` was called. */
function keyOn(key: string, target: unknown) {
  const calls = { prevented: 0, toggled: 0 };
  const event = {
    key,
    target,
    preventDefault: () => {
      calls.prevented += 1;
    },
  };
  const toggle = () => {
    calls.toggled += 1;
  };
  return { event, toggle, calls };
}

describe('handleOverlayKey — what the listener actually DOES', () => {
  it('a backtick on the page body opens the overlay and consumes the key', () => {
    const { event, toggle, calls } = keyOn('`', BODY);
    handleOverlayKey(event, toggle);
    expect(calls).toEqual({ prevented: 1, toggled: 1 });
  });

  it('F2 does the same', () => {
    const { event, toggle, calls } = keyOn('F2', BODY);
    handleOverlayKey(event, toggle);
    expect(calls).toEqual({ prevented: 1, toggled: 1 });
  });

  it('an ordinary key does NOTHING — it is neither consumed nor acted on', () => {
    // The half an ordering assertion cannot see. If the guard's polarity inverts, this key
    // gets swallowed AND opens the panel.
    for (const key of ['a', 'Z', 'Enter', 'Escape', ' ', '~', "'"]) {
      const { event, toggle, calls } = keyOn(key, BODY);
      handleOverlayKey(event, toggle);
      expect(calls, `"${key}" must be left entirely alone`).toEqual({ prevented: 0, toggled: 0 });
    }
  });

  it('a backtick typed into a FIELD is left alone — this is G40 itself', () => {
    // Not merely "the overlay does not open": `preventDefault` must not fire either, or the
    // character never reaches the input and the name field cannot contain a backtick.
    for (const target of [el('INPUT'), el('TEXTAREA'), el('SELECT'), el('DIV', true)]) {
      const { event, toggle, calls } = keyOn('`', target);
      handleOverlayKey(event, toggle);
      expect(calls, `${(target as { tagName: string }).tagName} swallowed the key`).toEqual({
        prevented: 0,
        toggled: 0,
      });
    }
  });

  it('consumes the key ONLY when it also toggles — the two always agree', () => {
    // The invariant behind both halves, swept over the whole matrix. An inverted guard
    // breaks it in both directions at once: ordinary keys become (1,1) and backticks (0,0).
    const targets = [BODY, el('DIV'), el('INPUT'), el('TEXTAREA'), el('DIV', true)];
    let opened = 0;
    let ignored = 0;
    for (const key of ['`', 'F2', 'a', 'Enter']) {
      for (const target of targets) {
        const { event, toggle, calls } = keyOn(key, target);
        handleOverlayKey(event, toggle);
        expect(calls.prevented, `${key} on ${JSON.stringify(target)}`).toBe(calls.toggled);
        if (calls.toggled > 0) opened += 1;
        else ignored += 1;
      }
    }
    // Non-vacuity: the sweep must contain BOTH outcomes, or "they always agree" is trivially
    // satisfied by a function that never does anything at all.
    expect(opened).toBeGreaterThan(0);
    expect(ignored).toBeGreaterThan(0);
  });
});

// =========================================================================================
// The WIRING. `createDebugOverlay` builds DOM at call time and so is not unit-tested here
// (the repo's standing rule). But a pure function nothing calls is not a fix: reverting the
// listener to its original three lines leaves every test above green while the backtick is
// swallowed exactly as before. So the listener is read.
// =========================================================================================

describe('the keydown listener really uses the predicate', () => {
  const source = readFileSync(fileURLToPath(new URL('./debug-overlay.ts', import.meta.url)), 'utf8');
  // Comments stripped: the prose below quotes the defect it describes.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = code.indexOf("window.addEventListener('keydown'");

  it('has a keydown listener to guard (the anchor exists)', () => {
    expect(start, 'the overlay no longer binds keydown — this guard has gone stale').toBeGreaterThan(-1);
  });

  it('routes the decision through the tested helper, not a raw key comparison', () => {
    const handler = code.slice(start, start + 400);
    expect(handler, 'the listener bypasses the tested reaction').toMatch(/handleOverlayKey\s*\(/);
    // G40's exact shape: comparing `ev.key` in the listener means the decision is made where
    // no test can see it, and `preventDefault` runs before anyone asks whose key it is.
    // Matched with either quote style and any spacing.
    expect(
      handler,
      'the listener compares ev.key itself again — that is where G40 lived',
    ).not.toMatch(/\bev\.key\s*===/);
  });

  it('DELEGATES — it makes no decision and takes no action of its own', () => {
    // FIX ROUND 2 replaces what used to be here. Round 1 asserted an ORDERING —
    // index(preventDefault) > index(togglesOverlay) — to catch `preventDefault` being hoisted
    // above the guard. That was a true improvement and it is still caught, but ordering is
    // blind to POLARITY: flipping `if (!togglesOverlay(ev))` to `if (togglesOverlay(ev))`
    // preserves both markers and their order, and the assertion stayed green.
    //
    // The fix is not a cleverer regex. The whole reaction moved into `handleOverlayKey`,
    // which is behaviourally tested above, so this scan's only remaining job is to prove the
    // listener is a WIRE: it must not re-implement any part of the decision or the action
    // locally, because anything it does inline is once again invisible to those tests.
    const handler = code.slice(start, start + 400);
    for (const [pattern, what] of [
      [/preventDefault\s*\(/, 'calls preventDefault itself'],
      [/\btoggle\s*\(\s*\)/, 'calls toggle itself'],
      [/\bif\s*\(/, 'makes a decision of its own'],
      [/togglesOverlay\s*\(/, 'consults the predicate directly instead of the reaction'],
    ] as const) {
      expect(
        handler,
        `the keydown listener ${what} — put it in handleOverlayKey, where it is tested`,
      ).not.toMatch(pattern);
    }
  });
});
