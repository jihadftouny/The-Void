// Short-lived child probe for GPU selection. Runs under ELECTRON_RUN_AS_NODE=1
// (the Electron binary as plain Node — no second window). node-llama-cpp inits the
// Vulkan backend ONCE per process, so isolating a device requires a fresh process
// with GGML_VK_VISIBLE_DEVICES already set BEFORE getLlama(). The parent
// (electron/gpu.mjs → makeSpawnProbe) spawns one of these per device index, and one
// un-isolated to enumerate all names.
//
// Prints `{names, vram}` JSON to stdout and exits 0; on error prints the message to
// stderr and exits 1 (the parent treats a non-zero exit as "probe unavailable").
import { getLlama } from 'node-llama-cpp';

try {
  const llama = await getLlama({ gpu: 'vulkan' });
  process.stdout.write(
    JSON.stringify({
      names: await llama.getGpuDeviceNames(),
      vram: await llama.getVramState(),
    }),
  );
  process.exit(0);
} catch (e) {
  process.stderr.write(String(e?.message ?? e));
  process.exit(1);
}
