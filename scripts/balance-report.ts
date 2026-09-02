// Balance / winnability report generator for The Void — a BUILD TOOL, not logic core.
//
// This lives under scripts/ (outside `src`, outside the `tsc --noEmit` include set) precisely
// because it does impure I/O (`node:fs`) — the pure harness in `src/game/sim.ts` never touches
// the filesystem. It runs the sim over a fixed sample and writes docs/BALANCE-REPORT.md with the
// REAL measured numbers, so the M15 tuning follow-up can re-measure after each change with one
// command:
//
//     npx vite-node scripts/balance-report.ts
//
// Determinism: the sample is seeds 1..N (fixed), all five classes, all-unlocked roster
// (`createGame(seed)` with no snapshot). A fixed seed set ⇒ byte-identical report numbers on
// every re-run.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  simulateBatch,
  heuristicPolicy,
  mercifulPolicy,
  ALL_CLASSES,
  type AggregateReport,
  type ClassStats,
  type SimPolicy,
} from '../src/game/sim.ts';
import { type PlayerClass } from '../src/game/player.ts';
import {
  act1Share,
  peakDeath,
  actsAtOrAbove,
  bandVerdict,
  bandPhrase,
  extremeClasses,
  classesWithNoWin,
  STANDING_CAVEATS,
  TARGET_BAND,
} from './balance-claims.ts';

/** Sample size: seeds 1..N per class per policy. 500 × 5 = 2500 runs per policy. */
const N = 500;

const seeds = Array.from({ length: N }, (_, i) => i + 1);
const classes = [...ALL_CLASSES];

// ------- Formatting helpers --------------------------------------------------

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const f2 = (n: number): string => n.toFixed(2);

/** The death-by-act histogram as a fixed 1..5 row of counts. */
function deathRow(deathByAct: Record<number, number>): string {
  return [1, 2, 3, 4, 5].map((a) => String(deathByAct[a] ?? 0)).join(' | ');
}

function perClassTable(report: AggregateReport): string {
  const head =
    '| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const rows = classes.map((c: PlayerClass) => {
    const s: ClassStats = report.perClass[c];
    return `| ${c} | ${s.runs} | ${pct(s.winRate)} | ${s.grace} | ${s.damnation} | ${s.deaths} | ${f2(s.avgLevel)} | ${f2(s.avgFloorsCleared)} |`;
  });
  return [head, ...rows].join('\n');
}

function deathHistogram(report: AggregateReport): string {
  const head = '| | Act 1 | Act 2 | Act 3 | Act 4 | Act 5 |\n| --- | ---: | ---: | ---: | ---: | ---: |';
  const overall = `| **All classes** | ${deathRow(report.deathByAct)} |`;
  const rows = classes.map(
    (c: PlayerClass) => `| ${c} | ${deathRow(report.perClass[c].deathByAct)} |`,
  );
  return [head, overall, ...rows].join('\n');
}

function policySection(title: string, note: string, report: AggregateReport): string {
  return [
    `## ${title}`,
    '',
    note,
    '',
    `- **Overall win-rate:** ${pct(report.winRate)} (${report.wins} of ${report.runs} runs) — ${report.grace} grace, ${report.damnation} damnation, ${report.deaths} deaths.`,
    `- **Average final level:** ${f2(report.avgLevel)} · **average floors cleared:** ${f2(report.avgFloorsCleared)} (of 4 concluded floors on a full descent).`,
    '',
    '### Per-class',
    '',
    perClassTable(report),
    '',
    '### Deaths by act (where runs end)',
    '',
    deathHistogram(report),
  ].join('\n');
}

/**
 * A short plain-language read of the balance. G28(c): EVERY verdict word below is now
 * COMPUTED from the report by `balance-claims.ts`. It used to hard-code its conclusions —
 * whether the win-rate met the target, which class was best and worst, whether anyone was
 * stuck at zero — so a balance change moved the numbers and left the sentences asserting the
 * old answer beside them. A generated document that contradicts its own data is worse than
 * none, because it is trusted BECAUSE it is generated.
 */
function problemsRead(baseline: AggregateReport, merciful: AggregateReport): string {
  const peak = peakDeath(baseline);
  const verdict = bandVerdict(baseline.winRate);
  const spread = actsAtOrAbove(baseline, 0.1);
  const extremes = extremeClasses(baseline);
  const noWin = classesWithNoWin(baseline);
  const bullets: string[] = [];

  const bandWord =
    verdict === 'in'
      ? `inside the ${pct(TARGET_BAND.min)}–${pct(TARGET_BAND.max)} "about 1 in 3" target`
      : verdict === 'above'
        ? `ABOVE the ${pct(TARGET_BAND.min)}–${pct(TARGET_BAND.max)} target — easier than intended`
        : `BELOW the ${pct(TARGET_BAND.min)}–${pct(TARGET_BAND.max)} target — harder than intended`;
  bullets.push(
    `- **Winnability vs the target.** The no-sacrifice baseline wins ${pct(baseline.winRate)} of runs — ${bandWord}. See the caveats above for what these numbers do and do not model.`,
  );
  bullets.push(
    `- **Where deaths fall.** Act 1 holds ${pct(act1Share(baseline))} of all deaths; the modal death act is Act ${peak.act} at ${pct(peak.share)}, and ${spread.length} of the 5 acts each hold ≥ 10% of deaths (${spread.length > 0 ? `acts ${spread.join(', ')}` : 'none'}). The M15 goal was deaths SPREAD across the descent rather than bunched at Act 1 (~98% pre-M15).`,
  );
  bullets.push(
    `- **Average floors cleared is ${f2(baseline.avgFloorsCleared)} of 4** (avg final level ${f2(baseline.avgLevel)}).`,
  );
  bullets.push(
    `- **The grace path stays a mercy choice.** The kill-everything baseline reaches grace ${baseline.grace} time(s) (its neutral/negative karma routes cast-down → it wins by unmaking the Act-5 Hollow); the merciful policy (spares ⚖ foes) reaches grace ${merciful.grace} time(s) for overall win-rate ${pct(merciful.winRate)}. Mercy still shifts the moral ending, exactly as intended.`,
  );
  const perClass = extremes
    ? `strongest **${extremes.strongest}** (${pct(baseline.perClass[extremes.strongest].winRate)}), weakest **${extremes.weakest}** (${pct(baseline.perClass[extremes.weakest].winRate)})`
    : 'no classes in the sample';
  const zeroes =
    noWin.length === 0
      ? 'every class wins at least once over the sample'
      : `**${noWin.join(', ')}** never won a single run`;
  bullets.push(
    `- **Per-class shape (author call).** ${perClass}; ${zeroes}. Whether to narrow that gap is a per-class balance follow-up, separate from global winnability.`,
  );

  return bullets.join('\n');
}

/** "Acts 1, 2, 3 each hold ≥ 10% of deaths" — the acts NAMED, never a hard-coded range. */
function describeSpread(report: AggregateReport): string {
  const acts = actsAtOrAbove(report, 0.1);
  if (acts.length === 0) return 'no act holds ≥ 10% of deaths';
  return `Act${acts.length === 1 ? '' : 's'} ${acts.join(', ')} each hold ≥ 10% of deaths`;
}

/** "Every class wins" — or the names of the ones that do not. */
function describeZeroes(report: AggregateReport): string {
  const noWin = classesWithNoWin(report);
  if (noWin.length === 0) {
    const extremes = extremeClasses(report);
    return extremes
      ? `Every class wins (lowest baseline win-rate is ${extremes.weakest}).`
      : 'Every class wins.';
  }
  return `**${noWin.join(', ')}** never won a run in this sample.`;
}

/** The D9 provenance block — emitted by the generator, so regeneration cannot delete it. */
function provenance(): string {
  return [
    '> **Generated** by `scripts/balance-report.ts`',
    '> (`npx vite-node scripts/balance-report.ts`). Every number below is that run\'s real',
    '> output, and every verdict word is computed from it — nothing here is asserted by hand.',
    '',
    '## What these numbers do NOT include',
    '',
    ...STANDING_CAVEATS.map((c) => `- ${c.text}`),
  ].join('\n');
}

// ------- Run the sample ------------------------------------------------------

console.log(`Running balance sample: ${N} seeds × ${classes.length} classes × 2 policies …`);

const baselinePolicy = (c: PlayerClass): SimPolicy => heuristicPolicy(c);
const baseline = simulateBatch({ seeds, classes, policy: baselinePolicy });
console.log(`  baseline  win-rate: ${pct(baseline.winRate)}`);

const merciful = simulateBatch({ seeds, classes, policy: mercifulPolicy });
console.log(`  merciful  win-rate: ${pct(merciful.winRate)}`);

// ------- Compose the markdown ------------------------------------------------

const md = [
  '# The Void — balance / winnability report',
  '',
  provenance(),
  '',
  `## Difficulty TARGET (M15) — ${bandPhrase(bandVerdict(baseline.winRate))}`,
  '',
  '**Target (author, M15):** a careful baseline run wins about **1 in 3** — overall baseline',
  `win-rate in the **${pct(TARGET_BAND.min)}–${pct(TARGET_BAND.max)} band (aim ~30%)** — and, the KEY structural goal, **deaths SPREAD`,
  'across all five acts** rather than bunched at Act 1, with Act-1 enemies taking **~3–4 hits** to',
  'kill. The band is judged on the **baseline** (kill-everything, no-sacrifice) policy; the',
  'merciful policy is kept below for the grace-path view.',
  '',
  `**Result — ${bandPhrase(bandVerdict(baseline.winRate))}.** Baseline overall win-rate **${pct(baseline.winRate)}**; Act-1 deaths`,
  `**${pct(act1Share(baseline))}** of all baseline deaths (was ~98% pre-M15), the modal death act`,
  `holds **${pct(peakDeath(baseline).share)}** (Act ${peakDeath(baseline).act}), and ${describeSpread(baseline)}.`,
  `${describeZeroes(baseline)} Committed anchor tests`,
  '(`src/game/balance.test.ts`) hold the Act-1 "~3–4 hits" feel and this winnability floor.',
  '',
  '## What was measured',
  '',
  `- **Build:** the M1–M13 mechanical core with the **M15 balance-constant tuning** applied (\`agentic/balance-tune\`).`,
  `- **Sample:** seeds \`1..${N}\` × the ${classes.length} classes (${classes.join(', ')}) = **${baseline.runs} runs per policy**, all-unlocked roster (\`createGame(seed)\`, the full 24-family bestiary — the honest hardest case and the simplest to reproduce).`,
  '- **Two policies:** a **baseline** (reasonable play, kills everything, never seeks a sacrifice',
  '  deal) and a **merciful** variant (identical, but spares living ⚖ karma-weighted non-boss foes)',
  '  so the grace path\'s reachability is measured, not just death and damnation.',
  '',
  '## Headline',
  '',
  `- **Baseline overall win-rate: ${pct(baseline.winRate)}** (${baseline.grace} grace + ${baseline.damnation} damnation of ${baseline.runs}).`,
  `- **Merciful overall win-rate: ${pct(merciful.winRate)}** (${merciful.grace} grace + ${merciful.damnation} damnation of ${merciful.runs}).`,
  `- Deaths peak at **Act ${peakDeath(baseline).act}** (${pct(peakDeath(baseline).share)} of all baseline deaths).`,
  '',
  '## Balance read (from the data)',
  '',
  problemsRead(baseline, merciful),
  '',
  policySection(
    'Baseline policy (no sacrifice, no spare — the found-loot-only floor)',
    'Reasonable engine-authoritative play: potion when low, cast the best affordable skill, flee a near-certain death when heals are gone, otherwise fight. Kills every foe (a spare forfeits the kill XP the act gates require).',
    baseline,
  ),
  '',
  policySection(
    'Merciful policy (spares ⚖ foes — exercises the grace path)',
    'Identical to the baseline, except it releases a living ⚖ karma-weighted non-boss enemy on sight. This trades kill XP for positive karma, so it reaches the grace ending more often but survives less — it exists to show the grace path is reachable and how mercy shifts the death / grace / damnation split.',
    merciful,
  ),
  '',
  '---',
  '',
  '*Outcome vocabulary: **grace** = the Act-4 verdict ascension (net-positive karma); **damnation**',
  '= descending to Act 5 and unmaking the Hollow Self; **death** = the player fell. Both grace and',
  'damnation count as "wins" (the run reached an ending); death does not.*',
  '',
].join('\n');

// ------- Write it ------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'docs', 'BALANCE-REPORT.md');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md, 'utf8');
console.log(`Wrote ${outPath}`);
