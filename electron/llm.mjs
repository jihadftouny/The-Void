// Main-process narrator service — the ONLY place node-llama-cpp runs.
// (node-llama-cpp crashes if used from a renderer process.)
//
// Wraps the local Qwen3-4B model behind a tiny streaming interface. This is the
// N1 shell's inference layer; the pure, framework-agnostic `src/llm` runtime
// (prompt assembly, grammar-constrained output, fake-model tests) is N2 — this
// file stays deliberately thin.
import { getLlama, resolveModelFile, LlamaChatSession } from 'node-llama-cpp';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectGpuDevice, makeSpawnProbe } from './gpu.mjs';
import { createInstrument, THRESHOLDS } from './instrument.mjs';

// 4B only (the N1 decision). Q4_K_M GGUF, Apache-2.0, ~2.5GB.
const MODEL_URI =
  'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf';

const DEFAULT_SYSTEM =
  'You are the Void — the narrator of a dark, dreamlike descent RPG about ' +
  'psychosis and survival. Write vivid, terse second-person narration. ' +
  'Atmospheric, unsettling, concrete. Never break character.';

/** The basename the model URI resolves to, so a cache hit can be told from a download. */
const MODEL_FILE = MODEL_URI.slice(MODEL_URI.lastIndexOf('/') + 1);

/**
 * Load the model once and return a narrator with a streaming `generate`.
 * `onStatus({phase, ...})` reports progress: resolving → loading → ready | error.
 * `modelsDir` is the canonical per-user models directory (computed by main and
 * injected here so this layer stays free of any electron/app import); it is
 * passed to `resolveModelFile` as the download/lookup target.
 *
 * `log` is injected for the same reason `modelsDir` is: this layer must stay free of any
 * `electron` import. It defaults to a no-op, so nothing here depends on being logged.
 *
 * WHY EVERY PHASE IS TIMED (principle 7). This file had ZERO log calls, and it owns every
 * genuinely slow thing in the product: a 2.5 GB resolve-or-download, GPU probes at a 30 s
 * timeout each, the llama bind, the model load, the context allocation, and generation
 * itself. When the engineer hit a tens-of-seconds freeze on the first enemy encounter,
 * there was no evidence at all — and a freeze IS the end line never arriving, so a start
 * line and a heartbeat are the only things that can ever produce any.
 */
export async function createNarrator({ onStatus, modelsDir, log, now, setTimer, clearTimer } = {}) {
  // Passed straight through. NOT conditionally spread: `createInstrument` destructures
  // with defaults, and a destructuring default already fires on `undefined`, so four
  // `...(x ? {x} : {})` branches would be four things that can be inverted to no purpose.
  // A branch that does not exist cannot be inverted (the lesson `renderSheet`'s chip row
  // already learned in `rendererSource.test.ts`).
  const inst = createInstrument({ log, now, setTimer, clearTimer });

  onStatus?.({ phase: 'resolving', modelsDir });
  const modelPath = await inst.run(
    'llm',
    'model resolve',
    { modelsDir },
    async (op) => {
      // Captured BEFORE the call: `existedBefore: false` is what distinguishes a ~2.5 GB
      // download from a cache hit, and it is the single most useful number on a first run.
      let existedBefore = false;
      try {
        existedBefore = fs.existsSync(path.join(modelsDir ?? '.', MODEL_FILE));
      } catch {
        existedBefore = false;
      }
      const resolved = await resolveModelFile(MODEL_URI, modelsDir);
      op.note({ modelPath: resolved, existedBefore });
      return resolved;
    },
    THRESHOLDS.modelResolve,
  );

  // Device-agnostic pick: prefer the discrete GPU over the integrated one on hybrid
  // laptops. Selection runs in short-lived child probes and sets
  // GGML_VK_VISIBLE_DEVICES in this process's env BEFORE the first getLlama() below,
  // because node-llama-cpp binds the Vulkan backend once per process. Any failure
  // returns "auto-pick" (env untouched) and never crashes boot.
  const probeScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gpu-probe.mjs');
  const sel = await inst.run(
    'llm',
    'gpu probe',
    {},
    async (op) => {
      const picked = await selectGpuDevice({
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
      op.note({ gpu: picked.gpu ?? null, deviceIndex: picked.index ?? null, device: picked.name ?? null });
      return picked;
    },
    THRESHOLDS.gpuProbe,
  );

  onStatus?.({ phase: 'loading', modelPath });
  // env already isolates the pinned device (if any); auto otherwise.
  const llama = await inst.run(
    'llm',
    'llama init',
    { pinned: !!sel.gpu },
    async (op) => {
      const built = await getLlama(sel.gpu ? { gpu: sel.gpu } : {});
      op.note({ gpu: built.gpu ?? null });
      return built;
    },
    THRESHOLDS.llamaInit,
  );
  const vram = await llama.getVramState().catch(() => null);
  const unified = vram ? vram.unifiedSize > 0 : false;

  const model = await inst.run(
    'llm',
    'model load',
    { modelPath },
    () => llama.loadModel({ modelPath }),
    THRESHOLDS.modelLoad,
  );
  const context = await inst.run(
    'llm',
    'context create',
    { contextSize: 4096 },
    () => model.createContext({ contextSize: 4096 }),
    THRESHOLDS.contextCreate,
  );
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
    async generate({ prompt, system, maxTokens = 400, onToken, requestId } = {}) {
      // Capture the sequence so we can reclaim it: the context has a finite pool
      // of sequences, and disposing only the session (as before) leaked one per
      // call — after the pool drained, node-llama-cpp threw "No sequences left".
      const sequence = context.getSequence();
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: system ?? DEFAULT_SYSTEM,
      });
      // ⭐ THE FREEZE DETECTOR. `begin` (not `run`) because the heartbeat needs `note()`
      // called from inside the token callback: two heartbeats with the SAME `chunks` mean
      // the stream has stopped, two with DIFFERENT `chunks` mean it is merely slow. That
      // one distinction is what the reported incident had no way to answer.
      const op = inst.begin(
        'llm',
        'generate',
        {
          requestId: requestId ?? null,
          promptChars: (prompt ?? '').length,
          systemChars: (system ?? DEFAULT_SYSTEM).length,
          maxTokens,
        },
        THRESHOLDS.generate,
      );
      let firstMs = null;
      let chunks = 0;
      const t0 = performance.now();
      try {
        const text = await session.prompt(prompt, {
          maxTokens,
          onTextChunk(chunk) {
            if (firstMs === null) firstMs = performance.now() - t0;
            chunks += 1;
            op.note({ chunks, ttftMs: Math.round(firstMs) });
            onToken?.(chunk);
          },
        });
        const total = performance.now() - t0;
        const tokens = model.tokenize(text).length;
        const tokensPerSecond = (tokens / Math.max(1, total - (firstMs ?? 0))) * 1000;
        op.done({ tokens, tokensPerSecond: Math.round(tokensPerSecond), textChars: text.length });
        return {
          text,
          tokens,
          ttftMs: firstMs ?? 0,
          tokensPerSecond,
          // Returned so the renderer can subtract it from its own round trip and see the
          // IPC/queue overhead separately from the model. Computed already; thrown away
          // until now.
          totalMs: total,
        };
      } catch (err) {
        op.fail(err);
        throw err;
      } finally {
        session.dispose();
        sequence.dispose();
      }
    },
  };
}
