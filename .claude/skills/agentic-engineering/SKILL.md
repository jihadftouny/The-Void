---
name: agentic-engineering
description: Mandatory workflow for any task that adds or changes project code. Decomposes the task into per-unit git worktrees and runs the plan-agent → build-agent → test-agent pipeline in each, ending in a handoff for manual engineer review, merge, and ship. Not for docs/config/.claude tweaks or pure questions.
---

# Agentic Engineering Workflow

You are the **orchestrator**. You never plan, write, or test project code yourself — the pipeline agents do, each inside a dedicated git worktree. You set up worktrees, launch agents, relay progress, and hand off to the engineer.

Definitions: `MAIN` = absolute path of the main checkout (this repo root). Worktrees live in `MAIN/worktrees/` (gitignored, inside the repo).

## 1. Decompose
Split the task into independent units only when they are each substantial AND touch disjoint files; sequentially dependent parts stay in one unit. Most tasks are ONE unit. When you do parallelize, stay within the clash-avoidance rules in §1b. If the task itself is ambiguous, resolve it with the user (AskUserQuestion) before creating worktrees.

## 1b. Running units in parallel (clash avoidance)
Because each unit builds in its own worktree, agents never see each other's edits — so a clash can only surface at **merge** time. Convert that from random interference into a scheduling problem: prevent, detect, resolve.

- **Ceiling: ~2 heavy + 1 light unit at once.** Beyond that, branches start colliding in the shared wiring files below and the review/merge queue backs up.
- **Runtime isolation:** worktrees isolate FILES but not the RUNTIME — units share ports and installed dependencies. Give each worktree its **own dependencies** (`npm install` in the worktree) and, if it runs a dev/preview server, a **unique port derived from its slug** so concurrent servers never collide.
- **Prevent (before launching a second concurrent unit):** cross-check the new unit's planned file list (every plan-agent declares one) against every ACTIVE unit's. Overlap in any real source file → do **not** parallelize; run them serially or re-scope the boundary. A plan that can't say what it touches counts as overlap.
- **Shared "hot" wiring files** (entry point `src/desktop/game.ts`, `desktop.html`, data manifests/JSON indexes, `package.json`/build config — *`src/main.ts` and `src/scenes/` were the old markers; both were deleted by M-UI2*) are touched by almost every unit. Two units both touching one is an overlap **unless** both edits are purely additive (a new import + a new registration) — additive hot-file edits merge cleanly. *Restructuring* a hot file while another unit is active is not parallelizable. Keep every hot-file edit in its **own small commit**.
- **Detect / resolve (merge stays serial and human-gated):** merge in dependency order, one unit at a time. Before proposing a merge while other branches are open, run a **conflict dry-run** (`git merge-tree`, or a throwaway `merge --no-commit`) and report which open branches will conflict. **After each merge, every still-open unit rebases onto the new main** — its own build-agent merges `main` into its worktree, resolves anything local, and the full suite + typecheck must pass there before that unit proceeds. Textual conflicts are resolved by that unit's **own build-agent**, never hand-patched by you. A rebase that invalidates the unit's approach is a **re-plan**, not a fix round.
- **The human gate stays serial regardless:** parallel *building*, but one play-test and one merge-approval at a time.

## 2. One worktree per unit
Pick a short kebab-case slug; if branch `agentic/<slug>` already exists, suffix `-2`.

```
git worktree add "MAIN/worktrees/<slug>" -b "agentic/<slug>" main
```

When you run units in parallel, also assign each worktree its **own dependencies** (§1b) and, if it serves, a unique port.

## 3. Pipeline per unit
Units run concurrently; stages within a unit are strictly sequential. Launch each stage with the Agent tool (`subagent_type` as named below), always passing in the prompt: the unit's TASK, `WORKTREE=<absolute worktree path>`, `MAIN=<absolute main checkout path>`.

1. **plan-agent** — wait for its result. If it returns open questions, put those only the user can settle to the user (AskUserQuestion), then append the answers to `WORKTREE/.agentic/plan.md`.
2. **build-agent** — note its agent ID for fix rounds.
3. **test-agent** — parse the first line of its result: `VERDICT: PASS` or `VERDICT: FAIL`.
4. **Fix loop** on FAIL: continue the SAME build agent via SendMessage (load through ToolSearch if deferred) with the failure details, then re-run test-agent. Maximum 2 fix rounds.
5. **Re-plan** if it still fails. Two failed rounds means the *plan* is wrong, not the typing — a build agent that has already failed twice will keep defending its approach, so do not send it a third round. Instead:
   - Launch a **fresh plan-agent** with the original TASK, the path to the existing `plan.md`, the failing diff, and the full failure history from both rounds. It writes an amendment to `WORKTREE/.agentic/plan.md`.
   - Launch a **fresh build-agent** (never the stuck one) against the amended plan.
   - Re-run test-agent. **One re-plan cycle only**; if it still fails the unit is **FAILED** — report it, do not fix it yourself.

Never write project code, merge, push, or remove worktrees/branches yourself at any point.

## 4. Handoff (final message)
Per unit report: verdict (PASS / FAILED / re-planned), branch, worktree path, commits (`git -C <worktree> log --oneline main..HEAD`), and ready-to-run commands for the engineer.

Relay the test agent's **NEEDS-HUMAN script verbatim** — the numbered steps with their expected observations. Agents cannot see rendered output, and browser automation is not a reliable substitute. Present it as the checklist it is, and never imply a visual criterion was verified when it was not.

- Review: `git diff main...agentic/<slug>` — and run the app from the worktree path.
- Merge (after approval, from MAIN): `git merge --no-ff agentic/<slug>`
- Cleanup: `git worktree remove "MAIN/worktrees/<slug>"` then `git branch -d agentic/<slug>`

The engineer reviews, merges, and ships manually.

## 4b. Record the run (evidence trail)
After the handoff, append one run record to `MAIN/.claude/pipeline-log.md` (create it if absent, newest first): date, slug, verdict, fix-round count, notable build-agent deviations, test failures encountered before fixes, plan open-questions, and a **Manual engineer fixes** line (start it `none yet`). This is the durable signal the `pipeline-retro` skill later mines.

## 5. After manual review / when a merge lands
When the engineer's play-test surfaces a bug the test-agent passed — a feel/visual/UX issue, or any headless blind spot — **fix it through the same fix-round mechanism** (§3.4: resume that unit's build-agent via SendMessage with the specific finding, then re-verify with the test-agent) before the merge, on the same branch. Then record it in that run's **Manual engineer fixes** line: what was wrong, what fixed it, and which agent should have caught it. These are **pipeline escapes** and the highest-value signal for `pipeline-retro` — always log them.

When the engineer merges, update `PROGRESS.md` per its maintenance rule **and clear the `unmerged`
tag on that run's `.claude/pipeline-log.md` entry** (replace it with `merged to \`main\``). Without
this second step every run stays stamped "unmerged" forever, and `pipeline-retro` mines a log that
says nothing ever shipped — which is exactly what happened to the first 15 runs.
