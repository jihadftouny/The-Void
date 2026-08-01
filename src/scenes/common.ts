// Shared scene scaffolding (Kaplay): the safe-area content frame, a bottom-anchored
// button stack, a plain body-text block, and a log region. Every scene composes these
// so layout stays consistent and mobile-safe. No game logic lives here — scenes read
// `driver.state`/`driver.log` and dispatch inputs; these helpers only place widgets.

import type { Engine } from '../render/engine.ts';
import type { GameObj } from 'kaplay';
import type { Rect } from '../render/layout.ts';
import { contentRect, stackButtons, BUTTON_HEIGHT, GAP } from '../render/layout.ts';
import {
  addButton,
  addLog,
  readSafeAreaInsets,
  COLORS,
  FONT,
  TEXT,
  SPACING,
  type LogHandle,
} from '../render/ui/index.ts';

/** The drawable content rect for a scene: canvas minus safe-area insets minus edge. */
export function frame(): Rect {
  const insets = readSafeAreaInsets();
  const edge = SPACING.edge;
  return contentRect({
    top: insets.top + edge,
    bottom: insets.bottom + edge,
    left: insets.left + edge,
    right: insets.right + edge,
  });
}

export interface ButtonSpec {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Lay out `specs` as a full-width vertical button stack anchored to the BOTTOM of
 * `content`. Returns the top y of the block so callers can size content above it.
 */
export function bottomButtons(k: Engine, content: Rect, specs: ButtonSpec[]): number {
  const n = specs.length;
  if (n === 0) return content.y + content.h;
  const total = n * BUTTON_HEIGHT + (n - 1) * GAP;
  const startY = content.y + content.h - total;
  const rects = stackButtons(
    { x: content.x, y: startY, w: content.w, h: total },
    n,
    BUTTON_HEIGHT,
    GAP,
  );
  specs.forEach((spec, i) => {
    addButton(k, {
      rect: rects[i]!,
      label: spec.label,
      onClick: spec.onClick,
      ...(spec.disabled !== undefined ? { disabled: spec.disabled } : {}),
    });
  });
  return startY;
}

/** Draw a wrapped body-text paragraph at `rect` and return its bottom y. */
export function bodyText(
  k: Engine,
  rect: Rect,
  content: string,
  color = COLORS.text,
  size = TEXT.body,
): number {
  const obj: GameObj = k.add([
    k.text(content, { size, font: FONT, width: rect.w, align: 'left', lineSpacing: 6 }),
    k.pos(rect.x, rect.y),
    k.color(color[0], color[1], color[2]),
  ]);
  return rect.y + obj.height + SPACING.md;
}

/** Add a scrolling log filling `rect`, populated with the tail of `lines`. */
export function logRegion(
  k: Engine,
  rect: Rect,
  lines: readonly string[],
  maxLines = 200,
): LogHandle {
  const handle = addLog(k, rect);
  handle.setLines(lines.slice(-maxLines));
  return handle;
}
