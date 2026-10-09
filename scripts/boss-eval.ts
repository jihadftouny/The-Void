// THE BOSS EVALUATION — the process entry (PLAN.md #11 part B; `docs/BOSS-PROMPTS.md` §7).
//
//     npm run boss:eval                     # prints the plan and the estimated time; loads NOTHING
//     npm run boss:eval -- --run            # AUTHOR ONLY: loads the model on the GPU (~75 min)
//     npm run boss:eval -- --run --quick    # AUTHOR ONLY: one run, ten conversations a group (~9 min)
//
// Options: --personas <path|fixture> (default: the BOSS-PROMPTS §5 drafts, `fixture`),
//          --messages <path> (default: scripts/boss-eval/messages.json),
//          --runs <n> (Hollow Self gate repeats, default 3), --group all|turn|talk|hollow-gate,
//          --quick, --out <dir> (default logs/boss-eval, gitignored).
//
// ⚠ THE MODEL IS LOADED ONLY WITH `--run`. Without it the command validates its inputs, prints
// the call plan and exits 0 — `node-llama-cpp` is not even imported. No test imports this file.
// It is the thin process shell over three tested modules: `boss-eval-cli.ts` (the command:
// arguments, inputs, the model's location, the exit status), `boss-eval-run.ts` (the run: every
// loop, the queue, the gate, the report) and `boss-eval-lib.ts` (the pure scoring core). This file
// only supplies the real world: the file system, the environment, the console, and the model.
//
// WHAT A RUN MEASURES IS THE SHIPPED PATH: prompts from `src/llm/bossPrompt.ts`, generation
// through `electron/structured.mjs`'s `runStructured` behind `electron/llm-queue.mjs` with the
// same 3 s deadline, answers read by `src/llm/bossAnswer.ts`. The model is loaded the way
// `electron/llm.mjs` loads it (auto GPU → loadModel → a 4,096-token context), from the per-user
// models directory (`electron/model-path.mjs`) — never from the working directory, never downloaded.
//
// It writes `<out>/<timestamp>.json` (every call record + the summary) and prints the report.
// EXIT STATUS (`EXIT` in boss-eval-lib.ts), so it can be the merge gate (§7.1):
//   0  every target passed (or was not run: its group made no calls);
//   1  a target FAILED;
//   2  unusable arguments or inputs (a bad flag, a broken message set or personas file, a
//      personas file missing a boss the wanted group needs, no model);
//   3  INCONCLUSIVE — more than 5% of some group's calls failed (timeout, error, cut-off answer),
//      more than 5% of a Hollow Self target's conversations were left out (a message failed on
//      all three attempts), or a target its own calls never reached; those targets cannot be
//      trusted either way. It wins over 1: re-run before acting on a FAIL;
//   4  the run CRASHED part-way (an exception inside the evaluation) — no report was produced.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGrammarCache, runStructured } from '../electron/structured.mjs';
import type { RawResult } from './boss-eval-lib.ts';
import { main } from './boss-eval-cli.ts';

process.exitCode = await main(process.argv.slice(2), {
  readFile: (p) => readFileSync(p, 'utf8'),
  exists: existsSync,
  listDir: (p) => readdirSync(p),
  writeFile: (p, text) => {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text, 'utf8');
  },
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  env: process.env,
  platform: process.platform,
  home: os.homedir(),
  stamp: () => new Date().toISOString().replace(/[:.]/g, '-'),
  async loadBackend(modelPath) {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp'); // the ONLY import of it
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: 4096 });
    const cache = createGrammarCache();
    const now = () => performance.now();
    return {
      gpu: String(llama.gpu),
      generate: (ipc, { signal }) =>
        runStructured({ llama, context, model, LlamaChatSession, now }, ipc, { signal, cache }) as Promise<RawResult>,
      vram: () => llama.getVramState().catch(() => null),
      dispose: async () => {
        await context.dispose();
        await model.dispose();
      },
    };
  },
});
