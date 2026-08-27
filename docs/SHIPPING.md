# The Void — Shipping & Legal

**[DECIDED 2026-08-26]** — the release policy. Companion to `docs/CONTENT-WARNING.md`.

---

## Licence

**The game is proprietary — all rights reserved.** Its code, design documents, prose and art stay
the author's, keeping the option to sell it later open.

**A `THIRD-PARTY` (or `NOTICE`) file is required regardless of price**, shipping the licences of
everything redistributed:

| Component | Licence |
|---|---|
| **Qwen3** (the model) | Apache-2.0 — **redistribution requires shipping the licence and a NOTICE** |
| Electron | MIT |
| node-llama-cpp / llama.cpp | MIT |
| Kaplay | MIT |
| **JetBrains Mono** | SIL Open Font Licence |
| **Generated art + music** | ⚠ **UNVERIFIED — see `FINDINGS.md` S3.** Terms for commercial redistribution of Gemini image output and Lyria audio output are recorded nowhere, and art and music terms can differ. **Check before release.** |

**Also required:** fill in `package.json` — `license`, `author`, `description`, `repository`, and a
real version (it is `0.0.0`).

## Release

**Free, through the itch app, with an optional donation.**

- **Updates are the itch launcher's job.** No `electron-updater`, no `publish` block, no signing
  infrastructure to build. Needs **butler** for uploads and a version number that is not `0.0.0`.
- **Free removes pricing, refunds and payment entirely** — and for a first personal release, reach
  matters more than revenue.
- **The store page must state** (from earlier decisions): the **one-time ~2.5 GB model download** on
  first run, that a **GPU is required**, that it is **English-only**, that there is **one difficulty
  and no assist options**, and it must carry the **content warning**.

## Telemetry and privacy

**No telemetry, no analytics, no crash reporting, no network calls** other than the one-time model
download. This is a decision, not an omission — write it on the store page and in the README, because
it is the answer to the privacy question.

**One local caveat to fix:** the app writes an unrotated, uncapped log containing the player's chosen
name and every game event, **inside the install directory** — which is commonly read-only when
packaged, so logging silently dies in the shipped build (`FINDINGS.md` G6). Move it to the user-data
directory, cap it, and rotate it.

## Age rating

itch requires self-declaration. Follows directly from `docs/CONTENT-WARNING.md` — declare the mental
health themes honestly rather than minimally.

---

## The store page **[DECIDED 2026-08-27]**

**Honest and plain. Lead with what it is.**

1. **What the game is** — a mechanics-first roguelike with a local-LLM narrator.
2. **Who made it and why** — the lived-experience origin, stated plainly.
3. **The content warning, near the top** — not in a footer (`docs/CONTENT-WARNING.md`).
4. **The requirements, unburied:** a **GPU is required** · a **one-time ~2.5 GB download** on first
   run · **English only** · **one difficulty, no assist options**.

> **Why not lead with the hook and bury the requirements** where store pages normally put them: **the
> game is about being told the truth too late.** A page that oversells it, or hides a GPU requirement
> and a 2.5 GB download until after the click, would be a strange way to introduce that — and it is
> how you earn refunds and bad reviews for a game that is otherwise honest.

## First run **[DECIDED 2026-08-27]**

**Warning → download → play.** Nothing else.

1. **The content warning, before the download.** Somebody who reads it and decides the game is not
   for them must not have spent 2.5 GB and an evening first.
2. **The model download**, with honest progress and **a real failure path** — not a spinner that
   stops.
3. **The title screen.**

**No setup wizard.** Settings exist and are reachable from the title and the hub (`UI-DESIGN.md`
§12); putting a form between someone and a game they just waited to download is the wrong trade.
Reduced motion still picks itself up from the OS signal, so the player who most needs a setting gets
it without ever finding one.

## The playtest — what to ask for **[DECIDED 2026-08-27]**

Five to ten trusted people, before any public release. **Three questions, in priority order:**

1. **Does it run on a machine that is not yours?** Nothing ever has.
2. **Is it comprehensible without you in the room?**
3. **Does the subject matter land the way you intend?** — the one you cannot judge yourself, and the
   reason this is a trusted group rather than a public build.

**Give them the seed feature** (`GAME-DESIGN.md` §19.3) so anything they hit comes back reproducible.
**Balance feedback is a bonus, not the point** — the simulation can already measure balance, and it
cannot measure any of the three above.
