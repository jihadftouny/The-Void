// Name-entry scene: an HTML <input> overlay (opens the mobile keyboard) plus a Begin
// button. Submitting dispatches {kind:'name'}; an empty name falls back to "Nameless".

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { Rect } from '../render/layout.ts';
import { BUTTON_HEIGHT } from '../render/layout.ts';
import { frame, bottomButtons } from './common.ts';
import { addHeader, showTextInput, SPACING } from '../render/ui/index.ts';

export const NAME_ENTRY_SCENE = 'name-entry';

export function registerNameEntryScene(k: Engine, driver: GameDriver): void {
  k.scene(NAME_ENTRY_SCENE, () => {
    const content = frame();
    const below = addHeader(k, content, 'Who are you?', 'Name the one who descends.');

    const inputRect: Rect = {
      x: content.x,
      y: below + SPACING.md,
      w: content.w,
      h: BUTTON_HEIGHT,
    };

    const handle = showTextInput({
      rect: inputRect,
      placeholder: 'Enter your name',
      maxLength: 24,
      onSubmit: (value) => {
        driver.dispatch({ kind: 'name', name: value.length > 0 ? value : 'Nameless' });
      },
    });

    // Remove a stray overlay if we leave this scene by any other path.
    k.onSceneLeave(() => handle.cleanup());

    bottomButtons(k, content, [{ label: 'Begin', onClick: () => handle.submit() }]);
  });
}
