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
import { FADED_VARS, FLOOR_THEMES, RETHEME_FADE_MS, TYPE, themeVars } from './tokens.ts';

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
 * The raw `from` / `to` `background-position` lists of the keyframes the rule styling `selector`
 * itself animates with — one entry per comma, NOT one per layer: a short list is returned short,
 * so a check can see what CSS would silently repeat. Null when there is no such rule or loop.
 */
function loopPositions(css: string, selector: string): { from: string[]; to: string[] } | null {
  const rule = rulesFor(css, selector)[0];
  if (!rule) return null;
  const decls = declarations(rule.body);
  const animation = decls.filter((d) => d.prop === 'animation' || d.prop === 'animation-name').at(-1)?.value ?? '';
  const frames = keyframes(css);
  const name = animation.split(/[\s,]+/).find((token) => frames.has(token));
  if (!name) return null;
  const body = frames.get(name) as string;
  const at = (which: string): string[] => {
    const block = new RegExp(`(?:^|\\})\\s*(?:${which})\\s*\\{([^}]*)\\}`).exec(body)?.[1] ?? '';
    const position = declarations(block).filter((d) => d.prop === 'background-position').at(-1)?.value ?? '';
    return splitTop(position);
  };
  return { from: at('from|0%'), to: at('to|100%') };
}

/**
 * The layers of a texture's loop: `background-size` from the rule styling `selector` itself, and
 * the `from` / `to` `background-position` lists of the keyframes its animation names.
 */
function textureLoop(css: string, selector: string): LoopLayer[] {
  const rule = rulesFor(css, selector)[0];
  if (!rule) return [];
  const size = declarations(rule.body).filter((d) => d.prop === 'background-size').at(-1)?.value ?? '';
  const loop = loopPositions(css, selector);
  if (!loop) return [];
  return splitTop(size).map((tile, i) => ({
    tile: tile.split(/\s+/),
    from: (loop.from[i] ?? '').split(/\s+/),
    to: (loop.to[i] ?? '').split(/\s+/),
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

/**
 * The widest angle, in degrees, between the per-cycle moves of any two layers that move in px: 0
 * when every layer slides the same way (the whole field travels as one rigid sheet), 180 when two
 * slide in opposite directions. A layer that does not move, or is not in px, has no direction.
 */
function directionSpread(layers: readonly LoopLayer[]): number {
  const moves: [number, number][] = [];
  for (const layer of layers) {
    const [fx, fy] = layer.from.map(pxOf);
    const [tx, ty] = layer.to.map(pxOf);
    if (fx == null || fy == null || tx == null || ty == null) continue;
    if (tx === fx && ty === fy) continue;
    moves.push([tx - fx, ty - fy]);
  }
  let widest = 0;
  for (const [i, [ax, ay]] of moves.entries()) {
    for (const [bx, by] of moves.slice(i + 1)) {
      const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      widest = Math.max(widest, (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI);
    }
  }
  return widest;
}

/**
 * Every comma-split selector that gives the texture element ITSELF a `::before` / `::after` (or
 * the legacy one-colon form). The element is `.void-texture` everywhere and also `#atmosphere` on
 * the full-screen instance, so both names count; a pseudo-element on some other element does not.
 */
function texturePseudoElements(css: string): string[] {
  const out: string[] = [];
  for (const rule of rules(css)) {
    for (const part of rule.selector.split(',')) {
      const selector = part.trim();
      const compounds = selector.split(/\s*[\s>+~]\s*/);
      if (compounds.some((c) => /(?:\.void-texture|#atmosphere)(?![-\w])/.test(c) && /::?(?:before|after)\b/i.test(c))) {
        out.push(selector);
      }
    }
  }
  return out;
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

  // `speck-scatter` (2026-09-14): 3 -> 12 and 4 -> 14. Each speck tile now carries four (flecks)
  // or six (ash) dots, and a dot is one gradient layer; the ash's two haze layers are unchanged.
  for (const [floor, selector, layers] of [
    ['floor 2, the flecks', FLECKS, 12],
    ['floor 3, the ash', ASH, 14],
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

    // `speck-scatter` (AC-4). A per-layer list shorter than the layers is valid CSS: the browser
    // repeats it from the top, silently pairing a dot with ANOTHER group's tile or move — a dot
    // that jumps at the loop's seam, or a haze that drifts. Every list is counted, not trusted.
    it(`${floor}: every per-layer list has exactly one entry per gradient layer`, () => {
      const decls = declarations(rulesFor(ALL_CSS, selector)[0]!.body);
      const last = (prop: string): string => decls.filter((d) => d.prop === prop).at(-1)?.value ?? '';
      expect(gradientCalls(last('background')), 'the layer count moved under this test').toHaveLength(layers);
      expect(splitTop(last('background-size')), 'background-size').toHaveLength(layers);
      const loop = loopPositions(ALL_CSS, selector);
      expect(loop, `${selector} has no loop`).not.toBeNull();
      expect(loop!.from, 'the keyframes’ from list').toHaveLength(layers);
      expect(loop!.to, 'the keyframes’ to list').toHaveLength(layers);
      // The rule's own list is what reduced motion shows. One entry is the one safe short form —
      // every layer takes it; anything between one and all of them misplaces some layer.
      expect([1, layers], 'the still frame’s background-position').toContain(splitTop(last('background-position')).length);
    });
  }

  it('the ash FALLS: each speck layer drops exactly one tile, straight down, and the haze holds still', () => {
    const layers = textureLoop(ALL_CSS, ASH);
    expect(layers, 'the ash has no loop to judge').toHaveLength(14);
    expect(seam(layers, true)).toBeNull();
    // Down means the `to` y-offset is the LARGER one (a CSS y grows downward).
    const specks = layers.filter((l) => pxOf(l.tile[1]) !== null);
    expect(specks, 'the ash has no speck layers').toHaveLength(12);
    for (const layer of specks) {
      expect(pxOf(layer.to[1])!, 'a speck layer rises').toBeGreaterThan(pxOf(layer.from[1])!);
    }
    // `speck-scatter` (AC-3): straight down stays, but the ash is not one rigid sheet — the far
    // and near specks fall different distances per cycle, so they visibly pass each other.
    const falls = new Set(specks.map((l) => pxOf(l.to[1])! - pxOf(l.from[1])!));
    expect(falls.size, 'every speck falls at one speed — the ash moves as one sheet').toBeGreaterThanOrEqual(2);
  });

  // `speck-scatter` (AC-3), replacing "exactly one tile across and one tile down": that rule sent
  // every fleck layer down-right, so the field slid as one sheet. Whole tiles still (no seam);
  // the direction is now free, and the layers must not all share one.
  it('the flecks drift whole tiles per cycle (no seam), and not all in one direction', () => {
    const layers = textureLoop(ALL_CSS, FLECKS);
    expect(layers, 'the flecks have no loop to judge').toHaveLength(12);
    expect(seam(layers, false)).toBeNull();
    expect(directionSpread(layers), 'every fleck layer slides the same way — the field moves as one sheet')
      .toBeGreaterThanOrEqual(45);
  });

  it('the direction spread measures angles between moves, not their lengths', () => {
    const loop = (...to: string[]): LoopLayer[] =>
      to.map((t) => ({ tile: ['41px', '53px'], from: ['0px', '0px'], to: t.split(' ') }));
    expect(directionSpread(loop('41px 0px', '0px 53px')), 'right and down are a right angle').toBeCloseTo(90, 6);
    expect(directionSpread(loop('41px 0px', '-41px 0px')), 'right and left are opposite').toBeCloseTo(180, 6);
    expect(directionSpread(loop('41px 53px', '82px 106px')), 'one direction at two speeds').toBeCloseTo(0, 6);
    expect(directionSpread(loop('41px 53px', '0px 0px')), 'a still layer has no direction').toBe(0);
    // The flecks as `floor-looks` shipped them: (47,61) (83,71) (131,157), all down-right. The
    // steepest is atan(61/47) = 52.4 deg, the shallowest atan(71/83) = 40.5 deg — 11.8 apart.
    const old = [['47px', '61px'], ['83px', '71px'], ['131px', '157px']].map((t) => ({ tile: t, from: ['0px', '0px'], to: t }));
    expect(directionSpread(old), 'the old flecks were one sheet').toBeCloseTo(11.8, 0);
  });

  // `speck-scatter` (AC-5). The route that keeps the contrast gate honest is that every dot is
  // painted in the ONE `.void-texture` background, under the one opacity. A pseudo-element would
  // be a second surface: its own paint the stop scan above never reads, and its own animation the
  // reduced-motion rules (which name `.void-texture`) never reach.
  it('no stylesheet gives the texture element a ::before or ::after', () => {
    expect(texturePseudoElements(ALL_CSS)).toEqual([]);
  });

  it('the pseudo-element scan fires on every way of writing one, and nowhere else', () => {
    for (const planted of [
      '.void-texture::before { content: ""; }',
      "[data-texture='flecks'] .void-texture::after { content: ''; }",
      '.void-texture:after { content: ""; }',
      '#atmosphere::before { content: ""; }',
      '.a, .void-texture.is-x::after { content: ""; }',
      "@media (min-width: 1px) { [data-texture='ash'] .void-texture::before { content: ''; } }",
    ]) {
      expect(texturePseudoElements(planted), planted).toHaveLength(1);
    }
    for (const clean of [
      '.void-art-frame::after { content: ""; }',
      '.void-texture { opacity: 0; }',
      '.void-texture-glow::before { content: ""; }',
      "[data-texture='flecks'] .void-texture { background: none; }",
    ]) {
      expect(texturePseudoElements(clean), clean).toEqual([]);
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

// =========================================================================================
// `speck-scatter` (2026-09-14) — NO SPECK LAYER IS A CENTRED LATTICE.
//
// The author, having played floors 2 and 3 after `floor-looks`: "the design were correct but I
// felt they were too grid like. like every speckle is on the same x and y axis level." They
// were: every speck layer was ONE positionless `radial-gradient(circle, …)` on its own tile, so
// every tile held one dot at its centre and every layer was a perfect grid of rows and columns.
// The tile sizes sharing no factor — the one defence the old comment claimed — only stops the
// COMBINED pattern repeating; it cannot hide any single layer's rows.
//
// So the detector below judges each TILE's own arrangement, from the CSS text and geometry only
// (tile size × percentage, dot radius), never from a render. It is proven red against the two
// rules exactly as `floor-looks` shipped them before it is trusted to pass the new ones.
// =========================================================================================

/** Greatest common divisor of two positive integers. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** A position that puts a dot dead centre. CSS's default, when there is no `at`, is the same. */
const CENTRED_AT = /^(?:center(?:\s+center)?|50%)$/;

/** The least a tile's column (or row) gaps must differ by, in percentage points, to read as uneven. */
const UNEVEN_GAP = 8;

// FIX ROUND 1 (2026-09-14). The verifier found what judging one tile ALONE cannot see: tiles sit
// edge to edge, so dots of neighbouring tiles line up. Floor 2's B tile had all four dots in a
// 1.22 px strip 250 px long ACROSS its edges, and every B fleck within ~3 px of parallel lines
// rising at ~24 degrees. The four rules below close that, and the near-misses the exact-equality
// rules let through.

/**
 * Two dots of one tile whose centres are nearer than this in x (or y) — across the tile's edge
 * too — share a column (row). Exact equality let 1.09 px apart pass. 8 px is more than one of the
 * widest flecks is across (a 3.4 px reach), so two dots this close sit in one band down the floor.
 */
const MIN_AXIS_GAP_PX = 8;

/**
 * A pair of dots (either may be a neighbouring tile's copy) nearer than this share of the spacing
 * they would have if spread perfectly evenly, √(w·h / dots), is a CLUMP.
 */
const CLUMP_SHARE = 0.5;

/**
 * The most a tile's dots may line up along one family of parallel lines — see `lineStrength`.
 *
 * WHERE 0.9 SITS, measured by the build over 8,000 random tiles per size, that pass the older
 * rules (distinct, uneven): it is the 70th percentile for four-dot tiles (it turns away the most
 * line-like 30%) and the 96th for six-dot tiles. What it means is the same at any dot count: at
 * 0.9 the dots sit, on average, within about 7% of the line spacing of one family of lines.
 * floor 2 as first scattered: A 0.939 (more line-like than 86% of random tiles), B 0.980 (97%).
 */
const LINE_LIMIT = 0.9;

/**
 * How strongly one tile's dots line up along a family of parallel straight lines that runs ACROSS
 * tile edges — which is what the eye sees, because tiles sit edge to edge.
 *
 * For whole numbers (m, n), the lines m·x/w + n·y/h = constant are a family of parallel lines that
 * every tile continues exactly, 1/|(m/w, n/h)| px apart. The strength is
 * |mean over the tile's dots of e^(2πi·(m·x% + n·y%)/100)|: 1 when every dot sits exactly on one
 * family (a one-dot tile scores 1 on every family — the grid the author saw), near 0 when the
 * dots are spread across it. Every (m, n) with |m|, |n| ≤ 3 is weighed — the verifier's families
 * and also their harmonics, the same lines at a half or a third of the spacing, which catch a tile
 * whose dots fall in two or three column bands — but only a family whose dots are no sparser
 * ALONG a line than 2.5 × the gap BETWEEN lines: sparser than that, nobody sees a line.
 */
function lineStrength(
  dots: readonly { x: number; y: number }[],
  w: number,
  h: number,
): { strength: number; m: number; n: number; spacing: number } {
  let best = { strength: 0, m: 0, n: 0, spacing: 0 };
  if (dots.length === 0) return best;
  for (let m = 0; m <= 3; m += 1) {
    for (let n = -3; n <= 3; n += 1) {
      if (m === 0 && n <= 0) continue; // (m, n) and (-m, -n) are one family
      const g = Math.hypot(m / w, n / h);
      const spacing = 1 / g;
      const along = (w * h * g) / dots.length;
      if (along > 2.5 * spacing) continue;
      let re = 0;
      let im = 0;
      for (const d of dots) {
        const phase = 2 * Math.PI * ((m * d.x + n * d.y) / 100);
        re += Math.cos(phase);
        im += Math.sin(phase);
      }
      const strength = Math.hypot(re, im) / dots.length;
      if (strength > best.strength) best = { strength, m, n, spacing };
    }
  }
  return best;
}

/**
 * Every way the speck layers of the rule styling `selector` ITSELF still read as a grid, or `[]`.
 * Each fault opens with a one-word code, then says what a player would see.
 *
 * A layer on a px tile is a DOT; the dots sharing one `background-size` are one TILE of dots,
 * judged together: at least four; each placed `circle at X% Y%` and none dead centre; no two
 * within 8 px of one column or one row; the column gaps, and the row gaps, not all alike; none
 * nearer its tile's edge than its own reach (a dot does not wrap onto the next tile, it is cut);
 * no two in a clump, counting the neighbouring tiles' copies; no three on one straight line; and
 * no family of parallel lines, running across the tile edges, that the dots line up along. Tiles
 * of one rule share no factor across or down. A layer on a relative (%) tile is a still haze and
 * is skipped — unless it draws a px dot, which would be a grid this cannot measure, and says so.
 *
 * Short per-layer lists are read the way CSS reads them — repeated from the top — so a dropped
 * entry is judged where the browser would really put that dot. And every dot of a tile must be
 * PLACED and MOVED as one (the rule's `background-position` and both ends of its loop): a dot
 * offset from its siblings is not where its percentage says, and would make everything judged
 * above a statement about a picture nobody sees.
 */
function latticeFaults(css: string, selector: string): string[] {
  const found = rulesFor(css, selector);
  if (found.length !== 1) return [`rules — ${selector} is styled by ${found.length} rules, not one`];
  const decls = declarations(found[0]!.body);
  const last = (prop: string): string => decls.filter((d) => d.prop === prop).at(-1)?.value ?? '';
  const calls = gradientCalls(last('background'));
  if (calls.length === 0) return [`no-gradient — ${selector} paints no gradient at all`];
  const faults: string[] = [];
  const sizes = splitTop(last('background-size'));
  if (sizes.length !== calls.length) {
    faults.push(`list — ${calls.length} gradient layers but ${sizes.length} background-size entries: CSS repeats the list, pairing dots with the wrong tile`);
  }
  const nth = (list: readonly string[], i: number): string =>
    list.length === 0 ? '' : (list[i % list.length] as string).replace(/\s+/g, ' ');

  type Dot = { x: number; y: number; r: number };
  const tiles = new Map<string, { w: number; h: number; layers: number[]; dots: Dot[] }>();
  const unjudged = new Set<string>();
  for (const [i, args] of calls.entries()) {
    const layer = i + 1;
    const size = nth(sizes, i);
    const [w, h] = size.split(' ').map(pxOf);
    const parts = splitTop(args);
    const preamble = parts.length > 0 && GRADIENT_PREAMBLE.test(parts[0] as string) ? (parts[0] as string) : '';
    const stops = preamble ? parts.slice(1) : parts;
    const reach = stops.flatMap((stop) => [...stop.matchAll(/(-?[\d.]+)px\b/g)].map((m) => Number(m[1])));
    if (w == null || h == null) {
      if (reach.length > 0) faults.push(`relative — layer ${layer} draws a px dot on a "${size}" tile, a grid this cannot measure`);
      continue;
    }
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      if (!unjudged.has(size)) faults.push(`tile — the "${size}" tile (layer ${layer} on) is not a whole number of px each way`);
      unjudged.add(size);
      continue;
    }
    if (!/^circle\b/.test(preamble)) {
      faults.push(`shape — layer ${layer} is not a circle ("${preamble || 'no shape'}"), so its px stops are not its reach`);
    }
    let x: number | null = null;
    let y: number | null = null;
    const at = /\bat\s+(.+)$/.exec(preamble)?.[1]?.trim();
    const xy = at === undefined ? null : /^(-?[\d.]+)%\s+(-?[\d.]+)%$/.exec(at);
    if (at === undefined || CENTRED_AT.test(at) || (xy && Number(xy[1]) === 50 && Number(xy[2]) === 50)) {
      faults.push(`centred — layer ${layer} ${at === undefined ? 'has no position' : `sits at "${at}"`}: one dot dead centre in every ${w}x${h} tile, a grid`);
      x = 50;
      y = 50;
    } else if (!xy) {
      faults.push(`position — layer ${layer} sits at "${at}", not X% Y%, so where it lands in its tile cannot be judged`);
    } else {
      x = Number(xy[1]);
      y = Number(xy[2]);
    }
    // How far the dot's ink reaches: the last stop must be `transparent` AT a px length, or the
    // fade runs on to the far corner of the tile. CSS clamps a stop to the one before it, so the
    // reach is the largest px length among the stops.
    const r = /^transparent\s+-?[\d.]+px$/.test(stops.at(-1) ?? '') ? Math.max(...reach) : null;
    if (r === null) {
      faults.push(`radius — layer ${layer} does not end on a transparent px stop, so how far its ink reaches is unknown`);
    } else if (x !== null && y !== null) {
      const margin = Math.min((x * w) / 100, ((100 - x) * w) / 100, (y * h) / 100, ((100 - y) * h) / 100);
      if (margin < r) {
        faults.push(`clipped — layer ${layer} at ${x}% ${y}% reaches ${r}px but sits ${Number(margin.toFixed(2))}px from its ${w}x${h} tile's edge: cut into a half-moon`);
      }
    }
    const key = `${w}x${h}`;
    const tile = tiles.get(key) ?? { w, h, layers: [], dots: [] };
    tile.layers.push(i);
    // A dot whose reach is unknown (the `radius` fault) counts as a point for the checks below.
    if (x !== null && y !== null) tile.dots.push({ x, y, r: r ?? 0 });
    tiles.set(key, tile);
  }

  const fixed = (v: number): number => Number(v.toFixed(2));
  for (const [key, tile] of tiles) {
    const { w, h, dots } = tile;
    if (tile.layers.length < 4) {
      faults.push(`sparse — the ${key} tile holds ${tile.layers.length} dot(s); fewer than four cannot hide the tile's own rows and columns`);
    }
    for (const [axis, side, line] of [['x', w, 'column'], ['y', h, 'row']] as const) {
      // Nearer than 8 px in this axis, the short way round — a dot at 4% and one at 97% of a tile
      // are neighbours across its edge.
      let near: string | null = null;
      for (const [k, a] of dots.entries()) {
        for (const b of dots.slice(k + 1)) {
          const apart = (Math.abs(a[axis] - b[axis]) * side) / 100;
          const gap = Math.min(apart, side - apart);
          if (near === null && gap < MIN_AXIS_GAP_PX) near = `${a[axis]}% and ${b[axis]}%, ${fixed(gap)}px apart`;
        }
      }
      if (near !== null) {
        faults.push(`${line} — two dots of the ${key} tile share a ${line} (${axis} ${near}; the least is ${MIN_AXIS_GAP_PX}px): every tile repeats them, a ${line} of dots across the floor`);
      }
      const values = dots.map((d) => d[axis]);
      const distinct = [...new Set(values)].sort((a, b) => a - b);
      const gaps = distinct.slice(1).map((v, k) => v - (distinct[k] as number));
      if (gaps.length >= 2 && Math.max(...gaps) - Math.min(...gaps) < UNEVEN_GAP) {
        faults.push(`even-${axis} — the ${key} tile's dots are evenly spaced in ${axis} (gaps ${gaps.join(', ')}): a finer grid`);
      }
    }
    const px = dots.map((d) => ({ ...d, X: (d.x * w) / 100, Y: (d.y * h) / 100 }));
    // A clump: two dots nearer than half the even spacing. A dot's neighbours include the
    // copies of its siblings in the eight tiles around it, because that is where they are seen.
    if (px.length >= 2) {
      const even = Math.sqrt((w * h) / px.length);
      let closest = Infinity;
      for (const [k, a] of px.entries()) {
        for (const b of px.slice(k + 1)) {
          for (const across of [-1, 0, 1]) {
            for (const down of [-1, 0, 1]) closest = Math.min(closest, Math.hypot(a.X - b.X - across * w, a.Y - b.Y - down * h));
          }
        }
      }
      if (closest < CLUMP_SHARE * even) {
        faults.push(`clump — two dots of the ${key} tile are ${fixed(closest)}px apart, under half the ${fixed(even)}px they would have if spread evenly`);
      }
    }
    // Three dots on one straight line: the middle one (the one not in the farthest-apart pair)
    // within one dot-width — twice the largest reach of the three — of the line through the others.
    let straight: string | null = null;
    for (const [i, a] of px.entries()) {
      for (const [j, b] of px.slice(i + 1).entries()) {
        for (const c of px.slice(i + j + 2)) {
          if (straight !== null) break;
          const trio = [a, b, c];
          const pairs = [[0, 1], [0, 2], [1, 2]] as const;
          const [p, q] = pairs.reduce((best, pair) => {
            const len = (u: readonly [number, number]): number => Math.hypot(trio[u[0]]!.X - trio[u[1]]!.X, trio[u[0]]!.Y - trio[u[1]]!.Y);
            return len(pair) > len(best) ? pair : best;
          });
          const [e1, e2, mid] = [trio[p]!, trio[q]!, trio[3 - p - q]!];
          const length = Math.hypot(e2.X - e1.X, e2.Y - e1.Y);
          if (length === 0) continue; // dots on one spot are a clump, and are reported as one
          const off = Math.abs((e2.X - e1.X) * (mid.Y - e1.Y) - (e2.Y - e1.Y) * (mid.X - e1.X)) / length;
          if (off < 2 * Math.max(a.r, b.r, c.r)) straight = `${e1.x}% ${e1.y}%, ${mid.x}% ${mid.y}%, ${e2.x}% ${e2.y}% — the middle one ${fixed(off)}px off`;
        }
      }
    }
    if (straight !== null) {
      faults.push(`collinear — three dots of the ${key} tile lie on one straight line (${straight}): a string of dots, repeated in every tile`);
    }
    const lines = lineStrength(dots, w, h);
    if (lines.strength > LINE_LIMIT) {
      faults.push(`lines — the ${key} tile's dots line up along the (${lines.m},${lines.n}) family of parallel lines, ${fixed(lines.spacing)}px apart, at strength ${fixed(lines.strength)} (1 is a perfect grid; the limit is ${LINE_LIMIT}): side by side, the tiles draw those lines across the floor`);
    }
  }

  const all = [...tiles.entries()];
  for (const [k, [ka, a]] of all.entries()) {
    for (const [kb, b] of all.slice(k + 1)) {
      if (gcd(a.w, b.w) !== 1) faults.push(`widths — the ${ka} and ${kb} tiles share a factor of ${gcd(a.w, b.w)} across: their columns fall into step`);
      if (gcd(a.h, b.h) !== 1) faults.push(`heights — the ${ka} and ${kb} tiles share a factor of ${gcd(a.h, b.h)} down: their rows fall into step`);
    }
  }

  const loop = loopPositions(css, selector);
  for (const [name, list] of [
    ['its background-position', splitTop(last('background-position'))],
    ["its loop's from", loop?.from ?? []],
    ["its loop's to", loop?.to ?? []],
  ] as const) {
    if (list.length === 0) continue;
    for (const [key, tile] of tiles) {
      const placed = new Set(tile.layers.map((i) => nth(list, i)));
      if (placed.size > 1) {
        faults.push(`drift — ${name} puts the ${key} tile's dots in different places (${[...placed].join(' | ')}): they are not one tile`);
      }
    }
  }
  return faults;
}

/** How near two rows (or columns) of dots must be to add up into one line — the verifier's band. */
const BAND_PX = 6;

/**
 * The picture AT REST — what a reduced-motion player always sees, and the first frame of every
 * loop — as crowding into bands. One dot of one tile makes a row of dots right across the screen,
 * one per tile; that row alone is too sparse to read as a line. But when the rows of several
 * TILES fall within 6 px of each other they add up into one. Returns the most different tiles
 * whose rows share any 6-px band across a `width` x `height` screen (and where the first such band
 * starts), and the same for columns, from the rule's own `background-position` and each dot's
 * `circle at X% Y%`.
 */
function restingBands(
  css: string,
  selector: string,
  width: number,
  height: number,
): { rows: number; rowAt: number; columns: number; columnAt: number } {
  const decls = declarations(rulesFor(css, selector)[0]?.body ?? '');
  const last = (prop: string): string => decls.filter((d) => d.prop === prop).at(-1)?.value ?? '';
  const sizes = splitTop(last('background-size'));
  const positions = splitTop(last('background-position'));
  const marks = { x: [] as { at: number; tile: string }[], y: [] as { at: number; tile: string }[] };
  for (const [i, args] of gradientCalls(last('background')).entries()) {
    const size = sizes.length > 0 ? (sizes[i % sizes.length] as string) : '';
    const [w, h] = size.split(/\s+/).map(pxOf);
    const xy = /\bat\s+(-?[\d.]+)%\s+(-?[\d.]+)%/.exec(splitTop(args)[0] ?? '');
    const [ox, oy] = (positions.length > 0 ? (positions[i % positions.length] as string) : '0px 0px').split(/\s+/).map(pxOf);
    if (w == null || h == null || !xy || ox == null || oy == null) continue;
    for (const [axis, pct, side, offset, extent] of [
      ['x', Number(xy[1]), w, ox, width],
      ['y', Number(xy[2]), h, oy, height],
    ] as const) {
      for (let at = ((((pct * side) / 100 + offset) % side) + side) % side; at < extent; at += side) {
        marks[axis].push({ at, tile: `${w}x${h}` });
      }
    }
  }
  const crowd = (list: { at: number; tile: string }[]): [number, number] => {
    list.sort((a, b) => a.at - b.at);
    let most = 0;
    let where = Number.NaN;
    for (const [i, mark] of list.entries()) {
      const tiles = new Set<string>();
      for (let j = i; j < list.length && (list[j] as { at: number }).at < mark.at + BAND_PX; j += 1) tiles.add((list[j] as { tile: string }).tile);
      if (tiles.size > most) {
        most = tiles.size;
        where = mark.at;
      }
    }
    return [most, where];
  };
  const [rows, rowAt] = crowd(marks.y);
  const [columns, columnAt] = crowd(marks.x);
  return { rows, rowAt, columns, columnAt };
}

/**
 * The ink a speck field lays per px² of screen: every dot's alpha summed over its disc, over its
 * tile's area. A dot is solid ink out to its first stop's end (r1) and fades in a straight line
 * to transparent at r2, and the integral of that is (π/3)(r1² + r1·r2 + r2²) — a solid disc when
 * r1 = r2, a cone (a third of its base) when r1 = 0.
 */
function inkCoverage(css: string, selector: string): number {
  const decls = declarations(rulesFor(css, selector)[0]?.body ?? '');
  const last = (prop: string): string => decls.filter((d) => d.prop === prop).at(-1)?.value ?? '';
  const sizes = splitTop(last('background-size'));
  let ink = 0;
  for (const [i, args] of gradientCalls(last('background')).entries()) {
    const [w, h] = (sizes.length > 0 ? (sizes[i % sizes.length] as string) : '').split(/\s+/).map(pxOf);
    const parts = splitTop(args);
    const stops = parts.length > 0 && GRADIENT_PREAMBLE.test(parts[0] as string) ? parts.slice(1) : parts;
    const end = /^transparent\s+(-?[\d.]+)px$/.exec(stops.at(-1) ?? '');
    if (w == null || h == null || !end || stops.length < 2) continue;
    const r1 = Number([...(stops[0] as string).matchAll(/(-?[\d.]+)px\b/g)].at(-1)?.[1] ?? 0);
    const r2 = Number(end[1]);
    ink += ((Math.PI / 3) * (r1 * r1 + r1 * r2 + r2 * r2)) / (w * h);
  }
  return ink;
}

describe('no speck layer is a centred lattice (speck-scatter)', () => {
  const FLECKS = "[data-texture='flecks'] .void-texture";
  const ASH = "[data-texture='ash'] .void-texture";
  /** The faults' codes, sorted — what each case below is judged on. */
  const codes = (faults: readonly string[]): string[] => faults.map((f) => f.split(' ')[0] as string).sort();

  // THE TWO RULES AS `floor-looks` SHIPPED THEM — TRANSCRIBED from `atmosphere.css` at 39ea7b1,
  // whitespace-normalised, never read back from the file under test. They are the defect the
  // author saw, and the detector must report it before its silence on the new rules means a thing.
  const OLD_FLECKS =
    "[data-texture='flecks'] .void-texture { background: radial-gradient(circle, var(--void-texture-ink) 0 1.5px, transparent 2.5px), radial-gradient(circle, var(--void-texture-ink) 0 1px, transparent 2px), radial-gradient(circle, var(--void-texture-ink) 0 2px, transparent 3px); background-size: 47px 61px, 83px 71px, 131px 157px; background-position: 0px 0px, 19px 37px, 61px 23px; animation: void-flecks-drift 60s linear infinite; }";
  const OLD_ASH =
    "[data-texture='ash'] .void-texture { background: radial-gradient(circle, var(--void-texture-ink) 0 0.8px, transparent 1.4px), radial-gradient(circle, var(--void-texture-ink) 0 1.3px, transparent 2px), radial-gradient(110% 80% at 26% 18%, var(--void-texture-ink), transparent 64%), radial-gradient(90% 72% at 82% 92%, var(--void-texture-ink), transparent 68%); background-size: 41px 53px, 67px 89px, 150% 150%, 140% 140%; background-position: 0px 0px, 23px 11px, 20% 10%, 80% 90%; animation: void-ash-fall 14s linear infinite; }";

  // FLOOR 2 AS THIS UNIT FIRST SCATTERED IT (db7bbcb) — TRANSCRIBED, whitespace-normalised. Every
  // per-tile rule of the first build passed it; the verifier then measured what they cannot see:
  // A's and B's dots lining up across their tile edges (A 0.94, B 0.98 on the (1,2) family).
  const FIRST_BUILD_FLECKS =
    "[data-texture='flecks'] .void-texture { background: radial-gradient(circle at 11% 67%, var(--void-texture-ink) 0 1.2px, transparent 2px), radial-gradient(circle at 29% 14%, var(--void-texture-ink) 0 1.6px, transparent 2.5px), radial-gradient(circle at 58% 46%, var(--void-texture-ink) 0 1px, transparent 1.8px), radial-gradient(circle at 83% 88%, var(--void-texture-ink) 0 1.4px, transparent 2.2px), radial-gradient(circle at 19% 38%, var(--void-texture-ink) 0 1px, transparent 1.8px), radial-gradient(circle at 41% 79%, var(--void-texture-ink) 0 1.8px, transparent 2.8px), radial-gradient(circle at 72% 9%, var(--void-texture-ink) 0 1.3px, transparent 2.1px), radial-gradient(circle at 91% 52%, var(--void-texture-ink) 0 1.5px, transparent 2.4px), radial-gradient(circle at 8% 22%, var(--void-texture-ink) 0 2px, transparent 3px), radial-gradient(circle at 39% 63%, var(--void-texture-ink) 0 1.4px, transparent 2.3px), radial-gradient(circle at 66% 33%, var(--void-texture-ink) 0 1.7px, transparent 2.6px), radial-gradient(circle at 88% 86%, var(--void-texture-ink) 0 2.2px, transparent 3.2px); background-size: 131px 109px, 131px 109px, 131px 109px, 131px 109px, 173px 151px, 173px 151px, 173px 151px, 173px 151px, 227px 197px, 227px 197px, 227px 197px, 227px 197px; background-position: 0px 0px; animation: void-flecks-drift 90s linear infinite; }";

  it('reports the grid the author saw: the flecks as floor-looks shipped them', () => {
    // Three layers, not one with an `at` — three dots dead centre; each on its own tile — three
    // tiles of ONE dot; and a one-dot tile sits exactly on every family of lines (strength 1). The
    // tiles (47, 83, 131 across; 61, 71, 157 down) are all prime, so the one clause the old
    // comment relied on passes, and was never going to be enough.
    expect(codes(latticeFaults(OLD_FLECKS, FLECKS))).toEqual(['centred', 'centred', 'centred', 'lines', 'lines', 'lines', 'sparse', 'sparse', 'sparse']);
  });

  it('...and the ash as floor-looks shipped it', () => {
    // Two speck layers, centred, one per tile. The two haze layers are on % tiles: not specks.
    expect(codes(latticeFaults(OLD_ASH, ASH))).toEqual(['centred', 'centred', 'lines', 'lines', 'sparse', 'sparse']);
  });

  it('reports the diagonal the verifier found in floor 2 as first scattered: A and B, not C', () => {
    // A 0.939 and B 0.980 on the (1,2) family, over the 0.9 limit; C's strongest is 0.833.
    expect(codes(latticeFaults(FIRST_BUILD_FLECKS, FLECKS))).toEqual(['lines', 'lines']);
    expect(latticeFaults(FIRST_BUILD_FLECKS, FLECKS).join('\n')).toMatch(/131x109 tile's dots line up along the \(1,2\) family[\s\S]*173x151 tile's dots line up along the \(1,2\) family/);
  });

  it('the shipped flecks and ash are not a lattice', () => {
    expect(latticeFaults(ALL_CSS, FLECKS)).toEqual([]);
    expect(latticeFaults(ALL_CSS, ASH)).toEqual([]);
  });

  it('line strength: 1 for one dot, 1 for a finer grid inside a tile, and the first build by hand', () => {
    expect(lineStrength([{ x: 37, y: 61 }], 101, 103).strength, 'one dot is a grid').toBeCloseTo(1, 9);
    // A 2x2 grid inside the tile is a grid at half the spacing: on (0,2), every phase is 1/2 a turn.
    const grid = [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 25, y: 75 }, { x: 75, y: 75 }];
    expect(lineStrength(grid, 101, 103).strength, 'a 2x2 grid').toBeCloseTo(1, 9);
    // B as first scattered, on (1,2): phases (x + 2y)/100 = .95 .99 .90 .95 of a turn, so the
    // mean of the four unit arrows is (3.709, -1.269)/4, length 0.980.
    const b = lineStrength([{ x: 19, y: 38 }, { x: 41, y: 79 }, { x: 72, y: 9 }, { x: 91, y: 52 }], 173, 151);
    expect(b.strength).toBeCloseTo(0.98, 3);
    expect([b.m, b.n]).toEqual([1, 2]);
    // A as first scattered, on (1,2): phases .45 .57 .50 .59 — mean (-3.700, -0.653)/4, length 0.939.
    const a = lineStrength([{ x: 11, y: 67 }, { x: 29, y: 14 }, { x: 58, y: 46 }, { x: 83, y: 88 }], 131, 109);
    expect(a.strength).toBeCloseTo(0.939, 3);
    expect([a.m, a.n]).toEqual([1, 2]);
  });

  it('at rest, no 6-px band gathers rows (or columns) from all three fleck tiles', () => {
    // The first build started all three tiles at 0 0. Its rows met at 119.29px — B's 79% of 151 —
    // with C's 63% of 197 (124.11) and A's 14% of 109 one tile down (124.26): 4.97px, one band.
    const first = restingBands(FIRST_BUILD_FLECKS, FLECKS, 1920, 1080);
    expect(first.rows, 'rows').toBe(3);
    expect(first.rowAt).toBeCloseTo(119.29, 2);
    // ...and its columns, at 75.98 + 3x131, 124.56 + 2x173 and 18.16 + 2x227: 468.98 to 472.16.
    expect(first.columns, 'columns').toBe(3);
    // The shipped offsets were chosen so no three tiles' rows meet on screens up to 2160 CSS px
    // tall, nor their columns up to 5120 wide (the largest a desktop gives at 100% scaling).
    const now = restingBands(ALL_CSS, FLECKS, 5120, 2160);
    expect(now.rows, `rows meet at ${now.rowAt}px`).toBeLessThanOrEqual(2);
    expect(now.columns, `columns meet at ${now.columnAt}px`).toBeLessThanOrEqual(2);
  });

  it('every loop begins on the still frame, so the moment it comes round is the picture above', () => {
    for (const selector of [FLECKS, ASH]) {
      const own = splitTop(declarations(rulesFor(ALL_CSS, selector)[0]!.body).filter((d) => d.prop === 'background-position').at(-1)?.value ?? '');
      const from = loopPositions(ALL_CSS, selector)?.from ?? [];
      expect(from.length, selector).toBeGreaterThan(0);
      expect(from.map((_, i) => own[i % own.length]), selector).toEqual(from);
    }
  });

  it('the ink the author approved: each floor within 10% of the floor-looks density', () => {
    const one = (stops: string): number =>
      inkCoverage(`.t { background: radial-gradient(circle at 50% 50%, ${stops}); background-size: 10px 10px; }`, '.t');
    expect(one('var(--void-texture-ink) 0 2px, transparent 2px'), 'a hard disc is its own area').toBeCloseTo((Math.PI * 4) / 100, 12);
    expect(one('var(--void-texture-ink), transparent 3px'), 'a pure fade is a cone').toBeCloseTo((Math.PI * 9) / 3 / 100, 12);
    for (const [selector, old] of [[FLECKS, OLD_FLECKS], [ASH, OLD_ASH]] as const) {
      const ratio = inkCoverage(ALL_CSS, selector) / inkCoverage(old, selector);
      expect(Math.abs(ratio - 1), `${selector} carries ${ratio} of the ink it had`).toBeLessThanOrEqual(0.1);
    }
    // The first scatter ran light: its dots' soft edges were thinner than the old ones.
    expect(inkCoverage(FIRST_BUILD_FLECKS, FLECKS) / inkCoverage(OLD_FLECKS, FLECKS), 'the first build').toBeLessThan(0.9);
  });

  it('...and that silence is not blindness: un-placing one shipped dot is reported', () => {
    for (const selector of [FLECKS, ASH]) {
      const body = rulesFor(ALL_CSS, selector)[0]!.body;
      const unplaced = body.replace(/circle at [\d.]+% [\d.]+%/, 'circle');
      expect(unplaced, `${selector} has no placed dot to un-place`).not.toBe(body);
      expect(codes(latticeFaults(`${selector} { ${unplaced} }`, selector)), selector).toContain('centred');
    }
  });

  describe('the detector fires on each fault alone, and passes a compliant rule', () => {
    // Two tiles, every side prime (101x103, 107x109), four dots each, every dot reaching 2px.
    //   P: x 18 32 66 87 (gaps 14 34 21, spread 20)   y 21 59 74 87 (gaps 38 15 13, spread 25)
    //   Q: x 15 41 69 88 (gaps 26 28 19, spread 9)    y 12 30 58 79 (gaps 18 28 21, spread 10)
    //   Nearest edge: P 13.13px (13% of 101), Q 12.84px (12% of 107) — all far over 2px.
    //   Closest pair, neighbour copies included: P 32.1px, Q 42.0px — over the clump lines,
    //   half of √(101·103/4) = 25.5 and half of √(107·109/4) = 27.0.
    //   Line strength: P 0.64, Q 0.79 — under 0.9. (An earlier P, 12 61 · 33 20 · 64 88 · 86 47,
    //   was picked by eye as "scattered" and scored 0.993: a near-perfect diagonal. Hence the rule.)
    // Each case changes ONE thing — nearly always P's 32% 87% — and beside it is the arithmetic for
    // why that, and only that, fires.
    const dot = (at: string | null): string =>
      `radial-gradient(circle${at === null ? '' : ` at ${at}`}, var(--void-texture-ink) 0 1px, transparent 2px)`;
    const speckRule = (tiles: { size: string; dots: (string | null)[] }[], extra = ''): string => {
      const layers = tiles.flatMap((t) => t.dots.map((at) => ({ size: t.size, image: dot(at) })));
      return `.t { background: ${layers.map((l) => l.image).join(', ')}; background-size: ${layers.map((l) => l.size).join(', ')};${extra} }`;
    };
    const P = { size: '101px 103px', dots: ['18% 59%', '32% 87%', '66% 21%', '87% 74%'] as (string | null)[] };
    // Q's dot at 41% 79% is listed LAST on purpose — see the `list` case.
    const Q = { size: '107px 109px', dots: ['69% 12%', '88% 58%', '15% 30%', '41% 79%'] as (string | null)[] };
    const withP = (dots: (string | null)[]): string => speckRule([{ ...P, dots }, Q]);
    const judge = (css: string): string[] => codes(latticeFaults(css, '.t'));
    const COMPLIANT = speckRule([P, Q]);

    it('a compliant rule has no faults — with a still haze beside it, and one position for every layer', () => {
      expect(judge(COMPLIANT)).toEqual([]);
      const hazed = COMPLIANT.replace('background: ', 'background: radial-gradient(110% 80% at 26% 18%, var(--void-texture-ink), transparent 64%), ')
        .replace('background-size: ', 'background-size: 150% 150%, ');
      expect(judge(hazed), 'a % haze is not a speck').toEqual([]);
      expect(judge(speckRule([P, Q], ' background-position: 7px 3px;')), 'one position repeats for every layer').toEqual([]);
    });

    it('a dot dead centre — however it is written', () => {
      // 32% 87% moved to 50 50: x 18 50 66 87 (gaps 32 16 21), y 21 50 59 74 (gaps 29 9 15);
      // 50% of 103 is 9.27px from the 59% row, and the nearest dot (18 59) is 33.6px away.
      for (const at of ['center', 'center center', '50%', '50% 50%', null]) {
        expect(judge(withP(['18% 59%', at, '66% 21%', '87% 74%'])), String(at)).toEqual(['centred']);
      }
    });

    it('the tricks: every dot centred, or every dot stacked on one spot', () => {
      // Four dots on one spot: every pair shares a column and a row, is 0px apart (a clump), and
      // sits exactly on every family of lines (strength 1). Three dots on one spot are not counted
      // as a straight line — that is the clump.
      const pile = ['clump', 'column', 'lines', 'row'];
      expect(judge(withP(['center', 'center', 'center', 'center'])), 'all centre').toEqual(['centred', 'centred', 'centred', 'centred', ...pile]);
      expect(judge(withP(['50% 50%', '50% 50%', '50% 50%', '50% 50%'])), 'all 50% 50%').toEqual(['centred', 'centred', 'centred', 'centred', ...pile]);
      expect(judge(withP(['18% 59%', '18% 59%', '18% 59%', '18% 59%'])), 'stacked').toEqual(pile);
    });

    it('three dots on a tile', () => {
      // P without 32% 87%: x 18 66 87 (gaps 48 21), y 21 59 74 (gaps 38 15).
      expect(judge(withP(['18% 59%', '66% 21%', '87% 74%']))).toEqual(['sparse']);
    });

    it('two dots sharing a column, or a row — exactly, 1% apart, or across the tile edge', () => {
      expect(judge(withP(['18% 59%', '18% 87%', '66% 21%', '87% 74%'])), 'x 18 twice').toEqual(['column']);
      expect(judge(withP(['18% 59%', '19% 87%', '66% 21%', '87% 74%'])), '1% of 101 = 1.01px').toEqual(['column']);
      expect(judge(withP(['18% 59%', '32% 21%', '66% 21%', '87% 74%'])), 'y 21 twice').toEqual(['row']);
      expect(judge(withP(['18% 59%', '32% 22%', '66% 21%', '87% 74%'])), '1% of 103 = 1.03px').toEqual(['row']);
      // 4% and 97%: 4 + 3 = 7% of 101 = 7.07px apart the short way, across the edge.
      expect(judge(withP(['18% 59%', '4% 32%', '66% 21%', '97% 74%'])), 'across the edge').toEqual(['column']);
    });

    it('evenly spaced columns, or rows — and where uneven begins', () => {
      // x 18 42 66 87: gaps 24 24 21, spread 3.
      expect(judge(withP(['18% 59%', '42% 87%', '66% 21%', '87% 74%']))).toEqual(['even-x']);
      // y 21 38 59 74: gaps 17 21 15, spread 6.
      expect(judge(withP(['18% 59%', '32% 38%', '66% 21%', '87% 74%']))).toEqual(['even-y']);
      // x 18 38.5 66 87: gaps 20.5 27.5 21, spread 7 — under 8, still a grid.
      expect(judge(withP(['18% 59%', '38.5% 87%', '66% 21%', '87% 74%'])), 'spread 7').toEqual(['even-x']);
      // x 18 38 66 87: gaps 20 28 21, spread 8 — uneven enough.
      expect(judge(withP(['18% 59%', '38% 87%', '66% 21%', '87% 74%'])), 'spread 8').toEqual([]);
    });

    it('a dot cut by its tile edge, on each of the four edges', () => {
      // 1% of 101 = 1.01px and 1% of 103 = 1.03px, both under the 2px reach.
      expect(judge(withP(['18% 59%', '1% 33%', '66% 21%', '87% 74%'])), 'left').toEqual(['clipped']);
      expect(judge(withP(['18% 59%', '99% 33%', '66% 21%', '87% 74%'])), 'right').toEqual(['clipped']);
      expect(judge(withP(['18% 59%', '32% 87%', '66% 1%', '87% 74%'])), 'top').toEqual(['clipped']);
      expect(judge(withP(['18% 59%', '32% 99%', '66% 21%', '87% 74%'])), 'bottom').toEqual(['clipped']);
    });

    it('two dots in a clump, though a column and a row apart', () => {
      // 37 50 is 19% (19.19px) across and 9% (9.27px) down from 18 59 — both over 8px — but
      // √(19.19² + 9.27²) = 21.3px apart, under half of √(101·103/4) = 25.5.
      expect(judge(withP(['18% 59%', '37% 50%', '66% 21%', '87% 74%']))).toEqual(['clump']);
      // 32% 87% -> 4% 87%: inside the tile its nearest dot (18 59) is 32.1px away — but the copy of
      // 87% 74% in the tile to its LEFT is 4 + 13 = 17% (17.17px) across and 13% (13.39px) up:
      // 21.8px. Only a check that counts the neighbouring tiles' copies sees it.
      expect(judge(withP(['18% 59%', '4% 87%', '66% 21%', '87% 74%'])), 'across the edge').toEqual(['clump']);
    });

    it('three dots on one straight line', () => {
      // 66 21, 77 48, 87 74 are (66.66, 21.63), (77.77, 49.44), (87.87, 76.22) px: the middle one
      // is |21.21·27.81 − 54.59·11.11| / 58.57 = 0.28px off the line through the other two, under
      // one dot-width (twice the 2px reach).
      expect(judge(withP(['18% 59%', '77% 48%', '66% 21%', '87% 74%']))).toEqual(['collinear']);
    });

    it('a tile whose dots line up across its edges — or fall in column bands', () => {
      // The first build's B, in percentages, on P's tile: 0.980 on (1,2), whatever the tile, as
      // long as that family is seen — here its lines are 45.9px apart, its dots 56.7px along one.
      expect(judge(withP(['19% 38%', '41% 79%', '72% 9%', '91% 52%'])), 'the first B').toEqual(['lines']);
      // Two column bands per tile: 20/24 and 70/74, 4% of 227 = 9.08px apart (over 8). Only the
      // harmonic (2,0) — lines 113.5px apart — sees it: phases .40 .48 .40 .48 of a turn, strength
      // cos(0.08π) = 0.969. The verifier's own families top out at 0.743 on this tile.
      const bands = speckRule([{ size: '227px 197px', dots: ['20% 8%', '24% 35%', '70% 40%', '74% 75%'] }]);
      expect(judge(bands), 'column bands').toEqual(['lines']);
      expect(latticeFaults(bands, '.t')[0]).toMatch(/\(2,0\) family of parallel lines, 113\.5px apart, at strength 0\.97/);
    });

    it('two tiles sharing a width, or a factor across or down', () => {
      expect(judge(speckRule([P, { ...Q, size: '101px 109px' }])), 'the same width').toEqual(['widths']);
      expect(judge(speckRule([P, { ...Q, size: '202px 109px' }])), '202 = 2 x 101').toEqual(['widths']);
      expect(judge(speckRule([P, { ...Q, size: '107px 206px' }])), '206 = 2 x 103').toEqual(['heights']);
    });

    it('a dot that is not a measurable circle', () => {
      expect(judge(COMPLIANT.replace('circle at 32% 87%', 'ellipse at 32% 87%')), 'an ellipse').toEqual(['shape']);
      expect(judge(COMPLIANT.replace('circle at 32% 87%', 'circle at 33px 90px')), 'placed in px').toEqual(['position']);
      expect(judge(COMPLIANT.replace('32% 87%, var(--void-texture-ink) 0 1px, transparent 2px', '32% 87%, var(--void-texture-ink) 0 1px')), 'no transparent end').toEqual(['radius']);
      expect(judge(COMPLIANT.replace('32% 87%, var(--void-texture-ink) 0 1px, transparent 2px', '32% 87%, var(--void-texture-ink) 0 1px, transparent')), 'an end with no length').toEqual(['radius']);
      expect(judge(speckRule([P, Q, { size: '5% 5%', dots: ['20% 30%'] }])), 'a px dot on a % tile').toEqual(['relative']);
      expect(judge(speckRule([{ ...P, size: '101.5px 103px' }, Q])), 'a fractional tile').toEqual(['tile']);
    });

    it('a per-layer list one entry short — judged where CSS would put the orphan', () => {
      // Seven sizes for eight layers: the eighth layer (Q's 41% 79%) takes the FIRST size and
      // lands on P's tile, where it crowds what is there: 5% of 103 = 5.15px from P's 74% row, and
      // 9.09px across and 8.24px down from P's 32% 87% — 12.3px, under half of √(101·103/5) = 22.8.
      // Q is left three dots: sparse. (Q: x 15 69 88, gaps 54 19; y 12 30 58, gaps 18 28.)
      expect(judge(COMPLIANT.replace(/, 107px 109px;/, ';'))).toEqual(['clump', 'list', 'row', 'sparse']);
    });

    it('one dot of a tile placed or moved apart from the others', () => {
      const apart = ' background-position: 0px 0px, 5px 0px, 0px 0px, 0px 0px, 0px 0px, 0px 0px, 0px 0px, 0px 0px;';
      expect(judge(speckRule([P, Q], apart)), 'placed apart').toEqual(['drift']);
      const loop = (to: string): string =>
        `${speckRule([P, Q], ' animation: m 10s linear infinite;')}\n@keyframes m { from { background-position: 0px 0px; } to { background-position: ${to}; } }`;
      const together = '101px 103px, 101px 103px, 101px 103px, 101px 103px, 107px 109px, 107px 109px, 107px 109px, 107px 109px';
      expect(judge(loop(together)), 'each tile moves as one').toEqual([]);
      expect(judge(loop(together.replace('101px 103px, 101px 103px', '101px 103px, 101px 0px'))), 'moved apart').toEqual(['drift']);
    });

    it('no rule, or a rule that paints nothing', () => {
      expect(judge('.u { background: none; }')).toEqual(['rules']);
      expect(judge('.t { background: none; }')).toEqual(['no-gradient']);
    });
  });
});

// =========================================================================================
// `floor-looks` (2026-09-12) — THE RE-THEME DISSOLVE, coupled at both ends (AC-11), KEPT under
// reduced motion (AC-10), and the light ground's inverted strike flash (AC-14).
//
// The dissolve itself — that the ground really passes through the in-between colours in the
// built page — is measured in real Chromium by `src/dev/layoutProbe.test.ts`. What a source
// scan holds here is the STRUCTURE it depends on: every colour token registered and transitioned,
// the list and tokens.ts agreeing name for name, and no reduced-motion rule reaching the root.
// =========================================================================================

/** Every `@property --name { … }` registration in a stylesheet, name -> body. */
function registrations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/@property\s+(--[-\w]+)\s*\{([^{}]*)\}/g)) out.set(m[1] as string, m[2] as string);
  return out;
}

/** The `:root { transition: … }` list, as `{ name, duration }` per comma-separated entry. */
function rootTransitions(css: string): { name: string; duration: string; rest: string }[] {
  const out: { name: string; duration: string; rest: string }[] = [];
  for (const rule of rulesFor(css, ':root')) {
    for (const d of declarations(rule.body).filter((x) => x.prop === 'transition')) {
      for (const entry of splitTop(d.value)) {
        const [name = '', duration = '', ...rest] = entry.split(/\s+(?![^(]*\))/);
        out.push({ name, duration, rest: rest.join(' ') });
      }
    }
  }
  return out;
}

/**
 * True when a selector's SUBJECT can be the root element itself: a single compound (no
 * descendant or child part) carrying no class, no id and no type other than `html`. In this
 * codebase every `[data-*]` hook but the screen/layout pair lives ON the root, so a bare
 * `[data-motion='reduce']` targets `<html>` — which is exactly the shape that would switch the
 * dissolve off for the players who asked for less motion.
 */
function targetsRoot(selector: string): boolean {
  // Collapse bracketed and parenthesised text so their spaces and dots cannot read as structure.
  let flat = selector.trim();
  for (let prev = ''; prev !== flat; ) {
    prev = flat;
    flat = flat.replace(/\[[^[\]]*\]/g, '[]').replace(/\([^()]*\)/g, '()');
  }
  if (/\s|[>+~]/.test(flat)) return false; // more than one compound: the subject is a descendant
  if (/[.#]/.test(flat) || /::/.test(flat)) return false;
  const type = /^[a-zA-Z][\w-]*/.exec(flat)?.[0];
  return type === undefined || type.toLowerCase() === 'html';
}

/** Does a rule body declare anything that would change the root's transition? */
function touchesTransition(body: string): boolean {
  return declarations(body).some((d) => d.prop.startsWith('transition'));
}

/** The body of the first `@media (prefers-reduced-motion: reduce)` block in a stylesheet. */
function reducedMotionBlock(css: string): string {
  const start = css.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

/** Every selector — in either reduced-motion context — whose rule would reach the root's transition. */
function reducedMotionRootTransitions(css: string): string[] {
  const offenders: string[] = [];
  const contexts = [
    { name: "[data-motion='reduce']", selectors: selectorsCarrying(css, "[data-motion='reduce']") },
    {
      name: 'prefers-reduced-motion',
      selectors: rules(reducedMotionBlock(css)).flatMap((r) =>
        r.selector.split(',').map((s) => ({ selector: s.trim(), body: r.body })),
      ),
    },
  ];
  for (const { name, selectors } of contexts) {
    for (const { selector, body } of selectors) {
      if (targetsRoot(selector) && touchesTransition(body)) offenders.push(`${name}: ${selector}`);
    }
  }
  return offenders;
}

describe('the re-theme dissolve is coupled to tokens.ts at both ends (AC-11)', () => {
  const TOKENS_CSS = SHEETS.find((s) => s.name === 'tokens.css');

  it('THE CONTROL: the root really transitions, and every entry lasts --void-fade-retheme', () => {
    const list = rootTransitions(ALL_CSS);
    expect(list.length, 'nothing transitions on :root — the floor change snaps').toBeGreaterThan(0);
    for (const t of list) {
      expect(t.duration, `${t.name} does not last the token's duration`).toBe('var(--void-fade-retheme)');
      expect(t.rest, `${t.name}: an easing other than the dissolve's`).toBe('ease-in-out');
    }
    // ...and that token is written by the theme, from the one number the log line reports.
    expect(themeVars(0)['--void-fade-retheme']).toBe(`${RETHEME_FADE_MS}ms`);
  });

  it('FORWARD: every colour token the dissolve is meant to carry is registered AND transitioned', () => {
    const registered = registrations(ALL_CSS);
    const transitioned = new Set(rootTransitions(ALL_CSS).map((t) => t.name));
    expect(FADED_VARS.length, 'FADED_VARS is empty — nothing would fade').toBe(12);
    for (const name of FADED_VARS) {
      expect(registered.has(name), `${name} is not registered — it would SNAP while its siblings fade`).toBe(true);
      expect(transitioned.has(name), `${name} is registered but never transitioned`).toBe(true);
    }
  });

  it('BACKWARD: nothing is registered or transitioned that tokens.ts does not list', () => {
    const listed = new Set(FADED_VARS);
    expect([...registrations(ALL_CSS).keys()].filter((n) => !listed.has(n)), 'a registration FADED_VARS does not know').toEqual([]);
    expect(rootTransitions(ALL_CSS).map((t) => t.name).filter((n) => !listed.has(n)), 'a transition FADED_VARS does not know').toEqual([]);
    // In particular the texture's ink and opacity are NOT faded: the pattern swaps at once.
    expect(listed.has('--void-texture-ink')).toBe(false);
    expect(listed.has('--void-texture-opacity')).toBe(false);
  });

  it('every registration is an inherited <color> starting transparent, and all of them live in tokens.css', () => {
    for (const [name, body] of registrations(ALL_CSS)) {
      const decls = Object.fromEntries(declarations(body).map((d) => [d.prop, d.value]));
      expect(decls['syntax'], `${name}: not a colour — it would not interpolate as one`).toBe("'<color>'");
      expect(decls['inherits'], `${name}: not inherited — no descendant would see the fade`).toBe('true');
      expect(decls['initial-value'], `${name}: a starting colour other than the keyword`).toBe('transparent');
    }
    expect(TOKENS_CSS, 'tokens.css is not among the scanned sheets').toBeDefined();
    expect(registrations(TOKENS_CSS!.css).size, 'the registrations moved out of tokens.css').toBe(FADED_VARS.length);
  });

  it('the readers parse the shapes they are handed (or the couplings above read nothing)', () => {
    const css =
      "@property --a { syntax: '<color>'; inherits: true; initial-value: transparent; }\n" +
      ':root {\n  transition:\n    --a var(--void-fade-retheme) ease-in-out,\n    --b 2s linear;\n}';
    expect([...registrations(css).keys()]).toEqual(['--a']);
    expect(rootTransitions(css)).toEqual([
      { name: '--a', duration: 'var(--void-fade-retheme)', rest: 'ease-in-out' },
      { name: '--b', duration: '2s', rest: 'linear' },
    ]);
  });
});

describe('reduced motion does NOT stop the re-theme dissolve — it moves nothing, and it removes the white-out (AC-10)', () => {
  it('no reduced-motion rule, in either context, reaches the root’s transition', () => {
    expect(
      reducedMotionRootTransitions(ALL_CSS),
      'a reduced-motion rule switches the dissolve off — the players who asked for less motion ' +
        'would get the one-frame jump from near-black to white instead',
    ).toEqual([]);
  });

  it('...while the texture’s own drift, which IS motion, still stops (the control)', () => {
    expect(stopsMotion(ALL_CSS, "[data-motion='reduce']", '.void-texture')).toBe(true);
    expect(stopsMotion(reducedMotionBlock(ALL_CSS), "data-motion='full'", '.void-texture')).toBe(true);
  });

  it('the detector catches the root in every spelling the reduced-motion rules could take', () => {
    const REDUCE_LIST =
      "[data-motion='reduce'] .void-texture,\n[data-motion='reduce'] .void-button";
    for (const [css, why] of [
      ["[data-motion='reduce'] { transition: none; }", 'the bare hook — it lives on <html>'],
      [":root[data-motion='reduce'] { transition: none; }", ':root with the hook'],
      ["html[data-motion='reduce'] { transition-duration: 0s; }", 'html, and a longhand'],
      [`${REDUCE_LIST},\n[data-motion='reduce'] {\n  animation: none;\n  transition: none;\n}`, 'appended to the existing list'],
      ["@media (prefers-reduced-motion: reduce) {\n  :root:not([data-motion='full']) { transition: none; }\n}", 'the OS block'],
      ["[data-motion='reduce'] { transition: opacity 90ms; }", 'a transition that replaces the list'],
    ] as const) {
      expect(reducedMotionRootTransitions(css), why).not.toEqual([]);
    }
    for (const [css, why] of [
      [`${REDUCE_LIST} {\n  animation: none;\n  transition: none;\n}`, 'the real element rules'],
      ["@media (prefers-reduced-motion: reduce) {\n  :root:not([data-motion='full']) .void-texture { transition: none; }\n}", 'an element in the OS block'],
      ["[data-motion='reduce'] { color: red; }", 'the root, but no transition'],
      [":root { transition: none; }", 'not a reduced-motion rule at all'],
    ] as const) {
      expect(reducedMotionRootTransitions(css), why).toEqual([]);
    }
  });
});

describe('the strike flash inverts on the light ground (AC-14)', () => {
  const LIGHT = "[data-ground='light'] .arena-figure.is-struck";
  /** The `brightness()` a flash's keyframes open on, or null. */
  const openingBrightness = (selector: string): number | null => {
    const rule = rulesFor(ALL_CSS, selector).find((r) =>
      declarations(r.body).some((d) => d.prop === 'animation' || d.prop === 'animation-name'),
    );
    const decl = rule && declarations(rule.body).find((d) => d.prop === 'animation' || d.prop === 'animation-name');
    const frames = keyframes(ALL_CSS);
    const name = decl?.value.split(/[\s,]+/).find((t) => frames.has(t));
    const from = name ? /(?:^|\})\s*(?:from|0%)\s*\{([^}]*)\}/.exec(frames.get(name) as string)?.[1] : undefined;
    const m = from ? /brightness\(\s*([\d.]+)\s*\)/.exec(from) : null;
    return m ? Number(m[1]) : null;
  };

  it('on a light ground a struck enemy DARKENS — brightening a white frame shows nothing', () => {
    expect(animatesWith(ALL_CSS, LIGHT, 'filter'), 'the light-ground flash does not move').toBe(true);
    const opening = openingBrightness(LIGHT);
    expect(opening, 'the light-ground flash names no brightness').not.toBeNull();
    expect(opening!, 'the light-ground flash brightens a white frame').toBeLessThan(1);
  });

  it('and the dark-ground flash is unchanged: it still BRIGHTENS', () => {
    const opening = openingBrightness('.arena-figure.is-struck');
    expect(opening).toBe(2.2);
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
