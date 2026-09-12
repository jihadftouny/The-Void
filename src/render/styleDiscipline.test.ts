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

/**
 * Every `selector { body }` rule, including rules nested inside an at-rule: the inner
 * `[^{}]` classes cannot span a nested brace, so an `@media` header never matches and its
 * CHILDREN do, which is exactly what is wanted.
 */
function rules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] as string).trim(),
    body: m[2] as string,
  }));
}

/**
 * The INDIVIDUAL selectors — comma-split — that carry `attr`, each paired with its rule's body.
 *
 * ⚠ THE COMMA SPLIT IS THE WHOLE POINT, and it is here because the first version of the
 * reduced-motion guard below did not have it and proved nothing. That version asked whether
 * `.void-texture` appeared anywhere in the 7,000 characters of CSS following the first
 * `[data-motion='reduce']`, which of course it did — twice, in unrelated rules — so deleting
 * `[data-motion='reduce'] .void-texture` from the stylesheet left the suite fully green.
 *
 * Splitting on commas means a rule's OTHER targets cannot stand in for the one being asked
 * about: `[data-motion='reduce'] .a, .void-texture { … }` contributes only `.a`, because the
 * second half of that selector list does not carry the attribute at all.
 */
function selectorsCarrying(css: string, attr: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const rule of rules(css)) {
    for (const part of rule.selector.split(',')) {
      const selector = part.trim();
      if (selector.includes(attr)) out.push({ selector, body: rule.body });
    }
  }
  return out;
}

/**
 * True when some selector carrying `attr` NAMES `target` and its rule really switches motion
 * off. Both halves matter: a selector that names the target but sets a colour stops nothing,
 * and a rule that sets `animation: none` on something that never moved stops nothing either.
 */
function stopsMotion(css: string, attr: string, target: string): boolean {
  return selectorsCarrying(css, attr).some(
    (r) => r.selector.includes(target) && /(?:animation|transition)\s*:\s*none/.test(r.body),
  );
}

/**
 * Everything in this interface that moves, and therefore everything that must stop. PLAN.md #6
 * added the battle frame's three: the flash on the enemy's figure, the shake on the stat box,
 * and the number that floats over a struck side.
 */
const MOVING = [
  { target: '.beat', what: 'the narration fade' },
  { target: '.void-button', what: 'the button transition' },
  { target: '.void-texture', what: "the floor's atmosphere" },
  { target: '.arena-figure', what: "the enemy's flash" },
  { target: '.vitals-inner', what: "the stat box's shake" },
  { target: '.arena-float', what: 'the floating damage number' },
] as const;

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
    // PLAN.md #6: and the battle frame's three really move, or stopping them proves nothing.
    expect(ALL_CSS, 'the enemy never flashes').toMatch(/\.arena-figure\.is-struck\s*\{[^}]*animation\s*:/);
    expect(ALL_CSS, 'the stat box never shakes').toMatch(/\.vitals-inner\.is-shaking\s*\{[^}]*animation\s*:/);
    expect(ALL_CSS, 'the damage number never rises').toMatch(/\.arena-float\s*\{[^}]*animation\s*:/);
  });

  it('the detector needs the target NAMED by the rule that carries the attribute', () => {
    // The self-test the first version of this guard did not have. Case 2 is the exact shape
    // that made it vacuous: the target exists in the stylesheet, and in a rule that stops
    // motion, but NOT in a rule scoped by the override — so the override does not reach it.
    const REDUCE = "[data-motion='reduce']";
    const REAL = "[data-motion='reduce'] .void-texture { animation: none; }";
    const ELSEWHERE = "[data-motion='reduce'] .beat { animation: none; }\n" +
      '.void-texture { animation: none; }';
    const SIBLING = "[data-motion='reduce'] .beat, .void-texture { animation: none; }";
    const WRONG_PROPERTY = "[data-motion='reduce'] .void-texture { color: red; }";
    expect(stopsMotion(REAL, REDUCE, '.void-texture'), 'the real shape is not recognised').toBe(
      true,
    );
    expect(stopsMotion(ELSEWHERE, REDUCE, '.void-texture'), 'an unrelated rule stood in').toBe(
      false,
    );
    expect(stopsMotion(SIBLING, REDUCE, '.void-texture'), 'a sibling selector stood in').toBe(
      false,
    );
    expect(stopsMotion(WRONG_PROPERTY, REDUCE, '.void-texture'), 'a colour counted as motion')
      .toBe(false);
    expect(stopsMotion('', REDUCE, '.void-texture'), 'an empty stylesheet passed').toBe(false);
  });

  it('the OS signal is honoured by default, for each of the three moving things', () => {
    const block = mediaBlock();
    expect(block.length, 'there is no prefers-reduced-motion block at all').toBeGreaterThan(40);
    // Scoped to the media block AND to the selectors that carry the full-motion escape, so
    // no rule outside the query and no sibling selector inside it can stand in.
    for (const { target, what } of MOVING) {
      expect(
        stopsMotion(block, "data-motion='full'", target),
        `an OS asking for reduced motion does not stop ${what}`,
      ).toBe(true);
    }
  });

  it('and the player can opt back IN to motion from inside it', () => {
    // Without the `:not([data-motion='full'])` escape, a player who wants motion on a machine
    // whose OS asks for less has no way to get it, and `motionEnabled('full', true) === true`
    // becomes a promise the CSS does not keep.
    expect(mediaBlock(), 'the full-motion override is missing from the OS block').toContain(
      ":not([data-motion='full'])",
    );
  });

  it('and can force reduced motion regardless of what the OS says, on all three', () => {
    for (const { target, what } of MOVING) {
      expect(
        stopsMotion(ALL_CSS, "[data-motion='reduce']", target),
        `the player's own reduced-motion setting does not stop ${what}`,
      ).toBe(true);
    }
  });

  it('...and the override rules really exist to be found (non-vacuity)', () => {
    expect(
      selectorsCarrying(ALL_CSS, "[data-motion='reduce']").length,
      "there is no [data-motion='reduce'] selector at all",
    ).toBeGreaterThanOrEqual(MOVING.length);
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

// =========================================================================================
// ADDED BY `layout-breathing-room` (2026-09-09) — ADDITIVE ONLY; nothing above is changed.
//
// THE DEFECT THESE GUARD AGAINST, stated once. The choices used to live inside the reading
// column, and a width-only cap on the hub's 16:9 art frame let it take 247 px of a 550 px
// column whatever the window was. The narration measured ZERO PIXELS at the enforced minimum.
// `src/dev/layoutProbe.test.ts` measures the result for real, in real Chromium; what a source
// scan can add is the STRUCTURE the measurement depends on — that the mode really is one set
// of properties, that the caps really are relative, and that visual order really is DOM order.
// =========================================================================================

describe('the stage layout is one set of properties, defined in every mode', () => {
  /** The six properties that ARE the mode. Transcribed from the design, not read back. */
  const MODE_PROPERTIES = [
    '--void-layout-cols',
    '--void-layout-rows',
    '--void-column-max',
    '--void-prose-floor',
    '--void-log-cap',
    '--void-log-floor',
  ];

  const gameCss = (): string => {
    const sheet = SHEETS.find((s) => s.name === 'game.css');
    expect(sheet, 'game.css is not among the scanned stylesheets').toBeDefined();
    return sheet!.css;
  };

  /** The body of the first `@media (max-width: 899px)` block, braces balanced. */
  const stackedBlock = (): string => {
    const css = gameCss();
    const start = css.search(/@media\s*\(\s*max-width\s*:\s*899px\s*\)/);
    if (start < 0) return '';
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) return css.slice(open, i);
      }
    }
    return '';
  };

  it('the base mode declares all six, on the stage body', () => {
    // A mode that declared only some of them would inherit the rest from whatever the last
    // screen was: a document rendered into a 260px action column, or a hub whose prose keeps
    // a document screen's 45vh cap. Nothing throws and it looks almost right.
    // The breakpoint's block is removed first: `rules()` sees a rule nested inside an
    // at-rule with its bare selector, so `.stage-body` legitimately matches twice and the
    // BASE one is the one outside the media query.
    const base = selectorsCarrying(gameCss().replace(stackedBlock(), ''), '.stage-body').filter(
      (r) => r.selector === '.stage-body',
    );
    expect(base.length, 'there is no base .stage-body rule at all').toBe(1);
    for (const property of MODE_PROPERTIES) {
      expect(base[0]!.body, `the base stage layout does not define ${property}`).toContain(
        `${property}:`,
      );
    }
    expect(base[0]!.body, 'the choice column has no width').toContain('--void-choices-w:');
  });

  it('the document mode redeclares all six', () => {
    const wide = selectorsCarrying(gameCss(), "[data-layout='wide']");
    expect(wide.length, 'nothing styles the document layout').toBeGreaterThan(0);
    const body = wide.map((r) => r.body).join('\n');
    for (const property of MODE_PROPERTIES) {
      expect(body, `the document layout does not define ${property}`).toContain(`${property}:`);
    }
  });

  it('and so does the stacked fallback, inside its own breakpoint', () => {
    const block = stackedBlock();
    expect(block.length, 'there is no 899px breakpoint at all').toBeGreaterThan(60);
    for (const property of MODE_PROPERTIES) {
      expect(block, `the stacked fallback does not define ${property}`).toContain(`${property}:`);
    }
  });

  it('the framed stage (PLAN.md #6) redeclares all six — at full width AND stacked', () => {
    // The stage rule outranks the stacked fallback's bare `.stage-body` rule (an attribute
    // selector is more specific), so the stage needs its OWN stacked values inside the
    // breakpoint — or a narrow window would keep the three-column frame and scroll the page.
    const outside = selectorsCarrying(gameCss().replace(stackedBlock(), ''), "[data-layout='stage']").filter(
      (r) => r.selector === "[data-layout='stage'] .stage-body",
    );
    expect(outside.length, 'there is no stage mode rule at all').toBe(1);
    const inside = selectorsCarrying(stackedBlock(), "[data-layout='stage']").filter(
      (r) => r.selector === "[data-layout='stage'] .stage-body",
    );
    expect(inside.length, 'the stage has no stacked values inside the breakpoint').toBe(1);
    for (const property of MODE_PROPERTIES) {
      expect(outside[0]!.body, `the stage mode does not define ${property}`).toContain(`${property}:`);
      expect(inside[0]!.body, `the stacked stage does not define ${property}`).toContain(`${property}:`);
    }
  });

  it('the stage hides the HUD column and the log behind the ticker, selector-scoped', () => {
    const css = gameCss().replace(stackedBlock(), '');
    expect(
      selectorsCarrying(css, "[data-layout='stage']").some(
        (r) => r.selector === "[data-layout='stage'] #sheet" && /display\s*:\s*none/.test(r.body),
      ),
      'the HUD column is still drawn beside the framed stage',
    ).toBe(true);
    expect(
      selectorsCarrying(css, "[data-layout='stage']").some(
        (r) => r.selector.includes(":not([data-log='open']) .log") && /display\s*:\s*none/.test(r.body),
      ),
      'the full log is not closed behind the ticker',
    ).toBe(true);
    // ...and the frame's regions are hidden everywhere ELSE, so no other screen draws them.
    expect(css).toMatch(/#arena,\s*#vitals\s*\{[^}]*display:\s*none/);
  });

  it('the stacked fallback hides the scenery, SELECTOR-SCOPED inside the breakpoint', () => {
    // The `selectorsCarrying` idiom rather than a substring, for the reason that idiom exists:
    // a `display: none` somewhere in 7,000 characters of CSS that merely CONTAINS the word
    // proves nothing about whether the rule is scoped to the breakpoint.
    const scoped = selectorsCarrying(stackedBlock(), '#scenery');
    expect(
      scoped.some((r) => /display\s*:\s*none/.test(r.body)),
      'the scenery is not hidden in the stacked fallback — a 16:9 frame would take the ' +
        'height the prose and the controls both need at that width',
    ).toBe(true);
    // ...and it is NOT hidden outside the breakpoint, or the hub would never show it at all.
    const outside = selectorsCarrying(gameCss().replace(stackedBlock(), ''), '#scenery');
    expect(
      outside.some((r) => /^\s*display\s*:\s*none\s*;?\s*$/.test(r.body)),
      'the scenery is hidden unconditionally — the floor never gets its establishing frame',
    ).toBe(false);
  });

  it('the prose and the log floors are read, not hard-coded at their use sites', () => {
    const css = gameCss();
    expect(css, 'the narration does not read the prose floor').toMatch(
      /\.narration\s*\{[^}]*min-height:\s*var\(--void-prose-floor\)/,
    );
    expect(css, 'the log does not read its floor').toMatch(
      /\.log\s*\{[^}]*min-height:\s*var\(--void-log-floor\)/,
    );
    expect(css, 'the log does not read its cap').toMatch(
      /\.log\s*\{[^}]*max-height:\s*var\(--void-log-cap\)/,
    );
  });

  it('an EMPTY narration is collapsed, so a prose floor cannot hold a hole open', () => {
    // The other polarity of the floor. Without this the title screen and the content warning
    // would each carry 200 px of empty space where prose is not.
    expect(gameCss(), 'an empty narration keeps its floor').toMatch(
      /\.narration:empty\s*\{[^}]*min-height:\s*0/,
    );
  });
});

describe('the reserved art regions are capped in a way that SCALES', () => {
  const artRules = (): { selector: string; body: string }[] =>
    rules(ALL_CSS).filter((r) => r.selector.includes('void-art'));

  it('any height cap on an art region is relative, never a fixed length', () => {
    // A `max-height: 140px` is right at one window size and wrong at every other — and a
    // width-only cap is what let a 16:9 frame take 247 px of a 550 px column at the minimum
    // window, whatever the window was. The cap has to move with the viewport.
    for (const rule of artRules()) {
      for (const d of declarations(rule.body)) {
        if (d.prop !== 'max-height') continue;
        expect(
          d.value,
          `${rule.selector} caps an art region at a fixed height — it will be wrong at ` +
            'every window size but one',
        ).toMatch(/\d\s*(?:vh|vw|vmin|vmax|%)/);
        expect(d.value, `${rule.selector} caps in px/em/rem`).not.toMatch(/\d\s*(?:px|em|rem)/);
      }
    }
  });

  it('...and there IS such a cap to check (non-vacuity)', () => {
    // Without this, "no absolute height cap" is satisfied by having no cap at all — which is
    // precisely the state the scenery shipped in.
    const caps = artRules().flatMap((r) =>
      declarations(r.body).filter((d) => d.prop === 'max-height'),
    );
    expect(
      caps.length,
      'no art region is capped by height at all — a 16:9 frame grows without limit',
    ).toBeGreaterThan(0);
  });

  it('and none of them pins a height or a min-height (the ratio is the reservation)', () => {
    // Restated from the guard above with `min-height` included: a floor on an art slot would
    // stop the height cap being able to shrink it.
    for (const rule of artRules()) {
      for (const d of declarations(rule.body)) {
        if (d.prop !== 'height' && d.prop !== 'min-height') continue;
        expect(d.value, `${rule.selector} pins ${d.prop}`).not.toMatch(/\d\s*(px|em|rem|vh)/);
      }
    }
  });

  it('the scenery is capped through its CONTAINER, not through a per-screen rule', () => {
    // It used to be capped by `[data-screen='main-menu'] .void-art-slot`, which meant every
    // new screen that mounted one had to remember to cap it too. Keyed on the container, a
    // future screen inherits the cap by putting the region in the right place.
    expect(ALL_CSS, 'the scenery region is not capped through its container').toMatch(
      /#scenery\s+\.void-art-slot\s*\{[^}]*max-height:\s*\d+vh/,
    );
    expect(ALL_CSS, 'the scenery region lost its width cap').toMatch(
      /#scenery\s+\.void-art-slot\s*\{[^}]*max-width:/,
    );
  });
});

describe('visual order is DOM order, so the keyboard follows the reading order', () => {
  it('no stylesheet reorders anything with the flex order property', () => {
    // `order: -1` on the choices would put them visually first while leaving them last in the
    // tab order — the two would disagree and only a sighted mouse user would be unaffected.
    for (const sheet of SHEETS) {
      for (const d of declarations(sheet.css)) {
        expect(d.prop, `${sheet.name} reorders an element visually`).not.toBe('order');
      }
    }
  });

  it('and no flex or grid direction is reversed', () => {
    for (const sheet of SHEETS) {
      for (const d of declarations(sheet.css)) {
        if (d.prop !== 'flex-direction' && d.prop !== 'flex-flow') continue;
        expect(
          d.value,
          `${sheet.name} reverses a flex direction — visual order would stop matching DOM order`,
        ).not.toMatch(/-reverse/);
      }
    }
  });

  it('the detectors fire on the shapes they forbid (or they guard nothing)', () => {
    expect(declarations('.a { order: -1; }').some((d) => d.prop === 'order')).toBe(true);
    expect(declarations('.a{order:2}').some((d) => d.prop === 'order')).toBe(true);
    expect(
      declarations('.a { flex-direction: column-reverse; }').some((d) => /-reverse/.test(d.value)),
    ).toBe(true);
    expect(
      declarations('.a { flex-flow: row-reverse wrap; }').some((d) => /-reverse/.test(d.value)),
    ).toBe(true);
    // ...and not on the compliant forms this codebase actually uses.
    expect(
      declarations('.a { flex-direction: column; }').some((d) => /-reverse/.test(d.value)),
    ).toBe(false);
    expect(declarations('.a { border-top: 1px solid red; }').some((d) => d.prop === 'order')).toBe(
      false,
    );
  });

  it('...over a surface that really does lay things out in flex (non-vacuity)', () => {
    const directions = SHEETS.flatMap((s) =>
      declarations(s.css).filter((d) => d.prop === 'flex-direction'),
    );
    expect(directions.length, 'nothing sets a flex direction — this guard swept nothing')
      .toBeGreaterThan(3);
  });
});
