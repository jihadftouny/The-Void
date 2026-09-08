# Third-party notices — The Void

**The Void itself is proprietary — all rights reserved** (see `LICENSE`). This file records
everything the game **redistributes** that somebody else wrote, and the licence each of those
things is redistributed under. `docs/SHIPPING.md` is the decision record; this file is the
artefact that ships beside the build, and shipping it is a **condition of the licences below**,
not a courtesy.

> **⚠ INCOMPLETE — this file is opened by `PLAN.md` #16 and COMPLETED by `PLAN.md` #14.**
> Only the bundled typeface is discharged here, because it is the only third-party component
> whose bytes this unit vendored into the repository. The model, the runtime and the engine
> dependencies below are listed with their licences named but their licence TEXT not yet
> copied in, and generated art and music are still unverified. **`PLAN.md` #14 must finish
> this file before any public release**; `docs/FINDINGS.md` S2 and `docs/SHIPPING.md` both
> call licensing a release blocker.

---

## Discharged

### JetBrains Mono — SIL Open Font License, Version 1.1

Copyright 2020 The JetBrains Mono Project Authors
(<https://github.com/JetBrains/JetBrainsMono>).

**The full licence text ships in the repository and in the packaged build at
`src/assets/fonts/jetbrains-mono/OFL.txt`.** Read it there; it is the licence, and this
section is only a pointer to it.

**What is redistributed:** four WOFF2 files, the Latin subset only —

| File | Weight | Style |
|---|---|---|
| `src/assets/fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2` | 400 | normal |
| `src/assets/fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2` | 500 | normal |
| `src/assets/fonts/jetbrains-mono/jetbrains-mono-latin-700-normal.woff2` | 700 | normal |
| `src/assets/fonts/jetbrains-mono/jetbrains-mono-latin-400-italic.woff2` | 400 | italic |

They were obtained from the `@fontsource/jetbrains-mono` npm package (v5.3.0) and **vendored**
rather than depended on, so the exact bytes that ship are the exact bytes in this repository.

**Why this is legal to bundle in a game that may be sold.** The OFL permits the fonts to be
"bundled, embedded, redistributed and/or sold with any software", provided (a) the fonts are
not sold *by themselves*, (b) this copyright notice and licence travel with them, and (c) no
derivative uses a Reserved Font Name. The Void satisfies all three: the fonts are a component
of the game, `OFL.txt` ships with the build, and the faces are unmodified.

**This claim was verified by reading `OFL.txt`, not by trusting a table.** Until 2026-09-07,
`docs/ART-BIBLE.md` §11 said the licence was "verified free to bundle (`SHIPPING.md`)" and
`docs/SHIPPING.md` said only "SIL Open Font Licence" — a citation loop with no licence text
anywhere in the tree. `src/render/tokens.test.ts` now asserts that `OFL.txt`, the four faces
and this file all still exist and still say this, so the evidence cannot be dropped silently.

---

## Named, not yet discharged — `PLAN.md` #14 owns these

| Component | Licence | What #14 must still do |
|---|---|---|
| **Qwen3** (the narration model) | Apache-2.0 | Ship `LICENSE` **and** a `NOTICE` file. ⚠ The model is downloaded on first run rather than bundled; the notice obligation still applies to the shipped installer. |
| Electron | MIT | Copy in the MIT text and Electron's own bundled-dependency notices. |
| node-llama-cpp / llama.cpp | MIT | Copy in the MIT text. |
| Kaplay | MIT | Copy in the MIT text. **Nothing imports Kaplay yet** (`PLAN.md` #7); if it is still unimported at release, remove the dependency instead of licensing it. |
| **Generated art and music** | ⚠ **UNVERIFIED** | `docs/FINDINGS.md` S3: terms for commercial redistribution of Gemini image output and Lyria audio output are recorded nowhere, and image and audio terms can differ. **Check before release.** |

Also outstanding, from `docs/SHIPPING.md`: `package.json` still has no `license`, `author`,
`description` or `repository`, and its version is `0.0.0`.
