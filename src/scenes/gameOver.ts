// Game-over scene (terminal): shows the final standing and the log tail. Restart begins
// a fresh run at the title screen (the save was already cleared when game-over was
// reached, so the fresh title correctly offers no Continue).

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { Rect } from '../render/layout.ts';
import { frame, bottomButtons, logRegion } from './common.ts';
import { addHeader, COLORS, FONT, TEXT, SPACING } from '../render/ui/index.ts';

export const GAME_OVER_SCENE = 'game-over';

export function registerGameOverScene(k: Engine, driver: GameDriver): void {
  k.scene(GAME_OVER_SCENE, () => {
    const content = frame();
    const below = addHeader(k, content, 'Game over', 'The Void keeps what it takes.');

    const player = driver.state.player;
    if (player) {
      const danger = COLORS.danger;
      k.add([
        k.text(`Final XP: ${player.xp}`, { size: TEXT.body, font: FONT, width: content.w }),
        k.pos(content.x, below),
        k.color(danger[0], danger[1], danger[2]),
      ]);
    }

    const buttonsTop = bottomButtons(k, content, [
      { label: 'Restart', onClick: () => driver.restart() },
    ]);

    const logTop = below + TEXT.body + SPACING.md;
    const logRect: Rect = {
      x: content.x,
      y: logTop,
      w: content.w,
      h: Math.max(0, buttonsTop - SPACING.md - logTop),
    };
    logRegion(k, logRect, driver.log);
  });
}
