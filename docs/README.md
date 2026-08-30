# The Void — documentation index

_Start here. Every authoritative document, what it decides, and **which one wins** when two seem to
disagree. Keep this index current: a document not listed here will be missed by the next session._

---

## Read in this order

| # | Document | Decides | Read it before… |
|---|---|---|---|
| 1 | **[PRINCIPLES.md](PRINCIPLES.md)** | *How we work.* Part A universal, Part B software. The "why" behind the concrete rules | any task, plan, review or merge — and re-read roughly every ~10 requests |
| 2 | **[WORLD.md](WORLD.md)** | *What is true.* Absolution, the houses, the Rift, the Void, the betrayal, the stages, who you are, the endings | writing **any** prose, narration, or art prompt |
| 3 | **[GAME-DESIGN.md](GAME-DESIGN.md)** | *What the game is.* Systems, classes, karma, enemies, economy, items, floors | planning any gameplay work |
| 4 | **[ROADMAP.md](ROADMAP.md)** | *What order we build it in.* The v3 milestone plan, M0–M17 | picking up the next milestone |
| 5 | **[ART-BIBLE.md](ART-BIBLE.md)** | *How it looks, and how to reproduce it.* Exact model settings, the house style string, framing, posing, failure gates, generation order | generating a single image |
| 6 | **[UI-DESIGN.md](UI-DESIGN.md)** | *How it reads on screen.* Battle screen, narration cadence, combat log, canvas architecture, the restyle's five units | any UI or render work |
| 7 | **[INTERVIEW-PLAN.md](INTERVIEW-PLAN.md)** | ⭐ **The queue of everything still to ask the author**, and the record of what has been asked. Adaptive — answers may add, drop or reorder rounds. **No unit starts while a Phase-A row that blocks *it* is open** — per item, via the `BLOCKS` column, not as a blanket gate | before asking anything, and update it in the same turn as any answer |
| 8 | **[FINDINGS.md](FINDINGS.md)** | ⭐ **The living register of everything still open.** Updated continuously — decisions, gaps, bugs and doc hygiene, with a `BLOCKS` column. **New findings go here, not into a new audit file** | starting any work, and whenever anything is decided or discovered |
| 9 | **[PLAN.md](PLAN.md)** | *What to do next.* The work plan with dependencies — what blocks what, and what is unblocked | starting any piece of work |
| 10 | **[SCOPE-AUDIT.md](SCOPE-AUDIT.md)** | *Every hole, part 1.* Content, systems and document contradictions (2026-08-25), ranked by retrofit cost | committing to any new unit — check whether it sits on an unbuilt foundation |
| 11 | **[SCOPE-AUDIT-2.md](SCOPE-AUDIT-2.md)** | *Every hole, part 2.* Open decisions, **product areas nobody discussed** (accessibility, settings, legal, content warning, updates, QA), and **decisions already made by accident in code** — including three that silently destroy player data | before claiming anything is fully scoped, and before starting any UI unit |
| 12 | **[BALANCE-REPORT.md](BALANCE-REPORT.md)** | *Whether it is winnable.* Generated from the sim — do not hand-edit. ⚠ **INVALIDATED — for TWO independent reasons.** (1) `FINDINGS.md` **G11**: it calls itself a no-equipment *lower bound*, but loot is un-equippable **in principle**, so those figures are what real play does, not a floor beneath it. (2) **G32**: `proficiency` was dead state, so the whole run was tuned against a to-hit baseline ~10 points below the intended one — and the author ruled 2026-08-30 to **wire it**, which changes the difficulty again. **Regenerate after `PLAN.md` #0** | touching any balance constant |
| 13 | **[SHIPPING.md](SHIPPING.md)** | *How it ships.* Licence and third-party notices, free-on-itch release, no telemetry, the store page, first-run flow, and the playtest brief | packaging, release, or writing anything public-facing |
| 14 | **[CONTENT-WARNING.md](CONTENT-WARNING.md)** | *The warning, and where it appears.* Shown at the start of **every** fresh run, plus the store page and README. **The words are the author's to write** | building the first-run flow or the store page |
| 15 | **[N1-SPIKE.md](N1-SPIKE.md)** | *Local-LLM viability.* Measured numbers from the 2026-08-02 hardware spike | packaging or model-tier work |

**Stale, kept for history — do NOT build from these:**

- **[`../WHAT-WE-BUILT.md`](../WHAT-WE-BUILT.md)** — a plain-language explainer last true on 2026-08-10. Describes gold, a shop, and a Void that is a place. All three are wrong now.
- **[`../itch-description.html`](../itch-description.html)** — public store copy, written against the pre-v3 game.

**Also authoritative, outside `docs/`:**

- **[`../CLAUDE.md`](../CLAUDE.md)** — the load-bearing engineering principles. **These override any
  library convention or agent default**, and they win over anything in this folder.
- **[`../PROGRESS.md`](../PROGRESS.md)** — the live build tracker and session log. Updated as the
  final step of any session that changes build state.
- **[`../HUMAN-CHECKS.md`](../HUMAN-CHECKS.md)** — everything a human must verify by hand, accumulated.
- **[`../.claude/pipeline-log.md`](../.claude/pipeline-log.md)** — the durable evidence trail for
  every pipeline run; mined by the `pipeline-retro` skill.

---

## Precedence — when documents disagree

1. **`CLAUDE.md`** wins over everything. Deviations from it get recorded with a reason.
2. **`WORLD.md`** wins on anything about the fiction. It is the youngest and most deliberate record;
   older prose written before it may contradict it and is wrong where it does.
3. **`ART-BIBLE.md`** wins on anything visual — including over `UI-DESIGN.md`, which was written
   first and has already been corrected by it once (the Ash City accent).
4. **`GAME-DESIGN.md`** wins on systems and numbers, except where `BALANCE-REPORT.md` supersedes a
   specific constant.
5. **`SHIPPING.md`** wins on release, licensing and store-facing questions; **`CONTENT-WARNING.md`**
   wins on the warning's placement and policy.
6. A **`[LOCKED]`** tag with a date beats an untagged statement. A later date beats an earlier one.

**Corrections already on record**, so nobody re-derives from a stale line:
- `UI-DESIGN.md` §5 originally said the Ash City accent was *ash-orange*. **Overruled** — the fire is
  out; it is white, grey and black (`ART-BIBLE.md` §4).
- `ART-BIBLE.md` originally specified painterly realism. **Superseded** by the 32-bit-era 2D pixel
  direction, same file §2.
- Enemy sprites were first prompted as generic dark fantasy. **Wrong** — see `WORLD.md` §2 on
  industrialised magic and `ART-BIBLE.md` §4 on the cyberpunk gradient.

---

## The one-paragraph version

An **LLM-narrated, mechanics-first roguelike** about descending five floors of the Void. A local
4B model narrates; the deterministic engine owns every rule and number. **The Void is not a place
— it is a condition, and the condition is the Hollow.** You are a sworn retainer of house Grandmore,
sent to kill an Undercity Kingpin who turns out to be your own house's collaborator. He does not
throw you down a hole — **he takes your brainchip**, and the whole game happens during that
extraction while you are awake. Five stages — *before, fracture, grief, judgement, absence* — and a
hidden four-axis karma that decides whether the floor-4 Warden grants grace or casts you down. The
angels there are **real**: your own recorded life was what stood in front of them. The good ending
does not say *made well*; it says **made whole**, which is the exact opposite of hollow, and that is
the whole game.

**And there is a second campaign.** A Hollow — a stripped chip reinstalled in an emptied body — does
not descend. **It rises**, floor 5 to floor 1, to reach the Memorians who made it. The Warden does
not judge it. The Warden lets it through.
