// M6 step 3 — triggered relic pipeline + every seed relic/unique through the REAL combat
// path (resolveRound / openBattle). Every expected number is hand-derived from the D&D
// dice math, the weapon/armor tables, and the relic data — never read back from code.
//
// Dice control: a fixed-sequence rng returns exactly the draws a round consumes (and throws
// if the code draws more than expected — a guard against silent extra draws). d20(n) is the
// rng float that makes rollDie(rng,20) land on natural n; dmg6(4) lands 1d6 on 4.

import { describe, expect, it } from 'vitest';
import { resolveRound, openBattle, createBattle, type BattleState } from './battle.ts';
import { createPlayer, type Player } from './player.ts';
import { computeStatMods, computeStatMod, type Stats } from './character.ts';
import { playerArmorClass } from './defense.ts';
import { type Enemy } from './enemy.ts';
import { type Rng } from './rng.ts';
import { type ItemInstance } from './item.ts';
import { applyEffectAction } from './relicEffects.ts';

/** The rng float that makes rollDie(rng, sides) land on `face`. */
function faceOf(face: number, sides: number): number {
  return (face - 0.5) / sides;
}
const d20 = (n: number) => faceOf(n, 20);
const d6 = (n: number) => faceOf(n, 6);

/** A fixed-sequence rng; throws if drawn more than the authored sequence (extra-draw guard). */
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted at draw ${i} (unexpected extra draw)`);
    return values[i++]!;
  };
}

const STATS: Stats = { STR: 14, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };

/** An Enforcer (STR14 -> +2 melee mod, CON10 -> AC 11 / maxHp 10) with optional equipped slots. */
function makePlayer(slots: Record<string, ItemInstance> = {}, over: Partial<Player> = {}): Player {
  const p = createPlayer({ name: 'Ari', classId: 'Enforcer', stats: STATS });
  return {
    ...p,
    inventory: { ...p.inventory, slots: { ...p.inventory.slots, ...slots } },
    ...over,
  };
}

function makeEnemy(over: Partial<Enemy> = {}): Enemy {
  const stats: Stats = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
  return {
    name: 'Beast',
    type: 'Beast',
    fullName: 'Beast',
    stats,
    mods: computeStatMods(stats),
    hp: 30,
    maxHp: 30,
    xp: 1,
    armorClass: 10,
    skillCharges: 0,
    maxSkillCharges: 2,
    hitDie: { quantity: 1, sides: 8 },
    resistances: [0, 0, 0, 0, 0, 0, 0],
    skillPool: [],
    activeConditions: [],
    familyId: 'Beast',
    karmaWeighted: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Per-trigger firing (the six trigger points), each with a hand-derived outcome.
// ---------------------------------------------------------------------------

describe('trigger: onTakeDamage — Mirror Shard reflects 25% of damage taken', () => {
  // Enemy crits with pyroBall (base 2, crit doubles -> 4 to the player). Reflect = floor(4*0.25)
  // = 1. Player fumbles (0 damage), so the enemy's ONLY hp loss is the reflected 1.
  // Draws: enemy d20 nat20, enemy skill-pick, player d20 nat1(fumble).
  const enemy = makeEnemy({ hp: 30, skillCharges: 1, skillPool: ['pyroBall'] });

  it('with Mirror Shard the enemy loses exactly 1 hp (the reflect); the player takes 4', () => {
    const battle = createBattle(makePlayer({ ring: { defId: 'mirror-shard' } }), enemy, 1);
    const r = resolveRound(battle, 'fight', seqRng([d20(20), 0.5, d20(1)]));
    expect(r.state.player.hp).toBe(6); // 10 - 4
    expect(r.state.enemy.hp).toBe(29); // 30 - 0(player fumble) - 1(reflect)
    expect(r.events.some((e) => e.kind === 'relic-triggered' && e.trigger === 'onTakeDamage')).toBe(true);
  });

  it('WITHOUT Mirror Shard the enemy loses 0 hp (no reflect)', () => {
    const battle = createBattle(makePlayer(), enemy, 1);
    const r = resolveRound(battle, 'fight', seqRng([d20(20), 0.5, d20(1)]));
    expect(r.state.enemy.hp).toBe(30);
    expect(r.events.some((e) => e.kind === 'relic-triggered')).toBe(false);
  });
});

describe('trigger: onHit — Ash Censer applies burn to the enemy on a weapon hit', () => {
  // Enemy fumbles; player hits with Jaaj Sword (1d6 -> 4). onHit applies burn (no damage).
  it('the enemy gains burn after a player hit', () => {
    const battle = createBattle(makePlayer({ ring: { defId: 'ash-censer' } }), makeEnemy(), 1);
    const r = resolveRound(battle, 'fight', seqRng([d20(1), d20(10), d6(4)]));
    expect(r.state.enemy.hp).toBe(26); // 30 - 4 weapon
    expect(r.state.enemy.activeConditions.some((c) => c.type === 'burn')).toBe(true);
    expect(r.events.some((e) => e.kind === 'relic-triggered' && e.trigger === 'onHit')).toBe(true);
  });
});

describe('trigger: onCrit — a triggered onCrit effect fires only on a crit', () => {
  const critRelic: ItemInstance = {
    defId: 'gen:crit-ring',
    rolled: {
      name: 'Crit Ring',
      rarity: 'Rare',
      slot: 'ring',
      kind: 'trinket',
      effects: [{ type: 'triggered', trigger: 'onCrit', action: { kind: 'dealDamage', params: { amount: 3 } } }],
    },
  };

  it('fires on a crit (weapon crit 1d6+1d6 = 8, + 3 onCrit)', () => {
    // Player crits: two 1d6 damage rolls (4 + 4 = 8), then onCrit adds 3.
    const battle = createBattle(makePlayer({ ring: critRelic }), makeEnemy(), 1);
    const r = resolveRound(battle, 'fight', seqRng([d20(1), d20(20), d6(4), d6(4)]));
    expect(r.state.enemy.hp).toBe(19); // 30 - 8 - 3
    expect(r.events.some((e) => e.kind === 'relic-triggered' && e.trigger === 'onCrit')).toBe(true);
  });

  it('does NOT fire on an ordinary hit', () => {
    const battle = createBattle(makePlayer({ ring: critRelic }), makeEnemy(), 1);
    const r = resolveRound(battle, 'fight', seqRng([d20(1), d20(10), d6(4)]));
    expect(r.state.enemy.hp).toBe(26); // 30 - 4, no onCrit bonus
    expect(r.events.some((e) => e.kind === 'relic-triggered')).toBe(false);
  });
});

describe('trigger: onCast — Doubling Glass adds flat damage on a cast', () => {
  it('casting Intimidate deals its 1 + 2 from Doubling Glass', () => {
    const battle = createBattle(makePlayer({ ring: { defId: 'doubling-glass' } }), makeEnemy(), 1);
    const r = resolveRound(battle, { kind: 'cast', skillId: 'intimidate' }, seqRng([d20(1)]));
    expect(r.state.enemy.hp).toBe(27); // 30 - (1 skill + 2 onCast)
    expect(r.events.some((e) => e.kind === 'relic-triggered' && e.trigger === 'onCast')).toBe(true);
  });
});

describe('trigger: onKill — Devourer\'s Maw steals STR permanently (anchor)', () => {
  it('STR 14 -> 15 on the first kill, -> 16 (mod +3) on the second', () => {
    // Kill an enemy at 1 hp with a Jaaj Sword hit (1d6 -> 4). Victory draws: extra-rest (0.99 ->
    // none) then the loot gate (0.5 >= act-1 dropChance 0.5 -> no drop). M7: gold -> loot roll.
    const seq = () => seqRng([d20(1), d20(10), d6(4), 0.99, 0.5]);
    const battle1 = createBattle(makePlayer({ amulet: { defId: 'devourers-maw' } }), makeEnemy({ hp: 1 }), 1);
    const r1 = resolveRound(battle1, 'fight', seq());
    expect(r1.status).toBe('player-won');
    expect(r1.state.player.stats.STR).toBe(15);
    expect(r1.state.player.mods.STR).toBe(computeStatMod(15)); // +2

    // Reuse the STR-15 player in a fresh battle; a second kill -> STR 16, mod +3.
    const battle2 = createBattle(r1.state.player, makeEnemy({ hp: 1 }), 1);
    const r2 = resolveRound(battle2, 'fight', seq());
    expect(r2.state.player.stats.STR).toBe(16);
    expect(r2.state.player.mods.STR).toBe(3); // computeStatMod(16) = 3
  });
});

describe('trigger: startOfBattle (openBattle) — Clear Sight / Choir\'s Blessing / Grace-Forged Aegis', () => {
  it('Clear Sight grants Lucid (wise) at battle start', () => {
    const battle = createBattle(makePlayer({ ring: { defId: 'clear-sight' } }), makeEnemy(), 1);
    const opened = openBattle(battle);
    expect(opened.battle.player.activeConditions.some((c) => c.type === 'wise')).toBe(true);
    expect(opened.events.some((e) => e.kind === 'relic-triggered' && e.trigger === 'startOfBattle')).toBe(true);
  });

  it('Choir\'s Blessing grants regeneration at battle start', () => {
    const battle = createBattle(makePlayer({ amulet: { defId: 'choirs-blessing' } }), makeEnemy(), 1);
    const opened = openBattle(battle);
    expect(opened.battle.player.activeConditions.some((c) => c.type === 'regeneration')).toBe(true);
  });

  it('Grace-Forged Aegis grants a 5-point shield at battle start', () => {
    const battle = createBattle(makePlayer({ amulet: { defId: 'grace-forged-aegis' } }), makeEnemy(), 1);
    const opened = openBattle(battle);
    expect(opened.battle.player.shield).toBe(5);
    expect(opened.events.some((e) => e.kind === 'shield-gained')).toBe(true);
  });

  it('openBattle is a no-op (same battle, no events) for a relic-less player', () => {
    const battle = createBattle(makePlayer(), makeEnemy(), 1);
    const opened = openBattle(battle);
    expect(opened.events).toEqual([]);
    expect(opened.battle).toBe(battle); // same reference — byte-identical open
  });
});

// ---------------------------------------------------------------------------
// The remaining seed relics + uniques through the real path.
// ---------------------------------------------------------------------------

describe('Overclock Chip — cuts a skill\'s effective charge cost by 1', () => {
  it('a cost-2 skill casts on 1 charge WITH the chip (and ends at 0 charges)', () => {
    const player = makePlayer({ ring: { defId: 'overclock-chip' } }, { skillCharges: 1 });
    const battle = createBattle(player, makeEnemy(), 1);
    const r = resolveRound(battle, { kind: 'cast', skillId: 'heavyStrike' }, seqRng([d20(1)]));
    expect(r.events.some((e) => e.kind === 'cast-unavailable')).toBe(false);
    expect(r.state.player.skillCharges).toBe(0); // 1 - 2 + refund(1)
    expect(r.state.enemy.hp).toBe(27); // 30 - 3 (heavyStrike base, 0 momentum)
  });

  it('WITHOUT the chip the same cast is unavailable (1 < cost 2)', () => {
    const player = makePlayer({}, { skillCharges: 1 });
    const battle = createBattle(player, makeEnemy(), 1);
    const r = resolveRound(battle, { kind: 'cast', skillId: 'heavyStrike' }, seqRng([]));
    expect(r.events).toEqual([{ kind: 'cast-unavailable' }]);
  });
});

describe('Scrap Plating — the first enemy hit each battle deals 0', () => {
  it('round 1 takes 0, round 2 takes the hit', () => {
    // Enemy crits (plain 1*2 = 2) each round. Player fumbles. First hit -> 0, second -> 2.
    const player = makePlayer({ ring: { defId: 'scrap-plating' } });
    const battle = createBattle(player, makeEnemy(), 1);
    const r1 = resolveRound(battle, 'fight', seqRng([d20(20), d20(1)]));
    expect(r1.state.player.hp).toBe(10); // first hit reduced to 0
    expect(r1.state.firstEnemyHitDone).toBe(true);
    const r2 = resolveRound(r1.state, 'fight', seqRng([d20(20), d20(1)]));
    expect(r2.state.player.hp).toBe(8); // 10 - 2 (second hit lands)
  });
});

describe('Adrenal Shunt — +2 damage below half HP', () => {
  it('a hit below 1/2 max HP deals 2 more than without the relic', () => {
    const withRelic = makePlayer({ ring: { defId: 'adrenal-shunt' } }, { hp: 4 }); // 4 < 5 = half of 10
    const without = makePlayer({}, { hp: 4 });
    const seq = () => seqRng([d20(1), d20(10), d6(4)]);
    const a = resolveRound(createBattle(withRelic, makeEnemy(), 1), 'fight', seq());
    const b = resolveRound(createBattle(without, makeEnemy(), 1), 'fight', seq());
    expect(b.state.enemy.hp).toBe(26); // 30 - 4
    expect(a.state.enemy.hp).toBe(24); // 30 - (4 + 2)
  });
});

describe('Grave of Embers — the enemy\'s DoT ticks for double', () => {
  it('an enemy burn deals 2 instead of 1', () => {
    // Enemy carries an ACTIVE burn (remaining 1 of 2): base tick -1, doubled to -2.
    const burn = { type: 'burn' as const, remainingTurns: 1, maxTurns: 2 };
    const seq = () => seqRng([0.5, d20(1), d20(1)]); // burn save, enemy fumble, player fumble
    const withRelic = resolveRound(
      createBattle(makePlayer({ ring: { defId: 'grave-of-embers' } }), makeEnemy({ activeConditions: [burn] }), 1),
      'fight',
      seq(),
    );
    const without = resolveRound(
      createBattle(makePlayer(), makeEnemy({ activeConditions: [burn] }), 1),
      'fight',
      seq(),
    );
    expect(without.state.enemy.hp).toBe(29); // 30 - 1
    expect(withRelic.state.enemy.hp).toBe(28); // 30 - 2 (doubled)
  });
});

describe('Empty Vessel — +1 skill charge on the player\'s turn', () => {
  it('restores one charge (capped at max)', () => {
    const player = makePlayer({ ring: { defId: 'empty-vessel' } }, { skillCharges: 3 });
    const r = resolveRound(createBattle(player, makeEnemy(), 1), 'fight', seqRng([d20(1), d20(1)]));
    expect(r.state.player.skillCharges).toBe(4);
  });
});

describe('Void Pact — +50% damage and cannot heal', () => {
  it('a hit deals floor(damage * 1.5)', () => {
    const seq = () => seqRng([d20(1), d20(10), d6(4)]);
    const a = resolveRound(createBattle(makePlayer({ amulet: { defId: 'void-pact' } }), makeEnemy(), 1), 'fight', seq());
    const b = resolveRound(createBattle(makePlayer(), makeEnemy(), 1), 'fight', seq());
    expect(b.state.enemy.hp).toBe(26); // 30 - 4
    expect(a.state.enemy.hp).toBe(24); // 30 - floor(4 * 1.5) = 30 - 6
  });

  it('blocks the potion heal site', () => {
    const player = makePlayer({ amulet: { defId: 'void-pact' } }, { hp: 3, pots: 2 });
    const r = resolveRound(createBattle(player, makeEnemy(), 1), 'potion', seqRng([]));
    expect(r.events).toEqual([{ kind: 'potion-unavailable' }]);
    expect(r.state.player.hp).toBe(3); // no heal
  });
});

describe('Reliquary — casting heals the caster (onCast)', () => {
  it('a cast heals 3', () => {
    const player = makePlayer({ amulet: { defId: 'reliquary' } }, { hp: 4 });
    const r = resolveRound(createBattle(player, makeEnemy(), 1), { kind: 'cast', skillId: 'intimidate' }, seqRng([d20(1)]));
    expect(r.state.player.hp).toBe(7); // 4 + 3
  });
});

describe('Hollow Heart — charge discount + onCast lifesteal heal', () => {
  it('a cost-2 skill casts on 1 charge and heals 2', () => {
    const player = makePlayer({ amulet: { defId: 'hollow-heart' } }, { hp: 4, skillCharges: 1 });
    const r = resolveRound(createBattle(player, makeEnemy(), 1), { kind: 'cast', skillId: 'heavyStrike' }, seqRng([d20(1)]));
    expect(r.state.player.skillCharges).toBe(0);
    expect(r.state.player.hp).toBe(6); // 4 + 2
    expect(r.state.enemy.hp).toBe(27); // 30 - 3
  });
});

describe('unique: Reflection\'s Edge — bonus damage = enemy condition count (onHit)', () => {
  it('hits for the weapon 1 (UNARMED) + 2 (two enemy conditions)', () => {
    // Enemy carries burn + poison at ONSET (no tick damage/draw this round). Reflection's Edge
    // sits in mainHand: it has no legacy dice, so the player swings UNARMED (1d1 = 1).
    const conds = [
      { type: 'burn' as const, remainingTurns: 2, maxTurns: 2 },
      { type: 'poison' as const, remainingTurns: 2, maxTurns: 2 },
    ];
    const player = makePlayer({ mainHand: { defId: 'reflections-edge' } });
    const battle = createBattle(player, makeEnemy({ activeConditions: conds }), 1);
    const r = resolveRound(battle, 'fight', seqRng([d20(1), d20(10), 0.5]));
    expect(r.state.enemy.hp).toBe(27); // 30 - 1 (UNARMED) - 2 (onHit, 2 conditions)
    expect(r.events.some((e) => e.kind === 'relic-triggered' && e.trigger === 'onHit')).toBe(true);
  });
});

describe('unique: Ashen Crown — +2 INT boosts skill damage', () => {
  it('Intimidate deals 2 with the crown, 1 without', () => {
    const seq = () => seqRng([d20(1)]);
    const a = resolveRound(createBattle(makePlayer({ helmet: { defId: 'ashen-crown' } }), makeEnemy(), 1), { kind: 'cast', skillId: 'intimidate' }, seq());
    const b = resolveRound(createBattle(makePlayer(), makeEnemy(), 1), { kind: 'cast', skillId: 'intimidate' }, seq());
    expect(b.state.enemy.hp).toBe(29); // 30 - 1
    expect(a.state.enemy.hp).toBe(28); // 30 - (1 + 1 from +2 INT -> +1 mod)
  });
});

describe('unique: Hollow Regalia — huge flat AC', () => {
  it('adds 5 AC over the unarmored base', () => {
    // Regalia has no legacy armor stats -> unarmored base (10 + CONmod 0) + flatAc 5 = 15.
    const p = createPlayer({ name: 'Ari', classId: 'Enforcer', stats: STATS });
    const unarmored: Player = {
      ...p,
      inventory: { ...p.inventory, slots: { ...p.inventory.slots, armor: null } },
    };
    const regalia: Player = {
      ...unarmored,
      inventory: {
        ...unarmored.inventory,
        slots: { ...unarmored.inventory.slots, armor: { defId: 'hollow-regalia' } },
      },
    };
    expect(playerArmorClass(unarmored)).toBe(10); // 10 + CONmod 0
    expect(playerArmorClass(regalia)).toBe(15); // 10 + 5 flatAc
  });
});

// ---------------------------------------------------------------------------
// Pipeline-unit checks (the exact functions battle.ts calls) + off-equivalence.
// ---------------------------------------------------------------------------

describe('applyEffectAction — hand-derived unit outcomes', () => {
  it('dealDamage pctOfDamageTaken 25 of 8 = 2', () => {
    const out = applyEffectAction(
      { kind: 'dealDamage', params: { pctOfDamageTaken: 25 } },
      makePlayer(),
      makeEnemy({ hp: 30 }),
      { damageTaken: 8 },
    );
    expect(out.other.hp).toBe(28); // 30 - floor(8*0.25) = 30 - 2
  });

  it('healSelf is blocked when the owner has cannotHeal (Void Pact)', () => {
    const player = makePlayer({ amulet: { defId: 'void-pact' } }, { hp: 4 });
    const out = applyEffectAction({ kind: 'healSelf', params: { amount: 5 } }, player, makeEnemy(), {});
    expect(out.self.hp).toBe(4); // unchanged
  });
});

describe('off-equivalence lockstep — the trigger seam is inert when nothing fires', () => {
  it('a battle with an onKill relic (enemy never dies) is byte-identical to a relic-less battle', () => {
    const SEED = 987654;
    // Devourer's Maw has ONLY an onKill trigger and no passive flags; in a battle where the
    // enemy never dies it must never fire, so both runs must produce identical events, identical
    // rng terminal state, and identical enemy/player HP.
    function run(withRelic: boolean) {
      const player = withRelic ? makePlayer({ amulet: { defId: 'devourers-maw' } }) : makePlayer();
      // A deterministic hand-authored sequence for three fight rounds (enemy hp 100 survives).
      // Each round: enemy d20 (miss/fumble), player d20 (hit), player 1d6.
      const draws = [
        d20(1), d20(10), d6(2),
        d20(1), d20(10), d6(2),
        d20(1), d20(10), d6(2),
      ];
      const rng = seqRng(draws);
      let state: BattleState = createBattle(player, makeEnemy({ hp: 100 }), 1);
      const events = [];
      for (let i = 0; i < 3; i++) {
        const r = resolveRound(state, 'fight', rng);
        state = r.state;
        events.push(...r.events);
      }
      return { state, events };
    }
    void SEED;
    const bare = run(false);
    const geared = run(true);
    expect(geared.events).toEqual(bare.events);
    expect(geared.state.enemy).toEqual(bare.state.enemy);
    expect(geared.state.player.hp).toBe(bare.state.player.hp);
    expect(geared.state.player.stats).toEqual(bare.state.player.stats); // no steal — onKill never fired
    // No M6 event kind leaks into a relic-less/inert run.
    const M6_KINDS = new Set(['relic-triggered', 'shield-gained', 'shield-absorbed', 'revive', 'stat-stolen', 'consumable-used']);
    expect(bare.events.some((e) => M6_KINDS.has(e.kind))).toBe(false);
    expect(geared.events.some((e) => M6_KINDS.has(e.kind))).toBe(false);
  });
});

describe('Halo Fragment revive (anchor) — once per battle', () => {
  it('lethal damage revives to 25% max HP; a second lethal hit kills', () => {
    // maxHp 40 (effective, CON10), hp 3. Enemy pyroBall crit deals 4 -> lethal. Revive -> floor(40*0.25)=10.
    const player = makePlayer({ amulet: { defId: 'halo-fragment' } }, { hp: 3, maxHp: 40 });
    // Two charges so BOTH rounds land a pyroBall crit (4 damage); round 1 spends one, round 2 the other.
    const enemy = makeEnemy({ hp: 30, skillCharges: 2, maxSkillCharges: 2, skillPool: ['pyroBall'] });
    const r1 = resolveRound(createBattle(player, enemy, 1), 'fight', seqRng([d20(20), 0.5, d20(1)]));
    expect(r1.status).toBe('ongoing');
    expect(r1.state.player.hp).toBe(10); // revived
    expect(r1.state.reviveUsed).toBe(true);
    expect(r1.events.some((e) => e.kind === 'revive')).toBe(true);

    // Drop the player low again; the revive is spent, so the next lethal hit is fatal.
    const wounded: BattleState = { ...r1.state, player: { ...r1.state.player, hp: 3 } };
    const r2 = resolveRound(wounded, 'fight', seqRng([d20(20), 0.5, d20(1)]));
    expect(r2.status).toBe('player-died');
  });
});
