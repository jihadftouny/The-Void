// Pure narration-prompt builder — turns the engine's structured events + state
// into a prompt the local model narrates. No DOM, no node-llama-cpp, no
// Math.random/Date.now — framework-agnostic and headlessly testable (this is the
// seed of the N2 `src/llm` runtime; it will grow, e.g. grammar-constrained choices).
import type { GameEvent } from '../game/gameEvent.ts';
import type { GameState } from '../game/game.ts';

export const VOID_PERSONA =
  'You are the Void — the narrator of a dark, dreamlike descent RPG about ' +
  'psychosis and survival. Write vivid, terse, second-person narration. ' +
  'Concrete and unsettling. Never break character, never list choices, never ' +
  'ask the player questions, never mention game mechanics, dice, or numbers.';

const FLOORS = [
  'the First Floor',
  'the Second Floor',
  'the Third Floor',
  'the Fourth Floor',
  'the Fifth Floor',
];

/** One short factual clause describing an event, or '' if it needs no narration. */
export function describeEvent(e: GameEvent): string {
  switch (e.kind) {
    case 'intro':
      return e.lines.join(' ');
    case 'player-created':
      return `You are ${e.name}, a ${e.classId}, at the threshold of the descent.`;
    case 'encounter-start':
      return `A ${e.enemyName} emerges to bar your way.`;
    case 'enemy-skill-used':
      return `The enemy unleashes ${e.name}.`;
    case 'attack': {
      const who = e.subject === 'player' ? 'You' : 'The enemy';
      const verb =
        e.outcome === 'miss'
          ? 'strike but miss'
          : e.outcome === 'crit'
            ? 'land a devastating blow'
            : e.outcome === 'fumble'
              ? 'fumble the attack'
              : 'connect';
      const dmg = e.damage ? ` for ${e.damage} harm` : '';
      return `${who} ${verb}${dmg}.`;
    }
    case 'condition-applied':
      return `${e.subject === 'player' ? 'You are' : 'The enemy is'} afflicted with ${e.conditionType}.`;
    case 'condition-damage':
      return `${e.subject === 'player' ? 'You' : 'The enemy'} suffer(s) ${e.amount} ${e.conditionType} damage.`;
    case 'player-unable-to-act':
      return `You cannot act — ${e.conditionType} holds you.`;
    case 'potion-drunk':
      return `You drink a potion; warmth returns.`;
    case 'fled':
      return `You break away into the dark.`;
    case 'escape-failed':
      return `Your escape fails; you take ${e.damage} harm.`;
    case 'escape-impossible':
      return `There is no escape here.`;
    case 'victory':
      return `The enemy falls. You are still standing.`;
    case 'defeat':
      return `Your strength gives out.`;
    case 'rest-lore':
      return `You rest, and a fragment surfaces: "${e.loreText}"`;
    case 'rest-taken':
      return `You rest; some wounds close.`;
    case 'rest-full':
      return `You are already whole; rest brings only quiet.`;
    case 'shop-offer':
      return `A shrouded stranger offers you a ${e.itemName}, in trade for your ${e.currentName}.`;
    case 'shop-purchased':
      return `The trade is made.`;
    case 'shop-declined':
      return `You turn the stranger away.`;
    case 'shop-insufficient':
      return `You lack what the stranger demands.`;
    case 'level-up':
      return `Something in you hardens; you are stronger than before.`;
    case 'act-outro':
      return e.body;
    case 'act-intro':
      return e.body;
    case 'final-battle-begins':
      return `${e.enemyName}, the end of the descent, stands before you.`;
    case 'ending':
      return e.body;
    case 'game-over':
      return `Darkness takes you. The descent is over.`;
    default:
      return '';
  }
}

/** The narratable factual clauses for a set of events (drops empty ones). */
export function eventsToFacts(events: readonly GameEvent[]): string[] {
  return events.map(describeEvent).filter((s) => s.length > 0);
}

// ---- Short-term story memory -----------------------------------------------
// A compact, serializable running record of recent beats — the AI's "story so
// far". We keep FACT lines (cheap, deterministic, engine-derived), not past
// prose, and cap the count so a small local model always gets a lean prompt.
// Plain data → it can be dropped straight into the save file later (long-term).
export interface StoryMemory {
  beats: string[];
}
const MAX_REMEMBERED_BEATS = 5;

export function createStoryMemory(): StoryMemory {
  return { beats: [] };
}

/** Return a new memory with this beat's facts appended (capped, immutable). */
export function rememberBeat(memory: StoryMemory, facts: readonly string[]): StoryMemory {
  if (facts.length === 0) return memory;
  const beats = [...memory.beats, facts.join(' ')].slice(-MAX_REMEMBERED_BEATS);
  return { beats };
}

/**
 * Build the narration prompt for the events that just occurred, optionally
 * prefixed with the recent story-so-far from `memory` (for continuity).
 * Returns null when nothing narratable happened (pure input phases like name
 * entry) — the UI then simply shows its choices with no new prose.
 */
export function buildNarrationPrompt(
  events: readonly GameEvent[],
  state: GameState,
  memory?: StoryMemory,
): { system: string; user: string } | null {
  const facts = eventsToFacts(events);
  if (facts.length === 0) return null;
  const floor = FLOORS[state.place] ?? 'the Void';
  const soFar =
    memory && memory.beats.length > 0
      ? `The story so far (oldest first):\n- ${memory.beats.join('\n- ')}\n\n`
      : '';
  const user =
    soFar +
    `Act ${state.act}, ${floor}. What just happened:\n- ` +
    facts.join('\n- ') +
    `\n\nNarrate this new moment in 2-4 vivid second-person sentences. ` +
    `Stay consistent with the story so far; do not repeat earlier narration.`;
  return { system: VOID_PERSONA, user };
}
