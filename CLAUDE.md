# The Void

A text-based / dice RPG about a descent through five floors of the Void — inspired by lived experience of psychosis and by Dungeons & Dragons mechanics. Turn-based combat on a seeded
dice system, procedurally-named enemies, status conditions, skills, a shop and rest encounters,
XP-driven progression across five Acts, and a final boss.

**This is a from-scratch port** of the original Java implementation (`.legacy/The-Void/`) onto a
modern TypeScript stack, rendered with **Kaplay** (a lightweight 2D game library) and built with
**Vite** + **Vitest**. Earlier ports (`.legacy/The-Void-Py`, `.legacy/The-Void-Web`) are kept for
reference only — the Java version is the canonical source of game design.

## Guiding principle — always think long-term

**This is a multi-year product.** On every decision, prefer the choice that scales, stays
maintainable, and keeps future options open over the one that is merely fastest to ship now. When a
choice trades short-term convenience against long-term health, say so and recommend the durable
option; never buy a quick win with debt the roadmap (`docs/ROADMAP.md`) will later pay for. When the
engineer asks "which is better?", answer for the long term by default.

## Load-bearing principles

These override any library convention or agent default. Where a convenient pattern conflicts with
one of these, follow the principle and record the deviation and why. Known traps already avoided:
game logic reaching into Kaplay/DOM (breaks headless testing), `Math.random`/`Date.now` in the logic
core (breaks reproducibility), and class instances/functions in saved state (breaks saves).

1. **Pure logic / render split.** All game rules live in framework-agnostic TypeScript under
   `src/game` — no Kaplay, DOM, or canvas imports there, ever. Kaplay (under `src/render` and
   `src/scenes`) only draws state and forwards input. The logic core must run and be tested
   headlessly in Node.
2. **Deterministic seeded RNG.** Every gameplay random decision (dice, loot, encounters, enemy
   naming, prices) flows through the seeded RNG in `src/game/rng.ts`. Never call `Math.random()` or
   `Date.now()` inside `src/game` — a run must be reproducible from its seed, and tests must assert
   exact outcomes.
3. **Data-driven content.** Weapons, armor, items, elements, enemy name tables, lore, and story text
   live in JSON/data modules, not hard-coded in logic. Adding content never means editing combat code.
4. **Serializable plain-data state.** Game state is plain data that round-trips through JSON, so
   saves work and state is inspectable. No class instances, functions, or canvas objects in state.
5. **Mobile-first.** The game targets phones first. Design every scene for portrait, variable
   resolutions, and touch: Kaplay runs letterboxed at a fixed virtual resolution that scales to the
   device; interactive targets are ≥44px; respect safe-area insets. Test layouts at narrow widths
   before wide ones. This is a hard requirement, not a later polish pass.

## Stack & targets

- Node.js 18+, TypeScript 5 (strict), Vite 6, Vitest 2, Kaplay (2D renderer).
- `npm run dev` — dev server. `npm run build` — typecheck (`tsc --noEmit`, which really checks `src`)
  + Vite build. `npm test` — Vitest (logic core, headless Node). `npm run typecheck`.
- Mobile-first: every scene must account for portrait orientation, variable resolution, touch input,
  and safe-area insets. The logic core must run and be tested headlessly in Node.

## Progress tracking

`PROGRESS.md` (repo root) is the live build tracker, driven by the milestone roadmap at
`docs/ROADMAP.md`. As the **final step of any session that changes the build state**, update
`PROGRESS.md`: flip the milestone status emoji (⬜/🔄/✅), tick completed sub-task checkboxes,
recompute the overall % (M1–M11 are the core milestones; M12 is a stretch goal, not counted), and
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
