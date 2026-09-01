import { describe, expect, it } from 'vitest';
import {
  BOSSES,
  GATE_THRESHOLD,
  GATE_WEIGHTS,
  HOLLOW_HP_SCALE,
  KINGPIN_MAX_MINIONS,
  KINGPIN_MINION_DAMAGE,
  KINGPIN_SUMMON_EVERY_ROUNDS,
  REFLECTION_ADAPT_THRESHOLD,
  SIN_AXIS_PRIORITY,
  SIN_BY_AXIS,
  SIN_DEFAULT_AXIS,
  SIN_HP_PER_POINT,
  bossPostRound,
  computeVerdict,
  generateBoss,
  pickIndulgedAxis,
  type BossState,
} from './boss.ts';
import { createPlayer, type Player } from './player.ts';
import { createKarma, type KarmaState } from './karma.ts';
import { generateEnemy } from './enemy.ts';
import { computeStatMods, type Stats } from './character.ts';
import { createBattle, type BattleState } from './battle.ts';
import { mulberry32 } from './rng.ts';
import { FINAL_BOSS_XP } from './progression.ts';

// ------- Fixtures ------------------------------------------------------------

function baseStats(): Stats {
  return { STR: 15, DEX: 12, CON: 14, INT: 10, WIS: 11, CHA: 13 };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: baseStats() }),
    ...overrides,
  };
}

function karma(partial: Partial<KarmaState>): KarmaState {
  return { ...createKarma(), ...partial };
}

// ------- Verdict math (hand-derived from the weighted-sum formula) -----------

describe('computeVerdict — the karma verdict gate', () => {
  it('weights reverence↔desecration heaviest (×3), the other axes ×1', () => {
    // Independently re-stated from the spec, not read from the impl.
    expect(GATE_WEIGHTS).toEqual({
      reverenceDesecration: 3,
      mercyCruelty: 1,
      restraintGreed: 1,
      clarityDelusion: 1,
    });
    expect(GATE_THRESHOLD).toBe(1);
  });

  it('a reverence-positive run earns GRACE (sum = 3×2 = 6 ≥ 1)', () => {
    expect(computeVerdict(karma({ reverenceDesecration: 2 }))).toBe('grace');
  });

  it('a neutral all-zero run is CAST-DOWN (sum 0 < 1)', () => {
    expect(computeVerdict(createKarma())).toBe('cast-down');
  });

  it('a desecration-negative run is CAST-DOWN (sum = 3×−1 = −3 < 1)', () => {
    expect(computeVerdict(karma({ reverenceDesecration: -1 }))).toBe('cast-down');
  });

  it('high reverence OUTWEIGHS high cruelty → GRACE (3×2 + 1×−4 = 2 ≥ 1)', () => {
    // Proves reverence dominance: +2 reverence (×3 = +6) beats −4 cruelty (×1 = −4).
    expect(computeVerdict(karma({ reverenceDesecration: 2, mercyCruelty: -4 }))).toBe('grace');
  });

  it('exactly at the threshold earns GRACE (a single +1 on a ×1 axis: sum 1 ≥ 1)', () => {
    expect(computeVerdict(karma({ restraintGreed: 1 }))).toBe('grace');
  });

  it('one below the threshold is CAST-DOWN (mixed sum 0: +1 reverence×3 = 3, −3 greed×1 = −3)', () => {
    // 3×1 + 1×(−3) = 0 < 1.
    expect(computeVerdict(karma({ reverenceDesecration: 1, restraintGreed: -3 }))).toBe('cast-down');
  });

  it('NEVER emits a karma value — its output is only the outcome string', () => {
    const out = computeVerdict(karma({ mercyCruelty: -5, reverenceDesecration: 3 }));
    expect(typeof out).toBe('string');
    expect(['grace', 'cast-down']).toContain(out);
  });
});

// ------- Indulged-axis selection ---------------------------------------------

describe('pickIndulgedAxis', () => {
  it('selects the single most-negative (most-indulged) axis', () => {
    expect(pickIndulgedAxis(karma({ mercyCruelty: -3, restraintGreed: -1 }))).toBe('mercyCruelty');
    expect(pickIndulgedAxis(karma({ clarityDelusion: -4, mercyCruelty: -2 }))).toBe('clarityDelusion');
  });

  it('breaks a tie by SIN_AXIS_PRIORITY (reverence, mercy, greed, clarity)', () => {
    // reverence & mercy both at −2 → reverence wins (higher priority).
    expect(pickIndulgedAxis(karma({ reverenceDesecration: -2, mercyCruelty: -2 }))).toBe(
      'reverenceDesecration',
    );
    // mercy & clarity both at −2 → mercy wins.
    expect(pickIndulgedAxis(karma({ mercyCruelty: -2, clarityDelusion: -2 }))).toBe('mercyCruelty');
    expect(SIN_AXIS_PRIORITY[0]).toBe('reverenceDesecration');
  });

  it('returns the documented default when nothing was indulged (every axis ≥ 0)', () => {
    expect(pickIndulgedAxis(createKarma())).toBe(SIN_DEFAULT_AXIS);
    expect(pickIndulgedAxis(karma({ reverenceDesecration: 3, mercyCruelty: 2 }))).toBe(
      SIN_DEFAULT_AXIS,
    );
    expect(SIN_DEFAULT_AXIS).toBe('reverenceDesecration');
  });
});

// ------- F3 Sin: identity by karma + HP scaling ------------------------------

describe('generateBoss — Sin identity + scaling by the indulged axis', () => {
  it('selects the Sin identity from SIN_BY_AXIS[mostIndulgedAxis]', () => {
    const player = makePlayer();
    const g = generateBoss({
      bossId: 'sin',
      act: 3,
      player,
      karma: karma({ mercyCruelty: -3 }),
      rng: mulberry32(99),
    });
    expect(g.boss.bossId).toBe('sin');
    expect(g.enemy.fullName).toBe(SIN_BY_AXIS.mercyCruelty.name);
    expect(g.enemy.type).toBe(SIN_BY_AXIS.mercyCruelty.name);
  });

  it('an all-non-negative karma picks the default-axis Sin', () => {
    const player = makePlayer();
    const g = generateBoss({ bossId: 'sin', act: 3, player, karma: createKarma(), rng: mulberry32(7) });
    expect(g.enemy.fullName).toBe(SIN_BY_AXIS[SIN_DEFAULT_AXIS].name);
  });

  it('bonus HP delta between two magnitudes equals Δmagnitude × SIN_HP_PER_POINT', () => {
    // Same seed + player + act + boss ⇒ identical base enemy; only the axis MAGNITUDE differs.
    // magnitude = max(0, -karma[axis]); here m1 = 2, m2 = 5 on the SAME axis, so
    // ΔHP = (5 − 2) × SIN_HP_PER_POINT, on both maxHp and hp — hand-derived, not read back.
    const player = makePlayer();
    const SEED = 4242;
    const g1 = generateBoss({
      bossId: 'sin',
      act: 3,
      player,
      karma: karma({ mercyCruelty: -2 }),
      rng: mulberry32(SEED),
    });
    const g2 = generateBoss({
      bossId: 'sin',
      act: 3,
      player,
      karma: karma({ mercyCruelty: -5 }),
      rng: mulberry32(SEED),
    });
    expect(g2.enemy.maxHp - g1.enemy.maxHp).toBe((5 - 2) * SIN_HP_PER_POINT);
    expect(g2.enemy.hp - g1.enemy.hp).toBe((5 - 2) * SIN_HP_PER_POINT);
    // And the exact bonus over the shared base (base derived independently below).
    const base = generateEnemy({ act: 3, type: BOSSES.sin.name, playerXp: player.xp }, mulberry32(SEED));
    expect(g1.enemy.maxHp).toBe(base.maxHp + 2 * SIN_HP_PER_POINT);
  });

  it('is deterministic: same karma + seed + player ⇒ identical boss', () => {
    const player = makePlayer();
    const args = { bossId: 'sin' as const, act: 3, player, karma: karma({ restraintGreed: -4 }) };
    const a = generateBoss({ ...args, rng: mulberry32(555) });
    const b = generateBoss({ ...args, rng: mulberry32(555) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a boss is never karma-weighted (no spare fork)', () => {
    const player = makePlayer();
    const g = generateBoss({ bossId: 'sin', act: 3, player, karma: createKarma(), rng: mulberry32(1) });
    expect(g.enemy.karmaWeighted).toBe(false);
  });
});

// ------- F2 Reflection mirror ------------------------------------------------

describe('generateBoss — Reflection mirrors the player kit', () => {
  it("skillPool deep-equals the player's skillPool (a distinct copy)", () => {
    const player = makePlayer({ skillPool: ['heavyStrike', 'brace', 'execute'] });
    const g = generateBoss({ bossId: 'reflection', act: 2, player, karma: createKarma(), rng: mulberry32(3) });
    expect(g.enemy.skillPool).toEqual(player.skillPool);
    expect(g.enemy.skillPool).not.toBe(player.skillPool); // a copy, not the same array
    expect(g.boss.adapted).toBe(false);
    expect(g.boss.actionTally).toEqual({});
  });
});

// ------- F5 Hollow mirror ----------------------------------------------------

describe('generateBoss — Hollow mirrors kit + stats and scales HP', () => {
  it("mirrors the player's skillPool and six stats (mods recomputed)", () => {
    const player = makePlayer({ skillPool: ['siphon', 'unmake'] });
    const g = generateBoss({ bossId: 'hollow', act: 5, player, karma: createKarma(), rng: mulberry32(8) });
    expect(g.enemy.skillPool).toEqual(player.skillPool);
    expect(g.enemy.skillPool).not.toBe(player.skillPool);
    expect(g.enemy.stats).toEqual(player.stats);
    expect(g.enemy.mods).toEqual(computeStatMods(player.stats));
  });

  it('scales HP by HOLLOW_HP_SCALE off a FINAL_BOSS_XP base enemy (hand-derived)', () => {
    const player = makePlayer();
    const SEED = 271;
    const g = generateBoss({ bossId: 'hollow', act: 5, player, karma: createKarma(), rng: mulberry32(SEED) });
    // Independent base: generateEnemy is a separately-tested function; the Hollow scales
    // its base maxHp/hp by HOLLOW_HP_SCALE (floored). playerXp = FINAL_BOSS_XP.
    const base = generateEnemy({ act: 5, type: BOSSES.hollow.name, playerXp: FINAL_BOSS_XP }, mulberry32(SEED));
    expect(g.enemy.maxHp).toBe(Math.floor(base.maxHp * HOLLOW_HP_SCALE));
    expect(g.enemy.hp).toBe(Math.floor(base.hp * HOLLOW_HP_SCALE));
  });
});

// ------- F1 Kingpin: minion cadence + damage (bossPostRound) ------------------

function kingpinBattle(player: Player): BattleState {
  const enemy = generateEnemy({ act: 1, type: BOSSES.kingpin.name, playerXp: player.xp }, mulberry32(1));
  const boss: BossState = { bossId: 'kingpin', round: 0, minions: 0 };
  return createBattle(player, enemy, 1, { boss });
}

describe('bossPostRound — Kingpin summons adds on cadence and the crew deals damage', () => {
  it('summons on the fixed cadence, caps at KINGPIN_MAX_MINIONS, deals minions × MINION_DAMAGE', () => {
    // Constants used for the hand-derivation (re-stated, not measured; M15-tuned values):
    expect(KINGPIN_SUMMON_EVERY_ROUNDS).toBe(3);
    expect(KINGPIN_MAX_MINIONS).toBe(2);
    expect(KINGPIN_MINION_DAMAGE).toBe(1);

    let battle = kingpinBattle(makePlayer({ hp: 500, maxHp: 500 }));

    // Rounds 1 & 2: round→1 then 2, neither % 3 = 0 → no summon; minions 0 → no damage.
    let r = bossPostRound(battle, 'fight');
    expect(r.battle.boss?.round).toBe(1);
    expect(r.battle.boss?.minions).toBe(0);
    expect(r.events).toEqual([]);
    battle = bossPostRound(r.battle, 'fight').battle; // r2 (round→2, still no summon/damage)
    expect(battle.boss?.round).toBe(2);
    expect(battle.boss?.minions).toBe(0);

    // Round 3: round→3, 3 % 3 = 0 & 0 < 2 → summon → minions 1; damage = 1 × 1 = 1.
    r = bossPostRound(battle, 'fight');
    expect(r.battle.boss?.minions).toBe(1);
    expect(r.events).toContainEqual({ kind: 'boss-summon', minions: 1 });
    expect(r.events).toContainEqual({ kind: 'boss-minion-damage', amount: 1 * KINGPIN_MINION_DAMAGE });
    battle = r.battle;

    // Rounds 4 & 5: no summon; minions 1; damage 1 each.
    r = bossPostRound(battle, 'fight'); // r4
    expect(r.battle.boss?.minions).toBe(1);
    expect(r.events.some((e) => e.kind === 'boss-summon')).toBe(false);
    expect(r.events).toContainEqual({ kind: 'boss-minion-damage', amount: 1 });
    battle = bossPostRound(r.battle, 'fight').battle; // r5

    // Round 6: round→6, 6 % 3 = 0 & 1 < 2 → summon → minions 2 (cap); damage = 2 × 1 = 2.
    r = bossPostRound(battle, 'fight');
    expect(r.battle.boss?.minions).toBe(2);
    expect(r.events).toContainEqual({ kind: 'boss-summon', minions: 2 });
    expect(r.events).toContainEqual({ kind: 'boss-minion-damage', amount: 2 * KINGPIN_MINION_DAMAGE });
    battle = r.battle;

    // Rounds 7 & 8: no summon; minions 2; damage 2. Round 9: cadence hits (9 % 3 = 0) but
    // minions already at cap 2 → no new summon; damage still 2 = MAX × DMG.
    battle = bossPostRound(battle, 'fight').battle; // r7
    battle = bossPostRound(battle, 'fight').battle; // r8
    r = bossPostRound(battle, 'fight'); // r9
    expect(r.battle.boss?.round).toBe(9);
    expect(r.battle.boss?.minions).toBe(KINGPIN_MAX_MINIONS);
    expect(r.events.some((e) => e.kind === 'boss-summon')).toBe(false);
    expect(r.events).toContainEqual({ kind: 'boss-minion-damage', amount: 2 * KINGPIN_MINION_DAMAGE });
  });

  it('lethal minion damage ends the round in player-died with a defeat event', () => {
    // Player at 1 HP. Rounds 1 & 2: no minions, no damage. Round 3: first summon → minions 1
    // → damage 1 × 1 = 1 → hp 0 → player-died (new cadence: every 3 rounds, 1 dmg/minion).
    let battle = kingpinBattle(makePlayer({ hp: 1, maxHp: 40 }));
    let r = bossPostRound(battle, 'fight'); // r1
    expect(r.status).toBe('ongoing');
    r = bossPostRound(r.battle, 'fight'); // r2
    expect(r.status).toBe('ongoing');
    expect(r.battle.player.hp).toBe(1);
    r = bossPostRound(r.battle, 'fight'); // r3: summon + 1 damage
    expect(r.battle.player.hp).toBe(0);
    expect(r.status).toBe('player-died');
    expect(r.events).toContainEqual({ kind: 'defeat' });
  });
});

// ------- F2 Reflection adaptation (bossPostRound) ----------------------------

describe('bossPostRound — Reflection adapts after a repeated tactic', () => {
  it(`fires boss-adapt at exactly REFLECTION_ADAPT_THRESHOLD repeats and disadvantages the player`, () => {
    expect(REFLECTION_ADAPT_THRESHOLD).toBe(3);
    const enemy = generateEnemy({ act: 2, type: BOSSES.reflection.name, playerXp: 0 }, mulberry32(1));
    const boss: BossState = { bossId: 'reflection', round: 0, adapted: false, actionTally: {} };
    let battle: BattleState = createBattle(makePlayer(), enemy, 2, { boss });

    // Two repeats: no adaptation yet, no standing disadvantage on the battle.
    for (let i = 0; i < REFLECTION_ADAPT_THRESHOLD - 1; i++) {
      const r = bossPostRound(battle, 'fight');
      expect(r.events.some((e) => e.kind === 'boss-adapt')).toBe(false);
      expect(r.battle.playerAdvantage ?? 0).toBe(0);
      battle = r.battle;
    }
    // The threshold repeat: adaptation fires; the player's next attack is at disadvantage.
    // CHANGED by G12: the adaptation writes `battle.playerAdvantage`, not
    // `player.advantageDisadvantage`. Same meaning — a standing penalty for this fight — but
    // written onto the player it survived the fight, because `game.ts` persists
    // `battle.player` to the hub, so one adapt disadvantaged the player for the rest of the
    // run. The player record must now be left alone.
    const r = bossPostRound(battle, 'fight');
    expect(r.events).toContainEqual({ kind: 'boss-adapt' });
    expect(r.battle.boss?.adapted).toBe(true);
    expect(r.battle.playerAdvantage).toBe(-1);
    expect(r.battle.player.advantageDisadvantage).toBe(0); // nothing latched onto the player
  });

  it('tallies each action SEPARATELY: no single action reaching the threshold ⇒ no adapt', () => {
    // fight ×2 and potion ×2 — neither key reaches 3, so the boss never adapts.
    const enemy = generateEnemy({ act: 2, type: BOSSES.reflection.name, playerXp: 0 }, mulberry32(1));
    const boss: BossState = { bossId: 'reflection', round: 0, adapted: false, actionTally: {} };
    let battle: BattleState = createBattle(makePlayer(), enemy, 2, { boss });
    for (const a of ['fight', 'potion', 'fight', 'potion'] as const) {
      const r = bossPostRound(battle, a);
      expect(r.events.some((e) => e.kind === 'boss-adapt')).toBe(false);
      battle = r.battle;
    }
    expect(battle.boss?.adapted).not.toBe(true);
    expect(battle.boss?.actionTally).toEqual({ fight: 2, potion: 2 });
  });
});

// ------- Sin / Hollow have no per-round mechanic ------------------------------

describe('bossPostRound — Sin/Hollow only advance the round counter', () => {
  it('emits no events and increments round for sin and hollow', () => {
    for (const bossId of ['sin', 'hollow'] as const) {
      const enemy = generateEnemy({ act: 3, type: BOSSES[bossId].name, playerXp: 0 }, mulberry32(1));
      const boss: BossState = { bossId, round: 0 };
      const battle: BattleState = createBattle(makePlayer(), enemy, 3, { boss });
      const r = bossPostRound(battle, 'fight');
      expect(r.events).toEqual([]);
      expect(r.status).toBe('ongoing');
      expect(r.battle.boss?.round).toBe(1);
    }
  });
});
