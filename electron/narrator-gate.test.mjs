// G37 — "two concurrent model loads on first run", the most likely cause of the freeze
// that created this unit.
//
// THE ONLY TEST THAT PROVES ANYTHING HERE IS A CONCURRENT ONE. The broken code
// (`if (!narrator) { narrator = await createNarrator(...) }`) is perfectly correct when
// called sequentially: the first call finishes, the value is set, the second call sees it.
// It fails only when a second caller arrives WHILE the first is still awaiting — which is
// exactly what happens in the app, because `createWindow` fires the load un-awaited and
// the renderer's first `llm:generate` lands four clicks later, well inside the window.
//
// So every assertion below counts CONSTRUCTIONS while a load is deliberately unresolved,
// and the "reference implementation of the defect" test at the bottom proves the harness
// itself can tell the two apart.
import { describe, it, expect } from 'vitest';
import { createNarratorGate } from './narrator-gate.mjs';

/** A factory that counts calls and hands the test the resolve/reject levers. */
function controllableFactory() {
  const state = { constructions: 0, resolvers: [], rejecters: [], statuses: [] };
  const create = (onStatus) => {
    state.constructions += 1;
    state.statuses.push(onStatus);
    return new Promise((resolve, reject) => {
      state.resolvers.push(resolve);
      state.rejecters.push(reject);
    });
  };
  return { state, create };
}

function gateWith(create, clockValues = [0]) {
  const entries = [];
  let i = 0;
  const gate = createNarratorGate({
    create,
    log: (level, category, message, data) => entries.push({ level, category, message, data }),
    now: () => clockValues[Math.min(i++, clockValues.length - 1)],
  });
  return { gate, entries };
}

const narrator = { gpu: 'vulkan', device: 'NVIDIA RTX', unified: false, vram: { total: 8e9 }, deviceIndex: 0 };

describe('G37: concurrent callers construct the narrator EXACTLY ONCE', () => {
  it('two callers racing before the first resolves', async () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const a = gate.ensure('boot');
    const b = gate.ensure('generate'); // the load is still outstanding
    expect(state.constructions).toBe(1);
    expect(gate.constructionCount()).toBe(1);
    expect(a).toBe(b); // the SAME promise, so both callers wait on one load
    state.resolvers[0](narrator);
    await expect(a).resolves.toBe(narrator);
    await expect(b).resolves.toBe(narrator);
    expect(state.constructions).toBe(1);
  });

  it('...and still once when the event loop TURNS between them (the real shape)', async () => {
    // This is the case the old code failed and a sequential test cannot see. The broken
    // version assigned `narrator` after its `await`, so ANY number of ticks could pass
    // with the guard still reading `null`.
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const a = gate.ensure('boot');
    await Promise.resolve(); // microtasks drain
    await new Promise((r) => setTimeout(r, 0)); // a full event-loop turn
    await new Promise((r) => setImmediate(r)); // and another
    const b = gate.ensure('generate');
    expect(state.constructions).toBe(1);
    state.resolvers[0](narrator);
    await Promise.all([a, b]);
    expect(gate.constructionCount()).toBe(1);
  });

  it('...and still once for TWENTY racing callers', async () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const waiters = [];
    for (let i = 0; i < 20; i++) {
      waiters.push(gate.ensure(i === 0 ? 'boot' : 'generate'));
      if (i % 3 === 0) await Promise.resolve();
    }
    expect(state.constructions).toBe(1);
    state.resolvers[0](narrator);
    await Promise.all(waiters);
    expect(gate.constructionCount()).toBe(1);
    expect(gate.callCount()).toBe(20);
  });

  it('a caller AFTER the load resolved reuses it and never constructs again', async () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const a = gate.ensure('boot');
    state.resolvers[0](narrator);
    await a;
    await expect(gate.ensure('generate')).resolves.toBe(narrator);
    expect(state.constructions).toBe(1);
  });

  it('logs ONE "start" and one "already in flight" per extra caller', () => {
    const { create } = controllableFactory();
    const { gate, entries } = gateWith(create);
    gate.ensure('boot');
    gate.ensure('generate');
    gate.ensure('generate');
    const starts = entries.filter((e) => e.message === 'narrator load: start');
    const reused = entries.filter((e) => e.message === 'narrator load: already in flight');
    expect(starts).toHaveLength(1);
    expect(starts[0].data).toEqual({ call: 1, trigger: 'boot' });
    expect(reused).toHaveLength(2);
    expect(reused.map((e) => e.data.call)).toEqual([2, 3]);
    // ⭐ THE DIAGNOSTIC: a `narrator load: start` line with `data.call: 2` can no longer
    // exist. If one ever appears in a real log, G37 is back.
    expect(starts.every((e) => e.data.call === 1)).toBe(true);
  });
});

describe('a FAILED load is retried, never wedged forever', () => {
  it('nulls the memo on rejection so the next caller starts a fresh load', async () => {
    const { state, create } = controllableFactory();
    const { gate, entries } = gateWith(create, [0, 4000]);
    const first = gate.ensure('boot');
    const boom = new Error('download interrupted');
    state.rejecters[0](boom);
    await expect(first).rejects.toBe(boom);
    expect(entries.some((e) => e.message === 'narrator load: FAILED' && e.level === 'error')).toBe(true);

    const second = gate.ensure('generate');
    expect(state.constructions).toBe(2); // retried, not wedged
    state.resolvers[1](narrator);
    await expect(second).resolves.toBe(narrator);
    expect(gate.isReady()).toBe(true);
  });

  it('a caller that raced the FAILING load still sees the same rejection, not a hang', async () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const a = gate.ensure('boot');
    const b = gate.ensure('generate');
    const boom = new Error('vram exhausted');
    state.rejecters[0](boom);
    await expect(a).rejects.toBe(boom);
    await expect(b).rejects.toBe(boom);
    expect(state.constructions).toBe(1);
  });
});

describe('isReady — what M7 times the wait against', () => {
  it('is false before the load resolves and true after', async () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    expect(gate.isReady()).toBe(false);
    const a = gate.ensure('boot');
    expect(gate.isReady()).toBe(false); // in flight is NOT ready — this is the freeze window
    expect(gate.peek()).toBeNull();
    state.resolvers[0](narrator);
    await a;
    expect(gate.isReady()).toBe(true);
    expect(gate.peek()).toBe(narrator);
  });

  it('stays false after a failure', async () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const a = gate.ensure('boot');
    state.rejecters[0](new Error('no'));
    await expect(a).rejects.toThrow();
    expect(gate.isReady()).toBe(false);
  });
});

describe('the resolved line carries the device facts a log needs', () => {
  it('records ms from the injected clock, plus gpu / device / vram / index', async () => {
    const { state, create } = controllableFactory();
    const { gate, entries } = gateWith(create, [1000, 61_000]);
    const a = gate.ensure('boot');
    state.resolvers[0](narrator);
    await a;
    await Promise.resolve();
    const done = entries.find((e) => e.message === 'narrator load: done');
    expect(done).toBeDefined();
    expect(done.data).toEqual({
      call: 1,
      ms: 60_000,
      gpu: 'vulkan',
      device: 'NVIDIA RTX',
      unified: false,
      vramTotal: 8e9,
      deviceIndex: 0,
    });
  });

  it('degrades to nulls rather than throwing on a narrator with no device fields', async () => {
    const { state, create } = controllableFactory();
    const { gate, entries } = gateWith(create);
    const a = gate.ensure('boot');
    state.resolvers[0]({});
    await a;
    await Promise.resolve();
    expect(entries.find((e) => e.message === 'narrator load: done').data.gpu).toBeNull();
  });

  it('the onStatus callback is handed to the factory that actually builds the narrator', () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const cb = () => undefined;
    gate.ensure('boot', cb);
    expect(state.statuses[0]).toBe(cb);
  });
});

// =========================================================================================
// THE CONTROL. Everything above would also pass against a gate that simply never loads.
// This is G37's code, verbatim, wrapped in the same harness: it must FAIL the concurrency
// assertion. If this ever goes green, the tests above prove nothing.
// =========================================================================================

describe('the harness can actually detect the defect', () => {
  /** `main.mjs`'s old `ensureNarrator`, character for character in its essentials. */
  function brokenGate(create) {
    let narratorValue = null;
    return {
      async ensure() {
        if (!narratorValue) {
          narratorValue = await create();
        }
        return narratorValue;
      },
    };
  }

  it('the OLD implementation constructs twice under exactly the race above', async () => {
    const { state, create } = controllableFactory();
    const broken = brokenGate(create);
    const a = broken.ensure('boot');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const b = broken.ensure('generate');
    expect(state.constructions, 'the defect did not reproduce — this control is useless').toBe(2);
    state.resolvers[0](narrator);
    state.resolvers[1](narrator);
    await Promise.all([a, b]);
  });

  it('and the fixed gate, under the identical race, constructs once', async () => {
    const { state, create } = controllableFactory();
    const { gate } = gateWith(create);
    const a = gate.ensure('boot');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const b = gate.ensure('generate');
    expect(state.constructions).toBe(1);
    state.resolvers[0](narrator);
    await Promise.all([a, b]);
  });
});
