# The Void — Interview Plan

**The queue of everything still to ask the author, and the record of what has been asked.**
Nothing gets built until this is worked through.

---

## How this works

1. **One round = up to 4 questions**, grouped by theme so answers inform each other.
2. **Rounds run in order within a phase**, but the plan is **adaptive**: an answer may add rounds,
   delete rounds, or reorder them. When that happens, **edit this file in the same turn** — the plan
   is only useful if it is current.
3. **An answer is not recorded until it is written into an authoritative document.** Update the row's
   `Lands in` column with the section. `docs/README.md` holds the precedence order.
4. **Every round also updates `docs/FINDINGS.md`** — struck rows there, new rows if the answer opened
   something. FINDINGS is the register; this file is the queue.
5. **New topics discovered mid-interview go in the queue**, not into a side note. If it needs the
   author, it gets a row here.

**Status:** `QUEUED` · `ASKED` awaiting an answer · `DONE` answered *and written down* ·
`DROPPED` no longer needed, with a reason · `NOT-AN-INTERVIEW` belongs to build/verify/balance work.

---

## Phase A — blocks building

*These gate pipeline units — **per item, not as a block**. No unit starts while a Phase-A row that
**blocks it** is still open; check the `BLOCKS` column here and in `FINDINGS.md`. (This used to read
"nothing starts until Phase A is `DONE`", which contradicted `PLAN.md` — A1 is `DONE (partial)` and
blocks only #2 and #6, so #1, #3 and #4 are genuinely unblocked.)*

| # | Round | Covers | Blocks | Status | Lands in |
|---|---|---|---|---|---|
| A1 | ~~The rest & recovery loop~~ | rest heals HP **and charges**; chests = consumables/gear + rare unique; **healing becomes scarce** | #2 #6 | `DONE (partial)` — **the potion fold-in still needs confirming** (FINDINGS A1b) | `GAME-DESIGN.md` §18 |
| A2 | ~~The spare mechanic~~ | **sparing costs the loot and the XP** — mercy against greed in one press | #2 #6 | `DONE` | `GAME-DESIGN.md` §18.3 |
| A3 | ~~Death, revive & permadeath~~ | **the revive stays — you bought it with yourself.** Permadeath holds: you cannot reload, only pre-pay | #1 #6 | `DONE` | `GAME-DESIGN.md` §19.1 |
| A4 | ~~XP comes from the enemy~~ | **DECIDED, NOT BUILT** — `enemy.ts:117` still rolls XP from `playerXp`. Ruling: derive it from the enemy's own strength + a base | #2 | `DONE` *(decision only)* | `GAME-DESIGN.md` §19.2 |
| **A4b** | ~~The level-up draft pool~~ | **Stats LEAVE the draft** — a per-level allowance you spread yourself, D&D-style. The draft is skills + upgrades. **Max level 20** | #2 | `DONE` | `GAME-DESIGN.md` §19.5 |
| A5 | ~~The seed~~ | **shown, stored and enterable.** Unlocks reproducible bug reports, which the playtest plan had no way to get | #1 #8 | `DONE` | `GAME-DESIGN.md` §19.3 |
| A6 | ~~Confirmations~~ | **confirm on abandon + slot overwrite, and MOVE Abandon** out of the top group — the adjacency is the actual cause | #8 | `DONE` | `GAME-DESIGN.md` §19.4 |
| **A7** | **Karma inputs & verdict weighting** ⭐ **NEW, QUEUED 2026-08-28** | **Half the karma model never fires.** Of 8 declared actions only 4 exist in code; `leaveOffering`, `honorDead`, `embraceWhisper` and `seeThroughIllusion` appear nowhere. So `reverenceDesecration` — the axis the final reckoning weights **most heavily** (weight 3) — can only ever move toward **CAST-DOWN**, never toward GRACE; `clarityDelusion` is permanently 0, so "The Delusion" can never be the act-3 boss; and the grace deal pool is unreachable. **The question:** wire the four missing positive actions to real inputs, or re-weight onto the axes that can actually move and record the deferral? | **#2 #14** | `OPEN` — **needs the author** | `GAME-DESIGN.md` §7 + `FINDINGS.md` G15 |
| **A8** | **The endings' voice, and whether the player has a name** ⭐ **NEW, QUEUED 2026-08-28** | `WORLD.md` §8 is `[LOCKED]`: **"Second person, because it is inside you, not beside you"**, restated twice as an absolute — *"No guide, no companion, no exterior. Second person, inside, only."* **But the shipped ending anchors are third person and name you:** *"{playerName} is judged worthy and rises from the Void, made whole."* `WORLD.md` renders the same endings correctly in second person, so the conflict is with the data, not the idea. **Separately: no document anywhere states the player character has a name** — §7 defines the protagonist purely as a role, yet the UI mockup shows a proper name and the engine interpolates `{playerName}`. **Two questions:** (1) do the endings speak to you in second person and never by name — or is the archive filing you from outside the one deliberate exception, because *being filed is what §0b's archive does*? (2) Does the player character have a name, and is it chosen, given, or absent? | **#13 #14** | `OPEN` — **needs the author** | `WORLD.md` §8 + `data/story.json` |

## Phase B — content design

*Needed before authoring (#13) and before the art batches can be prompted accurately.*

| # | Round | Covers | Blocks | Status | Lands in |
|---|---|---|---|---|---|
| B1 | ~~Absolution above ground~~ | **Stratified by height** — vertical position is social position. But the ascent **ends at the threshold**, so the city is only glimpsed | #18 #13 | `DONE` | `WORLD.md` §14 |
| B2 | ~~House Grandmore as a place~~ | **Not needed** — extraction happens in Memorian infrastructure **inside the Rift**. Also closes the old "where is the body" question | #18 #13 | `DONE` | `WORLD.md` §14 |
| B3 | ~~The Memorians as a final encounter~~ | **Not a fight.** They cannot see it as a person. Mirrors the Warden inversely | #18 #11 | `DONE` | `WORLD.md` §14 |
| B4 | ~~The bosses as characters~~ | Kingpins hold **domains**; the Reflection **speaks as you**; the Sin **accuses**; the Hollow Self is **calm and right**. Names still the author's | #11 #13 | `DONE` | `WORLD.md` §15 |
| **B4b** | ~~Talking to bosses~~ | **Free text, free to use, changes the fight** via engine-defined outcomes | #6 #11 #12 | `DONE (partial)` — **the concession cap is still OPEN** (FINDINGS B4c) | `GAME-DESIGN.md` §20 |
| B5 | ~~The 24 enemy families~~ | **All rewritten against the world**, not just the nine broken ones. ⚠ **Must land before art batch 3** — **30** sprites prompt from these | #9 #13 | `DONE` | `GAME-DESIGN.md` §21.3 |
| B6 | ~~The conditions~~ | **25, and the six stat pairs stay** — learnable by pattern, and what makes stats matter in a fight. `exposed` is the 25th: **fix the doc, not the code** | #1 #6 | `DONE` | `GAME-DESIGN.md` §21.1 |
| B7 | ~~Elements & resistances~~ | **Resistances only, no combos.** Depth lives in conditions, tempo and builds | #2 #9 | `DONE` | `GAME-DESIGN.md` §21.4 |
| B8 | ~~Class kits~~ | **Four signature skills = identity**; start with 1–2, draft to ~6–8 from the shared pool. Twist-wiring **sequencing deferred to the milestone pass** | #9 #13 | `DONE` | `GAME-DESIGN.md` §21.5 |
| B9 | ~~The Neuromancer's knowledge~~ | **A junior — they do not know yet.** The order is the perpetrator; the playable one discovers it alongside the player. **Corrects an over-strong line in WORLD §0c** | #13 | `DONE` | `WORLD.md` §0c |
| B10 | ~~The codex~~ | **Mechanics fully; the world never.** A lore codex would destroy the central secret in a menu | #8 #13 | `DONE` | `GAME-DESIGN.md` §21.6 |
| B11 | ~~Audio, floor by floor~~ | **The score THINS as you descend** and near-vanishes by floor 5. Floor 4 choir is the exception and should shock. The ascent reverses it | #15 | `DONE` | `ART-BIBLE.md` §16 |

## Phase C — presentation & release

| # | Round | Covers | Blocks | Status | Lands in |
|---|---|---|---|---|---|
| C1 | ~~Store page~~ | **Honest and plain**, warning near the top, requirements unburied | #14 #17 | `DONE` | `SHIPPING.md` |
| C2 | ~~First run~~ | **Warning → download → play.** Warning BEFORE the 2.5 GB fetch; no setup wizard | #8 | `DONE` | `SHIPPING.md` |
| C3 | ~~The playtest~~ | **Three questions:** does it run elsewhere, is it comprehensible, **does the subject land** | #14 | `DONE` | `SHIPPING.md` |

---

## Not interviews

Tracked here so they are not mistaken for open questions. These belong to build, verify or balance
work — see `docs/FINDINGS.md` and `docs/PLAN.md`.

| Item | Kind |
|---|---|
| Generated-art & music licence (S3) | **Verification** — and it blocks shipping |
| Canvas + 4B inference on the min machine (B9) | **Measurement**, before #7 |
| `jsdom` vs `node` test environment (B7) | **Technical** — decide inside #1. Now listed explicitly as change 8 in `PLAN.md` #1, so it cannot be missed |
| Grace/cast-down thresholds (B12), enemy scaling (B14) | **Balance numbers** — belong to the re-run in #2 |
| Localisation (N8) | **Parked** — English-only, stated on the store page |
| G1, G3–G8, G11–G14, G16–G22 | **Bugs** — fixes specified in FINDINGS §4 (18 of 20). ⚠ **G2 has no fix specified yet** |
| **G15** | ⚠ **NOT a bug — an AUTHOR DESIGN RULING.** Half the karma model never fires, and `reverenceDesecration` (the heaviest verdict axis, weight 3) can only ever move toward CAST-DOWN. **See Phase A row A7 above** |
| R4 second prose pass, R5 direction-aware hook | **Build work** — #13 and #1 |

---

## Completed rounds

_Newest first. Every round that has been asked and written down._

| Date | Round | Outcome |
|---|---|---|
| 2026-08-27 | **B11 + C1–C3** — audio & release | The score **thins as you descend**, the ascent climbs back into sound; store page honest and unburied; first run is warning then download then play; the playtest asks three questions in priority order |
| 2026-08-27 | **B8–B10** — kits, the Neuromancer, the codex | Four signature skills drafted up to ~6–8; **the playable Neuromancer is a JUNIOR who does not know** (corrects WORLD §0c); the codex explains mechanics and never the world. Twist-wiring order deferred to the milestone pass |
| 2026-08-27 | **B5–B7** — conditions, enemies, elements | 25 conditions with the six stat pairs kept (learnable by pattern); `exposed` is the 25th and the **doc** was wrong; **all 24 enemy families rewritten against the world — must precede art batch 3**; elements gate resistances only. `GAME-DESIGN.md` §21 |
| 2026-08-27 | **B4 + B4b** — bosses & talking | Kingpins hold domains; the Reflection speaks as you; the Sin accuses; the Hollow Self is calm and right. **New feature: you can TALK to bosses in free text**, free of turn cost, and it can change the fight through engine-defined outcomes. `WORLD.md` §15 / `GAME-DESIGN.md` §20 |
| 2026-08-27 | **A4b + B1–B3** — levelling & the ascent's end | Stats leave the draft (per-level allowance, **max level 20**); Absolution is stratified by height but only **glimpsed**, since the ascent ends at the Undercity threshold; **extraction happens in the Rift**, closing R1/R2 and the old body-location question; the Memorians **do not fight**. `WORLD.md` §14 / `GAME-DESIGN.md` §19.5 |
| 2026-08-27 | **A3–A6** — death, XP, seeds, confirms | Revive stays (bought with yourself); **enemy XP to derive from the ENEMY**, fixing a feedback loop where it is rolled from the player's own XP (*decided; the defect is still in `enemy.ts:117`*); the seed is shown/stored/enterable; Abandon gets a confirm and moves. `GAME-DESIGN.md` §19. **A4b re-queued.** |
| 2026-08-27 | **A1 + A2** — recovery & sparing | Rest restores HP **and charges** and is the build-management point; chests carry consumables/gear + a rare unique; **sparing costs loot and XP**; **healing becomes scarce** (potion fold-in flagged for confirmation). `GAME-DESIGN.md` §18 |
| 2026-08-27 | Hollow ascent | It **rises** 5→1 to reach the Memorians; the Warden shows mercy instead of judgement; same floors reversed; built bidirectionally. **Opened R1–R5.** `WORLD.md` §13 |
| 2026-08-27 | Endings · Sins · boss agents · unlock feats | Blended within a binary gate; seven distinct Sin behaviours; the model chooses boss actions under five hard constraints; feats designed to teach. `GAME-DESIGN.md` §17 |
| 2026-08-26 | Tempo & equipping | The **tempo gauge** (DEX-driven, visible); equipping is hub-only. `GAME-DESIGN.md` §16.1 |
| 2026-08-26 | Performance · UI art · run length | 30fps everything-on; the **art-vs-interface rule**; run length measured in the balance re-run |
| 2026-08-26 | A11y · endings · icons · playtesting | Full accessibility incl. screen reader; authored anchors; bespoke item icons; a small trusted group |
| 2026-08-26 | Legal · release · fleeing · death | Proprietary + third-party notices; free on itch; **bosses cannot be fled**; a narrator-written run summary |
| 2026-08-26 | Onboarding · saves · errors · window | Tooltips + codex; multiple slots on disk; tell-retry-recover; min size & remembered bounds |
| 2026-08-26 | Typeface · initiative · model tier · loot | JetBrains Mono; **no initiative system**; 4B only (**min spec now needs a GPU**); consumables from drops, uniques rare from anything |
| 2026-08-26 | Content warning · a11y · settings · difficulty | Warning on **every** fresh run; floor tag + narration beat; a settings screen; **one difficulty** |
| 2026-08-26 | Floor mechanics (Tier 1) | Hybrid architecture; floors 2–5 specified; the engine writes the choices; equip becomes an input |
| 2026-08-25 | Art direction | 32-bit-era 2D pixel; posing; the PS1 render read; batch pricing; generation order |
| 2026-08-25 | Worldbuilding, 6 rounds | The whole world — `docs/WORLD.md`. **The condition is the Hollow**; the descent happens *during* an extraction |
