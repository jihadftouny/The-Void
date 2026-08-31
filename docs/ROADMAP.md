# The Void — Milestone Roadmap (v3: the mechanics-first roguelike)

> **v3 supersedes v2.** v2 (the LLM-narrative roadmap, N0–N10) is folded into this sequence — the
> local-LLM design and N1 spike results still hold (see `docs/GAME-DESIGN.md §10` and the memory
> record), and the LLM work now lives as milestones **M11–M12** below. The full v2 text remains in
> git history.

## Context

The Void is a **mechanics-first, roguelike descent** through five floors of the Void: a crunchy
D&D-style RPG where a **local language model narrates** the journey; the **engine writes every player choice**,
while the deterministic engine owns every rule and number. A run = descend five floors or die; death
restarts the run but **unlocks** new content for future runs (breadth, never raw power). Everything
the player does is read into a **hidden, multi-axis "Nature" (karma)** that bends the world and the
mechanics mid-run and resolves into a **blended, analog ending**. Tough but fair (~45–90 min runs).

**The complete design (the WHAT) is `docs/GAME-DESIGN.md`.** This file is the **milestone plan (the
HOW/WHEN)**. We execute **one milestone at a time**, each later expanded into its own implementation
plan and run through the agentic loop. Where the two ever conflict, `GAME-DESIGN.md` is the newer
intent and this file is reconciled to it.

### Locked design decisions (from the 2026-08-05 scope interview)
- **Mechanics-first.** The tactical RPG is the heart; the LLM narrates over it and never runs rules.
- **Hybrid-but-roguelike.** Authored 5-floor arc, die-and-restart, **unlocks-only** meta-progression.
- **Subtle theme.** Psychosis is felt through tone/consequence — no sanity bar, no visible meters.
- **Karma / "Nature" = core pillar, hidden, multi-axis.** Live from floor 1; **floor 4 is the
  reckoning** (carried karma × floor-4 choices decides grace vs. being cast into floor 5). Endings are
  a blended spectrum the narrator renders.
- **Engine-authoritative LLM.** Narrator writes **prose only** — the engine writes every choice; engine owns dice/damage/loot/state;
  all game-feeding LLM output is grammar/JSON-constrained.
- **Tough but fair.** Real challenge, meaningful death, mastery-driven.
- Full item detail (~~Tibia-style paperdoll~~ **text lists, §22.9**, relics, uniques + rarity, rich consumables), enemy detail
  (~24 families + affixes, 5 boss agents), and floor identities are in `GAME-DESIGN.md`.

### Stack & targets (from `CLAUDE.md`)
Node 18+, TypeScript 5 (strict), Vite 6, Vitest 2, Kaplay (atmosphere), DOM (narrative text).
Desktop packaging: **Electron + node-llama-cpp** (GGUF 4B, grammar-constrained). **Min spec: a GPU is
required** — decided 2026-08-26; the 1.7B fallback was rejected and 4B is the only tier shipped
(`CLAUDE.md`, `GAME-DESIGN.md` §14.8). *This line previously said "typical laptop, no GPU".* Logic + LLM cores run and are tested **headlessly in Node** (fake model — never real
inference in tests).

### ⚠ The pre-M0 base — **HISTORICAL, superseded 2026-08-24. For today's state read `PROGRESS.md`.**

*This section described the codebase as of ~2026-08-05 and was never updated. It is kept for
history. **Everything below is out of date:*** the stack merged to `main` on 2026-08-24;
**`shop` and `gold` are DELETED** (replaced by sacrifice-deals); there are **25 conditions, not
"11 of 24"**; the **standalone Kaplay UI shell is DELETED** (`index.html` + `src/scenes/`, retired by
M-UI2 — Kaplay is now a dependency nothing imports, reserved for the unbuilt canvas layer); and the
count is **1029 tests, not ~378**.

*Original text:*
- **Deterministic engine** (`src/game`, pure, seeded RNG): d20 combat w/ advantage/crits/fumbles, 6
  stats, 2 stub classes, act-gated leveling/XP, enemy generation, 11 of 24 status conditions,
  shop, rest, gold, the 5-act state machine, a final boss, and a serializable `step(state, input)`
  controller that plays a full run headlessly.
- **Save/load** (safe encode/decode, corrupt-save rejection, version/migration seam).
- Kaplay UI shell + **desktop Electron app** with a **local LLM narrator** that narrates a full
  run beat-by-beat (Qwen3-4B GGUF, streaming, engine-authoritative fallback), **device-agnostic GPU
  selection**, and **shared model-cache**. ~378 tests green.
- **The agentic loop** (plan/build/test/retro agents), `PROGRESS.md`, `HUMAN-CHECKS.md`, doctrine.

Because it is already playable end-to-end, the milestones below **deepen a working game** rather than
build from zero.

---

## Load-bearing principles (apply to every milestone)

From `CLAUDE.md` / `docs/PRINCIPLES.md` — these are cheap now, a rewrite if retrofitted:

1. **Pure logic / render split.** All rules in framework-agnostic TS under `src/game` — no Kaplay,
   DOM, or canvas there, ever. `src/render` and `src/desktop` only draw state and forward input.
   *(`src/scenes/` was deleted by M-UI2.)* The logic core runs and is tested headlessly in Node.
2. **Deterministic seeded RNG.** Every gameplay random (dice, loot, encounters, prices, **karma
   resolution**) flows through `src/game/rng.ts`. Never `Math.random()`/`Date.now()` in `src/game`.
3. **Data-driven content.** Weapons, armor, trinkets, uniques, consumables, skills, conditions,
   enemy tables, relics, floor/zone prompts, karma rules — all JSON/data modules. Adding content
   never means editing combat code.
4. **Serializable plain-data state.** Game state (incl. **inventory** and **multi-axis karma**)
   round-trips through JSON. No class instances/functions/canvas objects in state; save/load migrates.
5. **Engine-authoritative LLM.** The narrator narrates; **the ENGINE writes every player choice**
   (reversed 2026-08-25 — `CLAUDE.md` §5, `GAME-DESIGN.md` **§10**); the engine owns all
   numbers and **all karma changes** (never the LLM). LLM output is grammar/JSON-constrained. The LLM
   layer (`src/llm`) is pure and testable against a fake model.
6. **Desktop-first, responsive.** Target desktop; keep layouts responsive for a later mobile path.

---

## Milestones

### M0 — Consolidate the base & reconcile to mechanics-first
- **Goal:** One clean trunk to build on, and the docs pointing the same way.
- **Done when:** the held branch stack (engine + save/load + desktop LLM slice + GPU fix +
  model-cache) is merged to a single trunk **(merge is the user's gate)**; `ROADMAP`/`PROGRESS`/
  `CLAUDE.md` reconciled to mechanics-first; the full run still plays and tests are green post-merge.
- **Key decisions:** merge order + post-merge full-suite re-run (conflict-free text ≠ conflict-free
  behavior). *(Docs/merge — largely exempt from the pipeline; the post-merge verification is not.)*

### M1 — Foundational state models  ★ front-loaded; expensive to retrofit
- **Goal:** The serializable shapes everything else hangs on, before any behavior depends on them.
- **Done when:** `GameState` carries (a) a **multi-axis Karma/Nature** state + a pure `karma.ts` that
  records actions (no-op effects for now); (b) a **data-driven item schema** (kinds weapon/armor/
  trinket/usable; slots; rarity; effects); (c) an **inventory/paperdoll** state shape. All round-trip
  through JSON; **save migration** from the old shape works; typecheck/tests green.
- **Key decisions:** the karma axis set (`GAME-DESIGN §7`); slot list (`§6`); item-effect
  representation as plain data (so effects are content, not code). **Determinism is won or lost here.**

### M2 — Player skills + the full 25-condition system
- **Goal:** Players can finally act tactically; status play becomes real.
- **Done when:** a `cast` action exists in the battle loop; a first skill set applies conditions; **all
  25 conditions** (**12 core** + `exposed` + 6 augments + 6 deprivations — *corrected 2026-08-30; the
  old breakdown read "poison + 6 + 6 + `exposed`", which sums to **14** and silently omitted eleven,
  including `fracture`, `burn` and `stun` — precisely the ones G23/G27 prove do not tick correctly*)
  tick correctly with hand-derived
  tests; elements/resistances affect skill damage; enemies use the same framework.
- **Key decisions:** augment/deprivation names + effects (`GAME-DESIGN §5`); charge/cost model.

### M3 — Classes & signature kits
- **Goal:** Distinct character identities.
- **Done when:** 3–5 mechanically distinct classes exist, each with a **signature ability kit** (data)
  built on M2; creation flow picks class → kit; the hit-die+gear-only stubs are gone.
- **Key decisions:** the roster (`GAME-DESIGN §4`); how level-up picks (M9) relate to class kits.

### M4 — Combat overhaul: defense matters
- **Goal:** Fix the "enemies always hit" gap so gear choices matter.
- **Done when:** enemies **roll to hit vs Armor Class**; armor's own value + `dexCap`/`strReq` feed
  AC/defense; shields/off-hand supported; tests assert the to-hit math both ways.
- **Key decisions:** whether all attacks roll or only specials (default: all); AC formula w/ armor.

### M5 — Inventory & equipment ~~(Tibia-style)~~ **(text-based — `GAME-DESIGN.md` §22.9)**  ★ first big new interactive system
- **Goal:** A real inventory game on screen.
- **Done when:** a paperdoll of **seven slots — head, body, hand ×2, feet, trinket ×2**
  (`GAME-DESIGN.md` §14.7; amulet/ring/legs/back are **cut**) + backpack.
  ⚠ **The shipped engine has 9 slots — a migration is needed.** Original line: (helmet, amulet, two hands, armor, legs, boots, ring, ammo) + backpack
  container; equip/unequip across slots; item comparison; **equipped effects apply** to stats/combat;
  fully serializable; DOM UI, responsive.
- **Key decisions:** capacity/weight vs. slot-count only; two-handed vs. weapon+shield (`§6`).

### M6 — Items content: relics, uniques, consumables
- **Goal:** The stuff that makes runs feel different.
- **Done when:** **build-defining relic trinkets** (passive synergies) change how a build plays;
  **authored named uniques** with mechanical effects; a **rarity-scaling** generator (stats +
  occasional procs); **rich consumables** (antidote, throwables/instant-damage, buffs) usable in and
  out of combat.
- **Key decisions:** first relic/unique set (themed per floor, `§6`); rarity power curve.

### M7 — Loot sourcing & the thematic economy
- **Goal:** Where gear comes from, and what you spend.
- **Done when:** loot flows from **drops + chests + sacrifice-deals** *(**not shops** — there are none,
  and no currency; `GAME-DESIGN.md` §11/§14.1)*; the economy is **reworked thematically**
  (chosen direction — sacrifice / dual-currency / karma-priced, `§11`) with real sinks
  (gear/consumables/rerolls/services); the one-offer "mysterious stranger" is replaced by a proper
  **sacrifice-deal altar** encounter. *(This bullet previously said "shop encounter" — there are no
  shops and no currency.)*
- **Key decisions:** pick the economy direction; drop-table design (data-driven, seeded).

### M8 — Enemies: families, affixes, karma-weighting
- **Goal:** A real bestiary that feeds the pillar.
- **Done when:** the roster expands from Beast-only toward **~24 families** with **per-floor
  assignment**; **stat-modifying affixes** produce elite variants; **karma-weighted families**
  (Sins/Feelings) shift Nature axes when killed vs. spared.
- **Key decisions:** finalize the family roster (`GAME-DESIGN §9`); CR-based vs. per-floor-budget
  scaling; which kills/mercies move which karma axis.

### M9 — In-run progression (frequent level-up picks)
- **Goal:** The roguelike "snowball your build" loop.
- **Done when:** the 4 act-gated level-ups are replaced by **frequent, choice-driven** growth (draft a
  skill / stat / perk); builds snowball within a run; pacing tuned to the ~45–90 min target.
- **Key decisions:** draft source (class kit vs. shared pool vs. both); do stats grow via picks only.

### M10 — The five floors: content, mechanics, karma effects  ★★ the mechanics-first game realized
- **Goal:** The full descent, with karma bending it.
- **Done when:** all five floors have their identities + a **per-floor signature mechanic**; **karma's
  mid-run world + mechanical effects** are live from floor 1; the **floor-4 reckoning gate** routes
  grace vs. cast-down as a function of **carried karma × floor-4 choices** (`GAME-DESIGN §7–8`).
- **Key decisions:** per-floor mechanics; the floor-4 grace path question (does a grace run end at
  floor 4, or does everyone reach floor 5 differently?).

### M11 — LLM layer to spec
- **Goal:** Bring the working narrator up to the full design.
- **Done when:** the narrator writes **prose only** — **per-floor voices**; **beat significance** (which
  beats deserve prose at all); **karma reaching the prompt**; **boss-agent infrastructure** (own prompt
  + run-memory, and the boss **selects its own actions** from an engine-computed legal set,
  `GAME-DESIGN.md` §17.3); **talking to bosses** in free text (§20); everything headlessly testable
  against a **fake model**.
- **DROPPED 2026-08-26 — M11 shrank:** ~~grammar-constrained choices~~ and ~~the engine-as-toolbox tool
  registry~~. **The engine writes the choices** (**§10**). *(The tool registry also listed "shop", which no
  longer exists.)*
- **Key decisions:** how karma colors tone without ever exposing a meter — still open, and the reason
  karma must reach the prompt at all.

### M12 — Bosses: five unique encounters as agents
- **Goal:** Memorable capstones per floor.
- **Done when:** each floor ends in a **distinct boss with unique mechanics** (not stat-scaling); each
  is a **boss agent that remembers your run** (built on M11); the final boss is the climax.
- **Key decisions:** the five boss identities/mechanics (`GAME-DESIGN §8`).

### M13 — Meta-progression: unlocks & mastery feats
- **Goal:** Reasons to keep descending.
- **Done when:** a **persistent unlock store** (separate from the run save) grants new classes/skills/
  items/relics/enemies when **mastery feats** are met (reach floor X, win as Y, walk a karma path…);
  **no power creep** — base power is constant.
- **Key decisions:** the feat list (`GAME-DESIGN §12`); unlock-store schema + migration.

### M14 — Karma payoff: the blended-spectrum endings
- **Goal:** Pay off the whole run.
- **Done when:** the **floor-4 gate stays binary** (grace vs cast-down) and the ending **within each
  path blends** by where all four karma axes landed (`GAME-DESIGN.md` §17.1); distinct karma paths
  produce genuinely different endings.
- **SETTLED 2026-08-26/27:** the text is **authored anchors + narrated specifics** (§14.10) — you write
  what grace and damnation *are*, word for word; the narrator fills in what happened on this run.
  *"Made whole" is the thesis and must be the author's words.*
- **Also in scope now:** the **Hollow ascent** has its own ending at the Undercity threshold
  (`WORLD.md` §13–14).

### M15 — Balance pass (tough but fair), simulation-verified
- **Goal:** Winnable at the intended difficulty.
- **Done when:** enemy scaling, economy, and class/skill/item power are tuned so a **simulation proves
  a target win-rate** (fake-model harness) and it **feels** tough-but-fair in play. (Folds v2 N9;
  resolves the long-standing "unwinnable" flag.)
- **Key decisions:** target win-rate + difficulty feel (needs the user's input, per `HUMAN-CHECKS`);
  optional ascension ladder deferred.

### M16 — Polish & game-feel
- **Goal:** Make it look and feel good.
- **Done when:** inventory/combat UX polish, hit/damage feedback, **per-floor Kaplay atmosphere**
  (white/red distortion, falling ash, angelic light, void dark), transitions — all render-side, none
  touching determinism; responsive.
- ~~**Key decisions:** what's quality-gated for the min-spec no-GPU laptop.~~ **CLOSED 2026-08-26** —
  a **GPU is required**, and there is **no quality gating: 30fps with everything always on**
  (`UI-DESIGN.md` §16).

### M17 — Package & ship (itch)
- **Goal:** A double-click game.
- **Done when:** installers (Win/macOS/Linux); **the model DOWNLOADED once on first run** (decided
  2026-08-25 — not bundled) with honest progress and a real failure path; itch.io release page.
  (Folds v2 N10.)
- **Key decisions — ALL NOW SETTLED, see `docs/SHIPPING.md`:** ~~bundle vs. first-run download~~
  → **download**; ~~store page + pricing~~ → **free, optional donation, itch app handles updates**;
  ~~crash/telemetry~~ → **none**.

---

## Cross-cutting concerns — when addressed

| Concern | First addressed | Why then |
|---|---|---|
| Serializable state: karma + inventory shapes | **M1** (foundational) | Cannot be retrofitted; save/migration and every later system depend on it. |
| Determinism (seeded RNG incl. loot & karma) | From **M1**, enforced every milestone | The reproducibility guarantee; balance sim and tests rely on it. |
| Data-driven content (items/skills/enemies/relics) | Schema at **M1**, filled M2–M8 | Adding content must never mean editing logic. |
| Karma feeding (which actions move Nature) | Wired as each system lands (M2 skills, M6 items, M7 economy, M8 enemies, M10 floors) | Karma reads "everything you do," so each system hooks it as it's built. |
| Balance — light hygiene | Continuous from M2 | Cheap habits; expensive to claw back. |
| Balance — dedicated pass | **M15** (after content exists to tune) | Can't tune what isn't built; sim needs the real systems. |
| Narrative authoring (co-written, author's final voice) | Interleaved from **M8/M10/M12** onward | Floor/enemy/boss text is written as those systems land, floor by floor. |
| LLM kept working throughout | Existing slice narrates engine events from M0 | New systems emit events → stay narrated; **M11** elevates to full spec. |
| Save/load migration | Every milestone that changes state shape (esp. M1, M5, M13) | State grows; old saves must migrate or be safely rejected. |

**Currently playable:** already (old engine + LLM narrator). **The mechanics-first game realized:**
end of **M10** (deep combat, builds, items, enemies, karma-bent five-floor descent). Everything after
is capstones (bosses, endings), tuning, and shipping.

---

## Verification (per milestone)

- **`npm run typecheck`** clean (the project script — a bare `tsc --noEmit` can validate zero files);
  **`npm run build`** passes.
- **New committed tests** genuinely exercising the milestone's logic, with **independently-derived**
  expected values (never asserted against the implementation's own output). LLM-dependent behavior is
  tested against the **fake model**.
- **Determinism tests:** same seed + inputs → identical state, including loot and karma resolution.
- **Capacity/save tests:** state round-trips through JSON; old saves migrate or are safely rejected.
- **`npm run desktop`** manual play for feel/visual/latency checks; **NEEDS-HUMAN** items (prose
  quality, difficulty feel, real-hardware) written to `HUMAN-CHECKS.md`.

## Execution model

We proceed **milestone by milestone**. When a milestone starts, we open a fresh planning pass that
expands that single milestone into a detailed implementation plan, then implement and verify before
advancing. **All game-code changes run through the `agentic-engineering` loop** (plan-agent →
build-agent → test-agent in a dedicated git worktree), with manual engineer review and a **gated
merge**. Docs like this and `GAME-DESIGN.md` are exempt from the loop; the code that implements them
is not. Several **[OPEN]** design items (`GAME-DESIGN §15`) are brainstormed with the author before
the milestones that depend on them.
