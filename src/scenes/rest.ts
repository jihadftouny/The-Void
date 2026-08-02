// Rest scene: shows the lore/rest log. If a rest is offered, Rest / Skip ->
// {kind:'rest-decision'}; otherwise a single Continue -> {kind:'continue'}.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { Rect } from '../render/layout.ts';
import { frame, bottomButtons, logRegion } from './common.ts';
import { addHeader, SPACING } from '../render/ui/index.ts';

export const REST_SCENE = 'rest';

export function registerRestScene(k: Engine, driver: GameDriver): void {
  k.scene(REST_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'rest') return;

    const content = frame();
    const below = addHeader(k, content, 'A quiet moment', 'The Void murmurs.');

    const specs = phase.restOffered
      ? [
          { label: 'Rest', onClick: () => driver.dispatch({ kind: 'rest-decision', accept: true }) },
          { label: 'Press on', onClick: () => driver.dispatch({ kind: 'rest-decision', accept: false }) },
        ]
      : [{ label: 'Continue', onClick: () => driver.dispatch({ kind: 'continue' }) }];
    const buttonsTop = bottomButtons(k, content, specs);

    const logTop = below + SPACING.sm;
    const logRect: Rect = {
      x: content.x,
      y: logTop,
      w: content.w,
      h: Math.max(0, buttonsTop - SPACING.md - logTop),
    };
    logRegion(k, logRect, driver.log);
  });
}
