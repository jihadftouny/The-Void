# The Void

A text-based / dice RPG about a descent through five floors of the Void — inspired by lived experience of psychosis and by Dungeons & Dragons mechanics. Turn-based combat
on a seeded dice system, procedurally-named enemies, status conditions, skills, a shop and rest
encounters, XP-driven progression across five Acts, and a final boss.

**This is a from-scratch port** of the original Java implementation (`.legacy/The-Void/`) onto a
modern TypeScript stack, rendered with **Kaplay** (a lightweight 2D game library) and built with
**Vite** + **Vitest**. Earlier ports (`.legacy/The-Void-Py`, `.legacy/The-Void-Web`) are kept for
reference only — the Java version is the canonical source of game design.

## Load-bearing principles (these override any library convention or agent default)

1. **Pure logic / render split.** All game rules live in framework-agnostic TypeScript under
   `src/game` — no Kaplay, DOM, or canvas imports there, ever. Kaplay (under `src/render` and
   `src/scenes`) only draws state and forwards input. The logic core must run and be tested
   headlessly in Node.
2. **Deterministic seeded RNG.** Every gameplay random decision (dice, loot, encounters, enemy
   naming, prices) flows through the seeded RNG in `src/game/rng.ts`. Never call `Math.random()`
   or `Date.now()` inside `src/game` — a run must be reproducible from its seed, and tests must
   assert exact outcomes.
3. **Data-driven content.** Weapons, armor, items, elements, enemy name tables, lore, and story
   text live in JSON/data modules, not hard-coded in logic. Adding content never means editing
   combat code.
4. **Serializable plain-data state.** Game state is plain data that round-trips through JSON, so
   saves work and state is inspectable. No class instances, functions, or canvas objects in saved
   state.
5. **Mobile-first.** The game targets phones first. Design every scene for portrait, variable
   resolutions, and touch: Kaplay runs letterboxed at a fixed virtual resolution that scales to the
   device; interactive targets are ≥44px; respect safe-area insets. Test layouts at narrow widths
   before wide ones. This is a hard requirement, not a later polish pass.

When you override one of these for a specific reason, record the deviation and why.

## Stack

- TypeScript 5 (strict), Vite 6, Vitest 2, Kaplay (2D renderer). Node 18+.
- `npm run dev` — dev server. `npm run build` — typecheck (`tsc --noEmit`, which really checks
  `src`) + Vite build. `npm test` — Vitest (logic core only, headless node). `npm run typecheck`.

## Agentic engineering workflow (the "loop")

**Every task that adds or changes game code goes through the `agentic-engineering` skill** — invoke
it at task start. It decomposes the task into git worktrees (`worktrees/<slug>` inside the repo,
gitignored, branch `agentic/<slug>`) and runs `plan-agent` → `build-agent` → `test-agent` in each;
the engineer then reviews, merges, and ships manually. Never implement game code directly in the
main checkout. Docs, config, and `.claude/` infra changes are exempt.

The pipeline records every run to `.claude/pipeline-log.md`; the on-demand `pipeline-retro` skill
mines that log to propose improvements to the agents (generic) or this doctrine (project-specific).
Everything a human must verify by hand — every NEEDS-HUMAN item the test-agent surfaces, plus feel /
visual / mobile checks — is accumulated in **`HUMAN-CHECKS.md`** at the repo root.

## Progress tracking

`PROGRESS.md` (repo root) is the live build tracker, driven by the milestone roadmap at
`docs/ROADMAP.md`. As the final step of any session that changes the build state, update
`PROGRESS.md`: flip the milestone status (⬜/🔄/✅), tick completed sub-tasks, recompute the overall
%, and prepend a dated Session-log entry.

## Communication

Speak in plain language — define any unavoidable technical term in one clause. Prefer detailed and
clear over brief. For every error or bug, report in root-cause order: **What** (observed problem) →
**Why** (root cause, traced to origin) → **How we'll fix it** → **The fix implemented** → **TL;DR**.
