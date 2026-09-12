// THE BEAT MODEL (PLAN.md #6, AC-20): a round's events become the beats the battle screen
// replays — grouped, never reordered, with every line, float and bar-write traceable to an
// engine event. Every expected value is derived by hand (dice chosen by hand, templates read
// from `format.ts`, schedule arithmetic done here), never read off the module under test.
//
// ⚠ ORDER-AGNOSTIC (Appendix A.1). As of 2026-09-12 the engine emits the enemy's turn before the
// player's in a Fight/Cast round; that is its CURRENT behaviour, not the design, which (§14.8,
// confirmed by the author) has you strike first, with speed from initiative and Dexterity —
// an engine change tracked as FINDINGS G62. NOTHING HERE ASSERTS WHICH SIDE GOES FIRST. The
// engine round below takes its order from the events the engine emitted; the guard block feeds
// a round in EACH order, and with any number of actions per side, and asserts each replays
// faithfully — when the engine changes, this file stays green, and if the beat model ever
// starts imposing an order of its own, the guard goes red.

import { describe, it, expect } from 'vitest';
import {
  BEAT_HOLD_MS,
  BEAT_MS,
  BEAT_ROLE,
  MAX_ROUND_MS,
  MIN_SPACING_MS,
  barUpdateAt,
  beatSchedule,
  floatFor,
  groupBeats,
  touchesOf,
  type Beat,
} from './beat-model.ts';
import { LOG_ROUTING } from './log-model.ts';
import { ONE_OF_EVERY_EVENT } from '../game/eventSamples.testutil.ts';
import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';
import type { CombatEvent } from '../game/combatEvent.ts';
import { createBattle, resolveRound } from '../game/battle.ts';
import { createPlayer } from '../game/player.ts';
import { generateEnemy, type Enemy } from '../game/enemy.ts';
import { mulberry32, type Rng } from '../game/rng.ts';

// ------- fixtures: the illusion test's hand-derivable fight -------------------------------

/** The rng value that makes `rollDie(rng, sides)` land exactly on `face`. */
const face = (f: number, sides: number): number => (f - 0.5) / sides;

/** A scripted rng that THROWS when over-drawn, so a hidden extra draw cannot pass silently. */
function scripted(values: number[]): Rng {
  let i = 0;
  return (() => {
    if (i >= values.length) throw new Error(`scripted rng exhausted after ${i} draws`);
    return values[i++]!;
  }) as Rng;
}

/** An enemy with STR 10 (to-hit mod 0), AC 10, 10 HP and no skills — every roll is arithmetic. */
function foe(): Enemy {
  const base = generateEnemy({ act: 2, type: 'Beast', playerXp: 0 }, mulberry32(4));
  return {
    ...base,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    armorClass: 10,
    hp: 10,
    maxHp: 10,
    resistances: [0, 0, 0, 0, 0, 0, 0],
    skillPool: [],
    skillCharges: 0,
    activeConditions: [],
  };
}

/**
 * One real Fight round, dice by hand (the derivation `illusion.test.ts` records):
 *   [enemy to-hit d20 = 18 → a hit; no skills → the plain strike for 1]
 *   [player to-hit d20 = 15: 15 + 0 (STR 10) + 2 (proficiency) = 17 ≥ AC 10 → a hit]
 *   [1d6 sword = 4]
 * An Enforcer's momentum gain is SILENT and the hero carries no relic, so those two strikes
 * are the whole event list. WHICH COMES FIRST is the engine's business and is read off it.
 */
function engineRound(): CombatEvent[] {
  const hero = { ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: { STR: 10, DEX: 10, CON: 12, INT: 10, WIS: 10, CHA: 10 } }), hp: 12, maxHp: 12 };
  const r = resolveRound(createBattle(hero, foe(), 2), 'fight', scripted([face(18, 20), face(15, 20), face(4, 6)]));
  return r.events;
}

const EVERY: readonly GameEvent[] = Object.values(ONE_OF_EVERY_EVENT);
const nonPane = (events: readonly GameEvent[]): GameEvent[] => events.filter((e) => BEAT_ROLE[e.kind] !== 'pane');

// =========================================================================================

describe('the role table', () => {
  it('is exhaustive over the engine’s event kinds', () => {
    expect(Object.keys(BEAT_ROLE).sort()).toEqual(Object.keys(ONE_OF_EVERY_EVENT).sort());
  });

  it('a kind is the narration’s EXACTLY when the combat log routes it to the pane', () => {
    // Two hand-written tables, built for different reasons, that must agree: if the arena
    // replayed something the log hands to the prose (or dropped something the log keeps), the
    // ticker and the log would tell two different stories of one round.
    for (const kind of Object.keys(LOG_ROUTING) as GameEventKind[]) {
      expect(BEAT_ROLE[kind] === 'pane', kind).toBe(LOG_ROUTING[kind] === 'pane');
    }
  });

  it('the plan’s anchors and attachments, by hand', () => {
    for (const kind of ['attack', 'skill-cast', 'condition-damage', 'victory', 'defeat', 'floor-drain', 'illusion-struck', 'illusion-dispelled', 'consumable-used', 'cast-unavailable'] as const) {
      expect(BEAT_ROLE[kind], kind).toBe('anchor');
    }
    for (const kind of ['enemy-skill-used', 'advantage', 'condition-onset', 'condition-applied', 'resource-changed', 'boss-summon'] as const) {
      expect(BEAT_ROLE[kind], kind).toBe('attach');
    }
  });
});

describe('groupBeats never reorders anything', () => {
  it('over one of every kind: the beats hold exactly the non-pane events, in order', () => {
    const beats = groupBeats(EVERY);
    expect(beats.flatMap((b) => b.events)).toEqual(nonPane(EVERY));
    beats.forEach((b, i) => expect(b.index).toBe(i));
  });

  it('over the same list REVERSED: the same property — the model follows its input', () => {
    const reversed = [...EVERY].reverse();
    expect(groupBeats(reversed).flatMap((b) => b.events)).toEqual(nonPane(reversed));
  });

  it('attached events ride with the NEXT anchor; a trailing set is its own anchorless beat', () => {
    const adv: GameEvent = { kind: 'advantage', subject: 'player' };
    const hit = { ...ONE_OF_EVERY_EVENT.attack, subject: 'player' as const, outcome: 'hit' as const, damage: 3 };
    const applied: GameEvent = { kind: 'condition-applied', subject: 'enemy', conditionType: 'burn' };
    const beats = groupBeats([adv, hit, applied]);
    expect(beats).toHaveLength(2);
    expect(beats[0]!.events).toEqual([adv, hit]);
    expect(beats[0]!.anchor).toBe(hit);
    expect(beats[1]!.anchor).toBeNull();
    // format.ts: `${conditionName} takes hold of ${side.toLowerCase()}.` — Burn's display name.
    expect(beats[1]!.line).toBe('Burn takes hold of the enemy.');
  });

  it('a step with nothing for the arena has no beats', () => {
    expect(groupBeats([])).toEqual([]);
    expect(groupBeats([ONE_OF_EVERY_EVENT['encounter-start'], ONE_OF_EVERY_EVENT['level-up']])).toEqual([]);
  });
});

describe('a real engine round, dice by hand (AC-20)', () => {
  const events = engineRound();
  const beats = groupBeats(events);

  it('is two strikes, and they are the beats — the ENGINE’S events, in the ENGINE’S order', () => {
    expect(events.map((e) => e.kind)).toEqual(['attack', 'attack']);
    expect(beats.map((b) => b.anchor)).toEqual(events); // identity and order, from the engine
  });

  it('the ticker lines are format.ts’s templates on the hand-rolled numbers', () => {
    // `${who} ${verb} — hit for ${damage} damage.` with 'The enemy'/'strikes' and 'You'/'strike'.
    expect(beats.map((b) => b.line).sort()).toEqual(
      ['The enemy strikes — hit for 1 damage.', 'You strike — hit for 4 damage.'].sort(),
    );
    const enemyBeat = beats.find((b) => b.anchor?.kind === 'attack' && b.anchor.subject === 'enemy')!;
    const playerBeat = beats.find((b) => b.anchor?.kind === 'attack' && b.anchor.subject === 'player')!;
    expect(enemyBeat.line).toBe('The enemy strikes — hit for 1 damage.');
    expect(playerBeat.line).toBe('You strike — hit for 4 damage.');
    // Each blow floats over the side it STRUCK, with the engine's own number.
    expect(enemyBeat.float).toEqual({ side: 'player', text: '−1', tone: 'harm' });
    expect(playerBeat.float).toEqual({ side: 'enemy', text: '−4', tone: 'harm' });
    expect(enemyBeat.hook).toBe('hit');
    expect(enemyBeat.struck).toBe('player');
    expect(playerBeat.struck).toBe('enemy');
    // Each bar is written at the beat of the blow that moved it — found, not assumed.
    const at = barUpdateAt(beats);
    expect(at.player).toBe(enemyBeat.index);
    expect(at.enemy).toBe(playerBeat.index);
    expect(at.charges, 'nothing touched the charges, so they are written at the last beat').toBe(1);
  });
});

// =========================================================================================
// ⭐ THE ORDER-AGNOSTIC GUARD (Appendix A.1). One round, written in BOTH orders by hand. If
// the engine's round order is ever corrected, the beat model must replay the new order
// exactly as faithfully as the old one — and this is the test that says so.
// =========================================================================================

describe('either round order replays faithfully (A.1)', () => {
  const attack = ONE_OF_EVERY_EVENT.attack;
  const enemyTick: GameEvent = { kind: 'condition-damage', subject: 'enemy', conditionType: 'burn', amount: 2 };
  const enemyStrike: GameEvent = { ...attack, subject: 'enemy', outcome: 'hit', damage: 3 };
  const playerTick: GameEvent = { kind: 'condition-damage', subject: 'player', conditionType: 'poison', amount: 1 };
  const playerStrike: GameEvent = { ...attack, subject: 'player', outcome: 'crit', damage: 9 };

  /** What a faithful replay of `order` is, derived by hand from the templates. */
  const LINE: ReadonlyMap<GameEvent, string> = new Map<GameEvent, string>([
    [enemyTick, 'The enemy takes 2 damage from Burn.'],
    [enemyStrike, 'The enemy strikes — hit for 3 damage.'],
    [playerTick, 'You take 1 damage from Poison.'],
    [playerStrike, 'You strike — CRITICAL hit for 9 damage!'],
  ]);

  function assertFaithful(order: GameEvent[]): Beat[] {
    const beats = groupBeats(order);
    expect(beats.map((b) => b.anchor), 'the beats are not the input, in the input order').toEqual(order);
    expect(beats.map((b) => b.line)).toEqual(order.map((e) => LINE.get(e)));
    // Each bar is written at the LAST beat that touched it, wherever that falls in THIS order.
    const lastTouching = (side: 'player' | 'enemy'): number =>
      Math.max(...order.map((e, i) => ((e.kind === 'attack' && e.subject !== side) || (e.kind === 'condition-damage' && e.subject === side) ? i : -1)));
    const at = barUpdateAt(beats);
    expect(at.player).toBe(lastTouching('player'));
    expect(at.enemy).toBe(lastTouching('enemy'));
    return beats;
  }

  it('enemy first — the order the engine emits as of 2026-09-12: enemy tick, enemy strike, player tick, player strike', () => {
    const beats = assertFaithful([enemyTick, enemyStrike, playerTick, playerStrike]);
    // Hand-derived for this order: the player's bar is written at the player's own tick (2),
    // the enemy's at the player's strike (3).
    expect(barUpdateAt(beats)).toEqual({ player: 2, enemy: 3, charges: 3 });
  });

  it('player first — the design’s order (§14.8, FINDINGS G62): player tick, player strike, enemy tick, enemy strike', () => {
    const beats = assertFaithful([playerTick, playerStrike, enemyTick, enemyStrike]);
    // Hand-derived for this order: the enemy's bar at the enemy's own tick (2), the player's at
    // the enemy's strike (3). The mirror image of the case above — not the same numbers.
    expect(barUpdateAt(beats)).toEqual({ player: 3, enemy: 2, charges: 3 });
  });

  it('and the schedule is the same length either way — timing does not depend on who went first', () => {
    const a = groupBeats([enemyTick, enemyStrike, playerTick, playerStrike]);
    const b = groupBeats([playerTick, playerStrike, enemyTick, enemyStrike]);
    expect(beatSchedule(a.length)).toEqual(beatSchedule(b.length));
  });

  // ---------------------------------------------------------------------------------------
  // ⭐ ANY NUMBER OF ACTIONS PER SIDE. The author's answer on round order (2026-09-12): "you
  // strike first, but it really depends on initiative like DnD, and the Dexterity stat" — which
  // is GAME-DESIGN §16.1's tempo gauge: a full gauge is an EXTRA ACTION, an empty one a LOST
  // TURN. Neither is built. When it is, a round can carry two actions from one side and none
  // from the other, in either order, so the replay must hold no count per side at all.
  // ---------------------------------------------------------------------------------------

  const secondPlayerStrike: GameEvent = { ...attack, subject: 'player', outcome: 'hit', damage: 5 };
  const secondEnemyStrike: GameEvent = { ...attack, subject: 'enemy', outcome: 'hit', damage: 2 };
  const LINE2 = new Map<GameEvent, string>([
    [secondPlayerStrike, 'You strike — hit for 5 damage.'],
    [secondEnemyStrike, 'The enemy strikes — hit for 2 damage.'],
  ]);
  const lineOf = (e: GameEvent): string | undefined => LINE.get(e) ?? LINE2.get(e);

  /** Faithful for any mix: every action is its own beat, in order, with its own line. */
  function assertEveryActionReplayed(order: GameEvent[]): Beat[] {
    const beats = groupBeats(order);
    expect(beats.map((b) => b.anchor), 'an action was dropped, merged or moved').toEqual(order);
    expect(beats.map((b) => b.line)).toEqual(order.map(lineOf));
    return beats;
  }

  it('an EXTRA ACTION: the player acts twice in the round — first, or last, or around the enemy', () => {
    // Hand-derived bar beats for each order: the ENEMY's bar is written at the player's LAST
    // strike, the player's at the enemy's only strike.
    let beats = assertEveryActionReplayed([playerStrike, secondPlayerStrike, enemyStrike]);
    expect(barUpdateAt(beats)).toMatchObject({ enemy: 1, player: 2 });
    beats = assertEveryActionReplayed([playerStrike, enemyStrike, secondPlayerStrike]);
    expect(barUpdateAt(beats)).toMatchObject({ enemy: 2, player: 1 });
    beats = assertEveryActionReplayed([enemyStrike, playerStrike, secondPlayerStrike]);
    expect(barUpdateAt(beats)).toMatchObject({ enemy: 2, player: 0 });
  });

  it('the ENEMY’s extra action, likewise', () => {
    const beats = assertEveryActionReplayed([enemyStrike, playerStrike, secondEnemyStrike]);
    expect(barUpdateAt(beats)).toMatchObject({ player: 2, enemy: 1 });
  });

  it('a LOST TURN: one side does not act at all — the replay needs no action from it', () => {
    // The player lost the turn: only the enemy acts, twice even. Nothing touches the enemy's
    // bar, so it is written (with the engine's unchanged value) at the last beat.
    let beats = assertEveryActionReplayed([enemyStrike, secondEnemyStrike]);
    expect(barUpdateAt(beats)).toEqual({ player: 1, enemy: 1, charges: 1 });
    expect(beats.every((b) => b.anchor?.kind === 'attack' && b.anchor.subject === 'enemy')).toBe(true);
    // The enemy lost the turn: the player alone.
    beats = assertEveryActionReplayed([playerStrike]);
    expect(barUpdateAt(beats)).toEqual({ player: 0, enemy: 0, charges: 0 });
    // A lost turn the engine SAYS (today's control-condition line) is a beat of its own.
    const unable: GameEvent = { kind: 'player-unable-to-act', conditionType: 'stun' };
    beats = groupBeats([unable, enemyStrike]);
    expect(beats.map((b) => b.line)).toEqual(['You cannot act — Stun.', 'The enemy strikes — hit for 3 damage.']);
  });
});

describe('floats and touches, by hand', () => {
  const attack = ONE_OF_EVERY_EVENT.attack;

  it('floats the engine’s own number over the side it concerns', () => {
    expect(floatFor({ ...attack, subject: 'player', outcome: 'miss', damage: 0 })).toEqual({ side: 'enemy', text: 'MISS', tone: 'plain' });
    expect(floatFor({ ...attack, subject: 'enemy', outcome: 'fumble', damage: 0 })).toEqual({ side: 'player', text: 'FUMBLE', tone: 'plain' });
    expect(floatFor({ ...attack, subject: 'enemy', outcome: 'crit', damage: 12 })).toEqual({ side: 'player', text: 'CRIT −12', tone: 'harm' });
    expect(floatFor({ kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 2 })).toEqual({ side: 'player', text: '+2', tone: 'heal' });
    expect(floatFor({ kind: 'lifesteal', amount: 3 })).toEqual({ side: 'player', text: '+3', tone: 'heal' });
    expect(floatFor({ kind: 'boss-minion-damage', amount: 4 })).toEqual({ side: 'player', text: '−4', tone: 'harm' });
    expect(floatFor({ kind: 'escape-failed', damage: 5 })).toEqual({ side: 'player', text: '−5', tone: 'harm' });
    expect(floatFor({ kind: 'revive', healedTo: 7 })).toEqual({ side: 'player', text: 'REVIVED', tone: 'heal' });
    const cast = ONE_OF_EVERY_EVENT['skill-cast'];
    expect(floatFor({ ...cast, damage: 10 })).toEqual({ side: 'enemy', text: '−10', tone: 'harm' });
    expect(floatFor({ ...cast, damage: 0, damageSources: [] }), 'a pure-condition cast floats nothing').toBeNull();
    expect(floatFor({ kind: 'victory', xpGained: 5, loot: [] })).toBeNull();
  });

  it('a blow that CONNECTED FOR NOTHING floats no number — never “−0” — but still reads as a hit', () => {
    // The engine's truth, seen 6 times in 423 real hits: a 1 on the d6 with a −1 Strength
    // adjustment, clamped to 0. The blow landed and did nothing. A "−0" in the damage colour
    // reads as harm that did not happen, so no number floats — the rule the skill path already
    // had. The strike itself still SHOWS (flash, shake or tint) and still sounds: the outcome
    // is a hit, the blow connected, and the ticker says exactly that in the engine's words.
    const zeroHit: GameEvent = { ...attack, subject: 'player', outcome: 'hit', damage: 0 };
    expect(floatFor(zeroHit)).toBeNull();
    expect(floatFor({ ...attack, subject: 'enemy', outcome: 'crit', damage: 0 })).toBeNull();
    const [beat] = groupBeats([zeroHit]);
    expect(beat!.float).toBeNull();
    expect(beat!.struck, 'a blow that connected no longer shows it connected').toBe('enemy');
    expect(beat!.line).toBe('You strike — hit for 0 damage.');
    expect(beat!.hook).toBe('hit');
    expect(beat!.touches, 'the bar is still written — with the engine’s unchanged value').toEqual(['enemy']);
    // One rule for every number the stage floats: a zero is never shown. (A failed escape a
    // shield absorbed entirely reports the 0 HP actually lost — the same "−0".)
    expect(floatFor({ kind: 'escape-failed', damage: 0 })).toBeNull();
    expect(floatFor({ kind: 'condition-damage', subject: 'enemy', conditionType: 'burn', amount: 0 })).toBeNull();
    expect(floatFor({ kind: 'condition-heal', subject: 'player', conditionType: 'regeneration', amount: 0 })).toBeNull();
    expect(floatFor({ kind: 'lifesteal', amount: 0 })).toBeNull();
    expect(floatFor({ kind: 'boss-minion-damage', amount: 0 })).toBeNull();
    // ...and the smallest real number still floats, so the rule is "zero", not "small".
    expect(floatFor({ ...attack, subject: 'player', outcome: 'hit', damage: 1 })).toEqual({ side: 'enemy', text: '−1', tone: 'harm' });
    expect(floatFor({ kind: 'escape-failed', damage: 1 })).toEqual({ side: 'player', text: '−1', tone: 'harm' });
  });

  it('touches only the bars an event can move', () => {
    expect(touchesOf({ ...attack, subject: 'player' })).toEqual(['enemy']);
    expect(touchesOf({ ...attack, subject: 'enemy' })).toEqual(['player']);
    expect(touchesOf(ONE_OF_EVERY_EVENT['skill-cast'])).toEqual(['enemy', 'charges']);
    expect(touchesOf(ONE_OF_EVERY_EVENT['floor-drain'])).toEqual(['charges']);
    expect(touchesOf(ONE_OF_EVERY_EVENT['illusion-struck'])).toEqual(['enemy']);
    expect(touchesOf(ONE_OF_EVERY_EVENT['condition-skip']), 'a lost turn moves no bar').toEqual([]);
    expect(touchesOf(ONE_OF_EVERY_EVENT.advantage)).toEqual([]);
  });

  it('the floor-3 drain is its own beat, and the charges bar is written at it (AC-28)', () => {
    const drain = ONE_OF_EVERY_EVENT['floor-drain'];
    const beats = groupBeats([drain]);
    expect(beats).toHaveLength(1);
    // format.ts: `This place drains ${amount} skill charge${amount === 1 ? '' : 's'} from you.`
    expect(beats[0]!.line).toBe(`This place drains ${drain.amount} skill charge${drain.amount === 1 ? '' : 's'} from you.`);
    expect(beats[0]!.hook).toBe('tick');
    expect(barUpdateAt(beats).charges).toBe(0);
  });
});

describe('the schedule, by hand (the four constants are the author’s knob)', () => {
  it('the constants are the plan’s', () => {
    expect([BEAT_MS, BEAT_HOLD_MS, MAX_ROUND_MS, MIN_SPACING_MS]).toEqual([240, 240, 1600, 120]);
  });

  it('few beats are spaced BEAT_MS and held BEAT_HOLD_MS', () => {
    expect(beatSchedule(0)).toEqual({ at: [], spacing: 0, done: 0 });
    expect(beatSchedule(1)).toEqual({ at: [0], spacing: 240, done: 240 });
    expect(beatSchedule(2)).toEqual({ at: [0, 240], spacing: 240, done: 480 });
    expect(beatSchedule(4)).toEqual({ at: [0, 240, 480, 720], spacing: 240, done: 960 });
  });

  it('many beats shrink to fit the cap: (1600 − 240) / (n − 1), floored', () => {
    // 7 beats: 1360 / 6 = 226.67 → 226; last at 6 × 226 = 1356; done 1596.
    expect(beatSchedule(7)).toMatchObject({ spacing: 226, done: 1596 });
    // 10 beats: 1360 / 9 = 151.1 → 151; last at 1359; done 1599 — inside the cap.
    const ten = beatSchedule(10);
    expect(ten.spacing).toBe(151);
    expect(ten.at[9]).toBe(1359);
    expect(ten.done).toBe(1599);
  });

  it('and never below the readable floor, even if the round then runs long', () => {
    // 13 beats: 1360 / 12 = 113.3 → clamped to 120; last at 1440; done 1680.
    expect(beatSchedule(13)).toMatchObject({ spacing: 120, done: 1680 });
  });
});
