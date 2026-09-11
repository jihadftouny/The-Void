// The balance report's MARKDOWN — a pure function of already-measured reports (PLAN.md #2).
//
// Split out of `balance-report.ts` so the document can be rendered, and tested, without running
// 12,500 simulated runs: `balance-report.ts` measures and writes; this file only formats. Every
// verdict word is computed by `balance-claims.ts` (G28(c)); every standing caveat and every
// tuning-ledger row is EMITTED here from code (D9), so regenerating can never delete one.
//
// Imports only pure modules. No `fs`, no clock, no sim run.

import type { AggregateReport, ClassStats, FloorCounters } from '../src/game/sim.ts';
import type { PlayerClass } from '../src/game/player.ts';
import { FLOOR_IDS, floorDef, type FloorId } from '../src/game/floors.ts';
import {
  act1Share,
  peakDeath,
  actsAtOrAbove,
  bandVerdict,
  bandPhrase,
  extremeClasses,
  classesWithNoWin,
  weakestClasses,
  wisdomGap,
  illusionSensitivity,
  estimatedMinutes,
  bargainShare,
  SECONDS_PER_STEP,
  STANDING_CAVEATS,
  TARGET_BAND,
  TUNING_LEDGER,
  FROZEN_KNOBS,
} from './balance-claims.ts';

/** The report's sample: seeds 1..REPORT_SEEDS per class per policy (500 × 5 = 2,500 runs). */
export const REPORT_SEEDS = 500;

/** Everything the document is rendered from — all of it measured by `balance-report.ts`. */
export interface ReportInput {
  /** Seeds per class per policy (the sample is seeds 1..n). */
  n: number;
  classes: PlayerClass[];
  baseline: AggregateReport;
  merciful: AggregateReport;
  /** The baseline re-measured with the illusion DC injected — one row per DC, the shipped one included. */
  dcRows: readonly { dc: number; report: AggregateReport }[];
  shippedDc: number;
}

// ------- Formatting helpers --------------------------------------------------

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const f1 = (n: number): string => n.toFixed(1);
const f2 = (n: number): string => n.toFixed(2);
const per = (a: number, b: number): number => (b > 0 ? a / b : 0);

/** The death-by-floor histogram as a fixed 1..5 row of counts (on the descent, act = floor). */
function deathRow(deathByAct: Record<number, number>): string {
  return [1, 2, 3, 4, 5].map((a) => String(deathByAct[a] ?? 0)).join(' | ');
}

/** The per-class win table — exported: the staleness test compares it with a fresh run. */
export function perClassTable(report: AggregateReport, classes: readonly PlayerClass[]): string {
  const head =
    '| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const rows = classes.map((c) => {
    const s: ClassStats = report.perClass[c];
    return `| ${c} | ${s.runs} | ${pct(s.winRate)} | ${s.grace} | ${s.damnation} | ${s.deaths} | ${f2(s.avgLevel)} | ${f2(s.avgFloorsCleared)} |`;
  });
  return [head, ...rows].join('\n');
}

function deathHistogram(report: AggregateReport, classes: readonly PlayerClass[]): string {
  const head = '| | Floor 1 | Floor 2 | Floor 3 | Floor 4 | Floor 5 |\n| --- | ---: | ---: | ---: | ---: | ---: |';
  const overall = `| **All classes** | ${deathRow(report.deathByAct)} |`;
  const rows = classes.map((c) => `| ${c} | ${deathRow(report.perClass[c].deathByAct)} |`);
  return [head, overall, ...rows].join('\n');
}

function policySection(title: string, note: string, report: AggregateReport, classes: readonly PlayerClass[]): string {
  return [
    `## ${title}`,
    '',
    note,
    '',
    `- **Overall win-rate:** ${pct(report.winRate)} (${report.wins} of ${report.runs} runs) — ${report.grace} grace, ${report.damnation} damnation, ${report.deaths} deaths.`,
    `- **Average final level:** ${f2(report.avgLevel)} · **average floors cleared:** ${f2(report.avgFloorsCleared)} (of 4 concluded floors on a full descent).`,
    '',
    '### Per class',
    '',
    perClassTable(report, classes),
    '',
    '### Deaths per class × floor (where runs end)',
    '',
    deathHistogram(report, classes),
  ].join('\n');
}

// ------- The provenance block (D9) -------------------------------------------

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

// ------- The per-class ruling (§22.27) -----------------------------------------

/** AC-27's callout: the classes furthest below one in three, and their floor-2 death share. */
function perClassCallout(report: AggregateReport): string {
  const weak = weakestClasses(report, 2);
  if (weak.length === 0) {
    return '**No class is below one in three** on the baseline policy.';
  }
  const named = weak
    .map((w) => `**${w.classId}** wins ${pct(w.winRate)}, and floor 2 took ${pct(w.floor2DeathShare)} of its deaths`)
    .join('; ');
  return (
    `**The classes furthest below one in three:** ${named}. ` +
    'Per §22.27 no class was tuned to close this. The three remedies on the table — ' +
    'strengthen that class elsewhere, accept it as a real build trade-off, or soften floor 2 for ' +
    'low-Wisdom builds — are the author\'s to choose, and the tables below are the evidence.'
  );
}

// ------- Floor 2: the Wisdom question -----------------------------------------

function illusionTable(report: AggregateReport, classes: readonly PlayerClass[]): string {
  const head =
    '| Class | Runs reaching floor 2 | Illusions per run there | Rounds per illusion | HP lost per illusion | Seen through | Deaths inside an illusion | Floor-2 share of deaths |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const rows = classes.map((c) => {
    const s = report.perClass[c];
    const f = s.perFloor[2];
    return `| ${c} | ${f.reached} | ${f2(per(f.illusionsMet, f.reached))} | ${f2(per(f.illusionRounds, f.illusionsMet))} | ${f2(per(f.illusionHpLost, f.illusionsMet))} | ${pct(per(f.illusionsDispelled, f.illusionsMet))} | ${f.diedInIllusion} | ${pct(per(s.deathByAct[2] ?? 0, s.deaths))} |`;
  });
  return [head, ...rows].join('\n');
}

function wisTable(report: AggregateReport): string {
  const head = '| Starting Wisdom | Runs | Win% | Floor-2 share of deaths |\n| --- | ---: | ---: | ---: |';
  const label = { low: '≤ 9', mid: '10–13', high: '≥ 14' } as const;
  const rows = (['low', 'mid', 'high'] as const).map((b) => {
    const w = report.perWisBucket[b];
    return `| ${label[b]} | ${w.runs} | ${pct(w.winRate)} | ${pct(w.floor2DeathShare)} |`;
  });
  return [head, ...rows].join('\n');
}

function wisdomRead(report: AggregateReport): string {
  const gap = wisdomGap(report);
  if (!gap) return 'One of the end buckets is empty in this sample, so no Wisdom gap is claimed.';
  const direction =
    gap.points > 0
      ? `a gap of ${f1(gap.points)} percentage points in favour of high Wisdom`
      : gap.points < 0
        ? `a gap of ${f1(-gap.points)} points in favour of LOW Wisdom — no Wisdom advantage at all`
        : 'no gap at all';
  return (
    `Starting Wisdom ≥ 14 wins ${pct(gap.highWin)}; ≤ 9 wins ${pct(gap.lowWin)} — ${direction}. ` +
    `Floor 2 took ${pct(gap.highFloor2Share)} of the high bucket's deaths and ${pct(gap.lowFloor2Share)} of the low one's.`
  );
}

function dcTable(rows: ReportInput['dcRows'], shippedDc: number): string {
  const head =
    '| Illusion DC | Win% | Floor-2 deaths | Rounds per illusion | Win% at Wisdom ≤ 9 | Win% at Wisdom ≥ 14 |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: |';
  const body = [...rows]
    .sort((a, b) => a.dc - b.dc)
    .map(({ dc, report }) => {
      const f = report.perFloor[2];
      const mark = dc === shippedDc ? ' (shipped)' : '';
      return `| ${dc}${mark} | ${pct(report.winRate)} | ${report.deathByAct[2] ?? 0} | ${f2(per(f.illusionRounds, f.illusionsMet))} | ${pct(report.perWisBucket.low.winRate)} | ${pct(report.perWisBucket.high.winRate)} |`;
    });
  return [head, ...body].join('\n');
}

function dcRead(rows: ReportInput['dcRows'], shippedDc: number): string {
  const s = illusionSensitivity(
    rows.map((r) => ({ dc: r.dc, winRate: r.report.winRate })),
    shippedDc,
  );
  if (!s) return 'Fewer than two DCs were measured, so no sensitivity is claimed.';
  const size = Math.abs(s.swing) < 2 ? 'a SMALL lever' : Math.abs(s.swing) < 5 ? 'a moderate lever' : 'a LARGE lever';
  return (
    `From DC ${s.lowest.dc} to DC ${s.highest.dc} the baseline win rate moves ${pct(s.lowest.winRate)} → ${pct(s.highest.winRate)} ` +
    `(a swing of ${f1(s.swing)} points) — ${size} on the overall rate.` +
    (s.shipped ? ` The shipped DC ${s.shipped.dc} measures ${pct(s.shipped.winRate)}.` : '') +
    ' Measured with the DC injected into the sim; `ILLUSION_DC` was not edited.'
  );
}

// ------- Floor length (G9) and resources ---------------------------------------

function floorLengthTable(report: AggregateReport): string {
  const head =
    `| Floor | Runs that cleared it | Encounters | Battle rounds | Steps | Est. minutes (at ${SECONDS_PER_STEP} s/step) |\n` +
    '| --- | ---: | ---: | ---: | ---: | ---: |';
  const rows = FLOOR_IDS.map((f) => {
    const c: FloorCounters = report.perClearedFloor[f];
    const steps = per(c.steps, c.cleared);
    return `| ${f} · ${floorDef(f).name} | ${c.cleared} | ${f1(per(c.encounters, c.cleared))} | ${f1(per(c.rounds, c.cleared))} | ${f1(steps)} | ~${Math.round(estimatedMinutes(steps))} |`;
  });
  return [head, ...rows].join('\n');
}

function resourceTable(report: AggregateReport): string {
  const head =
    '| Floor | Runs reaching it | Died there | Rests found | Bargains offered | Bargains taken | Heal items used | Loot left behind | Bargains per cleared floor | Bargain share of the table |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const rows = FLOOR_IDS.map((f: FloorId) => {
    const p = report.perFloor[f];
    const c = report.perClearedFloor[f];
    // "Died there": the share of the runs that REACHED the floor which died on it — how hard the
    // floor itself is, rather than how many runs it happened to see (FIX ROUND 1, F7's evidence).
    return `| ${f} | ${p.reached} | ${pct(per(p.died, p.reached))} | ${f2(per(p.rests, p.reached))} | ${f2(per(p.bargainsOffered, p.reached))} | ${f2(per(p.bargainsTaken, p.reached))} | ${f2(per(p.healsUsed, p.reached))} | ${f2(per(p.lootLeftBehind, p.reached))} | ${f2(per(c.bargainsOffered, c.cleared))} | ${pct(bargainShare(floorDef(f).encounters))} |`;
  });
  return [head, ...rows].join('\n');
}

// ------- The tuning ledger (AC-28) ---------------------------------------------

function tuningLedger(): string {
  const head = '| Step | Knob | From | To | Why | Measured effect |\n| --- | --- | ---: | ---: | --- | --- |';
  const rows = TUNING_LEDGER.map((t) => `| ${t.id} | ${t.knob} | ${t.from} | ${t.to} | ${t.why} | ${t.effect} |`);
  return [
    head,
    ...rows,
    '',
    '**Frozen — not moved by this tuning:**',
    '',
    ...FROZEN_KNOBS.map((k) => `- ${k}`),
  ].join('\n');
}

// ------- The balance read ------------------------------------------------------

/**
 * A short plain-language read. G28(c): EVERY verdict word is COMPUTED from the report by
 * `balance-claims.ts`, never written by hand beside numbers it might contradict.
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
    `- **Winnability vs the target.** The baseline wins ${pct(baseline.winRate)} of runs — ${bandWord}. See the caveats above for what these numbers do and do not model.`,
  );
  bullets.push(
    `- **Where deaths fall.** Floor 1 holds ${pct(act1Share(baseline))} of all deaths; the modal death floor is ${peak.act} at ${pct(peak.share)}, and ${spread.length} of the 5 floors each hold ≥ 10% of deaths (${spread.length > 0 ? `floors ${spread.join(', ')}` : 'none'}).`,
  );
  bullets.push(
    `- **The grace path stays a mercy choice.** The kill-everything baseline reaches grace ${baseline.grace} time(s); the merciful policy (spares ⚖ foes) reaches grace ${merciful.grace} time(s), for an overall win-rate of ${pct(merciful.winRate)}. Grace ends the run at floor 4; damnation descends to floor 5.`,
  );
  const perClass = extremes
    ? `strongest **${extremes.strongest}** (${pct(baseline.perClass[extremes.strongest].winRate)}), weakest **${extremes.weakest}** (${pct(baseline.perClass[extremes.weakest].winRate)})`
    : 'no classes in the sample';
  const zeroes =
    noWin.length === 0
      ? 'every class wins at least once over the sample'
      : `**${noWin.join(', ')}** never won a single run`;
  bullets.push(`- **Per-class shape (author call, §22.27).** ${perClass}; ${zeroes}.`);
  return bullets.join('\n');
}

/** "Floors 1, 2, 3 each hold ≥ 10% of deaths" — the floors NAMED, never a hard-coded range. */
function describeSpread(report: AggregateReport): string {
  const acts = actsAtOrAbove(report, 0.1);
  if (acts.length === 0) return 'no floor holds ≥ 10% of deaths';
  return `floor${acts.length === 1 ? '' : 's'} ${acts.join(', ')} each hold ≥ 10% of deaths`;
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

// ------- The document ----------------------------------------------------------

export function renderReport(input: ReportInput): string {
  const { n, classes, baseline, merciful, dcRows, shippedDc } = input;
  const verdict = bandPhrase(bandVerdict(baseline.winRate));
  return [
    '# The Void — balance / winnability report',
    '',
    provenance(),
    '',
    `## Difficulty target — ${verdict}`,
    '',
    '**Target (author, M15):** a careful baseline run wins about **1 in 3** — overall baseline',
    `win-rate in the **${pct(TARGET_BAND.min)}–${pct(TARGET_BAND.max)} band (aim ~30%)** — with deaths **spread across the`,
    'descent** rather than bunched on floor 1. The band is judged on the **baseline** policy; the',
    'merciful policy is kept for the grace-path view.',
    '',
    `**Result — ${verdict}.** Baseline overall win-rate **${pct(baseline.winRate)}**; floor 1 holds`,
    `**${pct(act1Share(baseline))}** of all baseline deaths, the modal death floor holds`,
    `**${pct(peakDeath(baseline).share)}** (floor ${peakDeath(baseline).act}), and ${describeSpread(baseline)}.`,
    `${describeZeroes(baseline)} Committed anchor tests (\`src/game/balance.test.ts\`) hold the`,
    'floor-1 "~3–4 hits" feel and a winnability floor.',
    '',
    perClassCallout(baseline),
    '',
    '## What was measured',
    '',
    '- **Build:** the five floors of `PLAN.md` #2 — floor 2\'s illusions, floor 3\'s slow weight, floor 4\'s temptation, floor 5\'s warped kit; bargains and rest spots found on the descent; potions folded into consumables; a twelve-slot backpack.',
    `- **Sample:** seeds \`1..${n}\` × the ${classes.length} classes (${classes.join(', ')}) = **${baseline.runs} runs per policy**, all-unlocked roster (\`createGame(seed)\`).`,
    '- **Two policies:** a **baseline** (kills everything, takes any bargain not paid in HP) and a',
    '  **merciful** variant (identical, but spares living ⚖ karma-weighted non-boss foes).',
    `- **The DC table** re-runs the baseline with floor 2's DC injected at ${[...dcRows].map((r) => r.dc).sort((a, b) => a - b).join(' / ')}.`,
    '',
    '## Tuning ledger (global knobs only)',
    '',
    tuningLedger(),
    '',
    '## Headline',
    '',
    `- **Baseline overall win-rate: ${pct(baseline.winRate)}** (${baseline.grace} grace + ${baseline.damnation} damnation of ${baseline.runs}).`,
    `- **Merciful overall win-rate: ${pct(merciful.winRate)}** (${merciful.grace} grace + ${merciful.damnation} damnation of ${merciful.runs}).`,
    `- Deaths peak on **floor ${peakDeath(baseline).act}** (${pct(peakDeath(baseline).share)} of all baseline deaths).`,
    '',
    '## Balance read (from the data)',
    '',
    problemsRead(baseline, merciful),
    '',
    '## Floor 2 — the Wisdom question (the author\'s evidence, §22.27)',
    '',
    'An illusory enemy\'s attacks are real and the player\'s are not; a passive Wisdom roll each',
    'round (d20 + Wisdom modifier against the DC) is the only way through, and seeing through ends',
    'the fight with no XP and no loot (plan Appendix A.1 — a pure cost, not softened).',
    '',
    '### Illusions per class (baseline)',
    '',
    illusionTable(baseline, classes),
    '',
    '### Illusions per class (merciful)',
    '',
    illusionTable(merciful, classes),
    '',
    '### By starting Wisdom (baseline)',
    '',
    wisTable(baseline),
    '',
    wisdomRead(baseline),
    '',
    '### By starting Wisdom (merciful)',
    '',
    wisTable(merciful),
    '',
    '### `ILLUSION_DC` sensitivity — measured, NOT applied',
    '',
    dcTable(dcRows, shippedDc),
    '',
    dcRead(dcRows, shippedDc),
    '',
    '## Floor length (G9) — over the runs that cleared each floor',
    '',
    floorLengthTable(baseline),
    '',
    `Minutes are an **estimate** at ${SECONDS_PER_STEP} seconds per step (\`SECONDS_PER_STEP\`); the counts are measured. Floor 5 "cleared" means the Hollow fell (damnation); grace ends the run on floor 4.`,
    '',
    '## Resources per floor (baseline, per run that reached the floor)',
    '',
    resourceTable(baseline),
    '',
    'The last column is the data\'s expectation: a bargain is one weight in the floor\'s encounter table (`floors.json`), and bosses are not drawn from it.',
    '',
    policySection(
      'Baseline policy (no spare — the careful kill-everything run)',
      'Equip found gear at the hub (greedy rarity rule), drink a found healing item at <= 35% HP, cast the best affordable skill, flee a near-certain death when no heal is left, otherwise fight; take any bargain not paid in HP, and shed the worst gear when the pack is full. Kills every foe.',
      baseline,
      classes,
    ),
    '',
    policySection(
      'Merciful policy (spares ⚖ foes — exercises the grace path)',
      'Identical to the baseline, except it releases a living ⚖ karma-weighted non-boss enemy on sight. It trades kill XP for positive karma, so it reaches the grace ending more often.',
      merciful,
      classes,
    ),
    '',
    '---',
    '',
    '*Outcome vocabulary: **grace** = the floor-4 verdict ascension (net-positive karma); **damnation**',
    '= descending to floor 5 and unmaking the Hollow Self; **death** = the player fell. Both grace and',
    'damnation count as "wins" (the run reached an ending); death does not.*',
    '',
  ].join('\n');
}
