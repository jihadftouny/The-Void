# The Void — UI design record (M-UI2: the turn-based battle screen + whole-game restyle)

_Authoritative record of the UI scope decided in the 2026-08-24 scope interview. Same status tags as
`docs/GAME-DESIGN.md`: **DECIDED** (locked), **PROPOSAL** (my recommendation, not yet confirmed),
**OPEN** (still needs the engineer). Milestone plan: `docs/ROADMAP.md`. Build state: `PROGRESS.md`._

---

## 0. Why this exists

The engine is finished and merged (M1–M15, 960 tests). The UI is not. Today the battle screen is a
220-pixel sidebar of plain text lines plus a flat row of buttons: you press **Fight**, a line of
narration replaces the last one, and two numbers change in the corner. It does not read as a fight,
and it hides almost everything the engine actually computes — 24 status conditions, dice rolls,
skill charges, affixes, per-round exchanges. This document is the plan for fixing that.

The guiding constraint is unchanged from `CLAUDE.md` §1: **all of this is render layer.** Not one
rule, number or random decision moves into the UI. Everything below reads engine state and forwards
input; the engine stays headlessly testable and reproducible from its seed.

---

## 1. Battle screen — layout **[DECIDED]**

**JRPG framed.** The enemy occupies a large framed stage in the centre of the screen; your stat box
sits bottom-left; the action menu sits bottom-right; a thin ticker carries the most recent combat
line, with the full log expandable.

```
┌──────────────────────────────────────────────┐
│                                              │
│              ╔══════════════╗                │
│              ║   [ enemy ]  ║                │
│              ╚══════════════╝                │
│           ASH-WRETCH  ███████░░ 34/60        │
│           ☠ Burning (2)  ⌁ Staggered (1)     │
│                                              │
│  » You strike for 8. It claws you for 6.     │
├───────────────────────┬──────────────────────┤
│ JIHAD  Enforcer lv4   │  ▸ Fight             │
│ HP █████████ 41/52    │    Cast              │
│ ⚡ 3/5   Rage 2       │    Item              │
│ ⌁ Guarded (2)         │    Potion / Spare    │
└───────────────────────┴──────────────────────┘
```

Everything in that frame already exists in engine state and is simply not being shown today: the
enemy's family and affix, both HP pools, the active conditions on both sides with their remaining
duration, skill charges, and the class build-resource.

**Rejected:** a stacked arena (enemy top / you bottom / log middle) and a two-column arena. Both are
cheaper and both read fine, but neither gives the enemy visual presence, and enemy presence is the
whole point of putting a creature on screen.

## 2. Narration placement and cadence **[DECIDED]**

**Bookends only — fast rounds.** The narrator speaks at battle start, on dramatic beats (a heavy
hit, a skill firing, near-death, the kill or the sparing) and at the end. Ordinary rounds resolve
instantly as mechanical log lines with no model call at all.

**Why, and the measurement behind it:** a smoke test on the dev laptop after the merge gave **89
tokens/sec with 181ms to first token** on the RTX 5060 — so a short beat costs roughly a second.
That is fast, and it means this decision is *not* a workaround for a slow model. It is about turn
feel: a turn-based RPG lives on the tightness of the press-and-resolve loop, and a one-second pause
on all fifteen presses of a battle destroys that loop even when each individual pause is short. It
also makes the prose matter more — the narrator interrupting only when something genuinely happened
carries far more weight than a paragraph per swing.

**Consequence for M11 (the LLM layer to spec):** the narrator needs a notion of *beat significance*
so the renderer can ask "is this round worth speaking about?". That is a pure function over the
engine's event list and belongs in `src/llm/` alongside `narrate.ts`, not in the renderer.

**Rejected:** narrating every round (either inside the log or in a dedicated band). Both were
strictly worse for turn feel and neither bought anything the bookend model doesn't already give.

## 3. Combat log detail **[DECIDED]**

**Plain by default, expandable to full dice.** The line reads `You hit the Ash-Wretch for 8.`;
clicking it (or flipping a persistent toggle) reveals `d20+4 = 17 vs AC 13 → hit, 1d8+4 = 8
slashing`. The log persists for the whole battle and scrolls.

**Why:** the game's pitch is mechanics-first, so the D&D machinery underneath has to be *visible on
demand* or it may as well not exist — but a wall of dice math on every line makes ordinary play
unreadable. Expandable detail serves both, and it doubles as a balance-and-debugging instrument for
your own play-testing, which matters given M15's per-class refinement is still outstanding.

**Requirement this places on the engine:** combat events must already carry the roll, the modifier,
the target number and the damage breakdown. Where they only carry the outcome, the events need
widening — **an engine change, through the pipeline, not something the renderer may reconstruct.**
The renderer must never re-roll or re-derive a number to display it.

## 4. Canvas architecture **[DECIDED]**

**Full-screen Kaplay canvas, DOM layered on top.** Kaplay fills the battle screen and owns
atmosphere (floor backdrop, fog, lighting, particles), the enemy sprite, hit flashes and
screen-wide shake. The DOM panels — HP bars, condition chips, the log, the menu — sit above it.

**Why:** screen-wide effects are most of the game-feel payoff, and they are impossible if the canvas
is boxed inside the enemy frame. Text stays DOM so it remains crisp, selectable and restyleable.

**The cost, stated plainly:** two layers that must be kept in sync, and a battle screen that is now
coupled to the render layer. The mitigations are non-negotiable:
- `src/game` still imports nothing from Kaplay or the DOM. Unchanged.
- The canvas is driven by a **pure view-model** (the existing `src/desktop/view-model.ts` pattern):
  engine state in, a plain-data description of what to draw out. That description is unit-testable
  headlessly; only the thin function that hands it to Kaplay is not.
- Kaplay effects are **decorative only**. If the canvas fails to initialise, the game must remain
  fully playable as DOM — the same resilience rule the narrator already follows.

## 5. Art direction **[DECIDED]**

**Elevated terminal — austere and typographic.** Near-black, monospace, heavy rules, wide
letter-spacing, no ornament, flat panels, and **one accent colour per floor** so the palette itself
marks the descent.

**The full ramp is LOCKED in `docs/ART-BIBLE.md` §4** (author's direction, 2026-08-25): toxic green
(Undercity) → blinding white with red flecks (Entrance) → **cold white/grey/black** (Ash City) →
bone white (Angelic Underground) → arterial red (True Void).

> **⚠ Correction.** An earlier draft of this section said "ash-orange in the Ash City". **That is
> wrong and is overruled.** In the Ash City the fire has already gone out — it is *purely white,
> grey and black*, and nothing there glows. Floors 3 and 4 are distinguished by temperature, not
> hue: Floor 3 is cold neutral grey (dead, drained), Floor 4 is warm bone (sacred, lit).

**The tension to hold, deliberately:** an austere typographic frame plus a lot of generated art
could easily fight each other. The resolution is that **art is treated as a plate, not as
decoration** — the floor backdrop sits full-bleed and heavily darkened behind everything, the enemy
sprite is the single bright object on screen, and the UI chrome around them stays flat, ruled and
unornamented. The art is what you look at; the interface is what you read. If any generated asset
starts competing with the type, the asset is wrong, not the type.

**Rejected:** grimy occult (texture, inked frames, sigil furniture) and clinical dread (sterile
off-white, medical labelling). Both were more immediately striking; both would have made the
interface itself loud, which is the opposite of the chosen direction.

## 6. Turn feel **[DECIDED]**

**Beat-by-beat, auto-advancing.** Pressing Fight plays the round as a short sequence — your strike
lands with a sprite flash, a damage number floats and the HP bar drains; a beat; conditions tick; a
beat; the enemy's attack resolves and the screen shakes. Roughly a second end to end, with no
clicking through it.

**Why:** this is the largest single source of game-feel in the whole plan. An instant resolve makes
a round read as a spreadsheet recalculating; staged beats make it read as an exchange. Requiring a
click between beats would double the input cost of every battle across a full five-act run.

**Requirement:** the renderer must be able to replay the round's events **in order, with timing**,
which the engine's event list already supports. Animation timing is render-layer state and must
never leak into game state.

## 7. Scope of the restyle **[DECIDED]**

**The whole game**, not the battle screen alone: title, character creation, class select, stat roll,
the hub, inventory and equipment, the character sheet, sacrifice-deals, the level-up draft, chests,
rest, endings and game-over.

**How this gets built — decomposition [PROPOSAL].** "Whole game" is the scope, not a single unit.
The `agentic-engineering` pipeline wants units that a human can actually review, so this becomes a
sequence of units sharing one visual language, each independently verified:

| Unit | Contents | Depends on |
|---|---|---|
| `ui-foundation` | Design tokens (palette, type scale, per-floor accents, spacing), the shared panel/bar/chip components, retire `src/scenes/` + `index.html`, extend combat events with roll detail | — |
| `battle-screen` | The JRPG frame, both combatant panels, conditions, the expandable log, the action menu, beat-by-beat sequencing | `ui-foundation` |
| `canvas-layer` | Kaplay full-screen layer, enemy sprite rendering, hit flash / shake / particles, floor backdrops, graceful degradation | `ui-foundation` |
| `screens-restyle` | Every non-battle screen brought onto the shared language | `ui-foundation` |
| `art-pipeline` | The generation script, prompt data, asset loading | — (parallelisable) |

Per the clash-avoidance rules in the skill (§1b), `ui-foundation` must land before the three units
that build on it; `art-pipeline` touches a disjoint file territory and can run alongside.

## 8. Retiring the second front-end **[DECIDED]**

`index.html` and `src/scenes/` (a standalone Kaplay scene set: main menu, class select, level-up,
deal) are **deleted**. The desktop app — `desktop.html` + `src/desktop/` — is the game, and it is
where Kaplay is now going anyway.

**Why:** it is a complete parallel UI that would otherwise have to be restyled too, it duplicates a
205 kB bundle, and the two front-ends have already drifted (the scene set still references the
deleted gold shop). The code remains in git history if it is ever wanted back.

**Note:** this removes the only browser (non-Electron) path. That is acceptable — the product is a
packaged desktop game (`CLAUDE.md`, principle 6), and if a browser build is ever wanted it should be
built from the desktop UI rather than from a second divergent one.

---

## 9. Art generation **[DECIDED in principle, OPEN on specifics]**

Art is **AI-generated** through Google AI Studio, using the engineer's own API key, with **roughly
three variations of every asset** produced in one large batch for the engineer to choose from.
Batch generation is to be used if the API supports it.

**Pipeline shape [PROPOSAL — my recommendation]:** a committed `scripts/gen-art.mjs` driven by a
committed `src/data/artPrompts.json`, writing numbered candidates to a **gitignored** scratch
folder; only chosen finals get committed.

```
src/data/artPrompts.json    prompts, one per asset   → committed
scripts/gen-art.mjs         calls the API            → committed
.env                        GOOGLE_API_KEY=…         → GITIGNORED
art-candidates/             ash-wretch-01..03.png    → gitignored
src/assets/…                the chosen finals        → committed
```

**Why this shape rather than generating ad hoc in a session:** the prompts become a reviewable,
version-controlled asset in their own right, so a family can be regenerated consistently when its
design shifts; nothing is lost when a conversation ends; and the key never enters the repository or
the git history. **The generation script is never called by tests** — the same rule that keeps real
inference out of the test suite.

**Security, non-negotiable:** the key is read from an environment variable or a gitignored `.env`.
It is never committed, never pasted into a source file, never written into a document, and never
echoed into a log or a commit message.

**Proposed first batch [PROPOSAL]** — "everything we need", enumerated:

| Assets | Count | × 3 variations |
|---|---|---|
| Enemy family sprites (transparent) | 24 | 72 |
| Boss portraits | 5 | 15 |
| Floor backdrops | 5 | 15 |
| Class portraits | 5 | 15 |
| **Total** | **39** | **117** |

Item icons are deliberately **excluded from batch one**. There are 15 relics, 4 uniques, 19
consumables plus weapons and armour — too many to review in one sitting, and the right unit for them
is probably an icon per slot-and-rarity rather than per individual item. That is a **[OPEN]**
question for after the first batch proves the style.

### API investigation — findings **[VERIFIED 2026-08-24, live against the API]**

The key was supplied and probed directly. Results:

**The key is valid.** Text generation works (`gemini-3.5-flash` returned normally) and the model
list is readable, so authentication and project access are fine.

**Model identified.** "Banana Pro" is `gemini-3-pro-image` (display name "Nano Banana Pro",
description "Gemini 3 Pro Image"). `nano-banana-pro-preview` is the same model under its preview
alias — **prefer the stable `gemini-3-pro-image`**. Related models on the same key:
`gemini-3.1-flash-image` ("Nano Banana 2") and `gemini-2.5-flash-image` (the original Nano Banana).

**A true batch endpoint exists.** All three image models list `batchGenerateContent` among their
`supportedGenerationMethods`, so the batch request the engineer asked for is real and not merely
concurrent single calls.

**BLOCKER — image generation is not on the free tier.** Every image model returns HTTP 429 with
`Quota exceeded … generate_content_free_tier_requests, limit: 0`. A limit of *zero*, not a limit
that resets: the free tier permits no image generation at all. Google's pricing page confirms "free
tier: not available" for all three image models. **Billing must be enabled on the Google Cloud
project behind the key before a single image can be generated.** Text generation on the same key is
unaffected, which is why the key otherwise looks healthy.

**Cost, once billing is enabled** (117 images = 39 assets × 3 variations):

| Model | Per image | Style probe (9) | Full batch (117) |
|---|---|---|---|
| `gemini-3-pro-image` (Nano Banana Pro), 1K–2K | $0.134 | ~$1.21 | **~$15.68** |
| `gemini-3-pro-image`, 4K | $0.24 | ~$2.16 | ~$28.08 |
| `gemini-3.1-flash-image` (Nano Banana 2), 1K | $0.067 | ~$0.60 | ~$7.84 |
| `gemini-2.5-flash-image` | $0.039 | ~$0.35 | ~$4.56 |

**Recommendation:** Nano Banana Pro at 1K–2K. Roughly sixteen dollars for the whole first batch is
not a figure worth economising on, and the Pro model's stronger prompt adherence matters a great
deal here — every enemy must land in the *same* house style or the roster will not read as one game.

### Model and resolution **[DECIDED 2026-08-24]**

**`gemini-3-pro-image` (Nano Banana Pro) at `imageSize: "1K"`.** Chosen by the engineer.

- **Why the Pro model over the Flash ones:** roughly $16 versus $8 for the whole first batch. The
  difference is not worth optimising, and prompt adherence is the thing that matters most here —
  all 24 enemy families must land in the *same* house style or the roster will not read as one
  game. Style consistency across a large batch is exactly where the Pro model earns the delta.
- **Why 1K rather than 2K or 4K:** same price as 2K on this model, so this is a file-size and
  repository-weight decision, not a cost one. 1K is ample for enemy sprites and class portraits at
  the sizes they appear on screen. **Watch item:** the full-bleed floor backdrops are the one asset
  class that might want 2K on a large desktop window — if a 1K backdrop looks soft in the probe,
  raise *only the backdrops* to 2K rather than the whole batch.
- **Use the stable id, not `nano-banana-pro-preview`** — same model, but a preview alias can be
  withdrawn or re-pointed without notice, and this script needs to keep working for years.

**Estimated spend at this setting:** style probe (9 images) ≈ **$1.21**; first batch (117 images) ≈
**$15.68**; each full re-roll of the batch ≈ $15.68. Realistic total for all game art across
probes, the first batch, a couple of re-rolls and a later item-icon batch: **$50–75**.

### Style probe — results **[RUN 2026-08-24, billing live, 9/9 generated]**

Billing was enabled and the probe ran: 3 assets (ash-wretch enemy, Ash City backdrop, Enforcer
class portrait) × 3 variations, all nine succeeded, ~$1.21.

**Verdict on the direction: it works.** The Ash City backdrop is close to shippable — dark, smoky,
a dull orange glow on the horizon, and crucially a deep-shadow foreground that text can sit on
without a scrim. The Enforcer portrait is on-style: strong silhouette, muted palette, genuine
menace, black ground. The "austere plate against near-black" idea holds up.

**But the probe earned its keep by exposing three consistency failures.** These are exactly the
problems that would have wasted the $15.68 batch, and each needs a fix in `art-pipeline`:

1. **Background is not reliable — 1 in 3 failed.** Despite `pure flat black background` stated
   twice in the prompt, one ash-wretch came back on a **white** background. Across 24 families
   that is roughly eight unusable images per batch. **Fix:** harden the prompt *and* add an
   automated gate — sample the four corner pixels, reject and regenerate anything whose corners
   are not near-black. Cheap, deterministic, and catches precisely this failure.
2. **Framing drifts badly.** One variation was full-body head-to-toe with margin; another was
   cropped at mid-thigh and much closer in. A roster of 24 that must sit in the same on-screen
   frame cannot have per-enemy zoom. **Fix:** explicit framing language (full body, head and feet
   inside frame, ~10% margin) and, better, **reference-image conditioning** — the API accepts image
   input, so once one enemy is approved it can be passed as a style-and-framing reference for the
   other 23. That is the strongest lever available for cross-batch consistency.
3. **No transparency is possible.** The model returns **`image/jpeg` only**; a prompt explicitly
   demanding a transparent alpha channel and a PNG still returned JPEG. JPEG cannot carry
   transparency at all. This matters because §4 composites enemy sprites over a full-bleed floor
   backdrop — a black rectangle around every creature is not acceptable. **Options for the
   `art-pipeline` unit, in preference order:** (a) post-process to PNG with a luminance-keyed alpha
   channel, committing the keyed PNG as the final asset — deterministic, reviewable, done once;
   (b) draw the sprite with additive/screen blending in Kaplay so black self-cancels — free, and
   flattering to embers, but it thins the creature's own dark mid-tones; (c) a radial edge fade to
   hide the box against a dark backdrop — cheapest, weakest. **(a) is the recommendation.**

**Consequence:** `art-pipeline` is no longer just "call the API in a loop". It needs a
**generate → validate → regenerate** loop with the corner-pixel gate, reference-image conditioning
for style lock, and an alpha-keying post-process step. That is a bigger unit than first scoped, and
the probe is why we know before spending the batch money rather than after.

### Remaining open questions

> **⚠ This whole §9 is superseded.** `docs/ART-BIBLE.md` is now the authority on everything visual
> (`docs/README.md` precedence rule 3) and carries the live versions of all of it — including the
> **32-bit-era 2D pixel direction**, which replaced the painterly style described above. Read the
> bible, not this section.

1. ~~Approve a reference enemy.~~ Still true, but tracked in `ART-BIBLE.md` §9. A **fourth probe**
   is needed first: probe 03 predates `docs/WORLD.md` and several of its assets are now wrong.
2. ~~Alpha strategy.~~ **SETTLED** — key flat black to a PNG alpha channel in post-processing;
   the keyed PNG is the committed asset (`ART-BIBLE.md` §9).

### Key handling — a warning on record **[SECURITY]**

The key was pasted into a chat transcript rather than delivered as a file, so **it must be treated
as exposed and rotated.** This matters more, not less, once billing is enabled: an exposed key on a
billed project is a financial exposure, not merely a privacy one. It has been written to the
gitignored `.env` and confirmed ignored via `git check-ignore`; it is not in any commit. Recommended
sequence: enable billing → run the probe and the batch → **rotate the key** → update `.env`.

---

## 10. What this does not cover

Deliberately out of scope here, tracked elsewhere:

- **Prose** — floor, boss and ending text (M10 / M12 / M14) is the engineer's voice to write.
- **The Tibia-style equipment UI** (M5's ★ deferral) — still a collaborative pass; the inventory
  restyle in `screens-restyle` is a restyle of the current functional screen, not that redesign.
- **Per-class balance** — Scavver strong, ranged classes weak (`docs/BALANCE-REPORT.md`). A play-test
  and weapons follow-up, not a UI concern.
- **Audio.** Never discussed. Flagged as **[OPEN]** — a turn-based battle screen with beat-by-beat
  sequencing is the natural place for hit and impact sound, and it will feel oddly silent without it.

---

## 11. The floor is announced, not implied **[DECIDED 2026-08-26]**

> Author: *"we must make a clear statement that you are now on a different level, through the
> narration, and a tag above of where we are."*

**Two channels, both explicit:**

1. **A persistent floor tag in the interface** — always visible, naming where you are. Not a colour,
   not an icon: **the name, in text.**
2. **A narration beat on every descent** — the narrator states plainly that you have gone down a
   level, at the moment it happens.

**This also resolves two previously-open items:**

- **It fixes the accessibility problem** flagged in `docs/FINDINGS.md` S4. The per-floor accent
  colour was the *only* channel carrying floor state, which is unreadable for a colourblind player
  and invisible to a screen reader. Now the accent is **reinforcement, not information** — the name
  carries the meaning and the colour carries the mood. **General rule from here: the accent may never
  be the only carrier of any state.**
- **It answers "should floor names surface in the UI?"** — the question `ui-foundation` left open,
  where `FLOOR_THEMES` holds the names and nothing renders them. **Yes. Render them.**

**Still open and NOT covered by this:** reduced motion (the battle screen's shake, flash and
particles) and text size. See `FINDINGS.md`.

---

## 12. Settings screen **[DECIDED 2026-08-26 — added to the restyle scope]**

There was no settings screen anywhere in the design, and it is not new scope — it is **the bill for
scope already taken on.** Audio went in at full ambition with no volume control; accessibility
commitments have nowhere to live; the model tier needs an override on slow machines.

| Group | Controls |
|---|---|
| **Audio** | Master · music · ambience · effects |
| **Accessibility** | Reduced motion · text size · high contrast |
| **Text** | Narration speed · skip / instant |
| **Model** | Quality tier, for slower machines — see the 4B-vs-dual-tier decision in `FINDINGS.md` B10 |
| **Display** | Fullscreen · window size |

Add it to `screens-restyle` (#8) as its own screen, and give it a route from both the title and the
hub — a player who needs reduced motion should not have to start a run to find it.

## 13. Reduced motion **[DECIDED 2026-08-26]**

**One setting, honoured by default from the operating system.**

| Effect | Reduced-motion behaviour |
|---|---|
| Screen shake | **Off** |
| Hit flash | A **soft tint**, never a strobe |
| Particles | Reduced or off |
| Beat timing | **Unchanged** — the exchange must still read as an exchange |

**Default from the OS:** respect `prefers-reduced-motion`, so anyone who has already set it
system-wide gets it without finding the settings screen.

**Why this is not a preference like any other:** flashing is a genuine health issue, not a taste
question — and an unskippable strobe in *this specific game* is a thematic own-goal on top of an
accessibility failure.

**Requirement on `battle-screen` (#6) and `canvas-layer` (#7):** both must read the flag and route
every motion effect through it. **The hook costs nothing now and is a rewrite of the sequencing layer
afterwards** — the same argument already made and accepted for audio hooks (`ART-BIBLE.md` §10).

## 14. Onboarding, saves, errors and the window **[DECIDED 2026-08-26]**

### Onboarding — teach in place, never with a scripted tutorial

**Tooltips on everything + a codex that fills in as you go.** No forced tutorial sequence.

- **Tooltips:** every condition chip, skill, item, stat and perk explains itself on hover or click.
  This is what makes 24 conditions learnable without a manual. **Depends on the `description` fields
  from `engine-foundations` (#1)** — there is currently nowhere to put the text.
- **Codex:** fills in as you encounter things, reusing the gradual bestiary-reveal machinery that
  already exists. It is where you look up the thing you met two floors ago.
- **No scripted first run.** A roguelike teaches by repetition, and floor 1 is already designed as
  the teaching floor ("the world is still solid").
- **Karma is exempt and stays unreadable** — no tooltip, no codex entry, ever (`GAME-DESIGN.md` §13).

**Input, following from tooltips:** **the mouse is the primary input**, and hover is a real
affordance the design now depends on. Keyboard navigation must be **complete rather than
half-supported** — today `:focus-visible` is styled but nothing handles keys, which is the worst of
both. Gamepad is out of scope; say so on the store page.

### Saves — multiple slots

**Several named runs at once**, and **the save moves out of `localStorage` to a real file** in the
app's user-data directory. Today's save lives in the Chromium profile, where an Electron upgrade or
a profile reset destroys it, with no backup and no way to move it between machines.

> **The tension this creates, recorded so it is handled rather than discovered.** Slots in a
> permadeath roguelike invite **save-scumming** — reload before a bad fight and death stops meaning
> anything, which is the pillar the whole design rests on. **Mitigation to implement:** slots are for
> *parallel* runs, not for rewinding one. **Autosave overwrites its own slot; there is no manual save
> and no reload-to-an-earlier-point.** You may keep several descents going; you may not un-die.

### Errors — tell the player, retry, and recover

Nothing fails silently. Every failure gets a plain, quiet message and the game continues in the best
degraded state it can — **and where recovery is possible, it is attempted.**

| Failure | Behaviour |
|---|---|
| Narration fails | Say so, **retry**, and offer to continue without the narrator. The engine is the game; the narrator is a layer |
| Save unreadable | Say so **before** discarding it |
| Disk full | Warn that the run is not being saved |
| Unlock store corrupt | **Restore from a backup copy** — keep one. Otherwise say exactly what was lost. This is the fix for the silent total wipe in `FINDINGS.md` G3 |
| Canvas fails | Already decided (§4): the DOM game keeps working |

### Window

**Minimum size, resizable above it, a real fullscreen toggle, remembered bounds, and DPI-aware.**
The minimum matters most: **without it the responsive layout has no design target**, and `#6`/`#7`
need to know the range they must hold up across.

## 15. Accessibility — the full commitment **[DECIDED 2026-08-26]**

Beyond reduced motion (§13), the game commits to:

- **Text size** — at minimum small / normal / large, in the settings screen.
- **Complete keyboard navigation.** Today `:focus-visible` is styled and **nothing handles keys**,
  which is the worst of both states: focus rings appear and nothing responds. Finish it.
- **High contrast** — falls largely out of the WCAG contrast gate already in `tokens.ts`.
- **Screen-reader support.** Proper semantics throughout, and **tested with a real screen reader** —
  a claim that is not tested is not a claim.

**Why the full commitment is reasonable here specifically:** this is a text-heavy DOM game. The
narration already lives in an `aria-live` region and every choice is a real button. **A blind player
could plausibly play the whole thing** — which is a genuinely rare thing to be able to offer, and
almost free compared to what it would cost a canvas-first game.

**The one exception:** the Kaplay canvas is decorative by design (§4) and does not need to be
described. Everything load-bearing is already DOM — which is exactly why the split was drawn there.

## 16. Performance target **[DECIDED 2026-08-26]**

**30fps, and every canvas effect always on.** No automatic quality degradation.

Every player sees the same thing, which is simpler to build, simpler to reason about, and removes a
whole class of "it looks different on my machine" bug. 30fps is entirely adequate for a turn-based
game with no twitch input.

**The one thing this still requires:** nobody has ever measured whether the full-screen canvas and
active 4B inference can coexist on the minimum machine. **Measure it before `canvas-layer` (#7)
ships** — if 30fps with everything on is not achievable alongside inference, this decision has to be
revisited rather than quietly missed.

The **reduced-motion setting** (§13) remains the player's manual control, and is unaffected — it is
an accessibility feature, not a performance one.
