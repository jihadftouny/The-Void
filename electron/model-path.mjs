// Pure decisions for where the local GGUF model lives on this machine.
//
// The ~2.5GB model must be downloaded once into a single, stable per-user
// location and reused by every launch and every git worktree. Today's bug:
// `resolveModelFile(MODEL_URI, 'models')` resolves `models/` relative to the
// process CWD, so launching from a different worktree re-downloads the model
// into that worktree's own `./models`.
//
// This module owns only the *decisions* — which directory, which files to
// migrate. It reads no world state: `env` and `userDataDir` are passed in, and
// the file lists are passed in as arrays of basenames. The impure edges (env
// read, `app.getPath`, fs move, real download) stay in `main.mjs`/`llm.mjs`.
// This mirrors the pure/impure split already used by `gpu.mjs`.
import path from 'node:path';

/**
 * Pure decision: pick the canonical per-user models directory.
 * `env.VOID_MODELS_DIR` overrides when it is a non-empty (non-whitespace)
 * string; otherwise default to `path.join(userDataDir, 'models')`.
 * No I/O, no env read of its own — everything is injected.
 * @param {{ env: Record<string,string|undefined>, userDataDir: string }} opts
 * @returns {string} the resolved models directory
 */
export function resolveModelDir({ env, userDataDir }) {
  const override = env?.VOID_MODELS_DIR;
  if (typeof override === 'string' && override.trim() !== '') return override;
  return path.join(userDataDir, 'models');
}

/**
 * Pure decision: which legacy files should be moved into the canonical dir.
 * Returns the basenames in `legacyFiles` that end in `.gguf` (case-insensitive)
 * and are NOT already present (by exact basename) in `canonicalFiles`. Legacy
 * input order is preserved; non-gguf entries are ignored. No fs — array in,
 * array out.
 * @param {string[]} legacyFiles basenames found in the legacy `./models` dir
 * @param {string[]} canonicalFiles basenames already in the canonical dir
 * @returns {string[]} basenames to migrate, in legacy order
 */
export function filesToMigrate(legacyFiles, canonicalFiles) {
  const present = new Set(canonicalFiles ?? []);
  return (legacyFiles ?? []).filter(
    (name) => name.toLowerCase().endsWith('.gguf') && !present.has(name),
  );
}
