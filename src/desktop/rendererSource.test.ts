// SOURCE GUARDS on `src/desktop/game.ts` — written when it was the file that CANNOT be imported.
//
// WHY A SOURCE SCAN AND NOT A REAL TEST. `src/desktop/game.ts` called the Electron IPC
// (`window.void.onStatus(...)`) at MODULE SCOPE, so importing it in Vitest threw before a
// single line of test code ran. Every behaviour worth testing was therefore pushed out into
// pure helpers (`view-model.ts`, `log-model.ts`) that ARE tested, and what was left here is
// WIRING — which helper is called, in which branch, in which order. #0b set this precedent
// (`narrationCoverage.test.ts`'s G42 scan); this file collects #0c's.
//
// PLAN.md #6 landed G51 — the start-up is `export function boot()` and `boot.test.ts` drives the
// real renderer under jsdom. These scans are kept and re-anchored, not retired: each pins a
// polarity on every path at once, which one behavioural walk cannot.
//
// THE RULE THESE GUARDS FOLLOW. A scan that only recognises the exact characters that happen
// to be there today is untested in every other shape the violation can take. So each pattern
// below is deliberately loose about spelling — quote style, optional chaining, `textContent`
// vs `innerHTML` vs `replaceChildren` — and each has been verified to go RED when the defect
// is reintroduced in more than one of those shapes.
//
// A scan is also worthless if its anchor has drifted, so every guard first asserts that the
// thing it is looking at EXISTS. A regex that matches nothing passes trivially.
//
// ---------------------------------------------------------------------------------------
// COVERAGE LEDGER for `src/desktop/game.ts` — ENUMERATED FROM THE DIFF, not by reading it.
//
// Three rounds of sweeping this file by eye missed something each time, so the list below is
// mechanical: every `if` / `?:` / `&&` / `||` / early `return` the unit ADDED, taken from
// `git diff main...HEAD -- src/desktop/game.ts` with comment lines excluded, and the guard
// that pins each one's POLARITY.
//
//   1. `if (unlockLoad.lost !== undefined)`       -> 'shows it when there IS one (B1)'
//   2. `return { runSummary, runSeed };`          -> 'neither does runMeta()'
//   3. `if (!p) return;`             (renderSheet) -> DECLINED, see below
//   4. `if (className) el.className = className;`  -> 'applies the class it was given'
//   5. `if (startsNewBattle(events))`              -> 'resets on the battle OPENING (B2)'
//   6. `if (isRunOver(r.state.phase))`             -> 'branches on isRunOver POSITIVELY'
//   7. `if (saved.meta)`                           -> 'restores the meta ... where it EXISTS'
//
// Plus one added STATEMENT that carries no branch, and carried no assertion either:
//   8. `logEl.scrollTop = logEl.scrollHeight;`     -> 'and scrolls to the newest line (B3)'
//
// DECLINED — row 3, and `narrate()`'s pre-existing `if (!prompt) return`. The reason is NOT
// that inverting them is "loud". It is that both sit on the UNCONDITIONAL path: every run
// reaches them on the first frame, so an inversion blanks the character sheet or the
// narration pane for every player, immediately, on every run. Loudness alone would never
// justify leaving a branch unpinned — loudness ON A PATH THAT ALWAYS EXECUTES does. That
// second clause is exactly what does NOT hold for rows 1 and 5, which fire only on a corrupt
// unlock store and only on a battle's first step: rare paths, where an inversion is silent
// for most players for most of a run. That is why those two are pinned and these are not.
// ---------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAW = readFileSync(fileURLToPath(new URL('./game.ts', import.meta.url)), 'utf8');

/**
 * The source with COMMENTS STRIPPED. Load-bearing, not tidiness: several of the guards below
 * are "this pattern must NOT appear", and the comments in `game.ts` quote the very defects
 * they describe — so scanning the raw file made a guard go red because of the prose
 * explaining why the defect is gone. (`unlockStorage.test.ts` strips comments for the same
 * reason.) Verified: `game.ts` contains no `://`, so the line-comment strip cannot eat a URL
 * out of a string literal.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * PLAN.md #6's battle DOM module, stripped the same way — the foe's name and chips moved there
 * from `renderSheet`, so the guards on them follow it.
 */
const BATTLE_SOURCE = readFileSync(fileURLToPath(new URL('./battle.ts', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

/** The body of a top-level function declaration, up to the first closing brace in column 0. */
function bodyOf(declaration: string): string {
  const start = SOURCE.indexOf(declaration);
  expect(start, `${declaration} not found — this guard has gone stale, fix it`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

// =========================================================================================
// G2 — a finished run is finished.
// =========================================================================================

describe('dispatch() decides "the run is over" ONCE, through isRunOver', () => {
  const body = bodyOf('async function dispatch(');

  it('calls isRunOver, and clears the run on that branch only', () => {
    const isOver = body.search(/isRunOver\s*\(/);
    const clear = body.search(/clearRun\s*\(/);
    const save = body.search(/saveRun\s*\(/);
    // All three markers must exist, or the ordering comparison below finds nothing and passes.
    expect(isOver, 'dispatch() no longer calls isRunOver').toBeGreaterThan(-1);
    expect(clear, 'dispatch() no longer clears the run').toBeGreaterThan(-1);
    expect(save, 'dispatch() no longer autosaves').toBeGreaterThan(-1);
    // clearRun sits between the predicate and the autosave: i.e. in the `then` branch.
    expect(isOver).toBeLessThan(clear);
    expect(clear).toBeLessThan(save);
  });

  it('branches on isRunOver POSITIVELY — the polarity, not just the order', () => {
    // FIX ROUND 2, and the one site in this unit that genuinely cannot be behavioural:
    // `src/desktop/game.ts` calls the Electron IPC at module scope, so it cannot be imported
    // at all. The other two polarity holes found in this round were closed by moving the
    // decision into a pure function and testing it (`handleOverlayKey`, `actionButton`);
    // there is no equivalent move here, because what is being asserted IS the wiring.
    //
    // Why an ordering assertion was not enough: the test above pins
    // index(isRunOver) < index(clearRun) < index(saveRun), and flipping
    // `if (isRunOver(...))` to `if (!isRunOver(...))` preserves all three positions exactly.
    // What it does is restore G2 and add a second, worse defect: a finished run takes the
    // `saveRun` branch (a won run stays resumable — G2, verbatim), and EVERY ONGOING STEP
    // takes `clearRun()`, so the autosave is deleted continuously and quitting mid-descent
    // loses the whole run.
    //
    // Matched with any spacing, and requiring the call to be the WHOLE condition, so
    // `if (!isRunOver(x))` and `if (x && !isRunOver(y))` both fail.
    const BRANCH = /if\s*\(\s*isRunOver\s*\([^)]*\)\s*\)/;
    expect(
      body,
      'dispatch() no longer branches directly on isRunOver(...) — if the condition was ' +
        'negated or widened, a finished run is autosaved and an ongoing one is cleared',
    ).toMatch(BRANCH);
    // Belt and braces: no negated form anywhere in the body, whatever else changed.
    expect(body, 'dispatch() negates isRunOver — that inverts G2 and deletes live saves').not.toMatch(
      /!\s*isRunOver\s*\(/,
    );
  });

  it('does NOT decide it twice, from two conditions that can disagree', () => {
    // THIS IS G2, in its exact shape: the apply keyed off `phase.kind === 'ending'` while the
    // clear keyed off `awaiting === 'game-over'`. A victory settles at the `ending` phase, so
    // it took the AUTOSAVE branch and left a resumable save behind a finished run. Both
    // spellings are matched with either quote style and any spacing.
    const TWO_SOURCES =
      /awaiting\s*===\s*['"`]game-over['"`]|phase\.kind\s*===\s*['"`]ending['"`]/;
    expect(
      body,
      'dispatch() is deciding "the run is over" from a raw phase/awaiting comparison again — ' +
        'that is G2, and the two conditions disagree on a victory',
    ).not.toMatch(TWO_SOURCES);
  });
});

// =========================================================================================
// G26 — the model-failure fallback describes what JUST happened.
//
// `fallbackNarration` is pure and tested in `view-model.test.ts`. What cannot be tested there
// is that `narrate()`'s `catch` actually CALLS it rather than going back to slicing the
// prompt string apart, which is the defect.
// =========================================================================================

describe("narrate()'s fallback reads the facts, not the prompt's first block", () => {
  const body = bodyOf('async function narrate(');
  const catchStart = body.search(/\}\s*catch\s*\(/);

  it('has a catch block to guard (the anchor exists)', () => {
    expect(catchStart, 'narrate() no longer catches — this guard has gone stale').toBeGreaterThan(-1);
  });

  it('calls fallbackNarration, and slices nothing', () => {
    const catchBody = body.slice(catchStart);
    expect(catchBody, 'the model-failure fallback no longer uses fallbackNarration').toMatch(
      /fallbackNarration\s*\(/,
    );
    // `.split(` in ANY form: `prompt.user.split('\n\n')`, `.split("\n\n")`, a variable
    // holding the user string — all of them are the G26 defect, and all of them contain this.
    expect(
      catchBody,
      "the fallback is slicing the prompt string again — on any step with story memory that " +
        'first block is the CONTINUITY RECAP, not what just happened. That is G26.',
    ).not.toMatch(/\.split\s*\(/);
  });
});

// =========================================================================================
// G18 — the combat log is actually rendered.
// =========================================================================================

describe('dispatch() renders the combat log', () => {
  it('calls the log renderer on every step', () => {
    const body = bodyOf('async function dispatch(');
    expect(body, 'dispatch() no longer renders the combat log — that is G18 again').toMatch(
      /renderLog\s*\(/,
    );
  });

  it('and the renderer it calls really appends log lines', () => {
    const body = bodyOf('function renderLog(');
    expect(body).toMatch(/logLines\s*\(/);
    expect(body).toMatch(/appendLogLine\s*\(/);
    // The battle boundary: UI-DESIGN.md §3 wants the log to persist for a whole fight and
    // then start over, not grow forever.
    expect(body).toMatch(/startsNewBattle\s*\(/);
  });

  it('resets on the battle OPENING, not on every other step (B2)', () => {
    // The assertion above states the contract — "persist for a whole fight and then start
    // over, not grow forever" — and then fails to enforce it: it matches the call wherever
    // it sits and whatever its polarity. Inverting `if (startsNewBattle(events))` wipes the
    // log on every step EXCEPT a battle's first, so it never survives past a single beat and
    // each new fight opens on top of the previous one's tail. Exactly the opposite of §3, and
    // green through 1315 tests.
    const body = bodyOf('function renderLog(');
    expect(body, 'the log reset no longer branches on the battle opening').toMatch(
      /if\s*\(\s*startsNewBattle\s*\([^)]*\)\s*\)/,
    );
    expect(
      body,
      'the log is cleared on every step EXCEPT a new battle — it never persists and each ' +
        'fight opens on the last one\'s tail',
    ).not.toMatch(/!\s*startsNewBattle\s*\(/);
  });

  it('and scrolls to the newest line (B3)', () => {
    // A brand-new statement with no assertion of any kind: deleting
    // `logEl.scrollTop = logEl.scrollHeight` was green. AC-5's "it scrolls" clause rested
    // entirely on a human noticing, which is the wrong place for something this cheap to pin.
    // Without it the log silently stops following the fight the moment it overflows its cap —
    // the player sees the FIRST few beats of a battle and never the one that just happened.
    const body = bodyOf('function renderLog(');
    expect(
      body,
      'the combat log no longer scrolls to the newest line — after it overflows 30vh the ' +
        'player sees the start of the fight and never the current beat',
    ).toMatch(/scrollTop\s*=\s*\w+\.scrollHeight/);
  });
});

// =========================================================================================
// The Potion affordance. `potionControl` decides "disabled at 0" and is tested purely; this
// is the wiring — that the battle screen actually uses it, rather than going back to an
// unconditional `choice('Potion', …)` that looks live and dispatches a step resolving nothing.
// =========================================================================================

// PLAN.md #2 / GAME-DESIGN §22.6: potions FOLDED INTO CONSUMABLES. The guard that stood here
// ("the battle screen builds its Potion button from potionControl") retired with the button;
// what it protected — never an unconditional heal button — is now true by absence, and held
// so: no Potion control, and no `potion` action dispatched, anywhere in the renderer.
describe('the battle screen has no Potion control (§22.6)', () => {
  const body = bodyOf('function renderChoices(');

  it('offers no Potion button and dispatches no potion action', () => {
    expect(body, 'a Potion control came back').not.toMatch(/[Pp]otion/);
    expect(SOURCE, 'a potion action is dispatched somewhere').not.toMatch(/action:\s*['"`]potion['"`]/);
    // Non-vacuity: the battle case is still there, still dispatching its real actions.
    expect(body).toMatch(/action:\s*'run'/);
  });
});

// =========================================================================================
// G28(b) — the player's name is never markup.
//
// `renderSheet()` built the HUD by interpolating into `sheetEl.innerHTML`, and two of the
// interpolated strings are content the game does not control: the name the player TYPES, and
// the enemy's generated `fullName`. A name of `<img onerror=…>` was live markup in the page.
//
// The pure half (the name survives the projection byte for byte) is asserted in
// `view-model.test.ts`. This is the half that matters for the defect: that the RENDERER sets
// it as text.
// =========================================================================================

describe('renderSheet() never interpolates a name into markup', () => {
  const body = bodyOf('function renderSheet(');

  it('still renders the names (the guard has something to guard)', () => {
    // If renderSheet stopped showing the player's name, every "must not" below would pass by
    // finding nothing at all.
    expect(body).toMatch(/\bp\.name\b/);
    // RE-ANCHORED by PLAN.md #6: the ENEMY's generated name left the HUD for the framed stage.
    // It must not come back here, and it must be set as TEXT where it went — `buildArena`
    // passes `view.name` to the `element` helper, and that helper writes `textContent`.
    expect(body, 'the foe is back in the HUD — the stage owns it').not.toMatch(/\bfullName\b/);
    const battle = BATTLE_SOURCE;
    const arena = battle.slice(battle.indexOf('export function buildArena('), battle.indexOf('\n}', battle.indexOf('export function buildArena(')));
    expect(arena, 'the arena no longer shows the enemy’s name').toMatch(
      /element\(\s*'p',\s*'arena-name',\s*view\.name\s*\)/,
    );
    const helper = battle.slice(battle.indexOf('function element('), battle.indexOf('\n}', battle.indexOf('function element(')));
    expect(helper, 'the element helper no longer sets text').toMatch(/\.textContent\s*=\s*text\b/);
    expect(helper).not.toMatch(/innerHTML/);
  });

  it('assigns no innerHTML at all', () => {
    // Loose on purpose. `sheetEl.innerHTML =`, `el.innerHTML=`, `outerHTML`,
    // `insertAdjacentHTML(...)` and `replaceChildren` of a parsed fragment are all the same
    // defect wearing different clothes; the first four are matched here, and the fifth cannot
    // happen without one of `innerHTML`/`createContextualFragment`, which are both matched.
    const HTML_WRITE =
      /\.\s*(?:inner|outer)HTML\s*=|insertAdjacentHTML\s*\(|createContextualFragment\s*\(/;
    expect(
      body,
      'renderSheet is writing HTML again — the player name and the enemy name both flow ' +
        'through it, and neither is escaped anywhere',
    ).not.toMatch(HTML_WRITE);
  });

  it('and interpolates neither name into a template string', () => {
    // The precise shape the bug took: `<b>${p.name}</b>` / `<span class="foe">${e.fullName}</span>`.
    // Matched as "a name inside a ${…} anywhere in a backtick string", in either order.
    const INTERPOLATED_NAME = /\$\{\s*[A-Za-z_$][\w$]*\.(?:name|fullName)\b/;
    expect(body, 'a name is being interpolated into a string again').not.toMatch(
      INTERPOLATED_NAME,
    );
  });

  it('sets its lines as textContent', () => {
    expect(body, 'renderSheet no longer sets any textContent — how is it rendering?').toMatch(
      /\.\s*textContent\s*=/,
    );
  });
});

// =========================================================================================
// G28(a) — condition chips reach the screen.
// `conditionChips` / `chip` have been complete and tested since M-UI2 and nothing imported
// them, so the player could be poisoned, fractured and about to lose their turn and the only
// tell was the HP number moving.
// =========================================================================================

describe('renderSheet() puts condition chips on the HUD', () => {
  const body = bodyOf('function renderSheet(');

  it('builds them from the shared model, for the player AND the enemy', () => {
    expect(body, 'the HUD no longer shows condition chips — that is G28(a)').toMatch(
      /conditionChips\s*\(/,
    );
    expect(body).toMatch(/\bchip\s*\(/);
    // The player's own row stays in the HUD...
    expect(body).toMatch(/chips\s*\(\s*p\.activeConditions\s*\)/);
    // ...and RE-ANCHORED by PLAN.md #6: the foe's row moved to the framed stage, where
    // `stageView` builds its models (pinned behaviourally in `battle-model.test.ts`) and
    // `buildArena` appends the row UNCONDITIONALLY — the same no-branch idiom as here.
    expect(body, 'the foe’s chips are back in the HUD').not.toMatch(/e\.activeConditions/);
    const battle = BATTLE_SOURCE;
    const arena = battle.slice(battle.indexOf('export function buildArena('), battle.indexOf('\n}', battle.indexOf('export function buildArena(')));
    expect(arena, 'the arena shows no condition chips — that is G28(a) on the new screen').toMatch(
      /\n\s*inner\.appendChild\(\s*chipsRow\(\s*view\.chips\s*\)\s*\)/,
    );
    const row = battle.slice(battle.indexOf('function chipsRow('), battle.indexOf('\n}', battle.indexOf('function chipsRow(')));
    expect(row, 'the arena’s chip row grew a branch that could hide it').not.toMatch(/\bif\s*\(|\?\s*.*:/);
    // One exit, and it is the end: an early `return` would skip the row just as an `if` would.
    expect(row.match(/\breturn\b/g) ?? [], 'the chip row grew an early return').toHaveLength(1);
    expect(row, 'the chip row no longer returns the row it built').toMatch(/return row;\s*$/);
  });

  it('and the chip row carries no branch that could be inverted', () => {
    // FOUND BY SWEEPING in fix round 2, in this unit's own new code. The `chips` helper used
    // to open with `if (models.length === 0) return;`. Inverting that renders the row ONLY
    // when it is empty — so condition chips never appear again, G28(a) silently restored —
    // and every assertion above stays green, because the calls are all still there.
    //
    // Rather than add a fourth polarity regex, the branch was DELETED: the row is appended
    // unconditionally and `#sheet .chips:empty` collapses it, the idiom already used for
    // `#log` and `#notice`. A branch that does not exist cannot be inverted. This asserts it
    // stays deleted, since re-adding the early return would be the natural "tidy-up".
    const start = body.indexOf('const chips =');
    expect(start, 'the chips helper is gone — this guard has gone stale').toBeGreaterThan(-1);
    const helper = body.slice(start, body.indexOf('};', start));
    expect(
      helper,
      'the chip row grew a conditional again — invert it and the chips vanish for good',
    ).not.toMatch(/\bif\s*\(|\breturn\b|\?\s*.*:/);
  });
});

// =========================================================================================
// G19 -> G1 — a resumed run keeps what it has earned.
//
// `persist.test.ts` proves the ENVELOPE carries the meta and that a straight-through run and
// a resumed one unlock the same things. What it cannot reach is the renderer actually reading
// it back at boot — restoring `state` but not `runSummary` would pass every test in that file
// while reproducing G19 exactly.
// =========================================================================================

describe('the boot resume path restores the meta-progression, not just the state', () => {
  it('assigns runSummary and runSeed from the loaded envelope', () => {
    // Loose about the access spelling: `saved.meta.x`, `saved!.meta!.x`, `saved?.meta?.x`,
    // or a destructured `meta.x` all match.
    const RESTORES_SUMMARY = /runSummary\s*=\s*[A-Za-z0-9_.?!]*\bmeta\b[A-Za-z0-9_.?!]*\.runSummary/;
    const RESTORES_SEED = /runSeed\s*=\s*[A-Za-z0-9_.?!]*\bmeta\b[A-Za-z0-9_.?!]*\.runSeed/;
    expect(SOURCE, 'the resumed run no longer restores its run summary — that is G19').toMatch(
      RESTORES_SUMMARY,
    );
    expect(SOURCE, 'the resumed run no longer restores its seed — that is G19').toMatch(
      RESTORES_SEED,
    );
  });

  it('and the state restore it sits beside is still there (so the guard has an anchor)', () => {
    expect(SOURCE).toMatch(/state\s*=\s*saved[A-Za-z0-9_.?!]*\.state/);
  });

  it('restores the meta on the branch where it EXISTS, not the one where it is null', () => {
    // FOUND IN THIS ROUND by sweeping for the same shape the report named, rather than only
    // fixing the three sites it listed. The two assertions above match the assignment text
    // wherever it sits, so flipping `if (saved.meta)` to `if (!saved.meta)` leaves them
    // green — while restoring nothing when a meta exists (G19, restored) and dereferencing
    // `saved.meta.runSummary` when it is null (a TypeError on the boot path, so the game
    // fails to start at all on a legacy save).
    const BRANCH = /if\s*\(\s*saved[A-Za-z0-9_.?!]*\.meta\s*\)/;
    expect(
      SOURCE,
      'the resume path no longer branches positively on saved.meta',
    ).toMatch(BRANCH);
    expect(
      SOURCE,
      'the resume path negates saved.meta — it restores nothing when there IS a meta, and ' +
        'dereferences null when there is not',
    ).not.toMatch(/if\s*\(\s*!\s*saved[A-Za-z0-9_.?!]*\.meta\s*\)/);
  });
});

// =========================================================================================
// G3 — the unlock-store recovery notice actually reaches the screen.
//
// `unlockStorage.ts` now REPORTS what it found, and `unlockStorage.test.ts` proves the
// ladder. But a report nobody renders is the same silence it replaced.
// =========================================================================================

describe('the boot path shows the unlock-recovery notice', () => {
  it('reads the load RESULT, not just the store', () => {
    // `let unlockStore = loadUnlockStore();` — the old shape — would be a type error now, but
    // `loadUnlockStore().store` would compile and silently drop the report.
    expect(SOURCE).toMatch(/loadUnlockStore\s*\(\s*\)/);
    expect(SOURCE, 'the boot path discards the load result and cannot report a loss').not.toMatch(
      /loadUnlockStore\s*\(\s*\)\s*\.\s*store/,
    );
  });

  it('puts the message on screen as TEXT when there is one', () => {
    expect(SOURCE, 'nothing reads the `lost` message').toMatch(/\blost\b/);
    expect(SOURCE, 'the notice element is never written').toMatch(
      /noticeEl\s*\.\s*textContent\s*=/,
    );
    // It must not become markup on the way — the message is authored by us today, but the
    // element is the obvious place for a future "you unlocked X" line carrying a name.
    expect(SOURCE).not.toMatch(/noticeEl\s*\.\s*innerHTML\s*=/);
  });

  it('shows it when there IS one — the polarity, not just the presence (B1)', () => {
    // The assertion above matches the write wherever it sits, so inverting
    // `if (unlockLoad.lost !== undefined)` to `=== undefined` left it green — and that
    // inversion restores G3's headline in full: a store recovered from backup, or lost
    // entirely, reports NOTHING. There is not even a compensating symptom, because assigning
    // `undefined` to `textContent` yields the empty string, so the notice is simply blank.
    expect(
      SOURCE,
      'the recovery notice no longer branches on the message EXISTING',
    ).toMatch(/if\s*\(\s*unlockLoad\.lost\s*!==\s*undefined\s*\)/);
    expect(
      SOURCE,
      'the notice fires when there is NOTHING to say and stays silent when there is — ' +
        'that is G3, "wipes everything, silently", restored',
    ).not.toMatch(/if\s*\(\s*unlockLoad\.lost\s*===\s*undefined\s*\)/);
  });
});

// =========================================================================================
// G19 — `saveRun`'s third argument. The TYPE makes omission impossible, but only if every
// call site really passes the live bookkeeping rather than a fresh empty one.
// =========================================================================================

describe('every saveRun call site passes the LIVE run meta', () => {
  it('no call site hands it an empty summary', () => {
    const calls = SOURCE.match(/saveRun\s*\([^)]*\)/g) ?? [];
    expect(calls.length, 'no saveRun call sites found — this guard has gone stale').toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `${call} fabricates a summary instead of saving the run's own`).not.toMatch(
        /emptyRunSummary\s*\(/,
      );
    }
  });

  it('and neither does runMeta(), which is where the value actually comes from', () => {
    // FOUND BY THE DIFF ENUMERATION, not reported. The guard above scans `saveRun(...)` call
    // sites — but all five now pass `runMeta()`, so the summary is fabricated one level down
    // if it is fabricated at all. Making `runMeta` return `emptyRunSummary()` is green
    // through 1315 tests and restores G19 COMPLETELY: every save carries an empty tally, so
    // no resumed run ever earns a feat. Scanning the caller and not the callee is precisely
    // how a guard ends up watching the wrong door.
    const body = bodyOf('function runMeta(');
    expect(body, 'runMeta no longer returns the live bookkeeping').toMatch(
      /return\s*\{\s*runSummary\s*,\s*runSeed\s*\}/,
    );
    expect(
      body,
      'runMeta fabricates a summary — every save would carry an empty feat tally, which is ' +
        'G19 in full',
    ).not.toMatch(/emptyRunSummary\s*\(|createStoryMemory\s*\(/);
  });
});

// =========================================================================================
// The remaining branch this unit added to `renderSheet` — found by the diff enumeration.
// =========================================================================================

describe('the HUD line helper applies the class it was given', () => {
  it('branches on the class BEING present, not on it being absent', () => {
    // `if (className) el.className = className;` inverted assigns the class only when there
    // is none — so `el.className = undefined` — and the player's name loses `.who` and the
    // enemy loses `.foe`. Cosmetic rather than a re-opened defect, which is why it is a
    // regex here and not worth extracting a function for; but it is a branch this unit
    // added, so it is pinned rather than left off the ledger.
    const body = bodyOf('function renderSheet(');
    expect(body, 'the HUD line helper no longer applies a class at all').toMatch(
      /if\s*\(\s*className\s*\)/,
    );
    expect(body, 'the class is applied only when it is absent').not.toMatch(
      /if\s*\(\s*!\s*className\s*\)/,
    );
  });
});
