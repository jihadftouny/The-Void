// Level-up scene: the six attributes as a tappable grid. Two picks are collected
// (the SAME attribute may be picked twice for +2, faithful to the Java source), then
// dispatched as {kind:'level-up-picks'}. The pure controller applies the raise.

import type { Engine } from '../render/engine.ts';
import type { GameObj } from 'kaplay';
import type { GameDriver } from '../render/driver.ts';
import { STAT_KEYS, type StatKey } from '../game/character.ts';
import { BUTTON_HEIGHT, GAP } from '../render/layout.ts';
import { frame, bottomButtons } from './common.ts';
import { addButton, addHeader, COLORS, FONT, TEXT, SPACING } from '../render/ui/index.ts';

export const LEVEL_UP_SCENE = 'level-up';

export function registerLevelUpScene(k: Engine, driver: GameDriver): void {
  k.scene(LEVEL_UP_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'level-up') return;
    const player = driver.state.player;

    const content = frame();
    const below = addHeader(k, content, 'Level up', 'Choose two raises (you may pick one twice).');

    const picks: StatKey[] = [];
    const statusColor = COLORS.accent;
    const status: GameObj = k.add([
      k.text('Selected: —', { size: TEXT.body, font: FONT, width: content.w }),
      k.pos(content.x, below),
      k.color(statusColor[0], statusColor[1], statusColor[2]),
    ]);

    const gridTop = below + TEXT.body + SPACING.md;
    const colW = (content.w - GAP) / 2;

    STAT_KEYS.forEach((key, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const rect = {
        x: content.x + col * (colW + GAP),
        y: gridTop + row * (BUTTON_HEIGHT + GAP),
        w: colW,
        h: BUTTON_HEIGHT,
      };
      const score = player ? player.stats[key] : 0;
      addButton(k, {
        rect,
        label: `${key} ${score}`,
        onClick: () => {
          if (picks.length >= 2) return;
          picks.push(key);
          status.text = `Selected: ${picks.join(', ')}`;
          if (picks.length === 2) {
            driver.dispatch({ kind: 'level-up-picks', picks: [picks[0]!, picks[1]!] });
          }
        },
      });
    });

    // A visible reset in case the player mis-taps the first pick.
    bottomButtons(k, content, [
      {
        label: 'Reset picks',
        onClick: () => {
          picks.length = 0;
          status.text = 'Selected: —';
        },
      },
    ]);
  });
}
