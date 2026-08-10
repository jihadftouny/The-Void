// Kaplay engine bootstrap. This is the ONLY place the renderer is created.
//
// Boundary rule: everything under src/render and src/scenes may import Kaplay
// and touch the DOM/canvas. Nothing under src/game may — the logic core stays
// framework-agnostic and headlessly testable.
import kaplay, { type KAPLAYCtx } from 'kaplay';
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from './layout.ts';

export type Engine = KAPLAYCtx;

/**
 * Create the Kaplay context. Call exactly once, at startup.
 *
 * DEVIATION (recorded): the original scaffold booted landscape 960x600. The shell is
 * mobile-first (principle #5), so the virtual canvas is PORTRAIT 540x1080 (from
 * `layout.ts`, the single source of the responsive math), letterboxed to fit any
 * device. Every scene is authored against these virtual units.
 */
export function createEngine(): Engine {
  return kaplay({
    width: VIRTUAL_WIDTH,
    height: VIRTUAL_HEIGHT,
    letterbox: true,
    background: [10, 10, 12], // #0a0a0c — The Void's near-black
    pixelDensity: Math.min(window.devicePixelRatio || 1, 2),
    crisp: true,
  });
}
