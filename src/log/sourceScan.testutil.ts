// TEST-ONLY infrastructure for every source guard in this repo. NOTHING THAT SHIPS IMPORTS
// THIS — it is imported only by `*.test.ts` / `*.test.mjs` files. It lives under `src/` so
// `tsc --noEmit` typechecks it, and is named `.testutil.ts` (not `.test.ts`) so Vitest's
// `src/**/*.test.ts` include does not collect it as a suite. `sourceScan.test.mjs` is where
// it is proved.
//
// ONE implementation, imported by both the `.ts` and the `.mjs` guards. It began as four
// copies; the moment it grew a real lexer that became the obvious drift hazard, and a
// scanner that is subtly different in one of four places is exactly the "guard that cannot
// fail" this file exists to prevent.
//
// ---------------------------------------------------------------------------------------
// WHY THIS IS NOT TWO REGEXES, AND THEN WHY IT IS NOT A SIMPLE STATE MACHINE EITHER.
//
// ROUND 1 — the obvious stripper is
//     src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
// and it is wrong in a way that makes every guard using it silently useless. A LINE comment
// that merely mentions a glob — `electron/**`, `./models/*.gguf`, both real in this repo —
// contains the characters `/*`. The block-comment pass runs first, sees it, and deletes
// everything to the next `*​/`, which is the end of the first JSDoc dozens of lines below.
// The file's whole import section vanishes and every downstream "must NOT appear" assertion
// passes because it is scanning a HOLE. Found by mutation-testing this unit's own G6 guard:
// reintroducing `const __dirname = path.dirname(fileURLToPath(import.meta.url))` at module
// scope — G6 verbatim — left the guard GREEN.
//
// ROUND 2 — the single-pass scanner that replaced it tracked strings and both comment
// forms, but NOT regular-expression literals. `const HOLE = /a\/*b/;` is a regex whose
// body contains an escaped slash followed by a star; the scanner walked past the opening
// `/`, then met `\` `/` `*` and read `/*` as a block-comment opener. Everything from there
// to the next `*​/` was swallowed — and a G6 restoration hidden in that gap stayed green,
// with every anchor above it still passing. The documented mitigation ("assert your anchors
// survive") only covers holes that SPAN an anchor, and a hole between two adjacent anchors
// spans none.
//
// So the scanner now recognises regex literals, which is the only complete answer. Telling
// a regex from a division is context-dependent, and the standard heuristic is used: a `/`
// begins a regex when the previous significant token cannot END an expression. After an
// identifier, a number, `)`, `]` or `}` it is division; after `(`, `,`, `=`, `:`, an
// operator, a statement start, or one of the keywords below, it is a regex. Every real
// division in this repo (`tokens / Math.max(...)`, `(20 * CAP) / 150`) sits after an
// identifier or a `)`, and every regex sits after `=`, `(` or `return`.
// ---------------------------------------------------------------------------------------

/** Keywords after which a `/` can only begin a regular expression, never a division. */
const REGEX_PRECEDING_KEYWORDS = [
  'return',
  'typeof',
  'instanceof',
  'case',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'yield',
  'await',
  'throw',
];

/** Can the text emitted so far END an expression? If so, a following `/` is division. */
function endsExpression(emitted: string): boolean {
  const trimmed = emitted.replace(/\s+$/, '');
  if (trimmed === '') return false;
  const last = trimmed[trimmed.length - 1] as string;
  if (last === ')' || last === ']') return true;
  // A `}` ends an object literal (expression) or a block (statement). Treating it as
  // "ends an expression" makes a following `/` a division, which is the safe reading:
  // mis-reading a regex as division only leaves its text in place, while the reverse
  // swallows code.
  if (last === '}') return true;
  if (!/[A-Za-z0-9_$]/.test(last)) return false;
  const word = /[A-Za-z0-9_$]+$/.exec(trimmed)?.[0] ?? '';
  return !REGEX_PRECEDING_KEYWORDS.includes(word);
}

/**
 * `source` with every comment removed, and every string, template and REGULAR EXPRESSION
 * literal left intact.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    const d = source[i + 1];

    if (c === '/' && d === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        const done = source[i] === c;
        i += 1;
        if (done) break;
      }
      continue;
    }
    if (c === '/' && !endsExpression(out)) {
      // A regex literal. Consumed WHOLE, so an escaped `\/` or a `/*` inside its body can
      // never be mistaken for a comment opener — which is the entire defect this branch
      // exists for. `[...]` is tracked because `/` is literal inside a character class.
      out += c;
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const ch = source[i] as string;
        if (ch === '\\') {
          out += ch + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
        if (ch === '\n') break; // an unterminated regex: bail rather than run away
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
      }
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

/**
 * Did the strip run off the end of the file? A well-formed file leaves an appended
 * sentinel alone; a file that ends inside an unterminated block comment eats it.
 *
 * Kept even now that regex literals are tracked: it is the cheap, independent check that
 * the lexer did not lose its place for ANY reason, and it costs one string concatenation.
 */
export function stripReachesEndOfFile(raw: string): boolean {
  return stripComments(`${raw}\nVOID_STRIP_SENTINEL`).includes('VOID_STRIP_SENTINEL');
}

/**
 * The text of every call `name(...)`, with balanced parentheses — so an assertion about a
 * call's ARGUMENTS cannot be fooled by the first `)` inside a nested call.
 *
 * String-aware, and that is load-bearing: this repo really does log
 * `mlog('error','llm','generate: FAILED (main)', …)`, and a depth counter that counted the
 * parenthesis inside that message would end the call in the wrong place and hand every
 * downstream assertion a truncated string.
 *
 * `name` is interpolated into a regex, so a dotted name is passed escaped (`inst\\.run`).
 */
export function callsTo(source: string, name: string): string[] {
  const found: string[] = [];
  const needle = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (const m of source.matchAll(needle)) {
    const start = m.index as number;
    // A DECLARATION is not a call. `function mlog(level, category, message, data)` would
    // otherwise be returned as a call whose "arguments" are parameter names.
    if (/(?:async\s+)?function\s+$/.test(source.slice(Math.max(0, start - 20), start))) continue;
    let depth = 0;
    for (let i = start + m[0].length - 1; i < source.length; i += 1) {
      const c = source[i] as string;
      if (c === '"' || c === "'" || c === '`') {
        i += 1;
        while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          found.push(source.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return found;
}

/**
 * The TOP-LEVEL arguments of a call text (as produced by `callsTo`), split on commas that
 * are not inside nested brackets or strings. Trimmed; empty for a no-argument call.
 */
export function argsOf(callText: string): string[] {
  const open = callText.indexOf('(');
  const inner = callText.slice(open + 1, callText.lastIndexOf(')'));
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      current += c;
      i += 1;
      while (i < inner.length && inner[i] !== c) {
        if (inner[i] === '\\') {
          current += inner[i] + (inner[i + 1] ?? '');
          i += 2;
          continue;
        }
        current += inner[i];
        i += 1;
      }
      current += inner[i] ?? '';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim() !== '') args.push(current.trim());
  return args;
}
