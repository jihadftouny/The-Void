// Floor 2 — illusory enemies and the passive Wisdom roll (PLAN.md #2, AC-10..13).
//
// The rulings under test (GAME-DESIGN.md §22.24, plan Appendix A.1 — CONFIRMED by the author):
//   - about ONE FIGHT IN THREE on floor 2 is an illusion;
//   - the ONLY counter is a passive Wisdom roll each round, d20 + WIS mod >= ILLUSION_DC (13);
//   - an illusion's attacks are REAL; the player's deal NOTHING; seeing through ends the fight
//     with NO loot and NO XP — only the clarity nudge (`seeThroughIllusion`).
//
// Every die face below is SCRIPTED, so each expected number is derived from the dice rules by
// hand. The one statistical assertion (AC-10) is a binomial band around the author's 1/3.

import { describe, it, expect } from 'vitest';
import { buildRandomBattle } from './encounter.ts';
import { createBattle, resolveRound, DEFAULT_ROUND_RULES, type BattleState } from './battle.ts';
import { step, type GameState } from './game.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { createKarma } from './karma.ts';
import { makeCondition } from './condition.ts';
import { createRng, mulberry32, type Rng } from './rng.ts';
import { ILLUSION_DC } from './floors.ts';
import { type Stats } from './character.ts';

// ------- Fixtures ------------------------------------------------------------

/** The rng value that makes `rollDie(rng, sides)` land exactly on `face`. */
const face = (f: number, sides: number): number => (f - 0.5) / sides;

/** A scripted rng that THROWS when over-drawn, so a hidden extra draw cannot pass silently. */
function scripted(values: number[]): Rng & { used: () => number } {
  let i = 0;
  const rng = (() => {
    if (i >= values.length) throw new Error(`scripted rng exhausted after ${i} draws`);
    return values[i++]!;
  }) as Rng & { used: () => number };
  rng.used = () => i;
  return rng;
}

/** A counting wrapper over a real rng. */
function counting(seed: number): Rng & { count: () => number } {
  const base = mulberry32(seed);
  let n = 0;
  const rng = (() => {
    n += 1;
    return base();
  }) as Rng & { count: () => number };
  rng.count = () => n;
  return rng;
}

function stats(wis: number): Stats {
  return { STR: 10, DEX: 10, CON: 12, INT: 10, WIS: wis, CHA: 10 };
}

function hero(wis = 10, overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: stats(wis) }), ...overrides };
}

/** An enemy with STR 10 (to-hit mod 0), AC 10, no skills — every roll against it is arithmetic. */
function foe(overrides: Partial<Enemy> = {}): Enemy {
  const base = generateEnemy({ act: 2, type: 'Beast', playerXp: 0 }, mulberry32(4));
  return {
    ...base,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    armorClass: 10,
    hp: 10,
    maxHp: 10,
    resistances: [0, 0, 0, 0, 0, 0, 0],
    skillPool: [],
    skillCharges: 0,
    activeConditions: [],
    ...overrides,
  };
}

/** A started battle with NO standing advantage (so every d20 is exactly one draw). */
function fight(p: Player, e: Enemy): BattleState {
  return createBattle(p, e, 2);
}

function floorTwo(battle: BattleState, rngState: number): GameState {
  return {
    version: 9,
    rngState,
    player: battle.player,
    act: 2,
    place: 1,
    karma: createKarma(),
    phase: { kind: 'battle', battle, started: true, final: false },
  };
}

/** The d20 face the FIRST draw of a state's rng produces — computed from the same generator. */
function firstFace(rngState: number): number {
  return 1 + Math.floor(createRng(rngState).rng() * 20);
}

/** The first rngState at or after `from` whose first d20 lands in [lo, hi]. */
function seedWithFirstFace(lo: number, hi: number, from = 1): number {
  for (let s = from; s < from + 10_000; s++) {
    const f = firstFace(s);
    if (f >= lo && f <= hi) return s;
  }
  throw new Error('no seed found');
}

// ------- AC-10: about one fight in three, on floor 2 only ----------------------------------

describe('AC-10 — the illusion rate is the author’s "about one fight in three", on floor 2 only', () => {
  const seeds = Array.from({ length: 600 }, (_, i) => i + 1);
  const rate = (act: number, floor: 1 | 2 | 3 | 4 | 5): number => {
    let illusory = 0;
    for (const seed of seeds) {
      const b = buildRandomBattle(hero(), act, mulberry32(seed), undefined, undefined, floor);
      if (b.enemy.illusory) illusory += 1;
    }
    return illusory / seeds.length;
  };

  it('floor 2: within the binomial 95% band around 1/3 at n = 600 (±0.038)', () => {
    // sd = sqrt(p(1-p)/n) = sqrt((1/3)(2/3)/600) = 0.0192; 1.96 sd = 0.038 -> [0.295, 0.371],
    // widened to [0.28, 0.39] as the plan states so the band is not a coin-flip on the seed set.
    const r = rate(2, 2);
    expect(r).toBeGreaterThanOrEqual(0.28);
    expect(r).toBeLessThanOrEqual(0.39);
  });

  it('floors 1, 3, 4, 5: exactly zero', () => {
    for (const floor of [1, 3, 4, 5] as const) expect(rate(floor, floor), `floor ${floor}`).toBe(0);
  });

  it('the roll is the LAST draw, and only floor 2 takes it (off-equivalence)', () => {
    // Same seed, same player: floor 1 and "no floor" build the identical battle with the
    // identical number of draws; floor 2 takes exactly one more.
    const none = counting(99);
    const one = counting(99);
    const two = counting(99);
    const a = buildRandomBattle(hero(), 2, none);
    const b = buildRandomBattle(hero(), 2, one, undefined, undefined, 1);
    const c = buildRandomBattle(hero(), 2, two, undefined, undefined, 2);
    expect(b).toEqual(a);
    expect(one.count()).toBe(none.count());
    expect(two.count()).toBe(none.count() + 1);
    const { illusory: _dropped, ...rest } = c.enemy;
    void _dropped;
    expect(rest).toEqual(a.enemy); // the illusion flag is the ONLY difference
  });

  it('keys on the floor argument, not the act: act 5 on floor 2 still rolls', () => {
    const counts = [0, 0];
    for (const seed of seeds.slice(0, 120)) {
      if (buildRandomBattle(hero(), 5, mulberry32(seed), undefined, undefined, 2).enemy.illusory) counts[0]! += 1;
      if (buildRandomBattle(hero(), 2, mulberry32(seed), undefined, undefined, 5).enemy.illusory) counts[1]! += 1;
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(0);
  });
});

// ------- AC-11: the fracture hurts; you cannot hurt it --------------------------------------

describe('AC-11 — against an illusion, nothing the player does lands, and its attacks are real', () => {
  it('a fight that HITS deals 0 and says so; the enemy’s hit is real', () => {
    // Draws, in order: [Wisdom d20 = 5 -> 5 + 0 < 13, fails] [enemy tick: no conditions, 0]
    // [enemy to-hit d20 = 18 -> 18 + 0 vs the player's AC: a hit; no skills -> the plain 1]
    // [player tick: 0] [player to-hit d20 = 15: 15 + 0 (STR 10) + 2 (proficiency) = 17 >= 10,
    // a hit] [1d6 sword = 4]. The attack REPORTS 4; the enemy loses 0; the player loses 1.
    const b = fight(hero(10, { hp: 12, maxHp: 12 }), foe({ illusory: true }));
    const rng = scripted([face(5, 20), face(18, 20), face(15, 20), face(4, 6)]);
    const r = resolveRound(b, 'fight', rng);
    expect(rng.used()).toBe(4);
    expect(r.status).toBe('ongoing');
    expect(r.state.enemy.hp).toBe(10);
    expect(r.state.player.hp).toBe(11);
    const kinds = r.events.map((e) => e.kind);
    const playerAttack = r.events.findIndex((e) => e.kind === 'attack' && e.subject === 'player');
    expect(r.events[playerAttack]).toMatchObject({ outcome: 'hit', damage: 4 });
    expect(kinds[playerAttack + 1]).toBe('illusion-struck');
  });

  it('CONTROL: the same draws against a REAL enemy (no Wisdom draw) take 4 HP off it', () => {
    const b = fight(hero(10, { hp: 12, maxHp: 12 }), foe());
    const rng = scripted([face(18, 20), face(15, 20), face(4, 6)]);
    const r = resolveRound(b, 'fight', rng);
    expect(r.state.enemy.hp).toBe(6);
    expect(r.events.some((e) => e.kind === 'illusion-struck')).toBe(false);
  });

  it('a damaging CAST spends its charges and deals 0; its self-effects still apply', () => {
    // Heavy Strike: cost 2, base 3 + 1 per banked momentum (3 banked) = 6 — all of it passes
    // through. The charges are spent and the momentum is consumed (a self-effect), exactly as
    // against a real enemy. The enemy is frozen (skips, 0 draws); Wisdom 5 fails. 1 draw total.
    const p = hero(10, { skillCharges: 5, skillPool: ['heavyStrike', 'brace'], momentum: 3 });
    const b = fight(p, foe({ illusory: true, activeConditions: [makeCondition('freeze')] }));
    const r = resolveRound(b, { kind: 'cast', skillId: 'heavyStrike' }, scripted([face(5, 20)]));
    expect(r.state.enemy.hp).toBe(10);
    expect(r.state.player.skillCharges).toBe(3);
    expect(r.state.player.momentum).toBe(0);
    expect(r.events.map((e) => e.kind)).toContain('illusion-struck');
  });

  it('Brace (0 damage) still banks its momentum, and says nothing passed through', () => {
    const p = hero(10, { skillCharges: 5, skillPool: ['heavyStrike', 'brace'], momentum: 0 });
    const b = fight(p, foe({ illusory: true, activeConditions: [makeCondition('freeze')] }));
    const r = resolveRound(b, { kind: 'cast', skillId: 'brace' }, scripted([face(5, 20)]));
    expect(r.state.player.momentum).toBe(2); // brace gainMomentum 2
    expect(r.state.player.skillCharges).toBe(4);
    expect(r.events.some((e) => e.kind === 'illusion-struck')).toBe(false);
  });

  it('a Firebomb (6 fire) deals 0 to an illusion and reports it; no draw is taken', () => {
    const base = hero();
    const p: Player = { ...base, inventory: { ...base.inventory, backpack: [{ defId: 'firebomb' }] } };
    const b = fight(p, foe({ illusory: true }));
    const r = resolveRound(b, { kind: 'useConsumable', source: { index: 0 } }, scripted([]));
    expect(r.state.enemy.hp).toBe(10);
    expect(r.state.player.inventory.backpack).toEqual([]); // the item is spent
    expect(r.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['consumable-used', 'illusion-struck']),
    );
  });

  it('the Hollow’s lifesteal draws nothing from a wound that is not there', () => {
    // Siphon would heal floor(3 * 0.5) = 1 against a real target (floors.test.ts); here, 0.
    const p = { ...createPlayer({ name: 'H', classId: 'Hollow', stats: stats(10) }), hp: 5, maxHp: 12, skillCharges: 5, skillPool: ['siphon'] };
    const b = fight(p, foe({ illusory: true, activeConditions: [makeCondition('freeze')] }));
    const r = resolveRound(b, { kind: 'cast', skillId: 'siphon' }, scripted([face(5, 20)]));
    expect(r.state.player.hp).toBe(5);
  });

  it('a bleed on an illusion never takes its HP, so a DoT cannot win the fight', () => {
    // The bleed is PAST its onset (`onsetDone`), so it ticks damage THIS round — a fresh one
    // would spend the round on its onset and prove nothing.
    const bleed = { ...makeCondition('bleed'), onsetDone: true };
    const e = foe({ illusory: true, hp: 1, activeConditions: [bleed, makeCondition('freeze')] });
    const b = fight(hero(), e);
    // Draws: Wisdom 5 (fails); enemy tick draws whatever its conditions need (a real rng
    // supplies them); the player casts a 0-damage Brace. Whatever the tick says, HP stays 1.
    const rng = (() => {
      let first = true;
      const real = mulberry32(3);
      return () => (first ? ((first = false), face(5, 20)) : real());
    })();
    const r = resolveRound(b, { kind: 'cast', skillId: 'brace' }, rng);
    // Non-vacuity: the tick really did report damage on the enemy this round.
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'condition-damage', subject: 'enemy', conditionType: 'bleed' }));
    expect(r.state.enemy.hp).toBe(1);
    expect(r.status).not.toBe('player-won');
  });

  it('the battle can NEVER end in player-won: 200 seeds of blows at a 1-HP illusion', () => {
    let wins = 0;
    let controlWins = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = step(floorTwo(fight(hero(), foe({ illusory: true, hp: 1 })), seed), {
        kind: 'battle-action',
        action: 'fight',
      });
      if (r.state.phase.kind === 'battle-victory') wins += 1;
      const c = step(floorTwo(fight(hero(), foe({ hp: 1 })), seed), { kind: 'battle-action', action: 'fight' });
      if (c.state.phase.kind === 'battle-victory') controlWins += 1;
    }
    expect(wins).toBe(0);
    expect(controlWins).toBeGreaterThan(100); // the control proves a 1-HP real foe does fall
  });
});

// ------- AC-12: the passive Wisdom roll ----------------------------------------------------

describe('AC-12 — the passive Wisdom roll, d20 + effective WIS mod >= 13', () => {
  /** One Brace round against a frozen illusion: the Wisdom draw is the ONLY draw. */
  function roll(p: Player, d20: number) {
    const b = fight({ ...p, skillCharges: 5, skillPool: ['brace'] }, foe({ illusory: true, activeConditions: [makeCondition('freeze')] }));
    return resolveRound(b, { kind: 'cast', skillId: 'brace' }, scripted([face(d20, 20)]));
  }

  it('the DC is 13, and the round rules carry it by default', () => {
    expect(ILLUSION_DC).toBe(13);
    expect(DEFAULT_ROUND_RULES.illusionDc).toBe(13);
  });

  it('WIS 10 (mod 0): a 12 fails; the same player under Lucid (`wise`, +1) sees through', () => {
    expect(roll(hero(10), 12).status).toBe('ongoing');
    const lucid = hero(10, { activeConditions: [makeCondition('wise')] });
    const r = roll(lucid, 12);
    expect(r.status).toBe('dispelled');
    expect(r.events).toEqual([{ kind: 'illusion-dispelled', natural: 12, modifier: 1, total: 13, dc: 13 }]);
  });

  it('WIS 16 (mod +3) sees through on a 12; its threshold face is 10', () => {
    expect(roll(hero(16), 12).status).toBe('dispelled');
    expect(roll(hero(16), 10).status).toBe('dispelled');
    expect(roll(hero(16), 9).status).toBe('ongoing');
  });

  it('WIS 6 (mod -2) needs a 15', () => {
    expect(roll(hero(6), 14).status).toBe('ongoing');
    expect(roll(hero(6), 15).status).toBe('dispelled');
  });

  it('a dispel takes no further draw and changes nothing in the battle', () => {
    const b = fight(hero(16, { skillCharges: 5, skillPool: ['brace'] }), foe({ illusory: true }));
    const rng = scripted([face(15, 20)]);
    const r = resolveRound(b, 'fight', rng);
    expect(rng.used()).toBe(1);
    expect(r.state).toBe(b);
  });

  it('the injected DC is honoured (the balance report’s sensitivity seam)', () => {
    const b = fight(hero(10, { skillCharges: 5, skillPool: ['brace'] }), foe({ illusory: true, activeConditions: [makeCondition('freeze')] }));
    const at11 = resolveRound(b, { kind: 'cast', skillId: 'brace' }, scripted([face(11, 20)]), { healPct: 100, illusionDc: 11 });
    expect(at11.status).toBe('dispelled');
    const at15 = resolveRound(b, { kind: 'cast', skillId: 'brace' }, scripted([face(14, 20)]), { healPct: 100, illusionDc: 15 });
    expect(at15.status).toBe('ongoing');
  });

  it('through step: a dispel returns to the hub with NO XP, NO loot, and clarity +1', () => {
    // WIS 10: find a state whose FIRST d20 is >= 13 (so 13 + 0 >= 13). The face is computed
    // from the same generator `step` uses, not read off the outcome.
    const seed = seedWithFirstFace(13, 20);
    const p = hero(10);
    const s = floorTwo(fight(p, foe({ illusory: true })), seed);
    const r = step(s, { kind: 'battle-action', action: 'fight' });
    expect(r.state.phase.kind).toBe('main-menu');
    expect(r.events.map((e) => e.kind)).toEqual(['illusion-dispelled']);
    expect(r.state.player!.xp).toBe(p.xp);
    expect(r.state.player!.inventory).toEqual(p.inventory);
    expect(r.state.karma).toEqual({ ...createKarma(), clarityDelusion: 1 });
  });

  it('...and a FAILED roll through step leaves the battle on, with clarity untouched', () => {
    const seed = seedWithFirstFace(1, 12);
    const s = floorTwo(fight(hero(10), foe({ illusory: true })), seed);
    const r = step(s, { kind: 'battle-action', action: 'fight' });
    expect(r.state.phase.kind).toBe('battle');
    expect(r.state.karma).toEqual(createKarma());
    expect(r.events.some((e) => e.kind === 'illusion-dispelled')).toBe(false);
  });

  it('the DC injected into STEP reaches the round (the sim threads it; the game never does)', () => {
    // WIS 10 (mod 0) and a first face of exactly 12: short of the shipped 13, enough for 12.
    const seed = seedWithFirstFace(12, 12);
    const s = floorTwo(fight(hero(10), foe({ illusory: true })), seed);
    expect(step(s, { kind: 'battle-action', action: 'fight' }).state.phase.kind).toBe('battle');
    const at12 = step(s, { kind: 'battle-action', action: 'fight' }, { illusionDc: 12 });
    expect(at12.state.phase.kind).toBe('main-menu');
    expect(at12.events).toEqual([{ kind: 'illusion-dispelled', natural: 12, modifier: 0, total: 12, dc: 12 }]);
  });
});

// ------- AC-13: a real enemy's round is untouched ------------------------------------------

describe('AC-13 — a non-illusory round takes the same draws and emits the same events', () => {
  it('on floor 2 rules and on the default rules alike, for 50 seeds of fights and casts', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = hero(10, { skillCharges: 5, skillPool: ['heavyStrike', 'brace'] });
      const b = fight(p, foe());
      for (const action of ['fight', { kind: 'cast', skillId: 'heavyStrike' }] as const) {
        const a = counting(seed);
        const c = counting(seed);
        const ra = resolveRound(b, action, a);
        const rc = resolveRound(b, action, c, { healPct: 100, illusionDc: 13 });
        expect(rc).toEqual(ra);
        expect(c.count()).toBe(a.count());
      }
    }
  });

  it('the same enemy made illusory takes EXACTLY one more draw on a failed roll', () => {
    const p = hero(6); // mod -2: a face of 1..14 fails
    for (let seed = 1; seed <= 50; seed++) {
      if (firstFace(seed) >= 15) continue; // the Wisdom draw would succeed; skip
      const real = counting(seed + 1000);
      const fake = (() => {
        const w = createRng(seed).rng;
        let first = true;
        const tail = counting(seed + 1000);
        const f = (() => (first ? ((first = false), w()) : tail())) as Rng & { count: () => number };
        f.count = () => tail.count() + 1;
        return f;
      })();
      resolveRound(fight(p, foe()), 'fight', real);
      resolveRound(fight(p, foe({ illusory: true })), 'fight', fake);
      expect(fake.count()).toBe(real.count() + 1);
    }
  });
});
