import { describe, expect, it } from 'vitest';
import { getEnemyNameTable, enemyTypesForAct } from './enemyName.ts';

// All expected values are hand-transcribed from Java `EnemyName.setName`,
// independently of the reference JSON.

describe('enemyTypesForAct', () => {
  it('matches the Java Act -> type map', () => {
    expect(enemyTypesForAct(1)).toEqual(['Beast', 'Humanoid', 'Mech', 'Magical']);
    expect(enemyTypesForAct(2)).toEqual(['Beast', 'Humanoid', 'Magical']);
    expect(enemyTypesForAct(3)).toEqual(['Nightmare']);
    expect(enemyTypesForAct(4)).toEqual(['Beast', 'Humanoid', 'Ancestral']);
  });

  it('is empty for unknown Acts', () => {
    expect(enemyTypesForAct(0)).toEqual([]);
    expect(enemyTypesForAct(5)).toEqual([]);
  });
});

describe('getEnemyNameTable fidelity', () => {
  it('Act 1 Beast matches Java exactly (all three slots)', () => {
    expect(getEnemyNameTable(1, 'Beast')).toEqual({
      first: [
        ['Feral', 20],
        ['Aerobicized', 20],
        ['Plated', 20],
        ['Bestial', 10],
        ['Unbreakable', 10],
        ['Cunning', 10],
        ['Giant', 5],
        ['Monstrous', 3],
        ['Mutated', 2],
      ],
      middle: [
        ['Cryo', 20],
        ['Fiery', 20],
        ['Electrified', 20],
        ['Venomous', 20],
        ['Psychogenic', 20],
      ],
      last: [
        ['Rat', 20],
        ['Snake', 20],
        ['Lizard', 20],
        ['Spider', 20],
        ['Raven', 20],
      ],
    });
  });

  it('Act 4 Ancestral matches Java exactly', () => {
    expect(getEnemyNameTable(4, 'Ancestral')).toEqual({
      first: [['', 1]],
      middle: [['', 1]],
      last: [
        ['The Knight', 1],
        ['The Counselor', 1],
        ['Gaea', 1],
        ['Sif', 1],
        ['Death', 1],
      ],
    });
  });

  it('Act 3 Nightmare has three empty slots', () => {
    expect(getEnemyNameTable(3, 'Nightmare')).toEqual({
      first: [],
      middle: [],
      last: [],
    });
  });

  it('returns undefined for a type not present in the Act', () => {
    expect(getEnemyNameTable(1, 'Nightmare')).toBeUndefined();
    expect(getEnemyNameTable(2, 'Mech')).toBeUndefined();
    expect(getEnemyNameTable(9, 'Beast')).toBeUndefined();
  });
});

describe('weight invariant', () => {
  it('every weight across every table is a positive integer', () => {
    for (const act of [1, 2, 3, 4]) {
      for (const type of enemyTypesForAct(act)) {
        const table = getEnemyNameTable(act, type)!;
        for (const slot of [table.first, table.middle, table.last]) {
          for (const [, weight] of slot) {
            expect(Number.isInteger(weight)).toBe(true);
            expect(weight).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('Act 1 Magical first slot sums to 90, not 100 (per-table by design)', () => {
    // Guards against a wrong "everything sums to 100" assumption.
    const magical = getEnemyNameTable(1, 'Magical')!;
    const sum = magical.first.reduce((acc, [, w]) => acc + w, 0);
    expect(sum).toBe(90);
  });
});
