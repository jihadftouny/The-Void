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
      'nothing here measures them.',
  },
  {
    id: 'two-healing-systems',
    text:
      '**Healing is deliberately over-supplied right now.** `STARTING_POTS` potions and the ' +
      'newly-droppable consumables both ship, because `GAME-DESIGN.md` §22.6\'s fold-in ' +
      'belongs to the balance re-run rather than to the unit that made consumables ' +
      'obtainable. Expect the game to feel too easy until that lands.',
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
