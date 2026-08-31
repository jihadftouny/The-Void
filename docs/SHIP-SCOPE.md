# The Void — the ≤60 h first-playable scope

**Written 2026-08-31. This is the deliverable for milestone `b1` of the Ftouny Plan v3 (due
2026-09-14): "pick ONE project, write the ≤60-hour scope with a features-cut list, park the other
in writing."**

This document answers one question and nothing else: **what is the smallest complete version of The
Void that can be shipped to itch.io, and what gets cut to get there.** It does not replace
`ROADMAP.md` (the full 18-milestone plan) or `PLAN.md` (the work order). It selects from them.

> **Precedence.** Where this document and `PLAN.md` disagree about *order*, this one wins — it is
> the shipping schedule. Where they disagree about *what a task is*, `PLAN.md` wins — it is the work
> order. Nothing here overrides `CLAUDE.md` or `WORLD.md`.

---

## 1. The pick, and the parking

**The Void is Game #1.** The three.js game is **parked in writing**, here, as `b1` requires: it is
not cancelled, it is not scheduled, and it gets zero hours until The Void has shipped. If The Void
misses two consecutive milestones, the kill/park rule fires and *it* becomes the parked one.

**Why The Void and not a smaller new game:** it is not a standing start. 1,029 tests pass, the
engine is built through M9, and an Electron shell, a working local-LLM narrator, a save system and
a five-act structure already exist. A new 60-hour game would ship *less* game. The 60 hours here buy
**finishing**, not building.

**The honest counter-argument, recorded:** The Void's remaining work is unusually
*unglamorous* — 41 logged defects, placeholder prose, and packaging — with no new-feature reward
along the way. A fresh small game would feel faster. The counter loses on arithmetic: The Void is
~80% built and 0% shipped, and the plan's scoring event (`b2`) is *shipping*, not building.

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

---

## 3. The budget — five blocks, 64 h against a 60 h cap

| # | Block | Covers | Est. | Cum. |
|---|---|---|---:|---:|
| 1 | **Engine truth** | `PLAN.md` **#0a, #0b, #0c** — all 33 critical defects (G11–G47) | 24 h | 24 h |
| 2 | **Reachability + healing** | **#9** — 19 consumables, 4 uniques, 14 of 15 relics currently have no acquisition path; the §22.6 consumable fold-in means **this is the only healing in the game** | 8 h | 32 h |
| 3 | **Both endings reachable** | **#10a** — wire `leaveOffering`, `honorDead`, `embraceWhisper` (not `seeThroughIllusion`, which needs floor 2's unbuilt illusions) | 4 h | 36 h |
| 4 | **The authored pass** | **#13-lite** — C1–C12, the endings in second person, the intro, floor prose, no placeholder text on any live path. **Author-only work; no agent can do it** | 16 h | 52 h |
| 5 | **Ship** | **#14** — packaged build, icon, first-run model download *with a real failure path*, store copy | 12 h | **64 h** |

**The scope is 4 hours over the 60 h cap, and that is stated rather than hidden.** The plan's own
rule is *"scope shrinks before hours grow"*, so the cut ladder in §6 is pre-armed rather than
improvised at hour 58.

**Why block 3 is not optional, though it looks like polish:** until those actions are wired,
`reverenceDesecration` — the verdict's heaviest axis — can only ever move toward *cast down*. The
grace ending is **mathematically unreachable**. A game with two advertised endings and one reachable
ending is not shippable; this is the cheapest possible fix for it.

---

## 4. The cut list — what does NOT ship in v1

Each of these stays fully specified in `ROADMAP.md`/`PLAN.md`. Cut means *not in v1*, not *dropped*.

| Cut | `PLAN.md` | Why it can wait |
|---|---|---|
| **All generated art** | #3 #4 #5 #17 | Also **forbidden by plan rule 2** — see §5. Ships with a typographic interface instead |
| **The Kaplay canvas/atmosphere layer** | #7 | Kaplay is a dependency nothing imports; it stays that way. Pure atmosphere, zero mechanics |
| **Battle-screen and screens restyle** | #6 #8 | The current screens are functional. A restyle is not a shipping blocker |
| **Audio** | #15 | Silence is a defensible aesthetic for this game; a bad audio layer is not |
| **Bundled typeface** | #16 | System fonts ship fine |
| **The floor-4 executioner + boss agents** | #11 | Ships with **4 bosses, not 5**. The verdict gate still fires |
| **The narrator-to-spec rewrite** | #12 | Per-floor voices, zone prompt files, beat significance, karma-in-prompt. The narrator *works*; this makes it better |
| **Karma bending the world mid-run** | #10 | Karma still decides the ending. It just doesn't change the world on the way down |
| **Floor-specific mechanics + balance re-run** | #2 | Ships with a **sanity check**, not a simulated re-tune. `BALANCE-REPORT.md` stays invalidated and says so |
| **The Hollow ascent campaign** | #18 | An entire second campaign. Post-ship, if ever |

---

## 5. Two conflicts between this project and the Plan v3 rules

Both are real, both change what ships, and neither was written down before today.

### 5.1 "Web-first" vs. a 2.5 GB GPU-required desktop download

Plan v3 rule 2 says *"web/itch distribution"*, and `b1` asks devlog #1 to explain *"why web-first"*.
**The Void is not web.** It is an Electron desktop build that requires a GPU and downloads a ~2.5 GB
model on first run (`CLAUDE.md`; decided 2026-08-25/26). On itch.io, where most traffic plays in the
browser, that is a far narrower funnel than the plan assumed.

**Options:** (a) ship desktop-only and accept the narrow funnel; (b) also ship a browser
"engine-only" demo — no narration — as the shopfront.

**Recommendation: (a) for v1.** Option (b) is less free than it looks: `npm run dev` cannot run
outside Electron today because the renderer calls Electron IPC at module scope, so a web build needs
a second renderer entry point. That is new work, in the middle of a scope whose whole purpose is
finishing. **Decide by 2026-10-19** (before block 5 starts); revisit (b) only after `b2` is banked.

**Consequence for the devlog:** devlog #1 cannot honestly be titled "why web-first". It should be
*"why I'm shipping the one that's 80% built, and what that costs me in reach."*

### 5.2 "$0 game spending" vs. the ~$10.05 art budget

Plan v3 rule 2 forbids **all** game spending until **~2028**. The
art plan (`GAME-DESIGN.md` §22.8) budgets ~$10.05 across four generation batches. That money cannot
be spent until 2028, which is after `b2`, `b3`, `b4` *and* `b5`.

**Therefore The Void ships with no generated art at all** — not as an aesthetic choice, but as a
consequence of a financial rule that outranks the art plan. `ART-BIBLE.md` is not wrong; it is
**not yet fundable**.

**The knock-on to fix:** milestone `b2` requires *"page art"*. That must now be produced at **$0** —
a typographic cover built from the game's own interface, which suits a text-forward game about
signal and static. Budgeted inside block 5.

---

## 6. The cut ladder — armed in advance

If the 60 h cap is reached before block 5 is done, cut **in this order** and record which rung was
used. Never grow the hours (plan rule: two months over cap → cut devlog frequency, never sleep).

1. **The condition rename** (`insanity` → `Static`, §22.13) — ~60 occurrences and ~12 tests, and it
   changes no mechanic. Ships in the first patch instead.
2. **Narration polish beyond the blank-screen fixes** — the uncased event kinds that *misattribute*
   get fixed; the ones that merely read awkwardly wait.
3. **The balance sanity pass** — ship the numbers as tuned and say so on the store page.
4. **Floors 4–5 encounter variety** — generic encounters, which is what exists today.
5. **The local model off by default**, engine-only mode as the shipping default — *last resort*. This
   removes the thing that makes The Void distinctive; taking this rung means the release is a
   different product, and it should be renamed a demo if so.

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

Six weeks of slack sit between `v5` and the Dec 31 deadline. That is deliberate: `b2` is a critical
milestone, and the kill/park rule fires on two consecutive misses.

---

## 8. What this scope does NOT fix, and you should know it

- **`BALANCE-REPORT.md` stays invalidated.** Shipping with untuned numbers is a known, accepted risk.
- **Four bosses, not five.** The floor-4 executioner does not exist and is not being built.
- **The exposed Google API key still needs rotating** (`PLAN.md` #4) — outside this scope, still true.
- **The itch funnel is narrow by construction** (§5.1) — expect low play counts. `b3` asks for ≥100
  plays; a desktop download with a 2.5 GB first run may not reach it, and that is a `b3` problem to
  solve with a web demo, not a reason to widen v1.

---

*Companion board: `docs/plan-dashboard.html` (lane V). Register of defects: `FINDINGS.md`. Work
order: `PLAN.md`.*
