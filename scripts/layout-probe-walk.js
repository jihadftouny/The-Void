// THE REAL-BOOT WALK — the other end of every coupling phase A can only mirror.
//
// Phase A of the layout probe builds its worst cases with the real component builders, but it
// MIRRORS one structure the renderer assembles inline: the `.hub-menu` / `.hub-prompt` wrapper.
// (The battle control list was mirrored too until PLAN.md #6, which built the battle screen
// from importable builders; phase A now calls them, and this walk checks that the renderer
// does.) A mirror can drift from the thing it mirrors, and a drifted mirror is a test that
// measures a page the game never shows.
//
// So this walks the ACTUAL renderer. `dist/desktop.html` is loaded with only a stub IPC
// bridge, the real `game.ts` boots, and every step below is a real click on a real button
// that dispatches a real engine step. Nothing here builds any DOM; it only clicks and reads.
//
// Injected by `scripts/layout-probe.mjs` via `executeJavaScript`, so the file is ONE
// expression that resolves to the collected measurements.

(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
   * Let the page finish the work a click started, then force a fresh layout.
   *
   * ⚠ DELIBERATELY NOT `requestAnimationFrame`. MEASURED: in a window that is never shown,
   * an animation frame here costs roughly three quarters of a SECOND even with
   * `backgroundThrottling: false` — there is no compositor asking for frames, so the
   * callback runs on a slow fallback timer. Waiting on two of them after every click took
   * the walk from a few seconds to 55.
   *
   * Two macrotask turns plus a forced layout is both faster and more exact: a click's
   * handlers and any microtasks they queued have run by the second turn, and layout in a
   * browser is computed ON DEMAND when geometry is read — `getBoundingClientRect()` flushes
   * it synchronously. Nothing here depends on anything having been PAINTED. The real
   * synchronisation for an async dispatch is `until()` below, which polls the screen key.
   */
  const settle = async () => {
    await sleep(0);
    await sleep(0);
    document.body.getBoundingClientRect();
  };

  /** Poll until `predicate` holds, or fail loudly. A silent timeout would measure a stale page. */
  async function until(what, predicate) {
    for (let i = 0; i < 150; i += 1) {
      if (predicate()) {
        await settle();
        return;
      }
      await sleep(20);
    }
    throw new Error(
      `layout probe walk: timed out waiting for ${what} (screen is ` +
        `'${document.body.dataset.screen}', choices: ${labels().join(' | ')})`,
    );
  }

  const el = (id) => document.getElementById(id);
  const buttons = () => [...el('choices').querySelectorAll('button')];
  const labels = () => buttons().map((b) => b.textContent.trim());
  const screen = () => document.body.dataset.screen;

  /** Click the control whose label starts with `text`. Fails if there is not exactly one. */
  async function click(text) {
    const found = buttons().filter((b) => b.textContent.trim().startsWith(text));
    if (found.length !== 1) {
      throw new Error(
        `layout probe walk: expected one control starting '${text}' on '${screen()}', ` +
          `found ${found.length} of: ${labels().join(' | ')}`,
      );
    }
    found[0].click();
    await settle();
  }

  /** Click, then wait for the screen key to change to something else. */
  async function clickTo(text, next) {
    await click(text);
    await until(`the screen to become '${next}'`, () => screen() === next);
  }

  // ---- the measurement, mirroring the shape phase A returns -----------------------------

  const box = (node) => {
    const r = node.getBoundingClientRect();
    return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
  };

  function measure(name) {
    const narration = el('narration');
    const scenery = el('scenery');
    const slots = scenery.querySelectorAll('.void-art-slot[data-art-slot="scenery"]');
    const slotBox = slots[0] ? box(slots[0]) : null;
    const beats = narration.querySelectorAll('.beat');
    // The computed type, so the REAL settings path can be proved to have moved the scale —
    // the prose floor is defined in `lh`, so the floor moves with it or the setting is inert.
    const type = getComputedStyle(narration);
    return {
      step: name,
      screen: screen(),
      layout: document.body.dataset.layout,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      narration: {
        ...box(narration),
        beats: beats.length,
        fallbacks: narration.querySelectorAll('.beat.fallback').length,
        characters: narration.textContent.trim().length,
        fontSize: Number.parseFloat(type.fontSize),
        lineHeight: Number.parseFloat(type.lineHeight),
      },
      column: { ...box(el('column')), scrollHeight: el('column').scrollHeight, clientHeight: el('column').clientHeight },
      choices: {
        ...box(el('choices')),
        scrollHeight: el('choices').scrollHeight,
        clientHeight: el('choices').clientHeight,
        controls: buttons().length,
        labels: labels(),
      },
      // Counted across the WHOLE page, not just inside the wrapper: a second frame mounted
      // anywhere else would be exactly the accumulation bug this asserts against.
      scenery: {
        inWrapper: slots.length,
        inPage: document.querySelectorAll('.void-art-slot[data-art-slot="scenery"]').length,
        box: slotBox,
        ratio: slotBox && slotBox.height > 0 ? slotBox.width / slotBox.height : null,
      },
      buttons: buttons().map(box),
      page: {
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
      // Reading order as the keyboard will walk it: the region each focusable lives in.
      focusOrder: [...document.querySelectorAll('button, summary, input, [tabindex]')].map((node) => {
        // `#arena` and `#vitals` are PLAN.md #6's regions; the same list phase A uses.
        const owner = node.closest('#arena, #vitals, #column, #choices, #sheet');
        return owner ? owner.id : 'elsewhere';
      }),
      hubMenuRows: el('choices').querySelectorAll('.hub-menu .void-button').length,
      hubPromptVisible: [...el('choices').querySelectorAll('.hub-prompt')].some(
        (p) => p.getBoundingClientRect().height > 0,
      ),
      documentPanels: el('choices').querySelectorAll('.vm-screen').length,
      // ---- PLAN.md #6: the battle frame, as the real renderer built it ----
      arena: region('arena'),
      vitals: region('vitals'),
      sheet: { ...box(el('sheet')), display: getComputedStyle(el('sheet')).display },
      enemySlot: enemySlot(),
      ticker: {
        line: document.querySelector('#arena .ticker-line')
          ? box(document.querySelector('#arena .ticker-line'))
          : null,
        text: (document.querySelector('#arena .ticker-line')?.textContent ?? '').trim(),
        toggles: document.querySelectorAll('#arena .ticker-toggle').length,
      },
      bars: [...document.querySelectorAll('#arena .void-bar, #vitals .void-bar')].map((b) => ({
        tone: [...b.classList].find((c) => c.startsWith('void-bar-') && c !== 'void-bar') ?? '',
        text: (b.querySelector('.void-bar-text')?.textContent ?? '').trim(),
      })),
    };
  }

  /** A frame region, or null when the page has no such element (the pre-#6 page had none). */
  function region(id) {
    const node = document.getElementById(id);
    if (!node) return null;
    return {
      ...box(node),
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      display: getComputedStyle(node).display,
    };
  }

  /** The enemy's reserved region, counted across the WHOLE page — a second one is a bug. */
  function enemySlot() {
    const all = document.querySelectorAll('.void-art-slot[data-art-slot="enemy"]');
    const first = all[0] ? box(all[0]) : null;
    return {
      inPage: all.length,
      inArena: document.querySelectorAll('#arena .void-art-slot[data-art-slot="enemy"]').length,
      inSheet: document.querySelectorAll('#sheet .void-art-slot[data-art-slot="enemy"]').length,
      box: first,
      ratio: first && first.height > 0 ? first.width / first.height : null,
    };
  }

  const steps = [];

  // ---- the walk -------------------------------------------------------------------------

  // A fresh profile has no saved run, so the boot path is `start()`: the content warning.
  await until('the renderer to boot', () => screen() === 'content-warning');
  steps.push(measure('content-warning'));

  // The warning's ONE control is what advances it (S1: never a fight to get past).
  await click(document.querySelector('#choices button').textContent.trim());
  await until('the title', () => screen() === 'title');
  steps.push(measure('title'));

  await clickTo('Descend into the Void', 'enter-name');
  const input = el('choices').querySelector('input');
  if (!input) throw new Error('layout probe walk: the name step has no input');
  input.value = 'Probe';
  await clickTo('Enter the Void', 'choose-class');
  steps.push(measure('choose-class'));

  // Enforcer is always unlocked, so it is always the first row.
  await clickTo(labels()[0], 'accept-or-reroll-stats');
  await clickTo('Accept these', 'main-menu');
  steps.push(measure('hub'));

  // THE REAL SETTINGS PATH moves the prose floor, because the floor is defined in `lh` and
  // the text scale moves the line height. Nothing here fakes a setting.
  await clickTo('Settings', 'settings');
  const large = [...el('choices').querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Large',
  );
  if (!large) throw new Error('layout probe walk: the settings screen offers no Large option');
  large.click();
  await until('the Large option to report itself pressed', () => {
    const now = [...el('choices').querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Large',
    );
    return now && now.getAttribute('aria-pressed') === 'true';
  });
  await clickTo('Back', 'main-menu');
  steps.push(measure('hub-large-text'));

  // ...and back to the default, so the steps after this measure at the base scale.
  await clickTo('Settings', 'settings');
  steps.push(measure('settings'));
  const normal = [...el('choices').querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Normal',
  );
  if (!normal) throw new Error('layout probe walk: the settings screen offers no Normal option');
  normal.click();
  await until('the Normal option to report itself pressed', () => {
    const now = [...el('choices').querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Normal',
    );
    return now && now.getAttribute('aria-pressed') === 'true';
  });
  await clickTo('Back', 'main-menu');

  await clickTo('Inventory', 'inventory');
  steps.push(measure('inventory'));
  await clickTo('Back', 'main-menu');
  // The hub has now been rendered FOUR times in this session. If anything failed to clear the
  // reserved region, there would be four frames stacked in the column by now.
  steps.push(measure('hub-after-re-renders'));

  await clickTo('Abandon the descent', 'confirm-abandon');
  steps.push(measure('confirm-abandon'));

  // ---- PLAN.md #6: a REAL battle, reached the way a player reaches one ----------------------
  // Back out of the confirmation (the answer that keeps the run), then press on down the
  // descent until a fight opens. The descent is random — the run is seeded from the clock — so
  // the found places on the way are handled as a player would: a cache or a rest is continued
  // past, a bargain refused. Bounded, and loud when the bound is hit.
  await clickTo('No — keep descending', 'main-menu');
  let reached = false;
  for (let tries = 0; tries < 12 && !reached; tries += 1) {
    await click('Continue the descent');
    await until('the descent to land somewhere', () => screen() !== 'main-menu');
    for (let hops = 0; hops < 6 && screen() !== 'main-menu' && !reached; hops += 1) {
      const now = screen();
      if (now === 'battle-action') {
        reached = true;
      } else if (now === 'deal-decision') {
        await clickTo('Refuse', 'main-menu');
      } else if (now === 'continue' || now === 'rest') {
        // A cache, a rest, or a fight waiting to be joined: Continue is the one way on, and each
        // of them leaves for a DIFFERENT screen (the hub, or the fight itself). The choice
        // column is empty while the step is in flight, so the screen key is the only honest wait.
        await click('Continue');
        await until('the Continue to land', () => screen() !== now);
      } else {
        throw new Error(`layout probe walk: the descent reached '${now}', which the walk cannot pass`);
      }
    }
  }
  if (!reached) throw new Error('layout probe walk: twelve descents and no battle opened');
  steps.push(measure('battle'));

  // Cast opens a sub-menu. It is a render-layer switch with no engine step, so it lands
  // synchronously; the settle inside `click` is the whole wait.
  await click('Cast');
  steps.push(measure('battle-cast-open'));

  return {
    steps,
    // The measures are JetBrains Mono's or they are nobody's.
    fontLoaded: document.fonts.check('15px "JetBrains Mono"'),
    fontCount: document.fonts.size,
  };
})();
