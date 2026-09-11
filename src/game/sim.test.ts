import { describe, expect, it } from 'vitest';
import {
  heuristicPolicy,
  mercifulPolicy,
  runToTerminal,
  simulateRun,
  simulateBatch,
  ALL_CLASSES,
  gearUpAtHub,
  type SimPolicy,
} from './sim.ts';
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
      version: 8,
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
      version: 8,
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
    // FIXTURE: a 1-HP, potionless, skill-less, cannot-flee player. Any enemy hit (plain 1 on a
    // non-fumble roll vs the AC-1 player) kills. The policy has no heal/skill/flee available, so
    // it swings and dies — independently, the death is tagged with the state's act (3).
    const player = makePlayer({
      name: 'Frail',
      hp: 1,
      maxHp: 1,
      pots: 0,
      skillPool: [],
      armorClass: 1,
    });
    const enemy = {
      ...generateEnemy({ act: 3, type: 'Grunt', playerXp: 40 }, mulberry32(2)),
      skillPool: [] as string[],
      skillCharges: 0,
      karmaWeighted: false,
    };
    const battle: BattleState = { player, enemy, act: 3, canFlee: false };
    const state: GameState = {
      version: 8,
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
  'main-menu': new Set(['menu']),
  continue: new Set(['continue']),
  'battle-action': new Set(['battle-action']),
  'draft-pick': new Set(['draft-pick']),
  'deal-decision': new Set(['deal-decision']),
  'rest-decision': new Set(['rest-decision']),
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
    version: 8,
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

describe('the heuristic heals with a found consumable once potions are gone', () => {
  function battleAt(hp: number, pots: number, backpack: ItemInstance[]): StepResult {
    const p = makePlayer({ hp, maxHp: 20, pots });
    const player = { ...p, inventory: { ...p.inventory, backpack } };
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(3));
    const battle = createBattle(player, enemy, 1);
    const state: GameState = { ...hubWith([]), player, phase: { kind: 'battle', battle, started: true, final: false } };
    return { state, events: [], awaiting: 'battle-action' };
  }

  it('at <= 35% HP with no potions, uses the FIRST healSelf item (index derived by hand)', () => {
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
