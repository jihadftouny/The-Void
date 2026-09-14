# The Void — Build Progress

_Live tracker. Driven by `docs/ROADMAP.md` (v3 — the mechanics-first roguelike). Design record:
`docs/GAME-DESIGN.md`. Updated as the final step of any session that changes build state._

> **Direction (scope locked 2026-08-05):** The Void is a **mechanics-first roguelike RPG** — a deep
> D&D-style game with a **local-LLM narrator** over the top (engine owns all rules/numbers). Five-floor
> psyche-descent, die-and-restart with **unlocks-only** meta-progression, a **hidden multi-axis karma
> ("Nature")** that bends world + mechanics and resolves into a **blended ending** (floor 4 is the
> karma reckoning). Full-depth systems: classes + signature skills, **25** conditions, 24 enemy families +
> affixes, 5 boss agents, multi-slot inventory (~~Tibia-style~~ **text lists** since 2026-08-31, §22.9),
> relics + uniques + rich consumables, thematic economy.
> Design in `docs/GAME-DESIGN.md`; milestone plan in `docs/ROADMAP.md`.

**v3 overall: 4 of 18 complete · 9 partial · 5 not started · 2796 tests** `[####----------------]`

*Counted from the table below: ✅ M0 M1 M3 M4 (4) · 🔶 M2 M5 M6 M7 M8 M9 M12 M13 M15 (9) ·
⬜ M10 M11 M14 M16 M17 (5). Plus **M-UI** and **M-UI2**, which are merged/part-merged but sit outside
the M0–M17 numbering.*

> **⚠ Recounted 2026-08-28 — SIX milestones demoted from ✅ to 🔶.** Each was marked complete
> against a claim that does not hold, checked against its own `ROADMAP.md` "done when":
>
> | | Why it is not complete |
> |---|---|
> | **M2** | *"elements/resistances affect skill damage"* — **they do not affect it at all** (G17). And the condition layer is worse than unfinished: **re-applying a damage-over-time deals zero damage forever** (G23) |
> | **M6** | build-defining relics and usable consumables — **none can ever enter a backpack** (G14) |
> | **M7** | *"real sinks (gear/consumables/rerolls/services)"* — **three of the four do not exist**: consumables cannot be generated, the reroll flag is discarded, services have no representation (G14) |
> | **M8** | *"karma-weighted families shift Nature **axes**"* — **all nine share one pair; only `mercyCruelty` moves.** The code says so itself (G15) |
> | **M13** | must grant classes/skills/items/relics/enemies — **3 of 5 are written to disk and never read into a run** (G14) |
> | **M15** | balance report **invalidated** by G11, and separately **tuned against the wrong to-hit baseline** — `proficiency` is dead state, so the player has been rolling ~10 percentage points below the intended model all along (G32) |
>
> **None of these is a regression.** Nothing broke; the tests were always green. Each shipped
> alongside a subsystem that turned out to do nothing, and the milestone was ticked on **the code
> existing rather than the behaviour being reachable.** *(This recount has now run three times today
> — 10 complete, then 8, then 6. Each pass applied the same standard to milestones the previous pass
> had not checked. **Do not assume the remaining four are safe** until each is checked against its own
> "done when" clause the same way.)*
*(An earlier headline said "12/18" — it counted partials as complete.)*

**2026-08-24 — THE BIG MERGE IS DONE.** The entire stacked chain from the autonomous run
(2026-08-10→11) is now merged into **`main`** in one gated merge, zero conflicts. Post-merge
verification on the trunk: `npm run typecheck` clean, **960/960 tests pass**, `npm run build` OK.
Chain merged (in order): M1 `state-foundations` → M2 `skills-conditions` → M3 `class-kits` →
M4 `combat-defense` → M5 `equip-engine` → M6 `items-content` → M7 `sacrifice-economy` →
M8 `enemy-roster` → M9 `levelup-loop` → `functional-ui` → `enemy-kits` → M12 `boss-mechanics` →
M13 `unlock-store` → `balance-sim` → M15 `balance-tune`. Safety tag on the pre-merge trunk:
`pre-merge-backup-m15`.

**✅ THE GAME IS WINNABLE — proven by simulation:** baseline win **32.9%** / merciful **40.0%**,
Act-1 deaths **98%→19%**, deaths spread across all acts (modal = Act 3). The long-standing
"unwinnable" blocker is RESOLVED. ~~The sim is a no-equipment LOWER bound, so real play is easier~~ —
**⚠ THIS FRAMING IS WRONG, found 2026-08-28 (`FINDINGS.md` G11).** The sim was a no-equipment run
because loot is **un-equippable in principle**, not because the sim policy declined to equip it:
`equipment.ts` resolves by `defId` only and every generated drop fails to resolve (**>100 drops
across 300 seeds, zero equippable**). So the sim is not a lower bound — **it is exactly what real
play does today**, and these numbers describe a game where found gear contributes nothing.
**The balance re-run in `PLAN.md` #2 is now mandatory**, after `#0 critical-engine-bugs` lands. A
per-class refinement also remains (Scavver strong / ranged classes weak — play-test + weapons).
**The karma pillar has its first real EFFECT** — the floor-4 gate routes grace (ascension, ends at
act 4) vs cast-down (→ Hollow-Self → damnation) by your hidden Nature.

**Next up: `#0 critical-engine-bugs`** (`PLAN.md` #0) — **not** the engine foundations. #0 now
precedes #1, because #1's equip-as-input and slot-migration changes both build on the equip
resolution path that G11 shows is broken. Then everything else. Two full project audits
(`docs/SCOPE-AUDIT.md`, `docs/SCOPE-AUDIT-2.md`) and **22** scope-interview rounds have since
reshaped the plan. **The live list of what is open is `docs/FINDINGS.md`; the live work plan is
`docs/PLAN.md`.**

**Now decided and written down** (31 items + the **twelve 2026-08-31 validation decisions**,
`GAME-DESIGN.md` §22 — endings second-person, `insanity` renamed, no cross-run narration, karma
actions wired, potions folded, one boss concession, **icons cancelled**, **inventory text-based**,
codex cut, G44 fixed): the whole world (`docs/WORLD.md` — the Void is a
*condition*, the condition is the Hollow, and the descent happens *during* an extraction); all five
floor mechanics; the art direction (32-bit-era 2D pixel, `docs/ART-BIBLE.md`); audio at full
ambition; the equipment slot set; a content warning on every fresh run (`docs/CONTENT-WARNING.md`);
full accessibility including a screen-reader pass; licence, free itch release and no telemetry
(`docs/SHIPPING.md`). **The engine writes the choices — the LLM-authored-choices plan is dropped**,
which shrinks M11 substantially. **Min spec now requires a GPU.**

**#0 `critical-engine-bugs` — ✅ COMPLETE. ALL THREE UNITS MERGED (2026-09-02).**  ~~Next up (NOT started — no branch exists yet)~~ — **`#0a combat-core` ✅ merged** (23 defects, 12 commits), **`#0b narration-coverage` ✅ merged** (4 defects, 8 commits), and **`#0c persistence-and-reach` ✅ merged** (13 register rows, 9 commits). Originally **THREE units** —
**thirty-three** defects (G11–G47; there is no G38), far too many for one. **This blocks #1.** Full detail in `PLAN.md` #0:

| Unit | Covers |
|---|---|
| **#0a `combat-core-fixes`** | **G23 re-applied damage-over-time deals ZERO forever** · **G29 Kingpin minion damage bypasses shield + revive (the death that happens most)** · **G24 failed escape does the same** · **G25 shield accumulates 5→10→15→20→25 all run** · **G34 momentum leaks the same way** · **G27 fracture is permanent** · **G30 fracture on the ENEMY is inert** · **G31 rest never restores skill charges** · **G32 wire `proficiency`** (author-ruled) · G11 equip resolution · G11b its non-circular test · G12 advantage latch · **G17 the whole resistance subsystem is inert** · G20 deals can drive HP negative · **G35 the "cheaper" upgrade reaches ZERO cost — free casts forever (274/300 seeds)** · **G36 rejected button presses still advance the boss** · **G39 a flee item escapes any boss and soft-locks Act 5** · **G43 floor 5 has NO encounter layer — 21% of the roster is unreachable** · G4, G16, G22, G28(d), G45 |
| **#0b `narration-coverage`** | **G13 ELEVEN uncased event kinds — incl. the player's own skill casts** (5,727 steps, 100% misattributed or blank; ~~was "five missing cases"~~) · **G47 the narrator speaks the player's NAME** (engine-side §22.1 break) · G21 blank act transitions (47 + 47 measured) · **G42 the ENDING is erased by the click after it — a finished run's last screen is blank** |
| **#0c `persistence-and-reach`** | G1/G19 resume forfeits all unlocks · **G18 the player never sees a damage number** · **G26 the model-failure fallback prints the wrong beats** · **G33 charge-discount relics do nothing through the UI** · G14 catalog items reachable · **G40 the debug overlay eats keys typed into your name** · **G46 the enemy's bleed reads "Your skin is ruptured!"** · G3, G28, C7 |

**`#0a` runs independently; `#0b` and `#0c` are the barred pairing** (G26's fix spans their two
files). See `PLAN.md` #0 — that is the single source for this rule. *(This block previously said all
three must serialise, repeating a reason `PLAN.md` has since retracted as false; leaving it would
have needlessly blocked `#0a`, the largest unit, behind `#0b`.)*

**Then, and only then** (both branches exist but are **empty** — only plans): `engine-foundations`
(equip as a `step` input · description/flavour fields · the floor-mechanic hook · floor-4 verdict
weighting · condition rename · Quick/Slow redefined · the level-up rework · enemy XP · the **9→7 slot
migration**) and `art-pipeline` (batch mode · corner-pixel gate · reference conditioning · alpha
keying), planning in parallel on disjoint territory.

**⚠️ Known and unfixed:** three bugs silently destroy player data — quitting mid-run voids all
unlock progress, winning leaves a resumable save, and a corrupt unlock store wipes everything with
no warning. **G1's fix landed with G19 and G3's is decided — only G2 still needs one designed** (`docs/FINDINGS.md` §4); no code has changed.

**Play-test checklist + balance: `HUMAN-CHECKS.md` / `docs/BALANCE-REPORT.md`.**

| Milestone (v3) | Status |
|---|---|
| M0 — Consolidate base & reconcile to mechanics-first | ✅ merged to `main` (378 tests) |
| M1 — Foundational state models (karma + item schema + inventory) | ✅ **merged to `main`** (411 tests) |
| M2 — Player skills + full 25-condition system | 🔶 **still short of its "done when", but for a much smaller reason since 2026-09-01.** ~~*"elements/resistances affect skill damage"* — **they do not affect it at all**~~ **✅ FIXED and independently verified by #0a** (G17 + G23 + G27 all closed; `computeSkillDamage(base 2, res 50)` now = 1, and 20 re-applied `bleed` ticks total exactly 189 where they totalled 0). **What still blocks ✅:** the "done when" also requires *"**all 25** conditions tick correctly with hand-derived tests"*, and no such test exists — `condition.test.ts` spot-checks four durations. **That audit is the only remaining gap.** Original reason kept below for traceability: the formula was zero below 100 resistance (`FINDINGS.md` G17: the formula is zero below 100 resistance and nothing produces more than 10, and the function layering gear/WIS has no callers). Skills and conditions themselves are fine |
| M3 — Classes & signature kits | ✅ **merged to `main`** (494 tests) |
| M4 — Combat overhaul: defense matters (enemies roll to-hit) | ✅ **merged to `main`** (526 tests) |
| M5 — Inventory & equipment (Tibia-style) ★ | 🔶 ENGINE **merged to `main`** (561 tests); **Tibia visual UI deferred to a collab pass w/ you** |
| M6 — Items content: relics, uniques, consumables | 🔶 **merged, but fails its own "done when"** (625 tests). Shipped: 15 relics + 4 uniques + 19 consumables + effect/trigger system + rarity gen. **But `ROADMAP.md` requires build-defining relics that "change how a build plays" and consumables "usable in and out of combat" — and no relic or consumable can ever enter a backpack** (`FINDINGS.md` G14: `loot.ts` only ever calls `generateItem`). 2 of 4 clauses unmet; flavor co-write & in-UI display also pending |
| M7 — Loot sourcing & thematic economy | 🔶 **merged, but fails its own "done when"** (649 tests). Shipped: **gold removed**, pure sacrifice-deals + loot drops + chests. **But `ROADMAP.md` requires "real sinks (gear/consumables/rerolls/services)" and three of the four do not exist in a real run** — `kindForSlot` can never return `usable` so no consumable can be generated; the `reroll` flag is returned and never read by its only caller; and no service exists in `DealReward`. Same root cause as M6/M13 (`FINDINGS.md` G14) |
| M8 — Enemies: families, affixes, karma-weighting | 🔶 **merged, but fails its own "done when"** (691 tests). Shipped: 24 families + 5 affixes + spare action + family-themed kits. **But `ROADMAP.md` requires karma-weighted families to "shift Nature *axes*" — all nine ⚖ families declare the same pair and only `mercyCruelty` ever moves.** `enemyFamily.ts:17` says so itself: *"uniformly set to the mercy↔cruelty pair now. M10 differentiates the axes."* One axis, not axes (`FINDINGS.md` G15) |
| M9 — In-run progression (frequent level-up picks) | 🔶 **merged, then partly reversed by design** (726 tests). Shipped: XP-frequent leveling + draft-1-of-3 + lean start + auto-HP. **But §19.5 removed `stat` from the draft** (per-level allowance instead) **and set a level cap of 20** — neither is in `src/` yet |
| M-UI — Functional UI (surfaces the whole engine, hand-testable) | ✅ **merged to `main`** (753 tests); plain/utilitarian — the turn-based battle screen is the NEXT unit |
| M-UI2 — Visual restyle (5 units) | 🔶 **units 1 and 2 of 5 merged to `main`; #6 BUILT 2026-09-12 on `agentic/battle-screen`, awaiting verification and merge** (2688 tests, after fix round 1): the fight as a framed stage, the round replayed beat by beat, a sound hook per beat, `game.ts` behind `boot()` (G51), the Cast list fitting the minimum window. **Unit 2 = `visual-identity` (#8 + #16), merged 2026-09-08** (2149 tests): JetBrains Mono bundled with its OFL text, five per-floor palettes with textures and machine-gated contrast, settings screen, content warning, always-on floor tag, and three reserved-but-empty art regions. **Remaining: #6 battle screen (built, unmerged) and #7 canvas (out of v1).** Unit 1 (`ui-foundation`) merged earlier (1026 tests): design tokens, shared components, second front-end retired, combat events widened. **Units 2–5 are `PLAN.md` #6–#8.** *(Added 2026-08-28 — this had no tracker row at all despite being merged, so a five-unit restyle with 273 tests behind it was invisible to the milestone table.)* |
| M10 — The five floors: content, mechanics, karma effects ★★ | ⬜ needs your PROSE |
| M11 — LLM layer to spec (**narrate ONLY** — floor voices, beat significance, karma-in-prompt, boss agents, boss talk) | ⬜ **shrank 2026-08-25** — grammar-constrained choices + the tool registry are DROPPED; the engine writes the choices |
| M12 — Bosses: five unique encounters as agents | 🔶 **4 of 5** merged (894 tests) — `boss.ts` has **four** combat bosses; the **floor-4 executioner fight does not exist** (`PLAN.md` #11). Karma verdict gate + two endings done. **No boss is an agent yet.** Boss prose still yours |
| M13 — Meta-progression: unlocks & mastery feats | 🔶 **merged, but does NOT meet its own "done when"** (943 tests). Shipped: persistent unlock store, feats wired to bosses/endings/spare, gradual bestiary reveal. **But `ROADMAP.md` requires it to grant classes/skills/items/relics/enemies, and `snapshotUnlocks` returns only `{families, affixes}`** — skills and relics are written to disk and **never read into a run**. 3 of 5 unmet (`FINDINGS.md` G14) |
| M14 — Karma payoff: blended-spectrum endings | ⬜ (two endings exist via M12's gate; the blended spectrum + prose remain) |
| M15 — Balance pass (tough but fair), sim-verified | 🔶 **merged, but the report is INVALIDATED** (960 tests). Shipped: sim harness + report + tuned constants; **32.9% baseline win**. **But G11 voids the "no-equipment lower bound" framing** — loot is un-equippable in principle, so those figures are what real play *does*, not a floor beneath it. **Re-run mandatory after `PLAN.md` #0** |
| M16 — Polish & game-feel | ⬜ |
| M17 — Package & ship (itch) | ⬜ |

**Pre-M0 base (built, verified, on a stacked review branch awaiting merge):** deterministic engine
(combat/stats/2 stub classes/act-gated leveling/enemies/11-of-25 conditions/shop/rest/gold/5-act/final
boss/`step` controller), save/load, Kaplay UI shell, desktop Electron app w/ local LLM narrator
(full run narrated), device-agnostic GPU selection, shared model-cache. ~378 tests green. The v1 Java
port (M1–M10) and v2 LLM work (N1–N3) are subsumed here as the base and as M11–M12.

Legend: ⬜ not started · 🔄 in progress · ✅ done · ★ first big new system · ★★ mechanics-first game realized

## Session log

### 2026-09-14 — the specks no longer sit on a grid ✅

**`speck-scatter` merged. 2767 → 2796 tests.** You played floors 2 and 3 and said the design was right but *"too grid like — every speckle is on the same x and y axis level."* Each speck layer had one dot dead centre per tile, so every layer was a perfect grid. **Each tile now holds several specks at measured, uneven positions**, and floor 2's three layers drift three different ways. **A first attempt formed diagonal lines across tile edges**, placed by eye — verification caught it before you saw it, and the specks are now placed by measurement, with checks for lines, clumps, specks in a row and bands at rest. **It took ~1 h of build and ~45 min of verification** — far faster than recent units, because each deliberate breakage was tested against the one small file meant to catch it rather than the whole suite.

**Next:** one check at the top of `HUMAN-CHECKS.md` — whether the specks now read as scattered.

### 2026-09-13 — floor 2 is a white-out, floor 3 is ash, and floors fade into each other ✅

**`floor-looks` merged. 2688 → 2767 tests.** You played the game and said floors 2 and 3 were *"only lines in the background, no gradient colors or anything."* They were: thin 1 px repeating lines at 7% on near-black, while floors 1 and 4 had soft gradients. **Floor 2 is now the only light floor** — white, dark ink, a deep blood-red, red flecks — so entering the Void is a white-out. **Floor 3 is a grey haze with ash falling through it.** **Moving between floors now dissolves over 1.2 s instead of snapping**, proven in a real browser. It fades under reduced motion too, because a fade moves nothing and is what prevents the flash.

**A new in-browser check reads the colour of every word on every screen, on every floor.** On its first run it found a live bug: floor 3's Abandon row was 4.39:1, under the 4.5 minimum. Fixed. **Floors 1, 4 and 5 are byte-for-byte unchanged.**

**Next:** your six checks at the top of `HUMAN-CHECKS.md` — above all, whether the white-out feels like light or a glitch, and whether the flecks read as red or as pale rose (a darker fleck colour is ready if so). Then **the round-order and tempo-gauge unit**.

### 2026-09-12 — #6 merged: the fight is a framed stage, and a round plays out beat by beat ✅

**`battle-screen` merged to `main` on 2026-09-12 after one fix round. 2536 → 2688 tests (2678 at the build, +10 in fix round 1).** A fight now has its own screen, the one `UI-DESIGN.md` §1 drew: the enemy's frame in the centre (empty until the art exists, deliberately), your stat box bottom-left, the commands bottom-right, a one-line ticker under the enemy with the full log behind a **Record** toggle, and the Void still speaking beneath. Pressing **Fight** replays the round **beat by beat** — each blow's line, the number floating off the side it hit, the bar moving at the moment it changed — instead of two numbers changing in a corner. Every beat also names a sound (logged for now; #15 plugs in real audio).

**The Cast list no longer falls off the screen.** Before, opening it at the smallest window put 625 px of buttons in a 558 px column (726 px in 555 at large text), with its last control at y 683–787 — *(corrected at merge: an earlier wording quoted the y positions as if they were the content height)*; now its seven rows fit outright at both text sizes, measured in the real game window.

**The renderer can finally be tested as a program, not as text** (`FINDINGS.md` G51). Everything `game.ts` did the moment it was loaded now happens in one `boot()` call, so tests load it and click through it — the content warning to the hub, a real fight, a resumed boss fight, the floor presets. No existing guard was deleted; each was moved and proven to still catch its bug.

**Decided while building, for you to know:** the round plays in whatever order the engine emits it — today the enemy's blow first, though the design says you strike first (`FINDINGS.md` G62, an engine job); the screen will follow with no change, including rounds where one side acts twice or not at all. A typical round takes **about half a second**, where §6 said "roughly a second" — HUMAN-CHECKS item 1 is yours. The talk-to-bosses input is **reserved, not built**: the room for it is measured, and it moves to #11. Machine checks, walked in the real renderer from the F3 presets, now cover the illusion (nothing on the stage gives it away), the warped kit's costs, bosses (Run greyed with its reason), floor 3's drain and hidden karma.

**Fix round 1 (same day):** the test-agent found two checks that could never fail, and one small display bug. The check that the floating damage number really rises was satisfied by the reduced-motion rule that STOPS it; the reduced-motion strike mark had no check at all, so deleting it left everything green while a struck side showed nothing. Both are now real checks, and a broader one makes every class the battle screen writes answer to a stylesheet rule, and every battle rule to something the screen really shows. The bug: a blow that connected for 0 damage floated "−0" in the damage colour; now no zero is ever floated, while the strike itself still shows (the blow did connect, and the ticker says "hit for 0 damage").

**Verified and merged.** The test-agent's final pass found every fix genuine and nothing traded away; what remains are minor notes on unusual future edits, routed to the tempo unit (`FINDINGS.md` G63). **Next:** your checks at the top of `HUMAN-CHECKS.md` — the first is booting through the new entry point — then **the round-order and tempo-gauge unit**, which is not yet planned.

### 2026-09-11 — #2 merged: every floor plays differently, and the Void comes to you ✅

**`floor-mechanics` merged. 2278 → 2536 tests.** Each floor now has its mechanic: illusions on floor 2, halved healing and a charge drain on floor 3, doubled karma on floor 4, a warped kit on floor 5. **Bargains and rests are no longer menu buttons** — they arrive on the descent, several bargains per floor, none of which can heal. **A found rest is the one truly calm moment in the game.** A full pack lets you mark what to leave behind. Saves from before still load.

**The balance re-run answered the author's deferred question, and pointed elsewhere.** Overall 30.6% — inside the one-in-three target. **The Wisdom gap the author feared is small.** The real spread is by class — **Scavver 57%, Neuromancer and Penitent ~18%** — and it is **decided on floor 1**, not floor 2. Floor 4 is a separate cliff for everyone. No class was tuned, as ruled; the two levers are the author's (`FINDINGS.md` G59).

**One author-accepted number reversed:** `HOLLOW_GATE_XP` 500 → 600, which §22.21 had flagged for this re-run. The reason on record is now true — an earlier wording claimed floor 5 was the softest floor, and it was not.

**It took the full two fix rounds.** Round 1 caught two save bugs that would have reached the player — an old save could charge 8 HP for nothing and print *“take undefined”* — and a real karma-word leak through a stale duplicate vocabulary list (**catalogue entry 11**). Round 2 was mechanical. **The test suite fell from ~3 minutes to ~14 seconds** once the balance check ran in parallel.

**Next:** the author's eight play-checks, then **#6, the battle screen**, which can now start. ⚠ **The schedule decision `SHIP-SCOPE.md` §12 deferred to this moment — whether #11 ships as full boss agents or its cheaper fallback — is now due.**

### 2026-09-09 — the narration was gone, and now the pipeline can see a screen ✅

**`layout-breathing-room` merged. 2149 → 2278 tests.** The author ran yesterday's build and **the
prose had vanished** — clipped to one half-visible line mid-battle while an empty placeholder frame
held a third of the screen.

**Cause:** the reading column gave the narration the only flexible row, and the scenery frame was
attached to the choices row, which takes what it wants first. Once the combat log filled, the
leftover space was nothing and the *text* — not the empty box — was what disappeared. Measured in
real Chromium: **0 px of prose at the minimum window, 4.5 px at the default**, and the *Abandon*
button below the bottom edge. Broken at every size, not only small ones.

**The author's fix, chosen over three placements offered — _"make the options on the right"_** — is
better than any of them: the choice buttons leave the reading column for their own 260 px column, so
~400 px of controls stop competing with the text rather than being rationed against it. The prose now
has an eight-line floor nothing can take, and the scenery frame is capped in both directions instead
of by width alone. **The three art aspect ratios are unchanged and explicitly not available as a fix
for a layout problem** — they are what future backdrops get drawn to.

**A second promise turned out to be false.** The 960×640 minimum window, recorded as settled two days
earlier, was applied to the *outer* window — so the page had only ever received **947×577**. Proven
with a real second window built without the flag, in the same process. Now corrected, and the test
measures the page area rather than the window frame.

**⭐ The lasting part is not the layout fix.** `#8` escaped a green suite and a PASS verdict because
**every guard in that area was a source scan or a jsdom assertion, and jsdom computes no layout.**
There is now a **layout probe**: it builds the real production page, renders it in real Chromium at
six window sizes and two text sizes, then boots the real renderer and clicks through hub, settings
and inventory — 56 assertions in 8.7 s. **It was written first and run against the broken layout**,
where it failed with the numbers above, reproduced independently three times.

**Hardening then found a third defect inside the probe itself:** a button collapsed to `height: 0`
still measures **1.6 px of border** and read as visible. *"Not zero" is not "visible."* A control must
now be at least one line of its own type tall. Recorded as **catalogue entry 10**.

**Next: the author's eyes on the command list they asked for.** Six checks in `HUMAN-CHECKS.md`; two
checks from yesterday's list are now machine-verified and struck out.

### 2026-09-08 — the game has a face, and each floor has its own ✅

**`visual-identity` (#8 screens-restyle + #16 typeface) merged. 1913 → 2149 tests.** This is the
first build meant to *look* like something. The author bought look-and-feel into v1 (`SHIP-SCOPE.md`
§11) and then defined it in two directives (§11.1): every floor gets its own text colour, background
and texture; and three regions are reserved where scenery, enemy and character art will eventually
go. **No art was generated, bought or downloaded** — the $0 rule is untouched and the slots ship
empty.

**What landed:** JetBrains Mono vendored (4 woff2, ~87 KB) with its OFL text actually in the tree,
so a licence claim that had been circular since August is now backed by a file. Five floor palettes
applied as root variables — descending re-tints the whole interface with no reload. A settings
screen (text size, reduced motion, high contrast — the reduced subset, on the rule that *a control
must control something*), the content-warning screen with marked placeholder prose, an always-on
floor tag, a confirmation on "Abandon the descent", the run seed shown on the summary, and a
960×640 minimum window — a number `UI-DESIGN.md` §14 had required since August without ever naming.

**Legibility was gated rather than hoped for.** Every floor's body text clears 7:1 and its accent
4.5:1 measured against the ground *with the texture composited on top*, using a ratio function that
is itself proven against hand-derived values first. **Floor 2 was the one palette that had to move**
— "blinding white with red flecks" pushed its accent to 4.32:1, under the gate, with the focus ring
riding on it — so the white went into the ink and the texture instead of the ground. The palette
moved; the gate did not.

**⚠ Verification caught two guards that proved nothing, and one of them was hiding the whole
feature.** Renaming the three outputs of `theme.ts` left 2126 tests, typecheck and build **all
green** — with no floor painting, high contrast no longer removing texture, and reduced motion
inert. The floor-texture coupling had been guarded on the CSS side only. Both fixed and proven red;
recorded as **catalogue entry 9** in `.claude/pipeline-log.md`: *a guard that checks only one end of
a two-ended coupling*. Notably, 83 build-agent mutations had all come back red without finding
either — a mutation campaign aimed at the watched side never reveals the unwatched one.

**Also found:** a developer-only caption was deleted rather than shipped, because `sourcemap: true`
means a hidden branch inside a shipping module stays readable in the released `.map` (G55, measured:
0 hits in `.js`, 1 in `.js.map`); and an assertion that could never have been satisfied by any
correct build (`distFont.test.ts` swept for a string its own error messages always emit).

**Next: the author's eyes.** Ten manual checks are queued in `HUMAN-CHECKS.md`, ordered
most-likely-wrong-first — nothing machine-checkable remains, and whether it actually *looks* good is
not something any test in this repo can answer.

### 2026-09-07 — the F3 state panel: the long-run checklist becomes a few clicks ✅

**`debug-state` merged.** 1700 → **1913 tests**, and **nothing under `src/game`/`src/llm` was touched** —
the panel builds a complete valid state and adopts it through `adoptRun(saved)`, the same seam the
resume path uses. Ten presets cover every deferred check: act 4 with **The Judged** forced, act 5
below the Hollow gate, all three endings, karma set directly, items granted, HP/momentum/charges
edited. **Built because the author asked for it** — *"to avoid wasting time testing multiple times in
long runs."*

- **It cannot reach the packaged build**, and I verified that myself on the trunk build after
  merging: the marker is absent from `dist/`. Six smuggling routes were attacked; two re-export
  shapes are **tree-shaken away and caught only by the direction scan**, and a re-homed panel id is
  caught **only by the sourcemap sweep**. **G54** records the contract limit honestly.
- **The plan's own proof was found broken before any code was written:** building in "development
  mode" alone produces a **byte-identical** bundle to production, so the control would never have
  been true and the assertion resting on it would have proved nothing.
- ⭐ **The backspace-byte trap fired LIVE** — a script turned `\b` into a literal control byte while
  writing a guard, which would have made that guard **inert from birth**. The byte scan added three
  units ago caught it. *The trap is neither hypothetical nor historical.*
- **A new failure shape for the catalogue:** seven decisions were extracted so they could be tested,
  and all seven were — but **nothing tested that the panel calls them.** Five of seven bypasses
  survived `tsc` and all 1888 tests. Fixed as **invariants**, so a jump button added years from now
  cannot silently skip validation.
- **The build agent refused an instruction and was right:** asserting three stacked damage-over-time
  entries would have pinned behaviour the engine has never had.
- **Three checks moved from manual to machine-proved** (momentum 5→2→1, DoT intensity, Blessed
  mitigation), so the author now judges only how they look, not whether they work.

### 2026-09-06 — #10a merged: both endings are now EARNED, and the exploit died first ✅

**Suite 1646 → 1700.** Merciful play finally moves the verdict: three karma actions wired
(`leaveOffering`, `embraceWhisper`, `honorDead`; the fourth waits for floor 2). Proven over 120 real
runs — every net-positive run reaching the reckoning is granted grace; the ordinary policy never is.
Sparing The Judged records **mercy AND reverence** (§22.22, the author's call). **G53 fixed** (the
deal screen printed karma axis-pole names). **The fix round killed a live exploit:** two deal costs
were silently free at their floors, and wiring items→reverence made the ending **buyable from the
menu** — 6000 free seeks, no combat, ledger 7512 vs threshold 1. Now the same attack yields 48 and
saturates. **First play-test on real hardware:** the freeze is CONFIRMED fixed; the author ruled
**bargains become random descent events** (§22.23, kills the altar-farming frame at the root, lands
with #2); the bargain cost labels are placeholders for #13. **v1 engine work is COMPLETE** — what
remains is #13-lite (the authored pass, author-only) and #14 (ship).

### 2026-09-06 — The repository is public ✅

**Published to `github.com/jihadftouny/The-Void`** (`main` only), replacing the 2023 Java original,
which is preserved in full — locally in `.legacy/The-Void/` and as a mirror backup. Preparation for
publication: a `README.md` (what the game is, how to run it, the GPU requirement and one-time model
download stated plainly) and an all-rights-reserved `LICENSE` were added; commit identity was
standardised; personal planning material that predated publication was moved out and the history
cleaned; the 21 fully-merged `agentic/*` branches and two internal pipeline backup tags were pruned
(three branches with unmerged work remain local). Suite verified after every rewrite: **1646 tests,
typecheck clean, `git fsck` clean.**

### 2026-09-04 — The game can be debugged, and the freeze is fixed ✅

**`observability` merged.** Suite **1320 → 1646 tests**, typecheck clean, build passing, trunk verified.

- ⭐ **The 2026-09-01 first-encounter freeze is SOLVED and FIXED.** It was **G37**: `ensureNarrator`
  recorded the narrator only *after* its `await`, so the first narration started a **second full 2.5 GB
  model load** — GPU probes at 30 s timeouts included — while `busy = true` held the input lock. That
  matches every observable: first beat, tens of seconds, self-recovering, never recurring,
  GPU-independent. Extracted to `narrator-gate.mjs` so it is **provable under real concurrency**: 20
  racing callers → exactly 1 construction, with the old implementation kept as a **live control that
  must produce 2**.
- **`CLAUDE.md` gained principle 7 — always log.** Prompted by that freeze leaving *no evidence*: the
  logging system was called from one file and there was **no timing instrumentation anywhere**. Now ~40
  measurement points — model load, time-to-first-token, tokens/sec, every turn, every save — with a
  heartbeat that distinguishes *slow* from *wedged*, which is the question the original report could not
  answer.
- **G41 fixed, and it was live on the machine at the time** (`[::1]:5173`, pid 29236, still answering).
  **Register departure:** Vite now runs **in-process**, so there is no child to orphan, and the readiness
  poll that *was* the silent-attach defect is **deleted**. Reclaim is proof-gated on `/@vite/client` and a
  single PID. **No kill command is ever needed again.**
- **G6 fixed** — before this the packaged build's logging was a **silent no-op**, so a player's bug report
  carried no evidence at all. **G50 fixed.** `PLAN.md` #14 no longer carries G6 or G37.
- **Zero production defects found across two fix rounds** — every finding was a guard that could not fail,
  proven by the build output keeping the **same content hash** throughout. The unit's own lesson: three of
  its four hardest findings were **a correct decision computed and then dropped**, so the guard that catches
  that class asks *"does the RESULT reach the thing that acts on it"*, at the narrowest scope the code runs.
- ⚠ **A post-merge escape worth knowing about:** the trunk went red on a test that asserted a *state*
  (`logs/void.log` must not exist) where the fix only ever promised a *delta* (this code does not write
  there). It failed on the **residue of the very bug it guards** — a log this project wrote into its own
  checkout back in August. **Worktrees are fresh checkouts, so this class is invisible to every unit and
  only trunk verification can catch it.** Fixed; the file was left alone.
- **v1 status: 24 of 64 h logged**, both merged gates **ahead of schedule** (14 Sep gate merged the 1st;
  28 Sep gate merged the 2nd). Remaining: **#10a** grace wiring (4 h), **#13-lite** the authored pass
  (16 h, author-only), **#14** ship (12 h).

### 2026-09-02 — `#0 critical-engine-bugs` is DONE. All three units merged ✅

**All 33 critical engine defects are fixed, verified and on `main`.** Suite **1029 → 1320 tests**,
typecheck clean, build passing, verified on the trunk after each merge.

- **`#0c persistence-and-reach`** (13 commits) closes the last thirteen rows. **The player can see
  damage and dice for the first time** — `render/format.ts` was imported by nothing but its own test,
  so the whole roll-detail pipeline was computed every attack and shown to nobody, while the narrator
  is forbidden from saying numbers. **A resumed run keeps what it earned** (it silently forfeited
  every unlock — verified on seed 4242: the identical run, resumed, unlocked nothing). **A finished
  run is finished** and reports what it was.
- ⭐ **HEALING IS REACHABLE — one milestone earlier than `SHIP-SCOPE.md` scheduled it.** G14's catalog
  branch puts consumables and uniques on the drop paths, and the rest of the chain was already built.
  Measured over 100 whole runs through the real `step`: the Use-item picker appears in **96%** of runs
  and offers a heal in **94%**; reproduced by the test-agent on disjoint seeds (87–96%). **The game is
  playable end to end for the first time.**
- **It took THREE fix rounds — a recorded deviation from the pipeline's two-round rule**
  (`.claude/pipeline-log.md` carries the reasoning). Each round closed its findings *and* surfaced a
  strictly new class of blind guard: contracts that could not fail → polarity-blind source scans → a
  guard watching the caller while all five call sites had moved behind a helper. That last one,
  found only by **enumerating the diff mechanically instead of reading it**, would have restored G19
  in full — every save carrying an empty tally — with all 1315 tests green.
- **Balance verified unchanged at scale:** 20,000 runs, 20 disjoint blocks per tree. `main` 13.51% →
  `HEAD` 13.14%, difference −0.37 pp, **p ≈ 0.44**. AC-29 held byte-identical through four checks.
  ⚠ **But the gate itself is weak and always was** — `winRate > 0.12` fails on 3 of 20 alternative
  seed blocks on `main` alone. **#2 must re-derive it against ~1000 seeds, not retune constants.**
- **New defects: G50** (the renderer's `foldRunEvents` call is unguarded — neutering it forfeits every
  feat in every run, and the behavioural test folds it in its own harness so it can never prove the
  renderer calls it) and **G51** (`src/desktop/game.ts` cannot be imported, which is the *proven* root
  cause of every remaining test blind spot — **the first thing #6 should do**).
- **`CLAUDE.md` gained principle 7: always log.** Prompted by a first-encounter freeze that recovered
  on its own, on a GPU machine, leaving no evidence — because the logging system is used in exactly
  one file and there is **no timing instrumentation anywhere**. Next unit closes that.
- **Milestone statuses unchanged** — no demoted milestone yet meets its full "done when". M6/M7/M13's
  gaps all shrank (consumables now generate and can be found), but relics remain deal-only-in-
  principle and `snapshotUnlocks` still reads nothing, both of which belong to **#9**.

### 2026-09-01 — `#0c persistence-and-reach` built: the player can see numbers, and can heal 🔄

**Built and self-verified on `agentic/persistence-reach`; awaiting review and merge.** Suite
1155 → **1286 tests**, typecheck clean, `npm run build` passing. Thirteen register rows: G1/G19, G2,
G3, G14, G18, G26, G28, G33, G40, C7, G46, G49, D9.

- **The player can see the dice again (G18).** The most visible change in the batch, and the
  starkest finding in it: `formatEvent` and `formatRollDetail` were both complete, both tested, and
  **neither was ever called by anything** — while `VOID_PERSONA` forbids the narrator from
  mentioning "mechanics, dice, or numbers". So the game has never shown a player a damage number, a
  die, a hit, a miss or a crit. There is now a battle log — plain per beat, expandable to
  `d20+2 = 17 vs AC 13 → hit, 1d8 = 4` — that persists for a fight and resets at the next.
- **Healing is reachable (G14).** 23 of the 38 authored items — every consumable and every unique —
  could not be obtained by any means, which is *why* there was no healing. A data-driven catalog
  branch puts them on the victory-drop and chest paths, act-gated by each item's `floor`. Measured
  over 100 whole runs through the real engine: the **Use item** picker appears in **96%** of runs,
  offers a heal in **94%**, and a wounded player drinking one is asserted end to end. **One
  milestone earlier than `SHIP-SCOPE.md` §7 scheduled it.**
- **A quit mid-descent no longer forfeits the run (G19 → G1).** `runSummary` and `runSeed` live
  outside `GameState`, so neither survived a save and a resumed run restarted its feat tally at
  zero. The envelope goes v1 → v2 (**no `SAVE_VERSION` bump** — `GameState` is untouched), with a
  tolerant v1 path proved against a **real** v1 envelope produced by the shipped writer.
- **A finished run is finished, and says what it was (G2).** A victory settles at the `ending`
  phase while the save was cleared on `game-over`, so winning left a resumable save and relaunching
  offered *"A descent lies unfinished"* about a run already won. One exhaustive predicate now
  decides both halves, and the run ends on a factual summary — outcome, depth, bosses and unlocks
  by name. (The Void's own *narrated* account is G10, still open, still #6's.)
- **Also:** a corrupt unlock store no longer erases everything you have earned (G3 — a backup
  ladder and a visible notice); condition chips reach the HUD and the player's name is no longer
  interpolated into markup (G28); charge-reduction relics finally work through the UI (G33); a
  backtick can be typed into the name field (G40); the log speaks display names, not ids, and stops
  telling the player that *they* are the one on fire (C7, G46); the balance report computes its
  verdicts instead of asserting them, and emits its caveats from the generator so regeneration
  cannot delete them (G28c, D9).
- **⚠ THE NUMBER TO READ FIRST.** `balance.test.ts` passes **UNMODIFIED**, but its margin
  **halved**: 66 wins of 500 → **63**, against a floor of 60. §22.21 pins `HOLLOW_GATE_XP = 500` to
  exactly that threshold. Neuromancer and Penitent are now at **one win in a hundred**. Nothing was
  retuned — a balance shift here is a finding for #2, not a number to adjust. The shift is
  RNG-stream displacement, not difficulty (the sim never uses a consumable and cannot equip), and
  the evidence is that the 6-seed golden sample moved the *other* way. Full ledger in
  `offEquivalence.test.ts`.
- **Nine register departures, plus three more this build found.** The largest: `FINDINGS.md` G14
  says to put **relics** on the drop tables; `GAME-DESIGN.md` §14.1/§14.8/§18.2 all rule relics
  **deal-only, never dropped**, and `docs/README.md` puts the design doc above the register. Relics
  were not added, and a test — pinned by mutation — proves none can reach a loot path.
- **The healing deferral in `HUMAN-CHECKS.md` is lifted**, and replaced with nine play-checks and an
  explicit warning that **the game is expected to feel too easy**: v1 temporarily carries two
  healing systems, which is scheduled (§22.6 folds them in with #2), not a defect.

### 2026-09-01 — the first two engine batches are IN `main` ✅

**27 of the 33 critical engine defects are fixed, verified and merged.** Suite 1029 → **1155 tests**,
typecheck clean, build passing, both batches green together (they had never been run side by side
until the merge).

- **`#0a combat-core`** (12 commits, 23 defects) — **found gear can finally be equipped** (it never
  could: >100 drops across 300 seeds, zero equippable); **re-applied poison/burn/bleed now deal
  damage** (they dealt zero, forever — the single most damaging defect in the audit); **floor 5 has
  enemies** (it had no encounter layer at all). Plus the resistance subsystem, four unguarded damage
  sites, four cross-battle state leaks, `proficiency`, and the rest path.
- **`#0b narration-coverage`** (8 commits, 4 defects) — the narrator **now knows the player acted**
  (100% of player skill-casts previously reached the model with no fact that the player did
  anything, so it credited the enemy); act transitions carry their header instead of rendering
  blank; the ending prose survives the terminal click; **the engine no longer speaks the player's
  name** (§22.1). A new event kind now fails the build.
- **Both were adversarially verified, and it mattered.** #0a **failed** its first verification: one
  shipped line could be reverted to the broken formula with all 1102 tests still green, because the
  test fixture's resistances were all zero — where the old and new formulas are arithmetically
  identical. Fixed in one round. #0b caught the same failure family in itself: its first guard
  matched only single quotes, so the same bug written with double quotes passed. 13 + 29 mutations,
  all red on re-check.
- **Author rulings:** `GAME-DESIGN.md` §22.19 momentum carries between battles **with decay**
  (author's call against the recommendation; the decay rate is a number nobody has set) · §22.20
  found gear ships mis-modelled until #1 · §22.21 `HOLLOW_GATE_XP` = **500**.
- **Eleven register corrections + two new defects** (`FINDINGS.md` §4c). The dangerous one: `PLAN.md`
  told a builder to close all four state leaks in `createBattle`, which **would have broken G27**.
  New: **G48** — the simulator cannot reach 20 of 63 event kinds, which undermines every "measured
  over N runs" claim in the register; **G49** — `story.ts`'s comments now assert a token that was
  removed.
- ~~⚠ **The game is still not playable to floor 5, by design order:** there is **no healing** until
  `PLAN.md` #9 lands (potions folded into consumables; the consumable path is dead). The deep
  play-checks are therefore deferred — see `HUMAN-CHECKS.md`.~~ **SUPERSEDED the same day by `#0c`,
  which fixed G14: healing is reachable and the deferred play-checks are now fair to attempt.**
  **#9 is next.**

### 2026-08-31 — The shipping scope: The Void becomes Game #1, on a 60-hour budget 🎯

- **`docs/SHIP-SCOPE.md` written** — the deliverable for milestone `b1` of the personal Ftouny Plan
  v3 (due Sep 14). **The Void is Game #1; the three.js game is parked in writing.** Rationale: The
  Void is ~80% built and 0% shipped, and the plan's scoring event is *shipping*, not building.
- **The ≤60 h first-playable scope, and what it cuts.** In: `PLAN.md` **#0a/#0b/#0c** (24 h), **#9**
  (8 h), **#10a** (4 h), **#13-lite** (16 h), **#14** (12 h). Out: #2, #3–#8, #10, #11, #12, #15–#18.
  **The estimate is 64 h against a 60 h cap — stated, not hidden** — with a five-rung cut ladder
  armed in advance (the `Static` rename goes first).
- **Two conflicts between this project and the plan's rules, neither previously written down.**
  (1) The plan says *web-first*; The Void is a **2.5 GB, GPU-required Electron download** — a much
  narrower itch funnel. Desktop-only recommended for v1, **decide by Oct 19**. (2) The plan forbids
  **all game spending until ~Apr 2028**, so the ~$10.05 art budget is **not fundable** — The Void
  ships with **no generated art**, and `b2`'s required "page art" must be typographic, at $0.
- **Ship gates** (lane V on the board): `v1` Sep 14 → `v4` **FIRST PLAYABLE** Oct 19 (52 h) → `v5`
  ship candidate Nov 2 → `v7` **itch page + jam** Dec 14, seventeen days before `b2`'s deadline.
- **The planning board rebuilt and published** as an artifact: a fourth lane for The Void, a
  60-hour budget meter, rolling week cards, and the scope/cut list on the board. **Three silent
  defects fixed:** state was written to a `window.storage` API that never existed (so nothing ever
  saved), and both the webfonts and the markdown parser were CDN-loaded, which the artifact CSP
  blocks — the fonts fell back silently and the entire reference section rendered as raw markdown.
  *(The board is a personal planning document and is kept outside this repository — 2026-09-06.)*
- **Reframed the same day, on the author's clarification:** these milestones are **a gate against
  scope creep**, not a schedule. Three additions make the gate actually work — a **v1 test**
  (`SHIP-SCOPE.md` §2.1: does its absence make the game *lie*, make a run *unfinishable*, or make it
  *not a product*? plus $0, plus **name what it displaces**), a **protocol for ideas arriving
  mid-build** (§2.2), and **a version against every cut row** (§4) feeding an **increment ladder**
  (§9: v1.1 narrator → v1.2 floors+balance → v1.3 free visuals/audio → v2.0 everything needing
  money, ⛔ gated on `f5`, not on effort). *A cut list where everything is vaguely "later" is a pile,
  and a pile is how cut scope comes back.*
- **`v1.2` IS milestone `b3`** ("game #2 **or #1 expanded** · ≥100 plays") — expanding The Void
  satisfies it without starting a second game.
- No game code changed. **#0a–#0c remain the next build**, and are now the first ship gate.

### 2026-08-28 → 31 — The great discrepancy hunt + the validation round ✅

- **Fifteen audit rounds** (three parallel agents each: code / fiction / process), every finding
  verified by running the real engine. Net: **the register grew from 8 known bugs to 47 rows**
  (G1–G47, no G38) — among them: no found item can ever be equipped (G11); re-applied
  damage-over-time deals zero forever (G23); floor 5 has **no encounter layer** (G43); the pack
  command had **never once succeeded** (G44). **Six milestones demoted** ✅→🔶 for failing their
  own "done when" — headline moved 10/18 → **4/18**. Twelve content defects (C1–C12) logged for #13.
- **2026-08-31 validation round** — the author answered twelve questions; full record with rejected
  alternatives in `GAME-DESIGN.md` **§22**. Closed A7–A10, A1b, B4c. **Reversals:** item icons
  CANCELLED, the Tibia paperdoll/grid → **text lists**, the codex CUT. Art budget ~$23.72 →
  **~$10.05** (four batches). Potions fold into consumables (⛔ **#9 before #2** or the game ships
  with no healing). `insanity` to be renamed (name pending). The narrator never speaks the player's
  name and never references a previous run.
- **`electron-builder.json` fixed** (`d8eb952`) — the `$comment` key that made every
  `npm run desktop:pack` fail since the file was created is gone; the config validates. First real
  pack still needs **Windows Developer Mode** (`HUMAN-CHECKS.md`).
- **Second sitting (same day):** the six last open items closed — `insanity` → **`Static`**;
  `karmaMemory` **deleted**; G2's fix designed (terminal states clear the save; the summary is the
  record); the verdict **grace-generous** (author's call, cost recorded); **backpack N = 12**;
  tests `node` + per-file `jsdom`. **The author queue is EMPTY for the first time.**
- **Final consolidated sweep** (two agents over all spec/planning files) found and fixed **51**
  propagation defects from the round itself — the dominant failure of the whole hunt: **the newest
  edit, not the old documents.** No code changed beyond the config fix; #0a–#0c remain the next build.

### 2026-08-25 — M-UI2 begins: `ui-foundation` built + verified; the art direction found
- **`ui-foundation` (unit 1 of 5) — ✅ MERGED to `main`. FINAL VERDICT PASS after 3 fix rounds,
  1029 tests** (960 → 1014 → 1026 → 1029). Post-merge on the trunk: typecheck clean, 1029 tests,
  build OK. One round was a genuine FAIL — a new guard was passing *vacuously* and could not have
  caught its own bug; fixed, and the lesson written into `.claude/agents/build-agent.md`.
  Safety tag on the pre-merge trunk: `pre-merge-ui-foundation`.
- **⚠️ A full project audit followed the merge → `docs/SCOPE-AUDIT.md`.** Commissioned *before*
  building the battle screen, and it stopped that plan: **not one of the five floor-specific
  mechanics exists in code** (illusions/WIS, ash attrition, floor-4 temptation, floor-5 kit
  corruption), and they touch the battle round loop, the encounter generator, healing, the skill
  resolver and the RNG draw order — i.e. every determinism test and every balance number. Also
  found: **equip is not a `step` input** (so the entire balance report is measured on a character
  that never equips found loot), **no content schema has a description field**, the LLM layer is a
  190-line prompt-builder against a nine-item M11 spec, and several documents locked on the same day
  contradict each other. **Ranked by retrofit cost in the audit; working down Tier 1 before building.**
  Delivered: design tokens + five per-floor accents, the shared panel/bar/chip/row/button
  components, **the standalone Kaplay front-end deleted** (`index.html` + `src/scenes/` — one
  front-end from here, bundle 205 kB → 116 kB), and combat events widened to carry real dice.
- **A REAL ENGINE BUG was found and fixed, unrelated to the UI task.** `battle.ts` modified damage
  *after* `combat.ts` emitted the attack event, so events reported damage the player never lost — a
  Scrap Plating round reported **2 while the player lost 0**. Invisible for the whole project
  because nothing displayed those numbers. Building the dice log is what surfaced it.
- **Art direction FOUND — and it changed.** Three probes (~$3.60 total): painterly realism worked
  but is superseded by **"32-bit era, but 2D"** — pre-rendered sprite art (Diablo 1 / Fallout /
  PS1), dithered, murky, limited palette. It pairs with the austere monospace interface instead of
  fighting it, and makes the alpha-keying problem tractable. Full record: **`docs/ART-BIBLE.md`**.
- Also locked this session: **techno-occult** tech level (riot plate with a hand-scratched ward —
  fixes a medieval-knight error), the five class costumes (none existed before), the floor colour
  ramp in the author's own words (**toxic green** Undercity · red-fleck Entrance · **cold
  white/grey/black** Ash City, the fire is OUT · bone Angelic · arterial True Void), the Undercity
  as a flooded industrial level, the Ash City as an *endless varied* city, Floor 4 as ruins opening
  into a buried city, and **Ash-Wraith vs Ash-Wretch as two different enemies** (a new family — an
  engine change, through the pipeline). Batch: **50 buildable now, 52 once the engine catches up**
  (~$10.05 / $10.45 **batched** — batch mode is half the interactive rate).
- **THE WORLD IS COMPLETE — `docs/WORLD.md`, six interview rounds, every open point closed.** The
  full mechanism: **a brainchip holds a recorded life; taking it out leaves a person hollow; the
  hollow is the Void.** The Memorians' ordinary day job *is* the cause, and only they know it —
  everyone else believes the folklore that the Void is a hole in the ground. **The whole game
  happens during the extraction**, which is a slow reading performed on a conscious person; the five
  floors are its stages. **The mission was to harvest you.** Grace = waking mid-procedure and
  reclaiming your integrity (whole ≠ well; what was read is gone). Damnation = the reading
  completes, **and your stripped chip is installed in another emptied body — which is what a Hollow
  is.** The Hollowed are literally previous subjects; the meta-progression unlock is diegetic.
  Also closed: the pit is real and unexplained even to the Memorians; the angels are real because
  *your own life was what blocked them*; chips are universal; the Kingpin is beaten but not killed
  at the Rift's threshold; rival houses and the surface deliberately parked.
- **All art-style decisions settled, nothing generated** (per the author's instruction). One sprite
  per enemy with motion in code · affixes as shader effects (120 combos, zero assets) · transparency
  by keying flat black to PNG in post · item icons deferred until the inventory is redesigned ·
  **no generated interface art at all** — the austere typographic UI *is* the Memorians' file on you
  · **hardware kept out of the art entirely**; the Hollow is rendered as wrongness of occupancy, not
  as visible technology. Generation order locked: environments → characters → enemies → bosses.
- **`docs/README.md` added** — indexes all nine documents, states which wins when two disagree, and
  lists the corrections already on record so nobody re-derives from a stale line.
- **Earlier the same day —** A thorough worldbuilding interview replaced what
  had been *one paragraph* of authored prose and a lore file reading "this is a lore this is a lore".
  **Keystone: the condition IS the Hollow** — the Void is not a place, it is what happens to you, and
  what happens is hollowing. That resolves the game onto one axis, and the grace ending's existing
  words, *"made whole"*, turn out to be the win condition stated exactly: **whole is the opposite of
  hollow.** Also locked: Absolution as the last city; houses as noble-magical bloodlines with
  industrialised magic (so the techno-occult look is simply *accurate*); the Rift's origin unknown and
  contested; **the mission ends after floor 1** (floors 2–5 are escape and survival); brainchips as
  recorded lives; the Neuromancer as a Memorian, which makes the mission internally motivated; the
  five stages (before → **fracture → grief → judgement → absence**); **floor 4's angels are REAL**,
  making grace genuine mercy and the game a survivor's story rather than a horror story; and the
  narrator as the hollowing itself, speaking.
- Pipeline doctrine changed: **build-agent may now fan out `Explore` sub-agents for READING** but
  remains the only writer — parallel writers in one worktree recreate the exact clash worktrees
  exist to prevent, with no git isolation to catch it.

### 2026-08-24 — THE BIG MERGE: the whole M1–M15 stack lands on `main` ✅
- **User-gated merge approved and executed.** Tagged `pre-merge-backup-m15` on the old trunk, then
  `git merge --no-ff agentic/balance-tune` — the chain tip, which carries all 15 stacked units.
  **Zero conflicts** (main's extra commits were docs-only: `PROGRESS.md`, `HUMAN-CHECKS.md`,
  `.claude/pipeline-log.md`; the chain never touched them). 111 files, +16,100 / −1,251.
- **Post-merge verification on `main`:** `npm run typecheck` clean · **960/960 tests pass** (57 files,
  5.5s) · `npm run build` OK. The trunk now IS the game.
- Notable shape changes now on trunk: `src/game/shop.ts` + `src/scenes/shop.ts` **deleted** (gold is
  gone — replaced by `deal.ts` sacrifice-economy), and 40+ new engine modules (karma, equipment,
  relics, loot, draft, boss, sim, unlockStore…).
- The 16 unit worktrees under `worktrees/` and their `agentic/*` branches are now fully merged and
  are safe to delete — **left in place pending the engineer's word** (they cost disk, nothing else).
- **Desktop smoke test after the merge: PASS.** GPU selected (RTX 5060 via Vulkan), the 4B model
  loaded, narration streamed at **89 tok/s, 181ms to first token**. The app is ready to play-test.
- **UI scope interview: DONE.** All decisions recorded in **`docs/UI-DESIGN.md`** (see the summary
  in the header above). Also added `.env` + `art-candidates/` to `.gitignore` and a `.env.example`,
  ahead of the API key arriving — so a key can never be committed by accident.

### 2026-08-10 — M0 complete: consolidated to a single `main` trunk ✅
- Merged the verified stack into **`main`** (user-gated, approved): `agentic/gpu-fix` (all engine +
  desktop LLM + GPU-fix code, clean ff) then `spike/n1-local-llm` (v3 design docs + doc-history) —
  both auto-merged, **zero conflicts**.
- **Post-merge verification on `main`:** `npm run typecheck` clean, **378/378 tests pass**,
  `npm run build` OK.
- Cleaned up: removed 8 merged unit worktrees + deleted their branches. **Kept as safety refs:**
  `spike/n1-local-llm` (fully merged) and `agentic/logic-core` (content is in `main` via wire-save,
  but its original commits aren't ancestors — not force-deleted during consolidation). One stale
  `worktrees/gpu-fix` dir is OS-locked (harmless cruft; clears later).
- Design brainstorm is complete (all systems locked in `docs/GAME-DESIGN.md`); the full design also
  co-decided the class roster, floors+bosses, karma model, enemies, economy, items, status effects,
  level-up loop, and meta-progression this session.
- **Next: M1** — foundational state models (four-axis karma vector, item/inventory schema, standard
  D&D stat formula) through the agentic loop (plan → build → test in a worktree off `main`).

### 2026-08-05 — Full scope interview + mechanics-first re-scope (M0 docs)
- Ran a thorough scope interview. **Recalibrated to mechanics-first** (deep RPG is the heart; LLM
  narrates over it) and expanded scope: several distinct classes w/ signature kits, player skills +
  all **25** conditions, 24 enemy families + affixes, 5 boss agents, full Tibia-style inventory,
  build-defining relic trinkets, authored uniques + rarity-scaling, rich consumables, drops+chests+
  shops loot, thematic economy, unlocks-only meta-progression, hidden multi-axis karma with a
  blended-spectrum ending, and the locked five-floor spine (Undercity → Entrance to the Void → Ash
  City → Angelic Underground → True Void). Karma is live from floor 1; **floor 4 is the reckoning**
  (carried karma × floor-4 choices decides grace vs. cast-down).
- Wrote **`docs/GAME-DESIGN.md`** (authoritative WHAT, decisions tagged DECIDED/PROPOSAL/OPEN) and
  rewrote **`docs/ROADMAP.md` → v3** (18-milestone plan mirroring the spaceship game's format).
  Reconciled this tracker. `CLAUDE.md` top line ("LLM-driven narrative RPG") flagged for a one-line
  mechanics-first tweak (user's file — not auto-changed).
- Also this session: fixed the device-agnostic GPU selection (kept the verified `gpu-fix`; removed an
  accidental duplicate `gpu-discrete`); rebuilt the `gpu-fix` worktree for the user's real-hardware check.
- Next: brainstorm the [OPEN] items (classes, floors+bosses, karma axes) → then M0 merge (gated) → M1.

### 2026-08-02 — Playable LLM game slice (N1 shell + N2 narration + N3 loop)
- Merged the engine (`agentic/wire-save`) into `spike/n1-local-llm` (build step, not the gated
  merge-to-main), giving the branch: engine + save/load + Kaplay UI + the N1 Electron shell.
- Wired the real game: pure `src/llm/narrate.ts` (engine events+state → narration prompt, tested) +
  DOM renderer `src/desktop/game.ts` that drives the engine `step` loop, streams the 4B narrator per
  beat over the N1 IPC, and shows engine-authoritative choices for every phase (title→creation→
  battle→rest→shop→level-up→ending→game-over) with a live character/enemy sheet. Falls back to plain
  facts if the model errs (engine stays authoritative).
- Removed the N1 proof shell; `desktop.html` now loads the game. typecheck clean, 319 tests, build OK.
- **A full run is now playable end-to-end in the desktop app**, LLM-narrated. Remaining is
  fine-tuning (grammar-constrained choices, zone prompts, enemy cards, balance, packaging).
- Next: your visual `npm run desktop` play-test.

### 2026-08-02 — N1 local-LLM spike: GREEN
- Built `scripts/spike-llm.mjs` (node-llama-cpp) on branch `spike/n1-local-llm`; ran on the dev
  laptop (RTX 5060). Downloaded Qwen3-4B-Instruct-2507 + Qwen3-1.7B (Q4_K_M GGUF).
- Verdict: **local-LLM design is viable.** Streaming works; grammar-constrained JSON
  (narration + choices) works; prose is good and on-theme. Numbers + recommendation in
  `docs/N1-SPIKE.md`. Qwen3 = Apache-2.0 (clean to bundle).
- Recommend: ship both models, auto-select by hardware — 4B default/quality, 1.7B no-GPU floor.
- Deviation (recorded in pipeline-log): the spike ran OUTSIDE the plan→build→test pipeline
  (exploratory + native deps + 3.6GB models + human-hardware measurement the test-agent can't do).
- Next: N1b (Electron desktop shell) — awaiting the user's go-ahead + model-tiering decision.

### 2026-08-02 — The design interview + v2 re-scope (N0)
- Ran the full scoping interview (on Fable, per the user's request). Locked: hybrid input; LLM
  adjudicates within rules (engine owns all numbers); engine-as-toolbox; master narrator +
  specialists; tiered enemies (cards + boss agents); zone prompts owning tone/encounters/mechanics/
  beats; **local LLM** (no cloud/keys/cost); **packaged desktop game** on itch; desktop-first
  (mobile later); min spec = no-GPU laptop → 3–4B model; streaming narration; DOM text + Kaplay
  atmosphere UI; zones co-written author+Claude; held branches decided later.
- Rewrote `docs/ROADMAP.md` (v2, N0–N10), this tracker, and CLAUDE.md doctrine (desktop-first
  amendment + local-LLM principle).
- Next: N1 — desktop shell + local-model spike (through the loop).

### 2026-08-01 — Save/load wired into the UI (+ LLM pivot noted)
- Integration unit `agentic/wire-save` (= ui-shell + save-load merged, then wiring): working
  "Continue" on the title, autosave between encounters + on act transitions, save cleared when a run
  ends, and a "Restart" on game-over. Injectable storage keeps the save policy headlessly tested.
  VERDICT PASS, 315 tests. Merge path simplifies to: logic-core → wire-save (wire-save subsumes
  save-load + ui-shell).
- **New direction:** user set the vision to an LLM-driven narrative game (stored in memory).

### 2026-08-01 — Save/load + Kaplay UI shell, built in parallel (M9 + M10)
- Ran M9 and M10 as two PARALLEL pipeline units (disjoint file territories), both branched off
  `agentic/logic-core`, both VERDICT PASS, 0 fix rounds:
  - M9 (`agentic/save-load`): pure save/load core (safe encode/decode, corrupt-save rejection,
    version/migration seam) + a Node-safe browser localStorage adapter outside `src/game`. 31 new
    tests; logic core stays pure.
  - M10 (`agentic/ui-shell`): responsive Kaplay UI shell (portrait 540×1080,
    letterboxed, ≥44px touch targets, safe-area insets) rendering the pure `step` controller.
    **The game became playable on screen.**

### 2026-08-01 — Full Java logic port through the loop (M2–M8)
- Ran the whole game-logic port through the `agentic-engineering` loop in one worktree
  (`agentic/logic-core`, built on top of M1), in four plan→build→test stages, ALL VERDICT PASS:
  - Stage A (M2): all content as data — weapons/armor/elements/enemy-name tables/lore/story + loaders.
  - Stage B (M3+M4): player creation and enemy generation (fixed the original's 1-HP-enemy gap).
  - Stage C (M5+M6): pure event-based combat + status conditions + skills.
  - Stage D (M7+M8): encounters, act progression, level-up, story, final boss — capped by a pure,
    serializable `step(state, input)` controller that plays a full run headlessly.
- 237 tests green; logic core has zero renderer/DOM imports and zero `Math.random`/`Date.now`.
- Known: game unwinnable at faithful balance (now deferred into N9, where narrator pacing changes
  the question).

### 2026-07-26 — M1 through the loop
- First pipeline run: `agentic/m1-character-core` (superseded by logic-core). plan → build → test,
  VERDICT PASS. Character foundation: serializable `Character`, `Stat` const, mod formula
  (`10 - ceil(|stat-30|/2)`), AC/HP derivation. 23 tests, hand-derived values.

### 2026-07-26 — Project founded
- Repo layout on the modern stack: Vite 6 + Vitest 2 + TypeScript (strict) + Kaplay. Old
  Java/Python/Pixi ports moved to `.legacy/`.
- Installed the agentic "loop": plan/build/test/retro agents, `agentic-engineering` +
  `pipeline-retro` skills, `pipeline-log.md`, doctrine, `HUMAN-CHECKS.md`.
- Seeded RNG logic core + tests; Kaplay title scene boots (M0).
