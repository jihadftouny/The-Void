// Shop scene: the mysterious stranger's offer (item, kind, price) against the
// player's current gear and gold. Buy / Decline -> dispatch {kind:'shop-decision'}.

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
    const gold = player?.gold ?? 0;
    const canAfford = gold >= offer.price;

    const region = { x: content.x, y: below + SPACING.sm, w: content.w, h: content.h };
    bodyText(
      k,
      region,
      [
        `Offer: ${offer.itemName}`,
        `Kind: ${offer.itemKind}`,
        `Price: ${offer.price} gold`,
        `Your ${offer.itemKind}: ${currentId}`,
        `Your gold: ${gold}${canAfford ? '' : '  (not enough)'}`,
      ].join('\n'),
      canAfford ? COLORS.text : COLORS.dim,
    );

    bottomButtons(k, content, [
      {
        label: 'Buy',
        onClick: () => driver.dispatch({ kind: 'shop-decision', accept: true }),
        disabled: !canAfford,
      },
      { label: 'Decline', onClick: () => driver.dispatch({ kind: 'shop-decision', accept: false }) },
    ]);
  });
}
