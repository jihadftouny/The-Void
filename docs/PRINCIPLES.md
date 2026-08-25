# Portable Principles

_Distilled from this repo's working docs and its accumulated build/retro history, then lifted to the
most general level they hold at. **Part A is domain-neutral** — it applies to any project, technical or
not (a product, a research effort, a renovation, a book, an event). **Part B** is the software-specific
instantiation. The project-specific detail (this game's design, milestones, names) stays in the other
docs; the multi-agent build pipeline is in `AGENTIC-WORKFLOW-TEMPLATE.md`._

---

## Part A — Universal (any project, any domain)

**1. Work in isolation; gate the irreversible.** Do work where it can't disturb the live or shared
thing until it's ready. Treat irreversible or outward-facing steps — publishing, sending, spending,
deleting, committing to a vendor — as *separate* actions that need explicit sign-off. Approval for one
never carries to the next.

**2. The maker is not the checker.** Have someone (or something) independent try to *disprove* the work
before you rely on it. Self-review sees what it expects to see; a second party prompted to break it
finds what you can't.

**3. Verify against independent truth, not self-consistency.** Derive the expected result a second way —
from first principles, the spec, an independent calculation — and let it disagree. A wrong-but-internally-
consistent result looks perfect from the inside (a whole system here once passed every check while being
completely inverted, because every check only compared it to itself).

**4. Diagnose before you act.** For anything non-obvious, measure the real situation and confirm the root
cause before committing to a fix or a decision. The first explanation is usually wrong. Keep the
measurement around — it becomes the early-warning signal next time.

**5. Decompose into independent pieces; sequence the ones that touch.** Split work into parts that don't
overlap so they can advance in parallel; where two parts change the same thing, do them in order.
Unplanned overlap surfaces as a conflict at the worst possible moment — the merge, the deadline, the
handoff.

**6. Change additively; keep a proven fallback.** Introduce change as an addition with the old path
intact, and switch over only once the new way is proven at least equivalent. Don't demolish what works
to build what might.

**7. Guard the seams.** Most failures happen at boundaries and transitions — handoffs, edges, the moment
two systems or two people meet — not in the steady state. Plan and check those explicitly.

**8. Size for the worst case, not the typical one.** Whatever holds the work — budget, capacity, buffer,
a container — must fit the extreme it will actually meet, not the average. A limit that's fine for the
normal case fails silently at the peak, and normal-case checks won't catch it.

**9. One live source of truth; never let it go stale.** Keep a single, always-current record of status
and decisions. A tracking artifact that drifts from reality is worse than none — people act on it
*because* they trust it.

**10. Automate the routine; reserve judgment for the risky.** Make repeatable work run itself; spend
scarce human attention on judgment calls and irreversible steps. This matters most when time is limited
and bursty — automation is what keeps things alive through the quiet stretches.

**11. Name your non-negotiable line, and make crossing it detectable.** Decide the boundary you will
never cross — an integrity, safety, fairness, or trust commitment — and build an actual *check* for it,
not just an intention. A promise you can't test will eventually be broken by accident.

**12. Reference material is advice, not authority.** Templates, best practices, and expert patterns are
inputs. When one conflicts with a load-bearing goal of *your* project, follow the goal and record why
you deviated — then the deviation is a decision, not a drift.

**13. A failed checkpoint is information — not a dead end, and not a reason to plow on.** Decide the gates
before you start. When one fails, stop and diagnose (where did it actually go wrong?), then iterate —
neither abandon the effort nor blindly continue past the warning.

**14. Think long-term by default.** When a choice trades short-term convenience for long-term health,
name the trade out loud and prefer the durable option. Front-load the decisions that are expensive to
reverse; they can't be retrofitted cheaply later.

**15. Smallest change that achieves the goal; hold the line on scope.** Prefer the minimal, surgical
move; lock the scope and let additions in deliberately, offsetting where you can. Scope gravity — the
pull to add "just one more thing" — is the quiet killer of any finite budget.

**16. Version anything you keep; plan to migrate it.** Label the versions of things you persist (records,
formats, agreements) and assume a future-you will have to change their shape without losing what's
already stored.

**17. Report faithfully.** Say what actually happened: if it failed, show the evidence; if a step was
skipped, say so; claim "done" only when it's verified. Always distinguish *done-and-checked* from
*assumed-fine*.

**18. Measure without contaminating.** Instrument as an outside observer; don't let the act of tracking
distort or entangle the thing being tracked. Keep the measurement layer separable from the work.

---

## Part B — When the project is software

The same principles, made concrete for code (and the traps that recur):

- **Separate authority from view (§A1, A18).** One layer owns state and logic; the UI is a pure function
  of it, data flowing authority → view only. Never park logic state in the view layer.
- **Determinism is built in early or never (§A6, A14).** For anything you might replay, network, or
  snapshot: no wall-clock reads, no unseeded randomness, no dispatch on type/class names (minifiers
  rename them); state is plain serializable data. Run logic on a fixed timestep decoupled from render.
- **Input as commands; snapshot-shaped state (§A6).** Feed logic a per-tick command stream, and shape it
  as `apply → update → snapshot` so state can be saved/restored at any point. This is what makes AI,
  networking, and replay cheap later instead of a rewrite.
- **Opt-in flags, byte-identical when off (§A6).** Land risky work behind a flag that's absent by
  default, and prove with a lockstep test that behavior is byte-for-byte unchanged when off.
- **Non-circular tests + capacity invariants (§A3, A8).** Anchor assertions to independently-derived
  values, not to the implementation's own output. For every fixed pool/cap/buffer, assert capacity ≥ the
  maximum the system can actually produce.
- **Guard discontinuities (§A7).** Where smoothing/prediction meets an abrupt change (teleport, restart,
  restore, network correction), specify the seam's handling and write its regression test.
- **Isolate units in branches/worktrees, gate merges on a human, verify the merged result (§A1, A2, A5).**
  Independent verification before merge; merge in dependency order; re-run the full suite on the combined
  tree before shipping — conflict-free text is not conflict-free behavior. Two failed fix rounds = re-plan.
- **Instrument via a subscriber, keep the core pure (§A18).** Telemetry attaches to events the logic
  already emits; it never threads through the logic itself.
- **Tooling traps.** A green typecheck can check nothing (a solution-style `tsconfig` makes `tsc --noEmit`
  validate the empty root — use `tsc -b`). Keep build caches out of linked/synced dependency dirs (a
  worktree's `node_modules` link can be read-only for writes). Treat LLM/agent prompts as a fixed,
  near-full budget: smallest change, no duplication, offset additions (§A15).
- **Every PR gets a full description** (what/why/how/scope/testing), and a merge into a shared branch is a
  separate, explicitly-approved step (§A1, A17).
