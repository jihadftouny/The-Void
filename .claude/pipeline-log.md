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

## 2026-08-10 — enemy-roster (M8: 24 families, affixes, spare + karma-weighting) [stacked on M7, unmerged]
- Verdict: PASS
- Fix rounds: 0
- Build-agent deviations: game.ts karma wiring landed in step-6 commit not step-7 (adding 'spared' to
  RoundStatus forces the exhaustive switch to handle it same-commit; step 7 = pure save bump).
  `resolveBattleRound` gained a leading `state` param to read the karma vector (matches resolveDealDecision).
- Test failures before fixes: none (PASS first pass). 649 → 691 tests (+42).
- Plan open-questions: 3, all orchestrator-resolved (bump v5→v6 no-op rung; uniform mercy↔cruelty now +
  per-family onSpare/onKill DATA SEAM for M10 differentiation; ELITE_CHANCE 0.15 M15 placeholder).
- Notable: 24 families (6 originals absorbed as tags), exactly 9 ⚖; Seven Sins = 1 family of 7 named
  elites. Second karma INPUT surface (spare=mercy / ⚖ kill=cruelty; non-⚖ kill neutral). Off-equivalence
  held — legacy/boss generateEnemy path byte-compatible (familyId=type, karmaWeighted=false). Complex
  family behaviors (illusions, kit-copy, resource-sap) captured as behaviorNote for M10. Per-family
  onSpare/onKill seam lets M10 set Judged→reverence, Sins→heavier cruelty by editing DATA not logic.
  Test-agent hand-derived family pick + affix delta + spare/kill karma + 3 bite-checks.
- NEEDS-HUMAN banked: enemy variety/balance/feel (M15); provisional family behaviors (M10); in-UI spare
  button + enemy/family/affix display; family name-table flavor (editorial pass).
- Manual engineer fixes: none yet

## 2026-08-10 — sacrifice-economy (M7: pure sacrifice economy, gold removed) [stacked on M6, unmerged]
- Verdict: PASS
- Fix rounds: 0
- Build-agent deviations: loot draw-order omits a separate trinket stat-pick draw (dropped ring/amulet
  stat defaults to STR) — matches the plan's own 5-draw anchor, documented. `buildChestLoot` act-agnostic
  (per-act chest tables = M8/M10 data). `shop.ts` kept as gold-free throwaway scaffolding stages 1-3 then
  deleted stage 4 (gold removal makes gold-shop uncompilable). Driver test seed re-pinned 1→2 (6-slot
  encounter table shifted seed 1's first encounter; seed 2 restores the intended battle-with-round).
- Test failures before fixes: none (PASS first pass). 625 → 649 tests (+24).
- Plan open-questions: 4, all orchestrator-resolved (ONE unit; character-info→seek-deal rename; keep
  extraRest; stat deals mods-only per existing level-up policy). Gold removal rippled into render/llm
  (format/routing/scenes/desktop/narrate) — mechanical gold-strip + shop→deal rename only.
- Notable: FIRST real karma INPUT wiring — desecrate/greed sacrifice-deals call the real recordKarma
  (reverence −2 / greed −1); non-karma deals leave karma unchanged; offer selection only READS karma.
  Karma EFFECTS still deferred. Save v4→v5 deep-equal migration (gold stripped). Loot seeded via M6
  rarityGen. Test-agent hand-derived loot/deal/karma + migration deep-equal + 3 bite-checks.
- NEEDS-HUMAN banked: economy balance/feel (~50/50 split, M15); in-UI deal-altar/loot/chest presentation.
- Manual engineer fixes: none yet

## 2026-08-10 — items-content (M6: relics, uniques, consumables + effect system) [stacked on M5, unmerged]
- Verdict: PASS
- Fix rounds: 0
- Build-agent deviations: data files in `src/data/` not `src/game/data/` (repo convention; plan path was
  wrong); SAVE_VERSION 3→4 rippled to version-LITERAL test assertions (game/view-model/narrate/save tests)
  — intended bump, no behavioral change; `format.ts` exhaustive switch got 7 new event log lines; Void
  Pact `cannotHeal` gated only at inventory-aware heal sites (potion/consumable/relic) NOT regen-tick or
  classKit lifesteal (condition/classKit can't see inventory) — flagged, judged acceptable content-milestone
  limitation; provisional relic mappings shipped where final mechanic needs unbuilt systems.
- Test failures before fixes: none (PASS first pass). 561 → 625 tests (+64).
- Plan open-questions: 4, all orchestrator-resolved (ONE unit w/ per-stage commits; consumable = no extra
  enemy turn; relics in ring/amulet 2-max; ship provisional mappings). Per-stage-commit instruction added
  after M5's session-limit interruption — this build completed clean, 5 stage commits.
- Notable: off-equivalence anchor held (trigger seam inert when no effect declared); triggered effects
  RNG-free, only rarity-gen uses rng.ts (seeded). Relics karma-neutral. Test-agent caught plan prose
  overclaiming Void Pact "blocks regeneration" — fix in M6-content co-write. 3 bite-checks.
- NEEDS-HUMAN banked: in-UI item/relic/consumable display (render follow-up); Void Pact heal-scope design
  call; item balance/feel (M15); consumable-turn-cost pacing (M15).
- Manual engineer fixes: none yet

## 2026-08-10 — equip-engine (M5: equipment engine, Tibia UI deferred) [stacked on M4, unmerged]
- Verdict: PASS (engine) — test-agent returned FAIL but ONLY for a doc deliverable the orchestrator owns
  (see reconciliation); all code checks passed. Orchestrator reconciled → treated as PASS.
- Fix rounds: 0 (the FAIL needed no code change).
- Build interruption: the FIRST build attempt was killed mid-build by a session/usage limit (nothing
  committed, 2 partial untracked files). Restarted fresh (cleared partials); the restart instruction
  added "commit each step as you go" so a future interruption can't lose committed progress. Clean run.
- Build-agent deviations: steps 3–6 committed as ONE group (dropping Player.equipped*Id breaks all call
  sites → only green once combat/defense/battle/shop/save are all rewired; splitting would commit
  failing states). `shieldAcBonus` signature now takes Inventory. Shop preserves displaced gear to
  backpack (plan-intended).
- Test failures before fixes: none real. 526 → 561 tests (+35).
- Plan open-questions: 3, all orchestrator-resolved (gear-resolver BRIDGE not full unification — defer
  to M6/M7; unbounded no-weight backpack; two-handed deferred). Plan gave recommendations, not bare asks.
- **DOCTRINE SIGNAL (recurring — 2nd time, also gpu-select):** the plan listed "append to
  HUMAN-CHECKS.md" as a BUILD-AGENT acceptance criterion, and the test-agent FAILED the unit when the
  build-agent didn't do it — but the ORCHESTRATOR maintains HUMAN-CHECKS (I told the build-agent not to
  touch it). Fix for pipeline-retro: plans must NOT put HUMAN-CHECKS edits as build/test acceptance
  criteria; that file is orchestrator-owned. The engine was sound; the FAIL was purely this mismatch.
- Notable: paperdoll now authoritative (legacy equipped*Id removed); save v2→v3 migrates ids→slots;
  effect pipeline built INERT, ready for M6 to add effect content without touching wiring. Byte-identical
  anchor held (fresh Enforcer AC 13, damage unchanged). Bespoke Tibia UI deliberately DEFERRED to an
  author art-direction pass.
- NEEDS-HUMAN banked: Tibia visual paperdoll UI (deferred collaboration); equip/inventory UX feel.
- Manual engineer fixes: none yet

## 2026-08-10 — combat-defense (M4: enemies roll to-hit, armor/shield/dodge) [stacked on M3, unmerged]
- Verdict: PASS
- Fix rounds: 0
- Build-agent deviations: (1) added 2 test-only cases to `save.test.ts` (not in declared MODIFY list) —
  plan required a shield save round-trip; `save.ts` source untouched (optional key tolerated, no version
  bump). (2) commit order steps 2/3 swapped (enemyAdvDisVs depends on scavverEvasionTwist). (3) secondary
  AC-display kept minimal (game.ts + 1 game.test assertion); render/format tests untouched.
- Test failures before fixes: none (PASS first pass). 494 → 526 tests (+32).
- Plan open-questions: 1, orchestrator-resolved: AC replace-model `baseArmor + CONmod + min(DEXmod,
  dexCap)` (armor.json's 11/12 already embed the base 10; my brief's "10 + baseArmor" wording would have
  double-counted → plan-agent caught it). Good independent-truth catch by the plan-agent.
- Notable: enemy to-hit CHANGES outcomes (enemies now miss) — all affected tests re-derived via
  scriptedRng, hand-computed vs player AC. Player attack path byte-unchanged. Enemies-missing is partial
  relief for the "unwinnable" issue (full balance still M15). Scavver dodge = enemy disadvantage.
  initiativeOrderTwist still deferred no-op. Test-agent hand-derived AC + to-hit + 3 bite-checks.
- NEEDS-HUMAN banked: combat feel with enemies missing / defense mattering.
- Manual engineer fixes: none yet

## 2026-08-10 — class-kits (M3: five classes + signature kits) [stacked on M2, unmerged]
- Verdict: PASS
- Fix rounds: 0
- Build-agent deviations: (1) `src/render/format.ts` exhaustive `formatEvent` switch needed 4 new twist
  event cases (same by-design build-guard as M2). (2) two `game.test.ts` cast tests now grant
  `skillPool:['ember']` explicitly — default pools became per-class kits (Enforcer's kit has no Ember);
  test-data update, not a behavior change.
- Test failures before fixes: none (PASS first pass). 456 → 494 tests (+38).
- Plan open-questions: 2, both orchestrator-resolved from GAME-DESIGN §4 (no user needed): uniform
  4d6 stat roll (primaryStats = flavor, not class-assigned); provisional Penitent d8 / Hollow d8 (M15).
- Notable: byte-identical anchor again — `castSkill` wraps `useSkill` and returns its exact result for
  twist-free skills (proven by scriptedRng single-value test: no extra rng draw). 5 twists (Momentum/
  Detonate/Exposure/Martyr/Corruption) all pure arithmetic, no rng. Scavver dodge = inert M4 seam. No
  save-version bump (resources additive-optional). Test-agent hand-derived all 5 twists + 3 bite-checks.
- NEEDS-HUMAN banked: class balance/feel (M15); in-UI class-select for 5 + twist visualization.
- Manual engineer fixes: none yet

## 2026-08-10 — skills-conditions (M2: player skills + 24-condition layer) [stacked on M1, unmerged]
- Verdict: PASS
- Fix rounds: 0
- Build-agent deviations: (1) touched `src/render/format.ts` + `format.test.ts` (outside src/game) —
  the `formatEvent` switch is an exhaustive by-design build-guard; new CombatEvent kinds (`skill-cast`,
  `cast-unavailable`) broke tsc unless handled. Minimal additive fix; flagged for clash-tracking.
  (2) Added `Math.max(...,0)` damage clamps so a debuff can't heal the target (safety; off-equivalent).
- Test failures before fixes: none (PASS first pass). 411 → 456 tests (+45).
- Plan open-questions: none.
- Notable: same byte-identical anchor as M1 — stat-cascade accessors return base when no augment
  active, so no pre-existing combat assertion moved. Deferred twists (Quick/Slow initiative→M4,
  Emboldened/Cowed deals→M7, Lucid/Clouded illusions→M10) built as inert commented no-op hooks. No
  save-version bump (`intensity` additive-optional). Test-agent ran 3 bite-checks, all failed-as-expected.
- NEEDS-HUMAN banked: in-UI Cast button/skill-picker (render follow-up); combat-feel play-test.
- Manual engineer fixes: none yet

## 2026-08-10 — state-foundations (M1: foundational state models)
- Verdict: PASS
- Fix rounds: 0
- Build-agent deviations: (1) 5 commits not 4 — save version-bump + migration split into its own 5th
  commit (couldn't fold into the already-committed earlier steps); benign. (2) Touched 2 consumer test
  fixtures outside declared territory (`src/desktop/view-model.test.ts`, `src/llm/narrate.test.ts`) —
  required because `karma` was made a REQUIRED `GameState` field (correct for the shape/migration
  contract), which broke those fixtures' `GameState` literals; mechanical add-a-field only, no
  production code outside `src/game/**`+`src/data/**`.
- Test failures before fixes: none (PASS first pass). 378 → 411 tests (+33: karma 16, item 7,
  inventory 4, save 30-suite incl. migration).
- Plan open-questions: none.
- Notable: independent-truth on the stat-formula swap. Orchestrator caught arithmetic disagreement in
  the PLAN's illustrative old-formula numbers (divergence point / extreme-stat example) and directed
  build+test to re-derive every assertion from the actual formulas rather than trust the plan. Outcome:
  new `floor((stat-10)/2)` agrees with the old formula across the entire base-play range (3–18), so NO
  normal-range assertion moved — only `character.test.ts` s=40 (+15) changed. Test-agent ran 4 mutation
  (bite) checks, all failed-as-expected. Lesson for plan-agent: when a plan asserts specific arithmetic
  as its correctness anchor, compute it independently — an illustrative-but-wrong anchor number nearly
  propagated.
- Manual engineer fixes: none yet

## 2026-08-04 — gpu-fix (corrected device-agnostic GPU selection)
- Loop unit stacked on model-cache. VERDICT PASS, 0 fix rounds, 378 tests (electron/gpu.test.mjs = 31, confirmed collected). Territory clean (`electron/**` only).
- Fixes the three real-hardware root causes gpu-select missed (diagnosed on the RTX 5060 laptop): (1) both Vulkan
  devices report `unifiedSize=0` so the old unified-gate never fired — replaced with a NAME-keyword + memory-vs-systemRAM
  scorer (`pickBestDeviceIndex`, pure, +3 discrete/-2 integrated name hints, +2 when total < 0.85×systemRam, qualify ≥1);
  (2) node-llama-cpp inits the Vulkan backend ONCE per process, so a same-process re-probe can't re-select — selection now
  runs in a short-lived CHILD (`electron/gpu-probe.mjs` via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`, per-device isolated
  with `GGML_VK_VISIBLE_DEVICES`), the parent picks and sets the env var BEFORE its first `getLlama`; (3) graceful fallback —
  probe fail/timeout/<2 devices ⇒ don't pin, auto-pick, never throw into boot.
- Decision + orchestration both behind an injected `runProbe`/`spawnFn` seam ⇒ fully headless; no test does real GPU
  enumeration or inference. test-agent independently re-derived the scoring on the real case (Intel iGPU 25.3e9 @ ram 25e9
  vs NVIDIA 8.3e9 ⇒ index 1) and mutation-confirmed the qualifier gate.
- NEEDS-HUMAN (real hardware): confirm 5060 is pinned on the dev laptop; packaged-asar child spawn has no 2nd window;
  single-GPU/CPU-only/non-Vulkan machines still boot via auto-pick. In HUMAN-CHECKS.md.
- Manual engineer fixes: none yet

## 2026-08-02 — model-cache (shared, download-once model location)
- Loop unit stacked on gpu-select. VERDICT PASS, 0 fix rounds, 360 tests. Territory clean (`electron/**`).
- Fix: model resolves to a fixed per-user dir (`VOID_MODELS_DIR` override, else `app.getPath('userData')/models`)
  instead of the CWD-relative `./models` — so it downloads once and every worktree/launch (and the shipped
  app) reuses it. Best-effort migration moves a legacy `./models/*.gguf` into the canonical dir (try/catch,
  never crashes). Pure `resolveModelDir` + `filesToMigrate` unit-tested.
- The test-agent was told up front that HUMAN-CHECKS is orchestrator-maintained (the gpu-select retro
  lesson applied preemptively) → clean PASS, no false FAIL. Confirms the retro fix is the right one.
- Real download/reuse/migration is NEEDS-HUMAN (in HUMAN-CHECKS.md).
- Manual engineer fixes: none yet

## 2026-08-02 — gpu-select (device-agnostic GPU selection)
- Loop unit stacked on `agentic/ui-combat-fixes`. CODE verified PASS by the test-agent: 349 tests
  (incl. the new `electron/gpu.test.mjs`, confirmed collected), typecheck/build clean, territory +
  purity clean, and the pure device-pick + orchestrator branches (CPU short-circuit, dedicated-kept,
  single-device-not-probed, hybrid-probes-and-disposes-losers, error-always-returns-a-working-llama,
  env pinned-on-win) all verified with a fake `getLlama`. No code defect; 0 fix rounds on code.
- test-agent VERDICT was FAIL for ONE reason: the plan listed "write the NEEDS-HUMAN item to
  HUMAN-CHECKS.md" as a build-agent acceptance criterion, but the orchestrator instructs build-agents
  NOT to touch HUMAN-CHECKS (project convention — it is maintained on the main line to avoid worktree
  merge conflicts). The build-agent correctly surfaced the item in its return; the checker, grading
  against the plan, flagged the missing file edit. Reconciled orchestrator-side (item added to
  HUMAN-CHECKS.md here). No re-run needed — the code checks all passed.
- pipeline-retro signal (recurs-worthy): the plan-agent should NOT put "edit HUMAN-CHECKS.md" as a
  build/test acceptance criterion — it's orchestrator-maintained. Route: DOCTRINE (project-specific).
- Real hybrid-GPU pick (discrete NVIDIA vs integrated) is NEEDS-HUMAN — in HUMAN-CHECKS.md.
- Manual engineer fixes: none yet

## 2026-08-02 — ui-combat-fixes (back on the loop: plan→build→test)
- First unit fully through the loop since the correction. Branch `agentic/ui-combat-fixes` off
  `spike/n1-local-llm`. VERDICT PASS, 0 fix rounds, 336 tests.
- Four play-test bugs, all in the render/Electron layer (engine untouched):
  (1) "No sequences left" crash — `electron/llm.mjs` never disposed the context sequence; now
  disposes session + sequence in `finally`. (2) HP frozen in combat — live player is in
  `phase.battle.player`; added pure `displayPlayer(state)` (unit-tested) and renderSheet uses it.
  (3) narration now shows only the current beat (no growing history). (4) `busy` re-entry guard +
  "the Void speaks…" indicator locks input during generation.
- Territory verified clean (only `src/desktop/**` + `electron/llm.mjs`). Runtime behaviors
  (no crash, HP ticks, single-moment, input-lock) are NEEDS-HUMAN (real model + DOM).
- Manual engineer fixes: none yet

## 2026-08-02 — Retroactive verification of the LLM slice (DOCTRINE CORRECTION)
- Lapse: the post-pivot LLM work (N1 desktop shell, playable narrator slice, story+run memory, log
  system) was hand-built on `spike/n1-local-llm` OUTSIDE plan→build→test. Only M0–M10 (the port) and
  the N1 *model spike* (legitimately exploratory) were handled correctly; the rest is ordinary,
  headlessly-testable game code that should have used the loop. The rate-limit was used to rationalize
  skipping agents. Caught by the engineer ("we must use the loop").
- Correction: ran the independent test-agent over the branch. VERDICT PASS (328 tests, typecheck/build
  clean, purity + architecture verified, checks proven to fail). It found what self-authored testing
  missed — an unguarded `new Date(time)` in electron/log.mjs (throws on NaN) and a missing headless
  test for src/desktop/persist.ts — both fixed immediately (+persist.test.ts).
- Go-forward: ALL further game code goes through plan→build→test in worktrees.
- pipeline-retro signal (high value, single severe): an exploratory spike branch silently accumulated
  shippable feature code outside the loop. Proposed doctrine note — "a spike proves a risk then stops;
  feature code graduates to a worktree unit and goes through the loop; never keep building on the spike
  branch." Route: DOCTRINE (project-specific), not the agent files.
- Manual engineer fixes: electron/log.mjs NaN-date guard; added src/desktop/persist.test.ts.

## 2026-08-02 — N1 local-LLM spike (EXPLORATORY — ran outside the pipeline)
- Not a plan→build→test run. Deliberate deviation: this was a hardware-measurement spike (native
  node-llama-cpp, 3.6GB model downloads, real inference on the dev laptop) — the test-agent can't
  verify inference headlessly, and the worktree/node_modules-junction model doesn't fit native deps
  + multi-GB model files. Done directly on branch `spike/n1-local-llm`; verdict is GREEN.
- Orchestrator fixed two harness bugs mid-spike (context needed 2 sequences; JSON test token cap too
  low → truncation). Grammar-constrained JSON proven working; only failure mode is length truncation.
- Signal for pipeline-retro: when a milestone is a hardware/inference spike, prefer a documented
  exploratory branch over forcing the worktree pipeline. Full results: `docs/N1-SPIKE.md`.
- Manual engineer fixes: none yet

## 2026-08-01 — wire-save (save/load wired into the UI)
- Verdict: PASS (awaiting review/merge). Integration unit on `agentic/wire-save` = `agentic/ui-shell` + `agentic/save-load` merged (clean, disjoint) as the base, then the wiring built on top.
- Fix rounds: 0. 315 tests green.
- Delivered: pure `src/render/persistence.ts` (autosave/clear/continue-available predicates, headlessly tested); GameDriver gains injectable `SaveStorage` (+ resume/restart/persist); title "Continue" + game-over "Restart" wired; `main.ts` injects the real localStorage adapter. Autosave at main-menu + act-intro; save cleared at ending/game-over; mid-battle does NOT persist.
- Build-agent deviations: none of substance (one self-corrected circular restart-test assertion during authoring). `src/game/**` and `src/storage/**` imported, never modified.
- NEEDS-HUMAN: real-browser Continue/Restart/localStorage-reload checks (in HUMAN-CHECKS.md).
- Note: after this, the user set a major new direction — pivot to an LLM-driven narrative game (see memory `llm-driven-narrative-vision.md`); milestones/UI will be re-scoped via an interview next session.
- Manual engineer fixes: none yet

## 2026-08-01 — save-load (M9) + ui-shell (M10), run IN PARALLEL
- Verdict: both PASS (awaiting review/merge). Two concurrent units, disjoint file territories, both branched off agentic/logic-core.
- Fix rounds: 0 (each unit passed its first test-agent run).
- Parallelization: clash-avoidance held — save-load owns src/game/save.ts + src/storage/**; ui-shell owns src/render/** + src/scenes/** + src/main.ts + index.html. No overlap; test-agents confirmed each diff stayed in its lane. node_modules shared via junction; only ui-shell serves (dev server), no port clash.
- M9 build-agent deviations: version model mirrors GameState.version (no separate envelope); shape validation scoped to named invariants + player envelope (phase-variant payloads trusted). No open questions.
- M10 build-agent deviations: engine flipped landscape→portrait 540×1080 (mobile-first, principle #5); re-derived layout constants for 1080; added src/scenes/common.ts + a level-up "reset picks" affordance. Open questions (visual direction, resolution, same-stat level-up, clock seed) all resolved by orchestrator to faithful/mobile-first defaults.
- Test failures before fixes: none.
- Notable: M10 is the pipeline's visual blind spot — pure helpers (layout/routing/format) unit-tested; all rendering/mobile correctness surfaced as NEEDS-HUMAN (5 items) in HUMAN-CHECKS.md. Save/load intentionally left unwired into the UI (disabled "Continue" seam) — future glue unit.
- Manual engineer fixes: none yet

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
