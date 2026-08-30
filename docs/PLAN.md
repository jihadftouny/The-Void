# The Void — Work Plan

_The live plan: what is left to build, in what order, and what blocks what. Derived from
`docs/SCOPE-AUDIT.md` (the evidence) and the 2026-08-25/26 scope interviews (the decisions)._

**Precedence:** this file says *what to do next*. It never overrides `docs/GAME-DESIGN.md`,
`docs/WORLD.md` or `docs/ART-BIBLE.md` on *what the thing is* — see `docs/README.md`.

---

## Dependency order

```
  #0 critical-engine-bugs ─> #1 engine-foundations ─┬─> #2 floor-mechanics ─┬─> #6 battle-screen ─┬─> #7 canvas-layer
                                                    │   (+ balance re-run)  │                     └─> #8 screens-restyle
                                                    └─> #13 content authoring
  #3 art-pipeline ───────┬─> #5 art batches (5, gated) ──> #7 canvas-layer
  #4 probe 04 + approve ─┘
  #9 #10 #11 #12 #14 — independent, sequenced by judgement
```

**Unblocked right now: #0, #3, #4.** *(#1 was unblocked until 2026-08-28; **#0 now precedes it**, because
#0 fixes the equip resolution path that #1's change 1 and change 10 both build on top of.)*

---

### Tier 0 — the engine is broken in ways the test suite does not see

**#0 `critical-engine-bugs`** — **thirty defects** found by discrepancy passes 5B, 6A, 7A, 8A, 9A, 11A **and 11B**.
**Every one verified by running the real engine, and every one passing 1029 tests and a clean
typecheck.** Full evidence in `FINDINGS.md` §4
(**G11–G43; there is no G38**). This unit exists because these are not polish; **three of them mean whole shipped systems
do nothing at all.**

1. **G11 — no found item can ever be equipped.** `equipment.ts` resolves by `defId` only, so every
   `gen:*` item from `rarityGen` fails to resolve. Measured: **>100 drops across 300 seeds, zero
   equippable.** The player fights the entire game in starting gear, and the UI shows an Equip button
   that does nothing. **Fix:** `resolveInstanceDef` in `canEquip` + instance-aware slot inference.
2. **G11b — add the test that would have caught it.** Two existing tests *look* like coverage and are
   circular: one never calls `equip()`, the other writes into `inventory.slots` directly. **The new
   test must call `equip()` on a real `generateItem` output** (`PRINCIPLES.md` §A3).
3. **G13 — four major beats render blank narration.** Boss reveals, the act-4 karma reckoning, the
   whole mercy path and every level-up pick emit events `describeEvent` has no case for. **Fix:** add
   the five cases **and** replace `default: return ''` with an exhaustiveness check, so the next new
   event kind fails the build instead of going silent.
4. **G12 — `advantageDisadvantage` is a write-only latch.** Every boss is fought at ±5 to-hit
   depending on unrelated leftover state. **Fix:** compute it per round rather than storing it.
5. **G14 — 37 of 38 authored items are unobtainable.** Add a catalog branch to the drop tables and
   make `snapshotUnlocks` actually read `store.relics`/`.skills`. *(Also task #9.)*
6. **G16 — `dealQualityTwist`** is a third dead stat twist still labelled "no-op until M7"; M7 shipped.

**Round 6A added six more, all verified by running the engine:**

7. **G17 — the entire resistance subsystem is inert.** `Math.floor(res / 100)` is zero for every
   value the game can produce, *and* `effectiveResistances` has no production callers. Dead as a
   result: 7 elements, 5 family themes, the `blessed` affix, the `bonusResist` effect, 2 conditions.
8. **G18 — the player never sees a damage number, die, hit, miss or crit.** `render/format.ts` is
   imported by nothing but its own test, so the whole M-UI2 roll-detail pipeline is computed every
   attack and consumed by nobody — while the narration persona is *forbidden* from mentioning numbers.
9. **G19 — resuming a save forfeits meta-progression.** ⭐ **This is the root cause of G1**, which
   was previously logged as having no fix. `persist.ts` stores only `{state, memory}`.
10. **G20 — a sacrifice-deal can drive `maxHp` and `hp` negative.** `canAfford` guards the `hp` cost
    and not the `maxHp` cost, and the subtraction has no floor.
11. **G21 — every Act transition renders a blank screen.** 47 + 47 measured over 20 runs. Distinct
    root cause from G13: the cases exist but discard `e.header`, and all ten bodies are `""`.
12. **G22 — three smaller verified defects:** no `maxHp` clamp on condition HP ticks; the enemy skill
    gate is `> 0` while the cost can be 2, so charges go negative; enemies never restore charges.

**Round 7A added six more, all verified by running the engine:**

13. **G23 — re-applying a damage-over-time condition resets it to ONSET, so it deals ZERO damage
    forever.** Measured: spamming `ember` for 20 rounds deals **0** total burn damage, while casting
    it **once** deals 1 — the dominant player action is strictly worse than acting once. Affects
    every bleed/burn/poison on both sides, and means a refreshed freeze/stun **never rolls its
    saving throw.** *This is the most damaging single defect found in the entire audit.*
14. **G24 — the failed-escape counter-attack bypasses the whole defensive pipeline.** Shield not
    consulted, first-hit reduction skipped and still banked, `onTakeDamage` never fires, and **the
    once-per-battle revive relic does not save you** — at the death players most often walk into.
15. **G25 — `player.shield` is never cleared at battle end.** Measured 5 → 10 → 15 → 20 → 25 over
    five fights, climbing all run and surviving the save file.
16. **G26 — when the model fails, the fallback prints the PREVIOUS beats, not what just happened.**
    A GPU is the stated min spec and this is the *designed* degraded path.
17. **G27 — fracture is effectively permanent.** Rest never clears conditions despite the duration
    being tuned on the assumption it does, and the only cure is unobtainable. One floor-1 enemy skill
    puts you on attack disadvantage **for the rest of the run**, verified over 99 rounds.
18. **G28 — five smaller:** the HUD shows **no condition chips at all**; the player name goes into
    `innerHTML`; `balance-report.ts` mixes live numbers with hard-coded claims that a retune will
    falsify; `clarity-draught` can never be used; an unguarded `resolveSkill` crashes the sheet.

**Round 8A added six more, all reproduced by running the engine.** *(These carried `BLOCKS` tags in
`FINDINGS.md` from 2026-08-28 but were missing from this list and from both unit-coverage cells until
2026-08-30 — so a unit planned from this file would have shipped without six known blockers,
including the ⛔⛔ one. Found by round 9C.)*

19. **G29 — a THIRD unguarded damage site**, and the most reachable one: Kingpin minion damage
    bypasses shield, the revive gate and every `onTakeDamage` relic. The Act-1 Kingpin is the biggest
    Act-1 killer, so **this is the death that happens most.** A fourth site exists in
    `resolveUseConsumable`. Fix all four with one shared helper.
20. **G30 — fracture on the ENEMY is inert.** `advDisOverride` is read for the player and never for
    the enemy, and `heavyStrike` — the Enforcer's core skill — inflicts it. It emits no event either.
21. **G31 — the player's skill charges are never restored.** Contradicts a *decided* rule quoted
    verbatim in the register: §18.1, *"a rest restores HP **and skill charges**."*
22. **G32 — `proficiency` is dead state.** ✅ **Author ruled 2026-08-30: WIRE IT**, then re-run the
    balance sim.
23. **G33 — the Cast picker ignores `chargeDiscount`**, so charge-reduction relics do nothing through
    the real UI at exactly the margin where they matter. *(→ #0c, not #0a — it is a view-model fix.)*
24. **G34 — `momentum` is the fourth carry-over leak**, after `shield`, `activeConditions` and the
    advantage latch. Close all four in `createBattle`, the single funnel every battle passes through.

**Round 9A added four more.** *(Round 9A's ids reached the coverage cells on 2026-08-30 but not this
list — the mirror image of the round-8A failure recorded above, and the reason the prose a planner
reads said "twenty-four … G11–G34" while the cells held 31 distinct ids. Found by round 10C.)*

25. **G35 — taking the "cheaper" upgrade twice reaches ZERO charge cost**, and the cast guard
    `charges < cost` is false at `0 < 0`, so the skill casts free every round forever. **274 of 300
    seeds** reached it. Resolve `templateApplies` against the player's skill, not the base.
26. **G36 — rejected actions still fire `bossPostRound`.** Nine rejected "Run" presses cost 11 HP to
    Kingpin minions, and three *rejected* casts burn the Reflection's once-per-battle adapt. Add
    `resolved: boolean` to `RoundResult` and gate on it.
27. **G39 — a flee consumable ignores `canFlee`**, escaping any boss — and escaping the Act-5 Hollow
    **permanently soft-locks the run**, because the Hollow is built only at `act-intro(5)` and act 5
    never advances. Goes live the moment G14 is fixed.
28. **G40 — the debug overlay's key handler has no `ev.target` check**, so a backtick typed into your
    character name is eaten and opens a panel over half the screen.
29. **G43 — FLOOR 5'S ENTIRE ENCOUNTER LAYER IS UNREACHABLE.** `act-intro` hard-wires the Hollow to
    floor *entry*, and the hub is the only caller of the encounter/chest/rest/lore builders — so the
    True Void has **only the boss**. Measured over ~17.7 million probed transitions: **zero** hub
    states at act 5. **21% of the enemy roster can never be met**, and the `reach-act-5` feat grants
    families that unlock nothing playable. **Fix:** gate the Hollow behind a floor-5 XP threshold like
    acts 1–3, instead of firing it on entry. ⚠ **The threshold is a balance number → feeds #2.**
30. **G42 — the ending prose is erased by the click that follows it.** `narrate()` clears the pane
    *before* checking whether a prompt exists, so a completed run's **last screen is blank**. Third
    instance of the same clear-before-check mechanism as G13 and G21, at a beat neither covers —
    **fix all three together.** *(Surfaced by round 11B's player-sequence traversal, which found it
    below the bar for its own territory because it is not a document contradiction.)*

> **Not in this unit: G41** — dev tooling (`scripts/desktop-dev.mjs`), blocks nothing, and cannot
> affect a packaged build. **Fix it early anyway:** it orphans the Vite server on quit, so every
> `npm run desktop` after the first silently serves **stale code from the previous session**. Any
> play-test that follows a quit is testing the wrong build, and the terminal error looks unrelated.
>
> **Not in this unit: G37 and the escalated G6** — both are **packaging** defects and belong to
> **#14**. G37: `ensureNarrator` is not promise-memoized, so first run starts **two concurrent 2.5 GB
> downloads**. G6: the log directory resolves **inside the asar**, so every log call in a shipped
> build is a silent no-op and the game ships with **no crash diagnostics at all**.

> **⚠ TOO BIG FOR ONE PIPELINE UNIT.** Decomposition into three units, with **one** scheduling rule:
>
> ### **`#0a` runs independently. `#0b` and `#0c` must run SERIALLY.**
>
> The cross-unit overlap is **`src/desktop/game.ts`**, which **#0b** and **#0c** both need: **G26**'s
> fix spans `llm/narrate.ts` (#0b) and `desktop/game.ts:202` (#0c), and **G42**'s fix is in
> `narrate()` in that same file. Under `SKILL.md` §1b — *never parallelize units whose plans touch the
> same source file* — that one pairing is barred. **#0a shares no file with either** and can run
> alongside whichever of them is active.
>
> > **⚠ Correction, 2026-08-28.** This block previously said all three must serialise, and gave two
> > reasons, one of which was **false**: *"G27 touches `game.ts`'s rest path alongside #0a's condition
> > work."* G27's target is `resolveRestDecision` in **`src/game/game.ts`** — which is **#0a's own
> > file**. #0c's is the *different* **`src/desktop/game.ts`**. Conflating the two invented a conflict
> > that does not exist, and the same block simultaneously claimed "#0a and #0c must not run
> > concurrently" **and** "#0b can run alongside either heavy one" — three mutually incompatible
> > statements in 25 lines. The corrected rule bars exactly one pairing, and it is **#0b–#0c**, the
> > one the old text said was safe.
>
> | Unit | Covers | Principal files |
> |---|---|---|
> | **#0a `combat-core-fixes`** | G4, G11, G11b, G12, G16, G17, G20, G22, G23, G24, G25, G27, G28(d), G29, G30, G31, G32, G34, G35, G36, G39, **G43** | `equipment.ts`, `skill.ts`, `statEffects.ts`, `relicEffects.ts`, `deal.ts`, `battle.ts`, `combat.ts`, `encounter.ts`, `condition.ts`, `src/game/game.ts` (rest path), `data/items.json` |
> | **#0b `narration-coverage`** | G13, G21, **G42** | `llm/narrate.ts`, `data/story.json`, `desktop/game.ts` (the `narrate()` clear-before-check) |
> | **#0c `persistence-and-reach`** | G1/G19, G3, G14, G18, G26, G28, G33, G40, **C7** | `persist.ts`, `desktop/game.ts`, `desktop.html`, `render/format.ts`, `render/components.ts`, `loot.ts`, `unlockStore.ts`, `view-model.ts`, `scripts/balance-report.ts` |

> **`G2` is deliberately in no unit** — *"winning leaves a resumable save"* still has **no fix
> specified**, so it cannot be scheduled yet. It sits in the same territory as #0c (the save
> envelope) and should be folded in **once a fix is designed**; until then its `BLOCKS` cell is `—`,
> because a bug nobody is fixing cannot block the unit that is not fixing it.
>
> **Scheduling, restated once so there is a single source:** `#0a` is independent. `#0b` and `#0c`
> are the barred pairing (G26 spans their files). So run **`#0a` + `#0b`**, then `#0c`; or `#0a` +
> `#0c`, then `#0b`. Never `#0b` + `#0c` together.

> **⚠ G15 is deliberately NOT in this unit — it needs an author decision first.** Half the karma
> model never fires, and the axis the final reckoning weights most heavily (`reverenceDesecration`,
> weight 3) can only ever move toward CAST-DOWN, never toward GRACE. Whether to wire the missing
> positive actions or re-weight onto the axes that work is a **design call**, not a bug fix.

> **⚠ This unit invalidates the M15 balance report.** The sim's scope note assumed loot was merely
> *unequipped by policy*; G11 means it was *un-equippable in principle*, so the "lower bound" framing
> is wrong. **The balance re-run in #2 is now mandatory, not optional.**
>
> **⚠ And a SECOND, independent reason — G32.** `proficiency` was dead state, so the whole balance
> pass was tuned against a to-hit baseline ~10 percentage points below the intended model. **The
> author ruled 2026-08-30 to wire it**, which changes the difficulty again. #2 must re-sim for both
> reasons, and neither one alone is sufficient.

---

## The work

### Tier 1 — engine, before any UI

**#1 `engine-foundations`** — one pipeline unit, **ten** changes, all cheap now and expensive later:
1. **Equip/unequip become `step` inputs.** Restores reproducibility from `seed + inputs`.
2. **`description` + `flavour` on every content schema.** Blocks *all* content authoring today.
3. **The floor-mechanic hook** — fire the existing relic trigger pipeline with a per-floor effect
   list from data. **Must be DIRECTION-AWARE** (the Hollow ascent runs 5→1).
4. **Floor-4 karma counts double** in the verdict. No new state.
5. **Rename conditions** to the design vocabulary (§14.4). Needs a `SAVE_VERSION` bump + migration.
6. **Redefine Quick/Slow** as the **tempo gauge** (§16.1) — `initiativeOrderTwist` is a dead no-op.
7. **Rework the level-up draft** (§19.5) — remove `stat` from `draft.ts` `CATEGORY_WEIGHTS`, add the
   **per-level stat allowance**, and add a **level cap of 20** (none exists in `src/` today).
8. **Decide `jsdom` vs `node`** as the test environment — once, here, or three UI units each invent
   their own override.
9. **Enemy XP derives from the ENEMY** (§19.2) — `enemy.ts:117` still rolls it from `playerXp`, which
   is a feedback loop *and* makes a hard kill worth no more than a trivial one. **This was decided and
   appeared in no work plan until now.**
10. **Migrate `EQUIP_SLOTS` 9 → 7** (`item.ts:49`) — to head, body, hand ×2, feet, **trinket ×2**
    (§14.7). Drop `amulet`, `legs`, `ring`, `ammo`; **add the `trinket` slot kind**, without which the
    decided "relics occupy the two trinket slots" rule is *unimplementable*. Needs a `SAVE_VERSION`
    bump — **share the migration with change 5.** **This was decided, flagged in `ROADMAP.md` and
    `HUMAN-CHECKS.md` as needing a migration, and appeared in no work plan until now.** It silently
    blocks **#6** and **#8**, which both draw a paperdoll against this slot list.

**#2 `floor-mechanics` + balance re-run** — all five floors per `GAME-DESIGN.md` §8. Floor 2's
illusions matter most: they are the **only trigger for the clarity↔delusion karma axis**, which
currently can never move. Then re-run the sim, because `BALANCE-REPORT.md`'s 32.9% is measured on a
character that never equips found loot.

### Art

**#3 `art-pipeline`** — batch mode (50% cost), corner-pixel gate against white backgrounds
(1-in-3 failure across two probes), reference-image conditioning, alpha keying to PNG. Tooling only;
never in the game bundle, never touched by a test.

**#4 probe 04 + approve references** — probe 03 predates `WORLD.md` and is partly wrong. Re-probe
against the finished world, approve one image as the style anchor. **Also rotate the API key.**

**#5 five gated batches** — environments (7) → characters (5) → enemies (**30**) → bosses (8) →
**item icons (~68, `ART-BIBLE.md` §13)**.
**Game assets:** 50 buildable now (150 images ≈ $10.05 batched); 52 once Ash-Wretch and the Warden
executioner exist in code. **Item icons:** ~68 more (204 images ≈ $13.67). **Total ≈ 118 assets /
354 images / ~$23.72 batched.** **No interface batch** — the austere typographic UI is
the Memorians' file on you.

### UI

**#6 `battle-screen`** · **#7 `canvas-layer`** · **#8 `screens-restyle`** — per `UI-DESIGN.md`.
**#6 also needs two things recorded elsewhere:** **audio hooks on every beat** (`ART-BIBLE.md` §10 —
marked BLOCKING; free now, a rewrite after) and **a free-text input** for talking to bosses (§20).
#6 must not start before #2: building on a battle loop with no floor-modifier hook is the most
expensive mistake available.

### Tier 2 — systems that exist but do nothing

**#9 content reachability** — 19 consumables, 4 uniques and 14 of 15 relics have **no acquisition
path in a real run.** Built, tested, unreachable. Also: 2 of 5 affixes can never unlock; the unlock
store accumulates things the run never reads; the feat list is a seed.

**#10 karma mid-run** — karma is written, carried, and read **once**, at the floor-4 gate. It never
bends the world, never reaches the LLM prompt, is never clamped, and its cross-run memory is written
and never read.

**#11 finish M12** — there are **four** combat bosses, not five (floor 4's executioner does not
exist), and **no boss is an agent**, which was M12's entire premise.

**#12 narrator to spec (reduced M11)** — grammar-constrained choices, the tool registry and
free-text mapping are **dropped**. What remains: the persona rewrite (the narrator *is* the
condition, caused by extraction), per-floor voices, zone prompt files, beat significance, karma in
the prompt, boss agents. Note the persona string is **duplicated** in `src/llm/narrate.ts` and
`electron/llm.mjs`, and the latter has no test.

### Tier 3 — authoring and shipping

**#13 content authoring** — the entire player-facing surface, and the largest single body of work
left. Joke weapon names that are the shipped starting gear, every drop named "Legendary mainHand", a
lore file reading *"this is a lore this is a lore"*, ten empty prose bodies on the live path, two
one-sentence endings, placeholder boss names, and no descriptions anywhere. **Only the author can do
this.** **Blocked on #1 and on author rounds A8 AND A9** — A8 settles the endings' voice and whether
the player has a name (you cannot write the endings before that); A9 settles whether `insanity` can
be named at all, which decides a condition name, a skill name and an item name.
**Also carries all EIGHT content defects, C1–C8:** the two reserved words used casually in shipped
strings · the class picker giving away the concealed fact · the intro sending you to the wrong place ·
the narrator never being told which floor it is on · **the line that makes the floor-4 angels a
hallucination** · two different items both named "Clarity Draught" · the combat log printing raw
condition ids · and four smaller text defects (a typo, one string filling 43% of the insanity table,
and "The Husk Husk" as a reachable generated name).

**#14 package and ship** — `electron-builder.json` is an N1 stub; the first-run model download needs
a real failure path; **licensing is entirely absent and blocks any public release**; app icon,
splash and installer art are on no list; `itch-description.html` is wrong about nearly everything.
**Blocked on author rounds A7 and A8** — both land in text that ships.

> **⚠ #14 also carries TWO severe packaging defects that no other unit covers:**
> - **G37 — first run starts TWO concurrent 2.5 GB model downloads.** `ensureNarrator` assigns only
>   after its await, so boot and the first generate both see `null`. Measured: 2 calls where 1 is
>   expected. Two writers race into the same file, plus a second `loadModel` (VRAM OOM on min spec).
> - **G6 (escalated) — the shipped game has NO crash diagnostics.** The log dir resolves inside the
>   asar, `mkdirSync` throws, the stream nulls, and every log call becomes a **silent no-op** — while
>   the app still prints "logging to &lt;path&gt;". It works in dev only because `__dirname` is the real
>   repo folder, which is why it survived nine audit rounds.

---

## Interview status

**22 rounds asked; 20 fully done, 2 partial** (2026-08-25 → 27). **A1** (potion fold-in) and **B4b**
(boss-talk concession cap) are `DONE (partial)` — the design doc explicitly flags both for the author.
See `FINDINGS.md` A1b and B4c. The queue and the full record are in
**`docs/INTERVIEW-PLAN.md`**; every answer is written into an authoritative document.

| Area | State |
|---|---|
| Lore / world | ⚠ Six rounds + the Hollow ascent (`WORLD.md`), **but A8 is OPEN** — the endings' voice and the player's name |
| Scope / Tier 1 | ✅ All seven decided |
| Floor mechanics | ✅ All five, and **bidirectional** |
| Visual & audio | ✅ Art direction, typeface, ship assets, and the **thinning score** |
| Design / Tier 2 | ⚠ Loot, progression, conditions, elements, class kits — **but A7 is OPEN** on karma inputs and verdict weighting |
| Bosses & talk | ✅ Identities, boss agents, and **talking to bosses** in free text |
| Release | ✅ Licence, free on itch, no telemetry, store page, first run, playtest |

**⚠ THREE AUTHOR ROUNDS ARE STILL OPEN** — this heading read *"What is left is NOT interviews"* until
2026-08-28, which was false the moment A7 and A8 were queued:

| | Question | Blocks |
|---|---|---|
| **A7** | **Karma inputs & verdict weighting** — half the model never fires, and the heaviest verdict axis can only move toward CAST-DOWN | **#2 #14** |
| **A8** | **The endings' voice, and whether the player has a name** — the locked rule is second-person-only; the shipped anchors are third person and name you | **#13 #14** |
| **A9** | **Is a nameable sanity mechanic allowed?** — §13 says the player must be *"unable to point at the sanity mechanic, because there isn't one"*; §21.1, the later ruling, canonises `insanity`, and the game ships a chip, a skill called Maddening Gaze, and a draught that cures it. **Two `DECIDED` rulings that cannot both hold** | **#1 #13** |
| **A1b** | The potion fold-in | #2 |
| **B4c** | The boss-talk concession cap | #6 #11 #12 |

> **⚠ This "looks handled" failure has now happened THREE times in four days** — A8 (2026-08-28) and
> A9 (2026-08-30) were each queued in `FINDINGS.md` and `INTERVIEW-PLAN.md` and **nowhere else**, so
> the work plan a builder reads did not know they existed. **When a new author row is queued, add it
> to this table and to every item it blocks, in the same turn.**
>
> *A9's `BLOCKS` was also initially written as `#0a`, which would have deadlocked the next unit. It is
> `#1 #13`: the ruling changes a condition **name**, which is `#1`'s rename change and `#13`'s prose —
> not `#0a`, which fixes mechanics and touches no display strings.*

**Everything else left is NOT interviews.** Per `docs/FINDINGS.md`: three **verifications** (the
generated-asset licence is the one that can block release), two **balance numbers** for the re-run,
one **parked** (localisation), **forty bugs** (G1–G43; **there is no G38**; counted by script)
— **thirty-eight with fixes specified; `G2` has none and `G15` needs an AUTHOR RULING** — and **eight
content defects** (C1–C8) for #13. **`G32` was ruled on 2026-08-30 —
wire `proficiency`, then re-run the balance sim.** *(This line has been wrong four times. **Recount
before quoting it.**)*

### Newer work items not in the dependency graph above

| # | Item |
|---|---|
| **#15** | The audio layer — effects, ambient beds, and the thinning score (Lyria is on the same key) |
| **#16** | Bundle **JetBrains Mono**, re-check the type scale against a real face |
| **#17** | Ship assets — app icon, title art, store art, cursors |
| **#18** | **The Hollow ascent campaign** — 5→1, ends at the Undercity threshold |

> **Still true and worth repeating:** three bugs **silently destroy player data** (quitting mid-run
> voids all unlock progress; winning leaves a resumable save; a corrupt unlock store wipes
> everything). **G1's fix landed with G19 (pass 6A found the root cause) and G3's is decided — only
> G2 still needs one designed.** The code
> has not changed at all.
