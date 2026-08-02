// Preload — the secure bridge. Runs in an isolated context; exposes a tiny,
// typed-by-convention `window.void` API to the renderer. CommonJS (.cjs) so it
// loads regardless of the package's "type": "module".
const { contextBridge, ipcRenderer } = require('electron');

let reqCounter = 0;

contextBridge.exposeInMainWorld('void', {
  // Subscribe to model status updates; returns an unsubscribe function.
  onStatus(cb) {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('llm:status', listener);
    return () => ipcRenderer.removeListener('llm:status', listener);
  },
  // Stream a generation. `onToken(chunk)` fires per token; resolves with stats.
  generate({ prompt, system, onToken }) {
    const requestId = ++reqCounter;
    const listener = (_e, msg) => {
      if (msg.requestId === requestId) onToken?.(msg.chunk);
    };
    ipcRenderer.on('llm:token', listener);
    return ipcRenderer
      .invoke('llm:generate', { requestId, prompt, system })
      .finally(() => ipcRenderer.removeListener('llm:token', listener));
  },
});
