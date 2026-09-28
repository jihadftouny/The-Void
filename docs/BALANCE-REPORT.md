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
**32.9%** of all baseline deaths, the modal death floor holds
**32.9%** (floor 1), and floors 1, 2, 3, 4 each hold ≥ 10% of deaths.
Every class wins (lowest baseline win-rate is Neuromancer). Committed anchor tests (`src/game/balance.test.ts`) hold the
floor-1 "~3–4 hits" feel and a winnability floor.

**The classes furthest below one in three:** **Neuromancer** wins 15.2%, and floor 2 took 13.7% of its deaths; **Penitent** wins 15.8%, and floor 2 took 12.6% of its deaths. Per §22.27 no class was tuned to close this. The three remedies on the table — strengthen that class elsewhere, accept it as a real build trade-off, or soften floor 2 for low-Wisdom builds — are the author's to choose, and the tables below are the evidence.

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

- **Baseline overall win-rate: 29.4%** (27 grace + 709 damnation of 2500).
- **Merciful overall win-rate: 44.2%** (1095 grace + 9 damnation of 2500).
- Deaths peak on **floor 1** (32.9% of all baseline deaths).

## Balance read (from the data)

- **Winnability vs the target.** The baseline wins 29.4% of runs — inside the 25.0%–35.0% "about 1 in 3" target. See the caveats above for what these numbers do and do not model.
- **Where deaths fall.** Floor 1 holds 32.9% of all deaths; the modal death floor is 1 at 32.9%, and 4 of the 5 floors each hold ≥ 10% of deaths (floors 1, 2, 3, 4).
- **The grace path stays a mercy choice.** The kill-everything baseline reaches grace 27 time(s); the merciful policy (spares ⚖ foes) reaches grace 1095 time(s), for an overall win-rate of 44.2%. Grace ends the run at floor 4; damnation descends to floor 5.
- **Per-class shape (author call, §22.27).** strongest **Scavver** (51.2%), weakest **Neuromancer** (15.2%); every class wins at least once over the sample.

## Floor 2 — the Wisdom question (the author's evidence, §22.27)

An illusory enemy's attacks are real and the player's are not; a passive Wisdom roll each
round (d20 + Wisdom modifier against the DC) is the only way through, and seeing through ends
the fight with no XP and no loot (plan Appendix A.1 — a pure cost, not softened).

### Illusions per class (baseline)

| Class | Runs reaching floor 2 | Illusions per run there | Rounds per illusion | HP lost per illusion | Seen through | Deaths inside an illusion | Floor-2 share of deaths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 451 | 2.41 | 2.39 | 0.61 | 98.8% | 6 | 12.2% |
| Neuromancer | 299 | 2.47 | 2.34 | 0.63 | 98.5% | 2 | 13.7% |
| Scavver | 482 | 2.48 | 2.38 | 0.32 | 99.4% | 2 | 2.9% |
| Penitent | 306 | 2.36 | 2.30 | 1.28 | 99.3% | 3 | 12.6% |
| Hollow | 382 | 2.39 | 2.31 | 0.68 | 98.0% | 9 | 13.2% |

### Illusions per class (merciful)

| Class | Runs reaching floor 2 | Illusions per run there | Rounds per illusion | HP lost per illusion | Seen through | Deaths inside an illusion | Floor-2 share of deaths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 455 | 2.47 | 2.34 | 0.56 | 99.8% | 2 | 9.6% |
| Neuromancer | 323 | 2.46 | 2.32 | 0.63 | 99.6% | 2 | 9.9% |
| Scavver | 478 | 2.36 | 2.38 | 0.28 | 99.8% | 0 | 4.9% |
| Penitent | 321 | 2.26 | 2.30 | 1.26 | 98.5% | 6 | 14.0% |
| Hollow | 411 | 2.32 | 2.42 | 0.77 | 99.4% | 4 | 11.6% |

### By starting Wisdom (baseline)

| Starting Wisdom | Runs | Win% | Floor-2 share of deaths |
| --- | ---: | ---: | ---: |
| ≤ 9 | 395 | 28.4% | 10.6% |
| 10–13 | 1215 | 29.8% | 13.0% |
| ≥ 14 | 890 | 29.4% | 10.0% |

Starting Wisdom ≥ 14 wins 29.4%; ≤ 9 wins 28.4% — a gap of 1.1 percentage points in favour of high Wisdom. Floor 2 took 10.0% of the high bucket's deaths and 10.6% of the low one's.

### By starting Wisdom (merciful)

| Starting Wisdom | Runs | Win% | Floor-2 share of deaths |
| --- | ---: | ---: | ---: |
| ≤ 9 | 395 | 41.8% | 8.3% |
| 10–13 | 1215 | 45.1% | 10.8% |
| ≥ 14 | 890 | 43.9% | 11.6% |

### `ILLUSION_DC` sensitivity — measured, NOT applied

| Illusion DC | Win% | Floor-2 deaths | Rounds per illusion | Win% at Wisdom ≤ 9 | Win% at Wisdom ≥ 14 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 11 | 30.0% | 183 | 1.89 | 26.8% | 30.7% |
| 13 (shipped) | 29.4% | 204 | 2.35 | 28.4% | 29.4% |
| 15 | 29.7% | 207 | 2.99 | 27.1% | 29.8% |

From DC 11 to DC 15 the baseline win rate moves 30.0% → 29.7% (a swing of 0.2 points) — a SMALL lever on the overall rate. The shipped DC 13 measures 29.4%. Measured with the DC injected into the sim; `ILLUSION_DC` was not edited.

## Floor length (G9) — over the runs that cleared each floor

| Floor | Runs that cleared it | Encounters | Battle rounds | Steps | Est. minutes (at 10 s/step) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 · Undercity | 1920 | 13.3 | 26.0 | 68.9 | ~11 |
| 2 · Entrance to the Void | 1716 | 14.9 | 25.9 | 73.0 | ~12 |
| 3 · Ash City | 1412 | 14.1 | 31.8 | 90.0 | ~15 |
| 4 · Angelic Underground | 866 | 13.1 | 41.5 | 96.5 | ~16 |
| 5 · True Void | 709 | 15.3 | 66.4 | 143.7 | ~24 |

Minutes are an **estimate** at 10 seconds per step (`SECONDS_PER_STEP`); the counts are measured. Floor 5 "cleared" means the Hollow fell (damnation); grace ends the run on floor 4.

## Resources per floor (baseline, per run that reached the floor)

| Floor | Runs reaching it | Died there | Rests found | Bargains offered | Bargains taken | Heal items used | Loot left behind | Bargains per cleared floor | Bargain share of the table |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2500 | 23.2% | 1.89 | 1.87 | 1.36 | 1.10 | 0.00 | 2.07 | 16.7% |
| 2 | 1920 | 10.6% | 1.20 | 2.49 | 1.69 | 0.60 | 0.00 | 2.59 | 18.2% |
| 3 | 1716 | 17.7% | 1.14 | 2.29 | 1.52 | 1.48 | 0.06 | 2.40 | 18.2% |
| 4 | 1412 | 38.7% | 1.05 | 2.03 | 1.48 | 1.03 | 0.14 | 2.44 | 18.2% |
| 5 | 839 | 15.5% | 1.25 | 2.54 | 1.82 | 1.70 | 0.51 | 2.66 | 18.2% |

The last column is the data's expectation: a bargain is one weight in the floor's encounter table (`floors.json`), and bosses are not drawn from it.

## Baseline policy (no spare — the careful kill-everything run)

Equip found gear at the hub (greedy rarity rule), drink a found healing item at <= 35% HP, cast the best affordable skill, flee a near-certain death when no heal is left, otherwise fight; take any bargain not paid in HP, and shed the worst gear when the pack is full. Kills every foe.

- **Overall win-rate:** 29.4% (736 of 2500 runs) — 27 grace, 709 damnation, 1764 deaths.
- **Average final level:** 13.11 · **average floors cleared:** 2.35 (of 4 concluded floors on a full descent).

### Per class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 36.0% | 5 | 175 | 320 | 15.51 | 2.83 |
| Neuromancer | 500 | 15.2% | 4 | 72 | 424 | 9.11 | 1.63 |
| Scavver | 500 | 51.2% | 11 | 245 | 244 | 19.22 | 3.40 |
| Penitent | 500 | 15.8% | 5 | 74 | 421 | 8.95 | 1.64 |
| Hollow | 500 | 29.0% | 2 | 143 | 355 | 12.78 | 2.28 |

### Deaths per class × floor (where runs end)

| | Floor 1 | Floor 2 | Floor 3 | Floor 4 | Floor 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 580 | 204 | 304 | 546 | 130 |
| Enforcer | 49 | 39 | 67 | 134 | 31 |
| Neuromancer | 201 | 58 | 61 | 83 | 21 |
| Scavver | 18 | 7 | 29 | 140 | 50 |
| Penitent | 194 | 53 | 75 | 90 | 9 |
| Hollow | 118 | 47 | 72 | 99 | 19 |

## Merciful policy (spares ⚖ foes — exercises the grace path)

Identical to the baseline, except it releases a living ⚖ karma-weighted non-boss enemy on sight. It trades kill XP for positive karma, so it reaches the grace ending more often.

- **Overall win-rate:** 44.2% (1104 of 2500 runs) — 1095 grace, 9 damnation, 1396 deaths.
- **Average final level:** 11.56 · **average floors cleared:** 2.24 (of 4 concluded floors on a full descent).

### Per class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 54.2% | 270 | 1 | 229 | 13.34 | 2.62 |
| Neuromancer | 500 | 33.0% | 165 | 0 | 335 | 9.46 | 1.78 |
| Scavver | 500 | 67.6% | 334 | 4 | 162 | 14.66 | 2.83 |
| Penitent | 500 | 29.8% | 145 | 4 | 351 | 9.12 | 1.71 |
| Hollow | 500 | 36.2% | 181 | 0 | 319 | 11.21 | 2.25 |

### Deaths per class × floor (where runs end)

| | Floor 1 | Floor 2 | Floor 3 | Floor 4 | Floor 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 512 | 149 | 79 | 654 | 2 |
| Enforcer | 45 | 22 | 11 | 151 | 0 |
| Neuromancer | 177 | 33 | 14 | 111 | 0 |
| Scavver | 22 | 8 | 6 | 125 | 1 |
| Penitent | 179 | 49 | 13 | 110 | 0 |
| Hollow | 89 | 37 | 35 | 157 | 1 |

---

*Outcome vocabulary: **grace** = the floor-4 verdict ascension (net-positive karma); **damnation**
= descending to floor 5 and unmaking the Hollow Self; **death** = the player fell. Both grace and
damnation count as "wins" (the run reached an ending); death does not.*
