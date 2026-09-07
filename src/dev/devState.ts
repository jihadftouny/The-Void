// The developer state panel's PURE core — build a complete, valid game state from a
// plain-data `JumpSpec`, so a play-test can start anywhere instead of playing a whole run.
//
// ⚠ THIS DIRECTORY IS NEVER IN THE PACKAGED BUILD. `src/desktop/game.ts` reaches it through
// a dynamic `import()` inside an `import.meta.env.DEV` guard, which Rollup eliminates at
// build time — module, chunk, string and sourcemap alike. `src/dev/exclusion.test.ts` proves
// that by running the real bundler twice, in a subprocess. Nothing here may be imported by a
// shipping module.
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: this module is PURE. No DOM, no logger, no clock, no
//    `localStorage`. It is a function of its arguments and imports only pure engine modules,
//    so every behaviour below is tested headlessly. The DOM panel is `panel.ts`; the
//    adoption seam is `game.ts`'s `adoptRun(saved)`.
//  - Deterministic seeded RNG: NO `Math.random`, NO `Date.now`, held to `src/game`'s
//    standard even though `src/dev` is a boundary layer — a jump nobody can replay is a bug
//    report nobody can fix. Every draw (start stats, level-up HP, drafts, a generated item, a
//    forced enemy) threads `createRng(seed)` and the advanced accumulator is written back
//    into the new state, exactly as `step`'s `finish` does. `buildJump(spec)` twice is
//    byte-identical.
//  - Data-driven content: the jumps are `DEV_PRESETS`, a table. Adding one is a data edit.
//  - Serializable plain-data state: a `JumpBundle` is `{state, memory, meta}` — the same
//    shape a save envelope carries — and it must survive `saveRun` -> `loadRun` unchanged.
//
// NOTHING ENGINE-DERIVED IS HAND-WRITTEN. Every payload the engine would compute is computed
// by the engine's own exported function: `createPlayer`/`rollStartStats` for the character,
// `applyLevelUpHp` + `generateDraft` + `applyDraftOption` for growth, `generateEnemy` +
// `applyAffix` for an encounter, `generateBoss` for a boss, `createBattle` for a battle,
// `computeVerdict` for a verdict outcome, `generateItem` for a rolled item, and `equip` for
// equipping — never a direct write into `inventory.slots`, which is precisely the shape that
// made G11 invisible.
//
// RECORDED DEVIATION (PRINCIPLES.md A12 / CLAUDE.md principle 1). A jumped run is NOT
// reproducible from `seed + inputs` in the ordinary sense; it is reproducible from
// `JumpSpec + inputs`. The panel never MUTATES or ADVANCES state — it REPLACES the whole
// bundle, which is exactly what resuming a save already does and what the principle already
// tolerates. After a jump, every further change goes through `step` alone. The panel logs
// loudly at jump time so no bug report from a jumped session is mistaken for a real run.
//
// KARMA IS VISIBLE HERE, AND ONLY HERE. The panel is a DEVELOPER surface, in the same class
// as the log (CLAUDE.md principle 7, "the player never sees it") and with a stronger
// guarantee: the log ships at `info`, this does not ship at all. It cannot trip the existing
// hidden-karma guards, which are scoped to `describeCost`/`describeReward`/`dealView`/
// `formatEvent`/`describeEvent` and to `characterSheet`'s keys — none of which this module
// calls. And if that scope ever widens, EXCLUDE THIS WHOLE DIRECTORY BY PATH — one rule,
// `skip src/dev`, never a word-list exception, because a word-list exception is how the
// guard dies.

import { createGame, type GameState, type Phase } from '../game/game.ts';
import { createRng, type Rng } from '../game/rng.ts';
import { createKarma, type KarmaState } from '../game/karma.ts';
import { createPlayer, rollStartStats, type Player, type PlayerClass } from '../game/player.ts';
import { applyLevelUpHp, hasPendingLevelUp, levelForXp } from '../game/progression.ts';
import { generateDraft, applyDraftOption } from '../game/draft.ts';
import { generateEnemy } from '../game/enemy.ts';
import { FAMILIES, getFamily } from '../game/enemyFamily.ts';
import { AFFIXES, applyAffix } from '../game/enemyAffix.ts';
import { createBattle } from '../game/battle.ts';
import { generateBoss, computeVerdict, BOSSES, type BossId } from '../game/boss.ts';
import { generateItem, type GenerateRequest } from '../game/rarityGen.ts';
import {
  getAllConsumables,
  getAllItems,
  getAllRelics,
  getAllUniques,
  getCatalogItemById,
  type EquipSlot,
  type ItemInstance,
} from '../game/item.ts';
import { equip, pickUp, resolveInstanceDef } from '../game/equipment.ts';
import { clampMomentum } from '../game/classKit.ts';
import { decodeSave, encodeSave } from '../game/save.ts';
import { emptyRunSummary, type RunSummary, type RunUnlocks } from '../game/unlockStore.ts';
import { createStoryMemory, type StoryMemory } from '../llm/narrate.ts';
import type { Rarity } from '../game/weapon.ts';
import type { StatKey } from '../game/character.ts';

// ------- The plain-data request -----------------------------------------------

/** Where the jump lands. Every payload-carrying variant is built by an engine function. */
export type TargetSpec =
  | { kind: 'hub' }
  | { kind: 'encounter'; familyId: string; affixId?: string }
  | { kind: 'boss'; bossId: BossId }
  | { kind: 'verdict' }
  | { kind: 'battle-victory'; final: boolean }
  | { kind: 'ending'; endingType: 'grace' | 'damnation' }
  | { kind: 'game-over' };

/** One item to put in the jumped character's hands. Exactly one source, catalog or rolled. */
export interface GrantSpec {
  /** A catalog id (base item, relic, unique or consumable). Unresolvable ids are refused. */
  catalogId?: string;
  /** A rarity-generated item, rolled from the jump's own RNG stream. */
  generated?: { slot: EquipSlot; rarity: Rarity; stat?: StatKey };
  /** Equip it after the grant — through the real `equip()`, which refuses a usable. */
  equip?: boolean;
}

/** The player-record edits the panel's Player section makes. Every field is clamped. */
export interface StateEdits {
  hp?: number;
  maxHp?: number;
  pots?: number;
  restsLeft?: number;
  skillCharges?: number;
  momentum?: number;
  corruption?: number;
}

/** A complete jump request — PLAIN DATA, so it round-trips through JSON and a bug report. */
export interface JumpSpec {
  /** The run seed. Defaults to 1 so a preset is reproducible without one. */
  seed?: number;
  /** Act 1..5. `place` is always `act - 1`; it is never specified separately. */
  act: number;
  /** Banked XP. The character is fast-forwarded to `levelForXp(xp)`. */
  xp: number;
  classId?: PlayerClass;
  name?: string;
  /** Karma axes. Missing axes are 0; every value is rounded and clamped. */
  karma?: Partial<KarmaState>;
  target?: TargetSpec;
  grants?: readonly GrantSpec[];
  edits?: StateEdits;
  /** Overrides folded onto the run record the end-of-run screen reads. */
  runSummary?: Partial<Pick<RunSummary, 'bossKills' | 'spareCount' | 'maxAct' | 'endingType'>>;
  /**
   * The run-start unlock SNAPSHOT. Carried over from the live state by the panel, never
   * fabricated — a jumped run's gradual-reveal window stays whatever the store said.
   */
  unlocks?: RunUnlocks;
}

/** What a jump produces: exactly the envelope `saveRun`/`loadRun` carry. */
export interface JumpBundle {
  state: GameState;
  memory: StoryMemory;
  meta: { runSummary: RunSummary; runSeed: number };
}

// ------- Bounds ---------------------------------------------------------------

/**
 * The karma clamp. Every `KARMA_DELTAS` entry is an integer and the vector starts at zero, so
 * the INTEGERS are exactly the reachable lattice; the range keeps the panel from producing a
 * vector its own save would reject (`decodeSave#isValidKarma` rejects NaN/Infinity).
 */
export const KARMA_MIN = -25;
export const KARMA_MAX = 25;

/** The four axes, in the canonical `KarmaState` key order. */
export const KARMA_AXES: readonly (keyof KarmaState)[] = [
  'mercyCruelty',
  'restraintGreed',
  'reverenceDesecration',
  'clarityDelusion',
];

// ------- Small pure helpers ---------------------------------------------------

/** An integer inside `[lo, hi]`. Non-finite input becomes `lo`. */
function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

/** A whole karma vector from a partial one: integers, clamped, every axis present. */
export function normalizeKarma(partial: Partial<KarmaState> | undefined): KarmaState {
  const karma = createKarma();
  if (!partial) return karma;
  for (const axis of KARMA_AXES) {
    const raw = partial[axis];
    if (raw !== undefined) karma[axis] = clampInt(raw, KARMA_MIN, KARMA_MAX);
  }
  return karma;
}

// ------- Growth: the engine's own level-up, run forward -----------------------

/**
 * Drain every owed level-up through the ENGINE's own functions — PURE, threading `rng`.
 *
 * A level-16 character carrying a starting hit-die HP pool makes every downstream
 * observation meaningless, so the fast-forward is not a `level = n` write: it loops
 * `applyLevelUpHp` (one hit-die draw each) and takes a draft each time, exactly as
 * `enterLevelUp` -> `level-up-draft` -> `applyDraftOption` does in a real run.
 *
 * The draft pick is offer 0 every time. Arbitrary, but DETERMINISTIC and stated: the panel
 * exists to reach a state, not to model a player's build choices. The loop is bounded by
 * `guard` so a corrupted XP value cannot spin — at the largest XP the game can reach the
 * loop runs a few dozen times.
 */
export function levelTo(player: Player, rng: Rng, guard = 500): Player {
  let current = player;
  let drained = 0;
  while (hasPendingLevelUp(current) && drained < guard) {
    const grown = applyLevelUpHp(current, rng);
    const offers = generateDraft(grown.player, rng);
    current = applyDraftOption(grown.player, offers[0]).player;
    drained += 1;
  }
  return current;
}

// ------- Grants ---------------------------------------------------------------

/**
 * Put one item in the character's hands — PURE, threading `rng` for a rolled item.
 *
 * The item lands in the BACKPACK via `pickUp`, and an `equip: true` grant then goes through
 * the real `equip(inventory, index)` — never a write into `inventory.slots`. That is not
 * fastidiousness: writing the slot directly is exactly what hid G11 (`equipCascade.test.ts`),
 * and it would let this panel "equip" a consumable, which the engine would never do.
 *
 * An unresolvable catalog id grants NOTHING and returns the player unchanged, so an
 * unresolvable instance can never reach a backpack (validity invariant 8).
 */
export function grantItem(player: Player, grant: GrantSpec, rng: Rng): Player {
  let instance: ItemInstance | null = null;
  if (grant.generated) {
    const req: GenerateRequest = { slot: grant.generated.slot, rarity: grant.generated.rarity };
    if (grant.generated.stat !== undefined) req.stat = grant.generated.stat;
    instance = generateItem(rng, req);
  } else if (grant.catalogId !== undefined) {
    if (!getCatalogItemById(grant.catalogId)) return player;
    instance = { defId: grant.catalogId };
  }
  if (!instance) return player;

  let inventory = pickUp(player.inventory, instance);
  if (grant.equip) {
    const result = equip(inventory, inventory.backpack.length - 1);
    if (result.ok) inventory = result.inventory;
  }
  return { ...player, inventory };
}

// ------- Player edits ---------------------------------------------------------

/** Apply the panel's Player-section edits to ONE player record — PURE, every field clamped. */
export function applyPlayerEdits(player: Player, edits: StateEdits): Player {
  const next: Player = { ...player };
  if (edits.maxHp !== undefined) next.maxHp = Math.max(1, clampInt(edits.maxHp, 1, 1_000_000));
  if (edits.hp !== undefined) next.hp = edits.hp;
  // Whatever the order the fields arrived in, HP ends up inside [1, maxHp].
  next.hp = clampInt(next.hp, 1, next.maxHp);
  if (edits.pots !== undefined) next.pots = clampInt(edits.pots, 0, 1_000_000);
  if (edits.restsLeft !== undefined) next.restsLeft = clampInt(edits.restsLeft, 0, 1_000_000);
  if (edits.skillCharges !== undefined) {
    next.skillCharges = clampInt(edits.skillCharges, 0, next.maxSkillCharges);
  }
  if (edits.momentum !== undefined) next.momentum = clampMomentum(clampInt(edits.momentum, 0, 1_000));
  if (edits.corruption !== undefined) next.corruption = clampInt(edits.corruption, 0, 1_000_000);
  return next;
}

/**
 * Apply the panel's Player-section edits to a whole `GameState` — PURE.
 *
 * ⚠ MID-BATTLE, BOTH PLAYERS ARE WRITTEN. `displayPlayer` reads `phase.battle.player` during
 * a battle and `game.ts` writes the battle combatant back to the hub when the fight ends, so
 * editing only `state.player` is either invisible (the HUD shows the combatant) or silently
 * reverted (the combatant overwrites the hub record). Both, or the edit does not exist.
 */
export function applyEdits(state: GameState, edits: StateEdits): GameState {
  if (!state.player) return state;
  const next: GameState = { ...state, player: applyPlayerEdits(state.player, edits) };
  if (state.phase.kind === 'battle') {
    const phase = state.phase;
    next.phase = {
      ...phase,
      battle: { ...phase.battle, player: applyPlayerEdits(phase.battle.player, edits) },
    };
  }
  return next;
}

// ------- The build ------------------------------------------------------------

/** Assemble the phase the target names, using the engine's own builders. */
function buildPhase(
  target: TargetSpec,
  player: Player,
  act: number,
  karma: KarmaState,
  rng: Rng,
): Phase {
  switch (target.kind) {
    case 'hub':
      return { kind: 'main-menu' };
    case 'encounter': {
      const family = getFamily(target.familyId);
      if (!family) return { kind: 'main-menu' };
      let enemy = generateEnemy({ act, family, playerXp: player.xp }, rng);
      if (target.affixId !== undefined) {
        const affix = AFFIXES.find((a) => a.id === target.affixId);
        if (affix) enemy = applyAffix(enemy, affix);
      }
      // The same opening advantage a real random encounter carries (G12: battle-scoped).
      const battle = createBattle(player, enemy, act, { openingAdvantage: 1 });
      return { kind: 'battle', battle, started: false, final: false };
    }
    case 'boss': {
      const { enemy, boss } = generateBoss({ bossId: target.bossId, act, player, karma, rng });
      const battle = createBattle(player, enemy, act, { boss });
      return { kind: 'battle', battle, started: false, final: target.bossId === 'hollow' };
    }
    case 'verdict':
      // NEVER typed by hand — the real gate decides, from the same karma the run carries.
      return { kind: 'verdict', outcome: computeVerdict(karma) };
    case 'battle-victory':
      return { kind: 'battle-victory', final: target.final };
    case 'ending':
      return { kind: 'ending', endingType: target.endingType };
    case 'game-over':
      return { kind: 'game-over' };
  }
}

/** The run record the end-of-run screen reads, folded from the spec's overrides. */
function buildRunSummary(spec: JumpSpec): RunSummary {
  const summary = emptyRunSummary();
  // A jumped run really is at `spec.act`, so the depth row says so unless told otherwise.
  summary.maxAct = spec.act;
  const overrides = spec.runSummary;
  if (overrides) {
    if (overrides.bossKills !== undefined) summary.bossKills = [...overrides.bossKills];
    if (overrides.spareCount !== undefined) summary.spareCount = overrides.spareCount;
    if (overrides.maxAct !== undefined) summary.maxAct = overrides.maxAct;
    if (overrides.endingType !== undefined) summary.endingType = overrides.endingType;
  }
  return summary;
}

/**
 * Build a complete, valid bundle from a jump request — PURE and DETERMINISTIC. The same spec
 * always yields a byte-identical bundle, which is what lets every other test here assert
 * exact values.
 *
 * The draw ORDER is fixed and documented, because it is what makes the above true:
 *   1. `rollStartStats`  — six draws, through `createPlayer`'s own contract.
 *   2. `levelTo`         — one hit-die draw plus a draft per owed level.
 *   3. each grant, in order — two draws per rolled item, none for a catalog id.
 *   4. the target's builder — an enemy, a boss, or nothing at all.
 * The advanced accumulator is then sealed into `state.rngState`, exactly as `step` does, so
 * the jumped state is a valid CONTINUATION of its own stream rather than a fork of it.
 *
 * HP: the fast-forward raises `maxHp` and (faithfully) does not heal, so a jumped character
 * would arrive at its level-1 HP. That is a trap, not a fidelity win, so the character starts
 * at FULL HP — and `spec.edits.hp` overrides it, which is how a wounded jump is asked for.
 */
export function buildJump(spec: JumpSpec): JumpBundle {
  const seed = spec.seed ?? 1;
  const base = createGame(seed);
  const { rng, getState } = createRng(base.rngState);

  const stats = rollStartStats(rng);
  let player = createPlayer({
    name: spec.name ?? 'Dev',
    classId: spec.classId ?? 'Enforcer',
    stats,
  });
  player = { ...player, xp: spec.xp };
  player = levelTo(player, rng);
  player = { ...player, hp: player.maxHp };

  for (const grant of spec.grants ?? []) {
    player = grantItem(player, grant, rng);
  }
  if (spec.edits) player = applyPlayerEdits(player, spec.edits);

  const karma = normalizeKarma(spec.karma);
  const act = spec.act;
  const phase = buildPhase(spec.target ?? { kind: 'hub' }, player, act, karma, rng);

  const state: GameState = {
    version: 8,
    rngState: getState(),
    player,
    act,
    // `place = act - 1` is maintained by `advanceAct` and read by the floor theme and the
    // floor names; it is derived here rather than accepted, so it cannot disagree.
    place: act - 1,
    karma,
    phase,
  };
  if (spec.unlocks) state.unlocks = spec.unlocks;

  return {
    state,
    memory: createStoryMemory(),
    meta: { runSummary: buildRunSummary(spec), runSeed: seed },
  };
}

// ------- Validation -----------------------------------------------------------

/**
 * Why a bundle was refused. ONE CONSTANT PER INVARIANT — never a shared "invalid", so a
 * refusal names what is actually wrong and each reason can be driven red on its own.
 */
export type JumpRejection =
  | 'version-not-8'
  | 'rng-state-not-finite'
  | 'act-out-of-range'
  | 'place-not-act-minus-one'
  | 'player-missing'
  | 'level-not-from-xp'
  | 'max-hp-invalid'
  | 'hp-out-of-range'
  | 'charges-out-of-range'
  | 'pots-negative'
  | 'rests-negative'
  | 'momentum-out-of-range'
  | 'corruption-negative'
  | 'karma-not-integer'
  | 'karma-out-of-range'
  | 'item-unresolvable'
  | 'empty-draft-offers'
  | 'boss-kill-unknown'
  | 'run-summary-not-finite'
  | 'run-seed-not-finite'
  | 'pending-invalid'
  | 'unlocks-malformed'
  | 'save-round-trip-failed';

/** The phases in which `requirePlayer` would throw, plus every other in-run phase. */
const PLAYERLESS_PHASES: readonly Phase['kind'][] = [
  'title',
  'name-entry',
  'class-select',
  'stats-roll',
];

/** Every item instance the bundle puts anywhere on the character. */
function allInstances(player: Player): ItemInstance[] {
  const slots = Object.values(player.inventory.slots).filter((i): i is ItemInstance => i !== null);
  return [...slots, ...player.inventory.backpack];
}

/**
 * Check every named invariant a jumped state must satisfy — PURE, returns the list of
 * reasons, empty when the bundle is good.
 *
 * The list is deliberately EXHAUSTIVE rather than early-returning: a broken jump should say
 * everything that is wrong with it in one go, and each reason is independently reachable.
 *
 * The last check is the strongest and the cheapest: the state is pushed through the ENGINE's
 * own `encodeSave` -> `decodeSave` and must come back identical. That single line exercises
 * the version, the RNG accumulator, the act/place pair, the phase kind, all four karma axes
 * and the whole Player envelope, using the very code a real save is gated on. A jump that
 * cannot survive its own save is not a valid state.
 */
export function validateJump(bundle: JumpBundle): JumpRejection[] {
  const reasons: JumpRejection[] = [];
  const { state, meta } = bundle;

  if (state.version !== 8) reasons.push('version-not-8');
  if (!Number.isFinite(state.rngState)) reasons.push('rng-state-not-finite');
  if (!Number.isInteger(state.act) || state.act < 1 || state.act > 5) {
    reasons.push('act-out-of-range');
  }
  if (state.place !== state.act - 1) reasons.push('place-not-act-minus-one');
  if (state.pending !== undefined && state.pending !== 'advance-act') reasons.push('pending-invalid');

  if (state.unlocks !== undefined) {
    const u = state.unlocks as Partial<RunUnlocks>;
    if (!Array.isArray(u.families) || !Array.isArray(u.affixes)) reasons.push('unlocks-malformed');
  }

  for (const axis of KARMA_AXES) {
    const value = state.karma[axis];
    if (!Number.isInteger(value)) {
      reasons.push('karma-not-integer');
    } else if (value < KARMA_MIN || value > KARMA_MAX) {
      reasons.push('karma-out-of-range');
    }
  }

  const player = state.player;
  if (!player) {
    if (!PLAYERLESS_PHASES.includes(state.phase.kind)) reasons.push('player-missing');
  } else {
    if (player.level !== levelForXp(player.xp)) reasons.push('level-not-from-xp');
    if (!Number.isFinite(player.maxHp) || player.maxHp < 1) reasons.push('max-hp-invalid');
    if (player.hp < 1 || player.hp > player.maxHp) reasons.push('hp-out-of-range');
    if (player.skillCharges < 0 || player.skillCharges > player.maxSkillCharges) {
      reasons.push('charges-out-of-range');
    }
    if (player.pots < 0) reasons.push('pots-negative');
    if (player.restsLeft < 0) reasons.push('rests-negative');
    const momentum = player.momentum ?? 0;
    if (momentum !== clampMomentum(momentum)) reasons.push('momentum-out-of-range');
    if ((player.corruption ?? 0) < 0) reasons.push('corruption-negative');
    for (const instance of allInstances(player)) {
      if (!resolveInstanceDef(instance) && !getCatalogItemById(instance.defId)) {
        reasons.push('item-unresolvable');
        break;
      }
    }
  }

  // A `level-up-draft` with no offers renders three cards' worth of nothing and dead-ends
  // the run: `step` only leaves that phase through a `draft-pick` no button can produce.
  if (state.phase.kind === 'level-up-draft' && state.phase.offers.length === 0) {
    reasons.push('empty-draft-offers');
  }

  const bossIds = new Set(Object.keys(BOSSES));
  if (meta.runSummary.bossKills.some((id) => !bossIds.has(id))) reasons.push('boss-kill-unknown');
  if (!Number.isFinite(meta.runSummary.maxAct) || !Number.isFinite(meta.runSummary.spareCount)) {
    reasons.push('run-summary-not-finite');
  }
  if (!Number.isFinite(meta.runSeed)) reasons.push('run-seed-not-finite');

  if (!survivesSaveRoundTrip(state)) reasons.push('save-round-trip-failed');
  return reasons;
}

/** The engine's own save gate, run in memory: encode, decode, and require an exact match. */
export function survivesSaveRoundTrip(state: GameState): boolean {
  const encoded = encodeSave(state);
  const decoded = decodeSave(encoded);
  if (!decoded) return false;
  return encodeSave(decoded) === encoded;
}

/** The decision the panel acts on: adopt, or refuse and say exactly why. */
export type AdoptDecision =
  | { ok: true }
  | { ok: false; reasons: JumpRejection[] };

/**
 * Adopt a bundle, or refuse it — PURE. A bundle with ANY reason is refused; only a bundle
 * with none is adopted. Both directions matter: refusing everything makes the panel useless,
 * and adopting everything is how a hand-edited state JSON crashes the renderer on a phase
 * whose `requirePlayer` throws.
 */
export function decideAdopt(bundle: JumpBundle): AdoptDecision {
  const reasons = validateJump(bundle);
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

// ------- The state JSON editor ------------------------------------------------

/** Why a pasted envelope was refused. Mirrors `persist.ts`'s `SaveRejection` vocabulary. */
export type PasteRejection = 'not-json' | 'state-decode-failed' | 'memory-invalid' | 'meta-invalid';

export type ParsedBundle =
  | { ok: true; bundle: JumpBundle }
  | { ok: false; reason: PasteRejection };

/** Serialize a bundle for the panel's copy button — the exact envelope a save carries. */
export function encodeBundle(bundle: JumpBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Parse a pasted bundle — PURE, NEVER throws. The state goes through the engine's own
 * `decodeSave`, so a pasted envelope is held to exactly the standard a stored save is.
 * The caller still runs `decideAdopt` on the result: parsing proves the shape, not the
 * validity.
 */
export function parseBundle(text: string): ParsedBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'not-json' };
  }
  const env = raw as Record<string, unknown>;

  const state = decodeSave(JSON.stringify(env.state ?? null));
  if (!state) return { ok: false, reason: 'state-decode-failed' };

  const m = env.memory as Partial<StoryMemory> | undefined;
  if (!m || !Array.isArray(m.beats)) return { ok: false, reason: 'memory-invalid' };
  const memory: StoryMemory = {
    beats: m.beats.map(String),
    enemiesDefeated: Number(m.enemiesDefeated) || 0,
    timesFled: Number(m.timesFled) || 0,
    notable: Array.isArray(m.notable) ? m.notable.map(String) : [],
  };

  const rawMeta = env.meta as { runSummary?: unknown; runSeed?: unknown } | undefined;
  if (!rawMeta || typeof rawMeta !== 'object') return { ok: false, reason: 'meta-invalid' };
  const summary = rawMeta.runSummary as RunSummary | undefined;
  const runSeed = rawMeta.runSeed;
  if (!summary || !Array.isArray(summary.bossKills) || typeof runSeed !== 'number') {
    return { ok: false, reason: 'meta-invalid' };
  }
  return { ok: true, bundle: { state, memory, meta: { runSummary: summary, runSeed } } };
}

// ------- The preset table (DATA, not code) ------------------------------------

/** One row of the panel's jump menu. */
export interface DevPreset {
  id: string;
  label: string;
  spec: JumpSpec;
}

/**
 * The jumps the panel offers, as DATA — the panel renders one button per row, so adding a
 * jump (which is what `PLAN.md` #2's balance re-run will want) never touches panel code.
 *
 * Every row's expectation below is derived from a CONSTANT read as a specification, never
 * measured from a run: `ACT_XP_THRESHOLDS[5] = 240`, `GATE_WEIGHTS` x axes vs
 * `GATE_THRESHOLD = 1`, and `HOLLOW_GATE_XP = 500`.
 */
export const DEV_PRESETS: readonly DevPreset[] = [
  {
    id: 'act1-hub',
    label: 'Act 1 hub (control)',
    spec: { act: 1, xp: 0, target: { kind: 'hub' } },
  },
  {
    id: 'act4-verdict-ready',
    label: 'Act 4 hub, verdict ready',
    // shouldAdvance(4, 240) is true (ACT_XP_THRESHOLDS[5] = 240) => the next
    // `menu:continue` opens the verdict rather than an encounter.
    spec: { act: 4, xp: 240, target: { kind: 'hub' } },
  },
  {
    id: 'verdict-grace',
    label: 'Act 4 hub -> GRACE',
    // GATE_WEIGHTS.mercyCruelty (1) x 1 = 1 >= GATE_THRESHOLD (1) => grace.
    spec: { act: 4, xp: 240, karma: { mercyCruelty: 1 }, target: { kind: 'hub' } },
  },
  {
    id: 'verdict-castdown',
    label: 'Act 4 hub -> CAST DOWN',
    // GATE_WEIGHTS.reverenceDesecration (3) x -1 = -3 < 1 => cast-down => act 5.
    spec: { act: 4, xp: 240, karma: { reverenceDesecration: -1 }, target: { kind: 'hub' } },
  },
  {
    id: 'act5-hub-fresh',
    label: 'Act 5 hub, below the Hollow gate',
    // Floor 5's encounter layer (G43's fix): xp 240 < HOLLOW_GATE_XP, so the hub offers
    // encounters. This is the jump the floor-5 length measurement starts from.
    spec: { act: 5, xp: 240, target: { kind: 'hub' } },
  },
  {
    id: 'act5-hollow-ready',
    label: 'Act 5 hub, Hollow gate open',
    // hollowGateOpen(500) is true => the next `menu:continue` builds the Hollow.
    spec: { act: 5, xp: 500, target: { kind: 'hub' } },
  },
  {
    id: 'hollow-fight',
    label: 'The Hollow, in the fight',
    // Act 5 AND a boss, so `createBattle` derives `canFlee: false` twice over.
    spec: { act: 5, xp: 500, target: { kind: 'boss', bossId: 'hollow' } },
  },
  {
    id: 'ending-damnation',
    label: 'Damnation ending',
    // A final victory: one `continue` emits the damnation ending event.
    spec: { act: 5, xp: 500, target: { kind: 'battle-victory', final: true } },
  },
  {
    id: 'ending-death',
    label: 'Death summary, with a record',
    // A populated run record so the death screen has bosses and spares actually on it.
    spec: {
      act: 4,
      xp: 240,
      target: { kind: 'game-over' },
      runSummary: { maxAct: 4, spareCount: 3, bossKills: ['kingpin', 'reflection'] },
    },
  },
  {
    id: 'judged-act4',
    label: 'The Judged, floor 4 (spare check)',
    // theJudged carries `onSpare: ["spareWeighted", "honorDead"]` — the reason this unit
    // exists: spare it and confirm nothing on screen says anything was scored.
    spec: { act: 4, xp: 240, target: { kind: 'encounter', familyId: 'theJudged' } },
  },
];

/** A preset by id, or undefined. */
export function getPreset(id: string): DevPreset | undefined {
  return DEV_PRESETS.find((p) => p.id === id);
}

// ------- Menus the panel renders (built from the real content tables) ---------

/** One selectable row in a panel dropdown. */
export interface MenuOption {
  id: string;
  label: string;
}

/**
 * Every catalog item the panel can grant, built from the four real catalogs — so an
 * unresolvable id is UNREPRESENTABLE through the UI rather than merely refused by it.
 */
export function catalogOptions(): MenuOption[] {
  const groups: [string, readonly { id: string; name: string }[]][] = [
    ['item', getAllItems()],
    ['relic', getAllRelics()],
    ['unique', getAllUniques()],
    ['consumable', getAllConsumables()],
  ];
  return groups.flatMap(([kind, defs]) =>
    defs.map((def) => ({ id: def.id, label: `${def.name} (${kind})` })),
  );
}

/** Every enemy family, labelled with its floor and its karma-weighted mark. */
export function familyOptions(): MenuOption[] {
  return FAMILIES.map((f) => ({
    id: f.id,
    label: `${f.name} — floor ${f.floor}${f.karmaWeighted ? ' [weighted]' : ''}`,
  }));
}

/** Every elite affix, plus the explicit "no affix" row. */
export function affixOptions(): MenuOption[] {
  return [{ id: '', label: '(no affix)' }, ...AFFIXES.map((a) => ({ id: a.id, label: a.namePrefix }))];
}

/** Every boss, by display name — so a `bossKills` entry the panel offers always resolves. */
export function bossOptions(): MenuOption[] {
  return (Object.keys(BOSSES) as BossId[]).map((id) => ({ id, label: BOSSES[id].name }));
}

// ------- The status line ------------------------------------------------------

/** The plain-data status readout the panel prints. Karma included — developer surface. */
export interface DevStatus {
  act: number;
  place: number;
  xp: number;
  level: number;
  hp: number;
  maxHp: number;
  phase: string;
  karma: KarmaState;
}

/** Project a live state to the panel's status line — PURE, no DOM. */
export function devStatus(state: GameState): DevStatus {
  const player = state.player;
  return {
    act: state.act,
    place: state.place,
    xp: player?.xp ?? 0,
    level: player?.level ?? 0,
    hp: player?.hp ?? 0,
    maxHp: player?.maxHp ?? 0,
    phase: state.phase.kind,
    karma: { ...state.karma },
  };
}
