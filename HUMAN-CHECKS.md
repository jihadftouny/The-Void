# Human Checks — The Void

Your running checklist. Anything the automated pipeline **cannot** decide for itself lands here:
things you must see, feel, try, or judge. Tick items as you go; leave a note if something's off and
I'll route it back through the build → test loop.

How to run the tests (no screen needed):
`npm install` (first time) → `npm test` — the whole game engine is covered headlessly (237 tests).

How to run the app (title screen only, so far):
`npm run dev` → open the printed URL. The playable on-screen game arrives with the Kaplay UI (M10).

---

## ⚠️ Top decision — the game is currently unwinnable (balance)

This is the most important thing to know, and it is a **design decision for you, not a bug**.

- **What:** A full, honest playthrough cannot currently reach the final act. Automated simulation
  found **0 wins across 20,000 different runs**; the best run reached 13 of the 240 experience
  points needed for the finale.
- **Why:** The original Java game was an unfinished alpha where every enemy had **1 health** (so it
  was trivially winnable and never balanced). We replaced that placeholder with the game's own
  *intended* enemy-health formula (found unused elsewhere in the Java) — but that formula gives even
  the first enemy about **30 health**, while your character starts around **11 health** with small
  weapons. The two sides were never balanced against each other because the original never had both.
- **The engine itself is correct** — combat, rewards, and the "you win → ending" path are all proven
  to work (verified with a controlled fight). It's the *numbers* that need a tuning pass.
- **Your levers** (any one, or a mix): enemy health formula (`src/game/enemy.ts`), weapon damage
  dice (`src/data/weapons.json`), player starting health / hit die (`src/game/player.ts`).
- [ ] **Decide the direction.** Tell me the feel you want (e.g. "Act 1 enemies should take ~3–4
      hits; a careful player should win a full run maybe 1 in 3 attempts") and I'll run a balance
      pass through the loop that tunes the numbers **and proves with simulation that the game is
      winnable** at a sensible difficulty before handing it back.

---

## Pending checks

### The whole engine (branch `agentic/logic-core`) — code review + merge (your gate; I never merge)
This one branch contains the entire port, milestones **M1 through M8** (it includes the earlier M1
work, so it supersedes the separate `agentic/m1-character-core` branch).
- [ ] **Review the code.** `git -C "worktrees/logic-core" diff main...HEAD` — 25 commits, 26 modules
      under `src/game` + `src/data`, plus tests. Confirm it reads the way you want the game's logic
      to look.
- [ ] **Run the tests yourself if you like.** From `worktrees/logic-core`: `npm test` → 237 green.
- [ ] **Merge when happy** (from the repo root):
      `git merge --no-ff agentic/logic-core`
      then clean up **both** now-merged branches and their worktrees:
      `git worktree remove worktrees/logic-core && git branch -d agentic/logic-core`
      `git worktree remove worktrees/m1-character-core && git branch -d agentic/m1-character-core`
- [ ] If anything's off, tell me — it goes back through the same build agent as a fix round, not a
      hand-patch.

### Balance & rules calls I made faithfully to the original (confirm or change)
Each of these follows the original Java (or cleans up an obvious gap). None can be judged without
you; all are one-line tweaks I can make through the loop.
- [ ] **Enemy stat bonuses** — the original left enemy attribute bonuses unused (zero); I compute
      them, which makes enemies a bit stronger. Keep, or revert to the original's zero?
- [ ] **Flee chance ~25%** — the original's *code* escapes ~25% of the time, though its *comment*
      says 35%. I used the code (25%). Which did you intend?
- [ ] **Enemies always hit** — the original never rolled enemy attacks to hit (they always land); I
      kept that. Add a miss chance later if fights feel too punishing?
- [ ] **Every enemy is a "Beast"** — the original only ever spawned the "Beast" name-type in all
      acts (other types were stubbed out). Kept faithful. Want distinct enemy families per act later?
- [ ] **Shop is reached via the menu's "Character Info"** — faithful to the original's quirk (the
      stranger appears when you open your character screen). Keep, or make the shop its own choice /
      random encounter?
- [ ] **Level-up raises max health but doesn't heal you** — faithful to the original. Keep?
- [ ] **The final boss gets no automatic advantage** — faithful (only random battles grant it). Keep?
- [ ] **Dying in the final battle shows the death screen, not the ending** — a clean-up (the original
      showed the ending even on death). Keep?
- [ ] **Hidden lore entries** — in Acts 2–4 the third lore snippet was unreachable in the original
      (an off-by-one). I kept it hidden by default but stored it, so it's a one-line switch to turn
      all lore back on. Want the hidden entries shown?

### M0 — App shell (still valid)
- [ ] **App boots to the title screen.** `npm run dev` → near-black canvas showing **THE VOID**,
      "A Text RPG by Jihanger", "vAlpha — press anywhere to begin". Wrong: blank page or a console
      error.
- [ ] **Letterboxing in portrait.** Resize tall-and-narrow (or a phone preset): the game stays
      centered and scales with black bars, not stretched. Wrong: squashed text or cut-off content.

---

## Verified
_(move items here once you've confirmed them)_
