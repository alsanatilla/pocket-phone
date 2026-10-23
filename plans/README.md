# Plans

| Plan | Severity | Status | Area |
| --- | --- | --- | --- |
| [001 — Shadow Protocol combat motion](001-shadow-combat-motion.md) | — | DONE | Canvas combat feedback, HUD meters, screen transitions, touch layout |
| [002 — Draw between simulation steps, ease the player's turn](002-shadow-smooth-rendering.md) | HIGH | DONE | Frame pacing on 60/120/144 Hz, facing flips |
| [003 — Slide around door frames instead of stopping dead](003-shadow-corner-nudge.md) | HIGH | DONE | Collision response at doorways and crawlways |
| [004 — Faster stride with a short acceleration curve](004-shadow-movement-curve.md) | HIGH | DONE | Player speeds, acceleration, guard chase balance |
| [005 — Make the knife and the takedown strike, not pause](005-shadow-snappy-strikes.md) | MEDIUM | DONE | Strike timing, lunge, hit-stop |
| [006 — Dash, slide and vault](006-shadow-dodge-roll.md) | MEDIUM | DONE | Replaces the roll proposal; keyboard/touch burst moves and animations |

## Recommended order

1. **002** stands alone (client loop only) and makes every later change easier to judge.
2. **003** before **004**: 004 relies on `moveBody` returning `{ x, y }` and taking a nudge.
3. **005** after 004. It edits `updateAction` and the frame loop. If 002 has landed, keep its `snapshot()` call in the step loop.
4. **006** last. It needs 003 (per-axis `moveBody`, nudge) and 004 (`p.vx` / `p.vy`).

The original plans were stamped at commit `8c898bd`. All are now complete; the later gameplay brief supersedes the original timings and roll controls. The recorded commander capture rates before/after the movement work were 44/70/77% and 51/57/77% for normal/hard/extreme. The scripted bot does not use the new moves, so those numbers cover ordinary traversal and pursuit rather than player mastery of dash, slide or vault.

## Additional work completed 2026-10-23

- **Camera lean toward the cursor**, with greater reach while aiming the pistol.
- **Facility and operative artwork**, including lamp shadows, flashlights, materials, environmental motion and articulated character animations.
- **Release verification:** 40 engine tests, 6 Jev tests and the browser suite pass, covering combat, mission completion, persistence and layouts at 390 and 820 px. The Jev browser check uses the mock relay.
