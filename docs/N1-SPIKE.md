# N1 — Local LLM inference spike

The one question this answers: **can a small local model stream narration fast enough, and return
strictly-structured choices, on a typical machine?** That decides whether the whole local-LLM design
is viable and which model + minimum spec we commit to.

## What it does

`scripts/spike-llm.mjs` downloads two models and benchmarks each **twice**:

- **CPU-only** (`gpuLayers: 0`) — the **min-spec floor** (a no-GPU laptop runs the model in system
  RAM). This is the number that actually decides viability.
- **GPU** (offload all layers) — the "has-a-GPU" tier (e.g. this dev machine's RTX 5060) and the
  experience many players will get.

For each it measures: generation speed (tokens/sec), time-to-first-token (TTFT), model load time,
system-RAM delta, VRAM delta, and — critically — whether **JSON-schema-constrained** generation
works (the game needs choice-lists the model physically cannot malform).

Models (Q4_K_M GGUF, from unsloth on HuggingFace):
- **Qwen3-4B-Instruct-2507** (~2.5GB) — the intended target; Apache-2.0.
- **Qwen3-1.7B** (~1.1GB) — the weak-machine floor.

## Run it

```bash
npm install            # adds node-llama-cpp (downloads a prebuilt llama.cpp binary)
npm run spike:pull     # optional: just download the ~3.6GB of models first
npm run spike:llm      # download-if-needed, then benchmark both models CPU + GPU
```

Useful flags: `--models=4b` · `--cpu-only` · `--gpu-only` · `--max-tokens=300` ·
`--model-path="C:\\path\\to\\a.gguf" --models=4b` (skip download, use a local file).

Models download into `models/` (gitignored). If an `hf:` URI ever 404s, open the repo on
huggingface.co and update the filename in `scripts/spike-llm.mjs`, or pass `--model-path`.

## Results (filled in by the spike run)

_Machine:_ (auto-printed) — dev laptop, RTX 5060.

| Model | Mode | tok/s | TTFT | load | sysRAM | VRAM | JSON |
|---|---|---:|---:|---:|---:|---:|:--:|
| Qwen3-4B-Instruct-2507 | cpu |  |  |  |  |  |  |
| Qwen3-4B-Instruct-2507 | gpu |  |  |  |  |  |  |
| Qwen3-1.7B | cpu |  |  |  |  |  |  |
| Qwen3-1.7B | gpu |  |  |  |  |  |  |

**Rough viability bar (CPU tok/s = min-spec floor):** ~15+ streams comfortably · 8–15 usable ·
<6 sluggish. JSON must be "ok" for the model we choose.

## Verdict

_(filled after the run: chosen model, chosen minimum spec, and whether we proceed to the Electron
shell — N1b.)_
