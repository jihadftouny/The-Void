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

## 2026-08-01 — logic-core (M2–M8, full Java logic port)
- Verdict: PASS (all 4 stages; awaiting engineer review/merge). Contains M1–M8; supersedes m1-character-core.
- Fix rounds: 0 across all four stages.
- Stages (each plan→build→test, all VERDICT PASS): A=M2 content; B=M3+M4 player/enemy; C=M5+M6 combat/conditions; D=M7+M8 encounters/progression + pure step() controller.
- Build-agent deviations (all recorded in-branch): 7-slot resistances (Java had 6); enemy maxHp uses the Java's own unused `dmgCalculator` formula (Java shipped 1-HP enemies); computed enemy stat mods (Java left them 0); combat restructured from static+I/O into pure `{state,events}` reducers; serializable `createRng` seam added so GameState round-trips JSON; crit/fumble as enum not 8000/8001 sentinels; several confirm/continue loops dropped (belong to UI).
- Test failures before fixes: none (each stage passed first test-agent run).
- Plan open-questions: several balance/faithfulness calls (enemy HP & mods, flee 25% vs 35%, enemy always-hits, shop-under-menu, level-up no heal, boss advantage, hidden lore) — all resolved to faithful-to-Java defaults and surfaced as NEEDS-HUMAN, not guessed silently.
- Notable: build-agent found the game is UNWINNABLE at the faithful balance (0 wins / 20,000 seeds) and did NOT fake the win-playthrough acceptance — split it into a deterministic-death full run + a controlled victory→ending fixture. Flagged as the top NEEDS-HUMAN (balance pass).
- Ran under the `agentic-engineering` skill; earlier stages this session were hand-orchestrated with the same agents before the skill was formally invoked.
- Manual engineer fixes: none yet

## 2026-07-26 — m1-character-core
- Verdict: PASS (awaiting engineer review/merge)
- Fix rounds: 0
- Build-agent deviations: none (pre-recorded in plan: fresh-char AC/maxHp use CON per GameLogic.startGame, not DEX per Player.setArmorClass — matched intentionally)
- Test failures before fixes: none
- Plan open-questions: none
- Notes: pipeline run with general-purpose agents carrying the plan/build/test role files (named subagent types register next session). Tester independently hand-verified the mod formula and flagged an off-by-one in the orchestrator's own prompt example (assertions were correct). 31 tests green.
- Manual engineer fixes: none yet
