// THE GATES, ON SYNTHETIC IMAGES. (AC-17 … AC-22, AC-24's keying half.)
//
// Every fixture is drawn here, pixel by pixel, from a description in `docs/ART-BIBLE.md` — never
// loaded from disk and never a real generated image. Every expected number below is worked out by
// hand in the comment beside it, from the gate's stated rule and the fixture's known pixels. None
// of them was obtained by running the code and writing down what it said.
//
// The two that matter most, because they are the ones a "simplification" would quietly delete:
//
//   * (8,20,8) must fail on CHROMA ALONE. level = max = 20, and the rule is "> maxLevel", so 20
//     does not exceed 20 and the brightness criterion passes. chroma = 20 - 8 = 12 > 10, so the
//     tint criterion fails. This is probe 03's Enforcer take 03 — ART-BIBLE §7, "a very slightly
//     green-tinted ground rather than pure black". Drop the chroma criterion and only this case
//     goes red.
//
//   * A backdrop with a WHITE SKY must PASS. §5's scope note says a literal corner test would
//     reject floor 2 ("blinding white") and floor 4 ("bone white, luminous") on every attempt —
//     an unbounded loop that burns batch money on the first stage generated. Only rows from
//     floor(2H/3) down may be examined. Drop that clamp and only this case goes red.

import { describe, it, expect } from 'vitest';
import { encode as encodeJpeg } from 'jpeg-js';
import {
  bottomThirdGate,
  cornerGate,
  CORNER_ORDER,
  decodeImage,
  describeGate,
  encodePng,
  gateFor,
  luminanceKey,
  sniffMimeType,
  type Raster,
} from './image.ts';

// =========================================================================================
// Fixture builders — plain drawing, no library decisions
// =========================================================================================

type Rgb = [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function solid(width: number, height: number, colour: Rgb): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let o = 0; o < rgba.length; o += 4) {
    rgba[o] = colour[0];
    rgba[o + 1] = colour[1];
    rgba[o + 2] = colour[2];
    rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}

function paint(raster: Raster, x0: number, y0: number, w: number, h: number, colour: Rgb): Raster {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const o = (y * raster.width + x) * 4;
      raster.rgba[o] = colour[0];
      raster.rgba[o + 1] = colour[1];
      raster.rgba[o + 2] = colour[2];
      raster.rgba[o + 3] = 255;
    }
  }
  return raster;
}

function pixel(raster: Raster, x: number, y: number): [number, number, number, number] {
  const o = (y * raster.width + x) * 4;
  return [
    raster.rgba[o] ?? 0,
    raster.rgba[o + 1] ?? 0,
    raster.rgba[o + 2] ?? 0,
    raster.rgba[o + 3] ?? 0,
  ];
}

function toJpeg(raster: Raster, quality: number): Uint8Array {
  const encoded = encodeJpeg(
    { data: Buffer.from(raster.rgba), width: raster.width, height: raster.height },
    quality,
  );
  return new Uint8Array(encoded.data);
}

/** The defaults `catalogue.json` ships (ART-BIBLE §5; starting values, to be tuned after probe 04). */
const CORNERS = { patch: 8, maxLevel: 20, maxChroma: 10 } as const;
const BOTTOM_THIRD = { stride: 8, maxLevel: 40, minDarkFraction: 0.8 } as const;
const KEYING = { lo: 16, hi: 48 } as const;

// =========================================================================================
// AC-17 — decoding, by magic number
// =========================================================================================

describe('decodeImage (AC-17)', () => {
  it('PNG and JPEG decode to the same Raster shape', () => {
    // A 4x4 image is 4 x 4 x 4 bytes = 64 bytes of RGBA, whichever container carried it.
    const source = paint(solid(4, 4, BLACK), 0, 0, 2, 2, WHITE);

    const fromPng = decodeImage(encodePng(source));
    const fromJpeg = decodeImage(toJpeg(source, 100));

    for (const raster of [fromPng, fromJpeg]) {
      expect(raster.width).toBe(4);
      expect(raster.height).toBe(4);
      expect(raster.rgba.length).toBe(64);
      expect(raster.rgba).toBeInstanceOf(Uint8Array);
    }
  });

  it('a PNG round-trips its pixels exactly (PNG is lossless)', () => {
    const source = paint(solid(4, 4, BLACK), 1, 1, 2, 2, [10, 200, 30]);
    const back = decodeImage(encodePng(source));
    expect(Array.from(back.rgba)).toEqual(Array.from(source.rgba));
  });

  it('sniffs the format from the bytes, not from a declared mimeType', () => {
    // The PNG signature starts 89 50 4E 47; every JPEG starts FF D8 FF. Both are fixed by the
    // file formats, not by these libraries.
    const png = encodePng(solid(2, 2, BLACK));
    const jpg = toJpeg(solid(8, 8, BLACK), 100);
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(Array.from(jpg.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(sniffMimeType(png)).toBe('image/png');
    expect(sniffMimeType(jpg)).toBe('image/jpeg');
    expect(sniffMimeType(Uint8Array.from([0x7b, 0x22]))).toBeNull(); // `{"` — a JSON error body
  });

  it('throws on anything else, naming the first bytes', () => {
    // GIF89a. The realistic cause of a non-image payload is a JSON error body, and the first
    // bytes are what tells you that in one glance.
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
    expect(() => decodeImage(gif)).toThrow(/47 49 46 38/);
    expect(() => decodeImage(gif)).toThrow(/expected PNG \(89 50 4e 47\) or JPEG \(ff d8 ff\)/);
  });

  it('throws on empty bytes rather than returning a 0x0 raster', () => {
    expect(() => decodeImage(new Uint8Array(0))).toThrow(/\(empty\)/);
  });
});

// =========================================================================================
// AC-18 — the corner gate on PNG fixtures
// =========================================================================================

describe('cornerGate (AC-18) — patch 8, maxLevel 20, maxChroma 10, on 64x64', () => {
  it('pure black passes with no failed corners', () => {
    // mean (0,0,0) -> level 0 <= 20, chroma 0 <= 10. All four pass.
    const result = cornerGate(solid(64, 64, BLACK), CORNERS);
    expect(result.passed).toBe(true);
    expect(result.failedCorners).toEqual([]);
    expect(result.corners.map((c) => c.level)).toEqual([0, 0, 0, 0]);
  });

  it('a white 8x8 top-left block fails exactly that corner, on level', () => {
    // The patch is 8x8 at (0,0) — exactly the painted block — so its mean is (255,255,255).
    // level 255 > 20 -> 'level'. chroma 255-255 = 0 <= 10 -> NOT 'chroma'.
    const raster = paint(solid(64, 64, BLACK), 0, 0, 8, 8, WHITE);
    const result = cornerGate(raster, CORNERS);

    expect(result.passed).toBe(false);
    expect(result.failedCorners).toEqual(['top-left']);

    const topLeft = result.corners[0];
    expect(topLeft?.corner).toBe('top-left');
    expect(topLeft?.mean).toEqual([255, 255, 255]);
    expect(topLeft?.level).toBe(255);
    expect(topLeft?.chroma).toBe(0);
    expect(topLeft?.reasons).toEqual(['level']);
  });

  it('all white fails all four, in the fixed reading order', () => {
    const result = cornerGate(solid(64, 64, WHITE), CORNERS);
    expect(result.failedCorners).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    expect(result.corners.map((c) => c.corner)).toEqual(CORNER_ORDER);
  });

  it('(12,12,12) — JPEG-floor noise, not a white background — passes', () => {
    // level 12 <= 20, chroma 0. A gate that rejected this would reject every real JPEG of black.
    const result = cornerGate(solid(64, 64, [12, 12, 12]), CORNERS);
    expect(result.passed).toBe(true);
  });

  it('(8,20,8) in the bottom-right fails on CHROMA ONLY — probe 03’s green-tinted ground', () => {
    // The bottom-right patch origin on a 64x64 image with patch 8 is (64-8, 64-8) = (56,56).
    // mean (8,20,8): level = max = 20, and the rule is "> maxLevel", so 20 does NOT exceed 20.
    // chroma = 20 - 8 = 12 > 10 -> fails. ART-BIBLE §7 records exactly this drift.
    const raster = paint(solid(64, 64, BLACK), 56, 56, 8, 8, [8, 20, 8]);
    const result = cornerGate(raster, CORNERS);

    expect(result.failedCorners).toEqual(['bottom-right']);
    const bottomRight = result.corners[3];
    expect(bottomRight?.corner).toBe('bottom-right');
    expect(bottomRight?.mean).toEqual([8, 20, 8]);
    expect(bottomRight?.level).toBe(20);
    expect(bottomRight?.chroma).toBe(12);
    expect(bottomRight?.reasons).toEqual(['chroma']);
  });

  it('a corner both too bright AND too tinted reports both reasons', () => {
    // mean (200,10,10): level 200 > 20, chroma 190 > 10.
    const raster = paint(solid(64, 64, BLACK), 56, 0, 8, 8, [200, 10, 10]);
    const result = cornerGate(raster, CORNERS);
    expect(result.corners[1]?.reasons).toEqual(['level', 'chroma']);
  });

  it('averages the patch rather than trusting one pixel', () => {
    // Half the 8x8 top-left patch white, half black: mean = 255/2 = 127.5 per channel.
    // level 127.5 > 20 -> rejected. A single-pixel probe at (0,0) would see 255 and a probe at
    // (0,7) would see 0 — the patch is what makes the answer stable.
    const raster = paint(solid(64, 64, BLACK), 0, 0, 8, 4, WHITE);
    const result = cornerGate(raster, CORNERS);
    expect(result.corners[0]?.mean).toEqual([127.5, 127.5, 127.5]);
    expect(result.failedCorners).toEqual(['top-left']);
  });

  it('clamps to an image smaller than the patch instead of throwing', () => {
    // 4x4 with patch 8: every corner clamps to the whole 4x4 image.
    expect(() => cornerGate(solid(4, 4, BLACK), CORNERS)).not.toThrow();
    expect(cornerGate(solid(4, 4, BLACK), CORNERS).passed).toBe(true);
    expect(cornerGate(solid(4, 4, WHITE), CORNERS).failedCorners).toEqual([
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);
    // A 1x1 image is still measured, not crashed on.
    expect(cornerGate(solid(1, 1, BLACK), CORNERS).passed).toBe(true);
  });

  it('the clamp CHANGES THE VERDICT on a small image, not just the exception', () => {
    // A uniform fixture cannot test the clamp: an unclamped read runs off the row into the next
    // one (same colour) or off the buffer (reads as 0), and the verdict comes out the same either
    // way. So this fixture is deliberately NOT uniform.
    //
    // 4x4, top row (120,120,120), the other three rows black.
    //   CLAMPED   (w=h=4, 16 samples): 4 x 120 / 16 = mean 30   -> level 30 > 20 -> REJECTED
    //   unclamped on width  (w=8,h=4, 32 samples): 480 / 32 = 15 -> level 15      -> accepted
    //   unclamped on height (w=4,h=8, 32 samples): 480 / 32 = 15 -> level 15      -> accepted
    // Both ways of dropping the clamp flip a rejection into an acceptance, which is the direction
    // that costs money: a bad image kept.
    const raster = paint(solid(4, 4, BLACK), 0, 0, 4, 1, [120, 120, 120]);
    const result = cornerGate(raster, CORNERS);
    expect(result.corners[0]?.mean).toEqual([30, 30, 30]);
    expect(result.corners[0]?.level).toBe(30);
    expect(result.failedCorners).toContain('top-left');
  });

  it('names the failing corners and their means in the human line', () => {
    const raster = paint(solid(64, 64, BLACK), 0, 0, 8, 8, WHITE);
    const line = describeGate(cornerGate(raster, CORNERS));
    expect(line).toContain('REJECTED');
    expect(line).toContain('top-left is not near-black');
    expect(line).toContain('255,255,255');
    expect(line).not.toContain('top-right');
  });
});

// =========================================================================================
// AC-19 — the same gate on a real JPEG, which is all the model can return (§5.3)
// =========================================================================================

describe('cornerGate on JPEG bytes (AC-19)', () => {
  it('a black JPEG passes — compression noise does not trip the gate', () => {
    const raster = decodeImage(toJpeg(solid(64, 64, BLACK), 100));
    const result = cornerGate(raster, CORNERS);
    expect(result.passed).toBe(true);
  });

  it('a white 16x16 top-left block fails exactly that corner', () => {
    // The block is 16x16 so the 8x8 corner patch sits wholly INSIDE it, eight pixels clear of the
    // edge where JPEG ringing lives. The three other corners are deep in black.
    const source = paint(solid(64, 64, BLACK), 0, 0, 16, 16, WHITE);
    const result = cornerGate(decodeImage(toJpeg(source, 100)), CORNERS);
    expect(result.failedCorners).toEqual(['top-left']);
    expect(result.corners[0]?.level).toBeGreaterThan(200);
  });
});

// =========================================================================================
// AC-20 — the bottom-third gate
// =========================================================================================

describe('bottomThirdGate (AC-20) — stride 8, maxLevel 40, minDarkFraction 0.8, on 96x54', () => {
  // The sampling grid, worked out once by hand and reused below:
  //   y0 = floor(2 * 54 / 3) = 36, so rows 36, 44, 52  -> 3 rows
  //   columns 0, 8, 16 … 88                            -> 12 columns
  //   sampled = 3 x 12 = 36
  const SAMPLED = 36;

  it('examines only the bottom third, from row 36 to the last row', () => {
    const result = bottomThirdGate(solid(96, 54, BLACK), BOTTOM_THIRD);
    expect(result.region).toEqual({ y0: 36, y1: 54 });
    expect(result.sampled).toBe(SAMPLED);
  });

  it('all black: darkFraction 1, passes', () => {
    const result = bottomThirdGate(solid(96, 54, BLACK), BOTTOM_THIRD);
    expect(result.dark).toBe(SAMPLED);
    expect(result.darkFraction).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('a white bottom third: darkFraction 0, fails', () => {
    // Rows 36..53 white -> every one of the 36 samples is 255 > 40.
    const raster = paint(solid(96, 54, BLACK), 0, 36, 96, 18, WHITE);
    const result = bottomThirdGate(raster, BOTTOM_THIRD);
    expect(result.dark).toBe(0);
    expect(result.darkFraction).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('a WHITE SKY over a black foreground PASSES — the §5 exemption, and the reason for it', () => {
    // Rows 0..35 white, rows 36..53 black. Floor 2 is "blinding white" and floor 4 is "bone
    // white, luminous" (§4 colour ramp, LOCKED). If the examined region started at row 0 this
    // would fail on every attempt, forever, on stage 1 — §5's named unbounded-loop failure.
    const raster = paint(solid(96, 54, BLACK), 0, 0, 96, 36, WHITE);
    const result = bottomThirdGate(raster, BOTTOM_THIRD);
    expect(result.darkFraction).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('half dark in 16px column stripes: darkFraction exactly 0.5, fails', () => {
    // Stripes of 16px: columns [0,16) dark, [16,32) light, [32,48) dark, [48,64) light,
    // [64,80) dark, [80,96) light. The sampled columns are 0,8 | 16,24 | 32,40 | 48,56 |
    // 64,72 | 80,88 -> 6 dark and 6 light per row, so 18 of 36 samples -> 0.5 < 0.8.
    const raster = solid(96, 54, BLACK);
    for (let stripe = 1; stripe < 6; stripe += 2) paint(raster, stripe * 16, 0, 16, 54, WHITE);
    const result = bottomThirdGate(raster, BOTTOM_THIRD);
    expect(result.dark).toBe(18);
    expect(result.darkFraction).toBe(0.5);
    expect(result.passed).toBe(false);
  });

  it('a lit foreground detail still passes — "roughly the bottom third", not a black bar', () => {
    // One 16px-wide worklight column in the bottom third: sampled columns 0 and 8 are light,
    // 10 of 12 per row are dark -> 30/36 = 0.8333 >= 0.8. §3 asks for a deep-shadow foreground,
    // not an empty one.
    const raster = paint(solid(96, 54, BLACK), 0, 36, 16, 18, WHITE);
    const result = bottomThirdGate(raster, BOTTOM_THIRD);
    expect(result.dark).toBe(30);
    expect(result.passed).toBe(true);
  });

  it('the dark threshold is inclusive: 40 is dark, 41 is not', () => {
    // The rule is "a sample is dark if max(r,g,b) <= maxLevel".
    expect(bottomThirdGate(solid(96, 54, [40, 40, 40]), BOTTOM_THIRD).passed).toBe(true);
    expect(bottomThirdGate(solid(96, 54, [41, 41, 41]), BOTTOM_THIRD).passed).toBe(false);
  });

  it('reports the measured percentage and the examined rows when it rejects', () => {
    const raster = paint(solid(96, 54, BLACK), 0, 36, 96, 18, WHITE);
    const line = describeGate(bottomThirdGate(raster, BOTTOM_THIRD));
    expect(line).toContain('REJECTED');
    expect(line).toContain('0.0% dark');
    expect(line).toContain('rows 36-53');
  });
});

// =========================================================================================
// AC-21 — which gate an asset gets is DATA
// =========================================================================================

describe('gateFor — gate selection comes from the asset class (AC-21)', () => {
  const gates = { corners: CORNERS, bottomThird: BOTTOM_THIRD };

  // ONE fixture, 96x54, all black with an 8x8 white patch at each of the four corner-gate
  // sample origins: (0,0), (96-8,0), (0,54-8), (96-8,54-8) = (0,0), (88,0), (0,46), (88,46).
  function fourWhiteCorners(): Raster {
    const raster = solid(96, 54, BLACK);
    paint(raster, 0, 0, 8, 8, WHITE);
    paint(raster, 88, 0, 8, 8, WHITE);
    paint(raster, 0, 46, 8, 8, WHITE);
    paint(raster, 88, 46, 8, 8, WHITE);
    return raster;
  }

  it('a backdrop PASSES it: only the two bottom patches touch the examined rows', () => {
    // Of the 36 samples, only (0,52) and (88,52) land inside a white patch (rows 46..53).
    // Row 44 is above the patches, row 36 is above them too. dark = 34/36 = 0.9444 >= 0.8.
    const result = gateFor({ gate: 'bottomThird' }, gates)(fourWhiteCorners());
    expect(result.kind).toBe('bottomThird');
    expect(result.passed).toBe(true);
    if (result.kind === 'bottomThird') {
      expect(result.sampled).toBe(36);
      expect(result.dark).toBe(34);
    }
  });

  it('an enemy sprite FAILS the very same pixels, on all four corners', () => {
    const result = gateFor({ gate: 'corners' }, gates)(fourWhiteCorners());
    expect(result.kind).toBe('corners');
    expect(result.passed).toBe(false);
    if (result.kind === 'corners') {
      expect(result.failedCorners).toEqual([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ]);
    }
  });
});

// =========================================================================================
// AC-22 / AC-24 — keying the black out to alpha (§5.3)
// =========================================================================================

describe('luminanceKey (AC-22) — lo 16, hi 48, alpha from max(r,g,b)', () => {
  // alpha = round(255 * clamp((max(r,g,b) - 16) / (48 - 16), 0, 1)). Worked out by hand:
  //   (0,0,0)       max 0   -> (0-16)/32   = -0.50 -> clamp 0    -> 0
  //   (16,16,16)    max 16  -> (16-16)/32  =  0.00 ->             0
  //   (32,32,32)    max 32  -> (32-16)/32  =  0.50 -> 127.5 round 128
  //   (48,48,48)    max 48  -> (48-16)/32  =  1.00 ->             255
  //   (255,255,255) max 255 -> clamp 1     ->                     255
  //   (120,0,0)     max 120 -> (120-16)/32 =  3.25 -> clamp 1 ->  255
  const CASES: readonly [Rgb, number, string][] = [
    [[0, 0, 0], 0, 'flat black background — fully transparent'],
    [[16, 16, 16], 0, 'at lo — still fully transparent'],
    [[32, 32, 32], 128, 'midway — half transparent'],
    [[48, 48, 48], 255, 'at hi — fully opaque'],
    [WHITE, 255, 'white — fully opaque'],
    [[120, 0, 0], 255, 'a dark ember is SUBJECT, not background — fully opaque'],
  ];

  for (const [colour, alpha, why] of CASES) {
    it(`(${colour.join(',')}) -> alpha ${alpha}: ${why}`, () => {
      const keyed = luminanceKey(solid(2, 2, colour), KEYING);
      expect(pixel(keyed, 0, 0)).toEqual([colour[0], colour[1], colour[2], alpha]);
      expect(pixel(keyed, 1, 1)).toEqual([colour[0], colour[1], colour[2], alpha]);
    });
  }

  it('the ember is why the key is max-channel and not Rec.709 luminance', () => {
    // Rec.709 of (120,0,0) is 0.2126*120 = 25.5, so (25.5-16)/32 = 0.297 -> alpha 76: the
    // creature's own ember veins would come out 70% transparent, erased by the step meant to
    // erase the background BEHIND them. The background itself is near-zero in every channel, so
    // both formulas key it identically — the difference only ever hits dark saturated subject
    // pixels, and on those max-channel is right. Recorded deviation from §5.3's literal wording.
    expect(pixel(luminanceKey(solid(1, 1, [120, 0, 0]), KEYING), 0, 0)[3]).toBe(255);
    expect(pixel(luminanceKey(solid(1, 1, [0, 0, 120]), KEYING), 0, 0)[3]).toBe(255);
    expect(pixel(luminanceKey(solid(1, 1, [0, 120, 0]), KEYING), 0, 0)[3]).toBe(255);
  });

  it('leaves RGB exactly as it was — straight alpha, so raw and keyed can be diffed', () => {
    const source = paint(solid(8, 8, BLACK), 2, 2, 4, 4, [200, 40, 10]);
    const keyed = luminanceKey(source, KEYING);
    for (let i = 0; i < keyed.rgba.length; i += 4) {
      expect(keyed.rgba[i]).toBe(source.rgba[i]);
      expect(keyed.rgba[i + 1]).toBe(source.rgba[i + 1]);
      expect(keyed.rgba[i + 2]).toBe(source.rgba[i + 2]);
    }
  });

  it('does not mutate the source raster', () => {
    const source = solid(4, 4, BLACK);
    luminanceKey(source, KEYING);
    expect(pixel(source, 0, 0)[3]).toBe(255);
  });

  it('a keyed sprite survives the PNG round trip with its alphas intact (AC-24)', () => {
    // A 16x16 sprite: black surround, a (200,40,10) body block in the middle.
    const sprite = paint(solid(16, 16, BLACK), 4, 4, 8, 8, [200, 40, 10]);
    const keyed = luminanceKey(sprite, KEYING);
    const back = decodeImage(encodePng(keyed));

    // All four corners fully transparent — the black box around the creature is gone.
    for (const [x, y] of [
      [0, 0],
      [15, 0],
      [0, 15],
      [15, 15],
    ] as const) {
      expect(pixel(back, x, y)).toEqual([0, 0, 0, 0]);
    }
    // The body is untouched and fully opaque.
    expect(pixel(back, 8, 8)).toEqual([200, 40, 10, 255]);
  });

  it('refuses thresholds that are not an increasing range', () => {
    expect(() => luminanceKey(solid(2, 2, BLACK), { lo: 48, hi: 16 })).toThrow(/hi > lo/);
    expect(() => luminanceKey(solid(2, 2, BLACK), { lo: 16, hi: 16 })).toThrow(/hi > lo/);
  });
});
