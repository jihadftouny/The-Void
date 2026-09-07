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
import { callsTo, stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';
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
    // ...and what it hands `bootPanel` really is the builder. FOUND BY MUTATION: replacing
    // the callback with a no-op left the whole suite green — the panel still bundles (so the
    // dev control finds its marker) and `bootPanel` is still consulted, but F3 would open
    // nothing at all. The exclusion guards cannot see that, because a panel that builds
    // nothing is still absent from the packaged build.
    expect(body, 'bootPanel is handed something other than buildPanel — F3 would open nothing').toMatch(
      WIRING.bootPanel,
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
// 5b. THE CALL SITES. Every pure helper this unit extracted is also WIRED, and the wiring is
//     what makes it the panel's behaviour.
//
// ⚠ WHY THIS SECTION EXISTS — the defect that made fix round 1 fail. The eight helpers were
// moved out of `buildPanel`'s DOM closures precisely so their decisions could be tested, and
// they were: every inversion INSIDE a helper goes red. But nothing watched the CALL, so the
// helper could simply be bypassed at the shipping site and the whole 1888-test suite stayed
// green. Five did, silently and with a clean `tsc`:
//
//   `applyJump(bundle, deps.adopt)` -> `deps.adopt(bundle)`   adopts every INVALID bundle
//   `createOnce()`                  -> `() => false`          the loud session line never fires
//   `withUnlocks(spec, current)`    -> `spec`                 the unlock snapshot is dropped
//   `grantIntoState(...).ok`        -> forced true            the no-character case is ignored
//   `presetSpec(row, readNumber(...))` -> `presetSpec(row, undefined)`  the seed box is dead
//
// This is the catalogue's "watching the caller after the work moved behind a helper" WITH THE
// POLARITY REVERSED: the callee was watched and the caller was not. Two more (`encounterTarget`,
// `editsFrom`) were caught only incidentally by `noUnusedLocals`, which is not a guard at all —
// one decorative reference (`...(void encounterTarget, {}),`) makes that compile too.
//
// So each pin below asserts the ARGUMENT SHAPE, never merely that the identifier appears. A
// SUPPLEMENT, exactly as the rest of this file's scans are: `buildPanel` builds DOM at call
// time and is not unit-tested by standing rule, so reading it is the honest tool.
// =========================================================================================

/**
 * THE CALL-SHAPE PATTERNS, named so the scans below and the self-test at the bottom use the
 * SAME objects. A pattern proved only against a hand-written sample, while the scan quietly
 * uses a second copy, proves nothing about the scan.
 *
 * ⚠ EVERY ONE ENDS `,?\s*\)`, AND THAT IS LOAD-BEARING. These calls will grow arguments, and
 * Prettier wraps a long argument list one-per-line WITH A TRAILING COMMA. A guard that rejects
 * correctly-formatted code is worse than no guard: it trains the next person to weaken or
 * delete it, which is exactly how guards in this project have rotted before. `\s*` alone
 * rejected four of these five.
 */
const WIRING = {
  applyJump: /applyJump\s*\(\s*bundle\s*,\s*deps\.adopt\s*,?\s*\)/,
  encounterTarget:
    /target:\s*encounterTarget\s*\(\s*family\.select\.value\s*,\s*affix\.select\.value\s*,?\s*\)/,
  grantIntoState: /const result = grantIntoState\s*\(\s*current\.state\s*,\s*spec\s*,?\s*\)\s*;/,
  applyEdits: /applyEdits\s*\(\s*current\.state\s*,\s*edits\s*,?\s*\)/,
  bootPanel: /bootPanel\s*\(\s*deps\.env\s*,\s*\(\s*\)\s*=>\s*buildPanel\s*\(\s*deps\s*\)\s*,?\s*\)/,
} as const;

describe('the panel WIRES every helper it was given, not just imports it', () => {
  const start = SOURCE.indexOf('function buildPanel(');
  const BODY = SOURCE.slice(start, SOURCE.indexOf('\n}', start));

  it('there is a buildPanel body to read (the anchor)', () => {
    expect(start, 'buildPanel is gone — every pin below would scan nothing').toBeGreaterThan(-1);
    expect(BODY.length, 'the buildPanel body read as trivially short').toBeGreaterThan(2000);
  });

  it('the jump goes through applyJump, and NOTHING adopts behind its back', () => {
    // C3, the worst of the five. `applyJump` exists because bypassing its validation "adopts
    // every INVALID bundle — which is exactly how a hand-edited state JSON reaches a phase
    // whose `requirePlayer` throws". Calling `deps.adopt` directly produces precisely that.
    expect(BODY, 'the panel no longer routes its jump through applyJump').toMatch(
      WIRING.applyJump,
    );
    // The bypass, in every spelling: `deps.adopt` may be MENTIONED only as applyJump's second
    // argument, never invoked. A call has a `(` after it.
    expect(BODY, 'something adopts a bundle without validating it first').not.toMatch(
      /deps\.adopt\s*\(/,
    );
    expect(
      [...BODY.matchAll(/deps\.adopt/g)].length,
      'deps.adopt is referenced more than once — one of them is not applyJump’s argument',
    ).toBe(1);
    // …and the count invariant alone has ONE hole, so it does not stand alone: destructuring
    // (`const { adopt } = deps;`) erases the `deps.adopt` token entirely, so a dead
    // `void applyJump(bundle, deps.adopt);` beside a live `adopt(bundle)` satisfies the count
    // AND lets an invalid bundle through. Nothing may INVOKE a bare `adopt` either.
    //
    // ⚠ THE WORD BOUNDARY BELOW HAD TO BE WRITTEN BY HAND. Generating this line through a
    // script turned its word-boundary escape into a literal BACKSPACE byte — G41's exact
    // defect, reproduced live while writing this unit, invisible in the diff and in every
    // editor, and caught by `src/log/sourceBytes.test.ts` rather than by anyone reading it.
    // That is what that guard is for. Never write a word-boundary escape into this repo
    // through a heredoc, a shell one-liner, or a Python string.
    expect(
      BODY,
      'a bare `adopt(…)` is called — a destructured alias bypasses applyJump’s validation ' +
        'while leaving the `deps.adopt` count untouched',
    ).not.toMatch(/(?<!\.)\badopt\s*\(/);
  });

  it('the session latch is a real createOnce(), not a constant', () => {
    // C5, and the sharpest of them: `panel.test.ts` scans for the WARNING LITERAL, so
    // replacing the latch with `() => false` leaves the string in the source while the line
    // never fires — a defect invisible because it looks exactly like the desired end state.
    // Appendix A.1 makes that line the ONLY evidence a persisted unlock came from a jump.
    expect(BODY, 'the once-per-session latch is no longer createOnce()').toMatch(
      /const firstJump = createOnce\s*\(\s*\)\s*;/,
    );
    // ...and it is really what gates the warning.
    expect(BODY, 'the loud session line is not gated by the latch').toMatch(
      /if\s*\(\s*firstJump\s*\(\s*\)\s*\)\s*\{[\s\S]{0,120}?THIS SESSION IS NO LONGER A REAL RUN/,
    );
  });

  it('the seed box really reaches the preset jump', () => {
    // C7: `presetSpec(row, undefined, …)` compiles and passes everything — and makes every
    // preset jump use seed 1, so two "different seeds" produce identical runs and the field
    // is decoration.
    expect(BODY, 'the preset jump no longer reads the seed field').toMatch(
      /presetSpec\s*\(\s*row\s*,\s*readNumber\s*\(\s*seed\.input\s*\)\s*,/,
    );
  });

  it('every buildJump call carries the unlock snapshot, through one of the two carriers', () => {
    // C4: dropping `withUnlocks` loses the run's frozen gradual-reveal window (invariant 11).
    // Stated as an invariant over ALL the call sites rather than as three examples, so a
    // fourth jump button added later cannot quietly skip it.
    const calls = callsTo(BODY, 'buildJump');
    expect(
      calls.length,
      'the number of jump buttons changed. This is a DELIBERATE CHECKPOINT, not a bug: a new ' +
        'jump button must carry the live unlock snapshot through `withUnlocks` or `presetSpec` ' +
        '(invariant 11). Read the loop below, satisfy it, then update this count.',
    ).toBe(3);
    for (const call of calls) {
      expect(
        call,
        `a jump is built without carrying the live unlock snapshot: ${call.slice(0, 60)}`,
      ).toMatch(/buildJump\s*\(\s*(?:withUnlocks|presetSpec)\s*\(/);
    }
    // Both carriers are really in use, or the invariant above is satisfied by one of them.
    expect(calls.filter((c) => c.includes('withUnlocks(')).length).toBe(2);
    expect(calls.filter((c) => c.includes('presetSpec(')).length).toBe(1);
  });

  it('a grant goes through grantIntoState AND its refusal is consulted', () => {
    // C6: forcing `.ok` true means a grant with no character reports success and silently
    // does nothing — and `grantIntoState`'s tested refusal becomes unreachable.
    expect(BODY, 'the grant no longer goes through grantIntoState').toMatch(
      WIRING.grantIntoState,
    );
    expect(BODY, 'the grant ignores whether grantIntoState refused').toMatch(
      /if\s*\(\s*!\s*result\.ok\s*\)/,
    );
    // The panel must not roll its own item behind the helper's back.
    expect(BODY, 'the panel calls grantItem directly, bypassing the seeded state draw').not.toMatch(
      /\bgrantItem\s*\(/,
    );
  });

  it('the forced encounter builds its target through encounterTarget', () => {
    // C1, including the decorative-reference variant: `...(void encounterTarget, {})` makes
    // `noUnusedLocals` happy while the target is inlined. Pinning the ARGUMENTS kills both.
    expect(BODY, 'the forced-encounter target is built by hand again').toMatch(
      WIRING.encounterTarget,
    );
    // The inlined shape, which is what the bypass writes.
    expect(BODY, 'an encounter target is hand-built — the "(no affix)" case would be lost').not.toMatch(
      /target:\s*\{\s*kind:\s*['"`]encounter['"`]/,
    );
  });

  it('the player edits are assembled by editsFrom', () => {
    // C2, same story: a raw object literal makes every blank field an `undefined`-valued key.
    expect(BODY, 'the edits object is hand-built again').toMatch(/const edits = editsFrom\s*\(\s*\{/);
    expect(BODY, 'applyEdits is handed something other than editsFrom’s result').toMatch(
      WIRING.applyEdits,
    );
  });

  it('readNumber is a WIRE over parseField, and makes no decision of its own', () => {
    // D2, the eighth member. `if (text === '') return 0` survives tsc and the whole suite, and
    // then every blank box ZEROES momentum, corruption, potions, rests and charges on "Apply
    // edits". The decision now lives in `parseField`, which a test can hand `''`.
    const readStart = SOURCE.indexOf('function readNumber(');
    expect(readStart, 'readNumber is gone — this guard has gone stale').toBeGreaterThan(-1);
    const wire = SOURCE.slice(readStart, SOURCE.indexOf('\n}', readStart));
    expect(wire, 'readNumber no longer delegates to parseField').toMatch(
      /return parseField\s*\(\s*input\.value\s*\)/,
    );
    for (const [pattern, what] of [
      [/\bif\s*\(/, 'makes a decision of its own'],
      [/===\s*['"`]['"`]/, 'compares against the empty string itself'],
      // ⚠ The word boundary is load-bearing, and this guard caught its own bug: an unanchored
      // `Number\(` matches the substring inside `readNumber(` — its own declaration — so it
      // fired on a clean wire. Written as a regex LITERAL, never assembled from a string, so
      // the `\b` cannot become a BACKSPACE byte (the repo-wide trap `sourceBytes.test.ts` owns).
      [/\bNumber\s*\(/, 'parses the value itself'],
    ] as const) {
      expect(wire, `readNumber ${what} — put it in parseField, where it is tested`).not.toMatch(
        pattern,
      );
    }
  });

  it('every wiring pattern accepts a Prettier-wrapped call and still rejects the bypass', () => {
    // ⚠ A GUARD THAT REJECTS CORRECT CODE IS WORSE THAN NO GUARD. These calls will grow
    // arguments, and Prettier wraps a long argument list one-per-line with a TRAILING COMMA.
    // Four of these five patterns originally ended `\s*\)` and rejected exactly that — which
    // trains the next person to weaken or delete the guard, and is how guards in this project
    // have rotted before.
    //
    // Both directions, against the SAME regex objects the real scans above use — a pattern
    // proved against a hand-written sample while the scan quietly holds a second copy proves
    // nothing about the scan.
    const CASES: readonly [keyof typeof WIRING, string, string][] = [
      [
        'applyJump',
        'const outcome = applyJump(\n      bundle,\n      deps.adopt,\n    );',
        'const outcome = deps.adopt(bundle);',
      ],
      [
        'encounterTarget',
        'target: encounterTarget(\n          family.select.value,\n          affix.select.value,\n        ),',
        "target: { kind: 'encounter', familyId: family.select.value },",
      ],
      [
        'grantIntoState',
        'const result = grantIntoState(\n      current.state,\n      spec,\n    );',
        'const result = { ...grantIntoState(current.state, spec), ok: true };',
      ],
      [
        'applyEdits',
        'applyEdits(\n        current.state,\n        edits,\n      )',
        'applyEdits(current.state, { hp: 1 })',
      ],
      [
        'bootPanel',
        'return bootPanel(\n    deps.env,\n    () => buildPanel(deps),\n  );',
        'buildPanel(deps);\n  return true;',
      ],
    ];
    for (const [name, wrapped, bypassed] of CASES) {
      expect(
        WIRING[name].test(wrapped),
        `${name}: the pattern REJECTS a correctly wrapped call — it will fire on good code`,
      ).toBe(true);
      expect(
        WIRING[name].test(bypassed),
        `${name}: the pattern ACCEPTS the bypass — it guards nothing`,
      ).toBe(false);
    }
    // Every pattern in the table is covered, so adding one cannot skip this proof.
    expect(CASES.map(([name]) => name).sort()).toEqual(Object.keys(WIRING).sort());
    expect(CASES).toHaveLength(5);
  });

  it('and every helper the panel imports is actually CALLED, with arguments', () => {
    // The class guard behind the seven specific pins: an import that is never invoked (or is
    // invoked only as a decorative `void` reference) is a helper that does not run.
    for (const helper of [
      'applyJump',
      'createOnce',
      'presetSpec',
      'withUnlocks',
      'grantIntoState',
      'encounterTarget',
      'editsFrom',
      'parseField',
    ]) {
      const calls = callsTo(SOURCE, helper);
      expect(calls.length, `${helper} is imported but never called`).toBeGreaterThan(0);
      expect(
        calls.some((c) => c.replace(/\s/g, '') !== `${helper}()`),
        `${helper} is only ever called with no arguments — is it a decorative reference?`,
      ).toBe(helper !== 'createOnce');
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
