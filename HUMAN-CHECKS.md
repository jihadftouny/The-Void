# Human Checks — The Void

Your running checklist — things only you can verify (play-feel, visuals, real hardware, the real
model). Tick items as you go; leave a note if something's off and I'll route it back through the
build → test loop.

**The Void is now a desktop app** (Electron + a local language model). You run it with
**`npm run desktop`** — there is no localhost link anymore. (The old browser prototype from before
the LLM pivot is retired; ignore any older "open http://localhost" instructions.)

## How to run the latest build

> **⚠ CORRECTED 2026-08-27.** This section used to send you to `worktrees/functional-ui`. **Do not.**
> That worktree is pinned at 2026-08-13 and **predates M12, M13 and M15** — no `boss.ts`, no
> `unlockStore.ts`, no `sim.ts`. Testing it produces false failures. **Everything is merged to
> `main`** (2026-08-24), so run from the repo root with `npm run desktop`. The model lives in the
> Electron user-data directory; the old `VOID_MODELS_DIR` recipe pointed at `./models`, which is
> empty.

*Superseded text below, kept so the change is traceable:*

All new work lives on stacked review branches (not merged yet — your gate). To play the newest build
**without re-downloading the ~2.5 GB model**, run from the tip worktree and point it at the model you
already have:

```powershell
cd "<repo>\worktrees\functional-ui"
$env:VOID_MODELS_DIR = "<repo>\models"
npm run desktop
```

`<tip>` = **`functional-ui`** — the newest built worktree (M1–M9 engine + the functional UI that finally
surfaces it all). After you **merge to root** (see the bottom), just run `npm run desktop` from root.

---

## ▶️ HOW TO TEST EVERYTHING (the functional UI is now wired — do these in order)

The deep engine (M2–M9) is now surfaced as working (plain) controls, so you can finally hand-test it.
Run the build above, start a run **as an Enforcer** (its skills/gear are the reference values), then:

1. **Deal screen — no karma leak (most important).** Hub → "Seek a bargain" until a deal appears. You
   should see only **Cost: … / Reward: …**. ❌ FAIL if any word like "grace / tempting / standard / pool
   / karma / nature" is visible — karma is meant to be *invisible*.
2. **Spare button.** In a battle vs a **karma-weighted** enemy (Gangers on floor 1; Feelings/Sins on
   floor 3; the Judged; Echoes), a **Spare** button shows while it's alive and vanishes once it's dead.
   ❌ FAIL if Spare appears on an ordinary enemy or lingers after death.
3. **Cast picker.** In battle → **Cast** lists your skills with charge costs (`Heavy Strike (2⚡)`,
   `Brace (1⚡)`). Spend down to 1 charge → Heavy Strike is disabled, Brace still clickable. Casting
   spends the charge and resolves the round.
4. **Inventory equip/unequip.** Hub → **Inventory**: paperdoll + backpack. Equip a backpack item →
   it fills the slot and any displaced item drops to the backpack; Unequip → it returns. Check the
   Character sheet's **Armor class** updates. ❌ FAIL if an item is lost/duplicated.
5. **Character sheet — no karma.** Hub → **Character sheet**: level, six stats+mods, HP, Armor class
   (armored value, e.g. 11 for a fresh Enforcer, not 10), charges, skills, gear, and the class resource
   (momentum/corruption). ❌ FAIL if any karma/Nature value appears.
6. **The rest.** Use-item lists only consumables (not gear) and applies the effect; a chest shows
   dropped items by name+rarity; a level-up shows 3 readable draft cards and picking one applies it;
   Fight/Potion/Run behave as before.

If any ❌ or a dead button / blank panel: tell me exactly what you saw and I'll route it back through the
loop as a fix on this branch. **Visual polish (the Tibia-style paperdoll look) is deliberately NOT done
here** — that's our later art-direction session; this pass is about *functional & testable*.

---

## 🧱 Autonomous mechanical-milestone run (M1–M9 + UI + enemy-kits + M12/M13/M15 built+verified, pending merge)

**Later additions (2026-08-14), stacked further on the chain — all loop-verified:**
- **enemy-kits** — fixes "all enemies do pyroBall": 24 families now cast distinct themed skills + drop
  themed loot. (Play-test: confirm a mutant-stray poisons, a distortion drives insanity, a ganger bleeds.)
- **M12 bosses** — 5 distinct boss mechanics + the **karma verdict gate** (grace ends at act 4 / cast-down
  → Hollow-Self → damnation), routed by your hidden karma. Boss *dialogue* + floor/ending *prose* still
  need your voice (M10/M11/M12/M14). (Play-test: reach a floor boss; a virtuous run → grace, an aggressive
  run → cast-down to the Hollow.)
- **M13 unlocks** — Enforcer-only at start; Neuromancer (beat the Kingpin), Scavver (spare 3), Penitent
  (grace), Hollow (damnation) unlock and persist across runs. (Play-test: fresh profile shows only
  Enforcer; beat the Kingpin → Neuromancer unlocks next run. Locked-class visuals + unlock popups deferred.)
- **M15 balance — ✅ FIXED (the game is now winnable, proven by the simulator).** Target locked at "tough
  but fair ~1 in 3". After tuning: baseline win **32.9%** / merciful **40.0%** (1000 grace endings), Act-1
  deaths **98%→19%**, deaths now spread across all acts (modal = Act 3). Numbers in `docs/BALANCE-REPORT.md`.
  Remaining balance items for YOUR play-test (the sim is a no-equipment *lower bound* — real play is easier):
  - [ ] **Feel check** — does a careful run feel "tough but fair"? If too soft with equipment, the biggest
        knob is **`STARTING_POTS = 6`** (generous; trim toward 3–4). All tuned numbers are single-sourced.
  - [ ] **Per-class spread** — Scavver over-performs (~76% sim win) while the two **1d4-starting-gun** classes
        (Neuromancer/Hollow ~16–19%) lag. A per-class pass (incl. the starting gun in `weapons.json`) is a
        follow-up once you've felt it in play.

---

## 🧱 Autonomous mechanical-milestone run (M1–M9 built+verified, pending your merge)

I built these through the loop while you were hands-off, **stacked and unmerged** (your merge gate).
All are headless-verified (typecheck + full tests + build + adversarial checks); the items below are
the **play-feel / UI things only you can judge**, once the chain is merged and running.

- **M1 (state foundations)** — no play-check; pure serializable state (karma vector, item/inventory
  schema, standard D&D stat formula, save migration). Verified headlessly (411 tests).
- **M2 (skills + conditions)** — the engine can now `cast` and all status effects work *(the set is
  **25**, not 24 — `exposed` is the 25th; `GAME-DESIGN.md` §21.2)*, but:
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
  equipment system (equip/unequip/swap across 9 slots + backpack — ⚠ **the design is now SEVEN slots**
  (`GAME-DESIGN.md` §14.7); the shipped engine still has 9 and needs a migration; combat & AC read from the slots; save
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
- **M9 (frequent level-up loop)** — you now level up several times per floor; each level auto-grows max-HP
  and offers a **draft of 3** (new skill / skill upgrade / perk / stat point). You start lean (2 core
  skills) and build your kit over the run:
  - [ ] **Level-up draft picker** — win a fight that crosses a level threshold; confirm 3 readable option
        buttons appear and picking one advances. (Functional but minimal — visual polish is a follow-up.)
  - [ ] **Snowball feel & pacing (M15)** — do level-ups fire at a satisfying rate (several/floor) and feel
        like compounding growth? XP curve, HP-per-level, perk/upgrade magnitudes are all placeholders.

---

## ~~⚠️ Top decision — the game is unwinnable (balance)~~ — **RESOLVED by M15**

> **✅ THIS IS FIXED. The game is winnable, proven by simulation.** Baseline win rate **32.9%**,
> merciful **40.0%** — the "tough but fair, roughly 1 in 3" target, locked. See the M15 entry earlier
> in this file and `PROGRESS.md`.
>
> **The section below is kept as history only** — it describes the pre-M15 state. Nothing in it is
> an outstanding request. It used to head this file as "the most important thing to know", which
> meant a tester read a *legitimate* loss and a *real failure* as the same expected outcome.

**The historical problem, for the record:**

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
- [x] ~~**Tell me the difficulty feel you want**~~ — **ANSWERED and DELIVERED.** The target was set at
      "tough but fair, roughly 1 in 3", M15 tuned to it, and the simulator proved winnability:
      **32.9% baseline / 40.0% merciful**, with deaths spread across the Acts rather than piled at
      the Act-1 wall.

---

## Play checks (the desktop game)

Run it (see "How to run" above), then do these in order — most-likely-to-be-wrong first:

- [ ] **1. Boots.** The window opens to the title; the status line reads
      `the Void is listening — GPU (<device>)` (see the GPU check below for which device).
- [ ] **2. A full run works.** New Game → enter a name → pick a class → accept/reroll stats →
      descend into a battle → rest → level-up → keep going until an ending or death.
      (**There is no shop** — gold and shops were removed in M7. Sacrifice-deal altars replace them.)
      **A loss is normal — the tuned baseline win rate is ~33%, so most runs end in death.**
      Wrong: any dead button, a blank panel, or the run can't advance.
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
- [x] **On your 5060 laptop:** ✅ **CONFIRMED WORKING (2026-08-11)** — the GPU fix correctly selects the
      NVIDIA RTX 5060 on real hardware.
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
- [x] ~~**Enemies always hit**~~ — **ANSWERED by M4**, which shipped enemy to-hit rolls plus
      armor/shield/dodge. Nothing to decide.
- [x] ~~**Every enemy is a "Beast"**~~ — **ANSWERED by M8**, which shipped 24 enemy families with
      affixes and karma-weighting. Nothing to decide.
- [x] ~~**Shop reached via the menu's "Character Info"**~~ — **ANSWERED by M7**, which deleted the
      shop and gold entirely. Sacrifice-deal altars replace them. Nothing to decide.
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
