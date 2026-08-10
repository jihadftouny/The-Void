import { describe, expect, it } from 'vitest';
import {
  createGame,
  step,
  awaitingFor,
  type GameState,
  type GameInput,
  type StepResult,
} from './game.ts';
import { createPlayer, type Player } from './player.ts';
import { generateEnemy } from './enemy.ts';
import { type BattleState } from './battle.ts';
import { selectEncounter } from './encounter.ts';
import { buildShopOffer } from './shop.ts';
import { FINAL_BOSS_NAME, FINAL_BOSS_XP } from './progression.ts';
import { createRng, mulberry32 } from './rng.ts';
import { type Stats } from './character.ts';
import { createKarma } from './karma.ts';
import { type GameEvent } from './gameEvent.ts';

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

function menuState(player: Player, rngState: number, act = 1): GameState {
  return {
    version: 1,
    rngState,
    player,
    act,
    place: act - 1,
    karma: createKarma(),
    phase: { kind: 'main-menu' },
  };
}

// ------- Creation flow -------------------------------------------------------

describe('createGame', () => {
  it('starts at the title, act 1, no player, seeded', () => {
    const s = createGame(777);
    expect(s.phase).toEqual({ kind: 'title' });
    expect(s.player).toBeNull();
    expect(s.act).toBe(1);
    expect(s.place).toBe(0);
    expect(s.rngState).toBe(777);
    expect(s.version).toBe(1);
    expect(awaitingFor(s.phase)).toBe('title');
  });

  it('seeds a neutral four-axis karma vector (all axes 0)', () => {
    // Independently: createKarma() is the all-zero vector; createGame seeds it.
    expect(createGame(777).karma).toEqual({
      mercyCruelty: 0,
      restraintGreed: 0,
      reverenceDesecration: 0,
      clarityDelusion: 0,
    });
  });
});

describe('karma persistence across steps', () => {
  it('carries karma unchanged through a transition that records none', () => {
    // No M1 engine event records a karma action, so karma is invariant across step.
    const s = createGame(42);
    const r = step(s, { kind: 'continue' }); // title -> name-entry
    expect(r.state.phase.kind).toBe('name-entry');
    expect(r.state.karma).toEqual(createKarma());
    expect(r.state.karma).toEqual(s.karma);
  });
});

describe('character creation transitions', () => {
  it('title -> name -> class -> stats -> main-menu with the right awaits & events', () => {
    let r: StepResult = { state: createGame(42), events: [], awaiting: 'title' };

    r = step(r.state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('name-entry');
    expect(r.awaiting).toBe('enter-name');

    r = step(r.state, { kind: 'name', name: 'Zara' });
    expect(r.state.phase).toEqual({ kind: 'class-select', name: 'Zara' });
    expect(r.awaiting).toBe('choose-class');

    r = step(r.state, { kind: 'class', classId: 'Enforcer' });
    expect(r.state.phase.kind).toBe('stats-roll');
    expect(r.awaiting).toBe('accept-or-reroll-stats');
    const rolled = r.events.find((e) => e.kind === 'stats-rolled');
    expect(rolled).toBeDefined();
    // Every rolled stat is a 4d6-drop-lowest value in [3, 18].
    if (rolled && rolled.kind === 'stats-rolled') {
      for (const v of Object.values(rolled.stats)) {
        expect(v).toBeGreaterThanOrEqual(3);
        expect(v).toBeLessThanOrEqual(18);
      }
    }

    r = step(r.state, { kind: 'stats-decision', accept: true });
    expect(r.state.phase.kind).toBe('main-menu');
    expect(r.awaiting).toBe('main-menu');
    expect(r.state.player?.name).toBe('Zara');
    // player-created + intro emitted; intro has the name substituted (no token left).
    const created = r.events.find((e) => e.kind === 'player-created');
    expect(created).toBeDefined();
    const intro = r.events.find((e) => e.kind === 'intro');
    expect(intro).toBeDefined();
    if (intro && intro.kind === 'intro') {
      const joined = intro.lines.join('\n');
      expect(joined).not.toContain('{playerName}');
      expect(joined).toContain('Zara');
    }
  });

  it('re-rolls stats on accept:false and stays in stats-roll', () => {
    // Two different seeds would differ; here the SAME state re-rolled must change
    // the stats (a fresh 24-draw roll) yet remain in the stats-roll phase.
    let r: StepResult = { state: createGame(42), events: [], awaiting: 'title' };
    r = step(r.state, { kind: 'continue' });
    r = step(r.state, { kind: 'name', name: 'Zara' });
    r = step(r.state, { kind: 'class', classId: 'Enforcer' });
    const first = r.state.phase;
    const r2 = step(r.state, { kind: 'stats-decision', accept: false });
    expect(r2.state.phase.kind).toBe('stats-roll');
    expect(r2.awaiting).toBe('accept-or-reroll-stats');
    if (first.kind === 'stats-roll' && r2.state.phase.kind === 'stats-roll') {
      // A fresh roll advanced the RNG, so the new state differs from the old.
      expect(r2.state.rngState).not.toBe(r.state.rngState);
      expect(r2.state.phase.stats).not.toEqual(first.stats);
    }
  });
});

// ------- Reducer totality / no-op --------------------------------------------

describe('invalid input is a no-op', () => {
  it('a mismatched input returns the same state and no events', () => {
    const s = createGame(1);
    const r = step(s, { kind: 'name', name: 'X' }); // title expects continue
    expect(r.state).toBe(s); // same reference — untouched
    expect(r.events).toEqual([]);
    expect(r.awaiting).toBe('title');
  });

  it('game-over is terminal: every further step is a no-op', () => {
    const player = makePlayer();
    const s: GameState = { ...menuState(player, 5), phase: { kind: 'game-over' } };
    const r = step(s, { kind: 'continue' });
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
    expect(r.awaiting).toBe('game-over');
  });
});

describe('main-menu: quit', () => {
  it('emits game-over with the player xp and goes terminal', () => {
    const player = makePlayer({ xp: 7 });
    const r = step(menuState(player, 3), { kind: 'menu', choice: 'quit' });
    expect(r.state.phase.kind).toBe('game-over');
    expect(r.awaiting).toBe('game-over');
    expect(r.events).toEqual([{ kind: 'game-over', xp: 7 }]);
  });
});

// ------- Encounters (wiring) -------------------------------------------------

// Find rngStates that route the first encounter to battle / rest. selectEncounter
// is the first draw continueJourney makes, so this predicts the reducer exactly.
function findEncounterSeeds(): { battle: number; rest: number } {
  let battle = -1;
  let rest = -1;
  for (let s = 0; s < 500 && (battle < 0 || rest < 0); s++) {
    const enc = selectEncounter(createRng(s).rng);
    if (enc === 'battle' && battle < 0) battle = s;
    if (enc === 'rest' && rest < 0) rest = s;
  }
  return { battle, rest };
}

describe('main-menu: continue -> encounter', () => {
  const seeds = findEncounterSeeds();

  it('routes to a random battle, grants advantage, then starts the fight', () => {
    const player = makePlayer({ xp: 0 }); // xp 0 -> no act advance
    const r = step(menuState(player, seeds.battle), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase.kind).toBe('battle');
    expect(r.awaiting).toBe('continue');
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.started).toBe(false);
      expect(r.state.phase.final).toBe(false);
      expect(r.state.phase.battle.player.advantageDisadvantage).toBe(1);
      const enemyName = r.state.phase.battle.enemy.fullName;
      expect(r.events).toContainEqual({ kind: 'encounter-start', enemyName });
    }
    // Starting the fight flips `started` and awaits a battle action.
    const r2 = step(r.state, { kind: 'continue' });
    expect(r2.awaiting).toBe('battle-action');
    if (r2.state.phase.kind === 'battle') expect(r2.state.phase.started).toBe(true);
  });

  it('routes to a rest, shows lore, then offers the rest', () => {
    const player = makePlayer({ xp: 0, restsLeft: 1 });
    const r = step(menuState(player, seeds.rest), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase.kind).toBe('rest');
    expect(r.awaiting).toBe('rest-decision');
    expect(r.events.some((e) => e.kind === 'rest-lore')).toBe(true);
  });

  it('with no rests left, shows lore then a no-rests notice awaiting continue', () => {
    const player = makePlayer({ xp: 0, restsLeft: 0 });
    const r = step(menuState(player, seeds.rest), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase.kind).toBe('rest');
    expect(r.awaiting).toBe('continue');
    expect(r.events.some((e) => e.kind === 'no-rests')).toBe(true);
    // Continuing returns to the menu.
    const r2 = step(r.state, { kind: 'continue' });
    expect(r2.state.phase.kind).toBe('main-menu');
  });
});

// ------- Rest resolution -----------------------------------------------------

describe('rest resolution', () => {
  it('accepting at reduced HP heals within [10,10+floor(xp/4)], caps at maxHp, spends a rest', () => {
    const player = makePlayer({ xp: 40, hp: 5, maxHp: 50, restsLeft: 1 });
    const state: GameState = {
      ...menuState(player, 99),
      phase: { kind: 'rest', restOffered: true },
    };
    // Independently derive the heal: computeRestHeal is the first draw of this step.
    const expectedHeal = 10 + Math.floor(createRng(99).rng() * (Math.floor(40 / 4) + 1));
    const r = step(state, { kind: 'rest-decision', accept: true });
    const taken = r.events.find((e) => e.kind === 'rest-taken');
    expect(taken).toBeDefined();
    if (taken && taken.kind === 'rest-taken') {
      expect(taken.hpRestored).toBe(expectedHeal);
      expect(taken.hpRestored).toBeGreaterThanOrEqual(10);
      expect(taken.hpRestored).toBeLessThanOrEqual(20);
      expect(taken.hp).toBe(Math.min(5 + expectedHeal, 50));
    }
    expect(r.state.player?.restsLeft).toBe(0);
    expect(r.state.phase.kind).toBe('main-menu');
  });

  it('accepting at full HP heals nothing and spends no rest', () => {
    const player = makePlayer({ xp: 40, hp: 50, maxHp: 50, restsLeft: 1 });
    const state: GameState = {
      ...menuState(player, 99),
      phase: { kind: 'rest', restOffered: true },
    };
    const r = step(state, { kind: 'rest-decision', accept: true });
    expect(r.events).toContainEqual({ kind: 'rest-full' });
    expect(r.state.player?.restsLeft).toBe(1); // unchanged
    expect(r.state.player?.hp).toBe(50);
  });

  it('declining changes nothing but returns to the menu', () => {
    const player = makePlayer({ xp: 40, hp: 5, maxHp: 50, restsLeft: 1 });
    const state: GameState = {
      ...menuState(player, 99),
      phase: { kind: 'rest', restOffered: true },
    };
    const r = step(state, { kind: 'rest-decision', accept: false });
    expect(r.events).toContainEqual({ kind: 'rest-declined' });
    expect(r.state.player?.restsLeft).toBe(1);
    expect(r.state.player?.hp).toBe(5);
    expect(r.state.phase.kind).toBe('main-menu');
  });
});

// ------- Shop ----------------------------------------------------------------

describe('shop (menu option: character-info)', () => {
  it('offers exactly buildShopOffer(act,rng), then buys and bundles character-info', () => {
    const player = makePlayer({ gold: 1500 });
    const rngState = 12321;
    // Independently derive the offer the reducer will build (same rng seam).
    const expectedOffer = buildShopOffer(1, createRng(rngState).rng);
    const r = step(menuState(player, rngState), { kind: 'menu', choice: 'character-info' });
    expect(r.state.phase.kind).toBe('shop');
    expect(r.awaiting).toBe('shop-decision');
    const offerEvent = r.events.find((e) => e.kind === 'shop-offer');
    expect(offerEvent).toBeDefined();
    if (offerEvent && offerEvent.kind === 'shop-offer') {
      expect(offerEvent.itemId).toBe(expectedOffer.itemId);
      expect(offerEvent.price).toBe(expectedOffer.price);
      expect(offerEvent.itemKind).toBe(expectedOffer.itemKind);
    }

    const r2 = step(r.state, { kind: 'shop-decision', accept: true });
    expect(r2.state.phase.kind).toBe('main-menu');
    expect(r2.events.some((e) => e.kind === 'shop-purchased')).toBe(true);
    expect(r2.events.some((e) => e.kind === 'character-info')).toBe(true);
    // Gold reduced by exactly the price; matching slot swapped to the offer id.
    expect(r2.state.player?.gold).toBe(1500 - expectedOffer.price);
    if (expectedOffer.itemKind === 'weapon') {
      expect(r2.state.player?.equippedWeaponId).toBe(expectedOffer.itemId);
    } else {
      expect(r2.state.player?.equippedArmorId).toBe(expectedOffer.itemId);
    }
  });

  it('declining leaves gold and gear unchanged but still shows character-info', () => {
    const player = makePlayer({ gold: 1500 });
    const rngState = 12321;
    const r = step(menuState(player, rngState), { kind: 'menu', choice: 'character-info' });
    const r2 = step(r.state, { kind: 'shop-decision', accept: false });
    expect(r2.events.some((e) => e.kind === 'shop-declined')).toBe(true);
    expect(r2.events.some((e) => e.kind === 'character-info')).toBe(true);
    expect(r2.state.player?.gold).toBe(1500);
    expect(r2.state.player?.equippedWeaponId).toBe(player.equippedWeaponId);
    expect(r2.state.player?.equippedArmorId).toBe(player.equippedArmorId);
  });

  it('insufficient gold changes nothing', () => {
    const player = makePlayer({ gold: 0 });
    const rngState = 12321;
    const r = step(menuState(player, rngState), { kind: 'menu', choice: 'character-info' });
    const r2 = step(r.state, { kind: 'shop-decision', accept: true });
    expect(r2.events.some((e) => e.kind === 'shop-insufficient')).toBe(true);
    expect(r2.state.player?.gold).toBe(0);
    expect(r2.state.player?.equippedWeaponId).toBe(player.equippedWeaponId);
  });
});

// ------- Act progression at a gate -------------------------------------------

describe('act progression at a gate', () => {
  it('continue at xp>=10 runs outro -> level-up -> intro back to the menu (one act only)', () => {
    const player = makePlayer({ xp: 1000 }); // far past the Act-2 gate (10)
    const oldMaxHp = player.maxHp; // 11
    let r = step(menuState(player, 55, 1), { kind: 'menu', choice: 'continue' });

    // checkAct advances exactly ONE act, runs no encounter, emits nothing yet.
    expect(r.state.act).toBe(2);
    expect(r.state.place).toBe(1);
    expect(r.state.phase).toEqual({ kind: 'act-outro', newAct: 2 });
    expect(r.events).toEqual([]);
    expect(r.awaiting).toBe('continue');

    // Outro of the concluded act (Act I).
    r = step(r.state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('level-up');
    expect(r.events).toContainEqual({
      kind: 'act-outro',
      act: 1,
      header: 'ACT I',
      body: '',
    });
    expect(r.awaiting).toBe('level-up-picks');

    // Level-up: pick CON twice -> CON 13->15, mod 1->2 (changed).
    r = step(r.state, { kind: 'level-up-picks', picks: ['CON', 'CON'] });
    expect(r.state.phase.kind).toBe('level-up-result');
    const lvl = r.events.find((e) => e.kind === 'level-up');
    expect(lvl).toBeDefined();
    if (lvl && lvl.kind === 'level-up') {
      expect(lvl.conModChanged).toBe(true);
      expect(lvl.proficiency).toBe(3);
      expect(lvl.newStats.CON).toBe(15);
      expect(lvl.newMaxHp).toBe(r.state.player?.maxHp);
      // hpRoll is the total maxHp delta minus the CON-changed bonus (newAct-1 = 1).
      expect(lvl.hpRoll).toBe(lvl.newMaxHp - oldMaxHp - 1);
    }
    expect(r.state.player?.hp).toBe(11); // NOT healed
    expect(r.state.player?.hitDie).toEqual({ quantity: 2, sides: 10 });

    // Act intro then back to the menu (not Act 5).
    r = step(r.state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('act-intro');
    expect(r.events).toContainEqual({
      kind: 'act-intro',
      act: 2,
      header: 'ACT II',
      body: '',
    });
    r = step(r.state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('main-menu');
  });
});

// ------- Act 5 triggers the final battle -------------------------------------

describe('entering Act 5', () => {
  it('act-intro{5} continue builds the final boss battle', () => {
    const player = makePlayer();
    const state: GameState = {
      version: 1,
      rngState: 314,
      player,
      act: 5,
      place: 4,
      karma: createKarma(),
      phase: { kind: 'act-intro', newAct: 5 },
    };
    const r = step(state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('battle');
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.final).toBe(true);
      expect(r.state.phase.started).toBe(false);
      expect(r.state.phase.battle.canFlee).toBe(false); // Act 5: no escape
      expect(r.state.phase.battle.enemy.type).toBe(FINAL_BOSS_NAME);
    }
    // Act 5 has no name table, so the boss's display name is its type.
    expect(r.events).toContainEqual({
      kind: 'final-battle-begins',
      enemyName: FINAL_BOSS_NAME,
    });
  });
});

// ------- Ending / win path ---------------------------------------------------

describe('win / ending path', () => {
  it('victory in the final battle emits the ending with the name, then goes terminal', () => {
    const player = makePlayer({ name: 'Zara' });
    const state: GameState = {
      version: 1,
      rngState: 1,
      player,
      act: 5,
      place: 4,
      karma: createKarma(),
      phase: { kind: 'battle-victory', final: true },
    };
    const r = step(state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('ending');
    expect(r.awaiting).toBe('continue');
    // Ending body is Story.ending.body "{playerName}" with the name substituted.
    expect(r.events).toContainEqual({ kind: 'ending', header: 'END.', body: 'Zara' });

    const r2 = step(r.state, { kind: 'continue' });
    expect(r2.state.phase.kind).toBe('game-over');
    expect(r2.awaiting).toBe('game-over');
    expect(r2.events).toEqual([]); // nothing after the ending, so ending stays last
  });

  it('drives a constructed final battle to victory and reaches the ending event', () => {
    // FIXTURE: a trivially-killable boss (1 HP, AC 1, no skills) versus an
    // unkillable player. This exercises the real resolveRound -> player-won ->
    // battle-victory{final} -> ending chain end-to-end. (A win from a genuine
    // seed-driven playthrough is unreachable at the current M4/M5 balance; see the
    // deterministic-death playthrough test below and the build report.)
    const player = makePlayer({ name: 'Zara', hp: 9999, maxHp: 9999, advantageDisadvantage: 1 });
    const boss = {
      ...generateEnemy({ act: 5, type: FINAL_BOSS_NAME, playerXp: FINAL_BOSS_XP }, mulberry32(1)),
      hp: 1,
      maxHp: 1,
      armorClass: 1,
      skillPool: [] as string[],
      skillCharges: 0,
    };
    const battle: BattleState = { player, enemy: boss, act: 5, canFlee: false };
    let r: StepResult = {
      state: {
        version: 1,
        rngState: 7,
        player,
        act: 5,
        place: 4,
        karma: createKarma(),
        phase: { kind: 'battle', battle, started: true, final: true },
      },
      events: [],
      awaiting: 'battle-action',
    };

    const all: GameEvent[] = [];
    let guard = 0;
    while (r.awaiting !== 'game-over' && guard < 100) {
      const input: GameInput =
        r.awaiting === 'battle-action'
          ? { kind: 'battle-action', action: 'fight' }
          : { kind: 'continue' };
      r = step(r.state, input);
      for (const e of r.events) all.push(e);
      guard++;
    }
    // The player won: an ending was emitted and it is the final narrative event.
    const ending = all.filter((e) => e.kind === 'ending');
    expect(ending).toHaveLength(1);
    expect(all.some((e) => e.kind === 'victory')).toBe(true);
    expect(all[all.length - 1]).toEqual({ kind: 'ending', header: 'END.', body: 'Zara' });
    expect(r.awaiting).toBe('game-over');
  });
});

// ------- JSON round-trip determinism -----------------------------------------

describe('JSON round-trip determinism', () => {
  it('a serialized mid-run state steps byte-identically to the live one', () => {
    // Advance to a battle so the next step consumes RNG (proves rngState round-trips).
    const player = makePlayer({ xp: 0 });
    const seeds = findEncounterSeeds();
    const live = step(menuState(player, seeds.battle), {
      kind: 'menu',
      choice: 'continue',
    }).state;
    const started = step(live, { kind: 'continue' }).state; // started:true, awaiting action

    const revived: GameState = JSON.parse(JSON.stringify(started));
    expect(revived).toEqual(started);

    const a = step(started, { kind: 'battle-action', action: 'fight' });
    const b = step(revived, { kind: 'battle-action', action: 'fight' });
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
    expect(b.awaiting).toBe(a.awaiting);
  });
});

// ------- Full scripted playthrough -------------------------------------------

// A deterministic policy: aggressive fighting, CON-stacking, always rest, no shop.
function decide(res: StepResult): GameInput {
  const { awaiting, state } = res;
  switch (awaiting) {
    case 'title':
      return { kind: 'continue' };
    case 'enter-name':
      return { kind: 'name', name: 'Zara' };
    case 'choose-class':
      return { kind: 'class', classId: 'Enforcer' };
    case 'accept-or-reroll-stats':
      return { kind: 'stats-decision', accept: true };
    case 'main-menu':
      return { kind: 'menu', choice: 'continue' };
    case 'continue':
      return { kind: 'continue' };
    case 'battle-action': {
      const p = state.phase;
      if (p.kind === 'battle') {
        const pl = p.battle.player;
        if (pl.pots > 0 && pl.hp <= pl.maxHp * 0.4) {
          return { kind: 'battle-action', action: 'potion' };
        }
      }
      return { kind: 'battle-action', action: 'fight' };
    }
    case 'level-up-picks':
      return { kind: 'level-up-picks', picks: ['CON', 'CON'] };
    case 'shop-decision':
      return { kind: 'shop-decision', accept: false };
    case 'rest-decision':
      return { kind: 'rest-decision', accept: true };
    case 'game-over':
      return { kind: 'continue' };
  }
}

function runPlaythrough(seed: number): { events: GameEvent[]; final: GameState; steps: number } {
  let r: StepResult = { state: createGame(seed), events: [], awaiting: 'title' };
  const events: GameEvent[] = [];
  let guard = 0;
  while (r.awaiting !== 'game-over' && guard < 100000) {
    r = step(r.state, decide(r));
    for (const e of r.events) events.push(e);
    guard++;
  }
  return { events, final: r.state, steps: guard };
}

describe('full scripted playthrough', () => {
  it('reaches a deterministic terminal state and is byte-reproducible across runs', () => {
    const SEED = 12345;
    const a = runPlaythrough(SEED);
    const b = runPlaythrough(SEED);

    // Terminal, and the two runs are byte-identical.
    expect(a.final.phase.kind).toBe('game-over');
    expect(awaitingFor(a.final.phase)).toBe('game-over');
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(JSON.stringify(b.final)).toBe(JSON.stringify(a.final));

    // The machine actually ran combat: at least one fight happened.
    expect(a.events.some((e) => e.kind === 'attack')).toBe(true);

    // At the frozen M4/M5 balance this run ends in death (no ending is reachable
    // from a real seed): the terminal signal is the game-over event, not an ending.
    expect(a.events.some((e) => e.kind === 'game-over')).toBe(true);
    expect(a.events.some((e) => e.kind === 'ending')).toBe(false);
  });
});
