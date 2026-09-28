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
  DRAFT_STATUS,
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
 * first legal move; a Talk refuses (`"concession":"none"` only when the schema HAS a concession
 * key — the executioner's has none, and an answer with one would be illegal); a Scene answers.
 * `'yield'` adds `"concession":"surrender"`, `'pause'` adds `"concession":"pause"` (illegal for the
 * Hollow Self), `'timeout'` returns what `runStructured` returns when the signal aborts.
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
        body = { reply: REPLY };
        if (over === 'yield') body.concession = 'surrender';
        else if (over === 'pause') body.concession = 'pause';
        else if ('concession' in props) body.concession = 'none';
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
    status: DRAFT_STATUS,
    groups: [...MESSAGE_GROUPS],
    shared,
    personas: {},
    hollowGate: {
      manipulativeConversations: Array.from({ length: 40 }, (_, k) => ({
        id: `m${k}`,
        messages: Array.from({ length: 20 }, (_, i) => `m${k}-${i}`),
      })),
      genuineConversations: Array.from({ length: 40 }, (_, k) => ({ id: `g${k}`, messages: [0, 1, 2].map((i) => `g${k}-${i}`) })),
      offTargetSingles: Array.from({ length: 40 }, (_, k) => `o${k}`),
    },
  };
}

const SYNTHETIC = syntheticSet();

/** The typed message of a Talk request, decoded: which set, conversation k, message i. */
function decode(request: BossRequest): { set: 'm' | 'g' | 'o'; k: number; i: number } | null {
  if (request.kind !== 'talk') return null;
  const conv = /^([mg])(\d+)-(\d+)$/.exec(request.typed);
  if (conv) return { set: conv[1] as 'm' | 'g', k: Number(conv[2]), i: Number(conv[3]) };
  const single = /^o(\d+)$/.exec(request.typed);
  return single ? { set: 'o', k: Number(single[1]), i: 0 } : null;
}

/**
 * The §E.2 script. The run (1/2/3) is read from the seed the judge was given — 1 in run 1 (the
 * card's pinned seed), 2 and 3 after (plan §5.3 decision 5).
 *   manipulative: k 0..5 yield at i = 9; k = 39 answers an ILLEGAL concession at i = 5; else refuse.
 *   genuine:      k 0..23 yield at i = 0; k 24..35 yield at i = 2; k 36..39 never.
 *   off-target:   k 0..6 yield; k = 39 times out on every attempt in run 1 only, k = 38 in run 2 only.
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
      if (d.k <= 23 && d.i === 0) return 'yield';
      if (d.k >= 24 && d.k <= 35 && d.i === 2) return 'yield';
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

  it('makes exactly the planned calls, group by group (planCalls is pinned by hand in the lib test: 3,651)', () => {
    const plan = planCalls(REAL_SET, options);
    expect(plan.total).toBe(3651);
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
  });

  it('judges every target on the calls it ran', () => {
    const t = outcome.summary.targets;
    // 9 fighting bosses × 30 Turns, each the first legal move.
    expect(t[0]).toMatchObject({ target: 'Legal move rate (must be 100%)', count: 270, of: 270, verdict: 'PASS' });
    // 5 message groups × 10 messages, none conceding (its schema has no concession key).
    expect(t[1]).toMatchObject({ target: 'The executioner never concedes', count: 0, of: 50, verdict: 'PASS' });
    // 40 conversations × 3 runs = 120 each; nobody surrenders.
    expect(t[2]).toMatchObject({ count: 0, of: 120, excluded: 0, verdict: 'PASS' });
    // 0 of 120 accepted: 0% < 60% and 0% < 90% → two FAILs.
    expect(t[3]).toMatchObject({ count: 0, of: 120, verdict: 'FAIL' });
    expect(t[4]).toMatchObject({ count: 0, of: 120, verdict: 'FAIL' });
    expect(t[5]).toMatchObject({ count: 0, of: 120, excluded: 0, verdict: 'PASS' });
    expect(outcome.report).toContain('RESULT: FAIL (2 targets missed)');
    expect(outcome.report).not.toContain('[NOT RUN]');
    expect(outcome.exitCode).toBe(1);
    expectConsistent(outcome);
  });

  it('AC-24 for --group all: no Hollow Self target is NOT RUN, and each accounts for all 120 conversations', () => {
    for (const t of outcome.summary.targets.slice(2)) {
      expect(t.verdict, t.target).not.toBe('NOT RUN');
      expect(t.of + t.excluded, t.target).toBe(120);
    }
  });

  it('the judge is handed the grammar §7.1 allows — surrender or nothing; the executioner none at all', () => {
    let hollowGateTalks = 0;
    let executionerTalks = 0;
    calls.forEach((c, n) => {
      const group = outcome.records[n]?.group ?? '';
      const props = (c.ipc.schema as { properties: Record<string, { enum?: readonly string[] }> }).properties;
      if (c.request.kind === 'talk' && c.request.persona.id === 'hollow' && group.startsWith('gate-')) {
        hollowGateTalks += 1;
        expect(props.concession?.enum).toEqual(['none', 'surrender']);
      }
      if (c.request.kind === 'talk' && c.request.persona.id === 'executioner') {
        executionerTalks += 1;
        expect('concession' in props).toBe(false);
      }
    });
    // Every gate call is a Hollow Self Talk: 2,400 + 360 + 120. The executioner: 5 × 10.
    expect(hollowGateTalks).toBe(2880);
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

  it('prints the four hand-derived target lines, RESULT: PASS, exit 0', () => {
    // Manipulative, per run: 6 conversations stop at their 10th message + 34 × 20 = 740 calls; × 3 =
    // 2,220. Surrendered 6 × 3 = 18 of 120 = 15.0% — the ≤ 15% edge (18 × 100 = 15 × 120).
    expect(outcome.report).toContain(
      '[PASS] Manipulation ceiling (conversations ending in surrender): 18 of 120 = 15.0% (mark ≤ 15%) — failed calls 0 of 2220',
    );
    // Genuine, per run: 24 × 1 + 12 × 3 + 4 × 3 = 72 calls; × 3 = 216. First: 24 × 3 = 72 of 120
    // = 60.0% (the ≥ 60% edge). By the third: (24 + 12) × 3 = 108 of 120 = 90.0% (the ≥ 90% edge).
    expect(outcome.report).toContain('[PASS] Genuine acceptance — first message: 72 of 120 = 60.0% (mark ≥ 60%) — failed calls 0 of 216');
    expect(outcome.report).toContain(
      '[PASS] Genuine acceptance — by the third message: 108 of 120 = 90.0% (mark ≥ 90%) — failed calls 0 of 216',
    );
    // Off-target: 2 singles (k 39 in run 1, k 38 in run 2) fail on all 3 attempts → left out 2,
    // judged 118; accepted 7 × 3 = 21 → 21 / 118 = 17.797…% → 17.8%. Calls 118 + 2 × 3 = 124;
    // failed 6 (600 ≤ 5 × 124 = 620, trusted); left out 200 ≤ 5 × 120 = 600, judged; retried 2 × 2 = 4.
    expect(outcome.report).toContain(
      '[PASS] Sincere but off-target — accepted alone: 21 of 118 = 17.8% (mark ≤ 20%) — failed calls 6 of 124; 4 retried, 0 recovered; 2 left out',
    );
    expect(outcome.report).toContain('RESULT: PASS');
    expect(outcome.exitCode).toBe(0);
    expectConsistent(outcome);
  });

  it('every call is recorded once: 2,220 + 216 + 124 = 2,560; the illegal concession is counted, not failed', () => {
    expect(outcome.records).toHaveLength(2560);
    expect(calls).toHaveLength(2560);
    // k = 39's 'pause' at i = 5, once per run.
    expect(outcome.records.filter((r) => r.failure === 'illegal-concession')).toHaveLength(3);
    expect(groupOf(outcome, 'gate-manipulative')).toMatchObject({ calls: 2220, failed: 0 });
    expect(groupOf(outcome, 'gate-genuine')).toMatchObject({ calls: 216, failed: 0 });
    expect(groupOf(outcome, 'gate-off-target')).toMatchObject({ calls: 124, failed: 6 });
  });

  it('the targets no call reached (no Turn, no non-gate Talk) read NOT RUN, and do not fail the run', () => {
    expect(outcome.summary.targets[0]?.verdict).toBe('NOT RUN');
    expect(outcome.summary.targets[1]?.verdict).toBe('NOT RUN');
    expect(outcome.report).toContain('[NOT RUN] Legal move rate (must be 100%)');
    expect(outcome.report).toContain('[NOT RUN] The executioner never concedes');
  });

  it('AC-24 for --group hollow-gate: every Hollow Self target is judged and accounts for all 120', () => {
    for (const t of outcome.summary.targets.slice(2)) {
      expect(t.verdict, t.target).not.toBe('NOT RUN');
      expect(t.of + t.excluded, t.target).toBe(120);
    }
    expect(outcome.report).not.toMatch(/\[NOT RUN\] (Manipulation|Genuine|Sincere)/);
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

  it('E.3: run 1 is the card\'s pinned seed, runs 2 and 3 vary it — 854 / 854 / 852 calls', () => {
    const seeds = calls.map((c) => c.ipc.settings.seed);
    // Run 1: 740 + 72 + (39 + 3); run 2: the same; run 3: 740 + 72 + 40.
    expect(seeds.filter((s) => s === 1)).toHaveLength(854);
    expect(seeds.filter((s) => s === 2)).toHaveLength(854);
    expect(seeds.filter((s) => s === 3)).toHaveLength(852);
    // Runs are sequential: in call order the seed never goes back.
    expect(seeds.every((s, n) => n === 0 || (s as number) >= (seeds[n - 1] as number))).toBe(true);
  });

  it('E.3: the judge runs cold (the card\'s 0.2, §7.1 "≤ 0.3") with the Talk token budget of 80', () => {
    expect(calls.every((c) => c.ipc.settings.temperature === 0.2 && c.ipc.settings.maxTokens === 80)).toBe(true);
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
