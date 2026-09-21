// THE COMMAND LINE AND THE DRY-RUN REPORT. (AC-10, AC-12.)
//
// The "player" for this unit is the author reading a terminal before deciding whether to spend
// money. So the figures below are checked to the milli-dollar, and every one of them is worked out
// by hand from ART-BIBLE's own numbers — never read off a run:
//
//   §1b   $0.067 per batched image, $0.134 interactive
//   §4b   50 buildable assets -> 150 images "≈ $10.05";  52 eventually -> 156 "≈ $10.45"
//   §7    probe 03: 9 interactive images, "~$1.21"
//
//     9 x  67 =   603 -> $0.603      150 x  67 = 10050 -> $10.050
//     9 x 134 =  1206 -> $1.206      156 x  67 = 10452 -> $10.452
//
// The bible's own rounded figures ($10.05, ~$10.45, ~$1.21) are asserted to be present in the
// document too, so if §4b is ever re-costed this test says the catalogue and the report must
// follow.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  decideRun,
  formatDryRun,
  MAX_RETAKE_ROUNDS,
  MAX_TAKES,
  parseArgs,
  planRun,
  USAGE,
  type Args,
} from './cli.ts';
import { validateCatalogue, type Catalogue } from './catalogue.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CATALOGUE_TEXT = readFileSync(path.join(HERE, 'catalogue.json'), 'utf8');
const BIBLE = readFileSync(path.join(REPO, 'docs/ART-BIBLE.md'), 'utf8');

/** The shipped catalogue with every prompt authored, so selection can succeed at all. */
function authored(options: { undefer?: boolean } = {}): Catalogue {
  const raw = JSON.parse(CATALOGUE_TEXT) as {
    assets: { id: string; prompt: string | null; deferred?: string }[];
  };
  for (const asset of raw.assets) {
    asset.prompt = `a ${asset.id}`;
    if (options.undefer === true) delete asset.deferred;
  }
  return validateCatalogue(raw);
}

const ALL_50 = authored();
const ALL_52 = authored({ undefer: true });

function argsFor(argv: string[]): Args {
  return parseArgs(argv);
}

// =========================================================================================
// parseArgs
// =========================================================================================

describe('parseArgs', () => {
  it('defaults to batch, three takes, one retake round, and no selection', () => {
    const args = argsFor([]);
    expect(args.mode).toBe('batch'); // §1b: batch is half price; it is the default for a reason
    expect(args.takes).toBe(3); // §1 LOCKED
    expect(args.retakeRounds).toBe(1);
    expect(args.ids).toEqual([]);
    expect(args.stage).toBeNull();
    expect(args.confirmSpend).toBe(false); // the whole point
    expect(args.dryRun).toBe(false);
    expect(args.cataloguePath).toBe('scripts/art/catalogue.json');
    expect(args.out).toBe('art-candidates');
  });

  it('collects repeated --asset and comma-separated --assets', () => {
    expect(argsFor(['--asset', 'a', '--asset', 'b', '--assets', 'c, d ,e']).ids).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('reads the rest of the flags', () => {
    const args = argsFor([
      '--mode', 'interactive',
      '--takes', '1',
      '--retake-rounds', '0',
      '--stage', '2',
      '--reference', 'anchor.png',
      '--out', 'tmp',
      '--poll-seconds', '5',
      '--max-wait-hours', '2',
      '--preview', 'preview.json',
      '--catalogue', 'other.json',
      '--verbose',
      '--dry-run',
      '--confirm-spend',
      '--resume', 'run-1',
    ]);
    expect(args).toMatchObject({
      mode: 'interactive',
      takes: 1,
      retakeRounds: 0,
      stage: 2,
      reference: 'anchor.png',
      out: 'tmp',
      pollSeconds: 5,
      maxWaitHours: 2,
      preview: 'preview.json',
      cataloguePath: 'other.json',
      verbose: true,
      dryRun: true,
      confirmSpend: true,
      resume: 'run-1',
    });
  });

  it('refuses an unknown option rather than ignoring it', () => {
    // Ignoring a typo'd flag is how `--dry-run` becomes `--dryrun` and a batch goes out.
    expect(() => argsFor(['--dryrun'])).toThrow(/Unknown option "--dryrun"/);
    expect(() => argsFor(['--confirm_spend'])).toThrow(/Unknown option/);
  });

  it('refuses a flag whose value is missing', () => {
    expect(() => argsFor(['--asset'])).toThrow(/--asset needs a value/);
    expect(() => argsFor(['--takes'])).toThrow(/--takes needs a number/);
  });

  it('refuses a mode that is neither batch nor interactive', () => {
    expect(() => argsFor(['--mode', 'cheap'])).toThrow(/--mode must be batch or interactive/);
  });
});

// =========================================================================================
// AC-12 — the bounds that keep the maximum spend knowable
// =========================================================================================

describe('takes and retake rounds are bounded (AC-12)', () => {
  it('accepts 1 to 3 takes and refuses anything outside', () => {
    for (const n of [1, 2, 3]) expect(argsFor(['--takes', String(n)]).takes).toBe(n);
    for (const bad of ['0', '4', '10', '-1', '2.5']) {
      expect(() => argsFor(['--takes', bad])).toThrow(/--takes must be a whole number from 1 to 3/);
    }
    expect(MAX_TAKES).toBe(3); // §1: "Variations: 3 per asset"
  });

  it('accepts 0 to 2 retake rounds and refuses anything outside', () => {
    for (const n of [0, 1, 2]) expect(argsFor(['--retake-rounds', String(n)]).retakeRounds).toBe(n);
    for (const bad of ['3', '99', '-1', '1.5']) {
      expect(() => argsFor(['--retake-rounds', bad])).toThrow(
        /--retake-rounds must be a whole number from 0 to 2/,
      );
    }
    expect(MAX_RETAKE_ROUNDS).toBe(2);
  });

  it('the refusal says WHY — an unbounded ceiling makes the maximum spend unknowable', () => {
    expect(() => argsFor(['--retake-rounds', '5'])).toThrow(/maximum spend stays knowable/);
  });

  it('accepts only stages 1 to 4', () => {
    for (const n of [1, 2, 3, 4]) expect(argsFor(['--stage', String(n)]).stage).toBe(n);
    for (const bad of ['0', '5', '1.5']) {
      expect(() => argsFor(['--stage', bad])).toThrow(/--stage must be 1, 2, 3 or 4/);
    }
  });
});

// =========================================================================================
// AC-10 — the exact numbers in the dry-run report
// =========================================================================================

describe('the dry-run report states the exact count and the exact cost (AC-10)', () => {
  function report(catalogue: Catalogue, argv: string[]): string {
    const args = argsFor(argv);
    return formatDryRun(catalogue, planRun(catalogue, args), args).join('\n');
  }

  it('9 batched images are $0.603', () => {
    // 3 assets x 3 takes = 9 images; 9 x 67 milli = 603 -> "$0.603".
    const text = report(ALL_50, [
      '--assets',
      'class-enforcer,backdrop-ash-city,enemy-ashWraiths',
    ]);
    expect(text).toContain('Assets (3): backdrop-ash-city, class-enforcer, enemy-ashWraiths');
    expect(text).toContain('Round 1: 9 images = $0.603');
  });

  it('the whole buildable batch is 150 images at $10.050 — §4b’s "≈ $10.05"', () => {
    // 50 assets x 3 takes = 150; 150 x 67 = 10050.
    const text = report(ALL_50, ['--assets', ALL_50.assets.filter((a) => a.deferred === undefined).map((a) => a.id).join(',')]);
    expect(text).toContain('Assets (50):');
    expect(text).toContain('Round 1: 150 images = $10.050');
    expect(BIBLE).toContain('$10.05'); // the bible's own rounded figure
  });

  it('all 52 once the engine catches up is 156 images at $10.452 — §4b’s "≈ $10.45"', () => {
    // 52 x 3 = 156; 156 x 67 = 10452.
    const text = report(ALL_52, ['--assets', ALL_52.assets.map((a) => a.id).join(',')]);
    expect(text).toContain('Assets (52):');
    expect(text).toContain('Round 1: 156 images = $10.452');
    expect(BIBLE).toContain('$10.45');
  });

  it('9 INTERACTIVE images are $1.206 — probe 03’s "~$1.21"', () => {
    // Interactive is double: 9 x 134 = 1206.
    const text = report(ALL_50, [
      '--assets',
      'class-enforcer,backdrop-ash-city,enemy-ashWraiths',
      '--mode',
      'interactive',
    ]);
    expect(text).toContain('Mode: interactive ($0.134 per image, gemini-3-pro-image, 1K)');
    expect(text).toContain('Round 1: 9 images = $1.206');
    expect(BIBLE).toContain('~$1.21');
  });

  it('prints the retake ceiling and the MAXIMUM the run can spend', () => {
    // 9 images at $0.603, one retake round that could need all 9 again:
    //   ceiling  = 1 x 603 = 603   -> $0.603
    //   maximum  = 603 + 603       -> $1.206
    const text = report(ALL_50, ['--assets', 'class-enforcer,backdrop-ash-city,enemy-ashWraiths']);
    expect(text).toContain('Retake ceiling: 1 round(s) x up to 9 images = $0.603');
    expect(text).toContain('Maximum this run can spend: $1.206');
  });

  it('two retake rounds triple the maximum, and zero rounds make it the round-1 cost', () => {
    //   2 rounds: 603 + 2 x 603 = 1809 -> $1.809
    //   0 rounds: 603                  -> $0.603
    const two = report(ALL_50, ['--assets', 'class-enforcer,backdrop-ash-city,enemy-ashWraiths', '--retake-rounds', '2']);
    expect(two).toContain('Maximum this run can spend: $1.809');
    const none = report(ALL_50, ['--assets', 'class-enforcer,backdrop-ash-city,enemy-ashWraiths', '--retake-rounds', '0']);
    expect(none).toContain('Retake ceiling: 0 round(s) x up to 9 images = $0.000');
    expect(none).toContain('Maximum this run can spend: $0.603');
  });

  it('with nothing selected it is 0 images and $0.000', () => {
    const text = report(ALL_50, []);
    expect(text).toContain('Assets (0): (none selected)');
    expect(text).toContain('Round 1: 0 images = $0.000');
    expect(text).toContain('Maximum this run can spend: $0.000');
    expect(text).toContain('Nothing is selected.');
  });

  it('says the sentence, verbatim', () => {
    expect(report(ALL_50, [])).toContain('Nothing was sent and nothing was spent.');
    expect(report(ALL_50, ['--asset', 'altar'])).toContain(
      'Nothing was sent and nothing was spent.',
    );
  });

  it('tells the author exactly how to proceed, and to keep the list', () => {
    const text = report(ALL_50, ['--asset', 'altar']);
    expect(text).toContain('To generate, re-run with --confirm-spend (and keep the asset list).');
  });

  it('says WHY it was a dry run when --confirm-spend was already given (D1)', () => {
    // Telling someone who typed --confirm-spend to "re-run with --confirm-spend" reads as though
    // the tool ignored them — which is the impression the --preview defect actually left.
    const preview = report(ALL_50, ['--asset', 'altar', '--confirm-spend', '--preview', 'p.json']);
    expect(preview).toContain('--preview is a look, never a send, so --confirm-spend was ignored');
    expect(preview).not.toContain('To generate, re-run with --confirm-spend (and keep the asset list).');

    const forced = report(ALL_50, ['--asset', 'altar', '--confirm-spend', '--dry-run']);
    expect(forced).toContain('--dry-run was given as well, so nothing was sent');

    // Without --confirm-spend the preview line points at both changes needed.
    const lookOnly = report(ALL_50, ['--asset', 'altar', '--preview', 'p.json']);
    expect(lookOnly).toContain('re-run with --confirm-spend and without --preview');
  });

  it('one take of one asset is $0.067 — the smallest thing that can be bought', () => {
    const text = report(ALL_50, ['--asset', 'altar', '--takes', '1', '--retake-rounds', '0']);
    expect(text).toContain('Round 1: 1 images = $0.067');
    expect(text).toContain('Maximum this run can spend: $0.067');
  });

  it('a whole stage is priced from the catalogue, not from a guess', () => {
    // Stage 1 is 7 assets (5 backdrops + altar + shrine), x 3 takes = 21 images,
    // 21 x 67 = 1407 -> $1.407.
    const text = report(ALL_50, ['--stage', '1']);
    expect(text).toContain('Assets (7):');
    expect(text).toContain('Round 1: 21 images = $1.407');
  });
});

describe('planRun', () => {
  it('overrides every selected asset’s reference when --reference is given (§7)', () => {
    const planned = planRun(ALL_50, argsFor(['--stage', '2', '--reference', 'anchor.png']));
    expect(planned.assets.length).toBe(5);
    expect(planned.assets.every((a) => a.reference === 'anchor.png')).toBe(true);
  });

  it('returns assets in catalogue order — §4’s generation order — not in the order typed', () => {
    // "Never generate a thing before the thing it must sit against."
    const planned = planRun(ALL_50, argsFor(['--assets', 'boss-kingpin,altar,class-hollow']));
    expect(planned.assets.map((a) => a.id)).toEqual(['altar', 'class-hollow', 'boss-kingpin']);
  });

  it('de-duplicates an id given twice', () => {
    const planned = planRun(ALL_50, argsFor(['--asset', 'altar', '--asset', 'altar']));
    expect(planned.assets.map((a) => a.id)).toEqual(['altar']);
    expect(planned.roundOneImages).toBe(3);
  });
});

// =========================================================================================
// The decision table, at the unit level (the integration version is in noSpend.test.ts)
// =========================================================================================

describe('decideRun', () => {
  const decide = (argv: string[]) => decideRun(argsFor(argv));

  it('is a dry run with no flags at all', () => {
    expect(decide([])).toMatchObject({ kind: 'dry-run', spendAllowed: false });
  });

  it('is a dry run with a selection but no --confirm-spend', () => {
    expect(decide(['--stage', '1'])).toMatchObject({ kind: 'dry-run', spendAllowed: false });
    expect(decide(['--asset', 'altar'])).toMatchObject({ kind: 'dry-run', spendAllowed: false });
  });

  it('a DRY RUN WINS over --confirm-spend', () => {
    expect(decide(['--asset', 'altar', '--confirm-spend', '--dry-run'])).toMatchObject({
      kind: 'dry-run',
      spendAllowed: false,
    });
  });

  it('refuses --confirm-spend with no selection', () => {
    const decision = decide(['--confirm-spend']);
    expect(decision.kind).toBe('refuse');
    expect(decision.spendAllowed).toBe(false);
    expect(decision.reason).toContain('never interpret "yes" as "all 50 assets"');
  });

  it('generates only with BOTH the flag and a selection', () => {
    expect(decide(['--confirm-spend', '--asset', 'altar'])).toMatchObject({
      kind: 'generate',
      spendAllowed: true,
    });
    expect(decide(['--confirm-spend', '--stage', '3'])).toMatchObject({
      kind: 'generate',
      spendAllowed: true,
    });
  });

  it('--preview is a LOOK, not a send: it forces a dry run from anywhere (D1)', () => {
    // `--help` promises "write the exact request bodies to a file and exit". It is also the only
    // free way to check the wire format before money moves, so it must never be the thing that
    // moves it.
    for (const argv of [
      ['--preview', 'p.json'],
      ['--preview', 'p.json', '--confirm-spend', '--asset', 'altar'],
      ['--confirm-spend', '--stage', '3', '--preview', 'p.json'],
      ['--confirm-spend', '--resume', 'run-1', '--preview', 'p.json'],
      ['--preview', 'p.json', '--confirm-spend'],
    ]) {
      expect(decide(argv), argv.join(' ')).toMatchObject({
        kind: 'dry-run',
        spendAllowed: false,
      });
    }
  });

  it('…and without --preview those same commands are NOT dry runs', () => {
    // The control: if these were dry runs anyway, the assertions above would prove nothing.
    expect(decide(['--confirm-spend', '--asset', 'altar']).kind).toBe('generate');
    expect(decide(['--confirm-spend', '--stage', '3']).kind).toBe('generate');
    expect(decide(['--confirm-spend', '--resume', 'run-1']).kind).toBe('resume');
    expect(decide(['--confirm-spend']).kind).toBe('refuse');
  });

  it('refuses --resume without --confirm-spend, because collecting still calls the API', () => {
    const decision = decide(['--resume', 'run-1']);
    expect(decision.kind).toBe('refuse');
    expect(decision.reason).toContain('Collecting a batch still calls');
    expect(decision.reason).toContain('Nothing was sent and nothing was spent.');
  });

  it('resumes with --confirm-spend, and needs no asset selection to do it', () => {
    expect(decide(['--resume', 'run-1', '--confirm-spend'])).toMatchObject({
      kind: 'resume',
      spendAllowed: true,
    });
  });

  it('--help and --list never spend, whatever else is typed', () => {
    expect(decide(['--help', '--confirm-spend', '--asset', 'altar']).kind).toBe('help');
    expect(decide(['--list', '--confirm-spend', '--stage', '1']).kind).toBe('list');
    expect(decide(['--help', '--confirm-spend', '--asset', 'altar']).spendAllowed).toBe(false);
    expect(decide(['--list', '--confirm-spend', '--stage', '1']).spendAllowed).toBe(false);
  });
});

describe('the usage text', () => {
  it('leads with the fact that it does nothing by default', () => {
    expect(USAGE).toContain('DOES NOTHING BY DEFAULT');
    expect(USAGE).toContain('--confirm-spend');
    expect(USAGE).toContain('Required, every time');
  });
});
