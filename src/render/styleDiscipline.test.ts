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
import { FLOOR_THEMES, TYPE, themeVars } from './tokens.ts';

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
 * The rules that style `selector` ITSELF: every rule one of whose comma-split selectors is
 * exactly `selector` (whitespace normalised). A rule scoped by an override — the reduced-motion
 * `[data-motion='reduce'] .arena-float` — is a DIFFERENT selector and is not returned, which is
 * the whole point: that rule sets `animation: none`, and a check that let it stand in for the
 * rule that makes the thing move proved nothing (#6's fix round, F1).
 */
function rulesFor(css: string, selector: string): { selector: string; body: string }[] {
  const want = selector.replace(/\s+/g, ' ').trim();
  return rules(css).filter((rule) => rule.selector.split(',').some((part) => part.replace(/\s+/g, ' ').trim() === want));
}

/** Every `@keyframes name { … }`, name → body, braces balanced. */
function keyframes(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/@keyframes\s+([-\w]+)\s*\{/g)) {
    const open = (m.index as number) + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          out.set(m[1] as string, css.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * True when `selector` really MOVES: a rule styling it itself declares an `animation` (or
 * `animation-name`) whose value is not `none` and NAMES a `@keyframes` that exists, and those
 * keyframes change `property` between at least two distinct values. Each clause closes a way
 * the old one-line regex passed with nothing moving: a reduced-motion rule's `animation: none`,
 * an animation naming keyframes that were renamed away, and keyframes that hold still.
 */
function animatesWith(css: string, selector: string, property: string): boolean {
  const frames = keyframes(css);
  return rulesFor(css, selector).some((rule) =>
    declarations(rule.body)
      .filter((d) => d.prop === 'animation' || d.prop === 'animation-name')
      .filter((d) => d.value !== 'none')
      .some((d) =>
        d.value.split(/[\s,]+/).some((token) => {
          const body = frames.get(token);
          if (body === undefined) return false;
          const values = declarations(body).filter((f) => f.prop === property).map((f) => f.value);
          return new Set(values).size >= 2;
        }),
      ),
  );
}

/** True when a rule styling `selector` itself declares `prop` with a value matching `value`. */
function declares(css: string, selector: string, prop: string, value: RegExp): boolean {
  return rulesFor(css, selector).some((rule) => declarations(rule.body).some((d) => d.prop === prop && value.test(d.value)));
}

/** A `var(--void-…)` read resolved to the token's value — tokens.ts is the single source. */
const TOKEN_VALUES = themeVars(0);
function resolveTokens(value: string): string {
  return value.replace(/var\(\s*(--[-\w]+)\s*\)/g, (whole, name: string) => TOKEN_VALUES[name] ?? whole);
}

/** A width in px, or `null` when the token is not a width. The three keywords are the UA's. */
function widthPx(token: string): number | null {
  const keyword: Record<string, number> = { thin: 1, medium: 3, thick: 5 };
  if (token in keyword) return keyword[token] as number;
  const m = /^(-?\d*\.?\d+)(px|em|rem)?$/.exec(token);
  return m ? Number(m[1]) : null;
}

const DRAWN_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);

/** Anything in a rule's body that moves the element: an animation, a transition, a transform. */
function moves(body: string): boolean {
  return declarations(body).some(
    (d) =>
      ((d.prop === 'animation' || d.prop === 'animation-name' || d.prop === 'transition') && d.value !== 'none') ||
      (d.prop === 'transform' && d.value !== 'none'),
  );
}

/**
 * True when a rule's body paints a mark a player can SEE and nothing in it moves: an outline
 * with a drawn style, a non-zero width and a colour that is not transparent — or a background
 * that is not none or transparent. Token reads are resolved through tokens.ts, so a width token
 * set to 0 is caught. Longhands are read after the shorthand (an approximation of cascade order
 * within one rule, which is enough for the rules this surface writes).
 *
 * Catalogue entry 10, "present is not visible": the reduced-motion strike used to be guarded
 * only by the script ADDING its class; deleting the rule, or an outline of 0, left every test
 * green while a struck side showed no mark at all.
 */
function visibleStaticMark(body: string): boolean {
  if (moves(body)) return false;
  const decls = declarations(body);
  let style: string | undefined;
  let width: number | undefined;
  let transparent = false;
  const outline = decls.filter((d) => d.prop === 'outline').at(-1);
  if (outline) {
    for (const token of resolveTokens(outline.value).split(/\s+/)) {
      if (DRAWN_STYLES.has(token) || token === 'none' || token === 'hidden') style = token;
      else if (token === 'transparent') transparent = true;
      else {
        const px = widthPx(token);
        if (px !== null) width = px;
      }
    }
  }
  const longStyle = decls.filter((d) => d.prop === 'outline-style').at(-1);
  if (longStyle) style = resolveTokens(longStyle.value).trim();
  const longWidth = decls.filter((d) => d.prop === 'outline-width').at(-1);
  if (longWidth) width = widthPx(resolveTokens(longWidth.value).trim()) ?? width;
  const longColour = decls.filter((d) => d.prop === 'outline-color').at(-1);
  if (longColour) transparent = resolveTokens(longColour.value).trim() === 'transparent';
  const drawsOutline = style !== undefined && DRAWN_STYLES.has(style) && (width ?? 3) > 0 && !transparent;
  const background = decls.filter((d) => d.prop === 'background' || d.prop === 'background-color').at(-1);
  const paints = background !== undefined && !/^(none|transparent|initial|unset|inherit)$/.test(resolveTokens(background.value).trim());
  return drawsOutline || paints;
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
    // Judged by `animatesWith` — the rule styling the thing ITSELF names real keyframes that
    // change something. (The float's first check was a regex that the reduced-motion rule's
    // own `.arena-float { animation: none }` satisfied: deleting the rise left it green.)
    expect(animatesWith(ALL_CSS, '.arena-figure.is-struck', 'filter'), 'the enemy never flashes').toBe(true);
    expect(animatesWith(ALL_CSS, '.vitals-inner.is-shaking', 'transform'), 'the stat box never shakes').toBe(true);
    expect(animatesWith(ALL_CSS, '.arena-float', 'transform'), 'the damage number never rises').toBe(true);
  });

  it('the motion detector needs the rule styling the thing itself, naming keyframes that move', () => {
    const FRAMES = '@keyframes rise { from { transform: translateY(0); } to { transform: translateY(-9px); } }';
    const STILL = '@keyframes rise { from { transform: translateY(0); } to { transform: translateY(0); } }';
    expect(animatesWith(`.f { animation: rise 1s ease-out; } ${FRAMES}`, '.f', 'transform'), 'the real shape').toBe(true);
    expect(animatesWith(`.f { animation-name: rise; } ${FRAMES}`, '.f', 'transform'), 'the longhand').toBe(true);
    expect(animatesWith(`.g, .f { animation: rise 1s; } ${FRAMES}`, '.f', 'transform'), 'a selector list').toBe(true);
    // THE SHAPE THAT BLINDED THE OLD CHECK: only the reduced-motion rule mentions the float.
    expect(animatesWith(`[data-motion='reduce'] .f { animation: none; } ${FRAMES}`, '.f', 'transform'), 'an override stood in').toBe(false);
    expect(animatesWith(`.f { animation: none; } ${FRAMES}`, '.f', 'transform'), '`none` counted as motion').toBe(false);
    expect(animatesWith('.f { animation: rise 1s; }', '.f', 'transform'), 'keyframes that do not exist').toBe(false);
    expect(animatesWith(`.f { animation: rise 1s; } ${STILL}`, '.f', 'transform'), 'keyframes that hold still').toBe(false);
    expect(animatesWith(`.f { animation: rise 1s; } ${FRAMES}`, '.f', 'filter'), 'keyframes moving the wrong thing').toBe(false);
    expect(animatesWith(`.host .f { animation: rise 1s; } ${FRAMES}`, '.f', 'transform'), 'a different selector').toBe(false);
  });

  it('the floating number is taken OUT of the flow, over a host that anchors it', () => {
    // Without `position: absolute` every float drops into normal flow and shifts the frame on
    // every beat; without a positioned host it anchors to whatever ancestor is positioned —
    // the page. The two hosts are where `playRound` puts floats: `arenaEls` resolves them as
    // `.arena-figure` (the enemy) and `.vitals-inner` (the player), and `battle.test.ts`
    // proves the floats are appended to exactly those.
    expect(declares(ALL_CSS, '.arena-float', 'position', /^absolute$/), 'the float sits in normal flow').toBe(true);
    for (const host of ['.arena-figure', '.vitals-inner']) {
      expect(declares(ALL_CSS, host, 'position', /^(relative|absolute|fixed|sticky)$/), `${host} anchors no float`).toBe(true);
    }
    // The detector: only the rule styling the float itself counts, and only that value.
    expect(declares('.arena-float { position: absolute; }', '.arena-float', 'position', /^absolute$/)).toBe(true);
    expect(declares('.arena-float { position: static; }', '.arena-float', 'position', /^absolute$/)).toBe(false);
    expect(declares("[data-motion='reduce'] .arena-float { position: absolute; }", '.arena-float', 'position', /^absolute$/)).toBe(false);
  });

  it('the reduced-motion mark detector needs a mark a player can SEE, that does not move', () => {
    expect(visibleStaticMark('outline: var(--void-rule-heavy) solid var(--void-harm); outline-offset: var(--void-space-1);'), 'the real shape').toBe(true);
    expect(visibleStaticMark('background: var(--void-harm);'), 'a background tint').toBe(true);
    expect(visibleStaticMark('outline-style: solid;'), 'a drawn style at the default width').toBe(true);
    expect(visibleStaticMark('outline: 2px solid var(--void-harm); animation: none;'), '`animation: none` is not motion').toBe(true);
    for (const [body, why] of [
      ['outline: 0;', 'an outline of 0'],
      ['outline: none;', 'no outline'],
      ['outline: 0 solid var(--void-harm);', 'a drawn style at width 0'],
      ['outline: 0px solid var(--void-harm);', 'a drawn style at 0px'],
      ['outline: var(--void-rule-heavy) none var(--void-harm);', 'style none'],
      ['outline: 2px solid transparent;', 'a transparent outline'],
      ['outline-style: solid; outline-width: 0;', 'the longhands at width 0'],
      ['background: transparent;', 'a transparent background'],
      ['outline: 2px solid var(--void-harm); animation: arena-shake 240ms linear;', 'a mark that moves'],
      ['outline: 2px solid var(--void-harm); transform: translateX(4px);', 'a mark that is moved'],
      ['color: var(--void-harm);', 'a colour change is not a mark on the frame'],
      ['', 'an empty rule'],
    ] as const) {
      expect(visibleStaticMark(body), why).toBe(false);
    }
  });

  it('under reduced motion a strike still leaves a VISIBLE mark on both sides, and nothing moves', () => {
    // The script adds ONLY `is-tinted` under reduced motion (`battle.ts`'s `strikeClass`), so
    // this rule is the whole of what a struck side shows. The class being added proves nothing
    // if the rule behind it paints nothing.
    for (const target of ['.arena-figure.is-tinted', '.vitals-inner.is-tinted']) {
      const found = rulesFor(ALL_CSS, target);
      expect(found.length, `nothing styles ${target} — a struck side shows no mark at all`).toBeGreaterThan(0);
      expect(found.some((r) => visibleStaticMark(r.body)), `${target} paints no visible mark`).toBe(true);
      expect(found.some((r) => moves(r.body)), `${target} moves — the reduced-motion mark must be still`).toBe(false);
    }
    // ...and the CSS half, for a strike flagged before the script knew motion was off: in the
    // OS block AND under the player's own setting, the flash and the shake become the same
    // still mark.
    for (const [css, attr, where] of [
      [mediaBlock(), "data-motion='full'", 'the OS reduced-motion block'],
      [ALL_CSS, "[data-motion='reduce']", "the player's reduced-motion setting"],
    ] as const) {
      for (const target of ['.arena-figure.is-struck', '.vitals-inner.is-shaking']) {
        expect(
          selectorsCarrying(css, attr).some((r) => r.selector.endsWith(target) && visibleStaticMark(r.body)),
          `${where}: a ${target} strike shows no still mark`,
        ).toBe(true);
      }
    }
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
// `floor-looks` (2026-09-12) — FLOORS 2 AND 3 ARE REALLY PAINTED (AC-9), AND 1, 4, 5 ARE NOT
// RE-PAINTED (AC-8b).
//
// The author, having played it: floors 2 and 3 were "only lines in the background, no gradient
// colors or anything". Floor 2 is now red flecks on the one light floor; floor 3 a grey haze with
// ash falling through it. What a source scan can hold about that: the paint uses ONLY the flat
// texture ink (so the contrast gate's composite stays the worst case), it really moves, and the
// motion loops without a seam — a speck layer that advanced half a tile would jump once a cycle,
// which reads as a glitch on exactly the floor that is meant to read as stillness.
// =========================================================================================

/** Split a CSS value on the commas that are not inside parentheses. */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of value) {
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The argument text of every `*-gradient(...)` call in a value, parentheses balanced. */
function gradientCalls(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/[a-z-]*gradient\(/g)) {
    const open = (m.index as number) + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1;
      else if (value[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          out.push(value.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return out;
}

/** A gradient's FIRST argument, when it is a shape, a size, a position or a direction. */
const GRADIENT_PREAMBLE = /^(?:circle|ellipse|closest-|farthest-|to\s|at\s|-?[\d.]+(?:%|px|deg|turn|rad|grad|em)?(?:\s|$))/;

/** Every colour stop in one gradient that is NOT the flat texture ink or `transparent`. */
function foreignStops(args: string): string[] {
  const parts = splitTop(args);
  const stops = parts.length > 0 && GRADIENT_PREAMBLE.test(parts[0] as string) ? parts.slice(1) : parts;
  return stops.filter((stop) => !/^(?:var\(\s*--void-texture-ink\s*\)|transparent\b)/.test(stop));
}

/** One background layer of a moving texture: its tile, and where the loop starts and ends. */
interface LoopLayer {
  tile: string[];
  from: string[];
  to: string[];
}

/**
 * The layers of a texture's loop: `background-size` from the rule styling `selector` itself, and
 * the `from` / `to` `background-position` lists of the keyframes its animation names.
 */
function textureLoop(css: string, selector: string): LoopLayer[] {
  const rule = rulesFor(css, selector)[0];
  if (!rule) return [];
  const decls = declarations(rule.body);
  const size = decls.filter((d) => d.prop === 'background-size').at(-1)?.value ?? '';
  const animation = decls.filter((d) => d.prop === 'animation' || d.prop === 'animation-name').at(-1)?.value ?? '';
  const frames = keyframes(css);
  const name = animation.split(/[\s,]+/).find((token) => frames.has(token));
  if (!name) return [];
  const body = frames.get(name) as string;
  const at = (which: string): string[] => {
    const block = new RegExp(`(?:^|\\})\\s*(?:${which})\\s*\\{([^}]*)\\}`).exec(body)?.[1] ?? '';
    const position = declarations(block).filter((d) => d.prop === 'background-position').at(-1)?.value ?? '';
    return splitTop(position);
  };
  const from = at('from|0%');
  const to = at('to|100%');
  return splitTop(size).map((tile, i) => ({
    tile: tile.split(/\s+/),
    from: (from[i] ?? '').split(/\s+/),
    to: (to[i] ?? '').split(/\s+/),
  }));
}

/** A length in px (`0` counts as 0), or null for anything relative. */
function pxOf(token: string | undefined): number | null {
  if (token === '0') return 0;
  const m = /^(-?[\d.]+)px$/.exec(token ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Why a loop has a seam, or null when it is seamless. A layer tiled in px must advance by a
 * whole number of tiles on both axes (anything else jumps once a cycle); a layer sized in % is a
 * still haze and must not move at all. `down` additionally demands each px layer fall exactly ONE
 * tile straight down — the ash.
 */
function seam(layers: readonly LoopLayer[], down: boolean): string | null {
  if (layers.length === 0) return 'no loop found';
  for (const [i, layer] of layers.entries()) {
    const [tw, th] = layer.tile.map(pxOf);
    if (tw === null || th === null) {
      if (layer.from.join(' ') !== layer.to.join(' ')) return `layer ${i} is a haze and moves`;
      continue;
    }
    const [fx, fy] = layer.from.map(pxOf);
    const [tx, ty] = layer.to.map(pxOf);
    if (fx == null || fy == null || tx == null || ty == null) return `layer ${i} has no px positions`;
    const dx = tx - fx;
    const dy = ty - fy;
    if (dx % (tw as number) !== 0 || dy % (th as number) !== 0) return `layer ${i} advances ${dx}x${dy} on a ${tw}x${th} tile`;
    if (dx === 0 && dy === 0) return `layer ${i} does not move`;
    if (down && (dy !== th || dx !== 0)) return `layer ${i} does not fall exactly one tile straight down (${dx}, ${dy})`;
  }
  return null;
}

describe('floors 2 and 3 are really painted, and only by the layer’s alpha (AC-9)', () => {
  const FLECKS = "[data-texture='flecks'] .void-texture";
  const ASH = "[data-texture='ash'] .void-texture";

  it('the stop detector fires on a foreign colour in any position, and passes the house shapes', () => {
    // Clean — the shapes these two rules and the three untouched ones really write.
    for (const args of [
      'circle, var(--void-texture-ink) 0 1px, transparent 2px',
      '110% 80% at 26% 18%, var(--void-texture-ink), transparent 64%',
      '118% 104% at 50% 46%, transparent 34%, var(--void-texture-ink)',
      '24deg, var(--void-texture-ink) 0 1px, transparent 1px 7px',
    ]) {
      expect(foreignStops(args), args).toEqual([]);
    }
    // Dirty — a second token, a named colour, a literal, and a stop with no preamble before it.
    expect(foreignStops('circle, var(--void-accent) 0 1px, transparent 2px')).toEqual(['var(--void-accent) 0 1px']);
    expect(foreignStops('circle, red 0 1px, transparent 2px')).toEqual(['red 0 1px']);
    expect(foreignStops('var(--void-texture-ink), #ffffff')).toEqual(['#ffffff']);
    expect(foreignStops('var(--void-ink), transparent')).toEqual(['var(--void-ink)']);
    expect(gradientCalls('radial-gradient(circle, var(--void-texture-ink) 0 1px, transparent 2px), linear-gradient(red, blue)'))
      .toEqual(['circle, var(--void-texture-ink) 0 1px, transparent 2px', 'red, blue']);
  });

  for (const [floor, selector, layers] of [
    ['floor 2, the flecks', FLECKS, 3],
    ['floor 3, the ash', ASH, 4],
  ] as const) {
    it(`${floor}: every gradient stop is the flat texture ink or transparent`, () => {
      const found = rulesFor(ALL_CSS, selector);
      expect(found, `nothing paints ${selector}`).toHaveLength(1);
      const decls = declarations(found[0]!.body);
      const background = decls.filter((d) => d.prop === 'background').map((d) => d.value).join(', ');
      const calls = gradientCalls(background);
      expect(calls, `${selector} does not paint ${layers} layers`).toHaveLength(layers);
      for (const args of calls) expect(foreignStops(args), `${selector}: ${args}`).toEqual([]);
      // ...and nothing else in the rule adds alpha or colour: the layer's own opacity is the
      // ONLY alpha, which is what keeps the gate's composite the worst case.
      for (const d of decls) {
        expect(['opacity', 'background-color', 'filter', 'mix-blend-mode', 'color'], `${selector} sets ${d.prop}`).not.toContain(d.prop);
      }
    });

    it(`${floor}: it really moves — background-position, and only that`, () => {
      expect(animatesWith(ALL_CSS, selector, 'background-position'), `${selector} is still`).toBe(true);
    });
  }

  it('the ash FALLS: each speck layer drops exactly one tile, straight down, and the haze holds still', () => {
    const layers = textureLoop(ALL_CSS, ASH);
    expect(layers, 'the ash has no loop to judge').toHaveLength(4);
    expect(seam(layers, true)).toBeNull();
    // Down means the `to` y-offset is the LARGER one (a CSS y grows downward).
    for (const layer of layers.filter((l) => pxOf(l.tile[1]) !== null)) {
      expect(pxOf(layer.to[1])!, 'a speck layer rises').toBeGreaterThan(pxOf(layer.from[1])!);
    }
  });

  it('the flecks drift by exactly one tile per layer, so the loop has no seam', () => {
    const layers = textureLoop(ALL_CSS, FLECKS);
    expect(layers, 'the flecks have no loop to judge').toHaveLength(3);
    expect(seam(layers, false)).toBeNull();
    for (const layer of layers) {
      expect(pxOf(layer.to[0])! - pxOf(layer.from[0])!, 'not one tile across').toBe(pxOf(layer.tile[0]));
      expect(pxOf(layer.to[1])! - pxOf(layer.from[1])!, 'not one tile down').toBe(pxOf(layer.tile[1]));
    }
  });

  it('the seam detector fires on a half-tile loop, a rising speck, a drifting haze and a still layer', () => {
    const css = (to: string, size = '41px 53px, 150% 150%'): string =>
      `.t { background-size: ${size}; animation: fall 14s linear infinite; }\n` +
      `@keyframes fall { from { background-position: 0px 0px, 20% 10%; } to { background-position: ${to}; } }`;
    expect(seam(textureLoop(css('0px 53px, 20% 10%'), '.t'), true), 'the real shape').toBeNull();
    expect(seam(textureLoop(css('0px 26px, 20% 10%'), '.t'), true), 'half a tile').not.toBeNull();
    expect(seam(textureLoop(css('0px -53px, 20% 10%'), '.t'), true), 'a rising speck').not.toBeNull();
    expect(seam(textureLoop(css('0px 53px, 20% 14%'), '.t'), true), 'a haze that drifts').not.toBeNull();
    expect(seam(textureLoop(css('0px 0px, 20% 10%'), '.t'), false), 'a layer that never moves').not.toBeNull();
    expect(seam(textureLoop(css('41px 53px, 20% 10%'), '.t'), true), 'a diagonal is not straight down').not.toBeNull();
    expect(seam(textureLoop(css('41px 53px, 20% 10%'), '.t'), false), 'a whole-tile diagonal is seamless').toBeNull();
    expect(seam(textureLoop('.t { background-size: 41px 53px; }', '.t'), true), 'no animation at all').not.toBeNull();
  });
});

describe('floors 1, 4 and 5 keep the paint they had (AC-8b)', () => {
  // TRANSCRIBED from `atmosphere.css` on `main` at 6ebfa42 (the plan's "unchanged CSS" block),
  // whitespace-normalised — never read back from the file under test. A unit that DELIBERATELY
  // re-paints one of these floors updates its line here, and says why in the commit.
  const PINNED_RULES: Record<string, string> = {
    "[data-texture='fog'] .void-texture":
      "[data-texture='fog'] .void-texture { background: radial-gradient(120% 70% at 18% 108%, var(--void-texture-ink), transparent 62%), radial-gradient(95% 62% at 86% 96%, var(--void-texture-ink), transparent 66%); background-size: 160% 160%, 150% 150%; animation: void-fog-drift 96s ease-in-out infinite alternate; }",
    "[data-texture='glow'] .void-texture":
      "[data-texture='glow'] .void-texture { background: radial-gradient(72% 58% at 50% 4%, var(--void-texture-ink), transparent 72%); background-size: 130% 130%; animation: void-glow-breathe 70s ease-in-out infinite alternate; }",
    "[data-texture='absence'] .void-texture":
      "[data-texture='absence'] .void-texture { background: radial-gradient(118% 104% at 50% 46%, transparent 34%, var(--void-texture-ink)); }",
  };
  const PINNED_KEYFRAMES: Record<string, string> = {
    'void-fog-drift':
      '@keyframes void-fog-drift { from { background-position: 0% 100%, 100% 100%; } to { background-position: 12% 88%, 88% 84%; } }',
    'void-glow-breathe':
      '@keyframes void-glow-breathe { from { background-position: 50% 0%; } to { background-position: 50% 12%; } }',
  };
  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

  for (const [selector, pinned] of Object.entries(PINNED_RULES)) {
    it(`${selector} is exactly what main shipped`, () => {
      const found = rulesFor(ALL_CSS, selector);
      expect(found, `${selector} is styled by ${found.length} rules`).toHaveLength(1);
      expect(squash(`${selector} { ${found[0]!.body} }`)).toBe(pinned);
    });
  }

  for (const [name, pinned] of Object.entries(PINNED_KEYFRAMES)) {
    it(`@keyframes ${name} is exactly what main shipped`, () => {
      const body = keyframes(ALL_CSS).get(name);
      expect(body, `@keyframes ${name} is gone`).toBeDefined();
      expect(squash(`@keyframes ${name} {${body}}`)).toBe(pinned);
    });
  }
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
