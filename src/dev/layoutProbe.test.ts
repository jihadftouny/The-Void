// THE LAYOUT IS MEASURED IN A REAL BROWSER ENGINE — the guard the last unit did not have.
//
// ---------------------------------------------------------------------------------------
// WHAT ESCAPED, AND WHY NOTHING CAUGHT IT.
//
// `visual-identity` merged with 2149 tests green, a clean typecheck, a clean build and a PASS
// verdict. The game it shipped had no narration: the prose pane measured ZERO PIXELS at the
// 960x640 minimum window and 4.5 px at the default one, while an empty reserved art frame
// held a third of the screen. The player could not read the game.
//
// The reason no test saw it is not an oversight, it is a CLASS (FINDINGS.md G56's family):
// **every guard covering this area is a source scan or a jsdom assertion, and neither
// computes layout.** jsdom ships no layout engine — every `getBoundingClientRect()` it
// returns is zeros — so a jsdom test literally cannot tell a readable column from a collapsed
// one. A source scan can prove a declaration EXISTS; it can never prove what the declaration
// does once the cascade, the flex algorithm, the viewport height and the real typeface's
// metrics have had their say. Both kinds of guard were thorough, and both were blind.
//
// THIS FILE CLOSES THAT. It runs the REAL production build of `desktop.html`, with the REAL
// built stylesheet and the REAL bundled typeface, inside the REAL Chromium the game ships in,
// at real window sizes, with worst-case content — and reads the geometry back as numbers.
//
// ---------------------------------------------------------------------------------------
// TWO RULES THIS FILE HOLDS ITSELF TO.
//
//  1. **No expected number is read off a run.** Every threshold below is arithmetic on the
//     type scale (`TYPE.base`, `TEXT_SCALE_TABLE.large.base`) and the line heights stated in
//     the stylesheets, computed here, in this file. Where the arithmetic depends on a scale
//     value, that value is ALSO asserted, so changing the type scale fails loudly here rather
//     than silently moving the goalposts.
//  2. **No skip switch.** There is no environment variable, no `it.skip`, no "if Electron is
//     unavailable" branch. A guard that can be switched off is precisely the class of guard
//     this unit exists to replace; if Electron cannot launch, this file fails.
// ---------------------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { TYPE } from '../render/tokens.ts';
import { TEXT_SCALE_TABLE } from '../render/settings-model.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
/** Its own outDir, so this file and `exclusion.test.ts` can build at the same time. */
const OUT_SUB = 'dist/__layout-probe';
const OUT_DIR = path.join(ROOT, OUT_SUB);
const RESULT_FILE = path.join(OUT_DIR, 'result.json');

// =========================================================================================
// THE HAND-DERIVED CONSTANTS. Nothing below is read out of the CSS or out of a measurement.
// =========================================================================================

/**
 * The narration's line height, from `game.css`: `.narration { line-height: 1.7 }`.
 * The body's, from `tokens.css`: `body { line-height: 1.55 }` — which is what the log gets.
 */
const NARRATION_LINE_HEIGHT = 1.7;
const BODY_LINE_HEIGHT = 1.55;

/** The prose floor, in lines, for each stage layout — `--void-prose-floor` in `game.css`. */
const PROSE_LINES = { side: 8, wide: 4 } as const;

/** The log's floor, in lines, on a `side` screen — `--void-log-floor`. */
const LOG_LINES_FLOOR = 3;

/** The log's cap, as a fraction of the viewport height — `--void-log-cap`. */
const LOG_CAP_VH = 0.3;

/** The scenery's two caps — `#scenery .void-art-slot` in `game.css`. */
const SCENERY_CAP_VH = 0.22;
const SCENERY_CAP_PX = 440;

/** The committed ratio for the scenery region. LOCKED by `artSlots.json` / ART-BIBLE §4. */
const SCENERY_RATIO = 16 / 9;

/**
 * The base font size at each text setting, in pixels.
 *
 * ⚠ ASSERTED against the scale itself in the first test below, not merely written down. If
 * the type scale moves and this file does not, every threshold here would quietly become the
 * wrong number while still passing — the exact shape of a guard that stops guarding.
 */
const BASE_PX = { normal: 15, large: 18 } as const;
type Scale = keyof typeof BASE_PX;

/**
 * The step a CONTROL is set at — `.void-button { font-size: var(--void-type-md) }`. Asserted
 * against the scale below, like the base step, so a change to the scale cannot silently move
 * the minimum size a control is allowed to be.
 */
const CONTROL_PX = { normal: 13, large: 16 } as const;

/** A rounding allowance of one pixel: sub-pixel layout means 204 can measure 203.9844. */
const SLACK = 1;

/** The guaranteed narration height for a layout mode at a text size, in pixels. */
function proseFloorPx(mode: 'side' | 'wide', scale: Scale): number {
  return PROSE_LINES[mode] * BASE_PX[scale] * NARRATION_LINE_HEIGHT;
}

/** The guaranteed log height on a `side` screen, in pixels. */
function logFloorPx(scale: Scale): number {
  return LOG_LINES_FLOOR * BASE_PX[scale] * BODY_LINE_HEIGHT;
}

// =========================================================================================
// WHAT EACH SCENARIO IS, transcribed from the plan's own table (§2.6) rather than read back
// from `screenLayout`. `prose` says whether that screen carries a beat at all: the content
// warning and the title never do (a fresh run clears the pane before showing them), and a
// pane with nothing in it must take NO space rather than holding a floor open.
// =========================================================================================

interface Expectation {
  mode: 'side' | 'wide';
  prose: boolean;
  scenery: boolean;
}

const EXPECTED: Readonly<Record<string, Expectation>> = {
  hub: { mode: 'side', prose: true, scenery: true },
  'confirm-abandon': { mode: 'side', prose: true, scenery: true },
  battle: { mode: 'side', prose: true, scenery: false },
  'battle-open': { mode: 'side', prose: true, scenery: false },
  'choose-class': { mode: 'side', prose: true, scenery: false },
  'draft-pick': { mode: 'side', prose: true, scenery: false },
  // PLAN.md #2: the found rest spot carries the floor's scenery (§22.26), as the hub does;
  // the bargain and the full-pack bargain (Appendix A.3) are short action lists beside prose.
  rest: { mode: 'side', prose: true, scenery: true },
  'deal-decision': { mode: 'side', prose: true, scenery: false },
  'deal-discard': { mode: 'side', prose: true, scenery: false },
  'deal-discard-open': { mode: 'side', prose: true, scenery: false },
  // Fix round 2: the marking state (a pack over the cap, two marked) — the same screen, fuller.
  'deal-discard-marked': { mode: 'side', prose: true, scenery: false },
  'deal-discard-marked-open': { mode: 'side', prose: true, scenery: false },
  inventory: { mode: 'wide', prose: true, scenery: false },
  settings: { mode: 'wide', prose: true, scenery: false },
  'content-warning': { mode: 'wide', prose: false, scenery: false },
  title: { mode: 'wide', prose: false, scenery: false },
  resume: { mode: 'wide', prose: true, scenery: false },
  'game-over': { mode: 'wide', prose: true, scenery: false },
};

/** The sizes the Electron half measures, mirrored here so a dropped one is a failure. */
const SIZES: readonly (readonly [number, number])[] = [
  [960, 640],
  [1100, 820],
  [1280, 720],
  [1920, 1080],
  [1920, 1200],
  [800, 600],
];

/** Below this width the stage stacks — the `899px` literal in `game.css`. */
const STACK_BELOW = 900;

const SCALES: readonly Scale[] = ['normal', 'large'];

// =========================================================================================
// The measured data, as the Electron half wrote it.
// =========================================================================================

interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}
interface Pane extends Box {
  scrollHeight: number;
  clientHeight: number;
}
interface Report {
  scenario: string;
  scale: Scale;
  screen: string;
  layout: string;
  viewport: { width: number; height: number };
  narration: Pane & { beats: number; lineHeight: number; fontSize: number };
  log: Pane & { lines: number };
  column: Pane;
  choices: Pane & { controls: number };
  scenery: { count: number; box: Box | null; ratio: number | null };
  buttons: Box[];
  page: { scrollHeight: number; clientHeight: number };
  focusOrder: string[];
  fontLoaded: boolean;
}
interface SizeGroup {
  requested: { width: number; height: number };
  actual: { width: number; height: number };
  reports: Report[];
}
/** One measurement taken during the real-boot walk. */
interface WalkStep {
  step: string;
  screen: string;
  layout: string;
  viewport: { width: number; height: number };
  narration: Box & {
    beats: number;
    fallbacks: number;
    characters: number;
    fontSize: number;
    lineHeight: number;
  };
  column: Pane;
  choices: Pane & { controls: number; labels: string[] };
  scenery: { inWrapper: number; inPage: number; box: Box | null; ratio: number | null };
  buttons: Box[];
  page: { scrollHeight: number; clientHeight: number };
  focusOrder: string[];
  hubMenuRows: number;
  hubPromptVisible: boolean;
  documentPanels: number;
}

/** A structured log entry as the renderer emitted it. */
interface LogEntry {
  level: string;
  category: string;
  message: string;
  data?: unknown;
}

interface ProbeResult {
  chrome: string;
  electron: string;
  phaseA: SizeGroup[];
  phaseC: { steps: WalkStep[]; fontLoaded: boolean; fontCount: number; logs: LogEntry[] };
  minWindow: {
    options: Record<string, unknown>;
    before: { content: number[]; window: number[] };
    after: { content: number[]; window: number[] };
    control: { content: number[]; window: number[] };
  };
}

let RESULT: ProbeResult;
let EMITTED: string[] = [];
let SCRIPT_REPLACEMENTS = 0;

/**
 * The production build of the real page, in a SUBPROCESS with `NODE_ENV` deleted.
 *
 * The environment scrubbing is copied from `src/dev/exclusion.test.ts` and is not
 * decoration: Vitest sets `NODE_ENV=test`, and Vite decides `isProduction` from `NODE_ENV`
 * before it looks at `--mode`, so an in-process "production" build is not one. Here that
 * would mean measuring a page whose module graph still contains the developer state panel.
 */
function buildPage(): void {
  rmSync(OUT_DIR, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_ENV;
  execFileSync(process.execPath, [VITE_BIN, 'build', '--mode', 'production', '--outDir', OUT_SUB], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
  });
}

/** The driver, bundled beside the page's own assets so the page can load it as a module. */
async function buildDriver(): Promise<void> {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    build: {
      target: 'es2022',
      lib: {
        entry: path.join(ROOT, 'src/dev/layoutProbe.ts'),
        formats: ['es'],
        fileName: () => 'layout-probe-driver.js',
      },
      outDir: path.join(OUT_DIR, 'assets'),
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
    },
  });
}

/**
 * `probe.html` — the built page with its own entry script swapped for the driver.
 *
 * Everything else is untouched: the same skeleton, the same `<link>` to the same built
 * stylesheet, the same font urls. That is the whole point — the cascade under measurement is
 * the shipped cascade, not a reconstruction of it.
 */
function writeProbePage(): void {
  const html = readFileSync(path.join(OUT_DIR, 'desktop.html'), 'utf8');
  const entry = /<script\s+type="module"[^>]*src="\.\/assets\/desktop-[^"]*\.js"[^>]*><\/script>/g;
  SCRIPT_REPLACEMENTS = (html.match(entry) ?? []).length;
  const probe = html.replace(
    entry,
    '<script type="module" src="./assets/layout-probe-driver.js"></script>',
  );
  writeFileSync(path.join(OUT_DIR, 'probe.html'), probe, 'utf8');
}

/** Run the Electron half. A non-zero exit fails here, with the child's stderr in the message. */
function runElectron(): void {
  const electron = createRequire(import.meta.url)('electron') as string;
  try {
    execFileSync(
      electron,
      [
        path.join(ROOT, 'scripts', 'layout-probe.mjs'),
        '--dist',
        OUT_DIR,
        '--out',
        RESULT_FILE,
      ],
      { cwd: ROOT, stdio: 'pipe', timeout: 180_000 },
    );
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    throw new Error(
      `the layout probe could not measure the page:\n${String(e.stderr ?? '')}\n${String(
        e.stdout ?? '',
      )}\n${e.message ?? ''}`,
    );
  }
}

beforeAll(async () => {
  buildPage();
  EMITTED = readdirSync(path.join(OUT_DIR, 'assets'));
  await buildDriver();
  writeProbePage();
  mkdirSync(path.join(OUT_DIR, 'userData'), { recursive: true });
  runElectron();
  RESULT = JSON.parse(readFileSync(RESULT_FILE, 'utf8')) as ProbeResult;
}, 600_000);

afterAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

// =========================================================================================
// Lookup helpers. Each one FAILS rather than returning undefined: a probe assertion that
// silently skipped a missing measurement would be the vacuous guard all over again.
// =========================================================================================

function group(width: number, height: number): SizeGroup {
  const found = RESULT.phaseA.find(
    (g) => g.requested.width === width && g.requested.height === height,
  );
  if (!found) throw new Error(`no measurements at ${width}x${height}`);
  return found;
}

function report(width: number, height: number, scenario: string, scale: Scale): Report {
  const found = group(width, height).reports.find(
    (r) => r.scenario === scenario && r.scale === scale,
  );
  if (!found) throw new Error(`no ${scenario}/${scale} measurement at ${width}x${height}`);
  return found;
}

/** Every measurement taken, across every size and text scale. */
function everyReport(): Report[] {
  return RESULT.phaseA.flatMap((g) => g.reports);
}

/** The sizes at or above the enforced minimum — where every promise below has to hold. */
const AT_OR_ABOVE_MIN = SIZES.filter(([w, h]) => w >= 960 && h >= 640);

const SCENARIOS = Object.keys(EXPECTED);
const SIDE_SCENARIOS = SCENARIOS.filter((s) => EXPECTED[s]!.mode === 'side');
const WIDE_SCENARIOS = SCENARIOS.filter((s) => EXPECTED[s]!.mode === 'wide');

// =========================================================================================
// 0 — the probe measured what it claims to have measured.
// =========================================================================================

describe('the probe really ran, against the real build', () => {
  it('the hand-derived constants match the type scale they are derived from', () => {
    // The goalpost check. Every threshold in this file is arithmetic on these two numbers.
    expect(TYPE.base, 'the base type step moved — every threshold here is now wrong').toBe(
      `${BASE_PX.normal}px`,
    );
    expect(
      TEXT_SCALE_TABLE.large.base,
      'the large text step moved — every large-text threshold here is now wrong',
    ).toBe(`${BASE_PX.large}px`);
    expect(TEXT_SCALE_TABLE.normal.base).toBe(TYPE.base);
    expect(TYPE.md, 'the control type step moved').toBe(`${CONTROL_PX.normal}px`);
    expect(TEXT_SCALE_TABLE.large.md, 'the large control type step moved').toBe(
      `${CONTROL_PX.large}px`,
    );
  });

  it('a real production build was emitted and its entry script was swapped exactly once', () => {
    expect(EMITTED.some((f) => /^desktop-.*\.js$/.test(f)), `assets: ${EMITTED.join(', ')}`).toBe(
      true,
    );
    expect(EMITTED.some((f) => f.endsWith('.css')), 'the build emitted no stylesheet').toBe(true);
    expect(
      SCRIPT_REPLACEMENTS,
      'the built page did not carry exactly one module entry script — the probe page is ' +
        'either running the real renderer as well as the driver, or neither',
    ).toBe(1);
    expect(existsSync(path.join(OUT_DIR, 'assets', 'layout-probe-driver.js'))).toBe(true);
  });

  it('every size and every scenario was measured, at both text sizes', () => {
    expect(RESULT.phaseA.length, 'a window size went unmeasured').toBe(SIZES.length);
    for (const [width, height] of SIZES) {
      const g = group(width, height);
      expect(
        Math.abs(g.actual.width - width),
        `the page reported ${g.actual.width}px wide when ${width} was asked for`,
      ).toBeLessThanOrEqual(2);
      expect(Math.abs(g.actual.height - height)).toBeLessThanOrEqual(2);
      expect(g.reports.length, `${width}x${height} is short of measurements`).toBe(
        SCENARIOS.length * SCALES.length,
      );
    }
    expect(everyReport().length).toBe(SIZES.length * SCENARIOS.length * SCALES.length);
  });

  it('the page is styled at all — without the tokens every number here would be meaningless', () => {
    // NON-VACUITY, and the failure it guards against is real: if `applyTheme` never ran, every
    // `var(--void-*)` read resolves to nothing, the type scale is the browser default, and a
    // narration of "204 px" would mean nothing at all.
    for (const scale of SCALES) {
      const r = report(960, 640, 'hub', scale);
      expect(r.narration.fontSize, `${scale}: the narration is not at the token size`).toBe(
        BASE_PX[scale],
      );
      expect(
        r.narration.lineHeight,
        `${scale}: the narration is not at the stated line height`,
      ).toBeCloseTo(BASE_PX[scale] * NARRATION_LINE_HEIGHT, 1);
    }
  });

  it('and it is set in the BUNDLED typeface, which is whose metrics the measures are', () => {
    // 45 characters of measure is a JetBrains Mono fact. If the faces failed to load, every
    // width here is the system monospace's and the numbers describe a different game.
    expect(
      everyReport().every((r) => r.fontLoaded),
      'the bundled face did not load in the probe — the measures are the fallback font’s',
    ).toBe(true);
  });

  it('the worst-case content really is in the page (or the layout was never stressed)', () => {
    const r = report(960, 640, 'hub', 'normal');
    expect(r.narration.beats, 'the hub scenario rendered no prose').toBe(1);
    expect(r.log.lines, 'the hub scenario rendered no combat log').toBe(60);
    // PLAN.md #2: five rows — the "Seek a bargain" row left with §22.23.
    expect(r.choices.controls, 'the hub menu has no rows').toBe(5);
    expect(
      r.narration.scrollHeight,
      'the beat is short enough to fit its floor — it is not a worst case',
    ).toBeGreaterThan(proseFloorPx('side', 'normal'));
    expect(
      r.log.scrollHeight,
      'sixty log lines fit inside the cap — the log is not being stressed',
    ).toBeGreaterThan(LOG_CAP_VH * r.viewport.height);
  });
});

// =========================================================================================
// 1 — THE INVARIANT THAT MATTERS. The narration can never be starved.
//
// This is the assertion the escaped defect would have failed at 0 px, and the reason this
// file exists. It is checked on every `side` screen, at every reachable window size, at both
// text sizes, with the worst-case content in the page.
// =========================================================================================

describe('the narration always has room to be read', () => {
  it(`every side screen keeps ${PROSE_LINES.side} lines of prose, at every size and text setting`, () => {
    const starved: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of SIDE_SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          const floor = proseFloorPx('side', scale) - SLACK;
          if (r.narration.height < floor) {
            starved.push(
              `${width}x${height} ${scenario}/${scale}: ${r.narration.height.toFixed(1)}px, ` +
                `needs ${floor.toFixed(1)}`,
            );
          }
        }
      }
    }
    expect(
      starved,
      'the prose is starved — this is the defect that shipped, measured. The choices must ' +
        'not compete with the narration for vertical space',
    ).toEqual([]);
  });

  it(`every wide screen carrying prose keeps ${PROSE_LINES.wide} lines of it`, () => {
    const starved: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of WIDE_SCENARIOS.filter((s) => EXPECTED[s]!.prose)) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          const floor = proseFloorPx('wide', scale) - SLACK;
          if (r.narration.height < floor) {
            starved.push(
              `${width}x${height} ${scenario}/${scale}: ${r.narration.height.toFixed(1)}px, ` +
                `needs ${floor.toFixed(1)}`,
            );
          }
        }
      }
    }
    expect(starved, 'a document screen starved the prose behind it').toEqual([]);
  });

  it('and a pane with NO prose in it takes no space at all', () => {
    // The other polarity, and it matters: a floor that held itself open on an empty pane
    // would put a permanent 200px hole above the content warning.
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of SCENARIOS.filter((s) => !EXPECTED[s]!.prose)) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          expect(r.narration.beats, `${scenario} was expected to carry no prose`).toBe(0);
          expect(
            r.narration.height,
            `${width}x${height} ${scenario}/${scale}: an empty narration holds ` +
              `${r.narration.height.toFixed(1)}px open`,
          ).toBeLessThanOrEqual(SLACK);
        }
      }
    }
  });

  it('the narration box is inside the window, and the reading column does not scroll', () => {
    const offenders: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          const where = `${width}x${height} ${scenario}/${scale}`;
          if (r.narration.top < -SLACK) offenders.push(`${where}: narration top ${r.narration.top}`);
          if (r.narration.bottom > height + SLACK) {
            offenders.push(`${where}: narration bottom ${r.narration.bottom} > ${height}`);
          }
          if (r.column.scrollHeight > r.column.clientHeight + SLACK) {
            offenders.push(
              `${where}: the reading column scrolls (${r.column.scrollHeight} > ${r.column.clientHeight})`,
            );
          }
        }
      }
    }
    expect(
      offenders,
      'the reading column overflows. `overflow-y: auto` on it is a LAST RESORT, not the ' +
        'design — reaching it means the floors no longer fit the window',
    ).toEqual([]);
  });

  it('a beat longer than the floor scrolls INSIDE the pane rather than growing it', () => {
    // The floor is a minimum, not a size. Worst-case prose has to be reachable without the
    // pane pushing the log and the choices off the screen.
    const r = report(960, 640, 'hub', 'normal');
    expect(r.narration.scrollHeight).toBeGreaterThan(r.narration.clientHeight);
    expect(r.narration.height).toBeLessThan(640);
  });
});

// =========================================================================================
// 2 — the caps and the committed geometry.
// =========================================================================================

describe('the reserved scenery region is capped in BOTH directions, and keeps its ratio', () => {
  it('it is really mounted on the hub and the rest spot, and nowhere else', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of SCENARIOS) {
        const r = report(width, height, scenario, 'normal');
        expect(
          r.scenery.count,
          `${width}x${height} ${scenario}: ${r.scenery.count} scenery regions in the page`,
        ).toBe(EXPECTED[scenario]!.scenery ? 1 : 0);
      }
    }
  });

  it('the committed 16:9 is intact — the ratio governs inside the box', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scale of SCALES) {
        const r = report(width, height, 'hub', scale);
        expect(r.scenery.ratio, `${width}x${height}/${scale}: no scenery measured`).not.toBeNull();
        expect(
          Math.abs((r.scenery.ratio as number) - SCENERY_RATIO),
          `${width}x${height}/${scale}: the scenery is ${r.scenery.ratio}, not 16:9`,
        ).toBeLessThan(0.01);
      }
    }
  });

  it('neither cap is exceeded, and the region is really there (not collapsed to nothing)', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      const box = report(width, height, 'hub', 'normal').scenery.box as Box;
      expect(box.height, `${width}x${height}: taller than ${SCENERY_CAP_VH * 100}vh`).toBeLessThanOrEqual(
        SCENERY_CAP_VH * height + SLACK,
      );
      expect(box.width, `${width}x${height}: wider than ${SCENERY_CAP_PX}px`).toBeLessThanOrEqual(
        SCENERY_CAP_PX + SLACK,
      );
      expect(box.height, `${width}x${height}: the region collapsed`).toBeGreaterThan(100);
    }
  });

  it('BOTH caps really bite — one at the minimum window, the other on a tall desktop', () => {
    // A pair of caps where only one can ever apply is one cap and a decoration. The height
    // cap governs while 0.22*H*16/9 < 440, i.e. below 1125px tall; the width cap governs
    // above it. Both cases are measured.
    const small = report(960, 640, 'hub', 'normal').scenery.box as Box;
    expect(
      small.height,
      'the HEIGHT cap does not govern at the minimum window, where it must',
    ).toBeCloseTo(SCENERY_CAP_VH * 640, 0);
    expect(small.width).toBeLessThan(SCENERY_CAP_PX);

    const tall = report(1920, 1200, 'hub', 'normal').scenery.box as Box;
    expect(
      tall.width,
      'the WIDTH cap does not govern on a tall window, where it must — the 16:9 region ' +
        'would keep growing with the viewport',
    ).toBeCloseTo(SCENERY_CAP_PX, 0);
    expect(tall.height).toBeLessThan(SCENERY_CAP_VH * 1200);
  });

  it('and the ratio is the one the data commits to, not one this test invented', () => {
    // Read from the shipped data rather than restated, so changing `artSlots.json` fails
    // here as well as in `art-slots.test.ts`. ART-BIBLE §4: the ratio is the commitment.
    const data = JSON.parse(readFileSync(path.join(ROOT, 'src/data/artSlots.json'), 'utf8')) as {
      slots: { id: string; ratioW: number; ratioH: number }[];
    };
    const scenery = data.slots.find((s) => s.id === 'scenery');
    expect(scenery, 'the scenery slot is gone from the data').toBeDefined();
    expect(scenery!.ratioW / scenery!.ratioH).toBe(SCENERY_RATIO);
  });
});

describe('the combat log is capped, floored, and scrollable inside its cap', () => {
  it('sixty lines never take more than the cap', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of SIDE_SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          if (r.log.lines === 0) continue;
          expect(
            r.log.height,
            `${width}x${height} ${scenario}/${scale}: the log is ${r.log.height.toFixed(1)}px`,
          ).toBeLessThanOrEqual(LOG_CAP_VH * height + SLACK);
        }
      }
    }
  });

  it('and never less than its floor, so the mechanical record is never invisible', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scale of SCALES) {
        const r = report(width, height, 'hub', scale);
        expect(
          r.log.height,
          `${width}x${height}/${scale}: the log shrank to ${r.log.height.toFixed(1)}px`,
        ).toBeGreaterThanOrEqual(logFloorPx(scale) - SLACK);
      }
    }
  });

  it('the newest line stays reachable — it scrolls rather than growing', () => {
    const r = report(960, 640, 'hub', 'normal');
    expect(
      r.log.scrollHeight,
      'sixty log lines fit inside the cap, so the cap is not being tested',
    ).toBeGreaterThan(r.log.clientHeight);
  });

  it('an empty log takes no space', () => {
    for (const scale of SCALES) {
      const r = report(960, 640, 'choose-class', scale);
      expect(r.log.lines).toBe(0);
      expect(r.log.height, 'an empty combat log holds space open').toBeLessThanOrEqual(SLACK);
    }
  });
});

// =========================================================================================
// 3 — usable at the enforced minimum: no clipped control, nothing unreachable.
// =========================================================================================

describe('every control is reachable at the enforced minimum window', () => {
  /**
   * Screens whose choice area is a short list: every control must be visible OUTRIGHT, with
   * nothing to scroll. This is the strict standard, and it covers everything the player meets
   * repeatedly — the hub, the abandon confirmation, a battle, class select, the title.
   */
  const ALL_VISIBLE = [
    'hub',
    'confirm-abandon',
    'battle',
    'choose-class',
    'title',
    // PLAN.md #2: met on every floor — several bargains and a rest or two per floor — so they
    // get the strict standard. Appendix A.3.4 says it of the full-pack bargain in so many words:
    // nothing below the fold, at 960x640, at large text.
    'rest',
    'deal-decision',
    'deal-discard',
    // Fix round 2: the marking state too — the longer prompt and its "Leaving:" line must not
    // push the two controls below the fold (A.3.4), at either text size.
    'deal-discard-marked',
  ];

  /**
   * A list the GAME PRESENTS that outgrows the window. The standard here is stricter than
   * "reachable": **no control may BEGIN off-screen.** A card may run past the bottom edge;
   * none may start below it, because a control that starts below the fold is invisible until
   * the player scrolls, and a screen that opens on apparently-nothing is this unit's own
   * defect one screen along.
   *
   * ⚠ `draft-pick` AT LARGE TEXT IS HERE BECAUSE THE PROBE MEASURED IT. Three draft cards
   * carrying 90-character labels, in a 260px column at the large text setting, put the third
   * card at y479-653 in a 640px window — 13px past the fold, and **93% of it visible**, which
   * is precisely what makes the concession defensible: the player sees almost the whole card
   * and has an obvious reason to scroll. The alternatives cost more:
   *   - a wider choice column takes the width straight out of the reading measure, which at
   *     960px is already 45 characters;
   *   - tighter padding or a smaller step at the large setting is precisely the regression
   *     the text-size setting exists to prevent — the large setting that is not large.
   * What is NOT relaxed: at the DEFAULT text size all three cards must still fit outright,
   * asserted separately below, so this exception cannot quietly widen into the normal case.
   */
  const PRESENTED_OVERFLOW: readonly { scenario: string; scale: Scale }[] = [
    { scenario: 'draft-pick', scale: 'large' },
  ];

  /**
   * A disclosure the PLAYER expanded, which is a different thing and gets a different rule.
   *
   * Opening the Cast list is a deliberate act with a one-click undo, and it adds six controls
   * to a column that was already full. Measured at 960x640: with the list open, Run begins at
   * y695 at the default text size, and three controls begin below the fold at the large one.
   * Nothing in the stage layout can make 788px of content fit in 555px, and the battle
   * screen's own contents belong to `docs/PLAN.md` #6, not to this unit.
   *
   * ⚠ SO THE GUARANTEE IS NAMED AT BOTH ENDS, and neither half is taken on trust: the list
   * scrolls so everything is reachable, AND **the collapsed state restores every control to
   * the window** — which is asserted directly below against the `battle` scenario, not merely
   * assumed because it appears in another list.
   */
  const EXPANDED_DISCLOSURE: readonly {
    scenario: string;
    collapsed: string;
    scale: Scale;
  }[] = [
    { scenario: 'battle-open', collapsed: 'battle', scale: 'normal' },
    { scenario: 'battle-open', collapsed: 'battle', scale: 'large' },
    // PLAN.md #2, Appendix A.3: twelve leave rows and the refusal — 13 controls of at least one
    // line each plus their gaps cannot fit a 640px window at either text size, which is WHY the
    // rows sit in a closed list. The player opens it with one click and closes it with another.
    { scenario: 'deal-discard-open', collapsed: 'deal-discard', scale: 'normal' },
    { scenario: 'deal-discard-open', collapsed: 'deal-discard', scale: 'large' },
    { scenario: 'deal-discard-marked-open', collapsed: 'deal-discard-marked', scale: 'normal' },
    { scenario: 'deal-discard-marked-open', collapsed: 'deal-discard-marked', scale: 'large' },
  ];

  /**
   * ⚠ A CONTROL WITH NO HEIGHT PASSES EVERY FOLD CHECK FOR FREE, and that is the failure mode
   * this whole unit exists to catch.
   *
   * A rect of `top 0, bottom 0` satisfies "at or below the top of the window" and "at or above
   * the bottom" simultaneously — so a button that collapsed to nothing would be counted as
   * comfortably visible. The battle screen legitimately contains seven such controls (the
   * skills inside a closed Cast list and the item inside a closed Use-item list, both
   * `display: none`), so they cannot simply be banned; they have to be DISTINGUISHED.
   *
   * `laidOut` is the discriminator, and `genuinelyHidden` is the other half of it: an element
   * with no box at all is absent, while an element that still has a WIDTH and no height is a
   * laid-out control that collapsed. The choice column stretches its children, so any control
   * the browser really laid out has a width of well over 200px — a collapsed one keeps that
   * width and loses its height, which is exactly the shape below that is refused.
   */
  const laidOut = (b: Box): boolean => b.height > 0;
  const genuinelyHidden = (b: Box): boolean => b.height === 0 && b.width === 0;

  /**
   * How many controls each screen puts on the page, and how many it deliberately hides.
   *
   * DERIVED BY HAND from the builders, not read off a run:
   *   hub / confirm-abandon  `hubMenu` returns 5 rows in menu mode (Continue, Inventory,
   *                          Character sheet, Settings, Abandon — PLAN.md #2 removed "Seek a
   *                          bargain") and 2 in confirmation mode.
   *   battle                 Fight + the Cast toggle + Spare + the Use-item toggle + Run = 5 on
   *                          screen (PLAN.md #2 removed the Potion button, §22.6); 6 skills and
   *                          1 item sit inside the two closed picker lists = 7 hidden.
   *   battle-open            the same 12, with the Cast list open, so 11 on screen and 1 left
   *                          inside the still-closed Use-item list.
   *   choose-class           the five class rows.
   *   draft-pick             three cards (the "Choose one" line is a div, not a control).
   *   settings               `SETTINGS_ROWS` is 3 + 3 + 2 options, plus Back = 9.
   *   inventory              the rows are label/value spans, plus Back — and PLAN.md #2 gave
   *                          each of the fixture's 15 backpack rows a Discard: 1 + 15 = 16.
   *   game-over              the rows are label/value spans; only Descend again.
   *   rest                   one Continue — the rest has already happened (§22.26).
   *   deal-decision          Pay the price + Refuse = 2 (the block above them is text).
   *   deal-discard           A.3: the "Choose what to leave" toggle + the refusal = 2 on screen;
   *                          one leave row per slot of the FULL pack (BACKPACK_CAPACITY = 12)
   *                          inside the closed list = 12 hidden.
   *   deal-discard-open      the same 14 with the list open: 14 on screen, none hidden.
   *   deal-discard-marked    fix round 2 — a pack of 15 with 2 marked: the toggle + the refusal
   *                          = 2 on screen; 15 - 2 marked = 13 leave rows hidden in the list.
   *   deal-discard-marked-open  the same 15 with the list open: 15 on screen, none hidden.
   *   content-warning        exactly one control, by policy — never a fight to get past.
   *   title / resume         two stacked buttons.
   *
   * This is the check that catches a control DISAPPEARING, which the zero-height
   * discriminator alone cannot: a `display: none` on a real button is indistinguishable from
   * a legitimately hidden picker entry by its rect, and only the count tells them apart.
   */
  const EXPECTED_CONTROLS: Readonly<Record<string, { visible: number; hidden: number }>> = {
    hub: { visible: 5, hidden: 0 },
    'confirm-abandon': { visible: 2, hidden: 0 },
    battle: { visible: 5, hidden: 7 },
    'battle-open': { visible: 11, hidden: 1 },
    'choose-class': { visible: 5, hidden: 0 },
    'draft-pick': { visible: 3, hidden: 0 },
    inventory: { visible: 16, hidden: 0 },
    rest: { visible: 1, hidden: 0 },
    'deal-decision': { visible: 2, hidden: 0 },
    'deal-discard': { visible: 2, hidden: 12 },
    'deal-discard-open': { visible: 14, hidden: 0 },
    'deal-discard-marked': { visible: 2, hidden: 13 },
    'deal-discard-marked-open': { visible: 15, hidden: 0 },
    settings: { visible: 9, hidden: 0 },
    'content-warning': { visible: 1, hidden: 0 },
    title: { visible: 2, hidden: 0 },
    resume: { visible: 2, hidden: 0 },
    'game-over': { visible: 1, hidden: 0 },
  };

  it('a control is either laid out or genuinely absent — never zero-sized and counted as fine', () => {
    const offenders: string[] = [];
    for (const [scenario, expected] of Object.entries(EXPECTED_CONTROLS)) {
      for (const scale of SCALES) {
        const r = report(960, 640, scenario, scale);
        const visible = r.buttons.filter(laidOut);
        const absent = r.buttons.filter((b) => !laidOut(b));
        if (visible.length !== expected.visible) {
          offenders.push(
            `${scenario}/${scale}: ${visible.length} controls on screen, expected ` +
              `${expected.visible} — one has disappeared or one has appeared`,
          );
        }
        if (absent.length !== expected.hidden) {
          offenders.push(
            `${scenario}/${scale}: ${absent.length} controls with no box, expected ` +
              `${expected.hidden}`,
          );
        }
        for (const [i, b] of r.buttons.entries()) {
          if (genuinelyHidden(b)) continue;
          if (!laidOut(b)) {
            offenders.push(
              `${scenario}/${scale} control ${i}: ${b.width.toFixed(0)}px wide and ` +
                `${b.height.toFixed(0)}px tall — a laid-out control that collapsed, which every ` +
                'fold check below would have counted as comfortably visible',
            );
            continue;
          }
          // ⚠ A PRESENCE CHECK IS NOT ENOUGH, and this was found by mutation rather than by
          // reading. `height: 0` on a `.void-button` does NOT produce a zero-height box: the
          // border survives, so the control measures 2px and counts as "laid out and inside
          // the window". A 2px control is as unusable as a 4.5px narration, and it is the
          // same defect family. So a control that is on screen must be at least ONE LINE of
          // its own type tall — the smallest height at which its label can exist at all.
          const floor = CONTROL_PX[scale] * BODY_LINE_HEIGHT;
          if (b.height < floor - SLACK) {
            offenders.push(
              `${scenario}/${scale} control ${i}: ${b.height.toFixed(1)}px tall, less than the ` +
                `${floor.toFixed(1)}px one line of its own text needs — it is collapsed`,
            );
          }
        }
      }
    }
    expect(offenders, 'the control census does not match the design').toEqual([]);
  });

  it('...and the census really is measuring boxes of both kinds (non-vacuity)', () => {
    // Without this, the discriminators above could both be broken and every count could be
    // satisfied by a page where nothing has a box at all.
    const battle = report(960, 640, 'battle', 'normal');
    expect(battle.buttons.filter(laidOut).length, 'no control is laid out anywhere')
      .toBeGreaterThan(0);
    expect(
      battle.buttons.filter((b) => !laidOut(b)).length,
      'the closed pickers hide nothing — the discriminator has nothing to tell apart',
    ).toBeGreaterThan(0);
    // The discriminators themselves, on the three shapes they must separate.
    expect(laidOut({ top: 10, right: 236, bottom: 56, left: 10, width: 226, height: 46 })).toBe(true);
    expect(genuinelyHidden({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 })).toBe(true);
    const collapsed = { top: 10, right: 236, bottom: 10, left: 10, width: 226, height: 0 };
    expect(laidOut(collapsed), 'a collapsed control counts as laid out').toBe(false);
    expect(genuinelyHidden(collapsed), 'a collapsed control counts as absent').toBe(false);
    // ...and the SLIVER, which is neither of the two above and is the shape a mutation
    // actually produces: `height: 0` leaves the border behind, so the box is 2px tall.
    const sliver = { top: 10, right: 236, bottom: 12, left: 10, width: 226, height: 2 };
    expect(laidOut(sliver), 'a 2px control is not laid out by the presence test').toBe(true);
    expect(
      sliver.height < CONTROL_PX.normal * BODY_LINE_HEIGHT - SLACK,
      'the one-line floor does not catch a 2px control',
    ).toBe(true);
    // The real controls clear it comfortably, so the floor is not near the working values.
    for (const b of report(960, 640, 'hub', 'normal').buttons) {
      expect(b.height).toBeGreaterThan(CONTROL_PX.normal * BODY_LINE_HEIGHT);
    }
  });

  it('no button is clipped or below the fold, at either text size', () => {
    const offenders: string[] = [];
    for (const scenario of ALL_VISIBLE) {
      for (const scale of SCALES) {
        const r = report(960, 640, scenario, scale);
        expect(r.buttons.length, `${scenario}/${scale} rendered no controls`).toBeGreaterThan(0);
        for (const [i, b] of r.buttons.entries()) {
          // A control with no box is judged by the census above, which is the only check that
          // can tell a legitimately hidden picker entry from a collapsed one. Judging it here
          // would pass it for free: `0 >= -1` and `0 <= 641` are both true.
          if (!laidOut(b)) continue;
          if (b.top < -SLACK || b.bottom > r.viewport.height + SLACK) {
            offenders.push(
              `${scenario}/${scale} control ${i}: ${b.top.toFixed(0)}..${b.bottom.toFixed(0)} ` +
                `is outside a ${r.viewport.height}px window`,
            );
          }
        }
        if (r.choices.scrollHeight > r.choices.clientHeight + SLACK) {
          offenders.push(`${scenario}/${scale}: the choice column scrolls`);
        }
      }
    }
    expect(
      offenders,
      'a control cannot be reached at the smallest window the game allows. Abandon sitting ' +
        'below the fold is exactly what shipped',
    ).toEqual([]);
  });

  /** First control visible, box inside the window, and it really scrolls. */
  function assertReachable(scenario: string, scale: Scale): Report {
    const where = `${scenario}/${scale}`;
    const r = report(960, 640, scenario, scale);
    const first = r.buttons.filter(laidOut)[0] as Box;
    expect(first, `${where}: no control is laid out at all`).toBeDefined();
    expect(first.top, `${where}: the first control is above the window`).toBeGreaterThanOrEqual(
      -SLACK,
    );
    expect(first.bottom, `${where}: the first control is clipped`).toBeLessThanOrEqual(
      r.viewport.height + SLACK,
    );
    expect(r.choices.bottom, `${where}: the choice box overflows the window`).toBeLessThanOrEqual(
      r.viewport.height + SLACK,
    );
    expect(
      r.choices.scrollHeight,
      `${where}: the list fits, so this case no longer tests reachability — move it back ` +
        'to the strict list rather than leaving a case here that proves nothing',
    ).toBeGreaterThan(r.choices.clientHeight);
    return r;
  }

  it('a list the GAME presents may overflow, but no control may BEGIN off-screen', () => {
    // ⭐ THE CLAUSE THAT MAKES THE CONCESSION DEFENSIBLE, and it was missing. "The first
    // control is visible and the rest scroll into reach" is satisfied by a list whose second
    // card is 5% visible. What makes the measured case acceptable is that the overflowing
    // card is 93% visible. Nothing pinned that until now.
    for (const { scenario, scale } of PRESENTED_OVERFLOW) {
      const r = assertReachable(scenario, scale);
      for (const [i, b] of r.buttons.entries()) {
        if (!laidOut(b)) continue;
        expect(
          b.top,
          `${scenario}/${scale} control ${i}: begins at y${b.top.toFixed(0)} in a ` +
            `${r.viewport.height}px window — it is entirely off-screen until scrolled to`,
        ).toBeLessThanOrEqual(r.viewport.height);
        expect(
          b.top,
          `${scenario}/${scale} control ${i}: begins above the window`,
        ).toBeGreaterThanOrEqual(-SLACK);
      }
    }
    expect(PRESENTED_OVERFLOW.length, 'this guard covers nothing').toBeGreaterThan(0);
  });

  it('an expanded disclosure stays reachable, and COLLAPSING it restores every control', () => {
    // The other half of the rule, and the half that would otherwise be assumed. A player who
    // opened the Cast list pushed six controls down themselves and can undo it with one
    // click; the guarantee is that the undo really works, asserted here against the collapsed
    // scenario rather than left to another test's list to imply.
    for (const { scenario, collapsed, scale } of EXPANDED_DISCLOSURE) {
      const open = assertReachable(scenario, scale);
      const shut = report(960, 640, collapsed, scale);

      // Collapsed: every control laid out, fully inside the window, and nothing scrolls.
      for (const [i, b] of shut.buttons.entries()) {
        if (!laidOut(b)) continue;
        expect(
          b.top,
          `${collapsed}/${scale} control ${i} begins off-screen with the list CLOSED — the ` +
            'undo does not restore the column',
        ).toBeLessThanOrEqual(shut.viewport.height);
        expect(b.bottom, `${collapsed}/${scale} control ${i} is below the fold when closed`)
          .toBeLessThanOrEqual(shut.viewport.height + SLACK);
      }
      expect(
        shut.choices.scrollHeight,
        `${collapsed}/${scale}: the column still scrolls with the list closed`,
      ).toBeLessThanOrEqual(shut.choices.clientHeight + SLACK);

      // ...and the expansion is really what made the difference (or this proves nothing).
      expect(
        open.buttons.filter(laidOut).length,
        `${scenario}/${scale}: opening the list added no controls`,
      ).toBeGreaterThan(shut.buttons.filter(laidOut).length);
    }
    expect(EXPANDED_DISCLOSURE.length, 'this guard covers nothing').toBeGreaterThan(0);
  });

  it('and the draft still fits OUTRIGHT at the default text size', () => {
    // The bound on the exception above. The scrolling concession is for the large text
    // setting alone; if the default size ever needs it too, that is a design change and it
    // must fail here rather than pass quietly.
    const r = report(960, 640, 'draft-pick', 'normal');
    expect(r.buttons.filter(laidOut).length, 'the draft rendered no cards').toBe(3);
    for (const [i, b] of r.buttons.entries()) {
      expect(laidOut(b), `draft card ${i} has no box — it would pass this check for free`).toBe(
        true,
      );
      expect(b.top, `draft card ${i} begins below the fold at the default text size`)
        .toBeLessThanOrEqual(r.viewport.height);
      expect(b.bottom, `draft card ${i} is below the fold at the default text size`)
        .toBeLessThanOrEqual(r.viewport.height + SLACK);
    }
    expect(
      r.choices.scrollHeight,
      'the draft needs to scroll at the DEFAULT text size — that is a design change, not a ' +
        'large-text concession',
    ).toBeLessThanOrEqual(r.choices.clientHeight + SLACK);
  });

  it('a document screen keeps its box inside the window and scrolls its own content', () => {
    for (const scenario of ['inventory', 'settings', 'game-over', 'content-warning']) {
      for (const scale of SCALES) {
        const r = report(960, 640, scenario, scale);
        expect(
          r.choices.bottom,
          `${scenario}/${scale}: the document box runs past the bottom of the window`,
        ).toBeLessThanOrEqual(640 + SLACK);
        expect(r.choices.top).toBeGreaterThanOrEqual(-SLACK);
      }
    }
  });

  it("the content warning's only control is fully visible — it is never a fight to get past", () => {
    const small = report(960, 640, 'content-warning', 'normal');
    expect(small.buttons.length).toBe(1);
    expect((small.buttons[0] as Box).bottom).toBeLessThanOrEqual(640 + SLACK);
    for (const scale of SCALES) {
      const r = report(1100, 820, 'content-warning', scale);
      expect(r.buttons.length).toBe(1);
      expect(
        (r.buttons[0] as Box).bottom,
        `${scale}: the acknowledge button is below the fold at the default window`,
      ).toBeLessThanOrEqual(820 + SLACK);
    }
  });

  it('and the PAGE itself never scrolls, at any size', () => {
    const offenders: string[] = [];
    for (const [width, height] of SIZES) {
      for (const scenario of SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          if (r.page.scrollHeight > r.page.clientHeight + SLACK) {
            offenders.push(
              `${width}x${height} ${scenario}/${scale}: the page scrolls ` +
                `(${r.page.scrollHeight} > ${r.page.clientHeight})`,
            );
          }
        }
      }
    }
    expect(offenders, 'the whole page scrolls — the shell is taller than the window').toEqual([]);
  });
});

// =========================================================================================
// 4 — the two stage layouts really are two different geometries.
// =========================================================================================

describe('the stage puts the choices where the mode says', () => {
  it('every screen is rendered in the mode the design assigns it', () => {
    for (const r of everyReport()) {
      expect(r.layout, `${r.scenario} rendered in the wrong stage layout`).toBe(
        EXPECTED[r.scenario]!.mode,
      );
    }
  });

  it('on a side screen the choices sit BESIDE the reading column, never below it', () => {
    const offenders: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of SIDE_SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          if (r.choices.left < r.column.right - SLACK) {
            offenders.push(
              `${width}x${height} ${scenario}/${scale}: choices start at ${r.choices.left.toFixed(0)}, ` +
                `column ends at ${r.column.right.toFixed(0)} — they overlap`,
            );
          }
        }
      }
    }
    expect(
      offenders,
      'the choices are back inside the reading column. That is the defect: a six-row menu ' +
        'then takes the vertical space the prose needs',
    ).toEqual([]);
  });

  it('on a wide screen the document sits BELOW the reading column', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of WIDE_SCENARIOS) {
        const r = report(width, height, scenario, 'normal');
        expect(
          r.choices.top,
          `${width}x${height} ${scenario}: the document is beside the column, not below it`,
        ).toBeGreaterThanOrEqual(r.column.bottom - SLACK);
      }
    }
  });

  it(`below ${STACK_BELOW}px the stage STACKS, and the fallback is still readable`, () => {
    // Unreachable in the shipped desktop build (the window minimum is 960 wide). It exists
    // for CLAUDE.md principle 6 — a narrower path later — and it is measured here so it is
    // not dead code that has never been rendered.
    expect(800).toBeLessThan(STACK_BELOW);
    for (const scale of SCALES) {
      const r = report(800, 600, 'hub', scale);
      expect(r.choices.top, `${scale}: the stage did not stack below the breakpoint`).toBeGreaterThanOrEqual(
        r.column.bottom - SLACK,
      );
      expect(r.scenery.count, `${scale}: the scenery is still mounted in the stacked fallback`).toBe(1);
      expect(
        (r.scenery.box as Box).height,
        `${scale}: the scenery still takes space in the stacked fallback`,
      ).toBeLessThanOrEqual(SLACK);
      expect(
        r.narration.height,
        `${scale}: the stacked fallback starves the prose`,
      ).toBeGreaterThanOrEqual(proseFloorPx('wide', scale) - SLACK);
    }
  });
});

// =========================================================================================
// 5 — keyboard order follows reading order.
// =========================================================================================

describe('tab order follows reading order', () => {
  it('everything in the reading column comes before everything in the choices', () => {
    const offenders: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of SCENARIOS) {
        const order = report(width, height, scenario, 'normal').focusOrder;
        const lastColumn = order.lastIndexOf('column');
        const firstChoices = order.indexOf('choices');
        if (lastColumn >= 0 && firstChoices >= 0 && lastColumn > firstChoices) {
          offenders.push(`${width}x${height} ${scenario}: ${order.join(',')}`);
        }
      }
    }
    expect(
      offenders,
      'a focusable element in the choices comes before one in the reading column — the ' +
        'keyboard would jump backwards out of the prose',
    ).toEqual([]);
  });

  it('...over a case that really has focusable elements in BOTH regions (non-vacuity)', () => {
    // Without this, "no offender" is satisfied by a page in which the reading column has
    // nothing focusable at all. The combat log's expanders are the column's focusables.
    const order = report(960, 640, 'hub', 'normal').focusOrder;
    expect(order.filter((r) => r === 'column').length, 'the reading column has no focusables').toBeGreaterThan(
      3,
    );
    expect(order.filter((r) => r === 'choices').length).toBeGreaterThanOrEqual(5);
  });
});

// =========================================================================================
// 6 — THE SECOND DEFECT: the documented minimum was never the size the page got.
// =========================================================================================

describe('the enforced minimum is the size the PAGE receives, not the window frame', () => {
  it('a window built with the shipped options gives the page exactly 960x640', () => {
    expect(RESULT.minWindow.options['useContentSize'], 'useContentSize is not set').toBe(true);
    expect(RESULT.minWindow.before.content).toEqual([960, 640]);
  });

  it('and it still does after the window is squeezed as small as it will go', () => {
    expect(
      RESULT.minWindow.after.content,
      'the minimum does not hold under a resize — the page can be made smaller than the ' +
        'size every layout is designed against',
    ).toEqual([960, 640]);
  });

  it('THE CONTROL: without it, the page gets LESS than the documented minimum', () => {
    // The measurement that makes the two assertions above mean something. The identical
    // window without `useContentSize` applies its constraints to the window box, so the
    // frame and the menu bar come out of the page's share. This is what shipped.
    const [w, h] = RESULT.minWindow.control.content as [number, number];
    expect(
      w < 960 || h < 640,
      `without useContentSize the page got ${w}x${h}, which is not smaller than 960x640 — ` +
        'if that is really true on this platform, this guard now proves nothing',
    ).toBe(true);
  });

  it('and the shipped main process really sets it, inside the window it builds', () => {
    // The other end of the coupling (G56): the probe proves the OPTION works, and this
    // proves the shipped code passes it — in the same object literal that carries the
    // minimum, so a second `BrowserWindow` elsewhere cannot satisfy it.
    const main = readFileSync(path.join(ROOT, 'electron', 'main.mjs'), 'utf8');
    const at = main.indexOf('new BrowserWindow({');
    expect(at, 'main.mjs no longer builds a BrowserWindow').toBeGreaterThan(-1);
    const literal = main.slice(at, main.indexOf('\n  });', at));
    expect(literal, 'the window literal lost its minimum width').toMatch(/minWidth:\s*960/);
    expect(
      literal,
      'the game window does not set useContentSize, so 960x640 is the FRAME and the page ' +
        'gets less — the documented minimum would be false again',
    ).toMatch(/useContentSize:\s*true/);
  });
});

// =========================================================================================
// 7 — THE REAL RENDERER, BOOTED AND WALKED.
//
// Everything above measures pages the PROBE assembles. This measures the page the GAME
// assembles: the production `dist/desktop.html` with only a stub IPC bridge, the real
// `src/desktop/game.ts` running, and a click walk from the content warning to the abandon
// confirmation at the default window size.
//
// WHY IT IS NOT REDUNDANT. The driver in `src/dev/layoutProbe.ts` MIRRORS two structures the
// renderer builds inline — the battle control list and the `.hub-menu` wrapper — because
// `game.ts` calls the Electron IPC at module scope and can never be imported (G51). A mirror
// can drift from the thing it mirrors, and a drifted mirror is a test that carefully measures
// a page the game never shows. This is the other end of that coupling, and the two are
// compared against each other directly below.
//
// It also exercises three things only a real boot can: that clearing the reserved region on
// every render path really stops frames accumulating, that the REAL settings path moves the
// prose floor (the floor is defined in `lh`, so an inert setting leaves it unmoved), and that
// the renderer's own instrumentation reports the viewport and raises no layout warning.
// =========================================================================================

describe('the real renderer, booted and walked', () => {
  const step = (name: string): WalkStep => {
    const found = RESULT.phaseC.steps.find((s) => s.step === name);
    if (!found) {
      throw new Error(
        `the walk never reached '${name}' — it got as far as ` +
          RESULT.phaseC.steps.map((s) => s.step).join(', '),
      );
    }
    return found;
  };

  it('the walk completed every step, in order', () => {
    expect(RESULT.phaseC.steps.map((s) => s.step)).toEqual([
      'content-warning',
      'title',
      'choose-class',
      'hub',
      'hub-large-text',
      'settings',
      'inventory',
      'hub-after-re-renders',
      'confirm-abandon',
    ]);
  });

  it('and it is the real page: the bundled face loaded and all four weights are there', () => {
    expect(RESULT.phaseC.fontLoaded, 'the walk measured the fallback font').toBe(true);
    expect(RESULT.phaseC.fontCount, 'not every bundled weight reached the build').toBe(4);
  });

  it('every screen is in the stage layout the design assigns it', () => {
    for (const [name, mode] of [
      ['content-warning', 'wide'],
      ['title', 'wide'],
      ['choose-class', 'side'],
      ['hub', 'side'],
      ['settings', 'wide'],
      ['inventory', 'wide'],
      ['confirm-abandon', 'side'],
    ] as const) {
      expect(step(name).layout, `${name} is in the wrong stage layout`).toBe(mode);
    }
  });

  it('the hub the RENDERER builds matches the one the probe mirrors', () => {
    // The anti-drift check, and the reason both halves exist. If the driver's mirror of
    // `renderHub` ever stopped matching the real one, every hub number measured above would
    // describe a screen the game does not show.
    const real = step('hub');
    const mirrored = report(1100, 820, 'hub', 'normal');
    expect(real.hubMenuRows, 'the real hub menu has a different number of rows').toBe(5);
    expect(
      real.choices.controls,
      'the mirrored hub and the real hub disagree on how many controls the hub has',
    ).toBe(mirrored.choices.controls);
    // The menu's geometry, not just its count: same window size, same rows, same height.
    const realMenu = (real.buttons.at(-1) as Box).bottom - (real.buttons[0] as Box).top;
    const mirrorMenu = (mirrored.buttons.at(-1) as Box).bottom - (mirrored.buttons[0] as Box).top;
    expect(
      Math.abs(realMenu - mirrorMenu),
      `the mirrored hub menu is ${mirrorMenu.toFixed(1)}px tall and the real one is ` +
        `${realMenu.toFixed(1)}px — the mirror has drifted`,
    ).toBeLessThan(2);
  });

  it('the hub gives real prose real room, and it is really the fallback path', () => {
    const hub = step('hub');
    expect(hub.narration.beats, 'the hub shows no prose at all').toBe(1);
    expect(
      hub.narration.fallbacks,
      'the beat is not the fallback — the stub narrator was supposed to reject',
    ).toBe(1);
    expect(hub.narration.characters, 'the fallback wrote almost nothing').toBeGreaterThan(40);
    expect(
      hub.narration.height,
      'the real hub starves the prose — this is the defect, in the real renderer',
    ).toBeGreaterThanOrEqual(proseFloorPx('side', 'normal') - SLACK);
  });

  it('the reserved region is mounted exactly once, and stays that way after re-renders', () => {
    // It is no longer a child of `#choices`, so `choicesEl.innerHTML = ''` no longer removes
    // it. Miss one clearing path and every hub render stacks another 16:9 frame on the
    // column until the prose is gone again. By this step the hub has been rendered four
    // times in one session.
    for (const name of ['hub', 'hub-after-re-renders', 'confirm-abandon']) {
      const s = step(name);
      expect(s.scenery.inWrapper, `${name}: the reserved region is not in the reading column`).toBe(1);
      expect(
        s.scenery.inPage,
        `${name}: ${s.scenery.inPage} scenery frames in the page — they are accumulating`,
      ).toBe(1);
    }
    // ...and it is gone entirely on the screens that do not own it.
    for (const name of ['content-warning', 'title', 'settings', 'inventory']) {
      expect(step(name).scenery.inPage, `${name} mounts a scenery frame`).toBe(0);
    }
  });

  it('and it holds its committed ratio and its caps in the real page', () => {
    const hub = step('hub');
    const box = hub.scenery.box as Box;
    expect(Math.abs((hub.scenery.ratio as number) - SCENERY_RATIO)).toBeLessThan(0.01);
    expect(box.height).toBeLessThanOrEqual(SCENERY_CAP_VH * hub.viewport.height + SLACK);
    expect(box.width).toBeLessThanOrEqual(SCENERY_CAP_PX + SLACK);
    expect(box.height, 'the region collapsed in the real page').toBeGreaterThan(100);
  });

  it('THE REAL SETTINGS PATH moves the type scale, and the prose floor with it', () => {
    // Not a faked attribute: the walk clicked Settings, clicked Large, waited for the option
    // to report itself pressed, and clicked Back. If the setting were inert the scale would
    // not move, and a floor defined in `lh` would not move either.
    expect(step('hub').narration.fontSize, 'the default hub is not at the base step').toBe(
      BASE_PX.normal,
    );
    expect(
      step('hub-large-text').narration.fontSize,
      'the Large setting did not change the type scale — the setting is inert',
    ).toBe(BASE_PX.large);
    expect(step('hub-large-text').narration.lineHeight).toBeCloseTo(
      BASE_PX.large * NARRATION_LINE_HEIGHT,
      1,
    );
    expect(
      step('hub-large-text').narration.height,
      'the prose floor did not follow the text size',
    ).toBeGreaterThanOrEqual(proseFloorPx('side', 'large') - SLACK);
  });

  it('a document screen puts its document below the column, with the prose still readable', () => {
    for (const name of ['inventory', 'settings']) {
      const s = step(name);
      expect(s.documentPanels, `${name} rendered no document panel`).toBe(1);
      expect(s.choices.top, `${name}: the document is beside the column, not below it`)
        .toBeGreaterThanOrEqual(s.column.bottom - SLACK);
      expect(s.narration.height, `${name}: the prose behind the document is starved`)
        .toBeGreaterThanOrEqual(proseFloorPx('wide', 'normal') - SLACK);
      expect(s.choices.labels, `${name} has no way back`).toContain('Back');
    }
  });

  it('the abandon confirmation asks its question and offers both answers', () => {
    const s = step('confirm-abandon');
    expect(s.hubPromptVisible, 'the confirmation shows no question').toBe(true);
    expect(s.choices.controls, 'the confirmation does not offer exactly two answers').toBe(2);
    for (const b of s.buttons) {
      expect(b.bottom, 'an answer is below the fold').toBeLessThanOrEqual(
        s.viewport.height + SLACK,
      );
      expect(b.top).toBeGreaterThanOrEqual(-SLACK);
    }
  });

  it('nothing on the walk scrolls the page or the reading column', () => {
    for (const s of RESULT.phaseC.steps) {
      expect(
        s.page.scrollHeight,
        `${s.step}: the page scrolls (${s.page.scrollHeight} > ${s.page.clientHeight})`,
      ).toBeLessThanOrEqual(s.page.clientHeight + SLACK);
      expect(
        s.column.scrollHeight,
        `${s.step}: the reading column scrolls`,
      ).toBeLessThanOrEqual(s.column.clientHeight + SLACK);
      // The choice box itself always stays inside the window, on every screen, so whatever
      // is inside it is reachable by scrolling that box rather than the page.
      expect(s.choices.bottom, `${s.step}: the choice box runs past the window`)
        .toBeLessThanOrEqual(s.viewport.height + SLACK);
      expect(s.choices.top, `${s.step}: the choice box starts above the window`)
        .toBeGreaterThanOrEqual(-SLACK);
    }
  });

  it('and no ACTION list hides a control below the fold', () => {
    // The distinction the walk has to make, and it is the same one phase A makes. On an
    // action screen every control must be visible outright — a hidden Abandon is the defect
    // that shipped. On a DOCUMENT screen (a 19-row inventory, the settings screen) the
    // panel's own length legitimately exceeds the window; what matters there is that its box
    // is inside the window and scrolls, which the check above asserts for every step.
    const DOCUMENT_SCREENS = new Set(['inventory', 'settings', 'content-warning', 'title']);
    for (const s of RESULT.phaseC.steps) {
      if (DOCUMENT_SCREENS.has(s.screen)) continue;
      expect(s.buttons.length, `${s.step} rendered no controls`).toBeGreaterThan(0);
      for (const [i, b] of s.buttons.entries()) {
        expect(
          b.bottom,
          `${s.step}: control ${i} (${s.choices.labels[i] ?? '?'}) is below the fold`,
        ).toBeLessThanOrEqual(s.viewport.height + SLACK);
        expect(b.top, `${s.step}: control ${i} is above the window`).toBeGreaterThanOrEqual(-SLACK);
      }
      expect(
        s.choices.scrollHeight,
        `${s.step}: an action list scrolls at the default window size`,
      ).toBeLessThanOrEqual(s.choices.clientHeight + SLACK);
    }
    // Non-vacuity: some steps really were action screens with controls in them.
    const actions = RESULT.phaseC.steps.filter((s) => !DOCUMENT_SCREENS.has(s.screen));
    expect(actions.length, 'the walk visited no action screen').toBeGreaterThan(3);
  });

  it('and the keyboard never jumps backwards out of the prose', () => {
    for (const s of RESULT.phaseC.steps) {
      const lastColumn = s.focusOrder.lastIndexOf('column');
      const firstChoices = s.focusOrder.indexOf('choices');
      if (lastColumn < 0 || firstChoices < 0) continue;
      expect(
        lastColumn,
        `${s.step}: a control comes before a focusable in the reading column`,
      ).toBeLessThan(firstChoices);
    }
    // Non-vacuity for the walk's own focus data: every screen with controls reported them.
    expect(
      RESULT.phaseC.steps.filter((s) => s.focusOrder.includes('choices')).length,
      'no step reported a focusable in the choices — the focus scan read nothing',
    ).toBeGreaterThan(6);
  });
});

// =========================================================================================
// 8 — THE RENDERER'S OWN INSTRUMENTATION (CLAUDE.md principle 7).
//
// Collected from the real boot through the stub bridge's `log` channel, so these are the
// lines a player's log file would really contain.
// =========================================================================================

describe('the renderer records the layout it produced', () => {
  const logs = (): LogEntry[] => RESULT.phaseC.logs;

  it('the log channel really carried entries (or every check here is vacuous)', () => {
    expect(logs().length, 'the renderer forwarded no log entries at all').toBeGreaterThan(5);
  });

  it('it reports the viewport it got, as numbers', () => {
    // A run that goes wrong on a player's machine is unexplainable without this: every
    // layout promise the game makes is conditional on the window size, and until this unit
    // nothing recorded it.
    const line = logs().find((e) => e.category === 'render' && e.message === 'viewport');
    expect(line, 'the boot never recorded the viewport').toBeDefined();
    const data = line!.data as { width?: unknown; height?: unknown; dpr?: unknown };
    expect(typeof data.width, 'the width is not a number').toBe('number');
    expect(typeof data.height, 'the height is not a number').toBe('number');
    expect(typeof data.dpr, 'the display scale is not recorded').toBe('number');
    expect(data.width as number, 'the recorded width is not the real one').toBeGreaterThan(1000);
    expect(line!.level).toBe('info');
  });

  it('and it raises NO layout warning anywhere on the walk', () => {
    // ⭐ THE ONE THAT WOULD HAVE CAUGHT THE ESCAPE. On the layout that shipped, the hub in
    // this walk had prose in a zero-height pane and a choice box past the bottom of the
    // window — both of which `layoutWarnings` names. A clean walk is the assertion.
    const warnings = logs().filter((e) => e.category === 'render' && e.level === 'warn');
    expect(
      warnings.map((w) => `${w.message}: ${JSON.stringify(w.data)}`),
      'the renderer itself reports the layout is wrong',
    ).toEqual([]);
  });

  it('...and the warning path is reachable at all (not merely absent)', () => {
    // "No warnings" is worthless if nothing could ever produce one. The pure half is proved
    // in `layout.test.ts` over the exact number patterns the defect produced; this asserts
    // the renderer really wired that half in, so the silence above means something.
    const source = readFileSync(path.join(ROOT, 'src/desktop/game.ts'), 'utf8');
    expect(source, 'the renderer never computes layout warnings').toMatch(
      /layoutWarnings\s*\(/,
    );
    expect(source, 'a layout warning would never be logged').toMatch(/log\.warn\('render'/);
  });
});
