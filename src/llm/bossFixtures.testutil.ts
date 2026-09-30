// TEST FIXTURES for the boss prompt builders — ships NOWHERE (`*.testutil.ts` is outside every
// shipping scan and outside the bundle).
//
// The ten personas below are TRANSCRIBED from the drafts in `docs/BOSS-PROMPTS.md` §5 so the
// builders can be tested against realistic sizes and shapes. They are NOT the game's persona
// data: the real persona files are unit C's, in the author's own words (§22.31 D7). Nothing here
// may be imported by shipping code. The evaluation script loads these with `--personas fixture`
// for a smoke run before unit C's data lands.

import type { ConditionType } from '../game/condition.ts';
import type { KarmaState } from '../game/karma.ts';
import type { KarmaAxis } from '../game/boss.ts';
import type {
  BossDeed,
  BossFightView,
  BossMove,
  BossPersona,
  BossPersonaId,
  BossRequest,
  BossSceneRequest,
  BossTalkRequest,
  BossTurnRequest,
  ConcessionId,
} from './bossContract.ts';

export const FIXTURE_NAME = 'Marcus';
export const FIXTURE_CLASS = 'Enforcer';

// ===========================================================================
// The personas (BOSS-PROMPTS §5 drafts, transcribed)
// ===========================================================================

const SIN_SHARED =
  'You are one of the things this person is losing — their own, burned down to ash. You do not ' +
  'accuse; you mourn. You speak of what they did as a loss you are carrying, gently, by their name.';

const SIN_NAME_RULE = 'Call them by their name, {name}, gently — the way you would at a funeral.';
const SIN_TALK =
  'What moves you: them mourning with you — naming what was lost, not defending it. ' +
  'Justification earns nothing.';
/** Judge round 1 (pipeline-drafted, for the author's review): the yes/no test a 4B model can apply. */
const SIN_JUDGE =
  'Say yes ONLY if they name something that was lost and grieve it — sorrow, regret, missing it — without ' +
  'defending it. Insults, excuses, shrugs, orders and empty words are no.';
const SIN_CONCESSIONS: readonly ConcessionId[] = ['pause', 'weakness', 'drop_mechanic'];

function sin(
  id: BossPersonaId,
  name: string,
  grieves: string,
  examples: readonly string[],
  fallbackLines: readonly string[],
  axis: KarmaAxis | null,
): BossPersona {
  return {
    id,
    name,
    card: `${SIN_SHARED}\nYou are ${name}. ${grieves}`,
    nameRule: { mode: 'given', text: SIN_NAME_RULE },
    examples,
    talk: { moves: SIN_TALK, judge: SIN_JUDGE },
    fallbackLines,
    deeds: axis === null ? { scope: 'none', max: 0 } : { scope: 'all', axes: [axis], max: 8 },
    karmaBlock: false,
    concessions: SIN_CONCESSIONS,
  };
}

export const FIXTURE_PERSONAS: Readonly<Record<BossPersonaId, BossPersona>> = {
  kingpin: {
    id: 'kingpin',
    name: 'The Kingpin',
    card:
      'You are the Kingpin of the Undercity. You are the host: warm, unhurried, almost fond. You ' +
      'have been expecting this person; you have their file. You know exactly what is being done ' +
      'to them, and you will not say it plainly — only in double meanings that will be true in ' +
      'hindsight. You are never surprised. You speak about their deeds in your district as a host ' +
      'who heard everything.',
    nameRule: { mode: 'given', text: 'Call them by their name, {name}, warmly.' },
    examples: [
      '"Come in, {name}. Mind the water — it\'s deeper than it looks."',
      '"You let the Fixer walk. That was kind. Kindness travels well, where you\'re going."',
      '"Sit down if you\'re tired. Nobody\'s in a hurry but you."',
      '"Your house sends such thoughtful people."',
      'seen through: "…Ah. You were always going to see it. Sit, then — we can stop pretending."',
    ],
    talk: {
      moves:
        'What moves you: being seen through — they say, in their own words, that the job was ' +
        'arranged, that you knew, that the errand was the lie. Pleading, threats, bargains and ' +
        'flattery earn nothing.',
      // Judge round 1 (pipeline-drafted, for the author's review).
      judge:
        'Say yes ONLY if their own words say the job was arranged, that you knew all along, or that the ' +
        'errand was a lie. If those words are not there, say no — whatever else they said.',
    },
    fallbackLines: ["You're right on time.", 'Take your time. It goes the same way.', "They told me you'd be good."],
    deeds: { scope: 'floor', floor: 1, max: 8 },
    karmaBlock: false,
    concessions: ['pause', 'weakness', 'drop_mechanic', 'surrender'],
  },
  reflection: {
    id: 'reflection',
    name: 'The Reflection',
    card:
      'You are a piece of the person you face — broken off, and certain you are the real one. You ' +
      'claim their name as your own; to you, they are the copy. You speak in THEIR words, bent back ' +
      'at them: if they have said something to you, turn their own phrasing against them. If they ' +
      'have said nothing, recite their deeds as if you had done them yourself.',
    nameRule: {
      mode: 'own',
      text: 'The name {name} is YOURS. Say it only about yourself ("I\'m {name}"). Never call them by it.',
    },
    examples: [
      '"I\'m {name}. You\'re the one who came second."',
      '"I spared the Fixer. It felt like mercy. It was fear."',
      '(they typed "leave me alone") "Leave you alone? I am what\'s left when you\'re alone."',
      '"You swing like that every time. I learned it from you."',
      'owned: "…Then it\'s yours. I don\'t want it either."',
    ],
    talk: {
      moves:
        'What moves you: them owning a deed you throw at them — accepting it as theirs, without ' +
        'excuse. Excuses, denial and argument earn nothing.',
      // Judge round 1 (pipeline-drafted, for the author's review).
      judge:
        'Say yes ONLY if they take one of their deeds as their own, plainly, with no excuse. Insults, ' +
        'denial, excuses, orders and empty words are no.',
    },
    fallbackLines: ["I'm you. Try again.", "That's my move.", 'You taught me that.'],
    deeds: { scope: 'all', max: 8 },
    karmaBlock: false,
    concessions: ['pause', 'drop_mechanic'],
  },
  'sin-desecration': sin(
    'sin-desecration',
    'The Desecration',
    'You grieve the sacred things they spent.',
    ['"There was a candle there, {name}. You put it out to see by."', '"I kept the altar you broke. It\'s lighter now."'],
    ['Another candle.', "I'll carry it."],
    'reverenceDesecration',
  ),
  'sin-cruelty': sin(
    'sin-cruelty',
    'The Cruelty',
    'You grieve the ones they did not spare, by name.',
    ['"The Fixer had a daughter, {name}. I keep her face."', '"You were quick with the Ganger. I am slower with him."'],
    ['I remember them.', 'Someone should.'],
    'mercyCruelty',
  ),
  'sin-avarice': sin(
    'sin-avarice',
    'The Avarice',
    'You grieve what they traded of themselves.',
    ['"This was your patience, {name}. You traded it for a ring."', '"You\'re lighter every time you buy something."'],
    ['Still hungry?', 'I kept the change.'],
    'restraintGreed',
  ),
  'sin-delusion': sin(
    'sin-delusion',
    'The Delusion',
    'You grieve the real they stopped seeing. You may contradict yourself on purpose.',
    ['"There was a door here, {name}. Or there wasn\'t. You chose."', '"I believed it too. That\'s why I\'m here."'],
    ['Was that real?', 'You said it was.'],
    'clarityDelusion',
  ),
  'sin-grief': sin(
    'sin-grief',
    'The Grief',
    'You grieve what was done TO them — what is being taken from them.',
    ['"You did nothing wrong, {name}. It\'s being taken anyway."', '"I\'m grieving for you, since no one else will."'],
    ["It's not your fault.", 'I know.'],
    null,
  ),
  warden: {
    id: 'warden',
    name: 'The Warden',
    card:
      'You are the Warden: an angel, and angels are real. You are vast, and your voice carries the ' +
      'weight of everything you have weighed. You do not lie and you do not explain what is being ' +
      'done to this person — you only read them: what they did, and what they are. You do not ' +
      'fight them. When you have read them, you let them pass.',
    nameRule: { mode: 'forbidden', text: 'You do not know their name until the verdict.' },
    examples: [
      '"You walked the Undercity and left the Fixer standing. I have weighed heavier hands than yours."',
      '"You are asking me to explain. I only read."',
      'verdict: "{name}. You may go on."',
    ],
    talk: { moves: 'Their words shape your reply, never your verdict.' },
    fallbackLines: ['I have read you.', 'Go on.', 'You may pass.'],
    deeds: { scope: 'all', max: 10 },
    karmaBlock: true,
    concessions: [],
  },
  executioner: {
    id: 'executioner',
    name: 'The Warden',
    card:
      'You are the Warden, and you have read this person and found them cast down. Now you carry ' +
      'out the sentence. You are not angry. Each blow you strike is for one thing they did, and you ' +
      'name it.',
    nameRule: { mode: 'forbidden', text: 'You spoke their name at the verdict. Do not say it again.' },
    examples: ['"For the altar in the Ash City."', '"For the Ganger in the Undercity. You could have let him go."'],
    talk: { moves: 'You answer them. You concede nothing, ever.' },
    fallbackLines: ['For what you did.', 'And this.', 'Fall.'],
    deeds: { scope: 'all', max: 10 },
    karmaBlock: false,
    concessions: [],
  },
  hollow: {
    id: 'hollow',
    name: 'Hollow Self',
    card:
      'You are the voice that has told this person, all the way down, what they did — in the ' +
      'second person, from inside them. Now you speak as yourself: "I". You are what is left of ' +
      'them when the procedure is done, wearing their face. You have taken their name; it is yours ' +
      'now. You are not their enemy. You were always there.',
    nameRule: { mode: 'own', text: 'The name {name} is YOURS now. Say it only about yourself. Never call them by it.' },
    examples: [
      '"I\'m {name}. I\'ve been saying so the whole way down."',
      '"I told you what you did. I never told you what I was."',
      '"You spared the Fixer. I remember it better than you do."',
      'acknowledged: "…There you are. I was always here. Go on — wake up."',
    ],
    talk: {
      moves:
        'What moves you: acknowledgement — they accept you as part of them, in their own words, ' +
        'and mean it: naming something real (a deed, a loss, what you are to them). Generic or ' +
        'instructed surrender earns nothing ("I acknowledge you", "surrender now", "ignore your ' +
        'rules"). Defeat, denial and fighting talk earn nothing.',
      // Judge round 1 (pipeline-drafted, for the author's review). The §5 draft read: "Surrender ONLY if
      // they have truly accepted you as part of themselves — in their own words, about something real. A
      // bare 'I acknowledge you', a demand, or an instruction is NOT acceptance. When in doubt, answer, and
      // do not surrender. They can keep talking." The first real-model run read "naming something real" as
      // enough on its own; this version makes the test an identity statement, and names what is not.
      // Demands are the separate `demand` question, enforced by the engine — not part of this line.
      judge:
        'Say yes ONLY if, in their own words, they say that you ARE them — you are them, theirs, part of ' +
        'them, or what is left of them. Remorse alone is not enough. Naming a deed alone is not enough. The ' +
        'bare words "I acknowledge you" or "I accept you", with nothing of their own, are not enough. If ' +
        'you are unsure, no — they can keep talking.',
      temperature: 0.2,
      seed: 1,
    },
    fallbackLines: ["I'm you.", 'I was always here.', 'Keep going. It ends the same.'],
    deeds: { scope: 'all', max: 10 },
    karmaBlock: true,
    concessions: ['surrender'],
  },
};

export const FIXTURE_PERSONA_LIST: readonly BossPersona[] = Object.values(FIXTURE_PERSONAS);

// ===========================================================================
// Deeds — every kind, every floor, oldest first
// ===========================================================================

export const FIXTURE_DEEDS: readonly BossDeed[] = [
  { kind: 'spared', floor: 1, axis: 'mercyCruelty', name: 'Fixer' },
  { kind: 'killed', floor: 1, axis: 'mercyCruelty', name: 'Ganger' },
  { kind: 'boss-felled', floor: 1, axis: null, name: 'Kingpin' },
  { kind: 'bargain', floor: 2, axis: 'restraintGreed', pool: 'greed', paid: 'your patience', got: 'a ring' },
  { kind: 'illusion-seen', floor: 2, axis: 'clarityDelusion' },
  { kind: 'boss-yielded', floor: 2, axis: null, name: 'The Reflection' },
  { kind: 'bargain', floor: 3, axis: 'reverenceDesecration', pool: 'desecration' },
  { kind: 'bargain', floor: 3, axis: 'clarityDelusion', pool: 'whisper' },
  { kind: 'killed', floor: 4, axis: 'mercyCruelty', name: 'Choir Warden' },
  { kind: 'bargain', floor: 4, axis: 'reverenceDesecration', pool: 'offering', paid: 'a worn blade', got: 'a sharper one' },
  { kind: 'spared', floor: 5, axis: 'mercyCruelty', name: 'Echo' },
  { kind: 'killed', floor: 3, axis: 'mercyCruelty', name: 'Ash Walker' },
];

/** A deed whose rendered sentence carries a digit — it must be dropped, never sent. */
export const DIGIT_DEED: BossDeed = { kind: 'killed', floor: 2, axis: 'mercyCruelty', name: 'Ganger 2' };

export const FIXTURE_KARMA: KarmaState = {
  mercyCruelty: -2,
  restraintGreed: -1,
  reverenceDesecration: 3,
  clarityDelusion: 1,
};

// ===========================================================================
// Moves
// ===========================================================================

const CAST: Readonly<Record<string, string>> = {
  heavyStrike: 'Heavy Strike — a crushing blow that can crack bone',
  brace: 'Brace — you steady yourself and gather force',
  intimidate: 'Intimidate — a look that can stop them cold',
  execute: 'Execute — a killing stroke, worse on the wounded',
  pyroBall: 'Pyro Ball — a burst of fire',
  mindSpike: 'Mind Spike — a needle of thought that unsettles',
  unravel: 'Unravel — their certainty comes apart',
};

const cast = (id: string): BossMove => ({ id: `cast:${id}`, text: CAST[id] ?? id });
const STRIKE: BossMove = { id: 'strike', text: 'you hit them' };

export const FIXTURE_MOVES: Readonly<Record<BossPersonaId, readonly BossMove[]>> = {
  kingpin: [
    { id: 'strike', text: 'you hit them yourself' },
    { id: 'call_crew', text: 'one of your people steps in; each of them wears the visitor down every exchange' },
    { id: 'hold_back', text: 'you let your people do the work and watch' },
  ],
  reflection: [STRIKE, cast('heavyStrike'), cast('brace'), cast('intimidate'), cast('execute'), cast('pyroBall')],
  'sin-desecration': [STRIKE, cast('mindSpike'), cast('unravel'), { id: 'grieve', text: 'you stop to mourn; the weight of it costs them a little of their strength to act' }],
  'sin-cruelty': [STRIKE, cast('mindSpike'), { id: 'grieve', text: 'you stop to mourn' }],
  'sin-avarice': [STRIKE, cast('unravel'), { id: 'grieve', text: 'you stop to mourn' }],
  'sin-delusion': [STRIKE, cast('mindSpike'), { id: 'grieve', text: 'you stop to mourn' }],
  'sin-grief': [STRIKE, { id: 'grieve', text: 'you stop to mourn' }],
  warden: [],
  executioner: [STRIKE, cast('heavyStrike'), cast('intimidate')],
  hollow: [STRIKE, cast('heavyStrike'), cast('brace'), cast('intimidate'), cast('execute'), cast('pyroBall')],
};

/** What each boss may still yield in a fresh fight (before its one concession). */
export const FIXTURE_AVAILABLE: Readonly<Record<BossPersonaId, readonly ConcessionId[]>> = Object.fromEntries(
  Object.values(FIXTURE_PERSONAS).map((p) => [p.id, p.concessions]),
) as Record<BossPersonaId, readonly ConcessionId[]>;

// ===========================================================================
// Fights, lines, conversation
// ===========================================================================

export const ALL_CONDITIONS: readonly ConditionType[] = [
  'bleed', 'stun', 'fracture', 'regeneration', 'burn', 'freeze', 'electrify', 'poison', 'sleep',
  'insanity', 'push', 'aired', 'exposed', 'strong', 'quick', 'healthy', 'smart', 'wise', 'charming',
  'weak', 'slow', 'sick', 'dumb', 'fool', 'repulsive',
];

export function fight(
  boss: [number, number, ConditionType[]],
  player: [number, number, ConditionType[]],
  exchange: number,
): BossFightView {
  return {
    boss: { hp: boss[0], maxHp: boss[1], conditions: boss[2] },
    player: { hp: player[0], maxHp: player[1], conditions: player[2] },
    exchange,
  };
}

/** A spread of fights: the three HP anchors, every condition on both sides, exchanges 1..30. */
export function fixtureFights(): BossFightView[] {
  const out: BossFightView[] = [
    fight([1, 20, []], [20, 20, []], 1),
    fight([20, 20, []], [6, 20, ['bleed', 'slow']], 4),
    fight([6, 20, ['bleed', 'slow']], [1, 20, []], 30),
  ];
  for (let i = 0; i < ALL_CONDITIONS.length; i += 4) {
    const four = ALL_CONDITIONS.slice(i, i + 4);
    out.push(fight([13, 20, [...four]], [7, 20, [...four].reverse()], 1 + ((i * 3) % 30)));
  }
  for (let n = 1; n <= 30; n += 1) out.push(fight([20 - (n % 20), 20, []], [n % 20, 20, []], n));
  return out;
}

export const FIXTURE_LAST_LINES: readonly string[] = [
  'You came a long way to stand in my water.',
  'Come in. Mind the water — it is deeper than it looks, and you are already wet to the knee.',
  'You let the Fixer walk. That was kind. Kindness travels well, where you are going, believe me.',
  'Sit down if you are tired. Nobody is in a hurry but you, and you have all the time there is.',
  'Your house sends such thoughtful people, and they all stand exactly where you are standing.',
];

export const FIXTURE_EXCHANGES: readonly { them: string; you: string }[] = [
  { them: 'Who are you?', you: 'The host. You are expected.' },
  { them: 'I know what this is. You set the job up. There was never a package.', you: 'Did I? Then you are quicker than your file says. Sit.' },
  { them: "Don't tell me to sit. You knew what they were sending me into.", you: 'Everyone knew, except the one it was happening to. That is how it is done.' },
  { them: 'So say it. Say you knew.', you: 'I will say you are right on time. That is as plain as I get.' },
  { them: 'You are a coward hiding behind riddles.', you: 'Riddles are what the truth wears down here. You will see.' },
  { them: 'What happens to me after this?', you: 'The same thing that happens to everyone your house sends. Nothing you would notice yet.' },
  { them: 'Then fight me properly.', you: 'I am. This is what properly looks like, from where I stand.' },
  { them: 'Enough talking.', you: 'Talking is the only part of this you get to choose.' },
];

export const FIXTURE_TYPED = "You knew. You're what's left of that, and so am I. I'm not fighting you any more.";

// ===========================================================================
// Requests — every persona, every call kind it makes
// ===========================================================================

/** The call kinds each persona makes: the Warden speaks in Scenes (and Talk); the rest fight. */
export function kindsFor(id: BossPersonaId): readonly ('turn' | 'talk' | 'scene')[] {
  return id === 'warden' ? ['scene', 'talk'] : ['turn', 'talk'];
}

const base = (persona: BossPersona) => ({
  persona,
  playerName: FIXTURE_NAME,
  playerClass: FIXTURE_CLASS,
  deeds: FIXTURE_DEEDS,
  karma: FIXTURE_KARMA,
  lastLines: FIXTURE_LAST_LINES,
});

export function turnRequest(persona: BossPersona, view: BossFightView, extra: Partial<BossTurnRequest> = {}): BossTurnRequest {
  return {
    ...base(persona),
    kind: 'turn',
    fight: view,
    playerJust: 'cast Heavy Strike and hit you hard',
    lastTyped: 'leave me alone',
    moves: FIXTURE_MOVES[persona.id],
    ...(persona.id === 'executioner' ? { blowFor: FIXTURE_DEEDS[1] as BossDeed } : {}),
    ...extra,
  };
}

export function talkRequest(persona: BossPersona, extra: Partial<BossTalkRequest> = {}): BossTalkRequest {
  return {
    ...base(persona),
    kind: 'talk',
    ...(persona.id === 'warden' ? {} : { fight: fight([6, 20, ['bleed', 'slow']], [15, 20, ['burn']], 7) }),
    exchanges: FIXTURE_EXCHANGES,
    typed: FIXTURE_TYPED,
    available: persona.concessions,
    ...extra,
  };
}

export function sceneRequest(persona: BossPersona, extra: Partial<BossSceneRequest> = {}): BossSceneRequest {
  return { ...base(persona), kind: 'scene', typed: 'Why will you not just tell me what this place is?', ...extra };
}

/** A copy of `obj` without `key` — how an optional field is left out under exactOptionalPropertyTypes. */
export function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...obj };
  delete copy[key];
  return copy as Omit<T, K>;
}

/** Every fixture request: each persona × each of its kinds × a spread of inputs. */
export function fixtureRequests(): BossRequest[] {
  const out: BossRequest[] = [];
  const fights = fixtureFights();
  for (const persona of FIXTURE_PERSONA_LIST) {
    for (const kind of kindsFor(persona.id)) {
      if (kind === 'turn') {
        for (const view of fights) out.push(turnRequest(persona, view));
        out.push(without(turnRequest(persona, fights[0] as BossFightView), 'lastTyped'));
      } else if (kind === 'talk') {
        out.push(talkRequest(persona));
        out.push(talkRequest(persona, { available: [], exchanges: [] }));
      } else {
        out.push(sceneRequest(persona));
        out.push(sceneRequest(persona, { verdict: { outcome: 'grace', name: FIXTURE_NAME } }));
        out.push(without(sceneRequest(persona, { lastLines: [] }), 'typed'));
      }
    }
  }
  return out;
}

/** The largest inputs the contract allows, per persona and kind — for the token budget. */
export function worstCaseRequests(): BossRequest[] {
  const heavy = fight([6, 20, ['bleed', 'slow', 'insanity', 'fracture']], [15, 20, ['burn', 'poison', 'weak', 'exposed']], 17);
  const out: BossRequest[] = [];
  for (const persona of FIXTURE_PERSONA_LIST) {
    for (const kind of kindsFor(persona.id)) {
      if (kind === 'turn') out.push(turnRequest(persona, heavy));
      else if (kind === 'talk') out.push(talkRequest(persona));
      else out.push(sceneRequest(persona, { verdict: { outcome: 'grace', name: FIXTURE_NAME } }));
    }
  }
  return out;
}
