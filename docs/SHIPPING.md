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
