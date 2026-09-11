// D9, THE CHEAP HALF — the committed report is exactly what its committed inputs render.
//
// The generator writes `docs/BALANCE-REPORT.md` AND the inputs it rendered it from
// (`docs/balance-report.inputs.json`). This file renders the WHOLE document from those inputs —
// no simulation, milliseconds — and requires it byte-for-byte: a hand-edited number, sentence,
// table row or banner anywhere in the report goes red here. The other half is the four
// `balance-report.<batch>.test.ts` files, which re-measure one batch each (in parallel) and
// require the committed inputs to be exactly what the engine produces today — so a stale
// report, or a hand-edited input, goes red there.
//
// Together: every byte of the report is checked against its inputs, and every input against the
// engine. (Fix round 2 split the old single check, which re-ran all four batches one after
// another and became the suite's critical path.)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReport, REPORT_SEEDS } from './balance-render.ts';
import { fromSnapshot, SENSITIVITY_DCS } from './balance-measure.ts';
import { ILLUSION_DC } from '../src/game/floors.ts';
import { ALL_CLASSES } from '../src/game/sim.ts';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const committed = read('../docs/BALANCE-REPORT.md');
const inputs = fromSnapshot(read('../docs/balance-report.inputs.json'));

describe('D9 — the committed report is exactly what its committed inputs render', () => {
  it('the inputs are the whole sample: four batches of seeds 1..REPORT_SEEDS x every class', () => {
    expect(inputs.n).toBe(REPORT_SEEDS);
    expect(inputs.classes).toEqual([...ALL_CLASSES]);
    expect(inputs.shippedDc).toBe(ILLUSION_DC);
    expect(inputs.dcRows.map((r) => r.dc)).toEqual([ILLUSION_DC, ...SENSITIVITY_DCS]);
    for (const r of [inputs.baseline, inputs.merciful, ...inputs.dcRows.map((row) => row.report)]) {
      expect(r.runs).toBe(REPORT_SEEDS * ALL_CLASSES.length);
    }
    // The shipped-DC row IS the baseline, not a second copy that could disagree with it.
    expect(inputs.dcRows[0]!.report).toBe(inputs.baseline);
  });

  it('the WHOLE document, rendered from them, is byte-for-byte the committed one', () => {
    const fresh = renderReport(inputs);
    if (fresh !== committed) {
      const a = fresh.split('\n');
      const b = committed.split('\n');
      const at = a.findIndex((line, i) => line !== b[i]);
      expect(
        { line: at + 1, committed: b[at] ?? '(missing)', rendered: a[at] ?? '(missing)' },
        'docs/BALANCE-REPORT.md was edited by hand, or regenerated without its inputs — run: npx vite-node scripts/balance-report.ts',
      ).toBeNull();
    }
    expect(fresh).toBe(committed);
  });

  it('carries no hand-added banner: every caveat it shows is one the generator emits', () => {
    // The lost "⚠ INVALIDATED" banner (D9) was a blockquote added by hand. The only blockquote
    // the generator writes is the provenance lines; anything else was typed into the output.
    const quotes = committed.split('\n').filter((l) => l.startsWith('>'));
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) expect(q, q).toMatch(/Generated|npx vite-node|output, and every verdict/);
  });
});
