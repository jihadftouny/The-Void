// Entry point. Boots the renderer, registers scenes, and starts the game.
import { createEngine } from './render/engine.ts';
import { registerTitleScene, TITLE_SCENE } from './scenes/title.ts';

const k = createEngine();
registerTitleScene(k);
k.go(TITLE_SCENE);
