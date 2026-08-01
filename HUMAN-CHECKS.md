# Human Checks — The Void

Your running checklist. Anything the automated pipeline **cannot** decide for itself lands here:
things you must see, feel, try, or judge. Tick items as you go; leave a note if something's off and
I'll route it back through the build → test loop.

**You can now actually play the game on screen** (see the M10 section below).

Everything currently lives on three review branches stacked on top of each other; run commands from
the branch's folder until you merge (see "Review & merge" at the bottom).

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

## M10 — Play it on screen (visual & mobile checks only you can do)

The Kaplay UI shell is built (branch `agentic/ui-shell`). jsdom has no graphics, so the pipeline
can't see what renders — these are yours. To run it:
```
cd "worktrees/ui-shell"
npm run dev        # then open the printed http://localhost:5173/
```
Do these in order (most-likely-to-be-wrong first):

- [ ] **1. Boots without a crash.** Open the URL with the browser console open. Right: the title
      screen shows **THE VOID**. Wrong: any red console error, or a blank/black canvas with no title.
- [ ] **2. A full run renders and advances.** New Game → enter a name → pick a class → accept (or
      reroll) stats → main menu → descend into a battle (confirm **both HP bars** and a **scrolling
      combat log**) → rest → shop → act intro/outro → level-up (tap **two** stat picks; try the same
      one twice) → keep going. Then start over and lose a battle to see the game-over screen. Wrong:
      any blank/incorrect screen, a dead button, a missing HP bar, log won't scroll, or level-up
      won't take two picks. (Note: you'll lose to the balance issue above — that's expected for now.)
- [ ] **3. Portrait legibility + letterbox scaling.** In the browser's device toolbar, view a narrow
      phone (≤360px wide), a large phone, and a resized desktop window; toggle a notched device.
      Right: text is legible, the canvas is centered with black bars (never stretched/cut), nothing
      hides under a notch or home bar. Wrong: clipped/tiny text, distortion, content under the notch.
- [ ] **4. Touch targets + keyboard.** On a touch device/emulator, tap buttons and enter a name.
      Right: buttons feel finger-sized (≥44px) with a clear pressed state; the mobile keyboard opens
      for the name and the text box sits over the canvas. Wrong: tiny buttons, no pressed state, no
      keyboard, or a misplaced text box.
- [ ] **5. Combat log scrolling.** In a long fight, confirm wheel + drag/touch scroll the log and it
      auto-scrolls to the newest line.
- [ ] **Visual direction check:** this shell is a clean **text-forward terminal** look on purpose.
      If you want it more visual (enemy pictures, a floor map, animated dice), that's a later
      milestone — tell me and we'll scope it (this is the "interview" topic).

---

## M9 — Save / load, now WIRED into the UI (play checks)

Branch `agentic/wire-save` (contains M9 + M10 + the wiring). The save engine is fully unit-tested;
these are the real-browser checks (run `cd worktrees/wire-save && npm run dev`), most-likely-wrong first:
- [ ] **Continue appears after progress.** Fresh store shows only "New Game"; after creating a
      character and reaching the hub, reload — the title now shows "Continue" too.
- [ ] **Continue resumes the same run.** Tap it: same character (name/HP/gold), back at the hub.
      (The narration log starts empty on resume — that's intended.)
- [ ] **Restart clears the save.** Reach game-over → tap "Restart" → only "New Game" shows; reload →
      still no "Continue".
- [ ] **Mid-battle isn't saved.** Start a fight, reload mid-fight, Continue → you resume at the hub,
      not inside the half-fight (autosave is between encounters, by design).
- [ ] **Private/blocked storage** degrades gracefully — no crash, Continue simply never appears.

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
`agentic/wire-save` now contains **everything** — the engine (M1–M8), save/load (M9), the UI shell
(M10), and the save/load wiring — because it was built on top of both earlier branches. So the whole
project merges in **two steps** (I verified this is conflict-free end to end):

```
git merge --no-ff agentic/logic-core     # the engine
git merge --no-ff agentic/wire-save      # M9 + M10 + wiring, all together
```
(Or just `git merge --no-ff agentic/wire-save` alone — it already includes the engine's history.)

The now-redundant branches `agentic/save-load` and `agentic/ui-shell` are subsumed by `wire-save`;
after merging you can delete them and the superseded `agentic/m1-character-core`, plus their
worktrees:
```
git worktree remove worktrees/<name> && git branch -d agentic/<name>
```
Review with `git -C "worktrees/wire-save" diff main...HEAD`. If anything's off, tell me — it goes
back through the same build agent as a fix round.

> **Heads-up:** given the LLM-narrative pivot, you may prefer to merge this to lock in the foundation
> *before* we re-scope, or hold off. Your call — I won't merge until you explicitly say so.

---

## Verified
_(move items here once you've confirmed them)_
