# The Void — Build Progress

_Live tracker. Driven by `docs/ROADMAP.md` (v3 — the mechanics-first roguelike). Design record:
`docs/GAME-DESIGN.md`. Updated as the final step of any session that changes build state._

> **Direction (scope locked 2026-08-05):** The Void is a **mechanics-first roguelike RPG** — a deep
> D&D-style game with a **local-LLM narrator** over the top (engine owns all rules/numbers). Five-floor
> psyche-descent, die-and-restart with **unlocks-only** meta-progression, a **hidden multi-axis karma
> ("Nature")** that bends world + mechanics and resolves into a **blended ending** (floor 4 is the
> karma reckoning). Full-depth systems: classes + signature skills, 24 conditions, ~24 enemy families +
> affixes, 5 boss agents, Tibia-style inventory, relics + uniques + rich consumables, thematic economy.
> Design in `docs/GAME-DESIGN.md`; milestone plan in `docs/ROADMAP.md`.

**v3 overall: 1/18 merged · M1–M8 built+verified (pending your batch merge)** `[#########-----------]`
Autonomous run (2026-08-10): building the mechanical milestones through the loop, **stacked & unmerged**
per your merge gate — you review/merge the chain. Chain: `main` → M1 `state-foundations` → M2
`skills-conditions` → M3 `class-kits` → M4 `combat-defense` → M5 `equip-engine` → M6 `items-content`
→ M7 `sacrifice-economy` → M8 `enemy-roster`. Each PASSED plan→build→test (typecheck + full tests +
build + adversarial verify). 691 tests at M8.

| Milestone (v3) | Status |
|---|---|
| M0 — Consolidate base & reconcile to mechanics-first | ✅ merged to `main` (378 tests) |
| M1 — Foundational state models (karma + item schema + inventory) | ✅ built+verified — branch `agentic/state-foundations` (411 tests), pending merge |
| M2 — Player skills + full 24-condition system | ✅ built+verified — `agentic/skills-conditions` (456 tests), pending merge |
| M3 — Classes & signature kits | ✅ built+verified — `agentic/class-kits` (494 tests), pending merge |
| M4 — Combat overhaul: defense matters (enemies roll to-hit) | ✅ built+verified — `agentic/combat-defense` (526 tests), pending merge |
| M5 — Inventory & equipment (Tibia-style) ★ | 🔶 ENGINE built+verified — `agentic/equip-engine` (561 tests); **Tibia visual UI deferred to a collab pass w/ you** |
| M6 — Items content: relics, uniques, consumables | ✅ built+verified — `agentic/items-content` (625 tests); 15 relics + 4 uniques + 19 consumables + effect/trigger system + rarity gen; flavor co-write & in-UI display pending |
| M7 — Loot sourcing & thematic economy | ✅ built+verified — `agentic/sacrifice-economy` (649 tests); **gold removed**, pure sacrifice-deals + loot drops + chests; karma-shift deals feed the pillar; balance/in-UI pending |
| M8 — Enemies: families, affixes, karma-weighting | ✅ built+verified — `agentic/enemy-roster` (691 tests); 24 families + 5 affixes + spare action (9 ⚖ families feed karma); complex behaviors/flavor → M10, in-UI pending |
| M6 — Items content: relics, uniques, consumables | ⬜ |
| M7 — Loot sourcing & thematic economy | ⬜ |
| M8 — Enemies: families, affixes, karma-weighting | ⬜ |
| M9 — In-run progression (frequent level-up picks) | ⬜ |
| M10 — The five floors: content, mechanics, karma effects ★★ | ⬜ |
| M11 — LLM layer to spec (narrate+choices, floor voices, boss-agent infra) | ⬜ (working narrator slice exists; not yet to spec) |
| M12 — Bosses: five unique encounters as agents | ⬜ |
| M13 — Meta-progression: unlocks & mastery feats | ⬜ |
| M14 — Karma payoff: blended-spectrum endings | ⬜ |
| M15 — Balance pass (tough but fair), sim-verified | ⬜ |
| M16 — Polish & game-feel | ⬜ |
| M17 — Package & ship (itch) | ⬜ |

**Pre-M0 base (built, verified, on a stacked review branch awaiting merge):** deterministic engine
(combat/stats/2 stub classes/act-gated leveling/enemies/11-of-24 conditions/shop/rest/gold/5-act/final
boss/`step` controller), save/load, Kaplay UI shell, desktop Electron app w/ local LLM narrator
(full run narrated), device-agnostic GPU selection, shared model-cache. ~378 tests green. The v1 Java
port (M1–M10) and v2 LLM work (N1–N3) are subsumed here as the base and as M11–M12.

Legend: ⬜ not started · 🔄 in progress · ✅ done · ★ first big new system · ★★ mechanics-first game realized

## Session log

### 2026-08-10 — M0 complete: consolidated to a single `main` trunk ✅
- Merged the verified stack into **`main`** (user-gated, approved): `agentic/gpu-fix` (all engine +
  desktop LLM + GPU-fix code, clean ff) then `spike/n1-local-llm` (v3 design docs + doc-history) —
  both auto-merged, **zero conflicts**.
- **Post-merge verification on `main`:** `npm run typecheck` clean, **378/378 tests pass**,
  `npm run build` OK.
- Cleaned up: removed 8 merged unit worktrees + deleted their branches. **Kept as safety refs:**
  `spike/n1-local-llm` (fully merged) and `agentic/logic-core` (content is in `main` via wire-save,
  but its original commits aren't ancestors — not force-deleted during consolidation). One stale
  `worktrees/gpu-fix` dir is OS-locked (harmless cruft; clears later).
- Design brainstorm is complete (all systems locked in `docs/GAME-DESIGN.md`); the full design also
  co-decided the class roster, floors+bosses, karma model, enemies, economy, items, status effects,
  level-up loop, and meta-progression this session.
- **Next: M1** — foundational state models (four-axis karma vector, item/inventory schema, standard
  D&D stat formula) through the agentic loop (plan → build → test in a worktree off `main`).

### 2026-08-05 — Full scope interview + mechanics-first re-scope (M0 docs)
- Ran a thorough scope interview. **Recalibrated to mechanics-first** (deep RPG is the heart; LLM
  narrates over it) and expanded scope: several distinct classes w/ signature kits, player skills +
  all 24 conditions, ~24 enemy families + affixes, 5 boss agents, full Tibia-style inventory,
  build-defining relic trinkets, authored uniques + rarity-scaling, rich consumables, drops+chests+
  shops loot, thematic economy, unlocks-only meta-progression, hidden multi-axis karma with a
  blended-spectrum ending, and the locked five-floor spine (Undercity → Entrance to the Void → Ash
  City → Angelic Underground → True Void). Karma is live from floor 1; **floor 4 is the reckoning**
  (carried karma × floor-4 choices decides grace vs. cast-down).
- Wrote **`docs/GAME-DESIGN.md`** (authoritative WHAT, decisions tagged DECIDED/PROPOSAL/OPEN) and
  rewrote **`docs/ROADMAP.md` → v3** (18-milestone plan mirroring the spaceship game's format).
  Reconciled this tracker. `CLAUDE.md` top line ("LLM-driven narrative RPG") flagged for a one-line
  mechanics-first tweak (user's file — not auto-changed).
- Also this session: fixed the device-agnostic GPU selection (kept the verified `gpu-fix`; removed an
  accidental duplicate `gpu-discrete`); rebuilt the `gpu-fix` worktree for the user's real-hardware check.
- Next: brainstorm the [OPEN] items (classes, floors+bosses, karma axes) → then M0 merge (gated) → M1.

### 2026-08-02 — Playable LLM game slice (N1 shell + N2 narration + N3 loop)
- Merged the engine (`agentic/wire-save`) into `spike/n1-local-llm` (build step, not the gated
  merge-to-main), giving the branch: engine + save/load + Kaplay UI + the N1 Electron shell.
- Wired the real game: pure `src/llm/narrate.ts` (engine events+state → narration prompt, tested) +
  DOM renderer `src/desktop/game.ts` that drives the engine `step` loop, streams the 4B narrator per
  beat over the N1 IPC, and shows engine-authoritative choices for every phase (title→creation→
  battle→rest→shop→level-up→ending→game-over) with a live character/enemy sheet. Falls back to plain
  facts if the model errs (engine stays authoritative).
- Removed the N1 proof shell; `desktop.html` now loads the game. typecheck clean, 319 tests, build OK.
- **A full run is now playable end-to-end in the desktop app**, LLM-narrated. Remaining is
  fine-tuning (grammar-constrained choices, zone prompts, enemy cards, balance, packaging).
- Next: your visual `npm run desktop` play-test.

### 2026-08-02 — N1 local-LLM spike: GREEN
- Built `scripts/spike-llm.mjs` (node-llama-cpp) on branch `spike/n1-local-llm`; ran on the dev
  laptop (RTX 5060). Downloaded Qwen3-4B-Instruct-2507 + Qwen3-1.7B (Q4_K_M GGUF).
- Verdict: **local-LLM design is viable.** Streaming works; grammar-constrained JSON
  (narration + choices) works; prose is good and on-theme. Numbers + recommendation in
  `docs/N1-SPIKE.md`. Qwen3 = Apache-2.0 (clean to bundle).
- Recommend: ship both models, auto-select by hardware — 4B default/quality, 1.7B no-GPU floor.
- Deviation (recorded in pipeline-log): the spike ran OUTSIDE the plan→build→test pipeline
  (exploratory + native deps + 3.6GB models + human-hardware measurement the test-agent can't do).
- Next: N1b (Electron desktop shell) — awaiting the user's go-ahead + model-tiering decision.

### 2026-08-02 — The design interview + v2 re-scope (N0)
- Ran the full scoping interview (on Fable, per the user's request). Locked: hybrid input; LLM
  adjudicates within rules (engine owns all numbers); engine-as-toolbox; master narrator +
  specialists; tiered enemies (cards + boss agents); zone prompts owning tone/encounters/mechanics/
  beats; **local LLM** (no cloud/keys/cost); **packaged desktop game** on itch; desktop-first
  (mobile later); min spec = no-GPU laptop → 3–4B model; streaming narration; DOM text + Kaplay
  atmosphere UI; zones co-written author+Claude; held branches decided later.
- Rewrote `docs/ROADMAP.md` (v2, N0–N10), this tracker, and CLAUDE.md doctrine (desktop-first
  amendment + local-LLM principle).
- Next: N1 — desktop shell + local-model spike (through the loop).

### 2026-08-01 — Save/load wired into the UI (+ LLM pivot noted)
- Integration unit `agentic/wire-save` (= ui-shell + save-load merged, then wiring): working
  "Continue" on the title, autosave between encounters + on act transitions, save cleared when a run
  ends, and a "Restart" on game-over. Injectable storage keeps the save policy headlessly tested.
  VERDICT PASS, 315 tests. Merge path simplifies to: logic-core → wire-save (wire-save subsumes
  save-load + ui-shell).
- **New direction:** user set the vision to an LLM-driven narrative game (stored in memory).

### 2026-08-01 — Save/load + Kaplay UI shell, built in parallel (M9 + M10)
- Ran M9 and M10 as two PARALLEL pipeline units (disjoint file territories), both branched off
  `agentic/logic-core`, both VERDICT PASS, 0 fix rounds:
  - M9 (`agentic/save-load`): pure save/load core (safe encode/decode, corrupt-save rejection,
    version/migration seam) + a Node-safe browser localStorage adapter outside `src/game`. 31 new
    tests; logic core stays pure.
  - M10 (`agentic/ui-shell`): mobile-first, responsive Kaplay UI shell (portrait 540×1080,
    letterboxed, ≥44px touch targets, safe-area insets) rendering the pure `step` controller.
    **The game became playable on screen.**

### 2026-08-01 — Full Java logic port through the loop (M2–M8)
- Ran the whole game-logic port through the `agentic-engineering` loop in one worktree
  (`agentic/logic-core`, built on top of M1), in four plan→build→test stages, ALL VERDICT PASS:
  - Stage A (M2): all content as data — weapons/armor/elements/enemy-name tables/lore/story + loaders.
  - Stage B (M3+M4): player creation and enemy generation (fixed the original's 1-HP-enemy gap).
  - Stage C (M5+M6): pure event-based combat + status conditions + skills.
  - Stage D (M7+M8): encounters, act progression, level-up, story, final boss — capped by a pure,
    serializable `step(state, input)` controller that plays a full run headlessly.
- 237 tests green; logic core has zero renderer/DOM imports and zero `Math.random`/`Date.now`.
- Known: game unwinnable at faithful balance (now deferred into N9, where narrator pacing changes
  the question).

### 2026-07-26 — M1 through the loop
- First pipeline run: `agentic/m1-character-core` (superseded by logic-core). plan → build → test,
  VERDICT PASS. Character foundation: serializable `Character`, `Stat` const, mod formula
  (`10 - ceil(|stat-30|/2)`), AC/HP derivation. 23 tests, hand-derived values.

### 2026-07-26 — Project founded
- Repo layout on the modern stack: Vite 6 + Vitest 2 + TypeScript (strict) + Kaplay. Old
  Java/Python/Pixi ports moved to `.legacy/`.
- Installed the agentic "loop": plan/build/test/retro agents, `agentic-engineering` +
  `pipeline-retro` skills, `pipeline-log.md`, doctrine, `HUMAN-CHECKS.md`.
- Seeded RNG logic core + tests; Kaplay title scene boots (M0).
