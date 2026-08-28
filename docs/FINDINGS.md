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
| B2 | ~~Equipment slot set~~ | `DECIDED` → **build work** | **#1 #6 #8** | **Seven: head, body, hand ×2, feet, trinket ×2.** Cut amulet, ring, legs, back. Relics occupy the two trinket slots — wear two. `GAME-DESIGN.md` §14.7. ⚠ **The shipped engine has NINE and no `trinket` slot at all** (`item.ts:49`) — migration is `PLAN.md` #1.10 |
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
| B15 | ~~Item-icon granularity~~ | `DECIDED` | — | **Bespoke, one per item.** Deadlock broken by the slot set landing. **68** items today ≈ 204 images ≈ $13.67 batched — but ⚠ **a permanent commitment: every new item needs art forever.** `ART-BIBLE.md` §13 |
| B16 | ~~Interface furniture~~ | `DECIDED` | — | **No generated interface art**; cursor + loading indicator excepted as *functional marks*. Resolved by the art/interface rule: **art depicts things in the world; the interface that frames them stays flat.** `ART-BIBLE.md` §15 |

## 2b. Reopened by the Hollow ascent (2026-08-27)

The Hollow campaign ends at the surface, which reopens two things that were **deliberately parked**
on the grounds that the game is a descent and never goes up. `docs/WORLD.md` §13.

| # | Item | Status | Blocks | Notes |
|---|---|---|---|---|
| R1 | ~~Absolution above ground~~ | `MOSTLY CLOSED` | — | **The ascent ends at the Undercity's exit — the Hollow never enters the city.** Only enough to be *glimpsed*. Shape decided: stratified by height. `WORLD.md` §14 |
| R2 | ~~House Grandmore as a place~~ | `CLOSED` | — | **Not needed.** Extractions happen in **Memorian infrastructure inside the Rift**, not in a noble seat. `WORLD.md` §14 |
| R3 | ~~The Memorians as a final encounter~~ | `DECIDED` | #11 | **Not a fight.** They do not fight because to them it is not a person. Mirrors and inverts the Warden — one does not fight because it sees you, the other because it cannot. `WORLD.md` §14 |
| R4 | ~~Second prose pass, all five floors~~ | `DECIDED` | — | **Authoring work, not a decision** — folded into #13. The inverted register roughly doubles floor *content* work |
| R5 | ~~Floor hook must be direction-aware~~ | `DECIDED` | — | **Build work, not a decision.** Specified in `PLAN.md` #1.3 and locked in `GAME-DESIGN.md` §17.5 ("built bidirectionally"). *It was wrongly listed as blocking #1, contradicting `PLAN.md`.* |

## 2c. Still needs the author (found 2026-08-27)

Both were marked `DONE` in the interview plan while the design document itself says the author must
confirm. That is the worst failure mode of this system — a question that looks answered.

| # | Item | Status | Blocks | Notes |
|---|---|---|---|---|
| A1b | **The potion fold-in** | `OPEN` | #2 | §18.4 says outright: *"⚠ Interpretation flagged for the author… if the intent was to keep the separate potion resource and merely reduce it, say so and this section changes."* It also gates the balance re-run |
| B4c | **The boss-talk concession cap** | `OPEN` | #6 #11 #12 | §20 says: *"Flagged, with a proposed fix the author may overrule."* Free talk + earnable concessions is an exploit; the proposed cap is one concession per fight |
| **A8** | **The endings' voice, and whether the player has a name** ⭐ added 2026-08-28 | `OPEN` | **#13 #14** | `WORLD.md` §8 `[LOCKED]` says *"second person, inside, only"* — but `story.json`'s ending anchors are **third person and name you** (*"{playerName} is judged worthy…"*). WORLD renders the same endings correctly in second person, so the data is the defect — **unless** the archive filing you from outside is a deliberate exception, which is thematically strong and is **nowhere on paper**. Separately, **no document states the player has a name at all**, while the UI mockup shows one and the engine interpolates `{playerName}`. Queued as `INTERVIEW-PLAN.md` **A8** |
| **G15** | **Karma inputs & verdict weighting** ⭐ added 2026-08-28 | `OPEN` | **#2 #14** | Half the karma model never fires; `reverenceDesecration` (heaviest verdict axis, weight 3) can only move toward CAST-DOWN; `clarityDelusion` is permanently 0; the grace deal pool is unreachable. **Wire the four missing positive actions, or re-weight onto axes that move?** Queued as `INTERVIEW-PLAN.md` **A7**. *It sat in §4 as a "bug" and in no author queue — exactly the failure this section exists to catch* |

## 2d. Tracked as build work (not author questions)

*These two were briefly logged in §2c by mistake — they need building, not deciding.*

| # | Item | Status | Blocks | Notes |
|---|---|---|---|---|
| B17 | ~~The draft reversal is in no work plan~~ | `TRACKED` — build work | #1 | **Now `PLAN.md` #1.7.** Stats left the draft, per-level allowance, **max level 20** (§19.5) — `draft.ts` still has `CATEGORY_WEIGHTS.stat` and **no level cap exists in `src/`**. M9 demoted to 🔶 |
| B18 | ~~`#6` has two unrecorded requirements~~ | `TRACKED` — build work | #6 | **Now recorded under `PLAN.md` #6.** Audio hooks on every beat (`ART-BIBLE.md` §10, BLOCKING) and a free-text input for boss talk (§20) |

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

> **Twenty-six rows carry `BUG` status** (of 29 rows — G7, G9 and G10 are `DECIDED`). **Twenty-four
> have a fix specified. `G2` has none. `G15` is not a bug at all** — it is an author design ruling,
> queued as `INTERVIEW-PLAN.md` **A7** and listed in §2c, and it does **NOT** block `#0`.
>
> *(Recounted by hand after pass 7A added G23–G28. This count has been wrong three times: it said
> "eight" before pass 5B, "twenty, eighteen specified" while G16 had no fix, and it is now twenty-six.
> **Recount it by hand rather than trusting this line** — that is what caught it each time.)*

| # | Item | Status | Severity | Blocks | Notes |
|---|---|---|---|---|---|
| G1 | **Quitting mid-run voids all unlock progress** | `BUG` — **fix NOW specified, see G19** | ⛔ severe |  #0c  | Resume never rebuilds `runSummary`/`runSeed`. Earn an unlock, quit, return, win — you get nothing. **The whole meta-progression pillar.** ⭐ **Pass 6A found the root cause and the fix** (2026-08-28): `persist.ts` stores only `{state, memory}`, so persist `runSummary` + `runSeed` in the envelope and restore on resume. **See G19 for the measured reproduction** |
| G2 | **Winning leaves a resumable save** | `BUG` — ⚠ **no fix specified yet** | ⛔ | — *(unschedulable until a fix exists; belongs with #0c)* | `ending` maps to `continue`, not `game-over`. Relaunch after victory: *"A descent lies unfinished."* |
| G3 | **Corrupt unlock store wipes everything silently** | `BUG` — **fix decided** | ⛔ |  #0c  | Keep a **backup copy** and restore from it; if that fails, say exactly what was lost. Also moves to a real file with the saves (N3) |
| G4 | **You can flee the floor-4 Warden** | `BUG` — **fix decided** | ⛔ |  #0a  | **Bosses cannot be fled at all**; Smoke Vial explicitly fails against them. UI must explain why, not just hide the button. `GAME-DESIGN.md` §14.9 |
| G5 | **"Abandon the descent" — one click, no confirmation** | `BUG` — **fix decided** | high |  #8  | **Confirm on abandon + slot overwrite, and MOVE it out of the top group** (`GAME-DESIGN.md` §19.4). Never confirm ordinary combat actions |
| G6 | **Log written inside the install dir, uncapped** | `BUG` — **fix decided** | high |  #14  | Move to user-data, cap and rotate. `docs/SHIPPING.md` |
| G7 | **Equip bypasses the engine** | `DECIDED` → task #1 | ⛔ |  #1  | Balance report is fiction until fixed |
| G8 | **Run seed is wall-clock, never shown or stored** | `BUG` — **fix decided** | medium |  #1 #8  | **Shown, stored and enterable** (`GAME-DESIGN.md` §19.3). Unlocks reproducible tester bug reports |
| G9 | ~~Floor length inherited from the Java port~~ | `DECIDED` | medium |  #2  | **Measure it in the balance re-run and tune the XP curve to the 45–90 min target.** The sim already plays full runs; make it report encounters and minutes per floor, and the grace-vs-damnation asymmetry. `GAME-DESIGN.md` §14.11 |
| G10 | ~~Death has no run-summary screen~~ | `DECIDED` | medium |  #6  | **A run summary written by the narrator** — reached, killed by, your build, unlocked, plus the Void's account. The one place karma is *felt* without being metered. `GAME-DESIGN.md` §14.9 |

### Found 2026-08-28 by discrepancy pass 5B — all six verified by running the real engine

> **These are the most serious defects found in the whole audit.** All six pass the full 1029-test
> suite and a clean typecheck. Each must go through the **agentic pipeline** (`CLAUDE.md`) — none may
> be hand-patched in the main checkout.

| # | Item | Status | Severity | Blocks | Notes |
|---|---|---|---|---|---|
| G11 | **NO item the player finds can EVER be equipped** | `BUG` — **fix specified** | ⛔⛔ **worst in the project** |  #0a  | `rarityGen.ts:116` stamps `defId: 'gen:<rarity>:<slot>'`, but `equipment.ts:131` `canEquip` and `:151` slot inference resolve by **`defId` only** (`resolveGearDef`), which misses every catalog — so it returns `undefined`. Measured: **300 seeds × acts 1–4 + chests → >100 drops, 0 equippable.** Every victory drop, chest and deal reward is inert; the player fights all five Acts in starting gear. The UI renders an **Equip button that silently does nothing**. **Fix:** use `resolveInstanceDef` in `canEquip`, and `resolveInstanceDef(item)?.slot ?? slotForDef(item.defId)` for inference. ⚠ **This invalidates the M15 balance report** — it assumed loot was merely unequipped *by sim policy*, not un-equippable in principle |
| G11b | **Two tests appear to cover G11 and do not** | `BUG` — **fix specified** | ⛔ |  #0a  | `rarityGen.test.ts:77` is *named* "…resolves for equipping" but only calls `resolveInstanceDef`, never `equip()`/`canEquip()`. `equipCascade.test.ts:26-32` writes straight into `inventory.slots.ring`, **bypassing `equip()` entirely** — so the whole M6 cascade suite proves rolled gear works *once equipped* and never that it *can be*. Textbook circular testing (`PRINCIPLES.md` §A3). **Fix:** add a test that calls `equip()` on a real `generateItem` output |
| G12 | **`advantageDisadvantage` is a write-only latch — every boss is fought at the wrong odds** | `BUG` — **fix specified** | ⛔ |  #0a  | `battle.ts:253` writes the field **only when non-zero**, so nothing ever restores it to 0. `encounter.ts:84` stamps `+1` on every random encounter and `game.ts:628-651` persists it to `state.player` — so **every floor boss and the final Hollow is fought at advantage**. In the other direction, a `fracture` (100 turns, "needs a rest" — but `resolveRestDecision` never clears conditions) leaves it stuck at `-1`: verified on seed 1, the first boss opened at **-1** from an unrelated floor-1 Ganger skill. **Boss difficulty swings ±5 to-hit on leftover state.** **Fix:** stop storing it — compute per-round in `resolvePlayerTurn`. Stopgap: write unconditionally + reset to 0 in `createBattle` |
| G13 | **Four of the game's biggest beats render BLANK narration** | `BUG` — **fix specified** | ⛔ |  #0b  | `narrate.ts:23` `describeEvent` ends `default: return ''`, so a missing case is silent instead of a type error. No case exists for `boss-encounter`, `verdict`, `spared`, `draft-picked`, `draft-offer` — so `buildNarrationPrompt` returns `null` and `desktop/game.ts:174` leaves the pane empty. Silent today: **every act's boss reveal**, **the act-4 karma reckoning** (the single payoff of the whole karma system), **the entire mercy/sparing path**, and every level-up pick. **Fix:** add the five cases and replace `default` with an exhaustiveness check (`const _never: never = e`) so the next new event kind fails the build instead of going quiet |
| G14 | **37 of 38 authored relics/uniques/consumables have no acquisition path** | `BUG` — **fix specified** | ⛔ |  #0c #9  | Traced every `ItemInstance` construction site: generated `gen:*` ids, one hard-coded `mirror-shard` in `deals.json`, starting gear, save migration. **Nothing else.** So `consumableOptions` (`view-model.ts:96`) always returns `[]` — the "Use item" picker never renders and `useConsumable`/`consumable.ts` are unreachable in real play. Every relic effect in `relicEffects.ts` is dead (relics only work equipped; no relic ever enters inventory). The two mastery feats that "grant" relics write `UnlockStore.relics`/`.skills`, and **`snapshotUnlocks` reads neither**. **Fix:** add a weighted catalog branch to `rollLootDrop`/`rollChestLoot`, and read `store.relics`/`.skills` in `snapshotUnlocks`. *(Tracked as task #9.)* |
| G15 | **Half the karma model is inert; the heaviest verdict axis can only move one way** | `BUG` — **needs a design call** | ⛔ |  — *(moved to §2c)*  | Of 8 declared karma actions only 4 fire. `leaveOffering`, `honorDead`, `embraceWhisper`, `seeThroughIllusion` appear **nowhere outside `karma.ts`**. Consequences: `reverenceDesecration` is touched only by `desecrateShrine: -2`, so it starts at 0 and can **only ever be ≤ 0** — yet it carries `GATE_WEIGHTS = 3`, the **heaviest** axis in `computeVerdict`, so the axis the reckoning weights most can only push toward CAST-DOWN, never GRACE. `clarityDelusion` is **permanently 0** (a fully dead axis), so "The Delusion" can never be the act-3 boss. `selectPool`'s grace branch needs `reverence >= 3` — **unreachable**, making the entire `grace` deal pool dead content *and* `mirror-shard` unobtainable. The four-axis verdict reduces to `mercyCruelty + restraintGreed >= 1`. **⚠ Fix needs the author** — wire the positive actions to real inputs, or re-weight onto axes that can move and record the deferral |
| G16 | **A third dead stat twist, mislabelled** | `BUG` — **fix specified 2026-08-28** | low |  #0a  | `statEffects.ts:198` `dealQualityTwist` is a no-op still commented *"no-op until M7"* — but **M7 shipped**. Same family as the two already tracked (`initiativeOrderTwist`, `illusionSightTwist`). **Fix:** either implement it (CHA shifting deal quality, per §16) or **delete the function and its call sites** — nothing depends on it, so deletion is the default. What is not acceptable is leaving a no-op behind a comment claiming it is pending a milestone that shipped |

### Found 2026-08-28 by discrepancy pass 7A — all five verified by running the real engine

| # | Item | Status | Severity | Blocks | Notes |
|---|---|---|---|---|---|
| G23 | **Re-applying a damage-over-time condition resets it to ONSET, so it deals ZERO damage forever** | `BUG` — **fix specified** | ⛔⛔ **core combat** | #0a | The onset phase is *inferred* from `remainingTurns === maxTurns` (`condition.ts:304`), but the refresh branches (`:203`, `:206`) write **exactly that value**. So every re-application drops a live condition back into its no-effect onset turn. **Measured: spamming `ember` for 20 rounds deals a total of 0 burn damage**, ending `{burn, rem:2, max:2, intensity:21}` — while casting it **once** deals 1. The dominant player action is strictly worse than acting once. Affects every `bleed`/`burn`/`poison` skill **on both sides**, and means a refreshed `freeze`/`stun` never reaches the active branch so **its saving throw is never rolled**. **Fix:** stop overloading `remainingTurns` as the phase flag — add an explicit `onsetDone` flag, or have refresh write `Math.max(maxTurns - 1, 1)` |
| G24 | **The failed-escape counter-attack bypasses the ENTIRE defensive pipeline** | `BUG` — **fix specified** | ⛔ | #0a | `enemyCounterAttack` (`battle.ts:603`) subtracts HP raw and checks death raw, skipping all five guards `resolvePlayerTurn` applies: shield absorb, `firstHitReduction`, the `onTakeDamage` triggers, the **revive gate**, and the transient-flag threading. `resolveUseConsumable` misses the revive gate too. **All three measured:** Grace-Forged Aegis shield **not consulted** (HP drops, shield untouched); **Halo Fragment does not revive you** — status `player-died` where a normal round revives; Scrap Plating's free hit is consumed *and* still banked. So the once-per-battle revive relic fails at the death players most often walk into. **Fix:** extract the damage-application block into one helper and call it from all three sites — every step is RNG-free, so draw order is unchanged |
| G25 | **`player.shield` is never cleared at battle end — it accumulates without bound** | `BUG` — **fix specified** | ⛔ | #0a | `Player.shield` is documented as *"transient combat shield"*, but the only writes are `+= amt` at battle open and `-= absorbed` on a hit, and `game.ts` writes `battle.player` back to `state.player` on every outcome. `openBattle` re-fires the `startOfBattle` trigger against the carried-forward player. **Measured with Grace-Forged Aegis over five battles: shield at start = 5, 10, 15, 20, 25** — and it keeps climbing all run, and **survives the save file**. By mid-descent the player is effectively immune to chip damage. **Fix:** strip transient fields when writing `battle.player` back, or reset `shield` in `openBattle` before firing the trigger |
| G26 | **When the model fails, the fallback prints the PREVIOUS beats instead of what just happened** | `BUG` — **fix specified** | ⛔ | #0c | `desktop/game.ts:202` takes `prompt.user.split('\n\n')[0]`, assuming the facts block is the first paragraph. It is — **only when memory is empty.** From the second narratable turn of every run onward, the first paragraph is the *continuity recap*. **Measured:** after a crit, the fallback renders "Across this descent you have felled 1 foe / Recent moments…" and **never the words describing the crit**. Since a GPU is the stated min spec and this is the *designed* degraded path, a player on a marginal machine sees a stale recap after every action and is never told what the engine did — the opposite of the comment's claim that it "remains fully playable". **Fix:** return the already-computed `facts` from `buildNarrationPrompt` and render those, instead of re-deriving by string-splitting |
| G27 | **Fracture is effectively PERMANENT — rest does not cure it and the only cure is unobtainable** | `BUG` — **fix specified** | ⛔ | #0a | `condition.ts:95` sets `maxTurns: 100` with the comment *"needs a rest"* — but `resolveRestDecision` only restores HP and decrements `restsLeft`; **it never touches `activeConditions`.** The only cure in the data is `warding-charm`, which is a battle-only action **and** unreachable by any loot path (G14). **Measured:** a floor-1 Ganger's `gangStomp` applies fracture; it is still active after **99 rounds**, setting attack disadvantage every one of them, and rides into every later battle via the write-back. **One first-floor enemy skill puts the player on permanent attack disadvantage for the whole run with no in-game remedy.** **Fix:** clear conditions in `resolveRestDecision` — the behaviour the 100-turn duration was tuned for |
| G28 | **Five smaller verified defects** | `BUG` — **fixes specified** | medium | #0a #0c | (a) **The HUD shows no condition chips at all** — the whole `components.ts`/`component-model.ts` library is unimported by the real UI, so a stunned, poisoned or fractured player has **no on-screen indication**. Same family as G18. (b) `renderSheet` interpolates the **player-entered name into `innerHTML`** (`game.ts:157`) while loot rows correctly set text — a name containing `<` corrupts the sheet markup. (c) `scripts/balance-report.ts:162` mixes live numbers with **hard-coded claims** ("Acts 1–4 each hold ≥10% of deaths", "Scavver is strongest") — after any retune the report asserts falsehoods with authority; `actsWithShare()` already exists and is used correctly 44 lines above. (d) `items.json` `clarity-draught` is `kind: "usable"` with **no `use` array**, so it can never be used while still advertising "Heal 8 HP". (e) `view-model.ts:331` calls `resolveSkill` with **no null guard** where its sibling at `:68` does — an unknown skill id from a hand-edited save crashes the character sheet instead of skipping the row |

### Found 2026-08-28 by discrepancy pass 6A — all six verified by running the real engine

| # | Item | Status | Severity | Blocks | Notes |
|---|---|---|---|---|---|
| G17 | **The ENTIRE resistance subsystem is inert** | `BUG` — **fix specified** | ⛔ |  #0a  | Two compounding breaks. (a) `skill.ts:307` computes `Math.floor(res / 100) * baseDamage` — **zero for every value below 100**, and nothing in the game produces ≥100 (`blessed.resistBonus = 2`, family `resistAmount: 2`, `RESIST_PER_WIS_MOD = 10`). Verified: damage is **3 for res ∈ {0, 2, 10, 20, 50, 99}**. (b) `effectiveResistances` — which layers the Lucid/Clouded WIS shift and equipped-gear `bonusResist` — **has zero production callers**; both damage paths read the raw stored array. Dead as a result: 7 elements, 5 family themes, the `blessed` affix (a "Blessed Ganger" is mechanically an ordinary Ganger), the `bonusResist` item-effect, and 2 conditions. **Fix:** real percentage formula + call `effectiveResistances` at both sites; then rebalance the data values, which only become meaningful once the formula works |
| G18 | **The player never sees a single damage number, die, hit, miss or crit** | `BUG` — **fix specified** | ⛔ |  #0c  | `src/render/format.ts` (205 lines of `formatEvent`, plus `formatRollDetail` built for `UI-DESIGN.md` §3) **is imported by nothing but its own test.** `desktop/game.ts` imports only `theme`, `component-model` and `components` from `render/`. So the entire M-UI2 roll-detail pipeline — `AttackRollDetail`, `faces`, `damageSources`, `foldDamageSource`, the `crit-dice`/`clamp`/`damage-mult` terms — is **computed on every attack and consumed by nobody**. The one channel that does render is the narration, and `VOID_PERSONA` explicitly forbids it from mentioning *"game mechanics, dice, or numbers"*. **Also unused:** `panel`, `bar`, `conditionChip`. **Fix:** add a log element to `desktop.html` and append `formatEvent(e)` in `dispatch()` |
| G19 | **Resuming a save silently forfeits meta-progression** — ⭐ **this is the root cause of G1** | `BUG` — **fix specified** | ⛔ |  #0c  | `runSummary` is a derived accumulator and the sole input to `applyRunSummary` (which grants every feat and unlock). `persist.ts` stores only `{state, memory}`, and the resume branch never rebuilds it — so a resumed run starts with `bossKills: []`, `spareCount: 0`, `maxAct: 0`. **Verified on seed 4242:** uninterrupted run unlocks Neuromancer; the *identical* run resumed from its own Act-2 state loses the `kingpin` boss kill and **unlocks nothing**. Resume late enough and every `reach-act-N` feat is forfeited too. `runSeed` is also re-stamped from `Date.now()`, so the recorded `runId` no longer identifies the run. **Fix:** persist `runSummary` + `runSeed` in the envelope and restore them; both are already plain data, so it is a field addition plus a version bump |
| G20 | **A sacrifice-deal can drive `maxHp` and `hp` NEGATIVE** | `BUG` — **fix specified** | ⛔ |  #0a  | `deal.ts:151` `canAfford` guards the `hp` cost (`cost.amount < player.hp`) but lets `maxHp` fall through to `return true`, and `applyDeal` subtracts with **no floor** — unlike every other max-HP sink (`classKit.ts:278` uses `Math.max(..., 1)`). **Verified:** `deals.json` `tempting` has a `maxHp: 6` cost; with `maxHp: 5, hp: 5` the deal is affordable and yields **`maxHp: -1`, `hp: -1`**. The player walks to the hub at −1 HP and dies on round 1 without acting; potions are refused and revive heals to 1. **Fix:** add the `maxHp` guard and floor at 1. The `statPoint` cost is unbounded the same way — clamp in the same edit |
| G21 | **Every Act transition renders a completely blank screen** | `BUG` — **fix specified** | ⛔ |  #0b  | Distinct root cause from G13: here the `describeEvent` cases *exist* but return `e.body`, discarding `e.header` — and **all ten** `actIntros`/`actOutros` bodies in `story.json` are `""`. So the prompt is `null` and the pane is cleared. **Measured over 20 full runs (8,654 steps): 47 `act-intro` + 47 `act-outro` blank screens**, one on every floor change — the five-Act descent is never announced anywhere in the UI. **Fix:** return `[e.header, e.body].filter(Boolean).join(' — ')` for `act-intro`/`act-outro`/`ending`, and author the ten bodies |
| G22 | **Three smaller verified defects** | `BUG` — **fixes specified** | medium |  #0a  | (a) `battle.ts:252` adds `ptc.hpDelta` with **no `maxHp` clamp**, so a `regeneration` tick or Penitent `consecrate` leaves `hp > maxHp` (reproduced). (b) `combat.ts:315` gates enemy skills on `skillCharges > 0` while `useSkill` subtracts the full `chargeCost` — an enemy with 1 charge casts a cost-2 skill and ends at **−1** (reproduced; affects `wrathSmash`, `riotSlam`, `overload`, `immovableSlam`, `smiteWicked`). (c) Enemies start at `skillCharges: 2` with **no restore path**, so a family's themed skill pool only matters for the first two landed hits and every later enemy hit is the flat `{kind:'base', amount:1}` |

## 5. Document hygiene

| # | Item | Status |
|---|---|---|
| D1 | ~~Asset totals in circulation~~ | `FIXED` 2026-08-27 — reconciled to **50 buildable / 52 eventual** (§4b); the double-counted Sins were the cause |
| D2 | ~~two §14s~~ — it was **two `## 16`s** (fixed 2026-08-27: the second is now `## 16b`, with numbering notes at §14 and §16b). §15 still says "the brainstorm is essentially complete" | `PARTLY FIXED` |
| D3 | Three dead `[PROPOSAL]` tags to retag or delete (P2, P3, P5) | `OPEN` |
| D4 | ~~`.env.example` says "bundled"~~ | `FIXED` 2026-08-26 |
| D5 | `PROGRESS.md` still describes the shell as "mobile-first, portrait 540×1080" | `OPEN` |
| D6 | `HUMAN-CHECKS.md` — run instructions **FIXED 2026-08-27**; carries **10** un-ticked author rulings (not 5 — that figure was copied from the frozen `SCOPE-AUDIT-2.md` snapshot), of which **3 were already answered by merged milestones** (enemies-always-hit → M4; Beast-only → M8; shop-under-Character-Info → M7 deleted the shop). **Those 3 struck 2026-08-28; 7 genuinely remain**, incl. flee 25% vs 35% | `PARTLY FIXED` |
| D7 | **20** stale worktrees on disk (`PROGRESS.md` says 16; both were wrong) | `OPEN` |
| D8 | `WHAT-WE-BUILT.md` + `itch-description.html` describe a game with gold and a shop. **`HUMAN-CHECKS.md` did too** — its play-check scripted "rest → shop → level-up" (**fixed 2026-08-28**); it is the one a human actually follows, so it mattered most | `PARTLY FIXED` |

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
