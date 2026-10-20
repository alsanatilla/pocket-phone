# Plans

| Plan | Severity | Status | Area |
| --- | --- | --- | --- |
| [001 — Shadow Protocol combat motion](001-shadow-combat-motion.md) | — | DONE | Canvas combat feedback, HUD meters, screen transitions, touch layout |
| [002 — Draw between simulation steps, ease the player's turn](002-shadow-smooth-rendering.md) | HIGH | DONE | Frame pacing on 60/120/144 Hz, facing flips |
| [003 — Slide around door frames instead of stopping dead](003-shadow-corner-nudge.md) | HIGH | DONE | Collision response at doorways and crawlways |
| [004 — Faster stride with a short acceleration curve](004-shadow-movement-curve.md) | HIGH | DONE | Player speeds, acceleration, guard chase balance |
| [005 — Make the knife and the takedown strike, not pause](005-shadow-snappy-strikes.md) | MEDIUM | TODO | Strike timing, lunge, hit-stop |
| [006 — Dodge roll](006-shadow-dodge-roll.md) | MEDIUM | TODO | New burst move: input, rules, look, touch key |

## Recommended order

1. **002** stands alone (client loop only) and makes every later change easier to judge.
2. **003** before **004**: 004 relies on `moveBody` returning `{ x, y }` and taking a nudge.
3. **005** after 004. It edits `updateAction` and the frame loop. If 002 has landed, keep its `snapshot()` call in the step loop.
4. **006** last. It needs 003 (per-axis `moveBody`, nudge) and 004 (`p.vx` / `p.vy`).

Every plan is stamped at commit `8c898bd` and tells the executor to stop on drift. Plans 004 and 006 change balance, so record `node tools/shadow-eval.mjs --runs 10 --only drill` before and after, as their verification sections require.

## Not planned (from the 2026-10-20 audit)

- **Camera lean toward the cursor.** `camera()` in `src/client/shadow-render.js:419-427` looks ahead along `p.facing` only (26 × 18 px). With a mouse, leaning about a quarter of the way toward the aim point would show what's ahead. Worth a plan after 002, which changes how the camera reads the player.
