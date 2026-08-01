# Human Checks — The Void

This is your running checklist. Anything the automated pipeline **cannot** verify itself lands here:
things you have to see, feel, or try on a real device. Each pipeline milestone appends its
NEEDS-HUMAN items below (most-likely-to-be-wrong first), with the exact steps and what "wrong" looks
like. Tick items as you verify them; leave a note if something's off and I'll route it back through
the loop.

How to run the app for a check:
1. Terminal in the repo root → `npm install` (first time only) → `npm run dev`.
2. Open the printed local URL. For mobile checks, open it on your phone (same network) or use the
   browser devtools device toolbar (portrait phone preset).

---

## Pending checks

### M0 — Scaffold + loop system
- [ ] **App boots to the title screen.** Run `npm run dev`, open the URL. Expected: a near-black
      canvas showing **THE VOID**, subtitle "A Text RPG by Jihanger", and "vAlpha — press anywhere
      to begin". Wrong: blank white page, a console error, or the canvas not filling the window.
- [ ] **Letterboxing looks right in portrait.** Resize the window tall-and-narrow (or use a phone
      preset). Expected: the game area stays centered and scales, with black bars rather than
      stretching/distorting the text. Wrong: text squashed, or content cut off.

---

## Verified
_(move items here once you've confirmed them)_
