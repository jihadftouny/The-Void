import { describe, expect, it } from 'vitest';
import { ELEMENTS, getElement, elementCount } from './element.ts';

// Hand-derived from Java `Element.java`, frozen in resistance-array order:
//   Physical(0) Cryo(1) Pyro(2) Electro(3) Poison(4) Psychic(5) Force(6).

describe('ELEMENTS', () => {
  it('is exactly the seven elements in canonical order', () => {
    expect(ELEMENTS).toEqual([
      'Physical',
      'Cryo',
      'Pyro',
      'Electro',
      'Poison',
      'Psychic',
      'Force',
    ]);
  });

  it('has length 7 (matches the resistance-array size)', () => {
    expect(elementCount()).toBe(7);
    expect(ELEMENTS).toHaveLength(7);
  });
});

describe('getElement', () => {
  it('maps each element name to its resistance-array index', () => {
    expect(getElement('Physical')).toBe(0);
    expect(getElement('Cryo')).toBe(1);
    expect(getElement('Pyro')).toBe(2);
    expect(getElement('Electro')).toBe(3);
    expect(getElement('Poison')).toBe(4);
    expect(getElement('Psychic')).toBe(5);
    expect(getElement('Force')).toBe(6);
  });

  it('round-trips index -> name -> index', () => {
    ELEMENTS.forEach((name, i) => {
      expect(getElement(name)).toBe(i);
    });
  });

  it('returns undefined for an unknown element', () => {
    expect(getElement('Void')).toBeUndefined();
    expect(getElement('')).toBeUndefined();
  });
});
