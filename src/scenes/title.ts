// Title scene — the first thing a player sees. "New Game" starts a fresh run through
// the pure controller; "Continue" is shown ONLY when a valid save exists and resumes
// that persisted run.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import { frame, bottomButtons } from './common.ts';
import { COLORS, FONT, TEXT } from '../render/ui/index.ts';

export const TITLE_SCENE = 'title';

export function registerTitleScene(k: Engine, driver: GameDriver): void {
  k.scene(TITLE_SCENE, () => {
    const content = frame();
    const cx = content.x + content.w / 2;

    const accent = COLORS.accent;
    k.add([
      k.text('THE VOID', { size: TEXT.title, font: FONT, width: content.w, align: 'center' }),
      k.pos(cx, content.y + content.h * 0.26),
      k.anchor('center'),
      k.color(accent[0], accent[1], accent[2]),
    ]);
    const dim = COLORS.dim;
    k.add([
      k.text('A descent in five acts', {
        size: TEXT.body,
        font: FONT,
        width: content.w,
        align: 'center',
      }),
      k.pos(cx, content.y + content.h * 0.26 + TEXT.title),
      k.anchor('center'),
      k.color(dim[0], dim[1], dim[2]),
    ]);

    // Continue appears only when a valid save exists — an absent/invalid save shows
    // just New Game (no dead, disabled button).
    const canContinue = driver.savedGameAvailable();
    const buttons = [
      { label: 'New Game', onClick: () => driver.dispatch({ kind: 'continue' }) },
    ];
    if (canContinue) {
      buttons.push({ label: 'Continue', onClick: () => driver.resume() });
    }
    bottomButtons(k, content, buttons);
  });
}
