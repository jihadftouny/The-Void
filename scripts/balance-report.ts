// Balance / winnability report generator for The Void — a BUILD TOOL, not logic core.
//
// This lives under scripts/ (outside `src`, outside the `tsc --noEmit` include set) precisely
// because it does impure I/O (`node:fs`) — the pure harness in `src/game/sim.ts` never touches
// the filesystem. It MEASURES (runs the sim over a fixed sample) and WRITES; the markdown itself
// is rendered by the pure `balance-render.ts` (PLAN.md #2 split it out so it can be tested
// without 12,500 simulated runs). Re-measure after any balance change with one command:
//
//     npx vite-node scripts/balance-report.ts
//
// Determinism: the sample is seeds 1..N (fixed), all five classes, all-unlocked roster
// (`createGame(seed)` with no snapshot). A fixed seed set => byte-identical report numbers on
// every re-run.
//
// The DC table (PLAN.md #2, AC-27): the baseline is re-run with floor 2's DC INJECTED through
// `simulateBatch`'s `stepOptions` at 11 and 15 — `ILLUSION_DC` itself is never edited (§22.27
// freezes it; the author chooses from this evidence).

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simulateBatch, heuristicPolicy, mercifulPolicy, ALL_CLASSES, type SimPolicy } from '../src/game/sim.ts';
import { ILLUSION_DC } from '../src/game/floors.ts';
import { type PlayerClass } from '../src/game/player.ts';
import { renderReport, REPORT_SEEDS } from './balance-render.ts';

/** Sample size: seeds 1..N per class per policy (`REPORT_SEEDS`, shared with the staleness test). */
const N = REPORT_SEEDS;

/** The DCs the sensitivity table measures — the shipped one and one step either side. */
const SENSITIVITY_DCS = [11, 15] as const;

const seeds = Array.from({ length: N }, (_, i) => i + 1);
const classes = [...ALL_CLASSES];
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

console.log(`Running balance sample: ${N} seeds × ${classes.length} classes × 2 policies + ${SENSITIVITY_DCS.length} DC rows …`);

const baselinePolicy = (c: PlayerClass): SimPolicy => heuristicPolicy(c);
const baseline = simulateBatch({ seeds, classes, policy: baselinePolicy });
console.log(`  baseline  win-rate: ${pct(baseline.winRate)}`);

const merciful = simulateBatch({ seeds, classes, policy: mercifulPolicy });
console.log(`  merciful  win-rate: ${pct(merciful.winRate)}`);

const dcRows = [{ dc: ILLUSION_DC, report: baseline }];
for (const dc of SENSITIVITY_DCS) {
  const report = simulateBatch({ seeds, classes, policy: baselinePolicy, stepOptions: { illusionDc: dc } });
  console.log(`  DC ${dc}     win-rate: ${pct(report.winRate)}`);
  dcRows.push({ dc, report });
}

const md = renderReport({ n: N, classes, baseline, merciful, dcRows, shippedDc: ILLUSION_DC });

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'docs', 'BALANCE-REPORT.md');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md, 'utf8');
console.log(`Wrote ${outPath}`);
