// THE NEW SCREENS — the thin DOM half (PLAN.md #8).
//
// Why this file exists at all: `src/desktop/game.ts` calls the Electron IPC at module scope,
// so nothing can import it and every guard on it is a source-text scan (FINDINGS.md G51).
// Anything that can be pulled OUT of that file becomes testable for real, so the content
// warning, the settings screen and the art slots are built here — an importable module with
// no module-scope side effects — and `game.ts` keeps only the wiring.
//
// These are BUILDERS, not a second component library. Every button is `appendButton` and
// every labelled line is `appendRow`, both from `src/render/components.ts`. Every decision
// (which rows, which options, what a setting means) has already been made by the pure models
// in `src/render/settings-model.ts` and `src/render/art-slots.ts` before a function here runs.
//
// Everything is `textContent`. No `innerHTML` anywhere in this file, ever: the content
// warning is author-authored prose today and a player's own name is one screen away.

import {
  ART_SLOTS,
  aspectRatio,
  hasSource,
  type ArtSlot,
  type ArtSlotId,
} from '../render/art-slots.ts';
import {
  SETTINGS_ROWS,
  type Settings,
  type SettingsField,
} from '../render/settings-model.ts';
import { appendButton } from '../render/components.ts';
import { buttonModel } from '../render/component-model.ts';
import warningData from '../data/contentWarning.json';

// ---------------------------------------------------------------------------------------
// THE CONTENT WARNING (FINDINGS.md S1; docs/CONTENT-WARNING.md owns the policy).
//
// Shown at the start of EVERY fresh run, never on resume, always dismissible. The words are
// DATA (`src/data/contentWarning.json`) and the author replaces them in #13 by editing that
// file alone — nothing here changes. What ships today is clearly-marked placeholder prose,
// there to prove the screen's shape, length and rhythm so the author is replacing words in a
// real layout rather than designing the screen and writing it at the same time.
// ---------------------------------------------------------------------------------------

export interface ContentWarning {
  title: string;
  body: readonly string[];
  acknowledge: string;
}

/** The shipped warning, as data. Exported so a test can assert the render is byte-identical. */
export const CONTENT_WARNING: ContentWarning = {
  title: warningData.title,
  body: warningData.body,
  acknowledge: warningData.acknowledge,
};

/**
 * The content-warning screen. One heading, one paragraph per body entry, one control.
 *
 * EXACTLY ONE CONTROL, and it is a real `<button>`. Not a timed lock, not a two-step
 * confirm, not a checkbox to tick first — `CONTENT-WARNING.md` is explicit that respect for
 * the player is the point, and a warning you have to fight is not respect. The button gets
 * keyboard operation, focus order and the right screen-reader announcement for free by being
 * a button, which is the same argument the combat log's `<details>` is built on.
 */
export function buildContentWarning(data: ContentWarning, onAcknowledge: () => void): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'content-warning';

  const heading = document.createElement('h2');
  heading.className = 'content-warning-title';
  heading.textContent = data.title;
  wrap.appendChild(heading);

  const prose = document.createElement('div');
  prose.className = 'content-warning-body';
  for (const paragraph of data.body) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    prose.appendChild(p);
  }
  wrap.appendChild(prose);

  appendButton(wrap, buttonModel(data.acknowledge), onAcknowledge);
  return wrap;
}

// ---------------------------------------------------------------------------------------
// THE SETTINGS SCREEN (FINDINGS.md B1; UI-DESIGN.md §12, with this unit's recorded scope
// deviation — only the group that controls something that exists).
// ---------------------------------------------------------------------------------------

/**
 * The settings screen. Model-driven: one section per row in `SETTINGS_ROWS`, one native
 * `<button>` per option, `aria-pressed` on each carrying the current value.
 *
 * ⚠ IT REPAINTS ITSELF. `actionButton` binds its handler `{ once: true }` — correct
 * everywhere else in the game, because every other click dispatches an engine step and the
 * whole choice list is rebuilt. Nothing rebuilds this screen, so a once-bound toggle would
 * work exactly once and then go dead: high contrast on, and no way back to off without
 * leaving the screen. Owning the repaint here means the screen cannot be wired wrong by a
 * caller, and `onChange` stays a notification rather than a re-render obligation.
 *
 * `aria-pressed` rather than a radio group: these are a small set of mutually exclusive
 * toggles, and the pressed state is what a screen reader needs to announce. The visual
 * selected state and the announced state are therefore the same attribute, which is what
 * stops them drifting apart.
 */
export function buildSettingsScreen(
  current: Settings,
  onChange: (next: Settings) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'vm-screen settings-screen';
  let live = current;

  const paint = (): void => {
    wrap.replaceChildren();
    for (const row of SETTINGS_ROWS) {
      const group = document.createElement('section');
      group.className = 'settings-row';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', row.label);

      const label = document.createElement('h3');
      label.className = 'settings-row-label';
      label.textContent = row.label;
      group.appendChild(label);

      const help = document.createElement('p');
      help.className = 'settings-row-help';
      help.textContent = row.help;
      group.appendChild(help);

      const options = document.createElement('div');
      options.className = 'settings-row-options';
      for (const option of row.options) {
        const selected = live[row.field] === option.value;
        const button = appendButton(options, buttonModel(option.label), () => {
          const next = { ...live, [row.field]: option.value } as Settings;
          live = next;
          paint();
          onChange(next);
        });
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        if (selected) button.classList.add('is-selected');
      }
      group.appendChild(options);
      wrap.appendChild(group);
    }
  };

  paint();
  return wrap;
}

/** The settings fields, for a caller that wants to enumerate them. Re-exported for clarity. */
export type { SettingsField };

// ---------------------------------------------------------------------------------------
// THE THREE RESERVED ART REGIONS (plan Appendix A.7). No art ships. These are empty regions
// that hold their committed aspect ratio, carry the current floor's colour and texture, and
// must read as deliberate framed atmosphere rather than as a missing asset.
// ---------------------------------------------------------------------------------------

/**
 * The developer-facing label's class. ⚠ Kept module-LOCAL and never exported, so that the
 * production build's dead-code elimination has nothing to hold on to: an exported binding
 * from a non-entry module is usually shaken out too, but "usually" is not the standard for
 * something the packaged-build exclusion test has to be able to prove. `distFont.test.ts`
 * reads this literal out of this file rather than importing it, which also means the needle
 * cannot silently go stale.
 */
const DEV_LABEL_CLASS = 'void-art-devlabel';

/**
 * One reserved art region.
 *
 * WHAT IT MUST DO, and each of these is a separate requirement:
 *  - RESERVE THE SPACE BY RATIO, not by a fixed pixel height, so it scales with the window
 *    and holds its shape down to the 960x640 minimum.
 *  - NOT MOVE WHEN ART ARRIVES. The `<figure>` and its `aspect-ratio` are identical with and
 *    without a source; a source only adds a child inside the already-reserved box. A test
 *    renders both and compares the geometry.
 *  - LOOK DELIBERATE. With no source it renders an atmospheric framed region keyed to the
 *    floor's palette and texture — no placeholder text, no cross-hatching, no printed
 *    dimensions. An empty region carrying floor 4's warm glow is part of the aesthetic; a
 *    grey box reading "IMAGE HERE" is unfinished software, and the difference is the whole
 *    point of doing this now.
 *  - NEVER BREAK THE SCREEN. No source is the NORMAL state today, not an error: it does not
 *    throw, does not log, and leaves no hole.
 *  - SAY NOTHING TO A SCREEN READER while it is empty. An empty decorative frame announced as
 *    "Scenery, image" is worse than silence. When a source exists it becomes a real `<img>`
 *    with alt text and the `aria-hidden` comes off.
 */
export function buildArtSlot(slot: ArtSlot): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'void-art-slot';
  figure.dataset['artSlot'] = slot.id;
  figure.style.aspectRatio = aspectRatio(slot);

  const frame = document.createElement('div');
  frame.className = 'void-art-frame';

  // The floor's atmosphere, inside the frame. Same class the full-screen layer uses, so one
  // set of `[data-texture='…']` rules paints both and a slot on floor 4 cannot fail to carry
  // floor 4's light.
  const texture = document.createElement('div');
  texture.className = 'void-texture';
  frame.appendChild(texture);

  if (hasSource(slot)) {
    const image = document.createElement('img');
    image.className = 'void-art-image';
    image.src = slot.source as string;
    image.alt = slot.label;
    frame.appendChild(image);
  } else {
    figure.setAttribute('aria-hidden', 'true');
  }

  figure.appendChild(frame);

  // THE ONE DEVELOPER AFFORDANCE, behind the same mechanism as the F3 state panel:
  // `vite build` replaces `import.meta.env.DEV` with the literal `false` and Rollup removes
  // the branch, so no shipped chunk contains the class, the text, or this element. Proved by
  // running the real bundler in `distFont.test.ts`, with a development-build control — an
  // absence with no control behind it proves nothing.
  if (import.meta.env.DEV) {
    const devLabel = document.createElement('span');
    devLabel.className = DEV_LABEL_CLASS;
    devLabel.textContent = `${slot.id} ${slot.ratioW}:${slot.ratioH}`;
    frame.appendChild(devLabel);
  }

  return figure;
}

/** Build the slot with the given id, straight from the data table. */
export function buildArtSlotById(id: ArtSlotId): HTMLElement {
  const slot = ART_SLOTS.find((s) => s.id === id);
  if (!slot) throw new Error(`no art slot: ${id}`);
  return buildArtSlot(slot);
}
