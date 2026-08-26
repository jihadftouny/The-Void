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
  #3 art-pipeline ───────┬─> #5 art batches (4, gated) ──> #7 canvas-layer
  #4 probe 04 + approve ─┘
  #9 #10 #11 #12 #14 — independent, sequenced by judgement
```

**Unblocked right now: #1, #3, #4.**

---

## The work

### Tier 1 — engine, before any UI

**#1 `engine-foundations`** — one pipeline unit, four changes, all cheap now and expensive later:
1. **Equip/unequip become `step` inputs.** Restores reproducibility from `seed + inputs`. Today the
   render layer mutates state directly.
2. **`description` + `flavour` on every content schema** (items, skills, conditions, perks).
   Currently blocks *all* content authoring — there is nowhere to put the words.
3. **The floor-mechanic hook** — let the battle loop fire the existing relic effect/trigger pipeline
   with a per-floor effect list from data.
4. **Floor-4 karma counts double** in `computeVerdict`. No new state.

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

**#5 four gated batches** — environments (7) → characters (5) → enemies (32) → bosses (9).
53 assets × 3 ≈ 159 images ≈ $10.65 batched. **No interface batch** — the austere typographic UI is
the Memorians' file on you.

### UI

**#6 `battle-screen`** · **#7 `canvas-layer`** · **#8 `screens-restyle`** — per `UI-DESIGN.md`.
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

| Area | State |
|---|---|
| **Lore / world** | ✅ **Done.** Six rounds. Remaining items (rival houses, the Kingpins as people, Absolution above ground, where the body is) are **deliberately parked** and block nothing |
| **Scope / Tier 1** | ✅ **Done.** All seven decided — see the banner in `SCOPE-AUDIT.md` |
| **Floor mechanics** | ✅ **Done.** All five specified in `GAME-DESIGN.md` §8 |
| **Visual** | 🔄 in progress — audio and fonts were **never discussed at all**, and audio gates #6 |
| **Design / Tier 2** | 🔄 in progress — loot acquisition, karma's mid-run effects, class twists, progression |
