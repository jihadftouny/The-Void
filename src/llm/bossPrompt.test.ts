// The boss prompt builder, against BOSS-PROMPTS §2–§4 and the plan's AC-3/4/5/6/7/8/12.
// Expected strings are derived by hand from the document and the fixtures, never read back.
import { describe, it, expect } from 'vitest';
import { buildVocabulary, detectTextFaults, ENGINE_TEXT_RULES } from './textHygiene.ts';
import {
  BOSS_SETTINGS,
  TALK_JUDGE_TASK,
  MAX_EXCHANGES,
  buildBossPrompt,
  filterDeeds,
  toIpcRequest,
} from './bossPrompt.ts';
import type { BossPersona, BossPersonaId, BossRequest } from './bossContract.ts';
import {
  DIGIT_DEED,
  FIXTURE_CLASS,
  FIXTURE_DEEDS,
  FIXTURE_EXCHANGES,
  FIXTURE_LAST_LINES,
  FIXTURE_NAME,
  FIXTURE_PERSONAS,
  FIXTURE_PERSONA_LIST,
  fight,
  fixtureRequests,
  kindsFor,
  sceneRequest,
  talkRequest,
  turnRequest,
  worstCaseRequests,
} from './bossFixtures.testutil.ts';

const P = (id: BossPersonaId): BossPersona => FIXTURE_PERSONAS[id];
const REQUESTS = fixtureRequests();

// The §2 block headers, in §2 order (plan §5.4 expands slot 7 and 8 per call kind). Each USER
// block begins with exactly one of these.
const HEADERS: readonly [string, RegExp][] = [
  ['who', /^WHO YOU ARE FACING: /],
  ['memory', /^WHAT THEY DID:\n- /],
  ['karma', /^WHAT THEY ARE: /],
  ['fight', /^THE FIGHT NOW:\nYou: .+\.\nThem: .+\.\nThis is (the \w+|a late) exchange\.$/],
  ['last-lines', /^YOUR LAST LINES:\n- /],
  ['blow', /^THIS BLOW IS FOR: /],
  ['player-just', /^THE PLAYER JUST: /],
  ['conversation', /^THE CONVERSATION SO FAR \(they speak, then you\):\nThem: "/],
  ['they-said', /^THEY JUST SAID: "/],
  ['verdict', /^VERDICT: grace\. SAY THEIR FULL NAME ONCE: /],
  ['moves', /^YOUR MOVES:\n- /],
  ['judge', /^HOW YOU JUDGE THEM:\n/],
  ['yield', /^You have yielded already/],
  ['task', /^TASK: /],
];

/** Read the blocks back out of the USER string by their headers alone. */
function headersOf(user: string): string[] {
  return user.split('\n\n').map((block) => {
    const hit = HEADERS.find(([, re]) => re.test(block));
    return hit ? hit[0] : `UNKNOWN: ${block.slice(0, 40)}`;
  });
}

const ORDER = HEADERS.map(([id]) => id);
const inOrder = (ids: string[]): boolean =>
  ids.every((id, i) => i === 0 || ORDER.indexOf(ids[i - 1] as string) < ORDER.indexOf(id));

describe('AC-3: the USER block has the §2 blocks in §2 order; SYSTEM is card + examples + moves + rules', () => {
  it('covers every persona and every kind it makes', () => {
    const seen = new Set(REQUESTS.map((r) => `${r.persona.id}/${r.kind}`));
    for (const p of FIXTURE_PERSONA_LIST) for (const k of kindsFor(p.id)) expect(seen.has(`${p.id}/${k}`)).toBe(true);
    expect(seen.size).toBe(20);
  });

  it('every block is recognised, every block is in order, and the kind\'s own blocks are present', () => {
    for (const req of REQUESTS) {
      const built = buildBossPrompt(req);
      const ids = headersOf(built.user);
      const where = `${req.persona.id}/${req.kind}: ${ids.join(' > ')}`;
      expect(ids.filter((i) => i.startsWith('UNKNOWN')), where).toEqual([]);
      expect(inOrder(ids), where).toBe(true);
      expect(new Set(ids).size, `${where} — a block appears twice`).toBe(ids.length);
      expect(ids[0], where).toBe('who');
      expect(ids[ids.length - 1], where).toBe('task');
      // The builder's own block list agrees with what the string says.
      expect(built.blocks.map((b) => b.id), where).toEqual(ids);
      if (req.kind === 'turn') {
        for (const must of ['fight', 'player-just', 'moves']) expect(ids, where).toContain(must);
        for (const never of ['conversation', 'they-said', 'yield', 'verdict', 'judge']) expect(ids, where).not.toContain(never);
      } else if (req.kind === 'talk') {
        expect(ids, where).toContain('they-said');
        expect(ids, where).toContain('judge');
        for (const never of ['last-lines', 'moves', 'player-just', 'blow', 'verdict']) expect(ids, where).not.toContain(never);
      } else {
        for (const never of ['fight', 'moves', 'yield', 'conversation', 'player-just']) expect(ids, where).not.toContain(never);
      }
    }
  });

  it('SYSTEM = card, then examples, then the rules with the name rule filled (judge round 1: what moves it left SYSTEM)', () => {
    for (const req of REQUESTS) {
      const { system } = buildBossPrompt(req);
      const p = req.persona;
      const parts = system.split('\n\n');
      const where = `${p.id}/${req.kind}`;
      expect(parts[0], where).toBe(p.card);
      expect(parts[1]?.startsWith('Your voice, for example (never repeat one of these word for word):\n- '), where).toBe(true);
      expect(parts[2]?.startsWith('RULES — never break these:\n'), where).toBe(true);
      expect(parts.length, where).toBe(3);
      expect(system, `${where}: what moves it belongs next to the task, not in SYSTEM`).not.toContain(p.talk.moves);
      expect(system, where).not.toContain('{NAME_RULE}');
      expect(system, where).not.toContain('{name}');
      expect(system, where).not.toContain('{');
      const ruleLine = p.nameRule.text.split('{name}').join(FIXTURE_NAME);
      expect(parts[2], where).toContain(`\n- ${ruleLine}\n`.replace(/\n$/, ''));
    }
  });

  it('only a Turn is told "choose a move" — never a Scene, and never a Talk (it has no moves)', () => {
    const scene = buildBossPrompt(sceneRequest(P('warden'))).system;
    expect(scene).not.toContain('Choose exactly one of YOUR MOVES');
    for (const id of ['kingpin', 'hollow', 'sin-grief'] as const) {
      expect(buildBossPrompt(talkRequest(P(id))).system, id).not.toContain('Choose exactly one of YOUR MOVES');
    }
    expect(scene.endsWith('- You do not know their name until the verdict.')).toBe(true);
    for (const id of ['kingpin', 'hollow', 'executioner'] as const) {
      expect(buildBossPrompt(turnRequest(P(id), fight([20, 20, []], [20, 20, []], 1))).system.endsWith(
        '- Choose exactly one of YOUR MOVES.',
      )).toBe(true);
    }
  });

  it('the rules are §3, word for word', () => {
    const rules = buildBossPrompt(turnRequest(P('kingpin'), fight([20, 20, []], [20, 20, []], 1))).system.split('\n\n')[2];
    expect(rules).toBe(
      [
        'RULES — never break these:',
        '- Speak to the player as "you". One or two short sentences. Never more than 25 words.',
        '- Never say a number, and never use game words: no HP, damage, round, turn, skill, charge, XP, level.',
        '- Never name a condition as a label (not "Bleed", "Slow", "Healthy"). Describe what it does instead.',
        '- Places have names. Say "the Undercity", "the Entrance to the Void", "the Ash City",',
        '  "the Angelic Underground", "the True Void". Never "floor two" or "the second floor".',
        '- The Void is not a place you are in. Never say "in the Void", "into the Void", "to the Void".',
        '- Never use the word "hollow" except as a name you were given. Never say "made whole".',
        '- Do not begin with "The air".  Do not repeat any of your last lines.',
        '- Call them by their name, Marcus, warmly.',
        '- Choose exactly one of YOUR MOVES.',
      ].join('\n'),
    );
  });
});

/** The USER block with its one sanctioned id surface removed: YOUR MOVES. (A Talk call names no concession id.) */
function withoutIdSurfaces(user: string): string {
  return user
    .split('\n\n')
    .filter((b) => !b.startsWith('YOUR MOVES:\n'))
    .join('\n\n');
}

describe('AC-4: no number, no label, no id reaches the model', () => {
  const vocab = buildVocabulary();

  it('over every fixture request: no digit, and no engine-text fault', () => {
    for (const req of REQUESTS) {
      const scanned = withoutIdSurfaces(buildBossPrompt(req).user);
      const where = `${req.persona.id}/${req.kind}`;
      expect(scanned.match(/\d/g), `${where}: a digit reaches the model\n${scanned}`).toBeNull();
      expect(detectTextFaults(scanned, vocab, { rules: ENGINE_TEXT_RULES }).faults, `${where}\n${scanned}`).toEqual([]);
    }
  });

  it('move ids appear ONLY inside YOUR MOVES', () => {
    for (const req of REQUESTS) {
      if (req.kind !== 'turn') continue;
      const scanned = withoutIdSurfaces(buildBossPrompt(req).user);
      for (const m of req.moves) expect(scanned.includes(m.id), `${req.persona.id}: ${m.id} leaked`).toBe(false);
    }
  });

  it('the sweep is live: a digit or an id outside the sanctioned blocks IS caught', () => {
    // Break it the way it would really break: a fixture deed with a digit, handed straight to
    // the fight block's neighbour (the executioner's blow), and a raw id in the player's action.
    const req = turnRequest(P('reflection'), fight([6, 20, ['bleed']], [6, 20, []], 3), { playerJust: 'used cast:heavyStrike' });
    const scanned = withoutIdSurfaces(buildBossPrompt(req).user);
    expect(detectTextFaults(scanned, vocab, { rules: ENGINE_TEXT_RULES }).faults.length).toBeGreaterThan(0);
    expect(/\d/.test(withoutIdSurfaces(buildBossPrompt(turnRequest(P('kingpin'), fight([1, 20, []], [1, 20, []], 1), { playerJust: 'hit you for 6' })).user))).toBe(true);
  });
});

describe('AC-5: the fight block anchors', () => {
  it('hp 6/20 + bleeding + slowed, and the exchange word', () => {
    const user = buildBossPrompt(turnRequest(P('kingpin'), fight([6, 20, ['bleed', 'slow']], [20, 20, []], 4))).user;
    expect(user).toContain('THE FIGHT NOW:\nYou: badly hurt, bleeding, moving slowly.\nThem: untouched.\nThis is the fourth exchange.');
  });
  it('the other HP words', () => {
    const at = (hp: number) => buildBossPrompt(turnRequest(P('kingpin'), fight([hp, 20, []], [20, 20, []], 1))).user;
    expect(at(15)).toContain('You: barely touched.');
    expect(at(10)).toContain('You: hurt.');
    expect(at(4)).toContain('You: near the end.');
  });
});

describe('AC-6: deeds per boss (§4 filter table)', () => {
  const memory = (id: BossPersonaId) => filterDeeds(P(id), FIXTURE_DEEDS).sentences;

  it('the Kingpin hears the Undercity only, newest first', () => {
    // FIXTURE_DEEDS floor 1, oldest first: spared Fixer · killed Ganger · beat the Kingpin.
    expect(memory('kingpin')).toEqual([
      'In the Undercity you beat the Kingpin.',
      'In the Undercity you killed a Ganger you could have spared.',
      'In the Undercity you spared the Fixer.',
    ]);
  });

  it('the Reflection hears everything, newest first, eight at most', () => {
    const got = memory('reflection');
    expect(got).toHaveLength(8);
    // The newest fixture deed is the Ash Walker killed on floor 3; the eighth-newest is the
    // illusion seen on floor 2 (twelve deeds; the eight newest are indices 11 down to 4).
    expect(got[0]).toBe('In the Ash City you killed an Ash Walker you could have spared.');
    expect(got[7]).toBe('In the Entrance to the Void you saw through a lie the place told you.');
  });

  it('a Sin hears only its own axis', () => {
    // mercyCruelty deeds, newest first: Ash Walker (f3), Echo spared (f5), Choir Warden (f4),
    // Ganger (f1), Fixer spared (f1).
    expect(memory('sin-cruelty')).toEqual([
      'In the Ash City you killed an Ash Walker you could have spared.',
      'In the True Void you spared the Echo.',
      'In the Angelic Underground you killed a Choir Warden you could have spared.',
      'In the Undercity you killed a Ganger you could have spared.',
      'In the Undercity you spared the Fixer.',
    ]);
    expect(memory('sin-avarice')).toEqual(['At an altar in the Entrance to the Void you gave up your patience for a ring.']);
    expect(memory('sin-desecration')).toEqual([
      'At an altar in the Angelic Underground you left a worn blade as an offering and took a sharper one.',
      'In the Ash City you broke an altar to take what was on it.',
    ]);
    expect(memory('sin-delusion')).toEqual([
      'At an altar in the Ash City you listened to the whisper and took what it offered.',
      'In the Entrance to the Void you saw through a lie the place told you.',
    ]);
  });

  it('the Grief hears nothing — and the block is omitted', () => {
    expect(memory('sin-grief')).toEqual([]);
    const user = buildBossPrompt(turnRequest(P('sin-grief'), fight([20, 20, []], [20, 20, []], 1))).user;
    expect(user).not.toContain('WHAT THEY DID');
  });

  it('scope "none" means none, whatever the cap says', () => {
    // The Grief fixture pairs `none` with `max: 0`, which would hide a lost scope check. Real
    // persona data may well write `{ scope: 'none', max: 10 }`.
    const grief: BossPersona = { ...P('sin-grief'), deeds: { scope: 'none', max: 10 } };
    expect(filterDeeds(grief, FIXTURE_DEEDS)).toEqual({ sentences: [], dropped: [] });
    const built = buildBossPrompt(turnRequest(grief, fight([20, 20, []], [20, 20, []], 1)));
    expect(built.user).not.toContain('WHAT THEY DID');
    expect(built.blocks.map((b) => b.id)).not.toContain('memory');
  });

  it('the Warden, the executioner and the Hollow Self hear everything, ten at most', () => {
    for (const id of ['warden', 'executioner', 'hollow'] as const) {
      const got = memory(id);
      expect(got, id).toHaveLength(10);
      expect(got[0], id).toBe('In the Ash City you killed an Ash Walker you could have spared.');
    }
  });

  it('a deed whose sentence has a digit is DROPPED and reported, never sent', () => {
    const deeds = [...FIXTURE_DEEDS, DIGIT_DEED];
    const result = filterDeeds(P('hollow'), deeds);
    expect(result.dropped).toEqual([DIGIT_DEED]);
    expect(result.sentences.join(' ')).not.toMatch(/\d/);
    expect(result.sentences).toHaveLength(10);
    const built = buildBossPrompt(turnRequest(P('hollow'), fight([20, 20, []], [20, 20, []], 1), { deeds }));
    expect(built.dropped).toEqual([DIGIT_DEED]);
    expect(built.user).not.toContain('Ganger 2');
    // The executioner's blow is dropped the same way.
    const blow = buildBossPrompt(turnRequest(P('executioner'), fight([20, 20, []], [20, 20, []], 1), { blowFor: DIGIT_DEED }));
    expect(blow.user).not.toContain('THIS BLOW IS FOR');
    expect(blow.dropped).toContain(DIGIT_DEED);
  });

  it('the executioner names the one deed this blow is for', () => {
    const user = buildBossPrompt(turnRequest(P('executioner'), fight([20, 20, []], [20, 20, []], 1))).user;
    expect(user).toContain('THIS BLOW IS FOR: In the Undercity you killed a Ganger you could have spared.');
  });
});

describe('AC-7 (prompt half): name discipline by mode', () => {
  const count = (s: string) => s.split(FIXTURE_NAME).length - 1;

  it('given (Kingpin, Sins): the name is in WHO YOU ARE FACING and in the rule', () => {
    for (const id of ['kingpin', 'sin-cruelty', 'sin-grief'] as const) {
      const built = buildBossPrompt(turnRequest(P(id), fight([20, 20, []], [20, 20, []], 1)));
      expect(built.user, id).toContain(`WHO YOU ARE FACING: ${FIXTURE_NAME}, an ${FIXTURE_CLASS}.`);
      expect(built.system, id).toContain(P(id).nameRule.text.split('{name}').join(FIXTURE_NAME));
    }
  });

  it('own (Reflection, Hollow Self): the name is only in the rule sentence and the examples', () => {
    for (const id of ['reflection', 'hollow'] as const) {
      for (const req of [turnRequest(P(id), fight([20, 20, []], [20, 20, []], 1)), talkRequest(P(id))] as BossRequest[]) {
        const built = buildBossPrompt(req);
        expect(built.user, id).toContain(`WHO YOU ARE FACING: an ${FIXTURE_CLASS}.`);
        expect(count(built.user), id).toBe(0);
        const lines = built.system.split('\n').filter((l) => l.includes(FIXTURE_NAME));
        expect(lines.length, id).toBeGreaterThan(0);
        for (const l of lines) {
          const isRule = l === `- ${P(id).nameRule.text.split('{name}').join(FIXTURE_NAME)}`;
          const isExample = P(id).examples.some((e) => l === `- ${e.split('{name}').join(FIXTURE_NAME)}`);
          expect(isRule || isExample, `${id}: "${l}"`).toBe(true);
        }
      }
    }
  });

  it('forbidden (Warden before the verdict, executioner): the name is nowhere', () => {
    const calls: BossRequest[] = [
      sceneRequest(P('warden')),
      talkRequest(P('warden')),
      turnRequest(P('executioner'), fight([20, 20, []], [20, 20, []], 1)),
      talkRequest(P('executioner')),
    ];
    for (const req of calls) {
      const built = buildBossPrompt(req);
      expect(count(built.system) + count(built.user), `${req.persona.id}/${req.kind}`).toBe(0);
      expect(built.user).toContain(`WHO YOU ARE FACING: an ${FIXTURE_CLASS}.`);
    }
  });

  it('the Warden\'s verdict call is the ONE call that carries the name, once', () => {
    const built = buildBossPrompt(sceneRequest(P('warden'), { verdict: { outcome: 'grace', name: FIXTURE_NAME } }));
    expect(built.user).toContain(`VERDICT: grace. SAY THEIR FULL NAME ONCE: ${FIXTURE_NAME}.`);
    expect(count(built.user)).toBe(1);
    expect(count(built.system)).toBe(0);
    // Its example that needs the name was dropped, not filled.
    expect(built.system).not.toContain('verdict: "');
  });
});

describe('AC-8: each call is held to its schema', () => {
  it('Turn: the enum is the request\'s legal ids, in order', () => {
    const req = turnRequest(P('kingpin'), fight([20, 20, []], [20, 20, []], 1));
    expect(buildBossPrompt(req).schema.properties.move).toEqual({ enum: ['strike', 'call_crew', 'hold_back'] });
  });
  it('Talk: judged (reason, earned, reply) while something is available; the executioner and a boss that yielded are not', () => {
    const kingpin = buildBossPrompt(talkRequest(P('kingpin')));
    expect(Object.keys(kingpin.schema.properties)).toEqual(['reason', 'earned', 'reply']);
    expect(kingpin.user).not.toContain('- demand:');
    expect(kingpin.schema.properties.earned).toEqual({ enum: ['no', 'yes'] });
    // No concession id reaches the model: not in the schema, and no list of them in the prompt. ("surrender"
    // may appear as an English verb in the task's list of what never earns a yield.)
    for (const id of ['pause', 'weakness', 'drop_mechanic', 'surrender']) expect(JSON.stringify(kingpin.schema), id).not.toContain(id);
    expect(kingpin.user + kingpin.system).not.toMatch(/\b(pause|weakness|drop_mechanic)\b/);
    expect(kingpin.user).not.toContain('YOU MAY YIELD');
    expect(kingpin.user).toContain(`HOW YOU JUDGE THEM:\n${P('kingpin').talk.moves}`);
    expect(kingpin.user.endsWith(TALK_JUDGE_TASK)).toBe(true);
    const hollow = buildBossPrompt(talkRequest(P('hollow'))).user;
    expect(hollow).toContain(`HOW YOU JUDGE THEM:\n${P('hollow').talk.moves}\n${P('hollow').talk.judge}`);
    expect(Object.keys(buildBossPrompt(talkRequest(P('executioner'))).schema.properties)).toEqual(['reply']);
    const spent = buildBossPrompt(talkRequest(P('kingpin'), { available: [] }));
    expect(Object.keys(spent.schema.properties)).toEqual(['reply']);
    expect(spent.user).not.toContain(TALK_JUDGE_TASK);
    expect(spent.user).toContain('You have yielded already; you yield nothing more.');
    const exec = buildBossPrompt(talkRequest(P('executioner'))).user;
    expect(exec).not.toContain('YOU MAY YIELD');
    expect(exec).not.toContain('yielded already');
  });
  it('Scene: { line }', () => {
    expect(Object.keys(buildBossPrompt(sceneRequest(P('warden'))).schema.properties)).toEqual(['line']);
  });
});

describe('settings per call kind (BOSS-PROMPTS §2; plan §5.3 decision 5)', () => {
  it('the table', () => {
    expect(BOSS_SETTINGS.turn).toEqual({ temperature: 0.8, maxTokens: 80, deadlineMs: 3000, topP: 0.9 });
    // Judge round 1: every boss's Talk judge runs cold (0.3), with room for its reason (120 tokens).
    expect(BOSS_SETTINGS.talk).toEqual({ temperature: 0.3, maxTokens: 120, deadlineMs: 3000, topP: 0.9 });
    expect(BOSS_SETTINGS.scene).toEqual({ temperature: 0.8, maxTokens: 110, deadlineMs: 3000, topP: 0.9 });
  });
  it('the Hollow Self\'s Talk judge runs cold and pinned; its Turn does not', () => {
    expect(buildBossPrompt(talkRequest(P('hollow'))).settings).toEqual({ temperature: 0.2, maxTokens: 120, deadlineMs: 3000, topP: 0.9, seed: 1 });
    const turn = buildBossPrompt(turnRequest(P('hollow'), fight([20, 20, []], [20, 20, []], 1))).settings;
    expect(turn.temperature).toBe(0.8);
    expect('seed' in turn).toBe(false);
    expect(buildBossPrompt(talkRequest(P('kingpin'))).settings.temperature).toBe(0.3);
  });
});

describe('Talk trims what it does not need (plan §4 measurement)', () => {
  it('no YOUR LAST LINES, and only the last six exchanges', () => {
    const user = buildBossPrompt(talkRequest(P('hollow'))).user;
    expect(user).not.toContain('YOUR LAST LINES');
    expect(FIXTURE_EXCHANGES.length).toBeGreaterThan(MAX_EXCHANGES);
    const kept = FIXTURE_EXCHANGES.slice(-6);
    const cut = FIXTURE_EXCHANGES.slice(0, FIXTURE_EXCHANGES.length - 6);
    for (const x of kept) expect(user).toContain(`Them: "${x.them}"\nYou: ${x.you}`);
    for (const x of cut) expect(user).not.toContain(x.them);
    expect(user.match(/^Them: "/gm)).toHaveLength(6);
  });
  it('a Turn carries at most its last three lines', () => {
    const user = buildBossPrompt(turnRequest(P('kingpin'), fight([20, 20, []], [20, 20, []], 1))).user;
    const block = user.split('\n\n').find((b) => b.startsWith('YOUR LAST LINES:')) ?? '';
    expect(block.split('\n').slice(1)).toEqual(FIXTURE_LAST_LINES.slice(-3).map((l) => `- ${l}`));
  });
});

describe('AC-12: the token budget (measured 3.73 chars per token with the real tokenizer)', () => {
  const CHARS_PER_TOKEN = 3.73;
  // Judge round 1 (2026-09-29): 4,100 → 4,700 chars (≈ 1,260 tokens). The Talk judge task and each card's
  // yes/no test cost Talk calls ≈ 150–200 tokens (the Hollow Self's worst case is 4,639 chars ≈ 1,244 tokens;
  // the first real-model run of the judged shape measured a 1,256-token maximum with the chat template),
  // while every Turn prompt shrank by moving what-moves-it out of SYSTEM. Against the 4,096-token context
  // this still leaves more than 2,700 tokens of headroom.
  const CEILING = 4700;

  it('every persona and kind at worst-case inputs stays within the ceiling', () => {
    const report: string[] = [];
    for (const req of worstCaseRequests()) {
      const { system, user } = buildBossPrompt(req);
      const chars = system.length + user.length;
      report.push(`${req.persona.id}/${req.kind}: ${chars} chars ≈ ${Math.round(chars / CHARS_PER_TOKEN)} tokens`);
      expect(chars, report.join('\n')).toBeLessThanOrEqual(CEILING);
    }
    expect(report.length).toBe(20);
  });
});

describe('echoOf and the IPC request', () => {
  it('echoOf is every USER line', () => {
    const built = buildBossPrompt(talkRequest(P('kingpin')));
    expect(built.echoOf).toEqual(built.user.split('\n').filter((l) => l.trim() !== ''));
    expect(built.echoOf).toContain('Them: "So say it. Say you knew."');
  });

  it('the IPC request carries what the main process needs, as plain data', () => {
    const req = turnRequest(P('kingpin'), fight([20, 20, []], [20, 20, []], 1));
    const ipc = toIpcRequest(7, req);
    const built = buildBossPrompt(req);
    expect(ipc).toEqual({
      requestId: 7,
      kind: 'turn',
      persona: 'kingpin',
      system: built.system,
      prompt: built.user,
      schema: built.schema,
      settings: built.settings,
    });
    expect(JSON.parse(JSON.stringify(ipc))).toEqual(ipc);
  });

  it('the same request always builds the same prompt', () => {
    const req = talkRequest(P('hollow'));
    expect(buildBossPrompt(req)).toEqual(buildBossPrompt(req));
  });
});
