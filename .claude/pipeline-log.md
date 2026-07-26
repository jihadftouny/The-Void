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

_No pipeline runs yet. The first coding task through `agentic-engineering` appends here._
