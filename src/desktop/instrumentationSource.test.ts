// SOURCE GUARDS on `src/desktop/game.ts`'s INSTRUMENTATION — plus the G50 pin.
//
// Same technique and same file as `rendererSource.test.ts`, and for the same reason:
// `game.ts` calls the Electron IPC (`window.void.onStatus(...)`) at MODULE SCOPE, so
// importing it in Vitest throws before a line of test code runs. Everything behavioural
// has been pushed into pure helpers that ARE tested (`view-model.ts`, `log-model.ts`,
// `src/log/*`); what is left is WIRING — which timer brackets which call, on which side of
// which await — and the only way to assert wiring in a file you cannot load is to read it.
//
// (When `PLAN.md` #6 lands G51's `boot()` extraction and this file becomes importable,
// the three timing guards below become behavioural tests: drive `dispatch()` with a
// scripted clock and assert the emitted entries exactly, the way `persist.test.ts`
// already does. That is recorded here as independent evidence for scheduling G51 first.)
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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logLines } from '../render/log-model.ts';
import { buildNarrationPrompt } from '../llm/narrate.ts';
import { createGame } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';

const RAW = readFileSync(fileURLToPath(new URL('./game.ts', import.meta.url)), 'utf8');

/**
 * Comments removed by a single left-to-right scan that also understands string and
 * template literals.
 *
 * NOT the usual pair of regexes. `src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')`
 * treats the `/*` inside a LINE comment that mentions a glob (`electron/**`,
 * `./models/*.gguf` — both real in this repo) as a block-comment opener and deletes
 * everything up to the next `*​/`, which is the end of some JSDoc far below. Every guard
 * downstream then scans a hole and passes. Found by mutation-testing this unit's own work.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        const done = source[i] === c;
        i += 1;
        if (done) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

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
    expect(logCalls(`log.info('a', 'b (c)', { d: f(1, g(2)) });`)).toEqual([
      `log.info('a', 'b (c)', { d: f(1, g(2)) })`,
    ]);
    expect(logCalls('const x = 1;')).toEqual([]);
  });

  it('and the strip left game.ts intact (rule 2 — the anchor for everything below)', () => {
    expect(SOURCE, 'the strip ate the imports — every guard below scans a hole').toMatch(
      /import\s*\{\s*createGame,\s*step,\s*awaitingFor\s*\}\s*from\s*'\.\.\/game\/game\.ts'/,
    );
    expect(SOURCE).toMatch(/async function dispatch\(/);
    expect(SOURCE).toMatch(/async function narrate\(/);
    expect(SOURCE).toMatch(/import\s*\{[^}]*startTimer[^}]*\}\s*from\s*'\.\.\/log\/timing\.ts'/);
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

const PLAYER_ELEMENTS = ['narrationEl', 'logEl', 'statusEl', 'noticeEl', 'sheetEl', 'titleEl'];

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
    for (const call of logCalls(SOURCE)) {
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
    { kind: 'victory', xpGained: 5, extraRest: false, loot: [] },
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
