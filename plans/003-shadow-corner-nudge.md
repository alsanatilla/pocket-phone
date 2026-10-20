# 003 — Slide the operative around door frames instead of stopping dead

- **Status**: DONE
- **Commit**: 8c898bd
- **Severity**: HIGH
- **Category**: Physicality & origin (collision response)
- **Estimated scope**: 1 file (`src/client/shadow-engine.js`), ~30 lines

## Problem

Doors, the culvert, the cut fence and the duct are all one tile (16 px) wide. The player body is a circle of radius 5 (`PLAYER_R`, `src/client/shadow-engine.js:39`). Collision moves each axis separately and simply refuses a blocked axis:

```js
/* src/client/shadow-engine.js:205-210 — current */
  moveBody(body, dx, dy, r, passable) {
    let moved = false;
    if (dx && !this.blocked(body.x + dx, body.y, r, passable)) { body.x += dx; moved = true; }
    if (dy && !this.blocked(body.x, body.y + dy, r, passable)) { body.y += dy; moved = true; }
    return moved;
  }
```

```js
/* src/client/shadow-engine.js:267 — current, the only player caller */
      this.moveBody(p, mx * p.speed * dt, my * p.speed * dt, PLAYER_R, this.playerPassable);
```

A read-only probe walked straight up into the warehouse south door (tile 10,24) from offsets across the door:

| Offset from door centre | Result |
| --- | --- |
| 0–3 px | through in 0.80 s |
| 4 px | stuck at y = 25.21 tiles |
| 5 px | stuck at y = 25.27 tiles |
| 6 px | stuck at y = 25.34 tiles |

Every doorway and crawlway needs pixel-precise lining up, and missing it stops the operative against the frame mid-escape. This is the main reason movement feels stiff. Players dart through doorways dozens of times a mission.

No caller uses `moveBody`'s return value, so it can change shape. Checked with `grep -n "moveBody(" src/client/shadow-engine.js`: lines 267, 904, 943, 1254 and 1255 all ignore it.

## Target

- When the player pushes mostly along one axis (the other input component is under 35% of it) and that axis is blocked, look sideways up to **6 px** for the nearest offset where the forward move would be free. Then slide toward it at the forward step's size per tick. It's a glide, never a teleport.
- Smaller offsets win. At equal distance, check −1 (left/up) before +1.
- Guards are unchanged: they path to tile centres and call `moveBody` without a nudge.
- `moveBody` returns `{ x: boolean, y: boolean }`, true where that axis actually moved (the nudge counts as movement on the side axis). Plan 004 needs this to stop momentum against walls.

## Repo conventions to follow

- Engine methods are small class methods with a one-line JSDoc above when the intent isn't obvious. See `blocked()` at `src/client/shadow-engine.js:196`, which `slideAround` should sit next to.
- Pass behaviour switches as trailing arguments with defaults, as `lineClear(x0, y0, x1, y1, doorOpen = () => false, low = false)` does in `src/client/shadow-nav.js`.

## Steps

1. Replace `moveBody` (`src/client/shadow-engine.js:205-210`) with:

   ```js
  /** Moves axis by axis. With `nudge`, a body pushed straight into a corner slides sideways around it. */
  moveBody(body, dx, dy, r, passable, nudge = 0) {
    let x = false, y = false;
    if (dx) {
      if (!this.blocked(body.x + dx, body.y, r, passable)) { body.x += dx; x = true; }
      else if (nudge && Math.abs(dy) < Math.abs(dx) * .35) y = this.slideAround(body, dx, 0, r, passable, nudge);
    }
    if (dy) {
      if (!this.blocked(body.x, body.y + dy, r, passable)) { body.y += dy; y = true; }
      else if (nudge && Math.abs(dx) < Math.abs(dy) * .35) x = this.slideAround(body, 0, dy, r, passable, nudge) || x;
    }
    return { x, y };
  }

  /** Finds the nearest sideways offset (up to `nudge` px) that frees the forward move, and steps toward it. */
  slideAround(body, dx, dy, r, passable, nudge) {
    const step = Math.max(Math.abs(dx), Math.abs(dy));
    for (let k = 1; k <= nudge; k++) for (const side of [-1, 1]) {
      const ox = dy ? side * k : 0, oy = dx ? side * k : 0;
      if (this.blocked(body.x + ox, body.y + oy, r, passable)) continue;
      if (this.blocked(body.x + ox + dx, body.y + oy + dy, r, passable)) continue;
      const shift = Math.min(k, step);
      body.x += Math.sign(ox) * shift; body.y += Math.sign(oy) * shift;
      return true;
    }
    return false;
  }
   ```

2. Change the player caller at `src/client/shadow-engine.js:267` to pass the nudge:

   ```js
      this.moveBody(p, mx * p.speed * dt, my * p.speed * dt, PLAYER_R, this.playerPassable, 6);
   ```

   If plan 004 has already landed, this line will look different. Add `, 6` as the last argument of the player's `moveBody` call and leave the rest.

3. Add a test at the end of `tools/shadow.test.mjs`:

   ```js
test('the operative slides around a door frame instead of stopping against it', () => {
  for (const offset of [0, 3, 4, 6]) {
    const sim = new ShadowSim({ seed: 1, mode: 'baseline' });
    quiet(sim);
    sim.noCapture = true;
    Object.assign(sim.player, { x: 10 * TILE + 8 + offset, y: 26 * TILE + 8 });
    let t = 0;
    while (t < 2 && sim.player.y > 23 * TILE + 8) { sim.step(1 / 60, { move: { x: 0, y: -1 } }); t += 1 / 60; }
    assert.ok(sim.player.y <= 23 * TILE + 8, `through the warehouse door from ${offset}px off-centre`);
  }
});
   ```

   `quiet`, `TILE` and `ShadowSim` are already imported or defined at the top of that file. If `quiet` is missing, STOP and report.

## Boundaries

- Do NOT pass a nudge for guards (lines 904, 943, 1254, 1255) or change their paths.
- Do NOT change `PLAYER_R`, tile kinds or door logic. A door that is still closing (`open <= .62`) must still block.
- Do NOT add dependencies.
- If `moveBody` no longer matches the excerpt (drift since `8c898bd`), STOP and report.

## Verification

- **Mechanical**:
  - `node --experimental-vm-modules --test tools/shadow.test.mjs tools/shadow-jev.test.mjs` (the relay test needs the flag): all pass, including the new door test.
  - `node tools/shadow-eval.mjs --runs 4 --only drill`: runs to completion (sanity check that guards are unaffected).
  - `npm run build`: succeeds.
- **Feel check** (dev server, `#/shadow`):
  - Walk straight up at the warehouse south door while slightly off-centre. The operative glides sideways into the opening without stopping.
  - Run along a corridor and turn into the break-room door at speed. No hitch at the frame.
  - Crouch and push into the culvert mouth from beside it. The body slides in.
  - Push straight into a plain wall with no opening within 6 px. The body does **not** drift sideways along it.
  - Push into a closed keycard door without a keycard. The body stays put and the "needs a lab keycard" prompt shows.
- **Done when**: the probe offsets 0, 3, 4 and 6 px all pass the door, plain walls cause no drift, and all tests pass.
