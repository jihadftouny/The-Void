// THE CATALOGUE — what can be generated, and the rules it is generated under.
//
// CLAUDE.md principle 3 (data-driven content) applied to art: every asset id, every aspect ratio,
// every framing sentence, both gates' thresholds and the keying thresholds live in
// `catalogue.json`. Adding an asset, retuning a gate after probe 04, or signing off a different
// style string is a JSON edit. None of it is a change to this file, and none of it is a change to
// `run.ts`.
//
// EVERY `prompt` IN THE SHIPPED CATALOGUE IS `null`, AND THAT IS DELIBERATE. Authoring the prompts
// is `docs/PLAN.md` #4 (probe 04, against the finished `WORLD.md`) and #5 — not this unit. §9.7
// says no conditioned batch may run until one reference image is approved, and §4's Ash City entry
// says probe 03's output is now wrong on the record. So the tool REFUSES to plan an asset whose
// prompt is null rather than inventing one: a guessed prompt is how probe 01 produced a medieval
// Enforcer in a 2100 cyberpunk city.
//
// This module is PURE. No filesystem, no clock, no network. The catalogue TEXT is handed to it.

import type { GateSettings, GateKind, KeyOptions } from './image.ts';
import { sniffMimeType } from './image.ts';
import { createHash } from 'node:crypto';

// =========================================================================================
// Shape
// =========================================================================================

/** How an asset class is framed, gated and post-processed. One row per class in the JSON. */
export interface AssetClassDef {
  /** `imageConfig.aspectRatio` (ART-BIBLE §3). */
  aspectRatio: string;
  /** Which gate its candidates face (§5). */
  gate: GateKind;
  /**
   * Whether passing candidates are keyed to alpha (§5.3).
   *
   * Named `keyMode`, never `key`. In a tool whose central rule is that the API key cannot leak, a
   * field called `key` meaning "alpha keying mode" is a genuine hazard: it makes a `grep -i key`
   * audit of a manifest noisy, and it is the kind of collision a reader resolves wrongly at
   * exactly the wrong moment. (Deviation from the plan's D2 field name, for that reason.)
   */
  keyMode: 'luminance' | 'none';
  /** The framing sentence appended to every prompt in the class (§3). */
  append: string;
}

export interface AssetEntry {
  id: string;
  class: string;
  /** The in-game name, for the terminal and the manifest. Never sent to the model. */
  name: string;
  /** §4 "Generation order": 1 environments, 2 characters, 3 enemies, 4 bosses. */
  stage: number;
  /** `null` until #4/#5 author it. The tool refuses to plan a null-prompt asset. */
  prompt: string | null;
  /** Path to a reference image for §7 conditioning, or `null`. */
  reference: string | null;
  /** Present when the engine has not caught up yet (§4b). The tool refuses these, with this text. */
  deferred?: string;
}

export interface Catalogue {
  version: number;
  note: string;
  model: string;
  imageSize: string;
  temperature: number;
  responseModalities: string[];
  styleString: string;
  referenceInstruction: string;
  backgroundSentence: string;
  classes: Record<string, AssetClassDef>;
  gates: GateSettings;
  keying: KeyOptions;
  assets: AssetEntry[];
}

export const CATALOGUE_VERSION = 1;

const GATE_KINDS: readonly GateKind[] = ['corners', 'bottomThird'];
const KEY_KINDS = ['luminance', 'none'] as const;

// =========================================================================================
// Validation
// =========================================================================================

function fail(what: string): never {
  throw new Error(`catalogue.json is invalid: ${what}`);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${what} is not an object`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') fail(`${what} is not a non-empty string`);
  return value;
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} is not a finite number`);
  return value;
}

/**
 * Validate a parsed catalogue and return it typed.
 *
 * Every failure names the field. This runs before anything else the tool does — including, and
 * especially, before anything that can spend: a typo in an aspect ratio is worth catching for free
 * rather than at $0.067 x 150.
 */
export function validateCatalogue(raw: unknown): Catalogue {
  const root = asRecord(raw, 'the catalogue');

  if (root['version'] !== CATALOGUE_VERSION) {
    fail(`version is ${String(root['version'])}, expected ${CATALOGUE_VERSION}`);
  }

  const classesRaw = asRecord(root['classes'], 'classes');
  const classes: Record<string, AssetClassDef> = {};
  for (const [name, value] of Object.entries(classesRaw)) {
    const def = asRecord(value, `classes.${name}`);
    const gate = asString(def['gate'], `classes.${name}.gate`);
    if (!GATE_KINDS.includes(gate as GateKind)) {
      fail(`classes.${name}.gate is "${gate}", expected one of ${GATE_KINDS.join(', ')}`);
    }
    const keyMode = asString(def['keyMode'], `classes.${name}.keyMode`);
    if (!(KEY_KINDS as readonly string[]).includes(keyMode)) {
      fail(`classes.${name}.keyMode is "${keyMode}", expected one of ${KEY_KINDS.join(', ')}`);
    }
    const aspectRatio = asString(def['aspectRatio'], `classes.${name}.aspectRatio`);
    if (!/^\d+:\d+$/.test(aspectRatio)) {
      fail(`classes.${name}.aspectRatio is "${aspectRatio}", expected the form "W:H"`);
    }
    classes[name] = {
      aspectRatio,
      gate: gate as GateKind,
      keyMode: keyMode as 'luminance' | 'none',
      append: asString(def['append'], `classes.${name}.append`),
    };
  }

  const assetsRaw = root['assets'];
  if (!Array.isArray(assetsRaw)) fail('assets is not an array');
  const assets: AssetEntry[] = [];
  const seen = new Set<string>();
  for (const [index, value] of (assetsRaw as unknown[]).entries()) {
    const a = asRecord(value, `assets[${index}]`);
    const id = asString(a['id'], `assets[${index}].id`);
    if (seen.has(id)) fail(`assets has two entries with id "${id}"`);
    seen.add(id);
    const className = asString(a['class'], `assets[${index}].class`);
    if (classes[className] === undefined) {
      fail(`asset "${id}" has unknown class "${className}"`);
    }
    const prompt = a['prompt'];
    if (prompt !== null && typeof prompt !== 'string') {
      fail(`asset "${id}" has a prompt that is neither a string nor null`);
    }
    const reference = a['reference'];
    if (reference !== null && typeof reference !== 'string') {
      fail(`asset "${id}" has a reference that is neither a path nor null`);
    }
    const deferred = a['deferred'];
    if (deferred !== undefined && typeof deferred !== 'string') {
      fail(`asset "${id}" has a non-string deferred reason`);
    }
    assets.push({
      id,
      class: className,
      name: asString(a['name'], `assets[${index}].name`),
      stage: asNumber(a['stage'], `assets[${index}].stage`),
      prompt: prompt as string | null,
      reference: reference as string | null,
      ...(typeof deferred === 'string' ? { deferred } : {}),
    });
  }

  const gatesRaw = asRecord(root['gates'], 'gates');
  const corners = asRecord(gatesRaw['corners'], 'gates.corners');
  const bottomThird = asRecord(gatesRaw['bottomThird'], 'gates.bottomThird');
  const keying = asRecord(root['keying'], 'keying');

  const modalities = root['responseModalities'];
  if (!Array.isArray(modalities) || modalities.length === 0) fail('responseModalities is not a non-empty array');

  return {
    version: CATALOGUE_VERSION,
    note: asString(root['note'], 'note'),
    model: asString(root['model'], 'model'),
    imageSize: asString(root['imageSize'], 'imageSize'),
    temperature: asNumber(root['temperature'], 'temperature'),
    responseModalities: (modalities as unknown[]).map((m, i) =>
      asString(m, `responseModalities[${i}]`),
    ),
    styleString: asString(root['styleString'], 'styleString'),
    referenceInstruction: asString(root['referenceInstruction'], 'referenceInstruction'),
    backgroundSentence: asString(root['backgroundSentence'], 'backgroundSentence'),
    classes,
    gates: {
      corners: {
        patch: asNumber(corners['patch'], 'gates.corners.patch'),
        maxLevel: asNumber(corners['maxLevel'], 'gates.corners.maxLevel'),
        maxChroma: asNumber(corners['maxChroma'], 'gates.corners.maxChroma'),
      },
      bottomThird: {
        stride: asNumber(bottomThird['stride'], 'gates.bottomThird.stride'),
        maxLevel: asNumber(bottomThird['maxLevel'], 'gates.bottomThird.maxLevel'),
        minDarkFraction: asNumber(bottomThird['minDarkFraction'], 'gates.bottomThird.minDarkFraction'),
      },
    },
    keying: {
      lo: asNumber(keying['lo'], 'keying.lo'),
      hi: asNumber(keying['hi'], 'keying.hi'),
    },
    assets,
  };
}

/** Parse and validate catalogue TEXT. Kept separate so callers can supply text from anywhere. */
export function parseCatalogue(text: string): Catalogue {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`catalogue.json is not valid JSON: ${(err as Error).message}`);
  }
  return validateCatalogue(raw);
}

/** The class definition for an asset. Validation guarantees it exists. */
export function classOf(catalogue: Catalogue, asset: AssetEntry): AssetClassDef {
  const def = catalogue.classes[asset.class];
  if (def === undefined) throw new Error(`asset "${asset.id}" has unknown class "${asset.class}"`);
  return def;
}

// =========================================================================================
// Selection
// =========================================================================================

export interface AssetSelectors {
  /** Explicit ids, in the order the author gave them. */
  ids: string[];
  /** A §4 generation stage (1-4), or `null`. */
  stage: number | null;
}

/**
 * The assets a run will cover, in CATALOGUE order (which is §4's generation order), de-duplicated.
 *
 * Refuses, rather than skipping, on every bad selector. A tool that silently drops an id the author
 * typed produces a batch that is quietly missing an asset — and the author finds out after paying
 * for it.
 */
export function selectAssets(catalogue: Catalogue, selectors: AssetSelectors): AssetEntry[] {
  const byId = new Map(catalogue.assets.map((a) => [a.id, a]));
  const wanted = new Set<string>();

  for (const id of selectors.ids) {
    const asset = byId.get(id);
    if (asset === undefined) {
      throw new Error(
        `Unknown asset id "${id}". Run with --list to see every id in the catalogue.`,
      );
    }
    wanted.add(id);
  }

  if (selectors.stage !== null) {
    const inStage = catalogue.assets.filter((a) => a.stage === selectors.stage);
    if (inStage.length === 0) {
      throw new Error(
        `No assets in stage ${selectors.stage}. ART-BIBLE §4 "Generation order" defines stages 1-4.`,
      );
    }
    for (const a of inStage) {
      // A stage sweep skips deferred assets rather than refusing: `--stage 3` means "the enemies
      // that exist", and the Ash-Wretch does not exist in the engine yet (§4b). An id typed by
      // HAND is a different matter and is refused below.
      if (a.deferred === undefined) wanted.add(a.id);
    }
  }

  const selected = catalogue.assets.filter((a) => wanted.has(a.id));

  for (const asset of selected) {
    if (asset.deferred !== undefined) {
      throw new Error(`Asset "${asset.id}" is deferred: ${asset.deferred}`);
    }
    if (asset.prompt === null) {
      throw new Error(
        `Asset "${asset.id}" has no authored prompt. Prompts are PLAN.md #4 (probe 04) and #5 — ` +
          `write one into catalogue.json, or point --catalogue at a probe catalogue. ` +
          `ART-BIBLE §9.7: no conditioned batch runs before a reference is approved.`,
      );
    }
  }

  return selected;
}

// =========================================================================================
// Prompt assembly (§2, §3)
// =========================================================================================

/**
 * Is this class generated on flat black (and therefore corner-gated and keyed)?
 *
 * Read off the GATE, and the equivalence is definitional rather than coincidental: the corner gate
 * in §5.1 exists precisely to check that the background is flat black, and §5's scope note exempts
 * the one class whose ground is not (backdrops). A separate "background" field would be a second
 * source of truth that could disagree with the gate, which is worse than deriving it.
 */
export function isFlatBlackClass(def: AssetClassDef): boolean {
  return def.gate === 'corners';
}

/**
 * The full prompt for an asset: background sentence (flat-black classes only), the authored
 * prompt, the class framing append (§3), then the house style string (§2, "appended verbatim to
 * every prompt — this is the load-bearing consistency mechanism").
 *
 * The background sentence is PREPENDED as well as being inside the class append, which is not
 * redundancy by accident: §3 requires "pure flat black, STATED TWICE in the prompt", because once
 * was not enough — probe 01 and probe 03 both returned white grounds against a single statement.
 */
export function assemblePrompt(catalogue: Catalogue, asset: AssetEntry): string {
  if (asset.prompt === null) {
    throw new Error(`Asset "${asset.id}" has no authored prompt`);
  }
  const def = classOf(catalogue, asset);
  const parts = isFlatBlackClass(def)
    ? [catalogue.backgroundSentence, asset.prompt, def.append, catalogue.styleString]
    : [asset.prompt, def.append, catalogue.styleString];
  return parts.map((p) => p.trim()).join(' ');
}

// =========================================================================================
// Reference conditioning (§7)
// =========================================================================================

export interface ReferencePayload {
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  /** Base64 of the image, for `inlineData`. Never logged and never put in the manifest. */
  data: string;
}

/**
 * Describe a reference image for §7 conditioning.
 *
 * The sha256 is what goes in the manifest, not the image: it identifies exactly which approved
 * reference a batch was conditioned on, in 64 characters, so a later run can prove it used the
 * same one. §9.7 is the reason that matters — "nothing has been approved as the style anchor yet",
 * so the first thing that is approved must be traceable from then on.
 */
export function describeReference(path: string, bytes: Uint8Array): ReferencePayload {
  const mimeType = sniffMimeType(bytes);
  if (mimeType === null) {
    throw new Error(`Reference image "${path}" is neither PNG nor JPEG`);
  }
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mimeType,
    data: Buffer.from(bytes).toString('base64'),
  };
}

// =========================================================================================
// The request body (§1)
// =========================================================================================

export type RequestPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GenerateContentRequest {
  contents: { role: 'user'; parts: RequestPart[] }[];
  generationConfig: {
    responseModalities: string[];
    temperature: number;
    imageConfig: { aspectRatio: string; imageSize: string };
  };
}

/**
 * One `generateContent` request body, per ART-BIBLE §1's settings table.
 *
 * `temperature` comes from the catalogue and is 1 — the model default, and §1 says "This is what
 * produces variation between the 3 takes of each asset. Do not lower it." Three takes at
 * temperature 0 would be three copies of the same image and the author would have no choice to
 * make.
 */
export function buildRequest(
  catalogue: Catalogue,
  asset: AssetEntry,
  reference: ReferencePayload | null,
): GenerateContentRequest {
  const def = classOf(catalogue, asset);
  const prompt = assemblePrompt(catalogue, asset);
  const text = reference === null ? prompt : `${prompt} ${catalogue.referenceInstruction}`;

  const parts: RequestPart[] = [{ text }];
  if (reference !== null) {
    parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.data } });
  }

  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: [...catalogue.responseModalities],
      temperature: catalogue.temperature,
      imageConfig: { aspectRatio: def.aspectRatio, imageSize: catalogue.imageSize },
    },
  };
}
