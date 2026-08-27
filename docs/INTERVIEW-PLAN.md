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

*These gate pipeline units. Nothing in `docs/PLAN.md` should start until Phase A is `DONE`.*

| # | Round | Covers | Blocks | Status | Lands in |
|---|---|---|---|---|---|
| A1 | ~~The rest & recovery loop~~ | rest heals HP **and charges**, and is the build-management point; chests = consumables/gear + rare unique; **healing becomes scarce** | #2 #6 | `DONE` | `GAME-DESIGN.md` §18 |
| A2 | ~~The spare mechanic~~ | **sparing costs the loot and the XP** — mercy against greed in one press | #2 #6 | `DONE` | `GAME-DESIGN.md` §18.3 |
| A3 | ~~Death, revive & permadeath~~ | **the revive stays — you bought it with yourself.** Permadeath holds: you cannot reload, only pre-pay | #1 #6 | `DONE` | `GAME-DESIGN.md` §19.1 |
| A4 | ~~XP comes from the enemy~~ | **fixed an inherited defect** — enemy XP was rolled at random from the *player's* XP. Now derived from the enemy's own strength + a base | #2 | `DONE` | `GAME-DESIGN.md` §19.2 |
| **A4b** | ~~The level-up draft pool~~ | **Stats LEAVE the draft** — a per-level allowance you spread yourself, D&D-style. The draft is skills + upgrades. **Max level 20** | #2 | `DONE` | `GAME-DESIGN.md` §19.5 |
| A5 | ~~The seed~~ | **shown, stored and enterable.** Unlocks reproducible bug reports, which the playtest plan had no way to get | #1 #8 | `DONE` | `GAME-DESIGN.md` §19.3 |
| A6 | ~~Confirmations~~ | **confirm on abandon + slot overwrite, and MOVE Abandon** out of the top group — the adjacency is the actual cause | #8 | `DONE` | `GAME-DESIGN.md` §19.4 |

## Phase B — content design

*Needed before authoring (#13) and before the art batches can be prompted accurately.*

| # | Round | Covers | Blocks | Status | Lands in |
|---|---|---|---|---|---|
| B1 | ~~Absolution above ground~~ | **Stratified by height** — vertical position is social position. But the ascent **ends at the threshold**, so the city is only glimpsed | #18 #13 | `DONE` | `WORLD.md` §14 |
| B2 | ~~House Grandmore as a place~~ | **Not needed** — extraction happens in Memorian infrastructure **inside the Rift**. Also closes the old "where is the body" question | #18 #13 | `DONE` | `WORLD.md` §14 |
| B3 | ~~The Memorians as a final encounter~~ | **Not a fight.** They cannot see it as a person. Mirrors the Warden inversely | #18 #11 | `DONE` | `WORLD.md` §14 |
| B4 | ~~The bosses as characters~~ | Kingpins hold **domains**; the Reflection **speaks as you**; the Sin **accuses**; the Hollow Self is **calm and right**. Names still the author's | #11 #13 | `DONE` | `WORLD.md` §15 |
| **B4b** | ~~Talking to bosses~~ | **Free text, free to use, and it can change the fight** through engine-defined outcomes only. ⚠ Exploit flagged + a concession-cap proposed | #6 #11 #12 | `DONE` | `GAME-DESIGN.md` §20 |
| B5 | **The 24 enemy families** | Which have identity beyond a name; nine still carry legacy Java joke names; what each *is* now the world exists | #9 #13 | `QUEUED` | GAME-DESIGN |
| B6 | **The 24 conditions** | Whether all 24 earn their place; which are inert; their vocabulary now the rename is happening; `exposed` is a 25th with no design entry | #1 #6 | `QUEUED` | GAME-DESIGN |
| B7 | **Elements & resistances** | Seven elements — do they interact, resist, combo? Currently mostly flavour | #2 #9 | `QUEUED` | GAME-DESIGN |
| B8 | **Class kits in detail** | Four skills each — final? The signature twists, two of which are no-ops. What each class *plays* like | #9 #13 | `QUEUED` | GAME-DESIGN |
| B9 | **The Neuromancer's knowledge** | Flagged in WORLD §0b as "live dramatic material" — how much does a *given* Neuromancer know about what their own order does? | #13 | `QUEUED` | WORLD |
| B10 | **The codex & tooltips** | What the codex actually contains; how much it explains; what stays unexplained on purpose | #8 #13 | `QUEUED` | UI-DESIGN |
| B11 | **Audio, floor by floor** | What each floor *sounds* like; what the score is doing; where silence sits | #15 | `QUEUED` | ART-BIBLE |

## Phase C — presentation & release

| # | Round | Covers | Blocks | Status | Lands in |
|---|---|---|---|---|---|
| C1 | **Title, identity & store page** | The game's own title treatment; what the itch page says; screenshots; the content warning's placement | #14 #17 | `QUEUED` | SHIPPING |
| C2 | **Text speed, defaults & first-run** | Narration speed default; what the very first launch does; where the content warning sits in that flow | #8 | `QUEUED` | UI-DESIGN |
| C3 | **The playtest build** | Who the 5–10 people are; what you want from them; how they report back; what build they get | #14 | `QUEUED` | SHIPPING |

---

## Not interviews

Tracked here so they are not mistaken for open questions. These belong to build, verify or balance
work — see `docs/FINDINGS.md` and `docs/PLAN.md`.

| Item | Kind |
|---|---|
| Generated-art & music licence (S3) | **Verification** — and it blocks shipping |
| Canvas + 4B inference on the min machine (B9) | **Measurement**, before #7 |
| `jsdom` vs `node` test environment (B7) | **Technical** — decide inside #1 |
| Grace/cast-down thresholds (B12), enemy scaling (B14) | **Balance numbers** — belong to the re-run in #2 |
| Localisation (N8) | **Parked** — English-only, stated on the store page |
| G1–G8 | **Bugs** — fixes already specified in FINDINGS §4 |
| R4 second prose pass, R5 direction-aware hook | **Build work** — #13 and #1 |

---

## Completed rounds

_Newest first. Every round that has been asked and written down._

| Date | Round | Outcome |
|---|---|---|
| 2026-08-27 | **B4 + B4b** — bosses & talking | Kingpins hold domains; the Reflection speaks as you; the Sin accuses; the Hollow Self is calm and right. **New feature: you can TALK to bosses in free text**, free of turn cost, and it can change the fight through engine-defined outcomes. `WORLD.md` §15 / `GAME-DESIGN.md` §20 |
| 2026-08-27 | **A4b + B1–B3** — levelling & the ascent's end | Stats leave the draft (per-level allowance, **max level 20**); Absolution is stratified by height but only **glimpsed**, since the ascent ends at the Undercity threshold; **extraction happens in the Rift**, closing R1/R2 and the old body-location question; the Memorians **do not fight**. `WORLD.md` §14 / `GAME-DESIGN.md` §19.5 |
| 2026-08-27 | **A3–A6** — death, XP, seeds, confirms | Revive stays (bought with yourself); **enemy XP now derives from the ENEMY, fixing a feedback loop where it was rolled from the player's own XP**; the seed is shown/stored/enterable; Abandon gets a confirm and moves. `GAME-DESIGN.md` §19. **A4b re-queued.** |
| 2026-08-27 | **A1 + A2** — recovery & sparing | Rest restores HP **and charges** and is the build-management point; chests carry consumables/gear + a rare unique; **sparing costs loot and XP**; **healing becomes scarce** (potion fold-in flagged for confirmation). `GAME-DESIGN.md` §18 |
| 2026-08-27 | Hollow ascent | It **rises** 5→1 to reach the Memorians; the Warden shows mercy instead of judgement; same floors reversed; built bidirectionally. **Opened R1–R5.** `WORLD.md` §13 |
| 2026-08-27 | Endings · Sins · boss agents · unlock feats | Blended within a binary gate; seven distinct Sin behaviours; the model chooses boss actions under five hard constraints; feats designed to teach. `GAME-DESIGN.md` §17 |
| 2026-08-26 | Tempo & equipping | The **tempo gauge** (DEX-driven, visible); equipping is hub-only. `GAME-DESIGN.md` §16 |
| 2026-08-26 | Performance · UI art · run length | 30fps everything-on; the **art-vs-interface rule**; run length measured in the balance re-run |
| 2026-08-26 | A11y · endings · icons · playtesting | Full accessibility incl. screen reader; authored anchors; bespoke item icons; a small trusted group |
| 2026-08-26 | Legal · release · fleeing · death | Proprietary + third-party notices; free on itch; **bosses cannot be fled**; a narrator-written run summary |
| 2026-08-26 | Onboarding · saves · errors · window | Tooltips + codex; multiple slots on disk; tell-retry-recover; min size & remembered bounds |
| 2026-08-26 | Typeface · initiative · model tier · loot | JetBrains Mono; **no initiative system**; 4B only (**min spec now needs a GPU**); consumables from drops, uniques rare from anything |
| 2026-08-26 | Content warning · a11y · settings · difficulty | Warning on **every** fresh run; floor tag + narration beat; a settings screen; **one difficulty** |
| 2026-08-26 | Floor mechanics (Tier 1) | Hybrid architecture; floors 2–5 specified; the engine writes the choices; equip becomes an input |
| 2026-08-25 | Art direction | 32-bit-era 2D pixel; posing; the PS1 render read; batch pricing; generation order |
| 2026-08-25 | Worldbuilding, 6 rounds | The whole world — `docs/WORLD.md`. **The condition is the Hollow**; the descent happens *during* an extraction |
