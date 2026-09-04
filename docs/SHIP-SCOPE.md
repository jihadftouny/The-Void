# The Void — the ≤60 h first-playable scope

**Written 2026-08-31. This is the deliverable for milestone `b1` of the Ftouny Plan v3 (due 2026-09-14): "pick ONE project, write the ≤60-hour scope with a features-cut list, park the other in writing."**

This document answers one question and nothing else: **what is the smallest complete version of The Void that can be shipped to itch.io, and what gets cut to get there.** It does not replace `ROADMAP.md` (the full 18-milestone plan) or `PLAN.md` (the work order). It selects from them.

> **Why it exists — read this before the rest.** These milestones are **not a schedule with a cut list attached. They are a gate against scope creep.** The mechanism has three parts, and it only works if all three are used:
>
> 1. **A test, not an inventory** (§2.1) — three questions that decide whether *anything*, including something nobody has thought of yet, belongs in v1.
> 2. **A fixed budget** (§3) — 64 h. Anything admitted must displace something named.
> 3. **A destination for everything cut** (§4 + §9) — every cut item names the version it returns at, so "later" is a decision rather than a deferral.
>
> The failure mode this is built against is specific and it is the normal one: v1 grows one reasonable-sounding feature at a time, each individually cheap, until the ship date is gone. Every item in §4 would make the game better. That was never the question.

> **Precedence.** Where this document and `PLAN.md` disagree about *order*, this one wins — it is the shipping schedule. Where they disagree about *what a task is*, `PLAN.md` wins — it is the work order. Nothing here overrides `CLAUDE.md` or `WORLD.md`.

---

## 1. The pick, and the parking

**The Void is Game #1.** The three.js game is **parked in writing**, here, as `b1` requires: it is not cancelled, it is not scheduled, and it gets zero hours until The Void has shipped. If The Void misses two consecutive milestones, the kill/park rule fires and *it* becomes the parked one.

**Why The Void and not a smaller new game:** it is not a standing start. 1,029 tests pass, the engine is built through M9, and an Electron shell, a working local-LLM narrator, a save system and a five-act structure already exist. A new 60-hour game would ship *less* game. The 60 hours here buy **finishing**, not building.

**The honest counter-argument, recorded:** The Void's remaining work is unusually *unglamorous* — 41 logged defects, placeholder prose, and packaging — with no new-feature reward along the way. A fresh small game would feel faster. The counter loses on arithmetic: The Void is ~80% built and 0% shipped, and the plan's scoring event (`b2`) is *shipping*, not building.

---

## 2. What "first playable" means here

A player who has never seen the project can:

1. Start the game, read the content warning, type a name, pick a class.
2. Descend through the five acts, fighting, levelling, taking sacrifice-deals and resting.
3. Have every found item be usable — equippable gear, drinkable healing.
4. Reach **either** ending — grace or damnation — by how they played.
5. Read authored prose throughout, with the local model narrating over it.
6. Have the run end properly: no resumable save, a written run summary.

That is the bar. Not "all five floors have unique mechanics", not "it looks good".

### 2.1 The v1 test — the three questions

**This is the point of the whole document.** The milestone list is not a schedule that happens to have a cut list attached; it is a **gate**, and this is the gate. A list of what is out only works until something new arrives that is not on the list — so what follows is a test, not an inventory.

A feature belongs in v1 **only if it answers YES to at least one of these:**

1. **Does its absence make the game lie?** The game claims something it does not do. *An Equip button that cannot equip. Two advertised endings, one of them mathematically unreachable. A "narrator" that credits the wrong actor for the player's own action.*
2. **Does its absence make a run impossible to finish?** *No healing item can be obtained. Floor 5 has no encounters.*
3. **Does its absence mean it is not a product?** *It cannot be packaged and installed. Placeholder text stands where the game's own words should be.*

**And YES to both constraints:**

- **It costs $0** (plan rule 2 — no game spending until ~Apr 2028).
- **You can name what it displaces.** The budget is 64 h and fixed. Adding something means removing something specific, named at the time. If nothing can leave, it is not v1.

> **The line that does the work: *"it would be better with X" is never a v1 argument.*** Every cut item in §4 would make the game better. That is not in dispute and never was. It is why they were cut rather than never considered — and why each one has a version to come back at (§9), instead of a vague "later" that turns into "now" the moment it is raised again.

### 2.2 What to do when a new idea arrives mid-build

It will. The protocol is three steps and takes two minutes:

1. **Write it into the ladder (§9) at the version it belongs to.** Do not evaluate whether it is good — it probably is. Just place it.
2. **Run the three questions.** All three "no" → it is not v1, and the decision is already made.
3. **Only if a question is YES:** name what it displaces and cut that in the same sitting, or it does not go in. Record the swap here so the 64 h number stays true.

**Never** add a rung to the ladder and to v1 at the same time. **Never** let a new item in without a matching cut. The hours are the constraint that makes the list mean anything.

---

## 3. The budget — five blocks, 64 h against a 60 h cap

| # | Block | Covers | Est. | Cum. |
|---|---|---|---:|---:|
| 1 | **Engine truth** | `PLAN.md` **#0a, #0b, #0c** — all 33 critical defects (G11–G47) | 24 h | 24 h |
| 2 | **Reachability + healing** | **#9** — 19 consumables, 4 uniques, 14 of 15 relics currently have no acquisition path; the §22.6 consumable fold-in means **this is the only healing in the game** | 8 h | 32 h |
| 3 | **The reverence axis, the grace deals and The Delusion become reachable** ~~Both endings reachable~~ | **#10a** — wire `leaveOffering`, `honorDead`, `embraceWhisper` (not `seeThroughIllusion`, which needs floor 2's unbuilt illusions) | 4 h | 36 h |
| 4 | **The authored pass** | **#13-lite** — C1–C12, the endings in second person, the intro, floor prose, no placeholder text on any live path. **Author-only work; no agent can do it** | 16 h | 52 h |
| 5 | **Ship** | **#14** — packaged build, icon, first-run model download *with a real failure path*, store copy | 12 h | **64 h** |

**The scope is 4 hours over the 60 h cap, and that is stated rather than hidden.** The plan's own rule is *"scope shrinks before hours grow"*, so the cut ladder in §6 is pre-armed rather than improvised at hour 58.

**Why block 3 is not optional, though it looks like polish.**

> ⚠ **CORRECTED 2026-09-04 — this section previously claimed "the grace ending is mathematically unreachable". That is FALSE, and it was my error, not the register's.** `FINDINGS.md` G15 never said it; it says the *axis* can only move one way. Measured by #10a's plan-agent over 200 runs of the shipped `mercifulPolicy`: **grace is reached 26 times today**, and `sim.test.ts:50` and `game.test.ts:834` already assert a grace verdict. The claim was repeated to the author several times before it was caught.

What *is* true, and still justifies block 3 under §2.1's first question (**does its absence make the game lie?**): until these actions are wired, `reverenceDesecration` — the axis the final reckoning weights most heavily (weight 3) — **can only ever move toward cast-down**, never toward grace. Three consequences, all of them advertised content that cannot be reached:

- **the entire grace deal pool is unreachable**, taking `mirror-shard` with it — the only hard-coded item on any acquisition path;
- **`clarityDelusion` is permanently 0**, so *"The Delusion"* can never be the act-3 boss;
- a whole axis of a four-axis system is **one-directional**, which is not the design.

That is the same class as G14 (built, tested, unreachable), and 4 h is the cheapest possible fix for it.

---

## 4. The cut list — what does NOT ship in v1

Each of these stays fully specified in `ROADMAP.md`/`PLAN.md`. Cut means *not in v1*, not *dropped*.

**Every row names the version it comes back at.** That column is load-bearing: a cut list where everything is vaguely "later" is a pile, and a pile is how cut scope returns — whatever is loudest on the day wins. A cut item with a version already has its answer.

| Cut | `PLAN.md` | Back in | Why it can wait |
|---|---|---|---|
| **Floor-specific mechanics + balance re-run** | #2 | **v1.2** | Ships with a **sanity check**, not a simulated re-tune. `BALANCE-REPORT.md` stays invalidated and says so |
| **All generated art** | #3 #4 #5 | **v2.0** | **Forbidden by plan rule 2 until ~Apr 2028** — see §5.2. Not an effort question; a money one |
| **Battle-screen redesign** | #6 | **v1.3** | The current screen is functional. A restyle is not a shipping blocker |
| **The Kaplay canvas/atmosphere layer** | #7 | **v2.0** | Kaplay is a dependency nothing imports; it stays that way. Wants the art to sit on top of |
| **Screens restyle** | #8 | **v1.3** | Typography and CSS only, so it is affordable — just not essential |
| **Karma bending the world mid-run** | #10 | **v2.0** | Karma still decides the ending. It just doesn't change the world on the way down |
| **The floor-4 executioner + boss agents** | #11 | **v2.0** | Ships with **4 bosses, not 5**. The verdict gate still fires |
| **The narrator-to-spec rewrite** | #12 | **v1.1** | Per-floor voices, beat significance, karma-in-prompt. The narrator *works*; this makes it better — and it is the cheapest large quality gain, which is why it is first back |
| **Audio** | #15 | **v1.3** | Silence is a defensible aesthetic for this game; a bad audio layer is not. Only with CC0/free assets that clear `SHIPPING.md` |
| **Bundled typeface** | #16 | **v1.3** | System fonts ship fine |
| **Ship assets** (title, store, cursors) | #17 | **v2.0** | The **icon alone is in v1** — a package needs one. The rest is art, so it waits for money |
| **The Hollow ascent campaign** | #18 | **parked** | An entire second campaign. Only if The Void earns it (`b7`/`b8`) |

---

## 5. Two conflicts between this project and the Plan v3 rules

Both are real, both change what ships, and neither was written down before today.

### 5.1 "Web-first" vs. a 2.5 GB GPU-required desktop download

Plan v3 rule 2 says *"web/itch distribution"*, and `b1` asks devlog #1 to explain *"why web-first"*. **The Void is not web.** It is an Electron desktop build that requires a GPU and downloads a ~2.5 GB model on first run (`CLAUDE.md`; decided 2026-08-25/26). On itch.io, where most traffic plays in the browser, that is a far narrower funnel than the plan assumed.

**Options:** (a) ship desktop-only and accept the narrow funnel; (b) also ship a browser "engine-only" demo — no narration — as the shopfront.

**Recommendation: (a) for v1.** Option (b) is less free than it looks: `npm run dev` cannot run outside Electron today because the renderer calls Electron IPC at module scope, so a web build needs a second renderer entry point. That is new work, in the middle of a scope whose whole purpose is finishing. **Decide by 2026-10-19** (before block 5 starts); revisit (b) only after `b2` is banked.

**Consequence for the devlog:** devlog #1 cannot honestly be titled "why web-first". It should be *"why I'm shipping the one that's 80% built, and what that costs me in reach."*

### 5.2 "$0 game spending" vs. the ~$10.05 art budget

Plan v3 rule 2 forbids **all** game spending until **~2028**. The art plan (`GAME-DESIGN.md` §22.8) budgets ~$10.05 across four generation batches. That money cannot be spent until 2028, which is after `b2`, `b3`, `b4` *and* `b5`.

**Therefore The Void ships with no generated art at all** — not as an aesthetic choice, but as a consequence of a financial rule that outranks the art plan. `ART-BIBLE.md` is not wrong; it is **not yet fundable**.

**The knock-on to fix:** milestone `b2` requires *"page art"*. That must now be produced at **$0** — a typographic cover built from the game's own interface, which suits a text-forward game about signal and static. Budgeted inside block 5.

---

## 6. The cut ladder — armed in advance

If the 60 h cap is reached before block 5 is done, cut **in this order** and record which rung was used. Never grow the hours (plan rule: two months over cap → cut devlog frequency, never sleep).

1. **The condition rename** (`insanity` → `Static`, §22.13) — ~60 occurrences and ~12 tests, and it changes no mechanic. Ships in the first patch instead.
2. **Narration polish beyond the blank-screen fixes** — the uncased event kinds that *misattribute* get fixed; the ones that merely read awkwardly wait.
3. **The balance sanity pass** — ship the numbers as tuned and say so on the store page.
4. **Floors 4–5 encounter variety** — generic encounters, which is what exists today.
5. **The local model off by default**, engine-only mode as the shipping default — *last resort*. This removes the thing that makes The Void distinctive; taking this rung means the release is a different product, and it should be renamed a demo if so.

---

## 7. Schedule (10 h/wk cap: ~8 h build + ~2 h devlog/community)

| Milestone | Date | Hours | Gate |
|---|---|---:|---|
| `v1` | 2026-09-14 | 12 h | **#0a merged** — equipment resolves, damage-over-time damages, floor 5 has encounters |
| `v2` | 2026-09-28 | 12 h | **#0b + #0c merged** — all 33 defects closed; narration attributes correctly, terminal runs clear their save |
| `v3` | 2026-10-05 | 12 h | **#9 + #10a** — items reachable, healing exists, **both endings reachable** |
| `v4` | 2026-10-19 | 16 h | ★ **FIRST PLAYABLE** — a full authored run, start to ending, no placeholder text (52 h cumulative) |
| `v5` | 2026-11-02 | 12 h | **Ship candidate** — packaged, first-run download with a real failure path (64 h — the cap is crossed here) |
| `v6` | 2026-11-30 | — | **Playtest** — 3 outside playtesters finish a run; fix only what blocks them |
| `v7` | 2026-12-14 | — | ★ **itch.io page live** (GPU + 2.5 GB stated plainly) **+ one jam entered** → satisfies `b2` |

Six weeks of slack sit between `v5` and the Dec 31 deadline. That is deliberate: `b2` is a critical milestone, and the kill/park rule fires on two consecutive misses.

---

## 8. What this scope does NOT fix, and you should know it

- **`BALANCE-REPORT.md` stays invalidated.** Shipping with untuned numbers is a known, accepted risk.
- **Four bosses, not five.** The floor-4 executioner does not exist and is not being built.
- **The exposed Google API key still needs rotating** (`PLAN.md` #4) — outside this scope, still true.
- **The itch funnel is narrow by construction** (§5.1) — expect low play counts. `b3` asks for ≥100 plays; a desktop download with a 2.5 GB first run may not reach it, and that is a `b3` problem to solve with a web demo, not a reason to widen v1.

---

## 9. After v1 — the increment ladder

**The other half of the anti-creep device.** v1 is small because everything else has somewhere to go. Each release below has a **theme**, a **trigger**, and a **rough size** — no dates beyond v1.2, because estimating 2028 work today would be false precision dressed as a plan.

The ordering principle is not "what would be nicest next". It is: **what raises quality most per hour, subject to what the money rules allow.** That is why every art-dependent item collapses into one release — they share a single gate, and it is not effort.

### v1.1 — "It reads right" · ~16 h · trigger: v1 playtest feedback in hand

- Whichever rungs of the cut ladder (§6) actually fired — **the `Static` rename first**.
- **#12-lite**: per-floor narrator voices, beat significance, karma in the prompt.
- The condition-chip and combat-log polish left over from #0.

*Why first: the narrator is the thing that makes The Void not-a-roguelike-like-the-others, and this is the largest perceived-quality gain available for $0 and no art.*

### v1.2 — "It has a floor to stand on" · ~24 h · trigger: v1.1 shipped

- **#2** — the five floors get mechanics of their own, plus the real balance re-run that finally retires the invalidated `BALANCE-REPORT.md`.
- Floor 2's illusions, which also unlock **`seeThroughIllusion`** — the fourth karma action, the one §3 could not wire in v1.

> ⭐ **This release *is* milestone `b3`** (Mar 2027: *"Game #2 **or #1 expanded** · ≥100 plays"*). Expanding The Void satisfies it without starting a second game — which is the whole point of an increment ladder. Worth knowing before you start building a game #2 you may not need.

### v1.3 — "It looks and sounds like something" · ~24 h · trigger: v1.2 shipped

- **#8** screens restyle, **#16** typeface, **#6** battle screen — typography and CSS, all $0.
- **#15** audio, *only* with CC0/free assets that clear the licence check in `SHIPPING.md`.

*Why these three together: they are the entire set of visual/audio work that does not need money.*

### v2.0 — "The full descent" · ⛔ gated on `f5`, not on effort · ~Apr 2028+

**The first release that is allowed to cost anything.** Milestone `f5` (on the Plan v3 board) is what unlocks it, per plan rule 2 — so this release cannot be pulled forward by working harder.

- **#3 #4 #5** — the art pipeline and the four generation batches (~$10.05, the first spendable moment in the whole plan).
- **#7** — the Kaplay canvas atmosphere layer. Kaplay finally gets imported, four years after being added as a dependency.
- **#17** — title, store and cursor art (the icon already shipped in v1).
- **#11** — the floor-4 executioner and the boss agents that were M12's original premise.
- **#10** — karma bending the world mid-run.

### Parked indefinitely

- **#18** the Hollow ascent campaign. An entire second campaign, and it only becomes a real question if The Void earns it at `b7`/`b8`.

---

## 10. How to use this document

- **Before starting any work item:** check §4. If it is cut, it is cut — the version is already decided, and re-litigating it is the scope creep this document exists to prevent.
- **When a new idea arrives:** §2.2, three steps, two minutes.
- **When the hours run out:** §6, in order, top rung first.
- **When v1 ships:** §9 becomes the plan, and this document's job is done.

---

*Companion board: `docs/plan-dashboard.html` (lane V). Register of defects: `FINDINGS.md`. Work order: `PLAN.md`.*
