// SOURCE GUARDS on the wiring PLAN.md #2 (`floor-mechanics`) added to `src/desktop/game.ts`.
//
// When this was written `game.ts` called the Electron IPC at module scope, so it could not be
// imported and its wiring could only be read (FINDINGS.md G51; PLAN.md #6 has since moved that
// start-up into `boot()`). Everything that could be lifted OUT was: the full-pack screen is
// `view-model.ts`'s `dealDiscardView`, behaviourally tested there. What is left here is which
// input each new control dispatches, with which argument — the part a typo breaks silently.
//
// COVERAGE LEDGER (from `git diff` of game.ts over this unit, filtered to lines that dispatch or
// mount): the `rest` case (scenery + Continue), the `deal-discard` case (one discard per row, and
// the refusal), and the inventory's Discard button. Each is pinned in the form it would really be
// broken: a constant index, the wrong accept flag, a lost mount.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, stripReachesEndOfFile } from '../log/sourceScan.testutil.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RAW = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
const SOURCE = stripComments(RAW);

function bodyOf(declaration: string): string {
  const start = SOURCE.indexOf(declaration);
  expect(start, `${declaration} not found — this guard has gone stale, fix it`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n}', start);
  return SOURCE.slice(start, end);
}

/** The text of one `case '<name>':` arm inside a body, up to the next `case '` or the end. */
function caseArm(body: string, name: string): string {
  const start = body.indexOf(`case '${name}':`);
  expect(start, `case '${name}' is gone`).toBeGreaterThan(-1);
  const next = body.indexOf("case '", start + 6);
  return body.slice(start, next < 0 ? undefined : next);
}

describe('the scan read the whole file', () => {
  it('the strip reached the end', () => {
    expect(stripReachesEndOfFile(RAW)).toBe(true);
    expect(SOURCE).toMatch(/function renderInventoryScreen\(/);
  });
});

describe('the found rest spot (§22.26) — calm, with the scenery frame, and only Continue', () => {
  const arm = caseArm(bodyOf('function renderChoices('), 'rest');

  it('mounts the floor scenery, as the hub does', () => {
    expect(arm).toMatch(/sceneryEl\.appendChild\(\s*buildArtSlotById\(\s*'scenery'\s*\)\s*\)/);
  });

  it('offers exactly one control, and it continues — there is no decision to make', () => {
    expect(arm.match(/\bchoice\s*\(/g) ?? []).toHaveLength(1);
    expect(arm).toMatch(/dispatch\(\s*\{\s*kind:\s*'continue'\s*\}\s*\)/);
  });
});

describe('the full-pack bargain (Appendix A.3) — each row discards ITS item, and backing out refuses', () => {
  const arm = caseArm(bodyOf('function renderChoices('), 'deal-discard');

  it('builds from the pure dealDiscardView, never by hand — with the phase’s own marks (F3)', () => {
    expect(arm).toMatch(/dealDiscardView\s*\(/);
    // Dropping the third argument would offer an already-marked item again (a dead click) and
    // hide how many are still needed.
    expect(arm).toMatch(/dealDiscardView\(\s*p,\s*state\.phase\.deal,\s*state\.phase\.leaving\s*\?\?\s*\[\]\s*\)/);
  });

  it('the rows sit inside ONE closed disclosure (A.3.4: nothing below the fold at 960x640)', () => {
    expect(arm.match(/\bpicker\s*\(/g) ?? []).toHaveLength(1);
    expect(arm).toMatch(/picker\(\s*choicesEl,\s*view\.choose,/);
    // The rows are appended to the picker's LIST, never straight onto the choice column.
    const inside = arm.slice(arm.search(/picker\(/));
    expect(inside).toMatch(/appendButton\(\s*list,\s*buttonModel\(\s*row\.label\s*\)/);
    expect(arm, 'a leave row is a top-level choice again').not.toMatch(/choice\(\s*row\.label/);
  });

  it('each leave row dispatches `discard` with THAT row’s index — not a constant', () => {
    expect(arm).toMatch(/for\s*\(\s*const\s+row\s+of\s+view\.leave\s*\)/);
    expect(arm).toMatch(/dispatch\(\s*\{\s*kind:\s*'discard',\s*index:\s*row\.index\s*\}\s*\)/);
    expect(arm, 'a discard index is hard-coded').not.toMatch(/kind:\s*'discard',\s*index:\s*\d/);
  });

  it('the way out is EXACTLY refusing: deal-decision with accept FALSE', () => {
    expect(arm).toMatch(/choice\(\s*view\.refuse,\s*\(\)\s*=>\s*void\s+dispatch\(\s*\{\s*kind:\s*'deal-decision',\s*accept:\s*false\s*\}\s*\)\s*\)/);
    expect(arm, 'the back-out accepts the bargain').not.toMatch(/accept:\s*true/);
  });

  it('writes text, never markup', () => {
    expect(arm).not.toMatch(/innerHTML/);
    expect(arm).toMatch(/textContent\s*=\s*view\.prompt/);
  });
});

describe('the step-detail debug line carries the floor and the illusion flag (principle 7)', () => {
  /** The object literal handed to `log.debug('engine', 'step detail', { ... })`. */
  function payload(): string {
    const at = SOURCE.search(/log\.debug\(\s*'engine',\s*'step detail',/);
    expect(at, 'the step-detail line is gone').toBeGreaterThan(-1);
    const open = SOURCE.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < SOURCE.length; i += 1) {
      if (SOURCE[i] === '{') depth += 1;
      else if (SOURCE[i] === '}') {
        depth -= 1;
        if (depth === 0) return SOURCE.slice(open, i + 1);
      }
    }
    throw new Error('unbalanced step-detail payload');
  }

  it('the floor is read from the STATE through floorOf — keyed on place, like the rules', () => {
    expect(payload()).toMatch(/\bfloor:\s*floorOf\(\s*state\s*\)/);
  });

  it('illusory is the live battle enemy’s flag, and a boolean (false off a battle)', () => {
    expect(payload()).toMatch(
      /\billusory:\s*state\.phase\.kind\s*===\s*'battle'\s*&&\s*state\.phase\.battle\.enemy\.illusory\s*===\s*true/,
    );
  });

  it('both are top-level fields of the payload, not baked into a message string', () => {
    const p = payload();
    expect(p).not.toMatch(/`[^`]*\$\{\s*floorOf/);
  });
});

describe('the inventory Discard button is an ENGINE input, stepped with the row’s own index', () => {
  const body = bodyOf('function renderInventoryScreen(');

  it('steps `discard` with b.index, adopts the result, saves it, and logs it', () => {
    expect(body).toMatch(/buttonModel\(\s*'Discard'\s*\)/);
    expect(body).toMatch(/step\(\s*state,\s*\{\s*kind:\s*'discard',\s*index:\s*b\.index\s*\}\s*\)/);
    expect(body, 'a discard index is hard-coded').not.toMatch(/kind:\s*'discard',\s*index:\s*\d/);
    const at = body.search(/kind:\s*'discard'/);
    const tail = body.slice(at);
    expect(tail).toMatch(/state\s*=\s*r\.state/);
    expect(tail).toMatch(/saveRun\s*\(/);
    expect(tail).toMatch(/log\.info\(\s*'inventory',\s*'item discarded'/);
  });

  it('a REFUSED discard (the same state back) saves nothing', () => {
    expect(body).toMatch(/if\s*\(\s*r\.state\s*!==\s*state\s*\)/);
  });
});
