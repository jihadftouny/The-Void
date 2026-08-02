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

## Results (dev laptop, RTX 5060; ran 2026-08-02)

| Model | Mode | tok/s | TTFT | load | sysRAM | VRAM | JSON |
|---|---|---:|---:|---:|---:|---:|:--:|
| Qwen3-4B-Instruct-2507 | cpu | 7.6–7.8 | ~5.0s | ~4.1s | ~4.6 GB | 0 | ok (every run) |
| Qwen3-4B-Instruct-2507 | gpu | 88–94 | ~0.2–0.6s | ~15–20s | ~2.6 GB | ~3.9 GB | ok (every run) |
| Qwen3-1.7B | cpu | 14–15 | ~2.3s | ~2.7s | ~2.3 GB | 0 | ok* |
| Qwen3-1.7B | gpu | 146–169 | ~0.03s | ~5.4s | ~1.1 GB | ~2.3 GB | ok* |

*Both models always produced **structurally valid** grammar-constrained JSON. The 4B passed on every
run in both modes. The small 1.7B occasionally **truncated** (long narration exceeded the token cap →
"unterminated string") — the ONLY failure mode possible under grammar constraint. Fix is a
game-design detail, not a capability gap: bound narration length in the schema + give adequate token
budget. GPU load time on the 4B includes CUDA kernel compilation on first load (one-time).

## Verdict — GREEN. The local-LLM design is viable; proceed to the Electron shell (N1b).

- **Streaming + constrained structured output both work** on ordinary hardware, and the prose is
  genuinely good and on-theme (samples in the run logs).
- **Model plan (recommended): ship both, auto-select by hardware.**
  - **Qwen3-4B-Instruct-2507 = default / quality tier.** Excellent on any GPU (~90 tok/s, sub-second
    first word) and the most reliable JSON. On a no-GPU laptop it's usable-but-slow (~7.7 tok/s,
    ~5s first word, ~4.6 GB RAM).
  - **Qwen3-1.7B = no-GPU / low-end floor.** Comfortable on CPU (~14 tok/s, ~2.3 GB RAM), good prose,
    valid JSON with a bounded narration length.
  - Runtime: detect GPU/RAM → 4B if capable, else 1.7B (or ship 4B and fall back).
- **Minimum spec:** ~4 GB free RAM + a modern multi-core CPU runs the 1.7B floor comfortably; the 4B
  is the recommended tier (a GPU, or patience + ~5 GB RAM).
- **License:** Qwen3 is Apache-2.0 → clean to bundle and redistribute inside the game.
- **Lesson carried into N2/N3:** grammar constraint guarantees valid structure; the narrator prompt
  and schema must cap narration length so small models never truncate.
