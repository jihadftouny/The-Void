// The sequence queue (AC-13), driven by a fake clock and hand-fired timers, under GENUINE
// concurrency: callers enter together and the test decides when each task finishes. A test that
// ran the tasks one at a time would pass against a queue that does nothing.
import { describe, it, expect, vi } from 'vitest';
import { createSequenceQueue } from './llm-queue.mjs';

function harness() {
  let t = 0;
  const timers = new Map();
  let nextId = 0;
  const queue = createSequenceQueue({
    now: () => t,
    setTimer: (fn, ms) => {
      nextId += 1;
      timers.set(nextId, { fn, ms });
      return nextId;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    queue,
    advance: (ms) => {
      t += ms;
    },
    armed: () => [...timers.values()].map((x) => x.ms),
    fireAll: () => {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** Let every queued promise reaction run. */
const flush = () => new Promise((r) => setImmediate(r));

describe('the sequence queue', () => {
  it('two callers entering together run strictly one after the other', async () => {
    const h = harness();
    const events = [];
    const a = deferred();
    const b = deferred();
    const pa = h.queue.run(async () => {
      events.push('A start');
      const v = await a.promise;
      events.push('A end');
      return v;
    });
    const pb = h.queue.run(async () => {
      events.push('B start');
      const v = await b.promise;
      events.push('B end');
      return v;
    });
    await flush();
    expect(events).toEqual(['A start']);
    b.resolve({ ok: true, who: 'B' }); // B finishing early changes nothing: it has not started
    await flush();
    expect(events).toEqual(['A start']);
    a.resolve({ ok: true, who: 'A' });
    await Promise.all([pa, pb]);
    expect(events).toEqual(['A start', 'A end', 'B start', 'B end']);
  });

  it("the second caller's queuedMs equals the first's run time", async () => {
    const h = harness();
    const a = deferred();
    const pa = h.queue.run(() => a.promise);
    const pb = h.queue.run(async ({ queuedMs }) => ({ ok: true, seenByTask: queuedMs }));
    await flush();
    h.advance(500); // the first task runs for 500 ms
    a.resolve({ ok: true });
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(ra).toEqual({ ok: true, queuedMs: 0, ranMs: 500 });
    expect(rb.queuedMs).toBe(500);
    expect(rb.seenByTask).toBe(500);
    expect(rb.ranMs).toBe(0);
  });

  it("a caller's failure rejects that caller only, and the queue moves on", async () => {
    const h = harness();
    const boom = new Error('native error');
    const pa = h.queue.run(async () => {
      throw boom;
    });
    const pb = h.queue.run(async () => ({ ok: true }));
    await expect(pa).rejects.toBe(boom);
    await expect(pb).resolves.toMatchObject({ ok: true });
    // ...and a third, after both, still runs.
    await expect(h.queue.run(async () => 'plain')).resolves.toBe('plain');
  });

  it('a deadline expiry calls abort() and resolves a timeout — it never throws', async () => {
    const h = harness();
    const abort = vi.fn();
    let signal;
    const never = deferred();
    const p = h.queue.run(
      (ctx) => {
        signal = ctx.signal;
        return never.promise;
      },
      { deadlineMs: 3000, abort },
    );
    await flush();
    expect(h.armed()).toEqual([3000]);
    h.advance(3000);
    h.fireAll();
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout', timedOut: true, queuedMs: 0, ranMs: 3000 });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
  });

  it('...but the NEXT call waits until the aborted one has really let go of the sequence', async () => {
    const h = harness();
    const stuck = deferred();
    const events = [];
    const p1 = h.queue.run(() => stuck.promise, { deadlineMs: 3000, abort: () => events.push('abort') });
    const p2 = h.queue.run(async () => {
      events.push('second start');
      return { ok: true };
    });
    await flush();
    h.fireAll();
    await p1;
    await flush();
    expect(events).toEqual(['abort']); // the caller is released; the sequence is not
    stuck.resolve({ ok: true, text: 'partial' });
    await p2;
    expect(events).toEqual(['abort', 'second start']);
  });

  it('the deadline starts at DEQUEUE: no clock runs for a call still waiting', async () => {
    const h = harness();
    const a = deferred();
    h.queue.run(() => a.promise); // a narration: no deadline
    const pb = h.queue.run(async () => ({ ok: true }), { deadlineMs: 3000 });
    await flush();
    expect(h.armed(), 'a deadline was armed for a call that has not started').toEqual([]);
    h.advance(5000);
    a.resolve({ ok: true });
    await expect(pb).resolves.toMatchObject({ ok: true, queuedMs: 5000 });
  });

  it('a task that finishes in time clears its deadline', async () => {
    const h = harness();
    await h.queue.run(async () => ({ ok: true }), { deadlineMs: 3000 });
    expect(h.armed()).toEqual([]);
  });

  it('an abort that throws still yields a clean timeout', async () => {
    const h = harness();
    const p = h.queue.run(() => new Promise(() => {}), {
      deadlineMs: 10,
      abort: () => {
        throw new Error('already disposed');
      },
    });
    await flush();
    h.fireAll();
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('depth() reports the callers waiting behind the running one', async () => {
    const h = harness();
    const a = deferred();
    const b = deferred();
    expect(h.queue.depth()).toBe(0);
    const pa = h.queue.run(() => a.promise);
    const pb = h.queue.run(() => b.promise);
    const pc = h.queue.run(async () => 'c');
    await flush();
    expect(h.queue.depth()).toBe(2);
    expect(h.queue.busy()).toBe(true);
    a.resolve('a');
    await pa;
    await flush();
    expect(h.queue.depth()).toBe(1);
    b.resolve('b');
    await Promise.all([pb, pc]);
    expect(h.queue.depth()).toBe(0);
    expect(h.queue.busy()).toBe(false);
  });

  it('a non-object value is returned untouched (a narration result keeps its own shape)', async () => {
    const h = harness();
    await expect(h.queue.run(async () => 'text')).resolves.toBe('text');
    await expect(h.queue.run(async () => [1, 2])).resolves.toEqual([1, 2]);
  });
});
