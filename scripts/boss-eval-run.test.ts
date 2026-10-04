// THE STRUCTURAL GUARD on the boss evaluation (fix round 3, plan amendment §E).
//
// This file runs the evaluation's REAL run — `runEvaluation`, the module the process entry itself
// calls: the real Turn/Talk/Scene loops, the real Hollow Self gate, the real queue with the shipped
// 3 s deadline, the real prompt builders and parser, the real summary, report and exit status —
// against a FAKE model. It asserts what the run REPORTS, not what its source looks like, so the
// class of hole three fix rounds kept reopening ("a target reads PASS or NOT RUN while its
// conversations ran") cannot come back without a red test here, however the code is arranged.
//
// NEVER the real model. Every expected number below is derived BY HAND from the fake's script
// (the comment beside it shows the arithmetic) — none was read off a run. No real timers: the
// queue's clock and timers are injected in every scenario, so nothing here waits or is load-sensitive.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BossIpcRequest, BossPersona, BossRequest } from '../src/llm/bossContract.ts';
import { FIXTURE_PERSONAS, FIXTURE_PERSONA_LIST } from '../src/llm/bossFixtures.testutil.ts';
import {
  REVIEWED_STATUS,
  MESSAGE_GROUPS,
  exitCode,
  messageSetProblems,
  planCalls,
  renderReport,
  type CallGroup,
  type EvalOptions,
  type MessageSet,
  type RawResult,
} from './boss-eval-lib.ts';
import { runEvaluation, type EvalBackend, type QueueDeps, type RunOutcome } from './boss-eval-run.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SET = JSON.parse(readFileSync(path.join(HERE, 'boss-eval', 'messages.json'), 'utf8')) as MessageSet;

// ---------------------------------------------------------------------------------------------
// The fake model
// ---------------------------------------------------------------------------------------------

/** How the fake departs from its default answer for one call. */
type Override = 'yield' | 'pause' | 'timeout' | undefined;
/** `n` is the call's 1-based position in the run. */
type Script = (request: BossRequest, ipc: BossIpcRequest, n: number) => Override;

interface Recorded {
  ipc: BossIpcRequest;
  request: BossRequest;
}

const REPLY = 'I am still here.';

/** A successful result, shaped like `runStructured`'s (the lib test's `answer()`). */
const answer = (text: string): RawResult => ({
  ok: true,
  text,
  timedOut: false,
  ttftMs: 300,
  generateMs: 900,
  grammarMs: 10,
  promptTokens: 850,
  tokens: 30,
});

/**
 * A backend that records every call and answers BY THE SCHEMA IT WAS HANDED: a Turn plays the
 * first legal move; a Talk refuses — `{reason, earned: "no", reply}` when the schema asks for a
 * judgement, `{reply}` when it does not (the executioner; a boss that already yielded); a Scene
 * answers. `'yield'` judges `"earned":"yes"` (whatever the schema allows — against a schema with no
 * judgement that is an illegal concession), `'pause'` judges `"earned":"maybe"` (outside no|yes: an
 * illegal concession), `'timeout'` returns what `runStructured` returns when the signal aborts.
 */
function fakeBackend(script: Script = () => undefined): { backend: EvalBackend; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const backend: EvalBackend = {
    async generate(ipc, { request }) {
      calls.push({ ipc, request });
      const over = script(request, ipc, calls.length);
      if (over === 'timeout') return { ok: false, reason: 'timeout', timedOut: true, generateMs: 3000 };
      const props = (ipc.schema as { properties: Record<string, { enum?: readonly string[] }> }).properties;
      let body: Record<string, string>;
      if (ipc.kind === 'turn') body = { move: props.move?.enum?.[0] ?? '', line: 'Sit down.' };
      else if (ipc.kind === 'talk') {
        const earned = over === 'yield' ? 'yes' : over === 'pause' ? 'maybe' : 'no';
        body = 'earned' in props || over !== undefined ? { reason: 'What they said.', earned, reply: REPLY } : { reply: REPLY };
      } else body = { line: 'I have read you.' };
      return answer(JSON.stringify(body));
    },
    vram: async () => ({ used: 1 }),
  };
  return { backend, calls };
}

/** Injected queue timers: a still clock, and every deadline the queue registers, recorded. */
function stillTimers(): { queueDeps: QueueDeps; deadlines: number[] } {
  const deadlines: number[] = [];
  return {
    deadlines,
    queueDeps: {
      now: () => 0,
      setTimer: (_fn, ms) => {
        deadlines.push(ms);
        return 0;
      },
      clearTimer: () => {},
    },
  };
}

/** The outcome can never disagree with itself (the D24 equivalent: a status set some other way). */
function expectConsistent(outcome: RunOutcome): void {
  expect(outcome.exitCode).toBe(exitCode(outcome.summary));
  expect(outcome.report).toBe(renderReport(outcome.summary));
}

const groupOf = (outcome: RunOutcome, group: CallGroup) => outcome.summary.groups.find((g) => g.group === group);

/** The report row whose first cell is `label`, split into its cells (cells are 2+ spaces apart). */
function row(report: string, label: string): string[] {
  const line = report.split('\n').find((l) => l.startsWith(`  ${label} `));
  expect(line, `no row for ${label}`).toBeDefined();
  return (line as string).trim().split(/\s{2,}/);
}

// ---------------------------------------------------------------------------------------------
// The synthetic message set: every text unique, so the fake decodes (set, k, i) from `typed`.
// ---------------------------------------------------------------------------------------------

function syntheticSet(): MessageSet {
  const shared = Object.fromEntries(MESSAGE_GROUPS.map((g) => [g, Array.from({ length: 10 }, (_, i) => `shared ${g} ${i + 1}`)]));
  return {
    status: REVIEWED_STATUS,
    groups: [...MESSAGE_GROUPS],
    shared,
    personas: {},
    hollowGate: {
      manipulativeConversations: Array.from({ length: 40 }, (_, k) => ({
        id: `m${k}`,
        messages: Array.from({ length: 20 }, (_, i) => `m${k}-${i}`),
      })),
      // k 0..19 explicit, 20..39 hesitant — the reviewed set's halves (G85).
      genuineConversations: Array.from({ length: 40 }, (_, k) => ({
        id: `g${k}`,
        mix: k < 20 ? 'explicit' : 'hesitant',
        messages: [0, 1, 2].map((i) => `g${k}-${i}`),
      })),
      offTargetSingles: Array.from({ length: 40 }, (_, k) => `o${k}`),
      connectionConversations: Array.from({ length: 20 }, (_, k) => ({ id: `c${k}`, messages: [`c${k}-0`, `c${k}-1`] })),
    },
  };
}

const SYNTHETIC = syntheticSet();

/** The typed message of a Talk request, decoded: which set, conversation k, message i. */
function decode(request: BossRequest): { set: 'm' | 'g' | 'o' | 'c'; k: number; i: number } | null {
  if (request.kind !== 'talk') return null;
  const conv = /^([mgc])(\d+)-(\d+)$/.exec(request.typed);
  if (conv) return { set: conv[1] as 'm' | 'g' | 'c', k: Number(conv[2]), i: Number(conv[3]) };
  const single = /^o(\d+)$/.exec(request.typed);
  return single ? { set: 'o', k: Number(single[1]), i: 0 } : null;
}

/**
 * The §E.2 script. The run (1/2/3) is read from the seed the judge was given — 1 in run 1 (the
 * card's pinned seed), 2 and 3 after (plan §5.3 decision 5).
 *   manipulative: k 0..5 yield at i = 9; k = 39 answers an ILLEGAL concession at i = 5; else refuse.
 *   genuine:      explicit k 0..11 yield at i = 0, explicit k 12..19 at i = 1; hesitant k 20..35 at i = 2;
 *                 hesitant k 36..39 never.
 *   off-target:   k 0..6 yield; k = 39 times out on every attempt in run 1 only, k = 38 in run 2 only.
 *   connections:  k 0..11 yield at the connecting message (i = 1); k 12..13 yield on the remorse (i = 0);
 *                 k = 19 times out on every attempt at i = 1 in run 2 only; else refuse.
 * Flip A: run 1's k = 6 also yields at i = 9. Flip B: run 3's k = 37 also times out every attempt.
 */
function gateScript(flips: { a?: boolean; b?: boolean } = {}): Script {
  return (request, ipc) => {
    const d = decode(request);
    if (!d) return undefined;
    const run = ipc.settings.seed;
    if (d.set === 'm') {
      if (d.i === 9 && (d.k <= 5 || (flips.a === true && run === 1 && d.k === 6))) return 'yield';
      if (d.k === 39 && d.i === 5) return 'pause';
      return undefined;
    }
    if (d.set === 'g') {
      if (d.k <= 11 && d.i === 0) return 'yield';
      if (d.k >= 12 && d.k <= 19 && d.i === 1) return 'yield';
      if (d.k >= 20 && d.k <= 35 && d.i === 2) return 'yield';
      return undefined;
    }
    if (d.set === 'c') {
      if (d.k <= 11 && d.i === 1) return 'yield';
      if (d.k >= 12 && d.k <= 13 && d.i === 0) return 'yield';
      if (d.k === 19 && d.i === 1 && run === 2) return 'timeout';
      return undefined;
    }
    if (d.k <= 6) return 'yield';
    if (d.k === 39 && run === 1) return 'timeout';
    if (d.k === 38 && run === 2) return 'timeout';
    if (flips.b === true && d.k === 37 && run === 3) return 'timeout';
    return undefined;
  };
}

const GATE: EvalOptions = { group: 'hollow-gate', runs: 3, quick: false };

it('the synthetic set is a valid message set (the run would refuse one that is not)', () => {
  expect(messageSetProblems(SYNTHETIC)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// E.1 — the full real plan, every call accounted for
// ---------------------------------------------------------------------------------------------

describe('E.1: the full plan against a model that always refuses — every call made, every target judged', () => {
  const options: EvalOptions = { group: 'all', runs: 3, quick: false };
  let outcome: RunOutcome;
  let calls: Recorded[];
  let deadlines: number[];

  beforeAll(async () => {
    const fake = fakeBackend();
    const timers = stillTimers();
    calls = fake.calls;
    deadlines = timers.deadlines;
    outcome = await runEvaluation({ personas: FIXTURE_PERSONA_LIST, set: REAL_SET, options, backend: fake.backend, queueDeps: timers.queueDeps });
  });

  it('makes exactly the planned calls, group by group (planCalls is pinned by hand in the lib test: 3,771)', () => {
    const plan = planCalls(REAL_SET, options);
    expect(plan.total).toBe(3771);
    expect(outcome.records).toHaveLength(plan.total);
    expect(calls).toHaveLength(plan.total);
    expect(deadlines).toHaveLength(plan.total);
    // Nobody surrenders and nothing fails, so no conversation stops early and no retry is added:
    // every group makes exactly its planned number of calls.
    expect(groupOf(outcome, 'turn')).toMatchObject({ calls: plan.turn, failed: 0, inconclusive: false });
    expect(groupOf(outcome, 'talk')).toMatchObject({ calls: plan.talk, failed: 0, inconclusive: false });
    expect(groupOf(outcome, 'scene')).toMatchObject({ calls: plan.scene, failed: 0, inconclusive: false });
    expect(groupOf(outcome, 'gate-manipulative')).toMatchObject({ calls: plan.gateManipulative, failed: 0, inconclusive: false });
    expect(groupOf(outcome, 'gate-genuine')).toMatchObject({ calls: plan.gateGenuine, failed: 0, inconclusive: false });
    expect(groupOf(outcome, 'gate-off-target')).toMatchObject({ calls: plan.gateOffTarget, failed: 0, inconclusive: false });
    expect(groupOf(outcome, 'gate-connections')).toMatchObject({ calls: plan.gateConnections, failed: 0, inconclusive: false });
  });

  it('judges every target on the calls it ran', () => {
    const t = outcome.summary.targets;
    // 9 fighting bosses × 30 Turns, each the first legal move.
    expect(t[0]).toMatchObject({ target: 'Legal move rate (must be 100%)', count: 270, of: 270, verdict: 'PASS' });
    // 5 message groups × 10 messages, none conceding (its schema has no concession key).
    expect(t[1]).toMatchObject({ target: 'The executioner never concedes', count: 0, of: 50, verdict: 'PASS' });
    // 40 conversations × 3 runs = 120 each; nobody surrenders.
    expect(t[2]).toMatchObject({ count: 0, of: 120, excluded: 0, verdict: 'PASS' });
    // 0 of 60 explicit openers accepted first (20 × 3 runs, G85), 0 of 120 by the third: two FAILs.
    expect(t[3]).toMatchObject({ count: 0, of: 60, verdict: 'FAIL' });
    expect(t[4]).toMatchObject({ count: 0, of: 120, verdict: 'FAIL' });
    expect(t[5]).toMatchObject({ count: 0, of: 120, excluded: 0, verdict: 'PASS' });
    // 20 connection conversations × 3 runs = 60; none accepted: 0% < 70% → a third FAIL.
    expect(t[6]).toMatchObject({ target: 'Remorse, then connecting — accepted by the connecting message', count: 0, of: 60, excluded: 0, verdict: 'FAIL' });
    expect(outcome.report).toContain('RESULT: FAIL (3 targets missed)');
    expect(outcome.report).not.toContain('[NOT RUN]');
    expect(outcome.exitCode).toBe(1);
    expectConsistent(outcome);
  });

  it('AC-24 for --group all: no Hollow Self target is NOT RUN, and each accounts for all its conversations', () => {
    // 40 conversations × 3 runs, except the first-message target (the 20 explicit × 3, G85) and the
    // connections (20 × 3).
    expect(outcome.summary.targets.slice(2).map((t) => [t.verdict !== 'NOT RUN', t.of + t.excluded])).toEqual([
      [true, 120],
      [true, 60],
      [true, 120],
      [true, 120],
      [true, 60],
    ]);
  });

  it('the judge is asked to judge (earned no|yes) with only the surrender to give; the executioner is never asked', () => {
    let hollowGateTalks = 0;
    let executionerTalks = 0;
    calls.forEach((c, n) => {
      const group = outcome.records[n]?.group ?? '';
      const props = (c.ipc.schema as { properties: Record<string, { enum?: readonly string[] }> }).properties;
      if (c.request.kind === 'talk' && c.request.persona.id === 'hollow' && group.startsWith('gate-')) {
        hollowGateTalks += 1;
        // §7.1: the Hollow Self may surrender and nothing else — the engine yields available[0].
        expect(props.earned?.enum).toEqual(['no', 'yes']);
        expect(c.request.available).toEqual(['surrender']);
      }
      if (c.request.kind === 'talk' && c.request.persona.id === 'executioner') {
        executionerTalks += 1;
        expect(Object.keys(props)).toEqual(['reply']);
      }
    });
    // Every gate call is a Hollow Self Talk: 2,400 + 360 + 120 + 120. The executioner: 5 × 10.
    expect(hollowGateTalks).toBe(3000);
    expect(executionerTalks).toBe(50);
  });
});

// ---------------------------------------------------------------------------------------------
// E.2 / E.3 — the scripted gate: the §7.1 arithmetic through the real driver
// ---------------------------------------------------------------------------------------------

describe('E.2: the scripted gate — each §7.1 target at its edge, through the real driver', () => {
  let outcome: RunOutcome;
  let calls: Recorded[];
  let deadlines: number[];

  beforeAll(async () => {
    const fake = fakeBackend(gateScript());
    const timers = stillTimers();
    calls = fake.calls;
    deadlines = timers.deadlines;
    outcome = await runEvaluation({ personas: FIXTURE_PERSONA_LIST, set: SYNTHETIC, options: GATE, backend: fake.backend, queueDeps: timers.queueDeps });
  });

  it('prints the five hand-derived Hollow Self target lines, RESULT: PASS, exit 0', () => {
    // Manipulative, per run: 6 conversations stop at their 10th message + 34 × 20 = 740 calls; × 3 =
    // 2,220. Surrendered 6 × 3 = 18 of 120 = 15.0% — the ≤ 15% edge (18 × 100 = 15 × 120).
    expect(outcome.report).toContain(
      '[PASS] Manipulation ceiling (conversations ending in surrender): 18 of 120 = 15.0% (mark ≤ 15%) — failed calls 0 of 2220',
    );
    // Genuine, per run: 12 × 1 + 8 × 2 + 16 × 3 + 4 × 3 = 88 calls; × 3 = 264. First (explicit half only,
    // G85): 12 × 3 = 36 of 60 = 60.0% (the ≥ 60% edge). By the third: (12 + 8 + 16) × 3 = 108 of 120 = 90.0%.
    expect(outcome.report).toContain(
      '[PASS] Genuine acceptance — first message (explicit openers): 36 of 60 = 60.0% (mark ≥ 60%) — failed calls 0 of 264',
    );
    expect(outcome.report).toContain(
      '[PASS] Genuine acceptance — by the third message: 108 of 120 = 90.0% (mark ≥ 90%) — failed calls 0 of 264',
    );
    // Off-target: 2 singles (k 39 in run 1, k 38 in run 2) fail on all 3 attempts → left out 2,
    // judged 118; accepted 7 × 3 = 21 → 21 / 118 = 17.797…% → 17.8%. Calls 118 + 2 × 3 = 124;
    // failed 6 (600 ≤ 5 × 124 = 620, trusted); left out 200 ≤ 5 × 120 = 600, judged; retried 2 × 2 = 4.
    expect(outcome.report).toContain(
      '[PASS] Sincere but off-target — accepted alone: 21 of 118 = 17.8% (mark ≤ 20%) — failed calls 6 of 124; 4 retried, 0 recovered; 2 left out',
    );
    // Connections, per run: 12 × 2 + 2 × 1 + 6 × 2 = 38 calls; run 2's k = 19 asks its connecting message
    // 3 times (1 + 2 retries) → 40; total 38 + 40 + 38 = 116, failed 3 (300 ≤ 5 × 116 = 580, trusted).
    // Left out 1 (100 ≤ 5 × 60 = 300, judged); accepted 14 × 3 = 42 of 59 = 71.186…% → 71.2% (≥ 70%).
    expect(outcome.report).toContain(
      '[PASS] Remorse, then connecting — accepted by the connecting message: 42 of 59 = 71.2% (mark ≥ 70%) — failed calls 3 of 116; 2 retried, 0 recovered; 1 left out',
    );
    expect(outcome.report).toContain('RESULT: PASS');
    expect(outcome.exitCode).toBe(0);
    expectConsistent(outcome);
  });

  it('every call is recorded once: 2,220 + 264 + 124 + 116 = 2,724; the illegal concession is counted, not failed', () => {
    expect(outcome.records).toHaveLength(2724);
    expect(calls).toHaveLength(2724);
    // k = 39's 'pause' at i = 5, once per run.
    expect(outcome.records.filter((r) => r.failure === 'illegal-concession')).toHaveLength(3);
    expect(groupOf(outcome, 'gate-manipulative')).toMatchObject({ calls: 2220, failed: 0 });
    expect(groupOf(outcome, 'gate-genuine')).toMatchObject({ calls: 264, failed: 0 });
    expect(groupOf(outcome, 'gate-off-target')).toMatchObject({ calls: 124, failed: 6 });
    expect(groupOf(outcome, 'gate-connections')).toMatchObject({ calls: 116, failed: 3 });
  });

  it('the targets no call reached (no Turn, no non-gate Talk) read NOT RUN, and do not fail the run', () => {
    expect(outcome.summary.targets[0]?.verdict).toBe('NOT RUN');
    expect(outcome.summary.targets[1]?.verdict).toBe('NOT RUN');
    expect(outcome.report).toContain('[NOT RUN] Legal move rate (must be 100%)');
    expect(outcome.report).toContain('[NOT RUN] The executioner never concedes');
  });

  it('AC-24 for --group hollow-gate: every Hollow Self target is judged and accounts for all its conversations', () => {
    // 40 conversations × 3 runs, except the first-message target (the 20 explicit × 3, G85) and the
    // connections (20 × 3).
    expect(outcome.summary.targets.slice(2).map((t) => [t.verdict !== 'NOT RUN', t.of + t.excluded])).toEqual([
      [true, 120],
      [true, 60],
      [true, 120],
      [true, 120],
      [true, 60],
    ]);
    expect(outcome.report).not.toMatch(/\[NOT RUN\] (Manipulation|Genuine|Sincere|Remorse)/);
  });

  // ---- E.3 — what the judge is shown (same run) ----

  it('E.3: the judge sees the last six exchanges (§7.1) — on the request AND in the prompt', () => {
    let checked = 0;
    calls.forEach(({ ipc, request }) => {
      const d = decode(request);
      if (!d || d.set !== 'm' || request.kind !== 'talk') return;
      checked += 1;
      const { k, i } = d;
      expect(request.exchanges.length, `m${k}-${i}`).toBe(Math.min(i, 6));
      if (i >= 1) {
        const last = request.exchanges[request.exchanges.length - 1];
        expect(last?.them).toBe(`m${k}-${i - 1}`);
        // The reply SHOWN on the previous call — except after k = 39's illegal answer at i = 5,
        // which the game shows as a fallback line (§6).
        if (k === 39 && i === 6) expect(FIXTURE_PERSONAS.hollow.fallbackLines).toContain(last?.you);
        else expect(last?.you).toBe(REPLY);
        expect(ipc.prompt).toContain(`"m${k}-${i - 1}"`);
      }
      if (i >= 7) expect(ipc.prompt, `m${k}-${i}`).not.toContain(`"m${k}-${i - 7}"`);
    });
    expect(checked).toBe(2220);
  });

  it('E.3: run 1 is the card\'s pinned seed, runs 2 and 3 vary it — 908 / 910 / 906 calls', () => {
    const seeds = calls.map((c) => c.ipc.settings.seed);
    // Run 1: 740 + 88 + (39 + 3) + 38; run 2: 740 + 88 + (39 + 3) + 40; run 3: 740 + 88 + 40 + 38.
    expect(seeds.filter((s) => s === 1)).toHaveLength(908);
    expect(seeds.filter((s) => s === 2)).toHaveLength(910);
    expect(seeds.filter((s) => s === 3)).toHaveLength(906);
    // Runs are sequential: in call order the seed never goes back.
    expect(seeds.every((s, n) => n === 0 || (s as number) >= (seeds[n - 1] as number))).toBe(true);
  });

  it('E.3: the judge runs cold (the card\'s 0.2, §7.1 "≤ 0.3") with the judged Talk token budget of 120', () => {
    expect(calls.every((c) => c.ipc.settings.temperature === 0.2 && c.ipc.settings.maxTokens === 120)).toBe(true);
  });

  it('E.3: the shipped 3 s deadline reaches the queue on every call', () => {
    expect(deadlines).toHaveLength(outcome.records.length);
    expect(deadlines.every((ms) => ms === 3000)).toBe(true);
    expect(calls.every((c) => c.ipc.settings.deadlineMs === 3000)).toBe(true);
  });
});

describe('E.2 flips: one conversation either way moves the verdict', () => {
  const run = async (flips: { a?: boolean; b?: boolean }) => {
    const fake = fakeBackend(gateScript(flips));
    const { queueDeps } = stillTimers();
    return runEvaluation({ personas: FIXTURE_PERSONA_LIST, set: SYNTHETIC, options: GATE, backend: fake.backend, queueDeps });
  };

  it('Flip A — one more surrender: 19 of 120 = 15.8% misses the ceiling, exit 1', async () => {
    const outcome = await run({ a: true });
    expect(outcome.report).toContain('[FAIL] Manipulation ceiling (conversations ending in surrender): 19 of 120 = 15.8% (mark ≤ 15%)');
    expect(outcome.report).toContain('RESULT: FAIL (1 target missed)');
    expect(outcome.exitCode).toBe(1);
    expectConsistent(outcome);
  });

  it('Flip B — one more failed single: 9 of 126 off-target calls failed, the group is INCONCLUSIVE, exit 3', async () => {
    // Left out 3 (300 ≤ 5 × 120 = 600) but failed calls 9 of 118 − 1 + 3 × 3 = 126 (900 > 630).
    // Judged 117; accepted still 21 → 21 / 117 = 17.948…% → 17.9%. Retried 3 × 2 = 6.
    const outcome = await run({ b: true });
    expect(outcome.report).toContain(
      '[INCONCLUSIVE] Sincere but off-target — accepted alone: 21 of 117 = 17.9% (mark ≤ 20%) — failed calls 9 of 126; 6 retried, 0 recovered; 3 left out',
    );
    expect(outcome.report).toContain('RESULT: INCONCLUSIVE (too many failed calls in: gate-off-target)');
    expect(outcome.exitCode).toBe(3);
    expectConsistent(outcome);
  });
});

// ---------------------------------------------------------------------------------------------
// The connections target at its edges (the author, 2026-09-29), through the real driver
// ---------------------------------------------------------------------------------------------

describe('connections: ≥ 70% accepted by the connecting message — the edges, end to end', () => {
  /**
   * One run, and every other set scripted to pass so only the connections decide the result:
   * manipulative 0 of 40 surrender (PASS), genuine 40 of 40 accept on message one (PASS, PASS),
   * off-target 0 of 40 accept (PASS). Connections: k < `accepted` yield at the connecting message;
   * `failing` conversations time out on every attempt at it; the rest refuse.
   */
  const run = (accepted: number, failing: readonly number[] = []) => {
    const fake = fakeBackend((request) => {
      const d = decode(request);
      if (!d) return undefined;
      if (d.set === 'g') return d.i === 0 ? 'yield' : undefined;
      if (d.set !== 'c' || d.i !== 1) return undefined;
      if (failing.includes(d.k)) return 'timeout';
      return d.k < accepted ? 'yield' : undefined;
    });
    const { queueDeps } = stillTimers();
    return runEvaluation({ personas: FIXTURE_PERSONA_LIST, set: SYNTHETIC, options: { group: 'hollow-gate', runs: 1, quick: false }, backend: fake.backend, queueDeps });
  };

  it('14 of 20 = 70.0% — the edge — PASS, exit 0', async () => {
    // 20 conversations × 2 messages = 40 calls; 14 × 100 = 70 × 20.
    const outcome = await run(14);
    expect(outcome.report).toContain('[PASS] Remorse, then connecting — accepted by the connecting message: 14 of 20 = 70.0% (mark ≥ 70%) — failed calls 0 of 40');
    expect(outcome.report).toContain('RESULT: PASS');
    expect(outcome.exitCode).toBe(0);
    expectConsistent(outcome);
  });

  it('13 of 20 = 65.0% — one short — FAIL, exit 1', async () => {
    const outcome = await run(13);
    expect(outcome.report).toContain('[FAIL] Remorse, then connecting — accepted by the connecting message: 13 of 20 = 65.0% (mark ≥ 70%) — failed calls 0 of 40');
    expect(outcome.report).toContain('RESULT: FAIL (1 target missed)');
    expect(outcome.exitCode).toBe(1);
    expectConsistent(outcome);
  });

  it('a conversation left out is never a refusal — INCONCLUSIVE, exit 3', async () => {
    // 14 accept; k = 19 fails its connecting message 3 times. Calls 14 × 2 + 5 × 2 + (1 + 3) = 42,
    // failed 3 → 300 > 5 × 42 = 210: the group cannot be trusted. Judged 19; 14 of 19 = 73.68…% → 73.7%.
    // (At 20 conversations the per-call rule trips before the 5% left-out rule can: one conversation
    // failing every attempt is 3 of at most 42 calls.)
    const outcome = await run(14, [19]);
    expect(outcome.report).toContain(
      '[INCONCLUSIVE] Remorse, then connecting — accepted by the connecting message: 14 of 19 = 73.7% (mark ≥ 70%) — failed calls 3 of 42; 2 retried, 0 recovered; 1 left out',
    );
    expect(outcome.report).toContain('RESULT: INCONCLUSIVE (too many failed calls in: gate-connections)');
    expect(outcome.exitCode).toBe(3);
    expectConsistent(outcome);
  });
});

// ---------------------------------------------------------------------------------------------
// G85 — the first-message target on the explicit half only (the author, 2026-09-29), end to end
// ---------------------------------------------------------------------------------------------

describe('G85: first-message acceptance is judged on the explicit openers only — the edges, end to end', () => {
  /**
   * One run, every other set scripted to pass (manipulative 0 of 40, off-target 0 of 40, connections
   * 20 of 20 at the connecting message). Genuine: explicit k < `first` accept on message one, the other
   * explicit ones on message two; EVERY hesitant one accepts on message one — so if the hesitant half
   * counted, (first + 20) of 40 would pass at any `first` ≥ 4.
   */
  const run = (first: number) => {
    const fake = fakeBackend((request) => {
      const d = decode(request);
      if (!d) return undefined;
      if (d.set === 'c') return d.i === 1 ? 'yield' : undefined;
      if (d.set !== 'g') return undefined;
      if (d.k >= 20) return d.i === 0 ? 'yield' : undefined;
      return d.i === (d.k < first ? 0 : 1) ? 'yield' : undefined;
    });
    const { queueDeps } = stillTimers();
    return runEvaluation({ personas: FIXTURE_PERSONA_LIST, set: SYNTHETIC, options: { group: 'hollow-gate', runs: 1, quick: false }, backend: fake.backend, queueDeps });
  };

  it('12 of 20 explicit = 60.0% — the edge — PASS, exit 0', async () => {
    // Genuine calls: 12 × 1 + 8 × 2 + 20 × 1 = 48. By the third: 40 of 40.
    const outcome = await run(12);
    expect(outcome.report).toContain('[PASS] Genuine acceptance — first message (explicit openers): 12 of 20 = 60.0% (mark ≥ 60%) — failed calls 0 of 48');
    expect(outcome.report).toContain('[PASS] Genuine acceptance — by the third message: 40 of 40 = 100.0% (mark ≥ 90%) — failed calls 0 of 48');
    expect(outcome.report).toContain('RESULT: PASS');
    expect(outcome.exitCode).toBe(0);
    expectConsistent(outcome);
  });

  it('11 of 20 explicit = 55.0% — one short — FAIL, exit 1, though every hesitant opener accepted at once', async () => {
    // Genuine calls: 11 × 1 + 9 × 2 + 20 × 1 = 49.
    const outcome = await run(11);
    expect(outcome.report).toContain('[FAIL] Genuine acceptance — first message (explicit openers): 11 of 20 = 55.0% (mark ≥ 60%) — failed calls 0 of 49');
    expect(outcome.report).toContain('RESULT: FAIL (1 target missed)');
    expect(outcome.exitCode).toBe(1);
    expectConsistent(outcome);
  });
});

// ---------------------------------------------------------------------------------------------
// E.4 — a call cut off by the real deadline
// ---------------------------------------------------------------------------------------------

describe('E.4: a call cut off by the queue\'s deadline', () => {
  it('is recorded as a timeout at 3 s, counted in the turn row, and the next call still runs', async () => {
    let t = 0;
    let armed: (() => void) | null = null;
    const queueDeps: QueueDeps = {
      now: () => t,
      setTimer: (fn) => {
        armed = fn;
        return 0;
      },
      clearTimer: () => {},
    };
    // The 7th call runs past its deadline: the clock moves 3,000 ms and the queue's timer fires.
    const fake = fakeBackend((_req, _ipc, n) => {
      if (n !== 7) return undefined;
      t += 3000;
      (armed as (() => void) | null)?.();
      return 'timeout';
    });
    const outcome = await runEvaluation({
      personas: FIXTURE_PERSONA_LIST,
      set: REAL_SET,
      options: { group: 'turn', runs: 1, quick: true },
      backend: fake.backend,
      queueDeps,
    });
    // Quick: 9 fighting bosses × 10 Turns = 90 — the 8th and every later call still ran.
    expect(outcome.records).toHaveLength(90);
    expect(fake.calls).toHaveLength(90);
    // A timeout has no first token; its only timing is the queue's `ranMs` — the 3,000 ms it ran.
    expect(outcome.records[6]).toMatchObject({ answered: false, failure: 'timeout', legal: null, ttftMs: null, totalMs: 3000 });
    // Kind row: kind · calls · answered · timeout · …
    expect(row(outcome.report, 'turn').slice(0, 4)).toEqual(['turn', '90', '89', '1']);
    // 1 of 90 failed is under 5%: trusted. 89 of 89 legal → PASS; nothing else ran → NOT RUN.
    expect(groupOf(outcome, 'turn')).toMatchObject({ calls: 90, failed: 1, timeout: 1, inconclusive: false });
    expect(outcome.report).toContain('RESULT: PASS');
    expect(outcome.exitCode).toBe(0);
    expectConsistent(outcome);
  });
});

// ---------------------------------------------------------------------------------------------
// E.5 — the structural equivalents of D22 / D24
// ---------------------------------------------------------------------------------------------

describe('E.5: the run refuses a gate it cannot run, and otherwise always reports', () => {
  const noHollow: readonly BossPersona[] = FIXTURE_PERSONA_LIST.filter((p) => p.id !== 'hollow');

  it('a gate run without the Hollow Self REJECTS — it never reports a pass', async () => {
    const { backend } = fakeBackend();
    const { queueDeps } = stillTimers();
    await expect(runEvaluation({ personas: noHollow, set: SYNTHETIC, options: GATE, backend, queueDeps })).rejects.toThrow(/no Hollow Self/);
  });

  it('a Turn-only run does not need the Hollow Self', async () => {
    const { backend } = fakeBackend();
    const { queueDeps } = stillTimers();
    const outcome = await runEvaluation({ personas: noHollow, set: SYNTHETIC, options: { group: 'turn', runs: 3, quick: false }, backend, queueDeps });
    // 8 fighting bosses left × 30 Turns.
    expect(outcome.records).toHaveLength(240);
    expect(outcome.exitCode).toBe(0);
    expectConsistent(outcome);
  });
});
