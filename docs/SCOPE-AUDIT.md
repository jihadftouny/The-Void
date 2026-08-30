# The Void — Scope Audit (2026-08-25)

_An exhaustive, evidence-based inventory of everything undefined, deferred, placeholder,
contradictory or missing across the whole project. Produced before committing to the UI restyle and
the art batches, specifically to avoid building things that would have to be torn down._

> ## ✅ TIER 1 IS RESOLVED (2026-08-25) — decisions live in `docs/GAME-DESIGN.md`
>
> All seven Tier-1 items below were decided in the scope interview. **Read the design doc, not this
> section, for what was chosen.** Summary of the rulings:
>
> 1. **Floor mechanics** — hybrid: simple modifiers reuse the existing relic effect/trigger
>    pipeline; encounter-restructuring mechanics (floor 2 illusions, floor 5 kit warp) get bespoke
>    code. Floor 2 illusions are literal with a WIS reveal; floor 3 is attrition only; floor 4
>    temptation is floor-gated; floor 5 warps your own skills.
> 2. **Grammar-constrained choices** — **DROPPED. The engine writes the choices; the model narrates
>    only.** M11 shrinks accordingly: no tool registry, no free-text mapping.
> 3. **Equip as a `step` input** — yes, plus a mandatory balance re-run, because the current 32.9%
>    measures a character that never equips found loot.
> 4. **The floor-4 gate** — floor-4 karma counts double; no new state.
> 5. **Description/flavour fields** — added to every content schema now; currently blocking all
>    authoring.
> 6. **The socket** — no visible hardware in any art; the Hollow is rendered as wrongness of
>    occupancy instead. Already applied to `ART-BIBLE.md`.
> 7. **Model bundling** — download once on first run, by design. Store copy must say so.
>
> Tiers 2 and 3 below are still live.

> **⚠ This is a FROZEN EVIDENCE SNAPSHOT (2026-08-25).** The live list of what is still open is
> **`docs/FINDINGS.md`** — go there first. This file is kept for its file-and-line evidence.
>
> **⚠ READ THIS BEFORE FOLLOWING ANY LINE NUMBER BELOW (added 2026-08-28).**
> - **Every `docs/*.md:NNN` reference in this file is pinned to 2026-08-25 and NO LONGER RESOLVES.**
>   The documents have grown substantially since. **Cite by `§` instead** — ten were spot-checked and
>   none landed on its quoted text.
> - **`src/` references remain valid in principle** — `git diff` since this snapshot shows exactly
>   **one changed line, in `package.json`** — but **nine were transcribed 1–3 lines off** when the
>   file was written, several landing on a blank line or a closing brace. They are corrected in place
>   below where they appear.
> - **Being frozen excuses stale "X is still open" claims. It does NOT excuse errors in the
>   file-and-line evidence**, which this banner names as the file's sole remaining purpose. The
>   corrections below were wrong on the day they were written, not drift.

**How to use this file:** it is a snapshot, not a living document. Work items out of it into
`docs/GAME-DESIGN.md`, `docs/WORLD.md`, `docs/ART-BIBLE.md` or `docs/ROADMAP.md` as they are
decided, and strike them here. **Do not treat an item as resolved because it was discussed — only
because it is written into an authoritative document.** Precedence rules: `docs/README.md`.

**Headline:** the project's *systems* are far more complete than its *content* or its *narrative
wiring*. Most mechanical milestones marked done are genuinely built. But large amounts of content
have no acquisition path in code and are unreachable in play; every prose surface a player reads is
empty or joke text; several documents locked on the same day contradict each other; and the LLM
layer — the thing `CLAUDE.md` names the game after — is a 190-line prompt-string builder.

---

I have enough evidence. Here is the complete hole inventory.

---

# THE VOID — INVENTORY OF EVERYTHING UNDEFINED, DEFERRED, PLACEHOLDER, CONTRADICTORY OR MISSING

Audited: all of `docs/`, root `*.md`, `.claude/`, `src/`, `electron/`, `scripts/`, packaging config, and git state at `c89304c`. `.legacy/` and `node_modules/` excluded as dead weight.

**The headline finding, before the list:** the project's *systems* are far more complete than its *content* and its *narrative wiring*. Almost every mechanical milestone that is marked ✅ is genuinely built. But (a) large amounts of authored content have no acquisition path in code and are unreachable, (b) every prose surface the player will read is empty or joke text, (c) four documents locked on the same day contradict each other, and (d) the LLM layer — the thing the game is *named for* in `CLAUDE.md` — is 190 lines of prompt string builder.

---

## AREA 1 — DESIGN / LORE
*Ranked by retrofit cost, most expensive first.*

### 1.1 The floor-4 gate ignores floor-4 choices — the pillar's payoff is half-built ⛔ BLOCKS
`docs/GAME-DESIGN.md:273-275` (**[DECIDED]**):
> "The floor-4 outcome (grace vs. cast-down into floor 5, §8) is therefore a function of **(karma carried in) × (floor-4 choices)**, never floor-4 choices alone."

`docs/ROADMAP.md:158-159` repeats it as M10's done-when. But the code:
```
src/game/boss.ts:138  export function computeVerdict(karma: KarmaState): 'grace' | 'cast-down' {
src/game/boss.ts:141    for (const axis of SIN_AXIS_PRIORITY) sum += GATE_WEIGHTS[axis] * karma[axis];
src/game/boss.ts:143    return sum >= GATE_THRESHOLD ? 'grace' : 'cast-down';
```
It takes **only** the carried vector. There is no floor-4 choice set, no floor-4 encounter type, no multiplier term. The signature of `computeVerdict` has no slot for one.

**Retrofit cost: HIGH.** Adding floor-4 choices later means new encounter phases, new `GameInput` variants, new save-state fields, a changed verdict signature, and a full re-run of the M15 balance sim (which currently reports grace/damnation splits from this exact function). Every one of those is cheap now and a version-migration later.

### 1.2 One of the four karma axes can never move ⛔ BLOCKS
`src/game/karma.ts:36-59` defines 8 `KarmaAction`s. Only **four** are ever fired:

| Action | Fired at | Axis |
|---|---|---|
| `spareWeighted` | `src/game/game.ts:635` | mercy |
| `killWeighted` | `src/game/game.ts:641` | mercy |
| `lootGreedily` | `src/game/deal.ts:89` (greed deal cost) | restraint |
| `desecrateShrine` | `src/game/deal.ts:88` (desecrate deal cost) | reverence |
| `leaveOffering` | **nowhere** | restraint+reverence |
| `honorDead` | **nowhere** | reverence |
| `embraceWhisper` | **nowhere** | clarity |
| `seeThroughIllusion` | **nowhere** | clarity |

`clarityDelusion` is moved by **only** the two dead actions. It is permanently `0` in every real run, yet it is weighted in the gate (`boss.ts:126`) and is a tie-break axis for the floor-3 Sin (`boss.ts:98-102`). The design calls it a *pillar axis* with a class resonance (`GAME-DESIGN.md:255-257`, Neuromancer / floor 2).

**Retrofit cost: HIGH.** Its two triggers are floor-2 illusions and WIS checks — which do not exist (see 3.1). So closing this requires the floor-2 mechanic, not a data edit.

### 1.3 Karma has no mid-run effect at all — only the gate
`src/game/karma.ts:13-18`:
> "SCOPE (M1): this module RECORDS karma only… it applies **NO** world/tone/gate/ending effect and clamps nothing. Karma changing an engine outcome is deferred (M10/M14)."

`docs/GAME-DESIGN.md:235-239` **[DECIDED]** specifies "world & tone mid-run… reshapes *what you encounter* (enemies, events, what the Void offers, NPC/narrator stance, prices)… light mechanical touches (small blessings/curses)". The **only** implemented read is `deal.ts:100-101` picking a deal pool. Nothing else. Karma is also never fed to the narrator prompt (`src/llm/narrate.ts:167-190` builds context from act/place/memory only) — so "ambiguous hints only" (`GAME-DESIGN.md:240`), the player's *only* compass, does not exist.

**Retrofit cost: MEDIUM-HIGH.** Touching encounter selection and narration by karma is a change to the seeded draw order in `encounter.ts` — which breaks every determinism test and every balance number. Cheaper to design the seam now.

### 1.4 Karma is never clamped
`src/game/karma.ts:75` — "The result is unbounded (clamping deferred to M14)." A long run can drive an axis arbitrarily far; `GATE_THRESHOLD = 1` (`boss.ts:130`) then becomes trivially satisfiable, and `SIN_HP_PER_POINT` (`boss.ts:80`) scales the floor-3 boss's HP linearly off an unbounded number. **Cost: LOW to fix now, MEDIUM later** (it invalidates balance numbers).

### 1.5 Cross-run karma memory is written and never read
`src/game/unlockStore.ts:409` appends a `RunMemory` per run; `unlockStore.ts:33-45` defines it. **No consumer anywhere** — not the narrator, not the UI. Design (`GAME-DESIGN.md:264-267`) wants it to let "the narrator faintly reference who you were before." Also unbounded — it grows one entry per run forever with no cap. **Cost: LOW.**

### 1.6 Named-but-undefined design objects
- **The Rift's appearance.** `docs/ART-BIBLE.md:299-300`: *"**Still undescribed anywhere:** **the Rift**, the doorway from Floor 1 down to Floor 2. It has no description in any source. Needs the author."* Partially closed by `WORLD.md §3` (a real pit) but with no visual description. Blocks a floor-1→2 transition asset.
- **The seven Sins as individuals.** `src/data/enemyNames.json` `byFamily.sevenSins` gives only the seven names (Pride, Envy, Wrath, Sloth, Greed, Gluttony, Lust) with weight 1 each and **empty `first`/`middle` tables**. They are one family (`enemyFamilies.json`, `sevenSins`), one stat theme, one skill pool. `docs/GAME-DESIGN.md:352` calls them "a family of 7 named elites"; `ART-BIBLE.md:369` budgets **7 separate sprites** because "sharing one sprite would be very visible". The engine has no per-sin differentiation to hang those sprites on.
- **The Ash-Wretch does not exist in the engine.** `ART-BIBLE.md:356-359`: *"⚠ **This is a game-data change, not just an art decision.** A new family must be added to `src/data/enemyFamilies.json` with its own tag, element, stat bias, skills, name table entry and floor assignment."* `enemyFamilies.json` still has exactly 24 families, no `ashWretches`.
- **The Kingpins as people** — `WORLD.md:594-595` lists it open, and `WORLD.md:599-600` lists the *same item* as `~~closed~~`. Internal contradiction inside the newest authoritative doc.

### 1.7 Genuinely still-open design questions, quoted
| Item | Evidence |
|---|---|
| Turn/initiative model | `docs/GAME-DESIGN.md:154` — "Turn/initiative model beyond the current enemy→player round order. **[OPEN]**". Code has a wired no-op: `src/game/statEffects.ts:181` `initiativeOrderTwist` returns `0` — "no-op until M4" (M4 is ✅ merged and never filled it). Quick/Slow conditions therefore have half their designed effect. |
| Backpack capacity/weight | `docs/GAME-DESIGN.md:220-221` **[OPEN]**; `src/game/inventory.ts:14` — "Backpack capacity / weight and two-handed vs shield rules remain deferred (M6/M7/M15)." |
| Two-handed / dual-wield | `docs/GAME-DESIGN.md:222` **[OPEN]** |
| Ascension ladder | `docs/GAME-DESIGN.md:51-52` **[OPEN]**, `ROADMAP.md:198` "optional ascension ladder deferred" |
| Whether every class portrait shows a socket | `docs/WORLD.md:558-559` **[OPEN]** — *and see contradiction 9.1, it is simultaneously closed the other way* |
| Interface furniture: generate art or not | `docs/ART-BIBLE.md:321-326` — "**⚠ OPEN — a direction conflict the author must settle.**" |
| Audio, entirely | `docs/UI-DESIGN.md:353` — "**Audio.** Never discussed. Flagged as **[OPEN]**" |
| Alpha strategy confirmation | `docs/UI-DESIGN.md:330-332` **[OPEN]** (settled in `ART-BIBLE.md:471-476`, but UI-DESIGN still lists it open) |
| Approve a reference enemy image | `docs/UI-DESIGN.md:328-329`, `ART-BIBLE.md:439` **[PENDING]** — blocks the whole 53-asset batch |
| Item-icon granularity | `docs/UI-DESIGN.md:228` — "an icon per slot-and-rarity rather than per individual item. That is a **[OPEN]** question" |
| Ash City architecture era | `docs/ART-BIBLE.md:430-432` — "**One item for the author:** the architecture skews strongly medieval-gothic… if the Ash City should still read as a *2100* city gone quiet, the prompt needs modern blocks" |

---

## AREA 2 — CONTENT TO AUTHOR
*This is the single biggest body of unwritten work in the repo, and the largest share of it is on the **live path**.*

### 2.1 Joke placeholder gear IS the shipped starting equipment of all five classes ⛔ BLOCKS
`src/data/weapons.json` — **12 entries**, every one placeholder:
```
weapons.json:3   { "name": "Jooj Gun 1", "cost": 5, ... }
weapons.json:4   { "name": "Jaaj Sword 1", ... }
weapons.json:5   { "name": "Jiij Rapier 1", ... }
```
…repeated verbatim for act2/act3/act4 with only the trailing digit changed. All twelve cost `5`. All twelve use the same three damage dice (1d4/1d6/1d8) regardless of act — **there is no act-scaling in the weapon table at all.**

`src/data/armor.json` — **12 entries**, identical pattern (`Jooj/Jaaj/Jiij Armor 1..4`), all `cost: 5`, all `dexCap: 2`, `baseArmor` 11/12/12 for every act.

**These are live.** `src/game/classKit.ts` hands them to every class at creation:
```
classKit.ts:99    weaponId: 'Jiij Rapier 1', // Act-1 Legendary Finesse (provisional)
classKit.ts:100   armorId: 'Jooj Armor 1',   // Act-1 Common (provisional)
classKit.ts:110   weaponId: 'Jaaj Sword 1',  // provisional
classKit.ts:111   armorId: 'Jaaj Armor 1',   // provisional
classKit.ts:121   weaponId: 'Jooj Gun 1',    // provisional
classKit.ts:122   armorId: 'Jooj Armor 1',   // provisional
```
Imported by `src/game/weapon.ts:12` and `src/game/armor.ts:11`; consumed by `defense.ts` for real AC math. The first thing every player sees on the character sheet is "Jiij Rapier 1".

**Retrofit cost: LOW mechanically, but it distorts balance.** The M15 tuning was proven against these dice (`BALANCE-REPORT.md:27`). Any real weapon table with act-scaling re-opens the balance pass.

### 2.2 Every dropped item is named `"Legendary mainHand"` ⛔ BLOCKS
This is worse than 2.1 because it is the *primary* loot the player earns:
```
src/game/rarityGen.ts:116    defId: `gen:${req.rarity}:${req.slot}`,
src/game/rarityGen.ts:118    name: `${req.rarity} ${req.slot}`,
```
Every victory drop, every chest item, and every deal `itemRoll` produces one of **27 possible strings** — the cartesian product of 3 rarities × **9** slots *(corrected 2026-08-28: `EquipSlot` declares nine — `helmet, amulet, mainHand, offHand, armor, legs, boots, ring, ammo` — and `dropTables.json` weights all nine. `GAME-DESIGN.md` §14.7 locked **seven**, but this section counts generated output, where nine is live; the migration in `PLAN.md` #1.10 therefore touches 27 names, not 21)* — reading literally `"Common armor"`, `"Rare ring"`, `"Legendary mainHand"`. `mainHand` and `offHand` are not even display-cased. Confirmed live: `loot.ts:50` → `rollLootDrop`/`rollChestLoot` → `generateItem`; `deal.ts:112` → `generateItem`.

**Retrofit cost: LOW-MEDIUM.** A name generator needs prefix/suffix/base tables per slot and rarity — new data files plus (probably) seeded draws, which shifts the RNG draw order and therefore breaks determinism tests. Cheaper to define the draw order now.

### 2.3 The lore file is the literal string "this is a lore" ⛔ BLOCKS
`src/data/lore.json` — **12 entries** (4 acts × 3), every one:
```
lore.json:6   "title": "This is a Title 1 0",
lore.json:7   "text": "1 0 This is a lore this is a lore this is a lore \nthis is a lore..."
```
Live: `src/game/lore.ts:13` imports it; `encounter.ts:98-104` `selectLore` picks one on **every rest encounter** (2 of every 6 encounters). Narrated verbatim: `narrate.ts:63` → `` `You rest, and a fragment surfaces: "${e.loreText}"` ``.

Two additional holes inside it:
- **3 of the 12 entries are unreachable.** Acts 2, 3 and 4 have `"selectableCount": 2` with 3 entries; `encounter.ts:101` clamps to `selectableCount`, so `entries[2]` never draws. This is the Java off-by-one, still flagged open at `HUMAN-CHECKS.md:250-251`.
- **Act 5 has no lore at all.** `lore.json` has keys `1,2,3,4` only. `lore.ts:31` returns `undefined`; `encounter.ts:100` returns `undefined`. **Resting in the True Void produces no fragment, ever.** ⚠ **Understated, corrected 2026-08-30 (`FINDINGS.md` G43): you can never rest in the True Void at all.** Act 5 goes straight from `act-intro` to the Hollow and **never returns to the hub**, which is the only phase that offers rest, chests, deals or random encounters. The missing act-5 lore is real, but it is downstream of a floor that has no encounter layer to read it in.

### 2.4 Ten empty prose bodies ship on the live path ⛔ BLOCKS
`src/data/story.json:15-28` — all five act intros and all five act outros:
```json
"actIntros": { "1": { "header": "ACT I", "body": "" }, ... "5": {..., "body": "" } },
"actOutros": { "1": { "header": "ACT I", "body": "" }, ... "5": {..., "body": "" } },
```
`src/game/story.ts:9-10` states the reason: *"Act intro/outro bodies are empty strings because the Java prints only a header plus blank lines (M8 fills the prose)."* M8 is ✅ merged; they were never filled.

They flow to the player: `game.ts:379-381` and `game.ts:484-487` emit `act-intro`/`act-outro` events carrying `body: ""`. `narrate.ts:87-89` maps them to `e.body`, and `eventsToFacts` (`narrate.ts:103`) filters empty strings — so **every floor transition narrates nothing at all.** The five floor transitions are the game's structural beats and they are silent.

### 2.5 The two endings are one sentence each
```
story.json:36   "body": "{playerName} is judged worthy and rises from the Void, made whole."
story.json:40   "body": "{playerName} is cast down, and the Void claims its own."
```
`src/game/story.ts:27` — "(placeholder prose; real text is M14)". The legacy `ending.body` is literally `"{playerName}"` (`story.json:31`). ROADMAP M14 wants a "blended spectrum" the narrator interpolates; two fixed sentences is the whole ending system.

### 2.6 There is no field anywhere for item, skill, condition or perk description text ⛔ BLOCKS
I grepped every data file for `description` / `flavor` / `desc` / `blurb`. Result: **zero hits in all 15 data files.** The schemas do not have the slot. *(Corrected 2026-08-28: this said "except `lore.json`" — there is no exception. `lore.json`'s entries carry only `title` and `text`. The stated exception implied one schema already had the slot, and `PLAN.md` #1.2 cites this very section as its evidence.)*

| Content | Count | Has description? | Evidence |
|---|---|---|---|
| Relics | 15 | ✗ | `src/data/relics.json` — keys are `id,name,kind,slot,rarity,floor,effects` |
| Uniques | 4 | ✗ | `src/data/uniques.json` |
| Consumables | 19 | ✗ | `src/data/consumables.json` — keys `id,name,kind,slot,rarity,effects,use` |
| Base items | 4 | ✗ | `src/data/items.json` |
| Shields | 2 | ✗ | `src/data/shields.json` |
| Weapons/armor | 12+12 | ✗ | as above |
| Skills | 73 defs | ✗ | `src/game/skill.ts:189` `SKILLS` — no description field on `SkillDef` |
| Conditions | 25 types | ✗ | `src/game/condition.ts:90` `CONDITION_DATA` carries `maxTurns`, `displayName`, `stacking` only |
| Perks | 3 | mechanical label only | `src/game/perks.ts:32-34` — `label: '+1 damage'` |
| Enemy families | 24 | ~~`behaviorNote` is `null` on all 24~~ — **WRONG (corrected 2026-08-28): `theme.behaviorNote` is populated on 24 of 24.** It is a one-line *mechanical* note, not player-facing flavour (e.g. `"swarm tactics; scaling with numbers"`). This row claimed a missing field that is fully present, and contradicted §2.6 of this same file, which quotes those strings | `src/data/enemyFamilies.json` |
| Classes | 5 | ✗ (a one-word `twist` string) | `src/game/classKit.ts:126` `twist: 'Corruption'` |

**Retrofit cost: MEDIUM.** Adding a `description` field is a data-schema change that touches `item.ts` validation, `save.ts` validators (`save.ts:438` validates inventory shape), the view-model, and every test that constructs an item literal. Adding it *now*, before three UI units render items, is dramatically cheaper than adding it after.

### 2.7 Boss names are explicitly placeholders
`src/game/boss.ts:52-57`:
> "The boss table. **Placeholder names** (real names/voice are M11/author)."
```ts
kingpin:    { name: 'Undercity Kingpin', ... },
reflection: { name: 'The Reflection', ... },
sin:        { name: 'The Indulged', ... },
hollow:     { name: 'Hollow Self', ... },
```
plus four Sin identities at `boss.ts:87-93` (`The Desecration`, `The Cruelty`, `The Avarice`, and a fourth for clarity). `boss.ts:21`: *"Boss dialogue/voice, floor/ending prose, and in-UI presentation are all deferred."* **There is no boss dialogue anywhere in the repo.** Five bosses, zero lines.

### 2.8 **Eleven** enemy families are named from the legacy Java joke tables

> *(Corrected 2026-08-28: the heading said "Nine" while the paragraph below it correctly said eleven,
> and the table listed nine — omitting **`securityDrones`** and **`mutantStrays`**, both floor 1. The
> eleven are: `gangers, securityDrones, mutantStrays, cyberEnforcers, fixers, reflections,
> mirrorSelves, distortions, staticWraiths, guardians, seraphWardens`.)*
`src/data/enemyNames.json` has bespoke `byFamily` tables for only 13 of 24 families. The other 11 fall through to the act's broad-tag table (`enemyName.ts:102-111`). Consequence:

| Family | Floor | Draws names like |
|---|---|---|
| `mirrorSelves` | 2 | "Mirrored **Punk Aspect**", "Warped **Thug Aspect**" (`enemyNames.json` act2/Humanoid) |
| `reflections`, `distortions`, `staticWraiths` | 2 | act2/Magical tag table |
| `gangers`, `cyberEnforcers`, `fixers` | 1 | act1/Humanoid — "Intoxicated Psycho", "Abstinent Conjurer" |
| `guardians`, `seraphWardens` | 4 | act4/Ancestral |

An angelic Seraph-Warden and a mirror of the player both draw from tables written for a Java prototype's street thugs.

### 2.9 The opening intro is the only substantive authored prose in the game

> *(Retitled 2026-08-28. The old heading — "The opening intro **contradicts** the world's own ending"
> — asserted the opposite of its own paragraph, which says the block is *good* and consistent on the
> Memorians and brainchips. Headings are what get skimmed. **A real contradiction does exist in that
> block, but it is a different one** — see the correction note below.)*
`src/data/story.json:5-12` is the only substantive authored prose in the game. It is *good* and consistent with `WORLD.md` on the Memorians and the brainchips. But note it is the **only** authored block: 8 lines, out of an entire five-floor narrative game.

> **⚠ CORRECTION 2026-08-28 — this block is NOT fully consistent with `WORLD.md`.** Line 10 sends you *"to delve into **the Rift**"*, but `WORLD.md` §4 `[LOCKED]` puts the errand in the **Undercity** and §13 makes the Rift a separate stratum below it. That breaks the betrayal scene, which turns on the Kingpin waiting at the Rift's entrance as *"the last place you could still have turned around"* — if entering the Rift **was** the order, the line means nothing. Tracked as `FINDINGS.md` **C3**. *(This audit is a frozen snapshot; the correction is noted rather than rewritten.)*

---

## AREA 3 — ENGINE / SYSTEMS

### 3.1 NOT ONE of the five floor-specific mechanics exists in code ⛔ BLOCKS — highest retrofit cost in the repo
`docs/GAME-DESIGN.md:287-293` specifies a "signature mechanic" per floor. I searched all of `src/game` for every keyword (`illusion`, `dampen`, `attrition`, `desecrat`, `corrupt`, `WIS check`, `floorMechanic`). Results:

| Floor | Designed mechanic | In code? |
|---|---|---|
| 1 Undercity | "The world is still solid" (no distortion) | ✔ trivially — nothing to build |
| 2 Entrance | "Illusory enemies (striking them wastes a turn); **WIS checks** to tell real from false; Mirror-Selves copy your kit" | ✗ **nothing**. `statEffects.ts:186-189` `illusionSightTwist` returns `0` — "*No illusion system exists yet*". `mirrorSelves` is an ordinary family row in `enemyFamilies.json` with no kit-copy logic (only the *boss* copies the kit, `boss.ts` reflection) |
| 3 Ash City | "Dampened healing, bleeding resources, an **endless** city until you find the way down — attrition" | ✗ **nothing**. No healing modifier, no per-turn drain, no endless-floor structure. `relics.json` has `empty-vessel` whose design blurb is *"ash stops draining you"* (`GAME-DESIGN.md:184`) — a relic that counters a mechanic that does not exist |
| 4 Angelic | "the floor tempts you with loot you can only take by desecrating" | ✗ partial only. The `tempting` deal pool exists (`deals.json`) but is selected by **karma**, not by floor: `deal.ts:100-103` reads only `karma`; `buildDeal(karma, _act, rng)` — `deal.ts:129` the act parameter is **named `_act` and explicitly unused**: *"`act` is currently unused by the placeholder tables"* (`deal.ts:126`). A greedy player is tempted on floor 1; a reverent one is never tempted on floor 4 |
| 5 True Void | "The Void corrupts your own kit — skills warp; carried karma directly empowers or punishes you" | ✗ **nothing**. No skill-warping. The only "corruption" in code is the Hollow *class* resource (`classKit.ts:35`) — a different concept sharing the word |

The only act-dependent behaviour that exists is: family roster (`encounter.ts:66`), enemy HP scaling (`enemy.ts:68`), drop tables (`dropTables.json`), boss id (`game.ts:509`), and the act-4 gate.

**Retrofit cost: THE HIGHEST IN THE PROJECT.** Floor mechanics touch the battle round loop, the encounter generator, healing, the skill resolver and the RNG draw order — i.e. *every* determinism test, *every* balance number, and the save format. Two of them (illusions/WIS, ash-drain) also have already-wired no-op seams waiting, which is the cheap half; the expensive half is the round-loop surgery. **Building content and UI on top of a battle loop that has no floor-modifier hook is the single most expensive mistake available here.**

### 3.2 Floor 4 has no boss encounter — 4 bosses, not 5 ⚠️
`src/game/game.ts:509`:
```ts
const BOSS_BY_ACT: Record<number, BossId> = { 1: 'kingpin', 2: 'reflection', 3: 'sin' };
```
Plus `hollow` fired on `act-intro(5)` (`game.ts:512-517`). `boss.ts:34-36`: *"The four COMBAT bosses (one per act 1/2/3/5). The act-4 Warden is a pure VERDICT gate, not a fight, so it carries no `BossId`."*

This is *defensible* — `GAME-DESIGN.md:314-317` says the Warden is "a **verdict, not always a fight**". But note the words **"not always"**: the design continues *"desecration → **a punishing executioner** and the fall to floor 5, win or lose"*. `ART-BIBLE.md:374` budgets a whole extra asset for exactly this: *"**Warden — executioner form** +1 … a merciful judge, or a punishing executioner."* **The executioner fight does not exist.** `PROGRESS.md:57` still claims "5 boss mechanics". `ROADMAP.md:173` M12 done-when: "each floor ends in a **distinct boss**". One floor does not.

**Retrofit cost: MEDIUM.** A fifth boss is a new `BossId`, new mechanic branch, new balance entry.

### 3.3 No boss is an agent — the entire M12 premise is missing ⛔
`ROADMAP.md:173-174` M12 done-when: *"each is a **boss agent that remembers your run** (built on M11)"*. `GAME-DESIGN.md:311`: *"Each boss is an **LLM agent with run-memory**"*. `src/game/boss.ts` contains zero LLM references. `src/llm/` contains zero boss references. `StoryMemory` (`narrate.ts:111-118`) exists but is never given to a boss. M12 is marked ✅ in `PROGRESS.md:57` on the strength of its *mechanics* only.

### 3.4 Equip is not a `step` input — it mutates state outside the engine's single path ⛔ BLOCKS
`src/game/game.ts:141-150` — `GameInput` has 9 variants; **none of them is equip/unequip.** Equipment is changed by the *render layer*:
```
src/desktop/view-model.ts:240  * FOLLOW-UP: promote equip/unequip to real step inputs
src/desktop/game.ts:256        const r = unequipSlot(state, s.slot);
src/desktop/game.ts:283        const r = equipFromBackpack(state, b.index);
```
Three consequences, all load-bearing:
1. It violates `CLAUDE.md` principle 1 in spirit — a state mutation that is not reproducible from `seed + inputs`.
2. **The entire M15 balance report is invalid for real play.** `docs/BALANCE-REPORT.md:33-37`: *"**Lower-bound caveat (equipment un-modelled).** The `step` controller has no equip action, so the sim fights with **starting gear** the whole way — found loot lands in the backpack unused."* The 32.9% headline is measured on a character that never equips anything it finds.
3. Replay/determinism tests cannot cover the equipment path at all.

**Retrofit cost: MEDIUM-HIGH and rising.** Adding a `GameInput` variant now is trivial. Adding it after `battle-screen`, `canvas-layer` and `screens-restyle` have all been built against the current view-model means rewriting three UI units' interaction model.

### 3.5 19 consumables, 4 uniques and 14 of 15 relics are unreachable in a real run ⛔ BLOCKS
This is a content-reachability audit, and it is severe.

**Consumables — 19 authored, 0 acquirable.** `getAllConsumables()` (`item.ts:187`) has **no non-test caller**. The backpack starts empty (`inventory.ts:33` `backpack: []`). The only three ways items enter a backpack are `rollLootDrop`, `rollChestLoot`, and deal rewards — all of which route through `rarityGen.generateItem`, and `kindForSlot` (`rarityGen.ts:65-77`) can only return `'weapon' | 'trinket' | 'armor'`. **`usable` is never generated.** `battle.ts:556` can *use* a consumable; nothing can *give* you one.

Design (`GAME-DESIGN.md:212-213`): *"**Scarcity: meaningful but not scarce** — regularly found/used, a normal part of the kit."*

**Uniques — 4 authored, 0 acquirable.** `getAllUniques()` (`item.ts:182`) has **no non-test caller**. The four named legendaries in `uniques.json` (Reflection's Edge, Ashen Crown, Grace-Forged Aegis, Hollow Regalia) can only be reached by `getItemById` if something hands you the id — and nothing does.

**Relics — 15 authored, 1 acquirable.** `getAllRelics()` is called once, at `deal.ts:140`, only to build a set for checking whether the player *already owns* a relic to pay with. The single grant is the hard-coded `deals.json` grace-pool line `{ "kind": "item", "defId": "mirror-shard" }` — reachable only when `karma.reverenceDesecration >= 3` (`deal.ts:100`). **14 of 15 relics — including all of floors 3, 4 and 5 — can never be obtained.**

Design (`GAME-DESIGN.md:173-174`): *"**Acquisition: all sources** **[DECIDED]** — boss rewards, hidden chests, AND sacrifice-deals."* None of the three is wired.

**Retrofit cost: MEDIUM.** New draw branches in `loot.ts` and `deal.ts`, which changes the seeded draw order (documented at `loot.ts:24-32` as "load-bearing for the determinism tests") and re-opens the balance pass. Also: 14 unreachable relics are 14 relics whose *effects* have never actually run in a game.

### 3.6 Two of five elite affixes can never be unlocked
`unlockStore.ts:97` `DEFAULT_AFFIXES = ['ravenous', 'ancient']`; `FEATS` grants `warped` once (`unlockStore.ts:342`). The file admits it: `unlockStore.ts:305-307` — *"The remaining `blessed` / `cursed` are **reserved for future feats**."* So 2 of 5 affixes are dead content. Both also carry provisional behaviour notes in data: `enemyAffixes.json:19` `"inflict insanity / illusion — provisional, M10 floor hooks"`, `enemyAffixes.json:31` `"karma-reactive — provisional, M8 uses flat mods only"` — i.e. `warped` and `cursed` do not do the thing their name says; they apply flat stat mods.

### 3.7 The unlock store accumulates relics and skills that the run never reads
`src/game/unlockStore.ts:155-162`:
```ts
export interface RunUnlocks { families: string[]; affixes: string[]; }
export function snapshotUnlocks(store) { return { families: [...], affixes: [...] }; }
```
`store.relics` and `store.skills` are written by feats (`unlockStore.ts:402-403`) and **never enter the run**. Two feats grant relics (`overclock-chip`, `scrap-plating`) into a set nothing consults. `grants.skills` is never populated by any feat.

### 3.8 The feat list is a seed, not the designed list
`unlockStore.ts:310-348` — 11 feats. Design `GAME-DESIGN.md:432-436` asks for:
- "Detonate 5 conditions in one hit → Neuromancer skill" — ✗ (no skill grants exist at all)
- "win a battle unhurt → **defensive perk**" — ✗ grants a *relic* instead (`unlockStore.ts:346`); **`FeatGrants` has no `perks` field at all** (`unlockStore.ts:286-292`)
- "get a kill with each DoT → a DoT relic" — ✗
- "3-crit streak → crit perk" — ✗
- "first time reaching each floor → **that floor's relics** enter the pool" — ✗ (`reach-act-N` grants families only)
- "first sacrifice-deal → deal-themed relics" — ✗
- "beat a floor boss → a themed relic" — partial (`first-boss-kill`, one relic, once)

### 3.9 Condition naming contradicts the design
`GAME-DESIGN.md:138-145` **[DECIDED]** names the six augment/deprivation pairs: **Strong/Weak · Quick/Slow · Hardy/Frail · Sharp/Dull · Lucid/Clouded · Emboldened/Cowed**. The code ships the legacy Java names as **player-facing display strings**:
```
condition.ts:105-116  healthy: 'Healthy'   (design: Hardy)
                      sick:    'Sick'      (design: Frail)
                      smart:   'Brainy'    (design: Sharp)
                      dumb:    'Dumb'      (design: Dull)
                      wise:    'Wise'      (design: Lucid)
                      fool:    'Fool'      (design: Clouded)
                      charming:'Charming'  (design: Emboldened)
                      repulsive:'Repulsive'(design: Cowed)
```
Note the code's own comments *use the design names* for the deferred hooks (`condition.ts:554` "Lucid/Clouded illusion-sight… Emboldened/Cowed deal-quality"), so the two vocabularies are already in the same file. **Retrofit cost: LOW now** (`displayName` is single-sourced in `CONDITION_DATA`), **MEDIUM after the battle screen ships** (chips, log lines, tests, and any authored prose referencing them).

### 3.10 All 24 conditions ARE implemented — but two of three twists are no-ops
Good news first: `condition.ts:40-70` defines **25** condition types (the 24 designed + `exposed`, the M3 Scavver mark). All tick. This is genuinely done.

The gap is the "mix model" twists (`GAME-DESIGN.md:136-145`), wired as explicit no-ops:
```
statEffects.ts:181  initiativeOrderTwist → 0   "no-op until M4"   (M4 is ✅ merged)
statEffects.ts:189  illusionSightTwist  → 0   "no-op until M10"
statEffects.ts:199  dealQualityTwist    → 0   "no-op until M7"    (M7 is ✅ merged)
```
Two of these name milestones that have already been marked complete. Quick/Slow and Emboldened/Cowed carry only their ± stat half.

### 3.11 Smaller engine items, quoted
| Item | Evidence | Blocks? |
|---|---|---|
| Flee chance 25% vs 35% unresolved | `src/game/battle.ts:16` — "the Java comment and this task say '~35%'. **[NEEDS-HUMAN: 25% vs 35%?]**" | no |
| Should consumable use cost a turn? | `src/game/consumable.ts:16` — "**[NEEDS-HUMAN M15**: should consumable/potion use grant the enemy a turn?]" — note `GAME-DESIGN.md:210` already **[DECIDED]** yes | no |
| Starting potions provisional | `src/game/player.ts:103` — "**[NEEDS-HUMAN M15**: 6 is…]" and `BALANCE-REPORT.md:23` "esp. `STARTING_POTS = 6`, generous for equipped play" | no |
| Per-act chest tables missing | `encounter.ts:54-55` — "Chests are act-agnostic **for now**… per-Act chest tables are an M8/M10 data expansion" | no |
| Enemy to-hit bonus provisional | `combat.ts:260` — "provisional single enemy to-hit bonus" | no |
| `strReq` penalty provisional | `defense.ts:41` — "Provisional M15 balance placeholder" | no |
| Unarmed damage floor is a placeholder rule | `equipment.ts:59` — "an unarmed hit deals a fixed floor of 1 + melee STR mod. M15 balance placeholder" | no |
| XP curve is a placeholder | `progression.ts:56-61` — "a deliberate M15 **PLACEHOLDER**" | no |
| Every draft weight is a placeholder | `draft.ts:22-23,45,50` — "**ALL** weights/templates are M15 placeholders" | no |
| Every family combat theme is a placeholder | `enemyFamily.ts:13-14,26` — "every `theme` magnitude… placeholders to be tuned in M15" | no |
| Penitent/Hollow hit dice provisional | `classKit.ts:18-19` — "provisional picks within the design ranges… their final values are an M15 call" | no |
| Class balance is 3.3× out | `BALANCE-REPORT.md` merciful table — Scavver **80.0%** win vs Penitent **24.4%**. `PROGRESS.md:27` "Scavver strong / ranged classes weak — play-test + weapons follow-up" | ⚠️ |
| Floor 5 is barely reached | `BALANCE-REPORT.md` baseline deaths-by-act — Act 5: **4** deaths out of 1677. The most expensive floor to build is the least-played | ⚠️ |

---

## AREA 4 — UI / RENDER

### 4.1 The battle screen, the canvas layer and the restyle are all unbuilt — and none of them is in the roadmap ⛔
`docs/UI-DESIGN.md:161-167` decomposes M-UI2 into five units. **One of five is merged** (`ui-foundation`, HEAD `c89304c`). The remaining four — `battle-screen`, `canvas-layer`, `screens-restyle`, `art-pipeline` — do not exist.

**And `docs/ROADMAP.md` contains no M-UI or M-UI2 milestone at all.** The roadmap runs M0–M17 with M16 = "Polish & game-feel"; the whole battle-screen-plus-whole-game-restyle programme is absent from the plan of record. `PROGRESS.md:14` counts "12/18 milestones" against a roadmap that does not contain the work currently in flight.

### 4.2 Five shared components are built, tested, and rendered by nothing
`src/render/components.ts` exports `panel` (:36), `bar` (:53), `chip` (:90), `labelledRow` (:99), `actionButton` (:121). `src/desktop/game.ts:44-45` imports **only** `buttonModel`, `rowModel`, `appendButton`, `appendRow`, `picker`. The pipeline log names it as an escape:
> `.claude/pipeline-log.md:124-129` — "**PIPELINE ESCAPE** … The engineer play-tested and reported *'not sure where I'm supposed to see things, the UI is still very weird, and looks the same as before.'* **He was right and the checklist was impossible.** … **nothing renders a bar or a chip yet.** HP is still plain text."

### 4.3 Kaplay is a dependency that nothing imports
`package.json:24` `"kaplay": "^3001.0.0"`. `grep -rn kaplay src electron` → **zero hits**. `desktop.html` has no `<canvas>`. There is no atmosphere layer, no sprite rendering, no hit feedback — i.e. `ROADMAP.md:202-204` M16 is 0% and `canvas-layer` has no foundation.

### 4.4 Deferred UI surfaces, quoted
| Surface | Evidence |
|---|---|
| Unlock-earned notification | `src/desktop/game.ts:97` — "for the **deferred in-UI notification** — NEEDS-HUMAN"; `game.ts:99` `void lastNewlyUnlocked; // consumed by the deferred unlock-notification UI (out of scope here)` |
| Locked-class visual treatment | `src/desktop/game.ts:454` — "(The locked-class visual treatment is NEEDS-HUMAN.)" |
| Tibia paperdoll UI — the ★ system of M5 | `PROGRESS.md:49` — "🔶 ENGINE merged… **Tibia visual UI deferred to a collab pass w/ you**"; `UI-DESIGN.md:349-350` — "still a collaborative pass; the inventory restyle in `screens-restyle` is a restyle of the current functional screen, **not that redesign**" |
| In-UI enemy-skill-name display | `.claude/pipeline-log.md:255` |
| In-UI deal-altar / loot / chest presentation | `.claude/pipeline-log.md:336, 355` |
| Item/relic/consumable display | `.claude/pipeline-log.md:355`; `PROGRESS.md:50` "flavor co-write & in-UI display pending" |
| Draft-picker rendering/polish | `.claude/pipeline-log.md:298` |

### 4.5 No bundled font
`src/render/tokens.ts:151` — `FONT_MONO = 'ui-monospace, "Cascadia Code", "Consolas", monospace'`. The art direction is *"monospace throughout, narrative text included"* and the interface *is* diegetically the Memorians' file (`WORLD.md:562-564`). A packaged offline game on three platforms will render that file in three different fonts. No font file exists in the repo. **Retrofit cost: LOW** — but it changes every metric in the type scale, so it is cheapest before the restyle.

---

## AREA 5 — THE LLM LAYER
**This is the largest single gap between what a document promises and what code delivers.**

`src/llm/` is **one file, 190 lines**: `narrate.ts` + its test. That is the entire layer. `GAME-DESIGN.md:384-386` states it plainly:
> "Current `src/llm/narrate.ts` is a pure prompt-builder **stub**; real model integration, streaming, grammar-constrained choices, the engine tool-registry, floor prompts, and boss agents are **all still to build**."

Against `ROADMAP.md:163-169` (M11 done-when), item by item:

| M11 requirement | Status | Evidence |
|---|---|---|
| "the narrator writes prose **and grammar-constrained choices** per beat" | ✗ **absent**. Choices are engine-authored buttons. `grep -rn grammar electron src/llm` finds it **only in `scripts/spike-llm.mjs:180`** — the throwaway benchmark. `electron/llm.mjs` calls `session.prompt` with no `grammar` argument | ⛔ |
| "**per-floor voices**" | ✗ **absent**, and actively wrong. `narrate.ts:14-20`: `const FLOORS = ['the First Floor', 'the Second Floor', … 'the Fifth Floor']` — five generic labels, not the locked names (Undercity / Entrance to the Void / Ash City / Angelic Underground / True Void). One persona string for the whole game | ⛔ |
| "**zone prompt files**" (`CLAUDE.md:45` lists them as required data-driven content) | ✗ **no such file exists** | ⛔ |
| "**enemy cards**" / lighter enemy templates (`GAME-DESIGN.md:376`) | ✗ absent | ⛔ |
| "an **engine-as-toolbox tool registry** (dice/combat/condition/item/rest/shop/progression/karma)" | ✗ absent | ⛔ |
| "**boss-agent infrastructure** (own prompt + run-memory)" | ✗ absent. `StoryMemory` exists (`narrate.ts:111-118`) and is never used by a boss | ⛔ |
| "**karma-… aware**" | ✗ `buildNarrationPrompt(events, state, memory)` (`narrate.ts:167`) reads `state.act` and `state.place` only. **Karma never reaches the model** | ⛔ |
| "beat significance" (which beats deserve prose) | ✗ absent — `narrate.ts:99-101` narrates every non-empty event set uniformly. `UI-DESIGN.md §2` locked "narration at bookends only (fast rounds)" — unimplemented | ⛔ |
| "headlessly testable against a **fake model**" | ✔ the prompt builder is pure and tested | ✓ |

**Plus two live contradictions with `WORLD.md`:**
```
src/llm/narrate.ts:9   'You are the Void — the narrator of a dark, dreamlike descent RPG about '
src/llm/narrate.ts:10  'psychosis and survival. …'
electron/llm.mjs:20    (the same string, duplicated in the Electron process)
```
`WORLD.md:565-567` explicitly instructs otherwise:
> "**M11 narrator work.** The narrator *is* the condition (§0), which is *caused by extraction* (§0c). It is therefore **the voice of an injury someone inflicted deliberately** — not a place, not a spirit, not the game. **That should change how the persona prompt is written.**"

And "the Void" is addressed as a *place* the player descends through, which `docs/README.md:59-60` marks as the corrected-and-wrong assumption: *"**The Void is not a place — it is a condition, and the condition is the Hollow.**"*

Also note **the persona string is duplicated** in two processes (`narrate.ts:8` and `llm.mjs:19`) with slightly different wording — so rewriting it requires editing both, and one of them (`llm.mjs`) has no test.

**Retrofit cost: HIGH, and rising with every authored word.** Grammar-constrained choices change the *shape* of the UI (the narrator authors the buttons, the engine validates them) — building `battle-screen` against engine-authored buttons and then switching to model-authored ones is a rewrite of the action menu. The zone-prompt file format should be decided before any floor prose is written, or the prose will be written into the wrong container.

---

## AREA 6 — ART / AUDIO

### 6.1 Zero assets exist. Zero tooling exists.
- `find src electron -type f` returns **no binary media of any kind** — no `.png`, `.jpg`, `.ogg`, `.woff`, `.ico`.
- There is no `src/assets/` directory, despite `UI-DESIGN.md:203` specifying `src/assets/… the chosen finals → committed`.
- **`scripts/gen-art.mjs` does not exist.** `src/data/artPrompts.json` does not exist. Both are specified at `UI-DESIGN.md:194-204`.
- `art-candidates/` contains only 18 probe JPEGs, and is gitignored.
- Blocked upstream: `PROGRESS.md:39` — "**BLOCKED on the engineer:** the Google API key (via `.env`, not chat) before any art can generate." `.env` exists but `UI-DESIGN.md:336-340` records the key as **compromised and requiring rotation** before use, and `UI-DESIGN.md:247-252` records billing must be enabled first.

### 6.2 The asset list disagrees with itself
| Source | Total |
|---|---|
| `ART-BIBLE.md:361` heading | "**The asset list — 52 assets [LOCKED 2026-08-25]**" |
| `ART-BIBLE.md:376` table total | **52** |
| `ART-BIBLE.md:359` | "Asset count rises 52 → **53**." |
| `ART-BIBLE.md:307-314` generation-order table | 7 + 5 + 32 + 9 = **53** |
| `PROGRESS.md:96` | "Batch: 39 → **53** assets (~$21)" |
| `UI-DESIGN.md:224` | "**Total ... 39**" |

The §4b table itself omits the Ash-Wretch that §4 added. Four numbers in circulation.

### 6.3 What a finished game needs that is on NO list
None of the following appears in the 52/53-asset list, in `ART-BIBLE.md`, or anywhere in the repo:

| Need | Why it is required | Evidence of absence |
|---|---|---|
| **All audio** — combat hits, UI clicks, ambience per floor, music, boss stingers | `UI-DESIGN.md:353-354` — "**Audio.** Never discussed. Flagged as **[OPEN]** — a turn-based battle screen with beat-by-beat sequencing is the natural place for hit and impact sound, and **it will feel oddly silent without it**." | no audio files, no audio code, no audio budget, no audio milestone |
| **App icon** (Win `.ico`, macOS `.icns`, Linux `.png`) | Every installer needs one | `electron-builder.json` has **no `icon` field** on any of `win`/`mac`/`linux` → ships with the default Electron logo |
| **Installer / NSIS artwork** | Windows installer branding | absent |
| **Splash / first-run screen** | The 2.5 GB model download and the 15–20 s GPU load (`N1-SPIKE.md` table) both happen before anything renders | absent |
| **Bundled monospace font** | see 4.5 | absent |
| **Cursors** | "elevated terminal" direction implies one | absent |
| **itch.io page art** — cover (630×500), banner, 3–5 screenshots, optional GIF | itch requires a cover image to publish | absent; `itch-description.html` is text only and stale |
| **Item icons** | `ART-BIBLE.md:483-486` — "**Item icons — deferred again, deliberately** … **Revisit only after the inventory has a real design.** Not in any batch until then." Circular: the inventory redesign is itself deferred to a collab pass (4.4) | absent |
| **Interface furniture** | `ART-BIBLE.md:314` — "Stage 5 · Interface furniture — **if any** … Assets: **?**" — a literal question mark in a locked table | undecided |
| **The Rift transition art** | `ART-BIBLE.md:299-300` | undescribed |
| **Death / game-over screen art** | not on any list | absent |
| **7 individual Sin sprites need 7 individual Sins in data** | see 1.6 | engine blocker on an art asset |

### 6.4 The `art-pipeline` unit is bigger than it was scoped
`UI-DESIGN.md:321-324`:
> "**Consequence:** `art-pipeline` is no longer just 'call the API in a loop'. It needs a **generate → validate → regenerate** loop with the corner-pixel gate, reference-image conditioning for style lock, and an alpha-keying post-process step. **That is a bigger unit than first scoped.**"

Plus a new tooling dependency (`sharp` or equivalent, `ART-BIBLE.md:474-476`).

---

## AREA 7 — PACKAGING / SHIPPING (M17)

### 7.1 The model is NOT bundled — the "offline" game requires a 2.5 GB download on first run ⛔ BLOCKS
```
electron/llm.mjs:16  const MODEL_URI = 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
electron/llm.mjs:33  const modelPath = await resolveModelFile(MODEL_URI, modelsDir);
```
`models/` is **empty** and gitignored. `electron-builder.json` `"files": ["dist/**", "electron/**", "package.json"]` — the model is not in the package.

Three documents claim otherwise:
- `CLAUDE.md:5` — "A **local language model** (3–4B, **bundled** — no cloud, no keys, no per-turn cost)"
- `.env.example:5` — "The game itself needs no keys at all: the narrator is a local model, **bundled**, run offline."
- `ROADMAP.md:209-210` M17 — "**model bundled** in the installer with a first-run load/download UX"

There is **no first-run download UX** either — `llm.mjs` calls `resolveModelFile` directly and reports progress only through `onStatus({phase:'resolving'})`. A user with no internet gets a failure at an unspecified place.

**Retrofit cost: MEDIUM-HIGH.** Bundling changes the installer size class (2.5 GB), triggers itch.io's butler upload path, and forces the bundle-vs-download decision that `ROADMAP.md:211` still lists as an open key decision.

### 7.2 The 1.7B low-end tier was recommended and never built
`docs/N1-SPIKE.md` verdict: *"**Model plan (recommended): ship both, auto-select by hardware.** … **Qwen3-1.7B = no-GPU / low-end floor.** … Runtime: detect GPU/RAM → 4B if capable, else 1.7B."* Code: `electron/llm.mjs:15` — *"**4B only** (the N1 decision)."* `CLAUDE.md:65` sets "**Min spec: typical laptop, no GPU**", where the spike measured the 4B at **7.6 tok/s and ~5 s to first token** — i.e. the min-spec experience is the one that was rejected.

### 7.3 Packaging config is an N1 stub, by its own admission

> **⚠ CORRECTED 2026-08-30 (`FINDINGS.md` G44). The key quoted below is not inert — it is what
> breaks the build.** `$comment` is rejected by `app-builder-lib`'s schema (`additionalProperties:
> false`, `$schema` the only permitted `$`-key), and validation runs *before* any packaging work, so
> **`npm run desktop:pack` has never once succeeded** — the file has a single commit and the key is
> in it. Everything listed below as "missing" is missing from a config **that does not validate at
> all**, which this section reads as working. *(This audit is a frozen snapshot; the correction is
> noted rather than rewritten.)*

`electron-builder.json:2`:
> `"$comment": "N1 packaging config. **Full installers + first-run model handling are N10.**"`

Missing, concretely: `icon` (all three platforms), `publish` target, `nsis` block (install dir, shortcuts, uninstaller), macOS `hardenedRuntime` / `entitlements` / notarization, code-signing identity for Windows or macOS, `productVersion` (`package.json:4` is `"version": "0.0.0"`), `artifactName`, `linux.desktop` entry, `extraResources` for the model.

### 7.4 Licensing is entirely absent ⛔ BLOCKS a public release
- **No `LICENSE` file at the repo root.** (Both legacy ports have one: `.legacy/The-Void/LICENSE.md`, `.legacy/The-Void-Py/LICENSE.md`.)
- `package.json` has **no `license`, `author`, `description`, or `repository` field**; `"private": true`.
- **No third-party attribution file.** The game will redistribute Qwen3 (Apache-2.0 — `N1-SPIKE.md` confirms it is "clean to bundle") plus llama.cpp binaries via `node-llama-cpp`, Electron, and Kaplay. Apache-2.0 redistribution **requires** shipping the licence text and a NOTICE.
- No privacy/telemetry statement. `ROADMAP.md:210` lists "crash/telemetry decision" as still open.

### 7.5 itch.io release
- `itch-description.html` exists but is **badly stale** — see 9.6.
- No cover image, no screenshots, no butler config, no CI, no release script beyond `desktop:pack`.
- `ROADMAP.md:211` — "**Key decisions:** bundle vs. first-run download of the model; **store page + pricing**." Pricing is undecided.

### 7.6 `worktrees/` — 18 stale unit directories still on disk
`PROGRESS.md:144` — "The 16 unit worktrees under `worktrees/` and their `agentic/*` branches are now fully merged and are safe to delete — **left in place pending the engineer's word**." There are actually **18**. `vite.config.ts:29` has to explicitly exclude them from Vitest. Housekeeping, not a blocker.

---

## AREA 8 — TESTING / INFRA

**Baseline: 1029 tests, 56 files, genuinely rigorous** (the pipeline log shows mutation testing, self-invented violations, and a caught vacuous guard). The gaps below are real but this is the healthiest area of the project.

### 8.1 Source files with no sibling test
| File | Lines | Note |
|---|---|---|
| `src/desktop/game.ts` | **611** | The single largest file in the project. DOM builder — deliberate deviation, but it also contains **all the equip/unequip state mutation** (3.4) and all screen routing |
| `src/render/components.ts` | 188 | DOM builders; models are tested via `component-model.test.ts` |
| `electron/llm.mjs` | 109 | **The entire model integration.** Untested; also holds the duplicated persona string (Area 5) |
| `electron/main.mjs` | 162 | IPC surface, window creation |
| `electron/preload.cjs` | 34 | The security boundary — context isolation contract |
| `electron/log.mjs` | 47 | |
| `electron/gpu-probe.mjs` | 24 | |
| `scripts/balance-report.ts` | 221 | **Generates a document treated as authoritative** (`docs/README.md:18`) with no test |
| `scripts/spike-llm.mjs` | 299 | acceptable — throwaway |
| `src/desktop/debug-overlay.ts` | 63 | |
| `src/game/shield.ts` | 42 | The only untested `src/game` module (covered indirectly by `defense.test.ts`) |
| `src/render/theme.ts` | 23 | 5-line DOM write, acceptable |

### 8.2 Conspicuous absences beyond "DOM builders are untested"
- **No integration test for the Electron IPC contract.** `preload.cjs` ↔ `main.mjs` ↔ `game.ts` is three files, zero tests, and it is the seam that breaks silently on an Electron major bump.
- **No test asserts that authored content is reachable.** The catastrophes in 3.5 (19 consumables, 4 uniques, 14 relics unreachable) are *exactly* the class of bug a "every catalog id is obtainable by some code path" test would have caught on the day M6 merged. There is a `catalog.test.ts`, but it evidently checks shape, not reachability.
- **No test asserts prose is non-empty.** Ten empty `body` strings ship (2.4) and 1029 tests are green.
- **No screenshot/visual regression.** Acknowledged and deliberate.
- **No performance/latency test** for narration TTFT, despite it being the core UX risk (`N1-SPIKE.md`).
- **The Electron boot probe was not committed.** `.claude/pipeline-log.md:120-122`: *"Test-agent's own suggestion, worth taking in the next unit: **commit the Electron boot probe as a script**, so `battle-screen`, `canvas-layer` and `screens-restyle` inherit a headless boot check instead of each ending with an unrunnable manual step."* Not done — three UI units will each end in an unverifiable manual step.
- **Two known-live test defects carried forward, unfixed:** `.claude/pipeline-log.md:115-119` — "(a) the `shippingCss` comment-stripping helper is itself **unpinned** — making it a no-op leaves the suite green… (b) A contrived `/*` in one CSS string plus `*/` in a later one hides everything between."
- **`vite.config.ts:23`** — `environment: 'node'` globally, so no test can ever touch the DOM without a per-file override. Choosing `jsdom` for `src/render`/`src/desktop` is a config decision better made before three UI units land.

### 8.3 The human-verification backlog is large and unstructured
`.claude/pipeline-log.md` banks NEEDS-HUMAN items at lines 68, 171, 195, 215, 236, 255, 273, 277, 298, 316, 336, 355, 382, 400, 417, 433, 470, 482, 499, 512, 548 — **21 separate banked sets**. `HUMAN-CHECKS.md` is the accumulator (`CLAUDE.md:74-75`) but was **last touched 2026-08-14**, before all of the M-UI2 and world/art work. The two are out of sync.

---

## AREA 9 — CONTRADICTIONS BETWEEN DOCUMENTS
*`docs/README.md:44-50` records three corrections. Here is everything else. Ranked by damage.*

### 9.1 ⛔ THE SOCKET — three-way conflict, all dated 2026-08-25, blocks art generation
| Source | Says |
|---|---|
| `docs/ART-BIBLE.md:285` **[LOCKED 2026-08-25]** | Neuromancer: "Thin coat over **a rig of trailing leads, sockets at the temple**." |
| `docs/ART-BIBLE.md:498-499` **[CLOSED 2026-08-25]** | "**keep the hardware OUT of the art.** **No temple sockets, no leads, no visible chip ports, on anyone.**" |
| `docs/WORLD.md:555-559` | "an emptied socket is **the single most on-theme visual detail available**… **[OPEN]** whether every class portrait shows a socket" |

Two **[LOCKED]** statements in the same file, dated the same day, directly negate each other — and the newest authoritative doc leaves it open. Generation order puts class portraits at **stage 2 of 5** (`ART-BIBLE.md:311`), so this blocks the batch. **Cost of deciding now: zero. Cost later: regenerating the class portraits AND every asset conditioned on them — which per `ART-BIBLE.md:404-407` is the entire five-asset recursion set (Mirror-Self → The Reflection → Echo of You → The Hollowed → Hollow Self).**

### 9.2 ⛔ `CLAUDE.md` "wins over everything" and is stale in five places
`docs/README.md:23-24, 35` — *"the load-bearing engineering principles. **These override any library convention or agent default**, and they win over anything in this folder."* and *"**`CLAUDE.md`** wins over everything."*

| Line | Says | Contradicted by |
|---|---|---|
| `CLAUDE.md:3` | "An **LLM-driven narrative RPG**" | `GAME-DESIGN.md:517-520` explicitly flagged this: *"the top-line description there… predates this interview. The game is now **mechanics-first with an LLM narrator**. Worth a one-line tweak… (flagged, not silently changed — that file is yours)."* Flagged 2026-08-05, still uncorrected 20 days later |
| `CLAUDE.md:5` | model "**bundled**" | `electron/llm.mjs:16` downloads it (7.1) |
| `CLAUDE.md:7` | "dice combat, status conditions, skills, **shop/rest**, XP across five Acts" | The shop is **deleted**. `PROGRESS.md:140` — "`src/game/shop.ts` + `src/scenes/shop.ts` **deleted** (gold is gone)" |
| `CLAUDE.md:8` | "Full locked design: `docs/ROADMAP.md` (**v2**)" | ROADMAP is v3 (`ROADMAP.md:3` "**v3 supersedes v2**"), and `docs/README.md:14` names `GAME-DESIGN.md` as the design |
| `CLAUDE.md:37-38` | "Kaplay (under `src/render` and **`src/scenes`**)" | `src/scenes/` was **deleted** (`UI-DESIGN.md:172-176`, `PROGRESS.md:80`) |
| `CLAUDE.md:73` | "recompute the overall % (**M1–M11** are the core milestones; **M12 is a stretch goal, not counted**)" | v3 has **M0–M17** and `PROGRESS.md:14` counts 18. M12 is ✅ merged, not a stretch goal |
| `CLAUDE.md:62` | "**Tauri is the fallback** — N1 validates" | N1 validated Electron; settled |

Because this file has top precedence, an agent reading it correctly will build the wrong game. **Cost to fix: minutes. Cost of not fixing: every future session re-derives from it.**

### 9.3 ⛔ `GAME-DESIGN.md` contradicts itself on the economy
- `GAME-DESIGN.md:214-215` **[DECIDED]**: "**Loot comes from drops + chests + shops** … **shops sell curated stock**."
- `GAME-DESIGN.md:392` **[DECIDED 2026-08-05]**: "**No currency. No coin. Anywhere. Ever.** Gold is **removed**."
- `GAME-DESIGN.md:405-406`: the shop is "**replaced** by a proper **sacrifice-deal encounter**."

Same document, same day, §6 and §11. `ROADMAP.md:137-138` M7 inherits the confusion ("loot flows from **drops + chests + shops**"). The code implemented §11.

### 9.4 ⛔ `docs/README.md`'s own index is incomplete — by its own rule
`docs/README.md:4`: *"Keep this index current: **a document not listed here will be missed by the next session.**"*

Not listed: **`WHAT-WE-BUILT.md`** (12,987 bytes, root) and **`itch-description.html`** (the public-facing store copy). Both are stale (9.5, 9.6). By the file's own logic they will be missed — and I found them only by directory listing.

### 9.5 `WHAT-WE-BUILT.md` describes a game that no longer exists
Last modified 2026-08-10.
- `:45` — "Decides everything factual: dice rolls, damage, health, **gold**, what choices are legal" — gold removed
- `:78` — "battles, rest stops (with lore + healing), **the stranger's shop**" — deleted
- `:116` — "Buy / Refuse **at the shop**" — deleted
- `:117` — "a character sheet on the left (your name, health, experience, **gold**, act…)"
- `:10-13` — "descending through five floors of a dark, dreamlike **place**" — `docs/README.md:59-60`: "**The Void is not a place**"
- `:17-19` — "it runs **on your own computer** (**no internet**, no accounts)" — contradicted by 7.1

### 9.6 `itch-description.html` is the public store copy and is wrong about the game
This is what a customer would read.
- "A **text-based**, turn-based RPG" — it is a graphical desktop app with a canvas layer planned
- "**Four floors / four acts**, ending in a final boss" — **five** floors is the locked spine (`GAME-DESIGN.md:281`)
- "exploring **LLM-driven content: enemies, lore, and story generated at runtime instead of hand-written**" — the exact opposite of the locked engine-authoritative principle (`GAME-DESIGN.md:35-36`, `CLAUDE.md:49-53`). Enemies are generated by seeded engine code, not the LLM
- "Random encounters — battle, **shop**, rest" — shop deleted
- No mention of karma, classes, relics, the descent, the Void-as-condition, or the endings — i.e. every pillar

### 9.7 `HUMAN-CHECKS.md` presents resolved questions as open (last touched 2026-08-14)
- `:163` — "**⚠️ Top decision — the game is currently unwinnable (balance)**" — **RESOLVED**. `PROGRESS.md:24` "✅ **THE GAME IS WINNABLE — proven by simulation**"
- `:241` — "**Enemies always hit** — faithful… Add a miss chance later?" — **resolved in M4** (✅ merged)
- `:243` — "**Every enemy is a 'Beast'**… Want distinct enemy families per act later?" — **resolved in M8**, 24 families
- `:245` — "**Shop reached via the menu's 'Character Info'** — faithful quirk. Keep?" — **the shop is deleted**
- `:190-191` — the "full run works" script says "battle → rest → **shop** → level-up"
- `:176` — "Your levers: … `src/data/weapons.json`" — still true, and still the Jaaj Swords

### 9.8 `PROGRESS.md` contradicts git
`PROGRESS.md:76` — "Branch `agentic/ui-foundation`, **unmerged, awaiting your review.**" Git HEAD is `c89304c "Merge ui-foundation (M-UI2 unit 1 of 5) into main"`. Also `PROGRESS.md:14` says "**12/18** milestones on `main` (M0–M9, M12, M13, M15)" — that list names **13** items, one of which (M5) is 🔶 partial. And neither M-UI nor M-UI2 appears in the 18.

### 9.9 `UI-DESIGN.md` §9 lists two questions already settled in `ART-BIBLE.md`
`UI-DESIGN.md:326-332` **[OPEN]** lists "Alpha strategy… needs confirming" — settled at `ART-BIBLE.md:471-476` ("**Transparency — key to PNG in post**"). Per the precedence rule (`docs/README.md:38`) ART-BIBLE wins, but UI-DESIGN still reads as open.

### 9.10 `ART-BIBLE.md` §9 "Still open" lists two items settled higher in the same section
- `:513-515` item 8 — "Karma's world-objects have no art… **no shrine, altar or offering asset is in the 39**" — but `:375` added "**Altar / shrine +2**" to the 52
- `:516-517` item 9 — "**The five affixes**… have no visual treatment and no budget line. Recolour? Aura? Nothing?" — but `:477-482` **settled** it: "**Affixes — code effects, zero new art.**"
- The list is also mis-numbered: `2, 3, 3, 8, 9` — two items numbered 3, then a jump to 8 (leftovers from the superseded 39-asset list).

### 9.11 Pre-WORLD.md assumptions still live in code and docs
`docs/README.md:36-37`: *"**`WORLD.md`** wins on anything about the fiction… older prose written before it may contradict it and is wrong where it does."* Applying that rule:

| Stale claim | Where | WORLD.md says |
|---|---|---|
| "the narrator of a … RPG about **psychosis and survival**" | `narrate.ts:9-10`, `llm.mjs:19-21` | §0 the narrator *is* the condition; §12c "the voice of an injury someone inflicted deliberately" |
| "descent through five floors of **the Void**" (the Void as traversable place) | `CLAUDE.md:3`, `ROADMAP.md:10`, `GAME-DESIGN.md:15`, `WHAT-WE-BUILT.md:10` | §6 "**The Void — a condition, not a location**" |
| "'the First Floor' … 'the Fifth Floor'" | `narrate.ts:14-20` | §6 the five *stages*: before → fracture → grief → judgement → absence |
| "The descent is **stages into the mind**: it begins literal and becomes psychological" | `GAME-DESIGN.md:283` | §0c/§127 **the whole game happens during the extraction**; the floors are the reading's stages |
| "The Undercity — grounded **neo-noir; rain, neon, grime**" | `GAME-DESIGN.md:289` | ART-BIBLE §4 **flooded industrial**, toxic green, standing water — not neon rain |
| "the Arch-Mage… has ordered you to delve into the Rift and **kill the kingpins**" (plural, ongoing mission) | `story.json:9-10` | §4 the mission **ends after floor 1**; the Kingpin is a Grandmore collaborator and is **beaten but not killed** |
| Floor 3 "emptiness of madness" | `GAME-DESIGN.md:291` | §12c "Floor 3's ash is now **literally the player's extracted life**. The Feelings and Sins that live there are being mourned because they are **yours**." |
| "The Hollowed (former fallen descenders — what you may become)" | `GAME-DESIGN.md:359` | §12d **CLOSED** — "they are **literally other people**": a stripped chip in an emptied body. (WORLD graciously notes the old line "was accurate in the plainest possible sense the entire time" — so this one is compatible, but the *design* text does not carry the meaning) |

### 9.12 Minor content collisions
- **Two items named "Clarity Draught":** `items.json:28` (`clarity-draught`, heal 8) and `consumables.json` (`clarity-tonic`, name `"Clarity Draught"`). `getItemById` (`item.ts:205-206`) resolves base items *first*, so the consumable's display name is a duplicate.
- **`enemyAffixes.json` behaviour notes contradict the affix names** — `warped` "inflict insanity / illusion — **provisional**", `cursed` "karma-reactive — **provisional**, M8 uses flat mods only". Neither does what it says.

---

## THE RANKING YOU ASKED FOR
*"How expensive would it be to retrofit if we build now and fix later" — highest first.*

### Tier 1 — Decide/build BEFORE anything else is built on top. Retrofit = rewrite.
1. **Floor-specific mechanics (3.1).** Battle-loop and encounter-generator surgery. Breaks every determinism test and every balance number. **Nothing else should be built on a battle loop with no floor-modifier hook.**
2. **Grammar-constrained, model-authored choices (Area 5).** Determines the *shape* of the action menu. Building `battle-screen` against engine-authored buttons and switching later is a UI rewrite.
3. **Equip as a `step` input (3.4).** Cheap now (one union member); after three UI units it is a three-unit rewrite — and until it lands, no balance number describes real play.
4. **The floor-4 gate's floor-4-choices term (1.1).** Changes a function signature, save state, encounter phases, and re-opens M15.
5. **A `description`/flavour field on every content schema (2.6).** A schema change touching validation, saves, view-model and every item literal in 1029 tests. Free today; expensive after the item UI exists.
6. **The socket decision (9.1).** Zero cost to decide; regenerating 10 conditioned assets later costs money and style-consistency.
7. **Model bundling vs first-run download (7.1).** Determines installer architecture, size class, and the whole itch upload path.

### Tier 2 — Expensive but contained; fix before the content pass.
8. **Acquisition paths for consumables / uniques / relics (3.5).** New seeded draws → determinism + balance churn.
9. **The clarity↔delusion triggers (1.2)** — gated behind Tier-1 item 1.
10. **Karma's mid-run effects and karma-in-the-prompt (1.3).** Changes encounter draw order.
11. **The floor-4 executioner boss (3.2)** and **the 7 individual Sins / Ash-Wretch family (1.6)** — engine changes that art is already budgeted against.
12. **Condition renaming to the design vocabulary (3.9).** Trivial today, spreads into chips/log/prose/tests after `battle-screen`.
13. **The zone-prompt file format (Area 5).** Decide before a word of floor prose is written, or it gets written into the wrong container.
14. **Audio decision (6.3).** Not the assets — the *decision*, because it changes the beat-sequencing architecture in `battle-screen`.
15. **A bundled font (4.5).** Changes every metric in the type scale.

### Tier 3 — Genuinely deferrable. Authoring and polish, cheap to add late.
16. Weapon/armor tables, item names, lore, act intros/outros, ending prose, boss dialogue, enemy name tables, item/skill/condition descriptions — *once the schema slots from Tier 1 item 5 exist*.
17. Art generation (blocked on: API key rotation, billing, reference approval, the socket decision).
18. Feat-list expansion, `blessed`/`cursed` affixes, karma clamping, karma-memory consumer.
19. All packaging: icons, installers, signing, licensing, itch page. Mechanical, well-understood, late-stage.
20. Documentation reconciliation (Area 9) — **but note this is Tier 3 in *effort* and Tier 1 in *urgency*.** `CLAUDE.md` has top precedence and is wrong in five places; every hour it stays wrong is an hour an agent may build from it. It is the cheapest high-value fix on this entire list.

### ~~The one thing I would flag above all others~~ — **RESOLVED 2026-08-25, struck 2026-08-28**

> **⚠ This entire recommendation is DEAD, and so is every row of §9.2 beneath it.** `CLAUDE.md` was
> corrected the same day this audit was written and now opens *"A **mechanics-first roguelike RPG
> with a local-LLM narrator**"*. Every supporting claim is likewise false today: it contains no
> mention of a shop (it says "sacrifice-deals/rest"), none of `src/scenes`, states *"4B — the only
> tier shipped"* and *"downloaded once on first run, by design"*, and says outright *"Electron is
> settled… Tauri is not in play."*
>
> **Also inverted, in §7.2:** *"The 1.7B low-end tier was recommended and never built"* is filed as a
> **gap**. It is a **decision** — `CLAUDE.md` records the 1.7B fallback as **rejected**, with a GPU
> now required as min spec.
>
> This mattered enough to correct despite the frozen banner because `docs/README.md` still sends
> readers here *"before committing to any new unit"*, and this is the section headed "above all
> others" — the one a reader in a hurry acts on.
`docs/README.md` establishes a precedence order in which **`CLAUDE.md` beats `WORLD.md`**. `CLAUDE.md` still opens "An **LLM-driven narrative RPG** about a descent through five floors of the Void" — a sentence that is wrong about the genre, wrong about the Void being a place, wrong about the model being bundled, wrong about the shop, and pointing at a superseded roadmap version. It was flagged for correction on 2026-08-05 (`GAME-DESIGN.md:517-520`) and deliberately left alone because it is the engineer's file. **The scope-definition pass should start there**, because every other document defers to it.