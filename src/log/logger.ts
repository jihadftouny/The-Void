// A small, framework-agnostic logging system for debugging the whole game.
//
// Design: levels + categories + pluggable "sinks" (where a log goes — console,
// an in-memory ring buffer for the on-screen overlay, or the Electron file log).
// It lives in src/log (infrastructure), NOT src/game or src/llm, so it never
// compromises the purity of the game/LLM cores — those are logged at the
// boundary (the renderer), never from inside, keeping them deterministic and
// their tests hermetic.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  time: number; // epoch milliseconds
  level: LogLevel;
  category: string; // 'engine' | 'llm' | 'ui' | 'save' | 'electron' | 'error' | ...
  message: string;
  data?: unknown; // structured payload; keep it JSON-serializable for file/IPC sinks
}

export type LogSink = (entry: LogEntry) => void;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * The default clock: an EPOCH millisecond value with sub-millisecond resolution.
 *
 * `performance.timeOrigin` is the epoch time the page/process started and
 * `performance.now()` is a monotonic offset from it, so the sum is still an epoch
 * timestamp (`formatEntry` and the Electron file sink can keep calling
 * `new Date(entry.time)` unchanged) while being (a) fractional, so a step that takes
 * 0.4 ms is not recorded as `0`, and (b) monotonic within a session, so a clock
 * correction can never make a measured duration negative. `Date.now()` is the
 * fallback for any runtime without `performance` (old Node, exotic embedders).
 *
 * Exported so its plausibility can be asserted DIRECTLY, without mutating the module's
 * clock seam — a test that called `setClock` to check the default would have to put the
 * default back, and every other test in the file would depend on that happening.
 */
export function defaultClock(): number {
  const p = (globalThis as { performance?: { timeOrigin?: number; now?: () => number } }).performance;
  if (p && typeof p.now === 'function' && typeof p.timeOrigin === 'number') {
    return p.timeOrigin + p.now();
  }
  return Date.now();
}

// Clock seam — so the file this lives in never hard-codes Date.now() in a way
// tests can't control, and so timestamps are injectable in unit tests.
//
// THIS IS THE ONLY CLOCK SEAM in `src/`. Every duration the renderer and the storage
// adapters record is measured through `now()` below (via `src/log/timing.ts`), so a test
// scripts one function and gets EXACT integers instead of a tolerance window.
let nowMs: () => number = defaultClock;
export function setClock(fn: () => number): void {
  nowMs = fn;
}

/** The current time from the injectable clock — the same one `setClock` sets. */
export function now(): number {
  return nowMs();
}

export class Logger {
  private sinks: LogSink[] = [];
  private minLevel: LogLevel = 'debug';

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** The current minimum level. Read by the boot line so a log says what it is filtering. */
  level(): LogLevel {
    return this.minLevel;
  }

  /** Register a sink; returns an unsubscribe function. */
  addSink(sink: LogSink): () => void {
    this.sinks.push(sink);
    return () => {
      this.sinks = this.sinks.filter((s) => s !== sink);
    };
  }

  log(level: LogLevel, category: string, message: string, data?: unknown): void {
    if (RANK[level] < RANK[this.minLevel]) return;
    const entry: LogEntry = {
      time: nowMs(),
      level,
      category,
      message,
      ...(data !== undefined ? { data } : {}),
    };
    for (const sink of this.sinks) {
      try {
        sink(entry);
      } catch {
        /* a broken sink must never crash the game */
      }
    }
  }

  debug(category: string, message: string, data?: unknown): void {
    this.log('debug', category, message, data);
  }
  info(category: string, message: string, data?: unknown): void {
    this.log('info', category, message, data);
  }
  warn(category: string, message: string, data?: unknown): void {
    this.log('warn', category, message, data);
  }
  error(category: string, message: string, data?: unknown): void {
    this.log('error', category, message, data);
  }
}

/** Format one entry as a single readable line (shared by console + overlay + file). */
export function formatEntry(e: LogEntry): string {
  const t = new Date(e.time).toISOString().slice(11, 23); // HH:MM:SS.mmm
  const base = `${t} ${e.level.toUpperCase().padEnd(5)} [${e.category}] ${e.message}`;
  if (e.data === undefined) return base;
  try {
    return `${base} ${JSON.stringify(e.data)}`;
  } catch {
    return `${base} [unserializable data]`;
  }
}

/** A sink that writes to the JS console, choosing the matching console method. */
export function consoleSink(entry: LogEntry): void {
  const line = formatEntry(entry);
  const fn = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log;
  fn(line);
}

/** An in-memory ring buffer sink (keeps the most recent `capacity` entries). */
export function createRingBuffer(capacity = 500): {
  sink: LogSink;
  get: () => LogEntry[];
  clear: () => void;
} {
  const entries: LogEntry[] = [];
  return {
    sink: (e) => {
      entries.push(e);
      if (entries.length > capacity) entries.shift();
    },
    get: () => entries.slice(),
    clear: () => {
      entries.length = 0;
    },
  };
}

/** Shared default logger for convenience across the app. */
export const log = new Logger();
