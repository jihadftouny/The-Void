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
