// THE LAYOUT PROBE'S STAND-IN FOR THE GAME'S IPC BRIDGE.
//
// The renderer's `boot()` (called by `src/desktop/main.ts`, the page's entry script) subscribes
// to `window.void.onStatus(...)`, so the real page cannot start without this object existing.
// (Until PLAN.md #6 that call sat at module scope — FINDINGS.md G51 — and the renderer could
// not be imported at all; it now can, and `boot.test.ts` drives it under jsdom. Phase C still
// boots it here because only a real Chromium computes layout.)
//
// It is deliberately the smallest thing that lets the real renderer run:
//   - `onStatus` accepts the subscription and never reports a phase, so the status line stays
//     on its boot text and nothing about the model is simulated.
//   - `generate` REJECTS. There is no model here and there never will be — CLAUDE.md is
//     explicit that tests never run real inference. Rejecting drives the renderer down its
//     own documented fallback path (`fallbackNarration`), which is the path a player on a
//     machine with a failing model gets, so the prose the probe measures is real prose the
//     game really produces rather than a fixture the probe wrote into the page itself.
//   - `log` forwards every renderer log entry to the main process, so the probe can assert
//     on the renderer's OWN instrumentation: that it recorded the viewport, and that it
//     raised no layout warning during the walk. On the old layout it would have raised one.
//
// This file ships to nobody. It is loaded only by `scripts/layout-probe.mjs`, which is only
// run by `src/dev/layoutProbe.test.ts`.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('void', {
  onStatus: () => () => {},
  generate: () => Promise.reject(new Error('layout probe: no narrator')),
  log: (entry) => {
    try {
      ipcRenderer.send('probe:log', entry);
    } catch {
      /* the main process has gone away; the walk is over */
    }
  },
});
