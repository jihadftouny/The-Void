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
| S1 | **Content warning** — zero mentions anywhere, in a game about lived psychosis | `OPEN` | ship | Free to add. Most conspicuous omission in the project |
| S2 | **LICENSE / NOTICE / third-party attribution** — no file exists; `package.json` has no licence, author or repo | `OPEN` | ship | Redistributing Qwen3 (Apache-2.0) **requires** it. Also Electron, llama.cpp, Kaplay, the font |
| S3 | **Generated-asset licence** — commercial redistribution terms for the images recorded nowhere | `OPEN` | ship | And separately for the **music** — art and music terms can differ |
| S4 | **Accessibility** — colour is the only state channel; unskippable shake/flash; no text size, no high contrast | `OPEN` | ship, #6, #7 | Hooks are free now, a rewrite after the battle screen |
| S5 | **Update mechanism** — none; no `publish` block; version `0.0.0` | `OPEN` | ship | A 2.5 GB first-run download with no patch path |
| S6 | **Age rating / content descriptor** — itch requires self-declaration | `OPEN` | ship | Follows from S1 |
| S7 | **Privacy statement** — app writes to disk; no statement | `OPEN` | ship | Trivial once S8 is decided |
| S8 | **Telemetry / crash reporting** | `OPEN` | ship | Shipping none is almost certainly right — but **write it down** |
| S9 | **itch pricing + store page copy** | `OPEN` | ship | `itch-description.html` currently claims text-based, four floors, LLM-generated enemies, a shop — all false |

## 2. Blocks building

| # | Item | Status | Blocks | Notes |
|---|---|---|---|---|
| B1 | **Settings / options screen** — mentioned nowhere; not in the restyle scope | `OPEN` | #6 #7 #8 | Audio is in scope with no volume control; no home for reduced-motion or text speed |
| B2 | **Equipment slot set** — `[PROPOSAL]`, "confirm/trim this list", never confirmed | `OPEN` | #8 | Cannot draw a paperdoll against an unapproved slot list |
| B3 | **Two-handed vs shield vs dual-wield** | `OPEN` | #8 | Is the second hand a slot or a mode? |
| B4 | **Backpack capacity / weight** | `OPEN` | #8 | |
| B5 | **Typeface** — three candidates, one **paid**, licence unchecked | `OPEN` | #6 #7 #8 | Every spacing token is provisional until a real face lands |
| B6 | **Turn / initiative model** — `[OPEN]`; `initiativeOrderTwist` returns 0, "no-op until M4", M4 merged | `OPEN` | #6 | A battle screen showing turn order needs to know if one exists. Quick/Slow are half-inert |
| B7 | **`jsdom` vs `node` test environment** | `OPEN` | #6 #7 #8 | Decide once, or three units each invent an override |
| B8 | **Min-spec quality gating** — what the canvas turns off on a no-GPU laptop | `OPEN` | #7 | `PLAN.md` has **no M16 item at all** |
| B9 | **Performance targets** — no frame rate, memory or particle budget | `OPEN` | #7 | Nobody has asked whether the canvas and a 4B model can coexist on the min spec |
| B10 | **Model tier: 4B-only vs dual-tier** — spike recommended both; code says 4B only; recorded nowhere | `OPEN` | #6, ship | Min spec measured **7.6 tok/s / ~5 s TTFT** vs the 89 tok/s the narration cadence was designed against |
| B11 | **Consumables & uniques have no source** | `OPEN` | #9 #13 | Relics settled (deals only); these were left out |
| B12 | **Grace vs cast-down thresholds**, on unclamped karma | `OPEN` | #2 | Blocks the balance re-run |
| B13 | **Ending text: deterministic vs generative** | `OPEN` | #12 #13 | |
| B14 | **Enemy scaling formula** + **affix list** — both `[OPEN → M8]`, M8 merged unanswered | `OPEN` | #9 | Two affixes still "provisional" in data |
| B15 | **Item-icon granularity** — a closed deadlock: icons wait on inventory, inventory waits on a "collaborative pass" | `OPEN` | — | Someone must break the circle |
| B16 | **Interface furniture** — three contradictory positions in one file | `OPEN` | #8 | Locked table with a literal `?` for the count |

## 3. Product areas never discussed

| # | Item | Status | Notes |
|---|---|---|---|
| N1 | **Onboarding / tutorial** | `OPEN` | Must teach 24 conditions, hidden karma, deals, drafting, a paperdoll. No tooltips, glossary, codex or help screen exist. Design forbids the usual crutch — karma must stay unreadable |
| N2 | **Difficulty / assist options** | `OPEN` | 45–90 min permadeath, 32.9% win rate, no easy mode, no assists. A legitimate position — **write it down as one** |
| N3 | **Save slots** | `OPEN` | One save, one run, no slots, no export — in **`localStorage`** in a packaged desktop game |
| N4 | **Error handling / crash recovery** | `OPEN` | LLM failure continues silently; corrupt save discarded with no message; disk-full swallowed. Only the canvas fallback was actually decided |
| N5 | **Window management** | `OPEN` | Entire policy is `1100×820`. No min size, resizable, fullscreen, DPI or multi-monitor handling — under a full-screen-canvas mandate |
| N6 | **Input model** | `OPEN` | Mouse-only in practice, but `:focus-visible` is styled — half-supported keyboard nobody decided |
| N7 | **External playtest / QA** | `OPEN` | One engineer, one laptop, checklist stale since 2026-08-14. No external testers, no feedback channel, **no plan to playtest the subject matter with anyone** |
| N8 | **Localisation** | `PARKED` | English-only is right for a 4B English narrator. State it on the store page |

## 4. Bugs — fix, don't decide

| # | Item | Status | Severity | Notes |
|---|---|---|---|---|
| G1 | **Quitting mid-run voids all unlock progress** | `BUG` | ⛔ severe | Resume never rebuilds `runSummary`/`runSeed`. Earn an unlock, quit, return, win — you get nothing. **The whole meta-progression pillar** |
| G2 | **Winning leaves a resumable save** | `BUG` | ⛔ | `ending` maps to `continue`, not `game-over`. Relaunch after victory: *"A descent lies unfinished."* |
| G3 | **Corrupt unlock store wipes everything silently** | `BUG` | ⛔ | `decode(raw) ?? createUnlockStore()`. No message, no backup. The only permanent artifact the game has |
| G4 | **You can flee the floor-4 Warden** | `BUG`+design | ⛔ | No boss check in the flee path. The verdict encounter is escapable on ~25%. Smoke Vial makes it guaranteed |
| G5 | **"Abandon the descent" — one click, no confirmation** | `BUG` | high | Third in the hub menu; destroys a 45–90 min run. No `confirm` anywhere in the render layer |
| G6 | **Log written inside the install dir, uncapped** | `BUG` | high | Commonly read-only when packaged → **logging silently dies in the shipped product**. No rotation |
| G7 | **Equip bypasses the engine** | `DECIDED` → task #1 | ⛔ | Balance report is fiction until fixed |
| G8 | **Run seed is wall-clock, never shown or stored** | `BUG` | medium | No seeded runs, no daily challenge, **no reproducible bug reports from testers** |
| G9 | **Floor length inherited from the Java port** | `OPEN` | medium | Encounters-per-floor is an emergent side-effect. The 45–90 min target has never been measured |
| G10 | **Death has no run-summary screen** | `OPEN` | medium | One button. Yet Halo Fragment grants "revive once per run" |

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
