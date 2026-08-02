// Main-process narrator service — the ONLY place node-llama-cpp runs.
// (node-llama-cpp crashes if used from a renderer process.)
//
// Wraps the local Qwen3-4B model behind a tiny streaming interface. This is the
// N1 shell's inference layer; the pure, framework-agnostic `src/llm` runtime
// (prompt assembly, grammar-constrained output, fake-model tests) is N2 — this
// file stays deliberately thin.
import { getLlama, resolveModelFile, LlamaChatSession } from 'node-llama-cpp';
import { performance } from 'node:perf_hooks';

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
 */
export async function createNarrator({ onStatus } = {}) {
  onStatus?.({ phase: 'resolving' });
  const modelPath = await resolveModelFile(MODEL_URI, 'models');

  onStatus?.({ phase: 'loading', modelPath });
  const llama = await getLlama(); // auto-detects GPU (CUDA/Vulkan/Metal), else CPU
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 4096 });
  onStatus?.({ phase: 'ready', gpu: llama.gpu });

  return {
    gpu: llama.gpu,
    async generate({ prompt, system, maxTokens = 400, onToken } = {}) {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: system ?? DEFAULT_SYSTEM,
      });
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
      session.dispose();
      return {
        text,
        tokens,
        ttftMs: firstMs ?? 0,
        tokensPerSecond: (tokens / Math.max(1, total - (firstMs ?? 0))) * 1000,
      };
    },
  };
}
