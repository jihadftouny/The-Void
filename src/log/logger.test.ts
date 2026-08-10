import { describe, it, expect } from 'vitest';
import { Logger, createRingBuffer, formatEntry, setClock } from './logger.ts';
import type { LogEntry } from './logger.ts';

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

describe('formatEntry', () => {
  it('renders a readable line with serialized data', () => {
    const line = formatEntry({ time: 0, level: 'info', category: 'engine', message: 'step', data: { hp: 5 } });
    expect(line).toContain('INFO');
    expect(line).toContain('[engine]');
    expect(line).toContain('step');
    expect(line).toContain('"hp":5');
  });
});
