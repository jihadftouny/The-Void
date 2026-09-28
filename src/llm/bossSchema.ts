// THE BOSS ANSWER SCHEMAS — the JSON shape each boss call is grammar-constrained to
// (`docs/BOSS-PROMPTS.md` §1–§2), plus a small validator for exactly those shapes.
//
// WHY THE SCHEMA IS BUILT HERE AND NOT IN ELECTRON. The legal move ids ARE the engine's legal
// set, and the concession enum IS what the engine says is still available. Building the schema
// in the pure layer, from the request, means the grammar the model is held to and the check the
// renderer applies afterwards come from ONE function — an illegal move is impossible to write,
// and if the channel ever carried one anyway, `validateAgainst` would refuse it.
//
// The objects are shaped for node-llama-cpp's `createGrammarForJsonSchema` (its `GbnfJsonSchema`
// subset: object/properties, enum, string/maxLength). They are typed locally so this pure layer
// imports nothing from the native library. `required` lists every key — the grammar makes every
// key required anyway, and the validator reads it.
//
// PURE: no clock, no randomness, no DOM/Electron/log import.

/** A string with a length ceiling. */
export interface StringSchema {
  type: 'string';
  maxLength: number;
}

/** A closed set of ids. */
export interface EnumSchema {
  enum: readonly string[];
}

export type PropertySchema = StringSchema | EnumSchema;

/** The only top-level shape a boss answers in: a flat object of known keys. */
export interface BossAnswerSchema {
  type: 'object';
  properties: Readonly<Record<string, PropertySchema>>;
  required: readonly string[];
  additionalProperties: false;
}

/** Character ceilings (a 25/30/40-word line fits well inside each). */
export const LINE_MAX_CHARS = 220;
export const REPLY_MAX_CHARS = 240;
export const SCENE_MAX_CHARS = 320;

function objectSchema(properties: Record<string, PropertySchema>): BossAnswerSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/** Turn: `{ move: <one of the legal ids, in the engine's order>, line }`. */
export function turnSchema(legalIds: readonly string[]): BossAnswerSchema {
  return objectSchema({
    move: { enum: [...legalIds] },
    line: { type: 'string', maxLength: LINE_MAX_CHARS },
  });
}

/**
 * Talk: `{ reply, concession: 'none' | <still available> }`. With nothing available — the
 * executioner, or a boss that has already yielded this fight — there is NO concession key at
 * all, so the model cannot even write "none" and nothing can be mistaken for a yield.
 */
export function talkSchema(available: readonly string[]): BossAnswerSchema {
  const reply: StringSchema = { type: 'string', maxLength: REPLY_MAX_CHARS };
  return available.length === 0
    ? objectSchema({ reply })
    : objectSchema({ reply, concession: { enum: ['none', ...available] } });
}

/** Scene (the Warden): `{ line }`, longer. */
export function sceneSchema(): BossAnswerSchema {
  return objectSchema({ line: { type: 'string', maxLength: SCENE_MAX_CHARS } });
}

/** Why a value does not fit a schema — which key, and how — or `ok`. */
export type SchemaCheck = { ok: true } | { ok: false; key: string | null; problem: string };

const isEnum = (s: PropertySchema): s is EnumSchema => 'enum' in s;

/**
 * Check a parsed answer against one of the schemas above. PURE; never throws. Only the shapes
 * this module emits are understood: an object with exactly the listed keys, each an enum member
 * or a string within its ceiling.
 */
export function validateAgainst(schema: BossAnswerSchema, value: unknown): SchemaCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, key: null, problem: 'not an object' };
  }
  const record = value as Record<string, unknown>;
  for (const key of schema.required) {
    if (!(key in record)) return { ok: false, key, problem: 'missing' };
  }
  for (const key of Object.keys(record)) {
    const prop = schema.properties[key];
    if (prop === undefined) return { ok: false, key, problem: 'not allowed' };
    const v = record[key];
    if (isEnum(prop)) {
      if (typeof v !== 'string' || !prop.enum.includes(v)) return { ok: false, key, problem: 'not one of the listed ids' };
    } else {
      if (typeof v !== 'string') return { ok: false, key, problem: 'not a string' };
      if (v.length > prop.maxLength) return { ok: false, key, problem: 'too long' };
    }
  }
  return { ok: true };
}
