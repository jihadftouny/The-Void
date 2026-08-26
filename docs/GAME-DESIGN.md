# The Void — Game Design Document (full scope)

> **Status: living design record.** Captured from the scope interview on 2026-08-05. This is the
> single source of truth for *what the game is*. `docs/ROADMAP.md` (v2) holds the build-milestone
> detail for the LLM layer; `PROGRESS.md` tracks build state. Where this document and ROADMAP v2
> differ, **this document is the newer intent** and ROADMAP will be reconciled to it.
>
> Each item is tagged **[DECIDED]** (locked in the interview), **[PROPOSAL]** (my draft for a
> brainstorm item — not final, react to it), or **[OPEN]** (still to decide).

---

## 1. The one-line pitch

A **mechanics-first, roguelike descent** through five floors of the Void — a crunchy Dungeons &
Dragons-style RPG where a **local language model narrates** the journey and writes your choices, but
the deterministic engine owns every rule and number. The descent is lived experience of
psychosis rendered as a dungeon: it starts literal and becomes a journey into a fracturing mind. What
you *do* — everything you do — is read by the Void and decides how it ends.

---

## 2. Vision & pillars **[DECIDED]**

1. **Mechanics-first.** The deep, tactical RPG is the heart — builds, items, skills, status play. The
   LLM narrates *over* the mechanics and never runs them. If a mechanic doesn't earn its place in the
   combat/build game, it doesn't ship.
2. **Hybrid-but-roguelike.** An authored 5-floor arc, but built for repeated play: procedural
   variety, die-and-restart, unlocks that broaden future runs. A run is a story *and* a build.
3. **Subtle, un-metered theme.** The psychosis is *felt* — through tone, contradiction, and
   consequence — never simulated with a "sanity bar." Nothing on screen says "you are going mad."
4. **Karma / "Nature" is a core pillar — and hidden.** The Void reads everything you do into a hidden
   nature state that bends both the world and the mechanics mid-run and resolves into a *blended,
   analog* ending. The player perceives it only through the narrator's tone and the world's reactions.
5. **Engine-authoritative LLM.** The narrator narrates and writes the choice options; the engine owns
   all dice, damage, loot, and state. Every LLM output that feeds the game is grammar/JSON-constrained.
6. **Tough but fair.** Real challenge, meaningful death, mastery-driven. Target run length ~45–90 min.

---

## 3. Core loop & run structure **[DECIDED]**

- **A run = descend 5 floors, or die trying.** Each floor is a sequence of encounters (combat,
  rest, shop, events, chests) ending in a **floor boss**, then descent to the next floor.
- **Death restarts the run.** Roguelike: you lose your build and items on death. What persists is
  **unlocks** (§8) — new classes, skills, items, enemies become available for future runs — but you
  never start mechanically *stronger*; you win on skill and knowledge, not grind.
- **Within a run you snowball a build** via frequent level-up choices (§4), loot (§6), and relics
  (§6). Runs feel different because of the build you assemble and the karma path you walk.
- **Difficulty: tough but fair**, mastery-driven (Slay-the-Spire / Hades register). Ascension-style
  optional modifiers are **[OPEN]** (you chose "tough but fair" over "adjustable+ascension", but a
  post-launch ascension ladder is a natural fit — flagged for later).

---

## 4. Character system

### Decided
- **Five classes, each with a signature kit and ONE signature twist** on a shared skill/charge
  baseline (**hybrid depth** — not five fully bespoke engines; deep identity, far less to balance).
  **[DECIDED 2026-08-05]**
- **1 start + 4 unlock** (revised 2026-08-05): only **Enforcer** is available at the start — it is the
  tutorial/anchor class. The other four unlock via feats (§12): **Neuromancer** and **Scavver** are
  *easy/early* unlocks (surfaced within the first runs), while **Penitent** (floor-4 grace) and
  **Hollow** (floor-5 / desecration) are the *deep* unlocks tied to the two ending paths. **[DECIDED]**
- **Karma = thematic flavor only:** classes *lean* toward karma axes in tone/story (Penitent→reverence,
  Hollow→desecration) but have **no mechanical karma coupling**, so class balance stays independent of
  the pillar. **[DECIDED]**
- **Frequent in-run growth:** level up often; each level offers a **choice** (a new/upgraded skill, a
  stat bump, or a perk). Roguelike "snowball your build" loop, replacing the 4-total act-gated
  level-ups. **[DECIDED]**
- Six D&D stats stay (STR/DEX/CON/INT/WIS/CHA), rolled at character creation. **[DECIDED — inherited]**

### The roster **[DECIDED — kits/numbers refine during M2–M3]**
Each is a different way of confronting the descent. Signature twist in **bold**.

| Class | Stats · die | Signature twist | Kit | Element / condition theme | Karma lean (flavor) |
|---|---|---|---|---|---|
| **Enforcer** *(START; exists as stub)* | STR·CON, d10 | **Momentum** — landing/taking hits builds it; spend on big strikes or a guard stance | Heavy Strike, Brace, Intimidate, Execute | Physical/Force; fracture, stun, bleed | might / neutral |
| **Neuromancer** *(unlock: easy/early)* | INT·WIS, d6 | **Detonate** — stack mental conditions, then blow them up for scaling damage | Mind Spike, Unravel, Lull, Synapse | Psychic/Cryo/Electro; insanity, sleep, freeze, debuffs | clarity↔delusion |
| **Scavver** *(unlock: easy/early)* | DEX, d8 | **Tempo/Evasion** — dodge instead of tank; build Exposure for crits/DoTs | Backstab, Venom Coat, Slip, Scavenge | Poison/Physical; poison, bleed, evasion | restraint↔greed |
| **Penitent** *(unlock: floor-4 grace)* | WIS·CHA, d8–d10 | **Devotion/Martyr** — self-sustain; spend HP for smites/heals/wards | Smite, Mend, Consecrate, Martyr | Force (holy), Psychic (will); regeneration, cleanse | reverence |
| **Hollow / Voidtouched** *(unlock: floor-5 / desecration)* | CON·CHA, d6–d8 | **Corruption** — spend HP/max-HP for outsized power, offset by lifesteal; stronger the darker you go | Siphon, Corrupt, Sacrifice, Unmake | Poison/Psychic; curse, insanity, lifesteal | desecration / cruelty |

### The in-run level-up loop **[DECIDED 2026-08-05 — the roguelike snowball, M9]**
- **XP-driven and frequent:** every kill grants XP; you level up **several times per floor** (retune
  the current act-gated XP thresholds). Reuses the existing XP system.
- **Each level-up = auto HP + a draft.** Max-HP **auto-grows** (rolled from the hit die, deterministic)
  so survivability keeps pace; *plus* you **draft 1 of 3** offered options. The narrator frames the
  draft thematically ("the Void offers you…"), grammar-constrained to the valid option set.
- **Draft pool = class kit + shared pool:** weighted toward your class (new signature skills; or
  upgrades to owned skills — +damage / +charge / add a condition / cheaper cost), mixed with universal
  perks (max charges, crit, evasion, lifesteal…) and **stat bumps** (investing a stat point is one
  draftable option — stats do **not** auto-grow).
- **Start lean, draft your kit:** begin with only **1–2 core class skills**; assemble the rest of the
  kit + perks over the run — so no two runs of the same class play alike.
- Exact numbers (XP curve, hit dice for Penitent/Hollow, charge costs, skill/perk values) settle in
  M2–M3 / M9 and are balance-tuned in M15.

### Existing engine notes (for the builders)
- **Stat-modifier formula → standard D&D `floor((stat−10)/2)`** **[DECIDED 2026-08-05]** (stat 10 = +0,
  18 = +4). Replaces the inherited oddity (`10 − ceil(|stat−30|/2)`). Legible and easy to balance;
  this is an **M1 change that ripples through all combat math** — retune balance against it (M15).
- `maxHp = hitDie + CONmod`, `armorClass = 10 + CONmod` today; armor's own value isn't used yet (§6).

---

## 5. Combat system

### Decided
- **d20 to-hit** with advantage/disadvantage, crits (nat 20), fumbles (nat 1) — **kept**.
- **Enemies now roll to hit vs your Armor Class** (fixing the "enemies always hit" gap), so armor,
  dexterity, and shields have real defensive value. **[DECIDED — new]**
- **Status effects are a full tactical layer:** implement **all 24 conditions** (the 13 currently
  inert — poison + the six stat *augments* and six *deprivations* — become real), so skills, weapons,
  relics, and enemies all apply/cure/exploit them. **[DECIDED]**
- **Elements & resistances** (the existing 7-element resistance array) become meaningful now that
  players cast elemental skills and wear gear with resistances. **[DECIDED — activated]**
- **Battle actions:** fight · **cast** (new, §"Player skills") · potion · run · **spare/release**
  (new — offered vs karma-weighted enemies; moves Nature, sometimes riskier/costlier than killing; see
  §9). **[DECIDED]**

### Player skills — the biggest current gap **[DECIDED: signature kits]**
- Players **can finally cast**. Add a `cast` action to the battle loop (today it's only
  fight/potion/run) and populate class skill pools. Skills use the existing Skill framework
  (element + up to 2 inflicted/removed conditions + charge cost).
- Depth = **signature kits** (a handful of strong abilities per class), not a sprawling spellbook.

### The 24 status conditions **[DECIDED 2026-08-05 — activation plan]**
Already functional (11): burn, freeze, electrify, bleed, stun, fracture, regeneration, sleep,
insanity, push, aired. Activate the dormant 13:
- **poison** — damage-over-time that partly ignores mitigation; cured by *antidote* (a consumable,
  §6). Scavver's bread and butter.
- **Six augment / six deprivation pairs, one per stat** — temporary (a few rounds). **Model: "mix"** —
  most are a ± stat modifier cascading through the existing mod formula (hit/damage/AC/HP/skill power),
  but a few carry a **special twist**:

  | Stat | Augment | Deprivation | Twist |
  |---|---|---|---|
  | STR | **Strong** (+dmg) | **Weak** (−dmg) | — |
  | DEX | **Quick** (+evasion) | **Slow** (−evasion) | *twist: Quick nudges initiative earlier, Slow later* |
  | CON | **Hardy** (+max-HP/AC) | **Frail** (−HP/AC) | — |
  | INT | **Sharp** (+skill power) | **Dull** (−skill power) | — |
  | WIS | **Lucid** (+resist) | **Clouded** (−resist) | *twist: Lucid sees through floor-2 illusions; Clouded is fooled* |
  | CHA | **Emboldened** (better deals) | **Cowed** (worse deals) | *twist: interacts with the sacrifice economy §11* |

- **Stacking: "mix per condition"** — DoTs (poison/bleed/burn) **stack in intensity**; buffs/deprivations
  **refresh duration** rather than stacking. Rewards the Neuromancer's *Detonate* engine (stack
  deprivations → blow them up) without runaway infinite buff-stacking.

### Open
- Whether basic attacks can miss vs only special attacks (you chose full "enemies roll to hit"; keep
  simple = everything rolls). **[settled unless you want nuance]**
- Turn/initiative model beyond the current enemy→player round order. **[OPEN]**

---

## 6. Items & inventory

### Decided
- **Full multi-slot inventory, Tibia-style** **[DECIDED]**: an equipment paperdoll plus a backpack
  container.
  - **[PROPOSAL] Slot set** (Tibia-derived): helmet, amulet/neck, two hands (weapon + shield or
    off-hand/second weapon), armor (torso), legs, boots, ring, ammo/hip, + backpack container.
    Confirm/trim this list.
- **Build-defining relic trinkets** **[DECIDED]**: passive effects and synergies that reshape a build
  (e.g. "burns spread to adjacent turns", "crits heal you", "poison ignores resistance"). The boon
  layer where run identity lives — like Hades boons / Isaac items.
  - **Organization: one big shared pool, but every relic is floor-*themed*** **[DECIDED 2026-08-05]** —
    relics carry a floor's motif (reflection F2, ash/burn F3, grace F4, void/corruption F5, grit F1)
    for coherence with the descent, but draw from a **shared pool** rather than being hard-gated to
    one floor. Variety of a big pool + thematic tie to the world.
  - **Acquisition: all sources** **[DECIDED]** — boss rewards, hidden chests, AND sacrifice-deals
    (pay a piece of yourself for a relic). Fits the ~50/50 found-vs-deals economy (§11).
  - **Relics are karma-NEUTRAL** **[DECIDED]** — pure build pieces; karma stays in combat behavior,
    sacrifice-deals, and events. (No karma-reactive relics — the seed "Halo Fragment" and "Warden's
    Verdict" below are reworked to mechanical, not karma, effects.)
  - **Seed catalog** (direction approved; expand & co-write in M6). Each pushes a clear build:
    - *F1 Undercity:* **Overclock Chip** (skip a cast → next skill costs 0), **Scrap Plating** (first
      hit each battle deals 0), **Adrenal Shunt** (below ½ HP, +2 all damage).
    - *F2 Entrance:* **Mirror Shard** (reflect 25% melee), **Doubling Glass** (first skill each battle
      fires twice), **Clear Sight** (auto-Lucid + resist).
    - *F3 Ash City:* **Ash Censer** (kills build a burn aura), **Grave of Embers** (DoTs tick twice),
      **Empty Vessel** (ash stops draining you; +1 charge/turn on floors 3+).
    - *F4 Angelic:* **Halo Fragment** (revive once/run at 25% HP, then −½ max-HP for the floor —
      mechanical cost, not karma), **Choir's Blessing** (regen at battle start), **Reliquary**
      (cleansing a condition also heals).
    - *F5 True Void:* **Hollow Heart** (spend HP to power skills at a discount + skill lifesteal),
      **Void Pact** (+50% damage, cannot heal), **Devourer's Maw** (each kill permanently steals 1
      enemy stat point).
    - *Named uniques (gear w/ effects):* **Reflection's Edge** (weapon, F2 — bonus dmg = conditions on
      target), **Ashen Crown** (helmet, F3 — +INT, Detonate hits every condition twice), **Grace-Forged
      Aegis** (amulet, F4 — start each floor with a shield; karma-neutral rework of "Warden's Verdict"),
      **Hollow Regalia** (armor, F5 — huge defense, drains 1 max-HP per floor).
- **Both authored uniques *and* rarity-scaling** **[DECIDED]**: hand-made named legendaries with
  distinct mechanical effects/procs, **plus** a rarity system (Common→Rare→Legendary) that scales
  stats and occasionally adds an effect.
- **Rich consumables** **[DECIDED]**: a real tactical item layer, not a bare potion counter. Five
  categories, seed set (expand & co-write in M6):
  - **Heals/sustain:** Void Draught (HP), Regen Salve (regeneration), Suture Kit (cure bleed + heal).
  - **Cures:** Antidote (poison), Clarity Draught (insanity/confusion → Lucid; floor-2), Cleansing Ash
    (remove all deprivations), Warding Charm (remove a curse).
  - **Buffs (self augments):** Stimpack (Strong+Quick), Ironhide Tonic (Hardy), Focus Serum (Sharp +
    restore charges).
  - **Throwables/instant-damage:** Firebomb (Pyro+burn), Cryo Grenade (Cryo+freeze), Shock Charge
    (Electro+stun), Vial of Rot (poison+bleed) — a damage option for melee builds.
  - **Utility/tools:** Smoke Vial (guaranteed flee), Lodestone (reroll a draft/offer), Ash-Mask (negate
    floor-3 ash-drain), Static Flare (reveal/destroy illusions; floor-2), Echo Bell (reveal a
    sacrifice-deal's true cost first).
  - **Using a consumable costs your turn** (a battle action, like the current potion) — real
    opportunity cost. **[DECIDED]**
  - **Scarcity: meaningful but not scarce** — regularly found/used, a normal part of the kit (not a
    rare treat). **[DECIDED]** Acquired via found loot + sacrifice-deals (§11).
- **Loot comes from drops + chests + sacrifice-deals** **[DECIDED — corrected 2026-08-25]**: enemies
  drop loot, floors hide chests/caches, and an altar/stranger offers **deals paid for with a part of
  yourself**. **There are no shops and no currency** — an earlier draft of this line said "shops sell
  curated stock", which §11 of this same document overruled the same day (*"No currency. No coin.
  Anywhere. Ever."*) and which the code implemented. `src/game/shop.ts` is deleted.
- **Armor stats finally apply** — activate the existing `dexCap` / `strReq` fields and use armor's own
  value in the AC/defense math (today only `10 + CONmod` is used). **[DECIDED — new]**

### Open / to brainstorm
- Backpack capacity & weight — does Tibia-style **weight/capacity** matter, or just slot count?
  **[OPEN]**
- Two-handed vs weapon+shield trade-offs; dual-wield? **[OPEN]**
- **[PROPOSAL — relic/unique ideas]** to seed the brainstorm: *Mirror Shard* (reflect a % of a hit
  back — floor 2), *Ash Censer* (each kill stacks a burn aura — floor 3), *Halo Fragment* (auto-revive
  once, but marks you — floor 4), *Hollow Heart* (spend HP to power skills — floor 5). Themed drops
  tie loot to the floors.

---

## 7. Karma / "Nature" system **[DECIDED — core pillar]**

- **Input: everything you do.** Who and what you kill (some enemy families carry moral weight),
  mercy vs slaughter, greed vs restraint, item use, exploration, narrative choices — the whole pattern
  of play is read into your nature. **[DECIDED]**
- **Effect: mostly world & tone mid-run; mechanical teeth at the gate & ending.** **[DECIDED]** Mid-run,
  karma mainly reshapes *what you encounter* (enemies, events, what the Void offers, NPC/narrator
  stance, prices) and the narrator's voice, with only *light* mechanical touches (small blessings/
  curses). The **big mechanical consequences are the floor-4 gate and the ending** (§8) — this keeps
  mid-run balance clean while the pillar is still felt everywhere.
- **Visibility: ambiguous hints only.** No meter, no number, ever. The narrator's tone, the world's
  reactions, and what the Void shows you are the only feedback. **[DECIDED]** — this is the concrete
  expression of the "subtle theme" pillar.
- **Endings: two macro-paths, each a blended spectrum.** The floor-4 gate (§8) splits runs into
  **ascension** (grace, ends at floor 4) and **damnation** (cast down, ends at floor 5 after the final
  boss). *Within* each path the ending still blends analog-style on where your nature landed — the LLM
  narrator renders the exact shade from the hidden state vector, so it's not a fixed menu. **[DECIDED]**
- **Nature is a vector of FOUR bipolar axes** **[DECIDED 2026-08-05]**, each with clear inputs and a
  class/floor resonance:
  - **mercy ↔ cruelty** — cruelty: slaughtering the helpless, finishing the downed, killing
    karma-weighted Feelings/Sins; mercy: sparing, releasing, clean ends. *(Enforcer; floor 3)*
  - **restraint ↔ greed** — greed: looting everything, stealing, hoarding, taking tempted loot;
    restraint: taking only what's needed, leaving offerings. *(Scavver; floor 1)*
  - **reverence ↔ desecration** — desecration: attacking the sacred, looting the holy, smashing
    shrines; reverence: honoring the dead, restraint at floor 4, offerings. *(Penitent; floor 4)*
  - **clarity ↔ delusion** — delusion: giving in to distortion, trusting the false, embracing the
    whispers; clarity: seeing through illusions (floor-2 WIS checks), resisting the Void.
    *(Neuromancer; floor 2)*
- **The floor-4 gate is a WEIGHTED SUM of all four axes** **[DECIDED]** (not reverence alone): your
  whole nature is judged. reverence↔desecration carries the **highest weight** (it *is* the sacred
  floor), but maxed cruelty/greed/delusion also pull toward the fall. Weights are tunable (M10/M15).
  **Consequence:** because the gate reads all axes and the player never sees numbers, the mid-run
  **ambiguous cues must faithfully reflect the *aggregate* nature**, not any single axis — the cues are
  the player's only compass.
- **Karma resets each run; the Void remembers in *flavor only*.** **[DECIDED]** The four-axis vector is
  fresh every run (fits unlocks-only + tough-but-fair balance and keeps runs self-contained). A
  **light, non-mechanical** cross-run memory lets the narrator faintly reference who you were before —
  haunting, never a power source. *(Persisted separately from the run save; see §12 store.)*
- **Karma is live from floor 1 — floor 4 is the reckoning.** **[DECIDED]** The nature state
  accumulates across the *whole* run (every floor, every act), quietly shaping mid-run effects the
  entire time. **Floor 4 (the Angelic Underground) is where that accumulated karma becomes decisive.**
  Floor-4 decisions are **amplified by the karma you already carry**: a run of accumulated reverence
  can *save* you from being cast down even if you slip on floor 4, while accumulated desecration can
  *doom* you almost regardless of how you behave there. The floor-4 outcome (grace vs. cast-down into
  floor 5, §8) is therefore a function of **(karma carried in) × (floor-4 choices)**, never floor-4
  choices alone. This makes the whole descent matter and pays it off at the gate.
- **Determinism requirement:** karma state is plain serializable data in game state; all karma
  changes flow through the engine (never the LLM), so runs remain reproducible from seed + inputs.

---

## 8. The five floors **[DECIDED 2026-08-05 — details refine in M10/M12]**

The descent is **stages of an extraction**: your recorded life is being read out of you while you are
awake, and the floors are the stages of that reading. See **`docs/WORLD.md` §0c** — it supersedes the
older framing of "stages into the mind", which was written before the mechanism existed. The stages
are **before → fracture → grief → judgement → absence**.

Each floor has its own tone, enemy families, a **signature mechanic** (the per-floor twist), and a
**boss** (a distinct encounter with unique mechanics — an LLM agent with run-memory, built in M12).

### The floor-4 verdict weights floor-4 karma heavier **[DECIDED 2026-08-25]**

`computeVerdict` currently takes the carried karma vector alone, so floor 4 is a **scoreboard for the
four floors before it** rather than a crucible. Fix: **karma earned on floor 4 counts double** (or
some N > 1) relative to karma carried in.

- The crucible can genuinely **redeem or damn you** regardless of how you arrived, which is what a
  reckoning has to be able to do.
- It makes the floor-gated temptations above **mechanically decisive** rather than flavour.
- It needs **no new state and no save change** — only weighted deltas while `state.act === 4`.

Rejected: a discrete named floor-4 choice set tracked separately. More memorable (the player could
point at exactly what damned them) but it means new state, new encounter phases, new save fields, and
it re-opens M15. Recorded as the richer option if floor 4 is ever expanded.

### Every content schema gains description and flavour **[DECIDED 2026-08-25]**

Items, skills, conditions and perks each gain an optional **`description`** (what it does, plainly)
and **`flavour`** (prose, optional). Both optional, so nothing existing breaks.

**This is currently blocking all content authoring** — there is literally nowhere to put the words.
It is cheap now and a schema migration once the item UI exists, which is why the audit ranks it
Tier 1 despite looking like a chore.

### Equip and unequip become engine inputs **[DECIDED 2026-08-25]**

**Equipment changes must go through `step`.** Two new `GameInput` variants (`equip` / `unequip`)
replace the render layer calling into state directly (`src/desktop/view-model.ts`, `game.ts`).

**Why this is not cosmetic:**
- It restores **reproducibility from `seed + inputs`** — `CLAUDE.md` principle 1. Today a run cannot
  be replayed, because a load-bearing state change happens outside the engine's single path.
- **It invalidates the current balance numbers, and that is the point.** `docs/BALANCE-REPORT.md`
  states its own caveat: the simulation *"fights with starting gear the whole way — found loot lands
  in the backpack unused"*, because `step` has no equip action. **The headline 32.9% win rate
  describes a character who never equips anything it finds.** Once the sim can equip, the real
  number is likely higher — possibly much higher.
- Replay and determinism tests cannot currently cover the equipment path at all.

**Therefore the balance pass must be re-run as part of, or immediately after, this change** — and
`BALANCE-REPORT.md` is stale from the moment it lands. Cost today: one union member. Cost after the
three remaining UI units build on the current view-model: a three-unit rewrite.

### How floor mechanics are implemented **[DECIDED 2026-08-25]**

> **None of the five existed in code as of the 2026-08-25 audit** (`docs/SCOPE-AUDIT.md` §3.1). This
> is how they get built, and **nothing else should be built on the battle loop until the hook
> exists** — retrofitting it is the most expensive change available in this project.

**A hybrid, chosen deliberately over a single mechanism:**

- **Simple modifiers reuse the existing effect/trigger pipeline** (`src/game/relicEffects.ts`) —
  already pure, RNG-free and tested. A floor gets an effect list in data, and the battle loop fires
  the same named triggers relics already use. Adding a numeric floor modifier becomes a **data
  edit**, not engine surgery. Floor 3's dampened healing and resource bleed go here.
- **Mechanics that restructure the encounter get bespoke code**, because a flat action list cannot
  express them honestly. Floor 2's illusory enemies and floor 5's kit corruption go here.

The cost of the hybrid is two places to look; the cost of forcing everything into one is either a
data format that cannot express illusions, or bespoke code for things that are just a number.

### Per-floor rulings **[DECIDED 2026-08-25]**

**Floor 2 — illusions are literal.** A seeded fraction of floor-2 encounters spawn an **illusory
enemy**. Attacking it wastes the turn and deals nothing. A **WIS check** — a Study/Discern action, or
passively each round — reveals it. This is the design as written, and it does two things nothing else
currently does: it makes **WIS matter for the first time**, and it gives the **clarity↔delusion karma
axis its only trigger** (the audit found that axis can currently never move, §1.2). Seeing through an
illusion feeds `seeThroughIllusion`, which already exists.

**Floor 3 — attrition only; the endlessness is prose, not structure.** Dampened healing plus a
per-encounter resource bleed, both through the effect system. **No variable floor length and no
find-the-exit condition** — those would change act progression, the save format, and every number
M15 tuned. The *endless grey city* is carried by the narration and the backdrop, which is cheaper and
likelier to work: endlessness is hard to make compelling and easy to make tedious.

**Floor 4 — temptation is gated by the FLOOR, not by karma.** The tempting deal pool is offered to
**everyone who reaches floor 4**, regardless of how they have played. That is the point of a
crucible: *the reverent player must be tempted, or reverence has cost them nothing.* Carried karma
may still weight **which** temptation appears — not **whether** one does.

> Implementation note: `buildDeal(karma, _act, rng)` (`src/game/deal.ts`) already takes the act and
> explicitly ignores it — the parameter is named `_act` with a comment saying the placeholder tables
> do not use it. The hook exists; it just needs reading.

**Floor 5 — your skills warp.** Each of your own skills gains a corrupted variant on floor 5: costs
shift, damage types change, something is gained and something taken. **You keep your kit and it
stops being reliably yours** — which is precisely what *absence* means at this stage. It also makes
the Hollow Self fight land, since it is wielding that same warped kit back at you.

This is **bespoke code**, not an effect list, per the hybrid rule above — it restructures skill
resolution rather than modifying a number. Note that floor 5 is only reached by players who were
**cast down**, so it is the least-seen content in the game; weight the engineering accordingly.

| # | Floor | Tone / imagery | Enemies | Signature mechanic | Boss |
|---|---|---|---|---|---|
| 1 | **The Undercity** | grounded neo-noir; rain, neon, grime — the last "real" place | Gangers, Security Drones (Mech), Mutant Strays (Beast), Cyber-Enforcers | *The world is still solid.* No distortion; teaches the base rules and takes your **first karma readings** | **Undercity Kingpin** — the mission's literal target; the last purely human enemy. His end pulls you into the Void |
| 2 | **Entrance to the Void** | blinding white, red reflections, distortion — onset of madness | Reflections, Mirror-Selves, Distortions, Static-wraiths | *You can't trust what you see.* Illusory enemies (striking them wastes a turn); **WIS checks** to tell real from false; Mirror-Selves copy your kit. The **clarity↔delusion** floor | **The Reflection** — a mirror of you that fights with your own class's abilities |
| 3 | **The Ash City** | endless grey city, falling ash, silence — emptiness of madness | **Feelings** (Grief, Rage, Dread, Numbness) and the **Seven Sins** as named elites — all **karma-weighted** | *The ash drains you.* Dampened healing, bleeding resources, an **endless** city until you find the way down — attrition mirroring emptiness | **Your most-indulged Sin/Feeling made flesh** — chosen by your karma, so it's a different, personal fight each run |
| 4 | **The Angelic Underground** | luminous, sacred, beautiful — the moral crucible | Angels, Choir, Guardians (Ancestral), the Judged — fighting them can *be* desecration | *The reckoning.* Every irreversible choice is tracked and **amplified by carried karma** (§7); the floor tempts you with loot you can only take by desecrating | **The Warden/Judge** — an angel whose verdict is grace or cast-down, decided by carried karma × your floor-4 choices |
| 5 | **The True Void** | black, dark, hellish — the bottom (**only the fallen reach it**) | Demons, Void-horrors (Nightmare), the Unmade, **Echoes of you** (past kills return) | *The Void corrupts your own kit* — skills warp; carried karma directly empowers or punishes you | **Your own Hollow self** — a corrupted mirror wielding your kit and your sins; the culmination of the descent (ties to the Hollow class unlock) |

### The floor-4 → floor-5 gate & the two ending paths **[DECIDED]**
- **Grace ends at floor 4.** A reverent run (carried reverence × floor-4 restraint) earns an
  **ascension ending** at the Angelic Underground and **stops there** — the True Void is *only for the
  damned.*
- **Desecration descends to floor 5.** A fallen run (carried desecration × floor-4 transgression) is
  **cast down** into the True Void — the hardest content, the **final boss**, and the dark ending.
- **Consequences to design around (flagged for balance/meta):**
  - Run length is **asymmetric** (grace ≈ 4 floors, fallen ≈ 5). Grace endings must feel *earned and
    complete*, never like "missing" floor 5.
  - The **final boss and the deepest content live on the desecration path** — a bold, intentional
    choice: the Void's heart is reached only by falling. The **blended-spectrum ending** (§7) still
    varies *within* each of the two macro-paths (ascension has its shades; damnation has its shades).
  - Meta-unlocks reward **both** paths: **Penitent** unlocks via the grace ending, **Hollow** via the
    True-Void path (§12) — so mastery pulls players to experience both.

### Boss design principles **[DECIDED 2026-08-05]**
Each boss is an **LLM agent with run-memory** (M12), with a unique mechanic (not stat-scaling):
- **Bosses are combat climaxes; karma lives in regular play** (spare/release, sacrifice deals, events)
  — bosses do **not** offer new moral forks.
- **The floor-4 Warden is the one exception:** a **verdict, not always a fight.** It offers no new
  choice — it *reads the karma you already carry* (weighted sum, §7). Reverence → a trial that resolves
  into **grace (ascension ending)**, possibly without combat; desecration → a punishing executioner and
  the **fall to floor 5**, win or lose. This is where accumulated nature is read aloud.
- **F1 Kingpin** (adds + pressure), **F2 Reflection** (fights with your own kit; adapts to your
  build), **F3 your indulged Sin/Feeling** (karma-*shaped*: which one & how strong reflect your run;
  fought under ash-attrition), **F5 your Hollow self** (corruption climax — your warped kit + Echoes of
  your kills; the ending shade flows from your nature, not a final button).

### Still open (later passes)
- The exact **grace vs. cast-down thresholds** (weighted-axis tuning) — M10/M15.
- Full **boss mechanics/dialogue** and names — designed & co-written in M12.

---

## 9. Enemies & bosses

### Decided
- **24 families, themed per floor** (the original 6 — Beast/Humanoid/Mech/Magical/Nightmare/Ancestral
  — are absorbed as broad tags). Each has a genuinely different behavior hook. **[DECIDED 2026-08-05]**
- **A spare / release action** in combat for karma-weighted enemies — a real moral/tactical choice
  (sometimes riskier or costlier than killing) that moves the Nature axes. **[DECIDED]** *(New battle
  action alongside fight/cast/potion/run — see §5.)*
- **Light elite-affix layer:** a handful of modifiers create elite variants of any family — e.g.
  *Ravenous* (+damage), *Warped* (+illusion/insanity), *Ancient* (+stats), *Blessed/Cursed*
  (karma-reactive). **[DECIDED]** Data-driven; the original's unbuilt name-affixes, realized.
- Enemies roll to hit (§5); enemies use the same skill/condition framework players do.

### The 24-family roster **[DECIDED — names/behaviors refine in M8]**
⚖ = karma-weighted (kill/spare shifts Nature). Behavior hook in parentheses.

- **Floor 1 · Undercity** — **Gangers** ⚖ (swarm), **Security Drones** (Mech; ranged/armored, amoral),
  **Mutant Strays** (Beast; fast, poison), **Cyber-Enforcers** (tanky heavies), **Fixers** ⚖
  (near-civilians; rob or spare — greed/mercy).
- **Floor 2 · Entrance to the Void** — **Reflections** (some illusory; striking a fake wastes a turn),
  **Mirror-Selves** (copy your kit), **Distortions** (Magical; confusion/insanity), **Static-wraiths**
  (high evasion, Electro).
- **Floor 3 · Ash City** — **Grief** (saps resources/healing), **Rage** (grows when hurt), **Dread**
  (fear/weak), **Numbness** (deadens damage/senses), **The Seven Sins** ⚖⚖ (family of 7 named elites;
  the most-indulged becomes the floor-3 boss), **Ash-wraiths** (endless weak filler; attrition).
- **Floor 4 · Angelic Underground** — **Choir** (Magical; buff angels/debuff you), **Guardians**
  (Ancestral; block loot — fighting them is desecration), **The Judged** ⚖⚖ (non-hostile souls; spare
  = reverence, kill = desecration), **Seraph-wardens** (elites that punish desecration).
- **Floor 5 · True Void** — **Demons** (Pyro/corruption), **Void-horrors** (Nightmare; insanity, warp
  your kit), **The Unmade** (drain/negate abilities), **Echoes of You** ⚖ (your past kills/selves,
  wielding your abilities), **The Hollowed** (former fallen descenders — what you may become).

### Open
- Enemy scaling: adopt the Java's unused CR formula, or a simpler per-floor power budget? **[OPEN → M8]**
- Exact affix list + which families each can roll on. **[OPEN → M8]**

---

## 10. The LLM narration layer

### Decided
- **Role: narrate ONLY. The engine writes the choices.** **[DECIDED 2026-08-25 — REVERSES the
  earlier decision]** The engine emits the legal action set and the UI renders it; the model writes
  prose and nothing else.

  **Why this reversed.** The original plan had the narrator authoring the choice buttons,
  grammar-constrained to legal actions. Three things killed it: it adds a **model round-trip before
  every menu render**, which is exactly what `UI-DESIGN.md` §2's "bookends only, fast rounds"
  decision exists to avoid; it makes the action bar a **variable-shape surface**, which is very hard
  to design a real battle screen against; and it pulls against **principle 5, engine-authoritative**
  (`CLAUDE.md`) — if the engine must validate every proposed action anyway, having the model propose
  them buys texture at the cost of predictability.

  **Consequence: M11 shrinks substantially.** Grammar-constrained choices, the engine tool-registry
  and free-text-to-tool mapping are **all dropped**. What remains is narration quality: per-floor
  voices, beat significance (which beats deserve prose at all), boss agents with run-memory, and
  karma reaching the prompt.

  **What was given up, honestly:** flavoured action labels — *"Drive the baton through its throat"*
  instead of *"Fight"* — would have been genuinely characterful. If that is ever wanted back, the
  cheap version is the model rewriting **labels** over an engine-fixed action set, which keeps the
  shape stable. Recorded so the option is not lost.
- **Flavor systems: per-floor narrator prompts + boss agents with run-memory.** Each floor has its
  own voice/tone/imagery; each of the 5 bosses is an agent that remembers what you did. Regular
  enemies use lighter templates (not full personality cards, for now). **[DECIDED]**
- **Local, offline, packaged desktop** (Electron + node-llama-cpp, GGUF 3–4B, grammar-constrained).
  See ROADMAP v2 for the model/packaging detail. **[DECIDED — inherited]**
- **Engine-authoritative & headlessly testable** against a fake model; determinism preserved. **[DECIDED]**

### Notes
- The narrator receives **floor context + hidden karma state** and colors everything accordingly —
  this is how the "ambiguous hints" for karma (§7) and the "subtle theme" (§2) are delivered.
- Current `src/llm/narrate.ts` is a pure prompt-builder stub; real model integration, streaming,
  grammar-constrained choices, the engine tool-registry, floor prompts, and boss agents are all still
  to build (ROADMAP N-series).

---

## 11. Economy — a pure sacrifice economy **[DECIDED 2026-08-05]**

- **No currency. No coin. Anywhere. Ever.** Gold is **removed** from the game. Every gain is paid for
  with *a part of yourself*. The world was always predatory — even the Undercity takes, it just never
  called it money.
- **You pay with body, self, and morality.** The Void's strangers/altars offer power for: **HP**,
  **max-HP**, a **stat point**, **skill charges**, a **relic**, or a **karma-shifting act** (desecrate
  something for a reward). The morality-cost deals feed the Nature pillar directly (§7) — the tempting
  cursed loot of floor 4 is exactly this.
- **Balanced with found loot.** Roughly **half** your power comes from *found* loot (drops + chests,
  no self-cost) and half from *sacrifice-deals* — so bleeding yourself is always a **choice**, never
  the only path to keep up. This is the load-bearing balance lever that keeps a pure-sacrifice economy
  **tough but fair** (§2).
- **Offers are karma-flavored:** the Void reads your Nature and tempts accordingly (the greedy see more
  cursed riches; the reverent are offered grace; desecrators get dark power *cheaply* — a trap).
- The old "mysterious stranger" one-offer shop and the "shop via Character Info" quirk are **replaced**
  by a proper **sacrifice-deal encounter** (altar/stranger).
- **Consequences to build around (flagged for M1/M7/M15):**
  - **Gold removal touches state, victory rewards, and shop code.** Victory rewards become **XP +
    loot** (no gold); the `gold` field is retired or repurposed. Save migration handles old shape.
  - Pure-sacrifice is inherently punishing → **balance is critical**: sacrifice value must be strong
    and clearly worth it, deals must be optional, and the found-loot half must sustain a no-sacrifice
    run at the intended difficulty (proven by the M15 simulation).
  - Services that were gold sinks (rest/heal/cleanse/identify/reroll) become **sacrifice-priced** too,
    or free-but-limited.

---

## 12. Meta-progression **[DECIDED: unlocks only, mastery-based]**

- **Unlocks only** — no permanent power creep. Each run starts at the same base power; you win on
  skill. **[DECIDED]**
- **Triggered by a PATH + MASTERY mix** **[DECIDED 2026-08-05]** — unlocks come from *both* natural
  progression (reach a floor, beat a boss) *and* mastery feats (win as X, walk a karma path). Rewards
  persistence and skill. Concretely:
  - **Progression unlocks** (easy/early): **Neuromancer** and **Scavver** surface within the first
    runs via simple feats (e.g. reach floor 2 / beat the Undercity Kingpin).
  - **Path unlocks** (deep): **Penitent** via the floor-4 grace ending; **Hollow** via the floor-5 /
    desecration path — so mastery pulls players to experience both endings (§8).
  - **Class unlock feats** (seed): Neuromancer = beat the Undercity Kingpin; Scavver = spare 3
    karma-weighted enemies in a run; Penitent = reach the floor-4 grace ending; Hollow = be cast down
    and beat your Hollow self.
  - **Skill/perk feats** (mastery, broaden the draft pool): e.g. Detonate 5 conditions in one hit →
    Neuromancer skill; win a battle unhurt → defensive perk; get a kill with each DoT → a DoT relic;
    3-crit streak → crit perk.
  - **Relic feats:** first time reaching each floor → that floor's relics enter the pool; first
    sacrifice-deal → deal-themed relics; beat a floor boss → a themed relic. Full list in M13.
- **The bestiary unlocks GRADUALLY** **[DECIDED 2026-08-05]** — early runs face a curated subset;
  new families and elite affixes unlock as you progress (complete a run → affixes appear; beat a
  floor's boss → tougher variants join its pool). This doubles as the **onboarding + difficulty ramp**
  (a soft new-player curve) — so M8's encounter generator reads the unlock store and draws only from
  **unlocked** families.
- **Pacing: front-load essentials, long tail** **[DECIDED]** — core classes (Neuromancer/Scavver) and
  systems unlock within the first few runs; deep content (Penitent, Hollow, rare relics, the full
  bestiary) rewards many runs. Fast onboarding, lasting chase.
- **Persistent unlock store** (separate from the run save; also holds the flavor-only cross-run karma
  memory, §7). No power creep — base power is constant. **[DECIDED]**

---

## 13. Theme handling **[DECIDED]**

- The psychosis theme is **subtle and ambiguous** — never named, never metered. It lives in the
  narrator's voice, the floors' descent-into-the-mind arc, the sins/feelings enemies of floor 3, the
  moral crucible of floor 4, and the hidden karma that shapes it all. The player should *feel* it and
  be unable to point at the "sanity mechanic," because there isn't one.
- The author has **final voice on all shipped narrative text** (co-written floor by floor with Claude
  drafting, per ROADMAP). **[DECIDED — inherited]**

---

## 14. What exists vs. what to build (scope map)

| System | Today | Target | Gap size |
|---|---|---|---|
| Core dice combat | ✅ works | keep; add enemy to-hit rolls, `cast` action | small |
| Classes | 2 stubs (hit die + gear only) | ~3–5 distinct classes w/ signature kits | **large** |
| In-run leveling | 4 act-gated | frequent level-up choices | medium |
| Player skills | none (players can't cast) | signature kits per class | **large** |
| Status conditions | 11 of 24 work | all 24 as a tactical layer | medium |
| Enemy variety | only "Beast" spawns | ~24 families + affixes | **large** |
| Bosses | 1 plain scaled enemy | 5 unique bosses, each an LLM agent | **large** |
| Inventory | swap 1 weapon + 1 armor | full Tibia-style paperdoll + backpack | **large** |
| Trinkets/relics | none | build-defining relic layer | **large** |
| Unique items | rarity cosmetic | authored uniques + rarity-scaling | **large** |
| Consumables | potion counter | rich consumable layer | medium |
| Loot sourcing | shop only | drops + chests + sacrifice-deals (~half found) | medium |
| Karma / Nature | none | multi-axis hidden pillar, blended endings | **large** |
| Economy | flat gold, 1-offer shop | **pure sacrifice economy — gold removed** | **large** |
| Spare/release action | none | new combat action for karma-weighted enemies | small |
| Meta-progression | none | unlock-only, feat-based | medium |
| Floors/story prose | empty bodies | 5 authored floors + arcs | **large** |
| LLM layer | prompt-builder stub | narrate+choices, floor prompts, boss agents | **large** |
| Balance | possibly unwinnable | tough-but-fair, sim-verified | medium |

---

## 15. Decision status

**The design brainstorm is essentially complete** (2026-08-05). All vision + system decisions are
locked above:
- ✅ Classes (roster, hybrid depth, 1 start + 4 unlock, thematic karma lean)
- ✅ The five floors (tone/enemies/mechanic/boss each; grace-ends-at-4 vs desecration-to-5 routing)
- ✅ Karma (four axes, weighted-sum gate, per-run reset + flavor memory, world-and-tone mid-run)
- ✅ Enemies (24-family roster, spare/release action, light affixes)
- ✅ Economy (pure sacrifice, gold removed, ~50/50 with found loot)
- ✅ Status effects (activate all 24; "mix" model; "mix per condition" stacking)
- ✅ Stat-mod formula (standard D&D), relics (big floor-themed pool), unlocks (path + mastery mix)

**Remaining items are milestone-time DETAIL/CONTENT, not open vision** — decided within each
milestone's plan:
- **Content authoring** (co-written): floor prose, boss dialogue, the relic/unique catalog, the full
  feat list, consumable catalog — M6/M8/M10/M12/M13, author's final voice.
- **Boss mechanics** per floor — M12. **Grace/cast-down thresholds** + **balance targets** (needs your
  difficulty-feel input) — M10/M15. **Slot list** confirm + **turn/initiative** model — M4/M5.
- **Enemy scaling** (CR formula vs per-floor budget) + **affix list** — M8.

---

## 16. Build-order principle (how we'll actually make this)

Per `CLAUDE.md` and `docs/PRINCIPLES.md`: **think long-term, build additively, and run every game-code
change through the agentic loop** (plan → build → test in a worktree). This scope is large, so we
sequence it — foundational data models first (item/inventory schema, skill/condition activation, karma
state), then systems that depend on them (classes, loot, enemies, bosses), then the LLM layer on top.
Docs like this one are exempt from the loop; the code that implements them is not.

> **Recalibration note for `CLAUDE.md`:** the top-line description there ("an LLM-driven narrative
> RPG") predates this interview. The game is now **mechanics-first with an LLM narrator**. Worth a
> one-line tweak to the CLAUDE.md summary when convenient (flagged, not silently changed — that file
> is yours).

---

## 14. Decisions from the 2026-08-26 design interview

Closing the Tier-2 items in `docs/SCOPE-AUDIT.md`. Everything here is **[DECIDED 2026-08-26]**.

### 14.1 Loot: relics are bought with yourself, never found

**Relics come ONLY from sacrifice-deals.** They are never dropped, never in a chest, never given.
The only way to gain a build-defining relic is to trade a piece of yourself for it at the altar.

**Why this over spreading them across every source:** it makes your build *literally made of what you
gave up*, and it wires the relic system — the deepest build system in the game — directly into the
karma pillar rather than leaving them as parallel systems that never touch. A run's identity becomes
a record of its costs.

**Accepted trade-offs, stated so nobody re-litigates them later:**
- Relics become **rarer and more predictable** than a scattered drop table would make them.
- **Chests lose their best prize** and need to be worth opening for another reason (see below).
- Deal frequency now controls relic pacing, so the two must be tuned together.

**The gap this leaves — [OPEN, needs the author].** The ruling covers relics. It does not say where
**19 consumables** and **4 uniques** come from, and they are equally unreachable today. The natural
completion, *proposed not decided*:

| Source | Content |
|---|---|
| **Sacrifice-deals** | **Relics** (locked above), and possibly uniques |
| Enemy drops | Ordinary gear + **consumables** — they are consumed, so they need volume |
| Chests | Consumables, gear, and whatever replaces the relic as the reason to open one |
| Bosses | **Uniques** — rare, memorable, tied to a specific fight |

**A hard rule regardless of the answer:** *nothing ships that is not in at least one pool.* Add a
test asserting **every content id is reachable** from some source, so this class of bug cannot recur.

### 14.2 Karma bends the world, never the numbers

Karma gains real mid-run expression — it currently does nothing until the floor-4 gate — but **only
through the world, never through the player's stats.**

**Karma DOES:** weight which enemy families you draw · shape which deals the altar offers you ·
colour the narrator's tone.
**Karma NEVER:** buff or debuff you · appear as a number, a bar, or any visible readout.

**Why not mechanical scaling:** the design's hardest rule is that the theme is *felt and never
metered* (§13) — *"the player should feel it and be unable to point at the 'sanity mechanic', because
there isn't one."* A karma-driven stat bonus is a sanity bar with extra steps: the moment it changes a
number the player can feel, it becomes a system to optimise rather than a mirror. Bending the world
keeps it unmeterable and un-gameable, and needs no new combat maths, so balance barely moves.

> **Known tension:** floor 5's design line says *"carried karma directly empowers or punishes you"*,
> which is mechanical scaling. **Floor 5 is the one exception** — by then you have been cast down,
> the Void is corrupting your kit anyway (§8), and there is no longer anything to hide.

Also fixed here: karma must be **clamped**, must **reach the LLM prompt** (today `buildNarrationPrompt`
reads only act and place), and its **cross-run memory must be read** — it is currently written and
never consumed.

### 14.3 Finish the three half-wired progression systems

All three have the expensive part built and only the wiring missing. **Highest gameplay-per-hour
work remaining.**

1. **Two of three class twists are no-ops.** The class-select screen already promises them.
2. **Blessed and Cursed affixes can never appear** — two of five elite modifiers are unreachable.
3. **The unlock store accumulates relics and skills the run never reads.** Wire them in.

### 14.4 Rename conditions to the design vocabulary

The code's condition ids and display names diverge from this document's vocabulary. **Align the code
to the design**, inside `engine-foundations` (#1), while it is a rename plus test updates.

After the battle screen renders condition chips, the log names them, and prose references them, the
same change touches four more surfaces — and the design vocabulary is the one authored prose will use.

### 14.5 One difficulty **[DECIDED 2026-08-26]**

**No difficulty modes. No assist toggles. No easy mode.** The game is what it is, and that is
**stated up front on the store page** rather than discovered after a purchase.

**Why:** it matches the locked "tough but fair, mastery-driven" pillar (§2), it keeps every balance
number meaningful (one curve to tune, one set of numbers that describe the real game), and **the
unlock system already is the accessibility ramp** — a new player is not handed the whole roster at
once, and the gradual bestiary reveal (§12) is an onboarding and difficulty curve in one.

**The accepted cost, stated plainly so it is never mistaken for an oversight:** some players will
bounce off permanently, including some who came for the subject matter rather than the combat. That
is a deliberate trade, not an accident.

An ascension-style ladder remains a **post-launch** idea (§3), not a launch feature.

### 14.6 Equipment: hands and capacity **[DECIDED 2026-08-26]**

**Dual-wielding is in.** Three configurations, not two:

| Configuration | Effect |
|---|---|
| One-handed **+ off-hand** (shield/focus) | The defensive build |
| One-handed **+ one-handed** | **Dual-wield** — suits the Scavver's tempo/exposure identity |
| **Two-handed** | Occupies both hands; equipping one **auto-unequips** the off-hand |

**Scope this adds, stated plainly:** dual-wield needs its **own attack rules** (does the second
weapon swing every round? at a penalty? does it only apply on-hit effects?) and it is a **real
balance surface** — it must be re-measured in the balance re-run, not assumed. The two-handed
conflict also needs a clear UI state so the player understands *why* the off-hand is unavailable.

**Backpack: a fixed slot count, no weight.** The bag holds N items; full is full. Readable at a
glance, draws as a grid, and the interesting decision is **what to drop** when something better falls
late in a run. Weight systems add arithmetic the player has to do in their head without adding much
choice. The exact N (12? 16?) is a balance number, settled with the slot brainstorm below.

> **STILL OPEN — the equipment slot set.** The author's direction is to **trim the Tibia list to a
> leaner set**, and to **brainstorm it** rather than pick from a menu. Until that lands,
> `screens-restyle` (#8) cannot draw the paperdoll. See `docs/FINDINGS.md` B2.

### 14.7 The equipment slot set — seven **[DECIDED 2026-08-26]**

Trimmed from the nine-slot Tibia proposal. **Cut: amulet, ring, legs, back.**

```
              HEAD
   HAND       BODY       HAND        TRINKET
              FEET                   TRINKET
```

| Slot | Notes |
|---|---|
| **Head** | |
| **Body** | |
| **Hand** ×2 | Shield/focus, dual-wield, or a two-hander that blocks the second (§14.6) |
| **Feet** | |
| **Trinket** ×2 | **Where relics go — you wear two** |

**Why seven rather than six or nine.** Nine made the player wear most of what they found rather than
choose; five left too few places for ordinary loot to be interesting. Seven keeps every slot with a
clear identity, and the second trinket is the deliberate part: **relic *combinations* become the
build**, and more of the fifteen relics are seen per run.

**The accepted trade:** with two trinket slots each individual relic choice costs less than it would
with one. That is the price of combinatorial builds, and it is worth it — but it means **relic power
must be tuned for pairs, not singles**, and some pairings will need watching in the balance pass.

**Relics are equipment.** A relic is bought with a piece of yourself at the altar (§14.1) *and* then
competes for one of two trinket slots — **two decisions per relic, not one**. What you sacrificed to
get it, and whether it earns a slot over what you already wear. Relics you own but do not wear stay
in the bag as future options, so swapping mid-run is a real tactical choice.

### 14.8 Initiative, loot sources, and the model tier **[DECIDED 2026-08-26]**

**No initiative system. The round order stays fixed** — you act, then it acts, always. **Quick and
Slow are redefined** so they work without one: acting first *within* the round, gaining an extra
action, acting last, or losing the round entirely. Exact effects settle in the floor-mechanics unit.

*Why:* an initiative system is a real mechanic to build, a real balance surface, and a turn queue the
battle screen would have to render in competition with everything else on the frame. Redefining the
two conditions costs nothing, **makes them meaningful instead of inert** (`initiativeOrderTwist`
currently returns 0, a no-op left over from M4), and fits the beat-by-beat *exchange* the JRPG frame
already implies. This closes `GAME-DESIGN.md` §5's long-standing `[OPEN]`.

**Loot sources, completing §14.1:**

| Source | Content |
|---|---|
| **Sacrifice-deals** | **Relics only** (§14.1) |
| **Enemy drops + chests** | **Consumables** — they are spent, so they need volume — plus ordinary gear |
| **Any enemy, rarely** | **Uniques** — a rare drop from anything, not tied to bosses |

> **The accepted cost of random uniques:** with only **four** uniques in the game, a rare trickle
> means **most runs will see none**. That is the trade for the unexpected-orange thrill. If it proves
> too thin in play, the cheapest fixes are more uniques or a pity/guarantee rule — **not** moving them
> to bosses, which was the rejected option.

**Model tier: 4B only — and the minimum spec rises to require a GPU.** The N1 spike recommended
shipping a 1.7B fallback and auto-selecting; that is **rejected**. One model, one narration quality,
far less to build, test and package.

> **This changes a stated commitment.** `CLAUDE.md` said min spec was "typical laptop, **no GPU**" —
> it is not any more. On a no-GPU machine the 4B measured **7.6 tok/s and ~5 s to first token**
> against the **89 tok/s / 0.18 s** the narration cadence was designed on. **The store page must
> state the GPU requirement plainly**, and this cuts off some players deliberately.

### 14.9 Fleeing bosses, and the death screen **[DECIDED 2026-08-26]**

**Bosses cannot be fled.** No Run option on any boss encounter, and the **Smoke Vial's "guaranteed
flee" explicitly fails** against them — *"there is nowhere to go."*

A floor boss is the gate between floors, and **the floor-4 Warden is the moral climax of the entire
run**; fleeing the verdict on a dice roll is absurd. Today there is no boss check anywhere in the
flee path (`FINDINGS.md` G4), so this is a guard to add plus one item exception. **The UI must
explain *why* the option is unavailable**, not merely hide the button.

**Death gets a run summary, written by the narrator.**

```
reached      Ash City, encounter 14
killed by    Wrath, an Ancient Sin
your build   3 relics, 7 skills, Enforcer lv6
unlocked     Scavver — you spared three
```

…and beneath it, **the Void's own account of the descent**.

**Why this matters more than statistics:** it is the one place **karma can finally be *felt* without
ever being metered** — the narrator can say what the run made of you while never showing a number,
which is exactly what §13 requires. It turns a loss into the end of a story rather than a failure
screen, and it is currently the only moment where unlocks earned in that run would be surfaced at
all.

### 14.10 Ending text — authored anchors, narrated specifics **[DECIDED 2026-08-26]**

**You write the anchors; the narrator interpolates between them.**

| Authored, word for word | Generated per run |
|---|---|
| What grace **is** and what it costs | What *you* did — what you spared, what you took |
| What damnation is | What the descent made of you |
| The lines that must land exactly | The specifics that make it yours |

**Why the split falls here:** *"made whole"* is the thesis of the entire game (`WORLD.md` §0) — the
literal inverse of the injury, and the one phrase everything has been building toward. **Those words
must be the author's, not a 4B model's.** But an ending that cannot reference what actually happened
in the run reads identically every time, which wastes the karma system that produced it.

This is the same shape as the death summary (§14.9) — authored frame, generated content — so the two
share machinery and a voice.

**Rejected:** fully generated endings. The biggest gamble available in the project: a weak ending
undoes everything before it, and the output cannot be guaranteed.

### 14.11 Run length becomes a measured number **[DECIDED 2026-08-26]**

Floor length is currently an **accident inherited from the Java port** — `ACT_XP_THRESHOLDS` was
copied from `GameLogic.checkAct`, so *how many encounters a floor has* is an emergent side-effect of
an XP curve nobody chose, and the **45–90 minute target in §2 has never been measured.**

**Fix it in the balance re-run (#2), using machinery that already exists.** The simulation already
plays complete runs; make it **report**:

- encounters per floor
- estimated minutes per floor and per run
- **the grace path (4 floors) versus the damnation path (5)** — an asymmetry flagged in §8 and never
  measured in minutes

Then **tune the XP curve until the run lands in 45–90 minutes.** This turns an inherited accident
into a designed number without any structural change to act progression or the save format.

**Rejected:** switching to explicit per-floor encounter counts. More predictable and easier to pace,
but it is a structural change to progression and saves, and it removes the run-to-run variety that
emergent length provides. Recorded in case the tuned curve proves too unpredictable in play.
