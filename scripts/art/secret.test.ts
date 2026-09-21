// THE KEY CANNOT BE PRINTED — asserted, not intended. (AC-13, AC-15.)
//
// `docs/ART-BIBLE.md` §1: "Never inline a key, commit one, or log one", and §9.8 records that the
// live key already reached a chat transcript once. This repository is public. So the claim under
// test is the strong one: there is no string conversion of a `Secret` that yields the value.
//
// THE FAKE KEY BELOW IS NOT A KEY. It is 39 characters in the shape of a Google API key so that a
// truncation bug would show up, and it says what it is in its own text. No test in this file reads
// `.env`, the real environment, or the network.
//
// WHY THERE IS A NEGATIVE CONTROL. "`util.inspect(x)` does not contain the key" passes for a great
// many uninteresting reasons — inspect truncating, the value never having been stored, the
// assertion comparing the wrong thing. So every conversion is ALSO run over a plain object holding
// the same value, and that one is required to LEAK. If the plain object stops leaking, the
// assertions have stopped being able to detect a leak and the whole file is vacuous.

import { describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import {
  createSecret,
  loadSecretFrom,
  parseDotEnv,
  KEY_HEADER,
  KEY_VARIABLE,
  REDACTED,
} from './secret.ts';

/** Obviously fake, key-shaped (39 chars), and self-describing. */
const FAKE_KEY = 'AIzaFAKEfakeFAKEnotARealKey000000000000';

/** Every way a value normally turns into text. */
const CONVERSIONS: readonly [string, (x: unknown) => string][] = [
  ['String(x)', (x) => String(x)],
  ['`${x}`', (x) => `${x}`],
  ["'' + x", (x) => '' + (x as string)],
  ['JSON.stringify(x)', (x) => JSON.stringify(x) ?? ''],
  ['JSON.stringify({ wrapped: x })', (x) => JSON.stringify({ wrapped: x }) ?? ''],
  ['util.inspect(x)', (x) => inspect(x)],
  ['util.inspect({ wrapped: x }, { depth: 8 })', (x) => inspect({ wrapped: x }, { depth: 8 })],
  ['util.inspect(x, { showHidden: true })', (x) => inspect(x, { showHidden: true, depth: 8 })],
];

describe('the leak detector itself (negative control)', () => {
  // If this describe ever goes green-by-passing (i.e. the plain object stops leaking), every
  // assertion in the next describe is proving nothing.
  it('a plain object holding the same value LEAKS it under every conversion', () => {
    const naive = { apiKey: FAKE_KEY, toString: () => FAKE_KEY };
    const leaked: string[] = [];
    for (const [name, convert] of CONVERSIONS) {
      if (convert(naive).includes(FAKE_KEY)) leaked.push(name);
    }
    expect(leaked).toEqual(CONVERSIONS.map(([name]) => name));
  });
});

describe('Secret — every string conversion yields [redacted] (AC-13)', () => {
  const secret = createSecret(FAKE_KEY);

  for (const [name, convert] of CONVERSIONS) {
    it(`${name} contains no part of the key, and does contain ${REDACTED}`, () => {
      const text = convert(secret);
      expect(text).not.toContain(FAKE_KEY);
      // A 12-character prefix: catches a conversion that truncates the key rather than hiding it.
      expect(text).not.toContain(FAKE_KEY.slice(0, 12));
      expect(text).toContain(REDACTED);
    });
  }

  it('String(), the template form and toJSON() are exactly [redacted]', () => {
    expect(String(secret)).toBe(REDACTED);
    expect(`${secret}`).toBe(REDACTED);
    expect(JSON.stringify(secret)).toBe(`"${REDACTED}"`);
    expect(inspect(secret)).toBe(REDACTED);
  });

  it('holds the value in no property, so there is nothing to enumerate or spread', () => {
    expect(Object.keys(secret)).not.toContain('value');
    const everything = [
      ...Object.getOwnPropertyNames(secret),
      ...Object.getOwnPropertyNames(secret).map((k) =>
        String((secret as unknown as Record<string, unknown>)[k]),
      ),
      JSON.stringify({ ...secret }),
    ].join('|');
    expect(everything).not.toContain(FAKE_KEY);
  });

  it('is frozen, so the redacting conversions cannot be replaced at runtime', () => {
    expect(Object.isFrozen(secret)).toBe(true);
  });

  it('refuses to hold an empty key', () => {
    expect(() => createSecret('')).toThrow(/empty/i);
  });
});

describe('Secret.applyTo — the one door the value leaves by (AC-13)', () => {
  it('sets exactly x-goog-api-key, and nothing else', () => {
    const headers: Record<string, string> = {};
    createSecret(FAKE_KEY).applyTo(headers);
    expect(Object.keys(headers)).toEqual([KEY_HEADER]);
    expect(KEY_HEADER).toBe('x-goog-api-key');
    expect(headers[KEY_HEADER]).toBe(FAKE_KEY);
  });

  it('leaves the caller’s other headers alone', () => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    createSecret(FAKE_KEY).applyTo(headers);
    expect(Object.keys(headers).sort()).toEqual(['content-type', KEY_HEADER]);
  });
});

describe('Secret.redact — scrubbing text the key may have reached', () => {
  const secret = createSecret(FAKE_KEY);

  it('replaces every occurrence, not just the first', () => {
    const body = `error at ?key=${FAKE_KEY} retried with ${FAKE_KEY} and failed`;
    const scrubbed = secret.redact(body);
    expect(scrubbed).not.toContain(FAKE_KEY);
    expect(scrubbed).toBe(`error at ?key=${REDACTED} retried with ${REDACTED} and failed`);
  });

  it('leaves text that does not contain the key untouched', () => {
    expect(secret.redact('HTTP 429: quota exceeded')).toBe('HTTP 429: quota exceeded');
  });

  it('works on a key full of regex metacharacters (no escaping bug)', () => {
    // A `split`/`join` implementation is immune; a RegExp one would either throw or under-match.
    const nasty = createSecret('a.*+?[](){}|^$\\b');
    expect(nasty.redact('before a.*+?[](){}|^$\\b after')).toBe(`before ${REDACTED} after`);
  });
});

describe('parseDotEnv (AC-15)', () => {
  it('reads a plain KEY=value', () => {
    expect(parseDotEnv('GOOGLE_API_KEY=abc123')).toEqual({ GOOGLE_API_KEY: 'abc123' });
  });

  it('skips blank lines and full-line comments, and tolerates CRLF', () => {
    const text = '# a comment\r\n\r\nGOOGLE_API_KEY=abc123\r\n   # indented comment\r\nOTHER=2\r\n';
    expect(parseDotEnv(text)).toEqual({ GOOGLE_API_KEY: 'abc123', OTHER: '2' });
  });

  it('strips matching single or double quotes, and surrounding spaces', () => {
    expect(parseDotEnv('A="dq"\nB=\'sq\'\nC =  bare  \nD="has spaces"')).toEqual({
      A: 'dq',
      B: 'sq',
      C: 'bare',
      D: 'has spaces',
    });
  });

  it('keeps an = inside the value, and an `export` prefix is allowed', () => {
    expect(parseDotEnv('export GOOGLE_API_KEY=a=b=c')).toEqual({ GOOGLE_API_KEY: 'a=b=c' });
  });

  it('does NOT truncate a value at an inline #', () => {
    // A key containing `#` truncated by a dotenv-style inline-comment strip would authenticate
    // nothing and give no visible reason why. Keeping it is the safer failure.
    expect(parseDotEnv('GOOGLE_API_KEY=abc#123')).toEqual({ GOOGLE_API_KEY: 'abc#123' });
  });

  it('ignores a line with no = rather than guessing', () => {
    expect(parseDotEnv('GOOGLE_API_KEY\nOK=1')).toEqual({ OK: '1' });
  });

  it('parses the repository’s own .env.example shape (empty value)', () => {
    expect(parseDotEnv('GOOGLE_API_KEY=')).toEqual({ GOOGLE_API_KEY: '' });
  });
});

describe('loadSecretFrom (AC-15)', () => {
  it('takes the key from .env when the environment has none', () => {
    const headers: Record<string, string> = {};
    loadSecretFrom(`${KEY_VARIABLE}=${FAKE_KEY}`, {}).applyTo(headers);
    expect(headers[KEY_HEADER]).toBe(FAKE_KEY);
  });

  it('prefers the environment over .env', () => {
    const headers: Record<string, string> = {};
    loadSecretFrom(`${KEY_VARIABLE}=from-file`, { [KEY_VARIABLE]: FAKE_KEY }).applyTo(headers);
    expect(headers[KEY_HEADER]).toBe(FAKE_KEY);
  });

  it('trims surrounding whitespace off the value', () => {
    const headers: Record<string, string> = {};
    loadSecretFrom(undefined, { [KEY_VARIABLE]: `  ${FAKE_KEY}\t` }).applyTo(headers);
    expect(headers[KEY_HEADER]).toBe(FAKE_KEY);
  });

  const MISSING: readonly [string, string | undefined, Record<string, string | undefined>][] = [
    ['no .env file at all and an empty environment', undefined, {}],
    ['a .env with no GOOGLE_API_KEY line', 'SOMETHING_ELSE=1', {}],
    ['a .env with an empty GOOGLE_API_KEY (the .env.example shape)', `${KEY_VARIABLE}=`, {}],
    ['a whitespace-only value', `${KEY_VARIABLE}=   `, {}],
    ['an empty environment variable', undefined, { [KEY_VARIABLE]: '' }],
  ];

  for (const [label, text, env] of MISSING) {
    it(`throws, naming the variable, for ${label}`, () => {
      expect(() => loadSecretFrom(text, env)).toThrow(/GOOGLE_API_KEY/);
      expect(() => loadSecretFrom(text, env)).toThrow(/\.env\.example/);
    });
  }

  it('the not-set error quotes NO file content — .env holds other secrets too', () => {
    const dotEnv = [
      '# the art key',
      `${KEY_VARIABLE}=`,
      'UNRELATED_TOKEN=hunter2-must-not-appear',
      'DB_PASSWORD=also-must-not-appear',
    ].join('\n');

    let message = '';
    try {
      loadSecretFrom(dotEnv, {});
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain(KEY_VARIABLE);
    expect(message).not.toContain('hunter2-must-not-appear');
    expect(message).not.toContain('also-must-not-appear');
    expect(message).not.toContain('UNRELATED_TOKEN');
    expect(message).not.toContain('DB_PASSWORD');
    // Not "found 3 entries" either: a count is a hint about a file the reader should not see.
    expect(message).not.toMatch(/\b[0-9]+\b/);
  });
});
