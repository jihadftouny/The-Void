// Tests for the browser localStorage adapter for the unlock store (M13, + G3).
//
// Runs under Vitest's `node` environment — there is no real `window`/`localStorage`. Two
// paths: (1) the no-op / default-store behavior when no storage exists, and (2) a real
// round-trip against an injected fake `window.localStorage`.
//
// CHANGED for G3: `loadUnlockStore` returns an `UnlockLoadResult` (`{ store, source, lost? }`)
// instead of a bare `UnlockStore`. Every pre-existing behaviour assertion below is preserved
// VERBATIM, reading `.store`. The reason for the signature change is the defect itself: the
// old shape made SILENT TOTAL LOSS the only possible outcome of one unparseable byte, and
// that silence is G3. A caller that cannot tell "loaded fine" from "everything you ever
// earned is gone" cannot tell the player either.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import {
  UNLOCK_KEY,
  UNLOCK_BACKUP_KEY,
  loadUnlockStore,
  saveUnlockStore,
} from './unlockStorage.ts';
import {
  createUnlockStore,
  encodeUnlockStore,
  applyRunSummary,
  emptyRunSummary,
} from '../game/unlockStore.ts';

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

/** A store grown by a real run summary — Neuromancer + first-boss-kill unlocked. */
function grownStore() {
  return applyRunSummary(createUnlockStore(), { ...emptyRunSummary(), bossKills: ['kingpin'] }, 1)
    .store;
}

describe('the pure store core stays DOM-free (load-bearing principle 1)', () => {
  it('src/game/unlockStore.ts references no localStorage / window / document', () => {
    const src = readFileSync(fileURLToPath(new URL('../game/unlockStore.ts', import.meta.url)), 'utf8');
    // Strip line comments so prose never trips the scan; then assert the DOM surface is absent.
    const code = src.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\blocalStorage\b/);
    expect(code).not.toMatch(/\bwindow\b/);
    expect(code).not.toMatch(/\bdocument\b/);
  });
});

describe('under Node (no window)', () => {
  it('loadUnlockStore returns a fresh default store', () => {
    expect(g.window).toBeUndefined();
    expect(loadUnlockStore().store).toEqual(createUnlockStore());
  });

  it('saveUnlockStore is a silent no-op (does not throw)', () => {
    expect(() => saveUnlockStore(createUnlockStore())).not.toThrow();
    // Still a default store — nothing persisted.
    expect(loadUnlockStore().store).toEqual(createUnlockStore());
  });

  it('and reports it as `fresh` with NO alarm — headless is normal, not a loss', () => {
    // Crying wolf here would train the reader to ignore the one case that matters.
    const result = loadUnlockStore();
    expect(result.source).toBe('fresh');
    expect(result.lost).toBeUndefined();
  });
});

describe('with an injected fake window.localStorage', () => {
  it('save -> load round-trips a grown store under the unlock key', () => {
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };

    const grown = grownStore();
    saveUnlockStore(grown);
    // The adapter writes under the dedicated unlock key (separate from the run save).
    expect(fake.map.get(UNLOCK_KEY)).toBe(encodeUnlockStore(grown));
    expect(loadUnlockStore().store).toEqual(grown);
  });

  it('a corrupt payload degrades to a fresh default store (never throws)', () => {
    const fake = makeFakeLocalStorage();
    fake.map.set(UNLOCK_KEY, 'not-json{');
    g.window = { localStorage: fake };
    expect(loadUnlockStore().store).toEqual(createUnlockStore());
  });

  it('falls back to a default store when the probe write throws', () => {
    // A localStorage whose setItem always throws (blocked/quota-0) is treated as unavailable.
    g.window = {
      localStorage: {
        getItem: () => encodeUnlockStore(createUnlockStore()),
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
        removeItem: () => {},
      },
    };
    expect(() => saveUnlockStore(createUnlockStore())).not.toThrow();
    expect(loadUnlockStore().store).toEqual(createUnlockStore());
  });
});

// =========================================================================================
// G3 — a corrupt unlock store no longer erases you.
// =========================================================================================

describe('G3 — the backup ladder', () => {
  it('a clean load reports `primary` and says nothing to the player', () => {
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };
    saveUnlockStore(grownStore());
    const result = loadUnlockStore();
    expect(result.source).toBe('primary');
    expect(result.lost).toBeUndefined();
  });

  it('a first run reports `fresh` and says nothing either — nothing was lost', () => {
    g.window = { localStorage: makeFakeLocalStorage() };
    const result = loadUnlockStore();
    expect(result.source).toBe('fresh');
    expect(result.lost).toBeUndefined();
    expect(result.store).toEqual(createUnlockStore());
  });

  it('a damaged PRIMARY is recovered from the backup, feats and all', () => {
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };

    const grown = grownStore();
    saveUnlockStore(grown);
    // The specific thing that must survive: felling the Kingpin unlocked the Neuromancer.
    expect(grown.feats).toContain('unlock-neuromancer');
    expect(grown.classes).toContain('Neuromancer');

    fake.map.set(UNLOCK_KEY, '{"version":1,"classes":[');

    const result = loadUnlockStore();
    expect(result.source).toBe('backup');
    expect(result.store.feats).toContain('unlock-neuromancer');
    expect(result.store.classes).toContain('Neuromancer');
    expect(result.store).toEqual(grown);
    // ...and the player is told, in words a person can read.
    expect(result.lost).toBeDefined();
    expect(result.lost!.length).toBeGreaterThan(20);
    expect(result.lost).toMatch(/backup/i);
  });

  it('BOTH copies corrupt: a fresh store, said out loud, and never a throw', () => {
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };
    saveUnlockStore(grownStore());
    fake.map.set(UNLOCK_KEY, 'not-json{');
    fake.map.set(UNLOCK_BACKUP_KEY, 'also-not-json{');

    let result!: ReturnType<typeof loadUnlockStore>;
    expect(() => {
      result = loadUnlockStore();
    }).not.toThrow();
    expect(result.source).toBe('fresh');
    expect(result.store).toEqual(createUnlockStore());
    expect(result.lost).toBeDefined();
    expect(result.lost!.length).toBeGreaterThan(20);
    // It must not pretend a backup saved anything.
    expect(result.lost).not.toMatch(/restored/i);
  });

  it('a store DECODED FROM A FUTURE VERSION is treated as unreadable, not half-read', () => {
    // `decodeUnlockStore` rejects a future version outright. That must route to the backup,
    // not to a silent wipe.
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };
    const grown = grownStore();
    saveUnlockStore(grown);
    fake.map.set(UNLOCK_KEY, JSON.stringify({ ...grown, version: 99 }));
    const result = loadUnlockStore();
    expect(result.source).toBe('backup');
    expect(result.store).toEqual(grown);
  });

  it('the rotation is GUARDED — a corrupt primary never overwrites a good backup', () => {
    // The failure this whole mechanism exists to prevent. Save a good store (backup seeded),
    // corrupt the primary, then save AGAIN: an unguarded rotation would copy the corruption
    // across and destroy the last good copy on the very next write.
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };

    const first = grownStore();
    saveUnlockStore(first);
    fake.map.set(UNLOCK_KEY, 'corrupted-between-sessions{');

    const second = createUnlockStore(); // a fresh, feat-less store, as a wiped session would write
    saveUnlockStore(second);

    // The backup still holds the GOOD first store, not the corruption and not the empty one.
    expect(loadUnlockStore().store).toEqual(second); // the primary is now valid again
    fake.map.set(UNLOCK_KEY, 'corrupted-again{');
    const recovered = loadUnlockStore();
    expect(recovered.source).toBe('backup');
    expect(recovered.store.feats).toContain('unlock-neuromancer');
  });

  it('the backup exists from the very FIRST save, not the second', () => {
    // Without seeding, a player who is corrupted after exactly one completed run would have
    // no backup at all — the commonest possible case for a new install.
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };
    const grown = grownStore();
    saveUnlockStore(grown);
    expect(fake.map.get(UNLOCK_BACKUP_KEY)).toBe(encodeUnlockStore(grown));
  });

  it('the backup is ONE GENERATION BEHIND, which is the documented trade', () => {
    // Recovery costs at most the last completed run. Asserted so the trade is a decision on
    // the record rather than an accident of the implementation.
    const fake = makeFakeLocalStorage();
    g.window = { localStorage: fake };
    const runOne = grownStore();
    saveUnlockStore(runOne);
    const runTwo = applyRunSummary(runOne, { ...emptyRunSummary(), spareCount: 3 }, 2).store;
    expect(runTwo.classes).toContain('Scavver'); // run two earned the Scavver
    saveUnlockStore(runTwo);

    fake.map.set(UNLOCK_KEY, 'gone{');
    const recovered = loadUnlockStore();
    expect(recovered.source).toBe('backup');
    expect(recovered.store).toEqual(runOne);
    expect(recovered.store.classes).not.toContain('Scavver'); // run two's gain is the cost
    expect(recovered.store.classes).toContain('Neuromancer'); // run one's is kept
  });
});
