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

// Clock seam — so the file this lives in never hard-codes Date.now() in a way
// tests can't control, and so timestamps are injectable in unit tests.
let nowMs: () => number = () => Date.now();
export function setClock(fn: () => number): void {
  nowMs = fn;
}

export class Logger {
  private sinks: LogSink[] = [];
  private minRank = RANK.debug;

  setLevel(level: LogLevel): void {
    this.minRank = RANK[level];
  }

  /** Register a sink; returns an unsubscribe function. */
  addSink(sink: LogSink): () => void {
    this.sinks.push(sink);
    return () => {
      this.sinks = this.sinks.filter((s) => s !== sink);
    };
  }

  log(level: LogLevel, category: string, message: string, data?: unknown): void {
    if (RANK[level] < this.minRank) return;
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
