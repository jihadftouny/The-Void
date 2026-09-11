// The CLAIMS the balance report makes about its own numbers — pure, testable, and separate
// from the generator that prints them (FINDINGS.md G28(c)).
//
// WHY THIS FILE EXISTS. `scripts/balance-report.ts` measured the sim honestly and then wrote
// its VERDICTS by hand into the markdown: "Difficulty TARGET — SET (M15) and MET", "Result —
// MET", "Acts 1–4 each hold ≥ 10% of deaths", "Scavver … the strongest class", "Every class
// wins (lowest baseline win-rate is Neuromancer)". Every one of those is a claim ABOUT the
// data that is not DERIVED FROM the data — so the moment a balance change moved the numbers,
// the report went on asserting the old conclusion in the same breath as the new figures. A
// generated document that lies with a straight face is worse than no document, because it is
// trusted precisely BECAUSE it is generated.
//
// Everything here is a pure function of an already-measured report. Nothing runs the sim,
// nothing touches the filesystem, nothing reads a clock. Each takes the NARROWEST shape it
// needs rather than the whole `AggregateReport`, so its test fixtures can be built by hand
// and checked by hand.
//
// ⚠ RECORDED DEVIATION: `scripts/` is outside `tsconfig.json`'s include set, so this file and
// its test are NOT typechecked by `npm run typecheck`. That is the status quo for everything
// under `scripts/`, and widening the tsconfig would newly typecheck files that have never
// been checked — an unbounded risk inside a defect-fixing unit. Recorded as a gap, not fixed
// here. They ARE run by Vitest (`vite.config.ts` includes `scripts/**/*.test.ts`).

// ------- The death histogram ------------------------------------------------

/** The only part of a report the death claims read. */
export interface DeathShape {
  deaths: number;
  /** Deaths keyed by the act they happened in, 1..5. */
  deathByAct: Record<number, number>;
}

const ACTS = [1, 2, 3, 4, 5] as const;

/** Act-1's share of all deaths — the "bunching" metric. 0 when nobody died. */
export function act1Share(report: DeathShape): number {
  return report.deaths > 0 ? (report.deathByAct[1] ?? 0) / report.deaths : 0;
}

/**
 * The modal (most-common) death act and its share of all deaths. Ties resolve to the EARLIER
 * act, because the walk is in act order and only a strict `>` displaces the incumbent — so
 * the answer is deterministic, which a report has to be.
 */
export function peakDeath(report: DeathShape): { act: number; share: number } {
  let act = 1;
  let best = -1;
  for (const a of ACTS) {
    const n = report.deathByAct[a] ?? 0;
    if (n > best) {
      best = n;
      act = a;
    }
  }
  return { act, share: report.deaths > 0 ? best / report.deaths : 0 };
}

/** How many of the five acts each hold at least `minShare` of all deaths — the "spread". */
export function actsWithShare(report: DeathShape, minShare: number): number {
  if (report.deaths === 0) return 0;
  return ACTS.filter((a) => (report.deathByAct[a] ?? 0) / report.deaths >= minShare).length;
}

/** The acts that hold at least `minShare`, in order — for a report that wants to NAME them. */
export function actsAtOrAbove(report: DeathShape, minShare: number): number[] {
  if (report.deaths === 0) return [];
  return ACTS.filter((a) => (report.deathByAct[a] ?? 0) / report.deaths >= minShare);
}

// ------- The difficulty band -------------------------------------------------

/** The author's M15 difficulty target: a careful baseline run wins about 1 in 3. */
export const TARGET_BAND = { min: 0.25, max: 0.35 } as const;

/** Where a measured win-rate sits relative to the target band. */
export type BandVerdict = 'below' | 'in' | 'above';

/**
 * Judge a win-rate against the band — the claim the report used to hard-code as "MET".
 * The boundaries are INCLUSIVE, matching how the target is stated ("the 25–35% band").
 */
export function bandVerdict(
  winRate: number,
  band: { min: number; max: number } = TARGET_BAND,
): BandVerdict {
  if (winRate < band.min) return 'below';
  if (winRate > band.max) return 'above';
  return 'in';
}

/** The band verdict as the phrase the report prints. */
export function bandPhrase(verdict: BandVerdict): string {
  return verdict === 'in' ? 'MET' : verdict === 'above' ? 'ABOVE THE BAND' : 'BELOW THE BAND';
}

// ------- Per-class extremes --------------------------------------------------

/** The only part of a report the per-class claims read. */
export interface ClassShape<C extends string> {
  classes: C[];
  perClass: Record<C, { winRate: number; wins: number }>;
}

/**
 * The strongest and weakest classes by win-rate. Ties resolve to the class that appears
 * EARLIER in `classes` (the report's own canonical order), because only a strict comparison
 * displaces the incumbent — deterministic for a fixed roster.
 */
export function extremeClasses<C extends string>(
  report: ClassShape<C>,
): { strongest: C; weakest: C } | null {
  const [first] = report.classes;
  if (first === undefined) return null;
  let strongest = first;
  let weakest = first;
  for (const c of report.classes) {
    if (report.perClass[c].winRate > report.perClass[strongest].winRate) strongest = c;
    if (report.perClass[c].winRate < report.perClass[weakest].winRate) weakest = c;
  }
  return { strongest, weakest };
}

/** The classes that never won a single run — the claim "every class wins" is `[]`. */
export function classesWithNoWin<C extends string>(report: ClassShape<C>): C[] {
  return report.classes.filter((c) => report.perClass[c].wins === 0);
}

// ------- Provenance (D9) -----------------------------------------------------

/**
 * D9 — WHY THE CAVEATS LIVE IN CODE.
 *
 * `docs/BALANCE-REPORT.md` is GENERATED, and its own header says "Regenerate after any
 * balance change." A ⚠ INVALIDATED banner was added by hand to the OUTPUT, and the generator
 * did not emit it — so the next regeneration deleted it, and the report silently went back to
 * asserting a claim that had been falsified. Confirmed empirically: regenerating against a
 * backup produced byte-identical numbers and the ONLY difference was the deleted banner.
 *
 * The fix is structural, not a note asking people to be careful: a caveat that must survive
 * regeneration has to be EMITTED BY THE GENERATOR. Adding one is a code edit here, and a code
 * edit is reviewed, diffed and kept.
 *
 * Each entry is one standing limitation of what the harness can measure. They are NOT
 * findings about the balance — they are the boundary of what these numbers mean.
 */
export interface Caveat {
  /** The register row or ticket this limitation belongs to, for the reader to look up. */
  id: string;
  text: string;
}

export const STANDING_CAVEATS: readonly Caveat[] = [
  {
    id: 'equipment',
    text:
      '**Equipment is modelled by a greedy hub rule, OUTSIDE `step`.** `step` still has no ' +
      'equip input (#1.1), so the sim gears up at every hub visit through the same pure ' +
      '`equip` the UI calls: an empty slot takes anything, an occupied one only a strictly ' +
      'higher rarity. A generated weapon still swings the unarmed die plus its bonus ' +
      '(§22.20; #1 owns the fix), so found weapons are under-valued here exactly as in the game.',
  },
  {
    id: 'G48',
    text:
      '**Consumables: only healing is used.** The heuristic drinks a found `healSelf` item ' +
      'at <= 35% HP; every other consumable (cures, throwables, flee items) sits unused, so ' +
      'nothing here measures them. It takes every bargain not paid in HP, sheds its ' +
      'lowest-rarity gear when the pack is full, and never throws a usable away.',
  },
  {
    id: 'A1b',
    text:
      '**Potions are gone (§22.6).** Healing is a found consumable or a found rest; a fresh ' +
      'character carries a two-item starting kit (`STARTING_CONSUMABLES`) and a twelve-slot ' +
      'backpack (§22.17) that every heal competes for.',
  },
  {
    id: 'frozen',
    text:
      '**`ILLUSION_DC` and every per-class number are FROZEN (§22.27).** The tuning below ' +
      'moved only global knobs. The per-class gap and the floor-2 Wisdom gap are REPORTED, ' +
      'not closed: the three remedies are the author\'s, and the DC table is measured with the ' +
      'DC injected into the sim — the constant itself was never edited.',
  },
  {
    id: 'G9',
    text:
      '**Minutes are an ESTIMATE**, at a stated seconds-per-step constant ' +
      '(`SECONDS_PER_STEP`), not a measurement: no human has played these floors. The ' +
      'encounter, round and step counts beside them ARE measured.',
  },
  {
    id: 'D9',
    text:
      '**Do not hand-edit this file.** It is regenerated wholesale by the command above, and ' +
      'anything added here is silently destroyed the next time it runs — which is exactly ' +
      'how a ⚠ INVALIDATED banner was lost once already. To add a lasting caveat, add it to ' +
      '`STANDING_CAVEATS` in `scripts/balance-claims.ts`.',
  },
];


// ------- PLAN.md #2: the per-class ruling, the Wisdom gap, the DC sensitivity -------------

/** "About one run in three" — the reading of the target the callout measures classes against. */
export const ONE_IN_THREE = 1 / 3;

/** The only part of a report the weak-class callout reads. */
export interface WeakClassShape<C extends string> {
  classes: C[];
  perClass: Record<C, { winRate: number; deaths: number; deathByAct: Record<number, number> }>;
}

/** One class named by the callout: its win rate, and the share of its deaths floor 2 took. */
export interface WeakClass<C extends string> {
  classId: C;
  winRate: number;
  /** Deaths on floor 2 over all its deaths (on the descent, the act IS the floor); 0 if none. */
  floor2DeathShare: number;
}

/**
 * The classes furthest below one in three — AC-27's callout, computed, never hand-written.
 * Only classes strictly BELOW `target` qualify; they are ordered weakest first (ties by roster
 * order, so the sentence is reproducible), and at most `n` are returned.
 */
export function weakestClasses<C extends string>(
  report: WeakClassShape<C>,
  n: number,
  target: number = ONE_IN_THREE,
): WeakClass<C>[] {
  const below = report.classes
    .map((c, order) => ({ c, order, s: report.perClass[c] }))
    .filter(({ s }) => s.winRate < target);
  below.sort((a, b) => a.s.winRate - b.s.winRate || a.order - b.order);
  return below.slice(0, Math.max(0, n)).map(({ c, s }) => ({
    classId: c,
    winRate: s.winRate,
    floor2DeathShare: s.deaths > 0 ? (s.deathByAct[2] ?? 0) / s.deaths : 0,
  }));
}

/** The only part of a report the Wisdom-gap claim reads. */
export interface WisShape {
  perWisBucket: Record<'low' | 'mid' | 'high', { runs: number; winRate: number; floor2DeathShare: number }>;
}

/**
 * The floor-2 Wisdom gap, as the report states it: the win rate of the high-Wisdom bucket
 * (>= 14) minus the low one (<= 9), in PERCENTAGE POINTS, and the floor-2 death shares beside
 * them. `null` when either end bucket is empty (no claim rather than a wrong one).
 */
export function wisdomGap(report: WisShape): {
  lowWin: number;
  highWin: number;
  points: number;
  lowFloor2Share: number;
  highFloor2Share: number;
} | null {
  const { low, high } = report.perWisBucket;
  if (low.runs === 0 || high.runs === 0) return null;
  return {
    lowWin: low.winRate,
    highWin: high.winRate,
    points: (high.winRate - low.winRate) * 100,
    lowFloor2Share: low.floor2DeathShare,
    highFloor2Share: high.floor2DeathShare,
  };
}

/** One measured row of the DC table. */
export interface DcRow {
  dc: number;
  winRate: number;
}

/**
 * How much the baseline win rate moves across the measured DCs — the evidence for the author's
 * third remedy. `swing` is the win rate at the LOWEST DC minus the win rate at the HIGHEST, in
 * percentage points (positive = an easier DC wins more). `shipped` is the row at the shipped
 * DC, or null if it was not measured. `null` for fewer than two rows.
 */
export function illusionSensitivity(
  rows: readonly DcRow[],
  shippedDc: number,
): { lowest: DcRow; highest: DcRow; swing: number; shipped: DcRow | null } | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a.dc - b.dc);
  const lowest = sorted[0]!;
  const highest = sorted[sorted.length - 1]!;
  return {
    lowest,
    highest,
    swing: (lowest.winRate - highest.winRate) * 100,
    shipped: rows.find((r) => r.dc === shippedDc) ?? null,
  };
}

// ------- Floor length (G9) and the bargain rate (AC-22) -----------------------------------

/**
 * The seconds one step is ESTIMATED to take a human, for the minutes-per-floor estimate (G9).
 * A step is one beat: at the designed ~89 tokens/second a 2-4 sentence narration (~80 tokens)
 * streams in about a second, and reading it and choosing takes several more. 10 s is a stated
 * guess, labelled as one wherever it is used; the step COUNT it multiplies is measured.
 */
export const SECONDS_PER_STEP = 10;

/** Estimated minutes for `steps` steps at `secondsPerStep`. */
export function estimatedMinutes(steps: number, secondsPerStep: number = SECONDS_PER_STEP): number {
  return (steps * secondsPerStep) / 60;
}

/**
 * The share of a floor's ordinary encounters that are bargains, from its encounter WEIGHTS —
 * the data-derived expectation the measured bargain rate is set beside. Bosses are not drawn
 * from the table, so they are not in the denominator.
 */
export function bargainShare(weights: { battle: number; chest: number; rest: number; bargain: number }): number {
  const total = weights.battle + weights.chest + weights.rest + weights.bargain;
  return total > 0 ? weights.bargain / total : 0;
}

// ------- The tuning ledger (AC-28) — emitted by the generator, like the caveats (D9) -------

/**
 * One constant the balance re-run moved. The ledger lives in CODE for the same reason the
 * caveats do (D9): a table hand-added to the generated report would be deleted by the next
 * regeneration. The build appends a row each time it tunes; `balance-report.test.ts` holds
 * every row's `to` to the live constant, so the ledger cannot drift from the code.
 */
export interface TuningStep {
  /** T1, T2, ... in the order they were applied. */
  id: string;
  /** Where the knob lives. */
  knob: string;
  from: string;
  to: string;
  why: string;
  /** The measured effect on the report's baseline sample, stated when it was applied. */
  effect: string;
}

export const TUNING_LEDGER: readonly TuningStep[] = [
  {
    id: 'T1',
    knob: '`floors.json` rest weight, floors 2-5',
    from: '2',
    to: '1',
    why:
      'Rest is the main heal left after the potion fold-in (§22.6) and §22.26 makes its scarcity ' +
      'the floor weight; it now grows scarcer with depth. Floor 1 keeps 2 — a fresh pack is ' +
      'nearly empty there, and floor 1 already held the most deaths.',
    effect: 'baseline win rate 0.411 -> 0.345; act-1 death share 0.389 -> 0.350',
  },
  {
    id: 'T2',
    knob: '`ENEMY_HP_XP_DIV` (`enemy.ts`)',
    from: '8',
    to: '6',
    why:
      'M15 loosened it for a character who never equipped anything; the sim now equips found ' +
      'gear (G48), so part of that is taken back. A fresh act-1 enemy (xp 0) is untouched, so ' +
      'the hits-to-kill anchor does not move; the HP lands on floors 2-5.',
    effect: 'baseline win rate 0.345 -> 0.321; floor-1 deaths 573 -> 576',
  },
  {
    id: 'T3',
    knob: '`HOLLOW_GATE_XP` (`progression.ts`)',
    from: '500',
    to: '600',
    why:
      'Back to its first derived value: ~7.5 floor-5 kills, the length of floors 3 and 4 (7.9 and ' +
      '7.0 kills per cleared floor, measured). 500 ' +
      'existed only to clear the old 0.12 guard by a coincidence of the gearless sim, which no ' +
      'longer binds (AC-29). When applied, floor 5 killed ~1 arrival in 8 (106 of 871) — close ' +
      'to floor 2 (1 in 8.7), well below floors 3 (1 in 5.7) and 4 (1 in 2.8). (Corrected in fix ' +
      'round 1: an earlier text called floor 5 "the softest floor", from pre-tuning numbers.)',
    effect: 'baseline win rate 0.321 -> 0.306; floor-5 deaths 106 -> 142',
  },
];

/** The knobs this unit was forbidden to move, stated in the report beside the ledger. */
export const FROZEN_KNOBS: readonly string[] = [
  '`ILLUSION_DC` = 13 (§22.27, plan Appendix A.4) — measured at 11 and 15 below, never edited',
  'every per-class number: hit dice, class kits, starting gear, evasion',
  'the author\'s rulings: the illusion chance (one fight in three) and the floor-4 karma multiplier',
];
