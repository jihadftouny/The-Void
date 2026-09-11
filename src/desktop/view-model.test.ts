import { describe, it, expect } from 'vitest';
import {
  displayPlayer,
  castOptions,
  consumableOptions,
  spareOffered,
  displayItem,
  describeInventory,
  equipFromBackpack,
  unequipSlot,
  characterSheet,
  dealView,
  draftCards,
  chestReveal,
  isRunOver,
  runSummaryView,
  SEED_ROW_LABEL,
  hubMenu,
  fallbackNarration,
  dealDiscardView,
  DEAL_DISCARD_REFUSE,
} from './view-model.ts';
import { buildNarrationPrompt, createStoryMemory, rememberBeat } from '../llm/narrate.ts';
import { createGame, step } from '../game/game.ts';
import type { GameState, Phase } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { emptyRunSummary, FEATS, type RunSummary, type NewlyUnlocked } from '../game/unlockStore.ts';
import { BOSSES } from '../game/boss.ts';
import { CONDITION_DATA } from '../game/condition.ts';
import { getAllRelics, getAllUniques, getAllConsumables } from '../game/item.ts';
import { createPlayer } from '../game/player.ts';
import type { Player } from '../game/player.ts';
import { buildRandomBattle } from '../game/encounter.ts';
import { createBattle } from '../game/battle.ts';
import { generateEnemy } from '../game/enemy.ts';
import { pickUp } from '../game/equipment.ts';
import { playerArmorClass } from '../game/defense.ts';
import { createRng } from '../game/rng.ts';
import { STAT_KEYS } from '../game/character.ts';
import type { Stats } from '../game/character.ts';
import type { ItemInstance } from '../game/item.ts';
import type { SacrificeDeal } from '../game/deal.ts';
import type { DraftOption } from '../game/draft.ts';
import { createKarma } from '../game/karma.ts';

// A whole, undamaged Enforcer with fixed stats. Every stat is 10 → each modifier
// floor((10-10)/2) = 0, so for the Enforcer's d10 hit die maxHp = 10 + 0 = 10 and
// starting hp = maxHp. Deriving the snapshot this way makes "hp === maxHp" a real,
// undamaged character — so the mid-battle value 3 below is a concrete contrast, not
// a number copied from the implementation.
const fixedStats = STAT_KEYS.reduce((acc, k) => {
  acc[k] = 10;
  return acc;
}, {} as Stats);
const snapshot = createPlayer({ name: 'Test', classId: 'Enforcer', stats: fixedStats });

describe('displayPlayer (desktop view-model)', () => {
  it('is a whole, undamaged snapshot to begin with', () => {
    // Independent sanity anchor: full hp, and full hp is NOT 3.
    expect(snapshot.hp).toBe(snapshot.maxHp);
    expect(snapshot.maxHp).toBe(10);
    expect(snapshot.hp).not.toBe(3);
  });

  it('returns the LIVE battle combatant (damaged hp), not the pre-battle snapshot', () => {
    const { rng } = createRng(42);
    const battle = buildRandomBattle(snapshot, 1, rng);
    // Simulate mid-battle damage: the live combatant's hp drops to a fixed value
    // that differs from the undamaged snapshot's hp.
    const damaged = { ...battle, player: { ...battle.player, hp: 3 } };
    const state: GameState = {
      version: 9,
      rngState: 0,
      player: snapshot,
      act: 1,
      place: 0,
      karma: createKarma(),
      phase: { kind: 'battle', battle: damaged, started: true, final: false },
    };
    const shown = displayPlayer(state);
    expect(shown!.hp).toBe(3);
    // Because 3 differs from the snapshot's full hp, an implementation that wrongly
    // returned state.player would fail here.
    expect(shown!.hp).not.toBe(snapshot.hp);
  });

  it('returns the snapshot object outside battle', () => {
    const state: GameState = {
      version: 9,
      rngState: 0,
      player: snapshot,
      act: 1,
      place: 0,
      karma: createKarma(),
      phase: { kind: 'main-menu' },
    };
    expect(displayPlayer(state)).toBe(state.player);
  });

  it('returns null before a player exists (title)', () => {
    const state = createGame(123);
    expect(state.player).toBeNull();
    expect(displayPlayer(state)).toBeNull();
  });
});

// A GameState wrapping a given player at the hub (main-menu). Fixed scalars mirror the
// existing helper above; only `player`/`phase` vary across the cases below.
function hub(player: Player | null): GameState {
  return {
    version: 9,
    rngState: 0,
    player,
    act: 1,
    place: 0,
    karma: createKarma(),
    phase: { kind: 'main-menu' },
  };
}

// Recursively collect every property key in a produced display object — the karma-hidden
// invariant scan. Independent of the impl: it just walks the returned plain data.
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

describe('castOptions (battle Cast picker)', () => {
  // Hand-derived from classKit.coreSkills (Enforcer -> ['heavyStrike','brace']) and skill.ts:
  //   heavyStrike.chargeCost === 2, brace.chargeCost === 1. A fresh player banks 5 charges.
  it('lists the Enforcer core skills with names, costs, and affordability at full charges', () => {
    expect(snapshot.skillCharges).toBe(5);
    expect(castOptions(snapshot)).toEqual([
      { skillId: 'heavyStrike', name: 'Heavy Strike', chargeCost: 2, affordable: true },
      { skillId: 'brace', name: 'Brace', chargeCost: 1, affordable: true },
    ]);
  });

  it('marks a 2-cost skill unaffordable at 1 charge but keeps the 1-cost skill affordable', () => {
    const lowCharge: Player = { ...snapshot, skillCharges: 1 };
    expect(castOptions(lowCharge)).toEqual([
      { skillId: 'heavyStrike', name: 'Heavy Strike', chargeCost: 2, affordable: false },
      { skillId: 'brace', name: 'Brace', chargeCost: 1, affordable: true },
    ]);
  });

  it('is empty for a player with no skills', () => {
    expect(castOptions({ ...snapshot, skillPool: [] })).toEqual([]);
  });

  it('shows floor 5’s warped form — its name and its cost (PLAN.md #2, AC-18)', () => {
    // corruptions.json: warped = +1 cost; dulled = -1 cost. heavyStrike 2 -> 3, brace 1 -> 0.
    // At 2 charges the warped Heavy Strike is no longer affordable, exactly as the engine rules.
    const warped: Player = {
      ...snapshot,
      skillCharges: 2,
      corruptedSkills: { heavyStrike: 'warped', brace: 'dulled' },
    };
    expect(castOptions(warped)).toEqual([
      { skillId: 'heavyStrike', name: 'Heavy Strike (warped)', chargeCost: 3, affordable: false },
      { skillId: 'brace', name: 'Brace (dulled)', chargeCost: 0, affordable: true },
    ]);
  });
});

describe('consumableOptions (battle Use-item picker)', () => {
  // Antidote is a usable (consumables.json: name "Antidote", rarity "Common", non-empty `use`).
  // "Jaaj Sword 1" is legacy gear with no `use`, so it is excluded.
  it('includes only usable consumables, carrying the backpack index as source', () => {
    const backpack: ItemInstance[] = [{ defId: 'antidote' }, { defId: 'Jaaj Sword 1' }];
    const player: Player = {
      ...snapshot,
      inventory: { slots: snapshot.inventory.slots, backpack },
    };
    expect(consumableOptions(player)).toEqual([{ index: 0, name: 'Antidote', rarity: 'Common' }]);
  });

  it('is empty for an empty backpack', () => {
    const empty: Player = { ...snapshot, inventory: { ...snapshot.inventory, backpack: [] } };
    expect(consumableOptions(empty)).toEqual([]);
  });

  it('a fresh character’s starting kit (§22.6, PLAN.md #2) is what the picker offers first', () => {
    // consumables.json: void-draught "Void Draught", suture-kit "Suture Kit", both Common.
    expect(consumableOptions(snapshot)).toEqual([
      { index: 0, name: 'Void Draught', rarity: 'Common' },
      { index: 1, name: 'Suture Kit', rarity: 'Common' },
    ]);
  });
});

describe('spareOffered (battle Spare gate)', () => {
  const { rng } = createRng(7);
  // The legacy path yields karmaWeighted:false; build both enemy kinds independently by
  // overriding that one flag (spareAvailable reads only karmaWeighted && hp > 0).
  const baseEnemy = generateEnemy({ act: 1, playerXp: 0 }, rng);
  const weightedAlive = { ...baseEnemy, karmaWeighted: true, hp: 10 };
  const weightedDead = { ...baseEnemy, karmaWeighted: true, hp: 0 };
  const plainEnemy = { ...baseEnemy, karmaWeighted: false, hp: 10 };

  function battlePhase(enemy: typeof baseEnemy, started: boolean): GameState {
    return { ...hub(snapshot), phase: { kind: 'battle', battle: createBattle(snapshot, enemy, 1), started, final: false } };
  }

  it('is true for a started battle vs a living karma-weighted enemy', () => {
    expect(spareOffered(battlePhase(weightedAlive, true))).toBe(true);
  });
  it('is false when the karma-weighted enemy is dead', () => {
    expect(spareOffered(battlePhase(weightedDead, true))).toBe(false);
  });
  it('is false for a non-weighted enemy', () => {
    expect(spareOffered(battlePhase(plainEnemy, true))).toBe(false);
  });
  it('is false for an un-started battle', () => {
    expect(spareOffered(battlePhase(weightedAlive, false))).toBe(false);
  });
  it('is false outside battle', () => {
    expect(spareOffered(hub(snapshot))).toBe(false);
  });
});

describe('displayItem / describeInventory (inventory screen)', () => {
  it("shows the fresh Enforcer's paperdoll gear, empty elsewhere, and the starting kit", () => {
    const view = describeInventory(snapshot);
    const bySlot = Object.fromEntries(view.slots.map((s) => [s.slot, s.item]));
    expect(bySlot.mainHand?.name).toBe('Jaaj Sword 1');
    expect(bySlot.armor?.name).toBe('Jooj Armor 1');
    expect(bySlot.helmet).toBeNull();
    expect(bySlot.offHand).toBeNull();
    // PLAN.md #2 / §22.6: potions folded into consumables — the kit rides in the backpack.
    expect(view.backpack.map((b) => b.item.name)).toEqual(['Void Draught', 'Suture Kit']);
  });

  it('projects a rolled item by its rolled name/rarity/kind/slot', () => {
    const rolled: ItemInstance = {
      defId: 'gen-1',
      rolled: { name: 'Whispering Band', rarity: 'Rare', slot: 'ring', kind: 'trinket', effects: [] },
    };
    expect(displayItem(rolled)).toEqual({
      defId: 'gen-1',
      name: 'Whispering Band',
      rarity: 'Rare',
      kind: 'trinket',
      slot: 'ring',
      effects: [],
    });
  });
});

describe('equipFromBackpack / unequipSlot (pure action-mapping)', () => {
  // Fresh Enforcer with its starting kit set aside (PLAN.md #2), then pick up a second armor into
  // the backpack (index 0).
  const bare: Player = { ...snapshot, inventory: { ...snapshot.inventory, backpack: [] } };
  const withLooseArmor: Player = { ...bare, inventory: pickUp(bare.inventory, { defId: 'Jaaj Armor 1' }) };
  const state = hub(withLooseArmor);

  it('swaps the equipped armor: new armor in slot, displaced armor back to backpack', () => {
    const r = equipFromBackpack(state, 0);
    expect(r.ok).toBe(true);
    expect(r.state.player!.inventory.slots.armor?.defId).toBe('Jaaj Armor 1');
    expect(r.state.player!.inventory.backpack).toHaveLength(1);
    expect(r.state.player!.inventory.backpack[0]?.defId).toBe('Jooj Armor 1');
    // Original state untouched (pure).
    expect(state.player!.inventory.slots.armor?.defId).toBe('Jooj Armor 1');
  });

  it('unequips a slot back to the backpack', () => {
    const equipped = equipFromBackpack(state, 0).state;
    const r = unequipSlot(equipped, 'armor');
    expect(r.ok).toBe(true);
    expect(r.state.player!.inventory.slots.armor).toBeNull();
    const defs = r.state.player!.inventory.backpack.map((i) => i.defId).sort();
    expect(defs).toEqual(['Jaaj Armor 1', 'Jooj Armor 1']);
  });

  it('is a no-op (ok:false, state unchanged) on a bad index', () => {
    const r = equipFromBackpack(state, 99);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(state);
  });

  it('is a no-op (ok:false) unequipping an empty slot', () => {
    const r = unequipSlot(state, 'helmet');
    expect(r.ok).toBe(false);
    expect(r.state).toBe(state);
  });

  it('is a no-op with no player', () => {
    expect(equipFromBackpack(hub(null), 0).ok).toBe(false);
    expect(unequipSlot(hub(null), 'armor').ok).toBe(false);
  });
});

describe('characterSheet', () => {
  // Fresh Enforcer, every stat 10 -> mod 0. d10 hit die: maxHp = 10 + 0 = 10, hp = maxHp.
  // AC from Jooj Armor 1 (baseArmor 11, dexCap 2): 11 + CONmod(0) + min(DEXmod 0, 2) = 11
  // — the armored value, NOT the stored unarmored 10.
  const sheet = characterSheet(snapshot);

  it('reports level/xp/hp and the gear-derived armor class', () => {
    expect(sheet.level).toBe(1);
    expect(sheet.xp).toBe(0);
    expect(sheet.hp).toBe(10);
    expect(sheet.maxHp).toBe(10);
    expect(sheet.skillCharges).toBe(5);
    expect(sheet.maxSkillCharges).toBe(5);
    expect(sheet.armorClass).toBe(11);
    expect(sheet.armorClass).toBe(playerArmorClass(snapshot));
    expect(sheet.armorClass).not.toBe(10); // not the stored unarmored score
  });

  it('lists six stats each score 10 mod 0', () => {
    expect(sheet.stats).toEqual(STAT_KEYS.map((key) => ({ key, score: 10, mod: 0 })));
  });

  it('lists the resolved skills with charge costs', () => {
    expect(sheet.skills).toEqual([
      { skillId: 'heavyStrike', name: 'Heavy Strike', chargeCost: 2 },
      { skillId: 'brace', name: 'Brace', chargeCost: 1 },
    ]);
  });

  it('shows equipped gear names per slot', () => {
    const bySlot = Object.fromEntries(sheet.equipped.map((e) => [e.slot, e.name]));
    expect(bySlot.mainHand).toBe('Jaaj Sword 1');
    expect(bySlot.armor).toBe('Jooj Armor 1');
    expect(bySlot.helmet).toBeNull();
  });

  it('exposes the Enforcer build resource (momentum), NOT karma', () => {
    expect(sheet.resource).toEqual({ kind: 'momentum', value: 0 });
  });

  it('emits NO karma / Nature field anywhere in the sheet', () => {
    const keys = allKeys(sheet).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.includes('karma') || k.includes('nature'))).toBe(false);
  });
});

describe('dealView (cost -> reward only, pool hidden)', () => {
  // Hand-derived: describeCost({hp,3}) === "3 HP"; describeReward({skillCharge,2}) === "2 skill
  // charges". (PLAN.md #2: no bargain heals any more, so the fixture's reward is a charge.)
  const deal: SacrificeDeal = { pool: 'grace', cost: { kind: 'hp', amount: 3 }, reward: { kind: 'skillCharge', amount: 2 } };

  it('renders the cost and reward text', () => {
    expect(dealView(deal)).toEqual({ cost: '3 HP', reward: '2 skill charges' });
  });

  it('never leaks the karma-derived pool (key or value)', () => {
    const view = dealView(deal);
    expect(Object.keys(view)).not.toContain('pool');
    // The pool value 'grace' must not appear anywhere in the serialized view.
    expect(JSON.stringify(view)).not.toContain('grace');
    expect(JSON.stringify(view).toLowerCase()).not.toContain('pool');
  });
});

describe('draftCards', () => {
  // Hand-derived labels: stat -> "+1 STR" / "+1 DEX"; skill intimidate -> "Learn Intimidate".
  const offers: DraftOption[] = [
    { kind: 'stat', stat: 'STR' },
    { kind: 'stat', stat: 'DEX' },
    { kind: 'skill', skillId: 'intimidate' },
  ];
  it('projects each offer to an indexed readable card', () => {
    expect(draftCards(offers)).toEqual([
      { index: 0, label: '+1 STR' },
      { index: 1, label: '+1 DEX' },
      { index: 2, label: 'Learn Intimidate' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// G33 — the charge discount is real through the UI, and the view AGREES with the engine.
//
// `overclock-chip` (relics.json) is a ring carrying `skillChargeDiscount: 1`. The Enforcer
// core pool is heavyStrike (base cost 2) and brace (base cost 1), so with the chip on and
// ONE charge banked, heavyStrike costs 1 and IS castable. Every number below is read off
// relics.json / skill.ts, not off the implementation.
// ---------------------------------------------------------------------------

/** The snapshot with a charge-discount ring on and a single charge banked. */
const discounted: Player = {
  ...snapshot,
  skillCharges: 1,
  inventory: {
    slots: { ...snapshot.inventory.slots, ring: { defId: 'overclock-chip' } },
    backpack: [],
  },
};
/** The same player, same charges, NO ring — the non-vacuity control. */
const undiscounted: Player = { ...snapshot, skillCharges: 1 };

/** Dispatch one cast through the REAL engine `step` from a started battle. */
function castThroughStep(player: Player, skillId: 'heavyStrike'): GameEvent[] {
  const { rng } = createRng(1234);
  const battle = { ...buildRandomBattle(player, 1, rng), player };
  const state: GameState = {
    ...hub(player),
    phase: { kind: 'battle', battle, started: true, final: false },
  };
  return step(state, { kind: 'battle-action', action: { kind: 'cast', skillId } }).events;
}

describe('castOptions — the equipped charge discount (G33)', () => {
  it('reports the DISCOUNTED cost, and marks the skill affordable at that cost', () => {
    const heavy = castOptions(discounted).find((c) => c.skillId === 'heavyStrike');
    expect(heavy).toEqual({
      skillId: 'heavyStrike',
      name: 'Heavy Strike',
      chargeCost: 1, // base 2, minus the chip's 1
      affordable: true, // 1 banked charge pays a 1-charge cost
    });
    // The floor at 0: brace's base cost is 1, so the same chip takes it to free.
    expect(castOptions(discounted).find((c) => c.skillId === 'brace')?.chargeCost).toBe(0);
  });

  it('and the ENGINE agrees — the same cast really resolves', () => {
    // This is the actual defect: the picker said "unaffordable" about a cast the engine
    // was happy to run, so through the real UI the relic did nothing.
    const kinds = castThroughStep(discounted, 'heavyStrike').map((e) => e.kind);
    expect(kinds).not.toContain('cast-unavailable');
    expect(kinds).toContain('skill-cast');
  });

  it('NON-VACUITY: without the ring the same cast at the same charge is refused', () => {
    // If this were also castable, the assertion above would prove nothing about the chip.
    expect(castOptions(undiscounted).find((c) => c.skillId === 'heavyStrike')).toEqual({
      skillId: 'heavyStrike',
      name: 'Heavy Strike',
      chargeCost: 2,
      affordable: false,
    });
    const kinds = castThroughStep(undiscounted, 'heavyStrike').map((e) => e.kind);
    expect(kinds).toContain('cast-unavailable');
    expect(kinds).not.toContain('skill-cast');
  });

  it('the SHEET and the PICKER cannot disagree — both read the one engine helper', () => {
    const sheetCosts = new Map(characterSheet(discounted).skills.map((s) => [s.skillId, s.chargeCost]));
    for (const opt of castOptions(discounted)) {
      expect(sheetCosts.get(opt.skillId)).toBe(opt.chargeCost);
    }
    // Non-vacuous: the discounted costs really differ from the undiscounted ones.
    const plainCosts = new Map(castOptions(undiscounted).map((s) => [s.skillId, s.chargeCost]));
    expect([...sheetCosts.values()]).not.toEqual([...plainCosts.values()]);
  });
});

describe('characterSheet — the player name, and an unknown skill (G28)', () => {
  it('carries the name through verbatim, as a LABEL', () => {
    // Nobody had ever asserted that the sheet renders the name at all. The probe is
    // deliberately odd-looking so a "close enough" match cannot pass.
    const named: Player = { ...snapshot, name: 'Zzyzx-Qwph' };
    expect(characterSheet(named).name).toBe('Zzyzx-Qwph');
  });

  it('does not mangle, escape, or strip a name that looks like markup', () => {
    // The view-model half of G28(b): the value must arrive at the renderer EXACTLY as the
    // player typed it, so the renderer can set it as textContent. (That the renderer really
    // does set it as text rather than interpolate it is guarded separately, on the source.)
    const markup = '<b>&"</b>';
    expect(characterSheet({ ...snapshot, name: markup }).name).toBe(markup);
  });

  it('survives an id in skillPool that this build does not know (G28(e))', () => {
    // `resolveSkill` is typed to return a SkillDef but is `SKILLS[id]` underneath, so an
    // unknown id handed back `undefined` and reading `.id` off it threw — losing the whole
    // sheet instead of one row.
    const broken: Player = { ...snapshot, skillPool: ['heavyStrike', 'no-such-skill', 'brace'] };
    expect(() => characterSheet(broken)).not.toThrow();
    const rows = characterSheet(broken).skills.map((s) => s.skillId);
    expect(rows).toEqual(['heavyStrike', 'brace']); // the good rows survive; the bad one is dropped
  });
});

// ---------------------------------------------------------------------------
// G2 — a finished run is finished, and says what it was.
// ---------------------------------------------------------------------------

describe('isRunOver — exhaustive over every phase', () => {
  // Written out by hand from the `Phase` union in game.ts: 17 members, of which exactly two
  // are terminal. Listing them here rather than deriving them from the implementation is the
  // point — this is the independent witness that the map has the right VALUES, while the
  // `Record<Phase['kind'], boolean>` type is the witness that it has the right KEYS.
  const CONTINUES: Phase[] = [
    { kind: 'title' },
    { kind: 'name-entry' },
    { kind: 'class-select', name: 'X' },
    { kind: 'stats-roll', name: 'X', classId: 'Enforcer', stats: fixedStats },
    { kind: 'main-menu' },
    { kind: 'battle', battle: buildRandomBattle(snapshot, 1, createRng(3).rng), started: true, final: false },
    { kind: 'battle-victory', final: false },
    { kind: 'rest' },
    { kind: 'deal', deal: { pool: 'standard', cost: { kind: 'hp', amount: 1 }, reward: { kind: 'skillCharge', amount: 1 } } },
    { kind: 'chest', loot: [] },
    { kind: 'act-outro', newAct: 2 },
    { kind: 'level-up-draft', offers: [] },
    { kind: 'level-up-result' },
    { kind: 'act-intro', newAct: 2 },
    { kind: 'verdict', outcome: 'grace' },
  ];
  const ENDS: Phase[] = [
    { kind: 'ending', endingType: 'grace' },
    { kind: 'game-over' },
  ];

  it('covers all seventeen phase kinds, and only two of them end the run', () => {
    expect(CONTINUES.length + ENDS.length).toBe(17);
    expect(new Set([...CONTINUES, ...ENDS].map((p) => p.kind)).size).toBe(17);
  });

  it('is false for every phase that is not the end', () => {
    for (const phase of CONTINUES) {
      expect(isRunOver(phase), `${phase.kind} must not end the run`).toBe(false);
    }
  });

  it('is true for the ENDING phase — which is the whole of G2', () => {
    // A victory settles at `ending`, not at `game-over`. The renderer keyed its clear off
    // `awaiting === 'game-over'`, so a win took the AUTOSAVE branch and left a resumable
    // save; relaunching offered "A descent lies unfinished" about a run already won.
    for (const phase of ENDS) {
      expect(isRunOver(phase), `${phase.kind} must end the run`).toBe(true);
    }
  });
});

describe('runSummaryView — the factual record of a finished run', () => {
  // A HAND-PICKED seed, written here and nowhere else, so the row asserted below can only
  // pass if the projection really carries the number it was given. Never read back from the
  // implementation — the digits of pi are as arbitrary as it gets.
  const SEED = 314159;
  const won: RunSummary = {
    ...emptyRunSummary(),
    bossKills: ['kingpin', 'reflection'],
    spareCount: 3,
    maxAct: 4,
    endingType: 'grace',
  };
  const unlocked: NewlyUnlocked = {
    classes: ['Neuromancer'],
    skills: [],
    relics: ['overclock-chip'],
    families: ['cyberEnforcers'],
    affixes: ['warped'],
    feats: ['unlock-neuromancer', 'first-boss-kill'],
  };

  it('states each of the three outcomes in player words', () => {
    const grace = runSummaryView({ ...won, endingType: 'grace' }, snapshot, null, SEED);
    const damned = runSummaryView({ ...won, endingType: 'damnation' }, snapshot, null, SEED);
    const dead = runSummaryView({ ...emptyRunSummary(), maxAct: 2 }, snapshot, null, SEED);
    expect(grace.headline).toContain('grace');
    expect(damned.headline).toContain('damnation');
    // The third case must NOT claim either ending.
    expect(dead.headline).not.toContain('grace');
    expect(dead.headline).not.toContain('damnation');
    // ...and all three must actually say something.
    for (const h of [grace.headline, damned.headline, dead.headline]) {
      expect(h.length).toBeGreaterThan(0);
    }
    expect(new Set([grace.headline, damned.headline, dead.headline]).size).toBe(3);
  });

  it('reports depth, bosses BY NAME, and spares', () => {
    const view = runSummaryView(won, snapshot, unlocked, SEED);
    const values = view.rows.map((r) => r.value).join(' | ');
    expect(values).toContain('Act 4 of 5');
    // BOSSES.kingpin.name / BOSSES.reflection.name, from boss.ts.
    expect(values).toContain('Undercity Kingpin');
    expect(values).toContain('The Reflection');
    expect(view.rows.find((r) => r.label === 'Foes spared')?.value).toBe('3');
  });

  it('names newly unlocked classes and relics, and prints no internal id', () => {
    const view = runSummaryView(won, snapshot, unlocked, SEED);
    const text = [view.headline, ...view.rows.map((r) => `${r.label} ${r.value}`)].join(' | ');
    expect(text).toContain('Neuromancer');
    expect(text).toContain('Overclock Chip'); // relics.json name, not `overclock-chip`
    // The full id sweep. Every id set the summary could conceivably touch.
    const ids = [
      ...getAllRelics().map((r) => r.id),
      ...getAllUniques().map((u) => u.id),
      ...getAllConsumables().map((c) => c.id),
      ...Object.keys(CONDITION_DATA),
      ...FEATS.map((f) => f.id),
      ...Object.keys(BOSSES),
      // The gradual-reveal machinery the player must never be shown.
      ...unlocked.families,
      ...unlocked.affixes,
    ];
    for (const id of ids) {
      expect(text, `raw id "${id}" reached the player`).not.toContain(id);
    }
    // NON-VACUITY: the sweep is meaningless unless the ids it looks for are real strings that
    // COULD have appeared — `overclock-chip` and `unlock-neuromancer` are both in this run's
    // own unlock record, and `kingpin` is in its own boss-kill list.
    expect(ids).toContain('overclock-chip');
    expect(ids).toContain('unlock-neuromancer');
    expect(ids).toContain('kingpin');
  });

  it('handles a run that unlocked nothing, and one that never left the threshold', () => {
    const nothing = runSummaryView(emptyRunSummary(), snapshot, null, SEED);
    expect(nothing.rows.some((r) => r.label === 'Newly unlocked')).toBe(false);
    expect(nothing.rows.find((r) => r.label === 'Depth reached')?.value).toMatch(/threshold/);
    expect(nothing.rows.find((r) => r.label === 'Bosses felled')?.value).toBe('none');
    // And a run with no player at all (quit before creation) must not throw.
    expect(() => runSummaryView(emptyRunSummary(), null, null, SEED)).not.toThrow();
  });

  it('is PURE — it mutates neither the summary nor the unlock record', () => {
    const summaryBefore = JSON.parse(JSON.stringify(won)) as RunSummary;
    const unlockedBefore = JSON.parse(JSON.stringify(unlocked)) as NewlyUnlocked;
    runSummaryView(won, snapshot, unlocked, SEED);
    expect(won).toEqual(summaryBefore);
    expect(unlocked).toEqual(unlockedBefore);
  });
});

// ---------------------------------------------------------------------------
// G8, the DISPLAY half. The seed was generated, saved and shown to nobody, so a bug report
// could never name the run it came from. `runSummaryView` is where it surfaces.
//
// Every expectation below is a number this file chose. Nothing here is read back out of the
// implementation, which is the only way an assertion about a value can mean anything.
// ---------------------------------------------------------------------------

describe('the finished run reports its seed (G8)', () => {
  const summary: RunSummary = { ...emptyRunSummary(), maxAct: 3 };

  it('is labelled the word the plan names — "Seed"', () => {
    // Written from the plan (AC-11: "a row labelled `Seed`"), not copied off the constant.
    // Every other assertion in this block reads the label THROUGH `SEED_ROW_LABEL`, so
    // without this one the word itself is unpinned and could drift to anything.
    expect(SEED_ROW_LABEL).toBe('Seed');
  });

  it('shows the seed it was handed, as its decimal digits', () => {
    const view = runSummaryView(summary, snapshot, null, 314159);
    const row = view.rows.find((r) => r.label === SEED_ROW_LABEL);
    expect(row, 'the run summary has no seed row — that is G8, unfixed').toBeDefined();
    expect(row?.value).toBe('314159');
  });

  it('and a DIFFERENT seed produces a different row — not a constant dressed as a value', () => {
    // Without this, `value: '314159'` hard-coded in the projector passes the test above.
    const a = runSummaryView(summary, snapshot, null, 314159);
    const b = runSummaryView(summary, snapshot, null, 2718281828);
    expect(a.rows.find((r) => r.label === SEED_ROW_LABEL)?.value).toBe('314159');
    expect(b.rows.find((r) => r.label === SEED_ROW_LABEL)?.value).toBe('2718281828');
  });

  it('shows it on every outcome, including a run that ended at the threshold', () => {
    // A row that only appears on a WON run is missing from exactly the reports that need it:
    // a crash and a death are what testers file.
    for (const s of [
      { ...emptyRunSummary(), endingType: 'grace' } as RunSummary,
      { ...emptyRunSummary(), endingType: 'damnation' } as RunSummary,
      emptyRunSummary(),
    ]) {
      const view = runSummaryView(s, null, null, 777);
      expect(view.rows.find((r) => r.label === SEED_ROW_LABEL)?.value).toBe('777');
    }
  });

  it('and 0 is shown as "0", not dropped as falsy', () => {
    // Seed 0 is a legal seed. An `if (seed)` guard would silently omit the one run whose
    // report says "seed 0" — and 0 is exactly the seed a fixed-seed debugging session uses.
    const view = runSummaryView(summary, snapshot, null, 0);
    expect(view.rows.find((r) => r.label === SEED_ROW_LABEL)?.value).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// G5 / GAME-DESIGN.md §19.4 — "Abandon the descent" gets a confirmation AND moves.
//
// The independent truth these assertions are written against is §19.4's own words: it
// "currently sits third, directly under 'Continue the descent', and one click permanently
// destroys a 45-90 minute permadeath run", and the ruling is "confirm ... Also move it,
// because the adjacency is what causes the misclick".
// ---------------------------------------------------------------------------

describe('the hub menu cannot end a run in one click (G5)', () => {
  /** Every menu input a set of items would dispatch. The `screen`/`mode` rows dispatch none. */
  const dispatched = (mode: 'menu' | 'confirm-abandon'): string[] =>
    hubMenu(mode)
      .items.filter((i) => i.action.kind === 'dispatch')
      .map((i) => (i.action as { input: { choice: string } }).input.choice);

  it('the plain menu dispatches NO quit at all', () => {
    expect(dispatched('menu')).not.toContain('quit');
    // Non-vacuity: the menu really does dispatch something, so "no quit" is a statement about
    // the quit and not about an empty list. (PLAN.md #2: exactly one dispatch now — Continue —
    // since the bargain row left with §22.23.)
    expect(dispatched('menu')).toEqual(['continue']);
  });

  it('and the row that LOOKS destructive switches mode instead', () => {
    const abandon = hubMenu('menu').items.find((i) => i.label === 'Abandon the descent');
    expect(abandon, 'the abandon row is gone entirely').toBeDefined();
    expect(abandon?.action.kind).toBe('mode');
    expect((abandon?.action as { mode: string }).mode).toBe('confirm-abandon');
  });

  it('Abandon is LAST, and not adjacent to Continue — §19.4 moves it, not just guards it', () => {
    const labels = hubMenu('menu').items.map((i) => i.label);
    const abandon = labels.indexOf('Abandon the descent');
    const cont = labels.indexOf('Continue the descent');
    expect(abandon, 'no abandon row').toBeGreaterThan(-1);
    expect(cont, 'no continue row').toBeGreaterThan(-1);
    expect(abandon, 'Abandon is not the last row').toBe(labels.length - 1);
    // §19.4: it sat THIRD, directly under Continue, and the adjacency is the cause.
    expect(Math.abs(abandon - cont), 'Abandon is still adjacent to Continue').toBeGreaterThan(1);
    expect(abandon, 'Abandon is still in the top group').toBeGreaterThan(2);
  });

  it('and it is separated by a rule, so the eye sees the group boundary too', () => {
    const items = hubMenu('menu').items;
    expect(items[items.length - 1]?.separated).toBe(true);
    expect(items.filter((i) => i.separated === true)).toHaveLength(1);
  });

  it('the confirmation dispatches quit EXACTLY once, and offers exactly one way out', () => {
    const view = hubMenu('confirm-abandon');
    expect(dispatched('confirm-abandon').filter((c) => c === 'quit')).toHaveLength(1);
    // Exactly one cancel: a row that returns to the plain menu.
    const cancels = view.items.filter(
      (i) => i.action.kind === 'mode' && (i.action as { mode: string }).mode === 'menu',
    );
    expect(cancels, 'the confirmation has no single cancel').toHaveLength(1);
    // ...and nothing else. Two rows, no third option to misread under stress.
    expect(view.items).toHaveLength(2);
  });

  it('and it NAMES what is lost rather than asking "are you sure?"', () => {
    const prompt = hubMenu('confirm-abandon').prompt ?? '';
    expect(prompt.length, 'the confirmation has no prompt').toBeGreaterThan(40);
    // The three things a permadeath run loses, each named in the player's own terms.
    expect(prompt).toMatch(/cannot be resumed|ends here/);
    expect(prompt.toLowerCase()).toContain('carried');
    expect(prompt.toLowerCase()).toContain('floor');
  });

  it('the plain menu has no prompt — a question with no decision under it is noise', () => {
    expect(hubMenu('menu').prompt).toBeNull();
  });

  it('routes to inventory, the character sheet and settings', () => {
    const screens = hubMenu('menu')
      .items.filter((i) => i.action.kind === 'screen')
      .map((i) => (i.action as { screen: string }).screen);
    expect(screens).toContain('inventory');
    expect(screens).toContain('sheet');
    expect(screens).toContain('settings');
  });

  it('and no longer offers a bargain — §22.23 deleted it with #2 (bargains find YOU)', () => {
    expect(hubMenu('menu').items.map((i) => i.label)).not.toContain('Seek a bargain');
    expect(dispatched('menu')).not.toContain('seek-deal');
    // The hub is the five rows the plan re-derives (AC-30): Continue, Inventory, Character
    // sheet, Settings, Abandon.
    expect(hubMenu('menu').items.map((i) => i.label)).toEqual([
      'Continue the descent',
      'Inventory',
      'Character sheet',
      'Settings',
      'Abandon the descent',
    ]);
  });

  it('every item carries a non-empty label, in both modes', () => {
    for (const mode of ['menu', 'confirm-abandon'] as const) {
      const items = hubMenu(mode).items;
      expect(items.length, `${mode} has no items`).toBeGreaterThan(1);
      for (const item of items) expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// G26 — when the model fails, the fallback describes what JUST happened.
// ---------------------------------------------------------------------------

describe('fallbackNarration', () => {
  const state: GameState = hub(snapshot);

  it('prints THIS beat, not the continuity recap the prompt opens with', () => {
    // Build a prompt exactly as `narrate()` does: a non-empty StoryMemory (so `.user`'s first
    // block is the run summary + recent moments) plus a current beat. The old fallback read
    // `prompt.user.split('\n\n')[0]`, which is that recap.
    const past: GameEvent[] = [{ kind: 'encounter-start', enemyName: 'Rust Choir' }];
    const memory = rememberBeat(rememberBeat(createStoryMemory(), past), [
      { kind: 'victory', xpGained: 5, loot: [] },
    ]);
    const now: GameEvent[] = [
      {
        kind: 'attack', subject: 'player', outcome: 'crit', damage: 9,
        roll: { natural: 20, faces: [20], advDis: 0, modifier: 2, total: 22, targetAc: 13 },
        damageSources: [
          { kind: 'weapon-dice', amount: 4, label: '1d8' },
          { kind: 'crit-dice', amount: 5, label: '1d8' },
        ],
      },
    ];
    const prompt = buildNarrationPrompt(now, state, memory);
    expect(prompt).not.toBeNull();

    const fallback = fallbackNarration(prompt);
    // The crit's own words reach the player.
    expect(fallback).toContain('devastating');
    expect(fallback).toContain('9');
    // The recap does NOT. `Rust Choir` is the probe: it is in `prompt.user` but not in the
    // current beat, so its absence here is the whole assertion.
    expect(fallback).not.toContain('Rust Choir');
    expect(fallback).not.toContain('Recent moments');
    expect(fallback).not.toContain('Across this descent');
    // NON-VACUITY: the recap really IS in the prompt, and really IS its first block — so the
    // OLD implementation would have printed it.
    expect(prompt!.user).toContain('Rust Choir');
    expect(prompt!.user.split('\n\n')[0]).toContain('Rust Choir');
  });

  it('says something honest when there is nothing to say', () => {
    expect(fallbackNarration(null)).toBe('(the Void is silent)');
    expect(fallbackNarration({ facts: [] })).toBe('(the Void is silent)');
  });
});

// ---------------------------------------------------------------------------
// The Potion button: a press under a control condition used to do nothing at all.
// ---------------------------------------------------------------------------

describe('dealDiscardView — the full-pack bargain screen (plan Appendix A.3)', () => {
  const deal: SacrificeDeal = {
    pool: 'tempting',
    cost: { kind: 'greed' },
    reward: { kind: 'item', instance: { defId: 'gen:Legendary:mainHand', rolled: { name: 'Legendary mainHand', rarity: 'Legendary', slot: 'mainHand', kind: 'weapon', effects: [] } } },
  };
  const packed: Player = {
    ...snapshot,
    inventory: { ...snapshot.inventory, backpack: [{ defId: 'void-draught' }, { defId: 'Jaaj Sword 1' }] },
  };

  it('names the reward that needs room and the price NOT yet paid', () => {
    const v = dealDiscardView(packed, deal);
    expect(v.prompt).toBe('Your pack is full. Leave something behind to take Legendary mainHand.');
    expect(v.cost).toBe('a cache, stripped bare');
  });

  it('offers one row per backpack item, carrying its real index, and one way out', () => {
    const v = dealDiscardView(packed, deal);
    expect(v.leave).toEqual([
      { index: 0, label: 'Leave Void Draught' },
      { index: 1, label: 'Leave Jaaj Sword 1' },
    ]);
    expect(v.refuse).toBe(DEAL_DISCARD_REFUSE);
  });

  it('never carries the karma-derived pool', () => {
    const v = dealDiscardView(packed, deal);
    expect(JSON.stringify(v).toLowerCase()).not.toContain('tempting');
    expect(JSON.stringify(v).toLowerCase()).not.toContain('pool');
  });
});

describe('chestReveal', () => {
  it('projects each rolled instance to a name + rarity row', () => {
    const loot: ItemInstance[] = [
      { defId: 'a', rolled: { name: 'Ashen Ring', rarity: 'Rare', slot: 'ring', kind: 'trinket', effects: [] } },
      { defId: 'b', rolled: { name: 'Void Plate', rarity: 'Legendary', slot: 'armor', kind: 'armor', effects: [] } },
    ];
    expect(chestReveal(loot)).toEqual([
      { name: 'Ashen Ring', rarity: 'Rare' },
      { name: 'Void Plate', rarity: 'Legendary' },
    ]);
  });
});