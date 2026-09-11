import { describe, expect, it } from 'vitest';
import {
  selectEncounter,
  buildRandomBattle,
  buildChestLoot,
  computeRestHeal,
} from './encounter.ts';
import { floorDef, FLOOR_ENCOUNTERS, FLOOR_IDS } from './floors.ts';
import { createPlayer } from './player.ts';
import { step, type GameState } from './game.ts';
import { createKarma } from './karma.ts';
import { resolveInstanceDef } from './equipment.ts';
import { getAllUniques } from './item.ts';
import { type Stats } from './character.ts';
import { mulberry32, type Rng } from './rng.ts';

function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

function stats(): Stats {
  return { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13 };
}

describe('selectEncounter — per-floor weights from floors.json (PLAN.md #2, AC-19)', () => {
  it('walks the weights in the fixed order battle, chest, rest, bargain — bands derived by hand', () => {
    // weightedPick draws r = 1 + floor(x * total) and returns the first kind whose cumulative
    // weight reaches r. With floor 1's weights w = [battle, chest, rest, bargain] the band for
    // each kind is [cum_prev / total, cum / total). The x values below sit inside each band.
    const w = floorDef(1).encounters;
    const total = w.battle + w.chest + w.rest + w.bargain;
    const mid = (lo: number, hi: number) => (lo + hi) / 2 / total;
    let c = 0;
    const bands: [string, number][] = [];
    for (const kind of FLOOR_ENCOUNTERS) {
      bands.push([kind, mid(c, c + w[kind])]);
      c += w[kind];
    }
    for (const [kind, x] of bands) expect(selectEncounter(scriptedRng([x]), 1), kind).toBe(kind);
    expect(FLOOR_ENCOUNTERS).toEqual(['battle', 'chest', 'rest', 'bargain']);
  });

  it('takes exactly ONE draw, as the old fixed table did', () => {
    let n = 0;
    const base = mulberry32(9);
    const rng: Rng = () => {
      n += 1;
      return base();
    };
    selectEncounter(rng, 3);
    expect(n).toBe(1);
  });

  it('matches every floor’s data weights within ±2 points over 6000 draws; bargain on every floor', () => {
    const N = 6000;
    for (const floor of FLOOR_IDS) {
      const w = floorDef(floor).encounters;
      const total = FLOOR_ENCOUNTERS.reduce((a, k) => a + w[k], 0);
      const seen: Record<string, number> = { battle: 0, chest: 0, rest: 0, bargain: 0 };
      for (let seed = 0; seed < N; seed++) {
        const e = selectEncounter(mulberry32(seed * 7919 + floor), floor);
        seen[e] = (seen[e] ?? 0) + 1;
      }
      for (const kind of FLOOR_ENCOUNTERS) {
        const expected = w[kind] / total;
        expect(Math.abs((seen[kind] ?? 0) / N - expected), `floor ${floor} ${kind}`).toBeLessThan(0.02);
      }
      expect(seen.bargain, `floor ${floor} never offers a bargain`).toBeGreaterThan(0);
    }
  });
});

describe('buildChestLoot', () => {
  it('yields the guaranteed chest items and is deterministic for a fixed seed', () => {
    // chestItemCount is 1 (dropTables.json), so a chest always yields exactly one item;
    // determinism is proved by two independent rolls from the same seed matching.
    //
    // CHANGED: the signature gained `act` (G14). A chest can now also hold an AUTHORED
    // catalog item, whose instance is a bare `{ defId }` with no `rolled` overlay — so the
    // old `expect(a[0]!.rolled).toBeDefined()` no longer describes every legal chest. It is
    // replaced by the invariant that actually matters and holds for both branches: whatever
    // the chest yields, it resolves to a real item. Seed 31 / act 1 is not re-picked to keep
    // the old assertion true; the assertion is the thing that was too narrow.
    const a = buildChestLoot(mulberry32(31), 1);
    const b = buildChestLoot(mulberry32(31), 1);
    expect(a).toHaveLength(1);
    expect(a).toEqual(b);
    expect(resolveInstanceDef(a[0]!)).not.toBeNull();
  });

  it('threads the act through, so a floor-5 unique cannot fall out of a floor-1 cache', () => {
    // Every authored unique carries `floor` >= 2, so act 1 can yield none of them at all.
    //
    // ⚠ THIS ASSERTION ALONE PROVES NOTHING, and the block below is why it is kept rather
    // than replaced: it is an invariant over an EMPTY collection. At act 1 the unique pool is
    // `[]`, so "holds no unique" is true of the correct implementation AND of one that
    // ignores the act completely. The positive half lives below.
    const uniqueIds = new Set(getAllUniques().map((u) => u.id));
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const item of buildChestLoot(mulberry32(seed), 1)) {
        expect(uniqueIds.has(item.defId)).toBe(false);
      }
    }
  });
});

// =========================================================================================
// The POSITIVE direction of the act threading — added in FIX ROUND 1, and it is the exact
// trap the brief names: an invariant checked over an empty collection.
//
// Three mutations pinned the act to a constant and passed ALL 1290 tests — including
// `buildChestLoot(rng, 1)` at the SHIPPING call site in `game.ts`. Measured consequence: no
// chest in the game could ever yield a unique, and the chest table's deliberately tripled
// `unique: 3` jackpot weight would be dead data. Silently.
//
// So the act must be shown to make a DIFFERENCE, not merely to be harmless. Every expected
// count below is derived from the data, never measured: the chest table's act-5 pools are
// heal 4 + utility 3 + unique 3 = weight 10, behind a 0.45 catalog gate, so P(unique) =
// 0.45 x 3/10 = 13.5% per chest — about 54 of 400 — and `hollow-regalia` is one of the four
// uniques available at act 5, so about 13 of those. The floors are set far below both.
// =========================================================================================

describe('buildChestLoot — the act really is what gates the unique pool', () => {
  const uniqueIds = new Set(getAllUniques().map((u) => u.id));
  /** Every defId a chest yields at `act` across seeds 1..400. */
  function chestIdsAt(act: number): string[] {
    const out: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      for (const item of buildChestLoot(mulberry32(seed), act)) out.push(item.defId);
    }
    return out;
  }

  it('act 5 chests DO yield uniques — the half that was missing', () => {
    const uniques = chestIdsAt(5).filter((id) => uniqueIds.has(id));
    expect(
      uniques.length,
      'no act-5 chest yielded a unique — the act is being ignored somewhere in the chain',
    ).toBeGreaterThan(0);
  });

  it('a floor-5 unique appears at act 5 and NEVER at act 4', () => {
    // `hollow-regalia` is authored `floor: 5`. The sharpest single probe available: it
    // separates "the act is threaded" from "the act is pinned to ANY constant".
    expect(getAllUniques().find((u) => u.id === 'hollow-regalia')!.floor).toBe(5);
    expect(chestIdsAt(5)).toContain('hollow-regalia');
    expect(chestIdsAt(4)).not.toContain('hollow-regalia');
    expect(chestIdsAt(1)).not.toContain('hollow-regalia');
  });

  it('each act sees exactly the uniques its floor allows, and no others', () => {
    // The whole ladder, so pinning the act to any constant fails — not only pinning it to 1.
    for (const act of [1, 2, 3, 4, 5]) {
      const allowed = new Set(
        getAllUniques().filter((u) => (u.floor ?? 1) <= act).map((u) => u.id),
      );
      const seen = new Set(chestIdsAt(act).filter((id) => uniqueIds.has(id)));
      for (const id of seen) {
        expect(allowed.has(id), `act ${act} yielded "${id}", floored above it`).toBe(true);
      }
      // Non-vacuity: from act 2 on the pool is non-empty and really is drawn from.
      if (act >= 2) expect(seen.size, `act ${act} yielded no unique at all`).toBeGreaterThan(0);
    }
  });
});

// =========================================================================================
// The SHIPPING call site. `src/game/game.ts` is the only caller of `buildChestLoot`, and the
// mutation that mattered most — `buildChestLoot(rng, 1)` THERE — is invisible to every test
// above, because those call the helper directly. `src/game/game.ts` is pure and importable,
// so this is asserted by driving the REAL `step` rather than by reading the source.
// =========================================================================================

describe('the chest encounter reached through `step` is act-aware', () => {
  /** Open a hub chest at `act` for each seed, and collect what it deposited. */
  function chestIdsThroughStep(act: number, seedCount: number): string[] {
    const out: string[] = [];
    for (let seed = 1; seed <= seedCount; seed += 1) {
      const state: GameState = {
        version: 9,
        rngState: seed,
        // xp 0 keeps every act gate — and act 5's Hollow gate — shut, so `continue` takes the
        // ordinary encounter path rather than walking into a boss.
        player: { ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: stats() }), xp: 0 },
        act,
        place: act - 1,
        karma: createKarma(),
        phase: { kind: 'main-menu' },
      };
      const r = step(state, { kind: 'menu', choice: 'continue' });
      if (r.state.phase.kind !== 'chest') continue;
      for (const item of r.state.phase.loot) out.push(item.defId);
    }
    return out;
  }

  it('a chest opened at act 5 can hold a floor-5 unique; the same chest at act 4 cannot', () => {
    // A chest is 1 of the 6 encounter slots, so about 1/6 of these seeds open one.
    const atFive = chestIdsThroughStep(5, 900);
    const atFour = chestIdsThroughStep(4, 900);
    // Non-vacuity first: the sweep must really be opening chests, or everything below is an
    // assertion about an empty list — which is the very defect this block exists to close.
    expect(atFive.length, 'no chest opened at act 5 — this guard has gone stale').toBeGreaterThan(20);
    expect(atFour.length, 'no chest opened at act 4 — this guard has gone stale').toBeGreaterThan(20);
    expect(
      atFive,
      'the act is not reaching buildChestLoot from game.ts — no chest in the game can ever ' +
        'yield a floor-5 unique, and the chest table\'s `unique: 3` weight is dead data',
    ).toContain('hollow-regalia');
    expect(atFour).not.toContain('hollow-regalia');
  });
});

describe('computeRestHeal', () => {
  it('xp=40 gives 10 at draw 0 and 20 at draw ~1 (range [10, 10+floor(xp/4)])', () => {
    // randInt(rng, floor(40/4)+1=11) + 10: x=0 -> 0+10=10; x=0.999 -> 10+10=20.
    expect(computeRestHeal(40, scriptedRng([0]))).toBe(10);
    expect(computeRestHeal(40, scriptedRng([0.999]))).toBe(20);
  });

  it('stays within [10, 10+floor(xp/4)] over many seeds', () => {
    const xp = 40;
    const hi = 10 + Math.floor(xp / 4); // 20
    for (let seed = 0; seed < 500; seed++) {
      const h = computeRestHeal(xp, mulberry32(seed));
      expect(h).toBeGreaterThanOrEqual(10);
      expect(h).toBeLessThanOrEqual(hi);
    }
  });

  it('xp=0 always heals exactly 10 (single slot)', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(computeRestHeal(0, mulberry32(seed))).toBe(10);
    }
  });
});

describe('buildRandomBattle', () => {
  // The per-floor family-id sets are the independent oracle, hand-listed from the plan's
  // Design (§ "The 24 families") — NOT read back from the loader.
  const ROSTER: Record<number, readonly string[]> = {
    1: ['gangers', 'securityDrones', 'mutantStrays', 'cyberEnforcers', 'fixers'],
    2: ['reflections', 'mirrorSelves', 'distortions', 'staticWraiths'],
    3: ['grief', 'rage', 'dread', 'numbness', 'sevenSins', 'ashWraiths'],
    4: ['choir', 'guardians', 'theJudged', 'seraphWardens'],
    5: ['demons', 'voidHorrors', 'theUnmade', 'echoesOfYou', 'theHollowed'],
  };

  it('opens at advantage and produces a valid BattleState', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const battle = buildRandomBattle(player, 1, mulberry32(123));
    // CHANGED by G12: the ambush bonus is BATTLE-scoped now. It used to be stamped onto the
    // player as `advantageDisadvantage: 1`, which `game.ts` then persisted to the hub — so
    // every later fight, including every floor boss, inherited a +1 to hit. The bonus itself
    // is unchanged in size and still applies for the whole battle; only its home moved, so
    // that it dies with the battle.
    expect(battle.playerAdvantage).toBe(1);
    expect(battle.player.advantageDisadvantage).toBe(0); // nothing latched onto the player
    expect(battle.enemy.hp).toBeGreaterThan(0);
    expect(battle.enemy.hp).toBe(battle.enemy.maxHp);
    expect(battle.act).toBe(1);
    expect(battle.canFlee).toBe(true); // not Act 5, no boss
    // Purity: the source player is not mutated.
    expect(player.advantageDisadvantage).toBe(0);
  });

  it('every act draws a family from that act roster over many seeds', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    for (const act of [1, 2, 3, 4, 5]) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 200; seed++) {
        const battle = buildRandomBattle(player, act, mulberry32(seed));
        expect(ROSTER[act]).toContain(battle.enemy.familyId);
        seen.add(battle.enemy.familyId);
      }
      // Over 200 seeds the whole roster is reachable (guards against a stuck pick).
      expect(seen).toEqual(new Set(ROSTER[act]));
    }
  });

  it('is deterministic: the same seed yields a deep-equal enemy (family + affix)', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const a = buildRandomBattle(player, 3, mulberry32(777));
    const b = buildRandomBattle(player, 3, mulberry32(777));
    expect(a.enemy).toEqual(b.enemy);
  });

  it('a restricted unlock set draws only that family (M13 seam)', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const only = new Set(['mutantStrays']);
    for (let seed = 0; seed < 100; seed++) {
      const battle = buildRandomBattle(player, 1, mulberry32(seed), only);
      expect(battle.enemy.familyId).toBe('mutantStrays');
    }
  });

  it('a restricted AFFIX set never stamps an out-of-set affix (M13 seam)', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const allowedAffixes = new Set(['ravenous', 'ancient']);
    let elites = 0;
    for (let seed = 0; seed < 400; seed++) {
      const battle = buildRandomBattle(player, 1, mulberry32(seed), undefined, allowedAffixes);
      if (battle.enemy.affixId !== undefined) {
        elites++;
        expect(allowedAffixes.has(battle.enemy.affixId)).toBe(true);
      }
    }
    expect(elites).toBeGreaterThan(0); // the front-load affixes still appear
  });

  it('full family+affix sets are byte-identical to no restriction (off-equivalence)', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const FULL_FAMILIES: Record<number, readonly string[]> = ROSTER;
    const fullAffixes = new Set(['ravenous', 'ancient', 'warped', 'blessed', 'cursed']);
    for (const act of [1, 2, 3, 4, 5]) {
      const fullFams = new Set(FULL_FAMILIES[act]);
      for (let seed = 0; seed < 60; seed++) {
        const bare = buildRandomBattle(player, act, mulberry32(seed));
        const restricted = buildRandomBattle(player, act, mulberry32(seed), fullFams, fullAffixes);
        expect(restricted.enemy).toEqual(bare.enemy);
      }
    }
  });

  it('some seeds spawn an elite (affix present) and the affix prefixes the name', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    let elites = 0;
    for (let seed = 0; seed < 400; seed++) {
      const battle = buildRandomBattle(player, 1, mulberry32(seed));
      if (battle.enemy.affixId !== undefined) {
        elites++;
        // The affix prefix (capitalized word) leads the name.
        expect(/^[A-Z][a-z]+ /.test(battle.enemy.fullName)).toBe(true);
      }
    }
    // ELITE_CHANCE is 0.15, so over 400 seeds elites are present but a minority.
    expect(elites).toBeGreaterThan(0);
    expect(elites).toBeLessThan(400);
  });

  it('Act 5 battles cannot be fled', () => {
    const player = createPlayer({ name: 'H', classId: 'Enforcer', stats: stats() });
    const battle = buildRandomBattle(player, 5, mulberry32(1));
    expect(battle.canFlee).toBe(false);
  });
});
