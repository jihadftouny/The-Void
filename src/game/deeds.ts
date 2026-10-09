// The DEED RECORD — what the run did, kept as plain data (PLAN.md #11, GAME-DESIGN.md §22.31 D3).
//
// WHY THIS EXISTS (FINDINGS.md G79). §22.29 said the deeds behind your karma were "already recorded
// as plain data". They were not: only the four karma NUMBERS and a spare COUNT were kept. A boss
// that speaks your deeds back to you ("You let the Fixer walk") needs the deeds themselves — who,
// where, and which way it leaned. This module is that record.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM or canvas. Every function is pure.
//  - Deterministic: no RNG at all, no clock.
//  - Serializable plain-data state: a `Deed` is a flat record of strings and numbers; the record
//    rides on `GameState.deeds` and round-trips through the save (version 10).
//  - Data-driven: a deed's PLACE is the floor id, never a name or a number in prose — the name is
//    read from `floors.json` when it is needed (`deedPlaceName`), so #13's re-authoring of the
//    floor names reaches every deed ever recorded.
//
// WHAT IS RECORDED (the author's list, settled 2026-09-27): a ⚖ enemy spared, by name; a ⚖ enemy
// killed that could have been spared, by name; the four karma-shifting bargains (offering,
// desecration, greed, whisper) with what was paid and what was got; an illusion seen through; a
// boss felled or talked into surrender. A FLED FIGHT IS NEVER RECORDED — fleeing is not a moral
// deed (§22.31). The record is capped at `DEED_CAP`; boss deeds are always kept.

import type { FloorId } from './floors.ts';
import { floorDef, FLOOR_IDS } from './floors.ts';
import type { BossId, KarmaAxis } from './boss.ts';

/** What kind of deed. */
export type DeedKind = 'spared' | 'killed' | 'bargain' | 'illusion' | 'boss';

/** The four bargains whose price is karma — the only bargains the record keeps. */
export type BargainCost = 'offering' | 'desecrate' | 'greed' | 'whisper';

/** Every deed kind, for validation. */
export const DEED_KINDS: readonly DeedKind[] = ['spared', 'killed', 'bargain', 'illusion', 'boss'];

/** Every recorded bargain cost, for validation. */
export const BARGAIN_COSTS: readonly BargainCost[] = ['offering', 'desecrate', 'greed', 'whisper'];

/** One thing the run did. */
export interface Deed {
  kind: DeedKind;
  /** Where — the floor id; its NAME is read from `floors.json` (`deedPlaceName`). */
  floor: FloorId;
  /** Which way it leaned. Absent only on a boss deed. */
  axis?: KarmaAxis;
  /** spared / killed: the enemy's full name · boss: the boss's display name. */
  name?: string;
  /** boss: which boss, and how the fight ended. */
  bossId?: BossId;
  outcome?: 'felled' | 'surrendered';
  /** bargain: the price and the reward, in the words the player was shown. */
  bargain?: { cost: BargainCost; paid: string; got: string };
}

/**
 * How many deeds the record holds (§22.31 D3). When a new deed would pass it, the OLDEST non-boss
 * deed is dropped; a boss deed is never dropped (there are at most five).
 */
export const DEED_CAP = 24;

/**
 * Append `deed` — PURE, returns a NEW array. Over the cap, drop the oldest deed that is not a boss
 * deed, until the record fits. The order stays oldest → newest. A record already over the cap (a
 * hand-built save) is brought back to it on this, the next write — never at load.
 */
export function recordDeed(deeds: readonly Deed[], deed: Deed): Deed[] {
  const next = [...deeds, deed];
  while (next.length > DEED_CAP) {
    const oldest = next.findIndex((d) => d.kind !== 'boss');
    if (oldest < 0) break;
    next.splice(oldest, 1);
  }
  return next;
}

/** The place a deed happened, by NAME — "Entrance to the Void", never "floor 2". */
export function deedPlaceName(deed: Pick<Deed, 'floor'>): string {
  return floorDef(deed.floor).name;
}

/**
 * The deeds the executioner names its blows for (§22.31: "each strike is named for a desecration
 * or cruelty from the deed record") — a ⚖ kill, or a desecration bargain — oldest first.
 */
export function executionerDeeds(deeds: readonly Deed[]): Deed[] {
  return deeds.filter((d) => d.kind === 'killed' || (d.kind === 'bargain' && d.bargain?.cost === 'desecrate'));
}

/** The karma axis a recorded bargain leans on (the price's own axis). */
export const BARGAIN_AXIS: Record<BargainCost, KarmaAxis> = {
  offering: 'reverenceDesecration',
  desecrate: 'reverenceDesecration',
  greed: 'restraintGreed',
  whisper: 'clarityDelusion',
};

/** Is `kind` one of the four karma-priced bargains the record keeps? */
export function isRecordedBargain(kind: string): kind is BargainCost {
  return (BARGAIN_COSTS as readonly string[]).includes(kind);
}

/**
 * A shallow shape check for a deed read from a save — the kind is known and the floor is a real
 * floor (1..5). Deeper fields are trusted, as the rest of the save guard trusts its payloads.
 */
export function isValidDeed(v: unknown): v is Deed {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const d = v as { kind?: unknown; floor?: unknown };
  return (
    typeof d.kind === 'string' &&
    (DEED_KINDS as readonly string[]).includes(d.kind) &&
    typeof d.floor === 'number' &&
    (FLOOR_IDS as readonly number[]).includes(d.floor)
  );
}
