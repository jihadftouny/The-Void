// Scrolling terminal log region (Kaplay): shows the formatted event lines, masked to
// its bounds, with wheel + drag scrolling (clamped) and auto-scroll to the newest
// line when lines are appended. Reads already-formatted strings — no game logic.

import type { Engine } from '../engine.ts';
import type { Rect } from '../layout.ts';
import { COLORS, FONT, TEXT, SPACING } from './theme.ts';

export interface LogHandle {
  /** Replace the log contents and auto-scroll to the newest line. */
  setLines(lines: readonly string[]): void;
}

const PAD = SPACING.sm;
const LINE_SPACING = 6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Add a scrollable log panel filling `bounds` (virtual units). */
export function addLog(k: Engine, bounds: Rect): LogHandle {
  // Background panel.
  const panel = COLORS.panel;
  k.add([
    k.rect(bounds.w, bounds.h, { radius: 8 }),
    k.pos(bounds.x, bounds.y),
    k.color(panel[0], panel[1], panel[2]),
    k.outline(1, k.rgb(COLORS.divider[0], COLORS.divider[1], COLORS.divider[2])),
  ]);

  // Masked container clips the scrolling text to the panel.
  const container = k.add([
    k.rect(bounds.w, bounds.h, { fill: false }),
    k.pos(bounds.x, bounds.y),
    k.mask('intersect'),
    k.area(),
  ]);

  const text = COLORS.text;
  const textObj = container.add([
    k.text('', {
      size: TEXT.small,
      font: FONT,
      width: bounds.w - PAD * 2,
      lineSpacing: LINE_SPACING,
      align: 'left',
    }),
    k.pos(PAD, PAD),
    k.color(text[0], text[1], text[2]),
  ]);

  let scroll = 0; // pixels scrolled down from the top; 0 = top.

  const maxScroll = (): number => Math.max(0, textObj.height - (bounds.h - PAD * 2));

  const apply = (): void => {
    scroll = clamp(scroll, 0, maxScroll());
    textObj.pos.y = PAD - scroll;
  };

  // Wheel scroll while hovering the log.
  k.onScroll((delta) => {
    if (!container.isHovering()) return;
    scroll += delta.y;
    apply();
  });

  // Drag scroll (touch/mouse): start when pressed over the log.
  let dragging = false;
  k.onMousePress(() => {
    if (container.isHovering()) dragging = true;
  });
  k.onMouseRelease(() => {
    dragging = false;
  });
  k.onMouseMove((_pos, delta) => {
    if (!dragging) return;
    scroll -= delta.y;
    apply();
  });

  return {
    setLines(lines) {
      textObj.text = lines.join('\n');
      // Auto-scroll to the bottom (newest lines) after the layout updates.
      k.wait(0, () => {
        scroll = maxScroll();
        apply();
      });
    },
  };
}
