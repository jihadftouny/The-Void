# The Void — Scope Audit 2 (2026-08-26)

_Commissioned to test the claim "the interviews are done — everything left is building and
authoring, not deciding." **The claim was false.** This is what the first audit and five interview
rounds still missed._

**Companion to `docs/SCOPE-AUDIT.md`** (2026-08-25), which covered content, systems and document
contradictions. This one covers **open decisions, unexamined product areas, and decisions already
made by accident in code.**

> **⚠ This is a FROZEN EVIDENCE SNAPSHOT (2026-08-26).** The live list is **`docs/FINDINGS.md`**.

**How to use:** same as audit 1 — work items out into the authoritative docs as they are decided and
strike them here. An item is resolved only when it is *written down*, not when it is discussed.

---

## Headline

Three distinct failures of the claim:

1. **24 open decisions survive in the authoritative docs**, including **five live `[PROPOSAL]` tags**
   (the design doc's own definition of "not final"). At least five of them **block UI units #6–#8**,
   which `PLAN.md` listed as ready to build.
2. **Fourteen whole product areas were never discussed at all.** Only two — localisation and telemetry
   — are safe defaults. **Four block shipping outright:** legal/licensing, the content warning,
   the update mechanism, and accessibility.
3. **Eleven decisions have already been made by accident in code.** Three of them **silently destroy
   player data.** One lets the player walk away from the game's climactic moral judgement on a dice
   roll.

---

## A — Open decisions still in the docs

### The five surviving `[PROPOSAL]` tags

| # | Where | What | Status |
|---|---|---|---|
| **P1** | `GAME-DESIGN.md:163-165` | **The equipment slot set** (Tibia-derived: helmet, amulet, two hands…) — *"Confirm/trim this list."* | **GENUINE. Blocks #8** — you cannot draw a paperdoll against a slot list nobody approved. Scheduled for M4/M5; both merged without it |
| P2 | `GAME-DESIGN.md:226-229` | Relic/unique seed ideas | Superseded by the fuller catalogue at `:178-194`. **Delete** — it reads as open |
| P3 | `UI-DESIGN.md:157` | The five-unit UI decomposition | Adopted in `PLAN.md`. **Retag** |
| P4 | `UI-DESIGN.md:194-204` | The art-pipeline shape | Adopted — but it names `src/assets/` and `artPrompts.json`, **neither of which exists** |
| P5 | `UI-DESIGN.md:216-224` | The 39-asset first batch | Superseded by 52/53. **Four different totals are still in circulation across the docs** |

### The rest, ranked by cost of discovering late

1. **Consumables & uniques have no source** (`GAME-DESIGN.md:661-670`). Already flagged. Blocks #9 and #13.
2. **The typeface is not actually chosen** (`ART-BIBLE.md:583-589`). Three candidates, one of them
   **paid** (Berkeley Mono) which needs a spending decision, and a licence check for redistribution.
   **Blocks building:** every spacing token in `tokens.ts` is provisional until a real face lands,
   and three UI units are about to be built on those tokens.
3. **Audio licensing is explicitly unverified** (`ART-BIBLE.md:559-562`) — and **the same question was
   never asked about the art.** Nowhere is the commercial-redistribution licence for
   `gemini-3-pro-image` output recorded. **Blocks shipping.**
4. **Model tier: 4B-only vs the recommended dual-tier.** `N1-SPIKE.md:56-62` recommended shipping
   both and auto-selecting by hardware; `electron/llm.mjs:15` says "4B only". **This is recorded
   nowhere as a decision and is in no task.** It matters enormously: `UI-DESIGN.md:61-62` justifies
   the whole narration cadence on **89 tok/s and 181 ms to first token** measured on an RTX 5060 —
   and the spike measured the min-spec no-GPU machine at **7.6 tok/s, ~5 s to first token**. That is
   27× slower, and it changes the battle screen's "thinking" UX.
5. **Interface furniture** (`ART-BIBLE.md:314, 321-326`) — a locked table whose asset count is a
   literal `?`, an explicit "OPEN — the author must settle", a later claim it settled as "none", and
   a still-later admission of cursors. **Three positions in one file.**
6. **Turn / initiative model** (`GAME-DESIGN.md:154` `[OPEN]`). `statEffects.ts:181`
   `initiativeOrderTwist` returns `0`, commented "no-op until M4" — **M4 merged without filling it**,
   so Quick and Slow are half-inert. **Blocks #6:** a battle screen showing turn order needs to know
   whether one exists.
7. **Backpack capacity/weight** (`GAME-DESIGN.md:223-224`) and **two-handed vs shield vs dual-wield**
   (`:225`). **Both block #8** — the paperdoll needs to know if the second hand is a slot or a mode.
8. **Item-icon granularity is a closed deadlock.** Icons wait on the inventory design
   (`ART-BIBLE.md:483`), the inventory design waits on "a collaborative pass" (`UI-DESIGN.md:353`),
   and the icon question waits on the first batch. **Someone has to break the circle.**
9. **Enemy scaling formula** (`GAME-DESIGN.md:463`) and **the affix list** (`:464`) — both tagged
   `[OPEN → M8]`, **M8 merged without answering either**. `enemyAffixes.json` still calls two affixes
   "provisional".
10. **itch pricing** and **crash/telemetry** (`ROADMAP.md:210-211`) — both block shipping, neither in `PLAN.md`.
11. **Min-spec quality gating** (`ROADMAP.md:204`) — decides what `canvas-layer` must build a toggle
    for. **`PLAN.md` has no M16 item at all**; polish and game-feel are simply not in the plan.
12. **Ending text: deterministic vs generative** (`ROADMAP.md:189-190`). #12 and #13 both depend on it.
13. **Grace vs cast-down thresholds** (`GAME-DESIGN.md:425`), sitting on **unclamped karma**
    (`karma.ts:75`). **Blocks the balance re-run in #2.**
14. **Five un-ticked author rulings** in `HUMAN-CHECKS.md:236-250` — including a live
    `[NEEDS-HUMAN: 25% vs 35%?]` in `battle.ts:16` for the flee chance.
15. **`jsdom` vs `node` test environment** — decide once, or three UI units each invent an override.
16. **`GAME-DESIGN.md` has two §14s**, and §15 still opens "the design brainstorm is essentially
    complete (2026-08-05)" while listing the above as outstanding.

---

## B — Product areas never discussed at all

**Ranked by how bad it is to find out late.** Only B13 and B14 are safe defaults.

### B1. Accessibility — absent. **Blocks shipping.**
The entire accessibility surface is: contrast *maths helpers* used by token tests, one `aria-live`,
and a few `aria-label`s. Against that:
- **Colour is the player's primary state channel.** The whole readability system is one accent
  colour per floor, and karma is invisible by design. **There is no alternate encoding.**
- **Unskippable full-screen shake and hit-flash with no reduced-motion story** — in a game about
  psychosis. That is an accessibility failure and a thematic own-goal simultaneously.
- No text-size control, no high-contrast mode, no remappable input.

`ART-BIBLE.md:570` already established the pattern for exactly this class of problem — *"the battle
screen must expose audio hooks on every beat even if no sound file exists yet… cheap now; a rewrite
afterwards."* **The identical argument applies to a motion flag and nobody made it.**

### B2. Settings / options screen — absent. **Blocks #6, #7, #8.**
Zero mentions anywhere. `UI-DESIGN.md:153-155` enumerates every screen the restyle covers and a
settings screen is not among them — and `PLAN.md` #8 inherits that list verbatim. Compounding:
**audio just went in scope at full ambition with no volume control**, and there is no home for a
reduced-motion toggle, text speed, or a model-tier override.

### B3. Legal — almost entirely absent. **Hard blocker on any public release.**
- **No `LICENSE`, `NOTICE`, or `THIRD-PARTY` file exists.** Both legacy ports have one.
- `package.json` has no `license`, `author`, `description` or `repository`; version `0.0.0`.
- Redistributing Qwen3 (Apache-2.0) **requires** shipping the licence and a NOTICE. Same for
  Electron, node-llama-cpp/llama.cpp, Kaplay, the chosen font — **and the generated art and music,
  whose terms are recorded nowhere.**
- No privacy statement, though the app writes to disk. No age rating / content descriptor.
- **NO CONTENT WARNING ANYWHERE.** Zero hits across every file for content/trigger warning,
  disclaimer, mental health, suicide, self-harm. The game's own design doc calls it *"lived experience of psychosis rendered as a dungeon"*; floor 3 is populated by Grief, Dread and
  Numbness. **This is the most conspicuous omission in the project.** It is free to add, expected of
  the subject matter, and its absence becomes a public conversation rather than a bug report.

### B4. Difficulty options — only a deferred ascension ladder. **Real gap.**
No easy/story mode, no assist options, no mercy rule — in a 45–90 minute permadeath roguelike whose
own balance headline is **32.9%**, measured on a character that never equips found loot. Shipping
without assist options is a legitimate design position, but **nobody has written it down as one.**

### B5. Onboarding / tutorial — absent as a designed thing. **Real gap.**
Three passing mentions and no mechanism, for a game that must teach **24 status conditions**, four
hidden karma axes, sacrifice-deals, a 1-of-3 draft, a Tibia paperdoll, and a spare action with
invisible consequences. No first-run flow, no tooltips, no glossary, no codex, no help screen. And
the design forbids the usual crutch: karma must never be readable. **A hidden pillar with no teaching
surface is not subtle — it is invisible.**

### B6. Error handling / crash recovery — handled by accident, never designed.
- LLM failure → a status line; **the game continues silently narration-less**, with no retry and no
  explanation. Arguably right, and **nobody chose it**.
- Corrupt save → dropped to a new game **with no message that a save was discarded**.
- Disk-full → the write failure is swallowed; **the player is never told the run is not being saved**.
- Canvas failure → **actually decided** (`UI-DESIGN.md:107`). The only one.
- Uncaught errors → logged to a file and nothing else. No crash screen.

### B7. Save slots — absent, and worse than absent. **Real gap.**
`persist.ts:9` — one key, **one save, one run, no slots, no export** — stored in **`localStorage` in a
packaged desktop game**, with the file's own comment admitting a real file-on-disk save is "a
packaging-era concern". That concern was never scheduled. Saves therefore live in the Chromium
profile: an Electron major bump or a profile reset destroys them, there is no backup, and a player
cannot move a save between machines.

### B8. Update mechanism — absent. **Blocks shipping.**
No auto-update, no version check, `electron-builder.json` has **no `publish` block**, `package.json`
is `0.0.0`. A game shipping a 2.5 GB first-run download has **no patch path**. The itch app can do
this — but nobody has said so, and there is no butler config and no CI.

### B9. Window management — decided by accident, badly. **Real gap.**
The entire window policy is `width: 1100, height: 820`. **No minimum size, no resizable flag, no
fullscreen handling, no DPI or multi-monitor logic, no saved bounds** — under a mandate for a
full-screen canvas with screen-wide shake. A player can drag the window to 300×200 with no defined
behaviour. There is also a live contradiction: `PROGRESS.md` still describes the shipped shell as
*"mobile-first, responsive, portrait 540×1080, letterboxed, ≥44px touch targets"* while `CLAUDE.md`
says desktop-first.

### B10. Input model — never stated. Mostly safe, one real gap.
Mouse-only in practice — **not one `keydown` handler in `src/`** — but `tokens.css:79` styles
`:focus-visible`, implying tab navigation nobody decided or verified. **Mouse-only is defensible;
silently half-supporting keyboard is not.**

### B11. Performance targets — absent. **Real gap, blocks #7.**
No frame-rate target, no memory budget, no particle budget. Min spec is "typical laptop, no GPU" —
the same machine already spending ~4.6 GB and 100% CPU on 4B inference — and the plan puts a
full-screen canvas with fog, lighting and particles on it. **Nobody has asked whether the canvas and
the model can coexist on the min spec.** There is also no latency test for narration time-to-first-token,
despite it being the core UX risk.

### B12. External playtest / QA — absent. **Real gap.**
`HUMAN-CHECKS.md` is a solo self-test checklist for one engineer on one RTX 5060 laptop, **last
touched 2026-08-14** — before all the M-UI2, world and art work. No external testers, no
distribution route, no feedback channel, no bug template, **no test on any machine but the author's**
(the "other machines still boot" item is unticked), and **no plan to playtest the subject matter with
anyone** — which is the other half of B3.

### B13. Telemetry — a one-word deferral. **Safe default; write it down.**
Shipping none is almost certainly right, but it must be *stated*, because it answers the privacy
question in B3. **One wrinkle:** `electron/log.mjs` writes a permanent, unrotated, uncapped log
containing the player's chosen name and every game event. Local-only, so not telemetry — but it is
undecided data retention (see C6).

### B14. Localisation — absent. **Safe default; state it.**
English-only is right for an LLM-narrated game with a 4B English narrator. Worth one line, plus a
note on the store page.

---

## C — Decisions already made by accident

### ⛔ C1. Winning does not end the run
The `ending` phase maps to `awaiting: 'continue'`, not `'game-over'`, so the run is **autosaved, not
cleared**. Relaunch after winning and you are told *"A descent lies unfinished. Return to it, or
begin anew."* — **after you have won.** `HUMAN-CHECKS.md` documents that death and new-game clear the
save and simply never considers victory.

### ⛔ C2. Quitting mid-run silently voids all unlock progress
`runSummary` and `runSeed` are initialised at module load and **the resume path never rebuilds
them** — it restores state and memory only. So `applyRunOutcome()` later runs with an **empty summary
and a wall-clock number that is not the run's seed.** Concretely: spare three karma-weighted enemies
to earn the Scavver unlock, quit, come back, win — **you get nothing.** The entire meta-progression
pillar is voided by closing the app. **Must be fixed before #9/#13 add more feats on top of it.**

### ⛔ C3. "Abandon the descent" is one click, no confirmation
It sits **third in the hub menu**, directly under "Continue the descent", and routes straight to
game-over and `clearRun()`. **There is no `confirm` anywhere in the render layer.** Nobody chose to
make a misclick destroy a 45–90 minute permadeath run.

### ⛔ C4. A corrupt unlock store wipes all cross-run progress, silently
`decodeUnlockStore(raw) ?? createUnlockStore()`. One bad byte resets every unlocked class, feat and
the cross-run karma memory to first-launch defaults — **no message, no backup, no recovery.** It is
the only permanent artifact the game has and it has no redundancy.

### ⛔ C5. Floor length was inherited from the Java port, never designed
Floors advance on XP thresholds copied from `GameLogic.checkAct`, so **"how many encounters per
floor" is an emergent side-effect nobody chose.** The design states a target run length of 45–90
minutes and **nothing anywhere measures against it** — and the grace path (4 floors) versus damnation
path (5 floors) asymmetry has never been measured in minutes either.

### ⛔ C8. You can flee a boss — including the Warden
`resolveRound` dispatches `'run'` for **any** battle with no boss check. So the floor-4 Warden — whose
entire function is to deliver the verdict — **can be escaped on a ~25% roll**, returning you to the
hub. What happens to the verdict, the act advance, or a re-entered boss fight is specified nowhere.
Compounded by the Smoke Vial consumable's "guaranteed flee".

### C6. The log is written inside the install directory, uncapped
In a packaged build that path is commonly **read-only**, so **logging silently dies in the shipped
product** — precisely when it is needed. If it does write, it appends forever with no rotation.

### C7. The run seed is wall-clock, never shown, stored or enterable
Which jointly decides three things nobody discussed: **no seeded or shared runs, no daily challenge,
and no reproducible bug reports from players** — the last directly undercutting B12.

### C9. Permadeath-within-a-run is a code accident, not a written rule
No revive, no continue, no run-summary screen, no death statistics — one button. Yet the Halo
Fragment relic grants "revive once per run", inside a system just locked to sacrifice-deals only.

### C10. Equipment bypasses the engine
Already caught (task #1) — listed because its downstream implication is not: `docs/README.md` still
presents `BALANCE-REPORT.md` as authoritative.

### C11. The store page claims things that are not true
`itch-description.html` says text-based, four floors, LLM-generated enemies, and a shop. **Nobody has
decided what the store page actually claims** — and that is the sentence a customer buys on.

---

## The single highest-value next action

**Write the content warning** (B3), and **decide accessibility and a settings screen** (B1, B2) —
because the pattern is already proven in this project's own documents: a hook that is free to add
before a screen is built is a rewrite afterwards. That sentence was written about audio. It is
equally true of a reduced-motion flag, a volume level, and a text-speed control, and nobody applied
it.
