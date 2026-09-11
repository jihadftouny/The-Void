// The floor hook (PLAN.md #2): the data, the keying, and the two numeric floor mechanics
// (floor 3's slow weight, floor 4's double-weight karma) that ride the relic pipeline.
//
// Every expected value is derived from the plan / GAME-DESIGN rulings or by hand arithmetic —
// never read back from the implementation. The floor that carries a mechanic is written here
// from the ruling (§22.24: floor 3 dampens, floor 4 doubles) and the data is checked AGAINST it.

import { describe, it, expect } from 'vitest';
import {
  dampenHeal,
  floorContext,
  floorDef,
  floorModifiers,
  floorOf,
  floorProblems,
  shippedFloors,
  FLOOR_ENCOUNTERS,
  FLOOR_IDS,
  ILLUSION_DC,
  type FloorDef,
} from './floors.ts';
import { step, type GameState } from './game.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy, type Enemy } from './enemy.ts';
import { getFamily } from './enemyFamily.ts';
import { createBattle, openBattle, type BattleState } from './battle.ts';
import { fireTrigger, fireFloorTriggers } from './relicEffects.ts';
import { createKarma } from './karma.ts';
import { makeCondition } from './condition.ts';
import { mulberry32 } from './rng.ts';
import { type Stats } from './character.ts';
import { type ItemInstance } from './item.ts';

const STATS: Stats = { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 };

function player(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ name: 'Hero', classId: 'Penitent', stats: STATS }), ...overrides };
}

/** An enemy that cannot act this round (a fresh freeze) and has nothing to cast — 0 draws. */
function frozenEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(5)),
    hp: 30,
    resistances: [0, 0, 0, 0, 0, 0, 0],
    skillPool: [],
    skillCharges: 0,
    activeConditions: [makeCondition('freeze')],
    ...overrides,
  };
}

function battleState(p: Player, enemy: Enemy, place: number, act = place + 1): GameState {
  const battle: BattleState = { player: p, enemy, act, canFlee: true };
  return {
    version: 8,
    rngState: 77,
    player: p,
    act,
    place,
    karma: createKarma(),
    phase: { kind: 'battle', battle, started: true, final: false },
  };
}

// ------- AC-8: the data, and the keying ----------------------------------------------------

describe('floors.json — all five floors, validated (AC-8)', () => {
  it('the shipped table has no problems', () => {
    expect(floorProblems(shippedFloors())).toEqual([]);
    expect(Object.keys(shippedFloors()).sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('every encounter weight is a positive integer and every floor offers a bargain and a rest', () => {
    for (const id of FLOOR_IDS) {
      const def = floorDef(id);
      for (const kind of FLOOR_ENCOUNTERS) {
        expect(Number.isInteger(def.encounters[kind]), `${id}.${kind}`).toBe(true);
        expect(def.encounters[kind], `${id}.${kind}`).toBeGreaterThan(0);
      }
    }
  });

  it('the illusion chance is floor 2 ONLY, and exactly one in three (§22.24)', () => {
    expect(floorDef(2).illusionChance).toEqual({ numerator: 1, denominator: 3 });
    for (const id of [1, 3, 4, 5] as const) expect(floorDef(id).illusionChance).toBeUndefined();
  });

  it('the validator fires on each way the table can break (it is not a rubber stamp)', () => {
    const good = shippedFloors();
    const clone = (): Record<string, FloorDef> => JSON.parse(JSON.stringify(good)) as Record<string, FloorDef>;

    const missing = clone();
    delete missing['3'];
    expect(floorProblems(missing)).toContain('floor 3 is missing');

    const zero = clone();
    zero['1']!.encounters.bargain = 0;
    expect(floorProblems(zero).join()).toMatch(/floor 1: encounter weight "bargain"/);

    const fractional = clone();
    fractional['5']!.encounters.rest = 1.5;
    expect(floorProblems(fractional).join()).toMatch(/floor 5: encounter weight "rest"/);

    const badChance = clone();
    badChance['2']!.illusionChance = { numerator: 4, denominator: 3 };
    expect(floorProblems(badChance).join()).toMatch(/floor 2: illusionChance/);

    const stray = clone();
    stray['6'] = good['1']!;
    expect(floorProblems(stray).join()).toMatch(/unknown floor key "6"/);
  });
});

describe('floorOf keys on the FLOOR (place), never the act counter (AC-8)', () => {
  it('place + 1', () => {
    expect([0, 1, 2, 3, 4].map((place) => floorOf({ place }))).toEqual([1, 2, 3, 4, 5]);
  });

  it('an ascent state (act 1, place 4) reads floor 5; act 5 at place 0 reads floor 1', () => {
    // The Hollow ascent (#18) will run act 1..5 while place runs 4..0. Keyed on act, the first
    // of these would read floor 1's (identity) modifiers and the second floor 5's.
    expect(floorOf({ place: 4, act: 1 } as { place: number })).toBe(5);
    expect(floorModifiers(floorOf({ place: 4 })).corruptsSkills).toBe(true);
    expect(floorOf({ place: 0, act: 5 } as { place: number })).toBe(1);
    expect(floorModifiers(floorOf({ place: 0 })).corruptsSkills).toBe(false);
  });

  it('a malformed place clamps to a real floor instead of throwing', () => {
    expect(floorOf({ place: -3 })).toBe(1);
    expect(floorOf({ place: 9 })).toBe(5);
    expect(floorOf({ place: 1.5 })).toBe(1);
  });

  it('floorContext reports a descent unless the (future) campaign field says ascent', () => {
    expect(floorContext({ place: 2 })).toEqual({ floor: 3, direction: 'descent' });
    expect(floorContext({ place: 2, campaign: 'ascent' })).toEqual({ floor: 3, direction: 'ascent' });
  });
});

describe('floorModifiers — the rulings, and identity everywhere else', () => {
  it('floor 3 halves healing and bleeds one charge at battle open (§22.24 "a slow weight")', () => {
    const m = floorModifiers(3);
    expect(m.healPct).toBe(50);
    expect(m.triggered).toEqual([
      { trigger: 'startOfBattle', action: { kind: 'drainCharge', params: { amount: 1 } } },
    ]);
  });

  it('floor 4 doubles karma and offers every bargain from the tempting pool', () => {
    expect(floorModifiers(4).karmaMultiplier).toBe(2);
    expect(floorModifiers(4).bargainPool).toBe('tempting');
  });

  it('floors without a mechanic are the identity (heal 100, no triggers, x1, no pool, no warp)', () => {
    for (const id of [1, 2, 5] as const) {
      const m = floorModifiers(id);
      expect(m.healPct, `${id}`).toBe(100);
      expect(m.triggered, `${id}`).toEqual([]);
      expect(m.karmaMultiplier, `${id}`).toBe(1);
      expect(m.bargainPool, `${id}`).toBeNull();
    }
    expect(floorModifiers(3).karmaMultiplier).toBe(1);
    expect([1, 2, 3, 4].map((f) => floorModifiers(f as 1).corruptsSkills)).toEqual([false, false, false, false]);
  });

  it('dampenHeal floors the product: 7 at 50% is 3, identity at 100', () => {
    expect(dampenHeal(7, 50)).toBe(3);
    expect(dampenHeal(4, 50)).toBe(2);
    expect(dampenHeal(7, 100)).toBe(7);
  });

  it('ILLUSION_DC is the frozen 13 (§22.27 / Appendix A.4)', () => {
    expect(ILLUSION_DC).toBe(13);
  });
});

// ------- AC-9: floor effects ride the SAME pipeline a relic uses ---------------------------

/** A hand-built relic whose only effect is the floor's own action, fired at battle open. */
const DRAIN_RELIC: ItemInstance = {
  defId: 'test:drain-relic',
  rolled: {
    name: 'Drain Relic',
    rarity: 'Rare',
    slot: 'amulet',
    kind: 'trinket',
    effects: [
      { type: 'triggered', trigger: 'startOfBattle', action: { kind: 'drainCharge', params: { amount: 1 } } },
    ],
  },
};

describe('floor triggers fire through the relic pipeline (AC-9)', () => {
  it('a floor-1 battle with no relics opens as the ORIGINAL object with no events', () => {
    const b = createBattle(player(), frozenEnemy(), 1);
    const opened = openBattle(b, 1);
    expect(opened.battle).toBe(b);
    expect(opened.events).toEqual([]);
  });

  it('a floor-3 battle opens with one charge drained and a floor-drain event', () => {
    const b = createBattle(player({ skillCharges: 5 }), frozenEnemy(), 3);
    const opened = openBattle(b, 3);
    expect(opened.battle.player.skillCharges).toBe(4);
    expect(opened.events).toEqual([{ kind: 'floor-drain', resource: 'skillCharge', amount: 1 }]);
  });

  it('with no charge to take, floor 3 changes nothing and says nothing', () => {
    const b = createBattle(player({ skillCharges: 0 }), frozenEnemy(), 3);
    const opened = openBattle(b, 3);
    expect(opened.battle).toBe(b);
    expect(opened.events).toEqual([]);
  });

  it('the SAME action on an equipped startOfBattle relic moves the player identically', () => {
    // One `applyEffectAction` arm serves both: a relic carrying `drainCharge` takes the same
    // charge the floor takes. Only the marker differs — `relic-triggered` vs `floor-drain`.
    const base = player({ skillCharges: 5 });
    const geared: Player = { ...base, inventory: { ...base.inventory, slots: { ...base.inventory.slots, amulet: DRAIN_RELIC } } };
    const enemy = frozenEnemy();
    const viaRelic = fireTrigger('startOfBattle', geared, enemy, {});
    const viaFloor = fireFloorTriggers('startOfBattle', 3, base, enemy, {});
    expect(viaRelic.player.skillCharges).toBe(4);
    expect(viaFloor.player.skillCharges).toBe(4);
    expect(viaRelic.events).toEqual([{ kind: 'relic-triggered', trigger: 'startOfBattle', action: 'drainCharge' }]);
    expect(viaFloor.events).toEqual([{ kind: 'floor-drain', resource: 'skillCharge', amount: 1 }]);
  });

  it('through step: continuing into a floor-3 battle drains; a floor-1 battle does not', () => {
    for (const [place, expected] of [[2, 4], [0, 5]] as const) {
      const p = player({ skillCharges: 5 });
      const s = battleState(p, frozenEnemy(), place);
      const unstarted: GameState = { ...s, phase: { kind: 'battle', battle: createBattle(p, frozenEnemy(), place + 1), started: false, final: false } };
      const r = step(unstarted, { kind: 'continue' });
      const b = r.state.phase.kind === 'battle' ? r.state.phase.battle : null;
      expect(b?.player.skillCharges, `place ${place}`).toBe(expected);
      expect(r.events.some((e) => e.kind === 'floor-drain'), `place ${place}`).toBe(place === 2);
    }
  });

  it('the drain keys on the FLOOR: an act-1 state standing on place 2 still drains', () => {
    const p = player({ skillCharges: 5 });
    const s = battleState(p, frozenEnemy(), 2, 1);
    const unstarted: GameState = { ...s, phase: { kind: 'battle', battle: createBattle(p, frozenEnemy(), 1), started: false, final: false } };
    const r = step(unstarted, { kind: 'continue' });
    expect(r.events).toContainEqual({ kind: 'floor-drain', resource: 'skillCharge', amount: 1 });
  });
});

// ------- AC-14: floor 3 dampens every heal site (except the rest, proved with the rest rework)

describe('floor 3 dampens healing — derived from healPct 50 (AC-14)', () => {
  it('a Suture Kit (heal 4) restores 2 on floor 3 and 4 on floor 1', () => {
    // A consumable costs the turn and grants the enemy nothing, so the step draws nothing and
    // the arithmetic is the whole story: hp 10 + floor(4 * 50 / 100) = 12, else 10 + 4 = 14.
    for (const [place, expected] of [[2, 12], [0, 14]] as const) {
      const base = player({ hp: 10, maxHp: 20 });
      const p: Player = { ...base, inventory: { ...base.inventory, backpack: [{ defId: 'suture-kit' }] } };
      const r = step(battleState(p, frozenEnemy(), place), {
        kind: 'battle-action',
        action: { kind: 'useConsumable', source: { index: 0 } },
      });
      const b = r.state.phase.kind === 'battle' ? r.state.phase.battle : null;
      expect(b?.player.hp, `place ${place}`).toBe(expected);
    }
  });

  it('a Void Draught (100% of max HP) restores half on floor 3', () => {
    // hp 4 / 20: floor 1 heals to 20; floor 3 heals floor(20 * 50/100) = 10 -> 14.
    for (const [place, expected] of [[2, 14], [0, 20]] as const) {
      const base = player({ hp: 4, maxHp: 20 });
      const p: Player = { ...base, inventory: { ...base.inventory, backpack: [{ defId: 'void-draught' }] } };
      const r = step(battleState(p, frozenEnemy(), place), {
        kind: 'battle-action',
        action: { kind: 'useConsumable', source: { index: 0 } },
      });
      const b = r.state.phase.kind === 'battle' ? r.state.phase.battle : null;
      expect(b?.player.hp, `place ${place}`).toBe(expected);
    }
  });

  it('Mend (selfHeal 4) restores 2 on floor 3 and 4 on floor 1', () => {
    // The enemy is frozen (skips, 0 draws) and the player has no conditions (0 draws), so the
    // cast round draws nothing: hp 10 + 2 = 12 on floor 3, 10 + 4 = 14 on floor 1.
    for (const [place, expected] of [[2, 12], [0, 14]] as const) {
      const p = player({ hp: 10, maxHp: 20, skillCharges: 5, skillPool: ['mend'] });
      const r = step(battleState(p, frozenEnemy(), place), {
        kind: 'battle-action',
        action: { kind: 'cast', skillId: 'mend' },
      });
      const b = r.state.phase.kind === 'battle' ? r.state.phase.battle : null;
      expect(b?.player.hp, `place ${place}`).toBe(expected);
    }
  });

  it('Siphon lifesteal (floor(3 x 0.5) = 1) rounds to 0 on floor 3', () => {
    // Siphon: base 3 Psychic vs 0 resist, INT 13 gives no augment delta -> 3 damage; lifesteal
    // floor(3 * 0.5) = 1 on floor 1; floor(1 * 50 / 100) = 0 on floor 3. hp 10 -> 11 / 10.
    for (const [place, expected] of [[2, 10], [0, 11]] as const) {
      const p = player({ hp: 10, maxHp: 20, skillCharges: 5, skillPool: ['siphon'] });
      const r = step(battleState(p, frozenEnemy(), place), {
        kind: 'battle-action',
        action: { kind: 'cast', skillId: 'siphon' },
      });
      const b = r.state.phase.kind === 'battle' ? r.state.phase.battle : null;
      expect(b?.player.hp, `place ${place}`).toBe(expected);
    }
  });
});

// ------- AC-15: floor 4 counts double ------------------------------------------------------

describe('floor-4 karma counts double, with no new state (AC-15)', () => {
  function weighted(familyId: string): Enemy {
    const family = getFamily(familyId)!;
    return { ...frozenEnemy(), familyId: family.id, karmaWeighted: true };
  }

  it('a spare of a plain weighted enemy: mercy +2 on floor 4, +1 on floor 3', () => {
    // `gangers` spares as ['spareWeighted'] = { mercyCruelty: +1 }; x2 on floor 4 (§22.24).
    expect(getFamily('gangers')!.onSpare).toEqual(['spareWeighted']);
    for (const [place, expected] of [[3, 2], [2, 1]] as const) {
      const r = step(battleState(player(), weighted('gangers'), place), { kind: 'battle-action', action: 'spare' });
      expect(r.state.karma.mercyCruelty, `place ${place}`).toBe(expected);
      expect(r.state.karma.reverenceDesecration).toBe(0);
    }
  });

  it('a desecrate bargain paid on floor 4 moves reverence by -4 (desecrateShrine -2, x2)', () => {
    for (const [place, expected] of [[3, -4], [0, -2]] as const) {
      const base: GameState = battleState(player(), frozenEnemy(), place);
      const s: GameState = {
        ...base,
        phase: {
          kind: 'deal',
          deal: { pool: 'tempting', cost: { kind: 'desecrate' }, reward: { kind: 'statPoint', stat: 'STR' } },
        },
      };
      const r = step(s, { kind: 'deal-decision', accept: true });
      expect(r.state.karma.reverenceDesecration, `place ${place}`).toBe(expected);
    }
  });

  it('a kill of a weighted enemy on floor 4 records cruelty x2', () => {
    // A 1-HP weighted enemy dies to any hit; the damage roll consumes draws but the karma is
    // decided by the outcome alone: killWeighted = mercy -1, x2 on floor 4.
    const p = player();
    let killed = 0;
    for (let seed = 1; seed <= 30 && killed === 0; seed++) {
      const s = { ...battleState(p, { ...weighted('gangers'), hp: 1, armorClass: 1 }, 3), rngState: seed };
      const r = step(s, { kind: 'battle-action', action: 'fight' });
      if (r.state.phase.kind === 'battle-victory') {
        killed += 1;
        expect(r.state.karma.mercyCruelty).toBe(-2);
      }
    }
    expect(killed).toBe(1); // non-vacuity: a kill really happened
  });
});
