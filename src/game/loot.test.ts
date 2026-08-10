// Tests for found-loot sourcing (M7). Every expected value is hand-derived from rng.ts
// semantics (`randInt` = floor(x*n); `weightedPick` = 1+randInt(total) cumulative;
// `generateItem` = magnitude draw then proc draw) and the RARITY_TABLE / dropTables.json
// data — never measured from the implementation.
//
// DEVIATION from the plan's Design: the design listed a separate "ring/amulet stat pick"
// draw (draw 4) inside rollLootDrop. The plan's own observable anchor for the forced Common
// ring uses a FIVE-draw queue with no stat draw, so the implementation omits it — a dropped
// trinket's stat defaults to STR. This test follows the anchor (5 draws).

import { describe, it, expect } from 'vitest';
import { rollLootDrop, rollChestLoot, getDropTable } from './loot.ts';
import { mulberry32, type Rng } from './rng.ts';

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`scriptedRng exhausted: only ${values.length} draw(s) scripted`);
    }
    return values[i++]!;
  };
}

describe('rollLootDrop — seeded, hand-derived anchors (act 1)', () => {
  // Act-1 table (dropTables.json): dropChance 0.5, rarityWeights {Common:5,Rare:3,Legendary:1}
  // (total 9), slotWeights {mainHand:2,armor:2,ring:1} (total 5, order mainHand,armor,ring).
  it('drops a Common +1 ring for the anchor draw queue', () => {
    // Queue [0.10, 0.00, 0.8, 0.00, 0.00]:
    //  gate  0.10 < 0.5 -> drops.
    //  rarity r = 1+floor(0.00*9)=1 -> cumulative Common(5) >= 1 -> Common.
    //  slot   r = 1+floor(0.8*5)=1+4=5 -> cumulative mainHand2,armor4,ring5 >= 5 -> ring.
    //  magnitude = 1 + floor(0.00*2) = 1 ; proc = 0.00 < 0 (Common procChance 0) -> none.
    const drop = rollLootDrop(1, scriptedRng([0.1, 0.0, 0.8, 0.0, 0.0]));
    expect(drop).not.toBeNull();
    expect(drop!.rolled!.rarity).toBe('Common');
    expect(drop!.rolled!.slot).toBe('ring');
    expect(drop!.rolled!.kind).toBe('trinket');
    // A +1 STR ring the player can equip; exactly one effect (no proc).
    expect(drop!.rolled!.effects).toEqual([{ type: 'bonusStat', params: { str: 1 } }]);
  });

  it('returns null (no drop) when the gate fails, consuming exactly one draw', () => {
    // Queue [0.99]: gate 0.99 >= 0.5 -> null. Only the gate draw is consumed (scriptedRng
    // would throw if a second draw were taken).
    expect(rollLootDrop(1, scriptedRng([0.99]))).toBeNull();
  });

  it('a forced Legendary out-rolls any Common and always carries an onHit proc', () => {
    // Queue [0.10, 0.99, 0.8, 0.5, 0.5]:
    //  gate 0.10 -> drops.
    //  rarity r = 1+floor(0.99*9)=1+8=9 -> cumulative Common5,Rare8,Legendary9 >= 9 -> Legendary.
    //  slot 0.8 -> ring (as above).
    //  magnitude = statBase 6 + floor(0.5*4)=6+2=8  (in [6,9], strictly > Common max 2).
    //  proc = 0.5 < 1 (Legendary procChance 1) -> guaranteed onHit dealDamage.
    const drop = rollLootDrop(1, scriptedRng([0.1, 0.99, 0.8, 0.5, 0.5]));
    expect(drop!.rolled!.rarity).toBe('Legendary');
    const effects = drop!.rolled!.effects;
    expect(effects[0]).toEqual({ type: 'bonusStat', params: { str: 8 } });
    expect(effects).toContainEqual({
      type: 'triggered',
      trigger: 'onHit',
      action: { kind: 'dealDamage', params: { amount: 3 } },
    });
  });

  it('is deterministic: the same seed + act rolls the identical drop', () => {
    const a = rollLootDrop(2, mulberry32(4242));
    const b = rollLootDrop(2, mulberry32(4242));
    expect(a).toEqual(b);
  });

  it('acts beyond 4 reuse the act-4 table', () => {
    expect(getDropTable(7)).toBe(getDropTable(4));
  });
});

describe('rollChestLoot — guaranteed, seeded (no drop gate)', () => {
  // Chest table: rarityWeights {Common:2,Rare:3,Legendary:2} (total 7), slotWeights
  // {mainHand:2,armor:2,ring:1,amulet:1} (SLOT_ORDER: amulet1,mainHand2,armor2,ring1; total 6),
  // chestItemCount 1. Draw order per item: rarity, slot, magnitude, proc (NO gate).
  it('yields exactly one hand-derived item (Common mainHand +1)', () => {
    // Queue [0.00, 0.2, 0.00, 0.00]:
    //  rarity r = 1+floor(0.00*7)=1 -> Common (cumulative 2 >= 1).
    //  slot   r = 1+floor(0.2*6)=1+1=2 -> cumulative amulet1,mainHand3 >= 2 -> mainHand.
    //  magnitude = 1 + floor(0.00*2) = 1 (weapon -> bonusDamage) ; proc 0.00 < 0 -> none.
    const items = rollChestLoot(scriptedRng([0.0, 0.2, 0.0, 0.0]));
    expect(items).toHaveLength(1);
    expect(items[0]!.rolled!.rarity).toBe('Common');
    expect(items[0]!.rolled!.slot).toBe('mainHand');
    expect(items[0]!.rolled!.effects).toEqual([{ type: 'bonusDamage', params: { amount: 1 } }]);
  });

  it('is deterministic for a fixed seed', () => {
    expect(rollChestLoot(mulberry32(99))).toEqual(rollChestLoot(mulberry32(99)));
  });
});
