# The Void — Build Progress

_Live tracker. Driven by `docs/ROADMAP.md`. Updated as the final step of any session that changes
build state._

**Overall: 0% of core milestones (M1–M11) complete**
`[--------------------]` 0/11

| Milestone | Status |
|---|---|
| M0 — Scaffold + loop system | ✅ |
| M1 — Core types + character model | ⬜ |
| M2 — Content data (JSON) | ⬜ |
| M3 — Player creation | ⬜ |
| M4 — Enemy generation | ⬜ |
| M5 — Combat resolution | ⬜ |
| M6 — Conditions + skills | ⬜ |
| M7 — Encounters (battle/rest/shop) | ⬜ |
| M8 — Progression + story | ⬜ |
| M9 — Save / load | ⬜ |
| M10 — Kaplay UI shell (mobile-first) | ⬜ |
| M11 — Mobile polish | ⬜ |
| M12 — (stretch) Juice + PWA | ⬜ |

Legend: ⬜ not started · 🔄 in progress · ✅ done

## Session log

### 2026-07-26 — Project founded
- Ported the repo layout onto the spaceship-game-style stack: Vite 6 + Vitest 2 + TypeScript
  (strict) + **Kaplay** renderer. Old Java/Python/Pixi ports moved to `.legacy/`.
- Installed the **agentic "loop" engineering system**: `plan`/`build`/`test`/`retro` agents,
  `agentic-engineering` + `pipeline-retro` skills, `pipeline-log.md`, doctrine (`CLAUDE.md`,
  `docs/ROADMAP.md`, this file), `HUMAN-CHECKS.md`.
- Seeded RNG logic core (`src/game/rng.ts`) + tests; Kaplay title scene boots (M0 done).
- Next: drive the full Java port through the pipeline, milestone by milestone (M1 first).
