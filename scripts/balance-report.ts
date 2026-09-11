// Balance / winnability report generator for The Void — a BUILD TOOL, not logic core.
//
// This lives under scripts/ (outside `src`, outside the `tsc --noEmit` include set) precisely
// because it does impure I/O (`node:fs`) — the pure harness in `src/game/sim.ts` never touches
// the filesystem. It MEASURES (`balance-measure.ts`, pure), RENDERS (`balance-render.ts`, pure)
// and WRITES — the only impure step is the last. Re-measure after any balance change with:
//
//     npx vite-node scripts/balance-report.ts
//
// Determinism: the sample is seeds 1..N (fixed), all five classes, all-unlocked roster
// (`createGame(seed)` with no snapshot). A fixed seed set => byte-identical report on every
// re-run — which `balance-render.test.ts` relies on: it re-measures and requires the committed
// document to be exactly this script's output (D9).

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderReport, REPORT_SEEDS } from './balance-render.ts';
import { measureReportInput, SENSITIVITY_DCS } from './balance-measure.ts';

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

console.log(
  `Running balance sample: ${REPORT_SEEDS} seeds × 5 classes × 2 policies + ${SENSITIVITY_DCS.length} DC rows …`,
);
const input = measureReportInput((label, winRate) => console.log(`  ${label.padEnd(9)} win-rate: ${pct(winRate)}`));
const md = renderReport(input);

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'docs', 'BALANCE-REPORT.md');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md, 'utf8');
console.log(`Wrote ${outPath}`);
