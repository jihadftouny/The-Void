// THE BATTLE SCREEN'S PURE HALF (PLAN.md #6): what the framed stage shows, as plain data —
// AC-12 (the views), AC-25 (the tempo slot), AC-26/AC-27/AC-29 (their pure halves), and the
// round plan the sequencer is handed. Expected values are derived by hand from the data tables
// and the plan, never read off the module; where two paths of the same code are compared (the
// Cast rows against the character sheet) the pair is ALSO pinned to a data-derived number.
//
// The preset-driven halves (the real act2-illusion / act5-warped / judged-act4 states, and
// the rendered DOM) live in `src/dev/battleScreen.test.ts` — the import-direction scan allows
// the dev presets to be imported from `src/dev/` alone.

import { describe, it, expect } from 'vitest';
import {
  BATTLE_LABELS,
  RUN_BLOCKED_REASON,
  battleMenuRows,
  battleRowButton,
  roundBars,
  roundPlan,
  stageView,
  tempoGauge,
  vitalsView,
  type BattleMenuRow,
} from './battle-model.ts';
import { characterSheet } from './view-model.ts';
import type { GameState } from '../game/game.ts';
import { createBattle, resolveRound, type BattleState } from '../game/battle.ts';
import { createPlayer, type Player } from '../game/player.ts';
import { generateEnemy, type Enemy } from '../game/enemy.ts';
import { generateBoss } from '../game/boss.ts';
import { createKarma } from '../game/karma.ts';
import { makeCondition } from '../game/condition.ts';
import { SKILLS } from '../game/skill.ts';
import { mulberry32, type Rng } from '../game/rng.ts';
import { SAVE_VERSION } from '../game/save.ts';
import corruptions from '../data/corruptions.json';

// ------- fixtures -------------------------------------------------------------------------

const face = (f: number, sides: number): number => (f - 0.5) / sides;
function scripted(values: number[]): Rng {
  let i = 0;
  return (() => {
    if (i >= values.length) throw new Error(`scripted rng exhausted after ${i} draws`);
    return values[i++]!;
  }) as Rng;
}

function hero(overrides: Partial<Player> = {}): Player {
  return {
    ...createPlayer({ name: 'Hero', classId: 'Enforcer', stats: { STR: 10, DEX: 10, CON: 12, INT: 10, WIS: 10, CHA: 10 } }),
    hp: 12,
    maxHp: 12,
    ...overrides,
  };
}

/** STR 10, AC 10, 10 HP, no skills — every roll against it is arithmetic (`illusion.test.ts`). */
function foe(overrides: Partial<Enemy> = {}): Enemy {
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
    karmaWeighted: false,
    ...overrides,
  };
}

function inBattle(battle: BattleState, started = true, act = 2): GameState {
  return {
    version: SAVE_VERSION,
    rngState: 1,
    player: battle.player,
    act,
    place: act - 1,
    karma: createKarma(),
    phase: { kind: 'battle', battle, started, final: false },
  };
}

/** A usable in the pack — `antidote` carries a `use` in consumables.json. */
const USABLE = { defId: 'antidote' };

// =========================================================================================

describe('the enemy on the stage (AC-12)', () => {
  it('its name verbatim, an HP bar in the foe tone, and its chips', () => {
    const e = foe({ fullName: 'Rust <b>Chorister</b>', hp: 7, activeConditions: [makeCondition('burn'), makeCondition('stun')] });
    const view = stageView(inBattle(createBattle(hero(), e, 2)))!;
    expect(view.name, 'the name is not carried byte for byte').toBe('Rust <b>Chorister</b>');
    expect(view.hp).toMatchObject({ label: 'HP', value: 7, max: 10, text: '7/10', tone: 'foe' });
    // conditionChips orders control before harm: Stun, then Burn.
    expect(view.chips.map((c) => c.name)).toEqual(['Stun', 'Burn']);
    expect(view.isBoss).toBe(false);
  });

  it('no battle, no stage', () => {
    const s = inBattle(createBattle(hero(), foe(), 2));
    expect(stageView({ ...s, phase: { kind: 'main-menu' } })).toBeNull();
  });
});

describe('the player’s stat box (AC-12): fighting numbers only', () => {
  it('name, class and level, HP, charges, the class resource and the chips — nothing else', () => {
    const p = hero({ skillCharges: 3, activeConditions: [makeCondition('poison')] });
    // The resource is set on the LIVE combatant: opening a battle decays banked momentum
    // (`resetTransientCombatState`), so the number to show is the one the battle holds.
    const opened = createBattle(p, foe(), 2);
    const view = vitalsView(inBattle({ ...opened, player: { ...opened.player, momentum: 2 } }))!;
    expect(view.name).toBe('Hero');
    expect(view.classLine).toBe(`Enforcer · level ${p.level}`);
    expect(view.hp).toMatchObject({ value: 12, max: 12, tone: 'hp' });
    expect(view.charges).toMatchObject({ label: 'Charges', value: 3, max: p.maxSkillCharges, tone: 'accent' });
    expect(view.resource).toEqual({ kind: 'momentum', value: 2 });
    expect(view.chips.map((c) => c.name)).toEqual(['Poison']);
    // No XP, no Act, no karma, no tempo — by the view's own keys, not by a search for words.
    expect(Object.keys(view).sort()).toEqual(['charges', 'chips', 'classLine', 'hp', 'name', 'resource']);
  });

  it('a class that banks no resource shows none', () => {
    const p = { ...hero(), classId: 'Scavver' as const };
    expect(vitalsView(inBattle(createBattle(p, foe(), 2)))!.resource).toBeUndefined();
  });

  it('reads the LIVE combatant mid-fight, not the stale run snapshot', () => {
    const b = createBattle(hero(), foe(), 2);
    const s = inBattle({ ...b, player: { ...b.player, hp: 5 } });
    expect(vitalsView(s)!.hp.value).toBe(5);
  });
});

describe('the reserved tempo slot (AC-25; GAME-DESIGN §16.1)', () => {
  it('is absent from both views today — there is no engine field, so nothing renders', () => {
    const s = inBattle(createBattle(hero(), foe(), 2));
    expect('tempo' in stageView(s)!).toBe(false);
    expect('tempo' in vitalsView(s)!).toBe(false);
  });

  it('is a TWO-SIDED gauge: it fills toward the extra action and empties toward the lost turn', () => {
    // §16.1: +1.0 is an extra action, −1.0 a lost turn. Each half is the distance toward its
    // threshold, by hand; the text is the engine's number, signed, to one decimal.
    expect(tempoGauge(0.4)).toEqual({ value: 0.4, text: '+0.4', quick: 0.4, slow: 0, label: 'Tempo' });
    expect(tempoGauge(-0.3)).toEqual({ value: -0.3, text: '−0.3', quick: 0, slow: 0.3, label: 'Tempo' });
    expect(tempoGauge(0)).toMatchObject({ text: '0.0', quick: 0, slow: 0 });
    // At a threshold the side is full; past it (the engine carries the remainder) it stays full.
    expect(tempoGauge(1)).toMatchObject({ text: '+1.0', quick: 1, slow: 0 });
    expect(tempoGauge(-1.2)).toMatchObject({ text: '−1.2', quick: 0, slow: 1 });
    // A value that rounds to nothing reads as nothing, never "−0.0".
    expect(tempoGauge(-0.04).text).toBe('0.0');
  });
});

describe('the menu’s rows (AC-29 and the commands)', () => {
  const kinds = (rows: BattleMenuRow[]): string[] => rows.map((r) => r.kind);

  it('the commands: Fight, Cast, Spare, Use item, Run — each included by its own gate', () => {
    const p = hero({ inventory: { ...hero().inventory, backpack: [USABLE] } });
    const s = inBattle(createBattle(p, foe({ karmaWeighted: true }), 2));
    expect(kinds(battleMenuRows(s, 'commands'))).toEqual(['fight', 'cast', 'spare', 'item', 'run']);
    expect(battleMenuRows(s, 'commands').at(-1)).toEqual({ kind: 'run', enabled: true });
  });

  it('drops Spare for a plain foe, Use item for an empty pack, Cast for no skills', () => {
    const p = hero({ skillPool: [], inventory: { ...hero().inventory, backpack: [] } });
    const s = inBattle(createBattle(p, foe(), 2));
    expect(kinds(battleMenuRows(s, 'commands'))).toEqual(['fight', 'run']);
  });

  it('a BOSS: no Spare, and Run is DISABLED with §14.9’s reason — never merely absent (G4)', () => {
    const p = hero();
    const made = generateBoss({ bossId: 'kingpin', act: 1, player: p, karma: createKarma(), rng: mulberry32(9) });
    const s = inBattle(createBattle(p, made.enemy, 1, { boss: made.boss }), true, 1);
    const rows = battleMenuRows(s, 'commands');
    expect(kinds(rows)).not.toContain('spare');
    expect(rows.at(-1)).toEqual({ kind: 'run', enabled: false, reason: 'There is nowhere to go' });
    expect(RUN_BLOCKED_REASON).toBe('There is nowhere to go');
    // The button: greyed, inert, and SAYING why.
    const run = battleRowButton(rows.at(-1)!);
    expect(run).toEqual({ label: 'Run', disabled: true, hint: '(There is nowhere to go)' });
    expect(stageView(s)!.isBoss).toBe(true);
  });

  it('the final act forbids fleeing too, and says so the same way', () => {
    const s = inBattle(createBattle(hero(), foe(), 5), true, 5);
    expect(battleMenuRows(s, 'commands').at(-1)).toEqual({ kind: 'run', enabled: false, reason: RUN_BLOCKED_REASON });
  });

  it('a sub-menu is Back, then one row per option', () => {
    const p = hero({ inventory: { ...hero().inventory, backpack: [USABLE, { defId: 'firebomb' }] } });
    const s = inBattle(createBattle(p, foe(), 2));
    const cast = battleMenuRows(s, 'cast');
    expect(kinds(cast)).toEqual(['back', 'cast-skill', 'cast-skill']); // the Enforcer's two core skills
    const items = battleMenuRows(s, 'item');
    expect(kinds(items)).toEqual(['back', 'use-item', 'use-item']);
    expect(items.map((r) => (r.kind === 'use-item' ? r.option.index : -1))).toEqual([-1, 0, 1]);
  });

  it('an unopened fight has no menu', () => {
    expect(battleMenuRows(inBattle(createBattle(hero(), foe(), 2), false), 'commands')).toEqual([]);
  });

  it('every fixed word comes from the one table', () => {
    for (const kind of ['fight', 'cast', 'spare', 'item', 'back'] as const) {
      expect(battleRowButton({ kind } as BattleMenuRow).label).toBe(BATTLE_LABELS[kind]);
    }
    expect(BATTLE_LABELS).toEqual({ fight: 'Fight', cast: 'Cast', spare: 'Spare', item: 'Use item', run: 'Run', back: 'Back', record: 'Record' });
  });
});

describe('the warped kit’s cost on the stage matches the data (AC-27, pure half)', () => {
  it('each Cast row carries the template’s suffix and the cost the data adds up to', () => {
    const templates = corruptions.templates as { id: string; suffix: string; chargeDelta?: number }[];
    const warp = (id: string) => templates.find((t) => t.id === id)!;
    const p = hero({ skillCharges: 5, skillPool: ['heavyStrike', 'brace'], corruptedSkills: { heavyStrike: 'warped', brace: 'dulled' } });
    const s = inBattle(createBattle(p, foe(), 2));
    const rows = battleMenuRows(s, 'cast').filter((r): r is Extract<BattleMenuRow, { kind: 'cast-skill' }> => r.kind === 'cast-skill');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const id = row.option.skillId;
      const t = warp(p.corruptedSkills![id]!);
      // Computed HERE from the tables: base cost + the template's delta, clamped at 0. No
      // upgrades on this character and no relic in its pack, so nothing else moves it.
      const expected = Math.max(0, SKILLS[id].chargeCost + (t.chargeDelta ?? 0));
      const button = battleRowButton(row);
      expect(button.label.endsWith(t.suffix), `${id} lost its ${t.suffix}`).toBe(true);
      expect(button.hint).toBe(`(${expected}⚡)`);
      // ...and it is the number the character sheet shows for the same skill.
      const sheetRow = characterSheet(s.phase.kind === 'battle' ? s.phase.battle.player : p).skills.find((k) => k.skillId === id)!;
      expect(`(${sheetRow.chargeCost}⚡)`).toBe(button.hint);
    }
    // Hand-checked against the data: heavyStrike 2 + 1 = 3 (warped); brace max(0, 1 - 1) = 0.
    expect(rows.map((r) => battleRowButton(r).hint)).toEqual(['(3⚡)', '(0⚡)']);
  });

  it('an unaffordable skill is greyed AND inert', () => {
    const p = hero({ skillCharges: 1, skillPool: ['heavyStrike'] }); // costs 2
    const rows = battleMenuRows(inBattle(createBattle(p, foe(), 2)), 'cast');
    expect(battleRowButton(rows[1]!)).toMatchObject({ disabled: true, hint: '(2⚡)' });
  });
});

describe('illusions are not revealed by the UI (AC-26, pure half)', () => {
  it('every view of an illusory fight is byte-identical to its un-flagged twin', () => {
    const p = hero({ inventory: { ...hero().inventory, backpack: [USABLE] } });
    const real = inBattle(createBattle(p, foe({ karmaWeighted: true, illusory: true }), 2));
    expect(real.phase.kind === 'battle' && real.phase.battle.enemy.illusory, 'the fixture is not an illusion').toBe(true);
    const twin: GameState = JSON.parse(JSON.stringify(real));
    if (twin.phase.kind === 'battle') delete twin.phase.battle.enemy.illusory;
    expect(JSON.stringify(stageView(real))).toBe(JSON.stringify(stageView(twin)));
    expect(JSON.stringify(vitalsView(real))).toBe(JSON.stringify(vitalsView(twin)));
    for (const mode of ['commands', 'cast', 'item'] as const) {
      expect(JSON.stringify(battleMenuRows(real, mode))).toBe(JSON.stringify(battleMenuRows(twin, mode)));
    }
  });

  it('a failed Wisdom roll: the only tell is the engine’s own line, and the bar does not move', () => {
    // Draws, per illusion.test.ts: [Wisdom d20 = 5 → 5 + 0 < 13, fails] [enemy to-hit 18 → a
    // hit for 1] [player to-hit 15 → 17 ≥ 10, a hit] [1d6 = 4 — which passes through].
    const b = createBattle(hero(), foe({ illusory: true }), 2);
    const before = inBattle(b);
    const r = resolveRound(b, 'fight', scripted([face(5, 20), face(18, 20), face(15, 20), face(4, 6)]));
    const after = inBattle(r.state);
    const plan = roundPlan(before, after, r.events)!;
    const illusionLines = plan.beats.map((beat) => beat.line).filter((l) => /illusion|passes through|nothing is there/i.test(l));
    expect(illusionLines).toEqual(['Your blow passes through it — nothing is there.']);
    expect(plan.bars.enemy.before.value).toBe(10);
    expect(plan.bars.enemy.after.value, 'the illusion’s bar moved — the UI would reveal it').toBe(10);
    expect(plan.bars.player.after.value, 'its attack was real: 12 − 1').toBe(11);
  });

  it('a dispelled round ends on the engine’s dispel line, with the dispel hook', () => {
    // [Wisdom d20 = 18 → 18 + 0 ≥ 13, seen through] — and nothing else happens this round.
    const b = createBattle(hero(), foe({ illusory: true }), 2);
    const r = resolveRound(b, 'fight', scripted([face(18, 20)]));
    expect(r.status).toBe('dispelled');
    const plan = roundPlan(inBattle(b), { ...inBattle(b), phase: { kind: 'main-menu' } }, r.events)!;
    const last = plan.beats.at(-1)!;
    // format.ts: `You see through the illusion — Wisdom ${total} vs ${dc}. It was never there.`
    expect(last.line).toBe('You see through the illusion — Wisdom 18 vs 13. It was never there.');
    expect(last.hook).toBe('dispel');
    expect(plan.bars.enemy.after.value, 'seeing through is not a kill: the bar keeps its value').toBe(10);
  });
});

describe('the round plan: the bars are only ever engine values', () => {
  it('an ongoing round: before and after are the two states’ numbers (10 − 4, 12 − 1)', () => {
    const b = createBattle(hero(), foe(), 2);
    const r = resolveRound(b, 'fight', scripted([face(18, 20), face(15, 20), face(4, 6)]));
    const plan = roundPlan(inBattle(b), inBattle(r.state), r.events)!;
    expect(plan.bars.enemy.before.value).toBe(10);
    expect(plan.bars.enemy.after.value).toBe(6);
    expect(plan.bars.player.after.value).toBe(11);
    expect(plan.schedule.at).toEqual([0, 240]);
    expect(plan.updateAt.enemy, 'the enemy bar is written at the beat of the blow that moved it').toBe(
      plan.beats.findIndex((beat) => beat.anchor?.kind === 'attack' && beat.anchor.subject === 'player'),
    );
  });

  it('a victory drains the foe to the zero the engine clamps it to; the run’s player carries the rest', () => {
    const b = createBattle(hero(), foe({ hp: 3 }), 2);
    const events = [{ kind: 'victory' as const, xpGained: 5, loot: [] }];
    const after: GameState = { ...inBattle(b), phase: { kind: 'battle-victory', final: false }, player: { ...b.player, hp: 9 } };
    const bars = roundBars(inBattle(b), after, events)!;
    expect(bars.enemy.after).toMatchObject({ value: 0, max: 10, tone: 'foe' });
    expect(bars.player.after.value).toBe(9);
  });

  it('any other ending leaves the foe at its last engine value, never a derived one', () => {
    const b = createBattle(hero(), foe({ hp: 7 }), 2);
    const after: GameState = { ...inBattle(b), phase: { kind: 'main-menu' } };
    expect(roundBars(inBattle(b), after, [{ kind: 'fled' }])!.enemy.after.value).toBe(7);
  });

  it('nothing to replay → no plan: a step outside a battle, or a battle step with no beats', () => {
    const b = createBattle(hero(), foe(), 2);
    const hub: GameState = { ...inBattle(b), phase: { kind: 'main-menu' } };
    expect(roundPlan(hub, inBattle(b), [{ kind: 'encounter-start', enemyName: 'x' }])).toBeNull();
    expect(roundPlan(inBattle(b, false), inBattle(b), [])).toBeNull();
  });

  it('floor 3’s opening drain replays from an UNSTARTED battle, and moves the charges bar (AC-28)', () => {
    const b = createBattle(hero({ skillCharges: 5 }), foe(), 3);
    const before = inBattle(b, false, 3);
    const drained = { ...b, player: { ...b.player, skillCharges: 4 } };
    const plan = roundPlan(before, inBattle(drained, true, 3), [{ kind: 'floor-drain', resource: 'skillCharge', amount: 1 }])!;
    expect(plan.beats).toHaveLength(1);
    expect(plan.bars.charges.before.value).toBe(5);
    expect(plan.bars.charges.after.value).toBe(4);
    expect(plan.updateAt.charges).toBe(0);
  });

  it('only the opening waits a lead-in before its first beat: its frame was not on screen before', () => {
    // The opening: one beat's spacing (240ms, `BEAT_MS`), so the frame is seen at its
    // before-values before the drain is written — otherwise the two land in one paint.
    const b = createBattle(hero({ skillCharges: 5 }), foe(), 3);
    const drain = [{ kind: 'floor-drain' as const, resource: 'skillCharge' as const, amount: 1 }];
    expect(roundPlan(inBattle(b, false, 3), inBattle(b, true, 3), drain)!.lead).toBe(240);
    // A round played from the fight screen: that frame is already up, showing the before-values.
    const r = resolveRound(b, 'fight', scripted([face(18, 20), face(15, 20), face(4, 6)]));
    expect(roundPlan(inBattle(b), inBattle(r.state), r.events)!.lead).toBe(0);
  });
});
