// Stats scene: show the rolled attribute set, then Accept or Reroll ->
// dispatch {kind:'stats-decision'}.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import { STAT_KEYS } from '../game/character.ts';
import { frame, bottomButtons } from './common.ts';
import { addHeader, COLORS, FONT, TEXT, SPACING } from '../render/ui/index.ts';

export const STATS_SCENE = 'stats-roll';

export function registerStatsScene(k: Engine, driver: GameDriver): void {
  k.scene(STATS_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'stats-roll') return;

    const content = frame();
    const below = addHeader(k, content, 'Your attributes', `${phase.name} the ${phase.classId}`);

    const rowH = TEXT.header + SPACING.sm;
    STAT_KEYS.forEach((key, i) => {
      const y = below + SPACING.sm + i * rowH;
      const label = COLORS.dim;
      k.add([
        k.text(key, { size: TEXT.header, font: FONT }),
        k.pos(content.x, y),
        k.color(label[0], label[1], label[2]),
      ]);
      const val = COLORS.text;
      k.add([
        k.text(String(phase.stats[key]), { size: TEXT.header, font: FONT, align: 'right', width: content.w }),
        k.pos(content.x, y),
        k.color(val[0], val[1], val[2]),
      ]);
    });

    bottomButtons(k, content, [
      { label: 'Accept', onClick: () => driver.dispatch({ kind: 'stats-decision', accept: true }) },
      { label: 'Reroll', onClick: () => driver.dispatch({ kind: 'stats-decision', accept: false }) },
    ]);
  });
}
