// Universal draft perks for The Void — pure, framework-agnostic game logic (M9).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. `perkModifiers` is a
//    pure fold over an owned-perk id list; it mutates nothing and prints nothing.
//  - Deterministic seeded RNG: RNG-free (it sums data, never rolls); no Math.random / Date.now.
//  - Data-driven content: the perk catalog is a data table; adding a WIRED-field perk never
//    edits combat code (it only adds a case to `perkModifiers` or the pick-time writer).
//  - Serializable plain-data state: a player owns perks as a plain `string[]` of ids; the
//    catalog is the only source of a perk's meaning.
//
// M9 SCOPE (orchestrator resolution #4): the seed pool contains ONLY perks that fold into
// ALREADY-WIRED modifier fields — `+1 flat damage` (sharpEdge), `+1 AC` (wardingCharm),
// `+1 max skill charge` (deepReserves). Richer perks (crit / evasion / lifesteal) need NEW
// combat wiring and are DEFERRED to a later milestone (they would ship as draftable perks
// once their seams exist). Every magnitude here is an M15 balance placeholder.

/** How a perk applies: folded into a combat modifier read each round, or written once at pick. */
export type PerkApply = 'modifier' | 'onPick';

/** A universal perk as plain, data-driven content. */
export interface PerkDef {
  id: string;
  /** UI/LLM label. */
  label: string;
  /** `modifier` perks are summed into the combat seams; `onPick` perks write player state once. */
  apply: PerkApply;
}

/** The M9 seed perk catalog — wired-field perks only (M15 placeholders). */
export const PERKS: Record<string, PerkDef> = {
  sharpEdge: { id: 'sharpEdge', label: '+1 damage', apply: 'modifier' },
  wardingCharm: { id: 'wardingCharm', label: '+1 armor class', apply: 'modifier' },
  deepReserves: { id: 'deepReserves', label: '+1 max skill charge', apply: 'onPick' },
};

/** Every perk id in the catalog, in insertion order (a stable draw order for the draft). */
export const PERK_IDS: readonly string[] = Object.keys(PERKS);

/** The subset of `EquipModifiers` fields the wired perks fold into. */
export interface PerkModifiers {
  flatDamage: number;
  flatAc: number;
}

/**
 * Sum the owned perks into the combat modifier seams — PURE. REPEATABLE: a perk id appearing
 * twice counts twice (stacking). Off-equivalent: an empty list (or a list of only `onPick`
 * perks like deepReserves) yields the ZERO bundle, so every read site is a no-op for a player
 * with no wired perks. Unknown ids are ignored.
 */
export function perkModifiers(perks: readonly string[]): PerkModifiers {
  let flatDamage = 0;
  let flatAc = 0;
  for (const id of perks) {
    if (id === 'sharpEdge') flatDamage += 1;
    else if (id === 'wardingCharm') flatAc += 1;
    // deepReserves is an onPick perk (applied at pick time, see draft.ts) — not summed here.
  }
  return { flatDamage, flatAc };
}
