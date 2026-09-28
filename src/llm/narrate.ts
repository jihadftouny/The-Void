// Pure narration-prompt builder — turns the engine's structured events + state
// into a prompt the local model narrates. No DOM, no node-llama-cpp, no
// Math.random/Date.now — framework-agnostic and headlessly testable (this is the
// seed of the N2 `src/llm` runtime; it will grow, e.g. grammar-constrained choices).
import type { GameEvent } from '../game/gameEvent.ts';
import type { GameState } from '../game/game.ts';
import type { Player } from '../game/player.ts';
import { restBrief } from '../game/restBrief.ts';
import { floorDef, floorOf, FLOOR_IDS, type FloorId } from '../game/floors.ts';
import { summarizeLoot } from '../game/loot.ts';
import {
  CONDITION_DATA,
  isBeneficial,
  type BeneficialCondition,
  type ConditionType,
} from '../game/condition.ts';
import { karmaTone } from './tone.ts';

export const VOID_PERSONA =
  'You are the Void — the narrator of a dark, dreamlike descent RPG about ' +
  'psychosis and survival. Write vivid, terse, second-person narration. ' +
  'Concrete and unsettling. Never break character, never list choices, never ' +
  'ask the player questions, never mention game mechanics, dice, or numbers.';

/**
 * Where a malformed `place` reads — C4. WORLD.md §6 [LOCKED]: "The Void is not a place. It
 * is what happens to a mind that goes far enough down." The old fallback named the Void
 * ITSELF as the place you were standing in — in the one sentence of the prompt whose whole
 * job is to say where you are.
 */
export const UNPLACED = 'somewhere further down';

/**
 * The place phrase for the prompt header — "the Undercity" … "the True Void" — C4.
 *
 * The narrator used to be handed the legacy Java level ordinals — the Nth-floor phrasing —
 * rather than the world's own names. It reads `floors.json` through `floors.ts` now — the SAME
 * data the engine's own floor mechanics run on — so what the model is told about where it
 * is cannot drift from where the rules think it is.
 *
 * (`src/render/tokens.ts` carries a second, hand-typed copy of these names for the theme
 * table. A pure core may not import the render layer, so the two copies are held together
 * by a guard — `src/render/floorNames.test.ts` — rather than by an import.)
 *
 * A malformed `place` reads UNPLACED rather than the nearest real floor. `floorOf` CLAMPS,
 * which is right for the engine (a bad save still resolves to rules that exist) and wrong
 * here: a clamp would have the narrator state, with confidence, that you are on floor 1.
 * #18's ascent keeps `place` in 0..4, so the names stay right whichever way the run runs.
 */
export function placeName(place: number): string {
  if (!Number.isInteger(place) || place < 0 || place >= FLOOR_IDS.length) return UNPLACED;
  return `the ${floorDef((place + 1) as FloorId).name}`;
}

/**
 * The player-facing name of a condition — C7/C10(c). Reads the ENGINE's own
 * `CONDITION_DATA` display name rather than the raw union id, so the model is told
 * "Agile" and "Brainy" (the two ids whose display name genuinely differs from the id)
 * instead of `quick` and `smart`. The facts are ground truth: a raw id in one reads to
 * the model as the condition's real name, and it narrates the id back at the player.
 *
 * The name is READ and never re-spelled here, so PLAN.md #1.5's `insanity` → `Static`
 * rename lands in `condition.ts` alone. `format.ts` holds the identical helper for the
 * combat log; the two are deliberately separate files, not a shared render import —
 * `src/llm` is a pure core and may not depend on `src/render`.
 */
function conditionName(type: ConditionType): string {
  return CONDITION_DATA[type].displayName;
}

/**
 * How a BUFF lands, per buff and per subject — C10(b).
 *
 * `condition-applied` used to read "You are afflicted with healthy." for Brace, the
 * Enforcer's own defensive skill: the model was told the player's best round was a
 * misfortune, and narrated it that way. A buff is not an affliction, so it gets its own
 * sentence.
 *
 * WHY A TABLE PER BUFF rather than one generic "X settles over you": the display names
 * are a mix of adjectives (Healthy, Agile, Brainy) and a noun (Regeneration), so no
 * single verb reads right for all seven, and the register asks for the specific
 * steadies/quickens phrasing. Keyed on the ID (never the display name), and EXHAUSTIVE
 * over `BeneficialCondition` — an eighth buff fails the build right here instead of
 * silently falling back to "afflicted".
 */
const BUFF_ONSET: Record<BeneficialCondition, { you: string; enemy: string }> = {
  healthy: { you: 'You steady yourself', enemy: 'The enemy steadies' },
  quick: { you: 'You quicken', enemy: 'The enemy quickens' },
  strong: { you: 'You harden', enemy: 'The enemy hardens' },
  smart: { you: 'Your thoughts sharpen', enemy: "The enemy's thoughts sharpen" },
  wise: { you: 'Your sight clears', enemy: "The enemy's sight clears" },
  charming: { you: 'You brighten', enemy: 'The enemy brightens' },
  regeneration: { you: 'Your wounds begin to knit', enemy: "The enemy's wounds begin to knit" },
};

/**
 * One short factual clause describing an event, or '' if it needs no narration.
 *
 * TOTAL over the `GameEvent` union — every one of its kinds (counted in `narrationCoverage.test.ts`) has an explicit case, and
 * the `default:` branch is a compile-time exhaustiveness check (G13). Before that check,
 * 34 kinds fell through a silent `default: return ''`, including `skill-cast`: the
 * player's own class action never reached the model, so on a cast round the only
 * skill-naming fact in the prompt was the ENEMY's `enemy-skill-used`, and the model
 * credited the player's biggest hit to the foe.
 *
 * THE CLASSIFICATION RULE. A kind earns a FACT LINE if and only if all three hold:
 *   1. it is player-observable — someone acted, HP moved, or the world offered or
 *      resolved something; and
 *   2. its clause can be written from the event's OWN fields plus the ENGINE's own display
 *      tables — `CONDITION_DATA` for a condition's name, `BENEFICIAL_CONDITIONS` for
 *      whether it helps or hurts (C7/C10 built both into this file); and
 *   3. it prints no internal enum id (the C9 defect: "On onHit: dealDamage").
 * Everything else returns '' from the DELIBERATE SILENCE block at the bottom, which
 * carries a reason per group. A WRONG fact line is worse than no fact line, because the
 * facts reach the model as ground truth and it will narrate them as true.
 *
 * These clauses are ENGINE FACTS, not authored story prose (that lives in
 * `src/data/story.json`, and is #13's): terse, second person for the player, "The enemy"
 * for the foe, no karma, and never the player's name (G47 / §22.1, WORLD.md §8).
 * `WORLD.md` §0 also reserves two words — *hollow* and *made whole* — so no fact literal
 * added here may spend them. (One PRE-EXISTING line below does: `chest-loot`'s "it is
 * hollow". That is FINDINGS.md C1 and belongs to #13; it is left exactly as it shipped rather
 * than silently rewritten here. Its sibling — the "already whole" line of the full-HP rest
 * event — left with that event in PLAN.md #2.)
 */
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
    case 'condition-applied': {
      // C10(b) + C10(c). A buff gets its own sentence (BUFF_ONSET); everything else is an
      // affliction. Either way the DISPLAY name is what reaches the model, never the id.
      const name = conditionName(e.conditionType);
      if (isBeneficial(e.conditionType)) {
        const onset = BUFF_ONSET[e.conditionType];
        return `${e.subject === 'player' ? onset.you : onset.enemy} — ${name}.`;
      }
      return `${e.subject === 'player' ? 'You are' : 'The enemy is'} afflicted with ${name}.`;
    }
    case 'condition-damage':
      // C10(a): the literal "(s)" optional-plural marker reached the model and, on the
      // fallback path, the player. English has two subjects here and they take two verb
      // forms, so the sentence picks one. "harm from X" rather than "X damage" matches the
      // vocabulary every sibling fact already uses (`attack`, `escape-failed`,
      // `boss-minion-damage`) — one word for hurt, for a 4B model.
      return `${e.subject === 'player' ? 'You suffer' : 'The enemy suffers'} ${e.amount} harm from ${conditionName(e.conditionType)}.`;
    case 'player-unable-to-act':
      return `You cannot act — ${conditionName(e.conditionType)} holds you.`;
    case 'fled':
      return `You break away into the dark.`;
    case 'escape-failed':
      // PLAN.md #1.6: the escape carries no damage now — the enemy's own `attack` fact that
      // follows it says what the blow cost.
      return `Your escape fails.`;
    case 'escape-impossible':
      return `There is no escape here.`;
    case 'victory':
      return `The enemy falls. You are still standing.`;
    case 'defeat':
      return `Your strength gives out.`;
    case 'rest-taken':
      return `You rest; some wounds close.`;
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
      // PLAN.md #2: "find", not "take" — a FULL pack leaves the item in the cache, and the
      // `loot-left-behind` fact beside this says so. "take" would be a lie in that case.
      return e.loot.length > 0
        ? `You pry it open and find ${e.loot.map((l) => l.name).join(', ')}.`
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

    // ---- G13: the beats that used to fall through `default` in silence ----------------
    // Seventeen kinds that pass the three-part rule above. Measurements are from the
    // 400-run / 170,491-step sweep recorded in FINDINGS.md G13.

    case 'skill-cast':
      // G13's HEADLINE. 5,727 steps contained a player cast and 100% reached the model
      // with no fact that the player had acted; 1,395 of them also carried the enemy's
      // identically-named `enemy-skill-used`, so the only named skill in the prompt was
      // the foe's. "You" (never "The enemy") is what makes the two lines distinguishable
      // in the same prompt. The damage clause mirrors the `attack` case above.
      return `You unleash ${e.name}${e.damage ? ` for ${e.damage} harm` : ''}.`;
    case 'detonate':
      return `The built-up charge goes off for ${e.bonusDamage} more.`;
    case 'lifesteal':
      return `You draw ${e.amount} life out of the wound.`;
    case 'self-sacrifice':
      // `ofMaxHp` is the PERMANENT cost — the clause must not make the two sound alike.
      return `You spend ${e.amount} of your own ${
        e.ofMaxHp ? 'lifeblood, and it does not come back' : 'blood'
      }.`;
    case 'shield-gained':
      return `A ward closes over you.`;
    case 'shield-absorbed':
      return `The ward takes ${e.amount} of it.`;
    case 'revive':
      // The player nearly died and did not. Silence here makes the game lie about the
      // single most dramatic thing that can happen in a battle.
      return `You should be dead. You are not — you come back at ${e.healedTo}.`;
    case 'spared':
      // The whole mercy path, and the only route to the grace ending, was silent.
      return `You let ${e.enemyName} live.`;
    case 'boss-summon':
      return `More of them arrive — ${e.minions} now stand against you.`;
    case 'boss-minion-damage':
      // 2,499 steps; 346 of them had NO damage fact at all, so the player lost HP and
      // nothing in the prompt said so.
      return `The others close in and strike you for ${e.amount} harm.`;
    case 'boss-adapt':
      // The mechanic is a to-hit penalty, so the clause carries no number: the narrator
      // is forbidden mechanics, and a to-hit modifier is nothing the player can observe.
      return `It reads your pattern; your next strike will be harder to land.`;
    // ---- PLAN.md #11: the boss's chosen move --------------------------------------------
    case 'boss-move':
      // The move that has NO event of its own gets the line; every other move's own event
      // already speaks (`attack` + `enemy-skill-used`, `boss-summon`, `boss-grieve`), and a second
      // line would narrate one boss action twice.
      if (e.move === 'hold_back') return `It holds back and lets the others do the work.`;
      if (e.move === 'pause') return `It stops, and lets you breathe.`;
      return '';
    case 'boss-grieve':
      // The Sin's new move (§22.31): no blow, one charge lost. No number, no resource word.
      return `It mourns, and something of your strength goes with it.`;
    case 'boss-encounter':
      // Every floor's boss reveal. Mirrors the `final-battle-begins` shape above.
      return `${e.enemyName}, the master of this floor, stands before you.`;
    case 'verdict':
      // The act-4 reckoning — the single payoff of the whole karma system, and it said
      // nothing. NEVER a karma axis or a number: the event deliberately carries none
      // (see gameEvent.ts's own contract comment), and the fact must not invent one.
      return e.outcome === 'grace'
        ? `The reckoning ends in your favour.`
        : `The reckoning ends against you.`;
    case 'draft-offer':
      // Deliberately does NOT list the options: the UI renders the cards, and repeating
      // all three would triple the mechanical text in the prompt. "three" is true by
      // construction — `generateDraft` returns a 3-tuple and `enterLevelUp` is its only
      // emit site (both asserted at run scale in narrationCoverage.test.ts). If the draft
      // ever offers a different number, THIS LINE MUST CHANGE WITH IT.
      return `The descent lays three paths in front of you.`;
    case 'draft-picked':
      // The genuinely blank level-up step (the offer step also emits `level-up`, which is
      // narrated, so it was never blank — the register's phrasing is loose there).
      // `e.option` is the MECHANICAL string ("+1 STR", "Learn Heavy Strike"): faithful
      // ground truth, matching every other fact line, and VOID_PERSONA separately forbids
      // the model from repeating mechanics back at the player.
      // NEEDS-HUMAN: if a real model is seen echoing "+1 STR", take the contentless
      // fallback — replace the line below, and nothing else, with:
      //     return `Something new settles into you.`;
      return `You take what the descent offers: ${e.option}.`;

    // ---- PLAN.md #2: the floor mechanics, the found rest, the full-pack bargain -------
    // Engine facts under the same three-part rule: observable, written from the event's own
    // fields, no enum id. No numbers (VOID_PERSONA forbids them and none is needed), no karma,
    // no reserved word (WORLD.md §0) — held to that by the reserved-word and hidden-karma
    // guards, which cover every fact literal.

    case 'floor-drain':
      // Floor 3's charge bleed at battle open. The amount is the log's to show.
      return `Something in this place takes a little of your strength.`;
    case 'illusion-struck':
      // Floor 2. Says what the player SAW — the blow met nothing — without naming an illusion
      // the player has not yet seen through.
      return `Your blow passes through it.`;
    case 'illusion-dispelled':
      return `It was never there.`;
    case 'loot-left-behind':
      return `You cannot carry ${e.name}; you leave it.`;
    // PLAN.md #1.6 — the §16.1 tempo gauge's two MOMENTS. Words, never the gauge's number.
    case 'tempo-extra-action':
      return e.subject === 'player' ? `You move again before it can answer.` : `The enemy moves again.`;
    case 'tempo-lost-turn':
      // Not "too slow" (the plan's wording): `slow` is a condition id, and a lost turn is the
      // gauge, not the Slow condition — the text-hygiene rules would rightly flag it.
      return e.subject === 'player'
        ? `You fall behind; the moment passes.`
        : `The enemy falls behind; the moment passes.`;
    case 'rest-found':
      // The scene itself (the place, the character's condition, the tone) is the scene block
      // `buildNarrationPrompt` appends for this step; this fact line only anchors it.
      return `You find somewhere to rest: ${e.place}.`;
    case 'skills-warped':
      return `Your skills no longer feel like your own.`;
    case 'deal-needs-room':
      return `Your pack is full; to take ${e.reward}, you must leave something behind.`;
    case 'item-discarded':
      return `You leave ${e.name} behind.`;

    // ---- G13: DELIBERATE SILENCE — seventeen kinds that return '' on purpose ----------
    //
    // This block is the reviewable record of "these were considered and silenced", and it
    // is what stops the enumeration going stale a third time. It is CURATED, not "whatever
    // the register did not name" — and the curation is load-bearing, because of G42.
    //
    // ⚠ WHY SILENCE IS NOW A DECISION WITH A COST. The G42 fix in src/desktop/game.ts
    // clears the narration pane only once a prompt exists. That is right — it stops the
    // click after the ending erasing the ending's own prose — but it means a step whose
    // events are ALL silent no longer blanks the pane: it leaves the PREVIOUS beat sitting
    // there. For a rejected input that is exactly correct (nothing happened, so the
    // narration should not change). For anything that actually happened it would be a lie
    // on screen. So: if a kind means something HAPPENED, it must get a fact line above,
    // even if the register never named it. That is why `shield-gained`, `shield-absorbed`
    // and `revive` are narrated (as the declined-rest and no-rest-left events were, until
    // PLAN.md #2 removed the rest decision they reported).

    // Rejected inputs — the player asked for something they could not do, so NOTHING
    // happened. Silence is correct, and leaving the previous beat on screen is correct.
    case 'cast-unavailable':
    case 'spare-unavailable':
    case 'consumable-unavailable':
      return '';

    // The condition family. These four STAY SILENT — and the reason has changed, so the
    // note has to. The tools they were waiting on now exist in this file (`conditionName`,
    // `BUFF_ONSET`), so writing them is no longer blocked by C7/C10. What keeps them
    // silent is PROMPT BUDGET: `condition-applied` (cased above) already tells the model
    // a condition landed, and `condition-damage` tells it what that cost. Adding onset,
    // heal, skip and expiry would put up to four more condition lines in a single round's
    // facts — for a 4B model with a fixed, near-full prompt, that crowds out the beat the
    // round was actually about. Changing the fact/silent split is a narrator-spec decision
    // (PLAN.md #12), not a text fix, so it is made there with the budget in view.
    case 'condition-onset':
    case 'condition-heal':
    case 'condition-skip':
    case 'condition-expired':
      return '';

    // Mechanical framing with no observable moment of its own: the `attack` event in the
    // same step already carries the outcome the player actually sees.
    case 'advantage':
    case 'disadvantage':
      return '';

    // A numeric gauge the HUD owns. VOID_PERSONA forbids the narrator naming numbers or
    // mechanics, and a momentum/corruption counter is nothing but both.
    case 'resource-changed':
      return '';

    // PLAN.md #1.6 — the same reason, twice: the tempo gauge's value and a combatant's HP after
    // a blow are numbers the HUD draws. The blow itself (`attack`, `condition-damage`) is the
    // fact; the running total is not a moment.
    case 'tempo-changed':
    case 'hp-changed':
      return '';

    // Carries only internal enum ids (`trigger`, `action`) — printing them IS the C9
    // defect ("On onHit: dealDamage"). Whatever the relic actually DID emits its own event
    // (`shield-gained` / `revive` / damage), and those are narrated, so the effect is
    // visible to the model even though its bookkeeping is not.
    case 'relic-triggered':
      return '';

    // `itemId` and `stat` are internal ids; both need a catalog/stat display-name table
    // that does not exist yet (C7 -> #13). A raw id in a fact reads to the model as the
    // item's real name and it will narrate the id.
    case 'consumable-used':
    case 'stat-stolen':
      return '';

    // Pure phase scaffolding — the UI renders the title screen and the rolled stat line
    // itself. There is no moment here for the Void to narrate.
    case 'title':
    case 'stats-rolled':
      return '';

    default: {
      // EXHAUSTIVENESS (G13). If a 64th `GameEvent` kind is ever added without a case
      // above, `e` is no longer `never` here and THE BUILD FAILS, naming the new kind —
      // instead of the kind silently producing no narration forever, which is how 34 of
      // the 63 got here. This is the gate the register asked for; the register's literal
      // `const _never: never = e;` does not compile under tsconfig's `noUnusedLocals`,
      // so the value is read with `void`. `return _never` would also compile but would
      // hand back an event object where a `string` is declared: `describeEvent` must stay
      // total AND honest, so it returns the empty string.
      const _never: never = e;
      void _never;
      return '';
    }
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

// ---- The rest scene (PLAN.md #2, GAME-DESIGN.md §22.26) -----------------------------------
//
// A found rest is "the only moment in the game where things are truly calm", and the game's
// main LORE channel. For a step whose events include `rest-found`, the prompt gains a SCENE
// block after the facts: where you are (the floor's rest brief — marked placeholder lore,
// #13's to write), how you are (a condition brief with NO digits), and a TONE line of manner
// words from the hidden ledger (`tone.ts`) — then an instruction that forbids stating what the
// tone reflects. What reaches the model is only ever safe to say aloud; what no test can prove
// is whether the model obeys "reflect, never state" (HUMAN-CHECKS, the manual rest-tone check).
//
// The block is NOT a fact: `facts` (and therefore `StoryMemory.beats` and the model-failure
// fallback) stay fact-only, so the tone can never be printed by the engine, carried into later
// prompts, or shown to the player verbatim.

/** The four HP bands the condition brief may name — a word, never a number. */
export function hpBand(hp: number, maxHp: number): 'unhurt' | 'scratched' | 'wounded' | 'near death' {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio >= 1) return 'unhurt';
  if (ratio >= 0.7) return 'scratched';
  if (ratio >= 0.35) return 'wounded';
  return 'near death';
}

/** At most this many carried item names reach the scene (a small model needs a lean prompt). */
const MAX_CARRIED_NAMES = 6;

/**
 * "How you are" — the character's condition in words, with NO digit anywhere. PURE.
 * The band is read AFTER the rest (the state the step returns); whether wounds or conditions
 * were there to ease comes from the `rest-found` event, which knew the character on arrival.
 */
export function conditionBrief(
  player: Player,
  found: { woundsClosed: boolean; conditionsEased: boolean },
): string {
  const carried = [player.inventory.slots.mainHand, ...player.inventory.backpack]
    .filter((i): i is NonNullable<typeof i> => i !== null && i !== undefined)
    .slice(0, MAX_CARRIED_NAMES)
    // No digit may reach the model (VOID_PERSONA: "never … numbers"), and the legacy gear
    // carries placeholder names with a trailing index ("Jaaj Sword 1", #13's to rename) — so a
    // bare number is dropped from a carried name. The player's own screens still show it whole.
    .map((i) => summarizeLoot(i).name.replace(/\s*\d+/g, '').trim())
    .filter((name) => name.length > 0);
  const parts = [
    `You are ${hpBand(player.hp, player.maxHp)}.`,
    found.woundsClosed ? 'Your wounds close.' : 'There was nothing to close.',
    found.conditionsEased ? 'What afflicted you has eased.' : 'Nothing afflicts you.',
    carried.length > 0 ? `You carry ${carried.join(', ')}.` : 'You carry nothing.',
  ];
  return parts.join(' ');
}

/** The instruction that closes the scene block — the "reflect, never state" rule, in words. */
export const REST_SCENE_INSTRUCTION =
  'Describe the place and the character\'s state in three to five calm sentences. This is the ' +
  'only quiet moment in the descent — nothing threatens, nothing watches. Let the tone words ' +
  'colour your description only; never name, judge or explain what kind of person the ' +
  'character is, never say what they are becoming, and never repeat the tone words themselves.';

/**
 * The scene block for a step that found a rest spot, or null for any other step. PURE and
 * deterministic: the whole brief goes in (the model varies the words; the engine picks none).
 */
export function restScene(events: readonly GameEvent[], state: GameState): string | null {
  const found = events.find((e) => e.kind === 'rest-found');
  if (!found || found.kind !== 'rest-found' || !state.player) return null;
  const brief = restBrief(floorOf({ place: found.floor - 1 }));
  const tone = karmaTone(state.karma);
  const lines = [
    `Where you are: ${brief.place}.`,
    ...brief.lore,
    `How you are: ${conditionBrief(state.player, found)}`,
  ];
  if (tone.length > 0) lines.push(`Tone: ${tone.join(', ')}.`);
  lines.push(REST_SCENE_INSTRUCTION);
  return lines.join('\n');
}

/**
 * Build the narration prompt for the events that just occurred, optionally
 * prefixed with continuity from `memory` (a one-line run summary + recent
 * moments). Returns null when nothing narratable happened (pure input phases
 * like name entry) — the UI then simply shows its choices with no new prose.
 *
 * `facts` is the already-computed engine fact list, returned alongside the prompt so a
 * caller that needs the facts themselves does not have to re-derive them by slicing the
 * user string apart. This is the hook FINDINGS.md G26 needs (#0c): the renderer's
 * model-failure fallback currently prints `prompt.user.split('\n\n')[0]`, which on any step
 * with story memory is the PREVIOUS beats rather than this one. Purely additive — no
 * existing consumer changes — and it means a later unit never has to reopen this file.
 */
export function buildNarrationPrompt(
  events: readonly GameEvent[],
  state: GameState,
  memory?: StoryMemory,
): { system: string; user: string; facts: readonly string[] } | null {
  const facts = eventsToFacts(events);
  if (facts.length === 0) return null;
  let context = '';
  if (memory) {
    const run = runSummary(memory);
    if (run) context += run + '\n';
    if (memory.beats.length > 0)
      context += `Recent moments (oldest first):\n- ${memory.beats.join('\n- ')}\n`;
    if (context) context += '\n';
  }
  // PLAN.md #2: a found rest replaces the generic closing instruction with its scene block.
  // Every other step's prompt is byte-for-byte what it was (a test holds it to that).
  const scene = restScene(events, state);
  const user =
    context +
    `Act ${state.act}, ${placeName(state.place)}. What just happened:\n- ` +
    facts.join('\n- ') +
    (scene === null
      ? `\n\nNarrate this new moment in 2-4 vivid second-person sentences. ` +
        `Stay consistent with what came before; do not repeat earlier narration.`
      : `\n\n${scene}`);
  return { system: VOID_PERSONA, user, facts };
}
