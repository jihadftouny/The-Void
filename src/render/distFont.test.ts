// THE TYPEFACE REALLY SHIPS — proved by running the REAL bundler, not by reading the source.
//
// WHY A SUBPROCESS BUILD AND NOT A SOURCE SCAN. `tokens.test.ts` already asserts what
// `fonts.css` SAYS: four faces, one family, relative urls. None of that survives contact with
// the bundler on its own. Vite has to (a) follow the `@import` chain from `game.css`,
// (b) resolve four `url(../assets/…)` references into emitted assets, and (c) rewrite them
// against `base: './'`. Any of those three can fail while every source assertion stays green,
// and the symptom in the packaged game is a silent fallback to the system monospace — no
// error, no crash, just a different-looking game on every machine, which is the exact problem
// bundling a face was meant to solve.
//
// THE FAILURE MODE THIS EXISTS FOR, specifically. `main.mjs` loads `dist/desktop.html` from
// DISK, so the packaged game runs on `file://`. A stylesheet that emitted `url(/assets/x.woff2)`
// resolves that against the FILESYSTEM ROOT — `C:\assets\…` — and 404s on every machine alive.
// It works perfectly under `npm run dev`, because the dev server has a real root. So this is a
// defect that cannot be caught by playing the game the way it is developed.
//
// THE SECOND THING PROVED HERE (plan Appendix A.7.5). The art slots carry a developer-facing
// label — the slot id and its aspect ratio — behind the same `import.meta.env.DEV` mechanism
// as the F3 state panel. A.7 requires that the packaged-build exclusion cover it too. It is
// proved here rather than in `src/dev/exclusion.test.ts` because that file is a guard this
// unit is forbidden to edit; the technique is copied from it verbatim, including the
// environment scrubbing and the DEV control that gives the absence its meaning.
//
// ---------------------------------------------------------------------------------------
// THE ENVIRONMENT SCRUB IS THE WHOLE GUARD, and it is copied from `exclusion.test.ts` for
// the same measured reason: Vitest sets `NODE_ENV=test`, Vite decides `isProduction` from
// `process.env.NODE_ENV` BEFORE it looks at `--mode`, so an in-process or environment-
// inheriting "production" build still has `import.meta.env.DEV === true` and bundles the dev
// label — while reporting a clean production build. `nodeEnv: null` DELETES the variable,
// which is exactly what `npm run build` hands the bundler.
// ---------------------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_MONO, primaryFontFamily } from './tokens.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/** A string that really is in every shipped bundle — the title screen's only button. */
const SHIPPED_STRING = 'Descend into the Void';

interface Emitted {
  file: string;
  text: string;
}

/** Every file a build emitted, read as text — chunks, HTML, CSS, sourcemaps and fonts. */
function readEmitted(outDir: string): Emitted[] {
  const out: Emitted[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else out.push({ file: `${prefix}${entry.name}`, text: readFileSync(full, 'latin1') });
    }
  };
  walk(outDir, '');
  return out;
}

/** Run the real bundler in a subprocess with an environment this test controls completely. */
function build(outSubdir: string, mode: string, nodeEnv: string | null): Emitted[] {
  const outDir = path.join(ROOT, 'dist', outSubdir);
  rmSync(outDir, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (nodeEnv === null) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  execFileSync(
    process.execPath,
    [VITE_BIN, 'build', '--mode', mode, '--outDir', path.join('dist', outSubdir)],
    { cwd: ROOT, env, stdio: 'pipe' },
  );
  return readEmitted(outDir);
}

const OUT_PROD = 'font-proof';
const OUT_DEV = 'font-proof-dev';

let prod: Emitted[] = [];
let dev: Emitted[] = [];

beforeAll(() => {
  prod = build(OUT_PROD, 'production', null);
  dev = build(OUT_DEV, 'development', 'development');
}, 300_000);

afterAll(() => {
  for (const dir of [OUT_PROD, OUT_DEV]) {
    rmSync(path.join(ROOT, 'dist', dir), { recursive: true, force: true });
  }
});

const cssOf = (emitted: readonly Emitted[]): Emitted[] => emitted.filter((e) => e.file.endsWith('.css'));
const filesContaining = (emitted: readonly Emitted[], needle: string): string[] =>
  emitted.filter((e) => e.text.includes(needle)).map((e) => e.file);

describe('the bundled typeface survives the real build', () => {
  it('the build produced artifacts at all (or every sweep below is empty)', () => {
    expect(prod.length, 'the production build emitted nothing').toBeGreaterThan(2);
    expect(cssOf(prod).length, 'the production build emitted no CSS').toBeGreaterThan(0);
    // Non-vacuity: the sweep can find a string that IS in the bundle.
    expect(filesContaining(prod, SHIPPED_STRING), 'the sweep reads nothing').not.toEqual([]);
  });

  it('emits all four woff2 faces as assets', () => {
    const fonts = prod.filter((e) => e.file.endsWith('.woff2'));
    expect(
      fonts.map((f) => f.file),
      'the bundler emitted fewer than four woff2 files — a face is not reaching the build',
    ).toHaveLength(4);
    for (const font of fonts) {
      // A woff2 begins with the ASCII signature `wOF2`. Read as latin1, an emitted file that
      // is really a 404 page, an empty placeholder or a text stub would fail here — an
      // extension check alone would not.
      expect(font.text.startsWith('wOF2'), `${font.file} is not a woff2 payload`).toBe(true);
      expect(font.text.length, `${font.file} is suspiciously small`).toBeGreaterThan(5000);
    }
  });

  it('the emitted CSS declares the family the font stack asks for', () => {
    const family = primaryFontFamily(FONT_MONO);
    const withFace = cssOf(prod).filter((e) => e.text.includes('@font-face'));
    expect(withFace, 'no emitted stylesheet contains an @font-face at all').not.toEqual([]);
    const all = withFace.map((e) => e.text).join('\n');
    expect(all, `the emitted CSS never names "${family}"`).toContain(family);
    // Four faces survived the build, not one.
    expect((all.match(/@font-face/g) ?? []).length).toBe(4);
  });

  it('and every font url in the emitted CSS is RELATIVE — an absolute one dies on file://', () => {
    for (const sheet of cssOf(prod)) {
      expect(
        sheet.text,
        `${sheet.file} emits an absolute url. The packaged build loads dist/desktop.html ` +
          'from disk, so a leading slash resolves to the filesystem root and the font 404s ' +
          'on every machine — while working perfectly under `npm run dev`.',
      ).not.toContain('url(/');
    }
    // Non-vacuity, both ways: the sheets really do contain urls, and the needle really does
    // match the shape it is meant to catch.
    const urls = cssOf(prod).flatMap((s) => [...s.text.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1] as string));
    expect(urls.length, 'no url() in any emitted stylesheet — this guard swept nothing').toBeGreaterThanOrEqual(4);
    expect('src:url(/assets/x.woff2)'.includes('url(/')).toBe(true);
    expect('src:url(./assets/x.woff2)'.includes('url(/')).toBe(false);
  });

  it('and the emitted HTML loads that CSS relatively too', () => {
    const html = prod.filter((e) => e.file.endsWith('.html'));
    expect(html.length, 'no HTML emitted').toBeGreaterThan(0);
    for (const page of html) {
      expect(page.text, `${page.file} links an absolute stylesheet`).not.toMatch(
        /href="\/[^"]*\.css"/,
      );
    }
  });
});

// =========================================================================================
// A.7.5 — the art slots' DEVELOPER LABEL is absent from the packaged build.
//
// Same three-part shape as `src/dev/exclusion.test.ts`: a control that proves the marker CAN
// be bundled, the assertion that it is not, and a non-vacuity check that the needle is not
// stale. Without the control, "the marker is in no file" is satisfied by a marker that was
// deleted, renamed, or never written.
// =========================================================================================

describe('the art slots ship no developer label', () => {
  // ⚠ THE NEEDLE IS READ OUT OF THE SHIPPING SOURCE, not imported from it. Importing the
  // constant would mean this file holds a copy that keeps passing after the real one is
  // renamed — a guard watching a door that has moved. Reading the literal makes a rename fail
  // the anchor below instead of quietly emptying every sweep.
  const SCREENS = readFileSync(path.join(ROOT, 'src/desktop/screens.ts'), 'utf8');
  const declared = /const DEV_LABEL_CLASS = '([^']+)'/.exec(SCREENS);
  const ART_DEV_LABEL_CLASS = declared?.[1] ?? '';

  it('the needle is the string the code actually uses (or this guard has gone stale)', () => {
    expect(
      declared,
      'screens.ts no longer declares `const DEV_LABEL_CLASS = \'…\'` — every sweep below ' +
        'would search for the empty string and pass vacuously',
    ).not.toBeNull();
    expect(ART_DEV_LABEL_CLASS.length).toBeGreaterThan(8);
    // ...and it really is behind the same mechanism as the F3 panel.
    expect(SCREENS, 'the dev label is not behind an import.meta.env.DEV guard').toMatch(
      /if\s*\(\s*import\.meta\.env\.DEV\s*\)/,
    );
    expect(SCREENS, 'the dev-label guard is NEGATED — the label would ship').not.toMatch(
      /if\s*\(\s*!\s*import\.meta\.env\.DEV\s*\)/,
    );
    // The guard must sit BEFORE the only use of the class, or the label is built outside it.
    const guard = SCREENS.search(/if\s*\(\s*import\.meta\.env\.DEV\s*\)/);
    const use = SCREENS.search(/className\s*=\s*DEV_LABEL_CLASS/);
    expect(use, 'nothing applies the dev-label class').toBeGreaterThan(-1);
    expect(guard, 'the label is applied outside the DEV guard').toBeLessThan(use);
  });

  it('THE CONTROL: a development build DOES contain the label marker in a JS chunk', () => {
    const hits = filesContaining(dev, ART_DEV_LABEL_CLASS);
    expect(
      hits,
      'the DEV build does not contain the label either — the production assertion below ' +
        'would be measuring a bundler that never included it',
    ).not.toEqual([]);
    expect(hits.some((f) => f.endsWith('.js')), `marker only in ${hits.join(', ')}`).toBe(true);
  });

  it('THE ASSERTION: the production build contains it in NO file — sourcemaps included', () => {
    expect(
      filesContaining(prod, ART_DEV_LABEL_CLASS),
      'the developer art-slot label is in the packaged build — a shipped game would print ' +
        'slot ids and aspect ratios on screen, which is what "looks like missing assets" is',
    ).toEqual([]);
  });

  it('...and no other trace of the label reaches a production chunk', () => {
    // A second needle from the other end of the same block, in case the class name were
    // renamed but the label text left behind.
    for (const needle of ['art slot', 'aspect ratio']) {
      expect(
        filesContaining(prod, needle).filter((f) => f.endsWith('.js')),
        `'${needle}' reached a production chunk`,
      ).toEqual([]);
    }
  });

  it('and no unfinished-software wording reaches a shipped chunk', () => {
    // The words that make an empty region read as a missing asset rather than as atmosphere.
    // Deliberately NOT a sweep for the token "PLACEHOLDER": `contentWarning.json` marks its
    // own prose as placeholder for the AUTHOR's benefit and Vite inlines that JSON, so such a
    // sweep would fire on the one place the marking is wanted. The behavioural half — an
    // empty slot renders no text at all — is in `screens.test.ts`, and the CSS half — the
    // slot rules declare no `content:` — is in `styleDiscipline.test.ts`.
    for (const needle of ['IMAGE HERE', 'image here', 'coming soon', 'not yet implemented']) {
      expect(
        filesContaining(prod, needle).filter((f) => f.endsWith('.js')),
        `'${needle}' is in the shipped bundle`,
      ).toEqual([]);
    }
  });
});
