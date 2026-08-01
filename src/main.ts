// Entry point. Boots the portrait Kaplay renderer, creates the driver over a fresh
// seeded run backed by the browser localStorage save adapter, registers every scene,
// and shows the title.
//
// The New-Game seed is taken from the wall clock HERE, in the render layer — this is
// allowed: the RNG ban (no Date.now / Math.random) applies only to src/game, and
// createGame stores the seed as plain data so the run stays reproducible from it.
// Save/load is wired: the driver persists at checkpoints via the injected SaveStorage,
// and the title screen offers Continue when a valid save exists (driver.resume()).
import { createEngine } from './render/engine.ts';
import { GameDriver } from './render/driver.ts';
import { createGame } from './game/game.ts';
import { createLocalStorageSaveStorage } from './storage/localStorage.ts';
import { registerAllScenes } from './scenes/index.ts';

const k = createEngine();
const driver = new GameDriver(k, createGame(Date.now() >>> 0), createLocalStorageSaveStorage());
registerAllScenes(k, driver);
driver.boot();
