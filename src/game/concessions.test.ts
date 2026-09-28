// PLAN.md #11 — CONCESSIONS: what Talk earns, applied by the engine (AC-15, AC-16, AC-17), and the
// Warden's grace scene pinned so it cannot drift (§5.8).
//
// The mechanics are the author's Q3 rulings, accepted as stated: pause = the boss's next turn passes
// (its conditions tick); weakness = the player at advantage for the rest of the fight; Kingpin
// drop_mechanic = he stops calling (the standing crew stays); surrender = a full victory with the
// loot roll and no onKill relic (Kingpin) or the late grace (Hollow Self). Each is asserted in what
// the player sees — never read back from the implementation.

import { describe, expect, it } from 'vitest';
import { createGame, step, type GameInput, type GameState, type StepResult } from './game.ts';
import { createBattle, resolveRound, type BattleState } from './battle.ts';
import {
  BOSSES,
  CONCESSIONS,
  availableConcessions,
  generateBoss,
  grantConcession,
  type BossState,
  type Concession,
} from './boss.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { computeStatMods, type Stats } from './character.ts';
import { createKarma, type KarmaState } from './karma.ts';
import { makeCondition } from './condition.ts';
import { mulberry32, type Rng } from './rng.ts';
import { getGraceAcknowledgedEnding, getGraceEnding } from './story.ts';
import {
  FEATS,
  applyRunSummary,
  createUnlockStore,
  emptyRunSummary,
  foldRunEvents,
  type RunSummary,
} from './unlockStore.ts';
import type { GameEvent } from './gameEvent.ts';

// ------- Fixtures ------------------------------------------------------------

const STATS: Stats = { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 10, CHA: 10 };

function makePlayer(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ name: 'Tester', classId: 'Enforcer', stats: STATS }), hp: 999, maxHp: 999, ...overrides };
}

function makeBossEnemy(bossId: keyof typeof BOSSES, act: number, overrides: Partial<Enemy> = {}): Enemy {
  const base = generateEnemy({ act, type: BOSSES[bossId].name, playerXp: 0 }, mulberry32(1));
  const stats = { ...base.stats, DEX: 10 };
  return { ...base, stats, mods: computeStatMods(stats), hp: 9999, maxHp: 9999, ...overrides };
}

function gameOf(battle: BattleState, opts: { final?: boolean; karma?: KarmaState } = {}): GameState {
  return {
    version: 10,
    rngState: 7,
    player: battle.player,
    act: battle.act,
    place: battle.act - 1,
    karma: opts.karma ?? createKarma(),
    deeds: [],
    phase: { kind: 'battle', battle, started: true, final: opts.final ?? false },
  };
}

function bossGame(boss: BossState, act = 1, enemy?: Enemy, player = makePlayer()): GameState {
  return gameOf(createBattle(player, enemy ?? makeBossEnemy(boss.bossId, act), act, { boss }));
}

function battleOf(s: GameState): BattleState {
  if (s.phase.kind !== 'battle') throw new Error(`not a battle: ${s.phase.kind}`);
  return s.phase.battle;
}

const concede = (concession: Concession): GameInput => ({ kind: 'boss-concession', concession });
const FIGHT: GameInput = { kind: 'battle-action', action: 'fight' };

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`scriptedRng exhausted after ${values.length} draw(s)`);
    return values[i++]!;
  };
}
const face = (f: number, sides: number): number => (f - 0.5) / sides;

function expectNoop(s: GameState, input: GameInput): void {
  const r = step(s, input);
  expect(r.state).toBe(s);
  expect(r.events).toEqual([]);
}

// ------- AC-15: where a concession is accepted -----------------------------------

describe('a concession is accepted only where the card allows it (AC-15)', () => {
  it('at the battle-action awaiting AND at the boss-choice awaiting of a boss battle', () => {
    const atAction = bossGame({ bossId: 'kingpin', round: 0, minions: 0 });
    const r1 = step(atAction, concede('weakness'));
    expect(r1.events[0]).toEqual({ kind: 'boss-concession', bossId: 'kingpin', concession: 'weakness' });
    expect(battleOf(r1.state).boss?.conceded).toBe('weakness');

    const paused = step(atAction, FIGHT);
    expect(paused.awaiting).toBe('boss-choice');
    const r2 = step(paused.state, concede('weakness'));
    expect(r2.events[0]).toEqual({ kind: 'boss-concession', bossId: 'kingpin', concession: 'weakness' });
    expect(r2.awaiting).toBe('boss-choice'); // weakness does not end the boss's turn
  });

  it('never outside the boss’s own list: each card, every concession', () => {
    // The cards (bosses.json), re-stated from the plan's §5.6, not read from the data.
    const allowed: Record<string, readonly Concession[]> = {
      kingpin: ['pause', 'weakness', 'drop_mechanic', 'surrender'],
      reflection: ['pause', 'drop_mechanic'],
      sin: ['pause', 'weakness', 'drop_mechanic'],
      executioner: [],
      hollow: ['surrender'],
    };
    const bosses: BossState[] = [
      { bossId: 'kingpin', round: 0, minions: 0 },
      { bossId: 'reflection', round: 0, adapted: false, actionTally: {} },
      { bossId: 'sin', round: 0, sinIdentity: 'grief', sinBonusHp: 0 },
      { bossId: 'executioner', round: 0, deedCursor: 0 },
      { bossId: 'hollow', round: 0 },
    ];
    for (const boss of bosses) {
      const s = bossGame(boss, boss.bossId === 'hollow' ? 5 : boss.bossId === 'executioner' ? 4 : 1);
      expect(availableConcessions(battleOf(s)), boss.bossId).toEqual(allowed[boss.bossId]);
      for (const c of CONCESSIONS) {
        if (allowed[boss.bossId]!.includes(c)) continue;
        expectNoop(s, concede(c));
      }
    }
  });

  it('a non-boss battle, and every phase that is not a started battle, accept nothing', () => {
    const plain = gameOf(createBattle(makePlayer(), makeBossEnemy('kingpin', 1), 1));
    for (const c of CONCESSIONS) expectNoop(plain, concede(c));
    const hub: GameState = { ...createGame(1), player: makePlayer(), phase: { kind: 'main-menu' } };
    for (const c of CONCESSIONS) expectNoop(hub, concede(c));
    const unstarted: GameState = { ...bossGame({ bossId: 'kingpin', round: 0, minions: 0 }) };
    if (unstarted.phase.kind !== 'battle') throw new Error('fixture');
    const notYet: GameState = { ...unstarted, phase: { ...unstarted.phase, started: false } };
    for (const c of CONCESSIONS) expectNoop(notYet, concede(c));
  });
});

// ------- AC-17: one per fight ---------------------------------------------------

describe('one concession per fight (AC-17)', () => {
  it('after any grant, a second concession of ANY kind is a no-op', () => {
    for (const first of ['pause', 'weakness', 'drop_mechanic'] as const) {
      const granted = step(bossGame({ bossId: 'kingpin', round: 0, minions: 0 }), concede(first)).state;
      expect(availableConcessions(battleOf(granted))).toEqual([]);
      for (const c of CONCESSIONS) expectNoop(granted, concede(c));
    }
  });

  it('a new battle starts unconceded', () => {
    const { boss } = generateBoss({ bossId: 'kingpin', act: 1, player: makePlayer(), karma: createKarma(), rng: mulberry32(2) });
    expect(boss.conceded).toBeUndefined();
    expect(availableConcessions({ boss })).toEqual(['pause', 'weakness', 'drop_mechanic', 'surrender']);
  });
});

// ------- AC-16: pause ---------------------------------------------------------------

describe('pause — the boss’s next turn passes; its conditions still tick (AC-16)', () => {
  it('granted before the round: the next round has no boss attack and no pause for its move, and completes', () => {
    // A poison already past its onset on the Kingpin: its tick must still hurt it on the passed turn.
    const enemy = makeBossEnemy('kingpin', 1, { activeConditions: [{ ...makeCondition('poison'), remainingTurns: 1 }] });
    const s = step(bossGame({ bossId: 'kingpin', round: 0, minions: 0 }, 1, enemy), concede('pause')).state;
    expect(battleOf(s).boss?.pausedTurn).toBe(true);
    const r = step(s, FIGHT);
    expect(r.awaiting).toBe('battle-action'); // no pause for a move: the turn passed
    expect(r.events).toContainEqual({ kind: 'boss-move', bossId: 'kingpin', move: 'pause' });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'enemy')).toBe(false);
    expect(r.events.some((e) => e.kind === 'condition-damage' && e.subject === 'enemy')).toBe(true);
    expect(battleOf(r.state).boss?.round).toBe(1); // the round completed
    expect(battleOf(r.state).boss?.pausedTurn).toBeUndefined(); // only ONE turn passes
    // ...and the turn after that is the boss's again.
    expect(step(r.state, FIGHT).awaiting).toBe('boss-choice');
  });

  it('granted while the boss’s turn waits for its move: that turn passes now and the round completes', () => {
    const paused = step(bossGame({ bossId: 'kingpin', round: 0, minions: 1 }), FIGHT);
    expect(paused.awaiting).toBe('boss-choice');
    const r = step(paused.state, concede('pause'));
    expect(r.awaiting).toBe('battle-action');
    expect(r.events.map((e) => e.kind)).toEqual(['boss-concession', 'boss-move', 'boss-minion-damage']);
    expect(battleOf(r.state).bossChoice).toBeUndefined();
    expect(battleOf(r.state).boss?.round).toBe(1);
  });
});

// ------- AC-16: weakness --------------------------------------------------------------

describe('weakness — two dice for the rest of the fight (AC-16)', () => {
  it('a scripted 3 then 18: before, one face; after, faces [3, 18] and the 18 counts', () => {
    const boss: BossState = { bossId: 'kingpin', round: 0, minions: 0 };
    const battle = createBattle(makePlayer(), makeBossEnemy('kingpin', 1), 1, { boss });
    // The scripted stream: d20 3, d20 18, then a generous tail for any damage die.
    const script = [face(3, 20), face(18, 20), 0.5, 0.5, 0.5, 0.5];
    const before = resolveRound(battle, 'fight', scriptedRng(script));
    const beforeRoll = before.events.find((e) => e.kind === 'attack' && e.subject === 'player');
    expect(beforeRoll && beforeRoll.kind === 'attack' ? beforeRoll.roll.faces : null).toEqual([3]);

    const weak: BattleState = { ...battle, boss: { ...boss, conceded: 'weakness', weaknessRevealed: true } };
    const after = resolveRound(weak, 'fight', scriptedRng(script));
    const afterRoll = after.events.find((e) => e.kind === 'attack' && e.subject === 'player');
    expect(afterRoll && afterRoll.kind === 'attack' ? afterRoll.roll : null).toMatchObject({ faces: [3, 18], natural: 18, advDis: 1 });
  });

  it('through step: the grant sets it for the rest of the fight', () => {
    const r = step(bossGame({ bossId: 'sin', round: 0, sinIdentity: 'grief', sinBonusHp: 0 }, 3), concede('weakness'));
    expect(battleOf(r.state).boss?.weaknessRevealed).toBe(true);
    const next = step(r.state, FIGHT);
    expect(next.events).toContainEqual({ kind: 'advantage', subject: 'player' });
  });
});

// ------- fix round 1: a concession granted BETWEEN the player's two actions ---------------------

describe('a concession granted during the player’s extra-action pause reaches the second action (fix round 1)', () => {
  // The player's gauge sits at 0.9 with a DEX-12 rate of +0.1, so the first Fight crosses +1.0 and
  // the round PAUSES for a second action. A concession is granted in that pause; the second action
  // must roll under it. Every d20 is scripted: face(f, 20) is exactly natural f.
  function extraPaused(boss: BossState, extra: Partial<BattleState> = {}): BattleState {
    const stats = { ...STATS, DEX: 12 };
    const player = { ...makePlayer(), stats, mods: computeStatMods(stats) };
    const battle: BattleState = { ...createBattle(player, makeBossEnemy(boss.bossId, 2), 2, { boss }), tempo: { player: 9, enemy: 0 }, ...extra };
    // First action: natural 2 misses whatever the roll mode, and a miss draws no damage die.
    const first = resolveRound(battle, 'fight', scriptedRng([face(2, 20), face(2, 20)]));
    expect(first.state.extraAction, 'the round did not pause for an extra action').toBe(true);
    return first.state;
  }
  const playerRoll = (events: readonly GameEvent[]) => {
    const a = events.find((e) => e.kind === 'attack' && e.subject === 'player');
    return a && a.kind === 'attack' ? a.roll : undefined;
  };

  it('weakness: the second action rolls TWO dice (faces 3 and 18, natural 18)', () => {
    const paused = extraPaused({ bossId: 'kingpin', round: 0, minions: 0 });
    const granted = grantConcession(paused, 'weakness').battle;
    const second = resolveRound(granted, 'fight', scriptedRng([face(3, 20), face(18, 20), 0.5, 0.5]));
    expect(playerRoll(second.events)).toMatchObject({ faces: [3, 18], natural: 18, advDis: 1 });
  });

  it('the Reflection’s drop_mechanic lifts its adaptation for the second action: ONE die, advDis 0', () => {
    const boss: BossState = { bossId: 'reflection', round: 3, adapted: true, actionTally: { fight: 3 } };
    const paused = extraPaused(boss, { playerAdvantage: -1 });
    const granted = grantConcession(paused, 'drop_mechanic').battle;
    expect(granted.playerAdvantage).toBeUndefined();
    const second = resolveRound(granted, 'fight', scriptedRng([face(15, 20), 0.5, 0.5]));
    expect(playerRoll(second.events)).toMatchObject({ faces: [15], natural: 15, advDis: 0 });
  });

  it('through step, as the probe played it: fight → the pause → weakness → fight rolls two faces', () => {
    const stats = { ...STATS, DEX: 12 };
    const player = { ...makePlayer(), stats, mods: computeStatMods(stats) };
    const boss: BossState = { bossId: 'kingpin', round: 0, minions: 0 };
    const battle: BattleState = { ...createBattle(player, makeBossEnemy('kingpin', 2), 2, { boss }), tempo: { player: 9, enemy: 0 } };
    const p = step(gameOf(battle), FIGHT);
    expect(battleOf(p.state).extraAction).toBe(true);
    expect(p.awaiting).toBe('battle-action');
    const g = step(p.state, concede('weakness'));
    const next = step(g.state, FIGHT);
    expect(playerRoll(next.events)?.faces).toHaveLength(2);
  });
});

// ------- AC-16: drop_mechanic ------------------------------------------------------------

describe('drop_mechanic — each boss gives up its own mechanic (AC-16)', () => {
  it('Kingpin: call_crew leaves the open legal list, and no minion ever arrives again', () => {
    const paused = step(bossGame({ bossId: 'kingpin', round: 0, minions: 1 }), FIGHT);
    expect(paused.state.phase.kind === 'battle' && paused.state.phase.battle.bossChoice?.legal).toEqual([
      'strike',
      'call_crew',
      'hold_back',
    ]);
    const r = step(paused.state, concede('drop_mechanic'));
    expect(battleOf(r.state).bossChoice?.legal).toEqual(['strike', 'hold_back']);
    // Asking for the crew anyway falls back to a legal move — never a new minion.
    let s = step(r.state, { kind: 'boss-choice', move: 'call_crew' }).state;
    for (let i = 0; i < 6; i += 1) {
      const a = step(s, FIGHT);
      const b = step(a.state, { kind: 'boss-choice', move: 'call_crew' });
      expect(b.events.some((e) => e.kind === 'boss-summon')).toBe(false);
      s = b.state;
    }
    expect(battleOf(s).boss?.minions).toBe(1);
  });

  it('Kingpin granted with a crew of 2: the standing crew keeps dealing 2 a round', () => {
    const s = step(bossGame({ bossId: 'kingpin', round: 0, minions: 2 }), concede('drop_mechanic')).state;
    const a = step(s, FIGHT);
    const b = step(a.state, { kind: 'boss-choice', move: 'hold_back' });
    expect(b.events).toContainEqual({ kind: 'boss-minion-damage', amount: 2 });
  });

  it('Reflection already adapted: the disadvantage lifts, and it never adapts again', () => {
    const boss: BossState = { bossId: 'reflection', round: 3, adapted: true, actionTally: { fight: 3 } };
    const battle: BattleState = { ...createBattle(makePlayer(), makeBossEnemy('reflection', 2, { skillPool: [] }), 2, { boss }), playerAdvantage: -1 };
    const r = step(gameOf(battle), concede('drop_mechanic'));
    expect(battleOf(r.state).playerAdvantage).toBeUndefined();
    const next = step(r.state, FIGHT);
    const roll = next.events.find((e) => e.kind === 'attack' && e.subject === 'player');
    expect(roll && roll.kind === 'attack' ? roll.roll.advDis : null).toBe(0);
  });

  it('Reflection not yet adapted: however often an action repeats, no boss-adapt follows', () => {
    const boss: BossState = { bossId: 'reflection', round: 0, adapted: false, actionTally: {} };
    let s = step(bossGame(boss, 2, makeBossEnemy('reflection', 2, { skillPool: [] })), concede('drop_mechanic')).state;
    for (let i = 0; i < 6; i += 1) {
      const a = step(s, FIGHT);
      const b = step(a.state, { kind: 'boss-choice', move: 'strike' });
      expect([...a.events, ...b.events].some((e) => e.kind === 'boss-adapt')).toBe(false);
      s = b.state;
    }
    expect(battleOf(s).boss?.actionTally?.['fight']).toBe(6);
  });

  it('Sin: maxHp and hp fall by exactly the bonus its indulgence bought (mercyCruelty −4 ⇒ 12)', () => {
    const karma: KarmaState = { ...createKarma(), mercyCruelty: -4 };
    const player = makePlayer();
    const SEED = 21;
    const g = generateBoss({ bossId: 'sin', act: 3, player, karma, rng: mulberry32(SEED) });
    const neutral = generateBoss({ bossId: 'sin', act: 3, player, karma: createKarma(), rng: mulberry32(SEED) });
    expect(g.boss.sinBonusHp).toBe(12); // 4 × SIN_HP_PER_POINT (3)
    const r = step(gameOf(createBattle(player, g.enemy, 3, { boss: g.boss }), { karma }), concede('drop_mechanic'));
    const e = battleOf(r.state).enemy;
    expect(e.maxHp).toBe(neutral.enemy.maxHp);
    expect(e.hp).toBe(Math.min(g.enemy.hp, neutral.enemy.maxHp));
    expect(battleOf(r.state).boss?.sinBonusHp).toBe(0);
  });

  it('Sin: a boss already cut below the shed amount is left at 1 HP, never 0', () => {
    const boss: BossState = { bossId: 'sin', round: 0, sinIdentity: 'cruelty', sinBonusHp: 12 };
    const enemy = makeBossEnemy('sin', 3, { hp: 5, maxHp: 30 });
    const r = step(bossGame(boss, 3, enemy), concede('drop_mechanic'));
    expect(battleOf(r.state).enemy).toMatchObject({ maxHp: 18, hp: 5 });
    const low = step(bossGame(boss, 3, makeBossEnemy('sin', 3, { hp: 5, maxHp: 12 })), concede('drop_mechanic'));
    expect(battleOf(low.state).enemy.hp).toBeGreaterThanOrEqual(1);
    // 12 max − a 12 bonus would be 0: the shed never leaves a boss with no maximum at all.
    expect(battleOf(low.state).enemy.maxHp).toBe(1);
  });
});

// ------- AC-16: surrender -------------------------------------------------------------

/** Play `inputs` from `start`, folding the unlock summary exactly as the renderer does. */
function playFolding(start: GameState, inputs: GameInput[]): { last: StepResult; summary: RunSummary; events: GameEvent[] } {
  let summary = emptyRunSummary();
  let r: StepResult = { state: start, events: [], awaiting: 'continue' };
  const events: GameEvent[] = [];
  for (const input of inputs) {
    r = step(r.state, input);
    events.push(...r.events);
    summary = foldRunEvents(summary, r.events, r.state);
  }
  return { last: r, summary, events };
}

describe('surrender — the Kingpin’s is a full victory; the Hollow Self’s is the late grace (AC-16)', () => {
  it('Kingpin: victory, XP = enemy.xp, the floor ends, no onKill relic, the Neuromancer unlock counts it', () => {
    // A hub state at the act-1 boss gate (xp 10), wearing Devourer's Maw (an onKill relic).
    const base = makePlayer({ xp: 10 });
    const player: Player = { ...base, inventory: { ...base.inventory, slots: { ...base.inventory.slots, amulet: { defId: 'devourers-maw' } } } };
    const hub: GameState = { ...createGame(4), player, phase: { kind: 'main-menu' } };
    const { last, summary, events } = playFolding(hub, [
      { kind: 'menu', choice: 'continue' }, // the Kingpin appears
      { kind: 'continue' }, // the fight opens
      concede('surrender'),
    ]);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'boss-encounter', bossId: 'kingpin' }));
    const enemyXp = (() => {
      const opened = step(step(hub, { kind: 'menu', choice: 'continue' }).state, { kind: 'continue' }).state;
      return battleOf(opened).enemy.xp;
    })();
    const victory = last.events.find((e) => e.kind === 'victory');
    expect(victory && victory.kind === 'victory' ? victory.xpGained : null).toBe(enemyXp);
    expect(last.state.player?.xp).toBe(10 + enemyXp);
    expect(last.state.phase).toEqual({ kind: 'battle-victory', final: false });
    expect(last.state.pending).toBe('advance-act');
    expect(last.events[0]).toEqual({ kind: 'boss-concession', bossId: 'kingpin', concession: 'surrender' });
    expect(last.events.some((e) => e.kind === 'relic-triggered' || e.kind === 'stat-stolen')).toBe(false);
    expect(last.state.player?.stats.STR).toBe(player.stats.STR); // Devourer's Maw did not feed
    expect(last.state.deeds.at(-1)).toMatchObject({ kind: 'boss', bossId: 'kingpin', outcome: 'surrendered' });
    // The unlock store, through the REAL fold and apply.
    expect(summary.bossKills).toEqual(['kingpin']);
    const applied = applyRunSummary(createUnlockStore(), summary, 1);
    expect(applied.newlyUnlocked.feats).toContain('unlock-neuromancer');
  });

  it('Hollow Self: the grace ending, acknowledged — its own prose; grace’s Penitent unlock; no new feat', () => {
    const featsBefore = FEATS.length;
    expect(featsBefore).toBe(11);
    const boss: BossState = { bossId: 'hollow', round: 0 };
    const s = gameOf(createBattle(makePlayer(), makeBossEnemy('hollow', 5), 5, { boss }), { final: true });
    const { last, summary } = playFolding(s, [concede('surrender')]);
    expect(last.state.phase).toEqual({ kind: 'ending', endingType: 'grace', acknowledged: true });
    const ending = last.events.find((e) => e.kind === 'ending');
    const acknowledged = getGraceAcknowledgedEnding();
    expect(ending).toEqual({
      kind: 'ending',
      endingType: 'grace',
      path: 'acknowledged',
      header: acknowledged.header,
      body: acknowledged.body,
    });
    // A variant of grace, not the verdict's prose.
    expect(acknowledged.body).not.toBe(getGraceEnding().body);
    expect(last.state.deeds.at(-1)).toMatchObject({ kind: 'boss', bossId: 'hollow', outcome: 'surrendered' });
    expect(summary.endingType).toBe('grace');
    const applied = applyRunSummary(createUnlockStore(), summary, 1);
    expect(applied.store.classes).toContain('Penitent');
    expect(FEATS.length).toBe(featsBefore);
    // ...and the ending runs out as every ending does.
    expect(step(last.state, { kind: 'continue' }).awaiting).toBe('game-over');
  });
});

// ------- §5.8: the Warden's grace scene, pinned -------------------------------------------

describe('the Warden’s grace path is the verdict phase and `continue` (§5.8)', () => {
  it('verdict grace → continue → the grace ending, as today', () => {
    const s: GameState = { ...createGame(1), player: makePlayer(), act: 4, place: 3, phase: { kind: 'verdict', outcome: 'grace' } };
    const r = step(s, { kind: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'ending', endingType: 'grace' });
    expect(r.events).toEqual([
      { kind: 'ending', endingType: 'grace', header: getGraceEnding().header, body: getGraceEnding().body },
    ]);
  });
});
