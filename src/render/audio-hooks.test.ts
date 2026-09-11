// The audio hooks (PLAN.md #6, AC-23; ART-BIBLE §10): every beat that should make a sound
// names one, and the catalogue #15 has to source is exactly the sounds something asks for.
//
// Expected values are written by hand from the plan's table, never read off the module.

import { describe, it, expect } from 'vitest';
import {
  ATTACK_HOOK,
  AUDIO_HOOKS,
  HOOK_BY_KIND,
  SILENT_AUDIO,
  hookForEvent,
  type AudioHookName,
} from './audio-hooks.ts';
import { BEAT_ROLE } from './beat-model.ts';
import { LOG_ROUTING } from './log-model.ts';
import { ONE_OF_EVERY_EVENT } from '../game/eventSamples.testutil.ts';
import type { GameEvent, GameEventKind } from '../game/gameEvent.ts';

const EVERY: readonly GameEvent[] = Object.values(ONE_OF_EVERY_EVENT);

describe('the hook table', () => {
  it('covers every event kind the engine can emit (the samples are type-exhaustive)', () => {
    expect(EVERY.length, 'the sample table shrank').toBeGreaterThan(60);
    expect(Object.keys(HOOK_BY_KIND).sort()).toEqual(Object.keys(ONE_OF_EVERY_EVENT).sort());
  });

  it('EVERY combat anchor — every event that is a beat — names a sound (AC-23)', () => {
    const anchors = (Object.keys(BEAT_ROLE) as GameEventKind[]).filter((k) => BEAT_ROLE[k] === 'anchor');
    expect(anchors.length, 'no anchors — this sweep reads nothing').toBeGreaterThan(20);
    const silent = anchors.filter((k) => hookForEvent(ONE_OF_EVERY_EVENT[k] as GameEvent) === null);
    expect(silent, 'a beat that plays no sound — #15 would have nothing to hang it on').toEqual([]);
  });

  it('the narrative stream is silent, except the three events that open a fight', () => {
    const pane = (Object.keys(LOG_ROUTING) as GameEventKind[]).filter((k) => LOG_ROUTING[k] === 'pane');
    const sounding = pane.filter((k) => HOOK_BY_KIND[k] !== null).sort();
    expect(sounding).toEqual(['boss-encounter', 'encounter-start', 'final-battle-begins']);
    for (const k of sounding) expect(HOOK_BY_KIND[k]).toBe('open');
  });

  it('maps the plan’s pairs, by hand', () => {
    const expected: [GameEventKind, AudioHookName][] = [
      ['skill-cast', 'skill'],
      ['enemy-skill-used', 'skill'],
      ['condition-damage', 'tick'],
      ['condition-heal', 'tick'],
      ['shield-gained', 'ward'],
      ['shield-absorbed', 'ward'],
      ['revive', 'ward'],
      ['defeat', 'fall'],
      ['victory', 'victory'],
      ['fled', 'flee'],
      ['escape-failed', 'flee'],
      ['spared', 'spare'],
      ['illusion-dispelled', 'dispel'],
      ['boss-summon', 'boss'],
      ['boss-minion-damage', 'boss'],
      ['boss-adapt', 'boss'],
      ['floor-drain', 'tick'],
      ['consumable-used', 'item'],
      ['cast-unavailable', 'refused'],
      ['escape-impossible', 'refused'],
    ];
    for (const [kind, hook] of expected) {
      expect(hookForEvent(ONE_OF_EVERY_EVENT[kind] as GameEvent), kind).toBe(hook);
    }
  });

  it('an attack sounds by its outcome, and a fumble is a miss to the ear', () => {
    const base = ONE_OF_EVERY_EVENT.attack;
    expect(hookForEvent({ ...base, outcome: 'hit' })).toBe('hit');
    expect(hookForEvent({ ...base, outcome: 'crit' })).toBe('crit');
    expect(hookForEvent({ ...base, outcome: 'miss' })).toBe('miss');
    expect(hookForEvent({ ...base, outcome: 'fumble' })).toBe('miss');
    expect(Object.keys(ATTACK_HOOK).sort()).toEqual(['crit', 'fumble', 'hit', 'miss']);
  });
});

describe('the catalogue', () => {
  it('has no duplicate and no dead entry — every sound is asked for by something', () => {
    expect(new Set(AUDIO_HOOKS).size).toBe(AUDIO_HOOKS.length);
    const used = new Set<AudioHookName>([
      ...Object.values(HOOK_BY_KIND).filter((h): h is AudioHookName => h !== null),
      ...Object.values(ATTACK_HOOK),
    ]);
    const dead = AUDIO_HOOKS.filter((h) => !used.has(h));
    expect(dead, 'a sound #15 would source that nothing ever plays').toEqual([]);
    // ...and nothing asks for a sound that is not in the catalogue.
    for (const h of used) expect(AUDIO_HOOKS as readonly string[]).toContain(h);
  });

  it('the silent sink accepts every hook and does nothing', () => {
    for (const name of AUDIO_HOOKS) expect(SILENT_AUDIO.play(name, { index: 0 })).toBeUndefined();
  });
});
