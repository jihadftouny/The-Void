import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ROUND_RULES,
  MOMENTUM_CARRY,
  applyDamageToBattlePlayer,
  createBattle,
  openBattle,
  resetTransientCombatState,
  resolveRound,
  rollFlee,
  spareAvailable,
  type BattleState,
  type RoundResult,
  type RoundRules,
} from './battle.ts';
import { MOMENTUM_CAP } from './classKit.ts';
import { type BossState } from './boss.ts';
import { createPlayer, type Player } from './player.ts';
import { type Enemy } from './enemy.ts';
import { makeCondition } from './condition.ts';
import { type CombatEvent } from './combatEvent.ts';
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

/** A scripted rng that also COUNTS its draws, so a test can assert exactly how many were taken. */
function countedRng(values: number[]): Rng & { used: () => number } {
  let i = 0;
  const rng = (() => {
    if (i >= values.length) throw new Error(`countedRng exhausted after ${i} draw(s)`);
    return values[i++]!;
  }) as Rng & { used: () => number };
  rng.used = () => i;
  return rng;
}

// PLAN.md #1.6 — THE ROUND IS SEQUENTIAL. Every draw order below is the new one, derived by hand:
//   [player tick] → [player action: Fight d20 (+ damage die on a hit); Run the flee draw; Cast
//   and Item nothing] → [enemy tick] → [per enemy action: d20, then the skill-pick on a hit]
//   → [on victory: the loot gate].
// The TEMPO GAUGE draws nothing. The player fixture has DEX 12 (mod +1), so its gauge moves +1
// a round and every round opens with `tempo-changed player 1` (from 0); the enemy fixture has
// DEX 10 (mod 0) and no data family, so its gauge never moves and emits nothing. Each round
// that moves HP carries the engine's `hp-changed` right after the blow.

// Enforcer with STR 18 -> STR mod 4 (floor((18-10)/2) = 4) and PROFICIENCY 2 (the real
// `createPlayer` value), so its to-hit modifier is 4 + 2 = 6 (G32). Equipped Jaaj Sword 1
// (Melee, 1d6). hp/maxHp forced to 20 for clean arithmetic; rests 1, pots 2 (M7: no gold).
/** A player whose backpack is EMPTY — a fresh character now carries §22.6's starting kit. */
function emptyPack<P extends { inventory: { backpack: unknown[] } }>(p: P): P {
  return { ...p, inventory: { ...p.inventory, backpack: [] } };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  const base = createPlayer({
    name: 'Hero',
    classId: 'Enforcer',
    stats: { STR: 18, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
  });
  // An EMPTY backpack unless a test says otherwise (PLAN.md #2 seeds §22.6's starting kit into
  // every fresh character; these fixtures predate it — player.test.ts owns the kit).
  return { ...base, hp: 20, maxHp: 20, inventory: { ...base.inventory, backpack: [] }, ...overrides };
}

// A fixed enemy: skillPool [pyroBall], 2 charges, 0 resistances, AC 10, xp as given.
// PLAN.md #1.6: DEX 10 (was 13), so its tempo gauge stays at 0 and these tests are about the
// round, not the gauge. DEX feeds nothing else an enemy does here (its AC is the fixed 10).
function makeEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    name: 'Beast',
    type: 'Beast',
    fullName: 'Feral Rat',
    stats: { STR: 13, DEX: 10, CON: 13, INT: 13, WIS: 13, CHA: 13 },
    mods: { STR: 1, DEX: 0, CON: 1, INT: 1, WIS: 1, CHA: 1 },
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
    familyId: 'Beast',
    karmaWeighted: false,
    ...overrides,
  };
}

describe('spare / release (M8)', () => {
  const noDrawRng = () => {
    throw new Error('spare must consume no rng draw');
  };

  it('sparing a ⚖ enemy ends the encounter as spared, enemy untouched, zero draws', () => {
    const enemy = makeEnemy({ hp: 30, karmaWeighted: true, fullName: 'Wailing Grief' });
    const state = createBattle(makePlayer(), enemy, 1);
    const r = resolveRound(state, 'spare', noDrawRng);
    expect(r.status).toBe('spared');
    expect(r.events).toEqual([{ kind: 'spared', enemyName: 'Wailing Grief' }]);
    // The enemy is NOT killed: hp unchanged, still alive.
    expect(r.state.enemy.hp).toBe(30);
  });

  it('sparing a non-⚖ enemy is an unavailable no-op: ongoing, zero draws', () => {
    const enemy = makeEnemy({ hp: 30, karmaWeighted: false });
    const state = createBattle(makePlayer(), enemy, 1);
    const r = resolveRound(state, 'spare', noDrawRng);
    expect(r.status).toBe('ongoing');
    expect(r.events).toEqual([{ kind: 'spare-unavailable' }]);
    expect(r.state).toBe(state); // no-op returns the input state
  });

  it('spareAvailable gates on ⚖ and a living enemy', () => {
    expect(spareAvailable(createBattle(makePlayer(), makeEnemy({ karmaWeighted: true, hp: 5 }), 1))).toBe(true);
    expect(spareAvailable(createBattle(makePlayer(), makeEnemy({ karmaWeighted: false, hp: 5 }), 1))).toBe(false);
    // A ⚖ enemy at 0 hp is dead, not spareable.
    expect(spareAvailable(createBattle(makePlayer(), makeEnemy({ karmaWeighted: true, hp: 0 }), 1))).toBe(false);
  });
});

describe('rollFlee — literal Java threshold rng()*10+1 <= 3.5', () => {
  it('escapes below the boundary and fails above it (independent of the constant)', () => {
    expect(rollFlee(scriptedRng([0.1]))).toBe(true); // 2.0 <= 3.5
    expect(rollFlee(scriptedRng([0.9]))).toBe(false); // 10.0 > 3.5
    expect(rollFlee(scriptedRng([0.25]))).toBe(true); // 3.5 <= 3.5 (boundary)
    expect(rollFlee(scriptedRng([0.2500001]))).toBe(false); // just past 3.5
  });
});

describe('resolveRound Fight — exact HP deltas + exact event list (AC-1: you strike first)', () => {
  // Player AC = 13 (Enforcer, Jooj Armor 1 baseArmor 11, CON 12/+1, DEX 12/+1:
  // 11 + 1 + min(1,2)). Enemy STR 13 -> +1 to hit. Draw order [playerD20, playerDamage,
  // enemyToHit, skillPick]:
  //  1) player tick: no conditions, no draw. Gauge 0 + 1 = 1 (DEX 12) -> `tempo-changed`.
  //  2) player d20 face 15 + STR mod 4 + proficiency 2 = 21 >= enemy AC 10 -> hit; damage
  //     1d6 face 4 -> 4. Enemy 30 - 4 = 26 -> `hp-changed enemy 26/30`.
  //  3) enemy tick: no conditions, no draw; gauge rate 0 (DEX 10) -> no event.
  //  4) enemy to-hit d20 face 15 + 1 = 16 >= AC 13 -> hit; skill-pick 0.5 -> Pyro Ball (the
  //     only pool entry), res 0 -> damage 2, charge 2 -> 1. Player 20 - 2 = 18.
  //  Results: player.hp 18 ; enemy.hp 26 ; ongoing ; exactly 4 draws.
  it('produces the hand-derived HP and event stream and leaves the input unmutated', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 30 }), 1);
    const snapshot = JSON.parse(JSON.stringify(state));

    const rng = countedRng([face(15, 20), face(4, 6), face(15, 20), 0.5]);
    const r = resolveRound(state, 'fight', rng);

    expect(rng.used()).toBe(4);
    expect(r.status).toBe('ongoing');
    expect(r.roundComplete).toBe(true);
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(26);
    expect(r.state.enemy.skillCharges).toBe(1);
    expect(r.state.tempo).toEqual({ player: 1, enemy: 0 });
    expect(r.events).toEqual([
      { kind: 'tempo-changed', subject: 'player', tenths: 1 },
      {
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 4,
        // natural 15 + 6 (STR mod 4 + proficiency 2, G32) = 21 >= enemy AC 10.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 6, total: 21, targetAc: 10 },
        damageSources: [{ kind: 'weapon-dice', amount: 4, label: '1d6' }],
      },
      { kind: 'hp-changed', subject: 'enemy', hp: 26, maxHp: 30 },
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      { kind: 'hp-changed', subject: 'player', hp: 18, maxHp: 20 },
    ]);

    // Input state deep-equals its pre-call snapshot (pure, returns a NEW state).
    expect(state).toEqual(snapshot);
    expect(r.state).not.toBe(state);
  });
});

describe('resolveRound Fight — victory rewards (AC-2: a killing blow ends the round)', () => {
  // enemy.xp 3, hp 4. The player strikes FIRST: d20 face 15 -> 21 >= AC 10 -> hit; 1d6 face 4
  // -> 4; enemy 4 - 4 = 0 -> victory, BEFORE the enemy's turn. Reward draws (M7: gold -> loot):
  //  loot gate: rng() < act-1 dropChance(0.5) -> 0.99 >= 0.5 -> no drop (one draw), loot [].
  // So exactly three draws — player d20, damage, loot gate — and NO enemy to-hit draw.
  it('grants xp = enemy.xp, the enemy never strikes back, and draws only d20 + damage + loot gate', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 4, xp: 3 }), 1);
    const rng = countedRng([face(15, 20), face(4, 6), 0.99]);
    const r = resolveRound(state, 'fight', rng);

    expect(rng.used()).toBe(3);
    expect(r.status).toBe('player-won');
    expect(r.state.enemy.hp).toBe(0);
    expect(r.state.player.hp).toBe(20); // untouched: the enemy never acted
    expect(r.state.player.xp).toBe(3); // 0 + enemy.xp
    expect('restsLeft' in r.state.player).toBe(false); // there is no rest counter to feed
    expect(r.state.player.inventory.backpack).toEqual([]); // failed drop gate adds nothing
    expect(r.events.map((e) => e.kind)).toEqual(['tempo-changed', 'attack', 'hp-changed', 'victory']);
    expect(r.events).toContainEqual({ kind: 'hp-changed', subject: 'enemy', hp: 0, maxHp: 30 });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'enemy')).toBe(false);
    expect(r.events.at(-1)).toEqual({ kind: 'victory', xpGained: 3, loot: [] });
  });

  it('a dead enemy takes no turn at all — not even its condition tick', () => {
    // The same kill, on an enemy carrying an ACTIVE burn (past onset). Were its turn to open,
    // the burn would tick (a condition-damage) and roll its save — a d20 draw the script does
    // not hold. Exactly three draws: player d20, damage, loot gate.
    const burning = makeEnemy({ hp: 4, xp: 3, activeConditions: [{ type: 'burn', remainingTurns: 1, maxTurns: 2, onsetDone: true }] });
    const rng = countedRng([face(15, 20), face(4, 6), 0.99]);
    const r = resolveRound(createBattle(makePlayer(), burning, 1), 'fight', rng);
    expect(r.status).toBe('player-won');
    expect(rng.used()).toBe(3);
    expect(r.events.some((e) => e.kind === 'condition-damage')).toBe(false);
  });
});

describe('resolveRound Fight — defeat', () => {
  it('player at 1 HP taking 2 enemy damage dies with a defeat event', () => {
    // The player strikes first (face 15 -> hit, 1d6 face 4: enemy 30 -> 26), then the enemy's
    // to-hit face 15 -> 16 >= 13 -> hit, Pyro Ball 2: 1 - 2 -> 0, and no revive is worn.
    const state = createBattle(makePlayer({ hp: 1 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 6), face(15, 20), 0.5]));
    expect(r.status).toBe('player-died');
    expect(r.state.player.hp).toBe(0);
    expect(r.state.enemy.hp).toBe(26); // the player's blow landed first
    expect(r.events.at(-1)).toEqual({ kind: 'defeat' });
  });
});

describe('resolveRound Fight — turn-skip condition blocks the player', () => {
  // Player is stunned (onset: skip, no draw). Its gauge still drifts (+1) but it cannot act, so
  // the player's turn takes no draw; the enemy's turn rolls to hit (face 15 -> 16 >= AC 13 ->
  // hit) and picks Pyro Ball for 2. Draws [enemyToHit, skillPick].
  it('a stunned player deals 0 and emits player-unable-to-act', () => {
    const state = createBattle(makePlayer({ activeConditions: [makeCondition('stun')] }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5]));

    expect(r.state.enemy.hp).toBe(30); // enemy took 0 from the player
    expect(r.state.player.hp).toBe(18); // 20 - 2 enemy damage
    expect(r.events).toContainEqual({ kind: 'player-unable-to-act', conditionType: 'stun' });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'player')).toBe(false);
  });
});

// PLAN.md #2 / GAME-DESIGN §22.6: the `potion` action and its three events are GONE — potions
// folded into consumables. The four tests that stood here (heal to cap, unavailable at full HP
// and at 0 pots, blocked under control) went with the action; the heal-to-EFFECTIVE-cap rule
// they also pinned is kept below, through the consumable that replaced the potion.
describe('resolveRound Run', () => {
  it('escapes below the flee threshold (status fled), no damage', () => {
    // Run is a turn: the player's tick (nothing) and gauge (+1) come first, then the flee draw.
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy(), 1);
    const r = resolveRound(state, 'run', scriptedRng([0.1]));
    expect(r.status).toBe('fled');
    expect(r.events).toEqual([{ kind: 'tempo-changed', subject: 'player', tenths: 1 }, { kind: 'fled' }]);
    expect(r.state.player.hp).toBe(20);
  });

  it("fails above the threshold: the enemy's ordinary turn follows, status ongoing (AC-4)", () => {
    // Flee 0.9 fails -> `escape-failed` (no damage on it) -> the enemy's turn: to-hit face 15
    // -> 16 >= AC 13 -> hit, skill-pick 0.5 -> Pyro Ball 2. Draws [flee, enemyToHit, skillPick].
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'run', scriptedRng([0.9, face(15, 20), 0.5]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18); // 20 - 2
    expect(r.events.map((e) => e.kind)).toEqual([
      'tempo-changed', 'escape-failed', 'enemy-skill-used', 'attack', 'hp-changed',
    ]);
    // PLAN.md #1.6: `escape-failed` carries no damage; the enemy's own attack reports it.
    expect(r.events).toContainEqual({ kind: 'escape-failed' });
  });

  it("a controlled player cannot run: player-unable-to-act, then the enemy's turn (AC-4)", () => {
    // Stun onset: skip, no draw — so no flee draw either. Then the enemy: face 15 hit, Pyro Ball 2.
    const state = createBattle(makePlayer({ hp: 20, activeConditions: [makeCondition('stun')] }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'run', scriptedRng([face(15, 20), 0.5]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18);
    expect(r.events).toContainEqual({ kind: 'player-unable-to-act', conditionType: 'stun' });
    expect(r.events.some((e) => e.kind === 'fled' || e.kind === 'escape-failed')).toBe(false);
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
  // Player casts Ember (Pyro base 2, cost 1, applies burn) at a 0-resist enemy. Draw order:
  // player tick (0) -> cast (NO draw): enemy 30 - 2 = 28, burn applied -> ENEMY TICK: the burn
  // it was just given has its onset now (an onset deals nothing and rolls no save) -> enemy
  // to-hit face 15 (16 >= AC 13 -> hit) -> skill-pick 0.5 -> Pyro Ball 2, charge 2 -> 1.
  // Results: player 20 - 2 = 18, enemy 28. The burn is past its onset: remaining 2 - 1 = 1.
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
    expect(r.state.enemy.activeConditions).toEqual([{ ...makeCondition('burn'), remainingTurns: 1, onsetDone: true }]);
    expect(r.events).toEqual([
      { kind: 'tempo-changed', subject: 'player', tenths: 1 },
      {
        kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember', damage: 2,
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      { kind: 'condition-applied', subject: 'enemy', conditionType: 'burn' },
      { kind: 'hp-changed', subject: 'enemy', hp: 28, maxHp: 30 },
      { kind: 'condition-onset', subject: 'enemy', conditionType: 'burn' },
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      { kind: 'hp-changed', subject: 'player', hp: 18, maxHp: 20 },
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
  // Player-inflicted DoT on the enemy ticks at the start of ITS turn. Enemy carries poison at its
  // effect phase (remaining 1) with hp 1 and xp 3. The player acts first and MISSES (d20 face 2
  // + 6 = 8 < AC 10; a miss draws no damage die), so the enemy is still standing when its turn
  // opens — and dies to its OWN poison tick (1 -> 0, no save, no draw) before it can act: still
  // player-won. Then the victory block draws the loot gate (0.99 >= 0.5 -> no drop).
  it('an enemy killed by its own DoT tick (before acting) yields player-won + rewards', () => {
    const state = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 1, xp: 3, activeConditions: [{ type: 'poison', remainingTurns: 1, maxTurns: 2 }] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(2, 20), 0.99]));

    expect(r.status).toBe('player-won');
    expect(r.state.enemy.hp).toBe(0);
    expect(r.state.player.hp).toBe(20); // enemy never got to attack
    expect(r.state.player.xp).toBe(3); // 0 + enemy.xp
    expect(r.events).toEqual([
      { kind: 'tempo-changed', subject: 'player', tenths: 1 },
      {
        kind: 'attack', subject: 'player', outcome: 'miss', damage: 0,
        roll: { natural: 2, faces: [2], advDis: 0, modifier: 6, total: 8, targetAc: 10 },
        damageSources: [],
      },
      { kind: 'condition-damage', subject: 'enemy', conditionType: 'poison', amount: 1 },
      { kind: 'hp-changed', subject: 'enemy', hp: 0, maxHp: 30 },
      { kind: 'victory', xpGained: 3, loot: [] },
    ]);
  });

  // A control condition on the enemy makes it skip its attack. Enemy carries a fresh freeze
  // (onset): the player acts first (d20 face 15 -> hit, 1d6 face 4), then the enemy's tick sets
  // the skip flag (no save on onset, 0 draws) and the enemy deals no damage.
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

describe('a full heal caps at effectiveMaxHp (Frail) — via the Void Draught that replaced the potion', () => {
  // A Frail (sick) player heals to the REDUCED effective max HP, not the stored maxHp.
  // stored maxHp 20; sick lowers CON by 2 (mod delta -1) -> effectiveMaxHp 19. The Void
  // Draught heals 100% of that cap (consumables.json), so hp 10 -> min(10 + 19, 19) = 19.
  // PLAN.md #1.6: an item is a turn, so the enemy answers it — scripted to MISS (face 5 + 1 = 6,
  // under any AC this player can have) so the heal is isolated. Draws [enemyToHit].
  it('a Frail player below full heals to effectiveMaxHp (19), not stored maxHp (20)', () => {
    const base = makePlayer({ hp: 10, maxHp: 20, activeConditions: [makeCondition('sick')] });
    const player = { ...base, inventory: { ...base.inventory, backpack: [{ defId: 'void-draught' }] } };
    const state = createBattle(player, makeEnemy(), 1);
    const r = resolveRound(state, { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([face(5, 20)]));
    expect(r.state.player.hp).toBe(19);
    expect(r.state.player.inventory.backpack).toEqual([]); // spent
    expect(r.events).toContainEqual({ kind: 'consumable-used', itemId: 'void-draught' });
    expect(r.events).toContainEqual({ kind: 'hp-changed', subject: 'player', hp: 19, maxHp: 20 });
  });
});

describe('resolveRound Fight — conditionless round, exact draw order (M4)', () => {
  // A conditionless round draws exactly four. Independent hand-derivation (enemy hp 10, player
  // AC 13, enemy +1 to hit):
  //   player tick: 0 draws. player d20 face 12 + STR mod 4 + proficiency 2 = 18 >= enemy AC 10
  //   -> hit; dmg 1d6 face 5 -> 5; enemy 10 - 5 = 5. enemy tick: 0 draws. enemy to-hit face 15
  //   + 1 = 16 >= AC 13 -> hit; skill-pick 0.5 -> Pyro Ball dmg 2, charge 2 -> 1. player
  //   20 - 2 = 18, ongoing. (The fixture's maxHp stays 30; only `hp` was overridden.)
  it('produces the hand-derived state + event list and consumes exactly 4 draws', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 10 }), 1);
    const rng = countedRng([face(12, 20), face(5, 6), face(15, 20), 0.5]);
    const r = resolveRound(state, 'fight', rng);
    expect(rng.used()).toBe(4);
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(5);
    expect(r.state.enemy.skillCharges).toBe(1);
    expect(r.events).toEqual([
      { kind: 'tempo-changed', subject: 'player', tenths: 1 },
      {
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 5,
        roll: { natural: 12, faces: [12], advDis: 0, modifier: 6, total: 18, targetAc: 10 }, // G32: 4 + 2
        damageSources: [{ kind: 'weapon-dice', amount: 5, label: '1d6' }],
      },
      { kind: 'hp-changed', subject: 'enemy', hp: 5, maxHp: 30 },
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      { kind: 'hp-changed', subject: 'player', hp: 18, maxHp: 20 },
    ]);
  });
});

describe('resolveRound Fight — enemy misses (M4 defense matters)', () => {
  // The enemy rolls a LOW natural: face 5 + 1 = 6 < AC 13 -> MISS. It deals 0, draws no
  // skill-pick, and applies no condition. Draws [playerD20, playerDamage, enemyToHit] (only
  // three — a skill-pick on a miss would exhaust the rng):
  //   player d20 face 15 + STR 4 + proficiency 2 = 21 >= enemy AC 10 -> hit; dmg 1d6 face
  //   4 -> 4. player 20 - 0 = 20, enemy 30 - 4 = 26, ongoing.
  it('a whiffed enemy attack deals 0 and emits attack/miss with no enemy-skill-used', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 6), face(5, 20)]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(20); // took 0
    expect(r.state.enemy.hp).toBe(26); // 30 - 4
    expect(r.state.enemy.skillCharges).toBe(2); // no charge spent on a miss
    expect(r.events).toEqual([
      { kind: 'tempo-changed', subject: 'player', tenths: 1 },
      {
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 4,
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 6, total: 21, targetAc: 10 }, // G32: 4 + 2
        damageSources: [{ kind: 'weapon-dice', amount: 4, label: '1d6' }],
      },
      { kind: 'hp-changed', subject: 'enemy', hp: 26, maxHp: 30 },
      {
        kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0,
        // natural 5 + 1 = 6 < player AC 13.
        roll: { natural: 5, faces: [5], advDis: 0, modifier: 1, total: 6, targetAc: 13 },
        damageSources: [],
      },
    ]);
    expect(r.events.some((e) => e.kind === 'enemy-skill-used')).toBe(false);
  });
});

describe('resolveRound — M3 class twists in a full round', () => {
  // Momentum-on-damage hooks: an Enforcer who BOTH deals and takes damage in a round gains
  // +1 (dealt, on its own turn) +1 (taken, on the enemy's) = 2 momentum. Draw order
  // [playerD20, playerDamage, enemyToHit, skillPick]: player d20 15 + 6 = 21 hit, 1d6(4) dealt
  // (enemy takes 4 -> +1); enemy face 15 -> hit, pyroBall dmg 2 (player takes 2 -> +1).
  it('an Enforcer gains +2 momentum in a round where it hits and is hit', () => {
    const state = createBattle(makePlayer({ hp: 20, momentum: 0 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 6), face(15, 20), 0.5]));
    expect(r.state.player.hp).toBe(18); // 20 - 2
    expect(r.state.enemy.hp).toBe(26); // 30 - 4
    expect(r.state.player.momentum).toBe(2);
  });

  // Casting Heavy Strike (spendMomentum, momentumDamagePer 1) at momentum 4: base 3 + 4 = 7
  // enemy damage, momentum spent to 0 by the cast, then +1 for dealing 7 on the player's turn
  // and +1 for taking 2 on the enemy's = 2. charge 5 -> 3 (cost 2). Heavy Strike applies
  // FRACTURE — and the enemy's tick now comes AFTER the cast, so the fracture's onset bites this
  // very round: the enemy rolls at disadvantage, TWO d20s (faces 15 and 15 -> natural 15;
  // 15 + 1 = 16 >= AC 13 -> hit), then the skill-pick 0.5 -> Pyro Ball 2.
  // Draws: player tick 0 -> cast 0 -> enemy tick 0 -> d20, d20, skill-pick.
  it('Enforcer Heavy Strike spends momentum for burst, then the hooks re-bank +2', () => {
    // Momentum is set on the battle player AFTER `createBattle`, because the funnel now
    // DECAYS carried momentum at a battle boundary (G34/§22.19, covered by its own test
    // below). This test is about the SPEND mechanic mid-fight, so it pins momentum 4 in the
    // fight rather than smuggling it in from a previous one — the arithmetic is unchanged.
    const opened = createBattle(
      makePlayer({ hp: 20, skillCharges: 5, skillPool: ['heavyStrike'] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const state = { ...opened, player: { ...opened.player, momentum: 4 } };
    const r = resolveRound(state, { kind: 'cast', skillId: 'heavyStrike' }, scriptedRng([face(15, 20), face(15, 20), 0.5]));
    expect(r.state.enemy.hp).toBe(23); // 30 - 7
    expect(r.state.player.hp).toBe(18); // 20 - 2
    expect(r.state.player.skillCharges).toBe(3);
    expect(r.state.player.momentum).toBe(2); // spent to 0 by cast, +1 dealt +1 taken
    expect(r.state.enemy.activeConditions.some((c) => c.type === 'fracture')).toBe(true);
    expect(r.events).toContainEqual({ kind: 'resource-changed', subject: 'player', resource: 'momentum', value: 0 });
    expect(r.events).toContainEqual({ kind: 'disadvantage', subject: 'enemy' });
  });

  // Detonate through the round. A Neuromancer (no momentum hook) casts Synapse at an enemy
  // carrying insanity + sleep (both control, both fresh). Synapse base 1 + 2x2 detonate = 5, and
  // the two mental conditions are CONSUMED by the cast — which now resolves BEFORE the enemy's
  // turn, so by the time the enemy ticks it holds no control condition at all and ACTS. (Before
  // #1.6 it ticked first and skipped.) Enemy 0 charges: to-hit face 5 + 1 = 6 < AC 13 -> miss,
  // no skill-pick. Draws: [enemyToHit].
  it('a Neuromancer detonates the enemy mental conditions for bonus damage', () => {
    const state = createBattle(
      makePlayer({ hp: 20, maxHp: 20, classId: 'Neuromancer', skillPool: ['synapse'], skillCharges: 5 }),
      makeEnemy({ hp: 30, skillCharges: 0, activeConditions: [makeCondition('insanity'), makeCondition('sleep')] }),
      1,
    );
    const r = resolveRound(state, { kind: 'cast', skillId: 'synapse' }, scriptedRng([face(5, 20)]));
    expect(r.state.enemy.hp).toBe(25); // 30 - 5
    expect(r.state.player.hp).toBe(20); // the freed enemy swung and missed
    expect(r.state.player.skillCharges).toBe(3); // synapse costs 2
    expect(r.state.enemy.activeConditions.some((c) => c.type === 'insanity' || c.type === 'sleep')).toBe(false);
    expect(r.events).toContainEqual({ kind: 'detonate', consumed: 2, bonusDamage: 4 });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'enemy')).toBe(true);
  });

  // HP-as-fuel + lifesteal through the round. A Hollow (no momentum hook) casts Siphon, then the
  // enemy (0 charges) rolls to hit and lands the plain 1 (face 15 -> 16 >= AC 13 -> hit; one
  // to-hit draw even with 0 charges). Siphon deals 3 and lifesteals floor(3 x 0.5) = 1:
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

  // Off-equivalence of the CAST PATH: casting a twist-free generic skill (strike) adds NO draw.
  // Independent derivation: strike Physical base 2 applies bleed (enemy 30 -> 28); the enemy's
  // tick is bleed's ONSET (no damage, no draw); enemy to-hit face 15 (16 >= AC 13 -> hit) then
  // skill-pick 0.5 -> pyroBall dmg 2; player 20 - 2 = 18, charge 5 -> 4.
  it('casting a twist-free skill draws only the enemy to-hit + skill-pick', () => {
    const state = createBattle(
      makePlayer({ hp: 20, skillPool: ['strike'], skillCharges: 5 }),
      makeEnemy({ hp: 30 }),
      1,
    );
    // Exactly the enemy to-hit + skill-pick draws: if the cast path drew more, it would throw.
    const rng = countedRng([face(15, 20), 0.5]);
    const r = resolveRound(state, { kind: 'cast', skillId: 'strike' }, rng);
    expect(rng.used()).toBe(2);
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(28);
    expect(r.state.player.skillCharges).toBe(4);
    expect(r.events).toEqual([
      { kind: 'tempo-changed', subject: 'player', tenths: 1 },
      {
        kind: 'skill-cast', subject: 'player', skillId: 'strike', name: 'Strike', damage: 2,
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      { kind: 'condition-applied', subject: 'enemy', conditionType: 'bleed' },
      { kind: 'hp-changed', subject: 'enemy', hp: 28, maxHp: 30 },
      { kind: 'condition-onset', subject: 'enemy', conditionType: 'bleed' },
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      { kind: 'hp-changed', subject: 'player', hp: 18, maxHp: 20 },
    ]);
  });
});

// ------- G30 / G22(a) ------------------------------------------------------------------------

/** The enemy's `attack` event, narrowed so its roll detail can be read. */
function enemyAttackEvent(events: readonly CombatEvent[]): Extract<CombatEvent, { kind: 'attack' }> {
  const found = events.find((e) => e.kind === 'attack' && e.subject === 'enemy');
  if (!found || found.kind !== 'attack') throw new Error('no enemy attack event was emitted');
  return found;
}

describe('G30 — fracture inflicted on the ENEMY finally bites', () => {
  // Step 3 always read the player's `advDisOverride`; step 2 never read the enemy's, so the
  // enemy half of fracture — applied by `heavyStrike`, the Enforcer's CORE skill — had no
  // consumer: the register measured byte-identical attacks at seeds 3/9/21/44.
  //
  // Independently derived from the dice rules, not measured (PLAN.md #1.6 order: the player's
  // d20 + damage come FIRST — face 15 + STR mod 4 + proficiency 2 = 21 >= AC 10 -> hit, 1d6(4)):
  //   clean    — advDis 0  -> ONE d20. face 15 + enemy STR mod 1 = 16 >= player AC 13 -> hit,
  //              a skill-pick draw, Pyro Ball for 2. Player 20 - 2 = 18.
  //   fractured— advDis -1 -> TWO d20s, take the MIN. faces 15 and 3 -> natural 3; 3 + 1 = 4
  //              < AC 13 -> MISS, so 0 damage and NO skill-pick draw. Player stays at 20.
  it('rolls two dice at disadvantage where a clean enemy rolls one, and the log says so', () => {
    const clean = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const rClean = resolveRound(
      clean,
      'fight',
      scriptedRng([face(15, 20), face(4, 6), face(15, 20), 0.5]),
    );
    const cleanAttack = enemyAttackEvent(rClean.events);
    expect(cleanAttack.roll!.faces).toEqual([15]);
    expect(cleanAttack.roll!.advDis).toBe(0);
    expect(cleanAttack.outcome).toBe('hit');
    expect(rClean.state.player.hp).toBe(18);

    const fractured = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 30, activeConditions: [makeCondition('fracture')] }),
      1,
    );
    const rFrac = resolveRound(
      fractured,
      'fight',
      // Exactly four draws: the player's two, then two for the disadvantaged enemy roll.
      // A fifth (the skill-pick) would exhaust the script, proving the miss short-circuits.
      scriptedRng([face(15, 20), face(4, 6), face(15, 20), face(3, 20)]),
    );
    const fracAttack = enemyAttackEvent(rFrac.events);
    expect(fracAttack.roll!.faces).toEqual([15, 3]);
    expect(fracAttack.roll!.advDis).toBe(-1);
    expect(fracAttack.roll!.natural).toBe(3); // disadvantage takes the LOWER face
    expect(fracAttack.outcome).toBe('miss');
    expect(rFrac.state.player.hp).toBe(20); // the fractured enemy whiffed

    // The existing `disadvantage` event carries it into the log — no new event kind.
    expect(rFrac.events).toContainEqual({ kind: 'disadvantage', subject: 'enemy' });
    expect(rClean.events.some((e) => e.kind === 'disadvantage')).toBe(false);
  });

  it('a Scavver-imposed disadvantage and an enemy fracture CANCEL to a straight roll', () => {
    // The 5e cancellation rule, applied to the enemy half. A Scavver forces the enemy to
    // disadvantage (-1); an enemy fracture is another -1 — but adv/dis is a state, not a
    // stack, so two of the same still mean ONE disadvantage (two dice, take the lower).
    // Against a Scavver whose fracture instead granted the enemy advantage, the faces would
    // still be two but `advDis` would read +1 — so this pins the direction, not just the count.
    // Draws: the Scavver's d20 face 15 (hit) + its 1d8 face 4, then the enemy's two d20s.
    const state = createBattle(
      makePlayer({ hp: 20, classId: 'Scavver' }),
      makeEnemy({ hp: 30, activeConditions: [makeCondition('fracture')] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 8), face(15, 20), face(3, 20)]));
    const attack = enemyAttackEvent(r.events);
    expect(attack.roll!.advDis).toBe(-1);
    expect(attack.roll!.faces).toEqual([15, 3]);
  });
});

describe('G22(a) — a healing condition tick can never exceed effective max HP', () => {
  // The enemy rolls face 5 + STR mod 1 = 6 < player AC 13 -> MISS (0 damage, no skill-pick
  // draw), so the heal is isolated from the exchange. Regeneration's ONSET tick heals +2.
  it('a player at full HP with regeneration stays at maxHp instead of overhealing to 22', () => {
    // Draws: player d20 face 15 -> hit, 1d6 face 4; enemy face 5 -> miss.
    const state = createBattle(
      makePlayer({ hp: 20, maxHp: 20, activeConditions: [makeCondition('regeneration')] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 6), face(5, 20)]));
    expect(r.state.player.hp).toBe(20); // pre-fix: 20 + 2 = 22
    expect(r.events).toContainEqual({
      kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2,
    });
  });

  it('the ENEMY side has the same cap (the mirror hole, closed in the same edit)', () => {
    // The enemy's tick is at the start of ITS turn, after the player's action — so the player
    // MISSES here (d20 face 2 + 6 = 8 < AC 10, no damage die) to leave the enemy at its full 30
    // when the +2 lands: capped at 30. Pre-fix: 32. Then the enemy misses (face 5).
    const state = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 30, maxHp: 30, activeConditions: [makeCondition('regeneration')] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(2, 20), face(5, 20)]));
    expect(r.state.enemy.hp).toBe(30);
    expect(r.events).toContainEqual({
      kind: 'condition-heal', subject: 'enemy', conditionType: 'regeneration', amount: 2,
    });
  });

  it('a HEALING tick below the cap still heals in full (the clamp is not a cap-to-current)', () => {
    const state = createBattle(
      makePlayer({ hp: 10, maxHp: 20, activeConditions: [makeCondition('regeneration')] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 6), face(5, 20)]));
    expect(r.state.player.hp).toBe(12); // 10 + 2, well under the cap
  });
});

// ------- G4 / G12 / G25 / G34 — createBattle as the transient funnel ------------------------

/** The player's `attack` event, narrowed so its roll detail can be read. */
function playerAttackEvent(events: readonly CombatEvent[]): Extract<CombatEvent, { kind: 'attack' }> {
  const found = events.find((e) => e.kind === 'attack' && e.subject === 'player');
  if (!found || found.kind !== 'attack') throw new Error('no player attack event was emitted');
  return found;
}

describe('G25 — a transient shield does not accumulate across battles', () => {
  it('opens at 5 in five consecutive battles, not 5, 10, 15, 20, 25', () => {
    // The register's measurement, replayed: Grace-Forged Aegis grants a 5-point shield at
    // battle start, `game.ts` writes the battle player back to the hub, and `openBattle`
    // re-fires the trigger against the carried-forward player. Nothing ever cleared it, so
    // by mid-descent the player was immune to chip damage — and it survived the save file.
    const base = makePlayer();
    let player: Player = {
      ...base,
      inventory: {
        ...base.inventory,
        slots: { ...base.inventory.slots, amulet: { defId: 'grace-forged-aegis' } },
      },
    };
    const opens: number[] = [];
    for (let i = 0; i < 5; i++) {
      const opened = openBattle(createBattle(player, makeEnemy(), 1));
      opens.push(opened.battle.player.shield ?? 0);
      // Thread the player forward exactly as game.ts does on any battle outcome.
      player = opened.battle.player;
    }
    expect(opens).toEqual([5, 5, 5, 5, 5]);
  });
});

describe('G34 — momentum CARRIES between battles, with decay (author ruling, §22.19)', () => {
  it('halves and floors at the boundary, capped', () => {
    // The rule, stated as arithmetic rather than measured: floor(m * 0.5).
    expect(MOMENTUM_CARRY).toBe(0.5);
    const carry = (m: number) =>
      resetTransientCombatState(makePlayer({ momentum: m })).momentum;
    expect(carry(0)).toBe(0);
    expect(carry(1)).toBe(0); // floor(0.5)
    expect(carry(2)).toBe(1);
    expect(carry(3)).toBe(1); // floor(1.5)
    expect(carry(4)).toBe(2);
    expect(carry(5)).toBe(2); // floor(2.5) — the cap halves to 2
    // A hand-edited/legacy value above the cap is still clamped into range.
    expect(carry(MOMENTUM_CAP * 4)).toBeLessThanOrEqual(MOMENTUM_CAP);
  });

  it('a seeded two-battle run banks the cap, then opens the next fight on exactly 2', () => {
    // Battle 1, three rounds, every draw scripted. An Enforcer banks +1 for dealing damage
    // and +1 for taking it, capped at MOMENTUM_CAP = 5.
    //   r1 (PLAN.md #1.6: the player first): d20 face 15 + STR 4 + prof 2 = 21 >= AC 10 -> hit,
    //       1d6(4). Then the enemy's to-hit face 15 + STR 1 = 16 >= AC 13 -> hit; skill-pick 0.5
    //       -> Pyro Ball 2 (charge 2->1). Dealt AND took -> momentum 0 + 2 = 2.
    //   r2: identical -> momentum 4 (enemy charge 1->0).
    //   r3: the enemy is out of charges, so it deals the plain 1 and draws NO skill-pick.
    //       Dealt AND took -> 4 + 2 = 6, clamped to the cap 5.
    let battle = createBattle(
      makePlayer({ hp: 20, skillPool: ['heavyStrike'], skillCharges: 5 }),
      makeEnemy({ hp: 30 }),
      1,
    );
    expect(battle.player.momentum).toBe(0);

    battle = resolveRound(battle, 'fight', scriptedRng([face(15, 20), face(4, 6), face(15, 20), 0.5])).state;
    expect(battle.player.momentum).toBe(2);
    battle = resolveRound(battle, 'fight', scriptedRng([face(15, 20), face(4, 6), face(15, 20), 0.5])).state;
    expect(battle.player.momentum).toBe(4);
    battle = resolveRound(battle, 'fight', scriptedRng([face(15, 20), face(4, 6), face(15, 20)])).state;
    expect(battle.player.momentum).toBe(MOMENTUM_CAP); // 6 clamped to 5

    // Battle 2 opens on floor(5 * 0.5) = 2 — not 5 (an uncapped carry) and not 0 (a reset).
    const next = createBattle(battle.player, makeEnemy({ hp: 30 }), 1);
    expect(next.player.momentum).toBe(2);

    // And the consequence in damage: Heavy Strike is base 3 + 1 per momentum spent, so the
    // opening cast deals 3 + 2 = 5. A full reset would deal 3; an unchecked carry, 8.
    // The cast's fracture has its onset on the enemy's tick this round -> the enemy rolls at
    // disadvantage: two d20s (15, 15) -> hit, then the skill-pick.
    const r = resolveRound(next, { kind: 'cast', skillId: 'heavyStrike' }, scriptedRng([face(15, 20), face(15, 20), 0.5]));
    expect(r.state.enemy.hp).toBe(25); // 30 - 5
  });
});

describe('G12 — advantage is per-round battle state, never a latch on the player', () => {
  it('a fractured player rolls at -1 that round and straight the round after it expires', () => {
    // fracture is hand-built past its onset with one turn left, so the next two ticks are its
    // active tick and its expiry — exactly the two rounds this test needs.
    //   round A: active -> advDis -1 -> TWO d20s, take the MIN. faces 15 and 3 -> natural 3;
    //            3 + STR mod 4 + proficiency 2 = 9 < enemy AC 10 -> MISS, so no damage draw.
    //   round B: expired -> advDis 0 -> ONE d20. face 15 + 4 + 2 = 21 >= 10 -> hit, 1d6(4).
    // The enemy misses in both (face 5 + STR mod 1 = 6 < player AC 13), which also proves no
    // skill-pick draw is taken. PLAN.md #1.6: the player's draws come first in each round.
    const start = createBattle(
      makePlayer({
        hp: 20,
        activeConditions: [{ type: 'fracture', remainingTurns: 1, maxTurns: 100, onsetDone: true }],
      }),
      makeEnemy({ hp: 30 }),
      1,
    );

    const a = resolveRound(start, 'fight', scriptedRng([face(15, 20), face(3, 20), face(5, 20)]));
    const attackA = playerAttackEvent(a.events);
    expect(attackA.roll!.advDis).toBe(-1);
    expect(attackA.roll!.faces).toEqual([15, 3]);
    expect(attackA.outcome).toBe('miss');
    // THE POINT OF G12: nothing was latched onto the player, so nothing can ride to the hub.
    expect(a.state.player.advantageDisadvantage).toBe(0);
    expect(a.state.player.activeConditions.some((c) => c.type === 'fracture')).toBe(true);

    const b = resolveRound(a.state, 'fight', scriptedRng([face(15, 20), face(4, 6), face(5, 20)]));
    const attackB = playerAttackEvent(b.events);
    expect(attackB.roll!.advDis).toBe(0);
    expect(attackB.roll!.faces).toEqual([15]);
    expect(attackB.outcome).toBe('hit');
    expect(b.state.player.advantageDisadvantage).toBe(0);
    expect(b.state.player.activeConditions.some((c) => c.type === 'fracture')).toBe(false);
  });

  it("an encounter's +1 and a fracture's -1 CANCEL, so the round is rolled straight", () => {
    // The 5e rule the engine now follows (open question 4, default taken). Under "the
    // condition wins" or "advantage wins" this would roll TWO dice and the scripted stream
    // would land differently, so this pins the rule and not merely the arithmetic.
    const start = createBattle(
      makePlayer({
        hp: 20,
        activeConditions: [{ type: 'fracture', remainingTurns: 1, maxTurns: 100, onsetDone: true }],
      }),
      makeEnemy({ hp: 30 }),
      1,
      { openingAdvantage: 1 },
    );
    expect(start.playerAdvantage).toBe(1);
    const r = resolveRound(start, 'fight', scriptedRng([face(15, 20), face(4, 6), face(5, 20)]));
    const attack = playerAttackEvent(r.events);
    expect(attack.roll!.advDis).toBe(0);
    expect(attack.roll!.faces).toEqual([15]);
    expect(r.events.some((e) => e.kind === 'advantage' || e.kind === 'disadvantage')).toBe(false);
  });

  it('the standing advantage does not survive into the next battle', () => {
    const first = createBattle(makePlayer(), makeEnemy(), 1, { openingAdvantage: 1 });
    const second = createBattle(first.player, makeEnemy(), 2);
    expect(second.playerAdvantage).toBeUndefined();
    expect(second.player.advantageDisadvantage).toBe(0);
  });
});

describe('G4 — a boss battle can never be fled, derived rather than remembered', () => {
  it('createBattle sets canFlee false for a boss in every act, with no call-site help', () => {
    const bosses: BossState[] = [
      { bossId: 'kingpin', round: 0, minions: 0 },
      { bossId: 'reflection', round: 0, adapted: false, actionTally: {} },
      { bossId: 'sin', round: 0 },
      { bossId: 'hollow', round: 0 },
    ];
    for (const [i, boss] of bosses.entries()) {
      const act = [1, 2, 3, 5][i]!;
      const battle = createBattle(makePlayer(), makeEnemy(), act, { boss });
      expect(battle.canFlee, `${boss.bossId} must not be fleeable`).toBe(false);
      expect(battle.boss).toBe(boss);
    }
    // The two non-boss rules are unchanged: act 5 trash is unfleeable, acts 1-4 are not.
    expect(createBattle(makePlayer(), makeEnemy(), 5).canFlee).toBe(false);
    expect(createBattle(makePlayer(), makeEnemy(), 4).canFlee).toBe(true);
  });
});

// ------- G24 / G29 / G39 — ONE guarded damage path -------------------------------------------

/** An Enforcer wearing the Halo Fragment (once-per-battle revive on lethal damage). */
function haloPlayer(overrides: Partial<Player> = {}): Player {
  const base = makePlayer(overrides);
  return {
    ...base,
    inventory: {
      ...base.inventory,
      slots: { ...base.inventory.slots, amulet: { defId: 'halo-fragment' } },
    },
  };
}

/** Put `shield` on the battle's player (mid-battle state, after the transient funnel). */
function withShield(state: ReturnType<typeof createBattle>, shield: number) {
  return { ...state, player: { ...state.player, shield } };
}

describe('G24 — the blow after a failed escape runs every defensive guard', () => {
  // Draw order for a failed run: flee roll (0.9 > 0.25 -> fails), then the ENEMY'S TURN (PLAN.md
  // #1.6 — no special counter-attack any more): its to-hit d20 (face 15 + enemy STR mod 1 = 16
  // >= player AC 13 -> hit) and its skill-pick (0.5 -> the only pool entry, Pyro Ball, base 2
  // vs 0 resistance). The guards hold because that turn uses the one guarded damage path.
  const failedRun = [0.9, face(15, 20), 0.5];

  it('a shield absorbs the counter-attack, exactly as it does in an ordinary round', () => {
    const state = withShield(createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1), 20);
    const r = resolveRound(state, 'run', scriptedRng(failedRun));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(20); // pre-fix: 18, the shield was not consulted at all
    expect(r.state.player.shield).toBe(18); // 20 - 2 absorbed
    expect(r.events).toContainEqual({ kind: 'shield-absorbed', amount: 2 });
    // PLAN.md #1.6: `escape-failed` carries no damage; the absorb above is the whole account.
    expect(r.events).toContainEqual({ kind: 'escape-failed' });
  });

  it('the once-per-battle revive intercepts a lethal counter-attack', () => {
    // maxHp 20, Halo Fragment heals to 25% -> max(floor(20 * 25/100), 1) = 5.
    const state = createBattle(haloPlayer({ hp: 1, maxHp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'run', scriptedRng(failedRun));
    expect(r.status).toBe('ongoing'); // pre-fix: 'player-died' — the relic simply did not fire
    expect(r.state.player.hp).toBe(5);
    expect(r.state.reviveUsed).toBe(true);
    expect(r.events).toContainEqual({ kind: 'revive', healedTo: 5 });
  });

  it('FOUR-SITE PARITY: the same 2 damage produces the same player state on every path', () => {
    // The claim is "one pipeline", not "four lookalikes", so the sites are compared directly.
    const loadout = () => withShield(createBattle(haloPlayer({ hp: 20, maxHp: 20 }), makeEnemy({ hp: 30 }), 1), 20);

    // Site 1: the ordinary round (the player's own d20 face 1 — a fumble, no damage die, touching
    // nothing on the defensive side; then the enemy's to-hit face 15 -> hit, skill-pick -> Pyro
    // Ball 2).
    const ordinary = resolveRound(loadout(), 'fight', scriptedRng([face(1, 20), face(15, 20), 0.5]));
    // Site 2: the failed escape — now simply the enemy's ordinary turn after it.
    const counter = resolveRound(loadout(), 'run', scriptedRng(failedRun));
    // Site 3: the boss/minion path, driven through the exported helper with the same 2.
    const bossEvents: CombatEvent[] = [];
    const boss = applyDamageToBattlePlayer(loadout(), 2, bossEvents);

    for (const [name, player] of [
      ['ordinary round', ordinary.state.player],
      ['failed escape', counter.state.player],
      ['boss minions', boss.state.player],
    ] as const) {
      expect(player.hp, `${name}: hp`).toBe(20);
      expect(player.shield, `${name}: shield`).toBe(18);
    }
    for (const [name, events] of [
      ['ordinary round', ordinary.events],
      ['failed escape', counter.events],
      ['boss minions', bossEvents],
    ] as const) {
      expect(events, `${name}: shield-absorbed`).toContainEqual({ kind: 'shield-absorbed', amount: 2 });
    }
  });
});

describe('G29 — the boss damage path is the same guarded path', () => {
  it('shield 20 versus a 5-damage minion tick: hp unchanged, shield 15, absorb announced', () => {
    const state = withShield(createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1), 20);
    const events: CombatEvent[] = [];
    const r = applyDamageToBattlePlayer(state, 5, events);
    expect(r.died).toBe(false);
    expect(r.state.player.hp).toBe(20); // pre-fix: 15, written straight through
    expect(r.state.player.shield).toBe(15);
    expect(events).toEqual([{ kind: 'shield-absorbed', amount: 5 }]);
  });

  it('lethal minion damage is intercepted by the revive, once', () => {
    const state = createBattle(haloPlayer({ hp: 1, maxHp: 20 }), makeEnemy({ hp: 30 }), 1);
    const first: CombatEvent[] = [];
    const a = applyDamageToBattlePlayer(state, 5, first);
    expect(a.died).toBe(false);
    expect(a.state.player.hp).toBe(5); // floor(20 * 25/100)
    expect(first).toContainEqual({ kind: 'revive', healedTo: 5 });
    expect(a.state.reviveUsed).toBe(true);

    // Spent: the next lethal tick in the SAME battle kills.
    const second: CombatEvent[] = [];
    const b = applyDamageToBattlePlayer(a.state, 99, second);
    expect(b.died).toBe(true);
    expect(b.state.player.hp).toBe(0);
    expect(second.some((e) => e.kind === 'revive')).toBe(false);
  });
});

describe('G39 — a flee consumable cannot escape a battle that forbids fleeing', () => {
  it('is CONSUMED, emits escape-impossible, and leaves the battle ongoing', () => {
    // A boss battle sets `canFlee: false` (G4). `resolveUseConsumable` used to return
    // `status: 'fled'` without consulting it — measured: a Smoke Vial in the act-5 Hollow
    // fight dropped the player back at the act-5 hub with NO path to any ending.
    const base = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 30 }),
      5,
      { boss: { bossId: 'hollow', round: 0 } },
    );
    expect(base.canFlee).toBe(false);
    const state = {
      ...base,
      player: {
        ...base.player,
        inventory: { ...base.player.inventory, backpack: [{ defId: 'smoke-vial' }] },
      },
    };
    // PLAN.md #1.6 (AC-5): the item was a turn, so the enemy's turn follows — scripted to miss
    // (face 5 + 1 = 6 < AC 13, no skill-pick).
    const r = resolveRound(state, { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([face(5, 20)]));
    expect(r.status).toBe('ongoing');
    expect(r.events).toContainEqual({ kind: 'escape-impossible' });
    expect(r.events.some((e) => e.kind === 'attack' && e.subject === 'enemy')).toBe(true);
    // The turn WAS spent — the item is gone, and the round counts for the boss mechanic.
    expect(r.state.player.inventory.backpack).toEqual([]);
    expect(r.resolved).toBe(true);
    expect(r.roundComplete).toBe(true);
  });

  it('still works where fleeing IS allowed', () => {
    const base = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    expect(base.canFlee).toBe(true);
    const state = {
      ...base,
      player: {
        ...base.player,
        inventory: { ...base.player.inventory, backpack: [{ defId: 'smoke-vial' }] },
      },
    };
    const r = resolveRound(state, { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([]));
    expect(r.status).toBe('fled');
    expect(r.events.some((e) => e.kind === 'escape-impossible')).toBe(false);
  });
});

describe('G36 — a rejected press resolves nothing', () => {
  it('marks each no-op rejection unresolved, and every real round resolved', () => {
    // PLAN.md #2: four rejections now — the two potion refusals left with the potion (§22.6).
    const enemy = makeEnemy({ hp: 30 });
    const rejections: [string, RoundResult][] = [
      ['escape-impossible', resolveRound(createBattle(makePlayer(), enemy, 5), 'run', scriptedRng([]))],
      ['cast-unavailable', resolveRound(createBattle(makePlayer({ skillPool: [] }), enemy, 1), { kind: 'cast', skillId: 'ember' }, scriptedRng([]))],
      ['consumable-unavailable', resolveRound(createBattle(emptyPack(makePlayer()), enemy, 1), { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([]))],
      ['spare-unavailable', resolveRound(createBattle(makePlayer(), makeEnemy({ karmaWeighted: false }), 1), 'spare', scriptedRng([]))],
    ];
    for (const [name, r] of rejections) {
      expect(r.status, `${name}: still ongoing`).toBe('ongoing');
      expect(r.resolved, `${name}: must NOT be resolved`).toBe(false);
      expect(r.roundComplete, `${name}: completes no round`).toBe(false);
      expect(r.events.map((e) => e.kind), `${name}: emits only its rejection`).toEqual([name]);
    }

    // And the real actions ARE resolved.
    expect(resolveRound(createBattle(makePlayer(), enemy, 1), 'fight', scriptedRng([face(15, 20), face(4, 6), face(15, 20), 0.5])).resolved).toBe(true);
    const withDraught = makePlayer({ hp: 1 });
    const drinking = { ...withDraught, inventory: { ...withDraught.inventory, backpack: [{ defId: 'void-draught' }] } };
    // An item is a turn: the enemy answers (face 5 -> a miss).
    expect(resolveRound(createBattle(drinking, enemy, 1), { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([face(5, 20)])).resolved).toBe(true);
    expect(resolveRound(createBattle(makePlayer(), enemy, 1), 'run', scriptedRng([0.1])).resolved).toBe(true);
    expect(resolveRound(createBattle(makePlayer(), makeEnemy({ karmaWeighted: true }), 1), 'spare', scriptedRng([])).resolved).toBe(true);
  });
});

describe('BattleState JSON round-trip', () => {
  it('state survives JSON.parse(JSON.stringify(x)) unchanged after a round', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(4, 6), face(15, 20), 0.5]));
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

// =============================================================================================
// PLAN.md #1.6 — THE SEQUENTIAL ROUND AND THE §16.1 TEMPO GAUGE (AC-3 .. AC-15)
//
// Every expected number below is derived by hand in its comment: the gauge from §16.1's table
// (rate = DEX mod, ±3 for Quick/Slow, plus an enemy family's speed; the ENEMY's rate capped at
// the author's ±3, the player's never — G78; +10 → an extra action, −10 → a lost turn). Tests
// about an ENEMY rate above the cap are played with it LIFTED (`SPEC`, the measurement seam) to
// prove the machinery follows the formula; the shipped enemy clip is its own case (AC-13).
// the dice from the scripted faces. `FUMBLE` (a natural 1) is used wherever a test is about
// the gauge and not the blow: a fumble draws only its d20 and deals nothing, on either side.
// =============================================================================================

/** The d20 face every "about the gauge, not the blow" roll uses: a fumble, one draw, no damage. */
const FUMBLE = face(1, 20);
/** An rng that fumbles forever — for multi-round gauge tests whose draws are not the point. */
const alwaysFumble: Rng = () => FUMBLE;
/** §16.1's formula with the shipped cap lifted — the measurement seam, never set by the game. */
const SPEC: RoundRules = { ...DEFAULT_ROUND_RULES, tempoRateCapTenths: Infinity };

/** The player fixture with its DEX set (its AC follows DEX; irrelevant where both sides fumble). */
function playerWithDex(dex: number, overrides: Partial<Player> = {}): Player {
  const p = makePlayer(overrides);
  return { ...p, stats: { ...p.stats, DEX: dex } };
}

/** The enemy fixture with its DEX set. */
function enemyWithDex(dex: number, overrides: Partial<Enemy> = {}): Enemy {
  const e = makeEnemy(overrides);
  return { ...e, stats: { ...e.stats, DEX: dex } };
}

/** The player's `attack` events in a step. */
const playerAttacks = (r: RoundResult) => r.events.filter((e) => e.kind === 'attack' && e.subject === 'player');
/** The enemy's `attack` events in a step. */
const enemyAttacks = (r: RoundResult) => r.events.filter((e) => e.kind === 'attack' && e.subject === 'enemy');
const kinds = (r: RoundResult) => r.events.map((e) => e.kind);

/**
 * Play `rounds` WHOLE rounds of Fight: a step that pauses for the extra action is answered with a
 * second Fight, and that pair is one round. Returns, per round, the player's and enemy's gauge
 * after it and whether the round held an extra action / a lost turn for each side.
 */
function playRounds(start: BattleState, rounds: number, rng: Rng, rules: RoundRules = DEFAULT_ROUND_RULES, each?: (b: BattleState) => BattleState) {
  let battle = start;
  const log: { player: number; enemy: number; extra: boolean; lost: boolean; enemyExtra: boolean; enemyLost: boolean; steps: RoundResult[] }[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    if (each) battle = each(battle);
    const steps: RoundResult[] = [resolveRound(battle, 'fight', rng, rules)];
    if (steps[0]!.state.extraAction) steps.push(resolveRound(steps[0]!.state, 'fight', rng, rules));
    battle = steps[steps.length - 1]!.state;
    const all = steps.flatMap((s) => s.events);
    log.push({
      player: battle.tempo?.player ?? 0,
      enemy: battle.tempo?.enemy ?? 0,
      extra: all.some((e) => e.kind === 'tempo-extra-action' && e.subject === 'player'),
      lost: all.some((e) => e.kind === 'tempo-lost-turn' && e.subject === 'player'),
      enemyExtra: all.some((e) => e.kind === 'tempo-extra-action' && e.subject === 'enemy'),
      enemyLost: all.some((e) => e.kind === 'tempo-lost-turn' && e.subject === 'enemy'),
      steps,
    });
  }
  return log;
}

const roundsWhere = (log: ReturnType<typeof playRounds>, pick: (r: ReturnType<typeof playRounds>[number]) => boolean) =>
  log.flatMap((r, i) => (pick(r) ? [i + 1] : []));

describe('AC-3 — the enemy\'s turn is tick, then act: a stun you cast stops its very next blow', () => {
  it('Intimidate lands a stun; the enemy\'s tick onsets it and it skips — no enemy draw at all', () => {
    // Intimidate: Psychic base 1, cost 1, applies stun. The cast draws nothing; the enemy's tick
    // is the stun's ONSET (skip, no save, no draw), so the enemy takes no to-hit draw either:
    // the empty script would throw on any draw. Before #1.6 the enemy struck FIRST and the stun
    // only bit the round after.
    const state = createBattle(makePlayer({ hp: 20, skillPool: ['intimidate'], skillCharges: 3 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, { kind: 'cast', skillId: 'intimidate' }, scriptedRng([]));
    const k = kinds(r);
    const at = (kind: string, conditionType: string) =>
      r.events.findIndex((e) => e.kind === kind && 'conditionType' in e && e.conditionType === conditionType && 'subject' in e && e.subject === 'enemy');
    expect(at('condition-applied', 'stun')).toBeGreaterThanOrEqual(0);
    expect(at('condition-onset', 'stun')).toBeGreaterThan(at('condition-applied', 'stun'));
    expect(at('condition-skip', 'stun')).toBeGreaterThan(at('condition-onset', 'stun'));
    expect(enemyAttacks(r)).toEqual([]);
    expect(k).not.toContain('enemy-skill-used');
    expect(r.state.player.hp).toBe(20);
    expect(r.state.enemy.hp).toBe(29); // 30 - Intimidate's 1
  });
});

describe('AC-2 (mirror) — an enemy blow that kills the player ends the round there', () => {
  it('no second enemy action, even with one pending', () => {
    // Enemy DEX 18 (rate +4) at gauge 8: 8 + 4 = 12 -> an extra action this round. The player
    // fumbles (face 1, one draw). The enemy's first blow: face 15 + 1 = 16 >= AC 13 -> hit,
    // Pyro Ball 2: player 2 -> 0 -> defeat. The script holds exactly those three draws, so a
    // second enemy action would throw; and `tempo-extra-action` (emitted BEFORE the second
    // action) never fires.
    const base = createBattle(makePlayer({ hp: 2 }), enemyWithDex(18, { hp: 30 }), 1);
    const state: BattleState = { ...base, tempo: { player: 0, enemy: 8 } };
    const r = resolveRound(state, 'fight', scriptedRng([FUMBLE, face(15, 20), 0.5]));
    expect(r.status).toBe('player-died');
    expect(enemyAttacks(r)).toHaveLength(1);
    expect(kinds(r)).not.toContain('tempo-extra-action');
    expect(r.events.at(-1)).toEqual({ kind: 'defeat' });
  });
});

describe('AC-5 — an item is a turn, and the enemy answers it', () => {
  it('Suture Kit heals 4, then the enemy hits for 2: 10 + 4 - 2 = 12', () => {
    // suture-kit: cures bleed, heals 4 (consumables.json). The enemy: face 15 -> 16 >= 13 hit,
    // skill-pick 0.5 -> Pyro Ball 2.
    const p = makePlayer({ hp: 10 });
    const player = { ...p, inventory: { ...p.inventory, backpack: [{ defId: 'suture-kit' }] } };
    const r = resolveRound(createBattle(player, makeEnemy({ hp: 30 }), 1), { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([face(15, 20), 0.5]));
    expect(r.state.player.hp).toBe(12);
    const hp = r.events.filter((e) => e.kind === 'hp-changed' && e.subject === 'player').map((e) => (e as { hp: number }).hp);
    expect(hp).toEqual([14, 12]); // the heal, then the blow — each where it happened
    expect(r.roundComplete).toBe(true);
  });

  it('a Smoke Vial that escapes ends the round — no enemy action, no draw', () => {
    const p = makePlayer({ hp: 20 });
    const player = { ...p, inventory: { ...p.inventory, backpack: [{ defId: 'smoke-vial' }] } };
    const r = resolveRound(createBattle(player, makeEnemy({ hp: 30 }), 1), { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([]));
    expect(r.status).toBe('fled');
    expect(enemyAttacks(r)).toEqual([]);
  });
});

describe('AC-7 — DEX 10 on both sides: the gauge never moves and says nothing', () => {
  it('ten real rounds, no tempo-* event, and no tempo on the battle', () => {
    const log = playRounds(createBattle(playerWithDex(10, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble);
    for (const round of log) {
      expect(round.player).toBe(0);
      expect(round.enemy).toBe(0);
      for (const s of round.steps) expect(kinds(s).filter((k) => k.startsWith('tempo-'))).toEqual([]);
      expect(round.steps.every((s) => s.state.tempo === undefined)).toBe(true);
    }
  });
});

describe('AC-8 — DEX 18: "an extra action every ~2.5 rounds" (§16.1, the formula)', () => {
  it('SHIPPED, the player is never capped (G78): the same 3, 5, 8, 10 under the default rules', () => {
    // The author's third-round ruling: the ±0.3 cap is the ENEMY's alone. A DEX-18 player's
    // +0.4 is played in full: 4, 8, 12 -> 2, 6, 10 -> 0, 4, 8, 12 -> 2, 6, 10 -> 0.
    const log = playRounds(createBattle(playerWithDex(18, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble);
    expect(log.map((r) => r.player)).toEqual([4, 8, 2, 6, 0, 4, 8, 2, 6, 0]);
    expect(roundsWhere(log, (r) => r.extra)).toEqual([3, 5, 8, 10]);
  });

  it('gauge 4, 8, 2, 6, 0, 4, 8, 2, 6, 0 — extra actions on rounds 3, 5, 8, 10', () => {
    // Rate +4: 4, 8, 12 -> extra -> 2, 6, 10 -> extra -> 0, 4, 8, 12 -> 2, 6, 10 -> 0.
    const log = playRounds(createBattle(playerWithDex(18, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble, SPEC);
    expect(log.map((r) => r.player)).toEqual([4, 8, 2, 6, 0, 4, 8, 2, 6, 0]);
    expect(roundsWhere(log, (r) => r.extra)).toEqual([3, 5, 8, 10]);
    // Each extra round took TWO steps (the pause, then the second input) and two player blows.
    for (const i of [3, 5, 8, 10]) {
      const round = log[i - 1]!;
      expect(round.steps).toHaveLength(2);
      expect(round.steps[0]!.state.extraAction).toBe(true);
      expect(round.steps.flatMap((s) => playerAttacks(s))).toHaveLength(2);
    }
    expect(roundsWhere(log, (r) => r.steps.length === 2)).toEqual([3, 5, 8, 10]);
  });
});

describe('AC-9 — DEX 6: "loses a turn every 5 rounds"', () => {
  it('gauge -2, -4, -6, -8, 0 ... — turns lost on rounds 5 and 10, and the enemy still acts', () => {
    const log = playRounds(createBattle(playerWithDex(6, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble);
    expect(log.map((r) => r.player)).toEqual([-2, -4, -6, -8, 0, -2, -4, -6, -8, 0]);
    expect(roundsWhere(log, (r) => r.lost)).toEqual([5, 10]);
    for (const i of [5, 10]) {
      const s = log[i - 1]!.steps[0]!;
      expect(s.events).toContainEqual({ kind: 'tempo-lost-turn', subject: 'player' });
      expect(playerAttacks(s)).toEqual([]);
      expect(enemyAttacks(s)).toHaveLength(1);
    }
  });
});

describe('AC-10 — Quick and Slow are the ±0.3, to the digit', () => {
  const keep = (type: 'quick' | 'slow') => (b: BattleState): BattleState => ({
    ...b,
    player: { ...b.player, activeConditions: [makeCondition(type)] },
  });

  it('DEX 18 + Quick (re-applied each round), §16.1 formula: rate +7 — extras on 2, 3, 5, 6, 8, 9, 10', () => {
    // 4 + 3 = 7 (the augment's own +2 DEX is NOT counted twice). 7, 14->4, 11->1, 8, 15->5,
    // 12->2, 9, 16->6, 13->3, 10->0. (The plan's AC-10 listed 2,3,5,6,8,9; round 10 lands on
    // +1.0 exactly and crosses too — seventy tenths are seven crossings.)
    const log = playRounds(createBattle(playerWithDex(18, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble, SPEC, keep('quick'));
    expect(log.map((r) => r.player)).toEqual([7, 4, 1, 8, 5, 2, 9, 6, 3, 0]);
    expect(roundsWhere(log, (r) => r.extra)).toEqual([2, 3, 5, 6, 8, 9, 10]);
  });

  it('SHIPPED, the same Quick DEX-18 player keeps its full +7 (G78: the cap is the enemy’s)', () => {
    const quick = playRounds(createBattle(playerWithDex(18, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble, DEFAULT_ROUND_RULES, keep('quick'));
    expect(quick.map((r) => r.player)).toEqual([7, 4, 1, 8, 5, 2, 9, 6, 3, 0]);
    expect(roundsWhere(quick, (r) => r.extra)).toEqual([2, 3, 5, 6, 8, 9, 10]);
    // ...while an ENEMY at the same speed is clipped: DEX 18 (+4) → +3.
    const foe = playRounds(createBattle(playerWithDex(10, { hp: 20 }), enemyWithDex(18, { hp: 30 }), 1), 1, alwaysFumble);
    expect(foe[0]!.enemy).toBe(3);
  });

  it('DEX 10 + Slow: rate -3 — turns lost on rounds 4, 7, 10', () => {
    // -3, -6, -9, -12 -> -2, -5, -8, -11 -> -1, -4, -7, -10 -> 0.
    const log = playRounds(createBattle(playerWithDex(10, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble, DEFAULT_ROUND_RULES, keep('slow'));
    expect(log.map((r) => r.player)).toEqual([-3, -6, -9, -2, -5, -8, -1, -4, -7, 0]);
    expect(roundsWhere(log, (r) => r.lost)).toEqual([4, 7, 10]);
  });

  it('SHIPPED, the PLAYER’s slow side is uncapped too (G78): DEX 6 + Slow loses every other turn', () => {
    // The enemy's ±0.3 cap would hold this at −3; the player's rate is §16.1's in full:
    // DEX 6 → floor(−4/2) = −2, Slow −3 → −5 a round. −5, −10 → lost, spent → 0, −5, 0, …
    // so the gauge reads −5, 0 alternately and the turn is lost on every even round.
    const log = playRounds(createBattle(playerWithDex(6, { hp: 20 }), makeEnemy({ hp: 30 }), 1), 10, alwaysFumble, DEFAULT_ROUND_RULES, keep('slow'));
    expect(log.map((r) => r.player)).toEqual([-5, 0, -5, 0, -5, 0, -5, 0, -5, 0]);
    expect(roundsWhere(log, (r) => r.lost)).toEqual([2, 4, 6, 8, 10]);
  });
});

describe('AC-11 — the extra action is a second INPUT', () => {
  // DEX 18 (rate +4, the player's is uncapped) at gauge 6: 6 + 4 = 10 -> the extra action this round. Regeneration (past onset,
  // one turn left) marks the player's tick: it heals +1 on the FIRST step and must not tick again.
  function crossing(): BattleState {
    const base = createBattle(
      playerWithDex(18, { hp: 15, skillPool: ['strike'], skillCharges: 3, activeConditions: [{ type: 'regeneration', remainingTurns: 1, maxTurns: 2, onsetDone: true }] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    return { ...base, tempo: { player: 6, enemy: 0 } };
  }

  it('the first step resolves one action and PAUSES: extra action announced, the enemy has not acted', () => {
    // Draws: the player's d20 face 15 -> hit, 1d6 face 4. No enemy draw (the script would throw).
    const r = resolveRound(crossing(), 'fight', scriptedRng([face(15, 20), face(4, 6)]));
    expect(r.status).toBe('ongoing');
    expect(r.resolved).toBe(true);
    expect(r.roundComplete).toBe(false);
    expect(r.state.extraAction).toBe(true);
    // 6 + 4 = 10 -> the threshold spent -> 0. Both gauges at 0, so the battle carries no `tempo`.
    expect(r.events).toContainEqual({ kind: 'tempo-changed', subject: 'player', tenths: 0 });
    expect(r.state.tempo).toBeUndefined();
    expect(r.events.at(-1)).toEqual({ kind: 'tempo-extra-action', subject: 'player' });
    expect(r.events).toContainEqual({ kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 1 });
    expect(enemyAttacks(r)).toEqual([]);
    expect(r.state.enemy.hp).toBe(26);
    expect(r.state.player.hp).toBe(16); // 15 + 1 regeneration
  });

  it('the second input resolves with NO tick and NO gauge move, then the enemy\'s turn, and the pause clears', () => {
    const paused = resolveRound(crossing(), 'fight', scriptedRng([face(15, 20), face(4, 6)])).state;
    // Second action: Cast Strike (no draw): enemy 26 - 2 = 24, bleed applied. Enemy's turn: the
    // bleed's onset (no draw), to-hit face 15 -> hit, Pyro Ball 2: player 16 - 2 = 14.
    const r = resolveRound(paused, { kind: 'cast', skillId: 'strike' }, scriptedRng([face(15, 20), 0.5]));
    expect(r.roundComplete).toBe(true);
    expect(r.state.extraAction).toBeUndefined();
    expect(kinds(r)).not.toContain('condition-heal'); // no second player tick
    expect(kinds(r)).not.toContain('tempo-changed'); // no gauge move for either side
    expect(r.state.enemy.hp).toBe(24);
    expect(r.state.player.hp).toBe(14);
    expect(enemyAttacks(r)).toHaveLength(1);
  });

  it('any battle action is legal second — Run and Item included', () => {
    const paused = resolveRound(crossing(), 'fight', scriptedRng([face(15, 20), face(4, 6)])).state;
    expect(resolveRound(paused, 'run', scriptedRng([0.1])).status).toBe('fled');
    const withKit = { ...paused, player: { ...paused.player, inventory: { ...paused.player.inventory, backpack: [{ defId: 'suture-kit' }] } } };
    const item = resolveRound(withKit, { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([FUMBLE]));
    expect(item.events).toContainEqual({ kind: 'consumable-used', itemId: 'suture-kit' });
    expect(item.roundComplete).toBe(true);
  });

  it('a REJECTED press during the pause leaves the pause set and changes nothing', () => {
    const paused = resolveRound(crossing(), 'fight', scriptedRng([face(15, 20), face(4, 6)])).state;
    const r = resolveRound(paused, { kind: 'cast', skillId: 'venom' }, scriptedRng([]));
    expect(r.events).toEqual([{ kind: 'cast-unavailable' }]);
    expect(r.state).toBe(paused);
    expect(r.state.extraAction).toBe(true);
    expect(r.roundComplete).toBe(false);
  });

  it('the paused round keeps its own disadvantage for the second action (a fracture\'s -1)', () => {
    // Fracture (past onset) makes this round's player rolls disadvantaged. First action: two d20s
    // (15, 15) -> 15 + 6 = 21 hit, 1d6(4). Second action: STILL two d20s — (15, 3) -> natural 3
    // -> 3 + 6 = 9 < AC 10 -> miss. A straight roll would have taken ONE die (15 -> hit).
    const base = createBattle(
      playerWithDex(18, { hp: 20, activeConditions: [{ type: 'fracture', remainingTurns: 5, maxTurns: 100, onsetDone: true }] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const paused = resolveRound({ ...base, tempo: { player: 6, enemy: 0 } }, 'fight', scriptedRng([face(15, 20), face(15, 20), face(4, 6)])).state;
    expect(paused.extraActionAdvDis).toBe(-1);
    const r = resolveRound(paused, 'fight', scriptedRng([face(15, 20), face(3, 20), FUMBLE]));
    const second = playerAttacks(r)[0] as Extract<CombatEvent, { kind: 'attack' }>;
    expect(second.roll.faces).toEqual([15, 3]);
    expect(second.outcome).toBe('miss');
    expect(r.state.extraActionAdvDis).toBeUndefined();
  });
});

describe('AC-12 — the enemy\'s extra action is two actions in one step', () => {
  it('DEX 18 enemy vs DEX 10 player: one action on rounds 1 and 2, two on round 3, one tick', () => {
    // Enemy rate +4: 4, 8, 12 -> extra on round 3. Player (DEX 10, AC 11 + 1 + 0 = 12) fumbles.
    // Every enemy action: face 15 + 1 = 16 >= 12 -> hit, skill-pick 0.5 -> Pyro Ball 2 (the
    // enemy holds 10 charges, so it can always pay). Player 20 -> 18 -> 16 -> 14 -> 12.
    // The enemy carries regeneration (fresh) so its TICK is visible: exactly one heal a round.
    // Played at §16.1's formula (`SPEC`); under the shipped ±0.3 cap the same enemy first
    // doubles on round 4 (AC-13's shipped case pins that).
    let battle = createBattle(playerWithDex(10, { hp: 20 }), enemyWithDex(18, { hp: 30, skillCharges: 10, maxSkillCharges: 10 }), 1);
    const r1 = resolveRound(battle, 'fight', scriptedRng([FUMBLE, face(15, 20), 0.5]), SPEC);
    const r2 = resolveRound((battle = r1.state), 'fight', scriptedRng([FUMBLE, face(15, 20), 0.5]), SPEC);
    battle = { ...r2.state, enemy: { ...r2.state.enemy, activeConditions: [makeCondition('regeneration')] } };
    const r3 = resolveRound(battle, 'fight', scriptedRng([FUMBLE, face(15, 20), 0.5, face(15, 20), 0.5]), SPEC);
    expect(enemyAttacks(r1)).toHaveLength(1);
    expect(enemyAttacks(r2)).toHaveLength(1);
    expect(enemyAttacks(r3)).toHaveLength(2);
    expect(r3.events).toContainEqual({ kind: 'tempo-extra-action', subject: 'enemy' });
    expect(r3.events.filter((e) => e.kind === 'condition-heal' && e.subject === 'enemy')).toHaveLength(1);
    // Each blow is followed by its own hp-changed, and the player falls by the sum: 16 - 2 - 2.
    const hp = r3.events.filter((e) => e.kind === 'hp-changed' && e.subject === 'player').map((e) => (e as { hp: number }).hp);
    expect(hp).toEqual([14, 12]);
    expect(r3.state.player.hp).toBe(12);
    // ...in order: attack, hp-changed, extra-action, attack, hp-changed.
    const seq = kinds(r3).filter((k) => ['attack', 'hp-changed', 'tempo-extra-action'].includes(k));
    expect(seq).toEqual(['attack', 'attack', 'hp-changed', 'tempo-extra-action', 'attack', 'hp-changed']);
  });
});

describe('AC-13 — the rate cap, and the two measurement switches', () => {
  // DEX 40 -> mod floor(30/2) = 15. Capped at the author's 3: 3, 6, 9, 12 -> extra on round 4.
  const fresh = () => createBattle(playerWithDex(10, { hp: 20 }), enemyWithDex(40, { hp: 30 }), 1);

  it('under the shipped cap the first enemy extra action is on round 4', () => {
    const log = playRounds(fresh(), 4, alwaysFumble);
    expect(log.map((r) => r.enemy)).toEqual([3, 6, 9, 2]);
    expect(roundsWhere(log, (r) => r.enemyExtra)).toEqual([4]);
  });

  it('with the cap lifted (§16.1 literal) it is on round 1', () => {
    const log = playRounds(fresh(), 1, alwaysFumble, { ...DEFAULT_ROUND_RULES, tempoRateCapTenths: Infinity });
    expect(log[0]!.enemy).toBe(5); // 15 -> extra -> 5
    expect(log[0]!.enemyExtra).toBe(true);
  });

  it('with the enemy gauge switched off it never moves', () => {
    const log = playRounds(fresh(), 10, alwaysFumble, { ...DEFAULT_ROUND_RULES, enemyTempo: false });
    expect(log.every((r) => r.enemy === 0 && !r.enemyExtra)).toBe(true);
  });

  it('the shipped renderer passes none of the measurement knobs', () => {
    const src = readFileSync(new URL('../desktop/game.ts', import.meta.url), 'utf8');
    expect(src.length).toBeGreaterThan(1000); // non-vacuity: the file was read
    expect(src).not.toMatch(/tempoRateCapTenths|enemyTempo|familySpeed/);
  });
});

describe('the enemy family\'s data-driven speed (author, 2026-09-26)', () => {
  it('a Mutant Stray (+2) at DEX 10 fills its gauge +0.2 a round; a Cyber-Enforcer (-2) empties it', () => {
    // enemyFamilies.json: mutantStrays speedTenths 2, cyberEnforcers -2. DEX 10 contributes 0.
    const run = (familyId: string, rules: RoundRules = DEFAULT_ROUND_RULES) =>
      playRounds(createBattle(playerWithDex(10, { hp: 20 }), makeEnemy({ hp: 30, familyId }), 1), 3, alwaysFumble, rules).map((r) => r.enemy);
    expect(run('mutantStrays')).toEqual([2, 4, 6]);
    expect(run('cyberEnforcers')).toEqual([-2, -4, -6]);
    // The measurement switch zeroes the family term and nothing else.
    expect(run('mutantStrays', { ...DEFAULT_ROUND_RULES, familySpeed: false })).toEqual([0, 0, 0]);
  });

  it('the family speed adds to Dexterity BEFORE the cap', () => {
    // §16.1 formula (cap lifted): DEX 18 (+4) + Mutant Stray (+2) = 6: 6, 12 -> extra -> 2.
    const log = playRounds(createBattle(playerWithDex(10, { hp: 20 }), enemyWithDex(18, { hp: 30, familyId: 'mutantStrays' }), 1), 2, alwaysFumble, SPEC);
    expect(log.map((r) => r.enemy)).toEqual([6, 2]);
    // Shipped: DEX 12 (+1) + 2 = 3, exactly the cap; DEX 14 (+2) + 2 = 4 -> capped at 3.
    const at = (dex: number) => playRounds(createBattle(playerWithDex(10, { hp: 20 }), enemyWithDex(dex, { hp: 30, familyId: 'mutantStrays' }), 1), 1, alwaysFumble)[0]!.enemy;
    expect(at(12)).toBe(3);
    expect(at(14)).toBe(3);
    // ...and a slow family pulls a fast enemy back under it: DEX 14 (+2) + Cyber-Enforcer (-2) = 0.
    const slowFast = playRounds(createBattle(playerWithDex(10, { hp: 20 }), enemyWithDex(14, { hp: 30, familyId: 'cyberEnforcers' }), 1), 1, alwaysFumble);
    expect(slowFast[0]!.enemy).toBe(0);
  });
});

describe('AC-14 — a controlled combatant spends no threshold', () => {
  it('a stunned DEX-18 player drifts past +1.0 without acting, then takes the extra action when free', () => {
    // Gauge 8, stunned (onset): 8 + 4 (DEX 18, uncapped for the player) = 12, no crossing.
    const base = createBattle(playerWithDex(18, { hp: 20, activeConditions: [makeCondition('stun')] }), makeEnemy({ hp: 30 }), 1);
    const held = resolveRound({ ...base, tempo: { player: 8, enemy: 0 } }, 'fight', scriptedRng([FUMBLE]));
    expect(held.state.tempo?.player).toBe(12);
    expect(kinds(held)).not.toContain('tempo-extra-action');
    expect(held.events).toContainEqual({ kind: 'player-unable-to-act', conditionType: 'stun' });
    // Freed (the stun cleared by hand): 12 + 4 = 16 -> extra -> 6.
    const free = { ...held.state, player: { ...held.state.player, activeConditions: [] } };
    const r = resolveRound(free, 'fight', scriptedRng([FUMBLE]));
    expect(r.state.extraAction).toBe(true);
    expect(r.state.tempo?.player).toBe(6);
  });
});
