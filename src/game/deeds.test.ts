// PLAN.md #11 — the DEED RECORD (GAME-DESIGN.md §22.31 D3, FINDINGS.md G79).
//
// Every deed below is produced by the REAL `step` (AC-12) — a spare, a ⚖ kill, an illusion seen
// through, a karma-priced bargain, a boss felled — and every NON-deed is proved too: a fled fight,
// a refused bargain, a bargain paid in HP, and a plain enemy's death record nothing. The cap
// (AC-13) and the save (AC-14) are pinned from the rules, never read back.

import { describe, expect, it } from 'vitest';
import floorsData from '../data/floors.json';
import { step, createGame, type GameState, type StepResult } from './game.ts';
import { createBattle, type BattleState } from './battle.ts';
import {
  DEED_CAP,
  deedPlaceName,
  executionerDeeds,
  recordDeed,
  type Deed,
} from './deeds.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { getFamily } from './enemyFamily.ts';
import { createKarma } from './karma.ts';
import { mulberry32 } from './rng.ts';
import { describeCost, describeReward, type SacrificeDeal } from './deal.ts';
import { SAVE_VERSION, encodeSave, decodeSave } from './save.ts';
import { BOSSES, type BossState } from './boss.ts';
import { heuristicPolicy, gearUpAtHub } from './sim.ts';

// ------- Fixtures ------------------------------------------------------------

function hero(overrides: Partial<Player> = {}): Player {
  return {
    ...createPlayer({ name: 'Tester', classId: 'Enforcer', stats: { STR: 16, DEX: 10, CON: 14, INT: 10, WIS: 10, CHA: 10 } }),
    hp: 200,
    maxHp: 200,
    ...overrides,
  };
}

/** A ⚖ enemy of a real karma-weighted family, weak enough to die to one blow. */
function weighted(overrides: Partial<Enemy> = {}): Enemy {
  const family = getFamily('fixers')!;
  expect(family.karmaWeighted).toBe(true);
  return { ...generateEnemy({ act: 1, family, playerXp: 0 }, mulberry32(3)), hp: 1, maxHp: 1, ...overrides };
}

function stateOf(battle: BattleState, rngState: number, act = battle.act): GameState {
  return {
    version: 10,
    rngState,
    player: battle.player,
    act,
    place: act - 1,
    karma: createKarma(),
    deeds: [],
    phase: { kind: 'battle', battle, started: true, final: false },
  };
}

/** The first rngState in 1..400 whose step from `make(seed)` satisfies `pred`. */
function findSeed(make: (seed: number) => GameState, input: Parameters<typeof step>[1], pred: (r: StepResult) => boolean): StepResult {
  for (let seed = 1; seed <= 400; seed += 1) {
    const r = step(make(seed), input);
    if (pred(r)) return r;
  }
  throw new Error('no seed in 1..400 produced the wanted step');
}

function hubWithDeal(deal: SacrificeDeal, player = hero()): GameState {
  return { ...createGame(5), player, phase: { kind: 'deal', deal } };
}

const deal = (cost: SacrificeDeal['cost']): SacrificeDeal => ({
  pool: 'standard',
  cost,
  reward: { kind: 'statPoint', stat: 'STR' },
});

// ------- AC-12: what IS recorded, through the real step --------------------------

describe('the deed record fills through step (AC-12)', () => {
  it('a spare appends { spared, floor, axis mercyCruelty, name }', () => {
    const enemy = weighted({ hp: 30, maxHp: 30 });
    const r = step(stateOf(createBattle(hero(), enemy, 1), 9), { kind: 'battle-action', action: 'spare' });
    expect(r.state.deeds).toEqual([{ kind: 'spared', floor: 1, axis: 'mercyCruelty', name: enemy.fullName }]);
  });

  it('a ⚖ kill appends { killed, floor, axis mercyCruelty, name }', () => {
    const enemy = weighted();
    const r = findSeed((s) => stateOf(createBattle(hero(), enemy, 1), s), { kind: 'battle-action', action: 'fight' },
      (x) => x.state.phase.kind === 'battle-victory');
    expect(r.state.deeds).toEqual([{ kind: 'killed', floor: 1, axis: 'mercyCruelty', name: enemy.fullName }]);
  });

  it('a plain (non-⚖) kill appends nothing', () => {
    const enemy = { ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(3)), hp: 1, maxHp: 1 };
    expect(enemy.karmaWeighted).toBe(false);
    const r = findSeed((s) => stateOf(createBattle(hero(), enemy, 1), s), { kind: 'battle-action', action: 'fight' },
      (x) => x.state.phase.kind === 'battle-victory');
    expect(r.state.deeds).toEqual([]);
  });

  it('a boss victory appends { boss, floor, name, bossId, outcome felled } — and a boss is no ⚖ kill', () => {
    const boss: BossState = { bossId: 'kingpin', round: 0, minions: 0 };
    const enemy = { ...generateEnemy({ act: 1, type: BOSSES.kingpin.name, playerXp: 0 }, mulberry32(1)), hp: 1, maxHp: 1 };
    const r = findSeed((s) => stateOf(createBattle(hero(), enemy, 1, { boss }), s), { kind: 'battle-action', action: 'fight' },
      (x) => x.state.phase.kind === 'battle-victory');
    expect(r.state.deeds).toEqual([{ kind: 'boss', floor: 1, name: enemy.fullName, bossId: 'kingpin', outcome: 'felled' }]);
  });

  it('an illusion seen through appends { illusion, floor 2, axis clarityDelusion }', () => {
    // WIS 30 (+10) against DC 13: the passive roll sees through on any face but a disaster.
    const p = hero({ stats: { STR: 16, DEX: 10, CON: 14, INT: 10, WIS: 30, CHA: 10 } });
    const enemy: Enemy = { ...generateEnemy({ act: 2, type: 'Beast', playerXp: 0 }, mulberry32(4)), illusory: true };
    const r = findSeed((s) => stateOf(createBattle(p, enemy, 2), s), { kind: 'battle-action', action: 'fight' },
      (x) => x.events.some((e) => e.kind === 'illusion-dispelled'));
    expect(r.state.deeds).toEqual([{ kind: 'illusion', floor: 2, axis: 'clarityDelusion' }]);
  });

  it('each karma-priced bargain appends its cost id and the two strings the player was shown', () => {
    const cases = [
      ['desecrate', 'reverenceDesecration'],
      ['greed', 'restraintGreed'],
      ['whisper', 'clarityDelusion'],
    ] as const;
    for (const [kind, axis] of cases) {
      const d = deal({ kind });
      const r = step(hubWithDeal(d), { kind: 'deal-decision', accept: true });
      expect(r.events.some((e) => e.kind === 'deal-taken'), kind).toBe(true);
      expect(r.state.deeds).toEqual([
        { kind: 'bargain', floor: 1, axis, bargain: { cost: kind, paid: describeCost(d.cost), got: describeReward(d.reward) } },
      ]);
    }
    // An offering gives up the first backpack item (`deal.ts`), so it needs one to pay with.
    const withItem = hero();
    const p: Player = { ...withItem, inventory: { ...withItem.inventory, backpack: [{ defId: 'antidote' }] } };
    const d = deal({ kind: 'offering' });
    const r = step(hubWithDeal(d, p), { kind: 'deal-decision', accept: true });
    expect(r.state.deeds).toEqual([
      { kind: 'bargain', floor: 1, axis: 'reverenceDesecration', bargain: { cost: 'offering', paid: describeCost(d.cost), got: describeReward(d.reward) } },
    ]);
  });
});

// ------- AC-12: what is NOT recorded -------------------------------------------------

describe('what the deed record never holds (AC-12)', () => {
  it('a refused bargain, and bargains paid in HP, max HP, a stat, a charge or a relic', () => {
    expect(step(hubWithDeal(deal({ kind: 'greed' })), { kind: 'deal-decision', accept: false }).state.deeds).toEqual([]);
    for (const cost of [
      { kind: 'hp', amount: 3 },
      { kind: 'maxHp', amount: 1 },
      { kind: 'statPoint', stat: 'CHA' },
      { kind: 'skillCharge', amount: 1 },
    ] as const) {
      const r = step(hubWithDeal(deal(cost)), { kind: 'deal-decision', accept: true });
      expect(r.events.some((e) => e.kind === 'deal-taken'), cost.kind).toBe(true);
      expect(r.state.deeds, cost.kind).toEqual([]);
    }
  });

  it('a fled fight records nothing — not even against a ⚖ enemy (fleeing is not a moral deed)', () => {
    const enemy = weighted({ hp: 30, maxHp: 30 });
    const r = findSeed((s) => stateOf(createBattle(hero(), enemy, 1), s), { kind: 'battle-action', action: 'run' },
      (x) => x.events.some((e) => e.kind === 'fled'));
    expect(r.state.phase.kind).toBe('main-menu');
    expect(r.state.deeds).toEqual([]);
  });

  it('no deed ever carries a floor NUMBER as text — real runs, every string field', () => {
    let deeds: Deed[] = [];
    for (const seed of [1, 2, 3]) {
      let r: StepResult = { state: createGame(seed), events: [], awaiting: 'title' };
      const policy = heuristicPolicy('Scavver');
      for (let i = 0; i < 20_000 && r.awaiting !== 'game-over'; i += 1) {
        if (r.awaiting === 'main-menu') r = { ...r, state: gearUpAtHub(r.state) };
        r = step(r.state, policy(r));
      }
      deeds = deeds.concat(r.state.deeds);
    }
    expect(deeds.length).toBeGreaterThan(0); // non-vacuity: real runs do record deeds
    for (const d of deeds) {
      for (const value of Object.values(d)) {
        if (typeof value !== 'string') continue;
        expect(value).not.toMatch(/floor/i);
        expect(value).not.toMatch(/^\d+$/);
      }
    }
  });
});

// ------- the place is a NAME ---------------------------------------------------------

describe('deedPlaceName — the place, by name (§22.31)', () => {
  it('reads floors.json: floor 2 is the Entrance to the Void', () => {
    expect(deedPlaceName({ floor: 2 })).toBe('Entrance to the Void');
    for (const f of [1, 2, 3, 4, 5] as const) {
      expect(deedPlaceName({ floor: f })).toBe((floorsData.floors as Record<string, { name: string }>)[String(f)]!.name);
    }
  });
});

// ------- AC-13: the cap ---------------------------------------------------------------

const spare = (i: number): Deed => ({ kind: 'spared', floor: 1, axis: 'mercyCruelty', name: `Spared ${i}` });
const bossDeed = (i: number): Deed => ({ kind: 'boss', floor: 1, name: `Boss ${i}`, bossId: 'kingpin', outcome: 'felled' });

describe('the record is capped at 24, and keeps its boss deeds (AC-13)', () => {
  it('DEED_CAP is the author’s 24', () => {
    expect(DEED_CAP).toBe(24);
  });

  it('25 spares keep the newest 24, oldest → newest (the first is dropped)', () => {
    let deeds: Deed[] = [];
    for (let i = 1; i <= 25; i += 1) deeds = recordDeed(deeds, spare(i));
    expect(deeds).toHaveLength(24);
    expect(deeds.map((d) => d.name)).toEqual(Array.from({ length: 24 }, (_, k) => `Spared ${k + 2}`));
  });

  it('23 spares, 2 boss deeds, then 5 more spares: 24 deeds still holding both boss deeds', () => {
    let deeds: Deed[] = [];
    for (let i = 1; i <= 23; i += 1) deeds = recordDeed(deeds, spare(i));
    deeds = recordDeed(deeds, bossDeed(1));
    deeds = recordDeed(deeds, bossDeed(2));
    for (let i = 24; i <= 28; i += 1) deeds = recordDeed(deeds, spare(i));
    expect(deeds).toHaveLength(24);
    // 25 + 5 = 30 written; the 6 oldest SPARES (1..6... less the boss room) are gone: hand count —
    // after the 25th write the record held 23 spares + 2 bosses = 25 → drop spare 1; each of the
    // five later spares drops the next-oldest spare, so spares 1..6 are gone.
    expect(deeds.filter((d) => d.kind === 'boss').map((d) => d.name)).toEqual(['Boss 1', 'Boss 2']);
    expect(deeds.filter((d) => d.kind === 'spared').map((d) => d.name)).toEqual(
      Array.from({ length: 22 }, (_, k) => `Spared ${k + 7}`),
    );
    // Order is oldest → newest: the two boss deeds sit where they were written.
    expect(deeds.findIndex((d) => d.name === 'Boss 1')).toBe(17);
  });

  it('the OLDEST deed survives the cap when it is a boss deed', () => {
    // Boss first, then 25 spares. At 24 + 1 the oldest NON-boss (spare 1) goes, then spare 2:
    // [boss, spares 3..25] — a rule that simply dropped the oldest deed would lose the boss here.
    let deeds: Deed[] = [bossDeed(1)];
    for (let i = 1; i <= 25; i += 1) deeds = recordDeed(deeds, spare(i));
    expect(deeds).toHaveLength(24);
    expect(deeds[0]).toEqual(bossDeed(1));
    expect(deeds.slice(1).map((d) => d.name)).toEqual(Array.from({ length: 23 }, (_, k) => `Spared ${k + 3}`));
  });

  it('does not mutate the record it is given', () => {
    const before = [spare(1)];
    recordDeed(before, spare(2));
    expect(before).toEqual([spare(1)]);
  });
});

// ------- executionerDeeds ------------------------------------------------------------

describe('executionerDeeds — the deeds its blows are named for', () => {
  it('keeps ⚖ kills and desecration bargains, oldest first; nothing else', () => {
    const k1: Deed = { kind: 'killed', floor: 1, axis: 'mercyCruelty', name: 'A' };
    const des: Deed = { kind: 'bargain', floor: 2, axis: 'reverenceDesecration', bargain: { cost: 'desecrate', paid: 'x', got: 'y' } };
    const greed: Deed = { kind: 'bargain', floor: 2, axis: 'restraintGreed', bargain: { cost: 'greed', paid: 'x', got: 'y' } };
    const k2: Deed = { kind: 'killed', floor: 3, axis: 'mercyCruelty', name: 'B' };
    expect(executionerDeeds([spare(1), k1, greed, des, bossDeed(1), k2])).toEqual([k1, des, k2]);
    expect(executionerDeeds([spare(1)])).toEqual([]);
  });
});

// ------- AC-14: the save ----------------------------------------------------------------

describe('save version 10 carries the record (AC-14)', () => {
  const withDeeds = (): GameState => ({ ...createGame(11), deeds: [spare(1), bossDeed(1)] });

  it('SAVE_VERSION is 10, and a v10 save with deeds round-trips deep-equal', () => {
    expect(SAVE_VERSION).toBe(10);
    const s = withDeeds();
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it('a v9 save — any phase — decodes with an empty record and is otherwise the same state', () => {
    const phases: GameState['phase'][] = [
      { kind: 'title' },
      { kind: 'main-menu' },
      { kind: 'verdict', outcome: 'cast-down' },
    ];
    for (const phase of phases) {
      for (const oldVersion of [8, 9]) {
        const modern: GameState = { ...createGame(3), player: hero(), phase };
        const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
        delete old.deeds;
        old.version = oldVersion;
        const decoded = decodeSave(JSON.stringify(old));
        expect(decoded, `${phase.kind} v${oldVersion}`).toEqual({ ...modern, deeds: [] });
      }
    }
  });

  it('a malformed record is rejected: not an array, an unknown kind, floor 0', () => {
    const base = JSON.parse(encodeSave(withDeeds())) as Record<string, unknown>;
    const bad = [
      { ...base, deeds: 'nope' },
      { ...base, deeds: undefined },
      { ...base, deeds: [{ kind: 'fled', floor: 1 }] },
      { ...base, deeds: [{ kind: 'spared', floor: 0 }] },
      { ...base, deeds: [{ kind: 'spared', floor: 6 }] },
      { ...base, deeds: [null] },
    ];
    for (const b of bad) expect(decodeSave(JSON.stringify(b)), JSON.stringify(b.deeds)).toBeNull();
  });

  it('a hand-built 30-deed save is ACCEPTED, and the cap re-applies on the next write', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => spare(i + 1));
    const s: GameState = { ...createGame(11), deeds: thirty };
    const decoded = decodeSave(encodeSave(s));
    expect(decoded?.deeds).toHaveLength(30);
    expect(recordDeed(decoded!.deeds, spare(31))).toHaveLength(24);
  });
});
