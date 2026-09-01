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
import { getFamily, FAMILIES } from './enemyFamily.ts';
import { AFFIXES } from './enemyAffix.ts';
import { createUnlockStore, snapshotUnlocks, type RunUnlocks } from './unlockStore.ts';
import { type BattleState } from './battle.ts';
import { selectEncounter } from './encounter.ts';
import { buildDeal, selectPool } from './deal.ts';
import { FINAL_BOSS_NAME, FINAL_BOSS_XP } from './progression.ts';
import { BOSSES } from './boss.ts';
import { getGraceEnding, getDamnationEnding } from './story.ts';
import { createRng, mulberry32 } from './rng.ts';
import { type Stats } from './character.ts';
import { createKarma, type KarmaState } from './karma.ts';
import { hasControlCondition, makeCondition } from './condition.ts';
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
    version: 8,
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
    expect(s.version).toBe(8);
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

  it('player-created reports the REAL armored AC, not the stored unarmored base', () => {
    // Enforcer starts in Jooj Armor 1 (baseArmor 11, dexCap 2, strReq 0). With CON 12/+1
    // and DEX 12/+1 the real AC is 11 + 1 + min(1,2) = 13, whereas the stored (unarmored)
    // armorClass is 10 + CONmod = 11. The event must carry 13 (hand-derived), proving M4's
    // armored AC is what the HUD sees.
    const stats: Stats = { STR: 12, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 };
    const state: GameState = {
      version: 8,
      rngState: 7,
      player: null,
      act: 1,
      place: 0,
      karma: createKarma(),
      phase: { kind: 'stats-roll', name: 'Zara', classId: 'Enforcer', stats },
    };
    const r = step(state, { kind: 'stats-decision', accept: true });
    const created = r.events.find((e) => e.kind === 'player-created');
    expect(created).toBeDefined();
    if (created && created.kind === 'player-created') {
      expect(created.armorClass).toBe(13);
      // The stored (unarmored) armorClass is only 11 — confirm the event improved on it.
      expect(r.state.player?.armorClass).toBe(11);
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

  it('accepting with NOTHING to gain heals nothing and spends no rest', () => {
    // Full HP, full charges, no conditions — the only case where a rest can do nothing.
    // (Narrowed from "at full HP" by G27/G31: full HP alone is no longer enough, because a
    // rest is now also the cure for fracture and the only refill for skill charges.)
    const player = makePlayer({ xp: 40, hp: 50, maxHp: 50, restsLeft: 1 });
    expect(player.skillCharges).toBe(player.maxSkillCharges);
    expect(player.activeConditions).toEqual([]);
    const state: GameState = {
      ...menuState(player, 99),
      phase: { kind: 'rest', restOffered: true },
    };
    const r = step(state, { kind: 'rest-decision', accept: true });
    expect(r.events).toContainEqual({ kind: 'rest-full' });
    expect(r.state.player?.restsLeft).toBe(1); // unchanged
    expect(r.state.player?.hp).toBe(50);
  });

  // ------- G27 / G31 — a rest cures and refills, not just heals ---------------

  it('G27/G31 — an accepted rest clears every condition AND refills skill charges', () => {
    // The register's reproduction: rest at hp 3 / charges 0 gave hp 12 / charges 0, and a
    // floor-1 Ganger's fracture was still active 99 rounds later.
    const player = makePlayer({
      xp: 40, hp: 5, maxHp: 50, restsLeft: 1,
      skillCharges: 0,
      activeConditions: [makeCondition('fracture'), makeCondition('poison')],
    });
    const state: GameState = {
      ...menuState(player, 99),
      phase: { kind: 'rest', restOffered: true },
    };
    const r = step(state, { kind: 'rest-decision', accept: true });
    expect(r.state.player?.activeConditions).toEqual([]);
    expect(r.state.player?.skillCharges).toBe(player.maxSkillCharges);
    expect(r.state.player?.restsLeft).toBe(0); // it was paid for
    expect(r.events.some((e) => e.kind === 'rest-taken')).toBe(true);
  });

  it('G27 — a rest at FULL HP still cures, and costs a rest for doing it', () => {
    // The exploit the register's literal wording ("restore charges including the rest-full
    // branch") would have opened, closed: a rest that does something is always paid for.
    const player = makePlayer({
      xp: 40, hp: 50, maxHp: 50, restsLeft: 1,
      activeConditions: [makeCondition('fracture')],
    });
    const state: GameState = {
      ...menuState(player, 99),
      phase: { kind: 'rest', restOffered: true },
    };
    const r = step(state, { kind: 'rest-decision', accept: true });
    expect(r.state.player?.activeConditions).toEqual([]);
    expect(r.state.player?.hp).toBe(50); // already full; the heal is capped
    expect(r.state.player?.restsLeft).toBe(0); // NOT free
    expect(r.events.some((e) => e.kind === 'rest-full')).toBe(false);
  });

  it('G31 — a rest at FULL HP still refills charges, and costs a rest for doing it', () => {
    const player = makePlayer({ xp: 40, hp: 50, maxHp: 50, restsLeft: 1, skillCharges: 1 });
    const state: GameState = {
      ...menuState(player, 99),
      phase: { kind: 'rest', restOffered: true },
    };
    const r = step(state, { kind: 'rest-decision', accept: true });
    expect(r.state.player?.skillCharges).toBe(player.maxSkillCharges);
    expect(r.state.player?.restsLeft).toBe(0);
    expect(r.events.some((e) => e.kind === 'rest-full')).toBe(false);
  });

  it('a rest with no rests left is never offered, so the decision path cannot go negative', () => {
    // `continueJourney` only sets `restOffered: true` when `restsLeft >= 1`, which is what
    // keeps the `restsLeft - 1` above from ever producing a negative count. Pinned here
    // because G27/G31 made the "take it" branch reachable in strictly more situations.
    const player = makePlayer({ xp: 0, restsLeft: 0, hp: 1, maxHp: 50, skillCharges: 0 });
    const r = step(menuState(player, findEncounterSeeds().rest), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'rest', restOffered: false });
    expect(r.awaiting).toBe('continue');
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

// ------- Sacrifice-deal encounter (menu option: seek-deal) -------------------

describe('sacrifice deal (menu option: seek-deal)', () => {
  it('opens a deal phase matching buildDeal(karma,act,rng) with the karma-read pool', () => {
    const player = makePlayer();
    const rngState = 12321;
    // Independently derive the deal the reducer will build (same rng seam + neutral karma).
    const expected = buildDeal(createKarma(), 1, createRng(rngState).rng);
    const r = step(menuState(player, rngState), { kind: 'menu', choice: 'seek-deal' });
    expect(r.state.phase.kind).toBe('deal');
    expect(r.awaiting).toBe('deal-decision');
    if (r.state.phase.kind === 'deal') {
      expect(r.state.phase.deal).toEqual(expected);
      expect(r.state.phase.deal.pool).toBe(selectPool(createKarma())); // neutral -> 'standard'
    }
    const offer = r.events.find((e) => e.kind === 'deal-offer');
    expect(offer).toBeDefined();
    if (offer && offer.kind === 'deal-offer') expect(offer.pool).toBe(expected.pool);
  });

  it('taking the deal returns to the hub and patches player + karma', () => {
    const player = makePlayer();
    const rngState = 12321;
    const r = step(menuState(player, rngState), { kind: 'menu', choice: 'seek-deal' });
    const r2 = step(r.state, { kind: 'deal-decision', accept: true });
    expect(r2.state.phase.kind).toBe('main-menu');
    expect(r2.events.some((e) => e.kind === 'deal-taken')).toBe(true);
    expect('gold' in (r2.state.player ?? {})).toBe(false);
  });

  it('declining leaves player and karma unchanged and returns to the hub', () => {
    const player = makePlayer();
    const state = menuState(player, 12321);
    const r = step(state, { kind: 'menu', choice: 'seek-deal' });
    const r2 = step(r.state, { kind: 'deal-decision', accept: false });
    expect(r2.events.some((e) => e.kind === 'deal-declined')).toBe(true);
    expect(r2.state.phase.kind).toBe('main-menu');
    expect(r2.state.player).toEqual(player);
    expect(r2.state.karma).toEqual(state.karma);
  });
});

// ------- Chest encounter -----------------------------------------------------

describe('chest encounter', () => {
  // Seed 4: the first step draw is 0.9236 -> randInt(_,6)=5 -> the chest slot of
  // [B,B,B,R,R,C]. xp 0 so no act gate fires first. The chest loot lands in the backpack.
  it('main-menu continue can open a chest, depositing rolled loot into the backpack', () => {
    const player = makePlayer({ xp: 0 });
    const before = player.inventory.backpack.length;
    const r = step(menuState(player, 4), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase.kind).toBe('chest');
    expect(r.awaiting).toBe('continue');
    expect(r.events.some((e) => e.kind === 'chest-found')).toBe(true);
    const lootEvent = r.events.find((e) => e.kind === 'chest-loot');
    expect(lootEvent).toBeDefined();
    // chestItemCount is 1, so exactly one item is revealed and picked up.
    if (lootEvent && lootEvent.kind === 'chest-loot') expect(lootEvent.loot).toHaveLength(1);
    expect(r.state.player?.inventory.backpack.length).toBe(before + 1);
  });

  it('continuing from the chest phase returns to the main menu (loot already taken)', () => {
    const player = makePlayer();
    const state: GameState = {
      ...menuState(player, 1),
      phase: { kind: 'chest', loot: [{ defId: 'gen:Common:ring' }] },
    };
    const r = step(state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('main-menu');
    // The chest phase does not re-pick-up; the player is unchanged on continue.
    expect(r.state.player?.inventory.backpack).toEqual(player.inventory.backpack);
  });
});

// ------- Act progression at a gate (M12: the boss is the gate) ---------------

describe('act gate is now the floor BOSS (M12)', () => {
  it('continue at xp>=10 enters the act-1 Kingpin boss battle, act NOT yet incremented', () => {
    const player = makePlayer({ xp: 1000 }); // far past the Act-2 gate (10)
    const r = step(menuState(player, 55, 1), { kind: 'menu', choice: 'continue' });

    // The floor boss ends the floor: a boss battle is entered, and the act stays put until
    // the boss falls (the increment now rides `resolvePostVictory`, not the XP threshold).
    expect(r.state.act).toBe(1);
    expect(r.state.place).toBe(0);
    expect(r.state.phase.kind).toBe('battle');
    expect(r.awaiting).toBe('continue'); // battle not yet started
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.final).toBe(false);
      expect(r.state.phase.started).toBe(false);
      expect(r.state.phase.battle.boss?.bossId).toBe('kingpin');
      expect(r.state.phase.battle.boss?.minions).toBe(0);
      expect(r.state.phase.battle.canFlee).toBe(false); // no fleeing a boss
      // The boss-encounter event names the boss id + the built enemy's display name.
      expect(r.events).toContainEqual({
        kind: 'boss-encounter',
        bossId: 'kingpin',
        enemyName: r.state.phase.battle.enemy.fullName,
      });
    }
  });

  it('the act-2 gate enters the Reflection; the act-3 gate enters the Sin', () => {
    // Act 2 gate at xp>=30 → Reflection.
    const p2 = makePlayer({ xp: 1000 });
    const r2 = step(menuState(p2, 7, 2), { kind: 'menu', choice: 'continue' });
    expect(r2.state.phase.kind).toBe('battle');
    if (r2.state.phase.kind === 'battle') {
      expect(r2.state.phase.battle.boss?.bossId).toBe('reflection');
      // The Reflection mirrors the player's kit (a copy).
      expect(r2.state.phase.battle.enemy.skillPool).toEqual(p2.skillPool);
    }
    // Act 3 gate at xp>=90 → Sin.
    const p3 = makePlayer({ xp: 1000 });
    const r3 = step(menuState(p3, 7, 3), { kind: 'menu', choice: 'continue' });
    expect(r3.state.phase.kind).toBe('battle');
    if (r3.state.phase.kind === 'battle') {
      expect(r3.state.phase.battle.boss?.bossId).toBe('sin');
    }
  });
});

// ------- M9 frequent XP leveling via battle victory -------------------------

describe('frequent level-up draft on battle victory', () => {
  it('a victory crossing a threshold routes continue -> level-up-draft (not main-menu)', () => {
    // Player at level 1 with xp 2 = cumulative(2) -> one level owed. Enforcer d10, CON 13
    // (mod +1). The HP roll is one d10 draw from the seed, derived independently below.
    const seed = 777;
    const player = makePlayer({ xp: 2, level: 1, maxHp: 11, hp: 11 });
    const state: GameState = {
      ...menuState(player, seed),
      phase: { kind: 'battle-victory', final: false },
    };
    // Independent derivation from rng.ts + applyLevelUpHp: first draw -> d10 face, + CON mod 1.
    const face = 1 + Math.floor(createRng(seed).rng() * 10);
    const expectedHpRoll = Math.max(face + 1, 1);
    const expectedMaxHp = 11 + expectedHpRoll;

    const r = step(state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('level-up-draft');
    expect(r.awaiting).toBe('draft-pick');
    if (r.state.phase.kind === 'level-up-draft') {
      expect(r.state.phase.offers).toHaveLength(3);
    }
    // level-up event carries the hand-derived level/hpRoll/newMaxHp; hp is NOT healed.
    expect(r.events).toContainEqual({ kind: 'level-up', newLevel: 2, hpRoll: expectedHpRoll, newMaxHp: expectedMaxHp });
    expect(r.state.player?.level).toBe(2);
    expect(r.state.player?.maxHp).toBe(expectedMaxHp);
    expect(r.state.player?.hp).toBe(11);
    // A draft-offer event lists exactly 3 option labels.
    const offer = r.events.find((e) => e.kind === 'draft-offer');
    expect(offer).toBeDefined();
    if (offer && offer.kind === 'draft-offer') expect(offer.options).toHaveLength(3);

    // Picking an offer applies it and moves to level-up-result; then continue -> main-menu
    // (xp 2 < cumulative(3)=6, so no further level is owed).
    const picked = step(r.state, { kind: 'draft-pick', index: 0 });
    expect(picked.state.phase.kind).toBe('level-up-result');
    expect(picked.events.some((e) => e.kind === 'draft-picked')).toBe(true);
    const done = step(picked.state, { kind: 'continue' });
    expect(done.state.phase.kind).toBe('main-menu');
  });

  it('several queued levels drain one-by-one before returning to the menu', () => {
    // xp 6 = cumulative(3): from level 1 that owes TWO levels (L2 at 2, L3 at 6; L4 needs 12).
    const player = makePlayer({ xp: 6, level: 1, maxHp: 11, hp: 11 });
    let r: StepResult = {
      state: { ...menuState(player, 4242), phase: { kind: 'battle-victory', final: false } },
      events: [],
      awaiting: 'continue',
    };
    // Drain: continue -> draft, pick, continue -> draft, pick, continue -> main-menu.
    let drafts = 0;
    let guard = 0;
    r = step(r.state, { kind: 'continue' });
    while (r.state.phase.kind !== 'main-menu' && guard < 20) {
      if (r.state.phase.kind === 'level-up-draft') {
        drafts++;
        r = step(r.state, { kind: 'draft-pick', index: 0 });
      } else {
        r = step(r.state, { kind: 'continue' });
      }
      guard++;
    }
    expect(r.state.phase.kind).toBe('main-menu');
    expect(drafts).toBe(2); // exactly two level-ups drained
    expect(r.state.player?.level).toBe(3);
  });
});

// ------- Act 5 triggers the HOLLOW final battle (M12) -------------------------

describe('entering Act 5', () => {
  it('act-intro{5} continue builds the HOLLOW SELF (replacing Jorginho)', () => {
    const player = makePlayer({ skillPool: ['heavyStrike', 'brace'] });
    const state: GameState = {
      version: 8,
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
      expect(r.state.phase.battle.boss?.bossId).toBe('hollow');
      // The Hollow's identity is the placeholder Hollow-Self, NOT the retired Jorginho.
      expect(r.state.phase.battle.enemy.type).toBe(BOSSES.hollow.name);
      expect(r.state.phase.battle.enemy.type).not.toBe(FINAL_BOSS_NAME);
      // It mirrors the player's kit (a copy).
      expect(r.state.phase.battle.enemy.skillPool).toEqual(player.skillPool);
      expect(r.events).toContainEqual({
        kind: 'final-battle-begins',
        enemyName: r.state.phase.battle.enemy.fullName,
      });
    }
  });
});

// ------- Ending / win path ---------------------------------------------------

describe('win / ending path', () => {
  it('victory in the final (Hollow) battle emits the DAMNATION ending, then goes terminal', () => {
    const player = makePlayer({ name: 'Zara' });
    const state: GameState = {
      version: 8,
      rngState: 1,
      player,
      act: 5,
      place: 4,
      karma: createKarma(),
      phase: { kind: 'battle-victory', final: true },
    };
    const r = step(state, { kind: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'ending', endingType: 'damnation' });
    expect(r.awaiting).toBe('continue');
    // The damnation ending prose (placeholder), name-substituted, hand-derived from story data.
    const dam = getDamnationEnding();
    expect(r.events).toContainEqual({
      kind: 'ending',
      endingType: 'damnation',
      header: dam.header,
      body: dam.body.split('{playerName}').join('Zara'),
    });

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
        version: 8,
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
    const dam = getDamnationEnding();
    expect(all[all.length - 1]).toEqual({
      kind: 'ending',
      endingType: 'damnation',
      header: dam.header,
      body: dam.body.split('{playerName}').join('Zara'),
    });
    expect(r.awaiting).toBe('game-over');
  });
});

// ------- M12 boss / verdict flow ---------------------------------------------

function karmaOf(partial: Partial<KarmaState>): KarmaState {
  return { ...createKarma(), ...partial };
}

/** A started boss battle vs a 1-HP, skill-less enemy the unkillable player one-shots. */
function bossVictoryState(
  bossId: 'kingpin' | 'reflection' | 'sin',
  act: number,
): GameState {
  // Player parked at a very high level so the tiny boss xp never owes a level-up (keeps the
  // post-victory route focused on the act advance).
  const player = makePlayer({ name: 'Zara', hp: 9999, maxHp: 9999, advantageDisadvantage: 1, level: 100 });
  const enemy = {
    ...generateEnemy({ act, type: BOSSES[bossId].name, playerXp: player.xp }, mulberry32(1)),
    hp: 1,
    maxHp: 1,
    armorClass: 1,
    skillPool: [] as string[],
    skillCharges: 0,
    karmaWeighted: false,
  };
  const battle: BattleState = {
    player,
    enemy,
    act,
    canFlee: false,
    boss: { bossId, round: 0, ...(bossId === 'kingpin' ? { minions: 0 } : {}) },
  };
  return {
    version: 8,
    rngState: 7,
    player,
    act,
    place: act - 1,
    karma: createKarma(),
    phase: { kind: 'battle', battle, started: true, final: false },
  };
}

describe('M12 floor-boss victory advances the act', () => {
  it('a Kingpin win sets pending=advance-act, then continue runs the act-outro/intro chain', () => {
    const r = step(bossVictoryState('kingpin', 1), { kind: 'battle-action', action: 'fight' });
    // The boss fell: routed to battle-victory with the advance flag scheduled.
    expect(r.state.phase.kind).toBe('battle-victory');
    expect(r.state.pending).toBe('advance-act');
    expect(r.state.act).toBe(1); // not yet incremented

    // Continue: no level owed (level 100) → resolvePostVictory advances the act.
    const r2 = step(r.state, { kind: 'continue' });
    expect(r2.state.phase.kind).toBe('act-outro');
    expect(r2.state.act).toBe(2);
    expect(r2.state.place).toBe(1);
    expect(r2.state.pending).toBeUndefined(); // the flag is consumed
    expect(r2.events).toContainEqual({ kind: 'act-outro', act: 1, header: 'ACT I', body: '' });

    // Outro → intro → hub.
    const r3 = step(r2.state, { kind: 'continue' });
    expect(r3.state.phase.kind).toBe('act-intro');
    const r4 = step(r3.state, { kind: 'continue' });
    expect(r4.state.phase.kind).toBe('main-menu');
    expect(r4.state.pending).toBeUndefined();
  });
});

describe('M12 act-4 verdict gate routes the two fates', () => {
  it('a reverence-led (grace) karma → verdict grace → TERMINAL grace ending at act 4 (act 5 never built)', () => {
    // computeVerdict({reverence:+2}) = 3×2 = 6 ≥ 1 ⇒ grace (hand-derived).
    const player = makePlayer({ name: 'Zara', xp: 1000 });
    const state: GameState = {
      version: 8,
      rngState: 5,
      player,
      act: 4,
      place: 3,
      karma: karmaOf({ reverenceDesecration: 2 }),
      phase: { kind: 'main-menu' },
    };
    const r = step(state, { kind: 'menu', choice: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'verdict', outcome: 'grace' });
    const verdictEvent = r.events.find((e) => e.kind === 'verdict');
    expect(verdictEvent).toBeDefined();
    // The verdict event leaks NO karma: its ONLY fields are kind + outcome (no axis/number).
    expect(Object.keys(verdictEvent!).sort()).toEqual(['kind', 'outcome']);
    if (verdictEvent?.kind === 'verdict') expect(verdictEvent.outcome).toBe('grace');

    // Continue → the grace ending, TERMINAL: act stays 4, act 5 is never constructed.
    const r2 = step(r.state, { kind: 'continue' });
    expect(r2.state.phase).toEqual({ kind: 'ending', endingType: 'grace' });
    expect(r2.state.act).toBe(4);
    const grace = getGraceEnding();
    expect(r2.events).toContainEqual({
      kind: 'ending',
      endingType: 'grace',
      header: grace.header,
      body: grace.body.split('{playerName}').join('Zara'),
    });
    const r3 = step(r2.state, { kind: 'continue' });
    expect(r3.state.phase.kind).toBe('game-over');
    expect(r3.state.act).toBe(4); // never reached act 5
  });

  it('a neutral (cast-down) karma → verdict cast-down → advance to act 5 → the Hollow', () => {
    // computeVerdict(all-zero) = 0 < 1 ⇒ cast-down (hand-derived).
    const player = makePlayer({ name: 'Zara', xp: 1000 });
    const state: GameState = {
      version: 8,
      rngState: 5,
      player,
      act: 4,
      place: 3,
      karma: createKarma(),
      phase: { kind: 'main-menu' },
    };
    let r = step(state, { kind: 'menu', choice: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'verdict', outcome: 'cast-down' });

    // Continue: cast-down advances to act 5 (outro → intro → the Hollow battle).
    r = step(r.state, { kind: 'continue' });
    expect(r.state.phase.kind).toBe('act-outro');
    expect(r.state.act).toBe(5);
    r = step(r.state, { kind: 'continue' }); // act-outro → act-intro(5)
    expect(r.state.phase.kind).toBe('act-intro');
    r = step(r.state, { kind: 'continue' }); // act-intro(5) → the Hollow battle
    expect(r.state.phase.kind).toBe('battle');
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.final).toBe(true);
      expect(r.state.phase.battle.boss?.bossId).toBe('hollow');
    }
  });

  it('reverence OUTWEIGHS cruelty at the gate → grace (3×2 + 1×−4 = 2 ≥ 1)', () => {
    const player = makePlayer({ xp: 1000 });
    const state: GameState = {
      version: 8,
      rngState: 5,
      player,
      act: 4,
      place: 3,
      karma: karmaOf({ reverenceDesecration: 2, mercyCruelty: -4 }),
      phase: { kind: 'main-menu' },
    };
    const r = step(state, { kind: 'menu', choice: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'verdict', outcome: 'grace' });
  });
});

describe('M12 two endings are distinct and both terminate', () => {
  it('grace and damnation carry distinct endingType + distinct placeholder prose', () => {
    const grace = getGraceEnding();
    const dam = getDamnationEnding();
    expect(grace.header).not.toBe(dam.header);
    expect(grace.body).not.toBe(dam.body);
  });
});

describe('M12 off-equivalence: a normal battle invokes no boss hook', () => {
  it('an ongoing normal round carries no boss and emits no boss events; a normal win → main-menu', () => {
    const player = makePlayer({ hp: 9999, maxHp: 9999 });
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(2));
    const battle: BattleState = { player, enemy: { ...enemy, hp: 50, maxHp: 50 }, act: 1, canFlee: true };
    const state: GameState = {
      version: 8,
      rngState: 9,
      player,
      act: 1,
      place: 0,
      karma: createKarma(),
      phase: { kind: 'battle', battle, started: true, final: false },
    };
    const r = step(state, { kind: 'battle-action', action: 'fight' });
    // Still fighting, no boss anywhere, no boss-mechanic events.
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.battle.boss).toBeUndefined();
    }
    const bossKinds = ['boss-summon', 'boss-minion-damage', 'boss-adapt'];
    expect(r.events.some((e) => bossKinds.includes(e.kind))).toBe(false);

    // A normal victory returns to the hub (no pending advance).
    const winState: GameState = {
      ...state,
      player: makePlayer({ xp: 0, level: 100 }),
      phase: { kind: 'battle-victory', final: false },
    };
    const w = step(winState, { kind: 'continue' });
    expect(w.state.phase.kind).toBe('main-menu');
    expect(w.state.pending).toBeUndefined();
  });
});

describe('M12 Reflection adaptation drives a disadvantaged player attack', () => {
  it('after REFLECTION_ADAPT_THRESHOLD fights, boss-adapt fires and the next attack is at disadvantage', () => {
    const player = makePlayer({ name: 'Zara', hp: 9999, maxHp: 9999 });
    // Enemy mirror kit = ['brace'] (0 damage, self-buff only) so the player never takes damage
    // or a condition that could alter its adv/dis — isolating the boss's own disadvantage effect.
    const enemy = {
      ...generateEnemy({ act: 2, type: BOSSES.reflection.name, playerXp: 0 }, mulberry32(1)),
      hp: 9999,
      maxHp: 9999,
      skillPool: ['brace'] as string[],
    };
    const battle: BattleState = {
      player,
      enemy,
      act: 2,
      canFlee: false,
      boss: { bossId: 'reflection', round: 0, adapted: false, actionTally: {} },
    };
    let r: StepResult = {
      state: {
        version: 8,
        rngState: 3,
        player,
        act: 2,
        place: 1,
        karma: createKarma(),
        phase: { kind: 'battle', battle, started: true, final: false },
      },
      events: [],
      awaiting: 'battle-action',
    };
    // Three fights reach the threshold; boss-adapt fires on the third.
    let adaptRound = -1;
    for (let i = 0; i < 3; i++) {
      r = step(r.state, { kind: 'battle-action', action: 'fight' });
      if (r.events.some((e) => e.kind === 'boss-adapt')) adaptRound = i;
    }
    expect(adaptRound).toBe(2); // the 3rd fight (0-indexed)
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.battle.player.advantageDisadvantage).toBe(-1);
    }
    // The very next attack rolls at disadvantage (the two-draw-take-min path in combat.ts).
    const next = step(r.state, { kind: 'battle-action', action: 'fight' });
    expect(next.events).toContainEqual({ kind: 'disadvantage', subject: 'player' });
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

// ------- Cast battle-action through `step` ------------------------------------

/** Build a started, non-final battle phase for a player vs a made enemy. */
function startedBattleState(player: Player, enemy: BattleState['enemy'], rngState: number): GameState {
  const battle: BattleState = { player, enemy, act: 1, canFlee: true };
  return {
    version: 8,
    rngState,
    player,
    act: 1,
    place: 0,
    karma: createKarma(),
    phase: { kind: 'battle', battle, started: true, final: false },
  };
}

describe('cast battle-action flows through step', () => {
  it('casting Ember deals skill damage, spends a charge, and applies burn to the enemy', () => {
    // Player granted Ember (M3 default pools are per-class kits; Ember is generic), 5
    // charges, INT 13 (mod 1, no augment -> +0 skill power). To keep the cast assertions
    // seed-independent now that the enemy rolls to hit (M4), the enemy carries a fresh
    // FREEZE (control): its condition tick sets the skip flag (0 draws, no save on onset),
    // so it never attacks — the whole step draws nothing and the player takes 0. ember
    // Pyro base 2 vs 0 resist -> 2. player 20-0=20 ; enemy 30-2=28 ; charge 5->4.
    const player = makePlayer({ hp: 20, maxHp: 20, skillCharges: 5, skillPool: ['ember'] });
    const enemy = {
      ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(5)),
      hp: 30,
      resistances: [0, 0, 0, 0, 0, 0, 0],
      skillPool: [] as string[],
      skillCharges: 0,
      activeConditions: [makeCondition('freeze')],
    };
    const state = startedBattleState(player, enemy, 123);
    const r = step(state, { kind: 'battle-action', action: { kind: 'cast', skillId: 'ember' } });

    expect(r.state.phase.kind).toBe('battle');
    if (r.state.phase.kind === 'battle') {
      const b = r.state.phase.battle;
      expect(b.player.hp).toBe(20); // enemy frozen -> skipped -> took 0
      expect(b.enemy.hp).toBe(28);
      expect(b.player.skillCharges).toBe(4);
      expect(b.enemy.activeConditions.some((c) => c.type === 'burn')).toBe(true);
    }
    // Ember deals 2 (the enemy fell 30 -> 28 above), carried on the event as one term.
    expect(r.events).toContainEqual({
      kind: 'skill-cast', subject: 'player', skillId: 'ember', name: 'Ember', damage: 2,
      damageSources: [{ kind: 'skill', amount: 2 }],
    });
    expect(r.events).toContainEqual({ kind: 'condition-applied', subject: 'enemy', conditionType: 'burn' });
  });

  it('a cast sequence is deterministic: revived-state step === live step (byte-identical)', () => {
    // Enemy has a Pyro Ball charge, so its skill-pick draw advances the rng — proving the
    // rngState round-trips through JSON and the cast round is reproducible.
    const player = makePlayer({ hp: 40, maxHp: 40, skillCharges: 5, skillPool: ['ember'] });
    const enemy = {
      ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(9)),
      hp: 30,
      resistances: [0, 0, 0, 0, 0, 0, 0],
      skillPool: ['pyroBall'],
      skillCharges: 2,
    };
    const state = startedBattleState(player, enemy, 55);
    const revived: GameState = JSON.parse(JSON.stringify(state));
    expect(revived).toEqual(state);

    const castInput: GameInput = { kind: 'battle-action', action: { kind: 'cast', skillId: 'ember' } };
    const a = step(state, castInput);
    const b = step(revived, castInput);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
    expect(a.state.rngState).not.toBe(state.rngState); // the enemy pick advanced the rng
  });
});

// ------- M8 spare / kill karma (INPUT only) ----------------------------------

describe('spare / moral-kill karma through step', () => {
  const NEUTRAL = createKarma();

  /** A ⚖ enemy (gangers family) with the given hp overrides. */
  function weightedEnemy(overrides: Partial<BattleState['enemy']> = {}): BattleState['enemy'] {
    return {
      ...generateEnemy({ act: 1, family: getFamily('gangers')!, playerXp: 0 }, mulberry32(1)),
      ...overrides,
    };
  }

  /** A non-⚖ enemy (securityDrones family). */
  function plainEnemy(overrides: Partial<BattleState['enemy']> = {}): BattleState['enemy'] {
    return {
      ...generateEnemy({ act: 1, family: getFamily('securityDrones')!, playerXp: 0 }, mulberry32(1)),
      ...overrides,
    };
  }

  it('sparing a ⚖ enemy returns to the hub, grants nothing, and records +1 mercy', () => {
    const player = makePlayer({ xp: 3 });
    const enemy = weightedEnemy({ hp: 30 });
    const state = startedBattleState(player, enemy, 42);
    const r = step(state, { kind: 'battle-action', action: 'spare' });

    expect(r.state.phase.kind).toBe('main-menu');
    // Hand-derived from KARMA_DELTAS.spareWeighted = { mercyCruelty: 1 }.
    expect(r.state.karma).toEqual({
      mercyCruelty: 1,
      restraintGreed: 0,
      reverenceDesecration: 0,
      clarityDelusion: 0,
    });
    // No victory: no XP, no loot event, the enemy was not defeated.
    expect(r.state.player?.xp).toBe(3);
    expect(r.events.some((e) => e.kind === 'victory')).toBe(false);
    expect(r.events).toContainEqual({ kind: 'spared', enemyName: enemy.fullName });
  });

  it('killing a ⚖ enemy records −1 mercy (cruelty), other axes unchanged', () => {
    const player = makePlayer({ hp: 9999, maxHp: 9999, advantageDisadvantage: 1 });
    const enemy = weightedEnemy({ hp: 1, maxHp: 1, armorClass: 1, skillPool: [], skillCharges: 0 });
    let state = startedBattleState(player, enemy, 7);
    // Fight until the battle resolves (a miss just loops; the enemy has 1 hp).
    let r = step(state, { kind: 'battle-action', action: 'fight' });
    let guard = 0;
    while (r.awaiting === 'battle-action' && guard < 50) {
      r = step(r.state, { kind: 'battle-action', action: 'fight' });
      guard++;
    }
    expect(r.state.phase.kind).toBe('battle-victory');
    expect(r.state.karma).toEqual({
      mercyCruelty: -1,
      restraintGreed: 0,
      reverenceDesecration: 0,
      clarityDelusion: 0,
    });
  });

  it('killing a non-⚖ enemy leaves all four karma axes neutral', () => {
    const player = makePlayer({ hp: 9999, maxHp: 9999, advantageDisadvantage: 1 });
    const enemy = plainEnemy({ hp: 1, maxHp: 1, armorClass: 1, skillPool: [], skillCharges: 0 });
    let r = step(startedBattleState(player, enemy, 7), { kind: 'battle-action', action: 'fight' });
    let guard = 0;
    while (r.awaiting === 'battle-action' && guard < 50) {
      r = step(r.state, { kind: 'battle-action', action: 'fight' });
      guard++;
    }
    expect(r.state.phase.kind).toBe('battle-victory');
    expect(r.state.karma).toEqual(NEUTRAL);
  });

  it('sparing a non-⚖ enemy is a no-op: battle continues, no karma, no rng consumed', () => {
    const player = makePlayer();
    const enemy = plainEnemy({ hp: 30 });
    const state = startedBattleState(player, enemy, 555);
    const r = step(state, { kind: 'battle-action', action: 'spare' });
    expect(r.state.phase.kind).toBe('battle'); // still fighting
    expect(r.state.karma).toEqual(NEUTRAL);
    expect(r.events).toContainEqual({ kind: 'spare-unavailable' });
    // Zero rng draws: the accumulator is unchanged.
    expect(r.state.rngState).toBe(state.rngState);
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
        // Under a control condition a potion is REJECTED (`potion-blocked`) and the rejection
        // advances nothing — no round resolves, so the condition never ticks down. A policy
        // that keeps choosing `potion` therefore spins in place forever. That is a
        // pre-existing property of the engine, deliberately so (G36: "a rejected press costs
        // nothing"), and `sim.ts`'s `chooseBattleAction` carries exactly this guard with
        // exactly this reasoning. This scripted policy lacked it; it only never hit the trap
        // because it drove a single seed. Fight instead — the swing is skipped, but the round
        // runs and the control wears off.
        if (!hasControlCondition(pl) && pl.pots > 0 && pl.hp <= pl.maxHp * 0.4) {
          return { kind: 'battle-action', action: 'potion' };
        }
      }
      return { kind: 'battle-action', action: 'fight' };
    }
    case 'draft-pick':
      return { kind: 'draft-pick', index: 0 }; // autopick the first offer
    case 'deal-decision':
      return { kind: 'deal-decision', accept: false };
    case 'rest-decision':
      return { kind: 'rest-decision', accept: true };
    case 'game-over':
      return { kind: 'continue' };
  }
}

function runPlaythrough(
  seed: number,
  unlocks?: RunUnlocks,
): { events: GameEvent[]; final: GameState; steps: number } {
  let r: StepResult = { state: createGame(seed, unlocks), events: [], awaiting: 'title' };
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

  });

  // M15 REBALANCE guard: a real scripted run can survive the descent and reach an ENDING (a
  // win) — previously (frozen M4/M5 balance) EVERY real seed died. The terminal signal for a
  // win is the `ending` event; the death path instead emits `game-over`.
  //
  // ⚠ CHANGED by #0a (G27/G31), deliberately, and this is why. This assertion used to ride on
  // the single seed 12345 above. That made it a one-seed coin flip on a property that is
  // statistical: seed 12345 happens no longer to win, because a rest that ONLY refills skill
  // charges now costs a rest — and this scripted policy never casts, so for IT the refill is
  // pure loss. That is a policy artifact, not an engine regression (`balance.test.ts`'s
  // 500-run win-rate guard is unmoved, and the seeds below still win). Re-pinning it to
  // whichever single seed happens to win today would be exactly the "edit the number until it
  // is green" move this repo forbids, so the guard is instead stated at the level it was
  // always about: SOME real seed wins. Against the pre-M15 world (0% win over every seed) it
  // is still red, and it no longer moves every time a rule shifts one seed's dice.
  it('a real scripted run can still WIN the descent (not every seed dies)', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => 12340 + i);
    const outcomes = seeds.map((s) => {
      const run = runPlaythrough(s);
      // Every seed must terminate cleanly, whatever its outcome.
      expect(run.final.phase.kind).toBe('game-over');
      const won = run.events.some((e) => e.kind === 'ending');
      // The two terminal signals are mutually exclusive: a win never emits `game-over`.
      expect(run.events.some((e) => e.kind === 'game-over')).toBe(!won);
      return won;
    });
    expect(outcomes.filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });
});

// ------- M13 gradual reveal + off-equivalence --------------------------------

/** The full unlock snapshot: every family + every affix (an "all unlocked" store). */
function fullSnapshot(): RunUnlocks {
  return { families: FAMILIES.map((f) => f.id), affixes: AFFIXES.map((a) => a.id) };
}

/**
 * Play a run and collect every family id an ordinary (non-boss) encounter drew — read from
 * the battle state as it is entered, the ground truth the encounter generator produced.
 */
function collectEncounterFamilies(seed: number, unlocks?: RunUnlocks): Set<string> {
  const seen = new Set<string>();
  let r: StepResult = { state: createGame(seed, unlocks), events: [], awaiting: 'title' };
  let guard = 0;
  while (r.awaiting !== 'game-over' && guard < 100000) {
    r = step(r.state, decide(r));
    const p = r.state.phase;
    if (p.kind === 'battle' && !p.started && !p.battle.boss) {
      seen.add(p.battle.enemy.familyId);
    }
    guard++;
  }
  return seen;
}

describe('M13 gradual bestiary reveal reads the run snapshot', () => {
  it('a default (front-load) snapshot never draws a long-tail family', () => {
    // Independent oracle: the plan's long-tail families must NEVER appear under the default
    // front-load snapshot; the front-load set is the only drawable pool.
    const snap = snapshotUnlocks(createUnlockStore());
    const frontLoad = new Set(snap.families);
    const longTail = ['cyberEnforcers', 'fixers', 'mirrorSelves', 'staticWraiths', 'dread', 'numbness', 'sevenSins', 'guardians', 'seraphWardens', 'voidHorrors', 'theUnmade', 'theHollowed'];
    const drawn = new Set<string>();
    for (let seed = 0; seed < 120; seed++) {
      for (const id of collectEncounterFamilies(seed, snap)) drawn.add(id);
    }
    // Something was actually drawn, and every drawn family is a front-load family.
    expect(drawn.size).toBeGreaterThan(0);
    for (const id of drawn) {
      expect(frontLoad.has(id)).toBe(true);
      expect(longTail).not.toContain(id);
    }
  });

  it('after unlocking the whole roster, long-tail families become drawable', () => {
    // With every family unlocked, the pool is the full act roster — long-tail families now
    // appear across seeds (proving the snapshot, not a hard-coded pool, gates the draw).
    const full = fullSnapshot();
    const drawn = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      for (const id of collectEncounterFamilies(seed, full)) drawn.add(id);
    }
    // At least one act-1 long-tail family (Cyber-Enforcers / Fixers) is now reachable.
    expect(drawn.has('cyberEnforcers') || drawn.has('fixers')).toBe(true);
  });
});

describe('M13 off-equivalence: an all-unlocked snapshot never perturbs the run', () => {
  it('a full-snapshot run is byte-identical to a no-snapshot run (events + final state)', () => {
    for (const seed of [12345, 777, 2026, 99]) {
      const bare = runPlaythrough(seed);
      const full = runPlaythrough(seed, fullSnapshot());
      // The snapshot presence must not add, drop, or reorder a single RNG draw.
      expect(JSON.stringify(full.events)).toBe(JSON.stringify(bare.events));
      // The final states match once the snapshot key (absent in the bare run) is disregarded.
      const stripped = { ...full.final };
      delete stripped.unlocks;
      expect(JSON.stringify(stripped)).toBe(JSON.stringify(bare.final));
    }
  });

  it('two runs with the same snapshot + inputs are identical (reproducible)', () => {
    const snap = snapshotUnlocks(createUnlockStore());
    const a = runPlaythrough(4242, snap);
    const b = runPlaythrough(4242, snap);
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(JSON.stringify(b.final)).toBe(JSON.stringify(a.final));
  });
});
