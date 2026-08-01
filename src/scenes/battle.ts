// Battle scene: enemy name, both HP bars, and the scrolling combat log. Before the
// fight starts, a Begin button (continue); once started, Fight / Potion / Run ->
// dispatch {kind:'battle-action'}.

import type { Engine } from '../render/engine.ts';
import type { GameDriver } from '../render/driver.ts';
import type { Rect } from '../render/layout.ts';
import { frame, bottomButtons, logRegion } from './common.ts';
import { addHeader, addHpBar, COLORS, SPACING } from '../render/ui/index.ts';

export const BATTLE_SCENE = 'battle';

export function registerBattleScene(k: Engine, driver: GameDriver): void {
  k.scene(BATTLE_SCENE, () => {
    const phase = driver.state.phase;
    if (phase.kind !== 'battle') return;
    const { player, enemy } = phase.battle;

    const content = frame();
    const title = phase.final ? 'FINAL BATTLE' : 'Battle';
    let y = addHeader(k, content, title, enemy.fullName);

    y = addHpBar(k, {
      bounds: { x: content.x, y, w: content.w, h: 0 },
      label: enemy.fullName,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      fill: COLORS.danger,
    });
    y = addHpBar(k, {
      bounds: { x: content.x, y: y + SPACING.xs, w: content.w, h: 0 },
      label: `${player.name} (you)`,
      hp: player.hp,
      maxHp: player.maxHp,
      fill: COLORS.good,
    });

    const specs = phase.started
      ? [
          { label: 'Fight', onClick: () => driver.dispatch({ kind: 'battle-action', action: 'fight' as const }) },
          { label: 'Potion', onClick: () => driver.dispatch({ kind: 'battle-action', action: 'potion' as const }) },
          { label: 'Run', onClick: () => driver.dispatch({ kind: 'battle-action', action: 'run' as const }) },
        ]
      : [{ label: 'Begin', onClick: () => driver.dispatch({ kind: 'continue' }) }];
    const buttonsTop = bottomButtons(k, content, specs);

    const logTop = y + SPACING.sm;
    const logRect: Rect = {
      x: content.x,
      y: logTop,
      w: content.w,
      h: Math.max(0, buttonsTop - SPACING.md - logTop),
    };
    logRegion(k, logRect, driver.log);
  });
}
