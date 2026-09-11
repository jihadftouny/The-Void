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

**Result — MET.** Baseline overall win-rate **30.6%**; floor 1 holds
**33.2%** of all baseline deaths, the modal death floor holds
**33.2%** (floor 1), and floors 1, 2, 3, 4 each hold ≥ 10% of deaths.
Every class wins (lowest baseline win-rate is Neuromancer). Committed anchor tests (`src/game/balance.test.ts`) hold the
floor-1 "~3–4 hits" feel and a winnability floor.

**The classes furthest below one in three:** **Neuromancer** wins 17.8%, and floor 2 took 13.1% of its deaths; **Penitent** wins 18.2%, and floor 2 took 14.2% of its deaths. Per §22.27 no class was tuned to close this. The three remedies on the table — strengthen that class elsewhere, accept it as a real build trade-off, or soften floor 2 for low-Wisdom builds — are the author's to choose, and the tables below are the evidence.

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
| T3 | `HOLLOW_GATE_XP` (`progression.ts`) | 500 | 600 | Back to its first derived value (~7.5 floor-5 kills, like floors 3 and 4). It had been lowered only to clear the old 0.12 guard by coincidence (AC-29); the re-run measured floor 5 as the softest floor of the descent. | baseline win rate 0.321 -> 0.306; floor-5 deaths 106 -> 142 |

**Frozen — not moved by this tuning:**

- `ILLUSION_DC` = 13 (§22.27, plan Appendix A.4) — measured at 11 and 15 below, never edited
- every per-class number: hit dice, class kits, starting gear, evasion
- the author's rulings: the illusion chance (one fight in three) and the floor-4 karma multiplier

## Headline

- **Baseline overall win-rate: 30.6%** (37 grace + 729 damnation of 2500).
- **Merciful overall win-rate: 48.6%** (1212 grace + 4 damnation of 2500).
- Deaths peak on **floor 1** (33.2% of all baseline deaths).

## Balance read (from the data)

- **Winnability vs the target.** The baseline wins 30.6% of runs — inside the 25.0%–35.0% "about 1 in 3" target. See the caveats above for what these numbers do and do not model.
- **Where deaths fall.** Floor 1 holds 33.2% of all deaths; the modal death floor is 1 at 33.2%, and 4 of the 5 floors each hold ≥ 10% of deaths (floors 1, 2, 3, 4).
- **The grace path stays a mercy choice.** The kill-everything baseline reaches grace 37 time(s); the merciful policy (spares ⚖ foes) reaches grace 1212 time(s), for an overall win-rate of 48.6%. Grace ends the run at floor 4; damnation descends to floor 5.
- **Per-class shape (author call, §22.27).** strongest **Scavver** (57.4%), weakest **Neuromancer** (17.8%); every class wins at least once over the sample.

## Floor 2 — the Wisdom question (the author's evidence, §22.27)

An illusory enemy's attacks are real and the player's are not; a passive Wisdom roll each
round (d20 + Wisdom modifier against the DC) is the only way through, and seeing through ends
the fight with no XP and no loot (plan Appendix A.1 — a pure cost, not softened).

### Illusions per class (baseline)

| Class | Runs reaching floor 2 | Illusions per run there | Rounds per illusion | HP lost per illusion | Seen through | Deaths inside an illusion | Floor-2 share of deaths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 444 | 2.47 | 2.47 | 0.66 | 96.4% | 12 | 15.0% |
| Neuromancer | 310 | 2.20 | 2.31 | 0.56 | 95.0% | 12 | 13.1% |
| Scavver | 486 | 2.49 | 2.41 | 0.31 | 98.3% | 5 | 5.2% |
| Penitent | 295 | 2.34 | 2.38 | 1.19 | 93.8% | 15 | 14.2% |
| Hollow | 389 | 2.37 | 2.39 | 0.79 | 96.4% | 11 | 12.7% |

### Illusions per class (merciful)

| Class | Runs reaching floor 2 | Illusions per run there | Rounds per illusion | HP lost per illusion | Seen through | Deaths inside an illusion | Floor-2 share of deaths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 465 | 2.41 | 2.55 | 0.67 | 97.9% | 4 | 11.5% |
| Neuromancer | 346 | 2.10 | 2.42 | 0.63 | 97.0% | 5 | 16.9% |
| Scavver | 487 | 2.61 | 2.35 | 0.23 | 99.5% | 0 | 6.0% |
| Penitent | 311 | 2.21 | 2.40 | 1.16 | 95.2% | 8 | 12.8% |
| Hollow | 414 | 2.35 | 2.52 | 0.70 | 96.7% | 9 | 13.2% |

### By starting Wisdom (baseline)

| Starting Wisdom | Runs | Win% | Floor-2 share of deaths |
| --- | ---: | ---: | ---: |
| ≤ 9 | 395 | 27.6% | 11.9% |
| 10–13 | 1215 | 31.1% | 12.3% |
| ≥ 14 | 890 | 31.3% | 13.6% |

Starting Wisdom ≥ 14 wins 31.3%; ≤ 9 wins 27.6% — a gap of 3.8 percentage points in favour of high Wisdom. Floor 2 took 13.6% of the high bucket's deaths and 11.9% of the low one's.

### By starting Wisdom (merciful)

| Starting Wisdom | Runs | Win% | Floor-2 share of deaths |
| --- | ---: | ---: | ---: |
| ≤ 9 | 395 | 47.1% | 12.0% |
| 10–13 | 1215 | 50.3% | 12.9% |
| ≥ 14 | 890 | 47.1% | 13.6% |

### `ILLUSION_DC` sensitivity — measured, NOT applied

| Illusion DC | Win% | Floor-2 deaths | Rounds per illusion | Win% at Wisdom ≤ 9 | Win% at Wisdom ≥ 14 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 11 | 31.0% | 210 | 1.98 | 29.1% | 30.1% |
| 13 (shipped) | 30.6% | 220 | 2.40 | 27.6% | 31.3% |
| 15 | 29.7% | 235 | 3.15 | 27.1% | 28.4% |

From DC 11 to DC 15 the baseline win rate moves 31.0% → 29.7% (a swing of 1.3 points) — a SMALL lever on the overall rate. The shipped DC 13 measures 30.6%. Measured with the DC injected into the sim; `ILLUSION_DC` was not edited.

## Floor length (G9) — over the runs that cleared each floor

| Floor | Runs that cleared it | Encounters | Battle rounds | Steps | Est. minutes (at 10 s/step) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 · Undercity | 1924 | 13.5 | 28.1 | 67.8 | ~11 |
| 2 · Entrance to the Void | 1704 | 15.0 | 27.2 | 70.9 | ~12 |
| 3 · Ash City | 1407 | 14.1 | 33.9 | 84.4 | ~14 |
| 4 · Angelic Underground | 908 | 13.3 | 48.5 | 102.4 | ~17 |
| 5 · True Void | 729 | 15.4 | 72.1 | 138.6 | ~23 |

Minutes are an **estimate** at 10 seconds per step (`SECONDS_PER_STEP`); the counts are measured. Floor 5 "cleared" means the Hollow fell (damnation); grace ends the run on floor 4.

## Resources per floor (baseline, per run that reached the floor)

| Floor | Runs reaching it | Rests found | Bargains offered | Bargains taken | Heal items used | Loot left behind | Bargains per cleared floor | Bargain share of the table |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2500 | 1.92 | 1.90 | 1.41 | 1.36 | 0.00 | 2.12 | 16.7% |
| 2 | 1924 | 1.25 | 2.44 | 1.69 | 0.67 | 0.00 | 2.58 | 18.2% |
| 3 | 1704 | 1.15 | 2.33 | 1.55 | 1.44 | 0.03 | 2.44 | 18.2% |
| 4 | 1407 | 1.06 | 2.11 | 1.56 | 1.16 | 0.13 | 2.44 | 18.2% |
| 5 | 871 | 1.20 | 2.45 | 1.77 | 1.64 | 0.43 | 2.63 | 18.2% |

The last column is the data's expectation: a bargain is one weight in the floor's encounter table (`floors.json`), and bosses are not drawn from it.

## Baseline policy (no spare — the careful kill-everything run)

Equip found gear at the hub (greedy rarity rule), drink a found healing item at <= 35% HP, cast the best affordable skill, flee a near-certain death when no heal is left, otherwise fight; take any bargain not paid in HP, and shed the worst gear when the pack is full. Kills every foe.

- **Overall win-rate:** 30.6% (766 of 2500 runs) — 37 grace, 729 damnation, 1734 deaths.
- **Average final level:** 13.17 · **average floors cleared:** 2.36 (of 4 concluded floors on a full descent).

### Per class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 32.0% | 8 | 152 | 340 | 14.84 | 2.75 |
| Neuromancer | 500 | 17.8% | 4 | 85 | 411 | 9.89 | 1.74 |
| Scavver | 500 | 57.4% | 18 | 269 | 213 | 19.48 | 3.42 |
| Penitent | 500 | 18.2% | 4 | 87 | 409 | 8.99 | 1.59 |
| Hollow | 500 | 27.8% | 3 | 136 | 361 | 12.64 | 2.31 |

### Deaths per class × floor (where runs end)

| | Floor 1 | Floor 2 | Floor 3 | Floor 4 | Floor 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 576 | 220 | 297 | 499 | 142 |
| Enforcer | 56 | 51 | 59 | 124 | 50 |
| Neuromancer | 190 | 54 | 61 | 81 | 25 |
| Scavver | 14 | 11 | 35 | 111 | 42 |
| Penitent | 205 | 58 | 64 | 77 | 5 |
| Hollow | 111 | 46 | 78 | 106 | 20 |

## Merciful policy (spares ⚖ foes — exercises the grace path)

Identical to the baseline, except it releases a living ⚖ karma-weighted non-boss enemy on sight. It trades kill XP for positive karma, so it reaches the grace ending more often.

- **Overall win-rate:** 48.6% (1216 of 2500 runs) — 1212 grace, 4 damnation, 1284 deaths.
- **Average final level:** 11.85 · **average floors cleared:** 2.27 (of 4 concluded floors on a full descent).

### Per class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 58.2% | 291 | 0 | 209 | 13.73 | 2.68 |
| Neuromancer | 500 | 34.8% | 173 | 1 | 326 | 9.72 | 1.84 |
| Scavver | 500 | 73.4% | 364 | 3 | 133 | 15.05 | 2.90 |
| Penitent | 500 | 31.4% | 157 | 0 | 343 | 9.00 | 1.67 |
| Hollow | 500 | 45.4% | 227 | 0 | 273 | 11.73 | 2.29 |

### Deaths per class × floor (where runs end)

| | Floor 1 | Floor 2 | Floor 3 | Floor 4 | Floor 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 477 | 167 | 56 | 580 | 4 |
| Enforcer | 35 | 24 | 8 | 140 | 2 |
| Neuromancer | 154 | 55 | 11 | 106 | 0 |
| Scavver | 13 | 8 | 2 | 108 | 2 |
| Penitent | 189 | 44 | 8 | 102 | 0 |
| Hollow | 86 | 36 | 27 | 124 | 0 |

---

*Outcome vocabulary: **grace** = the floor-4 verdict ascension (net-positive karma); **damnation**
= descending to floor 5 and unmaking the Hollow Self; **death** = the player fell. Both grace and
damnation count as "wins" (the run reached an ending); death does not.*
