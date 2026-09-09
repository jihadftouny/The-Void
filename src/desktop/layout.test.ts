// @vitest-environment jsdom
//
// THE LAYOUT REPORT AND ITS WARNINGS.
//
// `layoutWarnings` is PURE, so it is tested the way this project tests every decision: over
// hand-written number patterns, including the exact one the shipped defect produced. That is
// the point of having lifted it out of `game.ts` at all — inside the renderer it could only
// ever have been asserted by reading source text.
//
// `readLayout` touches the DOM, so it is tested under jsdom with the geometry STUBBED. jsdom
// computes no layout — every rect it returns is zeros — so a test that trusted its numbers
// would prove nothing. Feeding known rectangles in and checking they come out the other side
// is the only claim jsdom can honestly support here: that the reader reads the right box for
// the right field. Whether the real numbers are ACCEPTABLE is measured in real Chromium by
// `src/dev/layoutProbe.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import { layoutWarnings, readLayout, type LayoutReport } from './layout.ts';

// =========================================================================================
// A healthy report, and the mutations of it that must and must not warn.
// =========================================================================================

/** A hub after a fight, at the minimum window, laid out correctly. Derived, not measured. */
function healthy(): LayoutReport {
  return {
    viewport: { width: 960, height: 640 },
    screen: 'main-menu',
    layout: 'side',
    narration: { px: 204, scrollPx: 690, beats: 1 },
    log: { px: 181, scrollPx: 1400, lines: 60 },
    choices: { px: 550, scrollPx: 550, bottom: 620, controls: 6 },
    scenery: { mounted: 1, px: 141 },
  };
}

describe('layoutWarnings says nothing about a healthy layout', () => {
  it('the hub, laid out correctly, produces no warning at all', () => {
    expect(layoutWarnings(healthy())).toEqual([]);
  });

  it('and neither does a screen with no prose on it — that is the NORMAL state', () => {
    // The polarity that matters. The title screen and the content warning clear the pane,
    // so an empty narration with no height is correct there. A warning that fired on them
    // would fire on every fresh boot, and a warning nobody can act on gets ignored.
    const titleScreen: LayoutReport = {
      ...healthy(),
      screen: 'title',
      layout: 'wide',
      narration: { px: 0, scrollPx: 0, beats: 0 },
      log: { px: 0, scrollPx: 0, lines: 0 },
      scenery: { mounted: 0, px: 0 },
    };
    expect(layoutWarnings(titleScreen)).toEqual([]);
  });

  it('...nor a wide screen where the prose is merely capped rather than starved', () => {
    const inventory: LayoutReport = {
      ...healthy(),
      screen: 'inventory',
      layout: 'wide',
      narration: { px: 102, scrollPx: 690, beats: 1 },
    };
    expect(layoutWarnings(inventory)).toEqual([]);
  });
});

describe('layoutWarnings names the defect that shipped', () => {
  it('prose in the pane and no height at all', () => {
    // The exact signature measured on the broken build: a beat is present and the pane is
    // zero pixels tall. This is the one line in a log file that would have identified it.
    const starved: LayoutReport = { ...healthy(), narration: { px: 0, scrollPx: 690, beats: 3 } };
    expect(layoutWarnings(starved)).toContain('narration has beats but no height');
  });

  it('and catches it BEFORE it reaches zero, at less than two lines', () => {
    // 4.5 px is what the default window measured — not zero, and just as unreadable. A
    // detector that only fired at exactly zero would have missed the default window entirely.
    const squeezed: LayoutReport = { ...healthy(), narration: { px: 5, scrollPx: 690, beats: 1 } };
    expect(layoutWarnings(squeezed)).toContain('narration is squeezed to less than two lines');
    expect(
      layoutWarnings(squeezed),
      'a pane with SOME height is not the zero-height case as well',
    ).not.toContain('narration has beats but no height');
  });

  it('but not when the pane is legitimately holding a single short beat', () => {
    // The boundary in the other direction: a resume screen's one-line beat is ~26px at the
    // base scale, and two lines is ~52. Below 40 is not a beat, it is a sliver.
    const short: LayoutReport = { ...healthy(), narration: { px: 52, scrollPx: 52, beats: 1 } };
    expect(layoutWarnings(short)).toEqual([]);
  });

  it('a choice box past the bottom of the window warns', () => {
    // Abandon at y 664-713 in a 640px window is what a player met on the hub.
    const overflowing: LayoutReport = {
      ...healthy(),
      choices: { px: 713, scrollPx: 713, bottom: 713, controls: 6 },
    };
    expect(layoutWarnings(overflowing)).toContain('the choices box overflows the viewport');
  });

  it('and one pixel of rounding does NOT warn', () => {
    // Sub-pixel layout puts a box at 640.4 in a 640px window routinely. A warning that fired
    // on that would fire on every screen and mean nothing.
    const rounded: LayoutReport = {
      ...healthy(),
      choices: { px: 550, scrollPx: 550, bottom: 641, controls: 6 },
    };
    expect(layoutWarnings(rounded)).toEqual([]);
    const past: LayoutReport = {
      ...healthy(),
      choices: { px: 550, scrollPx: 550, bottom: 642, controls: 6 },
    };
    expect(layoutWarnings(past)).toContain('the choices box overflows the viewport');
  });

  it('two problems at once are both reported', () => {
    const bad: LayoutReport = {
      ...healthy(),
      narration: { px: 0, scrollPx: 690, beats: 2 },
      choices: { px: 800, scrollPx: 800, bottom: 800, controls: 6 },
    };
    expect(layoutWarnings(bad).length).toBe(2);
  });

  it('every warning is a plain sentence with no number baked into it', () => {
    // Numbers live in `data`, never in the message — or `grep` over a log stops working and
    // two occurrences of the same problem look like two different problems.
    const bad: LayoutReport = {
      ...healthy(),
      narration: { px: 0, scrollPx: 690, beats: 2 },
      choices: { px: 800, scrollPx: 800, bottom: 800, controls: 6 },
    };
    for (const warning of layoutWarnings(bad)) {
      expect(warning, `${warning} carries a number`).not.toMatch(/\d/);
      expect(warning.length).toBeGreaterThan(10);
    }
  });
});

// =========================================================================================
// `readLayout` — the boundary. Geometry stubbed, because jsdom computes none.
// =========================================================================================

/** A page with the real ids, and a rectangle stubbed onto each measured element. */
function stubbedPage(): Parameters<typeof readLayout>[0] {
  document.body.dataset['screen'] = 'main-menu';
  document.body.dataset['layout'] = 'side';
  document.body.innerHTML =
    `<div id="scenery"><figure class="void-art-slot"></figure></div>
     <div id="narration"><p class="beat">a</p><p class="beat">b</p></div>
     <div id="log"><div class="void-log-line">x</div><div class="void-log-line">y</div></div>
     <section id="choices"><button>one</button><button>two</button><button>three</button></section>`;

  const rect = (el: Element, height: number, bottom: number): void => {
    el.getBoundingClientRect = () =>
      ({ top: bottom - height, bottom, left: 0, right: 0, width: 0, height, x: 0, y: 0 }) as DOMRect;
  };
  const get = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  rect(get('narration'), 204.4, 300);
  rect(get('log'), 181.6, 490);
  rect(get('choices'), 550.2, 620.7);
  rect(document.querySelector('.void-art-slot') as Element, 140.8, 160);
  Object.defineProperty(get('narration'), 'scrollHeight', { value: 690, configurable: true });
  Object.defineProperty(get('log'), 'scrollHeight', { value: 1400, configurable: true });
  Object.defineProperty(get('choices'), 'scrollHeight', { value: 551, configurable: true });

  return {
    narrationEl: get('narration'),
    logEl: get('log'),
    choicesEl: get('choices'),
    sceneryEl: get('scenery'),
  };
}

beforeEach(() => {
  // jsdom's window defaults to 1024x768; the report is asserted against a stated viewport.
  Object.defineProperty(window, 'innerWidth', { value: 960, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 640, configurable: true });
});

describe('readLayout reads the right box for each field', () => {
  it('reports the measured geometry, rounded to whole pixels', () => {
    const report = readLayout(stubbedPage());
    expect(report.viewport).toEqual({ width: 960, height: 640 });
    expect(report.screen).toBe('main-menu');
    expect(report.layout).toBe('side');
    // 204.4 rounds to 204, not to 205 and not to 204.4.
    expect(report.narration.px).toBe(204);
    expect(report.narration.scrollPx).toBe(690);
    expect(report.narration.beats).toBe(2);
    expect(report.log.px).toBe(182);
    expect(report.log.lines).toBe(2);
    expect(report.choices.px).toBe(550);
    expect(report.choices.bottom).toBe(621);
    expect(report.choices.controls).toBe(3);
    expect(report.scenery.mounted).toBe(1);
    expect(report.scenery.px).toBe(141);
  });

  it('every value is a NUMBER, never a string of digits', () => {
    // A payload that bakes a measurement into text is the same defect as a message that
    // does: nothing downstream can compare `"204px"` to anything.
    const report = readLayout(stubbedPage());
    const numbers = [
      report.viewport.width,
      report.viewport.height,
      report.narration.px,
      report.narration.scrollPx,
      report.narration.beats,
      report.log.px,
      report.log.scrollPx,
      report.log.lines,
      report.choices.px,
      report.choices.scrollPx,
      report.choices.bottom,
      report.choices.controls,
      report.scenery.mounted,
      report.scenery.px,
    ];
    for (const value of numbers) {
      expect(typeof value, `${String(value)} is not a number`).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(numbers.length).toBe(14);
  });

  it('the whole report survives a round trip through JSON', () => {
    // It is a log payload. A value that cannot be serialized is a log line that never
    // reaches the file.
    const report = readLayout(stubbedPage());
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('an unmounted scenery region reports zero rather than throwing', () => {
    const els = stubbedPage();
    els.sceneryEl.replaceChildren();
    const report = readLayout(els);
    expect(report.scenery).toEqual({ mounted: 0, px: 0 });
  });

  it('and what it reads really does feed the warnings (the two halves join up)', () => {
    // The join, asserted rather than assumed: a report produced by the reader is the shape
    // the pure half judges. Stub the narration flat and the defect signature must appear.
    const els = stubbedPage();
    els.narrationEl.getBoundingClientRect = () =>
      ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    expect(layoutWarnings(readLayout(els))).toContain('narration has beats but no height');
  });
});
