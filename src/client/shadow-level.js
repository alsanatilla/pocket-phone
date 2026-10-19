// Shadow Protocol's facility. Pure data and geometry helpers, no DOM: the
// level, its zones, portals, lights, cameras and patrol routes can be checked
// from node.
export const TILE = 16;
export const COLS = 64;
export const ROWS = 44;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

// walk: who may stand on the tile. 'crouch' is player-only and needs a crouch.
// sight: 'block' stops every ray, 'low' only hides a crouched body behind it.
export const TILE_KINDS = Object.freeze({
  '#': { name: 'wall', walk: 'none', sight: 'block' },
  'T': { name: 'tree', walk: 'none', sight: 'block' },
  'F': { name: 'fence', walk: 'none', sight: 'clear' },
  'f': { name: 'cut fence', walk: 'crouch', sight: 'clear', sound: .8, trace: 'fence' },
  '~': { name: 'culvert', walk: 'crouch', sight: 'block', sound: .5, hide: 'duct' },
  'v': { name: 'air duct', walk: 'crouch', sight: 'block', sound: .6, hide: 'duct' },
  'C': { name: 'crates', walk: 'none', sight: 'low' },
  'B': { name: 'furniture', walk: 'none', sight: 'low' },
  'L': { name: 'locker', walk: 'none', sight: 'block', hide: 'locker' },
  'D': { name: 'door', walk: 'all', sight: 'door', sound: 1 },
  'K': { name: 'keycard door', walk: 'all', sight: 'door', sound: 1, locked: true },
  'O': { name: 'data terminal', walk: 'none', sight: 'low' },
  'P': { name: 'camera panel', walk: 'none', sight: 'low' },
  '.': { name: 'floor', walk: 'all', sight: 'clear', sound: 1 },
  ':': { name: 'metal grating', walk: 'all', sight: 'clear', sound: 1.7 },
  ',': { name: 'grass', walk: 'all', sight: 'clear', sound: .7, outdoor: true },
  '"': { name: 'tall grass', walk: 'all', sight: 'clear', sound: .8, outdoor: true, hide: 'grass' },
  '_': { name: 'concrete', walk: 'all', sight: 'clear', sound: 1, outdoor: true },
  '=': { name: 'road', walk: 'all', sight: 'clear', sound: 1, outdoor: true },
  'X': { name: 'extraction pad', walk: 'all', sight: 'clear', sound: 1, outdoor: true },
});

function build() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(','));
  const fill = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = ch; };
  const box = (x0, y0, x1, y1, inner = '.') => {
    fill(x0, y0, x1, y1, '#');
    if (inner) fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, inner);
  };
  const put = (x, y, ch) => { g[y][x] = ch; };

  // Inside the perimeter: concrete yards, with the facility's outer wall.
  fill(0, 0, 63, 30, '_');
  fill(0, 0, 63, 0, '#'); fill(0, 0, 0, 30, '#'); fill(63, 0, 63, 30, '#');

  // Research laboratory, north centre.
  box(20, 3, 43, 10);
  box(27, 3, 36, 7, '.');            // server room
  put(31, 7, 'D'); put(32, 7, 'D');
  put(31, 4, 'O'); put(32, 4, 'O');
  fill(28, 4, 29, 4, 'B'); fill(34, 4, 35, 4, 'B');
  fill(21, 4, 25, 9, '.'); fill(26, 4, 26, 9, '#'); put(26, 8, 'D'); // back room
  fill(22, 4, 24, 4, 'B'); put(21, 9, 'L');
  fill(28, 9, 29, 9, 'B'); fill(34, 9, 36, 9, 'B'); fill(38, 5, 40, 5, 'B'); fill(38, 8, 40, 8, 'B'); // lab benches
  put(31, 10, 'K'); put(32, 10, 'K');  // main door from the alley
  put(38, 3, 'D');                     // north door to the service lane
  put(43, 6, 'D'); put(43, 7, 'D');    // east door to the helipad yard

  // The air duct: warehouse grate → behind the dock wall → lab back room.
  fill(17, 3, 17, 11, '#'); fill(19, 3, 19, 11, '#');
  fill(18, 4, 18, 12, 'v'); put(19, 5, 'v'); put(20, 5, 'v'); put(18, 3, '#');

  // Middle band: warehouse, surveillance corridors, barracks.
  box(1, 12, 19, 24);
  box(19, 12, 44, 24);
  box(44, 12, 62, 24);
  put(18, 12, 'v'); put(18, 13, 'v');

  // Warehouse: crate aisles that loop, lockers on the west wall, a catwalk.
  for (const [x, y] of [[4, 14], [9, 14], [14, 14], [4, 19], [9, 19], [14, 19]]) fill(x, y, x + 2, y + 2, 'C');
  fill(7, 17, 7, 17, 'C'); fill(12, 22, 12, 22, 'C'); fill(16, 17, 16, 17, 'C');
  fill(2, 14, 2, 17, 'L');
  fill(9, 17, 13, 18, ':');
  put(8, 12, 'D'); put(10, 24, 'D'); put(19, 18, 'D');

  // Corridors: a ring around two rooms with a cross corridor, so guards can
  // flank instead of shuttling up and down one hallway.
  box(23, 16, 30, 20, '.');           // security office
  box(33, 16, 40, 20, '.');           // break room
  put(27, 20, 'D'); put(30, 18, 'D'); put(33, 18, 'D'); put(37, 16, 'D');
  put(25, 17, 'P'); fill(28, 17, 29, 17, 'B');
  fill(35, 18, 37, 18, 'B'); put(39, 19, 'L');
  fill(31, 13, 32, 15, ':');
  put(31, 12, 'D'); put(32, 12, 'D'); put(31, 24, 'D'); put(32, 24, 'D'); put(44, 18, 'D');

  // Barracks: bunks, officer's office (keycard), mess.
  fill(55, 13, 55, 23, '#'); fill(56, 18, 61, 18, '#');
  put(55, 15, 'D'); put(55, 21, 'D'); put(59, 18, 'D');
  for (const y of [15, 18, 21]) { fill(46, y, 48, y, 'B'); fill(51, y, 53, y, 'B'); }
  fill(46, 13, 50, 13, 'L');
  fill(57, 14, 59, 14, 'B'); fill(57, 20, 60, 21, 'B');
  put(52, 12, 'D'); put(50, 24, 'D');

  // North: dock yard and the service lane behind the lab.
  fill(2, 4, 4, 5, 'C'); fill(10, 6, 12, 7, 'C'); fill(5, 9, 6, 10, 'C'); fill(13, 9, 14, 9, 'C');
  // Helipad yard and the extraction pad.
  fill(52, 4, 58, 8, 'X');
  fill(46, 2, 47, 3, 'C'); fill(60, 9, 61, 10, 'C'); fill(48, 9, 49, 9, 'C'); fill(61, 3, 61, 4, 'C');

  // South yard: west lot, checkpoint and parking.
  fill(2, 26, 4, 27, 'C'); fill(12, 27, 13, 28, 'C'); fill(15, 25, 16, 25, 'C');
  fill(1, 28, 3, 30, '"'); fill(7, 29, 10, 30, '"');
  fill(30, 25, 33, 30, '=');
  box(35, 26, 39, 29); put(35, 28, 'D'); put(37, 27, 'B');
  fill(24, 27, 27, 28, 'C'); fill(21, 25, 22, 25, 'C');
  fill(43, 27, 45, 28, 'C'); fill(49, 27, 51, 28, 'C'); fill(55, 26, 57, 27, 'C');
  fill(59, 29, 61, 30, '"');

  // Perimeter fence with a culvert in the west and a cut section in the east.
  fill(0, 31, 63, 31, 'F');
  fill(30, 31, 33, 31, '=');
  fill(5, 29, 5, 32, '~');
  put(58, 31, 'f');

  // Exterior: woods, tall grass and the approach road.
  fill(30, 32, 33, 43, '=');
  fill(0, 43, 63, 43, 'T'); fill(0, 32, 0, 43, 'T'); fill(63, 32, 63, 43, 'T');
  for (const [x, y, w, h] of [[2, 35, 2, 2], [9, 33, 2, 1], [14, 37, 3, 2], [24, 34, 2, 2], [3, 40, 2, 2], [38, 36, 2, 3], [45, 33, 2, 2], [52, 38, 3, 2], [58, 35, 2, 2], [43, 41, 2, 1], [26, 39, 1, 2]]) fill(x, y, x + w - 1, y + h - 1, 'T');
  for (const [x, y, w, h] of [[6, 36, 4, 3], [17, 33, 5, 2], [11, 40, 6, 2], [35, 33, 2, 6], [47, 37, 4, 3], [55, 32, 6, 2], [27, 35, 2, 3], [6, 33, 2, 2]]) fill(x, y, x + w - 1, y + h - 1, '"');
  return g.map(row => row.join(''));
}

export const MAP = Object.freeze(build());

export const START = Object.freeze({ x: 20 * TILE + 8, y: 41 * TILE + 8 });

// Zones, most specific first. Jev talks about the facility in these names.
export const ZONES = Object.freeze([
  { id: 'server', name: 'server room', sector: 'lab', rect: [28, 4, 35, 6], desc: 'The data terminal: the mission objective.' },
  { id: 'lab_back', name: 'lab back room', sector: 'lab', rect: [21, 4, 25, 9], desc: 'Storage room at the west end of the lab; the air duct opens here.' },
  { id: 'lab', name: 'research lab', sector: 'lab', rect: [21, 4, 42, 9], desc: 'Lab hall with benches. Keycard door south, doors north and east.' },
  { id: 'duct', name: 'air duct', sector: 'warehouse', rect: [18, 4, 18, 13], rects: [[18, 4, 18, 13], [19, 5, 20, 5]], desc: 'Crawl duct from the warehouse grate to the lab back room. Guards cannot enter.' },
  { id: 'north_lane', name: 'service lane', sector: 'north', rect: [1, 1, 62, 2], desc: 'Lane along the north wall linking the dock, the lab north door and the helipad.' },
  { id: 'dock', name: 'loading dock', sector: 'north', rect: [1, 3, 16, 11], desc: 'Dark dock yard north of the warehouse.' },
  { id: 'helipad', name: 'helipad', sector: 'north', rect: [44, 3, 62, 11], desc: 'Extraction pad. Reached from the lab east door, the barracks north door, the alley or the service lane.' },
  { id: 'alley', name: 'north alley', sector: 'north', rect: [20, 11, 43, 11], desc: 'Open strip between the corridors and the lab keycard door.' },
  { id: 'warehouse', name: 'storage warehouse', sector: 'warehouse', rect: [2, 13, 18, 23], desc: 'Crate aisles, lockers and the duct grate.' },
  { id: 'security', name: 'security office', sector: 'corridors', rect: [24, 17, 29, 19], desc: 'Camera control panel.' },
  { id: 'breakroom', name: 'break room', sector: 'corridors', rect: [34, 17, 39, 19], desc: 'Small room with one locker.' },
  { id: 'corr_w', name: 'west corridors', sector: 'corridors', rect: [20, 13, 32, 23], desc: 'West half of the corridor ring.' },
  { id: 'corr_e', name: 'east corridors', sector: 'corridors', rect: [33, 13, 43, 23], desc: 'East half of the corridor ring.' },
  { id: 'office', name: 'officer’s office', sector: 'barracks', rect: [56, 13, 61, 17], desc: 'Desk with a lab keycard.' },
  { id: 'mess', name: 'mess hall', sector: 'barracks', rect: [56, 19, 61, 23], desc: 'Tables. Reached from the bunks.' },
  { id: 'bunks', name: 'barracks bunks', sector: 'barracks', rect: [45, 13, 54, 23], desc: 'Bunks and lockers. Doors west, south and north.' },
  { id: 'culvert', name: 'culvert', sector: 'perimeter', rect: [5, 29, 5, 32], desc: 'Drain under the west fence. Guards cannot enter.' },
  { id: 'yard_w', name: 'west lot', sector: 'yard', rect: [1, 25, 18, 30], desc: 'Dark lot behind the warehouse; tall grass by the fence.' },
  { id: 'checkpoint', name: 'checkpoint', sector: 'yard', rect: [19, 25, 39, 30], desc: 'Gate, guard booth and the road to the corridors.' },
  { id: 'yard_e', name: 'east yard', sector: 'yard', rect: [40, 25, 62, 30], desc: 'Parking. The east fence has a cut section.' },
  { id: 'ext_w', name: 'west woods', sector: 'exterior', rect: [0, 32, 21, 43], desc: 'Woods outside the west fence and the culvert mouth.' },
  { id: 'ext_c', name: 'approach road', sector: 'exterior', rect: [22, 32, 41, 43], desc: 'The road to the gate.' },
  { id: 'ext_e', name: 'east woods', sector: 'exterior', rect: [42, 32, 63, 43], desc: 'Woods outside the east fence.' },
]);
export const ZONE_BY_ID = Object.freeze(Object.fromEntries(ZONES.map(zone => [zone.id, zone])));

export const SECTORS = Object.freeze({
  exterior: 'outside the fence', perimeter: 'the fence line', yard: 'the south yards', warehouse: 'the storage warehouse',
  corridors: 'the surveillance corridors', barracks: 'the guard barracks', lab: 'the research lab', north: 'the north yards',
});

// Lamps: x, y in tiles; r in tiles; strength 0..1.
export const LAMPS = Object.freeze([
  { x: 31.5, y: 27, r: 7, s: .85 }, { x: 31.5, y: 31.5, r: 5, s: .7 }, { x: 37, y: 27.5, r: 3, s: .55 },
  { x: 25, y: 14, r: 6, s: .7 }, { x: 38, y: 14, r: 6, s: .7 }, { x: 25, y: 22, r: 6, s: .65 }, { x: 38, y: 22, r: 6, s: .65 },
  { x: 21.5, y: 18, r: 4, s: .45 }, { x: 42.5, y: 18, r: 4, s: .5 },
  { x: 27, y: 18, r: 4, s: .6 }, { x: 36, y: 18, r: 4, s: .45 },
  { x: 10, y: 18, r: 5, s: .45 }, { x: 15, y: 22, r: 3, s: .3 },
  { x: 31.5, y: 5, r: 5, s: .9 }, { x: 37, y: 7, r: 7, s: .75 }, { x: 23, y: 7, r: 3, s: .25 },
  { x: 55, y: 6, r: 8, s: .85 }, { x: 31.5, y: 11, r: 4, s: .6 }, { x: 52, y: 11, r: 4, s: .55 },
  { x: 58, y: 15, r: 4, s: .5 }, { x: 58, y: 21, r: 4, s: .4 }, { x: 50, y: 18, r: 3, s: .18 },
  { x: 50, y: 27, r: 6, s: .55 }, { x: 10, y: 3, r: 4, s: .35 }, { x: 38, y: 2, r: 4, s: .4 },
]);
export const AMBIENT = Object.freeze({ outdoor: .2, indoor: .24 });

// Cameras: tile position, facing (radians), sweep half-width, period.
export const CAMERAS = Object.freeze([
  { id: 'cam-gate', name: 'gate camera', x: 29.5, y: 25.3, facing: Math.PI * .5, sweep: .75, period: 9, range: 8.5 },
  { id: 'cam-north', name: 'north corridor camera', x: 20.3, y: 13.3, facing: Math.PI * .1, sweep: .55, period: 8, range: 9 },
  { id: 'cam-south', name: 'south corridor camera', x: 43.7, y: 23.7, facing: Math.PI * 1.1, sweep: .55, period: 8.5, range: 9 },
  { id: 'cam-lab', name: 'lab camera', x: 42.7, y: 4.3, facing: Math.PI * .8, sweep: .6, period: 10, range: 10 },
  { id: 'cam-heli', name: 'helipad camera', x: 44.3, y: 3.3, facing: Math.PI * .2, sweep: .6, period: 11, range: 9 },
]);

export const PANEL = Object.freeze({ x: 25, y: 17, zone: 'security' });
export const TERMINAL = Object.freeze({ x: 31.5, y: 4, zone: 'server' });
export const KEYCARD = Object.freeze({ x: 58.5, y: 15.5, zone: 'office' });
export const EXTRACTION = Object.freeze({ rect: [52, 4, 58, 8], zone: 'helipad' });

// Named chokepoints Jev can ask a guard to hold. Each lists the tile a guard
// stands on and the direction it watches.
export const POSTS = Object.freeze([
  { id: 'gate', name: 'the gate', x: 31.5, y: 29, face: Math.PI * .5, zone: 'checkpoint' },
  { id: 'corr_south_door', name: 'corridor south door', x: 31.5, y: 22.5, face: Math.PI * .5, zone: 'corr_w' },
  { id: 'warehouse_east_door', name: 'warehouse east door', x: 21, y: 18.5, face: Math.PI, zone: 'corr_w' },
  { id: 'warehouse_south_door', name: 'warehouse south door', x: 10.5, y: 26, face: -Math.PI * .5, zone: 'yard_w' },
  { id: 'warehouse_north_door', name: 'warehouse north door', x: 8.5, y: 10.5, face: Math.PI * .5, zone: 'dock' },
  { id: 'duct_grate', name: 'warehouse duct grate', x: 17.5, y: 15.2, face: -Math.PI / 2, zone: 'warehouse' },
  { id: 'duct_exit', name: 'lab duct exit', x: 22.5, y: 6.5, face: Math.PI, zone: 'lab_back' },
  { id: 'lab_main_door', name: 'lab keycard door', x: 31.5, y: 8.6, face: Math.PI * .5, zone: 'lab' },
  { id: 'server_door', name: 'server room door', x: 31.5, y: 8, face: Math.PI * .5, zone: 'lab' },
  { id: 'lab_north_door', name: 'lab north door', x: 38.5, y: 4.5, face: -Math.PI * .5, zone: 'lab' },
  { id: 'lab_east_door', name: 'lab east door', x: 45.5, y: 6.5, face: Math.PI, zone: 'helipad' },
  { id: 'heli_west', name: 'helipad west edge', x: 50.5, y: 6.5, face: Math.PI, zone: 'helipad' },
  { id: 'barracks_north_door', name: 'barracks north door', x: 52.5, y: 10.5, face: Math.PI * .5, zone: 'helipad' },
  { id: 'barracks_west_door', name: 'barracks west door', x: 42, y: 18.5, face: 0, zone: 'corr_e' },
  { id: 'barracks_south_door', name: 'barracks south door', x: 50.5, y: 26, face: -Math.PI * .5, zone: 'yard_e' },
  { id: 'east_fence', name: 'east fence cut', x: 57, y: 29, face: Math.PI * .5, zone: 'yard_e' },
  { id: 'culvert_mouth', name: 'culvert exit', x: 6.5, y: 27.5, face: Math.PI * .5, zone: 'yard_w' },
  { id: 'alley_mid', name: 'north alley', x: 36, y: 11.5, face: Math.PI, zone: 'alley' },
  { id: 'lane_west', name: 'service lane west', x: 12, y: 1.5, face: 0, zone: 'north_lane' },
  { id: 'security_office', name: 'security office', x: 26.5, y: 18.5, face: Math.PI * .5, zone: 'security' },
]);
export const POST_BY_ID = Object.freeze(Object.fromEntries(POSTS.map(post => [post.id, post])));

// Patrol routes in tiles. Each guard slot has variants; a mission picks one.
export const PATROLS = Object.freeze({
  perimeter: [
    [[4, 34.5], [20, 33.5], [28, 34.5], [44, 34.5], [56, 33.5], [44, 34.5], [28, 34.5], [20, 33.5]],
    [[5, 34], [21, 34.5], [29, 33], [42, 33], [54, 35], [42, 33], [29, 33], [21, 34.5]],
  ],
  // The gate guard watches the road, but turns to the booth and the yard: windows for a bold entry.
  gate: [
    [[31.5, 29.5, 'hold', Math.PI * .5, 6], [34.2, 30.3, 'hold', 0, 4], [31.5, 29.5, 'hold', Math.PI * .5, 5], [29.3, 27.5, 'hold', -Math.PI * .65, 4]],
    [[30, 29.5, 'hold', Math.PI * .55, 7], [34.2, 27.5, 'hold', -Math.PI * .2, 4], [31.5, 26.5, 'hold', -Math.PI * .5, 3]],
  ],
  yard: [
    [[20, 26], [22, 29.5], [40, 29.5], [47, 25.6], [58, 28.5], [47, 25.6], [40, 29.5], [22, 29.5]],
    [[16, 29.5], [11, 26], [6, 27], [11, 26], [16, 29.5], [28, 26], [41, 25.6], [28, 26]],
  ],
  warehouse: [
    [[3.5, 18.5], [8, 18.5], [13, 18.5], [17.5, 18.5], [17.5, 22.5], [8, 22.5], [3.5, 22.5], [3.5, 18.5], [3.5, 13.5], [12, 13.5], [17.5, 13.5], [17.5, 18.5]],
    [[17.5, 22.5], [17.5, 13.5], [8, 13.5], [8, 18.5, 'hold', Math.PI, 3], [8, 22.5], [13, 22.5]],
  ],
  backlot: [
    [[10.5, 25.6], [6, 26], [3, 25.6], [6, 30], [14, 30], [17.5, 26.5], [10.5, 25.6]],
    [[8.5, 11], [3, 8], [8, 3.5], [15.5, 3.5], [15.5, 8], [8.5, 11], [8.5, 11.5, 'hold', Math.PI * .5, 4]],
  ],
  corridorA: [
    [[21, 14], [42.5, 14], [42.5, 22.5], [21, 22.5]],
    [[21, 22.5], [31.5, 22.5], [31.5, 14], [42.5, 14], [42.5, 22.5], [31.5, 22.5], [31.5, 14], [21, 14]],
  ],
  corridorB: [
    [[42.5, 22.5], [21, 22.5], [21, 14], [42.5, 14]],
    [[26.5, 18.5, 'hold', Math.PI * .5, 5], [27.5, 21.5], [21, 22], [21, 14], [29.5, 14], [31.5, 18.5], [29.5, 18.5], [26.5, 18.5]],
  ],
  barracks: [
    [[46, 17], [54, 17], [54, 20], [46, 20], [46, 22.5], [54, 22.5], [57, 21.5], [60.5, 22.5], [57, 21.5], [54, 22.5]],
    [[50, 14.5], [54, 16.5], [57, 15.5], [60.5, 16.5], [57, 15.5], [54, 16.5], [50, 19.5], [46, 19.5], [50, 14.5]],
  ],
  lab: [
    [[33.5, 8.5], [41.5, 8.5], [41.5, 4.5], [37, 6.5], [33.5, 6], [27, 8.5], [25.5, 8.5], [27, 8.5]],
    [[41.5, 6.5, 'hold', Math.PI, 4], [36, 6.5], [27.5, 8.5], [24, 6.5], [27.5, 8.5], [36, 6.5]],
  ],
  // The objective guard covers the lab doorway, then turns to check the terminal:
  // that turn is the window for a takedown from behind.
  server: [
    [[31.5, 8.6, 'hold', Math.PI * .5, 6], [36.5, 8.5, 'hold', 0, 3], [31.5, 8.6, 'hold', Math.PI * .5, 4], [31.5, 5.6, 'hold', -Math.PI * .5, 4]],
    [[33.5, 8.5, 'hold', Math.PI * .5, 5], [29.5, 8.5, 'hold', Math.PI * .6, 5], [31.5, 5.6, 'hold', -Math.PI * .5, 4]],
  ],
  helipad: [
    [[45.5, 4.5], [51, 3.5], [59.5, 3.5], [59.5, 9.5], [51, 10.5], [45.5, 10.5], [45.5, 4.5]],
    [[49.5, 6.5, 'hold', 0, 4], [55, 9.5], [61, 6.5, 'hold', Math.PI, 4], [55, 3.5]],
  ],
  alley: [
    [[21, 11.5], [42.5, 11.5], [44.5, 10], [42.5, 11.5]],
    [[42.5, 11.5], [21, 11.5], [21, 11.5, 'hold', 0, 3]],
  ],
  lane: [
    [[2, 1.5], [62, 1.5]],
    [[16, 1.5], [36, 1.5], [44, 2], [36, 1.5]],
  ],
});

// Guard slots: which patrol each guard owns, which ones are always staffed and
// which belong to the reserve the posture decision can move.
export const GUARD_SLOTS = Object.freeze([
  { id: 'g1', name: 'Kestrel', patrol: 'gate', core: true },
  { id: 'g2', name: 'Moss', patrol: 'yard', core: true },
  { id: 'g3', name: 'Rook', patrol: 'warehouse', core: true },
  { id: 'g4', name: 'Vale', patrol: 'corridorA', core: true },
  { id: 'g5', name: 'Pike', patrol: 'corridorB', core: true },
  { id: 'g6', name: 'Ash', patrol: 'barracks', core: true },
  { id: 'g7', name: 'Heron', patrol: 'lab', core: true },
  { id: 'g8', name: 'Ward', patrol: 'server', core: true, objective: true },
  { id: 'g9', name: 'Flint', patrol: 'helipad', core: false },
  { id: 'g10', name: 'Sable', patrol: 'perimeter', core: false },
  { id: 'g11', name: 'Lark', patrol: 'backlot', core: false },
  { id: 'g12', name: 'Cove', patrol: 'alley', core: false },
]);

export const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) ? '#' : MAP[ty][tx];
export const kindAt = (tx, ty) => TILE_KINDS[tileAt(tx, ty)] || TILE_KINDS['#'];
export const toTile = value => Math.floor(value / TILE);
export const center = t => t * TILE + TILE / 2;

const ZONE_GRID = (() => {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const zone = ZONES.find(item => (item.rects || [item.rect]).some(rect => x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3]));
    grid[y][x] = zone ? zone.id : null;
  }
  return grid;
})();

/** The zone id for a world position, or the nearest zone for wall tiles. */
export function zoneAt(x, y) {
  const tx = Math.max(0, Math.min(COLS - 1, toTile(x))), ty = Math.max(0, Math.min(ROWS - 1, toTile(y)));
  const direct = ZONE_GRID[ty][tx];
  if (direct) return direct;
  for (let r = 1; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = tx + dx, ny = ty + dy;
    if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && ZONE_GRID[ny][nx] && kindAt(nx, ny).walk !== 'none') return ZONE_GRID[ny][nx];
  }
  return 'checkpoint';
}
export const zoneOfTile = (tx, ty) => ZONE_GRID[ty]?.[tx] || null;

/** Portals: where two zones touch through passable tiles. Derived, not authored.
 * Doors and gaps sit on unzoned wall lines, so a run of unzoned passable tiles
 * bridges every zone it touches. */
export const PORTALS = Object.freeze((() => {
  const pairs = new Map();
  const passable = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && kindAt(x, y).walk !== 'none';
  const add = (a, b, x, y, crawl) => {
    if (!a || !b || a === b) return;
    const key = [a, b].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push([x, y, crawl]);
  };
  const seen = new Set();
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!passable(x, y)) continue;
    const a = ZONE_GRID[y][x];
    if (a) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny) || !ZONE_GRID[ny][nx]) continue;
        add(a, ZONE_GRID[ny][nx], x + dx / 2, y + dy / 2, kindAt(x, y).walk === 'crouch' || kindAt(nx, ny).walk === 'crouch');
      }
      continue;
    }
    if (seen.has(x + ',' + y)) continue;
    const run = [], touched = new Set(), queue = [[x, y]];
    seen.add(x + ',' + y);
    while (queue.length) {
      const [cx, cy] = queue.pop();
      run.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!passable(nx, ny)) continue;
        if (ZONE_GRID[ny][nx]) { touched.add(ZONE_GRID[ny][nx]); continue; }
        if (!seen.has(nx + ',' + ny)) { seen.add(nx + ',' + ny); queue.push([nx, ny]); }
      }
    }
    const crawl = run.every(([cx, cy]) => kindAt(cx, cy).walk === 'crouch');
    const cx = run.reduce((sum, cell) => sum + cell[0], 0) / run.length, cy = run.reduce((sum, cell) => sum + cell[1], 0) / run.length;
    const zones = [...touched];
    for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) for (let k = 0; k < run.length; k++) add(zones[i], zones[j], cx, cy, crawl);
  }
  const portals = [];
  for (const [key, cells] of pairs) {
    const [a, b] = key.split('|');
    // Separate doors between the same two zones stay separate portals.
    const groups = [];
    for (const cell of cells) {
      const group = groups.find(list => list.some(other => Math.abs(other[0] - cell[0]) <= 1.5 && Math.abs(other[1] - cell[1]) <= 1.5));
      if (group) group.push(cell); else groups.push([cell]);
    }
    groups.forEach((group, index) => {
      const crawl = group.every(cell => cell[2]);
      const cx = group.reduce((sum, cell) => sum + cell[0], 0) / group.length;
      const cy = group.reduce((sum, cell) => sum + cell[1], 0) / group.length;
      portals.push({ id: a + '~' + b + (index ? '~' + index : ''), a, b, x: cx + .5, y: cy + .5, width: new Set(group.map(cell => cell[0] + ',' + cell[1])).size, crawl });
    });
  }
  return portals;
})());

export function neighbours(zoneId) {
  return PORTALS.filter(portal => portal.a === zoneId || portal.b === zoneId).map(portal => ({ zone: portal.a === zoneId ? portal.b : portal.a, portal }));
}

/** Hiding spots: lockers and tall grass, grouped into clusters per zone. */
export const HIDING = Object.freeze((() => {
  const spots = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const kind = kindAt(x, y);
    if (kind.hide === 'locker' || kind.hide === 'grass') {
      const zone = kind.hide === 'locker' ? zoneAt(center(x) + 8, center(y)) || zoneOfTile(x, y) : zoneOfTile(x, y);
      let near = zone;
      if (kind.hide === 'locker') {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (kindAt(x + dx, y + dy).walk === 'all') { near = zoneOfTile(x + dx, y + dy) || near; break; }
      }
      spots.push({ x, y, type: kind.hide, zone: near, cluster: near + ':' + kind.hide });
    }
  }
  return spots;
})());
export const HIDING_CLUSTERS = Object.freeze((() => {
  const clusters = new Map();
  for (const spot of HIDING) {
    if (!clusters.has(spot.cluster)) clusters.set(spot.cluster, { id: spot.cluster, zone: spot.zone, type: spot.type, spots: [] });
    clusters.get(spot.cluster).spots.push(spot);
  }
  for (const cluster of clusters.values()) {
    cluster.x = cluster.spots.reduce((sum, spot) => sum + spot.x + .5, 0) / cluster.spots.length;
    cluster.y = cluster.spots.reduce((sum, spot) => sum + spot.y + .5, 0) / cluster.spots.length;
  }
  return [...clusters.values()];
})());

/** Entry routes the dossier remembers. Traces are left at these tiles. */
export const ENTRIES = Object.freeze([
  { id: 'culvert', name: 'the west culvert', test: (tx, ty) => tileAt(tx, ty) === '~' },
  { id: 'gate', name: 'the main gate', test: (tx, ty) => ty === 31 && tx >= 30 && tx <= 33 },
  { id: 'fence', name: 'the cut east fence', test: (tx, ty) => tileAt(tx, ty) === 'f' },
]);
export const LAB_ENTRIES = Object.freeze([
  { id: 'duct', name: 'the air duct', test: (tx, ty) => tx === 20 && ty === 5 },
  { id: 'keycard', name: 'the keycard door', test: (tx, ty) => ty === 10 && (tx === 31 || tx === 32) },
  { id: 'north', name: 'the north door', test: (tx, ty) => tx === 38 && ty === 3 },
  { id: 'east', name: 'the east door', test: (tx, ty) => tx === 43 && (ty === 6 || ty === 7) },
]);

export function asciiMap() { return MAP.join('\n'); }
