// The boss evaluation's COMMAND (`main`), driven with fake dependencies (fix round 3, plan §G).
//
// These replace the source scans that used to guard the entry: that nothing loads without
// `--run`, that the model comes from the per-user directory (`VOID_MODELS_DIR` honoured), that the
// exit status IS the run's outcome, that a crash is 4, and that a run which could not judge a target
// is refused before anything loads. NEVER the real model: `loadBackend` returns a scripted fake.
// Expected values are derived by hand in the comments beside them.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BossIpcRequest } from '../src/llm/bossContract.ts';
import { FIXTURE_PERSONA_LIST } from '../src/llm/bossFixtures.testutil.ts';
import { exitCode, type EvalSummary, type RawResult } from './boss-eval-lib.ts';
import { main, type CliDeps, type LoadedBackend } from './boss-eval-cli.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MESSAGES = path.join(HERE, 'boss-eval', 'messages.json');
const MODEL_FILE = 'hf_unsloth_Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
const MODELS = 'D:\\models';

const ok = (text: string): RawResult => ({ ok: true, text, timedOut: false, ttftMs: 300, generateMs: 900, grammarMs: 10, promptTokens: 850, tokens: 30 });

/**
 * A loaded model that answers by the schema it is handed — a Turn plays the first legal move, a
 * Talk refuses (`"earned":"no"` where the schema asks for a judgement, a bare reply where not), a Scene answers —
 * or, with `turnsTimeOut`, returns the aborted-call shape for every Turn.
 */
function fakeModel(opts: { turnsTimeOut?: boolean } = {}): LoadedBackend & { dispose: ReturnType<typeof vi.fn> } {
  return {
    gpu: 'fake',
    dispose: vi.fn(async () => {}),
    vram: async () => ({ used: 1 }),
    async generate(ipc: BossIpcRequest) {
      const props = (ipc.schema as { properties: Record<string, { enum?: readonly string[] }> }).properties;
      if (ipc.kind === 'turn') {
        if (opts.turnsTimeOut) return { ok: false, reason: 'timeout', timedOut: true, generateMs: 3000 };
        return ok(JSON.stringify({ move: props.move?.enum?.[0], line: 'Sit down.' }));
      }
      if (ipc.kind === 'talk') return ok(JSON.stringify('earned' in props ? { demand: 'no', reason: 'Not what moves me.', earned: 'no', reply: 'No.' } : { reply: 'No.' }));
      return ok(JSON.stringify({ line: 'I have read you.' }));
    },
  };
}

interface Fake {
  deps: CliDeps;
  out: string[];
  err: string[];
  writes: { path: string; text: string }[];
  loadBackend: ReturnType<typeof vi.fn>;
}

/** In-memory world: registered files and directories, captured output, a scripted model. */
function fakeDeps(
  opts: {
    model?: LoadedBackend;
    load?: (modelPath: string) => Promise<LoadedBackend>;
    files?: Record<string, string>;
    dirs?: Record<string, string[]>;
    env?: Record<string, string | undefined>;
  } = {},
): Fake {
  const out: string[] = [];
  const err: string[] = [];
  const writes: { path: string; text: string }[] = [];
  const files: Record<string, string> = { ...opts.files };
  const dirs: Record<string, string[]> = opts.dirs ?? { [MODELS]: [MODEL_FILE] };
  const model = opts.model ?? fakeModel();
  const loadBackend = vi.fn(opts.load ?? (async () => model));
  const deps: CliDeps = {
    readFile: (p) => {
      if (p in files) return files[p] as string;
      if (p === DEFAULT_MESSAGES) return readFileSync(p, 'utf8');
      throw new Error(`ENOENT: ${p}`);
    },
    exists: (p) => p in dirs,
    listDir: (p) => dirs[p] ?? [],
    writeFile: (p, text) => writes.push({ path: p, text }),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    env: opts.env ?? { VOID_MODELS_DIR: MODELS },
    platform: 'win32',
    home: 'C:\\Users\\a',
    stamp: () => 'stamp',
    loadBackend,
    // A still clock and timers that never fire: no real waits, nothing load-sensitive.
    queueDeps: { now: () => 0, setTimer: () => 0, clearTimer: () => {} },
  };
  return { deps, out, err, writes, loadBackend };
}

const written = (f: Fake) => JSON.parse(f.writes[0]?.text ?? 'null') as { options: unknown; plan: unknown; summary: EvalSummary; gate: unknown; records: unknown[] };

describe('main — without --run, nothing loads', () => {
  it('prints the plan and returns 0; the model is never touched', async () => {
    const f = fakeDeps();
    expect(await main([], f.deps)).toBe(0);
    expect(f.loadBackend).not.toHaveBeenCalled();
    const text = f.out.join('\n');
    // 270 + 450 + 51 + 2,400 + 360 + 120 + 120 = 3,771 calls × 1.2 s / 60 = 75.42 → 75 min (the lib test's plan).
    expect(text).toContain('TOTAL                 3771 calls ≈ 75 min');
    expect(text).toContain('Hollow gate: remorse-then-connecting messages          120 (before retries)');
    expect(text).toContain('No model was loaded');
    // Retries can add calls to the two conversation sets, so they are counted "before retries".
    expect(text).toContain('(before retries)');
    expect(text).not.toContain('(at most)');
    expect(text).not.toContain('Loading');
    expect(f.writes).toEqual([]);
  });

  it('an unknown flag is refused with 2, before anything else', async () => {
    const f = fakeDeps();
    expect(await main(['--bogus'], f.deps)).toBe(2);
    expect(f.err.join('\n')).toContain('boss-eval: unknown argument: --bogus');
    expect(f.out).toEqual([]);
  });
});

describe('main — with --run', () => {
  it('loads the model from VOID_MODELS_DIR once, writes the outcome once, disposes, and returns the outcome\'s status', async () => {
    const model = fakeModel();
    const f = fakeDeps({ model });
    const code = await main(['--run'], f.deps);
    expect(f.loadBackend).toHaveBeenCalledTimes(1);
    expect(f.loadBackend).toHaveBeenCalledWith(path.join(MODELS, MODEL_FILE));
    const text = f.out.join('\n');
    expect(text).toContain('Loaded (gpu: fake).');
    expect(text).toContain('RESULT:');
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]?.path).toBe(path.resolve('logs/boss-eval', 'stamp.json'));
    const json = written(f);
    expect(Object.keys(json).sort()).toEqual(['gate', 'options', 'plan', 'records', 'summary']);
    expect(json.records).toHaveLength(3771);
    expect(model.dispose).toHaveBeenCalledTimes(1);
    // The model always refuses: the two genuine-acceptance targets (0 of 120) and the connections (0 of 60)
    // miss → FAIL, 1.
    expect(code).toBe(exitCode(json.summary));
    expect(code).toBe(1);
  });

  it('without VOID_MODELS_DIR the model is looked for in Electron\'s per-user directory — never ./models', async () => {
    const dir = path.join('C:\\Users\\a\\AppData\\Roaming\\the-void', 'models');
    const f = fakeDeps({ env: {}, dirs: { [dir]: ['notes.txt', MODEL_FILE] } });
    await main(['--run', '--group', 'turn'], f.deps);
    expect(f.loadBackend).toHaveBeenCalledWith(path.join(dir, MODEL_FILE));
  });

  it('returns 3 when every Turn times out (more than 5% of the turn calls failed)', async () => {
    const f = fakeDeps({ model: fakeModel({ turnsTimeOut: true }) });
    const code = await main(['--run'], f.deps);
    expect(code).toBe(exitCode(written(f).summary));
    expect(code).toBe(3);
  });

  it('returns 0 for a Talk-only run that passes (only "the executioner never concedes" is judged)', async () => {
    const f = fakeDeps();
    const code = await main(['--run', '--group', 'talk'], f.deps);
    expect(code).toBe(exitCode(written(f).summary));
    expect(code).toBe(0);
  });

  it('--quick runs the quick plan: 451 calls', async () => {
    const f = fakeDeps();
    await main(['--run', '--quick'], f.deps);
    // 9 × 10 + 9 × 5 × 2 + (5 × 2 + 1) + 10 × 20 + 10 × 3 + 10 + 10 × 2 = 90 + 90 + 11 + 200 + 30 + 10 + 20 = 451.
    expect(f.out.join('\n')).toContain('TOTAL                 451 calls');
    expect(written(f).records).toHaveLength(451);
  });

  it('a load that throws is a CRASH: 4, "the run crashed", nothing written', async () => {
    const f = fakeDeps({ load: async () => Promise.reject(new Error('the GPU is gone')) });
    expect(await main(['--run'], f.deps)).toBe(4);
    expect(f.err.join('\n')).toContain('boss-eval: the run crashed');
    expect(f.err.join('\n')).toContain('the GPU is gone');
    expect(f.writes).toEqual([]);
  });

  it('no model in the directory: 2, and nothing is loaded', async () => {
    const f = fakeDeps({ dirs: { [MODELS]: [] } });
    expect(await main(['--run'], f.deps)).toBe(2);
    expect(f.err.join('\n')).toContain('no model in D:\\models');
    expect(f.loadBackend).not.toHaveBeenCalled();
  });
});

describe('main — a personas file missing a boss the wanted group needs is refused before loading', () => {
  const without = (id: string) => JSON.stringify(FIXTURE_PERSONA_LIST.filter((p) => p.id !== id));

  it('no Hollow Self, --group hollow-gate: 2', async () => {
    const f = fakeDeps({ files: { 'p.json': without('hollow') } });
    expect(await main(['--run', '--group', 'hollow-gate', '--personas', 'p.json'], f.deps)).toBe(2);
    expect(f.err.join('\n')).toContain('no Hollow Self');
    expect(f.loadBackend).not.toHaveBeenCalled();
  });

  it('no Hollow Self, --group all: 2', async () => {
    const f = fakeDeps({ files: { 'p.json': without('hollow') } });
    expect(await main(['--run', '--personas', 'p.json'], f.deps)).toBe(2);
    expect(f.err.join('\n')).toContain('no Hollow Self');
    expect(f.loadBackend).not.toHaveBeenCalled();
  });

  it('no executioner, --group talk: 2', async () => {
    const f = fakeDeps({ files: { 'p.json': without('executioner') } });
    expect(await main(['--run', '--group', 'talk', '--personas', 'p.json'], f.deps)).toBe(2);
    expect(f.err.join('\n')).toContain('no executioner');
    expect(f.loadBackend).not.toHaveBeenCalled();
  });

  it('--group turn needs neither: both lists are accepted and run', async () => {
    for (const id of ['hollow', 'executioner']) {
      const f = fakeDeps({ files: { 'p.json': without(id) } });
      expect(await main(['--run', '--group', 'turn', '--personas', 'p.json'], f.deps), id).toBe(0);
      expect(f.loadBackend).toHaveBeenCalledTimes(1);
      // 8 fighting bosses left × 30 Turns.
      expect(written(f).records).toHaveLength(240);
    }
  });
});
