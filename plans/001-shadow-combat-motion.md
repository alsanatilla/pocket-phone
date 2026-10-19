# Shadow Protocol combat motion

Status: DONE in this branch (baseline commit `3c1393d`).
Scope: `src/client/shadow.js`, `src/client/shadow-engine.js`, `src/client/shadow-render.js`, `src/styles/shadow.css`.

## Recon

- Stack: Astro + vanilla JavaScript. The play field is a single `<canvas>` drawn every animation frame; the surrounding HUD, briefing, intel and debrief are DOM.
- No motion library. The existing conventions are CSS `ease-out` transitions in `shadow.css` and hand-drawn sprite animation in `shadow-render.js`.
- High-frequency surfaces: player/guard movement, camera, HUD meters, phase label. Occasional surfaces: briefing, intel panel, toast, debrief.
- Existing accessibility fallback: `@media (prefers-reduced-motion: reduce)` already disables the vignette pulse and toast/prompt transitions.

## Findings and fixes

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | HIGH | `.shadow-meter i` animated `width` every frame, forcing layout inside the live HUD. | Fill the bar at `width: 100%` and animate `transform: scaleX(0)` with `transform-origin: left center`. JS now writes `style.transform`. Keep `120ms linear` because the value changes every frame. |
| 2 | HIGH | Killing a guard had no hit feedback: the canvas simply changed state. | Add a blood pool and spatter decals, a 160ms tracer, a 240ms slash arc, a 180ms kill flash, and camera shake. Shake trauma decays at `2.6/s`; offsets are up to `5px` horizontal and `4px` vertical. Do not shake when `prefers-reduced-motion: reduce`. |
| 3 | MEDIUM | Briefing → live → debrief replaced the DOM with a hard cut. | Add a shared entrance: `opacity: 0; translateY(8px)` → `opacity: 1; translateY(0)`, `220ms cubic-bezier(.2,.8,.2,1)`, `both`. |
| 4 | MEDIUM | Phase, toast and prompt changes snapped. | Phase: `180ms cubic-bezier(.2,.8,.2,1)` with a 4px rise and `scale(.96 → 1)`. Toast: `160ms` opacity + transform. Prompt: `140ms` opacity + transform. Keep text readable at all times. |
| 5 | MEDIUM | Touch controls only exposed nonlethal actions in a 3-column grid. | Add `knife` and `pistol` keys, use a 4-column grid, and give lethal keys a muted red `danger-key` border. |
| 6 | LOW | Buttons had no press feel. | `transform: scale(.98)` for `90ms ease-out` on `:active`; `140ms` color/border/background transitions. |

## Feel-check

1. Start a mission and kill a guard with `X` while intel is closed: a white-red flash, a short camera jolt, a red pool, and a `knife kill ×n` toast should land inside 200ms.
2. Fire `G` in a dark room: the muzzle/tracer should be visible for one or two frames, then the scene should settle. Shake must not move the HUD.
3. Toggle `prefers-reduced-motion: reduce`: no entrance animation, no phase pop, no kill flash, and no canvas shake. The blood and tracer remain because they are game-state information, not decoration.
4. Open the intel panel: it should rise 5px over 180ms, not jump. Switch phase to alert: the phase label should pop once, not loop.
5. On a 390px viewport, all eight touch actions must remain reachable and the 4-column key grid must not overflow.
