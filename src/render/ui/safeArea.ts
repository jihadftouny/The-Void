// Safe-area handling (Kaplay + DOM): read the device's env(safe-area-inset-*) values
// and convert them into virtual units so scene content never renders under a notch or
// the home indicator. DOM access is allowed in the render layer.
//
// Letterbox correctness: the virtual canvas is drawn as a centered rect of size
// (VIRTUAL * scale) inside the window, so window-edge insets only eat into content
// where they exceed the letterbox bar on that axis. We subtract the bar, then convert
// the remaining overlap to virtual units. This is an approximation (it assumes the
// canvas is centered, which Kaplay's letterbox does); tuning is deferred to M11.

import type { Insets } from '../layout.ts';
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT, scale, cssToVirtual } from '../layout.ts';

let probe: HTMLDivElement | null = null;

/** A hidden probe whose paddings resolve the env(safe-area-inset-*) CSS values. */
function getProbe(): HTMLDivElement {
  if (probe) return probe;
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top)',
    'padding-right:env(safe-area-inset-right)',
    'padding-bottom:env(safe-area-inset-bottom)',
    'padding-left:env(safe-area-inset-left)',
  ].join(';');
  document.body.appendChild(el);
  probe = el;
  return el;
}

interface PxInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Raw safe-area insets in CSS pixels (0 on devices without notches). */
function readPxInsets(): PxInsets {
  const cs = getComputedStyle(getProbe());
  const num = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: num(cs.paddingTop),
    right: num(cs.paddingRight),
    bottom: num(cs.paddingBottom),
    left: num(cs.paddingLeft),
  };
}

/**
 * The safe-area insets in VIRTUAL units for the current window, accounting for the
 * letterbox bars. Feed the result to `contentRect(insets)`.
 */
export function readSafeAreaInsets(): Insets {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const s = scale(vp);
  if (s <= 0) return { top: 0, right: 0, bottom: 0, left: 0 };
  const barX = Math.max(0, (vp.w - VIRTUAL_WIDTH * s) / 2);
  const barY = Math.max(0, (vp.h - VIRTUAL_HEIGHT * s) / 2);
  const px = readPxInsets();
  return {
    top: cssToVirtual(Math.max(0, px.top - barY), vp),
    bottom: cssToVirtual(Math.max(0, px.bottom - barY), vp),
    left: cssToVirtual(Math.max(0, px.left - barX), vp),
    right: cssToVirtual(Math.max(0, px.right - barX), vp),
  };
}
