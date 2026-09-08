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
// THE SECOND THING PROVED HERE. The reserved art regions ship no words at all — no caption,
// no slot id, no printed aspect ratio. A.7.5 offered a developer-facing label behind the F3
// panel's `import.meta.env.DEV` mechanism; it was built, measured, and REMOVED, because
// `screens.ts` is a shipping module and `vite.config.ts` emits sourcemaps carrying every
// shipped module's original text — so the eliminated branch stayed fully readable in
// `dist/assets/*.js.map`, which this project's own standard (`src/dev/exclusion.test.ts`'s
// header: "recoverable from a shipped `.map` is shipped") counts as shipped. The reasoning
// is recorded in full at the top of `src/desktop/screens.ts`, and the rule that replaced it
// — a shipping module may carry no DEV branch at all — is enforced in `exclusion.test.ts`.
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

let prod: Emitted[] = [];

// ONE build, not two. A development build was spawned here as well, purely as the control
// for a dev-only art-slot label; the label is gone (see the top of `src/desktop/screens.ts`),
// and a build nothing asserts against is a build nobody should pay for on every test run.
beforeAll(() => {
  prod = build(OUT_PROD, 'production', null);
}, 300_000);

afterAll(() => {
  rmSync(path.join(ROOT, 'dist', OUT_PROD), { recursive: true, force: true });
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
// A.7.5 — an empty art region prints NOTHING in the packaged build.
//
// The behavioural half (an empty slot creates no text node at all, in any build) is in
// `src/desktop/screens.test.ts`, where there is a document to render into; the CSS half (no
// slot rule declares a `content:` with characters in it) is in `styleDiscipline.test.ts`.
// This is the third: that nothing in the SHIPPED bundle carries the words that make an empty
// region read as a missing asset rather than as atmosphere.
//
// NON-VACUITY comes from the first test in this file, which proves `filesContaining` can find
// a string that IS in the bundle. Without that anchor a sweep for absent strings would pass
// just as well against a reader that returns nothing.
// =========================================================================================

describe('the reserved art regions ship no words', () => {
  it('and no unfinished-software wording reaches a shipped chunk', () => {
    // The words that make an empty region read as a missing asset rather than as atmosphere.
    // Deliberately NOT a sweep for the token "PLACEHOLDER": `contentWarning.json` marks its
    // own prose as placeholder for the AUTHOR's benefit and Vite inlines that JSON, so such a
    // sweep would fire on the one place the marking is wanted. The behavioural half — an
    // empty slot renders no text at all — is in `screens.test.ts`, and the CSS half — the
    // slot rules declare no `content:` — is in `styleDiscipline.test.ts`.
    //
    // ⚠ `.js` ONLY, AND THE ASYMMETRY IS DELIBERATE — recorded because it is the same
    // narrowing this unit refused elsewhere, and the next reader deserves the reason rather
    // than having to re-derive it. What is being asked here is "could this WORD reach the
    // screen", and only an executed chunk can put a word on screen; `screens.ts`'s own
    // explanatory comment contains the string `IMAGE HERE`, so a sourcemap sweep would fire
    // on the prose explaining why the words are absent. That is the opposite of the developer
    // caption, where the question was "is this CODE in the build at all" and the `.map` was a
    // real answer — which is why the caption was deleted rather than swept narrowly. The
    // structural guarantee here is elsewhere anyway: `buildArtSlot` creates no text node on
    // any path, and `exclusion.test.ts` forbids a DEV branch in any shipping module.
    for (const needle of ['IMAGE HERE', 'image here', 'coming soon', 'not yet implemented']) {
      expect(
        filesContaining(prod, needle).filter((f) => f.endsWith('.js')),
        `'${needle}' is in the shipped bundle`,
      ).toEqual([]);
    }
  });
});
