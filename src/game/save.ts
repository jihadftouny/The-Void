// Save / load for The Void — PURE, framework-agnostic persistence (M9).
//
// LOAD-BEARING PRINCIPLES honored here:
//  - Pure logic / render split: this module imports ONLY types/values from other
//    `src/game` modules. No Kaplay, DOM, `window`, or `localStorage` import lives
//    here — the browser adapter lives in `src/storage/localStorage.ts`, outside the
//    logic core. The DOM/browser glue is behind the `SaveStorage` seam.
//  - Deterministic seeded RNG: no `Math.random` / `Date.now`. `GameState` carries
//    the serializable `rngState` accumulator, so a decoded save resumes the exact
//    same RNG stream (see `rng.ts`'s `createRng` contract).
//  - Serializable plain-data state: a save is just `JSON.stringify(state)`; the save
//    format version IS `GameState.version` (no separate envelope wrapper).
//
// `decodeSave` VALIDATES and returns `null` on anything corrupt or incompatible —
// it never throws. The player-facing meaning of a `null` is "start a new game".

import { type GameState } from './game.ts';
import { createKarma } from './karma.ts';
import { createInventory } from './inventory.ts';
import { EQUIP_SLOTS } from './item.ts';
import { type PlayerClass } from './player.ts';

/**
 * The current save-format version. Single source of version truth: it mirrors the
 * current `GameState['version']` (there is no separate envelope). A save whose
 * embedded `version` is greater than this is from a future build and is rejected;
 * a lower version is routed through `migrate`.
 */
export const SAVE_VERSION = 6;

/** The valid `Phase.kind` discriminants (mirrors the `Phase` union in game.ts). */
const PHASE_KINDS: readonly string[] = [
  'title',
  'name-entry',
  'class-select',
  'stats-roll',
  'main-menu',
  'battle',
  'battle-victory',
  'rest',
  'deal',
  'chest',
  'act-outro',
  'level-up',
  'level-up-result',
  'act-intro',
  'ending',
  'game-over',
];

/** The five valid player classes (mirrors `PlayerClass`, defined in classKit.ts). */
const PLAYER_CLASSES: readonly PlayerClass[] = [
  'Enforcer',
  'Neuromancer',
  'Scavver',
  'Penitent',
  'Hollow',
];

// ------- Encode / decode -----------------------------------------------------

/**
 * Serialize a `GameState` to a canonical save string. "Canonical" = the plain
 * deterministic output of `JSON.stringify` over the already-ordered plain-data
 * state (fields keep the fixed insertion order from `createGame`/`step`). No
 * pretty-printing, so the same state always yields the same string.
 */
export function encodeSave(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Parse and validate a save string, returning the `GameState` or `null`. NEVER
 * throws for bad input. The pipeline:
 *  1. Parse JSON (bad syntax -> null).
 *  2. Reject non-object / array / null roots.
 *  3. Check `version`: non-number -> null; future (> SAVE_VERSION) -> null; older
 *     (< SAVE_VERSION) -> run `migrate`, and reject if it cannot upgrade.
 *  4. Validate the shape via `isValidGameState`; on pass return it, else null.
 */
export function decodeSave(json: string): GameState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }

  if (!isPlainObject(raw)) return null;

  const version = (raw as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isFinite(version)) return null;
  if (version > SAVE_VERSION) return null; // future save — this build can't read it
  if (version < SAVE_VERSION) {
    const migrated = migrate(raw, version);
    if (migrated === null) return null;
    raw = migrated;
  }

  return isValidGameState(raw) ? raw : null;
}

/**
 * Upgrade seam for old saves. Called only when `fromVersion < SAVE_VERSION`.
 * Structured as a version ladder so future format bumps slot in without touching
 * `decodeSave`: each `case` upgrades one step and bumps `current`.
 *
 * Today the reachable source versions are `1` (upgraded via `upgrade1to2` -> `upgrade2to3`
 * -> `upgrade3to4` -> `upgrade4to5` -> `upgrade5to6`), `2`, `3`, `4`, `5`, and anything `< 1`
 * (nothing to upgrade -> `null`, unsupported). The ladder composes: a v1 save gains an empty
 * inventory at 1->2, then its legacy equipped ids populate the paperdoll slots at 2->3, then
 * the M6 additive fields need no change at 3->4 (only a version stamp), then the M7 gold field
 * is DROPPED from the player at 4->5, then the M8 roster fields are additive/optional at 5->6
 * (only a version stamp). Returns the upgraded plain value (still unvalidated — `decodeSave`
 * validates the result), or `null` if the source version cannot be migrated.
 */
function migrate(raw: unknown, fromVersion: number): unknown | null {
  let current = fromVersion;
  let value = raw;
  while (current < SAVE_VERSION) {
    switch (current) {
      case 1:
        value = upgrade1to2(value);
        current = 2;
        break;
      case 2:
        value = upgrade2to3(value);
        current = 3;
        break;
      case 3:
        value = upgrade3to4(value);
        current = 4;
        break;
      case 4:
        value = upgrade4to5(value);
        current = 5;
        break;
      case 5:
        value = upgrade5to6(value);
        current = 6;
        break;
      default:
        return null; // unknown / unsupported source version — cannot migrate
    }
  }
  return value;
}

/**
 * Migrate a v1 save (no `karma`, player with no `inventory`) to the v2 shape by
 * INJECTING the defaults M1 added: a neutral karma vector, and — when a player is
 * present — an empty inventory. Pure: it shallow-clones the parsed plain object and
 * fills only the absent fields, then stamps `version = 2`. A non-object input is
 * returned unchanged so the caller's validation rejects it.
 */
function upgrade1to2(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const next: Record<string, unknown> = { ...raw };
  if (!('karma' in next) || next.karma === undefined) {
    next.karma = createKarma();
  }
  if (isPlainObject(next.player)) {
    const player = next.player as Record<string, unknown>;
    if (!('inventory' in player) || player.inventory === undefined) {
      next.player = { ...player, inventory: createInventory() };
    }
  }
  next.version = 2;
  return next;
}

/**
 * Migrate a v2 save (player with legacy `equipped*Id` fields, paperdoll alongside) to the v3
 * shape (M5: the paperdoll is authoritative). When a player is present: ensure `inventory`
 * with a 9-slot record exists, MOVE `equippedWeaponId -> slots.mainHand`,
 * `equippedArmorId -> slots.armor`, and (if present) `equippedShieldId -> slots.offHand` as
 * `{ defId }` instances, then DELETE the three legacy fields. Pure: shallow-clones the parsed
 * plain object and rewrites only the player's inventory, then stamps `version = 3`. A
 * non-object input (or absent/null player) is returned with only the version stamped so the
 * caller's validation still runs.
 */
function upgrade2to3(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const next: Record<string, unknown> = { ...raw };
  if (isPlainObject(next.player)) {
    const player = { ...(next.player as Record<string, unknown>) };
    // Start from the existing inventory's slots (or a fresh empty 9-slot record).
    const existingInv = isPlainObject(player.inventory)
      ? (player.inventory as Record<string, unknown>)
      : {};
    const empty = createInventory();
    const slots: Record<string, unknown> = { ...empty.slots };
    if (isPlainObject(existingInv.slots)) {
      for (const slot of EQUIP_SLOTS) {
        const cell = (existingInv.slots as Record<string, unknown>)[slot];
        if (cell !== undefined) slots[slot] = cell;
      }
    }
    // Move each legacy id into its slot (only if a non-empty string is present).
    if (typeof player.equippedWeaponId === 'string' && player.equippedWeaponId !== '') {
      slots.mainHand = { defId: player.equippedWeaponId };
    }
    if (typeof player.equippedArmorId === 'string' && player.equippedArmorId !== '') {
      slots.armor = { defId: player.equippedArmorId };
    }
    if (typeof player.equippedShieldId === 'string' && player.equippedShieldId !== '') {
      slots.offHand = { defId: player.equippedShieldId };
    }
    const backpack = Array.isArray(existingInv.backpack) ? existingInv.backpack : [];
    delete player.equippedWeaponId;
    delete player.equippedArmorId;
    delete player.equippedShieldId;
    player.inventory = { slots, backpack };
    next.player = player;
  }
  next.version = 3;
  return next;
}

/**
 * Migrate a v3 save (M5 paperdoll) to the v4 shape (M6 items content). Every M6 addition
 * — `ItemInstance.rolled`, the extended `ItemEffect` union, `Player.shield`, the new
 * relic/unique/consumable catalogs — is OPTIONAL and additive, so a structurally valid v3
 * save is already a structurally valid v4 save. This step therefore only stamps
 * `version = 4`; a non-object input is returned with just the stamp so the caller's
 * validation still runs. (Kept as an explicit ladder rung so a future v5 slots in cleanly.)
 */
function upgrade3to4(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const next: Record<string, unknown> = { ...raw };
  next.version = 4;
  return next;
}

/**
 * Migrate a v4 save (M6 items content) to the v5 shape (M7 pure sacrifice economy). Gold is
 * retired: DELETE `player.gold` so an old save's balance simply vanishes. Everything else is
 * unchanged — the new loot/deal/chest state is additive and only appears in fresh v5 runs, so
 * a structurally valid v4 save minus its gold field is a structurally valid v5 save. Pure: it
 * shallow-clones the parsed plain object (and its player) and stamps `version = 5`; a
 * non-object input (or absent/null player) is returned with just the stamp so the caller's
 * validation still runs.
 */
function upgrade4to5(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const next: Record<string, unknown> = { ...raw };
  if (isPlainObject(next.player)) {
    const player = { ...(next.player as Record<string, unknown>) };
    delete player.gold;
    next.player = player;
  }
  next.version = 5;
  return next;
}

/**
 * Migrate a v5 save (M7 sacrifice economy) to the v6 shape (M8 enemy roster). Every M8
 * addition — the `Enemy.familyId` / `karmaWeighted` / `affixId?` fields — lives only inside
 * a mid-battle `phase.battle.enemy`, is additive/optional, and is not deep-validated by the
 * save guard, so a structurally valid v5 save is already a structurally valid v6 save (a
 * v5 mid-battle enemy simply reads `karmaWeighted` as falsy = non-weighted, which every
 * pre-M8 enemy was). This step therefore only stamps `version = 6`; a non-object input is
 * returned with just the stamp so the caller's validation still runs. (An explicit ladder
 * rung so a future v7 slots in cleanly, matching the upgrade3to4 precedent.)
 */
function upgrade5to6(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const next: Record<string, unknown> = { ...raw };
  next.version = 6;
  return next;
}

// ------- Shape guard ---------------------------------------------------------

/** True for a non-null, non-array object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True for a finite JS number (rejects NaN / Infinity / non-numbers). */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Shape guard for a decoded save. Checks the four task-named invariants —
 * `version`, `rngState` (finite number), `act`/`place` (numbers), and `phase`
 * (object with a known `kind`) — plus a top-level `player` envelope check
 * (`null`, or a plain object carrying the required Player/Character fields with
 * correct primitive types).
 *
 * VALIDATION DEPTH (deliberate scope choice): the guard does NOT recursively
 * validate each `Phase` variant's payload nor deep item/condition contents; once
 * `phase.kind` and the Player envelope are sound those are trusted. This keeps the
 * guard maintainable while covering the risky surface — version, RNG number, phase
 * kind, and player presence/shape.
 */
function isValidGameState(v: unknown): v is GameState {
  if (!isPlainObject(v)) return false;

  if (v.version !== SAVE_VERSION) return false;
  if (!isFiniteNumber(v.rngState)) return false;
  if (!isFiniteNumber(v.act)) return false;
  if (!isFiniteNumber(v.place)) return false;

  if (!isPlainObject(v.phase)) return false;
  if (typeof (v.phase as { kind?: unknown }).kind !== 'string') return false;
  if (!PHASE_KINDS.includes((v.phase as { kind: string }).kind)) return false;

  // Karma vector: a plain object whose four axes are all finite numbers.
  if (!isValidKarma(v.karma)) return false;

  // `player` is null before creation, otherwise a full Player envelope.
  if (v.player !== null && !isValidPlayer(v.player)) return false;

  return true;
}

/** Karma-vector check: a plain object with four finite-number axes. */
function isValidKarma(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return (
    isFiniteNumber(v.mercyCruelty) &&
    isFiniteNumber(v.restraintGreed) &&
    isFiniteNumber(v.reverenceDesecration) &&
    isFiniteNumber(v.clarityDelusion)
  );
}

/** Top-level Player field/type check (not recursive into items/conditions). */
function isValidPlayer(v: unknown): boolean {
  if (!isPlainObject(v)) return false;

  // Character + Player primitive fields.
  if (typeof v.name !== 'string') return false;
  if (!isFiniteNumber(v.hp)) return false;
  if (!isFiniteNumber(v.maxHp)) return false;
  if (!isFiniteNumber(v.xp)) return false;
  if (!isFiniteNumber(v.armorClass)) return false;
  if (!isFiniteNumber(v.proficiency)) return false;

  // Nested plain-object fields.
  if (!isPlainObject(v.stats)) return false;
  if (!isPlainObject(v.mods)) return false;

  // Class discriminant.
  if (typeof v.classId !== 'string') return false;
  if (!PLAYER_CLASSES.includes(v.classId as PlayerClass)) return false;

  // Equipment (M5): no legacy `equipped*Id` — the paperdoll `inventory` (checked below) is
  // the single source of truth for what is equipped.

  // Array fields.
  if (!Array.isArray(v.resistances)) return false;
  if (!Array.isArray(v.activeConditions)) return false;
  if (!Array.isArray(v.skillPool)) return false;

  // Inventory: a plain object with a `slots` record and a `backpack` array.
  // Shallow, matching this module's non-recursive validation depth — the per-slot
  // and per-instance contents are trusted once the container shape is sound.
  if (!isPlainObject(v.inventory)) return false;
  if (!isPlainObject((v.inventory as { slots?: unknown }).slots)) return false;
  if (!Array.isArray((v.inventory as { backpack?: unknown }).backpack)) return false;

  return true;
}

// ------- Storage seam --------------------------------------------------------

/**
 * The persistence seam: a minimal string store. The logic core depends only on
 * this interface; the browser `localStorage` adapter (in `src/storage`) and the
 * in-memory test double both satisfy it.
 */
export interface SaveStorage {
  load(): string | null;
  save(s: string): void;
  clear(): void;
}

/**
 * An in-memory `SaveStorage` — a single string cell. Useful in tests and headless
 * Node, where there is no `localStorage`.
 */
export function createMemoryStorage(): SaveStorage {
  let cell: string | null = null;
  return {
    load: () => cell,
    save: (s: string) => {
      cell = s;
    },
    clear: () => {
      cell = null;
    },
  };
}

/** Encode and persist a game state through the given storage. */
export function saveGame(state: GameState, storage: SaveStorage): void {
  storage.save(encodeSave(state));
}

/**
 * Load and decode a game state from storage. Returns `null` when nothing is
 * stored OR when the stored payload fails validation — the caller then starts a
 * new game.
 */
export function loadGame(storage: SaveStorage): GameState | null {
  const s = storage.load();
  return s == null ? null : decodeSave(s);
}
