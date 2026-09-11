// The balance report's MEASUREMENT — every simulated batch the document is rendered from.
//
// PURE and deterministic: fixed seeds 1..REPORT_SEEDS, all five classes, the all-unlocked roster,
// no clock, no filesystem. Shared by `balance-report.ts` (which writes the document) and the D9
// checks (`balance-report.*.test.ts`), so the writer and the checks can never measure two
// different things.
//
// ONE FUNCTION PER BATCH (fix round 2): the four batches are independent, so the checks run them
// in four test files, IN PARALLEL, rather than one after another in a single test that became the
// whole suite's critical path.
//
// The DC rows re-run the baseline with floor 2's DC INJECTED through `simulateBatch`'s
// `stepOptions` — `ILLUSION_DC` itself is never edited (§22.27 freezes it).
//
// THE SNAPSHOT. The generator also writes the measured inputs themselves next to the report
// (`docs/balance-report.inputs.json`): the cheap check renders the WHOLE document from them and
// requires it byte-for-byte, and each batch check re-measures its batch and requires it to equal
// the snapshot exactly. Every byte of the report and every number behind it is therefore checked.

import { simulateBatch, heuristicPolicy, mercifulPolicy, ALL_CLASSES, type AggregateReport, type SimPolicy } from '../src/game/sim.ts';
import { ILLUSION_DC } from '../src/game/floors.ts';
import { type PlayerClass } from '../src/game/player.ts';
import { REPORT_SEEDS, type ReportInput } from './balance-render.ts';

/** The DCs the sensitivity table measures beside the shipped one. */
export const SENSITIVITY_DCS: readonly number[] = [11, 15];

const seeds = (): number[] => Array.from({ length: REPORT_SEEDS }, (_, i) => i + 1);
const baselinePolicy = (c: PlayerClass): SimPolicy => heuristicPolicy(c);

/** The baseline batch (the careful kill-everything policy) — ~2,500 runs. */
export function measureBaseline(): AggregateReport {
  return simulateBatch({ seeds: seeds(), classes: [...ALL_CLASSES], policy: baselinePolicy });
}

/** The merciful batch (spares ⚖ foes). */
export function measureMerciful(): AggregateReport {
  return simulateBatch({ seeds: seeds(), classes: [...ALL_CLASSES], policy: mercifulPolicy });
}

/** The baseline re-run at an injected illusion DC. */
export function measureAtDc(dc: number): AggregateReport {
  return simulateBatch({ seeds: seeds(), classes: [...ALL_CLASSES], policy: baselinePolicy, stepOptions: { illusionDc: dc } });
}

/** Every batch the report needs (~12,500 runs), in order — PURE; `onBatch` is for progress lines. */
export function measureReportInput(onBatch: (label: string, winRate: number) => void = () => undefined): ReportInput {
  const baseline = measureBaseline();
  onBatch('baseline', baseline.winRate);
  const merciful = measureMerciful();
  onBatch('merciful', merciful.winRate);
  const dcRows = [{ dc: ILLUSION_DC, report: baseline }];
  for (const dc of SENSITIVITY_DCS) {
    const report = measureAtDc(dc);
    onBatch(`DC ${dc}`, report.winRate);
    dcRows.push({ dc, report });
  }
  return { n: REPORT_SEEDS, classes: [...ALL_CLASSES], baseline, merciful, dcRows, shippedDc: ILLUSION_DC };
}

// ------- The snapshot ------------------------------------------------------------

/** The measured inputs as committed next to the report. The shipped-DC row IS the baseline. */
export interface ReportSnapshot {
  n: number;
  classes: PlayerClass[];
  shippedDc: number;
  baseline: AggregateReport;
  merciful: AggregateReport;
  /** The re-measured baseline at each SENSITIVITY_DC, in that order. */
  sensitivity: { dc: number; report: AggregateReport }[];
}

/** Serialise the inputs — deterministic (fixed key order, two-space indent, trailing newline). */
export function toSnapshot(input: ReportInput): string {
  const snap: ReportSnapshot = {
    n: input.n,
    classes: input.classes,
    shippedDc: input.shippedDc,
    baseline: input.baseline,
    merciful: input.merciful,
    sensitivity: input.dcRows.filter((r) => r.dc !== input.shippedDc).map((r) => ({ dc: r.dc, report: r.report })),
  };
  return `${JSON.stringify(snap, null, 2)}\n`;
}

/** Rebuild the renderer's input from a snapshot, rows in the same order the writer measures them. */
export function fromSnapshot(json: string): ReportInput {
  const snap = JSON.parse(json) as ReportSnapshot;
  return {
    n: snap.n,
    classes: snap.classes,
    baseline: snap.baseline,
    merciful: snap.merciful,
    dcRows: [{ dc: snap.shippedDc, report: snap.baseline }, ...snap.sensitivity],
    shippedDc: snap.shippedDc,
  };
}
