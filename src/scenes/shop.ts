// Shop scene: the mysterious stranger's offer (item, kind) against the player's current
// gear. Take / Decline -> dispatch {kind:'shop-decision'}. INTERIM (gold removed in M7);
// Stage 4 replaces this scene with the sacrifice-deal scene.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import { frame, bottomButtons, bodyText } from './common.ts';
import { addHeader, COLORS, SPACING } from '../render/ui/index.ts';
import { equippedDefId } from '../game/equipment.ts';

export const SHOP_SCENE = 'shop';

export function registerShopScene(k: Engine, driver: GameDriver): void {
  k.scene(SHOP_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'shop') return;
    const offer = phase.offer;
    const player = driver.state.player;

    const content = frame();
    const below = addHeader(k, content, 'A mysterious stranger', 'Wares from the dark.');

    const currentId =
      player === null
        ? '—'
        : equippedDefId(player.inventory, offer.itemKind === 'armor' ? 'armor' : 'mainHand') ??
          '—';

    const region = { x: content.x, y: below + SPACING.sm, w: content.w, h: content.h };
    bodyText(
      k,
      region,
      [
        `Offer: ${offer.itemName}`,
        `Kind: ${offer.itemKind}`,
        `Your ${offer.itemKind}: ${currentId}`,
      ].join('\n'),
      COLORS.text,
    );

    bottomButtons(k, content, [
      { label: 'Take', onClick: () => driver.dispatch({ kind: 'shop-decision', accept: true }) },
      { label: 'Decline', onClick: () => driver.dispatch({ kind: 'shop-decision', accept: false }) },
    ]);
  });
}
