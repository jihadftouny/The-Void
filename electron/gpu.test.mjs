import { describe, it, expect } from 'vitest';
import { pickDedicatedDeviceIndex, selectBestLlama } from './gpu.mjs';

// ---------------------------------------------------------------------------
// Pure decision function. Every expected value is derived by hand from the spec
// ("return the FIRST probe whose `unified` is false, else null; the returned
// value is the probe's `index` field, not its array position").
// ---------------------------------------------------------------------------
describe('pickDedicatedDeviceIndex', () => {
  it('returns null for an empty probe list', () => {
    expect(pickDedicatedDeviceIndex([])).toBe(null);
  });

  it('returns null when every device is unified/integrated', () => {
    expect(
      pickDedicatedDeviceIndex([
        { index: 0, unified: true },
        { index: 1, unified: true },
      ]),
    ).toBe(null);
  });

  it('returns the index of the single dedicated device (second slot)', () => {
    expect(
      pickDedicatedDeviceIndex([
        { index: 0, unified: true },
        { index: 1, unified: false },
      ]),
    ).toBe(1);
  });

  it('returns the index of the single dedicated device (first slot)', () => {
    expect(
      pickDedicatedDeviceIndex([
        { index: 0, unified: false },
        { index: 1, unified: true },
      ]),
    ).toBe(0);
  });

  it('returns the FIRST dedicated device when several are dedicated (guards a reversed scan)', () => {
    expect(
      pickDedicatedDeviceIndex([
        { index: 0, unified: true },
        { index: 1, unified: false },
        { index: 2, unified: false },
      ]),
    ).toBe(1);
  });

  it('returns the probe.index FIELD, not the array position', () => {
    // Single probe whose index is 3 but whose array position is 0. A "mirrored
    // world" that returned the position would answer 0 and fail here.
    expect(pickDedicatedDeviceIndex([{ index: 3, unified: false }])).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator, driven by a fake `getLlama`. We assert the SELECTION / branch /
// side-effects (which are the spec) — never the pass-through backend string or
// VRAM byte counts, which the fake supplies.
// ---------------------------------------------------------------------------

// Build a fake getLlama + env. `auto` describes the llama returned for
// getLlama({gpu:'auto'}); `devices[i]` describes the llama returned for a
// getLlama({gpu:'vulkan'}) probe while env.GGML_VK_VISIBLE_DEVICES === String(i).
function makeHarness({ auto, devices = [] }) {
  const env = {};
  const calls = { byGpu: [] };
  const created = [];

  function makeLlama({ gpu, vram, names }) {
    const llama = {
      gpu,
      disposed: false,
      async getVramState() {
        return vram;
      },
      async getGpuDeviceNames() {
        return names;
      },
      async dispose() {
        llama.disposed = true;
      },
    };
    created.push(llama);
    return llama;
  }

  async function getLlama({ gpu } = {}) {
    calls.byGpu.push(gpu);
    if (gpu === 'auto') {
      return makeLlama({ gpu: auto.gpu, vram: auto.vram, names: auto.names ?? [] });
    }
    if (gpu === 'vulkan') {
      const i = Number(env.GGML_VK_VISIBLE_DEVICES);
      const d = devices[i];
      if (d?.throws) throw new Error(`probe failed for device ${i}`);
      return makeLlama({ gpu: 'vulkan', vram: d.vram, names: [d.name] });
    }
    throw new Error(`unexpected gpu arg: ${gpu}`);
  }

  const vulkanCalls = () => calls.byGpu.filter((g) => g === 'vulkan').length;
  const disposedCount = () => created.filter((l) => l.disposed).length;
  return { getLlama, env, calls, created, vulkanCalls, disposedCount };
}

const ENV_KEY = 'GGML_VK_VISIBLE_DEVICES';

describe('selectBestLlama', () => {
  it('CPU path: no GPU backend → CPU result, no probing, env untouched', async () => {
    const h = makeHarness({ auto: { gpu: false } });
    const res = await selectBestLlama({ getLlama: h.getLlama, env: h.env });

    expect(res.backend).toBe(false);
    expect(res.llama).toBe(h.created[0]); // the auto llama, unchanged
    expect(res.deviceIndex).toBe(null);
    expect(h.vulkanCalls()).toBe(0); // never probed
    expect(ENV_KEY in h.env).toBe(false); // env untouched
    expect(h.disposedCount()).toBe(0);
  });

  it('dedicated auto-pick: unifiedSize 0 → keep auto llama, no probing, no extra instances', async () => {
    const h = makeHarness({
      auto: {
        gpu: 'cuda',
        vram: { total: 8e9, used: 0, free: 8e9, unifiedSize: 0 },
        names: ['NVIDIA GeForce RTX'],
      },
    });
    const res = await selectBestLlama({ getLlama: h.getLlama, env: h.env });

    expect(res.llama).toBe(h.created[0]);
    expect(res.deviceIndex).toBe(null);
    expect(res.unified).toBe(false);
    expect(res.deviceName).toBe('NVIDIA GeForce RTX');
    expect(h.vulkanCalls()).toBe(0);
    expect(h.created.length).toBe(1); // no extra llama instances created
    expect(ENV_KEY in h.env).toBe(false);
  });

  it('single unified device: length <= 1 → keep auto llama as unified', async () => {
    const h = makeHarness({
      auto: {
        gpu: 'metal',
        vram: { total: 0, used: 0, free: 0, unifiedSize: 32e9 },
        names: ['Apple M-series'],
      },
    });
    const res = await selectBestLlama({ getLlama: h.getLlama, env: h.env });

    expect(res.llama).toBe(h.created[0]);
    expect(res.unified).toBe(true);
    expect(res.deviceIndex).toBe(null);
    expect(res.deviceName).toBe('Apple M-series');
    expect(h.vulkanCalls()).toBe(0);
    expect(h.created.length).toBe(1);
  });

  it('hybrid, probe finds dedicated: picks device 1, pins env, disposes auto + loser', async () => {
    const h = makeHarness({
      auto: {
        gpu: 'vulkan',
        vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 },
        names: ['Intel Iris', 'NVIDIA GeForce'],
      },
      devices: [
        { vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 }, name: 'Intel Iris' }, // integrated
        { vram: { total: 8e9, used: 0, free: 8e9, unifiedSize: 0 }, name: 'NVIDIA GeForce' }, // dedicated
      ],
    });
    const res = await selectBestLlama({ getLlama: h.getLlama, env: h.env });

    expect(res.deviceIndex).toBe(1);
    expect(res.unified).toBe(false);
    expect(res.deviceName).toBe('NVIDIA GeForce');
    expect(h.env[ENV_KEY]).toBe('1'); // env pinned to the winner for the process
    expect(h.vulkanCalls()).toBe(2); // both devices probed

    // created: [auto, probe0, probe1]. Winner (probe1) survives; auto + probe0 disposed.
    const [auto, probe0, probe1] = h.created;
    expect(res.llama).toBe(probe1);
    expect(auto.disposed).toBe(true);
    expect(probe0.disposed).toBe(true);
    expect(probe1.disposed).toBe(false);
    expect(h.disposedCount()).toBe(2);
  });

  it('hybrid, none dedicated: falls back to auto llama, clears env, disposes probes', async () => {
    const h = makeHarness({
      auto: {
        gpu: 'vulkan',
        vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 },
        names: ['Intel Iris', 'AMD Radeon iGPU'],
      },
      devices: [
        { vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 }, name: 'Intel Iris' },
        { vram: { total: 12e9, used: 0, free: 12e9, unifiedSize: 12e9 }, name: 'AMD Radeon iGPU' },
      ],
    });
    const res = await selectBestLlama({ getLlama: h.getLlama, env: h.env });

    const [auto, probe0, probe1] = h.created;
    expect(res.llama).toBe(auto);
    expect(res.unified).toBe(true);
    expect(res.deviceIndex).toBe(null);
    expect(ENV_KEY in h.env).toBe(false); // env var removed
    expect(auto.disposed).toBe(false); // the returned llama survives
    expect(probe0.disposed).toBe(true);
    expect(probe1.disposed).toBe(true);
    expect(h.disposedCount()).toBe(2);
  });

  it('probe throws: swallowed, env cleared, auto llama returned without crashing', async () => {
    const h = makeHarness({
      auto: {
        gpu: 'vulkan',
        vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 },
        names: ['Intel Iris', 'NVIDIA GeForce'],
      },
      devices: [
        { vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 }, name: 'Intel Iris' },
        { throws: true }, // probing device 1 rejects
      ],
    });
    const res = await selectBestLlama({ getLlama: h.getLlama, env: h.env });

    const [auto, probe0] = h.created; // probe1 never constructed (getLlama threw)
    expect(res.llama).toBe(auto);
    expect(res.unified).toBe(true);
    expect(ENV_KEY in h.env).toBe(false); // env cleared after the failure
    expect(auto.disposed).toBe(false);
    expect(probe0.disposed).toBe(true); // the one probe built before the throw is cleaned up
  });

  it('records probe results through the injected log sink', async () => {
    const events = [];
    const h = makeHarness({
      auto: {
        gpu: 'vulkan',
        vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 },
        names: ['Intel Iris', 'NVIDIA GeForce'],
      },
      devices: [
        { vram: { total: 16e9, used: 0, free: 16e9, unifiedSize: 16e9 }, name: 'Intel Iris' },
        { vram: { total: 8e9, used: 0, free: 8e9, unifiedSize: 0 }, name: 'NVIDIA GeForce' },
      ],
    });
    await selectBestLlama({ getLlama: h.getLlama, env: h.env, log: (e) => events.push(e) });

    expect(events.some((e) => e.event === 'probe' && e.index === 0 && e.unified === true)).toBe(true);
    expect(events.some((e) => e.event === 'probe' && e.index === 1 && e.unified === false)).toBe(true);
    expect(events.some((e) => e.event === 'selected' && e.deviceIndex === 1)).toBe(true);
  });
});
