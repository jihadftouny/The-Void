import { describe, expect, it } from 'vitest';
import {
  createUnlockStore,
  UNLOCK_STORE_VERSION,
  DEFAULT_FAMILIES,
  DEFAULT_AFFIXES,
  selectableClasses,
  classUnlocked,
  unlockedFamilySet,
  unlockedAffixSet,
  snapshotUnlocks,
  emptyRunSummary,
  foldRunEvents,
  applyRunSummary,
  encodeUnlockStore,
  decodeUnlockStore,
  type RunSummary,
  type UnlockStore,
} from './unlockStore.ts';
import { step, type GameState } from './game.ts';
import { createPlayer } from './player.ts';
import { FAMILIES } from './enemyFamily.ts';
import { AFFIXES } from './enemyAffix.ts';
import { createKarma } from './karma.ts';
import { type Stats } from './character.ts';
import { type GameEvent } from './gameEvent.ts';

// Independent oracles, hand-listed from the plan's Design (§ default front-load set) — NOT
// read back from the module's consts.
const FRONT_LOAD_FAMILIES = [
  'gangers',
  'securityDrones',
  'mutantStrays',
  'reflections',
  'distortions',
  'grief',
  'rage',
  'ashWraiths',
  'choir',
  'theJudged',
  'demons',
  'echoesOfYou',
];
const FRONT_LOAD_AFFIXES = ['ravenous', 'ancient'];

function stats(): Stats {
  return { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 };
}

/** Build a RunSummary from partial overrides atop an empty one. */
function summaryOf(partial: Partial<RunSummary>): RunSummary {
  return { ...emptyRunSummary(), ...partial };
}

const victoryEvent: GameEvent = { kind: 'victory', xpGained: 0, extraRest: false, loot: [] };

// ------- Front-load default --------------------------------------------------

describe('createUnlockStore — the front-load default', () => {
  it('makes ONLY the Enforcer selectable', () => {
    const store = createUnlockStore();
    expect(selectableClasses(store)).toEqual(['Enforcer']);
    expect(classUnlocked(store, 'Enforcer')).toBe(true);
    for (const c of ['Neuromancer', 'Scavver', 'Penitent', 'Hollow'] as const) {
      expect(classUnlocked(store, c)).toBe(false);
    }
  });

  it('unlocks the curated front-load family subset — a STRICT subset of the 24 roster', () => {
    const store = createUnlockStore();
    expect(store.families).toEqual(FRONT_LOAD_FAMILIES);
    expect(DEFAULT_FAMILIES).toEqual(FRONT_LOAD_FAMILIES);
    // Every default family is a real roster id.
    const rosterIds = new Set(FAMILIES.map((f) => f.id));
    for (const id of store.families) expect(rosterIds.has(id)).toBe(true);
    // Strict subset: fewer than the full 24, and at least one roster family is withheld.
    expect(store.families.length).toBeLessThan(FAMILIES.length);
    const withheld = FAMILIES.map((f) => f.id).filter((id) => !store.families.includes(id));
    expect(withheld).toContain('cyberEnforcers'); // a long-tail floor-1 family
    expect(withheld).toContain('fixers');
  });

  it('front-loads exactly 2 of the 5 affixes (a strict subset)', () => {
    const store = createUnlockStore();
    expect(store.affixes).toEqual(FRONT_LOAD_AFFIXES);
    expect(DEFAULT_AFFIXES).toEqual(FRONT_LOAD_AFFIXES);
    const affixIds = new Set(AFFIXES.map((a) => a.id));
    for (const id of store.affixes) expect(affixIds.has(id)).toBe(true);
    expect(store.affixes.length).toBe(2);
    expect(AFFIXES.length).toBe(5);
    expect(store.affixes.length).toBeLessThan(AFFIXES.length);
  });

  it('the default store carries the module version and no feats / memory', () => {
    const store = createUnlockStore();
    expect(store.version).toBe(UNLOCK_STORE_VERSION);
    expect(store.feats).toEqual([]);
    expect(store.karmaMemory).toEqual([]);
    expect(store.classes).toEqual(['Enforcer']);
  });

  it('snapshotUnlocks copies the two run-relevant sets independently', () => {
    const store = createUnlockStore();
    const snap = snapshotUnlocks(store);
    expect(snap.families).toEqual(FRONT_LOAD_FAMILIES);
    expect(snap.affixes).toEqual(FRONT_LOAD_AFFIXES);
    // Mutating the snapshot must not touch the store (frozen copy).
    snap.families.push('mutant-injection');
    expect(store.families).toEqual(FRONT_LOAD_FAMILIES);
  });
});

// ------- Class-unlock feats --------------------------------------------------

describe('class unlock feats fire on their real events', () => {
  it('Neuromancer unlocks from beating the act-1 Kingpin', () => {
    const before = createUnlockStore();
    expect(selectableClasses(before)).not.toContain('Neuromancer');
    const { store } = applyRunSummary(before, summaryOf({ bossKills: ['kingpin'] }), 1);
    expect(selectableClasses(store)).toContain('Neuromancer');
  });

  it('a run with no Kingpin kill does not unlock Neuromancer', () => {
    const { store } = applyRunSummary(createUnlockStore(), summaryOf({ bossKills: ['reflection'] }), 1);
    expect(classUnlocked(store, 'Neuromancer')).toBe(false);
  });

  it('Scavver unlocks at EXACTLY 3 karma-weighted spares, not 2', () => {
    const at3 = applyRunSummary(createUnlockStore(), summaryOf({ spareCount: 3 }), 1).store;
    expect(classUnlocked(at3, 'Scavver')).toBe(true);
    const at2 = applyRunSummary(createUnlockStore(), summaryOf({ spareCount: 2 }), 1).store;
    expect(classUnlocked(at2, 'Scavver')).toBe(false);
  });

  it('Penitent unlocks from the GRACE ending only', () => {
    expect(
      classUnlocked(applyRunSummary(createUnlockStore(), summaryOf({ endingType: 'grace' }), 1).store, 'Penitent'),
    ).toBe(true);
    expect(
      classUnlocked(applyRunSummary(createUnlockStore(), summaryOf({ endingType: 'damnation' }), 1).store, 'Penitent'),
    ).toBe(false);
    expect(classUnlocked(applyRunSummary(createUnlockStore(), summaryOf({}), 1).store, 'Penitent')).toBe(false);
  });

  it('Hollow unlocks from the DAMNATION ending only', () => {
    expect(
      classUnlocked(applyRunSummary(createUnlockStore(), summaryOf({ endingType: 'damnation' }), 1).store, 'Hollow'),
    ).toBe(true);
    expect(
      classUnlocked(applyRunSummary(createUnlockStore(), summaryOf({ endingType: 'grace' }), 1).store, 'Hollow'),
    ).toBe(false);
    expect(classUnlocked(applyRunSummary(createUnlockStore(), summaryOf({}), 1).store, 'Hollow')).toBe(false);
  });
});

// ------- Progression / mastery feats ----------------------------------------

describe('progression + mastery feats fire on the right events', () => {
  it('reaching act 2 grants floors 1 AND 2 long-tail families (reach-act-1 + reach-act-2)', () => {
    const { store, newlyUnlocked } = applyRunSummary(createUnlockStore(), summaryOf({ maxAct: 2 }), 1);
    // Independent oracle from the plan's long-tail list.
    expect(new Set(newlyUnlocked.families)).toEqual(
      new Set(['cyberEnforcers', 'fixers', 'mirrorSelves', 'staticWraiths']),
    );
    const fams = unlockedFamilySet(store);
    for (const id of ['cyberEnforcers', 'fixers', 'mirrorSelves', 'staticWraiths']) {
      expect(fams.has(id)).toBe(true);
    }
    // Deeper floors stay locked at maxAct 2.
    expect(fams.has('dread')).toBe(false);
    expect(fams.has('theHollowed')).toBe(false);
  });

  it('reaching act 5 grants every floor long-tail family', () => {
    const { store } = applyRunSummary(createUnlockStore(), summaryOf({ maxAct: 5 }), 1);
    const fams = unlockedFamilySet(store);
    // Every one of the 24 families is now unlocked (front-load + the whole long tail).
    for (const f of FAMILIES) expect(fams.has(f.id)).toBe(true);
  });

  it('maxAct 1 grants only the floor-1 long tail (no deeper families)', () => {
    const { newlyUnlocked } = applyRunSummary(createUnlockStore(), summaryOf({ maxAct: 1 }), 1);
    expect(new Set(newlyUnlocked.families)).toEqual(new Set(['cyberEnforcers', 'fixers']));
  });

  it('the first boss kill grants a themed relic + the warped affix', () => {
    const { store, newlyUnlocked } = applyRunSummary(createUnlockStore(), summaryOf({ bossKills: ['reflection'] }), 1);
    expect(newlyUnlocked.relics).toContain('overclock-chip');
    expect(newlyUnlocked.affixes).toContain('warped');
    expect(store.relics).toContain('overclock-chip');
    expect(unlockedAffixSet(store).has('warped')).toBe(true);
    // No boss kill ⇒ no such grants.
    const none = applyRunSummary(createUnlockStore(), summaryOf({}), 1);
    expect(none.newlyUnlocked.relics).toEqual([]);
    expect(none.newlyUnlocked.affixes).toEqual([]);
  });

  it('winning a battle unhurt grants a defensive relic; taking damage does not', () => {
    const unhurt = applyRunSummary(createUnlockStore(), summaryOf({ wonBattleUnhurt: true }), 1);
    expect(unhurt.store.relics).toContain('scrap-plating');
    const hurt = applyRunSummary(createUnlockStore(), summaryOf({ wonBattleUnhurt: false }), 1);
    expect(hurt.store.relics).not.toContain('scrap-plating');
  });
});

// ------- Idempotence + accumulation -----------------------------------------

describe('applyRunSummary idempotence + accumulation', () => {
  it('applying the same summary twice adds each feat grant only once', () => {
    const first = applyRunSummary(createUnlockStore(), summaryOf({ bossKills: ['kingpin'] }), 1);
    const second = applyRunSummary(first.store, summaryOf({ bossKills: ['kingpin'] }), 2);
    // The second pass grants nothing new (feats are a set).
    expect(second.newlyUnlocked.feats).toEqual([]);
    expect(second.newlyUnlocked.classes).toEqual([]);
    expect(second.store.classes).toEqual(first.store.classes);
    expect(second.store.relics).toEqual(first.store.relics);
    expect(second.store.affixes).toEqual(first.store.affixes);
    expect(second.store.feats).toEqual(first.store.feats);
    // Each apply appends exactly one flavor memory record.
    expect(second.store.karmaMemory).toHaveLength(2);
    expect(second.store.karmaMemory[1]!.runId).toBe(2);
  });

  it("a later run unions in only the newly-met feats", () => {
    const run1 = applyRunSummary(createUnlockStore(), summaryOf({ bossKills: ['kingpin'] }), 1);
    expect(selectableClasses(run1.store)).toEqual(['Enforcer', 'Neuromancer']);
    const run2 = applyRunSummary(run1.store, summaryOf({ endingType: 'grace' }), 2);
    // Penitent adds; Neuromancer persists; the run-2 pass reports only Penitent as new.
    expect(run2.newlyUnlocked.classes).toEqual(['Penitent']);
    expect(selectableClasses(run2.store)).toEqual(['Enforcer', 'Neuromancer', 'Penitent']);
  });
});

// ------- foldRunEvents (synthetic, fully controlled) -------------------------

describe('foldRunEvents — pure reducer over the event stream', () => {
  const noPlayer = { player: null };

  it('player-created sets maxAct to at least 1', () => {
    const s = foldRunEvents(emptyRunSummary(), [{ kind: 'player-created', name: 'H', classId: 'Enforcer', maxHp: 10, armorClass: 12 }], noPlayer);
    expect(s.maxAct).toBe(1);
  });

  it('act-intro raises maxAct to the intro act; final-battle-begins raises it to 5', () => {
    let s = foldRunEvents(emptyRunSummary(), [{ kind: 'act-intro', act: 3, header: '', body: '' }], noPlayer);
    expect(s.maxAct).toBe(3);
    // A lower act-intro never lowers the watermark.
    s = foldRunEvents(s, [{ kind: 'act-intro', act: 2, header: '', body: '' }], noPlayer);
    expect(s.maxAct).toBe(3);
    s = foldRunEvents(s, [{ kind: 'final-battle-begins', enemyName: 'Hollow Self' }], noPlayer);
    expect(s.maxAct).toBe(5);
  });

  it('spared events accumulate the karma-weighted spare count', () => {
    let s = emptyRunSummary();
    for (let i = 0; i < 3; i++) {
      s = foldRunEvents(s, [{ kind: 'spared', enemyName: 'Ganger' }], noPlayer);
    }
    expect(s.spareCount).toBe(3);
  });

  it('a boss-encounter then a no-damage victory records the kill AND wonBattleUnhurt', () => {
    // Step A: boss appears, player at 20 HP (watermark set to 20, damage flag reset).
    let s = foldRunEvents(emptyRunSummary(), [{ kind: 'boss-encounter', bossId: 'kingpin', enemyName: 'Undercity Kingpin' }], { player: { hp: 20 } });
    // Step B: victory, still 20 HP (no net loss) ⇒ unhurt.
    s = foldRunEvents(s, [victoryEvent], { player: { hp: 20 } });
    expect(s.bossKills).toEqual(['kingpin']);
    expect(s.wonBattleUnhurt).toBe(true);
    expect(s.pendingBoss).toBeUndefined();
  });

  it('a victory after an HP drop records the kill but NOT wonBattleUnhurt', () => {
    let s = foldRunEvents(emptyRunSummary(), [{ kind: 'boss-encounter', bossId: 'kingpin', enemyName: 'Undercity Kingpin' }], { player: { hp: 20 } });
    // Victory step where HP fell 20 -> 12: the drop is seen before the victory resolves.
    s = foldRunEvents(s, [victoryEvent], { player: { hp: 12 } });
    expect(s.bossKills).toEqual(['kingpin']);
    expect(s.wonBattleUnhurt).toBe(false);
  });

  it('a plain encounter won without damage sets wonBattleUnhurt', () => {
    let s = foldRunEvents(emptyRunSummary(), [{ kind: 'encounter-start', enemyName: 'Security Drone' }], { player: { hp: 30 } });
    s = foldRunEvents(s, [victoryEvent], { player: { hp: 30 } });
    expect(s.wonBattleUnhurt).toBe(true);
    expect(s.bossKills).toEqual([]); // no boss pending ⇒ no boss kill
  });

  it('ending records the ending type', () => {
    const s = foldRunEvents(emptyRunSummary(), [{ kind: 'ending', endingType: 'grace', header: '', body: '' }], noPlayer);
    expect(s.endingType).toBe('grace');
  });

  it('does not mutate the input summary', () => {
    const input = emptyRunSummary();
    foldRunEvents(input, [{ kind: 'spared', enemyName: 'X' }], noPlayer);
    expect(input.spareCount).toBe(0);
  });
});

// ------- foldRunEvents over a full seeded, driven run ------------------------

describe('foldRunEvents over a full driven step loop', () => {
  it('a create -> act-1 boss win -> advance run folds to the hand-derived summary', () => {
    // A parked, unkillable, high-level player so the boss xp never owes a level-up and the
    // fight cannot end in death (isolates the boss-kill + act-advance path).
    const player = {
      ...createPlayer({ name: 'Zara', classId: 'Enforcer', stats: stats() }),
      xp: 20, // past the act-1 gate (10) so `continue` opens the Kingpin
      level: 999,
      hp: 9999,
      maxHp: 9999,
      advantageDisadvantage: 1,
    };
    const start: GameState = {
      version: 8,
      rngState: 4242,
      player,
      act: 1,
      place: 0,
      karma: createKarma(),
      phase: { kind: 'main-menu' },
    };

    let summary = emptyRunSummary();
    // Step 1: continue -> the Kingpin boss encounter.
    let r = step(start, { kind: 'menu', choice: 'continue' });
    summary = foldRunEvents(summary, r.events, r.state);
    expect(r.events.some((e) => e.kind === 'boss-encounter')).toBe(true);

    // Weaken the freshly-built boss to 1 HP / no offense so the player one-shots it, taking
    // no damage (test scaffolding — the same technique the M12 suite uses).
    if (r.state.phase.kind !== 'battle') throw new Error('expected the boss battle');
    const weakened: GameState = {
      ...r.state,
      phase: {
        ...r.state.phase,
        battle: {
          ...r.state.phase.battle,
          enemy: {
            ...r.state.phase.battle.enemy,
            hp: 1,
            maxHp: 1,
            armorClass: 1,
            skillPool: [],
            skillCharges: 0,
          },
        },
      },
    };

    // Step 2: start the battle.
    r = step(weakened, { kind: 'continue' });
    summary = foldRunEvents(summary, r.events, r.state);

    // Fight until the boss falls.
    let guard = 0;
    while (r.state.phase.kind === 'battle' && guard++ < 20) {
      r = step(r.state, { kind: 'battle-action', action: 'fight' });
      summary = foldRunEvents(summary, r.events, r.state);
    }
    expect(r.state.phase.kind).toBe('battle-victory');
    // The one-shot kept the player at full HP (no enemy action) — hand-derived unhurt=true.
    expect(r.state.player?.hp).toBe(9999);

    // Continue: no level owed (level 999) -> act-outro, then act-intro{2}.
    r = step(r.state, { kind: 'continue' });
    summary = foldRunEvents(summary, r.events, r.state);
    expect(r.state.phase.kind).toBe('act-outro');
    r = step(r.state, { kind: 'continue' });
    summary = foldRunEvents(summary, r.events, r.state);
    expect(r.state.phase.kind).toBe('act-intro');

    // Hand-derived from the scripted run: one Kingpin kill, no spares, reached act 2, no
    // ending, and the boss fell unhurt.
    expect(summary.bossKills).toEqual(['kingpin']);
    expect(summary.spareCount).toBe(0);
    expect(summary.maxAct).toBe(2);
    expect(summary.endingType).toBeUndefined();
    expect(summary.wonBattleUnhurt).toBe(true);
  });
});

// ------- Encode / decode / migrate ------------------------------------------

describe('unlock store encode / decode / migrate', () => {
  it('decode(encode(store)) deep-equals the store', () => {
    const store = applyRunSummary(createUnlockStore(), summaryOf({ bossKills: ['kingpin'], maxAct: 3 }), 7).store;
    const round = decodeUnlockStore(encodeUnlockStore(store));
    expect(round).toEqual(store);
  });

  it('corrupt / wrong-typed payloads decode to null', () => {
    expect(decodeUnlockStore('not json{')).toBeNull();
    expect(decodeUnlockStore('[]')).toBeNull(); // array root
    expect(decodeUnlockStore('null')).toBeNull();
    expect(decodeUnlockStore('42')).toBeNull();
    // Right version, wrong field types.
    expect(decodeUnlockStore(JSON.stringify({ version: UNLOCK_STORE_VERSION, classes: 'Enforcer' }))).toBeNull();
    expect(decodeUnlockStore(JSON.stringify({ version: UNLOCK_STORE_VERSION, classes: [1, 2] }))).toBeNull();
  });

  it('a one-version-older store is upgraded by the module migrate (karmaMemory injected)', () => {
    // A hand-built v0 store: valid arrays but predating the flavor karmaMemory.
    const v0 = {
      version: 0,
      classes: ['Enforcer'],
      skills: [],
      relics: [],
      families: [...DEFAULT_FAMILIES],
      affixes: [...DEFAULT_AFFIXES],
      feats: [],
    };
    const decoded = decodeUnlockStore(JSON.stringify(v0)) as UnlockStore;
    expect(decoded).not.toBeNull();
    expect(decoded.version).toBe(UNLOCK_STORE_VERSION);
    expect(decoded.karmaMemory).toEqual([]);
    expect(decoded.classes).toEqual(['Enforcer']);
  });

  it('a future-version store is rejected', () => {
    const future = { ...createUnlockStore(), version: UNLOCK_STORE_VERSION + 1 };
    expect(decodeUnlockStore(JSON.stringify(future))).toBeNull();
  });

  it('the store round-trips through JSON as plain data', () => {
    const store = applyRunSummary(createUnlockStore(), summaryOf({ endingType: 'grace', spareCount: 4 }), 9).store;
    expect(JSON.parse(JSON.stringify(store))).toEqual(store);
  });
});
