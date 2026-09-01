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
  #9 content-reachability ─> #2  (⛔ hard prerequisite — §22.6: potions fold into consumables,
                                  and the consumable path is dead until #9 fixes it)
  #3 art-pipeline ───────┬─> #5 art batches (4, gated) ──> #7 canvas-layer
  #4 probe 04 + approve ─┘
  #10 #10a #11 #12 #14 — independent, sequenced by judgement
```

**Unblocked right now: #0, #3, #4, and three-quarters of #10a** (every karma action except
`seeThroughIllusion`, which needs floor-2 illusions and lands inside #2). *(#1 was unblocked until 2026-08-28; **#0 now precedes it**, because
#0 fixes the equip resolution path that #1's change 1 and change 10 both build on top of.)*

---

> **⭐ Shipping order, added 2026-08-31 — `SHIP-SCOPE.md`.** The work below is the *full* plan.
> **`SHIP-SCOPE.md` selects the ≤60 h subset that ships as v1** and cuts the rest to post-launch:
> **in** — #0a/#0b/#0c (24 h), #9 (8 h), #10a (4 h), #13-lite (16 h), #14 (12 h) = **64 h against a
> 60 h cap**; **out** — #2, #3–#8, #10, #11, #12, #15–#18. Read it before picking up any item here,
> so you do not build something the ship scope already cut.

### Tier 0 — the engine is broken in ways the test suite does not see

**#0 `critical-engine-bugs`** — **thirty-three defects** found by discrepancy passes 5B through 15A
and the 2026-08-31 validation audit.
**Every one verified by running the real engine, and every one passing 1029 tests and a clean
typecheck.** Full evidence in `FINDINGS.md` §4
(**G11–G47; there is no G38**). This unit exists because these are not polish; **three of them mean whole shipped systems
do nothing at all.**

1. **G11 — no found item can ever be equipped.** `equipment.ts` resolves by `defId` only, so every
   `gen:*` item from `rarityGen` fails to resolve. Measured: **>100 drops across 300 seeds, zero
   equippable.** The player fights the entire game in starting gear, and the UI shows an Equip button
   that does nothing. **Fix:** `resolveInstanceDef` in `canEquip` + instance-aware slot inference.
2. **G11b — add the test that would have caught it.** Two existing tests *look* like coverage and are
   circular: one never calls `equip()`, the other writes into `inventory.slots` directly. **The new
   test must call `equip()` on a real `generateItem` output** (`PRINCIPLES.md` §A3).
3. **G13 — ELEVEN event kinds have no `describeEvent` case, including the player's own skill casts.**
   ⚠ **Corrected 2026-08-31 (pass 15A): this said "four major beats… the five cases", and both the
   count and the headline symptom were wrong.** Blank narration is the *minority* case. Measured over
   400 runs / 170,491 steps: **5,727 steps contain a player `skill-cast`, and 100% reach the model
   with no fact that the player acted** — only 512 go blank, while **5,215 produce narration that
   misattributes the beat**, and in **1,395** the only skill named is the **enemy's** identically-named
   one. Also uncased: `boss-minion-damage` (346 steps where the player loses HP and nothing says so),
   `lifesteal`, `self-sacrifice`, `boss-summon`, `boss-adapt`, plus the original five
   (`boss-encounter`, `verdict`, `spared`, `draft-picked`, `draft-offer`). **Fix:** add every case
   **and** land the `const _never: never = e` exhaustiveness check — that check is what stops this
   enumeration going stale a third time.
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
30. **G45 — `step` throws on a non-integer `draft-pick` index**, breaking its own documented totality
    contract. `1.5`/`0.5`/`2.5`/`NaN` all pass the bounds guard and dereference `undefined`. No
    current caller produces it, so it is a contract violation through the API, not a live bug — but
    the sibling consumable path is already safe against the identical inputs. **Fix:** add
    `Number.isInteger`.
31. **G42 — the ending prose is erased by the click that follows it.** `narrate()` clears the pane
    *before* checking whether a prompt exists, so a completed run's **last screen is blank**. Third
    instance of the same clear-before-check mechanism as G13 and G21, at a beat neither covers —
    **fix all three together.** *(Surfaced by round 11B's player-sequence traversal, which found it
    below the bar for its own territory because it is not a document contradiction.)*
32. **G46 — the engine stamps second-person text on ENEMY events.** The enemy's bleed onset reads
    *"Your skin is ruptured!"* — `condition.ts` pushes subject-agnostic second-person `text` and
    `format.ts` prefers it over its own correct subject-aware template. Latent behind G18. *(→ #0c.
    Reached the coverage cells 2026-08-30 and this list only on 2026-08-31 — the fourth
    cells-vs-prose drift.)*
33. **G47 — the narrator speaks the player's NAME.** `narrate.ts:28` ships *"You are ${e.name}…"*
    into the opening prompt and the first five story beats — an **engine-side** break of §22.1's
    voice ruling that #13 can never fix, because it is not authored text. *(→ #0b. Three tests
    assert the token exists and change with the fix.)*

> **Not in this unit: G41** — dev tooling (`scripts/desktop-dev.mjs`), blocks nothing, and cannot
> affect a packaged build. **Fix it early anyway:** it orphans the Vite server on quit, so every
> `npm run desktop` after the first silently serves **stale code from the previous session**. Any
> play-test that follows a quit is testing the wrong build, and the terminal error looks unrelated.
>
> **Not in this unit: G44, G37 and the escalated G6** — all three are **packaging** defects and
> belong to **#14**. **G44 was the register's only `⛔⛔ blocks shipping` row: `npm run desktop:pack`
> ~~has never once succeeded~~ — **✅ FIXED 2026-08-31 (§22.12); the config now validates.** See
> #14 below. *(This note said "both" and omitted G44 until
> 2026-08-30, which left #0's exclusion ledger short by one: 35 ids exist in the G11–G45 range, the
> numbered list holds 31, and three of the four excluded ids had an explicit note while the most
> severe one had none.)* G37: `ensureNarrator` is not promise-memoized, so first run starts **two concurrent 2.5 GB
> downloads**. G6: the log directory resolves **inside the asar**, so every log call in a shipped
> build is a silent no-op and the game ships with **no crash diagnostics at all**.

> **⚠ TOO BIG FOR ONE PIPELINE UNIT.** Decomposition into three units, with **one** scheduling rule:
>
> ### **`#0a` runs independently. `#0b` and `#0c` must run SERIALLY.**
>
> The cross-unit overlap is **`src/desktop/game.ts`**, which **#0b** and **#0c** both need: **G26**'s
> fix spans `llm/narrate.ts` (#0b) and `desktop/game.ts:202` (#0c), and **G42**'s fix is in
> `narrate()` in that same file. Under `SKILL.md` §1b — *never parallelize units whose plans touch the
> same source file* — that one pairing is barred. ~~**#0a shares no file with either**~~ ⚠ **wrong — corrected 2026-09-01 by #0a's plan-agent: `condition.ts` is #0a's principal file, and G46 (routed to #0c) specifies edits at `condition.ts:311/374/508`.** It is still safe, for a different reason: **#0c has not branched, and forks from `main` *after* #0a merges**, so it inherits the changed file instead of racing it. #0a owns `condition.ts`; G23 was implemented above the `switch` so those three lines stay untouched and #0c's later diff stays small. #0a can run
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
> | **#0a `combat-core-fixes`** | G4, G11, G11b, G12, G16, G17, G20, G22, G23, G24, G25, G27, G28(d), G29, G30, G31, G32, G34, G35, G36, G39, G43, **G45** | `equipment.ts`, `skill.ts`, `statEffects.ts`, `relicEffects.ts`, `deal.ts`, `battle.ts`, `combat.ts`, `encounter.ts`, `condition.ts`, `src/game/game.ts` (rest path), `data/items.json` |
> | **#0b `narration-coverage`** | G13, G21, G42, **G47** | `llm/narrate.ts`, `data/story.json`, `desktop/game.ts` (the `narrate()` clear-before-check) |
> | **#0c `persistence-and-reach`** | G1/G19, **G2**, G3, G14, G18, G26, G28, G33, G40, C7, G46 | `persist.ts`, `desktop/game.ts`, `desktop.html`, `render/format.ts`, `render/components.ts`, `loot.ts`, `unlockStore.ts`, `view-model.ts`, `scripts/balance-report.ts` |

> ~~`G2` is deliberately in no unit — no fix specified~~ **✅ Fix designed 2026-08-31 (§22.15) and
> G2 now rides in #0c**: every terminal state — grace, damnation, death — clears the run save, and
> G10's narrator-written run summary extends to victories. A finished run's record is its summary,
> not a reloadable state.
>
> **Scheduling, restated once so there is a single source:** `#0a` is independent. `#0b` and `#0c`
> are the barred pairing (G26 spans their files). So run **`#0a` + `#0b`**, then `#0c`; or `#0a` +
> `#0c`, then `#0b`. Never `#0b` + `#0c` together.

> **✅ G15 was RULED on 2026-08-31 (§22.5): WIRE the four missing karma actions.** It is still not
> in *this* unit — it is now **build work in its own right** (see #10a below), not a bug fix.
> ~~⚠ G15 is deliberately NOT in this unit — it needs an author decision first. Half the karma
> model never fires, and the axis the final reckoning weights most heavily (`reverenceDesecration`,
> weight 3) can only ever move toward CAST-DOWN, never toward GRACE. Whether to wire the missing
> positive actions or re-weight onto the axes that work is a design call, not a bug fix.~~
> *(The whole question above is answered — §22.5 chose WIRE, rejecting re-weighting.)*

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

**#1 `engine-foundations`** — one pipeline unit, **eleven** changes, all cheap now and expensive later:
1. **Equip/unequip become `step` inputs.** Restores reproducibility from `seed + inputs`.
2. **`description` + `flavour` on every content schema.** Blocks *all* content authoring today.
3. **The floor-mechanic hook** — fire the existing relic trigger pipeline with a per-floor effect
   list from data. **Must be DIRECTION-AWARE** (the Hollow ascent runs 5→1).
4. **Floor-4 karma counts double** in the verdict. No new state.
5. **Rename conditions** to the design vocabulary (§14.4). Needs a `SAVE_VERSION` bump + migration.
   ~~⚠ The §22.3 half (renaming `insanity`) CANNOT START: the replacement name is still
   undecided.~~ **✅ DECIDED (second sitting, §22.13): `insanity` becomes `Static`.** Blast radius: ~60 occurrences — the id, `CONDITION_DATA`,
   `CONTROL_CONDITIONS`, the tick switch, **14 player-facing `INSANITY_STRINGS`**, **six skills**
   (`mindSpike`, `corrupt`, `warpMind`, `sinfulWhisper`, `maddeningGaze`, `echoedHex`),
   `classKit.ts` `MENTAL_CONDITIONS`, three data files, ~12 tests. The §14.4 half can proceed.
   ⚠ **This is TWO renames, not one** (added 2026-08-31): §14.4 aligns the six stat pairs
   (`healthy/sick` → `Hardy/Frail` etc.), **and §22.3 separately renames `insanity`** so the
   psychosis theme stays unpointable. **A builder doing only §14.4 leaves `insanity` shipping.**
   The skill **"Maddening Gaze"** and the **"Clarity Draught"** follow the same ruling (→ #13).
6. **Redefine Quick/Slow** as the **tempo gauge** (§16.1) — `initiativeOrderTwist` is a dead no-op.
7. **Rework the level-up draft** (§19.5) — remove `stat` from `draft.ts` `CATEGORY_WEIGHTS`, add the
   **per-level stat allowance**, and add a **level cap of 20** (none exists in `src/` today).
8. ~~Decide~~ **✅ DECIDED (§22.18): `node` default, per-file `jsdom` opt-in.** The suite stays in
   `node` — fastest, and it proves the no-DOM-in-`src/game` rule by construction; #6/#7/#8 opt
   into `jsdom` per test file with a one-line directive. Write the directive convention down here
   so three UI units inherit one decision instead of inventing overrides.
9. **Enemy XP derives from the ENEMY** (§19.2) — `enemy.ts:117` still rolls it from `playerXp`, which
   is a feedback loop *and* makes a hard kill worth no more than a trivial one. **This was decided and
   appeared in no work plan until now.**
10. **Migrate `EQUIP_SLOTS` 9 → 7** (`item.ts:49`) — to head, body, hand ×2, feet, **trinket ×2**
    (§14.7). Drop `amulet`, `legs`, `ring`, `ammo`; **add the `trinket` slot kind**, without which the
    decided "relics occupy the two trinket slots" rule is *unimplementable*. Needs a `SAVE_VERSION`
    bump — **share the migration with change 5.** **This was decided, flagged in `ROADMAP.md` and
    `HUMAN-CHECKS.md` as needing a migration, and appeared in no work plan until now.** It silently
    blocks **#6** and **#8**, which both render this slot list (as **text**, §22.9 — ~~a paperdoll~~).
11. **Persist and surface the run SEED** (G8, §19.3 — *"shown, stored and enterable"*). The seed
    is wall-clock today, never stored, never shown; storing it is engine work and belongs here;
    the display half rides with #8. *(G8 carried `BLOCKS #1` while #1 contained no seed work —
    added 2026-08-31, making #1 **eleven** changes.)*

**#2 `floor-mechanics` + balance re-run** — ⛔ **#9 IS NOW A HARD PREREQUISITE.** §22.6 folds potions
into consumables, and the consumable picker is **unreachable** until #9 fixes catalog-item
resolution (G14). **If #2 lands first, the game ships with no in-battle healing at all.** #9 is
~~listed in the "sequenced by judgement" bucket above~~ *(the diagram now shows the #9 → #2 edge)*.

**#2 covers** all five floors per `GAME-DESIGN.md` §8, **and the verdict re-tune now has its
stance (§22.16): grace is GENEROUS — any net-positive weighted ledger earns it.** Backpack **N =
12** is the starting value (§22.17). Floor 2's
illusions matter most: they are the **only trigger for the clarity↔delusion karma axis**, which
currently can never move. Then re-run the sim, because `BALANCE-REPORT.md`'s 32.9% is measured on a
character that never equips found loot.

### Art

**#3 `art-pipeline`** — batch mode (50% cost), corner-pixel gate against white backgrounds
(1-in-3 failure across two probes), reference-image conditioning, alpha keying to PNG. Tooling only;
never in the game bundle, never touched by a test.

**#4 probe 04 + approve references** — probe 03 predates `WORLD.md` and is partly wrong. Re-probe
against the finished world, approve one image as the style anchor. ~~**Also rotate the API key.**~~
**✅ AUDITED 2026-09-01 — the key was NEVER committed.** Full-history scan of **all 306 commits
across every ref**: zero occurrences of a Google API-key pattern. `.env` is gitignored
(`.gitignore:10`) and untracked; the only `.env`-family file ever committed is `.env.example`, a
placeholder template added by `687ecf5` — the commit that put the guard in place. **So the
irreversible risk — a key baked into git history, which survives deletion and any later
`.gitignore`** — does not exist here. Rotation is now **precautionary, not mandatory**: worth doing
if the key was ever pasted into a terminal, a log, or a chat window outside this repo, since the
audit can only clear the repository. Not a release blocker.

**#5 FOUR gated batches** — environments (7) → characters (5) → enemies (**30**) → bosses (8).
*(Was five. The fifth was ~~item icons~~ — **CANCELLED 2026-08-31**, `GAME-DESIGN.md` §22.8: the
inventory is text-based, so no item art is generated at all.)*
**Game assets:** 50 buildable now (150 images ≈ $10.05 batched); 52 once Ash-Wretch and the Warden
executioner exist in code. ~~**Item icons:** ~68 more (204 images ≈ $13.67).~~ **⚠ ICONS CANCELLED
2026-08-31** (`GAME-DESIGN.md` §22.8) — the inventory is text-based, so the 50/52 game assets are the
whole batch. **The live total: 50 assets / 150 images / ~$10.05 buildable now; 52 / 156 / ~$10.45
once Ash-Wretch and the Warden executioner exist in code.**
*(Cancelled, struck — and this strike is now actually closed; two prior attempts left the marker
unterminated, so the dead figures rendered live twice:)* ~~Total ~118 assets / 354 images /
~$23.72 batched.~~
**No interface batch** — the austere typographic UI is the Memorians' file on you.

### UI

**#6 `battle-screen`** · **#7 `canvas-layer`** · **#8 `screens-restyle`** — per `UI-DESIGN.md`.
**#6 also needs two things recorded elsewhere:** **audio hooks on every beat** (`ART-BIBLE.md` §10 —
marked BLOCKING; free now, a rewrite after) and **a free-text input** for talking to bosses (§20).
#6 must not start before #2: building on a battle loop with no floor-modifier hook is the most
expensive mistake available.

> **⚠ THE CODEX IS CUT — `[DECIDED 2026-08-31]`, `GAME-DESIGN.md` §22.11.** Tooltips at the point of
> use carry the load instead. This removes a screen, a net-new persistent store, and an ongoing
> authoring obligation. **Accepted cost:** the player cannot look up a thing they met two floors ago.
> `UI-DESIGN.md` §14 and `GAME-DESIGN.md` §21.6 are superseded on this point. *(Historical note: it
> was `[DECIDED]` twice and named in no work item until 2026-08-31.)*
>
> ~~⚠ #8 also carries the CODEX, which was `[DECIDED]` twice and named in no work item until
> 2026-08-31. `UI-DESIGN.md` §14 commits to "tooltips on everything + a codex that fills in as
> you go" and flags it as "net-new state, not a reuse"; `GAME-DESIGN.md` §21.6 decides its
> content split. Net-new persistent state plus a screen is not a footnote to a restyle; scope it
> explicitly or split it out.~~
> *(The scoping question above is mooted — the codex is cut. Kept struck for the history: it was
> the sixth propagation failure of its kind, surfaced by round 14B.)*

### Tier 2 — systems that exist but do nothing

**#9 content reachability** — 19 consumables, 4 uniques and 14 of 15 relics have **no acquisition
path in a real run.** Built, tested, unreachable. Also: 2 of 5 affixes can never unlock; the unlock
store accumulates things the run never reads; the feat list is a seed.

**#10 karma mid-run** — karma is written, carried, and read **once**, at the floor-4 gate. It never
bends the world, never reaches the LLM prompt, is never clamped, and its cross-run memory is written
and never read.
**Also #10's: DELETE `karmaMemory`/`RunMemory` (§22.14, second sitting)** — the field, the per-run
write, and its store space; it feeds nothing and its only named consumer is forbidden. The stale
`unlockStore.ts` comment dies with the field, which also closes #12's comment-fix bullet.

> **✅ RULED 2026-08-31 (A10, `GAME-DESIGN.md` §22.4) — DO NOT BUILD THE CROSS-RUN HALF AT ALL.**
> `WORLD.md` §12 `[LOCKED]` wins: **the narrator never references a previous run.** ~~`karmaMemory`
> stays written-and-unconsumed on purpose, feeding unlocks only~~ *(superseded twice: it feeds
> **nothing** — the unlock path reads `RunSummary` — and the second sitting ruled it **DELETED**,
> §22.14)*. **The rest of #10 — karma
> bending the world, reaching the prompt, being clamped — is unaffected and should proceed.**
>
> *(Was "BLOCKED ON AUTHOR ROUND A10 — do not build it yet." The round is answered; the answer is
> not "wait", it is "never".)*
>
> ~~⚠ THE CROSS-RUN MEMORY HALF IS BLOCKED ON AUTHOR ROUND A10.~~
> `WORLD.md` §12 `[LOCKED]` says *"**the narration never acknowledges a previous one** … do not
> invent a diegetic justification for it later."* `GAME-DESIGN.md` §7 says the memory *"lets the
> narrator faintly reference who you were before."* **Wiring this item as written would break a
> locked fiction rule** — the only reason it is not already broken is that the wiring is unfinished.
> The rest of #10 (karma bending the world, reaching the prompt, being clamped) is unaffected and
> can proceed. See `FINDINGS.md` **A10**.

**#10a wire the four missing karma actions** — ✅ **ruled 2026-08-31 (§22.5)**, and previously in no
work item at all. `leaveOffering`, `honorDead`, `embraceWhisper` and `seeThroughIllusion` are
declared in `karma.ts` and called from nowhere. Until they are wired: **`reverenceDesecration` can
only ever go negative** while carrying the heaviest weight in the verdict, **`clarityDelusion` is
permanently 0** so "The Delusion" can never be the act-3 boss, and **the entire grace deal pool is
dead** — taking `mirror-shard`, the only hard-coded item on any *acquisition* path, with it.
⚠ **`seeThroughIllusion` needs floor 2’s illusions, which do not exist yet** — it lands with #2.
The other three can be wired independently.

**#11 finish M12** — there are **four** combat bosses, not five (floor 4's executioner does not
exist), and **no boss is an agent**, which was M12's entire premise.

**#12 narrator to spec (reduced M11)** — grammar-constrained choices, the tool registry and
free-text mapping are **dropped**. What remains: the persona rewrite (the narrator *is* the
condition, caused by extraction), per-floor voices, zone prompt files, beat significance, karma in
the prompt, boss agents. ~~**Also #12's:** correct the stale comment at `src/game/unlockStore.ts:32`~~
**absorbed by #10 (§22.14): `karmaMemory` is deleted outright, and the stale comment —
*"(the M11 narrator reads it)"* — dies with the field.** Note the persona string is **duplicated** in `src/llm/narrate.ts` and
`electron/llm.mjs`, and the latter has no test.

### Tier 3 — authoring and shipping

**#13 content authoring** — the entire player-facing surface, and the largest single body of work
left. Joke weapon names that are the shipped starting gear, every drop named "Legendary mainHand", a
lore file reading *"this is a lore this is a lore"*, ten empty prose bodies on the live path, two
one-sentence endings, placeholder boss names, and no descriptions anywhere. **Only the author can do
this.** **Blocked on #1.** ~~and on author rounds A8 AND A9~~ **✅ Both were answered 2026-08-31**
(§22.1–22.3) — the rulings are inputs to this item now, not blockers on it. ~~⚠ A9 is not yet
executable: the replacement name for `insanity` is still undecided~~ **✅ the name is `Static`
(§22.13)** — and #13 owes the **"Maddening Gaze" rename** under the same ruling (candidates: *Null
Gaze*, *White-Noise Gaze*).
*(Original blocker note:)* A8 settled the endings' voice and whether the player has a name (you
cannot write the endings before that); A9 settled whether `insanity` can be named at all, which
decides a condition name, a skill name and an item name.
**Also carries all TWELVE content defects, C1–C12:** the two reserved words used casually in shipped
strings · the class picker giving away the concealed fact · the intro sending you to the wrong place ·
the narrator never being told which floor it is on · **the line that makes the floor-4 angels a
hallucination** · two different items both named "Clarity Draught" · the combat log printing raw
condition ids · **the Inventory screen printing raw enum identifiers (`On onHit: dealDamage`) on 41%
of all loot** · **`"You suffer(s) 1 bleed damage."` and buffs described as afflictions in the LIVE
narration facts** · **neither player-facing projector having a single test** · and four smaller text
defects (a typo, one string filling 43% of the insanity table, and "The Husk Husk" as a reachable
generated name). **And per §22.9: author MORE weapons and armour than the current 12 + 12** — the
icon obligation is gone, so item count is no longer an art-budget question; exact counts land here.

**#14 package and ship** — `electron-builder.json` is an N1 stub; the first-run model download needs
a real failure path; **licensing is entirely absent and blocks any public release**; app icon,
splash and installer art are on no list; `itch-description.html` is wrong about nearly everything.
~~Blocked on author rounds A7 and A8~~ **Both answered 2026-08-31** (§22.5, §22.1–22.2) — their
rulings are now *inputs* to the store copy and ending text, not blockers.

> **⚠ #14 carries TWO severe packaging defects that no other unit covers** *(was three — G44 is
> fixed)*:
>
> - ~~G44 — `npm run desktop:pack` HAS NEVER SUCCEEDED.~~ **✅ FIXED 2026-08-31 (§22.12)** — the
>   `$comment` key is deleted and the config validates through to real packaging concerns. **Still
>   owed to #14:** verify a pack **end-to-end** (`directories.output` collides with Vite's `dist`),
>   and the machine needs **Windows Developer Mode** for `winCodeSign` (`HUMAN-CHECKS.md`).
> - **G37 — first run starts TWO concurrent 2.5 GB model downloads.** `ensureNarrator` assigns only
>   after its await, so boot and the first generate both see `null`. Measured: 2 calls where 1 is
>   expected. Two writers race into the same file, plus a second `loadModel` (VRAM OOM on min spec).
> - **G6 (escalated) — the shipped game has NO crash diagnostics.** The log dir resolves inside the
>   asar, `mkdirSync` throws, the stream nulls, and every log call becomes a **silent no-op** — while
>   the app still prints "logging to &lt;path&gt;". It works in dev only because `__dirname` is the real
>   repo folder, which is why it survived nine audit rounds.
>
> **✅ What pass 13A VERIFIED works, so #14 does not need to re-establish it.** *(13A ran from a
> scratch copy with the G44 fix applied; since 2026-08-31 that fix is in the repo itself, so
> everything below now holds for the real tree — up to the Windows Developer-Mode privilege wall
> at `winCodeSign`, see `HUMAN-CHECKS.md`.)*
> - **The production build runs under `file://`** — a real Electron `loadFile('dist/desktop.html')`
>   with the real preload. No CSP or module-loading breakage, CSS applied, `window.void` present,
>   renderer booted. **This path was never exercised before** (`desktop` uses the dev server and
>   `desktop:smoke` skips window creation), so it was pure risk until now.
> - **The packaged `app.asar` is correct** — `files` delivers exactly what is needed, and
>   `asarUnpack` correctly externalises `node-llama-cpp` and all five Windows binary variants.
> - **GPU probe and `getLlama` both work from inside the packaged asar** (`gpu=vulkan`, both devices
>   enumerated). Discrete-GPU pinning survives packaging.
> - **`npm ci --omit=dev` is sound** — the lockfile agrees with `package.json`, and a production
>   install only *removes* dev packages.
>
> ⚠ **DO NOT RE-CHASE:** 13A hit a convincing "the packaged build cannot use the GPU" failure
> (`NoBinaryFoundError`, `gpu=false`, every `ggml-cpu-*.dll` failing with an empty error) and
> **disproved it** — the cause was Windows `MAX_PATH`, with those DLLs at 274–287 characters in a
> scratch directory. The same files at 250 characters load fine, and a real install lands near 175.
> **Not a shipping issue.** Discriminator if it resurfaces: measure the length of the path to
> `@node-llama-cpp/win-x64-vulkan/bins/win-x64-vulkan/ggml-cpu-sapphirerapids.dll`.

---

## Interview status

**All author rounds are answered** (2026-08-25 → **31**; the final six closed by the 2026-08-31
validation round — `GAME-DESIGN.md` §22). ~~20 fully done, 2 partial — A1 and B4b flagged for the
author~~ *(A1b and B4c were both ruled §22.6/§22.7)*. The queue and the full record are in
**`docs/INTERVIEW-PLAN.md`**; every answer is written into an authoritative document.

| Area | State |
|---|---|
| Lore / world | ✅ Six rounds + the Hollow ascent (`WORLD.md`); **A8 answered §22.1–22.2** |
| Scope / Tier 1 | ✅ All seven decided |
| Floor mechanics | ✅ All five, and **bidirectional** |
| Visual & audio | ✅ Art direction, typeface, ship assets, and the **thinning score** |
| Design / Tier 2 | ✅ Loot, progression, conditions, elements, class kits; **A7 answered §22.5** |
| Bosses & talk | ✅ Identities, boss agents, and **talking to bosses** in free text |
| Release | ✅ Licence, free on itch, no telemetry, store page, first run, playtest |

**✅ ALL SIX AUTHOR ROUNDS ARE ANSWERED — 2026-08-31.** Full record, with every rejected
alternative and why, in `GAME-DESIGN.md` **§22**.

| | Question | Ruling | Now blocks |
|---|---|---|---|
| **A7** | Karma inputs & verdict weighting | **WIRE the four missing actions** (§22.5) | → build work, see below |
| **A8** | The endings’ voice, and the player’s name | **Second person, never by name; the name is a LABEL only** (§22.1–22.2) | → **C12**, and an ENGINE fix |
| **A9** | Is a nameable sanity mechanic allowed? | **No — rename `insanity`** (§22.3; the name is **`Static`**, §22.13) | → #1.5 |
| **A10** | May the narrator reference a previous run? | **No, never** (§22.4) | → #10, cross-run half CUT |
| **A1b** | The potion fold-in | **Fold into consumables** (§22.6) | → #2, ⚠ **after #9** |
| **B4c** | The boss-talk concession cap | **One per fight** (§22.7) | → #6 #11 #12 |

> **⚠ This table was left asserting all six were OPEN for one commit after they were answered** —
> the seventh instance of the propagation failure documented immediately below, in the very section
> that documents it. The lesson is not "try harder": **closing a round means editing this table in
> the same turn, not the register alone.**

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
one **parked** (localisation), **41 live bugs** (register: G1–G47, no G38; **all 41 with fixes
specified** — `G2`'s landed at the second sitting, §22.15), **2 author-ruled build items** (G15 → #10a; G32 → #0a), **1
fixed** (G44), and **twelve content defects** (C1–C12) for #13. *(This count has been wrong
repeatedly — **recount by script before quoting it**; the derivation lives in `FINDINGS.md` §4's
banner.)*

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
