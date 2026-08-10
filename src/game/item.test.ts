import { describe, expect, it } from 'vitest';
import {
  getAllItems,
  getItemById,
  EQUIP_SLOTS,
  type ItemKind,
  type EquipSlot,
} from './item.ts';

// Expected values are derived from the data contract (src/data/items.json holds one
// example per kind) and the schema in item.ts — not read back from code output.

const VALID_KINDS: ReadonlySet<ItemKind> = new Set([
  'weapon',
  'armor',
  'trinket',
  'usable',
]);
const VALID_RARITIES: ReadonlySet<string> = new Set(['Common', 'Rare', 'Legendary']);
const VALID_SLOTS: ReadonlySet<EquipSlot> = new Set(EQUIP_SLOTS);

describe('getAllItems', () => {
  it('lists at least one item of every kind', () => {
    const items = getAllItems();
    const kinds = new Set(items.map((i) => i.kind));
    for (const kind of VALID_KINDS) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it('has an entry for each of the four example items', () => {
    // The base table authors one example per kind (4 kinds -> 4 entries).
    expect(getAllItems().length).toBe(4);
  });
});

describe('getItemById', () => {
  it('resolves a known id to its definition', () => {
    const blade = getItemById('rusted-blade');
    expect(blade).toBeDefined();
    expect(blade!.kind).toBe('weapon');
    expect(blade!.slot).toBe('mainHand');
    expect(blade!.rarity).toBe('Common');
    expect(blade!.name).toBe('Rusted Blade');
  });

  it('returns undefined for an unknown id', () => {
    expect(getItemById('no-such-item')).toBeUndefined();
  });
});

describe('schema validity of every entry', () => {
  it('has a valid kind, rarity, and slot (an EquipSlot or null)', () => {
    for (const item of getAllItems()) {
      expect(VALID_KINDS.has(item.kind)).toBe(true);
      expect(VALID_RARITIES.has(item.rarity)).toBe(true);
      if (item.slot === null) {
        // usables / non-equipped carry a null slot.
        expect(item.slot).toBeNull();
      } else {
        expect(VALID_SLOTS.has(item.slot)).toBe(true);
      }
      expect(Array.isArray(item.effects)).toBe(true);
    }
  });

  it('gives every equippable kind a non-null slot and usables a null slot', () => {
    for (const item of getAllItems()) {
      if (item.kind === 'usable') {
        expect(item.slot).toBeNull();
      } else {
        expect(item.slot).not.toBeNull();
      }
    }
  });
});

describe('serializability', () => {
  it('an ItemDef round-trips through JSON unchanged', () => {
    const item = getItemById('void-plate')!;
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });
});
