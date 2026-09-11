// The balance report's DOCUMENT (PLAN.md #2, AC-27, D9).
//
// The renderer, fed a small REAL sample, emits every section AC-27 names, every standing
// caveat and every tuning-ledger row — from code, so a regeneration cannot lose one (D9). The
// checks on the COMMITTED report live in `balance-report.*.test.ts`.

import { describe, it, expect } from 'vitest';
import { simulateBatch, heuristicPolicy, mercifulPolicy, ALL_CLASSES } from '../src/game/sim.ts';
import { ILLUSION_DC } from '../src/game/floors.ts';
import { renderReport, perClassTable, type ReportInput } from './balance-render.ts';
import { STANDING_CAVEATS, TUNING_LEDGER, FROZEN_KNOBS, weakestClasses } from './balance-claims.ts';

const classes = [...ALL_CLASSES];

/** A small real sample — the renderer's input shape, measured, not hand-built. */
function smallInput(): ReportInput {
  const seeds = [1, 2, 3, 4, 5, 6];
  const baseline = simulateBatch({ seeds, classes, policy: heuristicPolicy });
  const merciful = simulateBatch({ seeds, classes, policy: mercifulPolicy });
  const at11 = simulateBatch({ seeds, classes, policy: heuristicPolicy, stepOptions: { illusionDc: 11 } });
  const at15 = simulateBatch({ seeds, classes, policy: heuristicPolicy, stepOptions: { illusionDc: 15 } });
  return {
    n: seeds.length,
    classes,
    baseline,
    merciful,
    dcRows: [
      { dc: ILLUSION_DC, report: baseline },
      { dc: 11, report: at11 },
      { dc: 15, report: at15 },
    ],
    shippedDc: ILLUSION_DC,
  };
}

describe('renderReport — every AC-27 section, every caveat, every ledger row', () => {
  const input = smallInput();
  const md = renderReport(input);

  it('carries each section AC-27 names', () => {
    for (const heading of [
      '## What these numbers do NOT include',
      '## Difficulty target — ',
      '## Tuning ledger (global knobs only)',
      '### Illusions per class (baseline)',
      '### Illusions per class (merciful)',
      '### By starting Wisdom (baseline)',
      '### By starting Wisdom (merciful)',
      '### `ILLUSION_DC` sensitivity — measured, NOT applied',
      '## Floor length (G9) — over the runs that cleared each floor',
      '## Resources per floor (baseline, per run that reached the floor)',
      '### Deaths per class × floor (where runs end)',
    ]) {
      expect(md, heading).toContain(heading);
    }
  });

  it('emits every standing caveat, every ledger row and every frozen knob', () => {
    for (const c of STANDING_CAVEATS) expect(md).toContain(c.text);
    for (const t of TUNING_LEDGER) expect(md).toContain(`| ${t.id} | ${t.knob} | ${t.from} | ${t.to} |`);
    for (const k of FROZEN_KNOBS) expect(md).toContain(k);
  });

  it('the DC table has one row per measured DC, the shipped one marked', () => {
    expect(md).toContain(`| ${ILLUSION_DC} (shipped) |`);
    expect(md).toMatch(/\| 11 \| \d+\.\d%/);
    expect(md).toMatch(/\| 15 \| \d+\.\d%/);
  });

  it('the callout names exactly the classes the claim computes — never a remembered answer', () => {
    const weak = weakestClasses(input.baseline, 2);
    if (weak.length === 0) {
      expect(md).toContain('**No class is below one in three**');
    } else {
      for (const w of weak) expect(md).toContain(`**${w.classId}** wins`);
    }
  });

  it('renders every class in both per-class tables, and is deterministic', () => {
    expect(md).toContain(perClassTable(input.baseline, classes));
    expect(md).toContain(perClassTable(input.merciful, classes));
    expect(renderReport(input)).toBe(md);
  });
});

// The D9 checks on the COMMITTED report moved to `balance-report.*.test.ts` (fix round 2): one
// cheap file renders the whole document from the committed inputs, and four re-measure one
// batch each, in parallel.
