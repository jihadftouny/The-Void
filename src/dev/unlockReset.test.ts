// The undo for the one destructive thing this unit ships.
//
// A jumped run writes to the REAL unlock store (author's ruling, plan Appendix A.1), so the
// author can hand himself a meta-progression he never earned. This proves the reset button
// genuinely puts it back: unlock something real, reset, and require the store to be
// deep-equal to a brand-new one — through the SHIPPING `loadUnlockStore` ladder, not a
// re-implementation of it.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  UNLOCK_BACKUP_KEY,
  UNLOCK_KEY,
  loadUnlockStore,
  saveUnlockStore,
} from '../storage/unlockStorage.ts';
import {
  applyRunSummary,
  createUnlockStore,
  emptyRunSummary,
  encodeUnlockStore,
} from '../game/unlockStore.ts';
import { UNLOCK_RESET_KEYS, resetUnlockStore } from './unlockReset.ts';

/** A Map-backed stand-in for the browser Storage API (the `unlockStorage.test.ts` idiom). */
function makeFakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const g = globalThis as { window?: unknown };
let fake: ReturnType<typeof makeFakeLocalStorage>;

beforeEach(() => {
  fake = makeFakeLocalStorage();
  g.window = { localStorage: fake };
});
afterEach(() => {
  delete g.window;
});

/**
 * A store grown by a REAL run summary rather than a hand-edited array: a felled Kingpin
 * fires `unlock-neuromancer`, `first-boss-kill` and `reach-act-1`, so the class list, the
 * relic list, the affix list, the family list AND the feat list all move.
 */
function grownStore() {
  return applyRunSummary(
    createUnlockStore(),
    { ...emptyRunSummary(), bossKills: ['kingpin'], maxAct: 1 },
    4242,
  ).store;
}

describe('the unlock store really can be grown by a jumped run (the thing to be undone)', () => {
  it('a felled boss unlocks a class, a relic and an affix, and is persisted', () => {
    // Non-vacuity for every reset assertion below: if nothing were ever unlocked, "the store
    // equals a fresh one after a reset" would hold before the reset too.
    const grown = grownStore();
    expect(grown.classes).toContain('Neuromancer');
    expect(grown.relics).toContain('overclock-chip');
    expect(grown.affixes).toContain('warped');
    expect(grown.feats.length).toBeGreaterThan(0);
    expect(grown).not.toEqual(createUnlockStore());

    saveUnlockStore(grown);
    const loaded = loadUnlockStore();
    expect(loaded.source).toBe('primary');
    expect(loaded.store).toEqual(grown);
  });
});

describe('resetUnlockStore', () => {
  it('restores the FIRST-RUN state: deep-equal to a fresh store, from a fresh source', () => {
    saveUnlockStore(grownStore());
    // A second save, so the backup key really holds something (the rotation ran).
    saveUnlockStore(grownStore());
    expect(fake.map.has(UNLOCK_KEY)).toBe(true);
    expect(fake.map.has(UNLOCK_BACKUP_KEY)).toBe(true);

    const result = resetUnlockStore(fake);
    expect(result.ok).toBe(true);
    expect(result.cleared).toEqual([UNLOCK_KEY, UNLOCK_BACKUP_KEY]);

    const after = loadUnlockStore();
    expect(after.store).toEqual(createUnlockStore());
    // `source` matters as much as the store: a reset that overwrote the primary with a fresh
    // store would satisfy the line above while leaving a stale backup one byte from
    // resurrecting itself.
    expect(after.source).toBe('fresh');
    // ...and nothing is shown to the player, because nothing was LOST — this is a first run.
    expect(after.lost).toBeUndefined();
    expect('lost' in after).toBe(false);
  });

  it('clears BOTH keys — clearing the primary alone restores the old store from backup', () => {
    // The mutation this catches, in the shape it would actually be written: a reset that
    // removes `UNLOCK_KEY` and stops. Run here as the real thing, so the failure mode is
    // demonstrated rather than described.
    saveUnlockStore(grownStore());
    saveUnlockStore(grownStore());
    fake.removeItem(UNLOCK_KEY); // the "obvious" one-key reset

    const halfReset = loadUnlockStore();
    expect(halfReset.source, 'a one-key reset silently did nothing').toBe('backup');
    expect(halfReset.store.classes, 'the unlocks came straight back').toContain('Neuromancer');
    expect(halfReset.lost, 'and the player is shown a recovery notice they never earned').toBeDefined();

    // The real reset then finishes the job.
    resetUnlockStore(fake);
    const full = loadUnlockStore();
    expect(full.store).toEqual(createUnlockStore());
    expect(full.source).toBe('fresh');
  });

  it('a fresh store written over the primary is NOT a reset either (the second shape)', () => {
    // A shape I invented rather than one the plan named: `saveUnlockStore(createUnlockStore())`
    // reads like a reset and passes a naive "the store equals a fresh one" assertion, because
    // the primary now decodes to a fresh store. What it leaves behind is a backup holding
    // everything that was supposed to be gone.
    saveUnlockStore(grownStore());
    saveUnlockStore(createUnlockStore());

    const pseudo = loadUnlockStore();
    expect(pseudo.store, 'the naive assertion passes...').toEqual(createUnlockStore());
    expect(pseudo.source, '...but the source gives it away').toBe('primary');
    expect(fake.map.get(UNLOCK_BACKUP_KEY), 'the grown store survives in the backup').toContain(
      'Neuromancer',
    );

    resetUnlockStore(fake);
    expect(fake.map.get(UNLOCK_BACKUP_KEY)).toBeUndefined();
    expect(loadUnlockStore().source).toBe('fresh');
  });

  it('is idempotent — resetting an already-fresh store is not an error', () => {
    resetUnlockStore(fake);
    const second = resetUnlockStore(fake);
    expect(second.ok).toBe(true);
    expect(loadUnlockStore().store).toEqual(createUnlockStore());
  });

  it('reports a failure instead of throwing when storage refuses', () => {
    const refusing = {
      removeItem: () => {
        throw new Error('quota policy');
      },
    };
    const result = resetUnlockStore(refusing);
    expect(result.ok).toBe(false);
    expect(result.cleared).toEqual([]);
    expect(result.message).toBe('quota policy');
  });

  it('reports a PARTIAL clear rather than claiming success', () => {
    // The second key is where the whole mechanism lives; a reset that got one and not the
    // other must not report `ok`.
    let calls = 0;
    const flaky = {
      removeItem: (key: string) => {
        calls += 1;
        if (calls > 1) throw new Error('storage went away');
        fake.removeItem(key);
      },
    };
    const result = resetUnlockStore(flaky);
    expect(result.ok).toBe(false);
    expect(result.cleared).toEqual([UNLOCK_KEY]);
  });

  it('clears the keys the adapter actually uses, imported rather than re-typed', () => {
    // A reset aimed at a key nobody writes is a reset that does nothing, and it looks
    // identical in a diff. Pin the identity, and pin that the adapter really writes them.
    expect([...UNLOCK_RESET_KEYS]).toEqual([UNLOCK_KEY, UNLOCK_BACKUP_KEY]);
    saveUnlockStore(grownStore());
    saveUnlockStore(grownStore());
    expect([...fake.map.keys()].sort()).toEqual([...UNLOCK_RESET_KEYS].sort());
  });

  it('leaves unrelated keys alone — a run save is not meta-progression', () => {
    fake.setItem('thevoid:run', 'a saved descent');
    fake.setItem(UNLOCK_KEY, encodeUnlockStore(grownStore()));
    resetUnlockStore(fake);
    expect(fake.map.get('thevoid:run')).toBe('a saved descent');
    expect(fake.map.has(UNLOCK_KEY)).toBe(false);
  });
});
