import { describe, expect, it } from 'vitest';
import { createInventory } from './inventory.ts';
import { EQUIP_SLOTS } from './item.ts';

// Expected values derive from the schema: the nine equip slots in item.ts and the
// empty-default contract in inventory.ts — not read back from code output.

describe('createInventory', () => {
  it('has all nine equip slots present and null', () => {
    const inv = createInventory();
    const slotKeys = Object.keys(inv.slots).sort();
    // The nine slots named in item.ts, independently listed here.
    expect(slotKeys).toEqual(
      [
        'helmet',
        'amulet',
        'mainHand',
        'offHand',
        'armor',
        'legs',
        'boots',
        'ring',
        'ammo',
      ].sort(),
    );
    expect(slotKeys.length).toBe(9);
    for (const slot of EQUIP_SLOTS) {
      expect(inv.slots[slot]).toBeNull();
    }
  });

  it('starts with an empty backpack', () => {
    expect(createInventory().backpack).toEqual([]);
  });

  it('returns a distinct object each call (no shared reference)', () => {
    const a = createInventory();
    const b = createInventory();
    expect(a).not.toBe(b);
    expect(a.slots).not.toBe(b.slots);
    expect(a.backpack).not.toBe(b.backpack);
  });

  it('round-trips through JSON unchanged', () => {
    const inv = createInventory();
    expect(JSON.parse(JSON.stringify(inv))).toEqual(inv);
  });
});
