// Use-a-consumable action for The Void — pure, framework-agnostic game logic (M6).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay/DOM/canvas. `applyConsumable` returns NEW
//    player/enemy + an event list and mutates nothing.
//  - Deterministic seeded RNG: RNG-FREE. A consumable's `use: EffectAction[]` is applied by
//    the same RNG-free `applyEffectAction` the relic pipeline uses, so using an item never
//    perturbs the combat dice stream. (Victory rewards — if a throwable kills — are rolled by
//    battle.ts's `killAndVictory`, which owns the extra-rest/gold draws.)
//  - Data-driven content: WHAT a consumable does is its `use` array in consumables.json; this
//    module only dispatches it. Adding a consumable never edits combat code.
//  - Serializable plain-data state: the item is removed from the plain `backpack` array.
//
// TURN COST (orchestrator resolution): using a consumable costs the player's action for the
// round and grants the enemy NO free turn — byte-identical to the existing `potion` action.
// [NEEDS-HUMAN M15: should consumable/potion use grant the enemy a turn?]

import { type Player } from './player.ts';
import { type Enemy } from './enemy.ts';
import { type CombatEvent } from './combatEvent.ts';
import { getCatalogItemById } from './item.ts';
import { applyEffectAction, type TriggerContext } from './relicEffects.ts';

/** Which consumable to use: a backpack slot index (the authoritative loose-item store). */
export interface ConsumableSource {
  index: number;
}

/** The outcome of applying a consumable — new entities, events, and utility flags. */
export interface ConsumableResult {
  player: Player;
  enemy: Enemy;
  events: CombatEvent[];
  /** False when the backpack index is empty or the item has no `use` array (unavailable). */
  consumed: boolean;
  /** A `flee` action fired (Smoke Vial): battle.ts ends the round as `fled`. */
  fled: boolean;
  /** A `reroll` action fired (Lodestone / illusion tools): the reroll target lands in M7/M9. */
  reroll: boolean;
}

/**
 * Apply the consumable at `source.index` in the player's backpack — PURE, RNG-FREE. Resolves
 * its `use: EffectAction[]` from the catalog, applies each action in order via
 * `applyEffectAction`, and REMOVES the item from the backpack. Returns `consumed: false` with
 * a single `consumable-unavailable` event (and inputs unchanged) when the index is empty or
 * the def carries no usable actions. battle.ts wraps this into a `RoundResult` (handling flee /
 * a throwable kill / defeat).
 */
export function applyConsumable(
  player: Player,
  enemy: Enemy,
  source: ConsumableSource,
  // PLAN.md #2: the floor's heal percentage (floor 3 dampens a Void Draught like any heal).
  // Omitted ⇒ `{}`, exactly the context every action was applied with before.
  ctx: TriggerContext = {},
): ConsumableResult {
  const instance = player.inventory.backpack[source.index];
  const def = instance ? getCatalogItemById(instance.defId) : undefined;
  const use = def?.use;
  if (!instance || !def || !use || use.length === 0) {
    return {
      player,
      enemy,
      events: [{ kind: 'consumable-unavailable' }],
      consumed: false,
      fled: false,
      reroll: false,
    };
  }

  // Consume: remove exactly this backpack entry.
  const backpack = player.inventory.backpack.filter((_, i) => i !== source.index);
  let p: Player = { ...player, inventory: { ...player.inventory, backpack } };
  let e = enemy;
  const events: CombatEvent[] = [{ kind: 'consumable-used', itemId: def.id }];
  let fled = false;
  let reroll = false;

  for (const action of use) {
    const out = applyEffectAction(action, p, e, ctx);
    p = out.self;
    e = out.other;
    events.push(...out.events);
    if (out.fled) fled = true;
    if (out.reroll) reroll = true;
  }

  return { player: p, enemy: e, events, consumed: true, fled, reroll };
}
