import { describe, expect, it } from 'vitest';
import { perkModifiers, PERKS, PERK_IDS } from './perks.ts';
import { createPlayer } from './player.ts';
import { createBattle, resolveRound } from './battle.ts';
import { playerArmorClass } from './defense.ts';
import { generateEnemy } from './enemy.ts';
import { makeCondition } from './condition.ts';
import { mulberry32, type Rng } from './rng.ts';
import { type Stats } from './character.ts';

// Every expectation is hand-derived from the wired-field perk rules (sharpEdge = +1 flat
// damage, wardingCharm = +1 flatAc, deepReserves = onPick +1 max charge). Combat anchors
// run the SAME scripted rng for both players so the ONLY difference is the perk.

const STATS: Stats = { STR: 14, DEX: 12, CON: 12, INT: 12, WIS: 10, CHA: 10 };

function enforcer(perks: string[] = []) {
  return { ...createPlayer({ name: 'Ari', classId: 'Enforcer', stats: STATS }), perks };
}

/** A frozen, harmless enemy: it skips its attack (0 draws) so the round's only draws are the
 *  player's. High hp so it survives the hit (no victory draws). */
function frozenEnemy() {
  return {
    ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(5)),
    hp: 200,
    maxHp: 200,
    armorClass: 1, // any positive to-hit total lands
    skillPool: [] as string[],
    skillCharges: 0,
    activeConditions: [makeCondition('freeze')],
  };
}

/** A fresh scripted rng: first draw is a mid d20 (natural 12 -> plain hit), rest are 0. */
function hitRng(): Rng {
  const values = [0.55]; // 1 + floor(0.55*20) = 12
  let i = 0;
  return () => values[i++] ?? 0;
}

describe('perkModifiers', () => {
  it('empty list is the zero bundle (off-equivalence)', () => {
    expect(perkModifiers([])).toEqual({ flatDamage: 0, flatAc: 0 });
  });

  it('sharpEdge -> +1 flatDamage; wardingCharm -> +1 flatAc; both stack when repeated', () => {
    expect(perkModifiers(['sharpEdge'])).toEqual({ flatDamage: 1, flatAc: 0 });
    expect(perkModifiers(['wardingCharm'])).toEqual({ flatDamage: 0, flatAc: 1 });
    expect(perkModifiers(['sharpEdge', 'sharpEdge'])).toEqual({ flatDamage: 2, flatAc: 0 });
    expect(perkModifiers(['sharpEdge', 'wardingCharm'])).toEqual({ flatDamage: 1, flatAc: 1 });
  });

  it('deepReserves (onPick) and unknown ids contribute nothing to the summed seams', () => {
    expect(perkModifiers(['deepReserves'])).toEqual({ flatDamage: 0, flatAc: 0 });
    expect(perkModifiers(['bogus'])).toEqual({ flatDamage: 0, flatAc: 0 });
  });

  it('catalog is wired-field-only and PERK_IDS lists it in insertion order', () => {
    expect(PERK_IDS).toEqual(['sharpEdge', 'wardingCharm', 'deepReserves']);
    expect(PERKS.deepReserves?.apply).toBe('onPick');
    expect(PERKS.sharpEdge?.apply).toBe('modifier');
  });
});

describe('perk combat anchors (through the real fold, before/after hand-derived)', () => {
  it('sharpEdge raises a basic attack\'s damage by exactly 1', () => {
    const enemy = frozenEnemy();
    const without = resolveRound(createBattle(enforcer(), enemy, 1), 'fight', hitRng());
    const withPerk = resolveRound(createBattle(enforcer(['sharpEdge']), enemy, 1), 'fight', hitRng());
    // Both hit off the identical scripted rng; the ONLY difference is +1 flat damage, so the
    // enemy takes exactly one more point of damage (hp one lower).
    const dmgWithout = enemy.hp - without.state.enemy.hp;
    const dmgWith = enemy.hp - withPerk.state.enemy.hp;
    expect(dmgWithout).toBeGreaterThan(0); // guard: the attack actually landed
    expect(dmgWith - dmgWithout).toBe(1);
  });

  it('wardingCharm raises playerArmorClass by exactly 1 through the real defense path', () => {
    const base = playerArmorClass(enforcer());
    expect(playerArmorClass(enforcer(['wardingCharm']))).toBe(base + 1);
    // Two stack to +2.
    expect(playerArmorClass(enforcer(['wardingCharm', 'wardingCharm']))).toBe(base + 2);
  });
});
