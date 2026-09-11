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
import { createBattle, type BattleState } from './battle.ts';
import { selectEncounter } from './encounter.ts';
import { buildDeal, selectPool } from './deal.ts';
import { FINAL_BOSS_NAME, FINAL_BOSS_XP, HOLLOW_GATE_XP } from './progression.ts';
import { BOSSES, KINGPIN_MINION_DAMAGE, type BossState } from './boss.ts';
import { getGraceEnding, getDamnationEnding } from './story.ts';
import { createRng, mulberry32 } from './rng.ts';
import { type Stats } from './character.ts';
import { createKarma, type KarmaState } from './karma.ts';
import { hasControlCondition, makeCondition } from './condition.ts';
import { resolveSkill, type SkillId } from './skill.ts';
import { generateDraft } from './draft.ts';
import { gearUpAtHub } from './sim.ts';
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
    // player-created + intro emitted; the intro carries no unsubstituted token.
    // CHANGED for G47 (2026-09-01) — this block also asserted `toContain('Zara')`. The
    // intro lines feed `describeEvent` and therefore the narrator's prompt, and
    // GAME-DESIGN.md §22.1 / WORLD.md §8 [LOCKED] rule that the narrator never speaks the
    // player's name, so `story.json` no longer carries a `{playerName}` token to
    // substitute. `substituteName` is unchanged and still runs over every intro line; the
    // name itself is proved to survive on its LABEL surface by the `player.name` check
    // above (line 116) and by `story.test.ts`'s G47 block.
    const created = r.events.find((e) => e.kind === 'player-created');
    expect(created).toBeDefined();
    const intro = r.events.find((e) => e.kind === 'intro');
    expect(intro).toBeDefined();
    if (intro && intro.kind === 'intro') {
      const joined = intro.lines.join('\n');
      expect(joined).not.toContain('{playerName}');
      expect(joined).not.toContain('Zara');
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

// Find rngStates that route the first encounter to each kind, on floor 1. selectEncounter is
// the first draw continueJourney makes (xp 0 keeps every gate shut), so this predicts the
// reducer exactly — the prediction reads the same pure helper, not the reducer's output.
function findEncounterSeeds(): { battle: number; rest: number; bargain: number; chest: number } {
  const found = { battle: -1, rest: -1, bargain: -1, chest: -1 };
  for (let s = 0; s < 500; s++) {
    const enc = selectEncounter(createRng(s).rng, 1);
    if (found[enc] < 0) found[enc] = s;
  }
  return found;
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
      // CHANGED by G12: the ambush bonus lives on the BATTLE now, not on the player, so it
      // cannot ride into the next fight via the hub write-back. Same +1, battle-scoped.
      expect(r.state.phase.battle.playerAdvantage).toBe(1);
      expect(r.state.phase.battle.player.advantageDisadvantage).toBe(0);
      const enemyName = r.state.phase.battle.enemy.fullName;
      expect(r.events).toContainEqual({ kind: 'encounter-start', enemyName });
    }
    // Starting the fight flips `started` and awaits a battle action.
    const r2 = step(r.state, { kind: 'continue' });
    expect(r2.awaiting).toBe('battle-action');
    if (r2.state.phase.kind === 'battle') expect(r2.state.phase.started).toBe(true);
  });

  it('PLAN.md #2: a found rest spot is TAKEN at once — no decision, awaiting only continue', () => {
    const player = makePlayer({ xp: 0, hp: 3, maxHp: 30 });
    const r = step(menuState(player, seeds.rest), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'rest' });
    expect(r.awaiting).toBe('rest');
    expect(r.events.map((e) => e.kind)).toEqual(['rest-found', 'rest-taken']);
    expect(r.state.player!.hp).toBeGreaterThan(3); // healed in the SAME step it was found
    // Continuing returns to the menu, and changes nothing else.
    const r2 = step(r.state, { kind: 'continue' });
    expect(r2.state.phase.kind).toBe('main-menu');
    expect(r2.state.player).toEqual(r.state.player);
  });

  it('PLAN.md #2: a bargain FINDS the player — continue can open a deal (§22.23)', () => {
    const player = makePlayer({ xp: 0 });
    const r = step(menuState(player, seeds.bargain), { kind: 'menu', choice: 'continue' });
    expect(r.state.phase.kind).toBe('deal');
    expect(r.awaiting).toBe('deal-decision');
    expect(r.events.map((e) => e.kind)).toEqual(['deal-offer']);
  });
});

// ------- Rest — a place you find (§22.26) --------------------------------------------------

describe('rest — found, taken at once, and calm whatever you arrive with', () => {
  const restSeed = findEncounterSeeds().rest;

  /** Find the rest spot from the hub (on `place`) and return that step. */
  function rest(player: Player, place = 0): StepResult {
    const state: GameState = { ...menuState(player, restSeed), act: place + 1, place };
    return step(state, { kind: 'menu', choice: 'continue' });
  }

  it('heals within [10, 10 + floor(xp/4)] (the ONE draw after the encounter draw), capped at maxHp', () => {
    // xp 40 is below the act-2 gate? No — the act-1 gate is 10 xp, so a hub at xp 40 would
    // enter the Kingpin. The rest is therefore driven with xp 8 (gate shut): the heal is
    // 10 + floor(x * (floor(8/4) + 1)) = 10 + floor(x * 3), x = the SECOND draw of the step.
    const player = makePlayer({ xp: 8, hp: 5, maxHp: 50 });
    const r = rest(player);
    const { rng } = createRng(restSeed);
    rng(); // the encounter draw
    const expectedHeal = 10 + Math.floor(rng() * (Math.floor(8 / 4) + 1));
    expect(r.events).toContainEqual({ kind: 'rest-taken', hpRestored: expectedHeal, hp: 5 + expectedHeal, maxHp: 50 });
    expect(expectedHeal).toBeGreaterThanOrEqual(10);
    expect(expectedHeal).toBeLessThanOrEqual(12);
  });

  it('G27/G31 — it clears every condition AND refills skill charges', () => {
    const player = makePlayer({
      xp: 0, hp: 5, maxHp: 50,
      skillCharges: 0,
      activeConditions: [makeCondition('fracture'), makeCondition('poison')],
    });
    const r = rest(player);
    expect(r.state.player?.activeConditions).toEqual([]);
    expect(r.state.player?.skillCharges).toBe(player.maxSkillCharges);
  });

  it('Appendix A.2 — at FULL health it still happens: charges refill, and nothing is refused', () => {
    // "A rest that makes you choose is not calm" — there is no `rest-full` any more.
    const player = makePlayer({ xp: 0, hp: 50, maxHp: 50, skillCharges: 1 });
    const r = rest(player);
    expect(r.events.map((e) => e.kind)).toEqual(['rest-found', 'rest-taken']);
    expect(r.state.player?.hp).toBe(50); // capped
    expect(r.state.player?.skillCharges).toBe(player.maxSkillCharges);
  });

  it('rest-found names the floor, the brief’s place and its id — keyed on the FLOOR', () => {
    const r = rest(makePlayer({ xp: 0 }), 2);
    const found = r.events.find((e) => e.kind === 'rest-found');
    expect(found).toMatchObject({ kind: 'rest-found', floor: 3, briefId: 'floor-3' });
    expect(found && found.kind === 'rest-found' && found.place.length).toBeGreaterThan(0);
  });

  it('AC-14 — on floor 3 the rest restores floor(h x 50 / 100) of the drawn heal', () => {
    // Same seed on floor 1 and floor 3 (the encounter draw is the same one-in-weights value on
    // both, since their weights match): h is drawn identically, and floor 3 keeps half.
    const player = makePlayer({ xp: 8, hp: 5, maxHp: 50 });
    const { rng } = createRng(restSeed);
    rng();
    const h = 10 + Math.floor(rng() * 3);
    const one = rest(player, 0).events.find((e) => e.kind === 'rest-taken');
    const three = rest(player, 2).events.find((e) => e.kind === 'rest-taken');
    expect(one).toMatchObject({ hpRestored: h });
    expect(three).toMatchObject({ hpRestored: Math.floor((h * 50) / 100) });
  });
});

// ------- Sacrifice deal — now a descent encounter (§22.23) ---------------------------------

describe('sacrifice deal (found on the descent, never summoned)', () => {
  const bargainSeed = findEncounterSeeds().bargain;

  it('opens a deal matching buildDeal(karma, floor, rng) from the draw after the encounter', () => {
    const player = makePlayer({ xp: 0 });
    // Independently derive the deal: the encounter draw first, then buildDeal's draws.
    const { rng } = createRng(bargainSeed);
    rng();
    const expected = buildDeal(createKarma(), 1, rng);
    const r = step(menuState(player, bargainSeed), { kind: 'menu', choice: 'continue' });
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
    const player = makePlayer({ xp: 0 });
    const r = step(menuState(player, bargainSeed), { kind: 'menu', choice: 'continue' });
    const r2 = step(r.state, { kind: 'deal-decision', accept: true });
    expect(r2.state.phase.kind).toBe('main-menu');
    expect(r2.events.some((e) => e.kind === 'deal-taken' || e.kind === 'deal-unaffordable')).toBe(true);
    expect('gold' in (r2.state.player ?? {})).toBe(false);
  });

  it('declining leaves player and karma unchanged and returns to the hub', () => {
    const player = makePlayer({ xp: 0 });
    const state = menuState(player, bargainSeed);
    const r = step(state, { kind: 'menu', choice: 'continue' });
    const r2 = step(r.state, { kind: 'deal-decision', accept: false });
    expect(r2.events.some((e) => e.kind === 'deal-declined')).toBe(true);
    expect(r2.state.phase.kind).toBe('main-menu');
    expect(r2.state.player).toEqual(player);
    expect(r2.state.karma).toEqual(state.karma);
  });

  it('AC-22 — the hub CANNOT summon a bargain: a stray seek-deal is a rejected no-op', () => {
    // Type level: the menu choice is 'continue' | 'quit' — 'seek-deal' does not compile.
    type MenuChoice = Extract<GameInput, { kind: 'menu' }>['choice'];
    const noSeek: 'seek-deal' extends MenuChoice ? false : true = true;
    expect(noSeek).toBe(true);
    // Runtime: an input from an OLD renderer is refused and changes nothing (the reducer is total).
    const state = menuState(makePlayer({ xp: 0 }), bargainSeed);
    const r = step(state, { kind: 'menu', choice: 'seek-deal' } as unknown as GameInput);
    expect(r.state.phase.kind).not.toBe('deal');
  });
});

// ------- Chest encounter -----------------------------------------------------

describe('chest encounter', () => {
  // The first rngState whose encounter draw lands in floor 1's chest band (found through the
  // pure `selectEncounter`, not the reducer). xp 0 so no act gate fires first. The chest loot
  // lands in the backpack. (PLAN.md #2: the fixed seed 4 no longer lands on a chest — the table
  // is floors.json's weights now, and 4 draws a bargain.)
  it('main-menu continue can open a chest, depositing rolled loot into the backpack', () => {
    const player = makePlayer({ xp: 0 });
    const before = player.inventory.backpack.length;
    const r = step(menuState(player, findEncounterSeeds().chest), { kind: 'menu', choice: 'continue' });
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
  /** A hub state on floor 5 at the given XP. */
  function act5Hub(xp: number, rngState = 314): GameState {
    return {
      version: 8,
      rngState,
      player: makePlayer({ skillPool: ['heavyStrike', 'brace'], xp }),
      act: 5,
      place: 4,
      karma: createKarma(),
      phase: { kind: 'main-menu' },
    };
  }

  // ⚠ CHANGED by G43, and this is the defect, not a preference. This case used to assert
  // "act-intro{5} continue builds the HOLLOW SELF" — i.e. it asserted the bug: the Hollow was
  // hard-wired to floor ENTRY. `main-menu` is the only phase that calls `continueJourney`,
  // which is the only caller of `buildRandomBattle`, `buildChestLoot` and `selectLore`, so
  // going straight from the act intro into the boss meant floor 5 had NO random battles, NO
  // chests, NO rests, NO sacrifice-deals and NO lore. Measured: an exhaustive input-space walk
  // over 418 act-5 entries (~17.7 M probed transitions) produced ZERO act-5 hub states, and a
  // 150-run campaign met 0 of 5 act-5 families while the unlock store had granted all of them.
  // The Hollow is now the END of floor 5, gated like every other floor's boss.
  it('act-intro{5} continue returns to the HUB, exactly like every other act intro', () => {
    const state: GameState = { ...act5Hub(0), phase: { kind: 'act-intro', newAct: 5 } };
    const r = step(state, { kind: 'continue' });
    expect(r.state.phase).toEqual({ kind: 'main-menu' });
    expect(r.awaiting).toBe('main-menu');
    expect(r.events.some((e) => e.kind === 'final-battle-begins')).toBe(false);
  });

  it('below the gate, the act-5 hub yields ORDINARY encounters — never the Hollow', () => {
    expect(HOLLOW_GATE_XP).toBe(500); // the premise, restated
    let sawBattle = false;
    let sawRest = false;
    let sawChest = false;
    const families = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const r = step(act5Hub(HOLLOW_GATE_XP - 1, seed), { kind: 'menu', choice: 'continue' });
      expect(r.events.some((e) => e.kind === 'final-battle-begins')).toBe(false);
      if (r.state.phase.kind === 'battle') {
        expect(r.state.phase.final).toBe(false);
        expect(r.state.phase.battle.boss).toBeUndefined();
        // §14.9 "there is nowhere to go": act-5 trash still cannot be fled. That rule was
        // dead code until now, because act 5 had no random encounters at all.
        expect(r.state.phase.battle.canFlee).toBe(false);
        families.add(r.state.phase.battle.enemy.familyId);
        sawBattle = true;
      } else if (r.state.phase.kind === 'rest') sawRest = true;
      else if (r.state.phase.kind === 'chest') sawChest = true;
    }
    // All three encounter kinds are reachable on floor 5…
    expect(sawBattle).toBe(true);
    expect(sawRest).toBe(true);
    expect(sawChest).toBe(true);
    // …and every one of the five act-5 families can finally be met (previously 0 of 5).
    const act5Families = FAMILIES.filter((f) => f.floor === 5).map((f) => f.id);
    expect(act5Families).toHaveLength(5);
    for (const id of act5Families) expect(families).toContain(id);
  });

  it('at the gate, the act-5 hub builds the HOLLOW SELF (replacing Jorginho)', () => {
    const state = act5Hub(HOLLOW_GATE_XP);
    const player = state.player!;
    const r = step(state, { kind: 'menu', choice: 'continue' });
    expect(r.state.phase.kind).toBe('battle');
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.final).toBe(true);
      expect(r.state.phase.started).toBe(false);
      expect(r.state.phase.battle.canFlee).toBe(false); // Act 5 + a boss: no escape
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

  it('the Hollow is re-fightable once the gate is open (G39 soft-lock is gone)', () => {
    // Fleeing the Hollow used to strand the run forever, because the boss was constructed
    // ONLY at floor entry. Now the gate re-opens it from the hub on the next continue.
    const first = step(act5Hub(HOLLOW_GATE_XP, 7), { kind: 'menu', choice: 'continue' });
    expect(first.state.phase.kind).toBe('battle');
    const backAtHub: GameState = { ...first.state, phase: { kind: 'main-menu' } };
    const second = step(backAtHub, { kind: 'menu', choice: 'continue' });
    expect(second.state.phase.kind).toBe('battle');
    if (second.state.phase.kind === 'battle') {
      expect(second.state.phase.final).toBe(true);
      expect(second.state.phase.battle.boss?.bossId).toBe('hollow');
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
    // CHANGED by G43: act-intro(5) now returns to the HUB like every other act intro, and the
    // Hollow waits behind floor 5's own XP gate. The routing this case is really about — a
    // cast-down verdict falls to act 5 — is unchanged; what changed is that the player now
    // gets to PLAY floor 5 first. This fixture's player is at xp 1000, well past
    // HOLLOW_GATE_XP, so one more continue from the hub reaches the Hollow.
    r = step(r.state, { kind: 'continue' }); // act-intro(5) → the act-5 hub
    expect(r.state.phase).toEqual({ kind: 'main-menu' });
    r = step(r.state, { kind: 'menu', choice: 'continue' }); // hub → the Hollow (gate open)
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

// ------- G36 — a rejected press must not advance the boss -----------------------------------

/** A started boss battle sitting at `battle-action`, ready to be pressed at. */
function bossBattleState(
  boss: BossState,
  act: number,
  player: Player,
  rngState = 3,
  /** Mid-battle patch applied AFTER the transient funnel (e.g. a live shield). */
  patchPlayer: Partial<Player> = {},
): StepResult {
  const enemy = generateEnemy(
    { act, type: BOSSES[boss.bossId].name, playerXp: 0 },
    mulberry32(1),
  );
  const built = createBattle(player, enemy, act, { boss });
  const battle: BattleState = { ...built, player: { ...built.player, ...patchPlayer } };
  return {
    state: {
      version: 8,
      rngState,
      player,
      act,
      place: act - 1,
      karma: createKarma(),
      phase: { kind: 'battle', battle, started: true, final: false },
    },
    events: [],
    awaiting: 'battle-action',
  };
}

describe('G29 — boss-minion damage reaches the player THROUGH game.ts, guarded', () => {
  // The unit's named G29 tests drive the `applyDamageToBattlePlayer` helper directly, and the
  // G36 tests assert minion damage is ZERO. Neither proves the SHIPPING WIRING in `game.ts`
  // actually applies it — that was caught only by `offEquivalence.test.ts`'s byte-identity
  // replay, and that file is re-baselined by design whenever behaviour moves, so the guard
  // would evaporate at the next re-baseline. These are the positive end-to-end assertions.
  //
  // Every case uses `potion` as the action, which is the one action that RESOLVES a round
  // (so the boss mechanic runs) while granting the enemy NO turn — so the player's HP after
  // the step is the potion heal minus the minion damage and nothing else. It also draws no
  // rng, and `bossPostRound` is RNG-free, so these are deterministic whatever the seed.
  //
  // The Kingpin's cadence summons on round 3, so each fixture starts with `minions: 2`
  // already on the field: round 1 then does `2 x KINGPIN_MINION_DAMAGE` = 2 damage with no
  // summon (1 % 3 !== 0), which isolates the damage from the summon.
  const kingpinWithCrew = (): BossState => ({ bossId: 'kingpin', round: 0, minions: 2 });

  // PLAN.md #2 / §22.6: these used the POTION as the round's RNG-free action; the potion is
  // gone, and the Void Draught (100% of max HP, no enemy turn, no draw) takes its place. A fresh
  // character carries one at backpack index 0 (`STARTING_CONSUMABLES`).
  const DRAUGHT = { kind: 'battle-action', action: { kind: 'useConsumable', source: { index: 0 } } } as const;

  it('the damage lands on HP: a Void Draught heals 10 -> 20, then the crew takes it to 18', () => {
    expect(KINGPIN_MINION_DAMAGE).toBe(1); // the constant behind the "2", restated
    const player = makePlayer({ hp: 10, maxHp: 20 });
    expect(player.inventory.backpack[0]).toEqual({ defId: 'void-draught' });
    const r = step(bossBattleState(kingpinWithCrew(), 1, player).state, DRAUGHT);
    expect(r.events).toContainEqual({ kind: 'consumable-used', itemId: 'void-draught' });
    expect(r.events).toContainEqual({ kind: 'boss-minion-damage', amount: 2 });
    expect(r.state.phase.kind).toBe('battle');
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.battle.player.hp).toBe(18); // 20 healed - 2 minions
      expect(r.state.phase.battle.player.inventory.backpack).toEqual([{ defId: 'suture-kit' }]);
      expect(r.state.phase.battle.boss?.minions).toBe(2); // no summon on round 1
    }
  });

  it('it goes through the GUARDED path — a shield absorbs it, exactly as in a normal round', () => {
    // This is the actual content of G29: `boss.ts` used to write `player.hp` directly, so a
    // 20-point shield absorbed NOTHING at the death `BALANCE-REPORT.md` says happens most.
    const player = makePlayer({ hp: 10, maxHp: 20 });
    const r = step(bossBattleState(kingpinWithCrew(), 1, player, 3, { shield: 5 }).state, DRAUGHT);
    expect(r.events).toContainEqual({ kind: 'shield-absorbed', amount: 2 });
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.battle.player.hp).toBe(20); // the shield ate all of it
      expect(r.state.phase.battle.player.shield).toBe(3); // 5 - 2
    }
  });

  it('and the once-per-battle revive intercepts a LETHAL crew tick', () => {
    // maxHp 2 so the draught tops out at 2 and the crew's 2 is lethal. Halo Fragment heals to
    // max(floor(2 * 25/100), 1) = max(0, 1) = 1 — the documented floor.
    const base = makePlayer({ hp: 1, maxHp: 2 });
    const haloed: Player = {
      ...base,
      inventory: {
        ...base.inventory,
        slots: { ...base.inventory.slots, amulet: { defId: 'halo-fragment' } },
      },
    };
    const r = step(bossBattleState(kingpinWithCrew(), 1, haloed).state, DRAUGHT);
    expect(r.events).toContainEqual({ kind: 'revive', healedTo: 1 });
    expect(r.state.phase.kind).toBe('battle'); // survived
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.battle.player.hp).toBe(1);
      expect(r.state.phase.battle.reviveUsed).toBe(true);
    }
  });

  it('without a revive the same lethal tick ends the run — game.ts owns the death now', () => {
    // `bossPostRound` no longer decides this; it returns a number and `game.ts` resolves it.
    const player = makePlayer({ hp: 1, maxHp: 2 });
    const r = step(bossBattleState(kingpinWithCrew(), 1, player).state, DRAUGHT);
    expect(r.events).toContainEqual({ kind: 'defeat' });
    expect(r.state.phase.kind).toBe('game-over');
    expect(r.awaiting).toBe('game-over');
    expect(r.events.some((e) => e.kind === 'game-over')).toBe(true);
  });
});

describe('G36 — pressing a button the engine refuses costs nothing', () => {
  it('nine rejected Run presses against the Kingpin cost 0 HP and summon 0 minions', () => {
    // The register's measurement: the Run button is rendered in EVERY battle and a boss sets
    // `canFlee: false`, so nine refused presses cost the player 11 HP to minions that the
    // Kingpin's per-round mechanic had no business summoning. The refusal is now `resolved:
    // false`, so `game.ts` skips `bossPostRound` entirely.
    const player = makePlayer({ hp: 20, maxHp: 20 });
    let r = bossBattleState({ bossId: 'kingpin', round: 0, minions: 0 }, 1, player);
    for (let i = 0; i < 9; i++) {
      r = step(r.state, { kind: 'battle-action', action: 'run' });
      expect(r.events).toEqual([{ kind: 'escape-impossible' }]);
    }
    expect(r.state.phase.kind).toBe('battle');
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.battle.player.hp).toBe(20); // pre-fix: 9 (11 HP of minion damage)
      expect(r.state.phase.battle.boss?.minions).toBe(0);
      expect(r.state.phase.battle.boss?.round).toBe(0); // the boss never even advanced a round
    }
  });

  it("three rejected casts leave the Reflection's once-per-battle adaptation unused", () => {
    // Worse than HP: three REJECTED casts used to burn the adapt, permanently disadvantaging
    // the player for pressing a button the engine had just told them did nothing.
    const player = makePlayer({ hp: 200, maxHp: 200, skillPool: [] }); // owns nothing to cast
    let r = bossBattleState(
      { bossId: 'reflection', round: 0, adapted: false, actionTally: {} },
      2,
      player,
    );
    for (let i = 0; i < 3; i++) {
      r = step(r.state, { kind: 'battle-action', action: { kind: 'cast', skillId: 'heavyStrike' } });
      expect(r.events).toEqual([{ kind: 'cast-unavailable' }]);
    }
    if (r.state.phase.kind === 'battle') {
      expect(r.state.phase.battle.boss?.adapted).toBe(false);
      expect(r.state.phase.battle.boss?.actionTally).toEqual({});
      expect(r.state.phase.battle.playerAdvantage).toBeUndefined();
    }
    expect(r.events.some((e) => e.kind === 'boss-adapt')).toBe(false);
  });

  it('a REAL round against the same boss still advances its mechanic', () => {
    // The guard must not have turned the boss off: three real fights DO reach the threshold.
    const player = makePlayer({ hp: 9999, maxHp: 9999 });
    let r = bossBattleState(
      { bossId: 'reflection', round: 0, adapted: false, actionTally: {} },
      2,
      player,
    );
    let adapted = false;
    for (let i = 0; i < 3; i++) {
      r = step(r.state, { kind: 'battle-action', action: 'fight' });
      if (r.events.some((e) => e.kind === 'boss-adapt')) adapted = true;
    }
    expect(adapted).toBe(true);
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
      // CHANGED by G12: the adaptation is battle-scoped, so it is read off the battle. Written
      // onto the player it outlived the fight and disadvantaged the whole run.
      expect(r.state.phase.battle.playerAdvantage).toBe(-1);
      expect(r.state.phase.battle.player.advantageDisadvantage).toBe(0);
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
        if (!hasControlCondition(pl)) {
          // PLAN.md #2 / §22.6: a found healing consumable in place of the retired potion.
          const heal = pl.inventory.backpack.findIndex((i) => i.defId === 'void-draught' || i.defId === 'suture-kit');
          if (heal >= 0 && pl.hp <= pl.maxHp * 0.4) {
            return { kind: 'battle-action', action: { kind: 'useConsumable', source: { index: heal } } };
          }
          // G43: this driver used to fight and drink and NOTHING else. With floor 5 turned
          // from a single boss into a real floor behind an XP gate, a driver that never uses
          // its class skills cannot finish the descent at all — measured over 120 seeds it
          // wins 0 and tops out at 494 xp against a 600 gate, dying on floor 5. That is not a
          // regression, it is `GAME-DESIGN.md` §18.1 in action ("classes stop playing like
          // themselves" without their charges); the fix is for the driver to PLAY, not for
          // the guard to be lowered. It now casts an affordable damage skill when it has one,
          // which is the same shape as `sim.ts`'s heuristic.
          for (const raw of pl.skillPool) {
            const id = raw as SkillId;
            const def = resolveSkill(pl, id);
            if (def && def.baseDamage >= 2 && pl.skillCharges >= def.chargeCost) {
              return { kind: 'battle-action', action: { kind: 'cast', skillId: id } };
            }
          }
        }
      }
      return { kind: 'battle-action', action: 'fight' };
    }
    case 'draft-pick':
      return { kind: 'draft-pick', index: 0 }; // autopick the first offer
    case 'deal-decision':
      return { kind: 'deal-decision', accept: false };
    case 'rest':
      return { kind: 'continue' }; // PLAN.md #2: a found rest was taken already
    case 'deal-discard':
      return { kind: 'deal-decision', accept: false }; // never reached: this driver refuses deals
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
    // PLAN.md #2: the driver now EQUIPS what it finds at the hub, with the sim's own rule
    // (`gearUpAtHub`, outside `step` exactly as the UI's Equip button). The G43 precedent
    // below applies again: when floor 2's illusions (a pure HP cost, Appendix A.1) made a
    // driver that fought in starting gear unable to win any of these 20 seeds, the fix was
    // for the driver to PLAY — not to lower the guard or re-pick the seeds.
    if (r.awaiting === 'main-menu') r = { ...r, state: gearUpAtHub(r.state) };
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

// ------- G45 — `step` is total, including for a type-legal non-integer index -------------------

describe('G45 — a non-integer draft-pick index is a no-op, not a crash', () => {
  it('1.5, 0.5, 2.5 and NaN return the state unchanged with no events', () => {
    // `step` documents itself as TOTAL, but the draft-pick guard checked only the two bounds.
    // `offers[1.5]` is `undefined`, the `!` assertion hid it, and `applyDraftOption` then
    // dereferenced `option.kind`. Reproduced by the register: 0 / -1 / 3 / Infinity / 1e21
    // were clean; 1.5, 0.5, 2.5 and NaN threw a TypeError. NaN is its own case — every
    // comparison with NaN is false, so it defeats a bounds test on its own.
    const player = makePlayer();
    const base = menuState(player, 11);
    const draft = step(
      { ...base, phase: { kind: 'level-up-draft', offers: generateDraft(player, mulberry32(3)) } },
      { kind: 'continue' }, // wrong input: a no-op that leaves the draft phase in place
    ).state;
    if (draft.phase.kind !== 'level-up-draft') throw new Error('expected a draft phase');
    expect(draft.phase.offers).toHaveLength(3);

    for (const index of [1.5, 0.5, 2.5, NaN, -0.5, 2.0000001]) {
      const r = step(draft, { kind: 'draft-pick', index });
      expect(r.state, `index ${index}`).toBe(draft); // same reference: untouched
      expect(r.events, `index ${index}`).toEqual([]);
      expect(r.awaiting, `index ${index}`).toBe('draft-pick');
    }
  });

  it('the integer indices it always accepted or rejected still behave identically', () => {
    const player = makePlayer();
    const base = menuState(player, 11);
    const offers = generateDraft(player, mulberry32(3));
    const draft: GameState = { ...base, phase: { kind: 'level-up-draft', offers } };
    // Out of range -> no-op (unchanged behaviour).
    for (const index of [-1, 3, Infinity, 1e21]) {
      const r = step(draft, { kind: 'draft-pick', index });
      expect(r.state, `index ${index}`).toBe(draft);
    }
    // In range -> the pick applies (unchanged behaviour).
    const ok = step(draft, { kind: 'draft-pick', index: 0 });
    expect(ok.state.phase.kind).toBe('level-up-result');
    expect(ok.events.some((e) => e.kind === 'draft-picked')).toBe(true);
  });
});
