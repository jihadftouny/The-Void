import { describe, expect, it } from 'vitest';
import {
  resolveGearDef,
  slotForDef,
  canEquip,
  equip,
  unequip,
  pickUp,
  equippedDefId,
  inventoryWithGear,
  weaponForSlot,
  armorForSlot,
  shieldForSlot,
  UNARMED,
  type GearDef,
} from './equipment.ts';
import { createInventory, type Inventory } from './inventory.ts';
import { EQUIP_SLOTS, getCatalogItemById, type EquipSlot, type ItemInstance } from './item.ts';
import { generateItem } from './rarityGen.ts';
import { rollLootDrop } from './loot.ts';
import { mulberry32 } from './rng.ts';
import { type Rarity } from './weapon.ts';

// Every expected value is hand-derived from the data tables:
//   weapons.json  act1: "Jooj Gun 1" (Common Ranged 1d4), "Jaaj Sword 1" (Rare Melee 1d6),
//                       "Jiij Rapier 1" (Legendary Finesse 1d8)
//   armor.json    act1: "Jooj Armor 1" (Common), "Jaaj Armor 1" (Rare)
//   shields.json:       "Buckler" (Common, acBonus 1), "Kite Shield" (Rare, acBonus 2)
//   items.json:         "rusted-blade" (weapon/mainHand/Common, bonusDamage 1),
//                       "void-plate" (armor/armor/Rare, bonusArmorClass 2),
//                       "hollow-ring" (trinket/ring/Rare, bonusStat con 1),
//                       "clarity-draught" (usable/null-slot/Common, heal 8)
// — never read back from equipment.ts output.

const inst = (defId: string): ItemInstance => ({ defId });

describe('resolveGearDef — bridge dispatch by id', () => {
  it('resolves each legacy id to the right kind/slot with empty effects', () => {
    const sword = resolveGearDef('Jaaj Sword 1');
    expect(sword).toEqual<GearDef>({
      defId: 'Jaaj Sword 1',
      kind: 'weapon',
      slot: 'mainHand',
      rarity: 'Rare',
      effects: [],
    });
    const armor = resolveGearDef('Jooj Armor 1');
    expect(armor).toEqual<GearDef>({
      defId: 'Jooj Armor 1',
      kind: 'armor',
      slot: 'armor',
      rarity: 'Common',
      effects: [],
    });
    const shield = resolveGearDef('Buckler');
    expect(shield).toEqual<GearDef>({
      defId: 'Buckler',
      kind: 'armor',
      slot: 'offHand',
      rarity: 'Common',
      effects: [],
    });
  });

  it('resolves each unified items.json id to its kind/slot/rarity + real effects', () => {
    expect(resolveGearDef('rusted-blade')).toEqual<GearDef>({
      defId: 'rusted-blade',
      kind: 'weapon',
      slot: 'mainHand',
      rarity: 'Common',
      effects: [{ type: 'bonusDamage', params: { amount: 1 } }],
    });
    expect(resolveGearDef('void-plate')).toEqual<GearDef>({
      defId: 'void-plate',
      kind: 'armor',
      slot: 'armor',
      rarity: 'Rare',
      effects: [{ type: 'bonusArmorClass', params: { amount: 2 } }],
    });
    expect(resolveGearDef('hollow-ring')).toEqual<GearDef>({
      defId: 'hollow-ring',
      kind: 'trinket',
      slot: 'ring',
      rarity: 'Rare',
      effects: [{ type: 'bonusStat', params: { con: 1 } }],
    });
    // A usable carries a null slot.
    expect(resolveGearDef('clarity-draught')?.slot).toBeNull();
  });

  it('returns undefined for an unknown id', () => {
    expect(resolveGearDef('no-such-thing')).toBeUndefined();
    expect(resolveGearDef('')).toBeUndefined();
  });
});

describe('slotForDef', () => {
  it('maps ids to their equip slot; usable/unknown -> null', () => {
    expect(slotForDef('Jaaj Sword 1')).toBe('mainHand');
    expect(slotForDef('Jooj Armor 1')).toBe('armor');
    expect(slotForDef('Kite Shield')).toBe('offHand');
    expect(slotForDef('hollow-ring')).toBe('ring');
    expect(slotForDef('clarity-draught')).toBeNull(); // usable
    expect(slotForDef('nope')).toBeNull(); // unknown
  });
});

describe('canEquip — slot-type validation', () => {
  it('a weapon equips only into mainHand and is rejected elsewhere', () => {
    expect(canEquip(inst('Jaaj Sword 1'), 'mainHand')).toBe(true);
    expect(canEquip(inst('Jaaj Sword 1'), 'armor')).toBe(false);
    expect(canEquip(inst('Jaaj Sword 1'), 'offHand')).toBe(false);
  });

  it('armor into armor, shield into offHand, ring into ring — correct slot only', () => {
    expect(canEquip(inst('Jooj Armor 1'), 'armor')).toBe(true);
    expect(canEquip(inst('Jooj Armor 1'), 'mainHand')).toBe(false);
    expect(canEquip(inst('Buckler'), 'offHand')).toBe(true);
    expect(canEquip(inst('Buckler'), 'armor')).toBe(false);
    expect(canEquip(inst('hollow-ring'), 'ring')).toBe(true);
  });

  it('a usable never equips (null slot); an unknown id never equips', () => {
    expect(canEquip(inst('clarity-draught'), 'mainHand')).toBe(false);
    expect(canEquip(inst('nope'), 'mainHand')).toBe(false);
  });
});

describe('equip — pure, with slot-type validation and swap', () => {
  it('equips a weapon from the backpack into mainHand and removes it from the backpack', () => {
    const start: Inventory = { ...createInventory(), backpack: [inst('Jaaj Sword 1')] };
    const { inventory, ok } = equip(start, 0, 'mainHand');
    expect(ok).toBe(true);
    expect(inventory.slots.mainHand).toEqual(inst('Jaaj Sword 1'));
    expect(inventory.backpack).toEqual([]);
    // Purity: input unchanged.
    expect(start.slots.mainHand).toBeNull();
    expect(start.backpack).toEqual([inst('Jaaj Sword 1')]);
  });

  it('infers the slot from the def when omitted', () => {
    const start: Inventory = { ...createInventory(), backpack: [inst('Jooj Armor 1')] };
    const { inventory, ok } = equip(start, 0);
    expect(ok).toBe(true);
    expect(inventory.slots.armor).toEqual(inst('Jooj Armor 1'));
  });

  it('rejects a weapon aimed at the armor slot: ok false, inventory unchanged', () => {
    const start: Inventory = { ...createInventory(), backpack: [inst('Jaaj Sword 1')] };
    const { inventory, ok } = equip(start, 0, 'armor');
    expect(ok).toBe(false);
    expect(inventory).toBe(start); // same reference — no change
  });

  it('swaps an occupied slot, returning the displaced item to the backpack', () => {
    const start: Inventory = {
      slots: { ...createInventory().slots, mainHand: inst('Jaaj Sword 1') },
      backpack: [inst('Jooj Gun 1')],
    };
    const { inventory, ok } = equip(start, 0, 'mainHand');
    expect(ok).toBe(true);
    expect(inventory.slots.mainHand).toEqual(inst('Jooj Gun 1'));
    expect(inventory.backpack).toEqual([inst('Jaaj Sword 1')]); // old weapon displaced
  });

  it('a bad backpack index is a no-op with ok false', () => {
    const start = createInventory();
    expect(equip(start, 0, 'mainHand')).toEqual({ inventory: start, ok: false });
    expect(equip(start, -1, 'mainHand').ok).toBe(false);
  });
});

// ------- G11 / G11b — found gear must actually be equippable -------------------------------
//
// These assert the PLAYER-OBSERVABLE contract the register measured as broken: a rarity-
// generated drop, taken through the same call the UI makes (`equip(inventory, index)` with NO
// slot argument), lands in its slot. Every expected value is derived from `rarityGen.ts`'s
// documented output shape (`defId: gen:<rarity>:<slot>`, `rolled.slot === the requested slot`),
// never read back from `equipment.ts`. Against the pre-fix build every one of them is 0/N.

const RARITIES: readonly Rarity[] = ['Common', 'Rare', 'Legendary'];

describe('G11 — a rarity-generated item can be equipped through the real UI path', () => {
  it('every slot x rarity (27 of 27) equips with NO slot argument and lands in rolled.slot', () => {
    let equipped = 0;
    const failures: string[] = [];
    for (const slot of EQUIP_SLOTS) {
      for (const rarity of RARITIES) {
        const item = generateItem(mulberry32(7), { slot, rarity });
        // Independent oracle: the generator stamps the synthetic id and the requested slot.
        expect(item.defId).toBe(`gen:${rarity}:${slot}`);
        expect(item.rolled!.slot).toBe(slot);

        const start = pickUp(createInventory(), item);
        const { inventory, ok } = equip(start, 0); // the UI path: no slot argument
        if (ok && inventory.slots[slot] === item && inventory.backpack.length === 0) {
          equipped++;
        } else {
          failures.push(`${rarity}/${slot}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(equipped).toBe(EQUIP_SLOTS.length * RARITIES.length); // 9 x 3 = 27
  });

  it('canEquip accepts a rolled instance for its own slot and rejects every other slot', () => {
    const ring = generateItem(mulberry32(11), { slot: 'ring', rarity: 'Rare' });
    for (const slot of EQUIP_SLOTS) {
      expect(canEquip(ring, slot)).toBe(slot === 'ring');
    }
  });

  it('an explicit WRONG slot is still rejected (the fix widens resolution, not validation)', () => {
    const armor = generateItem(mulberry32(13), { slot: 'armor', rarity: 'Legendary' });
    const start = pickUp(createInventory(), armor);
    const { inventory, ok } = equip(start, 0, 'mainHand');
    expect(ok).toBe(false);
    expect(inventory).toBe(start);
  });
});

// G11's guard, SPLIT (not weakened) because its premise changed by design.
//
// It used to sweep every drop, dereference `drop.rolled!` for the slot, and require 100% to
// equip. G14 puts AUTHORED CATALOG items on the same path: a consumable is a legitimate drop
// that has no `rolled` overlay and — correctly — does not equip into anything. Under the old
// shape that is a crash on `rolled!` followed by a failure, for an item behaving exactly as
// designed.
//
// So the sweep is split in two, and BOTH halves are at full strength:
//   (i)  every GENERATED-gear drop still equips, 100%, exactly as G11b demanded; and
//   (ii) every CATALOG drop resolves through the catalogs, and every catalog drop that
//        HAS a slot equips too — which is what keeps a dropped unique from being a
//        decoration you cannot wear.
describe('G11 end-to-end — every real loot drop is usable for what it is', () => {
  it('seeds 1..300 x acts 1-5: at least 100 drops, and 100% behave correctly', () => {
    let gearDrops = 0;
    let gearEquippable = 0;
    let catalogDrops = 0;
    let catalogResolved = 0;
    let slottedCatalog = 0;
    let slottedCatalogEquipped = 0;

    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry32(seed);
      for (const act of [1, 2, 3, 4, 5]) {
        const drop = rollLootDrop(act, rng);
        if (!drop) continue;
        if (drop.rolled) {
          gearDrops++;
          const slot = drop.rolled.slot as EquipSlot;
          const { inventory, ok } = equip(pickUp(createInventory(), drop), 0);
          if (ok && inventory.slots[slot] === drop) gearEquippable++;
          continue;
        }
        catalogDrops++;
        const def = getCatalogItemById(drop.defId);
        if (!def) continue;
        catalogResolved++;
        if (def.slot === null) continue;
        slottedCatalog++;
        const { inventory, ok } = equip(pickUp(createInventory(), drop), 0);
        if (ok && inventory.slots[def.slot] === drop) slottedCatalogEquipped++;
      }
    }

    // The act tables all carry dropChance >= 0.5 over 1500 rolls, so >100 drops is certain;
    // the register measured >100 drops and 0% equippable on the same sweep.
    expect(gearDrops + catalogDrops).toBeGreaterThanOrEqual(100);
    // (i) G11b at full strength.
    expect(gearDrops).toBeGreaterThan(0);
    expect(gearEquippable).toBe(gearDrops);
    // (ii) the new half. Non-vacuous: catalog drops really occur, and some really have slots
    // (the four uniques do; the nineteen consumables do not).
    expect(catalogDrops).toBeGreaterThan(0);
    expect(catalogResolved).toBe(catalogDrops);
    expect(slottedCatalog).toBeGreaterThan(0);
    expect(slottedCatalogEquipped).toBe(slottedCatalog);
  });
});

describe('unequip — pure', () => {
  it('moves the slot item to the backpack and clears the slot', () => {
    const start: Inventory = {
      slots: { ...createInventory().slots, armor: inst('Jooj Armor 1') },
      backpack: [],
    };
    const { inventory, ok } = unequip(start, 'armor');
    expect(ok).toBe(true);
    expect(inventory.slots.armor).toBeNull();
    expect(inventory.backpack).toEqual([inst('Jooj Armor 1')]);
    expect(start.slots.armor).toEqual(inst('Jooj Armor 1')); // input unchanged
  });

  it('an empty slot is a no-op with ok false', () => {
    const start = createInventory();
    expect(unequip(start, 'armor')).toEqual({ inventory: start, ok: false });
  });
});

describe('pickUp — pure append', () => {
  it('appends to the backpack and leaves the input unchanged', () => {
    const start = createInventory();
    const after = pickUp(start, inst('clarity-draught'));
    expect(after.backpack).toEqual([inst('clarity-draught')]);
    expect(start.backpack).toEqual([]);
    const again = pickUp(after, inst('Buckler'));
    expect(again.backpack).toEqual([inst('clarity-draught'), inst('Buckler')]);
  });
});

describe('every op round-trips through JSON', () => {
  it('equip/unequip/pickUp results survive JSON.parse(JSON.stringify(x))', () => {
    const seeded = inventoryWithGear({ mainHand: 'Jaaj Sword 1', armor: 'Jooj Armor 1' });
    const picked = pickUp(seeded, inst('Buckler'));
    const equipped = equip(picked, 0, 'offHand').inventory;
    const unequipped = unequip(equipped, 'mainHand').inventory;
    for (const inv of [seeded, picked, equipped, unequipped]) {
      expect(JSON.parse(JSON.stringify(inv))).toEqual(inv);
    }
  });
});

describe('equippedDefId', () => {
  it('returns the equipped defId or undefined for an empty slot', () => {
    const inv = inventoryWithGear({ mainHand: 'Jaaj Sword 1' });
    expect(equippedDefId(inv, 'mainHand')).toBe('Jaaj Sword 1');
    expect(equippedDefId(inv, 'armor')).toBeUndefined();
  });
});

describe('inventoryWithGear', () => {
  it('seeds only the named slots; the rest stay null and the backpack is empty', () => {
    const inv = inventoryWithGear({ mainHand: 'Jaaj Sword 1', armor: 'Jooj Armor 1' });
    expect(inv.slots.mainHand).toEqual(inst('Jaaj Sword 1'));
    expect(inv.slots.armor).toEqual(inst('Jooj Armor 1'));
    expect(inv.slots.offHand).toBeNull();
    expect(inv.slots.ring).toBeNull();
    expect(inv.backpack).toEqual([]);
  });
});

describe('mechanical accessors — the combat/defense seam', () => {
  it('weaponForSlot resolves the seeded weapon; empty mainHand -> undefined', () => {
    const armed = inventoryWithGear({ mainHand: 'Jaaj Sword 1' });
    const w = weaponForSlot(armed);
    expect(w?.name).toBe('Jaaj Sword 1');
    expect(w?.damage).toEqual({ quantity: 1, sides: 6 }); // Rare Melee 1d6
    expect(weaponForSlot(createInventory())).toBeUndefined();
  });

  it('a unified-only weapon in mainHand has no legacy dice -> weaponForSlot undefined', () => {
    // rusted-blade lives ONLY in items.json (no weapons.json row), so it carries no native
    // dice; the bridge trade-off means it resolves to undefined here (battle -> UNARMED).
    const inv = inventoryWithGear({ mainHand: 'rusted-blade' });
    expect(weaponForSlot(inv)).toBeUndefined();
  });

  it('armorForSlot / shieldForSlot resolve the seeded gear; empty -> undefined', () => {
    const inv = inventoryWithGear({ armor: 'Jaaj Armor 1', offHand: 'Kite Shield' });
    expect(armorForSlot(inv)?.baseArmor).toBe(12); // Jaaj Armor 1 baseArmor 12
    expect(shieldForSlot(inv)?.acBonus).toBe(2); // Kite Shield acBonus 2
    expect(armorForSlot(createInventory())).toBeUndefined();
    expect(shieldForSlot(createInventory())).toBeUndefined();
  });
});

describe('UNARMED fallback constant', () => {
  it('is a 1d1 Melee weapon (fixed floor of 1 before mods)', () => {
    expect(UNARMED.damage).toEqual({ quantity: 1, sides: 1 });
    expect(UNARMED.property).toBe('Melee');
  });
});
