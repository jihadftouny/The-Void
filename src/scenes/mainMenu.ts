// Main-menu scene: the hub between encounters. Shows the player's standing and the
// recent log, then Descend / Shop & Character / Quit -> dispatch {kind:'menu'}.
// Note: 'character-info' opens the shop-then-info bundle (the only path to the shop).

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { Rect } from '../render/layout.ts';
import { frame, bottomButtons, logRegion } from './common.ts';
import { hpText } from '../render/format.ts';
import { addHeader, SPACING, COLORS, FONT, TEXT } from '../render/ui/index.ts';

export const MAIN_MENU_SCENE = 'main-menu';

export function registerMainMenuScene(k: Engine, driver: GameDriver): void {
  k.scene(MAIN_MENU_SCENE, () => {
    const content = frame();
    const player = driver.state.player;
    const subtitle = player
      ? `${player.name} the ${player.classId} — Act ${driver.state.act}`
      : `Act ${driver.state.act}`;
    const below = addHeader(k, content, 'The Void', subtitle);

    if (player) {
      const stat = COLORS.dim;
      const line = `HP ${hpText(player.hp, player.maxHp)}   XP ${player.xp}   Rests ${player.restsLeft}   Potions ${player.pots}`;
      k.add([
        k.text(line, { size: TEXT.small, font: FONT, width: content.w, align: 'left' }),
        k.pos(content.x, below),
        k.color(stat[0], stat[1], stat[2]),
      ]);
    }

    const buttonsTop = bottomButtons(k, content, [
      { label: 'Descend', onClick: () => driver.dispatch({ kind: 'menu', choice: 'continue' }) },
      {
        label: 'Shop & Character',
        onClick: () => driver.dispatch({ kind: 'menu', choice: 'character-info' }),
      },
      { label: 'Quit', onClick: () => driver.dispatch({ kind: 'menu', choice: 'quit' }) },
    ]);

    const logTop = below + TEXT.small + SPACING.md;
    const logRect: Rect = {
      x: content.x,
      y: logTop,
      w: content.w,
      h: Math.max(0, buttonsTop - SPACING.md - logTop),
    };
    logRegion(k, logRect, driver.log);
  });
}
