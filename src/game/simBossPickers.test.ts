// PLAN.md #11 — the simulator's boss pickers (AC-21): the baseline answers `null` (the engine's
// seeded fallback plays the boss), and two measurement pickers — a seeded random one and a
// best-move one — show the range an agent-run boss could land in (§22.31 D8).

import { describe, expect, it } from 'vitest';
import { step, type GameState, type StepResult } from './game.ts';
import { createBattle, type BattleState } from './battle.ts';
import { BOSSES, type BossState } from './boss.ts';
import { createPlayer } from './player.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { createKarma } from './karma.ts';
import { createRng, mulberry32 } from './rng.ts';
import { SKILLS } from './skill.ts';
import {
  ALL_CLASSES,
  bossBestMove,
  bossRandomMove,
  heuristicPolicy,
  mercifulPolicy,
  simulateBatch,
  type BossPicker,
} from './sim.ts';

function pausedAt(boss: BossState, act: number, enemy: Partial<Enemy> = {}, rngState = 7): StepResult {
  const player = { ...createPlayer({ name: 'Sim', classId: 'Enforcer', stats: { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 10, CHA: 10 } }), hp: 999, maxHp: 999 };
  const base = generateEnemy({ act, type: BOSSES[boss.bossId].name, playerXp: 0 }, mulberry32(1));
  const e: Enemy = { ...base, hp: 9999, maxHp: 9999, ...enemy };
  const battle: BattleState = createBattle(player, e, act, { boss });
  const state: GameState = {
    version: 10, rngState, player, act, place: act - 1, karma: createKarma(), deeds: [],
    phase: { kind: 'battle', battle, started: true, final: false },
  };
  const r = step(state, { kind: 'battle-action', action: 'fight' });
  expect(r.awaiting).toBe('boss-choice');
  return r;
}

describe('the shipped policies hand the boss to the engine (AC-21)', () => {
  it('heuristicPolicy and mercifulPolicy answer boss-choice with move null', () => {
    const r = pausedAt({ bossId: 'kingpin', round: 0, minions: 0 }, 1);
    expect(heuristicPolicy('Enforcer')(r)).toEqual({ kind: 'boss-choice', move: null });
    expect(mercifulPolicy('Scavver')(r)).toEqual({ kind: 'boss-choice', move: null });
    expect(heuristicPolicy('Enforcer', { boss: 'fallback' })(r)).toEqual({ kind: 'boss-choice', move: null });
  });
});

describe('the random picker is a pure function of the state’s seed (AC-21)', () => {
  it('same state ⇒ same id, the id is legal, and it is the state seed’s first uniform pick', () => {
    for (const rngState of [1, 2, 3, 99, 12345]) {
      const r = pausedAt({ bossId: 'kingpin', round: 0, minions: 1 }, 1, {}, rngState);
      const legal = r.state.phase.kind === 'battle' ? r.state.phase.battle.bossChoice!.legal : [];
      const a = bossRandomMove(r);
      expect(bossRandomMove(r)).toBe(a);
      expect(legal).toContain(a);
      // Derived independently: one uniform draw from a generator seeded with the state.
      expect(a).toBe(legal[Math.floor(createRng(r.state.rngState).rng() * legal.length)]);
      // ...and it read the state without advancing it.
      expect(heuristicPolicy('Enforcer', { boss: 'random' })(r)).toEqual({ kind: 'boss-choice', move: a });
    }
  });

  it('with no boss turn open it has nothing to say', () => {
    const r = pausedAt({ bossId: 'kingpin', round: 0, minions: 0 }, 1);
    const after = step(r.state, { kind: 'boss-choice', move: 'strike' });
    expect(bossRandomMove(after)).toBeNull();
  });
});

describe('the best-move picker (AC-21)', () => {
  it('the Kingpin calls his crew while he may, then strikes', () => {
    const under = pausedAt({ bossId: 'kingpin', round: 0, minions: 1 }, 1);
    if (under.state.phase.kind !== 'battle') throw new Error('fixture');
    expect(bossBestMove(under.state.phase.battle)).toBe('call_crew');
    const capped = pausedAt({ bossId: 'kingpin', round: 0, minions: 2 }, 1);
    if (capped.state.phase.kind !== 'battle') throw new Error('fixture');
    expect(bossBestMove(capped.state.phase.battle)).toBe('strike');
  });

  it('any other boss casts its highest-baseDamage affordable skill, else strikes', () => {
    // Executioner kit at 2 charges: Smite the Wicked (4) beats Blinding Light (2) and Warding Strike (2).
    expect(SKILLS.smiteWicked.baseDamage).toBe(4);
    const kit = ['smiteWicked', 'blindingLight', 'wardingStrike'];
    const two = pausedAt({ bossId: 'executioner', round: 0, deedCursor: 0 }, 4, { skillPool: kit, skillCharges: 2 });
    if (two.state.phase.kind !== 'battle') throw new Error('fixture');
    expect(bossBestMove(two.state.phase.battle)).toBe('cast:smiteWicked');
    // At 1 charge Smite (cost 2) is not listed: the first of the two 2-damage casts, by list order.
    const one = pausedAt({ bossId: 'executioner', round: 0, deedCursor: 0 }, 4, { skillPool: kit, skillCharges: 1 });
    if (one.state.phase.kind !== 'battle') throw new Error('fixture');
    expect(bossBestMove(one.state.phase.battle)).toBe('cast:blindingLight');
    const none = pausedAt({ bossId: 'executioner', round: 0, deedCursor: 0 }, 4, { skillPool: kit, skillCharges: 0 });
    if (none.state.phase.kind !== 'battle') throw new Error('fixture');
    expect(bossBestMove(none.state.phase.battle)).toBe('strike');
  });

  it('the Sin never grieves under the best picker', () => {
    const r = pausedAt({ bossId: 'sin', round: 0, sinIdentity: 'grief', sinBonusHp: 0 }, 3, { skillPool: [], skillCharges: 0 });
    if (r.state.phase.kind !== 'battle') throw new Error('fixture');
    expect(r.state.phase.battle.bossChoice?.legal).toContain('grieve');
    expect(bossBestMove(r.state.phase.battle)).toBe('strike');
  });
});

describe('each picker is reproducible, and the three measure three different games (AC-21)', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
  const batch = (boss: BossPicker) =>
    simulateBatch({ seeds, classes: [...ALL_CLASSES], policy: (c) => heuristicPolicy(c, { boss }) });

  it('replays exactly, and fallback / random / best give three different aggregates over seeds 1..30', () => {
    const fallback = batch('fallback');
    const random = batch('random');
    const best = batch('best');
    expect(batch('random')).toEqual(random);
    expect(batch('best')).toEqual(best);
    // The default policy IS the fallback picker.
    expect(simulateBatch({ seeds, classes: [...ALL_CLASSES] })).toEqual(fallback);
    const key = (r: typeof fallback): string => JSON.stringify({ wins: r.wins, deathByAct: r.deathByAct, avgLevel: r.avgLevel });
    expect(new Set([key(fallback), key(random), key(best)]).size).toBe(3);
  });
});
