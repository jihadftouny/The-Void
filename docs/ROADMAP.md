# The Void — Port Roadmap

Porting the original Java game (`.legacy/The-Void/`) to the TypeScript + Kaplay stack, mobile-first.
The Java source is the canonical design; `.legacy/The-Void-Web` is a helpful TS reference but not
authoritative. Milestones are ordered so the pure logic core (headlessly testable) is built and
verified before the renderer depends on it.

## Locked decisions

- Renderer: **Kaplay**, fixed virtual resolution, letterboxed, portrait, mobile-first.
- Randomness: single seeded RNG (`mulberry32`) threaded through all logic. No `Math.random` in `src/game`.
- Content is data: JSON tables ported from the Java constants (`Weapon`, `Armor`, `Item`, `Element`,
  `EnemyName`, `Lore`, `Story`).
- Structure: `src/game` (pure logic) · `src/render` + `src/scenes` (Kaplay) · `src/data` (JSON).
- Five Acts / floors gated by XP thresholds (10 / 30 / 90 / 240), final boss = "Jorginho Matagal".

## Milestones

- **M0 — Scaffold + loop system** ✅ Vite/Vitest/TS/Kaplay project, agentic pipeline, doctrine,
  seeded RNG core + tests, title scene boots.
- **M1 — Core types + character model.** `Stats` (STR/DEX/CON/INT/WIS/CHA), stat modifiers
  (`setMods`), HP/AC derivation, hit-die, XP. Port `Character`.
- **M2 — Content data (JSON).** Weapons/Armor/Items/Elements per Act, enemy name tables, lore, story
  text. Port `Weapon`, `Armor`, `Item`, `Element`, `EnemyName`, `Lore`, `Story` to `src/data` +
  typed loaders.
- **M3 — Player creation.** Name entry, rolled starting stats (`4d6`), class, derived HP/AC/skill
  charges, starting equipment. Port `Player` creation path.
- **M4 — Enemy generation.** Procedural enemy + name/affix generation and stat/CR scaling from XP.
  Port `Enemy`, `EnemyName`, `Calculator` (naming + CR).
- **M5 — Combat resolution.** Attack rolls, advantage/disadvantage, damage, defense, potions, run
  chance. Port `Calculator` combat math + the `battle` core (logic only, no I/O).
- **M6 — Conditions + skills.** Status effects (stun/sleep/poison/…), condition ticking, player and
  enemy skills and charges. Port `Condition`, `Skill`, `SkillEnemy`.
- **M7 — Encounters.** Random encounter selection, battle / rest (lore + heal) / shop (weighted
  rarity, trade). Port the encounter dispatch, `takeRest`, `shop`.
- **M8 — Progression + story.** Act gating by XP, level-up, act intros/outros, final battle,
  endings. Port `checkAct`, `finalBattle`, `Story`, `Lore`.
- **M9 — Save / load.** Serialize the plain-data run state; resume-or-new on boot.
- **M10 — Kaplay UI shell.** Mobile-first terminal/menu rendering: scrolling text output, choice
  buttons, prompt input, header/divider styling — driven by the logic core via a thin adapter.
- **M11 — Mobile polish.** Portrait layouts at multiple resolutions, ≥44px touch targets, safe-area
  insets, on-screen keyboard handling, DPR scaling.
- **M12 — (stretch) Juice + PWA.** Audio, transitions/effects, installable PWA, itch/store packaging.

Core milestones for the % bar: M1–M11 (M0 done, M12 stretch, not counted).

## Definition of done (applies to every milestone)

`npm run typecheck` clean · `npm run build` passes · new committed Vitest tests genuinely exercising
the milestone's logic (expected values derived independently, not measured from the code) · full
existing suite green · logic core free of renderer/DOM imports and of `Math.random`/`Date.now` ·
NEEDS-HUMAN items (feel/visual/mobile) written to `HUMAN-CHECKS.md`.
