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
//      so its targets cannot be trusted either way. It wins over 1: re-run before acting on a FAIL.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { resolveModelDir } from '../electron/model-path.mjs';
import { createSequenceQueue } from '../electron/llm-queue.mjs';
import { createGrammarCache, runStructured } from '../electron/structured.mjs';
import { validatePersona, type BossPersona, type BossRequest } from '../src/llm/bossContract.ts';
import { toIpcRequest } from '../src/llm/bossPrompt.ts';
import { fallbackFor } from '../src/llm/bossAnswer.ts';
import { buildVocabulary } from '../src/llm/textHygiene.ts';
import {
  FIXTURE_NAME,
  FIXTURE_PERSONA_LIST,
  fixtureFights,
  sceneRequest,
  talkRequest,
  turnRequest,
} from '../src/llm/bossFixtures.testutil.ts';
import {
  FIGHTING_PERSONAS,
  MESSAGE_GROUPS,
  PLAN_SIZES,
  electronUserDataDir,
  EXIT,
  exitCode,
  messageSetProblems,
  messagesFor,
  parseArgs,
  personaById,
  personaListProblems,
  pickModelFile,
  planCalls,
  renderPlan,
  renderReport,
  runConversation,
  scoreCall,
  summarize,
  isFailedCall,
  outcomeOf,
  type CallRecord,
  type ConversationOutcome,
  type GateGroup,
  type GateInput,
  type MessageSet,
  type RawResult,
} from './boss-eval-lib.ts';

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

await evaluate();

async function evaluate(): Promise<void> {
  const userDataDir = electronUserDataDir({ platform: process.platform, env: process.env, home: os.homedir() });
  const modelsDir = resolveModelDir({ env: process.env, userDataDir });
  const file = existsSync(modelsDir) ? pickModelFile(readdirSync(modelsDir)) : null;
  if (file === null) fail(`no model in ${modelsDir} — run the game once to download it (this script never downloads)`);
  const modelPath = path.join(modelsDir, file);

  console.log(`\nLoading ${modelPath} …`);
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
  const llama = await getLlama();
  const vramBefore = await llama.getVramState().catch(() => null);
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 4096 });
  console.log(`Loaded (gpu: ${String(llama.gpu)}).`);

  const queue = createSequenceQueue();
  const cache = createGrammarCache();
  const vocab = buildVocabulary();
  const records: CallRecord[] = [];
  const gate: { manipulative: ConversationOutcome[]; genuine: ConversationOutcome[]; offTarget: (boolean | 'failed')[] } = {
    manipulative: [],
    genuine: [],
    offTarget: [],
  };
  let requestId = 0;

  /** One call through the shipped path. `seed` overrides the persona's (gate runs 2 and 3). */
  async function call(req: BossRequest, seed?: number): Promise<RawResult> {
    requestId += 1;
    const ipc = toIpcRequest(requestId, req);
    const settings = seed === undefined ? ipc.settings : { ...ipc.settings, seed };
    const t0 = performance.now();
    const result = (await queue.run(
      ({ signal }: { signal: AbortSignal }) =>
        runStructured({ llama, context, model, LlamaChatSession, now: () => performance.now() }, { ...ipc, settings }, { signal, cache }),
      { deadlineMs: settings.deadlineMs },
    )) as RawResult;
    if (requestId % 25 === 0) console.log(`  … ${requestId} calls (${Math.round(performance.now() - t0)} ms last)`);
    return result;
  }

  const size = options.quick ? PLAN_SIZES.quick : PLAN_SIZES.full;
  const want = (g: string) => options.group === 'all' || options.group === g;

  // Turn: each fighting boss, its own previous lines carried forward so repetition is real.
  if (want('turn')) {
    const fights = fixtureFights();
    for (const id of FIGHTING_PERSONAS) {
      const persona = personaById(personas, id);
      if (!persona) continue;
      const previous: string[] = [];
      for (let i = 0; i < size.turnsPerPersona; i += 1) {
        const view = fights[i % fights.length];
        if (!view) continue;
        const req = turnRequest(persona, view, { lastLines: previous.slice(-3) });
        const rec = scoreCall(req, await call(req), { group: 'turn', run: 1, previous }, vocab);
        records.push(rec);
        if (rec.answered) previous.push(rec.shown);
      }
    }
  }

  // Talk: every fighting boss, every message group; the Warden speaks in Scenes, then a verdict.
  if (want('talk')) {
    for (const id of FIGHTING_PERSONAS) {
      const persona = personaById(personas, id);
      if (!persona) continue;
      for (const group of MESSAGE_GROUPS) {
        for (const typed of messagesFor(set, id, group).slice(0, size.talkPerGroup)) {
          const req = talkRequest(persona, { exchanges: [], typed, available: persona.concessions });
          records.push(scoreCall(req, await call(req), { group, run: 1, previous: [] }, vocab));
        }
      }
    }
    const warden = personaById(personas, 'warden');
    if (warden) {
      const previous: string[] = [];
      for (const group of MESSAGE_GROUPS) {
        for (const typed of messagesFor(set, 'warden', group).slice(0, size.talkPerGroup)) {
          const req = sceneRequest(warden, { typed, lastLines: previous.slice(-3) });
          const rec = scoreCall(req, await call(req), { group, run: 1, previous }, vocab);
          records.push(rec);
          if (rec.answered) previous.push(rec.shown);
        }
      }
      const verdict = sceneRequest(warden, { verdict: { outcome: 'grace', name: FIXTURE_NAME } });
      records.push(scoreCall(verdict, await call(verdict), { group: 'verdict', run: 1, previous }, vocab));
    }
  }

  // The Hollow Self's gate (§7.1): whole conversations, stopping at the first surrender — and at
  // the first FAILED call (timeout, error, cut-off answer), which is not a refusal: that
  // conversation is left out of its target and reported (fix round 1, F1).
  if (want('hollow-gate')) {
    const hollow = personaById(personas, 'hollow');
    if (!hollow) fail('the personas have no Hollow Self — the gate cannot run');
    const runs = options.quick ? 1 : options.runs;
    const cap = size.gateConversations;
    for (let run = 1; run <= runs; run += 1) {
      // Run 1 is production behaviour (the card's pinned seed); runs 2+ vary it for robustness.
      const seed = run === 1 ? undefined : (hollow.talk.seed ?? 0) + run - 1;
      const converse = (messages: readonly string[], group: GateGroup) => {
        let turn = 0;
        return runConversation(messages, async (window, typed) => {
          turn += 1;
          const req = talkRequest(hollow, { exchanges: window, typed, available: ['surrender'] });
          const rec = scoreCall(req, await call(req, seed), { group, run, previous: [] }, vocab);
          records.push(rec);
          if (rec.answered) return { reply: rec.shown, concession: rec.concession };
          // An answer that came back but broke a rule (an illegal concession) is what the game
          // would show as a fallback with no concession (§6); a call that never came back is not
          // a ruling at all.
          return { reply: fallbackFor(hollow, 'talk', turn), concession: null, failed: isFailedCall(rec) };
        });
      };
      for (const c of set.hollowGate.manipulativeConversations.slice(0, cap)) {
        gate.manipulative.push(outcomeOf(await converse(c.messages, 'gate-manipulative')));
      }
      for (const c of set.hollowGate.genuineConversations.slice(0, cap)) {
        gate.genuine.push(outcomeOf(await converse(c.messages, 'gate-genuine')));
      }
      for (const m of set.hollowGate.offTargetSingles.slice(0, cap)) {
        const outcome = outcomeOf(await converse([m], 'gate-off-target'));
        gate.offTarget.push(outcome === 'failed' ? 'failed' : outcome === 0);
      }
    }
  }

  const vramAfter = await llama.getVramState().catch(() => null);
  const summary = summarize(records, gate as GateInput, { before: vramBefore, after: vramAfter });
  const report = renderReport(summary);
  console.log(`\n${report}`);

  const outDir = path.resolve(options.out);
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(outFile, JSON.stringify({ options, plan, summary, gate, records }, null, 2), 'utf8');
  console.log(`\nWrote ${outFile}`);

  await context.dispose();
  await model.dispose();
  process.exitCode = exitCode(summary);
}
