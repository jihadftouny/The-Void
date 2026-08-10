// Class-select scene: pick one of the five classes -> dispatch {kind:'class'}.
// M3 makes all five selectable with NO lock (unlock gating is M13); this scene only
// dispatches the chosen classId — the engine owns every rule.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { PlayerClass } from '../game/player.ts';
import { frame, bottomButtons, bodyText } from './common.ts';
import { addHeader, COLORS, SPACING } from '../render/ui/index.ts';

export const CLASS_SELECT_SCENE = 'class-select';

/** One-line descriptions (twist flavor), in offer order. */
const CLASS_OFFER: { classId: PlayerClass; blurb: string }[] = [
  { classId: 'Enforcer', blurb: 'Enforcer — flesh and steel; builds Momentum (1d10).' },
  { classId: 'Neuromancer', blurb: 'Neuromancer — mind and static; Detonates the psyche (1d6).' },
  { classId: 'Scavver', blurb: 'Scavver — knives and tempo; marks foes Exposed (1d8).' },
  { classId: 'Penitent', blurb: 'Penitent — devotion paid in blood; Martyr HP-as-fuel (1d8).' },
  { classId: 'Hollow', blurb: 'Hollow — the Void within; feeds on Corruption (1d8).' },
];

export function registerClassSelectScene(k: Engine, driver: GameDriver): void {
  k.scene(CLASS_SELECT_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'class-select') return;

    const content = frame();
    const below = addHeader(k, content, 'Choose your path', `${phase.name}, what are you?`);

    const region = { x: content.x, y: below + SPACING.sm, w: content.w, h: content.h };
    bodyText(k, region, CLASS_OFFER.map((c) => c.blurb).join('\n'), COLORS.dim);

    bottomButtons(
      k,
      content,
      CLASS_OFFER.map((c) => ({
        label: c.classId,
        onClick: () => driver.dispatch({ kind: 'class', classId: c.classId }),
      })),
    );
  });
}
