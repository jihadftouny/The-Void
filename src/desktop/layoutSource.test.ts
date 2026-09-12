// SOURCE GUARDS on the layout wiring THIS unit added to `src/desktop/game.ts`.
//
// WHY A SOURCE SCAN, AGAIN. When this was written `game.ts` called the Electron IPC at module
// scope, so nothing could import it and every guard on it had to read its text (FINDINGS.md
// G51). PLAN.md #6 moved that into `boot()`; these scans are kept and re-anchored, and the
// behavioural half of the wiring is driven for real in `boot.test.ts`. Everything that
// COULD be lifted out of it was: the screen-to-layout mapping is `screenLayout` in
// `settings-model.ts`, the measurement and its warnings are `layout.ts`, and both are unit
// tested for real. What is left here is WIRING — which helper is called, from where, in what
// order — and wiring is the half a behavioural test cannot reach.
//
// ---------------------------------------------------------------------------------------
// COVERAGE LEDGER — enumerated from `git diff main -- src/desktop/game.ts`, filtered to the
// lines this unit added or moved, rather than by re-reading the file and trusting my eyes.
//
//   1. `const sceneryEl = $('scenery')`        -> 'the reading column owns the scenery'
//   2. `sceneryEl.appendChild(buildArtSlotById('scenery'))` in `renderHub`   -> same
//   3. `sceneryEl.replaceChildren()` x3        -> 'the region is cleared on every path'
//   4. `showScreen(key)` — the ONE funnel      -> 'both attributes, together, branchless'
//   5. `showScreen(screenKey(awaiting, screen))` in `renderChoices`          -> ordering
//   6. `showScreen('resume')` / `showScreen('content-warning')`              -> the funnel
//   7. `reportLayout()` at the END of `renderChoices`                        -> logging
//   8. the boot `viewport` line and the debounced `resize` listener          -> logging
//
// ⚠ THE ONE THAT IS EASIEST TO GET WRONG, stated so a future edit has to think about it:
// `showScreen` writes TWO attributes. A call site that wrote `data-screen` by hand would
// leave `data-layout` on the PREVIOUS screen's value — an inventory rendered into a 260px
// action column, or a hub whose prose keeps a document screen's 45vh cap. Nothing about that
// throws, nothing about it fails a source scan for `dataset['screen']`, and it would look
// almost right. So the guard is not "showScreen exists" but "NO OTHER LINE writes either
// attribute".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RAW = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
const SOURCE = stripComments(RAW);

/** The body of a top-level function declaration, up to the first closing brace in column 0. */
function bodyOf(declaration: string): string {
  const start = SOURCE.indexOf(declaration);
  expect(start, `${declaration} not found — this guard has gone stale, fix it`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('the scanner reached the end of the file (or every guard below reads a hole)', () => {
  it('the strip left game.ts intact, top and bottom', () => {
    expect(stripReachesEndOfFile(RAW), 'the comment strip ran off the end of game.ts').toBe(true);
    expect(SOURCE, 'the strip ate the imports').toMatch(/from\s*'\.\/layout\.ts'/);
    expect(SOURCE).toMatch(/function showScreen\(/);
    expect(SOURCE).toMatch(/function reportLayout\(/);
    expect(SOURCE, 'the strip ate the tail').toMatch(/function renderResume\(/);
  });
});

// =========================================================================================
// 1, 2, 3 — the scenery lives in the reading column, and is cleared on every path.
// =========================================================================================

describe('the floor’s reserved region lives in the reading column', () => {
  it('the renderer looks it up as its own element', () => {
    // RE-ANCHORED by PLAN.md #6 (G51): the lookup moved from a module-scope `const` into
    // `boot()`, which assigns a module-level slot. Searched inside `boot()`'s body, so a
    // lookup that drifted into some other function (or vanished) still fails here.
    expect(bodyOf('export function boot('), 'the scenery element is not resolved at all').toMatch(
      /\bsceneryEl\s*=\s*\$\(\s*'scenery'\s*\)/,
    );
  });

  it('the hub mounts it into the COLUMN, not into the choices', () => {
    // The defect, in one line. Mounted into `choicesEl` the 16:9 frame sat in the same box as
    // the six-row menu and took a third of the window away from the prose.
    const body = bodyOf('function renderHub(');
    expect(body, 'the hub no longer reserves the floor’s region').toMatch(
      /sceneryEl\.appendChild\(\s*buildArtSlotById\(\s*'scenery'\s*\)\s*\)/,
    );
    expect(
      body,
      'the scenery is mounted into the choices again — that is the layout defect returning',
    ).not.toMatch(/choicesEl\.appendChild\(\s*buildArtSlotById/);
  });

  it('and every path that clears the choices clears the scenery too', () => {
    // It is NOT a child of `#choices` any more, so `choicesEl.innerHTML = ''` no longer
    // removes it. Miss one of these and each re-render of the hub stacks another frame on
    // the column until the prose is gone — the same symptom by a different route.
    for (const fn of ['function renderChoices(', 'function start(', 'async function dispatch(']) {
      expect(
        bodyOf(fn),
        `${fn} clears the choices but leaves the scenery — frames would accumulate`,
      ).toMatch(/sceneryEl\.replaceChildren\(\s*\)/);
    }
  });

  it('...and each of those really does clear the choices as well (the anchor)', () => {
    for (const fn of ['function renderChoices(', 'function start(', 'async function dispatch(']) {
      expect(bodyOf(fn)).toMatch(/choicesEl\.(?:innerHTML\s*=\s*''|replaceChildren\(\s*\))/);
    }
  });

  it('PLAN.md #6: the paths that clear the scenery clear the battle frame’s regions too', () => {
    // The arena and the stat box are not part of the choices either, so the same bug is
    // waiting: miss one path and a second enemy region stacks on the stage, or the frame of
    // the last fight hangs, hidden, under the hub (the walk counts enemy regions page-wide).
    for (const fn of ['function renderChoices(', 'function start(']) {
      const body = bodyOf(fn);
      expect(body, `${fn} leaves the arena standing`).toMatch(/arenaEl\.replaceChildren\(\s*\)/);
      expect(body, `${fn} leaves the stat box standing`).toMatch(/vitalsEl\.replaceChildren\(\s*\)/);
    }
    // ...and renderChoices clears them BEFORE the switch, or the battle arm's fresh frame
    // would be wiped as soon as it was built.
    const body = bodyOf('function renderChoices(');
    const sw = body.search(/switch\s*\(\s*awaiting\s*\)/);
    expect(body.search(/arenaEl\.replaceChildren\(/)).toBeLessThan(sw);
    expect(body.search(/vitalsEl\.replaceChildren\(/)).toBeLessThan(sw);
  });

  it('the scenery is cleared BEFORE the screen is built, not after', () => {
    // After the switch, it would wipe the frame the hub had just mounted.
    const body = bodyOf('function renderChoices(');
    const clear = body.search(/sceneryEl\.replaceChildren\(/);
    const sw = body.search(/switch\s*\(\s*awaiting\s*\)/);
    expect(clear, 'nothing clears the scenery in renderChoices').toBeGreaterThan(-1);
    expect(clear, 'the scenery is cleared after the screen is built — the hub’s frame is wiped')
      .toBeLessThan(sw);
  });
});

// =========================================================================================
// 4, 5, 6 — the screen funnel. Two attributes, one writer.
// =========================================================================================

describe('the screen and the stage layout are announced together, from one place', () => {
  const body = bodyOf('function showScreen(');

  it('it writes BOTH attributes', () => {
    expect(body, 'the data-screen hook is gone — every per-screen rule stops matching').toMatch(
      /dataset\['screen'\]\s*=\s*key/,
    );
    expect(body, 'the data-layout hook is gone — the stage keeps one geometry forever').toMatch(
      /dataset\['layout'\]\s*=\s*screenLayout\s*\(\s*key\s*\)/,
    );
  });

  it('and it takes the layout from the PURE function, not from a condition here', () => {
    // A branch here would be a second copy of a mapping that is already exhaustively tested
    // in `settings-model.test.ts`, and the two would drift.
    expect(body, 'showScreen grew a condition').not.toMatch(/\bif\s*\(/);
    expect(body, 'showScreen grew a ternary').not.toMatch(/\?/);
    expect(body, 'showScreen grew a short-circuit').not.toMatch(/&&|\|\|/);
  });

  it('NO OTHER LINE writes either attribute — this is the guard that matters', () => {
    // ⚠ A call site that set `data-screen` by hand would leave `data-layout` showing the
    // PREVIOUS screen's geometry: a document rendered into a 260px action column, or a hub
    // whose prose keeps a document screen's cap. It throws nothing and looks almost right.
    const WRITER = /dataset\['(?:screen|layout)'\]\s*=/g;
    const writers = [...SOURCE.matchAll(WRITER)];
    expect(writers.length, 'nothing writes the screen attributes at all').toBe(2);
    // PLAN.md #6's opened-log flag is a DIFFERENT attribute (`data-log`, written by
    // `battle.ts`'s `setLogOpen` on the reading column) and must not be counted as a third
    // screen writer — asserted, so the count above keeps meaning what it says.
    expect(WRITER.test("column.dataset['log'] = open ? 'open' : 'closed';")).toBe(false);
    WRITER.lastIndex = 0;
    const funnel = SOURCE.indexOf('function showScreen(');
    const funnelEnd = SOURCE.indexOf('\n}', funnel);
    for (const writer of writers) {
      expect(
        writer.index,
        `an attribute is written outside showScreen: ${SOURCE.slice(
          writer.index,
          (writer.index ?? 0) + 40,
        )}`,
      ).toBeGreaterThan(funnel);
      expect(writer.index).toBeLessThan(funnelEnd);
    }
  });

  it('renderChoices routes through it, with both of screenKey’s inputs', () => {
    // Handing it `awaiting` alone would style the inventory, the sheet, the settings screen
    // and the abandon confirmation all as the hub, because the engine is still at
    // `main-menu` behind them — and would give all four the wrong stage geometry as well.
    expect(bodyOf('function renderChoices(')).toMatch(
      /showScreen\s*\(\s*screenKey\s*\(\s*awaiting\s*,\s*screen\s*\)\s*\)/,
    );
  });

  it('and the other two entry points route through it too', () => {
    expect(bodyOf('function renderResume('), 'the resume screen sets no screen at all').toMatch(
      /showScreen\s*\(\s*'resume'\s*\)/,
    );
    expect(bodyOf('function start('), 'the content warning sets no screen at all').toMatch(
      /showScreen\s*\(\s*'content-warning'\s*\)/,
    );
  });
});

// =========================================================================================
// 7, 8 — the instrumentation (CLAUDE.md principle 7).
// =========================================================================================

describe('the renderer records what the layout actually came out as', () => {
  it('renderChoices measures, and measures LAST', () => {
    // Before the switch it would measure the previous screen; inside it, it would need a
    // call in every case. After it, once, is the only place the number is true.
    const body = bodyOf('function renderChoices(');
    const call = body.search(/reportLayout\s*\(\s*\)/);
    const sw = body.search(/switch\s*\(\s*awaiting\s*\)/);
    expect(call, 'renderChoices no longer measures the layout it just built').toBeGreaterThan(-1);
    expect(call, 'the layout is measured before the screen is built').toBeGreaterThan(sw);
  });

  it('and it measures the real elements, then warns through the pure function', () => {
    const body = bodyOf('function reportLayout(');
    expect(body, 'the report is not read from the DOM').toMatch(
      /readLayout\s*\(\s*\{\s*narrationEl\s*,\s*logEl\s*,\s*choicesEl\s*,\s*sceneryEl\s*\}\s*\)/,
    );
    expect(body, 'the measurement is never logged').toMatch(/log\.debug\('render', 'layout'/);
    expect(body, 'the warnings are not computed').toMatch(/layoutWarnings\s*\(\s*report\s*\)/);
    expect(body, 'a layout warning never reaches the log').toMatch(/log\.warn\('render'/);
  });

  it('the boot line reports the REAL viewport, never a constant', () => {
    // A constant here would be worse than no line: it would answer the question wrongly.
    const at = SOURCE.indexOf("log.info('render', 'viewport'");
    expect(at, 'the viewport is never recorded').toBeGreaterThan(-1);
    const call = SOURCE.slice(at, SOURCE.indexOf('});', at));
    expect(call, 'the width is not measured').toMatch(/width:\s*window\.innerWidth/);
    expect(call, 'the height is not measured').toMatch(/height:\s*window\.innerHeight/);
    expect(call, 'the display scale is not recorded').toMatch(/dpr:\s*window\.devicePixelRatio/);
    expect(call, 'the viewport line carries a constant').not.toMatch(/(?:width|height):\s*\d/);
  });

  it('a resize is recorded, and DEBOUNCED', () => {
    // Resizing fires continuously while a window is dragged. Undebounced, one drag writes a
    // hundred lines and buries everything else in the file.
    expect(SOURCE, 'a resize is never recorded').toMatch(
      /addEventListener\(\s*'resize'\s*,/,
    );
    const at = SOURCE.indexOf("addEventListener('resize'");
    const handler = SOURCE.slice(at, at + 400);
    expect(handler, 'the resize listener is not debounced').toMatch(/clearTimeout\s*\(/);
    expect(handler, 'the resize listener does not defer').toMatch(/setTimeout\s*\(/);
    expect(handler, 'a resize is logged above debug — it would flood a shipped log').toMatch(
      /log\.debug\('render'/,
    );
  });

  it('and no layout logging happens inside the pure module (principle 7)', () => {
    // `src/desktop/layout.ts` is the boundary READ; the decision to log belongs here, in
    // `game.ts`. `src/log/purity.test.ts` keeps the render layer clear of the logger and
    // this keeps the desktop half honest about which side of the line it is on.
    const layout = readFileSync(path.join(ROOT, 'src/desktop/layout.ts'), 'utf8');
    expect(layout, 'the layout module logs for itself').not.toMatch(/\blog\s*\.\s*(?:info|warn|debug|error)\s*\(/);
    expect(layout, 'the layout module imports the logger').not.toMatch(/from\s*'[^']*\/log\//);
  });

  it('...nor inside the battle DOM module (PLAN.md #6, AC-31): it returns, game.ts logs', () => {
    const battle = stripComments(readFileSync(path.join(ROOT, 'src/desktop/battle.ts'), 'utf8'));
    expect(battle, 'battle.ts logs for itself').not.toMatch(/\blog\s*\.\s*(?:info|warn|debug|error|log)\s*\(/);
    expect(battle, 'battle.ts imports the logger').not.toMatch(/from\s*'[^']*\/log\//);
    // Non-vacuity: this read the real module, and the round's record is really handed back.
    expect(battle).toMatch(/export async function playRound\(/);
    expect(battle).toMatch(/return\s*\{\s*beats:\s*plan\.beats\.length,\s*hooks\s*\}/);
  });
});
