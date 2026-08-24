// Tests for the sacrifice-deal encounter (M7). Every expected value is hand-derived from the
// spec, character.ts's `computeStatMod` (floor((stat-10)/2)), karma.ts's KARMA_DELTAS, and
// rng.ts semantics (`pick` = items[floor(x*len)]) — never measured from the implementation.

import { describe, it, expect } from 'vitest';
import {
  selectPool,
  buildDeal,
  applyDeal,
  canAfford,
  type SacrificeDeal,
} from './deal.ts';
import { createPlayer, type Player } from './player.ts';
import { createKarma, type KarmaState } from './karma.ts';
import { computeStatMod } from './character.ts';
import { mulberry32, type Rng } from './rng.ts';

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`scriptedRng exhausted (${values.length})`);
    return values[i++]!;
  };
}

// Enforcer (1d10, CON 12 -> maxHp 11, AC 11). Overridable hp/maxHp/skillCharges/backpack.
function makePlayer(overrides: Partial<Player> = {}): Player {
  const base = createPlayer({
    name: 'Hero',
    classId: 'Enforcer',
    stats: { STR: 16, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
  });
  return { ...base, hp: 30, maxHp: 40, skillCharges: 3, ...overrides };
}

const NEUTRAL = createKarma();

describe('selectPool — deterministic karma read (thresholds 3, M15 placeholders)', () => {
  it('neutral karma -> standard', () => {
    expect(selectPool(NEUTRAL)).toBe('standard');
  });
  it('reverenceDesecration >= 3 -> grace', () => {
    expect(selectPool({ ...NEUTRAL, reverenceDesecration: 3 })).toBe('grace');
  });
  it('restraintGreed <= -3 -> tempting', () => {
    expect(selectPool({ ...NEUTRAL, restraintGreed: -3 })).toBe('tempting');
  });
  it('reverenceDesecration <= -3 -> tempting', () => {
    expect(selectPool({ ...NEUTRAL, reverenceDesecration: -3 })).toBe('tempting');
  });
});

describe('buildDeal — pool is the karma read; determinism', () => {
  it('greedy karma draws the tempting pool while neutral draws standard (same rng)', () => {
    // standard[0] and tempting[0] both have non-item rewards, so buildDeal takes exactly one
    // draw (the template pick, floor(0*len)=index 0) for each.
    const greedy: KarmaState = { ...NEUTRAL, restraintGreed: -5 };
    const tempting = buildDeal(greedy, 1, scriptedRng([0.0]));
    const standard = buildDeal(NEUTRAL, 1, scriptedRng([0.0]));
    expect(tempting.pool).toBe('tempting');
    expect(standard.pool).toBe('standard');
    expect(tempting.pool).not.toBe(standard.pool);
  });

  it('is deterministic for a fixed karma + seed', () => {
    expect(buildDeal(NEUTRAL, 1, mulberry32(7))).toEqual(buildDeal(NEUTRAL, 1, mulberry32(7)));
  });
});

const RELIC: SacrificeDeal['reward'] = { kind: 'item', instance: { defId: 'mirror-shard' } };

describe('applyDeal — each cost type applies its exact effect', () => {
  it('HP cost subtracts HP, grants the reward, leaves karma unchanged', () => {
    const p = makePlayer({ hp: 30 });
    const deal: SacrificeDeal = { pool: 'standard', cost: { kind: 'hp', amount: 10 }, reward: RELIC };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.outcome).toBe('taken');
    expect(r.player.hp).toBe(20); // 30 - 10
    expect(r.player.inventory.backpack).toContainEqual({ defId: 'mirror-shard' });
    expect(r.karma).toEqual(NEUTRAL);
  });

  it('HP cost >= current HP is unaffordable and changes nothing', () => {
    const p = makePlayer({ hp: 10 });
    const deal: SacrificeDeal = { pool: 'standard', cost: { kind: 'hp', amount: 10 }, reward: RELIC };
    expect(canAfford(p, deal.cost)).toBe(false);
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.outcome).toBe('unaffordable');
    expect(r.player).toBe(p);
    expect(r.karma).toEqual(NEUTRAL);
  });

  it('max-HP cost lowers maxHp and clamps hp to the new max', () => {
    const p = makePlayer({ hp: 40, maxHp: 40 });
    const deal: SacrificeDeal = { pool: 'tempting', cost: { kind: 'maxHp', amount: 8 }, reward: RELIC };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.player.maxHp).toBe(32); // 40 - 8
    expect(r.player.hp).toBe(32); // clamped from 40
  });

  it('stat-point cost drops the stat by 1 and recomputes its mod (STR 16 -> 15, +3 -> +2)', () => {
    const p = makePlayer();
    expect(p.mods.STR).toBe(computeStatMod(16)); // +3
    const deal: SacrificeDeal = {
      pool: 'tempting',
      cost: { kind: 'statPoint', stat: 'STR' },
      reward: RELIC,
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.player.stats.STR).toBe(15);
    expect(r.player.mods.STR).toBe(computeStatMod(15)); // +2
  });

  it('a CON stat cost recomputes mods but does NOT re-derive maxHp/AC (level-up policy)', () => {
    const p = makePlayer();
    const beforeMaxHp = p.maxHp;
    const beforeAc = p.armorClass;
    const deal: SacrificeDeal = {
      pool: 'tempting',
      cost: { kind: 'statPoint', stat: 'CON' },
      reward: RELIC,
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.player.mods.CON).toBe(computeStatMod(11)); // 12 -> 11, +1 -> +0
    expect(r.player.maxHp).toBe(beforeMaxHp); // NOT recomputed
    expect(r.player.armorClass).toBe(beforeAc); // NOT recomputed
  });

  it('skill-charge cost and reward net out exactly (3 - 2 + 3, capped at max 5 -> 4)', () => {
    const p = makePlayer({ skillCharges: 3 }); // maxSkillCharges 5
    const deal: SacrificeDeal = {
      pool: 'standard',
      cost: { kind: 'skillCharge', amount: 2 },
      reward: { kind: 'skillCharge', amount: 3 },
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.player.skillCharges).toBe(4); // (3-2) then min(1+3, 5) = 4
  });

  it('relic cost removes exactly one relic instance from the backpack', () => {
    const p = makePlayer({
      inventory: {
        slots: makePlayer().inventory.slots,
        backpack: [{ defId: 'mirror-shard' }, { defId: 'Jaaj Sword 1' }],
      },
    });
    const deal: SacrificeDeal = {
      pool: 'tempting',
      cost: { kind: 'relic' },
      reward: { kind: 'heal', amount: 0 },
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.outcome).toBe('taken');
    // The relic is gone; the non-relic weapon remains.
    expect(r.player.inventory.backpack).toEqual([{ defId: 'Jaaj Sword 1' }]);
  });

  it('relic cost with no relic in the backpack is unaffordable', () => {
    const p = makePlayer(); // empty backpack
    const deal: SacrificeDeal = {
      pool: 'tempting',
      cost: { kind: 'relic' },
      reward: { kind: 'heal', amount: 0 },
    };
    expect(canAfford(p, deal.cost)).toBe(false);
    expect(applyDeal(p, NEUTRAL, deal).outcome).toBe('unaffordable');
  });
});

describe('applyDeal — reward types', () => {
  it('heal reward restores HP capped at maxHp', () => {
    const p = makePlayer({ hp: 35, maxHp: 40 });
    const deal: SacrificeDeal = {
      pool: 'grace',
      cost: { kind: 'skillCharge', amount: 0 },
      reward: { kind: 'heal', amount: 20 },
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.player.hp).toBe(40); // 35 + 20 capped at 40
  });

  it('stat-point reward raises the stat by 1 and recomputes its mod (STR 15 -> 16, +2 -> +3)', () => {
    const p = makePlayer({ stats: { STR: 15, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 } });
    const deal: SacrificeDeal = {
      pool: 'standard',
      cost: { kind: 'skillCharge', amount: 0 },
      reward: { kind: 'statPoint', stat: 'STR' },
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.player.stats.STR).toBe(16);
    expect(r.player.mods.STR).toBe(computeStatMod(16)); // +3
  });

  it('item reward lands in the backpack', () => {
    const p = makePlayer();
    const deal: SacrificeDeal = {
      pool: 'standard',
      cost: { kind: 'skillCharge', amount: 0 },
      reward: { kind: 'item', instance: { defId: 'gen:Common:ring' } },
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.player.inventory.backpack).toHaveLength(1);
  });
});

describe('applyDeal — karma-shifting costs flow through the real recordKarma', () => {
  it('a desecration deal shifts reverenceDesecration by -2 and no other axis; no HP/stat cost', () => {
    const p = makePlayer({ hp: 30 });
    const deal: SacrificeDeal = {
      pool: 'tempting',
      cost: { kind: 'desecrate' },
      reward: { kind: 'statPoint', stat: 'STR' },
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.karma).toEqual({ ...NEUTRAL, reverenceDesecration: -2 }); // KARMA_DELTAS.desecrateShrine
    expect(r.player.hp).toBe(30); // no HP paid
  });

  it('a greed deal shifts restraintGreed by -1 and no other axis', () => {
    const p = makePlayer();
    const deal: SacrificeDeal = {
      pool: 'tempting',
      cost: { kind: 'greed' },
      reward: { kind: 'heal', amount: 0 },
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.karma).toEqual({ ...NEUTRAL, restraintGreed: -1 }); // KARMA_DELTAS.lootGreedily
  });

  it('a non-karma (HP-cost) deal leaves the karma vector identical to the input', () => {
    const p = makePlayer({ hp: 30 });
    const deal: SacrificeDeal = { pool: 'standard', cost: { kind: 'hp', amount: 5 }, reward: RELIC };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.karma).toEqual(NEUTRAL);
  });
});
