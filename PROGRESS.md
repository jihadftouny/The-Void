# The Void — Build Progress

_Live tracker. Driven by `docs/ROADMAP.md`. Updated as the final step of any session that changes
build state._

> **⚠️ Direction change (2026-08-01):** The Void is pivoting to an **LLM-driven narrative game**.
> The M1–M11 roadmap below is the faithful Java port (a solid foundation), but the milestones and
> possibly the UI will be **re-scoped** around the LLM design. See memory
> `llm-driven-narrative-vision.md`; an interview + roadmap rewrite is the next session's first task.

**Overall: 0/11 core milestones merged — but M1–M10 are BUILT and awaiting your review/merge (three stacked branches).**
`[==================--]` 10/11 built (0 merged yet)

| Milestone | Status |
|---|---|
| M0 — Scaffold + loop system | ✅ |
| M1 — Core types + character model | 🔄 built (on `agentic/logic-core`) |
| M2 — Content data (JSON) | 🔄 built (on `agentic/logic-core`) |
| M3 — Player creation | 🔄 built (on `agentic/logic-core`) |
| M4 — Enemy generation | 🔄 built (on `agentic/logic-core`) |
| M5 — Combat resolution | 🔄 built (on `agentic/logic-core`) |
| M6 — Conditions + skills | 🔄 built (on `agentic/logic-core`) |
| M7 — Encounters (battle/rest/shop) | 🔄 built (on `agentic/logic-core`) |
| M8 — Progression + story | 🔄 built (on `agentic/logic-core`) |
| M9 — Save / load | 🔄 built + wired into UI (on `agentic/wire-save`) |
| M10 — Kaplay UI shell (mobile-first) | 🔄 built (on `agentic/ui-shell`) — playable on screen |
| M11 — Mobile polish | ⬜ |
| M12 — (stretch) Juice + PWA | ⬜ |

Legend: ⬜ not started · 🔄 in progress · ✅ done

## Session log

### 2026-08-01 — Save/load wired into the UI (+ LLM pivot noted)
- Integration unit `agentic/wire-save` (= ui-shell + save-load merged, then wiring): working
  "Continue" on the title, autosave between encounters + on act transitions, save cleared when a run
  ends, and a "Restart" on game-over. Injectable storage keeps the save policy headlessly tested.
  VERDICT PASS, 315 tests. Merge path simplifies to: logic-core → wire-save (wire-save subsumes
  save-load + ui-shell).
- **New direction:** user set the vision to an LLM-driven narrative game (stored in memory). Next
  session: interview + rewrite this roadmap. The port so far is the foundation, not the final shape.

### 2026-08-01 — Save/load + Kaplay UI shell, built in parallel (M9 + M10, awaiting review)
- Ran M9 and M10 as two PARALLEL pipeline units (disjoint file territories), both branched off
  `agentic/logic-core`, both VERDICT PASS, 0 fix rounds:
  - M9 (`agentic/save-load`): pure save/load core (safe encode/decode, corrupt-save rejection,
    version/migration seam) + a Node-safe browser localStorage adapter outside `src/game`. 31 new
    tests; logic core stays pure.
  - M10 (`agentic/ui-shell`): mobile-first, responsive Kaplay UI shell (portrait 540×1080,
    letterboxed, ≥44px touch targets, safe-area insets) that renders the pure `step` controller's
    events and dispatches input — every phase (title→creation→menu→battle→rest→shop→level-up→
    ending). Pure layout/routing/format helpers are unit-tested (30 tests); visual/mobile checks
    are human (see HUMAN-CHECKS.md). **The game is now playable on screen.**
- Save/load is NOT yet wired into the UI (title "Continue" is a disabled seam) — a small follow-up.
- Still unwinnable at faithful balance — balance pass pending your direction.
- Three stacked branches awaiting review/merge in order: logic-core → save-load → ui-shell.

### 2026-08-01 — Full Java logic port through the loop (M2–M8, awaiting review)
- Ran the whole game-logic port through the `agentic-engineering` loop in one worktree
  (`agentic/logic-core`, built on top of M1), in four plan→build→test stages, ALL VERDICT PASS:
  - Stage A (M2): all content as data — weapons/armor/elements/enemy-name tables/lore/story + loaders.
  - Stage B (M3+M4): player creation (class, 4d6-drop-lowest, starting gear) and enemy generation
    (procedural stats/name from XP; fixed the original's 1-HP-enemy gap using its own intended formula).
  - Stage C (M5+M6): pure event-based combat (attack rolls, advantage, crits, weapon mods, potions,
    flee) and the status-condition + skill systems.
  - Stage D (M7+M8): encounters (battle/rest/shop), act progression, level-up, story, final boss —
    culminating in a pure, serializable `step(state, input)` game controller that plays a full run
    headlessly. RNG made serializable so the whole run round-trips through JSON (M9 is now near-free).
- 237 tests green; logic core has zero renderer/DOM imports and zero `Math.random`/`Date.now`.
- **Known design decision surfaced:** the game is currently unwinnable at the faithful balance
  (enemy HP vs player HP) — engine is correct, numbers need a tuning pass. See HUMAN-CHECKS.md.
- Awaiting your review + merge of `agentic/logic-core` (contains M1–M8). Not merged.

### 2026-07-26 — M1 through the loop (awaiting review)
- First real pipeline run: `agentic/m1-character-core`. plan → build → test, VERDICT PASS, 0 fix rounds.
- Ported the character foundation from Java `Character.java` into pure `src/game/character.ts`:
  serializable `Character` type, `Stat` const (no bare indices), `computeStatMod(s)`
  (`10 - ceil(|stat-30|/2)`, capped at 10 for stat>30), `deriveArmorClass`, `deriveMaxHp`,
  `createCharacter`. 23 new tests, all expected values hand-derived. Total suite: 31 green.
- Awaiting your review + merge (the human gate). Not merged. Once merged, M1 flips to ✅ and M2 begins.

### 2026-07-26 — Project founded
- Ported the repo layout onto the spaceship-game-style stack: Vite 6 + Vitest 2 + TypeScript
  (strict) + **Kaplay** renderer. Old Java/Python/Pixi ports moved to `.legacy/`.
- Installed the **agentic "loop" engineering system**: `plan`/`build`/`test`/`retro` agents,
  `agentic-engineering` + `pipeline-retro` skills, `pipeline-log.md`, doctrine (`CLAUDE.md`,
  `docs/ROADMAP.md`, this file), `HUMAN-CHECKS.md`.
- Seeded RNG logic core (`src/game/rng.ts`) + tests; Kaplay title scene boots (M0 done).
- Next: drive the full Java port through the pipeline, milestone by milestone (M1 first).
