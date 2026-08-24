// Karma / Nature vector for The Void — pure, framework-agnostic game logic (M1).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports.
//  - Deterministic seeded RNG: karma is fully deterministic bookkeeping — no dice,
//    no Math.random / Date.now. `recordKarma` is a pure function of its inputs.
//  - Data-driven content: the action -> delta mapping lives in the `KARMA_DELTAS`
//    data table, not in branching logic, so new karma-weighted actions are added as
//    data.
//  - Serializable plain-data state: `KarmaState` is a flat record of four numbers,
//    so it round-trips through JSON unchanged (no classes, no methods).
//
// SCOPE (M1): this module RECORDS karma only. `recordKarma` sums signed deltas into
// the vector and returns a new vector; it applies NO world/tone/gate/ending effect
// and clamps nothing. Karma changing an engine outcome is deferred (M10/M14), and
// clamping bounds are deferred to M14. Because no engine event carries a karma
// action in M1, live outcomes are unchanged — the reducer is exercised only by its
// unit test and stands ready for later milestones.

/**
 * The four-axis Karma / Nature vector. SIGN CONVENTION: positive = the virtue pole,
 * negative = the shadow pole, 0 = neutral.
 */
export interface KarmaState {
  /** + mercy      / − cruelty */
  mercyCruelty: number;
  /** + restraint  / − greed */
  restraintGreed: number;
  /** + reverence  / − desecration */
  reverenceDesecration: number;
  /** + clarity    / − delusion */
  clarityDelusion: number;
}

/** A named karma-weighted action. Real action -> axis authoring lands in M7/M8/M10. */
export type KarmaAction =
  | 'spareWeighted'
  | 'killWeighted'
  | 'lootGreedily'
  | 'leaveOffering'
  | 'desecrateShrine'
  | 'honorDead'
  | 'embraceWhisper'
  | 'seeThroughIllusion';

/**
 * The action -> signed-delta table. Provisional M1 magnitudes: their only job now is
 * to give the reducer a data-driven, testable mechanism. Each entry lists ONLY the
 * axes it moves; unlisted axes are unchanged.
 */
export const KARMA_DELTAS: Record<KarmaAction, Partial<KarmaState>> = {
  spareWeighted: { mercyCruelty: 1 },
  killWeighted: { mercyCruelty: -1 },
  lootGreedily: { restraintGreed: -1 },
  leaveOffering: { restraintGreed: 1, reverenceDesecration: 1 },
  desecrateShrine: { reverenceDesecration: -2 },
  honorDead: { reverenceDesecration: 1 },
  embraceWhisper: { clarityDelusion: -1 },
  seeThroughIllusion: { clarityDelusion: 1 },
};

/** A fresh, neutral karma vector — every axis at 0. */
export function createKarma(): KarmaState {
  return {
    mercyCruelty: 0,
    restraintGreed: 0,
    reverenceDesecration: 0,
    clarityDelusion: 0,
  };
}

/**
 * Record a karma-weighted action: return a NEW vector with the action's deltas added
 * axis-wise onto `karma`. PURE — it never mutates the input and applies no effect. The
 * result is unbounded (clamping deferred to M14).
 */
export function recordKarma(karma: KarmaState, action: KarmaAction): KarmaState {
  const delta = KARMA_DELTAS[action];
  return {
    mercyCruelty: karma.mercyCruelty + (delta.mercyCruelty ?? 0),
    restraintGreed: karma.restraintGreed + (delta.restraintGreed ?? 0),
    reverenceDesecration: karma.reverenceDesecration + (delta.reverenceDesecration ?? 0),
    clarityDelusion: karma.clarityDelusion + (delta.clarityDelusion ?? 0),
  };
}
