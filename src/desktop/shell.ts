// N1 desktop shell renderer — a minimal DOM streaming view that proves the
// end-to-end path: window → IPC → main process → local 4B model → streamed text.
// This is NOT the game UI (that's N7); it's the milestone's proof of life.

interface GenerateStats {
  text: string;
  tokens: number;
  tokensPerSecond: number;
  ttftMs: number;
}
interface VoidApi {
  onStatus(cb: (s: { phase: string; gpu?: unknown; message?: string }) => void): () => void;
  generate(opts: {
    prompt: string;
    system?: string;
    onToken?: (chunk: string) => void;
  }): Promise<GenerateStats>;
}
declare global {
  interface Window {
    void: VoidApi;
  }
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const statusEl = $<HTMLParagraphElement>('status');
const outputEl = $<HTMLElement>('output');
const promptEl = $<HTMLInputElement>('prompt');
const goEl = $<HTMLButtonElement>('go');
const statsEl = $<HTMLSpanElement>('stats');

let ready = false;

window.void.onStatus((s) => {
  if (s.phase === 'resolving') statusEl.textContent = 'locating model…';
  else if (s.phase === 'loading') statusEl.textContent = 'loading model into memory…';
  else if (s.phase === 'ready') {
    ready = true;
    goEl.disabled = false;
    statusEl.textContent = `ready — ${s.gpu ? `GPU (${String(s.gpu)})` : 'CPU'}`;
  } else if (s.phase === 'error') {
    statusEl.textContent = `error: ${s.message ?? 'unknown'}`;
    statusEl.classList.add('error');
  }
});

async function descend(): Promise<void> {
  if (!ready) return;
  goEl.disabled = true;
  statsEl.textContent = '';
  outputEl.textContent = '';
  try {
    const stats = await window.void.generate({
      prompt: promptEl.value,
      onToken: (chunk) => {
        outputEl.textContent += chunk;
        outputEl.scrollTop = outputEl.scrollHeight;
      },
    });
    statsEl.textContent = `${stats.tokens} tokens · ${stats.tokensPerSecond.toFixed(
      1,
    )} tok/s · first word ${stats.ttftMs.toFixed(0)}ms`;
  } catch (err) {
    outputEl.textContent = `\n[generation failed: ${
      err instanceof Error ? err.message : String(err)
    }]`;
  } finally {
    goEl.disabled = false;
  }
}

goEl.addEventListener('click', () => void descend());
promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void descend();
});

export {};
