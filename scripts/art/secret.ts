// THE API KEY, AND WHY IT CANNOT BE PRINTED.
//
// This repository is PUBLIC, and `docs/ART-BIBLE.md` §1 is blunt about it: "Never inline a key,
// commit one, or log one." §9.8 records that the current key already reached a chat transcript
// once and must be rotated. So the rule here is not "remember not to log the key" — a rule nobody
// can enforce — but "make logging it impossible by construction".
//
// HOW. The value lives in a CLOSURE variable and is never a property of anything. The object
// handed out has no field holding it, so there is nothing for `JSON.stringify`, a spread, a
// structured clone, an object dump or a debugger to find. The four ways a value normally escapes
// into text are all overridden to yield `[redacted]`:
//
//   String(secret)            -> toString
//   `${secret}` / '' + secret -> Symbol.toPrimitive (every hint), then toString
//   JSON.stringify(secret)    -> toJSON
//   util.inspect(secret)      -> Symbol.for('nodejs.util.inspect.custom')   (console.log too)
//
// The value leaves the closure through exactly ONE door: `applyTo(headers)`, which writes the
// `x-goog-api-key` request header. It is never a query parameter (a URL is logged by every proxy
// and every error handler that has ever existed), never a body field, never a command-line
// argument.
//
// `redact(text)` is the other direction: scrub a string that may have picked the key up from
// somewhere else — an HTTP error body that echoed the request, say — before it reaches a log or
// an exception message.
//
// This module is PURE. It reads no file and no environment of its own accord: `loadSecretFrom`
// is handed the `.env` text and the environment record by its caller, so every test drives it
// with invented values and no test has ever to read a real `.env`.

/** What every string conversion of a `Secret` yields, and what `redact` substitutes. */
export const REDACTED = '[redacted]';

/** The environment variable the key is read from (ART-BIBLE §1; `.env.example`). */
export const KEY_VARIABLE = 'GOOGLE_API_KEY';

/** The one header the key is ever written into (ART-BIBLE §1: `X-goog-api-key`). */
export const KEY_HEADER = 'x-goog-api-key';

/**
 * A held API key. The value is not reachable from this object — only usable through it.
 *
 * There is deliberately NO `value()` / `reveal()` accessor. Adding one would give every future
 * caller a way to put the key into a string, and the point of this type is that no such way
 * exists.
 */
export interface Secret {
  /** Write the key into `headers` as `x-goog-api-key`. The only way the value ever leaves. */
  applyTo(headers: Record<string, string>): void;
  /** `text` with every occurrence of the key replaced by `[redacted]`. */
  redact(text: string): string;
  toString(): string;
  toJSON(): string;
}

/**
 * Wrap a key value. `value` is captured and then unreachable.
 *
 * Throws on an empty value rather than quietly producing a `Secret` that authenticates nothing:
 * an empty key fails at the API as an opaque 400/403 long after the mistake was made.
 */
export function createSecret(value: string): Secret {
  if (value === '') throw new Error(`${KEY_VARIABLE} is empty — a Secret cannot hold an empty key`);

  const secret: Secret = {
    applyTo(headers: Record<string, string>): void {
      headers[KEY_HEADER] = value;
    },
    // `split`/`join` rather than a RegExp: a key is arbitrary text, and building a regex from it
    // would either need escaping (one missed metacharacter = no redaction) or risk throwing.
    redact(text: string): string {
      return text.split(value).join(REDACTED);
    },
    toString(): string {
      return REDACTED;
    },
    toJSON(): string {
      return REDACTED;
    },
  };

  // Every remaining implicit conversion. `Symbol.toPrimitive` covers 'string', 'number' and
  // 'default' hints in one, so `${s}`, `'' + s` and even `s * 1` cannot reach the value.
  Object.defineProperty(secret, Symbol.toPrimitive, {
    value: () => REDACTED,
    enumerable: false,
  });
  // Node's `util.inspect`, which is what `console.log(obj)` and most dumps go through.
  Object.defineProperty(secret, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => REDACTED,
    enumerable: false,
  });

  return Object.freeze(secret);
}

/**
 * Parse `.env` text into a plain record.
 *
 * Deliberately conservative about what counts as a comment: a line is a comment only when its
 * first non-blank character is `#`. An inline `#` inside a value is KEPT. Stripping inline
 * comments is the common dotenv behaviour and it is the wrong trade here — it would silently
 * TRUNCATE a key that happened to contain a `#`, producing an authentication failure with no
 * visible cause, to save the author from a stray comment they can simply not write.
 *
 * Handles: `KEY=value`, `KEY = value`, single or double quoted values, `export KEY=value`,
 * blank lines, full-line comments, CRLF line endings, and `=` inside a value.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue; // not a assignment; ignore rather than guess

    const name = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (name === '') continue;

    let value = line.slice(eq + 1).trim();
    const first = value[0];
    if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
      value = value.slice(1, -1);
    }
    out[name] = value;
  }
  return out;
}

/**
 * The key, from the process environment if it is set there, otherwise from `.env` text.
 *
 * `env` wins so a one-off run can export the variable without editing `.env` — and so CI, which
 * has no `.env`, has a path at all.
 *
 * @param dotEnvText the contents of `.env`, or `undefined` when the file does not exist. A
 *   MISSING `.env` is not an error by itself; a missing KEY is.
 *
 * The thrown message names the variable and nothing else. It deliberately does NOT quote the
 * file, the parsed keys, or how many entries were found: this error is the single most likely
 * thing to be pasted into a bug report or a chat window, and `.env` holds other people's
 * secrets too.
 */
export function loadSecretFrom(
  dotEnvText: string | undefined,
  env: Record<string, string | undefined>,
): Secret {
  const fromEnv = env[KEY_VARIABLE];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return createSecret(fromEnv.trim());

  const fromFile = dotEnvText === undefined ? undefined : parseDotEnv(dotEnvText)[KEY_VARIABLE];
  if (fromFile !== undefined && fromFile.trim() !== '') return createSecret(fromFile.trim());

  throw new Error(
    `${KEY_VARIABLE} is not set — put it in .env (see .env.example), or export it in the environment`,
  );
}
