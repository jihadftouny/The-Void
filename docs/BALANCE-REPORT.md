# The Void — balance / winnability report

> **Generated** by `scripts/balance-report.ts`
> (`npx vite-node scripts/balance-report.ts`). Every number below is that run's real
> output, and every verdict word is computed from it — nothing here is asserted by hand.

## What these numbers do NOT include

- **Equipment is modelled by a greedy hub rule, OUTSIDE `step`.** `step` still has no equip input (#1.1), so the sim gears up at every hub visit through the same pure `equip` the UI calls: an empty slot takes anything, an occupied one only a strictly higher rarity. A generated weapon still swings the unarmed die plus its bonus (§22.20; #1 owns the fix), so found weapons are under-valued here exactly as in the game.
- **Consumables: only healing is used.** The heuristic drinks a found `healSelf` item at <= 35% HP; every other consumable (cures, throwables, flee items) sits unused, so nothing here measures them. It takes every bargain not paid in HP, sheds its lowest-rarity gear when the pack is full, and never throws a usable away.
- **Potions are gone (§22.6).** Healing is a found consumable or a found rest; a fresh character carries a two-item starting kit (`STARTING_CONSUMABLES`) and a twelve-slot backpack (§22.17) that every heal competes for.
- **`ILLUSION_DC` and every per-class number are FROZEN (§22.27).** The tuning below moved only global knobs. The per-class gap and the floor-2 Wisdom gap are REPORTED, not closed: the three remedies are the author's, and the DC table is measured with the DC injected into the sim — the constant itself was never edited.
- **Minutes are an ESTIMATE**, at a stated seconds-per-step constant (`SECONDS_PER_STEP`), not a measurement: no human has played these floors. The encounter, round and step counts beside them ARE measured.
- **Do not hand-edit this file.** It is regenerated wholesale by the command above, and anything added here is silently destroyed the next time it runs — which is exactly how a ⚠ INVALIDATED banner was lost once already. To add a lasting caveat, add it to `STANDING_CAVEATS` in `scripts/balance-claims.ts`.

## Difficulty target — MET

**Target (author, M15):** a careful baseline run wins about **1 in 3** — overall baseline
win-rate in the **25.0%–35.0% band (aim ~30%)** — with deaths **spread across the
descent** rather than bunched on floor 1. The band is judged on the **baseline** policy; the
merciful policy is kept for the grace-path view.

**Result — MET.** Baseline overall win-rate **29.4%**; floor 1 holds
**31.0%** of all baseline deaths, the modal death floor holds
**33.1%** (floor 4), and floors 1, 3, 4 each hold ≥ 10% of deaths.
Every class wins (lowest baseline win-rate is Penitent). Committed anchor tests (`src/game/balance.test.ts`) hold the
floor-1 "~3–4 hits" feel and a winnability floor.

**The classes furthest below one in three:** **Penitent** wins 16.0%, and floor 2 took 11.7% of its deaths; **Neuromancer** wins 18.0%, and floor 2 took 11.0% of its deaths. Per §22.27 no class was tuned to close this. The three remedies on the table — strengthen that class elsewhere, accept it as a real build trade-off, or soften floor 2 for low-Wisdom builds — are the author's to choose, and the tables below are the evidence.

## What was measured

- **Build:** the five floors of `PLAN.md` #2 — floor 2's illusions, floor 3's slow weight, floor 4's temptation, floor 5's warped kit; bargains and rest spots found on the descent; potions folded into consumables; a twelve-slot backpack.
- **Sample:** seeds `1..500` × the 5 classes (Enforcer, Neuromancer, Scavver, Penitent, Hollow) = **2500 runs per policy**, all-unlocked roster (`createGame(seed)`).
- **Two policies:** a **baseline** (kills everything, takes any bargain not paid in HP) and a
  **merciful** variant (identical, but spares living ⚖ karma-weighted non-boss foes).
- **The DC table** re-runs the baseline with floor 2's DC injected at 11 / 13 / 15.

## Tuning ledger (global knobs only)

| Step | Knob | From | To | Why | Measured effect |
| --- | --- | ---: | ---: | --- | --- |
| T1 | `floors.json` rest weight, floors 2-5 | 2 | 1 | Rest is the main heal left after the potion fold-in (§22.6) and §22.26 makes its scarcity the floor weight; it now grows scarcer with depth. Floor 1 keeps 2 — a fresh pack is nearly empty there, and floor 1 already held the most deaths. | baseline win rate 0.411 -> 0.345; act-1 death share 0.389 -> 0.350 |
| T2 | `ENEMY_HP_XP_DIV` (`enemy.ts`) | 8 | 6 | M15 loosened it for a character who never equipped anything; the sim now equips found gear (G48), so part of that is taken back. A fresh act-1 enemy (xp 0) is untouched, so the hits-to-kill anchor does not move; the HP lands on floors 2-5. | baseline win rate 0.345 -> 0.321; floor-1 deaths 573 -> 576 |
| T3 | `HOLLOW_GATE_XP` (`progression.ts`) | 500 | 600 | Back to its first derived value: ~7.5 floor-5 kills, the length of floors 3 and 4 (7.9 and 7.0 kills per cleared floor, measured). 500 existed only to clear the old 0.12 guard by a coincidence of the gearless sim, which no longer binds (AC-29). When applied, floor 5 killed ~1 arrival in 8 (106 of 871) — close to floor 2 (1 in 8.7), well below floors 3 (1 in 5.7) and 4 (1 in 2.8). (Corrected in fix round 1: an earlier text called floor 5 "the softest floor", from pre-tuning numbers.) | baseline win rate 0.321 -> 0.306; floor-5 deaths 106 -> 142 |

**Frozen — not moved by this tuning:**

- `ILLUSION_DC` = 13 (§22.27, plan Appendix A.4) — measured at 11 and 15 below, never edited
- every per-class number: hit dice, class kits, starting gear, evasion
- the author's rulings: the illusion chance (one fight in three) and the floor-4 karma multiplier

## Headline

- **Baseline overall win-rate: 29.4%** (27 grace + 708 damnation of 2500).
- **Merciful overall win-rate: 44.5%** (1107 grace + 5 damnation of 2500).
- Deaths peak on **floor 4** (33.1% of all baseline deaths).

## Balance read (from the data)

- **Winnability vs the target.** The baseline wins 29.4% of runs — inside the 25.0%–35.0% "about 1 in 3" target. See the caveats above for what these numbers do and do not model.
- **Where deaths fall.** Floor 1 holds 31.0% of all deaths; the modal death floor is 4 at 33.1%, and 3 of the 5 floors each hold ≥ 10% of deaths (floors 1, 3, 4).
- **The grace path stays a mercy choice.** The kill-everything baseline reaches grace 27 time(s); the merciful policy (spares ⚖ foes) reaches grace 1107 time(s), for an overall win-rate of 44.5%. Grace ends the run at floor 4; damnation descends to floor 5.
- **Per-class shape (author call, §22.27).** strongest **Scavver** (48.4%), weakest **Penitent** (16.0%); every class wins at least once over the sample.

## Floor 2 — the Wisdom question (the author's evidence, §22.27)

An illusory enemy's attacks are real and the player's are not; a passive Wisdom roll each
round (d20 + Wisdom modifier against the DC) is the only way through, and seeing through ends
the fight with no XP and no loot (plan Appendix A.1 — a pure cost, not softened).

### Illusions per class (baseline)

| Class | Runs reaching floor 2 | Illusions per run there | Rounds per illusion | HP lost per illusion | Seen through | Deaths inside an illusion | Floor-2 share of deaths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 453 | 2.26 | 2.30 | 0.55 | 99.6% | 2 | 10.3% |
| Neuromancer | 317 | 2.28 | 2.29 | 0.58 | 98.8% | 1 | 11.0% |
| Scavver | 487 | 2.48 | 2.28 | 0.30 | 99.8% | 2 | 2.3% |
| Penitent | 310 | 2.45 | 2.42 | 1.35 | 99.3% | 2 | 11.7% |
| Hollow | 386 | 2.43 | 2.35 | 0.71 | 99.5% | 4 | 10.4% |

### Illusions per class (merciful)

| Class | Runs reaching floor 2 | Illusions per run there | Rounds per illusion | HP lost per illusion | Seen through | Deaths inside an illusion | Floor-2 share of deaths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 465 | 2.35 | 2.35 | 0.54 | 99.7% | 1 | 9.3% |
| Neuromancer | 332 | 2.43 | 2.39 | 0.65 | 99.3% | 2 | 10.1% |
| Scavver | 482 | 2.42 | 2.37 | 0.28 | 99.8% | 0 | 2.7% |
| Penitent | 329 | 2.33 | 2.28 | 1.26 | 98.6% | 5 | 11.0% |
| Hollow | 413 | 2.40 | 2.36 | 0.66 | 99.1% | 5 | 8.5% |

### By starting Wisdom (baseline)

| Starting Wisdom | Runs | Win% | Floor-2 share of deaths |
| --- | ---: | ---: | ---: |
| ≤ 9 | 395 | 27.6% | 12.6% |
| 10–13 | 1215 | 30.7% | 8.7% |
| ≥ 14 | 890 | 28.4% | 9.6% |

Starting Wisdom ≥ 14 wins 28.4%; ≤ 9 wins 27.6% — a gap of 0.8 percentage points in favour of high Wisdom. Floor 2 took 9.6% of the high bucket's deaths and 12.6% of the low one's.

### By starting Wisdom (merciful)

| Starting Wisdom | Runs | Win% | Floor-2 share of deaths |
| --- | ---: | ---: | ---: |
| ≤ 9 | 395 | 45.3% | 9.7% |
| 10–13 | 1215 | 45.1% | 8.1% |
| ≥ 14 | 890 | 43.3% | 9.5% |

### `ILLUSION_DC` sensitivity — measured, NOT applied

| Illusion DC | Win% | Floor-2 deaths | Rounds per illusion | Win% at Wisdom ≤ 9 | Win% at Wisdom ≥ 14 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 11 | 29.6% | 163 | 1.89 | 26.3% | 28.4% |
| 13 (shipped) | 29.4% | 170 | 2.32 | 27.6% | 28.4% |
| 15 | 30.3% | 184 | 3.03 | 27.8% | 29.8% |

From DC 11 to DC 15 the baseline win rate moves 29.6% → 30.3% (a swing of -0.7 points) — a SMALL lever on the overall rate. The shipped DC 13 measures 29.4%. Measured with the DC injected into the sim; `ILLUSION_DC` was not edited.

## Floor length (G9) — over the runs that cleared each floor

| Floor | Runs that cleared it | Encounters | Battle rounds | Steps | Est. minutes (at 10 s/step) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 · Undercity | 1953 | 13.3 | 26.1 | 66.1 | ~11 |
| 2 · Entrance to the Void | 1783 | 14.8 | 26.5 | 70.4 | ~12 |
| 3 · Ash City | 1461 | 13.9 | 32.8 | 83.9 | ~14 |
| 4 · Angelic Underground | 876 | 13.1 | 42.7 | 98.3 | ~16 |
| 5 · True Void | 708 | 15.4 | 69.6 | 141.3 | ~24 |

Minutes are an **estimate** at 10 seconds per step (`SECONDS_PER_STEP`); the counts are measured. Floor 5 "cleared" means the Hollow fell (damnation); grace ends the run on floor 4.

## Resources per floor (baseline, per run that reached the floor)

| Floor | Runs reaching it | Died there | Rests found | Bargains offered | Bargains taken | Heal items used | Loot left behind | Bargains per cleared floor | Bargain share of the table |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2500 | 21.9% | 1.89 | 1.87 | 1.36 | 1.08 | 0.00 | 2.07 | 16.7% |
| 2 | 1953 | 8.7% | 1.25 | 2.47 | 1.69 | 0.55 | 0.00 | 2.57 | 18.2% |
| 3 | 1783 | 18.1% | 1.09 | 2.21 | 1.48 | 1.34 | 0.04 | 2.34 | 18.2% |
| 4 | 1461 | 40.0% | 1.05 | 2.02 | 1.47 | 1.08 | 0.13 | 2.36 | 18.2% |
| 5 | 849 | 16.6% | 1.19 | 2.39 | 1.71 | 1.72 | 0.48 | 2.59 | 18.2% |

The last column is the data's expectation: a bargain is one weight in the floor's encounter table (`floors.json`), and bosses are not drawn from it.

## Baseline policy (no spare — the careful kill-everything run)

Equip found gear at the hub (greedy rarity rule), drink a found healing item at <= 35% HP, cast the best affordable skill, flee a near-certain death when no heal is left, otherwise fight; take any bargain not paid in HP, and shed the worst gear when the pack is full. Kills every foe.

- **Overall win-rate:** 29.4% (735 of 2500 runs) — 27 grace, 708 damnation, 1765 deaths.
- **Average final level:** 13.34 · **average floors cleared:** 2.42 (of 4 concluded floors on a full descent).

### Per class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 38.0% | 6 | 184 | 310 | 15.81 | 2.88 |
| Neuromancer | 500 | 18.0% | 5 | 85 | 410 | 9.89 | 1.79 |
| Scavver | 500 | 48.4% | 11 | 231 | 258 | 18.97 | 3.39 |
| Penitent | 500 | 16.0% | 3 | 77 | 420 | 9.35 | 1.72 |
| Hollow | 500 | 26.6% | 2 | 131 | 367 | 12.67 | 2.31 |

### Deaths per class × floor (where runs end)

| | Floor 1 | Floor 2 | Floor 3 | Floor 4 | Floor 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 547 | 170 | 322 | 585 | 141 |
| Enforcer | 47 | 32 | 71 | 130 | 30 |
| Neuromancer | 183 | 45 | 73 | 86 | 23 |
| Scavver | 13 | 6 | 36 | 150 | 53 |
| Penitent | 190 | 49 | 64 | 101 | 16 |
| Hollow | 114 | 38 | 78 | 118 | 19 |

## Merciful policy (spares ⚖ foes — exercises the grace path)

Identical to the baseline, except it releases a living ⚖ karma-weighted non-boss enemy on sight. It trades kill XP for positive karma, so it reaches the grace ending more often.

- **Overall win-rate:** 44.5% (1112 of 2500 runs) — 1107 grace, 5 damnation, 1388 deaths.
- **Average final level:** 11.76 · **average floors cleared:** 2.30 (of 4 concluded floors on a full descent).

### Per class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 57.2% | 284 | 2 | 214 | 13.66 | 2.70 |
| Neuromancer | 500 | 32.8% | 164 | 0 | 336 | 9.60 | 1.83 |
| Scavver | 500 | 62.6% | 311 | 2 | 187 | 14.65 | 2.87 |
| Penitent | 500 | 31.0% | 154 | 1 | 345 | 9.22 | 1.79 |
| Hollow | 500 | 38.8% | 194 | 0 | 306 | 11.65 | 2.32 |

### Deaths per class × floor (where runs end)

| | Floor 1 | Floor 2 | Floor 3 | Floor 4 | Floor 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 479 | 123 | 66 | 719 | 1 |
| Enforcer | 35 | 20 | 7 | 151 | 1 |
| Neuromancer | 168 | 34 | 13 | 121 | 0 |
| Scavver | 18 | 5 | 2 | 162 | 0 |
| Penitent | 171 | 38 | 18 | 118 | 0 |
| Hollow | 87 | 26 | 26 | 167 | 0 |

---

*Outcome vocabulary: **grace** = the floor-4 verdict ascension (net-positive karma); **damnation**
= descending to floor 5 and unmaking the Hollow Self; **death** = the player fell. Both grace and
damnation count as "wins" (the run reached an ending); death does not.*
