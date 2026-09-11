// The balance report's MEASUREMENT — every simulated batch the document is rendered from.
//
// PURE and deterministic: fixed seeds 1..REPORT_SEEDS, all five classes, the all-unlocked roster,
// no clock, no filesystem. Shared by `balance-report.ts` (which writes the document) and
// `balance-render.test.ts` (which re-measures and requires the COMMITTED document to be exactly
// what these batches render — FIX ROUND 1, the D9 check widened to the whole report). One
// function, so the writer and the check can never measure two different things.
//
// The DC rows re-run the baseline with floor 2's DC INJECTED through `simulateBatch`'s
// `stepOptions` — `ILLUSION_DC` itself is never edited (§22.27 freezes it).

import { simulateBatch, heuristicPolicy, mercifulPolicy, ALL_CLASSES, type SimPolicy } from '../src/game/sim.ts';
import { ILLUSION_DC } from '../src/game/floors.ts';
import { type PlayerClass } from '../src/game/player.ts';
import { REPORT_SEEDS, type ReportInput } from './balance-render.ts';

/** The DCs the sensitivity table measures beside the shipped one. */
export const SENSITIVITY_DCS: readonly number[] = [11, 15];

/** Run every batch the report needs (~12,500 simulated runs) — PURE; `onBatch` is for progress lines. */
export function measureReportInput(onBatch: (label: string, winRate: number) => void = () => undefined): ReportInput {
  const seeds = Array.from({ length: REPORT_SEEDS }, (_, i) => i + 1);
  const classes = [...ALL_CLASSES];
  const baselinePolicy = (c: PlayerClass): SimPolicy => heuristicPolicy(c);

  const baseline = simulateBatch({ seeds, classes, policy: baselinePolicy });
  onBatch('baseline', baseline.winRate);
  const merciful = simulateBatch({ seeds, classes, policy: mercifulPolicy });
  onBatch('merciful', merciful.winRate);

  const dcRows = [{ dc: ILLUSION_DC, report: baseline }];
  for (const dc of SENSITIVITY_DCS) {
    const report = simulateBatch({ seeds, classes, policy: baselinePolicy, stepOptions: { illusionDc: dc } });
    onBatch(`DC ${dc}`, report.winRate);
    dcRows.push({ dc, report });
  }
  return { n: REPORT_SEEDS, classes, baseline, merciful, dcRows, shippedDc: ILLUSION_DC };
}
