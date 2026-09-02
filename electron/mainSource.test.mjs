// SOURCE GUARDS on `electron/main.mjs` and `electron/llm.mjs` — the two files that CANNOT
// be imported by a test. `main.mjs` imports `electron` at module scope; `llm.mjs` imports
// `node-llama-cpp`, which loads a native binding. Every behaviour worth testing has been
// pushed into modules that ARE imported and tested (`log.mjs`, `instrument.mjs`,
// `narrator-gate.mjs`, `gpu.mjs`, `model-path.mjs`). What is left in these two is WIRING —
// which helper is called, around which operation, on which side of which await — and the
// only way to assert wiring in a file you cannot load is to read it.
//
// ---------------------------------------------------------------------------------------
// THE THREE RULES THESE GUARDS FOLLOW, each of them the scar of a guard that could not
// fail.
//
//  1. ASSERT THE ANCHOR FIRST. A regex that matches nothing passes trivially. Every block
//     below first asserts that the thing it is looking at EXISTS.
//  2. ASSERT THE STRIPPED SOURCE IS INTACT. The comment strip is where a guard silently
//     becomes a scan of a hole — see `sourceScan.test.mjs`, and the first version of this
//     unit's own G6 guard, which stayed green against G6 reintroduced verbatim.
//  3. PIN POLARITY AND SIDE, NOT PRESENCE. "The call appears" is satisfied by an inverted
//     `if` and by a timer stopped on the wrong side of an await. Where an order matters it
//     is asserted as an index comparison with all anchors proved present first; where a
//     condition matters, both the positive form and the absence of the negated form.
// ---------------------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, callsTo, argsOf } from './sourceScan.testutil.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
const RAW_MAIN = read('main.mjs');
const RAW_LLM = read('llm.mjs');
const MAIN = stripComments(RAW_MAIN);
const LLM = stripComments(RAW_LLM);

/** The body of a top-level function, up to the first closing brace in column 0. */
function bodyOf(source, declaration) {
  const start = source.indexOf(declaration);
  expect(start, `${declaration} not found — this guard has gone stale, fix it`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the scanned sources survived the comment strip (rule 2)', () => {
  it('main.mjs keeps its imports, its handler and its ready block', () => {
    expect(MAIN).toMatch(/import\s*\{\s*app,\s*BrowserWindow,\s*ipcMain\s*\}\s*from\s*'electron'/);
    expect(MAIN).toMatch(/ipcMain\.handle\s*\(\s*'llm:generate'/);
    expect(MAIN).toMatch(/app\.whenReady\s*\(\s*\)/);
    expect(MAIN.length).toBeLessThan(RAW_MAIN.length);
  });

  it('llm.mjs keeps its imports and its narrator factory', () => {
    expect(LLM).toMatch(/import\s*\{[^}]*getLlama[^}]*\}\s*from\s*'node-llama-cpp'/);
    expect(LLM).toMatch(/export\s+async\s+function\s+createNarrator/);
    expect(LLM.length).toBeLessThan(RAW_LLM.length);
  });
});

// =========================================================================================
// llm.mjs — the file that had ZERO log calls, and owns every slow thing in the product.
// =========================================================================================

describe('llm.mjs instruments every phase of the model load', () => {
  it('builds an instrument, injected rather than imported from electron', () => {
    expect(LLM, 'llm.mjs no longer creates an instrument at all').toMatch(
      /createInstrument\s*\(/,
    );
    expect(LLM).toMatch(/import\s*\{[^}]*createInstrument[^}]*\}\s*from\s*'\.\/instrument\.mjs'/);
    // The layer stays free of any electron import — the same rule `modelsDir` follows.
    expect(LLM, 'llm.mjs now imports electron — the narrator layer must stay portable').not.toMatch(
      /from\s*'electron'/,
    );
  });

  // Each row: the operation NAME the instrument is given, and the call that must sit
  // INSIDE that same instrumented block. Asserted per operation, by name — an instrument
  // wrapped round four of the five is a log that stops exactly where the freeze is.
  const PHASES = [
    ['model resolve', /resolveModelFile\s*\(/],
    ['gpu probe', /selectGpuDevice\s*\(/],
    ['llama init', /getLlama\s*\(/],
    ['model load', /loadModel\s*\(/],
    ['context create', /createContext\s*\(/],
  ];

  const runCalls = callsTo(LLM, 'inst\\.run');

  it('has one instrumented block per phase (the anchor)', () => {
    expect(runCalls.length, 'llm.mjs has no inst.run calls at all').toBeGreaterThanOrEqual(
      PHASES.length,
    );
  });

  for (const [name, inner] of PHASES) {
    it(`wraps ${name}`, () => {
      const block = runCalls.find((c) => argsOf(c)[1] === `'${name}'`);
      expect(block, `no inst.run(...) names "${name}"`).toBeDefined();
      expect(block, `the "${name}" block does not contain the call it claims to time`).toMatch(inner);
    });

    it(`and ${name} is called NOWHERE ELSE, so nothing escapes the instrument`, () => {
      // The mutation this catches: leave the instrumented block in place and quietly do
      // the real work outside it. Every occurrence of the operation must be inside the
      // block that names it.
      const block = runCalls.find((c) => argsOf(c)[1] === `'${name}'`) ?? '';
      const total = (LLM.match(new RegExp(inner.source, 'g')) ?? []).length;
      const inside = (block.match(new RegExp(inner.source, 'g')) ?? []).length;
      expect(total, `${name}: the operation is gone entirely`).toBeGreaterThan(0);
      expect(inside, `${name}: ${total - inside} call(s) sit outside the instrumented block`).toBe(
        total,
      );
    });
  }

  it('passes a real threshold to each phase, not the default of never-warn', () => {
    for (const [name] of PHASES) {
      const block = runCalls.find((c) => argsOf(c)[1] === `'${name}'`);
      const args = argsOf(block);
      expect(args.length, `${name}: no threshold argument — a slow phase would never warn`).toBe(5);
      expect(args[4], `${name}: the threshold is not from the derived table`).toMatch(/^THRESHOLDS\./);
    }
  });

  it('records existedBefore, which is what tells a DOWNLOAD from a cache hit', () => {
    const block = runCalls.find((c) => argsOf(c)[1] === `'model resolve'`);
    expect(block).toMatch(/existedBefore/);
    // ...and it is captured BEFORE the resolve, or it always reports "already there".
    const check = block.indexOf('existsSync');
    const resolve = block.search(/await\s+resolveModelFile/);
    expect(check, 'existedBefore is no longer probed from the filesystem').toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(-1);
    expect(check, 'existedBefore is measured AFTER the download — it can only ever be true').toBeLessThan(
      resolve,
    );
  });
});

describe("llm.mjs's generate is bracketed, heartbeated, and never swallows", () => {
  const body = LLM.slice(LLM.indexOf('async generate('));

  it('the anchor exists', () => {
    expect(LLM.indexOf('async generate('), 'generate() is gone').toBeGreaterThan(-1);
    expect(body).toMatch(/session\.prompt\s*\(/);
  });

  it('begins the instrument BEFORE the prompt and ends it AFTER — not the other way round', () => {
    const begin = body.search(/inst\.begin\s*\(/);
    const prompt = body.search(/await\s+session\.prompt\s*\(/);
    const done = body.search(/op\.done\s*\(/);
    expect(begin, 'generate no longer opens an instrumented operation').toBeGreaterThan(-1);
    expect(prompt, 'generate no longer prompts the session').toBeGreaterThan(-1);
    expect(done, 'generate no longer closes its operation').toBeGreaterThan(-1);
    expect(begin).toBeLessThan(prompt);
    expect(prompt).toBeLessThan(done);
    // The precise mutation an ordering check alone misses: `done()` moved to the wrong
    // side of the await still leaves all three markers present and in a plausible order
    // if only two are compared. Nothing may close the operation before the await.
    expect(
      body.slice(begin, prompt),
      'the operation is closed BEFORE the generation is awaited — every duration would be ~0',
    ).not.toMatch(/op\.(done|fail)\s*\(/);
  });

  it('notes the chunk count from inside the token callback — the freeze diagnostic', () => {
    // Two heartbeats with the SAME chunks mean the stream stopped; two with DIFFERENT
    // chunks mean it is merely slow. If `note` moved out of `onTextChunk`, the heartbeat
    // still fires and can no longer answer the question it exists for.
    const cb = body.slice(body.search(/onTextChunk\s*\(/));
    const cbEnd = cb.indexOf('},');
    expect(cbEnd, 'the token callback is gone').toBeGreaterThan(-1);
    expect(cb.slice(0, cbEnd), 'the chunk count is no longer recorded per token').toMatch(
      /op\.note\s*\(\s*\{[^}]*chunks/,
    );
  });

  it('fails loudly and RE-THROWS the original error', () => {
    const catchAt = body.search(/\}\s*catch\s*\(/);
    expect(catchAt, 'generate no longer catches at all').toBeGreaterThan(-1);
    const tail = body.slice(catchAt);
    expect(tail, 'the generation failure is swallowed again').toMatch(/op\.fail\s*\(/);
    expect(tail, 'the error is no longer re-thrown — the renderer would see a silent success').toMatch(
      /throw\s+err\s*;/,
    );
    const fail = tail.search(/op\.fail\s*\(/);
    const rethrow = tail.search(/throw\s+err\s*;/);
    expect(fail).toBeLessThan(rethrow); // log BEFORE recovering
  });

  it('returns totalMs, so the renderer can isolate IPC overhead from the model', () => {
    expect(body, 'generate no longer returns totalMs').toMatch(/totalMs\s*:/);
    expect(body).toMatch(/return\s*\{[\s\S]*totalMs/);
  });

  it('still disposes the session and the sequence (the instrument changed nothing)', () => {
    expect(body).toMatch(/session\.dispose\s*\(/);
    expect(body).toMatch(/sequence\.dispose\s*\(/);
  });
});

// =========================================================================================
// main.mjs
// =========================================================================================

describe('main.mjs configures the log FIRST, inside whenReady (G6)', () => {
  it('calls configureLogDir with the user-data path, above the SMOKE branch', () => {
    const ready = MAIN.search(/app\.whenReady\s*\(\s*\)/);
    const configure = MAIN.search(/configureLogDir\s*\(/);
    const smoke = MAIN.search(/if\s*\(\s*SMOKE\s*\)/);
    const window = MAIN.search(/await\s+createWindow\s*\(/);
    // All four anchors first — an index comparison against -1 passes by accident.
    expect(ready, 'app.whenReady is gone').toBeGreaterThan(-1);
    expect(configure, 'main.mjs no longer configures the log directory — that is G6').toBeGreaterThan(-1);
    expect(smoke, 'the SMOKE branch is gone').toBeGreaterThan(-1);
    expect(window, 'createWindow is no longer awaited in whenReady').toBeGreaterThan(-1);
    expect(configure, 'the log is configured before the app is ready — userData is not valid yet').toBeGreaterThan(ready);
    expect(configure, 'the SMOKE path runs before the log exists — a failing smoke run leaves no log').toBeLessThan(smoke);
    expect(configure, 'the window (and the model load) starts before the log exists').toBeLessThan(window);
  });

  it('takes the directory from app.getPath("userData"), never from __dirname', () => {
    // Follow the value, not the call site: the directory is computed one line above and
    // handed in, so a guard that only reads the `configureLogDir(...)` text watches the
    // wrong door — the same mistake that let `runMeta` fabricate a summary one level down
    // while every `saveRun(...)` call site scanned clean.
    const assignment = MAIN.match(/const\s+logDir\s*=\s*([^;]+);/);
    expect(assignment, 'the log directory is no longer computed — this guard has gone stale').not.toBeNull();
    expect(
      assignment[1],
      'the log dir is no longer derived from userData — in a packed build that path is read-only, ' +
        'and every log call becomes a silent no-op (G6)',
    ).toMatch(/app\.getPath\s*\(\s*['"]userData['"]\s*\)/);
    expect(assignment[1], 'the log dir is derived from __dirname again — that is G6 verbatim').not.toMatch(
      /__dirname/,
    );
    const call = callsTo(MAIN, 'configureLogDir')[0];
    expect(call, 'configureLogDir is never called').toBeDefined();
    expect(argsOf(call)[0], 'configureLogDir is handed something other than that directory').toBe(
      'logDir',
    );
  });

  it('and prints where it is logging, from the module that owns the path', () => {
    expect(MAIN).toMatch(/logFilePath\s*\(\s*\)/);
    expect(MAIN, 'main.mjs imports the old module-scope LOG_FILE constant again').not.toMatch(
      /\bLOG_FILE\b/,
    );
  });
});

describe('main.mjs memoises the narrator PROMISE (G37)', () => {
  it('uses the gate, and no longer keeps a resolved-value guard', () => {
    expect(MAIN, 'main.mjs no longer uses the narrator gate').toMatch(/createNarratorGate\s*\(/);
    // THE DEFECT, in the two shapes it can come back in: a bare mutable `narrator` that is
    // assigned after an await, and the `if (!narrator)` guard that is blind to a load in
    // flight. Either one restores a second 2.5 GB load on the first narrated beat.
    expect(MAIN, 'the narrator is assigned after an await again — that is G37 verbatim').not.toMatch(
      /narrator\s*=\s*await\b/,
    );
    expect(MAIN, 'the resolved-value guard is back — it cannot see an in-flight load').not.toMatch(
      /if\s*\(\s*!\s*narrator\s*\)/,
    );
  });

  it('the gate is created with a factory that is CALLED, not awaited, at the seam', () => {
    const call = callsTo(MAIN, 'createNarratorGate')[0];
    expect(call, 'the gate is not constructed').toBeDefined();
    expect(call, 'the gate no longer builds a narrator').toMatch(/createNarrator\s*\(/);
    expect(
      call,
      'the factory awaits inside itself before returning — the gate would memoise nothing',
    ).not.toMatch(/await\s+createNarrator/);
    expect(call, 'the narrator is no longer given a log sink').toMatch(/log:\s*mlog/);
  });

  it('every ensureNarrator call names its trigger, so the log says who paid for the load', () => {
    const calls = callsTo(MAIN, 'ensureNarrator');
    expect(calls.length, 'nothing calls ensureNarrator any more').toBeGreaterThan(1);
    for (const c of calls) {
      expect(argsOf(c)[0], `${c} has no trigger`).toMatch(/^'(boot|generate)'$/);
    }
    // Both triggers really are used — a table where every row said 'boot' would prove
    // nothing about the generate path, which is the one the freeze happened on.
    const triggers = new Set(calls.map((c) => argsOf(c)[0]));
    expect(triggers).toEqual(new Set(["'boot'", "'generate'"]));
  });
});

describe('the llm:generate handler times the wait and reports its own failures', () => {
  const body = MAIN.slice(MAIN.indexOf("ipcMain.handle('llm:generate'"));

  it('the anchor exists', () => {
    expect(MAIN.indexOf("ipcMain.handle('llm:generate'"), 'the handler is gone').toBeGreaterThan(-1);
    expect(body).toMatch(/ensureNarrator\s*\(/);
  });

  it('reads readiness BEFORE awaiting the narrator (or the wait measures nothing)', () => {
    const readyRead = body.search(/isReady\s*\(\s*\)/);
    const awaitEnsure = body.search(/await\s+ensureNarrator\s*\(/);
    expect(readyRead, 'the handler no longer checks whether the narrator was ready').toBeGreaterThan(-1);
    expect(awaitEnsure, 'the handler no longer awaits the narrator').toBeGreaterThan(-1);
    expect(
      readyRead,
      'readiness is read AFTER the await — it is then always true and the wait is never reported',
    ).toBeLessThan(awaitEnsure);
  });

  it('reports the wait when the narrator was NOT ready — the polarity, not the presence', () => {
    // Inverted, this reports a wait on every request that did NOT wait and stays silent on
    // the one that did: the freeze becomes invisible and the log fills with noise.
    expect(body, 'the wait is no longer reported at all').toMatch(
      /if\s*\(\s*!\s*wasReady\s*\)/,
    );
    expect(body, 'the wait is reported when the narrator WAS already loaded — inverted').not.toMatch(
      /if\s*\(\s*wasReady\s*\)/,
    );
    const wait = callsTo(body, 'mlog').find((c) => c.includes('waiting for narrator'));
    expect(wait, 'the waiting line is gone').toBeDefined();
    expect(wait, 'the wait is not recorded in milliseconds').toMatch(/waitedMs/);
    expect(argsOf(wait)[0], 'a wait of tens of seconds is not a debug detail').toBe("'warn'");
  });

  it('logs before re-throwing, so the main-side cause is not lost across IPC', () => {
    const catchAt = body.search(/\}\s*catch\s*\(/);
    expect(catchAt, 'the handler no longer catches — the cause dies at the IPC boundary').toBeGreaterThan(-1);
    const tail = body.slice(catchAt);
    const logAt = tail.search(/mlog\s*\(/);
    const rethrow = tail.search(/throw\s+err\s*;/);
    expect(logAt, 'the handler catches and says nothing').toBeGreaterThan(-1);
    expect(rethrow, 'the handler swallows the error — the renderer would see a silent success').toBeGreaterThan(-1);
    expect(logAt, 'it re-throws before it logs').toBeLessThan(rethrow);
    const failure = callsTo(tail, 'mlog')[0];
    expect(argsOf(failure)[0]).toBe("'error'");
    expect(failure).toMatch(/stack/);
  });

  it('the request id reaches the narrator, so a log line can be tied to a request', () => {
    expect(body).toMatch(/generate\s*\(\s*\{[\s\S]*requestId/);
  });
});

describe('the window load is timed (G41 shows up here first)', () => {
  const body = bodyOf(MAIN, 'async function createWindow(');

  it('brackets the load and escalates past the threshold', () => {
    const start = body.search(/windowT0\s*=/);
    const load = body.search(/await\s+win\.load(URL|File)\s*\(/);
    const report = body.search(/'window loaded'/);
    expect(start, 'the window load is no longer timed').toBeGreaterThan(-1);
    expect(load, 'the window is no longer loaded').toBeGreaterThan(-1);
    expect(report, 'the window load is never reported').toBeGreaterThan(-1);
    expect(start).toBeLessThan(load);
    expect(load).toBeLessThan(report);
    expect(body, 'the window-load threshold is no longer the derived one').toMatch(
      /THRESHOLDS\.windowLoad/,
    );
  });

  it('escalates when the load is SLOW, not when it is fast', () => {
    // Inverted, a five-second load (G41: Electron pointed at somebody else's server) is
    // logged at `info` and every instant load screams `warn`.
    expect(body).toMatch(/windowMs\s*>=\s*THRESHOLDS\.windowLoad\s*\?\s*'warn'\s*:\s*'info'/);
    expect(body).not.toMatch(/windowMs\s*<\s*THRESHOLDS\.windowLoad\s*\?\s*'warn'/);
  });
});

describe('the process-level handlers and the level filter', () => {
  it('both fatal handlers report how far into the session they fired', () => {
    for (const kind of ['uncaughtException', 'unhandledRejection']) {
      const call = callsTo(MAIN, 'mlog').find((c) => c.includes(`'${kind}'`));
      expect(call, `${kind} is no longer logged`).toBeDefined();
      expect(call, `${kind} does not say how long the session had been running`).toMatch(/uptimeMs/);
    }
  });

  it('mlog filters by the resolved level rather than writing everything', () => {
    const body = bodyOf(MAIN, 'function mlog(');
    expect(body, 'mlog no longer applies the level policy — a packaged build would write debug').toMatch(
      /passesLevel\s*\(\s*level\s*,\s*LOG_LEVEL\s*\)/,
    );
    // The polarity: inverted, a packaged build writes ONLY the lines it should drop.
    expect(body).toMatch(/if\s*\(\s*!\s*passesLevel\s*\([^)]*\)\s*\)\s*return/);
    expect(MAIN).toMatch(/resolveMainLogLevel\s*\(\s*\{\s*env:\s*process\.env,\s*dev:\s*!!DEV_URL/);
  });
});

// =========================================================================================
// The rule that makes a log greppable: A NUMBER LIVES IN `data`, NEVER IN `message`.
// =========================================================================================

describe('no measurement is interpolated into a message', () => {
  it('main.mjs: no mlog call contains a template interpolation anywhere', () => {
    const calls = callsTo(MAIN, 'mlog');
    expect(calls.length, 'no mlog calls found — this guard has gone stale').toBeGreaterThan(8);
    for (const c of calls) {
      expect(c, `a measurement is interpolated into a log call: ${c.slice(0, 80)}`).not.toMatch(
        /\$\{/,
      );
    }
  });

  it('main.mjs: every mlog message is a plain quoted string with no digit', () => {
    const calls = callsTo(MAIN, 'mlog');
    expect(calls.length, 'no mlog calls found — this loop would run over nothing').toBeGreaterThan(8);
    for (const c of calls) {
      const message = argsOf(c)[2];
      expect(message, `${c.slice(0, 60)} has no message argument`).toBeDefined();
      expect(message, `${message} is not a constant string`).toMatch(/^'[^'$]*'$/);
      expect(message, `${message} carries a number in the message`).toMatch(/^'[^0-9]*'$/);
    }
  });

  it('llm.mjs: every instrumented operation name is a plain constant', () => {
    const calls = [...callsTo(LLM, 'inst\\.run'), ...callsTo(LLM, 'inst\\.begin')];
    expect(calls.length, 'no instrumented operations found').toBeGreaterThan(5);
    for (const c of calls) {
      const args = argsOf(c);
      expect(args[0], `${c.slice(0, 40)}: the category is not a constant`).toMatch(/^'[a-z]+'$/);
      expect(args[1], `${c.slice(0, 40)}: the operation name is not a constant`).toMatch(
        /^'[a-z ]+'$/,
      );
    }
  });
});
