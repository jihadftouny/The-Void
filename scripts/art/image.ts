// THE GATES — the part of the tool that decides whether a generated image is usable.
//
// `docs/ART-BIBLE.md` §5 is titled "Known failure modes and their gates" and says of them:
// "Every one of these must be enforced by the generation script, not by hope." Two failures are
// mechanical and so are checked here:
//
//  §5.1 WHITE BACKGROUNDS, observed 1 in 3. The prompt says "pure flat black background" twice and
//       the image still comes back on white. At 150 images that is ~50 unusable ones. The gate is
//       the four corner patches: if they are not near-black, reject and regenerate.
//
//       BUT NOT FOR BACKDROPS. §5's own scope note is emphatic: the floor colour ramp in §4 makes
//       floor 2 "blinding white + red flecks" and floor 4 "bone white, warm, luminous", so a corner
//       test would reject every backdrop on every attempt — an unbounded loop that burns batch
//       money and never terminates, on the FIRST stage generated. Backdrops get the other gate:
//       §3 asks for "a deep-shadow foreground occupying roughly the bottom third", so that is what
//       is measured. Which gate an asset gets is a field in `catalogue.json`, never a branch here.
//
//  §5.3 NO TRANSPARENCY IS POSSIBLE. The model returns `image/jpeg` only; a prompt demanding a PNG
//       with alpha still returns JPEG. Sprites composite over floor backdrops, so a black box
//       around every creature is unacceptable. The fix §9 settled on: key the black to an alpha
//       channel in post and commit the keyed PNG. `luminanceKey` is that step.
//
// This module is PURE — bytes in, numbers and bytes out. No clock, no filesystem, no network, no
// logging. Everything it reports is a plain number so the manifest and the log can carry it
// (CLAUDE.md principle 7: "Never interpolate a number into a string and lose it").

import { PNG } from 'pngjs';
import { decode as decodeJpeg } from 'jpeg-js';

// =========================================================================================
// Rasters and decoding
// =========================================================================================

/** A decoded image: 4 bytes per pixel, row-major, straight (non-premultiplied) alpha. */
export interface Raster {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** The bytes every PNG starts with (the first four of the 8-byte signature). */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;
/** The bytes every JPEG starts with (SOI + the first marker byte). */
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

function hex(bytes: Uint8Array, count: number): string {
  return Array.from(bytes.slice(0, count), (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/**
 * The media type of `bytes`, by magic number — never by file extension and never by what the API
 * said it was sending. `null` when it is neither format.
 */
export function sniffMimeType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png';
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg';
  return null;
}

/**
 * Decode PNG or JPEG bytes to a `Raster`.
 *
 * The format is sniffed from the CONTENT. The API's declared `mimeType` is not trusted for this:
 * §5.3 records that this model ignores an explicit request for PNG and returns JPEG regardless, so
 * the declared type and the actual bytes are already known to disagree in practice.
 *
 * An unrecognised payload throws naming its first bytes, because the realistic cause is that the
 * "image" is actually a JSON error body — and the first four bytes say so immediately.
 */
export function decodeImage(bytes: Uint8Array): Raster {
  const mime = sniffMimeType(bytes);
  if (mime === 'image/png') {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
  }
  if (mime === 'image/jpeg') {
    const jpg = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: jpg.width, height: jpg.height, rgba: jpg.data };
  }
  throw new Error(
    `Unrecognised image bytes — starts with ${hex(bytes, 8) || '(empty)'}; ` +
      `expected PNG (${hex(Uint8Array.from(PNG_MAGIC), 4)}) or JPEG (${hex(Uint8Array.from(JPEG_MAGIC), 3)})`,
  );
}

/** Encode a `Raster` as PNG bytes. The only format that can carry the alpha channel §5.3 needs. */
export function encodePng(raster: Raster): Uint8Array {
  const png = new PNG({ width: raster.width, height: raster.height });
  png.data = Buffer.from(raster.rgba);
  return new Uint8Array(PNG.sync.write(png));
}

// =========================================================================================
// The corner gate (§5.1) — for the flat-black classes
// =========================================================================================

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Fixed reading order, so a failure list is stable and a manifest diff means something. Reading
 * order (left to right, top to bottom) rather than clockwise, because it is the order a person
 * scanning the image would use.
 */
export const CORNER_ORDER: readonly Corner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/** Why a corner failed. A corner can fail on both. */
export type GateReason = 'level' | 'chroma';

export interface CornerSample {
  corner: Corner;
  /** Arithmetic mean of the patch, per channel. */
  mean: [number, number, number];
  /** `max(mean)` — how bright the corner is at all. */
  level: number;
  /** `max(mean) - min(mean)` — how far from neutral it is. */
  chroma: number;
  passed: boolean;
  reasons: GateReason[];
}

export interface CornerGateOptions {
  /** Side of the square sampled at each corner, in pixels. */
  patch: number;
  /** A corner brighter than this is not black. */
  maxLevel: number;
  /** A corner this far off neutral is a tint, not black. */
  maxChroma: number;
}

export interface CornerGateResult {
  kind: 'corners';
  passed: boolean;
  failedCorners: Corner[];
  corners: CornerSample[];
}

/** The mean colour of a `w`x`h` block whose top-left pixel is (`x0`,`y0`). */
function patchMean(
  raster: Raster,
  x0: number,
  y0: number,
  w: number,
  h: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const o = (y * raster.width + x) * 4;
      r += raster.rgba[o] ?? 0;
      g += raster.rgba[o + 1] ?? 0;
      b += raster.rgba[o + 2] ?? 0;
    }
  }
  const n = w * h;
  return [r / n, g / n, b / n];
}

/**
 * §5.1's gate: are all four corners near-black?
 *
 * A PATCH, not a single pixel, because the failure being caught is a white BACKGROUND and a single
 * pixel is one JPEG artefact away from lying in either direction. 8x8 at 1K is a 0.8% sample of the
 * edge — enough to average out compression noise, small enough that a subject reaching into the
 * corner is a real framing failure worth rejecting anyway.
 *
 * TWO criteria, not one. `level` catches the white-background failure §5.1 names. `chroma` catches
 * the other one probe 03 actually produced and §7 records: Enforcer take 03 came back with "a very
 * slightly green-tinted ground rather than pure black" — dark enough to pass any brightness test,
 * and still not the flat black that keys cleanly to alpha in §5.3.
 *
 * The patch CLAMPS to the image, so a thumbnail smaller than the patch is measured rather than
 * throwing. A gate that crashes on an odd input is a gate that gets switched off.
 */
export function cornerGate(raster: Raster, options: CornerGateOptions): CornerGateResult {
  const w = Math.max(1, Math.min(options.patch, raster.width));
  const h = Math.max(1, Math.min(options.patch, raster.height));
  // `Math.max(0, …)` is belt-and-braces only: `w`/`h` are already clamped to the image above, so
  // these cannot go negative today. It is kept so that loosening the clamp later cannot silently
  // start indexing backwards — but no test pins it, because no decodable image can reach it.
  const right = Math.max(0, raster.width - w);
  const bottom = Math.max(0, raster.height - h);

  const origins: Record<Corner, [number, number]> = {
    'top-left': [0, 0],
    'top-right': [right, 0],
    'bottom-left': [0, bottom],
    'bottom-right': [right, bottom],
  };

  const corners: CornerSample[] = CORNER_ORDER.map((corner) => {
    const [x0, y0] = origins[corner];
    const mean = patchMean(raster, x0, y0, w, h);
    const level = Math.max(mean[0], mean[1], mean[2]);
    const chroma = level - Math.min(mean[0], mean[1], mean[2]);
    const reasons: GateReason[] = [];
    if (level > options.maxLevel) reasons.push('level');
    if (chroma > options.maxChroma) reasons.push('chroma');
    return { corner, mean, level, chroma, passed: reasons.length === 0, reasons };
  });

  const failedCorners = corners.filter((c) => !c.passed).map((c) => c.corner);
  return { kind: 'corners', passed: failedCorners.length === 0, failedCorners, corners };
}

// =========================================================================================
// The bottom-third gate (§3, §5.1's scope note) — for floor backdrops
// =========================================================================================

export interface BottomThirdGateOptions {
  /** Sample every `stride`-th pixel on both axes. */
  stride: number;
  /** A sample no brighter than this counts as dark. */
  maxLevel: number;
  /** The fraction of samples that must be dark for the backdrop to pass. */
  minDarkFraction: number;
}

export interface BottomThirdGateResult {
  kind: 'bottomThird';
  passed: boolean;
  darkFraction: number;
  sampled: number;
  dark: number;
  /** The examined band, `y0` inclusive to `y1` EXCLUSIVE. */
  region: { y0: number; y1: number };
}

export type GateResult = CornerGateResult | BottomThirdGateResult;

/**
 * §3's requirement for floor backdrops: "a deep-shadow foreground occupying roughly the bottom
 * third", so interface text can sit on it without a scrim. That property is what made the Ash City
 * probe succeed, and it is the only thing a backdrop is mechanically checked for.
 *
 * Only rows from `floor(2H/3)` down are examined — the sky is allowed to be anything, which is the
 * whole point of exempting backdrops from the corner gate.
 *
 * A FRACTION rather than an all-or-nothing test, because §3 says "roughly the bottom third" and a
 * real foreground has a lit edge, a worklight, a reflection in standing water. 80% dark is a
 * foreground with detail in it; 100% would demand a black bar, which is not what was asked for.
 */
export function bottomThirdGate(
  raster: Raster,
  options: BottomThirdGateOptions,
): BottomThirdGateResult {
  const stride = Math.max(1, options.stride);
  const y0 = Math.floor((2 * raster.height) / 3);
  let sampled = 0;
  let dark = 0;
  for (let y = y0; y < raster.height; y += stride) {
    for (let x = 0; x < raster.width; x += stride) {
      const o = (y * raster.width + x) * 4;
      const level = Math.max(raster.rgba[o] ?? 0, raster.rgba[o + 1] ?? 0, raster.rgba[o + 2] ?? 0);
      sampled += 1;
      if (level <= options.maxLevel) dark += 1;
    }
  }
  const darkFraction = sampled === 0 ? 0 : dark / sampled;
  return {
    kind: 'bottomThird',
    passed: sampled > 0 && darkFraction >= options.minDarkFraction,
    darkFraction,
    sampled,
    dark,
    region: { y0, y1: raster.height },
  };
}

// =========================================================================================
// Gate selection — data, not a branch
// =========================================================================================

export type GateKind = 'corners' | 'bottomThird';

export interface GateSettings {
  corners: CornerGateOptions;
  bottomThird: BottomThirdGateOptions;
}

/**
 * The gate an asset class gets, read off the class definition in `catalogue.json`.
 *
 * Adding an asset class, or moving one between gates after probe 04 tunes the thresholds, is a
 * JSON edit — never a change here. That is CLAUDE.md principle 3 applied to the gates.
 */
export function gateFor(
  classDef: { gate: GateKind },
  gates: GateSettings,
): (raster: Raster) => GateResult {
  if (classDef.gate === 'bottomThird') {
    return (raster) => bottomThirdGate(raster, gates.bottomThird);
  }
  return (raster) => cornerGate(raster, gates.corners);
}

/** One human-readable line for a gate result — for the terminal and the log message. */
export function describeGate(result: GateResult): string {
  if (result.kind === 'corners') {
    if (result.passed) return 'corners near-black';
    const parts = result.corners
      .filter((c) => !c.passed)
      .map((c) => {
        const mean = c.mean.map((v) => Math.round(v)).join(',');
        return `${c.corner} is not near-black (mean ${mean}; ${c.reasons.join(' and ')})`;
      });
    return `REJECTED — ${parts.join('; ')}`;
  }
  const pct = (result.darkFraction * 100).toFixed(1);
  if (result.passed) return `bottom third ${pct}% dark`;
  return `REJECTED — bottom third only ${pct}% dark (rows ${result.region.y0}-${result.region.y1 - 1})`;
}

// =========================================================================================
// Keying to alpha (§5.3)
// =========================================================================================

export interface KeyOptions {
  /** At or below this level a pixel is fully transparent. */
  lo: number;
  /** At or above this level a pixel is fully opaque. */
  hi: number;
}

/**
 * Key the flat black background out to an alpha channel (§5.3, §9 "Transparency").
 *
 * RECORDED DEVIATION from the literal word "luminance" in §5.3 and §9: alpha comes from
 * `max(r,g,b)`, NOT from Rec.709 luminance (0.2126R + 0.7152G + 0.0722B).
 *
 * The reason is a real asset class in this game. An ember at (120,0,0) — floor-3 cinder, the
 * Ash-Wretch's cracked glow, the Undercity's warning lamps — has Rec.709 luminance ~25, which under
 * a luminance key with these thresholds comes out ~72% TRANSPARENT. The creature's own ember veins
 * would be erased by the step meant to erase the background behind it. Max-channel gives that
 * pixel 255 and keeps it.
 *
 * Nothing is lost by the change: the background being keyed is the flat black §3 demands, which is
 * near-zero in EVERY channel, so both formulas key it identically. The difference only ever shows
 * up on dark saturated SUBJECT pixels, where max-channel is right and luminance is wrong.
 *
 * Straight (non-premultiplied) alpha, which is PNG's convention: RGB is left exactly as it was, so
 * the raw and keyed images differ in one channel and a reviewer can diff them.
 */
export function luminanceKey(raster: Raster, options: KeyOptions): Raster {
  const { lo, hi } = options;
  if (!(hi > lo)) throw new Error(`Keying thresholds must satisfy hi > lo (got lo=${lo}, hi=${hi})`);
  const span = hi - lo;
  const out = new Uint8Array(raster.rgba.length);
  out.set(raster.rgba);
  for (let o = 0; o < out.length; o += 4) {
    const level = Math.max(out[o] ?? 0, out[o + 1] ?? 0, out[o + 2] ?? 0);
    const t = (level - lo) / span;
    out[o + 3] = Math.round(255 * Math.min(1, Math.max(0, t)));
  }
  return { width: raster.width, height: raster.height, rgba: out };
}
