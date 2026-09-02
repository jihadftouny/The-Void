// TEST-ONLY infrastructure for the source guards in `electron/*.test.mjs`. Nothing that
// ships imports this. (Named `.testutil.mjs`, not `.test.mjs`, so Vitest's
// `electron/**/*.test.mjs` include does not collect it as a suite; `sourceScan.test.mjs`
// is where it is proved.)
//
// ---------------------------------------------------------------------------------------
// WHY THIS IS NOT TWO REGEXES.
//
// The obvious stripper is
//     src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
// and it is WRONG in a way that makes the guards using it silently useless. A LINE comment
// that merely mentions a glob — `electron/**`, `./models/*.gguf`, both of which are in this
// repo today — contains the characters `/*`. The block-comment pass runs first, sees that
// `/*`, and deletes everything up to the next `*/` it can find, which is the end of the
// first JSDoc block dozens of lines later. The whole import section of the file vanishes,
// and every "this must NOT appear" assertion downstream passes because it is scanning a
// hole.
//
// That is not hypothetical: it was found here by MUTATION-TESTING this unit's own G6
// guard. Reintroducing `const __dirname = path.dirname(fileURLToPath(import.meta.url))` at
// module scope in `log.mjs` — G6 verbatim — left the guard GREEN, because the header
// comment above it says "packs `electron/**` into the asar".
//
// So this is a single left-to-right scan that knows the four states a JavaScript character
// can be in: code, a line comment, a block comment, or a string/template literal.
//
// KNOWN LIMITATION, stated rather than hidden: it does not track regular-expression
// literals, so a regex containing `//` or `/*` would confuse it. Every caller therefore
// asserts that its ANCHORS survive the strip — which is the assertion that would have
// caught the bug above, and the one every source guard here now carries.
// ---------------------------------------------------------------------------------------

/** `source` with every comment removed and every string literal left intact. */
export function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < n) {
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
    out += c;
    i += 1;
  }
  return out;
}

/**
 * The text of a call `name(...)`, with balanced parentheses — so an assertion about a
 * call's ARGUMENTS cannot be fooled by the first `)` inside a nested call.
 */
export function callsTo(source, name) {
  const found = [];
  const needle = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (const m of source.matchAll(needle)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = m.index;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
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
