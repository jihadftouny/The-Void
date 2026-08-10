# The Void — What We Built (plain-language overview)

This document explains, in simple terms, everything that exists in this project and how the pieces
fit together. No prior knowledge assumed; any unavoidable technical word is explained in the same
sentence.

---

## 1. What The Void is

**The Void is a story-driven role-playing game** about descending through five floors of a dark,
dreamlike place — inspired by lived experience of psychosis and by the dice-and-stats
rules of Dungeons & Dragons. You create a character, and you descend: fighting enemies, resting,
trading with a mysterious stranger, growing stronger, until a final boss and an ending.

The new, defining idea: **an AI language model tells the story as you play.** It writes the
narration for every moment, reacting to what you do — but it runs **on your own computer** (no
internet, no accounts, no per-use cost), and it is never allowed to cheat: a separate, rock-solid
"rules engine" decides all the actual numbers (damage, dice, loot). The AI only supplies the *words*.

---

## 2. The journey so far (how we got here)

1. **Ported the old game to a modern base.** The Void existed as an old Java program (and rough
   Python/web attempts). We rebuilt its rules from scratch in a modern, well-tested form. The old
   versions are kept in a `.legacy/` folder for reference.
2. **Built an "assembly line" for making the game safely** (the agentic loop — see §8).
3. **Ported the entire game's rules** through that assembly line — combat, enemies, items,
   encounters, five-act progression, the final boss — all covered by automated tests.
4. **Added save/load and a first on-screen version.**
5. **You set a new direction:** make it an *AI-narrated* game driven by a **local** language model.
6. **We interviewed and re-planned** the whole project around that vision.
7. **Proved a local AI model is fast enough** on a normal machine (the "spike" — see §7).
8. **Wired it all together into a playable game** you can run on the desktop today.

---

## 3. The big idea, in three parts

Think of the game as three separate layers, each with one job:

| Layer | Job | Plain analogy |
|---|---|---|
| **The rules engine** | Decides everything factual: dice rolls, damage, health, gold, what choices are legal, when you win or die. | The board, the dice, and the rulebook of a board game. |
| **The AI narrator** | Turns each factual moment into vivid story text, streamed word-by-word. | A dungeon master describing what the dice just did. |
| **The screen (UI)** | Shows the story and your choice buttons; sends your choices back. | The table everyone sits around. |

**Why keep them separate?** So the AI can never break the game. The engine is the single source of
truth; the AI decorates it with words. If the AI ever fails, the game still works (it just shows the
plain facts instead of pretty prose).

Two more foundational choices:
- **The AI runs locally.** The model is a ~2.5GB file that runs on your machine. No cloud bills, no
  keys, works offline. We chose **Qwen3-4B** — a small, capable, freely-redistributable model.
- **It ships as a desktop app.** Because local AI is heaviest on phones, we target desktop first
  (packaged so a player can eventually just double-click to play).

---

## 4. The pieces, one by one

### 4a. The rules engine — `src/game/`
This is the heart: **pure, framework-free rules code** that could run anywhere. It has no idea a
screen or an AI exists. Key parts:
- **Characters & stats** — the six D&D-style attributes (Strength, Dexterity, etc.) and the math that
  turns them into bonuses; health and armor.
- **Dice / randomness** — a "seeded" random-number generator: the same starting seed always produces
  the same run, so games are reproducible and testable.
- **Content as data** — weapons, armor, enemies' name-parts, lore, and story text live in plain data
  files, so adding content never means touching the combat code.
- **Enemies** — built on the fly, with procedurally-assembled names (e.g. "Aerobicized Psychogenic
  Raven") and stats that scale to your progress.
- **Combat** — attack rolls, advantage, critical hits, damage, potions, running away — written as
  pure functions that take the current situation and return the new situation plus a list of
  **events** (little facts like "player hit for 4 damage").
- **Status effects & skills** — poison, stun, and the like, plus special abilities.
- **Encounters & progression** — battles, rest stops (with lore + healing), the stranger's shop, the
  five-act structure gated by experience, level-ups, and the final boss.
- **The controller (`game.ts`)** — the top-level "brain": you hand it the current game and a player
  choice, and it hands back the next game, the events that happened, and what input it needs next.
  A whole run can be played through this one function.

Everything here is covered by **319 automated tests**, and by rule contains **no randomness other
than the seed** and **no screen/AI code** — which is what makes it trustworthy and testable.

### 4b. The AI narrator — `electron/llm.mjs` + `src/llm/narrate.ts`
Two small parts:
- **`src/llm/narrate.ts`** (pure, tested) — takes the engine's events (e.g. "a Rat appeared", "you
  landed a critical hit") and writes a short instruction for the AI: *"Here's what just happened;
  narrate it in 2–4 vivid sentences."* It never lets the AI see or invent numbers.
- **`electron/llm.mjs`** — the only place the AI model actually runs. It loads the Qwen3-4B model
  file and streams the story text back token-by-token (a token ≈ a word-piece).

We verified the model reads its facts and writes genuinely atmospheric, on-theme prose — e.g. an
unprompted *"the lock is a single brass ring, twisted like a wound… it doesn't warm. It remembers."*

### 4c. The desktop app — `electron/`
The game is packaged with **Electron** — a way to ship a web-style app as a normal desktop program.
It has two halves that talk over a secure bridge:
- **The main process** (`electron/main.mjs`) — the privileged part that runs the AI model (the model
  library *must* live here; running it in the visible window would crash it).
- **The window** — shows the game. It asks the main process to generate narration and receives the
  streamed words.
- **The bridge** (`electron/preload.cjs`) — a small, locked-down channel so the window can request
  narration without having dangerous system access.

There's also a **headless self-test** (`npm run desktop:smoke`) that loads the model inside the app,
generates one passage, prints the speed, and quits — so we can confirm the AI works inside the app
**without a human watching a window**. It passed at ~90 words-per-second on the dev GPU.

### 4d. The game screen — `src/desktop/game.ts` + `desktop.html`
The actual playable interface:
- A **descent log** in the middle where narration streams in, one beat per turn.
- **Choice buttons** at the bottom, built from whatever the engine says is legal right now (Fight /
  Potion / Run in battle; Buy / Refuse at the shop; two stat picks on level-up; etc.).
- A **character sheet** on the left (your name, health, experience, gold, act; the enemy's health
  during a fight).
- It runs the loop: show choices → you pick → engine updates → AI narrates the result → repeat.

### 4e. Save / load — `src/game/save.ts` + `src/storage/`
Because the whole game is stored as plain data, saving is straightforward: it safely writes the run
to disk, refuses to load a corrupted or outdated save (instead of crashing), and can upgrade old
saves to future versions. (Wired into the earlier on-screen version; folds into the AI game next.)

### 4f. The Kaplay version — `index.html`, `src/render/`, `src/scenes/`
An earlier, non-AI on-screen version built with **Kaplay** (a lightweight 2D game library). It still
exists as a separate artifact. Under the new direction its role shrinks to an optional
**atmosphere/effects layer** behind the text; the AI game uses the plain-text screen (4d) instead.

---

## 5. How one turn actually flows

```
You click a choice (e.g. "Fight")
        │
        ▼
The rules engine resolves it  →  new game state + a list of events + the next legal choices
        │                                   │
        │                                   ▼
        │                        The narrator turns those events into an instruction for the AI
        │                                   │
        │                                   ▼
        │                        The local AI streams story text into the descent log
        ▼
The screen shows the new choices, and the character sheet updates
        │
        ▼
        (repeat)
```

The engine decides *what happened*; the AI decides *how it's told*; the screen shows both and takes
your next choice.

---

## 6. How to run it

From the project folder, in a terminal:

```bash
npm install            # one-time: fetches the app + AI libraries
npm run spike:pull     # one-time: downloads the AI model file (~2.5GB)
npm run desktop        # launches the game window
```

In the window: wait for **"the Void is listening"**, click **Descend into the Void**, and play. (A
quick, no-window self-check is `npm run desktop:smoke`.)

---

## 7. The "spike" — proving it was possible before building on it
Before committing to the AI approach, we ran a **spike**: a small throwaway test of the riskiest
assumption — *"can a small AI model run fast enough on a normal machine, and reliably return
structured data?"* It downloaded the model, measured speed with and without a graphics card, and
confirmed the model can be forced to return perfectly-structured output (essential for reliable
choice lists). Verdict: **yes** — comfortably fast on a GPU, usable without one. Full numbers live in
`docs/N1-SPIKE.md`.

---

## 8. How we build it safely — the "agentic loop"
The project uses a disciplined **build assembly line** so changes are always planned, implemented,
and independently checked before you ever see them:
- A **planner** writes a plan for a task.
- A **builder** implements it and writes tests.
- A **checker** (which is never allowed to write code) independently verifies it and gives a
  pass/fail.
- **You** review and merge — the one gate no automated step can pass.

Each unit is built in an isolated copy of the project (a "worktree") so the main copy is never at
risk. Every run is logged so the system can be improved over time. (The AI-model spike was done
outside this line on purpose — measuring real hardware is something only a person can judge.)

---

## 9. What's done vs. what's left (it's fine-tuning now)

**Done — a full run is playable, AI-narrated:**
- The complete rules engine (tested end-to-end).
- The local AI narrator, running inside the desktop app, streaming story per beat.
- The game screen with engine-driven choices and a live character sheet.
- Proof the model is fast enough; save/load foundation; safe build process.

**Left — refinement (the roadmap's later milestones, in `docs/ROADMAP.md`):**
- **Let the AI write the choices**, not just the narration (with a guarantee they're always valid).
- **Per-floor story files** — each of the five floors gets its own tone, themes, and events (these
  are the parts you and I co-write, since those words are the author's to write).
- **Distinct enemies and bosses** with their own personalities.
- **Balance** — right now the game is intentionally *unwinnable* until we tune the numbers (the enemy
  strength was inherited from the unfinished original); this is a dedicated tuning pass.
- **Packaging** — a double-click installer with the model bundled in.
- **Writing the real story text** — much of the original's lore is placeholder.

---

## 10. Where things live (quick map)

| Path | What it is |
|---|---|
| `src/game/` | The rules engine (pure, tested). |
| `src/llm/` | Turns game events into AI narration instructions (pure, tested). |
| `electron/` | The desktop app: window, the AI model runner, the secure bridge. |
| `src/desktop/` | The on-screen AI game (descent log, choices, character sheet). |
| `src/render/`, `src/scenes/`, `index.html` | The earlier Kaplay version / future atmosphere layer. |
| `src/data/` | Game content as data (weapons, armor, enemies, lore, story). |
| `docs/ROADMAP.md` | The full plan and design decisions. |
| `docs/N1-SPIKE.md` | The AI-speed test and its results. |
| `PROGRESS.md` | The live build tracker + session history. |
| `HUMAN-CHECKS.md` | Things only you can verify (how it looks/feels). |
| `.legacy/` | The original Java/Python/web versions, for reference. |
| `.claude/` | The build assembly line (planner/builder/checker + skills). |

---

*Everything above currently lives on the `spike/n1-local-llm` branch (a separate line of work), not
yet merged into the main copy — merging is your decision.*
