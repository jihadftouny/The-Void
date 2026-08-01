import { describe, expect, it } from 'vitest';
import { getLore } from './lore.ts';

// Hand-derived from Java `Lore.java`: each Act 1-4 has 3 entries.
// Selection: Act 1 rolls nextInt(3) => all 3 reachable (selectableCount 3);
// Acts 2-4 roll nextInt(2) => only the first 2 reachable (selectableCount 2).

describe('getLore', () => {
  it('each Act 1-4 has 3 entries, all with non-empty title and text', () => {
    for (const act of [1, 2, 3, 4]) {
      const lore = getLore(act)!;
      expect(lore.entries).toHaveLength(3);
      for (const entry of lore.entries) {
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('preserves the Java selection behaviour via selectableCount', () => {
    expect(getLore(1)!.selectableCount).toBe(3);
    expect(getLore(2)!.selectableCount).toBe(2);
    expect(getLore(3)!.selectableCount).toBe(2);
    expect(getLore(4)!.selectableCount).toBe(2);
  });

  it('Act 1 entry titles match the Java text', () => {
    expect(getLore(1)!.entries.map((e) => e.title)).toEqual([
      'This is a Title 1 0',
      'This is a Title 1 1',
      'This is a Title 1 2',
    ]);
  });

  it('returns undefined for an Act with no lore', () => {
    expect(getLore(0)).toBeUndefined();
    expect(getLore(5)).toBeUndefined();
  });
});
