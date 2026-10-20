# 006 — Add a dodge roll: a fast burst that slips a grab

- **Status**: TODO
- **Commit**: 8c898bd
- **Severity**: MEDIUM (missed opportunity, and the most direct answer to "make it more agile")
- **Category**: Missed opportunities
- **Estimated scope**: 4 files (`src/client/shadow-engine.js`, `src/client/shadow.js`, `src/client/shadow-render.js`, `src/styles/shadow.css`), ~90 lines, plus 1 test
- **Depends on**: 003 (`moveBody` returns `{ x, y }` and takes a nudge) and 004 (`p.vx` / `p.vy` exist).

## Problem

The operative has three gaits (crouch, walk, run) and no burst move. Once a guard is within capture range (15–17 px, `capture:` in `DIFFICULTY`), the only way out is to outrun them. On Extreme that margin is thin even after plan 004. The evaluation harness (`node tools/shadow-eval.mjs`) shows detection ends in capture 80–100% of the time.

There's no expressive, skill-based movement: nothing to time, nothing to chain between cover. That is the "boring" in the feedback. A roll is the classic stealth-action fix. It's loud and conspicuous, so it's not a free stealth tool, but it lets a good player slip between two guards or break through a doorway mid-chase.

## Target

- **Input**: `R` on the keyboard, plus a `roll` touch key. Edge-triggered: holding does not repeat.
- **Motion**: the roll travels **54 px** (about 3.4 tiles) over **0.26 s** along the stick direction, or along the current facing when the stick is idle. Distance follows ease-out cubic `54 × (1 − (1 − u)³)` with `u = t / 0.26`: a fast launch with a soft glide in, which is the AUDIT's entering curve. To stay safe at the launch speed, apply each tick's distance in sub-steps of at most **4 px** through `moveBody(…, 6)`, so corner nudges still work and walls never tunnel.
- **Exit**: the roll ends on time, or early if both axes are blocked. On exit, carry walking momentum: `p.vx/p.vy = direction × SPEED.walk`. Then a **0.75 s** cooldown starts.
- **Rules**:
  - Can't roll while carrying a body, in a locker, during an action, on a crawl-only tile, or when there's no room to stand. A crouched player stands up into the roll.
  - The roll is loud: on launch, emit a noise of radius `2.6 × surface` tiles, labelled "a scuffle of feet", kind `'step'`. While rolling, `p.running = true`, so visibility uses the existing ×1.32 running factor.
  - While rolling, the capture timer does not fill and decays at the normal 2×/s. Detection still works, so guards still see you.
- **Look**: stretch the body along the roll by **+24%** and squash it across by **−20%**, peaking mid-roll (`sin(π·u)`). Leave up to 6 afterimages, one every 30 ms, each fading over **180 ms** from alpha 0.3. The noise ring the roll already emits doubles as the dust puff.
- **HUD**: the stance label reads `roll` while rolling.
- **Reduced motion**: keep the roll (it's gameplay), drop the afterimages, and halve the squash and stretch (+12% / −10%).

## Repo conventions to follow

- Tunables sit at the top of `src/client/shadow-engine.js` beside `SPEED` (and `ACCEL_TIME` from plan 004). Add `ROLL` there as a frozen object.
- Player state lives on `this.player`, created in the constructor (`src/client/shadow-engine.js:81-86`). Per-move state is an object or null, like `p.action` / `p.locker`.
- Short-lived effects are arrays on the sim aged in `updateEffects` (`src/client/shadow-engine.js:352-359`), e.g. `this.slashes`. Follow that pattern for `this.rollTrail`.
- Client input uses edge flags in `edges` (`src/client/shadow.js:350`), read once in `input()` and cleared on the next line. Touch keys come from `button(label, action, extra)` in `touchControls()`.

## Steps

1. **Constants** (`src/client/shadow-engine.js`, under `SPEED`):

   ```js
// A roll is a fast burst: out quickly, gliding in. Loud, but nobody can grab you mid-roll.
const ROLL = Object.freeze({ time: .26, distance: 54, cooldown: .75, trailEvery: .03, trailLife: .18 });
   ```

2. **Player state**: in the player object literal (constructor), add `roll: null, rollReadyAt: 0,`. In the constructor next to `this.slashes = []` (wherever the effect arrays are initialised), add `this.rollTrail = [];`.

3. **Start and update**: add these methods directly above `updateAction`:

   ```js
  startRoll(move) {
    const p = this.player;
    if (p.roll || p.carrying || p.locker || p.action || this.t < p.rollReadyAt) return;
    const standing = (tx, ty) => playerWalk(tx, ty, false) && this.doorOpen(tx, ty);
    if (kindAt(toTile(p.x), toTile(p.y)).walk === 'crouch' || this.blocked(p.x, p.y, PLAYER_R, standing)) { this.emit('hint', { text: 'no room to roll' }); return; }
    p.crouch = false;
    const length = Math.hypot(move?.x || 0, move?.y || 0);
    const angle = length > .2 ? Math.atan2(move.y, move.x) : p.facing;
    p.roll = { t: 0, angle, done: 0, trailAt: 0 };
    p.facing = angle; p.vx = 0; p.vy = 0;
    this.noise(p.x, p.y, 2.6 * (kindAt(toTile(p.x), toTile(p.y)).sound ?? 1), 'a scuffle of feet', 'step');
    this.emit('roll', { x: p.x, y: p.y, angle });
  }

  updateRoll(dt) {
    const p = this.player, roll = p.roll;
    roll.t = Math.min(ROLL.time, roll.t + dt);
    const u = roll.t / ROLL.time, travelled = ROLL.distance * (1 - Math.pow(1 - u, 3));
    let left = travelled - roll.done, blocked = false;
    roll.done = travelled;
    const before = { x: p.x, y: p.y };
    while (left > 1e-6 && !blocked) {
      const part = Math.min(4, left);
      left -= part;
      const moved = this.moveBody(p, Math.cos(roll.angle) * part, Math.sin(roll.angle) * part, PLAYER_R, this.playerPassable, 6);
      blocked = !moved.x && !moved.y;
    }
    p.running = true; p.moving = true;
    p.speed = Math.hypot(p.x - before.x, p.y - before.y) / Math.max(dt, 1e-6);
    p.step += Math.hypot(p.x - before.x, p.y - before.y);
    this.noteTraces();
    if (this.t - roll.trailAt >= ROLL.trailEvery) {
      roll.trailAt = this.t;
      this.rollTrail.push({ x: p.x, y: p.y, angle: roll.angle, age: 0 });
      if (this.rollTrail.length > 6) this.rollTrail.shift();
    }
    if (roll.t >= ROLL.time || blocked) {
      p.roll = null;
      p.rollReadyAt = this.t + ROLL.cooldown;
      p.vx = Math.cos(roll.angle) * SPEED.walk; p.vy = Math.sin(roll.angle) * SPEED.walk;
      this.footstep();
    }
  }
   ```

4. **Hook into `updatePlayer`**: right after the existing line `if (p.action) return;` (the one after the knock/throw handlers), insert:

   ```js
    if (input.roll) this.startRoll(input.move);
   ```

   Then wrap the whole movement block that plan 004 introduced, from `let mx = input.move?.x || 0` through the closing `}` of `if (p.speed > 0) { … }`, as:

   ```js
    if (p.roll) this.updateRoll(dt);
    else {
      /* the existing movement block, unchanged */
    }
   ```

   The carried-body follow and the visibility calculation after it must stay outside the `else`, so they run during a roll too.

5. **Age the trail**: in `updateEffects` (`src/client/shadow-engine.js:352`), add:

   ```js
    for (const ghost of this.rollTrail) ghost.age += dt;
    this.rollTrail = this.rollTrail.filter(ghost => ghost.age < ROLL.trailLife);
   ```

6. **No grab mid-roll**: in `updateCapture` (`src/client/shadow-engine.js:1757`), insert as the second line:

   ```js
    if (p.roll) { p.caught = Math.max(0, p.caught - dt * 2); return; }
   ```

7. **Keyboard and touch** (`src/client/shadow.js`):
   - `edges` (line 350): add `roll: false`.
   - In the keydown handler, next to the `x`/`X` branch, add: `else if (k === 'r' || k === 'R') { if (!event.repeat) edges.roll = true; event.preventDefault(); }`
   - In `input()`, add `roll: edges.roll,` to the returned object, and add `edges.roll =` to the line that clears the edges.
   - In `touchControls()`, use this key order: `button('act', 'act', 'primary-key'), button('roll', 'roll'), button('crouch', 'crouch'), button('run', 'run'), button('knife', 'knife', 'danger-key'), button('pistol', 'shoot', 'danger-key'), button('knock', 'knock'), button('throw', 'throw'), button('intel', 'intel', 'wide-key')`.
   - In the touch `pointerdown` handler, add `else if (action === 'roll') edges.roll = true;`.
   - Stance label (`src/client/shadow.js:545`): insert `p.roll ? 'roll' :` immediately after `p.locker ? 'locker' :`.
   - Controls text: in the briefing list, change `'WASD / arrows move · Shift run · C crouch'` to `'WASD / arrows move · Shift run · R roll · C crouch'`. In the `.shadow-keys` line (`src/client/shadow.js:323`), change `Shift run · ` to `Shift run · R roll · `.
   - Pass reduced motion to the renderer: in the `drawWorld(ctx, sim, camView, { … })` options, add `reduceMotion: state.reduceMotion`.

8. **CSS** (`src/styles/shadow.css`, after line 157 `.shadow-touch-key.danger-key …`):

   ```css
.shadow-touch-key.wide-key { grid-column: 1 / -1; min-height: 40px; }
   ```

9. **Renderer** (`src/client/shadow-render.js`):
   - In `drawPlayer` (line 222), change the signature to `drawPlayer(ctx, p, time, reduceMotion = false)`. Immediately after `ctx.scale(crouch, crouch);` add:

     ```js
  if (p.roll) {
    const pulse = Math.sin(Math.PI * Math.min(1, p.roll.t / .26)) * (reduceMotion ? .5 : 1);
    ctx.scale(1 + .24 * pulse, 1 - .2 * pulse);
  }
     ```

   - In `drawWorld`, directly before `drawPlayer(ctx, sim.player, time);` (line 480), draw the afterimages, and pass the flag:

     ```js
  if (!opts.reduceMotion) for (const ghost of sim.rollTrail || []) {
    ctx.save();
    ctx.globalAlpha = .3 * (1 - ghost.age / .18);
    ctx.translate(ghost.x, ghost.y); ctx.rotate(ghost.angle);
    ctx.fillStyle = '#2d4b4f'; ctx.beginPath(); ctx.ellipse(0, 0, 6.2, 3.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  drawPlayer(ctx, sim.player, time, opts.reduceMotion);
     ```

10. **Test**: append to `tools/shadow.test.mjs`:

    ```js
test('a roll bursts about 54px, respects walls, cools down and slips a grab', () => {
  const sim = new ShadowSim({ seed: 2, mode: 'baseline' });
  quiet(sim);
  Object.assign(sim.player, at(36, 14));
  const startX = sim.player.x;
  sim.step(1 / 60, { roll: true, move: { x: 1, y: 0 } });
  assert.ok(sim.player.roll, 'rolling');
  stepFor(sim, .3);
  assert.equal(sim.player.roll, null, 'the roll ends on time');
  assert.ok(sim.player.x - startX > 45 && sim.player.x - startX < 62, 'travelled about 54px, got ' + (sim.player.x - startX).toFixed(1));
  sim.step(1 / 60, { roll: true, move: { x: -1, y: 0 } });
  assert.equal(sim.player.roll, null, 'cooldown blocks an immediate second roll');
  stepFor(sim, .8);
  Object.assign(sim.player, at(42, 14));
  sim.step(1 / 60, { roll: true, move: { x: 1, y: 0 } });
  stepFor(sim, .3);
  assert.ok(sim.player.x < 44 * TILE, 'the east corridor wall stops the roll');
});
    ```

    It uses `quiet`, `at`, `stepFor`, `TILE` and `ShadowSim`, all already defined at the top of the file. Tiles (36,14) to (42,14) are the open north corridor. If the second roll start lands inside a wall in the current map, STOP and report.

## Boundaries

- Do NOT let the roll enter crawl-only tiles (ducts, culvert, cut fence). `playerPassable` already blocks them while standing; keep it that way.
- Do NOT change guard detection, hearing ranges or the capture distance. Only the capture timer is paused during the roll.
- Do NOT touch `tools/shadow-bot.mjs` or the evaluation harness. The bot doesn't roll.
- Do NOT add dependencies or new sounds. The existing `step` noise handles hearing, and audio is out of scope.
- If any excerpt or line reference doesn't match (drift since `8c898bd`, or plans 003/004 not applied), STOP and report.

## Verification

- **Mechanical**:
  - `node --experimental-vm-modules --test tools/shadow.test.mjs tools/shadow-jev.test.mjs` (the relay test needs the flag): all pass, including the new roll test.
  - `node tools/shadow-eval.mjs --runs 4 --only drill`: still runs (the bot never rolls, so its numbers should match plan 004's "after" numbers within noise).
  - `npm run build`: succeeds.
  - Browser check (`tools/shadow-browser.mjs`, dev server on 8890): all PASS, and at 390 px there is still no horizontal overflow with nine touch keys.
- **Feel check** (dev server, `#/shadow`):
  - Press R while running. The operative launches hard, stretches, and glides to a stop about 3 tiles on, with a faint trail behind.
  - Press R repeatedly. The second roll only fires after the 0.75 s cooldown, and pressing during cooldown does nothing.
  - Roll into a wall. The roll ends at the wall with no jitter, and you keep control.
  - Get spotted and let a guard close in, then roll past him. The capture never completes mid-roll, but he still sees you and keeps chasing.
  - Roll in a quiet room near a guard. He hears it (a noise ring appears and his "?" pops).
  - In DevTools, set animation/CPU throttling 4× and confirm the trail never draws more than 6 ghosts and fades within about 0.2 s.
  - Toggle `prefers-reduced-motion`. The roll still moves, the afterimages are gone, and the stretch is visibly milder.
  - At 390 px width, the `roll` key sits second in the first row and `intel` spans the bottom row.
- **Done when**: the roll test passes, the roll is usable on keyboard and touch, and reduced motion keeps the move but drops the trail.
