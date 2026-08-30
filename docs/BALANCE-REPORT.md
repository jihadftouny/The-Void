# The Void — balance / winnability report

> **Generated** by `scripts/balance-report.ts` (`npx vite-node scripts/balance-report.ts`).
> Regenerate after any balance change; the numbers below are the harness's real output.

> # ⚠ INVALIDATED 2026-08-28 — read this before trusting any number below
>
> **The "lower bound" framing in this report is wrong** (`FINDINGS.md` **G11**). This report repeats,
> four times, that the sim fights with starting gear *because the sim has no equip action*, and
> therefore that **"real play equips found loot, so it is easier than these figures."**
>
> **Real play does not equip found loot either.** `equipment.ts` resolves items by catalog id only,
> while every generated drop carries a synthetic `gen:*` id that matches no catalog — measured at
> **>100 drops across 300 seeds, zero equippable**. So loot is un-equippable *in principle*, not
> merely unmodelled by the harness.
>
> **Consequence:** these numbers are **not a floor — they are what the game actually does today.**
> Real play is *not* easier than 32.9%. Every "lower bound" and "easier still" claim below is void.
>
> **A SECOND, INDEPENDENT REASON (G32, ruled 2026-08-30).** `Player.proficiency` was set on every
> character and **read by no combat path** — verified over 200 rounds at proficiency 2 vs 99 with
> zero differences. So every number here was tuned against a to-hit baseline roughly **10 percentage
> points below** the intended model. **The author ruled to wire it**, which makes the player
> meaningfully more accurate and changes the difficulty again.
>
> **Regenerate this report after `PLAN.md` #0 lands**, then re-tune. The re-run in #2 is mandatory
> for both reasons independently.

## Difficulty TARGET — SET (M15) and MET

**Target (author, M15):** a careful baseline run wins about **1 in 3** — overall baseline
win-rate in the **25–35% band (aim ~30%)** — and, the KEY structural goal, **deaths SPREAD
across all five acts** rather than bunched at Act 1, with Act-1 enemies taking **~3–4 hits** to
kill. The band is judged on the **baseline** (kill-everything, no-sacrifice) policy; the
merciful policy is kept below for the grace-path view.

**Result — MET.** Baseline overall win-rate **32.9%** (in band); Act-1 deaths
**19.2%** of all baseline deaths (was ~98% pre-M15), the modal death act
holds **33.2%** (< 50%), and Acts 1–4 each hold ≥ 10% of deaths.
Every class wins (lowest baseline win-rate is Neuromancer). Committed anchor tests
(`src/game/balance.test.ts`) hold the Act-1 "~3–4 hits" feel and this winnability floor.

> **Documented near-miss / feel caveat.** These are the no-equipment LOWER BOUND (see the
> caveat below); REAL play equips found loot, so it is easier than these figures. The band is
> hit on the lower bound, so real play sits at the easier end — a **NEEDS-HUMAN play-test**
> confirms the "tough-but-fair" feel (esp. `STARTING_POTS = 6`, generous for equipped play).

## What was measured

- **Build:** the M1–M13 mechanical core with the **M15 balance-constant tuning** applied (`agentic/balance-tune`).
- **Sample:** seeds `1..500` × the 5 classes (Enforcer, Neuromancer, Scavver, Penitent, Hollow) = **2500 runs per policy**, all-unlocked roster (`createGame(seed)`, the full 24-family bestiary — the honest hardest case and the simplest to reproduce).
- **Two policies:** a **baseline** (reasonable play, kills everything, never seeks a sacrifice
  deal) and a **merciful** variant (identical, but spares living ⚖ karma-weighted non-boss foes)
  so the grace path's reachability is measured, not just death and damnation.

> **Lower-bound caveat (equipment un-modelled).** The `step` controller has no equip action, so
> the sim fights with **starting gear** the whole way — found loot lands in the backpack unused.
> Real players equip better loot, so the true win-rate is **at least** what is reported here;
> these figures are a floor, not the ceiling. Promoting equip to a step input is a later
> follow-up.

## Headline

- **Baseline overall win-rate: 32.9%** (0 grace + 823 damnation of 2500).
- **Merciful overall win-rate: 40.0%** (1000 grace + 0 damnation of 2500).
- Deaths peak at **Act 3** (33.2% of all baseline deaths).

## Balance read (from the data)

- **Winnable in the target band.** The no-sacrifice baseline wins 32.9% of runs — inside the 25–35% "about 1 in 3" target — and this is the equipment-un-modelled LOWER BOUND, so real play (found loot equipped) is easier still.
- **Deaths are SPREAD, no longer bunched at Act 1.** Act 1 now holds only 19.2% of deaths (was ~98% pre-M15); the modal death act is Act 3 at 33.2% (< 50%), and 4 of the 5 acts each hold ≥ 10% of deaths. The run is a full descent now, not a first-floor wall.
- **Average floors cleared is 2.44 of 4** (avg final level 10.37) — progression reaches the mid/late game where leveling compounds, instead of stalling at the front.
- **The grace path stays a mercy choice.** The kill-everything baseline reaches grace 0 time(s) (its neutral/negative karma routes cast-down → it wins by unmaking the Act-5 Hollow); the merciful policy (spares ⚖ foes) reaches grace 1000 time(s) for overall win-rate 40.0%. Mercy still shifts the moral ending, exactly as intended.
- **Per-class shape to watch (author call).** Scavver's enemy-disadvantage evasion makes it the strongest class and the fragile casters (Neuromancer, Hollow) the weakest; every class wins at least occasionally (none at 0%). Whether to narrow that gap is a per-class balance follow-up, separate from the global winnability now achieved.

## Baseline policy (no sacrifice, no spare — the found-loot-only floor)

Reasonable engine-authoritative play: potion when low, cast the best affordable skill, flee a near-certain death when heals are gone, otherwise fight. Kills every foe (a spare forfeits the kill XP the act gates require).

- **Overall win-rate:** 32.9% (823 of 2500 runs) — 0 grace, 823 damnation, 1677 deaths.
- **Average final level:** 10.37 · **average floors cleared:** 2.44 (of 4 concluded floors on a full descent).

### Per-class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 34.0% | 0 | 170 | 330 | 11.27 | 2.69 |
| Neuromancer | 500 | 16.2% | 0 | 81 | 419 | 8.30 | 1.88 |
| Scavver | 500 | 75.6% | 0 | 378 | 122 | 14.61 | 3.57 |
| Penitent | 500 | 19.6% | 0 | 98 | 402 | 8.90 | 2.04 |
| Hollow | 500 | 19.2% | 0 | 96 | 404 | 8.78 | 2.01 |

### Deaths by act (where runs end)

| | Act 1 | Act 2 | Act 3 | Act 4 | Act 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 322 | 353 | 556 | 442 | 4 |
| Enforcer | 30 | 49 | 138 | 111 | 2 |
| Neuromancer | 97 | 114 | 121 | 86 | 1 |
| Scavver | 9 | 13 | 42 | 58 | 0 |
| Penitent | 90 | 86 | 134 | 92 | 0 |
| Hollow | 96 | 91 | 121 | 95 | 1 |

## Merciful policy (spares ⚖ foes — exercises the grace path)

Identical to the baseline, except it releases a living ⚖ karma-weighted non-boss enemy on sight. This trades kill XP for positive karma, so it reaches the grace ending more often but survives less — it exists to show the grace path is reachable and how mercy shifts the death / grace / damnation split.

- **Overall win-rate:** 40.0% (1000 of 2500 runs) — 1000 grace, 0 damnation, 1500 deaths.
- **Average final level:** 11.11 · **average floors cleared:** 2.24 (of 4 concluded floors on a full descent).

### Per-class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 44.2% | 221 | 0 | 279 | 11.93 | 2.46 |
| Neuromancer | 500 | 26.2% | 131 | 0 | 369 | 9.42 | 1.92 |
| Scavver | 500 | 80.0% | 400 | 0 | 100 | 14.90 | 2.84 |
| Penitent | 500 | 24.4% | 122 | 0 | 378 | 9.62 | 1.97 |
| Hollow | 500 | 25.2% | 126 | 0 | 374 | 9.68 | 1.98 |

### Deaths by act (where runs end)

| | Act 1 | Act 2 | Act 3 | Act 4 | Act 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 319 | 319 | 316 | 546 | 0 |
| Enforcer | 25 | 53 | 89 | 112 | 0 |
| Neuromancer | 95 | 91 | 71 | 112 | 0 |
| Scavver | 12 | 15 | 13 | 60 | 0 |
| Penitent | 102 | 70 | 68 | 138 | 0 |
| Hollow | 85 | 90 | 75 | 124 | 0 |

---

*Outcome vocabulary: **grace** = the Act-4 verdict ascension (net-positive karma); **damnation**
= descending to Act 5 and unmaking the Hollow Self; **death** = the player fell. Both grace and
damnation count as "wins" (the run reached an ending); death does not.*
