/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Single-page: `desktop.html` is the ONE front-end. M-UI2 retired the standalone
      // Kaplay build (index.html + src/main.ts + src/scenes/) — see docs/UI-DESIGN.md §8:
      // two front-ends meant every feature had to be built twice, and the second one had
      // fallen behind. Kaplay stays a dependency for the coming canvas atmosphere layer,
      // which will render INTO this page rather than owning a page of its own.
      input: {
        desktop: 'desktop.html',
      },
    },
  },
  test: {
    globals: true,
    // Logic core is framework-agnostic and must be testable headlessly (node).
    // Renderer (Kaplay/canvas) code is never unit-tested here — only pure logic is.
    environment: 'node',
    // `scripts/**/*.test.ts` covers `balance-claims.ts` — the pure claim/verdict helpers the
    // BALANCE-REPORT generator uses. Those verdicts used to be hard-coded prose beside the
    // numbers they described (FINDINGS.md G28(c)), so they need a test; `scripts/` is outside
    // `tsconfig.json`'s include set, so they are RUN here but NOT typechecked. That gap is
    // the status quo for everything under `scripts/` and is recorded, not fixed here.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'electron/**/*.test.mjs'],
    // Worktrees live inside the repo (agentic pipeline); never let Vitest walk them.
    exclude: ['worktrees/**', 'node_modules/**', 'dist/**', '.legacy/**'],
  },
});
