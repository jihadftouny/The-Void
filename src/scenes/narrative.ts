// Shared narrative scene for the "continue" phases: battle-victory, act-outro,
// level-up-result, act-intro. Renders the recent log and a single Continue button ->
// dispatch {kind:'continue'}.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { Rect } from '../render/layout.ts';
import { frame, bottomButtons, logRegion } from './common.ts';
import { addHeader, SPACING } from '../render/ui/index.ts';

export const NARRATIVE_SCENE = 'narrative';

const TITLES: Record<string, string> = {
  'battle-victory': 'Victory',
  'act-outro': 'An act ends',
  'level-up-result': 'You grow stronger',
  'act-intro': 'A new act',
};

export function registerNarrativeScene(k: Engine, driver: GameDriver): void {
  k.scene(NARRATIVE_SCENE, () => {
    const content = frame();
    const title = TITLES[driver.state.phase.kind] ?? 'The Void';
    const below = addHeader(k, content, title);

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
