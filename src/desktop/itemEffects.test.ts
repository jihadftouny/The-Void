// What an item's effects READ LIKE on the inventory screen — proved against REAL items.
//
// FINDINGS.md C9 + C11. `describeItemEffect` rendered every triggered effect as
// "On onHit: dealDamage" — the engine's own enum ids, on 41% of victory drops and on every
// triggered relic — and a second, newer leak sat behind `default: return type`, which would
// have printed `healMultiplier` verbatim. Neither was caught, because nothing tested the
// function against an item the game can actually produce.
//
// So: every expectation below is measured against `generateItem` / `rollLootDrop` /
// `rollChestLoot` output and the shipped catalogs, never a hand-built `ItemEffect` chosen to
// match the code. The pinned sentences are derived BY HAND from `relics.json` /
// `uniques.json` / `items.json` and the phrase rules, not pasted from a run.
//
// THE EXHAUSTIVENESS GATE IS `tsc`, NOT THIS FILE. A test cannot add a member to a union, so
// it cannot prove the `Record` tables fail the build when one appears. That was verified by
// mutation while this unit was built: adding a seventh `TriggerType`, a thirteenth
// `EffectActionKind` and a fourteenth `PassiveEffectType` each produced
// `error TS2741: Property '<new member>' is missing … but required in type
// 'Record<…>'` pointing at `view-model.ts`. What this file CAN do — and does below — is
// prove every member that exists today yields a real sentence that is not its own id.

import { describe, it, expect } from 'vitest';
import { describeItemEffect, displayItem } from './view-model.ts';
import type { ItemView } from './view-model.ts';
import {
  getAllItems,
  getAllRelics,
  getAllUniques,
  getAllConsumables,
  type EffectAction,
  type EffectActionKind,
  type EquipSlot,
  type ItemDef,
  type ItemInstance,
  type PassiveEffectType,
  type TriggerType,
} from '../game/item.ts';
import { EQUIP_SLOTS } from '../game/item.ts';
import { generateItem, RARITY_TABLE } from '../game/rarityGen.ts';
import { rollLootDrop, rollChestLoot } from '../game/loot.ts';
import { createRng } from '../game/rng.ts';
import type { Rarity } from '../game/weapon.ts';

// ---------------------------------------------------------------------------
// The forbidden vocabulary — every internal id that must never reach a player.
// Enumerated BY HAND from `src/game/item.ts`, because these are types: there is no runtime
// array of them to iterate, and a hand list is what makes the test independent of the tables
// it is checking. If item.ts grows a member, `tsc` catches the table and this list is the
// second place to update (the `Record`s below make that a compile error too).
// ---------------------------------------------------------------------------

const TRIGGER_TYPES: readonly TriggerType[] = [
  'startOfBattle',
  'onHit',
  'onCrit',
  'onCast',
  'onKill',
  'onTakeDamage',
];

const ACTION_KINDS: readonly EffectActionKind[] = [
  'dealDamage',
  'healSelf',
  'applyConditionSelf',
  'applyConditionEnemy',
  'gainShield',
  'gainStat',
  'restoreCharge',
  'revive',
  'cure',
  'flee',
  'reroll',
  'drainCharge',
];

const PASSIVE_TYPES: readonly PassiveEffectType[] = [
  'bonusStat',
  'bonusArmorClass',
  'bonusDamage',
  'heal',
  'bonusResist',
  'skillChargeDiscount',
  'firstHitReduction',
  'lowHpDamageBonus',
  'dotTickMultiplier',
  'chargePerTurn',
  'damageDealtMultiplier',
  'cannotHeal',
  'healMultiplier',
];

const ALL_IDS: readonly string[] = [...TRIGGER_TYPES, ...ACTION_KINDS, ...PASSIVE_TYPES];

/**
 * The ids a scanner can hunt INSIDE a sentence: the camelCase ones. Every leak this unit is
 * about is one of these — `onHit`, `dealDamage`, `healMultiplier` — and camelCase is a shape
 * no English sentence produces, so a hit is unambiguous.
 *
 * The five all-lowercase ids (`heal`, `cure`, `flee`, `revive`, `reroll`) are ORDINARY
 * ENGLISH WORDS, and a phrase is entitled to use them: "Cannot heal" is the correct rendering
 * of `cannotHeal`, not a leak of `heal`. Scanning for them inside a sentence reports the
 * right answer as wrong. They are still covered — by the exact-equality check below, which is
 * precisely what a `default: return type` fallback would produce.
 */
const CAMEL_IDS = ALL_IDS.filter((id) => /[A-Z]/.test(id)).map((id) => ({
  id,
  re: new RegExp(`\\b${id}\\b`),
}));

/** Assert one rendered phrase is a sentence, not an internal id. */
function expectNoRawId(phrase: string, where: string): void {
  expect(phrase, `${where}: rendered blank`).not.toBe('');
  // The fallback shape: the phrase IS the discriminant, verbatim. Covers every id.
  expect(ALL_IDS, `${where} rendered as the bare id "${phrase}"`).not.toContain(phrase);
  for (const { id, re } of CAMEL_IDS) {
    expect(re.test(phrase), `${where} leaked the id "${id}": "${phrase}"`).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// 1. The shipped catalogs — every relic, unique, base item and consumable.
// ---------------------------------------------------------------------------

/** The `ItemView` of a catalog def, via the real `displayItem` on a bare instance. */
function viewOf(def: ItemDef): ItemView {
  return displayItem({ defId: def.id });
}

const CATALOGS: readonly { label: string; defs: readonly ItemDef[] }[] = [
  { label: 'items.json', defs: getAllItems() },
  { label: 'relics.json', defs: getAllRelics() },
  { label: 'uniques.json', defs: getAllUniques() },
  { label: 'consumables.json', defs: getAllConsumables() },
];

describe('every item in every shipped catalog reads as English', () => {
  it('no catalog item renders an internal id on the inventory screen', () => {
    let effectsSeen = 0;
    for (const { label, defs } of CATALOGS) {
      expect(defs.length, `${label} is empty`).toBeGreaterThan(0);
      for (const def of defs) {
        for (const phrase of viewOf(def).effects) {
          effectsSeen += 1;
          expectNoRawId(phrase, `${label} / ${def.name}`);
        }
      }
    }
    // Non-vacuity: the catalogs really do carry effects to render.
    expect(effectsSeen).toBeGreaterThanOrEqual(20);
  });

  it('every triggered catalog effect reads as a full sentence', () => {
    let triggered = 0;
    for (const { defs } of CATALOGS) {
      for (const def of defs) {
        def.effects.forEach((effect, i) => {
          if (effect.type !== 'triggered') return;
          triggered += 1;
          const phrase = viewOf(def).effects[i]!;
          // "<when>: <what>." — a colon, a verb phrase, a full stop.
          expect(phrase, `${def.name}`).toMatch(/^[A-Z][^:]+: .+\.$/);
        });
      }
    }
    // relics.json + uniques.json really do ship triggered effects.
    expect(triggered).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// 2. The pinned sentences — hand-derived from the data files.
//
// Each expectation below is written from the JSON entry and the phrasing rules, by hand.
// They are the anchors: if the phrasing tables are edited, these say exactly what moved.
// ---------------------------------------------------------------------------

/**
 * defId → the full effect list the inventory should show, in authoring order.
 *
 * Keyed on the ID, not the display name, and deliberately: `items.json` `clarity-draught`
 * and `consumables.json` `clarity-tonic` BOTH ship the player-facing name "Clarity Draught",
 * so a name-keyed table silently covers only whichever catalog is read last. (That duplicate
 * name is a content observation for the register, not this unit's to change.)
 */
const PINNED: Record<string, string[]> = {
  // --- relics.json -----------------------------------------------------------------
  'overclock-chip': ['Skills cost 1 less charge'], //             skillChargeDiscount amount 1
  'scrap-plating': ['Reduces the first enemy hit each battle'], // firstHitReduction
  'adrenal-shunt': ['+2 damage while wounded'], //                 lowHpDamageBonus amount 2
  'mirror-shard': ['When you are struck: deals 25% of the damage taken back.'],
  'doubling-glass': ['When you cast: deals 2 extra damage.'],
  'clear-sight': ['As the battle opens: grants you Wise.'], //     `wise` IS a buff
  'ash-censer': ['On hit: inflicts Burn on the enemy.'],
  'grave-of-embers': ['Amplifies damage-over-time'],
  'empty-vessel': ['+1 skill charge each turn'],
  'halo-fragment': ['When you are struck: revives you once per battle at 25% of your max HP.'],
  'choirs-blessing': ['As the battle opens: grants you Regeneration.'],
  reliquary: ['When you cast: heals you 3.'],
  'hollow-heart': ['Skills cost 1 less charge', 'When you cast: heals you 2.'],
  'void-pact': ['Amplifies damage dealt', 'Cannot heal'],
  'devourers-maw': ['When the enemy falls: +1 STR.'],
  // --- uniques.json ----------------------------------------------------------------
  'reflections-edge': ['On hit: deals 1 extra damage per condition on the enemy.'],
  'ashen-crown': ['+2 INT', 'Amplifies damage-over-time'],
  'grace-forged-aegis': ['As the battle opens: raises a 5-point shield.'],
  'hollow-regalia': ['+5 armor class'],
  // --- items.json ------------------------------------------------------------------
  'rusted-blade': ['+1 damage'],
  'void-plate': ['+2 armor class'],
  'hollow-ring': ['+1 CON'],
  'clarity-draught': ['Heal 8 HP'],
};

describe('the pinned sentences — every relic, unique and base item by id', () => {
  const byId = new Map<string, ItemDef>();
  for (const { defs } of CATALOGS) for (const def of defs) byId.set(def.id, def);

  /** The rendered effects of a catalog id, through the real `displayItem`. */
  function effectsOf(id: string): string[] {
    const def = byId.get(id);
    expect(def, `${id} is no longer in any catalog — this anchor is stale`).toBeDefined();
    return viewOf(def!).effects;
  }

  it('renders each one exactly as written out by hand from the data', () => {
    for (const [id, expected] of Object.entries(PINNED)) {
      expect(effectsOf(id), id).toEqual(expected);
    }
  });

  it('covers every relic, unique and base item that ships', () => {
    // Non-vacuity: the pin list is not allowed to quietly stop covering a new relic.
    const ids = [...getAllRelics(), ...getAllUniques(), ...getAllItems()].map((d) => d.id);
    expect(ids.length).toBe(15 + 4 + 4);
    for (const id of ids) expect(PINNED[id], `${id} is unpinned`).toBeDefined();
  });

  it('a buff is "grants you" and an affliction is "inflicts" (C10(b)\'s sibling)', () => {
    // Clear Sight and Choir's Blessing both apply a BENEFICIAL condition to the wearer.
    // Reading them as "afflicts you with Wise" would be the narrator's defect, on a screen.
    for (const id of ['clear-sight', 'choirs-blessing']) {
      expect(effectsOf(id)[0]).toContain('grants you');
      expect(effectsOf(id)[0]).not.toContain('afflict');
    }
    expect(effectsOf('ash-censer')[0]).toContain('inflicts Burn on the enemy');
  });
});

// ---------------------------------------------------------------------------
// 3. Every union member yields a real phrase.
// ---------------------------------------------------------------------------

describe('no member of any effect union renders as its own id', () => {
  it('every TriggerType leads a sentence in words', () => {
    for (const trigger of TRIGGER_TYPES) {
      const phrase = describeItemEffect({
        type: 'triggered',
        trigger,
        action: { kind: 'dealDamage', params: { amount: 1 } },
      });
      expectNoRawId(phrase, `trigger ${trigger}`);
      expect(phrase).toMatch(/: deals 1 extra damage\.$/);
    }
  });

  it('every EffectActionKind has a verb phrase, with and without its params', () => {
    for (const kind of ACTION_KINDS) {
      // Bare: the degenerate case a malformed data row would produce.
      const bare: EffectAction = { kind, params: {} };
      expectNoRawId(
        describeItemEffect({ type: 'triggered', trigger: 'onHit', action: bare }),
        `action ${kind} (no params)`,
      );
      // Furnished: the shape the real data ships.
      const full: EffectAction = {
        kind,
        params: { amount: 2, pctMaxHp: 25, pctOfDamageTaken: 25, perEnemyCondition: 1 },
        condition: 'burn',
        stat: 'DEX',
      };
      expectNoRawId(
        describeItemEffect({ type: 'triggered', trigger: 'onHit', action: full }),
        `action ${kind} (params)`,
      );
    }
  });

  it('every PassiveEffectType has a phrase, empty params included', () => {
    for (const type of PASSIVE_TYPES) {
      expectNoRawId(describeItemEffect({ type, params: {} }), `passive ${type} (empty)`);
      expectNoRawId(
        describeItemEffect({ type, params: { amount: 2, pct: 50, mult: 2 } }),
        `passive ${type}`,
      );
    }
  });

  it('healMultiplier — the type that had no case — reads as a percentage', () => {
    // PLAN.md #2 added `healMultiplier` and `describeItemEffect`'s `default: return type`
    // would have printed it verbatim. Floor 3 ships it at 50%.
    expect(describeItemEffect({ type: 'healMultiplier', params: { pct: 50 } })).toBe(
      'Healing works at 50%',
    );
    expect(describeItemEffect({ type: 'healMultiplier', params: {} })).toBe(
      'Healing works at 100%',
    );
  });

  it('a charge count agrees with its number — no "(s)" anywhere', () => {
    const one = describeItemEffect({
      type: 'triggered',
      trigger: 'onCast',
      action: { kind: 'restoreCharge', params: { amount: 1 } },
    });
    const two = describeItemEffect({
      type: 'triggered',
      trigger: 'startOfBattle',
      action: { kind: 'drainCharge', params: { amount: 2 } },
    });
    expect(one).toBe('When you cast: restores 1 skill charge.');
    expect(two).toBe('As the battle opens: drains 2 skill charges.');
    expect(one + two).not.toContain('(s)');
  });
});

// ---------------------------------------------------------------------------
// 4. REAL generated gear — 9 slots × 3 rarities × 24 seeds.
//
// Expected magnitudes are derived from `RARITY_TABLE` by hand:
//   Common     statBase 1, spread 2 → 1..2,  procChance 0   → never a proc
//   Rare       statBase 3, spread 3 → 3..5,  procChance 0.5 → sometimes, amount 2
//   Legendary  statBase 6, spread 4 → 6..9,  procChance 1   → always,    amount 3
// and the slot→kind mapping in rarityGen.ts (weapon: mainHand/offHand/ammo; trinket:
// ring/amulet; armor: everything else).
// ---------------------------------------------------------------------------

const RARITIES: readonly Rarity[] = ['Common', 'Rare', 'Legendary'];
const WEAPON_SLOTS = new Set<EquipSlot>(['mainHand', 'offHand', 'ammo']);
const TRINKET_SLOTS = new Set<EquipSlot>(['ring', 'amulet']);

/** The primary-effect sentence a slot+rarity must produce, derived from the table. */
function primaryPattern(slot: EquipSlot, rarity: Rarity): RegExp {
  const { statBase, statSpread } = RARITY_TABLE[rarity];
  const range = `(?:${Array.from({ length: statSpread }, (_, i) => statBase + i).join('|')})`;
  if (WEAPON_SLOTS.has(slot)) return new RegExp(`^\\+${range} damage$`);
  if (TRINKET_SLOTS.has(slot)) return new RegExp(`^\\+${range} STR$`);
  return new RegExp(`^\\+${range} armor class$`);
}

describe('rolled gear — every slot, every rarity, real generateItem output', () => {
  const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7 + 1);

  /** The whole sweep, folded once. */
  const sweep = (() => {
    const rows: { slot: EquipSlot; rarity: Rarity; seed: number; view: ItemView }[] = [];
    for (const slot of EQUIP_SLOTS) {
      for (const rarity of RARITIES) {
        for (const seed of SEEDS) {
          const { rng } = createRng(seed);
          rows.push({ slot, rarity, seed, view: displayItem(generateItem(rng, { slot, rarity })) });
        }
      }
    }
    return rows;
  })();

  it('sweeps all nine slots × three rarities × 24 seeds', () => {
    expect(sweep).toHaveLength(9 * 3 * 24);
    expect(EQUIP_SLOTS).toHaveLength(9);
  });

  it('no rolled item shows an internal id in any effect', () => {
    for (const { slot, rarity, seed, view } of sweep) {
      for (const phrase of view.effects) {
        expectNoRawId(phrase, `${rarity} ${slot} @${seed}`);
      }
    }
  });

  it("the primary effect's magnitude sits in its rarity's derived band", () => {
    for (const { slot, rarity, seed, view } of sweep) {
      expect(view.effects[0], `${rarity} ${slot} @${seed}`).toMatch(primaryPattern(slot, rarity));
    }
  });

  it('a proc reads as a sentence naming its rarity\'s damage', () => {
    for (const { rarity, slot, seed, view } of sweep) {
      if (view.effects.length < 2) continue;
      expect(view.effects, `${rarity} ${slot} @${seed}`).toHaveLength(2);
      expect(view.effects[1]).toBe(
        `On hit: deals ${RARITY_TABLE[rarity].procAmount} extra damage.`,
      );
    }
  });

  it('procs really occur where the table says they can (non-vacuity), and never where it says they cannot', () => {
    const withProc = (r: Rarity): number =>
      sweep.filter((row) => row.rarity === r && row.view.effects.length === 2).length;
    // procChance 1 — every Legendary carries one.
    expect(withProc('Legendary')).toBe(9 * 24);
    // procChance 0.5 — some do, some do not, so the branch is genuinely exercised.
    expect(withProc('Rare')).toBeGreaterThan(0);
    expect(withProc('Rare')).toBeLessThan(9 * 24);
    // procChance 0 — a Common never rolls one, so "no second effect" is not a bug here.
    expect(withProc('Common')).toBe(0);
  });

  it('a Legendary mainHand is exactly the two lines the plan derived by hand', () => {
    const { rng } = createRng(11);
    const view = displayItem(generateItem(rng, { slot: 'mainHand', rarity: 'Legendary' }));
    expect(view.effects[0]).toMatch(/^\+[6-9] damage$/);
    expect(view.effects[1]).toBe('On hit: deals 3 extra damage.');
  });

  it('a requested stat reaches the trinket phrase', () => {
    const { rng } = createRng(7);
    const view = displayItem(generateItem(rng, { slot: 'ring', rarity: 'Rare', stat: 'WIS' }));
    expect(view.effects[0]).toMatch(/^\+[3-5] WIS$/);
  });
});

// ---------------------------------------------------------------------------
// 5. REAL drops — what a player actually finds, over five acts and 120 seeds.
// ---------------------------------------------------------------------------

describe('what a real drop and a real chest show the player', () => {
  const ACTS = [1, 2, 3, 4, 5];
  const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);

  const drops = (() => {
    const out: { where: string; view: ItemView }[] = [];
    for (const act of ACTS) {
      for (const seed of SEEDS) {
        const { rng } = createRng(seed * 31 + act);
        const dropped: ItemInstance | null = rollLootDrop(act, rng);
        if (dropped) out.push({ where: `drop act ${act} seed ${seed}`, view: displayItem(dropped) });
        const { rng: chestRng } = createRng(seed * 17 + act);
        for (const item of rollChestLoot(chestRng, act)) {
          out.push({ where: `chest act ${act} seed ${seed}`, view: displayItem(item) });
        }
      }
    }
    return out;
  })();

  it('the sweep actually produced drops (non-vacuity)', () => {
    expect(drops.length).toBeGreaterThan(200);
    // …and at least one of them carried a triggered proc, which is the C9 surface.
    const procs = drops.filter((d) => d.view.effects.some((e) => e.startsWith('On hit:')));
    expect(procs.length).toBeGreaterThan(0);
  });

  it('no dropped item shows an internal id in any effect, on any act, on any seed', () => {
    for (const { where, view } of drops) {
      for (const phrase of view.effects) expectNoRawId(phrase, where);
    }
  });

  it('no dropped item shows an effect ending in a bare enum-looking token', () => {
    // The old shape was `On <trigger>: <kind>` — no full stop, two camelCase words. Catch the
    // SHAPE as well as the vocabulary, so a future id that is not on the list is still caught.
    const camel = /\b[a-z]+[A-Z][A-Za-z]*\b/;
    for (const { where, view } of drops) {
      for (const phrase of view.effects) {
        expect(camel.test(phrase), `${where}: camelCase in "${phrase}"`).toBe(false);
      }
    }
  });
});
