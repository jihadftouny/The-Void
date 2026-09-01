// Tests for the pure save/load core (M9).
//
// Expectations are derived by hand from the plan, the GameState shape in game.ts,
// and the RNG contract in rng.ts — never by printing implementation output and
// pasting it back. The anchors compare two INDEPENDENT runs (an un-saved run vs a
// save/restore run), so a pass proves the restore is faithful, not that code
// equals itself.

import { describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  encodeSave,
  decodeSave,
  createMemoryStorage,
  saveGame,
  loadGame,
} from './save.ts';
import {
  createGame,
  step,
  type GameState,
  type GameInput,
  type StepResult,
} from './game.ts';
import { createRng, mulberry32 } from './rng.ts';
import { levelForXp } from './progression.ts';
import { createBattle } from './battle.ts';
import { createPlayer } from './player.ts';
import { createInventory } from './inventory.ts';
import { grantMomentum } from './classKit.ts';
import { generateEnemy } from './enemy.ts';
import { getFamily } from './enemyFamily.ts';
import { applyAffix, AFFIXES } from './enemyAffix.ts';
import { tickConditions, type ActiveCondition } from './condition.ts';
import { type ItemInstance } from './item.ts';
import { type GameEvent } from './gameEvent.ts';

const SEED = 12345;

/** Drive a fresh game to the main-menu with a created player (a mid-run state). */
function midRunState(seed: number): GameState {
  let state = createGame(seed);
  state = step(state, { kind: 'continue' }).state; // title -> name-entry
  state = step(state, { kind: 'name', name: 'Ari' }).state; // -> class-select
  state = step(state, { kind: 'class', classId: 'Enforcer' }).state; // -> stats-roll
  state = step(state, { kind: 'stats-decision', accept: true }).state; // -> main-menu
  return state;
}

/** Fold a fixed input list through `step`, collecting every event in order. */
function runInputs(
  state: GameState,
  inputs: readonly GameInput[],
): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (const input of inputs) {
    const r: StepResult = step(s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe('SAVE_VERSION', () => {
  it('mirrors the current GameState.version', () => {
    // Derived from game.ts: createGame stamps version 7 (M9 bumped 6 -> 7, level-up draft).
    expect(SAVE_VERSION).toBe(8);
    expect(createGame(SEED).version).toBe(SAVE_VERSION);
  });
});

const ZERO_KARMA = {
  mercyCruelty: 0,
  restraintGreed: 0,
  reverenceDesecration: 0,
  clarityDelusion: 0,
};

describe('migration v2 -> v3 (legacy equipped ids -> paperdoll slots)', () => {
  // Build a v2-shaped save from the modern (v3) one: reset the paperdoll to empty, re-add the
  // pre-M5 legacy equipped ids on the player, and stamp version 2 — the exact pre-M5 shape.
  function v2Save(mutatePlayer: (p: Record<string, unknown>) => void): Record<string, unknown> {
    const modern = midRunState(SEED); // Enforcer, v3
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    const player = old.player as Record<string, unknown>;
    player.inventory = createInventory(); // empty 9-null slots, no backpack items
    player.equippedWeaponId = 'Jaaj Sword 1';
    player.equippedArmorId = 'Jooj Armor 1';
    mutatePlayer(player);
    old.version = 2;
    return old;
  }

  it('moves equippedWeaponId/armorId into slots, strips the legacy fields, and equals the modern state', () => {
    const modern = midRunState(SEED);
    const old = v2Save(() => {});
    // Sanity: the source really is v2-shaped (legacy fields present, slots empty).
    const srcPlayer = old.player as Record<string, unknown>;
    expect(srcPlayer.equippedWeaponId).toBe('Jaaj Sword 1');
    expect((srcPlayer.inventory as { slots: Record<string, unknown> }).slots.mainHand).toBeNull();

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    const mp = migrated!.player!;
    expect(mp.inventory.slots.mainHand).toEqual({ defId: 'Jaaj Sword 1' });
    expect(mp.inventory.slots.armor).toEqual({ defId: 'Jooj Armor 1' });
    expect('equippedWeaponId' in mp).toBe(false);
    expect('equippedArmorId' in mp).toBe(false);
    expect(migrated!.version).toBe(SAVE_VERSION);
    // Modern midRunState seeds the SAME starting gear into slots, so the migrated v2 save
    // deep-equals the modern v3 state.
    expect(migrated).toEqual(modern);
  });

  it('migrates equippedShieldId into the offHand slot', () => {
    const old = v2Save((p) => {
      p.equippedShieldId = 'Buckler';
    });
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    const mp = migrated!.player!;
    expect(mp.inventory.slots.offHand).toEqual({ defId: 'Buckler' });
    expect('equippedShieldId' in mp).toBe(false);
  });
});

describe('migration v1 -> v3 (full ladder: karma + inventory injected, then ids -> slots)', () => {
  it('injects karma + inventory (1->2) then lands the legacy ids in slots (2->3)', () => {
    // A genuine v1 save: no karma, player with legacy equipped ids and no inventory.
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    delete old.karma;
    const player = old.player as Record<string, unknown>;
    delete player.inventory;
    player.equippedWeaponId = 'Jaaj Sword 1';
    player.equippedArmorId = 'Jooj Armor 1';
    old.version = 1;
    // Sanity: really v1-shaped.
    expect('karma' in old).toBe(false);
    expect('inventory' in player).toBe(false);

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.karma).toEqual(ZERO_KARMA);
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.player!.inventory.slots.mainHand).toEqual({ defId: 'Jaaj Sword 1' });
    expect(migrated!.player!.inventory.slots.armor).toEqual({ defId: 'Jooj Armor 1' });
    expect(Object.keys(migrated!.player!.inventory.slots)).toHaveLength(9);
    // Deep-equals the modern state, which seeds the same gear into slots.
    expect(migrated).toEqual(modern);
  });

  it('migrates a v1 title save with a null player (nothing to inject into slots)', () => {
    const modern = createGame(SEED); // player is null at the title
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    delete old.karma;
    old.version = 1;

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.karma).toEqual(ZERO_KARMA);
    expect(migrated!.player).toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated).toEqual(modern);
  });

  it('rejects a future version 9 save without throwing', () => {
    const s = { ...createGame(SEED), version: 9 };
    expect(() => decodeSave(JSON.stringify(s))).not.toThrow();
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });
});

describe('round-trip', () => {
  it('deep-equals for a fresh createGame state', () => {
    const s = createGame(SEED);
    const decoded = decodeSave(encodeSave(s));
    expect(decoded).toEqual(s);
  });

  it('produces a string JSON.parse accepts', () => {
    const s = createGame(SEED);
    const encoded = encodeSave(s);
    expect(typeof encoded).toBe('string');
    expect(() => JSON.parse(encoded)).not.toThrow();
  });

  it('deep-equals for a mid-run state (player created, main-menu)', () => {
    const m = midRunState(SEED);
    // Sanity: this state is genuinely mid-run.
    expect(m.player).not.toBeNull();
    expect(m.phase.kind).toBe('main-menu');
    const decoded = decodeSave(encodeSave(m));
    expect(decoded).toEqual(m);
  });

  it('preserves the M13 optional `unlocks` snapshot (version stays 8)', () => {
    // A state carrying the additive run-start snapshot round-trips unchanged — no version bump.
    const s = createGame(SEED, {
      families: ['gangers', 'securityDrones'],
      affixes: ['ravenous', 'ancient'],
    });
    expect(s.version).toBe(8);
    const decoded = decodeSave(encodeSave(s));
    expect(decoded).toEqual(s);
    expect(decoded!.unlocks).toEqual({
      families: ['gangers', 'securityDrones'],
      affixes: ['ravenous', 'ancient'],
    });
  });

  it('drops a malformed `unlocks` field but keeps the rest of the save (non-fatal guard)', () => {
    // A v8 save whose `unlocks` is the wrong shape must not be rejected — the field is dropped
    // (the run resumes as all-unlocked) and the save otherwise decodes.
    const s = createGame(SEED) as unknown as Record<string, unknown>;
    s.unlocks = { families: 'not-an-array' }; // malformed
    const decoded = decodeSave(JSON.stringify(s));
    expect(decoded).not.toBeNull();
    expect(decoded!.unlocks).toBeUndefined();
  });
});

describe('decodeSave rejection (returns null, never throws)', () => {
  const cases: Array<[string, string]> = [
    ['malformed JSON', '{'],
    ['JSON null', 'null'],
    ['JSON number', '42'],
    ['JSON array', '[]'],
    ['JSON string', '"hello"'],
  ];
  for (const [label, json] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => decodeSave(json)).not.toThrow();
      expect(decodeSave(json)).toBeNull();
    });
  }

  it('rejects a missing version field', () => {
    const s = createGame(SEED) as unknown as Record<string, unknown>;
    delete s.version;
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a future version', () => {
    const s = { ...createGame(SEED), version: SAVE_VERSION + 1 };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects an older version with nothing to migrate', () => {
    // fromVersion 0 < SAVE_VERSION -> migrate can't upgrade -> null.
    const s = { ...createGame(SEED), version: 0 };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-number version', () => {
    const s = { ...createGame(SEED), version: 'x' };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-number rngState', () => {
    const s = { ...createGame(SEED), rngState: 'nope' };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-finite rngState', () => {
    // JSON has no Infinity/NaN, so simulate the parsed shape via a string body.
    const s = createGame(SEED) as unknown as Record<string, unknown>;
    const body = JSON.stringify(s).replace('"rngState":12345', '"rngState":null');
    expect(decodeSave(body)).toBeNull();
  });

  it('rejects a missing act field', () => {
    const s = createGame(SEED) as unknown as Record<string, unknown>;
    delete s.act;
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a string act field', () => {
    const s = { ...createGame(SEED), act: 'one' };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects an unknown phase kind', () => {
    const s = { ...createGame(SEED), phase: { kind: 'bogus' } };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a non-object phase', () => {
    const s = { ...createGame(SEED), phase: 42 };
    expect(decodeSave(JSON.stringify(s))).toBeNull();
  });

  it('rejects a player that is neither null nor a valid Player', () => {
    // A mid-run state whose player lost a required field.
    const m = midRunState(SEED);
    const broken = JSON.parse(encodeSave(m)) as Record<string, unknown>;
    delete (broken.player as Record<string, unknown>).classId;
    expect(decodeSave(JSON.stringify(broken))).toBeNull();
  });

  it('rejects a player with a wrong-typed field', () => {
    const m = midRunState(SEED);
    const broken = JSON.parse(encodeSave(m)) as Record<string, unknown>;
    (broken.player as Record<string, unknown>).hp = 'full';
    expect(decodeSave(JSON.stringify(broken))).toBeNull();
  });

  it('rejects a player with an unknown classId', () => {
    const m = midRunState(SEED);
    const broken = JSON.parse(encodeSave(m)) as Record<string, unknown>;
    (broken.player as Record<string, unknown>).classId = 'Wizard';
    expect(decodeSave(JSON.stringify(broken))).toBeNull();
  });
});

describe('memory storage save/load/clear', () => {
  it('save then load restores a deep-equal state', () => {
    const st = createMemoryStorage();
    const m = midRunState(SEED);
    saveGame(m, st);
    expect(loadGame(st)).toEqual(m);
  });

  it('load on empty storage returns null', () => {
    const st = createMemoryStorage();
    expect(loadGame(st)).toBeNull();
  });

  it('clear makes a subsequent load return null', () => {
    const st = createMemoryStorage();
    saveGame(midRunState(SEED), st);
    st.clear();
    expect(loadGame(st)).toBeNull();
  });
});

describe('anchor 1: deterministic resume of the event stream', () => {
  it('a save/restore run matches the un-saved run over identical inputs', () => {
    const original = midRunState(SEED);

    // A fixed, hand-chosen input sequence. Mismatched inputs are no-ops in `step`
    // (total reducer), so the sequence advances both runs identically.
    const inputs: GameInput[] = [
      { kind: 'menu', choice: 'continue' },
      { kind: 'continue' },
      { kind: 'battle-action', action: 'fight' },
      { kind: 'continue' },
      { kind: 'battle-action', action: 'fight' },
      { kind: 'continue' },
      { kind: 'menu', choice: 'continue' },
      { kind: 'continue' },
    ];

    // Reference: run directly on the original (never saved).
    const reference = runInputs(original, inputs);

    // Guard against a vacuous anchor: the sequence must actually drive the game
    // (emit events and change state), else deep-equality would prove nothing.
    expect(reference.events.length).toBeGreaterThan(0);
    expect(reference.state).not.toEqual(original);

    // Restore: encode the ORIGINAL, decode it, run the SAME inputs.
    const restored = decodeSave(encodeSave(original));
    expect(restored).not.toBeNull();
    const resumed = runInputs(restored as GameState, inputs);

    expect(resumed.events).toEqual(reference.events);
    expect(resumed.state).toEqual(reference.state);
  });
});

describe('M2 conditions: mid-battle save round-trip (intensity + augment + enemy condition)', () => {
  // Build a started, non-final battle whose player carries a stacked poison (intensity 2)
  // and an augment (strong), and whose enemy carries a burn. The optional `intensity`
  // field is additive plain data, so no save-version bump is needed.
  function midBattleState(playerConds: ActiveCondition[], enemyConds: ActiveCondition[]): GameState {
    const base = midRunState(SEED);
    const player = { ...base.player!, hp: 20, maxHp: 20, activeConditions: playerConds };
    const enemy = {
      ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(SEED)),
      activeConditions: enemyConds,
    };
    const battle = createBattle(player, enemy, 1);
    return { ...base, player, phase: { kind: 'battle', battle, started: true, final: false } };
  }

  it('a stacked poison (intensity 2) + augment + enemy condition survive deep-equal', () => {
    const state = midBattleState(
      [
        { type: 'poison', remainingTurns: 2, maxTurns: 2, intensity: 2 },
        { type: 'strong', remainingTurns: 2, maxTurns: 2 },
      ],
      [{ type: 'burn', remainingTurns: 1, maxTurns: 2 }],
    );
    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);

    // Intensity is explicitly preserved through the JSON trip.
    const rp = restored as GameState;
    if (rp.phase.kind === 'battle') {
      const poison = rp.phase.battle.player.activeConditions.find((c) => c.type === 'poison');
      expect(poison?.intensity).toBe(2);
    }
  });

  it('a LEGACY condition (no intensity) round-trips without a version bump and ticks as 1', () => {
    // A pre-M2 poison at its effect phase: three fields, no `intensity`.
    const state = midBattleState([{ type: 'poison', remainingTurns: 1, maxTurns: 2 }], []);
    expect(state.version).toBe(SAVE_VERSION); // no bump (SAVE_VERSION stays 2)

    const restored = decodeSave(encodeSave(state));
    expect(restored).toEqual(state);

    const rp = restored as GameState;
    if (rp.phase.kind === 'battle') {
      const cond = rp.phase.battle.player.activeConditions[0]!;
      expect('intensity' in cond).toBe(false); // stays legacy-shaped
      // The decoded legacy poison ticks as intensity 1 (-1 hp), proving backward compat.
      const noDraw = () => {
        throw new Error('poison must consume no rng draw');
      };
      const tick = tickConditions(rp.phase.battle.player, rp.phase.battle.enemy, noDraw);
      expect(tick.hpDelta).toBe(-1);
    }
  });
});

describe('M3 classes + resources: save validation & round-trip', () => {
  const ALL_CLASSES = ['Enforcer', 'Neuromancer', 'Scavver', 'Penitent', 'Hollow'] as const;

  it('all five classIds pass validation and round-trip', () => {
    for (const classId of ALL_CLASSES) {
      const base = midRunState(SEED);
      const player = createPlayer({ name: 'Ari', classId, stats: base.player!.stats });
      const state: GameState = { ...base, player };
      const decoded = decodeSave(encodeSave(state));
      expect(decoded).not.toBeNull();
      expect(decoded!.player!.classId).toBe(classId);
      // A full deep round-trip (kit skillPool + resources included).
      expect(decoded).toEqual(state);
    }
  });

  it('a resource-bearing player (momentum/corruption > 0) + an exposed enemy round-trip byte-equal', () => {
    const base = midRunState(SEED);
    const player = { ...base.player!, momentum: 3, corruption: 2, hp: 20, maxHp: 20 };
    const enemy = {
      ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(SEED)),
      activeConditions: [{ type: 'exposed', remainingTurns: 2, maxTurns: 2, intensity: 3 } as ActiveCondition],
    };
    // The resources are set on the battle player AFTER `createBattle`, because the funnel now
    // decays carried momentum at a battle boundary (G34/§22.19). This test is about the SAVE
    // ROUND-TRIP of a mid-battle state, not about that boundary rule, so it pins mid-battle
    // values directly. (Nothing else here moved: no SAVE_VERSION bump, no field removed.)
    const opened = createBattle(player, enemy, 1);
    const battle = { ...opened, player: { ...opened.player, momentum: 3, corruption: 2 } };
    const state: GameState = { ...base, player, phase: { kind: 'battle', battle, started: true, final: false } };

    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
    // The live resources and the exposed intensity survive explicitly.
    const rp = restored as GameState;
    if (rp.phase.kind === 'battle') {
      expect(rp.phase.battle.player.momentum).toBe(3);
      expect(rp.phase.battle.player.corruption).toBe(2);
      const mark = rp.phase.battle.enemy.activeConditions.find((c) => c.type === 'exposed');
      expect(mark?.intensity).toBe(3);
    }
  });

  it('a pre-M3 v2 save with NO momentum/corruption fields decodes, and the resource reads as 0', () => {
    // Build a modern mid-run save, then STRIP the M3 resource fields to simulate a pre-M3
    // v2 player (additive-optional -> no version bump needed).
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    const oldPlayer = old.player as Record<string, unknown>;
    delete oldPlayer.momentum;
    delete oldPlayer.corruption;
    old.version = SAVE_VERSION; // still v2 — the strip does not change the shape version
    // Sanity: the source really is missing the fields (else the test is vacuous).
    expect('momentum' in oldPlayer).toBe(false);
    expect('corruption' in oldPlayer).toBe(false);

    const decoded = decodeSave(JSON.stringify(old));
    expect(decoded).not.toBeNull();
    const p = decoded!.player!;
    expect(p.momentum).toBeUndefined();
    // The engine reads the absent field as 0: granting +1 yields exactly 1.
    expect(grantMomentum(p, 1).momentum).toBe(1);
  });
});

describe('M5 paperdoll: equipped gear save validation & round-trip', () => {
  it('a player with a shield in the off-hand slot round-trips byte-equal', () => {
    const base = midRunState(SEED);
    const inv = base.player!.inventory;
    const player = {
      ...base.player!,
      inventory: { ...inv, slots: { ...inv.slots, offHand: { defId: 'Buckler' } } },
    };
    const state: GameState = { ...base, player };
    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
    expect(restored!.player!.inventory.slots.offHand).toEqual({ defId: 'Buckler' });
  });

  it('the seeded starting gear survives a v3 round-trip in its slots', () => {
    const restored = decodeSave(encodeSave(midRunState(SEED)));
    expect(restored).not.toBeNull();
    // Enforcer starting gear seeded at creation (player.ts) survives the trip.
    expect(restored!.player!.inventory.slots.mainHand).toEqual({ defId: 'Jaaj Sword 1' });
    expect(restored!.player!.inventory.slots.armor).toEqual({ defId: 'Jooj Armor 1' });
  });
});

describe('M6 v3 -> v4 migration + effect-bearing item round-trip', () => {
  it('a v3 save (all M6 fields absent) migrates to v4 and equals the modern state', () => {
    // Build a modern v4 save, then stamp it back to v3 to simulate a pre-M6 save. Because
    // every M6 addition is optional/additive, upgrade3to4 only bumps the version stamp, so
    // the migrated result must deep-equal the modern v4 state.
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    old.version = 3;
    expect(old.version).toBe(3); // sanity: really v3-shaped

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated).toEqual(modern);
  });

  it('a fresh v4 state with an equipped relic + a rolled backpack item round-trips deep-equal', () => {
    const base = midRunState(SEED);
    const inv = base.player!.inventory;
    const rolled: ItemInstance = {
      defId: 'gen:blade-1',
      rolled: {
        name: 'Forged Rapier',
        rarity: 'Legendary',
        slot: 'mainHand',
        kind: 'weapon',
        effects: [{ type: 'bonusDamage', params: { amount: 6 } }],
      },
    };
    const player = {
      ...base.player!,
      inventory: {
        ...inv,
        // A relic (triggered effect) equipped in the ring slot, plus a rarity-rolled weapon
        // sitting in the backpack — both effect-bearing, both must survive the JSON trip.
        slots: { ...inv.slots, ring: { defId: 'mirror-shard' } },
        backpack: [rolled],
      },
    };
    const state: GameState = { ...base, player };

    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
    // The rolled overlay and the equipped relic id survive explicitly.
    expect(restored!.player!.inventory.backpack[0]!.rolled!.name).toBe('Forged Rapier');
    expect(restored!.player!.inventory.slots.ring).toEqual({ defId: 'mirror-shard' });
  });
});

describe('M7 v4 -> v5 migration (gold retired)', () => {
  it('a v4 save with player.gold decodes to a v5 state with no gold field', () => {
    // Build a modern v5 save (no gold), then re-add a legacy `gold` and stamp version 4 to
    // simulate a genuine pre-M7 save. upgrade4to5 must DELETE gold and bump to 5; because the
    // modern state carries no gold, the migrated result deep-equals it.
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    (old.player as Record<string, unknown>).gold = 1500;
    old.version = 4;
    // Sanity: really v4-shaped with a gold balance.
    expect((old.player as Record<string, unknown>).gold).toBe(1500);

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect('gold' in migrated!.player!).toBe(false);
    expect(migrated).toEqual(modern);
  });

  it('a v4 title save with a null player migrates (nothing to strip)', () => {
    const modern = createGame(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    old.version = 4;
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated!.player).toBeNull();
    expect(migrated).toEqual(modern);
  });

  it('a fresh v5 state round-trips deep-equal', () => {
    const m = midRunState(SEED);
    expect(m.version).toBe(SAVE_VERSION);
    expect('gold' in m.player!).toBe(false);
    const decoded = decodeSave(encodeSave(m));
    expect(decoded).toEqual(m);
  });
});

describe('M8 v5 -> v6 migration + family/affix enemy round-trip', () => {
  it('a v5 save (M8 roster fields absent) migrates to v6 and equals the modern state', () => {
    // Build a modern v6 save, then stamp it back to v5 to simulate a pre-M8 save. The M8
    // Enemy fields are additive/optional, so upgrade5to6 only bumps the version stamp and
    // the migrated result deep-equals the modern v6 state.
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    old.version = 5;
    expect(old.version).toBe(5); // sanity: really v5-shaped

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(migrated).toEqual(modern);
  });

  it('a mid-battle state carrying a family + affix enemy round-trips deep-equal', () => {
    const base = midRunState(SEED);
    // A ⚖ family enemy made elite (Ancient) — carries familyId, karmaWeighted, affixId.
    const family = getFamily('grief')!;
    const affix = AFFIXES.find((a) => a.id === 'ancient')!;
    const enemy = applyAffix(
      generateEnemy({ act: 3, family, playerXp: 20 }, mulberry32(SEED)),
      affix,
    );
    const battle = createBattle(base.player!, enemy, 3);
    const state: GameState = {
      ...base,
      phase: { kind: 'battle', battle, started: true, final: false },
    };

    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
    // The new enemy fields survive explicitly.
    const rp = restored as GameState;
    if (rp.phase.kind === 'battle') {
      expect(rp.phase.battle.enemy.familyId).toBe('grief');
      expect(rp.phase.battle.enemy.karmaWeighted).toBe(true);
      expect(rp.phase.battle.enemy.affixId).toBe('ancient');
      // The themed enemy skill pool (grief = [drainingSob, heavyHeart]) survives the trip
      // as plain string[] — no save-version bump (skillPool shape unchanged).
      expect(rp.phase.battle.enemy.skillPool).toEqual(['drainingSob', 'heavyHeart']);
    }
  });
});

describe('anchor 2: RNG accumulator identity', () => {
  it('restored rngState is the identical number and the resumed stream matches', () => {
    const m = midRunState(SEED);
    const restored = decodeSave(encodeSave(m)) as GameState;

    expect(typeof restored.rngState).toBe('number');
    expect(restored.rngState).toBe(m.rngState);

    // The first float drawn from the resumed accumulator is bit-identical to the
    // first drawn from the original's accumulator (rng.ts: createRng(state)
    // continues the same stream). Ground truth = the original's draw.
    const originalDraw = createRng(m.rngState).rng();
    const resumedDraw = createRng(restored.rngState).rng();
    expect(resumedDraw).toBe(originalDraw);
  });
});

// ------- M9 v6 -> v7 migration + mid-draft round-trip -------------------------

describe('M9 v6 -> v7 migration (level / perks / skillUpgrades injected)', () => {
  it('a GENUINE v6 save (missing the M9 fields) gains level=levelForXp(xp), perks [], skillUpgrades {}', () => {
    // Build a modern v7 save, then STRIP the M9 player fields and stamp version 6 to simulate
    // a genuine pre-M9 save (xp 0 at the hub -> levelForXp(0) = 1, which matches the modern
    // fresh player, so the migrated result deep-equals the modern state).
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    const oldPlayer = old.player as Record<string, unknown>;
    delete oldPlayer.level;
    delete oldPlayer.perks;
    delete oldPlayer.skillUpgrades;
    old.version = 6;
    // Sanity: the source really is missing the fields (else the test is vacuous).
    expect('level' in oldPlayer).toBe(false);
    expect('perks' in oldPlayer).toBe(false);

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    const p = migrated!.player!;
    expect(p.level).toBe(levelForXp(p.xp)); // xp 0 -> level 1
    expect(p.perks).toEqual([]);
    expect(p.skillUpgrades).toEqual({});
    expect(migrated).toEqual(modern);
  });

  it('a mid-run v6 player with xp already banked migrates to the correct level (no catch-up cascade)', () => {
    // xp 6 -> levelForXp(6) = 3 (cumulative thresholds L2:2, L3:6, L4:12). Hand-derived.
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    const oldPlayer = old.player as Record<string, unknown>;
    delete oldPlayer.level;
    delete oldPlayer.perks;
    delete oldPlayer.skillUpgrades;
    oldPlayer.xp = 6;
    old.version = 6;

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.player!.level).toBe(3);
  });

  it('a v6 save parked in an in-flight OLD level-up phase is reset to main-menu', () => {
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    // Simulate a pre-M9 save mid-transition in the removed stat-pick level-up phase.
    old.phase = { kind: 'level-up', newAct: 2 };
    old.version = 6;

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.phase.kind).toBe('main-menu'); // reset to a safe hub state
  });

  it('an unrelated valid v6 run (at the hub) still loads and plays', () => {
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    old.version = 6;
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.phase.kind).toBe('main-menu');
    // It still steps (continue from the hub is a valid move).
    const stepped = step(migrated as GameState, { kind: 'menu', choice: 'continue' });
    expect(stepped.state).not.toBe(migrated);
  });
});

describe('M9 mid-pending-draft save round-trip', () => {
  /** Drive to a real level-up-draft state: a battle victory whose xp owes a level. */
  function pendingDraftState(): GameState {
    const base = midRunState(SEED);
    const player = { ...base.player!, xp: 2, level: 1 }; // xp 2 = cumulative(2) -> one owed
    const start: GameState = { ...base, player, phase: { kind: 'battle-victory', final: false } };
    const r = step(start, { kind: 'continue' });
    return r.state;
  }

  it('a level-up-draft state (offers populated, level/maxHp advanced) round-trips deep-equal', () => {
    const state = pendingDraftState();
    // Sanity: genuinely mid-draft with populated offers and an already-advanced level.
    expect(state.phase.kind).toBe('level-up-draft');
    if (state.phase.kind === 'level-up-draft') expect(state.phase.offers).toHaveLength(3);
    expect(state.player!.level).toBe(2);

    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
  });

  it('stepping draft-pick after reload matches a no-reload run (identical offer applied)', () => {
    const state = pendingDraftState();
    const reference = step(state, { kind: 'draft-pick', index: 1 });
    const restored = decodeSave(encodeSave(state)) as GameState;
    const resumed = step(restored, { kind: 'draft-pick', index: 1 });
    expect(resumed.events).toEqual(reference.events);
    expect(resumed.state).toEqual(reference.state);
  });
});

// ------- M12 v7 -> v8 migration + boss / verdict / ending state round-trip ----

describe('M12 v7 -> v8 migration (additive stamp)', () => {
  it('a genuine v7 save (pre-M12) migrates to v8 and still loads deep-equal', () => {
    // The M12 additions (phase.battle.boss, verdict/two-ending phases, the pending flag) are
    // all additive/optional and absent from a v7 hub save, so the migrated result deep-equals a
    // freshly-built modern (v8) state — the rung only stamps the version.
    const modern = midRunState(SEED);
    const old = JSON.parse(encodeSave(modern)) as Record<string, unknown>;
    old.version = 7;
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION); // 8
    expect(migrated).toEqual(modern);
  });
});

describe('M12 mid-boss / post-gate save round-trip', () => {
  it('a MID-BOSS battle state (Kingpin with minions/round set) round-trips deep-equal', () => {
    const base = midRunState(SEED);
    const player = base.player!;
    const enemy = generateEnemy({ act: 1, type: 'Undercity Kingpin', playerXp: player.xp }, mulberry32(1));
    const battle = {
      ...createBattle(player, enemy, 1),
      canFlee: false,
      boss: { bossId: 'kingpin' as const, round: 2, minions: 1 },
    };
    const state: GameState = { ...base, phase: { kind: 'battle', battle, started: true, final: false } };
    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
    if (restored!.phase.kind === 'battle') {
      expect(restored!.phase.battle.boss).toEqual({ bossId: 'kingpin', round: 2, minions: 1 });
    }
  });

  it('a POST-GATE grace ending state round-trips deep-equal (act stays 4)', () => {
    const base = midRunState(SEED);
    const state: GameState = {
      ...base,
      act: 4,
      place: 3,
      phase: { kind: 'ending', endingType: 'grace' },
    };
    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
  });

  it('a cast-down act-5 Hollow battle state (final, boss present) round-trips deep-equal', () => {
    const base = midRunState(SEED);
    const player = base.player!;
    const enemy = generateEnemy({ act: 5, type: 'Hollow Self', playerXp: 300 }, mulberry32(9));
    const battle = {
      ...createBattle(player, enemy, 5),
      canFlee: false,
      boss: { bossId: 'hollow' as const, round: 0 },
    };
    const state: GameState = {
      ...base,
      act: 5,
      place: 4,
      phase: { kind: 'battle', battle, started: true, final: true },
    };
    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
  });

  it('a state carrying the pending advance-act routing flag round-trips deep-equal', () => {
    const base = midRunState(SEED);
    const state: GameState = {
      ...base,
      pending: 'advance-act',
      phase: { kind: 'battle-victory', final: false },
    };
    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
    expect(restored!.pending).toBe('advance-act');
  });

  it('a verdict-phase state round-trips deep-equal', () => {
    const base = midRunState(SEED);
    const state: GameState = { ...base, act: 4, place: 3, phase: { kind: 'verdict', outcome: 'cast-down' } };
    const restored = decodeSave(encodeSave(state));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
  });
});

// ------- #0a — the two NEW optional fields are additive, so no SAVE_VERSION bump -------------

describe('#0a legacy-save guard: a save written before this unit still loads and behaves', () => {
  // The unit adds exactly two optional fields — `ActiveCondition.onsetDone` (G23) and
  // `BattleState.playerAdvantage` (G12) — and each has a fallback that reproduces the OLD
  // behaviour when absent. That is the whole basis for not bumping `SAVE_VERSION`, so it is
  // asserted rather than assumed: a save with neither key must decode and tick as before.

  it('SAVE_VERSION is unchanged by this unit', () => {
    expect(SAVE_VERSION).toBe(8);
  });

  it('a battle saved with NO playerAdvantage decodes, and reads as "no standing modifier"', () => {
    const base = midRunState(SEED);
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(SEED));
    const battle = createBattle(base.player!, enemy, 1); // no opts -> the key is absent
    expect('playerAdvantage' in battle).toBe(false);
    const state: GameState = {
      ...base,
      phase: { kind: 'battle', battle, started: true, final: false },
    };
    const encoded = encodeSave(state);
    expect(encoded).not.toContain('playerAdvantage'); // it is not even written
    const restored = decodeSave(encoded);
    expect(restored).toEqual(state);
    if (restored!.phase.kind === 'battle') {
      expect(restored!.phase.battle.playerAdvantage).toBeUndefined();
    }
  });

  it('a condition saved with NO onsetDone decodes and ticks exactly as it did before', () => {
    // Hand-built in the PRE-flag shape (three fields only) at its mid-life point. The fallback
    // is the old inference `remainingTurns < maxTurns`, so this must take its ACTIVE tick and
    // deal its 1 damage — the behaviour the shipped engine had.
    const base = midRunState(SEED);
    const legacy = { type: 'bleed', remainingTurns: 1, maxTurns: 2 } as ActiveCondition;
    const player = { ...base.player!, activeConditions: [legacy], hp: 20, maxHp: 20 };
    const enemy = generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(SEED));
    const state: GameState = { ...base, player };

    const encoded = encodeSave(state);
    expect(encoded).not.toContain('onsetDone');
    const restored = decodeSave(encoded);
    expect(restored).toEqual(state);

    const revived = restored!.player!.activeConditions[0]!;
    expect('onsetDone' in revived).toBe(false);
    const ticked = tickConditions({ ...player, activeConditions: [revived] }, enemy, () => 0.5);
    expect(ticked.hpDelta).toBe(-1);
    expect(ticked.events).toEqual([
      { kind: 'condition-damage', subject: 'player', conditionType: 'bleed', amount: 1 },
    ]);
  });
});
