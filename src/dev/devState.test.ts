// The developer state panel's PURE core — determinism, validity, and the save round trip.
//
// EVERY EXPECTED VALUE HERE IS DERIVED, NOT MEASURED. The level anchors come from
// `cumulativeXpForLevel(L) = L * (L - 1)` read as a formula; the rarity band from
// `RARITY_TABLE` read as a table; the karma lattice from `KARMA_DELTAS`. Nothing below was
// obtained by running the code and writing down what it printed — a test built that way
// passes by construction and proves nothing.
//
// The player-facing anchors (endings, the Judged spare, the Hollow gate, the no-flee rule,
// the karma-leak sweep) live in `observable.test.ts`, which drives the REAL `step`.

import { STARTING_CONSUMABLES } from '../game/player.ts';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEV_PRESETS,
  KARMA_AXES,
  KARMA_MAX,
  KARMA_MIN,
  affixOptions,
  applyEdits,
  applyJump,
  applyPlayerEdits,
  bossOptions,
  buildJump,
  catalogOptions,
  createOnce,
  decideAdopt,
  devStatus,
  editsFrom,
  encodeBundle,
  encounterTarget,
  familyOptions,
  getPreset,
  grantIntoState,
  grantItem,
  levelTo,
  normalizeKarma,
  parseBundle,
  parseField,
  presetSpec,
  survivesSaveRoundTrip,
  validateJump,
  withUnlocks,
  EDITABLE_FIELDS,
  type JumpBundle,
  type JumpRejection,
} from './devState.ts';
import { createRng } from '../game/rng.ts';
import { createPlayer, rollStartStats } from '../game/player.ts';
import { cumulativeXpForLevel, levelForXp } from '../game/progression.ts';
import { RARITY_TABLE } from '../game/rarityGen.ts';
import { BOSSES } from '../game/boss.ts';
import { MOMENTUM_CAP } from '../game/classKit.ts';
import { getCatalogItemById } from '../game/item.ts';
import { characterSheet, consumableOptions, displayPlayer } from '../desktop/view-model.ts';
import { saveRun, loadRun } from '../desktop/persist.ts';
import { heuristicPolicy, runToTerminal } from '../game/sim.ts';
import { step } from '../game/game.ts';

// `persist.ts` reads the global `localStorage` at call time; the in-memory stand-in is the
// idiom `persist.test.ts` established, so the REAL `saveRun`/`loadRun` run headlessly.
function installMemoryLocalStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (cells.has(k) ? cells.get(k)! : null),
    setItem: (k: string, v: string) => void cells.set(k, v),
    removeItem: (k: string) => void cells.delete(k),
    clear: () => cells.clear(),
  };
  return cells;
}

/** A deep clone through JSON — used to break a bundle without disturbing the original. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// =========================================================================================
// 1. Determinism. Everything else in this file assumes it.
// =========================================================================================

describe('buildJump is a pure function of its spec', () => {
  it('the same spec twice is deep-equal', () => {
    const spec = { act: 3, xp: 90, karma: { mercyCruelty: 2 } };
    expect(buildJump(spec)).toEqual(buildJump(spec));
  });

  it('the same spec twice is byte-identical, not merely deep-equal', () => {
    // Stronger than `toEqual`: key ORDER matters to `encodeSave`, which is what the save
    // round trip compares. A build that produced the same fields in a different order would
    // pass the assertion above and fail its own save.
    const spec = { act: 5, xp: 500, target: { kind: 'boss', bossId: 'hollow' } } as const;
    expect(JSON.stringify(buildJump(spec))).toBe(JSON.stringify(buildJump(spec)));
  });

  it('a different seed really threads through to a different state', () => {
    // Non-vacuity for the two assertions above: if the seed were ignored, they would hold
    // trivially and `buildJump` would be a constant.
    const a = buildJump({ act: 2, xp: 30, seed: 1 });
    const b = buildJump({ act: 2, xp: 30, seed: 999 });
    expect(a.state).not.toEqual(b.state);
    expect(a.meta.runSeed).toBe(1);
    expect(b.meta.runSeed).toBe(999);
    // And the difference is in the ROLLED content, not just the recorded seed.
    expect(a.state.player!.stats).not.toEqual(b.state.player!.stats);
  });

  it('defaults the seed to 1, so a preset needs no seed to be reproducible', () => {
    expect(buildJump({ act: 1, xp: 0 })).toEqual(buildJump({ act: 1, xp: 0, seed: 1 }));
  });

  it('draws nothing from a clock or an unseeded source (the whole module, as source)', () => {
    // Behavioural half of the no-clock rule: two builds a moment apart are identical, which
    // could not hold if anything here read `Date.now()`. The SOURCE half is in
    // `exclusion.test.ts`, which scans every file in this directory.
    const first = buildJump({ act: 4, xp: 240 });
    const second = buildJump({ act: 4, xp: 240 });
    expect(first).toEqual(second);
  });
});

// =========================================================================================
// 2. The growth fast-forward runs the engine's own level-up, rather than writing a number.
// =========================================================================================

describe('the jumped character is grown by the engine, not stamped', () => {
  it('level always equals levelForXp(xp)', () => {
    // Derived from `cumulativeXpForLevel(L) = L * (L - 1)`:
    //   xp 0   -> 1  (2*1 = 2 > 0)
    //   xp 2   -> 2  (2*1 = 2 <= 2, 3*2 = 6 > 2)
    //   xp 12  -> 4  (4*3 = 12 <= 12, 5*4 = 20 > 12)
    //   xp 240 -> 16 (16*15 = 240 <= 240, 17*16 = 272 > 240)
    //   xp 500 -> 22 (22*21 = 462 <= 500, 23*22 = 506 > 500)
    const expected: [number, number][] = [
      [0, 1],
      [2, 2],
      [12, 4],
      [240, 16],
      [500, 22],
    ];
    for (const [xp, level] of expected) {
      expect(cumulativeXpForLevel(level), `L*(L-1) for ${level}`).toBeLessThanOrEqual(xp);
      expect(cumulativeXpForLevel(level + 1), `L*(L-1) for ${level + 1}`).toBeGreaterThan(xp);
      expect(buildJump({ act: 1, xp }).state.player!.level, `xp ${xp}`).toBe(level);
    }
  });

  it('and the max-HP pool really grew with it (the fast-forward ran)', () => {
    // A level-16 character carrying a level-1 HP pool is the defect this guards. `maxHp`
    // grows by `max(hitDie + CONmod, 1) >= 1` per level, so 15 level-ups add at least 15.
    const fresh = buildJump({ act: 1, xp: 0 }).state.player!;
    const grown = buildJump({ act: 4, xp: 240 }).state.player!;
    expect(grown.level).toBe(16);
    expect(grown.maxHp).toBeGreaterThanOrEqual(fresh.maxHp + 15);
  });

  it('for every xp >= 12 the pool strictly exceeds a fresh level-1 character', () => {
    const fresh = buildJump({ act: 1, xp: 0 }).state.player!.maxHp;
    for (const xp of [12, 20, 30, 90, 240, 500]) {
      expect(buildJump({ act: 1, xp }).state.player!.maxHp, `xp ${xp}`).toBeGreaterThan(fresh);
    }
  });

  it('a jumped character arrives at FULL hp, so the pool it was given is usable', () => {
    const player = buildJump({ act: 5, xp: 500 }).state.player!;
    expect(player.hp).toBe(player.maxHp);
  });

  it('levelTo is bounded — a guard of 0 drains nothing and still returns a valid player', () => {
    // The polarity of the loop's guard: with no budget it must leave the player alone, not
    // spin and not corrupt. (The pending level-up is then real, which `validateJump` catches.)
    const { rng } = createRng(7);
    const base = createPlayer({ name: 'X', classId: 'Enforcer', stats: rollStartStats(rng) });
    const owing = { ...base, xp: 240 };
    expect(levelTo(owing, rng, 0)).toEqual(owing);
    expect(levelTo(owing, rng, 500).level).toBe(levelForXp(240));
  });
});

// =========================================================================================
// 3. `place` is DERIVED. `advanceAct` maintains `place === act - 1`; the theme and the floor
//    names read it, so a jump that gets it wrong themes the wrong floor.
// =========================================================================================

describe('act and place cannot disagree', () => {
  it('place is act - 1 for every act', () => {
    for (let act = 1; act <= 5; act += 1) {
      expect(buildJump({ act, xp: 0 }).state.place).toBe(act - 1);
    }
  });

  it('and a state where they DO disagree is refused', () => {
    const bundle = buildJump({ act: 3, xp: 30 });
    const broken = clone(bundle);
    broken.state.place = broken.state.act; // the exact off-by-one `decodeSave` waves through
    expect(validateJump(broken)).toContain('place-not-act-minus-one');
    // ...and the save envelope really does NOT catch it, which is why the guard exists.
    expect(survivesSaveRoundTrip(broken.state)).toBe(true);
  });
});

// =========================================================================================
// 4. `validateJump` — one named reason per invariant, each driven red on its own.
// =========================================================================================

describe('validateJump names exactly what is wrong', () => {
  const good = (): JumpBundle => buildJump({ act: 3, xp: 90, target: { kind: 'hub' } });

  it('accepts a well-formed bundle with no reasons at all', () => {
    expect(validateJump(good())).toEqual([]);
  });

  /** Each row breaks ONE invariant and names the reason it must produce. */
  const BREAKAGES: readonly [string, (b: JumpBundle) => void, JumpRejection][] = [
    ['place is not act - 1', (b) => void (b.state.place = b.state.act), 'place-not-act-minus-one'],
    ['no player at a hub', (b) => void (b.state.player = null), 'player-missing'],
    ['hp above maxHp', (b) => void (b.state.player!.hp = b.state.player!.maxHp + 1), 'hp-out-of-range'],
    ['hp below 1', (b) => void (b.state.player!.hp = 0), 'hp-out-of-range'],
    ['level does not match xp', (b) => void (b.state.player!.level += 1), 'level-not-from-xp'],
    ['a non-integer karma axis', (b) => void (b.state.karma.mercyCruelty = 1.5), 'karma-not-integer'],
    [
      'a karma axis out of range',
      (b) => void (b.state.karma.clarityDelusion = KARMA_MAX + 1),
      'karma-out-of-range',
    ],
    [
      'a backpack item that resolves to nothing',
      (b) => void b.state.player!.inventory.backpack.push({ defId: 'no-such-item-anywhere' }),
      'item-unresolvable',
    ],
    [
      'a bossKills entry that is not a boss',
      (b) => void b.meta.runSummary.bossKills.push('warden' as never),
      'boss-kill-unknown',
    ],
    [
      'more charges than the maximum',
      (b) => void (b.state.player!.skillCharges = b.state.player!.maxSkillCharges + 1),
      'charges-out-of-range',
    ],
  ];

  it('has ten breakages to check, so the sweep below is not an empty loop', () => {
    expect(BREAKAGES).toHaveLength(10);
  });

  for (const [what, breakIt, reason] of BREAKAGES) {
    it(`refuses ${what} with '${reason}'`, () => {
      const bundle = clone(good());
      breakIt(bundle);
      const reasons = validateJump(bundle);
      expect(reasons, `${what} produced no reason at all`).not.toEqual([]);
      expect(reasons).toContain(reason);
    });
  }

  it('every one of the ten produces a DISTINCT reason (no shared "invalid")', () => {
    const produced = new Set<JumpRejection>();
    for (const [, breakIt, reason] of BREAKAGES) {
      const bundle = clone(good());
      breakIt(bundle);
      expect(validateJump(bundle)).toContain(reason);
      produced.add(reason);
    }
    // Nine, not ten: `hp > maxHp` and `hp < 1` are two directions of ONE invariant and
    // deliberately share a reason. Naming that here stops it looking like an oversight.
    expect(produced.size).toBe(9);
  });

  it('the other named invariants are reachable too', () => {
    const cases: readonly [JumpRejection, (b: JumpBundle) => void][] = [
      ['version-not-current', (b) => void ((b.state as { version: number }).version = 7)],
      ['rng-state-not-finite', (b) => void (b.state.rngState = Number.NaN)],
      ['act-out-of-range', (b) => void (b.state.act = 6)],
      ['max-hp-invalid', (b) => void (b.state.player!.maxHp = 0)],
      ['momentum-out-of-range', (b) => void (b.state.player!.momentum = MOMENTUM_CAP + 1)],
      ['corruption-negative', (b) => void (b.state.player!.corruption = -3)],
      ['pending-invalid', (b) => void ((b.state as { pending?: unknown }).pending = 'nonsense')],
      ['unlocks-malformed', (b) => void ((b.state as { unlocks?: unknown }).unlocks = { families: 1 })],
      ['run-summary-not-finite', (b) => void (b.meta.runSummary.maxAct = Number.NaN)],
      ['run-seed-not-finite', (b) => void (b.meta.runSeed = Number.POSITIVE_INFINITY)],
      [
        'empty-draft-offers',
        (b) => void (b.state.phase = { kind: 'level-up-draft', offers: [] }),
      ],
    ];
    for (const [reason, breakIt] of cases) {
      const bundle = clone(good());
      breakIt(bundle);
      expect(validateJump(bundle), reason).toContain(reason);
    }
    expect(cases.length).toBe(11); // PLAN.md #2: the rest and potion counters left the player
  });

  it('a state the ENGINE save would reject is refused, by the engine save itself', () => {
    const bundle = clone(good());
    // A phase kind `decodeSave`'s PHASE_KINDS list does not hold: the engine's own gate,
    // not a re-implementation of it here.
    bundle.state.phase = { kind: 'nonsense' } as never;
    expect(validateJump(bundle)).toContain('save-round-trip-failed');
    expect(survivesSaveRoundTrip(bundle.state)).toBe(false);
  });

  it('and a good state passes that same gate (the round trip is not always false)', () => {
    expect(survivesSaveRoundTrip(good().state)).toBe(true);
  });

  it('a player is only required where the engine would dereference one', () => {
    // `requirePlayer` throws in `main-menu`; it is never reached at `title`. A guard that
    // demanded a player everywhere would refuse a legitimate pre-character state.
    const hub = clone(good());
    hub.state.player = null;
    expect(validateJump(hub)).toContain('player-missing');

    const title = clone(good());
    title.state.player = null;
    title.state.phase = { kind: 'title' };
    expect(validateJump(title)).not.toContain('player-missing');
  });
});

// =========================================================================================
// 5. `decideAdopt` — BOTH directions. Refusing everything makes the panel useless; adopting
//    everything is how a hand-edited paste crashes the renderer.
// =========================================================================================

describe('decideAdopt', () => {
  it('accepts a valid bundle', () => {
    expect(decideAdopt(buildJump({ act: 2, xp: 30 }))).toEqual({ ok: true });
  });

  it('refuses an invalid one and hands back the reasons', () => {
    const bundle = clone(buildJump({ act: 2, xp: 30 }));
    bundle.state.player!.hp = 0;
    const decision = decideAdopt(bundle);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reasons).toContain('hp-out-of-range');
  });

  it('refuses on ANY reason, not only the first invariant it happens to check', () => {
    // A `decideAdopt` that only consulted one invariant would pass the test above.
    for (const breakIt of [
      (b: JumpBundle) => void (b.state.place = b.state.act),
      (b: JumpBundle) => void (b.state.player!.level = 99),
      (b: JumpBundle) => void (b.meta.runSummary.bossKills.push('nope' as never)),
    ]) {
      const bundle = clone(buildJump({ act: 2, xp: 30 }));
      breakIt(bundle);
      expect(decideAdopt(bundle).ok).toBe(false);
    }
  });
});

// =========================================================================================
// 5b. The four decisions that used to live inside the panel's DOM closures, where no test
//     could reach them. Extracted on purpose: each one's inversion is SILENT, so each is
//     behaviourally pinned here instead of declared unpinnable.
// =========================================================================================

describe('applyJump — the one door every jump goes through', () => {
  /** An adopt stand-in that records what it was handed. */
  function recording(accepts = true) {
    const seen: JumpBundle[] = [];
    return { seen, adopt: (b: JumpBundle) => (seen.push(b), accepts) };
  }

  it('a valid bundle is adopted, and the adopter really receives it', () => {
    const bundle = buildJump({ act: 2, xp: 30 });
    const { seen, adopt } = recording();
    expect(applyJump(bundle, adopt)).toEqual({ kind: 'applied' });
    expect(seen).toEqual([bundle]);
  });

  it('an INVALID bundle never reaches the adopter — the live state stays untouched', () => {
    // The safety property, and the reason the order of the two checks matters. Inverted,
    // this adopts exactly the states that cannot be rendered.
    const bundle = clone(buildJump({ act: 2, xp: 30 }));
    bundle.state.player = null;
    const { seen, adopt } = recording();
    const outcome = applyJump(bundle, adopt);
    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.reasons).toContain('player-missing');
    expect(seen, 'a refused bundle was handed to the adopter anyway').toEqual([]);
  });

  it('a busy renderer is reported as busy, not as applied', () => {
    const bundle = buildJump({ act: 2, xp: 30 });
    const { seen, adopt } = recording(false);
    expect(applyJump(bundle, adopt)).toEqual({ kind: 'busy' });
    // It was OFFERED — the refusal came from the renderer, not from validation.
    expect(seen).toEqual([bundle]);
  });

  it('the three outcomes are distinguishable, and each is reachable', () => {
    // Non-vacuity: a function that always returned one of them would satisfy any single
    // assertion above.
    const good = buildJump({ act: 1, xp: 0 });
    const bad = clone(good);
    bad.state.place = bad.state.act;
    const kinds = [
      applyJump(good, () => true).kind,
      applyJump(good, () => false).kind,
      applyJump(bad, () => true).kind,
    ];
    expect(kinds).toEqual(['applied', 'busy', 'refused']);
  });
});

describe('createOnce — the latch behind the loud session warning', () => {
  it('is true the first time and false ever after', () => {
    const once = createOnce();
    expect(once()).toBe(true);
    expect(once()).toBe(false);
    expect(once()).toBe(false);
  });

  it('each latch is independent (it is not a module-level flag)', () => {
    const a = createOnce();
    const b = createOnce();
    expect(a()).toBe(true);
    expect(b(), 'one latch consumed another').toBe(true);
  });

  it('fires EXACTLY once over many calls — never zero, never twice', () => {
    // Inverted, this never fires at all: the only evidence that a persisted unlock came
    // from a jumped state would silently disappear.
    const once = createOnce();
    const fired = Array.from({ length: 50 }, () => once()).filter(Boolean);
    expect(fired).toHaveLength(1);
  });
});

describe('presetSpec — the live unlock snapshot is CARRIED, never fabricated', () => {
  const preset = DEV_PRESETS[0]!;

  it('carries the live snapshot through when the run has one', () => {
    const live = buildJump({ act: 1, xp: 0 }).state;
    const withUnlocks = { ...live, unlocks: { families: ['gangers'], affixes: ['ancient'] } };
    expect(presetSpec(preset, undefined, withUnlocks).unlocks).toEqual({
      families: ['gangers'],
      affixes: ['ancient'],
    });
  });

  it('leaves the key OFF when there is none — never sets it to undefined', () => {
    // `exactOptionalPropertyTypes`: an `undefined`-valued key would change the save shape.
    const live = buildJump({ act: 1, xp: 0 }).state;
    expect(live.unlocks).toBeUndefined();
    const spec = presetSpec(preset, undefined, live);
    expect('unlocks' in spec, 'the spec fabricated an unlocks key').toBe(false);
  });

  it('the panel seed wins, and the row keeps its own when the field is blank', () => {
    expect(presetSpec(preset, 77, buildJump({ act: 1, xp: 0 }).state).seed).toBe(77);
    expect(presetSpec(preset, undefined, buildJump({ act: 1, xp: 0 }).state).seed).toBe(1);
  });

  it('and the carried snapshot really reaches the built state', () => {
    const live = { ...buildJump({ act: 1, xp: 0 }).state, unlocks: { families: ['grief'], affixes: [] } };
    const bundle = buildJump(presetSpec(preset, undefined, live));
    expect(bundle.state.unlocks).toEqual({ families: ['grief'], affixes: [] });
    expect(validateJump(bundle)).toEqual([]);
  });
});

describe('encounterTarget — the "(no affix)" row must mean NO KEY', () => {
  it('an empty affix id leaves the key OFF, never sets it to an empty string', () => {
    // `buildPhase` looks an affix up by id; `affixId: ''` resolves to nothing and is silently
    // ignored, so the difference is invisible in behaviour and loud in the save shape.
    const target = encounterTarget('theJudged', '');
    expect(target).toEqual({ kind: 'encounter', familyId: 'theJudged' });
    expect('affixId' in target).toBe(false);
  });

  it('a real affix id is carried through', () => {
    expect(encounterTarget('theJudged', 'blessed')).toEqual({
      kind: 'encounter',
      familyId: 'theJudged',
      affixId: 'blessed',
    });
  });

  it('and the two really produce different enemies (the flag is read, not decoration)', () => {
    // Non-vacuity: both jumps build, both validate, and the affixed one is marked as elite.
    const plain = buildJump({ act: 4, xp: 240, target: encounterTarget('theJudged', '') });
    const elite = buildJump({ act: 4, xp: 240, target: encounterTarget('theJudged', 'blessed') });
    const enemyOf = (b: JumpBundle) =>
      b.state.phase.kind === 'battle' ? b.state.phase.battle.enemy : null;
    expect(enemyOf(plain)!.affixId).toBeUndefined();
    expect(enemyOf(elite)!.affixId).toBe('blessed');
    // The affix prefixes the name, which is how the author will SEE that it took.
    expect(enemyOf(elite)!.fullName).not.toBe(enemyOf(plain)!.fullName);
    expect(validateJump(elite)).toEqual([]);
  });
});

describe('parseField — BLANK and ZERO are different answers', () => {
  it('a blank box is undefined, NOT zero', () => {
    // The whole point. Returning 0 here compiles, passes every other test, and then makes
    // "Apply edits" ZERO momentum, corruption, potions, rests and charges on every press —
    // because `editsFrom` would produce a key for every untouched field.
    expect(parseField('')).toBeUndefined();
    expect(parseField('   ')).toBeUndefined();
    expect(parseField('\t\n')).toBeUndefined();
  });

  it('an explicit zero IS zero — the value an inverted check would eat', () => {
    expect(parseField('0')).toBe(0);
    expect(parseField(' 0 ')).toBe(0);
  });

  it('reads ordinary numbers, including negatives and decimals', () => {
    expect(parseField('7')).toBe(7);
    expect(parseField('-3')).toBe(-3);
    expect(parseField('2.5')).toBe(2.5);
  });

  it('garbage is undefined rather than NaN — NaN would reach the state', () => {
    // `decodeSave` rejects a non-finite number outright, so a NaN escaping here would build a
    // state its own save refuses. Undefined means "leave it alone", which is always safe.
    for (const text of ['abc', '1/2', 'Infinity', '-Infinity', 'NaN', '1e', '--4']) {
      expect(parseField(text), text).toBeUndefined();
    }
  });

  it('and the consequence, end to end: a blank form leaves the character untouched', () => {
    // The behaviour the unit actually promises, not the helper's return value.
    const state = buildJump({ act: 3, xp: 90, edits: { skillCharges: 4, momentum: 3 } }).state;
    const blankForm = editsFrom({
      hp: parseField(''),
      maxHp: parseField(''),
      skillCharges: parseField(''),
      momentum: parseField(''),
      corruption: parseField(''),
    });
    expect(blankForm).toEqual({});
    expect(applyEdits(state, blankForm)).toEqual(state);
    expect(state.player!.skillCharges).toBe(4);
    expect(state.player!.momentum).toBe(3);
  });
});

describe('editsFrom — a blank field means "leave this alone"', () => {
  it('drops every undefined value rather than making it a key', () => {
    const edits = editsFrom({ hp: 5, maxHp: undefined, corruption: 0 });
    expect(edits).toEqual({ hp: 5, corruption: 0 });
    expect('maxHp' in edits, 'a blank field became an undefined-valued key').toBe(false);
  });

  it('an all-blank form produces no edits at all', () => {
    expect(editsFrom({})).toEqual({});
    // ...and applying it changes nothing, which is the behaviour that matters.
    const state = buildJump({ act: 2, xp: 30 }).state;
    expect(applyEdits(state, editsFrom({}))).toEqual(state);
  });

  it('keeps ZERO, which is a real value and the one an inverted check would eat', () => {
    expect(editsFrom({ corruption: 0 }).corruption).toBe(0);
  });

  it('covers every field the panel offers', () => {
    const all = Object.fromEntries(EDITABLE_FIELDS.map((k) => [k, 1]));
    expect(Object.keys(editsFrom(all)).sort()).toEqual([...EDITABLE_FIELDS].sort());
    expect(EDITABLE_FIELDS).toHaveLength(5); // PLAN.md #2: the rest and potion counters removed
  });
});

describe('withUnlocks — carried, never fabricated', () => {
  it('carries the snapshot when the live run has one', () => {
    const live = { ...buildJump({ act: 1, xp: 0 }).state, unlocks: { families: ['rage'], affixes: [] } };
    expect(withUnlocks({ act: 1, xp: 0 }, live).unlocks).toEqual({ families: ['rage'], affixes: [] });
  });

  it('leaves the key OFF when it has none', () => {
    const live = buildJump({ act: 1, xp: 0 }).state;
    const spec = withUnlocks({ act: 1, xp: 0 }, live);
    expect('unlocks' in spec).toBe(false);
  });

  it('never mutates the spec it was handed', () => {
    const live = { ...buildJump({ act: 1, xp: 0 }).state, unlocks: { families: [], affixes: [] } };
    const spec = { act: 1, xp: 0 };
    withUnlocks(spec, live);
    expect('unlocks' in spec).toBe(false);
  });
});

describe('grantIntoState — a grant advances the run’s own RNG stream', () => {
  it('refuses when there is no character, leaving the state exactly as it was', () => {
    const bundle = clone(buildJump({ act: 1, xp: 0 }));
    bundle.state.player = null;
    bundle.state.phase = { kind: 'title' };
    const result = grantIntoState(bundle.state, { catalogId: 'suture-kit' });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(bundle.state);
  });

  it('grants when there is one, and reports that it did', () => {
    const state = buildJump({ act: 1, xp: 0 }).state;
    const result = grantIntoState(state, { catalogId: 'suture-kit' });
    expect(result.ok).toBe(true);
    // PLAN.md #2: a fresh character already carries §22.6's starting kit; the grant is appended.
    expect(result.state.player!.inventory.backpack.map((i) => i.defId)).toEqual([...STARTING_CONSUMABLES, 'suture-kit']);
  });

  it('a ROLLED grant advances rngState; a catalog grant spends no draw', () => {
    // The discipline `step`'s `finish` uses: the jumped state stays a valid CONTINUATION of
    // its own stream rather than a fork of it. `generateItem` draws exactly twice.
    const state = buildJump({ act: 1, xp: 0 }).state;
    const rolled = grantIntoState(state, { generated: { slot: 'ring', rarity: 'Rare' } });
    expect(rolled.state.rngState).not.toBe(state.rngState);
    const catalog = grantIntoState(state, { catalogId: 'suture-kit' });
    expect(catalog.state.rngState).toBe(state.rngState);
  });

  it('the resulting state still validates and still saves', () => {
    const bundle = buildJump({ act: 3, xp: 90 });
    const result = grantIntoState(bundle.state, {
      generated: { slot: 'mainHand', rarity: 'Legendary' },
      equip: true,
    });
    expect(validateJump({ ...bundle, state: result.state })).toEqual([]);
  });

  it('never mutates the state it was given', () => {
    const state = buildJump({ act: 1, xp: 0 }).state;
    const before = JSON.stringify(state);
    grantIntoState(state, { generated: { slot: 'ring', rarity: 'Legendary' } });
    expect(JSON.stringify(state)).toBe(before);
  });
});

// =========================================================================================
// 6. The preset table. Swept whole, with its own size pinned so the sweep cannot pass over
//    an empty or truncated collection.
// =========================================================================================

describe('DEV_PRESETS', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('has ten rows with unique ids', () => {
    expect(DEV_PRESETS).toHaveLength(10);
    expect(new Set(DEV_PRESETS.map((p) => p.id)).size).toBe(10);
    for (const preset of DEV_PRESETS) {
      expect(preset.label.length, preset.id).toBeGreaterThan(0);
      expect(getPreset(preset.id)).toBe(preset);
    }
    expect(getPreset('no-such-preset')).toBeUndefined();
  });

  it('every row builds a bundle with NO validation reason', () => {
    let checked = 0;
    for (const preset of DEV_PRESETS) {
      expect(validateJump(buildJump(preset.spec)), preset.id).toEqual([]);
      checked += 1;
    }
    expect(checked).toBe(10);
  });

  it('every row survives the REAL saveRun -> loadRun, deep-equal in all three parts', () => {
    // The acceptance gate, run through the shipping envelope rather than a stand-in for it:
    // `decodeSave` for the state, `decodeRunSummary` for the meta, the memory rebuild for
    // the story so far. A jump that cannot survive its own save is not a valid state.
    let checked = 0;
    for (const preset of DEV_PRESETS) {
      const bundle = buildJump(preset.spec);
      saveRun(bundle.state, bundle.memory, bundle.meta);
      const loaded = loadRun();
      expect(loaded, preset.id).not.toBeNull();
      expect(loaded!.state, `${preset.id} state`).toEqual(bundle.state);
      expect(loaded!.memory, `${preset.id} memory`).toEqual(bundle.memory);
      expect(loaded!.meta, `${preset.id} meta`).toEqual(bundle.meta);
      checked += 1;
    }
    expect(checked).toBe(10);
  });

  it('...and that round trip really can fail (non-vacuity for the sweep above)', () => {
    // If `loadRun` returned the saved object by reference, or `saveRun` were a no-op that
    // left a previous good envelope in place, the sweep would pass without proving anything.
    const bundle = buildJump({ act: 1, xp: 0 });
    saveRun(bundle.state, bundle.memory, bundle.meta);
    localStorage.setItem('thevoid:run', '{ not json');
    expect(loadRun()).toBeNull();
  });

  it('every row is PLAYABLE — the real step reaches a terminal phase, no soft-lock', () => {
    const GUARD = 40_000;
    const outcomes = new Set<string>();
    let checked = 0;
    for (const preset of DEV_PRESETS) {
      const bundle = buildJump(preset.spec);
      const result = runToTerminal(bundle.state, heuristicPolicy(bundle.state.player!.classId), GUARD);
      expect(result.steps, `${preset.id} hit the step guard — it soft-locks`).toBeLessThan(GUARD);
      outcomes.add(result.outcome);
      checked += 1;
    }
    expect(checked).toBe(10);
    // "It terminated" must not be satisfiable by everything dying instantly: the table has
    // to reach all three endings between them.
    expect([...outcomes].sort()).toEqual(['damnation', 'death', 'grace']);
  });
});

// =========================================================================================
// 7. Karma normalisation — the reachable lattice is the INTEGERS in [-25, 25].
// =========================================================================================

describe('normalizeKarma', () => {
  it('fills every missing axis with zero', () => {
    expect(normalizeKarma(undefined)).toEqual({
      mercyCruelty: 0,
      restraintGreed: 0,
      reverenceDesecration: 0,
      clarityDelusion: 0,
    });
    expect(normalizeKarma({ mercyCruelty: 3 })).toEqual({
      mercyCruelty: 3,
      restraintGreed: 0,
      reverenceDesecration: 0,
      clarityDelusion: 0,
    });
  });

  it('rounds to the integer lattice — every KARMA_DELTAS entry is an integer', () => {
    expect(normalizeKarma({ mercyCruelty: 1.4 }).mercyCruelty).toBe(1);
    expect(normalizeKarma({ mercyCruelty: -1.6 }).mercyCruelty).toBe(-2);
  });

  it('clamps both ends, and rejects the values decodeSave would refuse', () => {
    expect(normalizeKarma({ clarityDelusion: 900 }).clarityDelusion).toBe(KARMA_MAX);
    expect(normalizeKarma({ clarityDelusion: -900 }).clarityDelusion).toBe(KARMA_MIN);
    // NaN / Infinity are exactly what `decodeSave#isValidKarma` refuses; the clamp must not
    // let one through into a state whose own save would then be rejected.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const karma = normalizeKarma({ mercyCruelty: bad });
      expect(Number.isFinite(karma.mercyCruelty), String(bad)).toBe(true);
    }
  });

  it('a spec with an extreme axis still builds a bundle its own save accepts', () => {
    const bundle = buildJump({ act: 4, xp: 240, karma: { reverenceDesecration: 10_000 } });
    expect(bundle.state.karma.reverenceDesecration).toBe(KARMA_MAX);
    expect(validateJump(bundle)).toEqual([]);
  });

  it('names all four axes (a three-axis sweep would silently skip one)', () => {
    expect([...KARMA_AXES].sort()).toEqual([
      'clarityDelusion',
      'mercyCruelty',
      'restraintGreed',
      'reverenceDesecration',
    ]);
  });
});

// =========================================================================================
// 8. Grants. The equip goes through the REAL `equip()` — never a write into `slots`, which
//    is the shape that hid G11.
// =========================================================================================

describe('grantItem', () => {
  it('a catalog consumable reaches the Use-item picker BY NAME', () => {
    // `consumableOptions` is the exact projection the battle Use-item picker renders, so
    // this is "the granted item is really usable", not "an object landed in an array".
    const before = buildJump({ act: 1, xp: 0 }).state.player!;
    const baseline = consumableOptions(before).length;
    const after = buildJump({ act: 1, xp: 0, grants: [{ catalogId: 'suture-kit' }] }).state.player!;
    const options = consumableOptions(after);
    expect(options.length).toBe(baseline + 1);
    expect(options.map((o) => o.name)).toContain(getCatalogItemById('suture-kit')!.name);
  });

  it('an unresolvable catalog id grants NOTHING rather than an unresolvable instance', () => {
    const player = buildJump({ act: 1, xp: 0, grants: [{ catalogId: 'not-a-real-id' }] }).state.player!;
    expect(player.inventory.backpack).toHaveLength(STARTING_CONSUMABLES.length); // the kit, and nothing granted
    // ...and therefore the bundle still validates, instead of tripping 'item-unresolvable'.
    expect(validateJump(buildJump({ act: 1, xp: 0, grants: [{ catalogId: 'nope' }] }))).toEqual([]);
  });

  it('a generated Legendary mainHand equips through equip() and shows on the sheet', () => {
    const bundle = buildJump({
      act: 1,
      xp: 0,
      grants: [{ generated: { slot: 'mainHand', rarity: 'Legendary' }, equip: true }],
    });
    const player = bundle.state.player!;
    const equipped = characterSheet(player).equipped.find((row) => row.slot === 'mainHand');
    expect(equipped?.name).toBe('Legendary mainHand');
    // The magnitude band is read off RARITY_TABLE as a SPECIFICATION, never off a roll:
    // Legendary is statBase 6 + randInt(rng, statSpread 4) in [0, 3] => [6, 9].
    const tier = RARITY_TABLE.Legendary;
    const low = tier.statBase;
    const high = tier.statBase + tier.statSpread - 1;
    expect([low, high]).toEqual([6, 9]);
    const rolled = player.inventory.slots.mainHand!.rolled!;
    const bonus = rolled.effects.find((e) => e.type === 'bonusDamage');
    expect(bonus, 'the generated weapon carries no damage bonus at all').toBeDefined();
    const amount = (bonus as { params: Record<string, number> }).params.amount!;
    expect(amount).toBeGreaterThanOrEqual(low);
    expect(amount).toBeLessThanOrEqual(high);
  });

  it('a grant WITHOUT equip stays in the backpack (the flag is read, not ignored)', () => {
    const bundle = buildJump({
      act: 1,
      xp: 0,
      grants: [{ generated: { slot: 'mainHand', rarity: 'Legendary' } }],
    });
    const player = bundle.state.player!;
    expect(player.inventory.backpack).toHaveLength(STARTING_CONSUMABLES.length + 1);
    // The starting sword is still equipped — the grant displaced nothing.
    expect(player.inventory.slots.mainHand!.rolled).toBeUndefined();
  });

  it('a USABLE cannot be equipped, because the real equip() refuses it (G11 shape)', () => {
    // The mutation this catches: writing `inventory.slots[slot] = item` directly. That would
    // put a Suture Kit in a paperdoll slot, which the engine would never do — and it is
    // exactly how the equip path stopped being validated in the first place.
    const bundle = buildJump({
      act: 1,
      xp: 0,
      grants: [{ catalogId: 'suture-kit', equip: true }],
    });
    const player = bundle.state.player!;
    const slotted = Object.values(player.inventory.slots).filter((i) => i?.defId === 'suture-kit');
    expect(slotted, 'a consumable was forced into a paperdoll slot').toHaveLength(0);
    expect(player.inventory.backpack.map((i) => i.defId)).toContain('suture-kit');
  });

  it('a rolled ring honours the stat it was asked for', () => {
    const bundle = buildJump({
      act: 1,
      xp: 0,
      grants: [{ generated: { slot: 'ring', rarity: 'Rare', stat: 'CON' } }],
    });
    const rolled = bundle.state.player!.inventory.backpack.at(-1)!.rolled!;
    const effect = rolled.effects[0] as { type: string; params: Record<string, number> };
    expect(effect.type).toBe('bonusStat');
    expect(Object.keys(effect.params)).toEqual(['con']);
  });

  it('grants are applied IN ORDER, so a spec is reproducible from its list', () => {
    const bundle = buildJump({
      act: 1,
      xp: 0,
      grants: [{ catalogId: 'suture-kit' }, { catalogId: 'antidote' }],
    });
    expect(bundle.state.player!.inventory.backpack.map((i) => i.defId)).toEqual([
      ...STARTING_CONSUMABLES,
      'suture-kit',
      'antidote',
    ]);
  });

  it('grantItem itself draws from the injected rng, never a private one', () => {
    const player = buildJump({ act: 1, xp: 0 }).state.player!;
    const a = createRng(42);
    const b = createRng(42);
    expect(grantItem(player, { generated: { slot: 'ring', rarity: 'Rare' } }, a.rng)).toEqual(
      grantItem(player, { generated: { slot: 'ring', rarity: 'Rare' } }, b.rng),
    );
    // ...and the stream ADVANCED, so the jump's later draws are a continuation of it.
    expect(a.getState()).not.toBe(42);
  });
});

// =========================================================================================
// 9. Player edits, including the mid-battle both-players rule.
// =========================================================================================

describe('applyPlayerEdits clamps to the invariants rather than trusting the field', () => {
  const player = () => buildJump({ act: 3, xp: 90 }).state.player!;

  it('hp is held inside [1, maxHp] from both ends', () => {
    const p = player();
    expect(applyPlayerEdits(p, { hp: 99_999 }).hp).toBe(p.maxHp);
    expect(applyPlayerEdits(p, { hp: -50 }).hp).toBe(1);
    expect(applyPlayerEdits(p, { hp: 7 }).hp).toBe(7);
  });

  it('lowering maxHp drags hp down with it, in either field order', () => {
    const p = player();
    expect(applyPlayerEdits(p, { maxHp: 5 }).hp).toBe(5);
    expect(applyPlayerEdits(p, { maxHp: 5, hp: 40 }).hp).toBe(5);
  });

  it('charges cannot exceed the maximum, and momentum cannot exceed the cap', () => {
    const p = player();
    expect(applyPlayerEdits(p, { skillCharges: 99 }).skillCharges).toBe(p.maxSkillCharges);
    expect(applyPlayerEdits(p, { skillCharges: -4 }).skillCharges).toBe(0);
    expect(applyPlayerEdits(p, { momentum: 99 }).momentum).toBe(MOMENTUM_CAP);
    expect(applyPlayerEdits(p, { momentum: 3 }).momentum).toBe(3);
  });

  it('counts cannot go negative', () => {
    const p = player();
    expect(applyPlayerEdits(p, { corruption: -1 }).corruption).toBe(0);
    expect(applyPlayerEdits(p, { skillCharges: -1 }).skillCharges).toBe(0);
  });

  it('an empty edit changes nothing at all', () => {
    const p = player();
    expect(applyPlayerEdits(p, {})).toEqual(p);
  });

  it('and never mutates its input', () => {
    const p = player();
    const before = JSON.stringify(p);
    applyPlayerEdits(p, { hp: 1, corruption: 0 });
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('applyEdits writes BOTH players during a battle', () => {
  const inBattle = () =>
    buildJump({ act: 4, xp: 240, target: { kind: 'encounter', familyId: 'theJudged' } });

  it('the battle combatant is what the HUD reads, so it must move', () => {
    const bundle = inBattle();
    const edited = applyEdits(bundle.state, { hp: 1 });
    // `displayPlayer` returns `phase.battle.player` during a battle — the stale hub snapshot
    // would leave the HUD showing the old number.
    expect(displayPlayer(edited)!.hp).toBe(1);
  });

  it('and the hub record moves too, or the edit is reverted when the fight ends', () => {
    const bundle = inBattle();
    const edited = applyEdits(bundle.state, { hp: 1 });
    expect(edited.player!.hp).toBe(1);
    // Prove the consequence rather than assert the field: open the battle and spare, which
    // ends it with `player: battle.player` written back to the hub.
    const opened = step(edited, { kind: 'continue' });
    const spared = step(opened.state, { kind: 'battle-action', action: 'spare' });
    expect(spared.state.phase.kind).toBe('main-menu');
    expect(spared.state.player!.hp).toBe(1);
  });

  it('outside a battle it edits the one player there is', () => {
    const hub = buildJump({ act: 1, xp: 0 });
    const edited = applyEdits(hub.state, { skillCharges: 0 });
    expect(edited.player!.skillCharges).toBe(0);
    expect(displayPlayer(edited)!.skillCharges).toBe(0);
  });

  it('with no player it is a no-op rather than a throw', () => {
    const bundle = clone(buildJump({ act: 1, xp: 0 }));
    bundle.state.player = null;
    bundle.state.phase = { kind: 'title' };
    expect(applyEdits(bundle.state, { hp: 5 })).toEqual(bundle.state);
  });

  it('the edited state still validates and still saves', () => {
    const edited = applyEdits(inBattle().state, { hp: 1, skillCharges: 0, momentum: 5 });
    expect(validateJump({ state: edited, memory: inBattle().memory, meta: inBattle().meta })).toEqual([]);
  });
});

// =========================================================================================
// 10. The state-JSON editor: copy out, paste back.
// =========================================================================================

describe('the state JSON round trip', () => {
  it('copy -> paste is deep-equal', () => {
    const bundle = buildJump({ act: 4, xp: 240, karma: { mercyCruelty: 2 } });
    const parsed = parseBundle(encodeBundle(bundle));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok === true && parsed.bundle).toEqual(bundle);
  });

  it('a corrupted paste is refused with a NAMED reason, one per failure mode', () => {
    const bundle = buildJump({ act: 1, xp: 0 });
    const cases: readonly [string, string][] = [
      ['{ not json', 'not-json'],
      ['[]', 'not-json'],
      [JSON.stringify({ ...bundle, state: { bogus: true } }), 'state-decode-failed'],
      [JSON.stringify({ ...bundle, memory: null }), 'memory-invalid'],
      [JSON.stringify({ ...bundle, meta: null }), 'meta-invalid'],
      [JSON.stringify({ ...bundle, meta: { runSummary: bundle.meta.runSummary } }), 'meta-invalid'],
    ];
    for (const [text, reason] of cases) {
      const parsed = parseBundle(text);
      expect(parsed.ok, reason).toBe(false);
      expect(parsed.ok === false && parsed.reason).toBe(reason);
    }
    expect(cases).toHaveLength(6);
  });

  it('never throws, whatever it is handed', () => {
    for (const text of ['', 'null', 'undefined', '0', '"a string"', '{}']) {
      expect(() => parseBundle(text)).not.toThrow();
      expect(parseBundle(text).ok, text).toBe(false);
    }
  });

  it('a refused paste leaves the caller nothing to adopt (no partial bundle)', () => {
    const parsed = parseBundle('{ not json');
    expect(parsed.ok).toBe(false);
    expect('bundle' in parsed).toBe(false);
  });
});

// =========================================================================================
// 11. The menus the panel renders are built from the real content tables, so an
//     unrepresentable choice is impossible rather than merely refused.
// =========================================================================================

describe('the panel menus come from the shipped data', () => {
  it('every catalog option resolves through getCatalogItemById', () => {
    const options = catalogOptions();
    expect(options.length).toBeGreaterThan(20);
    for (const option of options) {
      expect(getCatalogItemById(option.id), option.id).toBeDefined();
    }
  });

  it('every family option is a real family, and the roster is the full 24', () => {
    const options = familyOptions();
    expect(options).toHaveLength(24);
    expect(options.map((o) => o.id)).toContain('theJudged');
    // The label carries the floor and the karma mark, which is how the author picks one.
    const judged = options.find((o) => o.id === 'theJudged')!;
    expect(judged.label).toContain('floor 4');
    expect(judged.label).toContain('weighted');
    const choir = options.find((o) => o.id === 'choir')!;
    expect(choir.label).not.toContain('weighted');
  });

  it('the affix menu offers the five affixes plus an explicit "none"', () => {
    const options = affixOptions();
    expect(options).toHaveLength(6);
    expect(options[0]!.id).toBe('');
    expect(options.map((o) => o.id)).toContain('blessed');
  });

  it('the boss menu is built from BOSSES, so a bossKills entry always resolves', () => {
    const options = bossOptions();
    expect(options.map((o) => o.id).sort()).toEqual(Object.keys(BOSSES).sort());
    for (const option of options) {
      expect(option.label).toBe(BOSSES[option.id as keyof typeof BOSSES].name);
      // A raw id must never be the label — the run summary prints these.
      expect(option.label).not.toBe(option.id);
    }
  });
});

// =========================================================================================
// 12. The status line the panel prints.
// =========================================================================================

describe('devStatus', () => {
  it('reports the run, and the karma vector, straight off the state', () => {
    const bundle = buildJump({ act: 4, xp: 240, karma: { mercyCruelty: 2, clarityDelusion: -3 } });
    const status = devStatus(bundle.state);
    expect(status).toEqual({
      act: 4,
      place: 3,
      xp: 240,
      level: 16,
      hp: bundle.state.player!.maxHp,
      maxHp: bundle.state.player!.maxHp,
      phase: 'main-menu',
      karma: { mercyCruelty: 2, restraintGreed: 0, reverenceDesecration: 0, clarityDelusion: -3 },
    });
  });

  it('copies the karma vector rather than aliasing it', () => {
    const bundle = buildJump({ act: 1, xp: 0, karma: { mercyCruelty: 1 } });
    const status = devStatus(bundle.state);
    status.karma.mercyCruelty = 99;
    expect(bundle.state.karma.mercyCruelty).toBe(1);
  });

  it('survives a state with no player yet', () => {
    const bundle = clone(buildJump({ act: 1, xp: 0 }));
    bundle.state.player = null;
    bundle.state.phase = { kind: 'title' };
    expect(devStatus(bundle.state).level).toBe(0);
  });
});
