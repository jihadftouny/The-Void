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
import type { GameState, GameInput, Phase } from '../game/game.ts';
import type { Player } from '../game/player.ts';
import type { RunSummary, NewlyUnlocked } from '../game/unlockStore.ts';
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
import { BOSSES } from '../game/boss.ts';
import { buttonModel, type ButtonModel } from '../render/component-model.ts';

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

// ===== Stage 4 — the end of a run =========================================
// G2 (GAME-DESIGN.md §22.15): winning left a RESUMABLE save. `dispatch()` cleared the run
// only on `awaiting === 'game-over'`, but a victory settles at `phase.kind === 'ending'` and
// autosaved instead — so relaunching after an ascension offered "A descent lies unfinished.
// Return to it, or begin anew", pointing at a run that was already over. §22.15 also rejected
// "the minimal delete-only patch… gives wins no record", which is why the clear ships
// alongside a summary rather than on its own.

/**
 * Is this phase the END of the run? PURE, and EXHAUSTIVE over `Phase['kind']` by construction:
 * the map is a `Record<Phase['kind'], boolean>`, so an eighteenth phase fails the build here
 * rather than defaulting to "the run continues" and quietly recreating G2.
 *
 * `awaiting` is deliberately NOT a parameter. `awaitingFor` is a total function of the phase,
 * so passing both would create two sources of truth that can disagree — and the disagreement
 * between them (`phase.kind === 'ending'` for the apply, `awaiting === 'game-over'` for the
 * clear) is exactly what G2 was.
 */
const RUN_OVER: Record<Phase['kind'], boolean> = {
  title: false,
  'name-entry': false,
  'class-select': false,
  'stats-roll': false,
  'main-menu': false,
  battle: false,
  'battle-victory': false,
  rest: false,
  deal: false,
  chest: false,
  'act-outro': false,
  'level-up-draft': false,
  'level-up-result': false,
  'act-intro': false,
  verdict: false,
  // The two terminal phases: an ending reached (grace or damnation), or the run is over.
  ending: true,
  'game-over': true,
};

export function isRunOver(phase: Phase): boolean {
  return RUN_OVER[phase.kind];
}

/** One label/value line of the end-of-run summary. */
export interface RunSummaryRow {
  label: string;
  value: string;
}

/** The factual account of a finished run. */
export interface RunSummaryView {
  /** The outcome, in player words. */
  headline: string;
  rows: RunSummaryRow[];
}

/** The seed row's label. One string, so the renderer and its guard cannot disagree on it. */
export const SEED_ROW_LABEL = 'Seed';

/** The player-facing depth phrase. `maxAct` 0 means the run never got past the threshold. */
function depthText(maxAct: number): string {
  return maxAct <= 0 ? 'You never left the threshold.' : `Act ${maxAct} of 5`;
}

/**
 * The FACTUAL end-of-run summary — PURE, no DOM. Outcome, depth reached, bosses felled BY
 * NAME, foes spared, and anything newly unlocked BY NAME.
 *
 * SCOPE, decided rather than omitted: this is the factual half only. The Void's own NARRATED
 * account of your descent is G10, which belongs to PLAN.md #6 (cut to v1.3 by
 * SHIP-SCOPE.md §4). §22.15 rejected "the minimal delete-only patch… gives wins no record" —
 * a factual record IS a record, so this satisfies that ruling's stated intent, and G10 stays
 * open for the narrated half.
 *
 * NO RAW ID may appear in any row. A boss reads `BOSSES[id].name`, a relic reads its catalog
 * name, and the internal axes (feat ids, enemy families, affixes, skill ids) are not printed
 * at all — they are gradual-reveal machinery the player is never shown. A test sweeps every
 * row against those id sets.
 */
export function runSummaryView(
  summary: RunSummary,
  player: Player | null,
  newlyUnlocked: NewlyUnlocked | null,
  seed: number,
): RunSummaryView {
  const headline =
    summary.endingType === 'grace'
      ? 'Found worthy. The descent ends in grace.'
      : summary.endingType === 'damnation'
        ? 'The Hollow unmade. The descent ends in damnation.'
        : 'The descent ends here.';

  const rows: RunSummaryRow[] = [];
  if (player) rows.push({ label: 'Who you were', value: `${player.classId}, level ${player.level}` });
  rows.push({ label: 'Depth reached', value: depthText(summary.maxAct) });
  rows.push({
    label: 'Bosses felled',
    value:
      summary.bossKills.length > 0
        ? summary.bossKills.map((id) => BOSSES[id].name).join(', ')
        : 'none',
  });
  rows.push({ label: 'Foes spared', value: String(summary.spareCount) });

  // Only the two axes the player can actually see the effect of: a class becomes selectable
  // on the next run, and a relic becomes offerable at an altar. Families and affixes are the
  // gradual-reveal machinery; feats are internal ids; no feat grants a skill today.
  const unlocked = [
    ...(newlyUnlocked?.classes ?? []),
    ...(newlyUnlocked?.relics ?? []).map((id) => getCatalogItemById(id)?.name ?? id),
  ];
  if (unlocked.length > 0) rows.push({ label: 'Newly unlocked', value: unlocked.join(', ') });
  // G8, THE DISPLAY HALF. The run seed was generated, saved (since G19) and never shown to
  // anybody — so a tester who hit a bug had no way to say WHICH run it happened in, and the
  // one number that would reproduce it exactly was sitting in the renderer, unrendered.
  // Shown as a plain decimal string, unconditionally: a row that appears only on some runs
  // is a row a bug report can be missing. Making it ENTERABLE is #1.11's half, not this one's.
  rows.push({ label: SEED_ROW_LABEL, value: String(seed) });
  return { headline, rows };
}

// ===== Stage 5 — two small controls the UI got wrong ======================

/**
 * What to show when the model fails mid-beat — G26. PURE.
 *
 * The renderer's `catch` printed `prompt.user.split('\n\n')[0]`. On any step with story
 * memory that first block is the CONTINUITY RECAP — the run summary and the last five beats —
 * so a model failure on the turn you landed a critical hit printed "Across this descent you
 * have felled 1 foe / Recent moments…" and never a word about the crit. The fallback
 * described the past and called it the present.
 *
 * `buildNarrationPrompt` now returns the computed `facts` alongside the prompt (#0b's U7 hook,
 * added for exactly this), so the fallback can read THIS beat directly instead of slicing the
 * user string apart and hoping the first block is the right one.
 */
export function fallbackNarration(
  prompt: { facts: readonly string[] } | null,
): string {
  const facts = prompt?.facts ?? [];
  return facts.length > 0 ? facts.join(' ') : '(the Void is silent)';
}

/**
 * The Potion button — PURE. Carries the remaining count as a hint, and is DISABLED at zero.
 *
 * It used to be an unconditional `choice('Potion', …)`. At 0 potions, at full HP, or under
 * the Void Pact relic, pressing it dispatched a whole engine step that resolved nothing: the
 * button looked live, the turn did not advance, and (until this unit) the one event it emitted
 * was rendered nowhere at all. A disabled `ButtonModel` gets NO click handler from
 * `actionButton`, so it is inert as well as greyed — a stray press cannot dispatch.
 *
 * Only the count is gated here. "Already at full HP" and the `cannotHeal` relic are still
 * engine refusals; the log now says so (`potion-unavailable`), which it never could before.
 */
export function potionControl(player: Player | null): ButtonModel {
  const pots = player?.pots ?? 0;
  return buttonModel('Potion', { disabled: pots <= 0, hint: `(${pots})` });
}

// ===== The hub menu — G5 / GAME-DESIGN.md §19.4 ============================

/**
 * Which hub screen a menu row routes to. These are RENDER-LAYER modes, not engine phases:
 * the engine is still sitting at `main-menu` behind every one of them.
 */
export type HubScreen = 'inventory' | 'sheet' | 'settings';

/** Which face of the hub is on screen: the command list, or the abandon confirmation. */
export type HubMode = 'menu' | 'confirm-abandon';

/**
 * What pressing a hub row does. Exactly three shapes, and the split is load-bearing:
 * only `dispatch` reaches the engine, so "can this row end the run?" is answerable by
 * looking at the model rather than by reading the renderer.
 */
export type HubItemAction =
  | { kind: 'dispatch'; input: Extract<GameInput, { kind: 'menu' }> }
  | { kind: 'screen'; screen: HubScreen }
  | { kind: 'mode'; mode: HubMode };

export interface HubItem {
  label: string;
  action: HubItemAction;
  /** True for the row that destroys the run. CSS uses it; nothing else may. */
  destructive?: boolean;
  /** True where a rule separates this row from the one above (the §19.4 "move it"). */
  separated?: boolean;
}

export interface HubMenuView {
  /** The confirmation question, naming what is lost. `null` on the ordinary menu. */
  prompt: string | null;
  items: HubItem[];
}

/**
 * THE HUB, AS A MODEL — the whole of G5's fix, decided in a pure function.
 *
 * `GAME-DESIGN.md` §19.4, verbatim: "Abandon the descent" *"currently sits third, directly
 * under 'Continue the descent', and one click permanently destroys a 45–90 minute permadeath
 * run"*. The ruling is two-part and BOTH parts are here, because §19.4 says so explicitly:
 * *"Also move it, because the adjacency is what causes the misclick — a confirmation alone
 * treats the symptom."*
 *
 * 1. **It moved.** It is last, below every safe row, and separated by a rule.
 * 2. **It confirms.** In `'menu'` mode NO row dispatches `quit` at all — the destructive row
 *    switches MODE. The quit input exists in exactly one place in the whole game: the
 *    confirmation's own accept row. That is why `screensSource.test.ts` can assert that the
 *    string `'quit'` does not occur in `game.ts` at all, which is a far stronger statement
 *    than "the renderer asks first".
 *
 * NOT here, and deliberately: the save-slot overwrite confirmation §19.4 names in the same
 * breath. There are no save slots yet (N3), and a confirmation for a thing that cannot happen
 * is the "control that controls nothing" this project keeps re-cutting itself on.
 *
 * The on-demand bargain row is GONE (PLAN.md #2, §22.23): bargains are random descent events
 * that find the player, so the hub has nothing to summon them with.
 */
export function hubMenu(mode: HubMode): HubMenuView {
  if (mode === 'confirm-abandon') {
    return {
      // Names what is lost, in the player's own terms. A confirmation that only says "are you
      // sure?" makes the player guess at the stakes, which is the same misclick one dialog later.
      prompt:
        'Abandon this descent? The run ends here and cannot be resumed — the character, ' +
        'everything carried, and every floor reached are gone.',
      items: [
        {
          label: 'Yes — abandon the descent',
          action: { kind: 'dispatch', input: { kind: 'menu', choice: 'quit' } },
          destructive: true,
        },
        { label: 'No — keep descending', action: { kind: 'mode', mode: 'menu' } },
      ],
    };
  }
  return {
    prompt: null,
    items: [
      {
        label: 'Continue the descent',
        action: { kind: 'dispatch', input: { kind: 'menu', choice: 'continue' } },
      },
      { label: 'Inventory', action: { kind: 'screen', screen: 'inventory' } },
      { label: 'Character sheet', action: { kind: 'screen', screen: 'sheet' } },
      { label: 'Settings', action: { kind: 'screen', screen: 'settings' } },
      {
        label: 'Abandon the descent',
        action: { kind: 'mode', mode: 'confirm-abandon' },
        destructive: true,
        separated: true,
      },
    ],
  };
}
