import { describe, expect, it } from 'vitest';
import { generateDraft, applyDraftOption, describeDraftOption, type DraftOption } from './draft.ts';
import { createPlayer, type Player } from './player.ts';
import { resolveSkill } from './skill.ts';
import { createBattle, resolveRound } from './battle.ts';
import { generateEnemy } from './enemy.ts';
import { makeCondition } from './condition.ts';
import { mulberry32, type Rng } from './rng.ts';
import { computeStatMod, type Stats } from './character.ts';

// A stat set with every score 13 (mod +1). Enforcer core skillPool = [heavyStrike, brace];
// kit = [heavyStrike, brace, intimidate, execute].
function stats(overrides: Partial<Stats> = {}): Stats {
  return { STR: 13, DEX: 13, CON: 13, INT: 13, WIS: 13, CHA: 13, ...overrides };
}
function enforcer(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ name: 'Ari', classId: 'Enforcer', stats: stats() }), ...overrides };
}

/** A deterministic rng yielding a fixed float sequence (then 0). */
function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

describe('generateDraft — documented draw order, hand-derived from a scripted rng', () => {
  // Fresh Enforcer. Per slot: draw1 = category via weightedPick over entries
  // [skill:3, upgrade:3, perk:2, stat:2] (total 10, r = 1 + floor(x*10)); draw2 = uniform
  // pick within the category (index = floor(y*len)).
  //   Slot 1: x=0.05 -> r=1 -> skill; skills=[intimidate,execute] (kit \ core); y=0.1 -> idx0
  //           -> intimidate.
  //   Slot 2: x=0.85 -> r=9 -> stat; stats=[STR,DEX,CON,INT,WIS,CHA]; y=0.5 -> idx3 -> INT.
  //   Slot 3: x=0.65 -> r=7 -> perk; perks=[sharpEdge,wardingCharm,deepReserves]; y=0.1 -> idx0
  //           -> sharpEdge.
  it('produces the exact 3 hand-derived options', () => {
    const rng = scriptedRng([0.05, 0.1, 0.85, 0.5, 0.65, 0.1]);
    const offers = generateDraft(enforcer(), rng);
    expect(offers).toEqual([
      { kind: 'skill', skillId: 'intimidate' },
      { kind: 'stat', stat: 'INT' },
      { kind: 'perk', perkId: 'sharpEdge' },
    ]);
  });

  it('offers exactly 3 distinct options of valid kinds', () => {
    const offers = generateDraft(enforcer(), mulberry32(4242));
    expect(offers).toHaveLength(3);
    const validKinds = new Set(['skill', 'upgrade', 'perk', 'stat']);
    for (const o of offers) expect(validKinds.has(o.kind)).toBe(true);
    // Distinct (no two identical options in one draft).
    const keys = offers.map((o) => JSON.stringify(o));
    expect(new Set(keys).size).toBe(3);
  });

  it('a fresh player can be offered a not-yet-owned kit skill, never an owned one', () => {
    const player = enforcer();
    // Search several seeds to find a draft that includes a skill option (kit \ core is
    // non-empty for a fresh Enforcer, so this is reachable).
    let sawSkill = false;
    for (let s = 0; s < 50; s++) {
      for (const o of generateDraft(player, mulberry32(s))) {
        if (o.kind === 'skill') {
          sawSkill = true;
          expect(player.skillPool).not.toContain(o.skillId); // never an already-owned skill
        }
      }
    }
    expect(sawSkill).toBe(true);
  });

  it('is deterministic: same seed + same player -> byte-identical offers', () => {
    const a = generateDraft(enforcer(), mulberry32(99));
    const b = generateDraft(enforcer(), mulberry32(99));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('applyDraftOption — each kind applies exactly', () => {
  it('stat: +1 to the attribute and recomputes its mod', () => {
    const player = enforcer(); // STR 13 -> mod 1
    expect(player.mods.STR).toBe(1);
    const { player: out } = applyDraftOption(player, { kind: 'stat', stat: 'STR' });
    expect(out.stats.STR).toBe(14);
    expect(out.mods.STR).toBe(computeStatMod(14)); // 2
    // Purity: input untouched.
    expect(player.stats.STR).toBe(13);
  });

  it('skill: adds the id to skillPool (and it was not owned before)', () => {
    const player = enforcer();
    expect(player.skillPool).not.toContain('intimidate');
    const { player: out } = applyDraftOption(player, { kind: 'skill', skillId: 'intimidate' });
    expect(out.skillPool).toEqual(['heavyStrike', 'brace', 'intimidate']);
  });

  it('upgrade: folds via applySkillUpgrade so resolveSkill returns base + bonus', () => {
    const player = enforcer(); // heavyStrike base damage 3
    const opt: DraftOption = { kind: 'upgrade', skillId: 'heavyStrike', upgrade: { damageBonus: 2 } };
    const { player: out } = applyDraftOption(player, opt);
    expect(resolveSkill(out, 'heavyStrike').baseDamage).toBe(5);
  });

  it('perk sharpEdge: pushes the id (no charge change)', () => {
    const player = enforcer();
    const { player: out } = applyDraftOption(player, { kind: 'perk', perkId: 'sharpEdge' });
    expect(out.perks).toEqual(['sharpEdge']);
    expect(out.maxSkillCharges).toBe(player.maxSkillCharges); // unchanged
  });

  it('perk deepReserves: +1 maxSkillCharges and refills skillCharges to the new max', () => {
    const player = enforcer({ skillCharges: 1, maxSkillCharges: 5 });
    const { player: out } = applyDraftOption(player, { kind: 'perk', perkId: 'deepReserves' });
    expect(out.perks).toEqual(['deepReserves']);
    expect(out.maxSkillCharges).toBe(6);
    expect(out.skillCharges).toBe(6); // refilled to the new max -> one extra cast available
  });
});

describe('describeDraftOption', () => {
  it('labels each kind readably', () => {
    expect(describeDraftOption({ kind: 'skill', skillId: 'intimidate' })).toBe('Learn Intimidate');
    expect(describeDraftOption({ kind: 'stat', stat: 'STR' })).toBe('+1 STR');
    expect(describeDraftOption({ kind: 'perk', perkId: 'sharpEdge' })).toBe('+1 damage');
    expect(describeDraftOption({ kind: 'upgrade', skillId: 'heavyStrike', upgrade: { damageBonus: 2 } })).toContain('+2 damage');
  });
});

describe('new-skill draft pick: a previously un-castable kit skill becomes castable', () => {
  // A frozen enemy skips its turn (0 draws) so the cast round draws nothing (scriptedRng([])).
  function frozenEnemy() {
    return {
      ...generateEnemy({ act: 1, type: 'Beast', playerXp: 0 }, mulberry32(5)),
      hp: 200,
      maxHp: 200,
      resistances: [0, 0, 0, 0, 0, 0, 0],
      skillPool: [] as string[],
      skillCharges: 0,
      activeConditions: [makeCondition('freeze')],
    };
  }

  it('intimidate is cast-unavailable before the pick and casts for 1 damage after', () => {
    const enemy = frozenEnemy();
    const before = enforcer({ hp: 30, maxHp: 30, skillCharges: 5 });
    const rBefore = resolveRound(createBattle(before, enemy, 1), { kind: 'cast', skillId: 'intimidate' }, scriptedRng([]));
    expect(rBefore.events).toContainEqual({ kind: 'cast-unavailable' });
    expect(rBefore.state.enemy.hp).toBe(200); // no damage — intimidate not owned

    const after = applyDraftOption(before, { kind: 'skill', skillId: 'intimidate' }).player;
    const rAfter = resolveRound(createBattle(after, enemy, 1), { kind: 'cast', skillId: 'intimidate' }, scriptedRng([]));
    // intimidate base 1 (Psychic) vs 0 resist, no INT augment -> 1 damage. 200 - 1 = 199.
    expect(rAfter.state.enemy.hp).toBe(199);
    expect(rAfter.events).toContainEqual({
      kind: 'skill-cast', subject: 'player', skillId: 'intimidate', name: 'Intimidate', damage: 1,
      damageSources: [{ kind: 'skill', amount: 1 }],
    });
  });
});
