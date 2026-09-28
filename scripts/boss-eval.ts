// THE BOSS EVALUATION — the real-model driver (PLAN.md #11 part B; `docs/BOSS-PROMPTS.md` §7).
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
// ⚠ THE MODEL IS LOADED ONLY WITH `--run`. Without it the script validates its inputs, prints
// the call plan and exits 0 — `node-llama-cpp` is not even imported. No test imports this file;
// its pure core is `boss-eval-lib.ts`, which is tested against a scripted fake.
//
// WHAT A RUN MEASURES IS THE SHIPPED PATH: prompts from `src/llm/bossPrompt.ts`, generation
// through `electron/structured.mjs`'s `runStructured` behind `electron/llm-queue.mjs` with the
// same 3 s deadline, answers read by `src/llm/bossAnswer.ts`. The model is loaded the way
// `electron/llm.mjs` loads it (auto GPU → loadModel → a 4,096-token context), from the per-user
// models directory (`electron/model-path.mjs`) — never `./models`, and never downloaded here.
//
// It writes `<out>/<timestamp>.json` (every call record + the summary) and prints the report.
// EXIT STATUS (`EXIT` in boss-eval-lib.ts), so it can be the merge gate (§7.1):
//   0  every target passed (or was not run);
//   1  a target FAILED;
//   2  unusable arguments or inputs (a bad flag, a broken message set or personas file, no model);
//   3  INCONCLUSIVE — more than 5% of some group's calls failed (timeout, error, cut-off answer),
//      or more than 5% of a Hollow Self target's conversations were left out (a message failed on
//      all three attempts), so those targets cannot be trusted either way. It wins over 1: re-run
//      before acting on a FAIL;
//   4  the run CRASHED part-way (an exception inside the evaluation) — no report was produced.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { resolveModelDir } from '../electron/model-path.mjs';
import { createGrammarCache, runStructured } from '../electron/structured.mjs';
import { validatePersona, type BossPersona } from '../src/llm/bossContract.ts';
import { FIXTURE_PERSONA_LIST } from '../src/llm/bossFixtures.testutil.ts';
import {
  electronUserDataDir,
  EXIT,
  messageSetProblems,
  parseArgs,
  personaListProblems,
  pickModelFile,
  planCalls,
  renderPlan,
  type MessageSet,
  type RawResult,
} from './boss-eval-lib.ts';
import { runEvaluation } from './boss-eval-run.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fail(message: string, code: number = EXIT.badInput): never {
  console.error(`boss-eval: ${message}`);
  process.exit(code);
}

// ---- inputs (validated before anything else) ----------------------------------------------

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) fail(parsed.error);
const options = parsed.options;

const messagesPath = options.messages ?? path.join(HERE, 'boss-eval', 'messages.json');
const set = JSON.parse(readFileSync(messagesPath, 'utf8')) as MessageSet;
const setProblems = messageSetProblems(set);
if (setProblems.length > 0) fail(`the message set is not usable:\n  ${setProblems.join('\n  ')}`);

let personas: readonly BossPersona[] = FIXTURE_PERSONA_LIST;
if (options.personas !== 'fixture') {
  const loaded: unknown = JSON.parse(readFileSync(options.personas, 'utf8'));
  const problems = personaListProblems(loaded, validatePersona);
  if (problems.length > 0) fail(`the personas file is not usable:\n  ${problems.join('\n  ')}`);
  personas = loaded as BossPersona[];
}

const plan = planCalls(set, options);
console.log(`Personas: ${options.personas === 'fixture' ? 'the BOSS-PROMPTS §5 drafts (fixture)' : options.personas}`);
console.log(`Messages: ${messagesPath} — ${set.status}
`);
console.log(renderPlan(plan, options));

if (!options.run) process.exit(0);

// ---- from here on, the real model (author only) --------------------------------------------

try {
  await evaluate();
} catch (err) {
  // A crash is its own status: without this it would exit 1, indistinguishable from "a target
  // failed" to anything that reads only the status.
  console.error('boss-eval: the run crashed —', err);
  process.exitCode = EXIT.crashed;
}

async function evaluate(): Promise<void> {
  const userDataDir = electronUserDataDir({ platform: process.platform, env: process.env, home: os.homedir() });
  const modelsDir = resolveModelDir({ env: process.env, userDataDir });
  const file = existsSync(modelsDir) ? pickModelFile(readdirSync(modelsDir)) : null;
  if (file === null) fail(`no model in ${modelsDir} — run the game once to download it (this script never downloads)`);
  const modelPath = path.join(modelsDir, file);

  console.log(`\nLoading ${modelPath} …`);
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 4096 });
  console.log(`Loaded (gpu: ${String(llama.gpu)}).`);

  const cache = createGrammarCache();
  const now = () => performance.now();
  const outcome = await runEvaluation({
    personas,
    set,
    options,
    backend: {
      generate: (ipc, { signal }) =>
        runStructured({ llama, context, model, LlamaChatSession, now }, ipc, { signal, cache }) as Promise<RawResult>,
      vram: () => llama.getVramState().catch(() => null),
    },
    onProgress: ({ calls, lastMs }) => console.log(`  … ${calls} calls (${Math.round(lastMs)} ms last)`),
  });
  const { summary, gate, records, report } = outcome;
  console.log(`\n${report}`);

  const outDir = path.resolve(options.out);
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(outFile, JSON.stringify({ options, plan, summary, gate, records }, null, 2), 'utf8');
  console.log(`\nWrote ${outFile}`);

  await context.dispose();
  await model.dispose();
  process.exitCode = outcome.exitCode;
}
