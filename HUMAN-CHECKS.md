# Human Checks — The Void

> ## ✅ THE DEFERRAL BELOW IS LIFTED — healing is reachable as of `#0c persistence-and-reach`
>
> **Updated 2026-09-01, by `#0c`.** The block immediately below deferred the floor-5 checks on the
> grounds that "there is no healing in the game… no consumable can be obtained until **#9**". **That
> is no longer true.** `#0c` fixed G14: authored consumables and uniques are now on the victory-drop
> and chest paths, act-gated by each item's `floor`. Measured over 100 whole runs (20 seeds × 5
> classes) driven through the real engine: the **Use item** picker appears in **96%** of runs and
> offers something that **heals** in **94%**. The deferred checks below are now fair to attempt.
> (This arrives one milestone earlier than `SHIP-SCOPE.md` §7 scheduled it, which is why the
> deferral note reads as it does. It is kept, not deleted, so the change is traceable.)
>
> ### ⚠ EXPECTED: the game will feel TOO EASY, and that is scheduled, not a bug
>
> **Do not report generosity as a defect.** v1 temporarily carries **two healing systems at once**:
> the `STARTING_POTS` potions the game has always had, AND the newly-droppable consumables — one of
> which, `void-draught`, heals **100% of max HP**. `GAME-DESIGN.md` §22.6 folds potions into
> consumables, and §18.4 says healing must become scarce, but both belong to the balance re-run
> (`PLAN.md` #2), which must follow #9. This was an explicit ruling, not an oversight: a game with
> NO healing is worse than one with too much, and #2 will tighten it with measurements rather than
> guesses. **What IS worth reporting:** whether finding a heal feels like a find, and whether the
> drop rate makes the Use-item picker feel cluttered.
>
> ## ⏸ DEFERRED until `PLAN.md` #9 lands — the game cannot be played to floor 5 yet
>
> **Added 2026-09-01.** ~~`#0a` and `#0b` are merged and the engine is far healthier, but **there is
> no healing in the game**: §22.6 folded potions into consumables, and no consumable can be obtained
> until **#9 content-reachability** lands.~~ **(Superseded by `#0c` — see above.)** A run therefore
> ends in act 1–2 regardless of skill, so asking anyone to reach act 5 is not a fair test. **Do
> these once #9 is in:**
>
> - [ ] **Floor-5 length.** Reach act 5, count encounters before the Hollow is offered.
>       `HOLLOW_GATE_XP = 500` (§22.21) is a derived guess. Under ~4 = not a floor; over ~10 = a grind.
> - [ ] **Does momentum decay feel right?** End a battle with momentum banked, start the next — you
>       should open on half, rounded down. `MOMENTUM_CARRY = 0.5` (§22.19) is unmeasured; say whether
>       it should be gentler or harsher.
> - [ ] **Is stacked damage-over-time too strong now that it works?** Re-apply the same burn/bleed
>       three or four times. It has never once fired correctly, so nobody has seen it.
> - [ ] **Enemy skill cadence.** Enemies now use a themed skill roughly every other hit instead of
>       twice per battle. Too spiky?
> - [ ] **A Blessed enemy really resists now.** `resistBonus` went 2 → 25. A Firebomb should do **4**
>       to a Blessed enemy and **6** to a plain one. Wall, or speed bump?
> - [ ] **Act-5 encounters cannot be fled.** Press Run in an ordinary act-5 fight — you should get a
>       clear refusal, not a dead button.
>
> **Checkable right now, without a full run** (~10 minutes, from the repo root, `npm run desktop`):
>
> - [ ] **It boots and a fight resolves.** No agent can run Electron, so this is genuinely unverified.
> - [ ] **Equip a Common found weapon — you should hit for LESS.** Expected and known (§22.20): found
>       weapons swing `1d1` until #1 lands. Confirming it behaves as documented is the point.
> - [ ] **The to-hit line adds up.** A fresh character should now read `+3`, not `+1`.
> - [ ] **Reach any ending, press Continue — the ending text must STAY on screen.**

## ▶️ From `#0c persistence-and-reach` (2026-09-01) — nine checks no agent can do

No agent can run Electron, so every item here is genuinely unverified. `npm run desktop` from the
repo root. ⚠ **`npm run desktop` orphans its Vite server on quit (`FINDINGS.md` G41, unfixed), so
the SECOND and later launches serve STALE CODE.** Kill whatever holds port 5173 between play-tests,
or these checks are worthless.

- [ ] **The combat log — the biggest visible change in the whole unit.** Until now the player saw
      **no numbers at all**: the formatters existed and nothing called them, and the narrator is
      forbidden from mentioning dice or numbers. Start a fight. You should now see a running log of
      what happened. **Click an attack line** — it should expand to the dice
      (`d20+2 = 17 vs AC 13 → hit, 1d8 = 4`). It should scroll, and **start over at each new
      battle**. Check the arrow marker reads clearly and that `Tab` reaches the expanders.
- [ ] **Healing, end to end.** Win fights until an item drops, open **Use item**, drink it, watch HP
      rise. The log should name it (*"You use Void Draught."*) — never `void-draught`.
- [ ] **Condition chips.** Get poisoned or stunned. Chips should appear in the left HUD column for
      you, and for the enemy during a battle, ordered control → harm → boon. Are they legible at
      that size? Does the row wrap sensibly in a 220px column?
- [ ] **A backtick in the name field.** Type `` ` `` into the character-name box. It must type a
      backtick and **must not** open the debug overlay. (Then press `` ` `` outside the field — the
      overlay should still open.)
- [ ] **Relaunch after a WIN.** Reach an ending, then quit and relaunch. You should be offered a
      **new** run, not *"A descent lies unfinished."*
- [ ] **The end-of-run summary reads well — after all three outcomes.** Death, grace, and damnation.
      It should name bosses and unlocks in words, never ids, and it should not feel like a receipt.
- [ ] **The unlock-recovery notice.** Hard to trigger deliberately; if you ever see the red-bordered
      notice at the top of the stage, say whether it was comprehensible. (To force it: with the app
      closed, corrupt `thevoid:unlocks` in the Electron localStorage.)
- [ ] **Layout at the minimum window size.** The stage gained two rows (notice, log). Shrink the
      window: the narration must not be squeezed out, and the log should scroll inside its own cap.
- [ ] **Feel: are the new drop rates right?** Too many consumables? Too few? A unique dropping too
      early? All three are `PLAN.md` #2's dials, not defects — but your read is the input it needs.


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

## 🧱 Autonomous mechanical-milestone run (M1–M9 + UI + enemy-kits + M12/M13/M15 — **MERGED to `main` 2026-08-24**; the play-checks below are still outstanding)

**Later additions (2026-08-14), stacked further on the chain — all loop-verified:**
- **enemy-kits** — fixes "all enemies do pyroBall": 24 families now cast distinct themed skills + drop
  themed loot. (Play-test: confirm a mutant-stray poisons, a distortion drives insanity — renamed
  **`Static`** once `PLAN.md` #1.5 lands, `GAME-DESIGN.md` §22.13 — and a ganger bleeds.)
- **M12 bosses** — **4 of 5** boss mechanics (⚠ **the floor-4 executioner fight does not exist** — `PLAN.md` #11; `boss.ts` has four combat bosses) + the **karma verdict gate** (grace ends at act 4 / cast-down
  → Hollow-Self → damnation), routed by your hidden karma. Boss *dialogue* + floor/ending *prose* still
  need your voice (M10/M11/M12/M14). (Play-test: reach a floor boss; a virtuous run → grace, an aggressive
  run → cast-down to the Hollow.)
- **M13 unlocks** — Enforcer-only at start; Neuromancer (beat the Kingpin), Scavver (spare 3), Penitent
  (grace), Hollow (damnation) unlock and persist across runs. (Play-test: fresh profile shows only
  Enforcer; beat the Kingpin → Neuromancer unlocks next run. Locked-class visuals + unlock popups deferred.)
- **M15 balance — ✅ FIXED (the game is now winnable, proven by the simulator).** Target locked at "tough
  but fair ~1 in 3". After tuning: baseline win **32.9%** / merciful **40.0%** (1000 grace endings), Act-1
  deaths **98%→19%**, deaths now spread across all acts (modal = Act 3). Numbers in `docs/BALANCE-REPORT.md`.
  Remaining balance items for YOUR play-test (⚠ **the "lower bound — real play is easier" claim was
  WRONG**, `FINDINGS.md` G11: found loot cannot be equipped at all, so 32.9% is what play actually
  does. **Do not expect the game to feel easier than the figures.**):
  - [ ] **Feel check** — does a careful run feel "tough but fair"? If too soft with equipment, the biggest
        knob is **`STARTING_POTS = 6`** (generous; trim toward 3–4). All tuned numbers are single-sourced.
  - [ ] **Per-class spread** — Scavver over-performs (~76% sim win) while the two **1d4-starting-gun** classes
        (Neuromancer/Hollow ~16–19%) lag. A per-class pass (incl. the starting gun in `weapons.json`) is a
        follow-up once you've felt it in play.

---

## 🧱 Autonomous mechanical-milestone run (M1–M9 built+verified, pending your merge)

I built these through the loop while you were hands-off. **They were merged to `main` on 2026-08-24**
(all 19 unit branches are ancestors of `main`); only the hand-checks below remain.
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
- **M5 (equipment engine — ~~Tibia UI DEFERRED~~ visual UI DROPPED 2026-08-31, §22.9)** — the inventory (text) is now the authoritative
  equipment system (equip/unequip/swap across 9 slots + backpack — ⚠ **the design is now SEVEN slots**
  (`GAME-DESIGN.md` §14.7); the shipped engine still has 9 and needs a migration; combat & AC read from the slots; save
  migrated v2→v3). **The bespoke Tibia-style visual UI was deliberately NOT built** — it needs your
  art-direction and can't be verified headlessly:
  - [x] ~~**The Tibia visual paperdoll UI is a dedicated collaboration pass with you**~~ **— DROPPED
        2026-08-31** (`GAME-DESIGN.md` §22.9): the inventory is **text lists**, so there is no
        paperdoll to design. ~~(drag-drop slots,
        backpack container, item tooltips/comparison).~~ The engine underneath is done & tested — the
        UI ships as **text lists**, so there is nothing left to co-design here.
        when you want to design the UI together.
  - [ ] **Equip/inventory UX feel** — checkable once that UI exists (equip/unequip/swap, the shop's
        "your current gear" display). ⚠ *2026-08-31: there is no shop (M7 deleted it) and no separate
        visual UI — check this against the **text inventory** instead.*
- **M6 (items content — relics, uniques, consumables)** — 15 relics, 4 named uniques, 19 consumables, a
  triggered-effect system (6 combat trigger points), and a seeded rarity generator. All engine + tested;
  no in-UI display yet:
  - [ ] **In-UI item/relic/consumable display** — names, effects, and a *use-consumable* control are NOT
        surfaced in the UI yet (render follow-up — pairs with the **text-inventory** pass, ~~Tibia UI~~). Confirm it's genuinely
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
landing on the Intel iGPU. Verified by headless tests (**378 at the time; 1029 today**); the real-hardware confirmation is yours:
- [x] **On your 5060 laptop:** ✅ **CONFIRMED WORKING (2026-08-11)** — the GPU fix correctly selects the
      NVIDIA RTX 5060 on real hardware.
- [ ] **No second window flashes** during boot (the probe runs as plain Node, not a 2nd Electron
      window). If a window flashes or the log says `gpu:auto reason=error … app.asar`, tell me.
- [ ] **Other machines still boot:** on a single-GPU / CPU-only / non-Vulkan box it should log
      `gpu:auto` and generate normally — never crash on selection.

---

## ⚙️ Machine setting you will need before the first real package (found 2026-08-30)

- [ ] **Enable Windows Developer Mode** (Settings → System → For developers), or run the pack from an
      elevated shell. **Without it, `npm run desktop:pack` cannot finish** even once the code defect
      is fixed: `electron-builder` extracts `winCodeSign`, which contains symbolic links, and
      Windows refuses with *"Cannot create symbolic link: A required privilege is not held."*
      This is a machine privilege, not a repo problem.
      > **Context:** the pack command **had never once succeeded** until 2026-08-31 (`FINDINGS.md`
      > **G44**, now **FIXED** — the config validates). The historical cause:
      > a one-line config defect. A verification run with that defect fixed got all the way through
      > app packaging — producing a **correct** `app.asar`, with the GPU probe and the model loader
      > both working from inside it — and then hit this privilege wall. So the one-line fix is
      > necessary but **not sufficient on this machine.**

## Model download location — download once, shared

> **⚠ SUPERSEDED heading, 2026-08-28.** This section was titled *"branch `agentic/model-cache`"*.
> **That branch no longer exists** — it was merged and deleted on 2026-08-10 (`PROGRESS.md`), and the
> checkout has been on `main` ever since. The behaviour below is on `main` now; only the branch
> reference was stale. The three boxes are still worth ticking on your next run.

The model lives in one per-user folder (`%APPDATA%\the-void\models` by default; override with the
`VOID_MODELS_DIR` env var), so it downloads once and every run / worktree / the shipped app reuses it.
- [ ] ~~After merging to root~~ **(already merged)** — run `npm run desktop` from the **root** the first time — the log should
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

## ⚠️ Found gear is equippable but MIS-MODELLED until `PLAN.md` #1 lands (from `#0a combat-core`)

**Added 2026-09-01 by the `#0a` build, as a condition of your "ship it" ruling on the plan's open
question 1 (Appendix A.1). Do not let this get quietly forgotten — it is a real trap in play.**

G11 is fixed: an item you find now equips. But the mechanical accessors
(`equipment.ts` `weaponForSlot` / `armorForSlot`) still resolve **by legacy name only**, and a
generated drop's id is the synthetic `gen:<rarity>:<slot>`, which no legacy table knows. So:

- an equipped **found weapon swings the UNARMED `1d1` die**, not a real weapon die;
- equipped **found armour falls back to the unarmored `10 + CON` base**, not the armour's own AC;
- only the rolled item's flat `bonusDamage` / `bonusArmorClass` survives (via the effect pipeline).

**The trap, in numbers:** the Enforcer's starting `Jaaj Sword 1` is `1d6`, averaging **3.5** damage.
A **Common** generated `mainHand` is `1d1 + (1..2)` = **2–3**. So *equipping a Common weapon drop
makes you weaker*, and `dropTables.json` gives `mainHand` weight 2 of 5 in act 1 (**~40% of act-1
drops**). Rare (3–5) is roughly a wash; Legendary (6–9) is a genuine upgrade. The same shape applies
to armour.

- [ ] **Play-check:** start a run, take an act-1 **Common** weapon drop, equip it, and confirm you
      hit for *less* than with your starting weapon. Confirm the same trap on a Common armour drop
      (your Armor class on the character sheet should *drop* toward the unarmored base).
- [ ] **Then confirm it is gone** once `PLAN.md` **#1 `engine-foundations`** lands the item-schema
      unification (native dice/AC on the rolled overlay) — #1 is the next unit after #0, so the gap
      is one unit wide.

*Deliberately NOT worked around in `#0a`:* no balance fudge, and weapon/armour drops were not
suppressed. The behaviour ships honestly and #1 fixes the cause.

---

## Review & merge (your gate — I never merge without your explicit OK)

> # ⚠ THIS WHOLE SECTION IS SUPERSEDED — do not run the commands below
>
> It describes a merge that **completed on 2026-08-10**. All four branches it names —
> `agentic/gpu-fix`, `ui-combat-fixes`, `gpu-select`, `model-cache` — **were deleted after merging**
> and no longer exist; `git merge --no-ff agentic/gpu-fix` will simply fail. The checkout is on
> **`main`**, not `spike/n1-local-llm`.
>
> **The merge gate today:** everything listed here is already on `main`. Future units merge **one at
> a time**, each gated on your explicit OK, per `.claude/skills/agentic-engineering/SKILL.md` §4 —
> review with `git diff main...agentic/<slug>`, then `git merge --no-ff agentic/<slug>` from the main
> checkout. **The next thing to merge is `#0a`/`#0b`/`#0c`** (`docs/PLAN.md` #0), none of which has
> a branch yet.
>
> *Kept below as history — every other stale block in this file got a banner like this one; these two
> were missed, and unlike the others they invite you to execute commands.*

~~The work stacks, each branch built on the one before, all through plan → build → test:~~

~~`spike/n1-local-llm` → `ui-combat-fixes` → `gpu-select` → `model-cache` → `gpu-fix` *(verified tip)*~~

~~The **tip contains everything below it**, so **one merge brings it all**. From the main checkout
(currently on `spike/n1-local-llm`), merge the newest verified tip:~~

```powershell
# SUPERSEDED — these branches no longer exist:
# git merge --no-ff agentic/gpu-fix
# npm run desktop
```
~~Then delete the merged worktrees + branches:~~
```powershell
git worktree remove worktrees/<name> && git branch -d agentic/<name>
```
Review the diff with `git -C "worktrees/<tip>" diff main...HEAD`. If any check is off, tell me which
— it goes back through the same build agent as a fix round.

---

## Verified
_(move items here once you've confirmed them)_

---

# 2026-09-02 — unit `observability` (principle 7, G6, G37, G41, G50)

**Why this unit exists.** You hit a freeze on the first enemy encounter — on a GPU machine, so the
known CPU-slowness explanation did not apply. It recovered on its own and never recurred, and **we
could not diagnose it**, because there was no timing instrumentation anywhere in the codebase and
`electron/llm.mjs` had **zero** log calls. This unit both **fixes the most likely cause** (G37) and
**makes the next one diagnosable**.

**No agent can run Electron**, so everything below needs you. Ten checks; **check 3 is the decisive
one** and is written as a fill-in-the-numbers form.

## Where the log is now

| OS | Path |
|---|---|
| Windows | `%APPDATA%\the-void\logs\void.log` (previous session: `void.log.1`) |
| macOS | `~/Library/Application Support/the-void/logs/void.log` |
| Linux | `~/.config/the-void/logs/void.log` |

It is **capped at 4 MiB with exactly two files** (~8 MiB hard ceiling) and **it was previously a
silent no-op in any packaged build** — that is G6, and it is why a shipped game had no crash
diagnostics at all. Every launch writes one banner line naming `pid`, `cwd`, the app version and the
platform, so two worktrees sharing one user-data log stay distinguishable.

`npm run desktop` prints `[void] logging to <path>` at boot, and the path is now correct in a
packaged build too.

---

## 1. `[manual]` The log exists where it should

Run `npm run desktop`. Confirm the printed path is under the user-data folder in the table above and
**not inside the repo**. Confirm the file exists and its first line is a `=== session … ===` banner.

## 2. `[manual]` The boot timeline is complete

In that file, confirm one line each for: `log configured`, `window loaded` (`ms`),
`narrator load: start`, `model resolve: done` (`ms`), `gpu probe: done` (`ms`), `llama init: done`
(`ms`), `model load: done` (`ms`), `context create: done` (`ms`), `narrator load: done` (`ms`),
`app booted` (`bootMs`). **Every one must carry its number in `data`, and no message anywhere may
contain a digit.** A quick check: `findstr /C:"\"ms\":" void.log` should find plenty.

## 3. `[manual]` ⭐ THE FREEZE — IS IT FIXED, AND IS IT NOW DIAGNOSABLE?

**This is the check the whole unit is for.** Start the game and click through to the first enemy
encounter **as fast as you can** — that is what the incident did: the first `generate` lands on the
stats-accept step, four clicks in, well inside the model-load window.

Then open the log and fill this in:

| Question | Where to look | Your answer |
|---|---|---|
| Did the game freeze at all? | (your own experience) | |
| How many `narrator load: start` lines are there? | grep `narrator load: start` | |
| Is there one with `"call":2`? | same lines, `data.call` | |
| Is there a `narrator load: already in flight` line, and what is its `data.call`? | grep `already in flight` | |
| Is there a `generate: waiting for narrator` line? What is `data.waitedMs`? | grep `waiting for narrator` | |
| Are there `generate: STILL RUNNING` lines? | grep `STILL RUNNING` | |
| If so, does `data.chunks` GROW between them? | the heartbeat payloads | |
| What is the `ui`/`turn` `data.ms` for that first narrated action? | grep `"turn"` | |

**How to read it:**

- **`narrator load: start` must appear EXACTLY ONCE, with `"call":1`.** A second one with `"call":2`
  means G37 is back — two concurrent model loads. The fix memoises the load promise, and a headless
  concurrency test asserts "exactly one construction" under twenty racing callers, so this should be
  impossible. If you see it anyway, that is the single most important thing to report.
- **`already in flight` with `"call":2` is the fix WORKING.** It means the second caller arrived
  during the load and waited for the first instead of starting its own.
- **`generate: waiting for narrator` → `data.waitedMs` IS the freeze, in milliseconds.** After the
  fix this should be roughly the remaining model-load time (seconds on a warm cache, longer on a
  first-run download) rather than a *second whole load* (~2× everything, including GPU probes at a
  30 s timeout each).
- **`STILL RUNNING` heartbeats:** a `warn` every 10 s while a generation is outstanding. If
  `data.chunks` GROWS between beats the model is merely slow; if `chunks` is FROZEN the token stream
  has stopped. That single distinction is the question the original incident could not answer.
- **`ui`/`turn` `data.ms`** is exactly how long the game was unresponsive, because `busy` is held for
  the whole dispatch.

**Write the numbers into this file either way.** If the freeze does not recur, the same lines from a
healthy run are the baseline the next incident is compared to.

## 4. `[manual]` The player sees nothing

Play five minutes. No millisecond, token count, category tag (`[llm]`, `[engine]`) or level word
(`WARN`) may appear in the narration pane, the combat log, the HUD or the status line. (Machine-
checked as far as it can be: the render and LLM layers are forbidden by test from importing the
logger at all, and no log call in `game.ts` may touch a player-facing element — but only you can see
the actual screen.)

## 5. `[manual]` Rotation

Set `VOID_LOG_LEVEL=debug` and play for a while, or leave the game running. When `void.log` passes
4 MiB, confirm **exactly two files** exist and the older one is `void.log.1`.

## 6. `[manual]` The shipped level, and the player's name

Launch the packaged / `file://` build (`npm run desktop:build`). In its log confirm:
- the action timeline is there (one `engine`/`step` and one `ui`/`turn` line per action, with `ms`);
- generation stats are there (`ttftMs`, `tokens`, `tokPerSec`);
- **no `DEBUG` lines at all**;
- **the character name you typed does NOT appear anywhere.** This is the deliberate decision behind
  keeping the name in a developer log (plan ruling A.4): a packaged build runs at `info` and the
  `ui`/`choice` payload that carries the name is `debug`. `src/log/level.test.ts` asserts that
  consequence, but this is the real build.

## 7. `[manual]` G41-a — the clean quit

`npm run desktop`, quit the window, then `netstat -ano | findstr :5173` → **nothing**. Repeat twice.

## 8. `[manual]` G41-b — back-to-back worktrees

Launch from one worktree, quit, launch from another. The launcher prints `[void] serving <absolute
path>` — confirm it matches the checkout you are in, and that your edits actually take effect.

## 9. `[manual]` G41-c — the ugly exit

Launch, then kill the launcher hard (`taskkill /F` on the `node scripts/desktop-dev.mjs` PID, or just
close the terminal). Port 5173 must be free afterwards. **This is the case the register's recorded
fix could not cover**, and it works now because Vite runs *inside* the launcher process — the OS
releases the socket whichever way that process dies.

## 10. `[manual]` G41-d — a squatter

Start a plain `npm run dev` in another terminal, then run `npm run desktop` in a second one. It must
print `port 5173 is held by a stale Vite dev server (pid …) — reclaiming it`, kill it, and start
normally. Then repeat with a NON-Vite server on 5173 (e.g. `npx http-server -p 5173`): it must
**refuse loudly**, naming the PID and a `taskkill /F /PID …` command, and **must never boot Electron
against it**.

> ⚠ **There is very likely a stale Vite already on your port 5173 right now.** While verifying this
> unit, `netstat` showed `TCP [::1]:5173 [::]:0 LISTENING 29236` with `/@vite/client` answering
> `200 text/javascript` — a live orphaned dev server, i.e. **G41 in the wild on your machine**. It
> was left alone rather than killed without asking. The new launcher will reclaim it automatically
> on the next `npm run desktop`, which is check 10 happening for real.

---

## What was NOT verified, and cannot be by any agent

- Anything requiring Electron to actually run: the log file in a **packaged** build, the real boot
  timeline, the heartbeat firing against a real model, and every G41 check above. The pure decisions
  behind all of them are unit-tested, and the G41 reclaim path was additionally exercised against a
  **real Vite dev server** (a real `strictPort` rejection, a real `netstat` parse, a real
  `/@vite/client` probe, a real kill, and a real port release) — but the launcher and `main.mjs`
  themselves are covered by source guards only.
- Whether the freeze was **actually** G37. The evidence is circumstantial but matches on every
  observable. Check 3 is what settles it.
