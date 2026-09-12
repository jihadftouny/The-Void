// @vitest-environment jsdom
//
// THE BATTLE SCREEN'S DOM HALF (PLAN.md #6): the builders, the ticker's toggle, and the
// sequencer that replays a round — AC-18, AC-21, AC-22, AC-25's DOM half.
//
// jsdom has no layout engine, so nothing here judges geometry (the layout probe does, in real
// Chromium). What this file CAN see, and a source scan cannot: that a hostile name is text and
// not a node; that each bar is written exactly once per round, at the beat named for it and
// not a tick before; that the hooks go out in beat order; and that reduced motion changes the
// motion and NOT the timing. Time is fake (`vi.useFakeTimers`) and advanced by hand, so every
// intermediate state is observed rather than inferred from the end.
//
// ⚠ ORDER-AGNOSTIC (Appendix A.1): the sequencer is played a round in each order, and each is
// checked against expectations derived from THAT order. Nothing asserts which side acts first.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  arenaEls,
  buildArena,
  buildBattleMenu,
  buildVitals,
  playRound,
  setLogOpen,
  type ArenaEls,
  type PlayDeps,
} from './battle.ts';
import type { BattleMenuRow, RoundPlan, StageView, VitalsView } from './battle-model.ts';
import { barUpdateAt, beatSchedule, groupBeats } from '../render/beat-model.ts';
import { resourceBarModel, conditionChips } from '../render/component-model.ts';
import type { AudioHookName, AudioSink } from '../render/audio-hooks.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { makeCondition } from '../game/condition.ts';
import { ONE_OF_EVERY_EVENT } from '../game/eventSamples.testutil.ts';

const HOSTILE = '<img src=x onerror="window.__pwned=1">Rust Chorister';

function stage(overrides: Partial<StageView> = {}): StageView {
  return {
    name: 'Rust Chorister',
    hp: resourceBarModel('HP', 20, 30, 'foe'),
    chips: conditionChips([makeCondition('burn')]),
    isBoss: false,
    ...overrides,
  };
}

function vitals(overrides: Partial<VitalsView> = {}): VitalsView {
  return {
    name: 'Probe',
    classLine: 'Enforcer · level 3',
    hp: resourceBarModel('HP', 12, 15, 'hp'),
    charges: resourceBarModel('Charges', 3, 5, 'accent'),
    resource: { kind: 'momentum', value: 2 },
    chips: [],
    ...overrides,
  };
}

/** A frame on the page: the arena and the stat box, as `game.ts` mounts them. */
function mountFrame(s: StageView = stage(), v: VitalsView = vitals()): { arena: HTMLElement; vitals: HTMLElement; els: ArenaEls } {
  document.body.innerHTML = '<div id="arena"></div><div id="vitals"></div><div id="column"><div id="log"></div></div>';
  const arena = document.getElementById('arena')!;
  const box = document.getElementById('vitals')!;
  arena.appendChild(buildArena(s, { line: '' }));
  box.appendChild(buildVitals(v));
  const els = arenaEls(arena, box);
  expect(els, 'the frame the builders made is missing an element the sequencer needs').not.toBeNull();
  return { arena, vitals: box, els: els! };
}

const barText = (host: HTMLElement): string => host.querySelector('.void-bar-text')?.textContent ?? '';

/** Deep-freeze plain data, so a sequencer that wrote into its plan would throw. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as object)) freeze(v);
    Object.freeze(value);
  }
  return value;
}

// ------- a round, in each order ---------------------------------------------------------

const attack = ONE_OF_EVERY_EVENT.attack;
const enemyStrike: GameEvent = { ...attack, subject: 'enemy', outcome: 'hit', damage: 3 };
const playerStrike: GameEvent = { ...attack, subject: 'player', outcome: 'hit', damage: 4 };
const playerTick: GameEvent = { kind: 'condition-damage', subject: 'player', conditionType: 'poison', amount: 1 };

/** A plan for `events`, with the bars before and after as the engine would report them. */
function plan(events: GameEvent[]): RoundPlan {
  const beats = groupBeats(events);
  return freeze({
    beats,
    schedule: beatSchedule(beats.length),
    updateAt: barUpdateAt(beats),
    bars: {
      player: { before: resourceBarModel('HP', 12, 15, 'hp'), after: resourceBarModel('HP', 8, 15, 'hp') },
      enemy: { before: resourceBarModel('HP', 20, 30, 'foe'), after: resourceBarModel('HP', 16, 30, 'foe') },
      charges: { before: resourceBarModel('Charges', 3, 5, 'accent'), after: resourceBarModel('Charges', 3, 5, 'accent') },
    },
  });
}

function recorder(): AudioSink & { calls: { name: AudioHookName; index: number; side?: string }[] } {
  const calls: { name: AudioHookName; index: number; side?: string }[] = [];
  return { calls, play: (name, detail) => calls.push({ name, ...detail }) };
}

function deps(animate: boolean, audio: AudioSink = recorder()): PlayDeps {
  return { wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), audio, animate };
}

/** Let a resolved `wait` hand control back to the sequencer. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// =========================================================================================

describe('the builders set every word as text (G28(b)’s rule, on the new screen)', () => {
  it('a hostile enemy name and player name are TEXT — no element is created from them', () => {
    const { arena, vitals: box } = mountFrame(stage({ name: HOSTILE }), vitals({ name: HOSTILE }));
    expect(arena.querySelector('.arena-name')!.textContent).toBe(HOSTILE);
    expect(box.querySelector('.vitals-name')!.textContent).toBe(HOSTILE);
    expect(document.querySelectorAll('img').length, 'a name became markup').toBe(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe('the arena (AC-11, AC-18)', () => {
  it('holds exactly one enemy region, in its figure, and the foe’s name, bar and chips', () => {
    const { arena } = mountFrame();
    const slots = arena.querySelectorAll('.void-art-slot[data-art-slot="enemy"]');
    expect(slots).toHaveLength(1);
    expect(slots[0]!.parentElement!.classList.contains('arena-figure')).toBe(true);
    // The region prints nothing: empty and aria-hidden, as the art-slot builder ships it.
    expect(slots[0]!.textContent).toBe('');
    expect(arena.querySelector('.frame-bar[data-bar="enemy"] .void-bar-foe')).not.toBeNull();
    expect(barText(arena.querySelector('.frame-bar[data-bar="enemy"]')!)).toBe('20/30');
    expect(arena.querySelectorAll('.chips .void-chip')).toHaveLength(1);
  });

  it('always appends the chip row, and an empty one is just empty (no branch to invert)', () => {
    const { arena } = mountFrame(stage({ chips: [] }));
    const row = arena.querySelector('.chips');
    expect(row, 'the chip row is conditional again').not.toBeNull();
    expect(row!.children).toHaveLength(0);
  });

  it('the ticker is one live line and exactly one Record toggle that controls the log', () => {
    const { arena } = mountFrame();
    const line = arena.querySelectorAll('.ticker-line');
    expect(line).toHaveLength(1);
    expect(line[0]!.getAttribute('aria-live')).toBe('polite');
    const toggles = arena.querySelectorAll('button');
    expect(toggles, 'the arena carries a control other than the toggle').toHaveLength(1);
    expect(toggles[0]!.getAttribute('aria-controls')).toBe('log');
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(toggles[0]!.textContent).toBe('▸ Record');
  });

  it('opening the log marks the column and the toggle; closing it undoes both', () => {
    const { arena } = mountFrame();
    const column = document.getElementById('column')!;
    const toggle = arena.querySelector<HTMLElement>('.ticker-toggle')!;
    setLogOpen(column, toggle, true);
    expect(column.dataset['log']).toBe('open');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('▾ Record');
    setLogOpen(column, toggle, false);
    expect(column.dataset['log']).toBe('closed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('a rebuilt arena keeps the ticker’s last line, and is always built with the log CLOSED', () => {
    document.body.innerHTML = '';
    const inner = buildArena(stage(), { line: 'You strike — hit for 4 damage.' });
    expect(inner.querySelector('.ticker-line')!.textContent).toBe('You strike — hit for 4 damage.');
    // The open state is applied by `setLogOpen` alone — the one writer of the column's flag and
    // the toggle together — so a builder cannot paint one without the other.
    expect(inner.querySelector('.ticker-toggle')!.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the stat box (AC-12) and the reserved tempo row (AC-25)', () => {
  it('name, class line, HP (hp tone), charges (accent), the resource line, the chips', () => {
    const { vitals: box } = mountFrame(stage(), vitals({ chips: conditionChips([makeCondition('stun')]) }));
    expect(box.querySelector('.vitals-class')!.textContent).toBe('Enforcer · level 3');
    expect(box.querySelector('.frame-bar[data-bar="player"] .void-bar-hp')).not.toBeNull();
    expect(box.querySelector('.frame-bar[data-bar="charges"] .void-bar-accent')).not.toBeNull();
    expect(box.querySelector('.vitals-resource')!.textContent).toBe('Momentum 2');
    expect(box.querySelectorAll('.chips .void-chip')).toHaveLength(1);
  });

  it('a class with no resource shows no resource line', () => {
    const { vitals: box } = mountFrame(stage(), { ...vitals(), resource: undefined } as unknown as VitalsView);
    expect(box.querySelector('.vitals-resource')).toBeNull();
  });

  it('NO tempo element exists while there is no tempo — no gauge, no "0.0", no label', () => {
    const { arena, vitals: box } = mountFrame();
    expect(document.querySelectorAll('.tempo-row')).toHaveLength(0);
    expect(`${arena.textContent}${box.textContent}`).not.toMatch(/tempo|0\.0/i);
  });

  it('with a tempo (a test-only fixture — no engine field exists) a gauge row renders on each side', () => {
    const { arena, vitals: box } = mountFrame(stage({ tempo: 0.8 }), vitals({ tempo: 0.3 }));
    expect(arena.querySelectorAll('.tempo-row')).toHaveLength(1);
    expect(box.querySelectorAll('.tempo-row')).toHaveLength(1);
    expect(arena.querySelector('.tempo-row .void-bar-text')!.textContent).toBe('0.8');
  });
});

describe('the menu', () => {
  it('one shared button per row; a row hands itself back; a greyed Run is inert', () => {
    const rows: BattleMenuRow[] = [{ kind: 'fight' }, { kind: 'cast' }, { kind: 'run', enabled: false, reason: 'There is nowhere to go' }];
    const picked: BattleMenuRow[] = [];
    const menu = buildBattleMenu(rows, (row) => picked.push(row));
    document.body.replaceChildren(menu);
    const buttons = [...menu.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Fight', 'Cast', 'Run (There is nowhere to go)']);
    expect(buttons[2]!.disabled).toBe(true);
    buttons[2]!.click();
    buttons[0]!.click();
    expect(picked).toEqual([{ kind: 'fight' }]);
  });
});

// =========================================================================================
// THE SEQUENCER (AC-21, AC-22)
// =========================================================================================

describe('playRound replays a round beat by beat (AC-21)', () => {
  /** Run a round, recording the ticker and every bar's text at each scheduled moment. */
  async function walk(events: GameEvent[], animate: boolean) {
    const { els } = mountFrame();
    const p = plan(events);
    const audio = recorder();
    const writes: Record<'player' | 'enemy' | 'charges', number> = { player: 0, enemy: 0, charges: 0 };
    for (const key of ['player', 'enemy', 'charges'] as const) {
      new MutationObserver((records) => {
        for (const r of records) writes[key] += [...r.addedNodes].filter((n) => (n as Element).classList?.contains('void-bar')).length;
      }).observe(els.bars[key], { childList: true });
    }
    const classesSeen = new Set<string>();
    new MutationObserver(() => {
      for (const host of [els.enemy, els.player]) for (const c of host.classList) classesSeen.add(c);
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    let resolved = false;
    const done = playRound(p, els, { ...deps(animate, audio) }).then((r) => {
      resolved = true;
      return r;
    });
    const frames: { ticker: string; player: string; enemy: string; hooks: number }[] = [];
    await flush();
    for (let i = 0; i < p.beats.length; i += 1) {
      frames.push({
        ticker: els.ticker.textContent ?? '',
        player: barText(els.bars.player),
        enemy: barText(els.bars.enemy),
        hooks: audio.calls.length,
      });
      if (i < p.beats.length - 1) {
        await vi.advanceTimersByTimeAsync(p.schedule.at[i + 1]! - p.schedule.at[i]!);
        await flush();
      }
    }
    // One millisecond short of the hold, it has not resolved; at the hold, it has.
    await vi.advanceTimersByTimeAsync(p.schedule.done - p.schedule.at[p.beats.length - 1]! - 1);
    await flush();
    const earlyResolve = resolved;
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    const result = await done;
    return { frames, writes, audio, result, earlyResolve, classesSeen, plan: p, els };
  }

  it('the engine’s CURRENT order: lines in order, each bar written once, at its beat, not before', async () => {
    const r = await walk([enemyStrike, playerStrike], true);
    // Hand-derived from format.ts and this order.
    expect(r.frames.map((f) => f.ticker)).toEqual(['The enemy strikes — hit for 3 damage.', 'You strike — hit for 4 damage.']);
    // Beat 0 struck the player: the player's bar already shows the engine's after value; the
    // enemy's still shows before. Beat 1 struck the enemy.
    expect(r.frames[0]).toMatchObject({ player: '8/15', enemy: '20/30' });
    expect(r.frames[1]).toMatchObject({ player: '8/15', enemy: '16/30' });
    expect(r.writes, 'a bar was written more (or less) than once').toEqual({ player: 1, enemy: 1, charges: 1 });
    // Each beat's sound goes out AT its beat — one by the first, two by the second.
    expect(r.frames.map((f) => f.hooks), 'the hooks were not sent beat by beat').toEqual([1, 2]);
    expect(r.audio.calls.map((c) => c.name)).toEqual(['hit', 'hit']);
    expect(r.audio.calls.map((c) => c.side)).toEqual(['player', 'enemy']);
    expect(r.result).toEqual({ beats: 2, hooks: ['hit', 'hit'] });
    // Resolves at (n − 1) × spacing + hold = 240 + 240, and not a millisecond before.
    expect(r.earlyResolve).toBe(false);
  });

  it('the DESIGN’S order (§14.8): the same round player-first replays just as faithfully', async () => {
    const r = await walk([playerStrike, enemyStrike], true);
    expect(r.frames.map((f) => f.ticker)).toEqual(['You strike — hit for 4 damage.', 'The enemy strikes — hit for 3 damage.']);
    // Mirror image: now the ENEMY's bar is written first and the player's second.
    expect(r.frames[0]).toMatchObject({ player: '12/15', enemy: '16/30' });
    expect(r.frames[1]).toMatchObject({ player: '8/15', enemy: '16/30' });
    expect(r.writes).toEqual({ player: 1, enemy: 1, charges: 1 });
    expect(r.audio.calls.map((c) => c.side)).toEqual(['enemy', 'player']);
  });

  it('every beat’s sound is forwarded, a miss included — no hook is dropped on the way', async () => {
    const miss: GameEvent = { ...attack, subject: 'enemy', outcome: 'miss', damage: 0 };
    const r = await walk([miss, playerStrike], true);
    expect(r.audio.calls.map((c) => c.name)).toEqual(['miss', 'hit']);
    expect(r.frames[0]!.ticker).toBe('The enemy strikes — miss.');
  });

  it('a longer round: the bar waits for the LAST beat that touched it', async () => {
    const r = await walk([enemyStrike, playerTick, playerStrike], true);
    // The player's bar is touched at beats 0 and 1 — written once, at 1.
    expect(r.frames[0]!.player).toBe('12/15');
    expect(r.frames[1]!.player).toBe('8/15');
    expect(r.writes.player).toBe(1);
  });

  it('floats the engine’s number over the struck side, and clears it at the next beat', async () => {
    const { els } = mountFrame();
    const p = plan([enemyStrike, playerStrike]);
    const running = playRound(p, els, deps(true));
    await flush();
    expect(els.player.querySelector('.arena-float')!.textContent).toBe('−3');
    expect(els.enemy.querySelector('.arena-float')).toBeNull();
    await vi.advanceTimersByTimeAsync(p.schedule.spacing);
    await flush();
    expect(els.player.querySelector('.arena-float'), 'the last beat’s float was not cleared').toBeNull();
    expect(els.enemy.querySelector('.arena-float')!.textContent).toBe('−4');
    await vi.runAllTimersAsync();
    await running;
    expect(document.querySelectorAll('.arena-float'), 'floats outlived the round').toHaveLength(0);
  });

  it('never touches its plan — it is handed frozen data and throws on nothing', async () => {
    const { els } = mountFrame();
    const p = plan([enemyStrike, playerStrike]);
    expect(Object.isFrozen(p.beats[0])).toBe(true);
    const running = playRound(p, els, deps(true));
    await vi.runAllTimersAsync();
    await expect(running).resolves.toEqual({ beats: 2, hooks: ['hit', 'hit'] });
  });

  it('the floor-3 drain plays as its own beat, and the charges bar is written at it (AC-28)', async () => {
    const { els } = mountFrame();
    const drain = ONE_OF_EVERY_EVENT['floor-drain'];
    const beats = groupBeats([drain]);
    const p = freeze({
      beats,
      schedule: beatSchedule(1),
      updateAt: barUpdateAt(beats),
      bars: {
        player: { before: resourceBarModel('HP', 12, 15, 'hp'), after: resourceBarModel('HP', 12, 15, 'hp') },
        enemy: { before: resourceBarModel('HP', 20, 30, 'foe'), after: resourceBarModel('HP', 20, 30, 'foe') },
        charges: { before: resourceBarModel('Charges', 3, 5, 'accent'), after: resourceBarModel('Charges', 2, 5, 'accent') },
      },
    });
    const audio = recorder();
    const running = playRound(p, els, deps(true, audio));
    await flush();
    expect(els.ticker.textContent).toBe(`This place drains ${drain.amount} skill charge${drain.amount === 1 ? '' : 's'} from you.`);
    expect(barText(els.bars.charges)).toBe('2/5');
    expect(audio.calls.map((c) => c.name)).toEqual(['tick']);
    await vi.runAllTimersAsync();
    await running;
  });
});

describe('reduced motion changes the motion and NOT the timing (AC-22, UI-DESIGN §13)', () => {
  async function trace(animate: boolean) {
    const { els } = mountFrame();
    const p = plan([enemyStrike, playerStrike]);
    const seen = new Set<string>();
    const tick: string[] = [];
    new MutationObserver(() => {
      for (const host of [els.enemy, els.player]) for (const c of host.classList) seen.add(c);
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    let settledAt = -1;
    const start = Date.now();
    const running = playRound(p, els, deps(animate)).then(() => {
      settledAt = Date.now() - start;
    });
    await flush();
    tick.push(els.ticker.textContent ?? '');
    await vi.advanceTimersByTimeAsync(p.schedule.spacing);
    await flush();
    tick.push(els.ticker.textContent ?? '');
    await vi.runAllTimersAsync();
    await running;
    return { seen, tick, settledAt, finalClasses: [...els.enemy.classList, ...els.player.classList] };
  }

  it('the same ticker sequence and the same resolve time, either way', async () => {
    const full = await trace(true);
    const reduced = await trace(false);
    expect(reduced.tick).toEqual(full.tick);
    expect(reduced.settledAt).toBe(full.settledAt);
    expect(full.settledAt, 'the round did not take its scheduled time').toBe(480);
  });

  it('reduced: no flash and no shake class is EVER added — the strike is a tint', async () => {
    const reduced = await trace(false);
    expect(reduced.seen.has('is-struck')).toBe(false);
    expect(reduced.seen.has('is-shaking')).toBe(false);
    expect(reduced.seen.has('is-tinted'), 'the strike left no mark at all under reduced motion').toBe(true);
  });

  it('full motion: the flash and the shake ARE added — and removed by the end', async () => {
    const full = await trace(true);
    expect(full.seen.has('is-struck')).toBe(true);
    expect(full.seen.has('is-shaking')).toBe(true);
    expect(full.seen.has('is-tinted')).toBe(false);
    expect(full.finalClasses).not.toContain('is-struck');
    expect(full.finalClasses).not.toContain('is-shaking');
  });
});

describe('the DOM half is thin: no engine, no game state, no logger, no markup (AC-21, AC-31)', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/desktop/battle.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('imports nothing from the engine and never names GameState or step', () => {
    expect(source).not.toMatch(/from\s*'[^']*\/game\//);
    expect(source).not.toMatch(/\bGameState\b/);
    expect(source).not.toMatch(/\bstep\s*\(/);
    // Non-vacuity: the scan read the real module.
    expect(source).toMatch(/export async function playRound\(/);
  });

  it('logs nothing and imports no logger — `game.ts` is the boundary', () => {
    expect(source).not.toMatch(/from\s*'[^']*\/log\//);
    expect(source).not.toMatch(/\blog\s*\.\s*(?:debug|info|warn|error|log)\s*\(/);
  });

  it('builds no markup from a string, anywhere', () => {
    expect(source).not.toMatch(/\.\s*(?:inner|outer)HTML\s*=|insertAdjacentHTML\s*\(|createContextualFragment\s*\(/);
    expect(source, 'the builders set no text at all — how are they rendering?').toMatch(/textContent\s*=/);
  });

  it('reads no clock: its only time is the `wait` it is handed', () => {
    expect(source).not.toMatch(/\bDate\s*\.\s*now\s*\(|\bperformance\s*\.\s*now\s*\(|\bsetTimeout\s*\(/);
    expect(source).toMatch(/deps\.wait\(/);
  });
});
