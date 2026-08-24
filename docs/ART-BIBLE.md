# The Void — Art Bible

_The single reference for generating this game's art. **Any future run must read this file before
generating a single image**, and must update it when anything changes. Its purpose is that a run six
months from now produces art indistinguishable from today's._

**Status tags:** **[LOCKED]** decided and reproducible · **[PENDING]** awaiting the author ·
**[DERIVED]** taken from `docs/GAME-DESIGN.md`, not invented here.

Companion documents: `docs/UI-DESIGN.md` §5 and §9 (why this art exists and where it sits),
`docs/GAME-DESIGN.md` (the world), `.env.example` (the key).

---

## 1. Reproduction — exact settings **[LOCKED]**

Everything needed to reproduce the look. Do not change any of these without recording it in §8.

| Setting | Value | Why |
|---|---|---|
| Provider | Google AI Studio / Gemini API, `v1beta` | — |
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | Batch alternative: `batchGenerateContent`, supported by all image models |
| **Model** | **`gemini-3-pro-image`** | "Nano Banana Pro". **Use the stable id, never `nano-banana-pro-preview`** — a preview alias can be re-pointed or withdrawn without notice |
| **Resolution** | **`imageConfig.imageSize: "1K"`** | Same price as 2K on this model, so this is a file-size choice. See §8 watch-item on backdrops |
| Modality | `generationConfig.responseModalities: ["IMAGE"]` | — |
| Temperature | `1` (the model default) | This is what produces variation between the 3 takes of each asset. Do not lower it |
| Auth | header `X-goog-api-key`, value read from gitignored `.env` → `GOOGLE_API_KEY` | **Never** inline a key, commit one, or log one |
| Output format | `image/jpeg` — **always, unavoidably** | See §5. The model cannot emit PNG or alpha, whatever the prompt asks |
| Aspect ratio | per asset type — see §3 | `imageConfig.aspectRatio` |
| Variations | **3 per asset**, generated concurrently within an asset, sequential across assets | Keeps request rate sane and gives a real choice |

**Cost at these settings:** $0.134 per image. 39 assets × 3 = 117 images ≈ **$15.68** per full batch.
Image generation is **not available on the free tier at all** (`limit: 0`) — billing must be enabled
on the project or every request returns HTTP 429.

---

## 2. The house style string **[LOCKED]**

Appended verbatim to **every** prompt. This is the load-bearing consistency mechanism; changing it
invalidates the roster's coherence.

```
Dark horror concept art for a video game. Muted, desaturated palette. Painterly and realistic
rendering, not stylised, not inked, not cel-shaded. A single clearly-lit subject with a strong
readable silhouette. High contrast against deep shadow. No text, no lettering, no watermark, no
logo, no frame or border, no user-interface elements.
```

**The governing principle, from `docs/UI-DESIGN.md` §5:** the art is a **plate, not decoration**.
The interface around it is austere, flat and typographic. *The art is what you look at; the interface
is what you read.* **If a generated asset starts competing with the interface type, the asset is
wrong, not the type.**

**The two-word tonal north star,** taken from the narrator persona in `src/llm/narrate.ts`:
**"concrete and unsettling."** It governs the images exactly as it governs the prose.

---

## 3. Per-asset-type rules **[LOCKED]**

### Enemy sprites — 24, one per family
- **Aspect `1:1`.**
- **Framing is strict and non-negotiable: full body, head and feet both inside the frame, roughly
  10% margin, subject centred, facing the viewer.** The roster must sit in one on-screen frame; per
  enemy zoom is the single most damaging inconsistency available.
- **Background: pure flat black, stated twice in the prompt** — and verified by the corner gate in
  §5. Never white, never a scene, never a ground shadow.
- Append: `Full body, head and feet inside the frame, centered, facing the viewer, isolated on a
  pure flat black background. No ground, no shadow, no scenery.`

### Floor backdrops — 5, one per floor
- **Aspect `16:9`.**
- **Must have a deep-shadow foreground occupying roughly the bottom third**, so interface text can
  sit on it without a scrim. This is the property that made the Ash City probe succeed.
- Environment only: **no creatures, no people, no focal character.**
- Heavily darkened overall — it sits *behind* everything and must never compete.

### Class portraits — 5
- **Aspect `1:1`.**
- Waist-up or three-quarter, facing the viewer, on pure flat black.
- These are the player's self-image; they must relate visibly to the mirror-enemies (§6).

### Boss portraits — 5
- **Aspect `1:1`.** Same treatment as class portraits but larger presence and more detail budget.

---

## 4. World rules the prompts must obey **[DERIVED]**

**Read this before writing any prompt.** The first probe failed on genre because it was written from
generic dark-fantasy instinct instead of the design. The setting is **year 2100, the capital city of
Absolution** — cyberpunk *with magic treated as normal* (an "Arch-Mage" gives you the mission; his
data-extraction specialists are "Memorians"; you are sent to retrieve **brainchips**). It is not hard
science fiction and it is not straight fantasy.

**The cyberpunk gradient is the most important single rule.** Technology is concentrated on Floor 1
and dies out completely as you descend:

| Floor | Name | Tech level | Imagery |
|---|---|---|---|
| 1 | The Undercity | **High** | Neo-noir: rain, neon, grime. Drones, augmetics, riot gear, gangs, fixers. *The last "real" place* |
| 2 | Entrance to the Void | **Near zero** | *"Blinding white, red reflections, distortion."* Mirrors, doubles, static, signal. Onset of madness |
| 3 | The Ash City | **Zero** | *"Endless grey city, falling ash, silence."* Emotions made flesh; the Seven Sins |
| 4 | The Angelic Underground | **Zero** | *"Luminous, sacred, beautiful."* Angels, choirs, the judged. The moral crucible |
| 5 | The True Void | **Zero** | *"Black, dark, hellish."* Demons, void-horrors, what you may become |

### The tech level — **techno-occult** **[LOCKED 2026-08-25]**

**The player characters are both technological and occult at once, and that is the point.** The
setting already establishes magic as normal — an Arch-Mage gives the mission, his data-extraction
specialists are "Memorians", and Electro sits beside Psychic as an equal element. So gear reads
*both* ways: riot plate with a ward scratched into it by hand, an augmetic shaped like a reliquary,
a shock baton with its haft wrapped in prayer cord.

**Why this and not straight cyberpunk:** it is the only reading that survives the descent. The
player walks from neon into angels; a pure riot-cop silhouette stops making sense on Floor 4 and is
absurd on Floor 5. Gear that was *always* half-ritual simply changes meaning as you go down —
equipment on Floor 1, superstition on Floor 3, and on Floor 5 it looks like it was liturgical all
along. **The costume itself tells the story of the descent.** Rejected: fully cyberpunk (breaks
below Floor 2) and full dark fantasy (contradicts 2100, brainchips and "rain, neon, grime").

### The floor colour ramp **[LOCKED 2026-08-25 — author's own words]**

| Floor | Accent | Author's direction |
|---|---|---|
| 1 The Undercity | **Toxic green** | *"undercity is green and toxic"* — sickly, chemical, contaminated. **Not** sodium amber, **not** magenta neon |
| 2 Entrance to the Void | **Blinding white + red flecks** | *"blinding white with red flecks"* — matches the design doc's own "blinding white, red reflections" |
| 3 The Ash City | **White, grey and black only** | *"purely white gray and black, the fire has settled already and it's just ash"* |
| 4 The Angelic Underground | **Bone white** | warm, luminous, sacred |
| 5 The True Void | **Arterial red** | black cannot be an accent against a near-black interface — the accent is the thing burning in the dark |

**⚠ This OVERRULES the "ash-orange" written in `docs/UI-DESIGN.md` §5 and the `#c86a2a` accent the
`ui-foundation` unit implemented.** The fire in the Ash City is *out*. Nothing there glows. The
probe's Ash City backdrop — which had a dull orange glow on the horizon — is **wrong on this point**
and must be regenerated cold. Ash is what is left after the burning, not the burning.

**Distinguishing floors 3 and 4, since both are pale:** Floor 3 is **cold neutral grey** — dead,
empty, drained. Floor 4 is **warm bone** — sacred, lit, alive. Cold versus warm is the whole
difference, and it carries the meaning: emptiness against grace.

### Floor 4's environment **[LOCKED 2026-08-25]**

**Ancient overgrown ruins opening into a buried city.** You come through ruins with pale trees
rooted in broken stone, and the City of Angels stands below in a vast cavern **lit from within, not
from any sky**. This reconciles the current design ("Angelic Underground", luminous, sacred) with
the original Java description ("ancient ruins, vast forests… then you find the City of Angels") and
keeps "Underground" literally true — while giving the backdrop a genuine light source, so the sacred
reads as beautiful rather than ironic.

**Hard prohibitions:**
- **No technology whatsoever on floors 3, 4 and 5.** No wires, no metal plating, no machinery.
- **Never signpost mental illness.** No asylums, straitjackets, pills, or clinical/medical imagery.
  `docs/UI-DESIGN.md` explicitly *rejected* a clinical direction. The psychosis theme is felt through
  the descent, never named or metered — `GAME-DESIGN.md` §13: *"the player should feel it and be
  unable to point at the 'sanity mechanic,' because there isn't one."*
- **Floor 2's illusions must look exactly as solid as real things.** The mechanic is "you can't trust
  what you see" — an obviously-ghostly illusion defeats its own gameplay.
- **Floor 4's light must genuinely read as beautiful, not ironic.** Grace is a real ending: *"rises
  from the Void, made whole."* The author's own framing is **survivor**, not sufferer. This is not a
  nihilism piece.

**Elements** (for colour cues): Physical, Cryo, Pyro, Electro, Poison, Psychic, **Force**. Force is
this game's *holy* damage type — angels, choirs and the Penitent all use it.

**The economy has no money.** *"No currency. No coin. Anywhere. Ever."* You pay with pieces of
yourself at an **altar**. Never draw coins, gold, or a shop.

---

## 4b. The asset list — 52 assets **[LOCKED 2026-08-25]**

Raised from 39 to 52 because the original budget silently compromised three things the design
actually needs. 52 × 3 variations = **156 images ≈ $20.90**.

| Group | Count | Notes |
|---|---|---|
| Enemy family sprites | 24 | One per family in `src/data/enemyFamilies.json` |
| **Seven Sins** | **+7** | Pride, Envy, Wrath, Sloth, Greed, Gluttony, Lust — *named elites*, and one becomes your Floor 3 boss. Sharing one sprite would be very visible |
| Floor backdrops | 5 | 16:9, deep-shadow foreground |
| Class portraits | 5 | Enforcer, Neuromancer, Scavver, Penitent, Hollow |
| Boss portraits | 5 | Kingpin, The Reflection, The Indulged, The Warden, Hollow Self |
| **Sin-boss identities** | **+3** | The Cruelty, The Avarice, The Delusion (The Desecration = the base boss portrait). The Floor 3 boss is *"your most-indulged sin made flesh, personal to each run"* — that lands far weaker if it looks identical every time |
| **Warden — executioner form** | **+1** | The Warden has two mutually exclusive presentations: a merciful judge, or a punishing executioner. The judge is the base portrait |
| **Altar / shrine** | **+2** | The sacrifice economy's vendor is an *"altar/stranger"*, and `desecrateShrine` / `leaveOffering` / `honorDead` are implemented actions. These had **no art at all** in the original budget |
| **Total** | **52** | |

## 5. Known failure modes and their gates **[LOCKED]**

Learned from probe 01. **Every one of these must be enforced by the generation script, not by hope.**

1. **White backgrounds — observed 1 in 3.** The prompt said "pure flat black background" twice and
   one image still came back on white. At batch scale that is ~8 unusable images.
   **Gate: sample the four corner pixels; reject and regenerate anything whose corners are not
   near-black.** Cheap, deterministic, catches it every time.
2. **Framing drift.** One take was full-body with margin, another cropped at mid-thigh and much
   closer. **Gate: the explicit framing sentence in §3, plus reference-image conditioning (§7).**
3. **No transparency is possible.** The model returns `image/jpeg` only. A prompt explicitly
   demanding a transparent alpha channel and a PNG *still* returned JPEG — the format physically
   cannot carry alpha. Since sprites composite over floor backdrops, a black box around every
   creature is unacceptable. **Fix: post-process to PNG with a luminance-keyed alpha channel and
   commit the keyed PNG as the final asset.** Deterministic, reviewable, done once. (Rejected
   alternatives: additive blending in Kaplay — free, flatters embers, but eats the creature's own
   dark mid-tones; a radial edge fade — cheapest and weakest.)

---

## 6. Recursion — the five faces of the player **[DERIVED]**

Five separate assets are all *versions of the player* and **must be legibly related to each other and
to the class portraits**. This is the spine of the game's theme and the easiest thing to get wrong by
generating them independently:

`Mirror-Self` (F2 family) → **The Reflection** (F2 boss) → `Echo of You` (F5 family) →
`The Hollowed` (F5 family) → **Hollow Self** (F5 boss)

Generate these *after* the class portraits, conditioned on them.

---

## 7. Reference-image conditioning **[LOCKED as method]**

The strongest consistency lever available. The API accepts image input, so **once one asset is
approved it is passed as a style-and-framing reference for the rest of its class.** Use it for all 24
enemies and for the recursion set in §6.

### The approved reference **[PENDING — see §9]**
Author's direction from probe 01, recorded verbatim:

> "ash wretch 01 is the best but i liked the creative aspect in 03, feel free to do variations
> around it, but full body shots always."

**Interpretation:** take **01's full-body framing and clarity**, combine it with **03's rendering
quality and drama** (03 was the more painterly, more atmospheric take), always on black. 01's actual
background was the white failure, so its *framing* is the reference, never its ground.

Probe images are kept at `art-candidates/probe-01/` (gitignored — regenerate rather than rely on
them persisting).

---

## 8. Change log

Every deviation from §1 or §2 gets a line here, with the reason. An undocumented change is a bug.

- **2026-08-24** — Bible created. Model, resolution, style string, framing rules and the three
  failure gates locked from probe 01 (9/9 generated, ~$1.21).
- **Watch item, open:** the full-bleed floor backdrops are the one asset class that might want 2K on
  a large desktop window. If a 1K backdrop looks soft in review, **raise only the backdrops** to 2K —
  not the whole batch. Same price either way.

---

## 9. Blocking gaps — do not generate until these are answered **[PENDING]**

The design record is genuinely silent on these. Guessing produced the medieval-Enforcer error.

**RESOLVED 2026-08-25:** tech level (§4 — techno-occult), the floor colour ramp (§4), Floor 4's
environment (§4), and the asset-count mismatches (§4b — 52 assets). Still open:

1. **What the five classes actually wear.** The tech level is now settled, but there is still *zero*
   costume, silhouette, species, age or gender description for Enforcer, Neuromancer, Scavver,
   Penitent or Hollow. All current gear ids are placeholder joke names ("Jaaj Sword 1", "Jooj Gun
   1"). Note both the Neuromancer and the Hollow are currently issued *a gun*.
2. **The Undercity's architecture.** "Rain, neon, grime" is three words — and the accent is now
   *toxic green*, which suggests contamination rather than neon signage. Sunken sublevel? Slum
   canyon? Megablock? Flooded industrial works? And **the Rift** — the doorway from Floor 1 to Floor
   2 — has no description at all anywhere.
3. **Naming: "Ash-Wretch" does not exist.** The probe and the `UI-DESIGN.md` mockup both use it, but
   the actual family is **`ashWraiths` / "Ash-Wraith"**, whose design hook is *"endless weak filler"*
   and whose name table (*Drifting, Smouldering, Faint, Pale / Cinder, Ember-Shade*) suggests
   something far more **incorporeal** than the solid charred humanoid that was generated.
8. **Karma's world-objects have no art.** `desecrateShrine`, `leaveOffering` and `honorDead` are
   implemented actions, and the sacrifice economy's vendor is an **altar/stranger** — yet no shrine,
   altar or offering asset is in the 39.
9. **The five affixes** (Ravenous, Ancient, Warped, Blessed, Cursed) rename an enemy but have no
   visual treatment and no budget line. Recolour? Aura? Nothing?
