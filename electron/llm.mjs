// Main-process narrator service — the ONLY place node-llama-cpp runs.
// (node-llama-cpp crashes if used from a renderer process.)
//
// Wraps the local Qwen3-4B model behind a tiny streaming interface. This is the
// N1 shell's inference layer; the pure, framework-agnostic `src/llm` runtime
// (prompt assembly, grammar-constrained output, fake-model tests) is N2 — this
// file stays deliberately thin.
import { getLlama, resolveModelFile, LlamaChatSession } from 'node-llama-cpp';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectGpuDevice, makeSpawnProbe } from './gpu.mjs';

// 4B only (the N1 decision). Q4_K_M GGUF, Apache-2.0, ~2.5GB.
const MODEL_URI =
  'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf';

const DEFAULT_SYSTEM =
  'You are the Void — the narrator of a dark, dreamlike descent RPG about ' +
  'psychosis and survival. Write vivid, terse second-person narration. ' +
  'Atmospheric, unsettling, concrete. Never break character.';

/**
 * Load the model once and return a narrator with a streaming `generate`.
 * `onStatus({phase, ...})` reports progress: resolving → loading → ready | error.
 * `modelsDir` is the canonical per-user models directory (computed by main and
 * injected here so this layer stays free of any electron/app import); it is
 * passed to `resolveModelFile` as the download/lookup target.
 */
export async function createNarrator({ onStatus, modelsDir } = {}) {
  onStatus?.({ phase: 'resolving', modelsDir });
  const modelPath = await resolveModelFile(MODEL_URI, modelsDir);

  // Device-agnostic pick: prefer the discrete GPU over the integrated one on hybrid
  // laptops. Selection runs in short-lived child probes and sets
  // GGML_VK_VISIBLE_DEVICES in this process's env BEFORE the first getLlama() below,
  // because node-llama-cpp binds the Vulkan backend once per process. Any failure
  // returns "auto-pick" (env untouched) and never crashes boot.
  const probeScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gpu-probe.mjs');
  const sel = await selectGpuDevice({
    runProbe: makeSpawnProbe({
      execPath: process.execPath,
      probeScript,
      baseEnv: process.env,
      timeoutMs: 30000,
    }),
    env: process.env,
    systemRam: os.totalmem(),
    log: (e) => onStatus?.({ phase: 'gpu-probe', ...e }),
  });

  onStatus?.({ phase: 'loading', modelPath });
  // env already isolates the pinned device (if any); auto otherwise.
  const llama = await getLlama(sel.gpu ? { gpu: sel.gpu } : {});
  const vram = await llama.getVramState().catch(() => null);
  const unified = vram ? vram.unifiedSize > 0 : false;

  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 4096 });
  onStatus?.({
    phase: 'ready',
    gpu: llama.gpu,
    device: sel.name,
    unified,
    vram,
    deviceIndex: sel.index,
  });

  return {
    gpu: llama.gpu,
    device: sel.name,
    unified,
    vram,
    deviceIndex: sel.index,
    async generate({ prompt, system, maxTokens = 400, onToken } = {}) {
      // Capture the sequence so we can reclaim it: the context has a finite pool
      // of sequences, and disposing only the session (as before) leaked one per
      // call — after the pool drained, node-llama-cpp threw "No sequences left".
      const sequence = context.getSequence();
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: system ?? DEFAULT_SYSTEM,
      });
      try {
        let firstMs = null;
        const t0 = performance.now();
        const text = await session.prompt(prompt, {
          maxTokens,
          onTextChunk(chunk) {
            if (firstMs === null) firstMs = performance.now() - t0;
            onToken?.(chunk);
          },
        });
        const total = performance.now() - t0;
        const tokens = model.tokenize(text).length;
        return {
          text,
          tokens,
          ttftMs: firstMs ?? 0,
          tokensPerSecond: (tokens / Math.max(1, total - (firstMs ?? 0))) * 1000,
        };
      } finally {
        session.dispose();
        sequence.dispose();
      }
    },
  };
}
