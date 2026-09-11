// Floor 5 — the warped kit (PLAN.md #2, AC-18).
//
// The ruling (GAME-DESIGN.md §22.24): each owned skill gets ONE corrupted form on arrival at
// the True Void, SEEDED PER RUN — learnable within the run, different the next. Every expected
// number below is derived by hand from `SKILLS` + the placeholder templates in
// `corruptions.json`, never read back from `resolveSkill`.

import { describe, it, expect } from 'vitest';
import { CORRUPTION_TEMPLATES, corruptionTemplate, rollCorruptions } from './corruption.ts';
import { resolveSkill, SKILLS } from './skill.ts';
import { step, type GameState } from './game.ts';
import { createPlayer, type Player } from './player.ts';
import { createKarma } from './karma.ts';
import { generateEnemy } from './enemy.ts';
import { createBattle } from './battle.ts';
import { getElement } from './element.ts';
import { CONDITION_DATA } from './condition.ts';
import { mulberry32, type Rng } from './rng.ts';
import { type Stats } from './character.ts';

const STATS: Stats = { STR: 12, DEX: 12, CON: 12, INT: 12, WIS: 12, CHA: 12 };

function hero(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: STATS }), ...overrides };
}

/** An act-outro standing on the NEW floor (advanceAct already moved `place`). */
function arriving(newAct: number, player: Player, rngState: number): GameState {
  return {
    version: 9,
    rngState,
    player,
    act: newAct,
    place: newAct - 1,
    karma: createKarma(),
    phase: { kind: 'act-outro', newAct },
  };
}

function counting(seed: number): Rng & { count: () => number } {
  const base = mulberry32(seed);
  let n = 0;
  const rng = (() => {
    n += 1;
    return base();
  }) as Rng & { count: () => number };
  rng.count = () => n;
  return rng;
}

describe('corruptions.json — the placeholder templates are well-formed', () => {
  it('four templates, unique ids, every one visibly suffixed', () => {
    expect(CORRUPTION_TEMPLATES.map((t) => t.id)).toEqual(['warped', 'bleeding', 'dulled', 'static']);
    for (const t of CORRUPTION_TEMPLATES) expect(t.suffix.length, t.id).toBeGreaterThan(0);
  });

  it('every element resolves and every added condition is a real condition', () => {
    for (const t of CORRUPTION_TEMPLATES) {
      if (t.element !== undefined) expect(getElement(t.element), t.id).not.toBeUndefined();
      for (const c of t.addConditions ?? []) expect(CONDITION_DATA[c], `${t.id}: ${c}`).toBeDefined();
    }
  });

  it('every template CHANGES something — "something gained and something taken"', () => {
    for (const t of CORRUPTION_TEMPLATES) {
      const moves = [t.chargeDelta, t.damageBonus, t.hpCost, t.element, t.addConditions?.length]
        .filter((v) => v !== undefined && v !== 0);
      expect(moves.length, t.id).toBeGreaterThan(0);
    }
  });
});

describe('resolveSkill merges the corruption AFTER any upgrade (AC-18)', () => {
  it('warped Heavy Strike: cost 2+1 = 3, damage 3+1 = 4, Psychic, named', () => {
    // SKILLS.heavyStrike: cost 2, base 3, Physical, ['fracture']. Template warped: +1 cost,
    // +1 damage, element Psychic.
    expect(SKILLS.heavyStrike).toMatchObject({ chargeCost: 2, baseDamage: 3, element: 'Physical' });
    const s = resolveSkill(hero({ corruptedSkills: { heavyStrike: 'warped' } }), 'heavyStrike');
    expect(s).toMatchObject({
      id: 'heavyStrike',
      name: 'Heavy Strike (warped)',
      chargeCost: 3,
      baseDamage: 4,
      element: 'Psychic',
      conditions: ['fracture'],
    });
  });

  it('dulled Brace: cost 1-1 = 0, damage 0-1 clamps to 0', () => {
    const s = resolveSkill(hero({ corruptedSkills: { brace: 'dulled' } }), 'brace');
    expect(s).toMatchObject({ name: 'Brace (dulled)', chargeCost: 0, baseDamage: 0 });
  });

  it('static Mind Spike: Electro, and it now also weakens', () => {
    const s = resolveSkill(hero({ corruptedSkills: { mindSpike: 'static' } }), 'mindSpike');
    expect(s).toMatchObject({ element: 'Electro', conditions: ['insanity', 'weak'], chargeCost: 1, baseDamage: 2 });
  });

  it('bleeding Smite: its HP price 2+1 = 3, damage 3+2 = 5; a skill with no price gains one', () => {
    expect(resolveSkill(hero({ corruptedSkills: { smite: 'bleeding' } }), 'smite')).toMatchObject({
      hpCost: 3,
      baseDamage: 5,
    });
    expect(resolveSkill(hero({ corruptedSkills: { brace: 'bleeding' } }), 'brace').hpCost).toBe(1);
  });

  it('an upgrade is warped along with its skill: +2 drafted, then warped, is 3+2+1 = 6', () => {
    const p = hero({
      skillUpgrades: { heavyStrike: { damageBonus: 2 } },
      corruptedSkills: { heavyStrike: 'warped' },
    });
    expect(resolveSkill(p, 'heavyStrike')).toMatchObject({ baseDamage: 6, chargeCost: 3 });
  });

  it('no map (every floor but 5) returns the SAME object as the table (off-equivalence)', () => {
    expect(resolveSkill(hero(), 'heavyStrike')).toBe(SKILLS.heavyStrike);
    // A map that does not name this skill, or names an unknown template, warps nothing.
    expect(resolveSkill(hero({ corruptedSkills: { brace: 'warped' } }), 'heavyStrike')).toBe(SKILLS.heavyStrike);
    expect(resolveSkill(hero({ corruptedSkills: { heavyStrike: 'no-such' } }), 'heavyStrike')).toBe(SKILLS.heavyStrike);
    expect(corruptionTemplate('no-such')).toBeUndefined();
  });
});

describe('rollCorruptions — one draw per skill, in pool order', () => {
  it('N skills take exactly N draws; an empty pool takes none', () => {
    const r3 = counting(5);
    expect(Object.keys(rollCorruptions(['heavyStrike', 'brace', 'execute'], r3))).toEqual(['heavyStrike', 'brace', 'execute']);
    expect(r3.count()).toBe(3);
    const r0 = counting(5);
    expect(rollCorruptions([], r0)).toEqual({});
    expect(r0.count()).toBe(0);
  });

  it('every entry names a real template', () => {
    const map = rollCorruptions(['heavyStrike', 'brace'], mulberry32(3));
    for (const id of Object.values(map)) expect(corruptionTemplate(id)).toBeDefined();
  });
});

describe('arriving on floor 5 warps the kit, through step (AC-18)', () => {
  it('writes one entry per owned skill and emits skills-warped with that count', () => {
    const p = hero({ skillPool: ['heavyStrike', 'brace', 'execute'] });
    const r = step(arriving(5, p, 42), { kind: 'continue' });
    expect(r.state.phase.kind).toBe('act-intro');
    const map = r.state.player!.corruptedSkills!;
    expect(Object.keys(map).sort()).toEqual(['brace', 'execute', 'heavyStrike']);
    expect(r.events).toContainEqual({ kind: 'skills-warped', count: 3 });
  });

  it('the same seed gives the same map; seeds 1..50 give at least two different maps', () => {
    const p = hero({ skillPool: ['heavyStrike', 'brace'] });
    const once = step(arriving(5, p, 7), { kind: 'continue' }).state.player!.corruptedSkills;
    const twice = step(arriving(5, p, 7), { kind: 'continue' }).state.player!.corruptedSkills;
    expect(twice).toEqual(once);
    const distinct = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      distinct.add(JSON.stringify(step(arriving(5, p, seed), { kind: 'continue' }).state.player!.corruptedSkills));
    }
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it('arriving on floors 2-4 warps nothing and draws nothing', () => {
    for (const newAct of [2, 3, 4]) {
      const s = arriving(newAct, hero(), 42);
      const r = step(s, { kind: 'continue' });
      expect(r.state.player!.corruptedSkills, `act ${newAct}`).toBeUndefined();
      expect(r.state.rngState, `act ${newAct}`).toBe(s.rngState);
      expect(r.events.some((e) => e.kind === 'skills-warped')).toBe(false);
    }
  });

  it('keys on the floor, not the act: an act-2 state standing on place 4 warps', () => {
    const s: GameState = { ...arriving(2, hero(), 42), place: 4 };
    expect(step(s, { kind: 'continue' }).state.player!.corruptedSkills).toBeDefined();
  });

  it('an existing map is never re-rolled', () => {
    const p = hero({ corruptedSkills: { heavyStrike: 'dulled' } });
    const r = step(arriving(5, p, 42), { kind: 'continue' });
    expect(r.state.player!.corruptedSkills).toEqual({ heavyStrike: 'dulled' });
  });

  it('the warped cost is the cost the engine charges: 3 charges cast it, 2 cannot', () => {
    const battleAt = (charges: number): GameState => {
      const p = hero({ corruptedSkills: { heavyStrike: 'warped' }, skillPool: ['heavyStrike'], skillCharges: charges });
      const enemy = generateEnemy({ act: 5, type: 'Beast', playerXp: 0 }, mulberry32(8));
      return { ...arriving(5, p, 3), phase: { kind: 'battle', battle: createBattle(p, enemy, 5), started: true, final: false } };
    };
    // 2 charges: rejected before any round resolves — the warped cost (3), not the base (2).
    expect(step(battleAt(2), { kind: 'battle-action', action: { kind: 'cast', skillId: 'heavyStrike' } }).events).toEqual([
      { kind: 'cast-unavailable' },
    ]);
    // 3 charges: cast, under its warped name, and all three are spent.
    const r = step(battleAt(3), { kind: 'battle-action', action: { kind: 'cast', skillId: 'heavyStrike' } });
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'skill-cast', name: 'Heavy Strike (warped)' }));
    const b = r.state.phase.kind === 'battle' ? r.state.phase.battle : null;
    expect(b?.player.skillCharges ?? 0).toBe(0);
  });
});
