// N1 spike — local LLM inference proof for The Void.
//
// Goal: answer the one question that decides the whole design —
//   "Can a small local model stream narration at a usable speed, and return
//    STRICTLY-structured choices, on a typical machine?"
//
// It measures each model TWICE:
//   • CPU-only (gpuLayers: 0)  → our MIN-SPEC floor (no-GPU laptop; the number
//                                that actually decides viability). Your RTX 5060
//                                would give a falsely rosy read, so we force CPU.
//   • GPU (offload all layers) → your real experience + the "has-a-GPU" tier.
//
// It also runs a JSON-SCHEMA-CONSTRAINED generation, because the game depends on
// the model returning choice-lists it physically cannot malform.
//
// Usage:
//   npm run spike:pull            # just download the models (~3.6GB), no inference
//   npm run spike:llm             # download if needed, then benchmark both models
//   node scripts/spike-llm.mjs --models=4b        # one model
//   node scripts/spike-llm.mjs --cpu-only         # skip the GPU pass
//   node scripts/spike-llm.mjs --gpu-only
//   node scripts/spike-llm.mjs --max-tokens=300
//   node scripts/spike-llm.mjs --model-path="C:\\path\\to\\your.gguf" --models=4b
//
// This is an exploratory spike, not shipped game code — it lives on the
// spike/n1-local-llm branch and is not wired into the app.

import os from 'node:os';
import { performance } from 'node:perf_hooks';

// ---- Model catalog ---------------------------------------------------------
// hf: URIs resolve against HuggingFace. Repo/quant names occasionally drift —
// if resolution 404s, open the repo on huggingface.co and swap the tag, or pass
// a local file with --model-path. unsloth + bartowski reliably publish these.
const MODELS = {
  '4b': {
    label: 'Qwen3-4B-Instruct-2507 (Q4_K_M)',
    uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    // Non-thinking instruct variant — no hidden reasoning before it answers.
    noThink: false,
  },
  '1.7b': {
    label: 'Qwen3-1.7B (Q4_K_M)',
    uri: 'hf:unsloth/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q4_K_M.gguf',
    // Base Qwen3 is thinking-capable; we disable it for game latency.
    noThink: true,
  },
};

const SYSTEM_PROMPT =
  'You are the Void — the narrator of a dark, dreamlike descent RPG about ' +
  'psychosis and survival. Write vivid, terse second-person narration. ' +
  'Atmospheric, unsettling, concrete. Never break character.';

const NARRATION_PROMPT =
  'The player — an Enforcer with 11 health — steps off a groaning elevator onto ' +
  'the First Floor of the Void. Describe what they see and feel in 3-4 sentences.';

// Schema the game will actually use: narration + a small closed choice list.
const CHOICE_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string' },
    choices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['id', 'label'],
      },
    },
  },
  required: ['narration', 'choices'],
};

// ---- Arg parsing -----------------------------------------------------------
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const pullOnly = has('--pull-only');
const cpuOnly = has('--cpu-only');
const gpuOnly = has('--gpu-only');
const maxTokens = Number(val('max-tokens', '200'));
const modelPathOverride = val('model-path', null);
const wanted = val('models', '4b,1.7b')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ---- Helpers ---------------------------------------------------------------
const fmtGB = (bytes) => (bytes / 1024 ** 3).toFixed(2) + ' GB';
const fmtMB = (bytes) => (bytes / 1024 ** 2).toFixed(0) + ' MB';

function banner(text) {
  const line = '─'.repeat(Math.max(text.length + 2, 60));
  console.log('\n' + line + '\n ' + text + '\n' + line);
}

async function loadLib() {
  try {
    return await import('node-llama-cpp');
  } catch (err) {
    console.error(
      '\nCould not import node-llama-cpp. Run `npm install` first ' +
        '(it downloads a prebuilt llama.cpp binary for your machine).\n',
    );
    throw err;
  }
}

// Run one model in one mode (cpu/gpu). Returns a result row or null on failure.
async function runOne(lib, modelKey, mode) {
  const { getLlama, resolveModelFile, LlamaChatSession } = lib;
  const spec = MODELS[modelKey];
  banner(`${spec.label} — ${mode.toUpperCase()}`);

  // getLlama({gpu:false}) forces the CPU backend; default auto-detects CUDA/Vulkan/Metal.
  const llama = await getLlama(mode === 'cpu' ? { gpu: false } : {});
  if (mode === 'gpu' && llama.gpu === false) {
    console.log('  (no GPU backend detected — skipping GPU pass)');
    return null;
  }
  if (mode === 'gpu') console.log(`  GPU backend: ${llama.gpu}`);

  const modelPath =
    modelPathOverride ?? (await resolveModelFile(spec.uri, 'models'));

  const vramBefore = mode === 'gpu' ? (await llama.getVramState()).used : 0;
  const freeBefore = os.freemem();

  const tLoad0 = performance.now();
  const model = await llama.loadModel({
    modelPath,
    gpuLayers: mode === 'cpu' ? 0 : undefined, // undefined => offload as many as fit
  });
  const context = await model.createContext({ contextSize: 4096 });
  const loadMs = performance.now() - tLoad0;

  const freeAfter = os.freemem();
  const vramAfter = mode === 'gpu' ? (await llama.getVramState()).used : 0;
  const sysRamDelta = Math.max(0, freeBefore - freeAfter);

  const sysPrompt = spec.noThink ? SYSTEM_PROMPT + ' /no_think' : SYSTEM_PROMPT;

  // ---- Streaming narration: time-to-first-token + generation speed --------
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: sysPrompt,
  });

  let firstTokenMs = null;
  let streamed = '';
  const tGen0 = performance.now();
  const answer = await session.prompt(NARRATION_PROMPT, {
    maxTokens,
    onTextChunk(chunk) {
      if (firstTokenMs === null) firstTokenMs = performance.now() - tGen0;
      streamed += chunk;
      process.stdout.write(chunk);
    },
  });
  const totalMs = performance.now() - tGen0;
  const outTokens = model.tokenize(answer).length;
  const genMs = Math.max(1, totalMs - (firstTokenMs ?? 0));
  const tokPerSec = (outTokens / genMs) * 1000;

  // ---- JSON-schema-constrained generation (the load-bearing capability) ---
  banner('constrained JSON test');
  let jsonOk = false;
  let jsonSample = '';
  try {
    const grammar = await llama.createGrammarForJsonSchema(CHOICE_SCHEMA);
    const jsonSession = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: sysPrompt,
    });
    const raw = await jsonSession.prompt(
      'Narrate the player finding a locked door, then give exactly 3 choices ' +
        '(each with a short id and a player-facing label).',
      { grammar, maxTokens: 300 },
    );
    const parsed = grammar.parse(raw);
    jsonOk =
      parsed &&
      typeof parsed.narration === 'string' &&
      Array.isArray(parsed.choices) &&
      parsed.choices.length > 0;
    jsonSample = JSON.stringify(parsed, null, 2);
    console.log(jsonSample);
    jsonSession.dispose();
  } catch (err) {
    console.log('  JSON-constrained generation FAILED:', err?.message ?? err);
  }

  await context.dispose();
  await model.dispose();

  return {
    model: spec.label,
    mode,
    loadMs,
    ttftMs: firstTokenMs ?? 0,
    outTokens,
    tokPerSec,
    sysRamDelta,
    vramDelta: Math.max(0, vramAfter - vramBefore),
    jsonOk,
  };
}

// ---- Main ------------------------------------------------------------------
async function main() {
  banner('The Void — N1 local-LLM spike');
  console.log(`Machine: ${os.cpus()[0]?.model?.trim()} × ${os.cpus().length} threads`);
  console.log(`Total RAM: ${fmtGB(os.totalmem())} | Free now: ${fmtGB(os.freemem())}`);
  console.log(`Models: ${wanted.join(', ')} | max-tokens: ${maxTokens}`);

  const lib = await loadLib();
  const { resolveModelFile } = lib;

  // Pull phase (always resolve; downloads if missing, shows a progress bar).
  for (const key of wanted) {
    if (!MODELS[key]) {
      console.error(`Unknown model key "${key}". Known: ${Object.keys(MODELS).join(', ')}`);
      process.exit(1);
    }
    if (modelPathOverride) continue;
    banner(`Resolving ${MODELS[key].label}`);
    const p = await resolveModelFile(MODELS[key].uri, 'models');
    console.log('  ->', p);
  }
  if (pullOnly) {
    console.log('\nPull-only complete. Run `npm run spike:llm` to benchmark.');
    return;
  }

  const modes = cpuOnly ? ['cpu'] : gpuOnly ? ['gpu'] : ['cpu', 'gpu'];
  const rows = [];
  for (const key of wanted) {
    for (const mode of modes) {
      try {
        const r = await runOne(lib, key, mode);
        if (r) rows.push(r);
      } catch (err) {
        console.error(`\n[${key}/${mode}] failed:`, err?.message ?? err);
      }
    }
  }

  // ---- Summary -------------------------------------------------------------
  banner('RESULTS');
  console.log(
    [
      'model'.padEnd(34),
      'mode'.padEnd(5),
      'tok/s'.padStart(7),
      'TTFT'.padStart(8),
      'load'.padStart(8),
      'sysRAM'.padStart(8),
      'VRAM'.padStart(8),
      'JSON',
    ].join(' '),
  );
  for (const r of rows) {
    console.log(
      [
        r.model.padEnd(34),
        r.mode.padEnd(5),
        r.tokPerSec.toFixed(1).padStart(7),
        (r.ttftMs.toFixed(0) + 'ms').padStart(8),
        (r.loadMs.toFixed(0) + 'ms').padStart(8),
        fmtMB(r.sysRamDelta).padStart(8),
        fmtMB(r.vramDelta).padStart(8),
        r.jsonOk ? 'ok' : 'FAIL',
      ].join(' '),
    );
  }
  console.log(
    '\nReading the numbers:\n' +
      '  • CPU tok/s is the min-spec floor. ~15+ tok/s streams comfortably; ' +
      '8-15 is usable; <6 feels sluggish.\n' +
      '  • TTFT is the pause before the first word appears (streaming hides the rest).\n' +
      '  • sysRAM ≈ what a no-GPU machine must spare. JSON must be "ok" for both models.\n' +
      '\nPaste this table back and we decide the model + min spec, then build the Electron shell.',
  );
}

main().catch((err) => {
  console.error('\nSpike failed:', err);
  process.exit(1);
});
