# The Void

A **mechanics-first roguelike RPG with a local-LLM narrator** — a deep D&D-style game the engine
owns completely, with a language model narrating over the top. Inspired by lived experience of psychosis. A **local model** (**4B** — the only tier shipped, no cloud, no keys, no per-turn cost) narrates and
adapts to the player's choices; the deterministic engine owns every rule and number (dice combat,
status conditions, skills, sacrifice-deals/rest, XP across five Acts, bosses). Shipped as a
**packaged desktop game** (itch.io).

> **The Void is not a place — it is a condition, and the condition is the Hollow.** The fiction is
> authoritative in **`docs/WORLD.md`**; anything written before it is wrong where it disagrees.
> **`docs/README.md` indexes every document and states which one wins when two conflict.** Read
> both before writing prose, art prompts, or design. Systems live in `docs/GAME-DESIGN.md`, the
> milestone plan in `docs/ROADMAP.md` (v3), **every open item in the live register
> `docs/FINDINGS.md`**, **the work order in `docs/PLAN.md`**, and the frozen audit evidence in
> `docs/SCOPE-AUDIT.md`.

The engine is a from-scratch port of the original Java implementation (`.legacy/The-Void/`) on
TypeScript + **Vite** + **Vitest**. **Kaplay is a dependency that nothing imports yet** — reserved
for the **not-yet-built** canvas atmosphere layer (`docs/PLAN.md` #7). Earlier ports
(`.legacy/The-Void-Py`, `.legacy/The-Void-Web`) are reference only — the Java version is canonical
for the base mechanics.

## Guiding principle — always think long-term

**This is a multi-year product.** On every decision, prefer the choice that scales, stays
maintainable, and keeps future options open over the one that is merely fastest to ship now. When a
choice trades short-term convenience against long-term health, say so and recommend the durable
option; never buy a quick win with debt the roadmap (`docs/ROADMAP.md`) will later pay for. When the
engineer asks "which is better?", answer for the long term by default.

## Load-bearing principles

> **Refresh cadence — `docs/PRINCIPLES.md`.** That file is the distilled, portable statement of how
> we work (Part A universal, Part B software-specific). **Re-read it roughly every ~10 requests** —
> and whenever you start a new task, plan, review, or merge — so the working principles stay live in
> context and don't drift. It is the "why" behind the concrete rules below; when the two ever seem to
> conflict, the load-bearing rules here win, and note the deviation (per §A12).

These override any library convention or agent default. Where a convenient pattern conflicts with
one of these, follow the principle and record the deviation and why. Known traps already avoided:
game logic reaching into Kaplay/DOM (breaks headless testing), `Math.random`/`Date.now` in the logic
core (breaks reproducibility), and class instances/functions in saved state (breaks saves).

1. **Pure logic / render split.** All game rules live in framework-agnostic TypeScript under
   `src/game` — no Kaplay, DOM, or canvas imports there, ever. The render layer (`src/render`,
   `src/desktop`) only draws state and forwards input. **Every state change goes through `step`** —
   a run must be reproducible from `seed + inputs` alone, so the renderer never mutates state
   directly. The logic core must run and be tested headlessly in Node.
2. **Deterministic seeded RNG.** Every gameplay random decision (dice, loot, encounters, enemy
   naming, prices) flows through the seeded RNG in `src/game/rng.ts`. Never call `Math.random()` or
   `Date.now()` inside `src/game` — a run must be reproducible from its seed, and tests must assert
   exact outcomes.
3. **Data-driven content.** Weapons, armor, items, elements, enemy name tables, lore, story text,
   zone prompt files, and enemy cards live in JSON/data modules, not hard-coded in logic. Adding
   content never means editing combat code.
4. **Serializable plain-data state.** Game state is plain data that round-trips through JSON, so
   saves work and state is inspectable. No class instances, functions, or canvas objects in state.
5. **Engine-authoritative LLM.** The local model narrates and adjudicates *within* the rules — it
   selects which engine mechanics fire, but never invents numbers or mutates state directly; all
   outcomes flow through the engine. **The ENGINE writes all player choices** (decided 2026-08-25 —
   `docs/GAME-DESIGN.md` §10; the model-authored-choices plan is dropped). Every LLM output that does
   feed the game is grammar/JSON-constrained. The LLM layer (`src/llm`) is pure and headlessly
   testable against a fake model; the real model sits behind the runtime interface only.
6. **Desktop-first, responsive.** (Amended 2026-08-02 from mobile-first: local LLMs are weakest on
   phones.) Target desktop; keep layouts responsive so a mobile path (smaller model or engine-only
   mode) can come later. Narrative text renders as DOM; Kaplay is the atmosphere/effects layer.

## Stack & targets

- Node.js 18+, TypeScript 5 (strict), Vite 6, Vitest 2, Kaplay (atmosphere layer), DOM for
  narrative text. Desktop packaging: **Electron + node-llama-cpp** (GGUF **4B** model,
  grammar-constrained output). Electron is settled — N1 validated it; Tauri is not in play.
  **The model is downloaded once on first run, by design** (decided 2026-08-25): a small installer,
  a one-time ~2.5 GB fetch, then fully offline forever. Keeps the itch upload small and lets the
  model be upgraded without shipping a new build. **The store copy must say so honestly**, and the
  first-run flow needs a real failure path.
- **`npm run desktop` — run the game** (Electron). `npm run dev` serves `desktop.html` only and
  **cannot run outside Electron** (the renderer calls the Electron IPC at module scope).
  `npm run build` — typecheck (`tsc --noEmit`, which really checks `src`)
  + Vite build. `npm test` — Vitest (logic + llm cores, headless Node). `npm run typecheck`.
- **Min spec: a GPU is required** (decided 2026-08-26). The 4B model is the only tier shipped — the
  1.7B fallback the N1 spike recommended was rejected. On a no-GPU machine 4B measures ~7.6 tok/s
  and ~5 s to first token, against the 89 tok/s the narration cadence was designed on. **The store
  page must state this plainly.** The logic and LLM cores must still run and be tested headlessly in
  Node (fake model — never real inference in tests).

## Progress tracking

`PROGRESS.md` (repo root) is the live build tracker, driven by the milestone roadmap at
`docs/ROADMAP.md`. As the **final step of any session that changes the build state**, update
`PROGRESS.md`: flip the milestone status emoji (⬜/🔄/✅), tick completed sub-task checkboxes,
recompute the overall % (v3 runs **M0–M17**; all are counted), and
prepend a dated Session-log entry. Everything a human must verify by hand — every NEEDS-HUMAN item
the pipeline surfaces, plus feel/visual/mobile checks — is accumulated in `HUMAN-CHECKS.md`.

## Agentic engineering workflow

**Every task that adds or changes game code goes through the `agentic-engineering` skill** — invoke
it at task start. It decomposes the task into git worktrees (`worktrees/<slug>` inside the repo,
gitignored, branch `agentic/<slug>`) and runs `plan-agent` → `build-agent` → `test-agent` in each;
the engineer then reviews, merges, and ships manually. Never implement game code directly in the
main checkout. Docs, config, and `.claude/` infra changes are exempt.

**Running units in parallel:** before launching a SECOND concurrent unit, follow the clash-avoidance
rules in the `agentic-engineering` skill (§1b) — the ~2-heavy-+-1-light ceiling, the territory
cross-check (never parallelize units whose plans touch the same source file), the shared-wiring-file
rules, and the merge-order / post-merge-rebase / clash-resolution protocol. Units build in isolated
worktrees, so clashes can only surface at merge time — that section is how they're prevented and
resolved.

The pipeline records every run to `.claude/pipeline-log.md`; the on-demand `pipeline-retro` skill
mines that log to propose improvements to the agents (generic) or this doctrine (project-specific).

## Communication

Speak in plain language — no unexplained jargon; when a technical term is unavoidable, define it in
one clause. Prefer detailed and clear over brief. No jargon at all times.

**Milestone explainer — required.** Whenever a milestone completes, write a plain-language explainer
without being asked: what was built, why it was built that way (including the trade-offs and the
alternatives rejected), what the engineer should verify, and what it unlocks or constrains in later
milestones.

For every error or bug, report in root-cause order:
1. **What** — the observed problem.
2. **Why** — the root cause, traced to its origin, not the surface symptom.
3. **How we'll fix it** — the approach and why it resolves the root cause.
4. **The fix implemented** — what was actually changed.
5. **TL;DR** — a short recap at the end.
