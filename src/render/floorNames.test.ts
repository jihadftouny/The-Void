// The five floors are named in THREE places. This is the guard that keeps them one name.
//
// THE JOIN (FINDINGS.md G56 — check BOTH ends, not one):
//   1. `src/data/floors.json`      — the engine's data. The rules, and now the narrator's
//                                    prompt header (C4), read the name from here.
//   2. `src/render/tokens.ts`      — `FLOOR_THEMES[i].name`. The render layer's copy, which
//                                    feeds the persistent floor tag (S4a) and the layout probe.
//   3. `docs/WORLD.md` §6 / `docs/ART-BIBLE.md` §4 — the fiction, which is authoritative over
//                                    both. `SPEC` below is transcribed from those tables BY
//                                    HAND, so this file is a genuinely independent third copy
//                                    rather than a restatement of either code table.
//
// `floors.json`'s own `status` line says "Names mirror src/render/tokens.ts" — two hand-typed
// copies with nothing holding them together. A pure core may not import the render layer
// (CLAUDE.md rule 1), so `src/llm` cannot simply read `tokens.ts`, and `tokens.ts` reading
// `floors.json` is a render-layer refactor this unit does not own. Until someone takes it,
// THIS is what makes the drift detectable — and it is what makes that refactor safe.
//
// It also checks the two CONSUMERS agree, not just the two tables: the header band the
// player reads and the prompt header the model reads must say the same floor.

import { describe, it, expect } from 'vitest';
import { FLOOR_THEMES, floorTheme } from './tokens.ts';
import { floorTagText } from './settings-model.ts';
import { floorDef, FLOOR_IDS, type FloorId } from '../game/floors.ts';
import { buildNarrationPrompt, placeName } from '../llm/narrate.ts';
import type { GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { createKarma } from '../game/karma.ts';

/**
 * The five floor names, transcribed by hand from `docs/WORLD.md` §6's stage table and
 * `docs/ART-BIBLE.md` §4's floor rows — the documents, not either code table. The docs
 * write them with a leading article ("1 — The Undercity"); both code tables store the bare
 * name and let each surface supply its own article ("Floor 1 — Undercity" / "the Undercity"),
 * so that is what is pinned here.
 */
const SPEC = ['Undercity', 'Entrance to the Void', 'Ash City', 'Angelic Underground', 'True Void'];

/** A state at `place`, with one narratable event so a prompt is always produced. */
const EVENTS: GameEvent[] = [{ kind: 'encounter-start', enemyName: 'Feral Cryo Rat' }];
function stateAt(place: number): GameState {
  return {
    version: 9,
    rngState: 1,
    player: null,
    act: place + 1,
    place,
    karma: createKarma(),
    phase: { kind: 'title' },
  };
}

describe('the floors are named once, in three places that must agree (G56)', () => {
  it('there are exactly five floors, in both tables', () => {
    // If one table grows a sixth row and the other does not, every index-keyed check below
    // would silently stop covering it.
    expect(SPEC).toHaveLength(5);
    expect(FLOOR_IDS).toHaveLength(5);
    expect(FLOOR_THEMES).toHaveLength(5);
  });

  it('floors.json, tokens.ts and the documents give the same five names', () => {
    for (let i = 0; i < SPEC.length; i += 1) {
      const fromData = floorDef((i + 1) as FloorId).name;
      const fromTheme = floorTheme(i).name;
      expect(fromData, `floors.json floor ${i + 1}`).toBe(SPEC[i]);
      expect(fromTheme, `tokens.ts FLOOR_THEMES[${i}]`).toBe(SPEC[i]);
      expect(fromData, 'the engine and the render layer disagree').toBe(fromTheme);
    }
  });

  it('the theme table is indexed by `place`, so the two tables line up 0↔1', () => {
    // `floors.json` is keyed 1..5 and `FLOOR_THEMES` by `place` 0..4. The check above would
    // pass even if both were shifted together, so pin the mapping itself.
    for (let i = 0; i < SPEC.length; i += 1) {
      expect(floorTheme(i).place).toBe(i);
    }
  });
});

describe('both consumers of the name say the same floor', () => {
  it("the header band reads 'Floor N — <name>' with the spec name", () => {
    for (let i = 0; i < SPEC.length; i += 1) {
      expect(floorTagText(i)).toBe(`Floor ${i + 1} — ${SPEC[i]}`);
      expect(floorTagText(i).endsWith(SPEC[i]!)).toBe(true);
    }
  });

  it("the narrator's prompt names the same floor the band does", () => {
    for (let i = 0; i < SPEC.length; i += 1) {
      expect(placeName(i)).toBe(`the ${SPEC[i]}`);
      const prompt = buildNarrationPrompt(EVENTS, stateAt(i));
      expect(prompt).not.toBeNull();
      expect(prompt!.user, `prompt for place ${i}`).toContain(`Act ${i + 1}, the ${SPEC[i]}.`);
    }
  });

  it('the band and the prompt cannot name two different floors for one place', () => {
    // The actual failure mode this guard exists for: one table renamed, the other not, so
    // the screen says one thing and the model is told another.
    for (let i = 0; i < SPEC.length; i += 1) {
      const banded = floorTagText(i).split(' — ')[1]!;
      expect(placeName(i)).toBe(`the ${banded}`);
    }
  });
});
