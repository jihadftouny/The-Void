// Unlock / feat store for The Void — pure, framework-agnostic meta-progression (M13).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: no Kaplay, DOM, or `localStorage` import lives here —
//    the browser adapter is `src/storage/unlockStorage.ts`, OUTSIDE the logic core.
//    This module is a pure data + reducer core, testable headlessly in Node.
//  - Deterministic seeded RNG: this module makes NO random decision and reads NO
//    wall clock. `applyRunSummary` takes the run's `runId` (the seed or an index) as a
//    caller-supplied param — never a `Date.now()` — so the store is reproducible.
//  - Data-driven content: the default unlock sets and the feat table are consts/data.
//    Expanding the feat list or retuning the front-load partition never edits combat
//    or encounter code — it is a data edit here.
//  - Serializable plain-data state: `UnlockStore`, `RunUnlocks`, `RunSummary`, and
//    `RunMemory` are plain arrays/objects (no class instances, no functions), so they
//    round-trip through JSON. `FEATS` carries `check` functions, but it is a code const
//    that is NEVER serialized — only feat *ids* are stored.
//
// SEPARATION FROM THE RUN SAVE: this store is the PERSISTENT, cross-run artifact. It has
// its OWN version (`UNLOCK_STORE_VERSION`), its OWN migrate ladder, and (via the adapter)
// its OWN localStorage key — fully independent of the run-save `SAVE_VERSION`.
//
// BALANCE (M15): the default front-load family/affix partition and the seed feat grants
// are tunable DATA placeholders. The exact split is an M15 design/balance call; changing
// it is a one-file data edit with no logic change.

import { type PlayerClass } from './player.ts';
import { type BossId } from './boss.ts';
import { type GameEvent } from './gameEvent.ts';

// ------- Store shape ---------------------------------------------------------

/** One flavor-only, NON-mechanical memory of a completed run (the M11 narrator reads it). */
export interface RunMemory {
  /** Caller-supplied run identity (the seed or a run index) — never a wall-clock read. */
  runId: number;
  /** How the run ended, when it reached a verdict/ending; absent for an abandoned run. */
  endingType?: 'grace' | 'damnation';
  /** Karma-weighted enemies spared this run (flavor). */
  spares: number;
  /** Bosses felled this run (flavor). */
  kills: number;
  /** A short human-readable flavor note. Non-mechanical. */
  note: string;
}

/**
 * The persistent cross-run unlock store — plain serializable data. Holds every unlocked
 * class / skill / relic / enemy family / enemy affix, the ids of achieved feats, and the
 * flavor-only cross-run karma memory.
 */
export interface UnlockStore {
  version: number;
  classes: string[];
  skills: string[];
  relics: string[];
  families: string[];
  affixes: string[];
  feats: string[];
  karmaMemory: RunMemory[];
}

/** The store's OWN format version — independent of the run-save `SAVE_VERSION`. */
export const UNLOCK_STORE_VERSION = 1;

// ------- Default front-load sets (curated, M15-tunable DATA) ------------------

/** Canonical class order (mirrors `PlayerClass` in classKit.ts). */
const CLASS_ORDER: readonly PlayerClass[] = ['Enforcer', 'Neuromancer', 'Scavver', 'Penitent', 'Hollow'];

/**
 * The front-load family set: a curated subset of the 24-family roster, one slice per floor,
 * with NO floor left empty (so `availableFamiliesForAct` never hits its fallback-to-all and
 * inverts the reveal) and a ⚖ (karma-weighted) family on floor 1 (so the Scavver spare-3 feat
 * is reachable in run 1). The long tail is unlocked by progression/mastery feats. (M15-tunable.)
 */
export const DEFAULT_FAMILIES: readonly string[] = [
  // floor 1 — includes the ⚖ Gangers so a spare is available on the first floor
  'gangers',
  'securityDrones',
  'mutantStrays',
  // floor 2
  'reflections',
  'distortions',
  // floor 3 — Grief ⚖ and Rage ⚖
  'grief',
  'rage',
  'ashWraiths',
  // floor 4 — The Judged ⚖
  'choir',
  'theJudged',
  // floor 5 — Echo of You ⚖
  'demons',
  'echoesOfYou',
];

/**
 * The front-load affix set: 2 of the 5 authored affixes (authoring order). The other 3 are
 * unlocked by the seed progression/mastery feats. (M15-tunable partition.)
 */
export const DEFAULT_AFFIXES: readonly string[] = ['ravenous', 'ancient'];

/** The long-tail families granted per floor by the `reach-act-N` feats (M15-tunable). */
const LONG_TAIL_BY_ACT: Record<number, readonly string[]> = {
  1: ['cyberEnforcers', 'fixers'],
  2: ['mirrorSelves', 'staticWraiths'],
  3: ['dread', 'numbness', 'sevenSins'],
  4: ['guardians', 'seraphWardens'],
  5: ['voidHorrors', 'theUnmade', 'theHollowed'],
};

/**
 * A brand-new unlock store: Enforcer selectable, the curated front-load family/affix subsets,
 * no achieved feats, and no cross-run memory.
 */
export function createUnlockStore(): UnlockStore {
  return {
    version: UNLOCK_STORE_VERSION,
    classes: ['Enforcer'],
    skills: [],
    relics: [],
    families: [...DEFAULT_FAMILIES],
    affixes: [...DEFAULT_AFFIXES],
    feats: [],
    karmaMemory: [],
  };
}

// ------- Pure readers --------------------------------------------------------

/** True when `classId` is playable — Enforcer is always in, others only once unlocked. */
export function classUnlocked(store: UnlockStore, classId: PlayerClass): boolean {
  return classId === 'Enforcer' || store.classes.includes(classId);
}

/** The playable classes, in canonical order — Enforcer always first, then any unlocked. */
export function selectableClasses(store: UnlockStore): PlayerClass[] {
  return CLASS_ORDER.filter((id) => classUnlocked(store, id));
}

/** The unlocked-family id set (pure reader). */
export function unlockedFamilySet(store: UnlockStore): ReadonlySet<string> {
  return new Set(store.families);
}

/** The unlocked-affix id set (pure reader). */
export function unlockedAffixSet(store: UnlockStore): ReadonlySet<string> {
  return new Set(store.affixes);
}

/**
 * The run-start SNAPSHOT — a frozen copy of only the two sets the encounter generator needs.
 * Copied so mutating the store later never perturbs an in-flight run (the run reads its own
 * snapshot, never the live store → a fixed unlock-set is fully reproducible).
 */
export interface RunUnlocks {
  families: string[];
  affixes: string[];
}

export function snapshotUnlocks(store: UnlockStore): RunUnlocks {
  return { families: [...store.families], affixes: [...store.affixes] };
}

// ------- Run summary (the pure subscriber reducer) ---------------------------

/**
 * The accumulated summary of a single run, derived PURELY by folding the event stream that
 * `step` already emits. The first five fields are the feat-check inputs; the trailing three
 * are internal accumulators the fold threads between steps.
 */
export interface RunSummary {
  /** Bosses felled this run, in order (a boss-encounter followed by a victory). */
  bossKills: BossId[];
  /** Karma-weighted enemies spared this run (every `spared` event is a ⚖ spare). */
  spareCount: number;
  /** The deepest act reached this run (1..5). */
  maxAct: number;
  /** How the run ended, once it reaches a verdict ending. */
  endingType?: 'grace' | 'damnation';
  /** True once ANY battle this run was won with no net player HP loss. */
  wonBattleUnhurt: boolean;
  /** Internal: the boss whose encounter is open, awaiting its victory. */
  pendingBoss?: BossId;
  /** Internal: whether the player lost HP during the current battle. */
  tookDamageThisBattle: boolean;
  /** Internal: the player HP seen at the previous step (for the HP-drop check). */
  lastPlayerHp?: number;
}

/** A fresh, empty run summary. */
export function emptyRunSummary(): RunSummary {
  return {
    bossKills: [],
    spareCount: 0,
    maxAct: 0,
    wonBattleUnhurt: false,
    tookDamageThisBattle: false,
  };
}

/**
 * Fold one `step`'s events + resulting state into the run summary — PURE, never mutates the
 * input. Rules (from the M13 design):
 *  - `player-created` ⇒ maxAct ≥ 1; `act-intro{act}` ⇒ maxAct ≥ act; `final-battle-begins`
 *    ⇒ maxAct ≥ 5.
 *  - `boss-encounter{bossId}` ⇒ set pendingBoss + reset the battle-damage flag.
 *  - `encounter-start` ⇒ reset the battle-damage flag.
 *  - A player HP drop since the previous step (top-level `state.player.hp` fell) ⇒ mark the
 *    current battle as damaged. Checked BEFORE the victory event so a battle whose only round
 *    dealt damage is not counted unhurt. (Top-level `state.player` updates at battle end, so
 *    this compares pre-battle HP to post-battle HP — net battle HP loss.)
 *  - `spared` ⇒ spareCount++.
 *  - `victory` ⇒ if a boss is pending, record the kill and clear it; if the battle took no
 *    damage, mark wonBattleUnhurt (sticky true).
 *  - `ending{endingType}` ⇒ record the ending.
 */
export function foldRunEvents(
  summary: RunSummary,
  events: readonly GameEvent[],
  state: { player: { hp: number } | null },
): RunSummary {
  const bossKills = [...summary.bossKills];
  let spareCount = summary.spareCount;
  let maxAct = summary.maxAct;
  let endingType = summary.endingType;
  let wonBattleUnhurt = summary.wonBattleUnhurt;
  let pendingBoss = summary.pendingBoss;
  let tookDamageThisBattle = summary.tookDamageThisBattle;
  let lastPlayerHp = summary.lastPlayerHp;

  // HP-drop detection BETWEEN steps, before the victory event resolves the unhurt check.
  const hp = state.player?.hp;
  if (hp !== undefined && lastPlayerHp !== undefined && hp < lastPlayerHp) {
    tookDamageThisBattle = true;
  }

  for (const ev of events) {
    switch (ev.kind) {
      case 'player-created':
        if (maxAct < 1) maxAct = 1;
        break;
      case 'act-intro':
        if (ev.act > maxAct) maxAct = ev.act;
        break;
      case 'final-battle-begins':
        if (maxAct < 5) maxAct = 5;
        break;
      case 'boss-encounter':
        pendingBoss = ev.bossId;
        tookDamageThisBattle = false;
        break;
      case 'encounter-start':
        tookDamageThisBattle = false;
        break;
      case 'spared':
        spareCount += 1;
        break;
      case 'victory':
        if (pendingBoss !== undefined) {
          bossKills.push(pendingBoss);
          pendingBoss = undefined;
        }
        if (!tookDamageThisBattle) wonBattleUnhurt = true;
        break;
      case 'ending':
        endingType = ev.endingType;
        break;
      default:
        break;
    }
  }

  // Advance the HP watermark for the next step.
  if (hp !== undefined) lastPlayerHp = hp;

  const next: RunSummary = { bossKills, spareCount, maxAct, wonBattleUnhurt, tookDamageThisBattle };
  if (endingType !== undefined) next.endingType = endingType;
  if (pendingBoss !== undefined) next.pendingBoss = pendingBoss;
  if (lastPlayerHp !== undefined) next.lastPlayerHp = lastPlayerHp;
  return next;
}

// ------- Feats (data-driven; ids stored, `check` functions never serialized) --

/** What a feat grants when it fires (catalog ids into the existing content tables). */
export interface FeatGrants {
  classes?: readonly string[];
  skills?: readonly string[];
  relics?: readonly string[];
  families?: readonly string[];
  affixes?: readonly string[];
}

/** A feat: an id, a pure trigger check over the run summary, and its grants. */
export interface FeatDef {
  id: string;
  check(s: RunSummary): boolean;
  grants: FeatGrants;
}

/**
 * The seed feat set (PATH + MASTERY). Every grant references an existing catalog id (relic ids
 * from relics.json, family ids from enemyFamilies.json, affix ids from enemyAffixes.json) — no
 * new content. Magnitudes and the exact grant partition are M15 balance/design refinements.
 *
 * NOTE (affix partition): the front-load set is {ravenous, ancient}; `first-boss-kill` grants
 * `warped`. The remaining `blessed` / `cursed` are reserved for future feats (M15 expands the
 * table) — adding them is a data edit here, no logic change.
 */
export const FEATS: readonly FeatDef[] = [
  // ---- Class unlocks (PATH feats) ----
  {
    id: 'unlock-neuromancer',
    check: (s) => s.bossKills.includes('kingpin'),
    grants: { classes: ['Neuromancer'] },
  },
  {
    id: 'unlock-scavver',
    check: (s) => s.spareCount >= 3,
    grants: { classes: ['Scavver'] },
  },
  {
    id: 'unlock-penitent',
    check: (s) => s.endingType === 'grace',
    grants: { classes: ['Penitent'] },
  },
  {
    id: 'unlock-hollow',
    check: (s) => s.endingType === 'damnation',
    grants: { classes: ['Hollow'] },
  },
  // ---- Progression feats: reach each act ⇒ that floor's long-tail families ----
  { id: 'reach-act-1', check: (s) => s.maxAct >= 1, grants: { families: LONG_TAIL_BY_ACT[1]! } },
  { id: 'reach-act-2', check: (s) => s.maxAct >= 2, grants: { families: LONG_TAIL_BY_ACT[2]! } },
  { id: 'reach-act-3', check: (s) => s.maxAct >= 3, grants: { families: LONG_TAIL_BY_ACT[3]! } },
  { id: 'reach-act-4', check: (s) => s.maxAct >= 4, grants: { families: LONG_TAIL_BY_ACT[4]! } },
  { id: 'reach-act-5', check: (s) => s.maxAct >= 5, grants: { families: LONG_TAIL_BY_ACT[5]! } },
  // ---- Mastery feats ----
  {
    id: 'first-boss-kill',
    check: (s) => s.bossKills.length >= 1,
    grants: { relics: ['overclock-chip'], affixes: ['warped'] },
  },
  {
    id: 'win-battle-unhurt',
    check: (s) => s.wonBattleUnhurt,
    grants: { relics: ['scrap-plating'] },
  },
];

// ------- Apply a run summary to the store ------------------------------------

/** The ids newly added to the store by an `applyRunSummary` call (for a UI notification). */
export interface NewlyUnlocked {
  classes: string[];
  skills: string[];
  relics: string[];
  families: string[];
  affixes: string[];
  feats: string[];
}

export interface ApplyResult {
  store: UnlockStore;
  newlyUnlocked: NewlyUnlocked;
}

/** Add `id` to `arr` if absent, recording it in `newly`. Preserves insertion order. */
function addUnique(arr: string[], id: string, newly: string[]): void {
  if (!arr.includes(id)) {
    arr.push(id);
    newly.push(id);
  }
}

/** Union a grant list into `arr`, tracking the additions in `newly`. */
function grant(arr: string[], ids: readonly string[] | undefined, newly: string[]): void {
  if (!ids) return;
  for (const id of ids) addUnique(arr, id, newly);
}

/**
 * Apply a run's summary to the store — PURE. For each feat NOT already achieved whose `check`
 * passes, record its id and union its grants; append one flavor `RunMemory` derived from the
 * summary. Idempotent on the feat set: re-applying the same summary adds each feat's grants at
 * most once (achieved ids are a set). `runId` is caller-supplied (seed / index) — NO wall clock.
 */
export function applyRunSummary(store: UnlockStore, summary: RunSummary, runId: number): ApplyResult {
  const classes = [...store.classes];
  const skills = [...store.skills];
  const relics = [...store.relics];
  const families = [...store.families];
  const affixes = [...store.affixes];
  const feats = [...store.feats];
  const newly: NewlyUnlocked = { classes: [], skills: [], relics: [], families: [], affixes: [], feats: [] };

  for (const feat of FEATS) {
    if (feats.includes(feat.id)) continue;
    if (!feat.check(summary)) continue;
    feats.push(feat.id);
    newly.feats.push(feat.id);
    grant(classes, feat.grants.classes, newly.classes);
    grant(skills, feat.grants.skills, newly.skills);
    grant(relics, feat.grants.relics, newly.relics);
    grant(families, feat.grants.families, newly.families);
    grant(affixes, feat.grants.affixes, newly.affixes);
  }

  const karmaMemory = [...store.karmaMemory, makeRunMemory(summary, runId)];
  return {
    store: { version: store.version, classes, skills, relics, families, affixes, feats, karmaMemory },
    newlyUnlocked: newly,
  };
}

/** Derive a flavor-only `RunMemory` from the summary. Non-mechanical. */
function makeRunMemory(summary: RunSummary, runId: number): RunMemory {
  const kills = summary.bossKills.length;
  const spares = summary.spareCount;
  const note =
    summary.endingType === 'grace'
      ? 'The descent ended in grace.'
      : summary.endingType === 'damnation'
        ? 'The descent ended in damnation.'
        : 'The descent ended without a verdict.';
  const mem: RunMemory = { runId, spares, kills, note };
  if (summary.endingType !== undefined) mem.endingType = summary.endingType;
  return mem;
}

// ------- Encode / decode / migrate (independent of SAVE_VERSION) --------------

/** Serialize the store to a canonical JSON string. */
export function encodeUnlockStore(store: UnlockStore): string {
  return JSON.stringify(store);
}

/**
 * Parse and validate a stored payload, returning the `UnlockStore` or `null`. NEVER throws.
 *  1. Parse JSON (bad syntax → null).
 *  2. Reject non-object / array / null roots.
 *  3. Check `version`: non-number → null; future (> UNLOCK_STORE_VERSION) → null; older →
 *     run this module's own `migrate`, rejecting if it cannot upgrade.
 *  4. Validate the shape; on pass return it, else null.
 */
export function decodeUnlockStore(json: string): UnlockStore | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isPlainObject(raw)) return null;

  const version = raw.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) return null;
  if (version > UNLOCK_STORE_VERSION) return null; // future store — this build can't read it
  if (version < UNLOCK_STORE_VERSION) {
    const migrated = migrate(raw, version);
    if (migrated === null) return null;
    raw = migrated;
  }

  return isValidStore(raw) ? raw : null;
}

/**
 * The store's OWN migrate ladder — independent of the run-save. Called only when
 * `fromVersion < UNLOCK_STORE_VERSION`. Each rung upgrades one step. A v0 store (predating the
 * flavor `karmaMemory`) gains an empty `karmaMemory`; anything below 0 cannot be migrated.
 */
function migrate(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown> | null {
  let current = fromVersion;
  let value: Record<string, unknown> = raw;
  while (current < UNLOCK_STORE_VERSION) {
    switch (current) {
      case 0:
        value = upgrade0to1(value);
        current = 1;
        break;
      default:
        return null; // unknown / unsupported source version
    }
  }
  return value;
}

/** v0 → v1: inject the additive flavor `karmaMemory` array when absent; stamp version 1. */
function upgrade0to1(raw: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };
  if (!Array.isArray(next.karmaMemory)) next.karmaMemory = [];
  next.version = 1;
  return next;
}

// ------- Shape guard ---------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** True for a structurally valid store at exactly `UNLOCK_STORE_VERSION`. */
function isValidStore(v: unknown): v is UnlockStore {
  if (!isPlainObject(v)) return false;
  if (v.version !== UNLOCK_STORE_VERSION) return false;
  if (!isStringArray(v.classes)) return false;
  if (!isStringArray(v.skills)) return false;
  if (!isStringArray(v.relics)) return false;
  if (!isStringArray(v.families)) return false;
  if (!isStringArray(v.affixes)) return false;
  if (!isStringArray(v.feats)) return false;
  if (!Array.isArray(v.karmaMemory)) return false;
  return true;
}
