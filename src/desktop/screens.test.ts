// @vitest-environment jsdom
//
// THE FIRST jsdom TEST IN THIS REPOSITORY, and the convention the units after it inherit.
//
// The standing rule (docs/UI-DESIGN.md §22.18) is that Vitest runs `environment: 'node'` and
// only pure logic is unit-tested — a rule that exists because the RENDERER cannot be imported
// at all (`game.ts` calls the Electron IPC at module scope, FINDINGS.md G51) and because a
// browser environment for the whole suite would slow every pure test down for nothing.
//
// The opt-in is the ONE-LINE DIRECTIVE at the top of this file. It is per-file, so the other
// 80 test files still run under `node` at full speed, and it is why `screens.ts` exists as a
// separate module in the first place: everything that can be lifted OUT of `game.ts` becomes
// testable for real instead of by reading source text. #6 and #7 should do the same.
//
// WHAT IS ASSERTED HERE THAT A SOURCE SCAN COULD NOT: that a `<script>` in the warning prose
// is TEXT and not a node; that clicking a settings option delivers the changed value; that a
// reserved art region occupies exactly the same geometry with and without art in it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CONTENT_WARNING,
  buildArtSlot,
  buildArtSlotById,
  buildContentWarning,
  buildSettingsScreen,
  type ContentWarning,
} from './screens.ts';
import warningData from '../data/contentWarning.json';
import { ART_SLOTS, artSlot } from '../render/art-slots.ts';
import { DEFAULT_SETTINGS, SETTINGS_ROWS, type Settings } from '../render/settings-model.ts';
import { log, type LogEntry } from '../log/logger.ts';

// =========================================================================================
// THE CONTENT WARNING (FINDINGS.md S1). The words are DATA, and the author replaces them in
// #13 by editing that file alone. So the data file IS the specification here.
// =========================================================================================

describe('the content warning renders the words in its data file, and nothing else', () => {
  it('the heading and every paragraph are byte-identical to the data', () => {
    const el = buildContentWarning(CONTENT_WARNING, () => undefined);
    expect(el.querySelector('h2')?.textContent).toBe(warningData.title);
    const paragraphs = [...el.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(warningData.body);
    // Non-vacuity: the file really does hold several paragraphs of prose, so "they match"
    // is a statement about content rather than about two empty lists.
    expect(paragraphs.length).toBeGreaterThan(2);
    for (const text of paragraphs) expect((text ?? '').length).toBeGreaterThan(80);
  });

  it('and the module re-exports exactly what the file says, so #13 is a data edit', () => {
    expect(CONTENT_WARNING.title).toBe(warningData.title);
    expect(CONTENT_WARNING.body).toEqual(warningData.body);
    expect(CONTENT_WARNING.acknowledge).toBe(warningData.acknowledge);
  });

  it('the data marks itself as placeholder, unmistakably (A.4)', () => {
    // The author's own instruction: ship placeholder prose so the screen's shape and rhythm
    // are real, and mark it so it can never be mistaken for the final words.
    expect(warningData.status).toContain('PLACEHOLDER');
    expect(warningData.status).toContain('#13');
  });

  it('markup in the prose is TEXT, not a node — the author writes these words freely', () => {
    const hostile: ContentWarning = {
      title: '<img src=x onerror=alert(1)>',
      body: ['<script>steal()</script>', 'A second, ordinary paragraph.'],
      acknowledge: '<b>begin</b>',
    };
    const el = buildContentWarning(hostile, () => undefined);
    expect(el.querySelectorAll('img, script, b')).toHaveLength(0);
    expect(el.querySelector('h2')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelectorAll('p')[0]?.textContent).toBe('<script>steal()</script>');
    expect(el.querySelector('button')?.textContent).toBe('<b>begin</b>');
  });

  it('has EXACTLY ONE control, and it is a real button', () => {
    // `CONTENT-WARNING.md`: respect for the player is the point. Not a timed lock, not a
    // checkbox to tick first, not a two-step confirm. A native button also carries keyboard
    // operation and the right screen-reader role for free.
    const el = buildContentWarning(CONTENT_WARNING, () => undefined);
    const buttons = el.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.tagName).toBe('BUTTON');
    expect(buttons[0]?.textContent).toBe(warningData.acknowledge);
    expect(el.querySelectorAll('input, select, textarea, details')).toHaveLength(0);
  });

  it('clicking it acknowledges exactly once', () => {
    const onAcknowledge = vi.fn();
    const el = buildContentWarning(CONTENT_WARNING, onAcknowledge);
    const button = el.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    // The shared `actionButton` binds `{ once: true }`, so a double-click cannot double-fire.
    button.click();
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('and does NOT acknowledge before it is clicked', () => {
    const onAcknowledge = vi.fn();
    buildContentWarning(CONTENT_WARNING, onAcknowledge);
    expect(onAcknowledge).not.toHaveBeenCalled();
  });
});

// =========================================================================================
// THE SETTINGS SCREEN (FINDINGS.md B1). Model-driven; the pure model is tested separately.
// What is tested here is that the screen the model describes is the screen that gets built,
// and that pressing a control really delivers the changed value.
// =========================================================================================

describe('the settings screen is native buttons carrying their own state', () => {
  const optionButtons = (el: HTMLElement): HTMLButtonElement[] =>
    [...el.querySelectorAll('button')] as HTMLButtonElement[];

  it('renders one group per row and one button per option', () => {
    const el = buildSettingsScreen(DEFAULT_SETTINGS, () => undefined);
    expect(el.querySelectorAll('[role="group"]')).toHaveLength(SETTINGS_ROWS.length);
    const expectedButtons = SETTINGS_ROWS.reduce((n, r) => n + r.options.length, 0);
    expect(optionButtons(el)).toHaveLength(expectedButtons);
    // 3 + 3 + 2 — written out, so a silently shrunken screen fails here too.
    expect(expectedButtons).toBe(8);
  });

  it('every control is a native <button> — keyboard reachability by construction', () => {
    // Honestly a proxy: jsdom does no focus management, so "is a button" is what a machine
    // can see. A real keyboard pass over this screen is in HUMAN-CHECKS.
    const el = buildSettingsScreen(DEFAULT_SETTINGS, () => undefined);
    for (const button of optionButtons(el)) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.hasAttribute('aria-pressed')).toBe(true);
    }
    expect(el.querySelectorAll('div[onclick], span[onclick]')).toHaveLength(0);
  });

  it('aria-pressed reflects the CURRENT value, exactly one per group', () => {
    const current: Settings = { v: 1, textScale: 'large', motion: 'reduce', contrast: 'high' };
    const el = buildSettingsScreen(current, () => undefined);
    const groups = [...el.querySelectorAll('[role="group"]')];
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      const pressed = [...group.querySelectorAll('button[aria-pressed="true"]')];
      expect(pressed, `${group.getAttribute('aria-label')} has no single pressed option`)
        .toHaveLength(1);
    }
    // ...and they are the RIGHT ones: the labels the model gives those three values.
    const pressedLabels = [...el.querySelectorAll('button[aria-pressed="true"]')].map(
      (b) => b.textContent,
    );
    expect(pressedLabels).toEqual(['Large', 'Reduced', 'High']);
  });

  it('and a DIFFERENT current value presses different buttons', () => {
    // Without this, "aria-pressed is right" is satisfied by a screen that always presses the
    // first option of each group.
    const el = buildSettingsScreen(DEFAULT_SETTINGS, () => undefined);
    const pressedLabels = [...el.querySelectorAll('button[aria-pressed="true"]')].map(
      (b) => b.textContent,
    );
    expect(pressedLabels).toEqual(['Normal', 'Follow this device', 'Normal']);
  });

  it('clicking an option delivers the changed settings, and changes only that field', () => {
    // The expected values are written out per control rather than computed from the click.
    const cases: { label: string; expected: Settings }[] = [
      { label: 'Large', expected: { ...DEFAULT_SETTINGS, textScale: 'large' } },
      { label: 'Small', expected: { ...DEFAULT_SETTINGS, textScale: 'small' } },
      { label: 'Reduced', expected: { ...DEFAULT_SETTINGS, motion: 'reduce' } },
      { label: 'Full', expected: { ...DEFAULT_SETTINGS, motion: 'full' } },
      { label: 'High', expected: { ...DEFAULT_SETTINGS, contrast: 'high' } },
    ];
    for (const { label, expected } of cases) {
      const onChange = vi.fn();
      const el = buildSettingsScreen(DEFAULT_SETTINGS, onChange);
      const button = optionButtons(el).find((b) => b.textContent === label);
      expect(button, `no control labelled ${label}`).toBeDefined();
      button?.click();
      expect(onChange, label).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]?.[0], label).toEqual(expected);
    }
  });

  /**
   * Press the option labelled `label` inside the group labelled `group`.
   *
   * SCOPED BY GROUP DELIBERATELY: "Normal" is the label of BOTH a text size and a contrast
   * setting, so an unscoped search silently presses whichever comes first — which is how the
   * first draft of the repaint test below accused the code of a bug it did not have.
   */
  const press = (el: HTMLElement, group: string, label: string): void => {
    const section = el.querySelector(`[role="group"][aria-label="${group}"]`);
    expect(section, `no group labelled ${group}`).not.toBeNull();
    const button = [...(section?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement | undefined;
    expect(button, `no control labelled ${label} in ${group}`).toBeDefined();
    button?.click();
  };

  it('the screen REPAINTS, so a toggle works more than once', () => {
    // `actionButton` binds `{ once: true }` — correct everywhere else, because every other
    // click dispatches an engine step that rebuilds the whole choice list. Nothing rebuilds
    // this screen, so a once-bound toggle would turn high contrast ON and offer no way back.
    const onChange = vi.fn();
    const el = buildSettingsScreen(DEFAULT_SETTINGS, onChange);
    press(el, 'Contrast', 'High');
    press(el, 'Contrast', 'Normal');
    press(el, 'Contrast', 'High');
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls[0]?.[0]).toEqual({ ...DEFAULT_SETTINGS, contrast: 'high' });
    expect(onChange.mock.calls[1]?.[0]).toEqual({ ...DEFAULT_SETTINGS, contrast: 'normal' });
    expect(onChange.mock.calls[2]?.[0]).toEqual({ ...DEFAULT_SETTINGS, contrast: 'high' });
  });

  it('and the pressed state follows, so the screen shows what it just did', () => {
    const el = buildSettingsScreen(DEFAULT_SETTINGS, () => undefined);
    press(el, 'Contrast', 'High');
    const contrast = el.querySelector('[role="group"][aria-label="Contrast"]');
    expect(contrast?.querySelector('button[aria-pressed="true"]')?.textContent).toBe('High');
  });

  it('and the repaint keeps the accumulated state — a second field does not reset the first', () => {
    const onChange = vi.fn();
    const el = buildSettingsScreen(DEFAULT_SETTINGS, onChange);
    press(el, 'Text size', 'Large');
    press(el, 'Contrast', 'High');
    expect(onChange.mock.calls[1]?.[0]).toEqual({
      ...DEFAULT_SETTINGS,
      textScale: 'large',
      contrast: 'high',
    });
  });

  it('every row shows its label and its plain-language explanation', () => {
    const el = buildSettingsScreen(DEFAULT_SETTINGS, () => undefined);
    const text = el.textContent ?? '';
    for (const row of SETTINGS_ROWS) {
      expect(text, `${row.field}'s label is missing`).toContain(row.label);
      expect(text, `${row.field}'s explanation is missing`).toContain(row.help);
    }
  });

  it('and it does not fire onChange merely by being built', () => {
    const onChange = vi.fn();
    buildSettingsScreen(DEFAULT_SETTINGS, onChange);
    expect(onChange).not.toHaveBeenCalled();
  });
});

// =========================================================================================
// THE THREE RESERVED ART REGIONS (plan Appendix A.7). No art exists and none is shipped.
// =========================================================================================

/** The dev-only label class, read out of the shipping source rather than imported. */
const DEV_LABEL = 'void-art-devlabel';

describe('a reserved art region holds its shape whether or not art ever arrives', () => {
  it('reserves the committed ratio, and no pixel size at all', () => {
    for (const slot of ART_SLOTS) {
      const figure = buildArtSlot(slot);
      expect(figure.style.aspectRatio, slot.id).toBe(`${slot.ratioW} / ${slot.ratioH}`);
      expect(figure.style.height, `${slot.id} pins a height`).toBe('');
      expect(figure.style.width, `${slot.id} pins a width`).toBe('');
    }
  });

  it('NOTHING MOVES when a source appears — the geometry is byte-identical', () => {
    // A.7.4, asserted rather than promised: when art finally loads, nothing on the screen
    // may shift. So the reserved box is compared with and without a source.
    for (const slot of ART_SLOTS) {
      const empty = buildArtSlot(slot);
      const filled = buildArtSlot({ ...slot, source: 'assets/whatever.webp' });
      expect(filled.tagName).toBe(empty.tagName);
      expect(filled.className).toBe(empty.className);
      expect(filled.style.aspectRatio, slot.id).toBe(empty.style.aspectRatio);
      expect(filled.dataset['artSlot']).toBe(empty.dataset['artSlot']);
      // The source only ADDS a child inside the already-reserved frame.
      expect(empty.querySelectorAll('img')).toHaveLength(0);
      expect(filled.querySelectorAll('img')).toHaveLength(1);
      expect(filled.querySelector('img')?.getAttribute('src')).toBe('assets/whatever.webp');
      expect(filled.querySelector('img')?.getAttribute('alt')).toBe(slot.label);
    }
  });

  it('carries the floor’s atmosphere layer, so an empty region is part of the aesthetic', () => {
    // A.7.7: a scenery slot on floor 4 must carry floor 4's colour and texture. It does that
    // by reusing the same `.void-texture` element the full-screen layer uses, which reads the
    // `--void-texture-*` tokens the floor theme writes — one set of rules, not two.
    for (const slot of ART_SLOTS) {
      expect(buildArtSlot(slot).querySelectorAll('.void-texture'), slot.id).toHaveLength(1);
    }
  });

  it('SHOWS NO WORDS in the shipped path — no "IMAGE HERE", no printed dimensions', () => {
    // A.7.5, the requirement most likely to be got wrong: a grey box reading IMAGE HERE in a
    // released game reads as unfinished software. The dev-only label is removed first, which
    // is exactly what `vite build` does to it; the control below proves the removal did
    // something, and `distFont.test.ts` proves the real bundler agrees.
    for (const slot of ART_SLOTS) {
      const figure = buildArtSlot(slot);
      for (const label of [...figure.querySelectorAll(`.${DEV_LABEL}`)]) label.remove();
      expect((figure.textContent ?? '').trim(), `${slot.id} prints text`).toBe('');
      expect(figure.querySelectorAll('svg, canvas'), `${slot.id} draws a placeholder`)
        .toHaveLength(0);
    }
  });

  it('THE CONTROL: under a dev build the label IS there (or the sweep above removed nothing)', () => {
    // Vitest sets `import.meta.env.DEV`, so this file runs the dev branch. Without this, the
    // assertion above passes just as well against a slot that never had a label to remove —
    // and would keep passing if the whole atmospheric frame were replaced by an empty div.
    expect(import.meta.env.DEV, 'this test is not running as a dev build').toBe(true);
    const figure = buildArtSlot(artSlot('scenery'));
    const label = figure.querySelector(`.${DEV_LABEL}`);
    expect(label, 'the dev label is gone — the sweep above now proves nothing').not.toBeNull();
    expect(label?.textContent).toBe('scenery 16:9');
  });

  it('says nothing to a screen reader while it is empty, and speaks once it is not', () => {
    // An empty decorative frame announced as "Scenery, image" is worse than silence.
    for (const slot of ART_SLOTS) {
      expect(buildArtSlot(slot).getAttribute('aria-hidden'), slot.id).toBe('true');
      const filled = buildArtSlot({ ...slot, source: 'assets/x.webp' });
      expect(filled.getAttribute('aria-hidden'), slot.id).toBeNull();
    }
  });

  it('builds by id straight from the data table', () => {
    for (const slot of ART_SLOTS) {
      expect(buildArtSlotById(slot.id).dataset['artSlot']).toBe(slot.id);
    }
  });
});

describe('an empty slot is the NORMAL state — it never breaks the screen (A.7.6)', () => {
  let entries: LogEntry[] = [];
  let off: () => void = () => undefined;

  beforeEach(() => {
    entries = [];
    off = log.addSink((e) => entries.push(e));
  });
  afterEach(() => {
    off();
  });

  it('does not throw, and logs nothing at all', () => {
    for (const slot of ART_SLOTS) {
      expect(() => buildArtSlot(slot)).not.toThrow();
    }
    expect(entries, 'an absent source is being reported as a problem').toEqual([]);
  });

  it('and it leaves no hole — the region is a real element with a frame inside it', () => {
    for (const slot of ART_SLOTS) {
      const figure = buildArtSlot(slot);
      expect(figure.tagName).toBe('FIGURE');
      expect(figure.querySelectorAll('.void-art-frame')).toHaveLength(1);
    }
  });
});
