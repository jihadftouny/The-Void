// SOURCE GUARDS on `src/desktop/game.ts`'s INSTRUMENTATION — plus the G50 pin.
//
// Same technique and same file as `rendererSource.test.ts`, and for the same original reason:
// `game.ts` called the Electron IPC (`window.void.onStatus(...)`) at MODULE SCOPE, so
// importing it in Vitest threw before a line of test code ran. Everything behavioural
// has been pushed into pure helpers that ARE tested (`view-model.ts`, `log-model.ts`,
// `src/log/*`); what is left is WIRING — which timer brackets which call, on which side of
// which await.
//
// PLAN.md #6 landed G51: the start-up is `export function boot()` and the module is inert on
// import, so `boot.test.ts` now boots the real renderer and asserts emitted entries for real.
// These scans are KEPT and re-anchored rather than retired: a scan pins a bracket on every
// path at once, which one behavioural walk cannot.
//
// ---------------------------------------------------------------------------------------
// THE RULES, each of them the scar of a guard that could not fail:
//  1. ASSERT THE ANCHOR. A regex that matches nothing passes trivially.
//  2. ASSERT THE STRIPPED SOURCE IS INTACT. A comment strip is where a guard silently
//     becomes a scan of a HOLE. This unit's own first G6 guard stayed green against G6
//     reintroduced verbatim, because a `/*` inside a LINE comment made the block-comment
//     pass swallow the file's whole import section.
//  3. PIN POLARITY AND SIDE, NOT PRESENCE. "The call appears" is satisfied by an inverted
//     `if` and by a timer stopped on the wrong side of an await.
//  4. WATCH THE DOOR THE CODE ACTUALLY USES. `rendererSource.test.ts` scanned five
//     `saveRun(...)` call sites after all five had moved behind `runMeta()`; faking the
//     value one level down was green through 1315 tests.
// ---------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logLines } from '../render/log-model.ts';
import { buildNarrationPrompt } from '../llm/narrate.ts';
import { createGame } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';

const RAW = readFileSync(fileURLToPath(new URL('./game.ts', import.meta.url)), 'utf8');

const SOURCE = stripComments(RAW);

/** The body of a top-level function, up to the first closing brace in column 0. */
function bodyOf(declaration: string): string {
  const start = SOURCE.indexOf(declaration);
  expect(start, `${declaration} not found — this guard has gone stale, fix it`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

/** Every `log.<method>(...)` call in `source`, with balanced, string-aware parentheses. */
function logCalls(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\blog\.(debug|info|warn|error|log)\s*\(/g)) {
    let depth = 0;
    const start = m.index as number;
    for (let i = start + m[0].length - 1; i < source.length; i += 1) {
      const c = source[i];
      if (c === '"' || c === "'" || c === '`') {
        i += 1;
        while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          found.push(source.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return found;
}

// =========================================================================================
// 0. The tools, before any guard is allowed to trust them (rule 2).
// =========================================================================================

describe('the source scanner itself', () => {
  it('removes comments without eating code', () => {
    expect(stripComments('const a = 1; // gone\nconst b = 2;')).toBe('const a = 1; \nconst b = 2;');
    expect(stripComments('/** doc */\nconst a = 1;')).toBe('\nconst a = 1;');
  });

  it('a glob inside a LINE comment is not a block-comment opener', () => {
    const src = ['// see src/render/** for the projectors', "import x from 'y';", '/** doc */', 'const k = 1;'].join('\n');
    const stripped = stripComments(src);
    expect(stripped).toContain("import x from 'y';");
    expect(stripped).toContain('const k = 1;');
    expect(stripped).not.toContain('projectors');
  });

  it('leaves comment-like text inside a string alone', () => {
    expect(stripComments(`const u = 'https://a/b';`)).toBe(`const u = 'https://a/b';`);
    expect(stripComments('const s = "/* not a comment */";')).toBe('const s = "/* not a comment */";');
  });

  it('logCalls balances nested parentheses and ignores parens inside strings', () => {
    // RED against: counting a parenthesis inside a string literal (which truncates every
    // captured call); and stopping at the first `)` (which truncates any nested call).
    expect(logCalls(`log.info('a', 'b (c)', { d: f(1, g(2)) });`)).toEqual([
      `log.info('a', 'b (c)', { d: f(1, g(2)) })`,
    ]);
    expect(logCalls('const x = 1;')).toEqual([]);
  });

  it('and the strip left game.ts intact (rule 2 — the anchor for everything below)', () => {
    // ⚠ THE ANCHOR SET REACHES THE END OF THE FILE. The scanner does not track regular
    // expression literals, so a regex containing `/*` opens a hole running to the next
    // `*​/`. Anchoring only the top leaves everything BELOW the lowest anchor unprotected
    // — a defect could be hidden there with every guard green. The last two entries are
    // near the bottom of `game.ts` on purpose, so any hole spans an anchor.
    expect(SOURCE, 'the strip ate the imports — every guard below scans a hole').toMatch(
      /import\s*\{\s*createGame,\s*step,\s*awaitingFor\s*\}\s*from\s*'\.\.\/game\/game\.ts'/,
    );
    expect(SOURCE).toMatch(/import\s*\{[^}]*startTimer[^}]*\}\s*from\s*'\.\.\/log\/timing\.ts'/);
    expect(SOURCE).toMatch(/async function dispatch\(/);
    expect(SOURCE).toMatch(/async function narrate\(/);
    expect(SOURCE).toMatch(/function renderChoices\(/);
    expect(SOURCE, 'the strip ate the tail of game.ts — a hole below the last anchor').toMatch(
      /function renderResume\(/,
    );
    // RE-ANCHORED by PLAN.md #6 (G51): the boot block used to be the LAST thing in the file,
    // which is why it was the bottom anchor. It now lives in `boot()` near the top, so it
    // anchors the head, and the function that really is last carries the tail.
    expect(SOURCE, 'the strip ate the boot block').toMatch(/const saved\s*=\s*loadRun\(\s*\)/);
    expect(SOURCE, 'the strip ate the tail of game.ts — the last function is gone').toMatch(
      /function adoptFromPanel\(/,
    );
    expect(
      SOURCE.search(/function adoptFromPanel\(/),
      'the tail anchor is no longer near the tail — pick the function that really is last',
    ).toBeGreaterThan(SOURCE.length * 0.8);
    expect(
      stripReachesEndOfFile(RAW),
      'the strip ran off the END of the file — a regex literal containing `/*` with no later `*/` swallows everything after it, and every anchor ABOVE it still passes',
    ).toBe(true);
    expect(SOURCE.length).toBeLessThan(RAW.length);
  });
});

// =========================================================================================
// 1. G50 — the renderer really calls `foldRunEvents`, with the run's own summary.
//
// `src/desktop/game.ts` folds each step's events into `runSummary`, and `runSummary`
// decides which feats fire at the end of the run. Replacing that one line with a no-op is
// GREEN THROUGH THE ENTIRE SUITE and forfeits every feat in every run, saved or not.
//
// Why the existing coverage cannot see it: `persist.test.ts`'s behavioural G19 test folds
// `foldRunEvents` IN ITS OWN HARNESS, so it proves the fold and the save envelope are
// correct and can never prove the renderer calls the fold. A mirrored world, tied to the
// shipping code by nothing.
// =========================================================================================

describe('dispatch() folds every step into the run summary (G50)', () => {
  const body = bodyOf('async function dispatch(');

  it('calls foldRunEvents at all (the anchor)', () => {
    expect(body, 'dispatch() no longer folds the run events — every feat in every run is forfeit').toMatch(
      /foldRunEvents\s*\(/,
    );
  });

  it('and pins the whole call BY SHAPE: summary, this step’s events, this step’s state', () => {
    // Every argument matters and each one can be neutered on its own:
    //   - the assignment target elsewhere        -> the summary never advances;
    //   - a fresh `emptyRunSummary()` first arg  -> every step starts over, so the run
    //                                               ends with only the last step's feats;
    //   - `[]` for the events                    -> the fold runs and folds nothing;
    //   - the wrong state                        -> `maxAct` stops tracking the descent.
    // A guard that only asserted `foldRunEvents(` is satisfied by all four.
    expect(
      body,
      'the fold no longer reads `runSummary`, this step’s events and this step’s state, ' +
        'and assign the result back — that is G50, and it forfeits every feat in every run',
    ).toMatch(
      /runSummary\s*=\s*foldRunEvents\s*\(\s*runSummary\s*,\s*[A-Za-z_$][\w$]*\.events\s*,\s*[A-Za-z_$][\w$]*\.state\s*\)/,
    );
  });

  it('and never replaces the live summary with a fresh empty one', () => {
    // The no-op that reads most naturally, in this file's own idiom: `start()` legitimately
    // writes `runSummary = emptyRunSummary()`, so the same line inside `dispatch` looks
    // like housekeeping and resets the tally on every single step.
    expect(
      body,
      'dispatch() resets the run summary — every feat the run earns is discarded on the next step',
    ).not.toMatch(/runSummary\s*=\s*emptyRunSummary\s*\(/);
    expect(body, 'dispatch() assigns the run summary to itself — the fold result is dropped').not.toMatch(
      /runSummary\s*=\s*runSummary\s*;/,
    );
  });

  it('the fold happens BEFORE the run outcome is applied, or it applies a stale tally', () => {
    const fold = body.search(/foldRunEvents\s*\(/);
    const apply = body.search(/applyRunOutcome\s*\(/);
    expect(apply, 'dispatch() no longer applies the run outcome').toBeGreaterThan(-1);
    expect(fold).toBeLessThan(apply);
  });

  it('and the summary it folds is the one `runMeta()` saves (one variable, not two)', () => {
    // Rule 4 — watch the door the code uses. The fold and the save must name the SAME
    // binding, or the run's tally is folded into one variable and saved from another.
    const meta = bodyOf('function runMeta(');
    expect(meta).toMatch(/return\s*\{\s*runSummary\s*,\s*runSeed\s*\}/);
    expect(SOURCE).toMatch(/let\s+runSummary\s*:\s*RunSummary/);
  });
});

// =========================================================================================
// 2. The timing brackets. `busy` is held for the whole of `dispatch`, so the turn timer IS
// the number of milliseconds the game was unresponsive.
// =========================================================================================

describe('dispatch() times the step and the whole turn', () => {
  const body = bodyOf('async function dispatch(');

  it('brackets the ENGINE STEP, and closes the bracket after it — not before', () => {
    const start = body.search(/stepTimer\s*=\s*startTimer\s*\(\s*\)/);
    const call = body.search(/=\s*step\s*\(\s*state\s*,\s*input\s*\)/);
    const stop = body.search(/stepTimer\.stop\s*\(\s*\)/);
    expect(start, 'the engine step is no longer timed').toBeGreaterThan(-1);
    expect(call, 'dispatch() no longer calls step() — this guard has gone stale').toBeGreaterThan(-1);
    expect(stop, 'the step timer is never stopped').toBeGreaterThan(-1);
    expect(start).toBeLessThan(call);
    expect(call).toBeLessThan(stop);
    // The mutation an ordering check alone misses: nothing may close the bracket between
    // the start and the call, which would record ~0 ms for every step forever.
    expect(body.slice(start, call), 'the step timer is stopped before the step runs').not.toMatch(
      /stepTimer\.stop\s*\(/,
    );
  });

  it('brackets the WHOLE TURN, starting before the try and stopping in the finally', () => {
    const start = body.search(/turnTimer\s*=\s*startTimer\s*\(\s*\)/);
    const tryAt = body.search(/\btry\s*\{/);
    const finallyAt = body.search(/\bfinally\s*\{/);
    const stop = body.search(/turnTimer\.stop\s*\(\s*\)/);
    expect(start, 'the turn is no longer timed — the player-perceived freeze is unrecorded').toBeGreaterThan(-1);
    expect(tryAt, 'dispatch() no longer has a try block').toBeGreaterThan(-1);
    expect(finallyAt, 'dispatch() no longer releases `busy` in a finally').toBeGreaterThan(-1);
    expect(stop, 'the turn timer is never stopped').toBeGreaterThan(-1);
    expect(start, 'the turn timer starts inside the try — it would miss work and skip a throw').toBeLessThan(tryAt);
    expect(
      stop,
      'the turn is reported outside the finally — a turn that THROWS would report nothing, ' +
        'and a throw mid-generation is exactly the case worth measuring',
    ).toBeGreaterThan(finallyAt);
  });

  it('reports both durations in `data`, at the level the threshold decides', () => {
    const calls = logCalls(body);
    expect(calls.length, 'dispatch() logs nothing at all').toBeGreaterThan(2);
    const stepLine = calls.find((c) => c.includes("'step'"));
    const turnLine = calls.find((c) => c.includes("'turn'"));
    expect(stepLine, 'the per-step timeline line is gone').toBeDefined();
    expect(turnLine, 'the per-turn line is gone — nothing records the freeze').toBeDefined();
    expect(stepLine).toMatch(/ms:\s*stepMs/);
    expect(turnLine).toMatch(/ms:\s*turnMs/);
    // The LEVEL is decided by the duration, not hard-coded: a hard-coded `debug` would
    // drop both lines out of every packaged log, where `info` is the floor.
    expect(stepLine, 'the step line no longer escalates when it is slow').toMatch(
      /levelForDuration\s*\(\s*stepMs\s*,\s*SLOW_MS\.step\s*,\s*'info'\s*\)/,
    );
    expect(turnLine, 'the turn line no longer escalates when it is slow').toMatch(
      /levelForDuration\s*\(\s*turnMs\s*,\s*SLOW_MS\.turn\s*,\s*'info'\s*\)/,
    );
  });

  it('logs the player-typed choice at DEBUG, never at info', () => {
    // The whole `{input}` payload carries `{kind:'name', name}`. A packaged build runs at
    // `info`, and that is the ONLY thing keeping a player's typed name off their disk. If
    // this line is ever raised to `info`, the level policy stops protecting anything.
    const choice = logCalls(body).find((c) => c.includes("'choice'"));
    expect(choice, 'the choice line is gone').toBeDefined();
    expect(choice, 'the player-typed input is logged above debug — a packaged build would write the name').toMatch(
      /^log\.debug\s*\(/,
    );
  });

  it('and NO call above debug REFERENCES the input object except as `input.kind`', () => {
    // ⚠ WHAT THIS IS AND IS NOT — read this before trusting either half.
    //
    // Appendix A.4 asked for one assertion and it exists: `src/log/level.test.ts` proves
    // that a logger at `info` does not emit a `ui`/`choice` name payload. But be precise
    // about that test's reach — it drives a HAND-WRITTEN call list, not `game.ts`. So it
    // proves the LEVEL POLICY (an `info` logger filters `debug`), and it says nothing about
    // what `game.ts` actually passes. It is not a backstop for this scan; the two cover
    // different things and NEITHER covers the other.
    //
    // THIS guard is the only thing that looks at `game.ts`'s call CONTENT, and being a
    // source scan it is bounded by what a source scan can see. It catches every DIRECT
    // reference: `{ input }`, `{ input: input }`, `{ ...input }`, `JSON.stringify(input)`
    // and `{ name: (input as {name?: string}).name }`. It CANNOT catch an ALIAS
    // (`const chosen = input; log.info(..., { chosen })`), because that needs dataflow, not
    // pattern matching — and an aliased `info` call escapes BOTH tests.
    //
    // That gap is real, it is unclosed, and it is written down here rather than discovered
    // later. Closing it properly needs `game.ts` to become importable (G51, PLAN.md #6),
    // after which this becomes a behavioural assertion over the entries `dispatch()`
    // actually emits — which is the same reason §5.4 argues for scheduling G51 first.
    const above = logCalls(SOURCE).filter((c) => !c.startsWith('log.debug('));
    expect(above.length, 'no calls above debug — this guard has gone stale').toBeGreaterThan(5);
    for (const call of above) {
      // Every mention of the identifier `input` must be the `.kind` projection.
      // The negative lookahead skips a property KEY (`{ input: ... }`) — a key is a name,
      // not a read of the object. Only the VALUE side is a reference.
      const mentions = [...call.matchAll(/\binput\b(?!\s*:)(\s*\.\s*[A-Za-z_$][\w$]*)?/g)];
      for (const m of mentions) {
        expect(
          (m[1] ?? '').replace(/\s+/g, ''),
          'a call above `debug` reads something other than `input.kind` off the player input ' +
            `— the typed name would reach a packaged log: ${call.slice(0, 70)}`,
        ).toBe('.kind');
      }
    }
    // Non-vacuity, both directions.
    const readsOnlyKind = (text: string): boolean =>
      [...text.matchAll(/\binput\b(?!\s*:)(\s*\.\s*[A-Za-z_$][\w$]*)?/g)].every(
        (m) => (m[1] ?? '').replace(/\s+/g, '') === '.kind',
      );
    expect(readsOnlyKind("log.info('ui','turn',{ input: input.kind, ms })")).toBe(true);
    expect(readsOnlyKind("log.info('ui','turn',{ input })")).toBe(false);
    expect(readsOnlyKind("log.info('ui','turn',{ ...input })")).toBe(false);
    expect(readsOnlyKind("log.info('ui','x',{ name: (input as {name?: string}).name ?? null })")).toBe(
      false,
    );
    // ...and the `debug` call this excludes really does reference it, so the filter matters.
    expect(logCalls(SOURCE).some((c) => c.startsWith('log.debug(') && !readsOnlyKind(c))).toBe(true);
  });

  it('and NO call above debug passes the whole input object — the exhaustive form', () => {
    // ⚠ Pinning only the `'choice'` line is not enough. The name reaches the log through
    // the WHOLE `input` object, and any future `log.info('ui','turn',{ input })` would put
    // it in a packaged log while the guard above stayed green. So: every call that is not
    // `log.debug` must pass `input.kind`, never `input` itself.
    //
    // `{ input: input.kind }` does not match — the token before the comma is `kind`.
    // `{ input }` and `{ input: input }` both do.
    const SHORTHAND = /\binput\s*[,}]/;
    const WHOLE_OBJECT = /input:\s*input\s*[,}]/;
    const above = logCalls(SOURCE).filter((c) => !c.startsWith('log.debug('));
    expect(above.length, 'no calls above debug — this guard has gone stale').toBeGreaterThan(5);
    for (const call of above) {
      expect(
        call,
        'a call above `debug` carries the whole input object, which holds the player-typed ' +
          `name — a packaged build would write it to disk: ${call.slice(0, 70)}`,
      ).not.toMatch(SHORTHAND);
      expect(call).not.toMatch(WHOLE_OBJECT);
    }
    // Non-vacuity, both ways: the patterns fire on the offending shape and not on the safe one.
    expect(SHORTHAND.test("log.info('ui', 'turn', { input })")).toBe(true);
    expect(WHOLE_OBJECT.test("log.info('ui', 'turn', { input: input })")).toBe(true);
    expect(SHORTHAND.test("log.info('ui', 'turn', { input: input.kind, ms: turnMs })")).toBe(false);
    // ...and the debug call this excludes really does carry it, so the filter is load-bearing.
    expect(logCalls(SOURCE).filter((c) => SHORTHAND.test(c)).length).toBe(1);
  });
});

describe('narrate() times the round trip to the model', () => {
  const body = bodyOf('async function narrate(');

  it('brackets the IPC call, and closes the bracket AFTER the await', () => {
    const start = body.search(/genTimer\s*=\s*startTimer\s*\(\s*\)/);
    const call = body.search(/await\s+window\.void\.generate\s*\(/);
    const stop = body.search(/genTimer\.stop\s*\(\s*\)/);
    expect(start, 'the generation round trip is no longer timed').toBeGreaterThan(-1);
    expect(call, 'narrate() no longer calls the model — this guard has gone stale').toBeGreaterThan(-1);
    expect(stop, 'the generation timer is never stopped').toBeGreaterThan(-1);
    expect(start).toBeLessThan(call);
    expect(call).toBeLessThan(stop);
    expect(
      body.slice(start, call),
      'the timer is stopped before the await — every generation would be recorded as instant',
    ).not.toMatch(/genTimer\.stop\s*\(/);
  });

  it('reports roundTripMs, and splits the IPC overhead out of the model time', () => {
    const done = logCalls(body).find((c) => c.includes("'narrate: done'"));
    expect(done, 'the narration result line is gone').toBeDefined();
    expect(done).toMatch(/roundTripMs/);
    expect(done, 'the IPC overhead is no longer separable from the model time').toMatch(
      /ipcOverheadMs/,
    );
    expect(done).toMatch(/ttftMs/);
    expect(done).toMatch(/tokPerSec/);
  });

  it('...and all three of those numbers are MEASURED, not fabricated', () => {
    // Pinned by EXPRESSION, the way `ms: stepMs` already is in `dispatch`. Every one of
    // these was green when only the KEY was asserted:
    //   `const generateMs = 0`         -> ipcOverheadMs becomes the whole round trip, so
    //                                     the log blames the IPC bridge for model time;
    //   `ipcOverheadMs: roundTripMs`   -> identical lie, from the other end;
    //   `const roundTripMs = 0`        -> the narration is recorded as instant forever.
    expect(body, 'the round trip is fabricated rather than measured').toMatch(
      /const roundTripMs\s*=\s*genTimer\.stop\(\s*\)/,
    );
    expect(body, "the main process's own measurement is discarded").toMatch(
      /const generateMs\s*=\s*Math\.round\(\s*stats\.totalMs\s*\?\?\s*0\s*\)/,
    );
    expect(body, 'ipcOverheadMs is no longer the DIFFERENCE — it says nothing new').toMatch(
      /ipcOverheadMs:\s*Math\.round\(\s*roundTripMs\s*\)\s*-\s*generateMs/,
    );
    expect(body, 'the failure path fabricates its duration').toMatch(
      /roundTripMs:\s*genTimer\.stop\(\s*\)/,
    );
  });

  it('the FAILURE path reports how long it waited before falling back', () => {
    const catchAt = body.search(/\}\s*catch\s*\(/);
    expect(catchAt, 'narrate() no longer catches — this guard has gone stale').toBeGreaterThan(-1);
    const tail = body.slice(catchAt);
    const failure = logCalls(tail)[0];
    expect(failure, 'the model failure is silent again — G26’s fallback would hide it').toBeDefined();
    expect(failure).toMatch(/^log\.error\s*\(/);
    expect(failure, 'the failure does not say how long it waited').toMatch(/roundTripMs/);
    // ...and it still logs BEFORE it recovers.
    expect(tail.search(/log\.error/)).toBeLessThan(tail.search(/fallbackNarration\s*\(/));
  });
});

// =========================================================================================
// 3. The level policy is APPLIED, not merely available.
// =========================================================================================

describe('the renderer applies the shipped/developer level policy', () => {
  it('sets the level from resolveLogLevel(location.protocol), with the override', () => {
    expect(SOURCE, 'the renderer never sets a level — a packaged build would log at debug').toMatch(
      /log\.setLevel\s*\(/,
    );
    const call = SOURCE.slice(SOURCE.indexOf('log.setLevel('));
    expect(call.slice(0, 200)).toMatch(/resolveLogLevel\s*\(/);
    expect(call.slice(0, 200)).toMatch(/location\.protocol/);
  });

  it('sets it BEFORE the first line is logged, or the boot lines escape the policy', () => {
    const setAt = SOURCE.search(/log\.setLevel\s*\(/);
    const firstLog = SOURCE.search(/\blog\.(debug|info|warn|error)\s*\(/);
    expect(setAt).toBeGreaterThan(-1);
    expect(firstLog).toBeGreaterThan(-1);
    expect(setAt, 'the level is applied after the first log line').toBeLessThan(firstLog);
  });

  it('...and inside boot() too, which is where the start-up really runs (G51)', () => {
    // TIGHTENED by PLAN.md #6. The file-wide order above is a statement about SOURCE order,
    // and now that the start-up is the body of `boot()` the order that matters is the order of
    // that body: a `log.info(...)` hoisted above `log.setLevel(` inside it would escape the
    // shipped level on every boot while the file-wide check could still pass.
    const body = bodyOf('export function boot(');
    const setAt = body.search(/log\.setLevel\s*\(/);
    const firstLog = body.search(/\blog\.(debug|info|warn|error|log)\s*\(/);
    expect(setAt, 'boot() no longer sets the level at all').toBeGreaterThan(-1);
    expect(firstLog, 'boot() logs nothing — the boot line is gone').toBeGreaterThan(-1);
    expect(setAt, 'boot() logs before it applies the level').toBeLessThan(firstLog);
  });

  it('and the boot line says which level and protocol it resolved to', () => {
    const boot = logCalls(SOURCE).find((c) => c.includes("'renderer booted'"));
    expect(boot, 'the boot line is gone').toBeDefined();
    expect(boot).toMatch(/level:\s*log\.level\s*\(\s*\)/);
    expect(boot).toMatch(/protocol/);
    expect(boot).toMatch(/ms:/);
  });
});

// =========================================================================================
// 4. THE PLAYER SEES NOTHING. Logging is a developer surface.
// =========================================================================================

// ADDITIVE, `visual-identity` 2026-09-08: `floorEl` is the persistent floor tag, and it is
// the most log-adjacent player-facing element in the game — it is written on every engine
// step, from inside the same `retheme()` that runs beside the step's own logging. A log line
// must not be able to reach it either.
const PLAYER_ELEMENTS = [
  'narrationEl',
  'logEl',
  'statusEl',
  'noticeEl',
  'sheetEl',
  'titleEl',
  'floorEl',
  // PLAN.md #6: the battle frame — the enemy's stage and ticker, and the player's stat box —
  // is written on every round, from inside the same `dispatch` that logs the round.
  'arenaEl',
  'vitalsEl',
];

describe('no log line can reach the screen', () => {
  it('no log call mentions any player-facing element', () => {
    const calls = logCalls(SOURCE);
    expect(calls.length, 'no log calls found — this guard has gone stale').toBeGreaterThan(10);
    for (const call of calls) {
      for (const el of PLAYER_ELEMENTS) {
        expect(call, `a log call touches ${el}: ${call.slice(0, 70)}`).not.toContain(el);
      }
    }
  });

  it('no line that writes a player-facing element mentions a log entry or a formatter', () => {
    const offenders: string[] = [];
    for (const line of SOURCE.split('\n')) {
      const writesElement = PLAYER_ELEMENTS.some((el) =>
        new RegExp(`${el}\\s*\\.\\s*(textContent|innerHTML|append|replaceChildren)`).test(line),
      );
      if (!writesElement) continue;
      if (/formatEntry|\blog\.|ring\.get|LogEntry/.test(line)) offenders.push(line.trim());
    }
    expect(offenders, 'a log entry is being rendered to the player').toEqual([]);
  });

  it('...and the scan really did find element writes (non-vacuity)', () => {
    const writes = SOURCE.split('\n').filter((line) =>
      PLAYER_ELEMENTS.some((el) =>
        new RegExp(`${el}\\s*\\.\\s*(textContent|innerHTML|append|replaceChildren)`).test(line),
      ),
    );
    expect(writes.length, 'no element writes found — the guard above scanned nothing').toBeGreaterThan(4);
  });

  it('the ring buffer feeds the debug overlay and nothing else', () => {
    expect(SOURCE).toMatch(/createDebugOverlay\s*\(\s*ring\.get\s*\)/);
    const ringUses = SOURCE.split('\n').filter((l) => /\bring\./.test(l));
    for (const line of ringUses) {
      expect(line, `the ring buffer is read outside the debug overlay: ${line.trim()}`).toMatch(
        /log\.addSink\(ring\.sink\)|createDebugOverlay\(ring\.get\)|const ring =/,
      );
    }
  });
});

// =========================================================================================
// 5. A NUMBER LIVES IN `data`, NEVER IN `message`.
// =========================================================================================

// =========================================================================================
// The complement of that rule: a measurement key must carry a MEASUREMENT. Pinning a key
// by NAME is satisfied by `ms: 0`, and a log that answers the question wrongly is worse
// than one that does not answer it. The specific expressions are pinned at their own sites
// above; this is the class guard that catches the next one nobody thought to pin.
// =========================================================================================

describe('a measurement key in game.ts never carries a constant', () => {
  const CONSTANT = /^-?\d+(?:\.\d+)?$/;

  /** `{key, value}` for every `…ms`/`…Ms` property anywhere in a log call's arguments. */
  function measurements(callText: string): { key: string; value: string }[] {
    const found: { key: string; value: string }[] = [];
    for (const m of callText.matchAll(/\b([A-Za-z]*[Mm]s)\s*:\s*([^,\n}]+)/g)) {
      found.push({ key: m[1] as string, value: (m[2] as string).trim() });
    }
    return found;
  }

  it('every ms-valued key in a log payload is an expression', () => {
    const seen = logCalls(SOURCE).flatMap(measurements);
    expect(seen.length, 'no ms-valued keys found — this guard has gone stale').toBeGreaterThan(4);
    for (const { key, value } of seen) {
      expect(
        CONSTANT.test(value),
        `${key} is the constant ${value}, not a measurement`,
      ).toBe(false);
    }
  });

  it('the detector fires on a planted constant, and not on a real expression', () => {
    expect(measurements("log.warn('llm', 'x', { roundTripMs: 0 })")).toEqual([
      { key: 'roundTripMs', value: '0' },
    ]);
    expect(CONSTANT.test('0')).toBe(true);
    expect(CONSTANT.test(measurements("log.warn('x', 'y', { ms: turnMs })")[0]!.value)).toBe(false);
  });
});

// =========================================================================================
// R2 — the test runner's own configuration. A test file that no `include` glob matches is
// collected by nothing and "passes" by never running: deleting `scripts/**/*.test.mjs`
// from `vite.config.ts` drops the suite from 1602 to 1560 and everything stays green.
// AC-39 called that "proved by the run count rising", which is a human noticing, not a
// check. This file lives under `src/**/*.test.ts` — the largest glob, whose removal would
// take ~1300 tests with it and be impossible to miss — so it is a safe home for the guard.
// =========================================================================================

describe('every test file on disk is collected by the runner', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const CONFIG = readFileSync(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8');

  /** Every `*.test.ts` / `*.test.mjs` under the three source roots, as posix paths. */
  function testFilesOnDisk(): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const rel = `${prefix}${entry.name}`;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/`);
        else if (/\.test\.(ts|mjs)$/.test(entry.name)) out.push(rel);
      }
    };
    for (const root of ['src', 'scripts', 'electron']) walk(root, `${root}/`);
    return out;
  }

  /** The `include:` globs, read out of the config as literal strings. */
  function includeGlobs(): string[] {
    const block = CONFIG.slice(CONFIG.indexOf('include:'), CONFIG.indexOf(']', CONFIG.indexOf('include:')));
    return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  }

  /** Does `glob` (only `**` and `*` are used here) match `file`? */
  function matches(glob: string, file: string): boolean {
    const pattern = glob
      .split('**/')
      .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('(?:.*/)?');
    return new RegExp(`^${pattern}$`).test(file);
  }

  it('the glob matcher works (or the sweep below proves nothing)', () => {
    expect(matches('scripts/**/*.test.mjs', 'scripts/dev-server.test.mjs')).toBe(true);
    expect(matches('scripts/**/*.test.mjs', 'scripts/a/b/c.test.mjs')).toBe(true);
    expect(matches('scripts/**/*.test.mjs', 'scripts/dev-server.test.ts')).toBe(false);
    expect(matches('src/**/*.test.ts', 'src/log/timing.test.ts')).toBe(true);
    expect(matches('src/**/*.test.ts', 'electron/log.test.mjs')).toBe(false);
    expect(includeGlobs().length, 'no include globs parsed out of vite.config.ts').toBeGreaterThan(3);
  });

  it('and no test is disabled', () => {
    // AC-3's "zero skips added" was enforced by a human reading the diff. `it.skip` is the
    // cheapest way to make a red guard green, and it is invisible in a passing run.
    // ANCHORED at statement position (`^\s*`), which is where a real `it.skip` always
    // sits. Unanchored, this guard flagged its own non-vacuity literals below — a scan
    // that reads the file it is written in has to say where it is looking.
    const DISABLED = /^\s*(?:it|test|describe)\s*\.\s*(?:skip|only|todo|fails)\b/;
    const offenders: string[] = [];
    for (const rel of testFilesOnDisk()) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      for (const [i, line] of source.split('\n').entries()) {
        if (DISABLED.test(line)) offenders.push(`${rel}:${i + 1}`);
      }
    }
    expect(offenders, 'a test is skipped, focused or marked todo').toEqual([]);
    // Non-vacuity: the matcher fires on the shapes it is meant to catch, and not on the
    // game's own `skipTurn` field, which is what an unanchored word match would hit.
    expect(DISABLED.test('  it.skip("x", () => {})')).toBe(true);
    expect(DISABLED.test('describe.only("x", () => {})')).toBe(true);
    expect(DISABLED.test('  test.todo("later");')).toBe(true);
    expect(DISABLED.test('  expect(r.skipTurn).toBe(true);')).toBe(false);
    expect(testFilesOnDisk().length, 'no files scanned').toBeGreaterThan(60);
  });

  it('no test file is left uncollected', () => {
    const globs = includeGlobs();
    const files = testFilesOnDisk();
    expect(files.length, 'no test files found — this guard has gone stale').toBeGreaterThan(60);
    const orphans = files.filter((f) => !globs.some((g) => matches(g, f)));
    expect(
      orphans,
      'these test files match no `include` glob in vite.config.ts — they are collected by ' +
        'nothing and "pass" by never running',
    ).toEqual([]);
    // Non-vacuity: an invented file in an uncovered location MUST be reported.
    expect(['scripts/made-up.test.mjs'].filter((f) => !globs.some((g) => matches(g, f)))).toEqual([]);
    expect(['tools/made-up.test.ts'].filter((f) => !globs.some((g) => matches(g, f)))).toEqual([
      'tools/made-up.test.ts',
    ]);
  });
});

describe('no measurement is interpolated into a message', () => {
  it('no log call in game.ts contains a template interpolation', () => {
    const calls = logCalls(SOURCE);
    expect(calls.length).toBeGreaterThan(10);
    for (const call of calls) {
      expect(
        call,
        `a value is interpolated into a log call — grep '"ms":' would stop working: ${call.slice(0, 70)}`,
      ).not.toMatch(/\$\{/);
    }
  });

  it('and every message argument is a constant string with no digit', () => {
    const calls = logCalls(SOURCE);
    expect(calls.length, 'no log calls found — this loop would run over nothing').toBeGreaterThan(10);
    for (const call of calls) {
      // `log.log(level, cat, msg, data)` has the message third; the four shorthands have
      // it second. Split on top-level commas.
      const inner = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'));
      const args: string[] = [];
      let depth = 0;
      let current = '';
      for (let i = 0; i < inner.length; i += 1) {
        const c = inner[i] as string;
        if (c === '"' || c === "'" || c === '`') {
          current += c;
          i += 1;
          while (i < inner.length && inner[i] !== c) {
            current += inner[i];
            i += 1;
          }
          current += inner[i] ?? '';
          continue;
        }
        if ('([{'.includes(c)) depth += 1;
        if (')]}'.includes(c)) depth -= 1;
        if (c === ',' && depth === 0) {
          args.push(current.trim());
          current = '';
          continue;
        }
        current += c;
      }
      if (current.trim()) args.push(current.trim());
      const message = call.startsWith('log.log(') ? args[2] : args[1];
      expect(message, `${call.slice(0, 60)} has no message`).toBeDefined();
      expect(message, `${message} is not a constant string`).toMatch(/^'[^'$]*'$/);
      expect(message, `${message} carries a number in the message`).toMatch(/^'[^0-9]*'$/);
    }
  });
});

// =========================================================================================
// 6. THE OBSERVABLE OUTPUT ANCHOR — computed through the real projectors.
//
// The guards above read source. This one runs the two functions that produce every word a
// player reads and checks that nothing from this unit is in them. Every expected string is
// derived BY HAND from the templates in `src/render/format.ts` and `src/llm/narrate.ts`,
// not read off a run.
// =========================================================================================

describe('the player-facing projectors are byte-identical, and carry no telemetry', () => {
  const EVENTS: readonly GameEvent[] = [
    { kind: 'encounter-start', enemyName: 'Rust Chorister' },
    { kind: 'escape-failed', damage: 4 },
    { kind: 'victory', xpGained: 5, loot: [] },
    { kind: 'defeat' },
  ];

  it('logLines renders exactly the sentences format.ts specifies', () => {
    // Hand-derived, per `format.ts`:
    //   `encounter-start` is routed to the PANE (log-model.ts LOG_ROUTING) -> no line.
    //   `escape-failed`   -> `Your escape fails — you take ${damage} damage.`
    //   `victory`         -> `Victory! +${xp} XP${rest}.${loot}` with no rest and no loot.
    //   `defeat`          -> `You have fallen.`
    expect(logLines(EVENTS)).toEqual([
      { text: 'Your escape fails — you take 4 damage.' },
      { text: 'Victory! +5 XP.' },
      { text: 'You have fallen.' },
    ]);
  });

  it('buildNarrationPrompt produces exactly the facts narrate.ts specifies', () => {
    const prompt = buildNarrationPrompt(EVENTS, createGame(4242));
    expect(prompt).not.toBeNull();
    expect(prompt!.facts).toEqual([
      'A Rust Chorister emerges to bar your way.',
      'Your escape fails; you take 4 harm.',
      'The enemy falls. You are still standing.',
      'Your strength gives out.',
    ]);
    for (const fact of prompt!.facts) expect(prompt!.user).toContain(fact);
    expect(prompt!.user).toContain('Narrate this new moment in 2-4 vivid second-person sentences.');
  });

  const FORBIDDEN: readonly [string, RegExp][] = [
    ['a bare millisecond count', /\bms\b/],
    ['a duration key', /\b(roundTripMs|elapsedMs|ttftMs|generateMs|ipcOverheadMs|bootMs|waitedMs)\b/],
    ['a token rate', /tokPerSec|tokensPerSecond|tok\/s/],
    ['a log category tag', /\[(llm|engine|ui|save|electron|unlocks|game|error)\]/],
    ['a log level word', /\b(DEBUG|INFO|WARN|ERROR)\b/],
    ['a heartbeat', /STILL RUNNING|heartbeat/],
  ];

  it('and neither projector leaks anything this unit added', () => {
    const prompt = buildNarrationPrompt(EVENTS, createGame(4242));
    const surfaces: [string, string][] = [
      ['the combat log', logLines(EVENTS).map((l) => `${l.text} ${l.detail ?? ''}`).join('\n')],
      ['the narration prompt (user)', prompt!.user],
      ['the narration prompt (system)', prompt!.system],
    ];
    for (const [where, text] of surfaces) {
      expect(text.length, `${where} produced nothing — this guard would pass vacuously`).toBeGreaterThan(40);
      for (const [what, pattern] of FORBIDDEN) {
        expect(text, `${where} contains ${what}`).not.toMatch(pattern);
      }
    }
  });

  it('the forbidden patterns really do match a log line (or they guard nothing)', () => {
    // Non-vacuity for the block above: run the same patterns over a REAL formatted entry
    // and require every one of them to fire on something.
    const sample =
      '2026-09-02T12:00:00.000Z WARN [llm] generate: STILL RUNNING {"elapsedMs":10000,"tokPerSec":7,"ms":3}';
    for (const [what, pattern] of FORBIDDEN) {
      expect(sample, `the pattern for ${what} never matches anything`).toMatch(pattern);
    }
  });
});
