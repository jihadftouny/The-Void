// SOURCE GUARDS on the wiring THIS unit added to `src/desktop/game.ts` (PLAN.md #8, AC-12).
//
// WHY A SOURCE SCAN. `src/desktop/game.ts` calls the Electron IPC at module scope, so it
// cannot be imported and every guard on it must read it (FINDINGS.md G51). Everything this
// unit could lift OUT of it was lifted — `hubMenu`, `screenKey`, `floorTagText`,
// `settings-model`, and the DOM builders in `screens.ts`, all of which are behaviourally
// tested elsewhere. What is left here is WIRING: which helper is called, in which branch, in
// which order. `rendererSource.test.ts` and `instrumentationSource.test.ts` own the wiring
// that PRECEDED this unit and are not edited; this file owns what this unit added.
//
// ---------------------------------------------------------------------------------------
// COVERAGE LEDGER — enumerated MECHANICALLY from `git diff main -- src/desktop/game.ts`,
// filtered to lines carrying a branch, not by re-reading the file and trusting my eyes.
// Three earlier units missed something every time they swept by eye.
//
//   1. `hubMenu(screen === 'confirm-abandon' ? … : 'menu')`  -> 'shows the CONFIRMATION only…'
//   2. `prompt.textContent = view.prompt ?? ''`              -> 'the empty prompt is EMPTY…'
//   3. `if (action.kind === 'dispatch')`                     -> 'only the dispatch shape…'
//   4. `screen = action.kind === 'screen' ? … : HUB_MODE…`   -> 'the hub mode table…'
//   5. `if (screen === 'settings')`                          -> 'routes to settings POSITIVELY'
//
// Plus the ORDERINGS and the BRANCHLESS statements, which carry no polarity and would
// therefore be pinned by nothing at all:
//
//   6. `retheme()`      — applyTheme BEFORE applySettings, and the floor tag written
//   7. `start()`        — the content warning BEFORE any title choice
//   8. every `innerHTML` assignment assigns the empty string and nothing else
//   9. the run summary is handed `runSeed`
//  10. `renderChoices` writes `data-screen` through `screenKey`
//  11. the boot path loads settings, and a change persists them
//  12. all three reserved art regions are actually mounted
//
// ⚠ TWO OF THE FIVE BRANCHES ABOVE ARE PINNED BY THE TYPE SYSTEM, and that is stated rather
// than quietly relied on: `HubItemAction` is a discriminated union, so negating #3 or
// swapping #4's arms makes the narrowed member's field unreachable and `tsc --noEmit` fails.
// The regexes below still pin their SHAPE, because a source guard that assumes a compiler
// error will be noticed has assumed the compiler is run.
// ---------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RAW = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
const SOURCE = stripComments(RAW);
const HTML = readFileSync(path.join(ROOT, 'desktop.html'), 'utf8');
const MAIN = readFileSync(path.join(ROOT, 'electron/main.mjs'), 'utf8');

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
    expect(SOURCE, 'the strip ate the imports').toMatch(/from\s*'\.\/screens\.ts'/);
    expect(SOURCE).toMatch(/function retheme\(/);
    expect(SOURCE).toMatch(/function renderHub\(/);
    expect(SOURCE, 'the strip ate the tail').toMatch(/function renderResume\(/);
    expect(SOURCE, 'the strip ate the boot block').toMatch(/const saved = loadRun\(\)/);
  });
});

// =========================================================================================
// 1 & 2 — the hub, and the confirmation that cannot be opened by accident.
// =========================================================================================

describe('the hub is built from the pure model, in the right mode', () => {
  const body = bodyOf('function renderHub(');

  it('calls hubMenu at all (the anchor)', () => {
    expect(body, 'the hub no longer goes through the model').toMatch(/hubMenu\s*\(/);
  });

  it('shows the CONFIRMATION only when the confirmation is the current screen', () => {
    // Inverted, this shows the abandon confirmation on the ordinary hub and the ordinary hub
    // when the player has just asked to abandon — so the FIRST thing a player sees on
    // reaching the hub is a question about destroying the run, and the row that opens the
    // confirmation opens nothing. The ternary keeps its position under inversion, so an
    // ordering assertion could not see it.
    expect(body, 'the hub mode is no longer chosen by the current screen').toMatch(
      /hubMenu\s*\(\s*screen\s*===\s*'confirm-abandon'\s*\?\s*'confirm-abandon'\s*:\s*'menu'\s*\)/,
    );
    expect(body, 'the hub mode test is negated').not.toMatch(/screen\s*!==\s*'confirm-abandon'/);
  });

  it('the empty prompt is EMPTY — the collapse is CSS, not a branch', () => {
    // The paragraph is appended unconditionally and `.hub-prompt:empty` collapses it, the
    // idiom `#log`, `#notice` and `.chips` already use. A branch that does not exist cannot
    // be inverted. What CAN still go wrong is the fallback growing a word, which would put a
    // stray question mark on the hub of every run.
    expect(body, 'the hub prompt is no longer written').toMatch(
      /prompt\.textContent\s*=\s*view\.prompt\s*\?\?\s*''\s*;/,
    );
    expect(body, 'the prompt paragraph is now conditional — CSS was already doing that job')
      .not.toMatch(/if\s*\(\s*view\.prompt/);
  });

  it('and the row flags carry no branch either', () => {
    // `classList.toggle(name, force)` rather than `if (item.destructive)`. Two more branches
    // on the one screen whose entire purpose is to have as few as possible.
    expect(body).toMatch(/classList\.toggle\(\s*'is-destructive'\s*,\s*item\.destructive === true/);
    expect(body).toMatch(/classList\.toggle\(\s*'is-separated'\s*,\s*item\.separated === true/);
    expect(body, 'a row flag grew a conditional again').not.toMatch(/if\s*\(\s*item\./);
  });

  it('and the floor’s own reserved region is mounted here', () => {
    expect(body).toMatch(/buildArtSlotById\s*\(\s*'scenery'\s*\)/);
  });
});

describe('G5 — the string that ends a run exists in exactly one place, and it is not here', () => {
  it('game.ts contains no quit literal at all', () => {
    // THE STRONGEST FORM OF THIS UNIT'S PROMISE. `hubMenu` is where the quit input is built,
    // and only in its confirmation mode; the renderer never writes the word. So this is not
    // "the renderer asks first" — it is "there is no second place a one-click abandon could
    // be reintroduced". Matched in either quote style.
    expect(
      SOURCE,
      'the renderer dispatches a quit directly again — that is G5, one click destroying a ' +
        '45-90 minute permadeath run',
    ).not.toMatch(/['"`]quit['"`]/);
  });

  it('...and the model it delegates to is really reached (or the absence means nothing)', () => {
    expect(SOURCE, 'nothing calls hubMenu — the quit simply went missing').toMatch(/hubMenu\s*\(/);
    expect(SOURCE).toMatch(/renderHub\s*\(\s*\)/);
  });

  it('the abandon row cannot be re-added as a bare choice() either', () => {
    const body = bodyOf('function renderChoices(');
    expect(body, 'the hub grew a hand-written Abandon row again').not.toMatch(
      /choice\s*\(\s*['"`]Abandon/,
    );
  });
});

// =========================================================================================
// 3 & 4 — what a hub row is allowed to do.
// =========================================================================================

describe('a hub row reaches the engine only through the dispatch shape', () => {
  const body = bodyOf('function runHubAction(');

  it('branches POSITIVELY on the dispatch shape', () => {
    expect(body, 'the dispatch arm is gone').toMatch(/if\s*\(\s*action\.kind\s*===\s*'dispatch'\s*\)/);
    expect(body, 'the dispatch test is negated — screen routes would dispatch').not.toMatch(
      /action\.kind\s*!==\s*'dispatch'/,
    );
  });

  it('and dispatches the model’s own input, never one it builds itself', () => {
    // A renderer that constructed `{ kind: 'menu', choice: … }` here would put the quit back
    // in this file, which is what the guard above forbids.
    expect(body).toMatch(/dispatch\s*\(\s*action\.input\s*\)/);
    expect(body, 'the renderer builds a menu input of its own again').not.toMatch(
      /kind:\s*'menu'/,
    );
  });

  it('the hub mode goes through the TABLE, not a second ternary', () => {
    expect(body).toMatch(/HUB_MODE_SCREEN\s*\[\s*action\.mode\s*\]/);
    expect(SOURCE, 'the hub-mode table is gone').toMatch(
      /HUB_MODE_SCREEN[^=]*=\s*\{\s*menu:\s*'game',\s*'confirm-abandon':\s*'confirm-abandon',?\s*\}/,
    );
  });

  it('and re-renders after a screen change, or the click does nothing visible', () => {
    expect(body).toMatch(/rerender\s*\(\s*\)/);
  });
});

// =========================================================================================
// 5 — the settings route.
// =========================================================================================

describe('the settings screen is routed positively, from above the phase switch', () => {
  const body = bodyOf('function renderChoices(');

  it('branches on `screen === settings`, not on its negation', () => {
    // Negated, every screen in the game renders the settings screen except the settings
    // screen — which is loud, and would still be worth pinning, but the reason it is pinned
    // is that a WIDENED condition (`screen === 'settings' || screen === 'sheet'`) is silent.
    expect(body, 'the settings route is gone').toMatch(/if\s*\(\s*screen\s*===\s*'settings'\s*\)/);
    expect(body, 'the settings route is negated').not.toMatch(/screen\s*!==\s*'settings'/);
  });

  it('and sits ABOVE the switch, because B1 routes it from the title screen too', () => {
    const route = body.search(/if\s*\(\s*screen\s*===\s*'settings'\s*\)/);
    const sw = body.search(/switch\s*\(\s*awaiting\s*\)/);
    expect(route, 'no settings route').toBeGreaterThan(-1);
    expect(sw, 'renderChoices no longer switches on awaiting').toBeGreaterThan(-1);
    expect(route, 'the settings route moved inside the phase switch — the title cannot reach it')
      .toBeLessThan(sw);
  });

  it('the title screen offers it', () => {
    expect(body).toMatch(/choice\s*\(\s*'Settings'/);
  });

  it('and a change is APPLIED and PERSISTED, not just remembered in a variable', () => {
    const body2 = bodyOf('function renderSettingsScreen(');
    expect(body2, 'the settings screen no longer uses the shared builder').toMatch(
      /buildSettingsScreen\s*\(\s*settings\s*,/,
    );
    expect(body2, 'a changed preference is not kept').toMatch(/settings\s*=\s*next/);
    expect(body2, 'a changed preference is never written to storage').toMatch(
      /saveSettings\s*\(\s*next\s*\)/,
    );
    expect(body2, 'a changed preference is not applied to the screen it changed').toMatch(
      /retheme\s*\(\s*\)/,
    );
    // ...and it saves what it was given, not a fresh default — the `runMeta` lesson: watch
    // the argument, not just the call.
    expect(body2, 'the settings screen persists something other than the new value').not.toMatch(
      /saveSettings\s*\(\s*(?:DEFAULT_SETTINGS|settings)\s*\)/,
    );
  });
});

// =========================================================================================
// 6 — retheme(): the order, and the always-on floor tag.
// =========================================================================================

describe('retheme applies the floor, THEN the player’s preferences over it', () => {
  const body = bodyOf('function retheme(');

  it('calls both', () => {
    expect(body, 'the floor theme is no longer applied').toMatch(/applyTheme\s*\(/);
    expect(body, 'the player’s preferences are no longer applied').toMatch(/applySettings\s*\(/);
  });

  it('IN THAT ORDER — reversed, every setting reverts on the next click', () => {
    // Both write the same element and `applySettings` deliberately overwrites nine of the
    // names `applyTheme` just wrote. Theme last would clobber the player's text size and
    // high-contrast ink on EVERY engine step, so the setting appears to work exactly once.
    // That is close to the worst shape an accessibility bug can take, and it is invisible in
    // any test that only asserts both functions are called.
    const theme = body.search(/applyTheme\s*\(/);
    const settings = body.search(/applySettings\s*\(/);
    expect(theme).toBeGreaterThan(-1);
    expect(settings).toBeGreaterThan(-1);
    expect(theme, 'applySettings runs BEFORE applyTheme — the theme clobbers every preference')
      .toBeLessThan(settings);
  });

  it('and writes the floor tag unconditionally (S4a)', () => {
    // No branch, by design: the tag renders on every screen including the title, where it
    // truthfully names where the descent begins. A branch that does not exist cannot be
    // inverted — the chips-helper lesson.
    expect(body, 'the floor tag is no longer written').toMatch(
      /floorEl\.textContent\s*=\s*floorTagText\s*\(/,
    );
    expect(body, 'the floor tag grew a condition').not.toMatch(/\bif\s*\(/);
    expect(body, 'the floor tag is set as markup').not.toMatch(/floorEl\.innerHTML/);
  });

  it('and it is called on every step, at boot, and when a foreign run is adopted', () => {
    expect((SOURCE.match(/\bretheme\s*\(\s*\)/g) ?? []).length, 'retheme lost a call site')
      .toBeGreaterThanOrEqual(5);
  });
});

// =========================================================================================
// 7 — the content warning comes first.
// =========================================================================================

describe('a fresh run shows the content warning before the title (S1)', () => {
  const body = bodyOf('function start(');

  it('builds it, and builds it BEFORE any title choice is rendered', () => {
    const warning = body.search(/buildContentWarning\s*\(/);
    const choices = body.search(/renderChoices\s*\(/);
    expect(warning, 'start() no longer shows the content warning').toBeGreaterThan(-1);
    expect(choices, 'start() no longer renders any choices at all').toBeGreaterThan(-1);
    expect(warning, 'the title is rendered before the warning — the warning is behind the game')
      .toBeLessThan(choices);
  });

  it('and the gate is BRANCHLESS — every fresh run reaches it', () => {
    // Deliberately recorded rather than pinned as a polarity: there is nothing to invert.
    // `start()` is the only path to the warning and `renderResume()` never calls it, so
    // "every fresh run, never on resume" is structural.
    //
    // ⚠ THE FIRST VERSION OF THIS SLICED FROM `buildContentWarning(` ONWARDS, and it was
    // blind. Found by mutation, not by reading: writing
    // `if (runSeed > 0) choicesEl.appendChild(buildContentWarning(…))` puts the condition
    // BEFORE the slice begins, so the warning became skippable with the guard still green.
    // The whole function is judged instead, which is also the more truthful statement —
    // starting a fresh run is unconditional from its first line to its last, and a future
    // edit that needs a branch in here should have to come and think about this.
    expect(body, 'start() grew a condition — a fresh run can now skip something').not.toMatch(
      /\bif\s*\(/,
    );
    expect(body, 'start() grew a ternary').not.toMatch(/\?/);
    expect(body, 'start() grew a short-circuit').not.toMatch(/&&|\|\|/);
    // ...and the append really is the bare statement it looks like.
    expect(body).toMatch(/\n\s*choicesEl\.appendChild\(buildContentWarning\(/);
  });

  it('acknowledging it is what renders the title', () => {
    // The callback, not a timer and not a second entry point: the ONE control on the screen
    // is what advances it. Sliced from the builder call rather than matched with `[^)]*`,
    // which cannot cross the arrow function's own parentheses.
    const tail = body.slice(body.search(/buildContentWarning\s*\(/));
    expect(tail, 'acknowledging the warning no longer starts the game').toMatch(
      /renderChoices\s*\(\s*'title'\s*\)/,
    );
  });

  it('and the RESUME path never reaches it', () => {
    // S1's policy is "every FRESH run". A resumed run is not one.
    const resume = bodyOf('function renderResume(');
    expect(resume, 'the resume path now shows the content warning').not.toMatch(
      /buildContentWarning/,
    );
    expect(resume, 'the resume screen has no data-screen of its own').toMatch(
      /dataset\['screen'\]\s*=\s*'resume'/,
    );
  });
});

// =========================================================================================
// 8, 9, 10 — the remaining statements this unit added or changed.
// =========================================================================================

describe('nothing in the renderer builds markup from a string', () => {
  it('every innerHTML assignment assigns the empty string, and nothing else', () => {
    // G28(b)'s family, closed at its last site (the deal block) and pinned so the next one
    // fails here rather than in the field. Clearing a pane is legitimate; building one from
    // interpolated text is what put `<img onerror=…>` in the page once already.
    const assignments = [...SOURCE.matchAll(/\.\s*innerHTML\s*=\s*([^;]+);/g)].map((m) =>
      (m[1] as string).trim(),
    );
    expect(assignments.length, 'no innerHTML assignments found — this guard swept nothing')
      .toBeGreaterThan(2);
    for (const value of assignments) {
      expect(value, `innerHTML is assigned something other than '': ${value}`).toMatch(/^''|^""$/);
    }
  });

  it('and no other markup-writing API is used at all', () => {
    expect(SOURCE).not.toMatch(/outerHTML\s*=|insertAdjacentHTML\s*\(|createContextualFragment\s*\(/);
  });

  it('the deal block sets its two lines as text', () => {
    const body = bodyOf('function renderChoices(');
    expect(body, 'the deal block no longer renders a cost').toMatch(
      /cost\.textContent\s*=\s*`Cost:/,
    );
    expect(body, 'the deal block no longer renders a reward').toMatch(
      /reward\.textContent\s*=\s*`Reward:/,
    );
    expect(body, 'the deal block builds markup again').not.toMatch(/deal-cost['"]>/);
  });
});

describe('the end-of-run record is handed the run’s own seed (G8)', () => {
  it('runSummaryView receives runSeed, not a fresh or fabricated number', () => {
    const call = /runSummaryView\s*\(([^)]*)\)/.exec(SOURCE);
    expect(call, 'the run summary is no longer built').not.toBeNull();
    expect(call?.[1], 'the summary no longer carries the run seed').toContain('runSeed');
    expect(call?.[1], 'the summary is handed a fabricated seed').not.toMatch(
      /Date\.now|Math\.random|\b0\b/,
    );
  });
});

describe('the restyle hook is written on every render', () => {
  const body = bodyOf('function renderChoices(');

  it('data-screen is set from the pure screenKey, with both of its inputs', () => {
    // The whole `screens.css` surface is keyed off this one attribute. Handing it `awaiting`
    // alone would style the inventory, the sheet, the settings screen and the abandon
    // confirmation all as the hub, because the engine is still at `main-menu` behind them.
    expect(body, 'the data-screen hook is gone — every per-screen rule stops matching').toMatch(
      /dataset\['screen'\]\s*=\s*screenKey\s*\(\s*awaiting\s*,\s*screen\s*\)/,
    );
  });

  it('and it is set BEFORE the screen is built, not after', () => {
    const hook = body.search(/dataset\['screen'\]/);
    const sw = body.search(/switch\s*\(\s*awaiting\s*\)/);
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(sw);
  });
});

describe('the boot path loads the player’s preferences before the first paint', () => {
  it('loadSettings is called, and its result is what retheme reads', () => {
    expect(SOURCE, 'the settings are never loaded').toMatch(/settings[^=]*=\s*loadSettings\s*\(\s*\)/);
    // ...and the first `retheme()` comes after that, or the first frame ignores them.
    const load = SOURCE.search(/=\s*loadSettings\s*\(\s*\)/);
    const firstRetheme = SOURCE.search(/^retheme\s*\(\s*\);/m);
    expect(firstRetheme, 'the boot-time retheme is gone').toBeGreaterThan(-1);
    expect(load).toBeLessThan(firstRetheme);
  });

  it('and the preferences are NOT put in the save envelope', () => {
    // A run played at large text is the same run. Saving a preference into the run envelope
    // would make two players' saves incompatible over a display choice.
    for (const call of SOURCE.match(/saveRun\s*\([^)]*\)/g) ?? []) {
      expect(call, `${call} puts a preference in the run save`).not.toContain('settings');
    }
    expect(SOURCE.match(/saveRun\s*\([^)]*\)/g)?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('all three reserved art regions are actually mounted (A.7)', () => {
  it('the character portrait and the enemy portrait live in the HUD', () => {
    const body = bodyOf('function renderSheet(');
    expect(body, 'the character region is not reserved anywhere').toMatch(
      /buildArtSlotById\s*\(\s*'character'\s*\)/,
    );
    expect(body, 'the enemy region is not reserved anywhere').toMatch(
      /buildArtSlotById\s*\(\s*'enemy'\s*\)/,
    );
  });

  it('and the enemy one only while a battle is on screen', () => {
    // It is reserved in the battle CHROME rather than inside `renderChoices`'s
    // `battle-action` branch, which belongs to PLAN.md #6 and this unit does not touch.
    const body = bodyOf('function renderSheet(');
    const battle = body.search(/if\s*\(\s*state\.phase\.kind\s*===\s*'battle'\s*\)/);
    const enemy = body.search(/buildArtSlotById\s*\(\s*'enemy'\s*\)/);
    expect(battle, 'the battle branch is gone').toBeGreaterThan(-1);
    expect(enemy).toBeGreaterThan(battle);
  });

  it('the scenery region is the floor’s, on the hub', () => {
    expect(bodyOf('function renderHub(')).toMatch(/buildArtSlotById\s*\(\s*'scenery'\s*\)/);
  });

  it('and the battle-action branch is untouched by this unit', () => {
    // Scope, asserted: the battle screen is #6's, and the one thing this unit must not do is
    // start editing it.
    const body = bodyOf('function renderChoices(');
    const start = body.indexOf("case 'battle-action'");
    expect(start, 'the battle case is gone').toBeGreaterThan(-1);
    const battleCase = body.slice(start, body.indexOf("case 'continue'", start));
    expect(battleCase, 'this unit put an art slot in the battle branch').not.toContain(
      'buildArtSlot',
    );
    expect(battleCase, 'this unit put a data-screen write in the battle branch').not.toContain(
      'dataset',
    );
  });
});

// =========================================================================================
// The typeface's own runtime diagnostic (AC-17, principle 7).
// =========================================================================================

describe('the renderer reports whether the bundled faces actually loaded', () => {
  it('waits on document.fonts.ready and logs a COUNT', () => {
    // The failure this exists for is silent: if the four woff2 do not reach `dist/`, or their
    // urls resolve wrongly under `file://`, the browser falls back to the system monospace
    // with no error anywhere. A count is the only observable, and `fonts: 0` in a real run is
    // the whole diagnosis.
    expect(SOURCE, 'nothing waits for the fonts').toMatch(/document\.fonts\.ready/);
    // Sliced to the end of the payload object rather than matched with `[^)]*`: the payload
    // itself contains `fontTimer.stop()`, so a naive match stops inside its own argument.
    const at = SOURCE.indexOf("log.info('render', 'fonts ready'");
    expect(at, 'the fonts-ready line is gone').toBeGreaterThan(-1);
    const call = SOURCE.slice(at, SOURCE.indexOf('}', at));
    expect(call, 'the fonts line reports no count').toMatch(/fonts:\s*set\.size/);
    expect(call, 'the fonts line reports no duration').toMatch(/ms:\s*fontTimer\.stop\(\)/);
    expect(call, 'the count is a constant, not a measurement').not.toMatch(/fonts:\s*\d/);
  });

  it('and the failure path speaks before it gives up', () => {
    expect(SOURCE, 'a font load failure would vanish silently').toMatch(
      /log\.error\('render', 'fonts never became ready'/,
    );
  });
});

// =========================================================================================
// The two files outside `src/` this unit touched.
// =========================================================================================

describe('desktop.html carries the header band and loses no id', () => {
  it('every id the renderer looks up at module scope still exists', () => {
    // `game.ts` resolves all of these with `$()` at module scope and THROWS on a missing one,
    // so a dropped id is not a degraded layout — it is a game that does not boot.
    for (const id of [
      'game',
      'sheet',
      'stage',
      'title',
      'floor',
      'status',
      'notice',
      'narration',
      'log',
      'choices',
    ]) {
      expect(HTML, `#${id} is gone — the renderer throws at boot`).toContain(`id="${id}"`);
    }
  });

  it('the renderer looks up exactly the ids the page provides', () => {
    // The other direction: a `$()` for an element the page does not have.
    const LOOKUP = /\$(?:<[^>]*>)?\(\s*'([a-z]+)'\s*\)/g;
    const looked = [...SOURCE.matchAll(LOOKUP)].map((m) => m[1] as string);
    expect(looked.length, 'no $() lookups found — this guard swept nothing').toBeGreaterThan(6);
    expect(looked, 'the floor tag is not looked up at all').toContain('floor');
    for (const id of looked) {
      expect(HTML, `game.ts looks up #${id}, which desktop.html does not define`).toContain(
        `id="${id}"`,
      );
    }
  });

  it('the floor tag and the atmosphere layer are in the page', () => {
    expect(HTML).toMatch(/id="floor"[^>]*class="floor-tag"/);
    expect(HTML).toMatch(/id="atmosphere"[^>]*class="void-texture"/);
    // The atmosphere is decoration and must say nothing to a screen reader.
    expect(HTML).toMatch(/id="atmosphere"[^>]*aria-hidden="true"/);
  });

  it('and the Content-Security-Policy is untouched — no CDN, ever', () => {
    expect(HTML).toContain("default-src 'self'");
    expect(HTML, 'the page reaches the network').not.toMatch(/https?:\/\//);
  });
});

describe('the packaged window enforces a minimum size (UI-DESIGN.md §14)', () => {
  it('960x640, the number chosen for this layout', () => {
    // §14 decided a minimum must exist and no number was ever picked, so "the layout's design
    // target" was a target nothing enforced. Below this the HUD column, the narration, the
    // log and the choice row stop being able to coexist.
    expect(MAIN, 'the window has no minimum width').toMatch(/minWidth:\s*960/);
    expect(MAIN, 'the window has no minimum height').toMatch(/minHeight:\s*640/);
  });

  it('and the window still OPENS at the size it always did', () => {
    // The minimum is a floor, not a resize. Changing the opening size would be a different
    // decision than the one that was made.
    expect(MAIN).toMatch(/width:\s*1100/);
    expect(MAIN).toMatch(/height:\s*820/);
  });

  it('the minimum is smaller than the opening size (or the window cannot open)', () => {
    const min = [Number(/minWidth:\s*(\d+)/.exec(MAIN)?.[1]), Number(/minHeight:\s*(\d+)/.exec(MAIN)?.[1])];
    const open = [Number(/\bwidth:\s*(\d+)/.exec(MAIN)?.[1]), Number(/\bheight:\s*(\d+)/.exec(MAIN)?.[1])];
    expect(min[0]).toBeLessThan(open[0] as number);
    expect(min[1]).toBeLessThan(open[1] as number);
  });
});
