// @vitest-environment jsdom
//
// THE FRAMED STAGE ON THE STATES THAT TEST IT HARDEST (PLAN.md #6) — built from the developer
// presets, so it lives here: the import-direction scan lets only `src/dev/` import them.
//
//   AC-29  a boss: no Spare, and Run a DISABLED row that says why — walked in the real renderer
//   AC-28  floor 3's opening drain: its own beat, the charges bar written at it
//   AC-26  floor 2's illusion: nothing on the stage reveals it; across a round, the only tell is
//          the engine's own line, and the bar never moves
//   AC-27  floor 5's warped kit: every Cast row's suffix and cost match the data
//   AC-30  hidden karma: no axis word anywhere on the stage, in any of five fights
//
// EVERY EXPECTATION IS THE ENGINE'S OR THE DATA'S, never the renderer's: a round's outcome is
// read by stepping the SAME saved state through the real engine here; a cost is summed from
// `SKILLS`, the character's upgrades and `corruptions.json`; the boss names are read from
// `SIN_BY_AXIS`, never spelled. Seeds that produce a particular round are FOUND by searching
// (as `REST_NEXT_SEED` is), and the search's result is asserted, not assumed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildJump, getPreset, type JumpSpec } from './devState.ts';
import { step, awaitingFor, type GameState } from '../game/game.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { SKILLS, type SkillId } from '../game/skill.ts';
import { SIN_BY_AXIS } from '../game/boss.ts';
import { computeEquipModifiers } from '../game/equipEffects.ts';
import { AXIS_VOCABULARY } from '../game/karmaVocabulary.testutil.ts';
import corruptions from '../data/corruptions.json';
import { formatEvent } from '../render/format.ts';
import { groupBeats } from '../render/beat-model.ts';
import { characterSheet } from '../desktop/view-model.ts';
import { battleMenuRows, stageView, vitalsView, type BattleMenuMode } from '../desktop/battle-model.ts';
import { buildArena, buildBattleMenu, buildVitals } from '../desktop/battle.ts';
import { saveRun } from '../desktop/persist.ts';
import type { LogEntry } from '../log/logger.ts';
import {
  choiceButtons,
  click,
  freshRenderer,
  installBridge,
  installFonts,
  installPage,
  labels,
  reach,
  removeBridge,
  screen,
} from '../desktop/rendererHarness.testutil.ts';

// ------- getting a preset into a live fight, through the real engine -----------------------

/** The bundle a preset (or a spec) builds. Throws on an unknown preset rather than guessing. */
function bundleOf(spec: JumpSpec | string): ReturnType<typeof buildJump> {
  if (typeof spec !== 'string') return buildJump(spec);
  const preset = getPreset(spec);
  if (!preset) throw new Error(`no preset '${spec}'`);
  return buildJump(preset.spec);
}

/**
 * Walk a state to an OPEN fight with the engine's own inputs: a fight waiting to be joined is
 * joined; from the hub the descent is pressed until one appears (a cache, a rest or a found
 * bargain on the way is passed exactly as a player would pass it).
 */
function toLiveFight(start: GameState): GameState {
  let s = start;
  for (let i = 0; i < 40; i += 1) {
    const awaiting = awaitingFor(s.phase);
    if (awaiting === 'battle-action') return s;
    if (awaiting === 'main-menu') s = step(s, { kind: 'menu', choice: 'continue' }).state;
    else if (awaiting === 'continue' || awaiting === 'rest') s = step(s, { kind: 'continue' }).state;
    else if (awaiting === 'deal-decision') s = step(s, { kind: 'deal-decision', accept: false }).state;
    else if (awaiting === 'draft-pick') s = step(s, { kind: 'draft-pick', index: 0 }).state;
    else throw new Error(`the walk to a fight met '${awaiting}'`);
  }
  throw new Error('no fight in forty steps');
}

/** Everything a player can read on the stage for a state: arena, stat box, every menu. */
function stageText(state: GameState): string {
  const parts: string[] = [];
  const arena = buildArena(stageView(state)!, { line: '' });
  const vitals = buildVitals(vitalsView(state)!);
  parts.push(arena.textContent ?? '', vitals.textContent ?? '');
  for (const mode of ['commands', 'cast', 'item'] as BattleMenuMode[]) {
    parts.push(buildBattleMenu(battleMenuRows(state, mode), () => undefined).textContent ?? '');
  }
  return parts.join('\n');
}

/** The markup a player's screen reader and eyes get for a state: arena, stat box, commands. */
function stageMarkup(state: GameState): string {
  return [
    buildArena(stageView(state)!, { line: '' }).outerHTML,
    buildVitals(vitalsView(state)!).outerHTML,
    ...(['commands', 'cast', 'item'] as BattleMenuMode[]).map((m) => buildBattleMenu(battleMenuRows(state, m), () => undefined).outerHTML),
  ].join('\n');
}

beforeEach(() => {
  installPage();
  installFonts();
  localStorage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** Observers a case attached; each is disconnected when the case ends. */
const observers: MutationObserver[] = [];

/**
 * Call `record` after every change to the page, for the rest of the case — how a test sees what
 * the arena showed WHILE a round played, not only where it came to rest. Disconnected in
 * `afterEach`: an observer left running outlives the case and fires into the next one's page,
 * or into a torn-down environment.
 */
function watch(record: () => void): void {
  const observer = new MutationObserver(record);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  observers.push(observer);
}

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  vi.restoreAllMocks();
  removeBridge();
});

/** Resume a bundle in the REAL renderer, and return its log. */
async function resume(bundle: ReturnType<typeof buildJump>): Promise<LogEntry[]> {
  saveRun(bundle.state, bundle.memory, bundle.meta);
  installBridge();
  const { game, entries } = await freshRenderer();
  game.boot();
  click('Continue your descent');
  return entries;
}

const roundLine = (entries: LogEntry[]): { beats: number; hooks: string[] } | undefined =>
  entries.find((e) => e.category === 'battle' && e.message === 'round played')?.data as
    | { beats: number; hooks: string[] }
    | undefined;

// =========================================================================================

describe('a BOSS: no Spare, and Run is a disabled row that says why (AC-29, G4, §14.9)', () => {
  it('the Hollow, walked in the real renderer from its encounter into the fight', async () => {
    const bundle = bundleOf('hollow-fight');
    expect(bundle.state.phase.kind === 'battle' && bundle.state.phase.battle.boss, 'the preset is no boss fight').toBeTruthy();
    const entries = await resume(bundle);
    expect(screen(), 'the boss fight did not open on its encounter').toBe('continue');
    click('Continue');
    await reach('battle-action');

    expect(labels(), 'a boss can be spared').not.toContain('Spare');
    const run = choiceButtons().find((b) => (b.textContent ?? '').startsWith('Run'));
    expect(run, 'the Run row is GONE — §14.9 says explain, never merely hide').toBeDefined();
    expect(run!.textContent).toBe('Run (There is nowhere to go)');
    expect(run!.disabled, 'Run is live against a boss').toBe(true);
    // Inert as well as greyed: a click steps nothing. Dispatched as an EVENT, not `.click()` —
    // the browser refuses `.click()` on a disabled button by itself, so that would pass even
    // if the row were wired to run. A listener on the row would still hear this.
    const steps = (): number => entries.filter((e) => e.category === 'engine' && e.message === 'step').length;
    const before = steps();
    expect(before, 'joining the fight logged no step — the counter counts nothing').toBeGreaterThan(0);
    run!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(steps(), 'clicking the greyed Run reached the engine').toBe(before);
    expect(screen()).toBe('battle-action');
  });
});

describe('floor 3’s opening drain is a beat of its own (AC-28)', () => {
  it('joining the fight plays the drain on the stage, and the charges bar lands on the engine’s value', async () => {
    const bundle = bundleOf({ act: 3, xp: 30, target: { kind: 'encounter', familyId: 'mirrorSelves' } });
    // The engine's own opening, on the same state: it drains, and says so.
    const opened = step(bundle.state, { kind: 'continue' });
    const drain = opened.events.find((e): e is Extract<GameEvent, { kind: 'floor-drain' }> => e.kind === 'floor-drain');
    expect(drain, 'floor 3 took nothing on this opening — the fixture proves nothing').toBeDefined();
    if (opened.state.phase.kind !== 'battle' || bundle.state.phase.kind !== 'battle') throw new Error('not a fight');
    const full = bundle.state.phase.battle.player;
    const drained = opened.state.phase.battle.player;
    expect(full.skillCharges - drained.skillCharges, 'the drain event and the state disagree').toBe(drain!.amount);

    const entries = await resume(bundle);
    expect(screen()).toBe('continue');
    // What the frame showed, moment by moment: the ticker's line and the charges bar, together.
    const frames: string[] = [];
    watch(() => {
      const bar = document.querySelector('#vitals .frame-bar[data-bar="charges"] .void-bar-text')?.textContent;
      if (!bar) return;
      const line = document.querySelector('#arena .ticker-line')?.textContent ?? '';
      const frame = `${line} | ${bar}`;
      if (frame !== frames.at(-1)) frames.push(frame);
    });
    click('Continue');
    await vi.waitFor(() => expect(roundLine(entries), 'the opening was not replayed').toBeDefined(), { timeout: 4000, interval: 10 });
    await reach('battle-action');

    // The plan's shape: the opening is ONE beat, and its sound is the tick.
    expect(roundLine(entries)).toMatchObject({ beats: 1, hooks: ['tick'] });
    const fullBar = `${full.skillCharges}/${full.maxSkillCharges}`;
    const drainedBar = `${drained.skillCharges}/${drained.maxSkillCharges}`;
    // The frame was first SEEN full, before any line…
    expect(frames[0], 'the frame never stood at its before-values').toBe(` | ${fullBar}`);
    // …and the moment the drain's own line appeared, the bar already held the engine's value:
    // written AT the beat, not later by the screen that follows it.
    const atDrain = frames.find((f) => f.startsWith(`${formatEvent(drain!)} | `));
    expect(atDrain, `the drain never had a line of its own: ${frames.join(' / ')}`).toBe(`${formatEvent(drain!)} | ${drainedBar}`);
  });
});

describe('floor 2’s illusions are not revealed by the stage (AC-26)', () => {
  /** A seed for the illusion preset whose FIRST Fight round has the outcome asked for. */
  function illusionSeed(want: 'passes-through' | 'dispelled'): ReturnType<typeof buildJump> {
    const base = getPreset('act2-illusion')!.spec;
    for (let seed = 1; seed < 300; seed += 1) {
      const bundle = buildJump({ ...base, seed });
      const fight = toLiveFight(bundle.state);
      const r = step(fight, { kind: 'battle-action', action: 'fight' });
      const kinds = r.events.map((e) => e.kind);
      const ok = want === 'dispelled' ? kinds.includes('illusion-dispelled') : kinds.includes('illusion-struck') && r.state.phase.kind === 'battle';
      if (ok) return { ...bundle, state: fight };
    }
    throw new Error(`no seed under 300 gives a first round that ${want}`);
  }

  it('every word and every attribute on the stage equals its un-flagged twin', () => {
    const fight = toLiveFight(bundleOf('act2-illusion').state);
    expect(fight.phase.kind === 'battle' && fight.phase.battle.enemy.illusory, 'the preset fight is no illusion').toBe(true);
    const twin: GameState = JSON.parse(JSON.stringify(fight));
    if (twin.phase.kind === 'battle') delete twin.phase.battle.enemy.illusory;
    expect(stageMarkup(fight), 'the stage marks the illusion').toBe(stageMarkup(twin));
  });

  /**
   * Watch the arena for the rest of the case: every distinct ticker line in the order shown,
   * every float, and every value the enemy's bar held.
   */
  function watchArena(): { lines: string[]; floats: Set<string>; enemyBar: Set<string> } {
    const seen = { lines: [] as string[], floats: new Set<string>(), enemyBar: new Set<string>() };
    watch(() => {
      const line = document.querySelector('#arena .ticker-line')?.textContent;
      if (line && line !== seen.lines.at(-1)) seen.lines.push(line);
      // Floats rise over the enemy's figure (in the arena) and over the stat box (the player).
      for (const f of document.querySelectorAll('#arena .arena-float, #vitals .arena-float')) seen.floats.add(f.textContent ?? '');
      const bar = document.querySelector('#arena .frame-bar[data-bar="enemy"] .void-bar-text')?.textContent;
      if (bar) seen.enemyBar.add(bar);
    });
    return seen;
  }

  it('a round the Wisdom roll FAILS: the one tell is the engine’s line, and the bar never moves', async () => {
    const bundle = illusionSeed('passes-through');
    // The engine's round, on the same state: its lines, its floats, its unchanged HP.
    const expected = step(bundle.state, { kind: 'battle-action', action: 'fight' });
    const beats = groupBeats(expected.events);
    const struck = beats.find((b) => b.anchor?.kind === 'illusion-struck');
    expect(struck, 'the round never passed through — the seed search is wrong').toBeDefined();
    if (bundle.state.phase.kind !== 'battle' || expected.state.phase.kind !== 'battle') throw new Error('not a fight');
    const enemy = bundle.state.phase.battle.enemy;
    expect(expected.state.phase.battle.enemy.hp, 'the engine let the blow land').toBe(enemy.hp);

    const entries = await resume(bundle);
    expect(screen()).toBe('battle-action');
    const seen = watchArena();
    click('Fight');
    await vi.waitFor(() => expect(roundLine(entries)).toBeDefined(), { timeout: 4000, interval: 10 });
    await reach('battle-action');

    // Every line the ticker showed is the engine's, beat for beat and in the engine's order —
    // so the only word about the illusion is the engine's own "passes through" line.
    expect(seen.lines.slice(0, beats.length)).toEqual(beats.map((b) => b.line));
    expect(seen.lines).toContain(struck!.line);
    // Every number floated is one the engine put on an event; nothing the renderer made up.
    expect([...seen.floats].sort()).toEqual(beats.flatMap((b) => (b.float ? [b.float.text] : [])).sort());
    // The engine left the HP where it was; the bar showed that one value at every moment.
    expect([...seen.enemyBar]).toEqual([`${enemy.hp}/${enemy.maxHp}`]);
  });

  it('a round the Wisdom roll SUCCEEDS: the last beat is the engine’s dispel line, with the dispel hook', async () => {
    const bundle = illusionSeed('dispelled');
    const expected = step(bundle.state, { kind: 'battle-action', action: 'fight' });
    const beats = groupBeats(expected.events);
    const dispel = expected.events.find((e) => e.kind === 'illusion-dispelled')!;
    expect(beats.at(-1)!.anchor, 'the engine’s round does not end on the dispel').toBe(dispel);

    const entries = await resume(bundle);
    const seen = watchArena();
    click('Fight');
    await vi.waitFor(() => expect(roundLine(entries)).toBeDefined(), { timeout: 4000, interval: 10 });
    // Let the dispatch finish on the screen the engine now awaits, inside this case.
    await reach(awaitingFor(expected.state.phase));
    expect(seen.lines.slice(0, beats.length)).toEqual(beats.map((b) => b.line));
    expect(seen.lines.at(beats.length - 1)).toBe(formatEvent(dispel));
    expect(roundLine(entries)!.hooks.at(-1)).toBe('dispel');
  });
});

describe('floor 5’s warped kit costs on the stage exactly what the data says (AC-27)', () => {
  it('every Cast row carries its template’s suffix and the summed cost — and matches the sheet', async () => {
    const bundle = bundleOf('act5-warped');
    const fight = toLiveFight(bundle.state);
    if (fight.phase.kind !== 'battle') throw new Error('not a fight');
    const player = fight.phase.battle.player;
    const warps = player.corruptedSkills ?? {};
    expect(Object.keys(warps).length, 'the preset carries no warped kit — this proves nothing').toBeGreaterThan(0);
    // No relic in the pack moves a cost, so the data alone decides it.
    expect(computeEquipModifiers(player.inventory).chargeDiscount).toBe(0);
    const templates = corruptions.templates as { id: string; suffix: string; chargeDelta?: number }[];

    await resume({ ...bundle, state: fight });
    expect(screen()).toBe('battle-action');
    click('Cast');
    expect(labels()[0], 'the Cast menu does not open on Back').toBe('Back');
    const rows = choiceButtons().slice(1);
    const sheet = characterSheet(player).skills;
    expect(rows.length).toBe(sheet.length);
    for (const [i, row] of rows.entries()) {
      const skill = sheet[i]!;
      const id = skill.skillId as SkillId;
      const template = templates.find((t) => t.id === warps[id])!;
      const upgrade = player.skillUpgrades?.[id]?.chargeDelta ?? 0;
      // Summed HERE from the tables: the base cost, the drafted upgrade (clamped at 0, as the
      // upgrade rule does), then the warp's delta (clamped at 0 again).
      const expected = Math.max(0, Math.max(0, SKILLS[id].chargeCost + upgrade) + (template.chargeDelta ?? 0));
      const text = row.textContent ?? '';
      expect(text.startsWith(`${skill.name} `), `${id}: the row is not the skill`).toBe(true);
      expect(skill.name.endsWith(template.suffix), `${id} lost its ${template.suffix}`).toBe(true);
      expect(text.endsWith(`(${expected}⚡)`), `${id}: the row says ${text}, the data says ${expected}`).toBe(true);
      expect(skill.chargeCost, `${id}: the sheet disagrees with the data`).toBe(expected);
    }
  });
});

describe('hidden karma stays hidden on the stage (AC-30, G53)', () => {
  /**
   * The five fights the plan names. The Sin bosses' names are DESIGN-SANCTIONED — a Sin is
   * named for the vice it embodies — so they are read from `SIN_BY_AXIS` and stripped before
   * the sweep, and never spelled here. None of these five is a Sin fight, so today the
   * stripping removes nothing from the sweep itself; it is there so a Sin fight can join the
   * list without a false alarm, and the case below proves it strips what it should.
   */
  const FIGHTS: readonly [string, () => GameState][] = [
    ['act2-illusion', () => toLiveFight(bundleOf('act2-illusion').state)],
    ['hollow-fight', () => toLiveFight(bundleOf('hollow-fight').state)],
    ['judged-act4', () => toLiveFight(bundleOf('judged-act4').state)],
    ['act5-warped', () => toLiveFight(bundleOf('act5-warped').state)],
    ['a floor-1 fight', () => toLiveFight(bundleOf('act1-hub').state)],
  ];
  const SANCTIONED = Object.values(SIN_BY_AXIS).map((s) => s.name);
  const strip = (text: string): string => SANCTIONED.reduce((t, name) => t.split(name).join(''), text);

  it('the stripping removes exactly the sanctioned names, and nothing else (non-vacuity)', () => {
    expect(SANCTIONED.length).toBeGreaterThan(0);
    const sample = `${SANCTIONED[0]} strikes — hit for 3 damage.`;
    expect(strip(sample)).toBe(' strikes — hit for 3 damage.');
    // ...and the detector really fires on an axis word planted in a stage line.
    expect(AXIS_VOCABULARY.test('You feel merciful.')).toBe(true);
  });

  for (const [name, build] of FIGHTS) {
    it(`${name}: the arena, the stat box, every menu and a resolved round name no axis`, () => {
      const fight = build();
      if (fight.phase.kind !== 'battle') throw new Error('not a fight');
      const round = step(fight, { kind: 'battle-action', action: 'fight' });
      const text = strip([stageText(fight), ...groupBeats(round.events).map((b) => b.line)].join('\n'));
      expect(text.length, 'the sweep read almost nothing').toBeGreaterThan(80);
      const enemy = fight.phase.battle.enemy.fullName;
      if (!SANCTIONED.includes(enemy)) expect(text, 'the stripping took the enemy’s name with it').toContain(enemy);
      const hit = AXIS_VOCABULARY.exec(text);
      expect(hit, `the stage names a karma axis: …${hit ? text.slice(Math.max(0, hit.index - 30), hit.index + 30) : ''}…`).toBeNull();
    });
  }
});
