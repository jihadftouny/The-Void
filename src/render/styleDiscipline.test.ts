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
  // `signal-tear` (2026-09-20): floor 2's kind is `tear`, not `flecks`. What this block asks of
  // it is unchanged and is about the ALPHA, not the shape — every stop flat ink or transparent,
  // the layer really moving, and one entry per layer in every per-layer list — so it holds
  // word for word over a rule that paints bands instead of dots.
  const TEAR = "[data-texture='tear'] .void-texture";
  const ASH = "[data-texture='ash'] .void-texture";

  it('the stop detector fires on a foreign colour in any position, and passes the house shapes', () => {
    // Clean — the shapes these two rules and the three untouched ones really write.
    for (const args of [
      'circle, var(--void-texture-ink) 0 1px, transparent 2px',
      '110% 80% at 26% 18%, var(--void-texture-ink), transparent 64%',
      '118% 104% at 50% 46%, transparent 34%, var(--void-texture-ink)',
      '24deg, var(--void-texture-ink) 0 1px, transparent 1px 7px',
      'to right, transparent 0px 43px, var(--void-texture-ink) 43px 190px, transparent 190px',
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

  // `speck-scatter` (2026-09-14): 3 -> 12 and 4 -> 14. Each speck tile carries four (floor 2 as
  // it then was) or six (ash) dots, and a dot is one gradient layer; the ash's two haze layers
  // are unchanged. `signal-tear` (2026-09-20): floor 2's 12 dots became 9 ROWS — six slices, three
  // of which show both of their torn edges.
  for (const [floor, selector, layers] of [
    ['floor 2, the tear', TEAR, 9],
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

  // DELETED 2026-09-20 (`signal-tear`): "the flecks drift whole tiles per cycle (no seam), and
  // not all in one direction". Whole-tile drift is the CONCEPT this unit removed — floor 2 does
  // not drift at all now, it holds and snaps, and a horizontal snap of a `repeat-x` row has no
  // seam at any distance. What replaces it is `tearFaults`'s `seam` clause, which asks the
  // stronger question: that the loop comes round on the frame the rule itself rests on.
  // `directionSpread` keeps its self-test below, on its own inline fixtures.

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
  // ⚠ `[data-texture='flecks']` NO LONGER EXISTS IN THE SHIPPED CSS (`signal-tear`, 2026-09-20).
  // It survives here only as the selector the three historical FIXTURES below were written
  // against — the grid the author saw, and floor 2 as this pipeline first scattered it. Every
  // assertion about a SHIPPED rule in this block is now about the ash, which is the only speck
  // field left; floor 2 answers to `tearFaults` instead.
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

  it('the shipped ash is not a lattice', () => {
    expect(latticeFaults(ALL_CSS, ASH)).toEqual([]);
    // ...and floor 2 is gone from this guard because it is gone from this LANGUAGE, not because
    // it was excused: nothing in the shipped CSS carries the selector these fixtures use.
    expect(ALL_CSS, 'a speck field is still selected as `flecks`').not.toContain("[data-texture='flecks']");
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

  it('at rest, a 6-px band CAN gather rows from three tiles — and this is what that looks like', () => {
    // The first build started all three tiles at 0 0. Its rows met at 119.29px — B's 79% of 151 —
    // with C's 63% of 197 (124.11) and A's 14% of 109 one tile down (124.26): 4.97px, one band.
    const first = restingBands(FIRST_BUILD_FLECKS, FLECKS, 1920, 1080);
    expect(first.rows, 'rows').toBe(3);
    expect(first.rowAt).toBeCloseTo(119.29, 2);
    // ...and its columns, at 75.98 + 3x131, 124.56 + 2x173 and 18.16 + 2x227: 468.98 to 472.16.
    expect(first.columns, 'columns').toBe(3);
    // ⚠ 2026-09-20 (`signal-tear`): the half of this that asked the SHIPPED floor 2 the same
    // question is gone with the flecks. It cannot be asked of the tear, and does not need to
    // be: the defect was several tiles' rows falling into one band, and a tear has no tiles
    // repeating down the screen at all — every row is `repeat-x`, drawn exactly once at its own
    // height. `tearFaults`'s `repeat` clause is what holds that, and its `even-y` clause is what
    // asks the same underlying question of the tear: that the rows are not evenly spaced.
  });

  it('every loop begins on the still frame, so the moment it comes round is the picture above', () => {
    for (const selector of ["[data-texture='tear'] .void-texture", ASH]) {
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
    // 2026-09-20 (`signal-tear`): floor 2 has left this measure — `inkCoverage` sums discs, and
    // the tear paints no discs. Its ink is held to 0.3–1.2% of a 1920x1080 screen by
    // `tearFaults`'s `ink` clause instead, and it lands at 0.69% against the flecks' 0.66%.
    for (const [selector, old] of [[ASH, OLD_ASH]] as const) {
      const ratio = inkCoverage(ALL_CSS, selector) / inkCoverage(old, selector);
      expect(Math.abs(ratio - 1), `${selector} carries ${ratio} of the ink it had`).toBeLessThanOrEqual(0.1);
    }
    // The first scatter ran light: its dots' soft edges were thinner than the old ones.
    expect(inkCoverage(FIRST_BUILD_FLECKS, FLECKS) / inkCoverage(OLD_FLECKS, FLECKS), 'the first build').toBeLessThan(0.9);
  });

  it('...and that silence is not blindness: un-placing one shipped dot is reported', () => {
    for (const selector of [ASH]) {
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
// `signal-tear` (2026-09-20) — FLOOR 2 TEARS. IT DOES NOT FALL, AND IT NEVER FLASHES.
//
// The author, having played floor 2 after `speck-scatter`: it "should read more as glitches
// than similar to ash". They are right, and it is this pipeline's own regression. Floor 2 was
// a SCANLINE GRID — which is a glitch; the author called that grid "too grid like", and
// `speck-scatter` answered by scattering DOTS, which is floor 3's language, so both floors
// ended up speaking as particles. Floor 2's register is FRACTURE (`WORLD.md` §6,
// `ART-BIBLE.md` §4: mirrors, doubles, static, signal), so it is now a SIGNAL TEAR: irregular
// horizontal slices of the white that have slipped sideways, each showing its torn edges as a
// thin broken row of red — and now and then one of them snaps to a new offset and holds there.
//
// ⚠ THE SAFETY LINE, AND WHY IT IS ARITHMETIC RATHER THAN CARE. Floor 2 is a full WHITE
// SCREEN. Flicker on it is not a taste question; it is the one thing in this game that could
// actually harm somebody. WCAG 2.3.1 allows no more than THREE flashes in any one second,
// where a flash is a PAIR of opposing changes in relative luminance, and it exempts anything
// smaller than the "small safe area" — 25% of a 10-degree field, about 21,824px², which on the
// 1024x768 that figure is quoted against is 2.78% of the screen. Every limit below is derived
// from those two numbers, with margin, and every one of them is a limit on POSITION:
//
//   * MIN_STOP_GAP_S 1.0     — nothing anywhere on the screen changes oftener than once a
//                              second, so the screen itself cannot reach one flash a second
//   * MIN_SLICE_HOLD_S 2.0   — one slice cannot snap and snap back inside 2s, so a pixel goes
//                              white→red→white at most every 4s: 0.25 flashes a second, twelve
//                              times under the WCAG limit
//   * MAX_MOVED_SHARE 0.01   — the area that changes at any one stop, counting a row's old
//                              position AND its new one, stays under 1% of a 1920x1080 screen
//                              (20,736px²) — under the small safe area in absolute px² as well
//                              as in share, so the flash thresholds do not even apply
//   * `only`                 — a keyframe block may declare `background-position` and NOTHING
//                              else, so opacity, colour, brightness and filter cannot be
//                              animated here at all. That clause is what makes the others
//                              sufficient: position is the only thing that ever changes.
//
// The detector is proven red on the ORIGINAL SCANLINE GRID — recovered verbatim from the
// commit before it was replaced — before its silence on the new rule means anything. That grid
// is precisely what the author rejected; a guard that passed it would be worthless.
//
// AND IT IS DISPATCHED BY WHAT A RULE PAINTS, NOT BY WHICH FLOOR IT IS. A rule with `circle`
// layers is judged as dots by `latticeFaults`; a rule with `to right` layers is judged as bands
// by `tearFaults`; a haze on % tiles is neither. So floor 3's ash keeps the guard it already
// had, floor 2 is not merely EXEMPTED from that guard, and the next re-texture of any floor is
// judged for what it draws without either guard being rewritten.
// =========================================================================================

/** The screen the safety limits are derived against, and the ink budget is measured on. */
const TEAR_SCREEN = { w: 1920, h: 1080 } as const;

/** No two stops of the loop nearer than this, in seconds. See the block above. */
const MIN_STOP_GAP_S = 1;
/** No ONE slice snapping twice inside this, in seconds. See the block above. */
const MIN_SLICE_HOLD_S = 2;
/** The most of the screen that may change at any one stop. WCAG's small safe area is 2.78%. */
const MAX_MOVED_SHARE = 0.01;
/** Intervals (between stops, or between one slice's own snaps) this alike are a metronome. */
const MIN_INTERVAL_SPREAD_S = 1.5;
/** The least a dash pattern may repeat in: under this the repeat reads as a pattern, not a tear. */
const MIN_TILE_PX = 600;
/** A fringe is a hairline. Thicker than this is a band of colour, not a torn edge. */
const MAX_ROW_PX = 3;
/** One slice's rows, added up: two edges of a slipped band, never a slab. */
const MAX_SLICE_PX = 5;
/** A break the eye reads as a break rather than as an artefact of the rendering. */
const MIN_GAP_PX = 24;
/** Dashes (or gaps) all within this of each other are a Morse rhythm. */
const EVEN_RUN_PX = 8;
/** Two slices nearer than this in y are one slice torn in half; a slice's rows must be inside it. */
const SLICE_GAP_PP = 3;
/** Fewer slices than this is a couple of rules on a page, not a picture losing sync. */
const MIN_SLICES = 5;
/** A snap shorter than this is a shimmer, not a tear. */
const MIN_SNAP_PX = 6;
/** The share of a 1920x1080 screen the red may cover. The flecks it replaces laid 0.66%. */
const INK_SHARE = { least: 0.003, most: 0.012 } as const;
/** The share of one row's period its dashes may cover: over, it is a line; under, it is nothing. */
const COVERAGE = { least: 0.3, most: 0.75 } as const;

/** Largest minus smallest — how unalike a set of lengths, gaps or intervals is. */
function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/** A duration token (`53s`, `800ms`) in seconds, or null for anything else. */
function secondsOf(token: string): number | null {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(token);
  return m ? Number(m[1]) * (m[2] === 'ms' ? 0.001 : 1) : null;
}

/**
 * Every `name(args)` gradient in a value, in order, with its FUNCTION NAME as well as its
 * arguments — which `gradientCalls` drops, and which matters here: the original floor-2 grid was
 * `repeating-linear-gradient`, and a repeating gradient tiles INSIDE its own layer, so reading
 * only the arguments would let `repeating-linear-gradient(to right, ink 0 1px, transparent 1px
 * 9px)` — a picket fence of vertical bars — pass as a row of dashes.
 */
function gradientLayers(value: string): { fn: string; args: string }[] {
  const out: { fn: string; args: string }[] = [];
  for (const m of value.matchAll(/([a-z-]*gradient)\(/g)) {
    const open = (m.index as number) + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1;
      else if (value[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          out.push({ fn: m[1] as string, args: value.slice(open + 1, i) });
          break;
        }
      }
    }
  }
  return out;
}

/** One keyframe block of a stepped loop: where it sits in the cycle, and what it declares. */
interface TearStop {
  at: number;
  decls: { prop: string; value: string }[];
}

/** Every `N% { … }` block of a `@keyframes` body, in cycle order; `from` / `to` count as 0 / 100. */
function keyframeStops(body: string): TearStop[] {
  const out: TearStop[] = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = declarations(m[2] as string);
    for (const part of (m[1] as string).split(',')) {
      const text = part.trim();
      const at = text === 'from' ? 0 : text === 'to' ? 100 : Number(/^(-?[\d.]+)%$/.exec(text)?.[1] ?? Number.NaN);
      if (Number.isFinite(at)) out.push({ at, decls });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A `background-position` entry as `Xpx Y%` — the only shape a slice's position may take. */
function slipPosition(text: string): { x: number | null; y: number | null } {
  const m = /^(-?[\d.]+)px\s+(-?[\d.]+)%$/.exec(text);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: null, y: null };
}

/** One torn edge: the row of dashes that draws it, and where it sits at rest and at every stop. */
interface TearRow {
  layer: number;
  w: number;
  t: number;
  y: number;
  coverage: number;
  /** x at rest, then x at each keyframe stop in cycle order. */
  x: number[];
}

/** Rows that share one x-timeline are one SLICE: they are the two edges of one slipped band. */
interface TearSlice {
  rows: TearRow[];
  /** The slice's height down the screen, in %: its topmost row. */
  y: number;
}

/**
 * Every way the rule styling `selector` ITSELF still reads as something other than a signal
 * tearing, or `[]`. Each fault opens with a one-word code, then says what a player would see.
 *
 * A layer is a ROW: `linear-gradient(to right, …)` on a `Wpx tpx` tile that repeats across the
 * screen only, its ink broken into uneven dashes with uneven gaps, placed at `Xpx Y%`. Rows
 * whose x-timeline — rest plus every keyframe stop — is identical are one SLICE, because that is
 * what makes them the two edges of one band rather than two unrelated rules; a slice's rows must
 * sit within 3pp of each other, and no two slices may.
 *
 * The motion is judged as a SCHEDULE: `step-end`, so a position holds and then jumps with no
 * interpolation ever; stops far enough apart, and each slice's own snaps far enough apart, that
 * nothing approaches a flash; no stop moving more than a third of the slices or more than 1% of
 * the screen; intervals uneven enough not to tick; and `0%`, the last stop before `100%` and
 * `100%` all equal to the rule's own `background-position`, so the loop comes round on the frame
 * it rests on and reduced motion shows that same still picture.
 *
 * Short per-layer lists are read the way CSS reads them — repeated from the top — and reported,
 * because a dropped entry silently pairs one row with another row's tile or another slice's move.
 */
function tearFaults(css: string, selector: string): string[] {
  const found = rulesFor(css, selector);
  if (found.length !== 1) return [`rules — ${selector} is styled by ${found.length} rules, not one`];
  const decls = declarations(found[0]!.body);
  const last = (prop: string): string => decls.filter((d) => d.prop === prop).at(-1)?.value ?? '';
  const layers = gradientLayers(last('background'));
  if (layers.length === 0) return [`no-gradient — ${selector} paints no gradient at all`];

  const faults: string[] = [];
  const fixed = (v: number): number => Number(v.toFixed(2));
  const sizes = splitTop(last('background-size'));
  const repeats = splitTop(last('background-repeat'));
  const rest = splitTop(last('background-position'));
  const nth = (list: readonly string[], i: number): string =>
    list.length === 0 ? '' : (list[i % list.length] as string).replace(/\s+/g, ' ').trim();

  // --- the animation, and the stops of its loop ---------------------------------------------
  const animation = decls.filter((d) => d.prop === 'animation' || d.prop === 'animation-name').at(-1)?.value ?? '';
  const words = animation.split(/[\s,]+/).filter(Boolean);
  const frames = keyframes(css);
  const name = words.find((w) => frames.has(w));
  const duration = words.map(secondsOf).find((s): s is number => s !== null && s > 0) ?? null;
  const stops = name === undefined ? [] : keyframeStops(frames.get(name) as string);
  if (!words.includes('step-end')) {
    faults.push(
      `smooth — the animation is timed "${animation || 'not at all'}" and not step-end: the slices would SLIDE ` +
        'between positions, which is the drift this replaced',
    );
  }
  const positionsAt = (stop: TearStop): string[] =>
    splitTop(stop.decls.filter((d) => d.prop === 'background-position').at(-1)?.value ?? '');

  // A keyframe may move POSITION and nothing else — the clause the whole safety case rests on.
  for (const stop of stops) {
    for (const d of stop.decls) {
      if (d.prop === 'background-position') continue;
      faults.push(
        `only — the ${stop.at}% keyframe declares ${d.prop}, and a tear may animate background-position and NOTHING ` +
          'else: on a full white screen an animated opacity, colour or filter is a flash',
      );
    }
  }

  // A short per-layer list is valid CSS, and silently repeated from the top.
  const lists: { what: string; list: string[]; short: boolean }[] = [
    { what: 'background-size', list: sizes, short: false },
    { what: 'background-repeat', list: repeats, short: true },
    { what: "the rule's own background-position", list: rest, short: true },
    ...stops.map((s) => ({ what: `the ${s.at}% stop`, list: positionsAt(s), short: false })),
  ];
  for (const { what, list, short } of lists) {
    if (list.length === 0 || list.length === layers.length || (short && list.length === 1)) continue;
    faults.push(
      `list — ${what} has ${list.length} entries for ${layers.length} layers: CSS repeats the list from the top, ` +
        "pairing a row with another row's tile or another slice's move",
    );
  }

  // `background-repeat` is read once, for the whole rule: a row that repeats DOWN the screen is
  // the scanline grid coming back, whatever else is right about it.
  if (repeats.length === 0) {
    faults.push(
      `repeat — ${selector} declares no background-repeat, so every row tiles DOWN the screen as well as across: ` +
        'that is the scanline grid this replaced',
    );
  }
  for (const [i, r] of repeats.entries()) {
    if (r.replace(/\s+/g, ' ').trim() === 'repeat-x') continue;
    faults.push(
      `repeat — background-repeat entry ${i + 1} is "${r.trim()}", not repeat-x: a row that repeats in y is a grid ` +
        'of rules down the page',
    );
  }

  // --- the rows ------------------------------------------------------------------------------
  const rows: TearRow[] = [];
  for (const [i, layer] of layers.entries()) {
    const n = i + 1;
    const parts = splitTop(layer.args);
    const preamble =
      parts.length > 0 && GRADIENT_PREAMBLE.test(parts[0] as string) ? (parts[0] as string).replace(/\s+/g, ' ').trim() : '';
    if (layer.fn !== 'linear-gradient' || !/^to right$/.test(preamble)) {
      faults.push(
        `shape — layer ${n} is "${layer.fn}(${preamble || 'no direction'}, …)" and not "linear-gradient(to right, …)": ` +
          "floor 2 carries no dots and no vertical rules — dots are floor 3's language, rules are the old grid's",
      );
      continue;
    }
    const size = nth(sizes, i);
    const [w, t] = size.split(' ').map(pxOf);
    if (w == null || t == null || !Number.isInteger(w) || !Number.isInteger(t) || w <= 0 || t <= 0) {
      faults.push(`tile — layer ${n}'s tile is "${size || 'not declared'}", not a whole number of px across and down`);
      continue;
    }
    if (w < MIN_TILE_PX) {
      faults.push(
        `tile — layer ${n}'s dash pattern repeats every ${w}px, ${fixed(TEAR_SCREEN.w / w)} times across a ` +
          `${TEAR_SCREEN.w}px screen (the least period is ${MIN_TILE_PX}px): the eye reads the repeat as a pattern`,
      );
    }
    if (t > MAX_ROW_PX) {
      faults.push(
        `tile — layer ${n} is ${t}px thick (the most is ${MAX_ROW_PX}px): a torn edge is a hairline, not a band of colour`,
      );
    }
    const restPos = slipPosition(nth(rest, i));
    if (restPos.x === null || restPos.y === null) {
      faults.push(
        `seam — layer ${n} rests at "${nth(rest, i) || 'nothing'}", not "Xpx Y%": the rule's own position is the frame ` +
          'reduced motion shows, and it cannot be compared with the loop unless it is written that way',
      );
      continue;
    }
    // Where its ink is. A dash is `ink Apx Bpx`; everything else must be a transparent stop.
    const dashes: [number, number][] = [];
    let unreadable = '';
    for (const stop of parts.slice(1)) {
      const dash = /^var\(\s*--void-texture-ink\s*\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px$/.exec(stop);
      if (dash) dashes.push([Number(dash[1]), Number(dash[2])]);
      else if (!/^transparent(?:\s+-?[\d.]+px){0,2}$/.test(stop)) unreadable = unreadable || stop;
    }
    const lengths = dashes.map(([a, b]) => b - a);
    const coverage = lengths.reduce((a, b) => a + b, 0) / w;
    const gaps = dashes.slice(1).map(([a], k) => a - (dashes[k] as [number, number])[1]);
    if (dashes.length > 0) gaps.push(w - (dashes.at(-1) as [number, number])[1] + (dashes[0] as [number, number])[0]);
    const why: string[] = [];
    if (unreadable !== '') why.push(`the stop "${unreadable}" is not a dash between two px marks`);
    if (dashes.length < 2) why.push(`${dashes.length} dash(es), where a row needs at least 2`);
    if (dashes.length > 0 && (dashes[0]![0] <= 0 || (dashes.at(-1) as [number, number])[1] >= w)) {
      why.push('a dash runs to the end of the period, where it joins its own copy next door into one unbroken line');
    }
    if (coverage > COVERAGE.most) why.push(`${fixed(coverage * 100)}% of the period is ink (the most is ${COVERAGE.most * 100}%)`);
    if (coverage < COVERAGE.least) why.push(`only ${fixed(coverage * 100)}% of the period is ink (the least is ${COVERAGE.least * 100}%)`);
    if (gaps.filter((g) => g >= MIN_GAP_PX).length < 2) why.push(`fewer than two gaps of ${MIN_GAP_PX}px`);
    if (why.length > 0) faults.push(`unbroken — layer ${n} is not a broken row: ${why.join('; ')}. An unbroken row is a scanline`);
    if (lengths.length >= 2 && spread(lengths) <= EVEN_RUN_PX) {
      faults.push(
        `even-dash — layer ${n}'s dashes are all within ${EVEN_RUN_PX}px of each other (${lengths.join(', ')}): a Morse ` +
          'rhythm, not a tear',
      );
    }
    if (gaps.length >= 2 && spread(gaps) <= EVEN_RUN_PX) {
      faults.push(
        `even-gap — layer ${n}'s gaps are all within ${EVEN_RUN_PX}px of each other (${gaps.join(', ')}): a Morse ` +
          'rhythm, not a tear',
      );
    }
    // Its x through the cycle — and its y, which must never change: a tear slips SIDEWAYS.
    const x = [restPos.x];
    for (const stop of stops) {
      const here = slipPosition(nth(positionsAt(stop), i));
      if (here.y !== null && here.y !== restPos.y) {
        faults.push(
          `only — the ${stop.at}% stop moves layer ${n} from ${restPos.y}% to ${here.y}% DOWN the screen: a tear slips ` +
            'sideways; a row that rolls is a different effect, and one that chases the eye',
        );
      }
      x.push(here.x ?? restPos.x);
    }
    rows.push({ layer: n, w, t, y: restPos.y, coverage, x });
  }

  // --- the slices -----------------------------------------------------------------------------
  const grouped = new Map<string, TearRow[]>();
  for (const row of rows) grouped.set(row.x.join('|'), [...(grouped.get(row.x.join('|')) ?? []), row]);
  const slices: TearSlice[] = [...grouped.values()]
    .map((rs) => ({ rows: rs, y: Math.min(...rs.map((r) => r.y)) }))
    .sort((a, b) => a.y - b.y);
  if (slices.length < MIN_SLICES) {
    faults.push(
      `sparse — the rule draws ${slices.length} slice(s); under ${MIN_SLICES} reads as a couple of rules on a page, ` +
        'not as a picture coming apart',
    );
  }
  for (const slice of slices) {
    const ys = slice.rows.map((r) => r.y);
    if (spread(ys) > SLICE_GAP_PP) {
      faults.push(
        `crowd — the rows at ${ys.join('%, ')}% move as one slice but stand ${fixed(spread(ys))}pp apart (the most is ` +
          `${SLICE_GAP_PP}pp): a slice that deep is a slab, and its edges stop reading as one band`,
      );
    }
    const deep = slice.rows.reduce((a, r) => a + r.t, 0);
    if (deep > MAX_SLICE_PX) {
      faults.push(
        `tile — the slice at ${slice.y}% is ${deep}px of ink deep (the most is ${MAX_SLICE_PX}px): a slab, not two torn edges`,
      );
    }
  }
  for (const [i, a] of slices.entries()) {
    for (const b of slices.slice(i + 1)) {
      let nearest = Infinity;
      for (const ra of a.rows) for (const rb of b.rows) nearest = Math.min(nearest, Math.abs(ra.y - rb.y));
      if (nearest <= SLICE_GAP_PP) {
        faults.push(
          `crowd — the slices at ${a.y}% and ${b.y}% come within ${fixed(nearest)}pp of each other (the least is over ` +
            `${SLICE_GAP_PP}pp): two slices that near read as one slice torn in half`,
        );
      }
    }
  }
  const heights = slices.map((s) => s.y);
  const heightGaps = heights.slice(1).map((v, k) => v - (heights[k] as number));
  if (heightGaps.length >= 2 && spread(heightGaps) < SLICE_GAP_PP) {
    faults.push(
      `even-y — the slices are evenly spaced down the screen (at ${heights.join('%, ')}%, gaps ${heightGaps.join(', ')}): ` +
        'venetian blinds or ruled paper, which is the grid the author rejected, in band form',
    );
  }

  // Nothing here is a row, so there is no picture to judge the schedule, the ink or the rest
  // frame of — the faults above have already said what it is instead.
  if (rows.length === 0) return faults;

  // --- the ink budget --------------------------------------------------------------------------
  const inkShare = rows.reduce((a, r) => a + r.coverage * r.t, 0) / TEAR_SCREEN.h;
  if (inkShare < INK_SHARE.least || inkShare > INK_SHARE.most) {
    faults.push(
      `ink — the red covers ${fixed(inkShare * 100)}% of a ${TEAR_SCREEN.w}x${TEAR_SCREEN.h} screen, outside ` +
        `${INK_SHARE.least * 100}–${INK_SHARE.most * 100}%: too faint to see at all, or a red screen`,
    );
  }

  // --- the loop rests where the rule rests -------------------------------------------------------
  const lastBefore = [...stops].reverse().find((s) => s.at < 100);
  for (const { what, stop } of [
    { what: '0%', stop: stops.find((s) => s.at === 0) },
    { what: `the last stop before 100%${lastBefore ? ` (${lastBefore.at}%)` : ''}`, stop: lastBefore },
    { what: '100%', stop: stops.find((s) => s.at === 100) },
  ] as const) {
    if (stop === undefined) {
      faults.push(`seam — the loop has no ${what}, so it cannot be shown to come round on the frame the rule rests on`);
      continue;
    }
    const list = positionsAt(stop);
    const off = rows.find((r) => {
      const here = slipPosition(nth(list, r.layer - 1));
      return here.x !== r.x[0] || here.y !== r.y;
    });
    if (off !== undefined) {
      const here = slipPosition(nth(list, off.layer - 1));
      faults.push(
        `seam — at ${what} layer ${off.layer} sits at "${here.x}px ${here.y}%" while the rule rests it at ` +
          `"${off.x[0]}px ${off.y}%": the loop visibly jumps where it comes round, and reduced motion shows a frame ` +
          'the loop never rests on',
      );
    }
  }

  // --- the schedule -------------------------------------------------------------------------------
  if (duration === null) {
    faults.push('flicker — the animation declares no duration, so how often the slices snap cannot be judged at all');
    return faults;
  }
  const seconds = (percent: number): number => (percent * duration) / 100;
  const snapsOf = (slice: TearSlice): { at: number; by: number }[] => {
    const row = slice.rows[0] as TearRow;
    const out: { at: number; by: number }[] = [];
    for (const [k, stop] of stops.entries()) {
      const before = row.x[k] as number;
      const now = row.x[k + 1] as number;
      if (now !== before) out.push({ at: stop.at, by: now - before });
    }
    return out;
  };
  const movedArea = (slice: TearSlice): number =>
    slice.rows.reduce((a, r) => a + 2 * r.coverage * TEAR_SCREEN.w * r.t, 0);

  const changeAts: number[] = [];
  for (const stop of stops) {
    const movers = slices.filter((s) => snapsOf(s).some((snap) => snap.at === stop.at));
    if (movers.length === 0) continue;
    changeAts.push(stop.at);
    if (movers.length > slices.length / 3) {
      faults.push(
        `jolt — ${movers.length} of the ${slices.length} slices move at ${stop.at}% (the most is a third): the whole ` +
          'screen jumping at once is not a signal tearing, it is a cut',
      );
    }
    const area = movers.reduce((a, s) => a + movedArea(s), 0);
    if (area > MAX_MOVED_SHARE * TEAR_SCREEN.w * TEAR_SCREEN.h) {
      faults.push(
        `area — the ${stop.at}% stop changes ${fixed(area)}px² of a ${TEAR_SCREEN.w}x${TEAR_SCREEN.h} screen, ` +
          `${fixed((area * 100) / (TEAR_SCREEN.w * TEAR_SCREEN.h))}% (the most is ${MAX_MOVED_SHARE * 100}%; WCAG's ` +
          'small safe area is 2.78%): a slab that big changing at once is a flash',
      );
    }
  }
  if (changeAts.length >= 2) {
    const intervals = changeAts.slice(1).map((v, k) => v - (changeAts[k] as number));
    intervals.push(100 - (changeAts.at(-1) as number) + (changeAts[0] as number));
    const closest = seconds(Math.min(...intervals));
    if (closest < MIN_STOP_GAP_S) {
      faults.push(
        `flicker — two stops are ${fixed(closest)}s apart (the least is ${MIN_STOP_GAP_S}s): on a full white screen ` +
          'that is how a tear becomes a flicker',
      );
    }
    if (seconds(spread(intervals)) < MIN_INTERVAL_SPREAD_S) {
      faults.push(
        `metronome — the stops are within ${fixed(seconds(spread(intervals)))}s of one interval (the least spread is ` +
          `${MIN_INTERVAL_SPREAD_S}s): a glitch is irregular; an even beat is a nagging tick`,
      );
    }
  }
  for (const slice of slices) {
    const snaps = snapsOf(slice);
    if (snaps.length < 2) {
      faults.push(`still — the slice at ${slice.y}% snaps ${snaps.length} time(s) a cycle: a fixed red rule across the page`);
      continue;
    }
    for (const snap of snaps) {
      if (Math.abs(snap.by) < MIN_SNAP_PX) {
        faults.push(
          `small — the slice at ${slice.y}% moves ${snap.by}px at ${snap.at}% (the least is ${MIN_SNAP_PX}px): a shimmer, not a tear`,
        );
      }
    }
    const ats = snaps.map((s) => s.at);
    const holds = ats.slice(1).map((v, k) => v - (ats[k] as number));
    holds.push(100 - (ats.at(-1) as number) + (ats[0] as number));
    const shortest = seconds(Math.min(...holds));
    if (shortest < MIN_SLICE_HOLD_S) {
      faults.push(
        `flicker — the slice at ${slice.y}% holds only ${fixed(shortest)}s between its own snaps (the least is ` +
          `${MIN_SLICE_HOLD_S}s): out and straight back is a flash of that band`,
      );
    }
    if (seconds(spread(holds)) < MIN_INTERVAL_SPREAD_S) {
      faults.push(
        `metronome — the slice at ${slice.y}% holds for ${holds.map((h) => fixed(seconds(h))).join('s, ')}s, all within ` +
          `${MIN_INTERVAL_SPREAD_S}s of each other: that slice ticks`,
      );
    }
  }
  return faults;
}

/**
 * What a tear really measures, so the safety margins in the tests below are MEASURED from the
 * CSS rather than asserted about it. Every number is the same arithmetic `tearFaults` judges on;
 * this returns it instead of comparing it, so a test can print the margin it has.
 */
function tearSafety(
  css: string,
  selector: string,
): {
  rows: number;
  slices: number;
  stops: number;
  closestStopsSeconds: number;
  shortestSliceHoldSeconds: number;
  worstMovedPx: number;
  worstMovedShare: number;
  inkShare: number;
} {
  const decls = declarations(rulesFor(css, selector)[0]?.body ?? '');
  const last = (prop: string): string => decls.filter((d) => d.prop === prop).at(-1)?.value ?? '';
  const layers = gradientLayers(last('background'));
  const sizes = splitTop(last('background-size'));
  const rest = splitTop(last('background-position'));
  const nth = (list: readonly string[], i: number): string =>
    list.length === 0 ? '' : (list[i % list.length] as string).replace(/\s+/g, ' ').trim();
  const words = last('animation').split(/[\s,]+/).filter(Boolean);
  const frames = keyframes(css);
  const name = words.find((w) => frames.has(w));
  const duration = words.map(secondsOf).find((s): s is number => s !== null && s > 0) ?? 0;
  const stops = name === undefined ? [] : keyframeStops(frames.get(name) as string);

  const rows: TearRow[] = [];
  for (const [i, layer] of layers.entries()) {
    const parts = splitTop(layer.args);
    const [w, t] = nth(sizes, i).split(' ').map(pxOf);
    const at = slipPosition(nth(rest, i));
    if (w == null || t == null || at.x === null || at.y === null) continue;
    const coverage =
      parts
        .slice(1)
        .map((s) => /^var\(\s*--void-texture-ink\s*\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px$/.exec(s))
        .filter((m): m is RegExpExecArray => m !== null)
        .reduce((a, m) => a + Number(m[2]) - Number(m[1]), 0) / w;
    const x = [
      at.x,
      ...stops.map((s) => {
        const list = splitTop(s.decls.filter((d) => d.prop === 'background-position').at(-1)?.value ?? '');
        return slipPosition(nth(list, i)).x ?? (at.x as number);
      }),
    ];
    rows.push({ layer: i + 1, w, t, y: at.y, coverage, x });
  }
  const grouped = new Map<string, TearRow[]>();
  for (const row of rows) grouped.set(row.x.join('|'), [...(grouped.get(row.x.join('|')) ?? []), row]);
  const slices = [...grouped.values()];
  const seconds = (percent: number): number => (percent * duration) / 100;

  const changeAts: number[] = [];
  let worstMovedPx = 0;
  for (const [k, stop] of stops.entries()) {
    const movers = slices.filter((rs) => (rs[0] as TearRow).x[k + 1] !== (rs[0] as TearRow).x[k]);
    if (movers.length === 0) continue;
    changeAts.push(stop.at);
    worstMovedPx = Math.max(
      worstMovedPx,
      movers.reduce((a, rs) => a + rs.reduce((b, r) => b + 2 * r.coverage * TEAR_SCREEN.w * r.t, 0), 0),
    );
  }
  const intervals = changeAts.slice(1).map((v, k) => v - (changeAts[k] as number));
  if (changeAts.length >= 2) intervals.push(100 - (changeAts.at(-1) as number) + (changeAts[0] as number));
  let shortestHold = Infinity;
  for (const rs of slices) {
    const row = rs[0] as TearRow;
    const ats = stops.filter((_, k) => row.x[k + 1] !== row.x[k]).map((s) => s.at);
    if (ats.length < 2) continue;
    const holds = ats.slice(1).map((v, k) => v - (ats[k] as number));
    holds.push(100 - (ats.at(-1) as number) + (ats[0] as number));
    shortestHold = Math.min(shortestHold, Math.min(...holds));
  }
  return {
    rows: rows.length,
    slices: slices.length,
    stops: changeAts.length,
    closestStopsSeconds: intervals.length > 0 ? seconds(Math.min(...intervals)) : Number.NaN,
    shortestSliceHoldSeconds: seconds(shortestHold),
    worstMovedPx,
    worstMovedShare: worstMovedPx / (TEAR_SCREEN.w * TEAR_SCREEN.h),
    inkShare: rows.reduce((a, r) => a + r.coverage * r.t, 0) / TEAR_SCREEN.h,
  };
}

/**
 * What a texture rule PAINTS, which is what decides who judges it — never which floor it is. A
 * `circle` layer is a dot and answers to `latticeFaults`; a `to right` layer is a band and
 * answers to `tearFaults`; a rule with neither is a haze on % tiles and is judged by neither. A
 * rule may be BOTH, and is then judged by both: that is how a dot smuggled onto floor 2, or a
 * band smuggled onto floor 3, meets the guard built for the thing it actually draws.
 */
function texturePaints(css: string, selector: string): { dots: boolean; bands: boolean } {
  const decls = declarations(rulesFor(css, selector)[0]?.body ?? '');
  const background = decls.filter((d) => d.prop === 'background').at(-1)?.value ?? '';
  const preambles = gradientLayers(background).map(({ args }) => (splitTop(args)[0] ?? '').replace(/\s+/g, ' ').trim());
  return { dots: preambles.some((p) => /^circle\b/.test(p)), bands: preambles.some((p) => /^to right\b/.test(p)) };
}

describe('the band guard turns away every lazy way to draw a torn signal (signal-tear)', () => {
  /** The faults' codes, sorted — what each case below is judged on. */
  const codes = (faults: readonly string[]): string[] => faults.map((f) => f.split(' ')[0] as string).sort();
  const judge = (css: string): string[] => codes(tearFaults(css, '.t'));

  // THE ORIGINAL FLOOR-2 SCANLINE GRID — TRANSCRIBED from `atmosphere.css` at 7b907c4^, the
  // commit before `floor-looks` replaced it, whitespace-normalised and never read back from the
  // file under test. This is exactly the picture the author rejected as "too grid like"; if the
  // guard passed it, the guard would be worth nothing.
  const ORIGINAL_STATIC =
    "[data-texture='static'] .void-texture { background: " +
    'repeating-linear-gradient(0deg, var(--void-texture-ink) 0 1px, transparent 1px 3px), ' +
    'repeating-linear-gradient(90deg, var(--void-texture-ink) 0 1px, transparent 1px 9px); ' +
    'animation: void-static-crawl 6s steps(3) infinite; }\n' +
    '@keyframes void-static-crawl { from { background-position: 0 0, 0 0; } to { background-position: 0 3px, 9px 0; } }';

  // --- a fixture builder, so each case below changes exactly ONE thing -------------------------
  interface FixtureRow {
    w: number;
    t: number;
    y: number;
    dashes: [number, number][];
  }
  interface FixtureSlice {
    rows: FixtureRow[];
    /** `[at%, the x it moves TO]`, in cycle order. */
    snaps: [number, number][];
  }
  const gradientOf = (r: FixtureRow): string => {
    const parts: string[] = [];
    let mark = 0;
    for (const [a, b] of r.dashes) {
      parts.push(`transparent ${mark}px ${a}px`, `var(--void-texture-ink) ${a}px ${b}px`);
      mark = b;
    }
    parts.push(`transparent ${mark}px`);
    return `linear-gradient(to right, ${parts.join(', ')})`;
  };
  const tearCss = (slices: readonly FixtureSlice[], timing = 'step-end'): string => {
    const rows = slices.flatMap((s) => s.rows.map((row) => ({ row, slice: s })));
    const xAt = (slice: FixtureSlice, when: number): number => {
      let x = 0;
      for (const [at, to] of slice.snaps) if (at <= when) x = to;
      return x;
    };
    const at = (when: number): string => rows.map(({ row, slice }) => `${xAt(slice, when)}px ${row.y}%`).join(', ');
    const blocks = [...new Set([0, ...slices.flatMap((s) => s.snaps.map(([a]) => a)), 100])].sort((a, b) => a - b);
    return (
      `.t { background: ${rows.map(({ row }) => gradientOf(row)).join(', ')};` +
      ` background-size: ${rows.map(({ row }) => `${row.w}px ${row.t}px`).join(', ')};` +
      ' background-repeat: repeat-x;' +
      ` background-position: ${at(0)};` +
      ` animation: tear 53s ${timing} infinite; }\n` +
      `@keyframes tear {\n${blocks.map((b) => `  ${b}% { background-position: ${at(b)}; }`).join('\n')}\n}`
    );
  };

  // THE COMPLIANT FIXTURE, placed by hand and checked by arithmetic before it was written down.
  // Six slices, seven rows — the first slice shows BOTH of its torn edges, at 1px and 2px:
  //   slice  period  t    ink of it  dashes            gaps (the last wraps round the period)
  //   0      613     1+2  46.33%     111, 28, 145      61, 79, 189
  //   1      727     2    48.69%     192, 36, 126      72, 125, 176
  //   2      839     1    46.13%     138, 29, 163, 57  87, 115, 83, 167
  //   3      953     3    44.60%     222, 39, 164      69, 118, 341
  //   4     1061     2    51.46%     246, 39, 195, 66  85, 119, 84, 227
  //   5     1229     1    44.91%     218, 38, 221, 75  88, 124, 94, 371
  // Red on screen: Σ(ink of it x thickness) / 1080 = 5.6413 / 1080 = 0.52%, inside 0.3–1.2%.
  // Heights 9, 24, 37, 51, 68, 88% — gaps 15, 13, 14, 17, 20, a spread of 7pp, so not blinds.
  // Stops 4, 11, 17, 26, 33, 39, 48, 57, 63, 74, 82, 91% of 53s: the closest two are 6% = 3.18s
  // apart (the least is 1.0s) and the intervals spread 7% = 3.71s (the least is 1.5s). One slice
  // moves at each; the worst stop changes 5,337px² = 0.26% of a 1920x1080 screen (the most is 1%,
  // and WCAG's small safe area is 2.78%). Every slice goes out and comes home, the last of them
  // at 91%, so the closing hold IS the rest frame and the loop point is invisible.
  const D0: [number, number][] = [[31, 142], [203, 231], [310, 455]];
  const D1: [number, number][] = [[47, 239], [311, 347], [472, 598]];
  const D2: [number, number][] = [[29, 167], [254, 283], [398, 561], [644, 701]];
  const D3: [number, number][] = [[61, 283], [352, 391], [509, 673]];
  const D4: [number, number][] = [[73, 319], [404, 443], [562, 757], [841, 907]];
  const D5: [number, number][] = [[53, 271], [359, 397], [521, 742], [836, 911]];
  const COMPLIANT_SLICES: FixtureSlice[] = [
    { rows: [{ w: 613, t: 1, y: 9, dashes: D0 }, { w: 613, t: 2, y: 10, dashes: D0 }], snaps: [[4, 37], [48, 0]] },
    { rows: [{ w: 727, t: 2, y: 24, dashes: D1 }], snaps: [[11, -58], [57, 0]] },
    { rows: [{ w: 839, t: 1, y: 37, dashes: D2 }], snaps: [[17, 91], [63, 0]] },
    { rows: [{ w: 953, t: 3, y: 51, dashes: D3 }], snaps: [[26, -24], [74, 0]] },
    { rows: [{ w: 1061, t: 2, y: 68, dashes: D4 }], snaps: [[33, 112], [91, 0]] },
    { rows: [{ w: 1229, t: 1, y: 88, dashes: D5 }], snaps: [[39, -45], [82, 0]] },
  ];
  const COMPLIANT = tearCss(COMPLIANT_SLICES);
  /** The compliant fixture with one thing changed — deep-copied, so no case leaks into another. */
  const vary = (change: (slices: FixtureSlice[]) => void): string => {
    const copy = COMPLIANT_SLICES.map((s) => ({
      rows: s.rows.map((r) => ({ ...r, dashes: r.dashes.map((d) => [...d] as [number, number]) })),
      snaps: s.snaps.map((p) => [...p] as [number, number]),
    }));
    change(copy);
    return tearCss(copy);
  };

  it('a compliant tear has no faults at all', () => {
    expect(tearFaults(COMPLIANT, '.t')).toEqual([]);
  });

  it('...and the margins it really has are the ones the arithmetic above claims', () => {
    // Without this the compliant fixture could be silently comfortable — passing every limit by
    // a mile, so that the cases below say nothing about where the lines actually fall.
    const safety = tearSafety(COMPLIANT, '.t');
    expect(safety).toMatchObject({ rows: 7, slices: 6, stops: 12 });
    expect(safety.closestStopsSeconds, '6% of 53s').toBeCloseTo(3.18, 2);
    expect(safety.shortestSliceHoldSeconds, "42% of 53s — slice 4's shorter hold").toBeCloseTo(22.26, 2);
    expect(safety.worstMovedPx, "slice 0's two edges, old place and new: 2 x (284/613) x 1920 x 3px")
      .toBeCloseTo((284 / 613) * 1920 * 6, 6);
    expect(safety.inkShare, '5.6413 / 1080').toBeCloseTo(0.0052234, 6);
  });

  it('reports the ORIGINAL scanline grid — the picture the author rejected', () => {
    // Two `repeating-linear-gradient`s, at 0deg and at 90deg: neither is a horizontal run of
    // dashes, so neither is a row (`shape` twice — and with no rows there are no slices at all,
    // `sparse`). The rule declares no `background-repeat`, so both tile DOWN the page as well as
    // across (`repeat`). And it is timed `steps(3)`, which interpolates in three jumps rather
    // than holding a position and jumping at the end of it (`smooth`).
    expect(codes(tearFaults(ORIGINAL_STATIC, "[data-texture='static'] .void-texture")))
      .toEqual(['repeat', 'shape', 'shape', 'smooth', 'sparse']);
  });

  it('...and BLINDS: six unbroken rows, evenly spaced down the page', () => {
    // The author's "too grid like" complaint in band form. Each row is one dash covering its
    // whole period — one dash where two are needed, running to both ends of the period (so it
    // joins its own copy next door into one line right across the screen), 100% ink where 75% is
    // the most, and leaving no gap at all: one `unbroken` fault each, six times. At 10, 25, 40,
    // 55, 70 and 85% the gaps are 15pp five times over, a spread of 0 — `even-y`.
    const blinds = vary((s) => {
      const ys = [10, 25, 40, 55, 70, 85];
      const thick = [1, 2, 1, 3, 2, 1];
      for (const [i, slice] of s.entries()) {
        const first = slice.rows[0] as FixtureRow;
        slice.rows = [{ w: first.w, t: thick[i] as number, y: ys[i] as number, dashes: [[0, first.w]] }];
      }
    });
    expect(judge(blinds)).toEqual(['even-y', 'unbroken', 'unbroken', 'unbroken', 'unbroken', 'unbroken', 'unbroken']);
  });

  it('...and rows spaced evenly down the page even when they ARE broken', () => {
    // `even-y` on its own, with nothing else touched: blinds drawn in dashes are still blinds.
    expect(judge(vary((s) => {
      const ys = [10, 25, 40, 55, 70, 85];
      for (const [i, slice] of s.entries()) for (const [k, row] of slice.rows.entries()) row.y = (ys[i] as number) + k;
    }))).toEqual(['even-y']);
  });

  it('a Morse rhythm: every dash 40px, every gap 40px, the wrap included', () => {
    // Eight 40px dashes from 20px, spaced 40px, the last ending at 620 of a 640px period — so the
    // wrap gap is (640 - 620) + 20 = 40 as well, and all eight dashes and all eight gaps are
    // equal. Coverage is 320/640 = 50%, inside the band, and both ends of the period are
    // transparent: every other rule about the row passes, and only its RHYTHM gives it away.
    expect(judge(vary((s) => {
      const row = (s[2] as FixtureSlice).rows[0] as FixtureRow;
      row.w = 640;
      row.dashes = [20, 100, 180, 260, 340, 420, 500, 580].map((a) => [a, a + 40] as [number, number]);
    }))).toEqual(['even-dash', 'even-gap']);
  });

  it('a row with its gaps filled in — one scanline among six good rows', () => {
    // Slice 2's four dashes become one run from 29 to 701 of its 839px period: 80.1% ink where
    // 75% is the most, one dash where two are needed, and one gap where two are needed.
    expect(judge(vary((s) => {
      ((s[2] as FixtureSlice).rows[0] as FixtureRow).dashes = [[29, 701]];
    }))).toEqual(['unbroken']);
  });

  it('three of the six slices moving at one stop', () => {
    // Slices 1 and 2 snap out at 4% with slice 0, instead of at 11% and 17%. Three of six is more
    // than a third. It is NOT also an `area` fault: the three together change 10,848px² = 0.52%.
    expect(judge(vary((s) => {
      (s[1] as FixtureSlice).snaps[0] = [4, -58];
      (s[2] as FixtureSlice).snaps[0] = [4, 91];
    }))).toEqual(['jolt']);
  });

  it('a stop that changes too much of the screen at once', () => {
    // Two slices is inside the third `jolt` allows, so this is the OTHER limit. Both are made 5px
    // deep (the most a slice may be) at ~74% ink (just inside the 75% most), and both snap at 4%:
    // 2 x 1920 x 5 x (0.7406 + 0.7400) = 28,428px², 1.37% of a 1920x1080 screen, over the 1%.
    expect(judge(vary((s) => {
      const cut: [number, [number, number][]][] = [
        [613, [[11, 261], [271, 312], [358, 521]]],
        [727, [[11, 307], [317, 365], [411, 605]]],
      ];
      for (const [i, slice] of s.slice(0, 2).entries()) {
        const [w, dashes] = cut[i] as [number, [number, number][]];
        const y = (slice.rows[0] as FixtureRow).y;
        slice.rows = [{ w, t: 2, y, dashes }, { w, t: 3, y: y + 1, dashes }];
      }
      (s[1] as FixtureSlice).snaps[0] = [4, -58];
    }))).toEqual(['area']);
  });

  it('an even beat: ten stops, every one the same distance from the last', () => {
    // 4, 14, 24 … 94% — nine intervals of 10% and a wrap of (100 - 94) + 4 = 10%, so the spread is
    // zero. Each slice's OWN holds are still 40/60% or 80/20%, well clear of the same limit, so
    // only the whole schedule's beat is reported.
    expect(judge(vary((s) => {
      const when: [number, number][][] = [
        [[4, 37], [44, 0]],
        [[14, -58], [54, 0]],
        [[24, 91], [64, 0]],
        [[34, -24], [74, 0]],
        [[4, 112], [84, 0]],
        [[14, -45], [94, 0]],
      ];
      for (const [i, slice] of s.entries()) slice.snaps = when[i] as [number, number][];
    }))).toEqual(['metronome']);
  });

  it('a tear that slides instead of snapping', () => {
    for (const timing of ['linear', 'ease-in-out', 'steps(4)']) {
      expect(judge(tearCss(COMPLIANT_SLICES, timing)), timing).toEqual(['smooth']);
    }
  });

  it('THE SAFETY LINE: two stops half a second apart', () => {
    // Slice 1 snaps out at 5% rather than 11% — one percent, 0.53s of 53s, after slice 0.
    expect(judge(vary((s) => { (s[1] as FixtureSlice).snaps[0] = [5, -58]; }))).toEqual(['flicker']);
  });

  it('THE SAFETY LINE: one slice out and back inside two seconds', () => {
    // Slice 0 snaps at 4% and again at 7%: 3% of 53s = 1.59s, over the 1.0s the WHOLE SCREEN is
    // held to and under the 2.0s ONE band is — because one band going out and coming back is the
    // white→red→white pair WCAG counts as a flash. Only the per-slice clause can see this one.
    expect(judge(vary((s) => { (s[0] as FixtureSlice).snaps = [[4, 37], [7, -20], [48, 0]]; }))).toEqual(['flicker']);
  });

  it('THE SAFETY LINE: a keyframe that animates anything but position', () => {
    // The three shapes this would really be written in. Every one of them is a flash on a floor
    // that is a white screen, and none of them is a position, so nothing else here would notice.
    for (const planted of ['opacity: 0.55;', 'filter: brightness(1.4);', 'background-color: var(--void-texture-ink);']) {
      const spoiled = COMPLIANT.replace('  33% { background-position:', `  33% { ${planted} background-position:`);
      expect(spoiled, 'the 33% stop was not found to plant a flash in').not.toBe(COMPLIANT);
      expect(judge(spoiled), planted).toEqual(['only']);
    }
  });

  it('a slice that ROLLS down the screen instead of slipping sideways', () => {
    // One stop moves layer 1 from its 9% to 12%; its x is untouched, so nothing else notices.
    const rolled = COMPLIANT.replace('  4% { background-position: 37px 9%,', '  4% { background-position: 37px 12%,');
    expect(rolled, 'the 4% stop was not found to plant a roll in').not.toBe(COMPLIANT);
    expect(judge(rolled)).toEqual(['only']);
  });

  it('a loop whose closing hold is not the frame the rule rests on', () => {
    // Slice 4 snaps at 91% to 64px rather than home, and only reaches 0 at 100% — so the last
    // thing a player sees before the loop comes round is a frame the still picture does not
    // match, and reduced motion shows a different picture from the one the loop settles on.
    expect(judge(vary((s) => { (s[4] as FixtureSlice).snaps = [[33, 112], [91, 64], [100, 0]]; }))).toEqual(['seam']);
  });

  it('a dot smuggled into the tear', () => {
    // A `radial-gradient` layer, given its own tile and position entries so that no list is short
    // and ONLY its shape is wrong. Dots are floor 3's language; floor 2 keeps none at all.
    const dotted = COMPLIANT.replace(
      'background: linear-gradient',
      'background: radial-gradient(circle at 20% 30%, var(--void-texture-ink) 0 1.4px, transparent 2.4px), linear-gradient',
    )
      .replace('background-size: ', 'background-size: 131px 109px, ')
      .replaceAll('background-position: ', 'background-position: 0px 0px, ');
    expect(judge(dotted)).toEqual(['shape']);
  });

  it('a vertical rule, a downward fill, and a repeating gradient that only LOOKS like dashes', () => {
    const swapFirstLayer = (layer: string): string =>
      COMPLIANT.replace(gradientOf((COMPLIANT_SLICES[0] as FixtureSlice).rows[0] as FixtureRow), layer);
    expect(swapFirstLayer('x'), 'the first layer was not found to swap').not.toBe(COMPLIANT);
    expect(judge(swapFirstLayer('linear-gradient(90deg, var(--void-texture-ink) 0 1px, transparent 1px 9px)')), '90deg')
      .toEqual(['shape']);
    expect(judge(swapFirstLayer('linear-gradient(to bottom, var(--void-texture-ink) 0 1px, transparent 1px 9px)')), 'to bottom')
      .toEqual(['shape']);
    // The trap the function NAME closes: `to right` and dashes, but a REPEATING gradient tiles
    // inside its own layer, so this paints a picket fence of bars right across the screen.
    expect(
      judge(swapFirstLayer('repeating-linear-gradient(to right, var(--void-texture-ink) 0 40px, transparent 40px 90px)')),
      'repeating',
    ).toEqual(['shape']);
  });

  it('a row that repeats DOWN the page — the scanline grid, in one declaration', () => {
    for (const [planted, why] of [
      ['background-repeat: repeat;', 'the CSS default'],
      ['background-repeat: repeat-y;', 'down only'],
      ['background-repeat: repeat-x, repeat-x, repeat-x, repeat-x, repeat-x, repeat-x, repeat;', 'one entry of a full list'],
    ] as const) {
      expect(judge(COMPLIANT.replace('background-repeat: repeat-x;', planted)), why).toEqual(['repeat']);
    }
    expect(judge(COMPLIANT.replace(' background-repeat: repeat-x;', '')), 'not declared at all').toEqual(['repeat']);
  });

  it('a fringe thicker than a hairline, a period too short to hide its repeat, and a slab', () => {
    expect(judge(vary((s) => { ((s[2] as FixtureSlice).rows[0] as FixtureRow).t = 4; })), '4px thick').toEqual(['tile']);
    // 577px repeats 3.33 times across a 1920px screen; its dashes still end at 455, so the row
    // itself is unchanged and only the period is at fault.
    expect(judge(vary((s) => { ((s[0] as FixtureSlice).rows[0] as FixtureRow).w = 577; })), 'a 577px period').toEqual(['tile']);
    // Three 2px edges within 3pp: every row is a legal hairline, and together they are 6px of
    // solid red where five is the most — a slab of colour, not the two edges of a slipped band.
    expect(judge(vary((s) => {
      const first = (s[0] as FixtureSlice).rows[0] as FixtureRow;
      (s[0] as FixtureSlice).rows = [
        { ...first, t: 2 },
        { ...first, t: 2, y: first.y + 1 },
        { ...first, t: 2, y: first.y + 2 },
      ];
    })), 'a 6px slice').toEqual(['tile']);
  });

  it('four slices instead of six', () => {
    // Slices 2 and 4 removed, which leaves heights 9, 24, 51, 88 — gaps 15, 27, 37, so this is
    // not also an `even-y`, and the schedule the remaining four keep still holds.
    expect(judge(tearCss(COMPLIANT_SLICES.filter((_, i) => i !== 2 && i !== 4)))).toEqual(['sparse']);
  });

  it('two slices crowded together, and one slice torn in half', () => {
    // Slice 1 moved to 11%, one point from slice 0's lower edge at 10%.
    expect(judge(vary((s) => { ((s[1] as FixtureSlice).rows[0] as FixtureRow).y = 11; })), 'two slices').toEqual(['crowd']);
    // Slice 0's two edges 11pp apart: they move as one band and have stopped looking like one.
    expect(judge(vary((s) => { ((s[0] as FixtureSlice).rows[1] as FixtureRow).y = 20; })), 'one slice').toEqual(['crowd']);
  });

  it('a slice that never moves', () => {
    expect(judge(vary((s) => { (s[5] as FixtureSlice).snaps = []; }))).toEqual(['still']);
  });

  it('a snap too small to read as a tear', () => {
    // Slice 3 goes out 40px, shuffles 5px, and comes home: only the 5px move is reported.
    expect(judge(vary((s) => { (s[3] as FixtureSlice).snaps = [[26, -40], [52, -45], [74, 0]]; }))).toEqual(['small']);
  });

  it('too little red on the screen, and too much', () => {
    // Every slice thinned to a single 1px hairline: the ink is (0.4633 + 0.4869 + 0.4613 +
    // 0.4460 + 0.5146 + 0.4491) / 1080 = 0.26%, under the 0.3% floor — a floor with an
    // atmosphere nobody can see. (Dropping ONE of slice 0's two edges is not enough: that still
    // leaves 4.7147 / 1080 = 0.44%, comfortably inside the band.)
    expect(judge(vary((s) => {
      for (const slice of s) slice.rows = [{ ...(slice.rows[0] as FixtureRow), t: 1 }];
    })), 'too faint').toEqual(['ink']);
    // Every slice given both edges at 2px and 3px — 5px deep, the most allowed — puts the ink at
    // 5 x 2.8212 / 1080 = 1.31%, over the 1.2% ceiling: a red wash, not a white floor.
    expect(judge(vary((s) => {
      for (const slice of s) {
        const first = slice.rows[0] as FixtureRow;
        slice.rows = [{ ...first, t: 2 }, { ...first, t: 3, y: first.y + 1 }];
      }
    })), 'too much').toEqual(['ink']);
  });

  it('a per-layer list one entry short — judged where CSS would really put the orphan', () => {
    // Six tiles for seven rows: the seventh (slice 5's row, its dashes reaching 911px) takes the
    // FIRST tile, 613px — so its ink runs off the end of the period, joining its own copy next
    // door, and covers 90% of it. Both the dropped entry and what the browser does with it.
    expect(judge(COMPLIANT.replace(', 1229px 1px;', ';'))).toEqual(['list', 'unbroken']);
  });

  it('no rule, or a rule that paints nothing', () => {
    expect(judge('.u { background: none; }')).toEqual(['rules']);
    expect(judge('.t { background: none; }')).toEqual(['no-gradient']);
  });

  it('the paint classifier reads what a rule DRAWS, never which floor it is on', () => {
    const rule = (background: string): string => `.t { background: ${background}; }`;
    expect(texturePaints(rule('radial-gradient(circle at 7% 58%, var(--void-texture-ink) 0 1px, transparent 2px)'), '.t'), 'a dot')
      .toEqual({ dots: true, bands: false });
    expect(texturePaints(COMPLIANT, '.t'), 'the compliant tear').toEqual({ dots: false, bands: true });
    expect(texturePaints(rule('radial-gradient(110% 80% at 26% 18%, var(--void-texture-ink), transparent 64%)'), '.t'), 'a haze')
      .toEqual({ dots: false, bands: false });
    expect(texturePaints(ORIGINAL_STATIC, "[data-texture='static'] .void-texture"), 'the old grid is neither')
      .toEqual({ dots: false, bands: false });
    // A rule that does both is judged by both, so neither guard can be dodged by mixing.
    expect(
      texturePaints(
        rule(
          'radial-gradient(circle at 7% 58%, var(--void-texture-ink) 0 1px, transparent 2px), ' +
            'linear-gradient(to right, var(--void-texture-ink) 0px 9px, transparent 9px)',
        ),
        '.t',
      ),
      'both at once',
    ).toEqual({ dots: true, bands: true });
  });
});

describe('the shipped floor 2 IS a signal tearing, and its safety margin is measured (signal-tear)', () => {
  const TEAR = "[data-texture='tear'] .void-texture";

  /** WCAG 2.3.1: no more than three flashes in any one second, a flash being a PAIR of changes. */
  const WCAG_FLASHES_PER_SECOND = 3;
  /**
   * WCAG's "small safe area": 25% of a 10-degree field, which the guideline quotes as about
   * 21,824px² — measured on a 1024x768 screen, where it is 2.78% of the whole. Below it the
   * flash thresholds do not apply at all.
   */
  const WCAG_SMALL_SAFE_AREA_PX = 21824;

  it('reports nothing at all against the band guard', () => {
    expect(tearFaults(ALL_CSS, TEAR)).toEqual([]);
  });

  it('and it is six slices of nine rows, snapping at seventeen instants — not a dot anywhere', () => {
    const safety = tearSafety(ALL_CSS, TEAR);
    expect(safety.rows, 'rows: six slices, three of which show BOTH of their torn edges').toBe(9);
    expect(safety.slices, 'slices').toBe(6);
    expect(safety.stops, 'the stops at which anything moves, in one 53s cycle').toBe(17);
    // AC-2. Floor 2 keeps no dots: that language is floor 3's alone, and the whole reason this
    // unit exists is that floor 2 had borrowed it.
    const background = declarations(rulesFor(ALL_CSS, TEAR)[0]!.body)
      .filter((d) => d.prop === 'background')
      .map((d) => d.value)
      .join(', ');
    expect(gradientLayers(background).filter((l) => l.fn !== 'linear-gradient'), 'floor 2 paints something that is not a horizontal gradient')
      .toEqual([]);
    expect(background, 'floor 2 paints a dot').not.toContain('radial-gradient');
    expect(background, 'floor 2 paints a dot').not.toContain('circle');
  });

  it('THE SAFETY CASE, in the numbers the CSS really comes to', () => {
    const safety = tearSafety(ALL_CSS, TEAR);

    // (1) THE SCREEN. The closest two stops are 4% of 53s. Nothing else on floor 2 moves, so
    // that is also the fastest anything anywhere on the screen changes: 0.47 times a second.
    expect(safety.closestStopsSeconds, '4% of 53s').toBeCloseTo(2.12, 6);
    expect(1 / safety.closestStopsSeconds, 'changes a second, anywhere on the screen').toBeLessThan(0.5);

    // (2) ONE BAND. The shortest any slice holds between its own snaps is 17% of 53s — slice F,
    // which snaps at 14%, 56% and 97% and so waits 17% of the cycle from its last snap round to
    // its first. A pixel under that band therefore goes white→red→white at most once in
    // 2 x 9.01s, which is 0.055 flashes a second: fifty-four times under WCAG's three. This is
    // the clause that matters, because a flash is a PAIR of opposing changes, and only one band
    // returning to where it was can make a pair.
    expect(safety.shortestSliceHoldSeconds, '17% of 53s, slice F across the wrap').toBeCloseTo(9.01, 6);
    const flashesPerSecond = 1 / (2 * safety.shortestSliceHoldSeconds);
    // A THIRTIETH of WCAG's line, not the line itself: `tearFaults` would already permit a 2s
    // hold, which is 0.25 flashes a second, so asserting merely "under three" would be asserting
    // something the guard has already forced. This asserts the SCHEDULE's own margin.
    expect(flashesPerSecond, `${flashesPerSecond} flashes a second`).toBeLessThan(WCAG_FLASHES_PER_SECOND / 30);

    // (3) HOW MUCH CHANGES. The worst stop is 14%, where slices C and F move together: both
    // positions of every row that moves, at 1920px wide — C is 3px of rows at 662/1151 ink, F is
    // 2px at 458/971. 10,249px², which is 0.49% of a 1920x1080 screen and under half of WCAG's
    // small safe area in absolute px² as well.
    expect(safety.worstMovedPx, "slices C and F at the 14% stop").toBeCloseTo(((662 / 1151) * 3 + (458 / 971) * 2) * 3840, 6);
    expect(safety.worstMovedShare, 'of a 1920x1080 screen').toBeLessThan(0.005);
    expect(safety.worstMovedPx / WCAG_SMALL_SAFE_AREA_PX, "of WCAG's small safe area").toBeLessThan(0.5);

    // (4) THE RED ITSELF. Σ(the share of its period each row inks x its thickness) / 1080 —
    // 0.69% of the screen, against the 0.66% the flecks laid, so the floor carries about the
    // density the author already approved.
    const inkByHand =
      ((411 / 907) * 3 + (606 / 1039) * 2 + (662 / 1151) * 3 + (719 / 1283) * 1 + (777 / 1409) * 3 + (458 / 971) * 2) / 1080;
    expect(safety.inkShare).toBeCloseTo(inkByHand, 12);
    expect(safety.inkShare, 'the flecks laid 0.66%').toBeCloseTo(0.0069, 4);
  });

  it('...and NOTHING in its keyframes is opacity, colour, brightness or a filter', () => {
    // Stated once more directly, because it is the clause the three above rest on: if position
    // were not the only thing that changed, none of those numbers would bound a flash.
    const body = keyframes(ALL_CSS).get('void-tear-snap');
    expect(body, 'void-tear-snap is gone').toBeDefined();
    for (const d of declarations(body as string)) {
      expect(d.prop, `a tear keyframe declares ${d.prop}`).toBe('background-position');
    }
    expect(declarations(body as string).length, 'the keyframes declare nothing at all').toBe(19);
  });

  it('the closing hold IS the rest frame, so the loop point is invisible and reduced motion shows it', () => {
    // AC-7, said in full: the rule's own `background-position` — which is what a player with
    // reduced motion sees, because both reduced-motion rules set `animation: none` — is also the
    // value at 0%, at the last stop before 100%, and at 100%. So the 53s cycle ends on the still
    // picture, comes round to the same still picture, and changes nothing where it joins.
    const own = declarations(rulesFor(ALL_CSS, TEAR)[0]!.body).filter((d) => d.prop === 'background-position').at(-1)?.value ?? '';
    const stops = keyframeStops(keyframes(ALL_CSS).get('void-tear-snap') as string);
    const positionOf = (at: number): string =>
      splitTop(stops.find((s) => s.at === at)?.decls.filter((d) => d.prop === 'background-position').at(-1)?.value ?? '')
        .map((e) => e.replace(/\s+/g, ' ').trim())
        .join(', ');
    const rest = splitTop(own).map((e) => e.replace(/\s+/g, ' ').trim()).join(', ');
    expect(rest, 'the rule rests on nothing').not.toBe('');
    expect(positionOf(0), '0% is not the rest frame').toBe(rest);
    expect(positionOf(100), '100% is not the rest frame').toBe(rest);
    const lastBefore = [...stops].reverse().find((s) => s.at < 100);
    expect(lastBefore?.at, 'the last stop before 100%').toBe(97);
    expect(positionOf(97), 'the closing hold is not the rest frame').toBe(rest);
    // ...and reduced motion really does stop it, in both contexts (the control for all of this).
    expect(stopsMotion(ALL_CSS, "[data-motion='reduce']", '.void-texture')).toBe(true);
    expect(stopsMotion(reducedMotionBlock(ALL_CSS), "data-motion='full'", '.void-texture')).toBe(true);
  });

  it('...and that silence is not blindness: filling in one shipped row is reported', () => {
    // The shipped rule passing `tearFaults` means nothing unless the guard would speak up about
    // THIS rule. Every one of its nine rows, un-broken in turn, must be reported.
    const rule = rulesFor(ALL_CSS, TEAR)[0]!.body;
    const layers = gradientLayers(declarations(rule).filter((d) => d.prop === 'background').at(-1)?.value ?? '');
    expect(layers, 'the tear has no rows to break').toHaveLength(9);
    for (const [i, layer] of layers.entries()) {
      const marks = [...layer.args.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      const first = Math.min(...marks.filter((v) => v > 0));
      const last = Math.max(...marks);
      const filled = `linear-gradient(to right, transparent 0px ${first}px, var(--void-texture-ink) ${first}px ${last}px, transparent ${last}px)`;
      const spoiled = ALL_CSS.replace(`linear-gradient(${layer.args})`, filled);
      expect(spoiled, `row ${i + 1} was not found to fill in`).not.toBe(ALL_CSS);
      expect(tearFaults(spoiled, TEAR).map((f) => f.split(' ')[0]), `row ${i + 1} filled in`).toContain('unbroken');
    }
  });

  it('every floor texture is judged by the guard for what it PAINTS, not for which floor it is', () => {
    // The dispatch. Floor 3 keeps the lattice guard it already had and floor 2 is not merely
    // excused from it: each rule is classified by the shapes in its own `background`, and a rule
    // that drew both dots and bands would answer to both guards.
    const painted = FLOOR_THEMES.map((floor) => {
      const selector = `[data-texture='${floor.texture.kind}'] .void-texture`;
      const paints = texturePaints(ALL_CSS, selector);
      if (paints.dots) expect(latticeFaults(ALL_CSS, selector), `${selector} as dots`).toEqual([]);
      if (paints.bands) expect(tearFaults(ALL_CSS, selector), `${selector} as bands`).toEqual([]);
      return paints;
    });
    // ...and the sweep is not vacuous: exactly one floor paints dots, exactly one paints bands,
    // and the other three are hazes that neither guard has anything to say about.
    expect(painted.filter((p) => p.dots).length, 'floors painting dots').toBe(1);
    expect(painted.filter((p) => p.bands).length, 'floors painting bands').toBe(1);
    expect(painted.filter((p) => !p.dots && !p.bands).length, 'floors painting a haze').toBe(3);
    // The one that paints dots is floor 3, and the one that paints bands is floor 2 — stated by
    // index rather than by kind name, so a future rename cannot quietly swap them.
    expect(painted[2], 'floor 3').toEqual({ dots: true, bands: false });
    expect(painted[1], 'floor 2').toEqual({ dots: false, bands: true });
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

describe('floors 1, 3, 4 and 5 keep the paint they had (AC-8b)', () => {
  // TRANSCRIBED from `atmosphere.css` on `main` at 6ebfa42 (the plan's "unchanged CSS" block),
  // whitespace-normalised — never read back from the file under test. A unit that DELIBERATELY
  // re-paints one of these floors updates its line here, and says why in the commit.
  //
  // FLOOR 3 ADDED 2026-09-20 by `signal-tear`, transcribed from `atmosphere.css` on `main` at
  // 51ed45f. That unit re-paints floor 2 and nothing else, and floor 3 is the floor it could
  // most easily damage by accident: the two sat in one comment block, one `speck-scatter`
  // section and one shared set of tests, so "floor 2 only" needed something that would notice.
  const PINNED_RULES: Record<string, string> = {
    "[data-texture='fog'] .void-texture":
      "[data-texture='fog'] .void-texture { background: radial-gradient(120% 70% at 18% 108%, var(--void-texture-ink), transparent 62%), radial-gradient(95% 62% at 86% 96%, var(--void-texture-ink), transparent 66%); background-size: 160% 160%, 150% 150%; animation: void-fog-drift 96s ease-in-out infinite alternate; }",
    "[data-texture='ash'] .void-texture":
      "[data-texture='ash'] .void-texture { background: radial-gradient(circle at 7% 58%, " +
      "var(--void-texture-ink) 0 0.7px, transparent 1.2px), radial-gradient(circle at 31% 12%, " +
      "var(--void-texture-ink) 0 0.9px, transparent 1.5px), radial-gradient(circle at 42% 81%, " +
      "var(--void-texture-ink) 0 0.8px, transparent 1.4px), radial-gradient(circle at 66% 39%, " +
      "var(--void-texture-ink) 0 1px, transparent 1.6px), radial-gradient(circle at 74% 93%, " +
      "var(--void-texture-ink) 0 0.75px, transparent 1.3px), radial-gradient(circle at 92% 24%, " +
      "var(--void-texture-ink) 0 0.85px, transparent 1.45px), radial-gradient(circle at 12% 33%, " +
      "var(--void-texture-ink) 0 1.1px, transparent 1.7px), radial-gradient(circle at 24% 86%, " +
      "var(--void-texture-ink) 0 1.4px, transparent 2.1px), radial-gradient(circle at 46% 9%, " +
      "var(--void-texture-ink) 0 1.2px, transparent 1.9px), radial-gradient(circle at 57% 68%, " +
      "var(--void-texture-ink) 0 1.6px, transparent 2.3px), radial-gradient(circle at 79% 47%, " +
      "var(--void-texture-ink) 0 1.3px, transparent 2px), radial-gradient(circle at 90% 18%, " +
      "var(--void-texture-ink) 0 1.5px, transparent 2.2px), radial-gradient(110% 80% at 26% 18%, " +
      "var(--void-texture-ink), transparent 64%), radial-gradient(90% 72% at 82% 92%, var(--void-texture-ink), " +
      "transparent 68%); background-size: 113px 127px, 113px 127px, 113px 127px, 113px 127px, 113px 127px, " +
      "113px 127px, 179px 181px, 179px 181px, 179px 181px, 179px 181px, 179px 181px, 179px 181px, 150% 150%, " +
      "140% 140%; background-position: 0px 0px, 0px 0px, 0px 0px, 0px 0px, 0px 0px, 0px 0px, 23px 11px, 23px 11px, " +
      "23px 11px, 23px 11px, 23px 11px, 23px 11px, 20% 10%, 80% 90%; animation: void-ash-fall 30s linear infinite; }",
    "[data-texture='glow'] .void-texture":
      "[data-texture='glow'] .void-texture { background: radial-gradient(72% 58% at 50% 4%, var(--void-texture-ink), transparent 72%); background-size: 130% 130%; animation: void-glow-breathe 70s ease-in-out infinite alternate; }",
    "[data-texture='absence'] .void-texture":
      "[data-texture='absence'] .void-texture { background: radial-gradient(118% 104% at 50% 46%, transparent 34%, var(--void-texture-ink)); }",
  };
  const PINNED_KEYFRAMES: Record<string, string> = {
    'void-fog-drift':
      '@keyframes void-fog-drift { from { background-position: 0% 100%, 100% 100%; } to { background-position: 12% 88%, 88% 84%; } }',
    'void-ash-fall':
      "@keyframes void-ash-fall { from { background-position: 0px 0px, 0px 0px, 0px 0px, 0px 0px, 0px 0px, 0px 0px, " +
      "23px 11px, 23px 11px, 23px 11px, 23px 11px, 23px 11px, 23px 11px, 20% 10%, " +
      "80% 90%; } to { background-position: 0px 127px, 0px 127px, 0px 127px, 0px 127px, 0px 127px, 0px 127px, " +
      "23px 192px, 23px 192px, 23px 192px, 23px 192px, 23px 192px, 23px 192px, 20% 10%, 80% 90%; } }",
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
