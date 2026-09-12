// THE PAGE'S ENTRY SCRIPT — and the ONLY module-scope side effect in the renderer's graph
// (FINDINGS.md G51, PLAN.md #6).
//
// `desktop.html` loads this file, and this file does exactly one thing: start the renderer.
// Everything `game.ts` used to do at module scope now happens inside its exported `boot()`,
// so importing `game.ts` is inert — the jsdom tests, the layout probe's driver and the real
// page all share one module graph, and this is the one place in it where the game begins.
//
// It is a file of its own rather than an inline `<script type="module">` in the page because
// the page's Content-Security-Policy is `default-src 'self'` with no inline-script allowance:
// an inline entry would be blocked.
//
// ⚠ KEEP IT TO THESE TWO STATEMENTS. `boot.test.ts` pins the body exactly, and a second thing
// started here would be a second, untested start-up path beside `boot()`. There is no
// `import.meta.env.DEV` branch here either: `src/dev/exclusion.test.ts` allows exactly one in
// a shipping module, and it is the panel gate inside `boot()`.
import { boot } from './game.ts';

boot();
