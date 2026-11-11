// Shadow Protocol's camera: a high-angle ¾ view. The rules stay flat (x east,
// y south, in world units, 16 to a tile); only drawing tilts. A point on the
// ground at (x, y) and height z lands on screen at (x, y·K − z·V): the floor is
// squashed a little and anything standing shows its south face. Pure numbers,
// shared by the renderer, the input mapping and the sprite build tools.
export const PITCH = 55 * Math.PI / 180;
/** How much the floor is squashed vertically. */
export const K = Math.sin(PITCH);
/** How tall a vertical world unit looks on screen. */
export const V = Math.cos(PITCH);

// Heights in world units (16 = one tile, roughly a metre). Stylised: walls stay low enough not to hide a room.
export const HEIGHT = Object.freeze({ wall: 24, door: 24, crate: 12, furniture: 8, locker: 22, terminal: 16, panel: 12, fence: 18, tree: 26, duct: 4, person: 28 });

/** Sprite sheets are rendered at this many pixels per world unit; the game scales them to the play field. */
export const SPRITE_PX = 4;

/** A world point to its spot in the projected plane (still in world units, before the camera offset and zoom). */
export const project = (x, y, z = 0) => ({ x, y: y * K - z * V });
/** A projected-plane point back to the ground (z = 0). */
export const unproject = (px, py) => ({ x: px, y: py / K });
