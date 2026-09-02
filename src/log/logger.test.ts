import { describe, it, expect, afterEach } from 'vitest';
import {
  Logger,
  createRingBuffer,
  formatEntry,
  setClock,
  now,
  defaultClock,
} from './logger.ts';
import type { LogEntry } from './logger.ts';

afterEach(() => {
  setClock(defaultClock);
});

describe('Logger', () => {
  it('dispatches to sinks and respects the level filter', () => {
    setClock(() => 1000);
    const log = new Logger();
    const seen: LogEntry[] = [];
    log.addSink((e) => seen.push(e));
    log.setLevel('warn');
    log.debug('x', 'hidden');
    log.info('x', 'hidden');
    log.warn('x', 'shown', { a: 1 });
    log.error('x', 'also');
    expect(seen.map((e) => e.message)).toEqual(['shown', 'also']);
    expect(seen[0]).toMatchObject({ time: 1000, level: 'warn', category: 'x', data: { a: 1 } });
  });

  it('a throwing sink never breaks logging', () => {
    const log = new Logger();
    log.addSink(() => {
      throw new Error('bad sink');
    });
    const seen: string[] = [];
    log.addSink((e) => seen.push(e.message));
    expect(() => log.info('x', 'ok')).not.toThrow();
    expect(seen).toEqual(['ok']);
  });

  it('addSink returns an unsubscribe', () => {
    const log = new Logger();
    const seen: string[] = [];
    const off = log.addSink((e) => seen.push(e.message));
    log.info('x', 'a');
    off();
    log.info('x', 'b');
    expect(seen).toEqual(['a']);
  });
});

describe('ring buffer', () => {
  it('keeps only the most recent N entries', () => {
    setClock(() => 0);
    const log = new Logger();
    const ring = createRingBuffer(3);
    log.addSink(ring.sink);
    for (let i = 0; i < 5; i++) log.info('x', `m${i}`);
    expect(ring.get().map((e) => e.message)).toEqual(['m2', 'm3', 'm4']);
    ring.clear();
    expect(ring.get()).toEqual([]);
  });
});

describe('the clock seam', () => {
  it('now() reads the SAME clock setClock sets — one seam, not two', () => {
    // If `now()` had its own clock, every duration measured through `timing.ts` would be
    // unscriptable and every timing test would have to read a wall clock.
    setClock(() => 4242);
    expect(now()).toBe(4242);
    setClock(() => -1);
    expect(now()).toBe(-1);
  });

  it('an entry stamps its time from that same clock', () => {
    setClock(() => 777);
    const log = new Logger();
    const seen: LogEntry[] = [];
    log.addSink((e) => seen.push(e));
    log.info('x', 'm');
    expect(seen[0]?.time).toBe(777);
    expect(seen[0]?.time).toBe(now());
  });

  it('the DEFAULT clock is a real epoch time (asserted directly, not via the seam)', () => {
    // The one place in this unit that may look at a wall clock, and it is a PLAUSIBILITY
    // bound derived independently: `formatEntry`/`fileLog` both do `new Date(entry.time)`,
    // so the default must be epoch milliseconds, not a `performance.now()` offset. The
    // lower bound is a fixed date in the past; the window is 5 s, far above any scheduling
    // jitter, so this cannot flake.
    const t = defaultClock();
    expect(t).toBeGreaterThan(Date.UTC(2024, 0, 1));
    expect(Math.abs(t - Date.now())).toBeLessThan(5000);
    expect(new Date(t).getUTCFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it('the default clock is FRACTIONAL, so a sub-millisecond span is not rounded to zero', () => {
    // `Date.now()` has 1 ms granularity: two reads inside the same millisecond are equal,
    // and every fast operation would be recorded as `0`. This is why the default is
    // `performance.timeOrigin + performance.now()`.
    const samples = Array.from({ length: 5 }, () => defaultClock());
    expect(samples.some((v) => !Number.isInteger(v))).toBe(true);
  });
});

describe('Logger#level', () => {
  it('reports the level it was set to', () => {
    const log = new Logger();
    expect(log.level()).toBe('debug');
    log.setLevel('warn');
    expect(log.level()).toBe('warn');
    log.setLevel('error');
    expect(log.level()).toBe('error');
  });

  it('and the reported level really is the one being filtered on', () => {
    // Pins the two together: a `level()` that returned a stale field while the filter used
    // another would make every boot line a lie about what the log contains.
    const log = new Logger();
    const seen: string[] = [];
    log.addSink((e) => seen.push(`${e.level}:${e.message}`));
    log.setLevel('info');
    log.debug('x', 'dropped');
    log.info('x', 'kept');
    expect(log.level()).toBe('info');
    expect(seen).toEqual(['info:kept']);
  });
});

describe('formatEntry', () => {
  it('renders a readable line with serialized data', () => {
    const line = formatEntry({ time: 0, level: 'info', category: 'engine', message: 'step', data: { hp: 5 } });
    expect(line).toContain('INFO');
    expect(line).toContain('[engine]');
    expect(line).toContain('step');
    expect(line).toContain('"hp":5');
  });
});
