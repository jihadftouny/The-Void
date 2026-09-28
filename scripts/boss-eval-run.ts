// THE BOSS EVALUATION — one whole run, importable (PLAN.md #11 part B; `docs/BOSS-PROMPTS.md` §7).
//
// `runEvaluation` IS the run: the Turn loop, the Talk loop and the Warden's Scenes, the Hollow
// Self's gate, then summary → report → exit status. The process entry (`boss-eval.ts`) hands it the
// real model; `boss-eval-run.test.ts` hands it a scripted fake and asserts what the run REPORTS —
// every §7.1 count, derived by hand. That is the guard (fix round 3): the loops used to live in the
// un-importable entry, pinned by regular expressions over its text, and each fix round moved the
// code out from under the scan. A test that runs the loops cannot be moved out from under.
//
// Everything a call goes through here is SHIPPED code: the prompt from `src/llm/bossPrompt.ts`, the
// queue and its 3 s deadline from `electron/llm-queue.mjs`, the answer read by `src/llm/bossAnswer.ts`
// (via the library's `scoreCall`). Only `backend.generate` differs between the real run and a test —
// the real one is `electron/structured.mjs`'s `runStructured`.
//
// No process state, no file system, no native model library: this module writes, prints and exits nothing.
// The only clock is the queue's (injected in tests) and the one timing the progress callback.

import { createSequenceQueue } from '../electron/llm-queue.mjs';
import type { BossIpcRequest, BossPersona, BossRequest } from '../src/llm/bossContract.ts';
import { toIpcRequest } from '../src/llm/bossPrompt.ts';
import { buildVocabulary, type TextVocabulary } from '../src/llm/textHygiene.ts';
import { FIXTURE_NAME, fixtureFights, sceneRequest, talkRequest, turnRequest } from '../src/llm/bossFixtures.testutil.ts';
import {
  FIGHTING_PERSONAS,
  MESSAGE_GROUPS,
  PLAN_SIZES,
  emptyGate,
  exitCode,
  gateConversation,
  messagesFor,
  personaById,
  recordGateResult,
  renderReport,
  scoreCall,
  summarize,
  type CallRecord,
  type EvalOptions,
  type EvalSummary,
  type GateGroup,
  type GateTally,
  type MessageSet,
  type RawResult,
} from './boss-eval-lib.ts';

/** What the run needs from a model. The entry wraps the real `runStructured`; tests script it. */
export interface EvalBackend {
  /**
   * One structured generation. Never throws (the real one is `runStructured`). `request` is the
   * pure request the IPC request was built from — the real backend ignores it; a fake scripts by it.
   */
  generate(ipc: BossIpcRequest, opts: { signal: AbortSignal; request: BossRequest }): Promise<RawResult>;
  /** The GPU's memory state (the model library's `getVramState`), or null. Read before and after. */
  vram(): Promise<unknown | null>;
}

/** Injected timers for the queue's deadline — the `createSequenceQueue` shape; real by default. */
export interface QueueDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface RunInput {
  personas: readonly BossPersona[];
  set: MessageSet;
  /** group, runs, quick. */
  options: EvalOptions;
  backend: EvalBackend;
  /** Default: `buildVocabulary()`. */
  vocab?: TextVocabulary;
  /** Tests only; default: the real timers and the performance clock. */
  queueDeps?: Partial<QueueDeps>;
  /** Called every 25 calls (the "… N calls" line). Default: nothing. */
  onProgress?: (p: { calls: number; lastMs: number }) => void;
}

export interface RunOutcome {
  records: CallRecord[];
  gate: GateTally;
  summary: EvalSummary;
  report: string;
  /** `exitCode(summary)`, always. */
  exitCode: number;
}

/** Run the evaluation against `backend`. Rejects only on a crash (or a gate with no Hollow Self). */
export async function runEvaluation(input: RunInput): Promise<RunOutcome> {
  const { personas, set, options, backend } = input;
  const vramBefore = await backend.vram();
  const clock = input.queueDeps?.now ?? (() => performance.now());

  const queue = createSequenceQueue(input.queueDeps as Parameters<typeof createSequenceQueue>[0]);
  const vocab = input.vocab ?? buildVocabulary();
  const records: CallRecord[] = [];
  const gate = emptyGate();
  let requestId = 0;

  /** One call through the shipped path. `seed` overrides the persona's (gate runs 2 and 3). */
  async function call(req: BossRequest, seed?: number): Promise<RawResult> {
    requestId += 1;
    const ipc = toIpcRequest(requestId, req);
    const settings = seed === undefined ? ipc.settings : { ...ipc.settings, seed };
    const t0 = clock();
    const result = (await queue.run(
      ({ signal }: { signal: AbortSignal }) => backend.generate({ ...ipc, settings }, { signal, request: req }),
      { deadlineMs: settings.deadlineMs },
    )) as RawResult;
    if (requestId % 25 === 0) input.onProgress?.({ calls: requestId, lastMs: clock() - t0 });
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

  // The Hollow Self's gate (§7.1): whole conversations, stopping at the first surrender. A FAILED
  // call (timeout, error, cut-off answer) is not a refusal: `runConversation` asks the same message
  // again, with the same window, up to twice more (the orchestrator's methodology amendment,
  // 2026-09-28); only a message that fails every time drops its conversation, which is then left
  // out of its target and reported — and more than 5% left out makes the target INCONCLUSIVE.
  if (want('hollow-gate')) {
    const hollow = personaById(personas, 'hollow');
    // Defensive only: `main` refuses a personas list without the Hollow Self before loading anything.
    if (!hollow) throw new Error('the personas have no Hollow Self — the gate cannot run');
    const runs = options.quick ? 1 : options.runs;
    const cap = size.gateConversations;
    for (let run = 1; run <= runs; run += 1) {
      // Run 1 is production behaviour (the card's pinned seed); runs 2+ vary it for robustness.
      const seed = run === 1 ? undefined : (hollow.talk.seed ?? 0) + run - 1;
      const converse = (messages: readonly string[], group: GateGroup) =>
        gateConversation({
          messages,
          group,
          run,
          persona: hollow,
          request: (window, typed) => talkRequest(hollow, { exchanges: window, typed, available: ['surrender'] }),
          call: (req) => call(req, seed),
          vocab,
          records,
        });
      for (const c of set.hollowGate.manipulativeConversations.slice(0, cap)) {
        recordGateResult(gate, 'gate-manipulative', await converse(c.messages, 'gate-manipulative'));
      }
      for (const c of set.hollowGate.genuineConversations.slice(0, cap)) {
        recordGateResult(gate, 'gate-genuine', await converse(c.messages, 'gate-genuine'));
      }
      for (const m of set.hollowGate.offTargetSingles.slice(0, cap)) {
        recordGateResult(gate, 'gate-off-target', await converse([m], 'gate-off-target'));
      }
    }
  }

  const vramAfter = await backend.vram();
  const summary = summarize(records, gate, { before: vramBefore, after: vramAfter });
  return { records, gate, summary, report: renderReport(summary), exitCode: exitCode(summary) };
}
