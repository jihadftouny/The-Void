// @vitest-environment jsdom
//
// THE PAGE'S SKELETON — structure and reading order, parsed rather than pattern-matched.
//
// ---------------------------------------------------------------------------------------
// WHAT THIS FILE CAN AND CANNOT SEE, stated up front because getting that wrong is how the
// last unit's defect escaped.
//
// jsdom has NO LAYOUT ENGINE. Every `getBoundingClientRect()` it returns is zeros, no
// stylesheet is applied, nothing has a width or a height. So this file makes exactly one
// kind of claim: **what is nested inside what, and in which order.** Whether the result is
// readable is measured for real, in real Chromium, by `src/dev/layoutProbe.test.ts` — and
// that separation is deliberate. A jsdom test that believed it was checking layout is
// precisely what let a zero-pixel narration ship with 2149 tests green.
//
// What structure alone DOES decide, and decides completely:
//   - TAB ORDER. With no `tabindex` anywhere, the keyboard follows document order. So
//     "`#choices` comes after `#column`" is not a styling preference — it is the guarantee
//     that a keyboard user reads the prose before reaching the buttons.
//   - The three-way join between `desktop.html`, `game.ts`'s `$()` lookups in `boot()` and
//     `game.css`'s selectors. A dropped id is not a degraded layout, it is a game that
//     throws at boot.
// ---------------------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The repo root. `import.meta.url` is NOT a file url under the jsdom environment, so the
// `fileURLToPath(new URL('../../', import.meta.url))` idiom the node-environment guards use
// throws here. Vitest runs with its cwd at the project root; that is asserted below rather
// than assumed, because a wrong root would make every assertion in this file read a
// different page than the one that ships.
const ROOT = process.cwd();
const HTML = readFileSync(path.join(ROOT, 'desktop.html'), 'utf8');
// Parsed with the browser's own parser rather than matched with regexes: "is #choices inside
// #column" is a question about the TREE, and a regex over markup cannot answer it. The
// `@vitest-environment jsdom` directive above is this repo's convention (`screens.test.ts`),
// and it keeps the other 80 test files running under `node` at full speed.
const doc = new DOMParser().parseFromString(HTML, 'text/html');

function byId(id: string): Element {
  const el = doc.getElementById(id);
  expect(el, `#${id} is not in desktop.html`).not.toBeNull();
  return el as Element;
}

/** The ids of an element's element children, in document order. */
function childIds(id: string): string[] {
  return [...byId(id).children].map((c) => c.id || `<${c.tagName.toLowerCase()}>`);
}

describe('the page really parsed (or every assertion below reads an empty document)', () => {
  it('the file read is the shipped page, in the repository root', () => {
    expect(existsSync(path.join(ROOT, 'package.json')), `not the repo root: ${ROOT}`).toBe(true);
    expect(existsSync(path.join(ROOT, 'src/desktop/game.ts'))).toBe(true);
    expect(HTML.length, 'desktop.html read as empty').toBeGreaterThan(500);
  });

  it('the parser built a document with the shell in it', () => {
    expect(doc.getElementById('game'), 'the page did not parse at all').not.toBeNull();
    expect(doc.querySelectorAll('div, section, header, h1').length).toBeGreaterThan(8);
  });
});

// =========================================================================================
// THE SPLIT. The choices are their own column, outside the reading column.
// =========================================================================================

describe('the choices are OUTSIDE the reading column', () => {
  it('the stage body holds the frame’s two regions, then the column, then the choices', () => {
    // The defect `layout-breathing-room` fixed, expressed structurally. While `#choices` was a
    // child of `#column`, a six-row hub menu shared the column's height budget with the prose —
    // and took it, because a scroll pane's automatic minimum size is zero and a non-scrolling
    // sibling's is its content.
    //
    // PLAN.md #6 adds the battle frame's two regions AHEAD of the column: the arena (the
    // centre stage, whose ticker toggle is the frame's first focusable) and the stat box.
    // Off the battle screen both are empty and hidden, so the column and the choices sit
    // exactly as they did.
    expect(childIds('stage-body')).toEqual(['arena', 'vitals', 'column', 'choices']);
  });

  it('the frame’s two regions say nothing, hide nothing, and ship EMPTY', () => {
    // The stylesheet hides an off-screen region by `display: none` and the renderer fills it
    // only on the battle screen, so anything shipped inside would show on the wrong screen —
    // and whitespace would defeat a future `:empty`. Not aria-hidden: the enemy region manages
    // its own, and a future `<img alt>` inside it must stay announced.
    for (const id of ['arena', 'vitals']) {
      const region = byId(id);
      expect(region.getAttribute('aria-hidden'), `#${id} hides its future content`).toBeNull();
      expect(region.children.length, `#${id} ships pre-filled`).toBe(0);
      expect(region.textContent, `#${id} ships text or whitespace`).toBe('');
      expect(region.closest('#stage-body'), `#${id} is outside the stage body`).not.toBeNull();
    }
  });

  it('`#choices` is not a descendant of `#column`, at any depth', () => {
    // The stronger form: nesting it deeper inside the column would satisfy a child-list
    // check that only looked at the direct children of `#stage-body`.
    expect(
      byId('column').contains(byId('choices')),
      'the choices are back inside the reading column — the prose loses its space again',
    ).toBe(false);
    expect(byId('choices').closest('#column'), 'the choices sit under the reading column').toBeNull();
  });

  it('and both are inside the stage, under the header band', () => {
    expect(byId('stage-body').closest('#stage')).not.toBeNull();
    expect(childIds('stage')).toEqual(['<header>', 'stage-body']);
  });
});

// =========================================================================================
// THE READING ORDER, which is also the tab order.
// =========================================================================================

describe('the reading column reads title, notice, scenery, prose, log', () => {
  it('in exactly that order', () => {
    // ⚠ THE SCENERY'S POSITION IS A DECISION, AND THIS IS WHERE IT IS PINNED. It sits ABOVE
    // the prose as an establishing shot: ART-BIBLE §3 specifies the floor backdrops as 16:9
    // with a deep-shadow bottom third — an image drawn to sit OVER text — and at the foot of
    // the column a short beat would leave the frame floating under empty space.
    //
    // To move it to the foot instead: move the one `<div id="scenery">` line in
    // `desktop.html` below `#log`, and swap the two entries here. Nothing else changes.
    expect(childIds('column')).toEqual(['title', 'notice', 'scenery', 'narration', 'log']);
  });

  it('nothing carries a tabindex, so the keyboard follows the document', () => {
    // The whole reading-order guarantee rests on this. One `tabindex="1"` anywhere would
    // pull that element to the front of the tab order for the entire page.
    const withTabindex = [...doc.querySelectorAll('[tabindex]')].map(
      (e) => e.id || e.tagName.toLowerCase(),
    );
    expect(withTabindex, 'an element overrides the natural tab order').toEqual([]);
  });

  it('the choices are a landmark with a name, so a screen reader can jump to them', () => {
    const choices = byId('choices');
    expect(choices.tagName.toLowerCase(), 'the choices are not a region element').toBe('section');
    expect(
      choices.getAttribute('aria-label'),
      'the choices region has no accessible name — a landmark nobody can identify',
    ).toBeTruthy();
  });

  it('the scenery wrapper says nothing itself, and hides nothing either', () => {
    // The SLOT manages its own `aria-hidden` (empty today, so it is hidden; a future
    // `<img alt>` removes it). An `aria-hidden` on the WRAPPER would silence that image
    // permanently, and no test inside `screens.ts` could see it.
    const scenery = byId('scenery');
    expect(scenery.getAttribute('aria-hidden'), 'the wrapper hides its future art').toBeNull();
    expect(scenery.textContent, 'the reserved region prints placeholder text').toBe('');
    expect(scenery.children.length, 'the page ships the region pre-filled').toBe(0);
  });

  it('the narration is still the live region, and the log still names itself', () => {
    expect(byId('narration').getAttribute('aria-live')).toBe('polite');
    expect(byId('log').getAttribute('aria-label')).toBe('combat log');
  });
});

// =========================================================================================
// THE JOIN with the renderer and the stylesheet.
// =========================================================================================

describe('every id the renderer and the stylesheet reach for exists', () => {
  const RENDERER_LOOKUPS = [
    'title',
    'floor',
    'status',
    'notice',
    'scenery',
    'narration',
    'log',
    'choices',
    'sheet',
    // PLAN.md #6: the battle frame's regions, and the column whose log flag the ticker sets.
    'arena',
    'vitals',
    'column',
  ];

  it('the ids `game.ts` resolves in boot() are all present', () => {
    // `$()` THROWS on a missing element, and `boot()` runs it on the boot path, so a dropped
    // id is a black window rather than a cosmetic regression.
    for (const id of RENDERER_LOOKUPS) {
      expect(doc.getElementById(id), `#${id} is gone — the renderer throws at boot`).not.toBeNull();
    }
  });

  it('...and the renderer really does look up every one of them (the other end)', () => {
    // G56: name BOTH sides of the join. Without this, the list above could drift into a set
    // of ids nothing reads, and the guard would still be green.
    const source = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
    for (const id of RENDERER_LOOKUPS) {
      expect(
        source,
        `desktop.html defines #${id} but game.ts never looks it up — one end of this ` +
          'coupling has moved',
      ).toMatch(new RegExp(`\\$(?:<[^>]*>)?\\(\\s*'${id}'\\s*\\)`));
    }
  });

  it('the two new hooks the stylesheet selects on are in the page', () => {
    expect(byId('stage-body').className).toContain('stage-body');
    expect(byId('scenery').className).toContain('scenery');
  });

  it('and the page still reaches no network and keeps its policy', () => {
    expect(HTML).toContain("default-src 'self'");
    expect(HTML, 'the page reaches the network').not.toMatch(/https?:\/\//);
  });
});
