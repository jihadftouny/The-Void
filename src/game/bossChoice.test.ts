// PLAN.md #11 (unit A) — the boss's turn as an INPUT through `step`.
//
// What is proved here, each from the rules in the plan (§5.2, §5.3) and never read back from the
// implementation: the legal move set per boss and state (AC-3), that a chosen move is applied
// exactly and anything else falls back deterministically (AC-4), the doubled turn (AC-5), that the
// round completes once and survives a save mid-pause (AC-6), the Kingpin's crew on his own rhythm
// (AC-8), the Reflection's and the Hollow Self's casts (AC-9) and the Sin's grief (AC-10).
//
// Every scripted face below fixes a natural roll exactly: face(f, sides) = (f - 0.5) / sides.

import { describe, expect, it } from 'vitest';
import { step, type GameState, type StepResult } from './game.ts';
import { createBattle, resolveBossChoice, type BattleState } from './battle.ts';
import {
  BOSSES,
  KINGPIN_MINION_DAMAGE,
  legalBossMoves,
  describeBossMove,
  pickFallbackMove,
  type BossId,
  type BossMoveId,
  type BossState,
} from './boss.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { computeStatMods, type Stats } from './character.ts';
import { createKarma } from './karma.ts';
import { mulberry32, type Rng } from './rng.ts';
import { SKILLS } from './skill.ts';
import { encodeSave, decodeSave } from './save.ts';
import { heuristicPolicy, gearUpAtHub } from './sim.ts';
import { createGame } from './game.ts';
import type { GameEvent } from './gameEvent.ts';

// ------- Fixtures ------------------------------------------------------------

/** DEX 10 on both sides ⇒ a tempo rate of 0: one action a round, never doubled, never lost. */
const STATS: Stats = { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 10, CHA: 10 };

function makePlayer(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ name: 'Tester', classId: 'Enforcer', stats: STATS }), hp: 999, maxHp: 999, ...overrides };
}

function makeBossEnemy(bossId: BossId, act: number, overrides: Partial<Enemy> = {}): Enemy {
  const base = generateEnemy({ act, type: BOSSES[bossId].name, playerXp: 0 }, mulberry32(1));
  const stats = { ...base.stats, DEX: 10 };
  return { ...base, stats, mods: computeStatMods(stats), hp: 9999, maxHp: 9999, ...overrides };
}

function battleOf(boss: BossState, act: number, player: Player, enemy: Enemy): BattleState {
  return createBattle(player, enemy, act, { boss });
}

function gameOf(battle: BattleState, rngState = 7): GameState {
  return {
    version: 9,
    rngState,
    player: battle.player,
    act: battle.act,
    place: battle.act - 1,
    karma: createKarma(),
    phase: { kind: 'battle', battle, started: true, final: false },
  };
}

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`scriptedRng exhausted after ${values.length} draw(s)`);
    return values[i++]!;
  };
}
const face = (f: number, sides: number): number => (f - 0.5) / sides;

function battleOfState(s: GameState): BattleState {
  if (s.phase.kind !== 'battle') throw new Error(`not a battle: ${s.phase.kind}`);
  return s.phase.battle;
}

function kingpin(minions = 0, extra: Partial<BossState> = {}): BossState {
  return { bossId: 'kingpin', round: 0, minions, ...extra };
}

// ------- AC-3: the legal set, per boss and state (rules from §5.2) ------------

describe('legalBossMoves — the engine lists exactly what the rules allow (AC-3)', () => {
  const player = makePlayer();

  it('Kingpin: strike always; call_crew only under the cap of 2; hold_back only with a crew', () => {
    const e = makeBossEnemy('kingpin', 1);
    const ids = (minions: number, extra: Partial<BossState> = {}): string[] =>
      legalBossMoves({ boss: kingpin(minions, extra), enemy: e, player }).map((o) => o.id);
    expect(ids(0)).toEqual(['strike', 'call_crew']);
    expect(ids(1)).toEqual(['strike', 'call_crew', 'hold_back']);
    expect(ids(2)).toEqual(['strike', 'hold_back']);
    // `drop_mechanic` stops the calling; the standing crew still lets him hold back.
    expect(ids(1, { crewDisbanded: true })).toEqual(['strike', 'hold_back']);
    // The Kingpin never casts, whatever his base pool holds.
    expect(e.skillPool.length).toBeGreaterThan(0);
  });

  it('Reflection: a cast only for a skill in its copied kit that its charges cover', () => {
    // Heavy Strike costs 2, Brace 1 (skill.ts) — with 1 charge only Brace is affordable.
    expect(SKILLS.heavyStrike.chargeCost).toBe(2);
    expect(SKILLS.brace.chargeCost).toBe(1);
    const boss: BossState = { bossId: 'reflection', round: 0, adapted: false, actionTally: {} };
    const pool = ['heavyStrike', 'brace'];
    const one = makeBossEnemy('reflection', 2, { skillPool: pool, skillCharges: 1 });
    const two = makeBossEnemy('reflection', 2, { skillPool: pool, skillCharges: 2 });
    const none = makeBossEnemy('reflection', 2, { skillPool: pool, skillCharges: 0 });
    expect(legalBossMoves({ boss, enemy: one, player }).map((o) => o.id)).toEqual(['strike', 'cast:brace']);
    expect(legalBossMoves({ boss, enemy: two, player }).map((o) => o.id)).toEqual(['strike', 'cast:heavyStrike', 'cast:brace']);
    expect(legalBossMoves({ boss, enemy: none, player }).map((o) => o.id)).toEqual(['strike']);
  });

  it('Sin: strike, its own casts, and grieve only while the player holds a charge', () => {
    const boss: BossState = { bossId: 'sin', round: 0, sinIdentity: 'grief', sinBonusHp: 0 };
    const e = makeBossEnemy('sin', 3, { skillPool: ['pyroBall'], skillCharges: 2 });
    expect(legalBossMoves({ boss, enemy: e, player: makePlayer({ skillCharges: 1 }) }).map((o) => o.id)).toEqual([
      'strike',
      'cast:pyroBall',
      'grieve',
    ]);
    expect(legalBossMoves({ boss, enemy: e, player: makePlayer({ skillCharges: 0 }) }).map((o) => o.id)).toEqual([
      'strike',
      'cast:pyroBall',
    ]);
  });

  it('Executioner: strike and its data kit (Smite the Wicked costs 2, the other two 1)', () => {
    const boss: BossState = { bossId: 'executioner', round: 0, deedCursor: 0 };
    const kit = ['smiteWicked', 'blindingLight', 'wardingStrike'];
    const at2 = makeBossEnemy('executioner', 4, { skillPool: kit, skillCharges: 2 });
    const at1 = makeBossEnemy('executioner', 4, { skillPool: kit, skillCharges: 1 });
    expect(legalBossMoves({ boss, enemy: at2, player }).map((o) => o.id)).toEqual([
      'strike',
      'cast:smiteWicked',
      'cast:blindingLight',
      'cast:wardingStrike',
    ]);
    expect(legalBossMoves({ boss, enemy: at1, player }).map((o) => o.id)).toEqual([
      'strike',
      'cast:blindingLight',
      'cast:wardingStrike',
    ]);
  });

  it('Hollow Self: affordability is judged on the WARPED cost (warped adds +1 charge)', () => {
    // corruptions.json: `warped` is chargeDelta +1. Siphon costs 1, so warped it costs 2.
    expect(SKILLS.siphon.chargeCost).toBe(1);
    const boss: BossState = { bossId: 'hollow', round: 0, warpedSkills: { siphon: 'warped' } };
    const e1 = makeBossEnemy('hollow', 5, { skillPool: ['siphon'], skillCharges: 1 });
    const e2 = makeBossEnemy('hollow', 5, { skillPool: ['siphon'], skillCharges: 2 });
    expect(legalBossMoves({ boss, enemy: e1, player }).map((o) => o.id)).toEqual(['strike']);
    expect(legalBossMoves({ boss, enemy: e2, player }).map((o) => o.id)).toEqual(['strike', 'cast:siphon']);
  });

  it('every option carries a plain-words description; a cast names its skill as the boss would cast it', () => {
    const boss: BossState = { bossId: 'hollow', round: 0, warpedSkills: { siphon: 'bleeding' } };
    const e = makeBossEnemy('hollow', 5, { skillPool: ['siphon'], skillCharges: 2 });
    const options = legalBossMoves({ boss, enemy: e, player });
    for (const o of options) expect(o.description.length).toBeGreaterThan(0);
    expect(options.find((o) => o.id === 'cast:siphon')?.description).toContain('Siphon (bleeding)');
    expect(describeBossMove({ kind: 'call_crew' })).not.toMatch(/\{|\}/);
  });

  it('a battle with no boss lists nothing', () => {
    const e = makeBossEnemy('kingpin', 1);
    expect(legalBossMoves({ enemy: e, player })).toEqual([]);
  });
});

// ------- AC-3 through step: the pause ----------------------------------------

describe('a boss round pauses for the boss’s move (AC-3)', () => {
  it('after the player’s half, step awaits boss-choice with the legal ids on the battle', () => {
    const r = step(gameOf(battleOf(kingpin(0), 1, makePlayer(), makeBossEnemy('kingpin', 1))), {
      kind: 'battle-action',
      action: 'fight',
    });
    expect(r.awaiting).toBe('boss-choice');
    const b = battleOfState(r.state);
    expect(b.bossChoice?.legal).toEqual(['strike', 'call_crew']);
    expect(b.bossChoice?.remaining).toBe(1);
    expect(b.bossChoice?.playerActionKey).toBe('fight');
    // The boss has not acted yet: no attack from it, no boss-move.
    expect(r.events.some((e) => e.kind === 'boss-move')).toBe(false);
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'enemy')).toBe(false);
  });

  it('a non-boss battle NEVER awaits boss-choice — real runs, every step', () => {
    let bossPauses = 0;
    let normalBattleSteps = 0;
    for (const seed of [1, 2, 3, 4]) {
      let r: StepResult = { state: createGame(seed), events: [], awaiting: 'title' };
      const policy = heuristicPolicy('Enforcer');
      for (let i = 0; i < 20_000 && r.awaiting !== 'game-over'; i += 1) {
        if (r.awaiting === 'main-menu') r = { ...r, state: gearUpAtHub(r.state) };
        r = step(r.state, policy(r));
        const phase = r.state.phase;
        if (r.awaiting === 'boss-choice') {
          bossPauses += 1;
          expect(phase.kind === 'battle' && phase.battle.boss !== undefined).toBe(true);
        } else if (phase.kind === 'battle' && !phase.battle.boss && phase.started) {
          normalBattleSteps += 1;
          expect(phase.battle.bossChoice).toBeUndefined();
        }
      }
    }
    // Non-vacuity: both kinds of fight were really played.
    expect(bossPauses).toBeGreaterThan(0);
    expect(normalBattleSteps).toBeGreaterThan(20);
  });
});

// ------- AC-4: exact, fallback, and the other inputs ---------------------------

describe('the boss-choice input (AC-4)', () => {
  const paused = (): StepResult =>
    step(gameOf(battleOf(kingpin(1), 1, makePlayer(), makeBossEnemy('kingpin', 1))), {
      kind: 'battle-action',
      action: 'fight',
    });

  it('a legal id is applied exactly: call_crew adds one to the crew, with no blow that action', () => {
    const p = paused();
    expect(p.awaiting).toBe('boss-choice');
    const r = step(p.state, { kind: 'boss-choice', move: 'call_crew' });
    expect(r.events.filter((e) => e.kind === 'boss-move')).toEqual([{ kind: 'boss-move', bossId: 'kingpin', move: 'call_crew' }]);
    expect(r.events).toContainEqual({ kind: 'boss-summon', minions: 2 });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'enemy')).toBe(false);
    expect(battleOfState(r.state).boss?.minions).toBe(2);
    expect(battleOfState(r.state).bossChoice).toBeUndefined();
    expect(r.awaiting).toBe('battle-action');
  });

  it('null takes the seeded fallback: deterministic, and always one of the legal ids', () => {
    const p = paused();
    const legal = battleOfState(p.state).bossChoice!.legal;
    const a = step(p.state, { kind: 'boss-choice', move: null });
    const b = step(p.state, { kind: 'boss-choice', move: null });
    expect(a).toEqual(b);
    const moved = a.events.find((e) => e.kind === 'boss-move');
    expect(moved && moved.kind === 'boss-move' && legal.includes(moved.move as BossMoveId)).toBe(true);
    // The fallback is one uniform draw over the list (the author's Q1a), from this step's rng.
    expect(pickFallbackMove(legal, mulberry32(1))).toBe(legal[Math.floor(mulberry32(1)() * legal.length)]);
  });

  it('an id the engine did not list is treated exactly as null (§17.3.3 — fall back, never stall)', () => {
    const p = paused();
    const viaNull = step(p.state, { kind: 'boss-choice', move: null });
    // A cast the Kingpin has no such move for, and a move he cannot make at the cap.
    expect(step(p.state, { kind: 'boss-choice', move: 'cast:heavyStrike' })).toEqual(viaNull);
    expect(step(p.state, { kind: 'boss-choice', move: 'grieve' })).toEqual(viaNull);
  });

  it('any other input during the pause is a no-op — same state, no events', () => {
    const p = paused();
    for (const input of [
      { kind: 'battle-action', action: 'fight' },
      { kind: 'continue' },
      { kind: 'menu', choice: 'continue' },
    ] as const) {
      const r = step(p.state, input);
      expect(r.state).toBe(p.state);
      expect(r.events).toEqual([]);
      expect(r.awaiting).toBe('boss-choice');
    }
  });

  it('a boss-choice with no pause open is a no-op too', () => {
    const s = gameOf(battleOf(kingpin(0), 1, makePlayer(), makeBossEnemy('kingpin', 1)));
    const r = step(s, { kind: 'boss-choice', move: 'strike' });
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });
});

// ------- AC-5: a boss granted two actions is asked twice ------------------------

describe('a doubled boss turn is two choices (AC-5)', () => {
  it('the first choice re-pauses with remaining 1 after tempo-extra-action; the second completes the round', () => {
    // The Kingpin's gauge sits at 0.9 with a DEX-12 rate of +0.1: 0.9 + 0.1 crosses +1.0.
    const stats = { ...STATS, DEX: 12 };
    const enemy = { ...makeBossEnemy('kingpin', 1), stats, mods: computeStatMods(stats) };
    const battle: BattleState = { ...battleOf(kingpin(0), 1, makePlayer(), enemy), tempo: { player: 0, enemy: 9 } };
    const p = step(gameOf(battle), { kind: 'battle-action', action: 'fight' });
    expect(battleOfState(p.state).bossChoice?.remaining).toBe(2);

    const first = step(p.state, { kind: 'boss-choice', move: 'call_crew' });
    expect(first.awaiting).toBe('boss-choice');
    expect(battleOfState(first.state).bossChoice?.remaining).toBe(1);
    expect(first.events).toContainEqual({ kind: 'tempo-extra-action', subject: 'enemy' });
    // The legal list is recomputed: the crew he just called makes hold_back legal.
    expect(battleOfState(first.state).bossChoice?.legal).toEqual(['strike', 'call_crew', 'hold_back']);
    // The round has NOT completed: no crew damage, the round counter still 0.
    expect(first.events.some((e) => e.kind === 'boss-minion-damage')).toBe(false);
    expect(battleOfState(first.state).boss?.round).toBe(0);

    const second = step(first.state, { kind: 'boss-choice', move: 'hold_back' });
    expect(second.awaiting).toBe('battle-action');
    expect(battleOfState(second.state).boss?.round).toBe(1);
    expect(second.events.filter((e) => e.kind === 'boss-minion-damage')).toEqual([
      { kind: 'boss-minion-damage', amount: 1 * KINGPIN_MINION_DAMAGE },
    ]);
  });
});

// ------- AC-6: once per round, and a save mid-pause --------------------------

describe('the round completes once, and a save taken mid-pause resumes identically (AC-6)', () => {
  it('encodeSave/decodeSave mid-pause keeps the legal list and steps to the identical next state', () => {
    const p = step(gameOf(battleOf(kingpin(1), 1, makePlayer(), makeBossEnemy('kingpin', 1))), {
      kind: 'battle-action',
      action: 'fight',
    });
    const revived = decodeSave(encodeSave(p.state));
    expect(revived).not.toBeNull();
    expect(battleOfState(revived!).bossChoice).toEqual(battleOfState(p.state).bossChoice);
    for (const move of [null, 'strike', 'hold_back'] as const) {
      expect(step(revived!, { kind: 'boss-choice', move })).toEqual(step(p.state, { kind: 'boss-choice', move }));
    }
  });
});

// ------- AC-8: the Kingpin's crew on his own rhythm ------------------------------

describe('the Kingpin’s crew comes only when he calls it (AC-8)', () => {
  /** One whole round: the player's Fight, then the Kingpin's `move`. Returns the events. */
  function round(s: GameState, move: BossMoveId): { state: GameState; events: GameEvent[] } {
    const a = step(s, { kind: 'battle-action', action: 'fight' });
    expect(a.awaiting).toBe('boss-choice');
    const b = step(a.state, { kind: 'boss-choice', move });
    return { state: b.state, events: [...a.events, ...b.events] };
  }

  it('a Kingpin who never calls has no crew after 12 rounds, and the crew never strikes', () => {
    let s = gameOf(battleOf(kingpin(0), 1, makePlayer(), makeBossEnemy('kingpin', 1)));
    for (let i = 0; i < 12; i += 1) {
      const r = round(s, 'strike');
      expect(r.events.some((e) => e.kind === 'boss-summon' || e.kind === 'boss-minion-damage')).toBe(false);
      s = r.state;
    }
    expect(battleOfState(s).boss?.minions).toBe(0);
    expect(battleOfState(s).boss?.round).toBe(12);
  });

  it('call, call, then hold back ×10: 2 minions after round 2, and exactly minions × 1 lost each round', () => {
    // The Kingpin never attacks (call_crew and hold_back are not blows), the player's own Fight
    // never costs the player HP, and nothing ticks — so every HP the player loses is the crew's.
    // Hand rule: round 1 → crew 1 → 1; round 2 → crew 2 → 2; rounds 3..12 → 2 each. Total 23.
    let s = gameOf(battleOf(kingpin(0), 1, makePlayer(), makeBossEnemy('kingpin', 1)));
    const moves: BossMoveId[] = ['call_crew', 'call_crew', ...Array<BossMoveId>(10).fill('hold_back')];
    const lost: number[] = [];
    for (const move of moves) {
      const before = battleOfState(s).player.hp;
      s = round(s, move).state;
      lost.push(before - battleOfState(s).player.hp);
    }
    expect(battleOfState(s).boss?.minions).toBe(2);
    expect(lost).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2].map((n) => n * KINGPIN_MINION_DAMAGE));
  });
});

// ------- AC-9: the chosen cast is what lands ---------------------------------------

describe('a chosen cast is the cast that lands (AC-9)', () => {
  function pausedBattle(boss: BossState, enemy: Enemy, player = makePlayer()): BattleState {
    const b = battleOf(boss, 2, player, enemy);
    return {
      ...b,
      bossChoice: {
        legal: legalBossMoves({ boss, enemy, player: b.player }).map((o) => o.id),
        remaining: 1,
        playerActionKey: 'fight',
        advDis: 0,
      },
    };
  }

  it('Reflection: cast:brace lands Brace — never a random other — and a miss spends no charge', () => {
    const boss: BossState = { bossId: 'reflection', round: 0, adapted: false, actionTally: {} };
    const enemy = makeBossEnemy('reflection', 2, { skillPool: ['heavyStrike', 'brace'], skillCharges: 2 });
    // Natural 19 lands (not a crit); there is no pick draw, so one face is the whole stream.
    const hit = resolveBossChoice(pausedBattle(boss, enemy), 'cast:brace', scriptedRng([face(19, 20)]));
    const used = hit.events.filter((e) => e.kind === 'enemy-skill-used');
    expect(used).toEqual([{ kind: 'enemy-skill-used', skillId: 'brace', name: 'Brace' }]);
    expect(hit.state.enemy.skillCharges).toBe(1);
    // Natural 2 misses: no charge spent, nothing used.
    const miss = resolveBossChoice(pausedBattle(boss, enemy), 'cast:heavyStrike', scriptedRng([face(2, 20)]));
    expect(miss.events.some((e) => e.kind === 'enemy-skill-used')).toBe(false);
    expect(miss.state.enemy.skillCharges).toBe(2);
  });

  it('Reflection: an unaffordable cast falls back — the result equals the null choice', () => {
    const boss: BossState = { bossId: 'reflection', round: 0, adapted: false, actionTally: {} };
    const enemy = makeBossEnemy('reflection', 2, { skillPool: ['heavyStrike', 'brace'], skillCharges: 1 });
    const state = pausedBattle(boss, enemy);
    expect(state.bossChoice?.legal).not.toContain('cast:heavyStrike');
    const viaIllegal = resolveBossChoice(state, 'cast:heavyStrike', mulberry32(99));
    const viaNull = resolveBossChoice(state, null, mulberry32(99));
    expect(viaIllegal).toEqual(viaNull);
  });

  it('Hollow Self: its cast resolves the WARPED form — the suffix and the damage bonus are in the events', () => {
    // corruptions.json `bleeding`: damageBonus +2. Siphon base 3 ⇒ 5 on a hit (no resistance).
    const boss: BossState = { bossId: 'hollow', round: 0, warpedSkills: { siphon: 'bleeding' } };
    const enemy = makeBossEnemy('hollow', 5, { skillPool: ['siphon'], skillCharges: 2 });
    const r = resolveBossChoice(pausedBattle(boss, enemy), 'cast:siphon', scriptedRng([face(19, 20)]));
    expect(r.events).toContainEqual({ kind: 'enemy-skill-used', skillId: 'siphon', name: 'Siphon (bleeding)' });
    const attack = r.events.find((e) => e.kind === 'attack' && e.subject === 'enemy');
    expect(attack && attack.kind === 'attack' ? attack.damageSources : null).toEqual([
      { kind: 'skill', amount: SKILLS.siphon.baseDamage + 2 },
    ]);
  });

  it('a strike lands the card’s own die: the Reflection rolls 1d8 (face 6 is 6, no STR)', () => {
    const boss: BossState = { bossId: 'reflection', round: 0, adapted: false, actionTally: {} };
    const enemy = makeBossEnemy('reflection', 2, { skillPool: [], skillCharges: 2 });
    const r = resolveBossChoice(pausedBattle(boss, enemy), 'strike', scriptedRng([face(19, 20), face(6, 8)]));
    const attack = r.events.find((e) => e.kind === 'attack' && e.subject === 'enemy');
    expect(attack && attack.kind === 'attack' ? attack.damageSources : null).toEqual([
      { kind: 'weapon-dice', amount: 6, label: '1d8' },
    ]);
  });
});

// ------- AC-10: grieve -----------------------------------------------------------

describe('the Sin grieves: one charge, and nothing else (AC-10)', () => {
  it('3 charges and 20 HP become 2 charges and 20 HP, with boss-grieve and no blow', () => {
    const boss: BossState = { bossId: 'sin', round: 0, sinIdentity: 'grief', sinBonusHp: 0 };
    const player = makePlayer({ hp: 20, maxHp: 20, skillCharges: 3 });
    const p = step(gameOf(battleOf(boss, 3, player, makeBossEnemy('sin', 3))), { kind: 'battle-action', action: 'fight' });
    expect(p.awaiting).toBe('boss-choice');
    const before = battleOfState(p.state).player;
    expect(before.skillCharges).toBe(3);
    expect(battleOfState(p.state).bossChoice?.legal).toContain('grieve');
    const r = step(p.state, { kind: 'boss-choice', move: 'grieve' });
    const after = battleOfState(r.state).player;
    expect(after.skillCharges).toBe(2);
    expect(after.hp).toBe(before.hp);
    expect(before.hp).toBe(20);
    expect(r.events).toContainEqual({ kind: 'boss-grieve', amount: 1 });
    expect(r.events.some((e) => e.kind === 'attack')).toBe(false);
  });
});
