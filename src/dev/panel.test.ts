// The panel's PURE reactions, tested headlessly with plain-object stand-ins — the exact
// idiom `debug-overlay.test.ts` established, and for the same reason: a source scan can see
// WHICH markers appear and in WHAT ORDER, and is structurally blind to the POLARITY of the
// `if` they hang on. So the decision and the action both live in a pure function, and the
// scan's only remaining job is to prove the listener is a wire.
//
// Building the panel's DOM is not unit-tested here (the repo's standing rule: only pure logic
// is), which is why `HUMAN-CHECKS.md` carries the on-screen items.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';
import { PANEL_ID, SLOW_JUMP_MS, bootPanel, handlePanelKey, panelAllowed, togglesPanel } from './panel.ts';
import { togglesOverlay } from '../desktop/debug-overlay.ts';

/** A stand-in for an element, carrying only what the predicate reads. */
const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });
const BODY = el('BODY');

// =========================================================================================
// 1. `panelAllowed` — belt and braces behind the bundle-level exclusion.
// =========================================================================================

describe('panelAllowed', () => {
  it('is false for a packaged build (file:)', () => {
    expect(panelAllowed({ protocol: 'file:' })).toBe(false);
  });

  it('is true for the dev server, where the author works', () => {
    expect(panelAllowed({ protocol: 'http:' })).toBe(true);
    expect(panelAllowed({ protocol: 'https:' })).toBe(true);
  });

  it('both directions matter — an inverted guard ships the panel and hides it in dev', () => {
    // Stated as the invariant rather than two examples, so the polarity is the assertion.
    const packaged = panelAllowed({ protocol: 'file:' });
    const dev = panelAllowed({ protocol: 'http:' });
    expect(packaged).not.toBe(dev);
    expect(packaged).toBe(false);
  });
});

// =========================================================================================
// 2. `bootPanel` — the reaction, so an inverted guard is a behavioural failure.
// =========================================================================================

describe('bootPanel', () => {
  /** A mount stand-in that counts, so "did nothing at all" is checkable. */
  function counting() {
    const calls = { mounted: 0 };
    return { calls, mount: () => void (calls.mounted += 1) };
  }

  it('mounts on the dev server and reports that it did', () => {
    const { calls, mount } = counting();
    expect(bootPanel({ protocol: 'http:' }, mount)).toBe(true);
    expect(calls.mounted).toBe(1);
  });

  it('does NOTHING AT ALL in a packaged build — not merely "returns false"', () => {
    const { calls, mount } = counting();
    expect(bootPanel({ protocol: 'file:' }, mount)).toBe(false);
    expect(calls.mounted, 'the panel was built in a packaged build').toBe(0);
  });

  it('the return value and the mount always agree', () => {
    // The invariant behind both halves. An inverted guard breaks it in both directions at
    // once, and a `bootPanel` that always mounted would break it in one.
    let mountedSomewhere = 0;
    let refusedSomewhere = 0;
    for (const protocol of ['file:', 'http:', 'https:', 'app:', '']) {
      const { calls, mount } = counting();
      const booted = bootPanel({ protocol }, mount);
      expect(calls.mounted > 0, protocol).toBe(booted);
      if (booted) mountedSomewhere += 1;
      else refusedSomewhere += 1;
    }
    // Non-vacuity: the sweep must contain BOTH outcomes, or "they agree" is satisfied by a
    // function that never does anything.
    expect(mountedSomewhere).toBeGreaterThan(0);
    expect(refusedSomewhere).toBeGreaterThan(0);
  });
});

// =========================================================================================
// 3. The key. F3 — and the two dev surfaces must not fight over it.
// =========================================================================================

describe('togglesPanel', () => {
  it('opens on F3 from the page body', () => {
    expect(togglesPanel({ key: 'F3', target: BODY })).toBe(true);
  });

  it('does NOT open when the key is going into a field (the G40 rule, imported not rebuilt)', () => {
    for (const target of [el('INPUT'), el('TEXTAREA'), el('SELECT'), el('DIV', true)]) {
      expect(togglesPanel({ key: 'F3', target }), (target as { tagName: string }).tagName).toBe(false);
    }
  });

  it('ignores every other key, wherever it is aimed', () => {
    for (const key of ['a', 'Enter', 'Escape', '~', 'F1', 'F4', 'Dead', "'"]) {
      expect(togglesPanel({ key, target: BODY }), key).toBe(false);
    }
  });

  it('the two dev surfaces own different keys and neither answers the other one', () => {
    // The panel is a SIBLING of the log overlay, so both can be open at once. If either
    // predicate answered the other's key, one panel would swallow the other's toggle.
    expect(togglesPanel({ key: '`', target: BODY })).toBe(false);
    expect(togglesPanel({ key: 'F2', target: BODY })).toBe(false);
    expect(togglesOverlay({ key: 'F3', target: BODY })).toBe(false);
    // ...and each really does answer its own (or the check above proves nothing).
    expect(togglesPanel({ key: 'F3', target: BODY })).toBe(true);
    expect(togglesOverlay({ key: '`', target: BODY })).toBe(true);
    expect(togglesOverlay({ key: 'F2', target: BODY })).toBe(true);
  });
});

// =========================================================================================
// 4. `handlePanelKey` — what the listener actually DOES.
// =========================================================================================

/** A stand-in keydown that records whether `preventDefault` was called. */
function keyOn(key: string, target: unknown) {
  const calls = { prevented: 0, toggled: 0 };
  return {
    event: { key, target, preventDefault: () => void (calls.prevented += 1) },
    toggle: () => void (calls.toggled += 1),
    calls,
  };
}

describe('handlePanelKey', () => {
  it('F3 on the page body opens the panel and consumes the key', () => {
    const { event, toggle, calls } = keyOn('F3', BODY);
    handlePanelKey(event, toggle);
    expect(calls).toEqual({ prevented: 1, toggled: 1 });
  });

  it('an ordinary key is left entirely alone — neither consumed nor acted on', () => {
    for (const key of ['a', 'Z', 'Enter', 'Escape', ' ', '`', 'F2']) {
      const { event, toggle, calls } = keyOn(key, BODY);
      handlePanelKey(event, toggle);
      expect(calls, `"${key}" must be left alone`).toEqual({ prevented: 0, toggled: 0 });
    }
  });

  it('F3 typed into a FIELD is left alone — preventDefault must not fire either', () => {
    for (const target of [el('INPUT'), el('TEXTAREA'), el('SELECT'), el('DIV', true)]) {
      const { event, toggle, calls } = keyOn('F3', target);
      handlePanelKey(event, toggle);
      expect(calls, `${(target as { tagName: string }).tagName} swallowed the key`).toEqual({
        prevented: 0,
        toggled: 0,
      });
    }
  });

  it('consumes the key ONLY when it also toggles — the two always agree', () => {
    const targets = [BODY, el('DIV'), el('INPUT'), el('TEXTAREA'), el('DIV', true)];
    let opened = 0;
    let ignored = 0;
    for (const key of ['F3', '`', 'a', 'Enter']) {
      for (const target of targets) {
        const { event, toggle, calls } = keyOn(key, target);
        handlePanelKey(event, toggle);
        expect(calls.prevented, `${key} on ${JSON.stringify(target)}`).toBe(calls.toggled);
        if (calls.toggled > 0) opened += 1;
        else ignored += 1;
      }
    }
    // Non-vacuity in both directions: an inverted guard turns ordinary keys into (1,1) and
    // F3 into (0,0), and both counters below would still be non-zero — which is why the
    // per-case assertions above exist as well as this invariant.
    expect(opened).toBeGreaterThan(0);
    expect(ignored).toBeGreaterThan(0);
    // The exact shape of the matrix, derived rather than observed: 4 keys x 5 targets = 20
    // cases; only F3 acts, and only on the two NON-typing targets (BODY and a plain DIV) —
    // the other three are INPUT, TEXTAREA and a contentEditable DIV. So 2 open, 18 ignored.
    expect(opened + ignored).toBe(20);
    expect(opened).toBe(2);
    expect(ignored).toBe(18);
  });
});

// =========================================================================================
// 5. The source scans. Each is a SUPPLEMENT to the behavioural tests above — never the only
//    thing standing between the panel and a defect.
// =========================================================================================

const RAW = readFileSync(fileURLToPath(new URL('./panel.ts', import.meta.url)), 'utf8');
const SOURCE = stripComments(RAW);

describe('the panel source', () => {
  it('the strip left the file intact (or every scan below reads a hole)', () => {
    expect(stripReachesEndOfFile(RAW), 'the strip ran off the end of panel.ts').toBe(true);
    expect(SOURCE).toMatch(/export function mountDebugPanel\(/);
    expect(SOURCE).toMatch(/function buildPanel\(/);
    expect(SOURCE, 'the strip ate the tail of panel.ts').toMatch(/const STAT_OPTIONS/);
    expect(SOURCE.length).toBeLessThan(RAW.length);
  });

  it('never assigns innerHTML — a pasted envelope is UNTRUSTED TEXT', () => {
    // The state-JSON box takes text from a bug report, and generated item / enemy names flow
    // through the status line. Loose on purpose: `innerHTML`, `outerHTML`,
    // `insertAdjacentHTML` and `createContextualFragment` are one defect in four costumes.
    const HTML_WRITE =
      /\.\s*(?:inner|outer)HTML\s*=|insertAdjacentHTML\s*\(|createContextualFragment\s*\(/;
    expect(SOURCE, 'the panel writes HTML — a pasted state JSON would be live markup').not.toMatch(
      HTML_WRITE,
    );
  });

  it('...and it really does render text, so the check above has something to guard', () => {
    expect(SOURCE, 'the panel sets no textContent at all — how is it rendering?').toMatch(
      /\.\s*textContent\s*=/,
    );
    expect(SOURCE).toMatch(/document\.createElement\s*\(/);
  });

  it('the keydown listener is a WIRE: it decides nothing and does nothing itself', () => {
    const start = SOURCE.indexOf("window.addEventListener('keydown'");
    expect(start, 'the panel no longer binds keydown — this guard has gone stale').toBeGreaterThan(-1);
    const handler = SOURCE.slice(start, start + 400);
    expect(handler, 'the listener bypasses the tested reaction').toMatch(/handlePanelKey\s*\(/);
    for (const [pattern, what] of [
      [/preventDefault\s*\(/, 'calls preventDefault itself'],
      [/\btoggle\s*\(\s*\)/, 'calls toggle itself'],
      [/\bif\s*\(/, 'makes a decision of its own'],
      [/togglesPanel\s*\(/, 'consults the predicate directly instead of the reaction'],
      [/\bev\.key\s*===/, 'compares ev.key itself — that is where G40 lived'],
    ] as const) {
      expect(
        handler,
        `the keydown listener ${what} — put it in handlePanelKey, where it is tested`,
      ).not.toMatch(pattern);
    }
  });

  it('the mount goes through bootPanel, so the packaged-build refusal cannot be bypassed', () => {
    const start = SOURCE.indexOf('export function mountDebugPanel(');
    const body = SOURCE.slice(start, SOURCE.indexOf('\n}', start));
    expect(body).toMatch(/bootPanel\s*\(/);
    // The defect this catches: `mountDebugPanel` calling `buildPanel` directly and leaving
    // `bootPanel` as a tested function nothing invokes.
    expect(body, 'mountDebugPanel builds the panel without consulting bootPanel').not.toMatch(
      /buildPanel\s*\(\s*deps\s*\)\s*;/,
    );
  });

  it('every failure path logs BEFORE it recovers (principle 7)', () => {
    // A fallback that papers over an error silently destroys the only evidence it happened.
    // Each refusal in the panel says so at `warn` or above.
    const warnings = [...SOURCE.matchAll(/log\.(warn|error)\s*\(\s*'dev'/g)];
    expect(warnings.length, 'the panel has no loud failure logging at all').toBeGreaterThan(3);
    expect(SOURCE, 'a refused jump is silent').toMatch(/'jump REFUSED'/);
    expect(SOURCE, 'a refused paste is silent').toMatch(/'paste REFUSED'/);
    expect(SOURCE, 'a destructive unlock reset is silent').toMatch(/'unlock store RESET/);
  });

  it('marks the session loudly the first time a jump lands', () => {
    // Author's ruling A.1: a jumped run writes to the REAL unlock store, so the log must be
    // able to say that a class was unlocked from a state nobody played to. This line is the
    // only evidence of that, and it is a `warn` so a packaged-level log would still keep it.
    expect(SOURCE).toMatch(/log\.warn\s*\(\s*'dev',\s*'THIS SESSION IS NO LONGER A REAL RUN'/);
  });

  it('measures the jump rather than guessing at it, against its own threshold', () => {
    expect(SOURCE).toMatch(/startTimer\s*\(\s*\)/);
    expect(SOURCE, 'the jump duration is fabricated rather than measured').toMatch(
      /const ms = timer\.stop\(\s*\)/,
    );
    expect(SOURCE, 'the jump log level no longer escalates when it is slow').toMatch(
      /levelForDuration\s*\(\s*ms\s*,\s*SLOW_JUMP_MS\s*,\s*'info'\s*\)/,
    );
    // Module-local, so no dev-only threshold is added to the SHIPPED `SLOW_MS` table.
    expect(SLOW_JUMP_MS).toBeGreaterThan(0);
    expect(SOURCE, 'the panel reached into the shipped SLOW_MS budget').not.toMatch(/SLOW_MS\./);
  });

  it('no number is interpolated into a log message (grep has to keep working)', () => {
    for (const call of SOURCE.matchAll(/log\.(?:debug|info|warn|error|log)\s*\([^\n]*/g)) {
      expect(call[0], `a value is interpolated into a log call: ${call[0].slice(0, 70)}`).not.toMatch(
        /\$\{/,
      );
    }
  });
});

// =========================================================================================
// 6. The marker the bundle sweep looks for.
// =========================================================================================

describe('the panel marker', () => {
  it('is the panel root id, and is distinctive enough to sweep a bundle for', () => {
    expect(PANEL_ID).toBe('void-debug-state-panel');
    expect(SOURCE, 'the marker is not actually in the source that ships nowhere').toContain(PANEL_ID);
  });

  it('appears nowhere in the renderer that DOES ship', () => {
    // If `game.ts` mentioned the marker, the production-bundle sweep in `exclusion.test.ts`
    // would find it in the sourcemap and go red for the wrong reason — or worse, someone
    // would "fix" that by weakening the sweep.
    const renderer = readFileSync(
      fileURLToPath(new URL('../desktop/game.ts', import.meta.url)),
      'utf8',
    );
    expect(renderer).not.toContain(PANEL_ID);
  });
});
