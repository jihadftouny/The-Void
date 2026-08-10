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

// Enforcer with STR 18 -> STR mod 4 (floor((18-10)/2) = 4), equipped Jaaj Sword 1
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
  // Player AC = 13 (Enforcer, Jooj Armor 1 baseArmor 11, CON 12/+1, DEX 12/+1:
  // 11 + 1 + min(1,2)). Enemy STR 13 -> +1 to hit. Draw order [enemyToHit, skillPick,
  // playerD20, playerDamage]:
  //  1) no conditions -> enemy tick draws nothing.
  //  2) enemy to-hit d20 face 15 + 1 = 16 >= AC 13 -> hit; skill-pick randInt(_,1)=0 ->
  //     Pyro Ball, res 0 -> damage 2, charge 2->1.
  //  3) player tick draws nothing.
  //  4) player d20 face 15 + STR mod 4 = 19 >= enemy AC 10 -> hit; damage 1d6 face 4 -> 4.
  //  Results: player.hp 20-2=18 ; enemy.hp 30-4=26 ; ongoing.
  it('produces the hand-derived HP and event stream and leaves the input unmutated', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 30 }), 1);
    const snapshot = JSON.parse(JSON.stringify(state));

    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)]));

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
  // enemy.xp 3, hp 4. Player deals 4 -> enemy 0 -> victory. Reward draws (M7: gold -> loot):
  //  extraRest: rng()*100+1 <= 25 -> 0.1 -> 11 <= 25 -> true.
  //  loot gate: rng() < act-1 dropChance(0.5) -> 0.99 >= 0.5 -> no drop (one draw), loot [].
  it('grants xp = enemy.xp and an extra rest, and emits a victory event (no drop)', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 4, xp: 3 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6), 0.1, 0.99]));

    expect(r.status).toBe('player-won');
    expect(r.state.enemy.hp).toBe(0);
    expect(r.state.player.xp).toBe(3); // 0 + enemy.xp
    expect(r.state.player.restsLeft).toBe(2); // 1 + extra rest
    expect(r.state.player.inventory.backpack).toEqual([]); // failed drop gate adds nothing
    expect(r.events.at(-1)).toEqual({ kind: 'victory', xpGained: 3, extraRest: true, loot: [] });
  });
});

describe('resolveRound Fight — defeat', () => {
  it('player at 1 HP taking 2 enemy damage dies with a defeat event', () => {
    const state = createBattle(makePlayer({ hp: 1 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)]));
    expect(r.status).toBe('player-died');
    expect(r.state.player.hp).toBe(0);
    expect(r.events.at(-1)).toEqual({ kind: 'defeat' });
  });
});

describe('resolveRound Fight — turn-skip condition blocks the player', () => {
  // Player is stunned. Enemy still rolls to hit (face 15 -> 16 >= AC 13 -> hit) for 2; the
  // player deals 0 (no d20/damage draw). Draws [enemyToHit, skillPick].
  it('a stunned player deals 0 and emits player-unable-to-act', () => {
    const state = createBattle(makePlayer({ activeConditions: [makeCondition('stun')] }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5]));

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
    // Flee 0.9 fails -> enemy counter rolls to hit (face 15 -> 16 >= AC 13 -> hit) then
    // skill-pick 0.5 -> Pyro Ball 2. Draws [flee, enemyToHit, skillPick].
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'run', scriptedRng([0.9, face(15, 20), 0.5]));
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

describe('resolveRound Cast — damage, charge spend, condition applied', () => {
  // Player casts Ember (Pyro base 2, cost 1, applies burn) at a 0-resist enemy.
  // Draw order: enemy tick (conditionless -> 0 draws) -> enemy to-hit face 15 (16 >= AC 13
  // -> hit) -> skill-pick 0.5 -> Pyro Ball dmg 2, charge 2->1 -> player tick (0) -> cast
  // (NO draw). Player has no INT augment so skill damage = base 2. Results: player 20-2=18,
  // enemy 30-2=28.
  it('deals the skill damage, spends one charge, and applies burn to the enemy', () => {
    const state = createBattle(
      makePlayer({ skillPool: ['ember'], skillCharges: 5 }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const r = resolveRound(state, { kind: 'cast', skillId: 'ember' }, scriptedRng([face(15, 20), 0.5]));

    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(28);
    expect(r.state.player.skillCharges).toBe(4); // 5 - 1
    expect(r.state.enemy.skillCharges).toBe(1); // enemy pyroBall spent one
    expect(r.state.enemy.activeConditions).toEqual([makeCondition('burn')]);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      { kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2 },
      { kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember' },
      { kind: 'condition-applied', subject: 'enemy', conditionType: 'burn' },
    ]);
  });
});

describe('resolveRound Cast — guards (no charge, no hp change, no rng draw)', () => {
  it('a skill not in skillPool is cast-unavailable and changes nothing', () => {
    const state = createBattle(makePlayer({ skillPool: ['ember'], skillCharges: 5, hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, { kind: 'cast', skillId: 'venom' }, scriptedRng([]));
    expect(r.events).toEqual([{ kind: 'cast-unavailable' }]);
    expect(r.state.player.skillCharges).toBe(5);
    expect(r.state.player.hp).toBe(20);
    expect(r.state.enemy.hp).toBe(30);
  });

  it('insufficient charges is cast-unavailable and changes nothing', () => {
    const state = createBattle(makePlayer({ skillPool: ['ember'], skillCharges: 0, hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, { kind: 'cast', skillId: 'ember' }, scriptedRng([]));
    expect(r.events).toEqual([{ kind: 'cast-unavailable' }]);
    expect(r.state.player.skillCharges).toBe(0);
  });

  it('a control-skipped player who casts spends NO charge and emits player-unable-to-act', () => {
    // Guard passes (has the skill + a charge), but the player is stunned, so step 4
    // never reaches the cast branch: no charge spent, no burn applied, no skill-cast.
    const state = createBattle(
      makePlayer({ skillPool: ['ember'], skillCharges: 5, activeConditions: [makeCondition('stun')] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const r = resolveRound(state, { kind: 'cast', skillId: 'ember' }, scriptedRng([face(15, 20), 0.5]));
    expect(r.state.player.skillCharges).toBe(5); // unchanged
    expect(r.state.enemy.hp).toBe(30); // no cast damage
    expect(r.state.player.hp).toBe(18); // 20 - 2 enemy Pyro Ball
    expect(r.events).toContainEqual({ kind: 'player-unable-to-act', conditionType: 'stun' });
    expect(r.events.some((e) => e.kind === 'skill-cast')).toBe(false);
    expect(r.state.enemy.activeConditions).toEqual([]);
  });
});

describe('resolveRound — enemy-side condition ticking', () => {
  // Player-inflicted DoT on the enemy now ticks. Enemy carries poison at its effect
  // phase (remaining 1) with hp 1 and xp 3: the enemy dies to its OWN poison tick before
  // acting -> still player-won. Poison rolls no save, so the tick draws nothing; then the
  // victory block draws extra-rest (0.1 -> 11 <= 25 true) then the loot gate (0.99 >= 0.5 ->
  // no drop). M7: gold draw replaced by the loot roll.
  it('an enemy killed by its own DoT tick (before acting) yields player-won + rewards', () => {
    const state = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 1, xp: 3, activeConditions: [{ type: 'poison', remainingTurns: 1, maxTurns: 2 }] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([0.1, 0.99]));

    expect(r.status).toBe('player-won');
    expect(r.state.enemy.hp).toBe(0);
    expect(r.state.player.hp).toBe(20); // enemy never got to attack
    expect(r.state.player.xp).toBe(3); // 0 + enemy.xp
    expect(r.state.player.restsLeft).toBe(2); // 1 + extra rest
    expect(r.events).toEqual([
      { kind: 'condition-damage', subject: 'enemy', conditionType: 'poison', amount: 1 },
      { kind: 'victory', xpGained: 3, extraRest: true, loot: [] },
    ]);
  });

  // A control condition on the enemy makes it skip its attack. Enemy carries a fresh
  // freeze (onset): the enemy tick sets the skip flag (no save on onset, 0 draws) and the
  // enemy deals no damage. Player then fights normally.
  it('a controlled enemy (freeze) skips its attack that round', () => {
    const state = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 30, activeConditions: [makeCondition('freeze')] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 6)]));

    expect(r.state.player.hp).toBe(20); // enemy skipped -> no enemy damage
    expect(r.state.enemy.hp).toBe(26); // 30 - player 1d6(4)
    expect(r.events).toContainEqual({ kind: 'condition-skip', subject: 'enemy', conditionType: 'freeze' });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'enemy')).toBe(false);
    expect(r.events.some((e) => e.kind === 'enemy-skill-used')).toBe(false);
  });
});

describe('resolveRound Potion — effectiveMaxHp cap (Frail)', () => {
  // A Frail (sick) player heals to the REDUCED effective max HP, not the stored maxHp.
  // stored maxHp 20; sick lowers CON by 2 (mod delta -1) -> effectiveMaxHp 19.
  it('a Frail player below full heals to effectiveMaxHp (19), not stored maxHp (20)', () => {
    const state = createBattle(
      makePlayer({ hp: 10, maxHp: 20, pots: 2, activeConditions: [makeCondition('sick')] }),
      makeEnemy(),
      1,
    );
    const r = resolveRound(state, 'potion', scriptedRng([]));
    expect(r.state.player.hp).toBe(19);
    expect(r.state.player.pots).toBe(1);
    expect(r.events).toEqual([{ kind: 'potion-drunk', healedTo: 19 }]);
  });
});

describe('resolveRound Fight — conditionless round, exact draw order (M4)', () => {
  // A conditionless round draws exactly four (M4 adds the enemy to-hit d20 ahead of the
  // skill-pick). Independent hand-derivation (enemy hp 10, player AC 13, enemy +1 to hit):
  //   enemy tick: 0 draws. enemy to-hit face 15 + 1 = 16 >= AC 13 -> hit; skill-pick 0.5 ->
  //   Pyro Ball dmg 2, charge 2->1. player tick: 0 draws. player d20 face 12 + STR mod 4 =
  //   16 >= enemy AC 10 -> hit; dmg 1d6 face 5 -> 5. player 20-2=18, enemy 10-5=5, ongoing.
  it('produces the hand-derived state + event list and consumes exactly 4 draws', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 10 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(12, 20), face(5, 6)]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(5);
    expect(r.state.enemy.skillCharges).toBe(1);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      { kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2 },
      { kind: 'attack', subject: 'player', outcome: 'hit', damage: 5 },
    ]);
  });
});

describe('resolveRound Fight — enemy misses (M4 defense matters)', () => {
  // The enemy rolls a LOW natural: face 5 + 1 = 6 < AC 13 -> MISS. It deals 0, draws no
  // skill-pick, and applies no condition; the player still fights. Draws [enemyToHit,
  // playerD20, playerDamage] (only three — a skill-pick on a miss would exhaust the rng).
  //   player d20 face 15 + STR 4 = 19 >= enemy AC 10 -> hit; dmg 1d6 face 4 -> 4.
  //   player 20-0=20, enemy 30-4=26, ongoing.
  it('a whiffed enemy attack deals 0 and emits attack/miss with no enemy-skill-used', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(5, 20), face(15, 20), face(4, 6)]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(20); // took 0
    expect(r.state.enemy.hp).toBe(26); // 30 - 4
    expect(r.state.enemy.skillCharges).toBe(2); // no charge spent on a miss
    expect(r.events).toEqual([
      { kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0 },
      { kind: 'attack', subject: 'player', outcome: 'hit', damage: 4 },
    ]);
    expect(r.events.some((e) => e.kind === 'enemy-skill-used')).toBe(false);
  });
});

describe('resolveRound — M3 class twists in a full round', () => {
  // Momentum-on-damage hooks: an Enforcer who BOTH deals and takes damage in a round gains
  // +1 (dealt) +1 (taken) = 2 momentum. Draw order [skillPick, playerD20, playerDamage]:
  //  enemy pyroBall dmg 2 (player takes 2 -> +1) ; player d20 15+STR4=19 hit, 1d6(4) dealt
  //  (enemy takes 4 -> +1). Start momentum 0 -> end 2.
  it('an Enforcer gains +2 momentum in a round where it hits and is hit', () => {
    const state = createBattle(makePlayer({ hp: 20, momentum: 0 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)]));
    expect(r.state.player.hp).toBe(18); // 20 - 2
    expect(r.state.enemy.hp).toBe(26); // 30 - 4
    expect(r.state.player.momentum).toBe(2);
  });

  // Casting Heavy Strike (spendMomentum, momentumDamagePer 1) at momentum 4: base 3 + 4 = 7
  // enemy damage, momentum spent to 0 by the cast, then the on-damage hooks re-add +1 (dealt
  // 7) +1 (took 2 from pyroBall) = 2. charge 5 -> 3 (cost 2). Applies fracture. Draw order:
  // enemy tick 0 -> skillPick 0.5 -> player tick 0 -> cast (no draw).
  it('Enforcer Heavy Strike spends momentum for burst, then the hooks re-bank +2', () => {
    const state = createBattle(
      makePlayer({ hp: 20, momentum: 4, skillCharges: 5, skillPool: ['heavyStrike'] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const r = resolveRound(state, { kind: 'cast', skillId: 'heavyStrike' }, scriptedRng([face(15, 20), 0.5]));
    expect(r.state.enemy.hp).toBe(23); // 30 - 7
    expect(r.state.player.hp).toBe(18); // 20 - 2
    expect(r.state.player.skillCharges).toBe(3);
    expect(r.state.player.momentum).toBe(2); // spent to 0 by cast, +1 dealt +1 taken
    expect(r.state.enemy.activeConditions.some((c) => c.type === 'fracture')).toBe(true);
    expect(r.events).toContainEqual({ kind: 'resource-changed', subject: 'player', resource: 'momentum', value: 0 });
  });

  // Detonate through the round. A Neuromancer (no momentum hook) casts Synapse at an enemy
  // carrying insanity + sleep (both control -> the enemy is skipped, and both fresh -> onset,
  // NO save draw). Enemy has 0 charges. Draws: enemy tick 0 -> enemy skipped (no skillPick) ->
  // player tick 0 -> cast 0 = zero draws total. Synapse base 1 + 2x2 detonate = 5; the two
  // mental conditions are consumed.
  it('a Neuromancer detonates the enemy mental conditions for bonus damage', () => {
    const state = createBattle(
      makePlayer({ hp: 20, maxHp: 20, classId: 'Neuromancer', skillPool: ['synapse'], skillCharges: 5 }),
      makeEnemy({ hp: 30, skillCharges: 0, activeConditions: [makeCondition('insanity'), makeCondition('sleep')] }),
      1,
    );
    const r = resolveRound(state, { kind: 'cast', skillId: 'synapse' }, scriptedRng([]));
    expect(r.state.enemy.hp).toBe(25); // 30 - 5
    expect(r.state.player.hp).toBe(20); // enemy skipped (controlled)
    expect(r.state.player.skillCharges).toBe(3); // synapse costs 2
    expect(r.state.enemy.activeConditions.some((c) => c.type === 'insanity' || c.type === 'sleep')).toBe(false);
    expect(r.events).toContainEqual({ kind: 'detonate', consumed: 2, bonusDamage: 4 });
  });

  // HP-as-fuel + lifesteal through the round. A Hollow (no momentum hook) casts Siphon while
  // the enemy (0 charges) rolls to hit and lands the plain 1 (face 15 -> 16 >= AC 13 -> hit;
  // one to-hit draw even with 0 charges). Siphon deals 3 and lifesteals floor(3 x 0.5) = 1:
  // caster 10 -> 11 (cast) -> 10 (after taking the enemy's 1). enemy 30 -> 27.
  it('a Hollow lifesteals on cast, netted against the enemy hit', () => {
    const state = createBattle(
      makePlayer({ hp: 10, maxHp: 30, classId: 'Hollow', skillPool: ['siphon'], skillCharges: 5 }),
      makeEnemy({ hp: 30, skillCharges: 0 }),
      1,
    );
    const r = resolveRound(state, { kind: 'cast', skillId: 'siphon' }, scriptedRng([face(15, 20)]));
    expect(r.state.enemy.hp).toBe(27); // 30 - 3
    expect(r.state.player.hp).toBe(10); // 10 + 1 lifesteal - 1 enemy hit
    expect(r.events).toContainEqual({ kind: 'lifesteal', amount: 1 });
  });

  // Off-equivalence of the CAST PATH: casting a twist-free generic skill (strike) produces
  // the pre-M3 event shape and the cast layer adds NO draw. Independent derivation: enemy
  // to-hit face 15 (16 >= AC 13 -> hit) then skill-pick 0.5 -> pyroBall dmg 2; strike
  // Physical base 2 applies bleed; player 20-2=18, enemy 30-2=28, charge 5->4.
  it('casting a twist-free skill draws only the enemy to-hit + skill-pick and keeps the pre-M3 events', () => {
    const state = createBattle(
      makePlayer({ hp: 20, skillPool: ['strike'], skillCharges: 5 }),
      makeEnemy({ hp: 30 }),
      1,
    );
    // Exactly the enemy to-hit + skill-pick draws: if the cast path drew more, it would throw.
    const r = resolveRound(state, { kind: 'cast', skillId: 'strike' }, scriptedRng([face(15, 20), 0.5]));
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(28);
    expect(r.state.player.skillCharges).toBe(4);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      { kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2 },
      { kind: 'skill-cast', subject: 'player', skillId: 'strike', name: 'Strike' },
      { kind: 'condition-applied', subject: 'enemy', conditionType: 'bleed' },
    ]);
  });
});

describe('BattleState JSON round-trip', () => {
  it('state survives JSON.parse(JSON.stringify(x)) unchanged after a round', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)]));
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
  });

  it('a Player carrying a shield in the off-hand slot round-trips through JSON', () => {
    const base = makePlayer();
    const withShield = {
      ...base,
      inventory: {
        ...base.inventory,
        slots: { ...base.inventory.slots, offHand: { defId: 'Buckler' } },
      },
    };
    const state = createBattle(withShield, makeEnemy({ hp: 30 }), 1);
    const revived = JSON.parse(JSON.stringify(state));
    expect(revived).toEqual(state);
    expect(revived.player.inventory.slots.offHand).toEqual({ defId: 'Buckler' });
  });
});
