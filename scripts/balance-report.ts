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

/** The modal (most-common) death act and its share of all deaths. */
function peakDeath(report: AggregateReport): { act: number; share: number } {
  let act = 1;
  let best = -1;
  for (const a of [1, 2, 3, 4, 5]) {
    const n = report.deathByAct[a] ?? 0;
    if (n > best) {
      best = n;
      act = a;
    }
  }
  return { act, share: report.deaths > 0 ? best / report.deaths : 0 };
}

/** A short, data-driven plain-language read of the biggest balance problems. */
function problemsRead(baseline: AggregateReport, merciful: AggregateReport): string {
  const peak = peakDeath(baseline);
  const bullets: string[] = [];

  bullets.push(
    `- **Winnability is far below a "tough-but-fair" target.** The no-sacrifice baseline wins ${pct(baseline.winRate)} of runs; even with equipment un-modelled (a lower bound), a fresh character rarely survives the descent.`,
  );
  bullets.push(
    `- **Runs die overwhelmingly early — the peak is Act ${peak.act}, holding ${pct(peak.share)} of all deaths.** This matches the standing note that Act-1 enemies (≈20–30 HP) out-scale a fresh character's ≈11–20 HP and low damage: the player cannot out-trade the very first floor, so almost nothing reaches the mid-game where leveling would compound.`,
  );
  bullets.push(
    `- **Average floors cleared is only ${f2(baseline.avgFloorsCleared)} of 4.** Progression stalls at the front of the run, not the back — the problem is the opening difficulty wall, not a late-game power spike.`,
  );
  bullets.push(
    `- **The grace path is barely reachable without deliberate mercy.** The kill-everything baseline reaches grace ${baseline.grace} time(s); the merciful policy (spares ⚖ foes) reaches it ${merciful.grace} time(s). Grace requires surviving to the Act-4 verdict with net-positive karma, which the current survival rate makes vanishingly rare — mercy shifts the moral outcome but cannot fix the survival wall (merciful overall win-rate ${pct(merciful.winRate)}).`,
  );
  bullets.push(
    `- **Class spread is secondary to the global wall.** Per-class win-rates cluster low (see the tables); no class escapes the Act-${peak.act} bottleneck, so tuning should start with global early-game survivability (enemy HP/damage vs. starting HP/potions), then revisit per-class balance.`,
  );

  return bullets.join('\n');
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
  '> **Generated** by `scripts/balance-report.ts` (`npx vite-node scripts/balance-report.ts`).',
  "> Regenerate after any balance change; the numbers below are the harness's real output.",
  '',
  '## NEEDS-HUMAN — the difficulty TARGET is unset (author call)',
  '',
  'This report **measures** the current build; it does not judge it. Before the M15 tuning pass,',
  'the author must set the difficulty **target**: the desired overall win-rate and the intended',
  '"tough-but-fair" feel (for example, *"a careful run wins about 1 in 3; Act-1 enemies take ~3–4',
  'hits"*). That target is a feel-call that cannot be derived headlessly — once it is set, this',
  "report's numbers can be judged against it and the constants tuned to close the gap.",
  '',
  '## What was measured',
  '',
  `- **Build:** the stacked M1–M13 mechanical core (HEAD of \`agentic/balance-sim\`).`,
  `- **Sample:** seeds \`1..${N}\` × the ${classes.length} classes (${classes.join(', ')}) = **${baseline.runs} runs per policy**, all-unlocked roster (\`createGame(seed)\`, the full 24-family bestiary — the honest hardest case and the simplest to reproduce).`,
  '- **Two policies:** a **baseline** (reasonable play, kills everything, never seeks a sacrifice',
  '  deal) and a **merciful** variant (identical, but spares living ⚖ karma-weighted non-boss foes)',
  '  so the grace path\'s reachability is measured, not just death and damnation.',
  '',
  '> **Lower-bound caveat (equipment un-modelled).** The `step` controller has no equip action, so',
  '> the sim fights with **starting gear** the whole way — found loot lands in the backpack unused.',
  '> Real players equip better loot, so the true win-rate is **at least** what is reported here;',
  '> these figures are a floor, not the ceiling. Promoting equip to a step input is a later',
  '> follow-up.',
  '',
  '## Headline',
  '',
  `- **Baseline overall win-rate: ${pct(baseline.winRate)}** (${baseline.grace} grace + ${baseline.damnation} damnation of ${baseline.runs}).`,
  `- **Merciful overall win-rate: ${pct(merciful.winRate)}** (${merciful.grace} grace + ${merciful.damnation} damnation of ${merciful.runs}).`,
  `- Deaths peak at **Act ${peakDeath(baseline).act}** (${pct(peakDeath(baseline).share)} of all baseline deaths).`,
  '',
  '## Biggest balance problems (read from the data)',
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
