import { describe, it, expect, afterEach } from 'vitest';
import { resolveLogLevel, isLogLevel, LOG_LEVELS } from './level.ts';
import { Logger, setClock, defaultClock } from './logger.ts';
import type { LogEntry } from './logger.ts';

afterEach(() => {
  setClock(defaultClock);
});

describe('isLogLevel', () => {
  it('accepts exactly the four names', () => {
    expect(LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error']);
    for (const l of LOG_LEVELS) expect(isLogLevel(l)).toBe(true);
  });

  it('rejects everything else, including near-misses and non-strings', () => {
    for (const bad of ['DEBUG', 'verbose', 'trace', 'warning', '', ' info', undefined, null, 2, {}]) {
      expect(isLogLevel(bad)).toBe(false);
    }
  });
});

describe('resolveLogLevel — the shipped/developer policy', () => {
  it('a packaged build (file:) logs at info', () => {
    expect(resolveLogLevel({ protocol: 'file:' })).toBe('info');
  });

  it('a dev build (http/https) logs at debug', () => {
    expect(resolveLogLevel({ protocol: 'http:' })).toBe('debug');
    expect(resolveLogLevel({ protocol: 'https:' })).toBe('debug');
  });

  it('a VALID override wins over both', () => {
    expect(resolveLogLevel({ protocol: 'file:', override: 'debug' })).toBe('debug');
    expect(resolveLogLevel({ protocol: 'http:', override: 'error' })).toBe('error');
    expect(resolveLogLevel({ protocol: 'file:', override: 'warn' })).toBe('warn');
  });

  it('an INVALID or absent override is ignored — it never downgrades the policy', () => {
    // The polarity that matters: garbage in `localStorage` must not silently turn a
    // packaged build into a debug build (which is what writes the player's name to disk).
    expect(resolveLogLevel({ protocol: 'file:', override: 'DEBUG' })).toBe('info');
    expect(resolveLogLevel({ protocol: 'file:', override: '' })).toBe('info');
    expect(resolveLogLevel({ protocol: 'file:', override: null })).toBe('info');
    expect(resolveLogLevel({ protocol: 'file:', override: 1 })).toBe('info');
    expect(resolveLogLevel({ protocol: 'file:' })).toBe('info');
  });

  it('an unknown or missing protocol is treated as developer', () => {
    expect(resolveLogLevel({ protocol: 'about:' })).toBe('debug');
    expect(resolveLogLevel({})).toBe('debug');
    expect(resolveLogLevel()).toBe('debug');
  });
});

// =========================================================================================
// THE CONSEQUENCE THE POLICY EXISTS FOR (plan ruling A.4).
//
// The decision to keep the player's typed name in the log at `debug` rests ENTIRELY on a
// packaged build running at `info`. That is an intention until something asserts it, so
// this drives the real `Logger` at the level `resolveLogLevel` returns for `file:` and
// checks that the name payload never reaches a sink.
// =========================================================================================

describe('a packaged (file:) build never writes the player-typed name', () => {
  const NAME = 'Ariadne-Q';

  /** Everything a logger at `level` emits for the exact calls `game.ts#dispatch` makes. */
  function emittedAt(level: 'debug' | 'info'): LogEntry[] {
    setClock(() => 5000);
    const log = new Logger();
    const seen: LogEntry[] = [];
    log.addSink((e) => seen.push(e));
    log.setLevel(level);
    // Verbatim the shape `dispatch()` logs (R2): the whole input object, name included.
    log.debug('ui', 'choice', { input: { kind: 'name', name: NAME } });
    // ...and a neighbouring `info` line, so "nothing was emitted" cannot pass vacuously.
    log.info('ui', 'turn', { input: 'name', ms: 12 });
    return seen;
  }

  it('the policy the packaged build gets is info', () => {
    expect(resolveLogLevel({ protocol: 'file:' })).toBe('info');
  });

  it('at info, the ui/choice name payload is not emitted at all', () => {
    const seen = emittedAt(resolveLogLevel({ protocol: 'file:' }) as 'info');
    expect(seen.map((e) => e.message)).toEqual(['turn']);
    expect(JSON.stringify(seen)).not.toContain(NAME);
    expect(seen.some((e) => e.message === 'choice')).toBe(false);
  });

  it('and at debug it IS emitted — so the test above is not passing vacuously', () => {
    const seen = emittedAt(resolveLogLevel({ protocol: 'http:' }) as 'debug');
    expect(seen.map((e) => e.message)).toEqual(['choice', 'turn']);
    expect(JSON.stringify(seen)).toContain(NAME);
  });
});
