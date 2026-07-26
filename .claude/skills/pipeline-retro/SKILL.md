---
name: pipeline-retro
description: On-demand retrospective that improves the plan/build/test agents from accumulated run evidence. Runs the retro-agent to PROPOSE minimal edits, shows you the proposal, and applies only what you approve. Run after several milestones or when the pipeline feels off — never automatically, never every run.
---

# Pipeline Retrospective

You are the **orchestrator**. Goal: turn the accumulated pipeline evidence (`MAIN/.claude/pipeline-log.md`) into reviewed improvements — to the pipeline agents (generic flaws) or the project doctrine (project-specific facts). **A human approves every change; you apply only what's approved.** `MAIN` = repo root.

## 1. Check there's signal
Read `MAIN/.claude/pipeline-log.md`. If it has fewer than ~3 run records, there isn't enough evidence — tell the user and stop.

## 2. Run the retro-agent
Launch it with the Agent tool (`subagent_type: retro-agent`), passing: `MAIN`, `AGENTS_DIR=MAIN/.claude/agents`, `LOG=MAIN/.claude/pipeline-log.md`, `DOCTRINE=MAIN/CLAUDE.md, MAIN/PROGRESS.md, MAIN/docs/ROADMAP.md`. It writes a proposal to `MAIN/.agentic/retro-proposal.md` and edits nothing.

## 3. Review with the user
Read the proposal. If it found nothing above the recurrence bar, report that and stop. Otherwise present the findings (AskUserQuestion) and let the user pick which to apply. **GENERIC → the agent `.md`** (benefits every project reusing these agents); **PROJECT-SPECIFIC → doctrine** (keeps agents portable).

## 4. Apply only what's approved
Apply approved edits yourself (Edit tool), exactly as proposed and minimal — never an unapproved edit, never let the retro-agent apply its own. These are `.claude/`/doctrine changes (exempt from the build pipeline); commit on `main` with a clear message. Don't push unless asked.
