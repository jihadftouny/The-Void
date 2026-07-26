# Pipeline run log

Durable evidence trail for the agentic-engineering pipeline. Newest first. Each
run records what happened so the `pipeline-retro` skill can later mine it for
agent/doctrine improvements. The `.agentic/` folders are ephemeral and vanish
with their worktrees — this file is the only lasting record.

Format per entry:

```
## <date> — <slug>
- Verdict: PASS | FAILED | re-planned
- Fix rounds: <n>
- Build-agent deviations: <notable ones, or none>
- Test failures before fixes: <kinds, or none>
- Plan open-questions: <any, or none>
- Manual engineer fixes: none yet
```

---

## 2026-07-26 — m1-character-core
- Verdict: PASS (awaiting engineer review/merge)
- Fix rounds: 0
- Build-agent deviations: none (pre-recorded in plan: fresh-char AC/maxHp use CON per GameLogic.startGame, not DEX per Player.setArmorClass — matched intentionally)
- Test failures before fixes: none
- Plan open-questions: none
- Notes: pipeline run with general-purpose agents carrying the plan/build/test role files (named subagent types register next session). Tester independently hand-verified the mod formula and flagged an off-by-one in the orchestrator's own prompt example (assertions were correct). 31 tests green.
- Manual engineer fixes: none yet
