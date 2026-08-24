import { describe, expect, it } from 'vitest';
import {
  createKarma,
  recordKarma,
  KARMA_DELTAS,
  type KarmaState,
  type KarmaAction,
} from './karma.ts';

// Every expected vector below is summed BY HAND from the KARMA_DELTAS table spec in
// the plan, never read back from the implementation:
//   spareWeighted       -> mercyCruelty +1
//   killWeighted        -> mercyCruelty -1
//   lootGreedily        -> restraintGreed -1
//   leaveOffering       -> restraintGreed +1, reverenceDesecration +1
//   desecrateShrine     -> reverenceDesecration -2
//   honorDead           -> reverenceDesecration +1
//   embraceWhisper      -> clarityDelusion -1
//   seeThroughIllusion  -> clarityDelusion +1

const ZERO: KarmaState = {
  mercyCruelty: 0,
  restraintGreed: 0,
  reverenceDesecration: 0,
  clarityDelusion: 0,
};

describe('createKarma', () => {
  it('is a fresh neutral vector — every axis at 0', () => {
    expect(createKarma()).toEqual(ZERO);
  });

  it('returns a distinct object each call (no shared reference)', () => {
    expect(createKarma()).not.toBe(createKarma());
  });
});

describe('recordKarma — single action', () => {
  // [action, expected vector applied onto a fresh zero vector], hand-summed.
  const cases: ReadonlyArray<readonly [KarmaAction, KarmaState]> = [
    ['spareWeighted', { mercyCruelty: 1, restraintGreed: 0, reverenceDesecration: 0, clarityDelusion: 0 }],
    ['killWeighted', { mercyCruelty: -1, restraintGreed: 0, reverenceDesecration: 0, clarityDelusion: 0 }],
    ['lootGreedily', { mercyCruelty: 0, restraintGreed: -1, reverenceDesecration: 0, clarityDelusion: 0 }],
    ['leaveOffering', { mercyCruelty: 0, restraintGreed: 1, reverenceDesecration: 1, clarityDelusion: 0 }],
    ['desecrateShrine', { mercyCruelty: 0, restraintGreed: 0, reverenceDesecration: -2, clarityDelusion: 0 }],
    ['honorDead', { mercyCruelty: 0, restraintGreed: 0, reverenceDesecration: 1, clarityDelusion: 0 }],
    ['embraceWhisper', { mercyCruelty: 0, restraintGreed: 0, reverenceDesecration: 0, clarityDelusion: -1 }],
    ['seeThroughIllusion', { mercyCruelty: 0, restraintGreed: 0, reverenceDesecration: 0, clarityDelusion: 1 }],
  ];

  for (const [action, expected] of cases) {
    it(`${action} yields ${JSON.stringify(expected)}`, () => {
      expect(recordKarma(createKarma(), action)).toEqual(expected);
    });
  }

  it('leaves the axes an action does not touch at 0 (records only its own axis)', () => {
    // spareWeighted moves only mercyCruelty; the other three stay neutral.
    const k = recordKarma(createKarma(), 'spareWeighted');
    expect(k.restraintGreed).toBe(0);
    expect(k.reverenceDesecration).toBe(0);
    expect(k.clarityDelusion).toBe(0);
  });
});

describe('recordKarma — sequence sums axis-wise', () => {
  it('folds a four-action sequence into the hand-summed vector', () => {
    // spareWeighted(+1 mercy), lootGreedily(-1 restraint), desecrateShrine(-2 rev),
    // seeThroughIllusion(+1 clarity) -> one action per axis.
    const actions: KarmaAction[] = [
      'spareWeighted',
      'lootGreedily',
      'desecrateShrine',
      'seeThroughIllusion',
    ];
    const result = actions.reduce(recordKarma, createKarma());
    expect(result).toEqual({
      mercyCruelty: 1,
      restraintGreed: -1,
      reverenceDesecration: -2,
      clarityDelusion: 1,
    });
  });

  it('cancels opposing deltas on the same axis back to neutral', () => {
    // leaveOffering(+1 rev), desecrateShrine(-2 rev), honorDead(+1 rev): net 0 on
    // reverence; restraint gains +1 from the offering.
    const actions: KarmaAction[] = ['leaveOffering', 'desecrateShrine', 'honorDead'];
    const result = actions.reduce(recordKarma, createKarma());
    expect(result).toEqual({
      mercyCruelty: 0,
      restraintGreed: 1,
      reverenceDesecration: 0,
      clarityDelusion: 0,
    });
  });
});

describe('recordKarma — purity', () => {
  it('does not mutate its input vector', () => {
    const input = createKarma();
    const frozen = JSON.stringify(input);
    const out = recordKarma(input, 'killWeighted');
    expect(JSON.stringify(input)).toBe(frozen); // input untouched
    expect(out).not.toBe(input); // a new object was returned
  });

  it('round-trips a karma vector through JSON unchanged', () => {
    const k = recordKarma(recordKarma(createKarma(), 'leaveOffering'), 'embraceWhisper');
    expect(JSON.parse(JSON.stringify(k))).toEqual(k);
  });
});

describe('KARMA_DELTAS table', () => {
  it('has an entry for every KarmaAction and touches only valid axes', () => {
    const validAxes = new Set([
      'mercyCruelty',
      'restraintGreed',
      'reverenceDesecration',
      'clarityDelusion',
    ]);
    for (const action of Object.keys(KARMA_DELTAS) as KarmaAction[]) {
      const delta = KARMA_DELTAS[action];
      const keys = Object.keys(delta);
      expect(keys.length).toBeGreaterThan(0); // every action moves at least one axis
      for (const key of keys) {
        expect(validAxes.has(key)).toBe(true);
        expect(Number.isFinite(delta[key as keyof KarmaState])).toBe(true);
      }
    }
  });
});
