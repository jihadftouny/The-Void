// HTML <input> overlay (Kaplay + DOM): a temporary real text field positioned over
// the canvas so the mobile keyboard opens for name entry. Kaplay has no native text
// input; DOM in the render layer is allowed for exactly this. The overlay is removed
// on submit or blur. Styling/safe-area come from index.html's `.void-input` rule.

import type { Rect } from '../layout.ts';
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT, scale } from '../layout.ts';

export interface TextInputOpts {
  /** Where to place the field, in virtual units. */
  rect: Rect;
  placeholder?: string;
  initial?: string;
  maxLength?: number;
  /** Called with the trimmed value on Enter or blur. */
  onSubmit: (value: string) => void;
}

/** Map a virtual rect to CSS-pixel window coordinates over the letterboxed canvas. */
function toWindowPx(rect: Rect): { left: number; top: number; width: number; height: number } {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const s = scale(vp);
  const barX = Math.max(0, (vp.w - VIRTUAL_WIDTH * s) / 2);
  const barY = Math.max(0, (vp.h - VIRTUAL_HEIGHT * s) / 2);
  return {
    left: barX + rect.x * s,
    top: barY + rect.y * s,
    width: rect.w * s,
    height: rect.h * s,
  };
}

/**
 * Show the overlay input. Returns a cleanup function that removes it (idempotent).
 * `onSubmit` fires exactly once, then the field is removed.
 */
export function showTextInput(opts: TextInputOpts): () => void {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'void-input';
  input.value = opts.initial ?? '';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.maxLength = opts.maxLength ?? 24;
  input.autocomplete = 'off';

  const px = toWindowPx(opts.rect);
  input.style.left = `${px.left}px`;
  input.style.top = `${px.top}px`;
  input.style.width = `${px.width}px`;
  input.style.height = `${px.height}px`;

  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    input.remove();
  };
  const submit = (): void => {
    if (done) return;
    const value = input.value.trim();
    cleanup();
    opts.onSubmit(value);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  input.addEventListener('blur', submit);

  document.body.appendChild(input);
  // Focus on the next frame so the browser reliably opens the keyboard.
  requestAnimationFrame(() => input.focus());

  return cleanup;
}
