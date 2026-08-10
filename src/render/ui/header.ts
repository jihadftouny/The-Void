// Header widget: a title line with a divider rule beneath it (Kaplay).

import type { Engine } from '../engine.ts';
import type { GameObj } from 'kaplay';
import type { Rect } from '../layout.ts';
import { COLORS, FONT, TEXT, SPACING } from './theme.ts';

/**
 * Draw a header title at the top of `bounds` plus a divider rule under it. Returns
 * the divider's bottom y (virtual units) so the caller can lay out content below it.
 */
export function addHeader(k: Engine, bounds: Rect, title: string, subtitle?: string): number {
  const accent = COLORS.accent;
  const titleObj: GameObj = k.add([
    k.text(title, { size: TEXT.header, font: FONT, width: bounds.w, align: 'left' }),
    k.pos(bounds.x, bounds.y),
    k.color(accent[0], accent[1], accent[2]),
  ]);
  let y = bounds.y + titleObj.height + SPACING.xs;

  if (subtitle) {
    const dim = COLORS.dim;
    const subObj: GameObj = k.add([
      k.text(subtitle, { size: TEXT.small, font: FONT, width: bounds.w, align: 'left' }),
      k.pos(bounds.x, y),
      k.color(dim[0], dim[1], dim[2]),
    ]);
    y += subObj.height + SPACING.xs;
  }

  const rule = COLORS.divider;
  k.add([
    k.rect(bounds.w, 2),
    k.pos(bounds.x, y),
    k.color(rule[0], rule[1], rule[2]),
  ]);
  return y + 2 + SPACING.sm;
}
