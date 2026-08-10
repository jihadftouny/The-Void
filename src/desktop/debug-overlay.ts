// In-app debug log viewer over the in-memory ring buffer. Hidden by default;
// toggle with the backtick key (`) or F2. Filter by category/text; copy all.
import { formatEntry } from '../log/logger.ts';
import type { LogEntry } from '../log/logger.ts';

export function createDebugOverlay(getEntries: () => LogEntry[]): void {
  const panel = document.createElement('div');
  panel.id = 'debug-overlay';
  panel.style.cssText =
    'position:fixed;right:0;top:0;width:46%;height:100%;z-index:9999;display:none;' +
    'background:rgba(6,6,9,0.96);color:#bfe;border-left:1px solid #333;padding:8px;' +
    'font:12px/1.5 ui-monospace,monospace;box-sizing:border-box;';

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
  const filter = document.createElement('input');
  filter.placeholder = 'filter by category or text';
  filter.style.cssText = 'flex:1;background:#111;border:1px solid #333;color:#bfe;padding:4px;';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'copy all';
  copyBtn.style.cssText = 'background:#222;border:1px solid #444;color:#bfe;padding:4px 8px;cursor:pointer;';
  bar.append(filter, copyBtn);

  const list = document.createElement('pre');
  list.style.cssText = 'margin:0;height:calc(100% - 36px);overflow:auto;white-space:pre-wrap;';
  panel.append(bar, list);
  document.body.appendChild(panel);

  const linesFor = (): LogEntry[] => {
    const q = filter.value.trim().toLowerCase();
    return getEntries().filter(
      (e) => !q || e.category.toLowerCase().includes(q) || e.message.toLowerCase().includes(q),
    );
  };
  const render = (): void => {
    list.textContent = linesFor().map(formatEntry).join('\n');
    list.scrollTop = list.scrollHeight;
  };

  let timer: number | undefined;
  const toggle = (): void => {
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) {
      render();
      timer = window.setInterval(render, 500);
    } else if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  window.addEventListener('keydown', (ev) => {
    if (ev.key === '`' || ev.key === 'F2') {
      ev.preventDefault();
      toggle();
    }
  });
  filter.addEventListener('input', render);
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(getEntries().map(formatEntry).join('\n'));
  });
}
