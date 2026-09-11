// #10a — the karma ACTIONS, wired and reached.
//
// WHAT WAS ACTUALLY BROKEN, stated honestly, because a test comment that enshrines a wrong
// claim is worse than no comment:
//
//   · GRACE WAS ALREADY REACHABLE. `GATE_THRESHOLD` is 1 and `mercyCruelty` carries weight 1,
//     so a single spare earns it; the shipped `mercifulPolicy` reaches grace in 26 of 200 runs
//     today, and `sim.test.ts` / `game.test.ts` already assert a grace verdict. Do NOT write
//     "grace was unreachable" into this suite.
//   · What was NOT reachable, and is what this unit exists for:
//       - a NON-NEGATIVE `reverenceDesecration`. Its only wired input was `desecrateShrine`
//         (-2), so one axis of a four-axis system was ONE-DIRECTIONAL and permanently <= 0.
//       - the `grace` DEAL POOL. `selectPool` opens it at reverence >= 3, which no input
//         sequence could produce — taking the `mirror-shard` template with it.
//       - "The Delusion". `clarityDelusion` was permanently 0, and `pickIndulgedAxis` needs
//         `v < 0`, so the act-3 Sin could never wear that name.
//
// Every expected value below is derived from `GAME-DESIGN.md` §7 / §9 / §17 / §22.16 / §22.22
// and from `karma.ts`'s KARMA_DELTAS table read as a SPEC — never measured from a run and
// pasted back. Where a count is measured (how many runs reach the act-4 verdict), the
// assertion is a floor the design implies, not the number that came out.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame,
  step,
  awaitingFor,
  type GameState,
  type StepResult,
} from './game.ts';
import { ALL_CLASSES, heuristicPolicy, mercifulPolicy, type SimPolicy } from './sim.ts';
import {
  applyDeal,
  canAfford,
  selectPool,
  buildDeal,
  describeCost,
  describeReward,
  type DealCost,
  type DealReward,
  type SacrificeDeal,
} from './deal.ts';
import { STAT_KEYS } from './character.ts';
import {
  createKarma,
  KARMA_DELTAS,
  type KarmaAction,
  type KarmaState,
} from './karma.ts';
import {
  GATE_THRESHOLD,
  GATE_WEIGHTS,
  SIN_BY_AXIS,
  generateBoss,
  pickIndulgedAxis,
  type KarmaAxis,
} from './boss.ts';
import { HOLLOW_GATE_XP } from './progression.ts';
import { SAVE_VERSION, encodeSave, decodeSave } from './save.ts';
import { mulberry32 } from './rng.ts';
import { type Player, type PlayerClass } from './player.ts';
import { type GameEvent } from './gameEvent.ts';
import { formatEvent } from '../render/format.ts';
import { describeEvent } from '../llm/narrate.ts';
import { dealView } from '../desktop/view-model.ts';

// =============================================================================================
// Harness — every state below is produced by the REAL `step`, never hand-assembled, except
// where a test says otherwise IN THE TEST and says why.
// =============================================================================================

const CLASS: PlayerClass = 'Enforcer';

/** Walk character creation with the real `step` and stop at the hub. */
function newRunAtHub(seed: number, classId: PlayerClass = CLASS): StepResult {
  let r = step(createGame(seed), { kind: 'continue' });
  r = step(r.state, { kind: 'name', name: 'Pilgrim' });
  r = step(r.state, { kind: 'class', classId });
  r = step(r.state, { kind: 'stats-decision', accept: true });
  expect(r.awaiting).toBe('main-menu');
  expect(r.state.karma).toEqual(createKarma()); // a fresh ledger, all four axes at 0
  return r;
}

/** A `StepResult` wrapper for a state nothing has stepped yet. */
function atStart(state: GameState): StepResult {
  return { state, events: [], awaiting: awaitingFor(state.phase) };
}

/** Play under `policy` with the real `step` until `pred` holds; throws if it never does. */
function playUntil(
  seed: number,
  policy: SimPolicy,
  pred: (r: StepResult) => boolean,
  guard = 200_000,
): StepResult {
  let r = atStart(createGame(seed));
  let steps = 0;
  while (r.awaiting !== 'game-over' && steps < guard) {
    r = step(r.state, policy(r));
    steps += 1;
    if (pred(r)) return r;
  }
  throw new Error(`playUntil: predicate never held (seed ${seed}, ${steps} steps)`);
}

/** A hub state whose backpack holds at least `n` items, reached only by real `step` calls. */
function hubWithItems(seed: number, n: number): StepResult {
  // `heuristicPolicy` never spares and never seeks a deal, so the karma vector it produces
  // touches ONLY `mercyCruelty` (kills). Reverence/restraint/clarity are still exactly 0 here,
  // which is what lets the tests below read an absolute value rather than a delta.
  return playUntil(seed, heuristicPolicy(CLASS), (r) => {
    return (
      r.awaiting === 'main-menu' && (r.state.player?.inventory.backpack.length ?? 0) >= n
    );
  });
}

/**
 * Seek the altar through the real `step` until it offers `want`, then ACCEPT that offer.
 * Every other offer is DECLINED — which changes nothing but the rng — so the karma delta the
 * caller sees comes from exactly one accepted deal.
 */
function seekAndAccept(from: StepResult, want: DealCost['kind'], maxSeeks = 300): StepResult {
  let r = from;
  for (let i = 0; i < maxSeeks; i += 1) {
    r = step(r.state, { kind: 'menu', choice: 'seek-deal' });
    const phase = r.state.phase;
    if (phase.kind !== 'deal') throw new Error(`seek-deal did not open a deal (${phase.kind})`);
    const offered = phase.deal.cost.kind;
    r = step(r.state, { kind: 'deal-decision', accept: offered === want });
    if (offered === want) return r;
  }
  throw new Error(`seekAndAccept: no '${want}' offer in ${maxSeeks} seeks`);
}

/**
 * One observed spare: which family, the karma either side of the single `step`, and — since fix
 * round 1 — THE EVENTS THAT STEP EMITTED. They used to be thrown away, which is exactly why the
 * invisibility guard never scanned the `spared` event: axis nouns injected into `formatEvent` and
 * `describeEvent` left the whole 1692-test suite green.
 */
interface SpareObservation {
  familyId: string;
  /** The floor index (`state.place`) the spare happened on — floor 4 (place 3) counts double. */
  place: number;
  before: KarmaState;
  after: KarmaState;
  events: GameEvent[];
}

/** Every spare a merciful run performs, watched at the exact `step` that performs it. */
function observeSpares(seed: number, classId: PlayerClass, guard = 200_000): SpareObservation[] {
  const out: SpareObservation[] = [];
  const policy = mercifulPolicy(classId);
  let r = atStart(createGame(seed));
  let steps = 0;
  while (r.awaiting !== 'game-over' && steps < guard) {
    const before = r.state.karma;
    const phase = r.state.phase;
    const familyId = phase.kind === 'battle' ? phase.battle.enemy.familyId : null;
    const place = r.state.place;
    r = step(r.state, policy(r));
    steps += 1;
    if (familyId !== null && r.events.some((e) => e.kind === 'spared')) {
      out.push({ familyId, place, before, after: r.state.karma, events: [...r.events] });
    }
  }
  return out;
}

/** The axis-wise delta between two karma vectors. */
function karmaDelta(before: KarmaState, after: KarmaState): KarmaState {
  return {
    mercyCruelty: after.mercyCruelty - before.mercyCruelty,
    restraintGreed: after.restraintGreed - before.restraintGreed,
    reverenceDesecration: after.reverenceDesecration - before.reverenceDesecration,
    clarityDelusion: after.clarityDelusion - before.clarityDelusion,
  };
}

// =============================================================================================
// 1. The numbers this unit is NOT allowed to move (§22.5 ruled WIRE, and explicitly rejected
//    re-weighting; #2 owns every magnitude). Pinned so a red test cannot be "fixed" by retuning.
// =============================================================================================

describe('the balance constants #10a must not touch', () => {
  it('KARMA_DELTAS is exactly the shipped table, all eight actions', () => {
    const EXPECTED: Record<KarmaAction, Partial<KarmaState>> = {
      spareWeighted: { mercyCruelty: 1 },
      killWeighted: { mercyCruelty: -1 },
      lootGreedily: { restraintGreed: -1 },
      leaveOffering: { restraintGreed: 1, reverenceDesecration: 1 },
      desecrateShrine: { reverenceDesecration: -2 },
      honorDead: { reverenceDesecration: 1 },
      embraceWhisper: { clarityDelusion: -1 },
      seeThroughIllusion: { clarityDelusion: 1 },
    };
    expect(KARMA_DELTAS).toEqual(EXPECTED);
  });

  it('the verdict gate is unchanged: reverence x3, the rest x1, threshold 1', () => {
    expect(GATE_WEIGHTS).toEqual({
      reverenceDesecration: 3,
      mercyCruelty: 1,
      restraintGreed: 1,
      clarityDelusion: 1,
    });
    expect(GATE_THRESHOLD).toBe(1);
    expect(HOLLOW_GATE_XP).toBe(500);
  });

  it('§22.16 holds arithmetically: every delta is an integer, so >= 1 IS "net-positive"', () => {
    // §22.16 says any net-positive ledger earns grace. `GATE_THRESHOLD` is 1, not 0, which
    // only implements that because the weighted sum can never land strictly between 0 and 1.
    for (const [action, delta] of Object.entries(KARMA_DELTAS)) {
      for (const [axis, value] of Object.entries(delta)) {
        expect(Number.isInteger(value), `${action}.${axis}`).toBe(true);
      }
    }
    for (const w of Object.values(GATE_WEIGHTS)) expect(Number.isInteger(w)).toBe(true);
  });

  it('seeThroughIllusion is WIRED (PLAN.md #2) — and fires only from seeing through an illusion', () => {
    // It was the last unwired action until floor 2 existed. The delta is unchanged, and the ONE
    // shipping site that records it is game.ts's `dispelled` branch — held by a source scan so a
    // second, easier trigger cannot quietly appear. Its behaviour through the real `step` is in
    // `illusion.test.ts` (a dispel moves clarity by exactly +1 on floor 2).
    expect(KARMA_DELTAS.seeThroughIllusion).toEqual({ clarityDelusion: 1 });
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const sites: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'karma.ts') continue;
      const src = readFileSync(join(dir, name), 'utf8');
      const count = (src.match(/'seeThroughIllusion'/g) ?? []).length;
      for (let i = 0; i < count; i++) sites.push(name);
    }
    expect(sites).toEqual(['game.ts']);
    const game = readFileSync(join(dir, 'game.ts'), 'utf8');
    const at = game.indexOf("'seeThroughIllusion'");
    const branch = game.lastIndexOf('case ', at);
    expect(game.slice(branch, branch + 20)).toMatch(/case 'dispelled'/);
  });
});

// =============================================================================================
// 2. The three wirings, asserted on the state the REAL `step` returned — not on a helper's
//    return value. "A correct decision computed and then discarded" is this project's most
//    expensive recurring defect, and `applyDeal` returning the right karma proves nothing if
//    `resolveDealDecision` drops it.
// =============================================================================================

describe('leaveOffering — accepting an offering deal, through the real step', () => {
  it('moves restraint +1 AND reverence +1, leaves the other two axes alone, and takes an item', () => {
    const hub = hubWithItems(1, 1);
    const before = hub.state.karma;
    const packBefore = hub.state.player!.inventory.backpack;
    const r = seekAndAccept(hub, 'offering');

    // Read off KARMA_DELTAS.leaveOffering as a spec: { restraintGreed: 1, reverenceDesecration: 1 }.
    expect(karmaDelta(before, r.state.karma)).toEqual({
      mercyCruelty: 0,
      restraintGreed: 1,
      reverenceDesecration: 1,
      clarityDelusion: 0,
    });
    // The cost was really paid. Without this, a free-karma implementation passes everything above.
    expect(r.state.player!.inventory.backpack).toHaveLength(packBefore.length - 1);
    expect(r.state.player!.inventory.backpack).toEqual(packBefore.slice(1));
    expect(r.events.some((e) => e.kind === 'deal-taken')).toBe(true);
  });

  it('with an EMPTY backpack the same offer is refused: no karma, no pack change', () => {
    // The single most likely silent bug in this unit — `canAfford`'s old `default: return true`
    // would have made this an unlimited, cost-free reverence tap at a free, unlimited hub
    // action. Driven through `step` so it pins the SHIPPING path, not just the pure helper.
    let r = newRunAtHub(3);
    expect(r.state.player!.inventory.backpack).toEqual([]);
    const before = r.state.karma;

    let found = false;
    for (let i = 0; i < 300 && !found; i += 1) {
      r = step(r.state, { kind: 'menu', choice: 'seek-deal' });
      const phase = r.state.phase;
      if (phase.kind !== 'deal') throw new Error('seek-deal did not open a deal');
      found = phase.deal.cost.kind === 'offering';
      r = step(r.state, { kind: 'deal-decision', accept: found });
    }
    expect(found, 'no offering was ever offered — the sweep proved nothing').toBe(true);
    expect(r.events.map((e) => e.kind)).toContain('deal-unaffordable');
    expect(r.events.some((e) => e.kind === 'deal-taken')).toBe(false);
    expect(r.state.karma).toEqual(before);
    expect(r.state.player!.inventory.backpack).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// FIX ROUND 1, FINDING 1. The test below this block ("N items buy exactly N reverence") was
// TRUE and HOLLOW: its policy accepts only `offering` deals, so it structurally could not
// observe the loop it claimed to rule out. That is the empty-collection failure one level up —
// not a vacuous assertion, a SCENARIO THAT EXCLUDES THE FAILURE MODE. It is kept, because the
// per-item bound it states is still worth pinning, but it is no longer the farmability guard.
//
// THE LOOP IT COULD NOT SEE. `canAfford` returned `true` unconditionally for `statPoint` and
// `skillCharge` (the two arms this unit hand-wrote when it deleted G20's `default: return true`),
// while `withStat` clamps at `MIN_STAT` and the charge subtraction clamps at 0. So at CHA 1 and
// at 0 charges those deals were "affordable", took NOTHING, and still paid out — and both of the
// templates they gate pay out an ITEM (`standard[1]` a rolled ring, `grace[1]` the mirror-shard).
// #10a's offering turns an item into +1 reverence / +1 restraint. Result, measured through the
// real `step` from a fresh hub with NO COMBAT AT ALL: 6000 free seeks produced a weighted ledger
// of 7512 against `GATE_THRESHOLD` 1 — the ending, bought from the menu.
//
// The guard below is written so its scenario CAN reach that: it accepts EVERY kind of deal.
// ---------------------------------------------------------------------------------------------

/** A player's whole material footprint — what a cost is allowed to take from. */
function footprint(p: Player) {
  return {
    hp: p.hp,
    maxHp: p.maxHp,
    stats: STAT_KEYS.reduce((sum, k) => sum + p.stats[k], 0),
    charges: p.skillCharges,
    pack: p.inventory.backpack.length,
  };
}

/** True when `after` is strictly smaller than `before` in at least one material dimension. */
function tookSomethingMaterial(before: Player, after: Player): boolean {
  const a = footprint(before);
  const b = footprint(after);
  return b.hp < a.hp || b.maxHp < a.maxHp || b.stats < a.stats || b.charges < a.charges || b.pack < a.pack;
}

describe('every cost must actually TAKE something — the rule the two hand-written arms broke', () => {
  // The general statement, so a FUTURE arm cannot repeat this. A cost is legitimate only if
  // accepting it either removes a material resource or moves the weighted ledger DOWN. The
  // three purely-karmic costs pay in karma; every other kind pays in substance.
  const rich = (): Player => {
    const base = newRunAtHub(7).state.player!;
    return {
      ...base,
      hp: 40,
      maxHp: 40,
      skillCharges: 5,
      stats: { STR: 14, DEX: 14, CON: 14, INT: 14, WIS: 14, CHA: 14 },
      inventory: {
        slots: { ...base.inventory.slots },
        backpack: [{ defId: 'mirror-shard' }, { defId: 'Jaaj Sword 1' }],
      },
    };
  };
  /** A reward that grants literally nothing, so it cannot mask a cost that took nothing. */
  const NOTHING: DealReward = { kind: 'heal', amount: 0 };

  it('holds for every DealCost KIND (type-exhaustive)', () => {
    const costs: Record<DealCost['kind'], DealCost> = {
      hp: { kind: 'hp', amount: 5 },
      maxHp: { kind: 'maxHp', amount: 5 },
      statPoint: { kind: 'statPoint', stat: 'CHA' },
      skillCharge: { kind: 'skillCharge', amount: 1 },
      relic: { kind: 'relic' },
      offering: { kind: 'offering' },
      desecrate: { kind: 'desecrate' },
      greed: { kind: 'greed' },
      whisper: { kind: 'whisper' },
    };
    let checked = 0;
    for (const [kind, cost] of Object.entries(costs)) {
      const player = rich();
      expect(canAfford(player, cost), `${kind} should be affordable for this fixture`).toBe(true);
      const r = applyDeal(player, createKarma(), { pool: 'standard', cost, reward: NOTHING });
      expect(r.outcome, kind).toBe('taken');
      const paidInSubstance = tookSomethingMaterial(player, r.player);
      const paidInKarma = designLedger(r.karma) < designLedger(createKarma());
      expect(paidInSubstance || paidInKarma, `${kind} was FREE — it took nothing`).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(9);
  });

  it('holds for every template the SHIPPED deals.json can actually build', () => {
    // Layer two, and the one that catches a future `"amount": 0` authored in the data rather
    // than a bad arm in the code. Every offer the real `buildDeal` produces, across all three
    // pools, must take something from a player who can afford it.
    const seen = new Set<string>();
    let checked = 0;
    for (const karma of [
      createKarma(),
      { ...createKarma(), restraintGreed: -5 },
      { ...createKarma(), reverenceDesecration: 5 },
    ]) {
      for (let seed = 1; seed <= 120; seed += 1) {
        const deal = buildDeal(karma, 1, mulberry32(seed));
        const player = rich();
        if (!canAfford(player, deal.cost)) continue;
        const r = applyDeal(player, createKarma(), { ...deal, reward: NOTHING });
        expect(r.outcome).toBe('taken');
        const paidInSubstance = tookSomethingMaterial(player, r.player);
        const paidInKarma = designLedger(r.karma) < designLedger(createKarma());
        expect(paidInSubstance || paidInKarma, `${deal.pool}/${deal.cost.kind} was FREE`).toBe(true);
        seen.add(`${deal.pool}/${deal.cost.kind}`);
        checked += 1;
      }
    }
    // Non-vacuity: the sweep really saw every authored cost kind in every pool it lives in.
    expect([...seen].sort()).toEqual([
      'grace/hp',
      'grace/offering',
      'grace/statPoint',
      'standard/hp',
      'standard/offering',
      'standard/skillCharge',
      'standard/statPoint',
      'standard/whisper',
      'tempting/desecrate',
      'tempting/greed',
      'tempting/maxHp',
      'tempting/whisper',
    ]);
    expect(checked).toBeGreaterThan(300);
  });
});

describe('the altar cannot MINT the ledger — an ALL-ACCEPTING seeker, no combat at all', () => {
  // THE guard finding 1 asked for, written so it can reach the defect: from a fresh hub, the
  // ONLY input is `seek-deal` followed by accept — every kind, unconditionally. No `continue`,
  // so no battle, no chest, no loot: every item this character ever holds was sold to it by the
  // altar. Under the pre-fix code the ledger climbed without bound (7512 after 6000 seeks); it
  // must now SATURATE, because every item the altar sells is paid for out of a finite,
  // strictly-decreasing player resource.

  /** Seek and accept `n` times through the real `step`, tallying what was actually taken. */
  function farm(from: StepResult, n: number, tally: Map<DealCost['kind'], number>) {
    let r = from;
    let peakPack = 0;
    for (let i = 0; i < n; i += 1) {
      r = step(r.state, { kind: 'menu', choice: 'seek-deal' });
      const phase = r.state.phase;
      if (phase.kind !== 'deal') throw new Error('seek-deal did not open a deal');
      const kind = phase.deal.cost.kind;
      r = step(r.state, { kind: 'deal-decision', accept: true });
      if (r.events.some((e) => e.kind === 'deal-taken')) {
        tally.set(kind, (tally.get(kind) ?? 0) + 1);
      }
      peakPack = Math.max(peakPack, r.state.player!.inventory.backpack.length);
    }
    return { result: r, peakPack };
  }

  const SEEKS = 600;

  /** One whole free-farming session: 2 x SEEKS accepts, with the halfway ledger kept. */
  function session(seed: number) {
    const hub = newRunAtHub(seed);
    const start = hub.state.player!;
    const taken = new Map<DealCost['kind'], number>();
    const half = farm(hub, SEEKS, taken);
    const full = farm(half.result, SEEKS, taken);
    return {
      seed,
      start,
      taken,
      peakPack: half.peakPack,
      halfKarma: half.result.state.karma,
      karma: full.result.state.karma,
      end: full.result.state.player!,
    };
  }

  // Six independent streams, not one — a single seed's draw order can miss a template entirely
  // (seed 13 never draws a whisper before the pool flips), and a guard that depends on one
  // lucky stream is a guard that stopped covering what it names.
  const SESSIONS = [1, 2, 3, 4, 5, 6].map(session);

  it('the scenario really reaches the loop — otherwise this whole describe proves nothing', () => {
    // The hollow-test guard, made explicit. If the seeker never bought an item off the altar and
    // never turned one into an offering, everything below would hold trivially.
    for (const s of SESSIONS) {
      expect(s.start.inventory.backpack, `seed ${s.seed} starts with nothing`).toEqual([]);
      expect(s.peakPack, `seed ${s.seed}: the altar never sold it an item`).toBeGreaterThan(0);
      expect(s.taken.get('offering') ?? 0, `seed ${s.seed}: no offering made`).toBeGreaterThan(0);
      expect(
        (s.taken.get('statPoint') ?? 0) + (s.taken.get('skillCharge') ?? 0),
        `seed ${s.seed}: neither item-selling template was taken`,
      ).toBeGreaterThan(0);
      expect(s.karma.reverenceDesecration, `seed ${s.seed}: the mint path never ran`).toBeGreaterThan(0);
      expect(s.taken.get('whisper') ?? 0, `seed ${s.seed}: no whisper taken`).toBeGreaterThan(0);
    }
    expect(SESSIONS).toHaveLength(6);
  });

  it('the mintable half of the ledger SATURATES — twice the seeks buy no more karma', () => {
    // The sharpest form of "not farmable": doubling the effort adds nothing. Under the pre-fix
    // code this is simply false — the ledger grew linearly with the seek count, forever.
    for (const s of SESSIONS) {
      expect(s.karma.reverenceDesecration, `seed ${s.seed}`).toBe(s.halfKarma.reverenceDesecration);
      expect(s.karma.restraintGreed, `seed ${s.seed}`).toBe(s.halfKarma.restraintGreed);
    }
  });

  it('and it is bounded by what the character actually rolled, derived by hand', () => {
    // Every item the altar sells is bought with either ONE skill charge (`standard[1]` -> a
    // rolled ring) or ONE CHA point above `MIN_STAT` (`grace[1]` -> mirror-shard); the only
    // charge-GRANTING template (`standard[2]`) itself costs a CHA point and grants at most 2.
    // So every altar item traces back to a starting charge or a CHA point, and a CHA point
    // yields at most 2 charges:
    //     itemsFromAltar <= startCharges + 2 * (startCHA - MIN_STAT)
    // The backpack began empty and nothing was fought, so every offering spent an altar item,
    // and each offering is exactly +1 reverence and +1 restraint.
    const MIN_STAT = 1; // deal.ts's documented stat floor
    for (const s of SESSIONS) {
      const bound = s.start.skillCharges + 2 * (s.start.stats.CHA - MIN_STAT);
      const offerings = s.taken.get('offering') ?? 0;
      expect(s.karma.reverenceDesecration, `seed ${s.seed}`).toBe(offerings);
      expect(s.karma.restraintGreed, `seed ${s.seed}`).toBe(offerings);
      expect(s.karma.reverenceDesecration, `seed ${s.seed} bound ${bound}`).toBeLessThanOrEqual(bound);
      expect(s.karma.mercyCruelty, `seed ${s.seed}: nothing was fought`).toBe(0);
      // The whisper is free and repeatable (G52's shape), so clarity falls once per whisper —
      // a COST, dragging the total ledger DOWN. The exact identity pins the sign and magnitude.
      expect(s.karma.clarityDelusion, `seed ${s.seed}`).toBe(-(s.taken.get('whisper') ?? 0));
    }
  });

  it('the character really paid: CHA is drained and the pack empties out', () => {
    for (const s of SESSIONS) {
      expect(s.end.stats.CHA, `seed ${s.seed}`).toBeLessThan(s.start.stats.CHA);
      expect(s.end.inventory.backpack, `seed ${s.seed}: every bought item was spent`).toEqual([]);
      // …and every other stat is untouched — only the CHA the shipped templates ask for.
      for (const key of STAT_KEYS) {
        if (key === 'CHA') continue;
        expect(s.end.stats[key], `seed ${s.seed}/${key}`).toBe(s.start.stats[key]);
      }
    }
  });
});

describe('leaveOffering — the per-item bound (true, but NOT the farmability guard: see above)', () => {
  it('N items buy exactly N reverence, and the N+1th offering is refused', () => {
    // `seek-deal` is a free, unlimited hub action (FINDINGS G52), so anything it grants that is
    // not paid for in a finite resource is farmable to any ledger the player likes. The
    // offering's price is a backpack item, the altar never hands an item back, so the item
    // count strictly falls and the tap runs dry. This is the bound, asserted rather than
    // asserted-about.
    const N = 4;
    const hub = hubWithItems(1, N);
    const owned = hub.state.player!.inventory.backpack.length;
    expect(owned).toBeGreaterThanOrEqual(N);
    const before = hub.state.karma.reverenceDesecration;

    let r = hub;
    for (let i = 0; i < owned; i += 1) r = seekAndAccept(r, 'offering');
    expect(r.state.karma.reverenceDesecration).toBe(before + owned);
    expect(r.state.player!.inventory.backpack).toEqual([]);

    // One more time: the altar refuses, and the ledger does not move.
    const stalled = r.state.karma;
    let refused = false;
    for (let i = 0; i < 300 && !refused; i += 1) {
      r = step(r.state, { kind: 'menu', choice: 'seek-deal' });
      const phase = r.state.phase;
      if (phase.kind !== 'deal') throw new Error('seek-deal did not open a deal');
      const isOffering = phase.deal.cost.kind === 'offering';
      r = step(r.state, { kind: 'deal-decision', accept: isOffering });
      refused = isOffering;
    }
    expect(refused, 'the altar never offered again — the bound proved nothing').toBe(true);
    expect(r.events.map((e) => e.kind)).toContain('deal-unaffordable');
    expect(r.state.karma).toEqual(stalled);
  });
});

describe('embraceWhisper — accepting a whisper deal, through the real step', () => {
  it('moves clarity -1 and nothing else, and costs nothing material', () => {
    const hub = newRunAtHub(5);
    const player = hub.state.player!;
    const r = seekAndAccept(hub, 'whisper');

    // KARMA_DELTAS.embraceWhisper = { clarityDelusion: -1 }. The SIGN is the assertion:
    // karma.ts's convention is positive = virtue, and heeding a whisper is the shadow pole.
    expect(r.state.karma).toEqual({ ...createKarma(), clarityDelusion: -1 });
    expect(r.state.player!.inventory.backpack).toEqual([]);
    expect(r.state.player!.stats).toEqual(player.stats);
    expect(r.state.player!.maxHp).toBe(player.maxHp);
  });
});

describe('honorDead — sparing The Judged, through the real step', () => {
  // §22.22: a Judged spare is mercy AND reverence in ONE step. A list that quietly applies only
  // its first entry looks perfect and does half the job, so both axes are asserted at once, on
  // the karma vector `step` returned, for EVERY Judged spare a real run performs.
  const observations = [1, 2, 3, 4, 5, 6]
    .flatMap((seed) => observeSpares(seed, 'Penitent'))
    .concat([1, 2, 3, 4, 5, 6].flatMap((seed) => observeSpares(seed, 'Enforcer')));
  const judged = observations.filter((o) => o.familyId === 'theJudged');
  const otherWeighted = observations.filter((o) => o.familyId !== 'theJudged');

  it('is REACHED at all — a merciful run really does meet and spare The Judged', () => {
    // Reachability measured, not assumed: `theJudged` is in DEFAULT_FAMILIES so it is drawable
    // on run 1, and act 4 is played from xp 90 to the verdict at xp 240.
    expect(judged.length).toBeGreaterThan(0);
    expect(otherWeighted.length).toBeGreaterThan(0); // the control set is non-empty too
  });

  // PLAN.md #2 (GAME-DESIGN §8 / §22.24): karma earned on FLOOR 4 counts DOUBLE. The multiplier
  // is written here from the ruling — place 3 is floor 4 — not read from `floors.json`.
  const weight = (place: number): number => (place === 3 ? 2 : 1);

  it('moves BOTH mercy and reverence in the SAME step, every time (x2 on floor 4)', () => {
    for (const o of judged) {
      const w = weight(o.place);
      expect(karmaDelta(o.before, o.after)).toEqual({
        mercyCruelty: 1 * w,
        restraintGreed: 0,
        reverenceDesecration: 1 * w,
        clarityDelusion: 0,
      });
    }
    // The Judged are a floor-4 family, so every observed Judged spare really is doubled —
    // asserted, or the x2 above would be satisfied by a weight that is always 1.
    expect(judged.every((o) => o.place === 3)).toBe(true);
  });

  it('every OTHER ⚖ family still spares as mercy alone — the family data carries the change', () => {
    // The control that proves the seam, not the spare path, is what differs. If `game.ts` had
    // been taught "a spare also honours the dead", this goes red.
    for (const o of otherWeighted) {
      expect(karmaDelta(o.before, o.after), o.familyId).toEqual({
        mercyCruelty: 1 * weight(o.place),
        restraintGreed: 0,
        reverenceDesecration: 0,
        clarityDelusion: 0,
      });
    }
  });
});

// =============================================================================================
// 3. Reachability — the defect being fixed is unreachability, so "wired" is not enough.
// =============================================================================================

describe('the offers are drawable from NEUTRAL karma (not from a pool you must already deserve)', () => {
  it('a bounded rng sweep at a fresh ledger produces both new costs', () => {
    // Putting `offering` only in `grace` would have been circular: `grace` opens at reverence
    // >= 3 and the offering is the only way to earn it. Putting `whisper` only in `tempting`
    // would have hidden The Delusion behind a fall the player must already have committed to.
    const kinds = new Set<DealCost['kind']>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const deal = buildDeal(createKarma(), 1, mulberry32(seed));
      expect(deal.pool).toBe('standard'); // a fresh ledger is never offered grace or tempting
      kinds.add(deal.cost.kind);
    }
    expect(kinds.has('offering')).toBe(true);
    expect(kinds.has('whisper')).toBe(true);
  });
});

describe('the grace deal pool — and mirror-shard with it — is reachable now', () => {
  it('three offerings through the real step open it, and the shard can then be taken', () => {
    const hub = hubWithItems(1, 3);
    // Reverence is exactly 0 here: `heuristicPolicy` never spares and never deals, so the only
    // karma it wrote is on `mercyCruelty`.
    expect(hub.state.karma.reverenceDesecration).toBe(0);
    expect(selectPool(hub.state.karma)).toBe('standard');

    let r = hub;
    for (let i = 0; i < 3; i += 1) r = seekAndAccept(r, 'offering');

    // 3 x KARMA_DELTAS.leaveOffering.reverenceDesecration (+1) = 3, which is `selectPool`'s
    // REVERENCE_TH. This vector came only out of `step`.
    expect(r.state.karma.reverenceDesecration).toBe(3);
    expect(r.state.karma.restraintGreed).toBe(3);
    expect(selectPool(r.state.karma)).toBe('grace');

    // …and re-seeking really draws the grace pool's `mirror-shard` template.
    let took = false;
    for (let i = 0; i < 120 && !took; i += 1) {
      r = step(r.state, { kind: 'menu', choice: 'seek-deal' });
      const phase = r.state.phase;
      if (phase.kind !== 'deal') throw new Error('seek-deal did not open a deal');
      expect(phase.deal.pool).toBe('grace');
      const reward = phase.deal.reward;
      took = reward.kind === 'item' && reward.instance.defId === 'mirror-shard';
      r = step(r.state, { kind: 'deal-decision', accept: took });
    }
    expect(took, 'the grace pool never offered mirror-shard').toBe(true);
    expect(r.state.player!.inventory.backpack).toContainEqual({ defId: 'mirror-shard' });
  });
});

describe('"The Delusion" can be the act-3 Sin now', () => {
  it('one whisper taken through the real step makes clarity the indulged axis', () => {
    // From the hub with no battle fought, every other axis is 0, so a single -1 on clarity is
    // the most-negative axis outright — no tie-break needed.
    const r = seekAndAccept(newRunAtHub(5), 'whisper');
    expect(r.state.karma).toEqual({ ...createKarma(), clarityDelusion: -1 });
    expect(pickIndulgedAxis(r.state.karma)).toBe('clarityDelusion');
    expect(SIN_BY_AXIS[pickIndulgedAxis(r.state.karma)].name).toBe('The Delusion');

    const boss = generateBoss({
      bossId: 'sin',
      act: 3,
      player: r.state.player!,
      karma: r.state.karma,
      rng: mulberry32(9),
    });
    expect(boss.enemy.fullName).toBe('The Delusion');
  });

  it('CONTROL — the pre-#10a ledger still yields The Desecration, so the whisper is what moved it', () => {
    // Before this unit `clarityDelusion` could not leave 0, `pickIndulgedAxis` needs `v < 0`,
    // and an all-zero vector falls through to SIN_DEFAULT_AXIS. Without this control the test
    // above would pass in a world where every Sin is called The Delusion.
    const neutral = createKarma();
    expect(pickIndulgedAxis(neutral)).toBe('reverenceDesecration');
    expect(SIN_BY_AXIS[pickIndulgedAxis(neutral)].name).toBe('The Desecration');
  });
});

// =============================================================================================
// 4. The axis is two-way now.
//
// ⚠ The FALL half starts from a hand-built karma vector, and that is a FINDING, not a
// convenience. `desecrate` is authored only in the `tempting` pool; `selectPool` opens
// `tempting` at `restraintGreed <= -3` OR `reverenceDesecration <= -3`; and the only inputs
// that can push either axis DOWN (`lootGreedily`, `desecrateShrine`) are themselves authored
// only in `tempting`. So `tempting` is unreachable from a fresh ledger — before this unit and
// after it — and it is also ABSORBING (nothing in it raises either axis, so a run that
// somehow entered could never leave). #10a does not fix that: it is a content/design call for
// #2, and it is reported rather than papered over.
// =============================================================================================

describe('the reverence axis moves in BOTH directions now', () => {
  it('a desecration deal drops it by exactly 2, through the real step', () => {
    const hub = newRunAtHub(11);
    // -3 is the smallest vector that opens `tempting` (see the block comment above).
    const seeded: GameState = {
      ...hub.state,
      karma: { ...createKarma(), reverenceDesecration: -3 },
    };
    expect(selectPool(seeded.karma)).toBe('tempting');
    const r = seekAndAccept(atStart(seeded), 'desecrate');
    // KARMA_DELTAS.desecrateShrine = { reverenceDesecration: -2 }: -3 + -2 = -5.
    expect(r.state.karma.reverenceDesecration).toBe(-5);
    expect(r.state.karma.mercyCruelty).toBe(0);
  });

  it('offerings climb a desecrated ledger back above zero, through the real step', () => {
    // -2 is exactly ONE desecration's worth, and `selectPool` still says `standard` there, so
    // the offerings that repair it are drawable. That is the redemption arc the design wants:
    // one profanity is repayable, and the 6 weighted points it costs are the price.
    const hub = hubWithItems(1, 3);
    const seeded: GameState = {
      ...hub.state,
      karma: { ...hub.state.karma, reverenceDesecration: -2 },
    };
    expect(selectPool(seeded.karma)).toBe('standard');

    let r = atStart(seeded);
    const climb: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      r = seekAndAccept(r, 'offering');
      climb.push(r.state.karma.reverenceDesecration);
    }
    // -2 -> -1 -> 0 -> +1: monotone, one point per offering, ending strictly positive.
    expect(climb).toEqual([-1, 0, 1]);
    expect(r.state.karma.reverenceDesecration).toBeGreaterThan(0);
  });
});

// =============================================================================================
// 5. Karma stays HIDDEN — GAME-DESIGN §7, "no meter, no number, ever".
//
// The line, made machine-checkable: the game may name what you DID; it may never name the AXIS
// it moved. The verb `desecrate` is allowed (it names the act); the noun `desecration` is not
// (it names the axis).
//
// This is asserted UNIVERSALLY over the deal/karma surface, with NO grandfathered exceptions.
// G53 — `describeCost`'s "your reverence (…)" / "your restraint (…)" — was fixed inside this
// unit precisely so the rule could be written this way. An exception list is how a leak
// comes back.
//
// SCOPE, deliberately bounded: the four surfaces a deal or a karma-recording step can reach —
// the engine strings, the deal screen (`dealView`), the player's combat log (`formatEvent`) and
// the model's fact line (`describeEvent`). It is NOT widened to the whole narration prompt,
// because the shipped consumable "Clarity Draught" legitimately contains `clarity` and was
// deliberately kept by §22.13; widening the scan and then weakening the word list to
// compensate would neuter the guard.
//
// FIX ROUND 1 — it covers ALL THREE karma-recording steps now. It used to cover only the two
// DEAL steps: the `spared` events were collected and discarded, so axis nouns injected into
// `formatEvent`'s and `describeEvent`'s `spared` arms left the entire 1692-test suite green.
// That was the one guard this unit was asked to leave exception-free, and it had a hole in
// exactly the event #10a newly made carry a second axis.
// =============================================================================================

const AXIS_VOCABULARY =
  /karma|nature|mercy|cruel|greed|restraint|reveren|desecration|clarity|delusion/i;

/** Every string a deal reaches a human or the model through. */
function surfacesOf(deal: SacrificeDeal): string[] {
  const view = dealView(deal);
  return [describeCost(deal.cost), describeReward(deal.reward), view.cost, view.reward];
}

/**
 * The one structural exclusion in this guard, and it is deliberately NOT a weaker word list.
 *
 * Enemy names are AUTHORED CONTENT — proper nouns from the bestiary — and some of them collide
 * with the axis vocabulary on purpose: the Seven Sins include an enemy literally called
 * **"Greed"** (§9), and the act-3 Sin is DELIBERATELY named for the indulged axis by
 * `SIN_BY_AXIS` — "The Desecration", "The Cruelty", "The Avarice", "The Delusion" — which §22.8
 * budgets portrait art for. That is the design speaking, not the ledger leaking. Exactly like
 * the "Clarity Draught" consumable §22.13 kept.
 *
 * So the name is swapped for a neutral token BEFORE the scan, and the SENTENCE TEMPLATE around
 * it is scanned in full — which is where a leak would actually be written. Nothing is skipped:
 * no event is excluded, no word is removed from the list, and the callers assert that the
 * substitution really reached the rendered string, so this cannot quietly become a no-op.
 */
const NEUTRAL_NAME = 'Foe';

function neutralizeProperNouns(e: GameEvent): GameEvent {
  return 'enemyName' in e ? { ...e, enemyName: NEUTRAL_NAME } : e;
}

/** Every string an event reaches a human or the model through, plus its raw serialization. */
function surfacesOfEvent(e: GameEvent): string[] {
  const n = neutralizeProperNouns(e);
  return [JSON.stringify(n), formatEvent(n), describeEvent(n)];
}

describe('karma stays hidden — no axis vocabulary reaches the player or the model', () => {
  const ONE_OF_EACH_COST: Record<DealCost['kind'], DealCost> = {
    hp: { kind: 'hp', amount: 8 },
    maxHp: { kind: 'maxHp', amount: 6 },
    statPoint: { kind: 'statPoint', stat: 'CHA' },
    skillCharge: { kind: 'skillCharge', amount: 1 },
    relic: { kind: 'relic' },
    offering: { kind: 'offering' },
    desecrate: { kind: 'desecrate' },
    greed: { kind: 'greed' },
    whisper: { kind: 'whisper' },
  };
  const ONE_OF_EACH_REWARD: Record<DealReward['kind'], DealReward> = {
    item: { kind: 'item', instance: { defId: 'mirror-shard' } },
    heal: { kind: 'heal', amount: 12 },
    statPoint: { kind: 'statPoint', stat: 'STR' },
    skillCharge: { kind: 'skillCharge', amount: 2 },
  };

  it('every DealCost kind — type-exhaustive, so a future kind is a compile error not a gap', () => {
    for (const [kind, cost] of Object.entries(ONE_OF_EACH_COST)) {
      expect(describeCost(cost), kind).not.toMatch(AXIS_VOCABULARY);
    }
    expect(Object.keys(ONE_OF_EACH_COST)).toHaveLength(9);
  });

  it('every DealReward kind — likewise type-exhaustive', () => {
    for (const [kind, reward] of Object.entries(ONE_OF_EACH_REWARD)) {
      expect(describeReward(reward), kind).not.toMatch(AXIS_VOCABULARY);
    }
    expect(Object.keys(ONE_OF_EACH_REWARD)).toHaveLength(4);
  });

  it('every deal the SHIPPED data can actually build, across all three pools', () => {
    // Not a fixture sweep: this runs the real `buildDeal` over the real `deals.json`, so it
    // also covers procedurally-ROLLED reward item names, which no hand-written Record can.
    const vectors: KarmaState[] = [
      createKarma(), // -> standard
      { ...createKarma(), restraintGreed: -5 }, // -> tempting
      { ...createKarma(), reverenceDesecration: 5 }, // -> grace
    ];
    const pools = new Set<string>();
    const costKinds = new Set<string>();
    let checked = 0;
    for (const karma of vectors) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const deal = buildDeal(karma, 1, mulberry32(seed));
        pools.add(deal.pool);
        costKinds.add(deal.cost.kind);
        for (const s of surfacesOf(deal)) {
          expect(s, `${deal.pool}/${deal.cost.kind}`).not.toMatch(AXIS_VOCABULARY);
          checked += 1;
        }
      }
    }
    // Non-vacuity: all three pools and all six authored cost kinds were really visited.
    expect([...pools].sort()).toEqual(['grace', 'standard', 'tempting']);
    expect([...costKinds].sort()).toEqual([
      'desecrate',
      'greed',
      'hp',
      'maxHp',
      'offering',
      'skillCharge',
      'statPoint',
      'whisper',
    ]);
    expect(checked).toBe(3 * 200 * 4);
  });

  it('the deal screen still drops the pool — a standard/tempting/grace tell IS a karma read', () => {
    const deal = buildDeal({ ...createKarma(), reverenceDesecration: 5 }, 1, mulberry32(2));
    expect(deal.pool).toBe('grace');
    expect(Object.keys(dealView(deal)).sort()).toEqual(['cost', 'reward']);
  });

  it('the four karma costs carry no DIGIT either — a magnitude is a meter by another name', () => {
    // HP / charge costs legitimately carry numbers; the karma-shifting ones must not, or the
    // player could read the ledger's arithmetic off the price tag.
    for (const kind of ['offering', 'desecrate', 'greed', 'whisper'] as const) {
      expect(describeCost({ kind }), kind).not.toMatch(/\d/);
    }
  });

  it('every EVENT the three karma-recording steps emit is clean, raw JSON included', () => {
    const emitted: GameEvent[] = [];
    // 1. an offering accepted, 2. an offering refused, 3. a whisper accepted — all via `step`.
    const hub = hubWithItems(1, 1);
    emitted.push(...seekAndAccept(hub, 'offering').events);
    emitted.push(...seekAndAccept(newRunAtHub(5), 'whisper').events);
    let r = newRunAtHub(3);
    for (let i = 0; i < 300; i += 1) {
      r = step(r.state, { kind: 'menu', choice: 'seek-deal' });
      const phase = r.state.phase;
      if (phase.kind !== 'deal') throw new Error('seek-deal did not open a deal');
      emitted.push(...r.events);
      const isOffering = phase.deal.cost.kind === 'offering';
      r = step(r.state, { kind: 'deal-decision', accept: isOffering });
      emitted.push(...r.events);
      if (isOffering) break;
    }
    // 4. THE SPARE STEPS — the honorDead half, and the one this unit newly made carry a second
    //    axis. FIX ROUND 1: these events used to be collected and then THROWN AWAY (the helper
    //    returned karma only), so `spared` was scanned by nothing at all: axis nouns injected
    //    into `formatEvent`'s and `describeEvent`'s `spared` arms left the whole suite green.
    //    Every event of every spare step now goes into the same sweep as the deal events.
    const spares = [1, 2, 3, 4, 5, 6].flatMap((s) => observeSpares(s, 'Penitent'));
    expect(spares.some((o) => o.familyId === 'theJudged')).toBe(true);
    for (const o of spares) emitted.push(...o.events);

    const kinds = new Set(emitted.map((e) => e.kind));
    expect(kinds.has('deal-offer')).toBe(true);
    expect(kinds.has('deal-taken')).toBe(true);
    expect(kinds.has('deal-unaffordable')).toBe(true);
    // Non-vacuity for the half that was missing: the `spared` event really is in the sweep now.
    expect(kinds.has('spared'), 'the spare step contributed no events').toBe(true);
    expect(emitted.length).toBeGreaterThan(6);

    for (const e of emitted) {
      for (const s of surfacesOfEvent(e)) {
        expect(s, `${e.kind}`).not.toMatch(AXIS_VOCABULARY);
      }
    }

    // The proper-noun substitution is not allowed to be a silent no-op: prove it actually
    // reached the rendered `spared` sentences, so what got scanned really was the TEMPLATE.
    const aSpare = emitted.find((e) => e.kind === 'spared')!;
    expect(formatEvent(neutralizeProperNouns(aSpare))).toContain(NEUTRAL_NAME);
    expect(describeEvent(neutralizeProperNouns(aSpare))).toContain(NEUTRAL_NAME);
    expect(JSON.stringify(neutralizeProperNouns(aSpare))).toContain(NEUTRAL_NAME);
  });

  it('a POOL NAME is a karma tell too, and no rendered surface may carry one', () => {
    // `deal-offer` carries `pool: 'standard' | 'tempting' | 'grace'` — derived straight from the
    // karma vector by `selectPool`. It is engine-internal: `dealView` drops it and neither
    // formatter prints it. But `AXIS_VOCABULARY` does not contain the pool names, so if a
    // formatter ever DID print it the guard above would not notice — `JSON.stringify(e)` already
    // contains `"pool":"grace"` and passes. Closed here, on the RENDERED surfaces only: the raw
    // event is allowed to carry the field, and the assertion below is what holds it to being
    // the only place it exists.
    const POOL_NAME = /\b(standard|tempting|grace)\b/i;
    let checked = 0;
    for (const karma of [
      createKarma(),
      { ...createKarma(), restraintGreed: -5 },
      { ...createKarma(), reverenceDesecration: 5 },
    ]) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const deal = buildDeal(karma, 1, mulberry32(seed));
        const offer: GameEvent = {
          kind: 'deal-offer',
          pool: deal.pool,
          cost: describeCost(deal.cost),
          reward: describeReward(deal.reward),
        };
        // The three surfaces a human or the model can actually see.
        expect(formatEvent(offer), `${deal.pool} player log`).not.toMatch(POOL_NAME);
        expect(describeEvent(offer), `${deal.pool} model fact`).not.toMatch(POOL_NAME);
        for (const s of surfacesOf(deal)) expect(s, deal.pool).not.toMatch(POOL_NAME);
        checked += 1;
      }
    }
    expect(checked).toBe(180);
    // …and `pool` is the ONLY karma-derived field on any event, held there by `dealView`
    // dropping it. If a second one appears, this list is where it has to be justified.
    expect(Object.keys(dealView(buildDeal(createKarma(), 1, mulberry32(1))))).toEqual([
      'cost',
      'reward',
    ]);
  });

  it('no game event carries a karma axis KEY, in any run this unit can produce', () => {
    // The `spared` event is emitted by the same step that writes the karma; if anyone ever
    // attaches the vector to it "for the UI", this is what catches it.
    const seen: GameEvent[] = [];
    let r = atStart(createGame(2));
    const policy = mercifulPolicy('Penitent');
    let steps = 0;
    while (r.awaiting !== 'game-over' && steps < 200_000) {
      r = step(r.state, policy(r));
      steps += 1;
      seen.push(...r.events);
    }
    expect(seen.some((e) => e.kind === 'spared')).toBe(true);
    const AXIS_KEYS = /mercyCruelty|restraintGreed|reverenceDesecration|clarityDelusion/;
    expect(JSON.stringify(seen)).not.toMatch(AXIS_KEYS);
  });
});

// =============================================================================================
// 6. Saves — no version bump, and that is a CHECKED claim, not an assertion.
// =============================================================================================

describe('the save format is untouched by #10a', () => {
  it('SAVE_VERSION is still 8 and a fresh game is still version 8', () => {
    expect(SAVE_VERSION).toBe(8);
    expect(createGame(1).version).toBe(8);
  });

  it('a state parked on an OFFERING deal round-trips through encode/decode deep-equal', () => {
    // The `DealCost` union GAINED members. Old saves hold only old kinds and still decode; the
    // new kinds must survive too, which they do because `save.ts` validates `phase.kind` and
    // deliberately does not recurse into a phase's payload (no cost enumeration to extend).
    const hub = hubWithItems(1, 1);
    let r = hub;
    let parked: GameState | null = null;
    for (let i = 0; i < 300 && parked === null; i += 1) {
      r = step(r.state, { kind: 'menu', choice: 'seek-deal' });
      const phase = r.state.phase;
      if (phase.kind !== 'deal') throw new Error('seek-deal did not open a deal');
      if (phase.deal.cost.kind === 'offering') parked = r.state;
      else r = step(r.state, { kind: 'deal-decision', accept: false });
    }
    expect(parked, 'never parked on an offering deal').not.toBeNull();
    const decoded = decodeSave(encodeSave(parked!));
    expect(decoded).toEqual(parked);
    expect(decoded!.phase.kind).toBe('deal');
  });

  it('the family onSpare LIST never enters saved state — it is definition data, not run state', () => {
    // §22.22 asked for no SAVE_VERSION bump if the change did not touch saved state. It does
    // not: the enemy carries `familyId` + `karmaWeighted`, never the family record.
    const battle = playUntil(2, heuristicPolicy(CLASS), (x) => x.state.phase.kind === 'battle');
    const json = encodeSave(battle.state);
    expect(json).toContain('"familyId"');
    expect(json).not.toContain('onSpare');
    expect(json).not.toContain('honorDead');
    expect(decodeSave(json)).toEqual(battle.state);
  });
});

// =============================================================================================
// 7. THE HEADLINE — full runs through the real `step`, to a terminal state.
//
// A player who spares, honours the dead and leaves offerings must finish with a net-positive
// weighted ledger and be granted grace, and the reverence axis must be demonstrably capable of
// ending ABOVE zero — which it was not, at all, before this unit.
//
// The weight table below is WRITTEN OUT BY HAND from GAME-DESIGN §7 (reverence is the heaviest
// axis) and §22.16 ("any net-positive ledger earns grace"). It is deliberately NOT imported
// from `GATE_WEIGHTS`, so the test is free to disagree with the code: an illegitimate change to
// the threshold turns this red, while a legitimate #2 re-weighting of the axes does not, and
// the exact shipped values are pinned separately in section 1.
// =============================================================================================

const DESIGN_WEIGHTS: Record<KarmaAxis, number> = {
  reverenceDesecration: 3,
  mercyCruelty: 1,
  restraintGreed: 1,
  clarityDelusion: 1,
};

/** The §7/§22.16 ledger, computed from the hand-written table. */
function designLedger(k: KarmaState): number {
  return (
    DESIGN_WEIGHTS.reverenceDesecration * k.reverenceDesecration +
    DESIGN_WEIGHTS.mercyCruelty * k.mercyCruelty +
    DESIGN_WEIGHTS.restraintGreed * k.restraintGreed +
    DESIGN_WEIGHTS.clarityDelusion * k.clarityDelusion
  );
}

/**
 * A test-local PENITENT policy: the shipped `mercifulPolicy` (so runs are exactly as strong as
 * the measured merciful baseline — the spare/skill/potion play is not re-invented here), with
 * two overrides. It seeks the altar while it still has something to give and its seek budget
 * holds, and it accepts ONLY `offering` deals — never a whisper, never a desecration. The
 * budget is what keeps a run terminating: seeking earns no XP, so an unbounded seeker never
 * advances an act.
 */
function penitentPolicy(classId: PlayerClass, maxSeeks: number): SimPolicy {
  const base = mercifulPolicy(classId);
  let seeks = 0;
  return (res) => {
    if (res.awaiting === 'main-menu') {
      const pack = res.state.player?.inventory.backpack.length ?? 0;
      if (seeks < maxSeeks && pack > 0) {
        seeks += 1;
        return { kind: 'menu', choice: 'seek-deal' };
      }
      return base(res);
    }
    if (res.awaiting === 'deal-decision') {
      const phase = res.state.phase;
      return {
        kind: 'deal-decision',
        accept: phase.kind === 'deal' && phase.deal.cost.kind === 'offering',
      };
    }
    return base(res);
  };
}

/** What one whole run tells us. */
interface RunRecord {
  seed: number;
  classId: PlayerClass;
  karma: KarmaState;
  verdict: 'grace' | 'cast-down' | null;
  dealOffers: number;
  spares: number;
  /** PLAN.md #2: illusions seen through on floor 2 — each records `seeThroughIllusion`. */
  dispels: number;
}

/** Play one run to its terminal state through the real `step`, recording what it did. */
function playRun(seed: number, classId: PlayerClass, policy: SimPolicy, guard = 200_000): RunRecord {
  let r = atStart(createGame(seed));
  let verdict: 'grace' | 'cast-down' | null = null;
  let dealOffers = 0;
  let spares = 0;
  let dispels = 0;
  let steps = 0;
  while (r.awaiting !== 'game-over' && steps < guard) {
    r = step(r.state, policy(r));
    steps += 1;
    for (const e of r.events) {
      if (e.kind === 'verdict') verdict = e.outcome;
      else if (e.kind === 'deal-offer') dealOffers += 1;
      else if (e.kind === 'spared') spares += 1;
      else if (e.kind === 'illusion-dispelled') dispels += 1;
    }
  }
  expect(steps, `run ${classId}/${seed} hit the step guard`).toBeLessThan(guard);
  return { seed, classId, karma: r.state.karma, verdict, dealOffers, spares, dispels };
}

function batch(seeds: number[], classes: PlayerClass[], policy: (c: PlayerClass) => SimPolicy) {
  const out: RunRecord[] = [];
  for (const classId of classes) for (const seed of seeds) out.push(playRun(seed, classId, policy(classId)));
  return out;
}

const SEEDS_60 = Array.from({ length: 60 }, (_, i) => i + 1);
const SEEDS_20 = Array.from({ length: 20 }, (_, i) => i + 1);

// Each batch is played ONCE and shared, so the suite pays for 320 runs rather than 800.
const PENITENT = batch(SEEDS_60, ['Penitent', 'Enforcer'], (c) => penitentPolicy(c, 60));
const HEURISTIC = batch(SEEDS_20, [...ALL_CLASSES], heuristicPolicy);
const MERCIFUL = batch(SEEDS_20, [...ALL_CLASSES], mercifulPolicy);

describe('the headline — a penitent run finishes net-positive and is granted grace', () => {
  const verdicts = PENITENT.filter((r) => r.verdict !== null);

  it('penitent runs really do reach the act-4 reckoning', () => {
    // A floor implied by the design (act 4 runs from xp 90 to 240 and a penitent forfeits kill
    // XP by sparing), NOT the count that came out — #2's difficulty retune will move the count
    // and must not turn this red. It should stay comfortably above 3.
    expect(verdicts.length).toBeGreaterThanOrEqual(3);
  });

  it('a net-positive ledger earns grace, and a non-positive one does not — both directions', () => {
    // §22.16, asserted as a BICONDITIONAL against the hand-written weights. The penitent batch
    // supplies the positive side; the shipped `heuristicPolicy` (kills everything, spares
    // nothing) supplies the negative side, so neither half of the claim is vacuous.
    for (const r of verdicts) {
      expect(designLedger(r.karma) > 0, `penitent ${r.classId}/${r.seed}`).toBe(
        r.verdict === 'grace',
      );
    }
    const cruelVerdicts = HEURISTIC.filter((r) => r.verdict !== null);
    for (const r of cruelVerdicts) {
      expect(designLedger(r.karma) > 0, `heuristic ${r.classId}/${r.seed}`).toBe(
        r.verdict === 'grace',
      );
    }
    expect(verdicts.some((r) => designLedger(r.karma) > 0)).toBe(true);
    expect(cruelVerdicts.length).toBeGreaterThanOrEqual(3);
    expect(cruelVerdicts.every((r) => designLedger(r.karma) <= 0)).toBe(true);
  });

  it('a run can now END with a POSITIVE reverence axis — the ledger nothing could produce before', () => {
    // THE point of the unit. Before it, `reverenceDesecration` had one wired input
    // (`desecrateShrine`, -2) and 400 simulated runs never moved the axis off 0 in either
    // direction. A single run ending above 0 is a ledger no input sequence could reach.
    const positive = PENITENT.filter((r) => r.karma.reverenceDesecration > 0);
    expect(positive.length).toBeGreaterThanOrEqual(1);
    // …and at least one of those is a run that went all the way to grace.
    expect(
      verdicts.some((r) => r.karma.reverenceDesecration > 0 && r.verdict === 'grace'),
    ).toBe(true);
  });

  it('the reverence axis contributed: a graced run is positive on reverence alone', () => {
    // Guards against "grace was reached, but only because mercy was already enough" being
    // mistaken for evidence that this unit did anything.
    const graced = verdicts.filter((r) => r.verdict === 'grace');
    expect(graced.length).toBeGreaterThanOrEqual(1);
    expect(
      graced.some((r) => DESIGN_WEIGHTS.reverenceDesecration * r.karma.reverenceDesecration > 0),
    ).toBe(true);
  });
});

// =============================================================================================
// 8. ISOLATION — `balance.test.ts` and `sim.ts` are byte-identical, and this unit is provably
//    invisible to the balance anchor. An ABSENCE claim, so it ships with positive controls in
//    the same describe: without them it would hold just as happily in a world where the
//    counters are broken.
// =============================================================================================

describe('the balance anchor cannot see this unit', () => {
  it('the shipped heuristic policy never opens a deal and never spares', () => {
    // `sim.ts`: `main-menu` always answers `continue` ("the shipped policies never seek a
    // deal"), and `chooseBattleAction` reaches `'spare'` only under `if (merciful && …)`. So
    // `buildDeal` is never called (deals.json unread) and `game.ts`'s `spared` branch never
    // runs (enemyFamilies.json's onSpare unread) — the two data files this unit edits.
    expect(HEURISTIC.reduce((a, r) => a + r.dealOffers, 0)).toBe(0);
    expect(HEURISTIC.reduce((a, r) => a + r.spares, 0)).toBe(0);
    expect(HEURISTIC.length).toBe(100); // the sweep really ran
  });

  it('POSITIVE CONTROL — the merciful policy DOES spare over the very same seeds', () => {
    expect(MERCIFUL.reduce((a, r) => a + r.spares, 0)).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL — the penitent policy DOES open deals', () => {
    expect(PENITENT.reduce((a, r) => a + r.dealOffers, 0)).toBeGreaterThan(0);
  });

  it('under the heuristic policy reverence and restraint never move; clarity moves ONLY by dispels', () => {
    // The sharpest statement of #10a's inertness: reverence and restraint stay exactly 0 across
    // every heuristic run. `mercyCruelty` moves (kills) and always did.
    //
    // PLAN.md #2 changed the clarity half ON PURPOSE: floor 2's illusions are met by EVERY
    // policy, and seeing through one records `seeThroughIllusion` (+1 clarity, x1 on floor 2).
    // So clarity is no longer 0 — it is EXACTLY the number of dispels the run saw, which pins
    // it to that one cause rather than letting any other path move it.
    for (const r of HEURISTIC) {
      expect(r.karma.reverenceDesecration, `${r.classId}/${r.seed}`).toBe(0);
      expect(r.karma.restraintGreed, `${r.classId}/${r.seed}`).toBe(0);
      expect(r.karma.clarityDelusion, `${r.classId}/${r.seed}`).toBe(r.dispels);
    }
    // Non-vacuity: the sweep really met and saw through illusions.
    expect(HEURISTIC.reduce((a, r) => a + r.dispels, 0)).toBeGreaterThan(0);
  });
});

// A type-level anchor: `KarmaAxis` really is the four keys of `KarmaState`, so the weight table
// above is exhaustive rather than merely four entries that happen to match.
const AXES: readonly KarmaAxis[] = [
  'mercyCruelty',
  'restraintGreed',
  'reverenceDesecration',
  'clarityDelusion',
];

describe('the four axes', () => {
  it('are exactly the keys the gate weights are defined over', () => {
    expect([...AXES].sort()).toEqual(Object.keys(GATE_WEIGHTS).sort());
    expect([...AXES].sort()).toEqual(Object.keys(createKarma()).sort());
  });
});
