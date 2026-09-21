// THE CATALOGUE AGREES WITH THE BIBLE, AND WITH THE ENGINE. (AC-30 … AC-35.)
//
// Two kinds of check here, and both are drift alarms rather than unit tests:
//
//  1. AGAINST `docs/ART-BIBLE.md`. The house style string is "appended verbatim to EVERY prompt …
//     the load-bearing consistency mechanism; changing it invalidates the roster's coherence" (§2).
//     So the shipped string is compared to the document's own code block. If §2 is signed off with
//     an edit, or reworded, this goes red and the catalogue follows. The document wins.
//
//  2. AGAINST THE ENGINE. §4b's asset list is derived from `src/data/enemyFamilies.json` and the
//     five playable classes. Two known changes are coming — §4's ruling that the `demons` family
//     must be removed in the §21.3 rewrite, and the Ash-Wretch family that must be ADDED before
//     its deferred art can be made. This test is what tells the catalogue to follow, in both
//     directions, instead of the roster quietly going out of step with the game.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assemblePrompt,
  buildRequest,
  classOf,
  describeReference,
  parseCatalogue,
  selectAssets,
  validateCatalogue,
  type Catalogue,
} from './catalogue.ts';
import { CLASSES } from '../../src/game/classKit.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

const CATALOGUE_TEXT = readFileSync(path.join(HERE, 'catalogue.json'), 'utf8');
const catalogue: Catalogue = parseCatalogue(CATALOGUE_TEXT);
const BIBLE = readFileSync(path.join(REPO, 'docs/ART-BIBLE.md'), 'utf8');
const FAMILIES = JSON.parse(
  readFileSync(path.join(REPO, 'src/data/enemyFamilies.json'), 'utf8'),
) as { id: string; name: string }[];

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The first fenced code block after `heading`, whitespace-normalised. */
function blockAfter(heading: string): string {
  const at = BIBLE.indexOf(heading);
  expect(at, `heading not found in ART-BIBLE.md: ${heading}`).toBeGreaterThan(-1);
  const open = BIBLE.indexOf('```', at);
  const close = BIBLE.indexOf('```', open + 3);
  return squash(BIBLE.slice(open + 3, close));
}

const live = catalogue.assets.filter((a) => a.deferred === undefined);
const deferred = catalogue.assets.filter((a) => a.deferred !== undefined);
const idsOf = (cls: string): string[] =>
  live.filter((a) => a.class === cls).map((a) => a.id);

// =========================================================================================
// AC-30 — the counts, anchored to §4b
// =========================================================================================

describe('the asset list matches ART-BIBLE §4b (AC-30)', () => {
  it('validates', () => {
    expect(() => validateCatalogue(JSON.parse(CATALOGUE_TEXT))).not.toThrow();
    expect(catalogue.version).toBe(1);
  });

  it('is 50 buildable now, 52 once the engine catches up', () => {
    // §4b's table, added up by hand:
    //   23 family sprites + 7 Sins + 5 backdrops + 5 class + 5 boss + 3 Sin identities
    //   + 2 altar/shrine = 50.  Deferred: Ash-Wretch and the Warden executioner = 52.
    expect(live.length).toBe(50);
    expect(deferred.length).toBe(2);
    expect(catalogue.assets.length).toBe(52);
  });

  it('breaks down by class exactly as §4b does', () => {
    expect(idsOf('backdrop').length).toBe(5); // one per floor
    expect(idsOf('altar').length).toBe(2); // the altar and the shrine
    expect(idsOf('class-portrait').length).toBe(5); // the five playable classes
    expect(idsOf('enemy-sprite').length).toBe(30); // 23 families + 7 named Sins
    expect(idsOf('boss-portrait').length).toBe(8); // 5 portraits + 3 Sin identities
  });

  it('defers exactly the two §4b names, each with its recorded reason', () => {
    expect(deferred.map((a) => a.id).sort()).toEqual([
      'boss-warden-executioner',
      'enemy-ashWretch',
    ]);
    expect(catalogue.assets.find((a) => a.id === 'enemy-ashWretch')?.deferred).toMatch(
      /enemyFamilies\.json/,
    );
    expect(catalogue.assets.find((a) => a.id === 'boss-warden-executioner')?.deferred).toMatch(
      /does not exist in code/,
    );
  });

  it('ships every prompt as null — authoring them is PLAN.md #4 and #5, not this unit', () => {
    expect(catalogue.assets.every((a) => a.prompt === null)).toBe(true);
    expect(catalogue.assets.every((a) => a.reference === null)).toBe(true);
  });

  it('assigns every asset to a §4 generation stage, in stage order', () => {
    // §4 "Generation order": 1 environments, 2 characters, 3 enemies, 4 bosses. Order matters —
    // "never generate a thing before the thing it must sit against".
    const stages = catalogue.assets.map((a) => a.stage);
    expect([...new Set(stages)].sort()).toEqual([1, 2, 3, 4]);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(live.filter((a) => a.stage === 1).length).toBe(7); // 5 backdrops + altar + shrine
    expect(live.filter((a) => a.stage === 2).length).toBe(5);
    expect(live.filter((a) => a.stage === 3).length).toBe(30);
    expect(live.filter((a) => a.stage === 4).length).toBe(8);
  });

  it('has no duplicate ids', () => {
    expect(new Set(catalogue.assets.map((a) => a.id)).size).toBe(catalogue.assets.length);
  });
});

// =========================================================================================
// AC-31 — the cross-check against the engine's own data
// =========================================================================================

describe('the catalogue follows the engine (AC-31)', () => {
  it('has one sprite per enemy family except sevenSins, and no others', () => {
    // §4b: "the 24 families MINUS sevenSins, which is itemised below" as the seven named Sins.
    const familyIds = FAMILIES.map((f) => f.id).filter((id) => id !== 'sevenSins');
    const catalogueIds = live
      .filter((a) => a.id.startsWith('enemy-'))
      .map((a) => a.id.slice('enemy-'.length));
    expect(catalogueIds.sort()).toEqual(familyIds.sort());
  });

  it('still carries enemy-demons, because the engine still ships the family', () => {
    // §4 rules that `demons` must be removed in the §21.3 family rewrite ("floor 5 is ABSENCE,
    // not destruction") — but it is in enemyFamilies.json TODAY, and the catalogue mirrors the
    // code, not the plan. When the family goes, the check above turns red and this line goes
    // with it. That is the intended sequence: engine first, art second (§4b).
    expect(FAMILIES.some((f) => f.id === 'demons')).toBe(true);
    expect(live.some((a) => a.id === 'enemy-demons')).toBe(true);
  });

  it('does NOT ship a buildable Ash-Wretch, because no such family exists yet', () => {
    expect(FAMILIES.some((f) => f.id === 'ashWretch')).toBe(false);
    expect(live.some((a) => a.id === 'enemy-ashWretch')).toBe(false);
  });

  it('names the seven Sins of §4b as their own assets', () => {
    expect(idsOf('enemy-sprite').filter((id) => id.startsWith('sin-'))).toEqual([
      'sin-pride',
      'sin-envy',
      'sin-wrath',
      'sin-sloth',
      'sin-greed',
      'sin-gluttony',
      'sin-lust',
    ]);
  });

  it('has one portrait per playable class, matching CLASSES in src/game/classKit.ts', () => {
    const fromEngine = Object.keys(CLASSES).map((k) => `class-${k.toLowerCase()}`);
    expect(idsOf('class-portrait').sort()).toEqual(fromEngine.sort());
    expect(fromEngine.length).toBe(5);
  });

  it('takes each enemy asset’s display name from the family itself', () => {
    for (const family of FAMILIES) {
      if (family.id === 'sevenSins') continue;
      const asset = live.find((a) => a.id === `enemy-${family.id}`);
      expect(asset?.name).toBe(family.name);
    }
  });
});

// =========================================================================================
// AC-32 — the style string is the bible's, verbatim
// =========================================================================================

describe('the house style string is §2’s, not a copy that drifted (AC-32)', () => {
  it('equals the §2 "Current candidate" code block', () => {
    expect(squash(catalogue.styleString)).toBe(blockAfter('### Current candidate'));
  });

  it('is NOT the superseded painterly string', () => {
    // A negative control on the extraction above: §2 contains TWO code blocks, and if this test
    // were reading the wrong one it would still "pass" against itself. The painterly string was
    // superseded on 2026-08-25 (§8) and pointing a batch at it would invalidate the whole roster.
    const painterly = blockAfter('### Previous — painterly realism');
    expect(painterly).toContain('Painterly and realistic');
    expect(squash(catalogue.styleString)).not.toBe(painterly);
    expect(catalogue.styleString).not.toContain('Painterly');
  });

  it('carries the NARROWED negative, not the old blanket one', () => {
    // §2's warning box, 2026-08-28: the negative used to read "No text, no lettering, no
    // watermark, no logo", which contradicted three LOCKED §4 specs requiring the Enforcer's
    // insignia, the Undercity's graffiti and the Ash City's signage. In-world lettering is a
    // DEPICTED OBJECT and is permitted; overlaid chrome is not.
    expect(catalogue.styleString).toContain('no logo overlay');
    expect(catalogue.styleString).toContain('no user-interface elements');
    expect(catalogue.styleString).not.toContain('no lettering');
  });
});

// =========================================================================================
// AC-33 — prompt assembly
// =========================================================================================

describe('prompt assembly (AC-33)', () => {
  /** The shipped catalogue with one prompt authored, so assembly can be exercised at all. */
  function withPrompt(id: string, prompt: string): Catalogue {
    const clone = JSON.parse(CATALOGUE_TEXT) as { assets: { id: string; prompt: string | null }[] };
    const target = clone.assets.find((a) => a.id === id);
    if (target === undefined) throw new Error(`no such asset: ${id}`);
    target.prompt = prompt;
    return validateCatalogue(clone);
  }

  const SUBJECT = 'A hunched scavenger in mismatched plate.';

  it('orders it: background sentence, prompt, class append, style string', () => {
    const cat = withPrompt('enemy-gangers', SUBJECT);
    const asset = cat.assets.find((a) => a.id === 'enemy-gangers');
    const prompt = assemblePrompt(cat, asset!);

    expect(prompt.startsWith(cat.backgroundSentence)).toBe(true);
    expect(prompt.endsWith(cat.styleString)).toBe(true);
    expect(prompt.indexOf(SUBJECT)).toBeGreaterThan(prompt.indexOf(cat.backgroundSentence));
    expect(prompt.indexOf(classOf(cat, asset!).append)).toBeGreaterThan(prompt.indexOf(SUBJECT));
    expect(prompt.indexOf(cat.styleString)).toBeGreaterThan(
      prompt.indexOf(classOf(cat, asset!).append),
    );
  });

  it('states "pure flat black background" TWICE for every flat-black class (§3)', () => {
    // §3: "Background: pure flat black, STATED TWICE in the prompt". Once was not enough — probes
    // 01 and 03 both returned a white ground against a single statement.
    for (const cls of ['enemy-sprite', 'boss-portrait', 'class-portrait', 'altar']) {
      const id = live.find((a) => a.class === cls)?.id;
      const cat = withPrompt(id!, SUBJECT);
      const prompt = assemblePrompt(cat, cat.assets.find((a) => a.id === id)!);
      const occurrences = prompt.split('pure flat black background').length - 1;
      expect(occurrences, `${cls} states it ${occurrences} time(s)`).toBeGreaterThanOrEqual(2);
    }
  });

  it('does NOT put a black-background sentence on a backdrop', () => {
    // §5's scope note: backdrops are exempt from the flat-black rule entirely — their grounds are
    // per-floor white by the LOCKED colour ramp.
    const cat = withPrompt('backdrop-ash-city', 'An endless city under deep ash.');
    const prompt = assemblePrompt(cat, cat.assets.find((a) => a.id === 'backdrop-ash-city')!);
    expect(prompt.startsWith('An endless city')).toBe(true);
    expect(prompt).not.toContain('pure flat black background');
  });

  it('enemy and boss appends are §3’s sentence, verbatim, and identical to each other', () => {
    const sentence =
      'Full body, head and feet inside the frame, centered, facing the viewer, isolated on a ' +
      'pure flat black background. No ground, no shadow, no scenery.';
    // The same sentence, present in §3 itself. (The document wraps it across lines, so the
    // comparison is whitespace-normalised.)
    expect(squash(BIBLE)).toContain(sentence);
    expect(catalogue.classes['enemy-sprite']?.append).toBe(sentence);
    // §3's boss row: "Framing per the ENEMY SPRITE rule above … front-facing per §2b, because
    // bosses are enemies and every enemy squares to the viewer."
    expect(catalogue.classes['boss-portrait']?.append).toBe(sentence);
  });

  it('class portraits are three-quarter and NEVER square to the viewer (§2b)', () => {
    // §2b LOCKED: "the angle is the visual difference between 'you' and 'it'". §3's class row
    // used to say "facing the viewer" — the enemy phrase — which would have made the player read
    // as a target. That was corrected 2026-08-28 and must not come back.
    const append = catalogue.classes['class-portrait']?.append ?? '';
    expect(append).toContain('three-quarter');
    expect(append).toContain('never square to the viewer');
    expect(append).not.toContain('facing the viewer');
    // …and full body, not waist-up: the author's "full body shots always", and §6 needs all five
    // recursion assets legibly related.
    expect(append).toContain('Full body, head and feet inside the frame');
    expect(append).not.toContain('waist-up');
  });

  it('backdrops ask for no creatures and a deep-shadow bottom third (§3)', () => {
    const append = catalogue.classes['backdrop']?.append ?? '';
    expect(append).toContain('no creatures, no people');
    expect(append).toContain('bottom third');
    expect(append).toContain('Heavily darkened overall');
  });

  it('refuses to assemble a prompt for an asset that has none', () => {
    const asset = catalogue.assets.find((a) => a.id === 'enemy-gangers');
    expect(() => assemblePrompt(catalogue, asset!)).toThrow(/no authored prompt/);
  });
});

// =========================================================================================
// AC-34 — the request body (§1's settings table)
// =========================================================================================

describe('buildRequest (AC-34)', () => {
  function authored(id: string): { cat: Catalogue; asset: NonNullable<Catalogue['assets'][0]> } {
    const clone = JSON.parse(CATALOGUE_TEXT) as { assets: { id: string; prompt: string | null }[] };
    const target = clone.assets.find((a) => a.id === id);
    target!.prompt = 'A subject.';
    const cat = validateCatalogue(clone);
    return { cat, asset: cat.assets.find((a) => a.id === id)! };
  }

  it('carries §1’s locked settings', () => {
    const { cat, asset } = authored('enemy-gangers');
    const body = buildRequest(cat, asset, null);
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
    expect(body.generationConfig.temperature).toBe(1); // §1: "Do not lower it"
    expect(body.generationConfig.imageConfig.imageSize).toBe('1K');
    expect(cat.model).toBe('gemini-3-pro-image'); // §1: the stable id, never a preview alias
  });

  it('takes the aspect ratio from the asset’s class (§3)', () => {
    // §3 LOCKED: enemy sprites, class portraits, boss portraits and the altar are 1:1; floor
    // backdrops are 16:9.
    const square = ['enemy-gangers', 'boss-kingpin', 'class-enforcer', 'altar'];
    for (const id of square) {
      const { cat, asset } = authored(id);
      expect(buildRequest(cat, asset, null).generationConfig.imageConfig.aspectRatio).toBe('1:1');
    }
    const { cat, asset } = authored('backdrop-true-void');
    expect(buildRequest(cat, asset, null).generationConfig.imageConfig.aspectRatio).toBe('16:9');
  });

  it('without a reference, the parts are the text alone', () => {
    const { cat, asset } = authored('enemy-gangers');
    const parts = buildRequest(cat, asset, null).contents[0]!.parts;
    expect(parts.length).toBe(1);
    expect(parts[0]).toHaveProperty('text');
    expect(JSON.stringify(parts)).not.toContain('inlineData');
    expect(JSON.stringify(parts)).not.toContain(cat.referenceInstruction);
  });

  it('with a reference, the parts are [text, inlineData] and the text says how to use it (§7)', () => {
    const { cat, asset } = authored('enemy-gangers');
    // The 8-byte PNG signature: enough for the format sniff, and fixed by the PNG spec forever.
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const reference = describeReference('art-candidates/anchor.png', bytes);
    const parts = buildRequest(cat, asset, reference).contents[0]!.parts;

    expect(parts.length).toBe(2);
    expect(parts[0]).toHaveProperty('text');
    expect((parts[0] as { text: string }).text).toContain(cat.referenceInstruction);
    expect(parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    });
  });
});

describe('describeReference (§7)', () => {
  const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('hashes the bytes with SHA-256 and base64s them, both independently checkable', () => {
    // sha256 of those 8 bytes, obtained from `sha256sum` AND `certutil -hashfile` — two tools
    // outside this codebase, which agree.
    // base64 worked by hand: 89 50 4E -> iVBO, 47 0D 0A -> Rw0K, 1A 0A -> Ggo=.
    const described = describeReference('anchor.png', SIGNATURE);
    expect(described.sha256).toBe(
      '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
    );
    expect(described.data).toBe('iVBORw0KGgo=');
    expect(described.bytes).toBe(8);
    expect(described.mimeType).toBe('image/png');
    expect(described.path).toBe('anchor.png');
  });

  it('refuses a reference that is not an image', () => {
    expect(() => describeReference('notes.txt', Uint8Array.from([0x68, 0x69]))).toThrow(
      /neither PNG nor JPEG/,
    );
  });
});

// =========================================================================================
// AC-35 — what the tool refuses
// =========================================================================================

describe('selection refuses rather than skipping (AC-35)', () => {
  it('an unknown id', () => {
    expect(() => selectAssets(catalogue, { ids: ['enemy-dragon'], stage: null })).toThrow(
      /Unknown asset id "enemy-dragon"/,
    );
  });

  it('a deferred id, naming the reason', () => {
    expect(() => selectAssets(catalogue, { ids: ['enemy-ashWretch'], stage: null })).toThrow(
      /is deferred: .*enemyFamilies\.json/,
    );
  });

  it('an id with no authored prompt, pointing at who authors it', () => {
    expect(() => selectAssets(catalogue, { ids: ['backdrop-undercity'], stage: null })).toThrow(
      /no authored prompt/,
    );
    expect(() => selectAssets(catalogue, { ids: ['backdrop-undercity'], stage: null })).toThrow(
      /PLAN\.md #4/,
    );
  });

  it('an empty stage', () => {
    expect(() => selectAssets(catalogue, { ids: [], stage: 9 })).toThrow(/No assets in stage 9/);
  });

  it('selects nothing, without throwing, when nothing was asked for', () => {
    expect(selectAssets(catalogue, { ids: [], stage: null })).toEqual([]);
  });

  it('a stage sweep skips deferred assets instead of refusing', () => {
    // `--stage 3` means "the enemies that exist". A typed id is a different matter (above).
    // Stage 3 still refuses here, but on the PROMPT, which every asset lacks today.
    expect(() => selectAssets(catalogue, { ids: [], stage: 3 })).toThrow(/no authored prompt/);
    expect(() => selectAssets(catalogue, { ids: [], stage: 3 })).not.toThrow(/is deferred/);
  });
});

describe('catalogue validation rejects a broken file', () => {
  function broken(mutate: (c: Record<string, unknown>) => void): () => Catalogue {
    const clone = JSON.parse(CATALOGUE_TEXT) as Record<string, unknown>;
    mutate(clone);
    return () => validateCatalogue(clone);
  }

  it('an unknown asset class (AC-35)', () => {
    expect(
      broken((c) => {
        (c['assets'] as { class: string }[])[0]!.class = 'poster';
      }),
    ).toThrow(/unknown class "poster"/);
  });

  it('an unknown gate name', () => {
    expect(
      broken((c) => {
        (c['classes'] as Record<string, { gate: string }>)['backdrop']!.gate = 'vibes';
      }),
    ).toThrow(/gate is "vibes"/);
  });

  it('a malformed aspect ratio', () => {
    expect(
      broken((c) => {
        (c['classes'] as Record<string, { aspectRatio: string }>)['backdrop']!.aspectRatio = 'wide';
      }),
    ).toThrow(/aspectRatio is "wide"/);
  });

  it('a duplicate id', () => {
    expect(
      broken((c) => {
        const assets = c['assets'] as unknown[];
        assets.push(JSON.parse(JSON.stringify(assets[0])));
      }),
    ).toThrow(/two entries with id/);
  });

  it('a future version', () => {
    expect(
      broken((c) => {
        c['version'] = 2;
      }),
    ).toThrow(/version is 2, expected 1/);
  });

  it('text that is not JSON at all', () => {
    expect(() => parseCatalogue('{nope')).toThrow(/not valid JSON/);
  });
});
