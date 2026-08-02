// The Void — LLM-narrated game renderer (N-series vertical slice).
//
// Reuses everything: the pure engine (`step`) drives all rules, state, and the
// legal choices; the local model narrates each beat (via the N1 IPC bridge).
// This is the DOM game UI; the Kaplay layer (index.html) is a separate artifact.
import { createGame, step, awaitingFor } from '../game/game.ts';
import type { GameState, GameInput, Awaiting } from '../game/game.ts';
import { STAT_KEYS } from '../game/character.ts';
import type { StatKey } from '../game/character.ts';
import type { GameEvent } from '../game/gameEvent.ts';
import { buildNarrationPrompt, createStoryMemory, rememberBeat } from '../llm/narrate.ts';
import { loadRun, saveRun, clearRun } from './persist.ts';

interface GenStats { text: string; tokens: number; tokensPerSecond: number; ttftMs: number }
interface VoidApi {
  onStatus(cb: (s: { phase: string; gpu?: unknown; message?: string }) => void): () => void;
  generate(o: { prompt: string; system?: string; onToken?: (c: string) => void }): Promise<GenStats>;
}
declare global { interface Window { void: VoidApi } }

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const titleEl = $('title');
const statusEl = $('status');
const narrationEl = $('narration');
const choicesEl = $('choices');
const sheetEl = $('sheet');

let state: GameState = createGame(Date.now() >>> 0);
let memory = createStoryMemory(); // rolling "story so far" fed to the narrator

window.void.onStatus((s) => {
  if (s.phase === 'ready') { statusEl.textContent = `the Void is listening — ${s.gpu ? `GPU (${String(s.gpu)})` : 'CPU'}`; }
  else if (s.phase === 'loading') statusEl.textContent = 'the Void stirs (loading model)…';
  else if (s.phase === 'resolving') statusEl.textContent = 'locating the model…';
  else if (s.phase === 'error') { statusEl.textContent = `error: ${s.message ?? 'unknown'}`; statusEl.classList.add('error'); }
});

function renderSheet(): void {
  const p = state.player;
  if (!p) { sheetEl.innerHTML = ''; return; }
  const lines = [
    `<b>${p.name}</b>`,
    `${p.classId}`,
    `HP ${p.hp}/${p.maxHp}`,
    `XP ${p.xp} · Gold ${p.gold}`,
    `Act ${state.act}`,
    `Pots ${p.pots} · Rests ${p.restsLeft}`,
  ];
  if (state.phase.kind === 'battle') {
    const e = state.phase.battle.enemy;
    lines.push('<hr/>', `<span class="foe">${e.fullName}</span>`, `HP ${e.hp}/${e.maxHp}`);
  }
  sheetEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
}

async function narrate(events: readonly GameEvent[]): Promise<void> {
  const prompt = buildNarrationPrompt(events, state, memory);
  if (!prompt) return;
  const block = document.createElement('p');
  block.className = 'beat';
  narrationEl.appendChild(block);
  narrationEl.scrollTop = narrationEl.scrollHeight;
  try {
    await window.void.generate({
      prompt: prompt.user,
      system: prompt.system,
      onToken: (c) => { block.textContent += c; narrationEl.scrollTop = narrationEl.scrollHeight; },
    });
  } catch (err) {
    // Resilience: if the model fails, fall back to the plain facts so the game
    // remains fully playable (engine is authoritative regardless).
    block.textContent = prompt.user.split('\n\n')[0] ?? '(the Void is silent)';
    block.classList.add('fallback');
  }
}

function button(label: string, onClick: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick, { once: true });
  choicesEl.appendChild(b);
}

async function dispatch(input: GameInput): Promise<void> {
  choicesEl.innerHTML = '';
  const r = step(state, input);
  state = r.state;
  renderSheet();
  await narrate(r.events);
  memory = rememberBeat(memory, r.events); // remember AFTER narrating
  renderChoices(r.awaiting);
  if (r.awaiting === 'game-over') clearRun();
  else saveRun(state, memory); // autosave the full run (engine state + memory)
}

function start(): void {
  clearRun();
  state = createGame(Date.now() >>> 0);
  memory = createStoryMemory();
  narrationEl.innerHTML = '';
  renderSheet();
  renderChoices('title');
}

function renderChoices(awaiting: Awaiting): void {
  choicesEl.innerHTML = '';
  titleEl.style.display = awaiting === 'title' ? 'block' : 'none';

  switch (awaiting) {
    case 'title':
      button('Descend into the Void', () => void dispatch({ kind: 'continue' }));
      break;
    case 'enter-name': {
      const input = document.createElement('input');
      input.placeholder = 'your name';
      input.maxLength = 20;
      const submit = () => { const name = input.value.trim() || 'Nameless'; void dispatch({ kind: 'name', name }); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      choicesEl.appendChild(input);
      button('Enter the Void', submit);
      input.focus();
      break;
    }
    case 'choose-class':
      button('Enforcer — flesh and steel', () => void dispatch({ kind: 'class', classId: 'Enforcer' }));
      button('Neuromancer — mind and static', () => void dispatch({ kind: 'class', classId: 'Neuromancer' }));
      break;
    case 'accept-or-reroll-stats': {
      if (state.phase.kind === 'stats-roll') {
        const s = state.phase.stats;
        const line = document.createElement('div');
        line.className = 'stats-line';
        line.textContent = STAT_KEYS.map((k) => `${k} ${s[k]}`).join('   ');
        choicesEl.appendChild(line);
      }
      button('Accept these', () => void dispatch({ kind: 'stats-decision', accept: true }));
      button('Reroll', () => void dispatch({ kind: 'stats-decision', accept: false }));
      break;
    }
    case 'main-menu':
      button('Continue the descent', () => void dispatch({ kind: 'menu', choice: 'continue' }));
      button('The stranger / your self', () => void dispatch({ kind: 'menu', choice: 'character-info' }));
      button('Abandon the descent', () => void dispatch({ kind: 'menu', choice: 'quit' }));
      break;
    case 'battle-action':
      button('Fight', () => void dispatch({ kind: 'battle-action', action: 'fight' }));
      button('Potion', () => void dispatch({ kind: 'battle-action', action: 'potion' }));
      button('Run', () => void dispatch({ kind: 'battle-action', action: 'run' }));
      break;
    case 'continue':
      button('Continue', () => void dispatch({ kind: 'continue' }));
      break;
    case 'level-up-picks': {
      const picks: StatKey[] = [];
      const note = document.createElement('div');
      note.className = 'stats-line';
      note.textContent = 'Choose two — the descent reshapes you.';
      choicesEl.appendChild(note);
      for (const k of STAT_KEYS) {
        const b = document.createElement('button');
        b.textContent = k;
        b.addEventListener('click', () => {
          picks.push(k);
          b.classList.add('picked');
          if (picks.length === 2) {
            void dispatch({ kind: 'level-up-picks', picks: [picks[0]!, picks[1]!] });
          }
        });
        choicesEl.appendChild(b);
      }
      break;
    }
    case 'shop-decision':
      button('Make the trade', () => void dispatch({ kind: 'shop-decision', accept: true }));
      button('Refuse', () => void dispatch({ kind: 'shop-decision', accept: false }));
      break;
    case 'rest-decision':
      button('Rest here', () => void dispatch({ kind: 'rest-decision', accept: true }));
      button('Press on', () => void dispatch({ kind: 'rest-decision', accept: false }));
      break;
    case 'game-over':
      button('Descend again', () => start());
      break;
  }
}

function renderResume(): void {
  titleEl.style.display = 'block';
  narrationEl.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'beat';
  p.textContent = 'A descent lies unfinished. Return to it, or begin anew.';
  narrationEl.appendChild(p);
  choicesEl.innerHTML = '';
  button('Continue your descent', () => renderChoices(awaitingFor(state.phase)));
  button('Begin a new descent', () => start());
}

const saved = loadRun();
if (saved) {
  state = saved.state;
  memory = saved.memory;
  renderSheet();
  renderResume();
} else {
  start();
}
