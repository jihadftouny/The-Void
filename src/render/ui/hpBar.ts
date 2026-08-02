// HP bar widget (Kaplay): a label, the "hp/maxHp" numeric readout, and a thin fill
// bar. The fill fraction comes from the pure `hpFraction` and the numeric from the
// pure `hpText` — this widget renders already-computed values, it applies no rule.

import type { Engine } from '../engine.ts';
import type { Rect } from '../layout.ts';
import { hpFraction } from '../layout.ts';
import { hpText } from '../format.ts';
import { COLORS, FONT, TEXT, SPACING, type Rgb } from './theme.ts';

export interface HpBarOpts {
  /** x, y, w in virtual units (h is ignored — the widget sizes itself). */
  bounds: Rect;
  label: string;
  hp: number;
  maxHp: number;
  /** Fill color (e.g. COLORS.good for the player, COLORS.danger for the enemy). */
  fill: Rgb;
}

const BAR_H = 14;

/** Draw an HP bar and return the y just below it (virtual units). */
export function addHpBar(k: Engine, opts: HpBarOpts): number {
  const { bounds, label, hp, maxHp, fill } = opts;
  const text = COLORS.text;

  k.add([
    k.text(`${label}  ${hpText(hp, maxHp)}`, { size: TEXT.small, font: FONT }),
    k.pos(bounds.x, bounds.y),
    k.color(text[0], text[1], text[2]),
  ]);

  const barY = bounds.y + TEXT.small + SPACING.xs;
  const track = COLORS.panel;
  k.add([
    k.rect(bounds.w, BAR_H, { radius: 4 }),
    k.pos(bounds.x, barY),
    k.color(track[0], track[1], track[2]),
    k.outline(1, k.rgb(COLORS.divider[0], COLORS.divider[1], COLORS.divider[2])),
  ]);

  const frac = hpFraction(hp, maxHp);
  const fillW = Math.max(0, bounds.w * frac);
  if (fillW > 0) {
    k.add([
      k.rect(fillW, BAR_H, { radius: 4 }),
      k.pos(bounds.x, barY),
      k.color(fill[0], fill[1], fill[2]),
    ]);
  }

  return barY + BAR_H + SPACING.sm;
}
