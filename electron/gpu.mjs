// Device-agnostic GPU selection for the local model.
//
// node-llama-cpp's `getLlama({gpu:'auto'})` favors the device reporting the most
// memory. On a hybrid laptop (integrated + discrete GPU) the integrated GPU wins
// because it reports a large *shared/unified* system-memory pool, even though the
// discrete card is far faster. This module adds a vendor-agnostic selection step:
// probe each visible device and prefer one with *dedicated* (non-unified) memory.
//
// No hardcoded vendor / model / device index. Graceful fallback on every hardware
// shape (single-GPU, Apple unified, integrated-only, CPU-only). The pure decision
// (`pickDedicatedDeviceIndex`) and the injectable orchestrator (`selectBestLlama`)
// are both testable headlessly with a fake `getLlama` — no native inference.

/**
 * Pure decision: given per-device probes `[{index, unified}]`, return the FIRST
 * probe whose memory is dedicated (`unified === false`), else `null`.
 * "Dedicated" (a real discrete GPU with its own VRAM) is what we want to run on.
 * No I/O, no env, no llama — this is the mandated pure, unit-tested unit.
 * @param {{index:number, unified:boolean}[]} probes
 * @returns {number|null} the winning probe's `index` field, or `null`.
 */
export function pickDedicatedDeviceIndex(probes) {
  for (const p of probes) {
    if (p.unified === false) return p.index;
  }
  return null;
}

/** Dispose a llama instance without ever throwing (best-effort cleanup). */
async function safeDispose(llama) {
  try {
    await llama?.dispose?.();
  } catch {
    /* disposal must never crash selection */
  }
}

const ENV_KEY = 'GGML_VK_VISIBLE_DEVICES';

/**
 * Choose the best backend/device and return a loaded `llama` plus metadata.
 *
 * Algorithm (see plan): get an auto llama; if it's CPU, done. If its VRAM is
 * already dedicated (`unifiedSize === 0`, e.g. CUDA / desktop dGPU) keep it. If
 * there's only one device (Apple unified / integrated-only) keep it. Otherwise
 * probe each Vulkan device via `GGML_VK_VISIBLE_DEVICES` and prefer a dedicated
 * one; on a winning discrete probe leave the env var pinned to it for the process
 * lifetime (the loaded backend is bound to that device); otherwise unset it and
 * fall back to the auto llama. Every probe path is wrapped so we ALWAYS return a
 * working llama and never crash; discarded llama instances are disposed.
 *
 * `getLlama` and `env` are injected so this is testable headlessly with a fake.
 * `log?.(entry)` records probe/selection results (optional; defaults to no-op).
 *
 * @param {{ getLlama: Function, env?: Record<string,string|undefined>, log?: Function }} opts
 * @returns {Promise<{ llama:any, backend:(string|boolean), unified:boolean,
 *   deviceIndex:(number|null), deviceName:(string|null), vram:(object|null) }>}
 */
export async function selectBestLlama({ getLlama, env = process.env, log } = {}) {
  const llama0 = await getLlama({ gpu: 'auto' });

  // CPU: no GPU backend at all — nothing to probe.
  if (llama0.gpu === false) {
    log?.({ event: 'cpu', backend: false });
    return { llama: llama0, backend: false, unified: false, deviceIndex: null, deviceName: null, vram: null };
  }

  const probes = [];
  try {
    const vram0 = await llama0.getVramState();

    // Already on a dedicated device (CUDA / desktop dGPU): the auto-pick is right.
    if (vram0.unifiedSize === 0) {
      const deviceName = (await llama0.getGpuDeviceNames())[0] ?? null;
      log?.({ event: 'auto-dedicated', backend: llama0.gpu, deviceName, vram: vram0 });
      return { llama: llama0, backend: llama0.gpu, unified: false, deviceIndex: null, deviceName, vram: vram0 };
    }

    // Only one device (Apple unified memory / integrated-only): nothing better.
    const names = await llama0.getGpuDeviceNames();
    if (names.length <= 1) {
      const deviceName = names[0] ?? null;
      log?.({ event: 'single-unified', backend: llama0.gpu, deviceName, vram: vram0 });
      return { llama: llama0, backend: llama0.gpu, unified: true, deviceIndex: null, deviceName, vram: vram0 };
    }

    // Hybrid: probe every visible device, isolating each via the env var.
    for (let i = 0; i < names.length; i++) {
      env[ENV_KEY] = String(i);
      const li = await getLlama({ gpu: 'vulkan' });
      const vram = await li.getVramState();
      const name = (await li.getGpuDeviceNames())[0] ?? null;
      const probe = { index: i, unified: vram.unifiedSize > 0, llama: li, vram, name };
      probes.push(probe);
      log?.({ event: 'probe', index: i, unified: probe.unified, deviceName: name, vram });
    }

    const pick = pickDedicatedDeviceIndex(probes.map((p) => ({ index: p.index, unified: p.unified })));

    if (pick !== null) {
      const winner = probes.find((p) => p.index === pick);
      // Keep the winner; dispose every other probe AND the discarded auto llama.
      for (const p of probes) if (p !== winner) await safeDispose(p.llama);
      await safeDispose(llama0);
      // Leave the env var pinned to the winner for the process lifetime — the
      // loaded Vulkan backend is bound to that device.
      env[ENV_KEY] = String(pick);
      log?.({ event: 'selected', backend: winner.llama.gpu, deviceName: winner.name, deviceIndex: pick, vram: winner.vram });
      return { llama: winner.llama, backend: winner.llama.gpu, unified: false, deviceIndex: pick, deviceName: winner.name, vram: winner.vram };
    }

    // No dedicated device found: fall back to the auto llama, unset the env var.
    for (const p of probes) await safeDispose(p.llama);
    delete env[ENV_KEY];
    const deviceName = names[0] ?? null;
    log?.({ event: 'fallback-none-dedicated', backend: llama0.gpu, deviceName, vram: vram0 });
    return { llama: llama0, backend: llama0.gpu, unified: true, deviceIndex: null, deviceName, vram: vram0 };
  } catch (err) {
    // Anything went wrong while probing: clean up, unset env, return the auto
    // llama so the game still runs.
    for (const p of probes) await safeDispose(p.llama);
    delete env[ENV_KEY];
    log?.({ event: 'error', message: String(err?.message ?? err) });
    return { llama: llama0, backend: llama0.gpu, unified: true, deviceIndex: null, deviceName: null, vram: null };
  }
}
