# 002 — Draw Shadow Protocol between simulation steps, and ease the player's turn

- **Status**: DONE, including the follow-up below
- **Commit**: 8c898bd
- **Severity**: HIGH
- **Category**: Performance (frame pacing) + Physicality & origin (facing)
- **Estimated scope**: 1 file (`src/client/shadow.js`), ~35 lines changed

## Problem

Player and guard movement is the most frequent motion in the game: it is on screen 100% of the time. It is drawn from the latest fixed 60 Hz simulation step, with no interpolation:

```js
/* src/client/shadow.js:514-531 — current */
    const frame = now => {
      if (!canvas.isConnected) { stop(); return; }
      const dt = Math.min(.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!state.paused && !document.hidden && sim.status === 'playing') {
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 6) { sim.step(STEP, input()); acc -= STEP; steps++; }
        if (steps === 6) acc = 0;
      }
      handleEvents();
      camera(sim, camView, dt);
      state.shake = state.reduceMotion ? 0 : Math.max(0, state.shake - dt * 2.6);
      const shake = state.shake > .01 ? { x: (Math.random() * 2 - 1) * state.shake * 5, y: (Math.random() * 2 - 1) * state.shake * 4 } : null;
      const jammed = !sim.rules.scannerInAlert && (sim.net.phase === 'alert' || sim.net.phase === 'search');
      drawWorld(ctx, sim, camView, { intel: state.intel, selected: state.selected, aim: state.aim, aiming: state.aim && sim.t - state.aimAt < 4, jammed, shake });
      paintHud();
      if (now - state.lastPaint > 250) { state.lastPaint = now; paintSide(); }
```

A read-only probe of this loop (frame times with ±1.5 ms jitter) measured:

| Display | Frames with 0 steps | Frames with 1 step | Frames with 2 steps |
| --- | --- | --- | --- |
| 60 Hz | 2.3% | 95.4% | 2.3% |
| 120 Hz | 49.9% | 50.1% | 0% |
| 144 Hz | 58.3% | 41.7% | 0% |

A frame with 0 steps draws the same position again, and the camera keeps easing every frame. So on 120/144 Hz screens half the frames freeze the player while the world slides under them, which reads as judder. At 60 Hz, roughly one frame in twenty either stalls or jumps double.

Separately, the player's facing snaps to the stick direction in one step:

```js
/* src/client/shadow-engine.js:264-265 — current */
    if (p.moving) {
      p.facing = Math.atan2(my, mx);
```

Reversing direction flips the sprite 180° between two frames (`drawPlayer` rotates by `p.facing`, `src/client/shadow-render.js:229`). That reads as twitchy, not agile. The simulation must keep the instant facing, because throws and shots aim along it. Only the drawn facing should ease.

## Target

- Every frame draws bodies at `previous + (current − previous) × alpha`, where `alpha = acc / STEP` (clamped to 1, and 1 while paused). The image lags the simulation by at most one 16.7 ms step, which is the standard fixed-timestep trade.
- Any body that moved more than 24 world units in one step (locker exit, debug teleport) draws at its new position, with no lerp across the map.
- The drawn player facing turns toward the true facing at **22 rad/s**, so a 180° reversal takes about 143 ms. Guards' facings interpolate with alpha; they already turn smoothly in the simulation.
- The simulation state is restored right after drawing, so `sim.prompt()`, the HUD and the intel panel always read true positions.
- Reduced motion: keep both. Interpolation removes judder rather than adding motion, and a 143 ms turn is gentle feedback, not movement across the screen.

## Repo conventions to follow

- The loop already uses a fixed timestep (`STEP = 1 / 60`, `src/client/shadow.js:16`) and keeps per-mission view state on `state` / `camView` inside `startLoop`. Put the new snapshot state next to `camView`, in the same closure.
- Angles are wrapped with `Math.atan2(Math.sin(d), Math.cos(d))`, the same shortest-turn idiom `turnToward` uses in `src/client/shadow-nav.js`.

## Steps

1. In `startLoop` (`src/client/shadow.js`), directly after `let acc = 0, last = performance.now();`, add:

   ```js
    // Draw between the last two fixed steps, so motion stays smooth at any refresh rate.
    const bodies = () => [sim.player, ...sim.guards];
    let previous = new Map();
    const snapshot = () => { previous = new Map(bodies().map(body => [body, { x: body.x, y: body.y, facing: body.facing }])); };
    snapshot();
    const drawn = { facing: sim.player.facing };
    const shortest = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
   ```

2. In `frame`, change the step loop line to snapshot before every step:

   ```js
        while (acc >= STEP && steps < 6) { snapshot(); sim.step(STEP, input()); acc -= STEP; steps++; }
   ```

3. In `frame`, replace everything from `camera(sim, camView, dt);` through the `drawWorld(...)` call with the block below. Leave `handleEvents();` where it is, before this block:

   ```js
      const alpha = state.paused ? 1 : Math.min(1, acc / STEP);
      const turn = 22 * dt, toward = shortest(sim.player.facing - drawn.facing);
      drawn.facing = Math.abs(toward) <= turn ? sim.player.facing : drawn.facing + Math.sign(toward) * turn;
      const actual = bodies().map(body => ({ body, x: body.x, y: body.y, facing: body.facing }));
      for (const { body, x, y, facing } of actual) {
        const before = previous.get(body);
        if (!before || Math.hypot(x - before.x, y - before.y) > 24) continue;
        body.x = before.x + (x - before.x) * alpha;
        body.y = before.y + (y - before.y) * alpha;
        if (body !== sim.player) body.facing = before.facing + shortest(facing - before.facing) * alpha;
      }
      sim.player.facing = drawn.facing;
      try {
        camera(sim, camView, dt);
        state.shake = state.reduceMotion ? 0 : Math.max(0, state.shake - dt * 2.6);
        const shake = state.shake > .01 ? { x: (Math.random() * 2 - 1) * state.shake * 5, y: (Math.random() * 2 - 1) * state.shake * 4 } : null;
        const jammed = !sim.rules.scannerInAlert && (sim.net.phase === 'alert' || sim.net.phase === 'search');
        drawWorld(ctx, sim, camView, { intel: state.intel, selected: state.selected, aim: state.aim, aiming: state.aim && sim.t - state.aimAt < 4, jammed, shake });
      } finally {
        for (const { body, x, y, facing } of actual) { body.x = x; body.y = y; body.facing = facing; }
      }
   ```

   `paintHud();` and the `paintSide()` line must stay **after** this block. They read true positions through `sim.prompt()` and the intel data.

4. In `resume` paths and after the debug `teleport` helper (`canvas.shadowDebug.teleport`, in the `import.meta.env.DEV` block of `startLoop`), call `snapshot();` and set `drawn.facing = sim.player.facing;` right after the position change, so a teleport never lerps.

## Boundaries

- Do NOT touch `src/client/shadow-engine.js` or `src/client/shadow-render.js`. Rules and drawing code stay as they are.
- Do NOT interpolate pebbles, tracers, blood or rings. They are short-lived effects and already advance by age.
- Do NOT add dependencies or change the 1/60 step.
- If the frame loop no longer matches the excerpt above (drift since `8c898bd`), STOP and report instead of improvising.

## Verification

- **Mechanical**:
  - `node --experimental-vm-modules --test tools/shadow.test.mjs tools/shadow-jev.test.mjs` (the relay test needs the flag): all pass. The simulation is untouched.
  - `npm run build`: succeeds.
  - With the dev server on 8890 (`JEV_MOCK=1 node --env-file-if-exists=.env node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 8890`), run `PLAYWRIGHT_MODULE=file:///C:/Users/alsana/.config/opencode/mcp-playwright/node_modules/playwright/index.mjs node tools/shadow-browser.mjs`: all PASS lines, no page errors.
- **Feel check**:
  - On a 120 Hz or 144 Hz display, run in a straight line past a wall seam. The player stays locked to the camera with no shimmer, and the walls glide evenly.
  - Tap left, then right, rapidly. The operative visibly turns through about 140 ms instead of flipping, and a pebble thrown during the turn still flies the way the stick points.
  - Enter and leave a locker, and use `shadowDebug.teleport(10, 18)` in the DevTools console. The player appears at the new spot with no streak across the map.
  - In the DevTools Performance panel, record 5 s of running. Each frame's player position is distinct, with no repeated positions on consecutive frames at 120 Hz.
  - Toggle `prefers-reduced-motion` in the Rendering panel. Interpolation and the eased turn stay, and camera shake stays off (existing behaviour).
- **Done when**: no two consecutive frames at 120 Hz draw the player at the same position while running, a 180° reversal takes 6–9 frames at 60 Hz, and all tests and the browser check pass.

## Follow-up (from the execution review, 2026-10-20)

- **Status**: DONE
- **Severity**: LOW

`togglePauseLocal` (`src/client/shadow.js`, inside `startLoop`) runs `clearInput(); acc = 0;` on every toggle. While paused, frames draw at `alpha = 1`, the current state. The first frame after resume draws at `alpha = 0`, the previous step. So the player jumps back by up to one step (about 2 px at a run) for one frame.

Fix: on resume, take a fresh snapshot so the previous and current states match. Change

```js
      if (!state.paused) { last = performance.now(); refs.stage.focus({ preventScroll: true }); }
```

to

```js
      if (!state.paused) { snapshot(); last = performance.now(); refs.stage.focus({ preventScroll: true }); }
```

`snapshot` is defined earlier in `startLoop` by this plan. Both live in the same closure and the call happens at runtime, so their order in the file does not matter.

Feel check: run, press P mid-stride, then press P again. There is no backward twitch on the first frame after resume.
