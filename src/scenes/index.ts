// Registers every scene against the Kaplay engine, wired to the shared driver. The
// scene ids match the SceneId union in render/routing.ts (that mapping is verified by
// routing.test.ts), so `driver.dispatch` can always navigate to a registered scene.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import { registerTitleScene } from './title.ts';
import { registerNameEntryScene } from './nameEntry.ts';
import { registerClassSelectScene } from './classSelect.ts';
import { registerStatsScene } from './stats.ts';
import { registerMainMenuScene } from './mainMenu.ts';
import { registerBattleScene } from './battle.ts';
import { registerRestScene } from './rest.ts';
import { registerShopScene } from './shop.ts';
import { registerLevelUpScene } from './levelUp.ts';
import { registerNarrativeScene } from './narrative.ts';
import { registerEndingScene } from './ending.ts';
import { registerGameOverScene } from './gameOver.ts';

/** Register all scenes. Call once at startup, before `driver.boot()`. */
export function registerAllScenes(k: Engine, driver: GameDriver): void {
  registerTitleScene(k, driver);
  registerNameEntryScene(k, driver);
  registerClassSelectScene(k, driver);
  registerStatsScene(k, driver);
  registerMainMenuScene(k, driver);
  registerBattleScene(k, driver);
  registerRestScene(k, driver);
  registerShopScene(k, driver);
  registerLevelUpScene(k, driver);
  registerNarrativeScene(k, driver);
  registerEndingScene(k, driver);
  registerGameOverScene(k, driver);
}
