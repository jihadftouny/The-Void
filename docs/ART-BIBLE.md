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
| **Batch mode** | **`batchGenerateContent` — use it.** **50% of standard cost**, image models supported, target turnaround 24h but usually much faster | Halves the bill: $0.134 → **$0.067** per image. See §1b |

### 1b. Batch mode — the discount and how to keep the approval gates **[LOCKED 2026-08-25]**

The Batch API runs asynchronously **at 50% of standard cost**, and it supports image generation
models. This resolves the apparent trade-off between "generate it all in one go and save money" and
"generate group by group so I can approve as I go" — **you can have both.**

**Batch WITHIN a group, gate BETWEEN groups.** Each group is submitted as one batch job (half
price), the author reviews and approves that group's output, and only then is the next group
submitted — conditioned on the approved references from the group before it. Nothing is lost by
staging it.

| | Standard | Batch |
|---|---|---|
| Per image | $0.134 | **$0.067** |
| The 52-asset run, 156 images | $20.90 | **~$10.45** |
| *(item icons are separate — 68 assets, 204 images)* | *$27.34* | ***~$13.67*** |
| Turnaround | seconds | usually minutes, up to 24h |

The only real cost of batching is latency, and asynchronous turnaround is a poor fit for a *probe*
(where you want an answer in a minute) but a fine fit for a *group of 20–70 images* you are going to
review in a sitting anyway. **Use interactive for probes, batch for groups.**



**Cost at these settings:** $0.134 per image interactive, **$0.067 batched** (§1b).
**The live asset count is in §4b (50 buildable / 52 eventual) plus the item icons in §13 (~68)** — the "39" figure that used to
sit here is superseded and was never updated when the batch grew.
Image generation is **not available on the free tier at all** (`limit: 0`) — billing must be enabled
on the project or every request returns HTTP 429.

---

## 2. The house style string

Appended verbatim to **every** prompt. This is the load-bearing consistency mechanism; changing it
invalidates the roster's coherence.

### Current candidate — **"32-bit era, but 2D"** **[PROBED 2026-08-25, awaiting sign-off]**

Pre-rendered 2D sprite art: Diablo 1, Fallout, early PlayStation. Rendered from 3D and flattened,
dithered, murky, limited palette. **Probe 03 ran 9/9 and the results are strong** — see §7.

```
Pre-rendered 2D game sprite art in the visual style of late-1990s 32-bit era games — Diablo 1,
Fallout, early PlayStation. Rendered from 3D and flattened into a 2D sprite: chunky low-fidelity
forms, visible dithering instead of smooth gradients, a limited muted palette, hard crisp edges,
deliberately coarse resolution. Dark, grim, murky, heavy shadow. Low fidelity that hides detail
rather than showing it. NOT photorealistic, NOT smooth modern rendering, NOT soft or blurry, NOT
cel-shaded, NOT anime. No text, no lettering, no watermark, no logo, no border, no
user-interface elements.
```

**Why this beat the painterly style, on the evidence:**
- **It pairs with the interface instead of fighting it.** The design direction is an austere
  monospace terminal — a grid. Pixel art is also a grid. Painterly realism sat *on* that interface;
  this sits *with* it.
- **It solves the transparency problem almost for free.** §5 failure 3 was that the model cannot
  emit alpha, so sprites needed luminance keying with messy JPEG edge artefacts. Flat colours and
  hard pixel edges key out cleanly — the alpha step becomes reliable instead of delicate.
- **Low fidelity does horror work.** What you cannot quite resolve is worse than what you can.
- **It ages far better** than realism, which matters for a multi-year product.
- **The technical risk did not materialise.** Image models are usually weak at pixel art — blurry
  fake-pixel output, drifting palettes, inconsistent grids. This model held a consistent pixel grid
  and real dithering across all nine images. That was the probe's main question and the answer was
  clean.

### Previous — painterly realism **[SUPERSEDED 2026-08-25]**

Kept for the record; probe 01 used it. Do not use without re-deciding.

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

## 2b. Posing — D&D positioning **[LOCKED 2026-08-25]**

Author's direction: *"let's always make enemies front facing. the characters should be facing
slightly angled, but we want a d&d positioning style for enemies and characters."*

- **Enemies: always front-facing.** Square to the viewer, symmetrical stance, confronting you. This
  is the tabletop read — the thing across the table from you.
- **Player characters: three-quarter, slightly angled.** Turned a little off-axis so they read as
  *actors* rather than *targets*. The angle is the visual difference between "you" and "it".
- This distinction is load-bearing for the recursion set in §6: the mirror enemies (Mirror-Self, The
  Reflection, Echo of You, The Hollowed, Hollow Self) are versions of the player rendered
  **front-facing** — the moment your own reflection squares up to you is the moment it stops being
  you. Do not angle them.

## 2c. Render preference — the PS1 read, not the painted read **[LOCKED 2026-08-25]**

Probe 03 produced two distinguishable interpretations of the style string, and the author picked
between them: **take 02's look, not take 01's.**

- **Wanted (take 02):** genuinely *rendered-from-3D* — chunky low-poly geometry, flat untextured
  surfaces, hard planar shading, particles as sprites, a pure black foreground band. It reads like
  a real-time PS1 scene. Closer to Silent Hill than to an illustration.
- **Not wanted (take 01):** a detailed pixel *painting* — hand-illustrated, dense, painterly
  despite the pixel grid.

Push the prompt toward geometry and flat planar shading, away from illustration and detail density.
Same for the ash-wraith, where take 02 was also the chosen read.

## 3. Per-asset-type rules **[LOCKED]**

### Enemy sprites — 30 (23 families + the 7 named Sins)
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
| 1 | The Undercity | **High** | **Flooded industrial** — standing water with a green chemical sheen, corroded pipe galleries, low metallic fog. Drones, augmetics, riot gear, gangs, fixers. *The last "real" place.* **(§4: the green is in the water and the air, NOT on signage — this is not neon rain)** |
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

### What the world record changes about the art **[LOCKED 2026-08-25 — see `docs/WORLD.md`]**

The worldbuilding interview settled things that directly rewrite prompts. **Read `docs/WORLD.md`
before writing any of them.** The five that matter most here:

1. **The condition is the Hollow, and the floors are stages of it** — fracture, grief, judgement,
   absence. Each backdrop must render its *stage*, not merely its scenery.
2. **Floor 3 is GRIEF, not fear.** The ash is *what you lost*. Mourning and exhaustion, never
   terror — which is also why nothing burns. This is the emotional register for the whole floor,
   creatures included.
3. **Floor 5 is ABSENCE, not destruction.** "There was less of you than you thought." Render it as
   **negative space and things missing**, not as gore, ruin or violence. The Unmade, the Echoes and
   the Hollowed are all saying that in different ways.
4. **Floor 4's angels are REAL.** They must be rendered **solid, present and genuinely beautiful** —
   never ghostly, never ambiguous, never ironic. Floor 4 is the one stage that reveals rather than
   distorts, and grace is real mercy. If the angels read as hallucination, the art has broken the
   game's one hopeful fact.
5. **Techno-occult should look ordinary, not like a mashup.** Magic was industrialised; nobody
   in-world finds a warded riot plate strange. Render it as *equipment* — worn, practical, unremarkable
   to its owner — not as a striking juxtaposition of two aesthetics.

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

### The five classes — costume **[LOCKED 2026-08-25]**

No costume description existed anywhere in the repo; these are now canon. Every one carries the
techno-occult read: street-tech gear marked, wrapped or blessed by someone who has been down there.

| Class | Costume |
|---|---|
| **Enforcer** | Ballistic riot plate, rain-slick, corporate insignia half ground off. Full visor, one cracked lens. Shock baton, haft wrapped in prayer cord. A ward scratched into the chest plate by hand |
| **Neuromancer** | Thin coat, gloved, precise. Pistol holstered but never drawn — the hands are the weapon. Eyes wrong: too still, or not there. **No visible hardware** — see the socket ruling in §9; a Memorian's craft leaves no mark you could point at |
| **Scavver** | Layered scavenged plate, none of it matching. Respirator, goggles pushed up. Rapier and a dozen pouches — wire, hooks, vials. Built for leaving quickly |
| **Penitent** | Coarse robe over surgical scarring. Barefoot. No weapon — the blood is the weapon. A censer, a length of chain. Self-inflicted marks that read as devotion, not damage |
| **Hollow** | Wearing what it wore before, badly. Something missing from the silhouette — negative space where a person should be. Carries a gun it does not seem to need |

### The Undercity — **flooded industrial** **[LOCKED 2026-08-25]**

A sunken industrial level beneath Absolution: standing water with a green chemical sheen, corroded
pipe galleries overhead, dripping runoff, low fog that tastes of metal, failing worklights and
vent-glow, graffiti and tarpaulin shelters against the walls. **The green is what is in the water
and the air, not what is on the signs** — the toxicity is literal, not decorative. It reads as *a
place people were disposed of*, which is exactly what the design says it is: where Absolution sends
its criminals.

~~**Still undescribed anywhere:** the Rift.~~ **CLOSED** — `WORLD.md` §14 puts the **Memorian
extraction facility inside the Rift**, so the location now has content to prompt from.

### Generation order **[LOCKED 2026-08-25]**

Generate in stages, each conditioned on the approved output of the stage before it. The ordering
principle is **what constrains what** — never generate a thing before the thing it must sit against.

| Stage | Group | Why here | Assets |
|---|---|---|---|
| **0** | ~~Worldbuilding interview~~ | ✅ **DONE 2026-08-25 → `docs/WORLD.md`.** Read it before writing any prompt | — |
| **1** | **Environments** — 5 floor backdrops + altar/shrine | Establish light, palette, geometry and tech level for the whole game. Every later asset must read *against* these | 7 |
| **2** | **Characters** — 5 class portraits | Must read against the environments. They also anchor the recursion set, so they cannot come after the enemies that mirror them | 5 |
| **3** | **Enemies** — 23 families + 7 Sins | Conditioned on both. The five mirror-enemies are versions of the *characters*, which must exist first. *(Ash-Wretch deferred — §4b)* | **30** |
| **4** | **Bosses** — 5 portraits + 3 Sin identities | The most specific and most authored assets; they inherit everything above. *(Warden executioner deferred — §4b)* | **8** |
| **5** | **Interface furniture** — if any | Designed *against* finished art, never before it. See the open question below | ? |

**Why interface furniture is last and not first**, against the author's initial instinct: menus and
buttons are the one group whose job is to *not* compete with the art. Designing them before the art
exists means guessing what they must recede behind. They are also the cheapest to iterate and the
easiest to redo.

> **⚠ OPEN — a direction conflict the author must settle.** §5 art direction is *"austere and
> typographic… flat panels, no ornament"*, and it explicitly **rejected** ornamented interface
> furniture (the "grimy occult" option with inked frames and sigils). Generating menu and button art
> would reverse that decision. It is a legitimate thing to reverse — pixel art changes the
> calculation, since a pixel-art interface would *match* pixel-art assets rather than fight them,
> which was the original objection. But it must be decided deliberately, not drifted into.

### The Ash City — **endless and varied** **[LOCKED 2026-08-25]**

Author's direction: *"the ash city is an endless city, with a lot of houses, buildings, varied
architecture throughout it."* Not a ruin-field and not one repeated street — a real city that goes
on past the horizon, with genuinely different buildings: houses beside towers beside civic
structures, many periods and styles jumbled together. The horror is the **endlessness and the
silence**, not destruction. Ash falls over all of it. **Nothing burns — the fire has already gone
out.** The probe backdrop's orange horizon glow is wrong on this point and must be regenerated cold.

**It is a 2100 city gone quiet [LOCKED 2026-08-25]** — author's words — *not* a medieval one. Probe
03 produced castle towers and a cathedral; that is wrong. The variety must reach into the modern and
the near-future: apartment blocks, civic concrete, infrastructure, signage frames with nothing lit on
them, mixed in among older stock. The horror is that this was a **living contemporary city** and
everyone is simply gone.

### Ash-Wraith and Ash-Wretch — **two different enemies** **[LOCKED 2026-08-25]**

The probe creature (a solid charred humanoid with ember veins) was generated under a name that does
not exist in the game. Resolution: keep **both**, as distinct enemies.

- **Ash-Wraith** — the existing family, corrected to match its own design. *Incorporeal*: a human
  outline suspended in drifting ash, edges unravelling into the air, no solid mass, cold pale grey,
  **no embers and no orange**. This fits its role as *"endless weak filler"* and its name table
  (Drifting, Smouldering, Faint, Pale / Cinder, Ember-Shade), and it contrasts properly against the
  solid Nightmares (Grief, Rage, Dread) that share the floor.
- **Ash-Wretch** — a **new** enemy: the solid cracked-cinder humanoid from probe 01. Heavier and
  more physically present than the wraith.

> ⚠ **This is a game-data change, not just an art decision.** A new family must be added to
> `src/data/enemyFamilies.json` with its own tag, element, stat bias, skills, name table entry and
> floor assignment — and it must go through the pipeline like any other engine change, not be hand
> edited. Ash-Wretch adds one asset — but it is **deferred until the family exists in code** (§4b).
> Flagged for the `art-pipeline` unit's plan.

## 4b. The asset list — 50 now, 52 eventually **[CORRECTED 2026-08-27]**

> **⚠ An off-by-one is fixed here.** Earlier versions said 53, by adding "+7 Seven Sins" on top of
> "24 enemy families". But **`sevenSins` IS one of the 24 families** (verified against
> `src/data/enemyFamilies.json`, which has exactly 24 ids including it) — so the seven named Sins are
> a net **+6**, not +7. The old 39-asset budget decomposed as 24 families + 5 backdrops + 5 class +
> 5 boss, which confirms the 24 was always the complete family list.

**Two of the assets are DEFERRED** by the engine-first ruling (2026-08-26): the **Ash-Wretch** has no
`enemyFamilies.json` entry, and the **Warden's executioner form** has no encounter in code — there
are four combat bosses, not five. Art does not run ahead of the engine.

| Group | Count | Notes |
|---|---|---|
| Enemy family sprites | 23 | The 24 families **minus** `sevenSins`, which is itemised below |
| **Seven Sins** | **7** | Pride, Envy, Wrath, Sloth, Greed, Gluttony, Lust — *named elites*, each fighting like its sin (§17.2 of GAME-DESIGN). One becomes your Floor 3 boss |
| Floor backdrops | 5 | 16:9, deep-shadow foreground |
| Class portraits | 5 | Enforcer, Neuromancer, Scavver, Penitent, Hollow |
| Boss portraits | 5 | Kingpin, The Reflection, The Indulged, The Warden (judge), Hollow Self |
| **Sin-boss identities** | **+3** | The Cruelty, The Avarice, The Delusion (The Desecration = the base boss portrait) |
| **Altar / shrine** | **+2** | The sacrifice economy's vendor, plus the shrine that `desecrateShrine` / `leaveOffering` / `honorDead` act on |
| **BUILDABLE NOW** | **50** | **150 images ≈ $10.05 batched** |
| *Ash-Wretch* | *+1* | ⏸ **Deferred** — needs an `enemyFamilies.json` entry first |
| *Warden — executioner* | *+1* | ⏸ **Deferred** — the floor-4 executioner fight does not exist in code |
| **Total once the engine catches up** | **52** | **156 images ≈ $10.45 batched** |

**Item icons are additional** — see §13 (**~68** more assets, **204 images ≈ $13.67** batched).

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

### Probe 03 results — the pixel-art test **[2026-08-25, 9/9 generated, ~$1.21]**

Images at `art-candidates/probe-03-pixel/` (gitignored).

**Enforcer — the techno-occult brief landed exactly.** Scuffed riot plate, a cracked orange visor,
a corporate insignia worn off the shoulder, a baton with its haft wrapped in cord, and a ward
scratched by hand into the chest plate. It reads as security equipment somebody has marked out of
fear. This is the look. *(Take 03 has a very slightly green-tinted ground rather than pure black —
the corner gate in §5 will catch that class of drift.)*

**Ash City — on the corrected brief.** Densely built, architecturally varied, ash lying deep in the
street, purely grey/white/black, **nothing burning**, and a near-black foreground third for text.
**One item for the author:** the architecture skews strongly medieval-gothic (castle towers, a
cathedral) with only a couple of industrial chimneys. Floor 3 is past the technological part of the
descent so this may be right — but if the Ash City should still read as a *2100* city gone quiet,
the prompt needs modern blocks and infrastructure mixed into the jumble.

**Ash-Wraith — the white-background failure recurred.** Same defect as probe 01, in the same place,
despite the prompt demanding a pure black background. **This settles it: the corner-pixel gate in §5
is mandatory, not optional.** The creature itself is also more solid than "incorporeal" specifies —
it dissolves at the edges but has a body. Needs a prompt push toward *less* mass.

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

## 9. Blocking gaps — do not generate until these are answered

The design record was genuinely silent on these. Guessing produced the medieval-Enforcer error.

### Settled 2026-08-25 — the production rules

- **Transparency — key to PNG in post.** Generate on flat black, then a script keys the black out to
  an alpha channel and **the keyed PNG is the committed asset.** Deterministic, reviewable, done
  once. Pixel art makes this far easier than painterly would have — flat colours and hard edges key
  cleanly, with no soft JPEG halo to fight. Adds an image-processing dependency (`sharp` or similar)
  to the **art tooling only**; it never ships in the game bundle and no test touches it.
- **Affixes — code effects, zero new art.** Ravenous, Ancient, Warped, Blessed and Cursed are shader
  and transform treatments over the base sprite: red tint plus faster jitter; desaturation, slow
  drift and dust; a wobble or chromatic split; a pale outline and steady glow; a dark outline and
  black particles. **24 families × 5 affixes = 120 combinations for zero extra assets**, consistent
  with the one-sprite-plus-effects rule, and instantly readable — which matters, because an elite
  that looks identical to a trash mob is a real legibility problem when it hits much harder.
- ~~**Item icons — deferred again, deliberately.**~~ **SUPERSEDED §13 (2026-08-26): bespoke, one icon
  per item, as a fifth batch.** The deadlock broke when the slot set landed. *(Original note:)* M5's Tibia-style inventory is still an unbuilt
  collaborative pass. Icons designed before that screen exists risk being the wrong size, shape or
  density. **Revisit only after the inventory has a real design**, then fit icons to it. Not in any
  batch until then.
- Also settled earlier this session: tech level (§4 techno-occult), the floor colour ramp (§4),
  Floor 4's environment (§4), the asset counts (§4b), posing (§2b), the PS1 render read (§2c),
  one-sprite-no-frames (§3), and no generated interface art (§4 generation order).

### Still open

1. ~~What the five classes wear.~~ **CLOSED** — costumes locked in §4.
2. ~~The Undercity's architecture.~~ **CLOSED** — flooded industrial, §4. **The Rift is also now
   defined** (`WORLD.md` §3): a **real pit**, older than the city, origin genuinely unknown even to
   the Memorians. It is a physical place that can be drawn, and the Kingpin waits at its **entrance**
   — the threshold where you could still have turned back (`WORLD.md` §4).
3. ~~The socket and the apparatus.~~ **CLOSED 2026-08-25 — keep the hardware OUT of the art.**
   No temple sockets, no leads, no visible chip ports, on anyone. The mechanism is carried entirely
   by the prose and the player pieces it together; the images never state it. This preserves the
   ambiguity the design demands and keeps the reveal in the player's head rather than on the screen.

   **But the Hollow is still rendered from what it *is*** (`WORLD.md` §0c — a stripped chip
   reinstalled in someone else's emptied body). Render that as **wrongness of occupancy, not as
   hardware**: clothes that do not fit and were not chosen, a body worn rather than inhabited,
   negative space where a person should be, a posture nobody would hold on purpose. Same for the
   Hollowed, the Echoes and the Hollow Self. **The horror is that it is wearing a person — and no
   visible technology explains why.**
4. ~~Naming: "Ash-Wretch" does not exist.~~ **CLOSED** — Ash-Wraith and Ash-Wretch are now two
   different enemies (§4). The wraith is incorporeal and cold; the wretch is the solid cinder
   humanoid from probe 01. **Still requires a new enemy family in `src/data/enemyFamilies.json`,
   through the pipeline** — tracked in `docs/SCOPE-AUDIT.md`.
5. ~~Karma's world-objects have no art.~~ **CLOSED** — altar and shrine are in the asset list (§4b)
   (§4b), which superseded the 39.
6. ~~The five affixes have no visual treatment.~~ **CLOSED** — code effects, zero new art (§9
   settled list above).
7. **Reference approval.** Nothing has been approved as the style anchor yet, because probe 03's
   three assets were generated before the world record existed and several are now wrong (the Ash
   City is medieval-gothic; it must be a 2100 city gone quiet). **A fourth probe is needed** against
   the finished `WORLD.md`, and one image from it approved, before any conditioned batch runs.
8. **The API key must be rotated.** It was pasted into a chat transcript; it is in `.env` and no
   commit, but the transcript is permanent. Rotate before or immediately after the first batch.

---

## 10. Audio **[DECIDED 2026-08-26]**

Audio was never discussed until now. It is **in scope, at full ambition**, and it is recorded here
rather than in a separate document because it shares this file's pipeline: same API, same key, same
generate → review → commit → gitignore-the-candidates flow.

### Scope — three layers **[LOCKED]**

| Layer | What | Notes |
|---|---|---|
| **Impact effects** | Per combat beat: hit, miss, crit, skill, condition tick, death | The layer that actually makes combat *feel*. Must line up with the beat-by-beat sequencing in `UI-DESIGN.md` §6 |
| **Ambient beds** | One long loop per floor — dripping water and machinery in the flooded Undercity, wind through ash on floor 3, a held choir-tone on floor 4, near-silence on 5 | Cheap, and it does most of the atmospheric work |
| **Music** | **A composed soundtrack per floor** | The author chose the full ambition. See the sourcing note below |

**Restraint rule.** The visual direction is austere and typographic, and the same discipline applies
here: the score must never fight the interface or the silence. `UI-DESIGN.md` §2 chose bookend
narration so that *most rounds are quiet* — audio must preserve that quiet, not fill it. **Silence
between beats is a designed element, not an absence.**

### Sourcing — Lyria is available on the same key **[VERIFIED 2026-08-26]**

Probed live against the project's own key:

| Model | What |
|---|---|
| `lyria-3-pro-preview` | "Lyria 3 Pro Preview" — Google's music generation model, `generateContent` |
| `lyria-3-clip-preview` | "Lyria 3 30s model Preview" — 30-second clips |

**So the soundtrack can be generated through the same tooling as the art**, rather than commissioned
or licence-hunted. Both are `-preview` models, so unlike `gemini-3-pro-image` there is **no stable id
to pin** — record the exact id used in §8 whenever audio is generated, because a preview alias can be
re-pointed or withdrawn.

**Unverified and must be checked before committing to this route:** pricing, whether image-model
billing covers it, output format and length, and **licensing for commercial redistribution in a
paid/free itch release.** Generated *art* and generated *music* can carry different terms. **Do not
assume the art answer applies.**

**Fallback if the licence does not permit it:** licensed library music, or a commission. Ambient beds
and impact effects are far easier to source freely than a score, so a licence problem degrades to
"layers 1 and 2 only" rather than to silence.

### Consequence for `battle-screen` (#6) **[BLOCKING]**

The battle screen **must expose audio hooks on every beat** even if no sound file exists yet —
otherwise adding audio later means reopening the sequencing code. Cheap now; a rewrite afterwards.

---

## 11. Typeface **[DECIDED 2026-08-26]**

**Bundle one open-licence monospace.** The art direction is *typographic* — the type is the design —
so letting the operating system choose it is letting the OS design the game. Today there is no
bundled font and the interface renders differently on Windows, macOS and Linux, which also means
every spacing decision is only true on the machine it was made on.

- **One face, monospace, open licence permitting redistribution.** Roughly 200–400 KB.
- Candidates worth auditioning: **JetBrains Mono** (sharp, technical, very legible), **IBM Plex Mono**
  (institutional, slightly warmer — arguably the most on-theme, since the interface *is* an
  institution's record). Berkeley Mono suits the tone best and is **paid**, so it needs a purchase
  decision before it can be considered.
- **Verify the licence permits bundling in a distributed desktop app** before committing.
- The type scale in `src/render/tokens.ts` was built against a system default and **will need
  re-checking** once a real face is in place.

**Rejected:** a second face for prose. Long narration in monospace is genuinely more tiring to read,
and the split would have been thematically neat — the record is typed, the experience is written.
Recorded in case reading comfort proves to be a problem in play-testing.

---

## 12. Ship assets — beyond the game assets **[DECIDED 2026-08-26, all four in scope]**

None of these were on any list, and a product cannot ship without the first three.

| Asset | Why |
|---|---|
| **App icon + installer art** | Taskbar, dock, installer, itch thumbnail. Electron ships a **default placeholder** otherwise, which reads as unfinished the instant anyone sees it |
| **Title screen art** | The first thing anyone sees; currently styled text on black. One strong image does more marketing work than anything else in the project |
| **itch.io store page art** | Cover, screenshots, banner. Required for a listing — and `itch-description.html` is wrong about nearly everything, so the page is being rebuilt regardless |
| **Cursors + small UI marks** | Custom cursor, loading indicator, and the few small marks an interface needs |

> **Noted tension, deliberately accepted:** cursors and UI marks push against the
> no-generated-interface-art decision (§4 generation order). They are admitted as **small functional
> marks, not chrome ornament** — the rule that the interface stays flat, ruled and unornamented is
> unchanged. If a mark starts decorating rather than indicating, it is wrong.

---

## 13. Item icons — bespoke, one per item **[DECIDED 2026-08-26]**

The deadlock is broken: icons were waiting on an inventory design that was waiting on a collaborative
pass, and **the slot set is now decided** (`GAME-DESIGN.md` §14.7 — seven slots, two trinkets). So
the inventory has a real shape to design against.

**Every item gets its own icon.** Not a slot-and-rarity system.

**Counted against the current data:**

| Source | Items |
|---|---|
| Relics | 15 |
| Uniques | 4 |
| Consumables | 19 |
| Base items | 4 |
| Weapons · armor · shields | **12 · 12 · 2** |
| **Total today** | **68** → ×3 variations = **204 images ≈ $13.67 batched** |

**Two things to be clear-eyed about:**

1. **That total will change.** `weapons.json` and `armor.json` hold **three archetypes × four act
   tiers = twelve entries each**, all placeholder joke names ("Jaaj Sword 1"). **⚠ How many weapons and
   armour pieces the game actually ships is an OPEN DESIGN QUESTION** — and it moves this budget
   directly. The real tables, once authored (#13), will be
   substantially larger — and each new one needs an icon.
2. **This is a permanent commitment, not a one-off cost.** Bespoke icons mean **every item added to
   the game from now on needs art before it can ship.** The $13.67 is not the real price; the ongoing
   obligation is. Accepted deliberately — a memorable inventory is worth it — but it should shape how
   many items get authored.

**Generation:** treat icons as a fifth batch, after bosses, conditioned on the approved style. Same
rules as everything else — flat black ground, keyed to PNG alpha, front-facing, no visible hardware.

---

## 14. Playtesting **[DECIDED 2026-08-26]**

**A small trusted group — five to ten people — given a build and a simple feedback route, before any
public release.**

The current QA plan is one engineer on one laptop with a checklist last touched 2026-08-14. Four
things only other people can tell you:

- whether it **runs on a machine that is not yours** (nothing ever has)
- whether it is **comprehensible without you in the room**
- whether the difficulty reads as **tough-but-fair or simply unfair** — which matters more now that
  there is exactly one difficulty and no assists
- **whether the subject matter lands the way you intend.** This is the one that needs trusted people
  rather than strangers, and it is the reason not to do a public early access first.

---

## 15. The line between ART and INTERFACE **[LOCKED 2026-08-26]**

Raised by the author: *"how does [no interface art] fit with the inventory system that has art for
the items?"* It fits, and the rule that resolves it is the same one §2 already states — it just needs
saying explicitly, because it governs every future asset question.

> **Art depicts things that exist in the world. The interface that frames them stays flat.**

| This is ART — generate it | This is INTERFACE — never generate it |
|---|---|
| Enemy sprites | Panel borders and frames |
| Floor backdrops | Buttons and their states |
| Class and boss portraits | The inventory grid's cells and rules |
| The altar and shrine | Dividers, headers, scrollbars |
| **Item icons** — a relic is a *thing*, like a creature | Ornament of any kind |

An item icon is a **picture of an object in the world**, exactly as an enemy sprite is a picture of a
creature. A panel border is **chrome around it**. So the inventory is a **flat ruled grid** — no
carved frames, no decorated slots — **with art inside the cells.** The icon is the plate; the grid is
the frame; and §2's principle holds unchanged: *the art is what you look at, the interface is what
you read.*

**The test for any future asset:** *does this depict something the player character could see in the
world?* If yes it is art. If it exists only to organise the screen, it is interface, and it stays
typographic.

**Settled with it — the three contradictory passages in this file:** interface furniture is
**confirmed as no generated art**, with a small set of **functional marks** (cursor, loading
indicator) as the only exception, admitted because they *indicate* rather than *decorate*. The
earlier "OPEN — the author must settle" and the table's literal `?` are both closed by this.

---

## 16. The score thins as you descend **[DECIDED 2026-08-27]**

**The music is being taken from you, the same way your life is.**

| Floor | What you hear |
|---|---|
| **1 Undercity** | Real music. Recognisable, structured, almost normal |
| **2 Entrance** | It starts coming apart — fewer instruments, longer gaps |
| **3 Ash City** | A held tone and falling ash. Barely music at all |
| **4 Angelic** | **A choir.** The only genuinely beautiful sound in the game |
| **5 True Void** | Near silence |

**Why this and not five distinct tracks:** the floors are not five places, they are **five stages of
one continuous process** (`WORLD.md` §0c). A score that thins *is* that process, heard. By the True
Void there is almost nothing left to listen to, which is precisely what has been happening to the
player the whole time.

**Floor 4 is the deliberate exception and it should shock.** Everything has been draining away for
three floors, and then there is a choir — because the angels are **real** (`WORLD.md` §6) and floor 4
is the one stage that reveals rather than distorts. **It should be the most beautiful thing in the
game**, and it arrives at the point of maximum deprivation.

**The ascent reverses it.** The Hollow climbs **back into sound** — from near-silence, through the
choir, and up into music. Same five beds walked the other way, so the reversal costs nothing extra to
produce.

> **This composes with the restraint rule (§10):** bookend narration keeps most rounds quiet, and a
> thinning score means the lower floors are quiet *by design* rather than empty. Silence stops being
> an absence and becomes the loudest thing in the game.
