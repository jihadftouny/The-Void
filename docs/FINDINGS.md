# The Void — Findings Register

**This is the living list of everything still open.** Unlike the dated audit snapshots, this file is
**updated continuously** — every time something is decided, built, or newly discovered.

## Rules for this file

1. **An item is only resolved when it is written into an authoritative document** — not when it is
   discussed. Mark it `DECIDED` and link where it landed.
2. **Never delete a resolved row.** Strike it and keep the link. The history is why nobody
   re-litigates it.
3. **New findings get added here**, not into a new audit file. The two audits are frozen evidence
   snapshots; this is the register.
4. **`BLOCKS` means work cannot correctly start** — check this column before beginning any unit.

**Status:** `OPEN` needs a decision · `DECIDED` settled, link to where · `BUG` needs fixing not
deciding · `FIXED` done · `PARKED` deliberately deferred, with a reason.

**Evidence:** `docs/SCOPE-AUDIT.md` (2026-08-25 — content, systems, doc contradictions) ·
`docs/SCOPE-AUDIT-2.md` (2026-08-26 — open decisions, unexamined areas, accidental decisions).

---

## 1. Blocks shipping

| # | Item | Status | Blocks | Notes |
|---|---|---|---|---|
| S1 | ~~Content warning~~ | `DECIDED` | — | **Policy set: shown at the start of EVERY fresh run, not just the first**, plus store page and README. `docs/CONTENT-WARNING.md`. **The words are still the author's to write** |
| S2 | ~~LICENSE / NOTICE / attribution~~ | `DECIDED` | — | **Proprietary game + a THIRD-PARTY file** with Qwen3, Electron, llama.cpp, Kaplay, JetBrains Mono. `package.json` fields still to fill. `docs/SHIPPING.md` |
| S3 | **Generated-asset licence** — commercial redistribution terms for the images recorded nowhere | `OPEN` | ship | And separately for the **music** — art and music terms can differ |
| S4a | ~~Colour is the only state channel~~ | `DECIDED` | — | **A persistent floor-name tag + a narration beat on every descent.** The accent becomes reinforcement, not information. Rule: the accent may never be the only carrier of any state. `UI-DESIGN.md` §11 |
| S4b | ~~Reduced motion~~ | `DECIDED` | — | **One setting; shake off, flash becomes a soft tint, particles reduced, beat timing unchanged. Honours the OS `prefers-reduced-motion` by default.** #6 and #7 must route every motion effect through the flag. `UI-DESIGN.md` §13 |
| S4c | ~~Text size / contrast / screen reader / keyboard~~ | `DECIDED` | — | **Full commitment, including a tested screen-reader pass.** Viable because the game is text-heavy DOM — a blind player could plausibly play all of it. Keyboard must be *completed*, not left half-styled. `UI-DESIGN.md` §15 |
| S5 | ~~Update mechanism~~ | `DECIDED` | — | **The itch app handles updates.** No electron-updater, no publish block. Needs butler and a real version number. `docs/SHIPPING.md` |
| S6 | ~~Age rating~~ | `DECIDED` | — | Self-declare honestly, following `docs/CONTENT-WARNING.md`. `docs/SHIPPING.md` |
| S7 | ~~Privacy statement~~ | `DECIDED` | — | No network calls beyond the model download; say so. `docs/SHIPPING.md` |
| S8 | ~~Telemetry~~ | `DECIDED` | — | **None.** A decision, not an omission. `docs/SHIPPING.md` |
| S9 | ~~itch pricing~~ | `DECIDED` | — | **Free, optional donation.** Store copy still to WRITE — it must state the 2.5 GB download, the GPU requirement, English-only, one difficulty, and carry the content warning |

## 2. Blocks building

| # | Item | Status | Blocks | Notes |
|---|---|---|---|---|
| B1 | ~~Settings / options screen~~ | `DECIDED` | — | **Added to `screens-restyle` (#8) as its own screen**, routed from both title and hub: audio, accessibility, text speed, model tier, display. `UI-DESIGN.md` §12 |
| B2 | ~~Equipment slot set~~ | `DECIDED` | — | **Seven: head, body, hand ×2, feet, trinket ×2.** Cut amulet, ring, legs, back. Relics occupy the two trinket slots — wear two. `GAME-DESIGN.md` §14.7 |
| B3 | ~~Two-handed vs shield vs dual-wield~~ | `DECIDED` | — | **All three: 1H+off-hand, dual-wield, or 2H which blocks the off-hand.** Dual-wield needs its own attack rules and is a real balance surface. `GAME-DESIGN.md` §14.6 |
| B4 | ~~Backpack capacity / weight~~ | `DECIDED` | — | **A fixed slot count, no weight.** Exact N settles with the slot brainstorm. `GAME-DESIGN.md` §14.6 |
| B5 | ~~Typeface~~ | `DECIDED` | — | **JetBrains Mono** (SIL Open Font Licence, free to bundle). Chosen for legibility at small sizes — 11px condition chips and dense combat logs. Re-check the type scale against it |
| B6 | ~~Turn / initiative model~~ | `DECIDED` | — | **No initiative system.** Fixed round order; Quick/Slow redefined to work without one. No turn queue to render. `GAME-DESIGN.md` §14.8 |
| B7 | **`jsdom` vs `node` test environment** | `OPEN` | #6 #7 #8 | Decide once, or three units each invent an override |
| B8 | ~~Min-spec quality gating~~ | `DECIDED` | — | **No degradation — everything always on.** Every player sees the same thing. `UI-DESIGN.md` §16 |
| B9 | **Performance target** | `DECIDED`, one **measurement outstanding** | #7 | **30fps.** But nobody has ever measured the canvas + 4B inference together on the min machine — **do it before #7 ships**, and revisit if 30fps is not achievable. `UI-DESIGN.md` §16 |
| B10 | ~~Model tier~~ | `DECIDED` | — | **4B only; the 1.7B fallback is rejected. MIN SPEC NOW REQUIRES A GPU** — a changed commitment, updated in `CLAUDE.md`. The store page must say so |
| B11 | ~~Consumables & uniques source~~ | `DECIDED` | — | **Consumables from drops + chests; uniques as a rare drop from any enemy.** Accepted cost: with only 4 uniques, most runs see none. `GAME-DESIGN.md` §14.8 |
| B12 | **Grace vs cast-down thresholds**, on unclamped karma | `OPEN` | #2 | Blocks the balance re-run |
| B13 | ~~Ending text~~ | `DECIDED` | — | **Authored anchors, narrated specifics.** "Made whole" is the thesis and must be the author's words; the run's specifics are generated. Same shape as the death summary. `GAME-DESIGN.md` §14.10 |
| B14 | **Enemy scaling formula** + **affix list** — both `[OPEN → M8]`, M8 merged unanswered | `OPEN` | #9 | Two affixes still "provisional" in data |
| B15 | ~~Item-icon granularity~~ | `DECIDED` | — | **Bespoke, one per item.** Deadlock broken by the slot set landing. 50 items today ≈ 150 images ≈ $10 batched — but ⚠ **a permanent commitment: every new item needs art forever.** `ART-BIBLE.md` §13 |
| B16 | ~~Interface furniture~~ | `DECIDED` | — | **No generated interface art**; cursor + loading indicator excepted as *functional marks*. Resolved by the art/interface rule: **art depicts things in the world; the interface that frames them stays flat.** `ART-BIBLE.md` §15 |

## 3. Product areas never discussed

| # | Item | Status | Notes |
|---|---|---|---|
| N1 | ~~Onboarding / tutorial~~ | `DECIDED` | **Tooltips on everything + a codex that fills in as you go. No scripted tutorial.** Depends on the description fields from #1. Karma stays exempt and unreadable. `UI-DESIGN.md` §14 |
| N2 | ~~Difficulty / assist options~~ | `DECIDED` | **One difficulty. No modes, no assists**, stated up front on the store page. The unlock system is the accessibility ramp. Accepted cost recorded: some players bounce permanently. `GAME-DESIGN.md` §14.5 |
| N3 | ~~Save slots~~ | `DECIDED` | **Multiple named slots, moved to a real file on disk.** ⚠ Mitigation required: slots are for *parallel* runs, not rewinding — autosave overwrites its own slot, no manual save, no reload. Otherwise save-scumming guts permadeath. `UI-DESIGN.md` §14 |
| N4 | ~~Error handling~~ | `DECIDED` | **Tell the player, retry, and recover.** Nothing silent. Includes a **backup copy of the unlock store** — which is the fix for G3. `UI-DESIGN.md` §14 |
| N5 | ~~Window management~~ | `DECIDED` | **Min size, resizable, fullscreen toggle, remembered bounds, DPI-aware.** The minimum is the layout's design target. `UI-DESIGN.md` §14 |
| N6 | ~~Input model~~ | `DECIDED` | **Mouse is primary and hover is now load-bearing** (tooltips). Keyboard navigation must be **complete rather than half-supported**. Gamepad out of scope. `UI-DESIGN.md` §14 |
| N7 | ~~External playtest / QA~~ | `DECIDED` | **A small trusted group, 5–10 people, before any public release.** The subject matter especially needs trusted people rather than strangers. `ART-BIBLE.md` §14 |
| N8 | **Localisation** | `PARKED` | English-only is right for a 4B English narrator. State it on the store page |

## 4. Bugs — fix, don't decide

| # | Item | Status | Severity | Notes |
|---|---|---|---|---|
| G1 | **Quitting mid-run voids all unlock progress** | `BUG` | ⛔ severe | Resume never rebuilds `runSummary`/`runSeed`. Earn an unlock, quit, return, win — you get nothing. **The whole meta-progression pillar** |
| G2 | **Winning leaves a resumable save** | `BUG` | ⛔ | `ending` maps to `continue`, not `game-over`. Relaunch after victory: *"A descent lies unfinished."* |
| G3 | **Corrupt unlock store wipes everything silently** | `BUG` — **fix decided** | ⛔ | Keep a **backup copy** and restore from it; if that fails, say exactly what was lost. Also moves to a real file with the saves (N3) |
| G4 | **You can flee the floor-4 Warden** | `BUG` — **fix decided** | ⛔ | **Bosses cannot be fled at all**; Smoke Vial explicitly fails against them. UI must explain why, not just hide the button. `GAME-DESIGN.md` §14.9 |
| G5 | **"Abandon the descent" — one click, no confirmation** | `BUG` | high | Third in the hub menu; destroys a 45–90 min run. No `confirm` anywhere in the render layer |
| G6 | **Log written inside the install dir, uncapped** | `BUG` — **fix decided** | high | Move to user-data, cap and rotate. `docs/SHIPPING.md` |
| G7 | **Equip bypasses the engine** | `DECIDED` → task #1 | ⛔ | Balance report is fiction until fixed |
| G8 | **Run seed is wall-clock, never shown or stored** | `BUG` | medium | No seeded runs, no daily challenge, **no reproducible bug reports from testers** |
| G9 | ~~Floor length inherited from the Java port~~ | `DECIDED` | medium | **Measure it in the balance re-run and tune the XP curve to the 45–90 min target.** The sim already plays full runs; make it report encounters and minutes per floor, and the grace-vs-damnation asymmetry. `GAME-DESIGN.md` §14.11 |
| G10 | ~~Death has no run-summary screen~~ | `DECIDED` | medium | **A run summary written by the narrator** — reached, killed by, your build, unlocked, plus the Void's account. The one place karma is *felt* without being metered. `GAME-DESIGN.md` §14.9 |

## 5. Document hygiene

| # | Item | Status |
|---|---|---|
| D1 | Four different asset totals in circulation (39 / 52 / 53) | `OPEN` |
| D2 | `GAME-DESIGN.md` has **two §14s**; §15 still says "the brainstorm is essentially complete" | `OPEN` |
| D3 | Three dead `[PROPOSAL]` tags to retag or delete (P2, P3, P5) | `OPEN` |
| D4 | `.env.example` still says the model is "bundled" | `OPEN` |
| D5 | `PROGRESS.md` still describes the shell as "mobile-first, portrait 540×1080" | `OPEN` |
| D6 | `HUMAN-CHECKS.md` stale since 2026-08-14; 5 un-ticked author rulings incl. flee 25% vs 35% | `OPEN` |
| D7 | 18 stale worktrees on disk | `OPEN` |
| D8 | `WHAT-WE-BUILT.md` + `itch-description.html` describe a game with gold and a shop | `OPEN` |

---

## Resolved

_Struck items stay here permanently. Never delete a row._

- ~~Socket contradiction — two `[LOCKED]` statements negating each other~~ → **DECIDED**: no visible
  hardware in any art; `ART-BIBLE.md` §9. Neuromancer costume corrected.
- ~~`CLAUDE.md` stale in seven places while holding top precedence~~ → **FIXED** 2026-08-25.
- ~~Economy contradiction: shops vs no-currency in the same document~~ → **FIXED**, §11 won.
- ~~Alpha strategy~~ → **DECIDED**: key flat black to PNG in post.
- ~~Affix visual treatment~~ → **DECIDED**: code effects, zero new art.
- ~~Backdrops 1K vs 2K~~ → **DECIDED**: everything 1K.
- ~~Floor mechanics architecture + all five floors~~ → **DECIDED**: `GAME-DESIGN.md` §8.
- ~~Who writes the choices~~ → **DECIDED**: the engine. M11 shrinks.
- ~~Karma's mid-run effects~~ → **DECIDED**: bends the world, never the numbers.
- ~~Relic acquisition~~ → **DECIDED**: sacrifice-deals only.
- ~~Model bundling~~ → **DECIDED**: download once on first run.
- ~~Audio scope~~ → **DECIDED**: effects + ambience + score (licence still `OPEN`, see S3).
- ~~Rival houses, Absolution above ground~~ → **PARKED** deliberately; `WORLD.md` §12b.
- ~~Content warning policy~~ → **DECIDED** 2026-08-26: every fresh run; `docs/CONTENT-WARNING.md`.
- ~~Colour as the only state channel~~ → **DECIDED**: floor-name tag + narration beat; `UI-DESIGN.md` §11.
- ~~Settings screen~~ → **DECIDED**: added to #8; `UI-DESIGN.md` §12.
- ~~Difficulty modes~~ → **DECIDED**: one difficulty, no assists; `GAME-DESIGN.md` §14.5.
- ~~Should floor names surface in the UI?~~ → **DECIDED**: yes, render them (falls out of §11).
- ~~Reduced motion~~ → **DECIDED** 2026-08-26: one OS-aware setting; `UI-DESIGN.md` §13.
- ~~Hands / dual-wield~~ → **DECIDED**: three configurations; `GAME-DESIGN.md` §14.6.
- ~~Backpack capacity~~ → **DECIDED**: fixed slots, no weight; `GAME-DESIGN.md` §14.6.
- ~~Equipment slot set~~ → **DECIDED**: seven slots, two trinkets; `GAME-DESIGN.md` §14.7.
- ~~Typeface~~ → **DECIDED**: JetBrains Mono, OFL.
- ~~Initiative~~ → **DECIDED**: none; fixed round order; `GAME-DESIGN.md` §14.8.
- ~~Model tier~~ → **DECIDED**: 4B only, **min spec now requires a GPU**.
- ~~Consumable/unique sources~~ → **DECIDED**; `GAME-DESIGN.md` §14.8.
- ~~Onboarding, saves, errors, window, input~~ → **DECIDED** 2026-08-26; `UI-DESIGN.md` §14.
- ~~Licence, updates, pricing, telemetry, privacy, age rating~~ → **DECIDED**; `docs/SHIPPING.md`.
- ~~Fleeing bosses, death screen~~ → **DECIDED**; `GAME-DESIGN.md` §14.9.
- ~~Accessibility (full, incl. screen reader)~~ → **DECIDED**; `UI-DESIGN.md` §15.
- ~~Ending text~~ → **DECIDED**: authored anchors + narrated specifics; `GAME-DESIGN.md` §14.10.
- ~~Item icons~~ → **DECIDED**: bespoke per item; `ART-BIBLE.md` §13.
- ~~External playtesting~~ → **DECIDED**: a small trusted group; `ART-BIBLE.md` §14.
- ~~Interface furniture~~ → **DECIDED** via the art/interface rule; `ART-BIBLE.md` §15.
- ~~Performance / quality gating~~ → **DECIDED**: 30fps, no degradation; `UI-DESIGN.md` §16.
- ~~Run length~~ → **DECIDED**: measure and tune in the balance re-run; `GAME-DESIGN.md` §14.11.
- ~~Quick/Slow effects~~ → **DECIDED**: a **tempo gauge** driven by DEX, visible on both combatants; `GAME-DESIGN.md` §16.1.
- ~~Mid-battle equipping~~ → **DECIDED**: hub-only; `GAME-DESIGN.md` §16.2.
- ~~Art running ahead of the engine~~ → **DECIDED**: no — engine first. Ash-Wretch and the Warden executioner drop out of the art list until they exist in code.
