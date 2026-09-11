// Tests for the sacrifice-deal encounter (M7). Every expected value is hand-derived from the
// spec, character.ts's `computeStatMod` (floor((stat-10)/2)), karma.ts's KARMA_DELTAS, and
// rng.ts semantics (`pick` = items[floor(x*len)]) — never measured from the implementation.

import { describe, it, expect } from 'vitest';
import {
  selectPool,
  buildDeal,
  applyDeal,
  canAfford,
  describeCost,
  type SacrificeDeal,
  type DealReward,
  type DealRewardSpec,
} from './deal.ts';
import dealsData from '../data/deals.json';
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

  it('#10a APPENDED its four templates — every pool still leads with its first authored one', () => {
    // `pick` is `items[floor(x*len)]`, so at x=0.0 the draw is index 0 WHATEVER the length.
    // This is the property that keeps every scripted-rng deal test honest across a data edit:
    // it fails the moment a template is INSERTED at the head of a pool instead of appended.
    // Expected values are read off `deals.json`'s authoring order by hand, not from the loader.
    // PLAN.md #2 rewrote the pools (no heals): standard now leads with `hp 6 -> 2 charges`.
    expect(buildDeal(NEUTRAL, 1, scriptedRng([0.0])).cost).toEqual({ kind: 'hp', amount: 6 });
    expect(
      buildDeal({ ...NEUTRAL, restraintGreed: -5 }, 1, scriptedRng([0.0])).cost,
    ).toEqual({ kind: 'desecrate' });
    expect(
      // grace[0] now pays a ROLLED item (PLAN.md #2), so it takes generateItem's two draws too.
      buildDeal({ ...NEUTRAL, reverenceDesecration: 5 }, 1, scriptedRng([0.0, 0.5, 0.5])).cost,
    ).toEqual({ kind: 'hp', amount: 5 });
  });

  it('offers the offering and the whisper at NEUTRAL karma (the standard pool, not a gated one)', () => {
    // Reachability, not mere existence. Putting `offering` only in `grace` would have been
    // circular — `grace` opens at reverence >= 3 and the offering is the only way to earn it —
    // and putting `whisper` only in `tempting` would have hidden The Delusion behind a fall the
    // player must already have taken. `pick` = items[floor(x*5)] over the 5-long standard pool:
    // x=0.7 -> index 3 (offering), x=0.9 -> index 4 (whisper). Hand-derived from the file order.
    // PLAN.md #2: the offering now pays a rolled Rare armor, so it takes two more draws.
    expect(buildDeal(NEUTRAL, 1, scriptedRng([0.7, 0.5, 0.5])).cost).toEqual({ kind: 'offering' });
    expect(buildDeal(NEUTRAL, 1, scriptedRng([0.9])).cost).toEqual({ kind: 'whisper' });
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
      reward: { kind: 'skillCharge', amount: 0 }, // grants nothing
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
      reward: { kind: 'skillCharge', amount: 0 }, // grants nothing
    };
    expect(canAfford(p, deal.cost)).toBe(false);
    expect(applyDeal(p, NEUTRAL, deal).outcome).toBe('unaffordable');
  });
});

describe('applyDeal — reward types', () => {
  it('NO reward heals — §22.25, enforced by type and by data (AC-21, G52 at the root)', () => {
    // Type level: `DealReward` has no `heal` member, so this alias is `never`. If a heal arm
    // were ever added back, the assignment below would stop compiling.
    type HealReward = Extract<DealReward, { kind: 'heal' }>;
    type HealSpec = Extract<DealRewardSpec, { kind: 'heal' }>;
    const noHeal: [HealReward, HealSpec] extends [never, never] ? true : false = true;
    expect(noHeal).toBe(true);
    // Data level: nothing in the shipped table so much as mentions a heal.
    expect(JSON.stringify(dealsData)).not.toMatch(/"heal"/);
    // And no pool's reward ever touches HP: every built offer, every pool, 120 seeds each.
    for (const karma of [NEUTRAL, { ...NEUTRAL, restraintGreed: -5 }, { ...NEUTRAL, reverenceDesecration: 5 }]) {
      for (let seed = 1; seed <= 120; seed += 1) {
        const deal = buildDeal(karma, 1, mulberry32(seed));
        const p = makePlayer({ hp: 10, maxHp: 40, skillCharges: 5 });
        if (!canAfford(p, deal.cost)) continue;
        const r = applyDeal(p, NEUTRAL, deal);
        expect(r.player.hp, `${deal.pool}/${deal.cost.kind}`).toBeLessThanOrEqual(p.hp);
      }
    }
  });

  it('a skill-charge reward is capped at maxSkillCharges', () => {
    const p = makePlayer({ skillCharges: 4, maxSkillCharges: 5 });
    const deal: SacrificeDeal = {
      pool: 'grace',
      cost: { kind: 'hp', amount: 1 },
      reward: { kind: 'skillCharge', amount: 3 },
    };
    expect(applyDeal(p, NEUTRAL, deal).player.skillCharges).toBe(5); // min(4 + 3, 5)
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
      reward: { kind: 'skillCharge', amount: 0 }, // grants nothing
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

  // ------- #10a: the two new karma-shifting costs ------------------------------------------

  it('an offering deal moves BOTH restraint and reverence by +1 and takes the first pack item', () => {
    // Expected from karma.ts's KARMA_DELTAS.leaveOffering = { restraintGreed: 1,
    // reverenceDesecration: 1 } — read from the design table, not from the implementation.
    // Both unmoved axes are asserted too: naming the wrong action would move a different pair.
    const p = makePlayer({
      inventory: {
        slots: makePlayer().inventory.slots,
        backpack: [{ defId: 'Jaaj Sword 1' }, { defId: 'mirror-shard' }],
      },
    });
    const deal: SacrificeDeal = {
      pool: 'standard',
      cost: { kind: 'offering' },
      reward: { kind: 'skillCharge', amount: 0 }, // grants nothing
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.outcome).toBe('taken');
    expect(r.karma).toEqual({ ...NEUTRAL, restraintGreed: 1, reverenceDesecration: 1 });
    // The FIRST item goes — and it really is gone, not merely one fewer of something.
    expect(r.player.inventory.backpack).toEqual([{ defId: 'mirror-shard' }]);
  });

  it('an offering with an EMPTY backpack is unaffordable — no free reverence', () => {
    // The single most likely silent bug in this unit: `canAfford` used to end in
    // `default: return true`, so a cost that takes an item would have been affordable with no
    // item, `slice(1)` on `[]` is a silent no-op, and the karma would still have been recorded.
    // That is an unlimited, cost-free reverence tap at a free, unlimited hub action.
    const p = makePlayer(); // empty backpack
    expect(p.inventory.backpack).toEqual([]);
    const deal: SacrificeDeal = {
      pool: 'standard',
      cost: { kind: 'offering' },
      reward: { kind: 'skillCharge', amount: 5 },
    };
    expect(canAfford(p, deal.cost)).toBe(false);
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.outcome).toBe('unaffordable');
    expect(r.player).toBe(p); // nothing changed at all — not even the reward
    expect(r.karma).toEqual(NEUTRAL);
  });

  it('a whisper deal shifts clarityDelusion by -1 and no other axis, and costs nothing material', () => {
    // KARMA_DELTAS.embraceWhisper = { clarityDelusion: -1 }. The SIGN is the point: karma.ts's
    // convention is positive = virtue, and embracing a whisper is the shadow pole.
    const p = makePlayer({ hp: 30, skillCharges: 3 });
    const deal: SacrificeDeal = {
      pool: 'standard',
      cost: { kind: 'whisper' },
      reward: { kind: 'skillCharge', amount: 0 }, // grants nothing
    };
    const r = applyDeal(p, NEUTRAL, deal);
    expect(r.outcome).toBe('taken');
    expect(r.karma).toEqual({ ...NEUTRAL, clarityDelusion: -1 });
    expect(r.player.hp).toBe(30);
    expect(r.player.skillCharges).toBe(3);
    expect(r.player.inventory.backpack).toEqual([]);
  });
});

// ------- #10a — `canAfford` is EXHAUSTIVE over DealCost, arm by arm ---------------------------

describe('canAfford — every cost kind, both polarities where it has two', () => {
  // Type-exhaustive: a future `DealCost` member makes this Record a COMPILE error, so the
  // sweep can never silently stop covering a kind. (The old `default: return true` arm is gone
  // from `canAfford` for the same reason — a new kind must be decided, not defaulted.)
  const ONE_OF_EACH: Record<SacrificeDeal['cost']['kind'], SacrificeDeal['cost']> = {
    hp: { kind: 'hp', amount: 5 },
    maxHp: { kind: 'maxHp', amount: 5 },
    statPoint: { kind: 'statPoint', stat: 'CHA' },
    skillCharge: { kind: 'skillCharge', amount: 1 },
    relic: { kind: 'relic' },
    offering: { kind: 'offering' },
    desecrate: { kind: 'desecrate' },
    greed: { kind: 'greed' },
    whisper: { kind: 'whisper' },
  };

  // Hand-derived from the doc contract, NOT from a run: hp/maxHp must leave something behind,
  // relic needs a relic, offering needs any item, the purely-karmic costs are always payable.
  const EXPECTED_WITH_EMPTY_PACK: Record<SacrificeDeal['cost']['kind'], boolean> = {
    hp: true, // 5 < 30
    maxHp: true, // 5 < 40
    statPoint: true,
    skillCharge: true,
    relic: false, // no relic held
    offering: false, // nothing to give
    desecrate: true,
    greed: true,
    whisper: true,
  };

  it('a player with an EMPTY backpack can afford everything except a relic and an offering', () => {
    const p = makePlayer();
    for (const [kind, cost] of Object.entries(ONE_OF_EACH)) {
      expect(canAfford(p, cost), kind).toBe(
        EXPECTED_WITH_EMPTY_PACK[kind as SacrificeDeal['cost']['kind']],
      );
    }
    // Non-vacuity: the sweep really covered all nine arms.
    expect(Object.keys(ONE_OF_EACH)).toHaveLength(9);
  });

  it('a single NON-relic item makes the offering payable but still not the relic cost', () => {
    // The polarity control for the offering arm: `backpack.length > 0`, not "holds a relic".
    const p = makePlayer({
      inventory: { slots: makePlayer().inventory.slots, backpack: [{ defId: 'Jaaj Sword 1' }] },
    });
    expect(canAfford(p, { kind: 'offering' })).toBe(true);
    expect(canAfford(p, { kind: 'relic' })).toBe(false);
  });
});

// ------- #10a — the four karma-cost strings name the ACT, never the axis (G53) ----------------

describe('describeCost — the karma costs, verbatim', () => {
  it('reads as acts, with no axis vocabulary and no numbers', () => {
    // Pinned verbatim so a "helpful" rewrite that reintroduces `your reverence (…)` is a red
    // test here as well as in the universal guard in karmaActions.test.ts.
    expect(describeCost({ kind: 'offering' })).toBe('an offering from your pack');
    expect(describeCost({ kind: 'whisper' })).toBe('a whisper, heeded');
    expect(describeCost({ kind: 'desecrate' })).toBe('a shrine, broken open');
    expect(describeCost({ kind: 'greed' })).toBe('a cache, stripped bare');
  });
});

// ------- G20 — a sacrifice deal cannot drive the player below a living body -------------------

describe('G20 — no deal leaves maxHp, hp or a stat below 1', () => {
  const dealWith = (cost: SacrificeDeal['cost']): SacrificeDeal => ({
    pool: 'tempting',
    cost,
    reward: { kind: 'skillCharge', amount: 1 },
  });

  it('a maxHp cost that would not leave a living body is UNAFFORDABLE', () => {
    // The register's exact reproduction: `deals.json`'s `tempting` pool carries a `maxHp: 6`
    // cost, and `canAfford` used to fall through to `return true` for it, so a player at
    // `maxHp: 5, hp: 5` could take it and came out at `maxHp: -1, hp: -1` — walking to the hub
    // dead, refused potions, and revived only to 1.
    const player = makePlayer({ maxHp: 5, hp: 5 });
    expect(canAfford(player, { kind: 'maxHp', amount: 6 })).toBe(false);
    expect(canAfford(player, { kind: 'maxHp', amount: 5 })).toBe(false); // must LEAVE something
    expect(canAfford(player, { kind: 'maxHp', amount: 4 })).toBe(true);

    const result = applyDeal(player, createKarma(), dealWith({ kind: 'maxHp', amount: 6 }));
    expect(result.outcome).toBe('unaffordable');
    expect(result.player).toBe(player); // nothing changed at all
  });

  it('an affordable maxHp cost still leaves maxHp and hp at 1 or more', () => {
    const player = makePlayer({ maxHp: 5, hp: 5 });
    const result = applyDeal(player, createKarma(), dealWith({ kind: 'maxHp', amount: 4 }));
    expect(result.outcome).toBe('taken');
    expect(result.player.maxHp).toBe(1);
    expect(result.player.hp).toBe(1); // clamped down to the new max, floored at 1
  });

  it('no sequence of stat costs can walk an attribute to zero or below', () => {
    // The `statPoint` cost was unbounded in exactly the same way, and it is clamped in the
    // same edit: a stat at 0 or below would invert its modifier (and, for CON, every number
    // derived from it).
    //
    // STRENGTHENED in fix round 1, and this is the one line of a pre-existing test that moved.
    // It used to assert `outcome === 'taken'` on EVERY iteration, including the ones past the
    // floor — which encoded the very defect that turned out to matter: a deal that clamps to
    // MIN_STAT, takes NOTHING, and still pays out its reward. `canAfford` now refuses a stat
    // cost the player cannot actually pay, so the loop asserts the sharper property: taken
    // while there is a point to give, REFUSED once there is not, and never below the floor at
    // any point. Everything the old assertion protected still holds and more.
    let player = makePlayer();
    const start = player.stats.STR;
    let taken = 0;
    let refused = 0;
    for (let i = 0; i < start + 10; i++) {
      const r = applyDeal(player, createKarma(), dealWith({ kind: 'statPoint', stat: 'STR' }));
      if (player.stats.STR > 1) {
        expect(r.outcome, `iteration ${i} at STR ${player.stats.STR}`).toBe('taken');
        taken += 1;
      } else {
        expect(r.outcome, `iteration ${i} at STR ${player.stats.STR}`).toBe('unaffordable');
        expect(r.player).toBe(player); // and NOTHING changed — not even the reward
        refused += 1;
      }
      player = r.player;
      expect(player.stats.STR).toBeGreaterThanOrEqual(1);
    }
    // Hand-derived from STR 16: 15 deals walk it 16 -> 1, the remaining 11 iterations are all
    // refused. Both counts are asserted so neither branch can go unexercised.
    expect(taken).toBe(start - 1);
    expect(refused).toBe(start + 10 - (start - 1));
    expect(player.stats.STR).toBe(1);
    // …and the derived mod table was recomputed from the clamped value, not the raw one.
    expect(player.mods.STR).toBe(computeStatMod(1));
  });

  it('a cost at its floor is REFUSED, not silently taken for free (fix round 1)', () => {
    // The two arms this unit originally hand-wrote back as unconditional `return true`. Both
    // clamp when applied, so "affordable" used to mean "takes nothing and still pays out" — and
    // both of the templates they gate reward an ITEM, which #10a's offering turns into karma.
    const drained = makePlayer({ skillCharges: 0 });
    expect(canAfford(drained, { kind: 'skillCharge', amount: 1 })).toBe(false);
    expect(applyDeal(drained, createKarma(), dealWith({ kind: 'skillCharge', amount: 1 })).outcome)
      .toBe('unaffordable');
    // …and the polarity control: with the charges in hand it IS payable, and really spends them.
    const charged = makePlayer({ skillCharges: 2 });
    expect(canAfford(charged, { kind: 'skillCharge', amount: 2 })).toBe(true);
    expect(canAfford(charged, { kind: 'skillCharge', amount: 3 })).toBe(false);

    const floored = makePlayer({ stats: { STR: 16, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 1 } });
    expect(canAfford(floored, { kind: 'statPoint', stat: 'CHA' })).toBe(false);
    expect(applyDeal(floored, createKarma(), dealWith({ kind: 'statPoint', stat: 'CHA' })).outcome)
      .toBe('unaffordable');
    // …polarity control: one point above the floor and it is payable again.
    const spare = makePlayer({ stats: { STR: 16, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 2 } });
    expect(canAfford(spare, { kind: 'statPoint', stat: 'CHA' })).toBe(true);
  });

  it('an accepted deal never leaves the player unable to act, for any shipped cost kind', () => {
    // A sweep across every cost kind at the tightest legal player, asserting the invariant
    // rather than one branch: nothing an accepted deal does may produce a dead body.
    //
    // #10a made this TYPE-EXHAUSTIVE (a new `DealCost` member is now a compile error here, not
    // a quietly-missed row) and gave the player a stocked backpack so the `relic` and
    // `offering` rows are actually TAKEN rather than skipped by `canAfford`. The taken-count
    // assertion at the end is what stops the whole sweep from passing vacuously if every row
    // starts being skipped — an invariant asserted over nothing is the failure mode this
    // codebase keeps meeting.
    const costs: Record<SacrificeDeal['cost']['kind'], SacrificeDeal['cost']> = {
      hp: { kind: 'hp', amount: 1 },
      maxHp: { kind: 'maxHp', amount: 1 },
      statPoint: { kind: 'statPoint', stat: 'CON' },
      // Fix round 1: was `amount: 99`, which is now correctly UNAFFORDABLE at 3 charges and
      // would have dropped this row out of the sweep. 3 is the whole pool: payable, and it
      // still drains the counter to 0, so the clamp this test exists for is still exercised.
      skillCharge: { kind: 'skillCharge', amount: 3 },
      relic: { kind: 'relic' },
      offering: { kind: 'offering' },
      desecrate: { kind: 'desecrate' },
      greed: { kind: 'greed' },
      whisper: { kind: 'whisper' },
    };
    const stocked = (): Player =>
      makePlayer({
        maxHp: 2,
        hp: 2,
        inventory: {
          slots: makePlayer().inventory.slots,
          backpack: [{ defId: 'mirror-shard' }, { defId: 'Jaaj Sword 1' }],
        },
      });
    let taken = 0;
    for (const cost of Object.values(costs)) {
      const player = stocked();
      if (!canAfford(player, cost)) continue;
      taken += 1;
      const r = applyDeal(player, createKarma(), dealWith(cost));
      expect(r.player.maxHp, `${cost.kind}: maxHp`).toBeGreaterThanOrEqual(1);
      expect(r.player.hp, `${cost.kind}: hp`).toBeGreaterThanOrEqual(1);
      expect(r.player.skillCharges, `${cost.kind}: charges`).toBeGreaterThanOrEqual(0);
    }
    // Hand-derived: at maxHp 2 / hp 2 with a relic and a sword in the pack, every one of the
    // nine kinds is payable (hp 1 < 2, maxHp 1 < 2, a relic is held, the pack is non-empty).
    expect(taken).toBe(9);
  });
});
