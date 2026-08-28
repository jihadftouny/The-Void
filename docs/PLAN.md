# The Void — Work Plan

_The live plan: what is left to build, in what order, and what blocks what. Derived from
`docs/SCOPE-AUDIT.md` (the evidence) and the 2026-08-25/26 scope interviews (the decisions)._

**Precedence:** this file says *what to do next*. It never overrides `docs/GAME-DESIGN.md`,
`docs/WORLD.md` or `docs/ART-BIBLE.md` on *what the thing is* — see `docs/README.md`.

---

## Dependency order

```
  #1 engine-foundations ─┬─> #2 floor-mechanics ─┬─> #6 battle-screen ─┬─> #7 canvas-layer
                         │   (+ balance re-run)  │                     └─> #8 screens-restyle
                         └─> #13 content authoring
  #3 art-pipeline ───────┬─> #5 art batches (5, gated) ──> #7 canvas-layer
  #4 probe 04 + approve ─┘
  #9 #10 #11 #12 #14 — independent, sequenced by judgement
```

**Unblocked right now: #1, #3, #4.**

---

## The work

### Tier 1 — engine, before any UI

**#1 `engine-foundations`** — one pipeline unit, **nine** changes, all cheap now and expensive later:
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
this.** Blocked on #1.

**#14 package and ship** — `electron-builder.json` is an N1 stub; the first-run model download needs
a real failure path; **licensing is entirely absent and blocks any public release**; app icon,
splash and installer art are on no list; `itch-description.html` is wrong about nearly everything.

---

## Interview status

**22 rounds asked; 20 fully done, 2 partial** (2026-08-25 → 27). **A1** (potion fold-in) and **B4b**
(boss-talk concession cap) are `DONE (partial)` — the design doc explicitly flags both for the author.
See `FINDINGS.md` A1b and B4c. The queue and the full record are in
**`docs/INTERVIEW-PLAN.md`**; every answer is written into an authoritative document.

| Area | State |
|---|---|
| Lore / world | ✅ Six rounds + the Hollow ascent. `WORLD.md` |
| Scope / Tier 1 | ✅ All seven decided |
| Floor mechanics | ✅ All five, and **bidirectional** |
| Visual & audio | ✅ Art direction, typeface, ship assets, and the **thinning score** |
| Design / Tier 2 | ✅ Loot, karma, progression, conditions, elements, class kits |
| Bosses & talk | ✅ Identities, boss agents, and **talking to bosses** in free text |
| Release | ✅ Licence, free on itch, no telemetry, store page, first run, playtest |

**What is left is NOT interviews.** Per `docs/FINDINGS.md`: three **verifications** (the
generated-asset licence is the one that can block release), two **balance numbers** for the re-run,
one **parked** (localisation), and eight **bugs** — **six with fixes specified; G1 and G2 have none yet.**

### Newer work items not in the dependency graph above

| # | Item |
|---|---|
| **#15** | The audio layer — effects, ambient beds, and the thinning score (Lyria is on the same key) |
| **#16** | Bundle **JetBrains Mono**, re-check the type scale against a real face |
| **#17** | Ship assets — app icon, title art, store art, cursors |
| **#18** | **The Hollow ascent campaign** — 5→1, ends at the Undercity threshold |

> **Still true and worth repeating:** three bugs **silently destroy player data** (quitting mid-run
> voids all unlock progress; winning leaves a resumable save; a corrupt unlock store wipes
> everything). **Only the third has a specified fix — G1 and G2 still need one designed.** The code
> has not changed at all.
