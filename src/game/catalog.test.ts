// Tests for the M6 seed catalogs + id resolution + rolled-instance resolution.
//
// Expected values are derived by hand from the catalog JSON authored in this unit
// (src/data/relics.json, uniques.json, consumables.json) and the schema in item.ts —
// never read back from code output. The counts below are the exact seed-set sizes
// the plan / GAME-DESIGN §6 specify.

import { describe, expect, it } from 'vitest';
import {
  getAllItems,
  getAllRelics,
  getAllUniques,
  getAllConsumables,
  getItemById,
  getCatalogItemById,
  type ItemEffect,
  type EffectActionKind,
  type TriggerType,
} from './item.ts';
import { resolveInstanceDef, resolveGearDef } from './equipment.ts';

const KNOWN_TRIGGERS: ReadonlySet<TriggerType> = new Set<TriggerType>([
  'startOfBattle',
  'onHit',
  'onCrit',
  'onCast',
  'onKill',
  'onTakeDamage',
]);
const KNOWN_ACTION_KINDS: ReadonlySet<EffectActionKind> = new Set<EffectActionKind>([
  'dealDamage',
  'healSelf',
  'applyConditionSelf',
  'applyConditionEnemy',
  'gainShield',
  'gainStat',
  'restoreCharge',
  'revive',
  'cure',
  'flee',
  'reroll',
]);

/** Structural validity of a single effect (passive bag, or a well-formed triggered effect). */
function effectIsValid(effect: ItemEffect): boolean {
  if (effect.type === 'triggered') {
    return KNOWN_TRIGGERS.has(effect.trigger) && KNOWN_ACTION_KINDS.has(effect.action.kind);
  }
  return typeof effect.params === 'object' && effect.params !== null;
}

describe('seed-catalog sizes (hand-counted from §6)', () => {
  it('ships exactly 15 relics, 4 uniques, 19 consumables', () => {
    expect(getAllRelics().length).toBe(15);
    expect(getAllUniques().length).toBe(4);
    expect(getAllConsumables().length).toBe(19);
  });

  it('leaves the base items table unchanged (still 4 entries)', () => {
    expect(getAllItems().length).toBe(4);
  });
});

describe('every seed relic + unique carries at least one valid effect', () => {
  it('all relic effects are structurally valid', () => {
    for (const relic of getAllRelics()) {
      expect(relic.kind).toBe('trinket');
      expect(relic.effects.length).toBeGreaterThan(0);
      for (const e of relic.effects) expect(effectIsValid(e)).toBe(true);
    }
  });

  it('all unique effects are structurally valid', () => {
    for (const u of getAllUniques()) {
      expect(u.effects.length).toBeGreaterThan(0);
      for (const e of u.effects) expect(effectIsValid(e)).toBe(true);
    }
  });
});

describe('every consumable carries a non-empty, valid use array', () => {
  it('all consumable use actions are structurally valid', () => {
    for (const c of getAllConsumables()) {
      expect(c.kind).toBe('usable');
      expect(c.slot).toBeNull();
      expect(Array.isArray(c.use)).toBe(true);
      expect(c.use!.length).toBeGreaterThan(0);
      for (const a of c.use!) expect(KNOWN_ACTION_KINDS.has(a.kind)).toBe(true);
    }
  });
});

describe('getCatalogItemById resolves across every catalog', () => {
  it('resolves a base item, a relic, a unique, and a consumable', () => {
    expect(getCatalogItemById('rusted-blade')?.name).toBe('Rusted Blade');
    expect(getCatalogItemById('mirror-shard')?.name).toBe('Mirror Shard');
    expect(getCatalogItemById('reflections-edge')?.name).toBe("Reflection's Edge");
    expect(getCatalogItemById('antidote')?.name).toBe('Antidote');
  });

  it('returns undefined for an unknown id', () => {
    expect(getCatalogItemById('no-such-thing')).toBeUndefined();
  });

  it('getItemById still only sees the base table (relics/uniques are NOT base items)', () => {
    expect(getItemById('mirror-shard')).toBeUndefined();
    expect(getItemById('reflections-edge')).toBeUndefined();
  });
});

describe('resolveInstanceDef', () => {
  it('resolves a plain relic instance through the catalog', () => {
    const def = resolveInstanceDef({ defId: 'mirror-shard' });
    expect(def).toBeDefined();
    expect(def!.kind).toBe('trinket');
    expect(def!.slot).toBe('ring');
    // Its single effect is the onTakeDamage reflect (matches resolveGearDef of the same id).
    expect(def!.effects).toEqual(resolveGearDef('mirror-shard')!.effects);
  });

  it('resolves a rolled instance straight from its overlay (no catalog lookup)', () => {
    const rolled = {
      defId: 'gen:xyz',
      rolled: {
        name: 'Forged Blade',
        rarity: 'Legendary' as const,
        slot: 'mainHand' as const,
        kind: 'weapon' as const,
        effects: [{ type: 'bonusDamage', params: { amount: 7 } }] as ItemEffect[],
      },
    };
    const def = resolveInstanceDef(rolled);
    expect(def).toBeDefined();
    expect(def!.kind).toBe('weapon');
    expect(def!.slot).toBe('mainHand');
    expect(def!.rarity).toBe('Legendary');
    expect(def!.effects).toEqual([{ type: 'bonusDamage', params: { amount: 7 } }]);
  });
});
