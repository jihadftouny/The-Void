# The Void — balance / winnability report

> **Generated** by `scripts/balance-report.ts` (`npx vite-node scripts/balance-report.ts`).
> Regenerate after any balance change; the numbers below are the harness's real output.

## NEEDS-HUMAN — the difficulty TARGET is unset (author call)

This report **measures** the current build; it does not judge it. Before the M15 tuning pass,
the author must set the difficulty **target**: the desired overall win-rate and the intended
"tough-but-fair" feel (for example, *"a careful run wins about 1 in 3; Act-1 enemies take ~3–4
hits"*). That target is a feel-call that cannot be derived headlessly — once it is set, this
report's numbers can be judged against it and the constants tuned to close the gap.

## What was measured

- **Build:** the stacked M1–M13 mechanical core (HEAD of `agentic/balance-sim`).
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

- **Baseline overall win-rate: 0.0%** (0 grace + 0 damnation of 2500).
- **Merciful overall win-rate: 0.0%** (0 grace + 0 damnation of 2500).
- Deaths peak at **Act 1** (98.0% of all baseline deaths).

## Biggest balance problems (read from the data)

- **Winnability is far below a "tough-but-fair" target.** The no-sacrifice baseline wins 0.0% of runs; even with equipment un-modelled (a lower bound), a fresh character rarely survives the descent.
- **Runs die overwhelmingly early — the peak is Act 1, holding 98.0% of all deaths.** This matches the standing note that Act-1 enemies (≈20–30 HP) out-scale a fresh character's ≈11–20 HP and low damage: the player cannot out-trade the very first floor, so almost nothing reaches the mid-game where leveling would compound.
- **Average floors cleared is only 0.04 of 4.** Progression stalls at the front of the run, not the back — the problem is the opening difficulty wall, not a late-game power spike.
- **The grace path is barely reachable without deliberate mercy.** The kill-everything baseline reaches grace 0 time(s); the merciful policy (spares ⚖ foes) reaches it 0 time(s). Grace requires surviving to the Act-4 verdict with net-positive karma, which the current survival rate makes vanishingly rare — mercy shifts the moral outcome but cannot fix the survival wall (merciful overall win-rate 0.0%).
- **Class spread is secondary to the global wall.** Per-class win-rates cluster low (see the tables); no class escapes the Act-1 bottleneck, so tuning should start with global early-game survivability (enemy HP/damage vs. starting HP/potions), then revisit per-class balance.

## Baseline policy (no sacrifice, no spare — the found-loot-only floor)

Reasonable engine-authoritative play: potion when low, cast the best affordable skill, flee a near-certain death when heals are gone, otherwise fight. Kills every foe (a spare forfeits the kill XP the act gates require).

- **Overall win-rate:** 0.0% (0 of 2500 runs) — 0 grace, 0 damnation, 2500 deaths.
- **Average final level:** 2.16 · **average floors cleared:** 0.04 (of 4 concluded floors on a full descent).

### Per-class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 0.0% | 0 | 0 | 500 | 2.16 | 0.01 |
| Neuromancer | 500 | 0.0% | 0 | 0 | 500 | 1.65 | 0.00 |
| Scavver | 500 | 0.0% | 0 | 0 | 500 | 3.30 | 0.17 |
| Penitent | 500 | 0.0% | 0 | 0 | 500 | 1.78 | 0.00 |
| Hollow | 500 | 0.0% | 0 | 0 | 500 | 1.91 | 0.00 |

### Deaths by act (where runs end)

| | Act 1 | Act 2 | Act 3 | Act 4 | Act 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 2450 | 22 | 18 | 10 | 0 |
| Enforcer | 497 | 3 | 0 | 0 | 0 |
| Neuromancer | 500 | 0 | 0 | 0 | 0 |
| Scavver | 453 | 19 | 18 | 10 | 0 |
| Penitent | 500 | 0 | 0 | 0 | 0 |
| Hollow | 500 | 0 | 0 | 0 | 0 |

## Merciful policy (spares ⚖ foes — exercises the grace path)

Identical to the baseline, except it releases a living ⚖ karma-weighted non-boss enemy on sight. This trades kill XP for positive karma, so it reaches the grace ending more often but survives less — it exists to show the grace path is reachable and how mercy shifts the death / grace / damnation split.

- **Overall win-rate:** 0.0% (0 of 2500 runs) — 0 grace, 0 damnation, 2500 deaths.
- **Average final level:** 2.21 · **average floors cleared:** 0.04 (of 4 concluded floors on a full descent).

### Per-class

| Class | Runs | Win% | Grace | Damnation | Deaths | Avg level | Avg floors cleared |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Enforcer | 500 | 0.0% | 0 | 0 | 500 | 2.26 | 0.01 |
| Neuromancer | 500 | 0.0% | 0 | 0 | 500 | 1.68 | 0.00 |
| Scavver | 500 | 0.0% | 0 | 0 | 500 | 3.32 | 0.18 |
| Penitent | 500 | 0.0% | 0 | 0 | 500 | 1.80 | 0.00 |
| Hollow | 500 | 0.0% | 0 | 0 | 500 | 1.98 | 0.00 |

### Deaths by act (where runs end)

| | Act 1 | Act 2 | Act 3 | Act 4 | Act 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All classes** | 2443 | 28 | 18 | 11 | 0 |
| Enforcer | 493 | 7 | 0 | 0 | 0 |
| Neuromancer | 500 | 0 | 0 | 0 | 0 |
| Scavver | 450 | 21 | 18 | 11 | 0 |
| Penitent | 500 | 0 | 0 | 0 | 0 |
| Hollow | 500 | 0 | 0 | 0 | 0 |

---

*Outcome vocabulary: **grace** = the Act-4 verdict ascension (net-positive karma); **damnation**
= descending to Act 5 and unmaking the Hollow Self; **death** = the player fell. Both grace and
damnation count as "wins" (the run reached an ending); death does not.*
