import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveModelDir, filesToMigrate } from './model-path.mjs';

// ---------------------------------------------------------------------------
// Every expected value below is derived BY HAND from the spec, never measured
// from the implementation:
//   resolveModelDir: env.VOID_MODELS_DIR (non-empty) wins verbatim; otherwise
//     userDataDir joined with 'models'. For a userDataDir with no trailing
//     separator, path.join simply appends the platform separator + 'models',
//     so the expected value is `userDataDir + path.sep + 'models'` — computed
//     here from path.sep alone (not by calling the same join the code uses).
//   filesToMigrate: set difference on basenames, keeping only '.gguf' names in
//     legacy order.
// ---------------------------------------------------------------------------

describe('resolveModelDir', () => {
  it('returns VOID_MODELS_DIR verbatim when set (a mirror joining userData would fail)', () => {
    const res = resolveModelDir({
      env: { VOID_MODELS_DIR: '/custom/path' },
      userDataDir: '/u/data',
    });
    expect(res).toBe('/custom/path');
  });

  it('defaults to userDataDir joined with "models" when the env key is absent', () => {
    const userDataDir = path.join('/u', 'data'); // a clean, separator-free tail
    const expected = userDataDir + path.sep + 'models'; // hand-derived join result
    expect(resolveModelDir({ env: {}, userDataDir })).toBe(expected);
  });

  it('treats an empty-string VOID_MODELS_DIR as unset → falls back to the default', () => {
    const userDataDir = path.join('/u', 'data');
    const expected = userDataDir + path.sep + 'models';
    expect(resolveModelDir({ env: { VOID_MODELS_DIR: '' }, userDataDir })).toBe(expected);
  });

  it('treats a whitespace-only VOID_MODELS_DIR as unset → falls back to the default', () => {
    const userDataDir = path.join('/u', 'data');
    const expected = userDataDir + path.sep + 'models';
    expect(resolveModelDir({ env: { VOID_MODELS_DIR: '   ' }, userDataDir })).toBe(expected);
  });
});

describe('filesToMigrate', () => {
  it('migrates every legacy .gguf when the canonical dir is empty', () => {
    expect(filesToMigrate(['a.gguf', 'b.gguf'], [])).toEqual(['a.gguf', 'b.gguf']);
  });

  it('skips a basename already present in the canonical dir', () => {
    expect(filesToMigrate(['a.gguf', 'b.gguf'], ['a.gguf'])).toEqual(['b.gguf']);
  });

  it('ignores non-gguf files', () => {
    expect(filesToMigrate(['notes.txt', 'model.gguf'], [])).toEqual(['model.gguf']);
  });

  it('returns [] when nothing qualifies (empty legacy list)', () => {
    expect(filesToMigrate([], [])).toEqual([]);
  });

  it('returns [] when the only legacy files are non-gguf', () => {
    expect(filesToMigrate(['a.txt', 'b.md'], [])).toEqual([]);
  });

  it('matches .gguf case-insensitively', () => {
    expect(filesToMigrate(['Model.GGUF'], [])).toEqual(['Model.GGUF']);
  });

  it('preserves legacy input order and returns only basenames from legacyFiles', () => {
    const legacy = ['z.gguf', 'a.gguf', 'm.gguf'];
    const result = filesToMigrate(legacy, ['a.gguf']);
    expect(result).toEqual(['z.gguf', 'm.gguf']); // 'a' skipped, order kept
    for (const name of result) expect(legacy).toContain(name);
  });
});
