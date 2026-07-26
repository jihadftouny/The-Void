// Kaplay engine bootstrap. This is the ONLY place the renderer is created.
//
// Boundary rule: everything under src/render and src/scenes may import Kaplay
// and touch the DOM/canvas. Nothing under src/game may — the logic core stays
// framework-agnostic and headlessly testable.
import kaplay, { type KAPLAYCtx } from 'kaplay';

export type Engine = KAPLAYCtx;

/** Create the Kaplay context. Call exactly once, at startup. */
export function createEngine(): Engine {
  return kaplay({
    width: 960,
    height: 600,
    letterbox: true,
    background: [10, 10, 12], // #0a0a0c — The Void's near-black
    pixelDensity: Math.min(window.devicePixelRatio || 1, 2),
    crisp: true,
  });
}
