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
interface ProbeResult {
  chrome: string;
  electron: string;
  phaseA: SizeGroup[];
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
    expect(r.choices.controls, 'the hub menu has no rows').toBe(6);
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
  it('it is really mounted on the hub, and nowhere else', () => {
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
  /** Screens whose choice area is a short list: every control must be visible outright. */
  const ALL_VISIBLE = ['hub', 'confirm-abandon', 'battle', 'choose-class', 'draft-pick', 'title'];

  it('no button is clipped or below the fold, at either text size', () => {
    const offenders: string[] = [];
    for (const scenario of ALL_VISIBLE) {
      for (const scale of SCALES) {
        const r = report(960, 640, scenario, scale);
        expect(r.buttons.length, `${scenario}/${scale} rendered no controls`).toBeGreaterThan(0);
        for (const [i, b] of r.buttons.entries()) {
          if (b.top < -SLACK || b.bottom > 640 + SLACK) {
            offenders.push(
              `${scenario}/${scale} control ${i}: ${b.top.toFixed(0)}..${b.bottom.toFixed(0)} ` +
                'is outside a 640px window',
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

  it('with the Cast list open the first control stays visible and the rest scroll into reach', () => {
    // The one screen where the choice list legitimately outgrows the window. The requirement
    // is not "it all fits" — it is "nothing is unreachable".
    for (const scale of SCALES) {
      const r = report(960, 640, 'battle-open', scale);
      const first = r.buttons[0] as Box;
      expect(first.top, `${scale}: the first battle control is above the window`).toBeGreaterThanOrEqual(-SLACK);
      expect(first.bottom, `${scale}: the first battle control is clipped`).toBeLessThanOrEqual(640 + SLACK);
      expect(r.choices.bottom, `${scale}: the choice box overflows the window`).toBeLessThanOrEqual(640 + SLACK);
      expect(
        r.choices.scrollHeight,
        `${scale}: the open Cast list fits, so this case no longer tests reachability`,
      ).toBeGreaterThan(r.choices.clientHeight);
    }
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
    expect(order.filter((r) => r === 'choices').length).toBeGreaterThanOrEqual(6);
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
