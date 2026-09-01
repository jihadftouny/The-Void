// SOURCE GUARDS on `src/desktop/game.ts` — the file that CANNOT be imported.
//
// WHY A SOURCE SCAN AND NOT A REAL TEST. `src/desktop/game.ts` calls the Electron IPC
// (`window.void.onStatus(...)`) at MODULE SCOPE, which is why `npm run dev` cannot run outside
// Electron and why importing it in Vitest throws before a single line of test code runs.
// Every behaviour worth testing has therefore been pushed out into pure helpers
// (`view-model.ts`, `log-model.ts`) that ARE tested. What is left in this file is WIRING —
// which helper is called, in which branch, in which order — and the only way to assert wiring
// in a file you cannot load is to read it. #0b set this precedent
// (`narrationCoverage.test.ts`'s G42 scan); this file collects #0c's.
//
// THE RULE THESE GUARDS FOLLOW. A scan that only recognises the exact characters that happen
// to be there today is untested in every other shape the violation can take. So each pattern
// below is deliberately loose about spelling — quote style, optional chaining, `textContent`
// vs `innerHTML` vs `replaceChildren` — and each has been verified to go RED when the defect
// is reintroduced in more than one of those shapes.
//
// A scan is also worthless if its anchor has drifted, so every guard first asserts that the
// thing it is looking at EXISTS. A regex that matches nothing passes trivially.

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
});

// =========================================================================================
// The Potion affordance. `potionControl` decides "disabled at 0" and is tested purely; this
// is the wiring — that the battle screen actually uses it, rather than going back to an
// unconditional `choice('Potion', …)` that looks live and dispatches a step resolving nothing.
// =========================================================================================

describe('the battle screen builds its Potion button from potionControl', () => {
  const body = bodyOf('function renderChoices(');

  it('uses the model, not a bare unconditional choice', () => {
    expect(body, 'renderChoices no longer has a Potion control at all').toMatch(/[Pp]otion/);
    expect(body, 'the Potion button is no longer built from potionControl').toMatch(
      /potionControl\s*\(/,
    );
    // The exact defect shape, in either quote style: a `choice(...)` whose label is Potion is
    // always enabled and always carries a handler.
    expect(body, "the Potion button is an unconditional `choice()` again").not.toMatch(
      /choice\s*\(\s*['"`]Potion['"`]/,
    );
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
    // If renderSheet stopped showing either name, every "must not" below would pass by
    // finding nothing at all.
    expect(body).toMatch(/\bp\.name\b/);
    expect(body).toMatch(/\bfullName\b/);
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
    // Both combatants: the player's own row, and the foe's during a battle.
    expect(body).toMatch(/chips\s*\(\s*p\.activeConditions\s*\)/);
    expect(body).toMatch(/chips\s*\(\s*e\.activeConditions\s*\)/);
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
});
