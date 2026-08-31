# The Void — Build Progress

_Live tracker. Driven by `docs/ROADMAP.md` (v3 — the mechanics-first roguelike). Design record:
`docs/GAME-DESIGN.md`. Updated as the final step of any session that changes build state._

> **Direction (scope locked 2026-08-05):** The Void is a **mechanics-first roguelike RPG** — a deep
> D&D-style game with a **local-LLM narrator** over the top (engine owns all rules/numbers). Five-floor
> psyche-descent, die-and-restart with **unlocks-only** meta-progression, a **hidden multi-axis karma
> ("Nature")** that bends world + mechanics and resolves into a **blended ending** (floor 4 is the
> karma reckoning). Full-depth systems: classes + signature skills, **25** conditions, 24 enemy families +
> affixes, 5 boss agents, Tibia-style inventory, relics + uniques + rich consumables, thematic economy.
> Design in `docs/GAME-DESIGN.md`; milestone plan in `docs/ROADMAP.md`.

**v3 overall: 4 of 18 complete · 9 partial · 5 not started · 1029 tests** `[####----------------]`

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

**Now decided and written down** (31 items): the whole world (`docs/WORLD.md` — the Void is a
*condition*, the condition is the Hollow, and the descent happens *during* an extraction); all five
floor mechanics; the art direction (32-bit-era 2D pixel, `docs/ART-BIBLE.md`); audio at full
ambition; the equipment slot set; a content warning on every fresh run (`docs/CONTENT-WARNING.md`);
full accessibility including a screen-reader pass; licence, free itch release and no telemetry
(`docs/SHIPPING.md`). **The engine writes the choices — the LLM-authored-choices plan is dropped**,
which shrinks M11 substantially. **Min spec now requires a GPU.**

**Next up (NOT started — no branch exists yet):** **`#0 critical-engine-bugs`, now THREE units** —
**thirty-two** defects (G11–G46; there is no G38), far too many for one. **This blocks #1.** Full detail in `PLAN.md` #0:

| Unit | Covers |
|---|---|
| **#0a `combat-core-fixes`** | **G23 re-applied damage-over-time deals ZERO forever** · **G29 Kingpin minion damage bypasses shield + revive (the death that happens most)** · **G24 failed escape does the same** · **G25 shield accumulates 5→10→15→20→25 all run** · **G34 momentum leaks the same way** · **G27 fracture is permanent** · **G30 fracture on the ENEMY is inert** · **G31 rest never restores skill charges** · **G32 wire `proficiency`** (author-ruled) · G11 equip resolution · G11b its non-circular test · G12 advantage latch · **G17 the whole resistance subsystem is inert** · G20 deals can drive HP negative · **G35 the "cheaper" upgrade reaches ZERO cost — free casts forever (274/300 seeds)** · **G36 rejected button presses still advance the boss** · **G39 a flee item escapes any boss and soft-locks Act 5** · **G43 floor 5 has NO encounter layer — 21% of the roster is unreachable** · G4, G16, G22, G28(d), G45 |
| **#0b `narration-coverage`** | G13 five missing narration cases · G21 blank act transitions (47 + 47 measured) · **G42 the ENDING is erased by the click after it — a finished run's last screen is blank** |
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
| M2 — Player skills + full 25-condition system | 🔶 **merged, but fails its own "done when"** (456 tests). `ROADMAP.md` requires *"elements/resistances affect skill damage"* — **they do not affect it at all** (`FINDINGS.md` G17: the formula is zero below 100 resistance and nothing produces more than 10, and the function layering gear/WIS has no callers). Skills and conditions themselves are fine |
| M3 — Classes & signature kits | ✅ **merged to `main`** (494 tests) |
| M4 — Combat overhaul: defense matters (enemies roll to-hit) | ✅ **merged to `main`** (526 tests) |
| M5 — Inventory & equipment (Tibia-style) ★ | 🔶 ENGINE **merged to `main`** (561 tests); **Tibia visual UI deferred to a collab pass w/ you** |
| M6 — Items content: relics, uniques, consumables | 🔶 **merged, but fails its own "done when"** (625 tests). Shipped: 15 relics + 4 uniques + 19 consumables + effect/trigger system + rarity gen. **But `ROADMAP.md` requires build-defining relics that "change how a build plays" and consumables "usable in and out of combat" — and no relic or consumable can ever enter a backpack** (`FINDINGS.md` G14: `loot.ts` only ever calls `generateItem`). 2 of 4 clauses unmet; flavor co-write & in-UI display also pending |
| M7 — Loot sourcing & thematic economy | 🔶 **merged, but fails its own "done when"** (649 tests). Shipped: **gold removed**, pure sacrifice-deals + loot drops + chests. **But `ROADMAP.md` requires "real sinks (gear/consumables/rerolls/services)" and three of the four do not exist in a real run** — `kindForSlot` can never return `usable` so no consumable can be generated; the `reroll` flag is returned and never read by its only caller; and no service exists in `DealReward`. Same root cause as M6/M13 (`FINDINGS.md` G14) |
| M8 — Enemies: families, affixes, karma-weighting | 🔶 **merged, but fails its own "done when"** (691 tests). Shipped: 24 families + 5 affixes + spare action + family-themed kits. **But `ROADMAP.md` requires karma-weighted families to "shift Nature *axes*" — all nine ⚖ families declare the same pair and only `mercyCruelty` ever moves.** `enemyFamily.ts:17` says so itself: *"uniformly set to the mercy↔cruelty pair now. M10 differentiates the axes."* One axis, not axes (`FINDINGS.md` G15) |
| M9 — In-run progression (frequent level-up picks) | 🔶 **merged, then partly reversed by design** (726 tests). Shipped: XP-frequent leveling + draft-1-of-3 + lean start + auto-HP. **But §19.5 removed `stat` from the draft** (per-level allowance instead) **and set a level cap of 20** — neither is in `src/` yet |
| M-UI — Functional UI (surfaces the whole engine, hand-testable) | ✅ **merged to `main`** (753 tests); plain/utilitarian — the turn-based battle screen is the NEXT unit |
| M-UI2 — Visual restyle (5 units) | 🔶 **unit 1 of 5 (`ui-foundation`) merged to `main`** (1026 tests): design tokens, shared components, second front-end retired, combat events widened. **Units 2–5 are `PLAN.md` #6–#8.** *(Added 2026-08-28 — this had no tracker row at all despite being merged, so a five-unit restyle with 273 tests behind it was invisible to the milestone table.)* |
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
