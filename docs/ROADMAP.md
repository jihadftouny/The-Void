# The Void — Roadmap (v2: the LLM-driven narrative game)

> **v2 supersedes the v1 port roadmap** (2026-08-02, after the design interview). The Void is now an
> **LLM-driven narrative RPG**: a local language model narrates the descent, adapting to the
> player's choices, while the deterministic engine owns every rule and number. The v1 Java-port
> milestones (M0–M10, built and awaiting review on branches) produced the engine this design stands
> on; their disposition is recorded below.

## The locked design (from the 2026-08-02 interview)

**Experience**
- **Hybrid input:** each turn the narrator offers 3–4 situation-specific tappable choices, plus an
  optional free-text box ("do something else…").
- **LLM adjudicates within rules:** the narrator interprets creative actions by choosing which
  engine mechanics to invoke (a DEX check, advantage, an item use) — it **never invents numbers**.
  The engine is authoritative for all dice, damage, loot, and state.
- **Engine as toolbox:** dice/combat/conditions/items/rest/shop are callable tools. The narrator
  (steered by zone prompts) paces encounters and scenes — the old fixed random-encounter table is
  retired as the driver (kept as a fallback).
- **Streaming narration:** text arrives word-by-word; short mechanical results (rolls, damage) can
  render instantly from the engine.

**Orchestration**
- **Master narrator + on-demand specialists** — one narrator call per turn by default; specialist
  calls (boss voices, lore-keeper) only when the moment warrants.
- **Enemies are tiered:** regular enemies = authored **personality cards** (data injected into the
  narrator's prompt); the **act bosses are true agents** — their own prompt, their own memory of the
  player. With a local model, "specialists" are prompt-swaps on the same loaded model.
- **Zone prompts (5 floors)** control all four: tone/imagery/psychological theme (each floor a stage
  of the descent), encounter direction, zone-specific mechanics (e.g. a floor that distorts
  perception → WIS checks to trust what you see), and fixed story beats/secrets the narrator weaves
  in when the moment fits.

**Platform & model**
- **Local LLM. No cloud, no API keys, no per-turn cost, works offline.**
- **Packaged desktop game:** downloadable from itch, double-click, everything bundled (game +
  inference engine + model). Recommended stack: **Electron + node-llama-cpp** (all-TypeScript, GGUF
  models, JSON-schema/grammar-constrained output, GPU offload when available); Tauri + llama.cpp
  sidecar is the fallback if Electron proves too heavy. N1 validates this choice.
- **Min spec = typical laptop, no GPU:** a **3–4B parameter model**, quantized, ~2GB, streaming at
  usable speed on CPU. Candidates (evaluate in N1, mind redistribution licenses): Llama-3.2-3B,
  Qwen2.5-3B, Gemma-class, Phi-4-mini.
- **Desktop-first now, mobile later** — a deliberate amendment of the v1 mobile-first principle.
  The UI stays responsive so a mobile path (smaller model or engine-only mode) can come later.

**UI**
- **DOM text + Kaplay atmosphere:** narrative and choices are real HTML text (crisp, selectable,
  streams and scrolls natively); Kaplay becomes the effects layer behind/around it (particles,
  glitches, dice animation, zone visuals).

**Content authorship**
- **Co-written zone by zone:** per floor, a short creative session (themes, imagery, beats) → Claude
  drafts the zone prompt file → the author rewrites/approves every word. The words matter —
  the author has final voice on all shipped text.

**Small-model guardrails (design consequences)**
- Prompts stay short and structured; the engine carries the complexity.
- All LLM output that feeds the game (choice lists, tool invocations) is **grammar/JSON-constrained**
  — the model physically cannot return malformed data.
- Free-text adjudication maps to a **closed set** of engine tools; unknown intent falls back to a
  narrated "the Void does not respond" rather than invented mechanics.

## Disposition of the v1 work (branches currently held)

| v1 artifact | Fate |
|---|---|
| Engine M1–M8 (`agentic/logic-core`) | **Foundation.** Becomes the toolbox the narrator calls. |
| Save/load M9 (`agentic/save-load` → in `wire-save`) | Carries over; save gains narrative history. |
| Kaplay UI shell M10 (`agentic/ui-shell` → in `wire-save`) | Partially reused: driver/scenes give way to the DOM narrative UI; Kaplay layer + theme survive as atmosphere. |
| Merge decision | **Held** (user's call, 2026-08-02): decide after N1–N2 clarify exactly what's reused. |
| Balance pass (unwinnable game) | Deferred into N9 — encounter pacing now belongs to the narrator, which changes the balance question. |

## Milestones (N-series)

- **N0 — Doctrine + scaffolding for v2.** This roadmap; CLAUDE.md amendments (desktop-first, local
  LLM principle); decide the fate of held branches when N1/N2 make reuse concrete. *(docs — exempt
  from the pipeline)*
- **N1 — Desktop shell + local-model spike.** Package the current build as a desktop app
  (Electron + node-llama-cpp); load a 3–4B GGUF model; stream tokens; measure speed/RAM on a no-GPU
  laptop; pick the model + quantization; verify redistribution license. **Exit test:** double-click
  → model loads → streamed text on screen on min-spec hardware.
- **N2 — LLM runtime layer (pure core).** Framework-agnostic `src/llm`: prompt assembly (base rules
  + zone file + enemy card + state snapshot), streaming interface, grammar/JSON-schema constrained
  output, token budgets, and a **fake-model implementation** so the whole layer is headlessly
  testable in the pipeline without inference.
- **N3 — Narrator loop v1 (one zone, playable).** Turn cycle: engine state → narrator → narration +
  constrained choice list → player picks/types → interpreter maps intent to engine tools → engine
  resolves → repeat. Floor 1 only, minimal prompt. **The first playable slice of the real game.**
- **N4 — Engine-as-toolbox.** Formal tool registry over the engine (dice, combat round, condition,
  item, rest, shop, progression); narrator-paced encounters within zone constraints; the fixed
  random-encounter loop retired to fallback.
- **N5 — Zone system.** Zone-prompt schema + loader; transitions on XP/beat completion; all five
  floors wired with draft prompts. **Interleaved:** co-writing sessions per zone (author + Claude),
  one floor at a time — content lands as it's written.
- **N6 — Enemy cards + boss agents.** Card schema (personality, tactics, speech, fears) injected
  per encounter; boss agents with own prompt + persistent memory of the run; final boss (Jorginho
  Matagal) as the capstone agent.
- **N7 — The narrative UI.** DOM streaming-text interface (narration, choices, free-text box,
  character sheet) + Kaplay atmosphere layer (zone-reactive effects). Responsive layout.
- **N8 — Save/load v2.** Narrative history + engine state + RNG + boss memories round-trip;
  autosave between scenes; Continue/Restart in the new UI.
- **N9 — Balance & playability.** With narrator pacing in place: tune enemy scaling/economy so runs
  are winnable at the intended difficulty; simulation-backed (fake-model harness).
- **N10 — Package & ship.** Installers (Win/macOS/Linux), first-run experience (model
  load/download UX), itch.io release page, crash/telemetry decision.
- **Later:** mobile path (tiny model or engine-only), richer visuals, optional bigger-model tier
  for stronger machines.

## Definition of done (every N milestone)

`npm run typecheck` clean · `npm run build` passes · new committed tests genuinely exercising the
milestone's logic (LLM-dependent behavior tested against the fake model; expected values derived
independently) · full suite green · `src/game` and `src/llm` stay pure (no DOM/Kaplay; no
`Math.random`/`Date.now`; the ONLY nondeterminism is the real model behind the runtime interface) ·
NEEDS-HUMAN items (prose quality, feel, latency on real hardware) written to `HUMAN-CHECKS.md`.
