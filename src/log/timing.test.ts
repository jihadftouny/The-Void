// Every expected value below is derived BY HAND from the spec in `timing.ts`'s header,
// never read off a run. Every duration is measured against a SCRIPTED clock and asserted
// as an EXACT number — no `Date.now()`, no `performance.now()`, no `vi.useFakeTimers`, no
// `toBeGreaterThan(0)` tolerance window. A timing test that reads a wall clock is the
// classic flake, and this whole unit is about timing.
import { describe, it, expect, afterEach } from 'vitest';
import { SLOW_MS, levelForDuration, roundMs, startTimer } from './timing.ts';
import { setClock, defaultClock } from './logger.ts';

/** Hand the clock a script; each call to `now()` takes the next value. */
function scriptClock(values: readonly number[]): void {
  let i = 0;
  setClock(() => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v as number;
  });
}

afterEach(() => {
  setClock(defaultClock);
});

describe('SLOW_MS — the threshold table', () => {
  it('is frozen, so a threshold cannot be mutated at runtime', () => {
    expect(Object.isFrozen(SLOW_MS)).toBe(true);
  });

  it('carries the derived numbers from the design, not round guesses', () => {
    // step: ~0.05 ms/step measured (G13) x ~1000 => 50. turn: 89 tok/s x 400 tok ≈ 4.5 s
    // healthy, 7.6 tok/s ≈ 53 s pathological => 25 s sits between them. narrate: the same,
    // minus render. save/load: two orders of magnitude above a tens-of-KB stringify.
    expect(SLOW_MS).toEqual({ step: 50, turn: 25_000, narrate: 20_000, save: 100, load: 250 });
  });

  it('orders the thresholds the way the boundaries nest', () => {
    // A whole turn contains a narration, which contains neither a save nor a step; so the
    // turn budget must be the largest and the step budget the smallest, or a slow step
    // could never escalate before the turn did.
    expect(SLOW_MS.step).toBeLessThan(SLOW_MS.save);
    expect(SLOW_MS.save).toBeLessThan(SLOW_MS.load);
    expect(SLOW_MS.load).toBeLessThan(SLOW_MS.narrate);
    expect(SLOW_MS.narrate).toBeLessThan(SLOW_MS.turn);
  });
});

describe('levelForDuration — the escalation rule', () => {
  it('is debug below the threshold and warn at or over it (the boundary, by hand)', () => {
    expect(levelForDuration(49, 50)).toBe('debug');
    expect(levelForDuration(50, 50)).toBe('warn');
    expect(levelForDuration(51, 50)).toBe('warn');
    expect(levelForDuration(0, 50)).toBe('debug');
  });

  it('treats an UNMEASURABLE duration as suspicious, not as fine', () => {
    // The opposite choice makes broken timing look healthy forever, which is the failure
    // this whole unit exists to stop.
    expect(levelForDuration(NaN, 50)).toBe('warn');
    expect(levelForDuration(Infinity, 50)).toBe('warn');
    expect(levelForDuration(-Infinity, 50)).toBe('warn');
  });

  it('respects the healthy level it was given, and still escalates over the threshold', () => {
    // The once-per-action timeline logs at `info` when healthy so a shipped build (which
    // runs at `info`) keeps it. If the third argument were ignored, that timeline would
    // vanish from every packaged log — silently.
    expect(levelForDuration(10, 50, 'info')).toBe('info');
    expect(levelForDuration(49, 50, 'info')).toBe('info');
    expect(levelForDuration(50, 50, 'info')).toBe('warn');
    expect(levelForDuration(9999, 50, 'info')).toBe('warn');
    // And the default really is `debug` — not `info` by accident.
    expect(levelForDuration(10, 50)).toBe('debug');
  });

  it('a negative (clock-corrected) duration is below any positive threshold', () => {
    expect(levelForDuration(-5, 50, 'info')).toBe('info');
  });
});

describe('roundMs', () => {
  it('keeps two decimals, so a sub-millisecond step is not recorded as zero', () => {
    expect(roundMs(0.4)).toBe(0.4);
    expect(roundMs(0.004)).toBe(0);
    expect(roundMs(1.2345)).toBe(1.23);
    expect(roundMs(1.235)).toBe(1.24);
    expect(roundMs(4523.7181)).toBe(4523.72);
    expect(roundMs(250)).toBe(250);
    expect(roundMs(0)).toBe(0);
  });

  it('marks an unmeasurable duration as -1, a value no real duration can take', () => {
    expect(roundMs(NaN)).toBe(-1);
    expect(roundMs(Infinity)).toBe(-1);
    expect(roundMs(-Infinity)).toBe(-1);
  });

  it('is JSON-safe for every case (NaN would serialize to null and lose the fact)', () => {
    for (const v of [0.4, 250, NaN, Infinity]) {
      expect(JSON.parse(JSON.stringify({ ms: roundMs(v) })).ms).toBe(roundMs(v));
    }
  });
});

describe('startTimer — measured against the injected clock only', () => {
  it('returns the EXACT scripted delta', () => {
    scriptClock([1000, 1250]);
    const t = startTimer();
    expect(t.stop()).toBe(250);
  });

  it('re-reads the clock on every stop (so a second read reports more elapsed time)', () => {
    scriptClock([1000, 1250, 1600]);
    const t = startTimer();
    expect(t.stop()).toBe(250);
    expect(t.stop()).toBe(600);
  });

  it('rounds a fractional delta rather than truncating it', () => {
    scriptClock([100.5, 100.9006]);
    const t = startTimer();
    expect(t.stop()).toBe(0.4);
  });

  it('two timers started at different points measure different spans', () => {
    // Pins that `startTimer` captures its OWN start rather than a module-level one — a
    // shared start would make both report the same number.
    scriptClock([10, 40, 100, 200]);
    const a = startTimer(); // t0 = 10
    const b = startTimer(); // t0 = 40
    expect(a.stop()).toBe(90); // 100 - 10
    expect(b.stop()).toBe(160); // 200 - 40 — DIFFERENT, so the starts are not shared
  });

  it('a clock that goes BACKWARDS yields a negative duration, not a hidden zero', () => {
    scriptClock([1000, 900]);
    expect(startTimer().stop()).toBe(-100);
  });
});
