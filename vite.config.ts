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
    include: ['src/**/*.test.ts', 'electron/**/*.test.mjs'],
    // Worktrees live inside the repo (agentic pipeline); never let Vitest walk them.
    exclude: ['worktrees/**', 'node_modules/**', 'dist/**', '.legacy/**'],
  },
});
