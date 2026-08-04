import { describe, it, expect } from 'vitest';
import {
  scoreDevice,
  pickBestDeviceIndex,
  selectGpuDevice,
  makeSpawnProbe,
  ENV_KEY,
} from './gpu.mjs';

// ---------------------------------------------------------------------------
// Pure scorer / picker. Every expected value is derived BY HAND from the scoring
// spec (name: +3 discrete hint, -2 integrated hint; memory: +2 when 0 < total <
// 0.85 * systemRam; qualify iff score >= 1; return probe.index of the highest
// qualifier, ties to lowest index; <2 devices or no qualifier → null).
// ---------------------------------------------------------------------------
describe('scoreDevice (transparency checks)', () => {
  it('#13 NVIDIA GeForce RTX 5060 (8.3GB) vs 25GB RAM → +3 name +2 mem = 5', () => {
    // 8.3e9 < 0.85 * 25e9 (=21.25e9) → mem +2; name matches nvidia/geforce/rtx → +3.
    expect(scoreDevice({ index: 0, name: 'NVIDIA GeForce RTX 5060', total: 8.3e9 }, 25e9)).toBe(5);
  });

  it('#14 Intel UHD Graphics (25.3GB) vs 25GB RAM → -2 name, 0 mem = -2', () => {
    // 25.3e9 is NOT < 21.25e9 → mem 0; name matches intel/uhd/graphics → -2.
    expect(scoreDevice({ index: 0, name: 'Intel(R) UHD Graphics', total: 25.3e9 }, 25e9)).toBe(-2);
  });

  it('unknown-vendor card small pool → +2 on memory alone', () => {
    // No name hint (0); 8e9 < 0.85 * 32e9 (=27.2e9) → +2.
    expect(scoreDevice({ index: 1, name: 'Moore Threads Accelerator', total: 8e9 }, 32e9)).toBe(2);
  });

  it('Intel Arc dGPU: integrated -2 + discrete +3 both fire, plus mem +2 = +3', () => {
    // "intel"/"graphics"? no "graphics" here → -2 for intel; "arc" → +3; 16e9 <
    // 0.85 * 32e9 (=27.2e9) → +2. Total -2 + 3 + 2 = 3.
    expect(scoreDevice({ index: 1, name: 'Intel(R) Arc(TM) A770', total: 16e9 }, 32e9)).toBe(3);
  });

  it('non-finite / zero memory contributes 0 (name only)', () => {
    expect(scoreDevice({ index: 0, name: 'NVIDIA RTX', total: 0 }, 25e9)).toBe(3);
    expect(scoreDevice({ index: 0, name: 'NVIDIA RTX', total: NaN }, 25e9)).toBe(3);
    expect(scoreDevice({ index: 0, name: 'NVIDIA RTX', total: 8e9 }, 0)).toBe(3); // ram 0 → no mem signal
  });
});

describe('pickBestDeviceIndex', () => {
  it('#1 empty array → null (length < 2)', () => {
    expect(pickBestDeviceIndex([], 25e9)).toBe(null);
  });

  it('#2 non-array inputs → null', () => {
    expect(pickBestDeviceIndex(null, 25e9)).toBe(null);
    expect(pickBestDeviceIndex(undefined, 25e9)).toBe(null);
    expect(pickBestDeviceIndex('garbage', 25e9)).toBe(null);
  });

  it('#3 single device → null (never pin a single-device / CPU machine)', () => {
    expect(pickBestDeviceIndex([{ index: 0, name: 'NVIDIA RTX', total: 8e9 }], 25e9)).toBe(null);
  });

  it('#4 REAL hardware: Intel iGPU vs NVIDIA RTX 5060 → picks 1', () => {
    // Intel: -2 (name), 25.3e9 not < 21.25e9 → mem 0 → -2. NVIDIA: +3 +2 = +5. → 1.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel(R) UHD Graphics', total: 25.3e9 },
          { index: 1, name: 'NVIDIA GeForce RTX 5060', total: 8.3e9 },
        ],
        25e9,
      ),
    ).toBe(1);
  });

  it('#5 two integrated devices → null (both -2 < 1)', () => {
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel Iris Graphics', total: 25e9 },
          { index: 1, name: 'AMD Radeon Graphics', total: 25e9 },
        ],
        25e9,
      ),
    ).toBe(null);
  });

  it('#6 discrete-by-name with tiny memory → picks the discrete', () => {
    // dev0 Intel Graphics: -2 (16e9 not < 13.6e9 → mem 0). dev1 NVIDIA RTX: +3, 2e9
    // < 13.6e9 → +2 = +5. → 1.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel Graphics', total: 16e9 },
          { index: 1, name: 'NVIDIA RTX', total: 2e9 },
        ],
        16e9,
      ),
    ).toBe(1);
  });

  it('#7 discrete pool LARGER than iGPU still picked on name', () => {
    // dev0 Intel UHD Graphics: -2, 16e9 not < 13.6e9 → 0 = -2. dev1 NVIDIA RTX 4090:
    // +3, 24e9 not < 13.6e9 → 0 = +3. → 1.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel UHD Graphics', total: 16e9 },
          { index: 1, name: 'NVIDIA RTX 4090', total: 24e9 },
        ],
        16e9,
      ),
    ).toBe(1);
  });

  it('#8 Intel Arc dGPU vs Intel iGPU → picks the Arc', () => {
    // dev0 Intel UHD Graphics: -2, 32e9 not < 27.2e9 → 0 = -2. dev1 Intel Arc A770:
    // -2 (intel) +3 (arc), 16e9 < 27.2e9 → +2 = +3. → 1.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel UHD Graphics', total: 32e9 },
          { index: 1, name: 'Intel(R) Arc(TM) A770', total: 16e9 },
        ],
        32e9,
      ),
    ).toBe(1);
  });

  it('#9 unknown-vendor discrete qualifies on memory alone', () => {
    // dev0 Intel Graphics: -2. dev1 Moore Threads: name 0, 8e9 < 27.2e9 → +2 = +2. → 1.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel Graphics', total: 32e9 },
          { index: 1, name: 'Moore Threads Accelerator', total: 8e9 },
        ],
        32e9,
      ),
    ).toBe(1);
  });

  it('#10 false-memory integrated guard: both -2 + 2 = 0 < 1 → null', () => {
    // Each integrated device has a small pool (10e9 < 0.85*25e9=21.25e9 → +2) but the
    // -2 name penalty cancels it (0 < 1), so neither qualifies.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel Graphics', total: 10e9 },
          { index: 1, name: 'AMD Radeon Graphics', total: 10e9 },
        ],
        25e9,
      ),
    ).toBe(null);
  });

  it('#11 tie-break resolves to the lowest index', () => {
    // Both NVIDIA RTX: +3, 20e9 not < 13.6e9 → 0 = +3. Tie → lowest index 0.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'NVIDIA RTX A', total: 20e9 },
          { index: 1, name: 'NVIDIA RTX B', total: 20e9 },
        ],
        16e9,
      ),
    ).toBe(0);
  });

  it('#12 returns the probe.index FIELD, not the array position', () => {
    // Array position of the NVIDIA is 1, but its index field is 5.
    expect(
      pickBestDeviceIndex(
        [
          { index: 0, name: 'Intel Graphics', total: 25e9 },
          { index: 5, name: 'NVIDIA RTX', total: 8e9 },
        ],
        25e9,
      ),
    ).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator, driven by a fabricated `runProbe`. `runProbe(undefined)` enumerates
// all names; `runProbe(i)` returns a per-device probe. We assert the SELECTION,
// branch, env side-effects, and probe-call count — the spec, never native behaviour.
// ---------------------------------------------------------------------------

// Build a fake runProbe. `enum` is returned for runProbe(undefined) (or null/throw
// via flags); `perDevice[i]` for runProbe(i). Records every call's argument.
function makeProbe({ enumResult, enumThrows = false, enumNull = false, perDevice = {} }) {
  const calls = [];
  async function runProbe(i) {
    calls.push(i);
    if (i === undefined) {
      if (enumThrows) throw new Error('enum probe unavailable');
      if (enumNull) return null;
      return enumResult;
    }
    return perDevice[i] ?? null;
  }
  return { runProbe, calls };
}

describe('selectGpuDevice', () => {
  it('real hybrid: pins device 1 (NVIDIA), sets env, logs gpu:selected', async () => {
    const env = {};
    const events = [];
    const { runProbe, calls } = makeProbe({
      enumResult: { names: ['Intel UHD Graphics', 'NVIDIA RTX 5060'] },
      perDevice: {
        0: { names: ['Intel UHD Graphics'], vram: { total: 25.3e9, unifiedSize: 0 } },
        1: { names: ['NVIDIA RTX 5060'], vram: { total: 8.3e9, unifiedSize: 0 } },
      },
    });
    const res = await selectGpuDevice({ runProbe, env, systemRam: 25e9, log: (e) => events.push(e) });

    expect(res).toEqual({ gpu: 'vulkan', index: 1, name: 'NVIDIA RTX 5060' });
    expect(env[ENV_KEY]).toBe('1');
    // enum + one probe per device.
    expect(calls).toEqual([undefined, 0, 1]);
    expect(events.some((e) => e.event === 'gpu:selected' && e.index === 1 && e.name === 'NVIDIA RTX 5060')).toBe(true);
  });

  it('single device: returns auto, env untouched, probes exactly once (enum only)', async () => {
    const env = {};
    const events = [];
    const { runProbe, calls } = makeProbe({ enumResult: { names: ['Intel Graphics'] } });
    const res = await selectGpuDevice({ runProbe, env, systemRam: 25e9, log: (e) => events.push(e) });

    expect(res).toEqual({ gpu: null, index: null, name: 'Intel Graphics' });
    expect(ENV_KEY in env).toBe(false);
    expect(calls).toEqual([undefined]); // no per-device probing
    expect(events.some((e) => e.event === 'gpu:auto' && e.reason === 'single-device')).toBe(true);
  });

  it('no discrete: two integrated devices → auto, env untouched, logs no-discrete', async () => {
    const env = {};
    const events = [];
    const { runProbe } = makeProbe({
      enumResult: { names: ['Intel Iris Graphics', 'AMD Radeon Graphics'] },
      perDevice: {
        0: { names: ['Intel Iris Graphics'], vram: { total: 25e9 } },
        1: { names: ['AMD Radeon Graphics'], vram: { total: 25e9 } },
      },
    });
    const res = await selectGpuDevice({ runProbe, env, systemRam: 25e9, log: (e) => events.push(e) });

    expect(res).toEqual({ gpu: null, index: null, name: null });
    expect(ENV_KEY in env).toBe(false);
    expect(events.some((e) => e.event === 'gpu:auto' && e.reason === 'no-discrete')).toBe(true);
  });

  it('enum returns null (probe unavailable) → treated as no devices → auto, no throw', async () => {
    const env = {};
    const { runProbe } = makeProbe({ enumNull: true });
    const res = await selectGpuDevice({ runProbe, env, systemRam: 25e9 });

    expect(res).toEqual({ gpu: null, index: null, name: null });
    expect(ENV_KEY in env).toBe(false);
  });

  it('enum throws → caught, auto returned, env untouched, logs error, no throw', async () => {
    const env = {};
    const events = [];
    const { runProbe } = makeProbe({ enumThrows: true });
    const res = await selectGpuDevice({ runProbe, env, systemRam: 25e9, log: (e) => events.push(e) });

    expect(res).toEqual({ gpu: null, index: null, name: null });
    expect(ENV_KEY in env).toBe(false);
    expect(events.some((e) => e.event === 'gpu:auto' && e.reason === 'error')).toBe(true);
  });

  it('per-device probe null for one index: name falls back to enum, total 0, still selects the qualifier', async () => {
    const env = {};
    // dev0 probe fails → name from enum ('Intel UHD Graphics'), total 0 → -2. dev1
    // probe fine → NVIDIA +3, 8e9 < 21.25e9 → +2 = +5. Should still pick 1.
    const { runProbe } = makeProbe({
      enumResult: { names: ['Intel UHD Graphics', 'NVIDIA RTX 5060'] },
      perDevice: {
        0: null,
        1: { names: ['NVIDIA RTX 5060'], vram: { total: 8e9 } },
      },
    });
    const res = await selectGpuDevice({ runProbe, env, systemRam: 25e9 });

    expect(res).toEqual({ gpu: 'vulkan', index: 1, name: 'NVIDIA RTX 5060' });
    expect(env[ENV_KEY]).toBe('1');
  });

  it('already-set env is left unset when result is auto (no-discrete does not pin)', async () => {
    // Starting with a stale value; a no-discrete result must NOT write a new pin.
    // (selectGpuDevice only ever ADDS the key on a real pick; it never mutates on
    // auto — so a stale value would remain, which is why the caller passes a fresh
    // process.env. Here we assert the auto path writes nothing.)
    const env = {};
    const { runProbe } = makeProbe({
      enumResult: { names: ['Intel Iris Graphics', 'AMD Radeon Graphics'] },
      perDevice: {
        0: { names: ['Intel Iris Graphics'], vram: { total: 25e9 } },
        1: { names: ['AMD Radeon Graphics'], vram: { total: 25e9 } },
      },
    });
    await selectGpuDevice({ runProbe, env, systemRam: 25e9 });
    expect(ENV_KEY in env).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeSpawnProbe: exercise the child-process seam with an injected fake spawn (no
// real process). We assert env isolation (GGML_VK_VISIBLE_DEVICES / ELECTRON_RUN_AS_NODE),
// JSON parsing tolerant of noise, and that every failure resolves to null (never rejects).
// ---------------------------------------------------------------------------

// A minimal fake child: an EventEmitter-ish object with a stdout stream. `script`
// drives what it emits after construction.
function makeFakeChild() {
  const handlers = {};
  const stdoutHandlers = {};
  const child = {
    killed: false,
    stdout: {
      on(ev, cb) {
        stdoutHandlers[ev] = cb;
        return child.stdout;
      },
    },
    stderr: { on() {} },
    on(ev, cb) {
      handlers[ev] = cb;
      return child;
    },
    kill() {
      child.killed = true;
    },
  };
  return {
    child,
    emitStdout: (s) => stdoutHandlers.data?.(s),
    emitClose: (code) => handlers.close?.(code),
    emitError: (e) => handlers.error?.(e),
  };
}

describe('makeSpawnProbe', () => {
  it('isolates a device via GGML_VK_VISIBLE_DEVICES and parses stdout JSON', async () => {
    let seenEnv = null;
    let seenArgs = null;
    const fake = makeFakeChild();
    const spawnFn = (execPath, args, opts) => {
      seenArgs = { execPath, args };
      seenEnv = opts.env;
      return fake.child;
    };
    const runProbe = makeSpawnProbe({
      execPath: '/path/electron',
      probeScript: '/path/gpu-probe.mjs',
      baseEnv: { PATH: '/bin' },
      spawnFn,
    });

    const p = runProbe(1);
    fake.emitStdout('{"names":["NVIDIA RTX"],"vram":{"total":8000000000}}');
    fake.emitClose(0);
    const result = await p;

    expect(result).toEqual({ names: ['NVIDIA RTX'], vram: { total: 8000000000 } });
    expect(seenArgs).toEqual({ execPath: '/path/electron', args: ['/path/gpu-probe.mjs'] });
    expect(seenEnv.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(seenEnv[ENV_KEY]).toBe('1'); // isolated to device 1
    expect(seenEnv.PATH).toBe('/bin'); // base env preserved
  });

  it('enumeration call (index undefined) removes GGML_VK_VISIBLE_DEVICES', async () => {
    let seenEnv = null;
    const fake = makeFakeChild();
    const spawnFn = (execPath, args, opts) => {
      seenEnv = opts.env;
      return fake.child;
    };
    const runProbe = makeSpawnProbe({
      execPath: 'e',
      probeScript: 's',
      baseEnv: { [ENV_KEY]: '3', OTHER: 'x' }, // stale pin present in base env
      spawnFn,
    });

    const p = runProbe(undefined);
    fake.emitStdout('{"names":["A","B"]}');
    fake.emitClose(0);
    await p;

    expect(ENV_KEY in seenEnv).toBe(false); // stale pin stripped for enumeration
    expect(seenEnv.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('tolerates leading/trailing noise around the JSON object', async () => {
    const fake = makeFakeChild();
    const runProbe = makeSpawnProbe({ execPath: 'e', probeScript: 's', spawnFn: () => fake.child });
    const p = runProbe(0);
    fake.emitStdout('ggml_vulkan: found 2 devices\n{"names":["X"],"vram":{"total":5}}\ntrailing');
    fake.emitClose(0);
    expect(await p).toEqual({ names: ['X'], vram: { total: 5 } });
  });

  it('non-zero exit resolves to null (never rejects)', async () => {
    const fake = makeFakeChild();
    const runProbe = makeSpawnProbe({ execPath: 'e', probeScript: 's', spawnFn: () => fake.child });
    const p = runProbe(0);
    fake.emitStdout('some error text');
    fake.emitClose(1);
    expect(await p).toBe(null);
  });

  it('spawn error resolves to null', async () => {
    const fake = makeFakeChild();
    const runProbe = makeSpawnProbe({ execPath: 'e', probeScript: 's', spawnFn: () => fake.child });
    const p = runProbe(0);
    fake.emitError(new Error('ENOENT'));
    expect(await p).toBe(null);
  });

  it('timeout kills the child and resolves to null', async () => {
    const fake = makeFakeChild();
    const runProbe = makeSpawnProbe({
      execPath: 'e',
      probeScript: 's',
      timeoutMs: 5,
      spawnFn: () => fake.child,
    });
    const result = await runProbe(0); // never emits close → timer fires
    expect(result).toBe(null);
    expect(fake.child.killed).toBe(true);
  });

  it('spawn throwing synchronously resolves to null', async () => {
    const runProbe = makeSpawnProbe({
      execPath: 'e',
      probeScript: 's',
      spawnFn: () => {
        throw new Error('spawn failed');
      },
    });
    expect(await runProbe(0)).toBe(null);
  });
});
