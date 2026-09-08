// The browser `localStorage` adapter for the player's preferences (PLAN.md #8 / FINDINGS B1).
//
// Runs under Vitest's `node` environment, where there is no real `window`. Two paths, both
// exercised: the no-op behaviour with no storage at all, and a real round trip against an
// injected fake `window.localStorage`. The fake and the `g.window` teardown are copied from
// `unlockStorage.test.ts` deliberately — one storage-testing idiom, not two.
//
// THE HALF THAT MATTERS MOST IS THE LOGGING. This adapter RECOVERS: a corrupt payload
// silently becomes the defaults, which is the right behaviour and also exactly the shape
// that destroys the evidence a bug report needs (principle 7). A player writing "my text
// size keeps resetting" is describing a log line that has to exist. So the recovery paths
// are asserted to SPEAK, and — just as importantly — the two normal paths are asserted to
// stay silent, because a warning that fires on every headless test run is a warning nobody
// reads by the time it matters.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { log, type LogEntry } from '../log/logger.ts';
import { SETTINGS_KEY, loadSettings, saveSettings } from './settingsStorage.ts';
import {
  DEFAULT_SETTINGS,
  serializeSettings,
  type Settings,
} from '../render/settings-model.ts';

/** A minimal Map-backed stand-in for the browser Storage API. */
function makeFakeLocalStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const g = globalThis as { window?: unknown };

afterEach(() => {
  delete g.window;
});

const CHANGED: Settings = { v: 1, textScale: 'large', motion: 'reduce', contrast: 'high' };

describe('under Node, with no window at all', () => {
  it('loadSettings returns the defaults instead of throwing', () => {
    expect(g.window).toBeUndefined();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings is a silent no-op', () => {
    expect(() => saveSettings(CHANGED)).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('with a real storage, preferences survive a restart', () => {
  it('round-trips every field', () => {
    g.window = { localStorage: makeFakeLocalStorage() };
    saveSettings(CHANGED);
    expect(loadSettings()).toEqual(CHANGED);
  });

  it('writes under ONE key, and that key is namespaced to this game', () => {
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };
    saveSettings(CHANGED);
    // The probe key must not survive the probe.
    expect([...fake.map.keys()]).toEqual([SETTINGS_KEY]);
    expect(SETTINGS_KEY).toBe('thevoid:settings');
  });

  it('and a later save replaces the earlier one rather than accumulating', () => {
    g.window = { localStorage: makeFakeLocalStorage() };
    saveSettings(CHANGED);
    saveSettings({ ...CHANGED, textScale: 'small' });
    expect(loadSettings().textScale).toBe('small');
  });

  it('nothing stored yet gives the defaults — a first run is not a failure', () => {
    g.window = { localStorage: makeFakeLocalStorage() };
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('a corrupt payload gives the defaults instead of a half-read object', () => {
    const fake = makeFakeLocalStorage();
    fake.map.set(SETTINGS_KEY, '{not json at all');
    g.window = { localStorage: fake };
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('and so does a well-formed payload from another version', () => {
    const fake = makeFakeLocalStorage();
    fake.map.set(SETTINGS_KEY, JSON.stringify({ v: 99, textScale: 'large' }));
    g.window = { localStorage: fake };
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('a storage that THROWS on read degrades to the defaults, not to a crash', () => {
    g.window = {
      localStorage: {
        getItem: () => {
          throw new Error('policy blocked');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    };
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('a storage that THROWS on write never takes a run down with it', () => {
    let probed = 0;
    g.window = {
      localStorage: {
        getItem: () => null,
        setItem: (k: string) => {
          // The probe must succeed or the adapter decides there is no storage at all and
          // never reaches the real write — which would make this test prove nothing.
          if (k.includes('probe')) {
            probed += 1;
            return;
          }
          throw new Error('quota exceeded');
        },
        removeItem: () => undefined,
      },
    };
    expect(() => saveSettings(CHANGED)).not.toThrow();
    expect(probed, 'the probe never ran — the failing write was never reached').toBeGreaterThan(0);
  });
});

// =========================================================================================
// Principle 7 — every failure path speaks before it recovers.
// =========================================================================================

describe('the recovery paths report themselves (principle 7)', () => {
  let entries: LogEntry[] = [];
  let off: () => void = () => undefined;

  beforeEach(() => {
    entries = [];
    off = log.addSink((e) => entries.push(e));
  });
  afterEach(() => {
    off();
  });

  const settingsEntries = (): LogEntry[] => entries.filter((e) => e.category === 'settings');

  it('says NOTHING on the two normal paths (or the warnings below mean nothing)', () => {
    // No storage at all — the Vitest default — and a first run with an empty storage. Both
    // are ordinary. Crying wolf here trains the reader to ignore the case that matters.
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    g.window = { localStorage: makeFakeLocalStorage() };
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings(CHANGED);
    expect(loadSettings()).toEqual(CHANGED);
    expect(settingsEntries()).toEqual([]);
  });

  it('and nothing when the stored payload reads back cleanly', () => {
    const fake = makeFakeLocalStorage();
    fake.map.set(SETTINGS_KEY, serializeSettings(CHANGED));
    g.window = { localStorage: fake };
    entries = [];
    expect(loadSettings()).toEqual(CHANGED);
    expect(settingsEntries()).toEqual([]);
  });

  it('SPEAKS when a stored payload could not be parsed, before returning the defaults', () => {
    const fake = makeFakeLocalStorage();
    fake.map.set(SETTINGS_KEY, '{"v":1,"textScale":');
    g.window = { localStorage: fake };
    entries = [];
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    const warned = settingsEntries();
    expect(warned.length, 'the settings silently reverted with no trace').toBe(1);
    expect(warned[0]?.level).toBe('warn');
    // The number lives in `data`, never interpolated into the message — the house rule that
    // keeps a log greppable.
    expect(warned[0]?.message).not.toMatch(/[0-9]/);
    // 19 = the length of `{"v":1,"textScale":`, counted by hand: 1 brace + "v" (3) + ':'
    // + '1' + ',' + "textScale" (11) + ':'.
    expect((warned[0]?.data as { bytes?: number } | undefined)?.bytes).toBe(19);
  });

  it('SPEAKS when the storage itself refuses to be read', () => {
    g.window = {
      localStorage: {
        getItem: () => {
          throw new Error('policy blocked');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    };
    entries = [];
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(settingsEntries().length, 'an unreadable storage said nothing').toBe(1);
    expect(settingsEntries()[0]?.level).toBe('warn');
  });

  it('SPEAKS when a write is refused, rather than losing the preference in silence', () => {
    g.window = {
      localStorage: {
        getItem: () => null,
        setItem: (k: string) => {
          if (k.includes('probe')) return;
          throw new Error('quota exceeded');
        },
        removeItem: () => undefined,
      },
    };
    entries = [];
    saveSettings(CHANGED);
    expect(settingsEntries().length, 'a refused write said nothing').toBe(1);
    expect(settingsEntries()[0]?.level).toBe('warn');
    expect((settingsEntries()[0]?.data as { message?: string } | undefined)?.message).toContain(
      'quota',
    );
  });

  it('and every line it emits is JSON-serializable structured data', () => {
    const fake = makeFakeLocalStorage();
    fake.map.set(SETTINGS_KEY, 'nonsense');
    g.window = { localStorage: fake };
    entries = [];
    loadSettings();
    for (const entry of settingsEntries()) {
      expect(() => JSON.stringify(entry)).not.toThrow();
      expect(typeof entry.category).toBe('string');
      expect(typeof entry.message).toBe('string');
    }
  });
});
