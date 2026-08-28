import { describe, it, expect } from 'vitest';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy } from './enemy.ts';
import { createBattle, openBattle, resolveRound, type BattleAction, type BattleState } from './battle.ts';
import { createRng } from './rng.ts';
import { pickUp, equip } from './equipment.ts';
import { sumDamageSources } from './combatEvent.ts';
import { getAllRelics, getAllUniques, getAllConsumables } from './item.ts';
import { effectiveMaxHp } from './statEffects.ts';
import { CLASSES } from './classKit.ts';
import type { Stats } from './character.ts';
import type { PlayerClass } from './player.ts';
import { resolveSkill } from './skill.ts';
import { computeEquipModifiers } from './equipEffects.ts';
import { castOptions } from '../desktop/view-model.ts';

const STATS: Stats = { STR: 14, DEX: 12, CON: 14, INT: 12, WIS: 12, CHA: 10 };

function withItems(classId: PlayerClass, equipped: string[], pack: string[]): Player {
  let p = createPlayer({ name: 'Probe', classId, stats: STATS });
  for (const id of equipped) {
    let inv = pickUp(p.inventory, { defId: id });
    const r = equip(inv, inv.backpack.length - 1);
    if (!r.ok) throw new Error(`could not equip ${id}`);
    p = { ...p, inventory: r.inventory };
  }
  let inv = p.inventory;
  for (const id of pack) inv = pickUp(inv, { defId: id });
  return { ...p, inventory: inv, skillPool: [...CLASSES[classId].kit] };
}

describe('probe: combat fuzz — invariants', () => {
  it('damageSources always sum to damage; hp never exceeds max or goes negative', () => {
    const relics = getAllRelics().map((r) => r.id);
    const uniques = getAllUniques().map((r) => r.id);
    const consumables = getAllConsumables().map((c) => c.id);
    const classes: PlayerClass[] = ['Enforcer', 'Neuromancer', 'Scavver', 'Penitent', 'Hollow'];
    const problems: string[] = [];
    let rounds = 0;

    for (let seed = 1; seed <= 400; seed++) {
      const { rng } = createRng(seed * 2654435761);
      const classId = classes[seed % classes.length]!;
      // pick a couple of equippable trinkets (ring/amulet slots)
      const pool = [...relics, ...uniques];
      const a = pool[seed % pool.length]!;
      const b = pool[(seed * 7 + 3) % pool.length]!;
      let p: Player;
      try {
        p = withItems(classId, [a, b], consumables);
      } catch {
        try { p = withItems(classId, [a], consumables); } catch { p = withItems(classId, [], consumables); }
      }
      const enemy = generateEnemy({ act: 1 + (seed % 5), type: 'Beast', playerXp: seed % 100 }, rng);
      let battle: BattleState = createBattle(p, { ...enemy, hp: 60, maxHp: 60 }, 1 + (seed % 5));
      battle = openBattle(battle).battle;

      const actions: BattleAction[] = [
        'fight', 'potion', 'run', 'spare',
        ...CLASSES[classId].kit.map((id) => ({ kind: 'cast', skillId: id }) as BattleAction),
        { kind: 'useConsumable', source: { index: 0 } },
        { kind: 'useConsumable', source: { index: 1 } },
      ];
      for (let step = 0; step < 25; step++) {
        const act = actions[(seed * 31 + step * 17) % actions.length]!;
        const res = resolveRound(battle, act, rng);
        rounds++;
        for (const e of res.events) {
          if (e.kind === 'attack' || e.kind === 'skill-cast') {
            const sum = sumDamageSources(e.damageSources);
            if (sum !== e.damage) {
              problems.push(`sum!=damage seed=${seed} step=${step} kind=${e.kind} sum=${sum} damage=${e.damage}`);
            }
          }
        }
        const bp = res.state.player;
        const be = res.state.enemy;
        if (bp.hp < 0) problems.push(`player hp<0 seed=${seed} step=${step} hp=${bp.hp}`);
        if (be.hp < 0) problems.push(`enemy hp<0 seed=${seed} step=${step} hp=${be.hp}`);
        if (bp.hp > effectiveMaxHp(bp)) problems.push(`player hp>effMax seed=${seed} step=${step} ${bp.hp}>${effectiveMaxHp(bp)} act=${JSON.stringify(act)}`);
        if (bp.skillCharges < 0) problems.push(`charges<0 seed=${seed} step=${step} ${bp.skillCharges} act=${JSON.stringify(act)}`);
        if (bp.maxHp <= 0) problems.push(`maxHp<=0 seed=${seed} step=${step}`);
        if (res.status !== 'ongoing') break;
        battle = res.state;
      }
    }
    const uniq = [...new Set(problems.map((p) => p.split(' seed=')[0]))];
    console.log('ROUNDS', rounds, 'PROBLEM KINDS', JSON.stringify(uniq, null, 1));
    console.log('FIRST 12', problems.slice(0, 12).join('\n'));
  });
});

describe('probe: UI cast affordability vs engine', () => {
  it('overclock-chip: engine allows a cast the UI marks unaffordable', () => {
    const p0 = withItems('Enforcer', ['overclock-chip'], []);
    const p = { ...p0, skillCharges: 1 };
    const discount = computeEquipModifiers(p.inventory).chargeDiscount;
    const hs = resolveSkill(p, 'heavyStrike');
    const effectiveCost = Math.max(hs.chargeCost - discount, 0);
    const ui = castOptions(p).find((c) => c.skillId === 'heavyStrike');
    console.log('discount', discount, 'chargeCost', hs.chargeCost, 'effectiveCost', effectiveCost,
      'player charges', p.skillCharges, 'UI affordable', ui?.affordable);
    const { rng } = createRng(5);
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, rng);
    const res = resolveRound(createBattle(p, { ...enemy, hp: 50, maxHp: 50 }, 1), { kind: 'cast', skillId: 'heavyStrike' }, rng);
    const rejected = res.events.some((e) => e.kind === 'cast-unavailable');
    console.log('engine rejected the cast?', rejected, 'events', res.events.map((e) => e.kind).join(','));
    expect(ui?.affordable).toBe(false);
    expect(rejected).toBe(false);
  });
});
