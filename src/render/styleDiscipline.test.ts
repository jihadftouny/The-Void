// STYLE DISCIPLINE — the rules the whole shipped CSS surface obeys, asserted rather than
// asked for in a comment (PLAN.md #8 AC-5/AC-6).
//
// WHY THIS FILE EXISTS. `game.css` carried five hard-coded `font-size` values (13/15/12/14/12)
// while a `--void-type-*` scale sat beside it, unused by them. Nothing caught that, because
// nothing could: a px literal is valid CSS, it renders, and it silently opts its element out
// of the player's text-size setting. The same is true of a colour literal, which opts an
// element out of the floor. Both are the kind of drift a token layer exists to prevent, so
// both are now failures rather than preferences — the next unit inherits them as law.
//
// THE DETECTORS ARE TESTED BEFORE THEY ARE TRUSTED. Every scan below is preceded by cases
// that plant the violation in more than one shape, and by cases that must NOT fire — a
// colour-literal scan that trips on the id selector `#atmosphere`, or a font-size scan that
// misses `font-size:12px` written without a space, is a guard nobody can keep green.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOOR_THEMES, TYPE } from './tokens.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');

/** Every stylesheet under src/, found rather than listed, so a new one cannot be missed. */
function stylesheetsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...stylesheetsUnder(full));
    else if (entry.name.endsWith('.css')) found.push(full);
  }
  return found;
}

/** A stylesheet as the browser sees it: comments removed, so prose is never judged. */
function shippingCss(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

const FILES = stylesheetsUnder(SRC_ROOT);
const SHEETS = FILES.map((file) => ({ name: basename(file), css: shippingCss(file) }));
const ALL_CSS = SHEETS.map((s) => s.css).join('\n');

/**
 * Every `property: value` DECLARATION in a stylesheet.
 *
 * Values only — which is the whole reason this exists rather than a raw text sweep. `#` opens
 * an id SELECTOR as well as a hex colour, and this codebase has `#atmosphere`, `#stage`,
 * `#sheet` and five more; a sweep that could not tell the two apart would either fail on
 * every id or have to special-case them by name.
 */
function declarations(css: string): { prop: string; value: string }[] {
  const out: { prop: string; value: string }[] = [];
  for (const m of css.matchAll(/(^|[{;])\s*([-a-zA-Z]+)\s*:\s*([^;{}]+)/g)) {
    out.push({ prop: (m[2] as string).toLowerCase(), value: (m[3] as string).trim() });
  }
  return out;
}

describe('the scan finds the shipping stylesheets at all', () => {
  it('reads several files and a lot of declarations', () => {
    expect(FILES.length, 'no stylesheets found — every guard below is vacuous').toBeGreaterThan(4);
    expect(SHEETS.map((s) => s.name)).toContain('tokens.css');
    expect(SHEETS.map((s) => s.name)).toContain('game.css');
    expect(SHEETS.map((s) => s.name)).toContain('screens.css');
    expect(SHEETS.map((s) => s.name)).toContain('atmosphere.css');
    expect(declarations(ALL_CSS).length).toBeGreaterThan(200);
  });
});

// =========================================================================================
// AC-5(a) — NO COLOUR LITERAL, with exactly one documented exception.
// =========================================================================================

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;

/** `file -> literal` for every colour written as a value rather than read as a token. */
function colourLiterals(): string[] {
  const found: string[] = [];
  for (const sheet of SHEETS) {
    for (const { value } of declarations(sheet.css)) {
      const hit = COLOUR_LITERAL.exec(value);
      if (hit) found.push(`${sheet.name} -> ${hit[0]}`);
    }
  }
  return found;
}

describe('no colour is written in CSS — tokens.ts is the only source', () => {
  it('the detector fires on every spelling a colour can take', () => {
    for (const css of [
      '.a { color: #fff; }',
      '.a{color:#ffffff}',
      '.a { border: 1px solid #AABBCC; }',
      '.a { color: rgb(1, 2, 3); }',
      '.a { background: rgba(0, 0, 0, 0.5); }',
      '.a { color: hsl(0 0% 0%); }',
      '.a { color: hsla(0, 0%, 0%, 0.2); }',
      '.a { background: linear-gradient(#000, #fff); }',
    ]) {
      expect(
        declarations(css).some((d) => COLOUR_LITERAL.test(d.value)),
        css,
      ).toBe(true);
    }
  });

  it('and never on an id selector, a token read, or a plain length', () => {
    // `#atmosphere` is a real selector in this codebase, and `#stage` is eight characters of
    // hex-looking text. A scan that could not tell a selector from a value would be useless.
    for (const css of [
      '#atmosphere { z-index: 0; }',
      '#stage { display: grid; }',
      '#sheet .who { color: var(--void-ink); }',
      '.a { background: var(--void-panel); }',
      '.a { padding: 4px 8px; }',
      '.a { background: linear-gradient(var(--void-texture-ink), transparent); }',
      '.a { grid-template-rows: auto 1fr; }',
    ]) {
      expect(
        declarations(css).some((d) => COLOUR_LITERAL.test(d.value)),
        css,
      ).toBe(false);
    }
  });

  it('the ONLY literal in the whole surface is the documented boot ground', () => {
    // tokens.css repeats PALETTE.bg once, as a literal, because CSS parses before any script
    // runs and without it the window paints white for a frame. That exception is named here
    // by file AND by value, so a second one cannot hide behind "there is an exception".
    expect(colourLiterals()).toEqual(['tokens.css -> #07070a']);
  });
});

// =========================================================================================
// AC-5(b) / AC-6 — EVERY font-size READS THE SCALE, and the scale has a floor.
// =========================================================================================

describe('every font-size reads a --void-type-* step', () => {
  const fontSizes = (): { name: string; value: string }[] => {
    const out: { name: string; value: string }[] = [];
    for (const sheet of SHEETS) {
      for (const d of declarations(sheet.css)) {
        if (d.prop === 'font-size') out.push({ name: sheet.name, value: d.value });
      }
    }
    return out;
  };

  it('the detector sees a font-size in every form it is written in', () => {
    for (const css of [
      '.a { font-size: 12px; }',
      '.a{font-size:12px}',
      '.a { font-size: 0.9rem; }',
      '.a {\n  font-size: 13px;\n}',
      '.a { color: red; font-size: 14px; }',
    ]) {
      const sizes = declarations(css).filter((d) => d.prop === 'font-size');
      expect(sizes, css).toHaveLength(1);
      expect(sizes[0]?.value.includes('var(--void-type-'), css).toBe(false);
    }
    // ...and recognises the compliant form as compliant.
    expect(
      declarations('.a{font-size:var(--void-type-sm)}')[0]?.value.includes('var(--void-type-'),
    ).toBe(true);
  });

  it('and the shipped surface has none that does not', () => {
    const offenders = fontSizes().filter((f) => !f.value.includes('var(--void-type-'));
    expect(
      offenders.map((f) => `${f.name} -> font-size: ${f.value}`),
      'a font-size opts its element out of the player’s text-size setting',
    ).toEqual([]);
  });

  it('...over a real number of font-size declarations (non-vacuity)', () => {
    expect(fontSizes().length, 'no font-size found at all — this guard swept nothing')
      .toBeGreaterThan(8);
  });

  it('AC-6: the smallest step of the scale is at least 11px, at the single source', () => {
    // Asserted once, here, rather than per screen: `TYPE.xs` is what every `--void-type-xs`
    // read resolves to, and `settings-model.test.ts` holds the same floor for all three
    // text-size columns.
    const xs = /^(\d+)px$/.exec(TYPE.xs);
    expect(xs, `TYPE.xs is not a plain px size: ${TYPE.xs}`).not.toBeNull();
    expect(Number(xs?.[1])).toBeGreaterThanOrEqual(11);
  });
});

// =========================================================================================
// AC-5(c) — the typeface is declared in exactly one place.
// =========================================================================================

describe('@font-face lives only in fonts.css', () => {
  it('one file declares faces, and it is that one', () => {
    const withFace = SHEETS.filter((s) => s.css.includes('@font-face')).map((s) => s.name);
    expect(withFace).toEqual(['fonts.css']);
  });

  it('and it declares four of them (non-vacuity)', () => {
    const fonts = SHEETS.find((s) => s.name === 'fonts.css');
    expect((fonts?.css.match(/@font-face/g) ?? []).length).toBe(4);
  });
});

// =========================================================================================
// AC-5(d) — S4c: focus visibility must not regress.
// =========================================================================================

describe('the focus ring still exists and still rides the accent', () => {
  it('there is a :focus-visible rule, and it reads --void-accent', () => {
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(ALL_CSS);
    expect(rule, 'the single focus treatment is gone — S4c regressed').not.toBeNull();
    expect(rule?.[1], 'the focus ring no longer uses the accent').toContain('var(--void-accent)');
    expect(rule?.[1], 'the focus ring draws no outline').toMatch(/outline\s*:/);
  });

  it('and nothing switches focus outlines off wholesale', () => {
    for (const { value, prop } of declarations(ALL_CSS)) {
      if (prop !== 'outline') continue;
      expect(value, 'a rule removes the focus outline').not.toMatch(/^\s*(none|0)\s*$/);
    }
  });
});

// =========================================================================================
// AC-5(e) / S4b — REDUCED MOTION. The OS by default, the player's override in both
// directions. Every assertion here is preceded by the control that there is motion to stop.
// =========================================================================================

describe('reduced motion has somewhere to bite, and bites there', () => {
  /** The body of the first `@media (prefers-reduced-motion: reduce)` block. */
  const mediaBlock = (): string => {
    const start = ALL_CSS.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
    if (start < 0) return '';
    const open = ALL_CSS.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < ALL_CSS.length; i += 1) {
      if (ALL_CSS[i] === '{') depth += 1;
      else if (ALL_CSS[i] === '}') {
        depth -= 1;
        if (depth === 0) return ALL_CSS.slice(open, i);
      }
    }
    return '';
  };

  it('THE CONTROL: there really is motion in the shipped CSS to turn off', () => {
    // "A control that never enabled the thing it controlled for" is this project's own scar,
    // and a reduced-motion rule over a stylesheet with no animation is exactly that. Three
    // separate moving things must exist: the narration fade, the button transition, and the
    // floor atmospheres.
    expect(ALL_CSS, 'the narration fade is gone').toMatch(/\.beat\s*\{[^}]*animation\s*:\s*fade/);
    expect(ALL_CSS, 'the button transition is gone').toMatch(
      /\.void-button\s*\{[^}]*transition\s*:/,
    );
    expect((ALL_CSS.match(/@keyframes\s+void-/g) ?? []).length, 'no atmosphere animates')
      .toBeGreaterThan(2);
  });

  it('the OS signal is honoured by default', () => {
    const block = mediaBlock();
    expect(block.length, 'there is no prefers-reduced-motion block at all').toBeGreaterThan(40);
    expect(block, 'the OS block does not stop the narration fade').toContain('.beat');
    expect(block, 'the OS block does not stop the button transition').toContain('.void-button');
    expect(block, 'the OS block does not stop the atmosphere').toContain('.void-texture');
    expect(block).toMatch(/animation\s*:\s*none/);
    expect(block).toMatch(/transition\s*:\s*none/);
  });

  it('and the player can opt back IN to motion from inside it', () => {
    // Without the `:not([data-motion='full'])` escape, a player who wants motion on a machine
    // whose OS asks for less has no way to get it, and `motionEnabled('full', true) === true`
    // becomes a promise the CSS does not keep.
    expect(mediaBlock(), 'the full-motion override is missing from the OS block').toContain(
      "data-motion='full'",
    );
  });

  it('and can force reduced motion regardless of what the OS says', () => {
    const rules = [...ALL_CSS.matchAll(/\[data-motion='reduce'\][^{]*\{([^}]*)\}/g)];
    expect(rules.length, "there is no [data-motion='reduce'] rule").toBeGreaterThan(0);
    const selectors = ALL_CSS.slice(ALL_CSS.indexOf("[data-motion='reduce']"));
    expect(selectors, 'the player override does not stop the narration fade').toContain('.beat');
    expect(selectors, 'the player override does not stop the buttons').toContain('.void-button');
    expect(selectors, 'the player override does not stop the atmosphere').toContain(
      '.void-texture',
    );
    const body = rules.map((m) => m[1]).join(' ');
    expect(body).toMatch(/animation\s*:\s*none/);
    expect(body).toMatch(/transition\s*:\s*none/);
  });
});

// =========================================================================================
// A.1 — the five floor environments are really painted, and high contrast really removes
// them. The TS half of this coupling is `FLOOR_THEMES[n].texture.kind`, a bare string that
// selects a CSS rule; neither the compiler nor the runtime can see the join.
// =========================================================================================

describe('every floor texture kind has a rule that paints it', () => {
  it('all five kinds are selected somewhere in the shipped CSS', () => {
    for (const floor of FLOOR_THEMES) {
      expect(
        ALL_CSS,
        `floor ${floor.place} (${floor.name}) declares texture kind '${floor.texture.kind}' ` +
          'and no stylesheet paints it — the floor would have no atmosphere at all',
      ).toContain(`[data-texture='${floor.texture.kind}']`);
    }
  });

  it('and the sweep is not satisfied by any string at all (non-vacuity)', () => {
    expect(ALL_CSS).not.toContain("[data-texture='nonesuch']");
    expect(FLOOR_THEMES.length).toBe(5);
    expect(new Set(FLOOR_THEMES.map((f) => f.texture.kind)).size, 'two floors share a texture')
      .toBe(5);
  });

  it('the layer takes its alpha ONLY from the token the contrast gate measures', () => {
    // The gate in `tokens.test.ts` composites `texture.ink` over the ground at
    // `texture.opacity`. That number is only the truth if the paint never exceeds it, which
    // is guaranteed by the alpha living on the layer and nowhere else.
    const layer = /\.void-texture\s*\{([^}]*)\}/.exec(ALL_CSS);
    expect(layer, 'the atmosphere layer has no rule').not.toBeNull();
    expect(layer?.[1]).toContain('opacity: var(--void-texture-opacity)');
    // ...and nothing animates the alpha, which would make the measured ratio true for one
    // frame and false for the rest.
    for (const frames of ALL_CSS.matchAll(/@keyframes\s+void-[^{]*\{([\s\S]*?)\n\}/g)) {
      expect(frames[1], 'an atmosphere keyframe moves the alpha').not.toMatch(/opacity\s*:/);
      expect(frames[1], 'an atmosphere keyframe changes a colour').not.toMatch(/background-color/);
    }
  });

  it('high contrast removes the atmosphere outright, not just its opacity', () => {
    expect(ALL_CSS, 'high contrast leaves the texture element in place').toMatch(
      /\[data-contrast='high'\]\s+\.void-texture\s*\{[^}]*display\s*:\s*none/,
    );
  });
});

// =========================================================================================
// A.7 — the reserved art regions look DELIBERATE. This is the requirement most likely to be
// shipped wrong: a grey box reading IMAGE HERE is what unfinished software looks like.
// =========================================================================================

describe('the reserved art regions print nothing and reserve by ratio', () => {
  /** Every rule whose selector mentions an art-slot class, as `selector { body }` pairs. */
  const slotRules = (): { selector: string; body: string }[] => {
    const out: { selector: string; body: string }[] = [];
    for (const m of ALL_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] as string).trim();
      if (selector.includes('void-art')) out.push({ selector, body: m[2] as string });
    }
    return out;
  };

  it('there are rules for them at all', () => {
    expect(slotRules().length, 'nothing styles the art slots').toBeGreaterThan(3);
  });

  it('no rule prints a word — every `content` is empty', () => {
    // The one `content` in these rules draws the inner frame edge and must stay empty. A
    // caption, a dimension label or a "TODO" would be a `content` with characters in it.
    for (const rule of slotRules()) {
      for (const d of declarations(rule.body)) {
        if (d.prop !== 'content') continue;
        expect(
          d.value.replace(/['"]/g, '').trim(),
          `${rule.selector} prints text into an empty art region`,
        ).toBe('');
      }
    }
    // Non-vacuity: there IS a `content` among them, so the loop is not skipping every rule.
    const contents = slotRules().flatMap((r) =>
      declarations(r.body).filter((d) => d.prop === 'content'),
    );
    expect(contents.length, 'no content declaration found — this guard swept nothing')
      .toBeGreaterThan(0);
  });

  it('and none of them pins a height — the ratio is the reservation', () => {
    // A fixed height is right at one window size and wrong at every other, and it is what
    // reintroduces the layout shift the whole mechanism exists to prevent.
    for (const rule of slotRules()) {
      for (const d of declarations(rule.body)) {
        if (d.prop !== 'height' && d.prop !== 'min-height') continue;
        expect(d.value, `${rule.selector} pins a fixed height`).not.toMatch(/\d\s*(px|em|rem|vh)/);
      }
    }
  });

  it('and nothing styles a developer caption, because there is not one', () => {
    // A `.void-art-devlabel { … }` rule would be the first half of reintroducing the caption
    // that was removed for surviving in the production sourcemap (see the note at the top of
    // `src/desktop/screens.ts`). CSS has no dead-code elimination, so such a rule would ship
    // whatever the element did.
    expect(
      SHEETS.filter((s) => s.css.includes('devlabel')).map((s) => s.name),
      'a stylesheet styles a developer caption on an art slot',
    ).toEqual([]);
    // ...and the builder does not create one either, which is the half that matters.
    const screens = readFileSync(join(SRC_ROOT, 'desktop/screens.ts'), 'utf8');
    const code = screens.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, 'a dev-only branch is back in a shipping module').not.toMatch(
      /import\.meta\.env/,
    );
  });
});
