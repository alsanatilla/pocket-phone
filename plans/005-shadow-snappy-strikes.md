# 005 — Make the knife and the takedown strike, not pause

- **Status**: DONE (2026-10-23)
- **Delivered**: lunging knife strikes and takedowns, a swing on missed attacks, buffered follow-ups, impact pauses and articulated combat animations. The original proposal below is retained as design history; the later gameplay brief determines the final timings.
- **Commit**: 8c898bd
- **Severity**: MEDIUM
- **Category**: Interruptibility & duration (action timing)
- **Estimated scope**: 2 files (`src/client/shadow-engine.js`, `src/client/shadow.js`), ~30 lines

## Problem

Both close-range actions stop the operative dead for a fixed duration, with no motion toward the target:

```js
/* src/client/shadow-engine.js:387 — current (knife) */
    p.action = { kind: 'kill', t: 0, need: .42, target: target.id };
```

```js
/* src/client/shadow-engine.js:476 — current (nonlethal takedown) */
      p.action = { kind: 'takedown', t: 0, need: .55, target: target.id };
```

```js
/* src/client/shadow-engine.js:515-540 — current */
  updateAction(dt, input) {
    const p = this.player, action = p.action;
    p.moving = false; p.speed = 0;
    if (action.kind === 'kill') {
      const g = this.guards.find(item => item.id === action.target);
      if (!g || g.dead) { p.action = null; return; }
      action.t += dt;
      p.facing = angleTo(p.x, p.y, g.x, g.y);
      if (action.t >= action.need) {
        g.grabbed = false;
        this.killGuard(g, 'knife');
        p.action = null;
      }
      return;
    }
    if (action.kind === 'takedown') {
      const g = this.guards.find(item => item.id === action.target);
      if (!g || g.down) { p.action = null; return; }
      action.t += dt;
      p.facing = angleTo(p.x, p.y, g.x, g.y);
      if (action.t >= action.need) {
        g.grabbed = false; this.knockOut(g);
        p.action = null;
      }
      return;
    }
```

The knife can start from up to 23 px away (`knifeTarget`, `bestD = 23`) and the takedown from 21 px. The operative stands still at that distance for 0.42 s / 0.55 s while the guard is held in place, so the strike reads as a pause. Players take guards down many times a mission. A deliberate commitment phase is right (the AUDIT's asymmetric-timing rule), but the response must land fast and visibly move.

## Target

- Durations: **knife 0.26 s, takedown 0.38 s**.
- Lunge: over the first **90 ms** of the action, move the operative toward a point **9 px** from the guard's centre, eased with ease-out cubic `1 − (1 − u)³` where `u = min(1, t / 0.09)`. Movement goes through `moveBody` so walls still block. After 90 ms the operative holds still for the rest of the action.
- Hit-stop: when a knife kill or takedown completes, freeze the simulation for **50 ms**. Rendering continues, and the kill flash and shake from plan 001 still play. This is the beat that sells impact. Keep it under reduced motion: it's a pause, not movement.
- Hold actions (hack, panel) are unchanged.

## Repo conventions to follow

- Per-action state lives on `p.action` (`{ kind, t, need, target }`). Add the lunge origin to that object instead of new player fields.
- Client-only timing state lives on `state` inside `startLoop` (`src/client/shadow.js:352`), e.g. `state.shake`. Add `state.hitstop` there.
- Engine events reach the client through `this.emit(...)` and `handleEvents()` (`src/client/shadow.js`). Use the existing `kill` and `takedown` events, with no new ones.

## Steps

1. `src/client/shadow-engine.js:387`: change `need: .42` to `need: .26` and record the origin:

   ```js
    p.action = { kind: 'kill', t: 0, need: .26, target: target.id, fromX: p.x, fromY: p.y };
   ```

2. `src/client/shadow-engine.js:476`: same pattern:

   ```js
      p.action = { kind: 'takedown', t: 0, need: .38, target: target.id, fromX: p.x, fromY: p.y };
   ```

3. Add a helper method directly above `updateAction`:

   ```js
  /** The first 90ms of a strike closes the gap to the guard, eased out; then the operative holds. */
  lunge(action, g) {
    const p = this.player, u = Math.min(1, action.t / .09), eased = 1 - Math.pow(1 - u, 3);
    const d = Math.hypot(g.x - action.fromX, g.y - action.fromY) || 1;
    const reach = Math.max(0, d - 9);
    const tx = action.fromX + (g.x - action.fromX) / d * reach * eased, ty = action.fromY + (g.y - action.fromY) / d * reach * eased;
    this.moveBody(p, tx - p.x, ty - p.y, PLAYER_R, this.playerPassable);
  }
   ```

4. In `updateAction`, in both the `kill` and the `takedown` branch, insert `this.lunge(action, g);` on the line after `action.t += dt;`.

5. In `src/client/shadow.js`, add `hitstop: 0,` to the `state` object literal created in `startLoop`.

6. In `handleEvents()` (`src/client/shadow.js`), on the existing `kill` event (lethal knife) and the existing `takedown` event, set `state.hitstop = .05;`. For `kill`, do it only when `event.how === 'knife'`. Pistol kills already have recoil and shake.

7. In `frame`, inside `if (!state.paused && !document.hidden && sim.status === 'playing') {`, make the step loop skip while the hit-stop runs:

   ```js
        if (state.hitstop > 0) { state.hitstop = Math.max(0, state.hitstop - dt); acc = 0; }
        else {
          acc += dt;
          let steps = 0;
          while (acc >= STEP && steps < 6) { sim.step(STEP, input()); acc -= STEP; steps++; }
          if (steps === 6) acc = 0;
        }
   ```

   If plan 002 has landed, the `while` line also calls `snapshot();`. Keep that call.

## Boundaries

- Do NOT change who can be targeted (`knifeTarget`, `takedownTarget`), noise radii, blood or chain scoring.
- Do NOT change hack (4 s) or panel (1.6 s) durations.
- Do NOT add new event types.
- If `updateAction` no longer matches the excerpt (drift since `8c898bd`), STOP and report.

## Verification

- **Mechanical**:
  - `node --experimental-vm-modules --test tools/shadow.test.mjs tools/shadow-jev.test.mjs` (the relay test needs the flag): all pass. The knife test steps 0.6 s and still covers 0.26 s.
  - Add an assertion to the knife test in `tools/shadow.test.mjs` (the test named "the knife kills silently…"): record `const startX = sim.player.x;` before `sim.knife()`, then after `stepFor(sim, .6)` add `assert.ok(Math.abs(sim.player.x - startX) > 3, 'the strike lunges toward the guard');`. The test places the guard 16 px away, so the lunge closes 7 px.
  - `npm run build`: succeeds.
- **Feel check** (dev server, `#/shadow`):
  - Sneak up behind a guard and press X from the edge of reach. The operative visibly darts in, the strike lands in about a quarter second, and a 50 ms freeze lands on the hit.
  - Press E behind a guard. The grab closes the gap, then holds for about 0.3 s before the guard drops.
  - Strike a guard standing against a wall at an angle. The lunge stops at the wall and never clips into it.
  - In DevTools, slow the CPU 4× in the Performance panel and repeat. The lunge still eases out (fast start, soft arrival), with no jump.
- **Done when**: durations match the Target, the lunge assertion passes, and the hit-stop is visible on knife kills and takedowns but not on pistol kills.
