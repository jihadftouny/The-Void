import { describe, expect, it } from 'vitest';
import { getShieldById, getAllShields } from './shield.ts';

// Shield loader — the seed table (M4). acBonus values are hand-read from shields.json
// (Buckler 1, Kite Shield 2); the loader is a plain lookup, so these assert the data +
// the id-scan contract, not any computed output.
describe('shield loader', () => {
  it('resolves a known shield id to its row', () => {
    const buckler = getShieldById('Buckler');
    expect(buckler).toBeDefined();
    expect(buckler?.acBonus).toBe(1);
    expect(buckler?.rarity).toBe('Common');

    const kite = getShieldById('Kite Shield');
    expect(kite?.acBonus).toBe(2);
    expect(kite?.rarity).toBe('Rare');
  });

  it('returns undefined for an unknown id', () => {
    expect(getShieldById('Tower Shield')).toBeUndefined();
    expect(getShieldById('')).toBeUndefined();
  });

  it('exposes the seed table in declaration order', () => {
    expect(getAllShields().map((s) => s.id)).toEqual(['Buckler', 'Kite Shield']);
  });
});
