// In-app debug log viewer over the in-memory ring buffer. Hidden by default;
// toggle with the backtick key (`) or F2. Filter by category/text; copy all.
import { formatEntry } from '../log/logger.ts';
import type { LogEntry } from '../log/logger.ts';

/**
 * The minimum a `keydown` has to look like for the overlay to decide about it. Declared as a
 * structural type rather than `KeyboardEvent` so the decision is testable headlessly with
 * plain objects — no DOM, no jsdom dependency (the repo's standing rule).
 */
export interface OverlayKey {
  key: string;
  target: unknown;
}

/**
 * Is the keystroke going somewhere the user is TYPING? — PURE.
 *
 * G40: the overlay bound `keydown` on `window` and called `preventDefault()` for any
 * backtick, anywhere. The character-name field is an `<input>` on that same window, so a
 * player whose name contains a backtick could not type it: the key was swallowed and the
 * debug overlay opened over the game instead. The overlay's OWN filter box is an `<input>`
 * too, so it could not be typed into either.
 *
 * `SELECT` is included alongside `INPUT`/`TEXTAREA` because type-ahead selection is typing as
 * far as the user is concerned. `isContentEditable` covers any element made editable.
 */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

/**
 * Should this keystroke toggle the debug overlay? — PURE. True only for the backtick or F2,
 * and only when the user is not typing into something.
 */
export function togglesOverlay(event: OverlayKey): boolean {
  if (event.key !== '`' && event.key !== 'F2') return false;
  return !isTypingTarget(event.target);
}

/** A keydown, reduced to the three things the overlay actually touches. */
export interface OverlayKeyEvent extends OverlayKey {
  preventDefault(): void;
}

/**
 * The whole `keydown` REACTION — PURE apart from the two callbacks it is handed, and
 * therefore testable with plain object stand-ins.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE LINES IN THE LISTENER. Having the DECISION
 * (`togglesOverlay`) tested was not enough: the listener still owned the `if`, and a source
 * scan that checks which markers appear and in what ORDER cannot see the POLARITY of the `if`
 * they hang on. Flipping `if (!togglesOverlay(ev))` to `if (togglesOverlay(ev))` left every
 * marker in place and every assertion green — while making a backtick on the body do nothing
 * and making EVERY character typed into the name field call `preventDefault()` and toggle the
 * panel. The field becomes untypable and the overlay flickers on every keystroke: strictly
 * worse than the G40 this all started as.
 *
 * With the action in here, that mutation is a behavioural failure rather than a spelling the
 * regex happened not to match, and no future re-spelling of the listener can hide it.
 */
export function handleOverlayKey(event: OverlayKeyEvent, toggle: () => void): void {
  if (!togglesOverlay(event)) return;
  event.preventDefault();
  toggle();
}

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

  // G40: the whole reaction — the decision, the `preventDefault` and the toggle — lives in
  // the pure `handleOverlayKey`, so all three are tested rather than only the first. The
  // listener is now nothing but the wire from the browser to that function, which is the
  // smallest thing that can go wrong here.
  window.addEventListener('keydown', (ev) => handleOverlayKey(ev, toggle));
  filter.addEventListener('input', render);
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(getEntries().map(formatEntry).join('\n'));
  });
}
