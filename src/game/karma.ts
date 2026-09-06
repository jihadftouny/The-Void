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
// SCOPE: this module RECORDS karma only. `recordKarma` sums signed deltas into the
// vector and returns a new vector; it applies NO world/tone effect and clamps
// nothing. Clamping bounds are still deferred (#10).
//
// WHO CALLS IT (was: "no engine event carries a karma action in M1 — the reducer is
// exercised only by its unit test". BOTH halves of that are now false, and leaving
// them would invite someone to "restore" a dead module):
//   · a spare  -> game.ts folds the ⚖ family's `onSpare` LIST, in order, in one step.
//   · a kill   -> game.ts records the ⚖ family's `onKill`.
//   · a deal   -> deal.ts's `applyDeal`, for the four karma-shifting costs
//                 (desecrate / greed / offering / whisper).
// The first EFFECT is the act-4 verdict gate (`boss.ts computeVerdict`), plus the
// Sin's identity and bonus HP (`pickIndulgedAxis`) and the altar's offer pool
// (`deal.ts selectPool`).
//
// STILL UNWIRED, deliberately: `seeThroughIllusion`. It needs floor 2's illusions,
// and the only illusion seam in the engine is `statEffects.ts`'s
// `illusionSightTwist` — a `return 0` stub its own test labels as #2's. Inventing a
// trigger for it would mean inventing floor 2's mechanic.
//
// EVERY MAGNITUDE BELOW IS A #2 BALANCE PLACEHOLDER. §22.5 ruled WIRE and explicitly
// rejected re-weighting; the numbers are re-run with #2's balance pass.

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

/** A named karma-weighted action. Seven of the eight are wired; see the header. */
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
