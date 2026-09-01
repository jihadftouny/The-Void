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
import { isTypingTarget, togglesOverlay } from './debug-overlay.ts';

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
// The WIRING. `createDebugOverlay` builds DOM at call time and so is not unit-tested here
// (the repo's standing rule). But a pure predicate nothing calls is not a fix: reverting the
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

  it('routes the decision through togglesOverlay, not a raw key comparison', () => {
    const handler = code.slice(start, start + 400);
    expect(handler, 'the listener bypasses the tested predicate').toMatch(/togglesOverlay\s*\(/);
    // G40's exact shape: comparing `ev.key` in the listener means the decision is made where
    // no test can see it, and `preventDefault` runs before anyone asks whose key it is.
    // Matched with either quote style and any spacing.
    expect(
      handler,
      'the listener compares ev.key itself again — that is where G40 lived',
    ).not.toMatch(/\bev\.key\s*===/);
  });
});
