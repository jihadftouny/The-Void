# The Void

A mechanics-first roguelike role-playing game with a language model that narrates it, running
entirely on your own machine.

You create a character and descend through five floors of the Void — fighting, resting, trading with
a stranger, growing stronger, until a final boss and an ending. The rules are a deterministic engine:
dice, attributes, status conditions, skills, loot rarity, experience across five Acts. A small
language model narrates over the top and adapts to what you do, but it never invents a number and
never changes the state of the game. Everything that happens, happens because the engine said so.

The descent is psychosis rendered as a dungeon. It starts literal and becomes a journey into a
fracturing mind, and what you *do* — everything you do — is read by the Void and decides how it ends.

> **Content note.** This game deals with psychosis, grief, dread and self-harm, and floor three is
> populated by them directly. It is written as a survivor's story rather than a bleak one: the mercy
> in it is real and the good ending is genuinely good. If now is not the right time for you to play
> something like this, that is a reasonable thing to decide.
>
> *(Placeholder — the final wording belongs to the author, per `docs/CONTENT-WARNING.md`.)*

## Status

**In development.** The engine, combat, items, skills, karma, saves and the narration pipeline are
built and tested; the visual layer and several content systems are not. The shipping scope for
version 1 is in `docs/SHIP-SCOPE.md`, the work order in `docs/PLAN.md`, and every known defect in
`docs/FINDINGS.md`. It will be released on itch.io.

## How it is built

| Layer | What it is |
|---|---|
| `src/game` | The rules. Plain TypeScript, no rendering, no randomness that is not seeded. Runs headless in Node. |
| `src/llm` | The narrator. Pure and testable against a fake model; the real model sits behind a runtime interface. |
| `src/render`, `src/desktop` | Draws state and forwards input. Never mutates state directly. |
| `electron/` | The desktop shell, the model loader, logging and the process boundary. |

Three rules hold the whole thing together, and everything else follows from them:

1. **The engine owns every rule and number.** The model narrates and selects which mechanics fire.
   It never writes state. Every output that feeds the game is grammar- or JSON-constrained.
2. **A run is reproducible from its seed and its inputs alone.** Every random decision goes through a
   seeded generator. There is no `Math.random()` and no `Date.now()` anywhere in the logic core, so
   tests assert exact outcomes rather than ranges.
3. **State is plain data.** No class instances, no functions, nothing that cannot round-trip through
   JSON — which is why saving works and why the state is inspectable.

Stack: TypeScript 5 (strict), Vite 6, Vitest 2, Electron, and `node-llama-cpp` for local inference.
Kaplay is a dependency reserved for an atmosphere layer that has not been built yet — nothing
imports it today.

## Running it

```bash
npm install
npm run desktop      # runs the game
```

`npm run dev` serves the page only and cannot run outside Electron, because the renderer talks to the
Electron process at module scope.

```bash
npm test             # 1646 tests, headless, no real inference
npm run typecheck
npm run build
```

Tests never call a real model. The language-model layer is exercised against a fake, which is what
keeps the suite fast and deterministic.

### What you need

- **Node.js 18 or newer** to build it.
- **A GPU.** This is a hard requirement, not a recommendation. The game ships a 4-billion-parameter
  model as its only tier. On a machine without a GPU it measures around 7.6 tokens per second and
  about 5 seconds to the first word, against the ~89 tokens per second the narration pacing was
  designed around. It is not enjoyable at that speed.
- **About 2.5 GB of disk and one download.** The model is fetched once, on first run, by design: it
  keeps the installer small and lets the model be upgraded without shipping a new build. After that
  the game is fully offline, forever. No account, no API key, no per-turn cost, and nothing you type
  or do ever leaves your machine.

## Documentation

The design documents are in `docs/`, and `docs/README.md` indexes them and states which one wins when
two disagree. `docs/WORLD.md` is authoritative on the fiction, `docs/GAME-DESIGN.md` on the systems,
`docs/SHIP-SCOPE.md` on what ships first. `PROGRESS.md` tracks the build.

## Licence

All rights reserved. The source is published to be read and evaluated, not reused — see
[`LICENSE`](LICENSE). If you want to do something with it that the licence does not allow, ask.
