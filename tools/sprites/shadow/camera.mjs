// The camera and light every Shadow Protocol sprite is rendered with, so props
// and characters sit on the same ¾ view as the game (src/client/shadow-view.js).
//
// Model space is right-handed: x east, y NORTH, z up, in world units (16 to a
// tile). The game's y runs south, so a game position (gx, gy) is model (gx, -gy),
// and a game facing angle a (radians, 0 = east, clockwise on screen) is a
// rotation of -a about z in model space.
import { PITCH, SPRITE_PX } from '../../../src/client/shadow-view.js';
import { norm } from '../ps1/raster.mjs';

const K = Math.sin(PITCH), V = Math.cos(PITCH);

/**
 * An orthographic camera for raster.render(). `origin` is the pixel the model's
 * (0, 0, 0) lands on: put it where the sprite's anchor (its feet) should be.
 * Screen down = gameY·K − z·V, the same as the game.
 */
export function spriteCamera({ px = SPRITE_PX, origin } = {}) {
  // Rows: right (x), screen up (0, K, V), toward the viewer (0, −V, K).
  return { view: [1, 0, 0, 0, 0, K, V, 0, 0, -V, K, 0, 0, 0, 0, 1], ortho: px, origin };
}

/** Moonlight from the north-west and above, a cool fill from the south-east. */
export const SPRITE_LIGHTS = Object.freeze({
  ambient: [.34, .36, .42],
  dirs: [
    { dir: norm([-.45, .55, .75]), color: [.95, .9, .82] },
    { dir: norm([.6, -.5, .35]), color: [.22, .26, .34] },
  ],
});

/** Game facing (0 = east, y south) to a model-space rotation about z. */
export const facingToModel = angle => -angle;
/** The eight directions sprites are rendered in, as game facing angles: east, south-east, south, … */
export const DIRECTIONS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7].map(i => i * Math.PI / 4));
