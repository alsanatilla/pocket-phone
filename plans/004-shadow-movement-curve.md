# 004 — Give the operative a faster stride with a short acceleration curve

- **Status**: DONE. Drill capture (commander) before → after: Normal 72.9% → 44.3%, Hard 75.7% → 70.0%, Extreme 81.4% → 77.1%
- **Commit**: 8c898bd
- **Severity**: HIGH
- **Category**: Easing & duration (the velocity curve)
- **Estimated scope**: 1 file (`src/client/shadow-engine.js`), ~30 lines, plus a balance check
- **Depends on**: 003. It needs `moveBody` to return `{ x, y }`.

## Problem

Velocity is a step function: full speed on the first tick of input and zero on the first tick without it, with conservative top speeds:

```js
/* src/client/shadow-engine.js:38 — current */
export const SPEED = Object.freeze({ crouch: 34, walk: 62, run: 108 });
```

```js
/* src/client/shadow-engine.js:256-274 — current */
    let mx = input.move?.x || 0, my = input.move?.y || 0;
    const length = Math.hypot(mx, my);
    if (length > 1) { mx /= length; my /= length; }
    const running = Boolean(input.run) && !p.crouch && !p.carrying && length > .2;
    const speed = p.carrying ? SPEED.crouch * .9 : p.crouch ? SPEED.crouch : running ? SPEED.run : SPEED.walk;
    p.running = running;
    p.moving = length > .2;
    p.speed = p.moving ? speed * Math.min(1, length) : 0;
    if (p.moving) {
      p.facing = Math.atan2(my, mx);
      const before = { x: p.x, y: p.y };
      this.moveBody(p, mx * p.speed * dt, my * p.speed * dt, PLAYER_R, this.playerPassable);
      const moved = Math.hypot(p.x - before.x, p.y - before.y);
      p.step += moved;
      this.metrics.movingTime += dt;
      if (running) this.metrics.runningTime += dt;
      if (p.step >= 18) { p.step = 0; this.footstep(); }
      this.noteTraces();
    }
```

Measured against the 480 px view (`VIEW_W`, `src/client/shadow-render.js`): crossing one screen takes **7.7 s walking, 4.4 s running and 14.1 s crouched**. Running is only 1.29× / 1.16× / 1.09× the guard chase speed on Normal / Hard / Extreme (`chase: 84 / 93 / 99`, `src/client/shadow-engine.js:20, 26, 32`). Escapes feel like wading, and the evaluation harness shows detection ends in capture 80–100% of the time.

The step function has no weight either: starts and stops are robotic, and direction changes have no carry.

## Target

- Top speeds, in world px per second: **crouch 40, walk 76, run 134** (+18–24%). Screen crossing becomes 6.3 s walking and 3.6 s running.
- Velocity eases toward the stick with an exponential approach: `v += (target − v) × (1 − e^(−dt/τ))`. Use **τ = 35 ms when accelerating** (95% of top speed in about 105 ms) and **τ = 28 ms when stopping** (stopped in about 85 ms). Starts snap and stops are a hair quicker, so movement feels immediate but weighted. A reversal carries for about 100 ms, which reads as momentum.
- Below 3 px/s with no input, velocity snaps to zero, so there's no endless creep.
- Hitting a wall zeroes velocity on that axis. A corner nudge (plan 003) counts as movement, so it doesn't stall.
- Guard chase speed rises by 12% to keep tension: **Normal 94, Hard 104, Extreme 111**. Run/chase margins become 1.43 / 1.29 / 1.21. Escapes are possible, but a straight-line sprint still doesn't shake a guard on Extreme.
- `p.moving` means "actually moving" (`p.speed > 6`). Stride animation, visibility and footsteps all key off it, so the operative keeps striding through the 85 ms stop.

## Repo conventions to follow

- Tunable motion constants live at the top of `src/client/shadow-engine.js` next to `SPEED` and `PLAYER_R`. Add `ACCEL_TIME` and `DECEL_TIME` there.
- Difficulty-dependent numbers live in `DIFFICULTY` (`src/client/shadow-engine.js:17-36`). Change `chase:` in place.

## Steps

1. Replace line 38 with:

   ```js
export const SPEED = Object.freeze({ crouch: 40, walk: 76, run: 134 });
// Velocity eases toward the stick: quick to start, a little quicker to stop.
const ACCEL_TIME = .035, DECEL_TIME = .028;
   ```

2. In `DIFFICULTY`, change `chase: 84` → `chase: 94` (normal), `chase: 93` → `chase: 104` (hard) and `chase: 99` → `chase: 111` (extreme). Change nothing else in that table.

3. In the player object in the constructor (`src/client/shadow-engine.js:82`), add `vx: 0, vy: 0,` after `speed: 0,`.

4. Replace the block shown in the Problem section (lines 256–274) with:

   ```js
    let mx = input.move?.x || 0, my = input.move?.y || 0;
    const length = Math.hypot(mx, my);
    if (length > 1) { mx /= length; my /= length; }
    const wants = length > .2;
    const running = Boolean(input.run) && !p.crouch && !p.carrying && wants;
    const top = p.carrying ? SPEED.crouch * .9 : p.crouch ? SPEED.crouch : running ? SPEED.run : SPEED.walk;
    const k = 1 - Math.exp(-dt / (wants ? ACCEL_TIME : DECEL_TIME));
    p.vx += ((wants ? mx * top : 0) - p.vx) * k;
    p.vy += ((wants ? my * top : 0) - p.vy) * k;
    if (!wants && Math.hypot(p.vx, p.vy) < 3) { p.vx = 0; p.vy = 0; }
    p.running = running;
    p.speed = Math.hypot(p.vx, p.vy);
    p.moving = p.speed > 6;
    if (wants) p.facing = Math.atan2(my, mx);
    if (p.speed > 0) {
      const before = { x: p.x, y: p.y };
      const moved = this.moveBody(p, p.vx * dt, p.vy * dt, PLAYER_R, this.playerPassable, 6);
      if (!moved.x) p.vx = 0;
      if (!moved.y) p.vy = 0;
      p.step += Math.hypot(p.x - before.x, p.y - before.y);
      if (p.moving) {
        this.metrics.movingTime += dt;
        if (running) this.metrics.runningTime += dt;
      }
      if (p.step >= 18) { p.step = 0; this.footstep(); }
      this.noteTraces();
    }
   ```

5. Zero momentum wherever the player is placed or locked rather than moved:
   - In `updatePlayer`, inside `if (p.locker) { … }`, add `p.vx = 0; p.vy = 0;` next to `p.moving = false;`.
   - In `updateAction` (`src/client/shadow-engine.js:515-517`), add `p.vx = 0; p.vy = 0;` next to `p.moving = false; p.speed = 0;`.
   - In `enterLocker` and `leaveLocker`, add `p.vx = 0; p.vy = 0;` after the position assignment.

## Boundaries

- Do NOT change guard patrol speeds (`STATE_SPEED`), detection, capture distance or `captureTime`.
- Do NOT change footstep noise radii. More speed already means more footsteps per second, which is the intended stealth cost.
- Do NOT touch `tools/shadow-bot.mjs`. It sends the same input vectors.
- If the block in step 4 no longer matches (drift since `8c898bd`), STOP and report.

## Verification

- **Mechanical**:
  - `node --experimental-vm-modules --test tools/shadow.test.mjs tools/shadow-jev.test.mjs` (the relay test needs the flag): all pass.
  - Balance: run `node tools/shadow-eval.mjs --runs 10 --only drill` **before** this plan and **after** it, and paste both tables into the PR description. Expected: drill capture rates fall but stay **≥ 50% on Extreme** and **≥ 35% on Normal**. If either falls below that, STOP and report the numbers instead of retuning.
  - `npm run build`: succeeds.
- **Feel check** (dev server, `#/shadow`):
  - Tap W once. The operative steps forward and settles within about 0.1 s, with no slide and no lag before the first step.
  - Hold D, then flip to A. The body carries a hair (about 0.1 s), then reverses with no stutter.
  - Run into a wall diagonally. The body slides along it at full speed and does not stick.
  - Release all keys mid-run. The stride animation continues for the 85 ms stop, then stands.
  - Get spotted on Normal and sprint down a corridor. The chasing guard falls behind visibly within 2–3 s.
- **Done when**: speeds and chase values match the Target, the drill numbers are recorded and within bounds, and all tests pass.
