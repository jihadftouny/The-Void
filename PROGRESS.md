# The Void — Build Progress

_Live tracker. Driven by `docs/ROADMAP.md` (v2 — the LLM-driven narrative game). Updated as the
final step of any session that changes build state._

> **Direction (locked 2026-08-02):** The Void is an **LLM-driven narrative RPG** running a **local
> 3–4B model**, shipped as a **packaged desktop game** (Electron + node-llama-cpp, itch.io),
> desktop-first. Hybrid input (LLM-written choices + free text), engine-authoritative rules, master
> narrator + specialists, per-zone prompt files, enemy cards + boss agents, DOM text UI + Kaplay
> atmosphere. Full design record in `docs/ROADMAP.md`.

**v2 overall: 0/10 N-milestones done** `[--------------------]`

| Milestone (v2) | Status |
|---|---|
| N0 — Doctrine + v2 scaffolding | 🔄 (roadmap + doctrine written; held-branch decision pending) |
| N1 — Desktop shell + local-model spike | 🔄 spike GREEN + Electron shell BUILT (4B-only); awaiting your launch verify — branch `spike/n1-local-llm` |
| N2 — LLM runtime layer (pure core) | ⬜ |
| N3 — Narrator loop v1 (Floor 1 playable) | ⬜ |
| N4 — Engine-as-toolbox | ⬜ |
| N5 — Zone system (+ co-written content) | ⬜ |
| N6 — Enemy cards + boss agents | ⬜ |
| N7 — Narrative UI (DOM + Kaplay atmosphere) | ⬜ |
| N8 — Save/load v2 | ⬜ |
| N9 — Balance & playability | ⬜ |
| N10 — Package & ship (itch) | ⬜ |

**v1 foundation (Java port): built, verified, on held branches** — engine M1–M8
(`agentic/logic-core`), save/load + UI shell + wiring (`agentic/wire-save`, contains everything).
298–315 tests green across branches; merges cleanly (verified). Disposition: engine = the toolbox;
save/load carries over; UI shell partially reused. Merge decision deliberately **held** until N1/N2.

Legend: ⬜ not started · 🔄 in progress · ✅ done

## Session log

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
