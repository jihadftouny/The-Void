# Human Checks — The Void

Your running checklist — things only you can verify (play-feel, visuals, real hardware, the real
model). Tick items as you go; leave a note if something's off and I'll route it back through the
build → test loop.

**The Void is now a desktop app** (Electron + a local language model). You run it with
**`npm run desktop`** — there is no localhost link anymore. (The old browser prototype from before
the LLM pivot is retired; ignore any older "open http://localhost" instructions.)

## How to run the latest build

All new work lives on stacked review branches (not merged yet — your gate). To play the newest build
**without re-downloading the ~2.5 GB model**, run from the tip worktree and point it at the model you
already have:

```powershell
cd "<repo>\worktrees\<tip>"
$env:VOID_MODELS_DIR = "<repo>\models"
npm run desktop
```

`<tip>` = the newest built worktree (currently **`class-kits`** = M3, the tip of the M1→M2→M3 chain).
After you **merge to root** (see the bottom), just run `npm run desktop` from the root — no env var needed.

---

## 🧱 Autonomous mechanical-milestone run (M1–M8 built+verified, pending your merge)

I built these through the loop while you were hands-off, **stacked and unmerged** (your merge gate).
All are headless-verified (typecheck + full tests + build + adversarial checks); the items below are
the **play-feel / UI things only you can judge**, once the chain is merged and running.

- **M1 (state foundations)** — no play-check; pure serializable state (karma vector, item/inventory
  schema, standard D&D stat formula, save migration). Verified headlessly (411 tests).
- **M2 (skills + 24 conditions)** — the engine can now `cast` and all 24 status effects work, but:
  - [ ] **In-UI Cast button + skill picker** is NOT wired yet (engine-only this milestone) — a render
        follow-up. Confirm you're OK that casting isn't yet clickable in the desktop UI.
  - [ ] **Combat feel with casting** — once wired: are starting charges too scarce? Is enemy-side
        damage-over-time (poison/bleed/burn) satisfying? Is casting worth a turn vs. a plain attack?
- **M3 (5 classes + signature kits)** — Enforcer, Neuromancer, Scavver, Penitent, Hollow, each with a
  4-skill kit and one twist (Momentum / Detonate / Exposure / Martyr / Corruption):
  - [ ] **Class-select shows all five** and each creates a character that reaches the main menu.
  - [ ] **Twist feedback is legible** in battle (momentum building, corruption/lifesteal, detonate,
        exposure) — the engine emits the events; their on-screen rendering is play-test-only.
  - [ ] **Class balance & feel** — is any class unplayably weak or trivially dominant? (All magnitudes
        and the provisional Penitent/Hollow d8 hit dice are **M15 balance placeholders** — tuning input.)
- **M4 (combat overhaul — defense matters)** — enemies now roll to-hit vs your Armor Class (they can
  miss), armor value/dex-cap/str-requirement + shields + Scavver dodge all change how hard you are to hit:
  - [ ] **Combat feel** — does it read tough-but-fair? Enemies missing sometimes, heavier armor/shield/
        meeting str-req/playing Scavver each *visibly* making you harder to hit. Wrong = trivially easy,
        or defense choices produce no felt difference. (All constants are **M15 placeholders**.)
- **M5 (equipment engine — Tibia UI DEFERRED)** — the inventory paperdoll is now the authoritative
  equipment system (equip/unequip/swap across 9 slots + backpack; combat & AC read from the slots; save
  migrated v2→v3). **The bespoke Tibia-style visual UI was deliberately NOT built** — it needs your
  art-direction and can't be verified headlessly:
  - [ ] **The Tibia visual paperdoll UI is a dedicated collaboration pass with you** (drag-drop slots,
        backpack container, item tooltips/comparison). The engine underneath is done & tested — tell me
        when you want to design the UI together.
  - [ ] **Equip/inventory UX feel** — checkable once that UI exists (equip/unequip/swap, the shop's
        "your current gear" display).
- **M6 (items content — relics, uniques, consumables)** — 15 relics, 4 named uniques, 19 consumables, a
  triggered-effect system (6 combat trigger points), and a seeded rarity generator. All engine + tested;
  no in-UI display yet:
  - [ ] **In-UI item/relic/consumable display** — names, effects, and a *use-consumable* control are NOT
        surfaced in the UI yet (render follow-up, pairs with the Tibia UI pass). Confirm it's genuinely
        absent (logic exists & tested), not half-wired.
  - [ ] **Void Pact heal-scope (design call)** — the "cannot heal" relic currently blocks potion/consumable/
        relic heals but NOT the regeneration condition or class lifesteal (those systems can't see your
        inventory). Decide if you want it to be a *total* heal-lock (then it's a small follow-up).
  - [ ] **Item balance & feel** and **should using a consumable give the enemy a free turn?** — both **M15**
        tuning calls; every item magnitude is a placeholder.
  - _Provisional relic mappings_ (Ash Censer, Reliquary, Ashen Crown, Hollow Regalia, Empty Vessel…) are
        real & tested but mapped to the closest current mechanic; final semantics land in the M6 content
        co-write / M10 floor hooks.
- **M7 (pure sacrifice economy — GOLD REMOVED)** — there is no currency anymore. Victory gives XP + a
  loot drop; floors have chests; the shop is replaced by a **sacrifice-deal altar** ("seek a deal") that
  trades power for a piece of yourself (HP / max-HP / a stat / a charge / a relic / a desecration):
  - [ ] **The sacrifice-deal altar & loot/chest reveals render** — pick "seek a deal" from the menu and
        confirm the cost/reward text + Take/Refuse buttons appear and work; confirm loot drops and chests
        show what you got. Ships as plain text + buttons only — visual framing is a render follow-up.
  - [ ] **Economy balance & feel (M15)** — is the ~50/50 found-loot vs sacrifice-deal split right? Are the
        deal costs (esp. HP/max-HP) fair? Every number is a placeholder; gold removal shifts pacing.
  - _Note: desecration/greed deals now genuinely move your hidden karma — the first real karma **input**.
        Karma **effects** (how it bends the world/ending) come in M10/M14._
- **M8 (bestiary — 24 families, affixes, the spare action)** — fights now draw varied enemies per floor
  (Gangers/Drones → Reflections → Feelings & Sins → Angels → Void-horrors), with occasional elite affixes
  (Ravenous/Ancient/Warped/Blessed/Cursed), and you can now **spare** karma-weighted foes:
  - [ ] **In-UI spare button + enemy/family/affix display** — the engine offers "spare" vs karma-weighted
        enemies and names affixed elites, but the button + visual display aren't wired (render follow-up).
  - [ ] **Enemy variety & balance (M15)** — is the elite rate (15%) right? Do families feel distinct? All
        stats/affix magnitudes/karma weights are placeholders.
  - _Deferred to M10 floor hooks: the signature family behaviors (Reflections' illusions, Mirror-Selves
        copying your kit, Grief sapping resources, etc.) — shipped as flat themes for now. Family name
        flavor also wants your editorial pass._

_Note: the "unwinnable balance" item below predates this run; the dedicated balance pass is **M15**,
where I'll sim-verify winnability against your difficulty-feel input._

---

## ⚠️ Top decision — the game is currently unwinnable (balance)

This is the most important thing to know, and it is a **design decision for you, not a bug**.

- **What:** A full, honest playthrough cannot currently reach the final act. Automated simulation
  found **0 wins across 20,000 runs**; the best run reached 13 of the 240 experience points needed
  for the finale.
- **Why:** The original Java was an unfinished draft where every enemy had **1 health** (trivially
  winnable, never balanced). We put in the game's own *intended* enemy-health formula, but it gives
  even the first enemy ~**30 health** while your character starts near **11**. The two sides were
  never balanced against each other because the original never had both.
- **The engine is correct** — combat, rewards, and the win→ending path are all proven. Only the
  *numbers* need a tuning pass.
- **Your levers:** enemy health (`src/game/enemy.ts`), weapon dice (`src/data/weapons.json`),
  player starting health / hit die (`src/game/player.ts`).
- [ ] **Tell me the difficulty feel you want** (e.g. "Act 1 enemies take ~3–4 hits; a careful run
      wins maybe 1 in 3") and I'll run a balance pass that tunes the numbers **and proves by
      simulation the game is winnable** before handing it back.

---

## Play checks (the desktop game)

Run it (see "How to run" above), then do these in order — most-likely-to-be-wrong first:

- [ ] **1. Boots.** The window opens to the title; the status line reads
      `the Void is listening — GPU (<device>)` (see the GPU check below for which device).
- [ ] **2. A full run works.** New Game → enter a name → pick a class → accept/reroll stats →
      descend into a battle → rest → shop → level-up → keep going until an ending or death.
      (You'll lose to the balance issue above — expected for now.) Wrong: any dead button, a blank
      panel, or the run can't advance.
- [ ] **3. HP ticks down in combat.** As you take hits, the health on the left character sheet drops
      turn by turn. Wrong: HP frozen at full during a fight.
- [ ] **4. Narration shows only the current moment.** Each beat replaces the last — the story panel
      doesn't grow into an ever-longer scroll, and the left sheet doesn't get dragged around.
- [ ] **5. Input is locked while the model speaks.** During "the Void speaks…" the choice buttons
      don't respond; they re-enable when narration finishes. Wrong: a click mid-generation crashes
      with **"No sequences left"** or double-fires.
- [ ] **6. Continue / New Game.** Quit and relaunch → **Continue** resumes your run (the story panel
      starts empty on resume — intended). Death or **New Game** clears the save.

---

## GPU — should use your discrete RTX 5060  *(corrected selector built on `agentic/gpu-fix`)*

The game now probes each GPU in a short-lived child process (so it can actually read per-device
memory), scores them by name + memory-vs-system-RAM, and pins the discrete one **before** the model
starts (no vendor/model hardcoded). This replaces the earlier `gpu-select` heuristic that kept
landing on the Intel iGPU. Verified by 378 headless tests; the real-hardware confirmation is yours:
- [ ] **On your 5060 laptop:** run `npm run desktop`, let the model load, then open `logs\void.log`.
      The selection line should read `gpu:selected index=1 name=NVIDIA …` (NOT `gpu:auto`, NOT the
      Intel iGPU), and the in-app status line should name the NVIDIA RTX 5060. In Task Manager →
      Performance, the **NVIDIA** GPU's dedicated memory should climb during generation (not the
      Intel one), and speed should feel like the GPU tier (~90 tok/s), not CPU/iGPU.
- [ ] **No second window flashes** during boot (the probe runs as plain Node, not a 2nd Electron
      window). If a window flashes or the log says `gpu:auto reason=error … app.asar`, tell me.
- [ ] **Other machines still boot:** on a single-GPU / CPU-only / non-Vulkan box it should log
      `gpu:auto` and generate normally — never crash on selection.

---

## Model download location — download once, shared (branch `agentic/model-cache`)

The model lives in one per-user folder (`%APPDATA%\the-void\models` by default; override with the
`VOID_MODELS_DIR` env var), so it downloads once and every run / worktree / the shipped app reuses it.
- [ ] After merging to root, run `npm run desktop` from the **root** the first time — the log should
      show a `model migrated` line MOVING your existing root `models\*.gguf` into the per-user folder
      (instant, same drive), with **no 2.5 GB re-download**.
- [ ] Run again from anywhere — no download, fast start; the log `models dir` points at the per-user
      folder and no new `models\` folder is created in the current directory.
- [ ] (optional) Set `VOID_MODELS_DIR` to a folder of your choice and confirm the log `models dir`
      uses it.

---

## Balance & rules calls I made faithfully to the original (confirm or change)
Each follows the original Java (or cleans up an obvious gap); all are one-line tweaks via the loop.
- [ ] **Enemy stat bonuses** — original left them unused (zero); I compute them (enemies a bit
      stronger). Keep or revert?
- [ ] **Flee chance ~25%** — the original's *code* is ~25% though its *comment* says 35%. I used the
      code. Which did you intend?
- [ ] **Enemies always hit** — faithful (the original never rolled enemy attacks to hit). Add a miss
      chance later if fights feel punishing?
- [ ] **Every enemy is a "Beast"** — the only name-type the original ever spawned. Want distinct
      enemy families per act later?
- [ ] **Shop reached via the menu's "Character Info"** — faithful quirk. Keep, or make the shop its
      own choice / random encounter?
- [ ] **Level-up raises max health but doesn't heal** — faithful. Keep?
- [ ] **Final boss gets no automatic advantage** — faithful. Keep?
- [ ] **Dying in the final battle shows the death screen, not the ending** — a clean-up. Keep?
- [ ] **Hidden lore in Acts 2–4** — an original off-by-one hid the third lore snippet; kept hidden
      but stored, so it's a one-line switch to show them. Want them shown?
- [ ] **Placeholder story/lore text** — much of the original's lore/story is stub text
      ("this is a lore…"). As the author, you'll likely want to write the real text — I can wire in
      whatever you write.

---

## Review & merge (your gate — I never merge without your explicit OK)

The work stacks, each branch built on the one before, all through plan → build → test:

`spike/n1-local-llm` → `ui-combat-fixes` → `gpu-select` → `model-cache` → `gpu-fix` *(verified tip)*

The **tip contains everything below it**, so **one merge brings it all**. From the main checkout
(currently on `spike/n1-local-llm`), merge the newest verified tip:

```powershell
git merge --no-ff agentic/gpu-fix          # engine + all five units, at once
npm run desktop                            # first root run migrates your model copy, no re-download
```
Then delete the merged worktrees + branches:
```powershell
git worktree remove worktrees/<name> && git branch -d agentic/<name>
```
Review the diff with `git -C "worktrees/<tip>" diff main...HEAD`. If any check is off, tell me which
— it goes back through the same build agent as a fix round.

---

## Verified
_(move items here once you've confirmed them)_
