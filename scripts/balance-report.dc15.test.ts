// D9, ONE BATCH — the baseline at an injected illusion DC of 15.
// Re-measured, and required to be exactly the committed input.
//
// One of four such files (fix round 2): each re-runs ONE of the report's batches (~2,500
// simulated runs), so the four run in parallel instead of one after another. `balance-report
// .static.test.ts` renders the whole report from the committed inputs; this file proves the
// input is what the engine produces TODAY. A balance change nobody regenerated the report for,
// or a hand-edited input, goes red here — and names the first number that moved.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromSnapshot, measureAtDc } from './balance-measure.ts';

const inputs = fromSnapshot(readFileSync(fileURLToPath(new URL('../docs/balance-report.inputs.json', import.meta.url)), 'utf8'));

describe('D9 — the baseline at an injected illusion DC of 15', () => {
  it(
    're-measured, it is exactly the committed input the report was rendered from',
    () => {
      expect(
        measureAtDc(15),
        'the engine no longer produces the committed report — regenerate it: npx vite-node scripts/balance-report.ts',
      ).toEqual(inputs.dcRows.find((r) => r.dc === 15)!.report);
    },
    300_000,
  );
});
