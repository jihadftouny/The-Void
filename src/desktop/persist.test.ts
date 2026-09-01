import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { saveRun, loadRun, clearRun, ENVELOPE_VERSION, type RunMeta } from './persist.ts';
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
 * A REAL v1 envelope. Not hand-built: this file was produced by running the SHIPPED v1
 * `saveRun` over a real 60-step `heuristicPolicy('Scavver')` run of seed 4242 and dumping
 * what it wrote to localStorage, before this unit changed a line of `persist.ts`. That is the
 * point — the thing being proved is that a save made by the game as it shipped still opens.
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
