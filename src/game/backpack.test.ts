// The backpack's capacity, the potion fold-in, and the full-pack bargain (PLAN.md #2, AC-23;
// plan Appendix A.3 — the author's ruling that OVERRIDES the plan body).
//
// The rulings under test:
//   - §22.6: potions FOLD INTO consumables — no `pots`, no Potion action; a small kit instead.
//   - §22.17: the backpack holds N = 12 items.
//   - A.3: accepting a bargain with a full pack OPENS THE PACK for a discard; the reward is never
//     lost; backing out is exactly refusing; the price is never charged before the reward is
//     placed; the discard goes through `step`, atomically.

import { describe, it, expect } from 'vitest';
import { BACKPACK_CAPACITY, canCarry } from './inventory.ts';
import { pickUp, unequip } from './equipment.ts';
import { createPlayer, STARTING_CONSUMABLES, type Player } from './player.ts';
import { applyDeal, needsRoom, type SacrificeDeal } from './deal.ts';
import { step, type GameState } from './game.ts';
import { selectEncounter } from './encounter.ts';
import { createKarma } from './karma.ts';
import { createRng, mulberry32 } from './rng.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { createBattle } from './battle.ts';
import { encodeSave, decodeSave } from './save.ts';
import { type ItemInstance } from './item.ts';
import { type Stats } from './character.ts';

const STATS: Stats = { STR: 16, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 };

function hero(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: STATS }), ...overrides };
}

/** `n` distinct loose items (Common rings named by number), so every index is identifiable. */
function trinkets(n: number): ItemInstance[] {
  return Array.from({ length: n }, (_, i) => ({
    defId: `gen:Common:ring`,
    rolled: { name: `Ring ${i}`, rarity: 'Common' as const, slot: 'ring' as const, kind: 'trinket' as const, effects: [] },
  }));
}

function withPack(p: Player, backpack: ItemInstance[]): Player {
  return { ...p, inventory: { ...p.inventory, backpack } };
}

function hub(player: Player, rngState = 1, place = 0): GameState {
  return { version: 9, rngState, player, act: place + 1, place, karma: createKarma(), phase: { kind: 'main-menu' } };
}

/** A Legendary weapon the bargain pays — an item reward, so a full pack must make room. */
const LEGENDARY: ItemInstance = {
  defId: 'gen:Legendary:mainHand',
  rolled: { name: 'Legendary mainHand', rarity: 'Legendary', slot: 'mainHand', kind: 'weapon', effects: [] },
};
const GREED_FOR_LEGENDARY: SacrificeDeal = { pool: 'tempting', cost: { kind: 'greed' }, reward: { kind: 'item', instance: LEGENDARY } };

function atDeal(player: Player, deal: SacrificeDeal, rngState = 5): GameState {
  return { ...hub(player, rngState), phase: { kind: 'deal', deal } };
}

// ------- §22.6: no potions, a starting kit ------------------------------------------------

describe('§22.6 — potions folded into consumables', () => {
  it('a fresh player has no potion counter and carries the kit in the backpack', () => {
    const p = hero();
    expect('pots' in p).toBe(false);
    expect(p.inventory.backpack).toEqual(STARTING_CONSUMABLES.map((defId) => ({ defId })));
    expect(STARTING_CONSUMABLES).toEqual(['void-draught', 'suture-kit']);
  });
});

// ------- §22.17: twelve slots --------------------------------------------------------------

describe('§22.17 — the backpack holds twelve', () => {
  it('BACKPACK_CAPACITY is 12, and canCarry counts to it', () => {
    expect(BACKPACK_CAPACITY).toBe(12);
    const inv = withPack(hero(), trinkets(11)).inventory;
    expect(canCarry(inv)).toBe(true);
    expect(canCarry(inv, 2)).toBe(false);
  });

  it('a 13th pickUp is refused and the SAME inventory comes back', () => {
    const inv = withPack(hero(), trinkets(12)).inventory;
    expect(pickUp(inv, { defId: 'antidote' })).toBe(inv);
    const room = withPack(hero(), trinkets(11)).inventory;
    expect(pickUp(room, { defId: 'antidote' }).backpack).toHaveLength(12);
  });

  it('unequipping into a full pack is refused (the item would have nowhere to go)', () => {
    const full = withPack(hero(), trinkets(12)).inventory;
    expect(unequip(full, 'armor')).toEqual({ inventory: full, ok: false });
  });
});

describe('a full pack leaves found loot behind, and says so (AC-23)', () => {
  /** A 1-HP enemy any hit kills, so the step's victory block runs. */
  const oneHp = (): Enemy => ({
    ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(2)),
    hp: 1, armorClass: 1, skillPool: [], skillCharges: 0,
  });
  function fightAt(player: Player, seed: number) {
    const state: GameState = { ...hub(player, seed), phase: { kind: 'battle', battle: createBattle(player, oneHp(), 1), started: true, final: false } };
    return step(state, { kind: 'battle-action', action: 'fight' });
  }

  it('a victory drop: the SAME drop is taken with room and left behind with none', () => {
    // The drop is ROLLED either way (the victory draws do not depend on the pack), so the room
    // run tells us what the full run must leave behind — found by a seed sweep, not assumed.
    let checked = 0;
    for (let seed = 1; seed <= 200 && checked < 3; seed++) {
      const roomy = fightAt(withPack(hero(), trinkets(11)), seed);
      const victory = roomy.events.find((e) => e.kind === 'victory');
      if (!victory || victory.kind !== 'victory' || victory.loot.length === 0) continue;
      const full = fightAt(withPack(hero(), trinkets(12)), seed);
      const fullVictory = full.events.find((e) => e.kind === 'victory');
      expect(fullVictory).toMatchObject({ loot: [] });
      expect(full.events).toContainEqual({ kind: 'loot-left-behind', name: victory.loot[0]!.name, rarity: victory.loot[0]!.rarity });
      expect(full.state.player!.inventory.backpack).toHaveLength(12);
      expect(full.state.rngState).toBe(roomy.state.rngState); // no draw moved
      checked += 1;
    }
    expect(checked).toBe(3); // non-vacuity
  });

  it('a chest: its item stays in the cache when the pack is full', () => {
    let seed = 0;
    while (selectEncounter(createRng(seed).rng, 1) !== 'chest') seed += 1;
    const r = step(hub(withPack(hero({ xp: 0 }), trinkets(12)), seed), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase.kind).toBe('chest');
    expect(r.events.some((e) => e.kind === 'loot-left-behind')).toBe(true);
    expect(r.state.player!.inventory.backpack).toHaveLength(12);
  });
});

describe('a hub discard is an ENGINE input (PLAN.md #2)', () => {
  it('removes exactly the chosen index, says what was left, and draws nothing', () => {
    const p = withPack(hero(), trinkets(3));
    const s = hub(p, 77);
    const r = step(s, { kind: 'discard', index: 1 });
    expect(r.state.phase.kind).toBe('main-menu');
    expect(r.state.player!.inventory.backpack.map((i) => i.rolled?.name)).toEqual(['Ring 0', 'Ring 2']);
    expect(r.events).toEqual([{ kind: 'item-discarded', name: 'Ring 1', rarity: 'Common' }]);
    expect(r.state.rngState).toBe(77);
  });

  it('a bad index — out of range, negative, fractional, NaN — is a rejected no-op', () => {
    const s = hub(withPack(hero(), trinkets(3)));
    for (const index of [3, -1, 1.5, Number.NaN]) {
      expect(step(s, { kind: 'discard', index }).state, `${index}`).toBe(s);
    }
  });
});

// ------- Appendix A.3: the full-pack bargain -----------------------------------------------

describe('A.3 — accepting with a full pack opens the pack; NOTHING is paid yet', () => {
  it('an item reward with 12 items: the deal-discard phase, deal-needs-room, ledger and player untouched', () => {
    const p = withPack(hero(), trinkets(12));
    const s = atDeal(p, GREED_FOR_LEGENDARY);
    const r = step(s, { kind: 'deal-decision', accept: true });
    expect(r.state.phase).toEqual({ kind: 'deal-discard', deal: GREED_FOR_LEGENDARY });
    expect(r.awaiting).toBe('deal-discard');
    expect(r.events).toEqual([{ kind: 'deal-needs-room', reward: 'Legendary mainHand' }]);
    expect(r.state.karma).toEqual(s.karma); // greed NOT yet recorded
    expect(r.state.player).toEqual(p); // nothing taken
  });

  it('with room, or a non-item reward, or a cost that frees a slot, there is no discard step', () => {
    const roomy = step(atDeal(withPack(hero(), trinkets(11)), GREED_FOR_LEGENDARY), { kind: 'deal-decision', accept: true });
    expect(roomy.state.phase.kind).toBe('main-menu');
    const statReward: SacrificeDeal = { pool: 'tempting', cost: { kind: 'greed' }, reward: { kind: 'statPoint', stat: 'STR' } };
    expect(step(atDeal(withPack(hero(), trinkets(12)), statReward), { kind: 'deal-decision', accept: true }).state.phase.kind).toBe('main-menu');
    const offering: SacrificeDeal = { pool: 'standard', cost: { kind: 'offering' }, reward: { kind: 'item', instance: LEGENDARY } };
    expect(needsRoom(withPack(hero(), trinkets(12)), offering)).toBe(false);
    expect(step(atDeal(withPack(hero(), trinkets(12)), offering), { kind: 'deal-decision', accept: true }).state.phase.kind).toBe('main-menu');
  });

  it('an UNAFFORDABLE bargain never asks the player to throw anything away', () => {
    // hp 5 cost vs hp 5: unaffordable. Checked BEFORE the room, so no discard step opens.
    const pricey: SacrificeDeal = { pool: 'grace', cost: { kind: 'hp', amount: 5 }, reward: { kind: 'item', instance: LEGENDARY } };
    const r = step(atDeal(withPack(hero({ hp: 5 }), trinkets(12)), pricey), { kind: 'deal-decision', accept: true });
    expect(r.events).toEqual([{ kind: 'deal-unaffordable', cost: '5 HP' }]);
    expect(r.state.phase.kind).toBe('main-menu');
  });
});

describe('A.3 — making room completes the bargain in ONE step', () => {
  function discardFrom(index: number) {
    const p = withPack(hero(), trinkets(12));
    const open = step(atDeal(p, GREED_FOR_LEGENDARY), { kind: 'deal-decision', accept: true });
    return { p, r: step(open.state, { kind: 'discard', index }) };
  }

  it('the chosen item is gone, the reward is placed, the price is paid — together', () => {
    const { p, r } = discardFrom(4);
    expect(r.state.phase.kind).toBe('main-menu');
    const pack = r.state.player!.inventory.backpack;
    expect(pack).toHaveLength(12);
    expect(pack.map((i) => i.rolled?.name)).not.toContain('Ring 4');
    expect(pack.at(-1)).toEqual(LEGENDARY);
    // greed = lootGreedily = restraint -1 (KARMA_DELTAS, read as a spec), x1 on floor 1.
    expect(r.state.karma).toEqual({ ...createKarma(), restraintGreed: -1 });
    expect(r.events).toEqual([
      { kind: 'item-discarded', name: 'Ring 4', rarity: 'Common' },
      { kind: 'deal-taken', cost: 'a cache, stripped bare', reward: 'Legendary mainHand' },
    ]);
    expect(p.inventory.backpack).toHaveLength(12); // the input was not mutated
  });

  it('accept:true inside the discard phase does nothing — the player must choose what to leave', () => {
    const open = step(atDeal(withPack(hero(), trinkets(12)), GREED_FOR_LEGENDARY), { kind: 'deal-decision', accept: true });
    expect(step(open.state, { kind: 'deal-decision', accept: true }).state).toBe(open.state);
    expect(step(open.state, { kind: 'discard', index: 12 }).state).toBe(open.state);
  });

  it('a discard that would make the price unpayable changes NOTHING — not even the discard', () => {
    // Unreachable with the shipped costs (only an item-freeing cost could depend on the pack, and
    // such a cost never needs room), so the phase is stood up by hand to drive the branch: a
    // RELIC cost, the pack's only relic chosen as the discard. The bargain must not half-complete.
    const relicDeal: SacrificeDeal = { pool: 'tempting', cost: { kind: 'relic' }, reward: { kind: 'item', instance: LEGENDARY } };
    const pack = [{ defId: 'mirror-shard' }, ...trinkets(11)];
    const p = withPack(hero(), pack);
    const s: GameState = { ...hub(p, 9), phase: { kind: 'deal-discard', deal: relicDeal } };
    const r = step(s, { kind: 'discard', index: 0 });
    expect(r.events).toEqual([{ kind: 'deal-unaffordable', cost: 'a relic' }]);
    expect(r.state.player).toEqual(p); // the relic was NOT discarded
    expect(r.state.karma).toEqual(s.karma);
  });
});

describe('A.3.2 — backing out of the discard is EXACTLY refusing the bargain', () => {
  it('the same next state (rng, karma, player, phase) and the same events, from the same offer', () => {
    // WHAT REFUSING DOES: nothing but return to the hub — no karma action, no draw, no item.
    const s = atDeal(withPack(hero(), trinkets(12)), GREED_FOR_LEGENDARY, 31);
    const refused = step(s, { kind: 'deal-decision', accept: false });
    const opened = step(s, { kind: 'deal-decision', accept: true });
    const backedOut = step(opened.state, { kind: 'deal-decision', accept: false });
    expect(backedOut.state).toEqual(refused.state);
    expect(backedOut.events).toEqual(refused.events);
    expect(refused.events).toEqual([{ kind: 'deal-declined' }]);
    expect(refused.state.karma).toEqual(s.karma);
    expect(refused.state.player).toEqual(s.player);
    expect(refused.state.rngState).toBe(s.rngState);
  });
});

describe('A.3.3 — the price is never charged before the reward is placed', () => {
  it('applyDeal on a full pack with an item reward returns the SAME player and ledger (no-room)', () => {
    const p = withPack(hero({ hp: 30 }), trinkets(12));
    const k = createKarma();
    // An HP cost: if the price were paid first, hp would read 24 in the result.
    const deal: SacrificeDeal = { pool: 'grace', cost: { kind: 'hp', amount: 6 }, reward: { kind: 'item', instance: LEGENDARY } };
    const r = applyDeal(p, k, deal);
    expect(r.outcome).toBe('no-room');
    expect(r.player).toBe(p);
    expect(r.karma).toBe(k);
  });

  it('...and a greed cost records no karma when there is no room', () => {
    const k = createKarma();
    const r = applyDeal(withPack(hero(), trinkets(12)), k, GREED_FOR_LEGENDARY);
    expect(r.outcome).toBe('no-room');
    expect(r.karma).toBe(k);
  });
});

describe('the discard phase is plain data — it saves and resumes', () => {
  it('a state parked in deal-discard round-trips and steps identically', () => {
    const open = step(atDeal(withPack(hero(), trinkets(12)), GREED_FOR_LEGENDARY), { kind: 'deal-decision', accept: true });
    const decoded = decodeSave(encodeSave(open.state));
    expect(decoded).toEqual(open.state);
    expect(step(decoded!, { kind: 'discard', index: 2 })).toEqual(step(open.state, { kind: 'discard', index: 2 }));
  });
});
