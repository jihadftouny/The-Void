import { describe, it, expect } from 'vitest';
import {
  displayPlayer,
  castOptions,
  consumableOptions,
  spareOffered,
  displayItem,
  describeInventory,
  equipFromBackpack,
  unequipSlot,
  characterSheet,
  dealView,
  draftCards,
  chestReveal,
} from './view-model.ts';
import { createGame } from '../game/game.ts';
import type { GameState } from '../game/game.ts';
import { createPlayer } from '../game/player.ts';
import type { Player } from '../game/player.ts';
import { buildRandomBattle } from '../game/encounter.ts';
import { createBattle } from '../game/battle.ts';
import { generateEnemy } from '../game/enemy.ts';
import { pickUp } from '../game/equipment.ts';
import { playerArmorClass } from '../game/defense.ts';
import { createRng } from '../game/rng.ts';
import { STAT_KEYS } from '../game/character.ts';
import type { Stats } from '../game/character.ts';
import type { ItemInstance } from '../game/item.ts';
import type { SacrificeDeal } from '../game/deal.ts';
import type { DraftOption } from '../game/draft.ts';
import { createKarma } from '../game/karma.ts';

// A whole, undamaged Enforcer with fixed stats. Every stat is 10 → each modifier
// floor((10-10)/2) = 0, so for the Enforcer's d10 hit die maxHp = 10 + 0 = 10 and
// starting hp = maxHp. Deriving the snapshot this way makes "hp === maxHp" a real,
// undamaged character — so the mid-battle value 3 below is a concrete contrast, not
// a number copied from the implementation.
const fixedStats = STAT_KEYS.reduce((acc, k) => {
  acc[k] = 10;
  return acc;
}, {} as Stats);
const snapshot = createPlayer({ name: 'Test', classId: 'Enforcer', stats: fixedStats });

describe('displayPlayer (desktop view-model)', () => {
  it('is a whole, undamaged snapshot to begin with', () => {
    // Independent sanity anchor: full hp, and full hp is NOT 3.
    expect(snapshot.hp).toBe(snapshot.maxHp);
    expect(snapshot.maxHp).toBe(10);
    expect(snapshot.hp).not.toBe(3);
  });

  it('returns the LIVE battle combatant (damaged hp), not the pre-battle snapshot', () => {
    const { rng } = createRng(42);
    const battle = buildRandomBattle(snapshot, 1, rng);
    // Simulate mid-battle damage: the live combatant's hp drops to a fixed value
    // that differs from the undamaged snapshot's hp.
    const damaged = { ...battle, player: { ...battle.player, hp: 3 } };
    const state: GameState = {
      version: 8,
      rngState: 0,
      player: snapshot,
      act: 1,
      place: 0,
      karma: createKarma(),
      phase: { kind: 'battle', battle: damaged, started: true, final: false },
    };
    const shown = displayPlayer(state);
    expect(shown!.hp).toBe(3);
    // Because 3 differs from the snapshot's full hp, an implementation that wrongly
    // returned state.player would fail here.
    expect(shown!.hp).not.toBe(snapshot.hp);
  });

  it('returns the snapshot object outside battle', () => {
    const state: GameState = {
      version: 8,
      rngState: 0,
      player: snapshot,
      act: 1,
      place: 0,
      karma: createKarma(),
      phase: { kind: 'main-menu' },
    };
    expect(displayPlayer(state)).toBe(state.player);
  });

  it('returns null before a player exists (title)', () => {
    const state = createGame(123);
    expect(state.player).toBeNull();
    expect(displayPlayer(state)).toBeNull();
  });
});

// A GameState wrapping a given player at the hub (main-menu). Fixed scalars mirror the
// existing helper above; only `player`/`phase` vary across the cases below.
function hub(player: Player | null): GameState {
  return {
    version: 8,
    rngState: 0,
    player,
    act: 1,
    place: 0,
    karma: createKarma(),
    phase: { kind: 'main-menu' },
  };
}

// Recursively collect every property key in a produced display object — the karma-hidden
// invariant scan. Independent of the impl: it just walks the returned plain data.
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

describe('castOptions (battle Cast picker)', () => {
  // Hand-derived from classKit.coreSkills (Enforcer -> ['heavyStrike','brace']) and skill.ts:
  //   heavyStrike.chargeCost === 2, brace.chargeCost === 1. A fresh player banks 5 charges.
  it('lists the Enforcer core skills with names, costs, and affordability at full charges', () => {
    expect(snapshot.skillCharges).toBe(5);
    expect(castOptions(snapshot)).toEqual([
      { skillId: 'heavyStrike', name: 'Heavy Strike', chargeCost: 2, affordable: true },
      { skillId: 'brace', name: 'Brace', chargeCost: 1, affordable: true },
    ]);
  });

  it('marks a 2-cost skill unaffordable at 1 charge but keeps the 1-cost skill affordable', () => {
    const lowCharge: Player = { ...snapshot, skillCharges: 1 };
    expect(castOptions(lowCharge)).toEqual([
      { skillId: 'heavyStrike', name: 'Heavy Strike', chargeCost: 2, affordable: false },
      { skillId: 'brace', name: 'Brace', chargeCost: 1, affordable: true },
    ]);
  });

  it('is empty for a player with no skills', () => {
    expect(castOptions({ ...snapshot, skillPool: [] })).toEqual([]);
  });
});

describe('consumableOptions (battle Use-item picker)', () => {
  // Antidote is a usable (consumables.json: name "Antidote", rarity "Common", non-empty `use`).
  // "Jaaj Sword 1" is legacy gear with no `use`, so it is excluded.
  it('includes only usable consumables, carrying the backpack index as source', () => {
    const backpack: ItemInstance[] = [{ defId: 'antidote' }, { defId: 'Jaaj Sword 1' }];
    const player: Player = {
      ...snapshot,
      inventory: { slots: snapshot.inventory.slots, backpack },
    };
    expect(consumableOptions(player)).toEqual([{ index: 0, name: 'Antidote', rarity: 'Common' }]);
  });

  it('is empty for an empty backpack', () => {
    expect(consumableOptions(snapshot)).toEqual([]);
  });
});

describe('spareOffered (battle Spare gate)', () => {
  const { rng } = createRng(7);
  // The legacy path yields karmaWeighted:false; build both enemy kinds independently by
  // overriding that one flag (spareAvailable reads only karmaWeighted && hp > 0).
  const baseEnemy = generateEnemy({ act: 1, playerXp: 0 }, rng);
  const weightedAlive = { ...baseEnemy, karmaWeighted: true, hp: 10 };
  const weightedDead = { ...baseEnemy, karmaWeighted: true, hp: 0 };
  const plainEnemy = { ...baseEnemy, karmaWeighted: false, hp: 10 };

  function battlePhase(enemy: typeof baseEnemy, started: boolean): GameState {
    return { ...hub(snapshot), phase: { kind: 'battle', battle: createBattle(snapshot, enemy, 1), started, final: false } };
  }

  it('is true for a started battle vs a living karma-weighted enemy', () => {
    expect(spareOffered(battlePhase(weightedAlive, true))).toBe(true);
  });
  it('is false when the karma-weighted enemy is dead', () => {
    expect(spareOffered(battlePhase(weightedDead, true))).toBe(false);
  });
  it('is false for a non-weighted enemy', () => {
    expect(spareOffered(battlePhase(plainEnemy, true))).toBe(false);
  });
  it('is false for an un-started battle', () => {
    expect(spareOffered(battlePhase(weightedAlive, false))).toBe(false);
  });
  it('is false outside battle', () => {
    expect(spareOffered(hub(snapshot))).toBe(false);
  });
});

describe('displayItem / describeInventory (inventory screen)', () => {
  it("shows the fresh Enforcer's paperdoll gear, empty elsewhere, empty backpack", () => {
    const view = describeInventory(snapshot);
    const bySlot = Object.fromEntries(view.slots.map((s) => [s.slot, s.item]));
    expect(bySlot.mainHand?.name).toBe('Jaaj Sword 1');
    expect(bySlot.armor?.name).toBe('Jooj Armor 1');
    expect(bySlot.helmet).toBeNull();
    expect(bySlot.offHand).toBeNull();
    expect(view.backpack).toEqual([]);
  });

  it('projects a rolled item by its rolled name/rarity/kind/slot', () => {
    const rolled: ItemInstance = {
      defId: 'gen-1',
      rolled: { name: 'Whispering Band', rarity: 'Rare', slot: 'ring', kind: 'trinket', effects: [] },
    };
    expect(displayItem(rolled)).toEqual({
      defId: 'gen-1',
      name: 'Whispering Band',
      rarity: 'Rare',
      kind: 'trinket',
      slot: 'ring',
      effects: [],
    });
  });
});

describe('equipFromBackpack / unequipSlot (pure action-mapping)', () => {
  // Fresh Enforcer, then pick up a second armor into the backpack (index 0).
  const withLooseArmor: Player = { ...snapshot, inventory: pickUp(snapshot.inventory, { defId: 'Jaaj Armor 1' }) };
  const state = hub(withLooseArmor);

  it('swaps the equipped armor: new armor in slot, displaced armor back to backpack', () => {
    const r = equipFromBackpack(state, 0);
    expect(r.ok).toBe(true);
    expect(r.state.player!.inventory.slots.armor?.defId).toBe('Jaaj Armor 1');
    expect(r.state.player!.inventory.backpack).toHaveLength(1);
    expect(r.state.player!.inventory.backpack[0]?.defId).toBe('Jooj Armor 1');
    // Original state untouched (pure).
    expect(state.player!.inventory.slots.armor?.defId).toBe('Jooj Armor 1');
  });

  it('unequips a slot back to the backpack', () => {
    const equipped = equipFromBackpack(state, 0).state;
    const r = unequipSlot(equipped, 'armor');
    expect(r.ok).toBe(true);
    expect(r.state.player!.inventory.slots.armor).toBeNull();
    const defs = r.state.player!.inventory.backpack.map((i) => i.defId).sort();
    expect(defs).toEqual(['Jaaj Armor 1', 'Jooj Armor 1']);
  });

  it('is a no-op (ok:false, state unchanged) on a bad index', () => {
    const r = equipFromBackpack(state, 99);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(state);
  });

  it('is a no-op (ok:false) unequipping an empty slot', () => {
    const r = unequipSlot(state, 'helmet');
    expect(r.ok).toBe(false);
    expect(r.state).toBe(state);
  });

  it('is a no-op with no player', () => {
    expect(equipFromBackpack(hub(null), 0).ok).toBe(false);
    expect(unequipSlot(hub(null), 'armor').ok).toBe(false);
  });
});

describe('characterSheet', () => {
  // Fresh Enforcer, every stat 10 -> mod 0. d10 hit die: maxHp = 10 + 0 = 10, hp = maxHp.
  // AC from Jooj Armor 1 (baseArmor 11, dexCap 2): 11 + CONmod(0) + min(DEXmod 0, 2) = 11
  // — the armored value, NOT the stored unarmored 10.
  const sheet = characterSheet(snapshot);

  it('reports level/xp/hp and the gear-derived armor class', () => {
    expect(sheet.level).toBe(1);
    expect(sheet.xp).toBe(0);
    expect(sheet.hp).toBe(10);
    expect(sheet.maxHp).toBe(10);
    expect(sheet.skillCharges).toBe(5);
    expect(sheet.maxSkillCharges).toBe(5);
    expect(sheet.armorClass).toBe(11);
    expect(sheet.armorClass).toBe(playerArmorClass(snapshot));
    expect(sheet.armorClass).not.toBe(10); // not the stored unarmored score
  });

  it('lists six stats each score 10 mod 0', () => {
    expect(sheet.stats).toEqual(STAT_KEYS.map((key) => ({ key, score: 10, mod: 0 })));
  });

  it('lists the resolved skills with charge costs', () => {
    expect(sheet.skills).toEqual([
      { skillId: 'heavyStrike', name: 'Heavy Strike', chargeCost: 2 },
      { skillId: 'brace', name: 'Brace', chargeCost: 1 },
    ]);
  });

  it('shows equipped gear names per slot', () => {
    const bySlot = Object.fromEntries(sheet.equipped.map((e) => [e.slot, e.name]));
    expect(bySlot.mainHand).toBe('Jaaj Sword 1');
    expect(bySlot.armor).toBe('Jooj Armor 1');
    expect(bySlot.helmet).toBeNull();
  });

  it('exposes the Enforcer build resource (momentum), NOT karma', () => {
    expect(sheet.resource).toEqual({ kind: 'momentum', value: 0 });
  });

  it('emits NO karma / Nature field anywhere in the sheet', () => {
    const keys = allKeys(sheet).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.includes('karma') || k.includes('nature'))).toBe(false);
  });
});

describe('dealView (cost -> reward only, pool hidden)', () => {
  // Hand-derived: describeCost({hp,3}) === "3 HP"; describeReward({heal,5}) === "5 HP restored".
  const deal: SacrificeDeal = { pool: 'grace', cost: { kind: 'hp', amount: 3 }, reward: { kind: 'heal', amount: 5 } };

  it('renders the cost and reward text', () => {
    expect(dealView(deal)).toEqual({ cost: '3 HP', reward: '5 HP restored' });
  });

  it('never leaks the karma-derived pool (key or value)', () => {
    const view = dealView(deal);
    expect(Object.keys(view)).not.toContain('pool');
    // The pool value 'grace' must not appear anywhere in the serialized view.
    expect(JSON.stringify(view)).not.toContain('grace');
    expect(JSON.stringify(view).toLowerCase()).not.toContain('pool');
  });
});

describe('draftCards', () => {
  // Hand-derived labels: stat -> "+1 STR" / "+1 DEX"; skill intimidate -> "Learn Intimidate".
  const offers: DraftOption[] = [
    { kind: 'stat', stat: 'STR' },
    { kind: 'stat', stat: 'DEX' },
    { kind: 'skill', skillId: 'intimidate' },
  ];
  it('projects each offer to an indexed readable card', () => {
    expect(draftCards(offers)).toEqual([
      { index: 0, label: '+1 STR' },
      { index: 1, label: '+1 DEX' },
      { index: 2, label: 'Learn Intimidate' },
    ]);
  });
});

describe('chestReveal', () => {
  it('projects each rolled instance to a name + rarity row', () => {
    const loot: ItemInstance[] = [
      { defId: 'a', rolled: { name: 'Ashen Ring', rarity: 'Rare', slot: 'ring', kind: 'trinket', effects: [] } },
      { defId: 'b', rolled: { name: 'Void Plate', rarity: 'Legendary', slot: 'armor', kind: 'armor', effects: [] } },
    ];
    expect(chestReveal(loot)).toEqual([
      { name: 'Ashen Ring', rarity: 'Rare' },
      { name: 'Void Plate', rarity: 'Legendary' },
    ]);
  });
});