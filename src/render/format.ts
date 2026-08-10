// Player-facing text formatting for The Void's UI shell — PURE, Kaplay-free.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: imports only TYPES from src/game plus the STAT_KEYS
//    constant (a plain readonly array); no Kaplay / DOM. Unit-tested under `node`.
//  - #3 Data-driven: `formatEvent` prefers a `text` the logic already populated;
//    otherwise it renders a hand-written per-kind template. It FORMATS already-
//    computed values only — it never recomputes a game rule (no damage math, no
//    XP/gold math, no HP math). The switch is exhaustive with no `default`, so a new
//    GameEvent kind fails the build here rather than rendering blank.
//
// The `formatEvent` output feeds the scrolling terminal log; `hpText` feeds the HP
// bars.

import type { GameEvent } from '../game/gameEvent.ts';
import type { CombatSubject } from '../game/combatEvent.ts';
import { STAT_KEYS } from '../game/character.ts';
import type { Stats } from '../game/character.ts';

/** "hp/maxHp" — e.g. hpText(8, 20) === "8/20". Formats; computes nothing. */
export function hpText(hp: number, maxHp: number): string {
  return `${hp}/${maxHp}`;
}

/** The player-facing label for a combat subject. */
function sideName(subject: CombatSubject): string {
  return subject === 'player' ? 'You' : 'The enemy';
}

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
      return `${sideName(e.subject)} gain the advantage.`;
    case 'disadvantage':
      return `${sideName(e.subject)} are at a disadvantage.`;
    case 'player-unable-to-act':
      return `You cannot act — ${e.conditionType}.`;
    case 'condition-onset':
      return `${sideName(e.subject)} succumb to ${e.conditionType}.`;
    case 'condition-damage':
      return `${sideName(e.subject)} take ${e.amount} damage from ${e.conditionType}.`;
    case 'condition-heal':
      return `${sideName(e.subject)} recover ${e.amount} from ${e.conditionType}.`;
    case 'condition-skip':
      return `${sideName(e.subject)} lose the turn to ${e.conditionType}.`;
    case 'condition-applied':
      return `${e.conditionType} takes hold of ${sideName(e.subject).toLowerCase()}.`;
    case 'condition-expired':
      return `${e.conditionType} fades from ${sideName(e.subject).toLowerCase()}.`;
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
      return `No potions left to drink.`;
    case 'potion-blocked':
      return `You cannot drink a potion right now.`;
    case 'fled':
      return `You escape into the Void.`;
    case 'escape-failed':
      return `Your escape fails — you take ${e.damage} damage.`;
    case 'escape-impossible':
      return `There is no escape from this one.`;
    case 'victory': {
      const rest = e.extraRest ? ', and you find a place to rest' : '';
      const loot =
        e.loot.length > 0 ? ` You scavenge ${e.loot.map((l) => l.name).join(', ')}.` : '';
      return `Victory! +${e.xpGained} XP${rest}.${loot}`;
    }
    case 'defeat':
      return `You have fallen.`;
    // --- M6 items-content events ---
    case 'relic-triggered':
      return `A relic answers (${e.trigger}).`;
    case 'consumable-used':
      return `You use ${e.itemId}.`;
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
    case 'rest-lore':
      return `${e.title}\n${e.loreText}`;
    case 'rest-taken':
      return `You rest and recover ${e.hpRestored} HP (now ${hpText(e.hp, e.maxHp)}).`;
    case 'rest-full':
      return `You are already at full health.`;
    case 'rest-declined':
      return `You press on without resting.`;
    case 'no-rests':
      return `You have no rest remaining.`;
    case 'shop-offer':
      return `The stranger offers ${e.itemName} (${e.itemKind}).`;
    case 'shop-purchased':
      return `You take ${e.itemId}.`;
    case 'shop-insufficient':
      return `You cannot afford that.`;
    case 'shop-declined':
      return `You wave the stranger away.`;
    case 'character-info':
      return `— Your standing —`;
    case 'act-outro':
      return [e.header, e.body].filter(Boolean).join('\n');
    case 'level-up':
      return `Level up! You raise ${e.picks.join(', ')} — HP roll ${e.hpRoll}, max HP now ${e.newMaxHp}.`;
    case 'act-intro':
      return [e.header, e.body].filter(Boolean).join('\n');
    case 'final-battle-begins':
      return `The final battle begins: ${e.enemyName}.`;
    case 'ending':
      return [e.header, e.body].filter(Boolean).join('\n');
    case 'game-over':
      return `Game over. Final XP: ${e.xp}.`;
  }
}
