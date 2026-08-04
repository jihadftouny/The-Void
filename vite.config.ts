/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Multi-page: the Kaplay game (index.html) + the N1 desktop shell (desktop.html).
      input: {
        main: 'index.html',
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
