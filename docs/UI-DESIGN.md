# The Void — UI design record (M-UI2: the turn-based battle screen + whole-game restyle)

_Authoritative record of the UI scope decided in the 2026-08-24 scope interview. Same status tags as
`docs/GAME-DESIGN.md`: **DECIDED** (locked), **PROPOSAL** (my recommendation, not yet confirmed),
**OPEN** (still needs the engineer). Milestone plan: `docs/ROADMAP.md`. Build state: `PROGRESS.md`._

---

## 0. Why this exists

The engine is finished and merged (M1–M15, 960 tests). The UI is not. Today the battle screen is a
220-pixel sidebar of plain text lines plus a flat row of buttons: you press **Fight**, a line of
narration replaces the last one, and two numbers change in the corner. It does not read as a fight,
and it hides almost everything the engine actually computes — 24 status conditions, dice rolls,
skill charges, affixes, per-round exchanges. This document is the plan for fixing that.

The guiding constraint is unchanged from `CLAUDE.md` §1: **all of this is render layer.** Not one
rule, number or random decision moves into the UI. Everything below reads engine state and forwards
input; the engine stays headlessly testable and reproducible from its seed.

---

## 1. Battle screen — layout **[DECIDED]**

**JRPG framed.** The enemy occupies a large framed stage in the centre of the screen; your stat box
sits bottom-left; the action menu sits bottom-right; a thin ticker carries the most recent combat
line, with the full log expandable.

```
┌──────────────────────────────────────────────┐
│                                              │
│              ╔══════════════╗                │
│              ║   [ enemy ]  ║                │
│              ╚══════════════╝                │
│           ASH-WRETCH  ███████░░ 34/60        │
│           ☠ Burning (2)  ⌁ Staggered (1)     │
│                                              │
│  » You strike for 8. It claws you for 6.     │
├───────────────────────┬──────────────────────┤
│ JIHAD  Enforcer lv4   │  ▸ Fight             │
│ HP █████████ 41/52    │    Cast              │
│ ⚡ 3/5   Rage 2       │    Item              │
│ ⌁ Guarded (2)         │    Potion / Spare    │
└───────────────────────┴──────────────────────┘
```

Everything in that frame already exists in engine state and is simply not being shown today: the
enemy's family and affix, both HP pools, the active conditions on both sides with their remaining
duration, skill charges, and the class build-resource.

**Rejected:** a stacked arena (enemy top / you bottom / log middle) and a two-column arena. Both are
cheaper and both read fine, but neither gives the enemy visual presence, and enemy presence is the
whole point of putting a creature on screen.

## 2. Narration placement and cadence **[DECIDED]**

**Bookends only — fast rounds.** The narrator speaks at battle start, on dramatic beats (a heavy
hit, a skill firing, near-death, the kill or the sparing) and at the end. Ordinary rounds resolve
instantly as mechanical log lines with no model call at all.

**Why, and the measurement behind it:** a smoke test on the dev laptop after the merge gave **89
tokens/sec with 181ms to first token** on the RTX 5060 — so a short beat costs roughly a second.
That is fast, and it means this decision is *not* a workaround for a slow model. It is about turn
feel: a turn-based RPG lives on the tightness of the press-and-resolve loop, and a one-second pause
on all fifteen presses of a battle destroys that loop even when each individual pause is short. It
also makes the prose matter more — the narrator interrupting only when something genuinely happened
carries far more weight than a paragraph per swing.

**Consequence for M11 (the LLM layer to spec):** the narrator needs a notion of *beat significance*
so the renderer can ask "is this round worth speaking about?". That is a pure function over the
engine's event list and belongs in `src/llm/` alongside `narrate.ts`, not in the renderer.

**Rejected:** narrating every round (either inside the log or in a dedicated band). Both were
strictly worse for turn feel and neither bought anything the bookend model doesn't already give.

## 3. Combat log detail **[DECIDED]**

**Plain by default, expandable to full dice.** The line reads `You hit the Ash-Wretch for 8.`;
clicking it (or flipping a persistent toggle) reveals `d20+4 = 17 vs AC 13 → hit, 1d8+4 = 8
slashing`. The log persists for the whole battle and scrolls.

**Why:** the game's pitch is mechanics-first, so the D&D machinery underneath has to be *visible on
demand* or it may as well not exist — but a wall of dice math on every line makes ordinary play
unreadable. Expandable detail serves both, and it doubles as a balance-and-debugging instrument for
your own play-testing, which matters given M15's per-class refinement is still outstanding.

**Requirement this places on the engine:** combat events must already carry the roll, the modifier,
the target number and the damage breakdown. Where they only carry the outcome, the events need
widening — **an engine change, through the pipeline, not something the renderer may reconstruct.**
The renderer must never re-roll or re-derive a number to display it.

## 4. Canvas architecture **[DECIDED]**

**Full-screen Kaplay canvas, DOM layered on top.** Kaplay fills the battle screen and owns
atmosphere (floor backdrop, fog, lighting, particles), the enemy sprite, hit flashes and
screen-wide shake. The DOM panels — HP bars, condition chips, the log, the menu — sit above it.

**Why:** screen-wide effects are most of the game-feel payoff, and they are impossible if the canvas
is boxed inside the enemy frame. Text stays DOM so it remains crisp, selectable and restyleable.

**The cost, stated plainly:** two layers that must be kept in sync, and a battle screen that is now
coupled to the render layer. The mitigations are non-negotiable:
- `src/game` still imports nothing from Kaplay or the DOM. Unchanged.
- The canvas is driven by a **pure view-model** (the existing `src/desktop/view-model.ts` pattern):
  engine state in, a plain-data description of what to draw out. That description is unit-testable
  headlessly; only the thin function that hands it to Kaplay is not.
- Kaplay effects are **decorative only**. If the canvas fails to initialise, the game must remain
  fully playable as DOM — the same resilience rule the narrator already follows.

## 5. Art direction **[DECIDED]**

**Elevated terminal — austere and typographic.** Near-black, monospace, heavy rules, wide
letter-spacing, no ornament, flat panels, and **one accent colour per floor** (ash-orange in the Ash
City, bone-white in the Angelic Underground, and so on) so the palette itself marks the descent.

**The tension to hold, deliberately:** an austere typographic frame plus a lot of generated art
could easily fight each other. The resolution is that **art is treated as a plate, not as
decoration** — the floor backdrop sits full-bleed and heavily darkened behind everything, the enemy
sprite is the single bright object on screen, and the UI chrome around them stays flat, ruled and
unornamented. The art is what you look at; the interface is what you read. If any generated asset
starts competing with the type, the asset is wrong, not the type.

**Rejected:** grimy occult (texture, inked frames, sigil furniture) and clinical dread (sterile
off-white, medical labelling). Both were more immediately striking; both would have made the
interface itself loud, which is the opposite of the chosen direction.

## 6. Turn feel **[DECIDED]**

**Beat-by-beat, auto-advancing.** Pressing Fight plays the round as a short sequence — your strike
lands with a sprite flash, a damage number floats and the HP bar drains; a beat; conditions tick; a
beat; the enemy's attack resolves and the screen shakes. Roughly a second end to end, with no
clicking through it.

**Why:** this is the largest single source of game-feel in the whole plan. An instant resolve makes
a round read as a spreadsheet recalculating; staged beats make it read as an exchange. Requiring a
click between beats would double the input cost of every battle across a full five-act run.

**Requirement:** the renderer must be able to replay the round's events **in order, with timing**,
which the engine's event list already supports. Animation timing is render-layer state and must
never leak into game state.

## 7. Scope of the restyle **[DECIDED]**

**The whole game**, not the battle screen alone: title, character creation, class select, stat roll,
the hub, inventory and equipment, the character sheet, sacrifice-deals, the level-up draft, chests,
rest, endings and game-over.

**How this gets built — decomposition [PROPOSAL].** "Whole game" is the scope, not a single unit.
The `agentic-engineering` pipeline wants units that a human can actually review, so this becomes a
sequence of units sharing one visual language, each independently verified:

| Unit | Contents | Depends on |
|---|---|---|
| `ui-foundation` | Design tokens (palette, type scale, per-floor accents, spacing), the shared panel/bar/chip components, retire `src/scenes/` + `index.html`, extend combat events with roll detail | — |
| `battle-screen` | The JRPG frame, both combatant panels, conditions, the expandable log, the action menu, beat-by-beat sequencing | `ui-foundation` |
| `canvas-layer` | Kaplay full-screen layer, enemy sprite rendering, hit flash / shake / particles, floor backdrops, graceful degradation | `ui-foundation` |
| `screens-restyle` | Every non-battle screen brought onto the shared language | `ui-foundation` |
| `art-pipeline` | The generation script, prompt data, asset loading | — (parallelisable) |

Per the clash-avoidance rules in the skill (§1b), `ui-foundation` must land before the three units
that build on it; `art-pipeline` touches a disjoint file territory and can run alongside.

## 8. Retiring the second front-end **[DECIDED]**

`index.html` and `src/scenes/` (a standalone Kaplay scene set: main menu, class select, level-up,
deal) are **deleted**. The desktop app — `desktop.html` + `src/desktop/` — is the game, and it is
where Kaplay is now going anyway.

**Why:** it is a complete parallel UI that would otherwise have to be restyled too, it duplicates a
205 kB bundle, and the two front-ends have already drifted (the scene set still references the
deleted gold shop). The code remains in git history if it is ever wanted back.

**Note:** this removes the only browser (non-Electron) path. That is acceptable — the product is a
packaged desktop game (`CLAUDE.md`, principle 6), and if a browser build is ever wanted it should be
built from the desktop UI rather than from a second divergent one.

---

## 9. Art generation **[DECIDED in principle, OPEN on specifics]**

Art is **AI-generated** through Google AI Studio, using the engineer's own API key, with **roughly
three variations of every asset** produced in one large batch for the engineer to choose from.
Batch generation is to be used if the API supports it.

**Pipeline shape [PROPOSAL — my recommendation]:** a committed `scripts/gen-art.mjs` driven by a
committed `src/data/artPrompts.json`, writing numbered candidates to a **gitignored** scratch
folder; only chosen finals get committed.

```
src/data/artPrompts.json    prompts, one per asset   → committed
scripts/gen-art.mjs         calls the API            → committed
.env                        GOOGLE_API_KEY=…         → GITIGNORED
art-candidates/             ash-wretch-01..03.png    → gitignored
src/assets/…                the chosen finals        → committed
```

**Why this shape rather than generating ad hoc in a session:** the prompts become a reviewable,
version-controlled asset in their own right, so a family can be regenerated consistently when its
design shifts; nothing is lost when a conversation ends; and the key never enters the repository or
the git history. **The generation script is never called by tests** — the same rule that keeps real
inference out of the test suite.

**Security, non-negotiable:** the key is read from an environment variable or a gitignored `.env`.
It is never committed, never pasted into a source file, never written into a document, and never
echoed into a log or a commit message.

**Proposed first batch [PROPOSAL]** — "everything we need", enumerated:

| Assets | Count | × 3 variations |
|---|---|---|
| Enemy family sprites (transparent) | 24 | 72 |
| Boss portraits | 5 | 15 |
| Floor backdrops | 5 | 15 |
| Class portraits | 5 | 15 |
| **Total** | **39** | **117** |

Item icons are deliberately **excluded from batch one**. There are 15 relics, 4 uniques, 19
consumables plus weapons and armour — too many to review in one sitting, and the right unit for them
is probably an icon per slot-and-rarity rather than per individual item. That is a **[OPEN]**
question for after the first batch proves the style.

### Open questions blocking the art pipeline **[OPEN]**

1. **The API key.** Nothing can be generated until it is supplied. It must arrive as a `.env` file
   or an environment variable — please do not paste it into chat, where it would be recorded in the
   transcript.
2. **The exact model.** The engineer asked for "banana pro". The Nano Banana family are Google's
   image models; the precise current model id and whether it exposes a true batch endpoint (as
   opposed to concurrent single calls) must be **verified against live documentation** before the
   script is written, not assumed from memory.
3. **Style lock.** 117 images generated against an unproven prompt style is a large batch to throw
   away. Recommend a **style probe first**: three assets, three variations each, confirming the
   "austere plate against near-black" look actually lands, before committing to the full run.

---

## 10. What this does not cover

Deliberately out of scope here, tracked elsewhere:

- **Prose** — floor, boss and ending text (M10 / M12 / M14) is the engineer's voice to write.
- **The Tibia-style equipment UI** (M5's ★ deferral) — still a collaborative pass; the inventory
  restyle in `screens-restyle` is a restyle of the current functional screen, not that redesign.
- **Per-class balance** — Scavver strong, ranged classes weak (`docs/BALANCE-REPORT.md`). A play-test
  and weapons follow-up, not a UI concern.
- **Audio.** Never discussed. Flagged as **[OPEN]** — a turn-based battle screen with beat-by-beat
  sequencing is the natural place for hit and impact sound, and it will feel oddly silent without it.
