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
import { HIGH_CONTRAST, TYPE, floorTheme, hexToRgb, relativeLuminance, themeVars } from '../render/tokens.ts';
import { DEFAULT_SETTINGS, TEXT_SCALE_TABLE, settingsVars } from '../render/settings-model.ts';
import { BEAT_HOLD_MS, BEAT_MS, MAX_ROUND_MS, MIN_SPACING_MS } from '../render/beat-model.ts';

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

/**
 * The prose floor, in lines, for each stage layout — `--void-prose-floor` in `game.css`.
 *
 * `stage` (PLAN.md #6) is FOUR, not eight, and that is a recorded deviation from UI-DESIGN §17:
 * the battle frame holds the enemy's 32vh region, its name, bar, chips and ticker above the
 * prose, and at a 640px window eight lines cannot fit beside all of that. Battle prose is a
 * bookend by design (UI-DESIGN §2); on the default window the pane grows past its floor.
 */
const PROSE_LINES = { side: 8, wide: 4, stage: 4 } as const;
type Mode = keyof typeof PROSE_LINES;

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
 * THE BATTLE FRAME'S NUMBERS (PLAN.md #6), each one a literal in the stylesheet or the data,
 * transcribed here and cross-checked against the text it came from — never read off a run.
 *
 *   ARENA_CAP_VH       `#arena .void-art-slot { max-height: 32vh }` in `battle.css`
 *   ENEMY_RATIO        the enemy slot's `ratioW / ratioH` in `artSlots.json` (3:4, LOCKED)
 *   STAGE_LOG_CAP_VH   `--void-log-cap: 18vh` in the `stage` block of `game.css`
 *   STAGE_LOG_LINES    `--void-log-floor: 2lh` there: the opened log's floor, in lines
 *   CHOICES_PAD_PX     `.choices { padding: var(--void-space-1) }` — SPACE.s1, 4px
 *   BATTLE_ROW_PAD_PX  a battle row's vertical padding + border: `padding: space-2` (8 + 8)
 *                      plus the `--void-rule-hair` border above and below (1 + 1)
 *   BATTLE_GAP_PX      `[data-layout='stage'] .battle-menu { gap: var(--void-space-2) }`, 8px
 */
const ARENA_CAP_VH = 0.32;
const ENEMY_RATIO = 3 / 4;
const STAGE_LOG_CAP_VH = 0.18;
const STAGE_LOG_LINES = 2;
const CHOICES_PAD_PX = 4;
const BATTLE_ROW_PAD_PX = 8 + 8 + 1 + 1;
const BATTLE_GAP_PX = 8;
/** `.stage-body { padding: calc(var(--void-space-5) - var(--void-space-1)) }` — 24 − 4. */
const STAGE_BODY_PAD_PX = 24 - 4;

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
function proseFloorPx(mode: Mode, scale: Scale): number {
  return PROSE_LINES[mode] * BASE_PX[scale] * NARRATION_LINE_HEIGHT;
}

/**
 * A round's replay length for `n` beats, re-derived from `beat-model.ts`'s four constants
 * (which `beat-model.test.ts` pins to the plan's numbers) rather than from its schedule.
 */
function scheduledMs(n: number): number {
  if (n <= 0) return 0;
  const spacing = n === 1 ? BEAT_MS : Math.max(MIN_SPACING_MS, Math.min(BEAT_MS, Math.floor((MAX_ROUND_MS - BEAT_HOLD_MS) / (n - 1))));
  return (n - 1) * spacing + BEAT_HOLD_MS;
}

/** One single-line battle row: a line of control text plus its padding and border. */
function battleRowPx(scale: Scale): number {
  return CONTROL_PX[scale] * BODY_LINE_HEIGHT + BATTLE_ROW_PAD_PX;
}

/**
 * THE ROOM #11 NEEDS (AC-17): its Talk row and a one-line text input, i.e. two battle rows and
 * the gap between them, above the first command — so the free-text input lands without a
 * re-layout. 84.3px at the default text size, 93.6 at large.
 */
function talkHeadroomPx(scale: Scale): number {
  return 2 * battleRowPx(scale) + BATTLE_GAP_PX;
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
  mode: Mode;
  prose: boolean;
  scenery: boolean;
}

const EXPECTED: Readonly<Record<string, Expectation>> = {
  hub: { mode: 'side', prose: true, scenery: true },
  'confirm-abandon': { mode: 'side', prose: true, scenery: true },
  // PLAN.md #6 — THE FRAMED STAGE. Seven battle states, each with the worst-case beat in the
  // pane, sixty log lines behind the ticker, a 44-character enemy name and six condition chips
  // on each side. They replace `battle` / `battle-open`, whose Cast list opened INLINE and put
  // 683-788px of content in a 555-558px box (layout-breathing-room's handover):
  //   battle                  the commands                          Fight Cast Spare Item Run
  //   battle-cast-open        the Cast sub-menu: Back + six warped skills (the longest labels)
  //   battle-items-open       the Use-item sub-menu: Back + one usable
  //   battle-items-open-full  Back + a FULL pack of twelve usables (BACKPACK_CAPACITY)
  //   battle-boss             a boss: no Spare, and Run DISABLED with its reason (G4, §14.9)
  //   battle-log-open         the player opened the full log from the ticker
  //   battle-tempo            the reserved tempo row PRESENT (#1.6's seam, measured before it lands)
  battle: { mode: 'stage', prose: true, scenery: false },
  'battle-cast-open': { mode: 'stage', prose: true, scenery: false },
  'battle-items-open': { mode: 'stage', prose: true, scenery: false },
  'battle-items-open-full': { mode: 'stage', prose: true, scenery: false },
  'battle-boss': { mode: 'stage', prose: true, scenery: false },
  'battle-log-open': { mode: 'stage', prose: true, scenery: false },
  'battle-tempo': { mode: 'stage', prose: true, scenery: false },
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
/** A region the battle frame adds, or `null` when the page has no such element at all. */
type Region = (Pane & { display: string }) | null;
/** Where the enemy's reserved region is, counted across the WHOLE page. */
interface EnemySlot {
  inPage: number;
  inArena: number;
  inSheet: number;
  box: Box | null;
  ratio: number | null;
}
interface Report {
  scenario: string;
  scale: Scale;
  screen: string;
  layout: string;
  viewport: { width: number; height: number };
  narration: Pane & { beats: number; lineHeight: number; fontSize: number };
  log: Pane & { lines: number; display: string };
  column: Pane;
  choices: Pane & { controls: number };
  scenery: { count: number; box: Box | null; ratio: number | null };
  buttons: Box[];
  /** Each control's label and whether it is disabled, in the same order as `buttons`. */
  buttonLabels: string[];
  buttonDisabled: boolean[];
  page: { scrollHeight: number; clientHeight: number };
  focusOrder: string[];
  fontLoaded: boolean;
  // ---- PLAN.md #6: the battle frame ----
  arena: Region;
  vitals: Region;
  sheet: Box & { display: string };
  stageBody: Box;
  enemySlot: EnemySlot;
  /** The ticker's line and its Record toggle, when the arena carries them. */
  ticker: { line: Box | null; toggles: number; expanded: string | null };
  /** The tempo rows the frame rendered (the reserved #1.6 slot). */
  tempoRows: number;
  /** `floor-looks`: the in-page paint audit — only on the paint pass's runs. */
  paint?: Paint;
}
/** One colour judgement made in the real cascade. */
interface Judged {
  ratio: number;
  path: string;
  color: string;
  background: string;
}
/** The paint audit of one run (`src/dev/layoutProbe.ts`'s `ProbePaint`). */
interface Paint {
  place: number;
  contrast: string;
  ground: string;
  body: { background: string; color: string };
  text: { samples: number; min: Judged | null; minBeat: number | null; exempt: number; unreadable: string[] };
  frames: { path: string; border: number; textureImage: boolean; textureOpacity: number; textureDisplay: string }[];
  battle: { floats: { tone: string; color: string; ratio: number }[]; tint: string; tintRatio: number } | null;
}
/** One timed floor-1 -> floor-2 re-theme. */
interface FadeRun {
  options: { motion: string; contrast: string };
  fadeMs: number;
  /** The settled floor-1 ground, read before the fade began. */
  from: string;
  /** The body's ground at t = 0, half-way, and after the fade — each with the time it was really taken. */
  samples: {
    at: number;
    background: string;
    /** The ground's own transition as Chromium runs it: whether it exists, has started, how far in. */
    phase: { exists: boolean; pending: boolean; startLag: number | null; progress: number | null };
  }[];
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
  // ---- PLAN.md #6: the battle frame, as the REAL renderer builds it ----
  arena: Region;
  vitals: Region;
  sheet: Box & { display: string };
  enemySlot: EnemySlot;
  ticker: { line: Box | null; text: string; toggles: number };
  /** The bars on the frame, by tone class, with their readouts — the round must move them. */
  bars: { tone: string; text: string }[];
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
  /** `floor-looks`: every scenario on every floor (and floor 2 under high contrast), audited. */
  paint: (Report & { paint: Paint })[];
  /** `floor-looks`: the timed floor-1 -> floor-2 re-theme, three ways. */
  fade: FadeRun[];
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
const STAGE_SCENARIOS = SCENARIOS.filter((s) => EXPECTED[s]!.mode === 'stage');

/**
 * The one stage state in which the READING COLUMN is allowed to hold more than it shows: the
 * player opened the full log (AC-15). Every other state is judged by the strict rule that the
 * column never scrolls; this one by its own bounded rule in the battle-frame section.
 */
const COLUMN_MAY_SCROLL: ReadonlySet<string> = new Set(['battle-log-open']);

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
          if (COLUMN_MAY_SCROLL.has(scenario)) continue; // judged by its own bounded rule
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
    // PLAN.md #6: the battle, with each sub-menu the player opens every fight, and the boss —
    // all under the strict standard. The Cast list used to open INLINE and push Run to y695
    // in a 640px window; as a sub-menu that REPLACES the commands it has to fit outright.
    'battle',
    'battle-cast-open',
    'battle-items-open',
    'battle-boss',
    'battle-log-open',
    'battle-tempo',
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
   * ⚠ `battle-open` LEFT THIS LIST WITH PLAN.md #6, and that is the point of #6's layout. The
   * inline Cast list put 683-788px of content in a 555-558px box and Run at y695 in a 640px
   * window; the Cast list is now a sub-menu that REPLACES the commands and fits outright
   * (`battle-cast-open` is in ALL_VISIBLE above).
   *
   * What remains is the one battle list that genuinely cannot fit: the Use-item sub-menu with a
   * FULL pack — twelve usables (BACKPACK_CAPACITY) plus Back is 13 rows, and 13 x 38px + 12 x
   * 8px of gaps is 590px in a 558px column at the default text size, more at large. The Back
   * row is the FIRST control and stays on screen; the rest scroll in the column's own box.
   *
   * ⚠ SO THE GUARANTEE IS NAMED AT BOTH ENDS, and neither half is taken on trust: the list
   * scrolls so everything is reachable, AND **the collapsed state restores every control to
   * the window** — asserted directly below against the `battle` scenario.
   */
  const EXPANDED_DISCLOSURE: readonly {
    scenario: string;
    collapsed: string;
    scale: Scale;
  }[] = [
    { scenario: 'battle-items-open-full', collapsed: 'battle', scale: 'normal' },
    { scenario: 'battle-items-open-full', collapsed: 'battle', scale: 'large' },
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
   *   battle                 PLAN.md #6: the commands are the WHOLE menu — Fight, Cast, Spare
   *                          (the fixture foe is karma-weighted and alive), Use item (one usable
   *                          in the pack), Run = 5; nothing hidden, because the sub-menus are
   *                          not built until opened. The Record toggle lives in the ARENA and is
   *                          not a choice.
   *   battle-cast-open       the Cast sub-menu REPLACES the commands: Back + the fixture's six
   *                          skills = 7.
   *   battle-items-open      Back + the one usable = 2.
   *   battle-items-open-full Back + twelve usables (a full pack, BACKPACK_CAPACITY) = 13.
   *   battle-boss            a boss is never karma-weighted, so no Spare: Fight, Cast, Use
   *                          item, Run = 4 — and Run is a DISABLED control, still laid out.
   *   battle-log-open        the commands again, 5: opening the log changes the column only.
   *   battle-tempo           the commands again, 5: the tempo row is vitals, not a control.
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
    battle: { visible: 5, hidden: 0 },
    'battle-cast-open': { visible: 7, hidden: 0 },
    'battle-items-open': { visible: 2, hidden: 0 },
    'battle-items-open-full': { visible: 13, hidden: 0 },
    'battle-boss': { visible: 4, hidden: 0 },
    'battle-log-open': { visible: 5, hidden: 0 },
    'battle-tempo': { visible: 5, hidden: 0 },
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
    //
    // RE-ANCHORED by PLAN.md #6: this used the battle screen, whose closed Cast and Use-item
    // pickers were the page's hidden controls. The battle's sub-menus now REPLACE the commands
    // and hide nothing, so the page that still carries a closed list — the full-pack bargain,
    // twelve leave rows inside one collapsed disclosure — carries the check.
    const discard = report(960, 640, 'deal-discard', 'normal');
    expect(discard.buttons.filter(laidOut).length, 'no control is laid out anywhere')
      .toBeGreaterThan(0);
    expect(
      discard.buttons.filter((b) => !laidOut(b)).length,
      'the closed list hides nothing — the discriminator has nothing to tell apart',
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

  it('in the battle frame: the arena, then the reading column, then the choices (AC-10)', () => {
    // The ticker's Record toggle is the arena's one focusable. It must come before the log it
    // opens and before the menu, so the keyboard walks the frame top-down, centre-first.
    const offenders: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of STAGE_SCENARIOS) {
        const order = report(width, height, scenario, 'normal').focusOrder;
        const lastArena = order.lastIndexOf('arena');
        const firstColumn = order.indexOf('column');
        const firstChoices = order.indexOf('choices');
        if (lastArena < 0) offenders.push(`${width}x${height} ${scenario}: nothing focusable in the arena`);
        if (firstColumn >= 0 && lastArena > firstColumn) {
          offenders.push(`${width}x${height} ${scenario}: the arena comes after the column: ${order.join(',')}`);
        }
        if (firstChoices >= 0 && lastArena > firstChoices) {
          offenders.push(`${width}x${height} ${scenario}: the arena comes after the choices: ${order.join(',')}`);
        }
      }
    }
    expect(offenders, 'the battle frame is out of reading order for the keyboard').toEqual([]);
  });
});

// =========================================================================================
// 5b — THE FRAMED STAGE (PLAN.md #6, UI-DESIGN.md §1). The enemy on a large framed stage in
// the centre; the stat box bottom-left; the action menu bottom-right; a thin ticker with the
// full log behind it. Every number below is arithmetic on the constants at the top of this
// file, which are themselves cross-checked against the stylesheet and the data.
// =========================================================================================

describe('the battle is a framed stage', () => {
  /** A region the frame needs, present and actually drawn — or a failure naming what is not. */
  function drawn(region: Region, what: string, where: string): Pane {
    expect(region, `${where}: the page has no ${what} at all`).not.toBeNull();
    expect(region!.display, `${where}: the ${what} is not displayed`).not.toBe('none');
    expect(region!.height, `${where}: the ${what} has no height`).toBeGreaterThan(SLACK);
    return region as Pane;
  }

  it('the four regions sit where §1 puts them, at every size and text setting (AC-10)', () => {
    const offenders: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of STAGE_SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          const where = `${width}x${height} ${scenario}/${scale}`;
          const arena = drawn(r.arena, 'arena', where);
          const vitals = drawn(r.vitals, 'stat box', where);
          const check = (ok: boolean, why: string): void => {
            if (!ok) offenders.push(`${where}: ${why}`);
          };
          check(arena.bottom <= r.column.top + SLACK, `the arena (to ${arena.bottom.toFixed(0)}) is not above the column (from ${r.column.top.toFixed(0)})`);
          check(Math.abs(arena.left - r.column.left) <= SLACK && Math.abs(arena.width - r.column.width) <= SLACK, 'the arena and the reading column are not the same middle column');
          check(vitals.right <= arena.left + SLACK, 'the stat box is not LEFT of the arena');
          check(r.choices.left >= arena.right - SLACK, 'the menu is not RIGHT of the arena');
          check(Math.abs(r.choices.top - arena.top) <= SLACK, 'the menu column does not start with the frame');
          check(Math.abs(r.choices.bottom - r.column.bottom) <= SLACK, 'the menu column does not end with the frame');
          check(Math.abs(vitals.bottom - r.column.bottom) <= SLACK, 'the stat box is not anchored to the bottom');
          check(r.sheet.display === 'none' && r.sheet.width <= SLACK, `the HUD column is still on screen (${r.sheet.width.toFixed(0)}px wide)`);
        }
      }
    }
    expect(offenders, 'the battle is not the frame UI-DESIGN §1 decided').toEqual([]);
  });

  it('outside the battle the frame is gone: no arena, no stat box, and the HUD is back', () => {
    for (const r of everyReport()) {
      if (EXPECTED[r.scenario]!.mode === 'stage') continue;
      const where = `${r.viewport.width}x${r.viewport.height} ${r.scenario}/${r.scale}`;
      for (const [what, region] of [['arena', r.arena], ['stat box', r.vitals]] as const) {
        if (region === null) continue;
        expect(region.display, `${where}: the ${what} is displayed off the battle screen`).toBe('none');
        expect(region.height, `${where}: the ${what} takes space off the battle screen`).toBeLessThanOrEqual(SLACK);
      }
      expect(r.sheet.display, `${where}: the HUD column is hidden off the battle screen`).not.toBe('none');
      expect(r.enemySlot.inPage, `${where}: an enemy region is mounted off the battle screen`).toBe(0);
    }
  });

  it("the enemy's region is in the arena: exactly one in the page, none in the HUD (AC-11)", () => {
    for (const r of everyReport()) {
      if (EXPECTED[r.scenario]!.mode !== 'stage') continue;
      const where = `${r.viewport.width}x${r.viewport.height} ${r.scenario}/${r.scale}`;
      expect(r.enemySlot.inPage, `${where}: ${r.enemySlot.inPage} enemy regions in the page`).toBe(1);
      expect(r.enemySlot.inArena, `${where}: the enemy region is not in the arena`).toBe(1);
      expect(r.enemySlot.inSheet, `${where}: the enemy region is still in the HUD`).toBe(0);
    }
  });

  it('it keeps the committed 3:4, never passes 32vh, and is centred on the stage (AC-11)', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of STAGE_SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          const where = `${width}x${height} ${scenario}/${scale}`;
          const slot = r.enemySlot.box;
          expect(slot, `${where}: no enemy region measured`).not.toBeNull();
          expect(
            Math.abs((r.enemySlot.ratio as number) - ENEMY_RATIO),
            `${where}: the enemy region is ${r.enemySlot.ratio}, not 3:4`,
          ).toBeLessThan(0.01);
          expect(slot!.height, `${where}: taller than ${ARENA_CAP_VH * 100}vh`).toBeLessThanOrEqual(
            ARENA_CAP_VH * height + SLACK,
          );
          expect(slot!.height, `${where}: the region collapsed`).toBeGreaterThan(100);
          const arena = r.arena as Pane;
          const off = Math.abs(slot!.left + slot!.width / 2 - (arena.left + arena.width / 2));
          expect(off, `${where}: the enemy is ${off.toFixed(1)}px off the stage's centre`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('the cap governs at the minimum window, and the region outgrows the HUD it left (AC-11)', () => {
    // 32vh of 640 is 204.8px; at the default window the region is wider than the 140px the
    // HUD column capped it at — the whole reason for moving it to the centre.
    const small = report(960, 640, 'battle', 'normal').enemySlot.box as Box;
    expect(small.height, 'the HEIGHT cap does not govern at the minimum window').toBeCloseTo(ARENA_CAP_VH * 640, 0);
    const roomy = report(1100, 820, 'battle', 'normal').enemySlot.box as Box;
    expect(roomy.width, 'the stage figure is no bigger than the HUD slot it replaced').toBeGreaterThanOrEqual(190);
  });

  it('ARENA_CAP_VH is the literal in battle.css, and ENEMY_RATIO is the data (no invented numbers)', () => {
    const css = readFileSync(path.join(ROOT, 'src/desktop/battle.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /#arena\s+\.void-art-slot\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'battle.css does not cap the enemy region through #arena').not.toBeNull();
    expect(rule![1], 'the enemy region cap is not the 32vh literal this file mirrors').toMatch(
      new RegExp(`max-height:\\s*${ARENA_CAP_VH * 100}vh`),
    );
    const data = JSON.parse(readFileSync(path.join(ROOT, 'src/data/artSlots.json'), 'utf8')) as {
      slots: { id: string; ratioW: number; ratioH: number }[];
    };
    const enemy = data.slots.find((s) => s.id === 'enemy');
    expect(enemy, 'the enemy slot is gone from the data').toBeDefined();
    expect(enemy!.ratioW / enemy!.ratioH).toBe(ENEMY_RATIO);
  });

  it(`the prose keeps ${PROSE_LINES.stage} lines in every battle state, with the log closed (AC-13)`, () => {
    const starved: string[] = [];
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of STAGE_SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          const floor = proseFloorPx('stage', scale) - SLACK;
          if (r.narration.height < floor) {
            starved.push(`${width}x${height} ${scenario}/${scale}: ${r.narration.height.toFixed(1)}px, needs ${floor.toFixed(1)}`);
          }
        }
      }
    }
    expect(starved, 'the battle frame starves the prose').toEqual([]);
    // Non-vacuity: the pane really holds the worst-case beat, which is longer than the floor.
    const r = report(960, 640, 'battle', 'normal');
    expect(r.narration.beats).toBe(1);
    expect(r.narration.scrollHeight).toBeGreaterThan(proseFloorPx('stage', 'normal'));
  });

  it('the full log is closed behind the ticker unless the player opens it (AC-18)', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scenario of STAGE_SCENARIOS) {
        for (const scale of SCALES) {
          const r = report(width, height, scenario, scale);
          const where = `${width}x${height} ${scenario}/${scale}`;
          expect(r.log.lines, `${where}: the log is not holding the fight's sixty lines`).toBe(60);
          expect(r.ticker.toggles, `${where}: not exactly one Record toggle`).toBe(1);
          if (scenario === 'battle-log-open') {
            expect(r.ticker.expanded, `${where}: the open toggle does not say so`).toBe('true');
            continue;
          }
          expect(r.ticker.expanded, `${where}: the closed toggle does not say so`).toBe('false');
          expect(r.log.display, `${where}: the log is open without being asked`).toBe('none');
          expect(r.log.height).toBeLessThanOrEqual(SLACK);
        }
      }
    }
  });

  it('opened, the log is bounded: two lines at least, 18vh at most, scrolling inside its cap (AC-15)', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scale of SCALES) {
        const r = report(width, height, 'battle-log-open', scale);
        const where = `${width}x${height} battle-log-open/${scale}`;
        expect(r.log.display, `${where}: the opened log is not shown`).not.toBe('none');
        expect(r.log.height, `${where}: the opened log is squeezed below two lines`).toBeGreaterThanOrEqual(
          STAGE_LOG_LINES * BASE_PX[scale] * BODY_LINE_HEIGHT - SLACK,
        );
        expect(r.log.height, `${where}: the opened log passes its 18vh cap`).toBeLessThanOrEqual(
          STAGE_LOG_CAP_VH * height + SLACK,
        );
        expect(r.log.scrollHeight, `${where}: sixty lines fit — the cap is not being tested`).toBeGreaterThan(
          r.log.clientHeight,
        );
        // ...and the reading column's BOX stays inside the window whatever it holds.
        expect(r.column.bottom, `${where}: the column runs past the window`).toBeLessThanOrEqual(height + SLACK);
        expect(r.narration.height, `${where}: opening the log starved the prose`).toBeGreaterThanOrEqual(
          proseFloorPx('stage', scale) - SLACK,
        );
      }
    }
    // COLLAPSING RESTORES EVERYTHING: the closed twin is the plain battle, already judged
    // under the strict standard (ALL_VISIBLE, and the column-never-scrolls rule).
    expect(COLUMN_MAY_SCROLL.has('battle')).toBe(false);
  });

  it('the ticker is one line inside the arena (AC-18)', () => {
    for (const [width, height] of AT_OR_ABOVE_MIN) {
      for (const scale of SCALES) {
        const r = report(width, height, 'battle', scale);
        const where = `${width}x${height}/${scale}`;
        const line = r.ticker.line;
        expect(line, `${where}: no ticker line`).not.toBeNull();
        const arena = r.arena as Pane;
        expect(line!.top >= arena.top - SLACK && line!.bottom <= arena.bottom + SLACK, `${where}: the ticker is outside the arena`).toBe(true);
        // One line of the ticker's own step (sm), never two: a long combat line is cut, not wrapped.
        const oneLine = Number.parseFloat(TEXT_SCALE_TABLE[scale].sm) * BODY_LINE_HEIGHT;
        expect(line!.height, `${where}: the ticker is ${line!.height.toFixed(1)}px — more than one line`).toBeLessThan(
          oneLine * 1.5,
        );
        expect(line!.height, `${where}: the ticker collapsed`).toBeGreaterThan(oneLine * 0.5);
      }
    }
  });

  it("the menu is bottom-anchored, with room above it for #11's talk row and input (AC-17)", () => {
    const offenders: string[] = [];
    for (const scenario of ['battle', 'battle-boss']) {
      for (const scale of SCALES) {
        const r = report(960, 640, scenario, scale);
        const where = `${scenario}/${scale}`;
        const rows = r.buttons.filter((b) => b.height > 0);
        const first = rows[0] as Box;
        const last = rows.at(-1) as Box;
        const headroom = first.top - (r.choices.top + CHOICES_PAD_PX);
        if (headroom < talkHeadroomPx(scale) - SLACK) {
          offenders.push(`${where}: ${headroom.toFixed(1)}px above the first command, needs ${talkHeadroomPx(scale).toFixed(1)}`);
        }
        // NON-VACUOUS: the room must be ABOVE a menu that sits at the bottom. A top-anchored
        // menu with space below it has the same free height and none of it where #11 needs it.
        if (r.choices.bottom - last.bottom > CHOICES_PAD_PX + SLACK) {
          offenders.push(`${where}: the menu is not bottom-anchored (${(r.choices.bottom - last.bottom).toFixed(1)}px below the last command)`);
        }
      }
    }
    expect(offenders, 'the menu column has no room for the talk input #11 adds').toEqual([]);
  });

  it('the battle rows are compact single lines, and the disabled Run is still a laid-out control', () => {
    for (const scale of SCALES) {
      const r = report(960, 640, 'battle', scale);
      for (const [i, b] of r.buttons.entries()) {
        expect(b.height, `battle/${scale} row ${i} is not one compact line`).toBeCloseTo(battleRowPx(scale), 0);
      }
      const boss = report(960, 640, 'battle-boss', scale);
      expect(boss.buttonLabels, `battle-boss/${scale}: a boss can be spared`).not.toContain('Spare');
      const run = boss.buttonLabels.findIndex((l) => l.startsWith('Run'));
      expect(run, `battle-boss/${scale}: the Run row is gone rather than disabled (§14.9)`).toBeGreaterThan(-1);
      expect(boss.buttonDisabled[run], `battle-boss/${scale}: Run is live against a boss`).toBe(true);
      expect(boss.buttons[run]!.height, `battle-boss/${scale}: the disabled Run collapsed`).toBeGreaterThanOrEqual(
        CONTROL_PX[scale] * BODY_LINE_HEIGHT - SLACK,
      );
    }
  });

  it("the reserved tempo row fits the frame, and nothing renders it while there is no tempo (#1.6)", () => {
    for (const r of everyReport()) {
      if (EXPECTED[r.scenario]!.mode !== 'stage') continue;
      const where = `${r.viewport.width}x${r.viewport.height} ${r.scenario}/${r.scale}`;
      expect(r.tempoRows, `${where}: the tempo rows rendered`).toBe(r.scenario === 'battle-tempo' ? 2 : 0);
    }
    // The fit itself is the strict standard: `battle-tempo` is in ALL_VISIBLE, and the prose
    // floor above runs over every stage scenario including it.
  });

  it('below the breakpoint the frame STACKS: arena, then the prose, then the stat box and the menu', () => {
    // Unreachable in the shipped build (the window minimum is 960 wide); measured so the
    // fallback principle 6 asks for is not dead code nobody has rendered. The art region is
    // the first thing to go, as the scenery's is.
    for (const scale of SCALES) {
      const r = report(800, 600, 'battle', scale);
      const arena = r.arena as Pane;
      const vitals = r.vitals as Pane;
      expect(arena.bottom, `${scale}: the arena is not above the prose`).toBeLessThanOrEqual(r.column.top + SLACK);
      expect(r.choices.top, `${scale}: the menu is not below the prose`).toBeGreaterThanOrEqual(r.column.bottom - SLACK);
      expect(vitals.top, `${scale}: the stat box is not below the prose`).toBeGreaterThanOrEqual(r.column.bottom - SLACK);
      // THE HORIZONTAL HALF, found by mutation: without the stacked values the grid kept its
      // three full-width columns and still put everything in the right ROWS — with the menu
      // stranded mid-screen beside an empty column. So: the arena and the prose share one full
      // width, and beneath them the stat box takes the left edge and the menu the right.
      expect(Math.abs(arena.width - r.column.width), `${scale}: the arena and the prose are not one width`).toBeLessThanOrEqual(SLACK);
      // ...and that width is the WHOLE frame: the column runs from the stage body's inner left
      // edge to its inner right edge (`.stage-body { padding: calc(space-5 − space-1) }`, 20px),
      // so no empty column can sit beyond the menu.
      expect(Math.abs(r.column.left - (r.stageBody.left + STAGE_BODY_PAD_PX)), `${scale}: the prose does not start at the frame's edge`).toBeLessThanOrEqual(SLACK);
      expect(Math.abs(r.column.right - (r.stageBody.right - STAGE_BODY_PAD_PX)), `${scale}: the frame has an empty column beyond the menu`).toBeLessThanOrEqual(SLACK);
      expect(Math.abs(vitals.left - r.column.left), `${scale}: the stat box is not at the left edge`).toBeLessThanOrEqual(SLACK);
      expect(Math.abs(r.choices.right - r.column.right), `${scale}: the menu is not at the right edge`).toBeLessThanOrEqual(SLACK);
      expect(vitals.right, `${scale}: the stat box and the menu overlap`).toBeLessThanOrEqual(r.choices.left + SLACK);
      expect((r.enemySlot.box as Box).height, `${scale}: the art region still takes space when stacked`).toBeLessThanOrEqual(SLACK);
      expect(r.narration.height, `${scale}: the stacked frame starves the prose`).toBeGreaterThanOrEqual(
        proseFloorPx('stage', scale) - SLACK,
      );
    }
  });

  /**
   * How much of the narration the player can SEE: its box, clipped by the reading column's.
   * The narration keeps its floor as a MIN-HEIGHT, so its own box can measure a full floor while
   * the column holding it has been squeezed to its padding and scrolls it out of view — which
   * is exactly what an open Cast list did to the stacked frame (the narration measured 102px
   * inside an 8px column). Measuring the narration's box alone could not see that.
   */
  function visibleProse(r: Report): number {
    return Math.max(0, Math.min(r.narration.bottom, r.column.bottom) - Math.max(r.narration.top, r.column.top));
  }

  /**
   * ONE MEASURED LIMIT, recorded rather than smoothed over (UI-DESIGN §17). The reserved tempo
   * gauge (#1.6) adds a row to the arena AND to the stat box, and the stat box does not scroll;
   * at 800x600 with LARGE text the fixed parts then leave ~98px — three lines, not four. The
   * state is not rendered by anything today (no engine tempo yet) and the fallback is
   * unreachable in the shipped build; the unit that turns the gauge on decides its stacked
   * form. Held to three lines so it cannot quietly get worse.
   */
  const STACKED_THREE_LINES: ReadonlySet<string> = new Set(['battle-tempo/large']);

  it('below the breakpoint NO battle state hides the prose: the floor is visible, not merely laid out', () => {
    const hidden: string[] = [];
    for (const scenario of STAGE_SCENARIOS) {
      for (const scale of SCALES) {
        const r = report(800, 600, scenario, scale);
        const where = `800x600 ${scenario}/${scale}`;
        const lines = STACKED_THREE_LINES.has(`${scenario}/${scale}`) ? 3 : PROSE_LINES.stage;
        const floor = lines * BASE_PX[scale] * NARRATION_LINE_HEIGHT - SLACK;
        const seen = visibleProse(r);
        if (seen < floor) hidden.push(`${where}: ${seen.toFixed(1)}px of prose visible, needs ${floor.toFixed(1)}`);
        // The menu yields instead: its box stays inside the window and its first control is on
        // screen — the standard the full pack's Use-item list already holds at the minimum.
        if (r.choices.bottom > 600 + SLACK) hidden.push(`${where}: the menu box runs past the window (${r.choices.bottom.toFixed(1)})`);
        const first = r.buttons.find((b) => b.height > 0);
        if (!first || first.top < r.choices.top - SLACK || first.bottom > r.choices.bottom + SLACK) {
          hidden.push(`${where}: the menu's first control is not inside its box`);
        }
      }
    }
    expect(hidden, 'the stacked frame hides the prose behind a tall menu').toEqual([]);
    // Non-vacuity: every battle state was measured, and the helper measures a real overlap.
    expect(STAGE_SCENARIOS.length).toBeGreaterThanOrEqual(7);
    expect(visibleProse(report(960, 640, 'battle', 'normal'))).toBeGreaterThanOrEqual(proseFloorPx('stage', 'normal') - SLACK);
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
// confirmation — and, since PLAN.md #6, on down the descent into a real fight — at the default
// window size.
//
// WHY IT IS NOT REDUNDANT. The driver in `src/dev/layoutProbe.ts` still MIRRORS one structure
// the renderer builds inline — the `.hub-menu` wrapper around `hubMenu`'s rows. (The battle
// control list was mirrored too until #6; the battle scenarios now make the renderer's own
// builder calls, so what remains to check there is that the renderer really makes them — the
// real battle's rows are compared with the probe's below.) A mirror can drift from the thing it
// mirrors, and a drifted mirror is a test that carefully measures a page the game never shows.
// This is the other end of that coupling, and the two are compared against each other below.
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
      // PLAN.md #6: back out of the confirmation, descend until a REAL fight opens, open its
      // Cast menu, then swing once — the renderer's own battle, not the probe's fixture.
      'battle',
      'battle-cast-open',
      'battle-after-round',
    ]);
  });

  it('after a REAL round the frame is whole: the ticker speaks, the bars stand, nothing stacked', () => {
    const s = step('battle-after-round');
    expect(s.layout, 'the round left the stage').toBe('stage');
    expect(s.ticker.text.length, 'the ticker carries no line after a round').toBeGreaterThan(0);
    // The foe's bar, the player's HP and charges — rebuilt from the engine's final state.
    expect(s.bars.map((b) => b.tone)).toEqual(['void-bar-foe', 'void-bar-hp', 'void-bar-accent']);
    for (const b of s.bars) expect(b.text, `a ${b.tone} bar has no readout`).toMatch(/^\d+\/\d+$/);
    // The replay mounted a frame of its own and the rebuild replaced it: still exactly one.
    expect(s.enemySlot.inPage, 'the replay left a second enemy region on the page').toBe(1);
    expect(s.enemySlot.inSheet).toBe(0);
    expect(s.choices.labels, 'the commands did not come back after the round').toContain('Fight');
  });

  it('and the renderer logged the round it played, timed, with every beat', () => {
    // AC-19 / AC-31, from the renderer's OWN log channel. The duration is at least the
    // schedule for that many beats (re-derived here from the four constants) and far below
    // the round threshold.
    const rounds = RESULT.phaseC.logs.filter((e) => e.category === 'battle' && e.message === 'round played');
    expect(rounds.length, 'no round was logged — the replay never ran').toBeGreaterThan(0);
    for (const r of rounds) {
      const data = r.data as { beats: number; ms: number; motion: string; hooks: string[] };
      expect(data.beats, 'a round with no beats was replayed').toBeGreaterThanOrEqual(1);
      expect(data.ms, `a ${data.beats}-beat round took less than its schedule`).toBeGreaterThanOrEqual(scheduledMs(data.beats) - 5);
      expect(data.ms, 'a round took longer than the slow threshold').toBeLessThan(3000);
      expect(['full', 'reduced']).toContain(data.motion);
      expect(Array.isArray(data.hooks)).toBe(true);
    }
  });

  it('the REAL battle is the framed stage: the arena holds the enemy, and the HUD is gone', () => {
    for (const name of ['battle', 'battle-cast-open']) {
      const s = step(name);
      expect(s.layout, `${name} is not in the stage layout`).toBe('stage');
      expect(s.arena, `${name}: the real page has no arena`).not.toBeNull();
      expect(s.arena!.height, `${name}: the arena is empty`).toBeGreaterThan(100);
      expect(s.enemySlot.inPage, `${name}: ${s.enemySlot.inPage} enemy regions in the page`).toBe(1);
      expect(s.enemySlot.inArena, `${name}: the enemy region is not in the arena`).toBe(1);
      expect(s.enemySlot.inSheet, `${name}: the enemy region is still in the HUD`).toBe(0);
      expect(s.sheet.display, `${name}: the HUD column is still drawn in battle`).toBe('none');
      expect(Math.abs((s.enemySlot.ratio as number) - ENEMY_RATIO), `${name}: not 3:4`).toBeLessThan(0.01);
      expect(s.ticker.toggles, `${name}: not exactly one Record toggle`).toBe(1);
      expect(s.vitals, `${name}: no stat box`).not.toBeNull();
      expect(s.vitals!.height, `${name}: the stat box is empty`).toBeGreaterThan(40);
    }
  });

  it('Cast opens a sub-menu that REPLACES the commands, with a way back', () => {
    const commands = step('battle').choices.labels;
    const cast = step('battle-cast-open').choices.labels;
    expect(commands, 'the real battle offers no Fight').toContain('Fight');
    expect(commands, 'the real battle offers no Cast').toContain('Cast');
    expect(cast[0], 'the Cast sub-menu does not lead with Back').toBe('Back');
    expect(cast, 'the commands are still on screen under the Cast list').not.toContain('Fight');
    // An Enforcer starts with two castable skills (classKit `coreSkills`), so Back + 2.
    expect(cast.length, 'the Cast list does not hold the starting kit').toBe(3);
  });

  it('the rows the RENDERER builds are the rows the probe measured (anti-drift)', () => {
    // The probe's battle fixture is built by the same builders the renderer calls; this is
    // the other end, checked in the real page: a real single-line command is exactly one
    // compact battle row tall, the height every fold and headroom number above assumes.
    const real = step('battle');
    for (const [i, b] of real.buttons.entries()) {
      expect(b.height, `real battle row ${i} (${real.choices.labels[i]}) is not one compact row`).toBeCloseTo(
        battleRowPx('normal'),
        0,
      );
    }
    const mirrored = report(1100, 820, 'battle', 'normal');
    expect(Math.abs((real.buttons[0] as Box).height - (mirrored.buttons[0] as Box).height)).toBeLessThan(1);
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
      ['battle', 'stage'],
      ['battle-cast-open', 'stage'],
      ['battle-after-round', 'stage'],
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
    for (const name of ['content-warning', 'title', 'settings', 'inventory', 'battle', 'battle-cast-open', 'battle-after-round']) {
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

// =========================================================================================
// 9 — `floor-looks` (2026-09-12): THE WHITE-OUT, AND EVERY SCREEN ON IT.
//
// Floor 2 became the game's only LIGHT floor (the author's decision, `ART-BIBLE.md` §4, revised
// 2026-09-12). Two things about that can only be seen in the real page, in the real Chromium:
//
//   1. THE FADE. Walking in from the dark Undercity must be a 1200 ms dissolve, never a one-frame
//      snap from near-black to white — the harm "blinding" names, for exactly the players the
//      reduced-motion setting exists for. The mechanism is registered colour tokens transitioned
//      on `:root`; if the bundler dropped an `@property`, or a custom property silently refused to
//      interpolate, the page would snap and every source scan would still pass. So the ground is
//      SAMPLED while the dissolve runs: dark at first, in between at the midpoint, white at the end.
//   2. THE PAINT. Every token that was tuned for near-black is a chance to render dark-on-white.
//      The audit reads every glyph against the surface the real cascade put under it, on all five
//      floors and on floor 2 under high contrast.
//
// Expected colours are the TOKENS, converted independently (`hexToRgb`) — never read off a run.
// =========================================================================================

/** The dissolve the plan designed, in ms. `tokens.test.ts` pins `RETHEME_FADE_MS` to this number. */
const FADE_MS = 1200;

/** A token hex as Chromium serialises an opaque computed colour. */
function rgbOf(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

/** A computed `rgb(r, g, b)` back to a hex, so the anchored WCAG luminance can be taken of it. */
function hexOf(css: string): string {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (!m) throw new Error(`not a computed rgb colour: ${css}`);
  return `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
}

type Sample = FadeRun['samples'][number];

describe('the re-theme into floor 2 FADES — sampled in real Chromium while it runs (AC-12)', () => {
  const FLOOR_1 = floorTheme(0).bg; // the Undercity's near-black
  const FLOOR_2 = floorTheme(1).bg; // the Entrance to the Void's white
  const fade = (motion: string, contrast: string): FadeRun => {
    const found = RESULT.fade.find((f) => f.options.motion === motion && f.options.contrast === contrast);
    if (!found) throw new Error(`no ${motion}/${contrast} fade was measured`);
    return found;
  };
  const samples = (f: FadeRun): [Sample, Sample, Sample] => {
    expect(f.samples, 'a fade was not sampled three times').toHaveLength(3);
    return f.samples as [Sample, Sample, Sample];
  };

  it('the pass ran all three fades, and the midpoint really was taken mid-fade', () => {
    expect(RESULT.fade, 'a fade run is missing').toHaveLength(3);
    for (const f of RESULT.fade) {
      expect(f.fadeMs, 'the driver samples a different dissolve than the one designed').toBe(FADE_MS);
      const [start, mid, end] = samples(f);
      expect(start.at).toBe(0);
      // A starved timer would take the "midpoint" after the fade had ended and read the end colour
      // — the in-between check below would then judge nothing. So the real times are asserted.
      expect(mid.at, 'the midpoint sample came early').toBeGreaterThanOrEqual(FADE_MS / 2 - 1);
      expect(mid.at, `the midpoint sample was taken at ${mid.at.toFixed(0)} ms — too late to be mid-fade`).toBeLessThan(
        FADE_MS * 0.85,
      );
      expect(end.at, 'the last sample was taken before the fade could have ended').toBeGreaterThanOrEqual(FADE_MS + 100);
    }
  });

  for (const motion of ['full', 'reduce'] as const) {
    const label =
      motion === 'full' ? 'normal motion' : 'REDUCED motion (a dissolve moves nothing — it is the anti-flash)';
    it(`${label}: dark at first, in between at the midpoint, white at the end`, () => {
      const f = fade(motion, 'normal');
      const [start, mid, end] = samples(f);
      expect(f.from, 'floor 1 was not what the page showed before the fade').toBe(rgbOf(FLOOR_1));
      expect(start.background, 'the ground SNAPPED: at t = 0 it is already not floor 1').toBe(rgbOf(FLOOR_1));
      // In between, by luminance, and by a real margin — 10% of the span from EITHER end, so a
      // fade that reached 99% of white in the first frame and idled is not "in between".
      const l1 = relativeLuminance(FLOOR_1);
      const l2 = relativeLuminance(FLOOR_2);
      const lm = relativeLuminance(hexOf(mid.background));
      const margin = 0.1 * (l2 - l1);
      expect(lm, `half-way through, the ground is ${mid.background} — still the dark floor`).toBeGreaterThan(l1 + margin);
      expect(lm, `half-way through, the ground is ${mid.background} — already the white`).toBeLessThan(l2 - margin);
      expect(end.background, 'the dissolve never arrived at floor 2').toBe(rgbOf(FLOOR_2));
    });
  }

  it('the dissolve STARTS at once — not a quarter of the way through its own duration', () => {
    // A transition begins on the first frame after it is created. The fade page is an offscreen
    // window rendering at 60 Hz, as a player's window does, so the ground's transition must exist
    // and have started by the midpoint, within a quarter of the fade. (In a never-shown window it
    // sat pending for 611 ms — measured, and the reason the fade page is offscreen.)
    for (const motion of ['full', 'reduce'] as const) {
      const [start, mid] = samples(fade(motion, 'normal'));
      expect(start.phase.exists, `${motion}: no transition on the ground at all — it snapped`).toBe(true);
      expect(mid.phase.pending, `${motion}: the dissolve had still not started at the midpoint`).toBe(false);
      expect(mid.phase.startLag, `${motion}: the dissolve never started`).not.toBeNull();
      expect(mid.phase.startLag!, `${motion}: the dissolve started ${mid.phase.startLag} ms late`).toBeLessThan(FADE_MS / 4);
    }
  });

  it('HIGH CONTRAST: black at every sample — no white-out ever reaches the screen', () => {
    const f = fade('full', 'high');
    const black = rgbOf(HIGH_CONTRAST.bg);
    expect(black).toBe('rgb(0, 0, 0)');
    expect(f.from).toBe(black);
    for (const s of samples(f)) {
      expect(s.background, `at ${s.at.toFixed(0)} ms the ground was ${s.background}`).toBe(black);
      // Not merely black when sampled: the ground never had anything to dissolve. The theme wrote
      // floor 2's white and the settings overwrote it with black before any style was computed.
      expect(s.phase.exists, `at ${s.at.toFixed(0)} ms the ground was dissolving under high contrast`).toBe(false);
    }
  });
});

describe('every screen is readable on every floor, in the real cascade (AC-13, AC-14)', () => {
  /** The paint pass's floors, transcribed from the plan — five floors, then floor 2 in high contrast. */
  const FLOORS = [
    { place: 0, contrast: 'normal' },
    { place: 1, contrast: 'normal' },
    { place: 2, contrast: 'normal' },
    { place: 3, contrast: 'normal' },
    { place: 4, contrast: 'normal' },
    { place: 1, contrast: 'high' },
  ] as const;
  /** Floor 2, the Entrance to the Void — the ONE light floor. */
  const LIGHT_PLACE = 1;
  /** WCAG 2.x AA for text; AAA for body prose, the standard the palette holds itself to. */
  const AA = 4.5;
  const AAA = 7;
  const where = (r: { scenario: string; paint: Paint }): string =>
    `${r.scenario} on place ${r.paint.place} (${r.paint.contrast} contrast)`;
  const audited = (scenario: string, floor: (typeof FLOORS)[number]): Report & { paint: Paint } => {
    const found = RESULT.paint.find(
      (r) => r.scenario === scenario && r.paint.place === floor.place && r.paint.contrast === floor.contrast,
    );
    if (!found) throw new Error(`${scenario} was never audited on place ${floor.place}/${floor.contrast}`);
    return found;
  };
  /** The tokens as the two appliers leave them on the root: the theme, then the settings over it. */
  const painted = (place: number, contrast: string): Record<string, string> => ({
    ...themeVars(place),
    ...settingsVars({ ...DEFAULT_SETTINGS, contrast: contrast === 'high' ? 'high' : 'normal' }, place),
  });

  it('the pass audited every scenario on every floor (a dropped pass is a failure)', () => {
    expect(RESULT.paint.length).toBe(SCENARIOS.length * FLOORS.length);
    for (const scenario of SCENARIOS) for (const floor of FLOORS) expect(audited(scenario, floor).paint).toBeDefined();
  });

  it('the body is painted with the floor’s own ground and ink, and data-ground says which it is', () => {
    for (const r of RESULT.paint) {
      const { place, contrast } = r.paint;
      const high = contrast === 'high';
      expect(r.paint.body.background, where(r)).toBe(rgbOf(high ? HIGH_CONTRAST.bg : floorTheme(place).bg));
      expect(r.paint.body.color, where(r)).toBe(rgbOf(high ? HIGH_CONTRAST.ink : floorTheme(place).ink));
      // The PAINTED ground: light on floor 2 only, and dark again under high contrast.
      expect(r.paint.ground, where(r)).toBe(place === LIGHT_PLACE && !high ? 'light' : 'dark');
    }
  });

  it('every glyph clears AA against the surface it is really drawn on, and body prose clears AAA', () => {
    const failures: string[] = [];
    for (const r of RESULT.paint) {
      expect(r.paint.text.unreadable, `${where(r)}: a colour the audit could not read`).toEqual([]);
      const min = r.paint.text.min;
      if (!min || min.ratio < AA) {
        failures.push(
          min
            ? `${where(r)}: ${min.ratio.toFixed(2)}:1 — ${min.path} (${min.color} on ${min.background})`
            : `${where(r)}: no glyph judged at all`,
        );
      }
      if (EXPECTED[r.scenario]!.prose) {
        const beat = r.paint.text.minBeat;
        if (beat === null || beat < AAA) failures.push(`${where(r)}: the prose is at ${beat?.toFixed(2) ?? 'nothing'}:1`);
      } else {
        expect(r.paint.text.minBeat, `${where(r)} judged prose on a screen that has none`).toBeNull();
      }
    }
    expect(failures, 'text the player cannot read').toEqual([]);
  });

  it('...and the audit really judged the page: every control, the prose and the floor tag (non-vacuity)', () => {
    for (const r of RESULT.paint) {
      // Every laid-out control carries its label as text; so does the floor tag; so does the beat.
      // Judged or exempt, each must have been SEEN — an audit that skipped them would pass on nothing.
      const controls = r.buttons.filter((b) => b.width > 0 && b.height > 0).length;
      const seen = r.paint.text.samples + r.paint.text.exempt;
      const least = controls + 1 + (EXPECTED[r.scenario]!.prose ? 1 : 0);
      expect(seen, `${where(r)}: ${seen} glyph-bearing elements, fewer than its controls, tag and prose`).toBeGreaterThanOrEqual(
        least,
      );
      // THE EXEMPTION IS BOUNDED, not merely named: it holds exactly the laid-out DISABLED
      // controls (the combat log's dice lines sit closed in every scenario). A widened list —
      // exempting every button, say — would hide the worst glyph on every floor and pass above.
      const disabled = r.buttons.filter((b, i) => r.buttonDisabled[i] && b.width > 0 && b.height > 0).length;
      expect(r.paint.text.exempt, `${where(r)}: the exemption holds more than the disabled controls`).toBe(disabled);
    }
    for (const floor of FLOORS) {
      // The hub: sixty log lines, five menu rows and the beat — 66 at the very least.
      expect(audited('hub', floor).paint.text.samples).toBeGreaterThanOrEqual(60 + 5 + 1);
      // The exemption is bounded AND exercised: the boss fight's greyed Run is a member of it.
      expect(audited('battle-boss', floor).paint.text.exempt).toBeGreaterThan(0);
    }
  });

  it('every art frame has a hairline and carries the floor’s own atmosphere at the floor’s own alpha (AC-14)', () => {
    for (const r of RESULT.paint) {
      const expected = EXPECTED[r.scenario]!;
      const framed = expected.scenery || expected.mode === 'stage';
      expect(r.paint.frames.length > 0, `${where(r)}: ${r.paint.frames.length} art frames`).toBe(framed);
      for (const frame of r.paint.frames) {
        // 1.1:1 — the hairline EXISTS (the plan's figures: 1.1-1.3 on the dark floors, 1.36 on
        // floor 2). It is a rule, not a black line, which is why it is not held to a text ratio.
        expect(frame.border, `${where(r)}: ${frame.path} has no visible edge`).toBeGreaterThanOrEqual(1.1);
        expect(frame.textureImage, `${where(r)}: ${frame.path}'s atmosphere paints nothing`).toBe(true);
        if (r.paint.contrast === 'high') {
          expect(frame.textureDisplay, `${where(r)}: high contrast left the atmosphere in the frame`).toBe('none');
          expect(frame.textureOpacity).toBe(0);
        } else {
          expect(frame.textureDisplay, where(r)).not.toBe('none');
          expect(frame.textureOpacity, `${where(r)}: the frame's atmosphere is not at the floor's alpha`).toBeCloseTo(
            floorTheme(r.paint.place).texture.opacity,
            5,
          );
        }
      }
    }
  });

  it('on the battle stage the floats and the strike tint are the floor’s own role colours, readable on its panel (AC-14)', () => {
    for (const r of RESULT.paint) {
      if (EXPECTED[r.scenario]!.mode !== 'stage') {
        expect(r.paint.battle, `${where(r)} read a battle frame outside a fight`).toBeNull();
        continue;
      }
      const battle = r.paint.battle;
      expect(battle, `${where(r)}: no battle frame to read`).not.toBeNull();
      const vars = painted(r.paint.place, r.paint.contrast);
      const want: Record<string, string | undefined> = {
        harm: vars['--void-harm'],
        heal: vars['--void-heal'],
        plain: vars['--void-ink'],
      };
      expect(battle!.floats.map((f) => f.tone)).toEqual(['harm', 'heal', 'plain']);
      for (const f of battle!.floats) {
        expect(f.color, `${where(r)}: the ${f.tone} float is not the floor's own colour`).toBe(rgbOf(want[f.tone]!));
        expect(f.ratio, `${where(r)}: the ${f.tone} float is ${f.ratio.toFixed(2)}:1 on the arena panel`).toBeGreaterThanOrEqual(AA);
      }
      expect(battle!.tint, `${where(r)}: the reduced-motion strike tint is not the floor's harm`).toBe(rgbOf(vars['--void-harm']!));
      expect(battle!.tintRatio, `${where(r)}: the strike tint is ${battle!.tintRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    }
  });
});
