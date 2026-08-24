// Deal scene: the altar / shrouded stranger's sacrifice offer — a reward for a cost paid
// FROM the player. Take / Decline -> dispatch {kind:'deal-decision'}. Plain text + buttons;
// richer altar/stranger presentation is a render follow-up (NEEDS-HUMAN).

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import { frame, bottomButtons, bodyText } from './common.ts';
import { addHeader, COLORS, SPACING } from '../render/ui/index.ts';
import { canAfford, describeCost, describeReward } from '../game/deal.ts';

export const DEAL_SCENE = 'deal';

export function registerDealScene(k: Engine, driver: GameDriver): void {
  k.scene(DEAL_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'deal') return;
    const deal = phase.deal;
    const player = driver.state.player;

    const content = frame();
    const below = addHeader(k, content, 'An altar in the dark', 'Something offers a bargain.');

    const affordable = player !== null && canAfford(player, deal.cost);

    const region = { x: content.x, y: below + SPACING.sm, w: content.w, h: content.h };
    bodyText(
      k,
      region,
      [
        `It offers: ${describeReward(deal.reward)}`,
        `It demands: ${describeCost(deal.cost)}`,
        affordable ? '' : '(you cannot pay this)',
      ]
        .filter(Boolean)
        .join('\n'),
      affordable ? COLORS.text : COLORS.dim,
    );

    bottomButtons(k, content, [
      {
        label: 'Pay the price',
        onClick: () => driver.dispatch({ kind: 'deal-decision', accept: true }),
        disabled: !affordable,
      },
      { label: 'Refuse', onClick: () => driver.dispatch({ kind: 'deal-decision', accept: false }) },
    ]);
  });
}
