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
      // G47 — the narrator NEVER speaks the player's name (GAME-DESIGN.md §22.1,
      // WORLD.md §8 [LOCKED]). `e.name` is a LABEL surface only (the HUD, the character
      // sheet, the save slot); it must never enter a prompt, because a fact line is also
      // written into `StoryMemory.beats` and would then leak into the next five prompts.
      return `You are a ${e.classId}, at the threshold of the descent.`;
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
    case 'deal-offer':
      return `An altar in the dark offers ${e.reward}, and demands ${e.cost} in return.`;
    case 'deal-taken':
      return `You pay the price; the bargain is struck.`;
    case 'deal-declined':
      return `You turn from the altar untouched.`;
    case 'deal-unaffordable':
      return `You have nothing the altar will accept.`;
    case 'chest-found':
      return `You find a cache half-buried in the dark.`;
    case 'chest-loot':
      return e.loot.length > 0
        ? `You pry it open and take ${e.loot.map((l) => l.name).join(', ')}.`
        : `You pry it open, but it is hollow.`;
    case 'level-up':
      return `Something in you hardens; you are stronger than before.`;
    case 'final-battle-begins':
      return `${e.enemyName}, the end of the descent, stands before you.`;
    // G21 — the PLUMBING half. These three cases returned `e.body` alone and threw the
    // header away. All ten act bodies in story.json are still `""` (authoring them is
    // PLAN.md #13, author-only), so every act transition produced NO fact, so
    // `buildNarrationPrompt` returned null and the pane went blank: 47 act-intro + 47
    // act-outro blank screens over 20 runs, one on every floor change. Joining the header
    // back in makes the fact "ACT II" — thin, but non-empty, so the prompt survives and
    // `buildNarrationPrompt` still supplies the act/floor context around it.
    // `filter(Boolean)` is what makes this forward-compatible: when #13 fills the bodies
    // the prose appears here automatically, with NO code change. That is the whole point
    // of the split, and it is why this unit writes no prose.
    case 'act-outro':
    case 'act-intro':
    case 'ending':
      return [e.header, e.body].filter(Boolean).join(' — ');
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
  /** Recent narratable fact-lines — short-term continuity (capped). */
  beats: string[];
  /** Salient run facts a later boss can reference (accumulate over the whole run). */
  enemiesDefeated: number;
  timesFled: number;
  /** Milestone lines (act intros, boss sightings), capped. */
  notable: string[];
}
const MAX_REMEMBERED_BEATS = 5;
const MAX_NOTABLE = 8;

export function createStoryMemory(): StoryMemory {
  return { beats: [], enemiesDefeated: 0, timesFled: 0, notable: [] };
}

/**
 * Fold a turn's events into memory: append the recent beat + accumulate the
 * run-long salient facts. Pure and immutable; returns the same object unchanged
 * for an empty event list (so callers can compare by reference).
 */
export function rememberBeat(memory: StoryMemory, events: readonly GameEvent[]): StoryMemory {
  if (events.length === 0) return memory;
  const facts = eventsToFacts(events);
  let { enemiesDefeated, timesFled } = memory;
  let notable = memory.notable;
  for (const e of events) {
    if (e.kind === 'victory') enemiesDefeated += 1;
    else if (e.kind === 'fled') timesFled += 1;
    else if (e.kind === 'final-battle-begins')
      notable = [...notable, `You faced ${e.enemyName}.`].slice(-MAX_NOTABLE);
    else if (e.kind === 'act-intro') notable = [...notable, e.header].slice(-MAX_NOTABLE);
  }
  const beats =
    facts.length > 0
      ? [...memory.beats, facts.join(' ')].slice(-MAX_REMEMBERED_BEATS)
      : memory.beats;
  return { beats, enemiesDefeated, timesFled, notable };
}

/** A one-line summary of the whole descent so far (continuity / boss references). */
export function runSummary(memory: StoryMemory): string {
  const parts: string[] = [];
  if (memory.enemiesDefeated > 0)
    parts.push(`felled ${memory.enemiesDefeated} foe${memory.enemiesDefeated === 1 ? '' : 's'}`);
  if (memory.timesFled > 0)
    parts.push(`fled ${memory.timesFled} time${memory.timesFled === 1 ? '' : 's'}`);
  return parts.length ? `Across this descent you have ${parts.join(' and ')}.` : '';
}

/**
 * Build the narration prompt for the events that just occurred, optionally
 * prefixed with continuity from `memory` (a one-line run summary + recent
 * moments). Returns null when nothing narratable happened (pure input phases
 * like name entry) — the UI then simply shows its choices with no new prose.
 */
export function buildNarrationPrompt(
  events: readonly GameEvent[],
  state: GameState,
  memory?: StoryMemory,
): { system: string; user: string } | null {
  const facts = eventsToFacts(events);
  if (facts.length === 0) return null;
  const floor = FLOORS[state.place] ?? 'the Void';
  let context = '';
  if (memory) {
    const run = runSummary(memory);
    if (run) context += run + '\n';
    if (memory.beats.length > 0)
      context += `Recent moments (oldest first):\n- ${memory.beats.join('\n- ')}\n`;
    if (context) context += '\n';
  }
  const user =
    context +
    `Act ${state.act}, ${floor}. What just happened:\n- ` +
    facts.join('\n- ') +
    `\n\nNarrate this new moment in 2-4 vivid second-person sentences. ` +
    `Stay consistent with what came before; do not repeat earlier narration.`;
  return { system: VOID_PERSONA, user };
}
