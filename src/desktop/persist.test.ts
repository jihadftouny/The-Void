import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveRun, loadRun, clearRun, ENVELOPE_VERSION, type RunMeta } from './persist.ts';
import { log, setClock, defaultClock, type LogEntry } from '../log/logger.ts';
import { createGame, step, awaitingFor } from '../game/game.ts';
import type { GameState, StepResult } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { createStoryMemory, rememberBeat } from '../llm/narrate.ts';
import {
  createUnlockStore,
  emptyRunSummary,
  foldRunEvents,
  applyRunSummary,
  type RunSummary,
  type UnlockStore,
} from '../game/unlockStore.ts';
import { heuristicPolicy, mercifulPolicy, ALL_CLASSES } from '../game/sim.ts';
import type { PlayerClass } from '../game/player.ts';

// persist.ts uses the global `localStorage` at call time; install an in-memory
// stand-in so the save/load logic is testable headlessly (node env, no DOM).
function installMemoryLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

/** A meta bundle for the tests that only need the save/load round trip to be well-formed. */
function meta(overrides: Partial<RunMeta> = {}): RunMeta {
  return { runSummary: emptyRunSummary(), runSeed: 1234, ...overrides };
}

describe('persist (desktop save/load)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installMemoryLocalStorage();
  });

  it('round-trips a run (engine state + memory + meta-progression)', () => {
    // CHANGED: `saveRun` gained a REQUIRED third argument. Required on purpose — an optional
    // one lets a call site forget the meta-progression fields, and that omission IS G19.
    const state = createGame(12345);
    let memory = createStoryMemory();
    memory = rememberBeat(memory, [{ kind: 'victory', xpGained: 5, extraRest: false, loot: [] }]);
    const m = meta({ runSeed: 12345, runSummary: { ...emptyRunSummary(), maxAct: 3, spareCount: 2 } });
    saveRun(state, memory, m);
    const loaded = loadRun();
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual(state);
    expect(loaded!.memory.enemiesDefeated).toBe(1);
    expect(loaded!.meta).toEqual(m);
  });

  it('returns null when there is no save', () => {
    expect(loadRun()).toBeNull();
  });

  it('returns null for corrupt or invalid saves', () => {
    store.set('thevoid:run', '{ not json');
    expect(loadRun()).toBeNull();
    store.set('thevoid:run', JSON.stringify({ state: { bogus: true }, memory: { beats: [] } }));
    expect(loadRun()).toBeNull();
  });

  it('clearRun removes the save', () => {
    saveRun(createGame(1), createStoryMemory(), meta());
    expect(loadRun()).not.toBeNull();
    clearRun();
    expect(loadRun()).toBeNull();
  });
});

// =========================================================================================
// The envelope migration. `SAVE_VERSION` is NOT bumped — `GameState` is untouched. Only this
// renderer-side envelope goes v1 -> v2.
// =========================================================================================

/**
 * A REAL v1 envelope, and not a hand-built one. It was produced by checking the WHOLE of
 * `src/` back out at this unit's base commit `497d35b` — the game exactly as it shipped —
 * playing a real 60-step `heuristicPolicy('Scavver')` run of seed 4242 through the real
 * `step`, and dumping what the two-argument `saveRun` wrote to localStorage. That is the
 * point: the thing being proved is that a save made by the shipped game still opens.
 *
 * ⚠ AN EARLIER VERSION OF THIS FIXTURE WAS WRONG, and the comment above it asserted this same
 * claim untruthfully. It was generated after this unit's own G14 loot commit had landed, so
 * its backpack contained `void-draught`, `suture-kit` and `antidote` — catalog consumables
 * that the shipped game could not put in a backpack by any means, which is the entire premise
 * of G14. The envelope was v1-SHAPED but not v1-PROVENANCED. Caught by an adversarial read of
 * the diff, not by any test, because no test can check where a fixture came from.
 *
 * What CAN be checked is the tell, so it is checked below: every backpack entry in a genuine
 * pre-G14 save must be a generated `gen:*` id. If a future edit regenerates this file against
 * the current tree, that assertion goes red and the provenance claim above stops being a
 * promise nobody can audit.
 */
const V1_ENVELOPE = readFileSync(
  fileURLToPath(new URL('./fixtures/v1-run-envelope.json', import.meta.url)),
  'utf8',
);

describe('the envelope migration, v1 -> v2', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installMemoryLocalStorage();
  });

  it('the fixture really IS a v1 envelope written by the old shape', () => {
    // Anchors the fixture itself, so a future edit cannot quietly turn it into a v2 file and
    // leave the migration test passing while testing nothing.
    const raw = JSON.parse(V1_ENVELOPE) as Record<string, unknown>;
    expect(raw.v).toBe(1);
    expect(raw.state).toBeDefined();
    expect(raw.memory).toBeDefined();
    expect(raw.runSummary).toBeUndefined();
    expect(raw.runSeed).toBeUndefined();
  });

  it('...and was really written by the PRE-G14 game, not merely shaped like it', () => {
    // The provenance tell. Before G14 the only thing any loot path could produce was
    // rarity-GENERATED gear carrying a synthetic `gen:*` id — no backpack entry could ever
    // hold a catalog `defId`, which is the whole defect. So a genuine pre-G14 save has an
    // all-`gen:*` backpack, and a fixture regenerated against the CURRENT tree would not.
    //
    // This exists because the first version of this fixture failed exactly that test: it was
    // generated after G14 landed and carried `void-draught` and `suture-kit`, while the
    // comment above claimed it came from the shipped game. A claim about where a file came
    // from is unfalsifiable unless something in the file betrays it — this is that something.
    const raw = JSON.parse(V1_ENVELOPE) as {
      state: { player: { inventory: { backpack: { defId: string }[] } } };
    };
    const backpack = raw.state.player.inventory.backpack;
    expect(backpack.length, 'the fixture run never picked anything up — no tell to check').toBeGreaterThan(0);
    for (const item of backpack) {
      expect(
        item.defId,
        `"${item.defId}" cannot be in a pre-G14 backpack — this fixture was regenerated ` +
          'against the current tree, and the provenance comment above is now false',
      ).toMatch(/^gen:/);
    }
  });

  it('opens a real v1 save, keeps its state and memory, and reports meta: null', () => {
    store.set('thevoid:run', V1_ENVELOPE);
    const loaded = loadRun();
    expect(loaded).not.toBeNull();
    // The run is genuinely there — a real player, mid-descent, with narrative memory.
    expect(loaded!.state.player).not.toBeNull();
    expect(loaded!.state.player!.classId).toBe('Scavver');
    expect(loaded!.state.act).toBeGreaterThanOrEqual(1);
    expect(loaded!.memory.beats.length).toBeGreaterThan(0);
    // ...and the envelope honestly reports that it cannot say what the run has earned.
    expect(loaded!.meta).toBeNull();
  });

  it('never throws on the legacy path', () => {
    store.set('thevoid:run', V1_ENVELOPE);
    expect(() => loadRun()).not.toThrow();
  });

  it('an envelope with NO `v` at all is treated as v1', () => {
    const raw = JSON.parse(V1_ENVELOPE) as Record<string, unknown>;
    delete raw.v;
    store.set('thevoid:run', JSON.stringify(raw));
    const loaded = loadRun();
    expect(loaded).not.toBeNull();
    expect(loaded!.meta).toBeNull();
  });

  it('writes v2, and a FUTURE version is refused rather than half-read', () => {
    saveRun(createGame(7), createStoryMemory(), meta());
    expect(JSON.parse(store.get('thevoid:run')!).v).toBe(ENVELOPE_VERSION);
    const future = JSON.parse(store.get('thevoid:run')!) as Record<string, unknown>;
    future.v = ENVELOPE_VERSION + 1;
    store.set('thevoid:run', JSON.stringify(future));
    expect(loadRun()).toBeNull();
  });

  it('a corrupt meta degrades to meta: null instead of discarding a good run', () => {
    saveRun(createGame(7), createStoryMemory(), meta());
    const env = JSON.parse(store.get('thevoid:run')!) as Record<string, unknown>;
    env.runSummary = { bossKills: 'not-an-array', spareCount: 0, maxAct: 1 };
    store.set('thevoid:run', JSON.stringify(env));
    const loaded = loadRun();
    expect(loaded).not.toBeNull();
    expect(loaded!.meta).toBeNull();
  });

  it('a boss id that is not a real boss is rejected — it would forge a feat', () => {
    // `bossKills` feeds FEATS; `unlock-neuromancer` fires on `bossKills.includes('kingpin')`.
    // A hand-edited save must not be able to smuggle an id in.
    saveRun(createGame(7), createStoryMemory(), meta());
    const env = JSON.parse(store.get('thevoid:run')!) as Record<string, unknown>;
    (env.runSummary as RunSummary).bossKills = ['kingpin', 'not-a-boss'] as never;
    store.set('thevoid:run', JSON.stringify(env));
    expect(loadRun()!.meta).toBeNull();
    // NON-VACUITY: the same envelope with only REAL boss ids loads fine.
    (env.runSummary as RunSummary).bossKills = ['kingpin'];
    store.set('thevoid:run', JSON.stringify(env));
    expect(loadRun()!.meta!.runSummary.bossKills).toEqual(['kingpin']);
  });

  it('a non-finite runSeed is rejected (JSON can carry null, strings and NaN-as-null)', () => {
    saveRun(createGame(7), createStoryMemory(), meta());
    const env = JSON.parse(store.get('thevoid:run')!) as Record<string, unknown>;
    for (const bad of [null, 'abc', undefined]) {
      env.runSeed = bad;
      store.set('thevoid:run', JSON.stringify(env));
      expect(loadRun()!.meta).toBeNull();
    }
  });

  it('the optional summary fields survive a round trip, and stay absent when absent', () => {
    const full: RunSummary = {
      bossKills: ['kingpin', 'reflection'],
      spareCount: 4,
      maxAct: 5,
      endingType: 'grace',
      wonBattleUnhurt: true,
      pendingBoss: 'hollow',
      tookDamageThisBattle: true,
      lastPlayerHp: 17,
    };
    saveRun(createGame(7), createStoryMemory(), meta({ runSummary: full }));
    expect(loadRun()!.meta!.runSummary).toEqual(full);

    const bare = emptyRunSummary();
    saveRun(createGame(7), createStoryMemory(), meta({ runSummary: bare }));
    const back = loadRun()!.meta!.runSummary;
    expect(back).toEqual(bare);
    // Absent must stay ABSENT, not become `undefined`-valued — `exactOptionalPropertyTypes`.
    expect('endingType' in back).toBe(false);
    expect('pendingBoss' in back).toBe(false);
    expect('lastPlayerHp' in back).toBe(false);
  });
});

// =========================================================================================
// G19 -> G1 — a resumed run keeps what it has earned.
//
// The defect is not in `persist.ts` alone; it is the seam between the renderer's run
// bookkeeping and the save. So it is proved end to end: play a REAL run through the REAL
// `step`, folding events exactly as `dispatch` does, and compare the unlock store you end up
// with when you play straight through against the one you get when you quit and resume.
// =========================================================================================

/** Play `seed`/`classId` to its terminal state, optionally quitting and resuming mid-run. */
function playRun(
  seed: number,
  classId: PlayerClass,
  opts: { resume: 'never' | 'restoring' | 'forgetting' },
): { summary: RunSummary; runSeed: number } {
  const policy = classId === 'Scavver' ? mercifulPolicy(classId) : heuristicPolicy(classId);
  let state: GameState = createGame(seed);
  let summary: RunSummary = emptyRunSummary();
  let events: GameEvent[] = [];
  let awaiting = awaitingFor(state.phase);
  let runSeed = seed;
  let resumed = false;
  let steps = 0;

  while (awaiting !== 'game-over' && steps < 200_000) {
    const res: StepResult = step(state, policy({ state, events, awaiting }));
    state = res.state;
    events = res.events;
    awaiting = res.awaiting;
    // Exactly what `dispatch()` does after every step.
    summary = foldRunEvents(summary, res.events, res.state);
    steps += 1;

    // The quit-and-resume point: the first act transition to act 2 or deeper — i.e. the
    // player has already earned `reach-act-2`, and (on some seeds) a boss kill and spares.
    const deepIntro = res.events.some((e) => e.kind === 'act-intro' && e.act >= 2);
    if (!resumed && opts.resume !== 'never' && deepIntro) {
      resumed = true;
      installMemoryLocalStorage();
      saveRun(state, createStoryMemory(), { runSummary: summary, runSeed });
      const loaded = loadRun();
      if (!loaded) throw new Error('the resume point failed to save/load at all');
      state = loaded.state;
      // 'restoring'  — the fix: take the meta back off the envelope.
      // 'forgetting' — today's behaviour: start the tally again from nothing.
      if (opts.resume === 'restoring' && loaded.meta) {
        summary = loaded.meta.runSummary;
        runSeed = loaded.meta.runSeed;
      } else {
        summary = emptyRunSummary();
      }
      awaiting = awaitingFor(state.phase);
      events = [];
    }
  }
  return { summary, runSeed };
}

/** The unlock store a finished run leaves behind, from a fresh install. */
function storeAfter(run: { summary: RunSummary; runSeed: number }): UnlockStore {
  return applyRunSummary(createUnlockStore(), run.summary, run.runSeed).store;
}

const RESUME_SEEDS = [4242, 7, 19, 101, 2026, 555];

describe('G19 — a run resumed from its own save unlocks exactly what it would have', () => {
  it('over 6 seeds x 5 classes, resuming loses nothing', () => {
    let resumePointsHit = 0;
    for (const classId of ALL_CLASSES) {
      for (const seed of RESUME_SEEDS) {
        const straight = playRun(seed, classId, { resume: 'never' });
        const resumed = playRun(seed, classId, { resume: 'restoring' });
        expect(storeAfter(resumed), `seed ${seed} / ${classId}`).toEqual(storeAfter(straight));
        if (resumed.summary.maxAct >= 2) resumePointsHit += 1;
      }
    }
    // NON-VACUITY: at least some of these runs really did reach act 2 and therefore really
    // did quit and resume. If none had, every comparison above would be trivially equal.
    expect(resumePointsHit).toBeGreaterThan(0);
  });

  it("...and TODAY'S behaviour really does lose something (or the test above proves nothing)", () => {
    // The register's reproduction: seed 4242 unlocks the Neuromancer when played straight
    // through and unlocks NOTHING when resumed from its own act-2 state. Asserted here as
    // "at least one seed/class pair loses at least one named feat", so it survives a reshuffle
    // of the RNG stream while still being a real, specific loss.
    const lost: string[] = [];
    for (const classId of ALL_CLASSES) {
      for (const seed of RESUME_SEEDS) {
        const straight = storeAfter(playRun(seed, classId, { resume: 'never' }));
        const forgetful = storeAfter(playRun(seed, classId, { resume: 'forgetting' }));
        for (const feat of straight.feats) {
          if (!forgetful.feats.includes(feat)) lost.push(`${classId}/${seed}: ${feat}`);
        }
      }
    }
    expect(lost.length, 'no feat was lost by forgetting the summary — G19 would be unreal').toBeGreaterThan(0);
    // Name them, so a reviewer can see WHAT the player was losing.
    expect(lost.join(' | ')).toMatch(/reach-act-\d|unlock-\w+|first-boss-kill|win-battle-unhurt/);
  });
});

// =========================================================================================
// PRINCIPLE 7 — every failure path speaks before it recovers, and every duration is
// recorded. ADDED, never substituted: not one assertion above changed, and they are the
// control for "the instrumentation did not change the behaviour it measures".
//
// Durations are measured against the SCRIPTED clock and asserted as EXACT integers. No
// wall clock is read anywhere in this block.
// =========================================================================================

describe('persist reports what it did (principle 7)', () => {
  let entries: LogEntry[] = [];
  let off: () => void = () => undefined;

  beforeEach(() => {
    installMemoryLocalStorage();
    entries = [];
    off = log.addSink((e) => entries.push(e));
    setClock(() => 0);
  });
  afterEach(() => {
    off();
    setClock(defaultClock);
  });

  /** Hand the shared clock a script; each read takes the next value. */
  function scriptClock(values: readonly number[]): void {
    let i = 0;
    setClock(() => values[Math.min(i++, values.length - 1)] as number);
  }

  const saved = (): LogEntry[] => entries.filter((e) => e.category === 'save');
  const withMessage = (m: string): LogEntry[] => saved().filter((e) => e.message === m);
  const dataOf = (e: LogEntry | undefined): Record<string, unknown> =>
    (e?.data ?? {}) as Record<string, unknown>;

  it('a save records its EXACT duration and the real byte count', () => {
    // Clock reads: [start, stop] -> 250 exactly. The byte count is derived independently:
    // it must equal the length of the string that actually landed in storage.
    const state = createGame(999);
    const memory = createStoryMemory();
    const backing = installMemoryLocalStorage();
    entries = [];
    scriptClock([1000, 1250]);
    saveRun(state, memory, meta());
    const entry = withMessage('run saved')[0];
    expect(entry, 'no "run saved" line was emitted').toBeDefined();
    expect(dataOf(entry).ms).toBe(250);
    expect(dataOf(entry).bytes).toBe(backing.get('thevoid:run')!.length);
    expect(dataOf(entry).bytes as number).toBeGreaterThan(0);
  });

  it('a save that takes longer than the threshold escalates to warn', () => {
    // SLOW_MS.save is 100 ms. 99 -> debug (healthy); 100 -> warn (at the boundary).
    const state = createGame(999);
    const memory = createStoryMemory();
    scriptClock([0, 99]);
    saveRun(state, memory, meta());
    expect(withMessage('run saved')[0]?.level).toBe('debug');

    entries = [];
    scriptClock([0, 100]);
    saveRun(state, memory, meta());
    expect(withMessage('run saved')[0]?.level).toBe('warn');
  });

  it('a save that THROWS reports it once, at error, and still does not throw', () => {
    const state = createGame(999);
    const memory = createStoryMemory();
    (globalThis as { localStorage: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError: the disk is full');
      },
      removeItem: () => undefined,
    };
    expect(() => saveRun(state, memory, meta())).not.toThrow();
    const failures = withMessage('save FAILED');
    expect(failures).toHaveLength(1);
    expect(failures[0]!.level).toBe('error');
    expect(dataOf(failures[0]).message).toContain('the disk is full');
    // ...and no success line was emitted alongside it.
    expect(withMessage('run saved')).toHaveLength(0);
  });

  it('clearRun reports a storage failure instead of swallowing it', () => {
    (globalThis as { localStorage: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('removeItem is blocked');
      },
    };
    expect(() => clearRun()).not.toThrow();
    const failures = withMessage('clear FAILED');
    expect(failures).toHaveLength(1);
    expect(failures[0]!.level).toBe('warn');
    expect(dataOf(failures[0]).message).toContain('blocked');
  });

  it('a successful load records ms, bytes, the envelope version and whether meta survived', () => {
    const state = createGame(4242);
    const memory = createStoryMemory();
    const backing = installMemoryLocalStorage();
    // The bytes come from a string this test built, so `data.bytes` has a source
    // independent of the implementation.
    const raw = JSON.stringify({
      v: ENVELOPE_VERSION,
      state,
      memory,
      runSummary: emptyRunSummary(),
      runSeed: 7,
    });
    backing.set('thevoid:run', raw);
    entries = [];
    scriptClock([100, 140]);
    const loaded = loadRun();
    expect(loaded).not.toBeNull();
    const entry = withMessage('run loaded')[0];
    expect(entry, 'no "run loaded" line was emitted').toBeDefined();
    expect(entry!.level).toBe('info'); // 40 ms is well under SLOW_MS.load (250)
    expect(dataOf(entry)).toEqual({ ms: 40, bytes: raw.length, envelope: 2, metaPresent: true });
  });

  it('a slow load escalates to warn at the derived boundary', () => {
    const state = createGame(4242);
    const memory = createStoryMemory();
    saveRun(state, memory, meta());
    entries = [];
    scriptClock([0, 250]); // SLOW_MS.load === 250 => at the boundary, so warn
    loadRun();
    expect(withMessage('run loaded')[0]?.level).toBe('warn');
  });

  // -------------------------------------------------------------------------------------
  // EVERY refusal branch, table-driven, with a DISTINCT reason — and the return value
  // unchanged in each case. Six of these used to be indistinguishable silent `return null`s.
  // -------------------------------------------------------------------------------------
  describe('every refusal says which one it was', () => {
    const RUN_KEY = 'thevoid:run';
    const goodState = createGame(31337);
    const goodMemory = createStoryMemory();

    /** Stage a raw envelope string (or nothing) and load it. */
    function loadWith(raw: string | null): ReturnType<typeof loadRun> {
      const backing = installMemoryLocalStorage();
      if (raw !== null) backing.set(RUN_KEY, raw);
      entries = [];
      return loadRun();
    }

    const envelope = (over: Record<string, unknown>): string =>
      JSON.stringify({
        v: ENVELOPE_VERSION,
        state: goodState,
        memory: goodMemory,
        runSummary: emptyRunSummary(),
        runSeed: 5,
        ...over,
      });

    const CASES: readonly { reason: string; raw: string | null }[] = [
      { reason: 'absent', raw: null },
      { reason: 'not-json', raw: '{not json at all' },
      { reason: 'unknown-version', raw: envelope({ v: 99 }) },
      { reason: 'state-decode-failed', raw: envelope({ state: { nonsense: true } }) },
      { reason: 'memory-invalid', raw: envelope({ memory: { beats: 'not an array' } }) },
      { reason: 'meta-invalid', raw: envelope({ runSummary: { bossKills: ['not-a-boss'] } }) },
    ];

    for (const c of CASES) {
      it(`reports "${c.reason}"`, () => {
        loadWith(c.raw);
        const rejections = withMessage('save rejected');
        expect(rejections, `no rejection line for ${c.reason}`).toHaveLength(1);
        expect(rejections[0]!.level).toBe('warn');
        expect(dataOf(rejections[0]).reason).toBe(c.reason);
      });
    }

    it('a JSON array (valid JSON, wrong shape) is not-json, not a crash', () => {
      loadWith('[1,2,3]');
      expect(dataOf(withMessage('save rejected')[0]).reason).toBe('not-json');
    });

    it('storage that THROWS is "unreadable" — never conflated with bad bytes', () => {
      (globalThis as { localStorage: unknown }).localStorage = {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      };
      entries = [];
      expect(loadRun()).toBeNull();
      const rejections = withMessage('save rejected');
      expect(rejections).toHaveLength(1);
      expect(dataOf(rejections[0]).reason).toBe('unreadable');
    });

    it('the reasons are all DIFFERENT — a shared string answers no question', () => {
      const seen: string[] = [];
      for (const c of CASES) {
        loadWith(c.raw);
        seen.push(String(dataOf(withMessage('save rejected')[0]).reason));
      }
      expect(new Set(seen).size).toBe(CASES.length);
    });

    it('and the RETURN VALUES are exactly what they were (the control)', () => {
      for (const c of CASES) {
        const result = loadWith(c.raw);
        if (c.reason === 'meta-invalid') {
          // A v2 envelope with a corrupt meta still opens the run — it only loses the meta.
          expect(result, c.reason).not.toBeNull();
          expect(result!.meta, c.reason).toBeNull();
        } else {
          expect(result, c.reason).toBeNull();
        }
      }
    });

    it('a v1 envelope warns ONCE about the legacy shape and still returns the run', () => {
      const result = loadWith(JSON.stringify({ state: goodState, memory: goodMemory }));
      expect(result).not.toBeNull();
      expect(result!.meta).toBeNull();
      expect(result!.state).toEqual(goodState);
      const legacy = withMessage('legacy envelope');
      expect(legacy).toHaveLength(1);
      expect(legacy[0]!.level).toBe('warn');
      expect(dataOf(legacy[0]).v).toBe(1);
      // A v1 envelope is NOT also reported as meta-invalid — it has no meta by design.
      expect(withMessage('save rejected')).toHaveLength(0);
    });

    it('a healthy v2 load emits no rejection and no legacy warning at all', () => {
      // Non-vacuity for the whole block: these messages are not simply always present.
      loadWith(envelope({}));
      expect(withMessage('save rejected')).toHaveLength(0);
      expect(withMessage('legacy envelope')).toHaveLength(0);
      expect(withMessage('run loaded')).toHaveLength(1);
    });
  });

  it('no message carries a number or an interpolation — every measurement is in `data`', () => {
    // Principle 7: "Never interpolate a number into a string and lose it." Enforced over
    // every entry this file can emit, so `grep '"ms":'` over a log always works.
    const state = createGame(999);
    const memory = createStoryMemory();
    saveRun(state, memory, meta());
    loadRun();
    const backing = installMemoryLocalStorage();
    backing.set('thevoid:run', '{broken');
    loadRun();
    backing.set('thevoid:run', JSON.stringify({ state: createGame(1), memory: createStoryMemory() }));
    loadRun();
    expect(saved().length, 'nothing was captured — this guard would pass vacuously').toBeGreaterThan(4);
    for (const e of saved()) {
      expect(e.message, `"${e.message}" contains a digit`).toMatch(/^[^0-9]*$/);
      expect(e.message, `"${e.message}" contains an interpolation`).toMatch(/^[^$]*$/);
    }
  });
});
