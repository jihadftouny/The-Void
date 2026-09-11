// Player-facing text formatting for The Void's UI shell — PURE, Kaplay-free.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: imports only TYPES from src/game plus three PURE,
//    RNG-free lookups — the `STAT_KEYS` / `CONDITION_DATA` data tables and the
//    `getCatalogItemById` catalog accessor. No Kaplay / DOM. Unit-tested under `node`.
//  - #3 Data-driven: `formatEvent` prefers a `text` the logic already populated;
//    otherwise it renders a hand-written per-kind template. It FORMATS already-
//    computed values only — it never recomputes a game rule (no damage math, no
//    XP/gold math, no HP math). The switch is exhaustive with no `default`, so a new
//    GameEvent kind fails the build here rather than rendering blank.
//  - NO RAW ID EVER REACHES THE PLAYER (C7 / the C9 family). A condition renders as its
//    `CONDITION_DATA` display name, a consumable as its catalog name, a relic trigger as
//    a phrase from an exhaustive `Record<TriggerType, string>`. Three of these were
//    invisible until G18 put the log on screen and G14 made consumables obtainable.
//
// The `formatEvent` output feeds the scrolling terminal log; `hpText` feeds the HP
// bars.

import type { GameEvent } from '../game/gameEvent.ts';
import type {
  CombatEvent,
  CombatSubject,
  DamageSource,
  DamageSourceKind,
} from '../game/combatEvent.ts';
import { STAT_KEYS } from '../game/character.ts';
import type { Stats } from '../game/character.ts';
import { CONDITION_DATA } from '../game/condition.ts';
import type { ConditionType } from '../game/condition.ts';
import { getCatalogItemById, type TriggerType } from '../game/item.ts';

/** "hp/maxHp" — e.g. hpText(8, 20) === "8/20". Formats; computes nothing. */
export function hpText(hp: number, maxHp: number): string {
  return `${hp}/${maxHp}`;
}

/** The player-facing label for a combat subject. */
function sideName(subject: CombatSubject): string {
  return subject === 'player' ? 'You' : 'The enemy';
}

/**
 * The agreeing verb form for a subject — English grammar, not a game rule (C7's
 * parenthetical / G46). "You" is second person and takes the BASE form; "The enemy" is
 * third-person SINGULAR and takes the -s form. Every subject-carrying line below goes
 * through here, so "The enemy succumb" cannot come back one case at a time.
 */
function verbFor(subject: CombatSubject, base: string, thirdPerson: string): string {
  return subject === 'player' ? base : thirdPerson;
}

/**
 * The player-facing name of a condition — C7. Reads the ENGINE's `CONDITION_DATA`
 * display name rather than the raw union id, so the log says "Insanity", never
 * `insanity`, and "Agile"/"Brainy" rather than `quick`/`smart` (the two ids whose
 * display name genuinely differs). Because the name is read and never re-spelled,
 * PLAN.md #1.5's `insanity` → `Static` rename lands in `condition.ts` alone.
 */
function conditionName(type: ConditionType): string {
  return CONDITION_DATA[type].displayName;
}

/**
 * The player-facing name of a catalog item — never the raw id. `consumable-used` carried
 * `itemId` straight into the sentence ("You use void-draught."), which was invisible while
 * no consumable could be obtained; G14 makes it the FIRST thing a player reads after
 * drinking one. An unresolvable id falls back to the id so the line never renders blank.
 */
function itemName(itemId: string): string {
  return getCatalogItemById(itemId)?.name ?? itemId;
}

/**
 * When a relic answered, in player words. EXHAUSTIVE over `TriggerType` by construction, so
 * a seventh combat trigger fails the build here rather than printing its enum id. The old
 * line interpolated `e.trigger` directly — "A relic answers (onHit)." — which is the same
 * raw-id defect as C7, and G18 is what makes it visible.
 */
const TRIGGER_MOMENT: Record<TriggerType, string> = {
  startOfBattle: 'as the battle opens',
  onHit: 'as your blow lands',
  onCrit: 'as your blow lands true',
  onCast: 'as you cast',
  onKill: 'as the enemy falls',
  onTakeDamage: 'as you are struck',
};

/** Render a stat block as "STR 14  DEX 12  ..." in canonical order. */
function statsLine(stats: Stats): string {
  return STAT_KEYS.map((k) => `${k} ${stats[k]}`).join('  ');
}

/**
 * Render a single game event as one player-facing line. Total over the GameEvent
 * union. Prefers `e.text` when the logic populated it; else a per-kind template.
 * Formats only — no rule is recomputed here.
 */
export function formatEvent(e: GameEvent): string {
  if (e.text) return e.text;
  switch (e.kind) {
    // --- combat events ---
    case 'enemy-skill-used':
      return `The enemy casts ${e.name}.`;
    case 'skill-cast':
      return `You cast ${e.name}.`;
    case 'cast-unavailable':
      return `You cannot cast that right now.`;
    case 'attack': {
      const who = sideName(e.subject);
      const verb = e.subject === 'player' ? 'strike' : 'strikes';
      switch (e.outcome) {
        case 'crit':
          return `${who} ${verb} — CRITICAL hit for ${e.damage} damage!`;
        case 'hit':
          return `${who} ${verb} — hit for ${e.damage} damage.`;
        case 'miss':
          return `${who} ${verb} — miss.`;
        case 'fumble':
          return `${who} ${verb} — fumble!`;
      }
      return `${who} ${verb}.`;
    }
    case 'advantage':
      return `${sideName(e.subject)} ${verbFor(e.subject, 'gain', 'gains')} the advantage.`;
    case 'disadvantage':
      return `${sideName(e.subject)} ${verbFor(e.subject, 'are', 'is')} at a disadvantage.`;
    case 'player-unable-to-act':
      return `You cannot act — ${conditionName(e.conditionType)}.`;
    case 'condition-onset':
      return `${sideName(e.subject)} ${verbFor(e.subject, 'succumb', 'succumbs')} to ${conditionName(e.conditionType)}.`;
    case 'condition-damage':
      return `${sideName(e.subject)} ${verbFor(e.subject, 'take', 'takes')} ${e.amount} damage from ${conditionName(e.conditionType)}.`;
    case 'condition-heal':
      return `${sideName(e.subject)} ${verbFor(e.subject, 'recover', 'recovers')} ${e.amount} from ${conditionName(e.conditionType)}.`;
    case 'condition-skip':
      return `${sideName(e.subject)} ${verbFor(e.subject, 'lose', 'loses')} the turn to ${conditionName(e.conditionType)}.`;
    case 'condition-applied':
      return `${conditionName(e.conditionType)} takes hold of ${sideName(e.subject).toLowerCase()}.`;
    case 'condition-expired':
      return `${conditionName(e.conditionType)} fades from ${sideName(e.subject).toLowerCase()}.`;
    // --- M3 class-twist events ---
    case 'resource-changed':
      return `Your ${e.resource} is now ${e.value}.`;
    case 'self-sacrifice':
      return e.ofMaxHp
        ? `You sacrifice ${e.amount} of your max HP to the Void.`
        : `You spend ${e.amount} HP as fuel.`;
    case 'lifesteal':
      return `You drain ${e.amount} HP.`;
    case 'detonate':
      return `You detonate ${e.consumed} affliction(s) for ${e.bonusDamage} damage.`;
    case 'potion-drunk':
      return `You drink a potion — restored to ${e.healedTo} HP.`;
    case 'potion-unavailable':
      // THREE causes share this one event (battle.ts): no potions left, already at full
      // HP, and the Void Pact relic's `cannotHeal`. The old line — "No potions left to
      // drink." — is FALSE for two of the three, and G18 is what puts it on screen. This
      // sentence is true of all three, because it reports the outcome rather than guessing
      // the cause. (Folding potions into consumables, §22.6, is #2's; splitting the event
      // into three would change `GameState`'s event vocabulary, which this unit must not.)
      return `Nothing comes of reaching for a potion.`;
    case 'potion-blocked':
      return `You cannot drink a potion right now.`;
    case 'fled':
      return `You escape into the Void.`;
    case 'escape-failed':
      return `Your escape fails — you take ${e.damage} damage.`;
    case 'escape-impossible':
      return `There is no escape from this one.`;
    case 'spared':
      return `You stay your hand. ${e.enemyName} is spared.`;
    case 'spare-unavailable':
      return `This one cannot be spared.`;
    case 'victory': {
      const loot =
        e.loot.length > 0 ? ` You scavenge ${e.loot.map((l) => l.name).join(', ')}.` : '';
      return `Victory! +${e.xpGained} XP.${loot}`;
    }
    case 'defeat':
      return `You have fallen.`;
    // --- M6 items-content events ---
    case 'relic-triggered':
      return `A relic answers ${TRIGGER_MOMENT[e.trigger]}.`;
    case 'consumable-used':
      return `You use ${itemName(e.itemId)}.`;
    case 'consumable-unavailable':
      return `You have nothing to use.`;
    case 'shield-gained':
      return `A shield forms around you (+${e.amount}).`;
    case 'shield-absorbed':
      return `Your shield absorbs ${e.amount} damage.`;
    case 'revive':
      return `The Void refuses your death — you rise with ${e.healedTo} HP.`;
    case 'stat-stolen':
      return `You devour the enemy's essence (+${e.amount} ${e.stat}).`;
    // --- M12 boss combat mechanics ---
    case 'boss-summon':
      return `Reinforcements arrive — the crew is now ${e.minions} strong.`;
    case 'boss-minion-damage':
      return `The crew strikes you for ${e.amount} damage.`;
    case 'boss-adapt':
      return `Your foe reads your pattern — your next strike falters.`;
    // --- PLAN.md #2 floor mechanics ---
    case 'floor-drain':
      return `This place drains ${e.amount} skill charge${e.amount === 1 ? '' : 's'} from you.`;
    case 'illusion-struck':
      return `Your blow passes through it — nothing is there.`;
    case 'illusion-dispelled':
      // The one roll of the mechanic the player is shown (a FAILED roll emits nothing, or it
      // would name the illusion early). Formats the engine's numbers; recomputes none.
      return `You see through the illusion — Wisdom ${e.total} vs ${e.dc}. It was never there.`;
    case 'loot-left-behind':
      return `Your pack is full — you leave ${e.name} behind.`;

    // --- narrative events ---
    case 'title':
      return `THE VOID`;
    case 'intro':
      return [e.header, ...e.lines].join('\n');
    case 'stats-rolled':
      return `Rolled: ${statsLine(e.stats)}`;
    case 'player-created':
      return `${e.name} the ${e.classId} — ${e.maxHp} HP, AC ${e.armorClass}.`;
    case 'encounter-start':
      return `${e.enemyName} emerges from the dark.`;
    case 'rest-taken':
      return `You rest and recover ${e.hpRestored} HP (now ${hpText(e.hp, e.maxHp)}).`;
    case 'deal-offer':
      return `The altar offers ${e.reward} — the price is ${e.cost}.`;
    case 'deal-taken':
      return `You pay ${e.cost} and take ${e.reward}.`;
    case 'deal-unaffordable':
      return `You cannot pay ${e.cost}.`;
    case 'deal-declined':
      return `You turn from the altar.`;
    case 'chest-found':
      return `You uncover a cache in the dark.`;
    case 'chest-loot':
      return e.loot.length > 0
        ? `Inside: ${e.loot.map((l) => l.name).join(', ')}.`
        : `The cache is empty.`;
    case 'act-outro':
      return [e.header, e.body].filter(Boolean).join('\n');
    case 'level-up':
      return `Level ${e.newLevel}! HP roll ${e.hpRoll}, max HP now ${e.newMaxHp}.`;
    case 'draft-offer':
      return `The descent offers a choice: ${e.options.join(' · ')}.`;
    case 'draft-picked':
      return `You take: ${e.option}.`;
    case 'act-intro':
      return [e.header, e.body].filter(Boolean).join('\n');
    case 'final-battle-begins':
      return `The final battle begins: ${e.enemyName}.`;
    case 'boss-encounter':
      return `${e.enemyName} bars the way.`;
    case 'verdict':
      // Player-facing outcome only — never the karma numbers behind it.
      return e.outcome === 'grace'
        ? `Judgment falls: you are found worthy.`
        : `Judgment falls: you are cast down.`;
    case 'ending':
      return [e.header, e.body].filter(Boolean).join('\n');
    case 'game-over':
      return `Game over. Final XP: ${e.xp}.`;
    // --- PLAN.md #2: the found rest, the warped kit, the full-pack bargain ---
    case 'rest-found':
      return `You find a place to rest: ${e.place}.`;
    case 'skills-warped':
      return `Your skills twist into something else (${e.count} changed).`;
    case 'deal-needs-room':
      return `Your pack is full. Leave something behind to take ${e.reward}.`;
    case 'item-discarded':
      return `You leave ${e.name} behind.`;
  }
}

// ---------------------------------------------------------------------------
// The expandable roll detail (docs/UI-DESIGN.md §3).
//
// `formatEvent` gives the plain one-line story of a blow. `formatRollDetail` is what the
// player opens when they want to know WHY: the dice, the modifier, the AC, and the damage
// broken into the terms that produced it. It re-derives nothing — every number is read
// straight off the event the engine emitted.
// ---------------------------------------------------------------------------

/** An `attack` event, narrowed out of the union. */
type AttackEvent = Extract<CombatEvent, { kind: 'attack' }>;

/**
 * The short name for a damage term that carries no dice notation. Exhaustive over
 * DamageSourceKind, so a new kind in the engine fails the build here rather than rendering
 * as `undefined` in the middle of a line.
 */
const DAMAGE_TERM_NAME: Record<DamageSourceKind, string> = {
  'weapon-dice': 'weapon',
  'crit-dice': 'crit die',
  'ability-mod': 'mod',
  equipment: 'gear',
  perk: 'perk',
  skill: 'skill',
  base: 'strike',
  'crit-multiplier': 'crit',
  'low-hp-bonus': 'low HP',
  'damage-mult': 'multiplier',
  'first-hit-reduction': 'reduction',
  clamp: 'floor',
};

/** Dice notation when the term has it (e.g. '1d8'), else the term's short name. */
function termName(source: DamageSource): string {
  return source.label ?? DAMAGE_TERM_NAME[source.kind];
}

/** ", 1d8 + 1d8 = 9" — empty when the blow dealt no damage terms at all. */
function damagePhrase(event: AttackEvent): string {
  if (event.damageSources.length === 0) return '';
  return `, ${event.damageSources.map(termName).join(' + ')} = ${event.damage}`;
}

/**
 * One line of dice detail for an attack. Formats only — no rule is recomputed.
 *
 *   hit    d20+2 = 17 vs AC 13 → hit, 1d8 = 4
 *   miss   d20+2 = 12 vs AC 13 → miss
 *   adv    d20 adv (7,15)+2 = 17 vs AC 13 → hit, 1d8 = 4
 *   crit   nat 20 → critical, 1d8 + 1d8 = 9
 *   fumble nat 1 → fumble
 *
 * A crit and a fumble drop the "vs AC" clause on purpose: neither consults the armor class
 * (a natural 20 lands whatever the AC, a natural 1 always fails), so printing a comparison
 * that did not happen would be a lie about the rules.
 */
export function formatRollDetail(event: AttackEvent): string {
  const { faces, advDis, modifier, total, targetAc } = event.roll;
  const damage = damagePhrase(event);
  if (event.outcome === 'crit') return `nat 20 → critical${damage}`;
  if (event.outcome === 'fumble') return `nat 1 → fumble`;

  const mod = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  const dice =
    advDis === 0 ? 'd20' : `d20 ${advDis === 1 ? 'adv' : 'dis'} (${faces.join(',')})`;
  return `${dice}${mod} = ${total} vs AC ${targetAc} → ${event.outcome}${damage}`;
}
