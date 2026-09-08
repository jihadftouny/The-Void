// THE THREE RESERVED ART REGIONS — the pure half (plan Appendix A.7).
//
// WHAT THIS IS FOR, and why it exists before any art does. **The aspect ratio is the
// commitment, not the picture.** Whatever shape these regions are is the shape every future
// piece of art must be drawn to; decide it after the art exists and the art is wrong and gets
// redrawn. Deciding it now costs nothing. It is also why the layout reserves the space AT
// FULL SIZE immediately: when art finally loads, nothing on the screen may move.
//
// DATA-DRIVEN (CLAUDE.md rule 3). A slot is described by `src/data/artSlots.json` — an id, a
// ratio, a written reason, and a `source` that is ABSENT today. Dropping art in later is a
// change to that one field. There are deliberately not three bespoke boxes hard-coded into
// three screens; there is one descriptor list and one builder.
//
// NO ART IS SHIPPED, GENERATED, BOUGHT OR DOWNLOADED BY THIS UNIT. `source` is `null` on all
// three, and a `null` source is the NORMAL state — not an error. A slot with no source must
// not log an error, must not throw, and must not leave a hole in the layout; it renders as an
// atmospheric framed region carrying the current floor's colour and texture, which is what
// makes an empty region read as deliberate rather than as unfinished software.
//
// Pure: no DOM here. The DOM builder is `src/desktop/screens.ts`.

import raw from '../data/artSlots.json';

/** Which region. The three are fixed by the design; a fourth is a data change plus a home. */
export type ArtSlotId = 'scenery' | 'enemy' | 'character';

export interface ArtSlot {
  id: ArtSlotId;
  /** Player-facing name. Used for the accessible label, never printed as placeholder text. */
  label: string;
  /** The committed aspect ratio, as two integers. `ratioW / ratioH`. */
  ratioW: number;
  ratioH: number;
  /** Why this shape suits this subject. Prose, for whoever reopens the decision. */
  why: string;
  /** The art, when it exists. `null` today, on all three, by instruction. */
  source: string | null;
}

interface RawSlot {
  id: string;
  label: string;
  ratioW: number;
  ratioH: number;
  why: string;
  source: string | null;
}

const IDS: readonly ArtSlotId[] = ['scenery', 'enemy', 'character'];

/**
 * The three slots, in the order the data declares them. Validated on the way through rather
 * than cast: a ratio of zero would produce a region of zero height that silently reintroduces
 * the layout shift this whole mechanism exists to prevent, and a typo'd id would produce a
 * slot nothing can look up. Both fail loudly at module load, where a build catches them.
 */
export const ART_SLOTS: readonly ArtSlot[] = (raw as { slots: RawSlot[] }).slots.map((s) => {
  if (!(IDS as readonly string[]).includes(s.id)) throw new Error(`unknown art slot: ${s.id}`);
  if (!Number.isInteger(s.ratioW) || s.ratioW <= 0) throw new Error(`bad ratio width: ${s.id}`);
  if (!Number.isInteger(s.ratioH) || s.ratioH <= 0) throw new Error(`bad ratio height: ${s.id}`);
  return {
    id: s.id as ArtSlotId,
    label: s.label,
    ratioW: s.ratioW,
    ratioH: s.ratioH,
    why: s.why,
    source: s.source,
  };
});

/**
 * One slot by id. Throws on an unknown id rather than returning `undefined`: every call site
 * is a literal in this repository, so an unknown id is a typo a build should catch, not a
 * region that silently fails to render.
 */
export function artSlot(id: ArtSlotId): ArtSlot {
  const found = ART_SLOTS.find((s) => s.id === id);
  if (!found) throw new Error(`no art slot: ${id}`);
  return found;
}

/**
 * The CSS `aspect-ratio` value for a slot — the ONE piece of geometry, computed in one place.
 *
 * It is a ratio and never a pixel height, deliberately: the region then scales with the
 * window and holds its shape all the way down to the 960x640 minimum, instead of being right
 * at one size and wrong everywhere else.
 */
export function aspectRatio(slot: ArtSlot): string {
  return `${slot.ratioW} / ${slot.ratioH}`;
}

/** True when a slot has art to show. `false` on all three today, and that is not an error. */
export function hasSource(slot: ArtSlot): boolean {
  return typeof slot.source === 'string' && slot.source.length > 0;
}
