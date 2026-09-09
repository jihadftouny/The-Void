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
import {
  stripComments,
  callsTo,
  argsOf,
  stripReachesEndOfFile,
} from '../src/log/sourceScan.testutil.ts';

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
  // ⚠ THE ANCHOR SET MUST REACH THE END OF THE FILE. The scanner does not track regular
  // expression literals, so a regex containing `/*` opens a hole that swallows everything
  // to the next `*​/`. Anchoring only the TOP of a file leaves the region BELOW the lowest
  // anchor unprotected — demonstrated: a `const HOLE = /a\/*b/;` inserted after the last
  // anchored export, followed by G6 verbatim, was green. Each list below therefore ends
  // with the file's LAST statement, so any hole spans an anchor and fires.
  it('main.mjs keeps its imports, its handler, its ready block AND its last statement', () => {
    expect(MAIN).toMatch(/import\s*\{\s*app,\s*BrowserWindow,\s*ipcMain\s*\}\s*from\s*'electron'/);
    expect(MAIN).toMatch(/function\s+mlog\s*\(/);
    expect(MAIN).toMatch(/async function createWindow\(/);
    expect(MAIN).toMatch(/ipcMain\.handle\s*\(\s*'llm:generate'/);
    expect(MAIN).toMatch(/app\.whenReady\s*\(\s*\)/);
    expect(MAIN, 'the strip ate the tail of main.mjs — a hole below the last anchor').toMatch(
      /app\.on\s*\(\s*'window-all-closed'/,
    );
    expect(stripReachesEndOfFile(RAW_MAIN), 'the strip ran off the END of the file — a regex literal containing `/*` with no later `*/` swallows everything after it, and every anchor ABOVE it still passes').toBe(true);
    expect(MAIN.length).toBeLessThan(RAW_MAIN.length);
  });

  it('llm.mjs keeps its imports, its factory AND its last statement', () => {
    expect(LLM).toMatch(/import\s*\{[^}]*getLlama[^}]*\}\s*from\s*'node-llama-cpp'/);
    expect(LLM).toMatch(/export\s+async\s+function\s+createNarrator/);
    expect(LLM).toMatch(/async generate\(/);
    expect(LLM, 'the strip ate the tail of llm.mjs — a hole below the last anchor').toMatch(
      /sequence\.dispose\s*\(\s*\)/,
    );
    expect(stripReachesEndOfFile(RAW_LLM), 'the strip ran off the END of the file — a regex literal containing `/*` with no later `*/` swallows everything after it, and every anchor ABOVE it still passes').toBe(true);
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
    // RED against: deleting an `inst.run` wrapper; and renaming the operation so no
    // block answers to the phase name.
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

  it('passes a real threshold to EVERY instrumented operation, run and begin alike', () => {
    // `createInstrument`'s threshold defaults to `Infinity`, so an omitted argument means
    // the operation can NEVER escalate to `warn`. §4.5's whole argument for shipping at
    // `info` — "every slow operation is captured because slowness escalates" — depends on
    // this, and the operation it was missing on was `generate`: the single slowest thing
    // in the product, where a 60-second generation would have been logged `info` forever.
    // `run(category, name, data, fn, threshold)` takes five; `begin(category, name, data,
    // threshold)` takes four. Both put the threshold LAST, so the check is "the last
    // argument is a threshold AND the count is right" — a dropped threshold shortens the
    // list, and a threshold moved to the wrong position fails the pattern.
    const ops = [
      ...runCalls.map((c) => ['inst.run', c, 5]),
      ...callsTo(LLM, 'inst\\.begin').map((c) => ['inst.begin', c, 4]),
    ];
    expect(ops.length, 'no instrumented operations found — this guard has gone stale').toBe(
      PHASES.length + 1,
    );
    for (const [kind, call, arity] of ops) {
      const args = argsOf(call);
      const name = args[1];
      expect(
        args.length,
        `${kind}(${name}): expected ${arity} arguments — a dropped threshold means this ` +
          'operation can never warn, however slow it gets',
      ).toBe(arity);
      expect(args[arity - 1], `${kind}(${name}): the last argument is not a derived threshold`).toMatch(
        /^THRESHOLDS\./,
      );
    }
    // ...and the one `begin` really is the generation, with the generation's threshold.
    const gen = callsTo(LLM, 'inst\\.begin')[0];
    expect(argsOf(gen)[1]).toBe("'generate'");
    expect(argsOf(gen)[3]).toBe('THRESHOLDS.generate');
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
    // RED against: removing `generate` entirely; and renaming `session.prompt`, which
    // would leave every guard in this block scanning nothing at all.
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
    // RED against: deleting `totalMs` from the returned object; and computing it but
    // dropping it before the `return`, which the second assertion catches.
    expect(body, 'generate no longer returns totalMs').toMatch(/totalMs\s*:/);
    expect(body).toMatch(/return\s*\{[\s\S]*totalMs/);
  });

  it('still disposes the session and the sequence (the instrument changed nothing)', () => {
    // RED against: dropping either dispose while wrapping the body in the instrument —
    // the sequence-pool leak this file already fixed once ("No sequences left").
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
    // AC-32: the banner must name the APP VERSION, and only `main.mjs` knows it. Dropping
    // this second argument leaves every real banner reading `version=unknown`, which is
    // what a mailed-in log needs most in order to be interpretable.
    expect(
      argsOf(call)[1],
      'the session banner is no longer given the app version — every shipped log becomes ' +
        'unattributable to a build',
    ).toMatch(/session:\s*\{[^}]*version:\s*app\.getVersion\(\s*\)/);
  });

  it('and prints where it is logging, from the module that owns the path', () => {
    // RED against: printing a locally recomputed path instead of `logFilePath()`; and
    // reintroducing the module-scope `LOG_FILE` constant, which is G6's own shape.
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

  // =======================================================================================
  // ⭐ THE DOOR THE CODE ACTUALLY USES (rule 4) — and the one this unit got wrong first.
  //
  // Everything else in this describe watches the gate's CONSTRUCTION. `main.mjs` can
  // construct a perfect gate, keep it fully unit-tested, and then never call it: replacing
  // `ensureNarrator`'s body with a direct `return createNarrator({...})` left ALL 1602
  // TESTS GREEN while restoring G37 completely — a second `resolveModelFile`, a second set
  // of GPU probes at 30 s each, a second 2.5 GB `loadModel`, on the first narrated beat.
  //
  // This is the identical mistake `rendererSource.test.ts` records against `runMeta`:
  // scanning the caller after the value moved one level down. Rule 4 was written at the
  // top of this file as that scar and then not applied to the single defect this unit
  // exists to fix.
  //
  // So: assert the DELEGATION positively, and assert that `createNarrator` is reachable
  // from exactly ONE place — the gate's factory. Both are name-independent, which is what
  // closes the "restore G37 verbatim but rename the variable" bypass that the two negative
  // guards below cannot see.
  // =======================================================================================
  describe('...and ensureNarrator actually goes THROUGH it', () => {
    const body = bodyOf(MAIN, 'function ensureNarrator(');

    it('delegates to the gate, and does nothing else', () => {
      expect(
        body,
        'ensureNarrator no longer delegates to the gate — every caller would start its own ' +
          'complete model load, which is G37 in full',
      ).toMatch(/return\s+narratorGate\.ensure\s*\(\s*trigger\s*,\s*onStatus\s*\)/);
    });

    it('contains no `await` — the defect IS "assigns after an await"', () => {
      // Name-independent, so `let pending = null; if (!pending) pending = await ...` is
      // caught just as `narrator` is. The memoisation is only safe because the assignment
      // happens synchronously; an `await` anywhere in this function reopens the window.
      expect(body, 'ensureNarrator awaits again — that is the exact shape of G37').not.toMatch(
        /\bawait\b/,
      );
    });

    it('and does not build a narrator itself', () => {
      expect(body, 'ensureNarrator constructs a narrator directly, bypassing the gate').not.toMatch(
        /createNarrator\s*\(/,
      );
    });

    it('createNarrator is reachable from EXACTLY ONE place: the gate factory', () => {
      // The strongest form, and the one that survives any renaming. If a second call site
      // exists anywhere — a "warm-up" in createWindow, a second gate, a restored
      // `ensureNarrator` — the count rises and this fires.
      const calls = callsTo(MAIN, 'createNarrator');
      expect(
        calls.length,
        `createNarrator is called ${calls.length} times; exactly one call site may exist, ` +
          'and it must be the gate\'s factory — a second one is a second 2.5 GB model load',
      ).toBe(1);
      const gate = callsTo(MAIN, 'createNarratorGate')[0];
      expect(gate, 'the gate is not constructed').toBeDefined();
      expect(
        gate.includes(calls[0]),
        'the one createNarrator call is OUTSIDE the gate factory — the gate memoises nothing',
      ).toBe(true);
    });
  });

  it('the gate is created with a factory that is CALLED, not awaited, at the seam', () => {
    // RED against: `await createNarrator(...)` inside the factory (the gate then
    // memoises nothing); deleting the gate's own `log: mlog`; and replacing that sink
    // with a no-op. All three verified.
    const call = callsTo(MAIN, 'createNarratorGate')[0];
    expect(call, 'the gate is not constructed').toBeDefined();
    expect(call, 'the gate no longer builds a narrator').toMatch(/createNarrator\s*\(/);
    expect(
      call,
      'the factory awaits inside itself before returning — the gate would memoise nothing',
    ).not.toMatch(/await\s+createNarrator/);
    // ⚠ NOT `toMatch(/log:\s*mlog/)` over the whole call. That regex is satisfied by the
    // INNER `createNarrator({ …, log: mlog })`, so deleting the GATE's own `log: mlog`
    // silences every `narrator load: start / done / FAILED` line and every `call:` counter
    // — the exact lines HUMAN-CHECKS.md item 3 asks the engineer to read — with the whole
    // suite green. Asserted as a TOP-LEVEL property of the gate's own config object.
    const config = argsOf(call)[0];
    expect(config, 'the gate takes no configuration object').toMatch(/^\{[\s\S]*\}$/);
    const props = argsOf(`f(${config.trim().replace(/^\{/, '').replace(/\}$/, '')})`);
    expect(
      props.some((prop) => /^log\s*:\s*mlog$/.test(prop)),
      'the GATE has no log sink of its own — it falls back to a no-op, so every ' +
        '`narrator load:` line and the G37 call counter vanish from the real log',
    ).toBe(true);
    // Both sinks must be wired: the gate's and the narrator's. One is not enough.
    expect((call.match(/log:\s*mlog/g) ?? []).length, 'a log sink is unwired').toBe(2);
  });

  it('and the gate really is the thing whose counter the log reports', () => {
    // AC-17: "ensureNarrator increments and logs a call counter". The counter lives in
    // `narrator-gate.mjs` (where it is behaviourally tested under concurrency); what
    // `main.mjs` owes is to route every caller through it AND give it a real sink.
    expect(MAIN).toMatch(/narratorGate\.ensure\s*\(/);
    expect(MAIN, 'nothing reads the gate readiness').toMatch(/narratorGate\.isReady\s*\(/);
  });

  it('every ensureNarrator call names its trigger, so the log says who paid for the load', () => {
    // RED against: dropping the trigger argument; and passing `'boot'` at every call
    // site, which makes the generate path indistinguishable in the log.
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
    // ⭐ PINNED BY EXPRESSION, NOT BY KEY. `waitedMs: 0` satisfies every assertion above
    // and satisfies `toMatch(/waitedMs/)` — and it is THE FREEZE NUMBER, the one
    // HUMAN-CHECKS.md check 3 asks the engineer to read off the log. A key with a
    // fabricated value is worse than no key: it answers the question wrongly.
    expect(wait, 'waitedMs is no longer the measured wait — the freeze number is fabricated').toMatch(
      /waitedMs:\s*Date\.now\(\)\s*-\s*t0/,
    );
    expect(body, 'the clock is not started before the wait').toMatch(/const t0\s*=\s*Date\.now\(\)/);
    expect(body, 'readiness is no longer read from the gate').toMatch(
      /const wasReady\s*=\s*narratorGate\.isReady\(\s*\)/,
    );
  });

  it('logs before re-throwing, so the main-side cause is not lost across IPC', () => {
    // RED against: dropping the `throw err` (a silent success across IPC); and swapping
    // the log and the re-throw, so the cause is gone by the time anything records it.
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
    expect(failure, 'the failure duration is fabricated rather than measured').toMatch(
      /ms:\s*Date\.now\(\)\s*-\s*t0/,
    );
  });

  it('the request id reaches the narrator, so a log line can be tied to a request', () => {
    // RED against: dropping `requestId` from the generate call; and renaming it, which
    // orphans every `generate:` line from the request that caused it.
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

  it('and windowMs is MEASURED — a constant would make the threshold unreachable', () => {
    // `const windowMs = 0` keeps every assertion above green while guaranteeing the
    // comparison can never be true. The escalation rule is then decorative.
    expect(body, 'the window duration is fabricated rather than measured').toMatch(
      /const windowMs\s*=\s*Date\.now\(\)\s*-\s*windowT0/,
    );
    expect(body, 'the window clock is never started').toMatch(/const windowT0\s*=\s*Date\.now\(\)/);
  });

  it('labels the mode from the dev-server URL, the right way round', () => {
    // `DEV_URL ? 'file' : 'dev'` is green everywhere else, and every packaged-build log
    // then claims to be a dev build — the first thing a reader uses to interpret the rest
    // of the file.
    expect(body, 'the build mode is no longer labelled').toMatch(
      /const mode\s*=\s*DEV_URL\s*\?\s*'dev'\s*:\s*'file'/,
    );
    expect(body, 'the mode label is inverted — a packaged log would claim to be a dev run').not.toMatch(
      /DEV_URL\s*\?\s*'file'\s*:\s*'dev'/,
    );
  });
});

describe('the process-level handlers and the level filter', () => {
  it('both fatal handlers report how far into the session they fired', () => {
    for (const kind of ['uncaughtException', 'unhandledRejection']) {
      const call = callsTo(MAIN, 'mlog').find((c) => c.includes(`'${kind}'`));
      expect(call, `${kind} is no longer logged`).toBeDefined();
      expect(call, `${kind} does not say how long the session had been running`).toMatch(/uptimeMs/);
      expect(call, `${kind}'s uptime is fabricated rather than measured`).toMatch(
        /uptimeMs:\s*Date\.now\(\)\s*-\s*BOOT_MS/,
      );
    }
  });

  it('the boot line reports a MEASURED bootMs, not a constant', () => {
    const booted = callsTo(MAIN, 'mlog').find((c) => c.includes("'app booted'"));
    expect(booted, 'the app-booted line is gone').toBeDefined();
    expect(booted, 'bootMs is fabricated — the boot timeline would read as instant forever').toMatch(
      /bootMs:\s*Date\.now\(\)\s*-\s*BOOT_MS/,
    );
    expect(MAIN, 'BOOT_MS is no longer captured at module scope').toMatch(
      /const BOOT_MS\s*=\s*Date\.now\(\)/,
    );
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

// =========================================================================================
// AND THE COMPLEMENT OF THAT RULE: a measurement key must carry a MEASUREMENT.
//
// Every `data` key here was pinned by NAME and never by VALUE, so `waitedMs: 0`,
// `bootMs: 0` and `const windowMs = 0` were all green. A key with a fabricated value is
// worse than a missing key: the log answers the question, and answers it wrongly, and
// nothing downstream can tell. This is the class guard — the specific expressions are
// pinned at their own sites above; this catches the NEXT one nobody thought to pin.
// =========================================================================================

describe('a measurement key never carries a constant', () => {
  const CONSTANT = /^-?\d+(?:\.\d+)?$/;

  /**
   * `{ key, value }` for every `…ms`/`…Ms` property of the PAYLOAD argument only.
   *
   * Scanning the whole call text would be wrong, and the first version of this guard was:
   * `inst.run('llm','gpu probe', {}, async () => makeSpawnProbe({ timeoutMs: 30000 }), …)`
   * has a `timeoutMs` in the operation BODY, and 30000 there is a configuration input, not
   * a fabricated measurement. Only what is written into the log payload is a measurement.
   */
  function payloadMeasurements(callText, payloadIndex) {
    const payload = argsOf(callText)[payloadIndex] ?? '';
    const found = [];
    for (const m of payload.matchAll(/\b([A-Za-z]*[Mm]s)\s*:\s*([^,\n}]+)/g)) {
      found.push({ key: m[1], value: m[2].trim() });
    }
    return found;
  }

  function assertAllMeasured(seen, floor, where) {
    expect(seen.length, `no ms-valued keys found in ${where} — this guard has gone stale`).toBeGreaterThan(
      floor,
    );
    for (const { key, value } of seen) {
      expect(
        CONSTANT.test(value),
        `${where}: ${key} is the constant ${value}, not a measurement — the log answers the ` +
          'question, and answers it wrongly',
      ).toBe(false);
    }
  }

  it('main.mjs: every ms-valued key in an mlog payload is an expression', () => {
    // `mlog(level, category, message, data)` — the payload is argument 3.
    assertAllMeasured(callsTo(MAIN, 'mlog').flatMap((c) => payloadMeasurements(c, 3)), 4, 'main.mjs');
  });

  it('llm.mjs: same, for every instrumented payload', () => {
    const seen = [
      ...callsTo(LLM, 'inst\\.run').flatMap((c) => payloadMeasurements(c, 2)),
      ...callsTo(LLM, 'inst\\.begin').flatMap((c) => payloadMeasurements(c, 2)),
      ...callsTo(LLM, 'op\\.note').flatMap((c) => payloadMeasurements(c, 0)),
      ...callsTo(LLM, 'op\\.done').flatMap((c) => payloadMeasurements(c, 0)),
    ];
    assertAllMeasured(seen, 0, 'llm.mjs');
  });

  it('the detector itself finds a planted constant (or it guards nothing)', () => {
    // Non-vacuity: the sweeps above pass whether or not the matcher works. Prove it fires.
    const planted = payloadMeasurements("mlog('warn', 'llm', 'x', { requestId, waitedMs: 0 })", 3);
    expect(planted).toEqual([{ key: 'waitedMs', value: '0' }]);
    expect(CONSTANT.test(planted[0].value)).toBe(true);
    // ...and does NOT fire on a real expression, or every payload would be an offender.
    const real = payloadMeasurements("mlog('warn', 'llm', 'x', { waitedMs: Date.now() - t0 })", 3);
    expect(CONSTANT.test(real[0].value)).toBe(false);
    // ...and it reads the PAYLOAD, not the operation body — a configuration constant in a
    // nested call is not a fabricated measurement.
    expect(payloadMeasurements("inst.run('llm', 'p', {}, () => f({ timeoutMs: 30000 }), T)", 2)).toEqual(
      [],
    );
  });
});

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

// =========================================================================================
// ADDED BY `layout-breathing-room` (2026-09-09) — ADDITIVE ONLY.
//
// THE WINDOW'S SIZE CONSTRAINTS APPLY TO THE PAGE, NOT TO THE FRAME.
//
// `docs/UI-DESIGN.md` §14 promises that "960x640 is the size every layout must survive", and
// until this unit that promise was false. `minWidth`/`minHeight` without `useContentSize`
// constrain the OUTER WINDOW, so the frame and the default menu bar came out of the page's
// share before the stylesheet saw a pixel: measured in this Electron, the identical window
// hands the page 947x577. Every layout budget in the project was computed against a number
// the renderer never received.
//
// ⚠ WHY THE GUARD READS THE ONE OBJECT LITERAL AND NOT THE FILE. `expect(MAIN).toMatch(...)`
// would be satisfied by the word appearing anywhere — in a second `BrowserWindow` built for
// something else, or in a variable that is never passed. The three options are load-bearing
// TOGETHER: a minimum that constrains a different box than the one it is written for is not
// a minimum. So they are asserted inside the same literal, which is the only place they mean
// what they say. `src/dev/layoutProbe.test.ts` owns the other end — it builds a window with
// this exact option set in a real Electron and measures what the content box reports, before
// and after a squeeze, against a control built without the flag.
// =========================================================================================

describe('the game window sizes the PAGE, not the frame (UI-DESIGN.md §14)', () => {
  /** The `new BrowserWindow({ ... })` argument literal, braces balanced. */
  const windowOptions = () => {
    const at = MAIN.indexOf('new BrowserWindow({');
    expect(at, 'main.mjs no longer builds a BrowserWindow').toBeGreaterThan(-1);
    const open = MAIN.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < MAIN.length; i += 1) {
      if (MAIN[i] === '{') depth += 1;
      else if (MAIN[i] === '}') {
        depth -= 1;
        if (depth === 0) return MAIN.slice(open, i + 1);
      }
    }
    return '';
  };

  it('the literal is really found, and it is really the game window (the anchor)', () => {
    const options = windowOptions();
    expect(options.length, 'the window options could not be read').toBeGreaterThan(80);
    expect(options, 'this is not the game window — it has no preload').toMatch(/preload/);
    expect(
      MAIN.match(/new BrowserWindow\(\{/g).length,
      'main.mjs builds more than one window — this guard now reads only the first, and the ' +
        'assertions below may be pinning the wrong one',
    ).toBe(1);
  });

  it('the minimum and the content-size flag are in the SAME literal', () => {
    // Together or not at all. A `useContentSize` on some other window, or a minimum written
    // for a box nobody sizes, is the shape this defect already took once.
    const options = windowOptions();
    expect(options, 'the window has no minimum width').toMatch(/minWidth:\s*960/);
    expect(options, 'the window has no minimum height').toMatch(/minHeight:\s*640/);
    expect(
      options,
      'the game window does not set useContentSize, so 960x640 is the FRAME and the page ' +
        'gets less than the documented minimum — the promise in UI-DESIGN.md §14 is false ' +
        'again, and every layout budget is computed against a size the renderer never sees',
    ).toMatch(/useContentSize:\s*true/);
  });

  it('and it is not switched off or made conditional', () => {
    // The lookahead excludes the one value that is allowed. Without it this pattern matches
    // `true` itself and the guard fails on correct code, which is how a guard gets deleted.
    const NOT_LITERAL_TRUE = /useContentSize:\s*(?!true\b)[A-Za-z_$][\w$]*/;
    const options = windowOptions();
    expect(options, 'useContentSize is set to false').not.toMatch(/useContentSize:\s*false/);
    expect(
      options,
      'useContentSize is behind a flag or a variable — the minimum would mean one thing on ' +
        'some machines and another on others',
    ).not.toMatch(NOT_LITERAL_TRUE);

    // The detector, proved on the shapes it is meant to catch and the one it must not.
    expect(NOT_LITERAL_TRUE.test('{ useContentSize: SOME_FLAG }')).toBe(true);
    expect(NOT_LITERAL_TRUE.test('{ useContentSize: process.env.X }')).toBe(true);
    expect(NOT_LITERAL_TRUE.test('{ useContentSize: true }')).toBe(false);
    expect(/useContentSize:\s*false/.test('{ useContentSize: false }')).toBe(true);
  });

  it('the opening size is still the one that was chosen, and still above the minimum', () => {
    const options = windowOptions();
    expect(options).toMatch(/width:\s*1100/);
    expect(options).toMatch(/height:\s*820/);
    expect(Number(/\bwidth:\s*(\d+)/.exec(options)[1])).toBeGreaterThan(960);
    expect(Number(/\bheight:\s*(\d+)/.exec(options)[1])).toBeGreaterThan(640);
  });
});
