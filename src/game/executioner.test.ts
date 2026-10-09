// PLAN.md #11 — the EXECUTIONER (the Warden turned, cast-down path, GAME-DESIGN.md §22.31) and the
// Hollow Self's killing blow as DAMNATION (the author's 2026-09-28 ruling).
//
// AC-18: cast-down → continue is a fight at act 4. AC-19: the fall, both ways — losing is NOT death
// (full HP, the act-4 outro, no game-over); winning earns the XP and a defiant fall. AC-20: each of
// its blows is named for the next desecration or cruelty in the deed record, oldest first, wrapping.

import { describe, expect, it } from 'vitest';
import { createGame, step, type GameInput, type GameState, type StepResult } from './game.ts';
import { createBattle, type BattleState } from './battle.ts';
import { BOSSES, type BossState } from './boss.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { computeStatMods } from './character.ts';
import { createKarma } from './karma.ts';
import { mulberry32 } from './rng.ts';
import { getDamnationTakenEnding, getDamnationEnding } from './story.ts';
import { applyRunSummary, createUnlockStore, emptyRunSummary, foldRunEvents } from './unlockStore.ts';
import { emptyPerFloor, heuristicPolicy, runToTerminal, tallyStep } from './sim.ts';
import type { Deed } from './deeds.ts';
import type { GameEvent } from './gameEvent.ts';

// ------- Fixtures ------------------------------------------------------------

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    ...createPlayer({ name: 'Tester', classId: 'Enforcer', stats: { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 10, CHA: 10 } }),
    ...overrides,
  };
}

function bossEnemy(bossId: 'executioner' | 'hollow', act: number, overrides: Partial<Enemy> = {}): Enemy {
  const base = generateEnemy({ act, type: BOSSES[bossId].name, playerXp: 0 }, mulberry32(1));
  const stats = { ...base.stats, DEX: 10 };
  return { ...base, stats, mods: computeStatMods(stats), ...overrides };
}

function fightState(boss: BossState, act: number, player: Player, enemy: Enemy, opts: { deeds?: Deed[]; final?: boolean; rngState?: number } = {}): GameState {
  const battle: BattleState = createBattle(player, enemy, act, { boss });
  return {
    version: 10,
    rngState: opts.rngState ?? 5,
    player,
    act,
    place: act - 1,
    karma: createKarma(),
    deeds: opts.deeds ?? [],
    phase: { kind: 'battle', battle, started: true, final: opts.final ?? false },
  };
}

/** Answer whatever the run asks with the simplest legal input: fight, strike, the first draft, continue. */
function simplest(r: StepResult, move: 'strike' | null = 'strike'): GameInput {
  switch (r.awaiting) {
    case 'battle-action':
      return { kind: 'battle-action', action: 'fight' };
    case 'boss-choice':
      return { kind: 'boss-choice', move };
    case 'draft-pick':
      return { kind: 'draft-pick', index: 0 };
    default:
      return { kind: 'continue' };
  }
}

/** Step until `pred` holds, collecting every event; throws if it never does. */
function until(start: GameState, pred: (r: StepResult) => boolean, move: 'strike' | null = 'strike'): { last: StepResult; all: GameEvent[] } {
  let r: StepResult = { state: start, events: [], awaiting: 'battle-action' };
  const all: GameEvent[] = [];
  for (let i = 0; i < 2000; i += 1) {
    r = step(r.state, simplest(r, move));
    all.push(...r.events);
    if (pred(r)) return { last: r, all };
  }
  throw new Error('the condition was never reached');
}

const EXEC: BossState = { bossId: 'executioner', round: 0, deedCursor: 0 };

// ------- AC-18: cast-down is a fight ------------------------------------------------------

describe('cast-down meets the executioner at act 4 (AC-18)', () => {
  it('verdict cast-down → continue: a battle phase at act 4, the executioner, not final, unfleeable', () => {
    const s: GameState = { ...createGame(3), player: makePlayer({ xp: 300 }), act: 4, place: 3, phase: { kind: 'verdict', outcome: 'cast-down' } };
    const r = step(s, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('battle');
    if (r.state.phase.kind !== 'battle') return;
    expect(r.state.act).toBe(4);
    expect(r.state.phase.final).toBe(false);
    expect(r.state.phase.battle.boss?.bossId).toBe('executioner');
    expect(r.state.phase.battle.canFlee).toBe(false);
    expect(r.events).toEqual([{ kind: 'boss-encounter', bossId: 'executioner', enemyName: 'The Warden' }]);
  });
});

// ------- AC-19: the fall, both ways ----------------------------------------------------------

describe('the executioner’s fall — win or lose, you fall (AC-19)', () => {
  it('LOSING: defeat, then the defeated fall, then the act-4 outro — act 5 at FULL HP, no game-over', () => {
    const player = makePlayer({ hp: 1, maxHp: 41 });
    const enemy = bossEnemy('executioner', 4, { hp: 9999, maxHp: 9999 });
    const { last, all } = until(fightState(EXEC, 4, player, enemy), (r) => r.events.some((e) => e.kind === 'defeat'));
    const kinds = last.events.map((e) => e.kind);
    const order = kinds.filter((k) => k === 'defeat' || k === 'executioner-fall' || k === 'act-outro');
    expect(order).toEqual(['defeat', 'executioner-fall', 'act-outro']);
    expect(last.events).toContainEqual({ kind: 'executioner-fall', outcome: 'defeated' });
    expect(last.events.find((e) => e.kind === 'act-outro')).toMatchObject({ act: 4 });
    expect(all.some((e) => e.kind === 'game-over')).toBe(false);
    expect(last.state.phase).toEqual({ kind: 'act-outro', newAct: 5 });
    expect(last.state.act).toBe(5);
    expect(last.state.place).toBe(4);
    expect(last.state.player?.hp).toBe(41); // the author's Q2: FULL HP after the fall
    const next = step(last.state, { kind: 'continue' });
    expect(next.events[0]).toMatchObject({ kind: 'act-intro', act: 5 });
  });

  it('WINNING: victory (its XP), any level-ups, then the defiant fall and the act-4 outro', () => {
    const player = makePlayer({ hp: 999, maxHp: 999, xp: 200 });
    const enemy = bossEnemy('executioner', 4, { hp: 1, maxHp: 1 });
    const { last, all } = until(fightState(EXEC, 4, player, enemy), (r) => r.state.phase.kind === 'act-outro');
    const victory = all.find((e) => e.kind === 'victory');
    expect(victory && victory.kind === 'victory' ? victory.xpGained : null).toBe(enemy.xp);
    const kinds = all.map((e) => e.kind);
    expect(kinds.indexOf('victory')).toBeLessThan(kinds.indexOf('executioner-fall'));
    expect(last.events.map((e) => e.kind).slice(-2)).toEqual(['executioner-fall', 'act-outro']);
    expect(last.events).toContainEqual({ kind: 'executioner-fall', outcome: 'defiant' });
    expect(last.state.act).toBe(5);
    expect(last.state.pending).toBeUndefined();
    expect(all.some((e) => e.kind === 'defeat' || e.kind === 'game-over')).toBe(false);
  });

  it('the unlock fold never credits the executioner to a LATER victory (a defeat clears the pending boss)', () => {
    let s = emptyRunSummary();
    s = foldRunEvents(s, [{ kind: 'boss-encounter', bossId: 'executioner', enemyName: 'The Warden' }], { player: null });
    s = foldRunEvents(s, [{ kind: 'defeat' }, { kind: 'executioner-fall', outcome: 'defeated' }], { player: null });
    s = foldRunEvents(s, [{ kind: 'victory', xpGained: 3, loot: [] }], { player: null });
    expect(s.bossKills).toEqual([]);
  });

  it('the sim does not count the fall as a floor-4 death', () => {
    const pre: StepResult = { state: { ...createGame(1), player: makePlayer(), act: 4, place: 3 }, events: [], awaiting: 'boss-choice' };
    const post: StepResult = { ...pre, events: [{ kind: 'defeat' }, { kind: 'executioner-fall', outcome: 'defeated' }] };
    expect(tallyStep(emptyPerFloor(), pre, post)[4].died).toBe(0);
    const plain: StepResult = { ...pre, events: [{ kind: 'defeat' }, { kind: 'game-over', xp: 1 }] };
    expect(tallyStep(emptyPerFloor(), pre, plain)[4].died).toBe(1);
  });
});

// ------- AC-20: deeds as blows ---------------------------------------------------------------

describe('each executioner blow is named for a deed (AC-20)', () => {
  const spared: Deed = { kind: 'spared', floor: 1, axis: 'mercyCruelty', name: 'The Fixer' };
  const killedA: Deed = { kind: 'killed', floor: 1, axis: 'mercyCruelty', name: 'Ganger One' };
  const desecrated: Deed = { kind: 'bargain', floor: 2, axis: 'reverenceDesecration', bargain: { cost: 'desecrate', paid: 'desecrate a shrine', got: '+1 STR' } };
  const greed: Deed = { kind: 'bargain', floor: 2, axis: 'restraintGreed', bargain: { cost: 'greed', paid: 'take it all', got: '+1 DEX' } };
  const killedB: Deed = { kind: 'killed', floor: 3, axis: 'mercyCruelty', name: 'Ganger Two' };
  const strip = ({ axis: _a, ...rest }: Deed): Omit<Deed, 'axis'> => rest;

  function blows(deeds: Deed[], count: number): (Omit<Deed, 'axis'> | undefined)[] {
    const player = makePlayer({ hp: 9999, maxHp: 9999 });
    const enemy = bossEnemy('executioner', 4, { hp: 9999, maxHp: 9999, skillPool: [] });
    let r: StepResult = { state: fightState(EXEC, 4, player, enemy, { deeds }), events: [], awaiting: 'battle-action' };
    const named: (Omit<Deed, 'axis'> | undefined)[] = [];
    while (named.length < count) {
      r = step(r.state, simplest(r));
      for (const e of r.events) if (e.kind === 'boss-move') named.push(e.deed);
    }
    return named;
  }

  it('the next ⚖ kill or desecration bargain, oldest first, wrapping — never a spare or a greed bargain', () => {
    const named = blows([spared, killedA, greed, desecrated, killedB], 4);
    expect(named).toEqual([strip(killedA), strip(desecrated), strip(killedB), strip(killedA)]);
  });

  it('the named deed never carries its karma axis (karma stays hidden from every surface)', () => {
    for (const d of blows([killedA], 2)) {
      expect(d).toBeDefined();
      expect(d && 'axis' in d).toBe(false);
    }
  });

  it('with no such deed, no blow is named — and nothing throws', () => {
    expect(blows([spared, greed], 3)).toEqual([undefined, undefined, undefined]);
    expect(blows([], 2)).toEqual([undefined, undefined]);
  });

  it('only the executioner names its blows', () => {
    const player = makePlayer({ hp: 9999, maxHp: 9999 });
    const enemy = bossEnemy('hollow', 5, { hp: 9999, maxHp: 9999, skillPool: [] });
    let r: StepResult = { state: fightState({ bossId: 'hollow', round: 0 }, 5, player, enemy, { deeds: [killedA], final: true }), events: [], awaiting: 'battle-action' };
    r = step(r.state, simplest(r));
    r = step(r.state, simplest(r));
    const move = r.events.find((e) => e.kind === 'boss-move');
    expect(move && move.kind === 'boss-move' && 'deed' in move).toBe(false);
  });
});

// ------- the Hollow Self's killing blow is DAMNATION ----------------------------------------

describe('the Hollow Self killing you is DAMNATION, taken (the author’s 2026-09-28 ruling)', () => {
  it('defeat, then the damnation ending with path taken and its own prose — no game-over; the Hollow unlock', () => {
    const player = makePlayer({ hp: 1, maxHp: 30 });
    const enemy = bossEnemy('hollow', 5, { hp: 9999, maxHp: 9999 });
    const start = fightState({ bossId: 'hollow', round: 0 }, 5, player, enemy, { final: true });
    let summary = emptyRunSummary();
    let r: StepResult = { state: start, events: [], awaiting: 'battle-action' };
    const all: GameEvent[] = [];
    for (let i = 0; i < 2000 && r.state.phase.kind === 'battle'; i += 1) {
      r = step(r.state, simplest(r));
      all.push(...r.events);
      summary = foldRunEvents(summary, r.events, r.state);
    }
    const taken = getDamnationTakenEnding();
    expect(r.state.phase).toEqual({ kind: 'ending', endingType: 'damnation', taken: true });
    expect(r.events.map((e) => e.kind).slice(-2)).toEqual(['defeat', 'ending']);
    expect(r.events.at(-1)).toEqual({ kind: 'ending', endingType: 'damnation', path: 'taken', header: taken.header, body: taken.body });
    expect(taken.body).not.toBe(getDamnationEnding().body);
    expect(all.some((e) => e.kind === 'game-over')).toBe(false);
    // The same unlock as beating it by force.
    expect(summary.endingType).toBe('damnation');
    expect(applyRunSummary(createUnlockStore(), summary, 1).store.classes).toContain('Hollow');
    // The sim reads it as a damnation ending, and says how it was reached.
    const run = runToTerminal(start, heuristicPolicy('Enforcer'));
    expect(run.outcome).toBe('damnation');
    expect(run.endingPath).toBe('taken');
    expect(run.cause).toBe('taken by the Hollow (damnation)');
  });

  it('any OTHER boss killing you is still a plain death', () => {
    const player = makePlayer({ hp: 1, maxHp: 30 });
    const enemy = bossEnemy('executioner', 4, { hp: 9999, maxHp: 9999 });
    const sinEnemy = { ...enemy, type: 'The Grief', name: 'The Grief', fullName: 'The Grief' };
    const start = fightState({ bossId: 'sin', round: 0, sinIdentity: 'grief', sinBonusHp: 0 }, 3, player, sinEnemy);
    const { last } = until(start, (r) => r.state.phase.kind !== 'battle');
    expect(last.state.phase.kind).toBe('game-over');
    expect(last.events.some((e) => e.kind === 'game-over')).toBe(true);
  });
});
