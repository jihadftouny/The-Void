// Device-agnostic GPU selection for the local model — prefer the discrete GPU.
//
// On a hybrid laptop (integrated + discrete GPU, Vulkan backend) node-llama-cpp's
// auto-pick favors the device reporting the most memory. The integrated GPU wins
// because it reports a large *shared* system-memory pool (≈ system RAM), even
// though the discrete card is far faster. Worse, both Vulkan devices report
// `unifiedSize = 0`, so the old "unified ⇒ integrated" gate is dead.
//
// This module fixes that with two reliable discrete signals — the device NAME and
// a per-device total memory pool that is meaningfully SMALLER than system RAM (a
// discrete card has its own VRAM; an iGPU reports ≈ system RAM). Because
// node-llama-cpp initializes the Vulkan backend ONCE per process, the only way to
// (a) read a per-device total and (b) actually re-pin the active device is to set
// `GGML_VK_VISIBLE_DEVICES=<i>` BEFORE the process's first `getLlama()`. So probing
// happens in short-lived CHILD processes; the parent parses their JSON, picks with
// the pure scorer, and sets the env var in its own `process.env` before the main
// process's first `getLlama()`.
//
// The pure decision (`scoreDevice` / `pickBestDeviceIndex`) and the orchestrator
// (`selectGpuDevice`, which takes an injected `runProbe`) are testable headlessly
// with fabricated probe data — no real spawn, no real GPU, no real inference.

/** Env var node-llama-cpp / ggml honors to restrict the visible Vulkan device. */
export const ENV_KEY = 'GGML_VK_VISIBLE_DEVICES';

// Vendor keyword hints (data-driven, non-exhaustive). Case-insensitive substring
// match on the device name. Extend coverage by editing these arrays, not the scorer.
export const DISCRETE_NAME_HINTS = [
  'nvidia',
  'geforce',
  'rtx',
  'quadro',
  'tesla',
  'radeon rx',
  'radeon pro',
  'arc',
  'instinct',
];
export const INTEGRATED_NAME_HINTS = [
  'intel',
  'uhd',
  'iris',
  'vega',
  'integrated',
  'graphics',
  'apple',
  'llvmpipe',
  'microsoft basic',
];

// A device whose memory pool is meaningfully smaller than system RAM has its own
// VRAM (discrete); an iGPU reports ≈ system RAM (ratio ≥ ~1).
const RAM_RATIO = 0.85;
// A device qualifies as a discrete pick iff its score is at least this. Chosen so a
// false memory boost on an integrated device (-2 + 2 = 0) never qualifies, while an
// unknown-vendor discrete card qualifies on memory alone (0 + 2 = +2).
const DISCRETE_THRESHOLD = 1;

/**
 * Pure score: higher = more likely a discrete GPU worth pinning. No I/O, env, spawn
 * or llama. Signals combine additively (see plan's pure-function contract):
 *  - +3 if the name contains ANY discrete hint
 *  - -2 if the name contains ANY integrated hint (both may fire, e.g. "Intel Arc")
 *  - +2 if `0 < total < RAM_RATIO * systemRam` (its own VRAM, not shared RAM)
 * Non-finite / ≤0 memory inputs contribute 0.
 * @param {{index:number, name:string, total:number}} probe
 * @param {number} systemRam
 * @returns {number}
 */
export function scoreDevice(probe, systemRam) {
  const name = String(probe?.name ?? '').toLowerCase();
  let score = 0;

  if (DISCRETE_NAME_HINTS.some((h) => name.includes(h))) score += 3;
  if (INTEGRATED_NAME_HINTS.some((h) => name.includes(h))) score -= 2;

  const total = Number(probe?.total);
  const ram = Number(systemRam);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(ram) && ram > 0) {
    if (total < RAM_RATIO * ram) score += 2;
  }

  return score;
}

/**
 * Pure decision: pick the discrete device index to pin, or `null` to auto-pick.
 *  - `probes` not an array, or fewer than 2 devices → `null` (never pin a
 *    single-device / CPU machine).
 *  - A device qualifies iff `scoreDevice >= DISCRETE_THRESHOLD`. No qualifier → `null`.
 *  - Else return the `probe.index` FIELD (not array position) of the highest scorer;
 *    ties broken by lowest `index` (deterministic).
 * @param {{index:number, name:string, total:number}[]} probes
 * @param {number} systemRam
 * @returns {number|null}
 */
export function pickBestDeviceIndex(probes, systemRam) {
  if (!Array.isArray(probes) || probes.length < 2) return null;

  let best = null; // { index, score }
  for (const p of probes) {
    const score = scoreDevice(p, systemRam);
    if (score < DISCRETE_THRESHOLD) continue;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && p.index < best.index)
    ) {
      best = { index: p.index, score };
    }
  }

  return best === null ? null : best.index;
}

/**
 * Orchestrate device selection with an injected `runProbe` so every branch is
 * unit-testable headlessly. Sets `env[ENV_KEY]` before the main process's first
 * `getLlama()` when a discrete device is picked; otherwise leaves the env var unset
 * (auto-pick). Never throws into boot — every failure path returns "auto-pick" and
 * logs a reason.
 *
 * `runProbe(vkIndex)`:
 *  - `runProbe(undefined)` enumerates ALL device names in one un-isolated child →
 *    `{ names: string[], vram? }` (or `null`/throw on failure).
 *  - `runProbe(i)` runs isolated (`GGML_VK_VISIBLE_DEVICES=i`) → `{ names:[name],
 *    vram:{total,...} }` for that single device (or `null` on failure).
 *
 * @param {{ runProbe: (i?:number)=>Promise<any>, env?: Record<string,string|undefined>,
 *   systemRam?: number, log?: Function }} opts
 * @returns {Promise<{ gpu:('vulkan'|null), index:(number|null), name:(string|null) }>}
 */
export async function selectGpuDevice({ runProbe, env = process.env, systemRam, log } = {}) {
  try {
    const enumResult = await runProbe(undefined);
    const names = enumResult?.names ?? [];

    // Single-device / CPU-only machine: nothing to choose between; let auto-pick.
    if (names.length < 2) {
      log?.({ event: 'gpu:auto', reason: 'single-device', count: names.length });
      return { gpu: null, index: null, name: names[0] ?? null };
    }

    // Probe each visible device in its own isolated child for a per-device total.
    const devices = [];
    for (let i = 0; i < names.length; i++) {
      const r = await runProbe(i);
      devices.push({
        index: i,
        name: r?.names?.[0] ?? names[i] ?? null,
        total: r?.vram?.total ?? 0,
      });
    }

    const idx = pickBestDeviceIndex(devices, systemRam);

    if (idx == null) {
      log?.({ event: 'gpu:auto', reason: 'no-discrete', devices });
      return { gpu: null, index: null, name: null };
    }

    const winner = devices.find((d) => d.index === idx);
    env[ENV_KEY] = String(idx);
    log?.({ event: 'gpu:selected', index: idx, name: winner?.name ?? null, total: winner?.total ?? 0 });
    return { gpu: 'vulkan', index: idx, name: winner?.name ?? null };
  } catch (err) {
    // Any failure: do NOT pin; let node-llama-cpp auto-pick, and never crash boot.
    log?.({ event: 'gpu:auto', reason: 'error', message: String(err?.message ?? err) });
    return { gpu: null, index: null, name: null };
  }
}

/**
 * Extract the first balanced `{…}` JSON span from a string that may carry leading
 * or trailing noise (native backends sometimes print to stdout). Returns the parsed
 * object, or `null` if nothing parses.
 * @param {string} text
 * @returns {any|null}
 */
function parseFirstJsonObject(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Build the real `runProbe(vkIndex)` that spawns the short-lived child probe.
 * The child is `execPath` (the Electron binary) run as plain Node via
 * `ELECTRON_RUN_AS_NODE=1`, so no second window opens in a packaged build. When
 * `vkIndex` is defined, `GGML_VK_VISIBLE_DEVICES` isolates that device; otherwise
 * the var is removed so the child enumerates all devices.
 *
 * Resolves (never rejects) to the parsed probe JSON, or `null` on non-zero exit,
 * spawn error, or timeout — so `selectGpuDevice`'s failure paths are exercised,
 * not thrown.
 *
 * @param {{ execPath:string, probeScript:string, baseEnv?:Record<string,string|undefined>,
 *   timeoutMs?:number, spawnFn?:Function }} opts
 * @returns {(vkIndex?:number)=>Promise<any|null>}
 */
export function makeSpawnProbe({ execPath, probeScript, baseEnv = process.env, timeoutMs = 30000, spawnFn } = {}) {
  return async function runProbe(vkIndex) {
    const { spawn } = spawnFn ? { spawn: spawnFn } : await import('node:child_process');

    return await new Promise((resolve) => {
      const env = { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' };
      if (vkIndex === undefined || vkIndex === null) delete env[ENV_KEY];
      else env[ENV_KEY] = String(vkIndex);

      let child;
      try {
        child = spawn(execPath, [probeScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        resolve(null);
        return;
      }

      let out = '';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch {
          /* best-effort */
        }
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      child.stdout?.on('data', (d) => {
        out += String(d);
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => {
        if (code === 0) finish(parseFirstJsonObject(out));
        else finish(null);
      });
    });
  };
}
