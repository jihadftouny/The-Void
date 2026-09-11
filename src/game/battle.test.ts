import { describe, expect, it } from 'vitest';
import {
  MOMENTUM_CARRY,
  applyDamageToBattlePlayer,
  createBattle,
  openBattle,
  resetTransientCombatState,
  resolveRound,
  rollFlee,
  spareAvailable,
  type RoundResult,
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

describe('resolveRound Fight — exact HP deltas + exact event list', () => {
  // Player AC = 13 (Enforcer, Jooj Armor 1 baseArmor 11, CON 12/+1, DEX 12/+1:
  // 11 + 1 + min(1,2)). Enemy STR 13 -> +1 to hit. Draw order [enemyToHit, skillPick,
  // playerD20, playerDamage]:
  //  1) no conditions -> enemy tick draws nothing.
  //  2) enemy to-hit d20 face 15 + 1 = 16 >= AC 13 -> hit; skill-pick randInt(_,1)=0 ->
  //     Pyro Ball, res 0 -> damage 2, charge 2->1.
  //  3) player tick draws nothing.
  //  4) player d20 face 15 + STR mod 4 + proficiency 2 = 21 >= enemy AC 10 -> hit; damage
  //     1d6 face 4 -> 4.
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
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      {
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 4,
        // natural 15 + 4 (player STR mod) = 19 >= enemy AC 10.
        // CHANGED by G32: `modifier` is now weaponModifier(4) + proficiency(2) = 6, folded
        // into the one field the log prints as `natural + modifier = total`. The outcome is
        // unchanged (19 and 21 both clear AC 10) — only the reported sum moved.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 6, total: 21, targetAc: 10 },
        damageSources: [{ kind: 'weapon-dice', amount: 4, label: '1d6' }],
      },
    ]);

    // Input state deep-equals its pre-call snapshot (pure, returns a NEW state).
    expect(state).toEqual(snapshot);
    expect(r.state).not.toBe(state);
  });
});

describe('resolveRound Fight — victory rewards', () => {
  // enemy.xp 3, hp 4. Player deals 4 -> enemy 0 -> victory. Reward draws (M7: gold -> loot):
  //  loot gate: rng() < act-1 dropChance(0.5) -> 0.99 >= 0.5 -> no drop (one draw), loot [].
  // PLAN.md #2: the extra-rest draw that used to come FIRST is gone (rests are found, §22.26),
  // so the victory takes exactly the loot gate's draw here.
  it('grants xp = enemy.xp, emits a victory event, and draws only the loot gate (no drop)', () => {
    const state = createBattle(makePlayer(), makeEnemy({ hp: 4, xp: 3 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6), 0.99]));

    expect(r.status).toBe('player-won');
    expect(r.state.enemy.hp).toBe(0);
    expect(r.state.player.xp).toBe(3); // 0 + enemy.xp
    expect('restsLeft' in r.state.player).toBe(false); // there is no rest counter to feed
    expect(r.state.player.inventory.backpack).toEqual([]); // failed drop gate adds nothing
    expect(r.events.at(-1)).toEqual({ kind: 'victory', xpGained: 3, loot: [] });
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

// PLAN.md #2 / GAME-DESIGN §22.6: the `potion` action and its three events are GONE — potions
// folded into consumables. The four tests that stood here (heal to cap, unavailable at full HP
// and at 0 pots, blocked under control) went with the action; the heal-to-EFFECTIVE-cap rule
// they also pinned is kept below, through the consumable that replaced the potion.
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
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      {
        kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember', damage: 2,
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
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
  // victory block draws the loot gate (0.99 >= 0.5 -> no drop). M7: gold draw replaced by the
  // loot roll; PLAN.md #2: the extra-rest draw before it is gone.
  it('an enemy killed by its own DoT tick (before acting) yields player-won + rewards', () => {
    const state = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 1, xp: 3, activeConditions: [{ type: 'poison', remainingTurns: 1, maxTurns: 2 }] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([0.99]));

    expect(r.status).toBe('player-won');
    expect(r.state.enemy.hp).toBe(0);
    expect(r.state.player.hp).toBe(20); // enemy never got to attack
    expect(r.state.player.xp).toBe(3); // 0 + enemy.xp
    expect(r.events).toEqual([
      { kind: 'condition-damage', subject: 'enemy', conditionType: 'poison', amount: 1 },
      { kind: 'victory', xpGained: 3, loot: [] },
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

describe('a full heal caps at effectiveMaxHp (Frail) — via the Void Draught that replaced the potion', () => {
  // A Frail (sick) player heals to the REDUCED effective max HP, not the stored maxHp.
  // stored maxHp 20; sick lowers CON by 2 (mod delta -1) -> effectiveMaxHp 19. The Void
  // Draught heals 100% of that cap (consumables.json), so hp 10 -> min(10 + 19, 19) = 19.
  it('a Frail player below full heals to effectiveMaxHp (19), not stored maxHp (20)', () => {
    const base = makePlayer({ hp: 10, maxHp: 20, activeConditions: [makeCondition('sick')] });
    const player = { ...base, inventory: { ...base.inventory, backpack: [{ defId: 'void-draught' }] } };
    const state = createBattle(player, makeEnemy(), 1);
    const r = resolveRound(state, { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([]));
    expect(r.state.player.hp).toBe(19);
    expect(r.state.player.inventory.backpack).toEqual([]); // spent
    expect(r.events).toEqual([{ kind: 'consumable-used', itemId: 'void-draught' }]);
  });
});

describe('resolveRound Fight — conditionless round, exact draw order (M4)', () => {
  // A conditionless round draws exactly four (M4 adds the enemy to-hit d20 ahead of the
  // skill-pick). Independent hand-derivation (enemy hp 10, player AC 13, enemy +1 to hit):
  //   enemy tick: 0 draws. enemy to-hit face 15 + 1 = 16 >= AC 13 -> hit; skill-pick 0.5 ->
  //   Pyro Ball dmg 2, charge 2->1. player tick: 0 draws. player d20 face 12 + STR mod 4 +
  //   proficiency 2 = 18 >= enemy AC 10 -> hit; dmg 1d6 face 5 -> 5. player 20-2=18,
  //   enemy 10-5=5, ongoing.
  it('produces the hand-derived state + event list and consumes exactly 4 draws', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 10 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), 0.5, face(12, 20), face(5, 6)]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(18);
    expect(r.state.enemy.hp).toBe(5);
    expect(r.state.enemy.skillCharges).toBe(1);
    expect(r.events).toEqual([
      { kind: 'enemy-skill-used', skillId: 'pyroBall', name: 'Pyro Ball' },
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      {
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 5,
        // natural 12 + 4 (player STR mod) = 16 >= enemy AC 10.
        roll: { natural: 12, faces: [12], advDis: 0, modifier: 6, total: 18, targetAc: 10 }, // G32: 4 + 2
        damageSources: [{ kind: 'weapon-dice', amount: 5, label: '1d6' }],
      },
    ]);
  });
});

describe('resolveRound Fight — enemy misses (M4 defense matters)', () => {
  // The enemy rolls a LOW natural: face 5 + 1 = 6 < AC 13 -> MISS. It deals 0, draws no
  // skill-pick, and applies no condition; the player still fights. Draws [enemyToHit,
  // playerD20, playerDamage] (only three — a skill-pick on a miss would exhaust the rng).
  //   player d20 face 15 + STR 4 + proficiency 2 = 21 >= enemy AC 10 -> hit; dmg 1d6 face
  //   4 -> 4. player 20-0=20, enemy 30-4=26, ongoing.
  it('a whiffed enemy attack deals 0 and emits attack/miss with no enemy-skill-used', () => {
    const state = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const r = resolveRound(state, 'fight', scriptedRng([face(5, 20), face(15, 20), face(4, 6)]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(20); // took 0
    expect(r.state.enemy.hp).toBe(26); // 30 - 4
    expect(r.state.enemy.skillCharges).toBe(2); // no charge spent on a miss
    expect(r.events).toEqual([
      {
        kind: 'attack', subject: 'enemy', outcome: 'miss', damage: 0,
        // natural 5 + 1 = 6 < player AC 13.
        roll: { natural: 5, faces: [5], advDis: 0, modifier: 1, total: 6, targetAc: 13 },
        damageSources: [],
      },
      {
        kind: 'attack', subject: 'player', outcome: 'hit', damage: 4,
        // natural 15 + 4 (player STR mod) = 19 >= enemy AC 10.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 6, total: 21, targetAc: 10 }, // G32: 4 + 2
        damageSources: [{ kind: 'weapon-dice', amount: 4, label: '1d6' }],
      },
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
      {
        kind: 'attack', subject: 'enemy', outcome: 'hit', damage: 2,
        // natural 15 + 1 (enemy STR mod) = 16 >= player AC 13.
        roll: { natural: 15, faces: [15], advDis: 0, modifier: 1, total: 16, targetAc: 13 },
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      {
        kind: 'skill-cast', subject: 'player', skillId: 'strike', name: 'Strike', damage: 2,
        damageSources: [{ kind: 'skill', amount: 2 }],
      },
      { kind: 'condition-applied', subject: 'enemy', conditionType: 'bleed' },
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
  // Independently derived from the dice rules, not measured:
  //   clean    — advDis 0  -> ONE d20. face 15 + enemy STR mod 1 = 16 >= player AC 13 -> hit,
  //              a skill-pick draw, Pyro Ball for 2. Player 20 - 2 = 18.
  //   fractured— advDis -1 -> TWO d20s, take the MIN. faces 15 and 3 -> natural 3; 3 + 1 = 4
  //              < AC 13 -> MISS, so 0 damage and NO skill-pick draw. Player stays at 20.
  //   both     — player d20 face 15 + STR mod 4 + proficiency 2 = 21 >= AC 10 -> hit, 1d6(4).
  it('rolls two dice at disadvantage where a clean enemy rolls one, and the log says so', () => {
    const clean = createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1);
    const rClean = resolveRound(
      clean,
      'fight',
      scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)]),
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
      // Exactly four draws: two for the disadvantaged enemy roll, then the player's two.
      // A fifth (the skill-pick) would exhaust the script, proving the miss short-circuits.
      scriptedRng([face(15, 20), face(3, 20), face(15, 20), face(4, 6)]),
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
    const state = createBattle(
      makePlayer({ hp: 20, classId: 'Scavver' }),
      makeEnemy({ hp: 30, activeConditions: [makeCondition('fracture')] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(15, 20), face(3, 20), face(15, 20), face(4, 8)]));
    const attack = enemyAttackEvent(r.events);
    expect(attack.roll!.advDis).toBe(-1);
    expect(attack.roll!.faces).toEqual([15, 3]);
  });
});

describe('G22(a) — a healing condition tick can never exceed effective max HP', () => {
  // Enemy rolls face 5 + STR mod 1 = 6 < player AC 13 -> MISS (0 damage, no skill-pick draw),
  // so the heal is isolated from the exchange. Regeneration's ONSET tick heals +2.
  it('a player at full HP with regeneration stays at maxHp instead of overhealing to 22', () => {
    const state = createBattle(
      makePlayer({ hp: 20, maxHp: 20, activeConditions: [makeCondition('regeneration')] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(5, 20), face(15, 20), face(4, 6)]));
    expect(r.state.player.hp).toBe(20); // pre-fix: 20 + 2 = 22
    expect(r.events).toContainEqual({
      kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2,
    });
  });

  it('the ENEMY side has the same cap (the mirror hole, closed in the same edit)', () => {
    const state = createBattle(
      makePlayer({ hp: 20 }),
      makeEnemy({ hp: 30, maxHp: 30, activeConditions: [makeCondition('regeneration')] }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(5, 20), face(15, 20), face(4, 6)]));
    // Capped at 30 by the tick, then the player's 1d6 face 4 lands: 30 - 4 = 26.
    // Pre-fix: 30 + 2 = 32, then - 4 = 28.
    expect(r.state.enemy.hp).toBe(26);
  });

  it('a HEALING tick below the cap still heals in full (the clamp is not a cap-to-current)', () => {
    const state = createBattle(
      makePlayer({ hp: 10, maxHp: 20, activeConditions: [makeCondition('regeneration')] }),
      makeEnemy({ hp: 30 }),
      1,
    );
    const r = resolveRound(state, 'fight', scriptedRng([face(5, 20), face(15, 20), face(4, 6)]));
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
    //   r1: enemy to-hit face 15 + STR 1 = 16 >= player AC 13 -> hit; skill-pick 0.5 -> Pyro
    //       Ball 2 (charge 2->1). Player d20 face 15 + STR 4 = 19 >= AC 10 -> hit, 1d6(4).
    //       Dealt AND took -> momentum 0 + 2 = 2.
    //   r2: identical -> momentum 4 (enemy charge 1->0).
    //   r3: the enemy is out of charges, so it deals the plain 1 and draws NO skill-pick.
    //       Dealt AND took -> 4 + 2 = 6, clamped to the cap 5.
    let battle = createBattle(
      makePlayer({ hp: 20, skillPool: ['heavyStrike'], skillCharges: 5 }),
      makeEnemy({ hp: 30 }),
      1,
    );
    expect(battle.player.momentum).toBe(0);

    battle = resolveRound(battle, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)])).state;
    expect(battle.player.momentum).toBe(2);
    battle = resolveRound(battle, 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)])).state;
    expect(battle.player.momentum).toBe(4);
    battle = resolveRound(battle, 'fight', scriptedRng([face(15, 20), face(15, 20), face(4, 6)])).state;
    expect(battle.player.momentum).toBe(MOMENTUM_CAP); // 6 clamped to 5

    // Battle 2 opens on floor(5 * 0.5) = 2 — not 5 (an uncapped carry) and not 0 (a reset).
    const next = createBattle(battle.player, makeEnemy({ hp: 30 }), 1);
    expect(next.player.momentum).toBe(2);

    // And the consequence in damage: Heavy Strike is base 3 + 1 per momentum spent, so the
    // opening cast deals 3 + 2 = 5. A full reset would deal 3; an unchecked carry, 8.
    const r = resolveRound(next, { kind: 'cast', skillId: 'heavyStrike' }, scriptedRng([face(15, 20), 0.5]));
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
    // skill-pick draw is taken.
    const start = createBattle(
      makePlayer({
        hp: 20,
        activeConditions: [{ type: 'fracture', remainingTurns: 1, maxTurns: 100, onsetDone: true }],
      }),
      makeEnemy({ hp: 30 }),
      1,
    );

    const a = resolveRound(start, 'fight', scriptedRng([face(5, 20), face(15, 20), face(3, 20)]));
    const attackA = playerAttackEvent(a.events);
    expect(attackA.roll!.advDis).toBe(-1);
    expect(attackA.roll!.faces).toEqual([15, 3]);
    expect(attackA.outcome).toBe('miss');
    // THE POINT OF G12: nothing was latched onto the player, so nothing can ride to the hub.
    expect(a.state.player.advantageDisadvantage).toBe(0);
    expect(a.state.player.activeConditions.some((c) => c.type === 'fracture')).toBe(true);

    const b = resolveRound(a.state, 'fight', scriptedRng([face(5, 20), face(15, 20), face(4, 6)]));
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
    const r = resolveRound(start, 'fight', scriptedRng([face(5, 20), face(15, 20), face(4, 6)]));
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

describe('G24 — the failed-escape counter-attack runs every defensive guard', () => {
  // Draw order for a failed run: flee roll (0.9 > 0.25 -> fails), then the counter-attack's
  // to-hit d20 (face 15 + enemy STR mod 1 = 16 >= player AC 13 -> hit) and its skill-pick
  // (0.5 -> the only pool entry, Pyro Ball, base 2 vs 0 resistance).
  const failedRun = [0.9, face(15, 20), 0.5];

  it('a shield absorbs the counter-attack, exactly as it does in an ordinary round', () => {
    const state = withShield(createBattle(makePlayer({ hp: 20 }), makeEnemy({ hp: 30 }), 1), 20);
    const r = resolveRound(state, 'run', scriptedRng(failedRun));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(20); // pre-fix: 18, the shield was not consulted at all
    expect(r.state.player.shield).toBe(18); // 20 - 2 absorbed
    expect(r.events).toContainEqual({ kind: 'shield-absorbed', amount: 2 });
    // `escape-failed` reports the HP actually lost, so it reconciles with the absorb beside it.
    expect(r.events).toContainEqual({ kind: 'escape-failed', damage: 0 });
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

    // Site 1: the ordinary round (enemy to-hit face 15 -> hit, skill-pick -> Pyro Ball 2;
    // then the player's own d20 + damage, which touch nothing on the defensive side).
    const ordinary = resolveRound(loadout(), 'fight', scriptedRng([face(15, 20), 0.5, face(1, 20)]));
    // Site 2: the failed-escape counter-attack.
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
    const r = resolveRound(state, { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([]));
    expect(r.status).toBe('ongoing');
    expect(r.events).toContainEqual({ kind: 'escape-impossible' });
    // The turn WAS spent — the item is gone, and the round counts for the boss mechanic.
    expect(r.state.player.inventory.backpack).toEqual([]);
    expect(r.resolved).toBe(true);
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
      expect(r.events.map((e) => e.kind), `${name}: emits only its rejection`).toEqual([name]);
    }

    // And the real actions ARE resolved.
    expect(resolveRound(createBattle(makePlayer(), enemy, 1), 'fight', scriptedRng([face(15, 20), 0.5, face(15, 20), face(4, 6)])).resolved).toBe(true);
    const withDraught = makePlayer({ hp: 1 });
    const drinking = { ...withDraught, inventory: { ...withDraught.inventory, backpack: [{ defId: 'void-draught' }] } };
    expect(resolveRound(createBattle(drinking, enemy, 1), { kind: 'useConsumable', source: { index: 0 } }, scriptedRng([])).resolved).toBe(true);
    expect(resolveRound(createBattle(makePlayer(), enemy, 1), 'run', scriptedRng([0.1])).resolved).toBe(true);
    expect(resolveRound(createBattle(makePlayer(), makeEnemy({ karmaWeighted: true }), 1), 'spare', scriptedRng([])).resolved).toBe(true);
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
