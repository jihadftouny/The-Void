// M6 step 5 — the use-consumable battle action across the five §6 categories, through the
// REAL action ({kind:'useConsumable'}) on resolveRound. Every expected value is hand-derived
// from the consumable's `use` array in consumables.json and the effect arithmetic — never read
// back from code. Using a consumable draws NO rng and grants the enemy no turn, so most rounds
// pass an empty seqRng (which throws if the code draws), proving the no-draw / no-counter rule.

import { describe, expect, it } from 'vitest';
import { resolveRound, createBattle } from './battle.ts';
import { createPlayer, type Player } from './player.ts';
import { computeStatMods, type Stats } from './character.ts';
import { type Enemy } from './enemy.ts';
import { type Rng } from './rng.ts';
import { type ItemInstance } from './item.ts';
import { type ActiveCondition, type ConditionType } from './condition.ts';

function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted at draw ${i} (unexpected draw)`);
    return values[i++]!;
  };
}

const STATS: Stats = { STR: 14, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };

function makePlayer(over: Partial<Player> = {}, backpack: ItemInstance[] = []): Player {
  const p = createPlayer({ name: 'Ari', classId: 'Enforcer', stats: STATS });
  return { ...p, inventory: { ...p.inventory, backpack }, ...over };
}

function makeEnemy(over: Partial<Enemy> = {}): Enemy {
  const stats: Stats = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
  return {
    name: 'Beast', type: 'Beast', fullName: 'Beast', stats, mods: computeStatMods(stats),
    hp: 30, maxHp: 30, xp: 1, armorClass: 10, skillCharges: 0, maxSkillCharges: 2,
    hitDie: { quantity: 1, sides: 8 }, resistances: [0, 0, 0, 0, 0, 0, 0], skillPool: [], activeConditions: [],
    familyId: 'Beast', karmaWeighted: false,
    ...over,
  };
}

const cond = (type: ConditionType): ActiveCondition => ({ type, remainingTurns: 2, maxTurns: 2 });

/** Use the backpack item at index 0. */
function use0(player: Player, enemy: Enemy, draws: number[] = []) {
  return resolveRound(createBattle(player, enemy, 1), { kind: 'useConsumable', source: { index: 0 } }, seqRng(draws));
}

describe('heals category', () => {
  it('Void Draught restores to full (pctMaxHp 100) and consumes the item', () => {
    const r = use0(makePlayer({ hp: 3, maxHp: 10 }, [{ defId: 'void-draught' }]), makeEnemy());
    expect(r.state.player.hp).toBe(10);
    expect(r.state.player.inventory.backpack.length).toBe(0);
    expect(r.events.some((e) => e.kind === 'consumable-used')).toBe(true);
    expect(r.status).toBe('ongoing');
  });

  it('Suture Kit cures bleed and heals 4', () => {
    const r = use0(makePlayer({ hp: 4, maxHp: 20, activeConditions: [cond('bleed')] }, [{ defId: 'suture-kit' }]), makeEnemy());
    expect(r.state.player.activeConditions.some((c) => c.type === 'bleed')).toBe(false);
    expect(r.state.player.hp).toBe(8); // 4 + 4
  });
});

describe('cures category', () => {
  it('Antidote cures poison via the real cure path', () => {
    const r = use0(makePlayer({ activeConditions: [cond('poison')] }, [{ defId: 'antidote' }]), makeEnemy());
    expect(r.state.player.activeConditions.some((c) => c.type === 'poison')).toBe(false);
  });

  it('Cleansing Ash removes deprivations (weak + slow)', () => {
    const r = use0(makePlayer({ activeConditions: [cond('weak'), cond('slow')] }, [{ defId: 'cleansing-ash' }]), makeEnemy());
    expect(r.state.player.activeConditions.length).toBe(0);
  });
});

describe('buffs category', () => {
  it('Stimpack applies Strong + Quick', () => {
    const r = use0(makePlayer({}, [{ defId: 'stimpack' }]), makeEnemy());
    const types = r.state.player.activeConditions.map((c) => c.type);
    expect(types).toContain('strong');
    expect(types).toContain('quick');
  });

  it('Focus Serum applies Sharp (smart) and restores 2 charges', () => {
    const r = use0(makePlayer({ skillCharges: 1 }, [{ defId: 'focus-serum' }]), makeEnemy());
    expect(r.state.player.activeConditions.some((c) => c.type === 'smart')).toBe(true);
    expect(r.state.player.skillCharges).toBe(3); // 1 + 2 (capped at max 5)
  });
});

describe('throwables category', () => {
  it('Firebomb deals 6 Pyro and applies burn to the enemy', () => {
    const r = use0(makePlayer({}, [{ defId: 'firebomb' }]), makeEnemy({ hp: 30 }));
    expect(r.state.enemy.hp).toBe(24); // 30 - 6
    expect(r.state.enemy.activeConditions.some((c) => c.type === 'burn')).toBe(true);
  });

  it('Cryo Grenade deals 4 Cryo and applies freeze', () => {
    const r = use0(makePlayer({}, [{ defId: 'cryo-grenade' }]), makeEnemy({ hp: 30 }));
    expect(r.state.enemy.hp).toBe(26); // 30 - 4
    expect(r.state.enemy.activeConditions.some((c) => c.type === 'freeze')).toBe(true);
  });

  it('a throwable that kills the enemy resolves to victory (rewards rolled)', () => {
    // Enemy at 1 hp; Firebomb (6) kills. killAndVictory draws extra-rest (0.99 -> none) then the
    // loot gate (0.5 >= act-1 dropChance 0.5 -> no drop). M7: gold draw replaced by loot roll.
    const r = use0(makePlayer({}, [{ defId: 'firebomb' }]), makeEnemy({ hp: 1, xp: 1 }), [0.99, 0.5]);
    expect(r.status).toBe('player-won');
  });
});

describe('utility category', () => {
  it('Smoke Vial flees the battle (guaranteed)', () => {
    const r = use0(makePlayer({}, [{ defId: 'smoke-vial' }]), makeEnemy());
    expect(r.status).toBe('fled');
  });

  it('Lodestone is used (reroll hook) with no state damage', () => {
    const r = use0(makePlayer({}, [{ defId: 'lodestone' }]), makeEnemy({ hp: 30 }));
    expect(r.status).toBe('ongoing');
    expect(r.state.enemy.hp).toBe(30);
    expect(r.events.some((e) => e.kind === 'consumable-used' && e.itemId === 'lodestone')).toBe(true);
  });
});

describe('unavailable + potion off-equivalence', () => {
  it('an empty backpack index is unavailable (state unchanged, no draw)', () => {
    const player = makePlayer({ hp: 5 }, []);
    const r = use0(player, makeEnemy());
    expect(r.events).toEqual([{ kind: 'consumable-unavailable' }]);
    expect(r.state.player.hp).toBe(5);
  });

  it('the legacy potion action is byte-identical (heals to cap, no new events)', () => {
    const player = makePlayer({ hp: 3, maxHp: 10, pots: 2 });
    const r = resolveRound(createBattle(player, makeEnemy(), 1), 'potion', seqRng([]));
    expect(r.events).toEqual([{ kind: 'potion-drunk', healedTo: 10 }]);
    expect(r.state.player.hp).toBe(10);
    expect(r.state.player.pots).toBe(1);
  });
});

// ------- G28(d) — clarity-draught can finally be used -----------------------------------------

describe('G28(d) — the Clarity Draught does what it advertises', () => {
  it('heals 8 and is consumed, instead of being permanently unusable', () => {
    // `items.json`'s `clarity-draught` was `kind: "usable"` with NO `use` array, so
    // `applyConsumable` bailed with `consumable-unavailable` on every attempt — while the item
    // still advertised "Heal 8 HP" through its `effects` entry. It now carries the matching
    // `use: [{ healSelf, amount: 8 }]`.
    const player = makePlayer({ hp: 5, maxHp: 30 }, [{ defId: 'clarity-draught' }]);
    const battle = createBattle(player, makeEnemy(), 1);
    const r = resolveRound(battle, { kind: 'useConsumable', source: { index: 0 } }, seqRng([]));
    expect(r.status).toBe('ongoing');
    expect(r.state.player.hp).toBe(13); // 5 + 8, well under the 30 cap
    expect(r.state.player.inventory.backpack).toEqual([]); // consumed
    expect(r.events).toContainEqual({ kind: 'consumable-used', itemId: 'clarity-draught' });
    expect(r.events.some((e) => e.kind === 'consumable-unavailable')).toBe(false);
  });

  it('its heal is still capped at effective max HP', () => {
    const player = makePlayer({ hp: 9, maxHp: 10 }, [{ defId: 'clarity-draught' }]);
    const battle = createBattle(player, makeEnemy(), 1);
    const r = resolveRound(battle, { kind: 'useConsumable', source: { index: 0 } }, seqRng([]));
    expect(r.state.player.hp).toBe(10);
  });
});
