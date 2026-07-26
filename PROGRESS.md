# The Void — Build Progress

_Live tracker. Driven by `docs/ROADMAP.md`. Updated as the final step of any session that changes
build state._

**Overall: 0% of core milestones (M1–M11) complete**
`[--------------------]` 0/11

| Milestone | Status |
|---|---|
| M0 — Scaffold + loop system | ✅ |
| M1 — Core types + character model | 🔄 branch ready for review |
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
