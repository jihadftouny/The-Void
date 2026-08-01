// Ending scene: shows the ending narration (in the log) and a Continue that closes
// out the run -> dispatch {kind:'continue'} (the controller advances to game-over).

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { Rect } from '../render/layout.ts';
import { frame, bottomButtons, logRegion } from './common.ts';
import { addHeader, SPACING } from '../render/ui/index.ts';

export const ENDING_SCENE = 'ending';

export function registerEndingScene(k: Engine, driver: GameDriver): void {
  k.scene(ENDING_SCENE, () => {
    const content = frame();
    const below = addHeader(k, content, 'The Void yields', 'You have reached the end.');

    const buttonsTop = bottomButtons(k, content, [
      { label: 'Continue', onClick: () => driver.dispatch({ kind: 'continue' }) },
    ]);

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
