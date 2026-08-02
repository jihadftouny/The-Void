import { describe, expect, it } from 'vitest';
import { createBattle, resolveRound, rollFlee } from './battle.ts';
import { createPlayer, type Player } from './player.ts';
import { type Enemy } from './enemy.ts';
import { makeCondition } from './condition.ts';
import { type Rng } from './rng.ts';

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`scriptedRng exhausted: only ${values.length} draw(s) scripted`);
    }
    return values[i++]!;
  };
}
const face = (f: number, sides: number): number => (f - 0.5) / sides;

// Enforcer with STR 18 -> STR mod 4 (10 - ceil(|18-30|/2) = 4), equipped Jaaj Sword 1
// (Melee, 1d6). hp/maxHp forced to 20 for clean arithmetic; gold 1500, rests 1, pots 2.
function makePlayer(overrides: Partial<Player> = {}): Player {
  const base = createPlayer({
    name: 'Hero',
    classId: 'Enforcer',
    stats: { STR: 18, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
  });
  return { ...base, hp: 20, maxHp: 20, ...overrides };
}

// A fixed enemy: skillPool [pyroBall], 2 charges, 0 resistances, AC 10, xp as given.
function makeEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    name: 'Beast',
    type: 'Beast',
    fullName: 'Feral Rat',
    stats: { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 },
    mods: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 },
    hp: 30,
    maxHp: 30,
    xp: 2,
    armorClass: 10,
    skillCharges: 2,
    maxSkillCharges: 2,
    hitDie: { quantity: 1, sides: 8 },
    resistances: [0, 0, 0, 0, 0, 0, 0],
    skillPool: ['pyroBall'],
    activeConditions: [],
    ...overrides,
  };
}

describe('rollFlee — literal Java threshold rng()*10+1 <= 3.5', () => {
  it('escapes below the boundary and fails above it (independent of the constant)', () => {
    expect(rollFlee(scriptedRng([0.1]))).toBe(true); // 2.0 <= 3.5
    expect(rollFlee(scriptedRng([0.9]))).toBe(false); // 10.0 > 3.5
    expect(rollFlee(scriptedRng([0.25]))).toBe(true); // 3.5 <= 3.5 (boundary)
    expect(rollFlee(scriptedRng([0.2500001]))).toBe(false); // just past 3.5
  });
});

describe('resolveRound Fight — exact HP deltas + exact event list', () => {
  // Draw order [skillPick, playerD20, playerDamage]:
  //  1) enemy skill pick randInt(_,1)=0 -> Pyro Ball, res 0 -> damage 2, charge 2->1.
  //  2) no conditions -> tick draws nothing.
  //  3) player d20 face 15 + STR mod 4 = 19 >= enemy AC 10 -> hit.
  //  4) player damage 1d6 face 4 -> 4.
  //  Results: player.hp 20-2=18 ; enemy.hp 30-4=26 ; ongoing.
  it('produces the hand-derived HP and event stream and leaves the input unmutated', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 30 }), 1);
    const snapshot = JSON.parse(JSON.stringify(state));

    const r = resolveRound(state, 'fight', scriptedRng([0.5, face(15, 20), face(4, 6)]));

    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(26);
    expect(r.state.enemy.skillCharges).toBe(1);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      { kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2 },
      { kind: 'attack', subject: 'player', outcome: 'hit', damage: 4 },
    ]);

    // Input state deep-equals its pre-call snapshot (pure, returns a NEW state).
    expect(state).toEqual(snapshot);
    expect(r.state).not.toBe(state);
  });
});

describe('resolveRound Fight — victory rewards', () => {
  // enemy.xp 3, hp 4. Player deals 4 -> enemy 0 -> victory. Reward draws:
  //  extraRest: rng()*100+1 <= 25 -> 0.1 -> 11 <= 25 -> true.
  //  gold: randInt(_, 3) with 0.7 -> floor(2.1) = 2.
  it('grants xp = enemy.xp, gold, and an extra rest, and emits a victory event', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 4, xp: 3 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([0.5, face(15, 20), face(4, 6), 0.1, 0.7]));

    expect(r.status).toBe('player-won');
    expect(r.state.enemy.hp).toBe(0);
    expect(r.state.player.xp).toBe(3); // 0 + enemy.xp
    expect(r.state.player.gold).toBe(1502); // 1500 + 2
    expect(r.state.player.restsLeft).toBe(2); // 1 + extra rest
    expect(r.events.at(-1)).toEqual({ kind: 'victory', xpGained: 3, goldGained: 2, extraRest: true });
  });
});

describe('resolveRound Fight — defeat', () => {
  it('player at 1 HP taking 2 enemy damage dies with a defeat event', () => {
    const state = createBattle(makePlayer({ hp: 1 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([0.5, face(15, 20), face(4, 6)]));
    expect(r.status).toBe('player-died');
    expect(r.state.player.hp).toBe(0);
    expect(r.events.at(-1)).toEqual({ kind: 'defeat' });
  });
});

describe('resolveRound Fight — turn-skip condition blocks the player', () => {
  // Player is stunned. Enemy still hits for 2; the player deals 0 (no d20/damage draw).
  it('a stunned player deals 0 and emits player-unable-to-act', () => {
    const state = createBattle(makePlayer({ activeConditions: [makeCondition('stun')] }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([0.5]));

    expect(r.state.enemy.hp).toBe(30); // enemy took 0 from the player
    expect(r.state.player.hp).toBe(18); // 20 - 2 enemy damage
    expect(r.events).toContainEqual({ kind: 'player-unable-to-act', conditionType: 'stun' });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'player')).toBe(false);
  });
});

describe('resolveRound Potion', () => {
  it('at hp < maxHp with pots > 0: heals to maxHp, spends one pot, no enemy turn', () => {
    const state = createBattle(makePlayer({ hp: 10, maxHp: 20, pots: 2 }), makeEnemy(), 1);
    const r = resolveRound(state, 'potion', scriptedRng([]));
    expect(r.state.player.hp).toBe(20);
    expect(r.state.player.pots).toBe(1);
    expect(r.state.enemy.hp).toBe(30); // enemy did not act
    expect(r.events).toEqual([{ kind: 'potion-drunk', healedTo: 20 }]);
  });

  it('at full hp: unavailable, nothing changes', () => {
    const state = createBattle(makePlayer({ hp: 20, maxHp: 20, pots: 2 }), makeEnemy(), 1);
    const r = resolveRound(state, 'potion', scriptedRng([]));
    expect(r.events).toEqual([{ kind: 'potion-unavailable' }]);
    expect(r.state.player.pots).toBe(2);
    expect(r.state.player.hp).toBe(20);
  });

  it('with 0 pots: unavailable', () => {
    const state = createBattle(makePlayer({ hp: 10, maxHp: 20, pots: 0 }), makeEnemy(), 1);
    const r = resolveRound(state, 'potion', scriptedRng([]));
    expect(r.events).toEqual([{ kind: 'potion-unavailable' }]);
  });

  it('with a control condition (stun): blocked, nothing changes', () => {
    const state = createBattle(makePlayer({ hp: 10, maxHp: 20, pots: 2, activeConditions: [makeCondition('stun')] }), makeEnemy(), 1);
    const r = resolveRound(state, 'potion', scriptedRng([]));
    expect(r.events).toEqual([{ kind: 'potion-blocked' }]);
    expect(r.state.player.hp).toBe(10);
    expect(r.state.player.pots).toBe(2);
  });
});

describe('resolveRound Run', () => {
  it('escapes below the flee threshold (status fled), no damage', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy(), 1);
    const r = resolveRound(state, 'run', scriptedRng([0.1]));
    expect(r.status).toBe('fled');
    expect(r.events).toEqual([{ kind: 'fled' }]);
    expect(r.state.player.hp).toBe(20);
  });

  it('fails above the threshold: enemy counter-attacks for 2, status ongoing', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'run', scriptedRng([0.9, 0.5]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18); // 20 - 2
    expect(r.events).toContainEqual({ kind: 'escape-failed', damage: 2 });
  });

  it('in the final act (canFlee false): escape impossible, no damage, ongoing', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy(), 5);
    expect(state.canFlee).toBe(false);
    const r = resolveRound(state, 'run', scriptedRng([]));
    expect(r.status).toBe('ongoing');
    expect(r.events).toEqual([{ kind: 'escape-impossible' }]);
    expect(r.state.player.hp).toBe(20);
  });
});

describe('BattleState JSON round-trip', () => {
  it('state survives JSON.parse(JSON.stringify(x)) unchanged after a round', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([0.5, face(15, 20), face(4, 6)]));
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
  });
});
