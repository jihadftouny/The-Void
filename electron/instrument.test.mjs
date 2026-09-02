// Every duration below comes from a SCRIPTED clock and is asserted as an EXACT number.
// The heartbeat is driven by an injected timer, fired by hand — no `vi.useFakeTimers`, no
// real waiting, no tolerance windows.
import { describe, it, expect } from 'vitest';
import {
  createInstrument,
  levelForMs,
  roundMs,
  THRESHOLDS,
  HEARTBEAT_MS,
  HEARTBEAT_MAX,
} from './instrument.mjs';

/** A clock that hands out the scripted values in order, then repeats the last one. */
function scriptClock(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** A timer seam a test drives by hand. `fire()` runs the callback once. */
function manualTimer() {
  const state = { armed: 0, cleared: 0, callback: null, intervalMs: null, unrefs: 0, token: null };
  const setTimer = (cb, ms) => {
    state.armed += 1;
    state.callback = cb;
    state.intervalMs = ms;
    state.token = {
      id: state.armed,
      unref() {
        state.unrefs += 1;
      },
    };
    return state.token;
  };
  const clearTimer = (token) => {
    state.cleared += 1;
    state.clearedToken = token;
  };
  state.fire = (times = 1) => {
    for (let i = 0; i < times; i++) state.callback?.();
  };
  return { state, setTimer, clearTimer };
}

/** An instrument whose entries are captured. */
function harness({ clock = scriptClock([0]), timer = manualTimer(), ...rest } = {}) {
  const entries = [];
  const inst = createInstrument({
    log: (level, category, message, data) => entries.push({ level, category, message, data }),
    now: clock,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    ...rest,
  });
  return { inst, entries, timer };
}

describe('the derived constants', () => {
  it('THRESHOLDS is frozen and carries the numbers the design derived', () => {
    expect(Object.isFrozen(THRESHOLDS)).toBe(true);
    expect(THRESHOLDS.modelResolve).toBe(30_000);
    expect(THRESHOLDS.gpuProbe).toBe(20_000);
    expect(THRESHOLDS.modelLoad).toBe(60_000);
    expect(THRESHOLDS.generate).toBe(20_000);
    expect(THRESHOLDS.windowLoad).toBe(5_000);
  });

  it('the heartbeat gives first evidence in ten seconds and stops around ten minutes', () => {
    expect(HEARTBEAT_MS).toBe(10_000);
    expect(HEARTBEAT_MAX).toBe(60);
    expect((HEARTBEAT_MS * HEARTBEAT_MAX) / 60_000).toBe(10); // minutes, by hand
  });
});

describe('levelForMs / roundMs', () => {
  it('escalates at or over the threshold, and defaults healthy to info', () => {
    expect(levelForMs(19_999, 20_000)).toBe('info');
    expect(levelForMs(20_000, 20_000)).toBe('warn');
    expect(levelForMs(20_001, 20_000)).toBe('warn');
    expect(levelForMs(0, 20_000, 'debug')).toBe('debug');
  });

  it('an unmeasurable duration is warn, and rounds to -1', () => {
    expect(levelForMs(NaN, 20_000)).toBe('warn');
    expect(roundMs(NaN)).toBe(-1);
    expect(roundMs(1.2345)).toBe(1.23);
    expect(roundMs(3500)).toBe(3500);
  });
});

describe('a completed operation', () => {
  it('emits a start line and EXACTLY ONE end line carrying the exact clock delta', () => {
    const { inst, entries } = harness({ clock: scriptClock([1000, 4500]) });
    const op = inst.begin('llm', 'model load', { modelPath: 'x.gguf' }, THRESHOLDS.modelLoad);
    op.done();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ level: 'debug', category: 'llm', message: 'model load: start' });
    expect(entries[0].data).toEqual({ modelPath: 'x.gguf' });
    const end = entries.filter((e) => e.message === 'model load: done');
    expect(end).toHaveLength(1);
    expect(end[0].data.ms).toBe(3500); // 4500 - 1000, exactly
  });

  it('is info under the threshold and warn at or over it', () => {
    const under = harness({ clock: scriptClock([0, 19_999]) });
    under.inst.begin('llm', 'generate', {}, THRESHOLDS.generate).done();
    expect(under.entries.at(-1).level).toBe('info');

    const at = harness({ clock: scriptClock([0, 20_000]) });
    at.inst.begin('llm', 'generate', {}, THRESHOLDS.generate).done();
    expect(at.entries.at(-1).level).toBe('warn');
  });

  it('carries the start data, everything noted, and the extras — all JSON round-trippable', () => {
    const { inst, entries } = harness({ clock: scriptClock([0, 120]) });
    const op = inst.begin('llm', 'generate', { requestId: 'r1', maxTokens: 400 }, THRESHOLDS.generate);
    op.note({ chunks: 12 });
    op.note({ ttftMs: 40 });
    op.done({ tokens: 88 });
    const data = entries.at(-1).data;
    expect(data).toEqual({ requestId: 'r1', maxTokens: 400, chunks: 12, ttftMs: 40, tokens: 88, ms: 120 });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('never interpolates anything into the message', () => {
    const { inst, entries } = harness({ clock: scriptClock([0, 5]) });
    const op = inst.begin('llm', 'context create', { contextSize: 4096 }, THRESHOLDS.contextCreate);
    op.done();
    for (const e of entries) {
      expect(e.message, `"${e.message}" contains a digit`).toMatch(/^[^0-9]*$/);
      expect(e.message).toMatch(/^[^$]*$/);
    }
  });
});

describe('a failed operation', () => {
  it('emits exactly one error line with ms, message and stack', () => {
    const { inst, entries } = harness({ clock: scriptClock([100, 900]) });
    const op = inst.begin('llm', 'model load', { modelPath: 'x' }, THRESHOLDS.modelLoad);
    op.fail(new Error('no such file'));
    const failures = entries.filter((e) => e.message === 'model load: FAILED');
    expect(failures).toHaveLength(1);
    expect(failures[0].level).toBe('error');
    expect(failures[0].data.ms).toBe(800);
    expect(failures[0].data.message).toBe('no such file');
    expect(failures[0].data.stack).toContain('no such file');
    expect(entries.filter((e) => e.message.endsWith(': done'))).toHaveLength(0);
  });

  it('run() RE-THROWS the original error object, identity-equal', async () => {
    const { inst, entries } = harness({ clock: scriptClock([0, 10]) });
    const boom = new Error('vram exhausted');
    let caught = null;
    await expect(
      inst.run('llm', 'model load', {}, async () => {
        throw boom;
      }, THRESHOLDS.modelLoad),
    ).rejects.toBe(boom);
    try {
      await inst.run('llm', 'model load', {}, async () => {
        throw boom;
      }, THRESHOLDS.modelLoad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom); // the SAME object — the instrument never wraps
    expect(entries.filter((e) => e.level === 'error').length).toBeGreaterThan(0);
  });

  it('run() returns the operation value untouched on success', async () => {
    const { inst } = harness({ clock: scriptClock([0, 1]) });
    const value = { model: 'loaded', n: 7 };
    await expect(inst.run('llm', 'model load', {}, async () => value)).resolves.toBe(value);
  });

  it('run() hands the op to the body, so it can note before it finishes', async () => {
    const { inst, entries } = harness({ clock: scriptClock([0, 50]) });
    await inst.run('llm', 'model resolve', { modelsDir: 'd' }, async (op) => {
      op.note({ modelPath: 'd/m.gguf', existedBefore: true });
      return 'd/m.gguf';
    }, THRESHOLDS.modelResolve);
    expect(entries.at(-1).data).toEqual({
      modelsDir: 'd',
      modelPath: 'd/m.gguf',
      existedBefore: true,
      ms: 50,
    });
  });
});

// =========================================================================================
// THE HEARTBEAT — the whole point of the unit. A completed operation logs itself; an
// operation that NEVER completes is the case with no evidence, and this is the only thing
// that produces any.
// =========================================================================================

describe('the heartbeat', () => {
  it('is armed at HEARTBEAT_MS and unref-ed so it cannot hold the app open', () => {
    const { inst, timer } = harness({ clock: scriptClock([0]) });
    inst.begin('llm', 'generate', {}, THRESHOLDS.generate);
    expect(timer.state.armed).toBe(1);
    expect(timer.state.intervalMs).toBe(HEARTBEAT_MS);
    expect(timer.state.unrefs).toBe(1);
  });

  it('a timer WITHOUT unref (a plain token) does not throw', () => {
    const entries = [];
    const inst = createInstrument({
      log: (l, c, m, d) => entries.push({ l, c, m, d }),
      now: () => 0,
      setTimer: () => 42, // a bare numeric handle, as browsers return
      clearTimer: () => undefined,
    });
    expect(() => inst.begin('llm', 'generate', {}).done()).not.toThrow();
  });

  it('warns with the EXACT elapsed time and whatever was last noted', () => {
    const { inst, entries, timer } = harness({ clock: scriptClock([1000, 11_000, 21_000]) });
    const op = inst.begin('llm', 'generate', { requestId: 'r9' }, THRESHOLDS.generate);
    op.note({ chunks: 3, ttftMs: 900 });
    timer.state.fire();
    op.note({ chunks: 17 });
    timer.state.fire();
    const beats = entries.filter((e) => e.message === 'generate: STILL RUNNING');
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({ level: 'warn', category: 'llm' });
    expect(beats[0].data).toEqual({ requestId: 'r9', chunks: 3, ttftMs: 900, elapsedMs: 10_000, beat: 1 });
    expect(beats[1].data).toEqual({ requestId: 'r9', chunks: 17, ttftMs: 900, elapsedMs: 20_000, beat: 2 });
  });

  it('a GROWING chunk count distinguishes "slow" from "wedged" — the diagnostic itself', () => {
    // This is the question the incident could not answer. Two heartbeats whose `chunks`
    // are equal mean the token stream has stopped; two whose `chunks` differ mean it is
    // merely slow. Assert the payload really carries the distinction.
    const { inst, entries, timer } = harness({ clock: scriptClock([0, 10_000, 20_000]) });
    const op = inst.begin('llm', 'generate', {}, THRESHOLDS.generate);
    op.note({ chunks: 5 });
    timer.state.fire();
    timer.state.fire(); // nothing noted in between: a wedged stream
    const beats = entries.filter((e) => e.message === 'generate: STILL RUNNING');
    expect(beats[0].data.chunks).toBe(5);
    expect(beats[1].data.chunks).toBe(5);
    expect(beats[1].data.elapsedMs).toBeGreaterThan(beats[0].data.elapsedMs);
  });

  it('stops the instant the operation SUCCEEDS — clearTimer called exactly once', () => {
    const { inst, timer } = harness({ clock: scriptClock([0, 1]) });
    const op = inst.begin('llm', 'generate', {}, THRESHOLDS.generate);
    op.done();
    expect(timer.state.cleared).toBe(1);
    expect(timer.state.clearedToken).toBe(timer.state.token);
    op.done(); // a second call must not clear twice
    expect(timer.state.cleared).toBe(1);
  });

  it('stops the instant the operation FAILS — clearTimer called exactly once', () => {
    const { inst, timer } = harness({ clock: scriptClock([0, 1]) });
    const op = inst.begin('llm', 'generate', {}, THRESHOLDS.generate);
    op.fail(new Error('x'));
    expect(timer.state.cleared).toBe(1);
  });

  it('emits at most HEARTBEAT_MAX beats, then ONE suppression line and nothing more', () => {
    const { inst, entries, timer } = harness({ clock: scriptClock([0]), heartbeatMax: 3 });
    inst.begin('llm', 'generate', {}, THRESHOLDS.generate);
    timer.state.fire(3);
    expect(entries.filter((e) => e.message === 'generate: STILL RUNNING')).toHaveLength(3);
    timer.state.fire(); // the fourth tick
    expect(entries.filter((e) => e.message === 'generate: heartbeat suppressed')).toHaveLength(1);
    expect(entries.at(-1).data.beats).toBe(3);
    expect(timer.state.cleared).toBe(1);
    timer.state.fire(5); // whatever a broken timer does afterwards
    expect(entries.filter((e) => e.message === 'generate: STILL RUNNING')).toHaveLength(3);
    expect(entries.filter((e) => e.message === 'generate: heartbeat suppressed')).toHaveLength(1);
  });

  it('a tick that arrives AFTER the operation settled emits nothing', () => {
    // `clearTimer` is the normal exit, but a tick already queued when the operation
    // settled would otherwise log a heartbeat for an operation that is finished — a
    // "STILL RUNNING" line for something that is not.
    const { inst, entries, timer } = harness({ clock: scriptClock([0, 5]) });
    const op = inst.begin('llm', 'generate', {}, THRESHOLDS.generate);
    op.done();
    const before = entries.length;
    timer.state.fire(3);
    expect(entries).toHaveLength(before);
  });

  it('a fast operation emits NO heartbeat at all (so the assertions above are not free)', () => {
    const { inst, entries } = harness({ clock: scriptClock([0, 5]) });
    inst.begin('llm', 'generate', {}, THRESHOLDS.generate).done();
    expect(entries.filter((e) => e.message.includes('STILL RUNNING'))).toHaveLength(0);
  });
});

describe('the default log sink is a no-op', () => {
  it('an instrument built with no `log` never throws', () => {
    const inst = createInstrument({ now: () => 0, setTimer: () => null, clearTimer: () => undefined });
    expect(() => inst.begin('llm', 'x', {}).done()).not.toThrow();
  });
});
