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
import {
  rollLootDrop,
  rollChestLoot,
  rollDropFromTable,
  getDropTable,
  summarizeLoot,
  type DropTable,
} from './loot.ts';
import { mulberry32, type Rng } from './rng.ts';
import { getAllRelics, getAllUniques, getCatalogItemById } from './item.ts';

function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`scriptedRng exhausted: only ${values.length} draw(s) scripted`);
    }
    return values[i++]!;
  };
}

// G14 CHANGED THE DOCUMENTED DRAW ORDER. A fourth draw — the CATALOG GATE — now sits
// between the slot draw and the item's own two, on every table that declares a `catalog`
// block (all five act tables and the chest do). So every scripted queue below keeps its
// first three values exactly as they were and gains one: `>= 0.45` takes the generated-gear
// branch these tests were written for, `< 0.45` takes the authored-catalog branch.
//
// These expectations are NOT "the old ones patched until green": the drop table now carries
// authored catalog items BY DESIGN (G14 — it is why the game had no healing), so the old
// queues describe a table that no longer exists. The gear-branch outcomes themselves are
// unchanged, which is the point of putting the gate at (4) rather than (2).
const GEAR = 0.9; // >= catalog.chance 0.45 -> the generated-gear branch
const CATALOG = 0.0; // < catalog.chance 0.45 -> the authored-catalog branch

describe('rollLootDrop — seeded, hand-derived anchors (act 1)', () => {
  // Act-1 table (dropTables.json): dropChance 0.5, rarityWeights {Common:5,Rare:3,Legendary:1}
  // (total 9), slotWeights {mainHand:2,armor:2,ring:1} (total 5, order mainHand,armor,ring),
  // catalog {chance 0.45, poolWeights {heal:5,utility:4,unique:1}}.
  it('drops a Common +1 ring for the anchor draw queue', () => {
    // Queue [0.10, 0.00, 0.8, GEAR, 0.00, 0.00]:
    //  gate  0.10 < 0.5 -> drops.
    //  rarity r = 1+floor(0.00*9)=1 -> cumulative Common(5) >= 1 -> Common.
    //  slot   r = 1+floor(0.8*5)=1+4=5 -> cumulative mainHand2,armor4,ring5 >= 5 -> ring.
    //  catalog gate 0.9 >= 0.45 -> generated gear.
    //  magnitude = 1 + floor(0.00*2) = 1 ; proc = 0.00 < 0 (Common procChance 0) -> none.
    const drop = rollLootDrop(1, scriptedRng([0.1, 0.0, 0.8, GEAR, 0.0, 0.0]));
    expect(drop).not.toBeNull();
    expect(drop!.rolled!.rarity).toBe('Common');
    expect(drop!.rolled!.slot).toBe('ring');
    expect(drop!.rolled!.kind).toBe('trinket');
    // A +1 STR ring the player can equip; exactly one effect (no proc).
    expect(drop!.rolled!.effects).toEqual([{ type: 'bonusStat', params: { str: 1 } }]);
  });

  it('returns null (no drop) when the gate fails, consuming exactly one draw', () => {
    // Queue [0.99]: gate 0.99 >= 0.5 -> null. Only the gate draw is consumed (scriptedRng
    // would throw if a second draw were taken). Unchanged by G14: the catalog gate sits
    // AFTER the drop gate, so a failed drop still costs exactly one value.
    expect(rollLootDrop(1, scriptedRng([0.99]))).toBeNull();
  });

  it('a forced Legendary out-rolls any Common and always carries an onHit proc', () => {
    // Queue [0.10, 0.99, 0.8, GEAR, 0.5, 0.5]:
    //  gate 0.10 -> drops.
    //  rarity r = 1+floor(0.99*9)=1+8=9 -> cumulative Common5,Rare8,Legendary9 >= 9 -> Legendary.
    //  slot 0.8 -> ring (as above).  catalog gate 0.9 -> generated gear.
    //  magnitude = statBase 6 + floor(0.5*4)=6+2=8  (in [6,9], strictly > Common max 2).
    //  proc = 0.5 < 1 (Legendary procChance 1) -> guaranteed onHit dealDamage.
    const drop = rollLootDrop(1, scriptedRng([0.1, 0.99, 0.8, GEAR, 0.5, 0.5]));
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

  it('act 5 uses the AUTHORED act-5 table, and acts beyond it clamp there', () => {
    // CHANGED, and the old assertion ('acts beyond 4 reuse the act-4 table') was asserting
    // a defect. `dropTables.json` authors a `perAct."5"` curve, but `getDropTable` clamped
    // to 4 — so the richest table in the file was dead data. Harmless while floor 5 had no
    // encounters; #0a's G43 fix made floor 5 playable, so it was silently unused.
    // Act 5's Legendary weight is 5, act 4's is 4 — read off the JSON, so the two tables
    // are distinguishable by more than object identity.
    expect(getDropTable(5).rarityWeights.Legendary).toBe(5);
    expect(getDropTable(4).rarityWeights.Legendary).toBe(4);
    expect(getDropTable(5)).not.toBe(getDropTable(4));
    expect(getDropTable(7)).toBe(getDropTable(5));
    expect(getDropTable(0)).toBe(getDropTable(1));
  });
});

describe('rollLootDrop — family-tag slot bias (act 1, hand-derived)', () => {
  // Act-1 slotWeights {mainHand:2,armor:2,ring:1}; SLOT_ORDER present-subset in order:
  // mainHand(2), armor(2), ring(1). Tag-free total 5, cumulative mainHand2,armor4,ring5.
  // The 'Mech' byTag map {mainHand:3,offHand:2,armor:2,ammo:2} multiplies WITHIN the act's
  // set only (offHand & ammo are NOT in act-1's slots, so they are never added): mainHand
  // 2*3=6, armor 2*2=4, ring 1*1=1 (Mech omits ring -> x1). Mech total 11, cumulative
  // mainHand6, armor10, ring11.
  //
  // Shared draw queue [gate 0.1, rarity 0.0, slot 0.5, catalog GEAR, mag 0.0, proc 0.0]:
  //   gate 0.1 < 0.5 -> drop. rarity r=1+floor(0.0*9)=1 -> Common. slot draw 0.5:
  //     tag-free: r = 1 + floor(0.5*5) = 1+2 = 3 -> cumulative mainHand2,armor4 >= 3 -> ARMOR.
  //     Mech:     r = 1 + floor(0.5*11) = 1+5 = 6 -> cumulative mainHand6 >= 6 -> MAINHAND.
  //   Same single slot draw, different slot -> the bias re-weights the SAME roll.
  //   The catalog gate then takes the generated-gear branch, which is what has a slot at all.
  const queue = () => scriptedRng([0.1, 0.0, 0.5, GEAR, 0.0, 0.0]);

  it('the same slot draw lands on armor tag-free but mainHand under the Mech bias', () => {
    const bare = rollLootDrop(1, queue());
    const mech = rollLootDrop(1, queue(), 'Mech');
    expect(bare!.rolled!.slot).toBe('armor');
    expect(mech!.rolled!.slot).toBe('mainHand');
    expect(bare!.rolled!.rarity).toBe('Common'); // hand-derived golden for the tag-free roll
  });

  it('off-equivalence: an undefined or unknown tag is byte-identical to the tag-free roll', () => {
    const bare = rollLootDrop(1, queue());
    const explicitUndefined = rollLootDrop(1, queue(), undefined);
    const unknownTag = rollLootDrop(1, queue(), 'NotATag');
    expect(explicitUndefined).toEqual(bare);
    expect(unknownTag).toEqual(bare);
  });

  it('is deterministic: same seed + act + tag rolls the identical biased drop', () => {
    const a = rollLootDrop(1, mulberry32(555), 'Mech');
    const b = rollLootDrop(1, mulberry32(555), 'Mech');
    expect(a).toEqual(b);
  });
});

describe('rollChestLoot — guaranteed, seeded (no drop gate)', () => {
  // Chest table: rarityWeights {Common:2,Rare:3,Legendary:2} (total 7), slotWeights
  // {mainHand:2,armor:2,ring:1,amulet:1} (SLOT_ORDER: amulet1,mainHand2,armor2,ring1; total 6),
  // chestItemCount 1, catalog {chance 0.45, poolWeights {heal:4,utility:3,unique:3}}.
  // Draw order per item: rarity, slot, catalog gate, then two branch draws (NO drop gate).
  it('yields exactly one hand-derived item (Common mainHand +1)', () => {
    // Queue [0.00, 0.2, GEAR, 0.00, 0.00]:
    //  rarity r = 1+floor(0.00*7)=1 -> Common (cumulative 2 >= 1).
    //  slot   r = 1+floor(0.2*6)=1+1=2 -> cumulative amulet1,mainHand3 >= 2 -> mainHand.
    //  catalog gate 0.9 >= 0.45 -> generated gear.
    //  magnitude = 1 + floor(0.00*2) = 1 (weapon -> bonusDamage) ; proc 0.00 < 0 -> none.
    const items = rollChestLoot(scriptedRng([0.0, 0.2, GEAR, 0.0, 0.0]), 1);
    expect(items).toHaveLength(1);
    expect(items[0]!.rolled!.rarity).toBe('Common');
    expect(items[0]!.rolled!.slot).toBe('mainHand');
    expect(items[0]!.rolled!.effects).toEqual([{ type: 'bonusDamage', params: { amount: 1 } }]);
  });

  it('is deterministic for a fixed seed', () => {
    expect(rollChestLoot(mulberry32(99), 1)).toEqual(rollChestLoot(mulberry32(99), 1));
  });

  it('a chest can hold an authored consumable too', () => {
    // Queue [rarity 0.0, slot 0.0, CATALOG, pool 0.0, index 0.0]:
    //  catalog gate 0.0 < 0.45 -> the catalog branch.
    //  Act-1 pools: heal (weight 4) + utility (weight 3); `unique` (weight 3) is EMPTY at
    //  act 1 — the four uniques are floors 2..5 — so it is dropped before any draw and the
    //  total is 7, not 10. pool r = 1+floor(0.0*7)=1 -> cumulative heal 4 >= 1 -> heal.
    //  heal pool, in consumables.json file order: ['void-draught','suture-kit'].
    //  index = floor(0.0*2) = 0 -> 'void-draught'.
    const items = rollChestLoot(scriptedRng([0.0, 0.0, CATALOG, 0.0, 0.0]), 1);
    expect(items).toEqual([{ defId: 'void-draught' }]);
  });
});

// =========================================================================================
// G14 — the authored catalog branch.
//
// TWO NUMBERS, and they measure different things — stated together because quoting one
// without the other is how the register's "37 of 38" reads as though this unit fixed all of
// it. Counted from the catalogs: 19 consumables + 4 uniques + 15 relics = 38 authored items.
//   · **37 of 38** were unobtainable by ANY means. `deals.json` authors exactly one relic
//     reward (`mirror-shard`), so that single item was the whole reachable set.
//   · **23 of 38** — every consumable and every unique — are what THIS unit makes reachable.
//     The other 14 are relics, which stay deal-only by §14.1 and are #9's to widen.
// The 23 are why the game had no healing at all: every healing item is a consumable.
// =========================================================================================

describe('rollLootDrop — the authored-catalog branch (G14)', () => {
  it('drops a HEALING consumable for the hand-derived catalog queue (act 1)', () => {
    // Queue [gate 0.1, rarity 0.0, slot 0.8, CATALOG, pool 0.0, index 0.0]:
    //  draws 1-3 exactly as the gear anchor above (rarity/slot are drawn and discarded).
    //  catalog gate 0.0 < 0.45 -> catalog branch.
    //  Act-1 poolWeights {heal:5,utility:4,unique:1}; `unique` is EMPTY at act 1 and is
    //  dropped BEFORE the draw, so the total is 9. pool r = 1+floor(0.0*9)=1 -> heal.
    //  heal pool (file order) ['void-draught','suture-kit']; index floor(0.0*2)=0.
    const drop = rollLootDrop(1, scriptedRng([0.1, 0.0, 0.8, CATALOG, 0.0, 0.0]));
    // A BARE instance — the same plain shape starting gear uses, no `rolled` overlay.
    expect(drop).toEqual({ defId: 'void-draught' });
    // ...and it really is a heal: the def carries a `healSelf` use action.
    expect(getCatalogItemById('void-draught')!.use).toContainEqual({
      kind: 'healSelf',
      params: { pctMaxHp: 100 },
    });
  });

  it('the pool draw selects UTILITY when it lands past the heal weight', () => {
    // pool r = 1+floor(0.99*9) = 9 -> cumulative heal 5, utility 9 >= 9 -> utility.
    // utility = every consumable WITHOUT a healSelf action, file order; index floor(0.0*17)=0
    // -> 'regen-salve' (it applies `regeneration`, so it is deliberately NOT in `heal`).
    const drop = rollLootDrop(1, scriptedRng([0.1, 0.0, 0.8, CATALOG, 0.99, 0.0]));
    expect(drop).toEqual({ defId: 'regen-salve' });
  });

  it('a UNIQUE is reachable from act 2, and is floor-gated out of act 1', () => {
    // Act-2 table: rarityWeights total 11, slotWeights total 6, same catalog weights.
    // At act 2 the unique pool is the floor-2 unique alone: ['reflections-edge'].
    // pool total 10 (heal 5, utility 4, unique 1); r = 1+floor(0.95*10) = 10 -> unique.
    // index = floor(0.0*1) = 0.
    const drop = rollLootDrop(2, scriptedRng([0.1, 0.0, 0.0, CATALOG, 0.95, 0.0]));
    expect(drop).toEqual({ defId: 'reflections-edge' });
    expect(getAllUniques().find((u) => u.id === 'reflections-edge')!.floor).toBe(2);

    // NON-VACUITY: at act 1 the SAME pool draw cannot reach a unique, because the pool is
    // empty and is dropped before the draw — so the weights renormalise to heal+utility.
    const uniqueIds = new Set(getAllUniques().map((u) => u.id));
    for (let i = 0; i < 100; i += 1) {
      const at1 = rollLootDrop(1, scriptedRng([0.1, 0.0, 0.0, CATALOG, i / 100, 0.0]));
      expect(uniqueIds.has(at1!.defId), `act-1 pool draw ${i / 100} produced a unique`).toBe(false);
    }
  });

  it('over seeds 1..300 x acts 1..5 the drop path yields healing, uniques, and NO relic', () => {
    // Baseline the register measured on this exact sweep: ZERO catalog drops, for every
    // seed, for every act — the direct cause of "there is no healing in the game".
    const relicIds = new Set(getAllRelics().map((r) => r.id));
    const uniqueIds = new Set(getAllUniques().map((u) => u.id));
    let drops = 0;
    let healing = 0;
    let uniques = 0;
    let relics = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = mulberry32(seed);
      for (const act of [1, 2, 3, 4, 5]) {
        const drop = rollLootDrop(act, rng);
        if (!drop) continue;
        drops += 1;
        if (relicIds.has(drop.defId)) relics += 1;
        if (uniqueIds.has(drop.defId)) uniques += 1;
        const def = getCatalogItemById(drop.defId);
        if (def?.use?.some((a) => a.kind === 'healSelf')) healing += 1;
      }
    }
    expect(drops).toBeGreaterThan(100);
    expect(healing).toBeGreaterThan(0);
    expect(uniques).toBeGreaterThan(0);
    // §14.1 / §14.8 / §18.2 [DECIDED]: relics are deal-only, never dropped, never in a
    // chest. FINDINGS.md G14 says to add them here; three [DECIDED] rulings outrank it.
    expect(relics).toBe(0);
  });

  it('no relic can reach a CHEST either', () => {
    const relicIds = new Set(getAllRelics().map((r) => r.id));
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = mulberry32(seed);
      for (const act of [1, 2, 3, 4, 5]) {
        for (const item of rollChestLoot(rng, act)) {
          expect(relicIds.has(item.defId)).toBe(false);
        }
      }
    }
  });
});

describe('rollDropFromTable — off-equivalence when the catalog block is absent', () => {
  // The claim the whole draw-order design rests on: a table with NO `catalog` key takes
  // ZERO extra draws and rolls exactly what it always did. Proved, not asserted.
  const act1 = getDropTable(1);
  const withCatalog: DropTable = act1;
  const withoutCatalog: DropTable = {
    dropChance: act1.dropChance,
    rarityWeights: act1.rarityWeights,
    slotWeights: act1.slotWeights,
  };

  it('consumes exactly the five pre-G14 draws (a sixth would throw)', () => {
    // scriptedRng throws when over-drawn, so a queue of exactly five values IS the draw
    // count assertion.
    const drop = rollDropFromTable(withoutCatalog, 1, scriptedRng([0.1, 0.0, 0.8, 0.0, 0.0]));
    expect(drop!.rolled!.rarity).toBe('Common');
    expect(drop!.rolled!.slot).toBe('ring');
    expect(drop!.rolled!.effects).toEqual([{ type: 'bonusStat', params: { str: 1 } }]);
  });

  it('and its result is identical to the catalog table taking the gear branch', () => {
    // Same five values, plus the one gate draw the catalog table spends to reach gear.
    const off = rollDropFromTable(withoutCatalog, 1, scriptedRng([0.1, 0.0, 0.8, 0.0, 0.0]));
    const on = rollDropFromTable(withCatalog, 1, scriptedRng([0.1, 0.0, 0.8, GEAR, 0.0, 0.0]));
    expect(on).toEqual(off);
  });

  it('NON-VACUITY: the same table WITH a catalog block really can branch away', () => {
    // If the gate draw did nothing, this would equal the gear result above.
    const catalogDrop = rollDropFromTable(withCatalog, 1, scriptedRng([0.1, 0.0, 0.8, CATALOG, 0.0, 0.0]));
    expect(catalogDrop).toEqual({ defId: 'void-draught' });
    expect(catalogDrop!.rolled).toBeUndefined();
  });
});

describe('summarizeLoot — names, never raw ids', () => {
  it('resolves an authored catalog drop through the catalogs', () => {
    // Before G14 this read `rolled?.name ?? instance.defId`, so the first consumable drop
    // would have made the victory line say "You scavenge void-draught."
    expect(summarizeLoot({ defId: 'void-draught' })).toEqual({
      defId: 'void-draught',
      name: 'Void Draught',
      rarity: 'Common',
    });
    expect(summarizeLoot({ defId: 'reflections-edge' })).toEqual({
      defId: 'reflections-edge',
      name: "Reflection's Edge",
      rarity: 'Legendary',
    });
  });

  it('still reads the rolled overlay for generated gear', () => {
    expect(
      summarizeLoot({
        defId: 'gen:Rare:ring',
        rolled: { name: 'Rare ring', rarity: 'Rare', slot: 'ring', kind: 'trinket', effects: [] },
      }),
    ).toEqual({ defId: 'gen:Rare:ring', name: 'Rare ring', rarity: 'Rare' });
  });

  it('no drop from any loot path summarises to its own id', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = mulberry32(seed);
      for (const act of [1, 2, 3, 4, 5]) {
        const drop = rollLootDrop(act, rng);
        if (drop) expect(summarizeLoot(drop).name).not.toBe(drop.defId);
        for (const item of rollChestLoot(rng, act)) {
          expect(summarizeLoot(item).name).not.toBe(item.defId);
        }
      }
    }
  });
});
