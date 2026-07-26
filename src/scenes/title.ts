// Title scene — the first thing a player sees. Placeholder for the port;
// the real UX (terminal vs. visual) is defined during the scoped build.
import type { Engine } from '../render/engine.ts';

export const TITLE_SCENE = 'title';

export function registerTitleScene(k: Engine): void {
  k.scene(TITLE_SCENE, () => {
    k.add([
      k.text('THE VOID', { size: 72, font: 'monospace' }),
      k.pos(k.center().x, k.center().y - 40),
      k.anchor('center'),
      k.color(230, 230, 235),
    ]);
    k.add([
      k.text('A Text RPG by Jihanger', { size: 22, font: 'monospace' }),
      k.pos(k.center().x, k.center().y + 30),
      k.anchor('center'),
      k.color(120, 120, 130),
    ]);
    k.add([
      k.text('vAlpha — press anywhere to begin', { size: 16, font: 'monospace' }),
      k.pos(k.center().x, k.height() - 48),
      k.anchor('center'),
      k.color(90, 90, 100),
    ]);
  });
}
