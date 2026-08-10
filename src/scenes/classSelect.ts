// Class-select scene: pick Enforcer or Neuromancer -> dispatch {kind:'class'}.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import { frame, bottomButtons, bodyText } from './common.ts';
import { addHeader, COLORS, SPACING } from '../render/ui/index.ts';

export const CLASS_SELECT_SCENE = 'class-select';

export function registerClassSelectScene(k: Engine, driver: GameDriver): void {
  k.scene(CLASS_SELECT_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'class-select') return;

    const content = frame();
    const below = addHeader(k, content, 'Choose your path', `${phase.name}, what are you?`);

    const region = { x: content.x, y: below + SPACING.sm, w: content.w, h: content.h };
    bodyText(
      k,
      region,
      'Enforcer — a hardened melee fighter (1d10 hit die).\nNeuromancer — a ranged mind-caster (1d6 hit die).',
      COLORS.dim,
    );

    bottomButtons(k, content, [
      { label: 'Enforcer', onClick: () => driver.dispatch({ kind: 'class', classId: 'Enforcer' }) },
      {
        label: 'Neuromancer',
        onClick: () => driver.dispatch({ kind: 'class', classId: 'Neuromancer' }),
      },
    ]);
  });
}
