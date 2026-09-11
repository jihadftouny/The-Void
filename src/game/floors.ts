// The floor hook for The Void — pure, framework-agnostic game logic (PLAN.md #2).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM or canvas imports. Every function is a pure read
//    of `../data/floors.json`; nothing here mutates, prints or rolls.
//  - Deterministic seeded RNG: this module makes NO random decision. The draws the floor
//    mechanics need (the illusion roll, the per-floor encounter pick, the corruption roll) are
//    taken by their callers from the state's `Rng`, in documented positions.
//  - Data-driven content: WHAT each floor does is data — its encounter weights, its passive and
//    triggered effects (the SAME `ItemEffect` shape a relic carries), its karma multiplier, its
//    illusion chance, its bargain pool and whether it warps the kit. Adding a floor effect is a
//    data edit plus, at most, one new generic effect primitive in `item.ts`.
//  - Serializable plain-data state: nothing new is stored. The floor is DERIVED from
//    `state.place` every time it is needed, so no save field records it.
//
// THE HYBRID RULE (GAME-DESIGN.md §8, "How floor mechanics are implemented"): simple numeric
// modifiers ride the existing effect/trigger pipeline (`relicEffects.ts`) — floor 3's dampened
// healing is a passive `healMultiplier`, its charge bleed a `startOfBattle` `drainCharge`
// trigger fired by the SAME `applyEffectAction` a relic uses. The two mechanics that cannot be
// expressed as a number — floor 2's illusions and floor 5's warped kit — are bespoke code
// (`battle.ts`, `encounter.ts`, `skill.ts`, `game.ts`), switched on by the data flags here.
//
// DIRECTION-AWARE BY CONSTRUCTION (GAME-DESIGN.md §17.5). Every mechanic reads the floor through
// `floorOf`, which keys on `state.place` — NEVER on `state.act`. `act` counts progress (1..5);
// `place` names the floor (0..4). On the descent they move together; on the Hollow ascent
// (PLAN.md #18) `act` will run 1..5 while `place` runs 4..0, and every mechanic here follows
// `place`. `floorContext` reports the direction from an optional `state.campaign` field that
// THIS unit does not add (absent ⇒ descent), so #18 adds the field and re-plumbs nothing.

import floorsData from '../data/floors.json';
import { type ItemEffect } from './item.ts';
import { type TriggeredEffect } from './equipEffects.ts';
import { type Pool } from './deal.ts';

/** A floor, 1..5 — `place + 1`. */
export type FloorId = 1 | 2 | 3 | 4 | 5;

/** Every floor, in descent order. */
export const FLOOR_IDS: readonly FloorId[] = [1, 2, 3, 4, 5];

/** The kinds of encounter a floor's table can present. */
export type FloorEncounter = 'battle' | 'chest' | 'rest' | 'bargain';

/** Every encounter kind, in the fixed order the weighted pick walks them (load-bearing). */
export const FLOOR_ENCOUNTERS: readonly FloorEncounter[] = ['battle', 'chest', 'rest', 'bargain'];

/** A probability as an exact fraction, so a "one in three" never becomes 0.333… in data. */
export interface Fraction {
  numerator: number;
  denominator: number;
}

/** One floor as authored in `floors.json`. */
export interface FloorDef {
  name: string;
  /** Integer weights, one per encounter kind. */
  encounters: Record<FloorEncounter, number>;
  /** Passive + triggered effects, in the relic effect shape. */
  effects: ItemEffect[];
  /** Karma earned on this floor is multiplied by this integer (floor 4: 2). */
  karmaMultiplier: number;
  /** The chance a random battle here is an illusion (floor 2 only). */
  illusionChance?: Fraction;
  /** Every bargain here is drawn from this pool, whatever the ledger (floor 4: tempting). */
  bargainPool?: Pool;
  /** Arriving here warps every owned skill (floor 5). */
  corruptsSkills?: boolean;
}

/** Which way the run is moving through the floors. */
export type FloorDirection = 'descent' | 'ascent';

/** Where the run is, and which way it is going. */
export interface FloorContext {
  floor: FloorId;
  direction: FloorDirection;
}

/**
 * Everything the engine reads about a floor, folded to plain values. Every field is
 * IDENTITY-valued on a floor with no mechanic (healPct 100, no triggers, multiplier 1, no
 * illusion, no pool override, no corruption) — so a floor-1 read changes nothing anywhere.
 */
export interface FloorModifiers {
  /** Percent of every dampenable heal the player actually receives. Identity 100. */
  healPct: number;
  /** The floor's triggered effects, fired by `relicEffects.fireFloorTriggers`. */
  triggered: TriggeredEffect[];
  karmaMultiplier: number;
  illusionChance: Fraction | null;
  bargainPool: Pool | null;
  corruptsSkills: boolean;
}

/**
 * The Difficulty Class of floor 2's passive Wisdom roll: `d20 + effective WIS mod >= 13` sees
 * through an illusion (and ends the fight with no reward).
 *
 * THE DERIVATION, from the dice rather than a run. A face f in 1..20 is uniform, so
 * P(see through) = p = (21 − (DC − mod)) / 20, clamped to [0, 1]. The roll comes FIRST in each
 * round (`resolveRound`'s step 0): a success ends the fight before the enemy acts, and each
 * failure costs one round of the enemy's real attacks. So an illusion takes 1/p rolls (the
 * rounds it lasts) but only (1 − p)/p rounds of enemy attacks:
 *   - WIS 10 (mod 0):  f >= 13 → p = 8/20 = 0.40: 2.5 rolls, about 1.5 rounds of attacks;
 *   - WIS 6  (mod −2): f >= 15 → p = 0.30: ~3.3 rolls, ~2.3 rounds of attacks;
 *   - WIS 16 (mod +3): f >= 10 → p = 0.55: ~1.8 rolls, ~0.8 rounds of attacks;
 *   - Lucid / Clouded shift the mod by ±1 through `effectiveMods`.
 * (Corrected in fix round 1: this said "2.5 rounds of the enemy's real attacks" at WIS 10 —
 * that is the ROLL count; the attacks are one fewer on average, because the roll comes first.)
 *
 * ⚠ FROZEN FOR `floor-mechanics` (GAME-DESIGN.md §22.27, plan Appendix A.4). Softening floor 2
 * for low-Wisdom builds is one of the author's three remedies for the Wisdom gap, and it is the
 * author's to choose. The balance report MEASURES the DC at 11 and 15 (injected through
 * `StepOptions.illusionDc`, never by editing this constant) so that choice is evidence-based.
 */
export const ILLUSION_DC = 13;

interface FloorsFile {
  status: string;
  floors: Record<string, FloorDef>;
}

const FLOORS = (floorsData as unknown as FloorsFile).floors;

/**
 * The floor a state is on: `place + 1`, clamped to 1..5.
 *
 * Keyed on `place`, never `act` — see the module header. The clamp exists for a malformed
 * dev-jumped state only (the engine writes `place` 0..4, and `validateJump` rejects anything
 * else); a clamp here means a bad value reads as the nearest real floor instead of crashing a
 * read that has no failure path.
 */
export function floorOf(state: { place: number }): FloorId {
  const place = Number.isInteger(state.place) ? state.place : 0;
  return (Math.min(Math.max(place, 0), 4) + 1) as FloorId;
}

/**
 * Where the run is and which way it is moving. `campaign` is read structurally so this unit
 * adds no state: until #18 adds the field, every run is a descent.
 */
export function floorContext(state: { place: number; campaign?: string }): FloorContext {
  return { floor: floorOf(state), direction: state.campaign === 'ascent' ? 'ascent' : 'descent' };
}

/** The authored definition of a floor. Throws only if `floors.json` lost a floor (a test pins all five). */
export function floorDef(floor: FloorId): FloorDef {
  const def = FLOORS[String(floor)];
  if (!def) throw new Error(`floors.json has no floor ${floor}`);
  return def;
}

/**
 * Fold a floor's data into the plain modifier bundle the engine reads — PURE.
 *
 * Passive effects fold exactly as `computeEquipModifiers` folds a relic's: `healMultiplier`
 * percentages MULTIPLY (two 50% effects would leave 25%), and every `triggered` effect is
 * collected in authoring order. Any other passive type on a floor is ignored (a floor carries no
 * gear stats), and a test asserts no shipped floor carries one.
 */
export function floorModifiers(floor: FloorId): FloorModifiers {
  const def = floorDef(floor);
  let healPct = 100;
  const triggered: TriggeredEffect[] = [];
  for (const effect of def.effects) {
    if (effect.type === 'triggered') {
      triggered.push({ trigger: effect.trigger, action: effect.action });
    } else if (effect.type === 'healMultiplier') {
      healPct = Math.floor((healPct * (effect.params.pct ?? 100)) / 100);
    }
  }
  return {
    healPct,
    triggered,
    karmaMultiplier: def.karmaMultiplier,
    illusionChance: def.illusionChance ?? null,
    bargainPool: def.bargainPool ?? null,
    corruptsSkills: def.corruptsSkills === true,
  };
}

/** Apply a floor's heal percentage to a heal — `floor(amount × pct / 100)`. Identity at 100. */
export function dampenHeal(amount: number, healPct: number): number {
  return healPct === 100 ? amount : Math.floor((amount * healPct) / 100);
}

/**
 * Everything wrong with a floors table, as readable strings — empty when it is sound. PURE.
 * The load-time guard's single definition: `floors.test.ts` runs it over the shipped data and
 * over hand-broken copies, so the rule is proved to fire rather than assumed to.
 */
export function floorProblems(floors: Record<string, FloorDef>): string[] {
  const problems: string[] = [];
  for (const id of FLOOR_IDS) {
    const def = floors[String(id)];
    if (!def) {
      problems.push(`floor ${id} is missing`);
      continue;
    }
    for (const kind of FLOOR_ENCOUNTERS) {
      const w = def.encounters?.[kind];
      if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) {
        problems.push(`floor ${id}: encounter weight "${kind}" must be a positive integer (got ${String(w)})`);
      }
    }
    if (!Number.isInteger(def.karmaMultiplier) || def.karmaMultiplier < 1) {
      problems.push(`floor ${id}: karmaMultiplier must be an integer >= 1`);
    }
    const ic = def.illusionChance;
    if (ic !== undefined) {
      const ok =
        Number.isInteger(ic.numerator) &&
        Number.isInteger(ic.denominator) &&
        ic.denominator > 0 &&
        ic.numerator > 0 &&
        ic.numerator <= ic.denominator;
      if (!ok) problems.push(`floor ${id}: illusionChance must be a proper positive fraction`);
    }
  }
  for (const key of Object.keys(floors)) {
    if (!FLOOR_IDS.map(String).includes(key)) problems.push(`unknown floor key "${key}"`);
  }
  return problems;
}

/** The shipped floors table, for the guard test. */
export function shippedFloors(): Record<string, FloorDef> {
  return FLOORS;
}
