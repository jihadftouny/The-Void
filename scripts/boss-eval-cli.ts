// THE BOSS EVALUATION — the command, importable (PLAN.md #11 part B; `docs/BOSS-PROMPTS.md` §7).
//
// `main(argv, deps)` is everything the command does between the arguments and the exit status:
// read and check the inputs, print the plan, and — only with `--run` — find the model, load it
// through `deps.loadBackend`, run the evaluation (`boss-eval-run.ts`), print the report, write the
// JSON, and RETURN the outcome's exit status. It touches the world only through `deps`, so
// `boss-eval-cli.test.ts` drives it with fakes and asserts the behaviour the old source scans
// could only guess at: nothing loads without `--run`, the model comes from the per-user directory,
// the status is the outcome's, a crash is 4.
//
// No process state, no file system, no native model library here: the entry (`boss-eval.ts`) supplies them.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModelDir } from '../electron/model-path.mjs';
import { validatePersona, type BossPersona, type BossPersonaId } from '../src/llm/bossContract.ts';
import { FIXTURE_PERSONA_LIST } from '../src/llm/bossFixtures.testutil.ts';
import {
  EXIT,
  electronUserDataDir,
  messageSetProblems,
  parseArgs,
  personaById,
  personaListProblems,
  pickModelFile,
  planCalls,
  renderPlan,
  type EvalGroup,
  type MessageSet,
} from './boss-eval-lib.ts';
import { runEvaluation, type EvalBackend, type QueueDeps } from './boss-eval-run.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A loaded model, as the run needs it — plus what the command reports and releases. */
export interface LoadedBackend extends EvalBackend {
  /** The model library's `llama.gpu` (false on a CPU-only run — the timings then mean nothing). */
  gpu: string;
  dispose(): Promise<void>;
}

/** Everything `main` needs from the world. The entry passes the real ones; tests pass fakes. */
export interface CliDeps {
  readFile(path: string): string;
  exists(path: string): boolean;
  listDir(path: string): string[];
  /** Writes the file, creating its directory. */
  writeFile(path: string, text: string): void;
  stdout(line: string): void;
  stderr(line: string): void;
  env: Record<string, string | undefined>;
  platform: string;
  home: string;
  /** The output file's name stem (an ISO time, in the real entry). */
  stamp(): string;
  /** Load the model at `modelPath`. Called ONLY with `--run`, after every input has been checked. */
  loadBackend(modelPath: string): Promise<LoadedBackend>;
  /** Passed through to the run's queue — tests only. */
  queueDeps?: Partial<QueueDeps>;
}

/** The bosses a wanted group cannot run without: its target would read NOT RUN, and pass. */
const REQUIRED: readonly { id: BossPersonaId; groups: readonly EvalGroup[]; message: string }[] = [
  { id: 'hollow', groups: ['all', 'hollow-gate'], message: 'the personas have no Hollow Self — the gate cannot run' },
  { id: 'executioner', groups: ['all', 'talk'], message: 'the personas have no executioner — "never concedes" cannot be judged' },
];

/** Read and parse a JSON file; a read or parse error is an unusable input, not a crash. */
function readJson(deps: CliDeps, file: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(deps.readFile(file)) as unknown };
  } catch (err) {
    return { ok: false, error: `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Run the command. Returns the exit status (`EXIT`); never throws. */
export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const bad = (message: string): number => {
    deps.stderr(`boss-eval: ${message}`);
    return EXIT.badInput;
  };

  // ---- inputs (validated before anything else) ----------------------------------------------
  const parsed = parseArgs(argv);
  if (!parsed.ok) return bad(parsed.error);
  const options = parsed.options;

  const messagesPath = options.messages ?? path.join(HERE, 'boss-eval', 'messages.json');
  const setJson = readJson(deps, messagesPath);
  if (!setJson.ok) return bad(setJson.error);
  const setProblems = messageSetProblems(setJson.value);
  if (setProblems.length > 0) return bad(`the message set is not usable:\n  ${setProblems.join('\n  ')}`);
  const set = setJson.value as MessageSet;

  let personas: readonly BossPersona[] = FIXTURE_PERSONA_LIST;
  if (options.personas !== 'fixture') {
    const loaded = readJson(deps, options.personas);
    if (!loaded.ok) return bad(loaded.error);
    const problems = personaListProblems(loaded.value, validatePersona);
    if (problems.length > 0) return bad(`the personas file is not usable:\n  ${problems.join('\n  ')}`);
    personas = loaded.value as BossPersona[];
  }
  for (const need of REQUIRED) {
    if (need.groups.includes(options.group) && !personaById(personas, need.id)) return bad(need.message);
  }

  const plan = planCalls(set, options);
  deps.stdout(`Personas: ${options.personas === 'fixture' ? 'the BOSS-PROMPTS §5 drafts (fixture)' : options.personas}`);
  deps.stdout(`Messages: ${messagesPath} — ${set.status}\n`);
  deps.stdout(renderPlan(plan, options));

  if (!options.run) return EXIT.pass;

  // ---- from here on, the real model (author only) --------------------------------------------
  const userDataDir = electronUserDataDir({ platform: deps.platform, env: deps.env, home: deps.home });
  const modelsDir = resolveModelDir({ env: deps.env, userDataDir });
  const file = deps.exists(modelsDir) ? pickModelFile(deps.listDir(modelsDir)) : null;
  if (file === null) return bad(`no model in ${modelsDir} — run the game once to download it (this script never downloads)`);
  const modelPath = path.join(modelsDir, file);

  try {
    deps.stdout(`\nLoading ${modelPath} …`);
    const backend = await deps.loadBackend(modelPath);
    deps.stdout(`Loaded (gpu: ${backend.gpu}).`);
    const outcome = await runEvaluation({
      personas,
      set,
      options,
      backend,
      ...(deps.queueDeps ? { queueDeps: deps.queueDeps } : {}),
      onProgress: ({ calls, lastMs }) => deps.stdout(`  … ${calls} calls (${Math.round(lastMs)} ms last)`),
    });
    deps.stdout(`\n${outcome.report}`);
    const outFile = path.join(path.resolve(options.out), `${deps.stamp()}.json`);
    const { summary, gate, records } = outcome;
    deps.writeFile(outFile, JSON.stringify({ options, plan, summary, gate, records }, null, 2));
    deps.stdout(`\nWrote ${outFile}`);
    await backend.dispose();
    return outcome.exitCode;
  } catch (err) {
    // A crash is its own status: otherwise it is indistinguishable from "a target failed" to
    // anything that reads only the status. The stack goes with it — the only evidence there is.
    deps.stderr(`boss-eval: the run crashed — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return EXIT.crashed;
  }
}
