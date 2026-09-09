// WHAT THE LAYOUT ACTUALLY CAME OUT AS, AT RUNTIME — the renderer's own instrumentation.
//
// ---------------------------------------------------------------------------------------
// WHY A LOG LINE FOR SOMETHING A TEST ALREADY MEASURES (CLAUDE.md principle 7).
//
// `src/dev/layoutProbe.test.ts` measures this layout in real Chromium at five window sizes,
// and it is the guard. This module is the other half of principle 7: **a log line is not a
// substitute for a test, and a test is not a substitute for a log line either.** The probe
// knows the sizes it was told to try, the content it was told to build, and the fonts that
// loaded on the build machine. A player's machine has a window size nobody chose, an OS text
// scale, a display scale factor, a font that may have failed to load, and prose the narrator
// wrote just now. If the narration ever collapses again out there, the ONLY evidence that it
// happened is a line in the log file saying so at the moment it happened.
//
// The defect this unit fixes was reported as "the narration is gone" with no numbers at all,
// and every number that would have identified it in ten seconds — the viewport, the pane
// heights, the screen — was available in the page and recorded by nothing.
//
// ---------------------------------------------------------------------------------------
// THE SPLIT, and why it is two functions.
//
//   `readLayout` touches the DOM and does no thinking. It is the boundary.
//   `layoutWarnings` does the thinking and touches nothing. It is PURE, over plain numbers,
//    and therefore unit-tested for real rather than by reading source text.
//
// That split is what makes "the defect signature is detected" an assertion instead of a
// hope: the exact number pattern that shipped (`beats > 0, px === 0`) is fed to
// `layoutWarnings` in `layout.test.ts` and must come back as a warning.
//
// NO LOGGING HAPPENS HERE. This module returns data; `game.ts` — the boundary — decides what
// to log and at which level. `src/log/purity.test.ts` keeps the render layer clear of the
// logger, and this file stays on the right side of that line by not importing it.

/** One measured box: how tall it is, and how much content is inside it. */
export interface PaneReport {
  /** The rendered height of the box, in CSS pixels, rounded to whole pixels. */
  px: number;
  /** The height of its content. Greater than `px` means it is scrolling. */
  scrollPx: number;
}

/** Everything worth knowing about one render of the stage. All numbers, all serializable. */
export interface LayoutReport {
  viewport: { width: number; height: number };
  screen: string;
  layout: string;
  narration: PaneReport & { beats: number };
  log: PaneReport & { lines: number };
  choices: PaneReport & { bottom: number; controls: number };
  scenery: { mounted: number; px: number };
}

/** The elements `readLayout` measures. Passed in, so nothing here looks anything up. */
export interface LayoutElements {
  narrationEl: HTMLElement;
  logEl: HTMLElement;
  choicesEl: HTMLElement;
  sceneryEl: HTMLElement;
}

/**
 * A whole-pixel height. Sub-pixel layout means a pane is 203.98438 px tall, and a log full
 * of five-decimal numbers is a log nobody greps twice.
 */
function round(value: number): number {
  return Math.round(value);
}

/**
 * Measure the stage as it currently stands. DOM reads only — no writes, no decisions.
 *
 * Every field is a NUMBER and not a string containing a number: `"204px"` cannot be compared
 * to anything downstream, and a payload that bakes a measurement into text is the same
 * defect as a message that does.
 */
export function readLayout(els: LayoutElements): LayoutReport {
  const { narrationEl, logEl, choicesEl, sceneryEl } = els;
  const choicesBox = choicesEl.getBoundingClientRect();
  const scenery = sceneryEl.querySelectorAll('.void-art-slot');
  const sceneryBox = scenery[0]?.getBoundingClientRect();

  return {
    viewport: { width: round(window.innerWidth), height: round(window.innerHeight) },
    screen: document.body.dataset['screen'] ?? '',
    layout: document.body.dataset['layout'] ?? '',
    narration: {
      px: round(narrationEl.getBoundingClientRect().height),
      scrollPx: round(narrationEl.scrollHeight),
      beats: narrationEl.querySelectorAll('.beat').length,
    },
    log: {
      px: round(logEl.getBoundingClientRect().height),
      scrollPx: round(logEl.scrollHeight),
      lines: logEl.querySelectorAll('.void-log-line').length,
    },
    choices: {
      px: round(choicesBox.height),
      scrollPx: round(choicesEl.scrollHeight),
      bottom: round(choicesBox.bottom),
      controls: choicesEl.querySelectorAll('button').length,
    },
    scenery: { mounted: scenery.length, px: round(sceneryBox ? sceneryBox.height : 0) },
  };
}

/**
 * The plain-language problems visible in a report. PURE — plain numbers in, strings out.
 *
 * Each entry is a signature of a defect that has actually happened, or that the design says
 * must never happen. They are deliberately few: a warning that fires on a healthy screen
 * gets ignored, and an ignored warning is worse than none.
 */
export function layoutWarnings(report: LayoutReport): string[] {
  const warnings: string[] = [];

  // ⭐ THE SIGNATURE OF THE DEFECT THIS UNIT EXISTS FOR. There is prose in the pane and the
  // pane has no height, so the player is being shown nothing at all. Note the polarity: an
  // EMPTY narration with no height is the normal, correct state on the title screen and the
  // content warning, and must never warn.
  if (report.narration.beats > 0 && report.narration.px <= 0) {
    warnings.push('narration has beats but no height');
  }

  // A control the player cannot reach. The choice box running past the bottom of the window
  // is how Abandon ended up at y 664-713 in a 640 px window.
  if (report.choices.bottom > report.viewport.height + 1) {
    warnings.push('the choices box overflows the viewport');
  }

  // Prose is present, the pane has SOME height, but less than a line and a half of it: the
  // starvation caught early rather than only at exactly zero.
  if (report.narration.beats > 0 && report.narration.px > 0 && report.narration.px < 40) {
    warnings.push('narration is squeezed to less than two lines');
  }

  return warnings;
}
