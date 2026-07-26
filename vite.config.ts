/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    globals: true,
    // Logic core is framework-agnostic and must be testable headlessly (node).
    // Renderer (Kaplay/canvas) code is never unit-tested here — only pure logic is.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Worktrees live inside the repo (agentic pipeline); never let Vitest walk them.
    exclude: ['worktrees/**', 'node_modules/**', 'dist/**', '.legacy/**'],
  },
});
