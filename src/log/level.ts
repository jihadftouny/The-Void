// The SHIPPED-vs-DEVELOPER log level policy for the renderer — pure, so it is decided in
// one tested function rather than by an `if` scattered through `game.ts`.
//
// WHY `location.protocol` AND NOT `import.meta.env.DEV`. `tsconfig.json`'s `types` is
// `["node","vitest/globals"]` with no `vite/client`, so `import.meta.env` is untyped and
// would fail `npm run typecheck`. And the protocol is not a PROXY for the build mode — it
// IS the build mode: `electron/main.mjs` loads `http(s)://…` from the dev server and
// `file://…` from the packaged `dist/`, so `file:` means "packaged" by construction.
//
// WHAT THE POLICY BUYS. At `info` a shipped build still records the whole boot timeline
// with durations, one line per player action with its duration, every generation's
// time-to-first-token / tokens / tokens-per-second, every storage failure and every
// recovery — and every SLOW operation, because slowness escalates to `warn`
// (`timing.ts#levelForDuration`). What `debug` adds is per-step event kinds, prompt sizes,
// per-save timings — and the player's typed name, which arrives on the `ui`/`choice`
// payload as `{kind:'name', name}`.
//
// THE NAME IS THE POINT OF THE POLICY (decided 2026-09-02, plan Q4 ruling A.4). The name
// stays in the log at `debug`: it is a character name the player typed on their own
// machine, in a developer-only file, and redacting it makes replaying a reported session
// materially worse for no real protection. The guarantee that a PACKAGED build never
// writes it to disk is this function returning `info` for `file:` — which is why
// `level.test.ts` asserts the consequence directly (an `info` logger never emits the name
// payload) instead of trusting the intention.
import type { LogLevel } from './logger.ts';

/** Every level name, in ascending severity. The single source for validating an override. */
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** True only for one of the four level names. Anything else — including `undefined`. */
export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LogLevelInputs {
  /** `location.protocol` — `'file:'` in a packaged build, `'http:'`/`'https:'` in dev. */
  protocol?: string | undefined;
  /** An explicit opt-in, e.g. `localStorage['thevoid:loglevel']`. Invalid values ignored. */
  override?: unknown;
}

/**
 * The renderer's log level. A VALID override wins over everything; otherwise `file:`
 * (packaged) is `info` and every other protocol is `debug` (developer).
 */
export function resolveLogLevel({ protocol, override }: LogLevelInputs = {}): LogLevel {
  if (isLogLevel(override)) return override;
  return protocol === 'file:' ? 'info' : 'debug';
}
