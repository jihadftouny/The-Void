// What PLAN.md #2 REMOVED stays removed (AC-20): the on-demand bargain, the banked rest and its
// decision, the victory's extra-rest roll, the "this is a lore" loader, and the potion.
//
// A source scan over every SHIPPING file under `src/` (tests excluded), with comments stripped:
// what is policed is the CODE and the DATA that ship, so a comment recording why something was
// removed does not trip it — and a comment is not where a removed mechanic can come back. The
// one permitted exception is `src/game/save.ts`, whose v8 -> v9 migration must read the two
// retired player fields (`pots`, `restsLeft`) to fold them; it is pinned to those two alone.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../log/sourceScan.testutil.ts';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Every token that must not appear, and the files (repo-relative to src/) allowed to hold it. */
const REMOVED: readonly { name: string; pattern: RegExp; allowedIn?: readonly string[] }[] = [
  { name: 'the on-demand bargain input', pattern: /seek-deal/ },
  { name: 'the banked rest counter', pattern: /\brestsLeft\b/, allowedIn: ['game/save.ts'] },
  { name: 'the potion counter', pattern: /\bpots\b/, allowedIn: ['game/save.ts'] },
  { name: 'the rest decision', pattern: /rest-decision/ },
  { name: 'the rest offer flag', pattern: /\brestOffered\b/ },
  { name: 'the victory extra-rest roll', pattern: /\bextraRest\b/ },
  { name: 'the lore-fragment event', pattern: /rest-lore/ },
  { name: 'the no-rests event', pattern: /no-rests/ },
  { name: 'the rest-full event', pattern: /rest-full/ },
  { name: 'the rest-declined event', pattern: /rest-declined/ },
  { name: 'the potion action', pattern: /['"`]potion['"`]/ },
  { name: 'the potion events', pattern: /potion-(?:drunk|unavailable|blocked)/ },
  { name: 'the starting potion/rest constants', pattern: /STARTING_(?:POTS|RESTS)/ },
  { name: 'the lore loader', pattern: /\b(?:selectLore|getLore)\b/ },
];

const SHIPPING = /\.(ts|css|json|html)$/;

/** Every shipping file under src/, repo-relative to src/, posix separators. */
function shippingFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        // Test FIXTURES do not ship: `desktop/fixtures/v1-run-envelope.json` is the v8 save the
        // migration is proved against, and it MUST still hold the retired fields.
        if (name === 'fixtures') continue;
        walk(full, `${prefix}${name}/`);
      } else if (SHIPPING.test(name) && !/\.test\.|\.testutil\./.test(name)) {
        out.push(`${prefix}${name}`);
      }
    }
  };
  walk(SRC, '');
  return out;
}

/** The text a file ships: comments stripped from code, JSON as is. */
function shippedText(rel: string): string {
  const raw = readFileSync(path.join(SRC, rel), 'utf8');
  return rel.endsWith('.json') ? raw : stripComments(raw);
}

/** The offences in one text, as `name` strings. */
function offences(text: string, rel: string): string[] {
  return REMOVED.filter((r) => !(r.allowedIn ?? []).includes(rel) && r.pattern.test(text)).map(
    (r) => `${rel}: ${r.name}`,
  );
}

describe('AC-20 — what PLAN.md #2 removed appears in no shipping file', () => {
  const files = shippingFiles();

  it('the scan reads a real, non-trivial set of files (or it proves nothing)', () => {
    expect(files.length).toBeGreaterThan(80);
    for (const must of ['game/game.ts', 'desktop/game.ts', 'desktop/screens.css', 'data/deals.json', 'game/save.ts']) {
      expect(files, `${must} is outside the scan`).toContain(must);
    }
  });

  it('finds none of the removed tokens anywhere', () => {
    const found = files.flatMap((rel) => offences(shippedText(rel), rel));
    expect(found).toEqual([]);
  });

  it('the migration exception is NARROW: save.ts may name only the two retired player fields', () => {
    const save = shippedText('game/save.ts');
    // ...and it really does, or the exception is dead weight that could hide a regression.
    expect(save).toMatch(/\bpots\b/);
    expect(save).toMatch(/\brestsLeft\b/);
    const other = REMOVED.filter((r) => !(r.allowedIn ?? []).includes('game/save.ts'));
    for (const r of other) expect(save, r.name).not.toMatch(r.pattern);
  });
});

describe('the detector fires on each removed token, in the form it would really come back', () => {
  // Planted in the surrounding code's own idioms — a field read, a union member, a switch arm,
  // a CSS selector, a JSON key — so a pattern proven only on the easy shape cannot pass.
  const PLANTED: readonly [string, string][] = [
    ["{ kind: 'menu', choice: 'seek-deal' }", 'the on-demand bargain input'],
    ['if (player.restsLeft >= 1) {', 'the banked rest counter'],
    ['const heal = p.pots > 0;', 'the potion counter'],
    ["case 'rest-decision':", 'the rest decision'],
    ['| { kind: \'rest\'; restOffered: boolean }', 'the rest offer flag'],
    ['events.push({ kind: \'victory\', xpGained, extraRest, loot });', 'the victory extra-rest roll'],
    ["[data-screen='rest-decision'] .void-button {", 'the rest decision'],
    ["{ kind: 'rest-lore', title, loreText }", 'the lore-fragment event'],
    ["events.push({ kind: 'no-rests' });", 'the no-rests event'],
    ["return finish(m, [{ kind: 'rest-full' }]);", 'the rest-full event'],
    ["'rest-declined': 'pane',", 'the rest-declined event'],
    ["dispatch({ kind: 'battle-action', action: 'potion' })", 'the potion action'],
    ['| "potion"', 'the potion action'],
    ["case 'potion-drunk':", 'the potion events'],
    ['const STARTING_POTS = 6;', 'the starting potion/rest constants'],
    ['const lore = selectLore(state.act, rng);', 'the lore loader'],
  ];

  for (const [code, name] of PLANTED) {
    it(`catches ${name}: ${code}`, () => {
      expect(offences(code, 'game/elsewhere.ts')).toContain(`game/elsewhere.ts: ${name}`);
    });
  }

  it('and does not fire on the words that legitimately remain', () => {
    for (const ok of ["kind: 'rest'", "kind: 'rest-found'", "kind: 'rest-taken'", 'useConsumable', 'Potions folded', 'restBrief(floor)', 'potionless']) {
      expect(offences(ok, 'game/elsewhere.ts'), ok).toEqual([]);
    }
  });
});
