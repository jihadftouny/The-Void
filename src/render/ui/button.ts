// Tappable button widget for the UI shell (Kaplay). Height comes from the shared
// layout constant so the >=44px touch-target guarantee (verified in layout.test.ts)
// holds on the smallest supported phone.

import type { Engine } from '../engine.ts';
import type { GameObj } from 'kaplay';
import type { Rect } from '../layout.ts';
import { COLORS, FONT, TEXT, SPACING } from './theme.ts';

export interface ButtonOpts {
  /** Placement + size in virtual units (usually from `stackButtons`). */
  rect: Rect;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Add a button: a rounded rect with a centered, wrapped label and hover/press
 * feedback. A disabled button is dimmed and ignores taps. Returns the container
 * object so callers can destroy or re-style it.
 */
export function addButton(k: Engine, opts: ButtonOpts): GameObj {
  const { rect, label, onClick } = opts;
  const disabled = opts.disabled ?? false;
  const baseFill = disabled ? COLORS.buttonFillDisabled : COLORS.buttonFill;

  const btn = k.add([
    k.rect(rect.w, rect.h, { radius: 10 }),
    k.pos(rect.x, rect.y),
    k.color(baseFill[0], baseFill[1], baseFill[2]),
    k.outline(2, k.rgb(COLORS.buttonBorder[0], COLORS.buttonBorder[1], COLORS.buttonBorder[2])),
    k.area(),
    'ui-button',
  ]);

  const labelColor = disabled ? COLORS.dim : COLORS.text;
  btn.add([
    k.text(label, {
      size: TEXT.button,
      font: FONT,
      width: rect.w - SPACING.md * 2,
      align: 'center',
    }),
    k.pos(rect.w / 2, rect.h / 2),
    k.anchor('center'),
    k.color(labelColor[0], labelColor[1], labelColor[2]),
  ]);

  if (!disabled) {
    btn.onClick(onClick);
    btn.onUpdate(() => {
      const active = btn.isHovering() && k.isMouseDown();
      const fill = active
        ? COLORS.buttonFillPressed
        : btn.isHovering()
          ? COLORS.buttonFillPressed
          : COLORS.buttonFill;
      btn.color = k.rgb(fill[0], fill[1], fill[2]);
    });
  }

  return btn;
}
