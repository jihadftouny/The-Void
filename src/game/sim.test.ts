import { describe, expect, it } from 'vitest';
import {
  heuristicPolicy,
  mercifulPolicy,
  runToTerminal,
  simulateRun,
  simulateBatch,
  ALL_CLASSES,
  gearUpAtHub,
  discardChoice,
  tallyStep,
  emptyPerFloor,
  wisBucket,
  type SimPolicy,
} from './sim.ts';
import { type GameEvent } from './gameEvent.ts';
import { type PlayerClass } from './player.ts';
import { type SacrificeDeal } from './deal.ts';
import { BACKPACK_CAPACITY } from './inventory.ts';
import { type ItemInstance } from './item.ts';
import { createBattle } from './battle.ts';
import {
  createGame,
  step,
  awaitingFor,
  type GameState,
  type GameInput,
  type StepResult,
  type Awaiting,
} from './game.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy } from './enemy.ts';
import { FINAL_BOSS_NAME, FINAL_BOSS_XP } from './progression.ts';
import { mulberry32 } from './rng.ts';
import { createKarma, type KarmaState } from './karma.ts';
import { type Stats } from './character.ts';
import { type BattleState } from './battle.ts';

// ------- Fixtures ------------------------------------------------------------

function baseStats(): Stats {
  return { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: baseStats() }),
    ...overrides,
  };
}

function karmaOf(partial: Partial<KarmaState>): KarmaState {
  return { ...createKarma(), ...partial };
}

// ------- Outcome-classification anchors --------------------------------------
// Each expected outcome is derived by hand from the controller contract / verdict math —
// NOT read off the harness's own output.

describe('runToTerminal classifies outcomes in player terms', () => {
  it('grace: an act-4 menu with xp>=240 and reverence-led karma ascends (act 4, no death)', () => {
    // Independent oracle: shouldAdvance(4, 240) opens the act-5 gate; act===4 routes to the
    // verdict; computeVerdict({reverence:+2}) = weighted sum 3×2 = 6 >= 1 ⇒ grace ⇒ the grace
    // ending is terminal at act 4 (act 5 is never constructed).
    const state: GameState = {
      version: 9,
      rngState: 5,
      player: makePlayer({ name: 'Grace', xp: 240 }),
      act: 4,
      place: 3,
      karma: karmaOf({ reverenceDesecration: 2 }),
      phase: { kind: 'main-menu' },
    };
    const r = runToTerminal(state, heuristicPolicy('Enforcer'));
    expect(r.outcome).toBe('grace');
    expect(r.finalAct).toBe(4);
    expect(r.diedAtAct).toBeNull();
    expect(r.cause).toBe('ascended (grace)');
  });

  it('damnation: felling the final boss reaches the damnation ending at act 5', () => {
    // FIXTURE (mirrors game.test.ts): a trivially-killable Hollow (1 HP, AC 1, no skills) vs an
    // unkillable player. The real player-won → battle-victory{final} → damnation-ending chain
    // fires; damnation is known independently from the controller, not from the harness.
    const player = makePlayer({ name: 'Doom', hp: 9999, maxHp: 9999, advantageDisadvantage: 1 });
    const enemy = {
      ...generateEnemy({ act: 5, type: FINAL_BOSS_NAME, playerXp: FINAL_BOSS_XP }, mulberry32(1)),
      hp: 1,
      maxHp: 1,
      armorClass: 1,
      skillPool: [] as string[],
      skillCharges: 0,
      karmaWeighted: false,
    };
    const battle: BattleState = { player, enemy, act: 5, canFlee: false };
    const state: GameState = {
      version: 9,
      rngState: 7,
      player,
      act: 5,
      place: 4,
      karma: createKarma(),
      phase: { kind: 'battle', battle, started: true, final: true },
    };
    const r = runToTerminal(state, heuristicPolicy('Enforcer'));
    expect(r.outcome).toBe('damnation');
    expect(r.finalAct).toBe(5);
    expect(r.diedAtAct).toBeNull();
    expect(r.cause).toBe('unmade the Hollow (damnation)');
  });

  it('death: a 1-HP player facing a lethal foe dies, tagged with the act it died in', () => {
    // FIXTURE: a 1-HP, heal-less, skill-less, cannot-flee player. Any enemy hit (plain 1 on a
    // non-fumble roll vs the AC-1 player) kills. The policy has no heal/skill/flee available, so
    // it swings and dies — independently, the death is tagged with the state's act (3).
    // (PLAN.md #2: "potionless" became an EMPTY PACK — a fresh character now carries a kit.)
    const frail = makePlayer({ name: 'Frail', hp: 1, maxHp: 1, skillPool: [], armorClass: 1 });
    const player = { ...frail, inventory: { ...frail.inventory, backpack: [] } };
    const enemy = {
      ...generateEnemy({ act: 3, type: 'Grunt', playerXp: 40 }, mulberry32(2)),
      skillPool: [] as string[],
      skillCharges: 0,
      karmaWeighted: false,
    };
    const battle: BattleState = { player, enemy, act: 3, canFlee: false };
    const state: GameState = {
      version: 9,
      rngState: 11,
      player,
      act: 3,
      place: 2,
      karma: createKarma(),
      phase: { kind: 'battle', battle, started: true, final: false },
    };
    const r = runToTerminal(state, heuristicPolicy('Enforcer'));
    expect(r.outcome).toBe('death');
    expect(r.finalAct).toBe(3);
    expect(r.diedAtAct).toBe(3);
  });
});

// ------- Valid-action + termination ------------------------------------------

/**
 * The Awaiting → allowed GameInput.kind table, derived independently from the controller's
 * contract (game.ts `step`), NOT from the policy. A policy that ever answered a phase with a
 * kind outside its set would dispatch an illegal (rejected) input.
 */
const ALLOWED: Record<Awaiting, ReadonlySet<GameInput['kind']>> = {
  title: new Set(['continue']),
  'enter-name': new Set(['name']),
  'choose-class': new Set(['class']),
  'accept-or-reroll-stats': new Set(['stats-decision']),
  // PLAN.md #2: a hub discard is an engine input too (the policy sheds gear from a full pack).
  'main-menu': new Set(['menu', 'discard']),
  continue: new Set(['continue']),
  'battle-action': new Set(['battle-action']),
  'draft-pick': new Set(['draft-pick']),
  'deal-decision': new Set(['deal-decision']),
  // PLAN.md #2, Appendix A.3: make room with a discard, or back out (which is refusing).
  'deal-discard': new Set(['discard', 'deal-decision']),
  rest: new Set(['continue']), // PLAN.md #2: a found rest is taken at once; only continue remains
  'game-over': new Set(['continue']),
};

const GUARD = 200_000;

/**
 * Drive a full real run manually, asserting at EVERY phase that (a) the policy's chosen input
 * kind is legal for the awaited phase and (b) the step actually consumed the input (the returned
 * state is a NEW object — an unconsumed illegal input returns the same state reference).
 */
function driveAndCheck(seed: number, policy: SimPolicy): number {
  let state = createGame(seed);
  let awaiting = awaitingFor(state.phase);
  let steps = 0;
  while (awaiting !== 'game-over' && steps < GUARD) {
    // The sim's hub gear-up (outside `step`), exactly as `runToTerminal` applies it.
    if (awaiting === 'main-menu') state = gearUpAtHub(state);
    const res0: StepResult = { state, events: [], awaiting };
    const input = policy(res0);
    expect(ALLOWED[awaiting].has(input.kind)).toBe(true);
    const next = step(state, input);
    // The input was consumed (a no-op on an input-expecting phase returns the same reference).
    expect(next.state).not.toBe(state);
    state = next.state;
    awaiting = next.awaiting;
    steps++;
  }
  return steps;
}

describe('policy is legal for every reachable phase and runs terminate', () => {
  it('every dispatched action is legal and no run no-ops in place (both policies)', () => {
    for (const classId of ALL_CLASSES) {
      for (let seed = 1; seed <= 8; seed++) {
        const base = driveAndCheck(seed, heuristicPolicy(classId));
        expect(base).toBeLessThan(GUARD);
        const merc = driveAndCheck(seed, mercifulPolicy(classId));
        expect(merc).toBeLessThan(GUARD);
      }
    }
  });

  it('a batch of seeds × all classes always terminates well under the step guard', () => {
    for (const classId of ALL_CLASSES) {
      for (let seed = 1; seed <= 25; seed++) {
        const r = simulateRun(seed, { classId });
        expect(r.steps).toBeLessThan(GUARD);
        expect(['grace', 'damnation', 'death']).toContain(r.outcome);
      }
    }
  });
});

// ------- Determinism ---------------------------------------------------------

describe('determinism (bit-for-bit)', () => {
  it('simulateRun twice deep-equals itself for the same seed + class', () => {
    for (const classId of ALL_CLASSES) {
      const a = simulateRun(3, { classId });
      const b = simulateRun(3, { classId });
      expect(b).toEqual(a);
    }
  });

  it('a JSON round-tripped mid-run state steps identically (reproducible from seed alone)', () => {
    // Advance a real run part-way, then step the live state and a JSON clone with the SAME input
    // and assert byte-identical results — the state carries everything needed to continue.
    const policy = heuristicPolicy('Neuromancer');
    let state = createGame(9);
    let awaiting = awaitingFor(state.phase);
    for (let i = 0; i < 40 && awaiting !== 'game-over'; i++) {
      const input = policy({ state, events: [], awaiting });
      const r = step(state, input);
      state = r.state;
      awaiting = r.awaiting;
    }
    if (awaiting !== 'game-over') {
      const input = policy({ state, events: [], awaiting });
      const live = step(state, input);
      const clone = step(JSON.parse(JSON.stringify(state)) as GameState, input);
      expect(JSON.stringify(clone)).toBe(JSON.stringify(live));
    }
  });
});

// ------- Aggregate reproducibility + conservation ----------------------------

describe('simulateBatch aggregates deterministically and conserves outcomes', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('is deep-equal across two identical calls (baseline policy)', () => {
    const a = simulateBatch({ seeds, classes: [...ALL_CLASSES] });
    const b = simulateBatch({ seeds, classes: [...ALL_CLASSES] });
    expect(b).toEqual(a);
  });

  it('outcomes conserve: grace + damnation + deaths === runs, per class and overall', () => {
    const report = simulateBatch({ seeds, classes: [...ALL_CLASSES] });
    // Overall: every run landed in exactly one outcome bucket.
    expect(report.grace + report.damnation + report.deaths).toBe(report.runs);
    expect(report.wins).toBe(report.grace + report.damnation);
    expect(report.runs).toBe(seeds.length * ALL_CLASSES.length);

    for (const classId of ALL_CLASSES) {
      const cs = report.perClass[classId];
      expect(cs.runs).toBe(seeds.length);
      expect(cs.grace + cs.damnation + cs.deaths).toBe(cs.runs);
      // The death histogram accounts for every death, no more, no less.
      const histSum = Object.values(cs.deathByAct).reduce((s, n) => s + n, 0);
      expect(histSum).toBe(cs.deaths);
    }
    // The overall histogram sums to the overall death count too.
    const overallHist = Object.values(report.deathByAct).reduce((s, n) => s + n, 0);
    expect(overallHist).toBe(report.deaths);
  });

  it('the merciful policy also aggregates deterministically and conserves', () => {
    const a = simulateBatch({ seeds, classes: [...ALL_CLASSES], policy: mercifulPolicy });
    const b = simulateBatch({ seeds, classes: [...ALL_CLASSES], policy: mercifulPolicy });
    expect(b).toEqual(a);
    expect(a.grace + a.damnation + a.deaths).toBe(a.runs);
  });
});

// ------- #2 S1: the sim uses what it finds (G48, G11) -----------------------------------------

/** A rolled item built by hand in the `rarityGen` shape (so no draw is spent building it). */
function rolled(slot: 'helmet' | 'mainHand' | 'ring', rarity: 'Common' | 'Rare' | 'Legendary'): ItemInstance {
  return {
    defId: `gen:${rarity}:${slot}`,
    rolled: {
      name: `${rarity} ${slot}`,
      rarity,
      slot,
      kind: slot === 'mainHand' ? 'weapon' : slot === 'helmet' ? 'armor' : 'trinket',
      effects: [{ type: 'bonusArmorClass', params: { amount: 1 } }],
    },
  };
}

function hubWith(backpack: ItemInstance[]): GameState {
  const p = makePlayer();
  return {
    version: 9,
    rngState: 1,
    player: { ...p, inventory: { ...p.inventory, backpack } },
    act: 1,
    place: 0,
    karma: createKarma(),
    phase: { kind: 'main-menu' },
  };
}

describe('gearUpAtHub — the rarity rule, derived from the plan (AC-26)', () => {
  it('fills an EMPTY slot with anything, Common included', () => {
    const out = gearUpAtHub(hubWith([rolled('helmet', 'Common')]));
    expect(out.player!.inventory.slots.helmet?.defId).toBe('gen:Common:helmet');
    expect(out.player!.inventory.backpack).toEqual([]);
  });

  it('never displaces equal-or-better gear: a Common or Rare mainHand leaves the Rare sword on', () => {
    // The Enforcer starts with 'Jaaj Sword 1', an Act-1 RARE (classKit.ts). Common < Rare and
    // Rare == Rare, so neither is "strictly better" — and a Common generated weapon is the
    // known downgrade (GAME-DESIGN §22.20) this rule exists to avoid.
    const out = gearUpAtHub(hubWith([rolled('mainHand', 'Common'), rolled('mainHand', 'Rare')]));
    expect(out.player!.inventory.slots.mainHand?.defId).toBe('Jaaj Sword 1');
    expect(out.player!.inventory.backpack).toHaveLength(2);
    // An EQUAL rarity changes nothing at all — not even a swap-and-swap-back. (A `>=` rule
    // would swap the two Rares back and forth until the loop guard stopped it; an even number
    // of swaps lands on the sword again, so only object identity can see it.)
    const equal = hubWith([rolled('mainHand', 'Rare')]);
    expect(gearUpAtHub(equal)).toBe(equal);
  });

  it('a strictly higher rarity displaces, and the displaced piece returns to the pack', () => {
    const out = gearUpAtHub(hubWith([rolled('mainHand', 'Legendary')]));
    expect(out.player!.inventory.slots.mainHand?.defId).toBe('gen:Legendary:mainHand');
    expect(out.player!.inventory.backpack.map((i) => i.defId)).toEqual(['Jaaj Sword 1']);
  });

  it('is a no-op (same object) off the hub, and when there is nothing to equip', () => {
    const hub = hubWith([]);
    expect(gearUpAtHub(hub)).toBe(hub);
    const battle: GameState = { ...hubWith([rolled('helmet', 'Rare')]), phase: { kind: 'title' } };
    expect(gearUpAtHub(battle)).toBe(battle);
  });

  it('fires in real runs: some hub visit over seeds 1..10 equips found gear', () => {
    // Non-vacuity (G48): the rule is exercised by the batch, not only by the fixtures above.
    let fired = 0;
    for (let seed = 1; seed <= 10; seed++) {
      let state = createGame(seed);
      let awaiting = awaitingFor(state.phase);
      const policy = heuristicPolicy('Enforcer');
      for (let i = 0; i < 2000 && awaiting !== 'game-over'; i++) {
        if (awaiting === 'main-menu') {
          const geared = gearUpAtHub(state);
          if (geared !== state) fired++;
          state = geared;
        }
        const r = step(state, policy({ state, events: [], awaiting }));
        state = r.state;
        awaiting = r.awaiting;
      }
    }
    expect(fired).toBeGreaterThan(0);
  });
});

describe('the heuristic heals with a found consumable (there are no potions, §22.6)', () => {
  function battleAt(hp: number, _unused: number, backpack: ItemInstance[]): StepResult {
    const p = makePlayer({ hp, maxHp: 20 });
    const player = { ...p, inventory: { ...p.inventory, backpack } };
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(3));
    const battle = createBattle(player, enemy, 1);
    const state: GameState = { ...hubWith([]), player, phase: { kind: 'battle', battle, started: true, final: false } };
    return { state, events: [], awaiting: 'battle-action' };
  }

  it('at <= 35% HP, uses the FIRST healSelf item (index derived by hand)', () => {
    // 7/20 = 35% exactly. Index 0 is an Antidote (cure only), index 1 a Suture Kit (healSelf 4).
    const res = battleAt(7, 0, [{ defId: 'antidote' }, { defId: 'suture-kit' }]);
    expect(heuristicPolicy('Enforcer')(res)).toEqual({
      kind: 'battle-action',
      action: { kind: 'useConsumable', source: { index: 1 } },
    });
  });

  it('does not, above 35% HP, or with no healing item', () => {
    expect(heuristicPolicy('Enforcer')(battleAt(8, 0, [{ defId: 'suture-kit' }]))).not.toMatchObject({
      action: { kind: 'useConsumable' },
    });
    expect(heuristicPolicy('Enforcer')(battleAt(3, 0, [{ defId: 'antidote' }]))).not.toMatchObject({
      action: { kind: 'useConsumable' },
    });
  });
});


// ------- #2 step 12: the per-floor counters (AC-27's inputs) -----------------------------------
//
// `tallyStep` is proved on hand-built step pairs whose every expected count is read off the
// pair itself; then the counters of REAL runs are held to the run record's own fields, which
// `runToTerminal` computes by a separate path (act-outro count, outcome, final act).

function sr(state: GameState, events: GameEvent[] = [], awaiting?: Awaiting): StepResult {
  return { state, events, awaiting: awaiting ?? awaitingFor(state.phase) };
}

function hubOn(place: number, backpack: ItemInstance[] = []): GameState {
  return { ...hubWith(backpack), act: place + 1, place };
}

function fightOn(place: number, hp: number, illusory: boolean): GameState {
  const p = makePlayer({ hp, maxHp: 30 });
  const base = generateEnemy({ act: place + 1, type: 'Beast', playerXp: 0 }, mulberry32(3));
  const enemy = illusory ? { ...base, illusory: true as const } : base;
  const battle = createBattle(p, enemy, place + 1);
  return { ...hubOn(place), player: p, phase: { kind: 'battle', battle, started: true, final: false } };
}

describe('tallyStep — one step folded into the counters (expected counts read off the pair)', () => {
  it('a found rest on floor 3 is one step, one encounter, one rest — on floor 3 only', () => {
    const before = emptyPerFloor();
    const pre = sr(hubOn(2));
    const post = sr({ ...hubOn(2), phase: { kind: 'rest' } }, [
      { kind: 'rest-found', floor: 3, place: 'x', briefId: 'floor-3', woundsClosed: true, conditionsEased: false },
      { kind: 'rest-taken', hpRestored: 4, hp: 20, maxHp: 20 },
    ]);
    const after = tallyStep(before, pre, post);
    expect(after[3]).toMatchObject({ reached: 1, steps: 1, encounters: 1, rests: 1, rounds: 0, cleared: 0 });
    for (const f of [1, 2, 4, 5] as const) expect(after[f]).toEqual(before[f]);
    expect(before[3].steps).toBe(0); // PURE: the input record is untouched
  });

  it('a bargain offered and struck, and two items left behind, count as such', () => {
    const offer = tallyStep(emptyPerFloor(), sr(hubOn(0)), sr(hubOn(0), [{ kind: 'deal-offer', pool: 'standard', cost: 'c', reward: 'r' }]));
    expect(offer[1]).toMatchObject({ encounters: 1, bargainsOffered: 1, bargainsTaken: 0 });
    const taken = tallyStep(offer, sr(hubOn(0)), sr(hubOn(0), [{ kind: 'deal-taken', cost: 'c', reward: 'r' }]));
    expect(taken[1]).toMatchObject({ encounters: 1, bargainsOffered: 1, bargainsTaken: 1, steps: 2 });
    const left = tallyStep(emptyPerFloor(), sr(hubOn(0)), sr(hubOn(0), [
      { kind: 'chest-found' },
      { kind: 'loot-left-behind', name: 'a', rarity: 'Common' },
      { kind: 'loot-left-behind', name: 'b', rarity: 'Rare' },
    ]));
    expect(left[1]).toMatchObject({ encounters: 1, lootLeftBehind: 2 });
  });

  it('a round inside an illusion on floor 2: one round, one illusion round, the HP it cost', () => {
    const pre = sr(fightOn(1, 20, true));
    const post = sr(fightOn(1, 14, true), [{ kind: 'illusion-struck' }]);
    expect(tallyStep(emptyPerFloor(), pre, post)[2]).toMatchObject({ rounds: 1, illusionRounds: 1, illusionHpLost: 6 });
  });

  it('HP lost is NET per round: a round that healed costs 0, and a real fight costs nothing', () => {
    const healed = tallyStep(emptyPerFloor(), sr(fightOn(1, 5, true)), sr(fightOn(1, 9, true)));
    expect(healed[2]).toMatchObject({ rounds: 1, illusionRounds: 1, illusionHpLost: 0 });
    const real = tallyStep(emptyPerFloor(), sr(fightOn(1, 20, false)), sr(fightOn(1, 12, false)));
    expect(real[2]).toMatchObject({ rounds: 1, illusionRounds: 0, illusionHpLost: 0 });
  });

  it('dying inside an illusion: died, diedInIllusion, and the whole remaining HP lost', () => {
    const pre = sr(fightOn(1, 4, true));
    const deadPlayer = makePlayer({ hp: -3, maxHp: 30 });
    const post = sr({ ...hubOn(1), player: deadPlayer, phase: { kind: 'game-over' } }, [
      { kind: 'defeat' },
      { kind: 'game-over', xp: 0 },
    ]);
    expect(tallyStep(emptyPerFloor(), pre, post)[2]).toMatchObject({ died: 1, diedInIllusion: 1, illusionHpLost: 4 });
    // ...and dying in a REAL fight is a death, not an illusion death.
    const real = tallyStep(emptyPerFloor(), sr(fightOn(1, 4, false)), post);
    expect(real[2]).toMatchObject({ died: 1, diedInIllusion: 0, illusionHpLost: 0 });
  });

  it('an illusion is MET when an encounter opens against one; a real battle is not', () => {
    const met = tallyStep(emptyPerFloor(), sr(hubOn(1)), sr(fightOn(1, 20, true), [{ kind: 'encounter-start', enemyName: 'x' }]));
    expect(met[2]).toMatchObject({ encounters: 1, illusionsMet: 1 });
    const real = tallyStep(emptyPerFloor(), sr(hubOn(1)), sr(fightOn(1, 20, false), [{ kind: 'encounter-start', enemyName: 'x' }]));
    expect(real[2]).toMatchObject({ encounters: 1, illusionsMet: 0 });
  });

  it('a dispel counts; an act-outro clears THE FLOOR IT CONCLUDES, not the next', () => {
    const d = tallyStep(emptyPerFloor(), sr(fightOn(1, 20, true)), sr(hubOn(1), [{ kind: 'illusion-dispelled', natural: 15, modifier: 0, total: 15, dc: 13 }]));
    expect(d[2]).toMatchObject({ illusionsDispelled: 1, illusionRounds: 1 });
    const outro = tallyStep(emptyPerFloor(), sr(hubOn(0)), sr(hubOn(1), [{ kind: 'act-outro', act: 1, header: '', body: '' }]));
    expect(outro[1].cleared).toBe(1);
    expect(outro[2]).toEqual(emptyPerFloor()[2]);
  });

  it('only a HEALING consumable counts as a heal used', () => {
    const heal = tallyStep(emptyPerFloor(), sr(fightOn(0, 5, false)), sr(fightOn(0, 9, false), [{ kind: 'consumable-used', itemId: 'suture-kit' }]));
    expect(heal[1].healsUsed).toBe(1);
    const cure = tallyStep(emptyPerFloor(), sr(fightOn(0, 5, false)), sr(fightOn(0, 5, false), [{ kind: 'consumable-used', itemId: 'antidote' }]));
    expect(cure[1].healsUsed).toBe(0);
  });

  it('character creation is on no floor: the record comes back unchanged', () => {
    const before = emptyPerFloor();
    const title = createGame(1);
    expect(tallyStep(before, sr(title), sr(title))).toBe(before);
  });
});

describe('the counters of REAL runs agree with the run record (a separate path)', () => {
  it('reached is a prefix up to the final floor; cleared, died and the WIS bucket all line up', () => {
    for (const classId of ALL_CLASSES) {
      for (let seed = 1; seed <= 12; seed++) {
        const r = simulateRun(seed, { classId });
        const floors = [1, 2, 3, 4, 5] as const;
        // Every floor up to the one the run ended on was reached; none after it.
        for (const f of floors) expect(r.perFloor[f].reached, `${classId}/${seed} floor ${f}`).toBe(f <= r.finalAct ? 1 : 0);
        // cleared = the act-outros (floorsCleared) plus the floor a WIN ended on.
        const cleared = floors.reduce((s, f) => s + r.perFloor[f].cleared, 0);
        expect(cleared).toBe(r.floorsCleared + (r.outcome === 'death' ? 0 : 1));
        // died: exactly the death floor, and only for a death.
        const died = floors.filter((f) => r.perFloor[f].died > 0);
        expect(died).toEqual(r.outcome === 'death' ? [r.diedAtAct] : []);
        // Steps on floors never exceed the run's steps (creation steps are on no floor).
        const floorSteps = floors.reduce((s, f) => s + r.perFloor[f].steps, 0);
        expect(floorSteps).toBeLessThanOrEqual(r.steps);
        expect(r.steps - floorSteps).toBe(4); // title, name, class, stats: four creation steps
        expect(r.startingWis).not.toBeNull();
      }
    }
  });

  it('the batch sums the runs field by field, and the WIS buckets partition the runs', () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const report = simulateBatch({ seeds, classes: [...ALL_CLASSES] });
    const runs = ALL_CLASSES.flatMap((c) => seeds.map((s) => simulateRun(s, { classId: c })));
    for (const f of [1, 2, 3, 4, 5] as const) {
      expect(report.perFloor[f].rests).toBe(runs.reduce((s, r) => s + r.perFloor[f].rests, 0));
      expect(report.perFloor[f].rounds).toBe(runs.reduce((s, r) => s + r.perFloor[f].rounds, 0));
      expect(report.perFloor[f].reached).toBe(runs.filter((r) => r.finalAct >= f).length);
    }
    const b = report.perWisBucket;
    expect(b.low.runs + b.mid.runs + b.high.runs).toBe(report.runs);
    // Each bucket, rebuilt from the runs by their rolled Wisdom and their DEATH ACT — the run
    // record's own field, not the counters.
    for (const bucket of ['low', 'mid', 'high'] as const) {
      const inB = runs.filter((r) => wisBucket(r.startingWis!) === bucket);
      const deaths = inB.filter((r) => r.outcome === 'death');
      const floor2 = deaths.filter((r) => r.diedAtAct === 2).length;
      expect(b[bucket], bucket).toEqual({
        runs: inB.length,
        wins: inB.length - deaths.length,
        deaths: deaths.length,
        floor2Deaths: floor2,
        winRate: inB.length > 0 ? (inB.length - deaths.length) / inB.length : 0,
        floor2DeathShare: deaths.length > 0 ? floor2 / deaths.length : 0,
      });
    }
    // Non-vacuity: the sample holds floor-2 deaths AND deaths elsewhere, so a bucket that read
    // the wrong floor would disagree somewhere.
    const all = runs.filter((r) => r.outcome === 'death');
    expect(all.some((r) => r.diedAtAct === 2)).toBe(true);
    expect(all.some((r) => r.diedAtAct !== 2)).toBe(true);
  });

  it('startingWis is the score at the FIRST hub — not a later one a hub-time move changed', () => {
    // A prep that raises Wisdom by one at every hub visit: the first hub still reads the rolled 7.
    const p = makePlayer();
    const start: GameState = { ...hubWith([]), player: { ...p, stats: { ...p.stats, WIS: 7 } } };
    const wiser = (s: GameState): GameState =>
      s.player ? { ...s, player: { ...s.player, stats: { ...s.player.stats, WIS: s.player.stats.WIS + 1 } } } : s;
    const r = runToTerminal(start, heuristicPolicy('Enforcer'), GUARD, wiser);
    expect(r.startingWis).toBe(7);
  });

  it('wisBucket: <= 9 low, 10..13 mid, >= 14 high (AC-27)', () => {
    expect([3, 9, 10, 13, 14, 18].map(wisBucket)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high']);
  });
});

// ------- #2 step 12: every policy branch (AC-26), then proved to fire in real runs (G48) -------

function dealAt(cost: SacrificeDeal['cost'], backpack: ItemInstance[] = []): StepResult {
  const deal: SacrificeDeal = { pool: 'standard', cost, reward: { kind: 'skillCharge', amount: 2 } };
  return sr({ ...hubWith(backpack), phase: { kind: 'deal', deal } });
}

/** A pack of `n` usables (Void Draughts) — nothing a careful player would throw away. */
function usables(n: number): ItemInstance[] {
  return Array.from({ length: n }, () => ({ defId: 'void-draught' }));
}

describe('the policy, branch by branch (expected inputs derived from AC-26)', () => {
  const policy = heuristicPolicy('Enforcer');

  it('discardChoice: the lowest-rarity loose GEAR, first on ties; never a usable; -1 with no gear', () => {
    expect(discardChoice([rolled('ring', 'Rare'), { defId: 'suture-kit' }, rolled('helmet', 'Common'), rolled('mainHand', 'Common')])).toBe(2);
    expect(discardChoice([rolled('ring', 'Legendary'), rolled('helmet', 'Rare')])).toBe(1);
    expect(discardChoice(usables(5))).toBe(-1);
    expect(discardChoice([])).toBe(-1);
  });

  it('bargains: accepts any cost but the body (hp, maxHp), which it refuses', () => {
    for (const cost of [{ kind: 'skillCharge', amount: 1 }, { kind: 'offering' }, { kind: 'whisper' }, { kind: 'statPoint', stat: 'CHA' }] as const) {
      expect(policy(dealAt(cost))).toEqual({ kind: 'deal-decision', accept: true });
    }
    expect(policy(dealAt({ kind: 'hp', amount: 6 }))).toEqual({ kind: 'deal-decision', accept: false });
    expect(policy(dealAt({ kind: 'maxHp', amount: 6 }))).toEqual({ kind: 'deal-decision', accept: false });
  });

  it('a full pack at the hub sheds its worst gear; a pack with room just goes on', () => {
    const full = [...usables(BACKPACK_CAPACITY - 2), rolled('ring', 'Rare'), rolled('helmet', 'Common')];
    expect(policy(sr(hubWith(full)))).toEqual({ kind: 'discard', index: BACKPACK_CAPACITY - 1 });
    expect(policy(sr(hubWith(full.slice(1))))).toEqual({ kind: 'menu', choice: 'continue' });
    // Full of usables only: nothing to shed, so it goes on (and a chest will leave loot behind).
    expect(policy(sr(hubWith(usables(BACKPACK_CAPACITY))))).toEqual({ kind: 'menu', choice: 'continue' });
  });

  it('A.3: a bargain that needs room gets the worst gear; with only usables it backs out', () => {
    const deal: SacrificeDeal = { pool: 'standard', cost: { kind: 'offering' }, reward: { kind: 'skillCharge', amount: 2 } };
    const withGear = [...usables(BACKPACK_CAPACITY - 1), rolled('helmet', 'Common')];
    expect(policy(sr({ ...hubWith(withGear), phase: { kind: 'deal-discard', deal } }))).toEqual({ kind: 'discard', index: BACKPACK_CAPACITY - 1 });
    expect(policy(sr({ ...hubWith(usables(BACKPACK_CAPACITY)), phase: { kind: 'deal-discard', deal } }))).toEqual({ kind: 'deal-decision', accept: false });
  });

  it('a found rest has only one answer: continue', () => {
    expect(policy(sr({ ...hubWith([]), phase: { kind: 'rest' } }))).toEqual({ kind: 'continue' });
  });
});

/** Play one real run the way `runToTerminal` does, recording what each policy branch did. */
function playRecording(seed: number, classId: PlayerClass) {
  const policy = heuristicPolicy(classId);
  let res: StepResult = sr(createGame(seed));
  const kinds = new Set<string>();
  const branch = { hubDiscard: 0, dealDiscard: 0, backOut: 0, bodyRefused: 0, heal: 0 };
  for (let n = 0; res.awaiting !== 'game-over' && n < GUARD; n++) {
    if (res.awaiting === 'main-menu') res = { ...res, state: gearUpAtHub(res.state) };
    const input = policy(res);
    const phase = res.state.phase;
    if (res.awaiting === 'main-menu' && input.kind === 'discard') branch.hubDiscard++;
    if (res.awaiting === 'deal-discard' && input.kind === 'discard') branch.dealDiscard++;
    if (res.awaiting === 'deal-discard' && input.kind === 'deal-decision') branch.backOut++;
    if (phase.kind === 'deal' && input.kind === 'deal-decision' && !input.accept) branch.bodyRefused++;
    if (input.kind === 'battle-action' && typeof input.action === 'object' && input.action.kind === 'useConsumable') branch.heal++;
    res = step(res.state, input);
    for (const e of res.events) kinds.add(e.kind);
  }
  return { kinds, branch };
}

describe('G48 non-vacuity — every policy branch FIRES in real runs (fixed seeds 1..30 x all classes)', () => {
  // 150 runs: a full pack (loot left behind, a bargain that needs room) is a late-descent
  // event, so the set must hold enough runs that live that long.
  const kinds = new Set<string>();
  const branch = { hubDiscard: 0, dealDiscard: 0, backOut: 0, bodyRefused: 0, heal: 0 };
  for (const classId of ALL_CLASSES) {
    for (let seed = 1; seed <= 30; seed++) {
      const r = playRecording(seed, classId);
      r.kinds.forEach((k) => kinds.add(k));
      for (const k of Object.keys(branch) as (keyof typeof branch)[]) branch[k] += r.branch[k];
    }
  }

  it('the six events AC-26 names each occur', () => {
    for (const k of ['deal-taken', 'consumable-used', 'loot-left-behind', 'rest-taken', 'illusion-dispelled', 'skills-warped']) {
      expect(kinds.has(k), `no run emitted '${k}'`).toBe(true);
    }
  });

  it('the heal, body-refusal, hub-discard and A.3 back-out branches each fire', () => {
    expect(branch.heal).toBeGreaterThan(0);
    expect(branch.bodyRefused).toBeGreaterThan(0);
    expect(branch.hubDiscard).toBeGreaterThan(0);
    // A.3 in real runs: a bargain met a full pack, and the policy answered the discard step.
    expect(kinds.has('deal-needs-room')).toBe(true);
    expect(branch.backOut).toBeGreaterThan(0);
  });

  it('the A.3 DISCARD branch cannot fire under this policy — and why (its unit test pins it)', () => {
    // Bargains are drawn from the hub, and the hub sheds gear whenever the pack is full. So a
    // pack that is full when a bargain arrives holds no gear at all, and the policy's only
    // answer is to back out. The branch that discards for a bargain is a HUMAN's path (someone
    // who did not shed at the hub); `the policy, branch by branch` above proves it answers
    // correctly. If this ever becomes non-zero, the hub rule changed — re-read AC-26.
    expect(branch.dealDiscard).toBe(0);
  });
});

describe('the rejected-input probe — an illegal input every 50 steps is a no-op, every time', () => {
  /** An input of a kind the awaited phase does not take (ALLOWED is the independent table). */
  const ILLEGAL: readonly GameInput[] = [
    { kind: 'draft-pick', index: 0 },
    { kind: 'name', name: 'Intruder' },
    { kind: 'class', classId: 'Enforcer' },
    { kind: 'stats-decision', accept: false },
    { kind: 'deal-decision', accept: true },
    { kind: 'battle-action', action: 'fight' },
    { kind: 'menu', choice: 'continue' },
    { kind: 'discard', index: 0 },
    { kind: 'continue' },
  ];

  it('probes every class over seeds 1..6: same state reference, no events, same awaiting', () => {
    let probes = 0;
    const probedPhases = new Set<string>();
    for (const classId of ALL_CLASSES) {
      for (let seed = 1; seed <= 6; seed++) {
        const policy = heuristicPolicy(classId);
        let res: StepResult = sr(createGame(seed));
        for (let n = 1; res.awaiting !== 'game-over' && n < GUARD; n++) {
          if (res.awaiting === 'main-menu') res = { ...res, state: gearUpAtHub(res.state) };
          if (n % 50 === 0) {
            // Rotate through every kind the phase refuses, so no single refusal carries the probe.
            const refused = ILLEGAL.filter((i) => !ALLOWED[res.awaiting].has(i.kind));
            const bad = refused[probes % refused.length]!;
            const r = step(res.state, bad);
            expect(r.state, `${res.awaiting} took ${bad.kind}`).toBe(res.state);
            expect(r.events).toEqual([]);
            expect(r.awaiting).toBe(res.awaiting);
            probes++;
            probedPhases.add(res.awaiting);
          }
          res = step(res.state, policy(res));
        }
      }
    }
    expect(probes).toBeGreaterThan(100);
    expect(probedPhases.has('battle-action')).toBe(true);
    expect(probedPhases.has('main-menu')).toBe(true);
  });
});

describe('StepOptions reach every step of a simulated run (the DC-sensitivity seam)', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('at an unreachable DC nothing is ever seen through; at the shipped DC something is', () => {
    // No d20 + Wisdom modifier reaches 99 (20 + a modifier of a few points at most).
    const never = simulateBatch({ seeds, classes: [...ALL_CLASSES], stepOptions: { illusionDc: 99 } });
    const shipped = simulateBatch({ seeds, classes: [...ALL_CLASSES] });
    expect(never.perFloor[2].illusionsMet).toBeGreaterThan(0);
    expect(never.perFloor[2].illusionsDispelled).toBe(0);
    expect(shipped.perFloor[2].illusionsDispelled).toBeGreaterThan(0);
    // ...and at DC 1 the FIRST roll almost always succeeds: d20 + a modifier of -4 at worst
    // (Wisdom 3) meets 1 on a natural 5+, so P >= 0.8 per round and typically 0.95. So an
    // illusion lasts barely more than the one round the roll happens in — fewer rounds than at
    // the shipped DC. (NOT "more dispels": nearly every illusion ends in a dispel at any DC a
    // roll can reach, so the dispel COUNT tracks how many illusions were met, not the DC.)
    const always = simulateBatch({ seeds, classes: [...ALL_CLASSES], stepOptions: { illusionDc: 1 } });
    const roundsPer = (r: typeof shipped): number => r.perFloor[2].illusionRounds / r.perFloor[2].illusionsMet;
    expect(roundsPer(always)).toBeLessThan(1.3);
    expect(roundsPer(always)).toBeLessThan(roundsPer(shipped));
  });

  it('an empty options object IS the shipped game (same report, byte for byte)', () => {
    expect(simulateBatch({ seeds: [1, 2], classes: [...ALL_CLASSES], stepOptions: {} })).toEqual(
      simulateBatch({ seeds: [1, 2], classes: [...ALL_CLASSES] }),
    );
  });
});
