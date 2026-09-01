// The level-up draft for The Void — pure, framework-agnostic game logic (M9).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or canvas imports. `generateDraft` and
//    `applyDraftOption` return new plain data and mutate nothing.
//  - Deterministic seeded RNG: every draw threads the injected `Rng` in the DOCUMENTED draw
//    order below, so the same seed + same player yields byte-identical offers. No
//    Math.random / Date.now.
//  - Data-driven content: draft weights, upgrade templates, the perk catalog, and the class
//    kit are all data; adding content never edits this selector's branches.
//  - Serializable plain-data state: a `DraftOption` is a flat tagged record (it is stored in
//    the `level-up-draft` phase for a mid-draft save), and applying one returns plain data.
//
// DOCUMENTED DRAW ORDER (so tests hand-derive offers from a scripted rng): the draft fills 3
// distinct slots; for EACH slot, in order, it makes exactly TWO draws —
//   (1) weightedPick a non-empty CATEGORY from the entries [skill:3, upgrade:3, perk:2,
//       stat:2] (built in that fixed order, excluding empty categories), then
//   (2) `pick` uniformly WITHIN that category's candidate list (built in a fixed canonical
//       order), EXCLUDING any candidate already chosen earlier this draft (so the 3 are
//       distinct).
// perk (>=3) and stat (6) are effectively inexhaustible, so a non-empty category always
// exists and 3 distinct options are always available. ALL weights/templates are M15
// placeholders.

import { STAT_KEYS, computeStatMods, type StatKey } from './character.ts';
import {
  SKILLS,
  applySkillUpgrade,
  resolveSkill,
  type SkillDef,
  type SkillId,
  type SkillUpgrade,
} from './skill.ts';
import { CLASSES } from './classKit.ts';
import { PERKS, PERK_IDS } from './perks.ts';
import { type Player } from './player.ts';
import { pick, weightedPick, type Rng } from './rng.ts';

/** A single draft choice as plain, serializable data. */
export type DraftOption =
  | { kind: 'skill'; skillId: SkillId } // grant a not-yet-owned class-kit skill
  | { kind: 'upgrade'; skillId: SkillId; upgrade: SkillUpgrade } // upgrade an owned skill
  | { kind: 'perk'; perkId: string } // a universal perk (repeatable)
  | { kind: 'stat'; stat: StatKey }; // +1 to one attribute

/** Placeholder category weights (M15). Fixed entry order: skill, upgrade, perk, stat. */
const CATEGORY_WEIGHTS = { skill: 3, upgrade: 3, perk: 2, stat: 2 } as const;
type Category = keyof typeof CATEGORY_WEIGHTS;
const CATEGORY_ORDER: readonly Category[] = ['skill', 'upgrade', 'perk', 'stat'];

/** The seed upgrade templates (M15 placeholders). `cheaper` only applies to a cost>1 skill. */
const UPGRADE_TEMPLATES = [
  { id: 'damage', upgrade: { damageBonus: 2 } as SkillUpgrade },
  { id: 'cheaper', upgrade: { chargeDelta: -1 } as SkillUpgrade },
] as const;
type TemplateId = (typeof UPGRADE_TEMPLATES)[number]['id'];

/** Whether an upgrade template is valid for a given base skill. */
function templateApplies(templateId: TemplateId, skill: SkillDef): boolean {
  if (templateId === 'cheaper') return skill.chargeCost > 1;
  return true; // 'damage' always applies
}

// Internal candidate tags carry enough to (a) test distinctness and (b) build a DraftOption.
type Candidate =
  | { cat: 'skill'; skillId: SkillId }
  | { cat: 'upgrade'; skillId: SkillId; templateId: TemplateId }
  | { cat: 'perk'; perkId: string }
  | { cat: 'stat'; stat: StatKey };

/** New class-kit skills the player does not yet own (kit \ skillPool), in kit order. */
function skillCandidates(player: Player, chosen: readonly Candidate[]): Candidate[] {
  const owned = new Set(player.skillPool);
  const takenSkill = new Set(chosen.filter((c) => c.cat === 'skill').map((c) => c.skillId));
  return CLASSES[player.classId].kit
    .filter((id) => !owned.has(id) && !takenSkill.has(id))
    .map((id) => ({ cat: 'skill', skillId: id }));
}

/**
 * Owned skills × applicable templates, in (skillPool order, template order).
 *
 * G35 — UNLIMITED FREE CASTS. `templateApplies` was tested against the BASE `SKILLS[skillId]`
 * rather than the player's already-upgraded skill, and the `taken` exclusion is scoped to a
 * single draft. So `cheaper` (chargeDelta -1, valid only for a cost > 1 skill) was offered
 * again on a LATER level-up, `chargeDelta` summed to -2, and `resolveSkill` clamped the cost
 * to 0. The cast guard is `charges < effectiveCost`, and `0 < 0` is false, while `useSkill`
 * then spends 0 — so the player cast a damage-plus-momentum skill every round forever, free.
 * Measured: 274 of 300 seeds reached a 0-cost skill under a "take cheaper when offered"
 * policy, on every class with a cost-2 skill.
 *
 * The fix is to resolve against the PLAYER: once `cheaper` has been taken, the resolved cost
 * is 1, `templateApplies('cheaper', …)` is false, and it is never offered for that skill
 * again. (⚠ Register slip: `PLAN.md` #0 item 25 says `draft.ts` "already imports"
 * `resolveSkill` — it imported `SKILLS`, `applySkillUpgrade` and three types, but not that.
 * The import is added here.)
 */
function upgradeCandidates(player: Player, chosen: readonly Candidate[]): Candidate[] {
  const taken = new Set(
    chosen.filter((c) => c.cat === 'upgrade').map((c) => `${c.skillId}:${c.templateId}`),
  );
  const out: Candidate[] = [];
  for (const skillId of player.skillPool as SkillId[]) {
    const resolved = resolveSkill(player, skillId);
    if (!resolved) continue;
    for (const t of UPGRADE_TEMPLATES) {
      if (!templateApplies(t.id, resolved)) continue;
      if (taken.has(`${skillId}:${t.id}`)) continue;
      out.push({ cat: 'upgrade', skillId, templateId: t.id });
    }
  }
  return out;
}

/** The full perk catalog (repeatable across drafts), minus any perk chosen this draft. */
function perkCandidates(chosen: readonly Candidate[]): Candidate[] {
  const taken = new Set(chosen.filter((c) => c.cat === 'perk').map((c) => c.perkId));
  return PERK_IDS.filter((id) => !taken.has(id)).map((id) => ({ cat: 'perk', perkId: id }));
}

/** The six stats, minus any stat chosen this draft. */
function statCandidates(chosen: readonly Candidate[]): Candidate[] {
  const taken = new Set(chosen.filter((c) => c.cat === 'stat').map((c) => c.stat));
  return STAT_KEYS.filter((s) => !taken.has(s)).map((s) => ({ cat: 'stat', stat: s }));
}

/** Map an internal candidate to the public DraftOption. */
function toOption(c: Candidate): DraftOption {
  switch (c.cat) {
    case 'skill':
      return { kind: 'skill', skillId: c.skillId };
    case 'upgrade': {
      const template = UPGRADE_TEMPLATES.find((t) => t.id === c.templateId)!;
      return { kind: 'upgrade', skillId: c.skillId, upgrade: { ...template.upgrade } };
    }
    case 'perk':
      return { kind: 'perk', perkId: c.perkId };
    case 'stat':
      return { kind: 'stat', stat: c.stat };
  }
}

/**
 * Generate the 3 seeded, distinct draft options for a level-up — PURE. See the DOCUMENTED
 * DRAW ORDER at the top of this module: 3 slots, each a category `weightedPick` then a
 * uniform `pick` within it (6 draws total), excluding already-chosen options so the three
 * are distinct. Deterministic in the injected `Rng`.
 */
export function generateDraft(player: Player, rng: Rng): [DraftOption, DraftOption, DraftOption] {
  const chosen: Candidate[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const lists: Record<Category, Candidate[]> = {
      skill: skillCandidates(player, chosen),
      upgrade: upgradeCandidates(player, chosen),
      perk: perkCandidates(chosen),
      stat: statCandidates(chosen),
    };
    const entries: [Category, number][] = CATEGORY_ORDER.filter(
      (cat) => lists[cat].length > 0,
    ).map((cat) => [cat, CATEGORY_WEIGHTS[cat]]);
    // stat (6) is never exhausted within 3 slots, so `entries` is always non-empty.
    const cat = weightedPick(rng, entries) ?? 'stat';
    const candidate = pick(rng, lists[cat]);
    chosen.push(candidate);
  }
  return [toOption(chosen[0]!), toOption(chosen[1]!), toOption(chosen[2]!)];
}

/** A one-line label for a skill upgrade, derived from its populated fields. */
function describeUpgrade(up: SkillUpgrade): string {
  const parts: string[] = [];
  if (up.damageBonus) parts.push(`+${up.damageBonus} damage`);
  if (up.chargeDelta) parts.push(`${up.chargeDelta > 0 ? '+' : ''}${up.chargeDelta} charge cost`);
  if (up.addConditions && up.addConditions.length > 0) parts.push(`+${up.addConditions.join(', ')}`);
  return parts.join(', ');
}

/** A player-facing / LLM description of a draft option (used for the offer event + picker). */
export function describeDraftOption(option: DraftOption): string {
  switch (option.kind) {
    case 'skill':
      return `Learn ${SKILLS[option.skillId]?.name ?? option.skillId}`;
    case 'upgrade':
      return `Upgrade ${SKILLS[option.skillId]?.name ?? option.skillId} (${describeUpgrade(option.upgrade)})`;
    case 'perk':
      return PERKS[option.perkId]?.label ?? option.perkId;
    case 'stat':
      return `+1 ${option.stat}`;
  }
}

/**
 * Apply a chosen draft option to the player — PURE. Returns the new player plus a UI/LLM
 * description. Skill: added to `skillPool`. Upgrade: folded via `applySkillUpgrade`. Perk:
 * id pushed onto `perks` (repeatable); an `onPick` perk (deepReserves) ALSO writes state
 * directly — +1 `maxSkillCharges`, refilling `skillCharges` to the new max. Stat: +1 to one
 * attribute, with `mods` recomputed. Stats grow ONLY through this path (M9).
 */
export function applyDraftOption(player: Player, option: DraftOption): { player: Player; describe: string } {
  const describe = describeDraftOption(option);
  switch (option.kind) {
    case 'skill':
      return { player: { ...player, skillPool: [...player.skillPool, option.skillId] }, describe };
    case 'upgrade':
      return {
        player: { ...player, skillUpgrades: applySkillUpgrade(player.skillUpgrades, option.skillId, option.upgrade) },
        describe,
      };
    case 'perk': {
      const perks = [...player.perks, option.perkId];
      if (PERKS[option.perkId]?.apply === 'onPick' && option.perkId === 'deepReserves') {
        const maxSkillCharges = player.maxSkillCharges + 1;
        return { player: { ...player, perks, maxSkillCharges, skillCharges: maxSkillCharges }, describe };
      }
      return { player: { ...player, perks }, describe };
    }
    case 'stat': {
      const stats = { ...player.stats, [option.stat]: player.stats[option.stat] + 1 };
      return { player: { ...player, stats, mods: computeStatMods(stats) }, describe };
    }
  }
}
