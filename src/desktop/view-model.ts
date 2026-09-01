// Pure view selectors for the desktop renderer.
//
// Read-only projections of engine state for display, plus two documented
// action-mapping helpers (equip/unequip) that compose existing PURE engine
// primitives. No DOM, no Kaplay, no game randomness — honors the logic/render
// split so every helper is testable headlessly in Node. Imports engine TYPES
// (`import type`) and value-imports only existing PURE `src/game` functions.
//
// KARMA IS HIDDEN (design constraint): nothing here surfaces the karma / Nature
// vector. `characterSheet` emits no karma field, and `dealView` deliberately drops
// the deal's `pool` (a `standard | tempting | grace` tell derived from karma). The
// UI shows a deal only as cost -> reward. Asserted by the view-model tests.
import type { GameState } from '../game/game.ts';
import type { Player } from '../game/player.ts';
import type { Inventory } from '../game/inventory.ts';
import type { EquipSlot, ItemEffect, ItemInstance } from '../game/item.ts';
import type { ItemKind } from '../game/item.ts';
import type { Rarity } from '../game/weapon.ts';
import type { SkillId } from '../game/skill.ts';
import type { StatKey } from '../game/character.ts';
import type { SacrificeDeal } from '../game/deal.ts';
import type { DraftOption } from '../game/draft.ts';

import { EQUIP_SLOTS, getCatalogItemById } from '../game/item.ts';
import { resolveSkill } from '../game/skill.ts';
import { spareAvailable } from '../game/battle.ts';
import { resolveInstanceDef, equip, unequip } from '../game/equipment.ts';
import { effectiveChargeCost } from '../game/equipEffects.ts';
import { playerArmorClass } from '../game/defense.ts';
import { describeCost, describeReward } from '../game/deal.ts';
import { describeDraftOption } from '../game/draft.ts';
import { summarizeLoot } from '../game/loot.ts';
import { CLASSES } from '../game/classKit.ts';
import { STAT_KEYS } from '../game/character.ts';

/**
 * The player to DISPLAY on the sheet: during a battle the live combatant
 * (`state.phase.battle.player`, whose HP ticks down each round), otherwise the
 * top-level snapshot (`state.player`, synced back only at battle end). Returns
 * `null` before a player exists (title/name-entry).
 */
export function displayPlayer(state: GameState): Player | null {
  if (state.phase.kind === 'battle') return state.phase.battle.player;
  return state.player;
}

// ===== Stage 1 — in-battle control options =================================

/** One castable skill the battle Cast picker offers. */
export interface CastOption {
  skillId: SkillId;
  name: string;
  chargeCost: number;
  /** True when the player currently banks enough charges to pay `chargeCost`. */
  affordable: boolean;
}

/**
 * The player's castable skills for the battle Cast picker — PURE. Iterates
 * `player.skillPool`, resolves each id through the engine's `resolveSkill` (so any
 * accumulated charge-cost upgrades are reflected), and marks it affordable when the
 * player banks at least `chargeCost` charges. The engine re-checks affordability on
 * dispatch, so a stale display is a safe no-op. Unknown ids (not in the skill table)
 * are skipped.
 *
 * G33: `chargeCost` is the EFFECTIVE cost — the engine's own `effectiveChargeCost`, which
 * is also what `battle.ts`'s cast guard consults. It used to report `skill.chargeCost`
 * raw, so an Overclock Chip / Hollow Heart made no difference to the picker: a 2-cost
 * skill rendered disabled at 1 charge even though the engine would have cast it. The
 * relic was real in the rules and invisible through the only UI that ships.
 */
export function castOptions(player: Player): CastOption[] {
  const out: CastOption[] = [];
  for (const id of player.skillPool) {
    const skill = resolveSkill(player, id as SkillId);
    if (!skill) continue;
    const chargeCost = effectiveChargeCost(player.inventory, skill.chargeCost);
    out.push({
      skillId: skill.id,
      name: skill.name,
      chargeCost,
      affordable: player.skillCharges >= chargeCost,
    });
  }
  return out;
}

/** One usable consumable the battle Use-item picker offers. */
export interface ConsumableOption {
  /** The backpack index — the `useConsumable` source the engine action carries. */
  index: number;
  name: string;
  rarity: Rarity;
}

/**
 * The player's usable consumables for the battle Use-item picker — PURE. Scans the
 * backpack; an entry is included only when its catalog def carries a non-empty `use`
 * array (equipment/gear has no `use`, so it is excluded). `index` is the backpack
 * position, which is exactly the `useConsumable` source the engine action needs.
 */
export function consumableOptions(player: Player): ConsumableOption[] {
  const out: ConsumableOption[] = [];
  player.inventory.backpack.forEach((instance, index) => {
    const def = getCatalogItemById(instance.defId);
    if (def?.use && def.use.length > 0) {
      out.push({ index, name: def.name, rarity: def.rarity });
    }
  });
  return out;
}

/**
 * Whether the Spare control should be offered — PURE. True only during a STARTED
 * battle against a living karma-weighted (⚖) enemy (the engine's own `spareAvailable`
 * gate). False for every non-battle phase, an un-started battle, a slain enemy, or a
 * non-weighted enemy.
 */
export function spareOffered(state: GameState): boolean {
  return (
    state.phase.kind === 'battle' &&
    state.phase.started &&
    spareAvailable(state.phase.battle)
  );
}

// ===== Stage 2 — inventory & equipment display + action-mapping ============

/** A display projection of one concrete item instance (no DOM). */
export interface ItemView {
  defId: string;
  name: string;
  rarity: Rarity;
  kind: ItemKind;
  slot: EquipSlot | null;
  /** Player-facing one-line phrases for each of the item's effects. */
  effects: string[];
}

/**
 * A short player-facing phrase for one item effect — DISPLAY ONLY, no mechanics — PURE.
 * Covers each passive effect type and the `triggered` variant; an unhandled type falls
 * back to its raw discriminant so nothing renders blank.
 */
export function describeItemEffect(effect: ItemEffect): string {
  if (effect.type === 'triggered') {
    return `On ${effect.trigger}: ${effect.action.kind}`;
  }
  const type: string = effect.type;
  const p = effect.params;
  const amt = p.amount ?? 0;
  switch (type) {
    case 'bonusDamage':
      return `+${amt} damage`;
    case 'bonusArmorClass':
      return `+${amt} armor class`;
    case 'heal':
      return `Heal ${amt} HP`;
    case 'bonusStat': {
      const parts = Object.entries(p).map(([k, v]) => `+${v} ${k.toUpperCase()}`);
      return parts.length > 0 ? parts.join(', ') : 'Stat bonus';
    }
    case 'bonusResist':
      return `+${amt} resistance`;
    case 'skillChargeDiscount':
      return `Skills cost ${amt || 1} less charge`;
    case 'firstHitReduction':
      return 'Reduces the first enemy hit each battle';
    case 'lowHpDamageBonus':
      return `+${amt} damage while wounded`;
    case 'dotTickMultiplier':
      return 'Amplifies damage-over-time';
    case 'chargePerTurn':
      return `+${amt || 1} skill charge each turn`;
    case 'damageDealtMultiplier':
      return 'Amplifies damage dealt';
    case 'cannotHeal':
      return 'Cannot heal';
    default:
      return type;
  }
}

/**
 * Project a concrete `ItemInstance` to an `ItemView` — PURE. Resolves the mechanical
 * shape (kind/slot/rarity/effects) via `resolveInstanceDef`; name from the rolled
 * overlay, else the catalog def, else the raw defId. An unresolvable id degrades to a
 * plain view (usable, unslotted, Common, no effects) so display never throws.
 */
export function displayItem(instance: ItemInstance): ItemView {
  const def = resolveInstanceDef(instance);
  const name = instance.rolled?.name ?? getCatalogItemById(instance.defId)?.name ?? instance.defId;
  if (!def) {
    return { defId: instance.defId, name, rarity: 'Common', kind: 'usable', slot: null, effects: [] };
  }
  return {
    defId: def.defId,
    name,
    rarity: def.rarity,
    kind: def.kind,
    slot: def.slot,
    effects: def.effects.map(describeItemEffect),
  };
}

/** A paperdoll slot row (the equipped item, or `null` when the slot is empty). */
export interface PaperdollSlot {
  slot: EquipSlot;
  item: ItemView | null;
}

/** A backpack row (a loose item plus its backpack index — the equip source). */
export interface BackpackRow {
  index: number;
  item: ItemView;
}

/** The full inventory projection: the paperdoll slots and the indexed backpack. */
export interface InventoryView {
  slots: PaperdollSlot[];
  backpack: BackpackRow[];
}

/**
 * Project a player's inventory to a paperdoll + indexed backpack for the hub inventory
 * screen — PURE. Iterates `EQUIP_SLOTS` in canonical order; the backpack keeps its real
 * indices so each row's Equip maps to the right source.
 */
export function describeInventory(player: Player): InventoryView {
  const inv: Inventory = player.inventory;
  return {
    slots: EQUIP_SLOTS.map((slot) => {
      const item = inv.slots[slot];
      return { slot, item: item ? displayItem(item) : null };
    }),
    backpack: inv.backpack.map((item, index) => ({ index, item: displayItem(item) })),
  };
}

/**
 * Equip the backpack item at `backpackIndex` into `slot` (inferred when omitted) — PURE
 * action-mapping helper. It COMPOSES the existing pure engine op `equipment.equip` on the
 * player's inventory and returns a new `GameState` (only `player.inventory` changes).
 * `ok: false` (state unchanged) on a bad index / usable / slot-mismatch, or with no player.
 *
 * DEVIATION (recorded per doctrine): the engine `step` reducer has no equip `GameInput`
 * today and this milestone must not touch `src/game`. `equip` is already a pure, RNG-free
 * primitive, so the render layer composes it here. FOLLOW-UP: promote equip/unequip to real
 * engine `step` inputs in a later milestone so the reducer is the single mutation path.
 */
export function equipFromBackpack(
  state: GameState,
  backpackIndex: number,
  slot?: EquipSlot,
): { state: GameState; ok: boolean } {
  const player = state.player;
  if (!player) return { state, ok: false };
  const result = equip(player.inventory, backpackIndex, slot);
  if (!result.ok) return { state, ok: false };
  return { state: { ...state, player: { ...player, inventory: result.inventory } }, ok: true };
}

/**
 * Unequip the item in `slot` to the backpack — PURE action-mapping helper composing the
 * pure engine op `equipment.unequip`. Returns a new `GameState` (only `player.inventory`
 * changes), or `ok: false` (state unchanged) when the slot is empty or there is no player.
 * See `equipFromBackpack` for the recorded deviation / follow-up.
 */
export function unequipSlot(state: GameState, slot: EquipSlot): { state: GameState; ok: boolean } {
  const player = state.player;
  if (!player) return { state, ok: false };
  const result = unequip(player.inventory, slot);
  if (!result.ok) return { state, ok: false };
  return { state: { ...state, player: { ...player, inventory: result.inventory } }, ok: true };
}

// ===== Stage 3 — deal / draft / loot / character sheet =====================

/** A single stat row on the character sheet. */
export interface StatRow {
  key: StatKey;
  score: number;
  mod: number;
}

/** A skill row on the character sheet (resolved name + effective charge cost). */
export interface SkillRow {
  skillId: SkillId;
  name: string;
  chargeCost: number;
}

/** An equipped-gear row on the character sheet (item name, or `null` when empty). */
export interface EquippedRow {
  slot: EquipSlot;
  name: string | null;
}

/**
 * The full character-sheet projection. A BUILD resource (Enforcer momentum / Hollow
 * corruption) is included only when the class banks one — this is a class mechanic, NOT
 * karma. There is DELIBERATELY no karma / Nature field.
 */
export interface CharacterSheet {
  name: string;
  classId: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  armorClass: number;
  skillCharges: number;
  maxSkillCharges: number;
  stats: StatRow[];
  skills: SkillRow[];
  equipped: EquippedRow[];
  resource?: { kind: 'momentum' | 'corruption'; value: number };
}

/**
 * Project a player to a full character sheet — PURE. `armorClass` is computed live via the
 * engine's `playerArmorClass` (the gear-derived value, not the stored unarmored score).
 * `name` is carried through verbatim as a plain string, for the view to set as TEXT.
 * Emits NO karma field.
 *
 * Skills resolve through `resolveSkill` for the name, and through `effectiveChargeCost` for
 * the cost — the SAME helper `castOptions` and `battle.ts` use, so the sheet and the picker
 * cannot disagree about what a skill costs (G33).
 *
 * G28(e): an id in `skillPool` that no longer resolves is SKIPPED, not dereferenced.
 * `resolveSkill` is typed to return a `SkillDef` but is `SKILLS[skillId]` underneath, so an
 * id this build does not know (a save from an older content set, a mistyped draft grant)
 * returned `undefined` and reading `.id` off it threw — taking the whole character sheet
 * down rather than losing one row.
 */
export function characterSheet(player: Player): CharacterSheet {
  const classDef = CLASSES[player.classId];
  const skills: SkillRow[] = [];
  for (const id of player.skillPool) {
    const skill = resolveSkill(player, id as SkillId);
    if (!skill) continue;
    skills.push({
      skillId: skill.id,
      name: skill.name,
      chargeCost: effectiveChargeCost(player.inventory, skill.chargeCost),
    });
  }
  const sheet: CharacterSheet = {
    name: player.name,
    classId: player.classId,
    level: player.level,
    xp: player.xp,
    hp: player.hp,
    maxHp: player.maxHp,
    armorClass: playerArmorClass(player),
    skillCharges: player.skillCharges,
    maxSkillCharges: player.maxSkillCharges,
    stats: STAT_KEYS.map((key) => ({ key, score: player.stats[key], mod: player.mods[key] })),
    skills,
    equipped: EQUIP_SLOTS.map((slot) => {
      const item = player.inventory.slots[slot];
      return { slot, name: item ? displayItem(item).name : null };
    }),
  };
  if (classDef.resource === 'momentum') {
    sheet.resource = { kind: 'momentum', value: player.momentum ?? 0 };
  } else if (classDef.resource === 'corruption') {
    sheet.resource = { kind: 'corruption', value: player.corruption ?? 0 };
  }
  return sheet;
}

/** A deal projection: cost -> reward only. The karma-derived `pool` is DELIBERATELY omitted. */
export interface DealView {
  cost: string;
  reward: string;
}

/**
 * Project a sacrifice deal to a readable cost -> reward view — PURE. Reuses the engine's
 * `describeCost` / `describeReward`. It DELIBERATELY drops `deal.pool` (a karma / Nature
 * tell) — the UI never surfaces the pool.
 */
export function dealView(deal: SacrificeDeal): DealView {
  return { cost: describeCost(deal.cost), reward: describeReward(deal.reward) };
}

/** A level-up draft card (its offer index + a readable label). */
export interface DraftCard {
  index: number;
  label: string;
}

/**
 * Project the level-up draft offers to readable cards — PURE. The label reuses the engine's
 * `describeDraftOption`; `index` is the offer index the `draft-pick` action carries.
 */
export function draftCards(offers: readonly DraftOption[]): DraftCard[] {
  return offers.map((offer, index) => ({ index, label: describeDraftOption(offer) }));
}

/** A chest/loot reveal row (name + rarity). */
export interface LootRow {
  name: string;
  rarity: Rarity;
}

/**
 * Project chest / loot instances to reveal rows (name + rarity) — PURE, via the engine's
 * `summarizeLoot`.
 */
export function chestReveal(loot: readonly ItemInstance[]): LootRow[] {
  return loot.map((instance) => {
    const summary = summarizeLoot(instance);
    return { name: summary.name, rarity: summary.rarity };
  });
}
