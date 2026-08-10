// Level-up scene (M9): a minimal, functional 3-button draft picker. It reads the pending
// offers from the `level-up-draft` phase, labels each via `describeDraftOption`, and
// dispatches {kind:'draft-pick', index}. The pure controller applies the pick. POLISH of the
// option cards / readability is a NEEDS-HUMAN render follow-up.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import { describeDraftOption } from '../game/draft.ts';
import { BUTTON_HEIGHT, GAP } from '../render/layout.ts';
import { frame } from './common.ts';
import { addButton, addHeader, SPACING, TEXT } from '../render/ui/index.ts';

export const LEVEL_UP_SCENE = 'level-up';

export function registerLevelUpScene(k: Engine, driver: GameDriver): void {
  k.scene(LEVEL_UP_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'level-up-draft') return;

    const content = frame();
    const below = addHeader(k, content, 'Level up', 'Choose one to carry forward.');

    const top = below + TEXT.body + SPACING.md;
    phase.offers.forEach((offer, i) => {
      const rect = {
        x: content.x,
        y: top + i * (BUTTON_HEIGHT + GAP),
        w: content.w,
        h: BUTTON_HEIGHT,
      };
      addButton(k, {
        rect,
        label: describeDraftOption(offer),
        onClick: () => driver.dispatch({ kind: 'draft-pick', index: i }),
      });
    });
  });
}
